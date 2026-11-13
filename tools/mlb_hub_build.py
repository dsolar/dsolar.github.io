#!/usr/bin/env python3
"""Build the MLB hub's page data (mlb/data/) from the FanGraphs snapshots in tools/mlb_hub/.

  python tools/mlb_hub_build.py

Writes:
  mlb/data/hub.json  teams, and every player worth knowing in all 30 organizations: role, positions, service time,
                     2027 projection (Depth Charts, else Steamer), full-time WAR rate, prospect grade, contract by year
  mlb/data/fa.json   this winter's free agents and the five classes before, with crowd and signed contracts

All the modeling (aging, call-ups, standings, playoff odds, surplus value, the free agent market) happens in the
browser in mlb/model.js, so there is one model and it's testable (node --test tests/mlb_hub.test.mjs).
Standard library only. Missing snapshots are skipped, so a partial pull still builds.
"""
import json
import os
import re
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "mlb_hub")
OUT = os.path.join(os.path.dirname(HERE), "mlb", "data")

# FanGraphs team id -> abbreviation, name, league, division, color, ESPN logo code
TEAMS = {
    1: ("LAA", "Angels", "AL", "West", "#BA0021", "laa"), 2: ("BAL", "Orioles", "AL", "East", "#DF4601", "bal"),
    3: ("BOS", "Red Sox", "AL", "East", "#BD3039", "bos"), 4: ("CWS", "White Sox", "AL", "Central", "#27251F", "chw"),
    5: ("CLE", "Guardians", "AL", "Central", "#00385D", "cle"), 6: ("DET", "Tigers", "AL", "Central", "#0C2340", "det"),
    7: ("KC", "Royals", "AL", "Central", "#004687", "kc"), 8: ("MIN", "Twins", "AL", "Central", "#002B5C", "min"),
    9: ("NYY", "Yankees", "AL", "East", "#0C2340", "nyy"), 10: ("ATH", "Athletics", "AL", "West", "#003831", "oak"),
    11: ("SEA", "Mariners", "AL", "West", "#0C2C56", "sea"), 12: ("TB", "Rays", "AL", "East", "#092C5C", "tb"),
    13: ("TEX", "Rangers", "AL", "West", "#003278", "tex"), 14: ("TOR", "Blue Jays", "AL", "East", "#134A8E", "tor"),
    15: ("ARI", "Diamondbacks", "NL", "West", "#A71930", "ari"), 16: ("ATL", "Braves", "NL", "East", "#CE1141", "atl"),
    17: ("CHC", "Cubs", "NL", "Central", "#0E3386", "chc"), 18: ("CIN", "Reds", "NL", "Central", "#C6011F", "cin"),
    19: ("COL", "Rockies", "NL", "West", "#333366", "col"), 20: ("MIA", "Marlins", "NL", "East", "#00A3E0", "mia"),
    21: ("HOU", "Astros", "AL", "West", "#002D62", "hou"), 22: ("LAD", "Dodgers", "NL", "West", "#005A9C", "lad"),
    23: ("MIL", "Brewers", "NL", "Central", "#12284B", "mil"), 24: ("WSH", "Nationals", "NL", "East", "#AB0003", "wsh"),
    25: ("NYM", "Mets", "NL", "East", "#002D72", "nym"), 26: ("PHI", "Phillies", "NL", "East", "#E81828", "phi"),
    27: ("PIT", "Pirates", "NL", "Central", "#27251F", "pit"), 28: ("STL", "Cardinals", "NL", "Central", "#C41E3A", "stl"),
    29: ("SD", "Padres", "NL", "West", "#2F241D", "sd"), 30: ("SF", "Giants", "NL", "West", "#FD5A1E", "sf"),
}
ABBR = {t: v[0] for t, v in TEAMS.items()}
# FanGraphs' own abbreviations, for the few places they show up as text
FG_ABBR = {"KCR": "KC", "SDP": "SD", "SFG": "SF", "TBR": "TB", "WSN": "WSH", "CHW": "CWS", "OAK": "ATH", "AZ": "ARI"}
PITCH_POS = {"P", "SP", "RP", "RHP", "LHP", "SIRP", "MIRP", "RHSP", "LHSP", "RHRP", "LHRP"}


def load(name):
    p = os.path.join(SRC, name)
    if not os.path.exists(p):
        print(f"missing {name}")
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def rows_of(t):
    """{"cols", "rows"} -> list of dicts"""
    if not t:
        return []
    return [dict(zip(t["cols"], r)) for r in t["rows"]]


def fnum(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def service(st):
    """'3.079' -> 3 + 79/172 years of MLB service"""
    m = re.match(r"^\s*(\d+)\.(\d{1,3})\s*$", str(st or ""))
    if not m:
        return None
    return round(int(m.group(1)) + int(m.group(2).ljust(3, "0")) / 172, 3)


def team_of(v):
    if isinstance(v, int) or (isinstance(v, str) and v.isdigit()):
        return ABBR.get(int(v))
    if isinstance(v, str):
        return FG_ABBR.get(v, v) if v else None
    return None


def contract_code(t):
    t = str(t or "").upper()
    if "NOT 40" in t:
        return "N"   # a minor league placeholder year, not part of the deal
    if "OPT OUT" in t:
        return "OO"  # the player can walk away: he stays only if the money beats his market
    if "VEST" in t:
        return "VO"
    if "CLUB" in t:
        return "CO"
    if "PLAYER" in t:
        return "PO"
    if "MUTUAL" in t:
        return "MO"
    if "VEST" in t:
        return "VO"
    if t.startswith("PRE"):
        return "PA"
    if t.startswith("ARB"):
        m = re.search(r"\d", t)
        return "A" + m.group(0) if m else "AT"
    if "FREE AGENT" in t or t == "FA":
        return "FA"
    return "G"


def r1(x, nd=2):
    return None if x is None else round(x, nd)


def build():
    proj = load("proj.json") or {"systems": {}}
    rost = load("rosters.json")
    pay = load("payroll.json")
    board = load("board.json")
    fa = load("fa.json")
    status = load("status.json") or {}
    season = (proj or {}).get("season") or (rost or {}).get("season")

    sysd = proj.get("systems", {})
    dc_b = {r["mlbam"]: r for r in rows_of(sysd.get("fangraphsdc", {}).get("bat")) if r.get("mlbam")}
    dc_p = {r["mlbam"]: r for r in rows_of(sysd.get("fangraphsdc", {}).get("pit")) if r.get("mlbam")}
    st_b_rows = rows_of(sysd.get("steamer", {}).get("bat"))
    st_p_rows = rows_of(sysd.get("steamer", {}).get("pit"))
    zp_b = {r["mlbam"]: r for r in rows_of(sysd.get("zips", {}).get("bat")) if r.get("mlbam")}
    zp_p = {r["mlbam"]: r for r in rows_of(sysd.get("zips", {}).get("pit")) if r.get("mlbam")}
    st_b = {r["mlbam"]: r for r in st_b_rows if r.get("mlbam")}
    st_p = {r["mlbam"]: r for r in st_p_rows if r.get("mlbam")}
    fg2mlbam = {}
    for r in st_b_rows + st_p_rows + list(dc_b.values()) + list(dc_p.values()):
        if r.get("fg") and r.get("mlbam"):
            fg2mlbam[str(r["fg"])] = r["mlbam"]

    # ---- prospects by mlbam (The Board joins through FanGraphs ids)
    prospects = {}
    for r in rows_of(board):
        mid = fg2mlbam.get(str(r.get("fg")))
        if not mid:
            continue
        fv = str(r.get("fv") or "").strip()
        if not re.match(r"^\d", fv):
            continue
        prospects[mid] = {"fv": fv, "risk": r.get("risk"), "eta": int(r["eta"]) if str(r.get("eta") or "").isdigit() else None,
                          "ovr": int(r["ovr"]) if r.get("ovr") else None, "orgr": int(r["org"]) if r.get("org") else None,
                          "ppos": r.get("pos"), "tldr": r.get("tldr") or None}

    # ---- contracts by mlbam
    contracts = {}
    if pay:
        for tid, t in pay.get("teams", {}).items():
            for c in t.get("contracts", []):
                if not c.get("mlbam"):
                    continue
                # [season, salary, code, option buyout, arbitration projection, CBT hit]
                yrs = [[y[0], y[1], contract_code(y[2]), y[5], y[4], y[6]] for y in c["years"]
                       if y[0] and y[0] >= season and contract_code(y[2]) not in ("FA", "N")]
                sal = sum(y[1] or 0 for y in c["years"] if y[0] and contract_code(y[2]) == "G")
                cbt = sum(y[6] or 0 for y in c["years"] if y[0] and contract_code(y[2]) == "G")
                contracts[c["mlbam"]] = {"desc": c.get("desc"), "type": c.get("type"), "aav": c.get("aav"),
                                         "yrs": yrs, "note": c.get("note")}
                if cbt and sal > 1.25 * cbt:
                    contracts[c["mlbam"]]["defer"] = 1  # heavy deferrals: the CBT hit is the fair yearly cost
        types = sorted({y[2] for t in pay.get("teams", {}).values() for c in t.get("contracts", []) for y in c["years"]})
        print("contract year types:", types)

    # ---- recent MLB seasons (tools/mlb/, MLB Stats API, pulled for Wipe Yoenis) and prospects' minor league lines
    nick = {v[1]: v[0] for v in TEAMS.values()}
    def abbr_of(team_name):
        for k, a in nick.items():
            if str(team_name or "").endswith(k):
                return a
        return None
    hist = {}
    for y in range(season - 3, season):
        path = os.path.join(HERE, "mlb", f"{y}.json")
        if not os.path.exists(path):
            continue
        d = json.load(open(path, encoding="utf-8"))
        for r in d.get("hitting", []):
            if (r.get("pa") or 0) < 5 or not r.get("id"):
                continue
            hist.setdefault(r["id"], {}).setdefault("b", []).append(
                [y, abbr_of(r.get("team")), r.get("g"), r.get("pa"), r.get("hr"), r.get("r"), r.get("rbi"), r.get("sb"), r.get("avg"), r.get("obp"), r.get("slg")])
        for r in d.get("pitching", []):
            if not r.get("id") or not r.get("g"):
                continue
            hist.setdefault(r["id"], {}).setdefault("p", []).append(
                [y, abbr_of(r.get("team")), r.get("g"), r.get("gs"), r.get("ip"), r.get("w"), r.get("l"), r.get("sv"), r.get("k"), r.get("bb"), r.get("era"), r.get("whip")])
    # actual WAR, last three seasons (tools/mlb_hub/war.json): by MLBAM id, else FanGraphs id
    war_rec, war_fg = {}, {}
    for y, d in ((load("war.json") or {}).get("seasons") or {}).items():
        for stats in ("bat", "pit"):
            t = d.get(stats) or {}
            cols = t.get("cols") or []
            for raw in t.get("rows") or []:
                r = dict(zip(cols, raw))
                key = int(r["mlbam"]) if str(r.get("mlbam") or "").isdigit() else None
                for store, k in ((war_rec, key), (war_fg, r.get("fg") or None)):
                    if k is None:
                        continue
                    e = store.setdefault(k, {}).setdefault(int(y), [int(y), 0.0, 0, 0.0])
                    e[1] = round(e[1] + (r.get("war") or 0), 2)
                    if stats == "bat":
                        e[2] += int(r.get("pa") or 0)
                    else:
                        e[3] = round(e[3] + float(r.get("ip") or 0), 1)
    minors = {}
    kit = os.path.join(os.path.dirname(HERE), "fantasy-kit", "data", "prospects-mlb.json")
    if os.path.exists(kit):
        for r in json.load(open(kit, encoding="utf-8")).get("players", []):
            if str(r.get("mlbam") or "").isdigit() and r.get("line"):
                minors[int(r["mlbam"])] = r["line"]

    # ---- players: every organization's roster
    players = []
    seen = set()
    cols = (rost or {}).get("cols", [])
    for tid, rows in ((rost or {}).get("teams") or {}).items():
        org = ABBR.get(int(tid))
        for raw in rows:
            r = dict(zip(cols, raw))
            mid = r.get("mlbamid")
            key = mid or f"fg{r.get('playerid')}"
            if key in seen:
                continue
            typ = r.get("type") or ""
            grp = typ.split("-")[0] if typ.startswith(("mlb", "il")) else "min"
            if grp == "mlb":
                grp = typ.split("-")[1]  # sl, bn, sp, bp
            pos_list = [p for p in re.split(r"[/,]", str(r.get("position1") or r.get("position") or "")) if p]
            is_p = (r.get("position") in ("SP", "RP") or typ in ("off-sp", "off-rp", "il-sp", "il-rp", "mlb-sp", "mlb-bp")
                    or (pos_list and pos_list[0] in PITCH_POS))
            lvl = "MLB" if grp in ("sl", "bn", "sp", "bp", "il") else (r.get("role") or "")
            pr = prospects.get(mid)
            d = (dc_p if is_p else dc_b).get(mid)
            s = (st_p if is_p else st_b).get(mid)
            z = (zp_p if is_p else zp_b).get(mid)
            ct = contracts.get(mid)
            r40 = r.get("roster40") == "Y"
            # who makes the cut: the MLB roster, the 40-man, graded prospects, and upper minors Steamer projects
            if not (grp != "min" or r40 or pr or (lvl in ("AAA", "AA") and s) or ct):
                continue
            seen.add(key)
            # FanGraphs tags a few shared names with an old team code ("Jacob Wilson (oak)"); pages show the team anyway
            name = re.sub(r"\s*\([a-z]{2,4}\)$", "", str(r.get("player") or "")).strip()
            p = {"id": mid or key, "n": name, "t": org, "g": grp, "lvl": lvl,
                 "role": r.get("role") or None, "pos": (r.get("position") if grp in ("sl", "bn", "sp", "bp") else (pos_list[0] if pos_list else None)),
                 "el": pos_list or None, "p": 1 if is_p else 0, "age": fnum(r.get("age")),
                 "b": r.get("bats"), "th": r.get("throws"), "st": service(r.get("servicetime")),
                 "opt": int(r["options"]) if str(r.get("options") or "").isdigit() else None,
                 "r40": 1 if r40 else 0, "inj": r.get("injurynotes") or None,
                 "nri": 1 if r.get("isNRI") else 0, "acq": r.get("acquired") or None}
            if r.get("playerid"):
                p["fg"] = str(r["playerid"])
            src = d or s
            two = None if is_p else (dc_p.get(mid) or st_p.get(mid))
            if two and (fnum(two.get("ip")) or 0) >= 30 and src:
                src = dict(src)
                src["war"] = (fnum(src.get("war")) or 0) + (fnum(two.get("war")) or 0)
                p["two"] = {k: two.get(k) for k in ("ip", "war", "era", "gs")}
            if src:
                if is_p:
                    p["pj"] = {k: src.get(k) for k in ("ip", "gs", "g", "war", "era", "fip", "kbb", "sv", "r", "k9")}
                else:
                    p["pj"] = {k: src.get(k) for k in ("pa", "war", "wrc", "off", "def", "hr", "avg", "obp", "slg", "sb", "r")}
                p["pjs"] = "dc" if d else "steamer"
            # full-time WAR rate: per 600 PA, per 180 IP as a starter, per 65 IP in relief (Steamer's talent read)
            base = s or d
            if base and two and (fnum(two.get("ip")) or 0) >= 30:
                base = dict(base)
                base["war"] = (fnum(base.get("war")) or 0) + (fnum(two.get("war")) or 0)
            if base:
                if is_p:
                    ip, war = fnum(base.get("ip")) or 0, fnum(base.get("war")) or 0
                    sp = (fnum(base.get("gs")) or 0) >= 0.5 * max(1, fnum(base.get("g")) or 1)
                    p["rate"] = r1(war / max(ip, 40) * 180 if sp else war / max(ip, 20) * 65)
                    p["sp"] = 1 if sp else 0
                else:
                    pa, war = fnum(base.get("pa")) or 0, fnum(base.get("war")) or 0
                    p["rate"] = r1(war / max(pa, 100) * 600)
            if z:
                p["zips"] = {k: z.get(k) for k in (("ip", "war", "era") if is_p else ("pa", "war", "wrc"))}
            if pr:
                p.update(pr)
            if mid in hist:
                p["hist"] = hist[mid]
            wr = war_rec.get(mid) or war_fg.get(p.get("fg"))
            if wr:  # [year, WAR, PA, IP] for each of the last three seasons he played
                p["rec"] = [wr[y] for y in sorted(wr)]
            if mid in minors:
                p["ml"] = minors[mid]
            if ct:
                p["c"] = ct
            players.append({k: v for k, v in p.items() if v is not None})

    teams = [{"tid": t, "abbr": v[0], "name": v[1], "lg": v[2], "div": v[3], "color": v[4], "espn": v[5]}
             for t, v in TEAMS.items()]
    # money a team still owes outside its active contracts: buyouts, released players, cash in trades
    for t in teams:
        other = ((pay or {}).get("teams", {}).get(str(t["tid"])) or {}).get("other") or []
        dead = [[o[0], o[1], o[2]] for o in other if o[0] and o[0] >= season and o[1]]
        if dead:
            t["dead"] = dead

    # league run environment for the standings display (Depth Charts team totals)
    rs = {}
    for r in dc_b.values():
        a = team_of(r.get("tm"))
        if a:
            rs[a] = rs.get(a, 0) + (fnum(r.get("r")) or 0)
    ra = {}
    for r in dc_p.values():
        a = team_of(r.get("tm"))
        if a:
            ra[a] = ra.get(a, 0) + (fnum(r.get("r")) or 0)

    hub = {"season": season, "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
           "pulled": status.get("pulled"), "failed": status.get("failed", []),
           "systems": sorted(sysd.keys()), "board": (board or {}).get("list"),
           "payrollTeams": len((pay or {}).get("teams", {})),
           "teams": teams, "rs": {k: round(v) for k, v in rs.items()}, "ra": {k: round(v) for k, v in ra.items()},
           "players": players}

    # ---- free agents
    # MLB track record before each class: plate appearances and innings over the three seasons before it (a player
    # with little big league time is valued with less faith in his projection)
    mlb_by_year = {}
    for fn in os.listdir(os.path.join(HERE, "mlb")) if os.path.isdir(os.path.join(HERE, "mlb")) else []:
        m = re.match(r"^(\d{4})\.json$", fn)
        if not m:
            continue
        d = json.load(open(os.path.join(HERE, "mlb", fn), encoding="utf-8"))
        tot = {}
        for r in d.get("hitting", []):
            if r.get("id"):
                tot.setdefault(r["id"], [0, 0])[0] += r.get("pa") or 0
        for r in d.get("pitching", []):
            if r.get("id"):
                tot.setdefault(r["id"], [0, 0])[1] += float(r.get("ip") or 0)
        mlb_by_year[int(m.group(1))] = tot
    def track(mid, cls):
        if not mid:
            return None
        pa = ip = 0
        seen = False
        for y in range(int(cls) - 3, int(cls)):
            if y in mlb_by_year:
                seen = True
                t = mlb_by_year[y].get(mid)
                if t:
                    pa += t[0]; ip += t[1]
        return [pa, round(ip)] if seen else None
    FG_ABBR = {"CHW": "CWS", "KCR": "KC", "SDP": "SD", "SFG": "SF", "TBR": "TB", "WSN": "WSH", "OAK": "ATH"}
    fa_out = {"classes": {}}
    if fa:
        c = fa["cols"]
        for yr, rows in fa.get("seasons", {}).items():
            out = []
            for raw in rows:
                r = dict(zip(c, raw))
                fgid = str(r.get("playerId") or "")
                mid = fg2mlbam.get(fgid)
                aav, yrs = fnum(r.get("aav")), r.get("contract_years") or r.get("YearsTotal")
                out.append({k: v for k, v in {
                    "id": mid, "fg": fgid, "n": r.get("playerName"), "pos": r.get("position"), "age": r.get("age"),
                    "wp": r1(fnum(r.get("war_prev"))), "wj": r1(fnum(r.get("war_proj"))), "from": FG_ABBR.get(r.get("team_prev"), r.get("team_prev")), "mlb": track(mid, yr),
                    "st": r.get("free_agent_status"), "qo": fnum(r.get("qo")), "qoa": r.get("qo_accepted"),
                    "my": r.get("med_years"), "ma": fnum(r.get("med_aav")), "to": FG_ABBR.get(r.get("team_new_shortname") or r.get("team_new"), r.get("team_new_shortname") or r.get("team_new")),
                    "yrs": int(yrs) if str(yrs or "").isdigit() else None, "aav": aav, "tot": fnum(r.get("ContractTotal")),
                    "ctype": r.get("ContractType"), "opt": r.get("option_type"), "optst": r.get("option_status"),
                    "b": r.get("Bats"), "th": r.get("Throws")}.items() if v not in (None, "")})
            fa_out["classes"][yr] = out
    os.makedirs(OUT, exist_ok=True)
    for name, data in (("hub.json", hub), ("fa.json", fa_out)):
        path = os.path.join(OUT, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
        print(f"wrote mlb/data/{name} ({os.path.getsize(path) // 1024} KB)")
    print(f"{len(players)} players, {sum(1 for p in players if p.get('fv'))} graded prospects, "
          f"{sum(1 for p in players if p.get('c'))} contracts, {sum(1 for p in players if p.get('pj'))} projections")


if __name__ == "__main__":
    build()
