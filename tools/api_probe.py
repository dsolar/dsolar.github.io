#!/usr/bin/env python3
"""One-off: the NBA hub's candidate advanced-stats feeds from GitHub's runners (official play-by-play and box scores,
stats.nba.com lineups, pbpstats, Basketball-Reference, and the public pages of the advanced-stats sites). Writes what
each source returns to tools/api_probe_out.json."""
import json
import urllib.request

UA = "Mozilla/5.0 (compatible; davidsolar-nba/1.0; +https://davidsolar.dev/nba/)"
out = {}


def get(url, headers=None, raw=False):
    h = {"User-Agent": UA, "Accept": "application/json, text/html", "Accept-Encoding": "identity"}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.status, r.read().decode("utf-8", "replace")


def shape(x, depth=0):
    if depth > 6: return "..."
    if isinstance(x, dict): return {k: shape(v, depth + 1) for k, v in list(x.items())[:40]}
    if isinstance(x, list): return [f"len {len(x)}", shape(x[0], depth + 1) if x else None]
    return type(x).__name__ if not isinstance(x, (str, int, float)) else (x if len(str(x)) < 70 else str(x)[:70])


def probe(name, url, headers=None, html=False, keep=None):
    try:
        st, body = get(url, headers)
        if html:
            out[name] = {"ok": True, "url": url, "status": st, "len": len(body), "head": body[:400]}
        else:
            d = json.loads(body)
            out[name] = {"ok": True, "url": url, "status": st, "shape": shape(d)}
            if keep: out[name]["sample"] = keep(d)
        return out[name]
    except Exception as e:
        out[name] = {"ok": False, "url": url, "error": str(e)[:300]}


# official schedule, then a finished game's play-by-play and box score
sched = None
try:
    st, body = get("https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json")
    sched = json.loads(body)
    games = [g for d in sched["leagueSchedule"]["gameDates"] for g in d["games"] if g.get("gameStatus") == 3]
    out["schedule"] = {"ok": True, "finished": len(games), "first": games[0]["gameId"] if games else None}
    gid = games[-1]["gameId"] if games else None
except Exception as e:
    out["schedule"] = {"ok": False, "error": str(e)[:300]}; gid = None
if gid:
    probe("pbp", f"https://cdn.nba.com/static/json/liveData/playbyplay/playbyplay_{gid}.json",
          keep=lambda d: {"n": len(d["game"]["actions"]), "types": sorted({a.get("actionType") for a in d["game"]["actions"]}), "sub": [a for a in d["game"]["actions"] if a.get("actionType") == "substitution"][:2], "shot": [a for a in d["game"]["actions"] if a.get("actionType") in ("2pt", "3pt")][:1]})
    probe("box", f"https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{gid}.json",
          keep=lambda d: {"stat_keys": list(d["game"]["homeTeam"]["players"][0]["statistics"].keys())})

NBA_H = {"Referer": "https://www.nba.com/", "Origin": "https://www.nba.com", "x-nba-stats-origin": "stats", "x-nba-stats-token": "true",
         "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"}
probe("stats_lineups", "https://stats.nba.com/stats/leaguedashlineups?Season=2026-27&SeasonType=Regular%20Season&GroupQuantity=5&MeasureType=Advanced&PerMode=Per100Possessions&LastNGames=0&Month=0&OpponentTeamID=0&PaceAdjust=N&Period=0&PlusMinus=N&Rank=N&TeamID=0&DateFrom=&DateTo=&GameSegment=&LeagueID=00&Location=&Outcome=&SeasonSegment=&ShotClockRange=&VsConference=&VsDivision=&Conference=&Division=&GameID=&PORound=0&TwoWay=0", NBA_H,
      keep=lambda d: {"headers": d["resultSets"][0]["headers"][:30], "rows": len(d["resultSets"][0]["rowSet"])})
probe("stats_tracking", "https://stats.nba.com/stats/leaguedashptstats?Season=2026-27&SeasonType=Regular%20Season&PerMode=PerGame&PlayerOrTeam=Player&PtMeasureType=Drives&LastNGames=0&Month=0&OpponentTeamID=0&TeamID=0&LeagueID=00&College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=&GameScope=&Height=&Location=&Outcome=&PlayerExperience=&PlayerPosition=&SeasonSegment=&StarterBench=&VsConference=&VsDivision=&Weight=", NBA_H,
      keep=lambda d: {"headers": d["resultSets"][0]["headers"][:30], "rows": len(d["resultSets"][0]["rowSet"])})
probe("pbpstats_players", "https://api.pbpstats.com/get-totals/nba?Season=2026-27&SeasonType=Regular%20Season&Type=Player",
      keep=lambda d: {"n": len(d.get("multi_row_table_data", [])), "keys": list((d.get("multi_row_table_data") or [{}])[0].keys())[:80]})
probe("pbpstats_lineups", "https://api.pbpstats.com/get-totals/nba?Season=2026-27&SeasonType=Regular%20Season&Type=Lineup",
      keep=lambda d: {"n": len(d.get("multi_row_table_data", [])), "keys": list((d.get("multi_row_table_data") or [{}])[0].keys())[:40]})
probe("bbref_adv", "https://www.basketball-reference.com/leagues/NBA_2027_advanced.html", html=True)
probe("bbref_pbp", "https://www.basketball-reference.com/leagues/NBA_2027_play-by-play.html", html=True)
for n, u in [("nbarapm", "https://www.nbarapm.com/"), ("dunksandthrees", "https://dunksandthrees.com/epm"), ("crafted", "https://craftednba.com/"),
             ("databallr", "https://databallr.com/"), ("ctg", "https://cleaningtheglass.com/stats/league/summary")]:
    probe(n, u, html=True)

with open("tools/api_probe_out.json", "w") as f:
    json.dump(out, f, indent=1, default=str)
