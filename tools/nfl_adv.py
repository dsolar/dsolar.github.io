#!/usr/bin/env python3
"""Advanced NFL numbers for the NFL Hub, from four of nflverse's public feeds, into nfl/data/adv.json.

  ESPN QBR            espn_data/qbr_season_level.csv, ESPN's quarterback rating (0-100, 50 is average)
  PFR advanced        pfr_advstats/advstats_week_*_{season}.csv, Pro Football Reference's charting: pressures,
                      bad throws, yards before and after contact, broken tackles, coverage allowed, missed tackles
  FTN charting        ftn_charting/ftn_charting_{season}.csv, FTN Data's hand charting of every play (CC-BY-SA 4.0,
                      credit FTN Data via nflverse): play-action, motion, blitzers, contested and catchable balls,
                      interception-worthy throws, drops
  Play-by-play        pbp/play_by_play_{season}.parquet, for EPA, success rate and to tie FTN's plays to players

Pools, each player keyed by GSIS id with n (name), pos, t (team), x (numbers in cols[pool] order) and pct (percentile
within his position group, flipped where lower is better, left out where neither direction is "good"):
  qb    quarterbacks with 12+ dropbacks a team game     rb   backs with 6+ carries a team game
  rec   receivers and tight ends with 3+ targets a game  rush  pass rushers with 8+ pressures
  cov   cornerbacks, safeties and linebackers targeted 15+ times
teams: each team's style and defense, {TEAM: [numbers in tcols order]}, with each column's rank (1 = most).

EPA and success rate leave out garbage time (win probability under 5% or over 95%), as the hub's team numbers do.
If a download fails, the last good file's part is kept.

Usage: python3 tools/nfl_adv.py [season] [--dir PATH]   (a folder of already-downloaded files, for testing)
"""
import csv
import io
import json
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "nfl" / "data" / "adv.json"
BASE = "https://github.com/nflverse/nflverse-data/releases/download/"
UA = "davidsolar-nflhub/1.0 (+https://davidsolar.dev/nfl/)"
FIX = {"LA": "LAR", "WSH": "WAS", "JAC": "JAX", "OAK": "LV", "SD": "LAC", "STL": "LAR"}
PBP_COLS = ["game_id", "play_id", "week", "season_type", "posteam", "defteam", "epa", "qb_epa", "success", "wp",
            "qb_dropback", "qb_scramble", "pass_attempt", "rush_attempt", "sack", "complete_pass", "two_point_attempt",
            "passer_id", "rusher_id", "receiver_id", "air_yards", "yards_gained", "pass_oe", "down",
            "half_seconds_remaining", "shotgun", "qb_spike", "qb_kneel"]

args = [a for a in sys.argv[1:] if not a.startswith("--")]
SEASON = int(args[0]) if args else 2026
DIR = Path(sys.argv[sys.argv.index("--dir") + 1]) if "--dir" in sys.argv else None

# (short name, percentile direction: 1 higher is better, -1 lower is better, 0 none)
COLS = {
    "qb": [("db", 0), ("qbr", 1), ("epa", 1), ("sr", 1), ("prs", 0), ("p2s", -1), ("bad", -1), ("iw", -1), ("ta", 0),
           ("pa", 0), ("oop", 0), ("blz", 0)],
    "rb": [("att", 0), ("epa", 1), ("sr", 1), ("ybc", 0), ("yac", 1), ("bt", 1), ("stuff", -1)],
    "rec": [("tgt", 0), ("epa", 1), ("sr", 1), ("adot", 0), ("ctc", 0), ("cc", 1), ("crt", 1), ("drop", -1), ("bt", 1)],
    "rush": [("g", 0), ("prs", 0), ("ppg", 1), ("sk", 1), ("hit", 1), ("hry", 1), ("comb", 0), ("mtk", -1)],
    "cov": [("tgt", 0), ("cmp", -1), ("ypt", -1), ("td", -1), ("int", 1), ("rat", -1), ("adot", 0), ("mtk", -1)],
}
TCOLS = ["proe", "motion", "pa", "rpo", "screen", "nohud", "gun", "box", "blitz", "rushers", "dbox", "dprs"]


def fetch(path):
    if DIR:
        return (DIR / Path(path).name).read_bytes()
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def rows(path):
    return list(csv.DictReader(io.StringIO(fetch(path).decode("utf-8"))))


def f(v):
    try:
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def tf(v):
    return str(v).upper() == "TRUE"


def team(t):
    return FIX.get(t, t)


def rate(a, b, k=100, d=1):
    return round(k * a / b, d) if b else None


def mean(xs, d=3):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), d) if xs else None


def pct_ranks(players, idx, direction):
    vals = sorted(p["x"][idx] for p in players if p["x"][idx] is not None)
    n, out = len(vals), {}
    for p in players:
        v = p["x"][idx]
        if v is None or n < 2:
            continue
        below = sum(1 for w in vals if w < v)
        equal = sum(1 for w in vals if w == v)
        r = (below + (equal - 1) / 2) / (n - 1)
        out[id(p)] = round(100 * (r if direction > 0 else 1 - r))
    return out


def passer_rating(cmp, att, yds, td, ints):
    if not att:
        return None
    c = lambda v: max(0.0, min(2.375, v))
    return round(100 * (c((cmp / att - 0.3) * 5) + c((yds / att - 3) * 0.25) + c(td / att * 20) + c(2.375 - ints / att * 25)) / 6, 1)


def main():
    league = json.load(open(ROOT / "nfl" / "data" / "league.json"))
    by_id = {p["id"]: p for p in league.get("players", [])}
    pfr = {p["pfr"]: p["id"] for p in league.get("players", []) if p.get("pfr")}
    espn = {str(p["espn"]): p["id"] for p in league.get("players", []) if p.get("espn")}
    try:
        prev = json.load(open(OUT))
        if prev.get("season") != SEASON:
            prev = {}
    except Exception:
        prev = {}
    out = {"season": SEASON, "week": None, "pulled": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
           "cols": {k: [c[0] for c in v] for k, v in COLS.items()}, "tcols": TCOLS, "failed": []}

    # nflverse's player list fills the PFR and ESPN ids the league file lacks, and names players it doesn't carry
    names = {}
    try:
        for r in rows("players/players.csv"):
            g = r.get("gsis_id")
            if g:
                names[g] = (r.get("display_name"), str(r.get("espn_id") or "").split(".")[0] or None, r.get("position"))
            if g:
                if r.get("pfr_id"):
                    pfr.setdefault(r["pfr_id"], g)
                if r.get("espn_id"):
                    espn.setdefault(str(r["espn_id"]).split(".")[0], g)
    except Exception as e:
        print(f"players: {e}", file=sys.stderr)

    import pyarrow.parquet as pq
    try:
        pbp = [p for p in pq.read_table(io.BytesIO(fetch(f"pbp/play_by_play_{SEASON}.parquet")), columns=PBP_COLS).to_pylist()
               if p["season_type"] == "REG" and not p["two_point_attempt"]]
    except Exception as e:
        print(f"play-by-play: {e}; keeping the last file", file=sys.stderr)
        return
    out["week"] = max((p["week"] for p in pbp), default=None)
    games = defaultdict(set)
    for p in pbp:
        if p["posteam"]:
            games[team(p["posteam"])].add(p["game_id"])
    tg = {t: len(g) for t, g in games.items()}
    try:
        ftn = {(r["nflverse_game_id"], int(f(r["nflverse_play_id"]) or 0)): r for r in rows(f"ftn_charting/ftn_charting_{SEASON}.csv")}
    except Exception as e:
        print(f"FTN: {e}", file=sys.stderr)
        out["failed"].append("ftn")
        ftn = {}

    def live(p):
        return p["wp"] is not None and 0.05 <= p["wp"] <= 0.95

    # ---------- per-player play-by-play and FTN tallies ----------
    Q = defaultdict(lambda: defaultdict(float))
    team_of = {}
    for p in pbp:
        fx = ftn.get((p["game_id"], int(p["play_id"] or 0)))
        pt = team(p["posteam"]) if p["posteam"] else None
        if p["qb_dropback"] and p["passer_id"] and not p["qb_spike"]:
            q = Q["qb:" + p["passer_id"]]
            team_of[p["passer_id"]] = pt
            q["db"] += 1
            if p["pass_attempt"] and not p["sack"]:
                q["att"] += 1
            if live(p) and p["qb_epa"] is not None:
                q["epa_n"] += 1; q["epa"] += p["qb_epa"]; q["sr"] += 1 if p["success"] else 0
            if fx:
                q["f_db"] += 1
                q["pa"] += tf(fx["is_play_action"]); q["oop"] += tf(fx["is_qb_out_of_pocket"]); q["blz"] += (f(fx["n_blitzers"]) or 0) > 0
                if p["pass_attempt"] and not p["sack"]:
                    q["f_att"] += 1; q["iw"] += tf(fx["is_interception_worthy"]); q["ta"] += tf(fx["is_throw_away"])
        if p["rush_attempt"] and p["rusher_id"] and not p["qb_scramble"] and not p["qb_kneel"]:
            q = Q["rb:" + p["rusher_id"]]
            team_of.setdefault(p["rusher_id"], pt)
            q["att"] += 1; q["stuff"] += 1 if (p["yards_gained"] or 0) <= 0 else 0
            if live(p) and p["epa"] is not None:
                q["epa_n"] += 1; q["epa"] += p["epa"]; q["sr"] += 1 if p["success"] else 0
        if p["pass_attempt"] and not p["sack"] and p["receiver_id"]:
            q = Q["rec:" + p["receiver_id"]]
            team_of.setdefault(p["receiver_id"], pt)
            q["tgt"] += 1; q["rec"] += 1 if p["complete_pass"] else 0
            if p["air_yards"] is not None:
                q["ay_n"] += 1; q["ay"] += p["air_yards"]
            if live(p) and p["epa"] is not None:
                q["epa_n"] += 1; q["epa"] += p["epa"]; q["sr"] += 1 if p["success"] else 0
            if fx:
                q["f_tgt"] += 1
                if tf(fx["is_contested_ball"]):
                    q["ctc"] += 1; q["ccw"] += 1 if p["complete_pass"] else 0
                q["crt"] += tf(fx["is_created_reception"])
                if tf(fx["is_catchable_ball"]):
                    q["catchable"] += 1; q["drop"] += tf(fx["is_drop"])

    # ---------- PFR weekly sums ----------
    def pfr_sum(kind, fields):
        try:
            data = rows(f"pfr_advstats/advstats_week_{kind}_{SEASON}.csv")
        except Exception as e:
            print(f"PFR {kind}: {e}", file=sys.stderr)
            out["failed"].append("pfr_" + kind)
            return None
        s = defaultdict(lambda: defaultdict(float))
        for r in data:
            if r.get("game_type") not in (None, "", "REG"):
                continue
            g = pfr.get(r.get("pfr_player_id"))
            if not g:
                continue
            s[g]["g"] += 1
            s[g]["t"] = team(r.get("team"))
            for k in fields:
                s[g][k] += f(r.get(k)) or 0
        return s

    pp = pfr_sum("pass", ["times_pressured", "times_sacked", "passing_bad_throws", "times_blitzed"]) or {}
    pr = pfr_sum("rush", ["carries", "rushing_yards_before_contact", "rushing_yards_after_contact", "rushing_broken_tackles"]) or {}
    pc = pfr_sum("rec", ["receiving_broken_tackles"]) or {}
    pd = pfr_sum("def", ["def_targets", "def_completions_allowed", "def_yards_allowed", "def_receiving_td_allowed", "def_ints",
                         "def_air_yards_completed", "def_pressures", "def_sacks", "def_times_hitqb", "def_times_hurried",
                         "def_tackles_combined", "def_missed_tackles"])

    espn_all = {v[1]: g for g, v in names.items() if v[1]}
    try:
        qbr = {}
        for r in rows("espn_data/qbr_season_level.csv"):
            if r.get("season") == str(SEASON) and r.get("season_type") == "Regular":
                g = espn.get(str(r.get("player_id"))) or espn_all.get(str(r.get("player_id")))
                if g:
                    qbr[g] = f(r.get("qbr_total"))
    except Exception as e:
        print(f"QBR: {e}", file=sys.stderr)
        out["failed"].append("qbr")
        qbr = {}

    def entry(g, pos=None):
        p = by_id.get(g, {})
        nm = names.get(g, (None, None, None))
        return {"n": p.get("n") or nm[0], "pos": pos or p.get("pos"), "t": p.get("t") or team_of.get(g), "e": p.get("espn") or nm[1]}

    pools = {k: [] for k in COLS}
    for key, q in Q.items():
        kind, g = key.split(":", 1)
        t = team_of.get(g) or (by_id.get(g) or {}).get("t")
        n_g = tg.get(t, 0) or 1
        epa = round(q["epa"] / q["epa_n"], 3) if q["epa_n"] else None
        sr = rate(q["sr"], q["epa_n"])
        if kind == "qb" and q["db"] >= 12 * n_g:
            a = pp.get(g, {})
            row = entry(g, "QB")
            row["x"] = [int(q["db"]), qbr.get(g), epa, sr, rate(a.get("times_pressured", 0), q["db"]) if a else None,
                        rate(a.get("times_sacked", 0), a.get("times_pressured", 0)) if a else None,
                        rate(a.get("passing_bad_throws", 0), q["att"]) if a else None, rate(q["iw"], q["f_att"]),
                        rate(q["ta"], q["f_att"]), rate(q["pa"], q["f_db"]), rate(q["oop"], q["f_db"]), rate(q["blz"], q["f_db"])]
            pools["qb"].append((g, row))
        elif kind == "rb" and q["att"] >= 6 * n_g and (by_id.get(g) or {}).get("pos") in (None, "RB", "WR", "TE"):
            a = pr.get(g, {})
            c = a.get("carries", 0)
            row = entry(g)
            row["x"] = [int(q["att"]), epa, sr, round(a["rushing_yards_before_contact"] / c, 2) if c else None,
                        round(a["rushing_yards_after_contact"] / c, 2) if c else None,
                        rate(a.get("rushing_broken_tackles", 0), c) if c else None, rate(q["stuff"], q["att"])]
            pools["rb"].append((g, row))
        elif kind == "rec" and q["tgt"] >= 3 * n_g and (by_id.get(g) or {}).get("pos") in ("WR", "TE", "RB"):
            row = entry(g)
            row["x"] = [int(q["tgt"]), epa, sr, round(q["ay"] / q["ay_n"], 1) if q["ay_n"] else None, rate(q["ctc"], q["f_tgt"]),
                        rate(q["ccw"], q["ctc"]) if q["ctc"] >= 3 else None, int(q["crt"]), rate(q["drop"], q["catchable"]),
                        rate((pc.get(g) or {}).get("receiving_broken_tackles", 0), q["rec"]) if q["rec"] else None]
            pools["rec"].append((g, row))
    if pd is None:
        out["failed"].append("pfr_def")
    for g, a in (pd or {}).items():
        p = by_id.get(g, {})
        dp = p.get("dpos") or p.get("pos") or names.get(g, (None, None, None))[2]
        grp = "EDGE" if dp in ("DE", "OLB") else "IDL" if dp in ("DT", "NT", "DL") else "CB" if dp in ("CB", "DB") else "S" if dp in ("FS", "SS", "S", "SAF") else "LB" if dp in ("ILB", "MLB", "LB") else None
        if not grp:
            continue
        mt = rate(a["def_missed_tackles"], a["def_tackles_combined"] + a["def_missed_tackles"]) if a["def_tackles_combined"] + a["def_missed_tackles"] >= 10 else None
        if grp in ("EDGE", "IDL", "LB") and a["def_pressures"] >= 8:
            row = entry(g, grp)
            row["t"] = p.get("t") or a.get("t")
            row["x"] = [int(a["g"]), int(a["def_pressures"]), round(a["def_pressures"] / a["g"], 2), a["def_sacks"], int(a["def_times_hitqb"]),
                        int(a["def_times_hurried"]), int(a["def_tackles_combined"]), mt]
            pools["rush"].append((g, row))
        if grp in ("CB", "S", "LB") and a["def_targets"] >= 15:
            tgt, cmp = a["def_targets"], a["def_completions_allowed"]
            row = entry(g, grp)
            row["t"] = p.get("t") or a.get("t")
            row["x"] = [int(tgt), rate(cmp, tgt), round(a["def_yards_allowed"] / tgt, 2), int(a["def_receiving_td_allowed"]), int(a["def_ints"]),
                        passer_rating(cmp, tgt, a["def_yards_allowed"], a["def_receiving_td_allowed"], a["def_ints"]),
                        round(a["def_air_yards_completed"] / cmp, 1) if cmp else None, mt]
            pools["cov"].append((g, row))

    for key, lst in pools.items():
        if not lst and prev.get(key):
            out[key] = prev[key]
            continue
        groups = defaultdict(list)
        for g, row in lst:
            groups[row["pos"] if key in ("rec", "rush", "cov") else key].append(row)
        for grp in groups.values():
            for i, (name, d) in enumerate(COLS[key]):
                if not d:
                    continue
                ranks = pct_ranks(grp, i, d)
                for row in grp:
                    if id(row) in ranks:
                        row.setdefault("pct", {})[name] = ranks[id(row)]
        out[key] = {g: row for g, row in lst}
        print(f"{key}: {len(lst)} qualified")

    # ---------- team style ----------
    T = defaultdict(lambda: defaultdict(float))
    for p in pbp:
        if not p["posteam"] or not p["defteam"] or p["qb_kneel"] or p["qb_spike"]:
            continue
        o, d = T[team(p["posteam"])], T[team(p["defteam"])]
        snap = p["qb_dropback"] or p["rush_attempt"]
        if not snap:
            continue
        o["plays"] += 1; o["gun"] += 1 if p["shotgun"] else 0
        if p["qb_dropback"]:
            o["db"] += 1; d["opp_db"] += 1
        neutral = p["down"] in (1, 2) and p["wp"] is not None and 0.2 <= p["wp"] <= 0.8 and (p["half_seconds_remaining"] or 0) > 120
        if neutral and p["pass_oe"] is not None:
            o["oe_n"] += 1; o["oe"] += p["pass_oe"]
        fx = ftn.get((p["game_id"], int(p["play_id"] or 0)))
        if not fx:
            continue
        box = f(fx["n_defense_box"]) or 0
        o["f"] += 1; o["motion"] += tf(fx["is_motion"]); o["rpo"] += tf(fx["is_rpo"]); o["nohud"] += tf(fx["is_no_huddle"])
        if box:
            o["box_n"] += 1; o["box"] += box; d["dbox_n"] += 1; d["dbox"] += box
        if p["qb_dropback"]:
            o["f_db"] += 1; o["pa"] += tf(fx["is_play_action"])
            d["f_odb"] += 1; d["blitz"] += (f(fx["n_blitzers"]) or 0) > 0; d["rushers"] += f(fx["n_pass_rushers"]) or 0
        if p["pass_attempt"] and not p["sack"]:
            o["f_att"] += 1; o["screen"] += tf(fx["is_screen_pass"])
    dprs = defaultdict(float)
    for g, a in (pd or {}).items():
        if a.get("t"):
            dprs[a["t"]] += a["def_pressures"]
    teams = {}
    for t, o in T.items():
        if not o["plays"]:
            continue
        teams[t] = [round(o["oe"] / o["oe_n"], 1) if o["oe_n"] else None, rate(o["motion"], o["f"]), rate(o["pa"], o["f_db"]),
                    rate(o["rpo"], o["f"]), rate(o["screen"], o["f_att"]), rate(o["nohud"], o["f"]), rate(o["gun"], o["plays"]),
                    round(o["box"] / o["box_n"], 2) if o["box_n"] else None, rate(o["blitz"], o["f_odb"]),
                    round(o["rushers"] / o["f_odb"], 2) if o["f_odb"] else None, round(o["dbox"] / o["dbox_n"], 2) if o["dbox_n"] else None,
                    rate(dprs.get(t, 0), o["opp_db"]) if pd else None]
    rank = {}
    for i, c in enumerate(TCOLS):
        vals = sorted((v[i] for v in teams.values() if v[i] is not None), reverse=True)
        rank[c] = {t: vals.index(v[i]) + 1 for t, v in teams.items() if v[i] is not None}
    out["teams"] = teams or prev.get("teams", {})
    out["trank"] = {t: [rank[c].get(t) for c in TCOLS] for t in teams} if teams else prev.get("trank", {})
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUT} (season {SEASON}, through week {out['week']}; {len(teams)} teams)")


if __name__ == "__main__":
    main()
