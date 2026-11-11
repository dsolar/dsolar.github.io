// One-day basketball: tonight's slates, lineups that fit, one-game values, and a league that scores only its own
// games from their box scores and closes the same night once they're final.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url);
const SL = require('../fantasy-kit/slates.js');
const S = require('../fantasy-kit/sports.js'), V = require('../fantasy-kit/value.js'), F = require('../fantasy-kit/draft.js'), G = require('../fantasy-kit/league.js'), Z = require('../fantasy-kit/season.js');
const feed = JSON.parse(readFileSync(new URL('./fixtures/nba-slates.json', import.meta.url), 'utf8'));
const nba = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nba.json', import.meta.url), 'utf8'));
const weeksFile = JSON.parse(readFileSync(new URL('../fantasy-kit/data/weeks-nba.json', import.meta.url), 'utf8'));
const tonight = feed.weeks[0], tomorrow = feed.weeks[1];
const MORNING = Date.parse('2026-11-11T16:00Z');   // 11 AM in New York

test('day slates: the main slate, early and late games, one game and your own picks', () => {
  const L = SL.list(tonight, MORNING), by = Object.fromEntries(L.map((s) => [s.key, s]));
  assert.deepEqual(L.map((s) => s.key), ['full', 'early', 'late', 'one', 'custom']);
  assert.equal(by.full.label, 'Main slate'); assert.equal(by.full.games.length, 10);
  assert.equal(by.early.games.length, 3, 'the 7 PM tips');
  assert.deepEqual(by.late.games.map((g) => g.home), ['UTA', 'HOU', 'POR'], '9 PM and later');
  assert.equal(SL.dayName(tonight.day, MORNING), 'Tonight');
  assert.equal(SL.dayName(tomorrow.day, MORNING), 'Tomorrow');
  // after the 7 PM tips it's the rest of the night
  const L2 = SL.list(tonight, Date.parse('2026-11-12T00:30Z'));
  assert.equal(L2[0].label, 'Rest of the night'); assert.equal(L2[0].games.length, 7);
  assert.equal(SL.list(tonight, Date.parse('2026-11-12T04:00Z')).length, 0, 'nothing left once the last game tips');
});

test('day picks and lineups: a captain for a few games, real positions for four or more', () => {
  const late = SL.pick(tonight, 'late', null, MORNING);
  assert.equal(late.day, '2026-11-11'); assert.equal(late.sport, 'nba'); assert.equal(late.week, undefined);
  assert.equal(late.teams.length, 6); assert.equal(late.first, Date.parse('2026-11-12T02:00Z'));
  const one = SL.pick(tonight, 'one', ['401909968'], MORNING);
  assert.equal(one.label, 'BOS @ TOR'); assert.equal(one.kind, 'one');
  assert.deepEqual(SL.lineup(1, 4, 'nba').lineup, ['CPT', 'UTIL', 'UTIL', 'UTIL', 'UTIL', 'UTIL']);
  assert.equal(SL.lineup(3, 6, 'nba').bench, 1);
  assert.deepEqual(SL.lineup(10, 10, 'nba').lineup, ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL']);
  assert.ok(S.nba.slots.CPT, 'basketball has a captain slot');
});

test('one-game values: a player ruled out is worth nothing tonight', () => {
  const sport = S.attach(Object.assign({}, S.nba), nba);
  const players = nba.players.map((p) => ({ ...p }));
  const out = players.find((p) => /^out/i.test(p.inj || '') && (S.stat(sport, p, 'pg', 'pts') || 0) > 15);
  assert.ok(out, 'the data has a scorer ruled out');
  V.evaluate(sport, players, { teams: 8, lineup: SL.lineup(10, 8, 'nba').lineup, bench: 1, scoring: 'points', oneDay: true });
  const healthy = players.filter((p) => !p.inj).sort((a, b) => a.rank - b.rank)[0];
  assert.equal(out.v, 0); assert.ok(out.rank > players.length / 2, 'he falls to the bottom');
  assert.ok(healthy.rank <= 3);
});

function dayLeague({ kind = 'late', ids = null, teams = 4, scoring = 'points', seed = 5 } = {}) {
  const sl = SL.pick(tonight, kind, ids, MORNING), lu = SL.lineup(sl.games.length, teams, 'nba');
  const sport = S.attach(Object.assign({}, S.nba), nba);
  const players = nba.players.filter((p) => sl.teams.includes(p.t)).map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams, lineup: lu.lineup, bench: lu.bench, scoring, oneDay: true });
  const D = F.create({ sport, teams, seed, now: MORNING, lineup: lu.lineup, bench: lu.bench, scoring, botDelay: 0 });
  D.season = { format: 'h2h', tally: 'allplay', weeks: 1, oneWeek: true, playoffTeams: 0, slate: Object.assign({}, sl, lu.mult ? { mult: lu.mult } : {}), ir: 0, when: 'now' };
  F.start(D, MORNING); let t = MORNING; const c0 = F.context(D, players, sport);
  for (let i = 0; i < 5000 && D.phase === 'live'; i++) { t += 2000; F.tick(D, c0, t); }
  assert.equal(D.phase, 'done');
  const real = structuredClone(weeksFile);
  const L = Z.begin(D, sport, { now: t, real });
  return { sl, sport, players, D, L, real, t };
}
// a box score for every player on a team: n points each, one game
const box = (players, team, pts) => Object.fromEntries(players.filter((p) => p.t === team).map((p) => [p.id, [1, 1, 30, 5, 10, 2, 2, 1, pts, 4, 3, 1, 0, 2]]));

test('a one-day league starts now, ends with its night, and scores only its own games', () => {
  const { sl, sport, players, L, real, t } = dayLeague();
  assert.equal(L.start, t, 'it starts when the draft ends');
  assert.equal(G.weekStart(L, 2), sl.last + 3 * 36e5, 'its week ends three hours after the last tip');
  assert.equal(L.settings.slate.day, '2026-11-11'); assert.equal(L.settings.slate.list.length, 3);
  assert.ok(L.settings.real, 'scored on real games');
  assert.equal(L.kick.teams.POR, Date.parse('2026-11-12T03:00Z'), 'each player locks at his tip');
  assert.deepEqual(Z.slateGames(L), ['401909973', '401909974', '401909975']);
  const ctx = G.context(L, players, sport, { real });
  // nothing in yet: no points, and the week can't close even once its time is up
  assert.equal(G.teamWeek(L, ctx, 0, 1).total, 0);
  const end = G.weekStart(L, 2);
  Z.catchUp(L, ctx, end + 60e3);
  assert.equal(L.week, 1, 'waits for the box scores');
  // two games final, one still going; a game from another night with the same teams must not count
  Z.mergeGames(real, { games: { '401909973': { state: 'post', lines: { ...box(players, 'ORL', 10), ...box(players, 'UTA', 10) } }, '401909974': { state: 'post', lines: { ...box(players, 'GSW', 20), ...box(players, 'HOU', 20) } }, '401909975': { state: 'in', lines: { ...box(players, 'OKC', 5), ...box(players, 'POR', 5) } }, '401909966': { state: 'post', lines: box(players, 'WAS', 99) } } });
  const roster = L.lineups[1] ? null : null;
  const tw = G.teamWeek(L, ctx, 0, 1);
  assert.ok(tw.total > 0, 'scores from the games in');
  const ids = Object.keys(tw.players), per = (id) => { const p = ctx.byId[id]; return p.t === 'GSW' || p.t === 'HOU' ? 20 : p.t === 'OKC' || p.t === 'POR' ? 5 : 10; };
  for (const id of ids) {
    const p = ctx.byId[id], pts = per(id), want = pts * 1 + 4 * 1.2 + 3 * 1.5 + 1 * 3 + 0 * 3 - 2 + 1 * 0.5;
    assert.ok(Math.abs(tw.players[id] - want * G.slotMult(L, G.lineupFor(L, ctx, 0, 1).indexOf(id), id)) < 1e-6, `${p.n}'s one game`);
  }
  Z.catchUp(L, ctx, end + 120e3);
  assert.equal(L.week, 1, 'one game is still going');
  Z.mergeGames(real, { games: { '401909975': { state: 'post', lines: { ...box(players, 'OKC', 8), ...box(players, 'POR', 8) } } } });
  Z.catchUp(L, ctx, end + 180e3);
  assert.equal(L.week, 2, 'closes the same night once every game is final');
  const st = G.standings(L);
  assert.equal(st.reduce((a, r) => a + r.w + r.l + r.t, 0), 4 * 3, 'everyone against everyone');
});

test('a showdown day league: the captain counts 1.5x, a postponed game ends the night with nothing', () => {
  const { sport, players, L, real } = dayLeague({ kind: 'one', ids: ['401909968'], teams: 3 });
  assert.equal(L.settings.mult.CPT, 1.5);
  assert.deepEqual(L.settings.lineup, ['CPT', 'UTIL', 'UTIL', 'UTIL', 'UTIL', 'UTIL']);
  const ctx = G.context(L, players, sport, { real });
  Z.mergeGames(real, { games: { '401909968': { state: 'post', lines: { ...box(players, 'BOS', 10), ...box(players, 'TOR', 10) } } } });
  const lu = G.lineupFor(L, ctx, 0, 1), tw = G.teamWeek(L, ctx, 0, 1);
  assert.ok(Math.abs(tw.players[lu[0]] - 1.5 * tw.players[lu[1]]) < 1e-6, 'the captain scores half again');
  // a finished game stays finished even if a later read says otherwise
  assert.equal(Z.mergeGames(real, { games: { '401909968': { state: 'in', lines: {} } } }), false);
  const b = dayLeague({ kind: 'one', ids: ['401909966'], teams: 2, seed: 9 });
  const c2 = G.context(b.L, b.players, b.sport, { real: b.real });
  Z.mergeGames(b.real, { games: { '401909966': { state: 'off', lines: {} } } });
  Z.catchUp(b.L, c2, G.weekStart(b.L, 2) + 1000);
  assert.equal(b.L.week, 2, 'a postponed game closes it');
});

test('live win chances read the night\'s own games', () => {
  const { sport, players, L, real } = dayLeague({ seed: 11 });
  const ctx = G.context(L, players, sport, { real });
  Z.mergeGames(real, { games: { '401909973': { state: 'in', lines: {} } } });
  const o = G.outlook(L, ctx, 0, 1);
  assert.ok(o && o.rem > 0, 'points still to come');
  assert.ok(o.left > 0 && o.left <= 9);
});
