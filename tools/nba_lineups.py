#!/usr/bin/env python3
"""NBA Hub lineups: every team's five-man units this season from pbpstats, plus what falls out of them: each
player's on/off (his team per 100 possessions with him on the floor and off it), and the best two- and three-man
combinations. Everything comes from the same possessions, so the numbers agree with each other.

Writes nba/data/lineups.json. The page (nba/app.js) only displays it.

Run: python3 tools/nba_lineups.py
"""
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from itertools import combinations

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "nba", "data", "lineups.json")
UA = "Mozilla/5.0 (compatible; davidsolar-nbahub/1.0; +https://davidsolar.dev/nba/)"
TEAM_IDS = range(1610612737, 1610612767)  # the NBA's 30 team ids
KEEP_MIN = 6        # five-man units shipped to the page: at least this many minutes together
COMBO_MIN = 40      # two- and three-man combinations: at least this many minutes


def get(url, timeout=150, tries=4):
    err = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:  # pbpstats answers 502 now and then
            err = e
            time.sleep(10 * (k + 1))
    raise err


def season_label(now=None):
    now = now or datetime.now(timezone.utc)
    end = now.year + 1 if now.month >= 10 else now.year
    return f"{end - 1}-{str(end)[2:]}"


def team_lineups(season, tid):
    url = f"https://api.pbpstats.com/get-totals/nba?Season={season}&SeasonType=Regular%20Season&Type=Lineup&TeamId={tid}"
    try:
        return tid, get(url).get("multi_row_table_data") or []
    except Exception as e:
        print(f"team {tid}: {type(e).__name__}: {e}", file=sys.stderr)
        return tid, None


def n(x):
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def main():
    season = season_label()
    old, old_names = {}, {}
    try:
        prev = json.load(open(OUT))
        if prev.get("season") == season:
            old, old_names = prev.get("teams") or {}, prev.get("names") or {}
    except (OSError, ValueError):
        pass
    with ThreadPoolExecutor(max_workers=3) as ex:
        got = list(ex.map(lambda t: team_lineups(season, t), TEAM_IDS))
    teams, names, failed = {}, {}, 0
    for tid, rows in got:
        if not rows:
            failed += 1
            continue
        abbr = rows[0].get("TeamAbbreviation") or str(tid)
        units = []
        for r in rows:
            ids = str(r.get("EntityId") or "").split("-")
            nm = [x.strip() for x in str(r.get("Name") or "").split(",")]
            if len(ids) != 5:
                continue
            for i, x in zip(ids, nm):
                names.setdefault(i, x)
            units.append({"ids": ids, "min": n(r.get("Minutes")), "op": n(r.get("OffPoss")), "dp": n(r.get("DefPoss")),
                          "pts": n(r.get("Points")), "opp": n(r.get("OpponentPoints")),
                          "fg3a": n(r.get("FG3A")), "fga": n(r.get("FG2A")) + n(r.get("FG3A")), "rim": n(r.get("AtRimFGA"))})
        tot = {k: sum(u[k] for u in units) for k in ("min", "op", "dp", "pts", "opp")}
        # on/off: every lineup he's in versus every one he isn't
        on = defaultdict(lambda: {"min": 0.0, "op": 0.0, "dp": 0.0, "pts": 0.0, "opp": 0.0})
        for u in units:
            for i in u["ids"]:
                for k in on[i]:
                    on[i][k] += u[k]
        onoff = {}
        for i, a in on.items():
            off = {k: tot[k] - a[k] for k in a}
            rate = lambda d: (100 * d["pts"] / d["op"] if d["op"] else None, 100 * d["opp"] / d["dp"] if d["dp"] else None)
            o_on, d_on = rate(a)
            o_off, d_off = rate(off)
            onoff[i] = [round(a["min"]), round(a["op"] + a["dp"]), r1(o_on), r1(d_on), r1(o_off), r1(d_off), round(off["op"] + off["dp"])]
        # two- and three-man combinations
        combos = {}
        for size in (2, 3):
            agg = defaultdict(lambda: {"min": 0.0, "op": 0.0, "dp": 0.0, "pts": 0.0, "opp": 0.0})
            for u in units:
                for c in combinations(sorted(u["ids"]), size):
                    for k in agg[c]:
                        agg[c][k] += u[k]
            combos[size] = [[list(c), round(a["min"]), round(a["op"]), round(a["dp"]), round(a["pts"]), round(a["opp"])]
                            for c, a in agg.items() if a["min"] >= COMBO_MIN]
        units.sort(key=lambda u: -u["min"])
        teams[abbr] = {
            "id": tid, "tot": [round(tot["min"]), round(tot["op"]), round(tot["dp"]), round(tot["pts"]), round(tot["opp"])],
            "l5": [[u["ids"], round(u["min"], 1), round(u["op"]), round(u["dp"]), round(u["pts"]), round(u["opp"]),
                    round(u["fg3a"] / u["fga"], 3) if u["fga"] else None, round(u["rim"] / u["fga"], 3) if u["fga"] else None] for u in units if u["min"] >= KEEP_MIN],
            "n5": len(units), "onoff": onoff, "l2": combos[2], "l3": combos[3],
        }
    for abbr, t in old.items():  # a team pbpstats didn't answer for keeps yesterday's numbers
        if abbr not in teams:
            teams[abbr] = t
            for i in t.get("onoff", {}):
                names.setdefault(i, old_names.get(i, i))
    if len(teams) < 25:
        sys.exit(f"Only {len(teams)} teams answered; keeping yesterday's lineups")
    doc = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "season": season, "failed": failed,
           "names": names, "teams": teams}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    print(f"Wrote {OUT}: {len(teams)} teams ({failed} failed), {sum(len(t['l5']) for t in teams.values())} five-man units, "
          f"{os.path.getsize(OUT) // 1024} KB")


def r1(x):
    return None if x is None else round(x, 1)


if __name__ == "__main__":
    main()
