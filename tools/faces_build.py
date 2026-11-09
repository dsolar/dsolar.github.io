#!/usr/bin/env python3
"""Build the player faces registry: assets/faces/<sport>.json, {name key: photo id}, read by assets/faces.js.

  python tools/faces_build.py            everything (needs the network for the bulk lists and ESPN search)
  python tools/faces_build.py --local    only what's already in the repo (no network)

Run by .github/workflows/faces.yml every morning. A name key is the player's name without accents, punctuation or
suffixes ("Ronald Acuña Jr." -> "ronald-acuna"), the same as DSFaces.slug in assets/faces.js.

Where the ids come from, in order (the first one found for a name wins):
  mlb    MLBAM ids: the MLB hub's players, the season stats in tools/mlb/, then MLB's Stats API, every season since 1980
  nfl    ESPN ids: the Fantasy Kit pool, then Sleeper's player list (it carries each player's ESPN id)
  nba    ESPN ids: Hard Cap's ESPN rosters, then every NBA roster on ESPN
  ncaab, ncaaf   ESPN college ids for the draft Big Board's prospects
Any name a page on the site shows that's still missing is looked up on ESPN's search, a few hundred a run, and
remembered in tools/faces_cache.json (a miss is tried again after 30 days). Standard library only.
"""
import glob
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "assets", "faces")
CACHE = os.path.join(HERE, "faces_cache.json")
UA = "davidsolar-faces/1.0 (+https://davidsolar.dev/)"
SPORTS = ["mlb", "nba", "nfl", "ncaab", "ncaaf"]
ESPN_LEAGUE = {"nba": "nba", "nfl": "nfl", "mlb": "mlb", "ncaab": "mens-college-basketball", "ncaaf": "college-football"}
SEARCH_PER_RUN = 900
LOCAL = "--local" in sys.argv


def slug(name):
    s = unicodedata.normalize("NFD", str(name or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"[.'’`]", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    s = re.sub(r"\s+(jr|sr|ii|iii|iv|v)$", "", s)
    s = re.sub(r"\s+\((batter|pitcher)\)$", "", s)
    return re.sub(r"\s+", "-", s)


def jload(path, default=None):
    p = os.path.join(ROOT, path)
    if not os.path.exists(p):
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def jsdata(path, var):
    """window.VAR = {...}; from a generated data.js"""
    p = os.path.join(ROOT, path)
    if not os.path.exists(p):
        return None
    s = open(p, encoding="utf-8").read()
    m = re.search(r"window\." + var + r"\s*=\s*(\{.*\}|\[.*\])\s*;?\s*$", s, re.S)
    return json.loads(m.group(1)) if m else None


def get(url, timeout=40):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)


reg = {s: {} for s in SPORTS}


def add(sport, name, pid, why=""):
    k = slug(name)
    if not k or pid in (None, "", 0, "0"):
        return
    if k not in reg[sport]:
        reg[sport][k] = int(pid) if str(pid).isdigit() else pid


# ---------------------------------------------------------------- what's already in the repo

def local_sources():
    hub = jload("mlb/data/hub.json", {}) or {}
    for p in hub.get("players", []):
        if isinstance(p.get("id"), int):
            add("mlb", p["n"], p["id"])
    for f in sorted(glob.glob(os.path.join(HERE, "mlb", "*.json")), reverse=True):  # newest season first
        d = json.load(open(f, encoding="utf-8"))
        for grp in ("hitting", "pitching"):
            for r in d.get(grp, []):
                add("mlb", r.get("name"), r.get("id"))
    kit = jload("fantasy-kit/data/mlb.json", {}) or {}
    for p in kit.get("players", []):
        if str(p.get("id", "")).isdigit():
            add("mlb", p["n"], p["id"])
    nfl = jload("fantasy-kit/data/nfl.json", {}) or {}
    for p in nfl.get("players", []):
        add("nfl", p.get("n"), p.get("espn"))
    nba = jload("fantasy-kit/data/nba.json", {}) or {}
    for p in nba.get("players", []):
        add("nba", p.get("n"), p.get("espn"))
    hc = jload("hardcap/stats.json", {}) or {}
    for k, r in (hc.get("rosters") or {}).items():
        if len(r) > 3 and r[3]:
            add("nba", r[1], r[3])


# ---------------------------------------------------------------- bulk lists from the network

def mlb_bulk():
    for y in range(date.today().year, 1979, -1):
        try:
            d = get(f"https://statsapi.mlb.com/api/v1/sports/1/players?season={y}")
        except Exception as e:
            print(f"  MLB {y}: {e}")
            continue
        for p in d.get("people", []):
            add("mlb", p.get("fullName"), p.get("id"))
            if p.get("useName") and p.get("lastName"):
                add("mlb", f"{p['useName']} {p['lastName']}", p.get("id"))
        time.sleep(0.3)
    print(f"  MLB: {len(reg['mlb'])} names")


def nfl_bulk():
    try:
        allp = get("https://api.sleeper.app/v1/players/nfl", timeout=120)
    except Exception as e:
        print(f"  Sleeper NFL: {e}")
        return
    # active players first, so a current player wins a shared name
    rows = sorted(allp.values(), key=lambda q: (not q.get("active"), -(q.get("years_exp") or 0)))
    for q in rows:
        if q.get("espn_id") and q.get("full_name"):
            add("nfl", q["full_name"], q["espn_id"])
    print(f"  NFL: {len(reg['nfl'])} names")


def nba_bulk():
    for tid in range(1, 31):
        try:
            d = get(f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{tid}/roster")
        except Exception as e:
            print(f"  ESPN NBA roster {tid}: {e}")
            continue
        ath = d.get("athletes") or []
        if ath and isinstance(ath[0], dict) and "items" in ath[0]:
            ath = [a for g in ath for a in g.get("items", [])]
        for a in ath:
            add("nba", a.get("displayName"), a.get("id"))
        time.sleep(0.3)
    print(f"  NBA: {len(reg['nba'])} names")


# ---------------------------------------------------------------- every name a page shows

def wanted():
    w = {s: set() for s in SPORTS}
    gtp = jsdata("guess-the-pick/data.js", "GTP_DATA") or {}
    for lg in ("nba", "nfl"):
        for r in gtp.get(lg, []):
            w[lg].add(r["n"])
    jm = jsdata("journeyman/data.js", "JM_DATA") or {}
    for lg in ("nba", "nfl", "mlb"):
        for r in jm.get(lg, []):
            w[lg].add(r["n"])
    for r in jsdata("scouting-report/data.js", "SR_DATA") or []:
        if r.get("lg") in w:
            w[r["lg"]].add(r["n"])
    for p in jload("src/31st-franchise/players.json", []) or []:
        w["nba"].add(p["n"])
    cel = jload("celtics/data.json", {}) or {}
    for p in cel.get("players", []):
        w["nba"].add(p["n"])
    for lst in (cel.get("draft") or {}).values():
        for p in lst:
            w["ncaab"].add(p["n"])
    hc = jload("hardcap/stats.json", {}) or {}
    for v in (hc.get("names") or {}).values():
        w["nba"].add(v[0])
    for lg, sp in (("nba", "ncaab"), ("nfl", "ncaaf")):
        for p in (jload(f"draft/{lg}.json", {}) or {}).get("players", []):
            w[sp].add(p["n"])
    g = jload("guillotine/data.json", {}) or {}
    for t in g.get("teams", []):
        for r in t.get("roster", []):
            if r.get("name"):
                w["nfl"].add(r["name"])
    y = jload("yoenis/data.json", {}) or {}
    for lst in (y.get("awards") or {}).values():
        for a in lst:
            w["mlb"].add(a.get("p"))
    for lst in (y.get("keepers2027") or {}).values():
        for k in lst:
            w["mlb"].add(k.get("p"))
    for n in (y.get("stats2026") or {}):
        w["mlb"].add(n)
    ptc = os.path.join(ROOT, "paint-the-corners", "engine.js")
    if os.path.exists(ptc):
        for n in re.findall(r"name:\s*'([^']+)'", open(ptc, encoding="utf-8").read()):
            w["mlb"].add(n)
    return {s: {n for n in v if n} for s, v in w.items()}


def espn_search(name, sport):
    """ESPN's search: the athlete whose name matches, in this sport's league (or college, for prospects)"""
    q = urllib.parse.quote(name)
    d = get(f"https://site.web.api.espn.com/apis/search/v2?query={q}&limit=10&type=player")
    want = slug(name)
    best = None
    for grp in d.get("results") or []:
        for c in grp.get("contents") or []:
            if slug(c.get("displayName")) != want:
                continue
            m = re.search(r"~a:(\d+)", c.get("uid") or "")
            if not m:
                continue
            lg = c.get("defaultLeagueSlug") or ""
            pid = m.group(1)
            if lg == ESPN_LEAGUE[sport]:
                return int(pid)
            # a pro page showing a college player (or the reverse): keep his photo from the other league
            if best is None and lg in ESPN_LEAGUE.values():
                other = [k for k, v in ESPN_LEAGUE.items() if v == lg][0]
                if (sport, other) in (("nba", "ncaab"), ("ncaab", "nba"), ("nfl", "ncaaf"), ("ncaaf", "nfl")):
                    best = f"{other}:{pid}"
    return best


def search_missing(want):
    cache = {}
    if os.path.exists(CACHE):
        cache = json.load(open(CACHE, encoding="utf-8"))
    today = date.today()
    stale = (today - timedelta(days=30)).isoformat()
    for k, (pid, when) in cache.items():  # what earlier runs found
        sport, key = k.split("|", 1)
        if pid and sport in reg and key not in reg[sport]:
            reg[sport][key] = pid
    todo = []
    for sport in ("ncaab", "ncaaf", "nba", "nfl", "mlb"):  # the Big Board's prospects first: they change most
        for n in sorted(want[sport]):
            key = slug(n)
            if key in reg[sport]:
                continue
            c = cache.get(f"{sport}|{key}")
            if c and (c[0] or c[1] > stale):
                continue
            todo.append((sport, n, key))
    print(f"  ESPN search: {len(todo)} names to look up, {min(len(todo), SEARCH_PER_RUN)} this run")
    found = 0
    for sport, n, key in todo[:SEARCH_PER_RUN]:
        try:
            pid = espn_search(n, sport)
        except Exception as e:
            print(f"  search {n}: {e}")
            continue
        cache[f"{sport}|{key}"] = [pid, today.isoformat()]
        if pid:
            reg[sport][key] = pid
            found += 1
        time.sleep(0.35)
    print(f"  ESPN search: found {found}")
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(cache, f, separators=(",", ":"), ensure_ascii=False, sort_keys=True)


def main():
    local_sources()
    want = wanted()
    if not LOCAL:
        for fn in (nba_bulk, nfl_bulk, mlb_bulk):
            try:
                fn()
            except Exception as e:
                print(f"  {fn.__name__} failed: {e}")
        search_missing(want)
    os.makedirs(OUT, exist_ok=True)
    for sport in SPORTS:
        # keep the file to what pages can use: every name a page shows, plus current players for the league pages
        ids = reg[sport]
        if sport == "mlb" and len(ids) > 25000:
            keep = {slug(n) for n in want["mlb"]} | {k for k, v in ids.items() if isinstance(v, int) and v >= 500000}
            ids = {k: v for k, v in ids.items() if k in keep}
        path = os.path.join(OUT, f"{sport}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"built": date.today().isoformat(), "ids": dict(sorted(ids.items()))}, f, separators=(",", ":"), ensure_ascii=False)
        cov = sum(1 for n in want[sport] if slug(n) in ids)
        print(f"wrote assets/faces/{sport}.json: {len(ids)} names, {cov}/{len(want[sport])} of the names pages show")


if __name__ == "__main__":
    main()
