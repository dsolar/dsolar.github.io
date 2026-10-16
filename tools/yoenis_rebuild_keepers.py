#!/usr/bin/env python3
"""Rebuild partial keeper lists for 2014-2016 from the drafts (no keeper sheet or Yahoo keeper page survives).

A keeper goes into the draft at his keeper round, and the cost runs: his last draft round in year one, two rounds
earlier in year two, six rounds earlier in year three. So a pick looks like a keeper when:
  - the same manager took the same player the year before, at the round the rule calls for (0, 2 or 4 rounds
    earlier; only the first in 2014, the league's first keeper year), or
  - the player was kept the next year at a year-two or year-three cost, which means he was kept this year too.
2017's keepers are known (Yahoo), so 2016 is worked out first, then 2015 from 2016, then 2014 from 2015. A few keepers
named in the commissioner's emails are added first (KNOWN below).
Teams kept 4 players in 2014 and 2015 and 5 from 2016 on. Tested on 2018-2025, where the keepers are known, this
picks out about 64% of keepers and about 91% of what it picks is right. Free-agent and traded keepers are missed.

  python3 tools/yoenis_rebuild_keepers.py
Writes data["keeperHistory"]["2014"|"2015"|"2016"] and data["keeperPartial"] (the years rebuilt this way).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from yoenis_yahoo_keepers import fold, side  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "yoenis" / "data.json"
YEARS = {2016: 5, 2015: 4, 2014: 4}        # keepers per team
FIRST = 2014                                # the first year anyone was kept
# Keepers named in the commissioner's emails, each matched to a pick in that year's draft:
#   Mar. 10, 2015: "planning to keep Trout (1), Gerrit Cole (13), Dee Gordon (17) and Matt Adams (23)" (his whole list)
#   Feb. 6, 2015: asking whether Abreu was being kept "in the 4th"
#   Feb. 25, 2014: turning down offers for his keeper Jose Fernandez
KNOWN = {
    2015: [("Asche Larry", ["Mike Trout", "Gerrit Cole", "Dee Strange-Gordon", "Matt Adams"], True),
           ("Enrico Pallazzo", ["José Abreu"], False)],
    2014: [("Asche Larry", ["Jose Fernandez"], False)],
}


def key(n):
    return (fold(n), side(n))


def main():
    d = json.loads(DATA.read_text(encoding="utf-8"))
    S = {s["year"]: s for s in d["seasons"]}
    hist = d.setdefault("keeperHistory", {})
    # next year's keepers and the rounds they cost
    nxt = {}
    for _, ks in hist["2017"]:
        for k in ks:
            nxt[key(k[0])] = k[1]
    for y in sorted(YEARS, reverse=True):
        s, prev = S[y], {key(p[2]): p for p in S[y - 1]["draft"]}
        diffs = {0} if y == FIRST else {0, 2} if y == FIRST + 1 else {0, 2, 4}
        found = {}
        for p in s["draft"]:
            kk, r, why = key(p[2]), p[0], None
            rn = nxt.get(kk)
            if rn is not None and rn != r and rn in {max(1, r - 2), max(1, r - 4)}:
                why = "next"
            q = prev.get(kk)
            if not why and q and S[y - 1]["o"][q[1]] == s["o"][p[1]] and any(r == max(1, q[0] - dd) for dd in diffs):
                why = "prev"
            if why:
                found.setdefault(p[1], []).append((p, why))
        for team, names, whole in KNOWN.get(y, []):
            ti = s["teams"].index(team)
            picks = [p for p in s["draft"] if p[1] == ti and key(p[2]) in {key(n) for n in names}]
            assert len(picks) == len(names), (y, team, names)
            keep = [] if whole else [x for x in found.get(ti, []) if key(x[0][2]) not in {key(n) for n in names}]
            found[ti] = [(p, "known") for p in picks] + keep
        rows, n = [], 0
        for ti, lst in sorted(found.items()):
            lst.sort(key=lambda x: ({"known": 0, "next": 1}.get(x[1], 2), x[0][0]))   # emails, then next-year costs
            ks = sorted(([p[2], p[0], None, False] for p, _ in lst[:YEARS[y]]), key=lambda k: k[1])
            rows.append([ti, ks])
            n += len(ks)
        hist[str(y)] = rows
        nxt = {key(k[0]): k[1] for _, ks in rows for k in ks}
        print(f"{y}: {n} of {YEARS[y] * len(s['teams'])} keepers placed, {len(rows)} teams")
    d["keeperPartial"] = sorted(set(d.get("keeperPartial", [])) | {str(y) for y in YEARS})
    d["keeperHistory"] = dict(sorted(hist.items(), key=lambda kv: kv[0]))
    txt = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
    assert "@" not in txt
    DATA.write_text(txt, encoding="utf-8")


if __name__ == "__main__":
    main()
