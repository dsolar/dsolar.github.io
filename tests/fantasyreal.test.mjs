import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const V = require('../fantasy-kit/value.js');
const F = require('../fantasy-kit/draft.js');
const G = require('../fantasy-kit/league.js');
const Z = require('../fantasy-kit/season.js');
const DAY = 864e5;

// A league whose week 1 starts Monday Oct 19, 2026 at 13:00 UTC, like a shared league, with a weekly file shaped
// like fantasy-kit/data/weeks-<sport>.json.
function setup(key, scoring, weeks, settings = {}) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S[key]), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 4, lineup, scoring });
  const T0 = Date.UTC(2026, 9, 12, 15);
  const D = F.create({ sport, teams: 4, seed: 5, now: T0, lineup, scoring, botDelay: 0 });
  F.start(D, T0); F.tick(D, F.context(D, players, sport), T0 + 1, 5000);
  const L = G.create({ sport, draft: D, now: T0, start: Date.UTC(2026, 9, 19, 13), scoring, settings: Object.assign({ weeks: 4, playoffTeams: 2, real: true }, settings) });
  return { sport, players, L, ctx: G.context(L, players, sport, { real: weeks }) };
}
const nbaWeeks = JSON.parse(readFileSync(new URL('../fantasy-kit/data/weeks-nba.json', import.meta.url), 'utf8'));

test('real weeks: a category week is the box score, not a simulation', () => {
  const s = setup('nba', 'cats9', nbaWeeks);
  const rw = G.realWeek(s.L, s.ctx, 1);
  assert.equal(rw.start, '2026-10-19');
  const pid = Object.keys(rw.lines).find((id) => s.ctx.byId[id]);
  const line = G.playerWeek(s.L, s.ctx, s.ctx.byId[pid], 1, 1, 1).pg;
  const cols = s.sport.data.lines.pg.cols;
  for (const c of ['pts', 'reb', 'ast', 'fgm', 'fga']) assert.equal(line[cols.indexOf(c)], rw.lines[pid][nbaWeeks.cols.indexOf(c)], c);
  // a player with no games that week scores nothing
  const idle = s.players.find((p) => !rw.lines[p.id]);
  assert.equal(G.playerWeek(s.L, s.ctx, idle, 1, 1, 1).pg[cols.indexOf('pts')], 0);
  // the team's categories add up its starters' real lines
  const tw = G.teamWeek(s.L, s.ctx, 0, 1, 1);
  const ids = G.lineupFor(s.L, s.ctx, 0, 1).filter(Boolean);
  const pts = ids.reduce((a, id) => a + ((rw.lines[id] || [])[nbaWeeks.cols.indexOf('pts')] || 0), 0);
  assert.ok(Math.abs(tw.cats.pts - pts) < 1e-6, `${tw.cats.pts} vs ${pts}`);
});

test('real weeks: points leagues score the real line, and a midweek pickup counts for his share', () => {
  const pid = '4984', weeks = { season: '2026', line: 'tot', source: 'test', updated: '2026-10-27T12:00:00Z', cols: ['g', 'pts_std', 'pts_half_ppr', 'pts_ppr'],
    weeks: { 1: { start: '2026-10-20', end: '2026-10-26', final: true, lines: {} } } };
  const s = setup('nfl', 'half', weeks, {});
  s.L.start = Date.UTC(2026, 9, 20, 13);                      // football weeks start Tuesday
  const p = s.players.find((x) => s.ctx.own[x.id] === 0) || s.players.find((x) => x.id === pid);
  weeks.weeks[1].lines[p.id] = [1, 10, 15, 20];
  const ctx = G.context(s.L, s.players, s.sport, { real: weeks });
  assert.equal(G.playerWeek(s.L, ctx, p, 1, 1, 1).pts, 15, 'half PPR column');
  assert.equal(G.playerWeek(s.L, ctx, p, 1, 0.5, 1).pts, 7.5, 'half the week on the team, half the points');
  const ppr = Object.assign({}, s.L, { scoring: 'ppr' });
  assert.equal(G.playerWeek(ppr, ctx, p, 1, 1, 1).pts, 20);
  // a week the data doesn't have counts as no games, never as made-up points
  assert.equal(G.playerWeek(s.L, ctx, p, 2, 1, 1).pts, 0);
});

test('real weeks: a week waits for its last box scores, with lineups locked, then closes', () => {
  const weeks = JSON.parse(JSON.stringify(nbaWeeks));
  weeks.weeks[1].final = false;
  const s = setup('nba', 'cats9', weeks);
  const end = G.weekStart(s.L, 2);
  assert.equal(G.canFinish(s.L, s.ctx, end - 1), false, 'not before the week is over');
  assert.equal(G.canFinish(s.L, s.ctx, end + 3600e3), false, 'over, but the data is still coming');
  assert.equal(G.setLineup(s.L, s.ctx, 0, 1, G.lineupFor(s.L, s.ctx, 0, 1), end + 3600e3).ok, false, 'lineups lock when the week ends');
  assert.ok(G.setLineup(s.L, s.ctx, 0, 1, G.lineupFor(s.L, s.ctx, 0, 1), end - 3600e3).ok);
  assert.equal(Z.catchUp(s.L, s.ctx, end + 3600e3) && s.L.week, 1, 'catch up keeps the week open');
  weeks.weeks[1].final = true;
  const ctx = G.context(s.L, s.players, s.sport, { real: weeks });
  assert.ok(G.canFinish(s.L, ctx, end + 3600e3));
  Z.catchUp(s.L, ctx, end + 3600e3);
  assert.equal(s.L.week, 2, 'closed once the data was final');
  assert.ok(s.L.results[1].length === 2, 'two games');
  // and a feed that never says final can't hold the season up past three days
  const t = G.weekStart(s.L, 3) + 3 * DAY + 1;
  assert.ok(G.canFinish(s.L, ctx, t));
});

test('simulated leagues are unchanged without real data', () => {
  const s = setup('nba', 'cats9', null, { real: false });
  const p = s.players.find((x) => s.ctx.own[x.id] === 0);
  const line = G.playerWeek(s.L, s.ctx, p, 1, 1).pg;
  assert.ok(line[s.sport.data.lines.pg.cols.indexOf('pts')] > 0);
  assert.equal(G.realWeek(s.L, s.ctx, 1), null);
});
