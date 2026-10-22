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


def season(year, fits):
    part = {(r["nflverse_game_id"], r["play_id"]): r for r in rows(f"pbp_participation/pbp_participation_{year}.csv")}
    ftn = {(r["nflverse_game_id"], r["nflverse_play_id"]): r for r in rows(f"ftn_charting/ftn_charting_{year}.csv")}
    found, dropbacks = defaultdict(list), defaultdict(Counter)
    for r in rows(f"pbp/play_by_play_{year}.csv.gz"):
        key = (r["game_id"], r["play_id"].split(".")[0])
        p, f = part.get(key), ftn.get(key)
        if not p or not f or r["play_type"] != "pass" or not p.get("defense_coverage_type"):
            continue
        rush, blitz = int(num(p["number_of_pass_rushers"], 0)), int(num(f["n_blitzers"], 0))
        cov, d = p["defense_coverage_type"], r["defteam"]
        if r["down"] == "3":  # each defense's third-down habits, for the scouting report
            t = dropbacks[d]
            t["n"] += 1
            t["blitz"] += blitz > 0
            t[cov] += 1
        down, dist, yl = int(num(r["down"], 0)), int(num(r["ydstogo"], 0)), int(num(r["yardline_100"], 0))
        if not (20 <= yl <= 80) or r["penalty"] == "1" or r["two_point_attempt"] == "1" or r["qb_scramble"] == "1":
            continue
        if f["is_screen_pass"] == "TRUE" or f["is_trick_play"] == "TRUE" or not p.get("route"):
            continue
        o, dp = p["offense_personnel"], p["defense_personnel"]
        if not (count(o, {"RB", "FB"}) == 1 and count(o, {"TE"}) == 1 and count(o, {"WR"}) == 3):
            continue
        if count(dp, {"CB", "FS", "SS", "S", "DB"}) != 5:
            continue
        if r["passer_player_id"] not in [x["id"] for x in names(p, "offense") if x["pos"] == "QB"]:
            continue  # trick plays: someone other than the quarterback threw it
        wp = num(r["wp"], 0.5)
        if not 0.12 <= wp <= 0.88:
            continue
        for lid, fit in fits:
            if (down in fit["downs"] and fit["distance"][0] <= dist <= fit["distance"][1] and cov in fit["coverage"]
                    and fit["rushers"][0] <= rush <= fit["rushers"][1] and (blitz > 0) == fit["blitz"]):
                found[lid].append(snap(year, r, p, f, rush, blitz, wp))
    return found, dropbacks


def names(p, side):
    ids = (p[side + "_players"] or "").split(";")
    nm = (p[side + "_names"] or "").split(";")
    pos = (p[side + "_positions"] or "").split(";")
    return [{"id": i, "name": n, "pos": q} for i, n, q in zip(ids, nm, pos)]


def clock(t):
    m, _, sec = (t or "15:00").partition(":")
    return f"{int(m or 0)}:{sec[:2] or '00'}"


def snap(year, r, p, f, rush, blitz, wp):
    off = names(p, "offense")
    by_id = {x["id"]: x["name"] for x in off}
    pick = lambda pos: [x["name"] for x in off if x["pos"] == pos]
    yl = int(num(r["yardline_100"]))
    week = int(num(r["week"], 0))
    st = r["season_type"]
    round_ = None
    if st == "POST":
        round_ = {19: "WC", 20: "DIV", 21: "CON", 22: "SB"}.get(week) or ("SB" if week >= 22 else "WC")
    result = "sack" if r["sack"] == "1" else "int" if r["interception"] == "1" else "complete" if r["complete_pass"] == "1" else "incomplete"
    return {
        "season": year, "week": week, "round": ROUNDS.get(round_), "date": r["game_date"], "gameId": r["game_id"],
        "playId": int(num(r["play_id"])), "off": r["posteam"], "def": r["defteam"], "home": r["home_team"],
        "offScore": int(num(r["posteam_score"], 0)), "defScore": int(num(r["defteam_score"], 0)),
        "qtr": int(num(r["qtr"], 1)), "clock": clock(r["time"]),
        "down": int(num(r["down"])), "dist": int(num(r["ydstogo"])), "yl100": yl,
        "desc": re.sub(r"\s+", " ", r["desc"]).strip(), "yards": int(num(r["yards_gained"], 0)), "epa": round(num(r["epa"], 0), 2),
        "first": r["first_down"] == "1", "td": r["touchdown"] == "1", "result": result, "wp": round(wp, 2),
        "passer": by_id.get(r["passer_player_id"]) or r["passer_player_name"],
        "target": by_id.get(r["receiver_player_id"]) or r["receiver_player_name"] or None,
        "route": p["route"].title() if p["route"] else None,
        "coverage": COVERAGE.get(p["defense_coverage_type"], p["defense_coverage_type"]),
        "manZone": {"MAN_COVERAGE": "man", "ZONE_COVERAGE": "zone"}.get(p["defense_man_zone_type"]),
        "rushers": rush, "blitzers": blitz, "box": int(num(p["defenders_in_box"], 0)) or None,
        "pressure": p["was_pressure"] == "TRUE", "ttt": round(num(p["time_to_throw"]), 2) if num(p["time_to_throw"]) else None,
        "playAction": f["is_play_action"] == "TRUE", "motion": f["is_motion"] == "TRUE",
        "qb": (pick("QB") or [None])[0], "rb": (pick("RB") or pick("FB") or [None])[0], "te": (pick("TE") or [None])[0], "wr": pick("WR"),
        "defNames": [x["name"] for x in names(p, "defense")],
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


def main():
    years = [int(a) for a in sys.argv[1:]] or [2023, 2024, 2025]
    fits = lessons()
    if not fits:
        sys.exit("No lessons with a fit in scenarios.js")
    allc, tend = defaultdict(list), {}
    for y in years:
        found, drop = season(y, fits)
        for k, v in found.items():
            allc[k].extend(v)
        for team, t in drop.items():
            tend[(y, team)] = t
    plays = []
    for lid, _ in fits:
        chosen = choose(allc[lid])
        print(f"{lid}: {len(allc[lid])} matching snaps, {len(chosen)} chosen")
        for i, c in enumerate(chosen):
            t = tend.get((c["season"], c["def"]), Counter())
            cov_key = next((k for k, v in COVERAGE.items() if v == c["coverage"]), None)
            c["tendency"] = {"n": t["n"], "blitz": round(t["blitz"] / t["n"], 3) if t["n"] else None,
                             "coverage": round(t[cov_key] / t["n"], 3) if t["n"] and cov_key else None}
            c["lesson"] = lid
            c["id"] = f"real-{c['gameId']}-{c['playId']}"
            plays.append(c)
    data = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "seasons": years,
        "source": "nflverse play-by-play and participation (CC-BY 4.0); FTN Data charting via nflverse (CC-BY-SA 4.0)",
        "teams": TEAMS,
        "plays": plays,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* Real NFL snaps for Sunday Strategist, written by tools/strategist_real.py. Don't edit by hand.\n"
                "   Each one replays a lesson in sunday-strategist/scenarios.js in a real game situation. */\n")
        f.write("(function (root, data) {\n  if (typeof module === \"object\" && module.exports) module.exports = data;\n"
                "  else root.SS_REAL = data;\n})(this, ")
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write(");\n")
    print(f"Wrote {OUT}: {len(plays)} real snaps")


if __name__ == "__main__":
    main()
