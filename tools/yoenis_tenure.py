#!/usr/bin/env python3
"""Who had whom, and for how long: tenure windows for every Wipe Yoenis trade and pickup.

A window opens the day after a player joins a team (a trade, or a free-agent or waiver pickup from Opening
Day on) and closes the day before he leaves it (dropped or traded away), or on the last day of the fantasy
season. Shared by tools/yoenis_slices_pull.py (which totals each window's stats from MLB game logs) and
the builders (tools/yoenis_trades_build.py, tools/yoenis_history_build.py), so they agree on every window.

Offseason trades (tools/yoenis_offseason_trades.py) get windows too, kind "off": from Opening Day, since
the player arrived over the winter.

windows(year) -> [{"kind": "trade"|"add"|"off", "ref": trade id, add index or offseason trade number, "team": Yahoo team key,
                   "name", "pos", "pk": (folded name, "b"|"p"), "start": date, "end": date,
                   "stays": True if he was still on that team when the season ended}, ...]
key(w) -> a stable string for a window, used to file its stats
"""
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from yoenis_yahoo_keepers import fold, side

ROOT = Path(__file__).resolve().parent.parent
HIST = ROOT / "tools" / "yahoo_yoenis" / "history"
TRADES = ROOT / "tools" / "yahoo_yoenis" / "trades.json"
EASTERN = ZoneInfo("America/New_York")
ONE = timedelta(days=1)


def pkey(name, pos):
    pit = any(x in (pos or "") for x in ("SP", "RP")) and "Util" not in (pos or "")
    return fold(name), side(name) or ("p" if pit else "b")


def day(ts):
    return datetime.fromtimestamp(ts, EASTERN).date()


def season_dates(year):
    h = json.loads((HIST / f"{year}.json").read_text(encoding="utf-8"))
    return date.fromisoformat(h["start"]), date.fromisoformat(h["end"]), h


def windows(year, _trades={}):
    if not (HIST / f"{year}.json").exists():
        return []
    start, end, h = season_dates(year)
    if not _trades and TRADES.exists():
        _trades.update(json.loads(TRADES.read_text(encoding="utf-8")))
    trades = [t for t in (_trades.get(str(year)) or {}).get("trades", []) if t["status"] == "successful"]

    # Every time a player left a team: dropped, or traded away
    leaves = {}
    for m in h["moves"]:
        if m["type"] == "drop" and m["team"]:
            leaves.setdefault((pkey(m["name"], m["pos"]), m["team"]), []).append(day(m["ts"]))
    for t in trades:
        for p in t["players"]:
            leaves.setdefault((pkey(p["name"], p["pos"]), p["from"]), []).append(day(t["ts"]))
    for v in leaves.values():
        v.sort()

    def window(kind, ref, team, name, pos, joined):
        pk = pkey(name, pos)
        left = next((d for d in leaves.get((pk, team), []) if d > joined), None)
        last = min(end, left - ONE) if left else end
        return {"kind": kind, "ref": ref, "team": team, "name": name, "pos": pos, "pk": pk,
                "start": max(joined + ONE, start), "end": last, "stays": left is None or left > end}

    out = []
    for i, ot in enumerate(offseason(year)):
        names = {v: k for k, v in h["teams"].items()}
        seasons = {s["year"]: s for s in _data()["seasons"]}
        s = seasons[year]
        for sd, gets in (("a", ot["ag"]), ("b", ot["bg"])):
            ti = s["o"].index(ot[sd])
            team = names.get(s["teams"][ti])
            for name in gets:
                nm, pos = resolve(h, name)
                if team:
                    w = window("off", i, team, nm, pos, start - ONE)
                    out.append(w)
    for t in trades:
        joined = day(t["ts"])
        for p in t["players"]:
            if p["to"]:
                out.append(window("trade", t["id"], p["to"], p["name"], p["pos"], joined))
    for i, m in enumerate(h["moves"]):
        if m["type"] != "add" or not m["team"]:
            continue
        got = day(m["ts"])
        if got < start or got > end:
            continue  # before Opening Day (keeper paperwork) or after the season
        out.append(window("add", i, m["team"], m["name"], m["pos"], got))
    return out


_cache = {}


def _data():
    if "data" not in _cache:
        _cache["data"] = json.loads((ROOT / "yoenis" / "data.json").read_text(encoding="utf-8"))
    return _cache["data"]


def offseason(year):
    """This season's offseason trades, in tools/yoenis_offseason_trades.py's order"""
    if "off" not in _cache:
        from yoenis_offseason_trades import trades
        _cache["off"] = trades(_data())
    return [t for t in _cache["off"] if t["y"] == year]


def resolve(h, name):
    """The season's own spelling and position for a player the sheet names ('Vinnie Pasquatino')"""
    from difflib import SequenceMatcher
    f = fold(name)
    best, score = None, 0.0
    for m in h["moves"]:
        r = 1.0 if fold(m["name"]) == f else SequenceMatcher(None, fold(m["name"]), f).ratio()
        if r > score:
            best, score = m, r
            if r == 1.0:
                break
    return (best["name"], best["pos"]) if best and score >= 0.85 else (name, None)


def key(w):
    return f"{w['pk'][0]}|{w['pk'][1]}|{w['start'].isoformat()}|{w['end'].isoformat()}"
