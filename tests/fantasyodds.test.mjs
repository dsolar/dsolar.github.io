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

function league(season = {}, teams = 8, key = 'nfl', scoring = 'half') {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S[key]), data);
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams, scoring });
  const T0 = Date.UTC(2026, 9, 1);
  const D = F.create({ sport, teams, seed: 4, now: T0, scoring, botDelay: 0 });
  D.season = Object.assign({ format: 'h2h', weeks: 8, playoffTeams: 4 }, season);
  F.start(D, T0);
  let t = T0; const c = F.context(D, players, sport);
  for (let i = 0; i < 9000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, c, t); }
  const L = Z.begin(D, sport, { now: t });
  return { L, ctx: G.context(L, players, sport) };
}

test('playoff odds: shares add up to the playoff spots, and the marks are certain', () => {
  const { L, ctx } = league();
  const pre = G.playoffOdds(L, ctx, { sims: 400 });
  assert.ok(pre, 'odds before week 1');
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum(pre.odds) - 4) < 1e-9, 'four spots');
  assert.ok(Math.abs(sum(pre.top) - 1) < 1e-9, 'one first place');
  assert.equal(Object.keys(pre.clinched).length + Object.keys(pre.out).length, 0, 'nobody is certain yet');
  Z.catchUp(L, ctx, L.start + 6 * WEEK + 1);
  const mid = G.playoffOdds(L, ctx, { sims: 400 });
  assert.equal(mid.weeksLeft, 2);
  const st = G.standings(L);
  // the leader is likelier in than the last-place team
  assert.ok(mid.odds[st[0].team] >= mid.odds[st[st.length - 1].team]);
  // a mark never contradicts the record: a clinched team can't be passed, an out team can't catch up
  for (const t of Object.keys(mid.clinched)) assert.equal(mid.odds[t], 1);
  for (const t of Object.keys(mid.out)) assert.equal(mid.odds[t], 0);
  assert.ok(Math.abs(sum(mid.odds) - 4) < 1e-6);
  // same league, same answer: the page doesn't flicker
  assert.deepEqual(G.playoffOdds(L, ctx, { sims: 400 }).odds, mid.odds);
  Z.catchUp(L, ctx, L.start + 8 * WEEK + 1);
  assert.equal(G.playoffOdds(L, ctx), null, 'none once the regular season is over');
});

test('playoff odds: Clinched and Out hold in every way the last week can go', () => {
  let marks = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { L, ctx } = league({ weeks: 3, playoffTeams: 2 }, 4);
    L.seed = seed;
    Z.catchUp(L, ctx, L.start + 2 * WEEK + 1);
    const o = G.playoffOdds(L, ctx, { sims: 100 }), games = L.schedule[2];
    marks += Object.keys(o.clinched).length + Object.keys(o.out).length;
    // every result of week 3, with the team in question losing any tie on points
    for (let m = 0; m < 1 << games.length; m++) {
      for (const [mark, want] of [['clinched', true], ['out', false]]) for (const t of Object.keys(o[mark]).map(Number)) {
        const res = Object.assign({}, L.results, { 3: games.map(([a, b], k) => { const aw = (m >> k) & 1; const sa = aw ? 100 : 50, sb = aw ? 50 : 100;
          return { a, b, sa, sb, w: aw ? 'a' : 'b' }; }) });
        const st = G.standings(Object.assign({}, L, { results: res }), 3), me = st.find((r) => r.team === t);
        const ahead = st.filter((r) => r.team !== t && (want ? r.pct >= me.pct : r.pct > me.pct)).length;
        if (want) assert.ok(ahead < 2, `seed ${seed}: team ${t} marked clinched but could miss`);
        else assert.ok(ahead >= 2, `seed ${seed}: team ${t} marked out but could get in`);
      }
    }
  }
  assert.ok(marks > 0, 'some team was marked');
});

test('playoff odds: category leagues and guillotines', () => {
  const { L, ctx } = league({ weeks: 6 }, 8, 'nba', 'cats9');
  const o = G.playoffOdds(L, ctx, { sims: 200 });
  assert.ok(o && Math.abs(Object.values(o.odds).reduce((a, b) => a + b, 0) - 4) < 1e-9);
  const g = league({ format: 'guillotine' }, 8);
  assert.equal(G.playoffOdds(g.L, g.ctx), null);
});
