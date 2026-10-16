#!/usr/bin/env python3
"""The best keepers ever: the five hitters and five pitchers who produced the most in the seasons they were kept.

Each season's value is the same idea as the awards: how far above or below a typical rostered player he was in each
of our 16 categories, added up. The typical rostered player is the average of that season's top 208 hitters by plate
appearances or 160 pitchers: the top 112 by innings plus the top 48 relievers by saves and holds (16 teams' worth). Average and OPS count in proportion to plate
appearances, ERA and WHIP in proportion to innings, and losses, ERA and WHIP count against. A keeper's score is the sum
over every season someone kept him, whichever team that was. Stats come from tools/mlb (MLB's Stats API); keepers from
data["keeperHistory"] (2014 to 2016 are the partial, rebuilt lists).

  python3 tools/yoenis_keeper_value.py
Writes data["keeperBest"] = {"b": [...5 hitters], "p": [...5 pitchers]}, each
  {"n": name, "years": [2019, ...], "teams": [[year, team index], ...], "v": total value, "line": "..."}
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


def season_values(y):
    m = json.loads((MLB / f"{y}.json").read_text(encoding="utf-8"))
    out = {}
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
        return lambda r: sum(s * (f(r) - mu) / sd for (f, _), (mu, sd, s) in zip(fns, ms))

    vb, vp = scorer(hit, bcats), scorer(pit, pcats)
    for h in m["hitting"]:
        k = (fold(h["name"]), "b")
        if k not in out or h["pa"] > out[k]["row"]["pa"]:
            out[k] = {"v": vb(h), "row": h}
    for p in m["pitching"]:
        k = (fold(p["name"]), "p")
        if k not in out or ip(p["ip"]) > ip(out[k]["row"]["ip"]):
            out[k] = {"v": vp(p), "row": p}
    return out


def main():
    d = json.loads(DATA.read_text(encoding="utf-8"))
    tenure = {}                                    # (mlb id, kind) -> {"n", "seasons": [(year, team, value, row)]}
    for y in sorted(d["keeperHistory"]):
        if not (MLB / f"{y}.json").exists():
            continue
        vals = season_values(int(y))
        for ti, ks in d["keeperHistory"][y]:
            for k in ks:
                f, sd = fold(k[0]), side(k[0])
                b, p = vals.get((f, "b")), vals.get((f, "p"))
                if sd == "b" or (not sd and b and (not p or b["row"]["pa"] >= 3 * ip(p["row"]["ip"]))):
                    hit, kind = b, "b"
                else:
                    hit, kind = p, "p"
                if not hit:
                    continue                       # didn't play in the majors that year
                t = tenure.setdefault((hit["row"]["id"], kind), {"n": k[0], "seasons": []})
                t["seasons"].append((int(y), ti, hit["v"], hit["row"]))
    best = {}
    for kind in ("b", "p"):
        rows = sorted((t for (_, kk), t in tenure.items() if kk == kind), key=lambda t: -sum(s[2] for s in t["seasons"]))[:5]
        out = []
        for t in rows:
            ss = sorted(t["seasons"])
            rs = [s[3] for s in ss]
            if kind == "b":
                ab = sum(r["ab"] for r in rs)
                line = (f"{sum(r['hr'] for r in rs):,} HR, {sum(r['r'] for r in rs):,} R, {sum(r['rbi'] for r in rs):,} RBI, "
                        f"{sum(r['sb'] for r in rs):,} SB, {(sum(r['h'] for r in rs) / ab if ab else 0):.3f} AVG".replace(" 0.", " ."))
            else:
                inn = sum(ip(r["ip"]) for r in rs)
                sv = sum(r["sv"] for r in rs)
                line = (f"{sum(r['w'] for r in rs):,} W, {sum(r['k'] for r in rs):,} K, " + (f"{sv:,} SV, " if sv else "") +
                        f"{9 * sum(r['er'] for r in rs) / inn:.2f} ERA, {sum(r['bb'] + r['h'] for r in rs) / inn:.2f} WHIP")
            out.append({"n": t["n"], "years": [s[0] for s in ss], "teams": [[s[0], s[1]] for s in ss],
                        "v": round(sum(s[2] for s in ss), 1), "line": line})
        best[kind] = out
    d["keeperBest"] = best
    txt = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
    assert "@" not in txt
    DATA.write_text(txt, encoding="utf-8")
    seasons = {s["year"]: s for s in d["seasons"]}
    for kind in ("b", "p"):
        for x in best[kind]:
            print(kind, x["n"], x["years"], x["v"], x["line"], [seasons[y]["teams"][ti] for y, ti in x["teams"]])


if __name__ == "__main__":
    main()
