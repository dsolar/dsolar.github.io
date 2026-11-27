#!/usr/bin/env python3
"""Football, basketball, hockey and college hoops player news for Draft Lab: ESPN's news feeds, matched to players.

Writes fantasy-kit/data/news-<sport>.json for nfl, nba, nhl and cbb, in the same shape as news-mlb.json:
  { updated, source, items: [{ t: headline, u: link, at: ISO time, src, team, ids: [player ids] }] }
newest first, the last 21 days. Headlines and links only; the story stays on ESPN.

A story names a player when ESPN tags him on it (its athlete categories, matched by ESPN id where the player file
keeps one: football, basketball, college), or when his full name is in the headline or summary. Video clips are left
out. One sport's feed being down leaves that sport's old file alone.

  python3 tools/news_espn.py [nfl nba ...]
"""
import json
import os
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
KEEP_DAYS = 21
FEEDS = {
    "nfl": "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50",
    "nba": "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=50",
    "nhl": "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news?limit=50",
    "cbb": "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/news?limit=50",
}
SKIP_TYPES = {"media", "video", "clip"}


def fold(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9 ]+", " ", s.replace(".", "")).split()


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def pool(sport):
    """ESPN ids to our ids, and full names (folded to words) to ids and teams."""
    try:
        d = json.load(open(os.path.join(ROOT, "fantasy-kit", "data", f"{sport}.json"), encoding="utf-8"))
    except (OSError, ValueError):
        return None, None
    by_espn, names = {}, {}
    for p in d.get("players") or []:
        pid = str(p.get("id") or "")
        if not pid or not p.get("n"):
            continue
        espn = str(p.get("espn") or (pid if sport == "cbb" and pid.isdigit() else ""))
        if espn:
            by_espn[espn] = pid
        words = tuple(fold(p["n"]))
        if len(words) >= 2:
            names.setdefault(words, {})[pid] = p.get("t")
    return by_espn, names


def find(words, names):
    """Players named in a run of words, the longest full names first; a name two players share counts for neither."""
    got, n = [], len(words)
    for size in (4, 3, 2):
        for i in range(n - size + 1):
            hit = names.get(tuple(words[i:i + size]))
            if hit and len(hit) == 1:
                got.extend(hit)
    return got


def when(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)


def one(sport):
    out = os.path.join(ROOT, "fantasy-kit", "data", f"news-{sport}.json")
    by_espn, names = pool(sport)
    if by_espn is None:
        print(f"{sport}: no player pool; skipping.")
        return
    try:
        old = json.load(open(out, encoding="utf-8")).get("items") or []
    except (OSError, ValueError):
        old = []
    seen = {x["u"]: x for x in old}
    try:
        feed = fetch(FEEDS[sport])
    except Exception as e:  # one sport down shouldn't stop the rest
        print(f"::warning::{sport}: {type(e).__name__}: {e}; keeping the old file.")
        return
    arts = feed.get("articles") or []
    for a in arts:
        if str(a.get("type") or "").lower() in SKIP_TYPES:
            continue
        title = re.sub(r"\s+", " ", a.get("headline") or a.get("title") or "").strip()
        link = re.sub(r"^http://", "https://", (((a.get("links") or {}).get("web") or {}).get("href") or "").strip())  # recaps come as http
        if not title or not link.startswith("https://"):
            continue
        ids, team = [], None
        for c in a.get("categories") or []:
            if c.get("type") == "athlete":
                aid = str(c.get("athleteId") or (c.get("athlete") or {}).get("id") or "")
                if aid in by_espn:
                    ids.append(by_espn[aid])
                elif c.get("description"):
                    ids.extend(find(fold(c["description"]), names))
            elif c.get("type") == "team" and not team:
                team = (c.get("team") or {}).get("abbreviation") or None
        ids.extend(find(fold(title) + ["|"] + fold(a.get("description") or ""), names))
        ids = list(dict.fromkeys(ids))
        if not ids:
            continue
        row = seen.get(link) or {"t": title, "u": link, "at": when(a.get("published") or a.get("lastModified")).strftime("%Y-%m-%dT%H:%M:%SZ"), "src": "ESPN", "team": team, "ids": []}
        row["ids"] = list(dict.fromkeys(row["ids"] + ids))
        seen[link] = row
    cut = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    items = sorted((x for x in seen.values() if x["at"] >= cut), key=lambda x: x["at"], reverse=True)[:900]
    if items == old:
        print(f"{sport}: no new stories ({len(arts)} in the feed).")
        return
    body = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "ESPN news", "items": items}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(body, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{sport}: wrote {len(items)} stories naming players ({len(arts)} in the feed this time).")


def main():
    for sport in sys.argv[1:] or list(FEEDS):
        if sport in FEEDS:
            one(sport)
    return 0


if __name__ == "__main__":
    sys.exit(main())
