#!/usr/bin/env python3
"""Build the Wipe Yoenis trade history for yoenis/data.json from tools/yahoo_yoenis/trades.json.

Who won each trade, with the awards' 16-category player values counted above replacement (the 208th hitter
or 160th pitcher), so a hurt or benched player counts zero, not less (tools/yoenis_value.py):
  - That season: what he actually did for the team that got him, from the day after the trade until he was
    dropped or traded again, or the season ended (his MLB game logs, totaled in tools/yahoo_yoenis/slices).
  - Kept after: if he was still there at season's end, each later season that manager kept him counts his
    value less what that keeper round was expected to produce (an average non-keeper pick in that round
    over 14 drafts), never below zero.
  - Draft picks that changed hands count what the nth player drafted was worth his first season (keepers don't
    count: they're all off the board before the first pick, and they fill some early slots, so No. 16 is often
    the 11th player drafted), read from that year's draft once it's happened (otherwise the round's average),
    plus the keeper value a drafted
    player goes on to add on average. Keeping someone costs the same: that round's pick.
Offseason trades (keepers and picks swapped on the league thread, tools/yoenis_offseason_trades.py) count
the same way from Opening Day, except the first season is his value over the keeper round the new team
spent on him (he came over to be kept), and a player the new team didn't keep counts zero.
Vetoed trades are left out. If a season's game logs haven't been pulled yet, its trades fall back to his
full-season value prorated by the days left, and are marked "est".

Writes data["tradeHistory"] = {
  "trades": [{"y": year, "d": "YYYY-MM-DD", "a": team index, "b": team index,
              "ag": [[player, that season, kept after, seasons kept, projected seasons,
                      [[year, keeper round, 1 if projected], ...]], ...], "bg": [...],
              "ap": [[pick label, value], ...], "bp": [...], "av": side a total, "bv": side b total,
              "est": true when prorated, "off": "sheet"|"board" for offseason trades}, ...],   newest first
  "vetoed": number of trades left out, "curve": {round: expected value}
}
  python3 tools/yoenis_trades_build.py
"""
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from yoenis_tenure import windows, key, pkey, day  # noqa: E402,F401
from yoenis_value import vor_table, window_value, pick_curve, expected, kept_map, kept_surplus, keeper_cost, pick_value, option, _vor_named, KEEPERS, keepers_resolved  # noqa: E402,F401
from yoenis_yahoo_keepers import fold  # noqa: E402
from yoenis_offseason_trades import trades as _offseason  # noqa: E402
from yoenis_yahoo_keepers import side as side_of  # noqa: E402

_off = []


def offseason_trades(data):
    if not _off:
        _off.extend(_offseason(data))
    return _off

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "yoenis" / "data.json"
TRADES = ROOT / "tools" / "yahoo_yoenis" / "trades.json"
SLICES = ROOT / "tools" / "yahoo_yoenis" / "slices"
ORD = {1: "1st", 2: "2nd", 3: "3rd"}


def ordinal(n):
    return f"{n}th" if 10 < n % 100 < 14 else f"{n}{ORD.get(n % 10, 'th')[-2:]}"


def slot_label(overall, nth):
    """' (No. 16, 11th drafted)': the overall slot, and how many players had actually been drafted by then"""
    if not overall:
        return ""
    return f" (No. {overall}" + (f", {ordinal(nth)} drafted" if nth and nth != overall else "") + ")"


def slices(year):
    p = SLICES / f"{year}.json"
    if not p.exists():
        return None
    d = json.loads(p.read_text(encoding="utf-8"))
    # Windows the pull saw but couldn't match to an MLB player never played that year: zero, not unknown
    return {**{k: {} for k in d.get("keys", [])}, **d["s"]}


def window_now(year, w, sl, season_days):
    """(value that season, estimated?) for one tenure window"""
    days = (w["end"] - w["start"]).days + 1
    if days <= 0:
        return 0.0, False
    share = days / season_days
    k = key(w)
    if sl is not None and k in sl:
        t = sl[k]
        return (window_value(year, t, w["pk"][1], share) if t else 0.0), False
    return vor_table(year).get(w["pk"], 0.0) * share, True  # not pulled yet: prorate his season


def guess_pos(year, name):
    """'SP' if he only shows up as a pitcher in the values around that year, else None (a hitter)"""
    f = fold(name)
    for y in (year, year - 1, year + 1):
        t = vor_table(y)
        if (f, "p") in t and (f, "b") not in t:
            return "SP"
        if (f, "b") in t:
            return None
    return None


def keeper_values(data, year, owner, kept):
    """What each of `owner`'s actual keepers that spring was worth to him: his season over his keeper round's
    cost, plus every later season he kept him, never below zero"""
    s = next(x for x in data["seasons"] if x["year"] == year)
    out = []
    for ti, name, rnd in keepers_resolved(data, year):
        if s["o"][ti] != owner:
            continue
        first = max(_vor_named(year, name, ti) - keeper_cost(rnd or 15), 0.0)
        later = kept_surplus(year, owner, name, guess_pos(year, name), kept)[0]
        out.append(first + later)
    return out


def crunch(keepers, sent):
    """The share of what a team traded away in the winter that it actually gave up: keeping those players
    would only have bumped its weakest keepers, so the cost is its best five out of keepers plus traded
    players, less its actual best five, over the traded players' value"""
    total = sum(sent)
    if total <= 0:
        return 1.0
    top = lambda vs: sum(sorted(vs, reverse=True)[:KEEPERS])  # noqa: E731
    return max(0.0, min(1.0, (top(keepers + sent) - top(keepers)) / total))


def offseason_rows(data, seasons, kept):
    """Score every offseason trade: the season he arrived over his keeper round, then later kept seasons"""
    rows = []
    hist = ROOT / "tools" / "yahoo_yoenis" / "history"
    for year in sorted({t["y"] for t in offseason_trades(data)}):
        s = seasons[year]
        h = json.loads((hist / f"{year}.json").read_text(encoding="utf-8"))
        start, end = date.fromisoformat(h["start"]), date.fromisoformat(h["end"])
        season_days = (end - start).days + 1
        sl = slices(year)
        wins = {}
        for w in windows(year):
            if w["kind"] == "off":
                wins.setdefault((w["ref"], w["team"]), []).append(w)
        names = {v: k for k, v in h["teams"].items()}
        for i, t in enumerate([t for t in offseason_trades(data) if t["y"] == year]):
            if t.get("summer"):
                continue  # scored with the summer trade it came from
            sides, est = {}, False
            for side in ("a", "b"):
                owner = t[side]
                ti = s["o"].index(owner)
                got = []
                for w in wins.get((i, names.get(s["teams"][ti])), []):
                    tag = w["pk"][0] + ":" + side_of(w["name"])
                    rnd = kept.get(year, {}).get(owner, {}).get(tag)
                    if rnd is None:  # not kept: he never played for them
                        got.append([w["name"], 0.0, 0.0, 0])
                        continue
                    now, e = window_now(year, w, sl, season_days)
                    est = est or e
                    now = max(now - keeper_cost(rnd), 0.0)
                    later, n, pr, rr = kept_surplus(year, owner, w["name"], w["pos"], kept) if w["stays"] else (0.0, 0, 0, [])
                    got.append([w["name"], round(now, 1), round(later, 1), n, pr, [[year, rnd]] + rr])
                giver = t["b" if side == "a" else "a"]
                picks = []
                for r in t["ap" if side == "a" else "bp"]:
                    v, overall, nth = pick_value(year, r, giver)
                    picks.append([f"{ordinal(r)}-round pick" + slot_label(overall, nth), v])
                sides[side] = (ti, got, picks)
            tot = lambda k: round(sum(x[1] + x[2] for x in sides[k][1]) + sum(x[1] for x in sides[k][2]), 1)  # noqa: E731
            row = {"y": year, "d": t["d"], "a": sides["a"][0], "b": sides["b"][0],
                   "ag": sides["a"][1], "bg": sides["b"][1], "ap": sides["a"][2], "bp": sides["b"][2],
                   "av": tot("a"), "bv": tot("b"), "off": t["src"]}
            # Keeper crunch: what each side's traded players would have been worth to it, given its other keepers
            for side, other in (("a", "b"), ("b", "a")):
                sent = [g[1] + g[2] for g in sides[other][1]]
                if sum(sent) > 0:
                    k = crunch(keeper_values(data, year, t[side], kept), sent)
                    if k < 0.995:
                        row["k" + side] = round(k, 2)
            if est:
                row["est"] = True
            rows.append(row)
    return rows


# Letter grades, from each side's share of the value as that side would count it
BANDS = [(0.80, "A+"), (0.72, "A"), (0.66, "A-"), (0.61, "B+"), (0.56, "B"), (0.53, "B-"), (0.50, "C+"),
         (0.47, "C"), (0.44, "C-"), (0.40, "D+"), (0.34, "D"), (0.30, "D-"), (0.0, "F")]
WEIGHT_MISSED, WEIGHT_PLAYOFFS, WEIGHT_TITLE = 0.5, 2.0, 2.5  # this season's value: missed playoffs / made them / won it all
DAMP = 3.0  # added to both sides before comparing, so a 3-to-0 deal is an edge, not a rout


def letter(share):
    return next(g for cut, g in BANDS if share >= cut)


def add_grades(rows, seasons):
    """Each side grades the trade by its own lights: value this season counts double for a team that made the
    playoffs that year (2.5x for the champion) and half for a team that missed them (it wasn't playing for
    this year); keeper value counts the same for everyone. So a contender
    that paid future value for a stretch run, and made it, can win the same trade as the team that got the
    future value: a win-win. Picks in an offseason deal are for that spring's draft, so they count now;
    picks in an in-season deal are for next year, so they count later. The share is damped (DAMP added to
    each side), so small deals land near a C and only big, one-sided ones reach an A+ or an F. In a winter
    deal, players a team sent away count only what keeping them would have added over its weakest keepers
    ("k" + side, from crunch()): a sixth keeper it had no room for costs it little."""
    for t in rows:
        s = seasons[t["y"]]
        finish = {r[1]: r[0] for r in s["standings"]}

        def split(side, k=1.0):
            """(this season, later) for what `side` got, its players scaled by k"""
            gets, picks = t[side + "g"], t[side + "p"]
            now = k * sum(g[1] for g in gets) + (sum(p[1] for p in picks) if t.get("off") else 0)
            later = k * sum(g[2] for g in gets) + (0 if t.get("off") else sum(p[1] for p in picks))
            return now, later

        parts = {"a": split("a"), "b": split("b")}
        for side, other in (("a", "b"), ("b", "a")):
            f = finish.get(t[side])
            w = WEIGHT_TITLE if f == 1 else WEIGHT_PLAYOFFS if f and f <= 8 else WEIGHT_MISSED
            cost = split(other, t.get("k" + side, 1.0))  # what it gave up: players it couldn't have kept anyway count less
            got = w * parts[side][0] + parts[side][1]
            gave = w * cost[0] + cost[1]
            t["g" + side] = letter((got + DAMP) / (got + gave + 2 * DAMP))
            t["w" + side] = w


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    pulled = json.loads(TRADES.read_text(encoding="utf-8"))
    seasons = {s["year"]: s for s in data["seasons"]}
    kept = kept_map(data)

    # Picks traded during the season (allowed through 2016) that only show up on next spring's board
    summer = {}
    for ot in offseason_trades(data):
        if ot.get("summer"):
            summer[(ot["y"] - 1, ot["summer"])] = ot

    out, vetoed = [], 0
    for ys, v in pulled.items():
        year = int(ys)
        s = seasons[year]
        idx = {k: s["teams"].index(n) for k, n in v["teams"].items() if n in s["teams"]}
        start, end = date.fromisoformat(v["start"]), date.fromisoformat(v["end"])
        season_days = (end - start).days + 1
        sl = slices(year)
        wins = {(w["ref"], w["team"], w["pk"]): w for w in windows(year) if w["kind"] == "trade"}
        for t in v["trades"]:
            if t["status"] != "successful":
                vetoed += 1
                continue
            a, b = t["a"], t["b"]
            if a not in idx or b not in idx:
                continue
            sides, est = {a: [], b: []}, False
            for p in t["players"]:
                to = p["to"]
                if to not in sides:
                    continue
                w = wins.get((t["id"], to, pkey(p["name"], p["pos"])))
                now, e = window_now(year, w, sl, season_days) if w else (0.0, False)
                est = est or e
                later, n, pr, rr = kept_surplus(year, s["o"][idx[to]], p["name"], p["pos"], kept) if (w and w["stays"]) else (0.0, 0, 0, [])
                sides[to].append([p["name"], round(now, 1), round(later, 1), n, pr, rr])
            picks = {a: [], b: []}
            for pk in t.get("picks") or []:
                if pk["to"] in picks:
                    ok = pk.get("orig") or pk["from"]
                    orig = v["teams"].get(ok, "")
                    owner = s["o"][idx[ok]] if ok in idx else None
                    val, overall, nth = pick_value(year + 1, pk["round"], owner)  # in-season deals trade next spring's picks
                    picks[pk["to"]].append([f"{orig}'s {year + 1} {ordinal(pk['round'])}".strip() + slot_label(overall, nth), val])
            ot = summer.get((year, t["id"]))
            if ot:  # next spring's picks that came with this trade
                owner = {s["o"][idx[a]]: a, s["o"][idx[b]]: b}
                for side_owner, rounds in ((ot["a"], ot["ap"]), (ot["b"], ot["bp"])):
                    giver = ot["b"] if side_owner == ot["a"] else ot["a"]
                    for r in rounds:
                        val, overall, nth = pick_value(year + 1, r, giver)
                        picks[owner[side_owner]].append([f"{year + 1} {ordinal(r)}-round pick" + slot_label(overall, nth), val])
            tot = lambda k: round(sum(x[1] + x[2] for x in sides[k]) + sum(x[1] for x in picks[k]), 1)  # noqa: E731
            row = {"y": year, "d": day(t["ts"]).isoformat(), "a": idx[a], "b": idx[b],
                   "ag": sides[a], "bg": sides[b], "ap": picks[a], "bp": picks[b], "av": tot(a), "bv": tot(b)}
            if est:
                row["est"] = True
            out.append(row)
    out.extend(offseason_rows(data, seasons, kept))
    add_grades(out, seasons)
    out.sort(key=lambda t: (t["d"] or f"{t['y']}-01-01", t["y"]), reverse=True)
    hist = {"trades": out, "vetoed": vetoed, "curve": pick_curve(), "option": option(1)}
    if data.get("tradeHistory") == hist:
        print("No change.")
        return
    data["tradeHistory"] = hist
    data["updated"] = date.today().isoformat()  # the page footer's "Updated" date
    DATA.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(out)} trades ({sum(1 for t in out if t.get('off'))} offseason, {vetoed} vetoed left out, "
          f"{sum(1 for t in out if t.get('est'))} estimated) to {DATA}.")


if __name__ == "__main__":
    main()
