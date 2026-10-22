#!/usr/bin/env python3
"""Fit Sunday Strategist's grading tables to real NFL data and write sunday-strategist/model.js.

The film room grades every option by how often that kind of call actually succeeds. This script
measures it from every eligible snap in nflverse's free data (2023 to 2025 by default):

  pass     success rate by concept x coverage x down group. The concept comes from the charted
           target route and flags (slant/quick out/short hitch = quick, corner = smash, drag = mesh,
           dig = dagger, go/post = verticals, or a play-action shot, or a red-zone fade; screens by flag)
  run      success rate by run concept x down group x (run blockers - defenders in the box)
  rush     pressure and sack rate by number of pass rushers
  prior    which coverage a defense plays from a package, box count and situation
  offense  what offenses call by situation and personnel (for the defensive coordinator side)
  allowed  success rate allowed by each defensive package against each offensive personnel group

A success is the game's rule: 40% of the distance on 1st down, 60% on 2nd, all of it on 3rd and 4th,
or a touchdown. Thin cells are shrunk toward the concept's overall rate (k = 40 snaps), so one odd
season can't swing a grade.

  python tools/strategist_model.py              2023 to 2025 (downloads cached like strategist_real.py)
  python tools/strategist_model.py 2024 2025

Standard library only. Data: nflverse (CC-BY 4.0), FTN Data via nflverse (CC-BY-SA 4.0).
"""
import json
import math
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from strategist_real import count, num, package, rows, situation  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "sunday-strategist", "model.js")
K = 40
GROUP = {"COVER_0": "zero", "COVER_1": "man", "2_MAN": "twoMan", "COVER_2": "two", "COVER_3": "three", "COVER_9": "three",
         "COVER_4": "quarters", "COVER_6": "quarters", "COMBO": "quarters"}


def need_yards(down, dist, yl):
    if yl <= dist:
        return dist
    return math.ceil(dist * 0.4) if down == 1 else math.ceil(dist * 0.6) if down == 2 else dist


def down_group(down, dist, yl):
    """The pass tables' down groups."""
    if yl <= 20:
        return "red"
    if down <= 2:
        return "early"
    return "short" if dist <= 2 else "medium" if dist <= 6 else "long"


def run_group(down, dist):
    return "short" if dist <= 2 else "long" if down >= 2 and dist >= 7 else "standard"


def box_bucket(box):
    return "5" if box <= 5 else "8" if box >= 8 else str(box)


def concept(r, p, f, air):
    if f["is_screen_pass"] == "TRUE":
        return "screen"
    route = (p.get("route") or "").upper()
    if route in ("SLANT", "QUICK OUT") or (route == "HITCH/CURL" and air is not None and air <= 9):
        return "quick"
    if route == "HITCH/CURL":
        return "dagger"
    if route in ("CORNER", "DEEP OUT"):
        return "smash"
    if route == "SHALLOW CROSS/DRAG":
        return "mesh"
    if route == "IN/DIG":
        return "dagger"
    if route in ("GO", "POST", "WHEEL"):
        yl = int(num(r["yardline_100"], 50))
        if route == "GO" and yl <= 20:
            return "fade"
        return "pa-shot" if f["is_play_action"] == "TRUE" else "verts"
    return None


def add(cell, ok, epa):
    cell[0] += ok
    cell[1] += 1
    cell[2] += epa


def main():
    years = [int(a) for a in sys.argv[1:]] or [2023, 2024, 2025]
    passes = defaultdict(lambda: [0, 0, 0.0])        # (concept, dg, group) -> [successes, n]
    pass_all = defaultdict(lambda: [0, 0, 0.0])      # (concept, dg)
    dropback = defaultdict(lambda: [0, 0, 0.0])      # (dg, group): every called pass, sacks, throwaways and scrambles included
    targeted = defaultdict(lambda: [0, 0, 0.0])      # (dg, group): passes that went to a charted route
    dbox = defaultdict(lambda: [0, 0, 0.0])          # (dg, box bucket): called passes by box count
    covrush = defaultdict(lambda: [0, 0, 0.0])  # (dg, group, rushers 4/5/6+): called passes
    pabox = defaultdict(lambda: [0, 0, 0.0])         # (play action?, box bucket): early-down called passes
    runs = defaultdict(lambda: [0, 0, 0.0])          # (concept, rg, adv)
    run_all = defaultdict(lambda: [0, 0, 0.0])       # (concept, rg)
    rush = defaultdict(Counter)                 # rushers -> n, pressure, sack
    prior = defaultdict(Counter)                # (pkg, box, situation) -> coverage group counts
    offense = defaultdict(Counter)              # (situation, personnel) -> call counts
    allowed = defaultdict(lambda: [0, 0, 0.0])       # (personnel, pkg, kind, situation group) -> [successes, n]
    total = 0
    for year in years:
        part = {(r["nflverse_game_id"], r["play_id"]): r for r in rows(f"pbp_participation/pbp_participation_{year}.csv")}
        ftn = {(r["nflverse_game_id"], r["nflverse_play_id"]): r for r in rows(f"ftn_charting/ftn_charting_{year}.csv")}
        for r in rows(f"pbp/play_by_play_{year}.csv.gz"):
            key = (r["game_id"], r["play_id"].split(".")[0])
            p, f = part.get(key), ftn.get(key)
            kind = r["play_type"]
            if not p or not f or kind not in ("pass", "run") or not r["down"]:
                continue
            if r["penalty"] == "1" or r["two_point_attempt"] == "1" or r.get("qb_kneel") == "1" or r.get("qb_spike") == "1" or f["is_trick_play"] == "TRUE":
                continue
            o, dp = p["offense_personnel"], p["defense_personnel"]
            if count(o, {"K", "P", "LS"}) or count(dp, {"K", "P", "LS"}) or count(o, {"QB"}) != 1:
                continue
            wp = num(r["wp"], 0.5)
            if not 0.05 <= wp <= 0.95:
                continue
            down, dist, yl = int(num(r["down"])), int(num(r["ydstogo"])), int(num(r["yardline_100"]))
            yards = int(num(r["yards_gained"], 0))
            epa = num(r["epa"], 0.0) or 0.0
            ok = (r["touchdown"] == "1" or yards >= need_yards(down, dist, yl)) and r["interception"] != "1" and r.get("fumble_lost") != "1"
            sit = situation(down, dist, yl, int(num(r["qtr"], 1)), int(num(r["quarter_seconds_remaining"], 900)))
            pers = f"{count(o, {'RB', 'FB'})}{count(o, {'TE'})}"
            pkg = package(dp)
            box = int(num(p["defenders_in_box"], 0))
            cov = GROUP.get(p["defense_coverage_type"])
            total += 1
            sit_group = sit or ("early" if down <= 2 else "late")
            add(allowed[(pers, pkg, kind, sit_group)], ok, epa)
            if kind == "run":
                if r["qb_scramble"] == "1":
                    if cov:  # a called pass that became a scramble
                        dg = down_group(down, dist, yl)
                        add(dropback[(dg, cov)], ok, epa)
                    continue
                qb_ids = {x for x, pos in zip((p["offense_players"] or "").split(";"), (p["offense_positions"] or "").split(";")) if pos == "QB"}
                c = "sneak" if r["rusher_player_id"] in qb_ids and dist <= 1 else "outside-zone" if r["run_gap"] == "end" else "inside-zone"
                if not box:
                    continue
                blockers = 5 + max(0, count(o, {"C", "G", "T", "OL", "OG", "OT"}) - 5) + min(2, count(o, {"TE"})) + count(o, {"FB"})
                adv = max(-3, min(2, blockers - box))
                rg = run_group(down, dist)
                add(runs[(c, rg, adv)], ok, epa)
                add(run_all[(c, rg)], ok, epa)
                if sit:
                    offense[(sit, pers)]["run"] += 1
                continue
            if r["qb_scramble"] == "1" or not cov:
                continue
            dg = down_group(down, dist, yl)
            add(dropback[(dg, cov)], ok, epa)
            rn = int(num(p["number_of_pass_rushers"], 0))
            if rn:
                add(covrush[(dg, cov, "4" if rn <= 4 else "5" if rn == 5 else "6")], ok, epa)
            if box:
                add(dbox[(dg, box_bucket(box))], ok, epa)
                if dg == "early":
                    pa = f["is_play_action"] == "TRUE"
                    add(pabox[(pa, box_bucket(box))], ok, epa)
            rushers = int(num(p["number_of_pass_rushers"], 0))
            if rushers:
                t = rush[min(max(rushers, 3), 7)]
                t["n"] += 1
                t["pressure"] += p["was_pressure"] == "TRUE"
                t["sack"] += r["sack"] == "1"
            if sit and box:
                prior[(pkg, box_bucket(box), sit)][cov] += 1
            air = num(r["air_yards"]) if r["air_yards"] else None
            c = concept(r, p, f, air)
            if sit:
                offense[(sit, pers)][c or "other"] += 1
            if not c or r["sack"] == "1":
                continue
            add(targeted[(dg, cov)], ok, epa)
            add(passes[(c, dg, cov)], ok, epa)
            add(pass_all[(c, dg)], ok, epa)
        print(f"{year}: {total} snaps so far")

    def shrink(s, n, base):  # noqa: E306
        return round((s + K * base) / (n + K), 3)

    def cell(acc, base_rate, base_epa):
        """[success rate, snaps, EPA per play], both shrunk toward the base when snaps are few."""
        s, n, e = acc
        return [shrink(s, n, base_rate), n, round((e + K * base_epa) / (n + K), 3)]

    def pooled(items):
        t = defaultdict(lambda: [0, 0, 0.0])
        for k, v in items:
            for i in range(3):
                t[k][i] += v[i]
        return {k: (v[0] / v[1], v[2] / v[1]) for k, v in t.items() if v[1]}

    model = {"pass": {}, "run": {}, "rush": {}, "prior": {}, "offense": {}, "allowed": {}, "dropback": {}, "targeted": {}, "covRush": {}, "box": {}, "paBox": {}}
    # Targeted passes are the baseline each concept is compared with; a thin concept cell shrinks toward it.
    tg = pooled(((dg, v) for (dg, g), v in targeted.items()))
    for (dg, g), v in targeted.items():
        model["targeted"].setdefault(dg, {})[g] = cell(v, *tg[dg])
    db = pooled(((dg, v) for (dg, g), v in dropback.items()))
    for (dg, g), v in dropback.items():
        model["dropback"].setdefault(dg, {})[g] = cell(v, *db[dg])
    for (dg, g, rn), v in covrush.items():
        base = model["dropback"][dg][g]
        model["covRush"].setdefault(dg, {}).setdefault(g, {})[rn] = cell(v, base[0], base[2])
    for (dg, bx), v in dbox.items():
        model["box"].setdefault(dg, {})[bx] = cell(v, *db[dg])
    for (pa, bx), v in pabox.items():
        model["paBox"].setdefault("pa" if pa else "dropback", {})[bx] = cell(v, *db["early"])
    for (c, dg), v in pass_all.items():
        model["pass"].setdefault(c, {})[dg] = {"all": cell(v, *tg[dg])}
    for (c, dg, g), v in passes.items():
        base = model["pass"][c][dg]["all"]
        model["pass"][c][dg][g] = cell(v, base[0], base[2])
    ra = pooled((((rg), v) for (c, rg), v in run_all.items()))
    for (c, rg), v in run_all.items():
        model["run"].setdefault(c, {})[rg] = {"all": cell(v, *ra[rg])}
    for (c, rg, adv), v in runs.items():
        base = model["run"][c][rg]["all"]
        model["run"][c][rg][str(adv)] = cell(v, base[0], base[2])
    for k, t in sorted(rush.items()):
        model["rush"][str(k)] = {"n": t["n"], "pressure": round(t["pressure"] / t["n"], 3), "sack": round(t["sack"] / t["n"], 3)}
    for (pkg, bx, sit), c in prior.items():
        n = sum(c.values())
        if n >= 15:
            model["prior"][f"{pkg}|{bx}|{sit}"] = dict({g: round(v / n, 3) for g, v in c.items()}, n=n)
    for (sit, pers), c in offense.items():
        n = sum(c.values())
        if n >= 20:
            model["offense"][f"{sit}|{pers}"] = dict({g: round(v / n, 3) for g, v in c.items()}, n=n)
    for (pers, pkg, kind, sg), (s, n, e) in allowed.items():
        if n >= 20:
            model["allowed"][f"{pers}|{pkg}|{kind}|{sg}"] = [round(s / n, 3), n, round(e / n, 3)]
    data = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "seasons": years, "snaps": total, "k": K,
        "rule": "Success: 40% of the distance on 1st down, 60% on 2nd, all of it on 3rd and 4th, or a touchdown. Interceptions and lost fumbles fail.",
        "source": "nflverse play-by-play and participation (CC-BY 4.0); FTN Data charting via nflverse (CC-BY-SA 4.0)",
        **model,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("/* Sunday Strategist's grading tables, fitted to real NFL snaps by tools/strategist_model.py. Don't edit by hand.\n"
                 "   Each cell is [success rate, snaps, EPA per play]; rates are shrunk toward the concept's overall rate when snaps are few. */\n")
        fh.write("(function (root, data) {\n  if (typeof module === \"object\" && module.exports) module.exports = data;\n"
                 "  else root.SS_MODEL = data;\n})(this, ")
        json.dump(data, fh, separators=(",", ":"))
        fh.write(");\n")
    print(f"Wrote {OUT}: {total} snaps, {sum(v[1] for v in pass_all.values())} graded passes, {sum(v[1] for v in run_all.values())} graded runs")


if __name__ == "__main__":
    main()
