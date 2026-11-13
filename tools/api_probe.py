#!/usr/bin/env python3
"""One-off: the NHL hub's data sources from GitHub's runners (NHL's stats API and MoneyPuck's public season files).
Writes what each source returns to tools/api_probe_out.json."""
import csv
import io
import json
import urllib.request

UA = "davidsolar-nhlhub/1.0 (+https://davidsolar.dev/nhl/)"
out = {}


def get(url, accept="application/json"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def shape(x, depth=0):
    """the keys of a JSON value, a few levels deep, with list lengths"""
    if depth > 5: return "..."
    if isinstance(x, dict): return {k: shape(v, depth + 1) for k, v in list(x.items())[:40]}
    if isinstance(x, list): return [f"len {len(x)}", shape(x[0], depth + 1) if x else None]
    return type(x).__name__ if not isinstance(x, (str, int, float)) else (x if len(str(x)) < 60 else str(x)[:60])


def probe(name, url, kind="json"):
    try:
        body = get(url, "text/csv" if kind == "csv" else "application/json")
        if kind == "csv":
            rows = list(csv.DictReader(io.StringIO(body)))
            out[name] = {"ok": True, "rows": len(rows), "cols": list(rows[0].keys()) if rows else [], "sample": rows[:2]}
        else:
            d = json.loads(body)
            out[name] = {"ok": True, "shape": shape(d)}
            if name == "standings":
                out[name]["first"] = d.get("standings", [None])[0]
            if name == "roster":
                out[name]["first"] = (d.get("forwards") or [None])[0]
            if name == "clubstats":
                out[name]["firstSkater"] = (d.get("skaters") or [None])[0]
                out[name]["firstGoalie"] = (d.get("goalies") or [None])[0]
    except Exception as e:
        out[name] = {"ok": False, "error": str(e)[:300]}


A = "https://api-web.nhle.com/v1"
probe("standings", A + "/standings/now")
probe("roster", A + "/roster/BOS/current")
probe("clubstats", A + "/club-stats/BOS/now")
probe("schedule", A + "/club-schedule-season/BOS/now")
probe("player", A + "/player/8478402/landing")
probe("draftrank", A + "/draft/rankings/now")
probe("teamstats", "https://api.nhle.com/stats/rest/en/team/summary?cayenneExp=seasonId=20262027%20and%20gameTypeId=2")
MP = "https://moneypuck.com/moneypuck/playerData/seasonSummary"
probe("mp_skaters_2026", MP + "/2026/regular/skaters.csv", "csv")
probe("mp_goalies_2026", MP + "/2026/regular/goalies.csv", "csv")
probe("mp_skaters_2025", MP + "/2025/regular/skaters.csv", "csv")
probe("mp_teams_2026", MP + "/2026/regular/teams.csv", "csv")
probe("mp_lines_2026", MP + "/2026/regular/lines.csv", "csv")

with open("tools/api_probe_out.json", "w") as f:
    json.dump(out, f, indent=1, default=str)
print(json.dumps({k: (v.get("ok"), v.get("rows"), v.get("error")) for k, v in out.items()}, indent=1))
