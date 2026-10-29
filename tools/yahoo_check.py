#!/usr/bin/env python3
"""Check what the Yahoo app can read, and write the answer to tools/yahoo_leagues.json.

Uses the same three YAHOO_ secrets as tools/guillotine_update.py. Lists every NFL and MLB league on the
signed-in account, every season, then tries the calls the site's pages would use on the two leagues
that matter: Bastille Day (guillotine) and Don't Forget to Wipe Yoenis (keeper baseball). Only league
names, keys, settings and pass/fail results are written: no manager names, emails or Yahoo IDs.

Run by the "Yahoo check" workflow (Actions tab > Yahoo check > Run workflow).
  python3 tools/yahoo_check.py
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guillotine_update import Yahoo, access_token, text, NotApproved, Failure  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "yahoo_leagues.json")
WATCH = {"nfl": "Bastille Day", "mlb": "Wipe Yoenis"}


def league_row(lg, code):
    return {
        "code": code,
        "season": text(lg, "season"),
        "key": text(lg, "league_key"),
        "name": text(lg, "name"),
        "teams": text(lg, "num_teams"),
        "scoring": text(lg, "scoring_type"),
        "draft_status": text(lg, "draft_status"),
        "finished": text(lg, "is_finished") == "1",
        "current_week": text(lg, "current_week"),
        "renew": text(lg, "renew"),      # last season's league, as "gamekey_leagueid"
        "renewed": text(lg, "renewed"),  # next season's league, once the commissioner renews
    }


def probe(y, path):
    """Try one call; report ok and a rough count of what came back."""
    y.last_error = None
    root = y.get(path, soft=True)
    if root is None:
        return {"ok": False, "error": (y.last_error or "no data")[:160]}
    counts = {tag: len(root.findall(f".//{tag}")) for tag in ("team", "pick", "transaction", "player", "matchup")}
    return {"ok": True, **{k: v for k, v in counts.items() if v}}


def main():
    y = Yahoo(token=access_token())
    seen, leagues = set(), []
    years = ",".join(str(s) for s in range(2010, datetime.now().year + 2))
    for code in ("nfl", "mlb"):
        # The plain call may return only the current season; asking by season gets the rest.
        for path in (f"users;use_login=1/games;game_codes={code}/leagues",
                     f"users;use_login=1/games;game_codes={code};seasons={years}/leagues"):
            root = y.get(path, soft=True)
            for lg in (root.findall(".//league") if root is not None else []):
                row = league_row(lg, code)
                if row["key"] not in seen:
                    seen.add(row["key"])
                    leagues.append(row)
    leagues.sort(key=lambda r: (r["code"], r["season"] or "", r["name"] or ""))

    checks = {}
    for code, needle in WATCH.items():
        mine = [r for r in leagues if r["code"] == code and needle.lower() in (r["name"] or "").lower()]
        if not mine:
            checks[needle] = {"found": False}
            continue
        latest = mine[-1]
        key = latest["key"]
        calls = {
            "settings": f"league/{key}/settings",
            "standings": f"league/{key}/standings",
            "scoreboard": f"league/{key}/scoreboard",
            "draft results": f"league/{key}/draftresults",
            "transactions": f"league/{key}/transactions",
            "trades": f"league/{key}/transactions;types=trade",
            "keepers (team 1)": f"team/{key}.t.1/roster/players;status=K",
        }
        checks[needle] = {
            "found": True,
            "latest": key,
            "seasons": [r["season"] for r in mine],
            "calls": {name: probe(y, path) for name, path in calls.items()},
        }
        # Oldest season too, to confirm history is reachable.
        oldest = mine[0]["key"]
        if oldest != key:
            checks[needle]["oldest"] = oldest
            checks[needle]["oldest draft results"] = probe(y, f"league/{oldest}/draftresults")

    out = {
        "checked": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "leagues": leagues,
        "checks": checks,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"Wrote {OUT}: {len(leagues)} leagues.")


if __name__ == "__main__":
    try:
        main()
    except NotApproved:
        print("::error::Yahoo hasn't approved this app for Fantasy data.")
        sys.exit(1)
    except Failure as e:
        print(f"::error::{e}")
        sys.exit(1)
