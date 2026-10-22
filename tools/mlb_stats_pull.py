#!/usr/bin/env python3
"""Pull MLB season stats (2013 on) from MLB's public Stats API into tools/mlb/.

The Wipe Yoenis record book (yoenis/) uses these to hand out yearly awards: the most valuable
hitter and pitcher, the best value pick and the biggest bust, scored with the league's own
16 categories. Run by .github/workflows/mlb-stats.yml, or locally:

  python tools/mlb_stats_pull.py               every season from 2013 to this year
  python tools/mlb_stats_pull.py 2024 2025     just those seasons

Writes tools/mlb/{year}.json: {"hitting": [...], "pitching": [...]}, one row per player.
Quality starts aren't in the season totals, so they're counted from each starter's game log
(6+ innings, 3 or fewer earned runs). Standard library only.
"""
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date

API = "https://statsapi.mlb.com/api/v1/"
UA = "davidsolar-yoenis/1.0 (+https://davidsolar.dev/yoenis/)"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mlb")

HIT = {"gamesPlayed": "g", "plateAppearances": "pa", "atBats": "ab", "runs": "r", "hits": "h", "homeRuns": "hr",
       "rbi": "rbi", "stolenBases": "sb", "totalBases": "tb", "avg": "avg", "obp": "obp", "slg": "slg", "ops": "ops"}
PIT = {"gamesPlayed": "g", "gamesStarted": "gs", "inningsPitched": "ip", "wins": "w", "losses": "l", "saves": "sv",
       "holds": "hld", "strikeOuts": "k", "era": "era", "whip": "whip", "earnedRuns": "er", "baseOnBalls": "bb",
       "hits": "h", "qualityStarts": "qs"}


def get(path):
    for attempt in range(4):
        try:
            req = urllib.request.Request(API + path, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.load(res)
        except Exception as e:  # network blips: back off and retry
            if attempt == 3:
                raise
            print(f"retry {path}: {e}")
            time.sleep(2 + attempt * 3)


def num(v):
    try:
        return float(v) if isinstance(v, str) and ("." in v or v.startswith("-")) else int(v)
    except (TypeError, ValueError):
        return None


def ip_outs(ip):
    """'6.2' innings -> 20 outs."""
    if ip in (None, ""):
        return 0
    whole, _, part = str(ip).partition(".")
    return int(whole) * 3 + int(part or 0)


def season_rows(year, group, fields):
    data = get(f"stats?stats=season&group={group}&season={year}&sportIds=1&playerPool=ALL&limit=6000&gameType=R")
    rows, keys = [], set()
    for block in data.get("stats", []):
        for sp in block.get("splits", []):
            st = sp.get("stat", {})
            keys.update(st)
            p = sp.get("player", {})
            row = {"id": p.get("id"), "name": p.get("fullName"),
                   "pos": (sp.get("position") or {}).get("abbreviation"),
                   "team": (sp.get("team") or {}).get("abbreviation") or (sp.get("team") or {}).get("name")}
            for k, short in fields.items():
                if k in st:
                    row[short] = num(st[k])
            rows.append(row)
    return rows, keys


def quality_starts(pid, year):
    data = get(f"people/{pid}/stats?stats=gameLog&group=pitching&season={year}&gameType=R")
    qs = 0
    for block in data.get("stats", []):
        for sp in block.get("splits", []):
            st = sp.get("stat", {})
            if int(st.get("gamesStarted", 0) or 0) and ip_outs(st.get("inningsPitched")) >= 18 and int(st.get("earnedRuns", 99)) <= 3:
                qs += 1
    return qs


def pull(year):
    hitting, _ = season_rows(year, "hitting", HIT)
    pitching, pkeys = season_rows(year, "pitching", PIT)
    if "qualityStarts" not in pkeys:
        starters = [r for r in pitching if (r.get("gs") or 0) > 0]
        with ThreadPoolExecutor(max_workers=8) as pool:
            for r, qs in zip(starters, pool.map(lambda r: quality_starts(r["id"], year), starters)):
                r["qs"] = qs
        for r in pitching:
            r.setdefault("qs", 0)
    # A season's player counts only grow, so an empty or much smaller answer is a bad pull: keep the file we have.
    path = os.path.join(OUT, f"{year}.json")
    try:
        old = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        old = {}
    for group, rows in (("hitting", hitting), ("pitching", pitching)):
        if not rows or len(rows) < len(old.get(group, [])) / 2:
            print(f"::warning::{year}: MLB returned {len(rows)} {group} rows (had {len(old.get(group, []))}); keeping {path}.")
            return
    os.makedirs(OUT, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"season": year, "source": "MLB Stats API (statsapi.mlb.com)",
                   "qs_from_game_logs": "qualityStarts" not in pkeys,
                   "hitting": hitting, "pitching": pitching}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{year}: {len(hitting)} hitters, {len(pitching)} pitchers"
          + (" (quality starts from game logs)" if "qualityStarts" not in pkeys else ""))


def main():
    years = [int(a) for a in sys.argv[1:]] or list(range(2013, date.today().year + 1))
    for y in years:
        pull(y)


if __name__ == "__main__":
    main()
