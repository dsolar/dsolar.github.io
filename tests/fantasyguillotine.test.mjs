import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const V = require('../fantasy-kit/value.js');
const F = require('../fantasy-kit/draft.js');
const G = require('../fantasy-kit/league.js');
const T0 = Date.UTC(2026, 8, 7, 12, 0, 0);
const DAY = 864e5, HOUR = 36e5;

function league(key, settings = {}, opts = {}) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S[key]), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  const teams = opts.teams || 10;
  V.evaluate(sport, players, { teams, lineup, scoring: opts.scoring });
  const D = F.create({ sport, teams, seed: 3, now: T0, lineup, botDelay: 0, scoring: opts.scoring });
  D.teams[0].owner = 'David';
  const dctx = F.context(D, players, sport);
  F.start(D, T0); D.teams[0].auto = true; F.tick(D, dctx, T0 + 1, 5000); D.teams[0].auto = false;
  const L = G.create({ sport, draft: D, now: T0, start: T0, settings });
  return { sport, players, L, ctx: G.context(L, players, sport) };
}
// One week the way the demo runs it: bots bid on the chopped roster, waivers run midweek, bots work the wire, the week ends.
function playWeek(s, r) {
  const st = G.weekStart(s.L, s.L.week);
  G.botBids(s.L, s.ctx, st + HOUR, r);
  G.tick(s.L, s.ctx, G.waiverRunAt(s.L) + 1);
  G.botWeek(s.L, s.ctx, st + 5 * DAY, r);
  return G.finishWeek(s.L, s.ctx, G.weekStart(s.L, s.L.week + 1));
}

for (const [key, scoring] of [['nfl', 'half'], ['nba', 'cats9'], ['mlb', 'roto5']]) {
  test(`${key}: a guillotine season chops one team a week down to a champion`, () => {
    const s = league(key, { format: 'guillotine' }, { scoring });
    assert.equal(s.L.settings.weeks, 9);
    assert.equal(s.L.settings.faab, 1000);
    assert.equal(G.totalWeeks(s.L), 9);
    const r = F.rng(9);
    for (let w = 1; w <= 9; w++) {
      const before = s.L.alive.length;
      assert.ok(playWeek(s, r).ok);
      const res = s.L.results[w].block;
      const lowest = res.slice().sort((a, b) => a.score - b.score || a.proj - b.proj)[0].team;
      assert.equal(res.length, before);
      assert.equal(s.L.alive.length, before - 1);
      assert.equal(s.L.chopped.at(-1).team, lowest, 'the lowest score goes');
      assert.equal(s.L.rosters[lowest].length, 0, 'their roster is emptied');
    }
    assert.equal(s.L.alive.length, 1);
    assert.equal(G.champion(s.L), s.L.alive[0]);
    assert.ok(s.L.week > G.totalWeeks(s.L));
    assert.equal(G.finishWeek(s.L, s.ctx, Date.now()).ok, false);
    const st = G.standings(s.L);
    assert.equal(st[0].team, G.champion(s.L));
    assert.equal(st.at(-1).team, s.L.chopped[0].team, 'first out is last');
    const won = s.L.tx.filter((x) => x.type === 'waiver').length;
    assert.ok(won > 5, `${won} waiver wins`);
    assert.ok(s.L.teams.some((t) => t.faab < 1000), 'bots spent FAAB');
  });
}

test('guillotine: chopped players wait for the midweek run, then the high bid wins', () => {
  const s = league('nfl', { format: 'guillotine', bestBall: true });
  const r = F.rng(4);
  playWeek(s, r);
  const out = s.L.chopped[0];
  const star = out.roster.map((id) => s.ctx.byId[id]).sort((a, b) => b.$ - a.$)[0];
  assert.ok(G.onWaivers(s.L, star.id, G.weekStart(s.L, 2) + HOUR), 'on waivers after the chop');
  assert.equal(G.addDrop(s.L, s.ctx, 0, star.id, s.L.rosters[0][0], G.weekStart(s.L, 2) + HOUR).ok, false, 'no instant add');
  if (!s.L.alive.includes(0)) return;
  const drop = s.L.rosters[0].map((id) => s.ctx.byId[id]).sort((a, b) => a.v - b.v)[0].id;
  assert.ok(G.claim(s.L, s.ctx, 0, star.id, drop, 999, G.weekStart(s.L, 2) + HOUR).ok);
  G.botBids(s.L, s.ctx, G.weekStart(s.L, 2) + 2 * HOUR, r);
  G.tick(s.L, s.ctx, G.waiverRunAt(s.L) - 1);
  assert.ok(!s.L.rosters[0].includes(star.id), 'not before the run');
  G.tick(s.L, s.ctx, G.waiverRunAt(s.L) + 1);
  assert.ok(s.L.rosters[0].includes(star.id), 'the $999 bid wins');
  assert.equal(s.L.teams[0].faab, 1);
  assert.ok(!G.onWaivers(s.L, out.roster.find((id) => s.ctx.own[id] == null) || 'x', G.waiverRunAt(s.L) + 2), 'leftovers are free agents');
});

test('guillotine: no trades, and a chopped team is done', () => {
  const s = league('nba', { format: 'guillotine' }, { scoring: 'cats9' });
  const t = G.propose(s.L, s.ctx, 0, 1, [s.L.rosters[0][0]], [s.L.rosters[1][0]], T0);
  assert.equal(t.ok, false);
  playWeek(s, F.rng(2));
  const dead = s.L.chopped[0].team;
  const fa = s.ctx.free.find((p) => !G.onWaivers(s.L, p.id, T0 + 30 * DAY));
  assert.equal(G.addDrop(s.L, s.ctx, dead, fa.id, null, T0 + 30 * DAY).ok, false);
});

test('guillotine: chop odds add up to one and favor the weakest roster', () => {
  const s = league('nfl', { format: 'guillotine' });
  const rows = G.block(s.L, s.ctx, 1, 0);
  const total = rows.reduce((a, r) => a + r.chop, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `sums to ${total}`);
  const weakest = rows.slice().sort((a, b) => a.proj - b.proj)[0];
  const strongest = rows.slice().sort((a, b) => b.proj - a.proj)[0];
  assert.ok(weakest.chop > strongest.chop);
  const mid = G.block(s.L, s.ctx, 1, 0.9);
  assert.ok(Math.max(...mid.map((r) => r.chop)) > Math.max(...rows.map((r) => r.chop)), 'odds sharpen as the week plays');
});

test('best ball: the lineup picks itself from what players scored', () => {
  const s = league('nfl', { format: 'h2h', bestBall: true, weeks: 4, playoffTeams: 2 });
  assert.equal(G.setLineup(s.L, s.ctx, 0, 1, G.lineupFor(s.L, s.ctx, 0, 1)).ok, false);
  const wk = G.teamWeek(s.L, s.ctx, 0, 1, 1);
  const ids = s.L.rosters[0];
  // every bench player who could fill a starter's slot scored no more than him
  const lu = wk.lineup;
  for (let i = 0; i < lu.length; i++) {
    if (!lu[i]) continue;
    for (const id of ids.filter((x) => !lu.includes(x))) {
      const p = s.ctx.byId[id];
      if (/^(out|ir|o)$/i.test(p.inj || '')) continue;   // hurt players don't count in best ball
      if (S.positions(p).length === 1 && S.fits(s.sport, p, s.L.settings.lineup[i]) && S.positions(s.ctx.byId[lu[i]]).length === 1) {
        assert.ok(G.playerWeek(s.L, s.ctx, p, 1).pts <= wk.players[lu[i]] + 1e-9, `${p.n} sat but outscored the starter`);
      }
    }
  }
  const r = F.rng(1);
  let now = T0;
  while (s.L.week <= G.totalWeeks(s.L)) { now += 7 * DAY; G.finishWeek(s.L, s.ctx, now); }
  assert.deepEqual(s.L.lineups[1][0], s.L.results[1].length ? s.L.lineups[1][0] : null);
  const g = s.L.results[1].find((x) => x.a === 0 || x.b === 0);
  const mine = g.a === 0 ? g.sa : g.sb;
  assert.ok(Math.abs(mine - wk.total) < 1e-6, 'the stored result is the best-ball score');
});

test('mid-week moves: a late pickup scores only the rest of the week, a drop keeps what he scored', () => {
  const s = league('nfl', { format: 'guillotine', bestBall: true });
  const L = s.L, ctx = s.ctx, w = L.week;
  const late = G.weekStart(L, w) + 6.9 * DAY;          // 99% of the week gone
  const before = G.teamWeek(L, ctx, 0, w, 0.99).total;
  const fa = ctx.free.filter((p) => !G.onWaivers(L, p.id, late)).sort((a, b) => b.v - a.v)[0];
  const worst = L.rosters[0].map((id) => ctx.byId[id]).sort((a, b) => a.v - b.v)[0];
  assert.ok(G.addDrop(L, ctx, 0, fa.id, worst.id, late).ok);
  const after = G.teamWeek(L, ctx, 0, w, 0.99).total;
  assert.ok(after - before < 1, `a pickup at 99% added ${(after - before).toFixed(2)} points`);
  // dropping a starter late keeps the points he'd already put up
  const lu = G.teamWeek(L, ctx, 0, w, 0.99).lineup.filter(Boolean);
  const star = lu.map((id) => ctx.byId[id]).sort((a, b) => b.v - a.v)[0];
  const had = G.teamWeek(L, ctx, 0, w, 0.99).players[star.id];
  const repl = ctx.free.filter((p) => !G.onWaivers(L, p.id, late + 1)).find((p) => S.positions(p).some((x) => S.positions(star).includes(x)));
  assert.ok(G.addDrop(L, ctx, 0, repl.id, star.id, late + 1).ok);
  const keep = G.teamWeek(L, ctx, 0, w, 0.99).players[star.id];
  assert.ok(keep > had * 0.97 && keep <= had + 1e-9, `kept ${keep} of ${had} (he left at 98.6% of the week)`);
});

test('season over: no more roster moves', () => {
  const s = league('nba', { format: 'guillotine' }, { scoring: 'cats9' });
  const r = F.rng(3);
  while (s.L.week <= G.totalWeeks(s.L)) playWeek(s, r);
  const champ = G.champion(s.L), fa = s.ctx.free[0];
  assert.match(G.addDrop(s.L, s.ctx, champ, fa.id, null, Date.now()).why, /over/);
  assert.match(G.claim(s.L, s.ctx, champ, fa.id, null, 1, Date.now()).why, /over/);
});

test('a guillotine can be best ball or set lineups', () => {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  for (const bb of [undefined, true, false]) {
    const D = F.create({ sport, teams: 6, seed: 2, now: 0, scoring: 'half', botDelay: 0 });
    D.season = Object.assign({ format: 'guillotine' }, bb === undefined ? {} : { bestBall: bb });
    D.phase = 'done';
    const L = require('../fantasy-kit/season.js').begin(D, sport, { now: 0 });
    assert.equal(L.settings.bestBall, bb !== false, `bestBall ${bb}`);
  }
});

test('a set-lineups guillotine plays a full season down to a champion', () => {
  const s = league('nfl', { format: 'guillotine', bestBall: false }, { scoring: 'half' });
  assert.equal(!!s.L.settings.bestBall, false);
  const r = F.rng(4);
  for (let w = 1; w <= 9; w++) {
    const before = s.L.alive.length;
    assert.ok(playWeek(s, r).ok);
    assert.equal(s.L.alive.length, before - 1);
  }
  assert.equal(G.champion(s.L), s.L.alive[0]);
  // managers set their own lineups here
  const s2 = league('nfl', { format: 'guillotine', bestBall: false }, { scoring: 'half' });
  const slots = G.lineupFor(s2.L, s2.ctx, 0, 1);
  assert.ok(G.setLineup(s2.L, s2.ctx, 0, 1, slots, T0).ok !== false);
});
