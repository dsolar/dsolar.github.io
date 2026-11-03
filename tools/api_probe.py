#!/usr/bin/env python3
"""One-off look at in-season ranking sources (run by the API probe workflow)."""
import json
import re
import urllib.request

UA = "Mozilla/5.0 (compatible; davidsolar-draftlab/1.0; +https://davidsolar.dev/fantasy-kit/)"


def fetch(url, headers=None, accept="text/html"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept, **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def ecr(page):
    try:
        html = fetch("https://www.fantasypros.com/" + page)
    except Exception as e:
        return f"FAILED {e}"
    m = re.search(r"ecrData\s*=\s*(\{.*?\});", html, re.S)
    if not m:
        return "no ecrData"
    d = json.loads(m.group(1))
    ps = d.get("players", [])
    hub = [(p.get("player_name"), p.get("rank_ecr")) for p in ps if "Hubbard" in str(p.get("player_name"))]
    return f"{len(ps)} players; keys {sorted(ps[0].keys())[:40] if ps else ''}; top {[p.get('player_name') for p in ps[:3]]}; Hubbard {hub}; meta {{k: d.get(k) for k in ('ranking_type_name','scoring','last_updated','total_experts','week')}}"


for page in ["nfl/rankings/ros-half-point-ppr-overall.php", "nfl/rankings/ros-ppr-overall.php", "nfl/rankings/ros-overall.php",
             "nfl/rankings/half-point-ppr-cheatsheets.php", "nba/rankings/ros-overall.php", "nba/rankings/overall.php", "mlb/rankings/ros-overall.php", "mlb/rankings/overall.php"]:
    print("FP", page, "->", ecr(page))

rows = json.loads(fetch("https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=0.5", accept="application/json"))
rows.sort(key=lambda r: -r.get("value", 0))
print("FC redraft:", len(rows), [(i + 1, r["player"]["name"]) for i, r in enumerate(rows) if "Hubbard" in r["player"]["name"]], [r["player"]["name"] for r in rows[:5]])

F = json.dumps({"players": {"filterName": {"value": "Chuba Hubbard"}, "limit": 5}})
d = json.loads(fetch("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info", {"X-Fantasy-Filter": F}, "application/json"))
for x in d.get("players", []):
    pl = x["player"]
    print("ESPN", pl.get("fullName"), "rankings:", json.dumps(pl.get("rankings"))[:1500])
