#!/usr/bin/env python3
"""On-field player ratings for the NFL Hub, into nfl/data/rating.json.

Football's version of basketball's RAPM: every run and pass play's EPA (expected points added, nflverse's play-by-play)
explained by the 22 players on the field (nflverse's participation data). Each offensive player gets a coefficient for
how much more EPA his offense gains with him on the field, each defender one for how much less the other side gains,
fit together so a lineman isn't credited for his quarterback or a corner for his pass rush. Ridge regression pulls
everyone toward zero, hardest for players with few snaps; the strength of that pull is picked by how well it predicts
plays it wasn't fit on.

Seasons: the two most recent with participation data (the 2026 file isn't published until the season ends), the older
one counted half. Garbage time (win probability under 5% or over 95%) is left out.

Usage: python3 tools/nfl_rating.py [--cache DIR]
Needs numpy, scipy and pyarrow.
"""

import io
import json
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
from scipy import sparse
from scipy.sparse.linalg import cg

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "nfl" / "data" / "rating.json"
BASE = "https://github.com/nflverse/nflverse-data/releases/download/"
UA = "davidsolar-nflhub/1.0 (+https://davidsolar.dev/nfl/)"
CACHE = Path(sys.argv[sys.argv.index("--cache") + 1]) if "--cache" in sys.argv else None
SEASONS = {2025: 1.0, 2024: 0.5}


def fetch(path):
    name = path.split("/")[-1]
    if CACHE and (CACHE / name).exists():
        return (CACHE / name).read_bytes()
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def load_season(season, weight):
    pbp = pq.read_table(io.BytesIO(fetch(f"pbp/play_by_play_{season}.parquet")),
                        columns=["game_id", "play_id", "play_type", "epa", "wp"]).to_pylist()
    epa = {}
    for r in pbp:
        if r["play_type"] in ("pass", "run") and r["epa"] is not None and r["wp"] is not None and 0.05 <= r["wp"] <= 0.95:
            epa[(r["game_id"], int(r["play_id"]))] = max(-6.0, min(6.0, r["epa"]))
    part = pq.read_table(io.BytesIO(fetch(f"pbp_participation/pbp_participation_{season}.parquet")),
                         columns=["nflverse_game_id", "play_id", "offense_players", "defense_players", "offense_positions", "defense_positions"]).to_pylist()
    rows = []
    for r in part:
        k = (r["nflverse_game_id"], int(r["play_id"] or 0))
        if k not in epa or not r["offense_players"] or not r["defense_players"]:
            continue
        o = [x for x in r["offense_players"].split(";") if x]
        d = [x for x in r["defense_players"].split(";") if x]
        if len(o) < 9 or len(d) < 9:
            continue
        op = (r["offense_positions"] or "").split(";")
        dp = (r["defense_positions"] or "").split(";")
        rows.append((epa[k], weight, o, d, op if len(op) == len(o) else [], dp if len(dp) == len(d) else []))
    print(f"{season}: {len(rows)} plays")
    return rows


def main():
    rows = []
    for s, w in SEASONS.items():
        rows += load_season(s, w)
    # columns: one per player per side
    col, pos = {}, defaultdict(Counter)
    def cid(key):
        if key not in col:
            col[key] = len(col)
        return col[key]
    I, J, V, y, wts = [], [], [], [], []
    plays = defaultdict(float)
    for i, (e, w, o, d, op, dp) in enumerate(rows):
        for k, p in enumerate(o):
            I.append(i); J.append(cid(("O", p))); V.append(1.0); plays[("O", p)] += w
            if op: pos[p][op[k]] += 1
        for k, p in enumerate(d):
            I.append(i); J.append(cid(("D", p))); V.append(-1.0); plays[("D", p)] += w
            if dp: pos[p][dp[k]] += 1
        y.append(e); wts.append(w)
    n, m = len(rows), len(col)
    X = sparse.csr_matrix((V, (I, J)), shape=(n, m))
    y = np.array(y); wts = np.array(wts)
    mu = np.average(y, weights=wts)
    yc = y - mu

    def fit(idx, lam):
        Xs, ws, ys = X[idx], wts[idx], yc[idx]
        WX = Xs.multiply(ws[:, None]).tocsr()
        A = (Xs.T @ WX) + lam * sparse.identity(m)
        b = WX.T @ ys
        beta, _ = cg(A, b, maxiter=2000)
        return beta

    # pick the ridge penalty on held-out plays (every fifth play)
    rng = np.random.default_rng(7)
    hold = rng.random(n) < 0.2
    tr, te = np.where(~hold)[0], np.where(hold)[0]
    best = None
    for lam in (300, 800, 2000, 5000):
        beta = fit(tr, lam)
        pred = X[te] @ beta
        err = np.average((yc[te] - pred) ** 2, weights=wts[te])
        base = np.average(yc[te] ** 2, weights=wts[te])
        gain = 1 - err / base
        print(f"lambda {lam}: held-out R2 {gain:.4f}")
        if best is None or gain > best[1]:
            best = (lam, gain)
    lam = best[0]
    beta = fit(np.arange(n), lam)

    out = {}
    for (side, p), j in col.items():
        o = out.setdefault(p, [0.0, 0.0, 0, 0, None])
        if side == "O":
            o[0] = round(float(beta[j]) * 100, 2); o[2] = int(round(plays[(side, p)]))
        else:
            o[1] = round(float(beta[j]) * 100, 2); o[3] = int(round(plays[(side, p)]))
    for p, c in pos.items():
        if p in out:
            out[p][4] = c.most_common(1)[0][0]
    OUT.write_text(json.dumps({
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "seasons": {str(k): v for k, v in SEASONS.items()}, "lambda": lam, "heldOutR2": round(best[1], 4), "plays": n,
        "cols": ["off EPA per 100 plays", "def EPA saved per 100 plays", "off plays (weighted)", "def plays (weighted)", "position"],
        "p": out,
    }, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"rating.json: {len(out)} players, lambda {lam}")


if __name__ == "__main__":
    main()
