#!/usr/bin/env python3
"""Luck, team identity, draft grades and waiver activity for the Wipe Yoenis page (yoenis/data.json "analysis").

  luck     every regular-season week, each team's categories against all 15 other teams, not just its opponent:
           its all-play record. Expected wins are its share of those all-play matchups, so a team that would have
           beaten 12 of 15 teams in a week that it lost counts 0.8 of a win expected and 0 actual. Luck is actual
           wins less expected. A team under the 30-inning minimum loses its pitching categories to everyone, as
           Yahoo scores it against its own opponent.
  dna      for each manager, the share of the league his team beat in each category in a typical week, across
           every regular-season week he played: what his teams are built on.
  drafts   every pick of the keeper era (2017 on, when the keepers are known) against what the nth player drafted
           usually produces his first season (tools/yoenis_value.py slot_curve): each team's draft class, its
           best pick and its worst early one, and the league's biggest steals and busts.
  adds     pickups per team per season.

Writes data["analysis"] = {
  "luck": [[year, team index, wins, games, expected wins, category share], ...]   (wins count a tie as half)
  "dna": {owner: {category: share}},
  "drafts": [[year, team index, value over slot, picks, best, worst], ...]   best/worst: [name, round, nth drafted, value, over]
  "steals": [[year, team index, name, round, nth drafted, value, over], ...]  (top 15)
  "busts": [...]   (the first 32 players drafted only; top 10)
  "adds": [[year, team index, pickups], ...]
}
  python3 tools/yoenis_analysis_build.py
"""
import collections
import glob
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from yoenis_value import slot_curve, draft_value  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "yoenis" / "data.json"
HIST = ROOT / "tools" / "yahoo_yoenis" / "history"
MIN_IP = 30


def innings(ip):
    try:
        whole, _, frac = str(ip).partition(".")
        return int(whole) + int(frac or 0) / 3
    except ValueError:
        return None


def luck_and_dna(data):
    seasons = {s["year"]: s for s in data["seasons"]}
    luck, dna = [], collections.defaultdict(lambda: collections.defaultdict(list))
    for f in sorted(glob.glob(str(HIST / "*.json"))):
        h = json.load(open(f, encoding="utf-8"))
        y = h["season"]
        s = seasons.get(y)
        if not s:
            continue
        idx = {k: s["teams"].index(n) for k, n in h["teams"].items() if n in s["teams"]}
        cats = h["cats"]
        low = [c["low"] for c in cats]
        pit = [c["side"] == "p" for c in cats]
        exp, act, games, share = (collections.defaultdict(float) for _ in range(4))
        for w in h["weeks"]:
            if w["week"] >= h.get("playoff_week", 99):
                continue
            stats, short = {}, set()
            for mu in w["matchups"]:
                for tk in mu["teams"]:
                    v = (mu.get("stats") or {}).get(tk)
                    if v and all(x is not None for x in v):
                        stats[tk] = v
                    ip = innings(((mu.get("x") or {}).get(tk) or {}).get("IP"))
                    if ip is not None and ip < MIN_IP:
                        short.add(tk)
                if len(mu["teams"]) == 2 and all(x != "" for x in mu["won"]):
                    a, b = mu["teams"]
                    wa, wb = sum(x == a for x in mu["won"]), sum(x == b for x in mu["won"])
                    act[a] += 1 if wa > wb else 0.5 if wa == wb else 0
                    act[b] += 1 if wb > wa else 0.5 if wa == wb else 0
                    games[a] += 1
                    games[b] += 1
            tks = [t for t in stats if t in idx]
            if len(tks) < 4:
                continue
            for a in tks:
                won = 0.0
                beat = [0] * len(cats)
                for b in tks:
                    if a == b:
                        continue
                    ca = cb = 0
                    for i in range(len(cats)):
                        if pit[i] and (a in short) != (b in short):  # under the minimum: pitching goes to the other side
                            if b in short:
                                ca += 1
                                beat[i] += 1
                            else:
                                cb += 1
                            continue
                        x, z = stats[a][i], stats[b][i]
                        if x == z:
                            continue
                        if (x < z) == low[i]:
                            ca += 1
                            beat[i] += 1
                        else:
                            cb += 1
                    won += 1 if ca > cb else 0.5 if ca == cb else 0
                exp[a] += won / (len(tks) - 1)
                owner = s["o"][idx[a]]
                for i, c in enumerate(cats):
                    dna[owner][c["abbr"]].append(beat[i] / (len(tks) - 1))
                share[a] += sum(beat) / (len(cats) * (len(tks) - 1))
        for tk, ti in idx.items():
            if games[tk]:
                luck.append([y, ti, act[tk], int(games[tk]), round(exp[tk], 2), round(share[tk] / games[tk], 3)])
    dna_out = {o: {c: round(sum(v) / len(v), 3) for c, v in d.items()} for o, d in dna.items()}
    return luck, dna_out


def drafts(data):
    sc = slot_curve()
    classes, every = [], []
    for s in data["seasons"]:
        if not s.get("keepers_known"):
            continue
        y = s["year"]
        n = 0
        by = collections.defaultdict(list)
        for i, e in enumerate(s["draft"]):
            if len(e) > 3 and e[3]:
                continue
            n += 1
            v = draft_value(y, i, e[2])
            over = v - sc.get(n, 1.0)
            row = [e[2], e[0], n, round(v, 1), round(over, 1)]
            by[e[1]].append(row)
            every.append([y, e[1]] + row)
        for ti, rows in by.items():
            best = max(rows, key=lambda r: r[4])
            early = [r for r in rows if r[1] <= 5] or rows
            worst = min(early, key=lambda r: r[4])
            classes.append([y, ti, round(sum(r[4] for r in rows), 1), len(rows), best, worst])
    steals = sorted(every, key=lambda r: -r[6])[:15]
    busts = sorted((r for r in every if r[4] <= 32), key=lambda r: r[6])[:10]
    return classes, steals, busts


def adds(data):
    seasons = {s["year"]: s for s in data["seasons"]}
    out = []
    for f in sorted(glob.glob(str(HIST / "*.json"))):
        h = json.load(open(f, encoding="utf-8"))
        s = seasons.get(h["season"])
        if not s:
            continue
        idx = {k: s["teams"].index(n) for k, n in h["teams"].items() if n in s["teams"]}
        c = collections.Counter(m["team"] for m in h["moves"] if m["type"] == "add")
        out.extend([h["season"], ti, c[tk]] for tk, ti in idx.items())
    return out


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    luck, dna = luck_and_dna(data)
    classes, steals, busts = drafts(data)
    out = {"luck": luck, "dna": dna, "drafts": classes, "steals": steals, "busts": busts, "adds": adds(data)}
    if data.get("analysis") == out:
        print("No change.")
        return
    data["analysis"] = out
    DATA.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(luck)} team-seasons of luck, {len(dna)} managers' category profiles, {len(classes)} draft classes.")


if __name__ == "__main__":
    main()
