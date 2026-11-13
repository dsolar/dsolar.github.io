#!/usr/bin/env python3
"""One-off probe of Yahoo endpoints for Wipe Yoenis (box scores and player ranks). Prints the player parts."""
import os, re, sys, xml.etree.ElementTree as ET
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guillotine_update import Yahoo, access_token  # noqa: E402

K = "469.l.30639"
y = Yahoo(token=access_token())
flat = lambda el, n: re.sub(r"\s+", " ", ET.tostring(el, encoding="unicode"))[:n]


def show(path, n=1800, players=2):
    r = y.get(path, soft=True)
    print(f"\n===== {path}")
    if r is None:
        print("None:", y.last_error); return None
    ts = r.findall(".//team")
    ps = r.findall(".//player")
    print(f"teams {len(ts)} players {len(ps)}")
    for p in ps[:players]:
        # drop the bulky headshot and eligible-position noise
        for tag in ("headshot", "image_url", "editorial_team_url", "is_undroppable", "uniform_number"):
            for e in p.findall(tag): p.remove(e)
        print(flat(p, n))
    return r


show(f"league/{K}/teams;team_keys={K}.t.1,{K}.t.2/roster;date=2026-06-10/players/stats;type=date;date=2026-06-10", 2500, 3)
show(f"league/{K}/players;sort=OR;sort_type=season;start=0;count=3", 1500, 3)
show(f"league/{K}/players;sort=AR;sort_type=season;start=0;count=3", 900, 3)
show(f"league/{K}/players;player_keys=469.p.10480/ranks", 2500)
show(f"league/{K}/players;player_keys=469.p.10480;out=ranks,draft_analysis,percent_owned", 3500)
show(f"league/{K}/players;sort=OR;sort_type=season;start=0;count=3;out=ranks", 2000, 1)
