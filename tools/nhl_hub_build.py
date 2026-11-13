#!/usr/bin/env python3
"""Builds the NHL hub's page data (nhl/data/hub.json) from the snapshots tools/nhl_hub_pull.py leaves in tools/nhl_hub/.

What it works out:
  Player ratings: goals above replacement for every skater and goalie, from MoneyPuck's expected goals (xG) over this
    season and the two before it, weighted toward the latest and pulled toward average when the sample is small.
      Skaters: even-strength offense and defense (on-ice xG for and against, half against the league and half against
      his own team with him on the bench), finishing (goals over his own xG, mostly regressed away), power play and
      penalty kill (on-ice xG at 5-on-4 and 4-on-5), penalties drawn minus taken, and faceoffs.
      Goalies: goals saved above expected (xG faced minus goals allowed), regressed hard because it's noisy.
  Team strength: goals per game better than an average team, from the roster's ratings at each player's ice time,
    blended with what the team has actually done (xG and real goal differential) as the season fills in.
  Standings: the rest of the schedule played out SIMS times, game by game from Poisson scoring with home ice, with
    overtime points, the division and wild-card playoff format, and the playoffs to the Cup.
  Lines and pairings: each team's most-used 5-on-5 combinations this season among players still on the roster.

  python3 tools/nhl_hub_build.py            build nhl/data/hub.json
  python3 tools/nhl_hub_build.py backtest   rate players on 2024-25 alone and check how well that predicts 2025-26
"""
import json
import math
import os
import random
import sys
import time
from collections import defaultdict

ROOT = os.path.dirname(os.path.abspath(__file__))
SNAP = os.path.join(ROOT, "nhl_hub")
OUT = os.path.join(os.path.dirname(ROOT), "nhl", "data")

SEASON = 2026                       # MoneyPuck's label for 2026-27
SEASON_W = {0: 1.0, 1: 0.7, 2: 0.4}  # weight by seasons back
SIMS = int(os.environ.get("NHL_SIMS", "6000"))
GOALS_PER_WIN = 6.0
HOME_EDGE = 0.16                    # goals a game
REG_GOALS = 2.95                    # an average team's goals in regulation
TEAM_K = 40                         # games of results that count as much as the roster prior
# Regression toward average: each component counts as if it also had this many minutes (shots for finishing) of a
# perfectly average player. Bigger = more skeptical.
PRIOR = {"ev": 900, "pp": 250, "pk": 250, "fin": 900, "pen": 1500, "g": 3000}
# Credit for on-ice results: the share of the on-ice xG difference that goes to the player, against the league
# (league) and against his own team without him (rel). Set so the ratings of a team's lineup add up to its results
# (see backtest).
CREDIT = {"league": 0.25, "rel": 0.30}
# A small sample is pulled toward this rate (goals a 60 at even strength, each of offense and defense), a bit below
# average, since players who barely play are mostly fringe players
PRIOR_MEAN = -0.07
G_PRIOR_MEAN = -0.002               # the goalie version: goals saved per unblocked shot, below average
PEN_VALUE = 0.17                    # goals a penalty is worth (a power play's net xG)
FO_VALUE = 0.008                    # goals a won faceoff is worth


def load(name):
    p = os.path.join(SNAP, name)
    if not os.path.exists(p):
        return None
    with open(p) as f:
        return json.load(f)


def table(name):
    d = load(name)
    if not d:
        return []
    c = d["cols"]
    return [dict(zip(c, r)) for r in d["rows"]]


def per60(x, sec):
    return x / sec * 3600 if sec > 0 else 0.0


# ---------- player ratings ----------
def season_lines(season):
    """per player: one season's raw components, summed over teams if traded. Rates are per 60; minutes are minutes."""
    rows = table(f"mp_skaters_{season}.json")
    teams = {(r["team"], r["situation"]): r for r in table(f"mp_teams_{season}.json")}
    by = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    meta = {}
    for r in rows:
        pid = int(r["playerId"])
        s = by[pid][r["situation"]]
        for k, v in r.items():
            if isinstance(v, (int, float)) and k != "playerId":
                s[k] += v
        s["_teams"] = s.get("_teams", 0) + 1
        meta[pid] = {"name": r["name"], "team": r["team"], "pos": r["position"]}
    # league rates at each strength (per 60, for the five or four skaters on the ice)
    lg = {}
    for sit in ("5on5", "5on4", "4on5"):
        tt = [v for (t, s), v in teams.items() if s == sit]
        sec = sum(v["iceTime"] for v in tt) or 1
        lg[sit] = {"F": per60(sum(v["xGoalsFor"] for v in tt), sec), "A": per60(sum(v["xGoalsAgainst"] for v in tt), sec)}
    out = {}
    for pid, s in by.items():
        ev, pp, pk, al = s["5on5"], s["5on4"], s["4on5"], s["all"]
        gp = al.get("games_played", 0)
        if gp <= 0:
            continue
        m_ev, m_pp, m_pk = ev["icetime"] / 60, pp["icetime"] / 60, pk["icetime"] / 60
        onF, onA = per60(ev["OnIce_F_xGoals"], ev["icetime"]), per60(ev["OnIce_A_xGoals"], ev["icetime"])
        offF, offA = per60(ev["OffIce_F_xGoals"], ev["timeOnBench"]), per60(ev["OffIce_A_xGoals"], ev["timeOnBench"])
        # even strength: against the league, and against his own team with him on the bench
        evo = CREDIT["league"] * (onF - lg["5on5"]["F"]) + CREDIT["rel"] * (onF - offF if ev["timeOnBench"] > 0 else 0)
        evd = CREDIT["league"] * (lg["5on5"]["A"] - onA) + CREDIT["rel"] * (offA - onA if ev["timeOnBench"] > 0 else 0)
        ppF = per60(pp["OnIce_F_xGoals"], pp["icetime"])
        ppo = CREDIT["league"] * 1.1 * (ppF - lg["5on4"]["F"]) if m_pp > 0 else 0
        pkA = per60(pk["OnIce_A_xGoals"], pk["icetime"])
        pkd = CREDIT["league"] * 1.2 * (lg["4on5"]["A"] - pkA) if m_pk > 0 else 0
        out[pid] = {
            **meta[pid], "gp": gp, "m_all": al["icetime"] / 60, "m_ev": m_ev, "m_pp": m_pp, "m_pk": m_pk,
            "evo": evo, "evd": evd, "ppo": ppo, "pkd": pkd,
            "fin": al["I_F_goals"] - al["I_F_xGoals"], "shots": al["I_F_shotAttempts"],
            "pen": (al["penaltiesDrawn"] - al["penalties"]) * PEN_VALUE,
            "fo": (al["faceoffsWon"] - al["faceoffsLost"]) * FO_VALUE,
            "g": al["I_F_goals"], "a1": al["I_F_primaryAssists"], "a2": al["I_F_secondaryAssists"],
            "pts": al["I_F_points"], "ixg": al["I_F_xGoals"], "sog": al["I_F_shotsOnGoal"], "hits": al["I_F_hits"],
            "blk": al["shotsBlockedByPlayer"], "evxgf": ev["OnIce_F_xGoals"], "evxga": ev["OnIce_A_xGoals"],
            "evgf": ev["OnIce_F_goals"], "evga": ev["OnIce_A_goals"], "gs": al.get("gameScore", 0),
        }
    return out


def goalie_lines(season):
    by = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    meta = {}
    for r in table(f"mp_goalies_{season}.json"):
        pid = int(r["playerId"])
        s = by[pid][r["situation"]]
        for k, v in r.items():
            if isinstance(v, (int, float)) and k != "playerId":
                s[k] += v
        meta[pid] = {"name": r["name"], "team": r["team"], "pos": "G"}
    out = {}
    for pid, s in by.items():
        al = s["all"]
        if al.get("games_played", 0) <= 0:
            continue
        xg = al.get("flurryAdjustedxGoals") or al.get("xGoals", 0)
        out[pid] = {**meta[pid], "gp": al["games_played"], "m_all": al["icetime"] / 60, "xga": xg, "ga": al["goals"],
                    "att": al["unblocked_shot_attempts"], "sog": al["ongoal"], "gsax": xg - al["goals"],
                    "hd": al.get("highDangerShots", 0), "hdga": al.get("highDangerGoals", 0)}
    return out


def pool(seasons_data, w):
    """blend seasons: per-60 rates weighted by minutes and season weight, then regressed toward average"""
    acc = defaultdict(lambda: defaultdict(float))
    for back, data in seasons_data.items():
        sw = w.get(back, 0)
        if not sw:
            continue
        for pid, s in data.items():
            a = acc[pid]
            for comp, mins in (("evo", "m_ev"), ("evd", "m_ev"), ("ppo", "m_pp"), ("pkd", "m_pk")):
                a[comp] += s[comp] * s[mins] / 60 * sw   # goals
            a["m_ev"] += s["m_ev"] * sw
            a["m_pp"] += s["m_pp"] * sw
            a["m_pk"] += s["m_pk"] * sw
            a["m_all"] += s["m_all"] * sw
            a["fin"] += s["fin"] * sw
            a["shots"] += s["shots"] * sw
            a["pen"] += s["pen"] * sw
            a["fo"] += s["fo"] * sw
    rates = {}
    for pid, a in acc.items():
        r = {}
        r["evo"] = (a["evo"] + PRIOR_MEAN * PRIOR["ev"] / 60) / (a["m_ev"] + PRIOR["ev"]) * 60
        r["evd"] = (a["evd"] + PRIOR_MEAN * PRIOR["ev"] / 60) / (a["m_ev"] + PRIOR["ev"]) * 60
        r["ppo"] = a["ppo"] / (a["m_pp"] + PRIOR["pp"]) * 60
        r["pkd"] = a["pkd"] / (a["m_pk"] + PRIOR["pk"]) * 60
        # finishing: goals over xG per shot attempt, regressed hard, then back to per 60 of all play at his shot rate
        shots_per60 = a["shots"] / a["m_all"] * 60 if a["m_all"] else 0
        r["fin"] = (a["fin"] / (a["shots"] + PRIOR["fin"])) * shots_per60 if a["shots"] else 0
        r["pen"] = a["pen"] / (a["m_all"] + PRIOR["pen"]) * 60
        r["fo"] = a["fo"] / (a["m_all"] + PRIOR["pen"]) * 60
        r["mins"] = a["m_all"]
        rates[pid] = r
    return rates


def pool_goalies(seasons_data, w):
    acc = defaultdict(lambda: defaultdict(float))
    for back, data in seasons_data.items():
        sw = w.get(back, 0)
        for pid, s in data.items():
            acc[pid]["gsax"] += s["gsax"] * sw
            acc[pid]["att"] += s["att"] * sw
            acc[pid]["m"] += s["m_all"] * sw
    # MoneyPuck's xG runs a little under real goals league-wide, so measure against the league's own rate
    lg = sum(a["gsax"] for a in acc.values()) / (sum(a["att"] for a in acc.values()) or 1)
    out = {}
    for pid, a in acc.items():
        per_att = (a["gsax"] - lg * a["att"] + G_PRIOR_MEAN * PRIOR["g"]) / (a["att"] + PRIOR["g"])
        att60 = a["att"] / a["m"] * 60 if a["m"] else 45
        out[pid] = {"gsax60": per_att * att60, "mins": a["m"]}
    return out


def usage(cur, last):
    """expected minutes a game at each strength: this season's once he's played enough, else last season's"""
    def u(s):
        gp = max(1, s["gp"])
        return {"ev": s["m_ev"] / gp, "pp": s["m_pp"] / gp, "pk": s["m_pk"] / gp, "all": s["m_all"] / gp}
    out = {}
    for pid in set(cur) | set(last):
        c, l = cur.get(pid), last.get(pid)
        if c and l:
            k = min(1.0, c["gp"] / 15)
            uc, ul = u(c), u(l)
            out[pid] = {x: k * uc[x] + (1 - k) * ul[x] for x in uc}
        else:
            out[pid] = u(c or l)
    return out


def per_game(rate, use):
    """goals above average a game, by component"""
    return {
        "evo": rate["evo"] * use["ev"] / 60, "evd": rate["evd"] * use["ev"] / 60,
        "ppo": rate["ppo"] * use["pp"] / 60, "pkd": rate["pkd"] * use["pk"] / 60,
        "fin": rate["fin"] * use["all"] / 60, "pen": rate["pen"] * use["all"] / 60, "fo": rate["fo"] * use["all"] / 60,
    }


def replacement(seasons_data, usage_, positions):
    """per-60 rate of a replacement player at each position: the average of those just outside the league's regulars,
    from their own numbers (barely regressed, since regressing them is what pulls them toward this level)"""
    keep = dict(PRIOR)
    PRIOR.update(ev=60, pp=30, pk=30, pen=300)
    rates = pool(seasons_data, SEASON_W)
    PRIOR.clear(); PRIOR.update(keep)
    out = {}
    for grp, n_reg in (("F", 13 * 32), ("D", 7 * 32)):
        pool_ = [(usage_[p]["all"], p) for p in rates if p in usage_ and positions.get(p) and
                 (positions[p] == "D") == (grp == "D") and rates[p]["mins"] > 100]
        pool_.sort(reverse=True)
        fringe = [p for _, p in pool_[n_reg: n_reg + 90]]
        tot = [sum(per_game(rates[p], usage_[p]).values()) / usage_[p]["all"] * 60 for p in fringe if usage_[p]["all"] > 0]
        out[grp] = sum(tot) / len(tot) if tot else -0.2
    return out


# ---------- team strength ----------
def lineup(players, n_f=12, n_d=6):
    f = sorted([p for p in players if p["grp"] == "F"], key=lambda p: -p["use"]["all"])[:n_f]
    d = sorted([p for p in players if p["grp"] == "D"], key=lambda p: -p["use"]["all"])[:n_d]
    return f + d


def goalie_split(goalies):
    """share of starts: this season's starts plus a prior that favors the established starter"""
    if not goalies:
        return []
    gs = sorted(goalies, key=lambda g: -(g.get("gs_now", 0) + g.get("gs_last", 0) * 0.25))
    w = [g.get("gs_now", 0) + 6 * (0.65 if i == 0 else 0.35 if i == 1 else 0.0) for i, g in enumerate(gs)]
    s = sum(w) or 1
    return [(g, x / s) for g, x in zip(gs, w) if x > 0]


def roster_strength(skaters, goalies):
    ln = lineup(skaters)
    # scale to an 18-skater lineup at ~60 minutes of five-man hockey: minutes in the data run a little over that
    comp = defaultdict(float)
    for p in ln:
        for k, v in p["pg"].items():
            comp[k] += v
    for g, share in goalie_split(goalies):
        comp["gk"] += g["rate"]["gsax60"] * share
    return dict(comp), sum(comp.values())


# ---------- the season ----------
def pois(lam, k):
    return math.exp(-lam) * lam ** k / math.factorial(k)


def game_probs(margin):
    """home margin (goals) -> P(home wins in regulation), P(tie after 60), P(home wins OT/shootout | tie)"""
    lh, la = max(0.4, REG_GOALS + margin / 2), max(0.4, REG_GOALS - margin / 2)
    ph = [pois(lh, k) for k in range(15)]
    pa = [pois(la, k) for k in range(15)]
    win = sum(ph[i] * pa[j] for i in range(15) for j in range(i))
    tie = sum(ph[i] * pa[i] for i in range(15))
    ot = 1 / (1 + math.exp(-margin * 0.55))
    return win, tie, ot


def simulate(teams, games, strength, sims):
    abbrs = [t["abbr"] for t in teams]
    idx = {a: i for i, a in enumerate(abbrs)}
    conf = {t["abbr"]: t["conferenceAbbrev"] for t in teams}
    div = {t["abbr"]: t["divisionName"] for t in teams}
    base = {t["abbr"]: (t["points"], t["regulationWins"], t["regulationPlusOtWins"], t["wins"], t["gamesPlayed"]) for t in teams}
    rest = []
    for g in games:
        if g["state"] in ("FUT", "PRE") and g["home"] in idx and g["away"] in idx:
            m = strength[g["home"]] - strength[g["away"]] + HOME_EDGE
            rest.append((idx[g["home"]], idx[g["away"]], *game_probs(m)))
    n = len(abbrs)
    tally = {a: defaultdict(float) for a in abbrs}
    rng = random.Random(20261113)
    divs = defaultdict(list)
    for a in abbrs:
        divs[(conf[a], div[a])].append(idx[a])

    def series(a, b, home_a):
        m = strength[abbrs[a]] - strength[abbrs[b]]
        pw = []
        for hosted in (True, False):
            w, t, o = game_probs(m + (HOME_EDGE if hosted else -HOME_EDGE))
            pw.append(w + t * o)
        # 2-2-1-1-1: the higher seed hosts games 1, 2, 5 and 7
        order = [home_a, home_a, not home_a, not home_a, home_a, not home_a, home_a]
        wa = wb = 0
        for h in order:
            if rng.random() < (pw[0] if h else pw[1]):
                wa += 1
            else:
                wb += 1
            if wa == 4 or wb == 4:
                break
        return a if wa == 4 else b

    for _ in range(sims):
        pts = [base[a][0] for a in abbrs]
        rw = [base[a][1] for a in abbrs]
        row = [base[a][2] for a in abbrs]
        w = [base[a][3] for a in abbrs]
        for h, a, pwin, ptie, pot in rest:
            r = rng.random()
            if r < pwin:
                pts[h] += 2; rw[h] += 1; row[h] += 1; w[h] += 1
            elif r < pwin + ptie:
                if rng.random() < pot:
                    pts[h] += 2; pts[a] += 1; w[h] += 1
                    if rng.random() < 0.6: row[h] += 1   # about 60% of tied games end in overtime, not a shootout
                else:
                    pts[a] += 2; pts[h] += 1; w[a] += 1
                    if rng.random() < 0.6: row[a] += 1
            else:
                pts[a] += 2; rw[a] += 1; row[a] += 1; w[a] += 1
        key = [(pts[i], rw[i], row[i], w[i], rng.random()) for i in range(n)]
        order = sorted(range(n), key=lambda i: key[i], reverse=True)
        for rank, i in enumerate(order):
            t = tally[abbrs[i]]
            t["pts"] += pts[i]
            if rank == 0:
                t["pres"] += 1
            if rank >= n - 1:
                t["last"] += 1
        champs = []
        for c in ("E", "W"):
            dv = [k for k in divs if k[0] == c]
            tops, rest_c = [], []
            for k in dv:
                srt = sorted(divs[k], key=lambda i: key[i], reverse=True)
                tops.append(srt)
                tally[abbrs[srt[0]]]["div"] += 1
                rest_c += srt[3:]
            wc = sorted(rest_c, key=lambda i: key[i], reverse=True)[:2]
            in_ = [i for s in tops for i in s[:3]] + wc
            for i in in_:
                tally[abbrs[i]]["po"] += 1
            # the better division winner draws the second wild card
            d1, d2 = sorted(tops, key=lambda s: key[s[0]], reverse=True)
            side1 = [(d1[0], wc[1]), (d1[1], d1[2])]
            side2 = [(d2[0], wc[0]), (d2[1], d2[2])]
            finalists = []
            for side in (side1, side2):
                r1 = [series(x, y, True) for x, y in side]
                for i in r1:
                    tally[abbrs[i]]["r2"] += 1
                a_, b_ = sorted(r1, key=lambda i: key[i], reverse=True)
                finalists.append(series(a_, b_, True))
            for i in finalists:
                tally[abbrs[i]]["cf"] += 1
            a_, b_ = sorted(finalists, key=lambda i: key[i], reverse=True)
            champ = series(a_, b_, True)
            tally[abbrs[champ]]["final"] += 1
            champs.append(champ)
        a_, b_ = sorted(champs, key=lambda i: key[i], reverse=True)
        tally[abbrs[series(a_, b_, True)]]["cup"] += 1
    return {a: {k: v / sims for k, v in t.items()} for a, t in tally.items()}, len(rest)


# ---------- lines ----------
def split_ids(line_id):
    s = str(line_id)
    return [int(s[i:i + 7]) for i in range(0, len(s), 7)]


def team_lines(lines, team, roster_ids, kind, n):
    cands = [r for r in lines if r["team"] == team and r["position"] == kind and r["situation"] == "5on5"]
    cands.sort(key=lambda r: -r["icetime"])
    used, out = set(), []
    for r in cands:
        ids = split_ids(r["lineId"])
        if any(i not in roster_ids or i in used for i in ids):
            continue
        used.update(ids)
        tot = r["xGoalsFor"] + r["xGoalsAgainst"]
        out.append({"ids": ids, "min": round(r["icetime"] / 60, 1), "gp": r["games_played"],
                    "xgf": round(r["xGoalsFor"], 2), "xga": round(r["xGoalsAgainst"], 2),
                    "gf": r["goalsFor"], "ga": r["goalsAgainst"], "xgp": round(r["xGoalsFor"] / tot, 3) if tot else None})
        if len(out) == n:
            break
    return out


# ---------- build ----------
def age_on(born, day):
    if not born:
        return None
    y, m, d = map(int, born.split("-"))
    Y, M, D = map(int, day.split("-"))
    return Y - y - ((M, D) < (m, d))


def rate_everyone(season):
    cur, last, prev = season_lines(season), season_lines(season - 1), season_lines(season - 2)
    sk_rates = pool({0: cur, 1: last, 2: prev}, SEASON_W)
    gcur, glast, gprev = goalie_lines(season), goalie_lines(season - 1), goalie_lines(season - 2)
    g_rates = pool_goalies({0: gcur, 1: glast, 2: gprev}, SEASON_W)
    use = usage(cur, last)
    return cur, last, prev, sk_rates, gcur, glast, gprev, g_rates, use


def build():
    st = load("standings.json")
    rosters, cstats, sched = load("rosters.json"), load("clubstats.json"), load("schedule.json")
    if not (st and rosters and cstats and sched):
        print("missing NHL snapshots; nothing to build", file=sys.stderr)
        return
    teams = st["teams"]
    today = (teams[0].get("date") or time.strftime("%Y-%m-%d"))
    cur, last, prev, sk_rates, gcur, glast, gprev, g_rates, use = rate_everyone(SEASON)

    pos_of = {}
    for t, r in rosters.items():
        for grp in ("forwards", "defensemen"):
            for p in r[grp]:
                pos_of[p["id"]] = "D" if grp == "defensemen" else "F"
    for data in (cur, last, prev):
        for pid, s in data.items():
            pos_of.setdefault(pid, "D" if s["pos"] == "D" else "F")
    repl = replacement({0: cur, 1: last, 2: prev}, use, pos_of)
    # replacement goalie: the ones just past the league's top 64 by workload, from their own (barely regressed) numbers
    keep = PRIOR["g"]
    PRIOR["g"] = 150
    g_raw = pool_goalies({0: gcur, 1: glast, 2: gprev}, SEASON_W)
    PRIOR["g"] = keep
    g_pool = sorted([(r["mins"], r["gsax60"]) for r in g_raw.values()], reverse=True)[64:110]
    g_repl = sum(x for _, x in g_pool) / len(g_pool) if g_pool else -0.2

    stats_by_id = {}
    for t, s in cstats.items():
        for p in s["skaters"]:
            stats_by_id[p["id"]] = (t, p)
        for p in s["goalies"]:
            stats_by_id[p["id"]] = (t, p)

    players, team_sk, team_g = {}, defaultdict(list), defaultdict(list)
    for t, r in rosters.items():
        for grp_key in ("forwards", "defensemen", "goalies"):
            for p in r[grp_key]:
                pid = p["id"]
                grp = {"forwards": "F", "defensemen": "D", "goalies": "G"}[grp_key]
                rec = {"id": pid, "name": f'{p["first"]} {p["last"]}', "team": t, "pos": p["pos"], "grp": grp,
                       "num": p["num"], "age": age_on(p["born"], today), "born": p["born"], "shoots": p["shoots"],
                       "ht": p["ht"], "wt": p["wt"], "country": p["country"], "head": p["head"]}
                ns = stats_by_id.get(pid)
                if ns and ns[0] == t:
                    rec["now"] = {k: v for k, v in ns[1].items() if k not in ("id", "first", "last", "head", "pos")}
                if grp == "G":
                    rate = g_rates.get(pid, {"gsax60": g_repl, "mins": 0})
                    gs_now = (rec.get("now") or {}).get("gs") or 0
                    gl = glast.get(pid)
                    rec.update(rate=rate, gs_now=gs_now, gs_last=(gl or {}).get("gp", 0))
                    rec["gar60"] = rate["gsax60"] - g_repl
                    rec["war"] = round(rec["gar60"] * 58 / GOALS_PER_WIN, 2)       # a 58-start season
                    rec["gaa60"] = rate["gsax60"]
                    seasons = []
                    for yr, data in ((SEASON, gcur), (SEASON - 1, glast), (SEASON - 2, gprev)):
                        s = data.get(pid)
                        if s:
                            seasons.append({"yr": yr, "team": s["team"], "gp": s["gp"], "min": round(s["m_all"]),
                                            "sa": s["sog"], "ga": s["ga"], "xga": round(s["xga"], 1),
                                            "gsax": round(s["gsax"], 1),
                                            "sv": round(1 - s["ga"] / s["sog"], 3) if s["sog"] else None})
                    rec["seasons"] = seasons
                    gn = gcur.get(pid)
                    rec["gar_now"] = round((gn["gsax"] - g_repl * gn["m_all"] / 60) if gn else 0, 1)
                    team_g[t].append(rec)
                else:
                    rate = sk_rates.get(pid)
                    u = use.get(pid) or {"ev": 9.0 if grp == "F" else 12.0, "pp": 0.3, "pk": 0.3, "all": 11.0 if grp == "F" else 15.0}
                    if not rate:
                        rate = {"evo": 0, "evd": 0, "ppo": 0, "pkd": 0, "fin": 0, "pen": 0, "fo": 0, "mins": 0}
                        rate["evo"] = repl[grp] * 0.5
                        rate["evd"] = repl[grp] * 0.5
                    pg = per_game(rate, u)
                    rec.update(rate={k: round(v, 3) for k, v in rate.items()}, use={k: round(v, 2) for k, v in u.items()},
                               pg=pg)
                    tot60 = sum(pg.values()) / u["all"] * 60 if u["all"] else 0
                    rec["gaa60"] = round(tot60, 3)
                    rec["gar"] = round((tot60 - repl[grp]) * u["all"] / 60 * 82, 1)      # over 82 games at his minutes
                    rec["war"] = round(rec["gar"] / GOALS_PER_WIN, 2)
                    rec["comp"] = {k: round(v * 82, 1) for k, v in pg.items()}            # goals above average over 82
                    seasons = []
                    for yr, data in ((SEASON, cur), (SEASON - 1, last), (SEASON - 2, prev)):
                        s = data.get(pid)
                        if s:
                            seasons.append({"yr": yr, "team": s["team"], "gp": int(s["gp"]), "g": int(s["g"]),
                                            "a": int(s["a1"] + s["a2"]), "pts": int(s["pts"]),
                                            "toi": round(s["m_all"] / s["gp"], 1), "ixg": round(s["ixg"], 1),
                                            "sog": int(s["sog"]),
                                            "xgp": round(s["evxgf"] / (s["evxgf"] + s["evxga"]), 3) if s["evxgf"] + s["evxga"] else None,
                                            "hits": int(s["hits"]), "blk": int(s["blk"])})
                    rec["seasons"] = seasons
                    # this season so far: unregressed, goals above replacement
                    c = cur.get(pid)
                    if c:
                        raw = (c["evo"] + c["evd"]) * c["m_ev"] / 60 + c["ppo"] * c["m_pp"] / 60 + c["pkd"] * c["m_pk"] / 60 \
                            + c["fin"] * 0.35 + c["pen"] + c["fo"]
                        rec["gar_now"] = round(raw - repl[grp] * c["m_all"] / 60, 1)
                    team_sk[t].append(rec)
                players[pid] = rec

    # percentile tiers within position among regulars
    for grp, n_reg in (("F", 12 * 32), ("D", 6 * 32), ("G", 2 * 32)):
        ps = sorted([p for p in players.values() if p["grp"] == grp], key=lambda p: -p["war"])
        for i, p in enumerate(ps):
            p["rank"] = i + 1
            p["pctl"] = round(1 - i / max(1, min(len(ps), n_reg)), 3) if i < n_reg else 0

    mpteams = {r["team"]: r for r in table(f"mp_teams_{SEASON}.json") if r["situation"] == "all"}
    strength, team_out = {}, []
    for t in teams:
        a = t["abbr"]
        comp, prior = roster_strength(team_sk[a], team_g[a])
        gp = t["gamesPlayed"] or 0
        mp = mpteams.get(a)
        if gp and mp:
            xgd = (mp["flurryScoreVenueAdjustedxGoalsFor"] - mp["flurryScoreVenueAdjustedxGoalsAgainst"]) / gp
            gd = (t["goalFor"] - t["goalAgainst"]) / gp
            obs = 0.7 * xgd + 0.3 * gd
        else:
            obs, xgd, gd = prior, None, None
        rating = (gp * obs + TEAM_K * prior) / (gp + TEAM_K)
        strength[a] = rating
        team_out.append({"t": t, "comp": comp, "prior": prior, "obs": obs, "xgd": xgd, "gd": gd, "rating": rating})
    # center on zero: an average team is 0
    mean = sum(strength.values()) / len(strength)
    for a in strength:
        strength[a] -= mean
    odds, n_left = simulate(teams, sched, strength, SIMS)

    roster_ids = {a: {p["id"] for p in team_sk[a] + team_g[a]} for a in rosters}
    lines = table(f"mp_lines_{SEASON}.json")
    out_teams = []
    for x in team_out:
        t = x["t"]
        a = t["abbr"]
        o = odds[a]
        left = sum(1 for g in sched if g["state"] in ("FUT", "PRE") and a in (g["home"], g["away"]))
        pp_unit = sorted([p for p in team_sk[a]], key=lambda p: -p["use"]["pp"])[:10]
        pk_unit = sorted([p for p in team_sk[a]], key=lambda p: -p["use"]["pk"])[:8]
        gsplit = goalie_split(team_g[a])
        out_teams.append({
            "abbr": a, "name": t["name"], "common": t["common"], "place": t["place"], "logo": t["logo"],
            "logoDark": t["logoDark"], "conf": t["conferenceAbbrev"], "confName": t["conferenceName"],
            "div": t["divisionName"],
            "rec": {k: t[k] for k in ("gamesPlayed", "wins", "losses", "otLosses", "points", "pointPctg", "regulationWins",
                                      "regulationPlusOtWins", "goalFor", "goalAgainst", "l10Wins", "l10Losses",
                                      "l10OtLosses", "streakCode", "streakCount", "homeWins", "homeLosses",
                                      "homeOtLosses", "roadWins", "roadLosses", "roadOtLosses")},
            "left": left,
            "rating": round(strength[a], 3), "prior": round(x["prior"] - mean, 3), "obs": round(x["obs"], 3),
            "xgd": None if x["xgd"] is None else round(x["xgd"], 3),
            "comp": {k: round(v, 3) for k, v in x["comp"].items()},
            "odds": {k: round(o.get(k, 0), 4) for k in ("po", "div", "pres", "r2", "cf", "final", "cup", "last")},
            "projPts": round(o.get("pts", 0), 1),
            "lines": team_lines(lines, a, roster_ids[a], "line", 4),
            "pairs": team_lines(lines, a, roster_ids[a], "pairing", 3),
            "pp": [p["id"] for p in pp_unit if p["use"]["pp"] > 0.5],
            "pk": [p["id"] for p in pk_unit if p["use"]["pk"] > 0.4],
            "goalies": [[g["id"], round(s, 3)] for g, s in gsplit],
        })

    def slim(p):
        q = {k: v for k, v in p.items() if k not in ("pg", "rate", "gs_now", "gs_last")}
        if p["grp"] == "G":
            q["gsax60"] = round(p["rate"]["gsax60"], 3)
            q["gar60"] = round(p["gar60"], 3)
        else:
            q["use"] = p["use"]
        return q

    hub = {
        "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "asOf": today, "season": "2026-27",
        "sims": SIMS, "gamesLeft": n_left,
        "repl": {"F": round(repl["F"], 3), "D": round(repl["D"], 3), "G": round(g_repl, 3)},
        "params": {"goalsPerWin": GOALS_PER_WIN, "homeEdge": HOME_EDGE, "regGoals": REG_GOALS, "teamK": TEAM_K,
                   "prior": PRIOR, "credit": CREDIT, "seasonW": SEASON_W, "penValue": PEN_VALUE, "foValue": FO_VALUE},
        "teams": out_teams,
        "players": [slim(p) for p in sorted(players.values(), key=lambda p: -p["war"])],
        "schedule": [[g["date"], g["away"], g["home"], g.get("as"), g.get("hs"), g.get("end")] for g in sched],
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "hub.json"), "w") as f:
        json.dump(hub, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote nhl/data/hub.json: {len(out_teams)} teams, {len(players)} players, {n_left} games left, {SIMS} sims "
          f"({os.path.getsize(os.path.join(OUT, 'hub.json')) // 1024} KB)")


# ---------- backtest ----------
def backtest():
    """Rate players on 2024-25 (and the year before is missing, so one season), then see how well 2025-26's lineups,
    priced at those ratings and at each player's real 2025-26 minutes, line up with 2025-26's goal differentials."""
    s_prev, s_bt = SEASON - 2, SEASON - 1
    base = season_lines(s_prev)
    rates = pool({0: base}, {0: 1.0})
    g_rates = pool_goalies({0: goalie_lines(s_prev)}, {0: 1.0})
    nxt = season_lines(s_bt)
    gn = goalie_lines(s_bt)
    use = usage(nxt, {})
    teams = {r["team"]: r for r in table(f"mp_teams_{s_bt}.json") if r["situation"] == "all"}
    pred, act, xact = [], [], []
    for team, tr in teams.items():
        sk = []
        for pid, s in nxt.items():
            if s["team"] != team:
                continue
            r = rates.get(pid) or {"evo": -0.1, "evd": -0.1, "ppo": 0, "pkd": 0, "fin": 0, "pen": 0, "fo": 0, "mins": 0}
            sk.append({"grp": "D" if s["pos"] == "D" else "F", "use": use[pid], "pg": per_game(r, use[pid])})
        gs = [{"rate": g_rates.get(pid, {"gsax60": -0.1}), "gs_now": s["gp"]} for pid, s in gn.items() if s["team"] == team]
        _, total = roster_strength(sk, gs)
        gp = tr["games_played"]
        pred.append(total)
        act.append((tr["goalsFor"] - tr["goalsAgainst"]) / gp)
        xact.append((tr["flurryScoreVenueAdjustedxGoalsFor"] - tr["flurryScoreVenueAdjustedxGoalsAgainst"]) / gp)

    def fit(x, y):
        n = len(x)
        mx, my = sum(x) / n, sum(y) / n
        sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
        sxx = sum((a - mx) ** 2 for a in x)
        syy = sum((b - my) ** 2 for b in y)
        return sxy / sxx, sxy / math.sqrt(sxx * syy)
    for lab, y in (("goal diff", act), ("xG diff", xact)):
        slope, r = fit(pred, y)
        print(f"{lab}: r={r:.3f}  slope={slope:.2f} (1.0 means the ratings add up right)  "
              f"pred sd={(sum(p * p for p in pred) / len(pred)) ** .5:.3f}  actual sd={(sum(v * v for v in y) / len(y)) ** .5:.3f}")


if __name__ == "__main__":
    if sys.argv[1:] == ["backtest"]:
        backtest()
    else:
        build()
