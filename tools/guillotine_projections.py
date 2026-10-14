#!/usr/bin/env python3
"""Add player projections, weekly position ranks and each team's best lineup to guillotine/data.json.

Projections come from Sleeper's public projections feed (no sign-in needed), rescored with the
Bastille Day settings: half PPR, 4-point passing TDs, 25 passing yards / 10 rushing or receiving
yards per point, -1 per interception, -2 per fumble lost, 2 per two-point conversion.

For every rostered player it adds:  proj     projected league points this week (0 on a bye)
                                    rank     projected position rank this week, like "WR12"
                                    in_best  part of the team's best possible lineup
For every team:                     best     points that best lineup projects to
The page uses "best" in place of Yahoo's projection when a team has no lineup set.

  python tools/guillotine_projections.py                pull from Sleeper
  python tools/guillotine_projections.py --from FILE    use a saved Sleeper response (for testing)
"""
import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "guillotine", "data.json")
URL = ("https://api.sleeper.com/projections/nfl/{season}/{week}?season_type=regular"
       "&position%5B%5D=QB&position%5B%5D=RB&position%5B%5D=WR&position%5B%5D=TE")
UA = "davidsolar-guillotine/1.0 (+https://davidsolar.dev/guillotine/)"

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
    words = [w for w in s.split() if w not in {"jr", "sr", "ii", "iii", "iv", "v"}]
    return " ".join(words)


def league_points(stats):
    if any(k in stats for k in SCORING):
        return round(sum((stats.get(k) or 0) * v for k, v in SCORING.items()), 2)
    v = stats.get("pts_half_ppr")
    return round(v, 2) if isinstance(v, (int, float)) else 0.0


def load_feed(season, week, from_file):
    if from_file:
        with open(from_file, encoding="utf-8") as f:
            return json.load(f)
    req = urllib.request.Request(URL.format(season=season, week=week), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.load(res)


def index_feed(feed):
    """name -> candidate entries, plus position ranks for the week."""
    by_name, by_pos = {}, {}
    for e in feed:
        p = e.get("player") or {}
        pos = p.get("position")
        if pos not in ("QB", "RB", "WR", "TE"):
            continue
        name = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
        row = {"pos": pos, "team": (e.get("team") or p.get("team") or "").upper(),
               "pts": league_points(e.get("stats") or {})}
        by_name.setdefault(norm(name), []).append(row)
        by_pos.setdefault(pos, []).append(row)
    for pos, rows in by_pos.items():
        ranked = sorted((r for r in rows if r["pts"] > 0), key=lambda r: -r["pts"])
        for i, r in enumerate(ranked, 1):
            r["rank"] = f"{pos}{i}"
    return by_name


def match(p, by_name):
    cands = [c for c in by_name.get(norm(p["name"]), []) if c["pos"] == p["pos"]]
    if len(cands) > 1:
        same_team = [c for c in cands if c["team"] == p["nfl"]]
        cands = same_team or cands
    return max(cands, key=lambda c: c["pts"]) if cands else None


def best_lineup(roster):
    """Fill the most restrictive slots first; with nested flex slots this is optimal."""
    slots = [p["slot"] for p in roster if p["slot"] not in ("BN", "IR")]
    pool = [p for p in roster if not p.get("empty") and p["slot"] != "IR"
            and p.get("status") not in UNAVAILABLE and (p.get("proj") or 0) > 0]
    pool.sort(key=lambda p: -p["proj"])
    used, total = set(), 0.0
    for slot in sorted(slots, key=lambda s: len(ELIGIBLE.get(s, {s}))):
        ok = ELIGIBLE.get(slot, {slot})
        for p in pool:
            if id(p) not in used and p["pos"] in ok:
                used.add(id(p))
                p["in_best"] = True
                total += p["proj"]
                break
    return round(total, 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=DATA)
    ap.add_argument("--from", dest="from_file")
    a = ap.parse_args()
    with open(a.data, encoding="utf-8") as f:
        data = json.load(f)
    teams = [t for t in data["teams"] if not t.get("out") and t.get("roster")]
    if not teams:
        print("No rosters in data.json yet; nothing to project.")
        return

    try:
        feed = load_feed(data["season"], data["week"], a.from_file)
    except Exception as e:  # keep the pasted data even if Sleeper is down
        print(f"::warning::Couldn't load Sleeper projections ({type(e).__name__}: {e}). Page keeps its current numbers.")
        return
    by_name = index_feed(feed)

    unmatched = []
    for t in teams:
        for p in t["roster"]:
            for k in ("proj", "rank", "in_best"):
                p.pop(k, None)
            if p.get("empty"):
                continue
            if p.get("bye"):
                p["proj"] = 0.0
                continue
            m = match(p, by_name)
            if m:
                p["proj"] = m["pts"]
                if m.get("rank"):
                    p["rank"] = m["rank"]
            else:
                unmatched.append(f"{p['name']} ({p['pos']}, {p['nfl']})")
        t["best"] = best_lineup(t["roster"])

    data["proj_source"] = {
        "name": "Sleeper",
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "players": len(feed),
        "unmatched": unmatched,
    }
    with open(a.data, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"Projected {sum(len(t['roster']) for t in teams)} roster spots from {len(feed)} Sleeper players; "
          f"{len(unmatched)} unmatched: {', '.join(unmatched) or 'none'}")
    for t in teams:
        print(f"  {t['name']}: best lineup {t['best']} (Yahoo {t.get('proj')})")


if __name__ == "__main__":
    main()
