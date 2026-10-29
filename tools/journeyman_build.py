"""Builds journeyman/data.js: the players in Journeyman, with every team they played for, in order.

Run it from the repo root:  python3 tools/journeyman_build.py --src DIR
DIR holds the source files (tools/journeyman_fetch.py downloads them all into one folder):
  NBA  the basketball-reference datasets Guess the Pick uses (Player Season Info, Player Career Info, Advanced,
       Player Totals, All-Star Selections, End of Season Teams, Draft Pick History, Team Abbrev)
  NFL  nfl_paths.csv (nflverse rosters: season by season 1990-2001, week by week from 2002), plus
       nfl_draft_picks.csv and nfl_players.csv
  MLB  mlb/*.csv, from the Lahman database (the 2026 Lahman R package, through the 2025 season)

Who's in
  Anyone whose career ended in 2000 or later, who played for at least four franchises (a team that moved
  counts once: the Sonics and Thunder are one franchise) and who played enough to be remembered:
    NBA 300+ games, NFL 50+ games, MLB 400+ games (or 250+ pitching appearances).
  The best-known 400 per league make the cut: career value and honors, a bonus for more franchises and for a
  recent career, and a floor so a long list of teams alone doesn't get anyone in.

The path
  Each stop is a team and its years. NFL weekly rosters and MLB stints are in order within a season. The NBA
  data lists a season's teams alphabetically, so a traded player's teams are ordered by who he played for the
  season before (first) and the season after (last).

Hints (four per player, plus initials in the game)
  NBA  position, college, draft, career line      NFL  position, college, draft, career line
  MLB  position, birthplace, debut, career line
"""
import argparse, csv, json, os, re
from collections import Counter, defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "journeyman", "data.js")
NAMES_OUT = os.path.join(ROOT, "journeyman", "names-mlb.js")
MIN_LAST, MIN_FRANCHISES, KEEP = 2000, 4, 400
# How well known someone has to be, on each league's own 0-1 career scale, before the journeyman bonus counts:
# keeps out the Timothé Luwawu-Cabarrots, who had plenty of teams but not much of a career.
FLOOR = {"nba": 0.2, "nfl": 0.34, "mlb": 0.22}


def read(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def num(x, d=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return d


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


# ---- Teams: name, franchise, colors (primary, accent) and ESPN logo code. Teams that moved or renamed show the
# franchise's current logo as a stand-in (the Raiders shield for Oakland), except where that would be wrong
# rather than close: the SuperSonics, the Expos-era Nationals' cousins and the like get a badge in their colors.
NBA = {
    "ATL": ("hawks", "#E03A3E", "#C1D32F", "atl"), "BOS": ("celtics", "#007A33", "#BA9653", "bos"),
    "BRK": ("nets", "#000000", "#FFFFFF", "bkn"), "NJN": ("nets", "#002A60", "#CD1041", "bkn"),
    "CHH": ("hornets", "#00778B", "#280071", "cha"), "CHA": ("hornets", "#F26532", "#2C5697", "cha"),
    "CHO": ("hornets", "#1D1160", "#00788C", "cha"), "CHI": ("bulls", "#CE1141", "#000000", "chi"),
    "CLE": ("cavaliers", "#860038", "#FDBB30", "cle"), "DAL": ("mavericks", "#00538C", "#B8C4CA", "dal"),
    "DEN": ("nuggets", "#0E2240", "#FEC524", "den"), "DET": ("pistons", "#C8102E", "#1D42BA", "det"),
    "GSW": ("warriors", "#1D428A", "#FFC72C", "gs"), "HOU": ("rockets", "#CE1141", "#C4CED4", "hou"),
    "IND": ("pacers", "#002D62", "#FDBB30", "ind"), "LAC": ("clippers", "#C8102E", "#1D428A", "lac"),
    "LAL": ("lakers", "#552583", "#FDB927", "lal"), "MEM": ("grizzlies", "#5D76A9", "#12173F", "mem"),
    "VAN": ("grizzlies", "#00B2A9", "#E43C40", "mem"), "MIA": ("heat", "#98002E", "#F9A01B", "mia"),
    "MIL": ("bucks", "#00471B", "#EEE1C6", "mil"), "MIN": ("timberwolves", "#0C2340", "#78BE20", "min"),
    "NOH": ("pelicans", "#002B5C", "#00788C", "no"), "NOK": ("pelicans", "#002B5C", "#00788C", "no"),
    "NOP": ("pelicans", "#0C2340", "#85714D", "no"), "NYK": ("knicks", "#006BB6", "#F58426", "ny"),
    "OKC": ("thunder", "#007AC1", "#EF3B24", "okc"), "SEA": ("thunder", "#00653A", "#FFC200", ""),
    "ORL": ("magic", "#0077C0", "#C4CED4", "orl"), "PHI": ("76ers", "#006BB6", "#ED174C", "phi"),
    "PHO": ("suns", "#1D1160", "#E56020", "phx"), "POR": ("blazers", "#E03A3E", "#000000", "por"),
    "SAC": ("kings", "#5A2D81", "#63727A", "sac"), "KCK": ("kings", "#5A2D81", "#63727A", "sac"),
    "SAS": ("spurs", "#000000", "#C4CED4", "sa"), "TOR": ("raptors", "#CE1141", "#000000", "tor"),
    "UTA": ("jazz", "#002B5C", "#F9A01B", "utah"), "WAS": ("wizards", "#002B5C", "#E31837", "wsh"),
    "WSB": ("wizards", "#002566", "#CE1141", "wsh"),
}
# nflverse roster codes, cleaned up: (franchise, name, colors, logo); the name can depend on the season
NFL_CODE = {"ARZ": "ARI", "BLT": "BAL", "CLV": "CLE", "HST": "HOU", "SL": "STL"}
NFL = {
    "ARI": ("cardinals", "Arizona Cardinals", "#97233F", "#FFB612", "ari"), "PHO": ("cardinals", "Phoenix Cardinals", "#97233F", "#FFB612", "ari"),
    "ATL": ("falcons", "Atlanta Falcons", "#A71930", "#000000", "atl"), "BAL": ("ravens", "Baltimore Ravens", "#241773", "#9E7C0C", "bal"),
    "BUF": ("bills", "Buffalo Bills", "#00338D", "#C60C30", "buf"), "CAR": ("panthers", "Carolina Panthers", "#0085CA", "#101820", "car"),
    "CHI": ("bears", "Chicago Bears", "#0B162A", "#C83803", "chi"), "CIN": ("bengals", "Cincinnati Bengals", "#FB4F14", "#000000", "cin"),
    "CLE": ("browns", "Cleveland Browns", "#311D00", "#FF3C00", "cle"), "DAL": ("cowboys", "Dallas Cowboys", "#003594", "#869397", "dal"),
    "DEN": ("broncos", "Denver Broncos", "#002244", "#FB4F14", "den"), "DET": ("lions", "Detroit Lions", "#0076B6", "#B0B7BC", "det"),
    "GB": ("packers", "Green Bay Packers", "#203731", "#FFB612", "gb"), "HOU": ("texans", "Houston Texans", "#03202F", "#A71930", "hou"),
    "HOI": ("titans", "Houston Oilers", "#4F94CD", "#C8102E", "ten"), "TEN": ("titans", "Tennessee Titans", "#0C2340", "#4B92DB", "ten"),
    "IND": ("colts", "Indianapolis Colts", "#002C5F", "#A2AAAD", "ind"), "JAX": ("jaguars", "Jacksonville Jaguars", "#006778", "#D7A22A", "jax"),
    "KC": ("chiefs", "Kansas City Chiefs", "#E31837", "#FFB81C", "kc"), "LAC": ("chargers", "Los Angeles Chargers", "#0080C6", "#FFC20E", "lac"),
    "SD": ("chargers", "San Diego Chargers", "#002A5E", "#FFC20E", "lac"), "LA": ("rams", "Los Angeles Rams", "#003594", "#FFA300", "lar"),
    "RAM": ("rams", "Los Angeles Rams", "#002244", "#FFD100", "lar"), "STL": ("rams", "St. Louis Rams", "#002244", "#B3995D", "lar"),
    "LV": ("raiders", "Las Vegas Raiders", "#000000", "#A5ACAF", "lv"), "OAK": ("raiders", "Oakland Raiders", "#000000", "#A5ACAF", "lv"),
    "RAI": ("raiders", "Los Angeles Raiders", "#000000", "#A5ACAF", "lv"), "MIA": ("dolphins", "Miami Dolphins", "#008E97", "#FC4C02", "mia"),
    "MIN": ("vikings", "Minnesota Vikings", "#4F2683", "#FFC62F", "min"), "NE": ("patriots", "New England Patriots", "#002244", "#C60C30", "ne"),
    "NO": ("saints", "New Orleans Saints", "#101820", "#D3BC8D", "no"), "NYG": ("giants", "New York Giants", "#0B2265", "#A71930", "nyg"),
    "NYJ": ("jets", "New York Jets", "#125740", "#FFFFFF", "nyj"), "PHI": ("eagles", "Philadelphia Eagles", "#004C54", "#A5ACAF", "phi"),
    "PIT": ("steelers", "Pittsburgh Steelers", "#101820", "#FFB612", "pit"), "SEA": ("seahawks", "Seattle Seahawks", "#002244", "#69BE28", "sea"),
    "SF": ("49ers", "San Francisco 49ers", "#AA0000", "#B3995D", "sf"), "TB": ("buccaneers", "Tampa Bay Buccaneers", "#D50A0A", "#B1BABF", "tb"),
    "WAS": ("commanders", "Washington", "#5A1414", "#FFB612", "wsh"),
}
# Lahman team IDs: (colors, logo); names and franchises come from Lahman's own Teams table, season by season
MLB = {
    "ARI": ("#A71930", "#E3D4AD", "ari"), "ATL": ("#13274F", "#CE1141", "atl"), "BAL": ("#DF4601", "#000000", "bal"),
    "BOS": ("#BD3039", "#0C2340", "bos"), "CHN": ("#0E3386", "#CC3433", "chc"), "CHA": ("#27251F", "#C4CED4", "chw"),
    "CIN": ("#C6011F", "#000000", "cin"), "CLE": ("#00385D", "#E50022", "cle"), "COL": ("#333366", "#C4CED4", "col"),
    "DET": ("#0C2340", "#FA4616", "det"), "HOU": ("#002D62", "#EB6E1F", "hou"), "KCA": ("#004687", "#BD9B60", "kc"),
    "LAA": ("#BA0021", "#003263", "laa"), "ANA": ("#BA0021", "#003263", "laa"), "CAL": ("#003263", "#BA0021", "laa"),
    "LAN": ("#005A9C", "#EF3E42", "lad"), "MIA": ("#00A3E0", "#EF3340", "mia"), "FLO": ("#00A3AD", "#000000", "mia"),
    "MIL": ("#12284B", "#FFC52F", "mil"), "ML4": ("#0A2351", "#B6922E", "mil"), "MIN": ("#002B5C", "#D31145", "min"),
    "NYN": ("#002D72", "#FF5910", "nym"), "NYA": ("#0C2340", "#C4CED3", "nyy"), "OAK": ("#003831", "#EFB21E", "oak"),
    "ATH": ("#003831", "#EFB21E", "oak"), "PHI": ("#E81828", "#002D72", "phi"), "PIT": ("#27251F", "#FDB827", "pit"),
    "SDN": ("#2F241D", "#FFC425", "sd"), "SEA": ("#0C2C56", "#005C5C", "sea"), "SFN": ("#FD5A1E", "#27251F", "sf"),
    "SLN": ("#C41E3A", "#0C2340", "stl"), "TBA": ("#092C5C", "#8FBCE6", "tb"), "TEX": ("#003278", "#C0111F", "tex"),
    "TOR": ("#134A8E", "#1D2D5C", "tor"), "WAS": ("#AB0003", "#14225A", "wsh"), "MON": ("#003087", "#E4002B", ""),
}
NBA_POS = {"G": "Guard", "F": "Forward", "C": "Center", "PG": "Point guard", "SG": "Shooting guard", "SF": "Small forward", "PF": "Power forward"}
NFL_POS = {"QB": "Quarterback", "RB": "Running back", "FB": "Fullback", "WR": "Wide receiver", "TE": "Tight end", "T": "Offensive tackle",
           "OT": "Offensive tackle", "G": "Guard", "OG": "Guard", "C": "Center", "OL": "Offensive line", "DE": "Defensive end",
           "DT": "Defensive tackle", "NT": "Nose tackle", "DL": "Defensive line", "LB": "Linebacker", "OLB": "Outside linebacker",
           "ILB": "Inside linebacker", "MLB": "Linebacker", "CB": "Cornerback", "S": "Safety", "SS": "Safety", "FS": "Safety",
           "SAF": "Safety", "DB": "Defensive back", "K": "Kicker", "P": "Punter", "LS": "Long snapper", "EDGE": "Edge rusher"}
MLB_POS = {"p": "Pitcher", "c": "Catcher", "1b": "First base", "2b": "Second base", "3b": "Third base", "ss": "Shortstop",
           "lf": "Left field", "cf": "Center field", "rf": "Right field", "dh": "Designated hitter"}


def nfl_name(code, year):
    if code == "WAS":
        return "Washington Redskins" if year <= 2019 else "Washington Football Team" if year <= 2021 else "Washington Commanders"
    if code == "TEN" and year <= 1998:
        return "Tennessee Oilers"
    return NFL[code][1]


def stint(team, name, c1, c2, logo, a, b):
    return {"t": team, "n": name, "c": [c1, c2], "l": logo, "a": a, "b": b}


def compress(seq):
    """[(season, team, extra...)] in order -> stints: consecutive seasons on the same team become one stop."""
    out = []
    for season, team in seq:
        if out and out[-1][0] == team:   # same team again with nothing in between: one stop, even across a gap
            out[-1][2] = season
        else:
            out.append([team, season, season])
    return out


def keep(players, league):
    """The best-known KEEP. Career value first, then a bonus for being a real journeyman (more franchises) and for
    a recent career (the group grew up on the 2000s and 2010s). Below the league's floor, nobody gets in."""
    out = []
    for p in players:
        if p["f"] < FLOOR[league]:
            continue
        last = p["s"][-1]["b"]
        p["f"] = round(min(1, p["f"] + min(0.3, 0.04 * (p["fr"] - 4)) + (0.08 if last >= 2008 else 0)), 3)
        out.append(p)
    out.sort(key=lambda x: -x["f"])
    return out[:KEEP]


def nba_seasons_label(a, b):
    return f"{a - 1}-{b}" if a != b else f"{a - 1}-{str(b)[2:]}"


# ---- NBA
def build_nba(src):
    teams = defaultdict(lambda: defaultdict(list))
    for r in read(os.path.join(src, "Player Season Info.csv")):
        if r["lg"] == "NBA" and not re.fullmatch(r"\dTM|TOT", r["team"]):
            teams[r["player_id"]][int(r["season"])].append(r["team"])
    names_by = {}
    for r in read(os.path.join(src, "Team Abbrev.csv")):
        if r["lg"] == "NBA":
            names_by[(int(r["season"]), r["abbreviation"])] = r["team"]
    career = {r["player_id"]: r for r in read(os.path.join(src, "Player Career Info.csv"))}
    ws, games, pts = defaultdict(float), defaultdict(int), defaultdict(float)
    for fname, cols in (("Advanced.csv", ("ws",)), ("Player Totals.csv", ("g", "pts"))):
        rows = [r for r in read(os.path.join(src, fname)) if r["lg"] == "NBA"]
        multi = {(r["player_id"], r["season"]) for r in rows if re.fullmatch(r"\dTM|TOT", r["team"])}
        for r in rows:
            if (r["player_id"], r["season"]) in multi and not re.fullmatch(r"\dTM|TOT", r["team"]):
                continue
            if fname == "Advanced.csv":
                ws[r["player_id"]] += num(r["ws"])
            else:
                games[r["player_id"]] += int(num(r["g"])); pts[r["player_id"]] += num(r["pts"])
    allstar = Counter(r["player_id"] for r in read(os.path.join(src, "All-Star Selections.csv")) if r["lg"] == "NBA")
    draft = {}
    for r in read(os.path.join(src, "Draft Pick History.csv")):
        if r["lg"] == "NBA" and r["player_id"] not in draft:
            draft[r["player_id"]] = r
    out = []
    for pid, seasons in teams.items():
        yrs = sorted(seasons)
        if yrs[-1] < MIN_LAST or games[pid] < 300:
            continue
        seq = []
        for k, y in enumerate(yrs):
            ts = seasons[y]
            if len(ts) > 1:   # alphabetical in the data: last season's team first, next season's team last
                before = seq[-1][1] if seq else None
                after = seasons[yrs[k + 1]] if k + 1 < len(yrs) else []
                ts = sorted(ts, key=lambda t: 0 if t == before else 2 if t in after else 1)
            seq += [(y, t) for t in ts]
        stops = compress(seq)
        franchises = {NBA.get(t, (t,))[0] for t, _, _ in stops}
        if len(franchises) < MIN_FRANCHISES:
            continue
        c = career.get(pid, {})
        name = c.get("player") or pid
        path = []
        for t, a, b in stops:
            info = NBA.get(t, (t, "#55606F", "#C4CED4", ""))
            path.append(stint(t, names_by.get((a, t)) or names_by.get((a + 1, t)) or t, info[1], info[2], info[3], a - 1, b))
        d = draft.get(pid)
        draft_txt = (f"{d['season']} · {ordinal(int(d['round']))} round, #{d['overall_pick']} by {names_by.get((int(d['season']), d['tm'])) or names_by.get((int(d['season']) + 1, d['tm'])) or d['tm']}"
                     if d and d["overall_pick"].isdigit() else "Undrafted")
        pos = " / ".join(dict.fromkeys(NBA_POS.get(p, p) for p in re.split(r"[-/]", c.get("pos", "")) if p and p != "NA"))
        college = (c.get("colleges") or "").split(",")[0].strip()
        line = f"{games[pid]:,} games, {pts[pid] / games[pid]:.1f} ppg" + (f" · {allstar[pid]}x All-Star" if allstar[pid] else "")
        fame = 0.45 * min(1, max(0, ws[pid]) / 90) + 0.3 * min(1, allstar[pid] / 4) + 0.25 * min(1, games[pid] / 1100)
        out.append({"n": name, "y": yrs[0] - 1, "s": path, "fr": len(franchises), "f": round(fame, 3), "line": line,
                    "h": [["Position", pos], ["College", college if college and college != "NA" else "No college"],
                          ["Draft", draft_txt], ["Career", line]]})
    return keep(out, "nba")


# ---- NFL
def build_nfl(src):
    rows = read(os.path.join(src, "nfl_paths.csv"))
    draft = read(os.path.join(src, "nfl_draft_picks.csv"))
    by_pfr = {r["pfr_player_id"]: r for r in draft if r.get("pfr_player_id")}
    by_gsis = {r["gsis_id"]: r for r in draft if r.get("gsis_id")}
    players = read(os.path.join(src, "nfl_players.csv"))
    gsis_of_pfr = {p["pfr_id"]: p["gsis_id"] for p in players if p.get("pfr_id") and p.get("gsis_id")}
    seen = defaultdict(list)     # player -> [(season, week, team)]
    info = {}
    weeks_active = Counter()
    for r in rows:
        key = r["gsis_id"] or gsis_of_pfr.get(r["pfr_id"]) or ("pfr:" + r["pfr_id"] if r["pfr_id"] else "name:" + r["name"] + "|" + r["college"])
        y, w = int(r["season"]), int(r["week"])
        code = NFL_CODE.get(r["team"], r["team"])
        if code == "HOU" and y < 2002:
            code = "HOI"
        if code not in NFL:
            continue
        # (Every roster status counts toward the path: some seasons list a healthy starter as reserve all year.)
        seen[key].append((y, w, code))
        if w and r["status"] == "ACT":
            weeks_active[key] += 1
        info.setdefault(key, {"name": r["name"], "pos": Counter(), "college": r["college"], "pfr": r["pfr_id"]})
        info[key]["pos"][r["position"]] += 1
        if r["pfr_id"]:
            info[key]["pfr"] = r["pfr_id"]
    out = []
    for key, stops_raw in seen.items():
        stops_raw = sorted(set(stops_raw))
        if stops_raw[-1][0] < MIN_LAST:
            continue
        seq = []
        for y, w, code in stops_raw:
            if not seq or seq[-1] != (y, code):
                seq.append((y, code))
        stops = compress(seq)
        franchises = {NFL[t][0] for t, _, _ in stops}
        if len(franchises) < MIN_FRANCHISES:
            continue
        i = info[key]
        d = by_gsis.get(key) or by_pfr.get(i["pfr"])
        if stops_raw[0][0] == 1990 and not (d and int(d["season"]) == 1990):
            continue   # the rosters start in 1990, so his path would be missing its first stops
        pre = sum(1 for y in {s[0] for s in stops_raw} if y < 2002)
        games = int(num(d.get("games"))) if d and d.get("games") else weeks_active[key] + 14 * pre
        if games < 50:
            continue
        pb, wav = (int(num(d.get("probowls"))), num(d.get("w_av"))) if d else (0, 0)
        path = [stint(t, nfl_name(t, a), NFL[t][2], NFL[t][3], NFL[t][4], a, b) for t, a, b in stops]
        pos_code = i["pos"].most_common(1)[0][0]
        if pos_code in ("K", "P", "LS"):
            continue   # kickers, punters and long snappers bounce around plenty, but nobody can name them
        draft_txt = "Undrafted"
        if d and d.get("team") and d.get("pick"):
            t = {"GNB": "GB", "KAN": "KC", "NWE": "NE", "NOR": "NO", "SFO": "SF", "TAM": "TB", "LVR": "LV", "SDG": "SD", "LAR": "LA"}.get(d["team"], d["team"])
            if t == "HOU" and int(d["season"]) < 2002:
                t = "HOI"
            if t in NFL:
                draft_txt = f"{d['season']} · {ordinal(int(d['round']))} round, #{d['pick']} by the {nfl_name(t, int(d['season']))}"
        line = f"{games} games" + (f" · {pb}x Pro Bowl" if pb else "")
        fame = 0.45 * min(1, games / 190) + 0.3 * min(1, pb / 4) + 0.25 * min(1, wav / 90)
        out.append({"n": i["name"], "y": stops[0][1], "s": path, "fr": len(franchises), "f": round(fame, 3), "line": line,
                    "h": [["Position", NFL_POS.get(pos_code, pos_code)], ["College", (d or {}).get("college") or i["college"] or "Unknown"],
                          ["Draft", draft_txt], ["Career", line]]})
    return keep(out, "nfl")


# ---- MLB
def build_mlb(src):
    m = lambda f: read(os.path.join(src, "mlb", f + ".csv"))
    tname, fran = {}, {}
    for r in m("Teams"):
        tname[(int(r["yearID"]), r["teamID"])] = r["name"]; fran[r["teamID"]] = r["franchID"]
    stints = defaultdict(set)
    bat, pit = defaultdict(lambda: Counter()), defaultdict(lambda: Counter())
    for r in m("Batting"):
        stints[r["playerID"]].add((int(r["yearID"]), int(float(r["stint"])), r["teamID"]))
        for k in ("G", "AB", "H", "HR", "RBI", "SB"):
            bat[r["playerID"]][k] += int(num(r[k]))
    for r in m("Pitching"):
        stints[r["playerID"]].add((int(r["yearID"]), int(float(r["stint"])), r["teamID"]))
        for k in ("G", "GS", "W", "L", "SV", "IPouts", "ER", "SO"):
            pit[r["playerID"]][k] += int(num(r[k]))
    games = Counter()
    pos = defaultdict(Counter)
    for r in m("Appearances"):
        games[r["playerID"]] += int(num(r["G_all"]))
        for k in ("p", "c", "1b", "2b", "3b", "ss", "lf", "cf", "rf", "dh"):
            pos[r["playerID"]][k] += int(num(r.get("G_" + k)))
    allstar = Counter(r["playerID"] for r in m("AllstarFull"))
    people = {r["playerID"]: r for r in m("People")}
    out = []
    for pid, ss in stints.items():
        ss = sorted(ss)
        if ss[-1][0] < MIN_LAST:
            continue
        pitcher = pos[pid].most_common(1)[0][0] == "p" if pos[pid] else False
        if (pit[pid]["G"] < 250 and pitcher) or (games[pid] < 400 and not pitcher):
            continue
        seq = []
        for y, _, t in ss:
            if not seq or seq[-1] != (y, t):
                seq.append((y, t))
        stops = compress(seq)
        franchises = {fran.get(t, t) for t, _, _ in stops}
        if len(franchises) < MIN_FRANCHISES:
            continue
        p = people.get(pid, {})
        name = f"{p.get('nameFirst', '')} {p.get('nameLast', '')}".strip()
        path = []
        for t, a, b in stops:
            c = MLB.get(t, ("#55606F", "#C4CED4", ""))
            path.append(stint(t, tname.get((a, t), t), c[0], c[1], c[2], a, b))
        if pitcher:
            ip = pit[pid]["IPouts"] / 3
            era = pit[pid]["ER"] * 9 / ip if ip else 0
            line = f"{pit[pid]['W']}-{pit[pid]['L']}, {era:.2f} ERA" + (f", {pit[pid]['SV']} saves" if pit[pid]["SV"] >= 20 else "") + f" in {pit[pid]['G']} games"
        else:
            avg = bat[pid]["H"] / bat[pid]["AB"] if bat[pid]["AB"] else 0
            line = f"{('%.3f' % avg).lstrip('0')} average, {bat[pid]['HR']} HR, {bat[pid]['H']:,} hits"
        if allstar[pid]:
            line += f" · {allstar[pid]}x All-Star"
        country = p.get("birthCountry", "")
        born = ", ".join(x for x in (p.get("birthCity"), p.get("birthState") if country == "USA" else country) if x and x != "NA")
        debut = (p.get("debut") or "")[:4]
        age = int(debut) - int(num(p.get("birthYear"))) if debut and num(p.get("birthYear")) else None
        top = pos[pid].most_common(1)[0][0] if pos[pid] else ""
        posname = MLB_POS.get(top, "")
        if top == "p":
            posname = "Starting pitcher" if pit[pid]["GS"] >= pit[pid]["G"] / 2 else "Relief pitcher"
        value = (pit[pid]["W"] / 200 + pit[pid]["SV"] / 300) if pitcher else (bat[pid]["H"] / 2500 + bat[pid]["HR"] / 450)
        fame = 0.4 * min(1, value) + 0.35 * min(1, allstar[pid] / 5) + 0.25 * min(1, games[pid] / 2000)
        out.append({"n": name, "y": stops[0][1], "s": path, "fr": len(franchises), "f": round(fame, 3), "line": line,
                    "h": [["Position", posname], ["Born", born or "Unknown"],
                          ["Debut", f"{debut}, at {age}" if debut and age else debut or "Unknown"], ["Career", line]]})
    # Every MLB name since 1980 for the guess box, best careers first
    known = {}
    for pid, p in people.items():
        if (p.get("finalGame") or "")[:4] >= "1980":
            nm = f"{p.get('nameFirst', '')} {p.get('nameLast', '')}".strip()
            score = games[pid] + 300 * allstar[pid]
            if nm and (nm not in known or known[nm] < score):
                known[nm] = score
    names = [n for n, _ in sorted(known.items(), key=lambda kv: (-kv[1], kv[0]))]
    return keep(out, "mlb"), names


# The board shows the city as the destination and the nickname under it
MULTI_WORD = ("Red Sox", "White Sox", "Blue Jays", "Trail Blazers", "Devil Rays", "Football Team")
CITY_SHORT = {"New Orleans/Oklahoma City": "New Orleans"}


def city_nick(name):
    if name.endswith(" of Anaheim"):
        name = name[: -len(" of Anaheim")]
    for m in MULTI_WORD:
        if name.endswith(" " + m):
            return CITY_SHORT.get(name[: -len(m) - 1], name[: -len(m) - 1]), m
    if " " not in name:
        return name, ""
    city, nick = name.rsplit(" ", 1)
    return CITY_SHORT.get(city, city), nick


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    src = ap.parse_args().src
    data = {"built": datetime.now(timezone.utc).strftime("%Y-%m-%d")}
    data["nba"] = build_nba(src)
    data["nfl"] = build_nfl(src)
    data["mlb"], mlb_names = build_mlb(src)
    for k in ("nba", "nfl", "mlb"):
        table, index = [], {}
        for p in data[k]:
            p["h"] = p["h"][:3]          # the career line is p["line"]; the game shows it as the fourth hint
            stops = []
            for st in p["s"]:
                tk = (st["t"], st["n"])
                if tk not in index:
                    index[tk] = len(table)
                    table.append([st["t"], st["n"], st["c"][0], st["c"][1], st["l"]] + list(city_nick(st["n"])))
                stops.append([index[tk], st["a"], st["b"]])
            p["s"] = stops
        data[k + "_teams"] = table
    for k in ("nba", "nfl", "mlb"):
        ps = data[k]
        print(f"{k.upper()}: {len(ps)} journeymen, {sum(len(p['s']) for p in ps) / len(ps):.1f} stops on average; "
              f"most known: {', '.join(p['n'] for p in ps[:6])}")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* Generated by tools/journeyman_build.py. Don't edit by hand. */\n")
        f.write("window.JM_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    with open(NAMES_OUT, "w", encoding="utf-8") as f:
        f.write("/* Generated by tools/journeyman_build.py. Every MLB name since 1980 the guess box knows, best careers first. */\n")
        f.write("window.GTP_NAMES = window.GTP_NAMES || {};\nwindow.GTP_NAMES.mlb = " + json.dumps(mlb_names, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("Wrote", os.path.relpath(OUT, ROOT), f"({os.path.getsize(OUT) // 1024} KB) and", os.path.relpath(NAMES_OUT, ROOT),
          f"({os.path.getsize(NAMES_OUT) // 1024} KB, {len(mlb_names)} names)")


if __name__ == "__main__":
    main()
