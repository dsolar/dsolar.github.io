"""Build the Win Probability scenario bank (data.js) from the data package.

Usage: python3 -I build_bank.py <winprob_data_dir> <output_data_js>
"""
import json
import sys

import numpy as np
import pandas as pd

ROOT, DEST = sys.argv[1], sys.argv[2]
RAW, OUT = f"{ROOT}/raw", f"{ROOT}/out"
rng = np.random.default_rng(20261016)

# ---------------------------------------------------------------- helpers
teams = pd.read_csv(f"{RAW}/other/teams_colors_logos.csv").set_index("team_abbr")
players = pd.read_csv(f"{RAW}/other/players.csv", usecols=["gsis_id", "display_name"]).dropna()
pname = dict(zip(players.gsis_id, players.display_name))


def era_abbr(team, season):
    if team == "LV" and season <= 2019:
        return "OAK"
    if team == "LAC" and season <= 2016:
        return "SD"
    if team == "LA" and season <= 2015:
        return "STL"
    return team


def team_info(team, season):
    a = era_abbr(team, season)
    r = teams.loc[a] if a in teams.index else teams.loc[team]
    name = r.team_name
    if a == "WAS":
        name = "Washington Commanders" if season >= 2022 else ("Washington Football Team" if season >= 2020 else "Washington")
    return {"abbr": "LAR" if a == "LA" else a, "name": name, "nick": r.team_nick if a != "WAS" or season >= 2022 else "Washington",
            "c1": r.team_color, "c2": r.team_color2}


TEAMS = {}


def tkey(team, season):
    info = team_info(team, season)
    key = info["abbr"] if info["name"] != "Washington" and info["name"] != "Washington Football Team" else ("WAS0" if info["name"] == "Washington" else "WFT")
    TEAMS[key] = info
    return key


def round_label(season, week, stype):
    if stype != "POST":
        return f"Week {int(week)}"
    base = 18 if season <= 2020 else 19
    return {0: "Wild Card round", 1: "Divisional round", 2: "Conference championship", 3: "Super Bowl"}.get(int(week) - base, "Playoffs")


def pct(v):
    return None if v is None or pd.isna(v) else round(float(v) * 100, 1)


def num(v):
    return None if v is None or pd.isna(v) else (int(v) if float(v).is_integer() else round(float(v), 1))


# primary QB / kicker / punter ids per team-game (full names)
def people_for(game_ids):
    seasons = sorted({int(g[:4]) for g in game_ids})
    out = []
    for s in seasons:
        d = pd.read_parquet(f"{RAW}/pbp/play_by_play_{s}.parquet",
                            columns=["game_id", "posteam", "pass_attempt", "passer_player_id", "field_goal_attempt",
                                     "extra_point_attempt", "kicker_player_id", "punt_attempt", "punter_player_id"])
        d = d[d.game_id.isin(game_ids)]

        def top(df, col):
            df = df.dropna(subset=[col])
            return df.groupby(["game_id", "posteam"])[col].agg(lambda x: x.value_counts().index[0])
        qb = top(d[d.pass_attempt == 1], "passer_player_id").rename("qb_id")
        k = top(d[(d.field_goal_attempt == 1) | (d.extra_point_attempt == 1)], "kicker_player_id").rename("k_id")
        p = top(d[d.punt_attempt == 1], "punter_player_id").rename("p_id")
        out.append(pd.concat([qb, k, p], axis=1).reset_index())
    r = pd.concat(out, ignore_index=True)
    for c in ["qb_id", "k_id", "p_id"]:
        r[c.replace("_id", "")] = r[c].map(pname)
    return r.set_index(["game_id", "posteam"])[["qb", "k", "p"]]


def game_ctx(game_ids):
    seasons = sorted({int(g[:4]) for g in game_ids})
    rows = []
    for s in seasons:
        d = pd.read_parquet(f"{RAW}/pbp/play_by_play_{s}.parquet",
                            columns=["game_id", "home_team", "away_team", "spread_line", "result", "home_coach",
                                     "away_coach", "roof", "temp", "wind", "stadium", "home_opening_kickoff"])
        rows.append(d[d.game_id.isin(game_ids)].groupby("game_id").first())
    return pd.concat(rows)


def yl_bin(y):
    edges = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    labels = ["opp 1-10", "opp 11-20", "opp 21-30", "opp 31-40", "opp 41-50", "own 41-49", "own 31-40", "own 21-30", "own 11-20", "own 1-10"]
    for i in range(10):
        if edges[i] < y <= edges[i + 1]:
            return labels[i]


def yds_bin(y):
    for lo, hi, lab in [(0, 1, "1"), (1, 2, "2"), (2, 3, "3"), (3, 5, "4-5"), (5, 9, "6-9"), (9, 99, "10+")]:
        if lo < y <= hi:
            return lab


def state_bin(qtr, diff):
    if qtr < 4:
        return "Q1-Q3"
    if abs(diff) <= 8:
        return "Q4/OT within 8"
    return "Q4/OT trailing 9+" if diff < 0 else "Q4/OT leading 9+"


bins = pd.read_csv(f"{OUT}/coach_decision_rates_2021_2026.csv")
bins = {(r.ydstogo_bin, r.yardline_bin, r.state_bin): r for r in bins.itertuples()}


def coach_rates(ytg, yl, qtr, diff):
    r = bins.get((yds_bin(ytg), yl_bin(yl), state_bin(qtr, diff)))
    if r is None:
        return None
    return {"go": num(getattr(r, "go", 0)), "punt": num(getattr(r, "punt", 0)), "fg": num(getattr(r, "fg", 0)), "n": int(r.n)}


def options_4th(go, punt, fg, fgp, yl):
    o = {"go": pct(go)}
    if punt is not None and not pd.isna(punt):
        o["punt"] = pct(punt)
    if fg is not None and not pd.isna(fg) and fgp is not None and not pd.isna(fgp) and yl + 17 <= 66:
        o["fg"] = pct(fg)
    return o


def difficulty(opts):
    v = sorted(opts.values(), reverse=True)
    gap = v[0] - v[1]
    return ("coin" if gap < 1.0 else "hard" if gap < 2.0 else "medium" if gap < 4.0 else "easy"), round(gap, 1)


# ---------------------------------------------------------------- 4th-down bank
play = pd.read_csv(f"{OUT}/fourth_down_playable.csv")
inp = pd.read_csv(f"{OUT}/fourth_down_inputs_nfl4th.csv")
fd = play.drop(columns=["go_wp", "punt_wp", "fg_wp", "go_boost", "best", "gap_pp", "difficulty"]).merge(inp, on=["game_id", "play_id"])
fd = fd[fd.go_wp.notna() & fd.wp.between(0.08, 0.92)].copy()
fd["opts"] = [options_4th(r.go_wp, r.punt_wp, r.fg_wp, r.fg_make_prob, r.yardline_100) for r in fd.itertuples()]
fd = fd[fd.opts.map(len) >= 2]
fd["best"] = fd.opts.map(lambda o: max(o, key=o.get))
fd[["diff", "gap"]] = pd.DataFrame(fd.opts.map(difficulty).tolist(), index=fd.index)
fd["recent"] = fd.season >= 2019

famous = json.load(open(f"{OUT}/famous_calls.json"))
famous_keys = {(c["game_id"], float(c["play_id"])) for c in famous}
fd = fd[[(g, p) not in famous_keys for g, p in zip(fd.game_id, fd.play_id)]]

targets = {"go": 460, "punt": 400, "fg": 300}
mix = {"easy": .30, "medium": .35, "hard": .25, "coin": .10}
picked = []
for best, n in targets.items():
    for dif, share in mix.items():
        pool = fd[(fd.best == best) & (fd["diff"] == dif)]
        k = min(len(pool), int(round(n * share)))
        w = np.where(pool.recent, 3.0, 1.0)
        idx = rng.choice(pool.index, size=k, replace=False, p=w / w.sum()) if k else []
        picked.append(fd.loc[idx])
fd = pd.concat(picked)

# ---------------------------------------------------------------- two-point bank
pat = pd.read_csv(f"{OUT}/pat_decision_pool_2014_2026.csv").merge(pd.read_csv(f"{OUT}/pat_two_point_nfl4th.csv"), on=["game_id", "play_id"])
pat = pat[pat.wp_go1.notna() & pat.wp.between(0.05, 0.95)].copy()
pat["edge"] = (pat.wp_go2 - pat.wp_go1) * 100
late = pat.qtr >= 4
pat = pat[((pat.edge.abs() >= 1.0) & (pat.qtr >= 3)) | (late & (pat.edge.abs() < 1.0))]
pat = pat[[(g, p) not in famous_keys for g, p in zip(pat.game_id, pat.play_id)]]
pat["best"] = np.where(pat.edge > 0, "two", "kick")
picks = []
for best, n in {"two": 170, "kick": 150}.items():
    pool = pat[pat.best == best]
    w = np.where(pool.season >= 2019, 3.0, 1.0) * np.where(pool.qtr >= 4, 2.0, 1.0)
    picks.append(pat.loc[rng.choice(pool.index, size=min(n, len(pool)), replace=False, p=w / w.sum())])
pat = pd.concat(picks)
# what coaches did with the same margin (all tries 2018+, split by Q4 vs earlier)
allpat = pd.read_csv(f"{OUT}/pat_decision_pool_2014_2026.csv")
allpat = allpat[allpat.season >= 2018]
allpat["late"] = allpat.qtr >= 4
pat_rates = allpat.groupby(["margin_before_try", "late"]).choice.agg(two=lambda c: round((c == "two").mean() * 100, 1), n="size")

# ---------------------------------------------------------------- contexts
all_games = set(fd.game_id) | set(pat.game_id) | {c["game_id"] for c in famous}
ppl = people_for(all_games)
ctx = game_ctx(all_games)


def who(gid, team, field):
    try:
        v = ppl.loc[(gid, team), field]
        return None if pd.isna(v) else v
    except KeyError:
        return None


def base(gid, pid, season, stype, week, date, pos, deff, qtr, clock, ps, ds, pto, dto, yl, kind):
    g = ctx.loc[gid]
    home = g.home_team
    spread = g.spread_line if pos == home else -g.spread_line
    won = (g.result > 0) if pos == home else (g.result < 0)
    tie = g.result == 0
    return {
        "id": f"{kind}-{gid}-{int(pid)}", "kind": kind, "season": int(season), "round": round_label(season, week, stype),
        "post": stype == "POST", "date": str(date)[:10],
        "you": tkey(pos, season), "opp": tkey(deff, season), "home": pos == home,
        "score": [int(ps), int(ds)], "qtr": int(qtr), "clock": clock, "to": [int(pto), int(dto)], "yl": num(yl),
        "roof": g.roof, "temp": num(g.temp), "wind": num(g.wind), "spread": num(spread),
        "coach": g.home_coach if pos == home else g.away_coach, "oppCoach": g.away_coach if pos == home else g.home_coach,
        "qb": who(gid, pos, "qb"), "kicker": who(gid, pos, "k"), "punter": who(gid, pos, "p"), "oppQb": who(gid, deff, "qb"),
        "final": "tie" if tie else ("won" if won else "lost"),
    }


def final_score(gid, pos):
    g = ctx.loc[gid]
    return None


scen = []
for r in fd.itertuples():
    s = base(r.game_id, r.play_id, r.season, r.season_type, r.week, r.game_date, r.posteam, r.defteam, r.qtr, r.time,
             r.posteam_score, r.defteam_score, r.posteam_timeouts_remaining, r.defteam_timeouts_remaining, r.yardline_100, "4th")
    s.update({
        "down": 4, "ytg": int(r.ydstogo), "g2g": bool(r.goal_to_go == 1), "opts": r.opts, "best": r.best, "diff": getattr(r, "diff"),
        "inputs": {"conv": pct(r.first_down_prob), "wpS": pct(r.wp_succeed), "wpF": pct(r.wp_fail), "fgp": pct(r.fg_make_prob),
                   "wpM": pct(r.make_fg_wp), "wpX": pct(r.miss_fg_wp), "fgDist": int(r.yardline_100 + 17)},
        "coaches": {"go": num(r.coaches_go_pct), "punt": num(r.coaches_punt_pct), "fg": num(r.coaches_fg_pct), "n": int(r.coaches_similar_n)}
        if not pd.isna(r.coaches_similar_n) else None,
        "real": {"did": r.decision, "result": r.outcome}, "model": "nfl4th",
    })
    scen.append(s)

for r in pat.itertuples():
    g = ctx.loc[r.game_id]
    pos = r.posteam
    s = base(r.game_id, r.play_id, r.season, r.season_type, r.week, r.game_date, pos, r.defteam, r.qtr, r.time,
             r.posteam_score, r.defteam_score, r.posteam_timeouts_remaining, r.defteam_timeouts_remaining, 2, "pat")
    rates = pat_rates.loc[(r.margin_before_try, r.qtr >= 4)] if (r.margin_before_try, r.qtr >= 4) in pat_rates.index else None
    s.update({
        "opts": {"kick": pct(r.wp_go1), "two": pct(r.wp_go2)}, "best": "two" if pct(r.wp_go2) > pct(r.wp_go1) else "kick", "diff": difficulty({"a": r.wp_go1 * 100, "b": r.wp_go2 * 100})[0],
        "inputs": {"xp": pct(r.conv_1pt), "two": pct(r.conv_2pt), "wp0": pct(r.wp_0), "wp1": pct(r.wp_1), "wp2": pct(r.wp_2)},
        "coaches": {"two": num(rates.two), "kick": round(100 - rates.two, 1), "n": int(rates.n)} if rates is not None else None,
        "real": {"did": r.choice, "result": "good" if r.success else "no good"}, "model": "nfl4th",
    })
    scen.append(s)

# ---------------------------------------------------------------- famous calls
fam_out = []
for c in famous:
    gid, pid, season = c["game_id"], c["play_id"], int(c["game_id"][:4])
    n4 = c.get("nfl4th") or {}
    common = dict(gid=gid, pid=pid, season=season, stype=c["season_type"], week=c["week"], date=c["game_date"])
    pos, deff = c["posteam"], c["defteam"]
    if c["category"] == "fourth_down":
        if c["id"] == "shanahan-sb58-ot-fg":
            opts, inputs, model = {"go": 75.4, "fg": 74.5}, {"fgDist": int(c["yardline_100"] + 17)}, "espn"
        elif n4.get("go_wp") is not None:
            opts = {k: n4[k + "_wp"] for k in ("go", "punt", "fg") if n4.get(k + "_wp") is not None}
            i = n4.get("inputs", {})
            inputs = {"conv": i.get("conversion_prob"), "wpS": i.get("wp_if_convert"), "wpF": i.get("wp_if_fail"),
                      "fgp": i.get("fg_make_prob"), "wpM": i.get("wp_if_fg_made"), "wpX": i.get("wp_if_fg_missed"),
                      "fgDist": int(c["yardline_100"] + 17)}
            if inputs["fgp"] is None or c["yardline_100"] + 17 > 66:
                opts.pop("fg", None)
            model = "nfl4th"
        else:
            continue
        kind = "4th"
    elif c["category"] == "two_point" and n4.get("kick_route_wp") is not None:
        opts = {"kick": n4["kick_route_wp"], "two": n4["two_point_route_wp"]}
        i = n4["inputs"]
        inputs = {"xp": i["xp_prob"], "two": i["two_point_prob"], "wp0": i["wp_if_0"], "wp1": i["wp_if_1"], "wp2": i["wp_if_2"]}
        model, kind = "nfl4th", "pat"
    elif c["id"] == "belichick-sb46-let-them-score":
        # Defense: you are New England, the Giants have the ball.
        pos, deff = "NE", "NYG"
        opts, inputs, model, kind = {"let": 15.0, "defend": 6.0}, {}, "anfl", "let"
    else:
        continue
    did = {"fg made": "fg", "punted": "punt"}
    s = base(gid, pid, season, c["season_type"], c["week"], c["game_date"], pos, deff, c["qtr"], c["time"],
             c["posteam_score"] if kind != "let" else c["defteam_score"], c["defteam_score"] if kind != "let" else c["posteam_score"],
             c["posteam_timeouts_remaining"] if kind != "let" else c["defteam_timeouts_remaining"],
             c["defteam_timeouts_remaining"] if kind != "let" else c["posteam_timeouts_remaining"],
             c["yardline_100"] if c["yardline_100"] is not None else 2, kind)
    s["id"] = "famous-" + c["id"]
    s.update({"famous": {"title": c["title"], "decider": c["decider"], "did": c["what_they_did"],
                         "verdicts": c["published_verdicts"]},
              "opts": opts, "best": max(opts, key=opts.get), "inputs": inputs, "model": model})
    s["diff"] = difficulty(opts)[0]
    if kind == "4th":
        s.update({"down": 4, "ytg": int(c["ydstogo"]), "g2g": c["yardline_100"] <= c["ydstogo"]})
        s["coaches"] = coach_rates(c["ydstogo"], c["yardline_100"], c["qtr"], c["posteam_score"] - c["defteam_score"])
    if kind == "let":
        s.update({"down": int(c["down"]), "ytg": int(c["ydstogo"]), "ball": "opp", "yl": int(c["yardline_100"])})
    if c["id"] == "harbaugh-2pt-at-pit":
        s["disputed"] = {"note": "The NFL's Next Gen Stats model favored kicking by 7.6 points; nfl4th favors going for two by about 3. When good models split, both calls get full credit."}
    if c["id"] == "shanahan-sb58-ot-fg":
        s["rules"] = "Postseason overtime: both teams get a possession; a field goal here means Kansas City gets the ball back."
    fam_out.append(s)

def prune(o):
    if isinstance(o, dict):
        return {k: prune(v) for k, v in o.items() if v is not None and not (isinstance(v, float) and np.isnan(v))}
    if isinstance(o, list):
        return [prune(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return o


scen = prune(scen)
fam_out = prune(fam_out)

coaches = json.load(open(f"{OUT}/coach_profiles.json"))
data = {"built": "2026-10-16", "teams": TEAMS, "scenarios": scen, "famous": fam_out, "coaches": coaches,
        "bonus": {
            "short": {"q": "Fourth-and-1. Pick the play.", "opts": {"sneak": 80.8, "run": 67.8, "pass": 58.6},
                      "labels": {"sneak": "QB sneak", "run": "Handoff", "pass": "Pass"},
                      "src": "NFL 4th-and-1 conversion rates, 2018-26 (sneaks approximate)"},
            "goal": {"q": "Goal line, ball at the 1. Pick the play.", "opts": {"sneak": 64.5, "run": 54.9, "pass": 49.9},
                     "labels": {"sneak": "QB sneak", "run": "Handoff", "pass": "Pass"},
                     "src": "NFL touchdown rate on 1st-3rd and goal from the 1, 2018-26"},
            "two": {"q": "Going for two. Run or pass?", "opts": {"run": 56.7, "pass": 45.2},
                    "labels": {"run": "Run it", "pass": "Throw it"},
                    "src": "NFL two-point conversion rates, 2021-26 (teams pass 73% of the time)"}}}
js = "/* Win Probability scenario bank. Generated by build_bank.py from the data package; don't edit by hand. */\n"
js += "window.WP_DATA=" + json.dumps(data, separators=(",", ":"), default=lambda o: None if pd.isna(o) else str(o)) + ";\n"
open(DEST, "w").write(js)
print("4th:", sum(s["kind"] == "4th" for s in scen), "pat:", sum(s["kind"] == "pat" for s in scen), "famous:", len(fam_out),
      "bytes:", len(js))
print(pd.Series([s["best"] for s in scen]).value_counts().to_dict(), pd.Series([s["diff"] for s in scen]).value_counts().to_dict())
