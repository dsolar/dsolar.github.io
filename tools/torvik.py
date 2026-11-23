#!/usr/bin/env python3
"""Publish Bart Torvik's T-Rank for the CBB Hub from the latest browser drop (tools/torvik_pull.js -> Supabase).

Writes cbb/data/torvik.json (today's ratings, keyed by the hub's team ids) and merges the daily archive into
cbb/data/torvik_hist.json (ratings as of each morning; the hub uses it to test and blend Torvik's numbers fairly).
Team names are matched to the hub's by name, with a few fixed spellings; anything unmatched is listed in the file and
the log rather than guessed.
"""
import json
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RPC = "https://baxrczyufqbzrogftmyn.supabase.co/rest/v1/rpc/torvik_get"
KEY = "sb_publishable_brDXGevzcoI7mBaPO7Plow_yaUy4gk4"   # the site's public key; torvik_get only returns the latest drop
OUT, HIST = ROOT / "cbb/data/torvik.json", ROOT / "cbb/data/torvik_hist.json"
KEEP_DAYS = 150
# Torvik spelling -> the hub's short name, where the two don't line up on their own
FIX = {
    "connecticut": "uconn", "miami fl": "miami", "miami oh": "miami oh", "nc state": "nc state", "n c state": "nc state",
    "mississippi": "ole miss", "louisiana lafayette": "louisiana", "louisiana monroe": "ul monroe", "umass lowell": "umass lowell",
    "texas a and m corpus chris": "texas a and m corpus christi", "southeast missouri state": "southeast missouri", "se missouri state": "southeast missouri",
    "cal state bakersfield": "cal state bakersfield", "tennessee martin": "ut martin", "arkansas pine bluff": "arkansas pine bluff",
    "illinois chicago": "uic", "detroit": "detroit mercy", "fiu": "fiu", "liu": "long island university", "liu brooklyn": "long island university",
    "saint francis": "saint francis", "st francis pa": "saint francis", "loyola md": "loyola maryland", "loyola chicago": "loyola chicago",
    "albany": "ualbany", "nebraska omaha": "omaha", "purdue fort wayne": "purdue fort wayne", "iu indy": "iu indianapolis",
    "texas rio grande valley": "ut rio grande valley", "louisiana tech": "louisiana tech", "usc upstate": "south carolina upstate",
    "southeastern louisiana": "se louisiana", "mcneese state": "mcneese", "nicholls state": "nicholls", "grambling state": "grambling",
    "bethune cookman": "bethune cookman", "sam houston state": "sam houston", "kansas city": "kansas city", "queens": "queens university",
    "east texas a and m": "east texas a and m", "seattle": "seattle u", "southern miss": "southern miss", "app state": "app state", "appalachian state": "app state",
    "md eastern shore": "maryland eastern shore", "the citadel": "the citadel", "citadel": "the citadel", "gardner webb": "gardner webb",
    "central connecticut": "central connecticut", "cal baptist": "california baptist", "csun": "cal state northridge", "cal state northridge": "cal state northridge",
    "ut arlington": "ut arlington", "texas arlington": "ut arlington", "utsa": "utsa", "texas san antonio": "utsa", "fgcu": "florida gulf coast",
    "saint mary s": "saint marys", "st mary s": "saint marys", "mount st mary s": "mount st marys", "st john s": "st johns", "saint peter s": "saint peters",
    "st thomas": "st thomas mn", "hawaii": "hawaii", "southern": "southern", "alabama state": "alabama state",
}


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ").replace("'", " ").replace(".", " ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\bst$", "state", s)                 # "iowa st" -> "iowa state"
    s = re.sub(r"\bst (?=[a-z])(?!john|mary|peter|thomas|francis|joseph|bonaventure|louis)", "state ", s) if s.startswith("st ") is False else s
    return s


def keys(t):
    out = {norm(t.get("short")), norm(t.get("haslamName")), norm(t.get("abbr"))}
    name = norm(t.get("name"))
    out.add(name)
    parts = name.split()
    for k in (1, 2, 3):                               # the school name without the mascot
        if len(parts) > k:
            out.add(" ".join(parts[:-k]))
    return {k for k in out if k}


def main():
    req = urllib.request.Request(RPC, data=b"{}", method="POST", headers={"apikey": KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        drop = json.load(r)
    if not drop or not drop.get("body"):
        sys.exit("No Torvik drop in Supabase yet.")
    body = drop["body"]
    hub = json.loads((ROOT / "cbb/data/hub.json").read_text())
    by_key = {}
    for t in hub["teams"]:
        for k in keys(t):
            by_key.setdefault(k, set()).add(t["id"])
    shorts = {norm(t.get("short")): t["id"] for t in hub["teams"]}

    def match(name):
        n = norm(name)
        if n in FIX and norm(FIX[n]) in shorts:
            return shorts[norm(FIX[n])]
        ids = by_key.get(n) or by_key.get(norm(FIX.get(n, "")))
        return next(iter(ids)) if ids and len(ids) == 1 else None

    teams, unmatched, used = {}, [], {}
    for row in body["cur"]:
        name, conf, o, d, t, b, rank, rec = row
        tid = match(name)
        if not tid or tid in used:
            unmatched.append(name + (" (also " + used[tid] + ")" if tid in used else ""))
            continue
        used[tid] = name
        teams[tid] = [rank, o, d, t, b]
    hist = {}
    try:
        hist = json.loads(HIST.read_text())
    except Exception:
        pass
    names = {v: k for k, v in used.items()}
    for day, rows in (body.get("hist") or {}).items():
        hist[day] = {used_id: [o, d, t] for nm, o, d, t in rows for used_id in [match(nm)] if used_id}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).strftime("%Y%m%d")
    hist = {k: v for k, v in sorted(hist.items()) if k >= cutoff}
    OUT.write_text(json.dumps({"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "pulled": body.get("pulled"),
                               "season": body.get("season"), "cols": ["rank", "adjoe", "adjde", "adjt", "barthag"],
                               "teams": teams, "unmatched": unmatched}, separators=(",", ":")))
    HIST.write_text(json.dumps(hist, separators=(",", ":")))
    print("matched %d of %d teams; archive days %d (%s to %s)" % (len(teams), len(body["cur"]), len(hist), min(hist) if hist else "-", max(hist) if hist else "-"))
    if unmatched:
        print("unmatched:", "; ".join(unmatched))
    if len(teams) < 300:
        sys.exit("too few teams matched")


if __name__ == "__main__":
    main()
