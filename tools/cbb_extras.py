#!/usr/bin/env python3
"""College Basketball Hub extras, built from the normalized snapshot (cbb/data/hub.json).

Runs after tools/cbb_build.py and needs no network:
  - Naismith Watch: matches the official watch list (cbb/data/naismith-watch.json) to the roster pool,
    ranks it with the hub's ladder score and keeps daily rank snapshots so the page can show movers.
  - Hub lines: logs the hub's pregame spread, total and win probability for every scheduled game
    (refreshed each run until tipoff), then grades the line once the game is final.
The line formula mirrors CBB.line() in cbb/model.js; tests/cbb-model.test.cjs checks the two agree.
"""
import json, math, random, re, sys, time, unicodedata
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


# ---------- season and tournament simulation ----------
SELECTION_SUNDAY = "2027-03-14"
FIELD, AT_LARGE_OPEN, AQ_OPEN = 76, 12, 12
REGION_ORDER = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15]


def build_bracket(field, aq_set, strength):
    """64 slots from a 76-team field: the 12 weakest automatic qualifiers and the 12 weakest at-large teams
    pair off in the Opening Round. Slots go down the S-curve onto four regions."""
    order = sorted(field, key=lambda i: -strength[i])
    aqs = [i for i in order if i in aq_set]
    ats = [i for i in order if i not in aq_set]
    pairs = [(aqs[-AQ_OPEN:][k], aqs[-AQ_OPEN:][k + 1]) for k in range(0, AQ_OPEN, 2)] + [(ats[-AT_LARGE_OPEN:][k], ats[-AT_LARGE_OPEN:][k + 1]) for k in range(0, AT_LARGE_OPEN, 2)]
    paired = {i for p in pairs for i in p}
    slots = [((i,), strength[i]) for i in order if i not in paired] + [(p, (strength[p[0]] + strength[p[1]]) / 2) for p in pairs]
    slots.sort(key=lambda x: -x[1])
    regions = [dict() for _ in range(4)]
    for k, (teams, _) in enumerate(slots[:64]):
        line_, pos = divmod(k, 4)
        regions[pos if line_ % 2 == 0 else 3 - pos][line_ + 1] = teams
    return regions


def simulate(teams, avg, sims, seed, today):
    rng = random.Random(seed)
    gauss, rand = rng.gauss, rng.random
    T = [t for t in teams if num(t.get("metrics", {}).get("adjO")) is not None and t.get("conference")]
    n = len(T)
    tempo = mean([num(t["metrics"].get("tempo")) for t in T])
    average = {"metrics": {"adjO": avg, "adjD": avg, "tempo": tempo}}
    base = [line(t, average, True, avg)["spread"] for t in T]
    cache = {}

    def S(i, j):
        k = i * n + j
        v = cache.get(k)
        if v is None:
            v = cache[k] = line(T[i], T[j], True, avg)["spread"]
        return v

    days = max(0, (datetime.fromisoformat(SELECTION_SUNDAY).date() - today).days)
    drift = 3.0 * math.sqrt(min(days, 120) / 120)  # how far a rating can still move before March, in points per game
    confs = {}
    for i, t in enumerate(T):
        confs.setdefault(t["conference"], []).append(i)
    left, played = [0] * n, [0] * n
    for i, t in enumerate(T):
        p, r = t.get("projection") or {}, t.get("record") or {}
        total = (num(p.get("confWins")) or 0) + (num(p.get("confLosses")) or 0)
        done = (num(r.get("cw")) or 0) + (num(r.get("cl")) or 0)
        played[i] = int(num(r.get("cw")) or 0)
        left[i] = max(0, int(round(total - done)))
    for c, m in confs.items():  # a conference without a schedule length uses its median
        known = sorted(left[i] for i in m if left[i])
        for i in m:
            if not left[i] and known:
                left[i] = known[len(known) // 2]
    M = {c: [[S(i, j) if i != j else 0 for j in m] for i in m] for c, m in confs.items()}
    reg, aq, made, wsum = [0] * n, [0] * n, [0] * n, [0.0] * n
    rounds = [[0] * 7 for _ in range(n)]
    seeds = [[0] * 17 for _ in range(n)]
    SD, H = SPREAD_SD, HOME_EDGE

    def play(i, j, off):
        return i if S(i, j) + off[i] - off[j] + gauss(0, SD) > 0 else j

    for _ in range(sims):
        off = [gauss(0, drift) for _ in range(n)]
        strength = [base[i] + off[i] for i in range(n)]
        aq_set = set()
        for c, m in confs.items():
            k, mat = len(m), M[c]
            wins = [played[i] for i in m]
            gp = [0] * k
            slots = [li for li in range(k) for _ in range(left[m[li]])]
            rng.shuffle(slots)
            if len(slots) % 2:
                slots.pop()
            for x in range(0, len(slots) - 1, 2):
                a, b = slots[x], slots[x + 1]
                if a == b:  # swap with a later slot to avoid a team playing itself
                    for y in range(x + 2, len(slots)):
                        if slots[y] != a:
                            slots[x + 1], slots[y] = slots[y], slots[x + 1]
                            b = slots[x + 1]
                            break
                    else:
                        continue
                ia, ib = m[a], m[b]
                margin = mat[a][b] + off[ia] - off[ib] + (H if rand() < 0.5 else -H)
                if margin + gauss(0, SD) > 0:
                    wins[a] += 1
                else:
                    wins[b] += 1
                gp[a] += 1
                gp[b] += 1
            best = max(wins)
            for li in range(k):
                i = m[li]
                wsum[i] += wins[li]
                if wins[li] == best:
                    reg[i] += 1
            order = sorted(range(k), key=lambda li: (-wins[li], rand()))[:8]
            bracket = [m[order[x]] for x in (0, 7, 3, 4, 1, 6, 2, 5)] if len(order) == 8 else [m[x] for x in order]
            while len(bracket) > 1:
                bracket = [play(bracket[x], bracket[x + 1], off) for x in range(0, len(bracket) - 1, 2)] + ([bracket[-1]] if len(bracket) % 2 else [])
            aq_set.add(bracket[0])
        pool = sorted((i for i in range(n) if i not in aq_set), key=lambda i: -strength[i])
        field = list(aq_set) + pool[:FIELD - len(aq_set)]
        for i in aq_set:
            aq[i] += 1
        regions = build_bracket(field, aq_set, strength)
        champs = []
        for reg_ in regions:
            line_up = []
            for sd in REGION_ORDER:
                ts = reg_.get(sd, ())
                for i in ts:
                    made[i] += 1
                    seeds[i][sd] += 1
                w = play(ts[0], ts[1], off) if len(ts) == 2 else ts[0]
                rounds[w][0] += 1
                line_up.append(w)
            for r in range(1, 5):
                line_up = [play(line_up[x], line_up[x + 1], off) for x in range(0, len(line_up), 2)]
                for w in line_up:
                    rounds[w][r] += 1
            champs.append(line_up[0])
        f1, f2 = play(champs[0], champs[3], off), play(champs[1], champs[2], off)
        rounds[f1][5] += 1
        rounds[f2][5] += 1
        rounds[play(f1, f2, off)][6] += 1
    out = {}
    for i, t in enumerate(T):
        cnt = seeds[i]
        mode = max(range(1, 17), key=lambda s_: cnt[s_]) if made[i] else None
        out[t["id"]] = {"reg": round(reg[i] / sims, 4), "cw": round(wsum[i] / sims, 1), "aq": round(aq[i] / sims, 4), "in": round(made[i] / sims, 4),
                        "seed": round(sum(s_ * cnt[s_] for s_ in range(17)) / made[i], 1) if made[i] else None, "mode": mode,
                        "top4": round(sum(cnt[1:5]) / sims, 4), "r": [round(x / sims, 4) for x in rounds[i]]}
        total = left[i] + played[i] + int(num((t.get("record") or {}).get("cl")) or 0)
        out[t["id"]]["cl"] = round(total - out[t["id"]]["cw"], 1)
    # The bracket if the season ended with today's ratings: favorite to win each conference tournament takes the bid
    idx = {t["id"]: i for i, t in enumerate(T)}
    fav = {c: max(m, key=lambda i: (aq[i], base[i])) for c, m in confs.items()}
    aq_set = set(fav.values())
    pool = sorted((i for i in range(n) if i not in aq_set), key=lambda i: -base[i])
    field = list(aq_set) + pool[:FIELD - len(aq_set)]
    regions = build_bracket(field, aq_set, base)
    projected = [[{"seed": sd, "teams": [T[i]["id"] for i in reg_.get(sd, ())]} for sd in REGION_ORDER] for reg_ in regions]
    last_in = [T[i]["id"] for i in pool[:FIELD - len(aq_set)][-6:]]
    first_out = [T[i]["id"] for i in pool[FIELD - len(aq_set):FIELD - len(aq_set) + 6]]
    return {"sims": sims, "drift": round(drift, 2), "selectionSunday": SELECTION_SUNDAY, "teams": out, "bracket": projected, "lastIn": last_in, "firstOut": first_out,
            "method": f"{sims:,} seasons. Each run nudges every team's rating by a random amount (up to about {drift:.1f} points a game, shrinking toward Selection Sunday), plays each team's remaining conference games against randomly drawn league opponents with home court split evenly, then an eight-team conference tournament for the automatic bid. The other {FIELD - 32} spots go to the strongest teams left, the 12 weakest automatic qualifiers and 12 weakest at-large teams play in the Opening Round, seeds follow the S-curve, and the 76-team tournament is played out on neutral courts."}


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
    t0 = time.time()
    sims = int(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--sims=")), 4000))
    try:
        season = simulate(teams, avg, sims, int(today.strftime("%Y%m%d")), today)
        season["seconds"] = round(time.time() - t0, 1)
    except Exception as e:  # keep the last good simulation rather than publishing none
        print("Simulation failed:", e, file=sys.stderr)
        season = prior.get("season")
    out = {"schema": 1, "updated": stamp, "season": season, "today": today.isoformat(), "leagueAvgEff": round(avg, 2) if avg else None,
           "homeEdge": HOME_EDGE, "spreadSd": SPREAD_SD, "naismith": naismith,
           "lines": {"since": min([v["day"] for v in log.values()], default=None), "games": log}, "record": record}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps({"naismith": len(on), "unmatched": missing, "knocking": len(knocking), "lines": len(log), "graded": record["games"], "sims": season and season.get("sims"), "seconds": season and season.get("seconds")}))


if __name__ == "__main__":
    main()
