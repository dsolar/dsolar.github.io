#!/usr/bin/env python3
"""One-off: do ESPN's logo and headshot CDNs send CORS headers (so a page can draw them into a canvas and save it)?
Writes tools/api_probe_out.json."""
import json
import urllib.request

out = {}
for name, url in [("logo", "https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/bos.png&w=96&h=96"),
                  ("logo_plain", "https://a.espncdn.com/i/teamlogos/nba/500/bos.png"),
                  ("head", "https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/4065648.png&w=96&h=70"),
                  ("head_plain", "https://a.espncdn.com/i/headshots/nba/players/full/4065648.png")]:
    try:
        req = urllib.request.Request(url, headers={"Origin": "https://davidsolar.dev", "User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            out[name] = {"status": r.status, "headers": {k: v for k, v in r.headers.items() if k.lower().startswith(("access-control", "content-type", "timing"))}}
    except Exception as e:
        out[name] = {"error": str(e)[:200]}
with open("tools/api_probe_out.json", "w") as f:
    json.dump(out, f, indent=1)
