#!/usr/bin/env python3
"""Merge every bid from a copied Yahoo Transactions page into guillotine/data.json.

Yahoo's API only reports the winning FAB bid. The League > Transactions page (FAB Offers) shows every
bid on each claim, winners and losers, which the page uses for "next best" bids and each team's
overpay. guillotine/offers.txt holds a copy of that page (the Wednesday scheduled task saves it after
the overnight waiver run). Unlike guillotine/paste.txt, this touches only data.json's "offers", so it
runs alongside the Yahoo pull instead of replacing it. Claims from earlier copies are kept.

  python tools/guillotine_offers.py [offers file] [--data guillotine/data.json]
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from guillotine_paste import clean, parse_offers, merge_offers  # noqa: E402

ROOT = os.path.join(HERE, "..")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("offers", nargs="?", default=os.path.join(ROOT, "guillotine", "offers.txt"))
    ap.add_argument("--data", default=os.path.join(ROOT, "guillotine", "data.json"))
    a = ap.parse_args()
    if not os.path.exists(a.offers) or not os.path.exists(a.data):
        print("No offers file or data.json; nothing to merge.")
        return
    with open(a.data, encoding="utf-8") as f:
        data = json.load(f)
    with open(a.offers, encoding="utf-8") as f:
        new = parse_offers(clean(f.read()).splitlines(), data.get("season"))
    if not new:
        print("::warning::guillotine/offers.txt has no FAB claims Yahoo's Transactions page would show.")
        return
    merged = merge_offers(new, data.get("offers"))
    if merged == data.get("offers"):
        print(f"Bids unchanged ({len(new)} claims in the copy).")
        return
    data["offers"] = merged
    with open(a.data, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    runs = sorted({o.get("run") for o in new if o.get("run")})
    print(f"Merged {len(new)} claims from runs {', '.join(runs)} into {a.data}.")


if __name__ == "__main__":
    main()
