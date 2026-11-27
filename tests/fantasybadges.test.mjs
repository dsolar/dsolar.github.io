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
  const D = F.create({ sport, teams, seed: 6, now: T0, scoring, botDelay: 0 });
  D.season = Object.assign({ format: 'h2h', weeks: 6, playoffTeams: 4 }, season);
  F.start(D, T0);
  let t = T0; const c = F.context(D, players, sport);
  for (let i = 0; i < 9000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, c, t); }
  const L = Z.begin(D, sport, { now: t });
  return { L, ctx: G.context(L, players, sport) };
}

test('badges: none before a week is final, then the weekly ones follow the results', () => {
  const { L, ctx } = league();
  assert.equal(G.badges(L, ctx).list.length, 0);
  Z.catchUp(L, ctx, L.start + 4 * WEEK + 1);
  const b = G.badges(L, ctx);
  for (const x of b.list) assert.ok(G.BADGES[x.id], `known badge ${x.id}`);
  // one top score a week (unless tied), each to the week's high scorer
  for (let w = 1; w <= 4; w++) {
    const tops = b.list.filter((x) => x.id === 'top' && x.week === w);
    assert.ok(tops.length <= 1);
    const rc = G.recap(L, ctx, w);
    if (tops.length) assert.equal(tops[0].team, rc.scores[0].team);
    // a nail-biter or blowout always goes to the winner of that game
    for (const x of b.list.filter((y) => (y.id === 'nail' || y.id === 'blowout') && y.week === w)) {
      const g = rc.games.find((gg) => gg.a === x.team || gg.b === x.team);
      assert.equal(g.w === 'a' ? g.a : g.b, x.team);
    }
  }
  assert.equal(b.list.filter((x) => x.id === 'record').length, 1, 'one season high');
  // byTeam holds the same badges
  assert.equal(Object.values(b.byTeam).flat().length, b.list.length);
});

test('badges: a full season ends with first place, the champion and the runner-up', () => {
  const { L, ctx } = league({ weeks: 4, playoffTeams: 2 });
  Z.catchUp(L, ctx, L.start + 12 * WEEK);
  assert.ok(L.week > G.totalWeeks(L), 'season over');
  const b = G.badges(L, ctx), f = G.finish(L);
  assert.deepEqual(b.list.filter((x) => x.id === 'champ').map((x) => x.team), [f.champion]);
  assert.deepEqual(b.list.filter((x) => x.id === 'runner').map((x) => x.team), [f.runnerUp]);
  assert.equal(b.list.filter((x) => x.id === 'first').length, 1);
});

test('badges: category leagues get nail-biters and sweeps, not points badges', () => {
  const { L, ctx } = league({ weeks: 4 }, 8, 'nba', 'cats9');
  Z.catchUp(L, ctx, L.start + 3 * WEEK + 1);
  const ids = new Set(G.badges(L, ctx).list.map((x) => x.id));
  for (const k of ['top', 'perfect', 'badbeat', 'heist', 'gem', 'record']) assert.ok(!ids.has(k), `no ${k} in categories`);
});

test('badges: the week-final email names the badges a team earned that week', () => {
  const { L, ctx } = league({ weeks: 6 }, 8);
  Z.catchUp(L, ctx, L.start + 2 * WEEK + 1);
  const base = JSON.parse(JSON.stringify({ draft: L.draft || null, league: L }));
  Z.catchUp(L, ctx, L.start + 3 * WEEK + 1);
  const seats = Object.fromEntries(L.teams.map((t) => [t.id, 'X']));
  const ev = Z.events(base, { draft: base.draft, league: L }, { name: 'T', url: 'u', seats, me: null, byId: ctx.byId, now: L.start + 3 * WEEK + 1 });
  const lite = G.badges(L, null).list.filter((x) => x.week === 3 && !['record', 'first', 'champ', 'runner'].includes(x.id));
  for (const x of lite) {
    const e = ev.find((y) => y.kind === 'week' && y.team === x.team);
    assert.ok(e && e.body.includes(G.BADGES[x.id].name), `${G.BADGES[x.id].name} in team ${x.team}'s email`);
  }
  assert.ok(lite.length > 0, 'some badge that week');
});
