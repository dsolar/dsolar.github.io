// Hard Cap as a Draft Lab mode: real contracts (data/contracts-nba.json, contracts-nhl.json) under a salary line, on
// a normal draft and league. The draft keeps room to fill a roster at the minimum, adds and trades stay under the
// line, and a dynasty's expiring contracts are re-signed (held at the minimum until a new deal) or let go.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { nbaContracts, nhlContracts } from '../tools/fantasykit_contracts.mjs';
const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js'), V = require('../fantasy-kit/value.js'), F = require('../fantasy-kit/draft.js'), G = require('../fantasy-kit/league.js'), Z = require('../fantasy-kit/season.js');
const json = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const nba = json('fantasy-kit/data/nba.json'), nhl = json('fantasy-kit/data/nhl.json');
const cNba = json('fantasy-kit/data/contracts-nba.json'), cNhl = json('fantasy-kit/data/contracts-nhl.json');

test('the contracts files: real salaries for the players in the pools, a cap and a minimum', () => {
  for (const [c, pool, least] of [[cNba, nba, 350], [cNhl, nhl, 600]]) {
    const ids = new Set(pool.players.map((p) => String(p.id)));
    const hit = Object.keys(c.players).filter((id) => ids.has(id)).length;
    assert.ok(hit >= least, `${c.sport}: ${hit} pool players with contracts`);
    assert.ok(c.cap > 5e7 && c.min > 5e5 && c.year >= 2026);
    for (const run of Object.values(c.players)) assert.ok(run.length >= 1 && run.every((x) => x > 0));
  }
  // the builders on their own: a deal runs until its first empty season
  const out = nbaContracts({ cba: { season0: '2026-27', cap: 1e8, min_scale: [1e6] }, players: [{ id: 'a', c: { sal: [5e6, 6e6, 0, 7e6] } }, { id: 'tw', two: true, c: { sal: [1e6] } }] }, null, null, { latestContracts: (n) => n });
  assert.deepEqual(out.players, { a: [5e6, 6e6] });
  const h = nhlContracts({ season: '2026-27', money: { caps: { '2026-27': 1e8 }, minSalary: 8e5 }, players: [{ id: 9, k: { years: [[2025, 1], [2026, 2e6], [2027, 3e6]] } }, { id: 10 }] });
  assert.deepEqual(h.players, { 9: [2e6, 3e6] });
  assert.equal(h.year, 2026);
});

test('addContracts: this season\'s salary, what\'s left of the deal, held rights at the minimum', () => {
  const ps = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
  const file = { year: 2026, min: 1e6, players: { x: [3e6, 4e6], y: [2e6] } };
  S.addContracts(ps, file, { year: 2027, min: 1e6, held: ['y'] });
  assert.equal(ps[0].sal, 4e6); assert.deepEqual(ps[0].sals, [4e6]);
  assert.equal(ps[1].sal, 1e6); assert.ok(ps[1].pending, 'held rights count at the minimum');
  assert.equal(ps[2].sal, null);
  assert.deepEqual(S.capPool(ps).map((p) => p.id), ['x', 'y']);
  assert.deepEqual(S.capPool(ps, ['z']).map((p) => p.id), ['x', 'y', 'z'], 'a rostered player stays');
  assert.ok(S.expiring(ps[0]) && !S.expiring({ sals: [1, 2] }));
  assert.equal(S.money(12345678), '$12.3M'); assert.equal(S.money(1357762), '$1.36M');
  assert.ok(S.hardCapOk('nba') && S.hardCapOk('nhl') && !S.hardCapOk('nfl'));
});

function hardCapLeague(key, pool, file, opts = {}) {
  const sport = S.attach(Object.assign({}, S[key]), pool);
  let players = pool.players.map((p) => ({ ...p, l: { ...p.l } }));
  S.addContracts(players, file, { year: file.year, min: file.min });
  players = S.capPool(players);
  const teams = opts.teams || 8, lineup = sport.lineup.slice(), bench = sport.bench, spots = lineup.length + bench;
  V.evaluate(sport, players, { teams, lineup, bench, scoring: Object.keys(sport.scorings)[0] });
  const line = opts.line || S.suggestLine(players, teams, spots, file);
  const now = Date.parse('2026-11-18T15:00:00Z');
  const D = F.create({ sport, teams, seed: 11, now, lineup, bench, botDelay: 0, hardCap: { line, min: file.min, year: file.year, cap: file.cap } });
  D.season = { format: 'h2h', weeks: 4, playoffTeams: 0, ir: 0, dynasty: opts.dynasty ? { rounds: 2 } : undefined };
  F.start(D, now); let t = now; const ctx = F.context(D, players, sport);
  for (let i = 0; i < 20000 && D.phase === 'live'; i++) { t += 2000; F.tick(D, ctx, t); }
  return { sport, players, D, ctx, t, line, spots, teams };
}

for (const [key, pool, file] of [['nba', nba, cNba], ['nhl', nhl, cNhl]]) {
  test(`${key}: a Hard Cap draft fills every roster under the line`, () => {
    const { D, ctx, line, spots } = hardCapLeague(key, pool, file);
    assert.equal(D.phase, 'done');
    assert.equal(D.hardCap.line, line);
    const R = F.rosters(D);
    for (const [i, ids] of R.entries()) {
      assert.equal(ids.length, spots, `team ${i} full`);
      const pay = F.payroll(D, ctx, i);
      assert.ok(pay <= line, `team ${i}: ${S.money(pay)} under ${S.money(line)}`);
    }
  });
}

test('a pick, an add or a trade that breaks the line is refused', () => {
  const { D, ctx, sport, players, t, line } = hardCapLeague('nba', nba, cNba, { teams: 6 });
  // the draft's own check: the priciest player on top of a full payroll
  const big = players.filter((p) => p.sal).sort((a, b) => b.sal - a.sal)[0];
  const c = F.capRoom(D, ctx, 0, big, F.rosters(D)[0].length + 1, F.rosters(D)[0].length + 1);
  if (F.payroll(D, ctx, 0) + big.sal > line) assert.ok(!c.ok && /over the/.test(c.why));
  const L = Z.begin(D, sport, { now: t });
  assert.equal(L.settings.hardCap.line, line);
  const lctx = G.context(L, players, sport, {});
  const room = G.capRoom(L, lctx, 0);
  assert.equal(room, line - G.payroll(L, lctx, 0));
  const owned = new Set(L.rosters.flat());
  const free = players.filter((p) => !owned.has(p.id) && p.sal);
  const pricey = free.sort((a, b) => b.sal - a.sal)[0];
  const cheapest = (ids) => ids.slice().sort((a, b) => lctx.byId[a].sal - lctx.byId[b].sal)[0];
  const drop = cheapest(L.rosters[0]);
  const r = G.canRoster(L, lctx, 0, pricey.id, [drop], true);
  if (room + lctx.byId[drop].sal < pricey.sal) assert.ok(!r.ok && /over the/.test(r.why), r.why);
  // a minimum-salary free agent for the cheapest player always fits
  const minGuy = free.filter((p) => p.sal <= lctx.byId[drop].sal)[0];
  if (minGuy) assert.ok(G.canRoster(L, lctx, 0, minGuy.id, [drop], true).ok);
  // a trade: team 0's cheapest for team 1's priciest, when that puts team 0 over and higher than before
  const a = cheapest(L.rosters[0]), b = L.rosters[1].slice().sort((x, y) => lctx.byId[y].sal - lctx.byId[x].sal)[0];
  const after0 = G.payroll(L, lctx, 0) - lctx.byId[a].sal + lctx.byId[b].sal;
  const tc = G.tradeCheck(L, lctx, { from: 0, to: 1, give: [a], get: [b], pickGive: [], pickGet: [] });
  if (after0 > line) assert.ok(!tc.ok && /over the/.test(tc.why), tc.why); else assert.ok(tc.ok || !/line/.test(tc.why));
});

test('a dynasty\'s next season: expiring deals re-signed or let go, the line a year on', () => {
  const { D, sport, players, t } = hardCapLeague('nba', nba, cNba, { teams: 6, dynasty: true });
  const L = Z.begin(D, sport, { now: t });
  L.week = G.totalWeeks(L) + 1;
  const ctx = G.context(L, players, sport, {});
  const exp = L.rosters.flat().filter((id) => S.expiring(ctx.byId[id]));
  assert.ok(exp.length > 0, 'somebody\'s deal runs out');
  L.teams[0].owner = 'me';
  const mine = L.rosters[0].filter((id) => S.expiring(ctx.byId[id]));
  const letGo = mine.slice(0, 1);
  L.next = { picks: {}, letGo };
  const D2 = Z.nextDraft(L, ctx, sport, {}, { now: t + 864e5, seed: 1 });
  assert.equal(D2.hardCap.year, D.hardCap.year + 1);
  assert.equal(D2.hardCap.line, D.hardCap.line);
  for (const id of letGo) assert.ok(!D2.carry[0].includes(id), 'let go');
  for (const id of mine.slice(1)) { assert.ok(D2.carry[0].includes(id), 'kept'); assert.ok(D2.hardCap.held.includes(id), 'held at the minimum'); }
  const kept = D2.carry.flat();
  for (const id of kept) assert.ok(!S.expiring(ctx.byId[id]) || D2.hardCap.held.includes(id), `${id} carried on a deal or held`);
  // next season's salaries: the held ones at the minimum until their new deals are in the file
  const next = players.map((p) => ({ id: p.id }));
  S.addContracts(next, cNba, D2.hardCap);
  const byId = Object.fromEntries(next.map((p) => [p.id, p]));
  for (const id of D2.hardCap.held) assert.equal(byId[id].sal, cNba.min);
  const L2 = Z.begin(Object.assign(D2, { phase: 'done', done: t + 2 * 864e5 }), sport, { now: t + 2 * 864e5 });
  assert.equal(L2.settings.hardCap.year, D.hardCap.year + 1);
});
