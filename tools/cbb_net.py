#!/usr/bin/env python3
"""The NCAA's official NET rankings for the College Basketball Hub, into cbb/data/net.json.

NET (the NCAA Evaluation Tool) is what the selection committee sorts teams by, and its quadrants (Q1 to Q4: wins and
losses by opponent NET and site) are the résumé it reads. The NCAA publishes it once a day from about December 1 at
ncaa.com/rankings/basketball-men/d1/ncaa-mens-basketball-net-rankings; this reads that table (or, if the page won't
parse, the same table from the open ncaa-api mirror) and matches each school to the hub's ESPN team id.

  {season, through (the NCAA's "through games" date), pulled, status, teams: {espn id: {rank, prev, rec, conf, road,
   neutral, home, q: [Q1, Q2, Q3, Q4]}}, unmatched: [school names the matcher missed]}

Before the season's first release the page still shows last season's final NET, so a table only counts if its
date falls in this season (or, without a date, if its records agree with this season's). Otherwise the last good
file is kept and status says why. Never raises: a miss just keeps what's there.

Usage: python3 tools/cbb_net.py [--file PATH]   (a saved copy of the page or the mirror's JSON, for testing)
"""
import datetime as dt
import difflib
import html
import json
import re
import sys
import unicodedata
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "cbb" / "data" / "net.json"
HUB = ROOT / "cbb" / "data" / "hub.json"
PAGE = "https://www.ncaa.com/rankings/basketball-men/d1/ncaa-mens-basketball-net-rankings"
MIRROR = "https://ncaa-api.henrygd.me/rankings/basketball-men/d1/ncaa-mens-basketball-net-rankings"
UA = "Mozilla/5.0 (compatible; davidsolar-cbb/1.0; +https://davidsolar.dev/cbb/)"
FILE = sys.argv[sys.argv.index("--file") + 1] if "--file" in sys.argv else None

# NCAA spellings the rules below can't reach, to the hub's short name
ALIAS = {"uconn": "UConn", "olemiss": "Ole Miss", "lsu": "LSU", "byu": "BYU", "tcu": "TCU", "smu": "SMU", "ucf": "UCF", "unlv": "UNLV",
         "vcu": "VCU", "utep": "UTEP", "utsa": "UTSA", "uab": "UAB", "fiu": "FIU", "fgcu": "FGCU", "etsu": "ETSU", "uni": "Northern Iowa", "uncw": "UNC Wilmington", "mississippival": "Miss Valley St",
         "niu": "N Illinois", "siue": "SIUE", "utrgv": "UTRGV", "uic": "UIC", "umkc": "Kansas City", "uiw": "Incarnate Word", "sfa": "SF Austin",
         "stephenfaustin": "SF Austin", "lmuca": "LMU", "loyolamarymount": "LMU", "appstate": "App State", "appalachianstate": "App State",
         "southerncalifornia": "USC", "usc": "USC", "ncstate": "NC State", "northcarolinastate": "NC State", "pittsburgh": "Pitt",
         "hawaii": "Hawai'i", "sanjosestate": "San José St", "jacksonvillestate": "Jax State", "purduefortwayne": "Purdue FW", "fortwayne": "Purdue FW",
         "texasamcorpuschristi": "Texas A&M-CC", "texasamcc": "Texas A&M-CC", "amcorpuschristi": "Texas A&M-CC", "southeastmostate": "SE Missouri", "southeastmissouristate": "SE Missouri", "liu": "Long Island", "csun": "CSU Northridge",
         "csubakersfield": "Bakersfield", "calstatebakersfield": "Bakersfield", "csufullerton": "Fullerton",
         "calstatefullerton": "Fullerton", "csunorthridge": "CSU Northridge", "calstatenorthridge": "CSU Northridge", "ucsantabarbara": "Santa Barbara",
         "ucsb": "Santa Barbara", "bethunecookman": "Bethune", "eastcarolina": "East Carolina", "ecu": "East Carolina", "louisianatech": "Louisiana Tech",
         "latech": "Louisiana Tech", "tarleton": "Tarleton St", "tarletonstate": "Tarleton St", "seattleu": "Seattle U", "seattle": "Seattle U",
         "southflorida": "South Florida", "usf": "South Florida", "rhodeisland": "Rhode Island", "uri": "Rhode Island", "jamesmadison": "James Madison",
         "jmu": "James Madison", "texamcommerce": "East Texas A&M", "texasamcommerce": "East Texas A&M", "centralconnstate": "C Connecticut", "centralconnecticutstate": "C Connecticut", "centralconnecticut": "C Connecticut", "mdeastshore": "MD Eastern", "marylandeasternshore": "MD Eastern", "umes": "MD Eastern", "southeasternla": "SE Louisiana", "southeasternlouisiana": "SE Louisiana", "gwashington": "G Washington", "georgewashington": "G Washington", "saintjosephs": "Saint Joseph's",
         "stjosephs": "Saint Joseph's", "umasslowell": "UMass Lowell", "massachusetts": "UMass", "umass": "UMass", "miamifl": "Miami", "miamioh": "Miami OH",
         "stjohnsny": "St John's", "saintmarysca": "Saint Mary's", "stmarysca": "Saint Mary's", "loyolail": "Loyola Chicago", "loyolachicago": "Loyola Chicago",
         "loyolamd": "Loyola MD", "stthomasmn": "St Thomas", "ulm": "UL Monroe", "louisianamonroe": "UL Monroe", "louisiana": "Louisiana",
         "ullafayette": "Louisiana", "omaha": "Omaha", "nebraskaomaha": "Omaha", "utmartin": "UT Martin", "tennesseemartin": "UT Martin",
         "queensnc": "Queens", "queens": "Queens", "mountstmarys": "Mount St Mary's", "mtstmarys": "Mount St Mary's", "albanyny": "UAlbany", "albany": "UAlbany",
         "ualbany": "UAlbany", "binghamton": "Binghamton", "njit": "NJIT", "fdu": "FDU", "fairleighdickinson": "FDU", "ucsandiego": "UC San Diego",
         "ucirvine": "UC Irvine", "ucdavis": "UC Davis", "ucriverside": "UC Riverside", "texassouthern": "Texas Southern", "alabamaam": "Alabama A&M",
         "prairieview": "Prairie View", "prairieviewam": "Prairie View", "grambling": "Grambling", "gramblingstate": "Grambling",
         "arkpinebluff": "AR-Pine Bluff", "arkansaspinebluff": "AR-Pine Bluff", "mississippivalley": "Miss Valley St", "mississippivalleystate": "Miss Valley St",
         "ncat": "NC A&T", "northcarolinaat": "NC A&T", "nccentral": "NC Central", "northcarolinacentral": "NC Central", "scstate": "SC State",
         "southcarolinastate": "SC State", "usc upstate": "USC Upstate", "uscupstate": "USC Upstate", "southcarolinaupstate": "USC Upstate",
         "csusacramento": "Sacramento St", "sacramentostate": "Sacramento St", "calbaptist": "California Baptist", "californiabaptist": "California Baptist",
         "kennesawstate": "Kennesaw St", "gardnerwebb": "Gardner-Webb", "presbyterian": "Presbyterian", "charlestonsouthern": "Charleston So",
         "charlestonsc": "Charleston", "collegeofcharleston": "Charleston", "wmichigan": "W Michigan", "westernmichigan": "W Michigan"}
DIRS = {"n": "north", "s": "south", "e": "east", "w": "west", "c": "central", "se": "southeast", "sw": "southwest", "ne": "northeast", "nw": "northwest"}


def plain(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower().replace("&", "")


ABBR = {"fla": "florida", "ky": "kentucky", "wash": "washington", "mich": "michigan", "tenn": "tennessee", "caro": "carolina", "ill": "illinois",
        "mo": "missouri", "ga": "georgia", "ala": "alabama", "ark": "arkansas", "miss": "mississippi", "la": "louisiana", "colo": "colorado",
        "ariz": "arizona", "ind": "indiana", "okla": "oklahoma", "va": "virginia", "conn": "connecticut", "mass": "massachusetts", "neb": "nebraska",
        "col": "college", "cal": "california", "so": "southern", "int": "international"}


def keys(name):
    """A school name's match keys: as written (parentheses kept), and without the parenthetical; with St/St. as State
    (Saint at the start), state abbreviations spelled out (Fla. as Florida), one-letter directions spelled out, and a
    trailing U./University dropped."""
    s = plain(name).replace(".", " ").replace("-", " ").replace("'", "")
    s = re.sub(r"\bwest point\b", " ", s)
    out = []
    for v in (re.sub(r"[()]", " ", s), re.sub(r"\(.*?\)", " ", s)):
        toks = v.split()
        if len(toks) > 1 and toks[-1] in ("u", "university"):
            toks = toks[:-1]
        if not toks:
            continue
        out.append("".join(toks))
        t2 = ["saint" if i == 0 and t in ("st", "saint") else "state" if t == "st" else t for i, t in enumerate(toks)]
        t2 = [DIRS.get(t, t) if i == 0 and len(t2) > 1 else t for i, t in enumerate(t2)]
        out.append("".join(t2))
        out.append("".join(ABBR.get(t, t) for t in t2))
    return [re.sub(r"[^a-z0-9]", "", k) for k in dict.fromkeys(out) if k]


class Tables(HTMLParser):
    """Every table's rows as lists of cell text."""
    def __init__(self):
        super().__init__()
        self.tables, self.row, self.cell, self.depth = [], None, None, 0

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.tables.append([])
        elif tag == "tr" and self.tables:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None and self.row is not None:
            self.row.append(re.sub(r"\s+", " ", "".join(self.cell)).strip())
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.row:
                self.tables[-1].append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def col(header, *names):
    h = [re.sub(r"[^a-z0-9]", "", x.lower()) for x in header]
    for n in names:
        if n in h:
            return h.index(n)
    return None


def rows_from_records(header, records):
    """Map one table (header + rows of cells) to NET rows by its column names."""
    ix = {"rank": col(header, "rank", "net", "netrank"), "school": col(header, "school", "team"), "rec": col(header, "record", "wl"),
          "conf": col(header, "conf", "conference"), "road": col(header, "road", "away"), "neutral": col(header, "neutral"), "home": col(header, "home"),
          "prev": col(header, "prev", "previous"), "q1": col(header, "quad1", "q1"), "q2": col(header, "quad2", "q2"), "q3": col(header, "quad3", "q3"),
          "q4": col(header, "quad4", "q4")}
    if ix["rank"] is None or ix["school"] is None:
        return []
    out = []
    for r in records:
        g = lambda k: (r[ix[k]] if ix[k] is not None and ix[k] < len(r) else None)
        try:
            rank = int(re.sub(r"\D", "", g("rank") or ""))
        except ValueError:
            continue
        prev = re.sub(r"\D", "", g("prev") or "")
        out.append({"rank": rank, "school": html.unescape(g("school") or ""), "rec": g("rec"), "conf": g("conf"), "road": g("road"),
                    "neutral": g("neutral"), "home": g("home"), "prev": int(prev) if prev else None, "q": [g("q1"), g("q2"), g("q3"), g("q4")]})
    return out


def parse(body):
    """(rows, through date) from the NCAA page's HTML or the mirror's JSON."""
    through = None
    m = re.search(r"[Tt]hrough [Gg]ames\s+([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),?\s+(\d{4})", body)
    if m:
        for fmt in ("%B %d %Y", "%b %d %Y"):
            try:
                through = dt.datetime.strptime(f"{m.group(1)[:3] if fmt == '%b %d %Y' else m.group(1)} {m.group(2)} {m.group(3)}", fmt).date()
                break
            except ValueError:
                continue
    s = body.lstrip()
    if s.startswith("{") or s.startswith("["):
        j = json.loads(s)
        data = j.get("data") if isinstance(j, dict) else j
        if isinstance(j, dict) and not through:
            m = re.search(r"([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),?\s+(\d{4})", str(j.get("updated") or ""))
            if m:
                try:
                    through = dt.datetime.strptime(f"{m.group(1)[:3]} {m.group(2)} {m.group(3)}", "%b %d %Y").date()
                except ValueError:
                    pass
        if not data:
            return [], through
        header = list(data[0].keys())
        return rows_from_records(header, [[str(d.get(k, "")) for k in header] for d in data]), through
    p = Tables()
    p.feed(body)
    best = []
    for t in p.tables:
        if len(t) < 2:
            continue
        rows = rows_from_records(t[0], t[1:])
        if len(rows) > len(best):
            best = rows
    return best, through


def wl(s):
    m = re.match(r"\s*(\d+)\s*-\s*(\d+)", s or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def main():
    hub = json.loads(HUB.read_text())
    season = int(hub.get("season") or dt.date.today().year)
    try:
        old = json.loads(OUT.read_text())
    except Exception:
        old = {}
    if old.get("season") != season:
        old = {"season": season, "teams": {}}
    now = dt.datetime.now(dt.timezone.utc)
    out = dict(old)
    out["checked"] = now.strftime("%Y-%m-%dT%H:%MZ")

    rows, through, src = [], None, None
    for name, url in (("ncaa.com", PAGE), ("ncaa-api mirror", MIRROR)):
        try:
            body = Path(FILE).read_text() if FILE else fetch(url)
            rows, through = parse(body)
            src = name
            if len(rows) >= 300:
                break
        except Exception as e:
            print(f"{name}: {e}", file=sys.stderr)
        if FILE:
            break
    if len(rows) < 300:
        out["status"] = f"no full NET table ({len(rows)} rows)"
        OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
        print(out["status"])
        return

    # match schools to the hub's teams
    teams = hub.get("teams") or []
    # two tiers: the short and Haslametrics names first, then ESPN's full name (with and without its mascot's last one
    # or two words), so "Houston" finds Houston before Houston Christian
    first, second = {}, {}
    for t in teams:
        words = (t.get("name") or "").split()
        for tier, names in ((first, (t.get("short"), t.get("haslamName"))), (second, (t.get("name"), " ".join(words[:-1]), " ".join(words[:-2])))):
            for n in names:
                for k in keys(n):
                    tier.setdefault(k, set()).add(t["id"])
    by_short = {plain(t["short"]): t["id"] for t in teams}
    got, unmatched = {}, []
    for r in rows:
        tid = None
        ks = keys(r["school"])
        tid = next((by_short[plain(ALIAS[k])] for k in ks if k in ALIAS and plain(ALIAS[k]) in by_short), None)
        for tier in (first, second):
            if not tid:
                tid = next((next(iter(tier[k])) for k in ks if len(tier.get(k, ())) == 1), None)
        if not tid:
            cand = difflib.get_close_matches(ks[0], list(first), n=1, cutoff=0.88)
            if cand and len(first[cand[0]]) == 1:
                tid = next(iter(first[cand[0]]))
        if not tid or tid in got:
            unmatched.append(r["school"])
            continue
        got[tid] = {"rank": r["rank"], "prev": r["prev"], "rec": r["rec"], "conf": r["conf"], "road": r["road"], "neutral": r["neutral"], "home": r["home"], "q": r["q"]}

    # this season's table, not last season's final one still on the page
    start = dt.date(season - 1, 10, 25)
    if through:
        fresh = start <= through <= dt.date(season, 4, 30)
    else:
        agree = n = 0
        for t in teams:
            x, h = got.get(t["id"]), t.get("record") or {}
            if x and wl(x["rec"]) and h.get("wins") is not None:
                n += 1
                a = wl(x["rec"])
                agree += abs(a[0] - (h.get("wins") or 0)) + abs(a[1] - (h.get("losses") or 0)) <= 2
        fresh = n >= 200 and agree / n >= 0.8
    if not fresh:
        out["status"] = f"the table is last season's (through {through or 'an unknown date'}); waiting for this season's first release"
        out["lastCheck"] = {"rows": len(rows), "matched": len(got), "unmatched": unmatched}
        OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
        print(out["status"], f"({len(got)} of {len(rows)} schools matched; missed {unmatched})")
        return
    out.pop("lastCheck", None)
    out.update({"season": season, "through": through.isoformat() if through else None, "pulled": now.strftime("%Y-%m-%dT%H:%MZ"),
                "status": "ok", "source": src, "teams": got, "unmatched": unmatched})
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"NET through {through}: {len(got)} teams matched, {len(unmatched)} unmatched {unmatched[:12]}")


if __name__ == "__main__":
    main()
