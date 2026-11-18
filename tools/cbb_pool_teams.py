#!/usr/bin/env python3
"""Every Division I team in a few fields, for Draft Lab's March Madness pools (fantasy/pools/).

  python3 tools/cbb_pool_teams.py

Reads the college hub's data (cbb/data/hub.json, cbb/data/extras.json) and writes cbb/data/teams.json:
  { "season": 2027, "updated": "...", "selectionSunday": "2027-03-14",
    "teams": { espnId: { "n": short name, "ab": abbreviation, "logo": url, "c": color, "conf": conference,
                          "bpi": rating (points better than average, neutral floor),
                          "r": [chance to make the field, win in round 1, 2, ... 6] from the hub's season sim } } }
The pools read seeds and games from the server (mm_board); this file only names and rates the teams.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "cbb", "data")


def main():
    with open(os.path.join(DATA, "hub.json"), encoding="utf-8") as f:
        hub = json.load(f)
    try:
        with open(os.path.join(DATA, "extras.json"), encoding="utf-8") as f:
            ex = json.load(f)
    except FileNotFoundError:
        ex = {}
    sim = (ex.get("season") or {}).get("teams") or {}
    out = {}
    for t in hub.get("teams", []):
        tid = str(t.get("id"))
        m = t.get("metrics") or {}
        row = {"n": t.get("short") or t.get("name"), "ab": t.get("abbr"), "logo": t.get("logo"), "c": t.get("color"),
               "conf": t.get("conference")}
        if m.get("bpi") is not None:
            row["bpi"] = round(m["bpi"], 2)
        s = sim.get(tid)
        if s and s.get("r"):
            row["r"] = [round(x, 4) for x in s["r"]]
        out[tid] = row
    doc = {"season": hub.get("season"), "updated": hub.get("updated"),
           "selectionSunday": (ex.get("season") or {}).get("selectionSunday"), "teams": out}
    with open(os.path.join(DATA, "teams.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    print(f"cbb/data/teams.json: {len(out)} teams")


if __name__ == "__main__":
    main()
