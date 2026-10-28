"""Builds guess-the-pick/data.js: every pick in Guess the Pick, for the last 20 NBA and NFL drafts.

Run it from the repo root:  python3 tools/guess_the_pick_build.py
It downloads the source files each time (a few MB), or pass --src DIR to reuse ones already downloaded.

Sources
  NFL  nflverse draft_picks.csv: every pick with team, position, college, Pro Bowls, All-Pros and
       Pro Football Reference's approximate value. https://github.com/nflverse/nflverse-data
  NBA  sumitrodatta/bball-reference-datasets: basketball-reference's draft history, season-by-season
       teams, advanced stats, All-Star and All-NBA selections and awards.
       https://github.com/sumitrodatta/bball-reference-datasets
       The 2026 NBA first round isn't in it yet, so tools/guess_the_pick_2026_nba.json fills it in.

Who's in
  Every first-round pick, plus later picks who turned out to matter:
    NBA  an All-Star, All-NBA or Rookie of the Year, or 30+ career win shares (Jokic, Draymond, Brogdon)
    NFL  a Hall of Famer, an All-Pro, 3+ Pro Bowls, or 60+ weighted approximate value (Kelce, Antonio Brown),
         plus the names in EXTRA_NFL below
  To add someone the rules miss, put "SEASON-OVERALL" in EXTRA_NBA or EXTRA_NFL.

"Went to"
  NBA: the team a player first suited up for, when it isn't the team that picked him (Luka Doncic:
  picked by Atlanta, went to Dallas). The NFL hasn't had a drafted player traded on draft night since 2004,
  so NFL picks only carry the drafting team.

Names (names.js)
  The guess box suggests and accepts every player drafted or playing since 1980, not just the ones in the game,
  so a name missing from the suggestions never gives an answer away (Aaron Rodgers is in there, a wrong guess
  for a 2009 Packers pick). Suggestions are ranked by career value alone, the same way for everyone.

Fame (0 to 1) drives how often a pick comes up and the order of name suggestions. It's a blend of career
value and honors, so the daily ten lean toward players people have heard of without being all stars.
"""
import argparse, csv, io, json, math, os, re, sys, tempfile, unicodedata, urllib.request, urllib.parse
from collections import defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "guess-the-pick", "data.js")
NAMES_OUT = os.path.join(ROOT, "guess-the-pick", "names.js")
NAMES_SINCE = 1980   # the guess box knows everyone who played or was drafted since then, so it can't give an answer away
FIRST, LAST = 2007, 2026

NFL_URL = "https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv"
NFL_PLAYERS_URL = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv"
NFL_COMBINE_URL = "https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv"
BBREF = "https://raw.githubusercontent.com/sumitrodatta/bball-reference-datasets/master/Data/"
BBREF_FILES = ["Draft Pick History.csv", "Player Season Info.csv", "Player Career Info.csv", "Advanced.csv",
               "Player Totals.csv", "All-Star Selections.csv", "End of Season Teams.csv", "Player Award Shares.csv"]

EXTRA_NBA = set()                    # e.g. "2011-60" (Isaiah Thomas qualifies on his own already)
# Players traded during their rookie year before playing for the team that picked them: the season data can't
# tell which of their teams came first, so the build prints them and these settle it ("SEASON-OVERALL": team).
NBA_WENT_TO = {"2010-27": "ATL", "2014-45": "BOS", "2020-24": "DEN", "2021-21": "LAC", "2025-18": "UTA"}
EXTRA_NFL = {"2022-262"}             # Brock Purdy, Mr. Irrelevant

# Team names as they were. Abbreviations are basketball-reference's and Pro Football Reference's,
# which already change when a team moves or renames (SEA, NJN, CHA for the Bobcats; OAK, SDG, STL).
NBA_TEAMS = {
    "ATL": "Atlanta Hawks", "BOS": "Boston Celtics", "BRK": "Brooklyn Nets", "NJN": "New Jersey Nets",
    "CHA": "Charlotte Bobcats", "CHO": "Charlotte Hornets", "CHI": "Chicago Bulls", "CLE": "Cleveland Cavaliers",
    "DAL": "Dallas Mavericks", "DEN": "Denver Nuggets", "DET": "Detroit Pistons", "GSW": "Golden State Warriors",
    "HOU": "Houston Rockets", "IND": "Indiana Pacers", "LAC": "Los Angeles Clippers", "LAL": "Los Angeles Lakers",
    "MEM": "Memphis Grizzlies", "MIA": "Miami Heat", "MIL": "Milwaukee Bucks", "MIN": "Minnesota Timberwolves",
    "NOH": "New Orleans Hornets", "NOK": "New Orleans/Oklahoma City Hornets", "NOP": "New Orleans Pelicans",
    "NYK": "New York Knicks", "OKC": "Oklahoma City Thunder", "SEA": "Seattle SuperSonics", "ORL": "Orlando Magic",
    "PHI": "Philadelphia 76ers", "PHO": "Phoenix Suns", "POR": "Portland Trail Blazers", "SAC": "Sacramento Kings",
    "SAS": "San Antonio Spurs", "TOR": "Toronto Raptors", "UTA": "Utah Jazz", "WAS": "Washington Wizards",
}
# Same franchise under an older name: a pick by Seattle who debuted for Oklahoma City didn't "go" anywhere.
NBA_FRANCHISE = {"SEA": "OKC", "NJN": "BRK", "NOH": "NOP", "NOK": "NOP", "CHA": "CHO"}
# ESPN's logo codes, for the franchises still playing under the same name. Teams that moved or renamed get no logo.
NBA_ESPN = {"ATL": "atl", "BOS": "bos", "BRK": "bkn", "CHO": "cha", "CHI": "chi", "CLE": "cle", "DAL": "dal",
            "DEN": "den", "DET": "det", "GSW": "gs", "HOU": "hou", "IND": "ind", "LAC": "lac", "LAL": "lal",
            "MEM": "mem", "MIA": "mia", "MIL": "mil", "MIN": "min", "NOP": "no", "NYK": "ny", "OKC": "okc",
            "ORL": "orl", "PHI": "phi", "PHO": "phx", "POR": "por", "SAC": "sac", "SAS": "sa", "TOR": "tor",
            "UTA": "utah", "WAS": "wsh"}
NFL_TEAMS = {
    "ARI": "Arizona Cardinals", "ATL": "Atlanta Falcons", "BAL": "Baltimore Ravens", "BUF": "Buffalo Bills",
    "CAR": "Carolina Panthers", "CHI": "Chicago Bears", "CIN": "Cincinnati Bengals", "CLE": "Cleveland Browns",
    "DAL": "Dallas Cowboys", "DEN": "Denver Broncos", "DET": "Detroit Lions", "GNB": "Green Bay Packers",
    "HOU": "Houston Texans", "IND": "Indianapolis Colts", "JAX": "Jacksonville Jaguars", "KAN": "Kansas City Chiefs",
    "LAC": "Los Angeles Chargers", "SDG": "San Diego Chargers", "LAR": "Los Angeles Rams", "STL": "St. Louis Rams",
    "LVR": "Las Vegas Raiders", "OAK": "Oakland Raiders", "MIA": "Miami Dolphins", "MIN": "Minnesota Vikings",
    "NOR": "New Orleans Saints", "NWE": "New England Patriots", "NYG": "New York Giants", "NYJ": "New York Jets",
    "PHI": "Philadelphia Eagles", "PIT": "Pittsburgh Steelers", "SEA": "Seattle Seahawks", "SFO": "San Francisco 49ers",
    "TAM": "Tampa Bay Buccaneers", "TEN": "Tennessee Titans", "WAS": "Washington Commanders",
}
NFL_ESPN = {"ARI": "ari", "ATL": "atl", "BAL": "bal", "BUF": "buf", "CAR": "car", "CHI": "chi", "CIN": "cin",
            "CLE": "cle", "DAL": "dal", "DEN": "den", "DET": "det", "GNB": "gb", "HOU": "hou", "IND": "ind",
            "JAX": "jax", "KAN": "kc", "LAC": "lac", "LAR": "lar", "LVR": "lv", "MIA": "mia", "MIN": "min",
            "NOR": "no", "NWE": "ne", "NYG": "nyg", "NYJ": "nyj", "PHI": "phi", "PIT": "pit", "SEA": "sea",
            "SFO": "sf", "TAM": "tb", "TEN": "ten", "WAS": "wsh"}
NFL_POS = {"QB": "Quarterback", "RB": "Running back", "FB": "Fullback", "WR": "Wide receiver", "TE": "Tight end",
           "T": "Offensive tackle", "OT": "Offensive tackle", "G": "Guard", "OG": "Guard", "C": "Center", "OL": "Offensive line",
           "DE": "Defensive end", "DT": "Defensive tackle", "NT": "Nose tackle", "DL": "Defensive line",
           "LB": "Linebacker", "OLB": "Outside linebacker", "ILB": "Inside linebacker", "CB": "Cornerback",
           "S": "Safety", "SAF": "Safety", "DB": "Defensive back", "K": "Kicker", "P": "Punter", "LS": "Long snapper", "EDGE": "Edge rusher"}
NBA_POS = {"G": "Guard", "F": "Forward", "C": "Center", "PG": "Point guard", "SG": "Shooting guard",
           "SF": "Small forward", "PF": "Power forward"}


def nfl_team_name(abbr, year):
    if abbr == "WAS":
        return "Washington Redskins" if year <= 2019 else "Washington Football Team" if year <= 2021 else "Washington Commanders"
    return NFL_TEAMS[abbr]


def nfl_logo(abbr, year):
    if abbr == "WAS" and year < 2022:
        return ""
    return NFL_ESPN.get(abbr, "")


def nba_pos(code):
    code = (code or "").strip()
    if not code or code == "NA":
        return ""
    parts = [p for p in re.split(r"[-/]", code) if p]
    words = [NBA_POS.get(p, p) for p in parts]
    return " / ".join(dict.fromkeys(words))


def norm(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"['`.]", "", s)   # same as the game: Ja'Marr is jamarr, T.J. is tj
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return re.sub(r"( (jr|sr|ii|iii|iv|v))+$", "", s)   # a suffix only at the end: J.R. Smith stays "jr smith"


def fetch(url, dest):
    with urllib.request.urlopen(url, timeout=120) as res, open(dest, "wb") as f:
        f.write(res.read())


def read(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def num(x, default=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def plural(n, word):
    return f"{n}x {word}"


def build_nba(src):
    draft = [r for r in read(os.path.join(src, "Draft Pick History.csv"))
             if r["lg"] == "NBA" and FIRST <= int(r["season"]) <= LAST]
    seasons = defaultdict(lambda: defaultdict(list))   # player -> season -> teams
    for r in read(os.path.join(src, "Player Season Info.csv")):
        if r["lg"] == "NBA":
            seasons[r["player_id"]][int(r["season"])].append(r["team"])
    career = {r["player_id"]: r for r in read(os.path.join(src, "Player Career Info.csv"))}
    ws = defaultdict(float)
    multi = set()
    adv = [r for r in read(os.path.join(src, "Advanced.csv")) if r["lg"] == "NBA"]
    for r in adv:   # a traded player has a 2TM/3TM total row plus one row per team: count the total row only
        if re.fullmatch(r"\dTM|TOT", r["team"]):
            multi.add((r["player_id"], r["season"]))
    for r in adv:
        key = (r["player_id"], r["season"])
        if key in multi and not re.fullmatch(r"\dTM|TOT", r["team"]):
            continue
        ws[r["player_id"]] += num(r["ws"])
    games, points = defaultdict(int), defaultdict(float)
    tot = [r for r in read(os.path.join(src, "Player Totals.csv")) if r["lg"] == "NBA"]
    multi_t = {(r["player_id"], r["season"]) for r in tot if re.fullmatch(r"\dTM|TOT", r["team"])}
    for r in tot:
        if (r["player_id"], r["season"]) in multi_t and not re.fullmatch(r"\dTM|TOT", r["team"]):
            continue
        games[r["player_id"]] += int(num(r["g"]))
        points[r["player_id"]] += num(r["pts"])
    allstar = defaultdict(int)
    for r in read(os.path.join(src, "All-Star Selections.csv")):
        if r["lg"] == "NBA":
            allstar[r["player_id"]] += 1
    allnba = defaultdict(int)
    for r in read(os.path.join(src, "End of Season Teams.csv")):
        if r["lg"] == "NBA" and r["type"] == "All-NBA":
            allnba[r["player_id"]] += 1
    awards = defaultdict(lambda: defaultdict(int))
    for r in read(os.path.join(src, "Player Award Shares.csv")):
        if r["winner"] == "TRUE":
            awards[r["player_id"]][r["award"]] += 1

    picks, odd_moves = [], []
    for r in draft:
        y, p, rnd, pid = int(r["season"]), int(r["overall_pick"]), int(r["round"]), r["player_id"]
        a = awards[pid]
        notable = allstar[pid] > 0 or allnba[pid] > 0 or a.get("nba roy", 0) > 0 or ws[pid] >= 30
        if rnd != 1 and not notable and f"{y}-{p}" not in EXTRA_NBA:
            continue
        # Where he went: the team he first played for, if it isn't the one that picked him.
        to, debut = "", None
        played = seasons.get(pid, {})
        if played:
            debut = min(played)
            same = lambda t: NBA_FRANCHISE.get(t, t) == NBA_FRANCHISE.get(r["tm"], r["tm"])
            teams = [t for t in played[debut] if not re.fullmatch(r"\dTM|TOT", t)]
            if any(same(t) for t in teams):
                teams = [r["tm"]]
            if r["tm"] not in teams and len(teams) == 1:
                to = teams[0]
            elif r["tm"] not in teams and len(teams) > 1:
                to = NBA_WENT_TO.get(f"{y}-{p}", "")
                if not to:
                    odd_moves.append((y, p, r["player"], r["tm"], teams))   # traded in his rookie year, order unknown
        c = career.get(pid, {})
        g = games[pid]
        bits = []
        if a.get("nba mvp"):
            bits.append(plural(a["nba mvp"], "MVP"))
        if allstar[pid]:
            bits.append(plural(allstar[pid], "All-Star"))
        if allnba[pid]:
            bits.append(plural(allnba[pid], "All-NBA"))
        if a.get("nba roy"):
            bits.append("Rookie of the Year")
        if a.get("dpoy"):
            bits.append(plural(a["dpoy"], "DPOY"))
        if g:
            n_seasons = len(played)
            bits.append(f"{n_seasons} season{'s' if n_seasons != 1 else ''}, {points[pid] / g:.1f} ppg")
        else:
            bits.append("Never played in the NBA")
        fame = 0.55 * min(1, max(0, ws[pid]) / 110) + 0.3 * min(1, allstar[pid] / 8) + 0.15 * min(1, allnba[pid] / 5)
        if y >= LAST - 1 and g:   # rookies and second-year players get a nudge for being in the news
            fame = max(fame, 0.12)
        college = r["college"] if r["college"] not in ("", "NA") else "No college (international or pro)"
        picks.append({
            "y": y, "p": p, "r": rnd, "rp": p if rnd == 1 else p - 30,
            "t": r["tm"], "tn": NBA_TEAMS[r["tm"]], "tl": NBA_ESPN.get(r["tm"], ""),
            "to": to, "ton": NBA_TEAMS.get(to, ""), "tol": NBA_ESPN.get(to, ""),
            "late": bool(to and debut and debut > y + 1),
            "n": r["player"], "pos": nba_pos(c.get("pos", "")), "col": college,
            "line": " · ".join(bits), "f": round(fame, 3),
        })

    extra = json.load(open(os.path.join(HERE, "guess_the_pick_2026_nba.json")))
    have = {(x["y"], x["p"]) for x in picks}
    for e in extra["picks"]:
        if (2026, e["p"]) in have:
            continue
        to = e.get("to", "")
        picks.append({"y": 2026, "p": e["p"], "r": 1, "rp": e["p"], "t": e["t"], "tn": NBA_TEAMS[e["t"]],
                      "tl": NBA_ESPN.get(e["t"], ""), "to": to, "ton": NBA_TEAMS.get(to, ""), "tol": NBA_ESPN.get(to, ""),
                      "late": False, "n": e["n"], "pos": nba_pos(e["pos"]), "col": e["col"],
                      "line": "2026 rookie", "f": 0.12})
    # Every NBA name since NAMES_SINCE, ranked by career win shares
    known = {}
    def add(name, score):
        k = norm(name)
        if k and (k not in known or known[k][1] < score):
            known[k] = (name, score)
    for pid, c in career.items():
        if int(num(c.get("to"), 0)) >= NAMES_SINCE:
            add(c["player"], ws[pid])
    for r in read(os.path.join(src, "Draft Pick History.csv")):
        if r["lg"] == "NBA" and int(r["season"]) >= NAMES_SINCE:
            add(r["player"], ws.get(r["player_id"], 0))
    for x in picks:
        add(x["n"], 0)
    return picks, odd_moves, known


def build_nfl(src):
    every = read(os.path.join(src, "nfl_draft_picks.csv"))
    rows = [r for r in every if FIRST <= int(r["season"]) <= LAST]
    # Every NFL name since NAMES_SINCE, ranked by weighted approximate value (or years played, for undrafted players)
    known = {}
    def add(name, score):
        k = norm(name)
        if k and (k not in known or known[k][1] < score):
            known[k] = (name, score)
    for r in every:
        if int(r["season"]) >= NAMES_SINCE:
            add(r["pfr_player_name"], num(r["w_av"]) or num(r["car_av"]))
    path = os.path.join(src, "nfl_players.csv")
    if os.path.exists(path):
        for r in read(path):
            if int(num(r.get("last_season"), 0)) >= NAMES_SINCE and r.get("display_name") and norm(r["display_name"]) not in known:
                add(r["display_name"], 2.5 * num(r.get("years_of_experience")))   # undrafted: rank by years played
    first_of_round = {}
    for r in rows:
        key = (int(r["season"]), int(r["round"]))
        first_of_round[key] = min(first_of_round.get(key, 999), int(r["pick"]))
    picks = []
    for r in rows:
        y, p, rnd = int(r["season"]), int(r["pick"]), int(r["round"])
        pb, ap, wav = int(num(r["probowls"])), int(num(r["allpro"])), num(r["w_av"])
        hof = r["hof"] == "TRUE"
        notable = hof or ap >= 1 or pb >= 3 or wav >= 60
        if rnd != 1 and not notable and f"{y}-{p}" not in EXTRA_NFL:
            continue
        g = int(num(r["games"]))
        bits = []
        if hof:
            bits.append("Hall of Famer")
        if pb:
            bits.append(plural(pb, "Pro Bowl"))
        if ap:
            bits.append(plural(ap, "All-Pro"))
        if y == LAST and not g:
            bits.append(f"{LAST} rookie")
        elif g:
            bits.append(f"{g} game{'s' if g != 1 else ''}")
        else:
            bits.append("Never played in the NFL")
        if y == 2022 and p == 262:
            bits.insert(0, "Mr. Irrelevant")
        fame = 0.6 * min(1, wav / 90) + 0.3 * min(1, pb / 7) + 0.1 * min(1, ap / 3)
        if hof:
            fame = 1.0
        if y >= LAST - 1:
            fame = max(fame, 0.12)
        if y == 2022 and p == 262:
            fame = max(fame, 0.6)
        pos = r["position"]
        picks.append({
            "y": y, "p": p, "r": rnd, "rp": p - first_of_round[(y, rnd)] + 1,
            "t": r["team"], "tn": nfl_team_name(r["team"], y), "tl": nfl_logo(r["team"], y),
            "to": "", "ton": "", "tol": "", "late": False,
            "n": r["pfr_player_name"], "pos": NFL_POS.get(pos, pos), "col": r["college"] or "",
            "line": " · ".join(bits), "f": round(fame, 3),
        })
    for x in picks:
        add(x["n"], 0)
    return picks, known


def feet(inches):
    i = int(num(inches))
    return f"{i // 12}-{i % 12}" if i else ""


def size_line(ht, wt, extra=()):
    bits = []
    if ht and wt:
        bits.append(f"{ht}, {int(num(wt))} lbs")
    elif ht:
        bits.append(ht)
    return " · ".join(bits + [x for x in extra if x])


# Two hints the game sells separately: "size" (height and weight, plus combine numbers for the NFL) and
# "pb", the player taken one pick earlier in the full draft (any round, whether or not he's in the game).
def add_nba_hints(src, picks):
    draft = {(int(r["season"]), int(r["overall_pick"])): r for r in read(os.path.join(src, "Draft Pick History.csv"))
             if r["lg"] == "NBA" and r["overall_pick"].isdigit()}
    career = {r["player_id"]: r for r in read(os.path.join(src, "Player Career Info.csv"))}
    extra = {e["p"]: e for e in json.load(open(os.path.join(HERE, "guess_the_pick_2026_nba.json")))["picks"]}
    for x in picks:
        me = draft.get((x["y"], x["p"]))
        c = career.get(me["player_id"], {}) if me else {}
        x["size"] = size_line(feet(c.get("ht_in_in")), c.get("wt") if c.get("wt") not in ("", "NA") else "")
        before = draft.get((x["y"], x["p"] - 1))
        if before:
            x["pb"] = f"#{x['p'] - 1} {before['player']}, {NBA_TEAMS.get(before['tm'], before['tm'])}"
        elif x["y"] == 2026 and x["p"] - 1 in extra:
            e = extra[x["p"] - 1]
            x["pb"] = f"#{x['p'] - 1} {e['n']}, {NBA_TEAMS[e['t']]}"
        else:
            x["pb"] = ""


def add_nfl_hints(src, picks):
    draft = {(int(r["season"]), int(r["pick"])): r for r in read(os.path.join(src, "nfl_draft_picks.csv")) if r["pick"].isdigit()}
    combine = {r["pfr_id"]: r for r in read(os.path.join(src, "nfl_combine.csv")) if r.get("pfr_id")}
    players = {r["pfr_id"]: r for r in read(os.path.join(src, "nfl_players.csv")) if r.get("pfr_id")}
    for x in picks:
        me = draft.get((x["y"], x["p"]), {})
        pid = me.get("pfr_player_id", "")
        cb, pl = combine.get(pid), players.get(pid, {})
        if cb:
            extra = [f"{cb['forty']} forty" if cb.get("forty") else "",
                     f"{cb['vertical']}-inch vertical" if cb.get("vertical") else "",
                     f"{cb['bench']} bench reps" if cb.get("bench") else ""]
            x["size"] = size_line(cb.get("ht") or feet(pl.get("height")), cb.get("wt") or pl.get("weight"), extra[:2] if extra[0] else extra[1:])
        else:
            x["size"] = size_line(feet(pl.get("height")), pl.get("weight"))
        before = draft.get((x["y"], x["p"] - 1))
        x["pb"] = f"#{x['p'] - 1} {before['pfr_player_name']}, {nfl_team_name(before['team'], x['y'])}" if before else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="folder that already holds the source CSVs")
    args = ap.parse_args()
    src = args.src or tempfile.mkdtemp(prefix="gtp-")
    if not args.src:
        print("Downloading sources to", src)
        fetch(NFL_URL, os.path.join(src, "nfl_draft_picks.csv"))
        fetch(NFL_PLAYERS_URL, os.path.join(src, "nfl_players.csv"))
        fetch(NFL_COMBINE_URL, os.path.join(src, "nfl_combine.csv"))
        for f in BBREF_FILES:
            fetch(BBREF + urllib.parse.quote(f), os.path.join(src, f))
    nba, odd, nba_names = build_nba(src)
    nfl, nfl_names = build_nfl(src)
    add_nba_hints(src, nba)
    add_nfl_hints(src, nfl)
    for league, picks in (("NBA", nba), ("NFL", nfl)):
        print(f"{league}: size for {sum(1 for x in picks if x['size'])}, pick before for {sum(1 for x in picks if x['pb'])} of {len(picks)}")
    for league, picks in (("NBA", nba), ("NFL", nfl)):
        years = sorted({x["y"] for x in picks})
        assert years == list(range(FIRST, LAST + 1)), (league, years)
        assert len({norm(x["n"]) + str(x["y"]) for x in picks}) == len(picks), league + " has a duplicate"
        later = sum(1 for x in picks if x["r"] != 1)
        print(f"{league}: {len(picks)} picks ({len(picks) - later} first round, {later} later picks worth knowing)")
    if odd:
        print("Add these to NBA_WENT_TO (traded in their rookie season, first team unknown):")
        for o in odd:
            print("  ", o)
    for picks in (nba, nfl):
        picks.sort(key=lambda x: (x["y"], x["p"]))
    data = {"built": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "years": [FIRST, LAST], "nba": nba, "nfl": nfl}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* Generated by tools/guess_the_pick_build.py. Don't edit by hand. */\n")
        f.write("window.GTP_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("Wrote", os.path.relpath(OUT, ROOT), f"({os.path.getsize(OUT) // 1024} KB)")
    names = {}
    for league, known in (("nba", nba_names), ("nfl", nfl_names)):
        names[league] = [v[0] for v in sorted(known.values(), key=lambda v: (-v[1], v[0]))]
        print(f"{league.upper()}: {len(names[league])} names in the guess box")
    with open(NAMES_OUT, "w", encoding="utf-8") as f:
        f.write("/* Generated by tools/guess_the_pick_build.py. Every name the guess box knows, best careers first. */\n")
        f.write("window.GTP_NAMES = " + json.dumps(names, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("Wrote", os.path.relpath(NAMES_OUT, ROOT), f"({os.path.getsize(NAMES_OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
