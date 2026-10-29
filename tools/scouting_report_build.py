"""Builds scouting-report/data.js: every prospect in Scouting Report, his pre-draft report and how it really went.

Run it from the repo root, after downloading Journeyman's sources:
  python3 tools/journeyman_fetch.py DIR
  python3 tools/scouting_report_build.py --src DIR
  node tools/scouting_report_check.js

Two inputs:
  tools/scouting_reports.json   the reports (written by hand, one per prospect): id, league, angle (pan or glow),
                                the report and a one-line projection. Add a prospect by adding an entry; the id is
                                his Pro Football Reference id (NFL) or Basketball Reference id (NBA).
  DIR                           the nflverse and basketball-reference downloads, for everything that's a fact:
                                draft slot, team, college, size and the career numbers shown at the reveal.
The kind (steal, bust or star) is worked out from the career, so the reveal always matches the numbers:
  steal  picked 60th or later in the NFL (14th or later in the NBA) and a real career
  bust   a top pick (or a first-round quarterback) who didn't pan out
  star   a top pick who did
Careers must be at least five years old (drafted 2021 or before) so a verdict means something.
"""
import argparse, csv, json, os, re
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS = os.path.join(ROOT, "tools", "scouting_reports.json")
OUT = os.path.join(ROOT, "scouting-report", "data.js")

NFL_TEAMS = {"ARI": "Arizona Cardinals", "PHO": "Arizona Cardinals", "ATL": "Atlanta Falcons", "BAL": "Baltimore Ravens", "BUF": "Buffalo Bills",
             "CAR": "Carolina Panthers", "CHI": "Chicago Bears", "CIN": "Cincinnati Bengals", "CLE": "Cleveland Browns", "DAL": "Dallas Cowboys",
             "DEN": "Denver Broncos", "DET": "Detroit Lions", "GNB": "Green Bay Packers", "HOU": "Houston Texans", "IND": "Indianapolis Colts",
             "JAX": "Jacksonville Jaguars", "KAN": "Kansas City Chiefs", "LAC": "Los Angeles Chargers", "SDG": "San Diego Chargers",
             "LAR": "Los Angeles Rams", "STL": "St. Louis Rams", "RAM": "St. Louis Rams", "LVR": "Las Vegas Raiders", "OAK": "Oakland Raiders",
             "MIA": "Miami Dolphins", "MIN": "Minnesota Vikings", "NWE": "New England Patriots", "NOR": "New Orleans Saints",
             "NYG": "New York Giants", "NYJ": "New York Jets", "PHI": "Philadelphia Eagles", "PIT": "Pittsburgh Steelers",
             "SEA": "Seattle Seahawks", "SFO": "San Francisco 49ers", "TAM": "Tampa Bay Buccaneers", "TEN": "Tennessee Titans",
             "WAS": "Washington"}
NFL_POS = {"QB": "Quarterback", "RB": "Running back", "FB": "Fullback", "WR": "Wide receiver", "TE": "Tight end", "T": "Offensive tackle",
           "OT": "Offensive tackle", "G": "Guard", "OG": "Guard", "C": "Center", "OL": "Offensive line", "DE": "Defensive end",
           "DT": "Defensive tackle", "NT": "Nose tackle", "DL": "Defensive line", "LB": "Linebacker", "OLB": "Outside linebacker",
           "ILB": "Inside linebacker", "CB": "Cornerback", "S": "Safety", "SAF": "Safety", "DB": "Defensive back", "EDGE": "Edge rusher"}
NBA_POS = {"G": "Guard", "F": "Forward", "C": "Center", "PG": "Point guard", "SG": "Shooting guard", "SF": "Small forward", "PF": "Power forward"}


def read(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def feet(inches):
    inches = int(round(inches))
    return f"{inches // 12}-{inches % 12}" if inches else ""


def nfl(src, want):
    players = {p["pfr_id"]: p for p in read(os.path.join(src, "nfl_players.csv")) if p.get("pfr_id")}
    out = {}
    for r in read(os.path.join(src, "nfl_draft_picks.csv")):
        pid = r["pfr_player_id"]
        if pid not in want:
            continue
        y, pk = int(r["season"]), int(r["pick"])
        g, pb, ap, wav = int(num(r["games"])), int(num(r["probowls"])), int(num(r["allpro"])), num(r["w_av"])
        pos = r["position"]
        p = players.get(pid, {})
        h, w = num(p.get("height")), num(p.get("weight"))
        # The career line that matters for his position
        if pos == "QB":
            stat = f"{int(num(r['pass_yards'])):,} passing yards, {int(num(r['pass_tds']))} TD, {int(num(r['pass_ints']))} INT"
        elif pos in ("RB", "FB"):
            stat = f"{int(num(r['rush_yards'])):,} rushing yards, {int(num(r['rush_tds']))} TD"
        elif pos in ("WR", "TE"):
            stat = f"{int(num(r['receptions']))} catches, {int(num(r['rec_yards'])):,} yards, {int(num(r['rec_tds']))} TD"
        elif pos in ("DE", "DT", "NT", "DL", "LB", "OLB", "ILB", "EDGE"):
            stat = f"{num(r['def_sacks']):g} sacks, {int(num(r['def_solo_tackles']))} solo tackles"
        elif pos in ("CB", "S", "SAF", "DB"):
            stat = f"{int(num(r['def_ints']))} interceptions, {int(num(r['def_solo_tackles']))} solo tackles"
        else:
            stat = f"{int(num(r['seasons_started']))} seasons as a starter"
        honors = [x for x in (f"{pb}x Pro Bowl" if pb else "", f"{ap}x All-Pro" if ap else "", "Hall of Fame" if r["hof"] == "TRUE" else "") if x]
        if pos == "QB" and pk <= 32 and wav <= 22:
            kind = "bust"
        elif pk >= 60 and (wav >= 75 or pb >= 4):
            kind = "steal"
        elif pk <= 12 and wav <= 28:
            kind = "bust"
        else:
            kind = "star" if pb >= 3 or wav >= 70 else "bust" if pk <= 20 else "steal"
        out[pid] = {"lg": "nfl", "n": r["pfr_player_name"], "y": y, "rd": int(r["round"]), "pk": pk,
                    "tm": NFL_TEAMS.get(r["team"], r["team"]), "col": r["college"], "pos": NFL_POS.get(pos, pos),
                    "size": (f"{feet(h)}, {int(w)} lb" if h and w else ""), "g": g, "stat": stat, "hon": honors,
                    "kind": kind, "v": round(wav)}
    return out


def nba(src, want):
    draft = {r["player_id"]: r for r in read(os.path.join(src, "Draft Pick History.csv")) if r["lg"] == "NBA" and r["player_id"] in want}
    career = {r["player_id"]: r for r in read(os.path.join(src, "Player Career Info.csv"))}
    names = {}
    for r in read(os.path.join(src, "Team Abbrev.csv")):
        if r["lg"] == "NBA":
            names[(int(r["season"]), r["abbreviation"])] = r["team"]
    tot, ws = defaultdict(Counter), defaultdict(float)
    for fname in ("Player Totals.csv", "Advanced.csv"):
        rows = [r for r in read(os.path.join(src, fname)) if r["lg"] == "NBA" and r["player_id"] in want]
        multi = {(r["player_id"], r["season"]) for r in rows if re.fullmatch(r"\dTM|TOT", r["team"])}
        for r in rows:
            if (r["player_id"], r["season"]) in multi and not re.fullmatch(r"\dTM|TOT", r["team"]):
                continue
            if fname == "Advanced.csv":
                ws[r["player_id"]] += num(r["ws"])
            else:
                for k in ("g", "pts", "trb", "ast"):
                    tot[r["player_id"]][k] += num(r[k])
    asg = Counter(r["player_id"] for r in read(os.path.join(src, "All-Star Selections.csv")) if r["lg"] == "NBA")
    out = {}
    for pid, d in draft.items():
        y, pk = int(d["season"]), int(d["overall_pick"])
        c, t = career.get(pid, {}), tot[pid]
        g = int(t["g"])
        per = lambda k: t[k] / g if g else 0
        stat = f"{per('pts'):.1f} points, {per('trb'):.1f} rebounds, {per('ast'):.1f} assists a game" if g else "Never played an NBA game"
        honors = [x for x in (f"{asg[pid]}x All-Star" if asg[pid] else "", "Hall of Fame" if c.get("hof") == "TRUE" else "") if x]
        w, a = ws[pid], asg[pid]
        kind = "steal" if pk >= 14 and (w >= 55 or a >= 2) else "bust" if pk <= 6 and w <= 14 else "star" if a >= 3 or w >= 60 else "bust" if pk <= 10 else "steal"
        pos = " / ".join(dict.fromkeys(NBA_POS.get(p, p) for p in re.split(r"[-/]", c.get("pos", "")) if p and p != "NA"))
        col = d.get("college") or ""
        out[pid] = {"lg": "nba", "n": d["player"], "y": y, "rd": int(num(d["round"])), "pk": pk,
                    "tm": names.get((y + 1, d["tm"])) or names.get((y, d["tm"])) or d["tm"],
                    "col": col if col and col != "NA" else "No college (international)", "pos": pos,
                    "size": (f"{feet(num(c.get('ht_in_in')))}, {int(num(c.get('wt')))} lb" if num(c.get("ht_in_in")) else ""),
                    "g": g, "stat": stat, "hon": honors, "kind": kind, "v": round(w, 1)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    a = ap.parse_args()
    reports = json.load(open(REPORTS, encoding="utf-8"))
    want = {lg: {r["id"] for r in reports if r["lg"] == lg} for lg in ("nfl", "nba")}
    facts = {**nfl(a.src, want["nfl"]), **nba(a.src, want["nba"])}
    rows, missing = [], []
    for r in reports:
        f = facts.get(r["id"])
        if not f or f["y"] > 2021:
            missing.append(r["id"]); continue
        # The scouts were right when they panned a bust or praised a star or a steal
        right = (r["angle"] == "pan") == (f["kind"] == "bust")
        rows.append({**f, "id": r["id"], "angle": r["angle"], "rep": r["report"], "proj": r["projection"], "right": right})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("/* Scouting Report: every prospect, his report and his real career. Built by tools/scouting_report_build.py "
                 "from tools/scouting_reports.json; don't edit by hand. */\nwindow.SR_DATA = ")
        json.dump(rows, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write(";\n")
    k = Counter((x["lg"], x["kind"], "right" if x["right"] else "wrong") for x in rows)
    print(len(rows), "prospects;", dict(k))
    if missing:
        print("No draft data for:", ", ".join(missing))


if __name__ == "__main__":
    main()
