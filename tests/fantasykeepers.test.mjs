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

test('dynasty: picks trade like players, rosters carry over, a short rookie draft runs worst to first', () => {
  const s = finished('nfl', { format: 'h2h', weeks: 3, playoffTeams: 2, dynasty: { rounds: 3, picks: true } });
  const { L, ctx, sport } = s;
  assert.deepEqual(L.settings.dynasty, { rounds: 3, picks: true });
  assert.equal(G.picksOf(L, 0).length, 6, 'three rounds next season, three the season after');
  assert.ok(G.pickValue(L, ctx, '1:0') > G.pickValue(L, ctx, '3:0'), 'an earlier round is worth more');
  // trade team 0's first-round pick for a bench player (rewind the clock so trades are open)
  const week = L.week; L.week = 2; L.settings.deadline = 0;
  const want = L.rosters[1].slice().sort((a, b) => ctx.byId[a].$ - ctx.byId[b].$)[0];
  const drop = L.rosters[0].slice().sort((a, b) => ctx.byId[a].$ - ctx.byId[b].$)[0];
  const r = G.propose(L, ctx, 0, 1, [], [want], Date.now(), { pickGive: ['1:0'], dropsFrom: [drop] });
  assert.ok(r.ok, r.why);
  L.settings.tradeReview = 'none';
  assert.ok(G.respond(L, ctx, r.trade.id, true, Date.now()).ok);
  assert.equal(G.pickOwner(L, '1:0'), 1);
  assert.deepEqual(G.picksOf(L, 0), ['2:0', '3:0', '1:0:2', '2:0:2', '3:0:2']);
  assert.equal(G.picksOf(L, 1).length, 7);
  // can't trade a pick you don't hold
  assert.match(G.tradeCheck(L, ctx, { from: 0, to: 1, give: [], get: [], pickGive: ['1:0'], pickGet: [] }).why, /doesn't have that pick/);
  L.week = week;
  // next season: whole rosters carried, three rounds, traded pick in the right hands
  const D2 = Z.nextDraft(L, ctx, sport, {}, { now: Date.UTC(2027, 7, 1), seed: 0.4 });
  assert.equal(D2.type, 'linear'); assert.equal(D2.rounds, 3); assert.ok(D2.rookie);
  assert.deepEqual(F.rosters(D2).map((r) => r.length), L.rosters.map((r) => r.length));
  const n = L.teams.length, worst = G.standings(L).map((x) => x.team).reverse();
  const k0 = worst.indexOf(0);
  assert.equal(D2.order[k0], 1, "team 0's first-round slot now belongs to team 1");
  assert.equal(D2.via[k0], 0);
  assert.equal(D2.order[n + k0], 0, 'team 0 still has its second-rounder');
  // the draft adds three players a team, then week 1 cuts every roster back to size
  const players = s.players.map((p) => ({ ...p }));
  let t = Date.UTC(2027, 7, 1); F.start(D2, t);
  const c2 = F.context(D2, players, sport);
  for (let i = 0; i < 5000 && D2.phase === 'live'; i++) { t += 3000; F.tick(D2, c2, t); }
  assert.equal(D2.phase, 'done');
  const picksBy = (i) => D2.order.filter((x) => x === i).length;
  assert.equal(picksBy(0), 2); assert.equal(picksBy(1), 4);
  assert.ok(F.rosters(D2).every((r, i) => r.length === L.rosters[i].length + picksBy(i)));
  const L2 = Z.begin(D2, sport, { now: t });
  const ctx2 = G.context(L2, players, sport);
  assert.ok(L2.settings.dynasty);
  Z.catchUp(L2, ctx2, t + 1);
  const max = L2.settings.lineup.length + L2.settings.bench;
  assert.ok(L2.rosters.every((r, i) => !L2.teams[i].owner ? r.length - (L2.ir[i] || []).length <= max : true), 'bots cut right away');
  Z.catchUp(L2, ctx2, L2.start + 1);
  assert.ok(L2.rosters.every((r, i) => r.length - (L2.ir[i] || []).length <= max), 'everyone is at the limit by week 1');
});

test('taxi squads: rookies stash off the roster, promote for good, carry into next season', () => {
  const s = finished('nfl', { format: 'h2h', weeks: 3, playoffTeams: 2, dynasty: { rounds: 3, picks: true }, taxi: 2 });
  const { L, ctx, sport } = s;
  assert.equal(L.settings.taxi, 2);
  assert.equal(G.taxiSlots(L), 2);
  // rewind so moves are open, and hand team 0 a rookie it can stash
  const week = L.week; L.week = 2;
  const rookie = ctx.free.find((p) => p.rk && !G.onWaivers(L, p.id, 0));
  assert.ok(rookie, 'the data flags rookies');
  const vet = ctx.free.find((p) => !p.rk && !G.onWaivers(L, p.id, 0));
  const drop = L.rosters[0].filter((x) => !G.held(L, 0).includes(x)).sort((a, b) => ctx.byId[a].vor - ctx.byId[b].vor)[0];
  assert.ok(G.addDrop(L, ctx, 0, rookie.id, drop, 0).ok);
  const size = L.rosters[0].length;
  assert.match(G.toTaxi(L, ctx, 0, L.rosters[0].find((x) => !ctx.byId[x].rk), 0).why, /Only rookies/);
  assert.ok(G.toTaxi(L, ctx, 0, rookie.id, 0).ok);
  assert.ok(G.taxiOf(L, 0).includes(rookie.id));
  assert.ok(!G.lineupFor(L, ctx, 0, L.week).includes(rookie.id), "a taxi player can't start");
  // the taxi spot frees a roster spot: a vet comes in with no drop
  assert.ok(G.addDrop(L, ctx, 0, vet.id, null, 0).ok, 'room for one more');
  assert.equal(L.rosters[0].length, size + 1);
  assert.equal(G.overLimit(L, 0), 0);
  const lu = G.lineupFor(L, ctx, 0, L.week).slice(); lu[0] = rookie.id;
  assert.match(G.setLineup(L, ctx, 0, L.week, lu, 0).why || '', /taxi squad|can't play/);
  // promoting needs a spot now; with a drop it goes through and he can't go back
  for (const p of ctx.free.filter((x) => !G.onWaivers(L, x.id, 0) && !x.rk)) { if (L.rosters[0].length - G.held(L, 0).length >= G.maxRoster(L)) break; G.addDrop(L, ctx, 0, p.id, null, 0); }
  const r = G.promote(L, ctx, 0, rookie.id, null, 0);
  assert.ok(r.needDrop);
  const cut = L.rosters[0].filter((x) => !G.held(L, 0).includes(x)).sort((a, b) => ctx.byId[a].vor - ctx.byId[b].vor)[0];
  assert.ok(G.promote(L, ctx, 0, rookie.id, cut, 0).ok);
  assert.match(G.toTaxi(L, ctx, 0, rookie.id, 0).why, /promoted/);
  L.week = week;
  // next season: taxi squads carry, rookie-draft picks are eligible, bots stash before they cut
  const other = ctx.free.find((p) => p.rk);
  L.rosters[2].push(other.id); L.taxi[2].push(other.id); G.refresh(L, ctx);
  const D2 = Z.nextDraft(L, ctx, sport, {}, { now: Date.UTC(2027, 7, 1), seed: 0.4 });
  assert.ok(D2.taxi[2].includes(other.id));
  const players = s.players.map((p) => ({ ...p }));
  let t = Date.UTC(2027, 7, 1); F.start(D2, t);
  const c2 = F.context(D2, players, sport);
  for (let i = 0; i < 5000 && D2.phase === 'live'; i++) { t += 3000; F.tick(D2, c2, t); }
  const L2 = Z.begin(D2, sport, { now: t });
  const ctx2 = G.context(L2, players, sport);
  assert.equal(L2.settings.taxi, 2);
  assert.ok(L2.taxi[2].includes(other.id), 'the stashed rookie is still stashed');
  assert.ok(L2.promoted[rookie.id], 'promotions are remembered');
  const drafted = D2.board.filter(Boolean)[0].pid;
  assert.ok(G.taxiEligible(L2, ctx2, drafted), 'a rookie-draft pick can go on the taxi squad');
  Z.catchUp(L2, ctx2, L2.start + 1);
  const max = L2.settings.lineup.length + L2.settings.bench;
  assert.ok(L2.rosters.every((r, i) => r.length - G.held(L2, i).length <= max));
  assert.ok(L2.taxi.some((x) => x.length), 'someone used a taxi spot instead of cutting');
});

test('dynasty offseason: trades stay open after the season, and picks two seasons out roll forward', () => {
  const s = finished('nfl', { format: 'h2h', weeks: 3, playoffTeams: 2, dynasty: { rounds: 3, picks: true } });
  const { L, ctx, sport } = s;
  assert.ok(L.week > G.totalWeeks(L) && G.offseason(L));
  L.settings.tradeReview = 'none';
  // a 2-for-1 with no drop: the offseason has no roster limit
  const mine = L.rosters[0].slice(0, 2), theirs = L.rosters[1][0];
  const r = G.propose(L, ctx, 0, 1, mine, [theirs], Date.now(), { pickGet: ['1:1:2'] });
  assert.ok(r.ok, r.why);
  assert.ok(G.respond(L, ctx, r.trade.id, true, Date.now()).ok);
  assert.equal(G.pickOwner(L, '1:1:2'), 0);
  assert.equal(L.rosters[1].length, L.rosters[0].length + 2);
  assert.match(G.pickLabel(L, '1:1:2'), /^Two seasons out: 1st-round pick, from/);
  assert.ok(G.pickValue(L, ctx, '1:1:2') < G.pickValue(L, ctx, '1:' + G.standings(L).slice(-1)[0].team), "a far pick is worth less than next season's worst-team first");
  // a bot answers an offseason offer when the clock ticks, and pending offers don't expire at the deadline
  L.settings.tradeReview = 'vote';
  const bot = L.teams.find((t) => !t.owner && t.id > 1).id;
  const big = G.propose(L, ctx, 0, bot, L.rosters[0].slice(0, 3), [], Date.now());
  assert.ok(big.ok, big.why);
  G.tick(L, ctx, Date.now() + 1000);
  assert.notEqual(big.trade.status, 'expired');
  // next season: the far pick becomes next season's, still owned by team 0
  const D2 = Z.nextDraft(L, ctx, sport, {}, { now: Date.UTC(2027, 7, 1), seed: 0.4 });
  assert.equal(D2.futurePicks['1:1'], 0);
  const players = s.players.map((p) => ({ ...p }));
  let t = Date.UTC(2027, 7, 1); F.start(D2, t);
  const c2 = F.context(D2, players, sport);
  for (let i = 0; i < 5000 && D2.phase === 'live'; i++) { t += 3000; F.tick(D2, c2, t); }
  const L2 = Z.begin(D2, sport, { now: t });
  assert.equal(G.pickOwner(L2, '1:1'), 0, 'the traded pick is now a next-season pick');
  assert.ok(!G.offseason(L2));
});
