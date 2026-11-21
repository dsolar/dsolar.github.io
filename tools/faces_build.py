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
remembered in tools/faces_cache.json (a miss is tried again after 30 days).

Then, for every name a page shows:
  tools/faces_fix.json   hand fixes, applied last: {"nba": {"Ron Holland": 4683771}} (an id, "league:id", another
                         name whose photo to use, or null for no photo). This is where a wrong match gets corrected.
  photo check            each photo address is asked for once every 14 days (tools/faces_checked.json); one the
                         photo server answers 404 for is left out, so the page shows initials without a failed request.
  assets/faces/report.json   coverage for each sport: names shown, how many have a photo, the ones that don't, and
                         shared names (two players with one name key) worth a look. The daily freshness check reads it.
Standard library only.
"""
import glob
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "assets", "faces")
CACHE = os.path.join(HERE, "faces_cache.json")
CHECKED = os.path.join(HERE, "faces_checked.json")
FIX = os.path.join(HERE, "faces_fix.json")
CHECK_DAYS = 14
SEARCH_SINCE = "2026-11-21"  # misses from before the search tried plain and last-name queries get one more try
CHECK_PER_RUN = 2500
UA = "davidsolar-faces/1.0 (+https://davidsolar.dev/)"
SPORTS = ["mlb", "nba", "nfl", "ncaab", "ncaaf"]
ESPN_LEAGUE = {"nba": "nba", "nfl": "nfl", "mlb": "mlb", "ncaab": "mens-college-basketball", "ncaaf": "college-football"}
SEARCH_PER_RUN = 900
LOCAL = "--local" in sys.argv


def slug(name):
    """Names to registry keys, the same as slug() in assets/faces.js: no accents, punctuation, suffixes or
    parentheses, and initials joined ("A. J. Pierzynski" and "AJ Pierzynski" -> "aj-pierzynski", "D Angelo
    Russell" -> "dangelo-russell")"""
    s = unicodedata.normalize("NFD", str(name or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"\([^)]*\)|\"[^\"]*\"|“[^”]*”", " ", s)
    s = re.sub(r"[.'’`]", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    s = re.sub(r"\s+(jr|sr|ii|iii|iv|v)$", "", s)
    out, single = [], False
    for w in s.split():
        if len(w) == 1 and single:
            out[-1] += w
        else:
            out.append(w)
        single = len(w) == 1 and (single or len(out[-1]) == 1)
    if len(out) >= 3 and len(out[0]) == 1:
        out[0] += out.pop(1)
    return "-".join(out)


def suffix(name):
    m = re.search(r"\s(jr|sr|ii|iii|iv|v)\.?$", unicodedata.normalize("NFD", str(name or "")).lower().strip())
    return m.group(1) if m else ""


def skey(name):
    """The key with the suffix kept ("marvin-harrison~jr"), so a father and son can have their own photos. Pages
    look this up first, then the plain key, the same as find() in assets/faces.js."""
    x = suffix(name)
    return slug(name) + ("~" + x if x else "")


def resolve(d, name):
    """the key a name finds in d: its suffixed key, then its plain one"""
    for k in (skey(name), slug(name)):
        if k in d:
            return k
    return None


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


def get(url, timeout=40, raw=False):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*" if raw else "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read().decode("utf-8")
                return body if raw else json.loads(body)
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)


reg = {s: {} for s in SPORTS}
# every id seen for a name key, with whether it came from a current list (a shared name between two current players
# is the one that can show the wrong face)
seen = {s: {} for s in SPORTS}
by_suffix = {s: set() for s in SPORTS}  # plain keys a suffixed name holds for now


def add(sport, name, pid, why="", current=True):
    k = slug(name)
    if not k or pid in (None, "", 0, "0"):
        return
    v = int(pid) if str(pid).isdigit() else pid
    if current:
        seen[sport].setdefault(k, set()).add(v)
    k2 = skey(name)
    # the plain key belongs to the player without a suffix when there is one (Ken Griffey, not Ken Griffey Jr.,
    # who has his own "ken-griffey~jr")
    if k not in reg[sport] or (k in by_suffix[sport] and k2 == k):
        reg[sport][k] = v
        if k2 != k:
            by_suffix[sport].add(k)
        else:
            by_suffix[sport].discard(k)
    if k2 != k and k2 not in reg[sport]:
        reg[sport][k2] = v


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
        cur = y >= date.today().year - 1
        for p in d.get("people", []):
            add("mlb", p.get("fullName"), p.get("id"), current=cur)
            if p.get("useName") and p.get("lastName"):
                add("mlb", f"{p['useName']} {p['lastName']}", p.get("id"), current=cur)
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
            add("nfl", q["full_name"], q["espn_id"], current=bool(q.get("active")))
    print(f"  NFL: {len(reg['nfl'])} names")


def nba_bulk():
    # the same ESPN hosts Hard Cap reads rosters from (the first answers from GitHub's runners)
    hosts = ["https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{tid}/roster?region=us&lang=en&contentorigin=espn",
             "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{tid}/roster"]
    for tid in range(1, 31):
        d = None
        for h in hosts:
            try:
                d = get(h.format(tid=tid))
                break
            except Exception as e:
                print(f"  ESPN NBA roster {tid} ({h.split('/')[2]}): {e}")
        if not d:
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
    for f, sp in (("nba", "ncaab"), ("nba2028", "ncaab"), ("nfl", "ncaaf")):
        for p in (jload(f"draft/{f}.json", {}) or {}).get("players", []):
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
    # Draft Lab's pools and the NFL Hub: players without their own photo id ask by name
    for sp in ("nfl", "nba"):
        for p in (jload(f"fantasy-kit/data/{sp}.json", {}) or {}).get("players", []):
            if not p.get("espn") and p.get("n") and not str(p.get("id", "")).startswith("DEF"):
                w[sp].add(p["n"])
    for p in (jload("nfl/data/league.json", {}) or {}).get("players") or []:
        if not p.get("espn") and not p.get("hs") and p.get("n"):
            w["nfl"].add(p["n"])
    ptc = os.path.join(ROOT, "paint-the-corners", "engine.js")
    if os.path.exists(ptc):
        for n in re.findall(r"name:\s*'([^']+)'", open(ptc, encoding="utf-8").read()):
            w["mlb"].add(n)
    # people only: a team's defense shows its logo, and Paint the Corners' pitch names aren't players
    teams = {"cardinals", "falcons", "ravens", "bills", "panthers", "bears", "bengals", "browns", "cowboys", "broncos",
             "lions", "packers", "texans", "colts", "jaguars", "chiefs", "raiders", "chargers", "rams", "dolphins",
             "vikings", "patriots", "saints", "giants", "jets", "eagles", "steelers", "49ers", "seahawks", "buccaneers",
             "titans", "commanders"}
    def person(n):
        p = slug(n).split("-")
        return len(p) >= 2 and p[-1] not in teams
    return {s: {n for n in v if n and person(n)} for s, v in w.items()}


def espn_search(name, sport):
    """ESPN's search: the athlete whose name matches, in this sport's league (or college, for prospects). ESPN's
    search can miss on a suffix or a nickname, so it asks again with the plain name, then the last name alone."""
    plain = " ".join(w for w in re.sub(r"\([^)]*\)|\"[^\"]*\"", " ", name).split() if not re.match(r"^(jr|sr|ii|iii|iv|v)\.?$", w, re.I))
    tries = list(dict.fromkeys([name, plain, plain.split()[-1] if plain.split() else name]))
    for i, q in enumerate(tries):
        pid = espn_search_once(name, q, sport, limit=25 if i == len(tries) - 1 and len(tries) > 1 else 10)
        if pid:
            return pid
        if i < len(tries) - 1:
            time.sleep(0.3)
    return None


def espn_search_once(name, query, sport, limit=10):
    q = urllib.parse.quote(query)
    d = get(f"https://site.web.api.espn.com/apis/search/v2?query={q}&limit={limit}&type=player")
    want = slug(name)
    best = None
    # Close spellings count too (JoJo/Jojo, Na'jai/Najai, O.J./OJ, a dropped middle name): same last name and the
    # first names agree on their first three letters. The exact name still wins when ESPN has it.
    w_parts = want.split("-")
    # A matching suffix (or none on either) outranks an exact name with a different one: "Patrick Surtain II" is
    # ESPN's "Pat Surtain II", not his father Patrick Surtain, and "Marvin Harrison" isn't Marvin Harrison Jr.
    sx = suffix(name)
    def close(n):
        k = slug(n)
        p = k.split("-")
        near = k == want or (len(p) >= 2 and p[-1] == w_parts[-1] and p[0][:3] == w_parts[0][:3])
        if not near:
            return 0
        if suffix(n) == sx:
            return 4 if k == want else 3
        return 2 if k == want else (0 if sx else 1)
    cands = sorted(((close(c.get("displayName")), c) for grp in d.get("results") or [] for c in grp.get("contents") or []), key=lambda x: -x[0])
    for score, c in cands:
        if not score:
            continue
        m = re.search(r"~a:(\d+)", c.get("uid") or "")
        if not m:
            continue
        lg = c.get("defaultLeagueSlug") or ""
        pid = m.group(1)
        if lg == ESPN_LEAGUE[sport]:
            return f"espnmlb:{pid}" if sport == "mlb" else int(pid)
        # a pro page showing a college player (or the reverse): keep his photo from the other league (exact names only)
        if best is None and score in (2, 4) and lg in ESPN_LEAGUE.values():
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
        if pid and sport in reg and (key not in reg[sport] or key in by_suffix[sport]):
            reg[sport][key] = pid
            by_suffix[sport].discard(key)
    todo = []
    for sport in ("ncaab", "ncaaf", "nba", "nfl", "mlb"):  # the Big Board's prospects first: they change most
        for n in sorted(want[sport]):
            key = skey(n)  # a name with a suffix needs its own entry: the plain one may be his father
            # a name without one whose entry came from a "Jr." (Marvin Harrison, held by Marvin Harrison Jr.) is looked up too
            if key in reg[sport] and not (key in by_suffix[sport] and not suffix(n)):
                continue
            c = cache.get(f"{sport}|{key}")
            if c and (c[0] or (c[1] > stale and c[1] >= SEARCH_SINCE)):
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
            by_suffix[sport].discard(key)
            found += 1
        time.sleep(0.35)
    print(f"  ESPN search: found {found}")
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(cache, f, separators=(",", ":"), ensure_ascii=False, sort_keys=True)


def apply_fixes():
    """tools/faces_fix.json: hand fixes, applied over everything else"""
    if not os.path.exists(FIX):
        return {}
    fix = json.load(open(FIX, encoding="utf-8"))
    for sport, names in fix.items():
        if sport not in reg or not isinstance(names, dict):
            continue
        for name, v in names.items():
            k = skey(name)
            if v is None:
                reg[sport].pop(k, None)
            elif isinstance(v, str) and not re.match(r"^([a-z]+:)?\d+$", v):
                if resolve(reg[sport], v):
                    reg[sport][k] = reg[sport][resolve(reg[sport], v)]
            else:
                reg[sport][k] = int(v) if str(v).isdigit() else v
    return fix


def photo_url(sport, pid):
    """the photo address assets/faces.js would use (the largest size it asks for)"""
    s = str(pid)
    m = re.match(r"^([a-z]+):(\d+)$", s)
    if m:
        sport, s = m.group(1), m.group(2)
    if sport == "nbacom":
        return f"https://cdn.nba.com/headshots/nba/latest/260x190/{s}.png"
    if sport == "espnmlb":
        return f"https://a.espncdn.com/i/headshots/mlb/players/full/{s}.png"
    if sport == "mlb":
        return f"https://img.mlbstatic.com/mlb-photos/image/upload/c_thumb,g_face,z_1.0,w_120,h_120,q_auto:best/v1/people/{s}/headshot/67/current"
    return f"https://a.espncdn.com/i/headshots/{ESPN_LEAGUE[sport]}/players/full/{s}.png"


def head(url):
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code
        except Exception:
            time.sleep(1)
    return None


NBACOM_BLANK = None


def head_nbacom(url):
    """NBA.com answers 200 with a gray silhouette for a player it has no photo of, so a photo the same size as the
    silhouette counts as none (404). Its CDN turns away Python's own client, so this asks with curl."""
    global NBACOM_BLANK

    def size(u):
        try:
            out = subprocess.run(["curl", "-sI", "-m", "20", "-A", "Mozilla/5.0 (davidsolar.dev faces)", u], capture_output=True, text=True, timeout=30).stdout
        except Exception:
            return None, None
        codes = re.findall(r"^HTTP/\S+ (\d+)", out, re.M)
        ln = re.findall(r"^content-length:\s*(\d+)", out, re.M | re.I)
        return (int(codes[-1]) if codes else None), (int(ln[-1]) if ln else None)
    if NBACOM_BLANK is None:
        NBACOM_BLANK = size("https://cdn.nba.com/headshots/nba/latest/260x190/0.png")[1] or 0
    st, ln = size(url)
    return 404 if st == 200 and ln and ln == NBACOM_BLANK else st


def check_photos(want):
    """Ask once every CHECK_DAYS days whether each shown name's photo is on the server; a 404 is left out"""
    from concurrent.futures import ThreadPoolExecutor
    done = json.load(open(CHECKED, encoding="utf-8")) if os.path.exists(CHECKED) else {}
    today = date.today()
    stale = (today - timedelta(days=CHECK_DAYS)).isoformat()
    todo = []
    for sport in SPORTS:
        for n in want[sport]:
            pid = reg[sport].get(resolve(reg[sport], n) or "")
            if pid is None:
                continue
            key = f"{sport}|{pid}"
            c = done.get(key)
            if not c or c[1] < stale:
                todo.append((key, photo_url(sport, pid)))
    todo = list(dict.fromkeys(todo))[:CHECK_PER_RUN]
    print(f"  photo check: {len(todo)} to ask for")
    with ThreadPoolExecutor(16) as ex:
        for (key, _), st in zip(todo, ex.map(lambda t: head_nbacom(t[1]) if "cdn.nba.com" in t[1] else head(t[1]), todo)):
            if st is not None:
                done[key] = [st, today.isoformat()]
    if NBACOM_BLANK is not None:
        print(f"  NBA.com silhouette is {NBACOM_BLANK} bytes")
    with open(CHECKED, "w", encoding="utf-8") as f:
        json.dump(done, f, separators=(",", ":"), sort_keys=True)
    return done


NBA_API = "https://raw.githubusercontent.com/swar/nba_api/master/src/nba_api/stats/library/data.py"


def nba_fallback(want, checked, fix):
    """NBA names with no ESPN photo (none found, or ESPN's server has none) get NBA.com's photo where there is one.
    The NBA.com person ids come from the nba_api project's player list, read as text (never run)."""
    try:
        txt = get(NBA_API, raw=True)
    except Exception as e:
        print(f"  nba_api player list failed: {e}")
        return 0
    m = re.search(r"^players = \[(.*?)^\]", txt, re.S | re.M)  # the NBA list only (the file also lists WNBA players)
    txt = m.group(1) if m else ""
    ids = {}
    q = r"""(?:"[^"]*"|'[^']*')"""
    for pid, full in re.findall(r"\[(\d+),\s*" + q + r",\s*" + q + r",\s*(" + q + r"),\s*(?:True|False)\]", txt):
        k = slug(full[1:-1])
        ids.setdefault(k, set()).add(int(pid))
    fixed = {skey(n) for n in (fix.get("nba") or {})}
    n = 0
    for name in want["nba"]:
        k = resolve(reg["nba"], name) or skey(name)
        if k in fixed or len(ids.get(slug(name), ())) != 1:
            continue
        cur = reg["nba"].get(k)
        if cur is None or (checked.get(f"nba|{cur}") or [0])[0] == 404:
            reg["nba"][k] = f"nbacom:{next(iter(ids[slug(name)]))}"
            n += 1
    print(f"  NBA.com photos tried for {n} names")
    return n


def close_matches(want, fix):
    """A name no list has exactly, matched to a registry name with the same last name and first names that agree on
    their first three letters (Daxton/Dax Hill, Gregory/Greg Rousseau), only when exactly one player fits"""
    n = 0
    for sport in SPORTS:
        by_last = {}
        for k in reg[sport]:
            p = k.split("-")
            if len(p) >= 2:
                by_last.setdefault(p[-1], []).append(k)
        fixed = {slug(x) for x in (fix.get(sport) or {})} | {skey(x) for x in (fix.get(sport) or {})}
        for name in want[sport]:
            k = slug(name)
            p = k.split("-")
            if resolve(reg[sport], name) or k in fixed or len(p) < 2 or len(p[0]) < 3:
                continue
            hits = {reg[sport][c] for c in by_last.get(p[-1], []) if c.split("-")[0][:3] == p[0][:3] and len(c.split("-")) == len(p)}
            if len(hits) == 1:
                reg[sport][k] = hits.pop()
                n += 1
                print(f"    close match {sport}: {name} -> {reg[sport][k]}")
    print(f"  close matches: {n}")


def mlb_fallback(want, checked, fix):
    """MLB names whose MLB photo is missing get ESPN's photo of the same player, where ESPN has one"""
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    stale = (date.today() - timedelta(days=30)).isoformat()
    fixed = {skey(x) for x in (fix.get("mlb") or {})}
    n = tried = 0
    for name in sorted(want["mlb"]):
        k = resolve(reg["mlb"], name) or skey(name)
        cur = reg["mlb"].get(k)
        if k in fixed or cur is None or str(cur).startswith("espnmlb:") or (checked.get(f"mlb|{cur}") or [0])[0] != 404:
            continue
        c = cache.get(f"mlbespn|{k}")
        if not c or (not c[0] and c[1] < stale):
            if tried >= 150:
                continue
            tried += 1
            try:
                pid = espn_search(name, "mlb")
            except Exception:
                continue
            c = cache[f"mlbespn|{k}"] = [pid if isinstance(pid, str) and pid.startswith("espnmlb:") else None, date.today().isoformat()]
            time.sleep(0.35)
        if c[0]:
            reg["mlb"][k] = c[0]
            n += 1
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(cache, f, separators=(",", ":"), ensure_ascii=False, sort_keys=True)
    print(f"  ESPN photos tried for {n} MLB names ({tried} searched)")
    return n


def main():
    local_sources()
    want = wanted()
    checked = {}
    if not LOCAL:
        for fn in (nba_bulk, nfl_bulk, mlb_bulk):
            try:
                fn()
            except Exception as e:
                print(f"  {fn.__name__} failed: {e}")
        search_missing(want)
    close_matches(want, json.load(open(FIX, encoding="utf-8")) if os.path.exists(FIX) else {})
    fix = apply_fixes()
    if not LOCAL:
        checked = check_photos(want)
        if nba_fallback(want, checked, fix) + mlb_fallback(want, checked, fix):
            checked = check_photos(want)
    elif os.path.exists(CHECKED):
        checked = json.load(open(CHECKED, encoding="utf-8"))
    os.makedirs(OUT, exist_ok=True)
    report = {"built": date.today().isoformat(), "sports": {}}
    for sport in SPORTS:
        ids = dict(reg[sport])
        # a photo the server doesn't have: no id, so the page shows initials straight away
        gone = {k for k, v in ids.items() if (checked.get(f"{sport}|{v}") or [0])[0] == 404}
        for k in gone:
            del ids[k]
        # keep the file to what pages can use: every name a page shows, plus current players for the league pages
        if sport == "mlb" and len(ids) > 25000:
            keep = {slug(n) for n in want["mlb"]} | {skey(n) for n in want["mlb"]} | {k for k, v in ids.items() if isinstance(v, int) and v >= 500000}
            ids = {k: v for k, v in ids.items() if k in keep}
        path = os.path.join(OUT, f"{sport}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"built": date.today().isoformat(), "ids": dict(sorted(ids.items()))}, f, separators=(",", ":"), ensure_ascii=False)
        shown = {skey(n): n for n in want[sport]}
        fixed = {skey(n) for n in (fix.get(sport) or {})}
        at = {n: resolve(reg[sport], n) for n in shown.values()}
        missing = sorted(n for n, k in at.items() if k is None)
        no_photo = sorted(n for n, k in at.items() if k in gone)
        # [name, the id in use, every id seen for that name] (a name with its own suffixed entry isn't shared)
        shared = sorted([n, str(ids.get(at[n], "")), sorted(map(str, seen[sport][slug(n)]))] for k, n in shown.items()
                        if len(seen[sport].get(slug(n), ())) > 1 and k not in fixed and not (suffix(n) and at[n] == skey(n)))
        report["sports"][sport] = {"registry": len(ids), "shown": len(shown), "found": len(shown) - len(missing) - len(no_photo),
                                   "missing": missing[:400], "noPhoto": no_photo[:400], "shared": shared[:200], "fixed": len(fixed)}
        print(f"wrote assets/faces/{sport}.json: {len(ids)} names, {report['sports'][sport]['found']}/{len(shown)} of the names pages show"
              f" ({len(no_photo)} with no photo on the server, {len(shared)} shared names)")
    with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
