#!/usr/bin/env python3
"""Daily pull of outside dynasty rankings for Draft Lab's dynasty leagues.

Writes fantasy-kit/data/dynasty-nfl.json, dynasty-nba.json and dynasty-mlb.json:
  {"sport", "updated", "sources": [{"id", "name", "url", "n"}],
   "players": {kit id: [consensus rank, sources]}, "sf": {...}}   (sf: football superflex, when a source has it)

Sources:
  FantasyPros dynasty expert consensus (ECR), every sport: the rankings page carries its data as `var ecrData = {...}`.
  FantasyCalc dynasty values, football only: a public API built from real trades, keyed by Sleeper id like the kit.

Players are matched to the kit's pools (fantasy-kit/data/<sport>.json) by Sleeper id when there is one, otherwise by
name and position. A source that fails to load or parse is skipped and the log says which; if every source fails,
the last good file stays.

Run after tools/fantasykit_data.py (the Fantasy Kit data workflow does), or by hand:
  python3 tools/dynasty_pull.py
"""
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

FP = "https://www.fantasypros.com/"
# each sport's FantasyPros dynasty pages, tried in order until one parses
FP_PAGES = {
    "nfl": {"players": ["nfl/rankings/dynasty-overall.php"], "sf": ["nfl/rankings/dynasty-superflex.php"]},
    "nba": {"players": ["nba/rankings/dynasty.php", "nba/rankings/dynasty-overall.php"]},
    "mlb": {"players": ["mlb/rankings/dynasty.php", "mlb/rankings/dynasty-overall.php"]},
}
FC = "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs={qbs}&numTeams=12&ppr=1"
SKIP_POS = {"K", "DST", "DEF"}


def fetch(url, accept="text/html"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urllib.request.urlopen(req, timeout=40) as r:
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


def ecr(html):
    """FantasyPros' rankings as [(name, position, team, rank)], from the page's ecrData."""
    m = re.search(r"var\s+ecrData\s*=\s*(\{.*?\});\s*\n", html, re.S) or re.search(r"ecrData\s*=\s*(\{.*?\});", html, re.S)
    if not m:
        return []
    data = json.loads(m.group(1))
    out = []
    for p in data.get("players", []):
        pos = re.sub(r"\d+$", "", str(p.get("player_position_id") or p.get("pos_rank") or "")).upper()
        rank = p.get("rank_ecr") or p.get("rank_ave")
        if p.get("player_name") and rank:
            out.append((p["player_name"], pos, str(p.get("player_team_id") or "").upper(), float(rank)))
    return out


def fantasypros(sport, kind):
    for page in FP_PAGES[sport].get(kind, []):
        try:
            rows = ecr(fetch(FP + page))
        except Exception as e:
            print(f"  FantasyPros {page}: {type(e).__name__}: {e}")
            continue
        if len(rows) >= 50:
            print(f"  FantasyPros {page}: {len(rows)} players")
            return rows, FP + page
        print(f"  FantasyPros {page}: only {len(rows)} players, skipped")
    return [], None


def fantasycalc(qbs):
    try:
        rows = json.loads(fetch(FC.format(qbs=qbs), "application/json"))
    except Exception as e:
        print(f"  FantasyCalc ({qbs} QB): {type(e).__name__}: {e}")
        return []
    out = []
    for i, r in enumerate(sorted(rows, key=lambda r: -(r.get("value") or 0))):
        p = r.get("player") or {}
        if p.get("position") in SKIP_POS or str(p.get("position", "")).upper() == "PICK":
            continue
        out.append((p.get("name"), str(p.get("position") or "").upper(), str(p.get("maybeTeam") or "").upper(), float(i + 1), str(p.get("sleeperId") or "")))
    print(f"  FantasyCalc ({qbs} QB): {len(out)} players")
    return out


def matcher(pool):
    by_name = {}
    for p in pool:
        by_name.setdefault(norm(p["n"]), []).append(p)
    ids = {p["id"] for p in pool}

    def find(name, pos, team, sid=None):
        if sid and sid in ids:
            return sid
        cands = by_name.get(norm(name or ""), [])
        if len(cands) > 1 and pos:
            cands = [c for c in cands if pos in c["pos"] or (pos in ("SP", "RP", "P") and set(c["pos"]) & {"SP", "RP"})] or cands
        if len(cands) > 1 and team:
            cands = [c for c in cands if c.get("t", "").upper() == team] or cands
        return cands[0]["id"] if cands else None
    return find


def combine(lists, find):
    """Consensus: each player's ranks across sources, averaged; then ordered into 1, 2, 3..."""
    ranks = {}
    for rows in lists:
        for r in rows:
            if r[1] in SKIP_POS:
                continue
            pid = find(r[0], r[1], r[2], r[4] if len(r) > 4 else None)
            if pid:
                ranks.setdefault(pid, []).append(r[3])
    avg = sorted(((sum(v) / len(v), len(v), pid) for pid, v in ranks.items()), key=lambda x: x[0])
    return {pid: [i + 1, n] for i, (_, n, pid) in enumerate(avg)}


def build(sport):
    print(sport.upper())
    pool = (load(os.path.join(OUT, f"{sport}.json")) or {}).get("players", [])
    if not pool:
        print("  no player pool, skipped")
        return
    find, sources, lists, sf_lists = matcher(pool), [], [], []
    rows, url = fantasypros(sport, "players")
    if rows:
        lists.append(rows); sources.append({"id": "fantasypros", "name": "FantasyPros dynasty consensus", "url": url, "n": len(rows)})
    if sport == "nfl":
        fc1 = fantasycalc(1)
        if fc1:
            lists.append(fc1); sources.append({"id": "fantasycalc", "name": "FantasyCalc dynasty values", "url": "https://fantasycalc.com/dynasty-rankings", "n": len(fc1)})
        sf, sf_url = fantasypros(sport, "sf")
        if sf:
            sf_lists.append(sf)
        fc2 = fantasycalc(2)
        if fc2:
            sf_lists.append(fc2)
    if not lists:
        print("  every source failed; kept the last file")
        return
    out = {"sport": sport, "updated": NOW, "sources": sources, "players": combine(lists, find)}
    if sf_lists:
        out["sf"] = combine(sf_lists, find)
    print(f"  matched {len(out['players'])} of the kit's {len(pool)} players" + (f", superflex {len(out['sf'])}" if "sf" in out else ""))
    with open(os.path.join(OUT, f"dynasty-{sport}.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    for s in ("nfl", "nba", "mlb"):
        try:
            build(s)
        except Exception as e:
            print(f"{s}: {type(e).__name__}: {e}")
