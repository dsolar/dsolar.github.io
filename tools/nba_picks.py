#!/usr/bin/env python3
"""Rebuild the NBA pick ledger (tools/draft_future.json, "nba") from RealGM's detailed future-picks page.

RealGM refuses cloud servers, so tools/nba_picks_pull.js runs in a browser on that page and drops its 30 team tables in
Supabase (nba_picks_put). This reads the latest drop, saves it as tools/nba_picks_raw.json, and (with --build) parses it.
  python3 tools/nba_picks.py            fetch the latest drop into tools/nba_picks_raw.json
  python3 tools/nba_picks.py --build    parse tools/nba_picks_raw.json into the ledger (no network)
"""
import json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "tools", "nba_picks_raw.json")
RPC = "https://baxrczyufqbzrogftmyn.supabase.co/rest/v1/rpc/nba_picks_get"
KEY = "sb_publishable_brDXGevzcoI7mBaPO7Plow_yaUy4gk4"   # the site's public key; nba_picks_get only returns the latest drop


def fetch():
    req = urllib.request.Request(RPC, data=b"{}", headers={"apikey": KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        drop = json.load(r)
    if not drop or not drop.get("body") or len(drop["body"].get("teams", {})) != 30:
        sys.exit("No usable RealGM drop in Supabase.")
    body = drop["body"]
    old = json.load(open(RAW)) if os.path.exists(RAW) else {}
    if old.get("teams") == body["teams"]:
        print("RealGM picks unchanged since %s." % old.get("pulled")); return False
    json.dump(body, open(RAW, "w"), indent=1, ensure_ascii=False)
    print("Saved RealGM picks pulled %s." % body.get("pulled")); return True


if __name__ == "__main__":
    if "--build" in sys.argv:
        import nba_picks_parse
        nba_picks_parse.main()
    else:
        fetch()
