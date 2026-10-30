#!/usr/bin/env python3
"""Build sweeps, rivalries and the waiver wire hall of fame for yoenis/data.json.

Reads tools/yahoo_yoenis/history/<year>.json (tools/yoenis_history_pull.py) and tools/yahoo_yoenis/trades.json.
  sweeps     every matchup one side won in every category (16-0), plus the 15-1 and 15-0-1 near misses, with
             both sides' category totals and the week's dates
  best       the best single weeks in each category: the top ten team-weeks ever, with how many days the
             week ran (Yahoo's first week and the All-Star week run long). Averages need 150 at-bats and ERA
             and WHIP 40 innings; losses are left out.
  rivals     every pair of managers' all-time head-to-head: matchups won, lost and tied, and categories,
             with playoff meetings counted separately. By manager, so team renames don't split a rivalry.
  pickups    every free-agent or waiver pickup from Opening Day on, valued like the trade history: what he
             actually did for that team from the day after the pickup until he was dropped or traded (his MLB
             game logs, tools/yahoo_yoenis/slices), plus, if he was still there at season's end, each later
             season that manager kept him, less what that keeper round was expected to produce.
Writes data["history"] = {"sweeps": [...], "near": [...], "rivals": {...}, "pickups": [...top...], "pickTeams": {...},
                          "cats": [abbr, ...], "best": {abbr: [[year, week, team index, value, days, playoffs], ...]},
                          "best7": the same, counting only regular seven-day weeks}.

  python3 tools/yoenis_history_build.py
"""
import glob
import json
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from yoenis_tenure import windows  # noqa: E402
from yoenis_trades_build import window_now, slices  # noqa: E402
from yoenis_value import kept_map, kept_surplus  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "yoenis" / "data.json"
HIST = ROOT / "tools" / "yahoo_yoenis" / "history"
TRADES = ROOT / "tools" / "yahoo_yoenis" / "trades.json"
EASTERN = ZoneInfo("America/New_York")
TOP = 60  # pickups kept on the page: the best ever, plus each season's best
BEST = 10  # team-weeks kept per category
MIN_AB, MIN_IP = 150, 40  # to count for a best week in average/OPS, and in ERA/WHIP
RATE_B, RATE_P = ("AVG", "OPS"), ("ERA", "WHIP")


def innings(ip):
    """Yahoo's 59.1 means 59 and a third"""
    try:
        whole, _, frac = str(ip).partition(".")
        return int(whole) + int(frac or 0) / 3
    except ValueError:
        return 0.0


def at_bats(hab):
    try:
        return int(str(hab).split("/")[1])
    except (IndexError, ValueError):
        return 0


def day(ts):
    return datetime.fromtimestamp(ts, EASTERN).date()


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    seasons = {s["year"]: s for s in data["seasons"]}
    kept2 = kept_map(data)
    sweeps, near, rivals, pickups = [], [], {}, []
    cats, weekly = [], []
    for f in sorted(glob.glob(str(HIST / "*.json"))):
        h = json.load(open(f, encoding="utf-8"))
        y = h["season"]
        s = seasons.get(y)
        if not s:
            continue
        idx = {k: s["teams"].index(n) for k, n in h["teams"].items() if n in s["teams"]}
        n = len(h["cats"])
        abbrs = [c["abbr"] for c in h["cats"]]
        cats = cats or abbrs

        # Matchups: sweeps, near misses, rivalries
        for w in h["weeks"]:
            days = (date.fromisoformat(w["e"]) - date.fromisoformat(w["s"])).days + 1 if w.get("s") and w.get("e") else None
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
                st = mu.get("stats") or {}
                if hi in st and lo in st:
                    row["st"] = [st[hi], st[lo]]
                if w.get("s"):
                    row["dt"] = [w["s"], w["e"]]
                row["wn"] = "".join("a" if x == hi else "b" if x == lo else "t" for x in mu["won"])  # each category's winner
                xs = mu.get("x") or {}
                if hi in xs and lo in xs:
                    row["ip"] = [innings(xs[hi].get("IP")), innings(xs[lo].get("IP"))]
                # Every team-week, for the best single weeks
                for tk in (A, B):
                    vals, x = st.get(tk), (mu.get("x") or {}).get(tk) or {}
                    if not vals:
                        continue
                    ab, ip = at_bats(x.get("H/AB")), innings(x.get("IP"))
                    if not ab and "H" in abbrs and "AVG" in abbrs:  # no H/AB from Yahoo: hits over average
                        hh, avg = vals[abbrs.index("H")], vals[abbrs.index("AVG")]
                        ab = round(hh / avg) if isinstance(hh, (int, float)) and isinstance(avg, (int, float)) and avg > 0 else 0
                    for ci, ab_ in enumerate(abbrs):
                        v = vals[ci]
                        if not isinstance(v, (int, float)) or ab_ == "L":
                            continue
                        if (ab_ in RATE_B and ab < MIN_AB) or (ab_ in RATE_P and ip < MIN_IP):
                            continue
                        weekly.append((ab_, v, y, w["week"], idx[tk], days, 1 if mu["playoffs"] and not mu["consolation"] else 0))
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

        # Pickups from Opening Day on: what each did while he stayed, and any keeper surplus after
        if not (h.get("start") and h.get("end")):
            continue
        season_days = (date.fromisoformat(h["end"]) - date.fromisoformat(h["start"])).days + 1
        sl = slices(y)
        for w in windows(y):
            if w["kind"] != "add" or w["team"] not in idx:
                continue
            m = h["moves"][w["ref"]]
            now, est = window_now(y, w, sl, season_days)
            owner = s["o"][idx[w["team"]]]
            later, n, pr, _ = kept_surplus(y, owner, m["name"], m["pos"], kept2) if w["stays"] else (0.0, 0, 0, [])
            if now + later <= 0:
                continue
            row = {"y": y, "d": day(m["ts"]).isoformat(), "t": idx[w["team"]], "p": m["name"],
                   "via": "w" if m["from"] == "waivers" else "fa",
                   "days": max((w["end"] - w["start"]).days + 1, 0), "now": round(now, 1), "kept": round(later, 1), "k": n}
            if pr:
                row["pk"] = pr  # seasons of that keeper value that are projected
            if est:
                row["est"] = True
            pickups.append(row)

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

    best, best7 = {}, {}
    low = {c["abbr"]: c["low"] for c in json.load(open(sorted(glob.glob(str(HIST / "*.json")))[-1], encoding="utf-8"))["cats"]}
    for ab_ in cats:
        rows = [r for r in weekly if r[0] == ab_]
        if not rows:
            continue
        rows.sort(key=lambda r: (r[1] if low.get(ab_) else -r[1], r[2], r[3]))
        best[ab_] = [[r[2], r[3], r[4], r[1], r[5], r[6]] for r in rows[:BEST]]
        best7[ab_] = [[r[2], r[3], r[4], r[1], r[5], r[6]] for r in rows if r[5] and r[5] <= 7][:BEST]

    hist = {"sweeps": sorted(sweeps, key=lambda r: (r["y"], r["w"]), reverse=True),
            "near": sorted(near, key=lambda r: (r["y"], r["w"]), reverse=True),
            "rivals": rivals, "pickups": top, "pickTeams": pick_teams, "cats": cats, "best": best, "best7": best7,
            "matchups": sum(sum(r["m"]) + sum(r["po"]) for r in rivals.values())}
    if data.get("history") == hist:
        print("No change.")
        return
    data["history"] = hist
    data["updated"] = date.today().isoformat()  # the page footer's "Updated" date
    DATA.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(sweeps)} sweeps, {len(near)} near misses, {len(rivals)} rivalries, {len(pickups)} pickups with value "
          f"({len(top)} kept).")


if __name__ == "__main__":
    main()
