#!/usr/bin/env python3
"""NHL Edge (puck and player tracking) for the NHL Hub: every rostered player's season Edge profile from the NHL's
own API (api-web.nhle.com/v1/edge/skater-detail and goalie-detail), with the league's percentile for each number.

Writes nhl/data/edge.json:
  {season, pulled, failed, sk: {id: {metric: [value, percentile 0-100]}}, g: {...}, avg: {sk: {metric: avg}, g: {...}}}

The NHL's pages are read generically: any number that comes with a percentile is kept, named by where it sits
(skatingSpeed.speedMax becomes "speedMax", zone time at even strength "es.offensiveZonePctg", a goalie's save
percentage on high-danger shots "high.savePctg"), so a field the NHL adds shows up without a code change.
Players come from nhl/data/hub.json. A player whose page fails keeps his last good numbers.
"""
import json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "nhl", "data", "edge.json")
API = "https://api-web.nhle.com/v1/edge/{kind}-detail/{id}/{season}/2"
SKIP = {"overlay", "player", "team", "seasonsWithEdgeStats", "headshot"}


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "davidsolar.dev NHL hub"})
            return json.loads(urllib.request.urlopen(req, timeout=30).read())
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def num(v):
    if isinstance(v, dict):
        v = v.get("imperial", v.get("value"))
    return round(float(v), 4) if isinstance(v, (int, float)) else None


def flatten(node, prefix, out, avg):
    """Every number on the page that has a percentile beside it: {name: [value, percentile]} plus league averages."""
    if isinstance(node, list):
        for item in node:
            if isinstance(item, dict):
                code = item.get("strengthCode") or item.get("locationCode") or item.get("area")
                if code:
                    flatten(item, (prefix + "." if prefix else "") + str(code).replace(" ", "_"), out, avg)
        return
    if not isinstance(node, dict):
        return
    if "percentile" in node:  # {imperial|value, percentile, leagueAvg}
        v = num(node)
        if v is not None and node.get("percentile") is not None:
            out[prefix] = [v, round(100 * float(node["percentile"]))]
            a = num(node.get("leagueAvg"))
            if a is not None:
                avg[prefix] = a
        return
    for k, v in node.items():
        if k in SKIP:
            continue
        if k.endswith("Percentile") and v is not None:  # flat pairs: offensiveZonePctg + offensiveZonePercentile
            base = k[: -len("Percentile")]
            vk = next((c for c in (base, base + "Pctg") if isinstance(node.get(c), (int, float))), None)
            if vk:
                name = (prefix + "." if prefix else "") + vk
                out[name] = [round(float(node[vk]), 4), round(100 * float(v))]
                ak = next((c for c in (base + "LeagueAvg", vk + "LeagueAvg") if isinstance(node.get(c), (int, float))), None)
                if ak:
                    avg[name] = round(float(node[ak]), 4)
            continue
        if isinstance(v, (dict, list)):
            flatten(v, k if not prefix else prefix + "." + k, out, avg)


def short(name):
    """Drop the outer wrapper names the NHL nests numbers in, so skatingSpeed.speedMax reads speedMax."""
    for w in ("skatingSpeed.", "stats.", "zoneTimeDetails.", "shotLocationSummary.", "zoneStarts."):
        name = name.replace(w, "")
    return name.replace("sogSummary.", "sog.")


def main():
    hub = json.load(open(os.path.join(ROOT, "nhl", "data", "hub.json")))
    s = str(hub.get("season", ""))  # "2026-27"
    season = s[:4] + str(int(s[:4]) + 1) if len(s) >= 4 and s[:4].isdigit() else None
    if not season:
        sys.exit("no season in hub.json")
    try:
        prev = json.load(open(OUT))
        if prev.get("season") != season:
            prev = {}
    except Exception:
        prev = {}
    players = [(p["id"], "goalie" if p.get("pos") == "G" else "skater") for p in hub.get("players", []) if p.get("id")]

    def one(job):
        pid, kind = job
        try:
            page = get(API.format(kind=kind, id=pid, season=season))
        except Exception as e:
            return pid, kind, None, None, str(e)
        out, avg = {}, {}
        flatten(page, "", out, avg)
        keep = lambda k: not k.startswith(("sogDetails.", "shotLocationDetails."))  # the rink-area detail runs long
        return pid, kind, {short(k): v for k, v in out.items() if keep(k)}, {short(k): v for k, v in avg.items() if keep(k)}, None

    res = {"season": season, "pulled": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "failed": [], "sk": {}, "g": {}, "avg": {"sk": {}, "g": {}}}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for pid, kind, out, avg, err in ex.map(one, players):
            key = "g" if kind == "goalie" else "sk"
            if err is not None:
                res["failed"].append(pid)
                old = (prev.get(key) or {}).get(str(pid))
                if old:
                    res[key][str(pid)] = old
                continue
            if out:
                res[key][str(pid)] = out
                for k, v in avg.items():
                    res["avg"][key].setdefault(k, v)
    if not res["sk"] and prev.get("sk"):
        sys.exit("Edge returned nothing; keeping the last file")
    with open(OUT, "w") as f:
        json.dump(res, f, separators=(",", ":"))
    print(f"wrote {OUT}: {len(res['sk'])} skaters, {len(res['g'])} goalies, {len(res['failed'])} failed, season {season}")
    metrics = sorted({k for v in res["sk"].values() for k in v})
    print("skater metrics:", metrics)
    print("goalie metrics:", sorted({k for v in res["g"].values() for k in v}))


if __name__ == "__main__":
    main()
