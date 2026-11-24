#!/usr/bin/env python3
"""Split the NCAAB Hub's snapshot for the browser: cbb/data/hub-lite.json (everything but the players, about a sixth of
the download) draws the first screen, and cbb/data/players.json (rosters and stats) loads right after it.
cbb/data/hub.json stays whole for the build scripts that read it. Each team gets "stars": how many top-60 draft
prospects and Naismith Watch players it has, so Today's watchability sort is the same before the players arrive.
Run after everything that writes hub.json or extras.json (the last data step in cbb-hub.yml)."""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "cbb", "data")


def main():
    hub = json.load(open(os.path.join(D, "hub.json"), encoding="utf-8"))
    try:
        extras = json.load(open(os.path.join(D, "extras.json"), encoding="utf-8"))
    except (OSError, ValueError):
        extras = {}
    players = hub.get("players") or []
    nai = {str(r.get("id")) for r in ((extras.get("naismith") or {}).get("ladder") or [])}
    stars = {}
    for p in players:
        s = stars.setdefault(str(p.get("teamId")), {"pros": 0, "nai": 0})
        dr = p.get("draftRank")
        if isinstance(dr, (int, float)) and dr <= 60:
            s["pros"] += 1
        if str(p.get("id")) in nai:
            s["nai"] += 1
    lite = {k: v for k, v in hub.items() if k != "players"}
    lite["teams"] = [dict(t, stars=stars.get(str(t.get("id")), {"pros": 0, "nai": 0})) for t in hub.get("teams", [])]
    lite["playersFile"] = "players.json"
    put = lambda name, obj: json.dump(obj, open(os.path.join(D, name), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    put("hub-lite.json", lite)
    put("players.json", {"updated": hub.get("updated"), "players": players})
    print("hub-lite.json %d KB, players.json %d KB (%d players)" % (os.path.getsize(os.path.join(D, "hub-lite.json")) // 1024, os.path.getsize(os.path.join(D, "players.json")) // 1024, len(players)))


if __name__ == "__main__":
    main()
