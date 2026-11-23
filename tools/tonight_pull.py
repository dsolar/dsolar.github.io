#!/usr/bin/env python3
"""Tonight's games for the NBA and NHL hubs: <hub>/data/tonight.json, from ESPN.

  games  yesterday through six days out: ESPN id, tip time, ET day, home and away (ESPN abbreviations and full names),
         status and score, TV, and ESPN's betting line (DraftKings) when posted
  teams  season team stats for the previews: each team's own numbers ("o") and what its opponents did against it
         ("d"). ESPN publishes team totals and team-minus-opponent differentials; opponents' numbers are the difference.
  inj    each team's injury report (name, status, ESPN's short note, date)

Usage: python3 tools/tonight_pull.py
"""
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from cbb_build import decode_body   # handles ESPN's compressed responses

W = "https://site.web.api.espn.com/apis"
Q = "region=us&lang=en&contentorigin=espn"
UA = "Mozilla/5.0 (compatible; davidsolar-hub/1.0; +https://davidsolar.dev/)"
ET = ZoneInfo("America/New_York")
LEAGUES = {"nba": "basketball/nba", "nhl": "hockey/nhl"}
log = []


def get(url):
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(decode_body(r.read(), r.headers.get("Content-Encoding", ""), r.headers.get_content_charset()))
        except Exception as e:
            if i == 2:
                log.append("failed: " + url.split("?")[0] + " " + str(e)[:80])
            time.sleep(1.5 * (i + 1))
    return None


def season_year(now):
    return now.year + 1 if now.month >= 8 else now.year


def schedule(path, now):
    games = []
    today = now.astimezone(ET).date()
    for i in range(-1, 7):
        day = today + timedelta(days=i)
        d = get(f"{W}/site/v2/sports/{path}/scoreboard?{Q}&dates={day:%Y%m%d}&limit=100")
        for e in (d or {}).get("events") or []:
            c = (e.get("competitions") or [{}])[0]
            side = {x.get("homeAway"): x for x in c.get("competitors") or []}
            if "home" not in side or "away" not in side:
                continue
            t = lambda x: {"ab": x["team"].get("abbreviation"), "n": x["team"].get("displayName"), "id": x["team"].get("id"),
                           "rec": next((r.get("summary") for r in x.get("records") or [] if r.get("type") in ("total", None)), None),
                           "s": int(x["score"]) if str(x.get("score", "")).isdigit() else None}
            st = (e.get("status") or {}).get("type") or {}
            odds = (c.get("odds") or [{}])[0]
            games.append({"id": e["id"], "at": e.get("date"), "day": datetime.fromisoformat(e["date"].replace("Z", "+00:00")).astimezone(ET).strftime("%Y-%m-%d"),
                          "st": st.get("state"), "detail": st.get("shortDetail"), "h": t(side["home"]), "a": t(side["away"]),
                          "tv": [n for b in c.get("broadcasts") or [] for n in b.get("names") or []][:3],
                          "line": odds.get("details"), "ou": odds.get("overUnder"), "neutral": bool(c.get("neutralSite"))})
        time.sleep(0.2)
    return games


def team_stats(path, year):
    d = get(f"{W}/common/v3/sports/{path}/statistics/byteam?{Q}&season={year}&seasontype=2&limit=40")
    if not d:
        return {}
    names = {}
    for c in d.get("categories") or []:          # the category list repeats names once per occurrence; keep the first
        if c.get("names") and c["name"] not in names:
            names[c["name"]] = c["names"]
    out = {}
    for t in d.get("teams") or []:
        ab = (t.get("team") or {}).get("abbreviation")
        seen, vals = {}, {}
        for c in t.get("categories") or []:
            nm = c.get("name"); k = seen.get(nm, 0); seen[nm] = k + 1
            if k == 0 and nm in names:
                vals[nm] = dict(zip(names[nm], c.get("values") or []))
        own = {}
        for cat in ("offensive", "defensive", "general"):
            own.update({k: v for k, v in (vals.get(cat) or {}).items() if isinstance(v, (int, float))})
        diff = {k: v for k, v in (vals.get("differential") or {}).items() if isinstance(v, (int, float))}
        opp = {k: round(own[k] - diff[k], 4) for k in diff if k in own}
        if ab:
            out[ab] = {"o": {k: round(v, 4) for k, v in own.items()}, "d": opp}
        if ab and not out.get("_dbg"):
            out["_dbg"] = {"diff": dict(list((vals.get("differential") or {}).items())[:40]), "cats": [(c.get("name"), len(c.get("values") or [])) for c in t.get("categories") or []]}
    return out


def injuries(path):
    d = get(f"{W}/site/v2/sports/{path}/injuries?{Q}")
    out = {}
    for team in (d or {}).get("injuries") or []:
        rows = []
        for i in team.get("injuries") or []:
            a = i.get("athlete") or {}
            if (i.get("status") or "").lower() == "active":
                continue
            rows.append({"n": a.get("displayName"), "st": i.get("status"), "note": (i.get("shortComment") or "")[:200], "date": (i.get("date") or "")[:10],
                         "pos": ((a.get("position") or {}).get("abbreviation"))})
        ab = None
        for a in [(team.get("injuries") or [{}])[0].get("athlete") or {}]:
            ab = ((a.get("team") or {}).get("abbreviation"))
        out[team.get("displayName")] = {"ab": ab, "rows": rows}
    return out


def main():
    now = datetime.now(timezone.utc)
    year = season_year(now)
    for hub, path in LEAGUES.items():
        games = schedule(path, now)
        teams = team_stats(path, year)
        inj = injuries(path)
        if not games and not teams:
            log.append(hub + ": nothing came back; keeping the last file")
            continue
        body = {"updated": now.strftime("%Y-%m-%dT%H:%MZ"), "season": year, "src": "ESPN", "games": games, "teams": teams, "inj": inj}
        (ROOT / hub / "data/tonight.json").write_text(json.dumps(body, separators=(",", ":")))
        dbg = teams.pop("_dbg", None)
        if dbg: print(hub, "DEBUG", json.dumps(dbg)[:1500])
        some = next(iter(teams.items())) if teams else ("-", {})
        print(f"{hub}: {len(games)} games, {len(teams)} teams with stats, {sum(len(v['rows']) for v in inj.values())} injuries | sample {some[0]} own keys {len(some[1].get('o', {}))} opp keys {len(some[1].get('d', {}))}")
        if teams:
            o, dd = some[1]["o"], some[1]["d"]
            print("   own:", json.dumps(o)[:600]); print("   opp:", json.dumps(dd)[:600])
    print("\n".join(log))


if __name__ == "__main__":
    main()
