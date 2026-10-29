#!/usr/bin/env python3
"""Build the Wipe Yoenis trade history for yoenis/data.json from tools/yahoo_yoenis/trades.json.

Who won each trade, measured with the same player values as the awards and Best keepers
(tools/yoenis_keeper_value.py: how far above or below a typical rostered player he was in our 16
categories), turned into value over replacement so a hurt or benched player counts as zero, not less:
  - That season: his season value over replacement, times the share of the season left after the trade
    (all of it for a trade before Opening Day).
  - Kept after: each later season the manager who got him kept him, in full.
Replacement is the last rostered player at his side of the ball: the 208th hitter, the 160th pitcher.
Value is per player, so it's a guide, not gospel: it can't see who a team dropped to make room, or
what a trade did to the standings.

Writes data["tradeHistory"] = {
  "trades": [{"y": year, "d": "YYYY-MM-DD", "a": team index, "b": team index,
              "ag": [[player, now, kept], ...], "bg": [...], "ap": ["2013 5th", ...], "bp": [...],
              "av": side a total, "bv": side b total}, ...],   newest first
  "vetoed": number of trades Yahoo shows as vetoed (left out)
}
  python3 tools/yoenis_trades_build.py
"""
import json
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from yoenis_keeper_value import season_values, POOL_B, POOL_P  # noqa: E402
from yoenis_yahoo_keepers import fold, side  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "yoenis" / "data.json"
TRADES = ROOT / "tools" / "yahoo_yoenis" / "trades.json"
EASTERN = ZoneInfo("America/New_York")
ORD = {1: "1st", 2: "2nd", 3: "3rd"}


def ordinal(n):
    return ORD.get(n if n < 20 else n % 10, f"{n}th") if not 10 < n % 100 < 14 else f"{n}th"


def vor_table(year, cache={}):
    """{(folded name, 'b'|'p'): value over replacement for the season}"""
    if year in cache:
        return cache[year]
    try:
        sv = season_values(year)
    except FileNotFoundError:
        cache[year] = {}
        return cache[year]
    out = {}
    for sd, pool in (("b", POOL_B), ("p", POOL_P)):
        vals = sorted((r["v"] for k, r in sv.items() if k[1] == sd), reverse=True)
        repl = vals[pool - 1] if len(vals) >= pool else (vals[-1] if vals else 0)
        for k, r in sv.items():
            if k[1] == sd:
                out[k] = max(r["v"] - repl, 0.0)
    cache[year] = out
    return out


def pkey(name, pos):
    pit = any(x in (pos or "") for x in ("SP", "RP")) and "Util" not in (pos or "")
    return fold(name), side(name) or ("p" if pit else "b")


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    pulled = json.loads(TRADES.read_text(encoding="utf-8"))
    seasons = {s["year"]: s for s in data["seasons"]}

    # Who kept whom, by owner: {year: {owner: {player key}}}
    kept = {}
    for y, rows in data["keeperHistory"].items():
        s = seasons.get(int(y))
        if not s:
            continue
        for ti, ks in rows:
            owner = s["o"][ti]
            kept.setdefault(int(y), {}).setdefault(owner, set()).update(fold(k[0]) + ":" + side(k[0]) for k in ks)

    def kept_after(year, owner, name, pos):
        """Value of the later seasons this owner kept him, back to back."""
        total, f, sd = 0.0, fold(name), pkey(name, pos)[1]
        y = year + 1
        while f + ":" + side(name) in kept.get(y, {}).get(owner, set()):
            total += vor_table(y).get((f, sd), 0.0)
            y += 1
        return total

    out, vetoed = [], 0
    for ys, v in pulled.items():
        year = int(ys)
        s = seasons[year]
        idx = {k: s["teams"].index(n) for k, n in v["teams"].items() if n in s["teams"]}
        start = date.fromisoformat(v["start"]) if v.get("start") else None
        end = date.fromisoformat(v["end"]) if v.get("end") else None
        vt = vor_table(year)
        for t in v["trades"]:
            if t["status"] != "successful":
                vetoed += 1
                continue
            when = datetime.fromtimestamp(t["ts"], EASTERN).date()
            share = 1.0
            if start and end and when > start:
                share = max(0.0, min(1.0, (end - when).days / max((end - start).days, 1)))
            a, b = t["a"], t["b"]
            if a not in idx or b not in idx:
                continue
            sides = {a: [], b: []}
            for p in t["players"]:
                to = p["to"]
                if to not in sides:
                    continue
                now = vt.get(pkey(p["name"], p["pos"]), 0.0) * share
                later = kept_after(year, s["o"][idx[to]], p["name"], p["pos"])
                sides[to].append([p["name"], round(now, 1), round(later, 1)])
            picks = {a: [], b: []}
            for pk in t.get("picks") or []:
                if pk["to"] in picks:
                    orig = v["teams"].get(pk.get("orig") or pk["from"], "")
                    picks[pk["to"]].append(f"{orig}'s {ordinal(pk['round'])}".strip())
            tot = lambda k: round(sum(x[1] + x[2] for x in sides[k]), 1)  # noqa: E731
            out.append({"y": year, "d": when.isoformat(), "a": idx[a], "b": idx[b],
                        "ag": sides[a], "bg": sides[b], "ap": picks[a], "bp": picks[b],
                        "av": tot(a), "bv": tot(b)})
    out.sort(key=lambda t: t["d"], reverse=True)
    hist = {"trades": out, "vetoed": vetoed}
    if data.get("tradeHistory") == hist:
        print("No change.")
        return
    data["tradeHistory"] = hist
    DATA.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(out)} trades ({vetoed} vetoed left out) to {DATA}.")


if __name__ == "__main__":
    main()
