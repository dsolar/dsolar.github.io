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


def match_college(hub, an_games, k_events):
    teams, games, keys = college_games(hub)
    lo, hi = (now - timedelta(days=2)).strftime("%Y-%m-%d"), (now + timedelta(days=8)).strftime("%Y-%m-%d")
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
            if score and (best is None or score > best[0]):
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


def flip(d):
    d = dict(d)
    if "sp" in d: d["sp"] = [-d["sp"][0] if d["sp"][0] is not None else None, 100 - d["sp"][1] if d["sp"][1] is not None else None]
    if "ml" in d: d["ml"] = [d["ml"][1], d["ml"][0], 100 - d["ml"][2] if d["ml"][2] is not None else None]
    return d


def flipk(d):
    d = dict(d); d["h"], d["a"] = d.get("a"), d.get("h"); return d


# ---------------- Action Network ----------------
def an_pull(league, queries):
    games = []
    for q in queries:
        d = get(AN + league + "?bookIds=15&" + q)
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
            if g.get("status") != "scheduled": data["_live"] = True
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
        out.append({"day": e["day"], "home_names": [norm(h["name"]), norm(h["code"])], "away_names": [norm(a["name"]), norm(a["code"])],
                    "home_abbr": h["code"], "away_abbr": a["code"],
                    "data": {"t": ev, "h": price(h), "a": price(a), "v": vol, "at": now.strftime("%Y-%m-%dT%H:%MZ")}})
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
    if hub in ("cbb", "cfb"):
        _, games, _ = college_games(hub)
        for g in games:
            if g.get("state") in ("in", "post"):
                started.add(g["id"])
    merged = dict(old)
    for gid, v in fresh.items():
        cur = dict(merged.get(gid, {}))
        live = gid in started or bool(v.get("an", {}).get("_live"))
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
    if p.exists() and json.loads(p.read_text()).get("games") == merged:
        return False
    p.write_text(text)
    return True


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

    print("\n".join(report + log))
    print("changed:", ",".join(changed) or "none")
    if all("AN 0 games" in r and "Kalshi 0 events" in r for r in report):
        sys.exit("Both sources came back empty for every hub.")


if __name__ == "__main__":
    main()
