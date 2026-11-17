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

// Total points: no weekly games, no playoffs; every point all season adds up and the most points wins.
for (const [key, scoring] of [['nfl', 'half'], ['nba', 'points'], ['nhl', 'points']]) {
  test(`total points (${key}): season points add up, most points wins`, () => {
    const s = league(key, { format: 'total', weeks: 4, playoffTeams: 4, divisions: 2, median: true, ladder: { reach: 2 }, robin: { protect: 2 } }, null, { scoring });
    const { L, ctx } = s;
    assert.equal(G.isTotal(L), true);
    assert.equal(L.settings.format, 'total');
    assert.equal(L.settings.playoffTeams, 0, 'no playoffs');
    assert.equal(G.totalWeeks(L), 4);
    assert.ok(!L.divs && !L.settings.median && !L.settings.ladder && !L.settings.robin, 'no head-to-head extras');
    assert.equal(G.matchups(L, ctx, 1).length, 0, 'no weekly games');
    play(s, 2);
    assert.equal(L.week, 3);
    const n = L.teams.length;
    for (const w of [1, 2]) {
      const res = L.results[w].total;
      assert.equal(res.length, n, 'every team scores every week');
      assert.deepEqual(res.map((r) => r.rank).sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i + 1));
      assert.ok(res.every((r) => r.score >= 0 && Number.isFinite(r.score)));
    }
    const st = G.standings(L);
    for (const r of st) {
      const sum = L.results[1].total.find((x) => x.team === r.team).score + L.results[2].total.find((x) => x.team === r.team).score;
      assert.ok(Math.abs(r.pf - sum) < 0.02, 'the season total is the weeks added up');
      assert.equal(r.gb, Math.round((st[0].pf - r.pf) * 100) / 100);
    }
    for (let i = 1; i < st.length; i++) assert.ok(st[i - 1].pf >= st[i].pf, 'most points first');
    assert.equal(st.reduce((a, r) => a + r.top, 0), 2, 'one week winner a week');
    // the week in progress counts toward live standings
    const live = G.totalLive(L, ctx, 0.5), ls = G.standings(L, null, live);
    assert.equal(ls.length, n);
    for (const r of ls) assert.ok(r.pf >= st.find((x) => x.team === r.team).pf - 1e-9);
    // records: the season's high and low weeks
    const rec = G.records(L);
    assert.ok(rec.high && rec.low && rec.high.v >= rec.low.v);
    // the season ends with first place as champion
    play(s, 6);
    assert.ok(L.week > G.totalWeeks(L));
    const fin = G.finish(L), final = G.standings(L);
    assert.equal(fin.champion, final[0].team);
    assert.equal(G.summary(L).champion.team, final[0].team);
    assert.equal(G.recap(L, ctx, 1), null, 'no head-to-head recap');
    const ev = Z.events({ league: Object.assign({}, L, { results: { 1: L.results[1] } }) }, { league: L }, { name: 'T', url: 'u', seats: { 0: 'A', 1: 'B' }, byId: {} });
    assert.ok(ev.some((e) => /points/.test(e.subject) && /on the season/.test(e.body)));
  });
}

test('total points: the season\'s length is set by the format', () => {
  const s = league('nfl', { format: 'total', weeks: 4 }, null, { scoring: 'half' });
  assert.equal(G.setRules(s.L, { weeks: 6 }, s.L.start).ok, false);
  assert.equal(G.setRules(s.L, { median: true }, s.L.start).ok, false, 'no median game');
});
