#!/usr/bin/env python3
"""ESPN's NBA Basketball Power Index for the NBA Hub, into nba/data/bpi.json, beside the hub's own projections.

  {season, updated (ESPN's), pulled, teams: {CODE: {bpi, rank, off, def, pbpi, projW, projL, playoffs, playin, top6,
   div, title, no1}}}

bpi: points per game better than an average team on a neutral court; off, def: its parts; pbpi: the playoff version
(stars' minutes weighted up). projW, projL and the rest: ESPN's season projection, in percents. Codes are the hub's
(BRK, CHO, PHO). A failed or partial pull keeps the last file.
"""
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "nba" / "data" / "bpi.json"
FIX = {"SA": "SAS", "GS": "GSW", "NY": "NYK", "NO": "NOP", "UTAH": "UTA", "WSH": "WAS", "BKN": "BRK", "PHX": "PHO", "CHA": "CHO"}
URL = "https://site.web.api.espn.com/apis/fitt/v3/sports/basketball/nba/powerindex?region=us&lang=en&limit=40"


def num(v):
    try:
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def main():
    codes = set(json.loads((ROOT / "celtics" / "data.json").read_text())["teams"])
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (davidsolar.dev NBA Hub)"})
        with urllib.request.urlopen(req, timeout=40) as r:
            d = json.loads(r.read())
    except Exception as e:
        print(f"BPI: {e}; keeping the last file", file=sys.stderr)
        return
    cols = {c["name"]: c.get("names", []) for c in d.get("categories", [])}
    teams = {}
    for row in d.get("teams", []):
        t = row.get("team") or {}
        code = FIX.get(t.get("abbreviation"), t.get("abbreviation"))
        v = {}
        for cat in row.get("categories", []):
            for k, x in zip(cols.get(cat.get("name"), []), cat.get("values", [])):
                v.setdefault(k, x)
        if code not in codes or num(v.get("bpi")) is None:
            continue
        r = lambda k, n=1: round(num(v.get(k)), n) if num(v.get(k)) is not None else None
        teams[code] = {"bpi": r("bpi"), "rank": int(num(v.get("bpirank")) or 0) or None, "off": r("bpioffense"), "def": r("bpidefense"), "pbpi": r("playoffbpi"),
                       "projW": r("projectedw"), "projL": r("projectedl"), "playoffs": r("probmakeplayoffs"), "playin": r("playinchance"), "top6": r("top6seed"),
                       "div": r("probwindiv"), "title": r("probwintitle"), "no1": r("probno1draftpick")}
    if len(teams) < 30:
        print(f"BPI: only {len(teams)} teams ({sorted(codes - set(teams))} missing); keeping the last file", file=sys.stderr)
        return
    season = (d.get("requestedSeason") or d.get("currentSeason") or {}).get("year")
    OUT.write_text(json.dumps({"season": season, "updated": d.get("lastUpdated"), "pulled": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "teams": teams}, separators=(",", ":")) + "\n")
    print(f"BPI: {len(teams)} teams, ESPN updated {d.get('lastUpdated')}")


if __name__ == "__main__":
    main()
