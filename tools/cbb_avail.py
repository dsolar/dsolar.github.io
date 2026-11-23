#!/usr/bin/env python3
"""Who missed his team's last game: cbb/data/avail.json, for the CBB Hub's injury adjustments.

There is no complete college injury feed, so this reads ESPN's box score for each team's last two finished games and
flags rotation players (15+ minutes a game over 2+ games) who did not play, or weren't in the box score at all, in the
most recent one, with how many straight games they've missed. ESPN's own injury notes are kept when a summary has them.
Box scores are cached by game id, so each finished game is fetched once.
"""
import json
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "cbb/data/avail.json"
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event="
UA = "davidsolar-cbbhub/1.0 (+https://davidsolar.dev/cbb/)"
ROT_MIN, ROT_GP, LOOKBACK_DAYS, KEEP_DAYS = 15, 2, 21, 30


def read(p, default):
    try:
        return json.loads(p.read_text())
    except Exception:
        return default


def get(url):
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.load(r)
        except Exception:
            time.sleep(1.5 * (i + 1))
    return None


def box_of(summary):
    """team id -> {"p": ids who played, "d": ids listed as did-not-play, "inj": {id: note}}"""
    out = {}
    for side in ((summary or {}).get("boxscore") or {}).get("players") or []:
        tid = str((side.get("team") or {}).get("id") or "")
        played, dnp = [], []
        for block in side.get("statistics") or []:
            for a in block.get("athletes") or []:
                pid = str((a.get("athlete") or {}).get("id") or "")
                if not pid:
                    continue
                (dnp if a.get("didNotPlay") or not a.get("stats") else played).append(pid)
        out[tid] = {"p": played, "d": dnp, "inj": {}}
    for side in (summary or {}).get("injuries") or []:
        tid = str((side.get("team") or {}).get("id") or "")
        for i in side.get("injuries") or []:
            pid = str((i.get("athlete") or {}).get("id") or "")
            note = " ".join(x for x in [i.get("status"), (i.get("details") or {}).get("type")] if x)
            if pid and tid in out:
                out[tid]["inj"][pid] = note
    return out


def main():
    hub = read(ROOT / "cbb/data/hub.json", {})
    sched = read(ROOT / "cbb/data/schedule.json", {})
    old = read(OUT, {})
    cache = old.get("box", {})
    now = datetime.now(timezone.utc)
    lo = (now - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    games = {}
    for g in (sched.get("games") or []) + (hub.get("games") or []):
        if g.get("state") == "post" and str(g.get("id", "")).isdigit() and g.get("day", "") >= lo:
            games[g["id"]] = g
    by_team = {}
    for g in sorted(games.values(), key=lambda g: (g["day"], g.get("at") or "")):
        for side in ("home", "away"):
            by_team.setdefault(g[side], []).append(g)
    need = sorted({g["id"] for gs in by_team.values() for g in gs[-2:]} - set(cache))
    fetched = 0
    for gid in need:
        s = get(SUMMARY + gid)
        if s is None:
            continue
        cache[gid] = {"day": games[gid]["day"], "t": box_of(s)}
        fetched += 1
        time.sleep(0.15)
    players = {}
    for p in hub.get("players") or []:
        st = p.get("stats") or {}
        if (st.get("gp") or 0) >= ROT_GP and (st.get("min") or 0) >= ROT_MIN:
            players.setdefault(str(p.get("teamId")), []).append(p)
    teams = {}
    for tid, gs in by_team.items():
        recent = [g for g in gs[-2:] if g["id"] in cache][::-1]          # newest first
        if not recent or tid not in cache[recent[0]["id"]]["t"]:
            continue
        out = []
        for p in players.get(tid, []):
            pid = str(p["id"]); missed = 0; note = ""
            for g in recent:
                b = cache[g["id"]]["t"].get(tid)
                if not b:
                    break
                note = note or b["inj"].get(pid, "")
                if pid in b["p"]:
                    break
                missed += 1
            if missed:
                out.append({"id": pid, "n": p.get("name"), "m": missed, "note": note})
        teams[tid] = {"last": recent[0]["id"], "day": recent[0]["day"], "out": out}
    keep = (now - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    cache = {gid: v for gid, v in cache.items() if v.get("day", "") >= keep}
    body = {"updated": now.strftime("%Y-%m-%dT%H:%MZ"), "teams": teams, "box": cache}
    OUT.write_text(json.dumps(body, separators=(",", ":")))
    flagged = sum(len(t["out"]) for t in teams.values())
    print(f"box scores fetched {fetched} of {len(need)} needed; teams with a box score {len(teams)}; rotation players out last game {flagged}")


if __name__ == "__main__":
    main()
