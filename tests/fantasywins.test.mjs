// The wins pool: node --test tests/fantasywins.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const W = require('../fantasy-kit/wins-core.js');

const members = [{ id: 'a', name: 'Ann', me: true }, { id: 'b', name: 'Bo' }, { id: 'c', name: 'Cy' }];
const nfl = Object.keys(W.TEAMS.nfl);
const base = Object.fromEntries(nfl.map((t, i) => [t, { w: i % 7, l: 10 - (i % 7) }]));
const board = (picks, o = {}) => ({ ok: true, pool: { id: 'ABC234', name: 'Test', sport: 'nfl', per: o.per || 2, mine: true, done: o.done || null,
  draft: o.lobby ? null : { order: ['b', 'c', 'a'], started: '2026-11-24T20:00:00Z', teams: nfl, base } }, members, picks: picks.map(([user, team], i) => ({ n: i + 1, user, team })) });

test('every league has its teams, and the logos use ESPN\'s spellings', () => {
  assert.equal(Object.keys(W.TEAMS.nba).length, 30);
  assert.equal(Object.keys(W.TEAMS.nfl).length, 32);
  assert.match(W.logo('nba', 'BRK', 20), /teamlogos\/nba\/500\/bkn\.png&w=40&h=40$/);
  assert.match(W.logo('nfl', 'WAS'), /nfl\/500\/wsh\.png/);
  assert.match(W.logo('nfl', 'KC'), /nfl\/500\/kc\.png/);
  assert.equal(W.teamFull('nba', 'BOS'), 'Boston Celtics');
});

test('the site\'s own standings files give every team a record', () => {
  const nba = W.records('nba', JSON.parse(readFileSync(new URL('../celtics/live.json', import.meta.url), 'utf8')));
  assert.equal(Object.keys(nba).length, 30);
  assert.ok(Object.values(nba).every((r) => Number.isInteger(r.w) && Number.isInteger(r.l)));
  assert.ok(Object.values(nba).reduce((a, r) => a + r.w, 0) > 0);
  assert.equal(Object.values(nba).reduce((a, r) => a + r.w, 0), Object.values(nba).reduce((a, r) => a + r.l, 0), 'every win is someone\'s loss');
  const games = JSON.parse(readFileSync(new URL('../nfl/data/games.json', import.meta.url), 'utf8'));
  const rec = W.records('nfl', games);
  assert.equal(Object.keys(rec).length, 32);
  const played = games.games.filter((g) => g[0] === 'REG' && g[5] != null && g[6] != null && g[5] !== g[6]).length;
  assert.equal(Object.values(rec).reduce((a, r) => a + r.w, 0), played);
  assert.equal(W.records('nfl', null), null);
  assert.equal(W.records('nba', {}), null);
});

test('a tie is neither a win nor a loss', () => {
  const rec = W.records('nfl', { games: [['REG', 1, '2026-09-13', 'NE', 'BUF', 20, 20], ['REG', 1, '2026-09-13', 'KC', 'DEN', 27, 13], ['REG', 2, '2026-09-20', 'NE', 'KC', null, null]] });
  assert.deepEqual(rec.NE, { w: 0, l: 0 }); assert.deepEqual(rec.KC, { w: 1, l: 0 }); assert.deepEqual(rec.DEN, { w: 0, l: 1 });
});

test('the draft is a snake over the shuffled order', () => {
  const o = ['b', 'c', 'a'];
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((n) => W.turn(o, n)), ['b', 'c', 'a', 'a', 'c', 'b', 'b']);
  assert.equal(W.onClock(board([], { lobby: true })), null);
  assert.deepEqual(W.onClock(board([])), { n: 1, user: 'b', round: 1, inRound: 1 });
  assert.deepEqual(W.onClock(board([['b', 'KC'], ['c', 'BUF'], ['a', 'PHI']])), { n: 4, user: 'a', round: 2, inRound: 1 });
  assert.equal(W.total(board([])), 6);
  assert.equal(W.onClock(board([['b', 'KC'], ['c', 'BUF'], ['a', 'PHI'], ['a', 'DET'], ['c', 'BAL'], ['b', 'SF']], { done: 'x' })), null);
});

test('how many teams each entry can draft depends on the league and the entries', () => {
  assert.equal(W.maxPer('nfl', 8), 4);
  assert.equal(W.maxPer('nba', 6), 5);
  assert.equal(W.maxPer('nba', 7), 4);
  assert.equal(W.maxPer('nfl', 2), 16);
});

test('only wins after the baseline count, and the table ranks on them', () => {
  const picks = [['b', 'KC'], ['c', 'BUF'], ['a', 'PHI'], ['a', 'DET'], ['c', 'BAL'], ['b', 'SF']];
  const now = JSON.parse(JSON.stringify(base));
  const add = (t, w, l) => { now[t].w += w; now[t].l += l; };
  add('KC', 3, 1); add('SF', 1, 3); add('BUF', 4, 0); add('BAL', 2, 2); add('PHI', 2, 2); add('DET', 2, 1); add('NE', 4, 0);
  const rows = W.table(board(picks, { done: 'x' }), now);
  assert.deepEqual(rows.map((r) => [r.name, r.w, r.l, r.rank]), [['Cy', 6, 2, 1], ['Ann', 4, 3, 2], ['Bo', 4, 4, 3]]);
  assert.deepEqual(rows[0].teams.map((t) => [t.team, t.w, t.l]), [['BUF', 4, 0], ['BAL', 2, 2]]);
  assert.ok(rows[1].me);
  // before any games: everyone level at 0-0 shares first
  assert.deepEqual(W.table(board(picks, { done: 'x' }), base).map((r) => r.rank), [1, 1, 1]);
  // a record that hasn't caught up to the baseline never goes negative
  assert.deepEqual(W.since({ w: 5, l: 5 }, { w: 4, l: 5 }), { w: 0, l: 0 });
  // no standings: the table still lists every entry and its teams
  assert.deepEqual(W.table(board(picks), null).map((r) => r.teams.length), [2, 2, 2]);
});

test('the teams left are the undrafted ones, best record first', () => {
  const av = W.available(board([['b', 'KC'], ['c', 'BUF']]), base);
  assert.equal(av.length, 30);
  assert.ok(!av.some((t) => t.team === 'KC' || t.team === 'BUF'));
  for (let i = 1; i < av.length; i++) assert.ok(av[i - 1].pct >= av[i].pct);
});

test('a pool\'s line on the pools list', () => {
  assert.equal(W.status({ members: 3, per: 4, picks: 0, started: false }).tone, 'wait');
  assert.deepEqual(W.status({ members: 3, per: 4, picks: 5, started: true, done: false, up: true }), { text: "You're up: pick 6", tone: 'todo' });
  assert.match(W.status({ members: 3, per: 4, picks: 5, started: true, done: false, up: false }).text, /pick 6 of 12/);
  assert.equal(W.status({ members: 3, per: 4, picks: 12, started: true, done: true }).tone, 'ok');
});
