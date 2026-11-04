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


for name, url in [
    ("fg_board_2026", "https://www.fangraphs.com/prospects/the-board/2026-prospect-list"),
    ("fg_board_2026_inseason", "https://www.fangraphs.com/prospects/the-board/2026-in-season-prospect-list"),
    ("fg_board_2025_inseason", "https://www.fangraphs.com/prospects/the-board/2025-in-season-prospect-list"),
]:
    try:
        html = get(url)
        nd = nextdata(html)
        out[name] = {"bytes": len(html), "next": shape(nd) if nd else None}
        # any long list of dicts with a player name in it
        found = []
        def walk(v, path):
            if isinstance(v, list) and len(v) > 50 and isinstance(v[0], dict):
                found.append({"path": path, "len": len(v), "first": v[0], "second": v[1]})
            elif isinstance(v, dict):
                for k, w in v.items(): walk(w, path + "." + k)
        if nd: walk(nd, "")
        out[name]["lists"] = found[:3]
    except Exception as e:
        out[name] = f"FAILED {str(e)[:120]}"

for name, url in [
    ("fg_api_board", "https://www.fangraphs.com/api/prospects/board/prospects-list?draft=2026prospect&season=2026&playerid=&position=&statType=player"),
    ("fg_api_board2", "https://www.fangraphs.com/api/prospects/board/data?draft=2026prospect"),
    ("mlb_stats_prospects", "https://statsapi.mlb.com/api/v1/prospects?limit=5"),
    ("mlb_pipeline_content", "https://www.mlb.com/prospects/top100"),
]:
    try:
        t = get(url, "application/json")
        try: out[name] = shape(json.loads(t))
        except Exception: out[name] = {"bytes": len(t), "head": t[:300], "hasNext": "__NEXT_DATA__" in t, "rank_hits": len(re.findall(r'"rank"\s*:', t)), "player_hits": len(re.findall(r'"playerId"|"player_id"|"mlbam', t))}
    except Exception as e:
        out[name] = f"FAILED {str(e)[:120]}"

json.dump(out, open("tools/api_probe_out.json", "w"), indent=1, default=str)
print(json.dumps(out, default=str)[:3000])
