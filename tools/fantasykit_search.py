#!/usr/bin/env python3
"""The player search index for Draft Lab's header (fantasy-kit/data/search.json): every player in the six pools as
[sport, id, name, team, positions], read from the pool files the other steps just wrote. Runs last in the Fantasy
Kit data workflow, with no network."""
import json
import pathlib
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "fantasy-kit/data"
SPORTS = ["nba", "nfl", "nhl", "mlb", "cbb", "cfb"]


def main():
    rows = []
    for k in SPORTS:
        try:
            pool = json.loads((DATA / f"{k}.json").read_text())
        except (OSError, ValueError):
            continue
        for p in pool.get("players", []):
            if not p.get("n") or not p.get("id"):
                continue
            rows.append([k, str(p["id"]), p["n"], p.get("t") or "", "/".join(p.get("pos") or [])])
    out = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "cols": ["sport", "id", "name", "team", "pos"], "players": rows}
    (DATA / "search.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Wrote search.json: {len(rows)} players")


if __name__ == "__main__":
    main()
