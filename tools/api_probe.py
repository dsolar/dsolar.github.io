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
k = lambda d: {"count": len(d.get("events", [])), "pairs": [e.get("shortName") for e in d.get("events", [])][:80], "odds": sum(1 for e in d.get("events", []) if (e.get("competitions") or [{}])[0].get("odds"))}
probe("sb_web_900", S + "/scoreboard?" + Q + "&groups=80&limit=900&week=12&seasontype=2&dates=2026", k)
probe("sb_site", "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=900&week=12&seasontype=2&dates=2026", k)
probe("sb_range", "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=900&dates=20261117-20261123", k)
probe("sb_post", "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=900&seasontype=3&dates=2026", k)
probe("sb_post_range", "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=900&dates=20261205-20270131", k)
probe("sched_web", S + "/teams/87/schedule?" + Q + "&season=2026", lambda d: {"n": len(d.get("events", [])), "last": (d.get("events") or [None])[-1]})
probe("sched_post", S + "/teams/61/schedule?" + Q + "&season=2026&seasontype=3", lambda d: {"n": len(d.get("events", []))})
probe("standings_full", W + "/v2/sports/football/college-football/standings?" + Q + "&group=80&season=2026&level=3",
      lambda d: [{"name": c.get("abbreviation") or c.get("name"), "id": c.get("id"), "kids": [(k.get("name"), len((k.get("standings") or {}).get("entries", []))) for k in c.get("children", [])], "n": len((c.get("standings") or {}).get("entries", [])), "stats": [s.get("name") for s in (((c.get("standings") or {}).get("entries") or [{}])[0].get("stats") or [])]} for c in d.get("children", [])])

with open("tools/api_probe_out.json", "w") as f:
    json.dump(out, f, indent=1, default=str)
