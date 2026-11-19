#!/usr/bin/env python3
"""NBA Hub lineups: every team's five-man units this season from pbpstats, plus what falls out of them: each
player's on/off (his team per 100 possessions with him on the floor and off it), and the best two- and three-man
combinations. Everything comes from the same possessions, so the numbers agree with each other.

Writes nba/data/lineups.json. The page (nba/app.js) only displays it.

Run: python3 tools/nba_lineups.py
"""
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from itertools import combinations

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "nba", "data", "lineups.json")
UA = "Mozilla/5.0 (compatible; davidsolar-nbahub/1.0; +https://davidsolar.dev/nba/)"
TEAM_IDS = range(1610612737, 1610612767)  # the NBA's 30 team ids
KEEP_MIN = 6        # five-man units shipped to the page: at least this many minutes together
COMBO_MIN = 40      # two- and three-man combinations: at least this many minutes


def get(url, timeout=150, tries=4):
    err = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:  # pbpstats answers 502 now and then
            err = e
            time.sleep(10 * (k + 1))
    raise err


def season_label(now=None):
    now = now or datetime.now(timezone.utc)
    end = now.year + 1 if now.month >= 10 else now.year
    return f"{end - 1}-{str(end)[2:]}"


def team_lineups(season, tid, kind="Lineup"):
    url = f"https://api.pbpstats.com/get-totals/nba?Season={season}&SeasonType=Regular%20Season&Type={kind}&TeamId={tid}"
    try:
        return tid, get(url).get("multi_row_table_data") or []
    except Exception as e:
        print(f"team {tid} {kind}: {type(e).__name__}: {e}", file=sys.stderr)
        return tid, None


# Team style: what each team does (its own lineups) and what it allows (pbpstats' LineupOpponent rows), summed over
# every lineup it has played
STYLE_KEYS = ["Minutes", "OffPoss", "Points", "FG2M", "FG2A", "FG3M", "FG3A", "FtPoints", "AtRimFGM", "AtRimFGA",
              "ShortMidRangeFGM", "ShortMidRangeFGA", "LongMidRangeFGM", "LongMidRangeFGA", "Corner3FGM", "Corner3FGA",
              "Arc3FGM", "Arc3FGA", "PtsAssisted2s", "PtsAssisted3s", "PtsUnassisted2s", "PtsUnassisted3s", "PtsPutbacks",
              "Assists", "Turnovers", "LiveBallTurnovers", "OffRebounds", "DefRebounds", "SecondChancePoints", "Steals", "Blocks",
              "Fg2aBlocked", "Fg3aBlocked"]


def style_sum(rows):
    if not rows:
        return None
    return {k: sum(n(r.get(k)) for r in rows) for k in STYLE_KEYS}


def style_rates(a, opp):
    """The numbers a team page shows, from summed counts: a is the side being described, opp the other side."""
    fga = a["FG2A"] + a["FG3A"]
    fgm = a["FG2M"] + a["FG3M"]
    poss = a["OffPoss"] or 1
    zones = {}
    for z, f in (("rim", "AtRim"), ("smid", "ShortMidRange"), ("lmid", "LongMidRange"), ("c3", "Corner3"), ("a3", "Arc3")):
        att = a[f + "FGA"]
        zones[z] = [round(att / fga, 3) if fga else None, round(a[f + "FGM"] / att, 3) if att else None]
    tov = a["Turnovers"] or a["LiveBallTurnovers"]
    return {
        "rtg": round(100 * a["Points"] / poss, 1), "pace": round(48 * a["OffPoss"] / (a["Minutes"] or 1), 1),
        "efg": round((fgm + 0.5 * a["FG3M"]) / fga, 3) if fga else None,
        "tov": round(100 * tov / poss, 1) if tov else None,
        "orb": round(a["OffRebounds"] / (a["OffRebounds"] + opp["DefRebounds"]), 3) if (a["OffRebounds"] + opp["DefRebounds"]) else None,
        "ftr": round(a["FtPoints"] / fga, 3) if fga else None,
        "rate3": round(a["FG3A"] / fga, 3) if fga else None,
        "ast": round((a["PtsAssisted2s"] / 2 + a["PtsAssisted3s"] / 3) / fgm, 3) if fgm else None,
        "unast100": round(100 * (a["PtsUnassisted2s"] + a["PtsUnassisted3s"]) / poss, 1),
        "sc100": round(100 * a["SecondChancePoints"] / poss, 1), "pb100": round(100 * a["PtsPutbacks"] / poss, 1),
        "zones": zones,
    }


def n(x):
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def main():
    season = season_label()
    old, old_names = {}, {}
    try:
        prev = json.load(open(OUT))
        if prev.get("season") == season:
            old, old_names = prev.get("teams") or {}, prev.get("names") or {}
    except (OSError, ValueError):
        pass
    with ThreadPoolExecutor(max_workers=3) as ex:
        got = list(ex.map(lambda t: team_lineups(season, t), TEAM_IDS))
        opp_rows = dict(ex.map(lambda t: team_lineups(season, t, "LineupOpponent"), TEAM_IDS))
    if got and got[0][1]:
        print("lineup fields:", ",".join(sorted(got[0][1][0].keys())), file=sys.stderr)
    teams, names, failed = {}, {}, 0
    for tid, rows in got:
        if not rows:
            failed += 1
            continue
        abbr = rows[0].get("TeamAbbreviation") or str(tid)
        units = []
        for r in rows:
            ids = str(r.get("EntityId") or "").split("-")
            nm = [x.strip() for x in str(r.get("Name") or "").split(",")]
            if len(ids) != 5:
                continue
            for i, x in zip(ids, nm):
                names.setdefault(i, x)
            units.append({"ids": ids, "min": n(r.get("Minutes")), "op": n(r.get("OffPoss")), "dp": n(r.get("DefPoss")),
                          "pts": n(r.get("Points")), "opp": n(r.get("OpponentPoints")),
                          "fg3a": n(r.get("FG3A")), "fga": n(r.get("FG2A")) + n(r.get("FG3A")), "rim": n(r.get("AtRimFGA"))})
        tot = {k: sum(u[k] for u in units) for k in ("min", "op", "dp", "pts", "opp")}
        # on/off: every lineup he's in versus every one he isn't
        on = defaultdict(lambda: {"min": 0.0, "op": 0.0, "dp": 0.0, "pts": 0.0, "opp": 0.0})
        for u in units:
            for i in u["ids"]:
                for k in on[i]:
                    on[i][k] += u[k]
        onoff = {}
        for i, a in on.items():
            off = {k: tot[k] - a[k] for k in a}
            rate = lambda d: (100 * d["pts"] / d["op"] if d["op"] else None, 100 * d["opp"] / d["dp"] if d["dp"] else None)
            o_on, d_on = rate(a)
            o_off, d_off = rate(off)
            onoff[i] = [round(a["min"]), round(a["op"] + a["dp"]), r1(o_on), r1(d_on), r1(o_off), r1(d_off), round(off["op"] + off["dp"])]
        # two- and three-man combinations
        combos = {}
        for size in (2, 3):
            agg = defaultdict(lambda: {"min": 0.0, "op": 0.0, "dp": 0.0, "pts": 0.0, "opp": 0.0})
            for u in units:
                for c in combinations(sorted(u["ids"]), size):
                    for k in agg[c]:
                        agg[c][k] += u[k]
            combos[size] = [[list(c), round(a["min"]), round(a["op"]), round(a["dp"]), round(a["pts"]), round(a["opp"])]
                            for c, a in agg.items() if a["min"] >= COMBO_MIN]
        units.sort(key=lambda u: -u["min"])
        teams[abbr] = {
            "id": tid, "tot": [round(tot["min"]), round(tot["op"]), round(tot["dp"]), round(tot["pts"]), round(tot["opp"])],
            "l5": [[u["ids"], round(u["min"], 1), round(u["op"]), round(u["dp"]), round(u["pts"]), round(u["opp"]),
                    round(u["fg3a"] / u["fga"], 3) if u["fga"] else None, round(u["rim"] / u["fga"], 3) if u["fga"] else None] for u in units if u["min"] >= KEEP_MIN],
            "n5": len(units), "onoff": onoff, "l2": combos[2], "l3": combos[3],
        }
        own, opp = style_sum(rows), style_sum(opp_rows.get(tid))
        if own and opp:
            teams[abbr]["style"] = {"o": style_rates(own, opp), "d": style_rates(opp, own)}
        elif old.get(abbr, {}).get("style"):
            teams[abbr]["style"] = old[abbr]["style"]
    for abbr, t in old.items():  # a team pbpstats didn't answer for keeps yesterday's numbers
        if abbr not in teams:
            teams[abbr] = t
            for i in t.get("onoff", {}):
                names.setdefault(i, old_names.get(i, i))
    # league ranks for every style number (1 is the most), and league averages for the shot zones
    lg = {}
    for side in ("o", "d"):
        sts = [(a, t["style"][side]) for a, t in teams.items() if t.get("style")]
        keys = [k for k in (sts[0][1] if sts else {}) if k != "zones"]
        for k in keys:
            vals = sorted([v[k] for _, v in sts if v.get(k) is not None], reverse=True)
            for a, v in sts:
                v.setdefault("rk", {})[k] = vals.index(v[k]) + 1 if v.get(k) is not None else None
        zl = {}
        for z in ("rim", "smid", "lmid", "c3", "a3"):
            fr = [v["zones"][z][0] for _, v in sts if v["zones"][z][0] is not None]
            pc = [v["zones"][z][1] for _, v in sts if v["zones"][z][1] is not None]
            zl[z] = [round(sum(fr) / len(fr), 3) if fr else None, round(sum(pc) / len(pc), 3) if pc else None]
            frs = sorted(fr, reverse=True)
            for a, v in sts:
                v.setdefault("zrk", {})[z] = frs.index(v["zones"][z][0]) + 1 if v["zones"][z][0] is not None else None
        lg[side] = zl
    if len(teams) < 25:
        sys.exit(f"Only {len(teams)} teams answered; keeping yesterday's lineups")
    doc = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "season": season, "failed": failed,
           "names": names, "teams": teams, "lgZones": lg.get("o")}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    print(f"Wrote {OUT}: {len(teams)} teams ({failed} failed), {sum(len(t['l5']) for t in teams.values())} five-man units, "
          f"{os.path.getsize(OUT) // 1024} KB")


def r1(x):
    return None if x is None else round(x, 1)


if __name__ == "__main__":
    main()
