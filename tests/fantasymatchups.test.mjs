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
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

// the weekly file with a schedule laid on from the NFL hub's games, the way tools/fantasykit_data.py writes it
function real() {
  const R = read('../fantasy-kit/data/weeks-nfl.json'), lg = read('../nfl/data/league.json'), sched = {};
  for (const g of lg.games) if (g[0] === 'REG' && g[1] >= 1 && g[1] <= 18) {
    (sched[g[3]] = sched[g[3]] || Array(18).fill(null))[g[1] - 1] = '@' + g[4];
    (sched[g[4]] = sched[g[4]] || Array(18).fill(null))[g[1] - 1] = g[3];
  }
  return Object.assign({}, R, { sched });
}

function league(scoring = 'ppr') {
  const data = read('../fantasy-kit/data/nfl.json');
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 8, scoring });
  const R = real(), T0 = Date.parse(R.weeks['1'].start + 'T12:00:00Z');
  const D = F.create({ sport, teams: 8, seed: 3, now: T0, scoring, botDelay: 0 });
  D.season = { format: 'h2h', weeks: 14, playoffTeams: 4 };
  F.start(D, T0);
  let t = T0; const c = F.context(D, players, sport);
  for (let i = 0; i < 9000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, c, t); }
  const L = Z.begin(D, sport, { now: t });
  return { L, ctx: G.context(L, players, sport, { real: R }), R };
}

test('matchups: every position ranks each defense once, 1 to n, fewest points allowed first', () => {
  const { L, ctx } = league();
  const mr = G.matchupRanks(L, ctx);
  assert.ok(mr, 'ranks from the weekly file');
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const ranks = Object.values(mr.rank).map((r) => r[pos]).filter(Boolean).sort((a, b) => a - b);
    assert.equal(ranks.length, mr.n[pos]);
    assert.deepEqual(ranks, ranks.map((_, i) => i + 1), `${pos} ranks run 1 to n`);
    const byRank = Object.keys(mr.rank).filter((d) => mr.rank[d][pos]).sort((a, b) => mr.rank[a][pos] - mr.rank[b][pos]);
    for (let i = 1; i < byRank.length; i++) assert.ok(mr.avg[byRank[i]][pos] >= mr.avg[byRank[i - 1]][pos], 'more allowed ranks higher');
  }
  assert.equal(G.matchupRanks(L, ctx), mr, 'cached');
});

test("matchups: a player's opponent comes from his team's schedule, and a bye is a bye", () => {
  const { L, ctx, R } = league();
  const lw = 3, nw = Math.round((G.weekStart(L, lw) - Date.parse(R.weeks['1'].start + 'T12:00:00Z')) / (7 * 864e5)) + 1;
  const p = ctx.players.find((x) => (x.pos || [])[0] === 'WR' && R.sched[x.t] && R.sched[x.t][nw - 1]);
  const m = G.matchupOf(L, ctx, p, lw);
  assert.equal(m.opp, R.sched[p.t][nw - 1]);
  assert.equal(m.home, m.opp[0] !== '@');
  assert.ok(m.rank >= 1 && m.rank <= m.n);
  assert.ok(['easy', 'tough', ''].includes(m.ease));
  const q = ctx.players.find((x) => R.sched[x.t] && R.sched[x.t].some((o) => o == null));
  const bw = R.sched[q.t].indexOf(null) + 1, lwb = lw + (bw - nw);
  if (lwb >= 1) assert.deepEqual(G.matchupOf(L, ctx, q, lwb), { bye: true });
});

test('matchups: none for a category league or another sport', () => {
  const { L, ctx } = league();
  assert.equal(G.matchupRanks(Object.assign({}, L, { sport: 'nba' }), Object.assign({}, ctx, { sport: S.nba })), null);
  assert.equal(G.matchupOf(L, Object.assign({}, ctx, { hooks: {} }), ctx.players[0], 2), null);
});
