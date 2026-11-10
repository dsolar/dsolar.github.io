// NFL cap engine checks: node --test tests/nfl_cap.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url);
const C = require('../nfl/lib/cap.js');
const read = p => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));

// A made-up deal: $20M signing bonus over 4 years ($5M a year), base salaries 10/15/20/25, 2027 base guaranteed
const p = { id: 'x', exp: 6, t: 'AAA', c: { rows: {
  2027: [10, 5, 0, 0, 10, 15, 0], 2028: [15, 5, 0, 0, 0, 20, 0], 2029: [20, 5, 0, 0, 0, 25, 0], 2030: [25, 5, 0, 0, 0, 30, 0] } } };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' vs ' + b);

test('cut before June 1: all proration and guarantees now', () => {
  const e = C.effect(p, { kind: 'cut', year: 2027 });
  near(e.dead[2027], 20 + 10);
  near(e.delta[2027], -15 + 30);            // loses cap room this year
  near(e.delta[2028], -20);
});

test('cut after June 1: this year keeps its own share, the rest lands next year', () => {
  const e = C.effect(p, { kind: 'cutJune', year: 2027 });
  near(e.dead[2027], 5 + 10);
  near(e.dead[2028], 15);
  near(e.delta[2027], 0);
  near(e.delta[2028], -20 + 15);
});

test('trade: proration stays, salary goes', () => {
  const e = C.effect(p, { kind: 'trade', year: 2028 });
  near(e.dead[2028], 15);
  near(e.delta[2028], -20 + 15);
  near(e.other[2028], 15);
});

test('restructure: base above the minimum spread over the years left', () => {
  const e = C.effect(p, { kind: 'restructure', year: 2028 });
  const conv = 15 - C.minSalary(6, 2028);
  near(e.converted, conv);
  near(e.delta[2028], -conv + conv / 3);
  near(e.delta[2030], conv / 3);
  const v = C.effect(p, { kind: 'restructure', year: 2028, voids: true });
  assert.equal(v.over, 5); assert.equal(v.addsVoid, 2);
});

test('league file: every team, contracts by year, and sums near Over The Cap', () => {
  const L = read('nfl/data/league.json'), tc = read('nfl/data/teamcap.json');
  const W = C.newWorld(L, tc);
  const teams = new Set(L.players.map(x => x.t));
  assert.equal(teams.size, 32);
  for (const code of teams) {
    const ty = C.teamYears(W, code, [], 2026, 2027);
    near(ty[0].space, tc.years[2026][code].space / 1e6);
    assert.ok(Math.abs(ty[1].pin) < 20, code + ' 2027 contracts within $20M of Over The Cap (' + ty[1].pin.toFixed(1) + ')');
  }
});

test('season sim: every team gets odds that add up', () => {
  const S = require('../nfl/lib/season.js');
  const L = read('nfl/data/league.json');
  const teams = Object.values(S.DIV).flat();
  const out = S.simulate(L.games, teams, { sims: 1500 });
  const sum = k => teams.reduce((a, t) => a + out.teams[t][k], 0);
  near(sum('div'), 8); near(sum('playoffs'), 14); near(sum('sb'), 1); near(sum('bye'), 2);
  for (const t of teams) assert.ok(out.teams[t].wins + out.teams[t].losses <= 17.01);
});

test('franchise tag: position price grown with the cap, or 120% of last cap hit', () => {
  const P = require('../nfl/lib/plan.js');
  const W = { season: 2026, players: [] };
  const wr = { pos: 'WR', dpos: 'WR', c: { rows: { 2026: [10, 0, 0, 0, 0, 10, 0] } } };
  near(P.tagPrice(W, wr, 2027), 27.298 * 327 / 301.2);
  const star = { pos: 'WR', dpos: 'WR', c: { rows: { 2026: [27.3, 0, 0, 0, 0, 27.3, 0] } } };
  near(P.tagPrice(W, star, 2027), 27.3 * 1.2);
});

test('draft picks: next year\'s class costs cap, the first pick the most', () => {
  const C2 = require('../nfl/lib/cap.js'), P = require('../nfl/lib/plan.js');
  const W = P.init(C2.newWorld(read('nfl/data/league.json'), read('nfl/data/teamcap.json')));
  W.draft = read('draft/nfl.json').order;
  const curve = P.rookieCurve(W);
  assert.ok(curve[1] > curve[32] && curve[32] > curve[100]);
  const first = W.draft.picks[0][3];
  assert.ok(P.rookieCost(W, first, 2027).total > 5);
});

test('player rating: on a 1-99 scale, regulars spread, better players worth more', () => {
  const C2 = require('../nfl/lib/cap.js'), P = require('../nfl/lib/plan.js');
  const W = P.init(C2.newWorld(read('nfl/data/league.json'), read('nfl/data/teamcap.json'), read('nfl/data/rating.json')));
  const qbs = W.players.filter(p => P.group(p) === 'QB' && P.share(W, p) > 0.6).map(p => P.quality(W, p));
  assert.ok(qbs.length >= 20);
  const zs = qbs.map(q => q.z).sort((a, b) => b - a);
  assert.ok(zs[0] > 1 && zs[zs.length - 1] < 0, 'starting QBs should spread both sides of average');
  for (const q of Object.values(W.quality)) {
    assert.ok(q.z >= -3 && q.z <= 3.25);
    assert.ok(q.mult >= 0.3 && q.mult <= 2.3);
  }
  // same player, same role: a higher rating means more value
  const p = W.players.find(x => P.group(x) === 'WR' && P.share(W, x) > 0.6);
  const v0 = P.value(W, p, W.season);
  W.quality[p.id] = { ...W.quality[p.id], mult: W.quality[p.id].mult + 0.5 };
  assert.ok(P.value(W, p, W.season) > v0);
});

test('rating ahead: young players climb toward their peak, older ones slide, this season unchanged', () => {
  const C2 = require('../nfl/lib/cap.js'), P = require('../nfl/lib/plan.js');
  const W = P.init(C2.newWorld(read('nfl/data/league.json'), read('nfl/data/teamcap.json'), read('nfl/data/rating.json')));
  const regs = W.players.filter(p => P.share(W, p) > 0.6 && p.age && Math.abs(P.quality(W, p).z) < 2);
  const young = regs.find(p => p.age < P.PEAK[P.group(p)] - 3), old = regs.find(p => p.age > P.PEAK[P.group(p)] + 2);
  near(P.ratingZ(W, young, W.season), P.quality(W, young).z);
  assert.ok(P.ratingZ(W, young, W.season + 2) > P.ratingZ(W, young, W.season));
  assert.ok(P.ratingZ(W, old, W.season + 1) < P.ratingZ(W, old, W.season));
  assert.ok(P.ratingZ(W, old, W.season + 2) < P.ratingZ(W, old, W.season + 1));
});
