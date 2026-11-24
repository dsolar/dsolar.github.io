"""Fails (exit 1) when a published file's browser pull is older than allowed, so a missed pull turns the scheduled
GitHub run red and GitHub emails David, instead of the site quietly keeping old numbers.

Usage: python3 tools/stale_check.py <file.json> <max hours>   (reads the file's "pulled" stamp, ISO UTC)
Used by torvik.yml and nba-tracking.yml, whose pulls run through David's Chrome (the sites refuse cloud servers)."""
import json
import sys
from datetime import datetime, timezone


def main():
    path, hours = sys.argv[1], float(sys.argv[2])
    try:
        pulled = json.load(open(path)).get("pulled") or ""
        when = datetime.strptime(pulled[:16], "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc)
    except Exception as e:
        sys.exit(f"{path}: can't read its pull time ({e})")
    age = (datetime.now(timezone.utc) - when).total_seconds() / 3600
    if age > hours:
        sys.exit(f"{path} was last pulled {pulled} ({age:.0f} hours ago, limit {hours:.0f}). The browser pull has missed: "
                 "run it in Chrome (see the script named in the workflow file) or check that the scheduled task can reach Chrome.")
    print(f"{path}: pulled {pulled}, {age:.1f} hours ago (limit {hours:.0f})")


if __name__ == "__main__":
    main()
