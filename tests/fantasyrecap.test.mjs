import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const V = require('../fantasy-kit/value.js');
const F = require('../fantasy-kit/draft.js');
const G = require('../fantasy-kit/league.js');
const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const DAY = 864e5;

function season(key, opts = {}) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S[key]), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 10, lineup, scoring: opts.scoring });
  const D = F.create({ sport, teams: 10, seed: 11, now: T0, lineup, botDelay: 0, scoring: opts.scoring });
  D.teams[0].owner = 'David';
  const dctx = F.context(D, players, sport);
  F.start(D, T0); D.teams[0].auto = true; F.tick(D, dctx, T0 + 1); D.teams[0].auto = false;
  assert.equal(D.phase, 'done');
  const L = G.create({ sport, draft: D, now: T0, start: T0, settings: Object.assign({ weeks: 10, playoffTeams: 4, tradeReview: opts.review || 'none' }, opts.settings) });
  const ctx = G.context(L, players, sport);
  return { sport, players, D, L, ctx };
}

function play(s, weeks) {
  const r = F.rng(5);
  let now = T0;
  for (let i = 0; i < weeks; i++) { now += 7 * DAY; G.botWeek(s.L, s.ctx, now, r); G.tick(s.L, s.ctx, now); G.finishWeek(s.L, s.ctx, now); }
  return now;
}

test('recap: a points week tells the results, the top players and each lineup call', () => {
  const s = season('nfl', { scoring: 'half' });
  assert.equal(G.recap(s.L, s.ctx, 1), null, 'nothing before the week is final');
  play(s, 3);
  const rc = G.recap(s.L, s.ctx, 3);
  assert.ok(rc && rc.pts);
  assert.equal(rc.games.length, 5);
  assert.equal(rc.scores.length, 10);
  assert.ok(rc.high.score >= rc.low.score);
  assert.ok(rc.blowout.margin >= rc.close.margin);
  assert.equal(rc.top.length, 5);
  assert.ok(rc.top[0].pts >= rc.top[4].pts);
  assert.equal(rc.calls.length, 10, 'every team gets a lineup call');
  for (const c of rc.calls) {
    assert.ok(Math.abs(c.best - c.gap - c.score) < 0.05, `${c.team}: best ${c.best} = score ${c.score} + gap ${c.gap}`);
    if (c.gap > 0.05) assert.ok(c.miss && c.over && c.miss.pts > c.over.pts, 'the bench player outscored the starter he should have replaced');
    else assert.ok(rc.perfect.includes(c.team));
    if (c.cost) { const g = rc.games.find((x) => x.a === c.team || x.b === c.team); assert.ok(c.best > (g.a === c.team ? g.sb : g.sa)); }
  }
  // gaps run biggest first
  for (let i = 1; i < rc.calls.length; i++) assert.ok(rc.calls[i - 1].gap >= rc.calls[i].gap);
  // standings moves agree with the standings
  const was = G.standings(s.L, 2), now = G.standings(s.L, 3);
  if (rc.climb) assert.equal(was.find((r) => r.team === rc.climb.team).rank - now.find((r) => r.team === rc.climb.team).rank, rc.climb.by);
});

test('recap: a player picked up after the week never counts as a bench miss', () => {
  const s = season('nfl', { scoring: 'half' });
  play(s, 2);
  const rc0 = G.recap(s.L, s.ctx, 1);
  // pick up the best free agent of week 1 for the team with the biggest gap
  const t = rc0.calls[0].team;
  const fa = s.ctx.free.map((p) => [p, G.playerWeek(s.L, s.ctx, p, 1, 1).pts]).sort((a, b) => b[1] - a[1])[0][0];
  s.L.rosters[t].push(fa.id); (s.L.joined = s.L.joined || {})[fa.id] = { team: t, week: s.L.week, f: 0 };
  const rc = G.recap(s.L, s.ctx, 1);
  assert.notEqual(rc.calls.find((c) => c.team === t).miss?.pid, fa.id);
});

test('recap: a category week has results and moves but no points stories', () => {
  const s = season('nba', { scoring: 'cats9' });
  play(s, 2);
  const rc = G.recap(s.L, s.ctx, 2);
  assert.equal(rc.pts, false);
  assert.equal(rc.high, null);
  assert.deepEqual(rc.calls, []);
  assert.equal(rc.games.length, 5);
});

test('recap: roto has none', () => {
  const s = season('nba', { scoring: 'cats9', settings: { format: 'roto' } });
  play(s, 1);
  assert.equal(G.recap(s.L, s.ctx, 1), null);
});

test('recap: the weekly result alert opens the recap', () => {
  const Z = require('../fantasy-kit/season.js');
  const s = season('nfl', { scoring: 'half' });
  const before = JSON.parse(JSON.stringify(s.L));
  play(s, 1);
  const ev = Z.events({ league: before }, { league: s.L }, { name: 'Sunday', url: 'https://x/play.html?id=a', seats: { 0: 'Dave', 1: 'Yan' }, me: null, now: T0 + 8 * DAY });
  const wk = ev.filter((e) => e.kind === 'week');
  assert.ok(wk.length >= 2);
  for (const e of wk) assert.match(e.body, /Open the league: https:\/\/x\/play\.html\?id=a#league\/recap\/1$/m);
});
