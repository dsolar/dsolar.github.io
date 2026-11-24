#!/usr/bin/env python3
"""Turn RealGM's detailed future-picks tables (tools/nba_picks_raw.json, from tools/nba_picks.py) into the NBA pick
ledger in tools/draft_future.json.

Every traded pick is listed under its original team's "Outgoing" column, as a header line ("2028 second round draft
pick to New York") and a sentence with the terms. Each pick becomes one ledger row:
  [original team, year, round, goes to, kind, note]
  kind: ''        goes to that team outright
        'a-b'     goes to that team unless it lands in a-b (overall selections), then stays with the original team
        'swap'    the original team keeps it, but the team named can swap its own pick for it
        'fav'     part of a more/less favorable group: goes to the first team if it is the best pick of the group,
                  otherwise to the second
        'cond'    terms too tangled to model (multi-year rollovers, nested favorable rules); the note has RealGM's text
        'forfeit' taken away by the league
Run as: python3 tools/nba_picks.py --build
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "tools", "nba_picks_raw.json")
OUT = os.path.join(ROOT, "tools", "draft_future.json")
OVR = os.path.join(ROOT, "tools", "nba_picks_overrides.json")

CITY = {"Atlanta": "ATL", "Boston": "BOS", "Brooklyn": "BKN", "Charlotte": "CHA", "Chicago": "CHI", "Cleveland": "CLE",
        "Dallas": "DAL", "Denver": "DEN", "Detroit": "DET", "Golden State": "GSW", "Houston": "HOU", "Indiana": "IND",
        "L.A. Clippers": "LAC", "L.A. Lakers": "LAL", "Memphis": "MEM", "Miami": "MIA", "Milwaukee": "MIL",
        "Minnesota": "MIN", "New Orleans": "NOP", "New York": "NYK", "Oklahoma City": "OKC", "Orlando": "ORL",
        "Philadelphia": "PHI", "Phoenix": "PHX", "Portland": "POR", "Sacramento": "SAC", "San Antonio": "SAS",
        "Toronto": "TOR", "Utah": "UTA", "Washington": "WAS"}
TEAM = "(" + "|".join(re.escape(c) for c in sorted(CITY, key=len, reverse=True)) + ")"
PICK = re.compile(r"(?:" + TEAM + r"(?:'s|')|\b(its)) (\d{4}) (1st|2nd) round pick")
HEAD = re.compile(r"^(\d{4}) (first|second) round draft pick (to|from) ")
FIRST_YEAR = 2028          # 2027 comes from the current draft order and the Big Board's 2027 rules


CITY_NAME = {v: k for k, v in CITY.items()}


def code_of(full):
    full = full.replace("Los Angeles ", "L.A. ")
    for c, k in sorted(CITY.items(), key=lambda x: -len(x[0])):
        if full.startswith(c):
            return k
    raise KeyError(full)


def items(col):
    """Split a table cell into (header, terms) pairs."""
    out, cur = [], None
    for line in [l.strip() for l in col.split("\n") if l.strip()]:
        if HEAD.match(line):
            cur = [line, ""]; out.append(cur)
        elif cur is not None:
            cur[1] = (cur[1] + " " + line).strip()
    return out


def clause(s):
    """The terms without the trade history: drop '(via ...)' and '[Team-Team, date]'."""
    s = re.sub(r"\s*\[[^\]]*\]\s*$", "", s)
    s = re.sub(r"\s*\(via [^)]*\)", "", s)
    return s.strip()


def picks_in(s, subject=None):
    res = []
    for m in PICK.finditer(s):
        t = CITY[m.group(1)] if m.group(1) else subject
        res.append((t, int(m.group(3)), 1 if m.group(4) == "1st" else 2))
    return res


def prot_kind(s, r):
    m = re.search(r"protected for selections? (\d+)(?:-(\d+))?", s)
    if not m:
        return None
    lo, hi = int(m.group(1)), int(m.group(2) or m.group(1))
    return "%d-%d" % (lo, hi)


def back_of(s, orig):
    """Who keeps a protected pick: the team whose obligation is extinguished, else the last holder before the receiver."""
    m = re.search(TEAM + r"'s obligation to " + TEAM + r" will be extinguished", s)
    if m:
        return CITY[m.group(1)]
    m = re.search(r"\(via " + TEAM + r" unprotected to " + TEAM + r"[;)]", s)
    if m:
        return CITY[m.group(2)]
    return orig


def refs(terms, owner):
    """The picks an outgoing item is about: the subject of a simple line, the pick being swapped, or a favorable group."""
    s = clause(terms)
    m = re.match(TEAM + r"(?:'s|') (\d{4}) (1st|2nd) round pick to ", s)
    if m:
        return [(CITY[m.group(1)], int(m.group(2)), 1 if m.group(3) == "1st" else 2)]
    m = re.match(TEAM + r" has the right to swap its \d{4} (?:1st|2nd) round pick for (?:the )?" + TEAM + r"(?:'s|') (\d{4}) (1st|2nd)", s)
    if m:
        return [(CITY[m.group(2)], int(m.group(3)), 1 if m.group(4) == "1st" else 2)]
    m = re.match(r"(?:The )?" + TEAM + r" will receive the .+? favorable of (.+?)(?: and (?:the )?" + TEAM + r" will receive|;|$)", s)
    if m:
        return picks_in(m.group(2), CITY[m.group(1)])
    return []


def parse(orig, year, rnd, terms):
    """One pick's ledger row from its terms sentence."""
    s = clause(terms)

    if re.match(r"Forfeited by " + TEAM, s):
        return [orig, year, rnd, "OUT", "forfeit", ""]

    # X's pick to U [protected for selections a-b] [; fallback terms]
    m = re.match(TEAM + r"(?:'s|') (\d{4}) (1st|2nd) round pick to " + TEAM + r"(.*)$", s)
    if m and CITY[m.group(1)] == orig:
        to, rest = CITY[m.group(4)], m.group(5)
        head = rest.split(";")[0].strip()
        if not head:
            return [orig, year, rnd, to, "", ""]
        pk = prot_kind(head, rnd)
        if pk and head.startswith("protected"):
            fallback = ""
            if "instead" in rest:
                tail = rest.split(";", 1)[1] if ";" in rest else rest
                tail = re.split(r"; \w+ may convey", tail)[0]
                fallback = re.sub(r"^.*?then ", "", tail, count=1).strip().rstrip(".")
                fallback = fallback[:1].upper() + fallback[1:]
            row = [orig, year, rnd, to, pk, ("If protected: " + fallback) if fallback else ""]
            b = back_of(terms, orig)
            if b != orig:
                row.append(b)
            return row
        return [orig, year, rnd, to, "cond", s]

    # U has the right to swap its pick for X's pick
    m = re.match(TEAM + r" has the right to swap its (\d{4}) (1st|2nd) round pick for (?:the )?" + TEAM + r"(?:'s|') (\d{4}) (1st|2nd) round pick(.*)$", s)
    if m and CITY[m.group(4)] == orig:
        pk = prot_kind(m.group(7).split(";")[0], rnd)
        note = ""
        if pk:
            lo, hi = pk.split("-")
            note = "No swap if " + (CITY_NAME[orig] + "'s pick is No. " + lo if lo == hi else "it lands " + pk)
        return [orig, year, rnd, CITY[m.group(1)], "swap", note]

    # U will receive the more/most favorable of [list] and V will receive the less/least favorable ...
    m = re.match(r"(?:The )?" + TEAM + r" will receive the (.+?) favorable of (.+?)(?: and (?:the )?| ?; ?)" + TEAM + r" will receive the (.+?) favorable", s)
    if m:
        u, ud, v, vd = CITY[m.group(1)], m.group(2), CITY[m.group(4)], m.group(5)
        group = picks_in(m.group(3), u)
        if (orig, year, rnd) in group:
            if ud.startswith("most and least"):
                return [orig, year, rnd, u + "/" + v, "cond", s]
            best, other = (u, v) if re.match(r"(most|more|two most)\b", ud) else (v, u)
            tangled = "(i)" in s or "protected" in s or "barred" in s or ud.startswith("two") or vd.startswith("second")
            return [orig, year, rnd, best + "/" + other, "fav", s if tangled else ""]

    m = re.search(TEAM + r" (?:then )?has the right to swap [^;]*?for (?:the )?" + re.escape(CITY_NAME[orig]) + r"(?:'s|') " + str(year), s)
    if m:
        return [orig, year, rnd, CITY[m.group(1)], "swap", s]
    m = re.match(TEAM + r" has the right to swap", s)
    if m:
        return [orig, year, rnd, CITY[m.group(1)], "swap", s]
    tos = [CITY[t] for t in re.findall(r"\bto " + TEAM, s)]
    tos = [t for t in tos if t != orig]
    return [orig, year, rnd, tos[0] if tos else "?", "cond", s]


UPSTREAM = re.compile(r"\bmay (?:then )?convey (?:this|the) (?:pick|1st round pick|2nd round pick)|may convey the pick it receives")


def build(raw, texts=None):
    cands = {}
    for full, table in raw["teams"].items():
        owner = code_of(full)
        for row in table:
            if len(row) < 3:
                continue
            for head, terms in items(row[2]):
                hm = HEAD.match(head)
                year, rnd = int(hm.group(1)), 1 if hm.group(2) == "first" else 2
                if year < FIRST_YEAR:
                    continue
                if terms.startswith("Forfeited"):
                    cands.setdefault((owner, year, rnd), []).append(terms); continue
                # an Outgoing item is about the team's own pick, plus any group it names
                rs = list(dict.fromkeys([p for p in refs(terms, owner) if p[1] == year and p[2] == rnd] + [(owner, year, rnd)]))
                for p in rs:
                    if terms not in cands.setdefault(p, []):
                        cands[p].append(terms)
    rows = []
    for (orig, year, rnd), ts in sorted(cands.items()):
        # a pick that passed through a chain is listed once per hop; the upstream hops say "... may convey this pick to"
        down = [t for t in ts if not UPSTREAM.search(clause(t))] or ts
        if texts is not None:
            texts[(orig, year, rnd)] = " | ".join(clause(t) for t in down)
        parsed = [parse(orig, year, rnd, t) for t in down]
        parsed.sort(key=lambda r: (r[4] == "cond", r[3] == "?"))
        if len({(r[3], r[4]) for r in parsed}) > 1:
            # one pick split between teams by where it lands (RealGM: "overlaps with another outgoing pick")
            r = [orig, year, rnd, "/".join(dict.fromkeys(t for x in parsed for t in x[3].split("/") if t not in ("?", orig))) or "?", "cond", " | ".join(clause(t) for t in down)]
            parsed = [r]
        rows.append(parsed[0])
    return rows


def main():
    raw = json.load(open(RAW))
    fut = json.load(open(OUT))
    texts = {}
    rows = build(raw, texts)
    # hand-modeled picks replace the parsed ones; flag any whose RealGM text has changed since
    ovr = json.load(open(OVR)) if os.path.exists(OVR) else {"rows": []}
    dirty = False
    for o in ovr["rows"]:
        key = tuple(o["row"][:3])
        now = texts.get(key)
        if o.get("seen") == "auto":
            o["seen"] = now; dirty = True
        elif o.get("seen") != now:
            print("WARNING: RealGM changed its terms for %s %d round %d; check tools/nba_picks_overrides.json:\n  %s" % (key[0], key[1], key[2], now))
        rows = [r for r in rows if tuple(r[:3]) != key] + [o["row"]]
    if dirty:
        json.dump(ovr, open(OVR, "w"), indent=1, ensure_ascii=False)
    rows.sort(key=lambda r: (r[0], r[1], r[2]))
    years = sorted({r[1] for r in rows} | set(range(FIRST_YEAR, FIRST_YEAR + 6)))
    old = fut.get("nba", {})
    fut["nba"] = {"years": years, "owed": rows, "pulled": raw.get("pulled")}
    note = ("NBA rebuilt by tools/nba_picks_parse.py from RealGM's detailed future draft list "
            "(https://basketball.realgm.com/nba/draft/future_drafts/detailed), pulled " + str(raw.get("pulled")) + ".")
    fut["_about"] = re.sub(r" NBA rebuilt by tools/nba_picks_parse\.py.*?pulled [^.]*\.\d*\.?", "", fut.get("_about", "")).rstrip() + " " + note
    json.dump(fut, open(OUT, "w"), indent=0, ensure_ascii=False)
    # the NBA Hub and Big Board read the ledger from the board file; draft_build.py copies it the same way on its runs
    bpath = os.path.join(ROOT, "draft", "nba.json")
    if os.path.exists(bpath):
        board = json.load(open(bpath))
        board["future"] = fut["nba"]
        json.dump(board, open(bpath, "w"), ensure_ascii=False, separators=(",", ":"))
    kinds = {}
    for r in rows:
        kinds[r[4] or "outright"] = kinds.get(r[4] or "outright", 0) + 1
    print("%d NBA picks owed (%s); was %d" % (len(rows), ", ".join("%s %d" % kv for kv in sorted(kinds.items())), len(old.get("owed", []))))


if __name__ == "__main__":
    main()
