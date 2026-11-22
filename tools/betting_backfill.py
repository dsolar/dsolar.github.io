#!/usr/bin/env python3
"""One-time backfill of lines_hist.json for games already played this season (run by hand from Actions).
Pulls Action Network's closing consensus, opener and share of bets for every past CBB date since opening night and
every past CFB week, matches them to the hubs' ESPN game ids, and merges them into <hub>/data/lines_hist.json.
Money percentages are never read (see betting_pull.py)."""
import json
from datetime import datetime, timedelta
import betting_pull as bp

today = bp.now.astimezone(bp.ET).date()


def merge(hub, matched):
    p = bp.ROOT / hub / "data/lines_hist.json"
    try:
        hist = json.loads(p.read_text())
    except Exception:
        hist = {}
    added = 0
    for gid, v in matched.items():
        if "an" in v and v["an"].get("sp") and gid not in hist:
            hist[gid] = bp.row(v["an"]); added += 1
    p.write_text(json.dumps(hist, separators=(",", ":"), sort_keys=True))
    return added, len(hist)


# CBB: every date from opening night through yesterday
d0 = datetime(2026, 11, 2).date()
dates = [(d0 + timedelta(days=i)).strftime("%Y%m%d") for i in range((today - d0).days)]
an = bp.an_pull("ncaab", ["division=D1&date=" + d for d in dates])
m, n = bp.match_college("cbb", an, [], lo="2026-11-01", hi=today.strftime("%Y-%m-%d"))
print("cbb: AN %d past games with splits, matched %d; added %d, file has %d" % ((len(an), len(m)) + merge("cbb", m)))

# CFB: every regular-season week so far (Action Network numbers weeks from 0)
an = bp.an_pull("ncaaf", ["division=FBS&seasonType=reg&week=%d" % w for w in range(0, 16)])
m, n = bp.match_college("cfb", an, [], lo="2026-08-20", hi=today.strftime("%Y-%m-%d"))
print("cfb: AN %d games with splits, matched %d; added %d, file has %d" % ((len(an), len(m)) + merge("cfb", m)))
print("\n".join(bp.log))
