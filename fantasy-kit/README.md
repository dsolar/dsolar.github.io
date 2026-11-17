# Fantasy Kit

The shared parts of every fantasy league page on davidsolar.dev: player data for basketball, football, baseball and hockey, player values, a draft engine, a season engine, and the screens that sit on top of them. The look blends Yahoo and ESPN density for tables with Sleeper polish for matchups, trades and the draft room, in light and dark.

- **Draft Lab** (`index.html`, `lab.js`): mock drafts against bots.
- **Demo leagues** (`league.html`, `demo.js`): full leagues with bots and seasons that move in real time. Each sport has a head to head league and a best ball guillotine league (`?f=g`).
- **Hard Cap** (`../hardcap/`) uses the kit's styles, shell, matchup hero, feeds, trade window and draft room layout with its own rules.

Plain browser scripts, no build step. `sports.js`, `value.js` and `draft.js` have no DOM and no network, so Node tests and a Supabase edge function can load them too.

## Files

| File | What it does |
| --- | --- |
| `sports.js` | `FK.sports`: positions, lineup slots, position limits, stat columns, position colors and scoring presets for `nba`, `nfl` and `mlb`; `pointsOf`, the one place points are scored (see Scoring v2) |
| `rules.js` | `FK.rules`: which league options go together (one raid twist at a time, no raids in dynasty, Kingslayer needs FAAB). The setup form and `league.js` both read it |
| `scoring-ui.js` | `FK.scoringUI`: the scoring editor's extras (position points, position multipliers, game bonuses) and the "Who moves" preview |
| `value.js` | `FK.value.evaluate`: category z-scores or fantasy points, value over replacement by position, auction dollars |
| `draft.js` | `FK.draft`: snake, linear, third-round reversal, mystery packages, white elephant and auction drafts; pick clocks or a time bank, queues, keepers, bots, pause, undo, trades during the draft, results |
| `league.js` | `FK.league`: head to head or guillotine, with or without best ball; rosters, weekly lineups, schedule, scoring (simulated, or a `hooks.score` for real box scores), standings, playoffs, power rankings, free agents, FAAB waivers, trades with review votes, the transaction log |
| `league-ui.js` | `FK.ui.leagueApp`: every league page (Overview, Standings, Scoreboard, Transactions, Roster, Schedule, Trades, Matchup, Players, Waiver claims, Draft results) |
| `ui.js` | `FK.ui`: helpers, avatars, the masthead and tab bars, sortable tables, position chips, the player card, and view-model modules (`scoreboard`, `versus`, `vsTable`, `standingsTable`, `feed`, `tradeCard`, `tradeWindow`), plus the full draft room |
| `season.js` | `FK.season`: a shared league's clock (catch up ended weeks, drive overdue draft picks, start the season after the draft) and the emails each save should send. Runs on a league page and in the `fk-clock` job |
| `cloud.js` | `FK.cloud`: sign-in by emailed link (Supabase Auth over plain fetch) and calls to the league functions |
| `leagues.html`, `leagues.js` | Your leagues: sign in, start a league, join from an invite link |
| `play.html`, `live.js` | One shared league: the live draft room, then the league pages, saved for everyone |
| `kit.css` | Every style the above needs, light and dark |
| `data/*.json` | Player pools, written by `tools/fantasykit_data.py` (the Fantasy Kit data workflow). Don't edit |

## Player data

Every sport uses one shape:

```json
{ "sport": "mlb", "season": "2026", "source": "...",
  "lines": { "bat": { "label": "Batting", "cols": ["g", "pa", "ab", "r", ...] }, "pit": { ... } },
  "players": [{ "id": "660271", "n": "Shohei Ohtani", "t": "LAD", "pos": ["UT", "SP"], "l": { "bat": [...], "pit": [...] } }] }
```

- **Basketball:** per-game lines, this season blended with last season (last season counts like 20 games), from Hard Cap's ESPN pull. Positions and ages come from `celtics/data.json`.
- **Baseball:** season totals from MLB's Stats API files in `tools/mlb/`. Values pace a player who missed time toward a full season, so 285 plate appearances counts like about 470.
- **Football:** season totals and Sleeper's fantasy points, plus Sleeper's season projection when there is one. Until the workflow first reaches Sleeper, the file is seeded from the guillotine league, without kickers or defenses.
- **College basketball (one-day games only):** `data/cbb.json` from the CBB Hub (`tools/cbb_dfs.py`, run by the college basketball workflow): every player with real minutes, guards and forwards as DraftKings lists them, a season per-game line (`pg`, its `eg` set to 0) and a next-game projection (`ppg`) that scales his line by his team's projected points, which value.js blends in like 15 games. `sports.cbb` is `dailyOnly`: it shows in One day (week.html?s=cbb) and the one-day start form, never in season leagues, mock drafts or rankings (`S.SEASON_SPORTS`). The night's slates are the hub's 14 most watchable games (`cbb/data/dfs.json`), served by fk-live `?sport=cbb&slates=1` (`supabase/functions/fk-live/cbb.mjs`); box scores come from fk-live `?sport=cbb&games=`, keyed by ESPN athlete id. `weeks-cbb.json` is an empty weekly file so the league clock treats the game as real. `tools/fantasykit_cbb.sql` adds the sport to the backend.
- **Hockey:** NHL.com skater and goalie reports, with current totals, last season, and separate full-season workload forecasts (`sk`, `goalie`, `psk`, `pgoalie`). Goalies project for their share of their club's games. Positions are NHL primary roster positions. `tools/fantasykit_nhl.mjs` shares its game parser with `fk-live/nhl.mjs`; power-play assists come from scoring summaries, and goalie ratios are rebuilt from shots, saves, goals and minutes. Final games are cached in `tools/nhl_fantasy/games.json`. Weekly and daily files cover the season. The NHL hub's open contract feed supplies attributed year-by-year contracts on player cards; estimated and missing figures are labeled.

Read a stat with `FK.sports.stat(sport, player, line, col)` after `FK.sports.attach(sport, data)`.

## Values

`FK.value.evaluate(sport, players, { teams, lineup, bench, scoring, budget })` sets these on each player:

- `v`: summed category z-scores, or projected season fantasy points
- `zc`: the z-score for each category
- `vor` and `rank`: value over the best player left at his position once every team's starting slots are filled
- `prank`: his rank at his position, like `RB12`
- `$`: his auction dollars

Scoring presets live in `sport.scorings`:

- **Basketball:** `cats9` and `points`
- **Football:** `half`, `ppr` and `std`
- **Baseball:** `roto5` and `yoenis`, the Yoenis league's 8x8
- **Hockey:** `cats10`, `bangers` (hits and blocks added), and `points`, plus custom scoring. Category leagues default to three goalie appearances per week; a team below its configured minimum loses goalie categories. Daily and weekly starters lock at their own game times. A goalie cannot fill a skater UTIL slot.

For an existing shared backend, apply `tools/fantasykit_nhl.sql` once to extend the sport allowlist. `fk-live` (and every function under `supabase/functions/`) deploys itself: a push to main that changes a function's folder runs `.github/workflows/supabase-functions.yml`, which deploys that function from the repo with `--no-verify-jwt`, so commit function changes rather than deploying them by hand (a hand deploy is overwritten by the next push, and a hand deploy of an old copy undoes someone else's work). The Fantasy Kit workflow refreshes hockey player pools and scoring; the NHL hub workflow refreshes fantasy contracts after its own daily build. No paid contract key is needed.

To add a preset, add an entry. A category is one of three kinds:

- a counting stat: `{ k, label, col }`
- a ratio with volume, like FG%: `{ num, den }`
- a rate with a weight, like ERA weighted by innings: `{ rate, w }`

Add `low: true` to any of them when lower is better.

### Scoring v2: extras on any points scoring

A league's `D.scoringSpec` can add three things on top of a preset (`base: "half"`) or custom weights:

```js
{ type: "points", base: "half",
  pos: { TE: { rec: 0.5 }, "*": { pass_td: 2 } },   // extra points per stat, for a position or everyone ("*")
  posMult: { TE: 1.5 },                             // a position's whole score times this, applied last
  bonus: [{ stat: "rush_yd", at: 100, pts: 3 },     // a game that reaches a mark (football only: a basketball or
          { stat: "rush_yd", at: 200, pts: 3 }] }   // baseball week sums many games). Rows stack into tiers
```

`FK.sports.pointsOf(sc, player, at, games)` scores a player: base, plus extras, times the multiplier. Season values,
week projections and real box scores all go through it. Position points and multipliers are linear, so they work in
every sport. `node --test tests/fantasyscoring.test.mjs` covers it, the editor's rows and the rules list.

On Start a league, Scoring details holds the editor: quick adds (TE premium +0.5 a catch or 1.5x, yardage bonuses),
position rules for any stat, a multiplier per position, game bonuses, and "Who moves": the top of the board with your
rules against the same scoring without them.

### Which options go together

`FK.rules.check(form)` returns `{ errors, warnings }`. Options that share a slot (the raid twists: Vampire, Robin
Hood, Conquest) can't be on together; `turnOn(form, id)` switches the others off. `blockedWhy(form, id)` says why an
option can't be on (raids in a dynasty, Kingslayer without FAAB). `cleanSettings(settings)` keeps the first raid twist
when a league is made, for leagues set up before the rules and for import. Add a rule to `RULES`, not to a page.

## Drafts

```js
const D = FK.draft.create({ sport, type: "snake", teams: 12, lineup, bench, clock: 60, keepers: [{ team: 3, pid, round: 2 }] });
const ctx = FK.draft.context(D, players, sport, hooks);
FK.draft.start(D, now);
FK.draft.pick(D, ctx, teamId, pid, now);
FK.draft.tick(D, ctx, now);
```

`tick` lets bots pick, and makes the autopick for a manager whose clock ran out: his queue first, then the best fit.

The draft document `D` is plain JSON. Save it wherever the league lives, such as localStorage or a Supabase row with compare-and-set. Every change takes `now`, so the same calls always give the same draft.

**Auctions:** create the draft with `type: "auction"`, `budget`, `minBid`, `bidClock` and `nomClock`.

- `FK.draft.nominate(D, ctx, team, pid, amount, now)` puts a player up.
- `FK.draft.bid(...)` raises the bid, and `FK.draft.pass(...)` drops a manager out of a lot.
- Bots bid by proxy, so the bot with the highest top price leads at one dollar over the next best price.
- A lot closes three seconds after every manager who could still bid has passed.
- `FK.draft.maxBid` keeps $1 back for every open spot.

**Mystery packages:** create the draft with `type: "mystery"`, a pick curve and a reveal.

```js
const curve = FK.draft.pickCurve(players, teams * rounds);   // pick k is worth the k-th best player's dollars, plus $1
const D = FK.draft.create({ sport, type: "mystery", teams, curve, reveal: "start" });
FK.draft.fairDeal(D, players, sport, hooks, { tries: 5 });   // optional bot test
```

- Every team gets a random set of picks, one per roster spot, like 1, 24 and 42 against 12, 13 and 18.
- The deal starts random, then swaps picks between the richest team and the others until every package is within 1% of the average (`tolerance`). Packages from different seeds don't repeat.
- `fairDeal` deals a few sets, has bots draft each one, and keeps the set where the bots finished closest together. `D.mystery.test` records it.
- `reveal` is `"start"` (sealed until the draft starts), `"own"` (your picks at the start, everyone else's as they come up) or `"now"`. `FK.draft.seen(D, k, team)` says whether a team can see who holds pick `k`.

**Trades during the draft** work in every format but auction. Picks and players a team has drafted can both move.

- `FK.draft.propose(D, ctx, { from, to, give, get, note }, now)` sends an offer. A pick is `FK.draft.pickId(k)`, a player is his id. A bot answers at once. A manager answers with `FK.draft.respond(D, ctx, id, team, yes, now)`.
- Every team starts with one pick per roster spot, so `FK.draft.balance` evens out a 2-for-1: the team getting more adds its latest pick.
- `FK.draft.tradeCheck` keeps rosters legal: room for everyone, every starting slot still fillable, position limits.
- Bots value picks by `FK.draft.pickValue`, the dollars of the player you'd expect to be left there. They take a deal that gets them 3% to 10% more than they send.
- When a manager comes on the clock, a bot that picks later sometimes offers to move up. Offers that can't happen anymore, because a pick was made or a piece moved, expire.
- Set `trades: false` on `create` to turn trades off, or `botOffers: false` to keep trades but stop bot offers. Add `hooks.tradeCheck(D, trade, ctx)` for a league rule.

**White elephant:** create the draft with `type: "elephant"`. It's a snake where your turn can be a steal.

- `FK.draft.steal(D, ctx, team, pid, now)` takes a drafted player instead of a new one. The team you took him from gets a make-up pick right away and can't take him straight back.
- `steals: { perTeam: 3, freeze: 2, lastRounds: 2 }`: steals each team gets, steals before a player is frozen, and the rounds at the end with no steals.
- `FK.draft.canSteal` says why a steal won't go. Bots steal when a drafted player is worth clearly more to them than the best one left, more often as the draft goes on.
- Make-up picks sit between scheduled picks, so round labels count only scheduled ones. A make-up pick shows as `3.M`. Trades are off in this format.
- **The steal tax and golden pick:** `steals: { tax: 0.8, golden: 1.15 }` (the defaults). A stolen player scores `tax` for the thief all season, and the player a robbed team takes with its make-up pick scores `golden`. `FK.draft.tags(D)` lists them (`{ pid: { mult, kind } }`), draft standings count them, and `season.begin` carries them into the league as `L.pmult` and `L.etags` (points scoring only). A trade keeps a tag; a drop clears it. Drafts saved before the tax have no tags. With a tax, bots weigh a steal in points over replacement less the taxed share. Bot tests of 400 drafts a version (12 teams, half PPR): the tax moves steals from the first four rounds to rounds 5-9, cuts quarterback steals from a quarter to almost none, and the most-robbed team finishes about a place higher.
- `FK.setup.elephantFields` draws the settings (steals a team, freeze, tax, golden pick) for Start a league and the mock draft.

**Time bank:** create the draft with `bank: { perRound: 30, floor: 10 }` instead of a pick clock.

- Each team gets one clock for the whole draft, `perRound` seconds for every round. Once it's gone, every pick gets `floor` seconds.
- Bots don't really wait, so each one is charged a pretend think time at its own pace. They can't hoard the bank.
- `FK.draft.bankShare(D)` gives the share of each bank left. A league made from the draft turns it into FAAB: from half the league's budget (an empty bank) to one and a half times it (a full one).

**League rules** plug in through hooks:

- `hooks.check(D, team, player, ctx)` returns `{ ok, why }`. Use it for a salary cap or a keeper rule.
- `hooks.worth(D, team, player, w, ctx)` returns a number, which changes how much bots want a player.

**Results:** `FK.draft.standings(D, ctx)` gives each team's best lineup, its total and a letter grade.

## Screens

```html
<link rel="stylesheet" href="/fantasy-kit/kit.css">
<script src="/fantasy-kit/sports.js"></script>
<script src="/fantasy-kit/value.js"></script>
<script src="/fantasy-kit/draft.js"></script>
<script src="/fantasy-kit/ui.js"></script>
```

- `FK.ui.shell({ brand, tabs, tab, subs, sub, right })` returns the masthead and tab bars as HTML.
- `FK.ui.poolColumns(sport, opts)`, `FK.ui.table(...)`, `FK.ui.filterBar(...)` and `FK.ui.passes(...)` build any player list.
- `FK.ui.playerCard(sport, player, { actions })` builds the player card, for `FK.ui.dialog`.
- `FK.ui.room({ el, sport, players, draft, save, me, commish, drive, hooks })` mounts the whole draft room: players, board, picks, teams, queue, results, the clock and the auction lot. Set `drive: true` when the page itself runs bots and clocks. A league with a server clock sets it to false and calls `refresh()` when a new document arrives.

## Branding

Set four tokens on `:root` after `kit.css`. `.fk-band` is always dark, in both themes.

```css
:root { --band: #13233A; --brand: #F6C445; --brand-ink: #1F1600; --accent: #9A6A00; }
:root[data-theme="dark"] { --accent: #F6C445; }
```

## Tests

`node --test tests/fantasykit.test.mjs` runs these checks:

- A full bot draft in each sport leaves every roster legal.
- Snake, linear and third-round reversal orders come out right.
- Auction dollars add up to the league's budget.
- A manager's clock and queue work.
- Keepers and undo work.
- Pause works.
- Bot auctions finish within budget.
- A manager can't overspend in an auction.
- Passing closes a lot.

## League pages

```js
const L = FK.league.create({ sport, draft: D, settings: { weeks: 14, playoffTeams: 4, tradeReview: "vote" } });
FK.ui.leagueApp({ top, el, sport, players, league: () => L, save: (L) => saveSomewhere(L), me: () => myTeamId, frac: (w) => shareOfWeekPlayed });
```

**Formats:** `settings.format` is `"h2h"` (the default) or `"guillotine"`. `settings.bestBall` works with either.

- **Guillotine:** everyone scores every week and the lowest team is chopped (`chops` a week). The season runs until one team is left. Its defaults: a $1000 season budget, no trades, and waivers that run `waiverAt` hours (60) into each week, so a chopped roster is back in play by the next week.
- `FK.league.block(L, ctx, week, frac)` is the chopping block: every team still alive with its score, projection and odds of being chopped, from a few hundred simulations of the rest of the week. Category leagues rank like roto.
- `FK.league.botBids` has bots bid on a chopped roster: more for better players and more as the season runs down.
- `settings.immune` `{ team: week }` protects a team through a week. The demo uses it so your seat is alive when you arrive.
- **Best ball:** no lineups to set. Each week a team scores the best lineup it could have started, picked from what its players actually did.

The modules take plain view models, so a league with its own engine (Hard Cap) builds the same screens:

- `FK.ui.versus({ a: { team, rec, score, proj }, b, wp, status, cats })` is the matchup hero.
- `FK.ui.scoreboard(games)` is the scoreboard strip.
- `FK.ui.feed(items)` is a transaction or activity feed.
- `FK.ui.tradeCard(sport, vm)` and `FK.ui.tradeWindow(opts)` handle offers. The window takes `roster`, `value`, `check` and `submit` callbacks, so a salary cap rule plugs straight in.

`node --test tests/fantasymodes.test.mjs` tests mystery packages (balance, variety, sealing, the bot test), trades during the draft (bot answers, players moving with their spot, balancing, stale offers, bot offers) the time bank (pace, the floor, the FAAB payout) and white elephant (make-up picks, undo, freezing, the late-round cutoff, bot drafts).

`node --test tests/fantasyguillotine.test.mjs` plays guillotine seasons in each sport and tests the midweek waiver run, chop odds and best ball.

`node --test tests/fantasyleague.test.mjs` plays full seasons in each sport and tests lineups, free agency, waivers, trades and vetoes.

## Shared leagues

`leagues.html` is where people sign in (an emailed link, no password), start a league and join one. A league lives in
Supabase (`tools/fantasykit_supabase.sql`) as one draft document and, after the draft, one league document, with a
version number. Every page runs the same rules and saves with the version it started from (`fk_save`). If someone
else saved first, the save is refused and the page takes the newer copy. The server only decides who's signed in, who
owns which team, the invite code and the save order. It also stamps each team's owner from its seat list.

- **Rules.** The commissioner picks the sport, teams, draft format and clock, scoring, head to head or best ball
  guillotine, the starting lineup (the same builder as Draft Lab, with presets like Superflex and 2 QB), bench
  size, FAAB budget, how long dropped players sit on waivers, playoff teams (none, 2, 4 or 8), the trade deadline
  and whether the league can veto trades. They ride along in the draft as `D.season` and become the league's settings.
- **Scoring and formats.** Custom points (a value for every stat) or custom categories ride along as
  `D.scoringSpec` and become the sport's "custom" scoring (`FK.sports.withScoring`). Formats: head to head (most
  categories wins, or each category counts with `settings.tally: "cats"`), all-play for points (`tally: "allplay"`),
  rotisserie (`format: "roto"`, season totals ranked per category), total points (`format: "total"`, points leagues: no games or playoffs, every week's points add up, most points wins; `L.results[w].total` holds each team's week, and `FK.league.totalLive` the week in progress), and best ball guillotine. Roster rules:
  `waivers: "rolling"`, `ir`, `maxAdds` (pickups a week) and `posMax` (most players at a main position).
- **Advanced categories** (custom category leagues): `FK.sports.EXTRA_CATS` adds TS%, eFG%, A/TO, STL+BLK and PTS+REB+AST
  (basketball); SLG, ISO, wOBA, BB%, K%, XBH, BB, NSB, K/9, BB/9, K/BB, FIP, K-BB%, SV+HLD and IP (baseball); and PTS, PPG,
  SHP, SH%, HIT+BLK and saves (hockey). A category's `col`, `num` and `den` can be a column or a weighted sum of columns
  (`{ col: weight }`), and a ratio can carry `mult` (K/9 is 9) and `add` (FIP's constant), so formulas add up across
  players and weeks exactly like FG%. `FK.sports.stat` reads a sum (null if a column is missing), `lineVal` does the same on
  a raw week's line, `ratioVal` makes a ratio from its parts, and `catCatalog(sport)` leaves out what an attached data
  file can't make yet (`{ all: true }` keeps everything). Baseball's lines carry the parts on the end of their columns:
  `bb, hbp, sf, 2b, 3b, so, ibb, cs` for hitters and `outs, hr, hbp, bf` for pitchers, in the season, projection and real
  week lines alike (tools/fantasykit_data.py, tools/mlb_stats_pull.py, fk-live).
  More columns ride along for the extra categories and custom points: basketball's `oreb, dreb, pf, tpa, pm, dd, td`
  (from Hard Cap's file, tools/hardcap_pull.py, whose weeks are recounted once when its columns grow) and football's
  Sleeper keys `pass_att, pass_cmp, pass_fd, rush_fd, rec_fd, pass_2pt, rush_2pt, rec_2pt, fum, fgm_50p, xpmiss,
  fum_rec, ff, safe, def_st_td, yds_allow`. Football has no category preset: custom category leagues start
  from `nfl.catsTemplate` (season totals so far; a simulated week is one game of them). `POINT_STATS` lists every
  stat a custom points league can put a value on.
  Football's last columns come from nflverse's weekly player stats (`NFLV_COLS`: `epa_pass, epa_rush, epa_rec,
  pass_sacked, sack_yd, air_rec, yac_rec, cpoe_x, tm_tgt, tm_air`), matched to Sleeper ids through Sleeper's `gsis_id`
  and DynastyProcess's crosswalk, and laid over every week and the season line each run. CPOE, target share and air
  yards share are stored as counts (completions over expected, the team's targets and air yards in his games) so they
  add up like any ratio: EPA, EPA/play, EPA/dropback, CPOE, ANY/A, Sack%, target share, aDOT, YAC/rec and RACR. They
  arrive overnight, not live: fk-live's lines stop short of them and `season.mergeLive` keeps the file's values past
  the end of a live line, and a week is only final once nflverse covers every team that played (or two days later).
  `FK.sports.CAT_PRESETS` holds one-click category setups per sport (Analytics, Efficiency, Sabermetrics, Per 36 and
  more), offered in league setup and listed on each sport page.
- **Prospect rounds** (keeper and dynasty leagues): `D.season`/`F.create({ prospects: { rounds, rule } })` adds rounds
  after the main draft that take prospects only (`FK.draft.prospectRound`), and those picks start the season on the
  taxi squad (`settings.prospects`, at least that many taxi spots, keeper leagues included). The pool rides with the
  league as `D.extraPlayers` (`FK.sports.prospectPlayers`: FanGraphs' board for baseball, the Big Board's next class for
  football and basketball), laid in with `FK.sports.withExtras`, pages and the clock job alike. Rules: `"strict"`, never
  in the bigs; `"loose"`, rookie-eligible (130 AB / 50 IP), plus this season's rookies. Each week `prospectUpkeep`
  swaps a Big Board prospect to his pro record once he has one, flags a taxi prospect who graduated (`L.grad`), and
  promotes him two weeks later. The room's player list shows prospects (rank `P12`) during those rounds.
  Next season the page refetches the board (`FK.sports.refreshProspects`: the new board plus last year's prospects
  still on a roster) and `nextDraft` takes it as `o.extraPlayers`; keeper leagues keep their prospect rounds, with each
  team's ungraduated taxi prospects kept in them.
- **Safety nets.** `tests/fantasycombos.test.mjs` plays random mixes of formats, twists, draft types and sports
  (keepers and dynasty into a second season) and checks the league ends whole: every team ranked, a champion, no
  player on two rosters, rosters in size (`FK_COMBOS=2000` for a long run). `tests/fantasysize.test.mjs` keeps a full
  12-team daily baseball season, every lineup saved every day, under 60% of the 1.5 MB save cap (it's about 550 KB).
  The **Draft Lab tests** workflow runs every engine test on each push and writes the last passing commit to
  `fantasy-kit/stable.json`; the league clock (`fk-clock`) loads the engine from GitHub at that commit, falling back to
  the live site, so a broken push can't stop every league's clock. Its response says which engine it ran (`engine`).
- **Deal or No Deal** (`settings.deal = { max }`, any points season but roto): every regular-season week
  `FK.league.runDeals` offers each team a guaranteed score, 86 to 94% of its lineup's projection, new every morning.
  `dealTake` before the week's first game (`dealDue`: `L.kick`, else Thursday night for football, Monday afternoon
  otherwise) and `teamWeek` returns the offer as the team's score (`x.deal = { offer, actual }`); `L.deals[w][t].actual`
  keeps what the lineup really scored. `max` deals a season (0: no limit). Bots take a deal that beats their
  opponent's projection by 4%. The league page shows the offer card, an alert, and a note on the matchup.
  `node --test tests/fantasydeal.test.mjs`.
- **The ladder** (`settings.ladder = { reach }`): no schedule. The first ladder is the draft order upside down. Each
  week a challenge window runs from the end of last week to this week's first game (`L.kick`, else Thursday night for
  football, Monday afternoon otherwise): a team challenges any unbooked team up to `reach` rungs above
  (`FK.league.ladderChallenge`, first come first served, a challenged team can't challenge). At the close
  (`ladderDone`) whoever is left is paired from the bottom up and the week's schedule is written. A challenger who wins
  swaps rungs with the team he beat (`L.ladder.after[w]`, `moves[w]`); the ladder is the standings, so it seeds the
  playoffs or crowns the top rung. No divisions, split, median or pick your opponent. The league page shows the ladder
  card with Challenge buttons and an alert. `node --test tests/fantasyladder.test.mjs`.
- **The split** (`settings.split = { after }`, borrowed from Scotland): once week `after` is played
  (`FK.league.applySplit`), the table splits into a top half (the bigger half when odd) and a bottom half. Records
  carry over, the rest of the regular season is a round robin inside each half (two odd halves: the teams sitting out
  play each other), and `standings` puts the whole top half above the bottom half (`r.half`), so the playoffs come
  from the top half (capped to its size at creation) and last place is the bottom half's last. Head to head only, no
  divisions or pick your opponent, two weeks or more on each side. `node --test tests/fantasysplit.test.mjs`.
- **Promotion and relegation** (`FK.pyramid`, `pyramid.js`): two leagues made together from the start form (redraft
  season leagues; the lower tier can be smaller). Each league's `D.season.pyramid` / `settings.pyramid` is
  `{ id, tier, other, names, mode, k }`. On the regular-season table, the top tier's bottom `k` swap with the lower
  tier's top `k` (`mode: "swap"`), or the same plus a one-week playoff the week after the regular season between the
  top tier's next team up and the lower tier's next team down (`"playoff"`; a tie stays up). Managers move with their
  team name and color and take the relegated team's spot; rosters don't, and both leagues draft fresh. Server:
  `fk_pyramids`, `fk_pyramid_create` (both leagues, the creator seated in the top tier only), `fk_join` (one seat
  per pyramid), `fk_pyramid_new_season` (swaps seats and opens both drafts in one transaction; `fk_new_season`
  refuses a pyramid league). The league page shows the zones in the standings and a card linking the tiers.
  `node --test tests/fantasypyramid.test.mjs` covers it.
- **Salary cap prices** (`FK.draft.capPrices`, set once when the game is made): by this week's projection (one day's
  game for basketball), from 40% of an even share for a fringe player to 1.9x it for the best. The default $50,000 cap
  prices in $100 steps like DraftKings (`capStep`, `capMoney` formats them); a $100 or $200 cap, in whole dollars. A
  player who's out, doubtful, on IR or suspended is priced on his healthy rate (`p.vHealthy`, from `value.js`) and bots
  never start him. Prices are our own, not pulled from DraftKings or FanDuel: neither has a public feed, and theirs fit
  their scoring, not a league's custom one. Sleeper's weekly projections backtested as well calibrated at every
  position (2026 weeks 3 to 10), so a point costs the same anywhere.
- **Daily lineups** (MLB): `fk-live?sport=mlb&lineups=1[&date=]` returns posted batting orders and probable starters.
  `FK.gameday.lineupStatus` turns them into the roster chip (Batting 3rd, Not in lineup, Probable starter), and
  auto-start re-runs as orders post and benches a hitter who isn't in any of his games' lineups (`FK.league.sitting`).
  `node --test tests/fantasylineups.test.mjs` covers it.
  `node --test tests/fantasyprospects.test.mjs` covers it.
- **The lobby** (`lobby.js`): until the draft starts, the draft room opens on a Lobby tab: the draft time with an
  `.ics` file and a Google Calendar link, I'm ready (`D.ready`), a practice mock of this exact draft against bots
  (saved only on that device), the draft order with who has each team and who's ready, the rules in a few lines, and
  for the commissioner a live draw of the order (`FK.draft.drawOrder`, stamps `D.drawn.at`; every page reveals the
  same slot at the same moment, last pick first, and the ticker waits), setting it by hand, the draft time and invites.
  `node --test tests/fantasylobby.test.mjs` covers it.
- **Player pool.** `D.season.poolOnly` / `settings.poolOnly`: `"AL"` or `"NL"` (baseball), `"AFC"` or `"NFC"`, `"East"` or
  `"West"` (`FK.sports.POOL_SETS`). Only that half can be drafted or added (`inPool`). A rostered player traded to the
  other half keeps his spot but scores nothing (`outOfPool`, checked in `playerWeek`) and can't be added back once
  dropped; a player traded in joins the free agents. `node --test tests/fantasypool.test.mjs` covers it.
- **Invites.** The commissioner shares `leagues.html?join=<id>&code=<invite>`. Whoever opens it signs in and picks an
  open team. Teams nobody has claimed are bots, and a bot's team can be taken over later.
- **Live nudges.** Every save and chat post sends a nudge over Supabase Realtime (a database trigger posts to the
  broadcast API on topic `fk:<id>`, `tools/fantasykit_supabase.sql`). Pages listen with `FK.cloud.listen`, read the
  league at once, and slow their polling to a backstop, but only after a ping of their own comes back over the socket.
- **The draft.** The commissioner's page runs bots and the clock. Any other page steps in when a bot's pick is 1.2
  seconds overdue (with live nudges on) or a manager's clock is five seconds overdue.
- **Loading.** `play.html` loads `trivia.js` only for a trivia draft and `league-ui.js` a few seconds after the draft
  room is up (or right away for a league in season), with the same version tag as `live.js`. In a slow draft (an hour or more a pick), managers get an email when they're on the clock.
- **First paint and offline.** Each page's scripts load from a short inline list at the end of `<body>` (bump `?v=`
  there), which runs once the stylesheets are in, so the static first screen in `index.html`, `week.html` and the
  header in `leagues.html` paint before the JavaScript arrives. That markup copies what the page's script draws
  (`startPage()` and `header()` in `lab.js`, `render()` in `week.js`), so keep them in step. `sw.js` (registered by
  `cloud.js`) keeps the pages, their files and the `data/*.json` they've used on the device; see its header.
- **The season** starts the Monday after the draft (Tuesday for football) at 13:00 UTC and runs on the real calendar.
  Basketball and football leagues are scored on real box scores (see Real scoring).
- **Bots on time.** Every save to a live draft wakes `fk-clock ?league=<id>` (the `fk_wake_clock` trigger). If the
  next pick is a bot's, or a manager's clock running out, within nine seconds, it waits, reads the draft again and
  makes it, and that save wakes the next call. A draft of bots runs at its bot pace with no page open.
- **The clock job.** `supabase/functions/fk-clock` runs every five minutes from pg_cron. It plays out ended weeks,
  waivers and trade reviews, and finishes overdue picks, so leagues keep moving with no page open. It loads the
  engine from the live site.
- **Emails.** A save lists the emails it causes, and `fk_save` queues them in `fk_outbox` for managers with alerts
  on. They cover trade offers and answers, waiver results, weekly results, the draft starting and finishing, and
  your turn in a slow draft. `fk-clock` sends them with Resend once `RESEND_API_KEY` and `FK_MAIL_FROM` are set.

## One day (basketball)

The One week page (`week.html?s=nba`) is One day for basketball: tonight's and tomorrow's NBA games as DraftKings-style
slates (the main slate, the early and late games, one game, or games you pick).

- **The schedule.** `fk-live?sport=nba&slates=1` gives each day shaped like a week with a `day`, so `slates.js` reads
  football weeks and basketball days the same way. A day slate carries `{ sport, day }` and no week.
- **Lineups.** `FK.slates.lineup(n, teams, "nba")`: one to three games is a captain at 1.5x and five flex; four or more
  start PG, SG, SF, PF, C, G, F and UTIL. Basketball has a `CPT` slot for it.
- **Values.** `evaluate(..., { oneDay: true })` values one game: a player ruled out is worth nothing, a doubtful one
  about a third. `FK.sports.dayOf(doc)` says whether a draft or league is a one-day game.
- **The league.** `season.begin` starts it when the draft ends, with `settings.span.end` three hours after the last tip
  and the night's games in `settings.slate.list`. `league.weekStart` honors the span.
- **Scoring.** It counts only its own games: `fk-live?sport=nba&games=id1,id2` gives each game's box score and state,
  whatever week it's in, and `season.mergeGames` lays them over the weeks file as `real.games`. The week closes once
  every game is final (or postponed). The league page and the `fk-clock` job both fetch them.

`node --test tests/fantasydays.test.mjs` covers the day slates, the lineups, one-game values, a night scored only on its
own games and closing once they're final, a showdown's captain, a postponed game, and live win chances.

`node --test tests/fantasyseason.test.mjs` covers the season start date, a draft finishing on the clock, the
emails for slow-draft turns, weekly results and chops, and trade offers and answers.

