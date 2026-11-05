import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url);
const SL = require('../fantasy-kit/slates.js');
const data = JSON.parse(readFileSync(new URL('./fixtures/nfl-slates.json', import.meta.url), 'utf8'));
const wk9 = data.weeks[0], wk10 = data.weeks[1];

test('slates: the whole week, Sunday day games, the night games, one game and pick your own', () => {
  const now = Date.parse('2026-11-05T13:00Z'); // Thursday morning
  const L = SL.list(wk9, now), by = Object.fromEntries(L.map((s) => [s.key, s]));
  assert.deepEqual(L.map((s) => s.key), ['full', 'sunday', 'prime', 'one', 'custom']);
  assert.equal(by.full.games.length, 15);
  assert.equal(by.full.label, 'Full week');
  assert.equal(by.sunday.games.length, 12, 'the London game and the 1 PM and 4 PM games');
  assert.deepEqual(by.prime.games.map((g) => g.away), ['JAX', 'TB', 'BUF'], 'Thursday, Sunday and Monday nights');
  assert.match(by.prime.sub, /Thursday, Sunday and Monday nights/);
  // once Thursday's game has kicked off it's the rest of the week
  const fri = Date.parse('2026-11-07T15:00Z');
  const L2 = SL.list(wk9, fri);
  assert.equal(L2[0].label, 'Rest of the week');
  assert.equal(L2[0].games.length, 14);
  assert.equal(SL.list(wk9, Date.parse('2026-11-11T00:00Z')).length, 0, 'nothing left after Monday night');
});

test('pick: a slate becomes the teams in play, kickoffs and a lineup that fits', () => {
  const now = Date.parse('2026-11-05T13:00Z');
  const sun = SL.pick(wk9, 'sunday', null, now);
  assert.equal(sun.week, 9); assert.equal(sun.teams.length, 24);
  assert.equal(sun.first, Date.parse('2026-11-08T14:30Z'));
  const one = SL.pick(wk9, 'custom', ['401873045'], now);
  assert.equal(one.kind, 'one'); assert.equal(one.label, 'NYJ @ KC'); assert.deepEqual(one.teams, ['NYJ', 'KC']);
  const three = SL.pick(wk10, 'custom', ['401873058', '401873054', '401873052'], now);
  assert.equal(three.games[0].away, 'WAS', 'kickoff order');
  assert.equal(three.label, 'Your games');
  assert.deepEqual(SL.lineup(1, 2).lineup, ['CPT', 'UTIL', 'UTIL', 'UTIL', 'UTIL', 'UTIL']);
  assert.equal(SL.lineup(3, 6).mult.CPT, 1.5);
  assert.deepEqual(SL.lineup(5, 8).lineup, ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']);
  assert.equal(SL.lineup(5, 12).lineup[0], 'SFLEX', 'more teams than quarterbacks to start');
  assert.equal(SL.lineup(14, 10).lineup.length, 8);
  assert.equal(SL.pick(wk9, 'custom', ['nope'], now), null);
});

const S = require('../fantasy-kit/sports.js'), V = require('../fantasy-kit/value.js'), F = require('../fantasy-kit/draft.js'), G = require('../fantasy-kit/league.js'), Z = require('../fantasy-kit/season.js');
test('a one-week slate league: only the slate\'s players, each game\'s kickoff locks, and everyone vs everyone with an odd number of teams', () => {
  const now = Date.parse('2026-11-05T13:00Z');
  const sl = SL.pick(wk9, 'sunday', null, now), lu = SL.lineup(sl.games.length, 5);
  const nfl = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), nfl);
  const players = nfl.players.filter((p) => sl.teams.includes(p.t)).map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 5, lineup: lu.lineup, bench: lu.bench, scoring: 'half' });
  const D = F.create({ sport, teams: 5, seed: 3, now, lineup: lu.lineup, bench: lu.bench, scoring: 'half', botDelay: 0 });
  D.season = { format: 'h2h', tally: 'allplay', weeks: 1, oneWeek: true, playoffTeams: 0, slate: sl };
  assert.deepEqual(S.poolOf(D), sl.teams);
  F.start(D, now); let t = now; const c0 = F.context(D, players, sport);
  for (let i = 0; i < 5000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, c0, t); }
  const L = Z.begin(D, sport, { now: t });
  assert.equal(L.week, 1); assert.equal(L.settings.slate.label, 'Sunday');
  assert.ok(L.start <= sl.first && sl.last < L.start + 7 * 864e5, 'plays the slate\'s week');
  assert.equal(L.kick.teams.KC, Date.parse('2026-11-08T18:00Z'));
  assert.equal(new Set(L.schedule[0].flat()).size, 5, 'all five teams play');
  const ctx = G.context(L, players, sport);
  Z.catchUp(L, ctx, L.start + 7 * 864e5 + 1);
  const st = G.standings(L);
  assert.equal(st.reduce((a, r) => a + r.w + r.l + r.t, 0), 5 * 4, 'every team against every other once');
  assert.equal(st[0].w, 4 - st[0].t, 'the top score beat everyone');
});

test('a draft set for a time: a reminder an hour before, then it starts on its own and no-shows are picked for', () => {
  const now = Date.parse('2026-11-05T13:00Z');
  const nfl = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), nfl);
  const sl = SL.pick(wk9, 'prime', null, now), lu = SL.lineup(sl.games.length, 4);
  const players = nfl.players.filter((p) => sl.teams.includes(p.t)).map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 4, lineup: lu.lineup, bench: lu.bench, scoring: 'half' });
  const D = F.create({ sport, teams: 4, seed: 2, now, lineup: lu.lineup, bench: lu.bench, scoring: 'half', botDelay: 0, clock: 30 });
  D.teams[0].owner = 'Dave'; D.teams[1].owner = 'Yan';
  D.season = { format: 'h2h', tally: 'allplay', weeks: 1, oneWeek: true, slate: sl };
  D.startAt = now + 3 * 36e5;
  const ctx = F.context(D, players, sport);
  assert.equal(Z.driveDraft(D, ctx, now), false, 'nothing yet');
  assert.ok(Z.driveDraft(D, ctx, D.startAt - 30 * 6e4)); assert.ok(D.reminded); assert.equal(D.phase, 'setup');
  const ev = Z.events({ draft: { ...D, reminded: undefined } }, { draft: D }, { name: 'Prime', url: 'x', seats: { 0: 'Dave', 1: 'Yan' }, me: null, now });
  assert.ok(ev.some((e) => /starts in an hour/.test(e.subject)), 'the reminder email');
  Z.driveDraft(D, ctx, D.startAt + 1000);
  assert.equal(D.phase, 'live', 'it started on its own');
  Z.driveDraft(D, ctx, D.startAt + 3 * 36e5);
  assert.equal(D.phase, 'done', 'nobody showed, so the clock drafted everyone');
});
