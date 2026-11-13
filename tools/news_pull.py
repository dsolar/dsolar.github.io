#!/usr/bin/env python3
"""Baseball player news for Draft Lab: MLB.com's news feeds (the league's and each club's), matched to players.

Writes fantasy-kit/data/news-mlb.json:
  { updated, source, items: [{ t: headline, u: link, at: ISO time, src, team, ids: [player ids] }] }
newest first, the last 21 days. Headlines and links only; the story stays on MLB.com.
A player counts as named when his full name is in the headline or the feed's summary. A name two players share
counts only in his own club's feed.

  python3 tools/news_pull.py
"""
import json
import os
import re
import sys
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "fantasy-kit", "data", "news-mlb.json")
UA = "Mozilla/5.0 (compatible; DraftLab/1.0; +https://davidsolar.dev/fantasy-kit/)"
KEEP_DAYS = 21
CLUBS = {"orioles": "BAL", "redsox": "BOS", "yankees": "NYY", "rays": "TB", "bluejays": "TOR", "whitesox": "CWS",
         "guardians": "CLE", "tigers": "DET", "royals": "KC", "twins": "MIN", "astros": "HOU", "angels": "LAA",
         "athletics": "ATH", "mariners": "SEA", "rangers": "TEX", "braves": "ATL", "marlins": "MIA", "mets": "NYM",
         "phillies": "PHI", "nationals": "WSH", "cubs": "CHC", "reds": "CIN", "brewers": "MIL", "pirates": "PIT",
         "cardinals": "STL", "dbacks": "AZ", "rockies": "COL", "dodgers": "LAD", "padres": "SD", "giants": "SF"}


def fold(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9 ]+", " ", s.replace(".", "")).split()


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def strip_tags(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def players():
    """Full names (folded to words) to player ids and clubs, from the player pool and the prospect list."""
    names = {}
    for path, key in (("fantasy-kit/data/mlb.json", "players"), ("fantasy-kit/data/prospects-mlb.json", "players")):
        try:
            d = json.load(open(os.path.join(ROOT, path), encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for p in d.get(key) or []:
            pid = str(p.get("mlbam") or p.get("id") or "")
            if not pid.isdigit() or not p.get("n"):
                continue
            words = tuple(fold(p["n"]))
            if len(words) < 2:
                continue
            names.setdefault(words, {})[pid] = p.get("t") or p.get("team")
    return names


def find(words, names, club):
    """The players named in a run of words: the longest full names first."""
    got, n = [], len(words)
    for size in (4, 3, 2):
        for i in range(n - size + 1):
            hit = names.get(tuple(words[i:i + size]))
            if not hit:
                continue
            if len(hit) == 1:
                got.extend(hit)
            else:
                got.extend(pid for pid, t in hit.items() if club and t == club)
    return list(dict.fromkeys(got))


def main():
    names = players()
    if not names:
        print("No player pool to match against; skipping.")
        return 0
    try:
        old = json.load(open(OUT, encoding="utf-8")).get("items") or []
    except (OSError, ValueError):
        old = []
    seen = {x["u"]: x for x in old}
    feeds = [("https://www.mlb.com/feeds/news/rss.xml", None)] + [(f"https://www.mlb.com/{s}/feeds/news/rss.xml", c) for s, c in CLUBS.items()]
    ok = 0
    for url, club in feeds:
        try:
            root = ET.fromstring(fetch(url))
        except Exception as e:  # one feed down shouldn't stop the rest
            print(f"{url}: {type(e).__name__}: {e}")
            continue
        ok += 1
        for it in root.iter("item"):
            title, link = strip_tags(it.findtext("title")), (it.findtext("link") or "").strip()
            if not title or not link.startswith("https://"):
                continue
            try:
                at = parsedate_to_datetime(it.findtext("pubDate") or "").astimezone(timezone.utc)
            except (TypeError, ValueError):
                at = datetime.now(timezone.utc)
            ids = find(fold(title) + ["|"] + fold(strip_tags(it.findtext("description"))), names, club)
            if not ids:
                continue
            row = seen.get(link) or {"t": title, "u": link, "at": at.strftime("%Y-%m-%dT%H:%M:%SZ"), "src": "MLB.com", "team": club, "ids": []}
            row["ids"] = list(dict.fromkeys(row["ids"] + ids))
            if club and not row.get("team"):
                row["team"] = club
            seen[link] = row
    if not ok:
        print("::warning::No news feed answered; keeping the old file.")
        return 0
    cut = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    items = sorted((x for x in seen.values() if x["at"] >= cut), key=lambda x: x["at"], reverse=True)[:900]
    if items == old:
        print("No new stories.")
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    body = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "MLB.com news feeds", "items": items}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(body, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(items)} stories naming players, from {ok} of {len(feeds)} feeds.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
