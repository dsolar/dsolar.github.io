// The Dutch auction draft: node --test tests/fantasydutch.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const V = require('../fantasy-kit/value.js');
const F = require('../fantasy-kit/draft.js');

const T0 = Date.UTC(2026, 10, 24);
function room(o = {}) {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nba.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nba), data);
  const players = data.players.map((p) => ({ ...p }));
  const teams = o.teams || 8;
  const scoring = Object.keys(sport.scorings)[0];
  V.evaluate(sport, players, { teams, lineup: sport.lineup, scoring });
  const list = [...Array(teams).keys()].map((i) => ({ name: `T${i}`, abbr: `T${i}`, owner: (o.humans || []).includes(i) ? `u${i}` : null }));
  const D = F.create({ sport, type: 'dutch', teams: list, seed: o.seed || 11, now: T0, scoring, botDelay: 0, budget: 200, dutch: o.dutch });
  const ctx = F.context(D, players, sport);
  return { D, ctx, sport, players };
}
function run(D, ctx, from, step = 1000, cap = 200000) {
  let t = from;
  for (let i = 0; i < cap && D.phase === 'live'; i++) { t += step; F.tick(D, ctx, t); }
  return t;
}

test('a Dutch draft is an auction underneath, with its own rules', () => {
  const { D } = room();
  assert.equal(D.type, 'auction');
  assert.equal(F.formatOf(D), 'dutch');
  assert.ok(F.dutchOn(D));
  assert.deepEqual([D.auction.dutch.size, D.auction.dutch.fall, D.auction.dutch.gap], [8, 30, 6]);
  assert.equal(F.FORMATS.dutch, 'Dutch auction');
});

test('a wave shows first, then every price falls to the floor and never rises', () => {
  const { D, ctx } = room({ humans: [0, 1, 2, 3, 4, 5, 6, 7] });        // no bots: nobody claims
  F.start(D, T0, ctx);
  F.tick(D, ctx, T0 + 1);
  let st = F.auctionState(D, T0 + 1);
  assert.equal(st.kind, 'wave');
  assert.equal(st.open, false, 'the wave is on show before prices move');
  assert.equal(st.lots.length, 8);
  const w = D.auction.wave;
  assert.equal(w.at, T0 + 6000);
  assert.equal(w.ends, T0 + 36000);
  const top = ctx.byId[st.lots[0].pid];
  assert.ok(st.lots[0].start >= Math.floor(top.$ * 1.6), 'opens well over his value');
  let last = st.lots.map((l) => l.price);
  for (let t = w.at; t <= w.ends; t += 500) {
    const now = F.auctionState(D, t).lots.map((l) => l.price);
    now.forEach((p, i) => assert.ok(p <= last[i], 'a price only falls'));
    last = now;
  }
  assert.ok(last.every((p) => p === 1), 'everything reaches $1');
  // around his value the fall is slow: it takes over half the clock to go from 120% to 72% of the opening share
  const lot = w.lots[0], near = (u) => F.dutchPrice(D, lot, w.at + w.len * u);
  assert.ok(near(0.2) - near(0.75) < near(0) - near(0.2) + near(0.75) - near(1));
});

test('the first claim wins at the price showing, and the budget guard holds', () => {
  const { D, ctx } = room({ humans: [0, 1, 2, 3, 4, 5, 6, 7] });
  F.start(D, T0, ctx); F.tick(D, ctx, T0 + 1);
  const w = D.auction.wave, lot = w.lots[0];
  assert.equal(F.claim(D, ctx, 0, lot.pid, T0 + 2000).ok, false, 'not before prices start to fall');
  // a team short on money can't claim until the price is down to what it may spend on one player
  D.teams[0].budget = 30;
  assert.match(F.claim(D, ctx, 0, lot.pid, w.at + 10).why, /at most \$18/);
  const t = w.at + w.len * 0.6, price = F.dutchPrice(D, lot, t);
  const r = F.claim(D, ctx, 1, lot.pid, t);
  assert.ok(r.ok); assert.equal(r.price, price);
  assert.equal(D.teams[1].budget, 200 - price);
  assert.equal(D.sales[D.sales.length - 1].pid, lot.pid);
  const again = F.claim(D, ctx, 2, lot.pid, t + 5);
  assert.equal(again.ok, false);
  assert.match(again.why, /got there first/);
  assert.equal(D.auction.wave.lots.length, 7);
});

test('a pause stops the fall and a resume picks it up at the same price', () => {
  const { D, ctx } = room({ humans: [0, 1, 2, 3, 4, 5, 6, 7] });
  F.start(D, T0, ctx); F.tick(D, ctx, T0 + 1);
  const w = D.auction.wave, lot = w.lots[1], t = w.at + 9000, p0 = F.dutchPrice(D, lot, t);
  F.pause(D, t, true);
  assert.equal(F.dutchPrice(D, lot, t + 60000), p0);
  assert.equal(F.claim(D, ctx, 0, lot.pid, t + 100).ok, false);
  F.pause(D, t + 60000, false);
  assert.equal(F.dutchPrice(D, lot, t + 60000), p0);
  assert.equal(D.auction.wave.ends, w.ends);
  assert.ok(F.dutchPrice(D, lot, t + 70000) < p0);
});

test('bots fill every roster inside their budgets, at sensible prices', () => {
  const { D, ctx } = room({ teams: 10, seed: 5 });
  F.start(D, T0, ctx);
  run(D, ctx, T0);
  assert.equal(D.phase, 'done');
  const ros = F.rosters(D);
  ros.forEach((ids, t) => { assert.equal(ids.length, F.sizeOf(D, t)); assert.ok(D.teams[t].budget >= 0); });
  assert.equal(new Set(D.sales.map((s) => s.pid)).size, D.sales.length, 'nobody is sold twice');
  const spent = D.sales.reduce((a, s) => a + s.price, 0);
  assert.ok(spent > 10 * 200 * 0.6, `the league spends most of its money (${spent})`);
  // the stars cost real money, and nobody pays the opening price for one
  const top = D.sales.slice().sort((a, b) => ctx.byId[b.pid].$ - ctx.byId[a.pid].$).slice(0, 10);
  for (const s of top) { assert.ok(s.price >= ctx.byId[s.pid].$ * 0.5, 'a star is not a giveaway'); assert.ok(s.price < s.from, 'bots wait for the fall'); }
});

test('the same seed plays the same draft', () => {
  const a = room({ seed: 9 }), b = room({ seed: 9 });
  F.start(a.D, T0, a.ctx); F.start(b.D, T0, b.ctx);
  run(a.D, a.ctx, T0); run(b.D, b.ctx, T0, 7000);
  assert.deepEqual(a.D.sales.map((s) => [s.team, s.pid, s.price]), b.D.sales.map((s) => [s.team, s.pid, s.price]));
});

test('a manager who never claims still ends up with a full roster', () => {
  const { D, ctx } = room({ humans: [0] });
  F.start(D, T0, ctx);
  run(D, ctx, T0);
  assert.equal(D.phase, 'done');
  assert.equal(F.rosters(D)[0].length, F.sizeOf(D, 0));
  assert.ok(D.sales.filter((s) => s.team === 0).every((s) => s.auto && s.price === 1), 'handed players at the minimum once the waves go dead');
});

test('an unsold player comes back cheaper, and undo puts the last sale back in the pool', () => {
  const { D, ctx } = room({ humans: [0, 1, 2, 3, 4, 5, 6, 7] });
  F.start(D, T0, ctx); F.tick(D, ctx, T0 + 1);
  const w1 = D.auction.wave, first = w1.lots[0];
  const sold = w1.lots[7];
  assert.ok(F.claim(D, ctx, 3, sold.pid, w1.ends - 10).ok);
  F.tick(D, ctx, w1.ends + 1);                                         // closes wave 1, opens wave 2
  const w2 = D.auction.wave;
  assert.equal(w2.n, 2);
  const back = w2.lots.find((l) => l.pid === first.pid);
  assert.ok(back && back.start < first.start);
  const r = F.undo(D, ctx, w2.at);
  assert.ok(r.ok); assert.equal(r.sale.pid, sold.pid);
  assert.equal(D.teams[3].budget, 200);
});
