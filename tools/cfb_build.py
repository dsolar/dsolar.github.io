#!/usr/bin/env python3
"""Build the College Football Hub (cfb/) from public ESPN feeds.

Writes two normalized snapshots:
  cfb/data/hub.json      FBS teams (ESPN FPI, Strength of Record, the polls and CFP rankings), conferences with the
                         current standings order, every game of the season with scores, and the sportsbook line ESPN
                         shows for this week's and next week's games.
  cfb/data/players.json  Every FBS player with a meaningful season line (passing, rushing, receiving, defense),
                         class and size from the team rosters, and matching prospects on the site's NFL Big Board.

A failed source keeps its last good data. Rosters refresh after 20 hours (or with --rosters).
tools/cfb_extras.py runs afterwards with no network and does the modeling.
"""
import argparse, concurrent.futures, datetime as dt, json, math, pathlib, re, sys, unicodedata, urllib.request
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
HUB = ROOT / "cfb/data/hub.json"
PLAYERS = ROOT / "cfb/data/players.json"
ROSTERS = ROOT / "cfb/data/rosters.json"  # class and size for every rostered player (cache; the page does not load it)
UA = "Mozilla/5.0 (compatible; davidsolar-cfb/1.0; +https://davidsolar.dev/cfb/)"
Q = "region=us&lang=en&contentorigin=espn"
W = "https://site.web.api.espn.com/apis"
S = W + "/site/v2/sports/football/college-football"
NY = ZoneInfo("America/New_York")
POWER = {"SEC", "Big Ten", "Big 12", "ACC"}


def read(p, default=None):
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return default


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8-sig"))


def num(x):
    if x is None or str(x).strip() in ("", "-", "--"):
        return None
    try:
        n = float(str(x).replace(",", "").replace("%", ""))
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower().replace("&", "and")
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


def href(links, rel):
    return next((x["href"] for x in links or [] if rel in x.get("rel", []) and str(x.get("href", "")).startswith("https:")), None)


def logo_of(t):
    if t.get("logo"):
        return t["logo"]
    return next((x["href"] for x in t.get("logos", []) if "default" in x.get("rel", [])), (t.get("logos") or [{}])[0].get("href"))


# ---------- teams: ESPN FPI ----------
def parse_fpi(d, year):
    if (d.get("requestedSeason") or {}).get("year") not in (None, year):
        raise ValueError("FPI season mismatch")
    cols = {c["name"]: c.get("names", []) for c in d.get("categories", [])}
    teams = {}
    for row in d.get("teams", []):
        t = row["team"]; tid = str(t["id"]); g = t.get("group") or {}
        v = {}
        for cat in row.get("categories", []):
            for k, x in zip(cols.get(cat["name"], []), cat.get("values", [])):
                v[cat["name"] + "." + k] = x
        f = lambda k: num(v.get(k))
        polls = {}
        for it in (t.get("ranks") or {}).get("items", []):
            typ = {"cfp": "cfp", "ap": "ap", "usa": "coaches"}.get(it.get("type"))
            r = it.get("rank") or {}
            if typ and num(r.get("current")) and num(r.get("current")) <= 25:
                polls[typ] = {"rank": int(num(r["current"])), "prev": int(num(r.get("previous"))) if num(r.get("previous")) and num(r.get("previous")) <= 25 else None,
                              "points": num(r.get("points")), "headline": it.get("headline")}
        teams[tid] = {
            "id": tid, "name": t.get("displayName"), "short": t.get("shortDisplayName") or t.get("nickname"), "nick": t.get("name"),
            "abbr": t.get("abbreviation", ""), "conference": g.get("shortName") or g.get("name"), "conferenceId": str(g.get("id", "")),
            "conferenceName": g.get("name"), "logo": logo_of(t), "color": "#" + str(t.get("color") or "002244").lstrip("#"),
            "fpi": {"fpi": f("fpi.fpi"), "rank": f("fpi.fpirank"), "move7": f("fpi.rankchange7days"), "projW": f("fpi.projectedw"), "projL": f("fpi.projectedl"),
                    "winOut": f("fpi.probwinout"), "six": f("fpi.prob6wins"), "playoff": f("fpi.probmakeplayoffs"), "titleGame": f("fpi.probmaketitlegame"),
                    "title": f("fpi.probwintitle"), "conf": f("fpi.probwinconf"), "sorRank": f("resume.accomplishmentrank"), "sosRank": f("resume.avgsosrank"),
                    "remSosRank": f("resume.sosremainingrank"), "gcRank": f("resume.gamecontrolrank"),
                    "eff": f("efficiencies.totefficiency"), "effRank": f("efficiencies.totefficiencyrank"), "off": f("efficiencies.offefficiency"),
                    "offRank": f("efficiencies.offefficiencyrank"), "def": f("efficiencies.defefficiency"), "defRank": f("efficiencies.defefficiencyrank"),
                    "st": f("efficiencies.stefficiency"), "stRank": f("efficiencies.stefficiencyrank")},
            "polls": polls,
            "links": {r: href(t.get("links"), r) for r in ("clubhouse", "roster", "schedule", "stats") if href(t.get("links"), r)},
        }
    if len(teams) < 120:
        raise ValueError(f"Incomplete FPI pool ({len(teams)})")
    return teams


# ---------- conferences: ESPN standings (current order, divisions) ----------
def parse_standings(d, teams):
    confs = []
    for c in d.get("children", []):
        parts = c.get("children") or [c]
        divisions = []
        for part in parts:
            entries = (part.get("standings") or {}).get("entries", [])
            order = []
            for e in entries:
                tid = str((e.get("team") or {}).get("id", ""))
                stats = {}
                for s_ in e.get("stats", []):
                    if s_.get("name") and s_.get("value") is not None:
                        stats.setdefault(s_["name"], s_["value"])
                order.append({"id": tid, "seed": num(stats.get("playoffSeed"))})
            order.sort(key=lambda x: (x["seed"] is None, x["seed"] or 0))
            divisions.append({"name": part.get("name") if part is not c else None, "teams": [x["id"] for x in order if x["id"] in teams]})
        ids = [i for dv in divisions for i in dv["teams"]]
        if not ids:
            continue
        short = teams[ids[0]]["conference"]
        confs.append({"id": str(c.get("id")), "name": c.get("name"), "short": short, "teams": ids,
                      "divisions": divisions if len(divisions) > 1 else None, "power": short in POWER,
                      "independent": str(c.get("id")) == "18"})
    if sum(len(c["teams"]) for c in confs) < 120:
        raise ValueError("Incomplete standings")
    return confs


# ---------- games: every team's schedule ----------
def parse_schedule(d, teams, year):
    if (d.get("season") or {}).get("year") not in (None, year):
        raise ValueError("Schedule season mismatch")
    out, other = {}, {}
    for e in d.get("events", []):
        c = (e.get("competitions") or [{}])[0]; cs = c.get("competitors", [])
        h = next((x for x in cs if x.get("homeAway") == "home"), None); a = next((x for x in cs if x.get("homeAway") == "away"), None)
        if not h or not a or not e.get("date"):
            continue
        for x in (h, a):
            if str(x["id"]) not in teams:
                tm = x.get("team") or {}
                other[str(x["id"])] = {"name": tm.get("shortDisplayName") or tm.get("displayName") or "FCS", "abbr": tm.get("abbreviation", ""), "logo": logo_of(tm) if tm.get("logos") else None}
        st = (c.get("status") or {}).get("type", {}); state = st.get("state", "pre")
        if re.search("postpon|cancel", st.get("description", ""), re.I):
            state = "off"
        score = lambda x: num((x.get("score") or {}).get("value") if isinstance(x.get("score"), dict) else x.get("score"))
        at = e["date"]; day = dt.datetime.fromisoformat(at.replace("Z", "+00:00")).astimezone(NY).date().isoformat()
        stype = (e.get("seasonType") or {}).get("type", 2)
        notes = [n.get("headline") for n in c.get("notes", []) if n.get("headline")]
        venue = c.get("venue") or {}
        out[str(e["id"])] = {
            "id": str(e["id"]), "week": (e.get("week") or {}).get("number"), "post": stype == 3, "day": day,
            "at": at if e.get("timeValid", True) else None, "home": str(h["id"]), "away": str(a["id"]), "neutral": bool(c.get("neutralSite")),
            "conf": bool(c.get("conferenceCompetition")) or (str(h["id"]) in teams and str(a["id"]) in teams and teams[str(h["id"])]["conferenceId"] == teams[str(a["id"])]["conferenceId"] and teams[str(h["id"])]["conferenceId"] != "18" and stype == 2),
            "state": state, "hs": score(h) if state in ("in", "post") else None, "as": score(a) if state in ("in", "post") else None,
            "note": notes[0] if notes else None, "venue": venue.get("fullName"), "city": ", ".join(filter(None, [(venue.get("address") or {}).get("city"), (venue.get("address") or {}).get("state")])) or None,
            "tv": ", ".join(dict.fromkeys(b.get("media", {}).get("shortName") or "" for b in c.get("broadcasts", []) if b.get("media"))) or None,
        }
    return out, other


# ---------- this week's scoreboard (status and the sportsbook line), one request per conference ----------
def parse_board(d):
    out = {}
    for e in d.get("events", []):
        c = (e.get("competitions") or [{}])[0]; cs = c.get("competitors", [])
        h = next((x for x in cs if x.get("homeAway") == "home"), None); a = next((x for x in cs if x.get("homeAway") == "away"), None)
        if not h or not a:
            continue
        st = (c.get("status") or e.get("status") or {}).get("type", {}); state = st.get("state", "pre")
        if re.search("postpon|cancel", st.get("description", ""), re.I):
            state = "off"
        o = next((x for x in c.get("odds") or [] if x.get("spread") is not None or x.get("overUnder") is not None), None)
        row = {"state": state, "detail": st.get("shortDetail") or st.get("detail"), "tv": ", ".join(dict.fromkeys(n for b in c.get("broadcasts", []) for n in b.get("names", []))) or None,
               "hs": num(h.get("score")) if state in ("in", "post") else None, "as": num(a.get("score")) if state in ("in", "post") else None,
               "url": href(e.get("links"), "summary")}
        if o:
            # ESPN's spread is the home team's line: -7 means the home team is a 7-point favorite.
            row["market"] = {"spread": -num(o.get("spread")) if num(o.get("spread")) is not None else None, "total": num(o.get("overUnder")),
                             "book": (o.get("provider") or {}).get("name"), "details": o.get("details")}
        out[str(e["id"])] = row
    return out


# ---------- players: ESPN season stat leaders (every category in one feed) ----------
CAT = {
    "general": {"gamesPlayed": "gp", "fumblesForced": "ff", "fumblesRecovered": "fr"},
    "passing": {"completions": "cmp", "passingAttempts": "att", "passingYards": "pyd", "passingTouchdowns": "ptd", "interceptions": "int",
                "sacks": "sk", "QBR": "qbr", "adjQBR": "aqbr", "QBRating": "rate", "yardsPerPassAttempt": "ypa", "longPassing": "plong"},
    "rushing": {"rushingAttempts": "car", "rushingYards": "ryd", "rushingTouchdowns": "rtd", "longRushing": "rlong", "rushingBigPlays": "rbig", "rushingFumblesLost": "fuml"},
    "receiving": {"receptions": "rec", "receivingTargets": "tgt", "receivingYards": "wyd", "receivingTouchdowns": "wtd", "longReception": "wlong", "receivingYardsAfterCatch": "yac"},
    "defensive": {"totalTackles": "tkl", "soloTackles": "solo", "sacks": "dsk", "tacklesForLoss": "tfl", "passesDefended": "pd"},
    "defensiveinterceptions": {"interceptions": "dint", "interceptionTouchdowns": "dintTd"},
    "returning": {"kickReturnTouchdowns": "krTd", "puntReturnTouchdowns": "prTd", "kickReturnYards": "kry", "puntReturnYards": "pry"},
}


def parse_byathlete(d, teams):
    names = {c["name"]: c.get("names", []) for c in d.get("categories", [])}
    out = {}
    for row in d.get("athletes", []):
        a = row.get("athlete") or {}; aid = str(a.get("id", ""))
        tid = str(((a.get("teams") or [{}])[0]).get("id", "")) or str(a.get("teamId", ""))
        if not aid or tid not in teams:
            continue
        s = {}
        for c in row.get("categories", []):
            m = CAT.get(c.get("name"))
            if not m:
                continue
            for k, v in zip(names.get(c.get("name"), []), c.get("values", [])):
                if k in m and num(v) is not None:
                    s[m[k]] = round(num(v), 1)
        out[aid] = {"id": aid, "name": a.get("displayName"), "teamId": tid, "pos": (a.get("position") or {}).get("abbreviation", ""),
                    "head": (a.get("headshot") or {}).get("href"), "s": s}
    return out, d.get("pagination") or {}


def involved(p):
    s = p["s"]; g = lambda k: s.get(k) or 0
    return g("att") >= 15 or g("car") >= 12 or g("rec") >= 5 or g("tkl") >= 12 or g("dsk") >= 1 or g("dint") >= 1 or g("tfl") >= 2 or g("pd") >= 3 or g("krTd") + g("prTd") >= 1


def parse_roster(d, tid):
    out = {}
    coach = " ".join(filter(None, [((d.get("coach") or [{}])[0]).get("firstName"), ((d.get("coach") or [{}])[0]).get("lastName")])) if d.get("coach") else None
    for grp in d.get("positionGroups", []):
        for a in grp.get("athletes", []):
            aid = str(a.get("id", ""))
            if aid:
                out[aid] = {"year": (a.get("experience") or {}).get("displayValue") or (a.get("experience") or {}).get("abbreviation"),
                            "ht": a.get("displayHeight"), "wt": a.get("displayWeight"), "jersey": a.get("jersey"),
                            "home": ", ".join(filter(None, [(a.get("birthPlace") or {}).get("city"), (a.get("birthPlace") or {}).get("state")])) or None}
    return out, coach


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--rosters", action="store_true"); args = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc); today = now.astimezone(NY).date(); stamp = now.isoformat()
    year = today.year if today.month >= 3 else today.year - 1
    old = read(HUB, {}) or {}
    if old.get("season") != year:
        old = {}
    sources = dict(old.get("sources", {})); errors = []

    # Teams
    try:
        fd = get(f"{W}/fitt/v3/sports/football/college-football/powerindex?{Q}&limit=1000&season={year}&group=80", 60)
        teams = parse_fpi(fd, year)
        cur = ((fd.get("currentSeason") or {}).get("type") or {})
        sources["fpi"] = {"name": "ESPN FPI", "status": "connected", "url": "https://www.espn.com/college-football/fpi", "updated": fd.get("lastUpdated") or stamp, "checked": stamp, "coverage": len(teams)}
    except Exception as e:
        errors.append("FPI: " + str(e)); teams = {t["id"]: t for t in old.get("teams", [])}; cur = old.get("seasonType") or {}
        if not teams:
            raise
        sources.setdefault("fpi", {})["error"] = str(e)

    # Conferences
    try:
        confs = parse_standings(get(f"{W}/v2/sports/football/college-football/standings?{Q}&group=80&season={year}&level=3", 60), teams)
        sources["standings"] = {"name": "ESPN standings", "status": "connected", "url": "https://www.espn.com/college-football/standings", "updated": stamp, "checked": stamp}
    except Exception as e:
        errors.append("Standings: " + str(e)); confs = old.get("conferences") or []
    for c in confs:
        for tid in c["teams"]:
            if tid in teams:
                teams[tid]["division"] = next((dv["name"] for dv in (c.get("divisions") or []) if tid in dv["teams"]), None)

    # Calendar (weeks) from one scoreboard request
    weeks = old.get("weeks") or []
    try:
        sb = get(f"{S}/scoreboard?{Q}&groups=80&limit=100")
        cal = ((sb.get("leagues") or [{}])[0]).get("calendar") or []
        weeks = []
        for part in cal:
            for en in part.get("entries", []):
                weeks.append({"type": int(part.get("value", 2)), "week": int(en["value"]), "label": en.get("label"), "detail": en.get("detail"),
                              "start": en.get("startDate"), "end": en.get("endDate")})
        cur_week = {"type": (sb.get("season") or {}).get("type", 2), "week": (sb.get("week") or {}).get("number")}
    except Exception as e:
        errors.append("Calendar: " + str(e)); cur_week = old.get("current") or {"type": 2, "week": None}

    # Every team's schedule
    games, other, sfail = {}, dict(old.get("other") or {}), []
    def sched(tid, stype):
        try:
            return parse_schedule(get(f"{S}/teams/{tid}/schedule?{Q}&season={year}" + ("&seasontype=3" if stype == 3 else "")), teams, year)
        except Exception as e:
            sfail.append(teams[tid]["short"] + ": " + str(e)[:80]); return {}, {}
    jobs = [(tid, 2) for tid in teams] + ([(tid, 3) for tid in teams] if today.month in (12, 1) or (today.month == 11 and today.day >= 28) else [])
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for g_, o_ in pool.map(lambda j: sched(*j), jobs):
            games.update(g_); other.update(o_)
    if len(sfail) > 20 or len(games) < 400:
        errors.append(f"Schedules: {len(sfail)} failed, {len(games)} games; kept the last good schedule")
        games = {g["id"]: g for g in old.get("games", [])}
    else:
        sources["schedule"] = {"name": "ESPN team schedules", "status": "connected" if not sfail else "partial", "url": "https://www.espn.com/college-football/schedule", "updated": stamp, "checked": stamp, "coverage": len(games), "failed": sfail[:10]}

    # This week's and next week's boards: status, TV and the sportsbook line
    oldg = {g["id"]: g for g in old.get("games", [])}
    for gid, g in games.items():  # a line seen earlier stays on the game (closing line once it kicks off)
        if oldg.get(gid, {}).get("market") and not g.get("market"):
            g["market"] = oldg[gid]["market"]
    bfail = []
    wk = cur_week.get("week")
    board_jobs = []
    if wk:
        stype = cur_week.get("type") or 2
        for w in ([wk, wk + 1] if stype == 2 else [wk]):
            for c in confs:
                board_jobs.append((stype, w, c["id"]))
    def board(job):
        stype, w, cid = job
        try:
            return parse_board(get(f"{S}/scoreboard?{Q}&groups={cid}&limit=100&week={w}&seasontype={stype}&dates={year}"))
        except Exception as e:
            bfail.append(str(e)[:60]); return {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for rows in pool.map(board, board_jobs):
            for gid, row in rows.items():
                if gid in games:
                    g = games[gid]
                    for k in ("state", "hs", "as"):
                        if row.get(k) is not None or k == "state":
                            g[k] = row[k]
                    if row.get("detail"):
                        g["detail"] = row["detail"]
                    if row.get("tv"):
                        g["tv"] = row["tv"]
                    if row.get("url"):
                        g["url"] = row["url"]
                    if row.get("market") and g["state"] == "pre":
                        g["market"] = row["market"]
    sources["lines"] = {"name": "Sportsbook lines shown by ESPN", "status": "connected" if len(bfail) < len(board_jobs) / 2 else "partial", "url": "https://www.espn.com/college-football/lines",
                        "updated": stamp, "checked": stamp, "coverage": sum(1 for g in games.values() if g.get("market"))}

    # Records from completed games
    for t in teams.values():
        t["record"] = {"w": 0, "l": 0, "cw": 0, "cl": 0}
    for g in games.values():
        if g["state"] != "post" or g["hs"] is None or g["as"] is None or g["hs"] == g["as"]:
            continue
        win, lose = (g["home"], g["away"]) if g["hs"] > g["as"] else (g["away"], g["home"])
        for tid, key in ((win, "w"), (lose, "l")):
            if tid in teams:
                teams[tid]["record"][key] += 1
                if g["conf"] and not g["post"] and not (g.get("note") and "championship" in g["note"].lower()):
                    teams[tid]["record"]["c" + key] += 1

    # Players
    players_old = read(PLAYERS, {}) or {}
    if players_old.get("season") != year:
        players_old = {}
    pool, perr = {}, None
    try:
        page, pages = 1, 1
        while page <= pages and page <= 14:
            rows, pg = parse_byathlete(get(f"{W}/common/v3/sports/football/college-football/statistics/byathlete?{Q}&isqualified=false&limit=1000&page={page}&sort=passing.passingYards:desc&season={year}&seasontype=2", 60), teams)
            pool.update(rows); pages = int(pg.get("pages") or 1); page += 1
        pool = {k: p for k, p in pool.items() if involved(p)}
        if len(pool) < 1500:
            raise ValueError(f"Only {len(pool)} players with a season line")
        sources["players"] = {"name": "ESPN season stats", "status": "connected", "url": "https://www.espn.com/college-football/stats", "updated": stamp, "checked": stamp, "coverage": len(pool)}
    except Exception as e:
        perr = str(e); errors.append("Players: " + perr); pool = {p["id"]: p for p in players_old.get("players", [])}

    # Rosters (class, size) once a day
    rcache = read(ROSTERS, {}) or {}
    if rcache.get("season") != year:
        rcache = {}
    bio = rcache.get("bio") or {}; coaches = rcache.get("coaches") or {}
    rstamp = rcache.get("updated")
    try:
        age = (now - dt.datetime.fromisoformat(rstamp.replace("Z", "+00:00"))).total_seconds() / 3600 if rstamp else 1e6
    except (ValueError, TypeError):
        age = 1e6
    if args.rosters or age >= 20 or not bio:
        rfail = []
        def roster(tid):
            try:
                return tid, parse_roster(get(f"{W}/common/v3/sports/football/college-football/teams/{tid}/roster?{Q}&season={year}"), tid)
            except Exception as e:
                rfail.append(tid); return tid, None
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            got = list(ex.map(roster, teams))
        if len(rfail) < 30:
            nb = {}
            for tid, r in got:
                if r:
                    nb.update(r[0])
                    if r[1]:
                        coaches[tid] = r[1]
            bio = nb or bio; rstamp = stamp
            sources["rosters"] = {"name": "ESPN team rosters", "status": "connected" if not rfail else "partial", "url": "https://www.espn.com/college-football/teams", "updated": stamp, "checked": stamp, "coverage": len(bio)}
        else:
            errors.append(f"Rosters: {len(rfail)} teams failed; kept the last good rosters")
    for tid, c in coaches.items():
        if tid in teams:
            teams[tid]["coach"] = c

    # NFL Big Board prospects (the site's own consensus board) matched by name and school
    board = read(ROOT / "draft/nfl.json", {}) or {}
    bykey = {}
    for p in pool.values():
        bykey.setdefault(norm(p["name"]), []).append(p)
    matched = 0
    for b in board.get("players", []):
        cands = bykey.get(norm(b.get("n")), [])
        p = next((c for c in cands if str(b.get("sid") or "") == c["teamId"]), None) or (cands[0] if len(cands) == 1 else None)
        if p:
            p["nfl"] = {"rank": b.get("rank"), "pos": b.get("pos"), "hi": b.get("hi"), "lo": b.get("lo"), "on": b.get("on"), "hist": (b.get("hist") or [])[-8:], "id": b.get("id")}
            matched += 1
    players = []
    for p in pool.values():
        p = dict(p)
        for k, v in (bio.get(p["id"]) or {}).items():
            if v:
                p[k] = v
        p["team"] = teams[p["teamId"]]["short"]
        players.append(p)
    players.sort(key=lambda p: (p["teamId"], p["pos"], p["name"]))

    hub = {"schema": 1, "season": year, "seasonLabel": str(year), "updated": stamp, "today": today.isoformat(),
           "current": cur_week, "weeks": weeks, "seasonType": cur,
           "teams": sorted(teams.values(), key=lambda t: (t["fpi"].get("rank") or 999, t["short"])),
           "conferences": confs, "other": other,
           "games": sorted(games.values(), key=lambda g: (g["day"], g.get("at") or "", g["id"])),
           "sources": sources, "errors": errors}
    HUB.parent.mkdir(parents=True, exist_ok=True)
    HUB.write_text(json.dumps(hub, ensure_ascii=False, separators=(",", ":")) + "\n")
    PLAYERS.write_text(json.dumps({"season": year, "updated": stamp, "rosters": rstamp, "boardAsOf": board.get("asof"), "boardMatched": matched,
                                   "players": players}, ensure_ascii=False, separators=(",", ":")) + "\n")
    ROSTERS.write_text(json.dumps({"season": year, "updated": rstamp, "bio": bio, "coaches": coaches}, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps({"teams": len(teams), "conferences": len(confs), "games": len(games), "final": sum(g["state"] == "post" for g in games.values()),
                      "lines": sources["lines"]["coverage"], "players": len(players), "nfl_matched": matched, "week": cur_week, "errors": errors}))


if __name__ == "__main__":
    main()
