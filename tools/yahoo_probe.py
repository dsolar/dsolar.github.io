#!/usr/bin/env python3
"""Try Yahoo API calls and save what each returns (tag names and a few sample values) to tools/yahoo_probe.json.

For working out undocumented calls before building on them. Run by the "Yahoo probe" workflow.
Edit PROBES to try different calls. Saves structure only: tag paths, counts and short sample values.
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guillotine_update import Yahoo, access_token  # noqa: E402

NFL = "470.l.157731"
MLB = "469.l.30639"
PROBES = {
    "nfl roster stats week": f"team/{NFL}.t.1/roster;week=8/players/stats;type=week;week=8",
    "nfl roster projected_week": f"team/{NFL}.t.1/roster;week=8/players/stats;type=projected_week;week=8",
    "nfl roster week is_projected": f"team/{NFL}.t.1/roster;week=8/players/stats;type=week;week=8;is_projected=1",
    "nfl players projected_week": f"league/{NFL}/players;player_keys=470.p.33987/stats;type=projected_week;week=8",
    "nfl players week stats": f"league/{NFL}/players;player_keys=470.p.33987/stats;type=week;week=8",
    "nfl team players projected": f"team/{NFL}.t.1/players/stats;type=projected_week;week=8",
    "nfl scoreboard": f"league/{NFL}/scoreboard;week=8",
    "mlb settings": f"league/{MLB}/settings",
    "mlb standings": f"league/{MLB}/standings",
    "mlb team stats week 10": f"team/{MLB}.t.1/stats;type=week;week=10",
    "mlb team stats date": f"team/{MLB}.t.1/stats;type=date;date=2026-06-15",
    "mlb league teams stats week 10": f"league/{MLB}/teams/stats;type=week;week=10",
    "mlb scoreboard week 10": f"league/{MLB}/scoreboard;week=10",
}


def walk(el, path, out, depth=0):
    p = f"{path}/{el.tag}"
    rec = out.setdefault(p, {"n": 0, "sample": []})
    rec["n"] += 1
    t = (el.text or "").strip()
    if t and len(rec["sample"]) < 3:
        rec["sample"].append(t[:40])
    for c in el:
        walk(c, p, out, depth + 1)


def main():
    y = Yahoo(token=access_token())
    r = y.get(f"team/{NFL}.t.1/roster;week=8")
    pk = r.find(".//player/player_key").text
    for name in list(PROBES):
        PROBES[name] = PROBES[name].replace("470.p.33987", pk)
    res = {"checked": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    for name, path in PROBES.items():
        y.last_error = None
        root = y.get(path, soft=True)
        if root is None:
            res[name] = {"path": path, "ok": False, "error": (y.last_error or "")[:200]}
            continue
        tags = {}
        walk(root, "", tags)
        # Drop personal fields
        tags = {k: v for k, v in tags.items() if not any(x in k for x in ("email", "guid", "image_url", "nickname", "manager"))}
        res[name] = {"path": path, "ok": True, "tags": tags}
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "yahoo_probe.json")
    json.dump(res, open(out, "w"), indent=1)
    print("Wrote", out)


if __name__ == "__main__":
    main()
