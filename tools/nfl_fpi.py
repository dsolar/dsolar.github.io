#!/usr/bin/env python3
"""ESPN's Football Power Index for the NFL Hub, into nfl/data/fpi.json, beside the hub's own power ratings.

  {season, updated (ESPN's), pulled, teams: {CODE: {fpi, rank, off, def, st, sor, sos, gc, projW, projL, playoffs, div, sb}}}

fpi: points better than an average team on a neutral field; off, def, st: its parts. sor: Strength of Record rank,
sos: schedule-faced rank, gc: game-control rank. projW, projL, playoffs, div, sb: ESPN's season projection (percents).
A failed or partial pull keeps the last file.
"""
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "nfl" / "data" / "fpi.json"
FIX = {"WSH": "WAS", "JAC": "JAX", "LA": "LAR"}


def num(v):
    try:
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def main():
    season = int(json.loads((ROOT / "nfl" / "data" / "league.json").read_text())["season"])
    url = f"https://site.web.api.espn.com/apis/fitt/v3/sports/football/nfl/powerindex?region=us&lang=en&limit=40&season={season}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (davidsolar.dev NFL Hub)"})
        with urllib.request.urlopen(req, timeout=40) as r:
            d = json.loads(r.read())
    except Exception as e:
        print(f"FPI: {e}; keeping the last file", file=sys.stderr)
        return
    if (d.get("requestedSeason") or {}).get("year") not in (None, season):
        print("FPI: season mismatch; keeping the last file", file=sys.stderr)
        return
    cols = {c["name"]: c.get("names", []) for c in d.get("categories", [])}
    teams = {}
    for row in d.get("teams", []):
        t = row.get("team") or {}
        code = FIX.get(t.get("abbreviation"), t.get("abbreviation"))
        v = {}
        for cat in row.get("categories", []):
            v.update(dict(zip(cols.get(cat.get("name"), []), cat.get("values", []))))
        if not code or num(v.get("fpi")) is None:
            continue
        r = lambda k, n=1: round(num(v.get(k)), n) if num(v.get(k)) is not None else None
        i = lambda k: int(num(v.get(k))) if num(v.get(k)) else None
        teams[code] = {"fpi": r("fpi"), "rank": i("fpirank"), "off": r("epaoffense"), "def": r("epadefense"), "st": r("epaspecialteams"),
                       "sor": i("accomplishmentrank"), "sos": i("avgsosrank"), "gc": i("gamecontrolrank"), "projW": r("projectedw"), "projL": r("projectedl"),
                       "playoffs": r("probmakeplayoffs"), "div": r("probwindiv"), "sb": r("probwintitle")}
    if len(teams) < 32:
        print(f"FPI: only {len(teams)} teams; keeping the last file", file=sys.stderr)
        return
    OUT.write_text(json.dumps({"season": season, "updated": d.get("lastUpdated"), "pulled": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "teams": teams}, separators=(",", ":")) + "\n")
    print(f"FPI: {len(teams)} teams, ESPN updated {d.get('lastUpdated')}")


if __name__ == "__main__":
    main()
