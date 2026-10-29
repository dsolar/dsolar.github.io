#!/usr/bin/env python3
"""Build sweeps, rivalries and the waiver wire hall of fame for yoenis/data.json.

Reads tools/yahoo_yoenis/history/<year>.json (tools/yoenis_history_pull.py) and tools/yahoo_yoenis/trades.json.
  sweeps     every matchup one side won in every category (16-0), plus the 15-1 and 15-0-1 near misses
  rivals     every pair of managers' all-time head-to-head: matchups won, lost and tied, and categories,
             with playoff meetings counted separately. By manager, so team renames don't split a rivalry.
  pickups    every free-agent or waiver pickup from Opening Day on, valued like the trade history: his season
             value over replacement for the share of the season he stayed on that team (until he was dropped,
             traded or the season ended), plus every later season that manager kept him.
Writes data["history"] = {"sweeps": [...], "near": [...], "rivals": {...}, "pickups": [...top...], "pickTeams": {...}}.

  python3 tools/yoenis_history_build.py
"""
import glob
import json
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from yoenis_trades_build import vor_table, pkey  # noqa: E402
from yoenis_yahoo_keepers import fold, side  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "yoenis" / "data.json"
HIST = ROOT / "tools" / "yahoo_yoenis" / "history"
TRADES = ROOT / "tools" / "yahoo_yoenis" / "trades.json"
EASTERN = ZoneInfo("America/New_York")
TOP = 60  # pickups kept on the page: the best ever, plus each season's best


def day(ts):
    return datetime.fromtimestamp(ts, EASTERN).date()


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    seasons = {s["year"]: s for s in data["seasons"]}
    trades = json.loads(TRADES.read_text(encoding="utf-8")) if TRADES.exists() else {}

    kept = {}
    for y, rows in data["keeperHistory"].items():
        s = seasons.get(int(y))
        for ti, ks in (rows if s else []):
            kept.setdefault(int(y), {}).setdefault(s["o"][ti], set()).update(fold(k[0]) + ":" + side(k[0]) for k in ks)

    sweeps, near, rivals, pickups = [], [], {}, []
    for f in sorted(glob.glob(str(HIST / "*.json"))):
        h = json.load(open(f, encoding="utf-8"))
        y = h["season"]
        s = seasons.get(y)
        if not s:
            continue
        idx = {k: s["teams"].index(n) for k, n in h["teams"].items() if n in s["teams"]}
        n = len(h["cats"])

        # Matchups: sweeps, near misses, rivalries
        for w in h["weeks"]:
            for mu in w["matchups"]:
                if len(mu["teams"]) != 2 or any(x == "" for x in mu["won"]):
                    continue  # not decided yet
                A, B = mu["teams"]
                if A not in idx or B not in idx:
                    continue
                wa = sum(1 for x in mu["won"] if x == A)
                wb = sum(1 for x in mu["won"] if x == B)
                t = n - wa - wb
                hi, lo = (A, B) if wa >= wb else (B, A)
                whi, wlo = max(wa, wb), min(wa, wb)
                row = {"y": y, "w": w["week"], "a": idx[hi], "b": idx[lo], "s": [whi, wlo, t]}
                if mu["playoffs"]:
                    row["po"] = 1 if not mu["consolation"] else 2
                if whi == n:
                    sweeps.append(row)
                elif whi == n - 1:
                    near.append(row)
                oa, ob = s["o"][idx[A]], s["o"][idx[B]]
                if oa == ob:
                    continue
                k = "|".join(sorted([oa, ob]))
                r = rivals.setdefault(k, {"m": [0, 0, 0], "c": [0, 0, 0], "po": [0, 0, 0], "last": None})
                first = sorted([oa, ob])[0]
                mine, theirs = (wa, wb) if oa == first else (wb, wa)
                res = 0 if mine > theirs else 1 if mine < theirs else 2
                if mu["playoffs"] and not mu["consolation"]:
                    r["po"][res] += 1
                else:
                    r["m"][res] += 1
                r["c"][0] += mine
                r["c"][1] += theirs
                r["c"][2] += t
                r["last"] = [y, w["week"], mine, theirs, t]

        # Pickups from Opening Day on, and how long each stayed
        start = date.fromisoformat(h["start"]) if h.get("start") else None
        end = date.fromisoformat(h["end"]) if h.get("end") else None
        if not (start and end):
            continue
        span = max((end - start).days, 1)
        leaves = {}  # (player key, team) -> sorted dates he left that team
        for m in h["moves"]:
            if m["type"] == "drop":
                leaves.setdefault((pkey(m["name"], m["pos"]), m["team"]), []).append(day(m["ts"]))
        for t in (trades.get(str(y), {}) or {}).get("trades", []):
            if t["status"] != "successful":
                continue
            for p in t["players"]:
                leaves.setdefault((pkey(p["name"], p["pos"]), p["from"]), []).append(day(t["ts"]))
        for v in leaves.values():
            v.sort()
        vt = vor_table(y)
        for m in h["moves"]:
            if m["type"] != "add" or m["team"] not in idx:
                continue
            got = day(m["ts"])
            if got < start or got > end:
                continue
            pk = pkey(m["name"], m["pos"])
            left = next((d for d in leaves.get((pk, m["team"]), []) if d >= got), end)
            share = max(0.0, min(left, end).toordinal() - got.toordinal()) / span
            now = vt.get(pk, 0.0) * share
            owner = s["o"][idx[m["team"]]]
            later, yy = 0.0, y + 1
            if left >= end:  # still his at the end of the season
                while pk[0] + ":" + side(m["name"]) in kept.get(yy, {}).get(owner, set()):
                    later += vor_table(yy).get(pk, 0.0)
                    yy += 1
            if now + later <= 0:
                continue
            pickups.append({"y": y, "d": got.isoformat(), "t": idx[m["team"]], "p": m["name"],
                            "via": "w" if m["from"] == "waivers" else "fa",
                            "days": (min(left, end) - got).days, "now": round(now, 1), "kept": round(later, 1),
                            "k": yy - y - 1})

    # By manager: every pickup's value, and his best one
    by = {}
    for p in pickups:
        o = seasons[p["y"]]["o"][p["t"]]
        r = by.setdefault(o, {"n": 0, "v": 0.0, "best": None})
        r["n"] += 1
        r["v"] += p["now"] + p["kept"]
        if not r["best"] or p["now"] + p["kept"] > r["best"]["now"] + r["best"]["kept"]:
            r["best"] = p
    pick_teams = {o: [r["n"], round(r["v"], 1), [r["best"]["p"], r["best"]["y"], round(r["best"]["now"] + r["best"]["kept"], 1)]]
                  for o, r in by.items()}
    allp = sorted(pickups, key=lambda p: -(p["now"] + p["kept"]))
    keep = {id(p) for p in allp[:TOP]}
    for y in {p["y"] for p in pickups}:  # each season's best ten too
        for p in [p for p in allp if p["y"] == y][:10]:
            keep.add(id(p))
    top = [p for p in allp if id(p) in keep]

    hist = {"sweeps": sorted(sweeps, key=lambda r: (r["y"], r["w"]), reverse=True),
            "near": sorted(near, key=lambda r: (r["y"], r["w"]), reverse=True),
            "rivals": rivals, "pickups": top, "pickTeams": pick_teams,
            "matchups": sum(sum(r["m"]) + sum(r["po"]) for r in rivals.values())}
    if data.get("history") == hist:
        print("No change.")
        return
    data["history"] = hist
    DATA.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(sweeps)} sweeps, {len(near)} near misses, {len(rivals)} rivalries, {len(pickups)} pickups with value "
          f"({len(top)} kept).")


if __name__ == "__main__":
    main()
