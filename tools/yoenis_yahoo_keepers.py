#!/usr/bin/env python3
"""Add keepers for years the keeper sheet lost (before 2022) to yoenis/data.json, from Yahoo's keeper pages.

For each year, open https://baseball.fantasysports.yahoo.com/<year>/b1/<league id>/viewkeepers while signed in,
select all, copy, and save the text as tools/yahoo_keepers/<year>.txt. Then:
  python3 tools/yoenis_yahoo_keepers.py

Yahoo lists every keeper from that spring under the team that had him at the end of the season, so a keeper traded
during the year shows up on his new team, and one dropped during the year doesn't show up at all. The draft is the
record of who kept whom: keepers go into the draft at their keeper round, so each listed player is credited to the
team that took him in that draft, at that round. When a trade leaves a team with more than five that way, the extras
are reported and left out. Keeper years are left blank before 2022: the clocks don't chain cleanly across 2020-21
(players kept 2020 through 2023 are year 3 in the 2023 sheet), so they can't be counted from these lists.
2022's sheet didn't track years either; those are filled in from the 2023 sheet (year 3 in 2023 means year 2 in 2022)
and otherwise from 2021 (not kept in 2021 means year 1), and left blank where neither settles it.

Writes data["keeperHistory"][year] = [[team index, [[player, round, keeper year or null, false], ...]], ...]
for every year with a file here, marks those picks as keepers in that year's draft, and leaves the years that came
from the keeper sheet (2022 on) alone apart from 2022's keeper years.
"""
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "yoenis" / "data.json"
PAGES = ROOT / "tools" / "yahoo_keepers"
SHEET_FROM = 2022           # the keeper sheet is the record from here on


def fold(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\((batter|pitcher|b|p)\)|\[(b|p)\]|\b(batter|pitcher)\b", " ", s)
    s = re.sub(r"\b(jr|sr|ii|iii)\b", " ", s)
    return re.sub(r"[^a-z0-9]", "", s)


def side(s):
    s = s.lower()
    return "p" if re.search(r"\(pitcher\)|\[p\]|\bpitcher\b", s) else "b" if re.search(r"\(batter\)|\[b\]|\bbatter\b", s) else ""


def parse(text):
    """[(team name, [player, ...]), ...] from the copied page"""
    lines = [l.strip() for l in text.splitlines()]
    start = next(i for i, l in enumerate(lines) if l == "Protected Keeper Players") + 1
    lines = [l for l in lines[start:] if l]
    out = []
    for i, l in enumerate(lines):
        if l.startswith("("):
            continue
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if nxt.startswith("("):
            if out:
                out[-1][1].append(l)
        else:
            out.append((l, []))
    return out


def main():
    d = json.loads(DATA.read_text(encoding="utf-8"))
    seasons = {s["year"]: s for s in d["seasons"]}
    by_lid = {s["lid"]: y for y, s in seasons.items()}
    hist = d.setdefault("keeperHistory", {})
    pages = {}
    for f in sorted(PAGES.glob("*.txt")):
        text = f.read_text(encoding="utf-8")
        m = re.search(r"ID# (\d+)", text)
        y = by_lid.get(m.group(1)) if m else None
        if y is None or int(f.stem) != y:
            raise SystemExit(f"{f.name}: league ID doesn't match the year in the file name")
        pages[y] = parse(text)

    kept = {}                     # year -> {folded player: keeper year or 0 when unknown}
    for y in sorted(hist):
        kept[int(y)] = {fold(k[0]): (k[2] or 0) for _, ks in hist[y] for k in ks}
    report = []
    for y in sorted(pages):
        if y >= SHEET_FROM:
            # a check on the method: how Yahoo's list compares with the sheet
            sheet = {fold(k[0]) for _, ks in hist.get(str(y), []) for k in ks}
            yahoo = {fold(p) for _, ps in pages[y] for p in ps}
            report.append(f"{y}: Yahoo lists {len(yahoo)}, the sheet {len(sheet)}; in both {len(yahoo & sheet)}")
            continue
        s = seasons[y]
        teams = {fold(t): i for i, t in enumerate(s["teams"])}
        got = {}                          # team index -> [[player, round, year, False], ...]
        later = []
        for team, players in pages[y]:
            listed = teams.get(fold(team))
            if listed is None:
                report.append(f"{y}: no team named {team}")
            for p in players:
                f, sd = fold(p), side(p)
                picks = [q for q in s["draft"] if fold(q[2]) == f and (not sd or not side(q[2]) or side(q[2]) == sd)]
                if not picks:
                    picks = [q for q in s["draft"] if fold(q[2]).endswith(f[-6:]) and fold(q[2])[:1] == f[:1]]
                if not picks:
                    report.append(f"{y}: {p} ({team}) isn't in the draft; left out")
                    continue
                mine = [q for q in picks if q[1] == listed]
                if mine:
                    got.setdefault(listed, []).append((p, mine[0]))
                else:
                    later.append((p, team, picks))
        for p, team, picks in later:      # traded during the season: credit the team that drafted him, if it has room
            q = next((q for q in picks if len(got.get(q[1], [])) < 5), None)
            if q is None:
                report.append(f"{y}: {p} (listed under {team}) would be a sixth keeper for {s['teams'][picks[0][1]]}; left out")
                continue
            got.setdefault(q[1], []).append((p, q))
            report.append(f"{y}: {p} listed under {team}, credited to {s['teams'][q[1]]} (drafted in round {q[0]})")
        rows = []
        for ti, lst in got.items():
            ks = []
            for p, q in sorted(lst, key=lambda x: x[1][0]):
                ks.append([p, q[0], None, False])
                if len(q) > 3:            # mark the pick as a keeper in the draft too (the K badge)
                    q[3] = 1
                else:
                    q.append(1)
            rows.append([ti, ks])
        s["keepers_known"] = True
        rows.sort(key=lambda r: r[0])
        hist[str(y)] = rows
        kept[y] = {fold(k[0]): (k[2] or 0) for _, ks in rows for k in ks}
        report.append(f"{y}: {len(rows)} teams, {sum(len(r[1]) for r in rows)} keepers")
    # 2022's sheet didn't track keeper years: the 2023 sheet settles anyone kept both years, and anyone not kept in
    # 2021 was in his first year
    if "2021" in hist and str(SHEET_FROM) in hist and str(SHEET_FROM + 1) in hist:
        before, after = kept[SHEET_FROM - 1], {fold(k[0]): k[2] for _, ks in hist[str(SHEET_FROM + 1)] for k in ks}
        filled = 0
        for _, ks in hist[str(SHEET_FROM)]:
            for k in ks:
                f = fold(k[0])
                if (after.get(f) or 0) >= 2:
                    k[2] = after[f] - 1
                elif f not in before:
                    k[2] = 1
                filled += k[2] is not None
        report.append(f"{SHEET_FROM}: {filled} of {sum(len(ks) for _, ks in hist[str(SHEET_FROM)])} keeper years filled in")
    d["keeperHistory"] = dict(sorted(hist.items(), key=lambda kv: kv[0]))
    txt = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
    assert "@" not in txt
    DATA.write_text(txt, encoding="utf-8")
    print("\n".join(report))


if __name__ == "__main__":
    main()
