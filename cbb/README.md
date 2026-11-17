# CBB Hub
Men's Division I at /cbb/. A buildless hub on the shared hub styles (../mlb/hub.css) like the MLB, NBA, NFL and NHL hubs.

Sections: Today (a line, total, win probability and watchability score on every game), Ratings (sortable table plus an offense-vs-defense chart), Matchup (spread machine for any two teams and court), Conferences, Teams, Players, Naismith Watch, Prospects (NBA Big Board college players), Bracket and How it works.

## Connected sources
- Haslametrics: adjusted team offense and defense, tempo, shooting profile, movement/history, selected game performance highlights, future fixtures, and the current 76-team "deserves" bracket.
- ESPN BPI: predictive ratings, offense/defense, Strength of Record, season and conference projections, current records and conference membership.
- ESPN common roster feed: current players, coaches, class and positions.
- ESPN player stats feed (statistics/byathlete, 8 pages of 1,000): every player's season line, merged onto the roster pool each run; TS% and eFG% computed from totals.
- ESPN team schedules (365 requests, refreshed every 6 hours) in cbb/data/schedule.json: every game of the season with venue, conference flag and final scores. The season simulation plays this real remaining schedule.
- ESPN scoreboard: published game snapshots, plus browser live refresh with snapshot fallback.
- Existing NBA Big Board: matching college prospects carry an attributed draft rank and date.

KenPom, Bart Torvik, EvanMiya, ShotQuality, CBB Analytics and Hoop Explorer are linked specialist resources. They are not represented as connected feeds. Do not label a locally computed score with a provider's proprietary metric name. KenPom's public-display terms require separate permission for broad integration.

## Update
Run python3 tools/cbb_build.py, then python3 tools/cbb_extras.py (no network; writes cbb/data/extras.json with the Naismith ladder, the hub's logged pregame lines and its record, and a 10,000-season simulation: conference races, conference tournaments, strength-first selection of the 76-team field, S-curve seeding and the tournament; about 30 seconds; --sims=N to change). Update cbb/data/naismith-watch.json by hand when the Atlanta Tipoff Club publishes a new list. It refreshes ratings and game snapshots; rosters refresh after 20 hours, or with --rosters. The GitHub Actions job runs three times daily and after relevant source changes. It commits only normalized cbb/data. Source failures retain the last good values and original timestamps; invalid, incomplete core data cannot replace the existing pool.

--seed-cache is only a development option for source snapshots created during initial integration. The production branch does not carry those raw source-check files.

## Interpretation
Conference strength is mean Haslametrics adjusted offensive-minus-defensive efficiency among rated members. Each provider retains its own rank. Haslametrics hNET quadrant records are not official NCAA NET quadrants. Missing values and Haslametrics sentinel values stay null.

The March page shows the source's actual seed lines and Opening Round pairs. Regions are not inferred. Its 76 unique teams must resolve to 64 slots, four per seed and twelve paired Opening Round slots, before the importer accepts it.

Player box-score averages are not BPR or RAPM. Any impact feed added later must retain its provider, season, as-of date, and scope. No API key belongs in the browser or a committed JSON snapshot.

The site's favorites use localStorage on the visitor's browser.

## Checks
- python3 -m unittest discover -s tests -p 'cbb_*test.py'
- node --test tests/cbb-model.test.cjs
- NODE_PATH=/path/to/jsdom/node_modules node --test tests/cbb-ui.test.cjs
The workflow installs jsdom only into the runner's temporary directory. The DOM tests check navigation, filtering, favorites, player cards, actual bracket coverage and live-score merging. They do not replace visual browser QA.
