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
const WEEK = 7 * 864e5, HOUR = 36e5;

function league(season, teams = 8, owners = []) {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams, lineup, scoring: 'half' });
  const T0 = Date.UTC(2026, 8, 1);
  const D = F.create({ sport, teams, seed: 5, now: T0, lineup, scoring: 'half', botDelay: 0 });
  D.season = season;
  F.start(D, T0);
  let t = T0; const c0 = F.context(D, players, sport);
  for (let i = 0; i < 20000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, c0, t); }
  assert.equal(D.phase, 'done');
  const L = Z.begin(D, sport, { now: t });
  for (const o of owners) L.teams[o].owner = 'Person ' + o;
  return { L, ctx: G.context(L, players, sport), sport, players };
}
const playTo = (s, w) => Z.catchUp(s.L, s.ctx, s.L.start + w * WEEK + 1);

test('pick your opponent: the worst team picks first, bots pick at once, a slow human gets picked for, and the picks become the schedule', () => {
  const s = league({ format: 'h2h', weeks: 6, playoffTeams: 4, pyo: true }, 8, [0]);
  const { L, ctx } = s;
  assert.ok(L.settings.pyo);
  assert.equal(L.pyo.week, 2, 'week 2 picks open with the league');
  assert.deepEqual(L.pyo.order, L.draft.round1.slice().reverse(), 'the reverse of the draft order');
  // bots ahead of team 0 pick at once; then it's team 0's turn
  G.runPyo(L, ctx, L.created + 1);
  const turn = G.pyoTurn(L);
  if (turn === 0) {
    const opts = G.pyoOptions(L, 0);
    assert.ok(opts.length > 0 && !opts.includes(0));
    const last = G.pyoLast(L, 0, 2);
    assert.ok(!opts.includes(last) || opts.length === 1, "can't pick this week's opponent");
    if (last != null && !opts.includes(last)) assert.equal(G.pyoPick(L, ctx, 0, last, L.created + 2).ok, false);
    assert.equal(G.pyoPick(L, ctx, 0, opts[opts.length - 1], L.created + 2).ok, true);
    assert.equal(G.pyoPick(L, ctx, 3, 4, L.created + 2).ok === false || G.pyoTurn(L) == null, true, 'only the team on the turn picks');
  }
  G.runPyo(L, ctx, L.created + 3);
  assert.ok(L.pyo.done, 'the rest are bots: done');
  const pairs = L.schedule[1];
  assert.equal(pairs.length, 4);
  assert.equal(new Set(pairs.flat()).size, 8, 'everyone plays once');
  assert.deepEqual(L.picked[2], pairs.map((p) => p[0]));
  playTo(s, 1);
  assert.equal(L.pyo.week, 3, 'week 3 opens when week 1 ends');
  assert.deepEqual(L.pyo.order, G.standings(L).map((r) => r.team).reverse(), 'worst record first');
  // team 0 sits on its turn: 12 hours, then it's picked for
  const t1 = L.pyo.at;
  G.runPyo(L, ctx, t1 + 60e3);
  if (G.pyoTurn(L) === 0) { G.runPyo(L, ctx, L.pyo.at + G.PYO_HOURS * HOUR + 1); assert.notEqual(G.pyoTurn(L), 0); }
  playTo(s, 6);
  for (let w = 2; w <= 6; w++) assert.equal(new Set(L.schedule[w - 1].flat()).size, 8, `week ${w} is a full slate`);
  assert.ok(L.tx.some((x) => x.type === 'pyo'));
});

test('Robin Hood and Conquest: the low scorer and every winner take a player, protected players stay, and the swap keeps rosters legal', () => {
  const s = league({ format: 'h2h', weeks: 4, playoffTeams: 2, robin: { protect: 2 }, conquest: { protect: 3, like: true } }, 6, [1]);
  const { L, ctx } = s;
  playTo(s, 1);
  const robin = L.bites.filter((b) => b.why === 'robin'), conq = L.bites.filter((b) => b.why === 'conquest');
  assert.equal(robin.length, 1, 'one Robin Hood a week');
  const g = L.results[1];
  const scores = g.flatMap((x) => [[x.a, x.sa], [x.b, x.sb]]).sort((a, b) => b[1] - a[1]);
  assert.equal(robin[0].victim, scores[0][0], 'from the top scorer');
  assert.equal(robin[0].by, scores[scores.length - 1][0], 'to the lowest');
  assert.equal(robin[0].protect.length, 2);
  assert.equal(conq.length, g.filter((x) => x.w === 'a' || x.w === 'b').length, 'one per winner');
  for (const b of conq) assert.equal(b.protect.length, 3);
  // a human taker's raid waits; a protected player can't be taken; like for like
  const mine = L.bites.find((b) => b.by === 1 && b.status === 'open');
  if (mine) {
    assert.equal(G.bite(L, ctx, mine.id, mine.protect[0], L.rosters[1][0], L.start + WEEK + 2).ok, false, 'protected');
    const take = L.rosters[mine.victim].find((x) => !mine.protect.includes(x) && !(L.ir[mine.victim] || []).includes(x));
    const give = L.rosters[1].find((x) => S.positions(ctx.byId[x])[0] === S.positions(ctx.byId[take])[0]);
    if (mine.like && give) {
      const wrong = L.rosters[1].find((x) => S.positions(ctx.byId[x])[0] !== S.positions(ctx.byId[take])[0]);
      if (wrong) assert.equal(G.bite(L, ctx, mine.id, take, wrong, L.start + WEEK + 2).ok, false, 'like for like');
    }
  }
  for (const b of L.bites.filter((x) => x.status === 'done')) assert.ok(!b.protect.includes(b.take), 'never a protected player');
  // the deadline: everything open is made by two days into week 2
  Z.catchUp(L, ctx, L.start + WEEK + 49 * HOUR);
  G.tick(L, ctx, L.start + WEEK + 49 * HOUR);
  assert.equal(L.bites.filter((b) => b.week === 1 && b.status === 'open').length, 0);
  for (const t of L.teams) assert.ok(L.rosters[t.id].length - G.held(L, t.id).length <= G.maxRoster(L), 'rosters stay legal');
  playTo(s, G.totalWeeks(L) + 1);
  assert.equal(L.bites.filter((b) => b.week > 4).length, 0, 'no raids in the playoffs');
});

test('Kingslayer: week 1 crowns the top scorer, the bounty grows while he holds it, and beating him takes the crown and the pot', () => {
  const s = league({ format: 'h2h', weeks: 6, playoffTeams: 2, crown: { start: 10, step: 10, keep: 5 } }, 8);
  const { L } = s;
  assert.equal(G.kingOf(L), null);
  playTo(s, 1);
  const top = L.results[1].flatMap((x) => [[x.a, x.sa], [x.b, x.sb]]).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(G.kingOf(L), top);
  assert.equal(L.crown.pot, 10);
  let pot = 10, king = top;
  for (let w = 2; w <= 6; w++) {
    const faab = L.teams.map((t) => t.faab);
    playTo(s, w);
    const g = L.results[w].find((x) => x.a === king || x.b === king);
    const lost = (g.w === 'a' && g.b === king) || (g.w === 'b' && g.a === king);
    if (lost) {
      const slayer = g.a === king ? g.b : g.a;
      assert.equal(G.kingOf(L), slayer, `week ${w}: the slayer is king`);
      assert.ok(L.teams[slayer].faab >= faab[slayer] + pot - 60, 'and collects the bounty');
      king = slayer; pot = 10;
    } else { pot += 10; assert.equal(G.kingOf(L), king); }
    assert.equal(L.crown.pot, pot, `week ${w} pot`);
  }
  assert.ok(L.tx.some((x) => x.type === 'crown'));
});

test('The Hangover: last week\'s winners can\'t add or claim this week; trades and lineups are fine', () => {
  const s = league({ format: 'h2h', weeks: 4, playoffTeams: 2, hangover: true }, 6);
  const { L, ctx } = s;
  playTo(s, 1);
  delete L.openWaivers;
  const g = L.results[1].find((x) => x.w === 'a' || x.w === 'b');
  const winner = g.w === 'a' ? g.a : g.b, loser = g.w === 'a' ? g.b : g.a;
  const at = L.start + WEEK + 3 * 864e5;
  const fa = ctx.free.find((p) => !G.onWaivers(L, p.id, at));
  assert.match(G.hungover(L, winner), /Hangover/);
  assert.equal(G.hungover(L, loser), null);
  const r = G.addDrop(L, ctx, winner, fa.id, L.rosters[winner][L.rosters[winner].length - 1], at);
  assert.equal(r.ok, false); assert.match(r.why, /Hangover/);
  assert.equal(G.claim(L, ctx, winner, fa.id, L.rosters[winner][0], 1, at).ok, false);
});

test('guillotine top-score bonus: the week\'s best score earns FAAB', () => {
  const s = league({ format: 'guillotine', topBonus: 25, faab: 1000 }, 6);
  const { L } = s;
  assert.equal(L.settings.topBonus, 25);
  playTo(s, 1);
  const b = L.tx.find((x) => x.type === 'bonus');
  assert.ok(b && b.faab === 25);
  const top = L.results[1].block.filter((r) => !r.out).sort((a, c) => c.score - a.score)[0].team;
  assert.equal(b.team, top);
});
