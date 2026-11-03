#!/usr/bin/env python3
"""Daily pull of what the market says, for Draft Lab's tables and draft room.

Writes fantasy-kit/data/market-nfl.json, market-nba.json and market-mlb.json:
  {"sport", "updated", "source", "players": {kit id: {"r": {rank type: rank}, "a": {rank type: auction value},
                                                     "adp": ESPN average draft position, "aav": ESPN average auction price,
                                                     "own": percent rostered on ESPN, "add": Sleeper adds in the last day}}}

ESPN's public fantasy API (lm-api-reads.fantasy.espn.com, no key): its draft ranks and auction values by rank type
(STANDARD, PPR, SUPERFLEX for football; STANDARD and ROTO for basketball and baseball), and from real ESPN leagues
the average draft position, average auction price and how many leagues roster each player. Sleeper's trending adds
(football) ride along. Football matches by id (DynastyProcess' table maps ESPN ids to Sleeper ids, the kit's), the
other sports by name and position. A source that fails keeps the last good file.

Run after tools/fantasykit_data.py (the Fantasy Kit data workflow does), or by hand:
  python3 tools/market_pull.py
"""
import csv
import io
import json
import os
import re
import unicodedata
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "fantasy-kit", "data")
UA = "Mozilla/5.0 (compatible; davidsolar-draftlab/1.0; +https://davidsolar.dev/fantasy-kit/)"
NOW = datetime.now(timezone.utc).isoformat(timespec="seconds")
ESPN = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/{game}/seasons/{season}/segments/0/leaguedefaults/3?view=kona_player_info"
# each sport's ESPN game, the seasons to try (the newest first), and the rank type to sort by
GAMES = {"nfl": ("ffl", (2026,), "PPR"), "nba": ("fba", (2027,), "STANDARD"), "mlb": ("flb", (2027,), "STANDARD")}   # last season's ranks go stale once it ends
DP_IDS = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"
SLEEPER_TRENDING = "https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=100"
# ESPN's default position ids
POS = {"nfl": {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF"},
       "nba": {1: "PG", 2: "SG", 3: "SF", 4: "PF", 5: "C"},
       "mlb": {1: "SP", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "OF", 8: "OF", 9: "OF", 10: "UT", 11: "RP"}}


def fetch(url, headers=None, accept="application/json"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept, **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def norm(n):
    n = unicodedata.normalize("NFKD", str(n)).encode("ascii", "ignore").decode().lower()
    n = re.sub(r"[.'`]", "", n)
    n = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", n)
    return re.sub(r"[^a-z]+", " ", n).strip()


def load(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def espn(sport):
    game, seasons, sort = GAMES[sport]
    flt = json.dumps({"players": {"limit": 1500, "sortDraftRanks": {"sortPriority": 100, "sortAsc": True, "value": sort}}})
    for season in seasons:
        try:
            ps = json.loads(fetch(ESPN.format(game=game, season=season), {"X-Fantasy-Filter": flt})).get("players", [])
        except Exception as e:
            print(f"  ESPN {game} {season}: {type(e).__name__}: {e}")
            continue
        ranked = [p for p in ps if ((p.get("player") or {}).get("draftRanksByRankType") or {}).get(sort, {}).get("rank")]
        if len(ranked) >= 100:
            print(f"  ESPN {game} {season}: {len(ps)} players, {len(ranked)} ranked")
            return ps, season
        print(f"  ESPN {game} {season}: only {len(ranked)} ranked, skipped")
    return [], None


def espn_to_sleeper():
    try:
        rows = csv.DictReader(io.StringIO(fetch(DP_IDS, accept="text/csv")))
        return {r["espn_id"]: r["sleeper_id"] for r in rows if r.get("espn_id") not in (None, "", "NA") and r.get("sleeper_id") not in (None, "", "NA")}
    except Exception as e:
        print(f"  DynastyProcess ids: {type(e).__name__}: {e}")
        return {}


def build(sport):
    print(sport.upper())
    pool = (load(os.path.join(OUT, f"{sport}.json")) or {}).get("players", [])
    if not pool:
        print("  no player pool, skipped")
        return
    rows, season = espn(sport)
    if not rows:
        print("  no current ESPN season; kept the last file")
        return
    ids = {p["id"] for p in pool}
    by_name = {}
    for p in pool:
        by_name.setdefault(norm(p["n"]), []).append(p)
    xwalk = espn_to_sleeper() if sport == "nfl" else {}
    out = {}
    for r in rows:
        pl = r.get("player") or {}
        pos = POS[sport].get(pl.get("defaultPositionId"))
        pid = xwalk.get(str(pl.get("id"))) if sport == "nfl" else None
        if not (pid and pid in ids):
            cands = by_name.get(norm(pl.get("fullName", "")), [])
            if len(cands) > 1 and pos:
                cands = [c for c in cands if pos in c["pos"] or (pos in ("SP", "RP") and set(c["pos"]) & {"SP", "RP"})] or cands
            pid = cands[0]["id"] if cands else None
        if not pid or pid in out:
            continue
        ranks = pl.get("draftRanksByRankType") or {}
        own = pl.get("ownership") or {}
        row = {"r": {k: v["rank"] for k, v in ranks.items() if v.get("rank")}, "a": {k: v["auctionValue"] for k, v in ranks.items() if v.get("auctionValue")}}
        if own.get("averageDraftPosition") and own["averageDraftPosition"] < 250:
            row["adp"] = round(own["averageDraftPosition"], 1)
        if own.get("auctionValueAverage") and own["auctionValueAverage"] >= 1:
            row["aav"] = round(own["auctionValueAverage"], 1)
        if own.get("percentOwned") is not None:
            row["own"] = round(own["percentOwned"], 1)
        if row["r"] or row.get("adp") or row.get("own"):
            out[pid] = row
    if sport == "nfl":
        try:
            for t in json.loads(fetch(SLEEPER_TRENDING)):
                pid = str(t.get("player_id"))
                if pid in ids:
                    out.setdefault(pid, {"r": {}, "a": {}})["add"] = t.get("count")
        except Exception as e:
            print(f"  Sleeper trending: {type(e).__name__}: {e}")
    print(f"  matched {len(out)} of the kit's {len(pool)} players")
    with open(os.path.join(OUT, f"market-{sport}.json"), "w", encoding="utf-8") as f:
        json.dump({"sport": sport, "updated": NOW, "source": f"ESPN fantasy ({season})" + (", Sleeper trending adds" if sport == "nfl" else ""), "players": out},
                  f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    for s in ("nfl", "nba", "mlb"):
        try:
            build(s)
        except Exception as e:
            print(f"{s}: {type(e).__name__}: {e}")
