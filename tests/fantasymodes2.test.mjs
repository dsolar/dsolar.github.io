import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js'), V = require('../fantasy-kit/value.js'), F = require('../fantasy-kit/draft.js'), G = require('../fantasy-kit/league.js'), Z = require('../fantasy-kit/season.js'), SL = require('../fantasy-kit/slates.js');
const fx = JSON.parse(readFileSync(new URL('./fixtures/nfl-slates.json', import.meta.url), 'utf8'));
const nfl = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
const now = Date.parse('2026-11-05T13:00Z');
function pool(kind, teams, opts = {}) {
  const sl = SL.pick(fx.weeks[0], kind, null, now), lu = SL.lineup(sl.games.length, teams);
  const sport = S.attach(Object.assign({}, S.nfl), nfl);
  const players = nfl.players.filter((p) => sl.teams.includes(p.t)).map((p) => ({ ...p }));
  const bench = opts.bench != null ? opts.bench : lu.bench;
  V.evaluate(sport, players, { teams, lineup: lu.lineup, bench, scoring: 'half', budget: opts.budget || 200 });
  const D = F.create({ sport, teams, seed: 4, now, lineup: lu.lineup, bench, scoring: 'half', botDelay: 0, clock: 30 });
  D.season = { format: 'h2h', tally: 'allplay', weeks: 1, oneWeek: true, playoffTeams: 0, slate: sl };
  return { sl, lu, sport, players, D, ctx: F.context(D, players, sport) };
}

test('salary cap: lineups under the cap, shared players, bots build their own, unique picks score the bonus', () => {
  const { D, ctx, sport, players, sl } = pool('sunday', 4, { bench: 0, budget: 100 });
  D.cap = { budget: 100, due: sl.first, bonus: 1.25 };
  D.cap.prices = F.capPrices(D, players, sport);
  assert.ok(Object.keys(D.cap.prices).length > 50);
  const best = (slot, skip = []) => ctx.players.filter((p) => S.fits(sport, p, slot) && !skip.includes(p.id)).sort((a, b) => b.v - a.v)[0];
  // a lineup of the best at every spot is over the cap
  const stars = []; for (const sl2 of D.lineup) stars.push(best(sl2, stars).id);
  const c = F.capCheck(D, ctx, stars);
  assert.equal(c.ok, false); assert.match(c.why, /over the \$100 cap/);
  const auto = F.capAuto(D, ctx, 1);
  const ok = F.capCheck(D, ctx, auto);
  assert.ok(ok.ok, ok.why); assert.ok(ok.spent <= 100);
  assert.equal(F.capCheck(D, ctx, auto.slice(0, -1)).ok, false, 'every spot filled');
  // two teams enter the same lineup; the others are built for them
  assert.ok(F.capReveal(D, ctx, { 0: auto, 1: auto }, D.cap.due));
  assert.equal(D.phase, 'done');
  assert.deepEqual(D.cap.lineups[1], auto, 'the same players on two teams');
  assert.ok(D.cap.lineups[2].every(Boolean) && D.cap.lineups[3].every(Boolean));
  assert.ok(!auto.some((pid) => D.cap.unique.includes(pid)), 'a shared player gets no bonus');
  const L = Z.begin(D, sport, { now: D.cap.due });
  assert.deepEqual(L.lineups[1][0], auto);
  assert.ok(L.settings.frozen);
  for (const pid of D.cap.unique) assert.equal(L.pmult[pid], 1.25);
  const lctx = G.context(L, players, sport);
  Z.catchUp(L, lctx, L.start + 7 * 864e5 + 1);
  assert.equal(L.results[1].length >= 2, true);
  assert.equal(G.finish(L).champion != null, true);
});

test('sealed draft: everyone\'s list runs the draft the moment it closes', () => {
  const { D, ctx, sl } = pool('full', 4);
  D.sealed = { due: now + 36e5 };
  D.teams[0].owner = 'Dave'; D.teams[1].owner = 'Yan';
  const top = ctx.players.slice().sort((a, b) => b.v - a.v).map((p) => p.id);
  // Yan ranks the consensus top player first; Dave ranks a lesser player first and gets him
  const pickD = top[20];
  const mine = [pickD].concat(top.slice(40, 80)), yan = top.slice(0, 40);
  assert.equal(Z.driveDraft(D, ctx, now, { 0: mine, 1: yan }), false, 'not until it closes');
  assert.ok(Z.driveDraft(D, ctx, D.sealed.due + 1, { 0: mine, 1: yan }));
  assert.equal(D.phase, 'done');
  const ros = F.rosters(D);
  assert.ok(ros[0].includes(pickD), 'Dave got his first choice');
  assert.ok(ros.every((r) => r.length === D.rounds), 'every roster full');
  assert.ok(D.teams.every((t) => !t.auto), 'autodraft turned back off');
});

test('salary cap prices: a star costs about twice an even share, and bots spend most of the cap on good lineups', () => {
  for (const kind of ['full', 'prime']) {
    const { D, ctx, sport, players, sl } = pool(kind, 6, { bench: 0 });
    D.cap = { budget: 100, due: sl.first, bonus: 1.25 };
    D.cap.prices = F.capPrices(D, players, sport);
    const avg = 100 / D.lineup.length, top = ctx.players.slice().sort((a, b) => b.v - a.v)[0];
    assert.ok(Math.abs(F.capPrice(D, top) - avg * 1.9) <= 1, `${kind}: top price`);
    const spent = [];
    for (let s = 1; s <= 6; s++) { const e = F.capAuto(D, ctx, s * 31), c = F.capCheck(D, ctx, e); assert.ok(c.ok, c.why); spent.push(c.spent); }
    assert.ok(Math.min(...spent) >= 85, `${kind}: bots use the cap (${spent})`);
    if (D.lineup[0] === 'CPT') { const e = F.capAuto(D, ctx, 3); assert.equal(F.capCost(D, ctx.byId[e[0]], 'CPT'), Math.round(F.capPrice(D, ctx.byId[e[0]]) * 1.5)); }
  }
});
