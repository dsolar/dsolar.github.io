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
const P = require('../fantasy-kit/pyramid.js');
const WEEK = 7 * 864e5;

function drive(D, ctx, t) {
  F.start(D, t);
  for (let i = 0; i < 20000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, ctx, t); }
  return t;
}
// one tier: n teams, played to the end
function tier(n, tierNo, pyramid, seed) {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: n, lineup, scoring: 'half' });
  const T0 = Date.UTC(2026, 8, 1);
  const D = F.create({ sport, type: 'snake', teams: n, seed, now: T0, lineup, scoring: 'half', botDelay: 0 });
  D.teams.forEach((t, i) => { t.color = i; t.name = `${tierNo === 1 ? 'Top' : 'Low'} ${i}`; t.abbr = `${tierNo === 1 ? 'T' : 'L'}${i}`; });
  D.season = { format: 'h2h', weeks: 4, playoffTeams: 2, pyramid: Object.assign({ id: 'pyr1', tier: tierNo, other: tierNo === 1 ? 'low' : 'top' }, pyramid) };
  const now = drive(D, F.context(D, players, sport), T0);
  const L = Z.begin(D, sport, { now });
  const ctx = G.context(L, players, sport);
  Z.catchUp(L, ctx, L.start + (G.totalWeeks(L) + 1) * WEEK + 1);
  return { sport, players, L, ctx };
}

test('pyramid: tier sizes cap how many can move', () => {
  assert.equal(P.maxK(10, 8, 'swap'), 3);
  assert.equal(P.maxK(8, 4, 'swap'), 2);
  assert.equal(P.maxK(8, 4, 'playoff'), 1);
  assert.equal(P.maxK(6, 3, 'swap'), 1);
  assert.equal(P.maxK(4, 2, 'swap'), 1);
  assert.deepEqual(P.rules({}).names, ['Premier', 'Championship']);
});

test('pyramid: straight swap moves the bottom two and the top two, managers and team names with them', () => {
  const pyr = { mode: 'swap', k: 2, names: ['Premier', 'Championship'] };
  const top = tier(8, 1, pyr, 3), bot = tier(6, 2, pyr, 5);
  assert.deepEqual(top.L.settings.pyramid.tier, 1);
  const t1 = G.standings(top.L).map((r) => r.team), t2 = G.standings(bot.L).map((r) => r.team);
  const z1 = P.zones(top.L), z2 = P.zones(bot.L);
  assert.deepEqual(Object.keys(z1).map(Number).sort(), t1.slice(-2).sort());
  assert.ok(Object.values(z1).every((x) => x === 'down'));
  assert.deepEqual(Object.keys(z2).map(Number).sort(), t2.slice(0, 2).sort());
  const res = P.result(top.L, top.ctx, bot.L, bot.ctx);
  assert.ok(res.final, 'both seasons are over');
  assert.deepEqual(res.down, [t1[7], t1[6]], 'worst first');
  assert.deepEqual(res.up, [t2[0], t2[1]], 'best first');
  assert.equal(res.playoff, null);
  const nx = P.nextDrafts(top.L, top.ctx, bot.L, bot.ctx, top.sport, { now: Date.UTC(2027, 7, 1), seed: 0.3 });
  assert.equal(nx.top.teams.length, 8); assert.equal(nx.bot.teams.length, 6);
  // the league winner of the lower tier takes the worst top team's spot
  assert.equal(nx.top.teams[t1[7]].name, `Low ${t2[0]}`);
  assert.equal(nx.top.teams[t1[6]].name, `Low ${t2[1]}`);
  assert.equal(nx.bot.teams[t2[0]].name, `Top ${t1[7]}`);
  assert.equal(nx.top.teams[t1[7]].color, bot.L.teams[t2[0]].color, 'color travels too');
  // the newcomers pick first: the relegated teams finished last
  assert.equal(nx.top.order[0], t1[7]);
  // a fresh draft, the pyramid still on, last season's moves noted
  assert.equal(nx.top.board.filter(Boolean).length, 0, 'no keepers');
  assert.equal(nx.top.season.pyramid.tier, 1); assert.equal(nx.bot.season.pyramid.tier, 2);
  assert.deepEqual(nx.top.season.pyramid.last.down, [`Top ${t1[7]}`, `Top ${t1[6]}`]);
  const ev = P.events(res, top.L, bot.L);
  assert.equal(ev.length, 4);
  assert.ok(ev.some((e) => e.league === 'top' && e.team === t1[7] && /Promoted to the Premier/.test(e.subject)));
  assert.ok(ev.some((e) => e.league === 'bot' && e.team === t2[0] && /Relegated to the Championship/.test(e.subject)));
});

test('pyramid: swap plus playoff, the last safe team plays the lower tier\'s next team the week after the regular season', () => {
  const pyr = { mode: 'playoff', k: 1 };
  const top = tier(6, 1, pyr, 11), bot = tier(4, 2, pyr, 13);
  const t1 = G.standings(top.L).map((r) => r.team), t2 = G.standings(bot.L).map((r) => r.team);
  const z1 = P.zones(top.L), z2 = P.zones(bot.L);
  assert.equal(z1[t1[5]], 'down'); assert.equal(z1[t1[4]], 'playoff');
  assert.equal(z2[t2[0]], 'up'); assert.equal(z2[t2[1]], 'playoff');
  assert.equal(P.playoffWeek(top.L), 5, 'the first playoff week');
  const res = P.result(top.L, top.ctx, bot.L, bot.ctx);
  assert.equal(res.playoff.top, t1[4]); assert.equal(res.playoff.bot, t2[1]); assert.equal(res.playoff.week, 5);
  assert.ok(res.playoff.topPts > 0 && res.playoff.botPts > 0);
  const botWon = res.playoff.botPts > res.playoff.topPts;
  assert.equal(res.down.length, botWon ? 2 : 1); assert.equal(res.up.length, botWon ? 2 : 1);
  // force the other result: the lower team wins when it outscores
  const flip = Object.assign({}, res.playoff);
  assert.equal(flip.winner, botWon ? 'bot' : 'top');
});
