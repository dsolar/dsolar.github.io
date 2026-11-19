#!/usr/bin/env python3
"""NBA Hub: when each player joined his current team, from the twice-daily roster feed (hardcap/stats.json).

The trade rules need it: a player acquired in a trade can't be combined with other salaries in another trade for two
months. The feed doesn't say how a player arrived, so any team change counts (a waived player signing somewhere new
shows up the same way). Writes nba/data/moves.json: the last roster snapshot and every change in the past 150 days.
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
    for pid, r in rosters.items():
        team = r[0] if isinstance(r, list) and r else None
        if not team:
            continue
        old = snap.get(pid)
        if old and old != team and not first:
            moves.append({"id": pid, "from": old, "to": team, "date": today})
        snap[pid] = team
    cut = (datetime.now(timezone.utc) - timedelta(days=150)).strftime("%Y-%m-%d")
    moves = [m for m in moves if m["date"] >= cut]
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"updated": today, "snap": snap, "moves": moves}, f, separators=(",", ":"))
    print(f"moves.json: {len(snap)} players, {len(moves)} team changes in the last 150 days")


if __name__ == "__main__":
    main()
