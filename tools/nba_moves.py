#!/usr/bin/env python3
"""NBA Hub: when each player joined his current team, from the twice-daily roster feed (hardcap/stats.json).

The trade rules need it: a player acquired in a trade can't be combined with other salaries in another trade for two
months, and a team can't trade for a player it traded away within a year. The feed doesn't say how a player arrived,
so this goes by what it sees: a player who goes straight from one team to another between two snapshots (twelve hours
apart) was traded ("kind": "trade"); one who drops off every roster first and turns up later signed as a free agent
("kind": "sign"). Writes nba/data/moves.json: the last roster snapshot ("FA" for a player on no roster) and every
change in the past 400 days.
"""
import json
import os
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "nba", "data", "moves.json")


def main():
    stats = json.load(open(os.path.join(ROOT, "hardcap", "stats.json")))
    rosters = stats.get("rosters") or {}
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        doc = json.load(open(OUT))
    except (OSError, ValueError):
        doc = {"snap": {}, "moves": []}
    snap, moves = doc.get("snap") or {}, doc.get("moves") or []
    first = not snap
    seen = set()
    for pid, r in rosters.items():
        team = r[0] if isinstance(r, list) and r else None
        seen.add(pid)
        if not team:
            if snap.get(pid) and snap[pid] != "FA":
                snap[pid] = "FA"                       # waived or unsigned: off every roster
            continue
        old = snap.get(pid)
        if old and old != team and not first:
            moves.append({"id": pid, "from": old, "to": team, "date": today, "kind": "sign" if old == "FA" else "trade"})
        snap[pid] = team
    # a player missing from the feed entirely is off every roster too, unless the feed itself came back short
    if len(rosters) >= 400:
        for pid in list(snap):
            if pid not in seen and snap[pid] != "FA":
                snap[pid] = "FA"
    cut = (datetime.now(timezone.utc) - timedelta(days=400)).strftime("%Y-%m-%d")
    moves = [m for m in moves if m["date"] >= cut]
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"updated": today, "snap": snap, "moves": moves}, f, separators=(",", ":"))
    print(f"moves.json: {len(snap)} players, {len(moves)} team changes in the last 400 days")


if __name__ == "__main__":
    main()
