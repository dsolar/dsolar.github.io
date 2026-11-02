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
ROSTER = ["https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{id}/roster?region=us&lang=en&contentorigin=espn",
          "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{id}/roster"]
BBREF = "https://www.basketball-reference.com/leagues/NBA_{season}_advanced.html"
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


def pull_rosters(notes):
    """{slug: [team, name, position]} for everyone on an NBA roster right now, plus how many of the 30 teams answered.
    Hard Cap releases a fantasy player who is on no roster (waived, bought out, retired) once all 30 come back."""
    out, teams = {}, 0
    for tid in range(1, 31):
        d = get_any(ROSTER, notes, f"roster {tid}", id=tid)
        if not d:
            continue
        ab = (d.get("team") or {}).get("abbreviation", "")
        ab = TEAM.get(ab, ab)
        athletes = d.get("athletes") or []
        if athletes and isinstance(athletes[0], dict) and "items" in athletes[0]:     # older grouped shape
            athletes = [a for g in athletes for a in g.get("items", [])]
        if not athletes:
            continue
        teams += 1
        for a in athletes:
            pos = (a.get("position") or {}).get("abbreviation", "")
            out[slug(a.get("displayName"))] = [ab, a.get("displayName"), pos]
    return out, teams


def pull_vorp(season, notes):
    """{slug: [vorp, bpm, games]} from Basketball-Reference's advanced table. One page a day, well inside its limits.
    A traded player's season total row comes first, so the first row per player wins."""
    import html as H
    req = urllib.request.Request(BBREF.format(season=season), headers={"User-Agent": UA, "Accept": "text/html"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            page = r.read().decode("utf-8", "replace")
    except Exception as e:
        notes.append(f"vorp: {type(e).__name__}: {e}"[:200])
        return None
    out = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = dict(re.findall(r'data-stat="([a-z_]+)"[^>]*>(.*?)</t[dh]>', row, re.S))
        name = re.sub(r"<[^>]+>", "", cells.get("name_display") or cells.get("player") or "").strip()
        if not name or name == "Player" or "vorp" not in cells:
            continue
        pid = slug(H.unescape(name))
        if pid in out:
            continue
        try:
            out[pid] = [float(re.sub(r"<[^>]+>", "", cells["vorp"]) or 0), float(re.sub(r"<[^>]+>", "", cells.get("bpm", "0")) or 0),
                        int(re.sub(r"<[^>]+>", "", cells.get("games", cells.get("g", "0"))) or 0)]
        except ValueError:
            continue
    if not out:
        notes.append(f"vorp: no rows parsed ({len(page)} bytes)")
    return out or None


CONTRACTS = "https://www.basketball-reference.com/contracts/players.html"
OPT_CLASS = {"pl": "PO", "tm": "TO", "et": "PO", "ng": "NG", "mu": "MO"}


def pull_contracts(notes):
    """{slug: [team, [salary by season, current first], {season index: option}]} for every standard NBA contract, from
    Basketball-Reference's league contracts page. Two-way and 10-day deals aren't on it, which is how Hard Cap tells
    them apart. Option years are marked with salary-pl / salary-tm style classes on the cell."""
    import html as H
    req = urllib.request.Request(CONTRACTS, headers={"User-Agent": UA, "Accept": "text/html"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            page = r.read().decode("utf-8", "replace")
    except Exception as e:
        notes.append(f"contracts: {type(e).__name__}: {e}"[:200])
        return None
    out = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = {}
        for attrs, val in re.findall(r"<t[dh]([^>]*)>(.*?)</t[dh]>", row, re.S):
            m = re.search(r'data-stat="([^"]+)"', attrs)
            if m:
                cells[m.group(1)] = (attrs, val)
        if "player" not in cells or "y1" not in cells:
            continue
        name = H.unescape(re.sub(r"<[^>]+>", "", cells["player"][1])).strip()
        if not name or name == "Player":
            continue
        team = re.sub(r"<[^>]+>", "", cells.get("team_id", ("", ""))[1]).strip()
        sal, opt = [], {}
        for i in range(6):
            a, v = cells.get(f"y{i + 1}", ("", ""))
            num = re.sub(r"[^0-9]", "", re.sub(r"<[^>]+>", "", v))
            sal.append(int(num) if num else 0)
            m = re.search(r"salary-([a-z]+)", a + v)
            if num and m:
                opt[str(i)] = OPT_CLASS.get(m.group(1), m.group(1).upper())
        if not sal[0]:
            continue
        pid = slug(name)
        # A player can have two rows: dead money from a team that waived him, and his current deal. The first row
        # stays in front; any other rides along after it, and Hard Cap uses the one for his current NBA team.
        if pid not in out:
            out[pid] = [team, sal, opt]
        else:
            out[pid].append([team, sal, opt])
    if len(out) < 350:
        notes.append(f"contracts: only {len(out)} rows parsed ({len(page)} bytes); kept the last good pull")
        return None
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

    vorp = pull_vorp(end, notes)
    if vorp:
        data["vorp"] = vorp
        # Season VORP is cumulative, so each fantasy week keeps the last reading taken during it; a week's VORP is
        # its reading minus the week before's.
        if data.get("opener"):
            # A morning reading covers games through yesterday, so it belongs to yesterday's week.
            wk_now = str(week_of(today - timedelta(days=1), date.fromisoformat(data["opener"])))
            data.setdefault("vorpWk", {})[wk_now] = {k: v[0] for k, v in vorp.items()}

    try:
        contracts = pull_contracts(notes)
    except Exception as e:                    # never let the contracts page break the box scores
        notes.append(f"contracts: {type(e).__name__}: {e}"[:200])
        contracts = None
    if contracts:
        data["contracts"] = contracts
        data["contractsUpdated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")

    rosters, teams = pull_rosters(notes)
    if teams:
        data["rosters"] = rosters
        data["rosterTeams"] = teams
        data["rostersUpdated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

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
