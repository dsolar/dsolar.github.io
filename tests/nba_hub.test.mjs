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
  board: opt('draft/nba.json') || {}, picks: read('nba/data/picks.json'), teams: opt('tools/draft_teams.json') };
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
