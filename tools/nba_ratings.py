#!/usr/bin/env python3
"""NBA Hub ratings: every player's skill profile, built each day from public play-by-play and box score data.

Sources (all public, pulled politely once or twice a day):
  pbpstats.com          possessions, shots by zone (rim, short mid, long mid, corner 3, above-the-break 3), assisted and
                        unassisted points, assists by shot zone, putbacks
  Basketball-Reference  advanced (AST%, TOV%, rebound, steal and block rates, usage, BPM), per-100, shooting and
                        play-by-play tables (position estimates, on-court and on/off plus-minus, bad-pass turnovers,
                        charges drawn), this season and last
  nba/data/darko.json   DARKO's daily offense and defense projections (tools/darko_pull.py)

Small early-season samples lean on last season: last season's counts weigh half as much as this season's, and every
rate is shrunk toward the league average by how much it has to go on.

Writes nba/data/ratings.json: each player's category scores as percentiles (league-wide and against his position
group), the stats behind them, a shot profile and an archetype. The page (nba/app.js) only displays it.

Run: python3 tools/nba_ratings.py
"""
import html as htmllib
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "nba", "data", "ratings.json")
UA = "Mozilla/5.0 (compatible; davidsolar-nbahub/1.0; +https://davidsolar.dev/nba/)"
PREV_W = 0.5  # last season's counts weigh half as much as this season's


def get(url, timeout=120, tries=3, wait=8):
    err = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/html", "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # pbpstats answers 502 now and then
            err = e
            time.sleep(wait * (k + 1))
    raise err


def season_label(end_year):
    return f"{end_year - 1}-{str(end_year)[2:]}"


def current_end_year(now=None):
    now = now or datetime.now(timezone.utc)
    return now.year + 1 if now.month >= 10 else now.year


def key(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s)
    return re.sub(r"[^a-z]", "", s)


# ---------- Basketball-Reference tables ----------

def bbref_table(url, tid):
    """Rows of a Basketball-Reference stats table as dicts keyed by data-stat. A traded player's combined row (2TM,
    3TM) comes first; his last team is kept as his team."""
    page = get(url).replace("<!--", "").replace("-->", "")
    m = re.search(r'<table[^>]*id="%s"[^>]*>(.*?)</table>' % tid, page, re.S)
    if not m:
        return {}
    body = m.group(1).split("<tbody>", 1)[-1]
    out = {}
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
        if 'class="thead"' in tr or "data-stat" not in tr:
            continue
        cells = dict((k, htmllib.unescape(re.sub(r"<[^>]+>", "", v)).strip()) for k, v in re.findall(r'data-stat="([^"]+)"[^>]*>(.*?)</t[dh]>', tr, re.S))
        nm = cells.get("name_display") or cells.get("player")
        if not nm or nm == "League Average":
            continue
        k = key(nm)
        tm = cells.get("team_name_abbr") or cells.get("team_id") or ""
        if k in out:
            if re.match(r"\d+TM|TOT", out[k].get("team_name_abbr", "")) and not re.match(r"\d+TM|TOT", tm):
                out[k]["_last_team"] = tm
            continue
        cells["_last_team"] = tm
        out[k] = cells
    return out


def num(x):
    try:
        return float(str(x).replace(",", ""))
    except (TypeError, ValueError):
        return None


def bbref_season(end_year):
    base = f"https://www.basketball-reference.com/leagues/NBA_{end_year}"
    tabs = {}
    for name, tid in [("advanced", "advanced"), ("per_poss", "per_poss"), ("shooting", "shooting"), ("play-by-play", "pbp_stats")]:
        try:
            tabs[name] = bbref_table(f"{base}_{name}.html", tid)
        except Exception as e:
            print(f"Basketball-Reference {name} {end_year}: {type(e).__name__}: {e}", file=sys.stderr)
            tabs[name] = {}
        time.sleep(4)  # Basketball-Reference asks for under 20 requests a minute
    return tabs


# ---------- pbpstats ----------

PBP_KEEP = ["Name", "EntityId", "OffPoss"] + [z + s for _, z in [("", "AtRim"), ("", "ShortMidRange"), ("", "LongMidRange"), ("", "Corner3"), ("", "Arc3")] for s in ("FGM", "FGA")] + [
    "PtsUnassisted2s", "PtsUnassisted3s", "PtsAssisted2s", "PtsAssisted3s", "AssistPoints", "AtRimAssists", "Corner3Assists", "Arc3Assists", "PtsPutbacks"]
PBP_CACHE = os.path.join(ROOT, "nba", "data", "pbp_prev.json")


def pbpstats_prev(end_year):
    """Last season's pbpstats totals never change: fetch them once and keep a copy."""
    lbl = season_label(end_year)
    try:
        c = json.load(open(PBP_CACHE))
        if c.get("season") == lbl and c.get("rows"):
            return {key(r["Name"]): r for r in c["rows"]}
    except (OSError, ValueError):
        pass
    got = pbpstats_season(end_year)
    if got:
        with open(PBP_CACHE, "w", encoding="utf-8") as f:
            json.dump({"season": lbl, "rows": [{k: r.get(k) for k in PBP_KEEP} for r in got.values()]}, f, separators=(",", ":"), ensure_ascii=False)
    return got


def pbpstats_season(end_year):
    url = f"https://api.pbpstats.com/get-totals/nba?Season={season_label(end_year)}&SeasonType=Regular%20Season&Type=Player"
    try:
        rows = json.loads(get(url)).get("multi_row_table_data") or []
    except Exception as e:
        print(f"pbpstats {end_year}: {type(e).__name__}: {e}", file=sys.stderr)
        return {}
    return {key(r["Name"]): r for r in rows if r.get("Name")}


# ---------- the model ----------

ZONES = [("rim", "AtRim"), ("smid", "ShortMidRange"), ("lmid", "LongMidRange"), ("c3", "Corner3"), ("a3", "Arc3")]


def shrink(made, att, prior, k):
    return (made + prior * k) / (att + k) if att + k > 0 else prior


def pctile(vals, x):
    """Share of the pool below x, 0-99."""
    if x is None or not vals:
        return None
    below = sum(1 for v in vals if v < x)
    eq = sum(1 for v in vals if v == x)
    return max(0, min(99, int(100 * (below + 0.5 * eq) / len(vals))))


def zscore(vals):
    m = sum(vals) / len(vals)
    sd = math.sqrt(sum((v - m) ** 2 for v in vals) / len(vals)) or 1
    return lambda x: 0.0 if x is None else (x - m) / sd


def group_of(pos_avg, pos):
    if pos_avg is not None:
        return "G" if pos_avg < 2.4 else "W" if pos_avg < 4.3 else "B"
    p = (pos or "").upper()
    return "B" if "C" in p else "G" if "G" in p and "F" not in p else "W"


def main():
    end = current_end_year()
    cur_bb, prev_bb = bbref_season(end), bbref_season(end - 1)
    cur_pb, prev_pb = pbpstats_season(end), pbpstats_prev(end - 1)
    darko = {}
    try:
        dk = json.load(open(os.path.join(ROOT, "nba", "data", "darko.json")))
        for r in dk.get("p") or []:
            darko[key(r[0])] = r
    except Exception as e:
        print(f"darko.json: {e}", file=sys.stderr)

    adv_c, adv_p = cur_bb.get("advanced", {}), prev_bb.get("advanced", {})
    if not adv_c:
        sys.exit("No Basketball-Reference advanced table for this season; keeping yesterday's ratings")
    names = set(adv_c) | {k for k in adv_p if k in darko}

    players = []
    for k in names:
        ac, ap = adv_c.get(k, {}), adv_p.get(k, {})
        mc, mp = num(ac.get("mp")) or 0, num(ap.get("mp")) or 0
        w_c, w_p = mc, PREV_W * mp
        tot_w = w_c + w_p
        if tot_w <= 0:
            continue

        def blend(tab, stat):
            """Minutes-weighted blend of a Basketball-Reference rate across the two seasons."""
            vc = num(cur_bb.get(tab, {}).get(k, {}).get(stat))
            vp = num(prev_bb.get(tab, {}).get(k, {}).get(stat))
            parts = [(vc, w_c), (vp, w_p)]
            s = sum(v * w for v, w in parts if v is not None and w > 0)
            ww = sum(w for v, w in parts if v is not None and w > 0)
            return s / ww if ww else None

        pc, pp = cur_pb.get(k, {}), prev_pb.get(k, {})

        def cnt(field):
            return (num(pc.get(field)) or 0) + PREV_W * (num(pp.get(field)) or 0)

        poss = cnt("OffPoss")
        pbc = cur_bb.get("play-by-play", {}).get(k, {}) or prev_bb.get("play-by-play", {}).get(k, {})
        pos_avg = None
        pcts = [num(pbc.get(f"pct_{i}")) for i in range(1, 6)]
        if any(pcts) and sum(x or 0 for x in pcts) > 0:
            pos_avg = sum(i * (x or 0) for i, x in enumerate(pcts, 1)) / sum(x or 0 for x in pcts)
        nm = ac.get("name_display") or ap.get("name_display")
        team = ac.get("_last_team") or ac.get("team_name_abbr") or ap.get("_last_team") or ""
        dr = darko.get(k)
        r = {
            "n": nm, "t": team if not re.match(r"\d+TM|TOT", team) else "", "age": num(ac.get("age") or ap.get("age")),
            "pos": ac.get("pos") or ap.get("pos") or "", "g": group_of(pos_avg, ac.get("pos") or ap.get("pos")), "pa": pos_avg,
            "nba": (pc or pp).get("EntityId"), "mc": round(mc), "mp": round(mp), "w": tot_w,
            "gp": num(ac.get("games")) or 0,
            # per 100 and rates (Basketball-Reference, blended)
            "pts100": blend("per_poss", "pts_per_poss"), "ts": blend("advanced", "ts_pct"), "usg": blend("advanced", "usg_pct"),
            "ast": blend("advanced", "ast_pct"), "tov": blend("advanced", "tov_pct"), "orb": blend("advanced", "orb_pct"),
            "drb": blend("advanced", "drb_pct"), "stl": blend("advanced", "stl_pct"), "blk": blend("advanced", "blk_pct"),
            "fta_fga": blend("advanced", "fta_per_fga_pct"), "obpm": blend("advanced", "obpm"), "dbpm": blend("advanced", "dbpm"),
            "fg3a100": blend("per_poss", "fg3a_per_poss"), "fta100": blend("per_poss", "fta_per_poss"),
            "ortg": num(cur_bb.get("per_poss", {}).get(k, {}).get("off_rtg")), "drtg": num(cur_bb.get("per_poss", {}).get(k, {}).get("def_rtg")),
            "on": num(cur_bb.get("play-by-play", {}).get(k, {}).get("plus_minus_on")), "onoff": num(cur_bb.get("play-by-play", {}).get(k, {}).get("plus_minus_net")),
            "darko_o": dr[2] if dr else None, "darko_d": dr[3] if dr else None,
        }
        # shooting counts: Basketball-Reference per-100 x minutes for 3s and free throws, both seasons
        fg3m = fg3a = ftm = fta = 0.0
        for bb, wgt in ((cur_bb, 1.0), (prev_bb, PREV_W)):
            row = bb.get("per_poss", {}).get(k)
            sh = bb.get("advanced", {}).get(k)
            if not row or not sh:
                continue
            m = num(sh.get("mp")) or 0
            poss_est = m * 2.1  # about 100 team possessions a 48-minute game, per player minute
            fg3m += wgt * (num(row.get("fg3_per_poss")) or 0) * poss_est / 100
            fg3a += wgt * (num(row.get("fg3a_per_poss")) or 0) * poss_est / 100
            ftm += wgt * (num(row.get("ft_per_poss")) or 0) * poss_est / 100
            fta += wgt * (num(row.get("fta_per_poss")) or 0) * poss_est / 100
        r.update({"fg3m": fg3m, "fg3a": fg3a, "ftm": ftm, "fta": fta})
        # zones, creation and assists from pbpstats
        if poss > 0:
            zones = {}
            for z, f in ZONES:
                zones[z] = (cnt(f + "FGM"), cnt(f + "FGA"))
            r["zones"] = zones
            r["poss"] = poss
            r["unast100"] = (cnt("PtsUnassisted2s") + cnt("PtsUnassisted3s")) / poss * 100
            r["ast_share"] = (cnt("PtsAssisted2s") + cnt("PtsAssisted3s")) / max(1, cnt("PtsAssisted2s") + cnt("PtsAssisted3s") + cnt("PtsUnassisted2s") + cnt("PtsUnassisted3s"))
            r["astpts100"] = cnt("AssistPoints") / poss * 100
            r["rimast100"] = (cnt("AtRimAssists") + cnt("Corner3Assists") + cnt("Arc3Assists")) / poss * 100
            r["putback100"] = cnt("PtsPutbacks") / poss * 100
        players.append(r)

    pool = [p for p in players if p["w"] >= 250]
    if len(pool) < 100:
        sys.exit(f"Only {len(pool)} players with enough minutes; keeping yesterday's ratings")

    # league priors for shrinkage
    lg = lambda f: sum(p[f] for p in pool if p.get(f) is not None) / max(1, sum(1 for p in pool if p.get(f) is not None))
    lg3 = sum(p["fg3m"] for p in pool) / max(1, sum(p["fg3a"] for p in pool))
    lgft = sum(p["ftm"] for p in pool) / max(1, sum(p["fta"] for p in pool))
    zone_lg = {}
    for z, _ in ZONES:
        m = sum(p["zones"][z][0] for p in pool if p.get("zones"))
        a = sum(p["zones"][z][1] for p in pool if p.get("zones"))
        zone_lg[z] = m / a if a else 0.45
    lg_ts = lg("ts")

    for p in players:
        p["p3"] = shrink(p["fg3m"], p["fg3a"], lg3, 75)
        p["pft"] = shrink(p["ftm"], p["fta"], lgft, 40)
        if p.get("zones"):
            rm, ra = p["zones"]["rim"]
            p["prim"] = shrink(rm, ra, zone_lg["rim"], 40)
            p["rim100"] = ra / p["poss"] * 100
            mm = p["zones"]["smid"][0] + p["zones"]["lmid"][0]
            ma = p["zones"]["smid"][1] + p["zones"]["lmid"][1]
            p["pmid"] = shrink(mm, ma, (zone_lg["smid"] + zone_lg["lmid"]) / 2, 50)
        # TS% shrunk toward the league by volume
        if p.get("ts") is not None:
            vol = (p.get("usg") or 15) * p["w"] / 100
            p["ts_adj"] = (p["ts"] * vol + lg_ts * 60) / (vol + 60)
        # impact: DARKO when he has it, box plus-minus (shrunk) otherwise
        bo = p.get("obpm"); bd = p.get("dbpm")
        rel = p["w"] / (p["w"] + 1500)
        p["o_imp"] = p["darko_o"] if p.get("darko_o") is not None else (bo * rel if bo is not None else None)
        p["d_imp"] = p["darko_d"] if p.get("darko_d") is not None else (bd * rel if bd is not None else None)
        if p["o_imp"] is not None and p["d_imp"] is not None:
            p["imp"] = p["o_imp"] + p["d_imp"]

    # ball security: turnovers against what his usage and passing load would predict (low-usage spot-up players
    # rarely turn it over, which isn't the same skill as a lead guard who doesn't)
    fit = [p for p in pool if p.get("tov") is not None and p.get("usg") is not None and p.get("ast") is not None]
    n = len(fit)
    xs = [(1.0, p["usg"], p["ast"]) for p in fit]
    ys = [p["tov"] for p in fit]
    XtX = [[sum(x[i] * x[j] for x in xs) for j in range(3)] for i in range(3)]
    Xty = [sum(x[i] * y for x, y in zip(xs, ys)) for i in range(3)]
    # solve the 3x3 normal equations (Gaussian elimination)
    M = [row[:] + [v] for row, v in zip(XtX, Xty)]
    for c in range(3):
        piv = max(range(c, 3), key=lambda r: abs(M[r][c]))
        M[c], M[piv] = M[piv], M[c]
        for r in range(3):
            if r != c and M[c][c]:
                f = M[r][c] / M[c][c]
                M[r] = [a - f * b for a, b in zip(M[r], M[c])]
    beta = [M[i][3] / M[i][i] if M[i][i] else 0 for i in range(3)]
    for p in players:
        if p.get("tov") is not None and p.get("usg") is not None and p.get("ast") is not None:
            p["tov_x"] = beta[0] + beta[1] * p["usg"] + beta[2] * p["ast"] - p["tov"]

    # categories: each a weighted sum of z-scores over the pool
    def comp(fields):
        zs = {}
        for f, wgt in fields:
            vals = [p.get(f) for p in pool if p.get(f) is not None]
            if len(vals) < 50:
                continue
            zs[f] = (zscore(vals), wgt)
        def score(p):
            got = [(fz(p.get(f)) * wgt, abs(wgt)) for f, (fz, wgt) in zs.items() if p.get(f) is not None]
            return sum(a for a, _ in got) / sum(b for _, b in got) if got else None
        return score

    CATS = {
        "shoot": ("Shooting", [("p3", 0.4), ("fg3a100", 0.35), ("pft", 0.15), ("pmid", 0.1)]),
        "finish": ("Finishing", [("prim", 0.45), ("rim100", 0.35), ("fta_fga", 0.2)]),
        "score": ("Scoring", [("pts100", 0.6), ("ts_adj", 0.4)]),
        "create": ("Creation", [("unast100", 0.75), ("usg", 0.25)]),
        "pass": ("Playmaking", [("ast", 0.5), ("astpts100", 0.5)]),
        "secure": ("Ball security", [("tov_x", 0.6), ("usg", 0.25), ("tov", -0.15)]),
        "reb": ("Rebounding", [("drb", 0.6), ("orb", 0.4)]),
        "rimd": ("Rim protection", [("blk", 0.75), ("drb", 0.25)]),
        "steal": ("Disruption", [("stl", 1.0)]),
        "off": ("Offensive impact", [("o_imp", 1.0)]),
        "def": ("Defensive impact", [("d_imp", 1.0)]),
        "overall": ("Overall impact", [("imp", 1.0)]),
    }
    raw = {}
    for c, (_, fields) in CATS.items():
        f = comp(fields)
        for p in players:
            raw.setdefault(id(p), {})[c] = f(p)
    for c in CATS:
        allv = [raw[id(p)][c] for p in pool if raw[id(p)][c] is not None]
        byg = {g: [raw[id(p)][c] for p in pool if p["g"] == g and raw[id(p)][c] is not None] for g in "GWB"}
        for p in players:
            v = raw[id(p)][c]
            p.setdefault("r", {})[c] = pctile(allv, v)
            p.setdefault("rp", {})[c] = pctile(byg[p["g"]], v)

    # archetypes, first match wins
    def arche(p):
        r, rp, g = p["r"], p["rp"], p["g"]
        R = lambda c: r.get(c) or 0
        P = lambda c: rp.get(c) or 0
        if R("overall") >= 97 and R("off") >= 85 and R("def") >= 70: return "Two-way superstar"
        if g == "B":
            if R("pass") >= 85 and R("create") >= 60: return "Playmaking big"
            if R("score") >= 85 and R("create") >= 75: return "Scoring big"
            guard_rim = P("rimd") >= 70 or (P("def") >= 85 and R("rimd") >= 70)
            if guard_rim and R("shoot") >= 55: return "Stretch rim protector"
            if guard_rim: return "Rim protector"
            if R("shoot") >= 60: return "Stretch big"
            if R("finish") >= 70: return "Rim runner"
            return "Rotation big"
        if R("create") >= 85 and R("pass") >= 75: return "Primary creator"
        if R("create") >= 80 and R("score") >= 75: return "Three-level scorer" if R("shoot") >= 60 else "Shot creator"
        if R("pass") >= 85: return "Floor general"
        if R("shoot") >= 70 and R("def") >= 65: return "3-and-D " + ("wing" if g == "W" else "guard")
        if R("shoot") >= 80: return "Shooter"
        if R("def") >= 75 or R("steal") >= 85: return "Defensive stopper"
        if R("finish") >= 75: return "Slasher"
        if R("pass") >= 70: return "Connector"
        return "Role player"

    out = []
    for p in sorted(players, key=lambda x: -(x.get("imp") if x.get("imp") is not None else -99)):
        if p["mc"] < 60 and p["mp"] < 400:
            continue
        zones = {}
        if p.get("zones"):
            tot = sum(a for _, a in p["zones"].values()) or 1
            zones = {z: [round(a / tot, 3), round(m / a, 3) if a else None, round(zone_lg[z], 3)] for z, (m, a) in p["zones"].items()}
        rd = lambda x, n=1: None if x is None else round(x, n)
        out.append({
            "n": p["n"], "t": p["t"], "age": p["age"], "pos": p["pos"], "g": p["g"], "pa": None if p.get("pa") is None else round(p["pa"], 1), "nba": p["nba"],
            "mc": p["mc"], "mp": p["mp"], "gp": p["gp"], "q": p["w"] >= 250,
            "arch": arche(p), "r": p["r"], "rp": p["rp"],
            "s": {"pts100": rd(p.get("pts100")), "ts": rd(p.get("ts"), 3), "usg": rd(p.get("usg")), "p3": rd(p.get("p3"), 3),
                  "fg3a100": rd(p.get("fg3a100")), "pft": rd(p.get("pft"), 3), "prim": rd(p.get("prim"), 3), "rim100": rd(p.get("rim100")),
                  "unast100": rd(p.get("unast100")), "ast_share": rd(p.get("ast_share"), 3), "ast": rd(p.get("ast")), "astpts100": rd(p.get("astpts100")),
                  "tov": rd(p.get("tov")), "orb": rd(p.get("orb")), "drb": rd(p.get("drb")), "blk": rd(p.get("blk")), "stl": rd(p.get("stl")),
                  "obpm": rd(p.get("obpm")), "dbpm": rd(p.get("dbpm")), "o": rd(p.get("o_imp")), "d": rd(p.get("d_imp")), "imp": rd(p.get("imp")),
                  "on": rd(p.get("on")), "onoff": rd(p.get("onoff")), "ortg": p.get("ortg"), "drtg": p.get("drtg"), "fta_fga": rd(p.get("fta_fga"), 3)},
            "zones": zones,
        })
    doc = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "season": season_label(end), "prev": season_label(end - 1),
        "prevWeight": PREV_W, "pool": len(pool),
        "cats": {c: lbl for c, (lbl, _) in CATS.items()},
        "sources": {"pbpstats": bool(cur_pb), "pbpstatsPrev": bool(prev_pb), "bbref": bool(adv_c), "bbrefPrev": bool(adv_p), "darko": bool(darko)},
        "players": out,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    print(f"Wrote {OUT}: {len(out)} players, pool {len(pool)}, sources {doc['sources']}")


if __name__ == "__main__":
    main()
