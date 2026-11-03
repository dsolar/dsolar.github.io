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

test('baseball real weeks: batting and pitching lines in one file', () => {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/mlb.json', import.meta.url), 'utf8'));
  const bat = data.players.find((p) => p.l.bat && p.l.bat[1] > 300), pit = data.players.find((p) => p.l.pit && p.l.pit[1] > 10);
  const WB = ['g', 'pa', 'ab', 'r', 'h', 'hr', 'rbi', 'sb', 'tb', 'avg', 'obp', 'ops', 'bb', 'hbp', 'sf'];
  const WP = ['g', 'gs', 'ip', 'w', 'l', 'sv', 'hld', 'k', 'er', 'bb', 'h', 'era', 'whip', 'qs', 'outs'];
  const weeks = { sport: 'mlb', season: data.season, lines: { bat: WB, pit: WP }, weeks: {
    1: { start: '2026-10-19', end: '2026-10-25', final: true, lines: {
      [bat.id]: { bat: [6, 26, 22, 5, 8, 3, 7, 1, 17, 0.364, 0.423, 1.196, 3, 1, 0] },
      [pit.id]: { pit: [1, 1, 7, 1, 0, 0, 0, 9, 1, 1, 4, 1.29, 0.71, 1, 21] } } } } };
  const s = setup('mlb', 'roto5', weeks);
  const wb = G.playerWeek(s.L, s.ctx, s.ctx.byId[bat.id], 1, 1, 1), wp = G.playerWeek(s.L, s.ctx, s.ctx.byId[pit.id], 1, 1, 1);
  const bc = s.sport.data.lines.bat.cols, pc = s.sport.data.lines.pit.cols;
  assert.equal(wb.bat[bc.indexOf('hr')], 3);
  assert.equal(wb.bat[bc.indexOf('avg')], 0.364);
  assert.equal(wp.pit[pc.indexOf('k')], 9);
  assert.equal(wp.pit[pc.indexOf('era')], 1.29);
  // custom points read "line.col" weights from both lines
  const spec = { type: 'points', weights: { 'bat.hr': 4, 'bat.r': 1, 'pit.k': 1, 'pit.w': 5 } };
  const sp = S.withScoring(S.attach(Object.assign({}, S.mlb), data), spec);
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sp, players, { teams: 4, scoring: 'custom' });
  const L = Object.assign({}, s.L, { scoring: 'custom' });
  const ctx = G.context(L, players, sp, { real: weeks });
  assert.equal(G.playerWeek(L, ctx, ctx.byId[bat.id], 1, 1, 1).pts, 3 * 4 + 5);
  assert.equal(G.playerWeek(L, ctx, ctx.byId[pit.id], 1, 1, 1).pts, 9 + 5);
});

test('real scoring only when the box scores reach the season', () => {
  const nfl = { weeks: { 1: { start: '2026-09-08', end: '2026-09-14' }, 9: { start: '2026-10-27', end: '2026-11-02' } } };
  assert.equal(Z.realCovers(nfl, Date.UTC(2026, 10, 10, 13)), true, 'in season');
  const mlb = { weeks: { 26: { start: '2026-09-21', end: '2026-09-27' } } };
  assert.equal(Z.realCovers(mlb, Date.UTC(2026, 10, 10, 13)), false, 'an offseason league is simulated');
  assert.equal(Z.realCovers(null, Date.now()), false);
});

test('live feed: the current week fills in, and win chances count games left to play', () => {
  const weeks = JSON.parse(JSON.stringify(nbaWeeks));
  const s = setup('nba', 'points', weeks);
  const { L } = s;
  // a live feed for week 1 with a partial week: team "AAA" done, others with games left
  const wk1 = G.realWeek(s.L, s.ctx, 1);
  const lu = G.lineupFor(L, s.ctx, 0, 1).filter(Boolean).map((id) => s.ctx.byId[id]);
  const teams = {};
  for (const p of s.players) teams[p.t] = { played: 2, live: 0, left: 2 };
  const live = { sport: 'nba', season: weeks.season, start: wk1.start, end: wk1.end, players: {}, teams, updated: '2026-10-21T01:00:00Z' };
  for (const p of lu) live.players[p.id] = [2, 2, 60, 15, 30, 5, 6, 3, 38, 10, 6, 2, 1, 3];
  // a final week in the file isn't overwritten
  const k = Object.keys(weeks.weeks).find((x) => weeks.weeks[x].start === wk1.start);
  weeks.weeks[k].final = false;
  assert.ok(Z.mergeLive(weeks, live));
  assert.equal(Z.mergeLive(weeks, live), false, 'the same feed twice changes nothing');
  const ctx = G.context(L, s.players, s.sport, { real: weeks });
  const o = G.outlook(L, ctx, 0, 1);
  assert.ok(o && o.left > 0 && o.rem > 0);
  const m = G.matchups(L, ctx, 1, 0.5).find((g) => g.a === 0 || g.b === 0);
  assert.ok(m.outlook && m.winProb > 0 && m.winProb < 1);
  // everyone done: the score decides it
  for (const t of Object.values(teams)) { t.played = 4; t.left = 0; }
  live.updated = 'x';
  Z.mergeLive(weeks, live);
  const ctx2 = G.context(L, s.players, s.sport, { real: weeks });
  const m2 = G.matchups(L, ctx2, 1, 0.9).find((g) => g.a === 0 || g.b === 0);
  assert.equal(m2.pa, m2.sa);
  assert.ok(m2.winProb === 0 || m2.winProb === 1 || m2.winProb === 0.5);
  // a closed week stays as the file has it
  weeks.weeks[k].final = true;
  assert.equal(Z.mergeLive(weeks, Object.assign({}, live, { updated: 'y' })), false);
});
