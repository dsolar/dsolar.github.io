#!/usr/bin/env python3
"""Build mlb/data/parks.json: each park's real outline (fence, warning track, infield, foul lines) in feet, for the
MLB hub's team pages.

  python tools/mlb_parks_build.py path/to/mlb_stadia_paths.csv

Source: GeomMLBStadiums by Ben Dilday (MIT license, github.com/bdilday/GeomMLBStadiums), traced from MLB Gameday's
field diagrams (last updated 2023, so a fence moved since then won't show). Home plate is where the foul lines meet;
the drawing is turned so the foul lines open evenly about center field, and scaled at 2.396 feet per Gameday unit,
the value that best fits published foul-pole and center-field distances. The A's (in Sacramento from 2025) aren't in
the source, so the page draws their park from published distances instead. Standard library only.
"""
import csv
import json
import math
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "mlb", "data", "parks.json")
SCALE = 2.396
TEAMS = {"angels": "LAA", "astros": "HOU", "blue_jays": "TOR", "braves": "ATL", "brewers": "MIL", "cardinals": "STL",
         "cubs": "CHC", "diamondbacks": "ARI", "dodgers": "LAD", "giants": "SF", "guardians": "CLE", "mariners": "SEA",
         "marlins": "MIA", "mets": "NYM", "nationals": "WSH", "orioles": "BAL", "padres": "SD", "phillies": "PHI",
         "pirates": "PIT", "rangers": "TEX", "rays": "TB", "red_sox": "BOS", "reds": "CIN", "rockies": "COL",
         "royals": "KC", "tigers": "DET", "twins": "MIN", "white_sox": "CWS", "yankees": "NYY"}
KEEP = {"outfield_outer": 1, "outfield_inner": 2, "infield_outer": 2, "infield_inner": 2, "foul_lines": 4}


def main(src):
    by = defaultdict(lambda: defaultdict(list))
    with open(src, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            by[r["team"]][r["segment"]].append((float(r["x"]), float(r["y"])))
    out = {"source": "GeomMLBStadiums (Ben Dilday, MIT), traced from MLB Gameday field diagrams, 2023", "parks": {}}
    for name, abbr in TEAMS.items():
        seg = by.get(name)
        if not seg:
            continue
        fl = seg["foul_lines"]
        home = max(fl, key=lambda p: p[1])
        far = lambda pts: max(pts, key=lambda p: math.hypot(p[0] - home[0], p[1] - home[1]))
        lf = far([p for p in fl if p[0] < home[0] - 1])
        rf = far([p for p in fl if p[0] > home[0] + 1])
        a_lf = math.atan2(lf[0] - home[0], home[1] - lf[1])
        a_rf = math.atan2(rf[0] - home[0], home[1] - rf[1])
        rot = -(a_lf + a_rf) / 2
        c, s = math.cos(rot), math.sin(rot)

        def feet(p):  # x to the right of home, y out toward center, both in feet
            x, y = (p[0] - home[0]) * SCALE, (home[1] - p[1]) * SCALE
            return [round(x * c - y * s, 1), round(x * s + y * c, 1)]
        park = {}
        for k, step in KEEP.items():
            pts = seg.get(k) or []
            park[k] = [feet(p) for i, p in enumerate(pts) if i % step == 0 or i == len(pts) - 1]
        out["parks"][abbr] = park
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {OUT} ({os.path.getsize(OUT) // 1024} KB, {len(out['parks'])} parks)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "mlb_stadia_paths.csv")
