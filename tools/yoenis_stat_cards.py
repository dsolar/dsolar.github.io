#!/usr/bin/env python3
"""Add 2026 MLB stats for every player on a 2027 keeper list to yoenis/data.json, for the hover cards.

Reads tools/mlb/2026.json (pulled from MLB's Stats API by the "MLB season stats" workflow) and writes
data["stats2026"] = {"<name as listed>": {"b": [R, H, HR, RBI, SB, TB, AVG, OPS, PA], "p": [W, L, SV, K, HLD, ERA, WHIP, QS, IP]}}
Ohtani is listed twice ("(Batter)" and "(Pitcher)"); each listing gets only its own side. When two MLB players
share a name, the one who played more is used.

  python3 tools/yoenis_stat_cards.py
"""
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "yoenis" / "data.json"
MLB = ROOT / "tools" / "mlb" / "2026.json"


def fold(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\((batter|pitcher|b|p)\)|\[(b|p)\]", " ", s)
    s = re.sub(r"\b(jr|sr|ii|iii)\b", " ", s)
    return re.sub(r"[^a-z0-9]", "", s)


def main():
    d = json.loads(DATA.read_text(encoding="utf-8"))
    m = json.loads(MLB.read_text(encoding="utf-8"))
    bat, pit = {}, {}
    for h in m["hitting"]:
        k = fold(h["name"])
        if k not in bat or h["pa"] > bat[k]["pa"]:
            bat[k] = h
    for p in m["pitching"]:
        k = fold(p["name"])
        if k not in pit or p["ip"] > pit[k]["ip"]:
            pit[k] = p
    out, missing = {}, []
    names = sorted({e["p"] for t in d["keepers2027"].values() for e in t})
    for n in names:
        k, side = fold(n), ("b" if "(Batter)" in n else "p" if "(Pitcher)" in n else None)
        h, p = bat.get(k), pit.get(k)
        # a pitcher's few at-bats (or a position player's mop-up inning) aren't his line
        if h and p and not side:
            if h["pa"] >= 3 * p["ip"]:
                p = None
            else:
                h = None
        rec = {}
        if h and side != "p" and h["pa"] > 0:
            rec["b"] = [h["r"], h["h"], h["hr"], h["rbi"], h["sb"], h["tb"], round(h["avg"], 3), round(h["ops"], 3), h["pa"]]
        if p and side != "b" and p["ip"] > 0:
            rec["p"] = [p["w"], p["l"], p["sv"], p["k"], p["hld"], round(p["era"], 2), round(p["whip"], 2), p["qs"], p["ip"]]
        if rec:
            out[n] = rec
        else:
            missing.append(n)
    d["stats2026"] = out
    txt = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
    assert "@" not in txt
    DATA.write_text(txt, encoding="utf-8")
    print(f"{len(out)} of {len(names)} players have 2026 stats")
    if missing:
        print("no 2026 MLB line:", ", ".join(missing))


if __name__ == "__main__":
    main()
