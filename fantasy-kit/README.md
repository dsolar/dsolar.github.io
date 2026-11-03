# Fantasy Kit

The shared parts of every fantasy league page on davidsolar.dev: player data for basketball, football and baseball, player values, a draft engine, a season engine, and the screens that sit on top of them. The look blends Yahoo and ESPN density for tables with Sleeper polish for matchups, trades and the draft room, in light and dark.

- **Draft Lab** (`index.html`, `lab.js`): mock drafts against bots.
- **Demo league** (`league.html`, `demo.js`): a full league with bots and a season that moves in real time.
- **Hard Cap** (`../hardcap/`) uses the kit's styles, shell, matchup hero, feeds, trade window and draft room layout with its own rules.

Plain browser scripts, no build step. `sports.js`, `value.js` and `draft.js` have no DOM and no network, so Node tests and a Supabase edge function can load them too.

## Files

| File | What it does |
| --- | --- |
| `sports.js` | `FK.sports`: positions, lineup slots, position limits, stat columns, position colors and scoring presets for `nba`, `nfl` and `mlb` |
| `value.js` | `FK.value.evaluate`: category z-scores or fantasy points, value over replacement by position, auction dollars |
| `draft.js` | `FK.draft`: snake, linear, third-round reversal and auction drafts; clocks, queues, keepers, bots, pause, undo, results |
| `league.js` | `FK.league`: rosters, weekly lineups, schedule, scoring (simulated, or a `hooks.score` for real box scores), standings, playoffs, power rankings, free agents, FAAB waivers, trades with review votes, the transaction log |
| `league-ui.js` | `FK.ui.leagueApp`: every league page (Overview, Standings, Scoreboard, Transactions, Roster, Schedule, Trades, Matchup, Players, Waiver claims, Draft results) |
| `ui.js` | `FK.ui`: helpers, avatars, the masthead and tab bars, sortable tables, position chips, the player card, and view-model modules (`scoreboard`, `versus`, `vsTable`, `standingsTable`, `feed`, `tradeCard`, `tradeWindow`), plus the full draft room |
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

The modules take plain view models, so a league with its own engine (Hard Cap) builds the same screens:

- `FK.ui.versus({ a: { team, rec, score, proj }, b, wp, status, cats })` is the matchup hero.
- `FK.ui.scoreboard(games)` is the scoreboard strip.
- `FK.ui.feed(items)` is a transaction or activity feed.
- `FK.ui.tradeCard(sport, vm)` and `FK.ui.tradeWindow(opts)` handle offers. The window takes `roster`, `value`, `check` and `submit` callbacks, so a salary cap rule plugs straight in.

`node --test tests/fantasyleague.test.mjs` plays full seasons in each sport and tests lineups, free agency, waivers, trades and vetoes.
