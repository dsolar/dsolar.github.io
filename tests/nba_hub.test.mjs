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
  tpes: read('nba/data/tpes.json'), exceptions: read('nba/data/exceptions.json'), dead: read('nba/data/dead.json'), darko: opt('nba/data/darko.json'), taxhist: opt('nba/data/taxhist.json'), ratings: opt('nba/data/ratings.json'), lineups: opt('nba/data/lineups.json'), frozen: opt('nba/data/frozen.json'), moves: opt('nba/data/moves.json'), trades: opt('nba/data/trades.json') };
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

test('surplus: value minus salary at the salary weight, discounted; the market view never pays past the max', () => {
  const p = H.players().sort((a, b) => H.salary(b, 0) - H.salary(a, 0))[0];
  const s = H.surplus(p, 'prod');
  assert.ok(s.rows.length >= 1);
  for (const r of s.rows) { assert.ok(Math.abs(r.cost - r.sal * Math.min(1, (H.cfg.salW ?? 1) + 0.1 * Math.max(0, r.j - 1))) < 1); assert.ok(Math.abs(r.surplus - (r.value - r.cost)) < 1); }
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

test('ratings and lineups join to the league: apostrophe names, pbpstats team codes', () => {
  if (H.adv) {
    const q = H.adv.players.filter(r => r.q);
    assert.ok(q.filter(r => r.id).length / q.length > 0.95, 'ratings rows matched to players');
    assert.ok(H.W.P['de-aaron-fox'] ? H.W.P['de-aaron-fox'].adv : true, "De'Aaron Fox has ratings");
  }
  if (H.lu) {
    assert.equal(Object.keys(H.luTeams).length, 30);
    for (const c of Object.keys(H.luTeams)) assert.ok(H.codes.includes(c), c);
    const ids = Object.keys(H.lu.names);
    assert.ok(ids.filter(i => H.luIds[i]).length / ids.length > 0.97, 'lineup players matched');
  }
});

test('value: a top-three pick in his first season is worth something in both views', () => {
  const top = Object.values(H.W.P).filter(p => p.c && p.c.rk && p.c.rk[1] <= 3 && (p.yos || 0) === 0);
  assert.ok(top.length >= 1, 'no top-three rookies found');
  for (const p of top) {
    assert.ok(H.surplus(p, 'prod').pv > 0, p.id + ' production value ' + H.surplus(p, 'prod').pv);
    assert.ok(H.surplus(p, 'market').pv > 0, p.id + ' market value ' + H.surplus(p, 'market').pv);
  }
});

test('trade rules: frozen firsts, protected picks, the 2027 lottery bans, soft notes', () => {
  const fz = H.W.picks.find(pk => pk.frozen);
  assert.ok(fz, 'a frozen first exists');
  const other = H.codes.find(c => c !== fz.owner);
  const t = H.checkTrade({ teams: [fz.owner, other], moves: [{ kind: 'k', id: fz.id, from: fz.owner, to: other }] });
  assert.equal(t.teams[fz.owner].ok, false);
  const base = H.W.picks.find(pk => pk.r === 1 && !pk.prot && !pk.frozen && !pk.locked && pk.y === 2028);
  const prot = H.pickById(base.id + '@10');
  assert.equal(prot.newProt, 10);
  const full = H.pickValue(base, 'prod'), p10 = H.pickValue(prot, 'prod');
  assert.ok(p10 <= full + 1 && p10 > 0, 'protection lowers value: ' + p10 + ' vs ' + full);
  const lot = H.season0();
  assert.ok(lot.WAS.slots[1] === undefined || lot.WAS.slots[1] === 0, 'Washington never picks first in 2027');
  for (const s of [1, 2, 3, 4, 5]) assert.ok(!lot.UTA.slots[s], 'Utah not top five in 2027');
});

test('trade rules: no trading a player back within a year; Stepien counts the worst case', () => {
  const ware = Object.values(H.W.P).find(p => /ware/.test(p.id) && (p.noBack || []).some(x => x.team === 'MIA'));
  if (ware) {
    const t = H.checkTrade({ teams: ['MIA', ware.t], moves: [{ kind: 'p', id: ware.id, from: ware.t, to: 'MIA' }], strict: true });
    assert.equal(t.teams.MIA.ok, false, 'Miami cannot trade for a player it traded in July');
  }
  const mia29 = H.W.picks.find(pk => pk.id === '2029-1-MIA');
  if (mia29 && mia29.owner === 'MIA' && H.W.picks.find(pk => pk.id === '2028-1-MIA' && pk.atRisk)) {
    const t = H.checkTrade({ teams: ['MIA', 'BOS'], moves: [{ kind: 'k', id: '2029-1-MIA', from: 'MIA', to: 'BOS' }], strict: true });
    assert.equal(t.teams.MIA.ok, false, 'Miami can\'t trade its 2029 first while its 2028 could convey');
  }
});

test('valuation: team-aware value, poison pill, 3-2-1 lottery for future drafts', () => {
  // the worst team isn't the likeliest No. 1 under 3-2-1: its expected slot is worse than the fifth-worst team's
  const T = H.lottoTable(), ev = k => T[k].reduce((a, p, s) => a + p * s, 0);
  assert.ok(ev(1) > ev(5), 'worst record picks lower on average than fifth-worst');
  assert.ok(T[1].slice(13).every(p => p < 1e-9), 'the three worst never fall below 12th');
  // future picks run through the lottery too
  const d = H.slotDist('SAC', 2028, 1), avg = d.reduce((a, x) => a + x[0] * x[1], 0);
  assert.ok(avg > 3, `SAC 2028 expected slot ${avg} reflects the lottery, not straight order`);
  // rebuilding teams lean young; contenders don't
  const young = Object.values(H.W.P).find(p => p.age <= 23), vet = Object.values(H.W.P).find(p => p.age >= 31);
  const reb = H.codes.find(c => H.teamCtx(c).tier === 'rebuild'), con = H.codes.find(c => H.teamCtx(c).tier === 'contend');
  if (reb && con) { assert.ok(H.ageMul(young, reb) > H.ageMul(young, con)); assert.ok(H.ageMul(vet, reb) < H.ageMul(vet, con)); }
  // poison pill: a pending rookie extension counts at its average for the team taking him
  const kg = H.W.P['keyonte-george'];
  if (kg && kg.c.sal[1] > 2 * kg.c.sal[0]) assert.ok(L.pillSal(kg, 0) > kg.c.sal[0] * 2);
});

test('injuries, pick swaps and Bird rights', () => {
  const r = H.readInjury(['Out', 'Simmons underwent successful surgery Tuesday to repair a torn right Achilles tendon.', '2026-10-21']);
  assert.equal(r.season, true, 'a torn Achilles is out for the season');
  const w = H.readInjury(['Out', 'Wilson (hand) is expected to miss four to six weeks.', '2026-11-05']);
  assert.equal(w.season, false); assert.equal(w.back, '2026-12-10');
  // a contender's finder deals never bring in a player out for the season
  const con = H.codes.find(c => H.teamCtx(c).tier === 'contend');
  for (const d of H.findDeals({ team: con, mode: 'win' })) for (const m of d.moves) if (m.kind === 'p' && m.to === con) assert.ok(!(H.W.P[m.id].injury && H.W.P[m.id].injury.season), H.W.P[m.id].n);
  // a swap needs both teams to own their own pick that year
  const bad = H.checkTrade({ teams: ['MIA', 'BOS'], moves: [{ kind: 's', id: '2031-1-MIA', from: 'MIA', to: 'BOS' }] });
  assert.equal(bad.ok, false);
  // an expiring good player carries Bird rights
  const exp = Object.values(H.W.P).find(p => H.lastYear(p) === 0 && H.rating(p, 0) > 2 && !(p.c && p.c.rk));
  if (exp) assert.ok(H.birdValue(exp) > 0);
});

test('stars re-sign in future seasons (Bird rights), lottery table sums to one', () => {
  const stars = Object.values(H.W.P).filter(p => { const e = H.lastYear(p); return e >= 0 && e < 3 && H.rating(p, 0) > 4 && p.age + e + 1 <= 31; });
  for (const p of stars) assert.ok(H.kept(p), p.n + ' should re-sign by default');
  const T = H.lottoTable();
  for (let k = 1; k <= 30; k++) assert.ok(Math.abs(T[k].reduce((a, x) => a + x, 0) - 1) < 1e-6);
});
