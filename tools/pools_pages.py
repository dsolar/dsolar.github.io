"""Writes each pool game's own page, /pools/<slug>/index.html, from the pools page (pools/index.html).

Each is the same page with <html data-game="kind"> (pools.js shows that game's front page, and its pools' links live
there: /pools/bowls/?p=CODE) and its own title, description and link preview. Run it after changing
pools/index.html:  python3 tools/pools_pages.py   (tests/pools-pages.test.cjs checks they're in step)."""
import os, re, sys

GAMES = [
    ("bowls", "bowls", "Bowl pick'em", "Pick every bowl and College Football Playoff game, each with a confidence number. Make a pool, send the link, and the site keeps score."),
    ("nflpo", "nfl-bracket", "NFL playoff bracket", "Fill out the 14-team NFL playoff bracket, reseeded the NFL's way. Make a pool, send the link, and the site keeps score."),
    ("nflff", "nfl-playoff-fantasy", "NFL playoff fantasy", "A fantasy lineup every playoff round, and each player only once. Make a pool, send the link, and the site keeps score."),
    ("squares", "squares", "Super Bowl squares", "A 10 by 10 board for the Super Bowl: claim squares, and each quarter's score picks a winner."),
    ("props", "props", "Super Bowl prop sheet", "Twenty questions on the Super Bowl, from the coin toss to the Gatorade. Make a sheet for your party."),
    ("oscars", "oscars", "Oscars ballot", "Pick the winner in every category at the Oscars. Make a pool for your watch party."),
    ("bracket", "march-madness", "March Madness bracket", "All 63 games, the classic way, with points doubling every round. Make a pool, send the link, and the site keeps score."),
    ("survivor", "march-madness-survivor", "March Madness survivor", "One team a day through the tournament. Lose and you're out."),
    ("five", "five-teams", "March Madness 5 teams", "Five teams whose seeds add up to 25, with wins paying double every round."),
    ("mmff", "march-madness-fantasy", "March Madness fantasy", "A five-man lineup every round of the tournament, and each player only once. Make a pool, send the link, and the site keeps score."),
    ("nfl", "nfl-survivor", "NFL survivor", "One NFL team a week to win, each team once. Lose and you're out."),
]

def page(src, kind, slug, name, desc):
    out = src.replace('<html lang="en">', f'<html lang="en" data-game="{kind}">', 1)
    out = re.sub(r"<title>.*?</title>", f"<title>{name} | Pools</title>", out, count=1)
    out = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{desc}">', out, count=1)
    out = re.sub(r'<link rel="canonical" href="[^"]*">', f'<link rel="canonical" href="https://davidsolar.dev/pools/{slug}/">', out, count=1)
    out = re.sub(r'<meta property="og:url" content="[^"]*">', f'<meta property="og:url" content="https://davidsolar.dev/pools/{slug}/">', out, count=1)
    out = re.sub(r'<meta property="og:title" content="[^"]*">', f'<meta property="og:title" content="Join my {name} pool">', out, count=1)
    out = re.sub(r'<meta property="og:description" content="[^"]*">', f'<meta property="og:description" content="{desc}">', out, count=1)
    # the header's "All pools" isn't the page you're on here
    out = out.replace('<a href="/pools/" aria-current="page">All pools</a>', '<a href="/pools/">All pools</a>', 1)
    return out

def main(check=False):
    root = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(root, "pools/index.html"), encoding="utf-8").read()
    stale = []
    for kind, slug, name, desc in GAMES:
        path = os.path.join(root, "pools", slug, "index.html")
        want = page(src, kind, slug, name, desc)
        have = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        if have != want:
            stale.append(path)
            if not check:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                open(path, "w", encoding="utf-8").write(want)
    if check and stale:
        sys.exit("stale: " + ", ".join(stale))
    print(("checked" if check else "wrote"), len(GAMES), "pages", "" if not stale else f"({len(stale)} changed)")

if __name__ == "__main__":
    main("--check" in sys.argv)
