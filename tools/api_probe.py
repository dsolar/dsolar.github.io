#!/usr/bin/env python3
"""One-off: the CFB hub's candidate ESPN feeds from GitHub's runners (FPI, scoreboard by week, polls, standings,
schedules, rosters and player stats). Writes what each source returns to tools/api_probe_out.json."""
import json
import urllib.request

UA = "Mozilla/5.0 (compatible; davidsolar-cfb/1.0; +https://davidsolar.dev/cfb/)"
out = {}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def shape(x, depth=0):
    if depth > 7: return "..."
    if isinstance(x, dict): return {k: shape(v, depth + 1) for k, v in list(x.items())[:45]}
    if isinstance(x, list): return [f"len {len(x)}", shape(x[0], depth + 1) if x else None]
    return type(x).__name__ if not isinstance(x, (str, int, float)) else (x if len(str(x)) < 70 else str(x)[:70])


def probe(name, url, keep=None):
    try:
        d = json.loads(get(url))
        out[name] = {"ok": True, "url": url, "shape": shape(d)}
        if keep:
            out[name]["sample"] = keep(d)
    except Exception as e:
        out[name] = {"ok": False, "url": url, "error": str(e)[:300]}


Q = "region=us&lang=en&contentorigin=espn"
W = "https://site.web.api.espn.com/apis"
S = W + "/site/v2/sports/football/college-football"
B = W + "/common/v3/sports/football/college-football/statistics/byathlete?" + Q + "&season=2026&seasontype=2"
k = lambda d: {"categories": [(c.get("name"), c.get("names")) for c in d.get("categories", [])], "pagination": d.get("pagination"), "count": len(d.get("athletes", [])), "athlete": d.get("athletes", [])[:1]}
probe("ba_offpass", B + "&isqualified=false&limit=1000&page=1&category=offense:passing&sort=passing.passingYards:desc", k)
probe("ba_offpass_g", B + "&isqualified=false&limit=1000&page=1&category=offense:passing&sort=passing.passingYards:desc&conference=80", k)
probe("ba_plain", B + "&isqualified=false&limit=1000&page=1&sort=passing.passingYards:desc", k)
probe("ba_rush", B + "&isqualified=false&limit=1000&page=1&category=offense:rushing&sort=rushing.rushingYards:desc", k)
probe("ba_def", B + "&isqualified=false&limit=1000&page=1&category=defense&sort=defensive.totalTackles:desc", k)
probe("ba_q", B + "&isqualified=true&limit=50&page=1&category=offense:passing&sort=passing.passingYards:desc", k)
probe("rank_wk", S + "/rankings?" + Q + "&season=2026&seasontype=2&week=12", lambda d: [(r.get("name"), r.get("type"), len(r.get("ranks", []))) for r in d.get("rankings", [])])
probe("post", S + "/scoreboard?" + Q + "&groups=80&limit=1000&seasontype=3&week=1&dates=2025", lambda d: {"count": len(d.get("events", [])), "names": [(e.get("name"), (e.get("competitions") or [{}])[0].get("notes")) for e in d.get("events", [])[:50]]})

with open("tools/api_probe_out.json", "w") as f:
    json.dump(out, f, indent=1, default=str)
