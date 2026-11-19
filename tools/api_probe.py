#!/usr/bin/env python3
"""One-off: which lineup and on/off sources answer from GitHub's runners (pbpstats with retries, Basketball-Reference
team lineup and on/off pages). Writes tools/api_probe_out.json."""
import json, re, time
import urllib.request

UA = "Mozilla/5.0 (compatible; davidsolar-nba/1.0; +https://davidsolar.dev/nba/)"
out = {}


def get(url, timeout=120, tries=3):
    err = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/html", "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace"), k
        except Exception as e:
            err = e
            time.sleep(6 * (k + 1))
    raise err


def pj(name, url, keep):
    t = time.time()
    try:
        body, k = get(url)
        out[name] = {"ok": True, "tries": k + 1, "secs": round(time.time() - t), "url": url, "sample": keep(json.loads(body))}
    except Exception as e:
        out[name] = {"ok": False, "secs": round(time.time() - t), "url": url, "error": str(e)[:300]}


P = "https://api.pbpstats.com"
Q = "Season=2026-27&SeasonType=Regular%20Season"
rows = lambda d: d.get("multi_row_table_data") or []
pj("team_lineups", f"{P}/get-totals/nba?{Q}&Type=Lineup&TeamId=1610612738", lambda d: {"n": len(rows(d)), "row": rows(d)[0] if rows(d) else None})
pj("all_lineups", f"{P}/get-totals/nba?{Q}&Type=Lineup", lambda d: {"n": len(rows(d)), "keys": list(rows(d)[0].keys()) if rows(d) else None})
pj("teams", f"{P}/get-totals/nba?{Q}&Type=Team", lambda d: {"n": len(rows(d)), "row": rows(d)[0] if rows(d) else None})
pj("on_off", f"{P}/get-on-off/nba/stat?{Q}&TeamId=1610612738&Stat=PlusMinus", lambda d: {"keys": list(d.keys()), "s": str(d)[:1500]})
pj("on_off_net", f"{P}/get-on-off/nba/stat?{Q}&TeamId=1610612738&Stat=NetRtg", lambda d: {"keys": list(d.keys()), "s": str(d)[:600]})
pj("team_players", f"{P}/get-team-players-for-season/nba?{Q}&TeamId=1610612738", lambda d: {"s": str(d)[:400]})


def tables(html):
    html = html.replace("<!--", "").replace("-->", "")
    res = {}
    for m in re.finditer(r'<table[^>]*id="([^"]+)"[^>]*>(.*?)</table>', html, re.S):
        tid, t = m.group(1), m.group(2)
        heads = re.findall(r'<th[^>]*data-stat="([^"]+)"', t.split("</thead>")[0])
        body = t.split("<tbody>")[1] if "<tbody>" in t else ""
        trs = re.findall(r'<tr[^>]*>(.*?)</tr>', body, re.S)
        first = [(k, re.sub("<[^>]+>", "", v)[:60]) for k, v in re.findall(r'data-stat="([^"]+)"[^>]*>(.*?)</t[dh]>', trs[0])] if trs else []
        res[tid] = {"rows": len(trs), "heads": heads[:40], "first": first[:40]}
    return res


for name, url in [("bbref_lineups", "https://www.basketball-reference.com/teams/BOS/2027_lineups.html"),
                  ("bbref_onoff", "https://www.basketball-reference.com/teams/BOS/2027_on-off.html")]:
    try:
        html, _ = get(url)
        out[name] = {"ok": True, "tables": tables(html)}
    except Exception as e:
        out[name] = {"ok": False, "error": str(e)[:300]}
    time.sleep(4)

with open("tools/api_probe_out.json", "w") as f:
    json.dump(out, f, indent=1, default=str)
