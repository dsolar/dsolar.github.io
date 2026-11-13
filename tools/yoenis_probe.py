#!/usr/bin/env python3
"""One-off probe of Yahoo endpoints for Wipe Yoenis (box scores and player ranks). Prints trimmed XML."""
import os, re, sys, xml.etree.ElementTree as ET
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guillotine_update import Yahoo, access_token  # noqa: E402

K = "469.l.30639"
y = Yahoo(token=access_token())


def show(path, n=2500):
    r = y.get(path, soft=True)
    print(f"\n===== {path}\n" + ("None: " + str(y.last_error) if r is None else re.sub(r"\s+", " ", ET.tostring(r, encoding="unicode"))[:n]))
    return r


show(f"league/{K}/teams;team_keys={K}.t.1,{K}.t.2/roster;date=2026-06-10/players/stats;type=date;date=2026-06-10", 4000)
show(f"team/{K}.t.1/roster;date=2026-06-10/players/stats;type=date;date=2026-06-10", 3000)
show(f"team/{K}.t.1/roster;date=2026-06-10", 1500)
show(f"league/{K}/players;player_keys=469.p.10480,469.p.10918/stats;type=date;date=2026-06-10", 2500)
show(f"league/{K}/players;sort=OR;sort_type=season;start=0;count=5", 2500)
show(f"league/{K}/players;sort=AR;sort_type=season;start=0;count=5", 1500)
show(f"league/{K}/players;player_keys=469.p.10480/ranks", 1500)
show(f"league/{K}/players;player_keys=469.p.10480/draft_analysis", 1500)
show(f"league/{K}/players;player_keys=469.p.10480/percent_owned", 1500)
show(f"league/{K}/players;player_keys=469.p.10480;out=ranks,draft_analysis,percent_owned", 3000)
