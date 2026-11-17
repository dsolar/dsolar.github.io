#!/usr/bin/env python3
"""College Football Hub modeling, built from the normalized snapshots (cfb/data/hub.json, players.json). No network.

  - Hub ratings: a points model fit to every completed game (adjusted points scored and allowed against an average
    FBS opponent, blowouts damped), blended with ESPN FPI into one power rating in points.
  - Lines: the hub's spread, total and win probability for every game. Logged before kickoff and graded once final,
    straight up and against the sportsbook line ESPN shows.
  - Résumé: wins above what an average top-25 team would expect against the same schedule (the hub's Strength of Record).
  - Season simulation: the rest of the regular season, conference championship games (top two in the standings, or
    division winners), a committee ranking, the 12-team field under the 2026 rules (four power champions, the best
    Group of Six champion, Notre Dame if top 12, seven at-large) and the bracket, 10,000 times by default.
  - Heisman ladder: production per game weighted by team success, with daily snapshots for movers.
The line formula mirrors CFB.line() in cfb/model.js; tests/cfb-model.test.cjs checks the two agree.
"""
import json, math, random, sys, time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
HUB = ROOT / "cfb/data/hub.json"
PLAYERS = ROOT / "cfb/data/players.json"
OUT = ROOT / "cfb/data/extras.json"
NY = ZoneInfo("America/New_York")

HFA = 2.5          # home-field edge in points, applied to the spread (split across the two projected scores)
SD = 14.0          # typical miss of a college football point spread, in points
DRIFT = 3.5        # season-long uncertainty in a team's true rating for the simulation, in points
FPI_WEIGHT = 0.5   # share of the power rating from ESPN FPI; the rest from the hub's own points model
REGRESS = 0.85     # raw ratings overstate the gaps between teams; power is pulled 15% toward average
BLOWOUT = 24       # margins beyond this count at 40% in the points model
RIDGE = 2.5        # games' worth of pull toward average in the points model
FCS_PRIOR = (-11.0, 11.0)  # FCS opponents start 22 points worse than an average FBS team
POWER = {"SEC", "Big Ten", "Big 12", "ACC"}
HOSTED_CCG = {"American", "Sun Belt", "Mountain West", "C-USA", "CUSA", "Conference USA"}
NOTRE_DAME = "87"


def read(p, default=None):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return default


def phi(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def r1(x, n=1):
    return None if x is None else round(x, n)


# ---------- ratings ----------
def damp(hs, as_):
    m = hs - as_
    if abs(m) <= BLOWOUT:
        return hs, as_
    extra = (abs(m) - BLOWOUT) * 0.4
    return (as_ + BLOWOUT + extra, as_) if m > 0 else (hs, hs + BLOWOUT + extra)


def fit_points(games, fbs):
    """Ridge-regressed points model: points = base + O(team) + D(opponent) +/- home edge. Returns O, D (FBS-centered) and base."""
    done = [g for g in games if g["state"] == "post" and g["hs"] is not None and g["as"] is not None]
    ids = set(fbs) | {g["home"] for g in done} | {g["away"] for g in done}
    prior = {t: ((0.0, 0.0) if t in fbs else FCS_PRIOR) for t in ids}
    O = {t: prior[t][0] for t in ids}; D = {t: prior[t][1] for t in ids}
    rows = []
    for g in done:
        hs, as_ = damp(g["hs"], g["as"]); h = 0 if g["neutral"] else HFA / 2
        rows.append((g["home"], g["away"], hs, h)); rows.append((g["away"], g["home"], as_, -h))
    if not rows:
        return {t: 0.0 for t in ids}, {t: 0.0 for t in ids}, 28.0, {t: 0 for t in ids}
    mu = sum(r[2] for r in rows) / len(rows)
    n = Counter(r[0] for r in rows)
    for _ in range(80):
        so = defaultdict(float); sd = defaultdict(float)
        for t, o, pts, h in rows:
            so[t] += pts - mu - D[o] - h
            sd[o] += pts - mu - O[t] - h
        for t in ids:
            O[t] = (so[t] + RIDGE * prior[t][0]) / (n[t] + RIDGE)
            D[t] = (sd[t] + RIDGE * prior[t][1]) / (n[t] + RIDGE)
        mu = sum(pts - O[t] - D[o] - h for t, o, pts, h in rows) / len(rows)
    mo = sum(O[t] for t in fbs) / len(fbs); md = sum(D[t] for t in fbs) / len(fbs)
    base = mu + mo + md
    return {t: O[t] - mo for t in ids}, {t: D[t] - md for t in ids}, base, n


def line(h, a, neutral, R, base):
    """Projected score. Mirrors CFB.line() in cfb/model.js."""
    rh, ra = R.get(h), R.get(a)
    if not rh or not ra:
        return None
    spread = rh["power"] - ra["power"] + (0 if neutral else HFA)
    e = 0 if neutral else HFA / 2
    hp = base + rh["o"] + ra["d"] + e; ap = base + ra["o"] + rh["d"] - e
    shift = (spread - (hp - ap)) / 2; hp += shift; ap -= shift
    hp = max(hp, 3.0); ap = max(ap, 3.0)
    return {"spread": round(spread, 1), "total": round(hp + ap, 1), "hp": round(hp, 1), "ap": round(ap, 1), "prob": round(phi(spread / SD), 3)}


def resume_value(team_power, opp_power, site, won, bar):
    """Wins above an average top-25 team (power = bar) against this opponent at this site. site: +1 home, 0 neutral, -1 away."""
    p = phi((bar - opp_power + site * HFA) / SD)
    return (1 if won else 0) - p


# ---------- season simulation ----------
def site_of(g, tid):
    return 0 if g["neutral"] else (1 if g["home"] == tid else -1)


def is_ccg(g):
    return bool(g.get("note") and "championship" in g["note"].lower() and not g.get("post") and "playoff" not in g["note"].lower()) or (g.get("week") or 0) >= 15 and g.get("conf") and not g.get("post")


def standings_order(ids, cw, cl, h2h, power, rng):
    """Conference standings order: conference win percentage, then head-to-head (two-team ties) or record among the tied
    teams, then a draw weighted toward the stronger team (stand-in for the leagues' deeper tiebreakers)."""
    pct = {t: cw[t] / max(1, cw[t] + cl[t]) for t in ids}
    noise = {t: power[t] + rng.gauss(0, 6) for t in ids}
    groups = defaultdict(list)
    for t in ids:
        groups[round(pct[t], 4)].append(t)
    out = []
    for k in sorted(groups, reverse=True):
        g = groups[k]
        if len(g) == 1:
            out += g; continue
        mini = {t: sum(h2h.get((t, o), 0) for o in g if o != t) - sum(h2h.get((o, t), 0) for o in g if o != t) for t in g}
        out += sorted(g, key=lambda t: (-mini[t], -noise[t]))
    return out


def simulate(hub, R, base, sims, seed=2026):
    teams = {t["id"]: t for t in hub["teams"]}
    fbs = set(teams)
    confs = [c for c in hub["conferences"] if not c.get("independent")]
    conf_of = {tid: c["short"] for c in hub["conferences"] for tid in c["teams"]}
    games = [g for g in hub["games"] if not g.get("post") and g["state"] != "off"]
    ccg_known = {}
    for g in games:
        if is_ccg(g) and g["home"] in fbs and g["away"] in fbs and conf_of.get(g["home"]) == conf_of.get(g["away"]):
            ccg_known[conf_of[g["home"]]] = g
    reg = [g for g in games if g not in ccg_known.values() and not is_ccg(g)]
    done = [g for g in reg if g["state"] == "post" and g["hs"] is not None]
    left = [g for g in reg if g["state"] != "post" and (g["home"] in fbs or g["away"] in fbs)]
    power = {t: R[t]["power"] for t in R}
    bar = sorted((R[t]["power"] for t in fbs), reverse=True)[24]

    # Baseline from completed games
    W0 = Counter(); L0 = Counter(); CW0 = Counter(); CL0 = Counter(); RES0 = Counter(); H2H0 = Counter()
    for g in done:
        hw = g["hs"] > g["as"]
        for tid, won in ((g["home"], hw), (g["away"], not hw)):
            if tid not in fbs:
                continue
            o = g["away"] if tid == g["home"] else g["home"]
            (W0 if won else L0)[tid] += 1
            RES0[tid] += resume_value(power[tid], power.get(o, -25), site_of(g, tid), won, bar)
            if g["conf"]:
                (CW0 if won else CL0)[tid] += 1
                if won:
                    H2H0[(tid, o)] += 1
    # Precompute remaining-game pieces
    pre = []
    for g in left:
        h, a = g["home"], g["away"]
        res_h = (resume_value(power.get(h, -25), power.get(a, -25), site_of(g, h), True, bar), resume_value(power.get(h, -25), power.get(a, -25), site_of(g, h), False, bar))
        res_a = (resume_value(power.get(a, -25), power.get(h, -25), site_of(g, a), True, bar), resume_value(power.get(a, -25), power.get(h, -25), site_of(g, a), False, bar))
        pre.append((h, a, 0 if g["neutral"] else HFA, g["conf"], res_h, res_a))

    cfp_now = {tid: (t.get("polls", {}).get("cfp") or t.get("polls", {}).get("ap") or {}).get("rank") for tid, t in teams.items()}
    anchor = {tid: ((26 - r) / 25 if r else 0.0) for tid, r in cfp_now.items()}
    mean_p = sum(power[t] for t in fbs) / len(fbs); sd_p = math.sqrt(sum((power[t] - mean_p) ** 2 for t in fbs) / len(fbs)) or 1
    pz = {t: (power[t] - mean_p) / sd_p for t in fbs}

    rng = random.Random(seed)
    acc = {t: Counter() for t in fbs}
    wins_sum = Counter(); losses_sum = Counter(); cw_sum = Counter(); cl_sum = Counter(); seed_sum = Counter()
    score_sum = Counter(); champ_count = defaultdict(Counter); seed_hist = {t: Counter() for t in fbs}
    title_pairs = Counter()

    def play(h, a, edge, tp):
        return rng.gauss(tp[h] - tp[a] + edge, SD) > 0

    for _ in range(sims):
        tp = {t: power[t] + rng.gauss(0, DRIFT) for t in power}
        W = Counter(W0); L = Counter(L0); CW = Counter(CW0); CL = Counter(CL0); RES = Counter(RES0); H2H = Counter(H2H0)
        for h, a, edge, conf, res_h, res_a in pre:
            hw = play(h, a, edge, tp) if h in tp and a in tp else (h in fbs)
            if h in fbs:
                (W if hw else L)[h] += 1; RES[h] += res_h[0 if hw else 1]
                if conf:
                    (CW if hw else CL)[h] += 1
                    if hw:
                        H2H[(h, a)] += 1
            if a in fbs:
                (W if not hw else L)[a] += 1; RES[a] += res_a[0 if not hw else 1]
                if conf:
                    (CW if not hw else CL)[a] += 1
                    if not hw:
                        H2H[(a, h)] += 1
        champs = {}
        for c in confs:
            ids = [t for t in c["teams"] if t in fbs]
            if c["short"] in ccg_known:
                g = ccg_known[c["short"]]
                if g["state"] == "post" and g["hs"] is not None:
                    win = g["home"] if g["hs"] > g["as"] else g["away"]; pair = (g["home"], g["away"]); played = False
                else:
                    pair = (g["home"], g["away"]); played = True
            else:
                if c.get("divisions"):
                    tops = [standings_order([t for t in dv["teams"] if t in fbs], CW, CL, H2H, tp, rng)[0] for dv in c["divisions"]]
                    tops = standings_order(tops, CW, CL, H2H, tp, rng)
                    pair = (tops[0], tops[1])
                else:
                    order = standings_order(ids, CW, CL, H2H, tp, rng)
                    pair = (order[0], order[1])
                played = True
            if played:
                hosted = c["short"] in HOSTED_CCG
                hw = play(pair[0], pair[1], HFA if hosted else 0, tp)
                win = pair[0] if hw else pair[1]; lose = pair[1] if hw else pair[0]
                site = 1 if hosted else 0
                W[win] += 1; L[lose] += 1
                RES[win] += resume_value(power[win], power[lose], site if win == pair[0] else -site, True, bar)
                RES[lose] += resume_value(power[lose], power[win], site if lose == pair[0] else -site, False, bar)
            for t in pair:
                acc[t]["ccg"] += 1
            champs[c["short"]] = win; acc[win]["champ"] += 1; champ_count[c["short"]][win] += 1
        # Committee ranking
        vals = [RES[t] for t in fbs]; mr = sum(vals) / len(vals); sr = math.sqrt(sum((v - mr) ** 2 for v in vals) / len(vals)) or 1
        champ_set = set(champs.values())
        score = {t: (RES[t] - mr) / sr + 0.45 * pz[t] + 0.6 * anchor.get(t, 0) + (0.3 if t in champ_set and conf_of.get(t) in POWER else 0.15 if t in champ_set else 0) for t in fbs}
        ranked = sorted(fbs, key=lambda t: -score[t]); rank = {t: i + 1 for i, t in enumerate(ranked)}
        auto = [champs[c] for c in champs if c in POWER]
        g6 = sorted([champs[c] for c in champs if c not in POWER], key=lambda t: rank[t])
        if g6:
            auto.append(g6[0])
        field = set(auto)
        if rank.get(NOTRE_DAME, 99) <= 12:
            field.add(NOTRE_DAME)
        for t in ranked:
            if len(field) >= 12:
                break
            field.add(t)
        seeds = sorted(field, key=lambda t: rank[t])
        for i, t in enumerate(seeds):
            s = i + 1; acc[t]["cfp"] += 1; seed_sum[t] += s; seed_hist[t][s] += 1
            if t in auto:
                acc[t]["auto"] += 1
            if s <= 4:
                acc[t]["bye"] += 1; acc[t]["qf"] += 1
            elif s <= 8:
                acc[t]["host"] += 1
        S = {i + 1: t for i, t in enumerate(seeds)}
        r1w = {}
        for hi, lo in ((5, 12), (6, 11), (7, 10), (8, 9)):
            w = S[hi] if play(S[hi], S[lo], HFA, tp) else S[lo]
            r1w[hi] = w; acc[w]["qf"] += 1
        qf = [(S[1], r1w[8]), (S[4], r1w[5]), (S[2], r1w[7]), (S[3], r1w[6])]
        semi = []
        for a, b in qf:
            w = a if play(a, b, 0, tp) else b
            semi.append(w); acc[w]["sf"] += 1
        f1 = semi[0] if play(semi[0], semi[1], 0, tp) else semi[1]
        f2 = semi[2] if play(semi[2], semi[3], 0, tp) else semi[3]
        acc[f1]["final"] += 1; acc[f2]["final"] += 1
        champ = f1 if play(f1, f2, 0, tp) else f2
        acc[champ]["title"] += 1; title_pairs[tuple(sorted((f1, f2)))] += 1
        for t in fbs:
            wins_sum[t] += W[t]; losses_sum[t] += L[t]; cw_sum[t] += CW[t]; cl_sum[t] += CL[t]; score_sum[t] += score[t]
            if W[t] >= 6:
                acc[t]["six"] += 1
            if L[t] == L0[t] and W[t] > W0[t] or (L[t] == L0[t] and not any(x for x in pre if t in (x[0], x[1]))):
                acc[t]["winout"] += 1
    n = float(sims)
    out = {}
    for t in fbs:
        a = acc[t]
        out[t] = {"w": r1(wins_sum[t] / n), "l": r1(losses_sum[t] / n), "cw": r1(cw_sum[t] / n), "cl": r1(cl_sum[t] / n),
                  "six": round(a["six"] / n, 4), "winOut": round(a["winout"] / n, 4), "ccg": round(a["ccg"] / n, 4), "champ": round(a["champ"] / n, 4),
                  "cfp": round(a["cfp"] / n, 4), "auto": round(a["auto"] / n, 4), "bye": round(a["bye"] / n, 4), "host": round(a["host"] / n, 4),
                  "r": [round(a["qf"] / n, 4), round(a["sf"] / n, 4), round(a["final"] / n, 4), round(a["title"] / n, 4)],
                  "seed": r1(seed_sum[t] / a["cfp"]) if a["cfp"] else None, "mode": seed_hist[t].most_common(1)[0][0] if seed_hist[t] else None,
                  "score": round(score_sum[t] / n, 3)}
    # Projected field from the average committee score and each league's most likely champion
    avg = {t: score_sum[t] / n for t in fbs}
    order = sorted(fbs, key=lambda t: -avg[t]); prank = {t: i + 1 for i, t in enumerate(order)}
    likely = {c: champ_count[c].most_common(1)[0][0] for c in champ_count}
    auto = [likely[c] for c in likely if c in POWER]
    g6 = sorted([likely[c] for c in likely if c not in POWER], key=lambda t: prank[t])
    if g6:
        auto.append(g6[0])
    field = set(auto)
    if prank.get(NOTRE_DAME, 99) <= 12:
        field.add(NOTRE_DAME)
    for t in order:
        if len(field) >= 12:
            break
        field.add(t)
    seeds = sorted(field, key=lambda t: prank[t])
    at_large = [t for t in order if t not in auto]
    cut = [t for t in seeds if t not in auto and t != NOTRE_DAME]
    last_in = cut[-4:][::-1]
    first_out = [t for t in order if t not in field][:4]
    return {"sims": sims, "drift": DRIFT, "remaining": len(left), "teams": out,
            "projected": {"seeds": seeds, "auto": auto, "champions": likely, "top25": order[:25], "lastIn": last_in, "firstOut": first_out},
            "titleGames": [{"teams": list(k), "p": round(v / n, 4)} for k, v in title_pairs.most_common(6)],
            "selection": "2026-12-06", "championship": "2027-01-25"}


# ---------- Heisman ladder ----------
def heisman(players, teams, R):
    pct = {}
    pw = sorted(R[t]["power"] for t in teams)
    for t in teams:
        pct[t] = sum(1 for x in pw if x <= R[t]["power"]) / len(pw)
    rows = []
    for p in players:
        s = p.get("s") or {}; g = lambda k: s.get(k) or 0; gp = g("gp")
        if gp < 3 or p["teamId"] not in teams:
            continue
        t = teams[p["teamId"]]; rec = t.get("record") or {}; gms = (rec.get("w") or 0) + (rec.get("l") or 0)
        off = 0.0; kind = None
        if g("att") >= 80:
            off = g("pyd") * 0.04 + g("ryd") * 0.06 + g("ptd") * 4 + g("rtd") * 5 - g("int") * 3.5 + g("wtd") * 5
            off += max(-3, min(4, (g("pyd") / max(1, g("att")) - 7.5) * 1.2)) * gp
            kind = "QB"
        elif g("car") >= 50 or g("rec") >= 20:
            off = (g("ryd") + g("wyd")) * 0.07 + (g("rtd") + g("wtd")) * 5.5
            kind = "Skill"
        off += (g("krTd") + g("prTd")) * 6
        de = g("dsk") * 4 + g("tfl") * 1.5 + g("dint") * 6 + g("pd") * 1.2 + g("ff") * 4 + g("tkl") * 0.25 + g("dintTd") * 6
        de *= 0.85
        if de > 0 and (g("tkl") >= 10 or g("dint") >= 2 or g("dsk") >= 3):
            kind = "Two-way" if kind and off > 8 * gp else (kind or "Defense")
        else:
            de = 0
        prod = (off + de) / gp
        if prod <= 0:
            continue
        winp = (rec.get("w") or 0) / gms if gms else 0.5
        cfp = (t.get("polls", {}).get("cfp") or t.get("polls", {}).get("ap") or {}).get("rank")
        factor = 0.35 + 0.45 * winp + 0.1 * pct[p["teamId"]] + (0.15 if cfp and cfp <= 12 else 0.07 if cfp else 0)
        rows.append({"id": p["id"], "name": p["name"], "teamId": p["teamId"], "pos": p.get("pos"), "kind": kind, "prod": round(prod, 2), "score": prod * factor})
    rows.sort(key=lambda r: -r["score"])
    top = rows[:40]
    if top:
        m = top[0]["score"]
        for i, r in enumerate(top):
            r["rank"] = i + 1; r["score"] = round(100 * r["score"] / m, 1)
    return top


# ---------- logged lines and the record ----------
def update_lines(old, hub, R, base, today):
    log = dict((old or {}).get("games") or {})
    for g in hub["games"]:
        if g["home"] not in R or g["away"] not in R:
            continue
        gid = g["id"]; ent = log.get(gid)
        if g["state"] == "pre" and g["day"] <= (today + timedelta(days=9)).isoformat() and g["day"] >= today.isoformat():
            l = line(g["home"], g["away"], g["neutral"], R, base)
            if l:
                log[gid] = {"day": g["day"], "home": g["home"], "away": g["away"], **l, "market": g.get("market"), "logged": datetime.now(timezone.utc).isoformat()}
        elif ent and g["state"] == "post" and g["hs"] is not None and not ent.get("final"):
            m = g["hs"] - g["as"]; ent["final"] = [g["hs"], g["as"]]
            ent["correct"] = (ent["spread"] > 0) == (m > 0) if m != 0 and ent["spread"] != 0 else None
            ent["err"] = round(abs(m - ent["spread"]), 1)
            mk = ent.get("market") or {}
            if mk.get("spread") is not None:
                ent["mErr"] = round(abs(m - mk["spread"]), 1)
                if ent["spread"] != mk["spread"]:
                    pick_home = ent["spread"] > mk["spread"]
                    cover = m - mk["spread"]
                    ent["ats"] = "push" if cover == 0 else ("win" if (cover > 0) == pick_home else "loss")
                    ent["edge"] = round(ent["spread"] - mk["spread"], 1)
            ent["upset"] = ent["prob"] is not None and ((ent["prob"] > 0.5) != (m > 0))
    cutoff = (today - timedelta(days=200)).isoformat()
    log = {k: v for k, v in log.items() if v.get("day", "") >= cutoff}
    graded = [v for v in log.values() if v.get("final")]
    su = [v for v in graded if v.get("correct") is not None]
    ats = [v for v in graded if v.get("ats")]
    big = [v for v in ats if abs(v.get("edge") or 0) >= 3]
    rec = {"games": len(su), "right": sum(1 for v in su if v["correct"]),
           "ats": [sum(v["ats"] == "win" for v in ats), sum(v["ats"] == "loss" for v in ats), sum(v["ats"] == "push" for v in ats)],
           "atsBig": [sum(v["ats"] == "win" for v in big), sum(v["ats"] == "loss" for v in big), sum(v["ats"] == "push" for v in big)],
           "mae": r1(sum(v["err"] for v in graded) / len(graded)) if graded else None,
           "marketMae": r1(sum(v["mErr"] for v in graded if v.get("mErr") is not None) / max(1, sum(1 for v in graded if v.get("mErr") is not None))) if any(v.get("mErr") is not None for v in graded) else None,
           "since": min((v["day"] for v in graded), default=None)}
    return {"games": log}, rec


def main():
    sims = next((int(a.split("=")[1]) for a in sys.argv[1:] if a.startswith("--sims=")), 10000)
    t0 = time.time()
    hub = read(HUB); pl = read(PLAYERS, {}) or {}
    if not hub:
        raise SystemExit("cfb/data/hub.json is missing; run tools/cfb_build.py first")
    old = read(OUT, {}) or {}
    today = datetime.now(NY).date()
    teams = {t["id"]: t for t in hub["teams"]}
    fbs = list(teams)
    O, D, base, n = fit_points(hub["games"], set(fbs))
    own = {t: O[t] - D[t] for t in O}
    # The ridge pull compresses the points model; stretch it to FPI's spread across FBS before blending.
    fv = [teams[t]["fpi"]["fpi"] for t in fbs if teams[t]["fpi"].get("fpi") is not None]
    ov = [own[t] for t in fbs]
    sdv = lambda xs: math.sqrt(sum((x - sum(xs) / len(xs)) ** 2 for x in xs) / len(xs)) if len(xs) > 1 else 1
    stretch = max(1.0, min(1.8, sdv(fv) / (sdv(ov) or 1))) if fv else 1.0
    own = {t: v * stretch for t, v in own.items()}
    O = {t: v * stretch for t, v in O.items()}; D = {t: v * stretch for t, v in D.items()}
    R = {}
    for t in O:
        if t in teams:
            f = teams[t]["fpi"].get("fpi")
            pw = REGRESS * (FPI_WEIGHT * f + (1 - FPI_WEIGHT) * own[t] if f is not None else own[t])
        else:
            pw = REGRESS * own[t]
        R[t] = {"power": round(pw, 2), "own": round(own[t], 2), "o": round(O[t], 2), "d": round(D[t], 2), "g": n.get(t, 0)}
    for t in fbs:
        R.setdefault(t, {"power": REGRESS * (teams[t]["fpi"].get("fpi") or 0), "own": 0, "o": 0, "d": 0, "g": 0})
    # Ranks and résumé
    order = sorted(fbs, key=lambda t: -R[t]["power"])
    for i, t in enumerate(order):
        R[t]["rank"] = i + 1
    for i, t in enumerate(sorted(fbs, key=lambda t: -R[t]["o"])):
        R[t]["oRank"] = i + 1
    for i, t in enumerate(sorted(fbs, key=lambda t: R[t]["d"])):
        R[t]["dRank"] = i + 1
    bar = R[order[24]]["power"]
    res = Counter(); sos = defaultdict(list)
    for g in hub["games"]:
        if g["state"] != "post" or g["hs"] is None:
            continue
        hw = g["hs"] > g["as"]
        for tid, won in ((g["home"], hw), (g["away"], not hw)):
            if tid not in teams:
                continue
            o = g["away"] if tid == g["home"] else g["home"]
            op = R.get(o, {"power": -25})["power"]
            res[tid] += resume_value(R[tid]["power"], op, site_of(g, tid), won, bar); sos[tid].append(op)
    for i, t in enumerate(sorted(fbs, key=lambda t: -res[t])):
        R[t]["res"] = round(res[t], 2); R[t]["resRank"] = i + 1
    for i, t in enumerate(sorted(fbs, key=lambda t: -(sum(sos[t]) / len(sos[t]) if sos[t] else -99))):
        R[t]["sos"] = r1(sum(sos[t]) / len(sos[t])) if sos[t] else None; R[t]["sosRank"] = i + 1
    # Week-over-week movement (ranks a week ago from the saved history)
    hist = dict((old.get("history") or {}))
    hist[today.isoformat()] = {t: R[t]["rank"] for t in fbs}
    keep = sorted(hist)[-21:]; hist = {k: hist[k] for k in keep}
    week_ago = next((hist[k] for k in sorted(hist) if k >= (today - timedelta(days=7)).isoformat()), None)
    for t in fbs:
        if week_ago and week_ago.get(t):
            R[t]["move"] = week_ago[t] - R[t]["rank"]
    season = simulate(hub, R, base, sims)
    lad = heisman(pl.get("players", []), teams, R)
    hh = dict((old.get("heisman") or {}).get("history") or {})
    hh[today.isoformat()] = {r["id"]: r["rank"] for r in lad}
    hk = sorted(hh)[-21:]; hh = {k: hh[k] for k in hk}
    ref_day = next((k for k in sorted(hh) if k >= (today - timedelta(days=7)).isoformat()), None)
    if ref_day and ref_day != today.isoformat():
        for r in lad:
            r["prev"] = hh[ref_day].get(r["id"])
    lines, record = update_lines(old.get("lines"), hub, R, base, today)
    out = {"schema": 1, "updated": datetime.now(timezone.utc).isoformat(), "season": hub["season"], "today": today.isoformat(),
           "hfa": HFA, "sd": SD, "base": round(base, 2), "stretch": round(stretch, 3), "fpiWeight": FPI_WEIGHT, "regress": REGRESS, "bar": round(bar, 2),
           "ratings": R, "history": hist, "season_sim": season,
           "heisman": {"ladder": lad, "since": ref_day, "history": hh},
           "lines": lines, "record": record, "seconds": round(time.time() - t0, 1)}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    top = sorted(fbs, key=lambda t: -season["teams"][t]["r"][3])[:8]
    print(json.dumps({"base": round(base, 1), "top_power": [(teams[t]["short"], R[t]["power"]) for t in order[:10]],
                      "title": [(teams[t]["short"], season["teams"][t]["r"][3], season["teams"][t]["cfp"]) for t in top],
                      "projected": [teams[t]["short"] for t in season["projected"]["seeds"]],
                      "heisman": [(r["name"], r["score"]) for r in lad[:8]], "record": record, "seconds": out["seconds"]}))


if __name__ == "__main__":
    main()
