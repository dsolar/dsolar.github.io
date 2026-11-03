#!/usr/bin/env python3
"""One-off look at the fields of the sources Draft Lab pulls (run by the API probe workflow)."""
import json
import urllib.request

UA = "Mozilla/5.0 (compatible; davidsolar-draftlab/1.0; +https://davidsolar.dev/fantasy-kit/)"


def get(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


for stats in ("bat", "pit"):
    rows = get(f"https://www.fangraphs.com/api/projections?type=steamer&stats={stats}&pos=all&team=0&players=0&lg=all")
    print(f"FG {stats}: {len(rows)} rows; keys: {sorted(rows[0].keys())}")
    print("  sample:", {k: rows[0].get(k) for k in ("PlayerName", "playerid", "xMLBAMID", "minpos", "Team", "PA", "IP", "GS", "season", "Season")})
F = json.dumps({"players": {"limit": 600, "sortDraftRanks": {"sortPriority": 100, "sortAsc": True, "value": "PPR"}}})
for game, season in (("ffl", 2026), ("fba", 2027), ("flb", 2026)):
    d = get(f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/{game}/seasons/{season}/segments/0/leaguedefaults/3?view=kona_player_info", {"X-Fantasy-Filter": F})
    ps = d.get("players", [])
    p = ps[0]["player"] if ps else {}
    print(f"ESPN {game}: {len(ps)} players; player keys: {sorted(p.keys())}")
    print("  ranks:", json.dumps(p.get("draftRanksByRankType"))[:400])
    print("  ownership:", json.dumps(p.get("ownership"))[:300])
    print("  sample:", {k: p.get(k) for k in ("fullName", "proTeamId", "defaultPositionId", "id")})
    print("  last ranked:", [x["player"]["draftRanksByRankType"].get("PPR" if game == "ffl" else "STANDARD", {}).get("rank") for x in ps[-3:]])
