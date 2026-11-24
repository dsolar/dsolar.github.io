// The split season (two halves, a redraft, a final): node --test tests/fantasyhalves.test.mjs
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

const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
function world(n) {
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: n, lineup, scoring: 'half' });
  return { sport, lineup, players };
}
function runDraft(D, players, sport, t) {
  F.start(D, t);
  const ctx = F.context(D, players, sport);
  for (let i = 0; i < 60000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, ctx, t); }
  assert.equal(D.phase, 'done');
  return t;
}
function firstHalf(n = 8, halves = { weeks: [4, 3], keepers: 2 }, type = 'snake', seed = 3) {
  const W = world(n);
  const T0 = Date.UTC(2026, 8, 1);
  const D = F.create({ sport: W.sport, type, teams: n, seed, now: T0, lineup: W.lineup, scoring: 'half', botDelay: 0 });
  D.season = { format: 'h2h', weeks: halves.weeks[0], playoffTeams: 4, keepers: halves.keepers, halves: { half: 1, ...halves } };
  const t = runDraft(D, W.players, W.sport, T0);
  const L = Z.begin(D, W.sport, { now: t });
  return { L, ctx: G.context(L, W.players, W.sport), ...W };
}

test('the first half has no playoffs and its table leader is the first-half champion', () => {
  const { L, ctx } = firstHalf();
  assert.equal(L.settings.halves.half, 1);
  assert.equal(L.settings.weeks, 4);
  assert.equal(L.settings.playoffTeams, 0);
  assert.equal(G.totalWeeks(L), 4);
  assert.equal(L.settings.keepers, 2);
  Z.catchUp(L, ctx, L.start + 4 * WEEK + 1);
  assert.equal(L.week, 5);
  const top = G.standings(L)[0].team;
  assert.equal(L.halves.champ, top);
  assert.equal(G.finish(L).champion, top);
  assert.ok(L.tx.some((x) => x.type === 'half' && /won the first half/.test(x.text)));
  assert.match(G.summary(L).season, /first half$/);
});

test('the redraft: keepers on the board, worst team first, and the second half ends in a final', () => {
  const { L, ctx, sport, players } = firstHalf();
  Z.catchUp(L, ctx, L.start + 4 * WEEK + 1);
  const st = G.standings(L).map((r) => r.team), champ = st[0];
  const D2 = Z.nextDraft(L, ctx, sport, null, { now: L.start + 4 * WEEK + 2, seed: 0.4 });
  assert.equal(D2.round1[0], st[st.length - 1], 'the last-place team picks first');
  assert.equal(D2.year, 1, 'the same season');
  assert.equal(D2.half, 2);
  assert.deepEqual([D2.season.halves.half, D2.season.halves.champ1, D2.season.weeks, D2.season.keepers], [2, champ, 3, 0]);
  const kept = D2.board.filter((pk) => pk && pk.keeper);
  assert.ok(kept.length > 0 && kept.length <= 8 * 2);
  for (const t of L.teams) assert.ok(kept.filter((k) => k.team === t.id).length <= 2);
  for (const k of kept) assert.ok(L.rosters[k.team].includes(k.pid), 'a keeper comes from his own roster');
  const t = runDraft(D2, players, sport, L.start + 4 * WEEK + 3);
  const L2 = Z.begin(D2, sport, { now: t });
  assert.equal(L2.settings.halves.half, 2);
  assert.equal(L2.settings.weeks, 3);
  assert.equal(L2.settings.playoffTeams, 2);
  assert.equal(G.totalWeeks(L2), 4);
  assert.ok(!L2.settings.keepers, 'no keepers after the second half');
  const ctx2 = G.context(L2, players, sport);
  Z.catchUp(L2, ctx2, L2.start + 3 * WEEK + 1);
  const lead = G.standings(L2, 3)[0].team;
  if (lead === champ) {
    assert.ok(L2.halves.double);
    assert.equal(G.totalWeeks(L2), 3);
    assert.equal(G.finish(L2).champion, champ);
  } else {
    const fin = G.playoffGames(L2, ctx2, 4);
    assert.equal(fin.length, 1);
    assert.deepEqual([fin[0][0], fin[0][1]].sort(), [lead, champ].sort(), 'the two half winners play the final');
    Z.catchUp(L2, ctx2, L2.start + 4 * WEEK + 1);
    assert.ok([lead, champ].includes(G.finish(L2).champion));
  }
  assert.match(G.summary(L2).season, /second half$/);
});

test('a team that wins both halves is champion with no final', () => {
  // try seeds until the same team leads both halves, and until two different teams do
  let saw = { double: false, final: false };
  for (let seed = 1; seed <= 12 && !(saw.double && saw.final); seed++) {
    const { L, ctx, sport, players } = firstHalf(6, { weeks: [3, 3], keepers: 1 }, 'snake', seed);
    Z.catchUp(L, ctx, L.start + 3 * WEEK + 1);
    const champ = L.halves.champ;
    const D2 = Z.nextDraft(L, ctx, sport, null, { now: L.start + 3 * WEEK + 2, seed: seed / 20 });
    const t = runDraft(D2, players, sport, L.start + 3 * WEEK + 3);
    const L2 = Z.begin(D2, sport, { now: t });
    const ctx2 = G.context(L2, players, sport);
    Z.catchUp(L2, ctx2, L2.start + 3 * WEEK + 1);
    if (L2.halves.double) {
      saw.double = true;
      assert.equal(L2.settings.playoffTeams, 0);
      assert.equal(L2.week, 4); assert.ok(L2.week > G.totalWeeks(L2), 'the season is over');
      assert.equal(G.finish(L2).champion, champ);
      assert.ok(L2.tx.some((x) => x.type === 'half' && /won both halves/.test(x.text)));
    } else {
      saw.final = true;
      assert.equal(G.totalWeeks(L2), 4);
      assert.equal(G.finish(L2).champion, null, 'not decided until the final');
    }
  }
  assert.ok(saw.final, 'saw a season that went to the final');
});

test('halves need head to head and four teams, and drop the table split', () => {
  const W = world(8);
  const mk = (season) => { const D = F.create({ sport: W.sport, teams: 8, seed: 2, now: 1e12, lineup: W.lineup, scoring: 'half', botDelay: 0 }); D.season = season; runDraft(D, W.players, W.sport, 1e12); return Z.begin(D, W.sport, { now: 1e12 + 1e8 }); };
  assert.equal(mk({ format: 'roto', weeks: 6, halves: { half: 1, weeks: [6, 6], keepers: 1 } }).settings.halves, undefined);
  const L = mk({ format: 'h2h', weeks: 6, split: { after: 3 }, halves: { half: 1, weeks: [6, 6], keepers: 1 } });
  assert.ok(L.settings.halves); assert.equal(L.settings.split, undefined);
});

test('an auction league redrafts by auction, keepers at their prices', () => {
  const { L, ctx, sport } = firstHalf(8, { weeks: [4, 3], keepers: 2 }, 'dutch');
  Z.catchUp(L, ctx, L.start + 4 * WEEK + 1);
  const D2 = Z.nextDraft(L, ctx, sport, null, { now: L.start + 4 * WEEK + 2, seed: 0.3 });
  assert.equal(F.formatOf(D2), 'dutch');
  const kept = D2.sales.filter((s) => s.keeper);
  assert.ok(kept.length > 0);
  for (const k of kept) assert.ok(D2.teams[k.team].budget <= 200 - k.price);
});
