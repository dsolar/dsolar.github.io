#!/usr/bin/env python3
"""One-off: the fields the NBA hub's ratings would read (pbpstats player totals, team lineups and on/off, and
Basketball-Reference's advanced and play-by-play tables), from GitHub's runners. Writes tools/api_probe_out.json."""
import json, re
import urllib.request

UA = "Mozilla/5.0 (compatible; davidsolar-nba/1.0; +https://davidsolar.dev/nba/)"
out = {}


def get(url, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/html", "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def pj(name, url, keep):
    try:
        out[name] = {"ok": True, "url": url, "sample": keep(json.loads(get(url)))}
    except Exception as e:
        out[name] = {"ok": False, "url": url, "error": str(e)[:300]}


P = "https://api.pbpstats.com"
Q = "Season=2026-27&SeasonType=Regular%20Season"
rows = lambda d: d.get("multi_row_table_data") or []
pj("players", f"{P}/get-totals/nba?{Q}&Type=Player", lambda d: {"n": len(rows(d)), "row": next((r for r in rows(d) if r.get("Name") == "Jayson Tatum" or r.get("Name") == "Nikola Jokic"), rows(d)[0] if rows(d) else None)})
pj("players_prev", f"{P}/get-totals/nba?Season=2025-26&SeasonType=Regular%20Season&Type=Player", lambda d: {"n": len(rows(d))})
pj("team_players", f"{P}/get-team-players-for-season/nba?{Q}&TeamId=1610612738", lambda d: {"keys": list(d.keys()), "s": str(d)[:600]})
pj("team_lineups", f"{P}/get-totals/nba?{Q}&Type=Lineup&TeamId=1610612738", lambda d: {"n": len(rows(d)), "row": rows(d)[0] if rows(d) else None})
pj("team_lineup_opp", f"{P}/get-totals/nba?{Q}&Type=LineupOpponent&TeamId=1610612738", lambda d: {"n": len(rows(d)), "keys": list(rows(d)[0].keys())[:60] if rows(d) else None})
pj("wowy", f"{P}/get-wowy-stats/nba?{Q}&TeamId=1610612738&Type=Team&0Exactly1OnFloor=1628369", lambda d: {"keys": list(d.keys()), "s": str(d)[:900]})
pj("on_off", f"{P}/get-on-off/nba/stat?{Q}&TeamId=1610612738&Stat=PlusMinus", lambda d: {"keys": list(d.keys()), "s": str(d)[:900]})
pj("teams", f"{P}/get-totals/nba?{Q}&Type=Team", lambda d: {"n": len(rows(d)), "keys": list(rows(d)[0].keys())[:30] if rows(d) else None})


def table_headers(html, tid):
    m = re.search(r'<table[^>]*id="%s"[^>]*>(.*?)</table>' % tid, html, re.S) or re.search(r'id="%s".*?<table[^>]*>(.*?)</table>' % tid, html.replace("<!--", "").replace("-->", ""), re.S)
    if not m: return None
    t = m.group(1)
    heads = re.findall(r'<th[^>]*data-stat="([^"]+)"', t.split("</thead>")[0])
    first = re.search(r'<tr[^>]*>(.*?)</tr>', t.split("<tbody>")[1] if "<tbody>" in t else "", re.S)
    cells = re.findall(r'data-stat="([^"]+)"[^>]*>(.*?)</t[dh]>', first.group(1)) if first else []
    return {"heads": heads, "first": [(k, re.sub("<[^>]+>", "", v)[:30]) for k, v in cells]}


for name, url, tid in [("bbref_adv", "https://www.basketball-reference.com/leagues/NBA_2027_advanced.html", "advanced"),
                       ("bbref_pbp", "https://www.basketball-reference.com/leagues/NBA_2027_play-by-play.html", "pbp_stats"),
                       ("bbref_shoot", "https://www.basketball-reference.com/leagues/NBA_2027_shooting.html", "shooting"),
                       ("bbref_per100", "https://www.basketball-reference.com/leagues/NBA_2027_per_poss.html", "per_poss")]:
    try:
        html = get(url)
        out[name] = {"ok": True, "tables": re.findall(r'<table[^>]*id="([^"]+)"', html.replace("<!--", "")), "t": table_headers(html, tid)}
    except Exception as e:
        out[name] = {"ok": False, "error": str(e)[:300]}

with open("tools/api_probe_out.json", "w") as f:
    json.dump(out, f, indent=1, default=str)
