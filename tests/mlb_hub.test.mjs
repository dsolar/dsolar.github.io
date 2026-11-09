// MLB hub model checks: node --test tests/mlb_hub.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const M = require('../mlb/model.js');
const S = 2027;
const cfg = Object.assign({}, M.DEFAULTS, { dpw: 10 });

test('aging: young players improve, older players decline faster', () => {
  assert.ok(M.agingDelta(23) > 0 && M.agingDelta(26) > 0);
  assert.equal(M.agingDelta(28), 0);
  assert.ok(M.agingDelta(34) < M.agingDelta(30) && M.agingDelta(30) < 0);
});

test('FV grades map up the scale, plus grades sit between', () => {
  assert.ok(M.fvWar('60') > M.fvWar('55') && M.fvWar('55') > M.fvWar('50'));
  assert.ok(M.fvWar('45+') > M.fvWar('45') && M.fvWar('45+') < M.fvWar('50'));
  assert.equal(M.fvWar('50', true), M.fvWar('50') / 2);
});

test('team control: pre-arb, arbitration, free agency from service time', () => {
  const p = { g: 'sl', st: 2.5 };
  assert.equal(M.controlStatus(p, 2027, S), 'pre');
  assert.equal(M.controlStatus(p, 2028, S), 'arb1');
  assert.equal(M.controlStatus(p, 2030, S), 'arb3');
  assert.equal(M.controlStatus(p, 2031, S), 'fa');
  const kid = { g: 'min', lvl: 'AA', eta: 2028 };
  assert.equal(M.controlStatus(kid, 2027, S), 'minors');
  assert.equal(M.controlStatus(kid, 2028, S), 'pre');
  assert.equal(M.controlStatus(kid, 2034, S), 'fa');
});

test('options: club options only when worth it, player options only when bad for the team', () => {
  const good = { g: 'sl', st: 8, age: 28, rate: 4, pjs: 'dc', pj: { war: 4 }, c: { type: 'Free Agent', yrs: [[2027, 20e6, 'G', 0], [2028, 10e6, 'CO', 2e6]] } };
  assert.equal(M.yearTerms(good, 2028, S, cfg).on, true);
  const bad = Object.assign({}, good, { rate: 0.5, pj: { war: 0.5 } });
  const t = M.yearTerms(bad, 2028, S, cfg);
  assert.equal(t.on, false);
  assert.equal(t.salary, 2); // the buyout
  const po = { g: 'sl', st: 8, age: 33, rate: 0.5, pjs: 'dc', pj: { war: 0.5 }, c: { type: 'Free Agent', yrs: [[2027, 20e6, 'G', 0], [2028, 20e6, 'PO', 0]] } };
  assert.equal(M.yearTerms(po, 2028, S, cfg).on, true, 'an overpaid player keeps his option');
});

test('surplus: a cheap good player is worth more than an expensive one', () => {
  const cheap = { g: 'sl', st: 1, age: 25, rate: 4, pjs: 'dc', pj: { war: 4 } };
  const pricey = { g: 'sl', st: 9, age: 31, rate: 4, pjs: 'dc', pj: { war: 4 }, c: { type: 'Free Agent', yrs: [[2027, 45e6, 'G'], [2028, 45e6, 'G'], [2029, 45e6, 'G']] } };
  const a = M.surplus(cheap, cfg, S), b = M.surplus(pricey, cfg, S);
  assert.ok(a.pv > 50, `cheap star ${a.pv}`);
  assert.ok(b.pv < 0, `overpaid star ${b.pv}`);
  assert.equal(a.rows.length, 5, 'one year of service leaves five seasons of control');
});

test('series odds: a coin flip is a coin flip, and longer series favor the better team', () => {
  assert.ok(Math.abs(M.seriesWin(0.5, 7) - 0.5) < 1e-9);
  assert.ok(M.seriesWin(0.55, 7) > M.seriesWin(0.55, 3));
});

test('playoff odds add up: 12 playoff teams, 6 division winners, 1 champion', () => {
  const teams = [];
  ['AL', 'NL'].forEach((lg) => ['East', 'Central', 'West'].forEach((div) => {
    for (let i = 0; i < 5; i++) teams.push({ abbr: lg + div + i, lg, div, wins: 70 + i * 5 });
  }));
  const o = M.simulate(teams, 2000, 1);
  const sum = (k) => Object.values(o).reduce((s, x) => s + x[k], 0);
  assert.ok(Math.abs(sum('playoff') - 12) < 1e-9);
  assert.ok(Math.abs(sum('div') - 6) < 1e-9);
  assert.ok(Math.abs(sum('ws') - 1) < 1e-9);
  assert.ok(o.ALEast4.playoff > o.ALEast0.playoff);
});

test('eligibility: shortstops can cover second and third, nobody else catches', () => {
  assert.ok(M.canPlay({ el: ['SS'] }, '2B'));
  assert.ok(M.canPlay({ el: ['SS'] }, '3B'));
  assert.ok(!M.canPlay({ el: ['SS'] }, 'C'));
  assert.ok(M.canPlay({ el: ['C'] }, 'DH'));
});

const hubPath = new URL('../mlb/data/hub.json', import.meta.url);
test('real data: 30 teams, standings average 81 wins every season', { skip: !existsSync(hubPath) }, () => {
  const hub = JSON.parse(readFileSync(hubPath, 'utf8'));
  const faPath = new URL('../mlb/data/fa.json', import.meta.url);
  const fa = existsSync(faPath) ? JSON.parse(readFileSync(faPath, 'utf8')) : { classes: {} };
  const H = new M.Hub(hub, fa, { sims: 300 });
  assert.equal(H.teams.length, 30);
  for (let y = hub.season; y < hub.season + 5; y++) {
    const st = H.standings(y);
    const avg = st.reduce((s, r) => s + r.wins, 0) / 30;
    assert.ok(Math.abs(avg - 81) < 1, `${y}: ${avg}`);
    st.forEach((r) => assert.ok(r.wins > 40 && r.wins < 122, `${r.t.abbr} ${y} ${r.wins}`));
  }
  if (H.market) assert.ok(H.cfg.dpw > 5 && H.cfg.dpw < 20, `price of a win ${H.cfg.dpw}`);
});

test('a below-replacement pre-arb player is worth nothing, never less', () => {
  const scrub = { g: 'sl', st: 0.5, age: 28, rate: -0.8, pjs: 'dc', pj: { war: -0.5 } };
  const s = M.surplus(scrub, cfg, S);
  s.rows.forEach((r) => assert.ok(r.surplus >= 0, `${r.y} ${r.surplus}`));
  const sunk = { g: 'sl', st: 9, age: 35, rate: -0.5, pjs: 'dc', pj: { war: -0.5 }, c: { type: 'Free Agent', yrs: [[2027, 20e6, 'G']] } };
  const t = M.surplus(sunk, cfg, S);
  assert.ok(Math.abs(t.rows[0].surplus + 20) < 1e-9, 'a guaranteed year costs its salary, no more');
});
