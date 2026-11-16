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
const WEEK = 7 * 864e5, DAY = 864e5;

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
  return { L, D, ctx: G.context(L, players, sport) };
}

test('ladder: starts upside down from the draft, challenges up to two rungs, first come first served', () => {
  const { L, D, ctx } = league(8, { format: 'h2h', weeks: 5, playoffTeams: 0, ladder: { reach: 2 }, divisions: 2, median: true });
  assert.deepEqual(L.settings.ladder, { reach: 2 });
  assert.ok(!L.divs && !L.settings.median, 'no divisions or median game on a ladder');
  assert.deepEqual(L.ladder.order, D.round1.slice().reverse(), 'the first pick starts at the bottom');
  assert.equal(L.ladder.week, 1);
  assert.deepEqual(L.schedule[0], [], 'no schedule until challenges close');
  const o = L.ladder.order, now = L.created + 1000;
  // the bottom team can reach two rungs up, no further
  assert.deepEqual(G.ladderTargets(L, o[7]), [o[6], o[5]]);
  assert.equal(G.ladderChallenge(L, o[7], o[4], now).ok, false);
  assert.ok(G.ladderChallenge(L, o[7], o[5], now).ok);
  // o[5] is booked: o[6] can't take it, can't challenge after being... o[6] is free and can take o[4]
  assert.equal(G.ladderChallenge(L, o[6], o[5], now).ok, false);
  assert.equal(G.ladderChallenge(L, o[5], o[4], now).ok, false, 'a challenged team cannot challenge');
  assert.ok(G.ladderChallenge(L, o[6], o[4], now).ok);
  assert.deepEqual(G.ladderTargets(L, o[0]), [], 'nobody above the top');
  // challenges close at the first game; the rest are paired from the bottom up
  G.ladderDone(L, now + 1);
  assert.equal(L.schedule[0].length, 4);
  assert.equal(new Set(L.schedule[0].flat()).size, 8, 'everyone has a match');
  assert.deepEqual(L.schedule[0][0], [o[7], o[5]]);
});

test('ladder: a challenger who wins swaps rungs; the ladder is the standings; the top rung wins with no playoffs', () => {
  const { L, ctx } = league(7, { format: 'h2h', weeks: 4, playoffTeams: 0, ladder: { reach: 2 } }, 9);
  Z.catchUp(L, ctx, L.start + 1 * WEEK + 1);
  assert.equal(L.week, 2);
  const start = L.ladder.after[1] ? Object.values(L.ladder.moves[1]) : [];
  // week 1: odd teams, one sits out; every swap moved a lower team up
  assert.equal(L.schedule[0].length, 3);
  const before = L.ladder.start, after = L.ladder.after[1];
  for (const [lo, hi] of L.ladder.moves[1]) {
    assert.ok(before.indexOf(lo) > before.indexOf(hi));
    assert.equal(after.indexOf(lo), before.indexOf(hi)); assert.equal(after.indexOf(hi), before.indexOf(lo));
    const g = L.results[1].find((x) => (x.a === lo && x.b === hi) || (x.a === hi && x.b === lo));
    assert.equal(g.a === lo ? g.w : (g.w === 'a' ? 'b' : 'a'), 'a', 'the challenger won');
  }
  // a defender who won (or tied) kept his rung
  for (const g of L.results[1]) {
    const moved = L.ladder.moves[1].some(([x, y]) => [x, y].includes(g.a));
    if (!moved) { assert.equal(after.indexOf(g.a), before.indexOf(g.a)); assert.equal(after.indexOf(g.b), before.indexOf(g.b)); }
  }
  assert.deepEqual(G.standings(L).map((r) => r.team), after, 'standings follow the ladder');
  assert.equal(L.ladder.week, 2, 'next week open');
  Z.catchUp(L, ctx, L.start + (G.totalWeeks(L) + 1) * WEEK + 1);
  assert.equal(G.finish(L).champion, L.ladder.order[0]);
  assert.deepEqual(G.standings(L, 1).map((r) => r.team), after, 'history: the ladder after week 1');
});
