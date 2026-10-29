#!/usr/bin/env python3
"""Build the Wipe Yoenis trade history for yoenis/data.json from tools/yahoo_yoenis/trades.json.

Who won each trade, with the awards' 16-category player values counted above replacement (the 208th hitter
or 160th pitcher), so a hurt or benched player counts zero, not less (tools/yoenis_value.py):
  - That season: what he actually did for the team that got him, from the day after the trade until he was
    dropped or traded again, or the season ended (his MLB game logs, totaled in tools/yahoo_yoenis/slices).
  - Kept after: if he was still there at season's end, each later season that manager kept him counts his
    value less what that keeper round was expected to produce (an average non-keeper pick in that round
    over 14 drafts), never below zero.
  - Draft picks that changed hands count what an average pick in that round was worth.
Vetoed trades are left out. If a season's game logs haven't been pulled yet, its trades fall back to his
full-season value prorated by the days left, and are marked "est".

Writes data["tradeHistory"] = {
  "trades": [{"y": year, "d": "YYYY-MM-DD", "a": team index, "b": team index,
              "ag": [[player, that season, kept after, seasons kept], ...], "bg": [...],
              "ap": [[pick label, value], ...], "bp": [...], "av": side a total, "bv": side b total,
              "est": true when prorated}, ...],   newest first
  "vetoed": number of trades left out, "curve": {round: expected value}
}
  python3 tools/yoenis_trades_build.py
"""
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from yoenis_tenure import windows, key, pkey, day  # noqa: E402,F401
from yoenis_value import vor_table, window_value, pick_curve, expected, kept_map, kept_surplus  # noqa: E402,F401

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "yoenis" / "data.json"
TRADES = ROOT / "tools" / "yahoo_yoenis" / "trades.json"
SLICES = ROOT / "tools" / "yahoo_yoenis" / "slices"
ORD = {1: "1st", 2: "2nd", 3: "3rd"}


def ordinal(n):
    return ORD.get(n if n < 20 else n % 10, f"{n}th") if not 10 < n % 100 < 14 else f"{n}th"


def slices(year):
    p = SLICES / f"{year}.json"
    return json.loads(p.read_text(encoding="utf-8"))["s"] if p.exists() else None


def window_now(year, w, sl, season_days):
    """(value that season, estimated?) for one tenure window"""
    days = (w["end"] - w["start"]).days + 1
    if days <= 0:
        return 0.0, False
    share = days / season_days
    if sl is not None:
        t = sl.get(key(w))
        return (window_value(year, t, w["pk"][1], share) if t else 0.0), False
    return vor_table(year).get(w["pk"], 0.0) * share, True


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    pulled = json.loads(TRADES.read_text(encoding="utf-8"))
    seasons = {s["year"]: s for s in data["seasons"]}
    kept = kept_map(data)

    out, vetoed = [], 0
    for ys, v in pulled.items():
        year = int(ys)
        s = seasons[year]
        idx = {k: s["teams"].index(n) for k, n in v["teams"].items() if n in s["teams"]}
        start, end = date.fromisoformat(v["start"]), date.fromisoformat(v["end"])
        season_days = (end - start).days + 1
        sl = slices(year)
        wins = {(w["ref"], w["team"], w["pk"]): w for w in windows(year) if w["kind"] == "trade"}
        for t in v["trades"]:
            if t["status"] != "successful":
                vetoed += 1
                continue
            a, b = t["a"], t["b"]
            if a not in idx or b not in idx:
                continue
            sides, est = {a: [], b: []}, False
            for p in t["players"]:
                to = p["to"]
                if to not in sides:
                    continue
                w = wins.get((t["id"], to, pkey(p["name"], p["pos"])))
                now, e = window_now(year, w, sl, season_days) if w else (0.0, False)
                est = est or e
                later, n = kept_surplus(year, s["o"][idx[to]], p["name"], p["pos"], kept) if (w and w["stays"]) else (0.0, 0)
                sides[to].append([p["name"], round(now, 1), round(later, 1), n])
            picks = {a: [], b: []}
            for pk in t.get("picks") or []:
                if pk["to"] in picks:
                    orig = v["teams"].get(pk.get("orig") or pk["from"], "")
                    picks[pk["to"]].append([f"{orig}'s {ordinal(pk['round'])}".strip(), expected(pk["round"])])
            tot = lambda k: round(sum(x[1] + x[2] for x in sides[k]) + sum(x[1] for x in picks[k]), 1)  # noqa: E731
            row = {"y": year, "d": day(t["ts"]).isoformat(), "a": idx[a], "b": idx[b],
                   "ag": sides[a], "bg": sides[b], "ap": picks[a], "bp": picks[b], "av": tot(a), "bv": tot(b)}
            if est:
                row["est"] = True
            out.append(row)
    out.sort(key=lambda t: t["d"], reverse=True)
    hist = {"trades": out, "vetoed": vetoed, "curve": pick_curve()}
    if data.get("tradeHistory") == hist:
        print("No change.")
        return
    data["tradeHistory"] = hist
    DATA.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(out)} trades ({vetoed} vetoed left out, {sum(1 for t in out if t.get('est'))} estimated) to {DATA}.")


if __name__ == "__main__":
    main()
