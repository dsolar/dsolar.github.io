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
probe("fpi", W + "/fitt/v3/sports/football/college-football/powerindex?" + Q + "&limit=1000&season=2026&group=80",
      lambda d: {"categories": d.get("categories"), "count": len(d.get("teams", [])), "first": (d.get("teams") or [None])[0], "updated": d.get("lastUpdated")})
probe("scoreboard", S + "/scoreboard?" + Q + "&groups=80&limit=1000",
      lambda d: {"week": d.get("week"), "season": d.get("season"), "count": len(d.get("events", [])), "calendar": (d.get("leagues") or [{}])[0].get("calendar"), "first": (d.get("events") or [None])[0]})
probe("scoreboard_wk3", S + "/scoreboard?" + Q + "&groups=80&limit=1000&week=3&seasontype=2&dates=2026",
      lambda d: {"count": len(d.get("events", [])), "one": (d.get("events") or [None])[0]})
probe("rankings", S + "/rankings?" + Q,
      lambda d: [{"name": r.get("name"), "type": r.get("type"), "date": r.get("date"), "headline": r.get("headline"), "n": len(r.get("ranks", [])), "top": r.get("ranks", [])[:2]} for r in d.get("rankings", [])])
probe("standings", W + "/v2/sports/football/college-football/standings?" + Q + "&group=80&season=2026&level=3",
      lambda d: str(d)[:4000])
probe("schedule", S + "/teams/194/schedule?" + Q + "&season=2026", lambda d: {"events": len(d.get("events", [])), "first": (d.get("events") or [None])[0]})
probe("roster", W + "/common/v3/sports/football/college-football/teams/194/roster?" + Q + "&season=2026",
      lambda d: {"keys": list(d.keys()), "groups": [(g.get("position"), len(g.get("athletes", []))) for g in d.get("positionGroups", [])], "one": ((d.get("positionGroups") or [{}])[0].get("athletes") or [None])[0], "coach": d.get("coach")})
probe("byathlete_pass", W + "/common/v3/sports/football/college-football/statistics/byathlete?" + Q + "&isqualified=false&limit=1000&page=1&category=passing&sort=passing.passingYards:desc&season=2026&seasontype=2&groups=80",
      lambda d: {"categories": d.get("categories"), "pagination": d.get("pagination"), "count": len(d.get("athletes", [])), "athletes": d.get("athletes", [])[:2]})
probe("byathlete_def", W + "/common/v3/sports/football/college-football/statistics/byathlete?" + Q + "&isqualified=false&limit=1000&page=1&category=defensive&sort=defensive.totalTackles:desc&season=2026&seasontype=2&groups=80",
      lambda d: {"categories": [c.get("name") for c in d.get("categories", [])], "pagination": d.get("pagination"), "count": len(d.get("athletes", [])), "athlete": d.get("athletes", [])[:1]})
probe("teams", S + "/teams?" + Q + "&groups=80&limit=500", lambda d: {"n": len(((d.get("sports") or [{}])[0].get("leagues") or [{}])[0].get("teams", [])), "one": (((d.get("sports") or [{}])[0].get("leagues") or [{}])[0].get("teams") or [None])[0]})
probe("summary", S + "/summary?" + Q + "&event=401752700", lambda d: {"keys": list(d.keys()), "predictor": d.get("predictor"), "pickcenter": d.get("pickcenter")})

with open("tools/api_probe_out.json", "w") as f:
    json.dump(out, f, indent=1, default=str)
