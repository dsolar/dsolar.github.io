#!/usr/bin/env python3
"""NBA player tracking for the NBA Hub and Draft Lab: reads the latest drop that tools/nba_tracking_pull.js left in
Supabase (stats.nba.com refuses cloud servers, so the pull runs in a browser on nba.com), checks it, adds
percentiles and writes nba/data/tracking.json:

  {season, pulled, built, cols, qual, p: {nbaId: {n, t, gp, min, x: [...cols], pct: {col: 0-100}}}, dl: {draftLabId: nbaId}}

Percentiles rank players with at least QUAL_MIN minutes a game over QUAL_GP games (others still get their numbers,
ranked against that group), flipped where lower is better and left out for style numbers with no good direction.
dl maps Draft Lab's NBA player ids (name slugs) to NBA ids by name, for the shared player card.
If the drop is missing, stale for the season, or fails the checks, the last good file stays.
"""
import json, os, re, sys, unicodedata, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "nba", "data", "tracking.json")
RPC = "https://baxrczyufqbzrogftmyn.supabase.co/rest/v1/rpc/nba_tracking_get"
KEY = "sb_publishable_brDXGevzcoI7mBaPO7Plow_yaUy4gk4"  # the site's public key (fantasy-kit/cloud.js)
QUAL_MIN, QUAL_GP = 10.0, 5
# percentile direction: -1 lower is better, 0 no percentile (style, not quality); everything else higher is better
DIRECTION = {"rim_fg": -1, "drv_tov": -1, "sec_tch": 0, "drib_tch": 0, "dist_o": 0, "dist_d": 0, "spd_o": 0, "spd_d": 0, "top": 0}
# a rate only ranks players with enough of what it's a rate of, over the season so far (the per-game number times
# games): [volume column, season total]
VOLUME = {"cs3": ["cs3a", 25], "cs_efg": ["cs3a", 25], "pu3": ["pu_fga", 35], "pu_efg": ["pu_fga", 35], "drv_fg": ["drv", 40], "rim_fg": ["rim_fga", 40], "reb_chp": ["reb_ch", 50], "reb_con": ["reb_ch", 50]}
# each column's believable range, to catch a broken pull before it's published
RANGE = {"dist": (0, 4), "spd": (2, 6.5), "drv": (0, 35), "rim_fg": (0, 1), "cs3": (0, 1), "pu3": (0, 1), "tch": (0, 120), "defl": (0, 8), "contest": (0, 25)}


def fetch():
    req = urllib.request.Request(RPC, data=b"{}", method="POST", headers={"apikey": KEY, "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def norm(name):
    s = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s)
    return re.sub(r"[^a-z]", "", s)


def pct_rank(sorted_vals, v):
    n = len(sorted_vals)
    if n < 2:
        return None
    lo = sum(1 for w in sorted_vals if w < v)
    eq = sum(1 for w in sorted_vals if w == v)
    return (lo + (eq - 1) / 2) / (n - 1)


def main():
    try:
        got = fetch()
    except Exception as e:
        sys.exit(f"couldn't read the drop: {e}")
    if not got or not got.get("body"):
        sys.exit("no drop yet")
    b = got["body"]
    cols, raw = b.get("cols") or [], b.get("p") or {}
    if len(raw) < 300:
        sys.exit(f"only {len(raw)} players in the drop; keeping the last file")
    # the numbers have to look like basketball
    for c, (lo, hi) in RANGE.items():
        if c not in cols:
            continue
        i = 4 + cols.index(c)
        vals = [r[i] for r in raw.values() if r[i] is not None]
        bad = [v for v in vals if not (lo <= v <= hi)]
        if vals and len(bad) > 0.02 * len(vals):
            sys.exit(f"{c}: {len(bad)} values outside {lo}-{hi}; keeping the last file")
    # they have to be the league's players: most should be on the hub's rosters
    hub = json.load(open(os.path.join(ROOT, "nba", "data", "ratings.json")))
    hub_ids = {str(p.get("nba")) for p in hub.get("players", []) if p.get("nba")}
    overlap = sum(1 for k in raw if k in hub_ids)
    if hub_ids and overlap < 0.6 * min(len(hub_ids), len(raw)):
        sys.exit(f"only {overlap} drop players are on the hub's rosters; keeping the last file")

    players = {}
    for pid, r in raw.items():
        players[pid] = {"n": r[0], "t": r[1], "gp": r[2], "min": r[3], "x": r[4:4 + len(cols)]}
    qual = [p for p in players.values() if (p["gp"] or 0) >= QUAL_GP and (p["min"] or 0) >= QUAL_MIN]
    def enough(p, c):
        if c not in VOLUME or VOLUME[c][0] not in cols:
            return True
        vol = p["x"][cols.index(VOLUME[c][0])]
        return vol is not None and vol * (p["gp"] or 0) >= VOLUME[c][1]

    for i, c in enumerate(cols):
        d = DIRECTION.get(c, 1)
        if not d:
            continue
        pool = sorted(p["x"][i] for p in qual if p["x"][i] is not None and enough(p, c))
        for p in players.values():
            v = p["x"][i]
            if v is None or not enough(p, c):
                continue
            r = pct_rank(pool, v)
            if r is not None:
                p.setdefault("pct", {})[c] = round(100 * (r if d > 0 else 1 - r))

    # Draft Lab's NBA ids are name slugs: match on name, then name and team when two players share one
    dl = {}
    try:
        lab = json.load(open(os.path.join(ROOT, "fantasy-kit", "data", "nba.json")))
        by = {}
        for pid, p in players.items():
            by.setdefault(norm(p["n"]), []).append((pid, p["t"]))
        for q in lab.get("players", []):
            hits = by.get(norm(q.get("n")), [])
            if len(hits) > 1:
                hits = [h for h in hits if h[1] == q.get("t")] or hits[:1]
            if hits:
                dl[q["id"]] = hits[0][0]
    except Exception as e:
        print(f"Draft Lab ids: {e}", file=sys.stderr)

    out = {"season": b.get("season"), "pulled": b.get("pulled"), "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
           "failed": b.get("failed") or [], "cols": cols, "vol": {k: v for k, v in VOLUME.items() if k in cols}, "qual": {"min": QUAL_MIN, "gp": QUAL_GP, "n": len(qual)}, "p": players, "dl": dl}
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {OUT}: {len(players)} players ({len(qual)} qualified), {len(dl)} Draft Lab matches, pulled {b.get('pulled')}")


if __name__ == "__main__":
    main()
