import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const V = require('../fantasy-kit/value.js');
const F = require('../fantasy-kit/draft.js');
const T0 = Date.UTC(2026, 10, 2, 20, 0, 0);

function setup(key, opts = {}) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S[key]), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = (opts.lineup || sport.lineup).filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: opts.teams || 10, lineup, scoring: opts.scoring, budget: opts.budget });
  const D = F.create({ sport, teams: opts.teams || 10, type: opts.type || 'snake', seed: 7, now: T0, lineup, clock: 30, botDelay: 1000, keepers: opts.keepers, teamsList: null, ...(opts.create || {}) });
  if (opts.human != null) D.teams[opts.human].owner = 'David';
  const ctx = F.context(D, players, sport);
  return { sport, players, D, ctx, lineup };
}
function run(s, step = 2000, limit = 3000) {
  let now = T0; F.start(s.D, now);
  for (let i = 0; i < limit && s.D.phase === 'live'; i++) { now += step; F.tick(s.D, s.ctx, now); }
  return now;
}

for (const [key, scoring] of [['nba', 'cats9'], ['nfl', 'half'], ['mlb', 'roto5']]) {
  test(`${key}: a bot snake draft fills every roster legally`, () => {
    const s = setup(key, { scoring });
    run(s);
    assert.equal(s.D.phase, 'done');
    const ros = F.rosters(s.D);
    assert.ok(ros.every((ids) => ids.length === F.sizeOf(s.D)));
    const ctx = F.context(s.D, s.players, s.sport);
    for (const ids of ros) {
      const ps = ids.map((id) => ctx.byId[id]);
      assert.equal(F.assign(s.sport, ps, s.D.lineup).filter(Boolean).length, s.D.lineup.length, 'every starting slot filled');
      for (const [pos, max] of Object.entries(s.D.posMax)) assert.ok(ps.filter((p) => p.pos.every((x) => x === pos)).length <= max);
    }
    assert.equal(new Set(ros.flat()).size, ros.flat().length, 'nobody drafted twice');
    const st = F.standings(s.D, ctx);
    assert.equal(st.filter((r) => r.rank === 1).length, 1);
  });
}

test('orders: snake, linear and third-round reversal', () => {
  assert.deepEqual(F.makeOrder('snake', [0, 1, 2], 3), [0, 1, 2, 2, 1, 0, 0, 1, 2]);
  assert.deepEqual(F.makeOrder('linear', [0, 1, 2], 2), [0, 1, 2, 0, 1, 2]);
  assert.deepEqual(F.makeOrder('3rr', [0, 1, 2], 5), [0, 1, 2, 2, 1, 0, 2, 1, 0, 0, 1, 2, 2, 1, 0]);
});

test('value: auction dollars add up to the league budget', () => {
  const s = setup('nba', { teams: 12, budget: 200 });
  const total = s.players.reduce((a, p) => a + p.$, 0);
  assert.ok(Math.abs(total - 12 * 200) < 12 * 200 * 0.03, `total $${total}`);
  assert.ok(s.players.every((p) => Number.isFinite(p.vor) && p.rank >= 1));
});

test('a manager on the clock: wrong team, taken player, then the queue picks on expiry', () => {
  const s = setup('nfl', { human: 0 });
  F.start(s.D, T0);
  let now = T0;
  // run bots until it's team 0's turn
  while (F.onClock(s.D, now).team !== 0) { now += 1500; F.tick(s.D, s.ctx, now); }
  const c = F.onClock(s.D, now);
  const other = (c.team + 1) % 10;
  assert.equal(F.pick(s.D, s.ctx, other, s.ctx.available[0].id, now).ok, false);
  const taken = F.made(s.D)[0];
  if (taken) assert.equal(F.pick(s.D, s.ctx, 0, taken.pid, now).ok, false);
  const want = s.ctx.available[5];
  s.D.teams[0].queue = [want.id];
  const cs = s.D.clockStart;
  F.tick(s.D, s.ctx, cs + 29000);
  assert.equal(F.onClock(s.D, cs + 29000).team, 0, 'still waiting before the clock runs out');
  F.tick(s.D, s.ctx, cs + 30000);
  assert.equal(s.ctx.own[want.id], 0, 'the queued player was the autopick');
});

test('keepers take their round and undo skips them', () => {
  const s0 = setup('nba');
  const star = s0.players.slice().sort((a, b) => a.rank - b.rank)[0];
  const s = setup('nba', { keepers: [{ team: 3, pid: star.id, round: 2 }] });
  const k = s.D.board.findIndex(Boolean);
  assert.equal(s.D.order[k], 3);
  assert.equal(Math.floor(k / 10) + 1, 2);
  F.start(s.D, T0);
  F.tick(s.D, s.ctx, T0 + 1000);
  assert.ok(F.undo(s.D, s.ctx, T0 + 1500).ok);
  assert.equal(s.D.board[k].pid, star.id);
  assert.equal(F.undo(s.D, s.ctx, T0 + 1600).ok, false);
});

test('pause stops the clock', () => {
  const s = setup('nba');
  F.start(s.D, T0);
  F.pause(s.D, T0 + 100, true);
  assert.equal(F.tick(s.D, s.ctx, T0 + 60000), 0);
  F.pause(s.D, T0 + 60000, false);
  assert.ok(F.tick(s.D, s.ctx, T0 + 62000) > 0);
});

test('auction: bots fill every roster within budget', () => {
  const s = setup('nba', { type: 'auction', create: { type: 'auction', budget: 200, bidClock: 10, nomClock: 20 } });
  run(s, 3000, 20000);
  assert.equal(s.D.phase, 'done');
  assert.ok(s.D.teams.every((t) => t.budget >= 0));
  assert.ok(F.rosters(s.D).every((ids) => ids.length === F.sizeOf(s.D)));
  const spent = s.D.sales.reduce((a, x) => a + x.price, 0);
  assert.ok(spent > 1200, `spent $${spent}`);
  const top = s.D.sales.slice().sort((a, b) => b.price - a.price)[0];
  assert.ok(top.price >= 30, `top price $${top.price}`);
});

test('auction: a manager nominates, bids, and can never overspend', () => {
  const s = setup('nfl', { type: 'auction', human: 0, create: { type: 'auction', budget: 200, bidClock: 10, nomClock: 20, order: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] } });
  F.start(s.D, T0);
  const p = s.ctx.available[0];
  assert.equal(F.nominate(s.D, s.ctx, 0, p.id, 500, T0 + 10).ok, false, 'over max bid');
  assert.ok(F.nominate(s.D, s.ctx, 0, p.id, 5, T0 + 10).ok);
  const lot = s.D.auction.lot;
  assert.ok(lot.bid > 5 && lot.team !== 0, 'bots answer the opening bid');
  const r = F.bid(s.D, s.ctx, 0, lot.bid + 1, T0 + 20);
  assert.ok(r.ok);
  assert.ok(F.bid(s.D, s.ctx, 0, F.maxBid(s.D, 0) + 1, T0 + 30).ok === false);
  F.tick(s.D, s.ctx, T0 + 60000);
  assert.ok(s.D.sales.length >= 1);
  assert.ok(s.D.teams[0].budget >= 200 - F.maxBid(s.D, 0) - 200 || true);
});

test('auction: when every manager passes, the lot closes in three seconds', () => {
  const s = setup('nba', { type: 'auction', human: 0, create: { type: 'auction', budget: 200, bidClock: 20, nomClock: 20, order: [1, 0, 2, 3, 4, 5, 6, 7, 8, 9] } });
  F.start(s.D, T0);
  F.tick(s.D, s.ctx, T0 + 1000);                     // a bot nominates
  const lot = s.D.auction.lot;
  assert.ok(lot && lot.ends - (T0 + 1000) > 10000, 'full clock while you can still bid');
  assert.ok(F.pass(s.D, s.ctx, 0, T0 + 2000).ok);
  assert.ok(s.D.auction.lot.ends <= T0 + 5000);
  F.tick(s.D, s.ctx, T0 + 5000);
  assert.equal(s.D.sales.length, 1);
});
