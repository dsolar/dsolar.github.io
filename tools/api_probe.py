#!/usr/bin/env python3
"""One-off check of free fantasy data APIs from the Actions runner: does each answer, and what does a row look like.

  python3 tools/api_probe.py
"""
import json
import urllib.request

UA = "Mozilla/5.0 (compatible; davidsolar-draftlab/1.0; +https://davidsolar.dev/fantasy-kit/)"
ESPN_FILTER = json.dumps({"players": {"limit": 3, "sortDraftRanks": {"sortPriority": 100, "sortAsc": True, "value": "STANDARD"}}})
PROBES = [
    ("FantasyCalc redraft", "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=0.5", {}),
    ("FantasyCalc dynasty 10 team PPR", "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=10&ppr=1", {}),
    ("DynastyProcess values", "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-players.csv", {}),
    ("DynastyProcess ids", "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv", {}),
    ("FFC ADP half", "https://fantasyfootballcalculator.com/api/v1/adp/half-ppr?teams=12&year=2026", {}),
    ("FFC ADP dynasty", "https://fantasyfootballcalculator.com/api/v1/adp/dynasty?teams=12&year=2026", {}),
    ("ESPN football players", "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info", {"X-Fantasy-Filter": ESPN_FILTER}),
    ("ESPN basketball players", "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leaguedefaults/1?view=kona_player_info", {"X-Fantasy-Filter": ESPN_FILTER}),
    ("ESPN baseball players", "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026/segments/0/leaguedefaults/1?view=kona_player_info", {"X-Fantasy-Filter": ESPN_FILTER}),
    ("Sleeper trending NFL adds", "https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=5", {}),
    ("Sleeper trending NBA adds", "https://api.sleeper.app/v1/players/nba/trending/add?lookback_hours=24&limit=5", {}),
    ("Sleeper NBA projections", "https://api.sleeper.com/projections/nba/2026?season_type=regular", {}),
    ("FanGraphs Steamer bat", "https://www.fangraphs.com/api/projections?type=steamer&stats=bat&pos=all&team=0&players=0&lg=all", {}),
    ("FanGraphs Steamer pit", "https://www.fangraphs.com/api/projections?type=steamer&stats=pit&pos=all&team=0&players=0&lg=all", {}),
    ("FanGraphs ROS Steamer bat", "https://www.fangraphs.com/api/projections?type=steamerr&stats=bat&pos=all&team=0&players=0&lg=all", {}),
    ("MLB prospects (Stats API draft)", "https://statsapi.mlb.com/api/v1/draft/prospects/2027", {}),
]


def probe(name, url, headers):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json,text/csv,*/*", **headers})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            body = r.read().decode("utf-8", "replace")
            print(f"== {name}: HTTP {r.status}, {len(body):,} bytes, {r.headers.get('content-type')}")
    except Exception as e:
        print(f"== {name}: FAILED {type(e).__name__}: {str(e)[:200]}")
        return
    try:
        d = json.loads(body)
        if isinstance(d, list):
            print(f"   list of {len(d)}; first: {json.dumps(d[0])[:600] if d else ''}")
        else:
            print(f"   keys: {list(d.keys())[:15]}")
            for k in ("players", "data", "rows"):
                if isinstance(d.get(k), list) and d[k]:
                    print(f"   {k}[0]: {json.dumps(d[k][0])[:600]}")
    except ValueError:
        lines = body.splitlines()
        print(f"   {len(lines)} lines; head: {lines[0][:300]}")
        if len(lines) > 1:
            print(f"   row: {lines[1][:300]}")


if __name__ == "__main__":
    for p in PROBES:
        probe(*p)
