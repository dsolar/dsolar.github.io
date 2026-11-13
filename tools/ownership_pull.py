#!/usr/bin/env python3
"""Yahoo's % rostered for baseball players, once a day, kept as a history for Draft Lab's ownership trends.

Writes fantasy-kit/data/own-mlb.json:
  { updated, source, dates: [last 60 days pulled], players: { MLB id: [% rostered on each date, or null] } }
Yahoo's top players by rank (its current baseball game), matched to Draft Lab's player pool by name, then club.
A day already pulled is skipped, so this can run as often as the box score job does.

  python3 tools/ownership_pull.py
"""
import json
import os
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guillotine_update import Yahoo, access_token, text, num, Failure, NotApproved  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "fantasy-kit", "data", "own-mlb.json")
KEEP = 60
# Yahoo's club abbreviations where they differ from MLB's
CLUB = {"ARI": "AZ", "AZ": "AZ", "CHW": "CWS", "WAS": "WSH", "OAK": "ATH", "SAC": "ATH", "KCR": "KC", "SDP": "SD", "SFG": "SF", "TBR": "TB"}


def fold(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower().replace(".", "")
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", s)
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", s).split())


def pool():
    d = json.load(open(os.path.join(ROOT, "fantasy-kit", "data", "mlb.json"), encoding="utf-8"))
    by = {}
    for p in d.get("players") or []:
        if str(p.get("id", "")).isdigit() and p.get("n"):
            by.setdefault(fold(p["n"]), []).append((str(p["id"]), p.get("t")))
    return by


def match(by, name, club):
    hits = by.get(fold(name)) or []
    if len(hits) == 1:
        return hits[0][0]
    club = CLUB.get(club, club)
    same = [pid for pid, t in hits if t == club]
    return same[0] if len(same) == 1 else None


def main():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        old = json.load(open(OUT, encoding="utf-8"))
    except (OSError, ValueError):
        old = {"dates": [], "players": {}}
    if today in old.get("dates", []):
        print(f"Already have {today}.")
        return 0
    by = pool()
    y = Yahoo(token=access_token())
    got, misses = {}, 0
    for start in range(0, 1200, 25):
        time.sleep(1.1)
        r = y.get(f"game/mlb/players;sort=AR;sort_type=season;start={start};count=25/percent_owned", soft=True)
        ps = [] if r is None else r.findall(".//player")
        if not ps:
            break
        for p in ps:
            pct = num(p, "percent_owned/value")
            if pct is None:
                continue
            pid = match(by, text(p, "name/full"), text(p, "editorial_team_abbr"))
            if pid:
                got[pid] = round(float(pct))
            else:
                misses += 1
    if len(got) < 200:
        print(f"::warning::Only {len(got)} players came back from Yahoo; keeping the old file.")
        return 0
    dates = (old.get("dates") or []) + [today]
    players = old.get("players") or {}
    n = len(dates)
    for pid in set(players) | set(got):
        row = (players.get(pid) or []) + [None] * (n - 1 - len(players.get(pid) or []))
        players[pid] = row[: n - 1] + [got.get(pid)]
    if n > KEEP:
        cut = n - KEEP
        dates = dates[cut:]
        players = {k: v[cut:] for k, v in players.items()}
    players = {k: v for k, v in players.items() if any(x is not None for x in v)}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "Yahoo % rostered", "dates": dates, "players": players}, f, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(got)} players for {today} ({misses} not matched), {len(dates)} days kept.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except NotApproved:
        print("::error::Yahoo hasn't approved this app for Fantasy data.")
        sys.exit(1)
    except Failure as e:
        print(f"::warning::{e}")
        sys.exit(0)
