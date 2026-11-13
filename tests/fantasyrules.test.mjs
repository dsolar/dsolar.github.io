// League settings any commissioner can turn on: trade size, a counter window with rival bids, reseeded playoffs, a
// weekly innings minimum, a draft lottery, and baseball position eligibility thresholds.
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
const HOUR = 36e5;

function league(season = {}, teams = 8) {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams, scoring: 'half' });
  const T0 = Date.UTC(2026, 9, 1);
  const D = F.create({ sport, teams, seed: 4, now: T0, scoring: 'half', botDelay: 0 });
  D.season = Object.assign({ format: 'h2h', weeks: 6, playoffTeams: 4 }, season);
  F.start(D, T0);
  let t = T0; const c = F.context(D, players, sport);
  for (let i = 0; i < 9000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, c, t); }
  const L = Z.begin(D, sport, { now: t });
  return { L, ctx: G.context(L, players, sport), t };
}

test('trade size: no more than tradeMax players from either side', () => {
  const { L, ctx, t } = league();
  assert.ok(G.setRules(L, { tradeMax: 2, tradeReview: 'none' }, t).ok);
  const r = G.propose(L, ctx, 0, 1, L.rosters[0].slice(0, 3), L.rosters[1].slice(0, 1), t);
  assert.equal(r.ok, false); assert.match(r.why, /2-for-2/);
  assert.ok(G.propose(L, ctx, 0, 1, L.rosters[0].slice(0, 2), L.rosters[1].slice(0, 2), t).ok);
});

test('counter window: a rival bid for the same players, taken by the seller', () => {
  const { L, ctx, t } = league();
  assert.ok(G.setRules(L, { tradeReview: 'counter', reviewHours: 48 }, t).ok);
  const x = L.rosters[0][3], y = L.rosters[1][3];
  const o = G.propose(L, ctx, 0, 1, [x], [y], t).trade;
  assert.ok(G.respond(L, ctx, o.id, true, t + 1).ok);
  assert.equal(o.status, 'review');
  assert.equal(G.voters(L, o).length, 0, 'no vetoes in a counter window');
  // team 2 bids for x (team 0's player): it has to be the same player, and no more than one back
  const z = L.rosters[2][3], z2 = L.rosters[2][4];
  assert.match(G.propose(L, ctx, 2, 0, [z, z2], [x], t + 2, { rivalOf: o.id }).why, /can't add anything/);
  assert.match(G.propose(L, ctx, 2, 0, [z], [L.rosters[0][4]], t + 2, { rivalOf: o.id }).why, /same players/);
  assert.match(G.propose(L, ctx, 1, 0, [L.rosters[1][5]], [x], t + 2, { rivalOf: o.id }).why, /can't counter/);
  const bid = G.propose(L, ctx, 2, 0, [z], [x], t + 2, { rivalOf: o.id });
  assert.ok(bid.ok, bid.why);
  assert.equal(G.rivalsOf(L, o.id).length, 1);
  // team 0 takes it: x goes to team 2, z to team 0, and the original deal is off
  assert.ok(G.respond(L, ctx, bid.trade.id, true, t + 3).ok);
  assert.ok(L.rosters[2].includes(x) && L.rosters[0].includes(z));
  assert.ok(L.rosters[1].includes(y), 'team 1 keeps its player');
  assert.equal(o.status, 'outbid');
  G.tick(L, ctx, t + 49 * HOUR);
  assert.equal(o.status, 'outbid', 'the window closing does nothing to a deal that was outbid');
});

test('counter window: with no bid taken, the trade goes through when it closes and the bids lapse', () => {
  const { L, ctx, t } = league();
  G.setRules(L, { tradeReview: 'counter', reviewHours: 48 }, t);
  const x = L.rosters[0][3], y = L.rosters[1][3];
  const o = G.propose(L, ctx, 0, 1, [x], [y], t).trade;
  G.respond(L, ctx, o.id, true, t + 1);
  const bid = G.propose(L, ctx, 3, 1, [L.rosters[3][3]], [y], t + 2, { rivalOf: o.id }).trade;
  G.finalize(L, ctx, t + 49 * HOUR);
  assert.equal(o.status, 'accepted');
  assert.ok(L.rosters[1].includes(x) && L.rosters[0].includes(y));
  assert.equal(bid.status, 'expired');
});

test('reseeding: the best seed left plays the worst', () => {
  const { L } = league({ weeks: 2, playoffTeams: 8 }, 8);
  G.setRules(L, { reseed: true }, 0);
  // a first round where seeds 1, 7, 3 and 5 win (1 beats 8, 7 upsets 2, 3 beats 6, 5 upsets 4)
  const seeds = G.seedOrder(L), seed = (t) => seeds.indexOf(t) + 1;
  const wins = new Set([1, 7, 3, 5].map((k) => seeds[k - 1]));
  const rd1 = G.playoffPlan(L)[0].weeks[0];
  L.week = rd1 + 1;
  L.results[rd1] = G.postseason(L)[0].main.map((g) => ({ a: g.a, b: g.b, sa: wins.has(g.a) ? 10 : 1, sb: wins.has(g.b) ? 10 : 1, w: wins.has(g.a) ? 'a' : 'b' }));
  assert.deepEqual(G.postseason(L)[1].main.map((g) => [seed(g.a), seed(g.b)]), [[1, 7], [3, 5]]);
  assert.match(G.setRules(L, { reseed: false }, 0).why, /playoffs have started/, "the bracket can't change once it's under way");
  L.settings.reseed = false;
  assert.deepEqual(G.postseason(L)[1].main.map((g) => [seed(g.a), seed(g.b)]), [[1, 5], [7, 3]], 'a fixed bracket keeps its halves');
});

test('innings minimum: a team short of it loses ERA and WHIP', () => {
  const sc = { type: 'cats', cats: [{ k: 'k', label: 'K' }, { k: 'era', rate: 'era', w: 'ip', low: true }, { k: 'whip', rate: 'whip', w: 'ip', low: true }] };
  const ctx = { hooks: {}, sport: { key: 'mlb', scorings: { x: sc } } };
  const team = (k, era, whip, ip) => ({ cats: { k, era, whip }, parts: { era: [era * ip, ip], whip: [whip * ip, ip] } });
  const a = team(40, 2.0, 0.9, 22), b = team(50, 4.5, 1.4, 41);
  const L = { scoring: 'x', settings: {} };
  let r = G.compare(L, ctx, a, b);
  assert.deepEqual([r.cats.era[2], r.cats.whip[2]], [1, 1], 'without a minimum the better ratios win');
  L.settings.minIP = 30;
  r = G.compare(L, ctx, a, b);
  assert.deepEqual([r.cats.era[2], r.cats.whip[2]], [-1, -1], 'short of 30 innings, a loses both');
  assert.equal(r.w, 'b');
  r = G.compare(L, ctx, a, team(50, 4.5, 1.4, 25));
  assert.deepEqual([r.cats.era[2], r.cats.whip[2]], [0, 0], 'both short: a tie');
});

test('draft lottery: non-playoff teams are drawn, playoff teams follow worst finish first', () => {
  const { L } = league({ weeks: 2, playoffTeams: 4 }, 8);
  L.imported = { from: 'test', standings: L.teams.map((t, i) => ({ team: t.id, w: 10 - i, l: i, t: 0, rank: i + 1 })), final: { champion: 1, runnerUp: 0, third: 2 } };
  L.week = G.totalWeeks(L) + 1;
  G.setRules(L, { draftOrder: 'lottery' }, 0);
  let k = 0; const seq = [0.9, 0.1, 0.5, 0.3];
  const r = G.draftLottery(L, () => seq[k++ % seq.length], 5);
  assert.ok(r.ok, r.why);
  assert.equal(L.nextOrder.length, 8);
  assert.deepEqual(new Set(L.nextOrder.slice(0, 4)), new Set(L.lottery.drawn));
  assert.equal(L.nextOrder[7], 1, 'the champion picks last');
  assert.equal(L.nextOrder[6], 0, 'the runner-up picks second to last');
  assert.ok(L.lottery.drawn.every((t) => ![0, 1, 2, 3].includes(t)), 'only non-playoff teams are in the lottery');
});

test('eligibility: a league with its own thresholds recomputes positions from the counts', () => {
  const p = { pos: ['2B'], l: { bat: [1] }, pg: [{ '2B': [40, 38], SS: [12, 4], '3B': [6, 5] }] };
  assert.deepEqual(S.eligibleAt(p, S.ELIG), ['2B', '3B', 'SS']);
  assert.deepEqual(S.eligibleAt(p, S.ELIG_PRESETS.espn[1]), ['2B']);
  const dh = { pos: ['UT'], l: { bat: [1] }, pg: [{}] };
  assert.deepEqual(S.eligibleAt(dh, S.ELIG), ['UT'], 'a DH stays UT');
  const arm = { pos: ['RP'], l: { pit: [1] }, pg: [{ SP: [4, 4], RP: [30, 0] }] };
  assert.deepEqual(S.eligibleAt(arm, S.ELIG), ['SP', 'RP']);
  const ps = [Object.assign({}, p)];
  S.applyElig(ps, S.ELIG_PRESETS.espn[1]);
  assert.deepEqual(ps[0].pos, ['2B']);
  assert.ok(G.setRules({ settings: {}, week: 1, teams: [], tx: [], nextId: 1 }, { elig: { g: 20, gs: 0, sp: 5, rp: 8 } }, 0).ok);
});
