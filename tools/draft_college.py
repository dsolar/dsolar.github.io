"""College numbers for the Big Board's player cards: draft/prospects.json.

For every prospect on draft/nba.json and draft/nfl.json who plays college ball, it joins his season from the college
hubs (cbb/data/players.json, cfb/data/players.json, both from ESPN), his ESPN id (the card loads his recent games with
it), his hometown, and a percentile profile against his position across Division I (basketball) or FBS (football),
measured the same way the college hubs' own player cards measure it. Overseas and G League prospects, and linemen with
no box-score stats, simply have no entry.

Runs after tools/draft_build.py in the Big Board workflow. No network: it reads files already in the repo.
"""
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(rel, default=None):
    try:
        with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def key(name):
    s = unicodedata.normalize("NFD", str(name or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", s)
    return re.sub(r"[^a-z]", "", s)


def school_key(s):
    s = key(s).replace("university", "").replace("state", "st")
    return s


def num(v):
    try:
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def r1(v, d=1):
    return None if v is None else round(v, d)


def pct_of(sorted_vals, v):
    """Same as the hubs' pctOf: share of the pool below him, ties split, 0-100."""
    if not sorted_vals or len(sorted_vals) < 10 or v is None:
        return None
    lo = sum(1 for w in sorted_vals if w < v)
    eq = sum(1 for w in sorted_vals if w == v)
    return round(100 * (lo + max(0, eq - 1) / 2) / (len(sorted_vals) - 1))


def match(prospect, pool_by_name):
    """His college record: same name, and the same school when two players share the name."""
    cands = pool_by_name.get(key(prospect["n"]), [])
    if len(cands) == 1:
        return cands[0]
    sk = school_key(prospect.get("school"))
    for c in cands:
        if school_key(c.get("team")) == sk or (sk and sk in school_key(c.get("team"))):
            return c
    return None


# ---------- basketball (cbb/app.js PCT_STATS, posGroup, pctPool) ----------
def bstat(p, k):
    return num((p.get("stats") or {}).get(k))


def game_score(p):
    g = lambda k: bstat(p, k)
    pts, reb, ast = g("pts"), g("reb"), g("ast")
    if not (pts or reb or ast):
        return None
    if g("fga") is not None and g("fgm") is not None:
        return round((pts or 0) + 0.4 * g("fgm") - 0.7 * g("fga") - 0.4 * ((g("fta") or 0) - (g("ftm") or 0)) + 0.45 * (reb or 0)
                     + (g("stl") or 0) + 0.7 * (ast or 0) + 0.7 * (g("blk") or 0) - 0.4 * (g("pf") or 0) - (g("tov") or 0), 1)
    return round(0.7 * ((pts or 0) + 0.6 * (reb or 0) + 0.9 * (ast or 0)), 1)


B_STATS = [
    ("pts", "Scoring", lambda p: bstat(p, "pts"), lambda v: f"{v:.1f} a game"),
    ("ts", "Efficiency", lambda p: bstat(p, "ts") if (bstat(p, "fga") or 0) >= 5 else None, lambda v: f"{v:.1f}% TS"),
    ("tp", "Three-point %", lambda p: bstat(p, "threePct") if (bstat(p, "threeAtt") or 0) >= 2 else None, lambda v: f"{v:.1f}% from 3"),
    ("tpa", "Threes a game", lambda p: bstat(p, "threeAtt"), lambda v: f"{v:.1f} tried"),
    ("reb", "Rebounding", lambda p: bstat(p, "reb"), lambda v: f"{v:.1f} a game"),
    ("ast", "Playmaking", lambda p: bstat(p, "ast"), lambda v: f"{v:.1f} assists"),
    ("ato", "Ball security", lambda p: (bstat(p, "ast") or 0) / bstat(p, "tov") if (bstat(p, "tov") or 0) >= 1 else None, lambda v: f"{v:.2f} A/TO"),
    ("stl", "Steals", lambda p: bstat(p, "stl"), lambda v: f"{v:.1f} a game"),
    ("blk", "Blocks", lambda p: bstat(p, "blk"), lambda v: f"{v:.1f} a game"),
    ("gs", "Game Score", game_score, lambda v: f"{v:.1f} a game"),
]
B_GROUP_NAME = {"G": "guards", "F": "forwards", "C": "centers"}


def b_group(pos):
    """The board's position (PG, SF, PF/C...) decides the group, so a card that says SF is measured against forwards."""
    s = str(pos or "").upper().split("/")[0]
    if s.startswith("C"):
        return "C"
    if "F" in s or s in ("W", "WING"):
        return "F"
    return "G"


def b_espn_group(pos):  # ESPN's roster position, for building the pools (cbb/app.js posGroup)
    s = str(pos or "").upper()
    return "C" if "C" in s and "G" not in s else "F" if "F" in s and "G" not in s else "G"


def basketball(board, cbb):
    players = cbb.get("players") or []
    by_name = {}
    for p in players:
        by_name.setdefault(key(p.get("name")), []).append(p)
    regs = [p for p in players if (bstat(p, "gp") or 0) >= 3 and (bstat(p, "min") or 0) >= 15]
    pools = {}
    for g in ("G", "F", "C"):
        grp = [p for p in regs if b_espn_group(p.get("pos")) == g]
        pools[g] = {"n": len(grp), "s": {k: sorted(v for v in (fn(p) for p in grp) if v is not None) for k, _, fn, _ in B_STATS}}
    out = {}
    for bp in board.get("players") or []:
        c = match(bp, by_name)
        if not c:
            continue
        s = c.get("stats") or {}
        gp = num(s.get("gp")) or 0
        e = {"espn": str(c["id"]), "team": c.get("team"), "conf": c.get("conference"), "gp": int(gp)}
        if gp >= 1:
            e["line"] = {k: r1(num(s.get(k)), 3 if k.endswith("Pct") else 1) for k in
                         ("min", "pts", "reb", "ast", "stl", "blk", "tov", "pf", "fgm", "fga", "fgPct", "tpm", "threeAtt", "threePct", "ftm", "fta", "ftPct", "ts", "efg")
                         if num(s.get(k)) is not None}
            e["line"]["gs"] = game_score(c)
            g = b_group(bp.get("pos"))
            rows = []
            for k, label, fn, fmt in B_STATS:
                v = fn(c)
                pc = pct_of(pools[g]["s"][k], v)
                if pc is not None:
                    rows.append([label, fmt(v), pc])
            if rows:
                e["prof"] = rows
                e["pool"] = "Division I " + B_GROUP_NAME[g]
                e["poolN"] = pools[g]["n"]
                e["small"] = not (gp >= 3 and (num(s.get("min")) or 0) >= 15)
        out[bp["id"]] = e
    return out


# ---------- football (cfb/app.js CFB_POOLS, pv, cfbBars) ----------
def fst(p, k):
    return num((p.get("s") or {}).get(k))


def fpv(p, k):
    g = lambda x: fst(p, x)
    if k == "cpct":
        return 100 * g("cmp") / g("att") if g("att") and g("cmp") is not None else None
    if k == "ypc":
        return g("ryd") / g("car") if g("car") and g("ryd") is not None else None
    if k == "ypr":
        return g("wyd") / g("rec") if g("rec") and g("wyd") is not None else None
    return g(k)


def per(p, k):
    gp, v = fst(p, "gp"), fst(p, k)
    return v / gp if gp and v is not None else None


REC = [("Receiving yards a game", lambda p: per(p, "wyd"), 1, ""), ("Yards per catch", lambda p: fpv(p, "ypr"), 1, ""), ("Catches a game", lambda p: per(p, "rec"), 1, ""),
       ("Receiving TDs a game", lambda p: per(p, "wtd"), 1, ""), ("YAC per catch", lambda p: fst(p, "yac") / fst(p, "rec") if (fst(p, "yac") or 0) > 0 and fst(p, "rec") else None, 1, "")]
F_POOLS = {
    "QB": ("quarterbacks", ["QB"], lambda p: (fst(p, "att") or 0) >= 80, [
        ("Yards per attempt", lambda p: fpv(p, "ypa"), 1, ""), ("Completion %", lambda p: fpv(p, "cpct"), 1, ""),
        ("TD rate", lambda p: 100 * (fst(p, "ptd") or 0) / fst(p, "att") if fst(p, "att") else None, 1, "%"),
        ("INT rate", lambda p: 100 * (fst(p, "int") or 0) / fst(p, "att") if fst(p, "att") else None, -1, "%"), ("QBR", lambda p: fst(p, "aqbr"), 1, ""),
        ("Pass yards a game", lambda p: per(p, "pyd"), 1, ""), ("Rush yards a game", lambda p: per(p, "ryd"), 1, "")]),
    "RB": ("running backs", ["RB", "FB"], lambda p: (fst(p, "car") or 0) >= 40, [
        ("Yards per carry", lambda p: fpv(p, "ypc"), 1, ""), ("Rush yards a game", lambda p: per(p, "ryd"), 1, ""), ("Rush TDs a game", lambda p: per(p, "rtd"), 1, ""),
        ("Receiving yards a game", lambda p: per(p, "wyd"), 1, "")]),
    "WR": ("wide receivers", ["WR"], lambda p: (fst(p, "rec") or 0) >= 12, REC),
    "TE": ("tight ends", ["TE"], lambda p: (fst(p, "rec") or 0) >= 12, REC),
    "DL": ("defensive linemen", ["DL", "DE", "DT", "EDGE", "NT"], lambda p: (fst(p, "tkl") or 0) >= 10, [
        ("Tackles a game", lambda p: per(p, "tkl"), 1, ""), ("TFL a game", lambda p: per(p, "tfl"), 1, ""), ("Sacks a game", lambda p: per(p, "dsk"), 1, ""),
        ("Forced fumbles", lambda p: fst(p, "ff"), 1, ""), ("Passes defended", lambda p: fst(p, "pd"), 1, "")]),
    "LB": ("linebackers", ["LB"], lambda p: (fst(p, "tkl") or 0) >= 10, [
        ("Tackles a game", lambda p: per(p, "tkl"), 1, ""), ("TFL a game", lambda p: per(p, "tfl"), 1, ""), ("Sacks a game", lambda p: per(p, "dsk"), 1, ""),
        ("Interceptions", lambda p: fst(p, "dint"), 1, ""), ("Passes defended", lambda p: fst(p, "pd"), 1, "")]),
    "DB": ("defensive backs", ["DB", "S", "CB"], lambda p: (fst(p, "tkl") or 0) >= 10, [
        ("Tackles a game", lambda p: per(p, "tkl"), 1, ""), ("Interceptions", lambda p: fst(p, "dint"), 1, ""), ("Passes defended", lambda p: fst(p, "pd"), 1, ""),
        ("TFL a game", lambda p: per(p, "tfl"), 1, "")]),
}
# the board says EDGE, IOL, S, CB...; the pool is picked from the college roster position first, then the board's
BOARD_POS = {"EDGE": "DL", "IDL": "DL", "DT": "DL", "DE": "DL", "S": "DB", "CB": "DB", "SAF": "DB", "OT": None, "IOL": None, "OL": None, "OG": None, "C": None}
F_GROUPS = [
    ("Passing", [("att", "Att"), ("cmp", "Cmp"), ("cpct", "Cmp%"), ("pyd", "Yds"), ("ypa", "Y/A"), ("ptd", "TD"), ("int", "INT"), ("aqbr", "QBR")], lambda p: (fst(p, "att") or 0) >= 10),
    ("Rushing", [("car", "Car"), ("ryd", "Yds"), ("ypc", "YPC"), ("rtd", "TD"), ("rlong", "Long")], lambda p: (fst(p, "car") or 0) >= 5),
    ("Receiving", [("rec", "Rec"), ("wyd", "Yds"), ("ypr", "Y/R"), ("wtd", "TD"), ("wlong", "Long"), ("yac", "YAC")], lambda p: (fst(p, "rec") or 0) >= 3),
    ("Defense", [("tkl", "Tkl"), ("solo", "Solo"), ("tfl", "TFL"), ("dsk", "Sacks"), ("dint", "INT"), ("pd", "PD"), ("ff", "FF")], lambda p: (fst(p, "tkl") or 0) >= 3 or (fst(p, "dint") or 0) > 0),
]
DEC = {"cpct", "ypa", "ypc", "ypr", "aqbr", "tfl", "dsk"}


def f_pool(college_pos, board_pos):
    for pos in (str(college_pos or "").upper(), str(board_pos or "").upper()):
        for k, (_, plist, _, _) in F_POOLS.items():
            if pos in plist:
                return k
        if pos in BOARD_POS and BOARD_POS[pos]:
            return BOARD_POS[pos]
    return None


def football(board, cfb):
    players = cfb.get("players") or []
    by_id, by_name = {}, {}
    for p in players:
        by_name.setdefault(key(p.get("name")), []).append(p)
        if (p.get("nfl") or {}).get("id"):
            by_id[p["nfl"]["id"]] = p              # the CFB hub already matched these to the board
    pools = {}
    for k, (name, plist, ok, stats) in F_POOLS.items():
        grp = [p for p in players if str(p.get("pos") or "").upper() in plist and ok(p)]
        pools[k] = {"n": len(grp), "s": [sorted(v for v in (fn(p) for p in grp) if v is not None) for _, fn, _, _ in stats]}
    out = {}
    for bp in board.get("players") or []:
        c = by_id.get(bp["id"]) or match(bp, by_name)
        if not c:
            continue
        gp = fst(c, "gp") or 0
        e = {"espn": str(c["id"]), "team": c.get("team"), "gp": int(gp)}
        if c.get("home"):
            e["home"] = c["home"]
        groups = []
        for gname, cols, show in F_GROUPS:
            if not show(c):
                continue
            row = []
            for k, lab in cols:
                v = fpv(c, k)
                if v is None:
                    continue
                row.append([lab, round(v, 1) if k in DEC else int(round(v))])
            if row:
                groups.append([gname, row])
        if groups:
            e["groups"] = groups
        k = f_pool(c.get("pos"), bp.get("pos"))
        if k and gp >= 1:
            name, _, ok, stats = F_POOLS[k]
            rows = []
            for i, (label, fn, sign, unit) in enumerate(stats):
                v = fn(c)
                pc = pct_of(pools[k]["s"][i], v)
                if pc is None:
                    continue
                if sign < 0:
                    pc = 100 - pc
                rows.append([label, (f"{v:.2f}" if abs(v) < 1 and v != 0 else f"{v:.1f}") + unit, pc])
            if rows:
                e["prof"] = rows
                e["pool"] = "FBS " + name
                e["poolN"] = pools[k]["n"]
                e["small"] = not ok(c)
        out[bp["id"]] = e
    return out


def main():
    nba, nfl = load("draft/nba.json", {}), load("draft/nfl.json", {})
    cbb, cfb = load("cbb/data/players.json", {}), load("cfb/data/players.json", {})
    res = {"nba": basketball(nba, cbb) if nba and cbb else {}, "nfl": football(nfl, cfb) if nfl and cfb else {},
           "sources": {"nba": cbb.get("updated"), "nfl": cfb.get("updated")}}
    path = os.path.join(ROOT, "draft", "prospects.json")
    old = load("draft/prospects.json", {}) or {}
    old.pop("updated", None)
    if old == res:
        print("prospects: no change")
        return 0
    res["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    for lg in ("nba", "nfl"):
        b = (nba if lg == "nba" else nfl).get("players") or []
        got = res[lg]
        print(f"{lg}: {len(got)} of {len(b)} prospects matched to college stats, {sum(1 for v in got.values() if v.get('prof'))} with a profile; "
              f"top 30 missing: {', '.join(p['n'] for p in b[:30] if p['id'] not in got) or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
