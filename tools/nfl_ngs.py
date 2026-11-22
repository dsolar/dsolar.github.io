#!/usr/bin/env python3
"""NFL Next Gen Stats for the NFL Hub, from nflverse's republished copies (github.com/nflverse/nflverse-data).

Writes nfl/data/ngs.json with each qualified player's season line for the hub's season (week 0 = NGS's own season
totals, which only list qualified players), keyed by the same GSIS id the hub uses:

  {season, week, pulled, qb: {id: {...}}, rb: {...}, rec: {...}}

Each player carries n (name), pos, t (team), e (ESPN id, for pages keyed that way: the fantasy pools), x (the numbers, by the COLS order below) and pct (percentile ranks
within his position, 0-100, flipped where lower is better, left out where neither direction is "good").
If a download fails, the last good file's part is kept.
"""
import csv, gzip, io, json, os, sys, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "nfl", "data", "ngs.json")
URL = "https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_{}.csv.gz"

# (key in ngs.json, nflverse file, columns kept: (csv column, short name, percentile direction: 1 higher is better,
#  -1 lower is better, 0 no percentile))
PARTS = [
    ("qb", "passing", [
        ("attempts", "att", 0), ("pass_yards", "yds", 0), ("pass_touchdowns", "td", 0), ("interceptions", "int", 0),
        ("passer_rating", "rate", 1), ("completion_percentage", "cmp", 1), ("expected_completion_percentage", "xcmp", 0),
        ("completion_percentage_above_expectation", "cpoe", 1), ("avg_time_to_throw", "ttt", 0),
        ("avg_intended_air_yards", "iay", 0), ("avg_completed_air_yards", "cay", 1), ("avg_air_yards_differential", "ayd", 1),
        ("avg_air_yards_to_sticks", "sticks", 1), ("aggressiveness", "aggr", 0), ("max_completed_air_distance", "long", 0),
    ]),
    ("rb", "rushing", [
        ("rush_attempts", "att", 0), ("rush_yards", "yds", 0), ("avg_rush_yards", "ypc", 1), ("rush_touchdowns", "td", 0),
        ("expected_rush_yards", "xyds", 0), ("rush_yards_over_expected", "ryoe", 1),
        ("rush_yards_over_expected_per_att", "ryoe_att", 1), ("rush_pct_over_expected", "beat", 1),
        ("efficiency", "eff", -1), ("percent_attempts_gte_eight_defenders", "box8", 0), ("avg_time_to_los", "tlos", 0),
    ]),
    ("rec", "receiving", [
        ("targets", "tgt", 0), ("receptions", "rec", 0), ("yards", "yds", 0), ("rec_touchdowns", "td", 0),
        ("catch_percentage", "catch", 1), ("avg_separation", "sep", 1), ("avg_cushion", "cush", 0),
        ("avg_intended_air_yards", "iay", 0), ("percent_share_of_intended_air_yards", "share", 1),
        ("avg_yac", "yac", 1), ("avg_expected_yac", "xyac", 0), ("avg_yac_above_expectation", "yacoe", 1),
    ]),
]
COLS = {key: [c[1] for c in cols] for key, _, cols in PARTS}


def num(v):
    try:
        f = float(v)
        return round(f, 3) if f == f else None
    except (TypeError, ValueError):
        return None


def pctify(col, v):
    """NGS gives one share as a fraction where the rest are percents: put it on the same footing."""
    return round(v * 100, 1) if v is not None and col == "rush_pct_over_expected" else v


def pct_ranks(players, idx, direction):
    """Percentile rank 0-100 of each player's value at idx among players of the same pool."""
    vals = sorted(p["x"][idx] for p in players if p["x"][idx] is not None)
    n = len(vals)
    out = {}
    for p in players:
        v = p["x"][idx]
        if v is None or n < 2:
            continue
        below = sum(1 for w in vals if w < v)
        equal = sum(1 for w in vals if w == v)
        r = (below + (equal - 1) / 2) / (n - 1)
        out[id(p)] = round(100 * (r if direction > 0 else 1 - r))
    return out


def main():
    league = json.load(open(os.path.join(ROOT, "nfl", "data", "league.json")))
    season = int(league["season"])
    espn = {p["id"]: p.get("espn") for p in league.get("players", []) if p.get("espn")}
    try:
        prev = json.load(open(OUT))
    except Exception:
        prev = {}
    out = {"season": season, "week": None, "pulled": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "cols": COLS, "failed": []}
    for key, name, cols in PARTS:
        try:
            raw = urllib.request.urlopen(URL.format(name), timeout=60).read()
            rows = list(csv.DictReader(io.TextIOWrapper(gzip.GzipFile(fileobj=io.BytesIO(raw)), encoding="utf-8")))
        except Exception as e:
            print(f"{name}: {e}", file=sys.stderr)
            out["failed"].append(name)
            out[key] = prev.get(key, {}) if prev.get("season") == season else {}
            continue
        this = [r for r in rows if r.get("season") == str(season) and r.get("season_type") == "REG"]
        weeks = [int(r["week"]) for r in this if r.get("week", "").isdigit() and int(r["week"]) > 0]
        if weeks:
            out["week"] = max(out["week"] or 0, max(weeks))
        players = []
        for r in this:
            if r.get("week") != "0" or not r.get("player_gsis_id"):
                continue
            players.append({"id": r["player_gsis_id"], "n": r.get("player_display_name"), "pos": r.get("player_position"), "t": r.get("team_abbr"),
                            "e": espn.get(r["player_gsis_id"]), "x": [pctify(c[0], num(r.get(c[0]))) for c in cols]})
        # percentiles within position (receivers: wide receivers and tight ends ranked apart)
        pools = {}
        for p in players:
            pools.setdefault(p["pos"] if key == "rec" else key, []).append(p)
        for pool in pools.values():
            for i, c in enumerate(cols):
                if not c[2]:
                    continue
                ranks = pct_ranks(pool, i, c[2])
                for p in pool:
                    if id(p) in ranks:
                        p.setdefault("pct", {})[c[1]] = ranks[id(p)]
        out[key] = {p.pop("id"): p for p in players}
        print(f"{name}: {len(players)} qualified players")
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {OUT} (season {season}, through week {out['week']})")


if __name__ == "__main__":
    main()
