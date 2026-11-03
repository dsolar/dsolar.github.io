#!/usr/bin/env python3
"""One-off: which FantasyPros consensus pages exist for superflex, TE premium and basketball points leagues."""
import json
import re
import urllib.request

UA = "Mozilla/5.0 (compatible; davidsolar-draftlab/1.0; +https://davidsolar.dev/fantasy-kit/)"


def ecr(page):
    try:
        req = urllib.request.Request("https://www.fantasypros.com/" + page, headers={"User-Agent": UA, "Accept": "text/html"})
        with urllib.request.urlopen(req, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception as e:
        return f"FAILED {str(e)[:60]}"
    m = re.search(r"ecrData\s*=\s*(\{.*?\});", html, re.S)
    if not m:
        return "no ecrData"
    d = json.loads(m.group(1))
    ps = d.get("players", [])
    return f"{len(ps)} players; {d.get('ranking_type_name')} {d.get('scoring')} {d.get('position_id')}; top {[p.get('player_name') + ' ' + str(p.get('player_position_id')) for p in ps[:6]]}"


for page in ["nfl/rankings/ros-superflex.php", "nfl/rankings/ros-half-point-ppr-superflex.php", "nfl/rankings/ros-ppr-superflex.php", "nfl/rankings/ros-qb-flex.php",
             "nfl/rankings/superflex-cheatsheets.php", "nfl/rankings/half-point-ppr-superflex-cheatsheets.php", "nfl/rankings/ppr-superflex-cheatsheets.php",
             "nfl/rankings/ros-te-premium.php", "nfl/rankings/te-premium-cheatsheets.php", "nfl/rankings/dynasty-te-premium.php",
             "nfl/rankings/ros-half-point-ppr-te.php", "nba/rankings/ros-points.php", "nba/rankings/points.php", "nba/rankings/ros-overall-points.php",
             "nba/rankings/ros-overall.php?scoring=points", "nba/rankings/overall-points.php"]:
    print("FP", page, "->", ecr(page))
