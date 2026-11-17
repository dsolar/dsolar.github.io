// College football in Draft Lab: one ESPN box score in football's columns (fk-live/cfb.mjs), the weekly file and
// pool (tools/fantasykit_cfb.mjs), the sport, and a season league kept to one conference scored on real weeks.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { CFB_COLS, cfbBox, allowPts, addInto } from '../supabase/functions/fk-live/cfb.mjs';
import { fantasyWeeks, positionOf } from '../tools/fantasykit_cfb.mjs';
const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js'), V = require('../fantasy-kit/value.js'), F = require('../fantasy-kit/draft.js'), G = require('../fantasy-kit/league.js'), Z = require('../fantasy-kit/season.js');
const pool = JSON.parse(readFileSync(new URL('../fantasy-kit/data/cfb.json', import.meta.url), 'utf8'));
const weeksFile = JSON.parse(readFileSync(new URL('../fantasy-kit/data/weeks-cfb.json', import.meta.url), 'utf8'));
const hub = JSON.parse(readFileSync(new URL('../cfb/data/hub.json', import.meta.url), 'utf8'));
const ix = (k) => CFB_COLS.indexOf(k);

// ESPN's college summary, trimmed to what cfbBox reads (Kent State 28, Bowling Green 33)
const cat = (name, labels, athletes) => ({ name, labels, athletes: athletes.map(([id, n, stats, pos]) => ({ athlete: { id, displayName: n, position: pos ? { abbreviation: pos } : undefined }, stats })) });
const summary = {
  header: { competitions: [{ status: { type: { state: 'post', completed: true } }, competitors: [{ team: { id: '189', abbreviation: 'BGSU' }, score: '33' }, { team: { id: '2309', abbreviation: 'KENT' }, score: '28' }] }] },
  boxscore: {
    teams: [{ team: { id: '2309' }, statistics: [{ name: 'totalYards', displayValue: '409' }] }, { team: { id: '189' }, statistics: [{ name: 'totalYards', displayValue: '347' }] }],
    players: [
      { team: { id: '2309', abbreviation: 'KENT' }, statistics: [
        cat('passing', ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'QBR'], [['1', 'Kent QB', ['19/38', '332', '8.7', '2', '2', '61.6'], 'QB']]),
        cat('rushing', ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], [['1', 'Kent QB', ['12', '35', '2.9', '2', '27']]]),
        cat('receiving', ['REC', 'YDS', 'AVG', 'TD', 'LONG'], [['2', 'Kent WR', ['8', '143', '17.9', '2', '41'], 'WR']]),
        cat('fumbles', ['FUM', 'LOST', 'REC'], [['1', 'Kent QB', ['1', '1', '0']]]),
        cat('defensive', ['TOT', 'SOLO', 'SACKS', 'TFL', 'PD', 'QB HUR', 'TD'], [['9', 'Kent LB', ['9', '3', '3', '0.5', '0', '0', '0']]]),
        cat('interceptions', ['INT', 'YDS', 'TD'], []),
        cat('kicking', ['FG', 'PCT', 'LONG', 'XP', 'PTS'], [['3', 'Kent K', ['0/1', '0.0', '0', '4/4', '4']]]),
      ] },
      { team: { id: '189', abbreviation: 'BGSU' }, statistics: [
        cat('passing', ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'QBR'], [['4', 'BG QB', ['15/25', '229', '9.2', '3', '0', '34.2']]]),
        cat('defensive', ['TOT', 'SOLO', 'SACKS', 'TFL', 'PD', 'QB HUR', 'TD'], [['8', 'BG DE', ['10', '3', '2', '1', '1', '1', '0']], ['7', 'BG S', ['4', '3', '0', '0', '1', '0', '1']]]),
        cat('interceptions', ['INT', 'YDS', 'TD'], [['7', 'BG S', ['2', '40', '1']]]),
        cat('kickReturns', ['NO', 'YDS', 'AVG', 'LONG', 'TD'], [['5', 'BG KR', ['2', '120', '60', '95', '1']]]),
        cat('kicking', ['FG', 'PCT', 'LONG', 'XP', 'PTS'], [['6', 'BG K', ['2/2', '100.0', '52', '3/4', '9']]]),
      ] },
    ],
  },
};

test('a box score in football columns: players with points, defenses by abbreviation', () => {
  const b = cfbBox(summary);
  assert.equal(b.state, 'post');
  const qb = b.lines['1'];
  assert.deepEqual([qb[ix('pass_cmp')], qb[ix('pass_att')], qb[ix('pass_yd')], qb[ix('pass_td')], qb[ix('pass_int')], qb[ix('rush_yd')], qb[ix('rush_td')], qb[ix('fum_lost')]], [19, 38, 332, 2, 2, 35, 2, 1]);
  assert.equal(qb[ix('pts_std')], Math.round((332 * 0.04 + 8 - 4 + 3.5 + 12 - 2) * 100) / 100);
  const wr = b.lines['2'];
  assert.ok(Math.abs(wr[ix('pts_ppr')] - wr[ix('pts_std')] - 8) < 1e-9); assert.ok(Math.abs(wr[ix('pts_half_ppr')] - wr[ix('pts_std')] - 4) < 1e-9);
  const k = b.lines['6'];
  assert.deepEqual([k[ix('fgm')], k[ix('fga')], k[ix('xpm')], k[ix('xpmiss')], k[ix('fgm_50p')]], [2, 2, 3, 1, 1]);
  assert.equal(k[ix('pts_std')], 6 + 2 + 3 - 1, 'two field goals, one from 50+, three extra points and a miss');
  assert.equal(b.pos['6'], 'K'); assert.equal(b.pos['4'], 'QB');
  assert.equal(b.lines['5'][ix('ret_td')], 1);
  assert.ok(!b.lines['8'] && !b.lines['7'], 'defenders have no lines of their own');
  const bg = b.def.BGSU, kent = b.def.KENT;
  assert.deepEqual([bg[ix('def_sack')], bg[ix('def_int')], bg[ix('def_td')], bg[ix('def_st_td')], bg[ix('fum_rec')], bg[ix('pts_allow')], bg[ix('yds_allow')]], [2, 2, 1, 1, 1, 28, 409]);
  assert.equal(bg[ix('pts_std')], 2 + 4 + 2 + 12 + allowPts(28));
  assert.equal(kent[ix('def_sack')], 3); assert.equal(kent[ix('pts_allow')], 33);
  assert.deepEqual([allowPts(0), allowPts(6), allowPts(13), allowPts(20), allowPts(27), allowPts(34), allowPts(35)], [10, 7, 4, 1, 0, -1, -4]);
  const acc = addInto({}, b.lines); addInto(acc, b.lines);
  assert.equal(acc['1'][ix('g')], 2);
});

test('the weeks: ESPN regular-season weeks, then the postseason Monday to Sunday', () => {
  const { weeks, weekOf } = fantasyWeeks(hub);
  assert.deepEqual(weeks[2], { start: '2026-09-08', end: '2026-09-13' });
  assert.deepEqual(weeks[12], { start: '2026-11-16', end: '2026-11-22' });
  const last = Math.max(...hub.weeks.filter((w) => w.type === 2).map((w) => w.week));
  const after = weeks[last].end;
  const bowl = { post: true, day: after.slice(0, 8) + String(Number(after.slice(8)) + 10).padStart(2, '0') };
  assert.equal(weekOf(bowl), String(last + 2));
  assert.equal(positionOf('FB', null, null), 'RB'); assert.equal(positionOf(null, 'PK', null), 'K');
  const l = CFB_COLS.map(() => 0); l[ix('pass_att')] = 20;
  assert.equal(positionOf(null, null, l), 'QB');
});

test('the weekly file and pool: real weeks, FBS schools with conferences, every fantasy position', () => {
  assert.equal(weeksFile.season, pool.season); assert.deepEqual(weeksFile.cols, CFB_COLS);
  assert.ok(Object.values(weeksFile.weeks).filter((w) => w.final).length >= 8);
  assert.ok(Object.keys(pool.teams).length >= 130);
  const pos = new Set(pool.players.map((p) => p.pos[0]));
  for (const x of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) assert.ok(pos.has(x), x);
  for (const p of pool.players) assert.ok(pool.teams[p.t], p.t);
});

test('college football: a season sport that plays like football, with the NFL scorings and college March-style endings', () => {
  assert.ok(S.SEASON_SPORTS.includes(S.cfb)); assert.ok(S.football('cfb') && S.football('nfl') && !S.football('cbb'));
  assert.deepEqual(Object.keys(S.cfb.scorings), ['half', 'ppr', 'std']);
  assert.ok(!S.EXTRA_CATS.cfb.some((c) => c.k === 'epa' || c.k === 'catch'), 'no EPA or targets in college box scores');
  const all = new Set(S.catCatalog(S.cfb, { all: true }).map((c) => c.k));
  for (const p of S.CAT_PRESETS.cfb) for (const c of p.cats) assert.ok(all.has(c), `${p.name}: ${c}`);
  const day = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const t = new Date(2026, 10, 17).getTime();
  assert.equal(day(S.collegeEnd('reg', t, 'cfb')), '2026-11-29');
  assert.equal(day(S.collegeEnd('conf', t, 'cfb')), '2026-12-6');
  assert.equal(day(S.collegeEnd('cfp', t, 'cfb')), '2027-1-31');
  assert.equal(day(S.collegeEnd('cfp', new Date(2027, 0, 5).getTime(), 'cfb')), '2027-1-31', 'in January it is still this season');
});

test('a league kept to the SEC: SEC players only, lineups lock by game, real weeks score it', () => {
  const sec = Object.entries(pool.teams).filter(([, t]) => t.conf === 'SEC').map(([k]) => k);
  const sport = S.attach(Object.assign({}, S.cfb), pool);
  const players = pool.players.filter((p) => sec.includes(p.t)).map((p) => ({ ...p, l: { ...p.l } }));
  const lineup = S.cfb.lineup.slice(), bench = 4, teams = 4;
  V.evaluate(sport, players, { teams, lineup, bench, scoring: 'half' });
  const wk = Object.entries(weeksFile.weeks).filter(([, w]) => w.final && new Date(w.start + 'T12:00:00Z').getUTCDay() === 1).pop();
  assert.ok(wk, 'a final Monday week');
  const now = Date.parse(wk[1].start + 'T13:00:00Z') - 3 * 864e5;
  const D = F.create({ sport, teams, seed: 5, now, lineup, bench, scoring: 'half', botDelay: 0 });
  D.season = { format: 'h2h', weeks: 2, playoffTeams: 0, ir: 0, pool: sec, confs: ['SEC'], collegeEnd: 'conf' };
  const osu = pool.players.find((p) => p.t === 'OSU' && p.pos[0] !== 'DEF');
  assert.ok(!S.inPool(D, osu), 'a Big Ten player is out of the pool');
  F.start(D, now); let t = now; const c0 = F.context(D, players, sport);
  for (let i = 0; i < 8000 && D.phase === 'live'; i++) { t += 2000; F.tick(D, c0, t); }
  assert.equal(D.phase, 'done');
  const L = Z.begin(D, sport, { now: t, real: weeksFile });
  assert.equal(L.settings.gameLock, 'week', 'football lineups lock by game');
  assert.deepEqual(L.settings.confs, ['SEC']); assert.equal(L.settings.collegeEnd, 'conf');
  assert.equal(new Date(G.weekStart(L, 1)).toISOString().slice(0, 10), wk[1].start);
  const ctx = G.context(L, players, sport, { real: weeksFile });
  const tw = G.teamWeek(L, ctx, 0, 1);
  const lu = G.lineupFor(L, ctx, 0, 1);
  const col = sport.cols.tot.pts_half_ppr;
  for (const id of Object.keys(tw.players)) {
    const line = wk[1].lines[id];
    assert.ok(Math.abs(tw.players[id] - (line ? line[col] : 0) * G.slotMult(L, lu.indexOf(id), id)) < 1e-6, id);
  }
  assert.ok(Object.values(tw.players).some((x) => x > 0), 'somebody scored');
});
