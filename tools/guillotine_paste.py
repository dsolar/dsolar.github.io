#!/usr/bin/env python3
"""Build guillotine/data.json from copies of two Yahoo league pages.

The no-API way to update davidsolar.dev/guillotine/. In guillotine/paste.txt, paste:
  1. the league's main page (League > Overview): standings, projections, FAB, eliminations
  2. optionally, League > Starting Rosters: every team's starters and bench
Select all, copy, paste one after the other. A paste taken mid-week is fine: each team's Points so far
are kept, and every starter whose game Yahoo shows as Final is marked yfinal, so the page banks
those points exactly and only the players still to play can move the odds. Committing the file runs the "Guillotine update"
workflow, which runs this script and then tools/guillotine_projections.py.

  python tools/guillotine_paste.py [paste file] [--out guillotine/data.json]
"""
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
SLOTS = {"QB", "RB", "WR", "TE", "W/R/T", "Q/W/R/T", "W/R", "W/T", "K", "DEF", "BN", "IR"}
PROJ_KEYS = {"proj_source", "proj_updated", "best"}  # added later by guillotine_projections.py


def clean(s):
    # Yahoo pages carry private-use icon glyphs and \r line ends; drop both.
    return re.sub(r"[-\r]", "", s)


def cells(line):
    return [c.strip() for c in re.split(r"\t+|\s{2,}", line.strip()) if c.strip()]


def money(s):
    s = s.replace("$", "").replace(",", "").strip()
    return int(float(s)) if re.fullmatch(r"-?\d+(\.\d+)?", s) else None


def num(s):
    s = s.replace(",", "").strip()
    return float(s) if re.fullmatch(r"-?\d+(\.\d+)?", s) else None


def parse_rosters(lines):
    """Starting Rosters page -> {team name: [players]}."""
    rosters, team, i = {}, None, 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("Pos") and "Player" in line and "\t" in lines[i]:
            # The team name is the last non-blank line before this header.
            j = i - 1
            while j >= 0 and not lines[j].strip():
                j -= 1
            team = lines[j].strip()
            rosters[team] = []
            i += 1
            continue
        if team and line in SLOTS and lines[i].rstrip().endswith(line) and i + 1 < len(lines):
            slot = line
            name = lines[i + 1].strip()
            if name == "--empty--":
                rosters[team].append({"slot": slot, "empty": True})
                i += 3 if i + 2 < len(lines) and lines[i + 2].strip() == "(Empty)" else 2
                continue
            notes = lines[i + 2].strip() if i + 2 < len(lines) else ""
            tp = lines[i + 3].strip() if i + 3 < len(lines) else ""
            game = lines[i + 4].strip() if i + 4 < len(lines) else ""
            game = re.sub(r"\s+", " ", game)
            m = re.fullmatch(r"([A-Za-z]{2,3}) - ([A-Z]{1,3})", tp)
            if not m:
                i += 1
                continue
            status = ""
            if notes.startswith(name):
                sm = re.match(r"(IR-R|PUP-R|PUP|IR|NA|SUSP|Q|D|O)(?=[A-Z ]|$)", notes[len(name):])
                status = sm.group(1) if sm else ""
            p = {"slot": slot, "name": name, "nfl": m.group(1).upper(), "pos": m.group(2)}
            if status:
                p["status"] = status
            if game.lower() == "bye":
                p["bye"] = True
            else:
                gm = re.match(r"(\w{3}) (\d{1,2}:\d{2} [ap]m) (vs|@) (\w{2,3})", game)
                fm = re.match(r"Final(?: ?/ ?OT)? ([WLT]) (\d+-\d+) (vs|@) (\w{2,3})", game)
                if game == "Final (Yahoo screenshot)":
                    p["yfinal"] = True
                if gm:
                    p["game"] = f"{gm.group(1)} {gm.group(2)}"
                    p["opp"] = ("vs " if gm.group(3) == "vs" else "@ ") + gm.group(4).upper()
                elif fm:
                    # Yahoo shows this game as over: the team's Points already include this player.
                    p["yfinal"] = True
                    p["result"] = f"{fm.group(1)} {fm.group(2)}"
                    p["opp"] = ("vs " if fm.group(3) == "vs" else "@ ") + fm.group(4).upper()
            used = 5
            if i + 5 < len(lines) and lines[i + 5].startswith("Yahoo snapshot points\t"):
                snapshot = lines[i + 5].split("\t")
                if len(snapshot) == 4:
                    actual, projected = num(snapshot[1]), num(snapshot[3])
                    if projected is not None:
                        p["yahoo_proj"] = projected
                    if actual is not None and p.get("yfinal"):
                        p["yahoo_actual"] = actual
                used += 1
            rosters[team].append(p)
            i += used
            continue
        if line.startswith("Yahoo Sports - NBC"):
            team = None
        i += 1
    return {t: r for t, r in rosters.items() if any(not p.get("empty") for p in r)}


def parse(txt):
    txt = clean(txt)
    lines = txt.splitlines()
    league = "Bastille Day"
    m = re.search(r"^\s*(.+?) \(ID# (\d+)\)", txt, re.M)
    if m:
        league = m.group(1).strip()
    league_id = m.group(2) if m else None

    alive, fallen, section = [], [], None
    for line in lines:
        c = cells(line)
        if not c:
            continue
        head = " ".join(c).lower()
        if head.startswith("rank team") and "projected" in head:
            section = "standings"
            continue
        if head.startswith("week team") and "season points" in head:
            section = "eliminated"
            continue
        if section == "standings":
            # Rank, Team, Points, Projected, Season, FAB, Waiver, Moves, Pts/Week
            if len(c) >= 9 and c[0].isdigit():
                alive.append({"name": c[1], "points": num(c[2]), "proj": num(c[3]), "season": num(c[4]), "faab": money(c[5]), "avg": num(c[8])})
                continue
            section = None
        elif section == "eliminated":
            # Week, Team, Season, FAB, Moves, Pts/Week
            if len(c) >= 6 and c[0].isdigit():
                fallen.append({"name": c[1], "out": int(c[0]), "season": num(c[2]), "faab": money(c[3])})
                continue
            section = None

    if not alive:
        sys.exit("Couldn't find the Standings table. Copy the whole League > Overview page from Yahoo.")

    m = re.search(r"Week (\d+) Matchup", txt) or re.search(r"Starting Rosters[\s\S]{0,80}?Week (\d+)", txt)
    week = int(m.group(1)) if m else (max([f["out"] for f in fallen], default=0) + 1)
    rosters = parse_rosters(lines) if "Starting Rosters" in txt else {}

    teams = []
    for t in sorted(alive, key=lambda t: -(t["proj"] or 0)):
        row = {"name": t["name"]}
        if t["faab"] is not None:
            row["faab"] = t["faab"]
        row["proj"] = t["proj"]
        if t["points"]:
            row["points"] = t["points"]  # scored so far this week (Yahoo), from games already played
        if t["avg"] is not None:
            row["avg"] = t["avg"]
        if t["season"] is not None:
            row["season_pts"] = t["season"]
        if t["name"] in rosters:
            row["roster"] = rosters[t["name"]]
        teams.append(row)
    for f in sorted(fallen, key=lambda f: -f["out"]):
        row = {"name": f["name"]}
        if f["faab"] is not None:
            row["faab"] = f["faab"]
        row["out"] = f["out"]
        if f["out"] == 1 and f["season"] is not None:
            row["cut"] = f["season"]  # a Week 1 casualty's season total is its elimination score
        if f["season"] is not None:
            row["season_pts"] = f["season"]
        teams.append(row)

    data = {
        "league": league,
        "season": datetime.now(timezone.utc).year,
        "week": week,
        "first_week": 1,
        "total_teams": len(alive) + len(fallen),
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Yahoo league page, pasted",
        "teams": teams,
    }
    data["roster_import_id"] = hashlib.sha256(txt.encode("utf-8")).hexdigest()
    data["roster_imported_at"] = data["updated"]
    snapshot = re.search(r"^Full roster snapshot: (.+)$", txt, re.M)
    if snapshot:
        data["roster_snapshot_at"] = snapshot.group(1).strip()
    verified = re.search(r"^Lineup screenshot corrections: (.+)$", txt, re.M)
    if verified:
        data["lineup_verified_teams"] = [n.strip() for n in verified.group(1).split("|")]
        data["roster_note"] = "Three Week 7 starting lineups corrected from Yahoo screenshots. Other lineups and unseen bench entries retain the earlier snapshot."
    if league_id:
        data["league_url"] = f"https://football.fantasysports.yahoo.com/f1/{league_id}"
    return data


def base_of(data):
    """The pasted league data without the projection layer or timestamp, for change checks."""
    d = {k: v for k, v in data.items() if k not in PROJ_KEYS and k not in ("updated", "roster_imported_at")}
    d["teams"] = []
    for t in data.get("teams", []):
        t = {k: v for k, v in t.items() if k not in PROJ_KEYS}
        if "roster" in t:
            t["roster"] = [{k: v for k, v in p.items() if k not in ("proj", "rank", "in_best")} for p in t["roster"]]
        d["teams"].append(t)
    return d


def carry_cuts(old, new):
    """Keep known elimination scores, and work out new ones where the last paste allows.

    A team cut in week W scored (season points now) - (season points before week W). The previous
    paste includes week W points in its season total, so subtract those first."""
    prev = {t["name"]: t for t in old.get("teams", [])}
    for t in new["teams"]:
        if not t.get("out") or "cut" in t:
            continue
        o = prev.get(t["name"], {})
        if isinstance(o.get("cut"), (int, float)):
            t["cut"] = o["cut"]
        elif (not o.get("out") and old.get("week") == t["out"]
              and isinstance(o.get("season_pts"), (int, float)) and isinstance(t.get("season_pts"), (int, float))):
            t["cut"] = round(t["season_pts"] - o["season_pts"] + (o.get("points") or 0), 2)


def carry_pregame(old, new):
    """Keep each team's projection from before the week's first game (proj_pre).

    Once games are played, Yahoo's Projected Points mixes actual points with projections, so the
    pregame number only survives if an earlier paste of the same week had it. Before a team has
    scored, its current projection is the pregame one (waiver claims and lineup moves change it)."""
    prev = {t["name"]: t for t in (old or {}).get("teams", [])} if (old or {}).get("week") == new["week"] else {}
    for t in new["teams"]:
        if t.get("out"):
            continue
        if not t.get("points") and isinstance(t.get("proj"), (int, float)) and t["proj"] > 0:
            t["proj_pre"] = t["proj"]
            continue
        o = prev.get(t["name"], {})
        if isinstance(o.get("proj_pre"), (int, float)):
            t["proj_pre"] = o["proj_pre"]
        elif o and not o.get("points") and isinstance(o.get("proj"), (int, float)) and o["proj"] > 0:
            t["proj_pre"] = o["proj"]
        elif not t.get("points") and isinstance(t.get("proj"), (int, float)) and t["proj"] > 0:
            t["proj_pre"] = t["proj"]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paste", nargs="?", default=os.path.join(ROOT, "guillotine", "paste.txt"))
    ap.add_argument("--out", default=os.path.join(ROOT, "guillotine", "data.json"))
    a = ap.parse_args()
    with open(a.paste, encoding="utf-8") as f:
        data = parse(f.read())
    out = os.path.abspath(a.out)
    old = None
    if os.path.exists(out):
        with open(out, encoding="utf-8") as f:
            old = json.load(f)
        if old.get("roster_import_id") == data.get("roster_import_id"):
            data["roster_imported_at"] = old.get("roster_imported_at", old.get("updated"))
        carry_cuts(old, data)
    carry_pregame(old, data)
    if old is not None:
        if base_of(old) == base_of(data):
            print("Pasted league data unchanged.")
            return
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    alive = sum(1 for t in data["teams"] if "out" not in t)
    with_roster = sum(1 for t in data["teams"] if t.get("roster"))
    print(f"Wrote {out}: week {data['week']}, {alive} of {data['total_teams']} teams alive, {with_roster} rosters.")


if __name__ == "__main__":
    main()
