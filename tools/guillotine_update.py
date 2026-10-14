#!/usr/bin/env python3
"""Pull the Bastille Day guillotine league from Yahoo Fantasy into guillotine/data.json.

The page at davidsolar.dev/guillotine/ reads that file and runs the simulation in the browser.
A GitHub workflow (.github/workflows/guillotine.yml) runs this every morning during the season.

Needs three values, set as GitHub repository secrets (see the README for the one-time setup):
  YAHOO_CLIENT_ID       from the Yahoo developer app
  YAHOO_CLIENT_SECRET   from the Yahoo developer app
  YAHOO_REFRESH_TOKEN   from the one-time sign-in
Optional:
  YAHOO_LEAGUE_ID       defaults to 157731 (Bastille Day)
  YAHOO_REDIRECT_URI    defaults to https://davidsolar.dev/ (must match the Yahoo app)

Standard library only, so it runs anywhere Python 3.8+ does.
  python tools/guillotine_update.py              pull from Yahoo and write guillotine/data.json
  python tools/guillotine_update.py --from DIR   build from saved Yahoo XML responses (for testing)
"""
import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

API = "https://fantasysports.yahooapis.com/fantasy/v2/"
TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
UA = "davidsolar-guillotine/1.0 (+https://davidsolar.dev/guillotine/)"
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "..", "guillotine", "data.json")


# ---------------------------------------------------------------- fetching

class Failure(Exception):
    """A problem worth showing on the GitHub run summary."""


def fail(msg):
    raise Failure(msg)


def access_token():
    cid = os.environ.get("YAHOO_CLIENT_ID", "").strip()
    secret = os.environ.get("YAHOO_CLIENT_SECRET", "").strip()
    refresh = os.environ.get("YAHOO_REFRESH_TOKEN", "").strip()
    if not (cid and secret and refresh):
        fail("Missing YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET or YAHOO_REFRESH_TOKEN.")
    body = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": refresh,
        "redirect_uri": os.environ.get("YAHOO_REDIRECT_URI", "https://davidsolar.dev/"),
    }).encode()
    basic = base64.b64encode(f"{cid}:{secret}".encode()).decode()
    req = urllib.request.Request(TOKEN_URL, data=body, headers={
        "Authorization": f"Basic {basic}",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            tok = json.load(res)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        fail(f"Yahoo sign-in failed (HTTP {e.code}): {detail}. Check the three YAHOO_ secrets; "
             f"if they're right, redo the one-time setup in the README for a fresh refresh token.")
    if tok.get("refresh_token") and tok["refresh_token"] != refresh:
        # Yahoo normally keeps the same refresh token. If it ever rotates it, the stored secret
        # will stop working, so say so in the run log (without printing the token).
        print("::warning::Yahoo issued a new refresh token. If the next run fails to sign in, "
              "redo the one-time setup in the README.")
    return tok["access_token"]


class Yahoo:
    """Fetches from the live API, or from saved files when testing."""

    def __init__(self, token=None, from_dir=None):
        self.token, self.from_dir = token, from_dir
        self.last_error = None

    def get(self, path, soft=False):
        """soft=True: a refusal (400/401/403/404) returns None so the caller can try another route."""
        if self.from_dir:
            name = re.sub(r"[^A-Za-z0-9]+", "_", path).strip("_") + ".xml"
            fp = os.path.join(self.from_dir, name)
            if not os.path.exists(fp):
                return None
            with open(fp, "rb") as f:
                return strip_ns(ET.fromstring(f.read()))
        req = urllib.request.Request(API + path, headers={
            "Authorization": f"Bearer {self.token}", "User-Agent": UA, "Accept": "application/xml"})
        for attempt in (1, 2):
            try:
                with urllib.request.urlopen(req, timeout=30) as res:
                    return strip_ns(ET.fromstring(res.read()))
            except urllib.error.HTTPError as e:
                body = re.sub(r"\s+", " ", e.read().decode(errors="replace"))[:300]
                self.last_error = f"HTTP {e.code} on {path}: {body}"
                print(self.last_error)
                if e.code in (400, 404) or (soft and e.code in (401, 403)):
                    return None
                if attempt == 1 and (e.code in (429, 999) or e.code >= 500):
                    time.sleep(5)
                    continue
                fail(f"Yahoo returned {self.last_error}")


def strip_ns(root):
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def num(el, path):
    if el is None:
        return None
    node = el.find(path)
    if node is None or node.text is None or node.text.strip() == "":
        return None
    try:
        return float(node.text)
    except ValueError:
        return None


def text(el, path):
    node = el.find(path) if el is not None else None
    return node.text.strip() if node is not None and node.text else None


# ---------------------------------------------------------------- building data.json

def week_stats(y, key, week):
    """{team_key: (points, projected)} for one week."""
    out = {}
    root = y.get(f"league/{key}/teams/stats;type=week;week={week}")
    for t in (root.findall(".//team") if root is not None else []):
        out[text(t, "team_key")] = [num(t, "team_points/total"), num(t, "team_projected_points/total")]
    # Some leagues only return projections on the scoreboard, so fill gaps from there.
    if not out or any(v[1] is None for v in out.values()):
        sb = y.get(f"league/{key}/scoreboard;week={week}")
        for t in (sb.findall(".//team") if sb is not None else []):
            k = text(t, "team_key")
            row = out.setdefault(k, [None, None])
            if row[0] is None:
                row[0] = num(t, "team_points/total")
            if row[1] is None:
                row[1] = num(t, "team_projected_points/total")
    return out


def build(y, league_id):
    # League keys need this season's numeric game key (like 461.l.157731), so look it up first.
    league = None
    game = y.get("game/nfl", soft=True)
    game_key = text(game.find(".//game"), "game_key") if game is not None else None
    if game_key:
        key = f"{game_key}.l.{league_id}"
        print(f"This season's NFL game key is {game_key}.")
        league = y.get(f"league/{key}", soft=True)
    if league is None:
        # Otherwise find the league among the signed-in user's own NFL leagues.
        mine = y.get("users;use_login=1/games;game_codes=nfl/leagues", soft=True)
        found = mine.findall(".//league") if mine is not None else []
        print("Your Yahoo NFL leagues: " + (", ".join(
            f"{text(lg, 'name')} ({text(lg, 'league_key')}, {text(lg, 'season')})" for lg in found) or "none returned"))
        for lg in found:
            if text(lg, "league_id") == str(league_id):
                key = text(lg, "league_key")
                league = y.get(f"league/{key}")
                break
    if league is None:
        fail(f"Couldn't read league {league_id}. Last Yahoo response: {y.last_error or 'none'}")
    lg = league.find(".//league")
    name = text(lg, "name") or "Guillotine"
    season = int(num(lg, "season") or datetime.now(timezone.utc).year)
    start = int(num(lg, "start_week") or 1)
    current = int(num(lg, "current_week") or start)
    finished = text(lg, "is_finished") == "1"
    key = text(lg, "league_key") or key

    teams_root = y.get(f"league/{key}/teams")
    if teams_root is None:
        fail(f"Couldn't read the league's teams. Last Yahoo response: {y.last_error or 'none'}")
    teams = []
    for t in teams_root.findall(".//team"):
        teams.append({
            "key": text(t, "team_key"),
            "name": text(t, "name"),
            "faab": num(t, "faab_balance"),
            "mine": text(t, "is_owned_by_current_login") == "1",
            "manager": text(t, "managers/manager/nickname"),
        })
    by_key = {t["key"]: t for t in teams}

    # Final scores for completed weeks, projections for the current one.
    last_done = current if finished else current - 1
    scores = {t["key"]: [] for t in teams}
    for w in range(start, last_done + 1):
        st = week_stats(y, key, w)
        for k in scores:
            pts = st.get(k, [None, None])[0]
            scores[k].append(round(pts, 2) if pts is not None else None)
    proj = {}
    if not finished:
        for k, (pts, pj) in week_stats(y, key, current).items():
            proj[k] = round(pj, 2) if pj is not None else None

    # Guillotine rule: in each completed week, the lowest score among teams still alive is cut.
    alive = [t["key"] for t in teams]
    out_week = {}
    for i, w in enumerate(range(start, last_done + 1)):
        if len(alive) <= 1:
            break
        live = [(scores[k][i], k) for k in alive if scores[k][i] is not None]
        if not live:
            continue
        low = min(live)[1]
        out_week[low] = w
        alive.remove(low)

    rows = []
    for t in teams:
        k = t["key"]
        row = {"name": t["name"]}
        if t["mine"]:
            row["mine"] = True
        if t["manager"] and t["manager"] != "--hidden--":
            row["manager"] = t["manager"]
        if t["faab"] is not None:
            row["faab"] = int(t["faab"])
        if k in out_week:
            row["out"] = out_week[k]
        else:
            row["proj"] = proj.get(k)
        row["scores"] = scores[k]
        rows.append(row)
    rows.sort(key=lambda r: (r.get("out") or 99, r["name"].lower()), reverse=False)

    return {
        "league": name,
        "season": season,
        "week": current if not finished else last_done + 1,
        "first_week": start,
        "total_teams": len(teams),
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Yahoo Fantasy",
        "teams": rows,
    }


def write_if_changed(data, path):
    """Skip the write when nothing but the timestamp changed, so the workflow makes no empty commits."""
    path = os.path.abspath(path)
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                old = json.load(f)
            if {k: v for k, v in old.items() if k != "updated"} == {k: v for k, v in data.items() if k != "updated"}:
                print("No change in league data.")
                return False
        except (ValueError, OSError):
            pass
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    alive = sum(1 for t in data["teams"] if "out" not in t)
    print(f"Wrote {path}: {data['league']} week {data['week']}, {alive} of {data['total_teams']} teams alive.")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--from", dest="from_dir", help="build from saved XML files instead of the API")
    a = ap.parse_args()
    league_id = os.environ.get("YAHOO_LEAGUE_ID", "157731").strip()
    try:
        y = Yahoo(from_dir=a.from_dir) if a.from_dir else Yahoo(token=access_token())
        write_if_changed(build(y, league_id), a.out)
    except Failure as e:
        # "::error::" puts the message on the GitHub run summary page.
        print(f"::error::{e}")
        sys.exit(1)
    except Exception as e:
        print(f"::error::Unexpected {type(e).__name__}: {e}")
        raise


if __name__ == "__main__":
    main()
