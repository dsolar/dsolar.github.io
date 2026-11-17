#!/usr/bin/env python3
"""One-off: the CBB hub's candidate ESPN feeds from GitHub's runners (team schedules and player season stats).
Writes what each source returns to tools/api_probe_out.json."""
import json
import urllib.request

UA = "Mozilla/5.0 (compatible; davidsolar-cbb/1.0; +https://davidsolar.dev/cbb/)"
out = {}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def shape(x, depth=0):
    if depth > 6: return "..."
    if isinstance(x, dict): return {k: shape(v, depth + 1) for k, v in list(x.items())[:40]}
    if isinstance(x, list): return [f"len {len(x)}", shape(x[0], depth + 1) if x else None]
    return type(x).__name__ if not isinstance(x, (str, int, float)) else (x if len(str(x)) < 60 else str(x)[:60])


def probe(name, url, keep=None):
    try:
        d = json.loads(get(url))
        out[name] = {"ok": True, "url": url, "shape": shape(d)}
        if keep:
            out[name]["sample"] = keep(d)
    except Exception as e:
        out[name] = {"ok": False, "url": url, "error": str(e)[:300]}


Q = "region=us&lang=en&contentorigin=espn"
S = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball"
W = "https://site.web.api.espn.com/apis"
probe("schedule_site", S + "/teams/150/schedule?season=2027", lambda d: {"events": len(d.get("events", [])), "first": (d.get("events") or [None])[0], "last": (d.get("events") or [None])[-1]})
probe("schedule_web", W + "/site/v2/sports/basketball/mens-college-basketball/teams/150/schedule?" + Q + "&season=2027", lambda d: {"events": len(d.get("events", [])), "first": (d.get("events") or [None])[0], "late": (d.get("events") or [None])[-1]})
probe("byathlete", W + "/common/v3/sports/basketball/mens-college-basketball/statistics/byathlete?" + Q + "&isqualified=false&limit=3&page=1&sort=offensive.avgPoints:desc&season=2027&seasontype=2",
      lambda d: {"categories": d.get("categories"), "athletes": d.get("athletes", [])[:2]})
probe("byathlete_big", W + "/common/v3/sports/basketball/mens-college-basketball/statistics/byathlete?" + Q + "&isqualified=false&limit=1000&page=1&sort=offensive.avgPoints:desc&season=2027&seasontype=2",
      lambda d: {"count": len(d.get("athletes", [])), "pagination": d.get("pagination") or d.get("requestedSeason")})
probe("byathlete_group", W + "/common/v3/sports/basketball/mens-college-basketball/statistics/byathlete?" + Q + "&isqualified=false&limit=1000&page=1&sort=offensive.avgPoints:desc&season=2027&seasontype=2&groups=50",
      lambda d: {"count": len(d.get("athletes", [])), "pagination": d.get("pagination")})
probe("athlete_stats", W + "/common/v3/sports/basketball/mens-college-basketball/athletes/5103630/stats?" + Q, lambda d: {k: v for k, v in d.items() if k in ("categories", "filters")})
probe("schedule_web_fiu", W + "/site/v2/sports/basketball/mens-college-basketball/teams/2229/schedule?" + Q + "&season=2027", lambda d: {"events": len(d.get("events", [])), "first": (d.get("events") or [None])[0]})
#probe("team_stats", S + "/teams/150/statistics?season=2027", lambda d: str(d)[:3000])

with open("tools/api_probe_out.json", "w") as f:
    json.dump(out, f, indent=1, default=str)
print(json.dumps({k: (v.get("ok"), v.get("error")) for k, v in out.items()}, indent=1))
