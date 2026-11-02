import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const P = require('../prospect/engine.js');
const read = path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const nba = read('celtics/data.json');
let stats = {};
try { stats = read('prospect/stats.json'); } catch { /* no stats yet: the pool falls back to ratings */ }
const CEILING = nba.cba.a1;

function draftAll(teams, seed) {
  const pool = P.buildPool(nba, stats);
  const prospects = P.buildProspects(nba);
  const league = P.newLeague({ ceiling: CEILING, seed, settings: { teams }, yourSlot: 0 });
  const r = P.rng(seed);
  while (league.phase === 'nba') {
    const p = P.autoPick(league, pool, r);
    assert.ok(p, `no legal pick at ${JSON.stringify(P.onClock(league))}`);
    assert.equal(P.draftNba(league, pool, p.id, true).ok, true);
  }
  while (league.phase === 'college') {
    const p = P.autoPickCollege(league, prospects, r);
    assert.equal(P.draftCollege(league, prospects, p.id, true).ok, true);
  }
  return { league, pool, prospects };
}

test('the pool has real salaries and nine-category ranks', () => {
  const pool = P.buildPool(nba, stats);
  assert.ok(pool.length > 400);
  assert.ok(pool.every(p => p.sal > 0 && p.rank >= 1));
  assert.equal(new Set(pool.map(p => p.rank)).size, pool.length);
});

for (const teams of [8, 10, 12]) {
  test(`a ${teams}-team draft fills every roster under the ceiling`, () => {
    for (const seed of [1, 2, 3]) {
      const { league, pool } = draftAll(teams, seed * 97 + teams);
      const byId = Object.fromEntries(pool.map(p => [p.id, p]));
      assert.equal(league.phase, 'league');
      for (const t of league.teams) {
        assert.equal(P.active(t).length, 12);
        assert.equal(t.prospects.length, 2);
        assert.ok(P.payroll(t, byId) <= CEILING, `${t.name} at ${P.payroll(t, byId)}`);
      }
      const ids = league.teams.flatMap(t => P.active(t));
      assert.equal(new Set(ids).size, ids.length);
    }
  });
}

test('bots spend most of the room they have', () => {
  const { league, pool } = draftAll(10, 4242);
  const byId = Object.fromEntries(pool.map(p => [p.id, p]));
  const pays = league.teams.map(t => P.payroll(t, byId));
  const avg = pays.reduce((a, b) => a + b, 0) / pays.length;
  assert.ok(avg > CEILING * 0.8, `average payroll ${avg}`);
});

test('the reserve blocks a pick that would strand open spots', () => {
  const pool = P.buildPool(nba, stats);
  const league = P.newLeague({ ceiling: CEILING, seed: 5, yourSlot: 0 });
  const byId = Object.fromEntries(pool.map(p => [p.id, p]));
  const pricey = pool.slice().sort((a, b) => b.sal - a.sal);
  // Give team 0 three huge contracts by hand, then ask for a fourth.
  for (const p of pricey.slice(0, 3)) league.teams[0].hist.push({ pid: p.id, from: 1, to: null });
  const ctx = P.context(league, pool);
  const room = CEILING - P.payroll(league.teams[0], byId);
  const target = pool.find(p => p.sal < room && p.sal > room - 8e6 && !pricey.slice(0, 3).includes(p));
  const c = P.check(league, league.teams[0], target, ctx);
  assert.equal(c.ok, false);
  assert.match(c.why, /held for 8 open spots/);
  assert.ok(P.payroll(league.teams[0], byId) + target.sal <= CEILING, 'the fourth fits on its own; only the reserve stops it');
});

test('snake order and a full schedule', () => {
  assert.deepEqual(P.snake(3, 3), [0, 1, 2, 2, 1, 0, 0, 1, 2]);
  const league = P.newLeague({ ceiling: CEILING, seed: 9, settings: { teams: 10 } });
  assert.equal(league.schedule.length, 21);
  for (const wk of league.schedule) {
    assert.equal(wk.length, 5);
    assert.equal(new Set(wk.flat()).size, 10);
  }
});

test('nine-category comparison, with turnovers counting low', () => {
  const a = { fg: 0.48, ft: 0.8, tpm: 40, pts: 400, reb: 150, ast: 90, stl: 30, blk: 20, tov: 50 };
  const b = { fg: 0.47, ft: 0.8, tpm: 41, pts: 390, reb: 150, ast: 80, stl: 31, blk: 19, tov: 40 };
  const c = P.compare(a, b);
  assert.deepEqual([c.w, c.l, c.t], [4, 3, 2]);
  assert.equal(c.cats.find(x => x.cat.k === 'tov').out, 'l');
});

test('Game Score matches the formula', () => {
  // 30 pts, 11-20 FG, 6-8 FT, 2 oreb of 10 reb, 5 ast, 2 stl, 1 blk, 3 pf, 4 tov
  const l = [1, 35, 11, 20, 6, 8, 2, 30, 10, 2, 5, 2, 1, 4, 3];
  const want = 30 + 0.4 * 11 - 0.7 * 20 - 0.4 * 2 + 0.7 * 2 + 0.3 * 8 + 2 + 0.7 * 5 + 0.7 * 1 - 0.4 * 3 - 4;
  assert.ok(Math.abs(P.gameScore(l) - want) < 1e-9);
});

test('waivers: high bid wins, salary must fit, FAAB is spent, adds count next week', () => {
  const { league, pool } = draftAll(10, 77);
  const ctx = P.context(league, pool);
  const fa = ctx.available.slice().sort((a, b) => a.sal - b.sal)[0];
  const t1 = league.teams[1], t2 = league.teams[2];
  const d1 = P.active(t1)[11], d2 = P.active(t2)[11];
  assert.equal(P.placeBid(league, pool, 1, fa.id, d1, 7, 3).ok, true);
  assert.equal(P.placeBid(league, pool, 2, fa.id, d2, 9, 3).ok, true);
  assert.equal(P.placeBid(league, pool, 1, fa.id, d1, 0, 3).ok, false, 'one dollar minimum');
  assert.equal(P.placeBid(league, pool, 1, fa.id, d1, 60, 3).ok, false, 'can not bid past the budget');
  const res = P.runWaivers(league, pool, 3);
  assert.equal(res.filter(r => r.ok).length, 1);
  assert.equal(res.find(r => r.ok).team, 2);
  assert.equal(t2.faab, 41);
  assert.equal(t1.faab, 50);
  assert.ok(P.rosterInWeek(t2, 3).includes(d2) && !P.rosterInWeek(t2, 3).includes(fa.id));
  assert.ok(P.rosterInWeek(t2, 4).includes(fa.id) && !P.rosterInWeek(t2, 4).includes(d2));
});

test('a released player can not be claimed straight back by his old team', () => {
  const { league, pool } = draftAll(10, 31);
  const t = league.teams[3];
  const pid = P.active(t)[0];
  assert.equal(P.dropPlayer(league, pool, 3, pid, 2).ok, true);
  assert.equal(P.placeBid(league, pool, 3, pid, null, 5, 2).ok, false);
});

test('weekly matchups and standings run on the real box scores', () => {
  const { league } = draftAll(10, 11);
  const weeks = Object.keys(stats.wk || {}).map(Number);
  if (!weeks.length) return;
  const ms = P.matchups(league, weeks[0], stats.wk);
  assert.equal(ms.length, 5);
  assert.ok(ms.every(m => m.A.t.gp > 0 && m.cmp.w + m.cmp.l + m.cmp.t === 9));
  const st = P.standings(league, Math.max(...weeks), stats.wk);
  assert.equal(st.reduce((s, r) => s + r.w, 0), st.reduce((s, r) => s + r.l, 0));
});
