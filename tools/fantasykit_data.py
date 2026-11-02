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

  python tools/fantasykit_data.py            all three
  python tools/fantasykit_data.py nfl        one sport
"""
import json
import os
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone

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


def write(sport, data):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, sport + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {path}: {len(data['players'])} players")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


# ---------- NBA ----------
NBA_COLS = ["gp", "eg", "min", "fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "ast", "stl", "blk", "tov"]
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
            va = a[ix[c]] if a else 0
            vb = b[ix[c]] if b else 0
            line.append(round((va * ga + vb * k) / (ga + k), 2))
        p = bio.get(pid, {})
        nm = (names.get(pid) or [p.get("n") or pid.replace("-", " ").title()])[0]
        team = (rosters.get(pid) or [None])[0] or (names.get(pid) or [None, None])[1] or p.get("t") or "FA"
        pos = p.get("ps") or LETTER_POS.get((rosters.get(pid) or [None, None, "F"])[2] or "F", ["SF", "PF"])
        row = {"id": pid, "n": nm, "t": team, "pos": pos, "l": {"pg": line}}
        if p.get("age"):
            row["age"] = p["age"]
        if inj.get(pid):
            row["inj"] = inj[pid][0]
        out.append(row)
    write("nba", {"sport": "nba", "season": season_label(st),
                  "updated": st.get("updated") or NOW, "source": "ESPN box scores via Hard Cap",
                  "lines": {"pg": {"label": "Per game", "cols": NBA_COLS}}, "players": out})


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
BAT_COLS = ["g", "pa", "ab", "r", "h", "hr", "rbi", "sb", "tb", "avg", "obp", "ops"]
PIT_COLS = ["g", "gs", "ip", "w", "l", "sv", "hld", "k", "er", "bb", "h", "era", "whip", "qs"]
OF = {"LF", "CF", "RF"}
MLB_ORDER = ["C", "1B", "2B", "3B", "SS", "OF", "UT", "SP", "RP"]


def ip_real(ip):                              # 96.1 means 96 and a third innings
    whole = int(ip)
    return whole + round((ip - whole) * 10) / 3


def mlb():
    years = sorted(f[:4] for f in os.listdir(os.path.join(ROOT, "tools", "mlb")) if re.match(r"\d{4}\.json$", f))
    if not years:
        print("No MLB season files")
        return
    src = load(f"tools/mlb/{years[-1]}.json")
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
        row["l"]["pit"] = line
    write("mlb", {"sport": "mlb", "season": years[-1], "updated": NOW, "source": "MLB Stats API (statsapi.mlb.com)",
                  "lines": {"bat": {"label": "Batting", "cols": BAT_COLS}, "pit": {"label": "Pitching", "cols": PIT_COLS}},
                  "players": list(by.values())})


# ---------- NFL ----------
NFL_COLS = ["g", "pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td", "rec", "rec_tgt", "rec_yd", "rec_td", "fum_lost",
            "fgm", "fga", "xpm", "def_td", "def_int", "def_sack", "pts_allow", "pts_std", "pts_half_ppr", "pts_ppr"]
PROJ_COLS = ["pts_std", "pts_half_ppr", "pts_ppr"]
NFL_POS = ["QB", "RB", "WR", "TE", "K", "DEF"]
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
        if pl.get("years_exp") is not None:
            p["exp"] = pl["years_exp"]
        return p

    for r in stats:
        p = row_for(r)
        if not p:
            continue
        s = r.get("stats") or {}
        g = s.get("gp") or s.get("gms_active") or 0
        p["l"]["tot"] = [g] + [round(s.get(c, 0) or 0, 2) for c in NFL_COLS[1:]]
    for r in proj:
        p = row_for(r)
        if not p:
            continue
        s = r.get("stats") or {}
        p["l"]["proj"] = [round(s.get(c, 0) or 0, 1) for c in PROJ_COLS]
    players = [p for p in by.values() if (p["l"].get("tot") and p["l"]["tot"][NFL_COLS.index("pts_half_ppr")] > 0) or (p["l"].get("proj") and p["l"]["proj"][1] > 20)]
    write("nfl", {"sport": "nfl", "season": str(season), "week": state.get("week"), "updated": NOW, "source": "Sleeper (sleeper.com)",
                  "lines": {"tot": {"label": "Season totals", "cols": NFL_COLS}, "proj": {"label": "Rest-of-season projection", "cols": PROJ_COLS}},
                  "players": players})


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


def main(argv):
    want = argv[1:] or ["nba", "mlb", "nfl"]
    for s in want:
        {"nba": nba, "mlb": mlb, "nfl": nfl}[s]()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
