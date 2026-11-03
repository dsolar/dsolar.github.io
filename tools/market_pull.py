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
# FantasyPros expert consensus: rest of season while a sport is playing, the draft rankings otherwise. Each page's
# data rides along as `ecrData`. Football has one per scoring.
FP = "https://www.fantasypros.com/"
FP_PAGES = {"nfl": {"STANDARD": "nfl/rankings/ros-overall.php", "HALF": "nfl/rankings/ros-half-point-ppr-overall.php", "PPR": "nfl/rankings/ros-ppr-overall.php"},
            "nba": {"ALL": "nba/rankings/ros-overall.php"}, "mlb": {"ALL": "mlb/rankings/overall.php"}}
FP_KIND = {"nfl": "rest of season", "nba": "rest of season", "mlb": "draft"}
# FantasyCalc's redraft values: what players go for in real trades this season, by points per catch and QB count
FC = "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs={qbs}&numTeams=12&ppr={ppr}"
DP_FP = "fantasypros_id"
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


def to_sleeper(col):
    """{another site's id: Sleeper id} from DynastyProcess' id table, for one of its columns (espn_id, fantasypros_id)."""
    try:
        rows = csv.DictReader(io.StringIO(fetch(DP_IDS, accept="text/csv")))
        return {r[col]: r["sleeper_id"] for r in rows if r.get(col) not in (None, "", "NA") and r.get("sleeper_id") not in (None, "", "NA")}
    except Exception as e:
        print(f"  DynastyProcess ids: {type(e).__name__}: {e}")
        return {}


def espn_to_sleeper():
    return to_sleeper("espn_id")


def fantasypros(sport, find):
    """{kit id: {rank type: consensus rank}} from FantasyPros, and how many experts' pages loaded."""
    xw = to_sleeper(DP_FP) if sport == "nfl" else {}
    out, n = {}, 0
    for kind, page in FP_PAGES[sport].items():
        try:
            m = re.search(r"ecrData\s*=\s*(\{.*?\});", fetch(FP + page), re.S)
            rows = json.loads(m.group(1)).get("players", []) if m else []
        except Exception as e:
            print(f"  FantasyPros {page}: {type(e).__name__}: {e}")
            continue
        if len(rows) < 50:
            print(f"  FantasyPros {page}: only {len(rows)} players, skipped")
            continue
        n += 1
        hit = 0
        for r in rows:
            pos = re.sub(r"\d+$", "", str(r.get("player_position_id") or r.get("primary_position") or "")).upper()
            pid = find(r.get("player_name"), pos, xw.get(str(r.get("player_id"))))
            if pid and r.get("rank_ecr"):
                out.setdefault(pid, {})[kind] = int(r["rank_ecr"]); hit += 1
        print(f"  FantasyPros {page}: {len(rows)} players, {hit} matched")
    return out, n


def fantasycalc_redraft(ids):
    out = {}
    for qbs in (1, 2):
        for ppr in (0, 0.5, 1):
            try:
                rows = json.loads(fetch(FC.format(qbs=qbs, ppr=ppr)))
            except Exception as e:
                print(f"  FantasyCalc redraft ({qbs} QB, {ppr} PPR): {type(e).__name__}: {e}")
                continue
            rows = [r for r in rows if str((r.get("player") or {}).get("position", "")).upper() not in ("PICK", "K", "DST", "DEF")]
            rows.sort(key=lambda r: -(r.get("value") or 0))
            for i, r in enumerate(rows):
                sid = str((r.get("player") or {}).get("sleeperId") or "")
                if sid in ids:
                    out.setdefault(sid, {})[f"{ppr}|{qbs}"] = i + 1
    print(f"  FantasyCalc redraft: {len(out)} players")
    return out


def build(sport):
    print(sport.upper())
    pool = (load(os.path.join(OUT, f"{sport}.json")) or {}).get("players", [])
    if not pool:
        print("  no player pool, skipped")
        return
    rows, season = espn(sport)
    if not rows:
        print("  no current ESPN season; FantasyPros only")
    ids = {p["id"] for p in pool}
    by_name = {}
    for p in pool:
        by_name.setdefault(norm(p["n"]), []).append(p)
    xwalk = espn_to_sleeper() if sport == "nfl" else {}

    def find(name, pos, sid=None):
        if sid and sid in ids:
            return sid
        cands = by_name.get(norm(name or ""), [])
        if len(cands) > 1 and pos:
            cands = [c for c in cands if pos in c["pos"] or (pos in ("SP", "RP", "P") and set(c["pos"]) & {"SP", "RP"})] or cands
        return cands[0]["id"] if cands else None
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
    # the experts' consensus, and for football the trade market
    fp, pages = fantasypros(sport, find)
    for pid, ranks in fp.items():
        out.setdefault(pid, {"r": {}, "a": {}})["fp"] = ranks
    if sport == "nfl":
        for pid, ranks in fantasycalc_redraft(ids).items():
            out.setdefault(pid, {"r": {}, "a": {}})["tr"] = ranks
    print(f"  matched {len(out)} of the kit's {len(pool)} players")
    with open(os.path.join(OUT, f"market-{sport}.json"), "w", encoding="utf-8") as f:
        json.dump({"sport": sport, "updated": NOW, "source": ", ".join(x for x in [f"ESPN fantasy ({season})" if season else "", "FantasyPros consensus" if pages else "", "FantasyCalc trades" if sport == "nfl" else "", "Sleeper trending adds" if sport == "nfl" else ""] if x),
                   "fp": FP_KIND[sport] if pages else None, "players": out},
                  f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    for s in ("nfl", "nba", "mlb"):
        try:
            build(s)
        except Exception as e:
            print(f"{s}: {type(e).__name__}: {e}")
