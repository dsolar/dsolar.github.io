#!/usr/bin/env python3
"""Offseason trades for the Wipe Yoenis trade history: keepers and picks that changed hands between seasons.

Those deals happen on the league thread, not in Yahoo, so they're pieced together two ways:
  - The keeper sheet's "Trades" tabs (2023 on), which list each deal. Saved here once from an export:
        python3 tools/yoenis_offseason_trades.py --sheet "Fantasy Keepers.xlsx"
    writes tools/yahoo_yoenis/sheet_trades.json, with each side mapped to its manager.
  - The draft boards and the commissioner's moves (2016 to 2022, and any season the sheet doesn't cover).
    The draft is a snake, so every pick's original owner is its slot; a pick used by another team was
    traded. And a player dropped by one team and picked up by another before Opening Day was moved by
    hand. Picks and players that moved between the same two managers that spring make one deal.
    2013 to 2015 are left out: those drafts don't follow a clean snake order, so the slots can't be read.
    A pick passed along twice (A's pick to B, then on to C) shows up on the board as A's pick in C's hands.
    Since there are no three-team trades, it's routed through the one manager who dealt with both A and C
    that winter. Same-round pick swaps count: they move a team up within a round. Anything still one-sided
    is left out of the scores; unclear(data) lists it. tools/yahoo_yoenis/offseason_fixes.json holds
    corrections from the league emails (2018's expansion rosters, for one).

trades(data) -> [{"y": season, "d": "YYYY-MM-DD" or None, "a": owner, "b": owner,
                  "ag": [player, ...], "bg": [...], "ap": [round, ...], "bp": [...], "src": "sheet"|"board"}]
Scored by tools/yoenis_trades_build.py alongside the in-season trades.
"""
import collections
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from yoenis_yahoo_keepers import fold  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
HIST = ROOT / "tools" / "yahoo_yoenis" / "history"
SHEET = ROOT / "tools" / "yahoo_yoenis" / "sheet_trades.json"
FIXES = ROOT / "tools" / "yahoo_yoenis" / "offseason_fixes.json"  # corrections from the league emails
EASTERN = ZoneInfo("America/New_York")
BOARD_FROM = 2016
# Picks could be traded during the season through 2016, so a picks-only deal on the 2016 or 2017 board
# between two managers who made a Yahoo trade the summer before is that trade's picks, not a winter deal.
INSEASON_PICKS_THROUGH = 2016
TRADES = ROOT / "tools" / "yahoo_yoenis" / "trades.json"

# How the sheet names managers: first names, nicknames, team names at the time
ALIAS = {
    "dave": "davids", "dave (ippei)": "davids", "syndergaarden cop": "davids",
    "rb": "davidb", "rb (cease)": "davidb",
    "wofsy": "jon", "wofsy (bulba)": "jon", "jon": "jon",
    "sutelman (madrigal)": "jeffs", "jeff": "jeffs",
    "dion (love garrett richards)": "nickd", "nick": "nickd", "lovegaretrchrdsthatsmy_problem": "nickd",
    "ken": "keng", "kenny g": "keng", "ken (joe buck)": "keng", "joe buck yourself": "keng",
    "henry": "henry", "dane": "dane", "dane (dombrowski)": "dane", "dane dombrowski": "dane",
    "steve": "steve", "dan": "dan", "padilla flotilla": "dan", "josh": "josh", "josh (kitty autumn)": "josh",
    "brian": "brian", "tom": "tom", "nate (mendoza)": "nate", "season starts today": "nate",
}
PICK = re.compile(r"(\d+)(?:st|nd|rd|th)\s+round", re.I)


def pick_round(s):
    m = PICK.search(s)
    return int(m.group(1)) if m else None


# ------------------------------------------------------------ the sheet

def read_sheet(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    out = []
    for ws in wb.worksheets:
        m = re.fullmatch(r"(\d{4}) Trades", ws.title.strip())
        if not m:
            continue
        year, cur = int(m.group(1)), None
        for row in ws.iter_rows(min_row=2, max_col=5, values_only=True):
            a, ag, b, bg, _ = (list(row) + [None] * 5)[:5]
            if isinstance(a, str) and a.strip().lower() == "team":
                break  # the vote tables below the trades
            if a:
                cur = {"y": year, "a": ALIAS.get(str(a).strip().lower(), str(a).strip()),
                       "b": ALIAS.get(str(b).strip().lower(), str(b).strip()) if b else None, "ag": [], "bg": []}
                out.append(cur)
            if cur is None:
                continue
            for v, k in ((ag, "ag"), (bg, "bg")):
                if v and str(v).strip():
                    cur[k].append(str(v).strip())
    return out


def save_sheet(path):
    rows = read_sheet(path)
    SHEET.write_text(json.dumps(rows, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} sheet trades to {SHEET}.")


# ------------------------------------------------------------ the draft board and the commissioner's moves

def board_picks(season):
    """[(round, from owner, to owner)] for every pick used by someone other than its slot's owner"""
    by = collections.defaultdict(list)
    for e in season["draft"]:
        by[e[0]].append(e)
    n = len(by[1])
    slot = collections.defaultdict(collections.Counter)
    for r, es in by.items():
        for i, e in enumerate(es):
            slot[i if r % 2 else n - 1 - i][e[1]] += 1
    owner = {p: c.most_common(1)[0][0] for p, c in slot.items()}
    out = []
    for r, es in sorted(by.items()):
        for i, e in enumerate(es):
            frm = owner[i if r % 2 else n - 1 - i]
            if e[1] != frm:
                out.append((r, season["o"][frm], season["o"][e[1]]))
    return out


def moved_players(season):
    """[(date, player, from owner, to owner)]: dropped by one team, added by another before Opening Day"""
    path = HIST / f"{season['year']}.json"
    if not path.exists():
        return []
    h = json.loads(path.read_text(encoding="utf-8"))
    idx = {k: season["teams"].index(n) for k, n in h["teams"].items() if n in season["teams"]}
    start = date.fromisoformat(h["start"])
    drops, added, out = {}, set(), []
    for m in h["moves"]:
        dt = datetime.fromtimestamp(m["ts"], EASTERN)
        if dt.date() >= start:
            break
        if m["type"] == "drop" and m["team"] in idx:
            # A team dropping someone it only just picked up is churning the wire, not trading him
            if (fold(m["name"]), m["team"]) not in added:
                drops[fold(m["name"])] = (idx[m["team"]], dt)
        elif m["type"] == "add" and m["team"] in idx:
            dr = drops.get(fold(m["name"]))
            # The commissioner moves a traded player within a day or so (up to 31 hours in the sheet's trades)
            if dr and dr[0] != idx[m["team"]] and (dt - dr[1]).total_seconds() <= 48 * 3600:
                out.append((dt.date().isoformat(), m["name"], season["o"][dr[0]], season["o"][idx[m["team"]]]))
                drops.pop(fold(m["name"]), None)
            else:
                added.add((fold(m["name"]), m["team"]))  # a pickup: dropping him again isn't a trade
    fix = fixes().get(str(season["year"]), {})
    ignore = {fold(n) for n in fix.get("ignore", [])}
    frm = {fold(k): v for k, v in fix.get("from", {}).items()}
    return [(d, n, frm.get(fold(n), a), b) for d, n, a, b in out if fold(n) not in ignore]


def fixes():
    return json.loads(FIXES.read_text(encoding="utf-8")) if FIXES.exists() else {}


def route_chains(picks, players):
    """Send each pick that only went one way between two managers through the one manager both of them
    dealt with that winter (A's pick to B, then B to C), until nothing more can be routed."""
    picks = list(picks)
    while True:
        dealt = collections.defaultdict(set)  # pair -> directions seen
        for _, a, b in picks + [(None, p[2], p[3]) for p in players]:
            dealt[frozenset((a, b))].add((a, b))
        both = {k for k, v in dealt.items() if len(v) == 2}
        changed = False
        for i, (r, a, c) in enumerate(picks):
            if frozenset((a, c)) in both:
                continue
            mids = {m for k in both if a in k for m in k if m != a} & {m for k in both if c in k for m in k if m != c}
            if len(mids) == 1:
                b = mids.pop()
                picks[i:i + 1] = [(r, a, b), (r, b, c)]
                changed = True
                break
        if not changed:
            return picks


def board_trades(season):
    pairs = {}
    players = moved_players(season)
    for r, frm, to in route_chains(board_picks(season), players):
        a, b = sorted((frm, to))
        t = pairs.setdefault((a, b), {"y": season["year"], "d": None, "a": a, "b": b, "ag": [], "bg": [], "ap": [], "bp": [], "src": "board"})
        t["ap" if to == a else "bp"].append(r)
    for d, name, frm, to in players:
        a, b = sorted((frm, to))
        t = pairs.setdefault((a, b), {"y": season["year"], "d": None, "a": a, "b": b, "ag": [], "bg": [], "ap": [], "bp": [], "src": "board"})
        t["ag" if to == a else "bg"].append(name)
        t["d"] = min(t["d"] or d, d)
    return list(pairs.values())


def sheet_trades(season, rows):
    """The sheet's deals for this season, with dates and any missing partner filled in from the moves"""
    moves = moved_players(season)
    out = []
    for r in rows:
        if r["y"] != season["year"]:
            continue
        a, b = r["a"], r["b"]
        gets = {"a": [x for x in r["ag"] if pick_round(x) is None], "b": [x for x in r["bg"] if pick_round(x) is None]}
        if not b:  # a row with no partner listed: whoever those players came from
            names = {fold(x) for x in gets["a"]}
            b = next((m[2] for m in moves if fold(m[1]) in names and m[3] == a), None)
        if not (a and b):
            continue
        dates = [m[0] for m in moves if fold(m[1]) in {fold(x) for x in gets["a"] + gets["b"]}]
        out.append({"y": season["year"], "d": min(dates) if dates else None, "a": a, "b": b,
                    "ag": gets["a"], "bg": gets["b"],
                    "ap": [pick_round(x) for x in r["ag"] if pick_round(x)], "bp": [pick_round(x) for x in r["bg"] if pick_round(x)],
                    "src": "sheet"})
    return out


def trades(data, check=False):
    rows = json.loads(SHEET.read_text(encoding="utf-8")) if SHEET.exists() else []
    covered = {r["y"] for r in rows}
    out = []
    for s in data["seasons"]:
        if s["year"] < BOARD_FROM:
            continue
        board = board_trades(s)
        if s["year"] in covered:
            sheet = sheet_trades(s, rows)
            if check:
                compare(s["year"], sheet, board)
            out.extend(sheet)
        else:
            for t in board:
                if not clear(t):
                    continue
                link = summer_trade(t, data) if not t["ag"] and not t["bg"] else None
                if link:
                    t["summer"] = link  # tools/yoenis_trades_build.py adds these picks to that trade
                out.append(t)
    return out


def summer_trade(t, data):
    """The Yahoo trade id from last season these picks belong to, when in-season pick trades were allowed"""
    year = t["y"] - 1
    if year > INSEASON_PICKS_THROUGH or not TRADES.exists():
        return None
    pulled = json.loads(TRADES.read_text(encoding="utf-8")).get(str(year))
    s = next((s for s in data["seasons"] if s["year"] == year), None)
    if not pulled or not s:
        return None
    idx = {k: s["teams"].index(n) for k, n in pulled["teams"].items() if n in s["teams"]}
    hits = [x for x in pulled["trades"] if x["status"] == "successful" and x["a"] in idx and x["b"] in idx
            and {s["o"][idx[x["a"]]], s["o"][idx[x["b"]]]} == {t["a"], t["b"]}]
    return max(hits, key=lambda x: x["ts"])["id"] if hits else None


def clear(t):
    """A pair worth scoring: something went each way"""
    return bool((t["ag"] or t["ap"]) and (t["bg"] or t["bp"]))


def unclear(data):
    rows = json.loads(SHEET.read_text(encoding="utf-8")) if SHEET.exists() else []
    covered = {r["y"] for r in rows}
    return [t for s in data["seasons"] if s["year"] >= BOARD_FROM and s["year"] not in covered
            for t in board_trades(s) if not clear(t)]


def compare(year, sheet, board):
    """Print where the sheet and the draft board disagree, by pair of managers"""
    def tally(ts):
        c = collections.Counter()
        for t in ts:
            for side, gets, picks in (("a", t["ag"], t["ap"]), ("b", t["bg"], t["bp"])):
                to = t[side]
                for p in gets:
                    c[(to, "p", fold(p))] += 1
                for r in picks:
                    c[(to, "r", r)] += 1
        return c
    s, b = tally(sheet), tally(board)
    only_s, only_b = s - b, b - s
    print(f"{year}: {len(sheet)} sheet trades, {len(board)} board pairs; "
          f"sheet only {dict(only_s) or 'none'}; board only {dict(only_b) or 'none'}")


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--sheet":
        save_sheet(sys.argv[2])
    else:
        d = json.loads((ROOT / "yoenis" / "data.json").read_text(encoding="utf-8"))
        ts = trades(d, check=True)
        print(f"{len(ts)} offseason trades.")
