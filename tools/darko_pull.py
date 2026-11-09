#!/usr/bin/env python3
"""DARKO's daily player ratings (DPM) from darko.app into nba/data/darko.json for the NBA Hub.

DARKO is Kostya Medvedovsky and Andrew Patton's daily plus-minus model. darko.app publishes no terms of use and
no robots.txt, and its About page says every board has a CSV download. The leaderboard's "Download CSV" button
builds the file in the browser from the route's SvelteKit data file, /__data.json, so that's what this reads.

That file is devalue-serialized: nodes[i].data is a flat list where index 0 is the root and objects and arrays
hold indices into the same list (negative indices are specials: undefined, NaN, Infinity...). The leaderboard
node's root has "players", stored as columns ({keys: [...], values: [[...], ...]}) since October 2026 and as a
list of row objects before that. Both layouts are read.

If the site changes shape or can't be reached, the script exits non-zero and leaves the last good file alone.
Usage: python3 tools/darko_pull.py [saved __data.json]   (a saved file is for testing offline)
"""

import json
import math
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "nba" / "data" / "darko.json"
SRC = ROOT / "src" / "31st-franchise"  # the June 3, 2026 snapshot the ratings were built on
URL = "https://www.darko.app/__data.json"
UA = "davidsolar-nbahub/1.0 (+https://davidsolar.dev/nba/)"
SPECIALS = {-1: None, -2: None, -3: math.nan, -4: math.inf, -5: -math.inf, -6: -0.0}


def val(data, i):
    return SPECIALS.get(i) if i < 0 else data[i]


def rows_of(payload):
    """The leaderboard's players as dicts, plus the root (asOf, ratingsThrough)."""
    for node in payload.get("nodes") or []:
        if not isinstance(node, dict) or node.get("type") != "data":
            continue
        data = node["data"]
        root = data[0]
        if not isinstance(root, dict) or "players" not in root:
            continue
        players = data[root["players"]]
        if isinstance(players, dict) and "keys" in players and "values" in players:
            names = [data[i] for i in data[players["keys"]]]
            cols = [[val(data, j) for j in data[c]] for c in data[players["values"]]]
            if len(names) != len(cols) or len({len(c) for c in cols}) > 1:
                raise ValueError("columns don't line up")
            rows = [dict(zip(names, vals)) for vals in zip(*cols)]
        else:
            rows = [{k: val(data, j) for k, j in data[i].items()} for i in players]
        meta = {k: val(data, root[k]) for k in ("asOf", "ratingsThrough") if k in root}
        return rows, meta
    raise ValueError("no leaderboard node in the payload")


def num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def june():
    """The June 3 numbers the cap sheet's ratings already carry (50% of each blend), by name."""
    out = {}
    for f, cols in (("darko_team.txt", 5), ("darko_lb.txt", 4)):
        p = SRC / f
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            parts = line.strip().split("|")
            if len(parts) != cols:
                continue
            n, o, d = parts[-4], parts[-3], parts[-2]
            out[n] = [float(o), float(d)]
    return out


def main():
    if len(sys.argv) > 1:
        payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    else:
        req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=40) as r:
            payload = json.loads(r.read().decode("utf-8"))
    rows, meta = rows_of(payload)
    players = []
    for r in rows:
        name, o, d = r.get("player_name"), r.get("o_dpm"), r.get("d_dpm")
        if not name or not num(o) or not num(d):
            continue
        xm = r.get("x_minutes")
        players.append([name, r.get("nba_id"), round(o, 2), round(d, 2),
                        round(xm, 1) if num(xm) else None, r.get("season_games")])
    if len(players) < 300:  # a full board is ~500; fewer means the payload changed under us
        raise SystemExit(f"only {len(players)} players decoded; keeping the last file")
    players.sort(key=lambda p: -(p[2] + p[3]))
    out = {
        "src": "darko.app (Kostya Medvedovsky & Andrew Patton)",
        "pulled": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "asOf": meta.get("asOf"),
        "through": meta.get("ratingsThrough"),
        "cols": ["name", "nba_id", "o", "d", "x_min", "games"],
        "p": players,
        "june": june(),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"DARKO: {len(players)} players, ratings through {out['through']}; top: "
          + ", ".join(f"{p[0]} {p[2] + p[3]:+.1f}" for p in players[:5]))


if __name__ == "__main__":
    main()
