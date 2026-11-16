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
const T0 = Date.UTC(2026, 9, 1, 20, 0, 0);

test('player pool: each sport splits into two halves that cover every team once', () => {
  for (const k of ['mlb', 'nfl', 'nba']) {
    const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${k}.json`, import.meta.url), 'utf8'));
    const teams = new Set(data.players.map((p) => p.t).filter((t) => t && t !== 'FA'));
    const [a, b] = Object.values(S.POOL_SETS[k]);
    assert.equal(a.length + b.length, teams.size, `${k}: ${a.length} + ${b.length} vs ${teams.size}`);
    for (const t of teams) assert.ok(a.includes(t) !== b.includes(t), `${k} ${t} in exactly one half`);
  }
});

test('player pool: a draft only sees its half; a league keeps a player traded out but stops scoring him', () => {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/mlb.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.mlb), data);
  const doc = { sport: 'mlb', season: { poolOnly: 'AL' } };
  const players = data.players.filter((p) => S.inPool(doc, p)).map((p) => ({ ...p }));
  assert.ok(players.length > 400 && players.every((p) => S.POOL_SETS.mlb.AL.includes(p.t)));
  const have = new Set(players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  V.evaluate(sport, players, { teams: 8, lineup, scoring: 'roto5' });
  const D = F.create({ sport, teams: 8, seed: 5, now: T0, lineup, scoring: 'roto5', botDelay: 0 });
  D.season = { format: 'h2h', weeks: 6, playoffTeams: 2, poolOnly: 'AL' };
  F.start(D, T0); F.tick(D, F.context(D, players, sport), T0 + 1, 5000);
  assert.equal(D.phase, 'done');
  const L = Z.begin(D, sport, { now: T0 + 2 });
  assert.equal(L.settings.poolOnly, 'AL');
  // an NL player can't be added
  const nl = data.players.find((p) => p.t === 'NYM');
  const all = players.concat([{ ...nl }]);
  V.evaluate(sport, all, { teams: 8, lineup, scoring: 'roto5' });
  const ctx = G.context(L, all, sport);
  assert.equal(S.inPool(L, nl), false);
  const r = G.addDrop(L, ctx, 0, nl.id, L.rosters[0][L.rosters[0].length - 1], T0 + 864e5 * 9);
  assert.equal(r.ok, false); assert.match(r.why, /outside this AL-only league/);
  // a rostered hitter traded to an NL team: still on the roster and in the pool, but he scores nothing
  const pid = L.rosters[0].find((id) => ctx.byId[id].pos.includes('OF') || ctx.byId[id].pos.includes('1B'));
  const p = ctx.byId[pid];
  const before = G.playerWeek(L, ctx, p, 1);
  p.t = 'LAD';
  assert.ok(S.inPool(L, p), 'still rostered, so still loaded');
  assert.ok(S.outOfPool(L, p));
  const after = G.playerWeek(L, ctx, p, 1);
  assert.ok(Object.keys(before).length > 0);
  assert.deepEqual(after, {});
  // and a points league scores him zero
  assert.deepEqual(G.playerWeek(Object.assign({}, L, { scoring: 'custom' }), Object.assign({}, ctx, { sport: S.withScoring(sport, { type: 'points', weights: { 'bat.hr': 4 } }) }), p, 1), { pts: 0, out: true });
});

test('player pool: a league with no pool rule is unchanged, and a bad rule is ignored', () => {
  assert.equal(S.inPool({ sport: 'nfl', settings: {} }, { t: 'KC' }), true);
  const D = { sport: 'nfl', teams: [{}, {}], season: { poolOnly: 'AL' } };
  assert.equal(S.poolTeams('nfl', 'AL'), null);
  assert.equal(S.inPool(D, { t: 'KC' }), true);
});
