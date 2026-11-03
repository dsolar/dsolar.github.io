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
