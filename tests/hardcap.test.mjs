import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const H = require('../hardcap/engine.js');
const read = path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const nba = read('celtics/data.json');
let stats = {};
try { stats = read('hardcap/stats.json'); } catch { /* no stats yet: the pool falls back to ratings */ }
const pool = H.buildPool(nba, stats);
const prospects = H.buildProspects(nba);
const byId = Object.fromEntries(pool.map(p => [p.id, p]));
const T0 = Date.UTC(2026, 10, 2, 15, 0, 0);

function drafted(teams = 10, seed = 3, opts = {}) {
  const L = H.newLeague({ cba: nba.cba, teams, seed, now: T0, settings: opts.settings });
  if (opts.claim) for (const i of opts.claim) L.teams[i].owner = 'Manager ' + i;
  if (opts.tiers) opts.tiers.forEach((k, i) => (L.teams[i].tier = k));
  H.startDraft(L, T0);
  let now = T0;
  while (L.phase === 'nba') { now += 61000; H.catchUp(L, pool, now); }
  return { L, now };
}

test('pool: real salaries, no two-way deals, ranks and HC Score', () => {
  assert.ok(pool.length > 400);
  assert.ok(pool.every(p => p.sal > 0 && p.rank >= 1 && Number.isFinite(p.hc)));
  assert.ok(!pool.some(p => nba.players.find(x => x.id === p.id).two));
});

for (const teams of [8, 10, 12]) {
  test(`${teams} teams: bots and expired clocks fill every roster under each team's line`, () => {
    const { L } = drafted(teams, teams * 7, { claim: [0, 1], tiers: [0, 1, 2, 3] });
    assert.equal(L.phase, 'prospects');
    for (const t of L.teams) {
      assert.equal(H.active(t).length, 12);
      assert.ok(H.payroll(t, byId) <= H.ceilingOf(L, t), `${t.name} ${H.payroll(t, byId)}`);
    }
    const ids = L.teams.flatMap(t => H.active(t));
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(L.nba.picks.filter(p => p.team === 0).every(p => p.auto), 'an absent manager gets autopicks');
  });
}

test('live clock: a bot waits its delay, a manager gets the full clock, picks are stamped when they expire', () => {
  const L = H.newLeague({ cba: nba.cba, teams: 4, seed: 1, now: T0 });
  H.setOrder(L, [0, 1, 2, 3]);
  L.teams[1].owner = 'Me';
  H.startDraft(L, T0);
  assert.equal(H.catchUp(L, pool, T0 + 1000), 0);
  assert.equal(H.catchUp(L, pool, T0 + 1500), 1);           // bot 0 at 1.5s
  assert.equal(H.catchUp(L, pool, T0 + 30000), 0);          // my clock is running
  assert.equal(H.catchUp(L, pool, T0 + 1500 + 60000), 1);   // mine expires
  assert.equal(H.catchUp(L, pool, T0 + 1500 + 60000 + 3000), 2); // then bots 2 and 3, 1.5s apart
  assert.equal(L.nba.picks[1].at, T0 + 1500 + 60000);
  assert.equal(L.nba.picks[1].auto, true);
});

test('the queue decides an autopick when it can, and pause stops the clock', () => {
  const L = H.newLeague({ cba: nba.cba, teams: 4, seed: 2, now: T0 });
  H.setOrder(L, [0, 1, 2, 3]);
  L.teams[0].owner = 'Me';
  const want = pool.find(p => p.sal < 9e6 && p.rank > 150);
  L.teams[0].queue = [want.id];
  H.startDraft(L, T0);
  H.pauseDraft(L, T0 + 10000, true);
  assert.equal(H.catchUp(L, pool, T0 + 999999), 0);
  H.pauseDraft(L, T0 + 999999, false);
  assert.equal(H.onClock(L, T0 + 999999).left, 50000);
  H.catchUp(L, pool, T0 + 999999 + 50000);
  assert.equal(L.nba.picks[0].pid, want.id);
});

test('slow drafts use hours, and a manager can pick on time', () => {
  const L = H.newLeague({ cba: nba.cba, teams: 4, seed: 4, now: T0, settings: { draftMode: 'slow', slowHours: 8 } });
  H.setOrder(L, [0, 1, 2, 3]);
  L.teams.forEach(t => (t.owner = 'm'));
  H.startDraft(L, T0);
  assert.equal(H.catchUp(L, pool, T0 + 7 * H.HOUR), 0);
  const p = pool.find(x => x.rank === 1);
  assert.equal(H.draftPick(L, pool, 1, p.id, T0 + 3600e3).ok, false, 'not your pick');
  assert.equal(H.draftPick(L, pool, 0, p.id, T0 + 3600e3).ok, true);
  assert.equal(H.onClock(L, T0 + 3600e3).left, 8 * H.HOUR);
});

test('the reserve blocks a pick that would strand open spots', () => {
  const L = H.newLeague({ cba: nba.cba, teams: 10, seed: 5, now: T0 });
  L.teams[0].tier = 2;
  const pricey = pool.slice().sort((a, b) => b.sal - a.sal);
  for (const p of pricey.slice(0, 3)) L.teams[0].hist.push({ pid: p.id, from: 1, to: null });
  const ctx = H.context(L, pool);
  const room = H.ceilingOf(L, L.teams[0]) - H.payroll(L.teams[0], byId);
  const target = pool.find(p => p.sal < room && p.sal > room - 8e6 && !pricey.slice(0, 3).includes(p));
  const c = H.check(L, L.teams[0], target, ctx, { reserve: true });
  assert.equal(c.ok, false);
  assert.match(c.why, /held for 8 open spots/);
  assert.equal(H.check(L, L.teams[0], target, ctx).ok, true, 'in-season moves skip the reserve');
});

test('tiers only go up, raise the line, and add to the pot', () => {
  const L = H.newLeague({ cba: nba.cba, teams: 10, seed: 6, now: T0 });
  assert.equal(H.ceilingOf(L, L.teams[3]), nba.cba.cap);
  assert.equal(H.pot(L), 1000);
  assert.equal(H.upgradeTier(L, 3, 2, T0, 1).ok, true);
  assert.equal(H.ceilingOf(L, L.teams[3]), nba.cba.a1);
  assert.equal(H.owed(L, L.teams[3]), 150);
  assert.equal(H.upgradeTier(L, 3, 1, T0, 1).ok, false, 'no dipping back under');
  L.phase = 'league';
  assert.equal(H.upgradeTier(L, 3, 3, T0, 22).ok, false, 'closed after the deadline');
});

test('prospect auction: blind bids out of season FAAB, two spots, ties to the later first-round pick', () => {
  const { L, now } = drafted(10, 9, { claim: [0, 1, 2] });
  const [a, b, c] = prospects.slice(0, 3).map(p => p.id);
  const sealed = { 0: [{ add: a, amt: 20 }, { add: b, amt: 10 }, { add: c, amt: 5 }], 1: [{ add: a, amt: 20 }], 2: [{ add: b, amt: 60 }] };
  const tie = L.nba.round1.indexOf(0) > L.nba.round1.indexOf(1) ? 0 : 1;
  H.resolveAuction(L, prospects, sealed, now);
  assert.equal(L.phase, 'league');
  assert.ok(L.teams[tie].prospects.includes(a));
  assert.ok(!L.teams[2].prospects.includes(b), 'a bid over the budget loses');
  const t0 = L.teams[0];
  assert.ok(t0.prospects.length <= 2);
  assert.equal(t0.faab, 50 - L.auction.results.filter(r => r.team === 0 && r.won).reduce((s, r) => s + r.amt, 0));
  assert.ok(L.due.waiver);
});

test('waivers: high bid wins, salary must fit, FAAB is spent, adds count next week', () => {
  const { L, now } = drafted(10, 77, { claim: [1, 2] });
  H.resolveAuction(L, prospects, {}, now);
  const ctx = H.context(L, pool);
  const fa = ctx.available.slice().sort((a, b) => a.sal - b.sal)[0];
  const d1 = H.active(L.teams[1])[11], d2 = H.active(L.teams[2])[11];
  assert.equal(H.bidCheck(L, pool, prospects, 1, { add: fa.id, drop: d1, amt: 0 }).ok, false);
  assert.equal(H.bidCheck(L, pool, prospects, 1, { add: fa.id, drop: d1, amt: 80 }).ok, false);
  const res = H.runWaivers(L, pool, prospects, { 1: [{ add: fa.id, drop: d1, amt: 7 }], 2: [{ add: fa.id, drop: d2, amt: 9 }] }, 3, null, now);
  const mine = res.filter(r => r.add === fa.id);
  assert.equal(mine.find(r => r.ok).team, 2);
  const t2 = L.teams[2];
  assert.ok(H.rosterInWeek(t2, 3).includes(d2) && !H.rosterInWeek(t2, 3).includes(fa.id));
  assert.ok(H.rosterInWeek(t2, 4).includes(fa.id) && !H.rosterInWeek(t2, 4).includes(d2));
});

test('trades: both sides must fit their own lines; accepted deals move players next week', () => {
  const { L, now } = drafted(10, 21);
  H.resolveAuction(L, prospects, {}, now);
  const A = L.teams[0], B = L.teams[1];
  const a = H.active(A).map(id => byId[id]).sort((x, y) => x.sal - y.sal);
  const b = H.active(B).map(id => byId[id]).sort((x, y) => x.sal - y.sal);
  // Cheap for expensive breaks the receiving team's line.
  const bad = H.proposeTrade(L, pool, 0, 1, [a[0].id], [b[11].id], now);
  if (H.payroll(A, byId) - a[0].sal + b[11].sal > H.ceilingOf(L, A)) assert.equal(bad.ok, false);
  const good = H.proposeTrade(L, pool, 0, 1, [a[1].id], [b[1].id], now + 1);
  if (good.ok) {
    assert.equal(H.respondTrade(L, pool, good.trade.id, true, 5, now + 2).ok, true);
    assert.ok(H.rosterInWeek(B, 6).includes(a[1].id) && H.rosterInWeek(A, 5).includes(a[1].id));
  }
});

test('nine-category comparison, turnovers low; Game Score formula', () => {
  const a = { fg: 0.48, ft: 0.8, tpm: 40, pts: 400, reb: 150, ast: 90, stl: 30, blk: 20, tov: 50 };
  const b = { fg: 0.47, ft: 0.8, tpm: 41, pts: 390, reb: 150, ast: 80, stl: 31, blk: 19, tov: 40 };
  const c = H.compare(a, b);
  assert.deepEqual([c.w, c.l, c.t], [4, 3, 2]);
  const l = [1, 35, 11, 20, 6, 8, 2, 30, 10, 2, 5, 2, 1, 4, 3];
  const want = 30 + 0.4 * 11 - 0.7 * 20 - 0.4 * 2 + 0.7 * 2 + 0.3 * 8 + 2 + 0.7 * 5 + 0.7 * 1 - 0.4 * 3 - 4;
  assert.ok(Math.abs(H.gameScore(l) - want) < 1e-9);
});

test('weekly matchups and standings run on the real box scores', () => {
  const { L } = drafted(10, 11);
  const weeks = Object.keys(stats.wk || {}).map(Number);
  if (!weeks.length) return;
  const ms = H.matchups(L, weeks[0], stats.wk, byId);
  assert.ok(ms.every(m => m.A.t.gp > 0 && m.cmp.w + m.cmp.l + m.cmp.t === 9));
  assert.ok(ms.every(m => m.A.per.filter(x => x.starter).length === 9));
  const st = H.standings(L, Math.max(...weeks), stats.wk, byId);
  assert.equal(st.reduce((s, r) => s + r.w, 0), st.reduce((s, r) => s + r.l, 0));
});

test('waivers run Monday 3 a.m. Eastern', () => {
  assert.equal(H.nextWaiverRun(Date.UTC(2026, 10, 2, 15)), '2026-11-09T08:00:00.000Z');
  assert.equal(H.nextWaiverRun(Date.UTC(2026, 10, 1, 20)), '2026-11-02T08:00:00.000Z');
});

test('lineups: nine slots filled by eligible players, only starters score, locks at the first tip', () => {
  const { L, now } = drafted(10, 13);
  H.resolveAuction(L, prospects, {}, now);
  const t = L.teams[0];
  const lu = H.lineupFor(L, t, 3, byId);
  assert.equal(lu.length, 9);
  lu.forEach((id, i) => id && assert.ok(H.eligible(byId[id], H.SLOTS[i]), `${byId[id].n} at ${H.SLOTS[i]}`));
  const swapped = lu.slice(); const bench = H.rosterInWeek(t, 4).find(id => !lu.includes(id));
  swapped[7] = bench;
  const opener = '2026-10-20';
  assert.equal(H.setLineup(L, pool, 0, 3, swapped, Date.UTC(2026, 10, 3), opener).ok, false, 'week 3 locked Monday night');
  assert.equal(H.setLineup(L, pool, 0, 5, swapped, Date.UTC(2026, 10, 3), opener).ok, true);
  const bad = swapped.slice(); bad[0] = H.rosterInWeek(t, 5).find(id => !H.eligible(byId[id], 'PG'));
  assert.equal(H.setLineup(L, pool, 0, 5, bad, Date.UTC(2026, 10, 3), opener).ok, false);
  assert.equal(H.lockTime(opener, 3), Date.UTC(2026, 10, 3, 0), 'Nov 2 is after daylight saving: 7 p.m. EST');
  assert.equal(H.lockTime(opener, 1), Date.UTC(2026, 9, 20, 23), 'opening night, still EDT');
});

test('IR: only Out players, off the books, healthy IR blocks moves, activation needs room', () => {
  const { L, now } = drafted(10, 17);
  H.resolveAuction(L, prospects, {}, now);
  L.teams[0].owner = 'Me';
  const t = L.teams[0], star = H.active(t).map(id => byId[id]).sort((a, b) => b.sal - a.sal)[0];
  const before = H.payroll(t, byId);
  assert.equal(H.moveToIR(L, pool, 0, star.id, {}, now, 3).ok, false, 'healthy');
  const inj = { [star.id]: ['Out', 'knee'] };
  assert.equal(H.moveToIR(L, pool, 0, star.id, inj, now, 3).ok, true);
  assert.equal(H.payroll(t, byId), before - star.sal);
  assert.equal(H.active(t).length, 11);
  const fa = H.context(L, pool).available.sort((a, b) => b.z - a.z).find(p => p.sal < star.sal);
  assert.equal(H.bidCheck(L, pool, prospects, 0, { add: fa.id, amt: 1 }, inj).ok, true);
  assert.equal(H.bidCheck(L, pool, prospects, 0, { add: fa.id, amt: 1 }, {}).ok, false, 'he got healthy');
  t.hist.push({ pid: fa.id, from: 4, to: null });
  assert.equal(H.activateIR(L, pool, 0, star.id, null, now, 3).ok, false, 'roster full');
});

test('trades can carry FAAB, and the deadline closes them', () => {
  const { L, now } = drafted(10, 23);
  H.resolveAuction(L, prospects, {}, now);
  const A = L.teams[0], B = L.teams[1];
  const fa0 = A.faab, fb0 = B.faab;
  const r = H.proposeTrade(L, pool, 0, 1, [], [], now, 5, 0, 3);
  assert.equal(r.ok, true);
  assert.equal(H.respondTrade(L, pool, r.trade.id, true, 3, now).ok, true);
  assert.equal(A.faab, fa0 - 5); assert.equal(B.faab, fb0 + 5);
  assert.equal(H.proposeTrade(L, pool, 0, 1, [], [], now, 1, 0, 19).ok, false);
  assert.equal(H.proposeTrade(L, pool, 0, 1, [], [], now, 999, 0, 3).ok, false);
});

test('free agency years and restricted status', () => {
  const flagg = byId['cooper-flagg'], murray = byId['dejounte-murray'];
  if (flagg) assert.deepEqual(flagg.fa, { year: 2029, kind: 'RFA' });
  if (murray) assert.equal(murray.fa.kind, 'UFA');
  assert.ok(pool.every(p => p.dynRank >= 1));
});

test('playoffs: top four, semis then a final and a third-place game', () => {
  const { L, now } = drafted(10, 29);
  H.resolveAuction(L, prospects, {}, now);
  // Fake a full season: every team's real week 1 line repeated, so the bracket can resolve.
  const wk = {};
  for (let w = 1; w <= 23; w++) wk[w] = stats.wk ? stats.wk['1'] : {};
  if (!stats.wk) return;
  const b = H.bracket(L, wk, byId);
  assert.equal(b.seeds.length, 4);
  assert.deepEqual(new Set([b.semis[0].a, b.semis[0].b, b.semis[1].a, b.semis[1].b]), new Set(b.seeds));
  assert.ok(b.final && b.third && b.place.length === 3);
  assert.equal(new Set(b.place).size, 3);
  assert.equal(H.matchups(L, 22, wk, byId).length, 2);
  assert.equal(H.matchups(L, 23, wk, byId)[0].label, 'Final');
});

test('summer budgets: worst team gets the most, walk-away bonuses add on', () => {
  const L = H.newLeague({ cba: nba.cba, teams: 10, seed: 1, now: T0 });
  const order = [...Array(10).keys()];              // best to worst
  const b = H.summerBudgets(L, order, { 9: 1, 0: 2 });
  assert.equal(b[0], 50 + 20);
  assert.equal(b[9], 100 + 10);
  assert.ok(b[4] > b[3]);
});

test('commissioner veto puts everyone back within the window', () => {
  const { L, now } = drafted(10, 31);
  H.resolveAuction(L, prospects, {}, now);
  const A = L.teams[0], B = L.teams[1];
  const a = H.active(A)[5], b = H.active(B)[5];
  const r = H.proposeTrade(L, pool, 0, 1, [a], [b], now, 2, 0, 3);
  if (!r.ok) return;
  H.respondTrade(L, pool, r.trade.id, true, 3, now);
  const fa = A.faab;
  assert.equal(H.vetoTrade(L, pool, r.trade.id, now + 25 * H.HOUR).ok, false, 'too late');
  assert.equal(H.vetoTrade(L, pool, r.trade.id, now + H.HOUR).ok, true);
  assert.ok(H.active(A).includes(a) && H.active(B).includes(b));
  assert.ok(H.rosterInWeek(A, 4).includes(a) && !H.rosterInWeek(B, 4).includes(a));
  assert.equal(A.faab, fa + 2);
});
