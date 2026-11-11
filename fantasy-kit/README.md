# Fantasy Kit

The shared parts of every fantasy league page on davidsolar.dev: player data for basketball, football and baseball, player values, a draft engine, a season engine, and the screens that sit on top of them. The look blends Yahoo and ESPN density for tables with Sleeper polish for matchups, trades and the draft room, in light and dark.

- **Draft Lab** (`index.html`, `lab.js`): mock drafts against bots.
- **Demo leagues** (`league.html`, `demo.js`): full leagues with bots and seasons that move in real time. Each sport has a head to head league and a best ball guillotine league (`?f=g`).
- **Hard Cap** (`../hardcap/`) uses the kit's styles, shell, matchup hero, feeds, trade window and draft room layout with its own rules.

Plain browser scripts, no build step. `sports.js`, `value.js` and `draft.js` have no DOM and no network, so Node tests and a Supabase edge function can load them too.

## Files

| File | What it does |
| --- | --- |
| `sports.js` | `FK.sports`: positions, lineup slots, position limits, stat columns, position colors and scoring presets for `nba`, `nfl` and `mlb` |
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

To add a preset, add an entry. A category is one of three kinds:

- a counting stat: `{ k, label, col }`
- a ratio with volume, like FG%: `{ num, den }`
- a rate with a weight, like ERA weighted by innings: `{ rate, w }`

Add `low: true` to any of them when lower is better.

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
  rotisserie (`format: "roto"`, season totals ranked per category), and best ball guillotine. Roster rules:
  `waivers: "rolling"`, `ir`, `maxAdds` (pickups a week) and `posMax` (most players at a main position).
- **Invites.** The commissioner shares `leagues.html?join=<id>&code=<invite>`. Whoever opens it signs in and picks an
  open team. Teams nobody has claimed are bots, and a bot's team can be taken over later.
- **Live nudges.** Every save and chat post sends a nudge over Supabase Realtime (a database trigger posts to the
  broadcast API on topic `fk:<id>`, `tools/fantasykit_supabase.sql`). Pages listen with `FK.cloud.listen`, read the
  league at once, and slow their polling to a backstop, but only after a ping of their own comes back over the socket.
- **The draft.** The commissioner's page runs bots and the clock. Any other page steps in when a bot's pick is 1.2
  seconds overdue (with live nudges on) or a manager's clock is five seconds overdue.
- **Loading.** `play.html` loads `trivia.js` only for a trivia draft and `league-ui.js` a few seconds after the draft
  room is up (or right away for a league in season), with the same version tag as `live.js`. In a slow draft (an hour or more a pick), managers get an email when they're on the clock.
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

