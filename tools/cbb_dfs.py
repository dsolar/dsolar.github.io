#!/usr/bin/env python3
"""College basketball for Draft Lab's one-day games (salary cap, drafts), from the CBB Hub's snapshot. No network.

Runs after tools/cbb_build.py and tools/cbb_extras.py and writes:
  fantasy-kit/data/cbb.json        the player pool, in the Fantasy Kit's shape: each player's season per-game line (pg),
                                   and a one-game projection (ppg) scaled by his team's projected points in its next game
  fantasy-kit/data/weeks-cbb.json  the (empty) weekly file the league clock expects; one-day games score from box scores
  cbb/data/dfs.json                today's and tomorrow's featured games (the best 14 by the hub's watchability), which
                                   the fk-live relay serves as the night's slates
"""
import json, math, re, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cbb_extras import line, league_average, num, mean  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
NY = ZoneInfo("America/New_York")
COLS = ["gp", "eg", "min", "fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "ast", "stl", "blk", "tov", "oreb", "dreb", "pf", "tpa", "pm", "dd", "td"]
SCALE = {"fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "ast", "stl", "blk", "tov", "oreb", "dreb", "tpa", "dd", "td"}
FEATURED = 14


def read(p, d=None):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return d


def inches(txt):
    """ESPN's display height ('6\' 4"') in inches."""
    m = re.match(r"\s*(\d)\D+(\d{1,2})", str(txt or ""))
    return int(m.group(1)) * 12 + int(m.group(2)) if m else None


def pounds(txt):
    m = re.match(r"\s*(\d{2,3})", str(txt or ""))
    return int(m.group(1)) if m else None


def watch(h, a, ln, pct):
    """The hub's watchability, as on the Today page: team quality, a close line, pace."""
    if not ln:
        return 0
    q = (pct.get(h["id"], 0) + pct.get(a["id"], 0)) / 2
    close = 1 - abs(ln["homeProb"] - 0.5) * 2
    return round(0.5 * q + 30 * close + (4 if h.get("conference") == a.get("conference") else 0))


def main():
    hub = read(ROOT / "cbb/data/hub.json")
    sched = read(ROOT / "cbb/data/schedule.json", {}) or {}
    if not hub:
        sys.exit("cbb/data/hub.json missing")
    teams = {t["id"]: t for t in hub["teams"]}
    avg = league_average(hub["teams"])
    nets = sorted((num(t["metrics"].get("adjO")) - num(t["metrics"].get("adjD")), t["id"]) for t in hub["teams"] if num(t["metrics"].get("adjO")) is not None and num(t["metrics"].get("adjD")) is not None)
    pct = {tid: 100 * (i + 1) / len(nets) for i, (_, tid) in enumerate(nets)}
    now = datetime.now(timezone.utc)
    today = now.astimezone(NY).date()
    # today and the next two days: the schedule job can run hours late, and a morning run that never came shouldn't
    # leave only last night's games on the board
    days = [(today + timedelta(days=k)).isoformat() for k in range(3)]
    season = hub.get("seasonLabel") or f"{hub['season'] - 1}-{str(hub['season'])[2:]}"

    # each team's points a game so far, and its projected points in its next game (today or tomorrow)
    scored = {}
    for g in sched.get("games", []):
        if g.get("state") == "post" and g.get("hs") is not None:
            scored.setdefault(g["home"], []).append(g["hs"])
            scored.setdefault(g["away"], []).append(g["as"])
    avg_pts = {tid: mean(v) for tid, v in scored.items()}
    nxt = {}
    by_day = {d: [] for d in days}
    for g in sched.get("games", []):
        if g["day"] not in by_day or g.get("state") == "off" or g.get("post"):
            continue
        h, a = teams.get(g["home"]), teams.get(g["away"])
        if not h or not a:
            continue
        ln = line(h, a, bool(g.get("neutral")), avg)
        by_day[g["day"]].append((g, h, a, ln))
        if ln and g.get("state") == "pre":
            for tid, pts in ((h["id"], ln["homePts"]), (a["id"], ln["awayPts"])):
                if tid not in nxt:
                    nxt[tid] = pts

    # featured games: the best by watchability, the evening's marquee slate
    out_days = []
    for d in days:
        rows = sorted(by_day[d], key=lambda r: -watch(r[1], r[2], r[3], pct))[:FEATURED]
        rows.sort(key=lambda r: r[0].get("at") or d)
        out_days.append({"day": d, "games": [{"id": g["id"], "at": g.get("at"), "away": a["abbr"], "home": h["abbr"], "state": g.get("state", "pre"),
                                              "watch": watch(h, a, ln, pct), "spread": ln and ln["spread"], "total": ln and ln["total"]} for g, h, a, ln in rows if g.get("at")]})
    (ROOT / "cbb/data/dfs.json").write_text(json.dumps({"sport": "cbb", "season": season, "updated": now.isoformat(), "featured": FEATURED, "days": out_days}, separators=(",", ":")) + "\n")

    # last season's per-game lines (tools/cbb_build.py, cbb/data/prev.json), in the pool's columns
    pv = read(ROOT / "cbb/data/prev.json", {}) or {}
    prev = {}
    for aid, s in (pv.get("players") or {}).items():
        gp = num(s.get("gp"))
        if not gp:
            continue
        g = lambda k: num(s.get(k)) or 0
        row = {"gp": gp, "eg": 0, "min": g("min"), "fgm": g("fgm"), "fga": g("fga"), "ftm": g("ftm"), "fta": g("fta"), "tpm": g("tpm"), "pts": g("pts"), "reb": g("reb"),
               "ast": g("ast"), "stl": g("stl"), "blk": g("blk"), "tov": g("tov"), "oreb": 0, "dreb": g("reb"), "pf": g("pf"), "tpa": g("threeAtt"), "pm": 0, "dd": g("dd") / gp, "td": 0}
        prev[aid] = [round(row[c], 1) for c in COLS]

    # the player pool: anyone who has played real minutes
    players = []
    for p in hub["players"]:
        s, t = p.get("stats") or {}, teams.get(p["teamId"])
        gp, mins = num(s.get("gp")), num(s.get("min"))
        if not t or not gp or not mins or mins < 10:
            continue
        g = lambda k: num(s.get(k)) or 0
        dd = (num(s.get("dd")) or 0) / gp
        row = {"gp": gp, "eg": 0, "min": mins, "fgm": g("fgm"), "fga": g("fga"), "ftm": g("ftm"), "fta": g("fta"), "tpm": g("tpm"), "pts": g("pts"), "reb": g("reb"),
               "ast": g("ast"), "stl": g("stl"), "blk": g("blk"), "tov": g("tov"), "oreb": 0, "dreb": g("reb"), "pf": g("pf"), "tpa": g("threeAtt"), "pm": 0, "dd": dd, "td": 0}
        # eg 0: the season line carries no weight against the projection, which value.js blends in like 15 games
        base, imp = avg_pts.get(t["id"]), nxt.get(t["id"])
        k = max(0.8, min(1.2, imp / base)) if base and imp else 1.0
        proj = [round(row[c] * k, 2) if c in SCALE else (0 if c in ("gp", "eg") else round(row[c], 2)) for c in COLS]
        pos = {"G": ["G"], "F": ["F"], "C": ["F"]}.get((p.get("pos") or "G")[:1], ["G"])
        rec = {"id": p["id"], "n": p["name"], "t": t["abbr"], "pos": pos, "l": {"pg": [round(row[c], 1) for c in COLS], "ppg": [round(x, 1) for x in proj]}, "espn": p["id"],
               "school": t["short"], "yr": (p.get("year") or "")[:2]}
        if num(p.get("draftRank")):
            rec["bb"] = int(p["draftRank"])
        ht, wt = inches(p.get("height")), pounds(p.get("weight"))
        if ht:
            rec["ht"] = ht
        if wt:
            rec["wt"] = wt
        if prev.get(p["id"]):
            rec["l0"] = {"pg": prev[p["id"]]}
        players.append(rec)
    pool = {"sport": "cbb", "season": season, "prev": pv.get("label") if prev else None, "updated": now.isoformat(), "source": "ESPN season stats via the CBB Hub; projections scale each player's line by his team's projected points next game",
            "lines": {"pg": {"label": "Per game", "cols": COLS}, "ppg": {"label": "Next game projection", "cols": COLS, "proj": True}},
            "teams": {t["abbr"]: {"n": t["short"], "c": t.get("color"), "logo": t.get("logo"), "conf": t.get("conference")} for t in hub["teams"]},
            "players": players}
    (ROOT / "fantasy-kit/data/cbb.json").write_text(json.dumps(pool, ensure_ascii=False, separators=(",", ":")) + "\n")
    # weeks-cbb.json (real Monday-Sunday weeks for season-long leagues) is tools/fantasykit_cbb.mjs's, in the Fantasy Kit data run
    print(json.dumps({"players": len(players), "featured": {d["day"]: len(d["games"]) for d in out_days}, "matchups": len(nxt)}))


if __name__ == "__main__":
    main()
