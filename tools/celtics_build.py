#!/usr/bin/env python3
"""Builds celtics/data.json for Banner 19, the Celtics front-office game.

Sources (checked October 15, 2026)
  Celtics contracts   ShamSports team page (exact salaries, options, guarantees, kickers), NBC Sports Boston's
                      July 2026 roster reset, Hoops Rumors on the Pritchard extension (Oct 13, 2026: two years,
                      $44.2M, max first year $21,228,200, 8% raise, mutual option in 2029-30).
  Cap figures         NBA release for 2026-27 (June 30, 2026). Every later season: +7% a year, everything in step.
  Trade exception     Boston Globe, June 15, 2026: $27.7M from the Simons-Vucevic trade (Feb 3, 2026).
  Options elsewhere   NBA.com "Looking ahead to 2027 free agency" (July 26, 2026); Hoops Rumors on mutual options.
  Front offices       Team announcements through June 2026 (Ujiri in Dallas, Nelson in Philadelphia, Graham in Chicago).
  2027 draft class    ESPN (Jeremy Woo) top 60, June 25, 2026.
  Everyone else       src/31st-franchise/contracts.txt and data.js (impact ratings, aging, health, shooting profile).

Run from the site folder:  python tools/celtics_build.py
"""
import json
import pathlib
import re
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "celtics" / "data.json"
SRC = ROOT / "src" / "31st-franchise"
NY = 5          # seasons stored per contract: 2026-27 .. 2030-31 (index 0 = 2026-27)


def slug(n):
    n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")


# ---------------- CBA, 2026-27 (official). The page grows every figure 7% a season. ----------------
CBA = {
    "season0": "2026-27", "growth": 1.07,
    "cap": 164_961_000, "tax": 200_428_000, "a1": 209_015_000, "a2": 221_686_000, "min_team": 148_465_000,
    "ntmle": 15_044_000, "tmle": 6_064_000, "rmle": 9_366_000, "bae": 5_477_000,
    "avg": 14_441_000,          # estimated average salary (cap holds); 105% of it is the extension base
    "ext_base": 15_163_000,     # 140% of this is Pritchard's max first year: $21,228,200
    "tax_step": 6_064_000,
    "tax_std": [1.5, 1.75, 2.5, 3.25], "tax_rep": [2.5, 2.75, 3.5, 4.25], "tax_inc": 0.5,
    # Salary matching bands for teams below the first apron after a trade. 2023 CBA amounts ($7.5M / $29M in
    # 2023-24) grown with the cap; my inference, not a published 2026-27 figure.
    "match": {"low": 9_096_000, "high": 35_170_000, "plus": 250_000},
    "max_pct": [0.25, 0.30, 0.35],
    # Minimum salary by years of service, 2026-27 (0..10+)
    "min_scale": [1_357_762, 2_185_116, 2_449_421, 2_537_526, 2_625_627, 2_845_882, 3_066_143, 3_286_399,
                  3_506_658, 3_524_115, 3_876_528],
    # First-round rookie scale at 120% (what teams pay), 2026-27, picks 1-30. Anchored on real 2026 deals
    # (No. 27 Chris Cenac Jr. $2,988,120); the rest interpolated. Year 2 +5%, year 3 +5% (team option),
    # year 4 +80% (team option), matching the Celtics' current rookie deals.
    "rookie": [14.70, 13.20, 11.85, 10.65, 9.65, 8.75, 7.98, 7.30, 6.70, 6.36, 6.04, 5.74, 5.45, 5.18, 4.93,
               4.73, 4.54, 4.36, 4.18, 4.01, 3.85, 3.69, 3.55, 3.41, 3.27, 3.14, 2.99, 2.92, 2.86, 2.80],
    "roster_max": 15, "roster_min": 14, "two_way_max": 3,
}

# ---------------- Celtics ----------------
# sal: by season from 2026-27. opt: season index -> PO player option, TO team option, MO "mutual" (either side
# can pick it up, the 2026 style), NG non-guaranteed. yos: years of service entering 2026-27.
def C(*xs):
    return list(xs) + [0] * (NY - len(xs))

CELTICS = [
    dict(n="Jayson Tatum", sal=C(58_456_566, 62_786_682, 67_116_798, 71_446_914), yos=9, kick=0.15, signed=-2,
         note="Supermax. Back from the Achilles tear (16 games in 2025-26)."),
    dict(n="Paul George", sal=C(54_126_380, 56_586_670), opt={1: "PO"}, yos=16, kick=0.15, signed=-2,
         note="Acquired from Philadelphia for Jaylen Brown. Waived his kicker for that trade."),
    dict(n="Derrick White", sal=C(30_348_000, 32_596_000, 34_844_000), opt={2: "PO"}, yos=9, kick=0.15, signed=-2),
    dict(n="Mitchell Robinson", sal=C(15_044_000, 15_796_200, 16_548_400), opt={2: "PO"}, yos=8, signed=0,
         how="ntmle", note="Signed with the full non-taxpayer mid-level, which hard-caps Boston at the first apron for 2026-27."),
    dict(n="Sam Hauser", sal=C(10_848_215, 11_651_785, 12_455_356), yos=5, signed=-2),
    dict(n="Payton Pritchard", sal=C(7_767_857, 8_303_571, 21_228_200, 22_926_456), opt={3: "MO"}, yos=6, signed=0,
         ext=True, note="Extended Oct. 13, 2026: two years, $44.2M from 2028-29. Either side can pick up 2029-30."),
    dict(n="Ron Harper Jr.", sal=C(3_150_752, 3_308_290, 3_465_828, 3_779_359), opt={2: "NG", 3: "TO"}, yos=3, signed=0),
    dict(n="Chris Cenac Jr.", sal=C(2_988_120, 3_137_640, 3_287_400, 5_930_470), opt={2: "TO", 3: "TO"}, yos=0,
         rk=[2026, 27], signed=0, note="2026 first-round pick (27th)."),
    dict(n="Hugo Gonzalez", sal=C(2_923_560, 3_062_640, 5_528_065), opt={1: "TO", 2: "TO"}, yos=1, rk=[2025, 28], signed=-1),
    dict(n="Luka Garza", sal=C(2_801_346), yos=5, signed=0),
    dict(n="Baylor Scheierman", sal=C(2_744_040, 4_952_993), opt={1: "TO"}, yos=2, rk=[2024, 30], signed=-2),
    dict(n="Neemias Queta", sal=C(2_667_944, 12_500_000, 13_500_000, 14_500_000, 15_500_000), yos=5, signed=0, ext=True,
         note="Four-year, $56M extension starts in 2027-28."),
    dict(n="Mike Conley", sal=C(2_449_421), yos=19, signed=0, how="min", note="Veteran minimum."),
    dict(n="Jordan Walsh", sal=C(2_406_205, 5_000_000, 5_250_000, 5_500_000), opt={3: "TO"}, yos=3, signed=0, ext=True,
         note="Three-year, $15.75M extension starts in 2027-28."),
]
CELTICS_TWO_WAY = ["Amari Williams", "Dillon Mitchell"]
CELTICS_EXTRA = {
    "picks": [
        {"y": 2027, "r": 1, "from": "BOS", "note": "Own"},
        {"y": 2028, "r": 1, "from": "BOS", "note": "Own. San Antonio can swap (top-1 protected)", "swap": "SAS"},
        {"y": 2028, "r": 1, "from": "PHI", "alt": "LAC", "note": "Better of Philadelphia's and the Clippers' (Brown trade)"},
        {"y": 2029, "r": 1, "from": "BOS", "out": "POR", "note": "Owed to Portland (Holiday trade)"},
        {"y": 2030, "r": 1, "from": "BOS", "note": "Own"},
        {"y": 2031, "r": 1, "from": "BOS", "note": "Own"},
        {"y": 2031, "r": 1, "from": "PHI", "note": "Philadelphia's, unprotected (Brown trade)"},
        {"y": 2027, "r": 2, "from": "PHI", "note": "Philadelphia's (Brown trade)"},
        {"y": 2028, "r": 2, "from": "PHI", "note": "Philadelphia's (Brown trade)"},
    ],
    "tpe": [{"amt": 27_700_000, "from": "Anfernee Simons", "made": "2026-02-03", "exp": "2027-02-03", "season": -1}],
    # Rights Boston still holds (ShamSports). They only matter if Boston ever gets under the cap.
    "holds": [
        {"n": "Torrey Craig", "amt": 2_296_274, "kind": "Bird rights"},
        {"n": "John Tonje", "amt": 2_185_633, "kind": "Qualifying offer"},
        {"n": "Max Shulga", "amt": 2_185_633, "kind": "Qualifying offer"},
    ],
    "dead": [],
    "used": {"ntmle": True},              # Robinson
    "hard_cap": {"0": "a1"},              # first apron, 2026-27
    "tax_hist": {"2022-23": True, "2023-24": True, "2024-25": True, "2025-26": False},
    "coach": "Joe Mazzulla", "owner": "Bill Chisholm",
}

# ---------------- Options elsewhere (2027-28 = index 1) ----------------
PO_2027 = ["Nikola Jokic", "Giannis Antetokounmpo", "LeBron James", "Karl-Anthony Towns", "Kevin Durant", "Rudy Gobert",
           "Kyrie Irving", "Anthony Davis", "Brandon Ingram", "Ty Jerome", "Grayson Allen", "Jerami Grant", "Jalen Green",
           "Jrue Holiday", "Luke Kennard", "Damian Lillard", "Dejounte Murray", "Julius Randle", "Anfernee Simons"]
TO_2027 = ["Santi Aldama", "Josh Hart", "Oso Ighodaro", "Ajay Mitchell", "Norman Powell", "Isaiah Stewart", "Jaylen Wells",
           "Jaylin Williams"]
MUTUAL = {"Kristaps Porzingis": 1, "Keon Ellis": 1, "Isaiah Hartenstein": 2}

# ---------------- Front offices ----------------
# tax: pay = will pay tax (and flirt with the second apron) to win; dodge = pays only when contending, sells salary to
# duck it; never = won't go into the tax. mode: contend, rise, retool, rebuild. wants: what moves their valuations.
FO = {
 "ATL": ("Onsi Saleh", "General manager", "dodge", "rise", ["defense", "youth"], "Analytics shop with a rising core. Shops for value, not names."),
 "BOS": ("Brad Stevens", "President of basketball operations", "dodge", "contend", ["shooting", "possessions", "defense"],
         "Analytics first: win the possession battle (offensive boards, few turnovers) and take more threes than anyone. Ownership wants out of the tax this season."),
 "BRK": ("Sean Marks", "General manager", "never", "rebuild", ["picks", "youth"], "Hoarding picks and young upside. Happy to take bad money if you pay him to."),
 "CHI": ("Bryson Graham", "EVP, basketball operations", "never", "retool", ["youth", "picks"], "New regime (May 2026). Clearing the decks, cap strategy run by Stephen Mervis."),
 "CHO": ("Jeff Peterson", "President of basketball operations", "never", "rise", ["youth", "shooting"], "Building around young wings. Won't pay tax for a fringe team."),
 "CLE": ("Koby Altman", "President of basketball operations", "pay", "contend", ["defense", "size"], "Deep in the tax and fine with it while the core is in its prime."),
 "DAL": ("Masai Ujiri", "President of basketball operations", "dodge", "retool", ["defense", "youth"], "New boss (May 2026), GM Mike Schmitz. Building around Cooper Flagg, long game."),
 "DEN": ("Ben Tenzer", "Executive VP, basketball operations", "dodge", "contend", ["shooting"], "Jokic window, but ownership cut payroll before and will again."),
 "DET": ("Trajan Langdon", "President of basketball operations", "dodge", "contend", ["shooting", "defense"], "Patient builder now chasing a title. Pays for fits, not stars."),
 "GSW": ("Mike Dunleavy Jr.", "President of basketball operations", "pay", "contend", ["shooting", "defense"], "Curry's last years. Will pay tax, avoids the second apron."),
 "HOU": ("Rafael Stone", "General manager", "dodge", "contend", ["defense", "size"], "Analytics-heavy, defense and size. Durant era, young core on extensions."),
 "IND": ("Kevin Pritchard", "President of basketball operations", "never", "retool", ["shooting", "youth"], "Small-market discipline. Rarely goes near the tax."),
 "LAC": ("Lawrence Frank", "President of basketball operations", "pay", "retool", ["defense"], "Ballmer pays anything. Post-Kawhi pivot around Ingram and Harden's old deal."),
 "LAL": ("Rob Pelinka", "President of basketball operations", "pay", "contend", ["shooting", "stars"], "Luka era under new owner Mark Walter. Star hunting with money to spend."),
 "MEM": ("Zach Kleiman", "President of basketball operations", "never", "retool", ["picks", "youth", "defense"], "Analytics, asset-rich after the Jaren Jackson Jr. deal. Sitting on a $28.8M trade exception."),
 "MIA": ("Pat Riley", "President", "dodge", "contend", ["stars", "defense"], "Star chaser (got Giannis). Culture first, ducks the repeater tax when it can."),
 "MIL": ("Jon Horst", "General manager", "never", "rebuild", ["picks", "youth"], "Post-Giannis teardown. Selling veterans for picks."),
 "MIN": ("Tim Connelly", "President of basketball operations", "dodge", "contend", ["size", "defense"], "Contender, but new ownership watches the second apron."),
 "NOP": ("Joe Dumars", "Executive VP, basketball operations", "never", "retool", ["defense", "size"], "Old-school: toughness and size. GM Troy Weaver."),
 "NYK": ("Leon Rose", "President", "pay", "contend", ["stars", "defense"], "All-in. Will pay into the second apron for a title shot."),
 "OKC": ("Sam Presti", "Executive VP and GM", "dodge", "contend", ["picks", "youth", "defense"], "Champion who still won't overpay. Keeps the second apron at arm's length."),
 "ORL": ("Jeff Weltman", "President of basketball operations", "pay", "contend", ["defense", "size", "shooting"], "Length and defense, now paying for shooting. Over the second apron."),
 "PHI": ("Jameer Nelson", "Head of basketball operations", "pay", "contend", ["stars"], "Took over from Daryl Morey (June 2026). Brown, Embiid, Maxey: win now."),
 "PHO": ("Brian Gregory", "General manager", "dodge", "retool", ["youth", "defense"], "Reset after the Durant era. Ishbia spends, but not on a middling team."),
 "POR": ("Joe Cronin", "General manager", "never", "retool", ["youth", "defense"], "Cost-conscious under Tom Dundon. Veterans are trade chips."),
 "SAC": ("Scott Perry", "General manager", "never", "retool", ["shooting"], "Stuck in the middle and trying to get younger."),
 "SAS": ("Brian Wright", "General manager", "dodge", "rise", ["youth", "defense", "shooting"], "Wembanyama timeline. Patient, pick-rich, starting to push."),
 "TOR": ("Bobby Webster", "President", "dodge", "contend", ["defense", "size"], "Bet on Kawhi Leonard. Long, switchable defenders."),
 "UTA": ("Austin Ainge", "President of basketball operations", "never", "rebuild", ["picks", "youth"], "Pick hoarder. Always taking calls on veterans."),
 "WAS": ("Michael Winger", "President, Monumental Basketball", "never", "rebuild", ["picks", "youth"], "Rebuild with Anthony Davis as a trade chip. GM Will Dawkins."),
}
EAST = {"ATL", "BOS", "BRK", "CHI", "CHO", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS"}
REPEATER = {"GSW", "LAC", "PHO", "MIL", "DEN"}     # taxpayers in 3 of the last 4 seasons (approximate)

# ---------------- 2027 draft class: ESPN (Jeremy Woo), June 25, 2026 ----------------
DRAFT_2027 = """Tyran Stokes|SF|Kansas|18.7
Jordan Smith Jr.|PG|Arkansas|18.8
Caleb Holt|SG|Arizona|18.6
Bruce Branch III|SG|BYU|17.7
Stefan Joksimovic|PG|Baskonia|17.6
Braylon Mullins|SG|UConn|20.2
Thomas Haugh|PF|Florida|23.0
Jason Crowe Jr.|PG|Missouri|17.9
Anthony Thompson|PF|Ohio State|17.9
Cameron Williams|C|Duke|18.7
Caleb Gaskins|PF|Miami|Fr
Miikka Muurinen|PF|Arkansas|Fr
Austin Goosby|SG|Texas|Fr
Motiejus Krivas|C|Arizona|Sr
Luigi Suigo|C|Villanova|Fr
Matt Able|SG|North Carolina|So
Alex Condon|C|Florida|Sr
Dame Sarr|SG|Duke|So
Cameron Houindo|PF|Cedevita|Intl
Christian Collins|SF|USC|Fr
Babatunde Oladotun|SF|Maryland|Fr
Jaxon Richardson|SF|Alabama|Fr
Brandon McCoy|SG|Michigan|Fr
Hugo Yimga-Moukouri|SF|Nanterre|Intl
Sayon Keita|C|North Carolina|Fr
Amari Allen|SF|Alabama|So
Ivan Kharchenkov|SF|Arizona|So
Patrick Ngongba II|C|Duke|So
Juke Harris|SG|Tennessee|So
Tyler Tanner|PG|Vanderbilt|Jr
Malachi Moreno|C|Kentucky|So
Cheickh Niang|SG|Trento|Intl
Colben Landrew|SG|UConn|Fr
Obinna Ekezie Jr.|C|Louisville|Fr
Trey McKenney Jr.|SG|Michigan|So
Quentin Coleman|PG|Illinois|Fr
Dylan Mingo|PG|Baylor|Fr
Stefan Vaaks|SG|Illinois|So
Milan Momcilovic|PF|Kentucky|Sr
Dash Daniels|PG|Melbourne United|Intl
Massamba Diop|C|Gonzaga|So
Tounde Yessoufou|SF|St. John's|So
Moustapha Thiam|C|Michigan|Jr
David Mirkovic|PF|Illinois|So
Miles Byrd|SG|Providence|Sr
Joseph Tugler|PF|Houston|Sr
Flory Bidunga|C|Louisville|Jr
Shelton Henderson|SG|Miami|So
Davis Fogle|SG|Gonzaga|So
Jacob Cofie|PF|USC|So
Rueben Chinyelu|C|Florida|Sr
Billy Richmond III|SG|Arkansas|Jr
Neoklis Avdalas|SF|North Carolina|So
Sam Lewis|SG|Virginia|Sr
Pryce Sandfort|SF|Nebraska|Sr
Matas Vokietaitis|C|Texas|Jr
Andrej Stojakovic|SG|Illinois|Sr
Jeremy Fears Jr.|PG|Michigan State|Jr
Killyan Toure|PG|Iowa State|So
John Blackwell|SG|Duke|Sr"""
CLASS_AGE = {"Fr": 19.2, "So": 20.2, "Jr": 21.2, "Sr": 22.4, "Intl": 19.5}


def age_step(age):
    """Stephen Noh's aging curve (the same one the 31st Franchise uses): expected change in impact per season."""
    if age < 21: return 0.65
    t = {21: 0.5, 22: 0.45, 23: 0.40, 24: 0.10, 25: 0.10, 26: 0.10, 27: 0.0, 28: 0.0,
         29: -0.05, 30: -0.1, 31: -0.2, 32: -0.3, 33: -0.45, 34: -0.65, 35: -0.9}
    return t.get(age, -1.2)


def yos_guess(age):
    return max(0, min(18, (age or 25) - 20))


def player_fields(p, age):
    """Ratings for 2026-27. data.js holds 2027-28 projections, so back out the half-season of aging on
    each side of the 2026-27 midpoint."""
    o, d = p.get("o"), p.get("d")
    if o is None:
        return {}
    a28 = p.get("age")                 # data.js ages are 2027-28 ages
    if a28:
        back = age_step(a28 - 1) * 0.5 + age_step(a28) * 0.5
        o -= back * 0.6; d -= back * 0.4
    pot = p.get("pot")
    out = {"o": round(o, 2), "d": round(d, 2), "pot": round(pot, 2) if pot is not None else None,
           "h": p.get("h"), "pos": p.get("pos"), "ps": p.get("ps") or [p.get("bpos")], "tpar": p.get("tpar"),
           "ts": p.get("ts"), "usg": p.get("usg"), "astp": p.get("astp"), "blk": p.get("blk"),
           "ppg": p.get("ppg"), "rpg": p.get("rpg"), "apg": p.get("apg"), "mpg": p.get("mpg"), "gp": p.get("gp"),
           "tier": p.get("tier")}
    return {k: v for k, v in out.items() if v is not None}


def main():
    s = (SRC / "data.js").read_text(encoding="utf-8")
    R = {pp["n"]: pp for pp in json.loads(re.search(r"const PLAYERS=(\[.*?\]);", s, re.S).group(1))}
    TEAMS = json.loads(re.search(r"const TEAMS=(\{.*?\});", s, re.S).group(1))
    rows = [l.rstrip("\n").split("|") for l in (SRC / "contracts.txt").read_text(encoding="utf-8").splitlines()
            if "|" in l and not l.startswith("#")]
    ages = {r[1]: int(r[2]) for r in rows if r[2].isdigit()}

    players = []
    # Celtics, exact
    for c in CELTICS:
        p = {"id": slug(c["n"]), "n": c["n"], "t": "BOS", "age": ages.get(c["n"]), "yos": c["yos"],
             "c": {"sal": c["sal"], "opt": {str(k): v for k, v in c.get("opt", {}).items()},
                   "signed": c.get("signed", 0)}}
        for k in ("kick", "how", "ext"):
            if c.get(k): p["c"][k] = c[k]
        if c.get("rk"): p["c"]["rk"] = c["rk"]
        if c.get("note"): p["note"] = c["note"]
        p.update(player_fields(R[c["n"]], p["age"]) if c["n"] in R else {})
        if c["n"] == "Jayson Tatum":          # 16 games at the four and five after the Achilles; he's a forward
            p["pos"], p["ps"] = "W", ["SF", "PF"]
        players.append(p)
    assert sum(p["c"]["sal"][0] for p in players) == 198_722_406, "Celtics 2026-27 payroll no longer matches ShamSports"
    for n in CELTICS_TWO_WAY:
        rp = R.get(n, {})
        age = ages.get(n) or (rp.get("age", 23) - 1)
        p = {"id": slug(n), "n": n, "t": "BOS", "age": age, "yos": 1, "two": True,
             "c": {"sal": [0] * NY, "opt": {}, "signed": 0}}
        f = player_fields(rp, age) if rp else {}
        p.update(f or {"o": -1.6, "d": -0.4, "pos": "W", "ps": ["SF"], "h": 0.9})
        players.append(p)

    seen = {p["n"] for p in players}
    for r in rows:
        team, name = r[0], r[1]
        if team == "BOS" or name in seen:
            continue
        seen.add(name)
        rp = R.get(name, {})
        age = int(r[2]) if r[2].isdigit() else (rp.get("age", 26) - 1 if rp else None)
        sal = [round(float(x) * 1_000_000) if x else 0 for x in r[3:7]] + [0]
        note = r[7] if len(r) > 7 else ""
        opt = {}
        if note == "ng":
            opt["0"] = "NG"
        elif note.endswith(" ng"):
            yr = note.replace(" ng", "")
            idx = ["2026-27", "2027-28", "2028-29", "2029-30"].index(yr)
            opt[str(idx)] = "NG"
        if name in PO_2027 and sal[1]: opt["1"] = "PO"
        if name in TO_2027 and sal[1]: opt["1"] = "TO"
        if name in MUTUAL: opt[str(MUTUAL[name])] = "MO"
        p = {"id": slug(name), "n": name, "t": team, "age": age, "yos": yos_guess(age),
             "c": {"sal": sal, "opt": opt, "signed": -1}}
        if rp.get("st") == "tw":
            p["two"] = True; p["c"]["sal"] = [0] * NY
        if rp.get("st") == "rfa":
            p["c"]["rfa"] = True          # restricted free agent in 2027 if not extended
        if rp.get("src") == "rookie":
            p["c"]["rk"] = [2026, 0]
        p.update(player_fields(rp, age) if rp else {})
        players.append(p)

    teams = {}
    for code, nm in TEAMS.items():
        lead, title, tax, mode, wants, style = FO[code]
        teams[code] = {"name": nm, "conf": "E" if code in EAST else "W",
                       "fo": {"lead": lead, "title": title, "tax": tax, "mode": mode, "wants": wants, "style": style},
                       "rep": code in REPEATER}

    draft = []
    for i, line in enumerate(DRAFT_2027.splitlines()):
        n, pos, school, a = line.split("|")
        age = float(a) if a[0].isdigit() else CLASS_AGE[a]
        draft.append({"id": slug(n), "n": n, "pos": pos, "school": school, "age": age, "rank": i + 1})

    data = {"updated": "2026-10-15", "cba": CBA, "teams": teams, "players": players,
            "celtics": CELTICS_EXTRA, "draft": {"2027": draft}}
    OUT.parent.mkdir(exist_ok=True)
    txt = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    assert "@" not in txt
    OUT.write_text(txt, encoding="utf-8")
    nb = sum(1 for p in players if p["t"] == "BOS")
    unrated = [p["n"] for p in players if "o" not in p]
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(players)} players ({nb} Celtics), {len(draft)} prospects, "
          f"{OUT.stat().st_size // 1024} KB. Unrated: {len(unrated)} {unrated[:8]}")


if __name__ == "__main__":
    main()
