#!/usr/bin/env python3
"""Public betting data for the CBB, CFB and NFL hubs.

Two sources, both read without a login:
  - Action Network's scoreboard feed (the one actionnetwork.com's own pages use): the share of BETS (tickets) on
    each side of the spread, total and moneyline, plus the number of bets, as one consensus across the books it
    tracks. The feed also carries money percentages, which Action Network sells as part of its PRO product, so this
    script never reads or stores them.
  - Kalshi's public market-data API (documented, no key): last traded price and contracts traded on each team's
    "wins" market, a real-money market read.

Writes <hub>/data/betting.json keyed the way each hub keys its games (ESPN game id for CBB and CFB,
"day|away|home" for the NFL). A game's splits keep updating until it starts and then freeze, so finished games keep
their closing split. Games older than PRUNE_DAYS drop off.
"""
import json, re, sys, time, unicodedata, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
ET = ZoneInfo("America/New_York")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
AN = "https://api.actionnetwork.com/web/v2/scoreboard/"
KALSHI = "https://api.elections.kalshi.com/trade-api/v2/markets"
PRUNE_DAYS = 10
NFL_FIX = {"LA": "LAR", "JAC": "JAX", "WSH": "WAS", "LV": "LV", "OAK": "LV", "SD": "LAC", "STL": "LAR"}
now = datetime.now(timezone.utc)
log = []


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            if i == tries - 1:
                log.append("fetch failed: " + url.split("?")[0] + " " + str(e)[:80])
                return None
            time.sleep(2 * (i + 1))


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ").replace("'", "")
    s = re.sub(r"\bst\.?(?=\s|$)", "state", s)          # "Oregon St." -> "oregon state"
    s = re.sub(r"\bsaint\b", "st", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def et_day(iso):
    t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return t.astimezone(ET).strftime("%Y-%m-%d"), t


# ---------------- hub games ----------------
def college_games(hub):
    h = json.loads((ROOT / hub / "data/hub.json").read_text())
    teams = {t["id"]: t for t in h["teams"]}
    games = list(h["games"])
    if hub == "cbb":                                   # the season schedule carries games past the hub's live window
        try:
            s = json.loads((ROOT / "cbb/data/schedule.json").read_text())
            seen = {g["id"] for g in games}
            games += [g for g in s["games"] if g["id"] not in seen]
        except Exception:
            pass
    keys = {}
    for t in teams.values():
        keys[t["id"]] = {norm(t.get("name")), norm(t.get("short")), norm(t.get("abbr")), norm(t.get("haslamName")), norm(t.get("nick"))} - {""}
    return teams, games, keys


def match_college(hub, an_games, k_events, lo=None, hi=None):
    teams, games, keys = college_games(hub)
    lo = lo or (now - timedelta(days=2)).strftime("%Y-%m-%d")
    hi = hi or (now + timedelta(days=8)).strftime("%Y-%m-%d")
    window = [g for g in games if lo <= g.get("day", "") <= hi and g.get("at")]
    by_team_day = {}
    for g in window:
        d, _ = et_day(g["at"])
        for side in ("home", "away"):
            by_team_day.setdefault((g[side], d), []).append(g)

    def hits(tid, names):        # 2 = a name matches exactly, 1 = a long name is the start of the hub's name, 0 = no
        k = keys.get(tid, set())
        if any(n and n in k for n in names): return 2
        return 1 if any(n and len(n) > 5 and any(x.startswith(n + " ") for x in k) for n in names) else 0

    def find(day, home_names, away_names, t_utc=None):
        best = None
        for g in window:
            d, gt = et_day(g["at"])
            if d != day:
                continue
            if t_utc and abs((gt - t_utc).total_seconds()) > 4 * 3600:
                continue
            hh, aa = hits(g["home"], home_names), hits(g["away"], away_names)
            fh, fa = hits(g["away"], home_names), hits(g["home"], away_names)    # neutral sites can flip home/away
            straight = (hh + aa) if (hh and aa) or max(hh, aa) == 2 else 0       # one side alone must match exactly
            flipped = (fh + fa) if (fh and fa) or max(fh, fa) == 2 else 0
            score = max(straight, flipped)
            if score and (best is None or score > best[0] or (score == best[0] and g["id"].isdigit() and not best[1]["id"].isdigit())):
                best = (score, g, flipped > straight)
        return best

    out = {}
    for ag in an_games:
        d, t = et_day(ag["start"])
        b = find(d, ag["home_names"], ag["away_names"], t)
        if b and b[0] >= 1:
            out.setdefault(b[1]["id"], {})["an"] = flip(ag["data"]) if b[2] else ag["data"]
    for ke in k_events:
        b = find(ke["day"], ke["home_names"], ke["away_names"])
        if b and b[0] >= 1:
            out.setdefault(b[1]["id"], {})["k"] = flipk(ke["data"]) if b[2] else ke["data"]
    # the CBB feed can list one game twice (a schedule placeholder and ESPN's own id); file the numbers under both
    twins = {}
    for g in window:
        twins.setdefault((et_day(g["at"])[0], frozenset((g["home"], g["away"]))), []).append(g)
    for grp in twins.values():
        if len(grp) < 2:
            continue
        have = [g for g in grp if g["id"] in out]
        if not have:
            continue
        src = have[0]
        for g in grp:
            if g["id"] in out:
                continue
            v = out[src["id"]]
            out[g["id"]] = v if g["home"] == src["home"] else {"an": flip(v["an"]) if "an" in v else None, "k": flipk(v["k"]) if "k" in v else None}
            out[g["id"]] = {k: x for k, x in out[g["id"]].items() if x}
    return out, len(window)


def match_nfl(an_games, k_events):
    rows = json.loads((ROOT / "nfl/data/games.json").read_text())["games"]
    idx = {}
    for r in rows:
        day, away, home = r[2], r[3], r[4]
        for dd in (0, -1, 1):                             # a late kickoff can sit on either side of midnight ET
            d = (datetime.strptime(day, "%Y-%m-%d") + timedelta(days=dd)).strftime("%Y-%m-%d")
            idx.setdefault((d, home, away), day + "|" + away + "|" + home)
    out = {}
    for ag in an_games:
        d, _ = et_day(ag["start"])
        h, a = NFL_FIX.get(ag["home_abbr"], ag["home_abbr"]), NFL_FIX.get(ag["away_abbr"], ag["away_abbr"])
        key = idx.get((d, h, a))
        if key:
            out.setdefault(key, {})["an"] = ag["data"]
    for ke in k_events:
        h, a = NFL_FIX.get(ke["home_abbr"], ke["home_abbr"]), NFL_FIX.get(ke["away_abbr"], ke["away_abbr"])
        key = idx.get((ke["day"], h, a))
        if key:
            out.setdefault(key, {})["k"] = ke["data"]
    return out, len(rows)


def pro_games(hub):
    try:
        return json.loads((ROOT / hub / "data/tonight.json").read_text()).get("games") or []
    except Exception:
        return []


def match_pro(hub, an_games, k_events):
    """NBA and NHL: match to tonight.json's ESPN games by day and full team names (Kalshi lists short names, like
    "Los Angeles L", which match as the start of the full name)."""
    games = pro_games(hub)
    names = lambda g, side: norm(g[side]["n"])
    hit = lambda full, cands: any(c and (c == full or (len(c) > 3 and full.startswith(c + " ")) or full.startswith(c)) for c in cands if c)
    out = {}

    def find(day, hn, an_):
        for g in games:
            if g["day"] != day:
                continue
            if hit(names(g, "h"), hn) and hit(names(g, "a"), an_):
                return g, False
            if hit(names(g, "h"), an_) and hit(names(g, "a"), hn):
                return g, True
        return None, False

    for ag in an_games:
        d, _ = et_day(ag["start"])
        g, fl = find(d, ag["home_names"], ag["away_names"])
        if g:
            out.setdefault(g["id"], {})["an"] = flip(ag["data"]) if fl else ag["data"]
    for ke in k_events:
        g, fl = find(ke["day"], ke["home_names"], ke["away_names"])
        if g:
            out.setdefault(g["id"], {})["k"] = flipk(ke["data"]) if fl else ke["data"]
    return out, len(games)


def flip(d):
    d = dict(d)
    if "sp" in d: d["sp"] = [-d["sp"][0] if d["sp"][0] is not None else None, 100 - d["sp"][1] if d["sp"][1] is not None else None]
    if "ml" in d: d["ml"] = [d["ml"][1], d["ml"][0], 100 - d["ml"][2] if d["ml"][2] is not None else None]
    if "op" in d and d["op"][0] is not None: d["op"] = [-d["op"][0], d["op"][1]]
    return d


def flipk(d):
    d = dict(d); d["h"], d["a"] = d.get("a"), d.get("h"); return d


# ---------------- Action Network ----------------
def an_pull(league, queries):
    games = []
    for q in queries:
        d = get(AN + league + "?bookIds=15,30&" + q)
        for g in (d or {}).get("games") or []:
            m = ((g.get("markets") or {}).get("15") or {}).get("event") or {}
            if not m or g.get("status") not in ("scheduled", "inprogress", "complete", "closed"):
                continue
            tm = {t["id"]: t for t in g.get("teams") or []}
            hid, aid = g.get("home_team_id"), g.get("away_team_id")
            if hid not in tm or aid not in tm:
                continue

            def pick(typ, side):
                for r in m.get(typ) or []:
                    if r.get("side") == side or (side in ("home", "away") and r.get("team_id") == (hid if side == "home" else aid)):
                        return r
                return None

            def tix(r):
                p = ((r or {}).get("bet_info") or {}).get("tickets", {}).get("percent")    # tickets only; money % is never read
                return p if isinstance(p, (int, float)) else None

            sh, th, mh, ma = pick("spread", "home"), pick("total", "over"), pick("moneyline", "home"), pick("moneyline", "away")
            sp_pct, tot_pct, ml_pct = tix(sh), tix(th), tix(mh)
            # a market whose two sides read 0 and 0 has no split yet
            sa, tu = pick("spread", "away"), pick("total", "under")
            if sp_pct == 0 and tix(sa) == 0: sp_pct = None
            if tot_pct == 0 and tix(tu) == 0: tot_pct = None
            if ml_pct == 0 and tix(ma) == 0: ml_pct = None
            data = {"id": g["id"], "n": g.get("num_bets"), "at": now.strftime("%Y-%m-%dT%H:%MZ")}
            m30 = ((g.get("markets") or {}).get("30") or {}).get("event") or {}         # book 30 is the opening line
            o_sp = next((r.get("value") for r in m30.get("spread") or [] if r.get("side") == "home" or r.get("team_id") == hid), None)
            o_tot = next((r.get("value") for r in m30.get("total") or [] if r.get("side") == "over"), None)
            if o_sp is not None or o_tot is not None: data["op"] = [o_sp, o_tot]
            # a game is under way once its kickoff time has passed (the feed's status can lag during games)
            try:
                started_at = datetime.fromisoformat(g["start_time"].replace("Z", "+00:00")) <= now
            except Exception:
                started_at = False
            if g.get("status") != "scheduled" or started_at: data["_live"] = True
            if sh: data["sp"] = [sh.get("value"), sp_pct]
            if th: data["tot"] = [th.get("value"), tot_pct]
            if mh and ma: data["ml"] = [mh.get("odds"), ma.get("odds"), ml_pct]
            if sp_pct is None and tot_pct is None and ml_pct is None:
                continue
            H, A = tm[hid], tm[aid]
            names = lambda t: [norm(t.get("full_name")), norm(t.get("display_name")), norm(t.get("location")), norm(t.get("abbr"))]
            games.append({"start": g["start_time"], "status": g.get("status"), "home_names": names(H), "away_names": names(A),
                          "home_abbr": H.get("abbr"), "away_abbr": A.get("abbr"), "data": data})
    uniq = {g["data"]["id"]: g for g in games}
    return list(uniq.values())


# ---------------- Kalshi ----------------
MONTHS = {m: i for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], 1)}


def kalshi_pull(series):
    events, cursor = {}, ""
    for _ in range(20):
        d = get(KALSHI + "?series_ticker=" + series + "&status=open&limit=1000" + ("&cursor=" + cursor if cursor else ""))
        if not d:
            break
        for m in d.get("markets") or []:
            ev = m.get("event_ticker") or ""
            mt = re.match(r"^[A-Z]+-(\d\d)([A-Z]{3})(\d\d)([A-Z0-9]+)$", ev)
            if not mt or mt.group(2) not in MONTHS:
                continue
            day = "20%s-%02d-%s" % (mt.group(1), MONTHS[mt.group(2)], mt.group(3))
            code = (m.get("ticker") or "").rsplit("-", 1)[-1]
            e = events.setdefault(ev, {"day": day, "pair": mt.group(4), "sides": []})
            num = lambda k: float(m.get(k)) if m.get(k) not in (None, "") else None
            e.setdefault("exp", m.get("expected_expiration_time"))
            e["sides"].append({"code": code, "name": m.get("yes_sub_title") or "", "last": num("last_price_dollars"),
                               "bid": num("yes_bid_dollars"), "ask": num("yes_ask_dollars"), "vol": num("volume_fp") or 0})
        cursor = d.get("cursor") or ""
        if not cursor:
            break
    out = []
    for ev, e in events.items():
        if len(e["sides"]) != 2:
            continue
        # Kalshi tickers list the away team first: KXNFLGAME-26NOV30CARTB is Carolina at Tampa Bay
        a, h = sorted(e["sides"], key=lambda s: 0 if e["pair"].startswith(s["code"]) else 1)
        if not e["pair"].startswith(a["code"]):
            continue

        def price(s):
            if s["bid"] is not None and s["ask"] is not None and 0 < s["bid"] <= s["ask"] < 1:
                return round((s["bid"] + s["ask"]) / 2, 3)
            return s["last"] if s["last"] else None

        vol = round(a["vol"] + h["vol"])
        # Kalshi sets a game market to expire about three hours after kickoff; past kickoff its price is a live one
        live = False
        try:
            live = now >= datetime.fromisoformat(str(e.get("exp")).replace("Z", "+00:00")) - timedelta(hours=3, minutes=30)
        except Exception:
            pass
        out.append({"day": e["day"], "home_names": [norm(h["name"]), norm(h["code"])], "away_names": [norm(a["name"]), norm(a["code"])],
                    "home_abbr": h["code"], "away_abbr": a["code"],
                    "data": dict({"t": ev, "h": price(h), "a": price(a), "v": vol, "at": now.strftime("%Y-%m-%dT%H:%MZ")}, **({"_live": True} if live else {}))})
    return out


# ---------------- merge and write ----------------
def write(hub, fresh, src_note):
    p = ROOT / hub / "data/betting.json"
    old = {}
    try:
        old = json.loads(p.read_text()).get("games", {})
    except Exception:
        pass
    started = set()
    if hub in ("nba", "nhl"):
        started = {g["id"] for g in pro_games(hub) if g.get("st") in ("in", "post")}
    if hub in ("cbb", "cfb"):
        _, games, _ = college_games(hub)
        for g in games:
            if g.get("state") in ("in", "post"):
                started.add(g["id"])
    merged = dict(old)
    for gid, v in fresh.items():
        cur = dict(merged.get(gid, {}))
        live = gid in started or bool(v.get("an", {}).get("_live")) or bool(v.get("k", {}).get("_live"))
        for k, val in v.items():
            # freeze a game's numbers once it's under way, so finals keep the closing split; a Kalshi price first seen
            # mid-game is a live price, not a pregame one, so it's skipped
            if live and (k in cur or k == "k"):
                continue
            cur[k] = {x: y for x, y in val.items() if x != "_live"}
        merged[gid] = cur
    cutoff = (now - timedelta(days=PRUNE_DAYS)).strftime("%Y-%m-%d")
    day_of = lambda gid, v: (gid.split("|")[0] if "|" in gid else (v.get("an", {}).get("at") or v.get("k", {}).get("at") or "9999")[:10])
    merged = {gid: v for gid, v in merged.items() if day_of(gid, v) >= cutoff}
    body = {"updated": now.strftime("%Y-%m-%dT%H:%MZ"), "src": src_note, "games": merged}
    text = json.dumps(body, separators=(",", ":"), sort_keys=True)
    if hub == "nfl":                                  # NFL games have started once their kickoff day has passed
        today = now.astimezone(ET).strftime("%Y-%m-%d")
        started |= {gid for gid in merged if gid.split("|")[0] < today}
    hist_changed = keep_closing(hub, merged, started)
    if p.exists() and json.loads(p.read_text()).get("games") == merged:
        return hist_changed
    p.write_text(text)
    return True


def keep_closing(hub, merged, started_ids):
    """lines_hist.json: one compact row per game that has started, for grading the hub against the market all season.
    c = closing home spread and total, o = opening home spread and total, bp = % of spread bets on the home team,
    tp = % of total bets on the over, n = bets. Spreads use the book convention: negative = home favored."""
    p = ROOT / hub / "data/lines_hist.json"
    try:
        hist = json.loads(p.read_text())
    except Exception:
        hist = {}
    n0 = json.dumps(hist, sort_keys=True)
    for gid, v in merged.items():
        x = v.get("an")
        if not x or gid not in started_ids or not x.get("sp"):
            continue
        hist[gid] = row(x)
    if json.dumps(hist, sort_keys=True) != n0:
        p.write_text(json.dumps(hist, separators=(",", ":"), sort_keys=True))
        return True
    return False


def row(x):
    sp, tot, op = x.get("sp") or [None, None], x.get("tot") or [None, None], x.get("op") or [None, None]
    return {"c": [sp[0], tot[0]], "o": op, "bp": sp[1], "tp": tot[1], "n": x.get("n")}


SRC = {"an": "Share of bets (tickets) and number of bets: Action Network consensus across the books it tracks (actionnetwork.com). Money percentages are an Action Network PRO feature and are not shown.",
       "k": "Prices and contracts traded on each team's 'wins' market: Kalshi public market data (kalshi.com)."}


def main():
    days = [(now.astimezone(ET) + timedelta(days=i)).strftime("%Y%m%d") for i in (-1, 0, 1, 2)]
    changed, report = [], []

    # CBB
    an = an_pull("ncaab", ["division=D1&date=" + d for d in days])
    ks = kalshi_pull("KXNCAAMBGAME")
    m, n = match_college("cbb", an, ks)
    report.append("cbb: AN %d games, Kalshi %d events -> matched %d hub games (AN %d, Kalshi %d)" % (len(an), len(ks), len(m), sum("an" in v for v in m.values()), sum("k" in v for v in m.values())))
    if write("cbb", m, SRC): changed.append("cbb")

    # CFB (Action Network counts weeks from 0, ESPN from 1, so ask for a spread of weeks and let kickoff times decide)
    try:
        cur = json.loads((ROOT / "cfb/data/hub.json").read_text())["current"]["week"]
    except Exception:
        cur = 12
    an = an_pull("ncaaf", ["division=FBS&seasonType=reg&week=%d" % w for w in (cur, cur + 1, cur + 2)] + ["division=FBS&seasonType=post"])
    ks = kalshi_pull("KXNCAAFGAME")
    m, n = match_college("cfb", an, ks)
    report.append("cfb: AN %d games, Kalshi %d events -> matched %d hub games (AN %d, Kalshi %d)" % (len(an), len(ks), len(m), sum("an" in v for v in m.values()), sum("k" in v for v in m.values())))
    if write("cfb", m, SRC): changed.append("cfb")

    # NFL
    try:
        wk = json.loads((ROOT / "nfl/data/games.json").read_text())["week"]
    except Exception:
        wk = 12
    an = an_pull("nfl", ["seasonType=reg&week=%d" % w for w in (wk, wk + 1, wk + 2)])
    ks = kalshi_pull("KXNFLGAME")
    m, n = match_nfl(an, ks)
    report.append("nfl: AN %d games, Kalshi %d events -> matched %d hub games (AN %d, Kalshi %d)" % (len(an), len(ks), len(m), sum("an" in v for v in m.values()), sum("k" in v for v in m.values())))
    if write("nfl", m, SRC): changed.append("nfl")

    # NBA and NHL, keyed by ESPN game id (the games in <hub>/data/tonight.json)
    for hub, league, series in (("nba", "nba", "KXNBAGAME"), ("nhl", "nhl", "KXNHLGAME")):
        an = an_pull(league, ["date=" + d for d in days])
        ks = kalshi_pull(series)
        m, n = match_pro(hub, an, ks)
        report.append("%s: AN %d games, Kalshi %d events -> matched %d hub games (AN %d, Kalshi %d)" % (hub, len(an), len(ks), len(m), sum("an" in v for v in m.values()), sum("k" in v for v in m.values())))
        if write(hub, m, SRC): changed.append(hub)

    print("\n".join(report + log))
    print("changed:", ",".join(changed) or "none")
    if all("AN 0 games" in r and "Kalshi 0 events" in r for r in report):
        sys.exit("Both sources came back empty for every hub.")


if __name__ == "__main__":
    main()
