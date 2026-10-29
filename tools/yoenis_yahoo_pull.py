#!/usr/bin/env python3
"""Pull one Wipe Yoenis season from Yahoo into tools/yahoo_yoenis/<year>.json, for the keeper checks.

Saves what tools/yoenis_keeper_check.py needs and nothing personal: the draft, every team's final roster,
and every transaction with its date and where each player came from (free agents, waivers or a team).
Team names, player names and Yahoo keys only; no manager names, emails or Yahoo IDs.

Uses the same three YAHOO_ secrets as tools/guillotine_update.py. Run by the "Wipe Yoenis Yahoo pull"
workflow (Actions tab), or:
  python3 tools/yoenis_yahoo_pull.py [year]      default: the last season in yoenis/data.json
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guillotine_update import Yahoo, access_token, text, num, Failure, NotApproved  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "yoenis", "data.json")
OUT_DIR = os.path.join(ROOT, "tools", "yahoo_yoenis")


def player_row(p):
    row = {
        "key": text(p, "player_key"),
        "name": text(p, "name/full"),
        "pos": text(p, "display_position"),
        "mlb": (text(p, "editorial_team_abbr") or "").upper(),
    }
    kp = p.find("is_keeper")
    if kp is not None:  # only in leagues that use Yahoo's keeper feature
        row["yk"] = {c.tag: (c.text or "").strip() for c in kp}
    return row


def game_key(y, year):
    root = y.get(f"games;game_codes=mlb;seasons={year}")
    k = text(root.find(".//game"), "game_key") if root is not None and root.find(".//game") is not None else None
    if not k:
        raise Failure(f"Yahoo has no MLB game for {year}.")
    return k


def main():
    data = json.load(open(DATA, encoding="utf-8"))
    year = int(sys.argv[1]) if len(sys.argv) > 1 else data["seasons"][-1]["year"]
    season = next(s for s in data["seasons"] if s["year"] == year)
    y = Yahoo(token=access_token())
    key = f"{game_key(y, year)}.l.{season['lid']}"

    meta = y.get(f"league/{key}/metadata")
    end = text(meta.find(".//league"), "end_date")
    name = text(meta.find(".//league"), "name")
    start = text(meta.find(".//league"), "start_date")

    # League rules that bear on keepers: waivers, draft time, trade deadline, Yahoo's keeper setting
    st_root = y.get(f"league/{key}/settings")
    sn = st_root.find(".//settings")
    settings = {tag: text(sn, tag) for tag in (
        "draft_type", "draft_time", "waiver_type", "waiver_rule", "waiver_time", "uses_faab",
        "trade_end_date", "trade_reject_time", "uses_playoff", "max_teams", "post_draft_players",
        "max_adds", "uses_keeper", "num_keepers", "keeper_deadline_date") if sn is not None}

    teams = {}
    st = y.get(f"league/{key}/standings")
    for t in st.findall(".//team"):
        teams[text(t, "team_key")] = {"name": text(t, "name"), "rank": text(t, "team_standings/rank")}

    # Draft, with names (draft results only carry player keys)
    picks = []
    dr = y.get(f"league/{key}/draftresults")
    for p in dr.findall(".//draft_result"):
        picks.append({"pick": int(num(p, "pick") or 0), "round": int(num(p, "round") or 0),
                      "team": text(p, "team_key"), "player": text(p, "player_key")})
    names = {}
    keys = [p["player"] for p in picks if p["player"]]
    for i in range(0, len(keys), 25):
        root = y.get(f"league/{key}/players;player_keys={','.join(keys[i:i + 25])}")
        for pl in root.findall(".//player"):
            names[text(pl, "player_key")] = player_row(pl)
    for p in picks:
        p.update({k: v for k, v in names.get(p["player"], {}).items() if k in ("name", "pos", "mlb")})

    # Final rosters
    rosters = {}
    for tk in teams:
        root = y.get(f"team/{tk}/roster;date={end}")
        rows = []
        for pl in root.findall(".//roster/players/player"):
            r = player_row(pl)
            r["slot"] = text(pl, "selected_position/position")
            rows.append(r)
        rosters[tk] = rows

    # Every transaction, oldest first (Yahoo returns the whole season in one call).
    tx = []
    root = y.get(f"league/{key}/transactions")
    for t in (root.findall(".//transactions/transaction") if root is not None else []):
        moves = []
        for pl in t.findall(".//players/player"):
            td = pl.find("transaction_data")
            moves.append({
                "player": text(pl, "player_key"),
                "name": text(pl, "name/full"),
                "pos": text(pl, "display_position"),
                "type": text(td, "type"),
                "from": text(td, "source_type"),
                "from_team": text(td, "source_team_key"),
                "to": text(td, "destination_type"),
                "to_team": text(td, "destination_team_key"),
            })
        tx.append({"id": text(t, "transaction_id"), "type": text(t, "type"), "status": text(t, "status"),
                   "ts": int(num(t, "timestamp") or 0), "moves": moves})
    tx.sort(key=lambda t: (t["ts"], int(t["id"] or 0)))

    out = {
        "league": name, "key": key, "season": year, "start": start, "end": end, "settings": settings,
        "pulled": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "teams": teams, "draft": picks, "rosters": rosters, "transactions": tx,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{year}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"Wrote {path}: {len(picks)} picks, {sum(map(len, rosters.values()))} rostered, {len(tx)} transactions.")


if __name__ == "__main__":
    try:
        main()
    except NotApproved:
        print("::error::Yahoo hasn't approved this app for Fantasy data.")
        sys.exit(1)
    except Failure as e:
        print(f"::error::{e}")
        sys.exit(1)
