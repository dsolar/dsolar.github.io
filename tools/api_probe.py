#!/usr/bin/env python3
"""One-off: which ESPN feeds answer from GitHub's runners, and is ESPN's NBA Net Points metric (Dean Oliver's) in any
of them? Also ESPN's NFL FPI. Writes tools/api_probe_out.json: each URL's status, top-level keys, a short sample,
and any place the text mentions net points."""
import json
import re
import urllib.request

W = "https://site.web.api.espn.com/apis"
C = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba"
URLS = [
    ("nfl_fpi", f"{W}/fitt/v3/sports/football/nfl/powerindex?region=us&lang=en&limit=40&season=2026"),
    ("nfl_fpi_plain", f"{W}/fitt/v3/sports/football/nfl/powerindex"),
    ("nba_powerindex", f"{W}/fitt/v3/sports/basketball/nba/powerindex?region=us&lang=en&limit=40"),
    ("nba_byathlete_general", f"{W}/common/v3/sports/basketball/nba/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=true&limit=5&category=general&sort=general.avgPoints:desc"),
    ("nba_byathlete_netpoints", f"{W}/common/v3/sports/basketball/nba/statistics/byathlete?region=us&lang=en&contentorigin=espn&limit=5&category=netpoints"),
    ("nba_byathlete_advanced", f"{W}/common/v3/sports/basketball/nba/statistics/byathlete?region=us&lang=en&contentorigin=espn&limit=5&category=advanced"),
    ("nba_athlete_stats_jokic", f"{W}/common/v3/sports/basketball/nba/athletes/3112335/stats?region=us&lang=en"),
    ("nba_athlete_overview_jokic", f"{W}/common/v3/sports/basketball/nba/athletes/3112335/overview?region=us&lang=en"),
    ("nba_core_stats_jokic", f"{C}/seasons/2027/types/2/athletes/3112335/statistics"),
    ("nba_core_leaders", f"{C}/seasons/2027/types/2/leaders?limit=3"),
    ("nba_summary_game", f"{W}/site/v2/sports/basketball/nba/summary?event=401810100"),
    ("nba_stats_page", "https://www.espn.com/nba/stats/player/_/view/netpoints"),
]
HIT = re.compile(r"net ?points|netpoints|netPts|net_points", re.I)


def sample(x, depth=0):
    """A small outline of a JSON value: keys and the first items, a few levels deep."""
    if depth > 3:
        return "…"
    if isinstance(x, dict):
        return {k: sample(v, depth + 1) for k, v in list(x.items())[:14]}
    if isinstance(x, list):
        return [sample(v, depth + 1) for v in x[:2]] + ([f"…{len(x)} items"] if len(x) > 2 else [])
    return x if not isinstance(x, str) else x[:80]


out = {}
for name, url in URLS:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (davidsolar.dev probe)", "Accept": "application/json,text/html"})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
            rec = {"status": r.status, "bytes": len(body)}
        hits = [body[max(0, m.start() - 120):m.end() + 160] for m in HIT.finditer(body)][:6]
        if hits:
            rec["netPointsMentions"] = hits
        try:
            j = json.loads(body)
            rec["keys"] = list(j.keys())[:30] if isinstance(j, dict) else f"list of {len(j)}"
            rec["sample"] = sample(j)
        except ValueError:
            rec["text"] = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body))[:600]
        out[name] = rec
    except Exception as e:
        out[name] = {"error": str(e)[:200]}
with open("tools/api_probe_out.json", "w") as f:
    json.dump(out, f, indent=1)
