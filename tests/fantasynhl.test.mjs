import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { SK_COLS, GOALIE_COLS, NHL_LINES, boxLines, mergeLines, finishLines, goalieRates, gameState } from '../supabase/functions/fk-live/nhl.mjs';
import { forecast } from '../tools/fantasykit_nhl.mjs';
const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js'), V = require('../fantasy-kit/value.js'), F = require('../fantasy-kit/draft.js');
const G = require('../fantasy-kit/league.js'), Z = require('../fantasy-kit/season.js');
const GD = require('../fantasy-kit/gameday.js');
const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nhl.json', import.meta.url)));
const W = JSON.parse(readFileSync(new URL('../fantasy-kit/data/weeks-nhl.json', import.meta.url)));
const T0 = Date.parse('2026-11-16T13:00:00Z');
const row = (cols, values) => cols.map((k) => values[k] || 0);
const gline = (x) => goalieRates(row(GOALIE_COLS, x));
function setup(scoring = 'cats10', opts = {}) {
  const sport = S.attach({ ...S.nhl }, structuredClone(data)), players = structuredClone(data.players);
  V.evaluate(sport, players, { teams: opts.teams || 10, scoring, budget: 200 });
  const D = F.create({ sport, scoring, teams: opts.teams || 10, seed: 411, now: T0, botDelay: 0, ...opts });
  return { sport, players, D, ctx: F.context(D, players, sport) };
}
function draft(s) {
  F.start(s.D, T0);
  for (let i = 1; i < 10000 && s.D.phase === 'live'; i++) F.tick(s.D, s.ctx, T0 + i * 60000, 1000);
  assert.equal(s.D.phase, 'done');
}

test('NHL pool carries real, uniquely identified skaters, goalies and contract provenance', () => {
  assert.ok(data.players.length > 600);
  assert.equal(new Set(data.players.map((p) => p.id)).size, data.players.length);
  assert.ok(data.players.filter((p) => p.pos.includes('G')).length >= 50);
  assert.ok(data.players.filter((p) => p.contract?.capHit > 0).length > 600);
  for (const p of data.players) {
    assert.ok(p.pos.every((ps) => S.nhl.positions.includes(ps)), p.n);
    for (const [key, values] of Object.entries(p.l)) {
      assert.equal(values.length, data.lines[key].cols.length);
      assert.ok(values.every(Number.isFinite), p.n + ' ' + key);
    }
    if (p.contract) assert.equal(p.contract.source, 'nhl-contracts (CC0)');
  }
});

test('hockey flex positions exclude goalies and recognize all skater positions', () => {
  assert.equal(S.fits(S.nhl, { pos: ['G'] }, 'UTIL'), false);
  assert.equal(S.fits(S.nhl, { pos: ['G'] }, 'F'), false);
  assert.equal(S.fits(S.nhl, { pos: ['LW'] }, 'W'), true);
  assert.equal(S.fits(S.nhl, { pos: ['D'] }, 'UTIL'), true);
  assert.equal(S.fits(S.nhl, { pos: ['C'] }, 'G'), false);
});

for (const scoring of ['cats10', 'bangers', 'points']) test(`NHL ${scoring}: a full bot draft fills every starting slot and stays within position limits`, () => {
  const s = setup(scoring); draft(s);
  const rosters = F.rosters(s.D);
  assert.equal(new Set(rosters.flat()).size, rosters.flat().length);
  assert.ok(s.players.every((p) => Number.isFinite(p.vor) && Number.isFinite(p.$)));
  for (const ids of rosters) {
    assert.equal(ids.length, 16);
    const ps = ids.map((id) => s.ctx.byId[id]);
    assert.equal(F.assign(s.sport, ps, s.D.lineup).filter(Boolean).length, 12);
    assert.ok(ps.filter((p) => p.pos.includes('G')).length <= 4);
  }
});

test('NHL auction finishes with legal rosters and nobody spending beyond $200', () => {
  const s = setup('points', { type: 'auction', budget: 200, bidClock: 10, nomClock: 10 }); draft(s);
  assert.ok(s.D.teams.every((t) => t.budget >= 0));
  assert.ok(F.rosters(s.D).every((r) => r.length === 16));
});

test('workload projections keep a backup goalie below a full-time skater', () => {
  const c = gline({ gp: 5, gs: 5, w: 2, min: 300, sa: 150, saves: 138, ga: 12 });
  const p = gline({ gp: 25, gs: 25, w: 10, min: 1500, sa: 750, saves: 690, ga: 60 });
  const out = forecast(c, p, GOALIE_COLS, 20, true);
  assert.ok(out[0] < 30 && out[0] > 15);
  assert.ok(Math.abs(out[GOALIE_COLS.indexOf('gaa')] - 2.4) < 0.001);
  assert.ok(Math.abs(out[GOALIE_COLS.indexOf('svp')] - 0.92) < 0.001);
  const s = setup('points');
  for (const g of s.players.filter((p) => p.pos.includes('G'))) assert.ok(g.projGames <= 65);
  const m = s.players.find((p) => p.id === '8478402');
  const actual = m.l.sk[SK_COLS.indexOf('g')] * 3 + m.l.sk[SK_COLS.indexOf('a')] * 2 + m.l.sk[SK_COLS.indexOf('ppp')] + m.l.sk[SK_COLS.indexOf('shp')] + m.l.sk[SK_COLS.indexOf('sog')] * 0.4 + m.l.sk[SK_COLS.indexOf('hits')] * 0.2 + m.l.sk[SK_COLS.indexOf('blk')] * 0.4;
  assert.ok(Math.abs(m.fpts - actual) < 1e-8, 'actual fantasy totals remain distinct from a forecast');
});

function boxFixture() {
  return { gameState: 'OFF', periodDescriptor: { periodType: 'REG' }, awayTeam: { abbrev: 'BOS', score: 2 }, homeTeam: { abbrev: 'NYR', score: 0 },
    playerByGameStats: { awayTeam: { forwards: [{ playerId: 1, toi: '20:00', goals: 1, assists: 1, points: 2, powerPlayGoals: 1, sog: 4, hits: 2, blockedShots: 1 }],
      goalies: [{ playerId: 10, toi: '60:00', starter: true, decision: 'W', saves: 30, shotsAgainst: 30, goalsAgainst: 0 }, { playerId: 11, toi: '00:00', saves: 0, shotsAgainst: 0 }] },
      homeTeam: { forwards: [{ playerId: 2, toi: '18:00', goals: 0, assists: 0, sog: 3 }], goalies: [{ playerId: 20, toi: '59:00', starter: true, decision: 'L', saves: 18, shotsAgainst: 20, goalsAgainst: 2 }] } } };
}
const landing = () => ({ summary: { scoring: [{ periodDescriptor: { periodType: 'REG' }, goals: [
  { playerId: 1, teamAbbrev: { default: 'BOS' }, strength: 'pp', assists: [{ playerId: 3 }, { playerId: 4 }] },
  { playerId: 3, teamAbbrev: { default: 'BOS' }, strength: 'sh', assists: [{ playerId: 1 }] },
] }] } });

test('NHL scoring includes power-play assists, shorthanded points and only goalies who played', () => {
  const b = boxFixture(); b.playerByGameStats.awayTeam.forwards.push({ playerId: 3, toi: '18:00', goals: 1, assists: 1 });
  const out = boxLines(b, landing());
  assert.equal(out['1'].sk[SK_COLS.indexOf('ppp')], 1);
  assert.equal(out['3'].sk[SK_COLS.indexOf('ppp')], 1, 'PP assist counts');
  assert.equal(out['1'].sk[SK_COLS.indexOf('shp')], 1);
  assert.equal(out['10'].goalie[GOALIE_COLS.indexOf('so')], 1);
  assert.equal(out['11'], undefined, 'unused backup has no appearance');
  assert.ok(Math.abs(G.realPts({ lines: NHL_LINES }, S.nhl.scorings.points, out['1'], { pos: ['C'] }) - 9.4) < 1e-9, 'custom points use the same box columns');
  assert.throws(() => boxLines(b, {}), /scoring summary/);
});

test('shutouts wait for the final and exclude shared shutouts and empty-net goals', () => {
  let b = boxFixture(); b.gameState = 'LIVE';
  assert.equal(boxLines(b, landing())['10'].goalie[8], 0);
  b = boxFixture(); b.playerByGameStats.awayTeam.goalies[1] = { playerId: 11, toi: '10:00', saves: 5, shotsAgainst: 5 };
  assert.equal(boxLines(b, landing())['10'].goalie[8], 0);
  b = boxFixture(); const l = landing(); l.summary.scoring[0].goals.push({ playerId: 2, teamAbbrev: { default: 'NYR' }, strength: 'ev', assists: [] });
  assert.equal(boxLines(b, l)['10'].goalie[8], 0, 'an empty-net goal breaks the team shutout');
});

test('shootout winners do not add skater goals or goalie goals against; a 0–0 shootout earns shutouts', () => {
  const b = boxFixture(); b.periodDescriptor.periodType = 'SO'; b.awayTeam.score = 1;
  b.playerByGameStats.homeTeam.goalies[0] = { playerId: 20, toi: '65:00', starter: true, decision: 'L', saves: 25, shotsAgainst: 25, goalsAgainst: 0 };
  const l = { summary: { scoring: [{ periodDescriptor: { periodType: 'SO' }, goals: [{ playerId: 1, strength: 'pp', teamAbbrev: { default: 'BOS' } }] }] } };
  const out = boxLines(b, l);
  assert.equal(out['1'].sk[6], 0, 'shootout is not a PP point');
  assert.equal(out['10'].goalie[8], 1); assert.equal(out['20'].goalie[8], 1);
  assert.equal(out['20'].goalie[GOALIE_COLS.indexOf('otl')], 1);
});

test('weekly goalie ratios use combined shots and ice time, not averages of percentages', () => {
  const combined = {};
  mergeLines(combined, { g: { goalie: gline({ gp: 1, gs: 1, min: 60, sa: 10, saves: 9, ga: 1 }) } });
  mergeLines(combined, { g: { goalie: gline({ gp: 1, gs: 1, min: 30, sa: 40, saves: 32, ga: 8 }) } });
  const final = finishLines(combined).g.goalie;
  assert.equal(final[GOALIE_COLS.indexOf('svp')], 41 / 50);
  assert.equal(final[GOALIE_COLS.indexOf('gaa')], 6);
  assert.equal(final[0], 2);
});

test('NHL matchup game boxes show skater and goalie stats and never substitute weekly totals', () => {
  const boxes = boxLines(boxFixture(), landing());
  const sk = Object.fromEntries(GD.stats('nhl', { pos: ['C'] }, boxes['1'], { lines: NHL_LINES }));
  assert.equal(sk.G, '1'); assert.equal(sk.PPP, '1'); assert.equal(sk.SOG, '4');
  const goalie = Object.fromEntries(GD.stats('nhl', { pos: ['G'] }, boxes['10'], { lines: NHL_LINES }));
  assert.equal(goalie.SV, '30'); assert.equal(goalie.GAA, '0.00'); assert.equal(goalie['SV%'], '1.000');
  assert.equal(GD.line('nhl', { id: '1', t: 'BOS' }, { id: '99', state: 'post' }, { players: boxes, games: { BOS: [{}, {}] } }), null);
});

test('NHL custom scoring, dynasty values and a guillotine season remain playable', () => {
  const sport = S.withScoring(S.attach({ ...S.nhl }, structuredClone(data)), { type: 'points', weights: { 'sk.g': 4, 'goalie.saves': 0.1 } });
  const ps = structuredClone(data.players);
  V.evaluate(sport, ps, { teams: 6, scoring: 'custom', dynasty: true });
  assert.ok(ps.every((p) => Number.isFinite(p.v) && Number.isFinite(p.vor)));
  const s = setup('points', { teams: 6 }); draft(s);
  const L = G.create({ sport: s.sport, draft: s.D, start: T0, settings: { format: 'guillotine', bestBall: true } });
  for (let w = 1; w <= 5; w++) G.finishWeek(L, G.context(L, s.players, s.sport), T0 + w * 604800000);
  assert.equal(L.alive.length, 1);
});

test('real NHL weekly scoring and goalie appearance minimums survive a full league week', () => {
  const s = setup(); draft(s);
  const start = Object.values(W.weeks).find((w) => w.final)?.start; assert.ok(start);
  const L = G.create({ sport: s.sport, draft: s.D, start: Date.parse(start + 'T13:00Z'), settings: { real: true, weeks: 12, minGoalieGames: 3 } });
  const ctx = G.context(L, s.players, s.sport, { real: W });
  const a = G.teamWeek(L, ctx, 0, 1), b = G.teamWeek(L, ctx, 1, 1);
  for (const v of Object.values(a.cats)) assert.ok(Number.isFinite(v));
  const count = G.lineupFor(L, ctx, 0, 1).filter(Boolean).filter((id) => ctx.byId[id].pos.includes('G')).reduce((sum, id) => sum + (G.playerWeek(L, ctx, ctx.byId[id], 1).goalie?.[0] || 0), 0);
  assert.equal(a.goalieGames, count);
  const empty = { cats: Object.fromEntries(Object.keys(a.cats).map((k) => [k, 0])), parts: { gaa: [0, 0], svp: [0, 0] }, goalieGames: 0 };
  const played = { ...b, parts: { ...b.parts, gaa: [180, 60], svp: [28, 30] }, goalieGames: 4 };
  const result = G.compare(L, ctx, empty, played);
  for (const k of ['wins', 'gaa', 'svp', 'so']) assert.equal(result.cats[k][2], -1, k);
});

test('NHL shared leagues retain daily lineups and lock only the game day', () => {
  const s = setup('points', { teams: 4 }); draft(s);
  s.D.season = { format: 'h2h', weeks: 10, daily: true, minGoalieGames: 3 };
  const L = Z.begin(s.D, s.sport, { now: T0, real: W });
  assert.equal(L.settings.daily, true);
  assert.equal(L.settings.minGoalieGames, 3);
  L.start = T0; L.settings.real = true;
  const p = s.players[0], at = T0 + 6 * 3600000;
  G.setKicks(L, { start: '2026-11-16', updated: new Date(T0).toISOString(), games: { [p.t]: [{ at: new Date(at).toISOString(), state: 'pre' }] } });
  assert.equal(G.isLocked(L, p, 1, at + 1), true);
  assert.equal(G.isLocked(L, p, 1, at + 86400000), false, 'a game yesterday does not lock today');
  assert.equal(gameState({ gameState: 'FUT', gameScheduleState: 'PPD' }), 'off');
});
