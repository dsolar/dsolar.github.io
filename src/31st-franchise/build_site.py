"""Builds the playable game page for the website.

    page.html (layout, styles, UI code)
  + data.js   (every player: contract, ratings, stats)
  + engine.js (draft rules, side deals, season sim, free agency)
  = 31st-franchise/index.html at the top of the site

Run it from the site folder in PowerShell:
    py src\\31st-franchise\\build_site.py

Add --data to rebuild data.js from the raw .txt files first
(needs numpy once: py -m pip install numpy):
    py src\\31st-franchise\\build_site.py --data
"""
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
SITE = HERE.parent.parent
OUT = SITE / "31st-franchise" / "index.html"

if "--data" in sys.argv:
    # -X utf8 keeps accented names (Doncic, Jokic and friends) intact on Windows
    for script in ("build.py", "export.py"):
        subprocess.run([sys.executable, "-X", "utf8", script], cwd=HERE, check=True)

read = lambda name: (HERE / name).read_text(encoding="utf-8")
page, data, engine = read("page.html"), read("data.js"), read("engine.js")

# page.html starts with its <title>, font links and <style>; those go in <head>, the rest in <body>
head, body = page.split("</style>", 1)
body = body.replace("/*__DATA__*/", data).replace("/*__ENGINE__*/", engine)

html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Build an expansion team from what the 30 NBA teams leave unprotected, with real 2027-28 contracts and expansion rules, then play the season.">
<link rel="canonical" href="https://davidsolar.dev/31st-franchise/">
<meta property="og:type" content="website">
<meta property="og:url" content="https://davidsolar.dev/31st-franchise/">
<meta property="og:title" content="The 31st Franchise">
<meta property="og:description" content="An NBA expansion draft game. Can your expansion team beat the 1966-67 Bulls?">
<meta property="og:image" content="https://davidsolar.dev/assets/covers/31st-franchise.jpg">
<meta property="og:image:width" content="1040">
<meta property="og:image:height" content="780">
<meta name="twitter:card" content="summary_large_image">
{head}</style>
</head>
<body>
{body}
</body>
</html>
"""

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8")
print(f"Built {OUT.relative_to(SITE)} ({len(html) // 1024} KB)")
