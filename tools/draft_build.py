#!/usr/bin/env python3
"""The Big Board (draft/): one consensus ranking per league from every outlet's board.

Reads
  tools/draft_sources.json          the outlets, their weights and whether they've published yet
  tools/draft_boards/<lg>/<id>/*.json  dated snapshots, one file per board version (rank, name, school, pos[, team])
  tools/draft_aliases.json          spellings that point at the same player
  hardcap/prospects.json            Tankathon's daily readings, already pulled for Hard Cap

Writes draft/nba.json and draft/nfl.json.

How the consensus works
  - Each board counts at its weight, halved for every 90 days since it was published, so an August board fades
    as the season's boards come in.
  - A player a board leaves out counts as ranked one past the end of that board, but never better than his average
    elsewhere and never more than half again worse (10 spots at least). SI's Top 30 can't push down a player
    everyone has at 45, a Top 100 that skips a player still costs him, and one board leaving out a consensus
    top-10 guy (an injury, a class call) costs him a few spots, not 80. A player most boards leave out gets the
    full one-past-the-end count from each of them.
  - Spread is his best rank minus his worst across the boards that rank him: the disagreement number.
  - The consensus is recomputed for every date any board changed, which is where the movement comes from.
Mock drafts don't feed the rank. They're kept per player (pick and team) for the simulator.
"""
import json
import os
import re
import sys
import unicodedata
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
OUT = os.path.join(ROOT, "draft")
HALF_LIFE = 90
YEAR = 2027
SUFFIX = {"jr", "sr", "ii", "iii", "iv", "v"}


def key(name):
    n = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    n = re.sub(r"[.'’]", "", n)
    parts = [p for p in re.split(r"[^a-z0-9]+", n) if p and p not in SUFFIX]
    return "-".join(parts)


def load(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def snapshots(league, sid):
    d = os.path.join(TOOLS, "draft_boards", league, sid)
    out = []
    if os.path.isdir(d):
        for fn in sorted(os.listdir(d)):
            if fn.endswith(".json"):
                s = load(os.path.join(d, fn))
                if s and s.get("ranks"):
                    out.append(s)
    return out


def tankathon(league="nba"):
    """Hard Cap's daily Tankathon readings as snapshots (NBA). The NFL board's readings are ordinary snapshot files. Names come from the latest board; older ids that dropped
    off it are rebuilt from the slug."""
    data = load(os.path.join(ROOT, "hardcap", "prospects.json"), {}) or {}
    info = {r["id"]: r for r in data.get("board", [])}
    out = []
    for day, ranks in sorted((data.get("hist") or {}).items()):
        rows = []
        for pid, r in sorted(ranks.items(), key=lambda x: x[1]):
            b = info.get(pid, {})
            name = b.get("n") or " ".join(w.capitalize() for w in pid.split("-"))
            rows.append([r, name, b.get("school", ""), b.get("pos", "")])
        out.append({"date": day, "url": data.get("source", "https://www.tankathon.com/big_board"),
                    "title": "Tankathon big board", "ranks": rows})
    return out


def days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def build(league, sources, aliases):
    alias = aliases.get(league, {})
    canon = lambda n: alias.get(key(n), key(n))
    snaps = {}
    for s in sources:
        snaps[s["id"]] = tankathon() if (s["id"] == "tankathon" and league == "nba") else snapshots(league, s["id"])
    boards = [s for s in sources if s["kind"] == "board"]
    mocks = [s for s in sources if s["kind"] == "mock"]

    # Player details: Tankathon's spelling first (it's the one Hard Cap uses), then the most common one.
    names, school, pos = {}, {}, {}
    order = sorted(sources, key=lambda s: s["id"] != "tankathon")
    for s in order:
        for snap in reversed(snaps[s["id"]]):
            for row in snap["ranks"]:
                k = canon(row[1])
                names.setdefault(k, {}).setdefault(row[1], 0)
                names[k][row[1]] += (1000 if s["id"] == "tankathon" else 1) + (0.5 if key(row[1]) == k else 0)
                if row[2] and k not in school:
                    school[k] = row[2]
                if len(row) > 3 and row[3] and k not in pos and s["id"] != "si":
                    pos[k] = row[3]

    def asof(sid, d):
        best = None
        for snap in snaps[sid]:
            if snap["date"] <= d:
                best = snap
        return best

    def consensus(d):
        live = []
        for s in boards:
            snap = asof(s["id"], d)
            if not snap:
                continue
            w = s.get("weight", 1) * 0.5 ** (max(0, days(snap["date"], d)) / HALF_LIFE)
            ranks = {}
            for row in snap["ranks"]:
                ranks.setdefault(canon(row[1]), row[0])
            live.append((s, snap, w, ranks, len(snap["ranks"])))
        if not live:
            return {}, live
        players = set().union(*[x[3].keys() for x in live])
        res = {}
        for p in players:
            present = [x[3][p] for x in live if p in x[3]]
            avg = sum(present) / len(present)
            tot = wsum = 0.0
            for s, snap, w, ranks, n in live:
                r = ranks.get(p)
                if r is None:
                    full = max(n + 1, avg)
                    r = full if len(present) * 2 < len(live) else max(avg, min(n + 1, avg + max(10, avg / 2)))
                tot += w * r
                wsum += w
            res[p] = {"score": tot / wsum, "on": len(present), "hi": min(present), "lo": max(present)}
        ordered = sorted(res, key=lambda p: (res[p]["score"], -res[p]["on"], res[p]["hi"], p))
        for i, p in enumerate(ordered):
            res[p]["rank"] = i + 1
        return res, live

    dates = sorted({snap["date"] for s in boards for snap in snaps[s["id"]]})
    if not dates:
        return None
    today = dates[-1]
    now, live = consensus(today)
    hist = {d: consensus(d)[0] for d in dates}

    mock_now = {}
    for s in mocks:
        snap = asof(s["id"], today) or (snaps[s["id"]][-1] if snaps[s["id"]] else None)
        if not snap:
            continue
        for row in snap["ranks"]:
            mock_now.setdefault(canon(row[1]), {})[s["id"]] = [row[0], row[4] if len(row) > 4 else ""]

    info = (load(os.path.join(TOOLS, "draft_data", f"{league}-info.json"), {}) or {}).get("players", {})
    info = {canon(k): v for k, v in info.items()} | {}
    schools = (load(os.path.join(TOOLS, "draft_schools.json"), {}) or {}).get(league, {})
    players = []
    for p, c in sorted(now.items(), key=lambda x: x[1]["rank"]):
        per = {}
        for s, snap, w, ranks, n in live:
            if p in ranks:
                per[s["id"]] = ranks[p]
        players.append({
            "id": p,
            "n": max(names.get(p, {p: 1}).items(), key=lambda x: x[1])[0],
            "school": school.get(p, ""),
            "pos": pos.get(p, ""),
            "rank": c["rank"],
            "score": round(c["score"], 2),
            "on": c["on"],
            "hi": c["hi"],
            "lo": c["lo"],
            "ranks": per,
            "mocks": mock_now.get(p, {}),
            "hist": [hist[d][p]["rank"] if p in hist[d] else None for d in dates],
        })
        x = info.get(p, {})
        for k2 in ("ht", "wt", "yr", "age", "flag", "stats"):
            if x.get(k2):
                players[-1][k2] = x[k2]
        sid = schools.get(players[-1]["school"])
        if sid:
            players[-1]["sid"] = sid

    src_out = []
    for s in sources:
        latest = snaps[s["id"]][-1] if snaps[s["id"]] else None
        w_now = next((round(w, 3) for x, snap, w, r, n in live if x["id"] == s["id"]), None)
        src_out.append({k: s[k] for k in ("id", "name", "analyst", "abbr", "kind", "weight", "url", "status", "note") if k in s} | (
            {"date": latest["date"], "link": latest.get("url"), "title": latest.get("title"), "count": len(latest["ranks"]),
             "versions": len(snaps[s["id"]]), "w": w_now} if latest else {}))
    teams = (load(os.path.join(TOOLS, "draft_teams.json"), {}) or {}).get(league, {})
    order = load(os.path.join(TOOLS, "draft_data", f"{league}-order.json"), {}) or {}
    records = (load(os.path.join(TOOLS, "draft_data", "records.json"), {}) or {}).get(league, {})
    rules = (load(os.path.join(TOOLS, "draft_rules.json"), {}) or {}).get(league)
    return {"league": league, "year": YEAR, "asof": today, "halfLife": HALF_LIFE, "dates": dates,
            "sources": src_out, "teams": teams, "records": records,
            "order": {"updated": order.get("updated"), "source": order.get("source"), "picks": order.get("picks", [])},
            "rules": rules, "players": players,
            "values": (load(os.path.join(TOOLS, "draft_values.json"), {}) or {}).get(league),
            "future": (load(os.path.join(TOOLS, "draft_future.json"), {}) or {}).get(league),
            "needs": (load(os.path.join(TOOLS, "draft_needs.json"), {}) or {}).get(league)}


def main():
    reg = load(os.path.join(TOOLS, "draft_sources.json"))
    aliases = load(os.path.join(TOOLS, "draft_aliases.json"), {})
    os.makedirs(OUT, exist_ok=True)
    for league in ("nba", "nfl"):
        res = build(league, reg[league], aliases)
        if not res:
            print(f"{league}: no boards yet")
            continue
        res["excluded"] = reg.get("excluded", {}) if league == "nfl" else {}
        path = os.path.join(OUT, f"{league}.json")
        old = load(path, {}) or {}
        old_updated = old.pop("updated", None)
        if old == res and old_updated:
            print(f"{league}: no change since {old_updated}")
            continue
        res["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
        live = [s["abbr"] for s in res["sources"] if s.get("w")]
        print(f"{league}: {len(res['players'])} players from {len(live)} boards ({', '.join(live)}), "
              f"{len(res['dates'])} dates, top 5: {', '.join(p['n'] for p in res['players'][:5])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
