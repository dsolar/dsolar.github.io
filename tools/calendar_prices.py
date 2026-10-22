#!/usr/bin/env python3
"""Watch ticket prices for Night Out and send an alert when they drop.

Reads calendar/events.json, picks the shows worth watching (bands we love, big shows, bands we like,
favorite comics, and anything a friend marked Interested or Going), finds each one on SeatGeek, and
records its lowest listed price in calendar/prices.json. When a show's lowest price falls at least 10%
and $10 below the last price we alerted on (or the first price we saw), it sends a push notification
through ntfy (free phone app, https://ntfy.sh) and, if set, an email.

  SEATGEEK_CLIENT_ID   required (free: https://seatgeek.com/account/develop or developer.seatgeek.com)
  NTFY_TOPIC           where alerts go; without it, drops are only shown on the page
  ALERT_EMAIL          optional: ntfy also emails each alert here

  python tools/calendar_prices.py
"""
import json
import os
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CAL = os.path.join(ROOT, "calendar")
ET = ZoneInfo("America/New_York")
SG = "https://api.seatgeek.com/2/events"
UA = "davidsolar-nightout/1.0 (+https://davidsolar.dev/calendar/)"
DROP_PCT, DROP_USD = 0.10, 10      # an alert needs both: 10% and $10 under the last alert
MAX_WATCH = 80                     # shows looked up per run
RETRY_MISS_DAYS = 3                # how long to wait before looking again for a show SeatGeek didn't have
GAME_DAYS = 14                     # home games (Celtics, Bruins, Patriots) this many days out are watched too,
                                   # so the home page ticker can show their ticket prices
KEEP_DAYS = 90                     # price history kept per show
PRICE_FIELDS = ("lowest_price", "lowest_sg_base_price", "lowest_price_good_deals", "lowest_sg_base_price_good_deals",
                "median_price", "average_price")


def get_json(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s.replace("&", " and ")).strip()


def first(s):
    words = [w for w in norm(s).split() if w not in ("the", "at")]
    return words[0] if words else ""


def sg(params, client):
    q = dict(params, client_id=client)
    return get_json(SG + "?" + urllib.parse.urlencode(q))


FAILED = object()                  # find(): the search itself failed, as opposed to SeatGeek not having the show
# Home games are found by the team's SeatGeek listing rather than a text search, which doesn't match
# SeatGeek's sports titles ("Nashville Predators at Boston Bruins"). Keyed by the calendar's team name.
TEAM_SLUGS = {"Celtics": "boston-celtics", "Bruins": "boston-bruins", "Patriots": "new-england-patriots"}


def find(e, client):
    """The SeatGeek event for one of our shows: same day, same venue (or at least the same city).
    None when SeatGeek doesn't have it; FAILED when the search couldn't be made (network, bad answer)."""
    q = re.sub(r"\bvs\.?\b", " ", e["title"], flags=re.I)
    q = re.sub(r"[:(].*$", "", q).strip()
    nxt = (datetime.fromisoformat(e["date"]) + timedelta(days=1)).date().isoformat()
    team = TEAM_SLUGS.get(e["title"].split(" vs ")[0]) if e.get("source") == "espn" else None
    search = {"performers.slug": team} if team else {"q": q}
    try:
        res = sg(dict(search, **{"datetime_local.gte": e["date"], "datetime_local.lt": nxt, "per_page": 10}), client)
    except Exception as err:
        print(f"::warning::SeatGeek search for {e['title']} failed: {err}")
        return FAILED
    if team:
        print(f"  {e['date']} {e['title']}: SeatGeek has {len(res.get('events', []))} {team} event(s) that day: "
              + "; ".join(f"{c.get('title')} at {(c.get('venue') or {}).get('name')}" for c in res.get("events", [])))
    # A team's own listing only holds its games, so any one that day will do; the venue then picks the home game.
    best, best_score = None, -1 if team else 0
    city = norm((e.get("city") or "").split(",")[0])
    for c in res.get("events", []):
        v = c.get("venue") or {}
        s = 0
        if first(v.get("name")) and first(v.get("name")) == first(e.get("venue")):
            s += 2
        if city and norm(v.get("city")) == city:
            s += 1
        if s > best_score:
            best, best_score = c, s
    return best


def by_ids(ids, client):
    out = {}
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        try:
            res = sg({"id": ",".join(map(str, chunk)), "per_page": len(chunk)}, client)
            for c in res.get("events", []):
                out[c["id"]] = c
        except Exception as err:
            print(f"::warning::SeatGeek batch lookup failed: {err}")
    for i in [i for i in ids if i not in out]:  # one at a time for anything the batch missed
        try:
            out[i] = get_json(f"{SG}/{i}?" + urllib.parse.urlencode({"client_id": client}))
            time.sleep(0.2)
        except Exception as err:
            print(f"::notice::SeatGeek event {i} unavailable ({getattr(err, 'code', err)}).")
    return out


def alert(rec, low, was, topic, email):
    when = datetime.fromisoformat(rec["date"]).strftime("%a %b %-d")
    msg = {
        "topic": topic,
        "title": f"{rec['title']}: ${low:.0f}",
        "message": f"{when} at {rec['venue']}. Lowest ticket ${low:.0f}, down from ${was:.0f} ({rec.get('src') or 'SeatGeek'}).",
        "click": rec["url"],
        "tags": ["ticket", "chart_with_downwards_trend"],
    }
    if email:
        msg["email"] = email
    try:
        get_json("https://ntfy.sh/", data=json.dumps(msg).encode(), headers={"Content-Type": "application/json"})
        return True
    except Exception as err:  # keep going; the drop gets alerted on the next run
        print(f"::warning::Couldn't send the alert for {rec['title']}: {err}")
        return False


def main():
    client = os.environ.get("SEATGEEK_CLIENT_ID", "").strip()
    if not client:
        print("::notice::No SEATGEEK_CLIENT_ID yet, so ticket prices aren't being watched.")
        return
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    email = os.environ.get("ALERT_EMAIL", "").strip()
    events = json.load(open(os.path.join(CAL, "events.json"), encoding="utf-8"))
    path = os.path.join(CAL, "prices.json")
    prices = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    before = json.dumps({k: v for k, v in prices.items() if k != "updated"}, sort_keys=True)
    recs, misses, drops = prices.get("events", {}), prices.get("misses", {}), prices.get("drops", [])
    now = datetime.now(timezone.utc)
    today = now.astimezone(ET).date().isoformat()

    votes = {}
    if events.get("votes_url"):
        try:
            votes = get_json(events["votes_url"]).get("votes", {})
        except Exception as err:
            print(f"::notice::Vote box not reachable ({err}); watching by taste only.")

    def marked(e):
        return any(votes.get(i) for i in [e["id"]] + e.get("aka", []))

    soon = (now.astimezone(ET).date() + timedelta(days=GAME_DAYS)).isoformat()

    def game_soon(e):
        return e.get("source") == "espn" and e["date"] <= soon

    watch = [e for e in events["events"] if e["date"] >= today and (e.get("score", 0) >= 2 or marked(e) or game_soon(e))]
    watch.sort(key=lambda e: (not (marked(e) or game_soon(e)), -e.get("score", 0), e["date"]))
    watch = watch[:MAX_WATCH]
    ids = {e["id"] for e in watch}

    # Shows we already matched: one batched lookup. New ones: a search each.
    known = {e["id"]: recs[e["id"]]["sg"] for e in watch if e["id"] in recs and recs[e["id"]].get("sg")}
    live = by_ids(sorted(set(known.values())), client) if known else {}
    for e in watch:
        if e["id"] in known:
            continue
        miss = misses.get(e["id"])
        if miss and not game_soon(e) and miss > (now - timedelta(days=RETRY_MISS_DAYS)).date().isoformat():
            continue                # home games are looked for on every run: a new listing should show up fast
        c = find(e, client)
        time.sleep(0.2)
        if c is FAILED:             # try again next run, without counting it as a show SeatGeek doesn't have
            continue
        if not c:
            misses[e["id"]] = today
            continue
        misses.pop(e["id"], None)
        known[e["id"]] = c["id"]
        live[c["id"]] = c

    sent = 0
    fields_seen = set()
    for e in watch:
        c = live.get(known.get(e["id"])) or {}
        st = c.get("stats") or {}
        # SeatGeek fills different price fields for different events; take the first one it gave us.
        fields_seen.update(k for k, x in st.items() if x not in (None, 0, ""))
        sg_low = next((st.get(k) for k in PRICE_FIELDS if st.get(k)), None)
        # A show SeatGeek has priced before keeps its record when SeatGeek gives no price this run (lookup failed,
        # or no listings right now): Ticketmaster's face value isn't comparable and would read as a false drop.
        if not sg_low and recs.get(e["id"], {}).get("src") == "SeatGeek":
            continue
        # When SeatGeek has no price, fall back on Ticketmaster's lowest face value from the calendar build.
        low = sg_low or e.get("from")
        if not low and not c:
            continue
        rec = recs.setdefault(e["id"], {"history": []})
        # Only the lowest price is kept: listing counts and averages move every hour and would mean a commit each run.
        rec.update(sg=c.get("id"), title=e["title"], date=e["date"], venue=e.get("venue", ""),
                   url=c.get("url") if sg_low or not e.get("url") else e["url"],
                   src="SeatGeek" if sg_low else ("Ticketmaster" if low else None))
        rec["low"] = low
        if not low:
            continue
        hist = rec["history"]
        if hist and hist[-1][0] == today:
            hist[-1][1] = min(hist[-1][1], low)
        else:
            hist.append([today, low])
        rec["history"] = hist[-KEEP_DAYS:]
        rec.setdefault("first", low)
        base = rec.get("alert_at") or rec["first"]
        if low <= base * (1 - DROP_PCT) and base - low >= DROP_USD:
            ok = alert(rec, low, base, topic, email) if topic else True
            if ok:
                sent += bool(topic)
                rec["alert_at"] = low
                drops.insert(0, {"id": e["id"], "at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "low": low, "was": base})

    # Forget shows that are over or no longer on the calendar.
    listed = {e["id"] for e in events["events"]}
    for k in [k for k, r in recs.items() if r.get("date", "") < today or k not in listed]:
        recs.pop(k)
    misses = {k: v for k, v in misses.items() if k in ids}
    drops = [d for d in drops if d["id"] in recs][:30]

    out = {"updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "SeatGeek, else Ticketmaster face value", "fields": sorted(fields_seen),
           "events": recs, "misses": misses, "drops": drops}
    if json.dumps({k: v for k, v in out.items() if k != "updated"}, sort_keys=True) == before:
        print("No change.")
        return
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"Watching {len(recs)} shows on SeatGeek, {len(misses)} not found; {sent} alert(s) sent.")


if __name__ == "__main__":
    main()
