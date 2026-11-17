"""Small team files for Draft Lab's college league setup: fantasy-kit/data/teams-<sport>.json, each school's details
(conference and the rest, as the pool file has them) and how many players it has in the pool. The setup page's
conference picker reads these instead of the whole pool file (a megabyte for college hoops)."""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "fantasy-kit", "data")


def build(sport):
    path = os.path.join(DATA, f"{sport}.json")
    try:
        with open(path, encoding="utf-8") as f:
            pool = json.load(f)
    except (OSError, ValueError):
        print(f"No {sport}.json")
        return None
    counts = {}
    for p in pool.get("players", []):
        t = p.get("t")
        if t:
            counts[t] = counts.get(t, 0) + 1
    out = {"sport": sport, "season": pool.get("season"), "updated": pool.get("updated"), "teams": pool.get("teams") or {}, "counts": counts}
    with open(os.path.join(DATA, f"teams-{sport}.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote teams-{sport}.json: {len(out['teams'])} schools, {sum(counts.values())} players")
    return out


if __name__ == "__main__":
    import sys
    for s in sys.argv[1:] or ("cbb", "cfb"):
        build(s)
