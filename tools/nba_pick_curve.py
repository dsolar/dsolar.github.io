#!/usr/bin/env python3
"""Builds nba/data/picks.json: what each NBA draft slot is worth, from what those slots actually produced.

Run from the site folder:  python3 tools/nba_pick_curve.py [--src DIR]
--src reuses CSVs already downloaded (Draft Pick History.csv, Advanced.csv); otherwise they're fetched.

Source: sumitrodatta/bball-reference-datasets (Basketball-Reference's draft history and season-by-season
advanced stats), https://github.com/sumitrodatta/bball-reference-datasets. Drafts 2001-2018, so every pick has had
at least eight seasons to play out.

Method, for every pick in those 18 drafts:
  1. Each of his first eight NBA seasons gets a rating: his Box Plus/Minus, shrunk toward replacement (-2.5) for
     seasons with few minutes (500 minutes of replacement play mixed in). That's the same impact-per-100 scale the
     hub's ratings use.
  2. The season is valued with the hub's production model (Stephen Noh's salary model, the one in nba/lib/model.js):
     minutes / 1475 x (rating + 3) x $4.32M, in 2026-27 cap dollars. Seasons he didn't play are worth nothing.
  3. Surplus against what his pick would pay today:
       First round: the 2026-27 rookie scale. Years 1-2 are guaranteed (value minus salary, which can be negative);
       years 3-4 are team options, picked up only when he's worth it. Years 5-7 are his second contract with his
       drafting team holding his rights: only the part of his value above the max (25% of the cap) counts, since a
       star on a max deal is still underpaid. Everyone else costs about what he's worth by then.
       Second round: minimum-salary deals. Year 1 counts either way; after that he's kept only while he's worth it.
  4. Each later season is discounted 8% a year back to draft night.
The curve is fit to the average surplus at each slot across the 18 drafts (each career capped at $200M so one LeBron
can't bend it): a steep early drop plus a straight decline to zero at No. 60. Busts count: a slot's value includes
every miss at that slot.
"""
import argparse, csv, io, json, math, os, sys, urllib.parse, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "nba", "data", "picks.json")
BASE = "https://raw.githubusercontent.com/sumitrodatta/bball-reference-datasets/master/Data/"
FIRST, LAST = 2001, 2018
YEARS = 8
DISC = 0.08
CAP0, CAP_2526 = 164_961_000, 154_647_000
REPL, SHRINK_MIN = -2.5, 500
CAP_ONE = 200e6


def load(name, src):
    if src and os.path.exists(os.path.join(src, name.replace(" ", "_"))):
        return list(csv.DictReader(open(os.path.join(src, name.replace(" ", "_")), encoding="utf-8")))
    with urllib.request.urlopen(BASE + urllib.parse.quote(name), timeout=60) as r:
        return list(csv.DictReader(io.StringIO(r.read().decode("utf-8"))))


def num(x, d=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return d


def season_value(mp, bpm):
    r = (bpm * mp + REPL * SHRINK_MIN) / (mp + SHRINK_MIN)
    return max(0.0, mp / 1475 * (r + 3) * 4.32e6 * CAP0 / CAP_2526)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src")
    a = ap.parse_args()
    cba = json.load(open(os.path.join(ROOT, "celtics", "data.json")))["cba"]
    rookie = [x * 1e6 for x in cba["rookie"]]
    mins = cba["min_scale"]
    maxsal = 0.25 * CAP0

    draft = load("Draft Pick History.csv", a.src)
    adv = load("Advanced.csv", a.src)
    # one line per player-season: the combined row when he was traded
    seasons = defaultdict(dict)
    for r in adv:
        if r["lg"] != "NBA":
            continue
        y, pid = int(r["season"]), r["player_id"]
        multi = r["team"].endswith("TM") or r["team"] == "TOT"
        if pid in seasons and y in seasons[pid] and not multi:
            continue
        seasons[pid][y] = (num(r["mp"]), num(r["bpm"]), int(num(r["g"])))

    by_slot = defaultdict(list)
    examples = defaultdict(list)
    for r in draft:
        if r["lg"] != "NBA" or not r["overall_pick"].isdigit():
            continue
        y, pick = int(r["season"]), int(r["overall_pick"])
        if not (FIRST <= y <= LAST) or pick > 60:
            continue
        s = seasons.get(r["player_id"], {})
        total, prod = 0.0, 0.0
        kept = True
        for k in range(1, YEARS + 1):
            mp, bpm, g = s.get(y + k, (0.0, REPL, 0))
            v = season_value(mp, bpm) if mp > 0 else 0.0
            disc = (1 + DISC) ** -(k - 1)
            prod += v * disc
            if pick <= 30:
                sal = rookie[pick - 1] * (1, 1.05, 1.05 * 1.048, 1.05 * 1.048 * 1.8)[k - 1] if k <= 4 else 0
                if k <= 2:
                    surplus = v - sal
                elif k <= 4:
                    surplus = max(0.0, v - sal) if kept else 0.0
                    if v < sal:
                        kept = False
                elif k <= 7:
                    surplus = max(0.0, v - maxsal)
                else:
                    surplus = 0.0
            else:
                sal = mins[min(k - 1, 3)]
                if k == 1:
                    surplus = v - sal
                elif k <= 4 and kept:
                    surplus = max(0.0, v - sal)
                    if v < sal:
                        kept = False
                else:
                    surplus = 0.0
            total += surplus * disc
        by_slot[pick].append(total)
        examples[pick].append((total, r["player"], y))

    raw = [sum(by_slot[k]) / len(by_slot[k]) if by_slot[k] else 0.0 for k in range(1, 61)]
    hit = [sum(1 for x in by_slot[k] if x > 5e6) / max(1, len(by_slot[k])) for k in range(1, 61)]
    # Eighteen picks per slot is a small sample (one LeBron moves a slot by $20M), so fit a smooth shape instead of
    # trusting each slot: a steep early drop (exponential) plus a straight decline to zero at No. 60. Each slot's
    # average caps any one career at $200M first, so a single outlier can't bend the whole curve.
    capped = [sum(min(x, CAP_ONE) for x in by_slot[k]) / len(by_slot[k]) if by_slot[k] else 0.0 for k in range(1, 61)]
    def fit(B):
        e = [math.exp(-k / B) for k in range(60)]
        l = [(59 - k) / 59 for k in range(60)]
        a11 = sum(x * x for x in e); a12 = sum(x * y for x, y in zip(e, l)); a22 = sum(y * y for y in l)
        b1 = sum(x * y for x, y in zip(e, capped)); b2 = sum(x * y for x, y in zip(l, capped))
        det = a11 * a22 - a12 * a12
        A = (b1 * a22 - b2 * a12) / det; C = (a11 * b2 - a12 * b1) / det
        return sum((A * x + C * y - r) ** 2 for x, y, r in zip(e, l, capped)), A, C, B
    _, A, C, B = min(fit(b / 10) for b in range(30, 121))
    curve = [max(0.0, A * math.exp(-k / B) + C * (59 - k) / 59) for k in range(60)]
    best = {k: sorted(examples[k], reverse=True)[:2] for k in (1, 2, 3, 5, 10, 15, 20, 30, 45)}
    out = {
        "_about": "Draft-night value of each NBA pick (surplus over the pick's salary, 2026-27 cap dollars, discounted 8% a "
                  "year) from what picks 1-60 in the 2001-2018 drafts produced. Built by tools/nba_pick_curve.py.",
        "drafts": [FIRST, LAST], "years": YEARS, "disc": DISC,
        "curve": [round(x) for x in curve],
        "raw": [round(x) for x in raw],
        "fit": {"A": round(A), "B": B, "C": round(C)},
        "hit": [round(x, 3) for x in hit],
        "best": {str(k): [[p, yr, round(v)] for v, p, yr in lst] for k, lst in best.items()},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    print("wrote", OUT)
    for k in (1, 2, 3, 4, 5, 8, 10, 14, 20, 25, 30, 31, 40, 50, 60):
        print(f"  #{k:>2}: ${curve[k-1]/1e6:6.1f}M  (raw ${raw[k-1]/1e6:6.1f}M, hit {hit[k-1]:.0%})")


if __name__ == "__main__":
    main()
