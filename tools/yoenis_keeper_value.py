#!/usr/bin/env python3
"""Keeper years, the best keepers ever, and the keeper of the year, for yoenis/data.json.

Keeper years: where a list doesn't record them (everything before 2023, and a few in 2022), they're worked out from
the rounds. A keeper costs his last draft round in year one, two rounds earlier in year two, and four more rounds
earlier in year three, so a player kept two rounds earlier than his last draft round is in year two, and four rounds
earlier is year three; otherwise a player kept the season before moves up a year, and anyone else is in year one.
2020's short season didn't count against the clock: a player kept in 2020 and 2021 has the same year both seasons.
Checked against the 2023-2026 sheet, this matches 308 of 318 recorded years (the misses are mostly typos in the sheet).

Best keepers: the five hitters and five pitchers with the best single keeper window, the season before he was first
kept plus his kept seasons (up to three, or four with 2020), whoever kept him.

Keeper of the year: for 2022 on, the Best keeper award. Before that, the keeper who beat his draft slot by the most:
his pick number minus his value rank among all players that season.

Each season's value is the same idea as the awards: how far above or below a typical rostered player he was in each
of our 16 categories, added up. The typical rostered player is the average of that season's top 208 hitters by plate
appearances or 160 pitchers: the top 112 by innings plus the top 48 relievers by saves and holds (16 teams' worth). Average and OPS count in proportion to plate
appearances, ERA and WHIP in proportion to innings, and losses, ERA and WHIP count against. Stats come from tools/mlb
(MLB's Stats API); keepers from data["keeperHistory"] (2014 to 2016 are the partial, rebuilt lists).

  python3 tools/yoenis_keeper_value.py
Fills keeper years in data["keeperHistory"] and writes
  data["keeperBest"] = {"b": [5 hitters], "p": [5 pitchers]}, each {"n", "orig": first season, "years": kept seasons,
                        "teams": [[year, team index], ...], "v": window value, "line": stat totals for the window}
  data["keeperOfYear"] = {"2019": "Player", ...}
"""
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from yoenis_yahoo_keepers import fold, side  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "yoenis" / "data.json"
MLB = ROOT / "tools" / "mlb"
POOL_B, POOL_P, POOL_RP = 208, 160, 48


def ip(x):            # 85.2 means 85 and 2/3 innings
    whole = int(x)
    return whole + round((x - whole) * 10) / 3


def season_model(y):
    """The season's scorers, (hitter, pitcher): each takes a stat row and a share of the season f
    (1 for a full season) and returns his value. For part of a season, a typical rostered player's
    totals are scaled by f, so a player producing at an average rate for f of a season scores 0 and
    a full season scores exactly what season_values gives."""
    m = json.loads((MLB / f"{y}.json").read_text(encoding="utf-8"))
    hit = sorted(m["hitting"], key=lambda h: -h["pa"])[:POOL_B]
    # rostered staffs carry closers and setup men too: the top starters by innings plus the top relievers by saves and holds
    starters = sorted(m["pitching"], key=lambda p: -ip(p["ip"]))[:POOL_P - POOL_RP]
    ids = {p["id"] for p in starters}
    relief = [p for p in sorted(m["pitching"], key=lambda p: -(p["sv"] + p["hld"])) if p["id"] not in ids][:POOL_RP]
    pit = starters + relief
    mpa = statistics.mean(h["pa"] for h in hit)
    mip = statistics.mean(ip(p["ip"]) for p in pit)
    lg_avg = sum(h["h"] for h in hit) / sum(h["ab"] for h in hit)
    lg_ops = statistics.mean(h["ops"] for h in hit)
    lg_era = 9 * sum(p["er"] for p in pit) / sum(ip(p["ip"]) for p in pit)
    lg_whip = sum(p["bb"] + p["h"] for p in pit) / sum(ip(p["ip"]) for p in pit)
    bcats = [("r", 1), ("h", 1), ("hr", 1), ("rbi", 1), ("sb", 1), ("tb", 1),
             (lambda h: ((h["avg"] or 0) - lg_avg) * h["pa"] / mpa, 1), (lambda h: ((h["ops"] or 0) - lg_ops) * h["pa"] / mpa, 1)]
    pcats = [("w", 1), ("l", -1), ("sv", 1), ("k", 1), ("hld", 1), ("qs", 1),
             (lambda p: ((p["era"] if p["era"] is not None else lg_era) - lg_era) * ip(p["ip"]) / mip, -1),
             (lambda p: ((p["whip"] if p["whip"] is not None else lg_whip) - lg_whip) * ip(p["ip"]) / mip, -1)]

    def scorer(pool, cats):
        fns = [(c if callable(c) else (lambda r, c=c: r[c]), s) for c, s in cats]
        ms = [(statistics.mean(f(r) for r in pool), statistics.pstdev(f(r) for r in pool) or 1, s) for f, s in fns]
        return lambda r, share=1: sum(s * (f(r) - mu * share) / sd for (f, _), (mu, sd, s) in zip(fns, ms))

    return scorer(hit, bcats), scorer(pit, pcats), m


def season_values(y):
    vb, vp, m = season_model(y)
    out = {}
    for h in m["hitting"]:
        k = (fold(h["name"]), "b")
        if k not in out or h["pa"] > out[k]["row"]["pa"]:
            out[k] = {"v": vb(h), "row": h}
    for p in m["pitching"]:
        k = (fold(p["name"]), "p")
        if k not in out or ip(p["ip"]) > ip(out[k]["row"]["ip"]):
            out[k] = {"v": vp(p), "row": p}
    return out


def key(n):
    return (fold(n), side(n))


def fill_years(d, S):
    hist = d["keeperHistory"]
    draft = {y: {key(p[2]): p for p in s["draft"]} for y, s in S.items()}
    yr = {}
    for y in sorted(int(y) for y in hist):
        for _, ks in hist[str(y)]:
            for k in ks:
                kk, r = key(k[0]), k[1]
                prev, pk = draft.get(y - 1, {}).get(kk), yr.get((y - 1, kk))
                if y == 2021 and (2020, kk) in yr:
                    v = yr[(2020, kk)]                       # 2020 didn't count
                elif prev and r and prev[0] != r and r == max(1, prev[0] - 2):
                    v = 2
                elif prev and r and prev[0] != r and r == max(1, prev[0] - 4):
                    v = 3
                elif pk and pk < 3:
                    v = pk + 1
                else:
                    v = 1
                yr[(y, kk)] = k[2] or v
                if not k[2]:
                    k[2] = v
    return yr


def pick(vals, k):
    """the player's hitting or pitching line that season, by how he was listed and how much he played"""
    f, sd = fold(k), side(k)
    b, p = vals.get((f, "b")), vals.get((f, "p"))
    if sd == "b" or (not sd and b and (not p or b["row"]["pa"] >= 3 * ip(p["row"]["ip"]))):
        return b, "b"
    return p, "p"


def line(kind, rs):
    if kind == "b":
        ab = sum(r["ab"] for r in rs)
        return (f"{sum(r['hr'] for r in rs):,} HR, {sum(r['r'] for r in rs):,} R, {sum(r['rbi'] for r in rs):,} RBI, "
                f"{sum(r['sb'] for r in rs):,} SB, {(sum(r['h'] for r in rs) / ab if ab else 0):.3f} AVG".replace(" 0.", " ."))
    inn = sum(ip(r["ip"]) for r in rs)
    sv = sum(r["sv"] for r in rs)
    return (f"{sum(r['w'] for r in rs):,} W, {sum(r['k'] for r in rs):,} K, " + (f"{sv:,} SV, " if sv else "") +
            f"{9 * sum(r['er'] for r in rs) / inn:.2f} ERA, {sum(r['bb'] + r['h'] for r in rs) / inn:.2f} WHIP")


def main():
    d = json.loads(DATA.read_text(encoding="utf-8"))
    S = {s["year"]: s for s in d["seasons"]}
    hist = d["keeperHistory"]
    fill_years(d, S)
    vals = {y: season_values(y) for y in S if (MLB / f"{y}.json").exists()}

    # keeper windows: a run of kept seasons with rising keeper years (2020 and 2021 can share one), plus the season before
    kept = {}
    for y in sorted(int(y) for y in hist):
        for ti, ks in hist[str(y)]:
            for k in ks:
                kept.setdefault(key(k[0]), []).append((y, ti, k))
    windows = []
    for kk, seasons in kept.items():
        cur = []
        for y, ti, k in seasons:
            last = cur[-1] if cur else None
            joined = last and y == last[0] + 1 and (k[2] == last[2][2] + 1 or (y == 2021 and k[2] == last[2][2]))
            if not joined:
                if cur:
                    windows.append(cur)
                cur = []
            cur.append((y, ti, k))
        if cur:
            windows.append(cur)
    scored = []
    for w in windows:
        name = w[0][2][0]
        orig = w[0][0] - 1
        rows, kinds, total = [], [], 0
        for y in [orig] + [x[0] for x in w]:
            if y not in vals:
                continue
            hit, kind = pick(vals[y], name)
            if hit:
                rows.append((kind, hit["row"]))
                kinds.append(kind)
                total += hit["v"]
        if not kinds:
            continue
        kind = max(set(kinds), key=kinds.count)
        scored.append({"n": name, "orig": orig, "years": [x[0] for x in w], "teams": [[x[0], x[1]] for x in w],
                       "v": round(total, 1), "line": line(kind, [r for kd, r in rows if kd == kind]), "kind": kind,
                       "id": key(name)})
    best = {}
    for kind in ("b", "p"):
        out, seen = [], set()
        for x in sorted((x for x in scored if x["kind"] == kind), key=lambda x: -x["v"]):
            if x["id"] in seen:
                continue                                   # one window per player
            seen.add(x["id"])
            out.append({k: v for k, v in x.items() if k not in ("kind", "id")})
            if len(out) == 5:
                break
        best[kind] = out
    d["keeperBest"] = best

    # keeper of the year
    koy = {}
    for y in sorted(int(y) for y in hist):
        aw = [a for a in d.get("awards", {}).get(str(y), []) if a.get("a") == "Best keeper"]
        if aw:
            koy[str(y)] = aw[0]["p"]
            continue
        if y not in vals:
            continue
        rank = {kk: i + 1 for i, (kk, _) in enumerate(sorted(vals[y].items(), key=lambda kv: -kv[1]["v"]))}
        pickno = {(p[1], key(p[2])): i + 1 for i, p in enumerate(S[y]["draft"])}   # the keeper's own pick
        cands = []
        for ti, ks in hist[str(y)]:
            for k in ks:
                hit, kind = pick(vals[y], k[0])
                rk = rank.get((fold(k[0]), kind))
                if hit and rk and (ti, key(k[0])) in pickno:
                    cands.append((pickno[(ti, key(k[0]))] - rk, k[0]))
        if cands:
            koy[str(y)] = max(cands)[1]
    d["keeperOfYear"] = koy

    txt = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
    assert "@" not in txt
    DATA.write_text(txt, encoding="utf-8")
    for kind in ("b", "p"):
        for x in best[kind]:
            print(kind, x["n"], x["orig"], x["years"], x["v"], x["line"], [S[y]["teams"][ti] for y, ti in x["teams"]])
    print(koy)


if __name__ == "__main__":
    main()
