#!/usr/bin/env python3
"""Daily pull for the Big Board's mock draft: draft order, pick owners, team records, and prospect details.

Writes tools/draft_data/:
  nba-order.json, nfl-order.json   every pick in order as [pick, round, owner, original team], from Tankathon's full
                                   draft (current standings, with each traded pick resolved as of today)
  records.json                     each team's record and playoff seed from ESPN's standings
  projections.json                 each team's projected record from ESPN's BPI and FPI
  nba-info.json, nfl-info.json     per prospect (by Big Board key): height, weight, class, age, school logo, stats
and a new tools/draft_boards/nfl/tankathon/<date>.json whenever Tankathon's NFL board order changes (the NBA one
already comes in through Hard Cap's pull).

Anything that fails to load keeps the last good file, and the log says which.
"""
import html as H
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from draft_build import key  # noqa: E402

DATA = os.path.join(ROOT, "tools", "draft_data")
UA = "Mozilla/5.0 (compatible; davidsolar-draft/1.0; +https://davidsolar.dev/draft/)"
Q = "region=us&lang=en&contentorigin=espn"
TODAY = (datetime.now(timezone.utc) - timedelta(hours=5)).date().isoformat()


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def text(s):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def save(name, obj):
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def load(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


TEAMS = load(os.path.join(ROOT, "tools", "draft_teams.json"))


def order(lg):
    """Tankathon's full draft: one table per round; each row has the pick number, the owner's logo, and a 'trade'
    block with the original team's logo when the pick changed hands."""
    by_tank = {t["tank"]: abbr for abbr, t in TEAMS[lg].items()}
    page = fetch("https://www.tankathon.com/full_draft" if lg == "nba" else "https://www.tankathon.com/nfl/full_draft")
    picks, rnd = [], 0
    for chunk in re.split(r'class="round-title"', page)[1:]:
        rnd += 1
        for tr in re.findall(r"<tr>(.*?)</tr>", chunk, re.S):
            num = re.search(r'pick-num[^"]*">\s*(\d+)|class="pick-number">\s*(\d+)', tr)
            logos = re.findall(r"cloudfront\.net/" + lg + r"/([a-z]+)\.svg", tr)
            if not num or not logos:
                continue
            n = int(num.group(1) or num.group(2))
            trade = re.search(r'class="trade".*?cloudfront\.net/' + lg + r"/([a-z]+)\.svg", tr, re.S)
            own = by_tank.get(logos[0])
            orig = by_tank.get(trade.group(1)) if trade else own
            if own and orig:
                picks.append([n, rnd, own, orig])
    want = 60 if lg == "nba" else 200
    if len(picks) < want:
        raise ValueError(f"only {len(picks)} picks parsed")
    return picks


def records():
    out = {"seeds": {}}
    for lg, path in (("nba", "basketball/nba"), ("nfl", "football/nfl")):
        data = json.loads(fetch(f"https://site.web.api.espn.com/apis/v2/sports/{path}/standings?{Q}"))
        by_espn = {t["espn"]: abbr for abbr, t in TEAMS[lg].items()}
        rec = {}
        stack = [data]
        while stack:
            node = stack.pop()
            for e in (node.get("standings") or {}).get("entries", []):
                code = (e["team"].get("abbreviation") or "").lower()
                ab = by_espn.get(code) or (code.upper() if code.upper() in TEAMS[lg] else None)
                stats = {s["name"]: s.get("displayValue") for s in e.get("stats", [])}
                seed = next((s.get("value") for s in e.get("stats", []) if s["name"] == "playoffSeed"), None)
                if ab and seed:
                    out["seeds"].setdefault(lg, {})[ab] = int(seed)
                if ab:
                    w, l, t = stats.get("wins", "0"), stats.get("losses", "0"), stats.get("ties", "0")
                    rec[ab] = f"{w}-{l}" + (f"-{t}" if t not in (None, "0") else "")
            stack.extend(node.get("children", []))
        out[lg] = rec
    return out


def projections():
    """ESPN's power index projected records (BPI for the NBA, FPI for the NFL), for the mock's projected order."""
    out = {}
    for lg, path in (("nba", "basketball/nba"), ("nfl", "football/nfl")):
        data = json.loads(fetch(f"https://site.web.api.espn.com/apis/fitt/v3/sports/{path}/powerindex?{Q}&limit=50"))
        by_espn = {t["espn"]: abbr for abbr, t in TEAMS[lg].items()}
        rows = {}
        for t in data.get("teams", []):
            code = (t.get("team", {}).get("abbreviation") or "").lower()
            ab = by_espn.get(code) or (code.upper() if code.upper() in TEAMS[lg] else None)
            cat = next((c for c in t.get("categories", []) if c.get("name") == "projections"), None)
            if ab and cat and cat.get("values") and cat["values"][0] is not None:
                rows[ab] = {"w": round(float(cat["values"][0]), 1), "l": round(float(cat["values"][1]), 1)}
        if len(rows) < len(TEAMS[lg]):
            raise ValueError(f"{lg}: only {len(rows)} teams")
        out[lg] = rows
    return out


def board(lg):
    """Tankathon's big board rows: rank, name, school, position, size, class/age, school logo and the stat line
    (totals and per game for football, per game for basketball once the season has games)."""
    page = fetch("https://www.tankathon.com/big_board" if lg == "nba" else "https://www.tankathon.com/nfl/big_board")
    starts = [m.start() for m in re.finditer(r'<div class="mock-row(?:\s[^"]*)?"', page)]
    rows, info, seen = [], {}, set()
    for i, st in enumerate(starts):
        block = page[st: starts[i + 1] if i + 1 < len(starts) else st + 20000]
        name = re.search(r'mock-row-name">(.*?)</div>', block, re.S)
        if not name:
            continue
        n = text(name.group(1))
        k = key(n)
        if k in seen:
            continue
        seen.add(k)
        rank = re.search(r'mock-row-pick-number">\s*(\d+)', block)
        sp = re.search(r'mock-row-school-position">(.*?)</div>', block, re.S)
        pos, school = "", ""
        if sp:
            parts = [x.strip() for x in text(sp.group(1)).split("|")]
            pos, school = (parts + ["", ""])[:2]
        logo = re.search(r'cloudfront\.net/ncaa/([a-z0-9-]+)\.svg', block)
        flag = re.search(r'class="flag-border" alt="([^"]+)"', block)
        hw = re.search(r'height-weight"><div>(.*?)</div><div>\s*(\d+)', block, re.S)
        ya = re.search(r'year-age[^"]*"><div>(.*?)</div><div>([\d.]+) yrs', block, re.S)
        stats = []
        pg = re.search(r'stats-per-game"[^>]*>(.*?)</div>\s*</div>\s*<div class="universal-stat', block, re.S)
        adv = re.search(r'stats-advanced"[^>]*>(.*?)</div>\s*</div>\s*</div>', block, re.S)
        for part in [x.group(1) for x in (pg, adv) if x]:
            for lab, val in re.findall(r'class="label">([^<]+)</div><div class="value[^"]*">([^<]*)</div>', part):
                stats.append([text(lab).upper(), val.strip(), ""])
        for lab, tot, per in ([] if stats else re.findall(
                r'class="label">([^<]+)</div><div class="value total">([^<]*)</div><div class="value per-game"[^>]*>([^<]*)</div>', block)):
            stats.append([text(lab), tot.strip(), per.strip()])
        r = int(rank.group(1)) if rank else len(rows) + 1
        rows.append([r, n, school, pos])
        info[k] = {k2: v for k2, v in {
            "ht": text(hw.group(1)) if hw else "", "wt": int(hw.group(2)) if hw else None,
            "yr": text(ya.group(1)) if ya else "", "age": float(ya.group(2)) if ya else None,
            "logo": logo.group(1) if logo else "", "flag": flag.group(1) if flag else "",
            "stats": stats}.items() if v not in ("", None, [])}
    if len(rows) < 30:
        raise ValueError(f"only {len(rows)} prospects parsed")
    return rows, info


def nfl_snapshot(rows):
    """A new dated Tankathon NFL board file only when its order changed since the last one."""
    d = os.path.join(ROOT, "tools", "draft_boards", "nfl", "tankathon")
    os.makedirs(d, exist_ok=True)
    files = sorted(f for f in os.listdir(d) if f.endswith(".json"))
    if files:
        last = load(os.path.join(d, files[-1]), {}) or {}
        if [r[1] for r in last.get("ranks", [])] == [r[1] for r in rows]:
            return "unchanged"
    head = {"date": TODAY, "url": "https://www.tankathon.com/nfl/big_board", "title": "Tankathon NFL big board"}
    body = ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in rows)
    with open(os.path.join(d, TODAY + ".json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(head, ensure_ascii=False, indent=1)[:-2] + ',\n "ranks": [\n' + body + "\n ]\n}\n")
    return "new snapshot"


SCHOOL_ALIAS = {"uconn": "uconn", "connecticut": "uconn", "miami fl": "miami", "miami (fl)": "miami",
                "mississippi": "ole miss", "southern california": "usc", "st. john's": "st john s"}


def schools(lg, names):
    """Add ESPN team ids for schools new to the boards (for their logos). Clubs abroad just stay unmatched."""
    path = os.path.join(ROOT, "tools", "draft_schools.json")
    have = load(path, {}) or {}
    known = have.setdefault(lg, {})
    todo = sorted({n for n in names if n and n not in known})
    if not todo:
        return 0
    sport = "basketball/mens-college-basketball" if lg == "nba" else "football/college-football"
    data = json.loads(fetch(f"https://site.web.api.espn.com/apis/site/v2/sports/{sport}/teams?{Q}&limit=1000"))
    norm = lambda x: re.sub(r"[^a-z0-9]+", " ", x.lower()).strip()
    idx = {}
    for t in data["sports"][0]["leagues"][0]["teams"]:
        t = t["team"]
        for k in ("location", "shortDisplayName", "displayName", "nickname", "abbreviation"):
            if t.get(k):
                idx.setdefault(norm(t[k]), t["id"])
    added = 0
    for n in todo:
        tid = idx.get(norm(SCHOOL_ALIAS.get(n.lower(), n)))
        if tid:
            known[n] = tid
            added += 1
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(have, ensure_ascii=False, indent=0))
    return added


def main():
    for lg in ("nba", "nfl"):
        try:
            p = order(lg)
            save(f"{lg}-order.json", {"updated": TODAY, "source": "Tankathon", "picks": p})
            print(f"{lg} order: {len(p)} picks, {sum(1 for x in p if x[2] != x[3])} traded")
        except Exception as e:
            print(f"{lg} order: kept the last file ({type(e).__name__}: {e})")
        try:
            rows, info = board(lg)
            save(f"{lg}-info.json", {"updated": TODAY, "players": info})
            msg = nfl_snapshot(rows) if lg == "nfl" else "rank from Hard Cap's pull"
            try:
                names = {r[2] for r in rows}
                for f in __import__("glob").glob(os.path.join(ROOT, "tools", "draft_boards", lg, "*", "*.json")):
                    names |= {r[2] for r in (load(f, {}) or {}).get("ranks", [])}
                n_new = schools(lg, names)
                if n_new:
                    msg += f", {n_new} new school logos"
            except Exception as e:
                msg += f", school logos skipped ({type(e).__name__})"
            print(f"{lg} board: {len(rows)} prospects, {sum(1 for v in info.values() if v.get('stats'))} with stats ({msg})")
        except Exception as e:
            print(f"{lg} board: kept the last file ({type(e).__name__}: {e})")
    try:
        pr = projections()
        save("projections.json", {"updated": TODAY, "source": "ESPN Basketball Power Index and Football Power Index projected records", **pr})
        print(f"projections: {len(pr['nba'])} NBA, {len(pr['nfl'])} NFL")
    except Exception as e:
        print(f"projections: kept the last file ({type(e).__name__}: {e})")
    try:
        rec = records()
        save("records.json", {"updated": TODAY, **rec})
        print(f"records: {len(rec['nba'])} NBA, {len(rec['nfl'])} NFL, seeds for {len(rec['seeds'].get('nba', {}))} NBA teams")
    except Exception as e:
        print(f"records: kept the last file ({type(e).__name__}: {e})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
