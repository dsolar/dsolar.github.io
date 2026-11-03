#!/usr/bin/env python3
"""Kalshi's 2027 NBA and NFL draft markets, for the Big Board's Markets tab.

Reads Kalshi's public market data (no account or key needed), finds every open draft series for the 2027 class,
and saves each event's outcomes with the last traded price (cents = percent chance) and volume to
tools/draft_data/markets.json. tools/draft_build.py matches the outcomes to players on the board and keeps only
player markets (team markets, like which team picks first, are dropped there).

Run by the Big Board workflow every morning. Safe to fail: the board builds without it.
"""
import json
import os
import re
import time
import urllib.parse
import urllib.request

BASE = "https://api.elections.kalshi.com/trade-api/v2"
UA = "Mozilla/5.0 (compatible; davidsolar-draft/1.0; +https://davidsolar.dev/draft/)"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "draft_data", "markets.json")


def get(path, **params):
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


def cents(m, *names):
    """A price in cents from whichever field the API uses (old: integer cents; new: '0.4600' dollar strings)."""
    for n in names:
        v = m.get(n)
        if v in (None, ""):
            v = m.get(n + "_dollars")
            if v not in (None, ""):
                try:
                    return round(float(v) * 100, 1)
                except ValueError:
                    continue
            continue
        try:
            return float(v)
        except (TypeError, ValueError):
            continue
    return None


def league_of(text):
    t = text.lower()
    if re.search(r"\bnba\b|basketball", t):
        return "nba"
    if re.search(r"\bnfl\b|football", t):
        return "nfl"
    return None


def main():
    seen, series = [], []
    cursor = None
    for _ in range(20):
        params = {"category": "Sports"}
        if cursor:
            params["cursor"] = cursor
        d = get("/series", **params)
        for s in d.get("series") or []:
            title = s.get("title") or ""
            if re.search(r"draft", title, re.I) or "DRAFT" in (s.get("ticker") or ""):
                series.append(s)
        cursor = d.get("cursor")
        if not cursor:
            break
    events = []
    for s in series:
        tk = s.get("ticker")
        try:
            d = get("/events", series_ticker=tk, status="open", with_nested_markets="true", limit=200)
        except Exception as e:  # one bad series shouldn't sink the rest
            seen.append({"series": tk, "error": str(e)[:80]})
            continue
        for e in d.get("events") or []:
            title = e.get("title") or ""
            sub = e.get("sub_title") or ""
            etk = e.get("event_ticker") or ""
            if "2027" not in title + sub and "-27" not in etk:
                continue
            lg = league_of(title + " " + (s.get("title") or "") + " " + tk)
            if not lg:
                continue
            outs = []
            for m in e.get("markets") or []:
                name = (m.get("yes_sub_title") or m.get("subtitle") or "").strip()
                if not name or m.get("status") not in (None, "active", "open", "initialized"):
                    continue
                # The midpoint of the bid and ask, since the last trade can be months old on a thin market.
                last = cents(m, "last_price")
                bid, ask = cents(m, "yes_bid"), cents(m, "yes_ask")
                price = round((bid + ask) / 2, 1) if bid is not None and ask else last
                vol = next((m.get(k) for k in ("volume", "volume_fp", "volume_24h") if m.get(k) not in (None, "")), 0)
                try:
                    vol = int(float(vol))
                except (TypeError, ValueError):
                    vol = 0
                outs.append({"name": name, "price": price, "last": last, "bid": bid, "ask": ask, "volume": vol})
            outs.sort(key=lambda o: -(o["price"] or 0))
            seen.append({"series": tk, "event": etk, "n": len(outs), "keys": sorted((e.get("markets") or [{}])[0].keys())[:60] if not seen else None})
            if outs:
                events.append({"league": lg, "series": tk, "event": etk, "title": title, "sub": sub,
                               "url": f"https://kalshi.com/markets/{tk.lower()}", "outcomes": outs})
        time.sleep(0.3)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    data = {"source": "Kalshi", "updated": time.strftime("%Y-%m-%d"), "events": events, "_seen": seen}
    old = None
    if os.path.exists(OUT):
        with open(OUT) as f:
            old = json.load(f)
    if old and {k: v for k, v in old.items() if k != "updated"} == {k: v for k, v in data.items() if k != "updated"}:
        print("Markets: no change")
        return
    with open(OUT, "w") as f:
        json.dump(data, f, indent=1)
    print(f"Markets: {len(events)} events from {len(series)} draft series")


if __name__ == "__main__":
    main()
