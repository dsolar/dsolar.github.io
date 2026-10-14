#!/usr/bin/env python3
"""Build calendar/events.json for Night Out (davidsolar.dev/calendar/).

Sources, merged and de-duplicated:
  calendar/picks.json   hand-picked events (road trips, special shows) and movies
  calendar/venues.json  the big rooms' published calendars, copied by hand (a stopgap until the keys below)
  ESPN schedules        home games for the teams in calendar/taste.json (no key needed)
  Ticketmaster          Boston-area comedy and music, plus road trips for the "love" and "big" bands,
                        when a TICKETMASTER_KEY is set (free key: developer.ticketmaster.com)
  SeatGeek              the same, including venues Ticketmaster doesn't sell (Roadrunner, Royale, the
                        Sinclair), when a SEATGEEK_CLIENT_ID is set

Each event gets a score: 3 for a band we love, 2 for a big band, one we like or a favorite comedian,
1 for other comedy, games and hand picks, 0 for other big-venue shows. The page shows
score 1+ as "Our picks" and everything under "Everything".

  python tools/calendar_update.py
"""
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CAL = os.path.join(ROOT, "calendar")
ET = ZoneInfo("America/New_York")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
DAYS_AHEAD = 180
MPH = 52          # average road speed for drive estimates
ROAD = 1.2        # road miles per straight-line mile


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s.replace("&", " and ")).strip()


def slug(s, n):
    return norm(s).replace(" ", "-")[:n].strip("-")


def matches(text, names):
    t = f" {norm(text)} "
    return next((n for n in names if f" {norm(n)} " in t), None)


def miles(a, b, c, d):
    r = 3958.8
    p1, p2 = math.radians(a), math.radians(c)
    dp, dl = p2 - p1, math.radians(d - b)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def geohash(lat, lon, precision=9):
    """Ticketmaster's geoPoint filter wants a geohash (its old latlong filter is deprecated)."""
    chars, bits, out = "0123456789bcdefghjkmnpqrstuvwxyz", [16, 8, 4, 2, 1], []
    lat_r, lon_r, even, bit, ch = [-90.0, 90.0], [-180.0, 180.0], True, 0, 0
    while len(out) < precision:
        rng, val = (lon_r, lon) if even else (lat_r, lat)
        mid = (rng[0] + rng[1]) / 2
        if val > mid:
            ch |= bits[bit]
            rng[0] = mid
        else:
            rng[1] = mid
        even = not even
        if bit < 4:
            bit += 1
        else:
            out.append(chars[ch])
            bit, ch = 0, 0
    return "".join(out)


def drive_hours(mi):
    return round(mi * ROAD / MPH * 4) / 4


# ------------------------------------------------------------------ sources

def espn_games(taste, today, until):
    out = []
    for t in taste.get("teams", []):
        url = (f"https://site.api.espn.com/apis/site/v2/sports/{t['league']}/teams/{t['espn']}/schedule"
               "?seasontype=2")
        try:
            data = get_json(url)
        except Exception as e:
            print(f"::warning::ESPN schedule for {t['name']} failed: {e}")
            continue
        for ev in data.get("events", []):
            comp = (ev.get("competitions") or [{}])[0]
            sides = comp.get("competitors", [])
            me = next((c for c in sides if c.get("team", {}).get("abbreviation", "").lower() == t["espn"]), None)
            opp = next((c for c in sides if c is not me), None)
            if not me or not opp or (t.get("home_only") and me.get("homeAway") != "home"):
                continue
            start = datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).astimezone(ET)
            d = start.date()
            if not (today <= d <= until):
                continue
            venue = comp.get("venue", {})
            addr = venue.get("address", {})
            opp_name = opp.get("team", {}).get("shortDisplayName") or opp.get("team", {}).get("displayName", "")
            link = next((l.get("href") for l in ev.get("links", []) if "gamecast" in (l.get("rel") or []) or "summary" in (l.get("rel") or [])), None)
            out.append({
                "id": f"espn-{ev['id']}",
                "date": d.isoformat(),
                "time": start.strftime("%H:%M") if comp.get("timeValid", True) else None,
                "title": f"{t['name']} vs {opp_name}",
                "cat": "sports",
                "venue": venue.get("fullName", ""),
                "city": ", ".join(x for x in (addr.get("city"), addr.get("state")) if x),
                "url": link or f"https://www.espn.com/{t['league'].split('/')[1]}/team/schedule/_/name/{t['espn']}",
                "source": "espn",
            })
    return out


def tm_events(key, params, pages=5):
    out = []
    for page in range(pages):
        q = dict(params, apikey=key, size=200, page=page, sort="date,asc")
        data = get_json("https://app.ticketmaster.com/discovery/v2/events.json?" + urllib.parse.urlencode(q))
        out += data.get("_embedded", {}).get("events", [])
        if page + 1 >= data.get("page", {}).get("totalPages", 0):
            break
        time.sleep(0.25)  # stay under 5 requests a second
    return out


def tm_row(e, home, cat):
    v = (e.get("_embedded", {}).get("venues") or [{}])[0]
    loc = v.get("location") or {}
    start = e.get("dates", {}).get("start", {})
    row = {
        "id": f"tm-{e['id']}",
        "date": start.get("localDate"),
        "time": (start.get("localTime") or "")[:5] or None,
        "title": e.get("name", ""),
        "cat": cat,
        "venue": v.get("name", ""),
        "city": ", ".join(x for x in ((v.get("city") or {}).get("name"), (v.get("state") or {}).get("stateCode")) if x),
        "url": e.get("url"),
        "source": "ticketmaster",
        "_price": min((p["min"] for p in e.get("priceRanges", []) if p.get("min")), default=None),
        "_acts": [a.get("name", "") for a in e.get("_embedded", {}).get("attractions", [])],
    }
    try:
        mi = miles(home["lat"], home["lon"], float(loc["latitude"]), float(loc["longitude"]))
        row["_miles"] = mi
    except (KeyError, TypeError, ValueError):
        pass
    return row


def ticketmaster(taste, key, today, until):
    home = taste["home"]
    span = {"startDateTime": f"{today}T00:00:00Z", "endDateTime": f"{until}T23:59:59Z"}
    point = geohash(home["lat"], home["lon"])
    near = dict(span, geoPoint=point, radius=taste.get("local_miles", 30), unit="miles")
    out = []
    try:
        out += [tm_row(e, home, "comedy") for e in tm_events(key, dict(near, classificationName="Comedy"))]
        out += [tm_row(e, home, "music") for e in tm_events(key, dict(near, classificationName="Music"))]
        reach = int(taste.get("road_trip_hours", 4.5) * MPH / ROAD)
        bands = taste.get("bands", {})
        for band in bands.get("love", []) + bands.get("big", []):
            far = dict(span, geoPoint=point, radius=reach, unit="miles",
                       keyword=band, classificationName="Music")
            out += [tm_row(e, home, "music") for e in tm_events(key, far, pages=1)]
            time.sleep(0.25)
    except Exception as e:
        print(f"::warning::Ticketmaster failed partway: {e}")
    return out


def sg_row(e, home):
    v = e.get("venue") or {}
    loc = v.get("location") or {}
    kind = " ".join([e.get("type", "")] + [t.get("name", "") for t in e.get("taxonomies", [])])
    local = e.get("datetime_local") or ""
    row = {
        "id": f"sg-{e['id']}",
        "date": local[:10] or None,
        "time": None if e.get("time_tbd") or e.get("datetime_tbd") else (local[11:16] or None),
        "title": e.get("short_title") or e.get("title", ""),
        "cat": "comedy" if "comedy" in kind else "music",
        "venue": v.get("name", ""),
        "city": ", ".join(x for x in (v.get("city"), v.get("state")) if x),
        "url": e.get("url"),
        "source": "seatgeek",
        "_acts": [p.get("name", "") for p in e.get("performers", [])],
    }
    try:
        row["_miles"] = miles(home["lat"], home["lon"], float(loc["lat"]), float(loc["lon"]))
    except (KeyError, TypeError, ValueError):
        pass
    return row


def sg_show(e):
    kind = " ".join([e.get("type", "")] + [t.get("name", "") for t in e.get("taxonomies", [])])
    return any(k in kind for k in ("concert", "comedy", "music_festival"))


def seatgeek(taste, client, today, until):
    home = taste["home"]
    base = {"client_id": client, "datetime_local.gte": f"{today}T00:00:00", "datetime_local.lte": f"{until}T23:59:59",
            "per_page": 100, "sort": "datetime_local.asc"}
    out = []

    def pages(params, limit):
        for page in range(1, limit + 1):
            data = get_json("https://api.seatgeek.com/2/events?" + urllib.parse.urlencode(dict(base, page=page, **params)))
            evs = data.get("events", [])
            out.extend(sg_row(e, home) for e in evs if sg_show(e))
            if len(evs) < base["per_page"]:
                break
            time.sleep(0.2)

    try:
        near = {"lat": home["lat"], "lon": home["lon"], "range": f"{taste.get('local_miles', 30)}mi"}
        pages(dict(near, **{"taxonomies.name": "comedy"}), 3)
        pages(dict(near, **{"taxonomies.name": "concert"}), 8)
        reach = int(taste.get("road_trip_hours", 4.5) * MPH / ROAD)
        bands = taste.get("bands", {})
        for band in bands.get("love", []) + bands.get("big", []):
            pages({"q": band, "lat": home["lat"], "lon": home["lon"], "range": f"{reach}mi"}, 1)
            time.sleep(0.2)
    except Exception as e:
        print(f"::warning::SeatGeek failed partway: {e}")
    return out


# ------------------------------------------------------------------ build

def big_room(venue, taste):
    v = norm(venue).removeprefix("the ")
    if len(v) < 5:
        return False
    return any(b and (b in v or v in b) for b in (norm(x).removeprefix("the ") for x in taste.get("big_venues", [])))


TRIBUTE = re.compile(r"\b(tribute|cover band|covers|for kids|music of|experience|salute|celebrat)", re.I)
JUNK = re.compile(r"\b(parking|vip (package|upgrade)|premium package|2-day ticket|two-day ticket|day ticket|gift card|add-on|shuttle|vs\.?)\b", re.I)


def who(e, names):
    """The name on our list this show is by. With a performer list (Ticketmaster, SeatGeek), only a performer
    counts, so "Silly Goose" isn't Goose and a Pearl Jam tribute isn't Pearl Jam. Hand-kept shows go by title."""
    acts = [norm(a) for a in e.get("_acts", []) if a]
    if TRIBUTE.search(e["title"]):
        # A tribute act counts only when it's on our list by its own name, which leads the title.
        t = norm(e["title"])
        return next((n for n in names if t.startswith(norm(n))), None)
    if acts:
        for n in names:
            nn = norm(n)
            if any(a == nn or a.startswith(nn + " ") for a in acts):
                return n
        return matches(e.get("sub", ""), names)  # a lineup we wrote into a hand pick's second line
    text = " ".join([e["title"], e.get("sub", "")])
    if TRIBUTE.search(text):
        # A tribute act counts only when it's on our list by its own name, which leads the title.
        t = norm(e["title"])
        return next((n for n in names if t.startswith(norm(n))), None)
    return matches(text, names)


def score(e, taste):
    """3 a band we love, 2 a big band, a band we like or a favorite comic, 1 worth a look, 0 only under All shows."""
    bands, comics = taste.get("bands", {}), taste.get("comedians", [])
    picked = e.get("source") not in ("ticketmaster", "seatgeek", "venues")
    # A tribute never counts as the band it covers; tribute acts we like are on the "like" list by name.
    tribute = bool(TRIBUTE.search(" ".join([e["title"], e.get("sub", "")])))
    if e["cat"] == "music":
        for tier, s, why in (("love", 3, "love"), ("big", 2, "big"), ("like", 2, "like")):
            if tribute and tier != "like":
                continue
            name = who(e, bands.get(tier, []))
            if name:
                e["act"] = name
                return s, why
        return (1, None) if picked else (0, None)
    if e["cat"] == "comedy":
        name = who(e, comics)
        if name:
            e["act"] = name
            return 2, "fav"
        # Touring headliners play the big rooms; the clubs' nightly lineups go under Everything.
        return (1, None) if picked or big_room(e.get("venue", ""), taste) else (0, None)
    return 1, None


def main():
    taste = json.load(open(os.path.join(CAL, "taste.json"), encoding="utf-8"))
    picks = json.load(open(os.path.join(CAL, "picks.json"), encoding="utf-8"))
    today = datetime.now(ET).date()
    until = today + timedelta(days=DAYS_AHEAD)
    local_mi = taste.get("local_miles", 30)

    events = []
    vpath = os.path.join(CAL, "venues.json")
    listed = json.load(open(vpath, encoding="utf-8")).get("events", []) if os.path.exists(vpath) else []
    for source, rows in (("picks", picks.get("events", [])), ("venues", listed)):
        for p in rows:
            if today.isoformat() <= p["date"] <= until.isoformat():
                e = dict(p, source=source)
                e["id"] = e.get("id") or f"{p['date']}-{slug(p['title'], 32)}-{slug(p.get('venue', ''), 20)}"
                events.append(e)
    games = espn_games(taste, today, until)
    events += games
    key = os.environ.get("TICKETMASTER_KEY", "").strip()
    sg_key = os.environ.get("SEATGEEK_CLIENT_ID", "").strip()
    tm = ticketmaster(taste, key, today, until) if key else []
    sg = seatgeek(taste, sg_key, today, until) if sg_key else []
    skip = [norm(x) for x in taste.get("skip", [])]
    for e in tm + sg:
        if not e.get("date") or JUNK.search(e["title"]) or any(x and x in norm(e["title"]) for x in skip):
            continue
        mi = e.get("_miles")
        if mi is not None and mi > local_mi:
            e["drive_hours"] = drive_hours(mi)
        s, why = score(e, taste)
        far = mi is not None and mi > local_mi
        # Around Boston: comedy, any band on our lists, and shows at the big rooms. Farther: love and big bands only.
        if far and (why not in ("love", "big") or e["drive_hours"] > taste.get("road_trip_hours", 4.5)):
            continue
        if not far and s == 0 and not big_room(e["venue"], taste) and e["cat"] == "music":
            continue
        events.append(e)

    # De-duplicate the same show from two sources: prefer Ticketmaster (real ticket link), keep a hand-picked note.
    # Same show = same day, same venue, same first word of the title, and the same start time when both have one
    # (so a comedian's 7:00 and 9:45 sets stay separate).
    def first(s):
        words = [w for w in norm(s).split() if w not in ("the", "an", "a", "evening", "with", "live", "presents")]
        return words[0] if words else ""
    def same_act(a, b):
        # "An Evening With Goose" and "Goose - 2-day Ticket" are one show: same performer, or one title names the other's.
        acts = lambda e: {norm(x) for x in e.get("_acts", []) if x}
        if acts(a) & acts(b):
            return True
        return any(x and f" {x} " in f" {norm(b['title'])} " for x in acts(a)) or any(x and f" {x} " in f" {norm(a['title'])} " for x in acts(b))
    plain = {"the", "at", "of", "and", "theatre", "theater", "center", "centre", "boston", "music", "hall", "club",
             "house", "arena", "citizens", "rock", "live"}
    def place(s):
        return {w for w in norm(s).split() if len(w) >= 3 and w not in plain}
    rank = {"ticketmaster": 0, "seatgeek": 1, "espn": 2, "picks": 3, "venues": 4}
    kept = []
    for e in sorted(events, key=lambda e: rank.get(e.get("source"), 5)):
        twin = next((k for k in kept if k["date"] == e["date"] and place(k.get("venue")) & place(e.get("venue"))
                     and (first(k["title"]) == first(e["title"]) or same_act(k, e))), None)
        if twin:
            if e.get("sub") and not twin.get("sub"):
                twin["sub"] = e["sub"]
            if e.get("time") and not twin.get("time"):
                twin["time"] = e["time"]
            elif e.get("time") and e["time"] != twin["time"]:
                # Early and late sets: one card, every start time.
                twin["times"] = sorted(set(twin.get("times", [twin["time"]]) + [e["time"]]))
                twin["time"] = twin["times"][0]
            if e.get("_price") and (not twin.get("_price") or e["_price"] < twin["_price"]):
                twin["_price"] = e["_price"]
            twin.setdefault("aka", []).append(e["id"])  # votes cast under the other id still count
            continue
        kept.append(e)
    final = []
    for e in kept:
        if e.get("_price"):
            e["from"] = round(e["_price"])   # Ticketmaster's lowest face value, in dollars
        e["score"], e["why"] = score(e, taste)
        if e["why"] is None:
            e.pop("why")
        for k in [k for k in e if k.startswith("_")]:
            e.pop(k)
        final.append(e)
    final.sort(key=lambda e: (e["date"], e.get("time") or "99", e["title"]))

    out = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "votes_url": taste.get("votes_url"),
        "theaters": taste.get("theaters"),
        "events": final,
        "movies": picks.get("movies", []),
        "sources": {"picks": sum(1 for e in final if e["source"] == "picks"),
                    "venues": sum(1 for e in final if e["source"] == "venues"),
                    "espn": sum(1 for e in final if e["source"] == "espn"),
                    "ticketmaster": sum(1 for e in final if e["source"] == "ticketmaster") if key else "no key yet",
                    "seatgeek": sum(1 for e in final if e["source"] == "seatgeek") if sg_key else "no key yet"},
    }
    path = os.path.join(CAL, "events.json")
    if os.path.exists(path):
        old = json.load(open(path, encoding="utf-8"))
        if {k: v for k, v in old.items() if k != "updated"} == {k: v for k, v in out.items() if k != "updated"}:
            print("No change.")
            return
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"Wrote {len(final)} events ({out['sources']}) and {len(out['movies'])} movies.")


if __name__ == "__main__":
    main()
