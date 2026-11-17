# CFB Hub
FBS college football at /cfb/. A buildless hub on the shared hub styles (../mlb/hub.css) like the MLB, NBA, NFL, NHL and CBB hubs.

Sections: This week (hub spread, total and win probability on every game next to the sportsbook line, watchability, where the hub disagrees with the book), Playoff (12-team odds, projected bracket, last in / first out, the committee's current top 25), Ratings (table plus an offense-vs-defense chart), Matchup (spread machine), Conferences, Teams, Players, Heisman, Prospects (NFL Big Board) and How it works.

## Connected sources (all ESPN, free)
- FPI powerindex (group 80): FPI, its efficiencies, Strength of Record, schedule ranks, ESPN's own playoff/conference odds, and the CFP, AP and Coaches ranks.
- Standings (level 3): conference membership, the current order with each league's tiebreakers, and Sun Belt divisions.
- Team schedules (138 requests per run): every game with scores, venue, TV and bowl/championship notes. Postseason schedules are added from late November.
- Scoreboard by conference for this week and next (the scoreboard returns at most 25 games per request, so one per conference): live status and the sportsbook line ESPN shows (DraftKings). A line stays on the game after kickoff.
- Season stats (byathlete, one request per category: passing, rushing, receiving, defense; the feed only fills the category asked for).
- Team rosters once a day (class, height, weight, hometown) into cfb/data/rosters.json, a cache the page does not load.
- The site's NFL Big Board (draft/nfl.json), matched by name and ESPN school id.

## Update
`python3 tools/cfb_build.py` (network), then `python3 tools/cfb_extras.py` (no network; `--sims=N`, default 10,000, about 30 seconds). The GitHub Actions job (.github/workflows/cfb-hub.yml) runs three times a day and every 30 minutes on Saturday afternoons and evenings, and after relevant code changes. A failed source keeps its last good data.

## Model (tools/cfb_extras.py; the line formula is mirrored in cfb/model.js and checked by tests/cfb-model.test.cjs)
- Points model: ridge-regressed offense and defense from every completed score (margins past 24 count at 40%; FCS teams start 22 points below average), stretched to FPI's spread.
- Power = 0.85 × (½ FPI + ½ points model). Home field 2.5 points; margin SD 14.
- Résumé: result minus the chance an average top-25 team wins the same game at the same site.
- Simulation: 3.5-point season drift per team; conference standings by conference record, head-to-head / mini-league, then a weighted draw; title games between the top two (Sun Belt division winners), hosted by the higher seed in the American, Sun Belt, Mountain West and C-USA. Committee score = résumé z + 0.45 × power z + 0.6 × current CFP/AP standing + champion bonus. Field: SEC, Big Ten, Big 12 and ACC champions, the best other champion, Notre Dame if top 12, seven at-large; straight seeding; seeds 5-8 host the first round.
- Heisman ladder: production per game × team factor (win %, power percentile, CFP top 12), leader = 100; daily snapshots for 7-day movement.
- Lines are logged before kickoff and graded once final: straight up, against the book, and average miss.

## Checks
- node --test tests/cfb-model.test.cjs
- NODE_PATH=/path/to/jsdom/node_modules node --test tests/cfb-ui.test.cjs
