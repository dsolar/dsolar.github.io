#!/usr/bin/env python3
"""Once each spring, save what the MLB Hub believed going into the season, so the next fall can check it:
mlb/data/archive/proj_<season>.json (each player's preseason projection: FanGraphs Depth Charts / Steamer WAR and
playing time) and mlb/data/archive/savant_<season - 1>.json (the Statcast numbers the "Lean on Statcast" setting reads).
That's the backtest the setting needs: does nudging the projections with last season's expected stats beat the
projections alone? Runs daily from the MLB hub job and only writes in the window before opening day, once a year.
"""
import json, os, shutil, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCH = os.path.join(ROOT, "mlb", "data", "archive")


def main():
    today = datetime.date.today()
    hub = json.load(open(os.path.join(ROOT, "mlb", "data", "hub.json")))
    season = int(hub.get("season") or today.year)
    # the week or so before opening day (late March): projections are set, no games have counted yet
    if not (today.year == season and (today.month, today.day) >= (3, 15) and (today.month, today.day) <= (3, 31)):
        print(f"Not the preseason window for {season}; nothing to save.")
        return
    os.makedirs(ARCH, exist_ok=True)
    proj = os.path.join(ARCH, f"proj_{season}.json")
    if not os.path.exists(proj):
        players = {}
        for p in hub.get("players", []):
            pj = p.get("pj") or {}
            if not isinstance(p.get("id"), int) or pj.get("war") is None:
                continue
            players[str(p["id"])] = [p.get("n"), p.get("t"), 1 if p.get("p") else 0, pj.get("war"), pj.get("pa") if not p.get("p") else pj.get("ip"), p.get("pjs")]
        json.dump({"season": season, "saved": today.isoformat(), "source": "FanGraphs Depth Charts / Steamer via the MLB hub",
                   "cols": ["name", "team", "pitcher", "war", "pa_or_ip", "source"], "players": players},
                  open(proj, "w"), separators=(",", ":"))
        print(f"saved {proj}: {len(players)} players")
    sv_src = os.path.join(ROOT, "mlb", "data", "savant.json")
    sv = json.load(open(sv_src)) if os.path.exists(sv_src) else {}
    if sv.get("season") == season - 1:
        dst = os.path.join(ARCH, f"savant_{season - 1}.json")
        if not os.path.exists(dst):
            shutil.copyfile(sv_src, dst)
            print(f"saved {dst}")


if __name__ == "__main__":
    main()
