#!/usr/bin/env python3
"""Add a board to the Big Board from copied page text.

Copy the board off the outlet's page (select the list, copy), save it as a text file, then:

    python3 tools/draft_paste.py nba no-ceilings paste.txt --date 2026-11-20 --url https://www.noceilingsnba.com/p/2027-nba-draft-big-board-v1

It reads the three shapes boards usually come in:
    1 | Tyran Stokes | Kansas | SF          (one line per player, split by |, commas or dashes)
    #1. Tyran Stokes | G-F | Kansas         (No Ceilings style)
    1                                       (one field per line, the way NFL Mock Draft Database copies)
    Jeremiah Smith
    WR
    Ohio State
Ranks have to run in order from 1, which is how stray numbers (pick numbers, movement arrows) get skipped.
For a mock draft, pass --mock and the team code is read too.

The snapshot lands in tools/draft_boards/<league>/<source>/<date>.json and the board is rebuilt. Names it
can't match to anyone already on the board are listed, in case one needs a line in tools/draft_aliases.json.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from draft_build import key  # noqa: E402

POS = {"PG", "SG", "SF", "PF", "C", "G", "F", "G-F", "F-C", "F-G", "C-F", "WING", "BIG", "GUARD", "FORWARD", "CENTER",
       "QB", "RB", "WR", "TE", "OT", "OL", "IOL", "OG", "G", "DL", "DT", "IDL", "EDGE", "DE", "LB", "ILB", "OLB", "CB",
       "S", "NB", "DB", "K", "P", "LS", "ATH", "FB"}
TEAMS = {"ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MEM", "MIA",
         "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS",
         "ARI", "BAL", "BUF", "CAR", "CIN", "GB", "JAX", "JAC", "KC", "LV", "LAR", "NE", "NO", "NYG", "NYJ", "PIT",
         "SEA", "SF", "TB", "TEN", "WSH"}


def is_pos(f):
    return all(p in POS for p in re.split(r"[/]", f.upper().replace(" ", ""))) if f else False


def fields_of(line):
    return [x.strip() for x in re.split(r"\s*(?:\||–|—| - |,|\t)\s*", line) if x.strip()]


def to_row(rank, fields, mock):
    fields = [f for f in fields if not re.fullmatch(r"[\d.]+%?|[+-]?\d+|[↑↓▲▼]\s*\d*", f)]
    if not fields:
        return None
    name, rest = fields[0], fields[1:]
    pos = school = team = ""
    if mock:
        m = re.match(r"^([A-Z]{2,3})\s+(\S.*)$", name)
        if m and m.group(1) in TEAMS:
            team, name = m.group(1), m.group(2)
    after_hash = False
    for f in rest:
        if f.startswith("#"):
            after_hash = True
            continue
        if not pos and is_pos(f) and not after_hash:
            pos = f
        elif mock and not team and f.upper() in TEAMS and (after_hash or school):
            team = f.upper()
        elif not school and not after_hash:
            school = f
        elif mock and not team and f.upper() in TEAMS:
            team = f.upper()
    row = [rank, name, school, pos]
    if mock:
        row.append(team)
    return row


def parse(text, mock=False):
    rows, cur = [], None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        want = len(rows) + 1 + (1 if cur else 0)
        if re.fullmatch(r"\d{1,3}\.?", line) and int(line.rstrip(".")) == want:
            if cur:
                r = to_row(*cur, mock)
                if r:
                    rows.append(r)
            cur = (want, [])
            continue
        m = re.match(r"^#?\s*(\d{1,3})\s*[.):|]?\s+(\S.*)$", line)
        if m and int(m.group(1)) == want and not cur:
            r = to_row(want, fields_of(m.group(2)), mock)
            if r:
                rows.append(r)
            continue
        if m and cur and int(m.group(1)) == want:
            r = to_row(*cur, mock)
            if r:
                rows.append(r)
            cur = None
            r = to_row(len(rows) + 1, fields_of(m.group(2)), mock)
            if r:
                rows.append(r)
            continue
        if cur:
            cur[1].append(line)
    if cur:
        r = to_row(*cur, mock)
        if r:
            rows.append(r)
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("league", choices=["nba", "nfl"])
    ap.add_argument("source", help="id from tools/draft_sources.json")
    ap.add_argument("file", nargs="?", help="pasted text (reads stdin if left out)")
    ap.add_argument("--date", default=date.today().isoformat(), help="the board's publish date, YYYY-MM-DD")
    ap.add_argument("--url", default="")
    ap.add_argument("--title", default="")
    ap.add_argument("--mock", action="store_true", help="a mock draft: also read each pick's team")
    ap.add_argument("--dry", action="store_true", help="show what it read without saving")
    a = ap.parse_args()

    reg = json.load(open(os.path.join(ROOT, "tools", "draft_sources.json"), encoding="utf-8"))
    src = next((s for s in reg[a.league] if s["id"] == a.source), None)
    if not src:
        sys.exit(f"No source '{a.source}' for {a.league}. Add it to tools/draft_sources.json first.")
    text = open(a.file, encoding="utf-8").read() if a.file else sys.stdin.read()
    rows = parse(text, a.mock or src["kind"] == "mock")
    if len(rows) < 10:
        sys.exit(f"Only read {len(rows)} players. Check the paste: ranks need to start at 1 and run in order.")
    for r in rows[:5]:
        print("  ", r)
    print(f"   ... {len(rows)} players, last: {rows[-1]}")

    known = set()
    built = os.path.join(ROOT, "draft", f"{a.league}.json")
    if os.path.exists(built):
        aliases = json.load(open(os.path.join(ROOT, "tools", "draft_aliases.json"), encoding="utf-8")).get(a.league, {})
        known = {p["id"] for p in json.load(open(built, encoding="utf-8"))["players"]}
        new = [r[1] for r in rows if aliases.get(key(r[1]), key(r[1])) not in known]
        if new and known:
            print(f"New to the board ({len(new)}), check none is a misspelling: {', '.join(new[:25])}{' ...' if len(new) > 25 else ''}")
    if a.dry:
        return 0

    d = os.path.join(ROOT, "tools", "draft_boards", a.league, a.source)
    os.makedirs(d, exist_ok=True)
    head = {"date": a.date, "url": a.url or src.get("url", ""), "title": a.title or src["name"]}
    body = ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in rows)
    path = os.path.join(d, a.date + ".json")
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(head, ensure_ascii=False, indent=1)[:-2] + ',\n "ranks": [\n' + body + "\n ]\n}\n")
    print(f"Saved {os.path.relpath(path, ROOT)}")
    if src.get("status") == "pending":
        # The outlet has published for this class now, so it's live.
        reg_path = os.path.join(ROOT, "tools", "draft_sources.json")
        lines = open(reg_path, encoding="utf-8").read().split("\n")
        lines = [l.replace('"status": "pending", ', "") if f'"id": "{a.source}"' in l else l for l in lines]
        open(reg_path, "w", encoding="utf-8").write("\n".join(lines))
        print(f"{src['name']} is live now (took pending off it in tools/draft_sources.json).")
    subprocess.run([sys.executable, os.path.join(ROOT, "tools", "draft_build.py")], check=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
