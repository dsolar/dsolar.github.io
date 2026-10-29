#!/usr/bin/env python3
"""Total each Wipe Yoenis tenure window's real stats from MLB game logs, into tools/yahoo_yoenis/slices/<year>.json.

For every trade and pickup window in tools/yoenis_tenure.py, the player's stats from the day after he joined
the team to the day before he left it (or season's end), from MLB's public Stats API game logs. That's what
the trade and waiver-wire values score, instead of prorating his full season.
A season is redone only when its windows change, so finished seasons are pulled once.
Runs in the "Wipe Yoenis Yahoo pull" workflow (the workspace can't reach statsapi.mlb.com), or:
  python3 tools/yoenis_slices_pull.py [year ...]
Writes {"keys": [window keys], "s": {window key: totals}} with
  hitters  {"r","h","hr","rbi","sb","tb","pa","ab","bb","hbp","sf"}
  pitchers {"w","l","sv","k","hld","qs","outs","er","bb","h"}
"""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mlb_stats_pull import get, ip_outs  # noqa: E402
from yoenis_tenure import windows, key, HIST  # noqa: E402
from yoenis_yahoo_keepers import fold  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MLB = ROOT / "tools" / "mlb"
OUT = ROOT / "tools" / "yahoo_yoenis" / "slices"
HIT = {"runs": "r", "hits": "h", "homeRuns": "hr", "rbi": "rbi", "stolenBases": "sb", "totalBases": "tb",
       "plateAppearances": "pa", "atBats": "ab", "baseOnBalls": "bb", "hitByPitch": "hbp", "sacFlies": "sf"}
PIT = {"wins": "w", "losses": "l", "saves": "sv", "strikeOuts": "k", "holds": "hld", "earnedRuns": "er",
       "baseOnBalls": "bb", "hits": "h"}


def mlb_ids(year):
    """{(folded name, 'b'|'p'): MLB id}, the busier player when two share a name (as the value model does)"""
    m = json.loads((MLB / f"{year}.json").read_text(encoding="utf-8"))
    out, size = {}, {}
    for side, rows, n in (("b", m["hitting"], lambda r: r["pa"]), ("p", m["pitching"], lambda r: ip_outs(r["ip"]))):
        for r in rows:
            k = (fold(r["name"]), side)
            if k not in out or n(r) > size[k]:
                out[k], size[k] = r["id"], n(r)
    return out


def game_log(pid, year, side):
    data = get(f"people/{pid}/stats?stats=gameLog&group={'hitting' if side == 'b' else 'pitching'}&season={year}&gameType=R")
    rows = []
    for s in (data.get("stats") or [{}])[0].get("splits", []):
        st, d = s.get("stat", {}), s.get("date")
        if not d:
            continue
        if side == "b":
            row = {v: int(st.get(k) or 0) for k, v in HIT.items()}
        else:
            row = {v: int(st.get(k) or 0) for k, v in PIT.items()}
            row["outs"] = ip_outs(st.get("inningsPitched"))
            row["qs"] = 1 if int(st.get("gamesStarted") or 0) and row["outs"] >= 18 and row["er"] <= 3 else 0
        rows.append((date.fromisoformat(d), row))
    return rows


def pull(year):
    ws = windows(year)
    keys = sorted({key(w) for w in ws})
    path = OUT / f"{year}.json"
    if path.exists():
        old = json.loads(path.read_text(encoding="utf-8"))
        if old.get("keys") == keys:
            print(f"{year}: no change.")
            return
    ids = mlb_ids(year)
    need = {}
    for w in ws:
        pid = ids.get(w["pk"])
        if pid:
            need.setdefault((pid, w["pk"][1]), []).append(w)
    logs = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        for (pid, side), rows in zip(need, ex.map(lambda k: game_log(k[0], year, k[1]), need)):
            logs[(pid, side)] = rows
    sums = {}
    for (pid, side), wl in need.items():
        for w in wl:
            tot = {}
            for d, row in logs[(pid, side)]:
                if w["start"] <= d <= w["end"]:
                    for k, v in row.items():
                        tot[k] = tot.get(k, 0) + v
            sums[key(w)] = tot
    OUT.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"season": year, "keys": keys, "s": sums}, separators=(",", ":")), encoding="utf-8")
    print(f"{year}: {len(need)} game logs, {len(sums)} of {len(keys)} windows matched to an MLB player.")


def main():
    years = [int(a) for a in sys.argv[1:]] or sorted(int(p.stem) for p in HIST.glob("*.json"))
    for y in years:
        if (MLB / f"{y}.json").exists():
            pull(y)


if __name__ == "__main__":
    main()
