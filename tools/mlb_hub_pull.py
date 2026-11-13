#!/usr/bin/env python3
"""Pull the MLB hub's source data from FanGraphs into tools/mlb_hub/ (trimmed snapshots).

Run by .github/workflows/mlb-hub.yml every morning, or locally:

  python tools/mlb_hub_pull.py            everything
  python tools/mlb_hub_pull.py proj fa     just those parts (proj, rosters, payroll, board, fa)

Sources (all public FanGraphs pages, read once a day, politely spaced):
  proj     Depth Charts, Steamer and ZiPS projections (hitters and pitchers)
  rosters  RosterResource depth charts for all 30 organizations (MLB roles plus every minor league level)
  payroll  RosterResource payroll pages: every contract year by year, options and arbitration years
  board    The Board: prospect grades (FV), risk and ETA
  fa       The free agent tracker for this offseason and the five before it (crowd and signed contracts)
  war      Actual WAR (FanGraphs) for the last three seasons, hitters and pitchers, for the hub's own outlook

Each part writes its own file. When a part fails, its previous file is left alone, so the hub keeps working on
the last good copy. tools/mlb_hub_build.py turns the snapshots into mlb/data/. Standard library only.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "mlb_hub")
FG = "https://www.fangraphs.com"
PAUSE = 6  # seconds between requests
UA = "davidsolar-mlb-hub/1.0 (+https://davidsolar.dev/mlb/)"  # an honest bot name, like the Fantasy Kit's

# FanGraphs team id -> (our abbreviation, payroll page slug)
TEAMS = {
    1: ("LAA", "angels"), 2: ("BAL", "orioles"), 3: ("BOS", "red-sox"), 4: ("CWS", "white-sox"),
    5: ("CLE", "guardians"), 6: ("DET", "tigers"), 7: ("KC", "royals"), 8: ("MIN", "twins"),
    9: ("NYY", "yankees"), 10: ("ATH", "athletics"), 11: ("SEA", "mariners"), 12: ("TB", "rays"),
    13: ("TEX", "rangers"), 14: ("TOR", "blue-jays"), 15: ("ARI", "diamondbacks"), 16: ("ATL", "braves"),
    17: ("CHC", "cubs"), 18: ("CIN", "reds"), 19: ("COL", "rockies"), 20: ("MIA", "marlins"),
    21: ("HOU", "astros"), 22: ("LAD", "dodgers"), 23: ("MIL", "brewers"), 24: ("WSH", "nationals"),
    25: ("NYM", "mets"), 26: ("PHI", "phillies"), 27: ("PIT", "pirates"), 28: ("STL", "cardinals"),
    29: ("SD", "padres"), 30: ("SF", "giants"),
}


def season():
    """The season being projected: next year once the World Series is over (from November on)."""
    t = date.today()
    return t.year + 1 if t.month >= 11 else t.year


def fetch(path, kind="json"):
    for attempt in range(4):
        try:
            req = urllib.request.Request(FG + path, headers={
                "User-Agent": UA, "Accept": "application/json" if kind == "json" else "text/html"})
            with urllib.request.urlopen(req, timeout=90) as res:
                body = res.read().decode("utf-8", "replace")
            time.sleep(PAUSE)  # be polite: FanGraphs rate-limits fast clients
            if kind == "json":
                return json.loads(body)
            return body
        except urllib.error.HTTPError as e:
            body = e.read()[:300].decode("utf-8", "replace") if hasattr(e, "read") else ""
            if e.code == 429 and attempt < 3:  # too fast: wait it out
                print(f"  429 on {path[:80]}, waiting {60 * (attempt + 1)}s")
                time.sleep(60 * (attempt + 1))
                continue
            if attempt == 3 or e.code in (403, 404):
                raise RuntimeError(f"HTTP {e.code} on {path[:80]}: {body[:200]!r}")
            print(f"  retry {path[:90]}: {e}")
            time.sleep(3 + attempt * 5)
        except Exception as e:
            if attempt == 3:
                raise
            print(f"  retry {path[:90]}: {e}")
            time.sleep(3 + attempt * 5)


def next_data(html):
    """The data RosterResource pages render with: the first dehydrated query in __NEXT_DATA__."""
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        raise ValueError("no __NEXT_DATA__ on the page (blocked or redesigned?)")
    q = json.loads(m.group(1))["props"]["pageProps"]["dehydratedState"]["queries"]
    return q[0]["state"]["data"]


def num(v, nd=None):
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, nd) if nd is not None else f


def save(name, data):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
    print(f"  wrote {name} ({os.path.getsize(path) // 1024} KB)")


def table(rows, cols):
    """Rows of dicts -> {"cols": [...], "rows": [[...]]}, which is far smaller on disk."""
    return {"cols": [c[0] for c in cols], "rows": [[fn(r) for _, fn in cols] for r in rows]}


# ---------------------------------------------------------------- projections

BAT = [("fg", lambda r: str(r.get("playerid") or "")), ("mlbam", lambda r: r.get("xMLBAMID")),
       ("name", lambda r: r.get("PlayerName")), ("tm", lambda r: r.get("teamid") or r.get("Team")),
       ("pos", lambda r: r.get("minpos") or r.get("Pos")), ("pa", lambda r: num(r.get("PA"), 0)),
       ("war", lambda r: num(r.get("WAR"), 2)), ("wrc", lambda r: num(r.get("wRC+"), 0)),
       ("off", lambda r: num(r.get("Off"), 1)), ("def", lambda r: num(r.get("Def"), 1)),
       ("r", lambda r: num(r.get("R"), 0)), ("hr", lambda r: num(r.get("HR"), 0)),
       ("avg", lambda r: num(r.get("AVG"), 3)), ("obp", lambda r: num(r.get("OBP"), 3)),
       ("slg", lambda r: num(r.get("SLG"), 3)), ("sb", lambda r: num(r.get("SB"), 0))]
PIT = [("fg", lambda r: str(r.get("playerid") or "")), ("mlbam", lambda r: r.get("xMLBAMID")),
       ("name", lambda r: r.get("PlayerName")), ("tm", lambda r: r.get("teamid") or r.get("Team")),
       ("gs", lambda r: num(r.get("GS"), 0)), ("g", lambda r: num(r.get("G"), 0)),
       ("ip", lambda r: num(r.get("IP"), 0)), ("war", lambda r: num(r.get("WAR"), 2)),
       ("era", lambda r: num(r.get("ERA"), 2)), ("fip", lambda r: num(r.get("FIP"), 2)),
       ("kbb", lambda r: num(r.get("K-BB%"), 3)), ("r", lambda r: num(r.get("R"), 0)),
       ("sv", lambda r: num(r.get("SV"), 0)), ("k9", lambda r: num(r.get("K/9"), 1))]


def pull_proj():
    out = {"season": season(), "systems": {}}
    for system in ("fangraphsdc", "steamer", "zips"):
        got = {}
        for stats, cols in (("bat", BAT), ("pit", PIT)):
            rows = fetch(f"/api/projections?type={system}&stats={stats}&pos=all&team=0&players=0&lg=all")
            if not isinstance(rows, list):
                rows = []
            print(f"  {system} {stats}: {len(rows)} players")
            got[stats] = table(rows, cols)
        if got["bat"]["rows"] or got["pit"]["rows"]:
            out["systems"][system] = got
    if "fangraphsdc" not in out["systems"] and "steamer" not in out["systems"]:
        raise RuntimeError("no projections came back")
    save("proj.json", out)


# ---------------------------------------------------------------- rosters

def pull_rosters():
    keep = ["type", "role", "position", "player", "playerid", "mlbamid", "age", "bats", "throws", "position1",
            "servicetime", "options", "roster40", "eta", "projectedlevel", "acquired", "injurynotes", "dbTeam",
            "draftyear", "draftround", "isNRI"]
    out = {"season": season(), "teams": {}}
    for tid in TEAMS:
        rows = fetch(f"/api/depth-charts/roster?teamid={tid}")
        out["teams"][str(tid)] = [[r.get(k) for k in keep] for r in rows if r.get("player")]
        print(f"  roster {TEAMS[tid][0]}: {len(rows)}")
    out["cols"] = keep
    save("rosters.json", out)


# ---------------------------------------------------------------- payroll

def pull_payroll(per_run=10, max_age_days=3):
    """Contracts change slowly, so each run refreshes the 10 stalest teams: every team every three days."""
    path = os.path.join(OUT, "payroll.json")
    out = {"season": season(), "teams": {}, "fetched": {}}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            prev = json.load(f)
        if prev.get("season") == season():
            out["teams"], out["fetched"] = prev.get("teams", {}), prev.get("fetched", {})
    today = date.today()
    def age(tid):
        d = out["fetched"].get(str(tid))
        return (today - date.fromisoformat(d)).days if d else 999
    if len(out["teams"]) < 30:
        per_run = 30  # first fill: get every team now
    todo = sorted((t for t in TEAMS if age(t) >= max_age_days or str(t) not in out["teams"]), key=lambda t: -age(t))
    if not todo:
        print("  every team is fresh")
    done = 0
    for tid in todo[:per_run]:
        abbr, slug = TEAMS[tid]
        try:
            d = next_data(fetch(f"/roster-resource/payroll/{slug}", kind="html"))
        except Exception as e:
            print(f"  payroll {abbr} failed, keeping the old copy: {e}")
            continue
        rows = []
        for c in d.get("dataContract") or []:
            s = c.get("contractSummary") or {}
            years = []
            for y in c.get("contractYears") or []:
                years.append([y.get("Season"), num(y.get("Salary"), 0), y.get("Type"), y.get("ArbYear"),
                              num(y.get("ArbSalaryProjection"), 0), num(y.get("OptionBuyout"), 0),
                              num(y.get("TotalCBTHit"), 0)])
            rows.append({"fg": str(s.get("playerId") or ""), "mlbam": s.get("MLBAMID"), "name": s.get("playerName"),
                         "type": s.get("ContractType"), "desc": c.get("description"), "aav": num(s.get("AAV"), 0),
                         "total": num(s.get("ContractTotal"), 0), "start": s.get("startSeason"),
                         "end": s.get("endSeason"), "endAll": s.get("endSeasonAll"), "age": num(s.get("age"), 1),
                         "st": s.get("servicetime") or s.get("servicetimeFallback"),
                         "note": s.get("LongContractSummaryPayrollNote"), "years": years})
        dead = [[p.get("Season"), num(p.get("PaymentAmount"), 0), p.get("PaymentDescription")]
                for p in d.get("dataOtherPayments") or []]
        out["teams"][str(tid)] = {"contracts": rows, "other": dead}
        out["fetched"][str(tid)] = today.isoformat()
        done += 1
        print(f"  payroll {abbr}: {len(rows)} contracts")
    out["yearCols"] = ["season", "salary", "type", "arbYear", "arbProj", "buyout", "cbt"]
    save("payroll.json", out)
    print(f"  {len(out['teams'])}/30 teams on file")
    if todo and not done:
        raise RuntimeError("no payroll page answered")


# ---------------------------------------------------------------- prospects

def pull_board():
    """The newest list that's really out: next year's once published, else this year's updated in-season list."""
    y = season() - 1
    rows, used = [], None
    for d, yr in ((f"{y + 1}prospect", y + 1), (f"{y}updated", y), (f"{y}prospect", y)):
        try:
            got = fetch(f"/api/prospects/board/prospects-list?draft={d}&season={yr}&playerid=&position=&statType=player")
        except Exception as e:
            print(f"  board {d}: {e}")
            continue
        ranked = [r for r in got if str(r.get("cOVR") or "").isdigit()] if isinstance(got, list) else []
        same = sum(1 for r in ranked[:40] if str(r.get("cSeason") or r.get("Season") or "").startswith(str(yr)))
        print(f"  board {d}: {len(got) if isinstance(got, list) else 0} rows, {len(ranked)} ranked")
        if len(ranked) >= 50 and same >= 30:
            rows, used = got, d
            break
    if not rows:
        raise RuntimeError("no prospect list answered")
    cols = [("fg", lambda r: str(r.get("PlayerId") or r.get("UPID") or "")), ("name", lambda r: r.get("playerName")),
            ("tid", lambda r: r.get("playerTeamId")), ("pos", lambda r: r.get("Position") or r.get("positionDB")),
            ("age", lambda r: num(r.get("Age"), 1)), ("fv", lambda r: r.get("cFV") or r.get("FV_Current")),
            ("eta", lambda r: r.get("cETA") or r.get("ETA_Current")), ("risk", lambda r: r.get("cRisk")),
            ("ovr", lambda r: num(r.get("cOVR") or r.get("Ovr_Rank"), 0)),
            ("org", lambda r: num(r.get("cORG") or r.get("Org_Rank"), 0)),
            ("lvl", lambda r: r.get("mlevel") or r.get("llevel")), ("tldr", lambda r: (r.get("TLDR") or "")[:240])]
    out = {"list": used, **table(rows, cols)}
    print(f"  board {used}: {len(rows)} prospects")
    save("board.json", out)


# ---------------------------------------------------------------- free agents

def pull_fa():
    keep = ["playerId", "playerName", "position", "age", "war_prev", "war_proj", "team_prev", "free_agent_status",
            "qo", "qo_accepted", "med_years", "med_aav", "servicetime", "team_new", "team_new_shortname",
            "contract_years", "ContractTotal", "YearsTotal", "aav", "option_type", "option_status", "option_holder",
            "ContractType", "Bats", "Throws"]
    out = {"cols": keep, "seasons": {}}
    prev_path = os.path.join(OUT, "fa.json")
    if os.path.exists(prev_path):  # older classes rarely change: keep them if a fetch fails
        with open(prev_path, encoding="utf-8") as f:
            out["seasons"] = json.load(f).get("seasons", {})
    for yr in range(season() - 5, season() + 1):
        if yr < season() and str(yr) in out["seasons"] and date.today().weekday() != 0:
            continue  # past classes only change on Mondays' refresh
        try:
            rows = next_data(fetch(f"/roster-resource/free-agent-tracker?season={yr}", kind="html"))
            out["seasons"][str(yr)] = [[r.get(k) for k in keep] for r in rows]
            print(f"  free agents {yr}: {len(rows)} ({sum(1 for r in rows if r.get('aav'))} signed)")
        except Exception as e:
            print(f"  free agents {yr} failed, keeping the old copy: {e}")
            if yr == season() and str(yr) not in out["seasons"]:
                raise
    save("fa.json", out)


# ---------------------------------------------------------------- actual WAR, last three seasons

def pull_war():
    out = {"seasons": {}}
    prev_path = os.path.join(OUT, "war.json")
    if os.path.exists(prev_path):  # finished seasons don't change: keep them if a fetch fails
        with open(prev_path, encoding="utf-8") as f:
            out["seasons"] = json.load(f).get("seasons", {})
    s0 = season()
    keep = {str(y) for y in range(s0 - 3, s0)}
    out["seasons"] = {k: v for k, v in out["seasons"].items() if k in keep}
    got = 0
    for y in range(s0 - 3, s0):
        if str(y) in out["seasons"] and y < s0 - 1:
            continue  # an older finished season already on file
        rec = {}
        for stats, cols in (("bat", [("fg", lambda r: str(r.get("playerid") or "")), ("mlbam", lambda r: r.get("xMLBAMID")),
                                      ("pa", lambda r: num(r.get("PA"), 0)), ("war", lambda r: num(r.get("WAR"), 2))]),
                            ("pit", [("fg", lambda r: str(r.get("playerid") or "")), ("mlbam", lambda r: r.get("xMLBAMID")),
                                      ("ip", lambda r: num(r.get("IP"), 1)), ("gs", lambda r: num(r.get("GS"), 0)),
                                      ("war", lambda r: num(r.get("WAR"), 2))])):
            d = fetch(f"/api/leaders/major-league/data?pos=all&stats={stats}&lg=all&qual=0&type=8&season={y}&season1={y}"
                      f"&month=0&team=0&pageitems=3000&pagenum=1&ind=0&rost=0&players=&sortdir=default&sortstat=WAR")
            rows = d.get("data", []) if isinstance(d, dict) else (d if isinstance(d, list) else [])
            print(f"  {y} {stats}: {len(rows)} players")
            rec[stats] = table(rows, cols)
        if rec["bat"]["rows"] or rec["pit"]["rows"]:
            out["seasons"][str(y)] = rec
            got += 1
    if not out["seasons"]:
        raise RuntimeError("no WAR came back")
    save("war.json", out)


PARTS = {"war": pull_war, "proj": pull_proj, "rosters": pull_rosters, "board": pull_board, "fa": pull_fa, "payroll": pull_payroll}

if __name__ == "__main__":
    want = sys.argv[1:] or list(PARTS)
    failed, errors = [], {}
    for p in want:
        print(f"== {p}")
        try:
            PARTS[p]()
        except Exception as e:  # keep the last good snapshot and move on
            print(f"  FAILED: {e}")
            failed.append(p)
            errors[p] = str(e)[:400]
    status = {"pulled": date.today().isoformat(), "failed": failed, "errors": errors}
    save("status.json", status)
    if len(failed) == len(want):
        sys.exit(1)
