#!/usr/bin/env python3
"""Player values for the Wipe Yoenis trade history and waiver wire (tools/yoenis_trades_build.py,
tools/yoenis_history_build.py).

All values are the awards' 16-category model (tools/yoenis_keeper_value.py), counted above replacement:
the 208th hitter or 160th pitcher, so a hurt or benched player counts zero, not less.

  vor_table(year)         {(folded name, 'b'|'p'): full-season value over replacement}
  window_value(year, totals, side, share)
                          value over replacement of the real stats a player put up in one tenure window
                          (totals from tools/yahoo_yoenis/slices), share = the window's part of the season
  pick_curve()            {round: what an average non-keeper pick in that round was worth in its first
                          season}, from every draft whose keepers are known (2017 on) plus 2013 (no keepers
                          yet), smoothed so a later round is never worth more than an earlier one
  slot_curve()            the same by how many players had actually been drafted before the pick: every
                          keeper (about 80) is off the board before the first pick, and keepers fill some
                          early slots, so No. 16 overall is usually only the 11th player drafted. Keeper years
                          only (2017 on); 2013, with no keepers, isn't the same draft.
  option_curve()          {round: the keeper value a drafted player went on to add}: for picks in the 2017 to
                          2022 drafts (their whole keeper clock has played out), each later season someone kept
                          him, his value over his keeper round's, averaged over every pick (about 0.6; by round
                          it's noise). A pick is worth its first season plus this.
  pick_value(year, round, owner)
                          a traded pick: its slot's first-season value (from that year's draft order, when the
                          draft has happened) plus the keeper value picks in that round go on to add
  keeper_cost(round)      what keeping someone in a round gives up: that round's pick, first season and
                          keeper value both
  kept_surplus(year, owner, name, pos, kept)
                          what keeping him was worth after the season he arrived: each later season the
                          same manager kept him, his value less what that keeper round was expected to
                          produce (never below zero: keeping him was a choice, not a cost of the trade).
                          Seasons whose keepers aren't set yet (next spring's) are projected instead: what he'd
                          be worth in a redraft (a weighted average of his last three seasons) over what his
                          keeper round is expected to produce, for each year he has left on the keeper clock,
                          if he'd be one of that team's five best keepers. Returns (value, seasons, projected).
"""
import json
from pathlib import Path

from yoenis_keeper_value import season_model, season_values, POOL_B, POOL_P
from yoenis_tenure import pkey
from yoenis_yahoo_keepers import fold, side

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "yoenis" / "data.json"
_vor, _model, _repl = {}, {}, {}


def _load(year):
    if year in _vor:
        return
    try:
        sv = season_values(year)
    except FileNotFoundError:
        _vor[year], _repl[year] = {}, {"b": 0, "p": 0}
        return
    repl, out = {}, {}
    for sd, pool in (("b", POOL_B), ("p", POOL_P)):
        vals = sorted((r["v"] for k, r in sv.items() if k[1] == sd), reverse=True)
        repl[sd] = vals[pool - 1] if len(vals) >= pool else (vals[-1] if vals else 0)
        for k, r in sv.items():
            if k[1] == sd:
                out[k] = max(r["v"] - repl[sd], 0.0)
    _vor[year], _repl[year] = out, repl
    _model[year] = season_model(year)[:2]


def vor_table(year):
    _load(year)
    return _vor[year]


def window_value(year, t, sd, share):
    """t: a window's totals; sd: 'b' or 'p'; share: the window's part of the season (0 to 1)."""
    _load(year)
    if year not in _model or share <= 0:
        return 0.0
    vb, vp = _model[year]
    if sd == "b":
        ab, pa = t.get("ab", 0), t.get("pa", 0)
        obp_d = ab + t.get("bb", 0) + t.get("hbp", 0) + t.get("sf", 0)
        row = {k: t.get(k, 0) for k in ("r", "h", "hr", "rbi", "sb", "tb")}
        row.update(pa=pa, ab=ab, avg=(t.get("h", 0) / ab) if ab else 0,
                   ops=((t.get("h", 0) + t.get("bb", 0) + t.get("hbp", 0)) / obp_d if obp_d else 0) + (t.get("tb", 0) / ab if ab else 0))
        v = vb(row, share)
    else:
        outs = t.get("outs", 0)
        inn = outs / 3
        row = {k: t.get(k, 0) for k in ("w", "l", "sv", "k", "hld", "qs")}
        row.update(ip=outs // 3 + (outs % 3) / 10, era=(9 * t.get("er", 0) / inn) if inn else None,
                   whip=((t.get("bb", 0) + t.get("h", 0)) / inn) if inn else None)
        v = vp(row, share)
    return max(v - _repl[year][sd] * share, 0.0)


_curve = {}


def pick_curve():
    if _curve:
        return _curve
    data = json.loads(DATA.read_text(encoding="utf-8"))
    by = {}
    for s in data["seasons"]:
        if not s.get("keepers_known") and s["year"] != 2013:
            continue
        vt = vor_table(s["year"])
        for e in s["draft"]:
            if len(e) > 3 and e[3]:
                continue
            f, sd = fold(e[2]), side(e[2])
            v = vt.get((f, sd)) if sd else max(vt.get((f, "b"), 0), vt.get((f, "p"), 0))
            by.setdefault(e[0], []).append(v or 0.0)
    # Pool adjacent violators: a weighted, never-rising fit of the round averages
    blocks = []
    for r in sorted(by):
        blocks.append([sum(by[r]) / len(by[r]), len(by[r]), [r]])
        while len(blocks) > 1 and blocks[-2][0] < blocks[-1][0]:
            b = blocks.pop()
            a = blocks[-1]
            a[0] = (a[0] * a[1] + b[0] * b[1]) / (a[1] + b[1])
            a[1] += b[1]
            a[2] += b[2]
    for mean, _, rounds in blocks:
        for r in rounds:
            _curve[r] = round(mean, 2)
    return _curve


def expected(round_):
    c = pick_curve()
    return c.get(round_, c[max(c)] if round_ > max(c) else c[min(c)])


def _iso(pairs):
    """Weighted, never-rising fit of [(x, mean, n)] sorted by x"""
    blocks = []
    for x, m, n in pairs:
        blocks.append([m, n, [x]])
        while len(blocks) > 1 and blocks[-2][0] < blocks[-1][0]:
            b = blocks.pop()
            a = blocks[-1]
            a[0] = (a[0] * a[1] + b[0] * b[1]) / (a[1] + b[1])
            a[1] += b[1]
            a[2] += b[2]
    return {x: m for m, _, xs in blocks for x in xs}


def _seasons():
    if "s" not in _cache2:
        _cache2["s"] = json.loads(DATA.read_text(encoding="utf-8"))
    return _cache2["s"]


_cache2 = {}


def _vor_named(year, name):
    f, sd = fold(name), side(name)
    t = vor_table(year)
    return t.get((f, sd), 0.0) if sd else max(t.get((f, "b"), 0.0), t.get((f, "p"), 0.0))


def slot_curve():
    """{nth player drafted (keepers not counted): first-season value}, never rising, from the keeper-era drafts"""
    if "slot" in _cache2:
        return _cache2["slot"]
    by = {}
    for s in _seasons()["seasons"]:
        if not s.get("keepers_known"):
            continue
        n = 0
        for e in s["draft"]:
            if len(e) > 3 and e[3]:
                continue
            n += 1
            by.setdefault(n, []).append(_vor_named(s["year"], e[2]))
    # pool neighbors four picks at a time before fitting: one draft's luck shouldn't set a slot
    pooled = []
    for p in sorted(by):
        lo = max(1, p - 2)
        vals = [v for q in range(lo, lo + 5) for v in by.get(q, [])]
        pooled.append((p, sum(vals) / len(vals), len(by[p])))
    _cache2["slot"] = {p: round(v, 2) for p, v in _iso(pooled).items()}
    return _cache2["slot"]


OPTION_YEARS = range(2017, 2023)  # drafts whose players' keeper clocks have fully played out


def option_curve():
    """{round: average keeper value a non-keeper pick went on to add} (the same for every round)"""
    if "opt" in _cache2:
        return _cache2["opt"]
    data = _seasons()
    kept = kept_map(data)
    seasons = {s["year"]: s for s in data["seasons"]}
    by = {}
    for y in OPTION_YEARS:
        for e in seasons[y]["draft"]:
            if len(e) > 3 and e[3]:
                continue
            tag = fold(e[2]) + ":" + side(e[2])
            v, yy = 0.0, y + 1
            while True:
                kr = next((d[tag] for d in kept.get(yy, {}).values() if tag in d), None)
                if kr is None and tag not in [t for d in kept.get(yy, {}).values() for t in d]:
                    break
                v += max(_vor_named(yy, e[2]) - expected(kr or 15), 0.0)
                yy += 1
            by.setdefault(e[0], []).append(v)
    # Round by round it's noise (a few late-round hits), with no clear shape, so one league-wide figure
    vals = [v for vs in by.values() for v in vs]
    flat = round(sum(vals) / len(vals), 2)
    out = {r: flat for r in by}
    _cache2["opt"] = out
    return out


def option(round_):
    c = option_curve()
    return c.get(round_, c[max(c)] if round_ > max(c) else c[min(c)])


def keeper_cost(round_):
    return expected(round_) + option(round_)


def draft_slot(year, owner):
    """Where `owner` picked in `year`'s first round (0-based), read off the board like the trade finder does:
    the team that used each slot most often across the 25 rounds of the snake. None if that draft hasn't happened."""
    s = next((x for x in _seasons()["seasons"] if x["year"] == year), None)
    if not s or not s.get("draft") or year < 2016:  # 2013 to 2015 boards aren't a clean snake
        return None, 0
    import collections
    by = collections.defaultdict(list)
    for e in s["draft"]:
        by[e[0]].append(e)
    n = len(by[1])
    slot = collections.defaultdict(collections.Counter)
    for r, es in by.items():
        for i, e in enumerate(es):
            slot[i if r % 2 else n - 1 - i][e[1]] += 1
    for p, c in slot.items():
        ti = c.most_common(1)[0][0]
        if s["o"][ti] == owner:
            return p, n
    return None, n


def live_index(year, overall):
    """How many players were drafted (keepers not counted) up to and including slot `overall` in `year`:
    the pick at that slot is that many-th player drafted. If the slot held a keeper, the next player drafted."""
    s = next((x for x in _seasons()["seasons"] if x["year"] == year), None)
    if not s or not s.get("keepers_known") or overall > len(s["draft"]):
        return None
    return sum(1 for e in s["draft"][:overall - 1] if not (len(e) > 3 and e[3])) + 1


def pick_value(year, round_, owner=None):
    """(value, overall pick or None, nth player drafted or None) for a traded pick in `year`'s draft that
    originally belonged to `owner`"""
    p, n = draft_slot(year, owner) if owner else (None, 0)
    if p is None:
        return round(expected(round_) + option(round_), 2), None, None
    overall = (round_ - 1) * n + (p + 1 if round_ % 2 else n - p)
    nth = live_index(year, overall)
    sc = slot_curve()
    first = sc.get(nth, expected(round_)) if nth else expected(round_)
    return round(first + option(round_), 2), overall, nth


def kept_map(data):
    """{year: {owner: {folded name:side: keeper round}}}"""
    seasons = {s["year"]: s for s in data["seasons"]}
    out = {}
    for y, rows in data["keeperHistory"].items():
        s = seasons.get(int(y))
        for ti, ks in (rows if s else []):
            d = out.setdefault(int(y), {}).setdefault(s["o"][ti], {})
            for k in ks:
                d[fold(k[0]) + ":" + side(k[0])] = k[1]
    return out


MARCEL = (5, 4, 3)  # weights for the last three seasons, newest first
FADE = 0.85         # each further projected season counts a little less: more can go wrong
KEEPERS = 5


def redraft(year, pk):
    """What he'd be worth in a redraft before `year`: his last three seasons, newest weighted most. A season
    he didn't play is skipped, but if that's the latest one he's marked down a fifth (hurt, or not up yet)."""
    num = den = 0.0
    for w, y in zip(MARCEL, range(year - 1, year - 4, -1)):
        t = vor_table(y)
        if pk in t:
            num += w * t[pk]
            den += w
    if not den:
        return 0.0
    v = num / den
    return v * 0.8 if pk not in vor_table(year - 1) else v


_proj = {}


def _projections(year):
    """{(owner, tag): (value, seasons)} for next spring's keepers, from data['keepers2027'] (the final rosters,
    each player's next keeper round and the rounds after it), counting only each team's five best."""
    if year in _proj:
        return _proj[year]
    data = json.loads(DATA.read_text(encoding="utf-8"))
    last = data["seasons"][-1]
    out = {}
    if last["year"] + 1 == year:
        owner_of = {t: last["o"][i] for i, t in enumerate(last["teams"])}
        for team, rows in (data.get("keepers2027") or {}).items():
            owner = owner_of.get(team)
            cands = []
            for e in rows:
                if not e.get("next"):
                    continue  # can't be kept
                nm = e["p"]
                sd = side(nm) or ("b" if (fold(nm), "b") in vor_table(year - 1) else "p" if (fold(nm), "p") in vor_table(year - 1) else "b")
                pk = (fold(nm), sd)
                base = redraft(year, pk)
                path, at = e.get("path") or [e["next"][0]], e["next"][1]
                rounds = path[at - 1:] or [e["next"][0]]
                vals = [max(base * FADE ** i - keeper_cost(r), 0.0) for i, r in enumerate(rounds)]
                used = [r for r, v in zip(rounds, vals) if v > 0]
                cands.append((vals[0], sum(vals), len(used), fold(nm) + ":" + side(nm), used))
            for first, total, n, tag, used in sorted(cands, reverse=True)[:KEEPERS]:
                if first > 0:
                    out[(owner, tag)] = (total, n, used)
    _proj[year] = out
    return out


def kept_surplus(year, owner, name, pos, kept):
    """(surplus, seasons, projected seasons, [[year, keeper round, 1 if projected], ...]) for the seasons after `year` that `owner` kept him, back to back,
    then, if the run reaches a spring whose keepers aren't set yet, his projected keeper value from there."""
    pk = pkey(name, pos)
    tag = pk[0] + ":" + side(name)
    total, n, y, rounds = 0.0, 0, year + 1, []
    while tag in kept.get(y, {}).get(owner, {}):
        rnd = kept[y][owner][tag]
        total += max(vor_table(y).get(pk, 0.0) - keeper_cost(rnd or 15), 0.0)
        rounds.append([y, rnd or 15])
        n += 1
        y += 1
    if y not in kept:  # next spring: not kept yet, so project it
        v, m, rr = _projections(y).get((owner, tag), (0.0, 0, []))
        return total + v, n + m, m, rounds + [[y + i, r, 1] for i, r in enumerate(rr)]
    return total, n, 0, rounds
