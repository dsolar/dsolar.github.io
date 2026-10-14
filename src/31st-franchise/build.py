"""Build the 2027-28 expansion pool from Basketball-Reference pulls (Oct 13, 2026).

Inputs:  contracts.txt (team|name|age|26-27|27-28|28-29|29-30|notes)
         stats_pg.txt  (team|name|pos|age|G|MPG|PTS|TRB|AST)   2025-26 per game
         adv.txt       (name|MP|OBPM|DBPM)                     2025-26, players with 1,160+ minutes
Output:  players.json  (every player under contract for 2027-28 plus 2023 first-round RFAs)
"""
import json, re, unicodedata
import numpy as np

def key(n):
    n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode()
    n = n.lower().replace(".", "").replace("'", "")
    n = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", n)
    return re.sub(r"[^a-z]", "", n)

def num(x):
    x = x.strip().replace("$", "").replace("M", "")
    return float(x) if x else None

# ---------- contracts ----------
contracts = []
for line in open("contracts.txt"):
    p = line.rstrip("\n").split("|")
    if len(p) < 7: continue
    team, name, age = p[0], p[1], p[2]
    s = [num(v) for v in p[3:7]]
    notes = p[7] if len(p) > 7 else ""
    contracts.append(dict(team=team, name=name, age=int(age) if age.strip() else None,
                          s26=s[0], s27=s[1], s28=s[2], s29=s[3], notes=notes))

# ---------- per-game stats (combine stints) ----------
pg = {}
for line in open("stats_pg.txt"):
    t, name, pos, age, g, mpg, pts, trb, ast = line.rstrip("\n").split("|")
    g, mpg, pts, trb, ast = int(g), float(mpg), float(pts), float(trb), float(ast)
    k = key(name)
    d = pg.setdefault(k, dict(name=name, age=int(age), g=0, min=0, pts=0, trb=0, ast=0, posg={}))
    d["g"] += g; d["min"] += g * mpg
    d["pts"] += g * pts; d["trb"] += g * trb; d["ast"] += g * ast
    d["posg"][pos] = d["posg"].get(pos, 0) + g
for d in pg.values():
    d["mpg"] = d["min"] / d["g"]
    d["ppg"], d["rpg"], d["apg"] = d["pts"] / d["g"], d["trb"] / d["g"], d["ast"] / d["g"]
    d["pos"] = max(d["posg"], key=d["posg"].get)

adv = {}
for line in open("adv.txt"):
    name, mp, o, dd = line.rstrip("\n").split("|")
    adv[key(name)] = dict(mp=float(mp), o=float(o), d=float(dd))

# ---------- position splits (share of minutes at each spot) and rate stats, 2025-26 ----------
POSN = ["PG", "SG", "SF", "PF", "C"]
pbp = {}
for line in open("pbp.txt"):
    f = line.rstrip("\n").split("|")
    shares = dict(zip(POSN, map(float, f[2:7])))
    pbp[key(f[0])] = shares
rates = {}
for line in open("adv2.txt"):
    n, ts, tpar, astp, blkp, usg = line.rstrip("\n").split("|")
    rates[key(n)] = dict(ts=float(ts), tpar=float(tpar), ast=float(astp), blk=float(blkp), usg=float(usg))

# ---------- regression: box score -> OBPM / DBPM (fit on 1,160+ minute players) ----------
def feats(d):
    per36 = 36 / max(d["mpg"], 1)
    big = 1 if d["pos"] == "C" else 0
    guard = 1 if d["pos"] in ("PG", "SG") else 0
    return [1, d["ppg"] * per36, d["rpg"] * per36, d["apg"] * per36, d["mpg"], big, guard]

X, yo, yd, w = [], [], [], []
for k, a in adv.items():
    if k in pg:
        X.append(feats(pg[k])); yo.append(a["o"]); yd.append(a["d"]); w.append(a["mp"])
X, yo, yd, W = np.array(X), np.array(yo), np.array(yd), np.sqrt(np.array(w))
bo = np.linalg.lstsq(X * W[:, None], yo * W, rcond=None)[0]
bd = np.linalg.lstsq(X * W[:, None], yd * W, rcond=None)[0]
pred_o, pred_d = X @ bo, X @ bd
print("fit R^2  OBPM %.2f  DBPM %.2f  on %d players" % (
    1 - np.var(yo - pred_o) / np.var(yo), 1 - np.var(yd - pred_d) / np.var(yd), len(yo)))

# Estimate usage and assist rate from per-36 box stats for players outside the measured table
XU, yu, ya = [], [], []
for k, r in rates.items():
    if k in pg and pg[k]["mpg"] > 0:
        d = pg[k]; m = 36 / d["mpg"]
        XU.append([1, d["ppg"] * m, d["apg"] * m]); yu.append(r["usg"]); ya.append(r["ast"])
XU = np.array(XU)
bu = np.linalg.lstsq(XU, np.array(yu), rcond=None)[0]
ba = np.linalg.lstsq(XU, np.array(ya), rcond=None)[0]
POS_DEFAULT = {"PG": dict(tpar=.42, blk=0.6, ts=.55), "SG": dict(tpar=.48, blk=0.8, ts=.56), "SF": dict(tpar=.45, blk=1.2, ts=.56),
               "PF": dict(tpar=.36, blk=2.0, ts=.57), "C": dict(tpar=.15, blk=3.5, ts=.60)}

# Partial 2025-26 seasons: rate profiles from prior seasons (usage, assist%, block%, 3PA rate)
RATE_OVR = {key(n): v for n, v in {
    "Trae Young": dict(usg=30.0, ast=44.0, blk=0.3, tpar=.50, ts=.57), "Anthony Davis": dict(usg=28.0, ast=15.0, blk=4.5, tpar=.12, ts=.60),
    "Ja Morant": dict(usg=31.0, ast=38.0, blk=0.8, tpar=.30, ts=.56), "Kristaps Porzingis": dict(usg=24.0, ast=10.0, blk=4.0, tpar=.48, ts=.60),
    "Dejounte Murray": dict(usg=26.0, ast=30.0, blk=0.8, tpar=.38, ts=.53), "Kyrie Irving": dict(usg=28.0, ast=26.0, blk=1.0, tpar=.45, ts=.60),
    "Jalen Green": dict(usg=27.0, ast=16.0, blk=0.6, tpar=.45, ts=.55), "Damian Lillard": dict(usg=29.0, ast=31.0, blk=0.6, tpar=.55, ts=.60),
    "Zach Edey": dict(usg=19.0, ast=6.0, blk=5.0, tpar=.01, ts=.65), "Dereck Lively II": dict(usg=13.0, ast=11.0, blk=5.0, tpar=.00, ts=.70),
    "Walker Kessler": dict(usg=14.0, ast=8.0, blk=7.5, tpar=.01, ts=.68), "Tyrese Haliburton": dict(usg=24.0, ast=42.0, blk=1.6, tpar=.52, ts=.60),
    "Jayson Tatum": dict(usg=30.0, ast=27.0, blk=1.6, tpar=.45, ts=.59), "Giannis Antetokounmpo": dict(usg=34.0, ast=31.0, blk=2.6, tpar=.07, ts=.64),
    "Franz Wagner": dict(usg=27.0, ast=24.0, blk=1.0, tpar=.30, ts=.57), "Jalen Williams": dict(usg=26.0, ast=25.0, blk=1.6, tpar=.30, ts=.59),
    "Fred VanVleet": dict(usg=21.0, ast=30.0, blk=1.6, tpar=.60, ts=.55)}.items()}

def rate_profile(k, st, p5):
    if k in RATE_OVR:
        return dict(RATE_OVR[k], m=1)
    if k in rates:
        return dict(rates[k], m=1)
    dflt = POS_DEFAULT.get(p5 or "SF")
    if st and st["mpg"] > 0:
        m = 36 / st["mpg"]; x = np.array([1, st["ppg"] * m, st["apg"] * m])
        w = st["min"] / (st["min"] + 400)
        usg = w * float(x @ bu) + (1 - w) * 17.0
        ast = w * float(x @ ba) + (1 - w) * 12.0
    else:
        usg, ast = 17.0, (20.0 if p5 == "PG" else 12.0)
    return dict(ts=dflt["ts"], tpar=dflt["tpar"], ast=round(max(3, ast), 1), blk=dflt["blk"], usg=round(min(max(usg, 10), 32), 1), m=0)

def positions(k, p5, st):
    """Positions a player can man without a penalty: from minute shares where we have them, else from his profile."""
    if k in pbp:
        sh = pbp[k]; order = sorted(POSN, key=lambda x: -sh[x])
        return [x for x in order if sh[x] >= 15] or [order[0]]
    r36 = st["rpg"] * 36 / st["mpg"] if st and st["mpg"] > 0 else None
    a36 = st["apg"] * 36 / st["mpg"] if st and st["mpg"] > 0 else None
    ps = [p5]
    if p5 == "PG":
        if a36 is None or a36 < 6.5: ps.append("SG")
    elif p5 == "SG":
        if a36 is not None and a36 >= 5: ps.append("PG")
        if a36 is None or a36 < 5 or (r36 or 0) >= 4.5: ps.append("SF")
    elif p5 == "SF":
        if r36 is not None and r36 >= 7: ps.append("PF")
        if r36 is None or r36 < 7.5: ps.append("SG")
    elif p5 == "PF":
        if r36 is None or r36 < 9: ps.append("SF")
        if r36 is not None and r36 >= 9.5: ps.append("C")
    elif p5 == "C":
        if r36 is None or r36 < 11 or (a36 or 0) >= 3: ps.append("PF")
    return ps

REPL_O, REPL_D = -2.0, -0.5   # replacement-level prior

def base_rating(k):
    """2025-26 offense/defense impact, shrunk toward replacement for small samples."""
    if k in adv and k in pg:
        a = adv[k]; return a["o"], a["d"], "bpm"
    if k in pg:
        d = pg[k]; f = np.array(feats(d)); o, dd = float(f @ bo), float(f @ bd)
        mins = d["min"]; wgt = mins / (mins + 500)
        return wgt * o + (1 - wgt) * REPL_O, wgt * dd + (1 - wgt) * REPL_D, "box"
    return None

# Players with no 2025-26 stats (injured all year or 2026 rookies): hand priors (offense, defense, note)
MANUAL = {
    key("Tyrese Haliburton"): (4.5, -0.1, "Missed 2025-26 (Achilles). CraftedNBA CPM from 2024-25"),
    key("Damian Lillard"): (4.4, -1.0, "Missed 2025-26 (Achilles). CraftedNBA CPM, prior three seasons"),
    key("Fred VanVleet"): (1.0, 1.85, "Missed 2025-26 (ACL). CraftedNBA CPM, prior two seasons"),
    key("Kyrie Irving"): (3.8, -0.2, "Missed 2025-26 (ACL). CraftedNBA CPM, prior two seasons"),
    key("Jayson Tatum"): (3.5, 0.8, "Played 16 games in 2025-26 (Achilles)"),
    key("Dejounte Murray"): (0.6, -1.0, "Played 14 games in 2025-26 (Achilles). CraftedNBA CPM"),
}

# Partial 2025-26 seasons where the box-score estimate badly misses a player's established level.
# Values are 2025-26-equivalent offense/defense impact (my estimates from prior seasons), before aging.
PARTIAL = {
    # CraftedNBA CPM (offense, defense), three-season blend weighted 3-2-1 toward 2025-26, lighter where minutes were thin
    key("Anthony Davis"): (1.4, 2.4), key("Ja Morant"): (3.0, -0.1), key("Trae Young"): (3.4, -2.75),
    key("Kristaps Porzingis"): (1.6, 1.8), key("Jalen Green"): (0.9, -1.4), key("Walker Kessler"): (-0.3, 1.7),
    key("Zach Edey"): (-0.6, 1.5), key("Dereck Lively II"): (0.4, 1.8), key("Ivica Zubac"): (0.1, 2.2),
    key("Paul George"): (1.2, 1.6), key("Joel Embiid"): (2.87, 1.62), key("De'Aaron Fox"): (2.0, 0.4),
}
PARTIAL_NOTE = {key("Jaren Jackson Jr."): "Down 2025-26. Rating blends three seasons and credits rim protection that box stats miss",
                key("De'Aaron Fox"): "Rating from CraftedNBA CPM"}

# Games played over the last three seasons (2023-24, 2024-25, 2025-26) for players with real injury history.
# Availability comes from this instead of one season; talent ratings are untouched.
GAMES3 = {key(n): g for n, g in {
    "Joel Embiid": (39, 19, 38), "Paul George": (74, 41, 37), "Anthony Davis": (76, 51, 20), "Kawhi Leonard": (68, 37, 65),
    "Zion Williamson": (70, 30, 62), "Ja Morant": (9, 50, 20), "Kyrie Irving": (58, 50, 0), "Damian Lillard": (73, 58, 0),
    "Tyrese Haliburton": (69, 73, 0), "Jayson Tatum": (74, 72, 16), "Jimmy Butler": (60, 55, 38), "Kristaps Porzingis": (57, 42, 32),
    "Jalen Williams": (71, 69, 33), "LaMelo Ball": (22, 47, 72), "Darius Garland": (57, 75, 45), "Trae Young": (54, 76, 15),
    "Dejounte Murray": (78, 31, 14), "Fred VanVleet": (73, 60, 0), "Robert Williams III": (6, 20, 59), "Walker Kessler": (64, 58, 5),
    "Stephen Curry": (74, 70, 43), "Giannis Antetokounmpo": (73, 67, 36), "Franz Wagner": (72, 60, 34), "Brandon Ingram": (64, 18, 77),
    "Jrue Holiday": (69, 62, 53), "Dereck Lively II": (55, 36, 7), "Zach Edey": (66, 66, 11), "Jaren Jackson Jr.": (66, 74, 48),
    "Ivica Zubac": (68, 80, 48), "Christian Braun": (82, 79, 44), "Tyler Herro": (42, 77, 33), "Bradley Beal": (53, 53, 6)}.items()}

# ---------- All-in-one impact metrics ----------
# DARKO DPM (darko.app, through Jun 3 2026): team pages for everyone, the live leaderboard for the top 50
DARKO = {}
for line in open("darko_team.txt"):
    t, n, o, d, tot = line.strip().split("|"); DARKO[key(n)] = (float(o), float(d))
ALIAS = {key("Nicolas Claxton"): key("Nic Claxton"), key("Ronald Holland II"): key("Ron Holland"), key("Nah'Shon Hyland"): key("Bones Hyland")}
DARKO = {ALIAS.get(k, k): v for k, v in DARKO.items()}
for line in open("darko_lb.txt"):
    n, o, d, tot = line.strip().split("|"); DARKO[key(n)] = (float(o), float(d))
# Time-decay RAPM (nbarapm.com), top 100. RAPM runs hotter than DARKO, so it's scaled by 0.8.
# Anyone outside the top 100 is below about +1.5, which caps what RAPM can say about him.
RAPM = {}
for line in open("rapm.txt"):
    n, o, d = line.strip().split("|"); RAPM[key(n)] = (0.8 * float(o), 0.8 * float(d))
RAPM_CAP = 0.8 * 1.4

def rookie_prior(sal27):
    # 2026 draftees: second-year projection keyed off rookie-scale salary (draft slot)
    if sal27 >= 12: return (-0.8, -0.4)
    if sal27 >= 8: return (-1.4, -0.6)
    if sal27 >= 5: return (-1.9, -0.7)
    if sal27 >= 3: return (-2.3, -0.8)
    return (-2.7, -0.9)

def age_step(age):
    """Expected one-season change in DARKO-style impact for a player this age: Stephen Noh's aging curve
    (github.com/StephenNoh/nbasalarymodel), so ratings and contract values age the same way."""
    if age < 21: return 0.65
    table = {21: 0.5, 22: 0.45, 23: 0.40, 24: 0.10, 25: 0.10, 26: 0.10, 27: 0.0, 28: 0.0,
             29: -0.05, 30: -0.1, 31: -0.2, 32: -0.3, 33: -0.45, 34: -0.65, 35: -0.9}
    return table.get(age, -1.2)

# ---------- contract value: Stephen Noh's salary model ----------
# value = games x minutes / 1475 x (impact + 3) x $4.32M per win (2025-26 dollars), +/-10% at the extremes,
# scaled by his cap-inflation factors; under $3M is a minimum player. Minutes: half last season's role, half the
# role his impact earns. Games: his availability.
NOH_INFL = {2027: 1.127, 2028: 1.184, 2029: 1.240}
def role_minutes(d):
    return 34 if d >= 4 else 32 if d >= 2 else 30 if d >= 1 else 25 if d >= -0.9 else 17 if d >= -2 else 10
def noh_value(d, games, mpg, season):
    v = games * mpg / 1475 * (d + 3.0) * 4.32
    boost = min(0.10, (abs(d) / 4) ** 1.2 * 0.10)
    v *= (1 + boost) if d > 0 else (1 - boost) if d < 0 else 1
    v *= NOH_INFL[season]
    return max(v, 0.0) if v >= 3.0 * NOH_INFL[season] else 2.6

# 2023 first-round picks still on rookie deals that end after 2026-27 -> restricted free agents in 2027
RFA_2023 = {key(n) for n in ["Brandon Miller", "Scoot Henderson", "Anthony Black", "Bilal Coulibaly", "Jarace Walker",
    "Taylor Hendricks", "Cason Wallace", "Dereck Lively II", "Gradey Dick", "Jaime Jaquez Jr.", "Noah Clowney",
    "Kris Murray", "Marcus Sasser", "Ben Sheppard", "Brice Sensabaugh", "Julian Strawther", "Kobe Bufkin"]}

def market_value(bpm, age):
    """Rough 2027-28 market salary ($M) for a free agent of this impact and age."""
    v = 17 + 6.5 * bpm - (0.8 * (age - 30) if age > 30 else 0)
    return float(min(max(v, 2.3), 52))

def pos_bucket(pos, rpg, mpg):
    if pos in ("PG", "SG"): return "G"
    if pos == "C": return "B"
    if pos == "PF" and rpg * 36 / max(mpg, 1) >= 9: return "B"
    return "W"

TEAM_NAMES = {"ATL":"Atlanta Hawks","BOS":"Boston Celtics","BRK":"Brooklyn Nets","CHO":"Charlotte Hornets","CHI":"Chicago Bulls",
 "CLE":"Cleveland Cavaliers","DAL":"Dallas Mavericks","DEN":"Denver Nuggets","DET":"Detroit Pistons","GSW":"Golden State Warriors",
 "HOU":"Houston Rockets","IND":"Indiana Pacers","LAC":"LA Clippers","LAL":"Los Angeles Lakers","MEM":"Memphis Grizzlies",
 "MIA":"Miami Heat","MIL":"Milwaukee Bucks","MIN":"Minnesota Timberwolves","NOP":"New Orleans Pelicans","NYK":"New York Knicks",
 "OKC":"Oklahoma City Thunder","ORL":"Orlando Magic","PHI":"Philadelphia 76ers","PHO":"Phoenix Suns","POR":"Portland Trail Blazers",
 "SAC":"Sacramento Kings","SAS":"San Antonio Spurs","TOR":"Toronto Raptors","UTA":"Utah Jazz","WAS":"Washington Wizards"}

# Two-way players (July 2026 tracker). Anyone already on a standard deal keeps that row.
have = {key(c["name"]) for c in contracts}
for line in open("twoway.txt"):
    t, n = line.strip().split("|")
    if key(n) in have: continue
    st0 = pg.get(key(n))
    contracts.append(dict(team=t, name=n, age=(st0["age"] + 1) if st0 else None, s26=None, s27=None, s28=None, s29=None, notes="", tw=True))

# Listed positions for players with no 2025-26 NBA stats (2026 rookies, injured vets, two-way players)
POS5 = {k: v for k, v in (x.split(":") for x in """Aday Mara:C|Thomas Sorber:C|Bennett Stirtz:PG|Christoph Tilly:C|Kingston Flemings:PG|Zuby Ejiofor:PF|Henri Veesaar:C|Chris Cenac Jr.:PF|Tucker DeVries:SF|Milos Uzan:PG|Mikel Brown Jr.:PG|Joshua Jefferson:PF|Hannes Steinbach:PF|Christian Anderson Jr.:PG|Caleb Wilson:PF|Noa Essengue:PF|Dailyn Swain:SF|Khalifa Diop:C|Meleek Thomas:SG|Kyrie Irving:PG|Morez Johnson Jr.:PF|Sergio de Larrea:PG|Tarik Biberovic:SF|Trevon Brazile:PF|Ebuka Okorie:PG|Yaxel Lendeborg:PF|Alex Toohey:SF|Bruce Thornton:PG|Tyrese Haliburton:PG|Keba Keita:C|Keaton Wagler:SG|Baba Miller:PF|Cameron Carr:SG|Cameron Boozer:PF|Karim Lopez:SF|Ryan Conwell:SG|Isaiah Evans:SF|Brayden Burries:SG|Nate Ament:SF|Bogoljub Markovic:PF|Labaron Philon Jr.:PG|Koa Peat:PF|Damian Lillard:PG|Darius Acuff Jr.:PG|Alex Karaban:PF|Emanuel Sharp:SG|Jayden Quaintance:C|Tarris Reed Jr.:C|Allen Graves:PF|Jaden Bradley:PG|Nate Bittle:C|Darryn Peterson:SG|Mo Bamba:C|AJ Dybantsa:SF|RayJ Dennis:PG|Keshon Gilbert:PG|Chaney Johnson:SF|Tyler Bilodeau:PF|Michael Ajayi:SF|Kylan Boswell:PG|Tobe Awaka:PF|Jaylin Sellers:SG|Tristan Enaruna:SF|Riley Minix:SF|Ernest Udeh Jr.:C|John Poulakidas:SG|Tyler Smith:PF|Tobi Lawal:PF|Isaac Jones:PF|Ugonna Onyenso:C|LJ Cryer:SG|Malevy Leons:SF|Tristen Newton:PG|Ethan Thompson:SG|Sean Pedulla:PG|Nick Martinelli:SF|Chris Manon:SG|AK Okereke:SF|Peter Suder:SF|Javon Small:PG|Jahmai Mashack:SG|Tre Donaldson:PG|Cormac Ryan:SG|Kam Jones:SG|Rocco Zikarsky:C|Zyon Pullin:SG|Enrique Freeman:PF|Brooks Barnhizer:SG|Josh Dix:SG|Otega Oweh:SG|Colin Castleton:C|Alex Morales:PG|Izaiyah Nelson:PF|Caleb Love:SG|CJ Huntley:C|Koby Brea:SG|Chris Youngblood:SG|Jayson Kent:SF|Isaiah Stevens:PG|Adam Flagler:SG|Jonathan Mogbo:PF|Emanuel Miller:SF|Ja'Kobi Gillespie:PG|Maliq Brown:PF|Chucky Hepburn:PG|Blake Hinson:SF|Tamar Bates:SG|Julian Reese:PF|Jamir Watkins:SF|Fred VanVleet:PG|Dejounte Murray:PG|Jayson Tatum:SF|Thomas Bryant:C|Mario Hezonja:SF|Georges Niang:PF|Trey Lyles:PF|James Wiseman:C|Dillon Jones:SF|Ben Simmons:PF|Lonnie Walker IV:SG|Jalen Smith:C""".split("|"))}

TWO_WAY_CAP = 1.5   # a two-way player drafted onto a standard minimum deal in 2027-28 ($M)

out, missing = [], []
for c in contracts:
    k = key(c["name"])
    st = pg.get(k)
    age26 = st["age"] if st else (c["age"] - 1 if c["age"] else None)   # 2025-26 season age
    if age26 is None: age26 = 25
    note = ""
    r = base_rating(k)
    if k in MANUAL:
        o, d, note = MANUAL[k]; src = "manual"
        if r and r[2] == "bpm": o, d = r[0], r[1]
    elif k in PARTIAL:
        o, d = PARTIAL[k]; src = "partial"; note = PARTIAL_NOTE.get(k, "Partial 2025-26 season. Rating from CraftedNBA CPM, three-season blend")
    elif r:
        o, d, src = r
    elif c.get("tw"):
        o, d = REPL_O - 0.3, REPL_D; src = "none"; note = "Two-way player with little NBA time"
    elif c["s27"] or c["s26"]:
        sal = c["s27"] or c["s26"]
        if (c["age"] or 30) <= 21 or (c["s29"] and (c["age"] or 30) <= 23):
            o, d = rookie_prior(sal); src = "rookie"; note = "2026 rookie: no NBA stats yet"
        else:
            o, d = REPL_O, REPL_D; src = "none"; note = "Limited NBA minutes"
            missing.append(c["name"])
    # Blend the all-in-one metrics: DARKO 50%, RAPM 20%, CraftedNBA CPM 15%, 2025-26 box score 15%.
    # Players who missed most of 2025-26 lean on RAPM and their CraftedNBA history (DARKO fades players who sit).
    if k in DARKO and src != "rookie":
        hurt = k in MANUAL
        box = None if hurt or src == "none" else (o, d)
        crafted = MANUAL[k][:2] if hurt else ((o, d) if k in PARTIAL else None)
        if k in PARTIAL: box = r[:2] if r else None
        parts = [(0.25 if hurt else 0.5, DARKO[k])]
        if k in RAPM: parts.append((0.2, RAPM[k]))
        elif not hurt:
            do, dd = DARKO[k]; tot = do + dd
            parts.append((0.2, (do * RAPM_CAP / tot, dd * RAPM_CAP / tot) if tot > RAPM_CAP else (do, dd)))
        if crafted: parts.append((0.15, crafted))
        if box: parts.append((0.15, box))
        wsum = sum(w for w, _ in parts)
        o = sum(w * x[0] for w, x in parts) / wsum; d = sum(w * x[1] for w, x in parts) / wsum
        src = "aio" if src in ("bpm", "box", "none") else src
        note = note or ""
    o_now, d_now = o, d
    # age to 2027-28: the blend is centered near the end of 2025-26, so about 1.75 seasons of aging
    if src != "rookie":
        for a, wt in ((age26, 0.25), (age26 + 1, 1.0), (age26 + 2, 0.5)):
            step = age_step(a) * wt; o += step * 0.6; d += step * 0.4
    age28 = age26 + 2
    # Chronic injuries cost a little talent too (lost burst, rust), on top of the missed games
    avail3 = None
    if k in GAMES3:
        g3 = GAMES3[k]; avail3 = (g3[2] * 3 + g3[1] * 2 + g3[0]) / 6 / 78
        pass
    bpm = o + d
    gp = st["g"] if st else 0
    if src == "rookie":
        health = 0.90
    elif k in MANUAL:
        health = 0.80
    elif not st or st["mpg"] < 16:
        health = 0.88    # fringe minutes: missed games were mostly DNPs, not injuries
    else:
        health = 0.62 + 0.33 * min(1.0, gp / 72)
    if avail3 is not None:
        health = min(0.95, max(0.4, avail3))
    health -= max(0, age28 - 31) * 0.012
    health = round(min(max(health, 0.4 if k in GAMES3 else 0.55), 0.95), 2)

    # Restricted free agents: 2023 first-rounders coming off rookie deals, plus young players (23 or under in
    # 2026-27) whose deals end after 2026-27 and who would get a qualifying offer
    young_fa = c["s27"] is None and not c.get("tw") and (c["age"] or 99) <= 23 and (c["s26"] or 0) <= 10
    rfa = c["s27"] is None and not c.get("tw") and (k in RFA_2023 or young_fa)
    if c.get("tw"):
        status = "tw"
    elif c["s27"] is None and not rfa:
        status = "ufa"     # pending unrestricted free agent: not eligible
    elif rfa:
        status = "rfa"
    else:
        status = "ng" if "2027-28" in c["notes"] or c["notes"].strip() == "ng" else "con"
    years = 1 + sum(1 for s in (c["s28"], c["s29"]) if s)
    games = min(76.0, 82 * health)
    mpg_proj = role_minutes(bpm) if not st else 0.5 * min(st["mpg"], 34) + 0.5 * role_minutes(bpm)
    r28 = bpm + age_step(age28) * 1.0; r29 = r28 + age_step(age28 + 1)
    mv = noh_value(bpm, games, mpg_proj, 2027)
    mv28 = noh_value(r28, games, role_minutes(r28) if not st else 0.5 * min(st["mpg"], 34) + 0.5 * role_minutes(r28), 2028)
    mv29 = noh_value(r29, games, role_minutes(r29) if not st else 0.5 * min(st["mpg"], 34) + 0.5 * role_minutes(r29), 2029)
    # potential: where today's player is headed by age 27 on the same curve
    pot = o_now + d_now + sum(age_step(a) for a in range(age26 + 1, 27)) if age26 < 26 else max(o_now + d_now, bpm)
    cap = round(max(mv, 2.0), 1) if rfa else (TWO_WAY_CAP if status == "tw" else c["s27"])
    p5 = st["pos"] if st else POS5.get(c["name"], "")
    pos = pos_bucket(st["pos"], st["rpg"], st["mpg"]) if st else ({"PG": "G", "SG": "G", "SF": "W", "PF": "W", "C": "B"}[p5] if p5 else None) or ("B" if c["name"] in ("Cameron Boozer", "Chris Cenac Jr.", "Aday Mara", "Thomas Sorber", "Joan Beringer", "Hannes Steinbach", "Khaman Maluach", "Henri Veesaar", "Zuby Ejiofor", "Yang Hansen", "Tarris Reed Jr.", "Morez Johnson Jr.", "Jayden Quaintance", "Yanic Konan Niederhauser") else ("G" if c["name"] in ("Kingston Flemings", "Mikel Brown Jr.", "Darius Acuff Jr.", "Labaron Philon Jr.", "Darryn Peterson", "Keaton Wagler", "Ebuka Okorie", "Christian Anderson Jr.", "Bennett Stirtz", "Jase Richardson", "Nikola Topic", "Tyrese Haliburton", "Fred VanVleet", "Kyrie Irving", "Damian Lillard", "Dejounte Murray", "Bruce Thornton", "Meleek Thomas", "Isaiah Evans", "Emanuel Sharp", "Jaden Bradley", "Ryan Conwell", "Kasparas Jakucionis") else "W"))
    bpos = p5 or {"G": "SG", "W": "SF", "B": "C"}[pos]
    ps = positions(k, bpos, st)
    bpos = ps[0]
    rp = rate_profile(k, st, bpos)
    out.append(dict(
        n=c["name"], t=c["team"], tn=TEAM_NAMES[c["team"]], pos=pos, bpos=bpos, ps=ps,
        usg=rp["usg"], astp=rp["ast"], blk=rp["blk"], tpar=rp["tpar"], ts=rp["ts"], rm=rp["m"],
        age=age28, s=cap, s26=c["s26"], yrs=(0 if rfa else (1 if status == "tw" else years)), st=status,
        o=round(o, 2), d=round(d, 2), r=round(bpm, 2), mv=round(mv, 1), mv28=round(mv28, 1), mv29=round(mv29, 1), pot=round(pot, 2),
        rn=round(o_now + d_now, 2), on=round(o_now, 2), dn=round(d_now, 2),
        ppg=round(st["ppg"], 1) if st else None, rpg=round(st["rpg"], 1) if st else None,
        apg=round(st["apg"], 1) if st else None, gp=gp, mpg=round(st["mpg"], 1) if st else None,
        h=health, src=src, note=note, s28=c["s28"], s29=c["s29"], ih=1 if (k in GAMES3 and health < 0.7) else 0, g3=list(GAMES3[k]) if k in GAMES3 else None))

# ---------- display ratings: percentile vs. every player who logged 500+ minutes in 2025-26 ----------
# ---------- display ratings: one fixed scale tied to impact tiers (Noh's DARKO labels) ----------
# MVP +6 -> 95, All-NBA +4 -> 90, All-Star +2 -> 84, quality starter +1 -> 80, average -0.9 -> 72, bench -2 -> 66,
# replacement -3 -> 60. The same impact always shows the same number, now or in 2027-28.
OVR_ANCH = [(-4.5, 50), (-3.0, 60), (-2.0, 66), (-0.9, 72), (1.0, 80), (2.0, 84), (4.0, 90), (6.0, 95), (8.0, 99)]
O_ANCH = [(-3.5, 45), (-2.5, 55), (-1.5, 63), (-0.5, 70), (0.5, 76), (1.5, 82), (2.5, 87), (4.0, 93), (5.5, 99)]
D_ANCH = [(-2.5, 45), (-1.5, 55), (-1.0, 62), (-0.4, 70), (0.3, 76), (1.0, 82), (1.8, 88), (2.8, 94), (4.0, 99)]
def scale(anch, v):
    if v <= anch[0][0]: return anch[0][1]
    for (x0, y0), (x1, y1) in zip(anch, anch[1:]):
        if v <= x1: return round(y0 + (y1 - y0) * (v - x0) / (x1 - x0))
    return anch[-1][1]
def tier(v):
    return "MVP level" if v >= 6 else "All-NBA" if v >= 4 else "All-Star" if v >= 2 else "Quality starter" if v >= 1 else "Average" if v >= -0.9 else "Bench" if v >= -2 else "Replacement"
for p in out:
    p["ovr"], p["offr"], p["defr"] = scale(OVR_ANCH, p["r"]), scale(O_ANCH, p["o"]), scale(D_ANCH, p["d"])
    p["ovn"], p["offn"], p["defn"] = scale(OVR_ANCH, p["rn"]), scale(O_ANCH, p["on"]), scale(D_ANCH, p["dn"])
    p["potr"] = scale(OVR_ANCH, p["pot"]); p["tier"] = tier(p["rn"])
ref = [p for p in out if p["gp"] and (pg.get(key(p["n"])) or {}).get("min", 0) >= 500]
print("percentile reference players:", len(ref))

# ---------- projected protected lists: up to 8 per team, at least one eligible player exposed ----------
def protect_value(p):
    """How badly a team wants to keep a player. Teams weigh today's player a bit more than the 2027-28 one."""
    v = 0.6 * p["rn"] + 0.4 * p["r"]
    if p["age"] <= 22: v += 1.0
    elif p["age"] <= 24: v += 0.6
    elif p["age"] <= 26: v += 0.25
    elif p["age"] >= 34 and p["r"] < 0: v -= 0.5
    over = max(0, p["s"] - p["mv"])
    v -= over / (14.0 if p["yrs"] >= 2 else 25.0)   # bad money is easier to expose, multi-year bad money most of all
    if p["st"] == "ng": v -= 0.7      # non-guaranteed deals are easy to cut instead
    if p["st"] == "rfa": v -= 0.6     # drafted RFAs walk anyway, so teams protect them less
    if p["s"] >= 35 and ((p["r"] >= 1.5 and p["age"] <= 31) or p["rn"] >= 2.5): v += 2.5   # franchise players
    if p["age"] <= 26 and p["s"] >= 30: v += 2.5    # young players on max-level deals (Banchero, Jalen Green)
    if p.get("core"): v += 1.5                       # a top-four player on his team
    if p["src"] == "rookie" and p["s"] >= 2.6: v += 2.0   # 2026 first-round picks: teams just drafted them
    if p["age"] <= 24: v += 0.3 * max(0.0, p["pot"] - p["r"])   # potential
    if p["t"] in REBUILDING:                         # rebuilding teams keep prospects and shed big veteran salaries
        if p["age"] <= 24: v += 0.6
        if p["age"] >= 30 and p["s"] >= 30: v -= 1.5
    return v

FORCE_PROTECT = {key("Joel Embiid"), key("Jaren Jackson Jr.")}   # Utah just paid multiple firsts for Jackson
FORCE_EXPOSE = {key(n) for n in ["Paul George", "De'Aaron Fox", "Christian Braun", "Patrick Williams", "Jakob Poeltl", "Ja Morant"]}
# Contracts their teams are shopping (the game's rotating salary dumps): never treated as core
SHOPPING = {key(n) for n in ["Jerami Grant", "Dejounte Murray", "Darius Garland", "Pascal Siakam", "Keegan Murray", "Myles Turner", "Julius Randle"]}
# Rebuilding teams: the eight weakest rosters by their top-eight players today
_strength = {t: sum(sorted([p["rn"] for p in out if p["t"] == t and p["st"] != "ufa"], reverse=True)[:8]) for t in TEAM_NAMES}
REBUILDING = set(sorted(TEAM_NAMES, key=lambda t: _strength[t])[:8])
print("rebuilding:", sorted(REBUILDING))
for team in TEAM_NAMES:
    # Core: the team's four best players today, unless the contract is one the team would be glad to lose
    # (30 or older and paid $25M+ over his value, like Anthony Davis or Domantas Sabonis)
    roster = sorted([p for p in out if p["t"] == team and p["st"] != "ufa"], key=lambda p: -p["rn"])
    for p in roster[:4]:
        p["core"] = not (p["age"] >= 30 and p["s"] - p["mv"] >= 25) and key(p["n"]) not in SHOPPING
    elig = [p for p in out if p["t"] == team and p["st"] != "ufa" and key(p["n"]) not in FORCE_EXPOSE]
    elig.sort(key=lambda p: (key(p["n"]) in FORCE_PROTECT, protect_value(p)), reverse=True)
    nprot = min(8, max(0, len(elig) - 1))
    for i, p in enumerate(elig):
        p["prot"] = i < nprot
        p["pv"] = round(protect_value(p), 2)
for p in out:
    p.setdefault("prot", False)

pool = [p for p in out if p["st"] != "ufa" and not p["prot"]]
print("players:", len(out), " eligible:", sum(p["st"] != "ufa" for p in out), " pool:", len(pool))
print("no-stat vets set to replacement:", missing)
json.dump(out, open("players.json", "w"), separators=(",", ":"))
