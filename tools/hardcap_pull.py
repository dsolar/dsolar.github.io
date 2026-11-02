#!/usr/bin/env python3
"""Pull NBA box scores and season lines from ESPN's public API into hardcap/stats.json for Hard Cap.

Hard Cap (hardcap/) is the salary-cap dynasty league. It needs two things the Banner 19 feed doesn't carry:
  wk    every player's totals for each fantasy week (nine categories plus Game Score inputs),
        built game by game from ESPN box scores. Each final game is added once and remembered by id.
  avg   per-game lines with field goals and free throws made, for 2025-26 (fetched once) and this season,
        so the draft room can rank players on the nine categories.

Weeks: week 1 runs from opening night through the first Sunday; every week after is Monday to Sunday.

Run by .github/workflows/hardcap-stats.yml every morning during the season, or locally:
  python tools/hardcap_pull.py

Standard library only. If ESPN returns nothing usable, the existing file is left as it was.
"""
import json
import os
import re
import sys
import unicodedata
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "hardcap", "stats.json")
UA = "davidsolar-hardcap/1.0 (+https://davidsolar.dev/hardcap/)"
# ESPN refuses some hosts from some networks, so each call tries these in order and sticks with the first that answers.
BOARD = ["https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?region=us&lang=en&contentorigin=espn&dates={d}&limit=40",
         "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={d}&limit=40",
         "https://cdn.espn.com/core/nba/scoreboard?xhr=1&dates={d}"]
SUMMARY = ["https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary?region=us&lang=en&contentorigin=espn&event={id}",
           "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={id}",
           "https://cdn.espn.com/core/nba/boxscore?xhr=1&gameId={id}"]
STATS = ("https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete"
         "?region=us&lang=en&contentorigin=espn&isqualified=false&limit=250&page={page}"
         "&sort=general.avgMinutes:desc&season={season}&seasontype=2")
INJURIES = ["https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/injuries?region=us&lang=en&contentorigin=espn",
            "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",
            "https://cdn.espn.com/core/nba/injuries?xhr=1"]
TEAM = {"GS": "GSW", "NY": "NYK", "SA": "SAS", "NO": "NOP", "UTAH": "UTA", "WSH": "WAS", "BKN": "BRK", "CHA": "CHO",
        "PHX": "PHO"}
# Order of the numbers in every weekly line and every per-game line.
COLS = ["gp", "min", "fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "oreb", "ast", "stl", "blk", "tov", "pf"]
MAX_GAMES_PER_RUN = 140          # keeps a cold start polite; the next run picks up the rest


def slug(n):
    n = unicodedata.normalize("NFKD", n or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def get_any(urls, notes, tag, **kw):
    """First answer from a list of mirror URLs. The cdn.espn.com ones wrap the payload in gamepackageJSON or content."""
    errs = []
    for i, u in enumerate(urls):
        try:
            d = get(u.format(**kw))
        except Exception as e:
            errs.append(f"{u.split('/')[2]} {type(e).__name__}: {e}"[:120])
            continue
        if "gamepackageJSON" in d:
            d = d["gamepackageJSON"]
        elif "content" in d and isinstance(d["content"], dict) and "sbData" in d["content"]:
            d = d["content"]["sbData"]
        if i:                                   # remember the mirror that worked so later calls go there first
            urls.insert(0, urls.pop(i))
        return d
    notes.append(f"{tag}: " + " | ".join(errs))
    return None


def et_today():
    # Eastern time without tz data: UTC-4 from mid-March to early November is close enough for picking a date.
    now = datetime.now(timezone.utc)
    off = 4 if 3 <= now.month <= 10 else 5
    return (now - timedelta(hours=off)).date()


def season_end_year(d):
    return d.year + 1 if d.month >= 7 else d.year


def week_of(day, opener):
    monday = opener - timedelta(days=opener.weekday())
    return (day - monday).days // 7 + 1


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def made_att(s):
    m = re.match(r"^\s*(\d+)\s*-\s*(\d+)\s*$", str(s or ""))
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def minutes(s):
    s = str(s or "")
    if ":" in s:
        a, b = s.split(":", 1)
        return num(a) + num(b) / 60
    return num(s)


def box_lines(summary, notes):
    """{slug: [name, team, line]} for everyone who played in one finished game."""
    out = {}
    for team in summary.get("boxscore", {}).get("players", []):
        ab = team.get("team", {}).get("abbreviation", "")
        ab = TEAM.get(ab, ab)
        for block in team.get("statistics", []):
            labels = [str(x).upper() for x in (block.get("labels") or block.get("names") or [])]
            if not labels:
                continue
            ix = {k: i for i, k in enumerate(labels)}
            for row in block.get("athletes", []):
                vals = row.get("stats") or []
                if row.get("didNotPlay") or not vals:
                    continue
                g = lambda k: vals[ix[k]] if k in ix and ix[k] < len(vals) else None
                mins = minutes(g("MIN"))
                if mins <= 0:
                    continue
                fgm, fga = made_att(g("FG"))
                tpm, _ = made_att(g("3PT"))
                ftm, fta = made_att(g("FT"))
                reb = num(g("REB"))
                oreb = num(g("OREB"))
                line = [1, round(mins, 1), fgm, fga, ftm, fta, tpm, num(g("PTS")), reb, oreb, num(g("AST")),
                        num(g("STL")), num(g("BLK")), num(g("TO")), num(g("PF"))]
                a = row.get("athlete", {})
                out[slug(a.get("displayName"))] = [a.get("displayName"), ab, line]
    if not out:
        notes.append("box: a final game had no readable player rows")
    return out


def pull_avg(season, notes):
    out, page, pages = {}, 1, 1
    schema = None
    while page <= pages and page <= 12:
        d = get(STATS.format(page=page, season=season))
        pages = d.get("pagination", {}).get("pages", 1)
        if schema is None:
            schema = {c["name"]: c.get("names", []) for c in d.get("categories", [])}
        for row in d.get("athletes", []):
            a = row.get("athlete", {})
            vals = {}
            for cat in row.get("categories", []):
                for k, v in zip(schema.get(cat.get("name"), []), cat.get("values", [])):
                    vals.setdefault(k, v)
            gp = int(num(vals.get("gamesPlayed")))
            if not gp:
                continue
            r = lambda k: round(num(vals.get(k)), 2)
            reb = r("avgRebounds")
            out[slug(a.get("displayName"))] = [gp, r("avgMinutes"), r("avgFieldGoalsMade"), r("avgFieldGoalsAttempted"),
                                               r("avgFreeThrowsMade"), r("avgFreeThrowsAttempted"),
                                               r("avgThreePointFieldGoalsMade"), r("avgPoints"), reb,
                                               r("avgOffensiveRebounds"), r("avgAssists"), r("avgSteals"),
                                               r("avgBlocks"), r("avgTurnovers"), r("avgFouls")]
        page += 1
    if out and all(v[2] == 0 for v in out.values()):
        notes.append(f"avg {season}: field goals made missing; fields seen: {sorted(set(k for c in schema.values() for k in c))[:80]}")
    return out


def pull_injuries(notes):
    """{slug: [status, short note, date]} from ESPN's league injury report. Hard Cap's IR takes players listed Out."""
    d = get_any(INJURIES, notes, "injuries")
    if d is None:
        return None
    teams = d.get("injuries") or (d.get("content") or {}).get("injuries") or []
    out = {}
    for team in teams:
        for row in team.get("injuries", []):
            a = row.get("athlete", {})
            pid = slug(a.get("displayName"))
            if not pid:
                continue
            note = row.get("shortComment") or ((row.get("details") or {}).get("type") or "")
            out[pid] = [row.get("status") or (row.get("type") or {}).get("description") or "", str(note)[:140], (row.get("date") or "")[:10]]
    if not out:
        notes.append(f"injuries: no rows; top-level keys {sorted(d.keys())[:12]}")
    return out


def main():
    today = et_today()
    end = season_end_year(today)
    name = f"{end - 1}-{str(end)[2:]}"
    notes = []
    try:
        data = json.load(open(OUT, encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    if data.get("season") != name:
        data = {"season": name, "opener": None, "games": {}, "wk": {}, "names": {}, "avg": data.get("avg", {})}

    # Season lines. Last season's never changes, so it is fetched once.
    for yr in (end - 1, end):
        if str(yr) in data["avg"] and yr != end:
            continue
        try:
            lines = pull_avg(yr, notes)
            if lines:
                data["avg"][str(yr)] = lines
        except Exception as e:
            notes.append(f"avg {yr}: {type(e).__name__}: {e}"[:200])

    inj = pull_injuries(notes)
    if inj is not None:
        data["inj"] = inj
        data["injUpdated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Box scores, day by day: from the opener (or two days before the last day already counted) to today.
    start = date(end - 1, 10, 14)
    if data.get("last"):
        start = max(start, date.fromisoformat(data["last"]) - timedelta(days=2))
    opener = date.fromisoformat(data["opener"]) if data.get("opener") else None
    added, d = 0, start
    while d <= today and added < MAX_GAMES_PER_RUN:
        board = get_any(BOARD, notes, f"board {d}", d=d.strftime("%Y%m%d"))
        if board is None:
            d += timedelta(days=1)
            continue
        for ev in board.get("events", []):
            if ev.get("season", {}).get("type") != 2:
                continue                                        # preseason, play-in and playoffs don't count
            if not ev.get("status", {}).get("type", {}).get("completed"):
                continue
            gid = str(ev.get("id"))
            if gid in data["games"]:
                continue
            if opener is None:
                opener = d
                data["opener"] = d.isoformat()
            summary = get_any(SUMMARY, notes, f"game {gid}", id=gid)
            if summary is None:
                continue
            lines = box_lines(summary, notes)
            if not lines:
                continue
            wk = data["wk"].setdefault(str(week_of(d, opener)), {})
            for pid, (pname, team, line) in lines.items():
                cur = wk.get(pid) or [0] * len(COLS)
                wk[pid] = [round(a + b, 1) for a, b in zip(cur, line)]
                data["names"][pid] = [pname, team]
            data["games"][gid] = d.isoformat()
            data["last"] = max(data.get("last") or "", d.isoformat())
            added += 1
        d += timedelta(days=1)

    if not data["games"] and not data["avg"]:
        for n in notes:
            print(n)
        print("Nothing usable from ESPN; leaving the file alone.")
        return
    data["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    data["source"] = "ESPN"
    data["cols"] = COLS
    data["notes"] = notes[:30]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {OUT}: {name}, opener {data.get('opener')}, {len(data['games'])} games ({added} new), "
          f"{len(data['wk'])} weeks, avg seasons {sorted(data['avg'])}.")
    for n in notes:
        print(n)


if __name__ == "__main__":
    main()
