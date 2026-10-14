#!/usr/bin/env python3
"""Build guillotine/data.json from a copy of the Yahoo league overview page.

The no-API way to update davidsolar.dev/guillotine/: on the league's Yahoo page (League > Overview),
select all, copy, and paste it into guillotine/paste.txt (GitHub's web editor works on a phone).
Committing that file runs the "Guillotine paste" workflow, which runs this script.

It reads three things from the paste:
  "Week 6 Matchup"   the current week
  Standings table    Team, Projected Points, FAB and Pts Per Week for each team still alive
  Eliminated table   Week, Team and FAB for each team that's been cut

  python tools/guillotine_paste.py [paste file] [--out guillotine/data.json]
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")


def cells(line):
    return [c.strip() for c in re.split(r"\t+|\s{2,}", line.strip()) if c.strip()]


def money(s):
    s = s.replace("$", "").replace(",", "").strip()
    return int(float(s)) if re.fullmatch(r"-?\d+(\.\d+)?", s) else None


def num(s):
    s = s.replace(",", "").strip()
    return float(s) if re.fullmatch(r"-?\d+(\.\d+)?", s) else None


def parse(txt):
    lines = [l.rstrip("\n") for l in txt.splitlines()]
    league = "Bastille Day"
    m = re.search(r"^\s*(.+?) \(ID# \d+\)", txt, re.M)
    if m:
        league = m.group(1).strip()

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
                alive.append({
                    "name": c[1], "proj": num(c[3]), "season": num(c[4]),
                    "faab": money(c[5]), "avg": num(c[8]),
                })
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

    m = re.search(r"Week (\d+) Matchup", txt)
    week = int(m.group(1)) if m else (max([f["out"] for f in fallen], default=0) + 1)

    teams = []
    for t in sorted(alive, key=lambda t: -(t["proj"] or 0)):
        row = {"name": t["name"]}
        if t["faab"] is not None:
            row["faab"] = t["faab"]
        row["proj"] = t["proj"]
        if t["avg"] is not None:
            row["avg"] = t["avg"]
        teams.append(row)
    for f in sorted(fallen, key=lambda f: -f["out"]):
        row = {"name": f["name"]}
        if f["faab"] is not None:
            row["faab"] = f["faab"]
        row["out"] = f["out"]
        # A Week 1 casualty's season total is its elimination score.
        if f["out"] == 1 and f["season"] is not None:
            row["scores"] = [f["season"]]
        teams.append(row)

    return {
        "league": league,
        "season": datetime.now(timezone.utc).year,
        "week": week,
        "first_week": 1,
        "total_teams": len(alive) + len(fallen),
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Yahoo league page, pasted",
        "teams": teams,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paste", nargs="?", default=os.path.join(ROOT, "guillotine", "paste.txt"))
    ap.add_argument("--out", default=os.path.join(ROOT, "guillotine", "data.json"))
    a = ap.parse_args()
    with open(a.paste, encoding="utf-8") as f:
        data = parse(f.read())
    out = os.path.abspath(a.out)
    if os.path.exists(out):
        with open(out, encoding="utf-8") as f:
            old = json.load(f)
        if {k: v for k, v in old.items() if k != "updated"} == {k: v for k, v in data.items() if k != "updated"}:
            print("No change in league data.")
            return
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    alive = sum(1 for t in data["teams"] if "out" not in t)
    print(f"Wrote {out}: week {data['week']}, {alive} of {data['total_teams']} teams alive.")


if __name__ == "__main__":
    main()
