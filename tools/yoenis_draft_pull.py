#!/usr/bin/env python3
"""Pull every Wipe Yoenis draft from Yahoo, with each player's position and MLB team, into
tools/yahoo_yoenis/drafts/<year>.json.

data.json's drafts have names only, and some names belong to two players (Will Smith the catcher and Will Smith
the reliever; José Ramírez the star and a reliever of the same name; two Max Muncys). Yahoo's draft results say
which one it was, so values can be looked up for the right player (tools/yoenis_value.py, ident()).

Writes {"season": year, "picks": [[overall pick, round, team key, name, position, MLB team abbreviation], ...]}.
Finished seasons are pulled once; the latest one each run.

  python3 tools/yoenis_draft_pull.py           missing seasons, plus the latest one
  python3 tools/yoenis_draft_pull.py --all     every season again
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guillotine_update import Yahoo, access_token, text, num  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "yoenis", "data.json")
HIST = os.path.join(ROOT, "tools", "yahoo_yoenis", "history")
OUT = os.path.join(ROOT, "tools", "yahoo_yoenis", "drafts")
BATCH = 25  # Yahoo's limit on player keys per call


def season(y, key):
    root = y.get(f"league/{key}/draftresults", soft=True)
    if root is None:
        return None
    picks = []
    for d in root.findall(".//draft_results/draft_result"):
        pk = text(d, "player_key")
        if pk:
            picks.append([int(num(d, "pick") or 0), int(num(d, "round") or 0), text(d, "team_key"), pk])
    info = {}
    keys = [p[3] for p in picks]
    for i in range(0, len(keys), BATCH):
        got = y.get(f"league/{key}/players;player_keys={','.join(keys[i:i + BATCH])}", soft=True)
        if got is None:
            continue
        for pl in got.findall(".//players/player"):
            info[text(pl, "player_key")] = (text(pl, "name/full"), text(pl, "display_position"),
                                           text(pl, "editorial_team_abbr"))
    out = []
    for pick, rnd, team, pk in sorted(picks):
        name, pos, mlb = info.get(pk, ("", "", ""))
        out.append([pick, rnd, team, name, pos, mlb])
    return {"season": None, "picks": out}


def main():
    data = json.load(open(DATA, encoding="utf-8"))
    y = Yahoo(token=access_token())
    os.makedirs(OUT, exist_ok=True)
    last = data["seasons"][-1]["year"]
    for s in data["seasons"]:
        path = os.path.join(OUT, f"{s['year']}.json")
        if os.path.exists(path) and s["year"] != last and "--all" not in sys.argv:
            continue
        hp = os.path.join(HIST, f"{s['year']}.json")
        if not os.path.exists(hp):
            continue
        key = json.load(open(hp, encoding="utf-8"))["key"]
        got = season(y, key)
        if not got or not got["picks"]:
            print(f"::warning::No Yahoo draft results for {s['year']}.")
            continue
        got["season"] = s["year"]
        missing = sum(1 for p in got["picks"] if not p[3])
        with open(path, "w", encoding="utf-8") as f:
            json.dump(got, f, ensure_ascii=False, separators=(",", ":"))
        print(f"{s['year']}: {len(got['picks'])} picks" + (f", {missing} without player details" if missing else "") + ".")


if __name__ == "__main__":
    main()
