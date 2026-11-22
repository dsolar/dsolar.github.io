#!/usr/bin/env python3
"""Card-sized copies of the tracking files, for Draft Lab's player cards and rankings column (fantasy-kit/ui.js).

The hubs read the full files; a Draft Lab card shows a handful of numbers, so it reads these instead:
  mlb/data/savant_card.json    from mlb/data/savant.json   (expected stats, a few percentiles, EV, bat speed, sprint)
  nhl/data/edge_card.json      from nhl/data/edge.json     (top speed, bursts, shot speed, zone time, saves)
  nba/data/tracking_card.json  from nba/data/tracking.json (the columns the card shows, and the Draft Lab id map)
Same shapes as the full files, minus everything the card doesn't read, so ui.js reads either. NFL's file is small
already. Run after a pull with that sport's name (no name builds all three); a missing source file is skipped.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(path):
    try:
        return json.load(open(os.path.join(ROOT, path)))
    except Exception:
        return None


def save(path, obj, src):
    full = os.path.join(ROOT, path)
    json.dump(obj, open(full, "w"), separators=(",", ":"))
    print(f"{path}: {os.path.getsize(full) // 1024} KB (from {os.path.getsize(os.path.join(ROOT, src)) // 1024} KB)")


def pick(d, keys):
    return {k: d[k] for k in keys if k in d and d[k] is not None}


def mlb():
    j = load("mlb/data/savant.json")
    if not j:
        return
    BP = ["xwoba", "xba", "brl_percent", "exit_velocity", "bat_speed", "sprint_speed"]
    PP = ["xera", "k_percent", "whiff_percent", "brl_percent", "fb_velocity"]
    bat = {}
    for i, d in (j.get("bat") or {}).items():
        o = {}
        if d.get("x"): o["x"] = d["x"][:7]
        if d.get("pct"): o["pct"] = pick(d["pct"], BP)
        if d.get("ev"): o["ev"] = [d["ev"][0], None, None, d["ev"][3]] if len(d["ev"]) > 3 else d["ev"]
        if d.get("bt"): o["bt"] = d["bt"][:1]
        if d.get("spd"): o["spd"] = d["spd"][:1]
        if o: bat[i] = o
    pit = {}
    for i, d in (j.get("pit") or {}).items():
        o = {}
        if d.get("x"): o["x"] = d["x"][:9]
        if d.get("pct"): o["pct"] = pick(d["pct"], PP)
        if o: pit[i] = o
    save("mlb/data/savant_card.json", {"season": j.get("season"), "pulled": j.get("pulled"), "bat": bat, "pit": pit}, "mlb/data/savant.json")


def nhl():
    j = load("nhl/data/edge.json")
    if not j:
        return
    SK = ["speedMax", "burstsOver20", "topShotSpeed", "offensiveZonePctg", "sog.high.shots"]
    G = ["all.savePctg", "high.savePctg", "goalsAgainstAvg", "gamesAbove900"]
    save("nhl/data/edge_card.json", {"season": j.get("season"), "pulled": j.get("pulled"),
                                     "sk": {i: pick(d, SK) for i, d in (j.get("sk") or {}).items()},
                                     "g": {i: pick(d, G) for i, d in (j.get("g") or {}).items()}}, "nhl/data/edge.json")


def nba():
    j = load("nba/data/tracking.json")
    if not j:
        return
    keep = [c for c in ["drv", "tch", "pot_ast", "cs3", "defl", "contest", "dist"] if c in j.get("cols", [])]
    ix = [j["cols"].index(c) for c in keep]
    p = {}
    for i, d in (j.get("p") or {}).items():
        p[i] = {"x": [d["x"][k] for k in ix], "pct": pick(d.get("pct") or {}, keep)}
    save("nba/data/tracking_card.json", {"season": j.get("season"), "pulled": j.get("pulled"), "cols": keep, "p": p, "dl": j.get("dl") or {}}, "nba/data/tracking.json")


if __name__ == "__main__":
    import sys
    want = sys.argv[1:] or ["mlb", "nhl", "nba"]   # each hub's job builds its own (python3 tools/track_cards.py mlb)
    for k in want:
        {"mlb": mlb, "nhl": nhl, "nba": nba}[k]()
