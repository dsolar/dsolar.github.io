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
const json = (u) => JSON.parse(readFileSync(new URL(u, import.meta.url), 'utf8'));

function mlbLeague(rule, opts = {}) {
  const data = json('../fantasy-kit/data/mlb.json');
  const sport = S.attach(Object.assign({}, S.mlb), data);
  const extra = S.prospectPlayers('mlb', json('../fantasy-kit/data/prospects-mlb.json'));
  const players = S.withExtras(data.players.map((p) => ({ ...p })), { extraPlayers: extra });
  const have = new Set(players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  V.evaluate(sport, players, { teams: 8, lineup, scoring: 'roto5' });
  const D = F.create({ sport, teams: 8, seed: opts.seed || 4, now: T0, lineup, scoring: 'roto5', botDelay: 0, prospects: { rounds: 3, rule } });
  D.season = { format: 'h2h', weeks: 8, playoffTeams: 2, keepers: 3 };
  D.extraPlayers = extra;
  F.start(D, T0); F.tick(D, F.context(D, players, sport), T0 + 1, 10000);
  return { sport, players, D, extra };
}

test('prospects: pools for each sport, marked and ranked; a prospect already in the player file keeps his stats', () => {
  const mlb = S.prospectPlayers('mlb', json('../fantasy-kit/data/prospects-mlb.json'));
  assert.ok(mlb.length >= 200 && mlb.every((p) => p.pro && p.prk >= 1 && p.pos.length));
  assert.deepEqual(mlb.slice(0, 3).map((p) => p.prk), [1, 2, 3]);
  assert.ok(mlb.every((p) => !['WSN', 'SFG', 'TBR', 'KCR', 'CHW', 'SDP'].includes(p.t)), 'team codes match the player file');
  for (const k of ['nfl', 'nba']) {
    const xs = S.prospectPlayers(k, json(`../draft/${k}.json`));
    assert.ok(xs.length > 40 && xs.every((p) => p.id.startsWith('bb:') && p.pos.every((ps) => S[k].positions.includes(ps))), k);
  }
  const data = json('../fantasy-kit/data/mlb.json');
  const players = S.withExtras(data.players.map((p) => ({ ...p })), { extraPlayers: mlb });
  const both = players.filter((p) => p.pro && p.bigs);
  assert.ok(players.filter((p) => p.pro && p.l && Object.keys(p.l).length).length > 30, 'some prospects are already in the player file');
  assert.ok(both.length >= 1, 'a few have big-league time');
  assert.ok(both.every((p) => p.l && (p.l.bat || p.l.pit)), 'they keep their stats');
  assert.equal(new Set(players.map((p) => p.id)).size, players.length, 'nobody twice');
  assert.equal(S.isProspect('strict', both[0]), false);
  assert.equal(S.isProspect('loose', both[0]), true);
  assert.equal(S.isProspect('loose', { rk: 1 }), true);
  assert.equal(S.isProspect('strict', { rk: 1 }), false);
});

test('prospects: the last rounds draft prospects only, and they start the season on the taxi squad', () => {
  const { sport, players, D } = mlbLeague('strict');
  assert.equal(D.phase, 'done');
  const ctx = F.context(D, players, sport);
  const late = D.board.filter((pk, k) => F.prospectRound(D, k));
  assert.equal(late.length, 3 * 8);
  assert.ok(late.every((pk) => S.isProspect('strict', ctx.byId[pk.pid])), 'only prospects in the prospect rounds');
  // the main rounds still filled every starting spot
  const st = F.standings(D, ctx);
  assert.ok(st.every((r) => r.starters.filter(Boolean).length === D.lineup.length));
  const L = Z.begin(D, sport, { now: T0 + 2 });
  assert.deepEqual(L.settings.prospects, { rule: 'strict', rounds: 3 });
  assert.ok(G.taxiSlots(L) >= 3);
  for (const t of L.teams) {
    const tx = G.taxiOf(L, t.id);
    assert.equal(tx.length, 3, `team ${t.id} has its three prospects on the taxi squad`);
    assert.deepEqual(new Set(tx), new Set(F.prospectPicks(D, t.id)));
  }
  assert.ok(Array.isArray(L.extraPlayers) && L.extraPlayers.length > 100, 'the pool stays with the league');
});

test('prospects: a taxi prospect who reaches the majors graduates, then is promoted two weeks later', () => {
  const { sport, players, D } = mlbLeague('strict', { seed: 6 });
  const L = Z.begin(D, sport, { now: T0 + 2 });
  const ctx = G.context(L, players, sport);
  const pid = G.taxiOf(L, 0)[0], p = ctx.byId[pid];
  assert.equal(G.graduated(L, ctx, p), false);
  // he debuts: a batting line with plate appearances (the player file's columns)
  const cols = sport.data.lines.bat.cols, line = cols.map(() => 0);
  line[cols.indexOf('pa')] = 40; if (cols.includes('g')) line[cols.indexOf('g')] = 10; if (cols.includes('ab')) line[cols.indexOf('ab')] = 36;
  p.l = Object.assign({}, p.l, { bat: line });
  assert.equal(G.graduated(L, ctx, p), true);
  // under the loose rule 36 at-bats isn't enough yet
  assert.equal(G.graduated(Object.assign({}, L, { settings: Object.assign({}, L.settings, { prospects: { rule: 'loose', rounds: 3 } }) }), ctx, p), false);
  G.prospectUpkeep(L, ctx, T0 + 3);
  assert.equal(L.grad[pid].week, L.week);
  assert.ok(G.taxiOf(L, 0).includes(pid), 'still on the taxi squad for now');
  L.week += 2;
  G.prospectUpkeep(L, ctx, T0 + 4);
  assert.ok(!G.taxiOf(L, 0).includes(pid) && L.rosters[0].includes(pid) && L.promoted[pid], 'promoted');
  assert.ok(!L.grad[pid]);
});

test('prospects: a Big Board prospect who turns pro is swapped to his pro record', () => {
  const data = json('../fantasy-kit/data/nba.json');
  const sport = S.attach(Object.assign({}, S.nba), data);
  const extra = S.prospectPlayers('nba', json('../draft/nba.json'));
  const players = S.withExtras(data.players.map((p) => ({ ...p })), { extraPlayers: extra });
  V.evaluate(sport, players, { teams: 6, scoring: 'points' });
  const D = F.create({ sport, teams: 6, seed: 2, now: T0, scoring: 'points', botDelay: 0, prospects: { rounds: 2, rule: 'strict' } });
  D.season = { format: 'h2h', weeks: 8, playoffTeams: 2, dynasty: { rounds: 2 } };
  F.start(D, T0); F.tick(D, F.context(D, players, sport), T0 + 1, 10000);
  const L = Z.begin(D, sport, { now: T0 + 2 });
  const bb = G.taxiOf(L, 1).find((id) => id.startsWith('bb:'));
  assert.ok(bb, 'a Big Board prospect on the taxi squad');
  const name = players.find((p) => p.id === bb).n;
  // the NBA draft happens: he shows up in the player file under his pro id
  const pro = { id: 'pro-123', n: name, t: 'BOS', pos: ['SF'], rk: 1, l: {}, rank: 400 };
  const ctx = G.context(L, players.concat([pro]), sport);
  G.prospectUpkeep(L, ctx, T0 + 3);
  assert.ok(G.taxiOf(L, 1).includes('pro-123') && !L.rosters[1].includes(bb), 'swapped on the roster and taxi squad');
  assert.ok(L.tx.some((x) => /is a pro now/.test(x.text || '')));
});
