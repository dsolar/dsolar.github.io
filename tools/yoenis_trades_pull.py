#!/usr/bin/env python3
"""Pull every Wipe Yoenis trade since 2013 from Yahoo into tools/yahoo_yoenis/trades.json.

For each season in yoenis/data.json: the league's dates, its team names (by Yahoo team key) and every trade
transaction, with the players (and any draft picks) that moved and which way. Team and player names only.
Writes the file only when something changed. Run by the "Wipe Yoenis Yahoo pull" workflow, or:
  python3 tools/yoenis_trades_pull.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guillotine_update import Yahoo, access_token, text, num, Failure, NotApproved  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "yoenis", "data.json")
OUT = os.path.join(ROOT, "tools", "yahoo_yoenis", "trades.json")


def main():
    data = json.load(open(DATA, encoding="utf-8"))
    y = Yahoo(token=access_token())
    out = {}
    for s in data["seasons"]:
        year = s["year"]
        g = y.get(f"games;game_codes=mlb;seasons={year}", soft=True)
        gk = text(g.find(".//game"), "game_key") if g is not None and g.find(".//game") is not None else None
        if not gk:
            print(f"::warning::No Yahoo game for {year}.")
            continue
        key = f"{gk}.l.{s['lid']}"
        meta = y.get(f"league/{key}/metadata", soft=True)
        lg = meta.find(".//league") if meta is not None else None
        teams = {}
        st = y.get(f"league/{key}/teams", soft=True)
        for t in (st.findall(".//team") if st is not None else []):
            teams[text(t, "team_key")] = text(t, "name")
        trades = []
        root = y.get(f"league/{key}/transactions;types=trade", soft=True)
        for t in (root.findall(".//transactions/transaction") if root is not None else []):
            players = []
            for pl in t.findall(".//players/player"):
                td = pl.find("transaction_data")
                players.append({"name": text(pl, "name/full"), "pos": text(pl, "display_position"),
                                "from": text(td, "source_team_key"), "to": text(td, "destination_team_key")})
            picks = []
            for pk in t.findall(".//picks/pick"):
                picks.append({"round": int(num(pk, "round") or 0), "from": text(pk, "source_team_key"),
                              "to": text(pk, "destination_team_key"), "orig": text(pk, "original_team_key")})
            trades.append({"id": text(t, "transaction_id"), "status": text(t, "status"), "ts": int(num(t, "timestamp") or 0),
                           "a": text(t, "trader_team_key"), "b": text(t, "tradee_team_key"),
                           "players": players, "picks": picks})
        trades.sort(key=lambda t: t["ts"])
        out[str(year)] = {"key": key, "start": text(lg, "start_date"), "end": text(lg, "end_date"),
                          "teams": teams, "trades": trades}
        print(f"{year}: {len(trades)} trades")
    try:
        if json.load(open(OUT, encoding="utf-8")) == out:
            print("No change.")
            return
    except (OSError, ValueError):
        pass
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"Wrote {OUT}.")


if __name__ == "__main__":
    try:
        main()
    except NotApproved:
        print("::error::Yahoo hasn't approved this app for Fantasy data.")
        sys.exit(1)
    except Failure as e:
        print(f"::error::{e}")
        sys.exit(1)
