import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const H = require('../hardcap/engine.js');
const P = require('../hardcap/practice.js');
const nba = JSON.parse(readFileSync(new URL('../celtics/data.json', import.meta.url)));
const pool = H.buildPool(nba, {});
const by = Object.fromEntries(pool.map(p => [p.id, p]));
const now = Date.UTC(2026, 10, 4, 15);
const best = L => {
  const ctx = H.context(L, pool);
  return ctx.available.find(p => H.check(L, L.teams[0], p, ctx, { reserve: true }).ok);
};

test('practice leaves the visitor on the clock even after a long absence', () => {
  const L = P.create(nba.cba, now, 91);
  assert.equal(H.onClock(L, now).team, 0);
  assert.equal(P.advance(L, pool, now + 365 * 864e5), 0);
  assert.equal(L.nba.picks.length, 0);
});

test('a visitor pick advances only the other seats and returns the next turn', () => {
  const L = P.create(nba.cba, now, 92);
  const p = best(L);
  assert.equal(P.pick(L, pool, p.id, now).ok, true);
  assert.equal(L.nba.picks[0].pid, p.id);
  assert.ok(L.nba.picks.slice(1).every(p => p.team !== 0));
  assert.equal(H.onClock(L, now).team, 0);
});

test('invalid and duplicate picks leave the saved draft unchanged', () => {
  const L = P.create(nba.cba, now, 93);
  const before = JSON.stringify(L);
  assert.equal(P.pick(L, pool, 'not-a-player', now).ok, false);
  assert.equal(JSON.stringify(L), before);
  const id = best(L).id;
  P.pick(L, pool, id, now);
  const drafted = JSON.stringify(L);
  assert.equal(P.pick(L, pool, id, now).ok, false);
  assert.equal(JSON.stringify(L), drafted);
});

test('a saved and resumed practice can complete with unique, affordable rosters', () => {
  let L = P.create(nba.cba, now, 94);
  for (let i = 0; i < 12; i++) {
    const p = best(L); assert.ok(p, 'an affordable player is available');
    assert.equal(P.pick(L, pool, p.id, now + i).ok, true);
    L = JSON.parse(JSON.stringify(L));
  }
  assert.equal(L.phase, 'prospects');
  assert.equal(H.active(L.teams[0]).length, 12);
  const ids = L.teams.flatMap(H.active);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of L.teams) assert.ok(H.payroll(t, by) <= H.ceilingOf(L, t));
});
