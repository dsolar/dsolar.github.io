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
  return { L, ctx: G.context(L, players, sport), sport };
}

test('the split: after its week the halves play only each other, and the top half finishes above the bottom', () => {
  const { L, ctx } = league(10, { format: 'h2h', weeks: 7, playoffTeams: 6, split: { after: 4 } });
  assert.deepEqual(L.settings.split.after, 4);
  assert.equal(L.settings.playoffTeams, 5, 'the playoffs fit in the top half');
  Z.catchUp(L, ctx, L.start + 4 * WEEK + 1);
  assert.equal(L.week, 5);
  assert.ok(L.split, 'split after week 4');
  const before = G.standings(L, 4).map((r) => r.team);
  assert.deepEqual(before.slice(0, 5).sort(), Object.keys(L.split.groups).filter((t) => L.split.groups[t] === 0).map(Number).sort());
  for (let w = 5; w <= 7; w++) {
    for (const [a, b] of L.schedule[w - 1]) {
      const same = L.split.groups[a] === L.split.groups[b];
      // two halves of five: the two teams left out each week play each other across the split
      if (!same) assert.equal(L.schedule[w - 1].filter(([x, y]) => L.split.groups[x] !== L.split.groups[y]).length, 1);
    }
    const teams = L.schedule[w - 1].flat();
    assert.equal(new Set(teams).size, 10, `week ${w}: everyone plays once`);
  }
  Z.catchUp(L, ctx, L.start + (G.totalWeeks(L) + 1) * WEEK + 1);
  const st = G.standings(L);
  assert.ok(st.slice(0, 5).every((r) => r.half === 0) && st.slice(5).every((r) => r.half === 1), 'top half above the bottom half');
  // a bottom-half team with a better record still finishes below the whole top half
  const champ = G.finish(L).champion;
  assert.equal(L.split.groups[champ], 0, 'the champion came from the top half');
  assert.ok(L.tx.some((e) => e.type === 'split'));
});

test('the split: an odd league, the bigger half on top; a split that does not fit is dropped', () => {
  const { L, ctx } = league(9, { format: 'h2h', weeks: 6, playoffTeams: 4, split: { after: 3 } });
  Z.catchUp(L, ctx, L.start + 3 * WEEK + 1);
  assert.deepEqual(L.split.sizes, [5, 4]);
  for (let w = 4; w <= 6; w++) for (const [a, b] of L.schedule[w - 1]) assert.equal(L.split.groups[a], L.split.groups[b], 'only one half is odd: its odd team sits out');
  const late = league(6, { format: 'h2h', weeks: 5, playoffTeams: 2, split: { after: 4 } }).L;
  assert.equal(late.settings.split, undefined, 'needs two weeks after the split');
  const ap = league(6, { format: 'h2h', tally: 'allplay', weeks: 6, playoffTeams: 2, split: { after: 3 } }).L;
  assert.equal(ap.settings.split, undefined, 'not with all-play');
});
