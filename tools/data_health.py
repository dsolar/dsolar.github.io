#!/usr/bin/env python3
"""Daily health check of Draft Lab's data files: is each one fresh, full-sized, and carrying what values need?

Writes fantasy-kit/data/health.json ({"ok", "problems": [...], "files": {name: {players, updated}}}) for the pages, and
exits 1 when anything is wrong so the Fantasy Kit data workflow fails and GitHub emails about it. The data still
commits first: a stale source never blocks the fresh ones.

  python3 tools/data_health.py
"""
import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "fantasy-kit", "data")
NOW = datetime.now(timezone.utc)

# file: (most days old it may be, fewest players, lines it must have)
POOLS = {"nfl.json": (3, 300, ["tot", "proj"]), "nba.json": (3, 400, ["pg", "ppg"]), "mlb.json": (3, 800, ["bat", "pit", "pbat", "ppit"])}
SIDE = {"dynasty-nfl.json": (8, 200), "dynasty-nba.json": (8, 200), "dynasty-mlb.json": (8, 400),
        "market-nfl.json": (3, 300), "market-nba.json": (3, 300), "market-mlb.json": (3, 300)}
# sources inside the market files that should be fresh (ESPN's draft market is only live before a season)
MARKET_SOURCES = {"market-nfl.json": ["fp", "tr"], "market-nba.json": ["fp"], "market-mlb.json": ["fp"]}
BOARDS = {"../../draft/nfl.json": 4, "../../draft/nba.json": 4}


def age_days(stamp):
    try:
        t = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return (NOW - t).total_seconds() / 86400
    except ValueError:
        return None


def load(name):
    try:
        with open(os.path.join(DATA, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def main():
    problems, files = [], {}
    for name, (days, least, lines) in POOLS.items():
        d = load(name)
        if not d:
            problems.append(f"{name} is missing"); continue
        n, a, have = len(d.get("players", [])), age_days(d.get("updated")), list((d.get("lines") or {}).keys())
        files[name] = {"players": n, "updated": d.get("updated"), "lines": have}
        if a is None or a > days:
            problems.append(f"{name} is {a:.1f} days old" if a is not None else f"{name} has no date")
        if n < least:
            problems.append(f"{name} has only {n} players")
        for ln in lines:
            if ln not in have:
                problems.append(f"{name} has no {ln} line")
    for name, (days, least) in SIDE.items():
        d = load(name)
        if not d:
            if name == "market-mlb.json":
                continue                          # baseball's market file waits for the season to open
            problems.append(f"{name} is missing"); continue
        n, a = len(d.get("players", {})), age_days(d.get("updated"))
        files[name] = {"players": n, "updated": d.get("updated")}
        if a is None or a > days:
            problems.append(f"{name} is {a:.1f} days old" if a is not None else f"{name} has no date")
        if n < least:
            problems.append(f"{name} has only {n} players")
        for src in MARKET_SOURCES.get(name, []):
            st = (d.get("status") or {}).get(src)
            if st and not st.get("ok"):
                since = age_days(st.get("at")) if st.get("at") else None
                problems.append(f"{name}: {src} failed" + (f", using numbers {since:.1f} days old" if since is not None else ""))
            files[name][src] = st
    for rel, days in BOARDS.items():
        try:
            with open(os.path.join(DATA, rel), encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            problems.append(f"Big Board {os.path.basename(rel)} is missing"); continue
        a = age_days(d.get("updated") or d.get("asof"))
        files["draft/" + os.path.basename(rel)] = {"players": len(d.get("players", [])), "updated": d.get("updated") or d.get("asof")}
        if a is None or a > days:
            problems.append(f"Big Board {os.path.basename(rel)} is {a:.1f} days old" if a is not None else f"Big Board {os.path.basename(rel)} has no date")
    # no check time in the file, so it only changes (and commits) when the data or a problem does
    out = {"ok": not problems, "problems": problems, "files": files}
    with open(os.path.join(DATA, "health.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("All data files look healthy." if not problems else "Problems:\n  " + "\n  ".join(problems))
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
