import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const V = require('../fantasy-kit/value.js');
const F = require('../fantasy-kit/draft.js');
const G = require('../fantasy-kit/league.js');
const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const DAY = 864e5;

function season(key, opts = {}) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S[key]), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 10, lineup, scoring: opts.scoring });
  const D = F.create({ sport, teams: 10, seed: 11, now: T0, lineup, botDelay: 0, scoring: opts.scoring });
  D.teams[0].owner = 'David';
  const dctx = F.context(D, players, sport);
  F.start(D, T0); D.teams[0].auto = true; F.tick(D, dctx, T0 + 1); D.teams[0].auto = false;
  assert.equal(D.phase, 'done');
  const L = G.create({ sport, draft: D, now: T0, start: T0, settings: { weeks: 10, playoffTeams: 4, tradeReview: opts.review || 'none' } });
  const ctx = G.context(L, players, sport);
  return { sport, players, D, L, ctx };
}

for (const [key, scoring] of [['nfl', 'half'], ['nba', 'cats9'], ['mlb', 'roto5']]) {
  test(`${key}: a full season with playoffs`, () => {
    const s = season(key, { scoring });
    const r = F.rng(5);
    let now = T0;
    while (s.L.week <= G.totalWeeks(s.L)) { now += 7 * DAY; G.botWeek(s.L, s.ctx, now, r); G.tick(s.L, s.ctx, now); G.finishWeek(s.L, s.ctx, now); }
    const st = G.standings(s.L);
    assert.equal(st.reduce((a, x) => a + x.w + x.l + x.t, 0), 10 * 10, 'every team plays every regular week');
    const br = G.bracket(s.L, s.ctx);
    assert.equal(br.length, 2);
    assert.equal(br[1].games.length, 1, 'one final');
    assert.ok(s.L.tx.some((x) => x.type === 'add/drop' || x.type === 'waiver'), 'bots made moves');
    // players on IR don't count against the roster limit
    s.L.rosters.forEach((ros, t) => assert.ok(ros.length - (s.L.ir[t] || []).length <= G.maxRoster(s.L), `${s.L.teams[t].name}: ${ros.length} players, ${(s.L.ir[t] || []).length} on IR`));
  });
}

test('lineups: move a bench player in, and illegal slots are refused', () => {
  const s = season('nba');
  const lu = G.lineupFor(s.L, s.ctx, 0, 1);
  const bench = s.L.rosters[0].find((id) => !lu.includes(id));
  const cIdx = s.L.settings.lineup.indexOf('UTIL');
  assert.ok(G.move(s.L, s.ctx, 0, 1, bench, cIdx).ok);
  assert.equal(G.lineupFor(s.L, s.ctx, 0, 1)[cIdx], bench);
  const guard = s.L.rosters[0].find((id) => s.ctx.byId[id].pos.every((x) => x === 'PG' || x === 'SG'));
  if (guard) assert.equal(G.move(s.L, s.ctx, 0, 1, guard, s.L.settings.lineup.indexOf('C')).ok, false);
});

test('free agency: add and drop, then dropped players sit on waivers and the high bid wins', () => {
  const s = season('nfl');
  const fa = s.ctx.free[0], drop = s.L.rosters[0][s.L.rosters[0].length - 1];
  assert.equal(G.addDrop(s.L, s.ctx, 0, fa.id, null, T0).ok, false, 'roster full');
  assert.ok(G.addDrop(s.L, s.ctx, 0, fa.id, drop, T0).ok);
  assert.ok(G.onWaivers(s.L, drop, T0 + 1000));
  assert.equal(G.addDrop(s.L, s.ctx, 1, drop, s.L.rosters[1][0], T0 + 1000).ok, false, 'on waivers');
  assert.ok(G.claim(s.L, s.ctx, 1, drop, s.L.rosters[1][s.L.rosters[1].length - 1], 7, T0 + 2000).ok);
  assert.ok(G.claim(s.L, s.ctx, 2, drop, s.L.rosters[2][s.L.rosters[2].length - 1], 9, T0 + 3000).ok);
  G.runWaivers(s.L, s.ctx, T0 + 3 * DAY);
  assert.equal(s.ctx.own[drop], 2);
  assert.equal(s.L.teams[2].faab, 91);
  assert.equal(s.L.claims.find((c) => c.team === 1).status, 'lost');
});

test('trades: propose, bot answers, review and veto', () => {
  const s = season('nba', { review: 'vote' });
  const mine = s.L.rosters[0].slice().sort((a, b) => s.ctx.byId[b].$ - s.ctx.byId[a].$);
  const theirs = s.L.rosters[3].slice().sort((a, b) => s.ctx.byId[b].$ - s.ctx.byId[a].$);
  const bad = G.propose(s.L, s.ctx, 0, 3, [mine[mine.length - 1]], [theirs[0]], T0);
  assert.ok(bad.ok);
  G.tick(s.L, s.ctx, T0 + 1000);
  assert.equal(bad.trade.status, 'rejected');
  const good = G.propose(s.L, s.ctx, 0, 3, [mine[0]], [theirs[theirs.length - 1]], T0 + 2000);
  G.tick(s.L, s.ctx, T0 + 3000);
  assert.equal(good.trade.status, 'review');
  for (const v of G.voters(s.L, good.trade).slice(0, G.vetoesNeeded(s.L, good.trade))) G.vote(s.L, s.ctx, good.trade.id, v, true, T0 + 4000);
  assert.equal(good.trade.status, 'vetoed');
  const ok = G.propose(s.L, s.ctx, 0, 3, [mine[0]], [theirs[theirs.length - 1]], T0 + 5000);
  G.tick(s.L, s.ctx, T0 + 6000);
  G.tick(s.L, s.ctx, T0 + 6000 + 25 * 3600e3);
  assert.equal(ok.trade.status, 'accepted');
  assert.ok(s.L.rosters[3].includes(mine[0]));
});

test('IR: a hurt player frees a roster spot, and coming back needs room', () => {
  const s = season('nfl', { scoring: 'half' });
  const L = s.L, ctx = s.ctx;
  const ros = L.rosters[0];
  const healthy = ros.find((id) => !G.irEligible(ctx.byId[id]));
  ctx.byId[healthy].inj = 'Questionable';
  assert.match(G.toIR(L, ctx, 0, healthy, T0).why, /isn't out/);
  ctx.byId[healthy].inj = 'IR';
  assert.ok(G.toIR(L, ctx, 0, healthy, T0).ok);
  assert.ok(!G.lineupFor(L, ctx, 0, L.week).includes(healthy), 'out of the lineup');
  const other = ros.find((id) => id !== healthy);
  ctx.byId[other].inj = 'Out';
  assert.match(G.toIR(L, ctx, 0, other, T0).why, /full/, 'one IR spot');
  delete ctx.byId[other].inj;
  // the open spot takes a free agent
  const fa = ctx.free.find((p) => !G.onWaivers(L, p.id, T0 + 1));
  assert.ok(G.addDrop(L, ctx, 0, fa.id, null, T0 + 1).ok, 'room for a pickup');
  // now he needs a drop to come back
  assert.equal(G.activate(L, ctx, 0, healthy, null, T0 + 2).needDrop, true);
  assert.ok(G.activate(L, ctx, 0, healthy, fa.id, T0 + 2).ok);
  assert.ok(L.rosters[0].includes(healthy) && !L.rosters[0].includes(fa.id));
  assert.equal(L.ir[0].length, 0);
  delete ctx.byId[healthy].inj;
});

test('IR: a player traded off IR arrives active and his old spot opens', () => {
  const s = season('nfl', { scoring: 'half' });
  const L = s.L, ctx = s.ctx;
  const hurt = L.rosters[0][3];
  ctx.byId[hurt].inj = 'IR';
  assert.ok(G.toIR(L, ctx, 0, hurt, T0).ok);
  const fa = ctx.free.find((p) => !G.onWaivers(L, p.id, T0 + 1));
  assert.ok(G.addDrop(L, ctx, 0, fa.id, null, T0 + 1).ok, 'the IR spot made room');
  // one for one: they get the IR player, so team 0 has one more active player than it can hold
  const r = G.tradeCheck(L, ctx, { from: 0, to: 1, give: [hurt], get: [L.rosters[1][0]] });
  assert.equal(r.ok, false, 'team 0 would be over the limit without its IR spot');
  assert.ok(G.addDrop(L, ctx, 1, null, L.rosters[1][L.rosters[1].length - 1], T0 + 1).ok, 'team 1 makes room for a 2-for-1');
  const ok = G.tradeCheck(L, ctx, { from: 0, to: 1, give: [hurt, fa.id], get: [L.rosters[1][0]] });
  assert.ok(ok.ok, ok.why);
  assert.ok(G.execute(L, ctx, Object.assign({ id: 99, faabGive: 0, faabGet: 0, dropsFrom: [] }, { from: 0, to: 1, give: [hurt, fa.id], get: [L.rosters[1][0]] }), T0 + 2).ok);
  assert.deepEqual(L.ir[0], []);
  assert.ok(L.rosters[1].includes(hurt) && !(L.ir[1] || []).includes(hurt));
  delete ctx.byId[hurt].inj;
});

test('waiver priority rotates within one run: two tied bids each go to a different team', () => {
  const s = season('nfl', { scoring: 'half' });
  const L = s.L, ctx = s.ctx;
  L.settings.waivers = 'faab';
  const byPri = L.teams.slice().sort((a, b) => a.priority - b.priority);
  const [first, second] = [byPri[0].id, byPri[1].id];
  const fas = ctx.free.filter((p) => !G.onWaivers(L, p.id, T0 + DAY)).slice(0, 2);
  const drop = (t, k) => L.rosters[t].map((id) => ctx.byId[id]).sort((a, b) => a.v - b.v)[k].id;
  for (const [i, p] of fas.entries()) {
    assert.ok(G.claim(L, ctx, first, p.id, drop(first, i), 5, T0 + DAY + i).ok);
    assert.ok(G.claim(L, ctx, second, p.id, drop(second, i), 5, T0 + DAY + 10 + i).ok);
  }
  const won = G.runWaivers(L, ctx, T0 + 2 * DAY);
  assert.equal(won.length, 2);
  assert.deepEqual(won.map((c) => c.team).sort(), [first, second].sort(), 'after its first win, the top team drops to the back');
});

for (const key of ['nfl', 'mlb']) {
  test(`${key}: bots never leave a starting slot empty`, () => {
    const s = season(key);
    const r = F.rng(8);
    let now = T0;
    while (s.L.week <= G.totalWeeks(s.L)) { now += 7 * DAY; G.botWeek(s.L, s.ctx, now, r); G.tick(s.L, s.ctx, now); G.finishWeek(s.L, s.ctx, now); }
    for (const [w, byTeam] of Object.entries(s.L.lineups)) for (const [t, lu] of Object.entries(byTeam)) {
      if (+t === 0) continue;
      assert.ok(lu.every((x) => x != null), `week ${w} ${s.L.teams[t].name} has an empty slot`);
    }
  });
}
