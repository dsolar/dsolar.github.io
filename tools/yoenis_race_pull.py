#!/usr/bin/env python3
"""Pull the Wipe Yoenis category race from Yahoo into yoenis/race.json.

The league is head-to-head categories, so the page shows three things from this file:
  - each week's matchups, category by category, with who's ahead and by how much
  - the standings week by week (category wins, losses and ties, added up)
  - every team's season totals in each category, ranked
During the season the workflow runs this twice a day, so the current week reads as it stands.
Team names and stats only; no manager names or Yahoo IDs.

  python3 tools/yoenis_race_pull.py [year]     default: this year's league if Yahoo has it, else the last season
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guillotine_update import Yahoo, access_token, text, num, Failure, NotApproved  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "yoenis", "data.json")
OUT = os.path.join(ROOT, "yoenis", "race.json")
RATE = {"AVG", "OPS", "ERA", "WHIP"}


def val(s):
    if s is None or s == "" or s == "-":
        return None
    try:
        return float(s)
    except ValueError:
        return s  # "47/213"


def stat_map(team):
    return {text(st, "stat_id"): val(text(st, "value")) for st in team.findall("team_stats/stats/stat")}


def league_key(y, year, lid):
    g = y.get(f"games;game_codes=mlb;seasons={year}", soft=True)
    gk = text(g.find(".//game"), "game_key") if g is not None and g.find(".//game") is not None else None
    return f"{gk}.l.{lid}" if gk else None


def main():
    data = json.load(open(DATA, encoding="utf-8"))
    y = Yahoo(token=access_token())
    last = data["seasons"][-1]
    key, year = None, None
    if len(sys.argv) > 1:
        year = int(sys.argv[1])
        s = next(s for s in data["seasons"] if s["year"] == year)
        key = league_key(y, year, s["lid"])
    else:
        # Once the league renews, the new season's key is in last season's "renewed" field.
        lk = league_key(y, last["year"], last["lid"])
        meta = y.get(f"league/{lk}/metadata", soft=True)
        renewed = text(meta.find(".//league"), "renewed") if meta is not None else None
        if renewed:
            gk, lid = renewed.split("_")
            nk = f"{gk}.l.{lid}"
            nm = y.get(f"league/{nk}/metadata", soft=True)
            if nm is not None and text(nm.find(".//league"), "draft_status") == "postdraft":
                key, year = nk, int(text(nm.find(".//league"), "season"))
        if not key:
            key, year = lk, last["year"]

    meta = y.get(f"league/{key}/metadata").find(".//league")
    cur = int(num(meta, "current_week") or 1)
    start_w = int(num(meta, "start_week") or 1)
    end_w = int(num(meta, "end_week") or cur)
    finished = text(meta, "is_finished") == "1"
    last_w = end_w if finished else cur

    sn = y.get(f"league/{key}/settings").find(".//settings")
    cats, display = [], {}
    for st in sn.findall("stat_categories/stats/stat"):
        sid, abbr = text(st, "stat_id"), text(st, "display_name") or text(st, "abbr")
        if text(st, "is_only_display_stat") == "1":
            display[abbr] = sid
            continue
        cats.append({"id": sid, "abbr": abbr, "name": text(st, "name"),
                     "side": "b" if text(st, "position_type") == "B" else "p",
                     "low": text(st, "sort_order") == "0", "rate": abbr in RATE})
    ids = [c["id"] for c in cats]
    playoff_w = int(num(sn, "playoff_start_week") or end_w + 1)

    teams, season = {}, {}
    st_root = y.get(f"league/{key}/standings")
    for t in st_root.findall(".//team"):
        tk = text(t, "team_key")
        m = stat_map(t)
        teams[tk] = {"name": text(t, "name"),
                     "rank": int(num(t, "team_standings/rank") or 0) or None,
                     "w": int(num(t, "team_standings/outcome_totals/wins") or 0),
                     "l": int(num(t, "team_standings/outcome_totals/losses") or 0),
                     "t": int(num(t, "team_standings/outcome_totals/ties") or 0)}
        season[tk] = [m.get(i) for i in ids]
        if "H/AB" in display:
            teams[tk]["hab"] = m.get(display["H/AB"])
        if "IP" in display:
            teams[tk]["ip"] = m.get(display["IP"])

    weeks = []
    for w in range(start_w, last_w + 1):
        sb = y.get(f"league/{key}/scoreboard;week={w}", soft=True)
        if sb is None:
            continue
        mus = []
        for mu in sb.findall(".//matchups/matchup"):
            tks, stats, extra = [], {}, {}
            for t in mu.findall("teams/team"):
                tk = text(t, "team_key")
                tks.append(tk)
                m = stat_map(t)
                stats[tk] = [m.get(i) for i in ids]
                extra[tk] = {k: m.get(v) for k, v in display.items()}
            won = {}
            for sw in mu.findall("stat_winners/stat_winner"):
                won[text(sw, "stat_id")] = None if text(sw, "is_tied") == "1" else text(sw, "winner_team_key")
            mus.append({"teams": tks, "stats": stats, "extra": extra,
                        "won": [won.get(i, "") for i in ids],  # "" = not decided yet, None = tied
                        "status": text(mu, "status"), "playoffs": text(mu, "is_playoffs") == "1",
                        "consolation": text(mu, "is_consolation") == "1"})
        weeks.append({"week": w, "start": text(sb.find(".//matchup"), "week_start"),
                      "end": text(sb.find(".//matchup"), "week_end"), "matchups": mus})

    out = {"league": text(meta, "name"), "season": year, "key": key, "current_week": cur, "start_week": start_w,
           "end_week": end_w, "playoff_week": playoff_w, "finished": finished,
           "playoff_teams": int(num(sn, "num_playoff_teams") or 0) or None,
           "cats": cats, "teams": teams, "season_stats": season, "weeks": weeks}
    try:
        old = json.load(open(OUT, encoding="utf-8"))
        if {k: v for k, v in old.items() if k != "updated"} == out:
            print("No change.")
            return
    except (OSError, ValueError):
        pass
    out = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **out}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {OUT}: {year}, weeks {start_w}-{last_w}, {len(cats)} categories.")


if __name__ == "__main__":
    try:
        main()
    except NotApproved:
        print("::error::Yahoo hasn't approved this app for Fantasy data.")
        sys.exit(1)
    except Failure as e:
        print(f"::error::{e}")
        sys.exit(1)
