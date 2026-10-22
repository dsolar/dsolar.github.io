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


def main():
    years = [int(a) for a in sys.argv[1:]] or [2023, 2024, 2025]
    passes = defaultdict(lambda: [0, 0])        # (concept, dg, group) -> [successes, n]
    pass_all = defaultdict(lambda: [0, 0])      # (concept, dg)
    dropback = defaultdict(lambda: [0, 0])      # (dg, group): every called pass, sacks, throwaways and scrambles included
    targeted = defaultdict(lambda: [0, 0])      # (dg, group): passes that went to a charted route
    dbox = defaultdict(lambda: [0, 0])          # (dg, box bucket): called passes by box count
    pabox = defaultdict(lambda: [0, 0])         # (play action?, box bucket): early-down called passes
    runs = defaultdict(lambda: [0, 0])          # (concept, rg, adv)
    run_all = defaultdict(lambda: [0, 0])       # (concept, rg)
    rush = defaultdict(Counter)                 # rushers -> n, pressure, sack
    prior = defaultdict(Counter)                # (pkg, box, situation) -> coverage group counts
    offense = defaultdict(Counter)              # (situation, personnel) -> call counts
    allowed = defaultdict(lambda: [0, 0])       # (personnel, pkg, kind, situation group) -> [successes, n]
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
            ok = (r["touchdown"] == "1" or yards >= need_yards(down, dist, yl)) and r["interception"] != "1" and r.get("fumble_lost") != "1"
            sit = situation(down, dist, yl, int(num(r["qtr"], 1)), int(num(r["quarter_seconds_remaining"], 900)))
            pers = f"{count(o, {'RB', 'FB'})}{count(o, {'TE'})}"
            pkg = package(dp)
            box = int(num(p["defenders_in_box"], 0))
            cov = GROUP.get(p["defense_coverage_type"])
            total += 1
            sit_group = sit or ("early" if down <= 2 else "late")
            allowed[(pers, pkg, kind, sit_group)][0] += ok
            allowed[(pers, pkg, kind, sit_group)][1] += 1
            if kind == "run":
                if r["qb_scramble"] == "1":
                    if cov:  # a called pass that became a scramble
                        dg = down_group(down, dist, yl)
                        dropback[(dg, cov)][0] += ok
                        dropback[(dg, cov)][1] += 1
                    continue
                qb_ids = {x for x, pos in zip((p["offense_players"] or "").split(";"), (p["offense_positions"] or "").split(";")) if pos == "QB"}
                c = "sneak" if r["rusher_player_id"] in qb_ids and dist <= 1 else "outside-zone" if r["run_gap"] == "end" else "inside-zone"
                if not box:
                    continue
                blockers = 5 + max(0, count(o, {"C", "G", "T", "OL", "OG", "OT"}) - 5) + min(2, count(o, {"TE"})) + count(o, {"FB"})
                adv = max(-3, min(2, blockers - box))
                rg = run_group(down, dist)
                for k in ((c, rg, adv),):
                    runs[k][0] += ok
                    runs[k][1] += 1
                run_all[(c, rg)][0] += ok
                run_all[(c, rg)][1] += 1
                if sit:
                    offense[(sit, pers)]["run"] += 1
                continue
            if r["qb_scramble"] == "1" or not cov:
                continue
            dg = down_group(down, dist, yl)
            dropback[(dg, cov)][0] += ok
            dropback[(dg, cov)][1] += 1
            if box:
                dbox[(dg, box_bucket(box))][0] += ok
                dbox[(dg, box_bucket(box))][1] += 1
                if dg == "early":
                    pa = f["is_play_action"] == "TRUE"
                    pabox[(pa, box_bucket(box))][0] += ok
                    pabox[(pa, box_bucket(box))][1] += 1
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
            targeted[(dg, cov)][0] += ok
            targeted[(dg, cov)][1] += 1
            passes[(c, dg, cov)][0] += ok
            passes[(c, dg, cov)][1] += 1
            pass_all[(c, dg)][0] += ok
            pass_all[(c, dg)][1] += 1
        print(f"{year}: {total} snaps so far")

    def shrink(s, n, base):  # noqa: E306
        return round((s + K * base) / (n + K), 3)

    model = {"pass": {}, "run": {}, "rush": {}, "prior": {}, "offense": {}, "allowed": {}, "dropback": {}, "targeted": {}}
    # Targeted passes are the baseline each concept is compared with; a thin concept cell shrinks toward it.
    tg_dg = defaultdict(lambda: [0, 0])
    for (dg, g), (s, n) in targeted.items():
        tg_dg[dg][0] += s
        tg_dg[dg][1] += n
    for (dg, g), (s, n) in targeted.items():
        model["targeted"].setdefault(dg, {})[g] = [shrink(s, n, tg_dg[dg][0] / tg_dg[dg][1]), n]
    db_dg = defaultdict(lambda: [0, 0])
    for (dg, g), (s, n) in dropback.items():
        db_dg[dg][0] += s
        db_dg[dg][1] += n
    for (dg, g), (s, n) in dropback.items():
        model["dropback"].setdefault(dg, {})[g] = [shrink(s, n, db_dg[dg][0] / db_dg[dg][1]), n]
    model["box"] = {}
    for (dg, bx), (s, n) in dbox.items():
        model["box"].setdefault(dg, {})[bx] = [shrink(s, n, db_dg[dg][0] / db_dg[dg][1]), n]
    model["paBox"] = {}
    for (pa, bx), (s, n) in pabox.items():
        model["paBox"].setdefault("pa" if pa else "dropback", {})[bx] = [round(s / n, 3), n]
    for (c, dg), (s, n) in pass_all.items():
        base = shrink(s, n, tg_dg[dg][0] / tg_dg[dg][1])
        model["pass"].setdefault(c, {})[dg] = {"all": [base, n]}
    for (c, dg, g), (s, n) in passes.items():
        base = model["pass"][c][dg]["all"][0]
        model["pass"][c][dg][g] = [shrink(s, n, base), n]
    for (c, rg), (s, n) in run_all.items():
        model["run"].setdefault(c, {})[rg] = {"all": [round(s / n, 3), n]}
    for (c, rg, adv), (s, n) in runs.items():
        base = model["run"][c][rg]["all"][0]
        model["run"][c][rg][str(adv)] = [shrink(s, n, base), n]
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
    for (pers, pkg, kind, sg), (s, n) in allowed.items():
        if n >= 20:
            model["allowed"][f"{pers}|{pkg}|{kind}|{sg}"] = [round(s / n, 3), n]
    data = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "seasons": years, "snaps": total, "k": K,
        "rule": "Success: 40% of the distance on 1st down, 60% on 2nd, all of it on 3rd and 4th, or a touchdown. Interceptions and lost fumbles fail.",
        "source": "nflverse play-by-play and participation (CC-BY 4.0); FTN Data charting via nflverse (CC-BY-SA 4.0)",
        **model,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("/* Sunday Strategist's grading tables, fitted to real NFL snaps by tools/strategist_model.py. Don't edit by hand.\n"
                 "   Each cell is [success rate, snaps]; rates are shrunk toward the concept's overall rate when snaps are few. */\n")
        fh.write("(function (root, data) {\n  if (typeof module === \"object\" && module.exports) module.exports = data;\n"
                 "  else root.SS_MODEL = data;\n})(this, ")
        json.dump(data, fh, separators=(",", ":"))
        fh.write(");\n")
    print(f"Wrote {OUT}: {total} snaps, {sum(v[1] for v in pass_all.values())} graded passes, {sum(v[1] for v in run_all.values())} graded runs")


if __name__ == "__main__":
    main()
