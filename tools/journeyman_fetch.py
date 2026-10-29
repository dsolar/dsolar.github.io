"""Downloads everything tools/journeyman_build.py needs into one folder (about 400 MB of downloads, a few minutes).

  python3 tools/journeyman_fetch.py DIR      then      python3 tools/journeyman_build.py --src DIR

  NBA  basketball-reference datasets (github.com/sumitrodatta/bball-reference-datasets)
  NFL  nflverse: season rosters 1990-2001, weekly rosters from 2002, draft picks and the player list
  MLB  the Lahman database from the Lahman R package (github.com/cdalzell/Lahman), read with pyreadr
       (pip install pyreadr). Its data/*.RData files are the newest copy on GitHub.
"""
import csv, io, os, subprocess, sys, tempfile, urllib.parse, urllib.request
from datetime import date

BBREF = "https://raw.githubusercontent.com/sumitrodatta/bball-reference-datasets/master/Data/"
BBREF_FILES = ["Player Season Info.csv", "Player Career Info.csv", "Advanced.csv", "Player Totals.csv",
               "All-Star Selections.csv", "Draft Pick History.csv", "Team Abbrev.csv"]
NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download/"
LAHMAN_TABLES = ["Batting", "Pitching", "People", "AllstarFull", "Teams", "Appearances"]


def get(url):
    with urllib.request.urlopen(url, timeout=600) as r:
        return r.read()


def main(out):
    os.makedirs(os.path.join(out, "mlb"), exist_ok=True)
    for f in BBREF_FILES:
        open(os.path.join(out, f), "wb").write(get(BBREF + urllib.parse.quote(f)))
        print("NBA", f)
    open(os.path.join(out, "nfl_draft_picks.csv"), "wb").write(get(NFLVERSE + "draft_picks/draft_picks.csv"))
    open(os.path.join(out, "nfl_players.csv"), "wb").write(get(NFLVERSE + "players/players.csv"))
    rows = []
    for y in range(1990, date.today().year + 1):
        weekly = y >= 2002
        url = NFLVERSE + (f"weekly_rosters/roster_weekly_{y}.csv" if weekly else f"rosters/roster_{y}.csv")
        try:
            text = get(url).decode("utf-8", "replace")
        except Exception:
            print("NFL", y, "not available yet"); continue
        for r in csv.DictReader(io.StringIO(text)):
            if weekly and (r.get("game_type") != "REG" or r.get("status") not in ("ACT", "RES", "INA")):
                continue
            rows.append([y, int(r.get("week") or 0) if weekly else 0, r.get("team"), r.get("gsis_id") or "", r.get("pfr_id") or "",
                         r.get("full_name"), r.get("position"), r.get("college") or "", r.get("status") or ""])
        print("NFL", y, len(rows))
    with open(os.path.join(out, "nfl_paths.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["season", "week", "team", "gsis_id", "pfr_id", "name", "position", "college", "status"])
        w.writerows(rows)
    import pyreadr   # pip install pyreadr
    repo = tempfile.mkdtemp(prefix="lahman-")
    subprocess.run(["git", "clone", "-q", "--depth", "1", "https://github.com/cdalzell/Lahman", repo], check=True)
    for t in LAHMAN_TABLES:
        df = list(pyreadr.read_r(os.path.join(repo, "data", t + ".RData")).values())[0]
        df.to_csv(os.path.join(out, "mlb", t + ".csv"), index=False)
        print("MLB", t, df.shape)


if __name__ == "__main__":
    main(sys.argv[1])
