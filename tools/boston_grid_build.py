"""Builds boston-grid/data-nba.js, data-nfl.js and data-mlb.js: every player and the franchises he played for.

Run it from the repo root, after downloading Journeyman's sources (same folder, same downloader):
  python3 tools/journeyman_fetch.py DIR
  python3 tools/boston_grid_build.py --src DIR
  node tools/boston_grid_check.js

Who's in
  Anyone who played in 1990 or later (the NFL rosters start in 1990) for at least one franchise. A team that
  moved counts once: the Sonics and Thunder are one franchise, the Oilers and Titans are one.
  Every player is in, even a one-game guy, so a right answer is never marked wrong. Each player also gets a
  fame score from 0 to 1 (career value, honors, games), which decides who counts toward a square being fair,
  who shows up as a suggested answer afterward, and how many deep-cut points a right answer earns.

Teams come from tools/journeyman_build.py (names, colors), so the two games always agree on franchises.
Output per league: window.BG_DATA[league] = { ids: [franchise ids], teams: {id: [city, nickname, color1, color2]},
players: [[name, fame, teams, last season's last two digits], ...] }, players in fame order. A player's teams are one
character per franchise, its place in ids written 0-9 then a-z, to keep the NFL file small enough for a phone.
"""
import argparse, json, os, re, sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import journeyman_build as jb   # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "boston-grid")
FIRST = 1990

# One display name per franchise (today's name, with the old one where people still say it)
NBA_TEAMS = {
    "hawks": ("Atlanta", "Hawks"), "celtics": ("Boston", "Celtics"), "nets": ("Brooklyn", "Nets"), "hornets": ("Charlotte", "Hornets"),
    "bulls": ("Chicago", "Bulls"), "cavaliers": ("Cleveland", "Cavaliers"), "mavericks": ("Dallas", "Mavericks"), "nuggets": ("Denver", "Nuggets"),
    "pistons": ("Detroit", "Pistons"), "warriors": ("Golden State", "Warriors"), "rockets": ("Houston", "Rockets"), "pacers": ("Indiana", "Pacers"),
    "clippers": ("LA", "Clippers"), "lakers": ("Los Angeles", "Lakers"), "grizzlies": ("Memphis", "Grizzlies"), "heat": ("Miami", "Heat"),
    "bucks": ("Milwaukee", "Bucks"), "timberwolves": ("Minnesota", "Timberwolves"), "pelicans": ("New Orleans", "Pelicans"),
    "knicks": ("New York", "Knicks"), "thunder": ("OKC / Seattle", "Thunder / Sonics"), "magic": ("Orlando", "Magic"),
    "76ers": ("Philadelphia", "76ers"), "suns": ("Phoenix", "Suns"), "blazers": ("Portland", "Trail Blazers"), "kings": ("Sacramento", "Kings"),
    "spurs": ("San Antonio", "Spurs"), "raptors": ("Toronto", "Raptors"), "jazz": ("Utah", "Jazz"), "wizards": ("Washington", "Wizards"),
}
NBA_COLOR_FROM = {"nets": "BRK", "hornets": "CHO", "grizzlies": "MEM", "pelicans": "NOP", "thunder": "OKC", "kings": "SAC", "wizards": "WAS"}
NFL_TEAMS = {
    "cardinals": ("Arizona", "Cardinals"), "falcons": ("Atlanta", "Falcons"), "ravens": ("Baltimore", "Ravens"), "bills": ("Buffalo", "Bills"),
    "panthers": ("Carolina", "Panthers"), "bears": ("Chicago", "Bears"), "bengals": ("Cincinnati", "Bengals"), "browns": ("Cleveland", "Browns"),
    "cowboys": ("Dallas", "Cowboys"), "broncos": ("Denver", "Broncos"), "lions": ("Detroit", "Lions"), "packers": ("Green Bay", "Packers"),
    "texans": ("Houston", "Texans"), "titans": ("Tennessee", "Titans / Oilers"), "colts": ("Indianapolis", "Colts"), "jaguars": ("Jacksonville", "Jaguars"),
    "chiefs": ("Kansas City", "Chiefs"), "chargers": ("LA / San Diego", "Chargers"), "rams": ("LA / St. Louis", "Rams"),
    "raiders": ("Las Vegas / Oakland", "Raiders"), "dolphins": ("Miami", "Dolphins"), "vikings": ("Minnesota", "Vikings"),
    "patriots": ("New England", "Patriots"), "saints": ("New Orleans", "Saints"), "giants": ("New York", "Giants"), "jets": ("New York", "Jets"),
    "eagles": ("Philadelphia", "Eagles"), "steelers": ("Pittsburgh", "Steelers"), "seahawks": ("Seattle", "Seahawks"), "49ers": ("San Francisco", "49ers"),
    "buccaneers": ("Tampa Bay", "Buccaneers"), "commanders": ("Washington", "Commanders"),
}
NFL_COLOR_FROM = {"cardinals": "ARI", "titans": "TEN", "chargers": "LAC", "rams": "LA", "raiders": "LV"}
# Lahman franchise IDs
MLB_TEAMS = {
    "ARI": ("Arizona", "Diamondbacks"), "ATL": ("Atlanta", "Braves"), "BAL": ("Baltimore", "Orioles"), "BOS": ("Boston", "Red Sox"),
    "CHC": ("Chicago", "Cubs"), "CHW": ("Chicago", "White Sox"), "CIN": ("Cincinnati", "Reds"), "CLE": ("Cleveland", "Guardians / Indians"),
    "COL": ("Colorado", "Rockies"), "DET": ("Detroit", "Tigers"), "HOU": ("Houston", "Astros"), "KCR": ("Kansas City", "Royals"),
    "ANA": ("Los Angeles", "Angels"), "LAD": ("Los Angeles", "Dodgers"), "FLA": ("Miami", "Marlins"), "MIL": ("Milwaukee", "Brewers"),
    "MIN": ("Minnesota", "Twins"), "NYM": ("New York", "Mets"), "NYY": ("New York", "Yankees"), "OAK": ("Athletics", "A's"),
    "PHI": ("Philadelphia", "Phillies"), "PIT": ("Pittsburgh", "Pirates"), "SDP": ("San Diego", "Padres"), "SEA": ("Seattle", "Mariners"),
    "SFG": ("San Francisco", "Giants"), "STL": ("St. Louis", "Cardinals"), "TBD": ("Tampa Bay", "Rays"), "TEX": ("Texas", "Rangers"),
    "TOR": ("Toronto", "Blue Jays"), "WSN": ("Washington / Montreal", "Nationals / Expos"),
}
# Lahman teamID that carries each franchise's colors
MLB_COLOR_FROM = {"ARI": "ARI", "ATL": "ATL", "BAL": "BAL", "BOS": "BOS", "CHC": "CHN", "CHW": "CHA", "CIN": "CIN", "CLE": "CLE", "COL": "COL",
                  "DET": "DET", "HOU": "HOU", "KCR": "KCA", "ANA": "LAA", "LAD": "LAN", "FLA": "MIA", "MIL": "MIL", "MIN": "MIN", "NYM": "NYN",
                  "NYY": "NYA", "OAK": "OAK", "PHI": "PHI", "PIT": "PIT", "SDP": "SDN", "SEA": "SEA", "SFG": "SFN", "STL": "SLN", "TBD": "TBA",
                  "TEX": "TEX", "TOR": "TOR", "WSN": "WAS"}


def nba(src):
    teams = defaultdict(set)
    seasons = defaultdict(set)
    for r in jb.read(os.path.join(src, "Player Season Info.csv")):
        if r["lg"] == "NBA" and not re.fullmatch(r"\dTM|TOT", r["team"]) and int(r["season"]) >= FIRST + 1:
            f = jb.NBA.get(r["team"], (None,))[0]
            if f:
                teams[r["player_id"]].add(f); seasons[r["player_id"]].add(int(r["season"]))
    career = {r["player_id"]: r for r in jb.read(os.path.join(src, "Player Career Info.csv"))}
    ws, games = defaultdict(float), defaultdict(int)
    for fname in ("Advanced.csv", "Player Totals.csv"):
        rows = [r for r in jb.read(os.path.join(src, fname)) if r["lg"] == "NBA"]
        multi = {(r["player_id"], r["season"]) for r in rows if re.fullmatch(r"\dTM|TOT", r["team"])}
        for r in rows:
            if (r["player_id"], r["season"]) in multi and not re.fullmatch(r"\dTM|TOT", r["team"]):
                continue
            if fname == "Advanced.csv":
                ws[r["player_id"]] += jb.num(r["ws"])
            else:
                games[r["player_id"]] += int(jb.num(r["g"]))
    allstar = Counter(r["player_id"] for r in jb.read(os.path.join(src, "All-Star Selections.csv")) if r["lg"] == "NBA")
    out = []
    for pid, fr in teams.items():
        name = (career.get(pid) or {}).get("player") or pid
        fame = 0.45 * min(1, max(0, ws[pid]) / 90) + 0.3 * min(1, allstar[pid] / 4) + 0.25 * min(1, games[pid] / 1100)
        out.append((name, fame, fr, max(seasons[pid])))
    tm = {}
    for f, (city, nick) in NBA_TEAMS.items():
        code = NBA_COLOR_FROM.get(f) or next(c for c, v in jb.NBA.items() if v[0] == f)
        tm[f] = [city, nick, jb.NBA[code][1], jb.NBA[code][2]]
    return tm, out


def nfl(src):
    rows = jb.read(os.path.join(src, "nfl_paths.csv"))
    draft = jb.read(os.path.join(src, "nfl_draft_picks.csv"))
    by_pfr = {r["pfr_player_id"]: r for r in draft if r.get("pfr_player_id")}
    by_gsis = {r["gsis_id"]: r for r in draft if r.get("gsis_id")}
    players = jb.read(os.path.join(src, "nfl_players.csv"))
    gsis_of_pfr = {p["pfr_id"]: p["gsis_id"] for p in players if p.get("pfr_id") and p.get("gsis_id")}
    teams, last, name, pfr, active, pos = defaultdict(set), {}, {}, {}, Counter(), defaultdict(Counter)
    for r in rows:
        key = r["gsis_id"] or gsis_of_pfr.get(r["pfr_id"]) or ("pfr:" + r["pfr_id"] if r["pfr_id"] else "name:" + r["name"] + "|" + r["college"])
        y = int(r["season"])
        code = jb.NFL_CODE.get(r["team"], r["team"])
        if code == "HOU" and y < 2002:
            code = "HOI"
        if code not in jb.NFL:
            continue
        teams[key].add(jb.NFL[code][0]); last[key] = max(last.get(key, 0), y)
        name.setdefault(key, r["name"])
        if r["pfr_id"]:
            pfr[key] = r["pfr_id"]
        if int(r["week"] or 0) and r["status"] == "ACT":
            active[key] += 1
        pos[key][r["position"]] += 1
    out = []
    for key, fr in teams.items():
        d = by_gsis.get(key) or by_pfr.get(pfr.get(key))
        games = int(jb.num(d.get("games"))) if d and d.get("games") else active[key]
        pb, wav = (int(jb.num(d.get("probowls"))), jb.num(d.get("w_av"))) if d else (0, 0)
        fame = 0.45 * min(1, games / 190) + 0.3 * min(1, pb / 4) + 0.25 * min(1, wav / 90)
        if pos[key] and pos[key].most_common(1)[0][0] in ("K", "P", "LS"):
            fame *= 0.6   # still right answers, just never the ones a square is built around
        out.append((name[key], fame, fr, last[key]))
    tm = {}
    for f, (city, nick) in NFL_TEAMS.items():
        code = NFL_COLOR_FROM.get(f) or next(c for c, v in jb.NFL.items() if v[0] == f)
        tm[f] = [city, nick, jb.NFL[code][2], jb.NFL[code][3]]
    return tm, out


def mlb(src):
    m = lambda f: jb.read(os.path.join(src, "mlb", f + ".csv"))
    fran = {}
    for r in m("Teams"):
        fran[r["teamID"]] = r["franchID"]
    teams, last = defaultdict(set), {}
    bat, pit, games, pitg = defaultdict(Counter), defaultdict(Counter), Counter(), Counter()
    for fname in ("Batting", "Pitching"):
        for r in m(fname):
            y = int(r["yearID"])
            if y < FIRST:
                continue
            f = fran.get(r["teamID"])
            if f in MLB_TEAMS:
                teams[r["playerID"]].add(f); last[r["playerID"]] = max(last.get(r["playerID"], 0), y)
            ks = ("H", "HR") if fname == "Batting" else ("W", "SV")
            for k in ks:
                (bat if fname == "Batting" else pit)[r["playerID"]][k] += int(jb.num(r[k]))
    for r in m("Appearances"):
        games[r["playerID"]] += int(jb.num(r["G_all"])); pitg[r["playerID"]] += int(jb.num(r.get("G_p")))
    allstar = Counter(r["playerID"] for r in m("AllstarFull"))
    people = {r["playerID"]: r for r in m("People")}
    out = []
    for pid, fr in teams.items():
        p = people.get(pid, {})
        nm = f"{p.get('nameFirst', '')} {p.get('nameLast', '')}".strip()
        if not nm:
            continue
        pitcher = pitg[pid] > games[pid] / 2
        value = (pit[pid]["W"] / 200 + pit[pid]["SV"] / 300) if pitcher else (bat[pid]["H"] / 2500 + bat[pid]["HR"] / 450)
        fame = 0.4 * min(1, value) + 0.35 * min(1, allstar[pid] / 5) + 0.25 * min(1, games[pid] / 2000)
        out.append((nm, fame, fr, last[pid]))
    tm = {f: [city, nick, jb.MLB[MLB_COLOR_FROM[f]][0], jb.MLB[MLB_COLOR_FROM[f]][1]] for f, (city, nick) in MLB_TEAMS.items()}
    return tm, out


def write(league, tm, players):
    players = sorted(players, key=lambda x: (-x[1], x[0]))
    ids = sorted(tm)          # each franchise is one character in a player's team string: 0-9 then a-z
    ch = {t: "0123456789abcdefghijklmnopqrstuvwxyz"[i] for i, t in enumerate(ids)}
    rows = [[n, round(f, 2), "".join(sorted(ch[t] for t in fr if t in ch)), y % 100] for n, f, fr, y in players if fr]
    data = {"ids": ids, "teams": tm, "players": [r for r in rows if r[2]]}
    path = os.path.join(OUT, f"data-{league}.js")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(f"/* Boston Grid, {league.upper()}: every player since {FIRST} and his franchises, fame order. "
                 "Built by tools/boston_grid_build.py; don't edit by hand. */\n")
        fh.write(f"(window.BG_DATA = window.BG_DATA || {{}}).{league} = ")
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write(";\n")
    print(league, len(rows), "players,", os.path.getsize(path) // 1024, "KB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    for league, fn in (("nba", nba), ("nfl", nfl), ("mlb", mlb)):
        tm, players = fn(a.src)
        write(league, tm, players)


if __name__ == "__main__":
    main()
