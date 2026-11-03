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

function drive(D, ctx, t) {
  F.start(D, t);
  for (let i = 0; i < 20000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, ctx, t); }
  return t;
}
function finished(key, season, opts = {}) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S[key]), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  const scoring = Object.keys(sport.scorings)[0];
  V.evaluate(sport, players, { teams: 6, lineup, scoring });
  const T0 = Date.UTC(2026, 9, 1);
  const D = F.create({ sport, type: opts.type || 'snake', teams: 6, seed: 7, now: T0, lineup, scoring, botDelay: 0, budget: 200 });
  D.teams.forEach((t, i) => (t.color = i));
  D.season = season;
  const now = drive(D, F.context(D, players, sport), T0);
  assert.equal(D.phase, 'done');
  const L = Z.begin(D, sport, { now });
  const ctx = G.context(L, players, sport);
  Z.catchUp(L, ctx, L.start + (G.totalWeeks(L) + 1) * WEEK + 1);
  assert.ok(L.week > G.totalWeeks(L), 'the season played out');
  return { sport, players, L, ctx };
}

test('keeper rules ride from the form into the league', () => {
  const { L } = finished('nfl', { format: 'h2h', weeks: 3, playoffTeams: 2, keepers: 2 });
  assert.equal(L.settings.keepers, 2);
  assert.equal(L.settings.keeperCost, 'round');
});

test('a keeper costs the round he went in, a pickup the last round', () => {
  const { L, ctx } = finished('nfl', { format: 'h2h', weeks: 3, playoffTeams: 2, keepers: 2 });
  const k = L.draft.board.findIndex((pk) => pk && pk.team === 0);
  const pid = L.draft.board[k].pid, round = F.slotInfo(L.draft, k).round;
  if (L.rosters[0].includes(pid)) assert.equal(Z.keeperCost(L, pid).round, round);
  L.settings.keeperCost = 'round1';
  if (L.rosters[0].includes(pid)) assert.equal(Z.keeperCost(L, pid).round, Math.max(1, round - 1));
  L.settings.keeperCost = 'round';
  const pickup = ctx.free[0].id;
  assert.equal(Z.keeperCost(L, pickup).round, L.draft.rounds);
  assert.match(Z.keeperCost(L, pickup).label, /pickup/);
  const opts = Z.keeperOptions(L, ctx, 0);
  assert.equal(opts.length, L.rosters[0].length);
  assert.ok(opts.every((o, i) => i === 0 || opts[i - 1].surplus >= o.surplus), 'best values first');
  const auto = Z.autoKeepers(L, ctx, 0);
  assert.ok(auto.length <= 2);
});

test('next season: worst team picks first, keepers already on the board, rules carried over', () => {
  const s = finished('nfl', { format: 'h2h', weeks: 3, playoffTeams: 2, keepers: 2, faab: 200 });
  const { L, ctx, sport } = s;
  const pick = Z.keeperOptions(L, ctx, 0).slice(0, 2).map((o) => o.pid);
  const D2 = Z.nextDraft(L, ctx, sport, { 0: pick }, { now: Date.UTC(2027, 7, 1), seed: 0.5 });
  const st = G.standings(L);
  assert.equal(D2.phase, 'setup');
  assert.equal(D2.year, 2);
  assert.equal(D2.season.keepers, 2);
  assert.equal(D2.season.faab, 200);
  assert.deepEqual(D2.teams.map((t) => t.name), L.teams.map((t) => t.name));
  assert.deepEqual(D2.teams.map((t) => t.color), L.teams.map((t) => t.color));
  // round one runs worst to first
  const first = D2.teams.length;
  const r1 = D2.order.slice(0, first);
  assert.deepEqual(r1, st.map((r) => r.team).reverse());
  // team 0's two keepers sit on its own picks
  const mine = D2.board.map((pk, k) => [pk, k]).filter(([pk]) => pk && pk.keeper);
  for (const pid of pick) {
    const at = mine.find(([pk]) => pk.pid === pid);
    assert.ok(at, 'kept');
    assert.equal(at[0].team, 0);
    assert.ok(F.slotInfo(D2, at[1]).round >= Z.keeperCost(L, pid).round, 'no earlier than his cost');
  }
  // every other team keeps its best values on its own
  for (const t of L.teams.slice(1)) assert.equal(mine.filter(([pk]) => pk.team === t.id).length, Z.autoKeepers(L, ctx, t.id).length);
  // the draft runs to the end with the keepers in place
  const players = s.players.map((p) => ({ ...p }));
  drive(D2, F.context(D2, players, sport), Date.UTC(2027, 7, 1));
  assert.equal(D2.phase, 'done');
  const rosterOf0 = D2.board.filter((pk) => pk && pk.team === 0).map((pk) => pk.pid);
  for (const pid of pick) assert.ok(rosterOf0.includes(pid));
  // and the finished season boils down to a few lines for the history
  const sum = Z.summary(L);
  assert.equal(sum.standings.length, 6);
  assert.ok(sum.champion && sum.champion.name);
});

test('auction keepers cost their price out of next year\'s budget', () => {
  const s = finished('nba', { format: 'h2h', weeks: 3, playoffTeams: 0, keepers: 1, keeperCost: 'price5' }, { type: 'auction' });
  const { L, ctx, sport } = s;
  assert.equal(L.settings.keeperCost, 'price5');
  const sale = L.draft.sales.find((x) => x.team === 0 && L.rosters[0].includes(x.pid));
  assert.equal(Z.keeperCost(L, sale.pid).price, sale.price + 5);
  const D2 = Z.nextDraft(L, ctx, sport, { 0: [sale.pid] }, { now: Date.UTC(2027, 7, 1), seed: 0.5 });
  assert.equal(D2.type, 'auction');
  const kept = (D2.sales || []).find((x) => x.pid === sale.pid);
  assert.ok(kept && kept.keeper && kept.team === 0);
  assert.equal(D2.teams[0].budget, 200 - (sale.price + 5));
});

test('events: keeper picks open, then the new draft room', () => {
  const { L, ctx, sport } = finished('nfl', { format: 'h2h', weeks: 3, playoffTeams: 2, keepers: 1 });
  const o = { name: 'T', url: 'u', seats: { 0: 'A', 1: 'B' }, byId: ctx.byId, now: Date.now() };
  const before = JSON.parse(JSON.stringify(L));
  L.next = { opened: 1, due: Date.now() + 3 * 864e5, picks: {} };
  const ev = Z.events({ league: before }, { league: L }, o);
  assert.equal(ev.filter((e) => /keepers/.test(e.subject)).length, 2);
  const D2 = Z.nextDraft(L, ctx, sport, {}, { now: Date.now() });
  const ev2 = Z.events({ league: L }, { draft: D2, league: null }, o);
  assert.equal(ev2.filter((e) => /draft room is open/.test(e.subject)).length, 2);
});
