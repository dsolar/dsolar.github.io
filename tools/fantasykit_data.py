#!/usr/bin/env python3
"""Player pools for the Fantasy Kit (fantasy-kit/), one file per sport, all in the same shape:

  {"sport", "season", "updated", "source",
   "lines": {"<key>": {"label": "...", "cols": ["gp", ...]}},
   "players": [{"id", "n", "t", "pos": ["PG", "SG"], "age", "inj", "l": {"<key>": [values in cols order]}}]}

  nba.json  per-game line, this season blended with last season (from hardcap/stats.json, which the Hard Cap
            workflow refreshes from ESPN twice a day; positions and ages from celtics/data.json)
  mlb.json  season batting and pitching lines (from tools/mlb/<year>.json, MLB's Stats API)
  nfl.json  season totals and Sleeper's fantasy points (Sleeper's public stats and projections feeds). When Sleeper
            can't be reached, the last good file stays; with no file at all it seeds from guillotine/data.json.

Real weekly box scores, for leagues scored on what actually happened (fantasy-kit/data/weeks-<sport>.json):

  {"sport", "season", "updated", "source", "line": "<key>", "cols": [...],
   "weeks": {"<n>": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "final": bool, "lines": {"<player id>": [week totals]}}}}

  weeks-nba.json  Monday to Sunday weeks from Hard Cap's ESPN box scores (hardcap/stats.json "wk")
  weeks-nfl.json  Tuesday to Monday weeks from Sleeper's weekly stats
  weeks-mlb.json  Monday to Sunday weeks from MLB's Stats API box scores, every regular-season game. Two lines,
                  so the file has "lines": {"bat": cols, "pit": cols} and each player's week is {"bat": [...], "pit": [...]}.
                  Weeks already final aren't fetched again.

Rookies: a player in his first season carries "rk": 1 (football: Sleeper's years_exp 0; basketball: no line last
season; baseball: under 130 at-bats and 50 innings before this season, MLB's own rookie limits).
  A week is final once the data was pulled after its last night, so a league can close it.

  python tools/fantasykit_data.py            all four
  python tools/fantasykit_data.py nfl        one sport
"""
import json
import os
import re
import subprocess
import sys
import unicodedata
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "fantasy-kit", "data")
UA = "davidsolar-fantasykit/1.0 (+https://davidsolar.dev/fantasy-kit/)"
NOW = datetime.now(timezone.utc).isoformat(timespec="seconds")


def slug(n):
    n = unicodedata.normalize("NFKD", n or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")


def load(path, default=None):
    try:
        with open(os.path.join(ROOT, path), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


# Some feeds title-case names ("Jimmy Butler Iii", "Doug Mcdermott"). Put suffixes, Mc/Mac names and a few known
# spellings back the way the players write them.
NAME_FIX = {"Iii": "III", "Ii": "II", "Iv": "IV", "Jr": "Jr.", "Sr": "Sr.", "Tyty": "TyTy", "Dejon": "DeJon", "Deaaron": "De'Aaron",
            "Demar": "DeMar", "Lamelo": "LaMelo", "Deandre": "DeAndre", "Rj": "RJ", "Cj": "CJ", "Pj": "PJ", "Aj": "AJ", "Og": "OG", "Kj": "KJ", "Tj": "TJ"}


def fix_name(n):
    out = []
    for w in str(n).split():
        if w in NAME_FIX:
            w = NAME_FIX[w]
        elif len(w) > 3 and w.startswith("Mc") and w[2].islower():
            w = "Mc" + w[2].upper() + w[3:]
        out.append(w)
    return " ".join(out)


def write(sport, data):
    for p in data.get("players", []):
        if p.get("n"):
            p["n"] = fix_name(p["n"])
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, sport + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {path}: {len(data['players'])} players")


def write_weeks(sport, data):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"weeks-{sport}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    fin = sum(1 for w in data["weeks"].values() if w["final"])
    print(f"Wrote {path}: {len(data['weeks'])} weeks, {fin} final")


def after_night(d):
    """The morning after a day's last games: 8:00 UTC the next day."""
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc) + timedelta(days=1, hours=8)


def age_on(birth, today=None):
    """Age in years, to a tenth, from a YYYY-MM-DD birth date; None if it doesn't parse."""
    try:
        b = date.fromisoformat(str(birth)[:10])
    except ValueError:
        return None
    t = today or date.today()
    return round((t - b).days / 365.25, 1)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


# ---------- NBA ----------
# new columns on the end, for the extra categories: offensive and defensive rebounds, fouls, 3-pointers tried, plus/minus,
# double-doubles and triple-doubles (Hard Cap's file has them; defensive rebounds are total minus offensive)
NBA_COLS = ["gp", "eg", "min", "fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "ast", "stl", "blk", "tov", "oreb", "dreb", "pf", "tpa", "pm", "dd", "td"]


def hc_val(arr, ix, c):
    """One column of a Hard Cap line, by name; 0 for a column an older line doesn't have."""
    if c == "dreb":
        return hc_val(arr, ix, "reb") - hc_val(arr, ix, "oreb")
    i = ix.get(c)
    return (arr[i] or 0) if arr and i is not None and i < len(arr) else 0
LETTER_POS = {"G": ["PG", "SG"], "F": ["SF", "PF"], "C": ["C"]}


def nba():
    st = load("hardcap/stats.json", {})
    bio = {p["id"]: p for p in (load("celtics/data.json", {}) or {}).get("players", [])}
    cols = st.get("cols") or []
    years = sorted((st.get("avg") or {}).keys())
    if not years:
        print("No NBA averages yet")
        return
    cur = st["avg"][years[-1]]
    prev = st["avg"][years[-2]] if len(years) > 1 else {}
    ix = {c: i for i, c in enumerate(cols)}
    names, rosters, inj = st.get("names", {}), st.get("rosters", {}), st.get("inj", {})
    # ESPN's season averages leave some columns blank (offensive rebounds, plus/minus): this season's box scores, added
    # up week by week, give those per game, and last season's blank column doesn't drag them toward zero
    box = {}
    for wk in (st.get("wk") or {}).values():
        for pid, v in wk.items():
            box[pid] = [x + (v[i] if i < len(v) else 0) for i, x in enumerate(box.get(pid) or [0] * len(cols))]
    blank = lambda season: {c for c in ("oreb", "pm", "tpa", "dd", "td") if season and not any(hc_val(v, ix, c) for v in season.values())}
    cur_blank, prev_blank = blank(cur), blank(prev)
    out = []
    for pid in set(cur) | set(prev):
        a, b = cur.get(pid), prev.get(pid)
        ga = a[ix["gp"]] if a else 0
        gb = b[ix["gp"]] if b else 0
        k = min(gb, 20)                       # last season counts like 20 games of this one, at most
        if ga + k <= 0:
            continue
        line = []
        for c in NBA_COLS:
            if c == "gp":
                line.append(ga)
                continue
            if c == "eg":                     # effective games: this season plus last season's weight
                line.append(ga + k)
                continue
            base = "oreb" if c == "dreb" else c
            bx = box.get(pid)
            if base in cur_blank and bx and hc_val(bx, ix, "gp"):
                va = (hc_val(bx, ix, "reb") - hc_val(bx, ix, "oreb") if c == "dreb" else hc_val(bx, ix, c)) / hc_val(bx, ix, "gp")
            else:
                va = hc_val(a, ix, c)
            vb, kk = (0, 0) if base in prev_blank else (hc_val(b, ix, c), k)
            if c == "dreb" and base in prev_blank:
                vb, kk = 0, 0
            line.append(round((va * ga + vb * kk) / (ga + kk), 2) if ga + kk else 0)
        # defensive rebounds are what's left of his rebounds, so the two always add up
        line[NBA_COLS.index("dreb")] = round(max(0, line[NBA_COLS.index("reb")] - line[NBA_COLS.index("oreb")]), 2)
        p = bio.get(pid, {})
        nm = (names.get(pid) or [p.get("n") or pid.replace("-", " ").title()])[0]
        team = (rosters.get(pid) or [None])[0] or (names.get(pid) or [None, None])[1] or p.get("t") or "FA"
        pos = p.get("ps") or LETTER_POS.get((rosters.get(pid) or [None, None, "F"])[2] or "F", ["SF", "PF"])
        row = {"id": pid, "n": nm, "t": team, "pos": pos, "l": {"pg": line}}
        if p.get("age"):
            row["age"] = p["age"]
        if prev and not b and (not p.get("age") or p["age"] <= 24):    # no line last season, and young
            row["rk"] = 1
        if inj.get(pid):
            row["inj"] = inj[pid][0]
        r = rosters.get(pid) or []
        if len(r) > 3 and r[3]:
            row["espn"] = r[3]                 # ESPN athlete id, for his photo
        out.append(row)
    lines = {"pg": {"label": "Per game", "cols": NBA_COLS}}
    src = sleeper_nba(out)
    if src:
        lines["ppg"] = {"label": "Sleeper season projection, per game", "cols": NBA_COLS, "proj": True}
    write("nba", {"sport": "nba", "season": season_label(st),
                  "updated": st.get("updated") or NOW, "source": "ESPN box scores via Hard Cap" + (", projections from Sleeper" if src else ""),
                  "lines": lines, "players": out})


# Sleeper's season projections, per game: a prior for players with few games so far (value.js blends them in) and
# ages for anyone celtics/data.json doesn't have. If Sleeper doesn't answer, last file's projections stay.
def sleeper_nba(out):
    try:
        season = int(datetime.now(timezone.utc).year) - (0 if datetime.now(timezone.utc).month >= 9 else 1)
        rows = get(f"https://api.sleeper.com/projections/nba/{season}?season_type=regular")
    except Exception as e:
        print(f"Sleeper NBA projections didn't load: {type(e).__name__}: {e}")
        rows = []
    by = {r["id"]: r for r in out}
    names = {slug(fix_name(r["n"])): r for r in out}
    n = 0
    for x in rows if len(rows) > 200 else []:
        pl, st = x.get("player") or {}, x.get("stats") or {}
        row = by.get(slug(f"{pl.get('first_name', '')} {pl.get('last_name', '')}")) or names.get(slug(fix_name(f"{pl.get('first_name', '')} {pl.get('last_name', '')}")))
        if not row or not st.get("pts"):
            continue
        g = lambda k: round(float(st.get(k) or 0), 2)
        vals = {"gp": 0, "eg": 0, "min": round(float(st.get("sp") or 0) / 60, 1), "fgm": g("fgm"), "fga": g("fga"), "ftm": g("ftm"), "fta": g("fta"),
                "tpm": g("tpm"), "pts": g("pts"), "reb": g("reb"), "ast": g("ast"), "stl": g("stl"), "blk": g("blk"), "tov": g("to"),
                "oreb": g("oreb"), "dreb": g("dreb") or round(g("reb") - g("oreb"), 2), "pf": g("pf"), "tpa": g("tpa"), "pm": g("pm"), "dd": g("dd"), "td": g("td")}
        row["l"]["ppg"] = [vals[c] for c in NBA_COLS]
        if not row.get("age") and pl.get("birth_date"):
            a = age_on(pl["birth_date"])
            if a:
                row["age"] = a
        n += 1
    if not n:
        old = {p["id"]: p for p in (load("fantasy-kit/data/nba.json", {}) or {}).get("players", [])}
        for row in out:
            pp = ((old.get(row["id"]) or {}).get("l") or {}).get("ppg")
            if pp:
                row["l"]["ppg"] = pp; n += 1
        print(f"NBA projections: kept last file's for {n} players")
        return "kept" if n else None
    print(f"NBA projections (Sleeper): {n} players, ages for {sum(1 for r in out if r.get('age'))} of {len(out)}")
    return "sleeper"


def nba_weeks():
    st = load("hardcap/stats.json", {})
    if not st.get("opener") or not st.get("wk"):
        print("No NBA weeks yet")
        return
    opener = date.fromisoformat(st["opener"])
    monday = opener - timedelta(days=opener.weekday())
    ix = {c: i for i, c in enumerate(st.get("cols") or [])}
    last = date.fromisoformat(st["last"]) if st.get("last") else None
    upd = datetime.fromisoformat(st["updated"].replace("Z", "+00:00")) if st.get("updated") else None
    weeks = {}
    for k, lines in st["wk"].items():
        start = monday + timedelta(days=7 * (int(k) - 1))
        end = start + timedelta(days=6)
        out = {}
        for pid, v in lines.items():
            g = v[ix["gp"]]
            out[pid] = [g, g] + [round(hc_val(v, ix, c), 1) for c in NBA_COLS[2:]]
        weeks[k] = {"start": start.isoformat(), "end": end.isoformat(),
                    "final": bool(upd and last and last >= end and upd >= after_night(end)), "lines": out}
    write_weeks("nba", {"sport": "nba", "season": season_label(st), "updated": st.get("updated") or NOW,
                        "source": "ESPN", "line": "pg", "cols": NBA_COLS, "weeks": weeks})


def season_label(st):
    y = int(str(st.get("season") or 2026)[:4])             # the year the season starts
    return f"{y}-{str(y + 1)[2:]}"


# ---------- MLB ----------
MLB_TEAMS = {
    "Arizona Diamondbacks": "ARI", "Athletics": "ATH", "Oakland Athletics": "ATH", "Atlanta Braves": "ATL", "Baltimore Orioles": "BAL",
    "Boston Red Sox": "BOS", "Chicago Cubs": "CHC", "Chicago White Sox": "CWS", "Cincinnati Reds": "CIN", "Cleveland Guardians": "CLE",
    "Colorado Rockies": "COL", "Detroit Tigers": "DET", "Houston Astros": "HOU", "Kansas City Royals": "KC", "Los Angeles Angels": "LAA",
    "Los Angeles Dodgers": "LAD", "Miami Marlins": "MIA", "Milwaukee Brewers": "MIL", "Minnesota Twins": "MIN", "New York Mets": "NYM",
    "New York Yankees": "NYY", "Philadelphia Phillies": "PHI", "Pittsburgh Pirates": "PIT", "San Diego Padres": "SD", "San Francisco Giants": "SF",
    "Seattle Mariners": "SEA", "St. Louis Cardinals": "STL", "Tampa Bay Rays": "TB", "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR",
    "Washington Nationals": "WSH",
}
# One column list for the season lines, the projections and the real weeks, so a week's line reads with the season's
# columns. New columns go on the end: the parts of the advanced categories (wOBA, ISO, BB%, K%, FIP, K-BB%).
BAT_COLS = ["g", "pa", "ab", "r", "h", "hr", "rbi", "sb", "tb", "avg", "obp", "ops", "bb", "hbp", "sf", "2b", "3b", "so", "ibb", "cs"]
PIT_COLS = ["g", "gs", "ip", "w", "l", "sv", "hld", "k", "er", "bb", "h", "era", "whip", "qs", "outs", "hr", "hbp", "bf"]
OF = {"LF", "CF", "RF"}
MLB_ORDER = ["C", "1B", "2B", "3B", "SS", "OF", "UT", "SP", "RP"]


def ip_real(ip):                              # 96.1 means 96 and a third innings
    whole = int(ip)
    return whole + round((ip - whole) * 10) / 3


# Position eligibility, Yahoo's way: a hitter qualifies at a position with 5 starts or 10 games there, a pitcher at SP
# with 3 starts and at RP with 5 relief appearances. Before a season starts that's last season's games; once it's
# under way, last season's or this one's. Each player also carries the counts ("pg": one {pos: [games, starts]} per
# season), so a league with its own thresholds (settings.elig) can work them out itself.
ELIG = {"g": 10, "gs": 5, "sp": 3, "rp": 5}


def season_games(src):
    """{player id: {pos: [games, starts]}} for one season: fielding by position (LF, CF and RF add up to OF), and SP
    and RP from pitching (starts, and relief appearances)."""
    out = {}
    for r in src.get("fielding") or []:
        pos = "OF" if r["pos"] in OF else r["pos"]
        if pos not in MLB_ORDER:
            continue
        x = out.setdefault(r["id"], {}).setdefault(pos, [0, 0])
        x[0] += r.get("g") or 0
        x[1] += r.get("gs") or 0
    for q in src.get("pitching") or []:
        g, gs = q.get("g") or 0, q.get("gs") or 0
        if gs:
            out.setdefault(q["id"], {})["SP"] = [gs, gs]
        if g - gs > 0:
            out.setdefault(q["id"], {})["RP"] = [g - gs, 0]
    return out


def eligible(seasons, t=ELIG):
    """The positions a player qualifies at from his per-season counts, in roster order."""
    ok = set()
    for s in seasons:
        for pos, (g, gs) in s.items():
            if pos == "SP" and gs >= t["sp"] or pos == "RP" and g >= t["rp"] or pos not in ("SP", "RP") and (g >= t["g"] or gs >= t["gs"]):
                ok.add(pos)
    return sorted(ok, key=lambda x: MLB_ORDER.index(x))


def mlb():
    years = sorted(f[:4] for f in os.listdir(os.path.join(ROOT, "tools", "mlb")) if re.match(r"\d{4}\.json$", f))
    if not years:
        print("No MLB season files")
        return
    src = load(f"tools/mlb/{years[-1]}.json")
    # MLB's rookie limits: under 130 at-bats and 50 innings before this season
    ab, ip = {}, {}
    for y in years[:-1]:
        old = load(f"tools/mlb/{y}.json") or {}
        for h in old.get("hitting", []):
            ab[h["id"]] = ab.get(h["id"], 0) + (h.get("ab") or 0)
        for q in old.get("pitching", []):
            ip[q["id"]] = ip.get(q["id"], 0) + ip_real(q.get("ip") or 0)
    by = {}
    for h in src.get("hitting", []):
        if h.get("pa", 0) < 20 or h.get("pos") == "P":
            continue
        pos = h.get("pos") or "DH"
        ps = ["OF"] if pos in OF else ["UT"] if pos in ("DH", "X") else [pos]
        row = by.setdefault(h["id"], {"id": str(h["id"]), "n": h["name"], "t": MLB_TEAMS.get(h.get("team"), (h.get("team") or "FA")[:3].upper()), "pos": [], "l": {}})
        row["pos"] = sorted(set(row["pos"]) | set(ps), key=lambda x: MLB_ORDER.index(x) if x in MLB_ORDER else 99)
        row["l"]["bat"] = [h.get(c, 0) for c in BAT_COLS]
    for p in src.get("pitching", []):
        if p.get("ip", 0) < 8:
            continue
        row = by.setdefault(p["id"], {"id": str(p["id"]), "n": p["name"], "t": MLB_TEAMS.get(p.get("team"), (p.get("team") or "FA")[:3].upper()), "pos": [], "l": {}})
        sp = p.get("gs", 0) >= max(3, p.get("g", 0) * 0.5)
        row["pos"] = row["pos"] + (["SP"] if sp else ["RP"])
        line = [p.get(c, 0) for c in PIT_COLS]
        line[PIT_COLS.index("ip")] = round(ip_real(p.get("ip", 0)), 2)
        line[PIT_COLS.index("outs")] = round(ip_real(p.get("ip", 0)) * 3)
        row["l"]["pit"] = line
    for pid, row in by.items():
        if ab.get(pid, 0) < 130 and ip.get(pid, 0) < 50:
            row["rk"] = 1
    # eligibility: this season's games, plus last season's while this one is under way (March through September of
    # its own year); in the offseason the season just played is "last season" for next year
    today = datetime.now(timezone.utc)
    window = [src]
    if len(years) > 1 and int(years[-1]) == today.year and 3 <= today.month <= 9:
        window = [load(f"tools/mlb/{years[-2]}.json") or {}, src]
    counts = [season_games(x) for x in window]
    if any(x.get("fielding") for x in window):
        n = 0
        for pid, row in by.items():
            seasons = [c[pid] for c in counts if pid in c]
            if not seasons:
                continue
            row["pg"] = seasons
            el = eligible(seasons)
            pitch = [x for x in row["pos"] if x in ("SP", "RP")]
            bats = [x for x in el if x not in ("SP", "RP")]
            # a hitter who qualifies nowhere (a DH) stays UT; a pitcher keeps his role if he's short on both counts
            if "bat" in row["l"]:
                row["pos"] = (bats or ([x for x in row["pos"] if x not in ("SP", "RP")] or ["UT"])) + ([x for x in el if x in ("SP", "RP")] if "pit" in row["l"] else [])
            else:
                row["pos"] = [x for x in el if x in ("SP", "RP")] or pitch
            n += len(row["pos"]) > 1
        print(f"MLB eligibility: {n} of {len(by)} players at more than one position")
    proj_src = steamer(by, ab, ip)
    # ages, for dynasty values: the Stats API's people endpoint, a hundred players a call
    ids = list(by.keys())
    try:
        for i in range(0, len(ids), 100):
            chunk = ",".join(str(x) for x in ids[i:i + 100])
            for person in (get(f"{MLB_API}people?personIds={chunk}&fields=people,id,birthDate") or {}).get("people", []):
                a = age_on(person.get("birthDate"))
                if a and person.get("id") in by:
                    by[person["id"]]["age"] = a
    except Exception as e:
        print(f"MLB ages didn't load: {type(e).__name__}: {e}")
    print(f"MLB ages: {sum(1 for r in by.values() if r.get('age'))} of {len(by)}")
    lines = {"bat": {"label": "Batting", "cols": BAT_COLS}, "pit": {"label": "Pitching", "cols": PIT_COLS}}
    if proj_src:
        lines["pbat"] = {"label": f"{proj_src}, batting", "cols": BAT_COLS, "proj": True}
        lines["ppit"] = {"label": f"{proj_src}, pitching", "cols": PIT_COLS, "proj": True}
    write("mlb", {"sport": "mlb", "season": years[-1], "updated": NOW, "source": "MLB Stats API (statsapi.mlb.com)" + (f", projections from {proj_src} (fangraphs.com)" if proj_src else ""),
                  "lines": lines,
                  "players": list(by.values())})


def mlb_prev():
    """Last season's lines beside this season's (p["l0"], data["prev"]): what Yahoo shows as the season before. From the
    season files in tools/mlb, so it runs without the network; mlb() calls it after writing the pool."""
    path = os.path.join(OUT, "mlb.json")
    d = load("fantasy-kit/data/mlb.json")
    if not d or not d.get("season"):
        return
    prev = str(int(d["season"]) - 1)
    src = load(f"tools/mlb/{prev}.json")
    if not src:
        print(f"No {prev} season file; no last-season lines")
        return
    bat = {str(h["id"]): h for h in src.get("hitting", []) if h.get("pa", 0) >= 20 and h.get("pos") != "P"}
    pit = {str(q["id"]): q for q in src.get("pitching", []) if q.get("ip", 0) >= 5}
    n = 0
    for p in d.get("players", []):
        l0 = {}
        h, q = bat.get(str(p.get("id"))), pit.get(str(p.get("id")))
        if h:
            l0["bat"] = [h.get(c, 0) for c in BAT_COLS]
        if q:
            line = [q.get(c, 0) for c in PIT_COLS]
            line[PIT_COLS.index("ip")] = round(ip_real(q.get("ip", 0)), 2)
            line[PIT_COLS.index("outs")] = round(ip_real(q.get("ip", 0)) * 3)
            l0["pit"] = line
        if l0:
            p["l0"] = l0
            n += 1
        else:
            p.pop("l0", None)
    d["prev"] = prev
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
    print(f"MLB {prev} lines: {n} of {len(d.get('players', []))} players")


# Projections: FanGraphs' Steamer, by MLBAM id (the same ids as the Stats API). Rest of season while one is out
# (steamerr), else the full-season projection (between seasons, next season's). Players with a projection and no
# line last season join the pool when they're projected for real playing time (250 PA or 50 IP): rookies, mostly.
FG = "https://www.fangraphs.com/api/projections?type={t}&stats={s}&pos=all&team=0&players=0&lg=all"
FG_TEAMS = {"CHW": "CWS", "KCR": "KC", "SDP": "SD", "SFG": "SF", "TBR": "TB", "WSN": "WSH"}


def steamer(by, ab, ip):
    got, label = {}, None
    for t, name in (("steamerr", "Steamer rest of season"), ("steamer", "Steamer")):
        try:
            bat, pit = get(FG.format(t=t, s="bat")), get(FG.format(t=t, s="pit"))
        except Exception as e:
            print(f"FanGraphs {t} didn't load: {type(e).__name__}: {e}")
            continue
        if len(bat) > 500 and len(pit) > 500:
            got, label = {"bat": bat, "pit": pit}, name
            break
    if not got:
        # FanGraphs didn't answer: keep yesterday's projections (and the projection-only players) rather than
        # sliding back to last season's stats
        old = load("fantasy-kit/data/mlb.json", {}) or {}
        label = (((old.get("lines") or {}).get("pbat") or {}).get("label") or "").replace(", batting", "")
        kept = 0
        for op in old.get("players", []):
            ol = op.get("l") or {}
            if not (ol.get("pbat") or ol.get("ppit")):
                continue
            pid = int(op["id"]) if str(op["id"]).isdigit() else op["id"]
            row = by.get(pid)
            if not row:
                if ol.get("bat") or ol.get("pit"):
                    continue                     # he had a line last season then; not a projection-only player
                row = by[pid] = {k: v for k, v in op.items() if k != "l"}
                row["l"] = {}
            for k in ("pbat", "ppit"):
                if ol.get(k):
                    row["l"][k] = ol[k]
            kept += 1
        print(f"MLB projections: kept last file's for {kept} players")
        return label or None
    n = {"bat": 0, "pit": 0, "new": 0}
    num = lambda r, k: float(r.get(k) or 0)
    for r in got["bat"]:
        pid = r.get("xMLBAMID")
        if not pid:
            continue
        line = [round(num(r, "G"), 1), round(num(r, "PA"), 1), round(num(r, "AB"), 1), round(num(r, "R"), 1), round(num(r, "H"), 1), round(num(r, "HR"), 1),
                round(num(r, "RBI"), 1), round(num(r, "SB"), 1), round(num(r, "1B") + 2 * num(r, "2B") + 3 * num(r, "3B") + 4 * num(r, "HR"), 1),
                round(num(r, "AVG"), 3), round(num(r, "OBP"), 3), round(num(r, "OPS"), 3),
                round(num(r, "BB"), 1), round(num(r, "HBP"), 1), round(num(r, "SF"), 1), round(num(r, "2B"), 1), round(num(r, "3B"), 1),
                round(num(r, "SO"), 1), round(num(r, "IBB"), 1), round(num(r, "CS"), 1)]
        row = by.get(pid)
        if not row and num(r, "PA") >= 250:
            pos = str(r.get("minpos") or "UT").split("/")[0]
            ps = ["OF"] if pos in OF else ["UT"] if pos in ("DH", "X", "") else [pos]
            team = str(r.get("Team") or "FA")
            row = by[pid] = {"id": str(pid), "n": r.get("PlayerName") or str(pid), "t": FG_TEAMS.get(team, team), "pos": ps if ps[0] in MLB_ORDER else ["UT"], "l": {}}
            if ab.get(pid, 0) < 130:
                row["rk"] = 1
            n["new"] += 1
        if row:
            row["l"]["pbat"] = line
            n["bat"] += 1
    for r in got["pit"]:
        pid = r.get("xMLBAMID")
        if not pid:
            continue
        line = [round(num(r, "G"), 1), round(num(r, "GS"), 1), round(num(r, "IP"), 1), round(num(r, "W"), 1), round(num(r, "L"), 1), round(num(r, "SV"), 1),
                round(num(r, "HLD"), 1), round(num(r, "SO"), 1), round(num(r, "ER"), 1), round(num(r, "BB"), 1), round(num(r, "H"), 1),
                round(num(r, "ERA"), 2), round(num(r, "WHIP"), 3), round(num(r, "QS"), 1),
                round(num(r, "IP") * 3), round(num(r, "HR"), 1), round(num(r, "HBP"), 1),
                round(num(r, "TBF") or (num(r, "IP") * 3 + num(r, "H") + num(r, "BB") + num(r, "HBP")), 1)]
        row = by.get(pid)
        if not row and num(r, "IP") >= 50:
            team = str(r.get("Team") or "FA")
            sp = num(r, "GS") >= max(3, num(r, "G") * 0.5)
            row = by[pid] = {"id": str(pid), "n": r.get("PlayerName") or str(pid), "t": FG_TEAMS.get(team, team), "pos": ["SP" if sp else "RP"], "l": {}}
            if ip.get(pid, 0) < 50:
                row["rk"] = 1
            n["new"] += 1
        if row:
            row["l"]["ppit"] = line
            if "SP" not in row["pos"] and "RP" not in row["pos"]:
                row["pos"] = row["pos"] + (["SP"] if num(r, "GS") >= max(3, num(r, "G") * 0.5) else ["RP"])
            n["pit"] += 1
    print(f"MLB projections ({label}): {n['bat']} hitters, {n['pit']} pitchers, {n['new']} new to the pool")
    return label


# Real weeks: every regular-season box score, added up Monday to Sunday.
MLB_API = "https://statsapi.mlb.com/api/v1/"
WK_BAT = BAT_COLS                                 # the parts the rates come from are in the season columns
WK_PIT = PIT_COLS


BOX_FIELDS = ",".join(["teams", "away", "home", "players", "person", "id", "stats", "batting", "pitching", "plateAppearances", "atBats", "runs", "hits",
                       "homeRuns", "rbi", "stolenBases", "totalBases", "baseOnBalls", "hitByPitch", "sacFlies", "inningsPitched", "gamesStarted",
                       "wins", "losses", "saves", "holds", "strikeOuts", "earnedRuns", "doubles", "triples", "intentionalWalks", "caughtStealing",
                       "battersFaced"])


def mlb_boxes(pk):
    """One game's lines: {player id: {"b": [g, pa, ab, r, h, hr, rbi, sb, tb, bb, hbp, sf, 2b, 3b, so, ibb, cs],
    "p": [g, gs, outs, w, l, sv, hld, k, er, bb, h, qs, hr, hbp, bf]}}."""
    # only the fields we read (a whole box score is ~100 KB); if the filter ever comes back empty, take it all
    box = get(f"{MLB_API}game/{pk}/boxscore?fields={BOX_FIELDS}")
    if not any(((box.get("teams") or {}).get(s) or {}).get("players") for s in ("away", "home")):
        box = get(f"{MLB_API}game/{pk}/boxscore")
    out = {}
    for side in ("away", "home"):
        for pl in ((box.get("teams") or {}).get(side) or {}).get("players", {}).values():
            pid = str((pl.get("person") or {}).get("id"))
            st = pl.get("stats") or {}
            b, q = st.get("batting") or {}, st.get("pitching") or {}
            row = {}
            if b and (b.get("plateAppearances") or b.get("atBats") or b.get("runs") or b.get("stolenBases")):
                row["b"] = [1, b.get("plateAppearances", 0), b.get("atBats", 0), b.get("runs", 0), b.get("hits", 0), b.get("homeRuns", 0),
                            b.get("rbi", 0), b.get("stolenBases", 0), b.get("totalBases", 0), b.get("baseOnBalls", 0), b.get("hitByPitch", 0), b.get("sacFlies", 0),
                            b.get("doubles", 0), b.get("triples", 0), b.get("strikeOuts", 0), b.get("intentionalWalks", 0), b.get("caughtStealing", 0)]
            if q and q.get("inningsPitched") not in (None, ""):
                whole, _, part = str(q["inningsPitched"]).partition(".")
                outs = int(whole or 0) * 3 + int(part or 0)
                gs = 1 if q.get("gamesStarted") else 0
                row["p"] = [1, gs, outs, q.get("wins", 0), q.get("losses", 0), q.get("saves", 0), q.get("holds", 0), q.get("strikeOuts", 0),
                            q.get("earnedRuns", 0), q.get("baseOnBalls", 0), q.get("hits", 0), 1 if gs and outs >= 18 and q.get("earnedRuns", 0) <= 3 else 0,
                            q.get("homeRuns", 0), q.get("hitByPitch", 0), q.get("battersFaced", 0)]
            if row:
                out[pid] = row
    return out


def mlb_lines(acc):
    """Week totals in the file's columns, rates worked out from their parts."""
    out = {}
    for pid, a in acc.items():
        row = {}
        if "b" in a:
            g, pa, ab, r, h, hr, rbi, sb, tb, bb, hbp, sf, d2, d3, so, ibb, cs = a["b"]
            obp = (h + bb + hbp) / (ab + bb + hbp + sf) if ab + bb + hbp + sf else 0
            row["bat"] = [g, pa, ab, r, h, hr, rbi, sb, tb, round(h / ab, 3) if ab else 0, round(obp, 3), round(obp + (tb / ab if ab else 0), 3), bb, hbp, sf, d2, d3, so, ibb, cs]
        if "p" in a:
            g, gs, outs, w, l, sv, hld, k, er, bb, h, qs, hra, hbp, bf = a["p"]
            ip = outs / 3
            row["pit"] = [g, gs, round(ip, 2), w, l, sv, hld, k, er, bb, h, round(er * 9 / ip, 2) if ip else 0, round((bb + h) / ip, 2) if ip else 0, qs, outs, hra, hbp, bf]
        out[pid] = row
    return out


def mlb_weeks():
    from concurrent.futures import ThreadPoolExecutor
    today = datetime.now(timezone.utc).date()
    year = today.year
    sched = get(f"{MLB_API}schedule?sportId=1&season={year}&gameType=R&fields=dates,date,games,gamePk,status,abstractGameState,officialDate")
    dates = [d for d in sched.get("dates", []) if d.get("games")]
    if not dates or date.fromisoformat(dates[0]["date"]) > today:     # before opening day: last season's weeks
        year -= 1
        sched = get(f"{MLB_API}schedule?sportId=1&season={year}&gameType=R&fields=dates,date,games,gamePk,status,abstractGameState,officialDate")
        dates = [d for d in sched.get("dates", []) if d.get("games")]
    if not dates:
        print("No MLB schedule")
        return
    opener = date.fromisoformat(dates[0]["date"])
    monday = opener - timedelta(days=opener.weekday())
    old = load("fantasy-kit/data/weeks-mlb.json", {}) or {}
    same = (old.get("lines") or {}) == {"bat": WK_BAT, "pit": WK_PIT}     # new columns: fetch every week again
    keep = old.get("weeks", {}) if str(old.get("season")) == str(year) and same else {}
    by_week = {}
    for d in dates:
        dd = date.fromisoformat(d["date"])
        if dd > today:
            continue
        k = str((dd - monday).days // 7 + 1)
        by_week.setdefault(k, []).extend(d["games"])
    weeks, fetched = {}, 0
    last_day = max(date.fromisoformat(d["date"]) for d in dates)
    # daily lines for leagues with daily lineups (days-mlb.json): each day of the current week and the one before,
    # so a week can still be scored day by day after it ends
    old_days = load("fantasy-kit/data/days-mlb.json", {}) or {}
    old_days = old_days.get("weeks", {}) if str(old_days.get("season")) == str(year) and (old_days.get("lines") or {}) == {"bat": WK_BAT, "pit": WK_PIT} else {}
    recent = sorted(by_week, key=int)[-2:]
    days_out = {}
    for k in sorted(by_week, key=int):
        start = monday + timedelta(days=7 * (int(k) - 1))
        end = start + timedelta(days=6)
        if keep.get(k, {}).get("final") and (k not in recent or k in old_days):
            weeks[k] = keep[k]
            if k in recent and k in old_days:
                days_out[k] = old_days[k]
            continue
        games = [g for g in by_week[k] if (g.get("status") or {}).get("abstractGameState") == "Final"]
        acc, acc_day = {}, [{} for _ in range(7)]
        with ThreadPoolExecutor(max_workers=8) as ex:
            for g, box in zip(games, ex.map(lambda g: mlb_boxes(g["gamePk"]), games)):
                fetched += 1
                di = (date.fromisoformat(g.get("officialDate") or start.isoformat()) - start).days
                for pid, row in box.items():
                    for target in ([acc, acc_day[di]] if 0 <= di < 7 else [acc]):
                        a = target.setdefault(pid, {})
                        for part, vals in row.items():
                            a[part] = [x + y for x, y in zip(a[part], vals)] if part in a else list(vals)
        if k in recent:
            days_out[k] = {"start": start.isoformat(), "days": [mlb_lines(x) for x in acc_day]}
        done = all((g.get("status") or {}).get("abstractGameState") == "Final" for g in by_week[k])
        over = today > min(end, last_day)
        weeks[k] = {"start": start.isoformat(), "end": end.isoformat(), "final": bool(over and done and datetime.now(timezone.utc) >= after_night(min(end, last_day))), "lines": mlb_lines(acc)}
    print(f"MLB weeks: {len(weeks)} ({fetched} box scores fetched)")
    write_weeks("mlb", {"sport": "mlb", "season": str(year), "updated": NOW, "source": "MLB Stats API", "lines": {"bat": WK_BAT, "pit": WK_PIT}, "weeks": weeks})
    path = os.path.join(OUT, "days-mlb.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"sport": "mlb", "season": str(year), "updated": NOW, "lines": {"bat": WK_BAT, "pit": WK_PIT}, "weeks": days_out}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {path}: weeks {', '.join(sorted(days_out, key=int))}")


# ---------- NFL ----------
NFL_COLS = ["g", "pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td", "rec", "rec_tgt", "rec_yd", "rec_td", "fum_lost",
            "fgm", "fga", "xpm", "def_td", "def_int", "def_sack", "pts_allow", "pts_std", "pts_half_ppr", "pts_ppr",
            # Sleeper's stat keys, on the end, for the extra categories and custom points
            "pass_att", "pass_cmp", "pass_fd", "rush_fd", "rec_fd", "pass_2pt", "rush_2pt", "rec_2pt", "fum", "fgm_50p", "xpmiss",
            "fum_rec", "ff", "safe", "def_st_td", "yds_allow",
            # individual defensive players (IDP, nfl_idp below): Sleeper's defensive stats. A defender's pts_* columns
            # carry his IDP points (idp_pts), so every scoring scores him; the live feed stops short of these too
            "idp_tkl_solo", "idp_tkl_ast", "idp_sack", "idp_tkl_loss", "idp_qb_hit", "idp_int", "idp_ff", "idp_fum_rec",
            "idp_pass_def", "idp_def_td", "idp_safe",
            # nflverse's play-by-play stats, on the end (NFLV_COLS): Sleeper has none of these, so the live feed stops short
            # of them and the page keeps the file's values (season.js mergeLive). They arrive overnight, not live.
            "epa_pass", "epa_rush", "epa_rec", "pass_sacked", "sack_yd", "air_rec", "yac_rec", "cpoe_x", "tm_tgt", "tm_air"]
NFLV_COLS = NFL_COLS[NFL_COLS.index("epa_pass"):]
NFLV_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv"
NFL_IDS_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"
PROJ_COLS = ["pts_std", "pts_half_ppr", "pts_ppr"]
NFL_POS = ["QB", "RB", "WR", "TE", "K", "DEF"]
# IDP: Sleeper's defenders by its own positions, folded into three fantasy ones
IDP_COLS = ["idp_tkl_solo", "idp_tkl_ast", "idp_sack", "idp_tkl_loss", "idp_qb_hit", "idp_int", "idp_ff", "idp_fum_rec", "idp_pass_def", "idp_def_td", "idp_safe"]
IDP_POINTS = {"idp_tkl_solo": 1, "idp_tkl_ast": 0.5, "idp_sack": 2, "idp_tkl_loss": 1, "idp_qb_hit": 0.5, "idp_int": 3, "idp_ff": 2,
              "idp_fum_rec": 2, "idp_pass_def": 1, "idp_def_td": 6, "idp_safe": 2}
IDP_MAP = {"DE": "DL", "DT": "DL", "NT": "DL", "DL": "DL", "EDGE": "DL", "LB": "LB", "ILB": "LB", "OLB": "LB", "MLB": "LB",
           "CB": "DB", "S": "DB", "SS": "DB", "FS": "DB", "DB": "DB"}
IDP_Q = "".join(f"&position%5B%5D={p}" for p in ["DL", "LB", "DB"])


def idp_pts(s):
    """A defender's IDP points from Sleeper's stat keys: 1 a solo tackle, 0.5 an assist, 2 a sack, 1 a tackle for loss,
    0.5 a QB hit, 3 an interception, 2 a forced fumble or recovery, 1 a pass defended, 6 a TD, 2 a safety."""
    return sum((s.get(k, 0) or 0) * w for k, w in IDP_POINTS.items())


def idp_pos(pl):
    pos = IDP_MAP.get(pl.get("position") or "")
    if pos:
        return pos
    for fp in pl.get("fantasy_positions") or []:
        if fp in ("DL", "LB", "DB"):
            return fp
    return None


def idp_line(s, g=None):
    """A defender's line in NFL_COLS, his IDP points in the three pts_* columns on top of anything Sleeper gave him."""
    line = [g if g is not None else (s.get("gp") or s.get("gms_active") or 0)] + [round(s.get(c, 0) or 0, 2) for c in NFL_COLS[1:]]
    extra = idp_pts(s)
    for c in ("pts_std", "pts_half_ppr", "pts_ppr"):
        i = NFL_COLS.index(c)
        line[i] = round(line[i] + extra, 2)
    return line
POS_Q = "".join(f"&position%5B%5D={p}" for p in NFL_POS)


def nfl_season():
    try:
        st = get("https://api.sleeper.app/v1/state/nfl")
        return int(st.get("league_season") or st.get("season")), st
    except Exception:
        now = datetime.now(timezone.utc)
        return (now.year if now.month >= 8 else now.year - 1), {}


def nfl_rows(url):
    rows = get(url)
    return rows if isinstance(rows, list) else []


def get_csv(url):
    import csv
    import io
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        return list(csv.DictReader(io.StringIO(r.read().decode("utf-8"))))


_NFL_IDS = None


def nfl_id_rows():
    """DynastyProcess's player id crosswalk (Sleeper, ESPN, nflverse and more), loaded once per run."""
    global _NFL_IDS
    if _NFL_IDS is None:
        try:
            _NFL_IDS = get_csv(NFL_IDS_URL)
        except Exception as e:
            print(f"Player id crosswalk didn't load: {type(e).__name__}: {e}")
            _NFL_IDS = []
    return _NFL_IDS


def nfl_espn_map():
    """Sleeper ids to ESPN's, from the crosswalk: Sleeper's own list leaves ESPN's id out for many players, and the
    pages need it for headshots."""
    out = {}
    for r in nfl_id_rows():
        s, e = (r.get("sleeper_id") or "").strip(), (r.get("espn_id") or "").strip().split(".")[0]
        if s and e and s != "NA" and e != "NA" and e.isdigit():
            out[s] = e
    return out


def add_espn(players):
    """Fill in a missing ESPN id (for the photo) from the crosswalk."""
    em = nfl_espn_map()
    n = 0
    for p in players:
        if not p.get("espn") and em.get(str(p.get("id"))):
            p["espn"] = em[str(p["id"])]
            n += 1
    if n:
        print(f"ESPN ids from the crosswalk: {n}")


def nfl_gsis_map(allp):
    """nflverse ids (gsis) to Sleeper's: Sleeper's own list first, DynastyProcess's crosswalk for anyone it lacks."""
    out = {}
    for r in nfl_id_rows():
        g, s = (r.get("gsis_id") or "").strip(), (r.get("sleeper_id") or "").strip()
        if g and s and s != "NA":
            out[g] = s
    for pid, q in (allp or {}).items():
        g = str((q or {}).get("gsis_id") or "").strip()
        if g:
            out[g] = str(pid)
    return out


def nflverse(season, ids):
    """nflverse's weekly player stats as NFLV_COLS lines: { week: { sleeper id: [values] } } and the teams each week's
    rows cover ({ week: set }), or None if the file didn't load. Completions over expected (cpoe_x) and the team's
    targets and air yards while he played (tm_tgt, tm_air) are stored as counts, so CPOE, target share and air yards
    share add up over weeks like any ratio."""
    try:
        rows = get_csv(NFLV_URL.format(season=season))
    except Exception as e:
        print(f"nflverse didn't load: {type(e).__name__}: {e}")
        return None
    f = lambda r, k: float(r.get(k) or 0) if (r.get(k) or "") not in ("", "NA") else 0.0
    weeks, teams, miss = {}, {}, 0
    for r in rows:
        if r.get("season_type") != "REG":
            continue
        w = str(int(r["week"]))
        teams.setdefault(w, set()).add(r.get("team"))
        if r.get("position") not in ("QB", "RB", "FB", "WR", "TE", "K"):
            continue                                   # defenders: the kit scores team defenses, not players
        sid = ids.get(r.get("player_id"))
        if not sid:
            miss += 1
            continue
        att, tgt, ts, ay, ays = f(r, "attempts"), f(r, "targets"), f(r, "target_share"), f(r, "receiving_air_yards"), f(r, "air_yards_share")
        line = [f(r, "passing_epa"), f(r, "rushing_epa"), f(r, "receiving_epa"), f(r, "sacks_suffered"), abs(f(r, "sack_yards_lost")), ay,
                f(r, "receiving_yards_after_catch"), f(r, "passing_cpoe") * att / 100,
                tgt / ts if ts > 0 else 0, ay / ays if abs(ays) >= 0.01 else 0]
        weeks.setdefault(w, {})[sid] = [round(x, 2) for x in line]
    print(f"nflverse: weeks {', '.join(sorted(weeks, key=int))}, {sum(len(x) for x in weeks.values())} player weeks, {miss} without a Sleeper id")
    return {"weeks": weeks, "teams": teams}


def nflv_into(line, vals):
    """A Sleeper line with nflverse's values laid over its end."""
    i = NFL_COLS.index(NFLV_COLS[0])
    line = list(line) + [0] * (len(NFL_COLS) - len(line))
    line[i:i + len(NFLV_COLS)] = vals
    return line


def nfl():
    season, state = nfl_season()
    try:
        stats = nfl_rows(f"https://api.sleeper.com/stats/nfl/{season}?season_type=regular{POS_Q}")
        proj = nfl_rows(f"https://api.sleeper.com/projections/nfl/{season}?season_type=regular{POS_Q}")
    except Exception as e:
        print(f"Sleeper didn't answer: {type(e).__name__}: {e}")
        stats, proj = [], []
    if len(stats) + len(proj) < 100:
        if os.path.exists(os.path.join(OUT, "nfl.json")):
            print("Kept the last NFL file")
            return
        return nfl_seed(season)
    by = {}

    def row_for(r):
        pl = r.get("player") or {}
        pos = pl.get("position") or r.get("position")
        if pos not in NFL_POS:
            return None
        pid = str(r.get("player_id"))
        name = f"{pl.get('first_name', '')} {pl.get('last_name', '')}".strip() or pid
        p = by.setdefault(pid, {"id": pid, "n": name, "t": r.get("team") or pl.get("team") or "FA", "pos": [pos], "l": {}})
        if pl.get("injury_status"):
            p["inj"] = pl["injury_status"]
        a = age_on(pl.get("birth_date")) if pl.get("birth_date") else pl.get("age")
        if a:
            p["age"] = a
        if pl.get("years_exp") is not None:
            p["exp"] = pl["years_exp"]
            if pl["years_exp"] == 0:
                p["rk"] = 1
        return p

    for r in stats:
        p = row_for(r)
        if not p:
            continue
        s = r.get("stats") or {}
        g = s.get("gp") or s.get("gms_active") or 0
        p["l"]["tot"] = [g] + [round(s.get(c, 0) or 0, 2) for c in NFL_COLS[1:]]
    # Rest of season: Sleeper's weekly projections for every week still to play, added up. Its season projection is
    # set before the season and doesn't move, so it's only the fallback (and the whole story before week 1).
    # This week's and next week's projections are kept whole, stat by stat (lines "wk9", "wk10"): a one-week game or a
    # showdown values players on them, and any scoring can score them. Backtested on weeks 3 to 8 of 2026, Sleeper's
    # weekly projection tracked real half-PPR scores far better than a player's season so far (0.68 against 0.39).
    week = int(state.get("week") or 0) if state.get("season_type") in (None, "regular") else 0
    ros, left = {}, list(range(week + 1, 19)) if week else []
    wk_lines = {}
    try:
        for w in ([week] if week else []) + left:
            got = {}
            for r in nfl_rows(f"https://api.sleeper.com/projections/nfl/{season}/{w}?season_type=regular{POS_Q}"):
                if row_for(r) is None:
                    continue
                s = r.get("stats") or {}
                pid = str(r.get("player_id"))
                if w <= week + 1:
                    got[pid] = [round(s.get("gp", 1) or 0, 2)] + [round(s.get(c, 0) or 0, 2) for c in NFL_COLS[1:]]
                if w == week:
                    continue
                acc = ros.setdefault(pid, [0.0] * len(PROJ_COLS))
                for i, c in enumerate(PROJ_COLS):
                    acc[i] += s.get(c, 0) or 0
            if w <= week + 1 and len(got) >= 100:
                wk_lines[w] = got
    except Exception as e:
        print(f"Weekly projections didn't answer: {type(e).__name__}: {e}")
        ros = {}
    use_ros = len(ros) >= 100
    print(f"Rest of season: weeks {left[0] if left else '-'} to 18, {len(ros)} players" if use_ros else "Using the season projection")
    for r in proj:
        p = row_for(r)
        if not p:
            continue
        s = r.get("stats") or {}
        p["l"]["proj"] = [round(s.get(c, 0) or 0, 1) for c in PROJ_COLS]
    if use_ros:
        for p in by.values():
            p["l"]["proj"] = [round(x, 1) for x in ros.get(p["id"], [0.0] * len(PROJ_COLS))]
    for w, got in wk_lines.items():
        for pid, line in got.items():
            if pid in by:
                # projected for nothing (ruled out, say) is kept short, so it isn't mistaken for no projection at all
                by[pid]["l"][f"wk{w}"] = line if any(line[1:]) else [0]
    print(f"Weekly projections kept: {', '.join(f'week {w} ({len(g)} players)' for w, g in wk_lines.items()) or 'none'}")
    # Sleeper's full player list: each player's college (for a league that limits starters from one conference), and
    # birth dates, for dynasty values, for anyone the stats rows left out
    allp = {}
    try:
        allp = get("https://api.sleeper.app/v1/players/nfl")
        for pid, p in by.items():
            q = allp.get(pid) or {}
            a = age_on(q.get("birth_date")) if q.get("birth_date") else q.get("age")
            if a and not p.get("age"):
                p["age"] = a
            if q.get("college"):
                p["col"] = q["college"]
            if q.get("espn_id"):
                p["espn"] = str(q["espn_id"])  # ESPN athlete id, for his photo
    except Exception as e:
        print(f"Sleeper's player list didn't load: {type(e).__name__}: {e}")
        # keep the colleges from the last file
        old = {str(x.get("id")): x.get("col") for x in (load(os.path.join(OUT, "nfl.json"), {}) or {}).get("players", []) if x.get("col")}
        for pid, p in by.items():
            if old.get(pid):
                p["col"] = old[pid]
    add_espn(by.values())
    print(f"NFL ages: {sum(1 for p in by.values() if p.get('age'))} of {len(by)}, colleges: {sum(1 for p in by.values() if p.get('col'))}, ESPN ids: {sum(1 for p in by.values() if p.get('espn'))}")
    # nflverse's EPA and the rest, each player's weeks added up into his season line
    nv = nflverse(season, nfl_gsis_map(allp))
    if nv:
        tot = {}
        for got in nv["weeks"].values():
            for sid, vals in got.items():
                tot[sid] = [a + b for a, b in zip(tot.get(sid, [0] * len(NFLV_COLS)), vals)]
        for pid, p in by.items():
            if p["l"].get("tot"):
                p["l"]["tot"] = nflv_into(p["l"]["tot"], [round(x, 2) for x in tot.get(pid, [0] * len(NFLV_COLS))])
    # in the pool: anyone who has scored, is projected for real points the rest of the way, or is projected to score this
    # week or next (a backup quarterback named the starter, say, and the depth a one-game draft of six teams needs:
    # without them a game's two teams came to 29 to 38 players, short of the 36 six teams start)
    hi = NFL_COLS.index("pts_half_ppr")
    players = [p for p in by.values() if (p["l"].get("tot") and p["l"]["tot"][hi] > 0) or (p["l"].get("proj") and p["l"]["proj"][1] > 20)
               or any(len(p["l"].get(f"wk{w}") or []) > hi and p["l"][f"wk{w}"][hi] >= 1 for w in wk_lines)]
    try:
        nfl_weeks(season, state, nv)
    except Exception as e:
        print(f"NFL weeks didn't build: {type(e).__name__}: {e}")
    write("nfl", {"sport": "nfl", "season": str(season), "week": state.get("week"), "updated": NOW, "source": "Sleeper (sleeper.com)",
                  "lines": {"tot": {"label": "Season totals", "cols": NFL_COLS},
                            "proj": {"label": "Rest-of-season projection" if use_ros else "Season projection", "cols": PROJ_COLS, "ros": use_ros, "weeks": len(left) if use_ros else 17},
                            **{f"wk{w}": {"label": f"Week {w} projection", "cols": NFL_COLS, "proj": True, "week": w, **week_dates(state, season, w)} for w in wk_lines}},
                  "players": players})
    try:
        nfl_idp(season, state, allp)
    except Exception as e:
        print(f"IDP didn't build: {type(e).__name__}: {e}")


# ---------- individual defensive players (IDP) ----------
# Their own files, so a league without IDP slots loads nothing more: nfl-idp.json (defenders in NFL_COLS, the same
# lines as nfl.json, merged into the pool by an IDP league) and weeks-nfl-idp.json (each week's defender lines in a
# short column list, IDP_WEEK_COLS, expanded into NFL_COLS by the pages; final when weeks-nfl.json's week is).
IDP_WEEK_COLS = ["g", "pts_std", "pts_half_ppr", "pts_ppr"] + IDP_COLS


def nfl_idp(season, state, allp=None):
    week = int(state.get("week") or 0) if state.get("season_type") in (None, "regular") else 0
    stats = nfl_rows(f"https://api.sleeper.com/stats/nfl/{season}?season_type=regular{IDP_Q}")
    proj = nfl_rows(f"https://api.sleeper.com/projections/nfl/{season}?season_type=regular{IDP_Q}")
    if len(stats) + len(proj) < 100:
        print("IDP: Sleeper didn't answer, kept the last files")
        return
    by = {}

    def row_for(r):
        pl = r.get("player") or {}
        pos = idp_pos(pl)
        if not pos:
            return None
        pid = str(r.get("player_id"))
        name = f"{pl.get('first_name', '')} {pl.get('last_name', '')}".strip() or pid
        p = by.setdefault(pid, {"id": pid, "n": name, "t": r.get("team") or pl.get("team") or "FA", "pos": [pos], "l": {}})
        if pl.get("injury_status"):
            p["inj"] = pl["injury_status"]
        a = age_on(pl.get("birth_date")) if pl.get("birth_date") else pl.get("age")
        if a:
            p["age"] = a
        if pl.get("years_exp") is not None:
            p["exp"] = pl["years_exp"]
        return p

    for r in stats:
        p = row_for(r)
        if p:
            p["l"]["tot"] = idp_line(r.get("stats") or {})
    left = list(range(week + 1, 19)) if week else []
    ros, wk_lines = {}, {}
    for w in ([week] if week else []) + left:
        got = {}
        for r in nfl_rows(f"https://api.sleeper.com/projections/nfl/{season}/{w}?season_type=regular{IDP_Q}"):
            p = row_for(r)
            if not p:
                continue
            st = r.get("stats") or {}
            line = idp_line(st, round(st.get("gp", 1) or 0, 2))
            if w <= week + 1:
                got[p["id"]] = line
            if w == week:
                continue
            acc = ros.setdefault(p["id"], [0.0] * len(PROJ_COLS))
            for i, c in enumerate(PROJ_COLS):
                acc[i] += line[NFL_COLS.index(c)]
        if w <= week + 1 and len(got) >= 100:
            wk_lines[w] = got
    use_ros = len(ros) >= 100
    for r in proj:
        p = row_for(r)
        if p:
            line = idp_line(r.get("stats") or {})
            p["l"]["proj"] = [round(line[NFL_COLS.index(c)], 1) for c in PROJ_COLS]
    if use_ros:
        for p in by.values():
            p["l"]["proj"] = [round(x, 1) for x in ros.get(p["id"], [0.0] * len(PROJ_COLS))]
    for w, got in wk_lines.items():
        for pid, line in got.items():
            if pid in by:
                by[pid]["l"][f"wk{w}"] = line
    for pid, p in by.items():
        q = (allp or {}).get(pid) or {}
        if q.get("college"):
            p["col"] = q["college"]
        if q.get("espn_id"):
            p["espn"] = str(q["espn_id"])
    add_espn(by.values())
    hi = NFL_COLS.index("pts_half_ppr")
    # in the pool: a defender with real IDP points so far, or projected for them the rest of the way or this week
    players = [p for p in by.values() if (p["l"].get("tot") and p["l"]["tot"][hi] >= 15) or (p["l"].get("proj") and p["l"]["proj"][1] >= 15)
               or any(len(p["l"].get(f"wk{w}") or []) > hi and p["l"][f"wk{w}"][hi] >= 2 for w in wk_lines)]
    write("nfl-idp", {"sport": "nfl", "idp": True, "season": str(season), "week": state.get("week"), "updated": NOW, "source": "Sleeper (sleeper.com), IDP",
                      "lines": {"tot": {"label": "Season totals", "cols": NFL_COLS},
                                "proj": {"label": "Rest-of-season projection" if use_ros else "Season projection", "cols": PROJ_COLS, "ros": use_ros, "weeks": len(left) if use_ros else 17},
                                **{f"wk{w}": {"label": f"Week {w} projection", "cols": NFL_COLS, "proj": True, "week": w, **week_dates(state, season, w)} for w in wk_lines}},
                      "points": IDP_POINTS, "players": players})
    nfl_idp_weeks(season, state, {p["id"] for p in players})


def nfl_idp_weeks(season, state, ids):
    """Each week's defender lines, for the defenders in the pool, in IDP_WEEK_COLS. A week is final when
    weeks-nfl.json's is; final weeks already in the file aren't fetched again."""
    nfl_w = (load("fantasy-kit/data/weeks-nfl.json") or {}).get("weeks", {})
    old = load("fantasy-kit/data/weeks-nfl-idp.json") or {}
    weeks = old.get("weeks", {}) if str(old.get("season")) == str(season) and old.get("cols") == IDP_WEEK_COLS else {}
    idx = [NFL_COLS.index(c) for c in IDP_WEEK_COLS]
    for k, w in sorted(nfl_w.items(), key=lambda x: int(x[0]) if x[0].isdigit() else 99):
        if not k.isdigit():
            continue
        if weeks.get(k, {}).get("final"):
            continue
        rows = nfl_rows(f"https://api.sleeper.com/stats/nfl/{season}/{k}?season_type=regular{IDP_Q}")
        lines = {}
        for r in rows:
            pid = str(r.get("player_id"))
            if pid not in ids or not idp_pos(r.get("player") or {}):
                continue
            st = r.get("stats") or {}
            line = idp_line(st)
            if line[0] or any(line[1:]):
                lines[pid] = [line[i] for i in idx]
        if not lines and weeks.get(k, {}).get("lines"):
            continue
        weeks[k] = {"start": w.get("start"), "end": w.get("end"), "final": bool(w.get("final")), "lines": lines}
    path = os.path.join(OUT, "weeks-nfl-idp.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"sport": "nfl", "idp": True, "season": str(season), "updated": NOW, "source": "Sleeper", "line": "tot", "cols": IDP_WEEK_COLS, "weeks": weeks}, f, separators=(",", ":"))
    print(f"Wrote {path}: {len(weeks)} weeks")


def week_dates(state, season, w):
    """A regular-season week's Tuesday to Monday, the way nfl_weeks counts them."""
    kick = state.get("season_start_date")
    if kick:
        k0 = date.fromisoformat(kick)
        tue1 = k0 - timedelta(days=(k0.weekday() - 1) % 7)
    else:
        sep1 = date(season, 9, 1)
        tue1 = sep1 + timedelta(days=(0 - sep1.weekday()) % 7 + 1)
    start = tue1 + timedelta(days=7 * (w - 1))
    return {"start": start.isoformat(), "end": (start + timedelta(days=6)).isoformat()}


def nfl_weeks(season, state, nv=None):
    """Each regular-season week's stats, Tuesday to Monday. Final weeks already in the file aren't fetched again, but
    nflverse's columns (nv) are laid over every week each run. A week is final once Sleeper's is over and nflverse covers
    every team that played in it (or two days after that, if nflverse never does), so a league closes it with its EPA."""
    if not state or state.get("season_type") not in ("regular", "post"):
        print("No NFL weeks: not the regular season")
        return
    cur = int(state.get("week") or 0) if state.get("season_type") == "regular" else 18
    kick = state.get("season_start_date")
    if kick:
        k0 = date.fromisoformat(kick)
        tue1 = k0 - timedelta(days=(k0.weekday() - 1) % 7)      # the Tuesday on or before kickoff
    else:
        sep1 = date(season, 9, 1)
        tue1 = sep1 + timedelta(days=(0 - sep1.weekday()) % 7 + 1)   # the Tuesday after Labor Day
    old = load("fantasy-kit/data/weeks-nfl.json") or {}
    # new columns: fetch every week again
    weeks = old.get("weeks", {}) if str(old.get("season")) == str(season) and old.get("cols") == NFL_COLS else {}
    now = datetime.now(timezone.utc)
    for w in range(1, min(cur, 18) + 1):
        k = str(w)
        start = tue1 + timedelta(days=7 * (w - 1))
        end = start + timedelta(days=6)
        if weeks.get(k, {}).get("final"):
            weeks[k].update(start=start.isoformat(), end=end.isoformat())
            continue
        rows = nfl_rows(f"https://api.sleeper.com/stats/nfl/{season}/{w}?season_type=regular{POS_Q}")
        lines, played = {}, set()
        for r in rows:
            pl = r.get("player") or {}
            if (pl.get("position") or r.get("position")) not in NFL_POS:
                continue
            st = r.get("stats") or {}
            g = st.get("gp") or st.get("gms_active") or 0
            line = [g] + [round(st.get(c, 0) or 0, 2) for c in NFL_COLS[1:]]
            if g or any(line[1:]):
                lines[str(r.get("player_id"))] = line
                if g and r.get("team"):
                    played.add(r.get("team"))
        if not lines and k in weeks and weeks[k].get("lines"):
            weeks[k].update(start=start.isoformat(), end=end.isoformat())
            continue                                   # keep what we had if Sleeper came back empty
        if not nv and k in weeks:                      # nflverse didn't load: keep last run's values for this week
            i = NFL_COLS.index(NFLV_COLS[0])
            for pid, line in lines.items():
                was = weeks[k].get("lines", {}).get(pid)
                if was and len(was) == len(NFL_COLS):
                    line[i:] = was[i:]
        # nflverse names teams its own way in a few cases
        alias = {"LAR": "LA", "JAC": "JAX", "WSH": "WAS"}
        covered = bool(nv) and {alias.get(t, t) for t in played} <= {alias.get(t, t) for t in nv["teams"].get(k, set())}
        over = now >= after_night(end)
        weeks[k] = {"start": start.isoformat(), "end": end.isoformat(), "final": over and (covered or now >= after_night(end) + timedelta(days=2)), "lines": lines}
    for k, got in ((nv or {}).get("weeks") or {}).items():
        if k not in weeks:
            continue
        lines = weeks[k]["lines"]
        for pid, vals in got.items():
            # a player with only nflverse numbers (a quarterback's kneel-downs, say) gets a line of his own
            lines[pid] = nflv_into(lines.get(pid) or [1] + [0] * (len(NFL_COLS) - 1), vals)
    write_weeks("nfl", {"sport": "nfl", "season": str(season), "updated": NOW, "source": "Sleeper",
                        "line": "tot", "cols": NFL_COLS, "weeks": weeks})


def nfl_seed(season):
    """No Sleeper here: a starter pool from the guillotine league's rosters and lineups."""
    g = load("guillotine/data.json", {}) or {}
    h = load("guillotine/history.json", {}) or {}
    by = {}
    for t in g.get("teams", []):
        for r in t.get("roster") or []:
            s = r.get("season") or {}
            tot = s.get("tot") or {}
            wk = [x for x in s.get("wk") or [] if isinstance(x, (int, float))]
            line = [s.get("g") or len(wk)] + [tot.get(c, 0) for c in NFL_COLS[1:]]
            pts = round(sum(wk), 2)
            line[NFL_COLS.index("pts_half_ppr")] = pts
            by[slug(r["name"])] = {"id": slug(r["name"]), "n": r["name"], "t": r.get("nfl") or "FA", "pos": [r.get("pos")], "l": {"tot": line}}
    for w in (h.get("weeks") or {}).values():
        for lineup in (w.get("lineups") or {}).values():
            for r in lineup:
                k = slug(r.get("n"))
                if not k or k in by or r.get("pos") not in NFL_POS:
                    continue
                by[k] = {"id": k, "n": r["n"], "t": r.get("nfl") or "FA", "pos": [r["pos"]], "l": {"tot": [0] * len(NFL_COLS)}}
            for r in lineup:
                k = slug(r.get("n"))
                if k in by and isinstance(r.get("pts"), (int, float)) and not any(x.get("name") == r["n"] for t in g.get("teams", []) for x in t.get("roster") or []):
                    line = by[k]["l"]["tot"]
                    line[0] += 1
                    line[NFL_COLS.index("pts_half_ppr")] = round(line[NFL_COLS.index("pts_half_ppr")] + r["pts"], 2)
    write("nfl", {"sport": "nfl", "season": str(season), "updated": NOW, "source": "Seed from the guillotine league (Sleeper refresh pending)",
                  "lines": {"tot": {"label": "Season totals", "cols": NFL_COLS}}, "players": list(by.values())})


# ---------- baseball prospects: FanGraphs' The Board, with this season's minor league lines ----------
# The newest list that's really out (next year's once it's published, else this year's updated in-season list), the
# ranked top 100 or so plus everyone graded 45 FV or better, so a dynasty league can go deep. Each prospect carries his
# minor league line for the season (all levels together) and his MLBAM id, which joins him to the player pool.
FG_BOARD = "https://www.fangraphs.com/api/prospects/board/prospects-list?draft={d}&season={y}&playerid=&position=&statType=player"
FG_MINORS = ("https://www.fangraphs.com/api/leaders/minor-league/data?pos=all&level=0&lg=2,4,5,6,7,8,9,10,11,14,12,13,15,16,17,18,30,32"
             "&stats={st}&qual=0&type=0&team=&season={y}&seasonEnd={y}&org=&ind=0&splitTeam=false")
PITCH = {"P", "SP", "RP", "RHP", "LHP", "SIRP", "MIRP"}


def birth_age(b):
    """an age from a birth date in either YYYY-MM-DD or M/D/YYYY"""
    b = str(b or "").strip()
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", b)
    if m:
        b = f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    return age_on(b) if b else None


def fv_num(x):
    m = re.match(r"\d+", str(x or ""))
    return int(m.group(0)) if m else 0


def mlb_prospects():
    y = date.today().year
    rows, which = None, None
    for d, season in ((f"{y + 1}prospect", y + 1), (f"{y}updated", y), (f"{y}prospect", y)):
        try:
            got = get(FG_BOARD.format(d=d, y=season))
        except Exception as e:
            print(f"Prospects {d}: {type(e).__name__}: {e}")
            continue
        # an unknown list comes back as an old one: take it only if it's for the season asked and really ranked
        ranked = [r for r in got if str(r.get("cOVR") or "").isdigit()]
        same = sum(1 for r in ranked[:40] if str(r.get("cSeason") or r.get("Season") or "").startswith(str(season)))
        print(f"Prospects {d}: {len(got)} rows, {len(ranked)} ranked, seasons {sorted({str(r.get('cSeason')) for r in ranked[:40]})}")
        if len(ranked) >= 50 and same >= 30:
            rows, which = got, (d, season)
            break
    if not rows:
        print("Prospects: no list answered")
        return
    keep = [r for r in rows if str(r.get("cOVR") or "").isdigit() or fv_num(r.get("cFV")) >= 45]
    keep.sort(key=lambda r: (int(r["cOVR"]) if str(r.get("cOVR") or "").isdigit() else 10000, -fv_num(r.get("cFV")), int(r.get("cORG") or 999)))
    lines = {}
    for st in ("bat", "pit"):
        try:
            got = get(FG_MINORS.format(st=st, y=y))
            got = got if isinstance(got, list) else got.get("data", [])
        except Exception as e:
            print(f"Minor league {st}: {type(e).__name__}: {e}")
            got = []
        by = {}
        for r in got:
            by.setdefault(r.get("minormasterid"), []).append(r)
        lines[st] = by

    def line(mid, st):
        rs = lines[st].get(mid) or []
        if not rs:
            return None, None
        tot = next((r for r in rs if str(r.get("TeamName") or "").strip("- ") == ""), None) or max(rs, key=lambda r: r.get("PA" if st == "bat" else "IP") or 0)
        lv = [r.get("level") for r in rs if r is not tot and r.get("level")] or [tot.get("level")]
        mlbam = next((r.get("xMLBAMID") for r in rs if r.get("xMLBAMID")), None)
        if st == "bat":
            out = {k: tot.get(k) for k in ("G", "PA", "HR", "R", "RBI", "SB")}
            out.update({k.lower(): round(tot.get(k) or 0, 3) for k in ("AVG", "OBP", "SLG")})
            out["wrc"] = round(tot.get("wRC+") or 0)
        else:
            out = {k: tot.get(k) for k in ("G", "GS", "W", "SV", "SO")}
            out.update({"ip": tot.get("IP"), "era": round(tot.get("ERA") or 0, 2), "whip": round(tot.get("WHIP") or 0, 2), "k": round((tot.get("K%") or 0) * 100, 1), "bb": round((tot.get("BB%") or 0) * 100, 1)})
        out = {k: (int(v) if isinstance(v, float) and v.is_integer() and k not in ("ip",) else v) for k, v in out.items()}
        out["lv"] = "/".join(dict.fromkeys(lv))
        return out, mlbam

    out = []
    for r in keep:
        mid = r.get("minorMasterId")
        pit = str(r.get("Position") or r.get("positionDB") or "").upper() in PITCH
        st, mlbam = line(mid, "pit" if pit else "bat")
        out.append({"rank": int(r["cOVR"]) if str(r.get("cOVR") or "").isdigit() else None, "org": int(r["cORG"]) if str(r.get("cORG") or "").isdigit() else None,
                    "n": fix_name(r.get("playerName") or ""), "t": r.get("Team") or "", "pos": r.get("Position") or r.get("positionDB") or "",
                    "age": birth_age(r.get("BirthDate")) or (round(float(r["Age"]), 1) if r.get("Age") else None),
                    "fv": str(r.get("cFV") or ""), "eta": str(r.get("cETA") or ""), "lv": r.get("llevel") or r.get("mlevel") or "", "risk": r.get("cRisk") or "",
                    "mlbam": str(mlbam) if mlbam else None, "pit": pit, "line": st})
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "prospects-mlb.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"updated": NOW, "season": y, "list": which[0], "listSeason": which[1], "source": "FanGraphs The Board (fangraphs.com/prospects)", "players": out}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {path}: {len(out)} prospects from {which[0]}, {sum(1 for p in out if p['line'])} with a minor league line")


def main(argv):
    want = argv[1:] or ["nba", "mlb", "nfl", "nhl"]
    for s in want:
        if s == "nhl":
            subprocess.run(["node", os.path.join(ROOT, "tools", "fantasykit_nhl.mjs")], check=True)
            continue
        if s == "prospects":
            mlb_prospects()
            continue
        {"nba": nba, "mlb": mlb, "nfl": nfl}[s]()
        if s == "nba":
            nba_weeks()
        if s == "mlb":
            try:
                mlb_weeks()
            except Exception as e:
                print(f"MLB weeks didn't build: {type(e).__name__}: {e}")
            try:
                mlb_prev()
            except Exception as e:
                print(f"MLB last-season lines didn't build: {type(e).__name__}: {e}")
            try:
                mlb_prospects()
            except Exception as e:
                print(f"MLB prospects didn't build: {type(e).__name__}: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
