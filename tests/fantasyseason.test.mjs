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
const DAY = 864e5;

function setup(key, scoring, season) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S[key]), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 4, lineup, bench: sport.bench, scoring });
  const T0 = Date.UTC(2026, 10, 3, 15);
  const D = F.create({ sport, teams: 4, seed: 11, now: T0, lineup, scoring, botDelay: 3000, clock: 3600 });
  D.teams[0].owner = 'Dave'; D.teams[1].owner = 'Bob'; D.season = season;
  F.start(D, T0);
  return { sport, players, D, T0, byId: Object.fromEntries(players.map((p) => [p.id, p])) };
}

test('the season starts the next Monday (Tuesday for football) at 13:00 UTC', () => {
  const tue = Date.UTC(2026, 10, 3, 15);
  assert.equal(new Date(Z.startAfter(tue, 'nba')).toISOString(), '2026-11-09T13:00:00.000Z');
  assert.equal(new Date(Z.startAfter(tue, 'nfl')).toISOString(), '2026-11-10T13:00:00.000Z');
  assert.equal(new Date(Z.startAfter(Date.UTC(2026, 10, 9, 12), 'nba')).toISOString(), '2026-11-09T13:00:00.000Z', 'same morning, before 13:00');
  assert.equal(new Date(Z.startAfter(Date.UTC(2026, 10, 9, 14), 'nba')).toISOString(), '2026-11-16T13:00:00.000Z');
});

test('a draft nobody comes back to finishes on the clock, and everyone seated hears about it', () => {
  const s = setup('nfl', 'half', { format: 'h2h', weeks: 4 });
  const before = structuredClone({ draft: s.D, league: null });
  assert.ok(Z.driveDraft(s.D, F.context(s.D, s.players, s.sport), s.T0 + 3 * DAY));
  assert.equal(s.D.phase, 'done');
  const L = Z.begin(s.D, s.sport, { name: 'Test' });
  assert.equal(L.settings.weeks, 4);
  assert.equal(L.teams[1].owner, 'Bob');
  const ev = Z.events(before, { draft: s.D, league: L }, { name: 'Test', url: 'u', seats: { 0: 'Dave', 1: 'Bob' }, me: 0, byId: s.byId });
  assert.deepEqual(ev.map((e) => e.team), [1], 'the one who saved and bot teams get nothing');
  assert.match(ev[0].subject, /draft is done/);
  assert.match(ev[0].body, /season starts/);
});

test('a slow draft emails the manager who comes on the clock', () => {
  const s = setup('nba', 'cats9', { format: 'h2h', weeks: 4 });
  const ctx = F.context(s.D, s.players, s.sport);
  let before = structuredClone({ draft: s.D, league: null }), found = null;
  for (let t = s.T0; t < s.T0 + 30 * 3600e3 && !found; t += 3600e3) {
    Z.driveDraft(s.D, ctx, t);
    const ev = Z.events(before, { draft: s.D, league: null }, { name: 'Test', url: 'u', seats: { 0: 'Dave', 1: 'Bob' }, me: null, byId: s.byId, now: t });
    found = ev.find((e) => e.kind === 'clock');
    before = structuredClone({ draft: s.D, league: null });
  }
  assert.ok(found, 'someone was emailed');
  assert.match(found.subject, /on the clock/);
  assert.ok([0, 1].includes(found.team));
});

test('weeks played by the clock send results; guillotine weeks say who was chopped', () => {
  for (const season of [{ format: 'h2h', weeks: 4 }, { format: 'guillotine' }]) {
    const s = setup('nfl', 'half', season);
    Z.driveDraft(s.D, F.context(s.D, s.players, s.sport), s.T0 + 3 * DAY);
    const L = Z.begin(s.D, s.sport, { name: 'Test' });
    const before = structuredClone(L);
    assert.ok(Z.catchUp(L, G.context(L, s.players, s.sport), L.start + 15 * DAY));
    assert.equal(L.week, 3);
    const ev = Z.events({ draft: s.D, league: before }, { draft: s.D, league: L }, { name: 'Test', url: 'u', seats: { 0: 'Dave', 1: 'Bob' }, me: null, byId: s.byId });
    const weeks = ev.filter((e) => e.kind === 'week');
    assert.ok(weeks.length >= 2 && weeks.every((e) => e.team === 0 || e.team === 1), `${weeks.length} week emails`);
    if (season.format === 'guillotine') assert.ok(weeks.some((e) => /chopped|survived/.test(e.subject)));
    else assert.ok(weeks.every((e) => /^You (beat|lost to|tied) /.test(e.body)));
    assert.equal(Z.catchUp(L, G.context(L, s.players, s.sport), L.start + 15 * DAY), false, 'nothing left to do');
  }
});

test('trade offers and answers go to the right manager', () => {
  const s = setup('nfl', 'half', { format: 'h2h', weeks: 4 });
  Z.driveDraft(s.D, F.context(s.D, s.players, s.sport), s.T0 + 3 * DAY);
  const L = Z.begin(s.D, s.sport, { name: 'Test' });
  const ctx = G.context(L, s.players, s.sport);
  const o = { name: 'Test', url: 'u', seats: { 0: 'Dave', 1: 'Bob' }, byId: s.byId };
  const b0 = structuredClone(L);
  const at = L.start + DAY;
  const t = G.propose(L, ctx, 0, 1, [L.rosters[0][3]], [L.rosters[1][3]], at, { note: 'Fair?' });
  assert.ok(t.ok, t.why);
  let ev = Z.events({ league: b0 }, { league: L }, Object.assign({ me: 0 }, o));
  assert.equal(ev.length, 1); assert.equal(ev[0].team, 1); assert.match(ev[0].subject, /sent you a trade offer/); assert.match(ev[0].body, /"Fair\?"/);
  const b1 = structuredClone(L);
  G.respond(L, ctx, L.trades[0].id, false, at + 3600e3, 'No thanks');
  ev = Z.events({ league: b1 }, { league: L }, Object.assign({ me: 1 }, o));
  assert.equal(ev.length, 1); assert.equal(ev[0].team, 0); assert.match(ev[0].subject, /declined your trade/);
});

test('the commissioner\'s rules from the start-a-league form carry into the season', () => {
  const s = setup('nfl', 'half', { format: 'h2h', weeks: 10, playoffTeams: 0, deadline: 6, review: 'none', faab: 200, waiverDays: 1 });
  Z.driveDraft(s.D, F.context(s.D, s.players, s.sport), s.T0 + 3 * DAY);
  const L = Z.begin(s.D, s.sport, { name: 'Test' });
  assert.deepEqual([L.settings.weeks, L.settings.playoffTeams, L.settings.playoffWeeks, L.settings.deadline, L.settings.tradeReview, L.settings.waiverDays, L.teams[0].faab],
    [10, 0, 0, 6, 'none', 1, 200]);
  assert.equal(G.totalWeeks(L), 10, 'no playoff weeks');
  const g = setup('nfl', 'half', { format: 'guillotine', faab: 500 });
  Z.driveDraft(g.D, F.context(g.D, g.players, g.sport), g.T0 + 3 * DAY);
  assert.equal(Z.begin(g.D, g.sport, {}).teams[1].faab, 500);
});
