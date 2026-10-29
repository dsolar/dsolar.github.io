#!/usr/bin/env python3
"""Try Yahoo API calls and save what each returns (tag names and a few sample values) to tools/yahoo_probe.json.

For working out undocumented calls before building on them. Run by the "Yahoo probe" workflow.
Edit PROBES to try different calls. Saves structure only: tag paths, counts and short sample values.
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guillotine_update import Yahoo, access_token  # noqa: E402

NFL = "470.l.157731"
MLB = "469.l.30639"
PROBES = {
    "2023 transactions": "league/422.l.4580/transactions",
    "2023 transactions add": "league/422.l.4580/transactions;types=add",
    "2023 transactions add,drop": "league/422.l.4580/transactions;types=add,drop",
    "2023 transactions count 100": "league/422.l.4580/transactions;count=100",
    "2023 transactions start 100": "league/422.l.4580/transactions;start=100;count=100",
    "2026 transactions add,drop": "league/469.l.30639/transactions;types=add,drop",
}


def walk(el, path, out, depth=0):
    p = f"{path}/{el.tag}"
    rec = out.setdefault(p, {"n": 0, "sample": []})
    rec["n"] += 1
    t = (el.text or "").strip()
    if t and len(rec["sample"]) < 3:
        rec["sample"].append(t[:40])
    for c in el:
        walk(c, p, out, depth + 1)


def main():
    y = Yahoo(token=access_token())
    res = {"checked": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    for name, path in PROBES.items():
        y.last_error = None
        root = y.get(path, soft=True)
        if root is None:
            res[name] = {"path": path, "ok": False, "error": (y.last_error or "")[:200]}
            continue
        tags = {}
        walk(root, "", tags)
        # Drop personal fields
        tags = {k: v for k, v in tags.items() if not any(x in k for x in ("email", "guid", "image_url", "nickname", "manager"))}
        res[name] = {"path": path, "ok": True, "tags": tags}
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "yahoo_probe.json")
    json.dump(res, open(out, "w"), indent=1)
    print("Wrote", out)


if __name__ == "__main__":
    main()
