#!/usr/bin/env python3
"""Pulls the NHL hub's data into trimmed snapshots in tools/nhl_hub/.

  NHL's own API (api-web.nhle.com): standings, every team's roster, season stats and schedule.
  MoneyPuck.com's public season files (moneypuck.com/data.htm): skaters, goalies, teams and lines, for this season and
  the two before it. MoneyPuck's data is free for non-commercial use with credit; the hub credits it on every page.

Each part keeps its last good snapshot if a pull fails, so the build still runs. Run by .github/workflows/nhl-hub.yml.
"""
import csv
import io
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "nhl_hub")
UA = "davidsolar-nhlhub/1.0 (+https://davidsolar.dev/nhl/)"
API = "https://api-web.nhle.com/v1"
MP = "https://moneypuck.com/moneypuck/playerData/seasonSummary"

# MoneyPuck labels a season by the year it starts: 2026 is 2026-27
SEASON = int(os.environ.get("NHL_SEASON", "2026"))
MP_SEASONS = [SEASON, SEASON - 1, SEASON - 2]
SITUATIONS = {"all", "5on5", "5on4", "4on5"}

SKATER_COLS = [
    "playerId", "name", "team", "position", "situation", "games_played", "icetime", "timeOnBench", "gameScore",
    "I_F_xGoals", "I_F_goals", "I_F_primaryAssists", "I_F_secondaryAssists", "I_F_points", "I_F_shotsOnGoal",
    "I_F_shotAttempts", "I_F_hits", "I_F_takeaways", "I_F_giveaways", "I_F_highDangerShots", "I_F_highDangerGoals",
    "shotsBlockedByPlayer", "penalties", "penaltiesDrawn", "faceoffsWon", "faceoffsLost",
    "OnIce_F_xGoals", "OnIce_A_xGoals", "OnIce_F_goals", "OnIce_A_goals",
    "OnIce_F_flurryScoreVenueAdjustedxGoals", "OnIce_A_flurryScoreVenueAdjustedxGoals",
    "OffIce_F_xGoals", "OffIce_A_xGoals", "OnIce_F_shotAttempts", "OnIce_A_shotAttempts",
    "I_F_oZoneShiftStarts", "I_F_dZoneShiftStarts", "I_F_neutralZoneShiftStarts",
]
GOALIE_COLS = [
    "playerId", "name", "team", "position", "situation", "games_played", "icetime", "xGoals", "goals", "ongoal",
    "unblocked_shot_attempts", "highDangerShots", "highDangerGoals", "highDangerxGoals", "flurryAdjustedxGoals",
]
TEAM_COLS = [
    "team", "situation", "games_played", "iceTime", "xGoalsFor", "xGoalsAgainst", "goalsFor", "goalsAgainst",
    "flurryScoreVenueAdjustedxGoalsFor", "flurryScoreVenueAdjustedxGoalsAgainst", "shotAttemptsFor",
    "shotAttemptsAgainst", "penaltiesFor", "penaltiesAgainst", "shotsOnGoalFor", "shotsOnGoalAgainst",
]
LINE_COLS = [
    "lineId", "name", "team", "position", "situation", "games_played", "icetime", "xGoalsFor", "xGoalsAgainst",
    "goalsFor", "goalsAgainst", "shotAttemptsFor", "shotAttemptsAgainst",
]


def get(url, accept="application/json", tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise
            print(f"  retry {url}: {e}", file=sys.stderr)
            time.sleep(3 * (i + 1))


def getj(url):
    return json.loads(get(url))


def num(v):
    try:
        f = float(v)
        return int(f) if f == int(f) and abs(f) < 1e12 else round(f, 3)
    except (TypeError, ValueError):
        return v


def save(name, data):
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(OUT, name + ".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp, os.path.join(OUT, name))
    print(f"  wrote {name} ({os.path.getsize(os.path.join(OUT, name)) // 1024} KB)")


def text(x):
    return (x or {}).get("default") if isinstance(x, dict) else x


# ---------- NHL API ----------
def pull_standings():
    d = getj(API + "/standings/now")
    keep = ["conferenceAbbrev", "conferenceName", "divisionAbbrev", "divisionName", "gamesPlayed", "wins", "losses",
            "otLosses", "points", "pointPctg", "regulationWins", "regulationPlusOtWins", "goalFor", "goalAgainst",
            "homeWins", "homeLosses", "homeOtLosses", "roadWins", "roadLosses", "roadOtLosses", "l10Wins",
            "l10Losses", "l10OtLosses", "streakCode", "streakCount", "shootoutWins", "shootoutLosses", "date"]
    teams = []
    for r in d.get("standings", []):
        t = {k: r.get(k) for k in keep}
        t.update(abbr=text(r.get("teamAbbrev")), name=text(r.get("teamName")), common=text(r.get("teamCommonName")),
                 place=text(r.get("placeName")), logo=r.get("teamLogo"), logoDark=r.get("teamLogoDark"))
        teams.append(t)
    if len(teams) < 30:
        raise RuntimeError(f"only {len(teams)} teams in the standings")
    save("standings.json", {"pulled": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "teams": teams})
    return [t["abbr"] for t in teams]


def person(p):
    return {"id": p.get("id"), "first": text(p.get("firstName")), "last": text(p.get("lastName")),
            "num": p.get("sweaterNumber"), "pos": p.get("positionCode"), "shoots": p.get("shootsCatches"),
            "born": p.get("birthDate"), "country": p.get("birthCountry"), "ht": p.get("heightInInches"),
            "wt": p.get("weightInPounds"), "head": p.get("headshot")}


def pull_teams(abbrs):
    rosters, stats, games = {}, {}, {}
    for a in abbrs:
        try:
            r = getj(f"{API}/roster/{a}/current")
            rosters[a] = {k: [person(p) for p in r.get(k, [])] for k in ("forwards", "defensemen", "goalies")}
        except Exception as e:  # noqa: BLE001
            print(f"  roster {a}: {e}", file=sys.stderr)
        try:
            s = getj(f"{API}/club-stats/{a}/now")
            stats[a] = {
                "skaters": [{"id": p.get("playerId"), "first": text(p.get("firstName")), "last": text(p.get("lastName")),
                             "pos": p.get("positionCode"), "gp": p.get("gamesPlayed"), "g": p.get("goals"),
                             "a": p.get("assists"), "pts": p.get("points"), "pm": p.get("plusMinus"),
                             "pim": p.get("penaltyMinutes"), "ppg": p.get("powerPlayGoals"), "shg": p.get("shorthandedGoals"),
                             "gwg": p.get("gameWinningGoals"), "sog": p.get("shots"), "toi": p.get("avgTimeOnIcePerGame"),
                             "fo": p.get("faceoffWinPctg"), "head": p.get("headshot")} for p in s.get("skaters", [])],
                "goalies": [{"id": p.get("playerId"), "first": text(p.get("firstName")), "last": text(p.get("lastName")),
                             "gp": p.get("gamesPlayed"), "gs": p.get("gamesStarted"), "w": p.get("wins"),
                             "l": p.get("losses"), "otl": p.get("overtimeLosses"), "gaa": p.get("goalsAgainstAverage"),
                             "sv": p.get("savePercentage"), "sa": p.get("shotsAgainst"), "ga": p.get("goalsAgainst"),
                             "so": p.get("shutouts"), "toi": p.get("timeOnIce"), "head": p.get("headshot")}
                            for p in s.get("goalies", [])],
            }
        except Exception as e:  # noqa: BLE001
            print(f"  club-stats {a}: {e}", file=sys.stderr)
        try:
            sc = getj(f"{API}/club-schedule-season/{a}/now")
            for g in sc.get("games", []):
                if g.get("gameType") != 2 or g["id"] in games:
                    continue
                games[g["id"]] = {
                    "id": g["id"], "date": g.get("gameDate"), "state": g.get("gameState"),
                    "home": g["homeTeam"]["abbrev"], "away": g["awayTeam"]["abbrev"],
                    "hs": g["homeTeam"].get("score"), "as": g["awayTeam"].get("score"),
                    "end": (g.get("gameOutcome") or {}).get("lastPeriodType"),
                }
        except Exception as e:  # noqa: BLE001
            print(f"  schedule {a}: {e}", file=sys.stderr)
        time.sleep(0.25)
    if len(rosters) >= 30:
        save("rosters.json", rosters)
    if len(stats) >= 30:
        save("clubstats.json", stats)
    if len(games) > 1000:
        save("schedule.json", sorted(games.values(), key=lambda g: (g["date"], g["id"])))


# ---------- MoneyPuck ----------
def pull_mp(kind, season, cols, situations=SITUATIONS):
    body = get(f"{MP}/{season}/regular/{kind}.csv", "text/csv")
    rows = list(csv.DictReader(io.StringIO(body)))
    if not rows:
        raise RuntimeError("empty file")
    have = [c for c in cols if c in rows[0]]
    out = [[num(r.get(c)) if c not in ("name", "team", "position", "situation", "lineId", "playerId") else r.get(c)
            for c in have] for r in rows if r.get("situation") in situations]
    save(f"mp_{kind}_{season}.json", {"season": season, "cols": have, "rows": out})


def main():
    parts = sys.argv[1:] or ["nhl", "mp"]
    failed = []
    if "nhl" in parts:
        try:
            abbrs = pull_standings()
            pull_teams(abbrs)
        except Exception as e:  # noqa: BLE001
            failed.append(f"nhl: {e}")
    if "mp" in parts:
        for season in MP_SEASONS:
            for kind, cols in (("skaters", SKATER_COLS), ("goalies", GOALIE_COLS), ("teams", TEAM_COLS)):
                try:
                    pull_mp(kind, season, cols)
                except Exception as e:  # noqa: BLE001
                    failed.append(f"mp {kind} {season}: {e}")
                time.sleep(1)
        try:
            pull_mp("lines", SEASON, LINE_COLS, {"5on5", "5on4"})
        except Exception as e:  # noqa: BLE001
            failed.append(f"mp lines: {e}")
    for f in failed:
        print("FAILED", f, file=sys.stderr)
    if failed and len(failed) >= 5:
        sys.exit(1)


if __name__ == "__main__":
    main()
