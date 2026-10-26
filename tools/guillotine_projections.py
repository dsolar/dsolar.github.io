#!/usr/bin/env python3
"""Add player projections, results, byes and lineup math to guillotine/data.json.

Source: Sleeper's public projections and stats feeds (no sign-in), rescored with the Bastille Day
settings: half PPR, 4-point passing TDs, 25 passing yards / 10 rushing or receiving yards per
point, -1 per interception, -2 per fumble lost, 2 per two-point conversion.

Every rostered player gets:
  proj       projected league points this week (0 on a bye)
  rank       projected position rank this week, like "WR12"
  actual     league points scored, once that player's game is final
  next_proj  projected points next week (0 if on bye next week)
  bye_next   true if his team is off next week
  in_best    part of the team's best lineup this week
  season     weeks 1 to last week: games played, league points each week, and season totals
             (passing, rushing, receiving), for the stat card that opens on a player's name
Every team still alive gets:
  best       points its best lineup projects to this week
  best_next  the same for next week, byes included
  locked     points already banked by its starters whose games are final
  locked_proj  what those starters had been projected for
The page uses best when a team has no lineup set, and shifts each projection by
(locked - locked_proj) as games finish.

  python tools/guillotine_projections.py                pull from Sleeper
  python tools/guillotine_projections.py --from DIR     use saved responses (proj_W.json, proj_W1.json, stats_W.json)
"""
import argparse
import json
import os
import re
import unicodedata
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "guillotine", "data.json")
POS_Q = "&position%5B%5D=QB&position%5B%5D=RB&position%5B%5D=WR&position%5B%5D=TE"
URLS = {
    "proj": "https://api.sleeper.com/projections/nfl/{season}/{week}?season_type=regular" + POS_Q,
    "stats": "https://api.sleeper.com/stats/nfl/{season}/{week}?season_type=regular" + POS_Q,
}
UA = "davidsolar-guillotine/1.0 (+https://davidsolar.dev/guillotine/)"
ET = ZoneInfo("America/New_York")

SCORING = {
    "pass_yd": 0.04, "pass_td": 4, "pass_int": -1, "pass_2pt": 2,
    "rush_yd": 0.1, "rush_td": 6, "rush_2pt": 2,
    "rec": 0.5, "rec_yd": 0.1, "rec_td": 6, "rec_2pt": 2,
    "fum_lost": -2,
}
ELIGIBLE = {
    "QB": {"QB"}, "RB": {"RB"}, "WR": {"WR"}, "TE": {"TE"}, "K": {"K"}, "DEF": {"DEF"},
    "W/R": {"WR", "RB"}, "W/T": {"WR", "TE"}, "W/R/T": {"WR", "RB", "TE"},
    "Q/W/R/T": {"QB", "WR", "RB", "TE"},
}
UNAVAILABLE = {"O", "IR", "IR-R", "PUP", "PUP-R", "NA", "SUSP"}


def norm(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[.'’`-]", "", s)
    return " ".join(w for w in s.split() if w not in {"jr", "sr", "ii", "iii", "iv", "v"})


def league_points(stats):
    if any(k in stats for k in SCORING):
        return round(sum((stats.get(k) or 0) * v for k, v in SCORING.items()), 2)
    v = stats.get("pts_half_ppr")
    return round(v, 2) if isinstance(v, (int, float)) else 0.0


def load(kind, season, week, from_dir):
    if from_dir:
        fp = os.path.join(from_dir, f"{kind}_{week}.json")
        if not os.path.exists(fp):
            return []
        with open(fp, encoding="utf-8") as f:
            return json.load(f)
    req = urllib.request.Request(URLS[kind].format(season=season, week=week), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.load(res)


class Feed:
    """One week of Sleeper entries, indexed by player name, with position ranks and bye teams."""

    def __init__(self, entries, rank=False):
        self.by_name, by_pos, seen, playing = {}, {}, set(), set()
        for e in entries:
            p = e.get("player") or {}
            pos = p.get("position")
            if pos not in ("QB", "RB", "WR", "TE"):
                continue
            team = (e.get("team") or p.get("team") or "").upper()
            stats = e.get("stats") or {}
            if team:
                seen.add(team)
                if e.get("date"):
                    playing.add(team)
            row = {"pos": pos, "team": team, "pts": league_points(stats), "date": e.get("date"),
                   "played": bool(stats.get("gp"))}
            name = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
            self.by_name.setdefault(norm(name), []).append(row)
            by_pos.setdefault(pos, []).append(row)
        self.byes = seen - playing if playing else set()
        if rank:
            for pos, rows in by_pos.items():
                ranked = sorted((r for r in rows if r["pts"] > 0), key=lambda r: -r["pts"])
                for i, r in enumerate(ranked, 1):
                    r["rank"] = f"{pos}{i}"

    def find(self, p):
        cands = [c for c in self.by_name.get(norm(p["name"]), []) if c["pos"] == p["pos"]]
        if len(cands) > 1:
            cands = [c for c in cands if c["team"] == p["nfl"]] or cands
        return max(cands, key=lambda c: c["pts"]) if cands else None


SEASON_KEYS = ("pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td",
               "rec", "rec_tgt", "rec_yd", "rec_td", "fum_lost")


def season_lines(season, week, from_dir):
    """Every completed week's Sleeper stats, added up per player. None if no week loaded."""
    weeks = list(range(1, week))
    by, got = {}, 0
    for w in weeks:
        try:
            entries = load("stats", season, w, from_dir)
        except Exception as e:  # one missing week shouldn't sink the rest
            print(f"::warning::Couldn't load week {w} stats ({type(e).__name__}: {e}).")
            continue
        got += 1
        for e in entries or []:
            pl = e.get("player") or {}
            pos = pl.get("position")
            if pos not in ("QB", "RB", "WR", "TE"):
                continue
            stats = e.get("stats") or {}
            name = f"{pl.get('first_name', '')} {pl.get('last_name', '')}".strip()
            team = (e.get("team") or pl.get("team") or "").upper()
            pid = e.get("player_id") or name
            agg = by.setdefault((norm(name), pos), {}).setdefault(
                pid, {"team": team, "g": 0, "wk": [None] * len(weeks), "tot": {}})
            if team:
                agg["team"] = team
            if not stats.get("gp"):
                continue
            agg["g"] += 1
            agg["wk"][w - 1] = league_points(stats)
            for k in SEASON_KEYS:
                v = stats.get(k)
                if isinstance(v, (int, float)) and v:
                    agg["tot"][k] = agg["tot"].get(k, 0) + v
    return by if got else None


def season_for(lines, p):
    cands = list((lines.get((norm(p["name"]), p["pos"])) or {}).values())
    if not cands:
        return None
    same = [c for c in cands if c["team"] == p["nfl"]]
    a = max(same or cands, key=lambda c: c["g"])
    return {"g": a["g"], "wk": [round(x, 1) if isinstance(x, (int, float)) else None for x in a["wk"]],
            "tot": {k: round(v) for k, v in a["tot"].items()}}


def best_lineup(roster, key, flag=None, skip_bye_key=None):
    """Fill the most restrictive slots first; with nested flex slots this is optimal."""
    slots = [p["slot"] for p in roster if p["slot"] not in ("BN", "IR")]
    pool = [p for p in roster if not p.get("empty") and p["slot"] != "IR"
            and p.get("status") not in UNAVAILABLE and (p.get(key) or 0) > 0
            and not (skip_bye_key and p.get(skip_bye_key))]
    pool.sort(key=lambda p: -p[key])
    used, total = set(), 0.0
    for slot in sorted(slots, key=lambda s: len(ELIGIBLE.get(s, {s}))):
        ok = ELIGIBLE.get(slot, {slot})
        for p in pool:
            if id(p) not in used and p["pos"] in ok:
                used.add(id(p))
                if flag:
                    p[flag] = True
                total += p[key]
                break
    return round(total, 1)


def fill_empty(team):
    """Put a stand-in in every empty starting spot, the way a manager would before kickoff.

    With some starters set, each empty spot gets the best healthy bench player who can play it; the team's
    projection grows by their points (t["fill"]). With no lineup at all, the whole best lineup stands in.
    The empty spot records who's assumed ("assumed"); that player records the spot ("assumed_slot").
    """
    roster = team["roster"]
    empties = [p for p in roster if p.get("empty") and p["slot"] not in ("BN", "IR")]
    team.pop("fill", None)
    if not empties:
        return
    none_set = all(p.get("empty") for p in roster if p["slot"] not in ("BN", "IR"))
    if none_set:
        pool = [p for p in roster if p.get("in_best")]
    else:
        pool = [p for p in roster if p["slot"] == "BN" and not p.get("empty") and not p.get("bye")
                and p.get("status") not in UNAVAILABLE and (p.get("proj") or 0) > 0]
    pool.sort(key=lambda p: -(p.get("proj") or 0))
    used, fill = set(), 0.0
    for slot in sorted(empties, key=lambda e: len(ELIGIBLE.get(e["slot"], {e["slot"]}))):
        ok = ELIGIBLE.get(slot["slot"], {slot["slot"]})
        pick = next((p for p in pool if id(p) not in used and p["pos"] in ok), None)
        if not pick:
            continue
        used.add(id(pick))
        slot["assumed"] = pick["name"]
        pick["assumed_slot"] = slot["slot"]
        fill += pick.get("proj") or 0
    if not none_set and fill:
        team["fill"] = round(fill, 2)


def reconcile_roster_only_scores(team):
    """A newer roster-only paste cannot use totals banked against an older lineup.

    Only finals already observed in the roster snapshot are included in the new base;
    later games remain outside that base so the live overlay can add them once.
    """
    starters = [p for p in team["roster"] if p["slot"] not in ("BN", "IR") and not p.get("empty")]
    if len(starters) != 9 or any("actual" not in p for p in starters if p.get("yfinal")):
        return False
    team["points"] = round(sum(p["actual"] for p in starters if p.get("yfinal")), 2)
    team["proj"] = round(sum(p.get("actual", 0) if p.get("final") or p.get("yfinal") else p.get("proj", 0) for p in starters), 2)
    team["score_source"] = "Yahoo screenshot finals where supplied; otherwise NFL statistics scored with league settings"
    team["projection_source"] = "As-set lineup: final points plus remaining player projections"
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=DATA)
    ap.add_argument("--from", dest="from_dir")
    ap.add_argument("--today", help="pretend today is YYYY-MM-DD (ET), for testing")
    a = ap.parse_args()
    with open(a.data, encoding="utf-8") as f:
        data = json.load(f)
    teams = [t for t in data["teams"] if not t.get("out") and t.get("roster")]
    if not teams:
        print("No rosters in data.json yet; nothing to project.")
        return
    season, week = data["season"], data["week"]
    today = a.today or datetime.now(ET).strftime("%Y-%m-%d")

    try:
        now = Feed(load("proj", season, week, a.from_dir), rank=True)
    except Exception as e:  # keep the pasted data even if Sleeper is down
        print(f"::warning::Couldn't load Sleeper projections ({type(e).__name__}: {e}). Page keeps its current numbers.")
        return
    try:
        nxt = Feed(load("proj", season, week + 1, a.from_dir))
    except Exception as e:
        print(f"::warning::Couldn't load next week's projections ({e}).")
        nxt = Feed([])
    try:
        res = Feed(load("stats", season, week, a.from_dir))
    except Exception as e:
        print(f"::warning::Couldn't load this week's stats ({e}).")
        res = Feed([])

    try:
        lines = season_lines(season, week, a.from_dir)
    except Exception as e:
        print(f"::warning::Couldn't build season stats ({type(e).__name__}: {e}).")
        lines = None

    unmatched = []
    for t in teams:
        roster = t["roster"]
        for p in roster:
            for k in ("proj", "rank", "in_best", "actual", "next_proj", "bye_next", "date", "final", "assumed", "assumed_slot"):
                p.pop(k, None)
            if p.get("empty"):
                continue
            if lines is not None:  # keep the last season lines if this run couldn't get new ones
                p.pop("season", None)
                sl = season_for(lines, p)
                if sl:
                    p["season"] = sl
            m = now.find(p)
            if p.get("bye") or p["nfl"] in now.byes:
                p["proj"] = 0.0
            elif m:
                p["proj"] = m["pts"]
                if m.get("rank"):
                    p["rank"] = m["rank"]
                if m.get("date"):
                    p["date"] = m["date"]
            else:
                unmatched.append(f"{p['name']} ({p['pos']}, {p['nfl']})")
            # A game counts as final once its date has passed (Eastern time).
            if p.get("date") and p["date"] < today and res.by_name:
                p["final"] = True
                r = res.find(p)
                p["actual"] = r["pts"] if r and r["played"] else 0.0
            # Exact final Yahoo observations outrank a differently scored public stats feed.
            if isinstance(p.get("yahoo_proj"), (int, float)):
                p["proj"] = p["yahoo_proj"]
            if p.get("yfinal") and isinstance(p.get("yahoo_actual"), (int, float)):
                p["actual"] = p["yahoo_actual"]
                p["final"] = True
            n = nxt.find(p)
            if p["nfl"] in nxt.byes:
                p["bye_next"] = True
                p["next_proj"] = 0.0
            elif n:
                p["next_proj"] = n["pts"]

        if data.get("roster_only_import"):
            if not reconcile_roster_only_scores(t):
                raise ValueError("Cannot reconcile roster-only import: incomplete final scores for " + t["name"])
        t["best"] = best_lineup(roster, "proj", flag="in_best")
        t["best_next"] = best_lineup(roster, "next_proj") if nxt.by_name else None
        fill_empty(t)

        # Points already banked by this week's starters, counting whoever stands in for an empty spot.
        starters = [p for p in roster if (p["slot"] not in ("BN", "IR") and not p.get("empty")) or p.get("assumed_slot")]
        done = [p for p in starters if p.get("final")]
        t["locked"] = round(sum(p.get("actual", 0) for p in done), 2)
        t["locked_proj"] = round(sum(p.get("proj") or 0 for p in done), 2)
        t["games_final"] = len(done)

    data["next_byes"] = sorted(nxt.byes)
    data["proj_source"] = {
        "name": "Sleeper",
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "players": sum(len(v) for v in now.by_name.values()),
        "unmatched": unmatched,
    }
    with open(a.data, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"Week {week}: byes {sorted(now.byes)}; next week byes {sorted(nxt.byes)}; {len(unmatched)} unmatched: "
          f"{', '.join(unmatched) or 'none'}")
    for t in teams:
        print(f"  {t['name']}: best {t['best']}, next week {t['best_next']}, locked {t['locked']} "
              f"of {t['locked_proj']} projected ({t['games_final']} final)")


if __name__ == "__main__":
    main()
