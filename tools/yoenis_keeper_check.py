#!/usr/bin/env python3
"""Check the 2027 keeper costs in yoenis/data.json against Yahoo's 2026 season.

Reads tools/yahoo_yoenis/2026.json (written by tools/yoenis_yahoo_pull.py) and works out, for every player
on a final 2026 roster, what the league's rules say he costs to keep in 2027:
  - Added to his team on or after Sept. 1 (any add or trade): can't be kept.
  - Kept in 2026 (the keeper sheet, data["keeperHistory"]["2026"]): his keeper clock goes on, whoever has him,
    unless he was dropped and cleared waivers since.
  - Drafted in 2026: his draft round, whoever drafted him. A trade or a waiver claim keeps it; clearing
    waivers (picked up as a free agent after a drop) loses it.
  - Anyone else: a 15th-round pick.
  - Year one costs the base round, year two two rounds earlier, year three six rounds earlier (never past 1);
    after three years he goes back in the pool.

Writes data["keeperCheck"]: when it ran, how many players it checked, and every disagreement with
data["keepers2027"], so the page can show the check. It never changes keepers2027 itself.

  python3 tools/yoenis_keeper_check.py            check and write data["keeperCheck"]
  python3 tools/yoenis_keeper_check.py --dry      print the report only
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from yoenis_yahoo_keepers import fold, side  # noqa: E402
from difflib import SequenceMatcher  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "yoenis" / "data.json"
EASTERN = ZoneInfo("America/New_York")
YEAR = 2026
FA_ROUND = 15
STEP = {1: 0, 2: 2, 3: 6}  # rounds earlier than year one


def path_from(base):
    return [max(1, base - STEP[y]) for y in (1, 2, 3)]


def nkey(name):
    """Folded name, keeping Ohtani's two halves apart ('(Batter)' / '(Pitcher)', or the sheet's '(P)')."""
    return fold(name) + (":" + side(name) if side(name) else "")


def sheet_keepers(data, season):
    """2026 keepers from the sheet, {name key: (round, year)}. The sheet's spellings drift
    ('Junior Camirero', 'Ohtani (P)'), so each one is matched to the closest keeper pick in that
    team's 2026 draft, which uses Yahoo's spelling."""
    picks = {}
    for row in season["draft"]:
        if len(row) > 3 and row[3]:
            picks.setdefault(row[1], []).append(row[2])
    out = {}
    for ti, rows in data["keeperHistory"].get(str(YEAR), []):
        pool = picks.get(ti, [])
        for r in rows:
            want = r[0]
            best = max(pool, key=lambda n: score(want, n), default=None)
            if best is None or score(want, best) < 0.6:
                best = want  # no keeper pick looks like him; keep the sheet's spelling
            out[nkey(best)] = (r[1], r[2])
    return out


def score(a, b):
    if side(a) and side(b) and side(a) != side(b):
        return 0
    fa, fb = fold(a), fold(b)
    if fa and fa in fb:  # 'Ohtani (P)' within 'Shohei Ohtani (Pitcher)'
        return 0.95
    return SequenceMatcher(None, fa, fb).ratio()


def expected(yh, data):
    teams = yh["teams"]
    names = {k: v["name"] for k, v in teams.items()}
    season = next(s for s in data["seasons"] if s["year"] == YEAR)

    drafted = {p["player"]: p for p in yh["draft"] if p.get("player")}

    kept = sheet_keepers(data, season)
    draft_ts = int(yh["settings"].get("draft_time") or 0)
    claim_days = int(yh["settings"].get("waiver_time") or 2) + 1.5  # drop waivers plus that night's run

    # Each player's moves after the draft, oldest first
    moves = {}
    for t in yh["transactions"]:
        if t["status"] != "successful" or t["ts"] < draft_ts:
            continue
        for m in t["moves"]:
            moves.setdefault(m["player"], []).append((t["ts"], t["type"], m))

    out = {}
    for tk, roster in yh["rosters"].items():
        team = names[tk]
        for pl in roster:
            key, name = pl["key"], pl["name"]
            pick = drafted.get(key)
            keeps_round = pick is not None
            joined = None  # when he last came to this team
            dropped = None
            slow = []  # pickups that came well after a drop: did he clear waivers?
            for ts, ttype, m in moves.get(key, []):
                if m["type"] == "drop":
                    dropped = ts
                if m["type"] == "add":
                    if m["from"] == "freeagents":
                        keeps_round = False
                    elif dropped and (ts - dropped) / 86400 > claim_days:
                        slow.append(round((ts - dropped) / 86400))
                    dropped = None
                if m.get("to_team") == tk and m["type"] in ("add", "trade"):
                    joined = ts
            e = {"p": name, "team": team}
            if pick:
                e["d"] = pick["round"]
                if pick["team"] != tk:
                    e["via"] = names.get(pick["team"])
            k = kept.get(nkey(name))
            if k and keeps_round:
                base = k[0] + STEP[k[1]] if k[0] > 1 else 1
                e["k"] = [k[0], k[1]]
                e["path"] = path_from(base)
                e["next"] = None if k[1] >= 3 else [e["path"][k[1]], k[1] + 1]
            elif keeps_round:
                e["path"] = path_from(pick["round"])
                e["next"] = [pick["round"], 1]
            else:
                e["fa"] = 1
                e["path"] = path_from(FA_ROUND)
                e["next"] = [FA_ROUND, 1]
            if joined:
                when = datetime.fromtimestamp(joined, EASTERN)
                if (when.month, when.day) >= (9, 1) and when.year == YEAR:
                    e["late"] = when.day
                    e["next"] = None
            if slow and (pick or k):
                e["slow"] = slow
            yk = pl.get("yk") or {}
            if yk.get("kept") == "1":
                e["yahoo_kept"] = True
            out[(team, nkey(name))] = e
    return out


def compare(exp, data):
    page = {}
    for team, rows in data["keepers2027"].items():
        for e in rows:
            page[(team, nkey(e["p"]))] = e
    issues = []
    for key, e in exp.items():
        p = page.get(key)
        if p is None:
            issues.append({"team": key[0], "p": e["p"], "issue": "on Yahoo's final roster, missing from the page"})
            continue
        diffs = []
        if bool(p.get("late")) != bool(e.get("late")):
            diffs.append(f"Sept. add: page {'Sept. ' + str(p['late']) if p.get('late') else 'none'}, "
                         f"Yahoo {'Sept. ' + str(e['late']) if e.get('late') else 'none'}")
        elif p.get("late") and p["late"] != e["late"]:
            diffs.append(f"added Sept. {p['late']} on the page, Sept. {e['late']} on Yahoo")
        if bool(p.get("fa")) != bool(e.get("fa")):
            diffs.append(f"page has {'free agent' if p.get('fa') else 'round ' + str(p.get('d'))}, "
                         f"Yahoo has {'free agent' if e.get('fa') else 'round ' + str(e.get('d'))}")
        elif not e.get("fa") and p.get("d") != e.get("d"):
            diffs.append(f"draft round: page {p.get('d')}, Yahoo {e.get('d')}")
        if p.get("via") != e.get("via") and not e.get("fa"):
            diffs.append(f"drafted by: page {p.get('via') or 'own team'}, Yahoo {e.get('via') or 'own team'}")
        if p.get("next") != e.get("next") and not diffs:
            diffs.append(f"2027 cost: page {p.get('next')}, rules give {e.get('next')}")
        if diffs:
            issues.append({"team": key[0], "p": p["p"], "issue": "; ".join(diffs)})
    for key, p in page.items():
        if key not in exp:
            issues.append({"team": key[0], "p": p["p"], "issue": "on the page, not on Yahoo's final roster"})
    # Yahoo's own keeper flags against the sheet
    sheet = set(sheet_keepers(data, next(s for s in data["seasons"] if s["year"] == YEAR)))
    for key, e in exp.items():
        if e.get("yahoo_kept") and key[1] not in sheet:
            issues.append({"team": key[0], "p": e["p"], "issue": "Yahoo marks him a 2026 keeper; the keeper sheet doesn't"})
    issues.sort(key=lambda i: (i["team"].lower(), i["p"]))
    # The rules question: drafted players (or 2026 keepers) picked up well after a drop
    question = sorted(({"team": k[0], "p": e["p"], "round": e["next"][0] if e.get("next") else None,
                        "days": max(e["slow"])} for k, e in exp.items() if e.get("slow") and e.get("next")),
                      key=lambda q: (-q["days"], q["p"]))
    return issues, question


def main():
    dry = "--dry" in sys.argv
    yh_path = ROOT / "tools" / "yahoo_yoenis" / f"{YEAR}.json"
    yh = json.load(open(yh_path, encoding="utf-8"))
    data = json.load(open(DATA, encoding="utf-8"))
    exp = expected(yh, data)
    issues, question = compare(exp, data)
    for i in issues:
        print(f"{i['team']:32} {i['p']:26} {i['issue']}")
    print(f"{len(exp)} players checked, {len(issues)} to look at.")
    print(f"{len(question)} eligible players keep a draft round after sitting unclaimed past the waiver period:")
    for q in question:
        print(f"  {q['team']:32} {q['p']:26} round {q['round']}, picked up {q['days']} days after a drop")
    if dry:
        return
    check = {"yahoo": yh["pulled"][:10], "players": len(exp), "issues": issues, "slow": question}
    old = data.get("keeperCheck") or {}
    if {k: v for k, v in old.items() if k != "checked"} == check:
        return
    check = {"checked": datetime.now(timezone.utc).strftime("%Y-%m-%d"), **check}
    data["keeperCheck"] = check
    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote keeperCheck to {DATA}.")


if __name__ == "__main__":
    main()
