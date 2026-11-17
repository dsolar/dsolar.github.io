// IDP in Draft Lab: individual defensive players for NFL leagues. Their own files (nfl-idp.json, weeks-nfl-idp.json),
// merged into a league's pool and weeks only when its lineup has DL, LB, DB or IDP spots; a draft and a season
// that score them.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js'), V = require('../fantasy-kit/value.js'), F = require('../fantasy-kit/draft.js'), G = require('../fantasy-kit/league.js'), Z = require('../fantasy-kit/season.js');
const pool = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
const weeksFile = JSON.parse(readFileSync(new URL('../fantasy-kit/data/weeks-nfl.json', import.meta.url), 'utf8'));
const IDP_WEEK_COLS = ['g', 'pts_std', 'pts_half_ppr', 'pts_ppr', 'idp_tkl_solo', 'idp_tkl_ast', 'idp_sack', 'idp_tkl_loss', 'idp_qb_hit', 'idp_int', 'idp_ff', 'idp_fum_rec', 'idp_pass_def', 'idp_def_td', 'idp_safe'];
const LINEUP = 'QB RB RB WR WR WR TE FLEX K DEF DL DL LB LB DB DB IDP'.split(' ');

// A made-up defender file in a shorter column list than the pool's: addIdp lines them up by name
const short = ['g', 'pts_std', 'pts_half_ppr', 'pts_ppr'];
const POS = ['DL', 'LB', 'DB'];
const defenders = Array.from({ length: 90 }, (_, i) => {
  const pts = 160 - i;
  return { id: `idp${i}`, n: `Defender ${i}`, t: pool.players[i % 30].t, pos: [POS[i % 3]], l: { tot: [10, pts, pts, pts], proj: [pts / 2, pts / 2, pts / 2], wk11: [1, pts / 17, pts / 17, pts / 17] } };
});
const idpFile = { sport: 'nfl', idp: true, season: pool.season, lines: { tot: { cols: short }, proj: { cols: ['pts_std', 'pts_half_ppr', 'pts_ppr'] }, wk11: { cols: short }, wk99: { cols: short } }, players: defenders };

test('only a lineup with defensive spots is an IDP league', () => {
  assert.ok(S.usesIdp(LINEUP));
  assert.ok(S.usesIdp({ lineup: ['QB', 'IDP'] }));
  assert.ok(S.usesIdp({ settings: { lineup: ['LB'] } }));
  assert.ok(!S.usesIdp(S.nfl.lineup));
  assert.ok(!S.usesIdp(null));
  for (const k of ['DL', 'LB', 'DB', 'IDP']) { assert.ok(S.nfl.slots[k], k); assert.ok(!S.cfb.slots[k], `no ${k} in college`); }
  assert.deepEqual(S.nfl.slots.IDP, ['DL', 'LB', 'DB']);
  assert.ok(S.POINT_STATS.nfl.some(([k]) => k === 'idp_sack') && !S.POINT_STATS.cfb.some(([k]) => k.startsWith('idp')));
  assert.equal(S.POINT_DEFAULTS.nfl.idp_tkl_solo, 1);
});

test('addIdp adds the defenders in the pool\'s own columns, once, and attach gives the sport their positions', () => {
  const data = S.addIdp(pool, idpFile);
  assert.ok(data.idp);
  assert.equal(data.players.length, pool.players.length + defenders.length);
  assert.equal(pool.players.length, JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8')).players.length, 'the pool itself is untouched');
  const d0 = data.players.find((p) => p.id === 'idp0');
  const cols = pool.lines.tot.cols;
  assert.equal(d0.l.tot.length, cols.length);
  assert.equal(d0.l.tot[cols.indexOf('pts_half_ppr')], 160);
  assert.equal(d0.l.tot[cols.indexOf('pass_yd')], 0);
  assert.ok(!('wk99' in d0.l), 'a line the pool has no columns for is dropped');
  assert.equal(S.addIdp(data, idpFile).players.length, data.players.length, 'twice adds nobody new');
  assert.equal(S.addIdp(pool, { ...idpFile, season: '1999' }), pool, 'another season is ignored');
  assert.equal(S.addIdp(pool, null), pool);
  const sport = S.attach(Object.assign({}, S.nfl), data);
  for (const p of POS) assert.ok(sport.positions.includes(p), p);
  assert.ok(!S.nfl.positions.includes('DL'), 'the shared sport keeps its own positions');
});

test('addIdpWeeks expands the short week lines into the weeks file\'s columns without touching the original', () => {
  const k = Object.keys(weeksFile.weeks).find((x) => /^\d+$/.test(x));
  const before = Object.keys(weeksFile.weeks[k].lines).length;
  const line = [1, 7, 7, 7, 4, 2, 1, 1, 0, 0, 0, 0, 1, 0, 0];
  const out = S.addIdpWeeks(weeksFile, { season: weeksFile.season, cols: IDP_WEEK_COLS, weeks: { [k]: { lines: { idpX: line } } } });
  const got = out.weeks[k].lines.idpX, cols = weeksFile.cols;
  assert.equal(got.length, cols.length);
  assert.equal(got[cols.indexOf('pts_half_ppr')], 7);
  assert.equal(got[cols.indexOf('g')], 1);
  if (cols.includes('idp_tkl_solo')) assert.equal(got[cols.indexOf('idp_tkl_solo')], 4);
  assert.equal(Object.keys(weeksFile.weeks[k].lines).length, before, 'the cached weeks file is not changed');
  assert.equal(S.addIdpWeeks(weeksFile, { season: '1999', cols: IDP_WEEK_COLS, weeks: {} }), weeksFile);
});

test('the live feed leaves the defenders\' lines alone (it has none of them)', () => {
  const weeks = { season: '2026', cols: ['g', 'pts'], weeks: { 11: { start: '2026-11-17', final: false, lines: { off: [1, 5], idpA: [1, 9] } } } };
  Z.mergeLive(weeks, { season: '2026', start: '2026-11-17', updated: 't1', players: { off: [1, 12] } });
  assert.deepEqual(weeks.weeks[11].lines.off, [1, 12]);
  assert.deepEqual(weeks.weeks[11].lines.idpA, [1, 9]);
});

test('an IDP draft fills the defensive spots, and the season scores them', () => {
  const data = S.addIdp(pool, idpFile);
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const players = data.players.map((p) => ({ ...p, l: { ...p.l } }));
  const teams = 4, bench = 4;
  V.evaluate(sport, players, { teams, lineup: LINEUP, bench, scoring: 'half' });
  const d0 = players.find((p) => p.id === 'idp0');
  assert.ok(d0.rank > 0 && d0.rank < players.length, 'defenders get ranks');
  const now = Date.parse('2026-11-14T13:00:00Z');
  const D = F.create({ sport, teams, seed: 3, now, lineup: LINEUP, bench, scoring: 'half', botDelay: 0 });
  D.season = { format: 'h2h', weeks: 2, playoffTeams: 0, ir: 0 };
  assert.ok(S.usesIdp(D));
  F.start(D, now); let t = now; const c0 = F.context(D, players, sport);
  for (let i = 0; i < 12000 && D.phase === 'live'; i++) { t += 2000; F.tick(D, c0, t); }
  assert.equal(D.phase, 'done');
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  for (let ti = 0; ti < teams; ti++) {
    const mine = F.rosters(D)[ti].map((id) => byId[id]);
    for (const pos of POS) assert.ok(mine.filter((p) => p && p.pos.includes(pos)).length >= 2, `team ${ti} drafted two ${pos}`);
  }
  // a week of real lines: one defender's in the expanded IDP week file
  const L = Z.begin(D, sport, { now: t });
  const ctx0 = G.context(L, players, sport, {});
  const lu = G.lineupFor(L, ctx0, 0, 1);
  const dl = lu.find((id) => byId[id] && byId[id].pos.includes('DL'));
  assert.ok(dl, 'a DL in the lineup');
  const start = new Date(G.weekStart(L, 1)).toISOString().slice(0, 10);
  const real = S.addIdpWeeks({ season: pool.season, cols: pool.lines.tot.cols, weeks: { 1: { start, final: true, lines: {} } } },
    { season: pool.season, cols: IDP_WEEK_COLS, weeks: { 1: { lines: { [dl]: [1, 11, 11, 11, 6, 2, 1, 1, 0, 0, 0, 0, 1, 0, 0] } } } });
  L.settings.real = true;
  const ctx = G.context(L, players, sport, { real });
  const tw = G.teamWeek(L, ctx, 0, 1);
  assert.equal(tw.players[dl], 11 * G.slotMult(L, G.lineupFor(L, ctx, 0, 1).indexOf(dl), dl));
});
