#!/usr/bin/env python3
"""CollegeFootballData.com (CFBD) feed for the College Football Hub.

Writes cfb/data/cfbd.json with what ESPN doesn't give the hub:
  - advanced team stats (EPA per play, success rate, explosiveness, havoc, field position; garbage time excluded)
  - SP+ ratings
  - player EPA (season, garbage time excluded)
  - opponent-adjusted EPA (CFBD's WEPA): every team's offense and defense, and each passer's and rusher's
  - Elo and SRS ratings, and player usage (share of his team's plays)
  - betting lines with opening and closing numbers, for this week and last week (closing-line grading)
  - recruiting class rankings, returning production and the transfer portal once they apply (next season)

The key comes from the CFBD_API_KEY environment variable (a GitHub Actions secret). It is never written anywhere.
Without a key the script does nothing. The free tier is 1,000 calls a month, shared with CFBD's basketball API,
so the script pulls at most once a day (about 13 calls), keeps a monthly call log, and stops at a safety cap.
CFBD team and game ids are ESPN's, so everything joins to hub.json directly.
"""
import datetime as dt, json, os, pathlib, sys, urllib.error, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "cfb/data/cfbd.json"
HUB = ROOT / "cfb/data/hub.json"
BASE = "https://api.collegefootballdata.com"
NY = ZoneInfo("America/New_York")
MONTHLY_CAP = 750  # stop well short of the 1,000 free calls


def read(p, default=None):
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return default


def num(x):
    try:
        x = float(x)
        return x if x == x and abs(x) != float("inf") else None
    except (TypeError, ValueError):
        return None


def r(x, n=3):
    x = num(x)
    return None if x is None else round(x, n)


class Client:
    def __init__(self, key, log):
        self.key, self.log = key, log

    def get(self, path, **params):
        month = dt.date.today().strftime("%Y-%m")
        used = self.log.setdefault(month, 0)
        if used >= MONTHLY_CAP:
            raise RuntimeError(f"Monthly safety cap reached ({used} calls)")
        q = urllib.parse.urlencode({k: (str(v).lower() if isinstance(v, bool) else v) for k, v in params.items() if v is not None})
        req = urllib.request.Request(f"{BASE}{path}" + (f"?{q}" if q else ""), headers={
            "Authorization": "Bearer " + self.key, "Accept": "application/json", "User-Agent": "davidsolar-cfb/1.0 (+https://davidsolar.dev/cfb/)"})
        self.log[month] = used + 1
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))


def own_line(v):
    """CFBD's average start is yards to the opponent's goal (about 70); the hub shows the offense's own yard line."""
    v = num(v)
    return None if v is None else round(100 - v if v > 50 else v, 1)


def side(x):
    x = x or {}
    pp, rp, hv, fp = x.get("passingPlays") or {}, x.get("rushingPlays") or {}, x.get("havoc") or {}, x.get("fieldPosition") or {}
    return {"epa": r(x.get("ppa")), "sr": r(x.get("successRate")), "xpl": r(x.get("explosiveness")), "ppo": r(x.get("pointsPerOpportunity"), 2),
            "passEpa": r(pp.get("ppa")), "rushEpa": r(rp.get("ppa")), "passRate": r(pp.get("rate")), "stuff": r(x.get("stuffRate")),
            "lineYds": r(x.get("lineYards"), 2), "havoc": r(hv.get("total")), "start": own_line(fp.get("averageStart")), "plays": num(x.get("plays"))}


def parse_advanced(rows, ids):
    out = {}
    for row in rows or []:
        tid = ids.get(row.get("team"))
        if tid:
            out[tid] = {"off": side(row.get("offense")), "def": side(row.get("defense"))}
    return out


def parse_sp(rows, ids):
    out = {}
    for row in rows or []:
        tid = ids.get(row.get("team"))
        if not tid or num(row.get("rating")) is None:
            continue
        o, d, s = row.get("offense") or {}, row.get("defense") or {}, row.get("specialTeams") or {}
        out[tid] = {"rating": r(row.get("rating"), 1), "rank": row.get("ranking"), "off": r(o.get("rating"), 1), "offRank": o.get("ranking"),
                    "def": r(d.get("rating"), 1), "defRank": d.get("ranking"), "st": r(s.get("rating"), 1), "sow": r(row.get("secondOrderWins"), 1), "sos": r(row.get("sos"), 2)}
    return out


def parse_player_epa(rows, ids):
    out = {}
    for row in rows or []:
        pid, tid = str(row.get("id") or ""), ids.get(row.get("team"))
        if not pid or not tid:  # CFBD includes FCS players; the hub covers FBS
            continue
        a, t = row.get("averagePPA") or {}, row.get("totalPPA") or {}
        out[pid] = {"epa": r(t.get("all"), 1), "pass": r(t.get("pass"), 1), "rush": r(t.get("rush"), 1), "perPlay": r(a.get("all")), "teamId": tid}
    return out


def parse_adjusted(rows, ids):
    """CFBD's opponent-adjusted team metrics (WEPA): offense, and what the defense allowed (lower is better there)."""
    out = {}
    for row in rows or []:
        tid = ids.get(row.get("team")) or (str(row["teamId"]) if row.get("teamId") and str(row["teamId"]) in ids.values() else None)
        if not tid:
            continue
        e, ea = row.get("epa") or {}, row.get("epaAllowed") or {}
        s, sa = row.get("successRate") or {}, row.get("successRateAllowed") or {}
        ru, rua = row.get("rushing") or {}, row.get("rushingAllowed") or {}
        out[tid] = {"epa": r(e.get("total")), "epaA": r(ea.get("total")), "pass": r(e.get("passing")), "passA": r(ea.get("passing")),
                    "rush": r(e.get("rushing")), "rushA": r(ea.get("rushing")), "sr": r(s.get("total")), "srA": r(sa.get("total")),
                    "sd": r(s.get("standardDowns")), "pd": r(s.get("passingDowns")), "line": r(ru.get("lineYards"), 2), "lineA": r(rua.get("lineYards"), 2),
                    "xpl": r(row.get("explosiveness")), "xplA": r(row.get("explosivenessAllowed"))}
    return out


def parse_wepa_players(rows, ids, kind, out):
    """Each FBS passer's or rusher's opponent-adjusted EPA per play and his qualifying plays."""
    for row in rows or []:
        pid = str(row.get("athleteId") or "")
        if not pid or row.get("team") not in ids:
            continue
        out.setdefault(pid, {})[kind] = [r(row.get("wepa")), num(row.get("plays"))]
    return out


def parse_team_values(rows, ids, key):
    out = {}
    for row in rows or []:
        tid = ids.get(row.get("team"))
        if tid and num(row.get(key)) is not None:
            out[tid] = [r(row.get(key), 1), row.get("ranking")] if key == "rating" else r(row.get(key), 0)
    return out


def parse_usage(rows, ids):
    """Share of his team's plays: overall, passes, runs, passing downs, third downs (players with 3%+ of plays overall)."""
    out = {}
    for row in rows or []:
        pid, u = str(row.get("id") or ""), row.get("usage") or {}
        if not pid or row.get("team") not in ids or (num(u.get("overall")) or 0) < 0.03:
            continue
        out[pid] = [r(u.get("overall")), r(u.get("pass")), r(u.get("rush")), r(u.get("passingDowns")), r(u.get("thirdDown"))]
    return out


def parse_lines(rows):
    """Opening and closing numbers per game, home-team margin (positive = home favored), from each book."""
    out = {}
    for g in rows or []:
        books = []
        for ln in g.get("lines") or []:
            sp, so = num(ln.get("spread")), num(ln.get("spreadOpen"))
            books.append({"book": ln.get("provider"), "close": -sp if sp is not None else None, "open": -so if so is not None else None,
                          "total": num(ln.get("overUnder")), "totalOpen": num(ln.get("overUnderOpen"))})
        books = [b for b in books if b["close"] is not None or b["open"] is not None]
        if not books:
            continue
        pref = next((b for b in books if b["book"] and "draftkings" in b["book"].lower()), None) or next((b for b in books if b["book"] and "espn" in b["book"].lower()), None) or books[0]
        out[str(g.get("id"))] = {"open": pref["open"], "close": pref["close"], "total": pref["total"], "totalOpen": pref["totalOpen"], "book": pref["book"], "books": books}
    return out


def main():
    force = "--force" in sys.argv
    key = os.environ.get("CFBD_API_KEY", "").strip()
    if not key:
        print(json.dumps({"cfbd": "skipped", "reason": "CFBD_API_KEY is not set"}))
        return
    now = dt.datetime.now(dt.timezone.utc); today = now.astimezone(NY).date()
    hub = read(HUB, {}) or {}
    year = hub.get("season") or (today.year if today.month >= 3 else today.year - 1)
    old = read(OUT, {}) or {}
    if old.get("season") != year:
        old = {"calls": old.get("calls", {})}
    if old.get("pulled") == today.isoformat() and not force:
        print(json.dumps({"cfbd": "skipped", "reason": "already pulled today"}))
        return
    c = Client(key, dict(old.get("calls") or {}))
    out = dict(old); out.update({"season": year, "source": "CollegeFootballData.com", "url": "https://collegefootballdata.com/"})
    errors = []

    def step(name, fn):
        try:
            fn()
        except Exception as e:
            msg = f"{name}: {e}"
            if isinstance(e, urllib.error.HTTPError) and e.code == 401:
                msg = f"{name}: the CFBD key was refused (401)"
            errors.append(msg)

    # Team names -> ESPN ids (CFBD uses ESPN ids). Refreshed weekly.
    ids = {k: v for k, v in (old.get("ids") or {}).items()}
    if not ids or (old.get("idsPulled") or "") < (today - dt.timedelta(days=7)).isoformat():
        def teams():
            nonlocal ids
            rows = c.get("/teams/fbs", year=year)
            got = {}
            for t in rows:
                for n in [t.get("school")] + list(t.get("alternateNames") or []):
                    if n:
                        got[n] = str(t["id"])
            if len(got) < 120:
                raise ValueError(f"only {len(got)} FBS teams")
            ids = got; out["idsPulled"] = today.isoformat()
        step("teams", teams)
    out["ids"] = ids

    def advanced():
        a = parse_advanced(c.get("/stats/season/advanced", year=year, excludeGarbageTime=True), ids)
        if len(a) < 100:
            raise ValueError(f"only {len(a)} teams")
        out["advanced"] = a
    def sp():
        s = parse_sp(c.get("/ratings/sp", year=year), ids)
        if len(s) < 100:
            raise ValueError(f"only {len(s)} teams")
        out["sp"] = s
    def players():
        p = parse_player_epa(c.get("/ppa/players/season", year=year, threshold=50, excludeGarbageTime=True), ids)
        if len(p) < 150:
            raise ValueError(f"only {len(p)} players")
        out["playerEpa"] = p
    def lines():
        cur = hub.get("current") or {}
        wk, stype = cur.get("week"), "postseason" if cur.get("type") == 3 else "regular"
        got = dict(old.get("lines") or {})
        for w in sorted({w for w in (wk, (wk or 0) - 1) if w and w > 0}):
            got.update(parse_lines(c.get("/lines", year=year, week=w, seasonType=stype)))
        out["lines"] = got
    def adjusted():
        a = parse_adjusted(c.get("/wepa/team/season", year=year), ids)
        if len(a) < 100:
            raise ValueError(f"only {len(a)} teams")
        out["adj"] = a
    def wepa():
        got = {}
        parse_wepa_players(c.get("/wepa/players/passing", year=year), ids, "pass", got)
        parse_wepa_players(c.get("/wepa/players/rushing", year=year), ids, "rush", got)
        if len(got) < 100:
            raise ValueError(f"only {len(got)} players")
        out["wepa"] = got
    def elo():
        e = parse_team_values(c.get("/ratings/elo", year=year), ids, "elo")
        if len(e) < 100:
            raise ValueError(f"only {len(e)} teams")
        out["elo"] = e
    def srs():
        e = parse_team_values(c.get("/ratings/srs", year=year), ids, "rating")
        if len(e) < 100:
            raise ValueError(f"only {len(e)} teams")
        out["srs"] = e
    def usage_players():
        u = parse_usage(c.get("/player/usage", year=year, excludeGarbageTime=True), ids)
        if len(u) < 300:
            raise ValueError(f"only {len(u)} players")
        out["usageP"] = u
    for name, fn in (("advanced", advanced), ("sp", sp), ("players", players), ("lines", lines), ("adjusted", adjusted), ("wepa", wepa),
                     ("elo", elo), ("srs", srs), ("playerUsage", usage_players)):
        step(name, fn)

    # Next season's building blocks, weekly once they exist (recruiting all year; returning production and the portal from December)
    nxt = year + 1
    if (old.get("offPulled") or "") < (today - dt.timedelta(days=7)).isoformat():
        def recruiting():
            rows = c.get("/recruiting/teams", year=nxt)
            out["recruiting"] = {"year": nxt, "teams": {ids[x["team"]]: {"rank": x.get("rank"), "points": r(x.get("points"), 1)} for x in rows if x.get("team") in ids}}
        step("recruiting", recruiting)
        if today.month in (12, 1, 2, 3, 4, 5, 6, 7, 8):
            def returning():
                rows = c.get("/player/returning", year=nxt)
                out["returning"] = {"year": nxt, "teams": {ids[x["team"]]: {"pct": r(x.get("percentPPA")), "pass": r(x.get("percentPassingPPA")), "rush": r(x.get("percentRushingPPA")), "rec": r(x.get("percentReceivingPPA")), "usage": r(x.get("usage"))} for x in rows if x.get("team") in ids}}
            def portal():
                rows = c.get("/player/portal", year=nxt)
                out["portal"] = {"year": nxt, "players": [{"name": " ".join(filter(None, [x.get("firstName"), x.get("lastName")])), "pos": x.get("position"), "from": x.get("origin"), "to": x.get("destination"),
                                                           "fromId": ids.get(x.get("origin")), "toId": ids.get(x.get("destination")), "date": (x.get("transferDate") or "")[:10], "stars": x.get("stars"), "rating": r(x.get("rating"))} for x in rows]}
            step("returning", returning); step("portal", portal)
        out["offPulled"] = today.isoformat()

    def usage():
        u = c.get("/info")
        out["usage"] = {"tier": u.get("tierName"), "limit": u.get("monthlyLimit"), "remaining": u.get("remainingCalls"), "used": u.get("usedCalls"), "resets": u.get("resetAt")}
    step("usage", usage)

    if len(errors) >= 4 and not out.get("advanced"):
        print(json.dumps({"cfbd": "failed", "errors": errors}))
        old["calls"] = c.log  # keep counting calls even when the pull fails
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(old, ensure_ascii=False, separators=(",", ":")) + "\n")
        return
    out["pulled"] = today.isoformat(); out["updated"] = now.isoformat(); out["errors"] = errors; out["calls"] = c.log
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps({"cfbd": "ok", "advanced": len(out.get("advanced") or {}), "sp": len(out.get("sp") or {}), "playerEpa": len(out.get("playerEpa") or {}),
                      "lines": len(out.get("lines") or {}), "adj": len(out.get("adj") or {}), "wepa": len(out.get("wepa") or {}),
                      "elo": len(out.get("elo") or {}), "srs": len(out.get("srs") or {}), "usageP": len(out.get("usageP") or {}), "recruiting": len((out.get("recruiting") or {}).get("teams") or {}), "usage": out.get("usage"), "callsThisMonth": c.log, "errors": errors}))


if __name__ == "__main__":
    main()
