#!/usr/bin/env python3
"""Pull this season's NBA stats and standings from ESPN's public API into celtics/live.json.

Banner 19 (celtics/) uses them three ways: real per-game stats on player cards and the Rotation tab,
a small shooting-form nudge to each player's rating (true shooting vs his 2025-26 mark, faded in by
games played), and GM mode can start the sim from the real standings instead of opening night.

Run by .github/workflows/nba-live.yml every morning during the season, or locally:
  python tools/nba_live_pull.py            current season (2026-27 until next July)
  python tools/nba_live_pull.py 2026       a given season, named by the year it ends (2026 = 2025-26)

Standard library only. If ESPN returns nothing usable, the existing file is left alone.
"""
import json
import os
import re
import sys
import unicodedata
import urllib.request
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "celtics", "live.json")
UA = "davidsolar-banner19/1.0 (+https://davidsolar.dev/celtics/)"
STATS = ("https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete"
         "?region=us&lang=en&contentorigin=espn&isqualified=false&limit=250&page={page}"
         "&sort=general.avgMinutes:desc&season={season}&seasontype=2")
STANDINGS = ["https://site.web.api.espn.com/apis/v2/sports/basketball/nba/standings?region=us&lang=en&contentorigin=espn&season={season}",
             "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season={season}"]
# ESPN abbreviations -> the site's (Basketball Reference style)
TEAM = {"GS": "GSW", "NY": "NYK", "SA": "SAS", "NO": "NOP", "UTAH": "UTA", "WSH": "WAS", "BKN": "BRK", "CHA": "CHO",
        "PHX": "PHO"}


def slug(n):
    n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def season_end_year(today):
    return today.year + 1 if today.month >= 7 else today.year


def pull_players(season):
    out, page, pages = {}, 1, 1
    schema = None
    while page <= pages and page <= 12:
        d = get(STATS.format(page=page, season=season))
        pages = d.get("pagination", {}).get("pages", 1)
        if schema is None:
            schema = {c["name"]: c.get("names", []) for c in d.get("categories", [])}
        for row in d.get("athletes", []):
            a = row.get("athlete", {})
            vals = {}
            for cat in row.get("categories", []):
                names = schema.get(cat.get("name"), [])
                for k, v in zip(names, cat.get("values", [])):
                    vals.setdefault(k, v)          # first occurrence: the per-game version
            gp = int(vals.get("gamesPlayed") or 0)
            if not gp:
                continue
            r1 = lambda k: round(float(vals.get(k) or 0), 1)
            out[slug(a.get("displayName", ""))] = {
                "n": a.get("displayName"), "team": TEAM.get(a.get("teamShortName"), a.get("teamShortName")),
                "gp": gp, "mpg": r1("avgMinutes"), "ppg": r1("avgPoints"), "rpg": r1("avgRebounds"), "apg": r1("avgAssists"),
                "tov": r1("avgTurnovers"), "stl": r1("avgSteals"), "blk": r1("avgBlocks"),
                "fga": r1("avgFieldGoalsAttempted"), "fta": r1("avgFreeThrowsAttempted"), "pts": r1("avgPoints"),
                "tpa": r1("avgThreePointFieldGoalsAttempted"), "tpm": r1("avgThreePointFieldGoalsMade"),
            }
        page += 1
    return out


def pull_standings(season, notes):
    d = None
    for url in STANDINGS:
        try:
            d = get(url.format(season=season))
            if d.get("children"):
                break
            notes.append(f"standings: no conferences from {url.split('/')[2]}")
        except Exception as e:
            notes.append(f"standings: {url.split('/')[2]}: {type(e).__name__}: {e}"[:200])
    out = {}
    if not d:
        return out
    def walk(node):
        for e in node.get("standings", {}).get("entries", []):
            ab = e.get("team", {}).get("abbreviation")
            st = {s.get("name"): s.get("value") for s in e.get("stats", [])}
            if ab:
                out[TEAM.get(ab, ab)] = {"w": int(st.get("wins") or 0), "l": int(st.get("losses") or 0)}
        for ch in node.get("children", []):
            walk(ch)
    walk(d)
    return out


def main():
    season = int(sys.argv[1]) if len(sys.argv) > 1 else season_end_year(date.today())
    name = f"{season - 1}-{str(season)[2:]}"
    notes = []
    players = pull_players(season)
    try:
        standings = pull_standings(season, notes)
    except Exception as e:                          # standings are a bonus; stats still count
        notes.append(f"standings: {type(e).__name__}: {e}"[:200])
        standings = {}
    for n in notes:
        print(n)
    games = sum(v["w"] + v["l"] for v in standings.values()) // 2
    if not players and not standings:
        print(f"No {name} data yet; leaving {OUT} alone.")
        return
    data = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "season": name, "source": "ESPN",
            "games": games, "players": players, "standings": standings}
    if notes:
        data["notes"] = notes
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {OUT}: {name}, {len(players)} players, {len(standings)} teams, {games} games played.")


if __name__ == "__main__":
    main()
