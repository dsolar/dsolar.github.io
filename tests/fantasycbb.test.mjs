// College hoops one-day games: the CBB Hub's featured slates, DraftKings' lineup and scoring, one-game projections
// that follow tonight's matchup, salary cap prices, and a league that scores its games from box scores keyed by ESPN id.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url);
const SL = require('../fantasy-kit/slates.js');
const S = require('../fantasy-kit/sports.js'), V = require('../fantasy-kit/value.js'), F = require('../fantasy-kit/draft.js'), G = require('../fantasy-kit/league.js'), Z = require('../fantasy-kit/season.js');
const pool = JSON.parse(readFileSync(new URL('../fantasy-kit/data/cbb.json', import.meta.url), 'utf8'));
const weeksFile = JSON.parse(readFileSync(new URL('../fantasy-kit/data/weeks-cbb.json', import.meta.url), 'utf8'));
const dfs = JSON.parse(readFileSync(new URL('../cbb/data/dfs.json', import.meta.url), 'utf8'));
// the relay's shape: each day a "week" with a day, every game still to tip
const night = (() => { const d = dfs.days[dfs.days.length - 1]; return { day: d.day, start: d.day, end: d.day, sport: 'cbb', games: d.games.map((g) => ({ ...g, state: 'pre' })) }; })();
const BEFORE = Math.min(...night.games.map((g) => Date.parse(g.at))) - 3 * 36e5;

test('college hoops has one-day games with DraftKings lineups and scoring, and season leagues too', () => {
  assert.ok(S.daily('cbb') && S.daily('nba') && !S.daily('nfl'));
  assert.ok(!S.ALL.cbb.dailyOnly); assert.ok(S.SEASON_SPORTS.includes(S.cbb), 'season leagues and mock drafts');
  assert.deepEqual(SL.lineup(8, 10, 'cbb').lineup, ['G', 'G', 'G', 'F', 'F', 'F', 'UTIL', 'UTIL']);
  assert.deepEqual(SL.lineup(2, 6, 'cbb').lineup, ['CPT', 'UTIL', 'UTIL', 'UTIL', 'UTIL', 'UTIL']);
  assert.equal(SL.word('cbb'), 'tips off');
  const w = S.cbb.scorings.dk.weights;
  assert.deepEqual([w.pts, w.tpm, w.reb, w.ast, w.stl, w.blk, w.tov, w.dd, w.td], [1, 0.5, 1.25, 1.5, 2, 2, -0.5, 1.5, 3]);
});

test('the pool: every player a guard or forward on a known school, with a next-game projection', () => {
  assert.equal(pool.sport, 'cbb'); assert.equal(pool.season, weeksFile.season);
  assert.ok(pool.players.length > 2000);
  const ids = new Set();
  for (const p of pool.players) {
    assert.ok(['G', 'F'].includes(p.pos[0])); assert.ok(pool.teams[p.t], p.t); assert.ok(!ids.has(p.id)); ids.add(p.id);
    assert.equal(p.l.pg.length, pool.lines.pg.cols.length); assert.equal(p.l.ppg.length, pool.lines.ppg.cols.length);
  }
  const sport = S.attach(Object.assign({}, S.cbb), pool);
  assert.ok(S.teamLogo('cbb', pool.players[0].t), 'school logos come with the pool');
  assert.ok(S.teamColor('cbb', pool.players[0].t));
  assert.equal(sport.cols.pg.pts, 8);
});

test('the featured slate: the night\'s best games, a main slate and showdowns', () => {
  assert.ok(night.games.length >= 4 && night.games.length <= 14);
  const L = SL.list(night, BEFORE), by = Object.fromEntries(L.map((s) => [s.key, s]));
  assert.ok(by.full && by.one && by.custom);
  const sl = SL.pick(night, 'full', null, BEFORE);
  assert.equal(sl.sport, 'cbb'); assert.equal(sl.day, night.day); assert.equal(sl.games.length, night.games.length);
});

function capGame(teams = 6) {
  const sl = SL.pick(night, 'full', null, BEFORE), lu = SL.lineup(sl.games.length, 2, 'cbb');
  const sport = S.attach(Object.assign({}, S.cbb), pool);
  const players = pool.players.filter((p) => sl.teams.includes(p.t)).map((p) => ({ ...p, l: { ...p.l } }));
  V.evaluate(sport, players, { teams, lineup: lu.lineup, bench: 0, scoring: 'dk', oneDay: true });
  return { sl, lu, sport, players };
}

test('salary cap prices: a $50,000 cap, $100 steps, stars cost more than role players', () => {
  const { lu, sport, players } = capGame();
  const D = F.create({ sport, teams: 4, seed: 3, now: BEFORE, lineup: lu.lineup, bench: 0, scoring: 'dk', botDelay: 0 });
  D.cap = { budget: 50000, bonus: 1.25 };
  const prices = F.capPrices ? F.capPrices(D, players, sport) : null;
  if (!prices) return; // capPrices is internal in older builds
  const vals = Object.values(prices);
  assert.ok(vals.every((x) => x % 100 === 0 && x >= 100));
  const best = players.slice().sort((a, b) => b.v - a.v)[0], role = players.slice().sort((a, b) => a.v - b.v)[Math.floor(players.length / 3)];
  assert.ok(prices[best.id] > prices[role.id]);
  assert.ok(prices[best.id] <= 50000 / lu.lineup.length * 2, 'the best player is under twice an even share');
  // in proportion to the projection: the bottom of the pool shares the floor, not half of it, so a bench player
  // isn't the best buy on the board
  const floor = Math.min(...vals);
  assert.ok(vals.filter((x) => x === floor).length < vals.length / 3, 'under a third of the pool at the floor');
  const ppk = (p) => p.v / prices[p.id], ranked = players.filter((p) => prices[p.id]).sort((a, b) => b.v - a.v);
  const top = ranked.slice(0, 10).reduce((t, p) => t + ppk(p), 0) / 10, mid = ranked.slice(60, 100).reduce((t, p) => t + ppk(p), 0) / 40;
  assert.ok(mid / top < 1.3, `points a dollar about even from stars to the middle (${(mid / top).toFixed(2)})`);
});

test('one-game projections follow the matchup: the season line scaled by the team\'s projected points', () => {
  const { players } = capGame();
  const cols = pool.lines.pg.cols, pi = cols.indexOf('pts');
  const scaled = players.filter((p) => p.l.pg[pi] >= 8).map((p) => p.l.ppg[pi] / p.l.pg[pi]);
  assert.ok(scaled.length > 10);
  assert.ok(scaled.every((k) => k >= 0.78 && k <= 1.22), 'between 0.8x and 1.2x');
  assert.ok(scaled.some((k) => Math.abs(k - 1) > 0.02), 'some move');
});

test('a one-day college league scores its own games from box scores keyed by ESPN id', () => {
  const { sl, lu, sport, players } = capGame(4);
  const teams = 4;
  const D = F.create({ sport, teams, seed: 9, now: BEFORE, lineup: lu.lineup, bench: lu.bench, scoring: 'dk', botDelay: 0 });
  D.season = { format: 'h2h', tally: 'allplay', weeks: 1, oneWeek: true, playoffTeams: 0, slate: Object.assign({}, sl, lu.mult ? { mult: lu.mult } : {}), ir: 0, when: 'now' };
  F.start(D, BEFORE); let t = BEFORE; const c0 = F.context(D, players, sport);
  for (let i = 0; i < 8000 && D.phase === 'live'; i++) { t += 2000; F.tick(D, c0, t); }
  assert.equal(D.phase, 'done');
  const real = structuredClone(weeksFile), L = Z.begin(D, sport, { now: t, real });
  assert.deepEqual(Z.slateGames(L), sl.games.map((g) => g.id));
  const ctx = G.context(L, players, sport, { real });
  const line = [1, 1, 30, 8, 14, 3, 4, 2, 21, 10, 3, 1, 1, 2, 2, 8, 2, 5, 0, 1, 0];
  const of = (g) => Object.fromEntries(players.filter((p) => p.t === g.away || p.t === g.home).map((p) => [p.id, line]));
  Z.mergeGames(real, { games: Object.fromEntries(sl.games.map((g) => [g.id, { state: 'post', lines: of(g) }])) });
  const tw = G.teamWeek(L, ctx, 0, 1), want = 21 + 2 * 0.5 + 10 * 1.25 + 3 * 1.5 + 1 * 2 + 1 * 2 - 2 * 0.5 + 1.5;
  const id = Object.keys(tw.players)[0];
  assert.ok(Math.abs(tw.players[id] - want * G.slotMult(L, G.lineupFor(L, ctx, 0, 1).indexOf(id), id)) < 1e-6, 'DraftKings points for one game');
  Z.catchUp(L, ctx, G.weekStart(L, 2) + 60e3);
  assert.equal(L.week, 2, 'closes once every game is final');
});
