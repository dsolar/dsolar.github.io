#!/usr/bin/env python3
"""Hard Cap's Prospect Board, in season: Tankathon's current big board (rank, school, position and this season's
per-game line) into hardcap/prospects.json.

Each run keeps one rank reading per day under "hist", so the page can show how far a prospect has moved since the
season started. The first reading is the baseline; the preseason board in celtics/data.json is the fallback for
anyone who wasn't on the board that day.

If Tankathon changes its page and nothing parses, the last good file stays and the log shows a slice of the page
so the parser can be fixed.
"""
import html as H
import json
import os
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "hardcap", "prospects.json")
URL = "https://www.tankathon.com/big_board"
UA = "Mozilla/5.0 (compatible; davidsolar-hardcap/1.0; +https://davidsolar.dev/hardcap/)"
STAT_KEYS = {"pts": "pts", "reb": "reb", "ast": "ast", "stl": "stl", "blk": "blk", "tov": "tov", "to": "tov",
             "min": "min", "fg%": "fg", "fg": "fg", "3p%": "tp", "3pt%": "tp", "3p": "tp", "ft%": "ft", "ft": "ft",
             "gp": "gp", "g": "gp", "per": "per", "ts%": "ts"}


def slug(n):
    n = unicodedata.normalize("NFKD", n or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")


def text(s):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def fetch():
    req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def parse(page):
    """Rows of the big board. Tankathon marks each prospect with mock-row-* classes; the stats sit in label/value
    pairs inside the row."""
    starts = [m.start() for m in re.finditer(r'class="[^"]*\bmock-row\b(?![-\w])[^"]*"', page)]
    rows = []
    for i, st in enumerate(starts):
        block = page[st: starts[i + 1] if i + 1 < len(starts) else st + 20000]
        name = re.search(r'class="[^"]*mock-row-name[^"]*"[^>]*>(.*?)</', block, re.S)
        if not name:
            continue
        rank = re.search(r'class="[^"]*mock-row-pick-number[^"]*"[^>]*>(.*?)</', block, re.S)
        sp = re.search(r'class="[^"]*mock-row-school-position[^"]*"[^>]*>(.*?)</div>', block, re.S)
        school, pos = "", ""
        if sp:
            parts = [x.strip() for x in text(sp.group(1)).split("|")]
            if len(parts) >= 2:
                pos, school = parts[0], parts[1]
            elif parts:
                school = parts[0]
        stats = {}
        for lab, val in re.findall(r'>\s*([A-Za-z0-9%]{1,5})\s*</[^>]+>\s*<[^>]+>\s*(-?[0-9]*\.?[0-9]+%?)\s*<', block):
            k = STAT_KEYS.get(lab.lower())
            if k and k not in stats:
                v = float(val.rstrip("%"))
                stats[k] = v
        for val, lab in re.findall(r'>\s*(-?[0-9]*\.?[0-9]+%?)\s*</[^>]+>\s*<[^>]+>\s*([A-Za-z0-9%]{1,5})\s*<', block):
            k = STAT_KEYS.get(lab.lower())
            if k and k not in stats:
                stats[k] = float(val.rstrip("%"))
        n = text(name.group(1))
        r = re.sub(r"[^0-9]", "", text(rank.group(1))) if rank else ""
        rows.append({"id": slug(n), "n": n, "rank": int(r) if r else len(rows) + 1, "school": school, "pos": pos, "stats": stats})
    return rows


def main():
    try:
        data = json.load(open(OUT, encoding="utf-8"))
    except (OSError, ValueError):
        data = {"hist": {}}
    try:
        page = fetch()
    except Exception as e:
        print(f"Tankathon didn't answer: {type(e).__name__}: {e}")
        return 0
    rows = parse(page)
    if len(rows) < 30:
        i = page.find("mock-row")
        print(f"Parsed only {len(rows)} prospects from {len(page)} bytes. Page sample:")
        print(page[max(0, i - 200): i + 3000] if i >= 0 else page[:3000])
        return 0
    if os.environ.get("HC_DEBUG"):
        i = page.find("mock-row-name")
        print(page[max(0, i - 1500): i + 2500])
    today = (datetime.now(timezone.utc) - timedelta(hours=5)).date().isoformat()
    data["board"] = rows
    data["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    data["source"] = URL
    hist = data.setdefault("hist", {})
    hist[today] = {r["id"]: r["rank"] for r in rows}
    data["hist"] = dict(sorted(hist.items())[-200:])
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    with_stats = sum(1 for r in rows if r["stats"])
    print(f"Wrote {OUT}: {len(rows)} prospects, {with_stats} with a stat line, {len(data['hist'])} daily readings.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
