#!/usr/bin/env python3
"""The NFL Hub's league file: rosters, contracts year by year, depth charts and snap shares, into nfl/data/league.json.

Everything comes from nflverse's public data releases on GitHub (https://github.com/nflverse/nflverse-data):
  contracts      Over The Cap's contract data (historical_contracts.parquet), each player's cap numbers by season:
                 base salary, prorated signing bonus, option bonus, roster and other bonuses, guaranteed salary
  rosters        this season's weekly rosters (status, team, ages, IDs, draft info)
  depth_charts   ESPN's depth charts, many snapshots a day; the newest per team is kept
  snap_counts    Pro Football Reference's snap counts by game, summed to season shares
Team-level cap figures (carryover, dead money) aren't in those feeds; they live in nfl/data/teamcap.json, copied
from Over The Cap's cap space page.

Usage: python3 tools/nfl_pull.py [season] [--cache DIR]   (a cache dir of already-downloaded files is for testing)
Needs pyarrow for the contracts file (pip install pyarrow).
"""

import csv
import io
import json
import sys
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "nfl" / "data" / "league.json"
BASE = "https://github.com/nflverse/nflverse-data/releases/download/"
UA = "davidsolar-nflhub/1.0 (+https://davidsolar.dev/nfl/)"

args = [a for a in sys.argv[1:] if not a.startswith("--")]
SEASON = int(args[0]) if args else 2026
CACHE = None
if "--cache" in sys.argv:
    CACHE = Path(sys.argv[sys.argv.index("--cache") + 1])
    args = [a for a in args if a != str(CACHE)]
    SEASON = int(args[0]) if args else 2026

TEAMS = json.loads((ROOT / "tools" / "draft_teams.json").read_text(encoding="utf-8"))["nfl"]
NICK = {v["name"]: k for k, v in TEAMS.items()}           # "Chiefs" -> "KC"
FIX = {"LA": "LAR", "WSH": "WAS", "JAC": "JAX", "OAK": "LV", "SD": "LAC", "STL": "LAR"}


def fetch(path, binary=False):
    name = path.split("/")[-1]
    if CACHE and (CACHE / name).exists():
        b = (CACHE / name).read_bytes()
    else:
        req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=180) as r:
            b = r.read()
    return b if binary else b.decode("utf-8")


def nkey(name):
    import unicodedata
    n = unicodedata.normalize("NFD", name or "").encode("ascii", "ignore").decode().lower()
    n = "".join(ch if ch.isalnum() or ch == " " else " " for ch in n).split()
    return " ".join(w for w in n if w not in ("jr", "sr", "ii", "iii", "iv", "v"))


def team(code):
    code = (code or "").strip()
    return FIX.get(code, code)


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def age_on(birth, when):
    try:
        b = datetime.strptime(birth[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None
    return round((when - b).days / 365.25, 1)


def main():
    today = date.today()
    # ---------- rosters: each player's newest row ----------
    ros = list(csv.DictReader(io.StringIO(fetch(f"rosters/roster_{SEASON}.csv"))))
    last = {}
    for r in ros:
        k = r["gsis_id"]
        if k and (k not in last or int(r["week"] or 0) >= int(last[k]["week"] or 0)):
            last[k] = r
    week = max(int(r["week"] or 0) for r in ros)

    # ---------- snap counts: season shares ----------
    snaps = defaultdict(lambda: [0, 0, 0, 0])          # pfr id -> off, def, st, games
    snaps_by_name = {}                                  # (name, team) -> pfr id, for rosters missing the PFR id
    team_g = defaultdict(lambda: [0, 0, 0])            # team -> off, def, st snaps (max per game summed)
    per_game = defaultdict(lambda: [0, 0, 0])
    try:
        for r in csv.DictReader(io.StringIO(fetch(f"snap_counts/snap_counts_{SEASON}.csv"))):
            if r["game_type"] != "REG":
                continue
            snaps_by_name[(nkey(r["player"]), team(r["team"]))] = r["pfr_player_id"]
            s = snaps[r["pfr_player_id"]]
            o, d, t = num(r["offense_snaps"]), num(r["defense_snaps"]), num(r["st_snaps"])
            s[0] += o; s[1] += d; s[2] += t; s[3] += 1
            g = per_game[(r["game_id"], team(r["team"]))]
            g[0] = max(g[0], o / max(num(r["offense_pct"]), 0.01) if num(r["offense_pct"]) else 0)
            g[1] = max(g[1], d / max(num(r["defense_pct"]), 0.01) if num(r["defense_pct"]) else 0)
            g[2] = max(g[2], t / max(num(r["st_pct"]), 0.01) if num(r["st_pct"]) else 0)
        for (gid, tm), g in per_game.items():
            for i in range(3):
                team_g[tm][i] += g[i]
    except Exception as e:  # snap counts lag a few days in season; the rest still builds
        print("snap counts unavailable:", e)

    # ---------- depth charts: the newest snapshot per team ----------
    depth = {}
    try:
        newest = {}
        rows = list(csv.DictReader(io.StringIO(fetch(f"depth_charts/depth_charts_{SEASON}.csv"))))
        for r in rows:
            t = team(r["team"])
            if r["dt"] > newest.get(t, ""):
                newest[t] = r["dt"]
        for r in rows:
            t = team(r["team"])
            if r["dt"] != newest[t]:
                continue
            depth.setdefault(t, []).append([r["pos_grp"], r["pos_abb"], int(r["pos_rank"] or 9), r["gsis_id"], r["player_name"], int(r["pos_slot"] or 0)])
        depth = {t: {"dt": newest[t][:10], "rows": v} for t, v in depth.items()}
    except Exception as e:
        print("depth charts unavailable:", e)

    # ---------- contracts ----------
    import pyarrow.parquet as pq  # noqa: E402  (only the contracts file needs it)
    tbl = pq.read_table(io.BytesIO(fetch("contracts/historical_contracts.parquet", binary=True)))
    contracts = defaultdict(list)
    for c in tbl.to_pylist():
        if c.get("gsis_id"):
            contracts[c["gsis_id"]].append(c)

    def contract_for(gid, tm):
        cs = sorted(contracts.get(gid, []), key=lambda c: (bool(c["is_active"]), c["year_signed"] or 0))
        return cs[-1] if cs else None

    def rows_of(c, tm):
        """Season rows from SEASON on: [base, proration (signing + option bonus), roster bonus, other bonuses,
        guaranteed salary, cap number, void]. A year with a cap number made only of proration is a void year."""
        out = {}
        for s in c.get("season_history") or []:
            y = s.get("year") or ""
            if not y.isdigit() or int(y) < SEASON:
                continue
            cap = num(s.get("cap_number"))
            if cap <= 0 and num(s.get("prorated_bonus")) + num(s.get("option_bonus")) <= 0:
                continue                                   # base salary listed past the cap years: not real money
            pr = num(s.get("prorated_bonus")) + num(s.get("option_bonus"))
            base = num(s.get("base_salary"))
            other = num(s.get("workout_bonus")) + num(s.get("per_game_roster_bonus")) + num(s.get("other_bonus"))
            rb = num(s.get("roster_bonus"))
            # a void year: salary listed that never counts (the cap number is only bonus money, sometimes with a later
            # void year's share pulled into it)
            void = base > 0 and (abs(cap - pr) < 0.01 or base > cap + 0.01)
            if void:
                base, rb, other = 0.0, 0.0, 0.0
            out[y] = [round(base, 4), round(pr, 4), round(rb, 4), round(other, 4), round(num(s.get("guaranteed_salary")), 4), round(cap, 4), 1 if void else 0]
        return out

    def estimate_rows(c):
        """This year's signings often have no year-by-year rows yet. Spread the deal the usual way: the signing
        bonus (the guarantee, up to 60% of the deal) prorated evenly, the rest as base salary, guarantees front-loaded.
        Rows are flagged estimated (8th field)."""
        yrs, value, gtd = int(c["years"] or 1), float(c["value"] or 0), float(c["guaranteed"] or 0)
        bonus = min(gtd, value * 0.6)
        pr = bonus / yrs
        left_g = gtd - bonus
        out = {}
        for k in range(yrs):
            y = int(c["year_signed"]) + k
            if y < SEASON:
                continue
            base = max(value / yrs - pr, 0.84)
            g = min(base, left_g); left_g -= g
            out[str(y)] = [round(base, 4), round(pr, 4), 0.0, 0.0, round(g, 4), round(base + pr, 4), 0, 1]
        return out

    players = []
    for gid, r in last.items():
        if r["status"] not in ("ACT", "RES", "INA", "DEV", "EXE"):
            continue
        tm = team(r["team"])
        if tm not in TEAMS:
            continue
        c = contract_for(gid, tm)
        pid = r.get("pfr_id") or snaps_by_name.get((nkey(r["full_name"]), tm))
        sn = snaps.get(pid) if pid else None
        tg = team_g.get(tm)
        p = {
            "id": gid, "n": r["full_name"], "pos": r["position"], "dpos": r["depth_chart_position"], "t": tm,
            "st": r["status"], "age": age_on(r["birth_date"], today), "exp": int(r["years_exp"] or 0),
            "espn": r["espn_id"] or None, "pfr": r["pfr_id"] or None,
            "hs": (r.get("headshot_url") or "").rsplit("/", 1)[-1] or None,   # NFL.com headshot id (the image CDN's file name)
            "draft": [int(r["entry_year"] or 0), int(r["draft_number"] or 0), r["draft_club"] or None] if r.get("draft_number") else None,
        }
        if sn and tg:
            p["snaps"] = [round(sn[0] / tg[0], 3) if tg[0] else 0, round(sn[1] / tg[1], 3) if tg[1] else 0, round(sn[2] / tg[2], 3) if tg[2] else 0, sn[3]]
        if c:
            rws = rows_of(c, tm)
            if not rws.get(str(SEASON)) and (c["year_signed"] or 0) >= SEASON - 1 and (c["value"] or 0) > 0:
                rws = estimate_rows(c)
            p["c"] = {"signed": c["year_signed"], "yrs": c["years"], "value": c["value"], "apy": c["apy"], "gtd": c["guaranteed"],
                      "otcTeam": NICK.get(c["team"], c["team"]), "type": ((c.get("contract_history") or [{}])[-1] or {}).get("contract_type"),
                      "rows": rws, "otc": c.get("otc_id")}
        players.append(p)

    # ---------- this season's games: results, and the betting line where there is one ----------
    games = []
    try:
        for g in csv.DictReader(io.StringIO(fetch("schedules/games.csv"))):
            if g["season"] != str(SEASON):
                continue
            def n(x):
                return None if x in ("", "NA", None) else float(x)
            games.append([g["game_type"], int(g["week"]), g["gameday"], team(g["away_team"]), team(g["home_team"]),
                          n(g["away_score"]), n(g["home_score"]), n(g["spread_line"]), 1 if g["location"] == "Neutral" else 0, 1 if g["div_game"] == "1" else 0])
    except Exception as e:
        print("schedule unavailable:", e)

    # ---------- season stats (regular season) for the player rankings ----------
    STAT = ["games", "attempts", "completions", "passing_yards", "passing_tds", "passing_interceptions", "passing_epa", "sacks_suffered",
            "carries", "rushing_yards", "rushing_tds", "rushing_epa", "targets", "receptions", "receiving_yards", "receiving_tds", "receiving_epa",
            "def_tackles_solo", "def_tackle_assists", "def_tackles_for_loss", "def_sacks", "def_qb_hits", "def_interceptions", "def_pass_defended",
            "def_fumbles_forced", "fg_made", "fg_att", "fg_long", "pt_att", "pt_net_yards"]
    stats = {"cols": STAT, "p": {}}
    try:
        for r in csv.DictReader(io.StringIO(fetch(f"stats_player/stats_player_reg_{SEASON}.csv"))):
            v = [round(num(r.get(k)), 2) for k in STAT]
            if v[0] > 0:
                stats["p"][r["player_id"]] = v
    except Exception as e:
        print("player stats unavailable:", e)
    # the two seasons before, for the rating's production part (players on a roster now only)
    ids = {p["id"] for p in players}
    stats["prev"] = {}
    for back in (1, 2):
        yr = SEASON - back
        try:
            got = {}
            for r in csv.DictReader(io.StringIO(fetch(f"stats_player/stats_player_reg_{yr}.csv"))):
                if r["player_id"] not in ids:
                    continue
                v = [round(num(r.get(k)), 2) for k in STAT]
                if v[0] > 0:
                    got[r["player_id"]] = v
            stats["prev"][str(yr)] = got
        except Exception as e:
            print(f"{yr} player stats unavailable:", e)

    # ---------- game logs for the player cards (loaded only when a card opens) ----------
    WK = ["attempts", "completions", "passing_yards", "passing_tds", "passing_interceptions", "carries", "rushing_yards", "rushing_tds",
          "targets", "receptions", "receiving_yards", "receiving_tds", "def_tackles_solo", "def_tackle_assists", "def_sacks", "def_qb_hits",
          "def_interceptions", "def_pass_defended", "fg_made", "fg_att"]
    weeks = {"cols": ["week", "opp"] + WK, "p": {}}
    try:
        for r in csv.DictReader(io.StringIO(fetch(f"stats_player/stats_player_week_{SEASON}.csv"))):
            if r.get("season_type") != "REG":
                continue
            v = [int(num(r["week"])), team(r.get("opponent_team"))] + [round(num(r.get(k)), 1) for k in WK]
            if any(v[2:]):
                weeks["p"].setdefault(r["player_id"], []).append([x if x != 0 else 0 for x in v])
        (OUT.parent / "weeks.json").write_text(json.dumps(weeks, separators=(",", ":")) + "\n", encoding="utf-8")
    except Exception as e:
        print("game logs unavailable:", e)

    out = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "season": SEASON, "week": week,
        "src": "nflverse (Over The Cap contracts, NFL rosters, ESPN depth charts, Pro Football Reference snap counts)",
        "players": sorted(players, key=lambda p: (p["t"], p["pos"], p["n"])),
        "depth": depth,
        "games": games,
        "stats": stats,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    withc = sum(1 for p in players if p.get("c"))
    print(f"NFL {SEASON} week {week}: {len(players)} players ({withc} with contracts), depth charts for {len(depth)} teams, {len(games)} games, stats for {len(stats['p'])} (+{', '.join(f"{k}: {len(v)}" for k, v in stats.get('prev', {}).items())})")


if __name__ == "__main__":
    main()
