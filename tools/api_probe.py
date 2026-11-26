#!/usr/bin/env python3
"""One-off: does the new NHL one-night slate feed answer (fk-live ?sport=nhl&slates=1), and do its game ids return box
scores (?sport=nhl&games=)? Writes tools/api_probe_out.json."""
import json
import urllib.request

BASE = "https://baxrczyufqbzrogftmyn.supabase.co/functions/v1/fk-live"
out = {}
def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "davidsolar.dev probe"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())
try:
    s = get(BASE + "?sport=nhl&slates=1")
    out["slates"] = {"sport": s.get("sport"), "season": s.get("season"), "error": s.get("error"), "days": [{"day": w["day"], "games": len(w["games"]), "first": w["games"][:2]} for w in s.get("weeks", [])]}
    ids = [g["id"] for w in s.get("weeks", []) for g in w["games"]][:3]
    if ids:
        g = get(BASE + "?sport=nhl&games=" + ",".join(ids))
        out["games"] = {k: {"state": v.get("state"), "players": len(v.get("lines") or {})} for k, v in (g.get("games") or {}).items()}
except Exception as e:
    out["error"] = str(e)[:300]
json.dump(out, open("tools/api_probe_out.json", "w"), indent=1)
