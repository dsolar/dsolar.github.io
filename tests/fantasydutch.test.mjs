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
  const D = F.create({ sport, type: 'dutch', teams: list, seed: o.seed || 11, now: T0, scoring, botDelay: 0, budget: 200, dutch: o.dutch === undefined ? { size: 8, gap: 6, fall: 30 } : o.dutch && !o.dutch.pace ? { fall: 30, ...o.dutch } : o.dutch });
  const ctx = F.context(D, players, sport);
  return { D, ctx, sport, players };
}
function run(D, ctx, from, step = 1000, cap = 200000) {
  let t = from;
  for (let i = 0; i < cap && D.phase === 'live'; i++) { t += step; F.tick(D, ctx, t); }
  return t;
}

test('a Dutch draft is an auction underneath, with its own rules', () => {
  const { D } = room({ dutch: null });
  assert.equal(D.type, 'auction');
  assert.equal(F.formatOf(D), 'dutch');
  assert.ok(F.dutchOn(D));
  assert.deepEqual([D.auction.dutch.size, D.auction.dutch.pace, D.auction.dutch.gap, D.auction.dutch.mult], [3, 'std', 10, 1.35]);
  assert.deepEqual([4, 8, 10, 12, 14, 20].map(F.dutchSize), [3, 3, 3, 4, 4, 4], 'three at a time, four in a big league');
  assert.equal(room({ dutch: { size: 1 } }).D.auction.dutch.size, 1, 'one at a time is allowed');
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
  assert.ok(st.lots[0].start >= Math.floor(top.$ * 1.35), 'opens over his value');
  let last = st.lots.map((l) => l.price);
  for (let t = w.at; t <= w.ends; t += 500) {
    const now = F.auctionState(D, t).lots.map((l) => l.price);
    now.forEach((p, i) => assert.ok(p <= last[i], 'a price only falls'));
    last = now;
  }
  assert.ok(last.every((p) => p === 1), 'everything reaches $1');
  // around his value the fall is slow: 60% of the clock goes on the stretch from about 117% to 78% of his value
  const lot = w.lots[0], near = (u) => F.dutchPrice(D, lot, w.at + w.len * u), v = ctx.byId[lot.pid].$;
  assert.ok(near(0.15) <= v * 1.2 && near(0.15) >= v * 1.1, `after the first step he's just over his value (${near(0.15)} for ${v})`);
  assert.ok(near(0.75) <= v * 0.82 && near(0.75) >= v * 0.72);
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
  // he stays on the board, marked sold, until the wave is over
  assert.equal(D.auction.wave.lots.length, 8);
  assert.deepEqual(D.auction.wave.lots[0].sold, { team: 1, price, at: t });
  const st = F.auctionState(D, t + 10);
  assert.equal(st.unsold, 7);
  assert.deepEqual([st.lots[0].price, st.lots[0].sold.team], [price, 1]);
  assert.equal(F.auctionState(D, t + 5000).lots[0].price, price, 'a sold price stops falling');
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

test('when the last player in a wave is claimed it lingers three seconds, then the next wave gets its look', () => {
  const { D, ctx } = room({ humans: [0, 1, 2, 3, 4, 5, 6, 7], dutch: { size: 3, gap: 10 } });
  F.start(D, T0, ctx); F.tick(D, ctx, T0 + 1);
  const w = D.auction.wave, t = w.at + 12000;
  assert.equal(w.at, T0 + 10000, 'ten seconds to look before prices move');
  w.lots.forEach((l, i) => assert.ok(F.claim(D, ctx, i, l.pid, t + i).ok));
  assert.equal(D.auction.wave.n, 1, 'still showing');
  assert.equal(D.auction.wave.ends, t + 2 + 3000);
  assert.equal(F.auctionState(D, t + 1000).unsold, 0);
  F.tick(D, ctx, t + 2999);
  assert.equal(D.auction.wave.n, 1);
  F.tick(D, ctx, t + 3003);
  assert.equal(D.auction.wave.n, 2);
  assert.equal(D.auction.wave.at, t + 2 + 3000 + 10000);
  assert.ok(D.auction.wave.lots.every((l) => !l.sold));
  assert.ok(!D.auction.dutch.passed[w.lots[0].pid], 'a sold player is not marked unsold');
});

test('undo puts a claimed player back on sale in his wave, and a pause keeps the prices where they were', () => {
  const { D, ctx } = room({ humans: [0, 1, 2, 3, 4, 5, 6, 7], dutch: { size: 3, gap: 5 } });
  F.start(D, T0, ctx); F.tick(D, ctx, T0 + 1);
  const w = D.auction.wave, t = w.at + 8000;
  w.lots.forEach((l, i) => assert.ok(F.claim(D, ctx, i, l.pid, t + i).ok));
  assert.equal(w.ends, t + 3002);
  const p = F.dutchPrice(D, { start: w.lots[2].start }, t + 500);
  F.pause(D, t + 500, true); F.pause(D, t + 60500, false);
  assert.equal(F.dutchPrice(D, { start: w.lots[2].start }, t + 60500), p, 'the clock picks up where it stopped');
  assert.ok(F.undo(D, ctx, t + 61000).ok);
  assert.ok(!w.lots[2].sold); assert.ok(w.lots[0].sold && w.lots[1].sold);
  assert.ok(D.auction.wave.ends >= t + 61000 + 4000, 'time to claim him again');
  assert.equal(D.teams[2].budget, 200);
  assert.ok(F.claim(D, ctx, 3, w.lots[2].pid, t + 61500).ok);
});

test('with a pace, the clock fits the players: long for stars, short for the last waves', () => {
  const { D, ctx } = room({ teams: 10, seed: 6, dutch: { pace: 'std' } });
  assert.equal(room({ dutch: { fall: 45 } }).D.auction.dutch.pace, undefined, 'a fixed fall stays fixed');
  assert.equal(room({ dutch: { pace: 'nope' } }).D.auction.dutch.pace, 'std');
  F.start(D, T0, ctx);
  const seenW = [];
  let t = T0, seen = 0;
  for (let i = 0; i < 400000 && D.phase === 'live'; i++) {
    t += 500; F.tick(D, ctx, t);
    const w = D.auction.wave;
    if (w && w.n !== seen) {
      seen = w.n;
      const top = Math.max(...w.lots.map((l) => l.start));
      seenW.push({ top, len: w.len / 1000, wait: w.wait / 1000, lots: w.lots.length });
      // four seconds for each square-root dollar of the priciest opening price, 6 to 75
      assert.equal(w.len / 1000, Math.max(6, Math.min(75, Math.round(4 * Math.sqrt(top)))));
      assert.equal(w.wait / 1000, Math.max(3, Math.min(10, Math.round(Math.sqrt(top)))), 'the look before prices move scales too');
      assert.equal(w.ends - w.at, w.len);
    }
  }
  assert.equal(D.phase, 'done');
  const first = seenW[0], last = seenW[seenW.length - 1];
  assert.ok(first.len >= 30 && first.wait >= 8, `the first wave gets time (${first.len}s after a ${first.wait}s look)`);
  assert.deepEqual([last.len, last.wait], [7, 3], 'the last waves are quick');
  assert.equal(first.lots, 3);
  assert.ok(seenW.some((w) => w.top <= 3 && w.lots === 6), 'the $1 waves come up six at a time');
  assert.ok(seenW.filter((w) => w.top > 3).every((w) => w.lots <= 3));
  const fast = room({ teams: 10, seed: 6, dutch: { pace: 'fast' } }), slow = room({ teams: 10, seed: 6, dutch: { pace: 'slow' } });
  for (const r of [fast, slow]) { F.start(r.D, T0, r.ctx); F.tick(r.D, r.ctx, T0 + 1); }
  assert.ok(fast.D.auction.wave.len < first.len * 1000 && first.len * 1000 < slow.D.auction.wave.len);
});

test('bots wait for a discount: stars go for about their value, and not in the first few seconds', () => {
  const { D, ctx } = room({ teams: 10, seed: 8, dutch: { pace: 'std' } });
  F.start(D, T0, ctx);
  const at = {}; let t = T0, seen = 0;
  for (let i = 0; i < 400000 && D.phase === 'live'; i++) { t += 250; F.tick(D, ctx, t); const w = D.auction.wave; if (w && w.n !== seen) { seen = w.n; at[w.n] = w.at; } }
  const stars = D.sales.filter((s) => !s.auto && ctx.byId[s.pid].$ >= 40);
  assert.ok(stars.length >= 8);
  const ratio = stars.reduce((a, s) => a + s.price / ctx.byId[s.pid].$, 0) / stars.length;
  assert.ok(ratio > 0.9 && ratio < 1.1, `stars go for about their value (${ratio.toFixed(2)})`);
  const secs = stars.map((s) => (s.at - at[s.wave]) / 1000).sort((a, b) => a - b);
  assert.ok(secs[0] >= 6, `nobody snipes a star in the first seconds (${secs[0]})`);
  assert.ok(secs[Math.floor(secs.length / 2)] >= 10, `a typical star is on the board ten seconds or more (${secs[Math.floor(secs.length / 2)]})`);
  assert.ok(D.teams.every((x) => x.budget <= 12), 'the room spends its money');
});

// ---------- the slow sale (pace "drip") ----------
const H = 3600e3;
function sale(o = {}) {
  const r = room({ teams: o.teams || 8, seed: o.seed || 3, humans: o.humans || [], dutch: { pace: 'drip', window: o.window === undefined ? 48 * 3600 : o.window } });
  F.start(r.D, T0, r.ctx); F.tick(r.D, r.ctx, T0 + 1);
  return r;
}
const runSale = (D, ctx, step = 600e3) => { let t = T0; for (let i = 0; i < 5000 && D.phase === 'live'; i++) { t += step; F.tick(D, ctx, t, 500); } return t; };

test('the sale: every draftable player in one wave, falling for the whole window', () => {
  const { D } = sale();
  const R = D.auction.dutch, w = D.auction.wave, spots = D.teams.length * D.rounds;
  assert.deepEqual([R.pace, R.window, R.mult], ['drip', 48 * 3600, 1.2]);
  assert.equal(w.len, 48 * H);
  assert.equal(w.lots.length, Math.ceil(spots * 1.5), 'half again as many players as spots');
  const st = F.auctionState(D, w.at + H);
  assert.ok(st.drip && st.open);
  assert.equal(room({ dutch: { pace: 'drip' } }).D.auction.dutch.window, 48 * 3600, 'two days unless set');
  assert.equal(room({ dutch: { pace: 'std' } }).D.auction.dutch.window, undefined);
});

test('bots buy through the window, stars around their value, and every roster ends full', () => {
  const { D, ctx } = sale({ seed: 5 });
  const w = D.auction.wave, t = runSale(D, ctx);
  assert.equal(D.phase, 'done');
  assert.ok(t <= w.ends + 600e3 + 1, 'done by the end of the window');
  F.rosters(D).forEach((ids, i) => { assert.equal(ids.length, F.sizeOf(D, i)); assert.ok(D.teams[i].budget >= 0); });
  assert.equal(new Set(D.sales.map((s) => s.pid)).size, D.sales.length);
  const stars = D.sales.filter((s) => !s.auto && ctx.byId[s.pid].$ >= 40);
  const ratio = stars.reduce((a, s) => a + s.price / ctx.byId[s.pid].$, 0) / stars.length;
  assert.ok(ratio > 0.88 && ratio < 1.1, `stars go for about their value (${ratio.toFixed(2)})`);
  const first = Math.min(...D.sales.map((s) => s.at)) - w.at;
  assert.ok(first > 2 * H && first < 16 * H, `the first claim comes hours in, not at the open (${(first / H).toFixed(1)}h)`);
});

test('a standing order claims the player the moment his price gets there, ahead of the bots', () => {
  const { D, ctx } = sale({ humans: [0], seed: 4 });
  const w = D.auction.wave, lot = w.lots[2], p = ctx.byId[lot.pid], want = Math.round(p.$ * 1.1);
  assert.equal(F.order(D, ctx, 0, lot.pid, 0.4, T0 + 5).ok, true, 'a zero price is "take it off"');
  assert.match(F.order(D, ctx, 0, lot.pid, 500, T0 + 5).why, /You have \$200/);
  const r = F.order(D, ctx, 0, lot.pid, want, T0 + 5);
  assert.deepEqual([r.ok, r.price, r.got], [true, want, false]);
  assert.deepEqual(D.teams[0].orders[lot.pid], { p: want, at: T0 + 5 });
  runSale(D, ctx);
  const s = D.sales.find((x) => x.pid === lot.pid);
  assert.equal(s.team, 0);
  assert.ok(s.price <= want && s.price >= want - 1, `he paid his price (${s.price} for an order of ${want})`);
  assert.ok(!s.auto);
  assert.equal(D.teams[0].orders[lot.pid], undefined, 'a filled order is gone');
  // everything he didn't claim is filled at the end, for the minimum
  const filled = D.sales.filter((x) => x.team === 0 && x.auto);
  assert.equal(filled.length, F.sizeOf(D, 0) - 1);
  assert.ok(filled.every((x) => x.price === 1 && x.at === w.ends));
});

test('an order under the price showing waits; one over it buys now at the price showing', () => {
  const { D, ctx } = sale({ humans: [0, 1, 2, 3, 4, 5, 6, 7] });
  const w = D.auction.wave, a = w.lots[0], b = w.lots[1], t = w.at + 20 * H;
  const pa = F.dutchPrice(D, a, t), pb = F.dutchPrice(D, b, t);
  const low = F.order(D, ctx, 0, a.pid, pa - 5, t);
  assert.deepEqual([low.ok, low.got], [true, false]);
  const high = F.order(D, ctx, 1, b.pid, pb + 20, t);
  assert.deepEqual([high.ok, high.got], [true, true]);
  assert.equal(D.sales[D.sales.length - 1].price, pb, 'the price showing, not the order');
  assert.equal(D.teams[1].budget, 200 - pb);
  // two orders on one player: the higher gets there first
  F.order(D, ctx, 2, a.pid, pa - 2, t + 1);
  F.tick(D, ctx, w.ends - 1, 500);
  const s = D.sales.find((x) => x.pid === a.pid);
  assert.deepEqual([s.team, s.price], [2, pa - 2]);
  assert.equal(D.teams[0].orders[a.pid], undefined, 'the loser\'s order is cleared');
  // an order comes off
  F.order(D, ctx, 3, w.lots[5].pid, 9, t + 2);
  assert.ok(F.order(D, ctx, 3, w.lots[5].pid, 0, t + 3).off);
  assert.equal(D.teams[3].orders[w.lots[5].pid], undefined);
});

test('an order respects the budget guard and the roster when its moment comes', () => {
  const { D, ctx } = sale({ humans: [0, 1, 2, 3, 4, 5, 6, 7] });
  const w = D.auction.wave, a = w.lots[0], b = w.lots[1], t = w.at + 10 * H;
  // $48 of his $60 on one player leaves a dollar a spot: the second order can only fire once he's down to $1
  D.teams[0].budget = 60;
  F.order(D, ctx, 0, a.pid, 48, t);
  F.order(D, ctx, 0, b.pid, 40, t);
  F.tick(D, ctx, w.ends - 1, 500);
  const got = D.sales.filter((x) => x.team === 0).map((x) => [x.pid, x.price]);
  assert.deepEqual(got.map((x) => x[1]), [48, 1], 'the second waits until he can afford it');
  assert.ok(D.teams[0].budget >= F.spotsLeft(D, 0), 'a dollar left for every open spot');
});

test('orders can go in before the draft starts, and a manual claim still works in the sale', () => {
  const r = room({ teams: 8, humans: [0], dutch: { pace: 'drip', window: 3600 } });
  const some = r.ctx.available.slice().sort((x, y) => y.$ - x.$)[4];
  assert.ok(F.order(r.D, r.ctx, 0, some.id, Math.round(some.$ * 1.3), T0 - 100).ok);     // over the opening price: his at the open
  F.start(r.D, T0, r.ctx); F.tick(r.D, r.ctx, T0 + 1);
  const w = r.D.auction.wave, other = w.lots[9];
  const c = F.claim(r.D, r.ctx, 0, other.pid, w.at + 60e3);
  assert.ok(c.ok); assert.equal(c.price, F.dutchPrice(r.D, { start: other.start }, w.at + 60e3));
  runSale(r.D, r.ctx, 30e3);
  assert.equal(r.D.phase, 'done');
  const mine = r.D.sales.find((x) => x.pid === some.id);
  assert.equal(mine.team, 0);
  assert.deepEqual([mine.at, mine.price], [w.at, mine.from], 'bought at the open, at the opening price');
});

test('the sale tells managers what happened while they were away', () => {
  const Z = require('../fantasy-kit/season.js');
  const { D, ctx } = sale({ humans: [0, 1], seed: 4 });
  const w = D.auction.wave, a = w.lots[1], b = w.lots[2];
  const seats = { 0: 'u0', 1: 'u1' }, o = { name: 'Test', url: 'https://x/', seats, me: null, byId: ctx.byId };
  // setup to live: the open notice names the close
  const pre = structuredClone(D); pre.phase = 'setup';
  const open = Z.events({ draft: pre, league: null }, { draft: D, league: null }, { ...o, now: T0 + 1 });
  assert.equal(open.length, 2); assert.match(open[0].subject, /the sale is open/); assert.match(open[0].body, /leave a price/);
  // team 0 leaves a high price, team 1 a low one on the same player; team 1 also wants another
  F.order(D, ctx, 0, a.pid, Math.round(ctx.byId[a.pid].$ * 1.12), T0 + 10);
  F.order(D, ctx, 1, a.pid, Math.round(ctx.byId[a.pid].$ * 0.7), T0 + 10);
  const base = structuredClone(D);
  assert.equal(Z.driveDraft(D, ctx, w.at + 20 * H), true);
  const ev = Z.events({ draft: base, league: null }, { draft: D, league: null }, { ...o, now: w.at + 20 * H });
  const mine = ev.find((e) => e.team === 0), theirs = ev.find((e) => e.team === 1);
  assert.match(mine.subject, new RegExp(`you got ${ctx.byId[a.pid].n}`));
  assert.match(mine.body, /Your price was reached/);
  assert.match(theirs.subject, /went to another team/);
  assert.match(theirs.body, /your price was \$/);
  assert.ok(D.sales.find((s) => s.pid === a.pid).order, 'marked as an order, not a click');
  // the last call goes out once, three hours before the close, to teams with spots open
  const b2 = structuredClone(D);
  assert.equal(Z.driveDraft(D, ctx, w.ends - 2.5 * H), true);
  const lastCall = Z.events({ draft: b2, league: null }, { draft: D, league: null }, { ...o, now: w.ends - 2.5 * H }).filter((e) => /closes in 3 hours/.test(e.subject));
  assert.equal(lastCall.length, 2);
  const b3 = structuredClone(D);
  Z.driveDraft(D, ctx, w.ends - 2.4 * H);
  assert.equal(Z.events({ draft: b3, league: null }, { draft: D, league: null }, { ...o, now: w.ends - 2.4 * H }).filter((e) => /closes in 3 hours/.test(e.subject)).length, 0);
  void b;
});

test('a price left on a player works in the fast waves too, even before his wave comes up', () => {
  const { D, ctx } = room({ humans: [0], seed: 7, dutch: { pace: 'std', size: 3 } });
  F.start(D, T0, ctx); F.tick(D, ctx, T0 + 1);
  const w1 = D.auction.wave, now1 = w1.lots[0], later = ctx.available.slice().sort((x, y) => y.$ - x.$)[7];
  assert.ok(!w1.lots.some((l) => l.pid === later.id), 'he is not up yet');
  // during the look, before prices move: a price over the opening one buys the moment the wave opens
  assert.ok(F.order(D, ctx, 0, now1.pid, now1.start + 5, T0 + 2000).ok);
  assert.ok(F.order(D, ctx, 0, later.id, Math.round(later.$ * 1.25), T0 + 2000).ok);
  F.tick(D, ctx, w1.at + 1);
  const first = D.sales.find((s) => s.pid === now1.pid);
  assert.deepEqual([first.team, first.price, first.at, first.order], [0, now1.start, w1.at, true]);
  let t = w1.at;
  for (let i = 0; i < 4000 && !D.sales.some((s) => s.pid === later.id); i++) { t += 500; F.tick(D, ctx, t); }
  const second = D.sales.find((s) => s.pid === later.id);
  assert.equal(second.team, 0, 'his when his wave came up');
  assert.ok(second.order && second.price <= Math.round(later.$ * 1.25));
  assert.ok(second.wave > 1);
});
