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

function league(season = {}, teams = 6) {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams, scoring: 'half' });
  const T0 = Date.UTC(2026, 9, 1);
  const D = F.create({ sport, teams, seed: 9, now: T0, scoring: 'half', botDelay: 0 });
  D.season = Object.assign({ format: 'h2h', weeks: 6, playoffTeams: 4 }, season);
  F.start(D, T0);
  let t = T0; const c = F.context(D, players, sport);
  for (let i = 0; i < 9000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, c, t); }
  const L = Z.begin(D, sport, { now: t });
  return { L, ctx: G.context(L, players, sport), sport, players, D };
}

test('rules: the commissioner changes them, within limits', () => {
  const { L } = league();
  assert.ok(G.setRules(L, { waivers: 'rolling', maxAdds: 3, deadline: 4, median: true }, 1).ok);
  assert.equal(L.settings.waivers, 'rolling'); assert.equal(L.settings.maxAdds, 3); assert.equal(L.settings.median, true);
  assert.equal(G.setRules(L, { waivers: 'auction' }, 1).ok, false);
  // the season's length, before week 1: a new schedule
  assert.ok(G.setRules(L, { weeks: 8 }, 1).ok);
  assert.equal(L.schedule.length, 8); assert.equal(G.totalWeeks(L), 10);
  // playoffs: six teams with byes
  assert.ok(G.setRules(L, { playoffTeams: 6, consolation: 'third' }, 1).ok);
  assert.equal(L.settings.playoffWeeks, 3);
  // once week 1 is under way the length is set
  L.week = 2;
  assert.match(G.setRules(L, { weeks: 10 }, 1).why, /before week 1/);
  L.week = 9;
  assert.match(G.setRules(L, { playoffTeams: 2 }, 1).why, /playoffs have started/);
  assert.ok(L.tx.some((x) => x.type === 'commish'));
});

test('rosters: move any player, even past the limit', () => {
  const { L, ctx } = league();
  const pid = L.rosters[1][0];
  assert.ok(G.commishMove(L, ctx, pid, 2, 1).ok);
  assert.ok(L.rosters[2].includes(pid) && !L.rosters[1].includes(pid));
  assert.equal(G.overLimit(L, 2), 1);
  assert.ok(G.commishMove(L, ctx, pid, null, 1).ok);
  assert.equal(ctx.own[pid], undefined);
  const fa = ctx.free[0].id;
  assert.ok(G.commishMove(L, ctx, fa, 0, 1).ok);
  assert.ok(L.rosters[0].includes(fa));
});

test('trades: reverse one that went through', () => {
  const { L, ctx } = league({ review: 'none', deadline: 0 });
  L.settings.tradeReview = 'none';
  const a = L.rosters[0][0], b = L.rosters[1][0];
  const r = G.propose(L, ctx, 0, 1, [a], [b], 1);
  assert.ok(G.respond(L, ctx, r.trade.id, true, 2).ok);
  assert.ok(L.rosters[1].includes(a) && L.rosters[0].includes(b));
  assert.ok(G.reverseTrade(L, ctx, r.trade.id, 3).ok);
  assert.ok(L.rosters[0].includes(a) && L.rosters[1].includes(b));
  assert.equal(L.trades.find((x) => x.id === r.trade.id).status, 'reversed');
  assert.equal(G.reverseTrade(L, ctx, r.trade.id, 4).ok, false, 'only once');
});

test('teams: names, FAAB, waiver order, divisions', () => {
  const { L } = league({ divisions: 2 });
  assert.ok(G.editTeam(L, 3, { name: 'The <Big> Show', abbr: 'big!', faab: 40, div: 0 }, 1).ok);
  assert.equal(L.teams[3].name, 'The Big Show'); assert.equal(L.teams[3].abbr, 'BIG'); assert.equal(L.teams[3].faab, 40); assert.equal(L.divs[3], 0);
  assert.ok(G.setWaiverOrder(L, [5, 4, 3, 2, 1, 0], 1).ok);
  assert.equal(L.teams[5].priority, 0);
  assert.equal(G.setWaiverOrder(L, [0, 0, 1, 2, 3, 4], 1).ok, false);
  assert.ok(G.setDivisions(L, ['Stars', 'Stripes'], 1).ok);
  assert.deepEqual(L.divNames, ['Stars', 'Stripes']);
});

test('before the draft: add and remove teams', () => {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const D = F.create({ sport, teams: 6, seed: 3, now: 1, scoring: 'half', clock: 90 });
  D.season = { format: 'h2h', weeks: 8 };
  const teams = D.teams.filter((t) => t.id !== 2).map((t) => ({ name: t.name, abbr: t.abbr, owner: t.owner, color: t.id }));
  const r = F.resize(D, sport, teams);
  assert.ok(r.ok);
  assert.equal(r.draft.teams.length, 5); assert.equal(r.draft.board.length, 5 * D.rounds);
  assert.equal(r.draft.clock, 90); assert.deepEqual(r.draft.season, D.season);
  assert.equal(r.draft.teams[2].name, D.teams[3].name);
  const more = F.resize(D, sport, D.teams.concat([{ name: 'New Team', abbr: 'NEW' }]).map((t) => ({ name: t.name, abbr: t.abbr })));
  assert.equal(more.draft.teams.length, 7);
  F.start(D, 2);
  assert.equal(F.resize(D, sport, teams).ok, false, 'not once the draft starts');
});

test('draft offers: the clock stops while the manager on the clock reads one', () => {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 4, scoring: 'half' });
  const D = F.create({ sport, teams: 4, seed: 2, now: 0, scoring: 'half', clock: 60, botDelay: 0, order: [0, 1, 2, 3], botOffers: false });
  D.teams[0].owner = 'A'; D.teams[1].owner = 'B';
  const ctx = F.context(D, players, sport);
  F.start(D, 1000);
  // B offers A a swap of first-rounders while A is on the clock
  const r = F.propose(D, ctx, { from: 1, to: 0, give: [F.pickId ? F.pickId(1) : 'pk:1'], get: [F.pickId ? F.pickId(0) : 'pk:0'], balance: false }, 2000);
  assert.ok(r.ok && r.pending, r.why);
  assert.ok(F.offerHold(D, 2000));
  assert.ok(D.paused && D.hold && D.hold.team === 0);
  // time passes, but the clock doesn't run out while held
  assert.equal(F.tick(D, ctx, 50000), 0);
  assert.equal(F.made(D).length, 0);
  // A declines: the draft picks up with the time A had left
  F.respond(D, ctx, r.trade.id, 0, false, 60000);
  assert.ok(F.offerHold(D, 60000));
  assert.ok(!D.paused && !D.hold);
  assert.equal(F.onClock(D, 60000).team, 0);
  assert.ok(F.onClock(D, 60000).left > 55000, 'A still has nearly the whole clock');
  // an offer that sits too long stops holding (and holds only once)
  const r2 = F.propose(D, ctx, { from: 1, to: 0, give: [F.pickId(1)], get: [F.pickId(0)], balance: false }, 61000);
  F.offerHold(D, 61000);
  assert.ok(D.paused);
  F.offerHold(D, 61000 + F.HOLD_MAX + 1);
  assert.ok(!D.paused, 'the hold ends after the limit');
  F.offerHold(D, 61000 + F.HOLD_MAX + 2);
  assert.ok(!D.paused, 'and the same offer doesn\'t hold again');
  // "off" never holds
  D.offerHold = 'off';
  F.propose(D, ctx, { from: 1, to: 0, give: [F.pickId(5)], get: [F.pickId(4)], balance: false }, 200000);
  assert.equal(F.offerHold(D, 200000), false);
});

test('customization: commissioner review, season pickup cap, reverse-standings waivers, minimum bid', () => {
  const { L, ctx } = league({ review: 'commish', reviewHours: 12, maxAddsSeason: 1, minBid: 1, waiverOrder: 'standings', deadline: 0 });
  assert.equal(L.settings.tradeReview, 'commish'); assert.equal(L.settings.reviewHours, 12);
  assert.equal(L.settings.maxAddsSeason, 1); assert.equal(L.settings.minBid, 1); assert.equal(L.settings.waiverOrder, 'standings');
  const r = G.propose(L, ctx, 0, 1, [L.rosters[0][0]], [L.rosters[1][0]], 1);
  assert.ok(G.respond(L, ctx, r.trade.id, true, 2).ok);
  assert.equal(r.trade.status, 'review');
  assert.deepEqual(G.voters(L, r.trade), [], 'nobody votes under commissioner review');
  assert.ok(G.commishVeto(L, r.trade.id, 3).ok);
  assert.equal(r.trade.status, 'vetoed');
  assert.equal(G.commishVeto(L, r.trade.id, 4).ok, false);
  // rules validate the new options
  assert.ok(G.setRules(L, { tradeReview: 'vote', vetoShare: 0.67, waiverOrder: 'rolling', minBid: 0 }, 5).ok);
  assert.equal(L.settings.vetoShare, 0.67);
  assert.equal(G.setRules(L, { waiverOrder: 'random' }, 5).ok, false);
  // reverse standings: the worst record gets the first claim
  L.settings.waiverOrder = 'standings';
  L.teams.forEach((t, i) => (t.priority = i + 1));
  G.reorderWaivers(L);
  const pr = L.teams.map((t) => t.priority).sort((a, b) => a - b);
  assert.deepEqual(pr, L.teams.map((_, i) => i + 1));
});

test('draft order: the commissioner sets or shuffles it before the draft', () => {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const D = F.create({ sport, teams: 6, seed: 3, now: 0, scoring: 'half', botDelay: 0 });
  const want = D.round1.slice().reverse();
  assert.ok(F.setOrder(D, want).ok);
  assert.deepEqual(D.round1, want);
  assert.deepEqual(D.order.slice(0, 6), want);
  assert.deepEqual(D.order.slice(6, 12), want.slice().reverse(), 'round two snakes back');
  assert.equal(F.setOrder(D, [0, 0, 1, 2, 3, 4]).ok, false, 'every team once');
  assert.ok(F.setOrder(D, null, 7).ok);
  assert.deepEqual(D.round1.slice().sort(), want.slice().sort());
  F.start(D, 1);
  assert.equal(F.setOrder(D, want).ok, false, 'not once it starts');
});

test('emails: the draft-done email carries each team its roster, by position', () => {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 6, scoring: 'half' });
  const T0 = Date.UTC(2026, 9, 1);
  const D = F.create({ sport, teams: 6, seed: 9, now: T0, scoring: 'half', botDelay: 0 });
  D.season = { format: 'h2h', weeks: 6, playoffTeams: 4 };
  F.start(D, T0); const base = { draft: JSON.parse(JSON.stringify(D)), league: null };
  let t = T0; const c = F.context(D, players, sport);
  for (let i = 0; i < 9000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, c, t); }
  const L = Z.begin(D, sport, { now: t });
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const ev = Z.events(base, { draft: D, league: L }, { name: 'T', url: 'u', seats: { 0: 'A', 3: 'B' }, me: null, byId, now: t });
  const e = ev.find((x) => x.team === 3 && x.kind === 'draft');
  assert.ok(e && e.data && e.data.roster);
  assert.equal(e.data.roster.rows.length, L.rosters[3].length);
  assert.equal(e.data.roster.rows[0].main, 'QB', 'quarterbacks first');
  assert.match(e.data.roster.rows[0].how, /^round \d+, pick \d+$/);
  assert.ok(JSON.stringify(e.data).length < 20000, 'fits the outbox');
});

test('lineup reminder: once a week, before kickoff, for a hole in the lineup', () => {
  const { L, ctx, D } = league({ deadline: 0 });
  const w = L.week, start = G.weekStart(L, w);
  const ids = G.lineupFor(L, ctx, 1, w);
  const hurt = ctx.byId[ids[0]]; hurt.inj = 'Out';
  G.setLineup(L, ctx, 1, w, ids, start - 1);
  const base = JSON.parse(JSON.stringify({ draft: D, league: L }));
  Z.catchUp(L, ctx, start + 3600e3);
  assert.ok(!(L.reminders || {})[w], 'not yet: football checks Thursday');
  Z.catchUp(L, ctx, start + 57 * 3600e3);
  assert.ok(L.reminders[w].teams[1], 'team 1 has an out starter');
  assert.ok(!L.reminders[w].teams[0] || L.reminders[w].teams[0].hurt.every((h) => h.n !== hurt.n));
  const ev = Z.events(base, { draft: D, league: L }, { name: 'T', url: 'u', seats: { 1: 'B' }, me: null, byId: ctx.byId, now: start + 57 * 3600e3 });
  const e = ev.find((x) => x.kind === 'lineup' && x.team === 1);
  assert.ok(e, 'an email for team 1');
  assert.match(e.body, new RegExp(`${hurt.n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(\\w+\\) is listed as out`));
  const again = JSON.parse(JSON.stringify({ draft: D, league: L }));
  Z.catchUp(L, ctx, start + 60 * 3600e3);
  assert.equal(Z.events(again, { draft: D, league: L }, { name: 'T', url: 'u', seats: { 1: 'B' }, me: null, byId: ctx.byId, now: start + 60 * 3600e3 }).filter((x) => x.kind === 'lineup').length, 0, 'only once a week');
});
