import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js'), SL = require('../fantasy-kit/slates.js');
const Q = require('../fantasy-kit/quick-games.js'), E = require('../fantasy-kit/experience.js');
const nfl = JSON.parse(readFileSync(new URL('./fixtures/nfl-slates.json', import.meta.url)));
const nba = JSON.parse(readFileSync(new URL('./fixtures/nba-slates.json', import.meta.url)));
const cbb = { ...structuredClone(nba), sport: 'cbb', weeks: structuredClone(nba.weeks).map(w => ({ ...w, sport: 'cbb' })) };
const nowFor = data => Date.parse(data.weeks[0].start + 'T12:00:00Z');

test('the builder carries each sport, chosen date, draft mode and competition into valid league rules', () => {
  for (const [sport, data] of Object.entries({ nfl, nba, cbb })) for (const mode of Q.MODES.map(m => m.key)) {
    const st = { ...Q.initial(sport), mode, period: SL.periodKey(data.weeks[1]), teams: 6, match: 'h2h' };
    const v = Q.view(st, data, S, SL, null, nowFor(data));
    const url = new URL(Q.setupHref(v, E, SL), 'https://davidsolar.dev');
    const r = E.decode(url.searchParams.get('rules'), S);
    assert.equal(url.pathname, '/fantasy/leagues/');
    assert.equal(url.searchParams.get('quick'), '1');
    assert.equal(r.sport, sport); assert.equal(r.kind, 'week');
    assert.equal(r.type, mode); assert.equal(r.season, 'h2h'); assert.equal(r.teams, 6);
    assert.equal(r.slPeriod, SL.periodKey(data.weeks[1]));
    assert.equal(SL.resolvePeriod(data.weeks, r.slPeriod).start, data.weeks[1].start);
    assert.equal(r.scoring, { nfl: 'half', nba: 'points', cbb: 'dk' }[sport]);
    assert.equal(r.bench, mode === 'cap' ? 0 : v.lineup.bench);
    assert.equal(new URL(Q.setupHref(v, E, SL, true), 'https://davidsolar.dev').searchParams.get('custom'), '1');
  }
});

test('custom game selections and one-game captains survive the setup handoff without adding games', () => {
  const now = nowFor(nba), ids = nba.weeks[0].games.slice(1, 3).map(g => g.id);
  const st = { ...Q.initial('nba'), kind: 'custom', games: ids };
  const v = Q.view(st, nba, S, SL, null, now), r = E.decode(E.encode(Q.rules(v, SL)), S);
  assert.deepEqual(r.slGames, ids); assert.equal(r.slKind, 'custom');
  assert.equal(r.lineup.split(' ').length, 6);
  assert.equal(v.lineup.mult.CPT, 1.5);
  assert.deepEqual(SL.pick(SL.resolvePeriod(nba.weeks, r.slPeriod), r.slKind, r.slGames, now).games.map(g => g.id), ids);
  const one = Q.view({ ...st, kind: 'one', one: ids[1] }, nba, S, SL, null, now);
  assert.equal(Q.rules(one, SL).slOne, ids[1]); assert.equal(one.lineup.bench, 0);
});

test('expired selected dates never silently change to a different slate as the filtered schedule shifts', () => {
  const st = { ...Q.initial('nba'), period: SL.periodKey(nba.weeks[0]) };
  const later = Date.parse(nba.weeks[1].start + 'T12:00:00Z');
  const v = Q.view(st, nba, S, SL, null, later);
  assert.ok(v.periods.length); assert.equal(v.w, null); assert.match(v.error, /closed/);
  assert.equal(Q.setupHref(v, E, SL), '');
  assert.equal(SL.resolvePeriod([nba.weeks[1]], st.period), null);
  assert.equal(SL.resolvePeriod([nba.weeks[1]], SL.periodKey(nba.weeks[1])), nba.weeks[1]);
});

test('started games and empty custom selections cannot start another matchup by accident', () => {
  const g = nba.weeks[0].games[0];
  const st = { ...Q.initial('nba'), kind: 'one', one: g.id };
  const v = Q.view(st, nba, S, SL, null, Date.parse(g.at) - 5 * 60e3);
  assert.ok(v.open.length); assert.equal(v.slate, null); assert.equal(Q.rules(v, SL), null);
  const empty = Q.view({ ...st, kind: 'custom', games: [] }, nba, S, SL, null, nowFor(nba));
  assert.equal(empty.slate, null); assert.match(empty.error, /Select/);
});

test('manager limits account for unique drafted rosters while salary-cap players can be shared', () => {
  const g = nba.weeks[0].games[0], counts = { [g.away]: 12, [g.home]: 12 };
  const st = { ...Q.initial('nba'), kind: 'one', one: g.id, teams: 16 };
  const unique = Q.view(st, nba, S, SL, counts, nowFor(nba));
  assert.equal(unique.teams, 4); assert.deepEqual(unique.teamOptions, [2, 4]);
  const shared = Q.view({ ...st, mode: 'cap' }, nba, S, SL, counts, nowFor(nba));
  assert.equal(shared.teams, 16); assert.equal(Q.rules(shared, SL).bench, 0);
  assert.equal(Q.rules(shared, SL).capBudget, 50000);
  const nflGame = nfl.weeks[0].games[0];
  const showdown = Q.view({ ...Q.initial('nfl'), kind: 'one', one: nflGame.id, teams: 16 }, nfl, S, SL, { [nflGame.away]: 50, [nflGame.home]: 50 }, nowFor(nfl));
  assert.equal(showdown.teams, 6, 'football showdown setup has a six-team limit even with a large raw pool');
});

test('college roster and displayed scoring come from the college configuration, not NBA defaults', () => {
  const v = Q.view(Q.initial('cbb'), cbb, S, SL, null, nowFor(cbb));
  assert.deepEqual(v.lineup.lineup, ['G', 'G', 'G', 'F', 'F', 'F', 'UTIL', 'UTIL']);
  const collegeRows = Q.scoringRows(v, S);
  assert.equal(collegeRows.find(r => r.key === 'reb').value, 1.25);
  assert.equal(collegeRows.find(r => r.key === 'stl').value, 2);
  assert.equal(collegeRows.find(r => r.key === 'dd').value, 1.5);
  const pro = Q.view(Q.initial('nba'), nba, S, SL, null, nowFor(nba));
  assert.equal(Q.scoringRows(pro, S).find(r => r.key === 'reb').value, 1.2);
  assert.equal(Q.scoringRows(pro, S).find(r => r.key === 'stl').value, 3);
  const ppr = Q.view({ ...Q.initial('nfl'), scoring: 'ppr' }, nfl, S, SL, null, nowFor(nfl));
  assert.equal(Q.scoringRows(ppr, S).find(r => r.key === 'rec').value, 1);
});

test('returning games are separated by exact sport and each series shows its latest game', () => {
  const mine = [{ id: 'pro1', sport: 'nba', oneWeek: true, series: 'nbaS', seriesN: 1 }, { id: 'college1', sport: 'cbb', oneWeek: true },
    { id: 'pro2', sport: 'nba', oneWeek: true, series: 'nbaS', seriesN: 2 }, { id: 'season', sport: 'nba', oneWeek: false }, { id: 'football', sport: 'nfl', oneWeek: true }];
  assert.deepEqual(Q.seriesFor(mine, 'nba').map(l => l.id), ['pro2']);
  assert.deepEqual(Q.seriesFor(mine, 'cbb').map(l => l.id), ['college1']);
  assert.deepEqual(Q.seriesFor(mine, 'nfl').map(l => l.id), ['football']);
  for (const sport of ['nfl', 'nba', 'cbb']) {
    const u = new URL(Q.mockHref(sport), 'https://davidsolar.dev');
    assert.equal(u.pathname, '/fantasy/mock/'); assert.equal(u.searchParams.get('s'), sport);
  }
});

test('unavailable feeds and unsupported period keys cannot become working creation links', () => {
  const st = Q.initial('nba');
  for (const data of [null, { weeks: [] }, { weeks: [], error: true }]) assert.equal(Q.setupHref(Q.view(st, data, S, SL, null, nowFor(nba)), E, SL), '');
  assert.throws(() => E.decode(JSON.stringify({ v: 1, rules: { sport: 'nba', slPeriod: 'wrong' } }), S));
});
