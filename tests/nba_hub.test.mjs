// NBA hub and shared NBA library checks: node --test tests/nba_hub.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const read = p => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const opt = p => { try { return read(p); } catch { return null; } };
const Hub = require('../nba/hub.js');
const NC = require('../nba/lib/contracts.js');
const L = require('../nba/lib/league.js');
require('../nba/lib/season.js'); require('../nba/lib/offseason.js');
const Mo = require('../nba/lib/model.js');

const inputs = { data: read('celtics/data.json'), stats: opt('hardcap/stats.json') || {}, fixes: opt('hardcap/contracts.json'), live: opt('celtics/live.json'),
  board: opt('draft/nba.json') || {}, picks: read('nba/data/picks.json'), teams: opt('tools/draft_teams.json'),
  tpes: read('nba/data/tpes.json'), exceptions: read('nba/data/exceptions.json'), dead: read('nba/data/dead.json'), darko: opt('nba/data/darko.json'), taxhist: opt('nba/data/taxhist.json') };
const H = Hub.build(inputs, { sims: 300, futureSims: 100 });

test('shared library: name matching runs initials together', () => {
  assert.deepEqual(NC.nameKeys('a-j-green'), NC.nameKeys('aj-green'));
  assert.equal(NC.nameKeys('jaren-jackson-jr')[0], 'jaren-jackson');
});

test('shared library: the lottery draw keeps the worst three in the top 12 and draws everyone once', () => {
  const r = Mo.rng(5);
  const lot = Array.from({ length: 16 }, (_, k) => ({ code: 'T' + k, balls: k < 3 ? 2 : 3 }));
  for (let n = 0; n < 200; n++) {
    const order = L.lotteryDraw(lot, ['T0', 'T1', 'T2'], r);
    assert.equal(new Set(order).size, 16);
    for (const c of ['T0', 'T1', 'T2']) assert.ok(order.indexOf(c) <= 11);
  }
});

test('league: 30 teams, real records, standard rosters of 12 to 16', () => {
  assert.equal(H.codes.length, 30);
  for (const c of H.codes) {
    const n = H.roster0(c).length;
    assert.ok(n >= 12 && n <= 16, c + ' has ' + n);
  }
});

test('season sims: odds add up', () => {
  const s = H.standings(0);
  const sum = k => s.reduce((a, r) => a + r[k], 0);
  assert.ok(Math.abs(sum('title') - 1) < 1e-9);
  assert.ok(Math.abs(sum('playoffs') - 16) < 1e-6);
  assert.ok(Math.abs(sum('no1') - 1) < 1e-9);
  assert.ok(Math.abs(sum('projW') - 41 * 30) < 1);
  for (const r of s) assert.ok(r.avgPick >= 1 && r.avgPick <= 30);
});

test('year slider: every later season fields at least 13 and projected wins stay sane', () => {
  for (let i = 1; i < Hub.YEARS; i++) {
    const s = H.standings(i);
    assert.ok(Math.abs(s.reduce((a, r) => a + r.projW, 0) - 1230) < 15);
    for (const c of H.codes) assert.ok(H.rosterAt(c, i).length >= 13);
  }
});

test('re-signing a player keeps him on the roster after his deal ends', () => {
  const p = H.faClass().find(x => x.kind === 'UFA' && !x.keep).p;
  assert.ok(!H.rosterAt(p.t, 1).some(x => x.p.id === p.id));
  H.keep[p.id] = true; H.reset();
  assert.ok(H.rosterAt(p.t, 1).some(x => x.p.id === p.id && x.how === 're-signed'));
  delete H.keep[p.id]; H.reset();
});

test('surplus: value minus salary, discounted; the market view never pays past the max', () => {
  const p = H.players().sort((a, b) => H.salary(b, 0) - H.salary(a, 0))[0];
  const s = H.surplus(p, 'prod');
  assert.ok(s.rows.length >= 1);
  for (const r of s.rows) assert.ok(Math.abs(r.surplus - (r.value - r.sal)) < 1);
  const m = H.surplus(p, 'market');
  for (const r of m.rows) assert.ok(r.value <= H.CBA.maxSal(p.yos + r.j, r.j) * (r.part || 1) + 1);
});

test('picks: earlier slots are worth more, and protection only lowers a pick', () => {
  const c = inputs.picks.curve;
  for (let k = 1; k < 60; k++) assert.ok(c[k] <= c[k - 1]);
  const prot = H.W.picks.find(pk => pk.prot && pk.y === 2027);
  if (prot) {
    const free = Object.assign({}, prot, { prot: null, id: prot.id + '-x' });
    assert.ok(H.pickValue(prot, 'prod') <= H.pickValue(free, 'prod') + 1);
  }
});

test('trades: matching rules apply and value moves both ways', () => {
  const tr = { teams: ['BOS', 'UTA'], moves: [{ kind: 'k', id: '2033-2-BOS', from: 'BOS', to: 'UTA' }, { kind: 'k', id: '2033-2-UTA', from: 'UTA', to: 'BOS' }] };
  const chk = H.checkTrade(tr);
  assert.ok(chk.teams.BOS && chk.teams.UTA);
  const s = H.tradeSummary(tr);
  assert.ok(Math.abs(s.BOS.prod + s.UTA.prod) < 1);
  const three = H.checkTrade({ teams: ['BOS', 'UTA', 'MIL'], moves: [{ kind: 'k', id: '2033-2-BOS', from: 'BOS', to: 'UTA' }, { kind: 'k', id: '2033-2-UTA', from: 'UTA', to: 'MIL' }, { kind: 'k', id: '2033-2-MIL', from: 'MIL', to: 'BOS' }] });
  assert.equal(Object.keys(three.teams).length, 3);
});

test('production is priced at the open market: role players the max does not hold down produce about what they would get', () => {
  let v = 0, m = 0;
  for (const p of H.players()) {
    const mk = H.marketAt(p, 0);
    if (!(mk > 0) || mk > 0.25 * 165e6 || H.mpgAt(p, 0) < 15) continue;
    v += H.prodAt(p, 0); m += mk;
  }
  assert.ok(Math.abs(v / m - 1) < 0.1, 'production/market ' + (v / m).toFixed(3));
});

test('payroll pricing still scales the league to what it is paid', () => {
  const Hp = Hub.build(inputs, { sims: 50, futureSims: 20, anchor: 'payroll' });
  let v = 0, pay = 0;
  for (const p of Hp.players()) { v += Math.max(0, Hp.prodAt(p, 0)); pay += Hp.salary(p, 0); }
  assert.ok(Math.abs(v / pay - 1) < 0.08, 'value/pay ' + (v / pay).toFixed(3));
});

test('better-of picks: one owner per pick, and the best goes to the first team', () => {
  for (const g of H.W.pickGroups) {
    const owners = g.picks.map(id => H.W.picks.find(x => x.id === id).owner);
    assert.ok(owners.includes(g.to[0]) || Object.keys(g.bar || {}).length, g.id);
  }
  const lac = H.W.picks.find(x => x.id === '2028-1-LAC'), phi = H.W.picks.find(x => x.id === '2028-1-PHI');
  if (lac && phi && lac.group) assert.equal([lac.owner, phi.owner].filter(o => o === 'BOS').length, 1);
});

test('lineups: later seasons never start two players at the same spot', () => {
  for (const c of H.codes) {
    const lu = H.lineup(c, 2);
    assert.equal(new Set(lu.slots).size, lu.slots.length);
    assert.ok(Object.values(lu.mins).reduce((a, b) => a + b, 0) <= 241);
  }
  const now = H.lineup('BOS', 0);
  assert.ok(Math.abs(Object.values(now.mins).reduce((a, b) => a + b, 0) - 240) < 1 || Object.values(now.mins).some(m => m >= 38));
});

test('team tools: real trade exceptions and hard caps load', () => {
  const t = H.tools('BOS', 0);
  assert.ok(t.tools.some(x => x.tpe));
  assert.ok(['a1', 'a2', undefined].includes(t.hard));
  for (const c of H.codes) assert.ok(H.tools(c, 0).tools.length >= 1);
});

test('free agents by summer', () => {
  for (let i = 1; i < Hub.YEARS; i++) assert.ok(H.faClass(i).every(x => H.lastYear(x.p) === i - 1));
});

test('cash moves count against the cash limit', () => {
  const big = H.checkTrade({ teams: ['BOS', 'UTA'], moves: [{ kind: 'c', id: '99000000', amt: 99e6, from: 'BOS', to: 'UTA' }, { kind: 'k', id: '2033-2-UTA', from: 'UTA', to: 'BOS' }] });
  assert.ok(!big.teams.BOS.ok);
});

test('valuation: stars outrank cheap role players, and the star premium setting moves them', () => {
  const rank = n => H.valueBoard('prod').findIndex(x => x.p.n === n);
  const star = H.valueBoard('prod')[0];
  assert.ok(H.rating(star.p, 0) > 3, 'top value is a star: ' + star.p.n);
  const before = H.surplus(star.p, 'prod').pv;
  H.set('convex', 1.0);
  assert.ok(H.surplus(star.p, 'prod').pv < before);
  H.set('convex', 1.5);
});

test('dead money counts in payroll; cap holds lower next summer\'s room', () => {
  assert.ok(H.dead('MIL', 0) > 0);
  const c = H.capOutlook(1);
  for (const t of c) assert.ok(t.roomHolds <= t.room + 1);
});

test('trade finder only returns legal deals', () => {
  const p = H.players().sort((a, b) => H.salary(b, 0) - H.salary(a, 0))[40];
  for (const r of H.findTrades(p.id)) assert.ok(H.checkTrade({ teams: [p.t, r.team], moves: r.moves }).ok);
});

test('live DARKO replaces the June DARKO half of a rating', () => {
  const june = { 'Jayson Tatum': [4.1, 0.2] };
  const base = Hub.build(Object.assign({}, inputs, { darko: null }), { sims: 20, futureSims: 10 });
  const live = Hub.build(Object.assign({}, inputs, { darko: { through: '2026-11-08', p: [['Jayson Tatum', 1628369, 5.1, 1.2, 34, 9]], june } }), { sims: 20, futureSims: 10 });
  const a = base.findPlayer('jayson-tatum'), b = live.findPlayer('jayson-tatum');
  assert.ok(a && b);
  assert.equal(b.darko, 6.3);
  assert.ok(b.o > a.o && b.d > a.d, 'a better DARKO than June raises both ends');
  assert.equal(live.darkoThrough, '2026-11-08');
});

test('repeater clock: Boston ducks 2026-27 and gets three standard-rate tax seasons', () => {
  const R = H.repeaterClock('BOS', { 0: false });
  assert.equal(R.n0, 3);
  assert.equal(R.nowRep, true);
  assert.equal(R.start, 1);
  assert.equal(R.run, 3);
  const paidNow = H.repeaterClock('BOS', { 0: true });
  assert.ok(paidNow.start > 1, 'paying this season pushes the reset back');
});

test('a declined team option elsewhere does not count against the new team', () => {
  const p = H.findPlayer('devin-carter');
  if (p) assert.equal(H.salary(p, 0), 0);
  assert.ok(H.payroll('BOS', 0) < 200428000, 'Boston is under the 2026-27 tax line');
});
