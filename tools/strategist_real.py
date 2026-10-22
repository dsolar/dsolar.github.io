#!/usr/bin/env python3
"""Find real NFL snaps for Sunday Strategist and write sunday-strategist/real-plays.js.

Each Sunday Strategist lesson (a scenario in sunday-strategist/scenarios.js) has a `fit`: the down,
distance, coverage, rush count and blitz it teaches. This script reads nflverse's free data and picks
real snaps that match, so a lesson can be played again in a real game situation with real teams:

  play-by-play     game, teams, score, clock, down, distance, field position, result, EPA   (verified)
  participation    personnel, box count, pass rushers, coverage, man/zone, pressure,       (charted)
                   target route, time to throw, who was on the field
  FTN charting     blitzers, motion, play action, screens                                   (charted)

Only the pre-snap alignment drawn on the field is reconstructed, and the page says so.
Coverage charting is in the participation files for 2023 on (2026 isn't published yet).

  python tools/strategist_real.py                 2023 to 2025, cached downloads in tools/.nflverse-cache
  python tools/strategist_real.py 2024 2025       just those seasons

Standard library only. Data: nflverse (CC-BY 4.0), FTN Data via nflverse (CC-BY-SA 4.0).
"""
import csv
import gzip
import io
import json
import os
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get("NFLVERSE_CACHE", os.path.join(ROOT, "tools", ".nflverse-cache"))
OUT = os.path.join(ROOT, "sunday-strategist", "real-plays.js")
BASE = "https://github.com/nflverse/nflverse-data/releases/download/"
PER_LESSON = 8

TEAMS = {
    "ARI": "Cardinals", "ATL": "Falcons", "BAL": "Ravens", "BUF": "Bills", "CAR": "Panthers", "CHI": "Bears",
    "CIN": "Bengals", "CLE": "Browns", "DAL": "Cowboys", "DEN": "Broncos", "DET": "Lions", "GB": "Packers",
    "HOU": "Texans", "IND": "Colts", "JAX": "Jaguars", "KC": "Chiefs", "LA": "Rams", "LAC": "Chargers",
    "LV": "Raiders", "MIA": "Dolphins", "MIN": "Vikings", "NE": "Patriots", "NO": "Saints", "NYG": "Giants",
    "NYJ": "Jets", "PHI": "Eagles", "PIT": "Steelers", "SEA": "Seahawks", "SF": "49ers", "TB": "Buccaneers",
    "TEN": "Titans", "WAS": "Commanders",
}
ROUNDS = {"WC": "Wild Card", "DIV": "Divisional round", "CON": "Conference championship", "SB": "Super Bowl"}
COVERAGE = {"COVER_0": "Cover 0", "COVER_1": "Cover 1", "COVER_2": "Cover 2", "COVER_3": "Cover 3", "COVER_4": "Cover 4 (quarters)",
            "COVER_6": "Cover 6", "COVER_9": "Cover 9", "2_MAN": "2-Man", "COMBO": "Combination coverage"}


def fetch(path):
    os.makedirs(CACHE, exist_ok=True)
    local = os.path.join(CACHE, path.replace("/", "_"))
    if not os.path.exists(local):
        print("downloading", path)
        req = urllib.request.Request(BASE + path, headers={"User-Agent": "davidsolar-strategist/1.0"})
        with urllib.request.urlopen(req, timeout=300) as r, open(local + ".part", "wb") as f:
            f.write(r.read())
        os.replace(local + ".part", local)
    return local


def rows(path):
    local = fetch(path)
    f = gzip.open(local, "rt", encoding="utf-8") if local.endswith(".gz") else open(local, encoding="utf-8")
    with f:
        yield from csv.DictReader(f)


def count(personnel, keys):
    return sum(int(m.group(1)) for m in re.finditer(r"(\d+) (\w+)", personnel or "") if m.group(2) in keys)


def lessons():
    """Read each lesson's id and fit out of scenarios.js (it's a JS file, so this is a light parse)."""
    src = open(os.path.join(ROOT, "sunday-strategist", "scenarios.js"), encoding="utf-8").read()
    out = []
    for m in re.finditer(r'id: "([\w-]+)",\s*\n\s*title:.*?fit: (\{.*?\}),\n', src, re.S):
        fit = re.sub(r"(\w+):", r'"\1":', m.group(2))
        out.append((m.group(1), json.loads(fit)))
    return out


def num(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


SITUATIONS = {  # film-room situations and how many snaps each gets
    "first-ten": ("1st & 10", 55), "second-long": ("2nd & long", 35), "second-medium": ("2nd & medium", 25),
    "second-short": ("2nd & short", 30), "third-short": ("3rd & short", 40), "third-medium": ("3rd & medium", 40),
    "third-long": ("3rd & long", 40), "fourth-down": ("4th down", 25), "red-zone": ("Red zone", 45),
    "goal-line": ("Goal line", 35), "two-minute": ("Two-minute", 40),
}


def situation(down, dist, yl, qtr, secs):
    if yl <= 5:
        return "goal-line"
    if yl <= 20:
        return "red-zone"
    if qtr in (2, 4) and secs <= 120:
        return "two-minute"
    if down == 1:
        return "first-ten" if dist == 10 else None
    if down == 2:
        return "second-long" if dist >= 7 else "second-short" if dist <= 3 else "second-medium"
    if down == 3:
        return "third-short" if dist <= 2 else "third-medium" if dist <= 6 else "third-long"
    return "fourth-down" if dist <= 5 else None


def package(dp):
    dbs = count(dp, {"CB", "FS", "SS", "S", "DB"})
    return "heavy" if dbs <= 3 else "base" if dbs == 4 else "nickel" if dbs == 5 else "dime" if dbs == 6 else "quarter"


def lesson_fits(fit, kind, down, dist, pers, pkg, box, cov, rush, blitz, wrs):
    """A lesson's fit, from scenarios.js. Missing keys keep the original lessons' defaults:
    a pass from 11 personnel (three receivers) against nickel."""
    if kind not in fit.get("kinds", ["pass"]):
        return False
    if down not in fit["downs"] or not fit["distance"][0] <= dist <= fit["distance"][1]:
        return False
    if pers not in fit.get("offPers", ["11"]) or pkg not in fit.get("pkg", ["nickel"]):
        return False
    if fit.get("offPers", ["11"]) == ["11"] and wrs != 3:
        return False
    if "box" in fit and not fit["box"][0] <= box <= fit["box"][1]:
        return False
    if kind == "pass":
        if "coverage" in fit and cov not in fit["coverage"]:
            return False
        if "rushers" in fit and not fit["rushers"][0] <= rush <= fit["rushers"][1]:
            return False
        if "blitz" in fit and (blitz > 0) != fit["blitz"]:
            return False
    return True


def season(year, fits):
    part = {(r["nflverse_game_id"], r["play_id"]): r for r in rows(f"pbp_participation/pbp_participation_{year}.csv")}
    ftn = {(r["nflverse_game_id"], r["nflverse_play_id"]): r for r in rows(f"ftn_charting/ftn_charting_{year}.csv")}
    found, dropbacks, broad = defaultdict(list), defaultdict(Counter), []
    for r in rows(f"pbp/play_by_play_{year}.csv.gz"):
        key = (r["game_id"], r["play_id"].split(".")[0])
        p, f = part.get(key), ftn.get(key)
        kind = r["play_type"]
        if not p or not f or kind not in ("pass", "run"):
            continue
        rush, blitz = int(num(p["number_of_pass_rushers"], 0)), int(num(f["n_blitzers"], 0))
        cov, d = p["defense_coverage_type"], r["defteam"]
        down, dist, yl = int(num(r["down"], 0)), int(num(r["ydstogo"], 0)), int(num(r["yardline_100"], 0))
        qtr = int(num(r["qtr"], 1))
        secs = int(num(r["quarter_seconds_remaining"], 900))
        sit = situation(down, dist, yl, qtr, secs) if down else None
        if kind == "pass" and cov:  # each defense's habits by situation, for the scouting report
            for k in (("3rd",) if down == 3 else ()) + ((sit,) if sit else ()):
                t = dropbacks[(d, k)]
                t["n"] += 1
                t["blitz"] += blitz > 0
                t[cov] += 1
        if not down or r["penalty"] == "1" or r["two_point_attempt"] == "1" or r["qb_scramble"] == "1":
            continue
        if r.get("qb_kneel") == "1" or r.get("qb_spike") == "1" or f["is_trick_play"] == "TRUE":
            continue
        o, dp = p["offense_personnel"], p["defense_personnel"]
        if count(o, {"K", "P", "LS"}) or count(dp, {"K", "P", "LS"}) or count(o, {"QB"}) != 1:
            continue
        qbs = [x["id"] for x in names(p, "offense") if x["pos"] == "QB"]
        if kind == "pass" and (r["passer_player_id"] not in qbs or not cov or cov == "BLOWN"):
            continue  # trick plays (someone else threw it) and passes without charted coverage
        wp = num(r["wp"], 0.5)
        if not 0.05 <= wp <= 0.95:
            continue
        if 20 <= yl <= 80 and 0.12 <= wp <= 0.88 and f["is_screen_pass"] != "TRUE" and (kind == "run" or p.get("route")):
            pers = f"{count(o, {'RB', 'FB'})}{count(o, {'TE'})}"
            box = int(num(p["defenders_in_box"], 0))
            for lid, fit in fits:
                if lesson_fits(fit, kind, down, dist, pers, package(dp), box, cov, rush, blitz, count(o, {"WR"})):
                    found[lid].append(snap(year, r, p, f, rush, blitz, wp, sit))
        if sit:
            broad.append(snap(year, r, p, f, rush, blitz, wp, sit))
    return found, dropbacks, broad


def names(p, side):
    ids = (p[side + "_players"] or "").split(";")
    nm = (p[side + "_names"] or "").split(";")
    pos = (p[side + "_positions"] or "").split(";")
    return [{"id": i, "name": n, "pos": q} for i, n, q in zip(ids, nm, pos)]


def clock(t):
    m, _, sec = (t or "15:00").partition(":")
    return f"{int(m or 0)}:{sec[:2] or '00'}"


def snap(year, r, p, f, rush, blitz, wp, sit=None):
    off = names(p, "offense")
    by_id = {x["id"]: x["name"] for x in off}
    pick = lambda pos: [x["name"] for x in off if x["pos"] == pos]
    yl = int(num(r["yardline_100"]))
    week = int(num(r["week"], 0))
    st = r["season_type"]
    round_ = None
    if st == "POST":
        round_ = {19: "WC", 20: "DIV", 21: "CON", 22: "SB"}.get(week) or ("SB" if week >= 22 else "WC")
    result = "run" if r["play_type"] == "run" else "sack" if r["sack"] == "1" else "int" if r["interception"] == "1" else "complete" if r["complete_pass"] == "1" else "incomplete"
    return {
        "season": year, "week": week, "round": ROUNDS.get(round_), "date": r["game_date"], "gameId": r["game_id"],
        "playId": int(num(r["play_id"])), "off": r["posteam"], "def": r["defteam"], "home": r["home_team"],
        "offScore": int(num(r["posteam_score"], 0)), "defScore": int(num(r["defteam_score"], 0)),
        "qtr": int(num(r["qtr"], 1)), "clock": clock(r["time"]),
        "down": int(num(r["down"])), "dist": int(num(r["ydstogo"])), "yl100": yl,
        "desc": re.sub(r"\s+", " ", r["desc"]).strip(), "yards": int(num(r["yards_gained"], 0)), "epa": round(num(r["epa"], 0), 2),
        "first": r["first_down"] == "1", "td": r["touchdown"] == "1", "result": result, "wp": round(wp, 2),
        "passer": (by_id.get(r["passer_player_id"]) or r["passer_player_name"]) if r["play_type"] == "pass" else None,
        "target": by_id.get(r["receiver_player_id"]) or r["receiver_player_name"] or None,
        "route": p["route"].title() if p["route"] else None,
        "coverage": COVERAGE.get(p["defense_coverage_type"], p["defense_coverage_type"]) if p["defense_coverage_type"] else None,
        "manZone": {"MAN_COVERAGE": "man", "ZONE_COVERAGE": "zone"}.get(p["defense_man_zone_type"]),
        "rushers": rush, "blitzers": blitz, "box": int(num(p["defenders_in_box"], 0)) or None,
        "pressure": p["was_pressure"] == "TRUE", "ttt": round(num(p["time_to_throw"]), 2) if num(p["time_to_throw"]) else None,
        "playAction": f["is_play_action"] == "TRUE", "motion": f["is_motion"] == "TRUE",
        "qb": (pick("QB") or [None])[0], "rb": (pick("RB") or pick("FB") or [None])[0], "te": (pick("TE") or [None])[0], "wr": pick("WR"),
        "kind": r["play_type"], "situation": sit,
        "offPers": f"{count(p['offense_personnel'], {'RB', 'FB'})}{count(p['offense_personnel'], {'TE'})}",
        "fb": count(p["offense_personnel"], {"FB"}), "wrs": count(p["offense_personnel"], {"WR"}),
        "ol": count(p["offense_personnel"], {"C", "G", "T", "OL", "OG", "OT"}),
        "formation": (p["offense_formation"] or "").title() or None,
        "pkg": package(p["defense_personnel"]),
        "def7": {"dl": count(p["defense_personnel"], {"DE", "DT", "NT", "DL"}), "olb": count(p["defense_personnel"], {"OLB"}),
                 "lb": count(p["defense_personnel"], {"ILB", "MLB", "LB"}), "cb": count(p["defense_personnel"], {"CB"}),
                 "s": count(p["defense_personnel"], {"FS", "SS", "S", "DB"})},
        "rusher": by_id.get(r["rusher_player_id"]) or r["rusher_player_name"] or None,
        "runLoc": r["run_location"] or None, "runGap": r["run_gap"] or None,
        "passLoc": r["pass_location"] or None, "airYards": int(num(r["air_yards"], 0)) if r["air_yards"] else None,
        "screen": f["is_screen_pass"] == "TRUE", "rpo": f["is_rpo"] == "TRUE",
    }


def choose(cands):
    """A spread of teams, seasons and outcomes (close games first), always a Patriots snap if there is one."""
    cands = sorted((c for c in cands if c["target"]), key=lambda s: (abs(s["wp"] - 0.5), s["gameId"], s["playId"]))
    by_season = defaultdict(list)
    for c in cands:
        by_season[c["season"]].append(c)
    order = sorted(by_season, reverse=True)
    rr = [by_season[y][i] for i in range(max((len(v) for v in by_season.values()), default=0)) for y in order if i < len(by_season[y])]
    picked, offs, defs = [], set(), set()
    ne = [c for c in rr if "NE" in (c["off"], c["def"])]
    pool = ne[:1] + [c for c in rr if c not in ne[:1]]
    good = bad = 0
    for c in pool:
        if len(picked) >= PER_LESSON:
            break
        if c["off"] in offs or c["def"] in defs:
            continue
        worked = c["epa"] > 0
        if worked and good >= PER_LESSON // 2 or not worked and bad >= PER_LESSON - PER_LESSON // 2:
            continue
        picked.append(c)
        offs.add(c["off"])
        defs.add(c["def"])
        good += worked
        bad += not worked
    return picked


def tendency(tend, c, key):
    t = tend.get((c["season"], c["def"], key), Counter())
    cov_key = next((k for k, v in COVERAGE.items() if v == c["coverage"]), None)
    top = max((k for k in COVERAGE if t[k]), key=lambda k: t[k], default=None)
    return {"n": t["n"], "key": key, "blitz": round(t["blitz"] / t["n"], 3) if t["n"] else None,
            "coverage": round(t[cov_key] / t["n"], 3) if t["n"] and cov_key else None,
            "top": COVERAGE.get(top), "topRate": round(t[top] / t["n"], 3) if top and t["n"] else None}


def choose_broad(cands):
    """For each situation, cycle through personnel x package x run/pass cells so the rare looks
    (13 personnel, dime, goal-line heavy) show up next to the common ones. Close games first,
    seasons mixed, no team more than twice per situation, and a Patriots snap where there is one."""
    out = []
    by_sit = defaultdict(list)
    for c in cands:
        by_sit[c["situation"]].append(c)
    for sit, (label, target) in SITUATIONS.items():
        pool = sorted(by_sit[sit], key=lambda c: (abs(c["wp"] - 0.5) + (0.08 if c["kind"] == "pass" and not c["target"] and c["result"] != "sack" else 0), c["gameId"], c["playId"]))
        cells = defaultdict(list)
        for c in pool:
            cells[(c["offPers"], c["pkg"], c["kind"])].append(c)
        order = [k for k in sorted(cells, key=lambda k: -len(cells[k])) if len(cells[k]) >= 25]  # common enough to teach
        picked, offs, defs, seasons = [], Counter(), Counter(), Counter()
        ne = next((c for c in pool if "NE" in (c["off"], c["def"])), None)
        if ne:
            picked.append(ne); offs[ne["off"]] += 1; defs[ne["def"]] += 1; seasons[ne["season"]] += 1
        idx = Counter()
        while len(picked) < target and any(idx[k] < len(cells[k]) for k in order):
            for k in order:
                if len(picked) >= target:
                    break
                while idx[k] < len(cells[k]):
                    c = cells[k][idx[k]]
                    idx[k] += 1
                    if c in picked or offs[c["off"]] >= 2 or defs[c["def"]] >= 2:
                        continue
                    if seasons[c["season"]] > min(seasons.values() or [0]) + 3:
                        continue
                    picked.append(c); offs[c["off"]] += 1; defs[c["def"]] += 1; seasons[c["season"]] += 1
                    break
        print(f"{label}: {len(pool)} snaps, {len(picked)} chosen, {len({(c['offPers'], c['pkg'], c['kind']) for c in picked})} distinct looks")
        out.extend(picked)
    return out


def main():
    years = [int(a) for a in sys.argv[1:]] or [2023, 2024, 2025]
    fits = lessons()
    if not fits:
        sys.exit("No lessons with a fit in scenarios.js")
    allc, tend, broad = defaultdict(list), {}, []
    for y in years:
        found, drop, b = season(y, fits)
        for k, v in found.items():
            allc[k].extend(v)
        for (team, k), t in drop.items():
            tend[(y, team, k)] = t
        broad.extend(b)
    plays = []
    for lid, _ in fits:
        chosen = choose(allc[lid])
        print(f"{lid}: {len(allc[lid])} matching snaps, {len(chosen)} chosen")
        for i, c in enumerate(chosen):
            c["tendency"] = tendency(tend, c, "3rd")
            c["lesson"] = lid
            c["id"] = f"real-{c['gameId']}-{c['playId']}"
            plays.append(c)
    taken = {p["id"] for p in plays}
    for c in choose_broad(broad):
        c["id"] = f"real-{c['gameId']}-{c['playId']}"
        if c["id"] in taken:
            continue
        c["lesson"] = None
        c["tendency"] = tendency(tend, c, c["situation"])
        plays.append(c)
    for p in plays:  # leave out empty fields; the page treats missing as none
        for k in [k for k, v in p.items() if v is None or v is False]:
            del p[k]
        p.pop("date", None)
    data = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "seasons": years,
        "source": "nflverse play-by-play and participation (CC-BY 4.0); FTN Data charting via nflverse (CC-BY-SA 4.0)",
        "teams": TEAMS,
        "situations": {k: v[0] for k, v in SITUATIONS.items()},
        "plays": plays,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* Real NFL snaps for Sunday Strategist, written by tools/strategist_real.py. Don't edit by hand.\n"
                "   Each one replays a lesson in sunday-strategist/scenarios.js in a real game situation. */\n")
        f.write("(function (root, data) {\n  if (typeof module === \"object\" && module.exports) module.exports = data;\n"
                "  else root.SS_REAL = data;\n})(this, ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"), default=str)
        f.write(");\n")
    print(f"Wrote {OUT}: {len(plays)} real snaps")


if __name__ == "__main__":
    main()
