#!/usr/bin/env python3
"""Pull Yahoo's NBA player rankings into hardcap/yahoo.json for Hard Cap's Player Market and player cards.

Two lists from Yahoo Fantasy's public NBA player pool (no league needed):
  ar   Yahoo's actual rank, from this season's nine-category production
  or   Yahoo's overall (preseason) rank
Top 300 of each, keyed by the same name slugs the rest of the site uses.

Uses the same three YAHOO_ secrets as tools/guillotine_update.py. Run by .github/workflows/hardcap-stats.yml.
If Yahoo refuses or the secrets are missing, the existing file is left alone.
"""
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guillotine_update import Yahoo, access_token, text, NotApproved, Failure  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "hardcap", "yahoo.json")
DEPTH = 300


def slug(n):
    n = unicodedata.normalize("NFKD", n or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")


def ranked(y, sort):
    out = {}
    for start in range(0, DEPTH, 25):
        root = y.get(f"/game/nba/players;sort={sort};sort_type=season;start={start};count=25", soft=True)
        if root is None:
            break
        players = root.findall(".//player")
        if not players:
            break
        for i, p in enumerate(players):
            out.setdefault(slug(text(p, "name/full")), start + i + 1)
        if len(players) < 25:
            break
    return out


def main():
    try:
        y = Yahoo(access_token())
        ar, orank = ranked(y, "AR"), ranked(y, "OR")
    except (Failure, NotApproved) as e:
        print(f"Yahoo ranks skipped: {e or 'not approved'}")
        return
    if not ar and not orank:
        print("Yahoo returned no NBA rankings; leaving the file alone.")
        return
    players = {}
    for k, v in ar.items():
        players.setdefault(k, {})["ar"] = v
    for k, v in orank.items():
        players.setdefault(k, {})["or"] = v
    data = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "Yahoo Fantasy", "players": players}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(ar)} actual ranks, {len(orank)} overall ranks.")


if __name__ == "__main__":
    main()
