"""Team cap totals for the NFL Hub, from Over The Cap's salary cap space page (overthecap.com/salary-cap-space).

The page has one table per league year: each team's cap space, active cap spending and dead money, under that
year's base cap. Writes nfl/data/teamcap.json for this season and next:
  {src, asOf, note, base: {year: dollars}, years: {year: {TEAM: {space, active, dead, teamCap}}}}
teamCap = space + active + dead (the base cap plus carryover and adjustments). The cap model pins its own contract
sums to these, so a stale copy (it used to be pasted by hand) leaves a released player on the books.
Keeps the last file if the page doesn't parse into 32 teams a year.

Usage: python3 tools/nfl_teamcap.py [season]"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "nfl/data/teamcap.json"
URL = "https://overthecap.com/salary-cap-space"
UA = "Mozilla/5.0 (davidsolar.dev NFL Hub)"


def money(cell):
    txt = re.sub(r"<[^>]+>", "", cell).strip()
    neg = txt.startswith("(") or txt.startswith("-")
    n = int(re.sub(r"[^\d]", "", txt) or 0)
    return -n if neg else n


def parse(html):
    out, base = {}, {}
    for m in re.finditer(r'id="season-(\d{4})"><h4>Base Salary Cap: \$([\d,]+)</h4>(.*?)</table>', html, re.S):
        year, rows = m.group(1), {}
        base[year] = int(m.group(2).replace(",", ""))
        for tr in re.findall(r"<tr class=\"sortable\">(.*?)</tr>", m.group(3), re.S):
            code = re.search(r'team-link (\w+)"', tr)
            cells = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
            if not code or len(cells) < 6:
                continue
            space, active, dead = money(cells[1]), money(cells[4]), money(cells[5])
            rows[code.group(1)] = {"space": space, "active": active, "dead": dead, "teamCap": space + active + dead}
        out[year] = rows
    return out, base


def main():
    season = int(sys.argv[1]) if len(sys.argv) > 1 else (datetime.now().year if datetime.now().month >= 3 else datetime.now().year - 1)
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        html = r.read().decode("utf-8", "replace")
    years, base = parse(html)
    want = [str(season), str(season + 1)]
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    teams = set((old.get("years") or {}).get(want[0], {})) or None
    for y in want:
        got = years.get(y) or {}
        if len(got) != 32 or (teams and set(got) != teams):
            sys.exit(f"{y}: parsed {len(got)} teams ({sorted(set(got) ^ (teams or set()))[:6]} differ); keeping the last file")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = {
        "src": f"Over The Cap, salary cap space page (overthecap.com/salary-cap-space), pulled {today}",
        "asOf": today,
        "note": "teamCap = base cap plus carryover and adjustments (cap space + active spending + dead money). Dead money is what "
                f"still counts for players no longer on the team. {want[1]} uses OTC's projected ${base[want[1]] / 1e6:.0f}M base cap.",
        "base": {y: base[y] for y in want},
        "years": {y: years[y] for y in want},
    }
    if old.get("years") == out["years"] and old.get("base") == out["base"]:
        print("Over The Cap's totals haven't changed.")
        return
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    moved = [(y, t, (out["years"][y][t]["active"] - old["years"][y][t]["active"]) / 1e6) for y in want for t in out["years"][y]
             if old.get("years", {}).get(y, {}).get(t) and out["years"][y][t]["active"] != old["years"][y][t]["active"]]
    moved.sort(key=lambda x: -abs(x[2]))
    print(f"wrote {OUT.name}; biggest active-spending changes:", ", ".join(f"{t} {y} {d:+.1f}M" for y, t, d in moved[:8]) or "none")


if __name__ == "__main__":
    main()
