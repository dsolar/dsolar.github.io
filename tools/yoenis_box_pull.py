#!/usr/bin/env python3
"""Pull Wipe Yoenis box scores and player ranks from Yahoo into tools/yahoo_yoenis/box/<year>.json.

Box scores: every day of the season, each team's lineup (who was in an active slot) and those players' stats that
day, added up by matchup week. A player counts for a team only on the days he started for it, the way Yahoo scores.
Ranks: Yahoo's preseason rank (OR) and its rank for the season (S) for the top players, with % rostered and ADP.

Team names, player names and stats only; no manager names or Yahoo IDs beyond player and team keys.
A finished season is pulled once (the file is kept when it's complete).

  python3 tools/yoenis_box_pull.py [year]      default: the season in tools/yahoo_yoenis/<latest>.json
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from glob import glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guillotine_update import Yahoo, access_token, text, num, Failure, NotApproved  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SEASONS = os.path.join(ROOT, "tools", "yahoo_yoenis")
OUT_DIR = os.path.join(SEASONS, "box")
BENCH = {"BN", "IL", "IL+", "NA", "DL"}
# Yahoo stat ids: the league's 16 categories and the two display stats that carry the rate stats' weights
STAT = {"7": "r", "8": "h", "12": "hr", "13": "rbi", "16": "sb", "23": "tb", "3": "avg", "55": "ops",
        "28": "w", "29": "l", "32": "sv", "42": "k", "48": "hld", "26": "era", "27": "whip", "83": "qs",
        "60": "hab", "50": "ip"}
COUNT_B = ("r", "h", "hr", "rbi", "sb", "tb")
COUNT_P = ("w", "l", "sv", "k", "hld", "qs")


def fnum(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def outs(ip):
    """Yahoo's innings (6.2 = six and two thirds) in outs."""
    if ip is None:
        return 0
    whole = int(ip)
    return whole * 3 + round((ip - whole) * 10)


def day_stats(p):
    """One player's line for one day, as components that add up across days."""
    raw = {STAT[text(s, "stat_id")]: text(s, "value") for s in p.findall("player_stats/stats/stat") if text(s, "stat_id") in STAT}
    side = "p" if text(p, "position_type") == "P" else "b"
    out = {}
    if side == "b":
        ab = h = None
        if raw.get("hab") and "/" in raw["hab"]:
            h, ab = (fnum(x) for x in raw["hab"].split("/"))
        if not ab and not any(fnum(raw.get(k)) for k in COUNT_B):
            return side, None
        for k in COUNT_B:
            v = fnum(raw.get(k))
            if v:
                out[k] = v
        ab = ab or 0
        out["ab"] = ab
        # OPS doesn't add up from a day's figure; OBP is carried as on-base times at-bats, so the week's OBP is an
        # at-bat weighted average (exact SLG from total bases, close OBP)
        ops = fnum(raw.get("ops"))
        if ab and ops is not None:
            out["obpab"] = round((ops - (out.get("tb", 0) / ab)) * ab, 4)
    else:
        ip = fnum(raw.get("ip"))
        o = outs(ip)
        if not o and not any(fnum(raw.get(k)) for k in COUNT_P):
            return side, None
        for k in COUNT_P:
            v = fnum(raw.get(k))
            if v:
                out[k] = v
        out["outs"] = o
        era, whip = fnum(raw.get("era")), fnum(raw.get("whip"))
        if o:
            out["er"] = round((era or 0) * o / 27, 3)
            out["bbh"] = round((whip or 0) * o / 3, 3)
    return side, out


def add(into, s):
    for k, v in s.items():
        into[k] = round(into.get(k, 0) + v, 4)


def main():
    files = sorted(f for f in glob(os.path.join(SEASONS, "*.json")) if os.path.basename(f)[:4].isdigit())
    year = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.path.basename(files[-1])[:4])
    season = json.load(open(os.path.join(SEASONS, f"{year}.json"), encoding="utf-8"))
    key = season["key"]
    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, f"{year}.json")
    try:
        old = json.load(open(out_path, encoding="utf-8"))
        if old.get("complete"):
            print(f"{year} box scores are complete; nothing to pull.")
            return
    except (OSError, ValueError):
        old = None

    y = Yahoo(token=access_token())
    meta = y.get(f"league/{key}/metadata").find(".//league")
    finished = text(meta, "is_finished") == "1"
    start, end = date.fromisoformat(text(meta, "start_date")), date.fromisoformat(text(meta, "end_date"))
    today = date.today()
    last = min(end, today - timedelta(days=1))
    team_keys = list(season["teams"].keys())

    # the weeks, from the scoreboard's matchup dates
    weeks = []
    for w in range(int(num(meta, "start_week") or 1), int(num(meta, "end_week") or 1) + 1):
        sb = y.get(f"league/{key}/scoreboard;week={w}", soft=True)
        m = sb.find(".//matchup") if sb is not None else None
        if m is None:
            continue
        weeks.append((w, date.fromisoformat(text(m, "week_start")), date.fromisoformat(text(m, "week_end"))))
    week_of = lambda d: next((w for w, a, b in weeks if a <= d <= b), None)

    def lineup(d):
        r = y.get(f"league/{key}/teams;team_keys={','.join(team_keys)}/roster;date={d.isoformat()}", soft=True)
        got = {}
        if r is None:
            return d, got
        for t in r.findall(".//team"):
            tk = text(t, "team_key")
            for p in t.findall("roster/players/player"):
                slot = text(p, "selected_position/position")
                if slot and slot not in BENCH:
                    got.setdefault(tk, []).append((text(p, "player_key"), text(p, "name/full"), slot, text(p, "position_type")))
        return d, got

    def stats(d, pkeys):
        res = {}
        for i in range(0, len(pkeys), 25):
            r = y.get(f"league/{key}/players;player_keys={','.join(pkeys[i:i + 25])}/stats;type=date;date={d.isoformat()}", soft=True)
            if r is None:
                continue
            for p in r.findall(".//player"):
                res[text(p, "player_key")] = day_stats(p)
        return res

    days = [start + timedelta(days=k) for k in range((last - start).days + 1)]
    box, names, missing = {}, {}, []
    printed = False
    with ThreadPoolExecutor(max_workers=4) as ex:
        lineups = list(ex.map(lineup, days))
        jobs = []
        for d, got in lineups:
            if not got:
                missing.append(d.isoformat())
                continue
            pkeys = sorted({pk for lst in got.values() for pk, *_ in lst})
            jobs.append((d, got, ex.submit(stats, d, pkeys)))
        for d, got, fut in jobs:
            st = fut.result()
            if not printed and st:
                print("sample day line:", next(iter(st.items())))
                printed = True
            w = week_of(d)
            if w is None:
                continue
            for tk, lst in got.items():
                for pk, name, slot, ptype in lst:
                    side, line = st.get(pk, (None, None))
                    if not line:
                        continue
                    names[pk] = name
                    row = box.setdefault(str(w), {}).setdefault(tk, {}).setdefault(pk, {"side": side, "slot": slot, "days": 0, "s": {}})
                    row["days"] += 1
                    row["slot"] = slot
                    add(row["s"], line)

    out = {"season": year, "key": key, "pulled": today.isoformat(), "complete": finished and not missing and last >= end,
           "weeks": {str(w): {"start": a.isoformat(), "end": b.isoformat()} for w, a, b in weeks},
           "names": names, "box": box, "missingDays": missing}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    n = sum(len(p) for t in box.values() for p in t.values())
    print(f"Wrote {out_path}: {len(days)} days, {len(box)} weeks, {n} player-weeks, {len(missing)} days missing.")


def ranks():
    """Yahoo's preseason (OR) and season (S) ranks, % rostered and ADP, for the top players by each."""
    files = sorted(f for f in glob(os.path.join(SEASONS, "*.json")) if os.path.basename(f)[:4].isdigit())
    year = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.path.basename(files[-1])[:4])
    key = json.load(open(os.path.join(SEASONS, f"{year}.json"), encoding="utf-8"))["key"]
    y = Yahoo(token=access_token())
    got = {}

    def page(args):
        sort, start = args
        r = y.get(f"league/{key}/players;sort={sort};sort_type=season;start={start};count=25;out=ranks,percent_owned,draft_analysis", soft=True)
        return [] if r is None else r.findall(".//player")

    with ThreadPoolExecutor(max_workers=6) as ex:
        for ps in ex.map(page, [(s, k) for s in ("OR", "AR") for k in range(0, 1000, 25)]):
            for p in ps:
                pk = text(p, "player_key")
                row = {"n": text(p, "name/full"), "t": text(p, "editorial_team_abbr"), "pos": text(p, "display_position")}
                for rk in p.findall("player_ranks/player_rank"):
                    t, v, s = text(rk, "rank_type"), num(rk, "rank_value"), text(rk, "rank_season")
                    if v is None:
                        continue
                    if t == "OR":
                        row["pre"] = int(v)
                    elif t == "S" and s == str(year):
                        row["szn"] = int(v)
                own = num(p, "percent_owned/value")
                if own is not None:
                    row["own"] = own
                adp = num(p, "draft_analysis/average_pick")
                if adp:
                    row["adp"] = adp
                got[pk] = row
    path = os.path.join(OUT_DIR, f"ranks{year}.json")
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"season": year, "players": got}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {path}: {len(got)} players.")


if __name__ == "__main__":
    try:
        ranks()
        main()
    except NotApproved:
        print("::error::Yahoo hasn't approved this app for Fantasy data.")
        sys.exit(1)
    except Failure as e:
        print(f"::error::{e}")
        sys.exit(1)
