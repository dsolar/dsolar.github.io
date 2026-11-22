#!/usr/bin/env python3
"""Grades the CBB and CFB hubs' "value watch" signals against the market, all season, and writes <hub>/data/value.json.

Inputs: the hub's logged pregame lines (extras.json -> lines.games: spread = predicted home margin, total), the closing
and opening book lines plus share of bets (lines_hist.json, from betting_pull.py / betting_backfill.py) and final scores.
Everything is graded against the CLOSING line, the market's sharpest number, so a signal that shows a winning record
here has beaten the hardest version of the market.

Signals (the hub pages use the same definitions, in betSignals() in each app.js):
  s1  hub disagrees: the hub's margin differs from the book's by HUB_EDGE+ points; take the hub's side
  s2  ...and against the public: fewer than PUBLIC_MAX% of spread bets are on the hub's side
  s3  ...and the line moved from the open toward the hub's number
  t1  hub total differs from the book total by TOTAL_EDGE+ points; take the hub's side of the total
  pub the side with 70%+ of spread bets (context: how the heavy public side does)
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HUB_EDGE, PUBLIC_MAX, TOTAL_EDGE = 3.0, 40, 4.0
T1_SINCE = {"cfb": "2026-11-23"}   # CFB totals were recalibrated (tools/cfb_extras.py calibrate_totals); grade only the new ones


def finals(hub):
    F = {}
    if hub == "cbb":
        try:
            for g in json.loads((ROOT / "cbb/data/schedule.json").read_text())["games"]:
                if g.get("state") == "post" and g.get("hs") is not None: F[g["id"]] = (g["hs"], g["as"])
        except Exception:
            pass
        for g in json.loads((ROOT / "cbb/data/hub.json").read_text())["games"]:
            if g.get("state") == "post" and g.get("homeScore") is not None: F[g["id"]] = (g["homeScore"], g["awayScore"])
    else:
        for g in json.loads((ROOT / "cfb/data/hub.json").read_text())["games"]:
            if g.get("state") == "post" and g.get("hs") is not None: F[g["id"]] = (g["hs"], g["as"])
    return F


def grade(hub):
    logged = json.loads((ROOT / hub / "data/extras.json").read_text())["lines"]["games"]
    hist = json.loads((ROOT / hub / "data/lines_hist.json").read_text())
    F = finals(hub)
    rec = {k: [0, 0, 0] for k in ("all", "s1", "s2", "s3", "t1", "pub")}
    since = None

    def add(k, r):
        rec[k][0 if r > 0 else 1 if r < 0 else 2] += 1

    seen = set()
    for gid, h in hist.items():                       # the heavy public side, over every game with a split
        if gid not in F or h["c"][0] is None or h.get("bp") is None or max(h["bp"], 100 - h["bp"]) < 70:
            continue
        hs, as_ = F[gid]; sig = (hs, as_, abs(h["c"][0]))
        if sig in seen: continue
        seen.add(sig)
        cov = hs - as_ + h["c"][0]
        add("pub", 0 if cov == 0 else (1 if (cov > 0) == (h["bp"] > 50) else -1))
    for gid, l in logged.items():
        h, f = hist.get(gid), F.get(gid) or (tuple(l["final"]) if l.get("final") else None)
        if not h or not f or h["c"][0] is None or l.get("spread") is None:
            continue
        since = min(since or l.get("day", "9999"), l.get("day", "9999"))
        hub_m, close = l["spread"], h["c"][0]
        edge = hub_m + close                           # hub margin minus the book's margin (book margin = -close)
        margin = f[0] - f[1]
        cov = margin + close
        side = 1 if edge > 0 else -1
        r = 0 if cov == 0 or edge == 0 else (1 if (cov > 0) == (side == 1) else -1)
        add("all", r)
        if abs(edge) >= HUB_EDGE:
            add("s1", r)
            pct = None if h.get("bp") is None else (h["bp"] if side == 1 else 100 - h["bp"])
            if pct is not None and pct < PUBLIC_MAX:
                add("s2", r)
                o = (h.get("o") or [None])[0]
                if o is not None and o != close and abs(hub_m + close) < abs(hub_m + o):
                    add("s3", r)
        t, ht = h["c"][1], l.get("total")
        if l.get("day", "") < T1_SINCE.get(hub, ""):
            t = None
        if t is not None and ht is not None and abs(ht - t) >= TOTAL_EDGE:
            tt = f[0] + f[1] - t
            add("t1", 0 if tt == 0 else (1 if (tt > 0) == (ht > t) else -1))
    return {"since": since, "t1Since": T1_SINCE.get(hub), "rules": {"hubEdge": HUB_EDGE, "publicMax": PUBLIC_MAX, "totalEdge": TOTAL_EDGE}, "records": rec}


def main():
    for hub in ("cbb", "cfb"):
        try:
            out = grade(hub)
        except Exception as e:
            print(hub, "skipped:", e); continue
        p = ROOT / hub / "data/value.json"
        old = None
        try:
            old = json.loads(p.read_text())
        except Exception:
            pass
        if not old or old.get("records") != out["records"]:
            p.write_text(json.dumps(out, separators=(",", ":")))
        print(hub, json.dumps(out["records"]))


if __name__ == "__main__":
    main()
