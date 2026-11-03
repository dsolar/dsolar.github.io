import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const V = require('../fantasy-kit/value.js');
const F = require('../fantasy-kit/draft.js');
const G = require('../fantasy-kit/league.js');
const Z = require('../fantasy-kit/season.js');
const WEEK = 7 * 864e5;

function league(key, season, teams = 8, scoring) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S[key]), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  scoring = scoring || Object.keys(sport.scorings)[0];
  V.evaluate(sport, players, { teams, lineup, scoring });
  const T0 = Date.UTC(2026, 9, 1);
  const D = F.create({ sport, teams, seed: 3, now: T0, lineup, scoring, botDelay: 0, bench: teams > 14 ? 3 : undefined });
  D.season = season;
  F.start(D, T0);
  let t = T0; const ctx0 = F.context(D, players, sport);
  for (let i = 0; i < 20000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, ctx0, t); }
  assert.equal(D.phase, 'done');
  const L = Z.begin(D, sport, { now: t });
  return { L, ctx: G.context(L, players, sport), sport, players };
}
const playTo = (s, w) => Z.catchUp(s.L, s.ctx, s.L.start + w * WEEK + 1);

test('six playoff teams: the top two get byes, and the bracket still ends in one final', () => {
  const s = league('nfl', { format: 'h2h', weeks: 4, playoffTeams: 6, consolation: 'third' });
  const { L } = s;
  assert.deepEqual(G.playoffPlan(L).map((r) => r.name), ['Quarterfinals', 'Semifinals', 'Final']);
  assert.equal(G.totalWeeks(L), 7);
  playTo(s, 4);
  const seeds = G.standings(L).slice(0, 6).map((r) => r.team);
  const q = G.playoffGames(L, s.ctx, 5);
  assert.deepEqual(q.map((g) => [g[0], g[1]]), [[seeds[2], seeds[5]], [seeds[3], seeds[4]]], 'three plays six, four plays five');
  playTo(s, 5);
  const semis = G.playoffGames(L, s.ctx, 6);
  assert.equal(semis.length, 2);
  assert.equal(semis[0][0], seeds[0], 'the top seed waits for the lowest seed left');
  assert.equal(semis[1][0], seeds[1]);
  playTo(s, 7);
  assert.ok(L.week > G.totalWeeks(L));
  const fin = G.finish(L);
  assert.ok(fin.champion != null && fin.runnerUp != null && fin.third != null);
  assert.equal(L.results[7].length, 2, 'the final and the third-place game');
  assert.equal(L.results[7][1].kind, 'third');
  const sf = L.results[6].map((g) => (g.w === 'b' ? g.b : g.a));
  assert.deepEqual([L.results[7][0].a, L.results[7][0].b].sort(), sf.sort(), 'the semifinal winners meet in the final');
  assert.equal(Z.summary(L).champion.team, fin.champion);
});

test('a two-week final adds both weeks up', () => {
  const s = league('nba', { format: 'h2h', weeks: 3, playoffTeams: 4, playoffLegs: 'final2' }, 6, 'points');
  const { L } = s;
  assert.deepEqual(G.playoffPlan(L).map((r) => r.weeks), [[4], [5, 6]]);
  playTo(s, 6);
  assert.ok(L.week > G.totalWeeks(L));
  const [g1] = L.results[5], [g2] = L.results[6];
  assert.equal(g1.a, g2.a); assert.equal(g1.b, g2.b);
  const ta = g1.sa + g2.sa, tb = g1.sb + g2.sb;
  assert.equal(G.finish(L).champion, tb > ta ? g1.b : g1.a);
});

test('every round two weeks, with a consolation bracket for the teams that missed', () => {
  const s = league('nfl', { format: 'h2h', weeks: 3, playoffTeams: 4, playoffLegs: 'all2', consolation: 'bracket' }, 10);
  const { L } = s;
  assert.equal(G.totalWeeks(L), 7);
  playTo(s, 3);
  const st = G.standings(L);
  const games = G.playoffGames(L, s.ctx, 4);
  const cons = games.filter((g) => g.kind === 'cons');
  assert.equal(games.filter((g) => g.kind === 'title').length, 2);
  // teams 5 through 8 play for the consolation title (the best four of the rest, two rounds to match)
  assert.deepEqual(cons.map((g) => [g[0], g[1]]), [[st[4].team, st[7].team], [st[5].team, st[6].team]]);
  playTo(s, 7);
  const fin = G.finish(L);
  assert.ok(fin.champion != null && fin.consolation != null);
  assert.ok(st.slice(4, 8).some((r) => r.team === fin.consolation));
  // regular-season standings don't count playoff games
  assert.equal(G.standings(L).reduce((a, r) => a + r.w + r.l + r.t, 0), 3 * 10);
});

test('the result emails name the round and add up two-week games', () => {
  const s = league('nfl', { format: 'h2h', weeks: 3, playoffTeams: 4, playoffLegs: 'final2' }, 4);
  const { L } = s;
  playTo(s, 4);
  const o = { name: 'T', url: 'u', seats: { 0: 'A', 1: 'B', 2: 'C', 3: 'D' }, byId: s.ctx.byId, now: Date.now() };
  let before = JSON.parse(JSON.stringify(L));
  playTo(s, 5);
  let ev = Z.events({ league: before }, { league: L }, o);
  assert.ok(ev.some((e) => /final, week 1 of 2/.test(e.subject) && /with a week to go/.test(e.body)), JSON.stringify(ev.map((e) => e.subject)));
  before = JSON.parse(JSON.stringify(L));
  playTo(s, 6);
  ev = Z.events({ league: before }, { league: L }, o);
  assert.ok(ev.some((e) => /won the championship/.test(e.subject) && /over the two weeks/.test(e.body)));
  assert.ok(ev.some((e) => /finished second/.test(e.subject)));
});

test('twenty teams draft and play a season', () => {
  const s = league('nfl', { format: 'h2h', weeks: 3, playoffTeams: 12 }, 20);
  const { L } = s;
  assert.equal(L.teams.length, 20);
  assert.ok(L.rosters.every((r) => r.length === L.rosters[0].length));
  assert.deepEqual(G.playoffPlan(L).map((r) => r.name), ['Round 1', 'Quarterfinals', 'Semifinals', 'Final']);
  playTo(s, 3);
  assert.equal(G.playoffGames(L, s.ctx, 4).length, 4, 'twelve teams: four byes, four games');
  playTo(s, 7);
  assert.ok(G.finish(L).champion != null);
});

test('kickers and defenses go late, like real drafts', () => {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  for (const scoring of ['std', 'half', 'ppr']) {
    const players = data.players.map((p) => ({ ...p }));
    V.evaluate(sport, players, { teams: 10, lineup: sport.lineup, scoring });
    const best = (pos) => players.filter((p) => p.pos[0] === pos).sort((a, b) => a.rank - b.rank)[0];
    assert.ok(best('K').rank > 90, `top kicker ranked ${best('K').rank} in ${scoring}`);
    assert.ok(best('DEF').rank > 85, `top defense ranked ${best('DEF').rank} in ${scoring}`);
    assert.ok(best('K').$ <= 4 && best('DEF').$ <= 5);
  }
});
