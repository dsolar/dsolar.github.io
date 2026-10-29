#!/usr/bin/env python3
"""Pull every Wipe Yoenis week and pickup since 2013 from Yahoo into tools/yahoo_yoenis/history/<year>.json.

Per season: the scoring categories, playoff start, every week's dates and matchups (each side's category
stats, its H/AB and IP, and Yahoo's category winners) and every add and drop with its date. Team and player names only.
Finished seasons never change, so they're pulled once; the latest season is pulled again each run.
Feeds tools/yoenis_history_build.py (16-0s, rivalries, the waiver wire hall of fame).

  python3 tools/yoenis_history_pull.py            missing seasons, plus the latest one
  python3 tools/yoenis_history_pull.py --all      every season again
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guillotine_update import Yahoo, access_token, text, num, Failure, NotApproved  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "yoenis", "data.json")
OUT = os.path.join(ROOT, "tools", "yahoo_yoenis", "history")


def val(s):
    if s in (None, "", "-"):
        return None
    try:
        return float(s)
    except ValueError:
        return s


def transactions(y, key):
    """Every transaction, a page at a time. Yahoo refuses some seasons' full list in one call (2023),
    so pages go 100 at a time, and a page Yahoo refuses is retried 25, then 5, then 1 at a time
    so one bad entry doesn't lose the rest."""
    out, start = [], 0
    while True:
        got = page(y, key, start, 100)
        out.extend(got)
        if len(got) < 100:
            return out
        start += 100


def page(y, key, start, count):
    root = y.get(f"league/{key}/transactions;start={start};count={count}", soft=True)
    if root is not None:
        return root.findall(".//transactions/transaction")
    if count == 1:
        print(f"::warning::Yahoo refused transaction {start} in {key}; skipped.")
        return [None]
    smaller = {100: 25, 25: 5, 5: 1}[count]
    out = []
    for s in range(start, start + count, smaller):
        got = page(y, key, s, smaller)
        out.extend(got)
        if len(got) < smaller:
            break
    return out


def season(y, year, lid):
    g = y.get(f"games;game_codes=mlb;seasons={year}", soft=True)
    gk = text(g.find(".//game"), "game_key") if g is not None and g.find(".//game") is not None else None
    if not gk:
        return None
    key = f"{gk}.l.{lid}"
    meta = y.get(f"league/{key}/metadata").find(".//league")
    sn = y.get(f"league/{key}/settings").find(".//settings")
    cats = []
    for st in sn.findall("stat_categories/stats/stat"):
        cats.append({"id": text(st, "stat_id"), "abbr": text(st, "display_name") or text(st, "abbr"),
                     "side": "b" if text(st, "position_type") == "B" else "p",
                     "low": text(st, "sort_order") == "0", "display": text(st, "is_only_display_stat") == "1"})
    scoring = [c["id"] for c in cats if not c["display"]]
    shown = {c["id"]: c["abbr"] for c in cats if c["display"]}  # H/AB and IP: not scored, but they size a week
    teams = {}
    for t in y.get(f"league/{key}/teams").findall(".//team"):
        teams[text(t, "team_key")] = text(t, "name")
    start_w, end_w = int(num(meta, "start_week") or 1), int(num(meta, "end_week") or 1)
    if text(meta, "is_finished") != "1":
        end_w = int(num(meta, "current_week") or end_w)
    weeks = []
    for w in range(start_w, end_w + 1):
        sb = y.get(f"league/{key}/scoreboard;week={w}", soft=True)
        if sb is None:
            continue
        mus, ws, we = [], None, None
        for mu in sb.findall(".//matchups/matchup"):
            ws, we = ws or text(mu, "week_start"), we or text(mu, "week_end")
            tks, stats, extra = [], {}, {}
            for t in mu.findall("teams/team"):
                tk = text(t, "team_key")
                tks.append(tk)
                m = {text(s, "stat_id"): val(text(s, "value")) for s in t.findall("team_stats/stats/stat")}
                stats[tk] = [m.get(i) for i in scoring]
                extra[tk] = {shown[i]: text(s, "value") for s in t.findall("team_stats/stats/stat") for i in [text(s, "stat_id")] if i in shown}
            won = {text(sw, "stat_id"): (None if text(sw, "is_tied") == "1" else text(sw, "winner_team_key"))
                   for sw in mu.findall("stat_winners/stat_winner")}
            mus.append({"teams": tks, "stats": stats, "x": extra, "won": [won.get(i, "") for i in scoring],
                        "playoffs": text(mu, "is_playoffs") == "1", "consolation": text(mu, "is_consolation") == "1"})
        weeks.append({"week": w, "s": ws, "e": we, "matchups": mus})
    moves = []
    for t in transactions(y, key):
        if t is None or text(t, "status") != "successful" or text(t, "type") not in ("add", "drop", "add/drop"):
            continue
        for pl in t.findall(".//players/player"):
            td = pl.find("transaction_data")
            moves.append({"ts": int(num(t, "timestamp") or 0), "type": text(td, "type"), "name": text(pl, "name/full"),
                          "pos": text(pl, "display_position"), "from": text(td, "source_type"),
                          "team": text(td, "destination_team_key") or text(td, "source_team_key")})
    moves.sort(key=lambda m: m["ts"])
    return {"season": year, "key": key, "start": text(meta, "start_date"), "end": text(meta, "end_date"),
            "finished": text(meta, "is_finished") == "1",
            "playoff_week": int(num(sn, "playoff_start_week") or end_w + 1),
            "cats": [c for c in cats if not c["display"]], "teams": teams, "weeks": weeks, "moves": moves}


def _complete(path):
    """A finished season's file is kept unless it's missing something newer pulls add (moves, week dates)"""
    h = json.load(open(path, encoding="utf-8"))
    return bool(h.get("moves")) and all(w.get("s") for w in h.get("weeks", []))


def main():
    data = json.load(open(DATA, encoding="utf-8"))
    y = Yahoo(token=access_token())
    os.makedirs(OUT, exist_ok=True)
    last = data["seasons"][-1]["year"]
    for s in data["seasons"]:
        path = os.path.join(OUT, f"{s['year']}.json")
        if os.path.exists(path) and s["year"] != last and "--all" not in sys.argv and _complete(path):
            continue
        got = season(y, s["year"], s["lid"])
        if not got:
            print(f"::warning::No Yahoo league for {s['year']}.")
            continue
        try:
            if json.load(open(path, encoding="utf-8")) == got:
                print(f"{s['year']}: no change.")
                continue
        except (OSError, ValueError):
            pass
        with open(path, "w", encoding="utf-8") as f:
            json.dump(got, f, ensure_ascii=False, separators=(",", ":"))
        print(f"{s['year']}: {len(got['weeks'])} weeks, {len(got['cats'])} categories, {len(got['moves'])} adds and drops.")


if __name__ == "__main__":
    try:
        main()
    except NotApproved:
        print("::error::Yahoo hasn't approved this app for Fantasy data.")
        sys.exit(1)
    except Failure as e:
        print(f"::error::{e}")
        sys.exit(1)
