import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const V = require('../fantasy-kit/value.js');
const F = require('../fantasy-kit/draft.js');

function setup(type) {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 8, scoring: 'half' });
  const D = F.create({ sport, teams: 8, type, seed: 9, now: 0, scoring: 'half', clock: 60, botDelay: 0 });
  D.inPerson = true;
  F.start(D, 0);
  return { D, ctx: F.context(D, players, sport), players };
}

test('in person snake: no clock runs out and no bot picks; the commissioner enters each team\'s pick', () => {
  const { D, ctx } = setup('snake');
  assert.equal(F.tick(D, ctx, 10 * 864e5), 0, 'a day later, nothing moved on its own');
  const c = F.onClock(D, 10 * 864e5);
  assert.equal(c.index, 0); assert.equal(c.left, Infinity);
  const best = ctx.available[0];
  assert.equal(F.pick(D, ctx, c.team, best.id, 10 * 864e5).ok, true);
  assert.equal(D.board[0].team, c.team);
  assert.equal(F.onClock(D, 10 * 864e5).index, 1);
});

test('in person auction: a sale is recorded to any team at any price it can afford, and undo puts it back', () => {
  const { D, ctx } = setup('auction');
  assert.equal(F.tick(D, ctx, 864e5), 0);
  const p = ctx.available[3], t = 5, budget = D.teams[t].budget;
  assert.equal(F.record(D, ctx, t, p.id, 0, 1).ok, false, 'below the minimum');
  assert.equal(F.record(D, ctx, t, p.id, budget + 1, 1).ok, false, 'more than he can spend');
  assert.equal(F.record(D, ctx, t, p.id, 42, 1).ok, true);
  assert.equal(D.teams[t].budget, budget - 42);
  assert.equal(ctx.own[p.id], t);
  assert.deepEqual(D.sales.at(-1), { team: t, pid: p.id, price: 42, at: 1, by: t });
  assert.equal(F.record(D, ctx, 2, p.id, 50, 2).ok, false, 'already sold');
  assert.equal(F.undo(D, ctx, 3).ok, true);
  assert.equal(D.teams[t].budget, budget);
  assert.equal(ctx.own[p.id], undefined);
});

test('in person with some teams remote: a remote bot picks on its own, the room waits for the commissioner, a remote manager has no clock', () => {
  const { D, ctx } = setup('snake');
  const first = D.order[0], second = D.order[1], third = D.order[2];
  D.room = [first];                                  // only the first team is in the room; the others are remote bots
  assert.equal(F.tick(D, ctx, 864e5), 0, 'the room team is up: nothing moves');
  assert.equal(F.pick(D, ctx, first, ctx.available[0].id, 864e5).ok, true);
  assert.ok(F.tick(D, ctx, 864e5 + 60e3) >= 1, 'the remote bots pick');
  assert.equal(D.board[1].team, second); assert.equal(D.board[2].team, third);
  // a remote manager (not a bot): no clock runs out on him
  const D2 = setup('snake'), t0 = D2.D.order[0];
  D2.D.teams[t0].owner = 'Pat'; D2.D.room = [];
  assert.equal(F.onClock(D2.D, 0).left, Infinity);
  assert.equal(F.tick(D2.D, D2.ctx, 30 * 864e5), 0, 'a month later he still has the pick');
});
