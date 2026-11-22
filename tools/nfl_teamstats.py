#!/usr/bin/env python3
"""Team offense and defense for the NFL Hub's game previews, from nflverse's play-by-play, into nfl/data/teamstats.json.

Per team, this season's regular season, for its offense and for what its defense allowed:
  epa   EPA per play (passes, sacks and scrambles count as dropbacks; runs as rushes)
  sr    success rate: the share of plays with positive EPA
  pass  EPA per dropback          rush  EPA per designed run
  xpl   explosive-play rate: passes of 20+ yards and runs of 10+
  sack  sack rate per dropback    rz    touchdowns per red-zone trip (drives that reached the opponent's 20)
  to    turnovers per game (interceptions plus lost fumbles)   3d   third-down conversion rate
EPA, success, pass, rush and explosive rate leave out garbage time (win probability under 5% or over 95%), the
usual convention; red zone, turnovers, sacks and third downs count every snap.

Usage: python3 tools/nfl_teamstats.py [season] [--file PATH]   (a local parquet file is for testing)
"""
import io
import json
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "nfl" / "data" / "teamstats.json"
BASE = "https://github.com/nflverse/nflverse-data/releases/download/"
UA = "davidsolar-nflhub/1.0 (+https://davidsolar.dev/nfl/)"
FIX = {"LA": "LAR", "WSH": "WAS", "JAC": "JAX", "OAK": "LV", "SD": "LAC", "STL": "LAR"}
COLS = ["game_id", "week", "season_type", "posteam", "defteam", "play_type", "epa", "success", "pass", "rush", "sack",
        "interception", "fumble_lost", "yards_gained", "yardline_100", "touchdown", "td_team", "fixed_drive", "wp",
        "down", "third_down_converted", "third_down_failed", "qb_dropback"]

args = [a for a in sys.argv[1:] if not a.startswith("--")]
SEASON = int(args[0]) if args else 2026
FILE = sys.argv[sys.argv.index("--file") + 1] if "--file" in sys.argv else None


def load():
    if FILE:
        return pq.read_table(FILE, columns=COLS).to_pylist()
    req = urllib.request.Request(BASE + f"pbp/play_by_play_{SEASON}.parquet", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        return pq.read_table(io.BytesIO(r.read()), columns=COLS).to_pylist()


def main():
    rows = [r for r in load() if r["season_type"] == "REG" and r["posteam"] and r["defteam"]]
    t = lambda c: FIX.get(c, c)
    acc = defaultdict(lambda: defaultdict(float))     # (team, "off"|"def") -> sums
    games = defaultdict(set); drives = {}
    week = 0
    for r in rows:
        o, d = t(r["posteam"]), t(r["defteam"])
        week = max(week, r["week"] or 0)
        games[o].add(r["game_id"]); games[d].add(r["game_id"])
        for side, team in (("off", o), ("def", d)):
            a = acc[(team, side)]
            a["int"] += r["interception"] or 0; a["fum"] += r["fumble_lost"] or 0
            if r["qb_dropback"] == 1:
                a["db"] += 1; a["sk"] += r["sack"] or 0
            if r["down"] == 3 and (r["third_down_converted"] or r["third_down_failed"]):
                a["3a"] += 1; a["3c"] += r["third_down_converted"] or 0
        # drives that reached the red zone, and whether they scored a touchdown
        if r["fixed_drive"] is not None and r["yardline_100"] is not None:
            k = (r["game_id"], r["fixed_drive"], o)
            dr = drives.setdefault(k, {"d": d, "rz": False, "td": False})
            if r["yardline_100"] <= 20: dr["rz"] = True
            if r["touchdown"] == 1 and r["td_team"] and t(r["td_team"]) == o: dr["td"] = True
        # efficiency, without garbage time
        if r["epa"] is None or r["play_type"] not in ("pass", "run") or r["wp"] is None or not (0.05 <= r["wp"] <= 0.95):
            continue
        is_pass = r["pass"] == 1
        big = (r["yards_gained"] or 0) >= (20 if is_pass else 10)
        for side, team in (("off", o), ("def", d)):
            a = acc[(team, side)]
            a["n"] += 1; a["epa"] += r["epa"]; a["sr"] += 1 if r["epa"] > 0 else 0; a["xpl"] += 1 if big else 0
            if is_pass: a["pn"] += 1; a["pepa"] += r["epa"]
            elif r["rush"] == 1: a["rn"] += 1; a["repa"] += r["epa"]
    for (g, dv, o), dr in drives.items():
        if dr["rz"]:
            for side, team in (("off", o), ("def", dr["d"])):
                acc[(team, side)]["rzn"] += 1; acc[(team, side)]["rztd"] += 1 if dr["td"] else 0
    div = lambda a, b: round(a / b, 4) if b else None
    teams = {}
    for team in sorted({k[0] for k in acc}):
        out = {"g": len(games[team])}
        for side in ("off", "def"):
            a = acc[(team, side)]
            out[side] = {"epa": div(a["epa"], a["n"]), "sr": div(a["sr"], a["n"]), "pass": div(a["pepa"], a["pn"]), "rush": div(a["repa"], a["rn"]),
                         "xpl": div(a["xpl"], a["n"]), "sack": div(a["sk"], a["db"]), "rz": div(a["rztd"], a["rzn"]),
                         "to": div(a["int"] + a["fum"], len(games[team])), "3d": div(a["3c"], a["3a"]), "plays": int(a["n"])}
        teams[team] = out
    if len(teams) < 32:
        sys.exit("only %d teams in the play-by-play" % len(teams))
    body = {"season": SEASON, "week": week, "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
            "src": "nflverse play-by-play (EPA from nflfastR)", "teams": teams}
    OUT.write_text(json.dumps(body, separators=(",", ":")))
    print("teams", len(teams), "through week", week, "| KC", json.dumps(teams.get("KC"))[:300])


if __name__ == "__main__":
    main()
