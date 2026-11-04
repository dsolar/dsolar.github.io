#!/usr/bin/env python3
"""One-off: where to get real baseball prospect rankings (not draft prospects) with ids we can join to MiLB stats.
Writes what each source returns to tools/api_probe_out.json."""
import json
import re
import urllib.request

UA = "Mozilla/5.0 (compatible; davidsolar-draftlab/1.0; +https://davidsolar.dev/fantasy-kit/)"
out = {}


def get(url, accept="text/html"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def nextdata(html):
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    return json.loads(m.group(1)) if m else None


def shape(x, depth=0):
    """the keys of a JSON value, a few levels deep, with list lengths"""
    if depth > 5: return "..."
    if isinstance(x, dict): return {k: shape(v, depth + 1) for k, v in list(x.items())[:40]}
    if isinstance(x, list): return [f"len {len(x)}", shape(x[0], depth + 1) if x else None]
    return type(x).__name__ if not isinstance(x, (str, int, float)) else (x if len(str(x)) < 60 else str(x)[:60])


def board(draft):
    rows = json.loads(get(f"https://www.fangraphs.com/api/prospects/board/prospects-list?draft={draft}&season=2026&playerid=&position=&statType=player", "application/json"))
    top = sorted([r for r in rows if str(r.get("cOVR") or "").isdigit()], key=lambda r: int(r["cOVR"]))
    return {"len": len(rows), "ranked": len(top), "levels": sorted({str(r.get("llevel")) for r in rows}), "top": [(r.get("cOVR"), r.get("playerName"), r.get("llevel"), r.get("mlevel"), r.get("cFV"), r.get("cETA"), r.get("minorMasterId")) for r in top[:12]], "keys": sorted(rows[0].keys()) if rows else None}

for d in ["2026updated", "2026in-season", "2026inseason", "2026prospect", "2027prospect", "2026update"]:
    try: out["board_" + d] = board(d)
    except Exception as e: out["board_" + d] = f"FAILED {str(e)[:120]}"

ML = "https://www.fangraphs.com/api/leaders/minor-league/data?pos=all&level=0&lg=2,4,5,6,7,8,9,10,11,14,12,13,15,16,17,18,30,32&stats={st}&qual=0&type=0&team=&season=2026&seasonEnd=2026&org=&ind=0&splitTeam=false"
for st in ["bat", "pit"]:
    try:
        t = json.loads(get(ML.format(st=st), "application/json"))
        rows = t if isinstance(t, list) else t.get("data") or t
        out["minors_" + st] = {"len": len(rows), "first": rows[0], "griffin": [r for r in rows if "Griffin" in str(r.get("PlayerName") or r.get("playerName") or "")][:2]}
    except Exception as e:
        out["minors_" + st] = f"FAILED {str(e)[:160]}"

json.dump(out, open("tools/api_probe_out.json", "w"), indent=1, default=str)
print(json.dumps(out, default=str)[:3000])
