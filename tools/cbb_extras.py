#!/usr/bin/env python3
"""College Basketball Hub extras, built from the normalized snapshot (cbb/data/hub.json).

Runs after tools/cbb_build.py and needs no network:
  - Naismith Watch: matches the official watch list (cbb/data/naismith-watch.json) to the roster pool,
    ranks it with the hub's ladder score and keeps daily rank snapshots so the page can show movers.
  - Hub lines: logs the hub's pregame spread, total and win probability for every scheduled game
    (refreshed each run until tipoff), then grades the line once the game is final.
The line formula mirrors CBB.line() in cbb/model.js; tests/cbb-model.test.cjs checks the two agree.
"""
import json, math, re, sys, unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
HUB = ROOT / "cbb/data/hub.json"
WATCH = ROOT / "cbb/data/naismith-watch.json"
OUT = ROOT / "cbb/data/extras.json"
HOME_EDGE = 3.0   # points, split evenly between the two teams' projected scores
SPREAD_SD = 11.0  # typical miss of a college basketball point spread, in points
KEEP_DAYS = 120


def read(p, default=None):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return default


def num(x):
    try:
        x = float(x)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def norm(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower().replace("&", "and")
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


def school_key(s):
    s = norm(s).replace("state", "st").replace("saint", "st")
    return s


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def phi(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def league_average(teams):
    return mean([num(t.get("metrics", {}).get("adjO")) for t in teams])


def line(home, away, neutral, avg):
    """Projected score for a game, from adjusted efficiency and tempo. Mirrors CBB.line()."""
    hm, am = home.get("metrics", {}), away.get("metrics", {})
    ho, hd, ao, ad = num(hm.get("adjO")), num(hm.get("adjD")), num(am.get("adjO")), num(am.get("adjD"))
    pace = mean([num(hm.get("tempo")), num(am.get("tempo"))])
    if None in (ho, hd, ao, ad, pace, avg) or (num(hm.get("tempo")) is None or num(am.get("tempo")) is None):
        return None
    edge = 0 if neutral else HOME_EDGE / 2
    hp = ho * ad / avg * pace / 100 + edge
    ap = ao * hd / avg * pace / 100 - edge
    margin = hp - ap
    return {"homePts": round(hp, 1), "awayPts": round(ap, 1), "spread": round(margin, 1), "total": round(hp + ap, 1),
            "homeProb": round(phi(margin / SPREAD_SD), 3), "pace": round(pace, 1)}


def zscores(values):
    xs = [v for v in values if v is not None]
    if len(xs) < 2:
        return [0.0 if v is not None else None for v in values]
    m = sum(xs) / len(xs)
    sd = math.sqrt(sum((x - m) ** 2 for x in xs) / len(xs)) or 1
    return [None if v is None else (v - m) / sd for v in values]


def production(p):
    s = p.get("stats") or {}
    pts, reb, ast = num(s.get("pts")), num(s.get("reb")), num(s.get("ast"))
    if pts is None and reb is None and ast is None:
        return None
    if not (pts or reb or ast):
        return None  # a roster row with no games yet
    return (pts or 0) + 0.6 * (reb or 0) + 0.9 * (ast or 0)


def ladder(players, teams, watch):
    """The hub's Naismith ladder: 60% production, 30% team strength, 10% NBA draft stock."""
    by_team = {t["id"]: t for t in teams}
    by_name = {}
    for p in players:
        by_name.setdefault(norm(p["name"]), []).append(p)
    listed, missing = [], []
    for w in watch.get("players", []):
        cands = by_name.get(norm(w["name"]), [])
        if len(cands) > 1:
            cands = [p for p in cands if school_key(by_team.get(p["teamId"], {}).get("short")) == school_key(w["school"]) or school_key(p.get("team")) == school_key(w["school"])] or cands[:1]
        if cands:
            listed.append(cands[0]["id"])
        else:
            missing.append(w["name"])
    listed_set = set(listed)
    # Ranking pool: the list plus credible outsiders (real production on a top-150 team)
    pool = [p for p in players if p["id"] in listed_set or ((production(p) or 0) >= 12 and (num(by_team.get(p["teamId"], {}).get("haslamRank")) or 999) <= 150)]
    prod = [production(p) for p in pool]
    team = []
    for p in pool:
        m = by_team.get(p["teamId"], {}).get("metrics", {})
        o, d = num(m.get("adjO")), num(m.get("adjD"))
        team.append(o - d if o is not None and d is not None else None)
    draft = [max(0.0, (61 - num(p.get("draftRank"))) / 60) if num(p.get("draftRank")) else 0.0 for p in pool]
    zp, zt, zd = zscores(prod), zscores(team), zscores(draft)
    rows = []
    for p, a, b, c, pr in zip(pool, zp, zt, zd, prod):
        score = None if a is None else round(0.6 * a + 0.3 * (b or 0) + 0.1 * (c or 0), 3)
        rows.append({"id": p["id"], "teamId": p["teamId"], "watch": p["id"] in listed_set, "score": score,
                     "production": None if pr is None else round(pr, 1)})
    rows.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0)))
    on = [r for r in rows if r["watch"]]
    for i, r in enumerate(on):
        r["rank"] = i + 1
    # Outsiders who would rank inside the list's top 30 on the same score
    cut = on[min(29, len(on) - 1)]["score"] if on and on[min(29, len(on) - 1)]["score"] is not None else None
    knocking = [r for r in rows if not r["watch"] and r["score"] is not None and (cut is None or r["score"] >= cut)][:10]
    return on, knocking, missing


def ny_today():
    return datetime.now(ZoneInfo("America/New_York")).date()


def main():
    hub = read(HUB)
    if not hub or not hub.get("teams"):
        sys.exit("cbb/data/hub.json is missing; run tools/cbb_build.py first")
    watch = read(WATCH, {"players": []})
    prior = read(OUT, {}) or {}
    today = ny_today()
    stamp = datetime.now(timezone.utc).isoformat()
    teams = hub["teams"]
    by_team = {t["id"]: t for t in teams}
    avg = league_average(teams)

    # Naismith Watch
    on, knocking, missing = ladder(hub.get("players", []), teams, watch)
    history = (prior.get("naismith") or {}).get("history") or {}
    history[today.isoformat()] = {r["id"]: r["rank"] for r in on}
    cutoff = (today - timedelta(days=60)).isoformat()
    history = {d: v for d, v in sorted(history.items()) if d >= cutoff}
    week_ago = (today - timedelta(days=7)).isoformat()
    past = [d for d in history if d <= week_ago] or [d for d in history if d < today.isoformat()]
    base = history[past[-1]] if past else {}
    for r in on:
        r["prev"] = base.get(r["id"])
    naismith = {k: watch.get(k) for k in ("award", "list", "announced", "source", "url", "note")}
    naismith.update({"ladder": on, "knocking": knocking, "unmatched": missing, "since": past[-1] if past else None, "history": history,
                     "method": "Ladder score = 60% production (points + 0.6 rebounds + 0.9 assists per game, as a z-score), 30% team strength (Haslametrics efficiency margin) and 10% NBA Big Board stock. It is the hub's estimate, not voting."})

    # Hub lines: refresh pregame lines, freeze and grade finals
    log = (prior.get("lines") or {}).get("games") or {}
    for g in hub.get("games", []):
        h, a = by_team.get(g["home"]), by_team.get(g["away"])
        if not h or not a:
            continue
        entry = log.get(g["id"])
        if g.get("state") == "pre":
            ln = line(h, a, bool(g.get("neutral")), avg)
            if ln:
                log[g["id"]] = {"day": g["day"], "home": g["home"], "away": g["away"], "neutral": bool(g.get("neutral")), **ln, "set": stamp}
        elif g.get("state") == "post" and entry and "final" not in entry:
            hs, as_ = num(g.get("homeScore")), num(g.get("awayScore"))
            if hs is None or as_ is None:
                continue
            actual = hs - as_
            entry["final"] = [hs, as_]
            entry["correct"] = (entry["spread"] > 0) == (actual > 0) if entry["spread"] != 0 else None
            entry["miss"] = round(abs(actual - entry["spread"]), 1)
            entry["totalMiss"] = round(abs(hs + as_ - entry["total"]), 1)
            dog_prob = min(entry["homeProb"], 1 - entry["homeProb"])
            entry["upset"] = entry["correct"] is False and dog_prob < 0.35
    keep = (today - timedelta(days=KEEP_DAYS)).isoformat()
    log = {k: v for k, v in log.items() if v.get("day", "") >= keep}
    graded = [v for v in log.values() if "final" in v and v.get("correct") is not None]
    record = {"games": len(graded), "right": sum(v["correct"] for v in graded),
              "avgMiss": round(mean([v["miss"] for v in graded]), 1) if graded else None,
              "avgTotalMiss": round(mean([v["totalMiss"] for v in graded]), 1) if graded else None,
              "buckets": []}
    for lo, hi, label in [(0.5, 0.65, "Toss-ups (50-65%)"), (0.65, 0.8, "Leans (65-80%)"), (0.8, 0.95, "Strong (80-95%)"), (0.95, 1.01, "Locks (95%+)")]:
        rows = [v for v in graded if lo <= max(v["homeProb"], 1 - v["homeProb"]) < hi]
        record["buckets"].append({"label": label, "games": len(rows), "right": sum(v["correct"] for v in rows),
                                  "expected": round(mean([max(v["homeProb"], 1 - v["homeProb"]) for v in rows]) * 100, 1) if rows else None})
    out = {"schema": 1, "updated": stamp, "today": today.isoformat(), "leagueAvgEff": round(avg, 2) if avg else None,
           "homeEdge": HOME_EDGE, "spreadSd": SPREAD_SD, "naismith": naismith,
           "lines": {"since": min([v["day"] for v in log.values()], default=None), "games": log}, "record": record}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps({"naismith": len(on), "unmatched": missing, "knocking": len(knocking), "lines": len(log), "graded": record["games"]}))


if __name__ == "__main__":
    main()
