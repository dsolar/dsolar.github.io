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

    unmatched = []
    for t in teams:
        roster = t["roster"]
        for p in roster:
            for k in ("proj", "rank", "in_best", "actual", "next_proj", "bye_next", "date", "final"):
                p.pop(k, None)
            if p.get("empty"):
                continue
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
            n = nxt.find(p)
            if p["nfl"] in nxt.byes:
                p["bye_next"] = True
                p["next_proj"] = 0.0
            elif n:
                p["next_proj"] = n["pts"]

        t["best"] = best_lineup(roster, "proj", flag="in_best")
        t["best_next"] = best_lineup(roster, "next_proj") if nxt.by_name else None

        # Points already banked by this week's starters (the best lineup if none is set).
        starters = [p for p in roster if p["slot"] not in ("BN", "IR") and not p.get("empty")]
        if not starters:
            starters = [p for p in roster if p.get("in_best")]
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
