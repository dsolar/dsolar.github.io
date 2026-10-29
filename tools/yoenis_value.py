#!/usr/bin/env python3
"""Player values for the Wipe Yoenis trade history and waiver wire (tools/yoenis_trades_build.py,
tools/yoenis_history_build.py).

All values are the awards' 16-category model (tools/yoenis_keeper_value.py), counted above replacement:
the 208th hitter or 160th pitcher, so a hurt or benched player counts zero, not less.

  vor_table(year)         {(folded name, 'b'|'p'): full-season value over replacement}
  window_value(year, totals, side, share)
                          value over replacement of the real stats a player put up in one tenure window
                          (totals from tools/yahoo_yoenis/slices), share = the window's part of the season
  pick_curve()            {round: what an average non-keeper pick in that round was worth}, from every
                          draft whose keepers are known (2017 on) plus 2013 (no keepers yet), smoothed so
                          a later round is never worth more than an earlier one
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
                vals = [max(base * FADE ** i - expected(r), 0.0) for i, r in enumerate(rounds)]
                cands.append((vals[0], sum(vals), len([v for v in vals if v > 0]), fold(nm) + ":" + side(nm)))
            for first, total, n, tag in sorted(cands, reverse=True)[:KEEPERS]:
                if first > 0:
                    out[(owner, tag)] = (total, n)
    _proj[year] = out
    return out


def kept_surplus(year, owner, name, pos, kept):
    """(surplus, seasons, projected seasons) for the seasons after `year` that `owner` kept him, back to back,
    then, if the run reaches a spring whose keepers aren't set yet, his projected keeper value from there."""
    pk = pkey(name, pos)
    tag = pk[0] + ":" + side(name)
    total, n, y = 0.0, 0, year + 1
    while tag in kept.get(y, {}).get(owner, {}):
        rnd = kept[y][owner][tag]
        total += max(vor_table(y).get(pk, 0.0) - expected(rnd or 15), 0.0)
        n += 1
        y += 1
    if y not in kept:  # next spring: not kept yet, so project it
        v, m = _projections(y).get((owner, tag), (0.0, 0))
        return total + v, n + m, m
    return total, n, 0
