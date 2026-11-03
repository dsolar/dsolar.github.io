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
const DAY = 864e5, WEEK = 7 * DAY;

// A drafted league from the start-a-league path: D.season and D.scoringSpec in, Z.begin out.
function league(key, season, spec, opts = {}) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.withScoring(S.attach(Object.assign({}, S[key]), data), spec);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  const scoring = spec ? 'custom' : opts.scoring || Object.keys(sport.scorings)[0];
  const n = opts.teams || 6;
  V.evaluate(sport, players, { teams: n, lineup, scoring });
  const T0 = Date.UTC(2026, 9, 1);
  const D = F.create({ sport, teams: n, seed: opts.seed || 4, now: T0, lineup, scoring, botDelay: 0 });
  D.season = season; if (spec) D.scoringSpec = spec;
  F.start(D, T0); F.tick(D, F.context(D, players, sport), T0 + 1, 5000);
  const L = Z.begin(D, sport, { now: T0 + 1 });
  return { sport, players, L, ctx: G.context(L, players, sport), D };
}
const play = (s, weeks) => Z.catchUp(s.L, s.ctx, s.L.start + weeks * WEEK + 1);

test('custom points: the stat values decide who is worth what, and weeks score with them', () => {
  const big = league('nba', { format: 'h2h', weeks: 4, playoffTeams: 2 }, { type: 'points', weights: { blk: 10 } });
  const top = big.players.slice().sort((a, b) => b.v - a.v)[0];
  const blockers = big.players.slice().sort((a, b) => (S.stat(big.sport, b, 'pg', 'blk') || 0) - (S.stat(big.sport, a, 'pg', 'blk') || 0)).slice(0, 15).map((p) => p.id);
  assert.ok(blockers.includes(top.id), `${top.n} tops a blocks-only league`);
  assert.equal(G.scoring(big.L, big.ctx).label, 'Custom points');
  play(big, 3);
  assert.ok(big.L.results[1].every((g) => g.sa >= 0 && g.sb >= 0));
  // football custom points read raw stats: six-point passing touchdowns lift quarterbacks
  const qb = league('nfl', { format: 'h2h', weeks: 4 }, { type: 'points', weights: Object.assign({}, S.POINT_DEFAULTS.nfl, { pass_td: 6 }) });
  const base = league('nfl', { format: 'h2h', weeks: 4 }, { type: 'points', weights: S.POINT_DEFAULTS.nfl });
  const allen = (s) => s.players.find((p) => /Josh Allen/.test(p.n) && p.pos.includes('QB'));
  assert.ok(allen(qb).fpts > allen(base).fpts, 'more for passing touchdowns');
  assert.ok(allen(qb).proj > 0, 'a projection scaled from Sleeper\'s');
});

test('custom categories: pick the categories, including ones no preset has', () => {
  const s = league('mlb', { format: 'h2h', weeks: 3, playoffTeams: 0 }, { type: 'cats', cats: ['hr', 'obp', 'k', 'era'] });
  assert.deepEqual(G.scoring(s.L, s.ctx).cats.map((c) => c.k), ['hr', 'obp', 'k', 'era']);
  play(s, 3);
  const g = s.L.results[1][0];
  assert.equal(g.sa + g.sb + g.ties, 4, 'four categories decided the game');
});

test('head to head, each category counts: a 6-3 week is six wins and three losses', () => {
  const s = league('nba', { format: 'h2h', tally: 'cats', weeks: 3, playoffTeams: 0 }, null, { scoring: 'cats9' });
  play(s, 3);
  const st = G.standings(s.L);
  const games = Object.values(s.L.results).flat();
  const wins = games.reduce((a, g) => a + g.sa + g.sb, 0), ties = games.reduce((a, g) => a + (g.ties || 0), 0);
  assert.equal(st.reduce((a, r) => a + r.w, 0), wins);
  assert.equal(st.reduce((a, r) => a + r.t, 0), 2 * ties);
  assert.equal(st.reduce((a, r) => a + r.w + r.l + r.t, 0), 3 * (s.L.teams.length / 2) * 2 * 9, 'nine decisions per team per week');
});

test('all-play: every team against every other team, every week', () => {
  const s = league('nfl', { format: 'h2h', tally: 'allplay', weeks: 3, playoffTeams: 0 }, null, { scoring: 'half' });
  play(s, 3);
  const n = s.L.teams.length, st = G.standings(s.L);
  assert.equal(st.reduce((a, r) => a + r.w + r.l + r.t, 0), 3 * n * (n - 1));
  const week1 = s.L.results[1].flatMap((g) => [[g.a, g.sa], [g.b, g.sb]]).sort((a, b) => b[1] - a[1]);
  const top = G.standings(s.L, 1).find((r) => r.team === week1[0][0]);
  assert.equal(top.w, n - 1, 'the week\'s high score beats everyone');
});

test('rotisserie: season totals ranked in each category, n points for the best', () => {
  const s = league('nba', { format: 'roto', weeks: 4 }, null, { scoring: 'cats9' });
  assert.equal(G.isRoto(s.L), true);
  assert.equal(G.matchups(s.L, s.ctx, 1).length, 0, 'no weekly games');
  assert.equal(s.L.settings.playoffTeams, 0);
  play(s, 2);
  assert.equal(s.L.week, 3);
  const n = s.L.teams.length, st = G.standings(s.L);
  assert.equal(st.reduce((a, r) => a + r.pts, 0), 9 * (n * (n + 1)) / 2, 'every category hands out 1 to n');
  assert.ok(st[0].pts >= st[1].pts);
  // a rate stat totals its parts: season FG% is all makes over all attempts
  const t = st[0].team, parts = [1, 2].map((w) => s.L.results[w].roto[t].parts.fg);
  assert.ok(Math.abs(st[0].vals.fg - (parts[0][0] + parts[1][0]) / (parts[0][1] + parts[1][1])) < 1e-9);
  // turnovers are better low: the fewest gets the most points
  const tovLow = st.slice().sort((a, b) => a.vals.tov - b.vals.tov)[0];
  assert.equal(tovLow.catPts.tov, n);
  // the week in progress can count toward live standings
  const live = G.standings(s.L, null, G.rotoLive(s.L, s.ctx, 0.5));
  assert.equal(live.length, n);
  // and the season ends with first place as champion, no playoffs
  play(s, 6);
  assert.ok(s.L.week > G.totalWeeks(s.L));
  const ev = Z.events({ league: Object.assign({}, s.L, { results: { 1: s.L.results[1] } }) }, { league: s.L }, { name: 'T', url: 'u', seats: { 0: 'A', 1: 'B' }, byId: {} });
  assert.ok(ev.some((e) => /standings/.test(e.subject) && /roto points/.test(e.body)));
});

test('roster rules: pickup limit, position limits, IR spots, rolling waivers', () => {
  const s = league('nfl', { format: 'h2h', weeks: 4, maxAdds: 1, posMax: { K: 1 }, ir: 2, waivers: 'rolling' }, null, { scoring: 'half' });
  const { L, ctx } = s;
  assert.equal(L.settings.ir, 2); assert.equal(L.settings.waivers, 'rolling'); assert.equal(L.settings.maxAdds, 1);
  const at = L.start + DAY;
  const free = (pos) => ctx.free.filter((p) => !G.onWaivers(L, p.id, at) && (!pos || p.pos[0] === pos));
  const drop = (t, notPos) => L.rosters[t].map((id) => ctx.byId[id]).filter((p) => p.pos[0] !== notPos && p.pos[0] !== 'QB').sort((a, b) => a.v - b.v)[0].id;
  // a second kicker is over the limit (if the team already has one)
  const hasK = L.rosters[0].some((id) => ctx.byId[id].pos[0] === 'K');
  if (hasK) assert.match(G.addDrop(L, ctx, 0, free('K')[0].id, drop(0, 'K'), at).why, /at most 1 K/);
  // one pickup a week
  assert.ok(G.addDrop(L, ctx, 0, free('WR')[0].id, drop(0, 'K'), at).ok);
  assert.match(G.addDrop(L, ctx, 0, free('WR')[0].id, drop(0, 'K'), at + 1).why, /pickups this week/);
  assert.equal(G.pickupsLeft(L, 0), 0);
  // rolling waivers: claims need no bid, and FAAB doesn't move
  const c = G.claim(L, ctx, 1, free('RB')[0].id, drop(1, 'K'), 0, at);
  assert.ok(c.ok, c.why);
  const before = L.teams[1].faab;
  G.runWaivers(L, ctx, at + 2 * DAY);
  assert.equal(L.teams[1].faab, before);
  assert.ok(L.claims.some((x) => x.team === 1 && x.status === 'won'));
});
