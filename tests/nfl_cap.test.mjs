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

test('next contracts and tags: comparable deals, years capped by age, only real tag candidates', () => {
  const C2 = require('../nfl/lib/cap.js'), P = require('../nfl/lib/plan.js'), S = require('../nfl/lib/season.js');
  const d = read('draft/nfl.json');
  const W = P.init(C2.newWorld(read('nfl/data/league.json'), read('nfl/data/teamcap.json'), read('nfl/data/rating.json')));
  W.draft = d.order; W.future = d.future; W.sim = S.simulate(W.games, Object.keys(S.divOf), { sims: 300, seed: 3 });
  for (const p of W.players.filter(p => p.c && p.age && P.share(W, p) > 0.5).slice(0, 120)) {
    const e = P.contract(W, p, W.season + 1), age = p.age + 1;
    assert.ok(e.apy > 0 && e.yrs >= 1 && e.yrs <= 5 && e.gtd <= e.total + 1e-9 && e.comps.length > 0);
    if (age >= 33) assert.equal(e.yrs, 1);
  }
  let n = 0;
  for (const t of Object.keys(S.divOf)) for (const s of P.suggest(W, t, W.season + 1)) if (s.kind === 'tag') {
    n++; assert.ok(s.apy >= 0.65 * s.tag && P.ratingZ(W, s.p, W.season + 1) >= 0.67);
  }
  assert.ok(n <= 64);
  // expected draft slots: every slot 1-32 averages out, each team's picks sorted
  const sl = P.slots(W, W.season + 1), avg = Object.values(sl).reduce((a, x) => a + x.slot, 0) / 32;
  near(avg, 16.5);
  const pk = P.picksIn(W, 'NE', W.season + 2);
  assert.ok(pk.length >= 5 && pk.every((x, i) => i === 0 || x.en >= pk[i - 1].en));
});

test('trade value: pick chart, better players cost more, packages reach the price', () => {
  const C2 = require('../nfl/lib/cap.js'), P = require('../nfl/lib/plan.js'), S = require('../nfl/lib/season.js');
  const d = read('draft/nfl.json');
  const W = P.init(C2.newWorld(read('nfl/data/league.json'), read('nfl/data/teamcap.json'), read('nfl/data/rating.json')));
  W.draft = d.order; W.future = d.future; W.sim = S.simulate(W.games, Object.keys(S.divOf), { sims: 300, seed: 5 });
  near(P.pickPoints(1), 1000);
  assert.ok(P.pickPoints(10) > P.pickPoints(32) && P.pickPoints(32) > P.pickPoints(100));
  assert.ok(P.pickPoints(20, 1) < P.pickPoints(20));
  for (const pts of [50, 200, 450, 900]) { const n = P.pickForPoints(pts); assert.ok(P.pickPoints(n) >= pts && P.pickPoints(n + 1) < pts); }
  // the same player, rated higher, costs more
  const p = W.players.find(x => P.group(x) === 'WR' && C2.lastYear(x) >= W.season + 2 && P.role(W, x) > 0.7);
  const a = P.tradeValue(W, p).pts;
  W.quality[p.id] = { ...W.quality[p.id], z: W.quality[p.id].z + 1, mult: W.quality[p.id].mult + 0.45 };
  assert.ok(P.tradeValue(W, p).pts > a);
  const bo = P.bestOffers(W, 'NE', 'IND', 300);
  assert.ok(bo.list.length >= 1 && Math.abs(bo.list[0].net / 300 - 1) < 0.1 && bo.list[0].give.length <= 5 && bo.list[0].back.length <= 2);
  // money: the old team keeps the bonus proration as dead money, the new team pays the rest
  const q = W.players.find(x => x.c && x.c.rows[W.season + 1] && x.c.rows[W.season + 1][C2.R.pr] > 2 && C2.lastYear(x) >= W.season + 2);
  const mo = P.tradeMoney(W, q, q.t === 'NE' ? 'BUF' : 'NE', 'pre'), r = q.c.rows[W.season + 1];
  near(mo.rows[0].buyerAdds, r[C2.R.cap] - r[C2.R.pr]);
  const prLeft = Object.keys(q.c.rows).map(Number).filter(y => y > W.season).reduce((a, y) => a + q.c.rows[y][C2.R.pr], 0);
  near(mo.rows[0].sellerDead, prLeft);
  const post = P.tradeMoney(W, q, 'NE', 'post');
  near(post.rows[0].sellerDead + post.rows[1].sellerDead, prLeft);
});

test('needs, fits, cap casualties and round-based prices', () => {
  const C2 = require('../nfl/lib/cap.js'), P = require('../nfl/lib/plan.js');
  const W = P.init(C2.newWorld(read('nfl/data/league.json'), read('nfl/data/teamcap.json'), read('nfl/data/rating.json')));
  const N = P.needs(W, W.season + 1), codes = Object.keys(N);
  assert.equal(codes.length, 32);
  for (const g of P.NEED_GROUPS) {                         // grades spread across the league at every group
    const gr = codes.map(c => N[c].groups[g].grade);
    assert.ok(gr.includes('A') && gr.includes('F'), g);
  }
  for (const c of codes) assert.ok(N[c].top.length <= 4 && N[c].top.every(x => x.why));
  const cc = P.casualties(W, W.season + 1);
  assert.ok(cc.length > 10 && cc.every((x, i) => i === 0 || x.lik <= cc[i - 1].lik));
  assert.ok(!cc.some(x => /^(K|P|LS)$/.test(P.group(x.p))));
  assert.match(P.priceText(P.roundAvg(1) * 2).long, /^two firsts/);
  assert.match(P.priceText(P.roundAvg(1) + P.roundAvg(2)).long, /^a first and a second/);
  assert.match(P.priceText(P.pickPoints(50)).long, /second/);
});
