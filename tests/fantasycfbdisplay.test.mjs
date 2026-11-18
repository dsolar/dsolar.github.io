import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js'), E = require('../fantasy-kit/experience.js'), B = require('../fantasy-kit/gameday.js');
const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/cfb.json', import.meta.url)));
const sport = S.attach({ ...S.cfb }, data);

test('college labels distinguish the actual current week from a new league starting next week', () => {
  const league = { week: 1, start: Date.parse('2026-11-23T13:00Z'), settings: { weeks: 2 } }, copy = structuredClone(league);
  assert.equal(E.sportWeek(sport, Date.parse('2026-11-18T20:00Z')), 12);
  assert.equal(E.weekLabel(sport, league.week, league.start), 'NCAAF Week 13');
  assert.equal(E.weekLabel(sport, 2, league.start + 7 * 864e5), 'NCAAF Week 14');
  assert.deepEqual(league, copy, 'display labels do not change internal scoring periods or start dates');
  assert.equal(E.weekLabel(sport, 1, Date.parse('2026-11-18T20:00Z'), { week: 13 }), 'NCAAF Week 13', 'a chosen future slate wins over today');
});

test('calendar labels respect long opening weeks, postseason, Eastern midnight and missing calendars', () => {
  const sp = { key: 'cfb', data: { calendar: { 1: { start: '2026-08-22', end: '2026-09-07' }, 2: { start: '2026-09-08', end: '2026-09-13' }, 19: { start: '2026-12-28', end: '2027-01-03' } } } };
  assert.equal(E.sportWeek(sp, Date.parse('2026-09-08T03:59Z')), 1);
  assert.equal(E.sportWeek(sp, Date.parse('2026-09-08T04:00Z')), 2);
  assert.equal(E.sportWeek(sp, Date.parse('2027-01-02T20:00Z')), 19);
  assert.equal(E.weekLabel({ key: 'cfb' }, 1, Date.now()), 'League week 1');
  assert.equal(E.weekLabel(S.nfl, 1, Date.now()), 'Week 1');
  assert.equal(E.sportWeek(sp, NaN), null); assert.equal(E.sportWeek(sp, 9e20), null);
});

test('college QB and receiver stats show real counts and zeroes without invented target data', () => {
  const row = vals => S.CFB_COLS.map(k => vals[k] ?? 0), schema = { cols: S.CFB_COLS };
  const qb = B.stats('cfb', { pos: ['QB'] }, row({ pass_yd: 284, pass_td: 3, pass_int: 0, rush_att: 8, rush_yd: 35, rush_td: 1 }), schema);
  assert.deepEqual(qb, [['Pass YD', '284'], ['Pass TD', '3'], ['INT', '0'], ['Rush', '8/35'], ['Rush TD', '1']]);
  const wr = B.stats('cfb', { pos: ['WR'] }, row({ rec: 8, rec_yd: 105, rec_td: 0 }), schema);
  assert.deepEqual(wr.find(([k]) => k === 'REC'), ['REC', '8']);
  assert.deepEqual(wr.find(([k]) => k === 'Rec TD'), ['Rec TD', '0']); assert.ok(!wr.some(([k]) => k.includes('TGT')));
  assert.deepEqual(B.stats('cfb', { pos: ['QB'] }, null, schema), []);
});

test('college kickers and defenses show their own actual season statistics', () => {
  const row = vals => S.CFB_COLS.map(k => vals[k] ?? 0), schema = { cols: S.CFB_COLS };
  assert.deepEqual(B.stats('cfb', { pos: ['K'] }, row({ fgm: 13, fga: 15, xpm: 36 }), schema), [['FG', '13/15'], ['XP', '36']]);
  assert.deepEqual(B.stats('cfb', { pos: ['DEF'] }, row({ def_sack: 21, def_int: 9, def_td: 2, pts_allow: 115 }), schema), [['SACK', '21'], ['INT', '9'], ['TD', '2'], ['PA', '115']]);
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    const p = data.players.find(p => p.pos.includes(pos)); assert.ok(p);
    assert.ok(B.stats('cfb', p, p.l.tot, schema).length, pos);
  }
});

test('a college game never shows combined weekly stats from multiple games', () => {
  const p = { id: 'qb', t: 'UGA' }, g = { id: '1', state: 'post' };
  const live = { games: { UGA: [g] }, players: { qb: [284] } };
  assert.deepEqual(B.line('cfb', p, g, live), [284]);
  live.games.UGA.push({ id: '2', state: 'post' }); assert.equal(B.line('cfb', p, g, live), null);
  live.boxes = { 1: { qb: [140] } }; assert.deepEqual(B.line('cfb', p, g, live), [140]);
});

test('school chips use the official school palette throughout the pool and quick-game metadata', () => {
  const meta = JSON.parse(readFileSync(new URL('../fantasy-kit/data/teams-cfb.json', import.meta.url)));
  assert.ok(new Set(Object.values(data.teams).map(t => t.c)).size > 80);
  assert.equal(data.teams.UGA.c, '#ba0c2f'); assert.equal(data.teams.LSU.c, '#461d76');
  for (const [abbr, team] of Object.entries(data.teams)) {
    assert.match(team.c, /^#[0-9a-f]{6}$/i); assert.ok(S.teamColor('cfb', abbr)); assert.equal(meta.teams[abbr].c, team.c);
  }
});
