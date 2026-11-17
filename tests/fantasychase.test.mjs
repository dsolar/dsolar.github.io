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

function league(n, season, seed = 3) {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: n, lineup, scoring: 'half' });
  const T0 = Date.UTC(2026, 8, 1);
  const D = F.create({ sport, type: 'snake', teams: n, seed, now: T0, lineup, scoring: 'half', botDelay: 0 });
  D.season = season;
  let t = T0; F.start(D, t);
  const dctx = F.context(D, players, sport);
  for (let i = 0; i < 40000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, dctx, t); }
  const L = Z.begin(D, sport, { now: t });
  return { L, ctx: G.context(L, players, sport) };
}

test('the chase: eight teams play a quarterfinal, then the last four race over two weeks; totals give places 1 to 4', () => {
  const { L, ctx } = league(10, { format: 'h2h', weeks: 4, playoffTeams: 8, playoffFinal: 'chase', consolation: 'third' });
  assert.equal(L.settings.playoffFinal, 'chase');
  assert.equal(L.settings.consolation, 'none', 'the chase places third itself');
  const plan = G.playoffPlan(L);
  assert.deepEqual(plan.map((r) => [r.name, r.weeks.length, !!r.chase]), [['Quarterfinals', 1, false], ['The Chase', 2, true]]);
  assert.equal(L.settings.playoffWeeks, 3);
  Z.catchUp(L, ctx, L.start + (G.totalWeeks(L) + 1) * WEEK + 1);
  const ps = G.postseason(L), qf = ps[0], ch = ps[1].chase;
  assert.equal(qf.main.filter((g) => g.res).length, 4);
  assert.deepEqual(ch.teams.slice().sort(), qf.main.map((g) => g.res.win).sort(), 'the four quarterfinal winners chase');
  for (const w of plan[1].weeks) {
    const kinds = L.results[w].filter((g) => g.kind === 'chase');
    assert.equal(kinds.length, 2, 'each chase week pairs the four so all four score');
  }
  // totals add both weeks
  for (const t of ch.teams) {
    const sum = plan[1].weeks.reduce((a, w) => { const g = L.results[w].find((x) => x.a === t || x.b === t); return a + (g.a === t ? g.sa : g.sb); }, 0);
    assert.ok(Math.abs(ch.totals[t] - sum) < 0.02);
  }
  const fin = G.finish(L);
  assert.equal(fin.champion, ch.order[0]);
  assert.equal(fin.runnerUp, ch.order[1]);
  assert.equal(fin.third, ch.order[2]);
  assert.deepEqual(Object.values(fin.places).sort(), [1, 2, 3, 4]);
  assert.ok(ch.totals[ch.order[0]] >= ch.totals[ch.order[1]]);
});

test('the chase needs four playoff teams; four go straight in; the commissioner can switch it on before the playoffs', () => {
  const a = league(6, { format: 'h2h', weeks: 4, playoffTeams: 3, playoffFinal: 'chase' }).L;
  assert.ok(!a.settings.playoffFinal, 'three playoff teams: a normal bracket');
  const b = league(6, { format: 'h2h', weeks: 4, playoffTeams: 4, playoffFinal: 'chase', chaseWeeks: 3 }).L;
  assert.deepEqual(G.playoffPlan(b).map((r) => [r.name, r.weeks.length]), [['The Chase', 3]]);
  const { L } = league(8, { format: 'h2h', weeks: 4, playoffTeams: 4 });
  assert.equal(G.playoffPlan(L).length, 2);
  const r = G.setRules(L, { playoffFinal: 'chase', chaseWeeks: 2 }, L.start);
  assert.ok(r.ok, r.why);
  assert.deepEqual(G.playoffPlan(L).map((x) => x.name), ['The Chase']);
  assert.equal(L.settings.playoffWeeks, 2);
});
