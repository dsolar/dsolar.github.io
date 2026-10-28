#!/usr/bin/env python3
"""Add player projections, results, byes and lineup math to guillotine/data.json.

Source: Sleeper's public projections and stats feeds (no sign-in), rescored with the Bastille Day
settings: half PPR, 4-point passing TDs, 25 passing yards / 10 rushing or receiving yards per
point, -1 per interception, -2 per fumble lost, 2 per two-point conversion.

Every rostered player gets:
  proj       projected league points this week (0 on a bye)
  rank       projected position rank this week, like "WR12"
  actual     league points scored, once that player's game is final
  next_proj  projected points next week (0 if on bye next week)
  bye_next   true if his team is off next week
  in_best    part of the team's best lineup this week
  season     weeks 1 to last week: games played, league points each week, and season totals
             (passing, rushing, receiving), for the stat card that opens on a player's name
Past weeks' lineups in history.json (the recap and bench check) get any points still missing.
waivers: last week's cut team's players (on waivers now), with projections and who claimed them.
Every team still alive gets:
  best       points its best lineup projects to this week
  best_next  the same for next week, byes included
  locked     points already banked by its starters whose games are final
  locked_proj  what those starters had been projected for
The page uses best when a team has no lineup set, and shifts each projection by
(locked - locked_proj) as games finish.

  python tools/guillotine_projections.py                pull from Sleeper
  python tools/guillotine_projections.py --from DIR     use saved responses (proj_W.json, proj_W1.json, stats_W.json)
"""
import argparse
import json
import os
import re
import unicodedata
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "guillotine", "data.json")
HIST = os.path.join(HERE, "..", "guillotine", "history.json")
POS_Q = "&position%5B%5D=QB&position%5B%5D=RB&position%5B%5D=WR&position%5B%5D=TE"
URLS = {
    "proj": "https://api.sleeper.com/projections/nfl/{season}/{week}?season_type=regular" + POS_Q,
    "stats": "https://api.sleeper.com/stats/nfl/{season}/{week}?season_type=regular" + POS_Q,
}
UA = "davidsolar-guillotine/1.0 (+https://davidsolar.dev/guillotine/)"
ET = ZoneInfo("America/New_York")

SCORING = {
    "pass_yd": 0.04, "pass_td": 4, "pass_int": -1, "pass_2pt": 2,
    "rush_yd": 0.1, "rush_td": 6, "rush_2pt": 2,
    "rec": 0.5, "rec_yd": 0.1, "rec_td": 6, "rec_2pt": 2,
    "fum_lost": -2,
}
ELIGIBLE = {
    "QB": {"QB"}, "RB": {"RB"}, "WR": {"WR"}, "TE": {"TE"}, "K": {"K"}, "DEF": {"DEF"},
    "W/R": {"WR", "RB"}, "W/T": {"WR", "TE"}, "W/R/T": {"WR", "RB", "TE"},
    "Q/W/R/T": {"QB", "WR", "RB", "TE"},
}
UNAVAILABLE = {"O", "IR", "IR-R", "PUP", "PUP-R", "NA", "SUSP"}


def norm(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[.'’`-]", "", s)
    return " ".join(w for w in s.split() if w not in {"jr", "sr", "ii", "iii", "iv", "v"})


def league_points(stats):
    if any(k in stats for k in SCORING):
        return round(sum((stats.get(k) or 0) * v for k, v in SCORING.items()), 2)
    v = stats.get("pts_half_ppr")
    return round(v, 2) if isinstance(v, (int, float)) else 0.0


def load(kind, season, week, from_dir):
    if from_dir:
        fp = os.path.join(from_dir, f"{kind}_{week}.json")
        if not os.path.exists(fp):
            return []
        with open(fp, encoding="utf-8") as f:
            return json.load(f)
    req = urllib.request.Request(URLS[kind].format(season=season, week=week), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.load(res)


class Feed:
    """One week of Sleeper entries, indexed by player name, with position ranks and bye teams."""

    def __init__(self, entries, rank=False):
        self.by_name, by_pos, seen, playing = {}, {}, set(), set()
        for e in entries:
            p = e.get("player") or {}
            pos = p.get("position")
            if pos not in ("QB", "RB", "WR", "TE"):
                continue
            team = (e.get("team") or p.get("team") or "").upper()
            stats = e.get("stats") or {}
            if team:
                seen.add(team)
                if e.get("date"):
                    playing.add(team)
            row = {"pos": pos, "team": team, "pts": league_points(stats), "date": e.get("date"),
                   "played": bool(stats.get("gp"))}
            name = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
            self.by_name.setdefault(norm(name), []).append(row)
            by_pos.setdefault(pos, []).append(row)
        self.byes = seen - playing if playing else set()
        if rank:
            for pos, rows in by_pos.items():
                ranked = sorted((r for r in rows if r["pts"] > 0), key=lambda r: -r["pts"])
                for i, r in enumerate(ranked, 1):
                    r["rank"] = f"{pos}{i}"

    def find(self, p):
        cands = [c for c in self.by_name.get(norm(p["name"]), []) if c["pos"] == p["pos"]]
        if len(cands) > 1:
            cands = [c for c in cands if c["team"] == p["nfl"]] or cands
        return max(cands, key=lambda c: c["pts"]) if cands else None


SEASON_KEYS = ("pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td",
               "rec", "rec_tgt", "rec_yd", "rec_td", "fum_lost")


def season_lines(season, week, from_dir):
    """Every completed week's Sleeper stats, added up per player. None if no week loaded."""
    weeks = list(range(1, week))
    by, got = {}, 0
    for w in weeks:
        try:
            entries = load("stats", season, w, from_dir)
        except Exception as e:  # one missing week shouldn't sink the rest
            print(f"::warning::Couldn't load week {w} stats ({type(e).__name__}: {e}).")
            continue
        got += 1
        for e in entries or []:
            pl = e.get("player") or {}
            pos = pl.get("position")
            if pos not in ("QB", "RB", "WR", "TE"):
                continue
            stats = e.get("stats") or {}
            name = f"{pl.get('first_name', '')} {pl.get('last_name', '')}".strip()
            team = (e.get("team") or pl.get("team") or "").upper()
            pid = e.get("player_id") or name
            agg = by.setdefault((norm(name), pos), {}).setdefault(
                pid, {"team": team, "g": 0, "wk": [None] * len(weeks), "tot": {}})
            if team:
                agg["team"] = team
            if not stats.get("gp"):
                continue
            agg["g"] += 1
            agg["wk"][w - 1] = league_points(stats)
            for k in SEASON_KEYS:
                v = stats.get(k)
                if isinstance(v, (int, float)) and v:
                    agg["tot"][k] = agg["tot"].get(k, 0) + v
    return by if got else None


def season_for(lines, p):
    cands = list((lines.get((norm(p["name"]), p["pos"])) or {}).values())
    if not cands:
        return None
    same = [c for c in cands if c["team"] == p["nfl"]]
    a = max(same or cands, key=lambda c: c["g"])
    return {"g": a["g"], "wk": [round(x, 1) if isinstance(x, (int, float)) else None for x in a["wk"]],
            "tot": {k: round(v) for k, v in a["tot"].items()}}


def fill_past_weeks(week, lines, path=HIST):
    """Finish past weeks' box scores in history.json (weeks[W].lineups, saved by guillotine_snapshot.js).

    The final run of a week can land before its last games are scored. A team with one starter still
    unscored gets the exact remainder of its Yahoo score; anyone else gets his Sleeper line, rescored
    (0 if he didn't play). Returns how many players were filled in."""
    if not lines or not os.path.exists(path):
        return 0
    with open(path, encoding="utf-8") as f:
        hist = json.load(f)
    filled = 0
    for wk, w in (hist.get("weeks") or {}).items():
        wk = int(wk)
        if wk >= week or not w.get("lineups"):
            continue
        scores = w.get("scores") or {}
        for team, rows in w["lineups"].items():
            starters = [r for r in rows if r.get("slot") not in ("BN", "IR")]
            miss = [r for r in starters if r.get("pts") is None]
            if len(miss) == 1 and isinstance(scores.get(team), (int, float)):
                miss[0]["pts"] = round(scores[team] - sum(r["pts"] for r in starters if r is not miss[0]), 2)
                filled += 1
            for r in rows:
                if r.get("pts") is not None:
                    continue
                sl = season_for(lines, {"name": r["n"], "pos": r["pos"], "nfl": r.get("nfl", "")})
                if sl and len(sl["wk"]) >= wk:
                    v = sl["wk"][wk - 1]
                    r["pts"] = v if isinstance(v, (int, float)) else 0.0
                    filled += 1
    if filled:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(hist, f, ensure_ascii=False, indent=1)
            f.write("\n")
    return filled


def waiver_pool(data, week, now, nxt, lines, path=HIST):
    """Last week's cut team's players, now on waivers: this week's projection, next week's, the season
    average, who has claimed each so far (anyone back on a roster still alive), and the winning bid
    where the pasted transactions list it."""
    cut = next((t for t in data["teams"] if t.get("out") == week - 1), None)
    if not cut or not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        hist = json.load(f)
    rows = (((hist.get("weeks") or {}).get(str(week - 1)) or {}).get("lineups") or {}).get(cut["name"])
    if not rows:
        return None
    owner = {}
    for t in data["teams"]:
        if not t.get("out"):
            for p in t.get("roster") or []:
                if p.get("name"):
                    owner[(norm(p["name"]), p.get("pos"))] = t["name"]
    bids = {}
    for tx in data.get("transactions") or []:
        key = (norm(tx.get("player", "")), tx.get("pos"))
        if key not in bids and isinstance(tx.get("bid"), (int, float)):
            bids[key] = tx
    entry = (hist.get("weeks") or {}).get(str(week - 1)) or {}
    players = []
    for r in rows:
        q = {"name": r["n"], "pos": r["pos"], "nfl": r.get("nfl", "")}
        m = now.find(q)
        if m and m.get("team"):
            q["nfl"] = m["team"]
        q["proj"] = 0.0 if q["nfl"] in now.byes else (m["pts"] if m else None)
        if m and m.get("rank"):
            q["rank"] = m["rank"]
        n = nxt.find(q)
        q["next_proj"] = 0.0 if q["nfl"] in nxt.byes else (n["pts"] if n else None)
        sl = season_for(lines, q) if lines else None
        played = [x for x in (sl or {}).get("wk", []) if isinstance(x, (int, float))]
        if played:
            q["avg"], q["g"] = round(sum(played) / len(played), 1), len(played)
        if isinstance(r.get("pts"), (int, float)):
            q["last"] = r["pts"]
        who = owner.get((norm(r["n"]), r["pos"]))
        if who:
            q["claimed_by"] = who
        offer = estate_offer(r["n"], r["pos"], data.get("offers"), entry.get("taken"), cut["name"])
        if offer and (not who or norm(offer["team"]) == norm(who)):
            q["claimed_by"] = offer["team"]
            add_bids(q, offer)
        else:
            tx = bids.get((norm(r["n"]), r["pos"]))
            if tx and (not who or norm(tx.get("team", "")) == norm(who)):
                q["bid"] = tx["bid"]
        players.append(q)
    players.sort(key=lambda q: -(q.get("proj") or 0) - (q.get("next_proj") or 0))
    pool = {"team": cut["name"], "week": week - 1, "players": players}
    save_estates(hist, data, cut, pool, path)
    return pool


def estate_offer(name, pos, offers, after, cut_name):
    """The waiver claim that took this player off the cut team: the first one awarded to someone else
    after that week's odds were saved (that week's games came after, so its waiver run did too)."""
    key, best = norm(name), None
    for o in offers or []:
        if norm(o.get("player", "")) != key or (pos and o.get("pos") and o["pos"] != pos):
            continue
        if norm(o.get("team", "")) == norm(cut_name) or not o.get("run"):
            continue
        if after and o["run"] <= after[:10]:
            continue
        if best is None or o["run"] < best["run"]:
            best = o
    return best


def add_bids(q, offer):
    """Winning bid, the best losing bid that counted, and how many teams bid. A claim Yahoo voided
    ("invalid claim due to previous transaction") or the winner's own backup bid doesn't count."""
    q["bid"] = offer["bid"]
    losers = [b for b in offer.get("bids") or [] if b.get("why") != "invalid" and norm(b["team"]) != norm(offer["team"])]
    losers.sort(key=lambda b: -b["bid"])
    q["bids"] = [{"team": b["team"], "bid": b["bid"]} for b in losers]
    q["bidders"] = 1 + len({norm(b["team"]) for b in losers})
    if offer.get("run"):
        q["run"] = offer["run"]


def save_estates(hist, data, cut, pool, path):
    """Keep where each cut team's players went in history.json, so the wall of the fallen can show it
    after the waiver tab moves on. The latest cut is rewritten every run while claims come in; older
    cuts with no record yet are filled from the pasted Transactions page alone."""
    weeks, changed = hist.get("weeks") or {}, False
    def rec(players):
        out = []
        for p in players:
            row = {"n": p["name"], "pos": p["pos"], "nfl": p.get("nfl", "")}
            for k in ("claimed_by", "bid", "bids", "bidders", "next_proj"):
                if p.get(k) is not None:
                    row[k] = p[k]
            out.append(row)
        out.sort(key=lambda r: ((0, -r["bid"]) if isinstance(r.get("bid"), (int, float))
                                else (1 if r.get("claimed_by") else 2, 0), r["n"]))
        return out
    # from: "rosters" when every player's new team is known; "offers" when only the pasted bids are,
    # so a player without one may have been claimed at $0 or picked up later.
    latest = {"from": "rosters", "players": rec(pool["players"])}
    e = weeks.get(str(pool["week"]))
    if e is not None and e.get("estate") != latest:
        e["estate"] = latest
        changed = True
    for wk, e in weeks.items():
        if int(wk) >= pool["week"] or e.get("estate") or not e.get("cut_team") or not e.get("taken"):
            continue
        rows = (e.get("lineups") or {}).get(e["cut_team"]) or []
        found = []
        for r in rows:
            q = {"name": r["n"], "pos": r["pos"], "nfl": r.get("nfl", "")}
            o = estate_offer(r["n"], r["pos"], data.get("offers"), e["taken"], e["cut_team"])
            if o:
                q["claimed_by"] = o["team"]
                add_bids(q, o)
            found.append(q)
        if any(q.get("claimed_by") for q in found):
            e["estate"] = {"from": "offers", "players": rec(found)}
            changed = True
    if changed:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(hist, f, ensure_ascii=False, indent=1)
            f.write("\n")


def best_lineup(roster, key, flag=None, skip_bye_key=None):
    """Fill the most restrictive slots first; with nested flex slots this is optimal."""
    slots = [p["slot"] for p in roster if p["slot"] not in ("BN", "IR")]
    pool = [p for p in roster if not p.get("empty") and p["slot"] != "IR"
            and p.get("status") not in UNAVAILABLE and (p.get(key) or 0) > 0
            and not (skip_bye_key and p.get(skip_bye_key))]
    pool.sort(key=lambda p: -p[key])
    used, total = set(), 0.0
    for slot in sorted(slots, key=lambda s: len(ELIGIBLE.get(s, {s}))):
        ok = ELIGIBLE.get(slot, {slot})
        for p in pool:
            if id(p) not in used and p["pos"] in ok:
                used.add(id(p))
                if flag:
                    p[flag] = True
                total += p[key]
                break
    return round(total, 1)


def started(p, now=None):
    """True once a player's game has kicked off: final in Yahoo or the stats feed, or past its start time.

    A player sitting on the bench when his game kicks off can't be moved into the lineup any more."""
    if p.get("final") or p.get("yfinal") or p.get("live"):
        return True
    m = re.search(r"(\d{1,2}):(\d{2}) ([ap]m)", p.get("game") or "")
    if not p.get("date") or not m:
        return False
    hour = int(m.group(1)) % 12 + (12 if m.group(3) == "pm" else 0)
    kick = datetime.fromisoformat(p["date"]).replace(hour=hour, minute=int(m.group(2)), tzinfo=ET)
    return (now or datetime.now(timezone.utc)) >= kick


def fill_empty(team, now=None):
    """Put a stand-in in every empty starting spot, the way a manager would before kickoff.

    With some starters set, each empty spot gets the best healthy bench player who can play it; the team's
    projection grows by their points (t["fill"]). With no lineup at all, the whole best lineup stands in.
    Only players whose games haven't started count: once a bench player's game kicks off, his points
    can't reach the lineup. The empty spot records who's assumed ("assumed"); that player records the
    spot ("assumed_slot").
    """
    roster = team["roster"]
    empties = [p for p in roster if p.get("empty") and p["slot"] not in ("BN", "IR")]
    team.pop("fill", None)
    if not empties:
        return
    none_set = all(p.get("empty") for p in roster if p["slot"] not in ("BN", "IR"))
    if none_set:
        pool = [p for p in roster if p.get("in_best") and not started(p, now)]
    else:
        pool = [p for p in roster if p["slot"] == "BN" and not p.get("empty") and not p.get("bye")
                and p.get("status") not in UNAVAILABLE and (p.get("proj") or 0) > 0 and not started(p, now)]
    pool.sort(key=lambda p: -(p.get("proj") or 0))
    used, fill = set(), 0.0
    for slot in sorted(empties, key=lambda e: len(ELIGIBLE.get(e["slot"], {e["slot"]}))):
        ok = ELIGIBLE.get(slot["slot"], {slot["slot"]})
        pick = next((p for p in pool if id(p) not in used and p["pos"] in ok), None)
        if not pick:
            continue
        used.add(id(pick))
        slot["assumed"] = pick["name"]
        pick["assumed_slot"] = slot["slot"]
        fill += pick.get("proj") or 0
    if not none_set and fill:
        team["fill"] = round(fill, 2)


def reconcile_roster_only_scores(team):
    """A newer roster-only paste cannot use totals banked against an older lineup.

    Only finals already observed in the roster snapshot are included in the new base;
    later games remain outside that base so the live overlay can add them once.
    """
    starters = [p for p in team["roster"] if p["slot"] not in ("BN", "IR") and not p.get("empty")]
    if len(starters) != 9 or any("actual" not in p for p in starters if p.get("yfinal")):
        return False
    old = team.get("points") or 0
    team["points"] = round(sum(p["actual"] for p in starters if p.get("yfinal")), 2)
    # Yahoo's season total already counts the points it showed; move it with the new points, so season minus
    # points stays the total before this week (guillotine_snapshot.js works out weekly scores from that).
    if isinstance(team.get("season_pts"), (int, float)):
        team["season_pts"] = round(team["season_pts"] - old + team["points"], 2)
    team["proj"] = round(sum(p.get("actual", 0) if p.get("final") or p.get("yfinal") else p.get("proj", 0) for p in starters), 2)
    team["score_source"] = "Yahoo screenshot finals where supplied; otherwise NFL statistics scored with league settings"
    team["projection_source"] = "As-set lineup: final points plus remaining player projections"
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=DATA)
    ap.add_argument("--from", dest="from_dir")
    ap.add_argument("--today", help="pretend today is YYYY-MM-DD (ET), for testing")
    a = ap.parse_args()
    with open(a.data, encoding="utf-8") as f:
        data = json.load(f)
    teams = [t for t in data["teams"] if not t.get("out") and t.get("roster")]
    if not teams:
        print("No rosters in data.json yet; nothing to project.")
        return
    season, week = data["season"], data["week"]
    today = a.today or datetime.now(ET).strftime("%Y-%m-%d")
    clock = datetime.fromisoformat(a.today).replace(tzinfo=ET) if a.today else None  # --today replays that morning

    try:
        now = Feed(load("proj", season, week, a.from_dir), rank=True)
    except Exception as e:  # keep the pasted data even if Sleeper is down
        print(f"::warning::Couldn't load Sleeper projections ({type(e).__name__}: {e}). Page keeps its current numbers.")
        return
    try:
        nxt = Feed(load("proj", season, week + 1, a.from_dir))
    except Exception as e:
        print(f"::warning::Couldn't load next week's projections ({e}).")
        nxt = Feed([])
    try:
        res = Feed(load("stats", season, week, a.from_dir))
    except Exception as e:
        print(f"::warning::Couldn't load this week's stats ({e}).")
        res = Feed([])

    try:
        lines = season_lines(season, week, a.from_dir)
    except Exception as e:
        print(f"::warning::Couldn't build season stats ({type(e).__name__}: {e}).")
        lines = None
    if not a.from_dir:
        n = fill_past_weeks(week, lines)
        if n:
            print(f"Filled in {n} players' points in past weeks' lineups.")

    unmatched = []
    for t in teams:
        roster = t["roster"]
        for p in roster:
            for k in ("proj", "rank", "in_best", "actual", "next_proj", "bye_next", "date", "final", "assumed", "assumed_slot"):
                p.pop(k, None)
            if p.get("empty"):
                continue
            if lines is not None:  # keep the last season lines if this run couldn't get new ones
                p.pop("season", None)
                sl = season_for(lines, p)
                if sl:
                    p["season"] = sl
            m = now.find(p)
            if p.get("bye") or p["nfl"] in now.byes:
                p["proj"] = 0.0
            elif m:
                p["proj"] = m["pts"]
                if m.get("rank"):
                    p["rank"] = m["rank"]
                if m.get("date"):
                    p["date"] = m["date"]
            else:
                unmatched.append(f"{p['name']} ({p['pos']}, {p['nfl']})")
            # A game counts as final once its date has passed (Eastern time).
            if p.get("date") and p["date"] < today and res.by_name:
                p["final"] = True
                r = res.find(p)
                p["actual"] = r["pts"] if r and r["played"] else 0.0
            # Exact final Yahoo observations outrank a differently scored public stats feed.
            if isinstance(p.get("yahoo_proj"), (int, float)):
                p["proj"] = p["yahoo_proj"]
            if p.get("yfinal") and isinstance(p.get("yahoo_actual"), (int, float)):
                p["actual"] = p["yahoo_actual"]
                p["final"] = True
            n = nxt.find(p)
            if p["nfl"] in nxt.byes:
                p["bye_next"] = True
                p["next_proj"] = 0.0
            elif n:
                p["next_proj"] = n["pts"]

        if data.get("roster_only_import"):
            if not reconcile_roster_only_scores(t):
                raise ValueError("Cannot reconcile roster-only import: incomplete final scores for " + t["name"])
        t["best"] = best_lineup(roster, "proj", flag="in_best")
        t["best_next"] = best_lineup(roster, "next_proj") if nxt.by_name else None
        fill_empty(t, clock)

        # Points already banked by this week's starters, counting whoever stands in for an empty spot.
        starters = [p for p in roster if (p["slot"] not in ("BN", "IR") and not p.get("empty")) or p.get("assumed_slot")]
        done = [p for p in starters if p.get("final")]
        t["locked"] = round(sum(p.get("actual", 0) for p in done), 2)
        t["locked_proj"] = round(sum(p.get("proj") or 0 for p in done), 2)
        t["games_final"] = len(done)

    pool = waiver_pool(data, week, now, nxt, lines)
    if pool:
        data["waivers"] = pool
    else:
        data.pop("waivers", None)
    data["next_byes"] = sorted(nxt.byes)
    data["proj_source"] = {
        "name": "Sleeper",
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "players": sum(len(v) for v in now.by_name.values()),
        "unmatched": unmatched,
    }
    with open(a.data, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"Week {week}: byes {sorted(now.byes)}; next week byes {sorted(nxt.byes)}; {len(unmatched)} unmatched: "
          f"{', '.join(unmatched) or 'none'}")
    for t in teams:
        print(f"  {t['name']}: best {t['best']}, next week {t['best_next']}, locked {t['locked']} "
              f"of {t['locked_proj']} projected ({t['games_final']} final)")


if __name__ == "__main__":
    main()
