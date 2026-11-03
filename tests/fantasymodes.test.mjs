import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const V = require('../fantasy-kit/value.js');
const F = require('../fantasy-kit/draft.js');
const T0 = Date.UTC(2026, 10, 2, 20, 0, 0);

function setup(key, opts = {}) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S[key]), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  const teams = opts.teams || 10;
  V.evaluate(sport, players, { teams, lineup });
  const rounds = lineup.length + sport.bench;
  const curve = F.pickCurve(players, teams * rounds);
  const D = F.create({ sport, teams, type: opts.type || 'snake', seed: opts.seed || 7, now: T0, lineup, clock: 30, botDelay: 1000, curve, reveal: opts.reveal });
  if (opts.human != null) D.teams[opts.human].owner = 'David';
  const ctx = F.context(D, players, sport);
  return { sport, players, D, ctx, lineup, curve };
}
function run(s, step = 2000, limit = 4000) {
  let now = T0; F.start(s.D, now);
  for (let i = 0; i < limit && s.D.phase === 'live'; i++) { now += step; F.tick(s.D, s.ctx, now); }
  return now;
}
const total = (curve, ks) => ks.reduce((a, k) => a + curve[k], 0);

for (const key of ['nba', 'nfl', 'mlb']) {
  test(`${key}: mystery packages split every pick and land within 1% of each other`, () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = setup(key, { type: 'mystery', seed });
      const M = s.D.mystery;
      const all = M.packs.flat().sort((a, b) => a - b);
      assert.deepEqual(all, [...Array(s.D.order.length).keys()], 'every pick dealt once');
      assert.ok(M.packs.every((ks) => ks.length === s.D.rounds), 'everyone gets a full set');
      const tots = M.packs.map((ks) => total(M.curve, ks));
      const mean = tots.reduce((a, b) => a + b) / tots.length;
      assert.ok((Math.max(...tots) - Math.min(...tots)) / mean <= 0.0101, `${key} seed ${seed}: spread ${M.spread}`);
      M.packs.forEach((ks, t) => ks.forEach((k) => assert.equal(s.D.order[k], t)));
    }
  });
}

test('mystery: deals vary from seed to seed', () => {
  const firsts = new Set();
  for (let seed = 1; seed <= 12; seed++) { const s = setup('nfl', { type: 'mystery', seed }); firsts.add(s.D.mystery.packs.map((ks) => ks.slice(0, 3).join(',')).join('|')); }
  assert.equal(firsts.size, 12);
});

test('mystery: a bot draft finishes with legal rosters', () => {
  const s = setup('nba', { type: 'mystery' });
  run(s);
  assert.equal(s.D.phase, 'done');
  const ros = F.rosters(s.D);
  assert.ok(ros.every((ids) => ids.length === F.sizeOf(s.D)));
});

test('mystery: packages stay sealed until the draft starts', () => {
  const s = setup('nba', { type: 'mystery', reveal: 'own', human: 0 });
  assert.equal(F.seen(s.D, 0, 0), false);
  assert.equal(F.tradeCheck(s.D, s.ctx, { from: 0, to: 1, give: [F.pickId(F.picksOf(s.D, 0)[0])], get: [F.pickId(F.picksOf(s.D, 1)[0])] }).ok, false);
  F.start(s.D, T0);
  const mine = F.picksOf(s.D, 0), theirs = F.picksOf(s.D, 1);
  assert.ok(mine.every((k) => F.seen(s.D, k, 0)), 'my picks show at the start');
  const later = theirs.filter((k) => k > 0);
  assert.ok(later.length && later.every((k) => !F.seen(s.D, k, 0)), 'theirs stay hidden until they come up');
  assert.ok(F.seen(s.D, 0, 0), 'the pick on the clock shows');
});

test('mystery: the bot-draft check keeps the most even deal', () => {
  const s = setup('nfl', { type: 'mystery' });
  const r = F.fairDeal(s.D, s.players, s.sport, null, { tries: 4 });
  assert.equal(r.tries, 4);
  assert.ok(r.range <= r.median && r.median <= r.worst);
  assert.ok(s.D.mystery.spread <= 0.0101);
  assert.equal(s.D.phase, 'setup');
});

test('trades: a bot takes a fair-plus deal of picks and the order moves', () => {
  const s = setup('nfl', { human: 0 });
  F.start(s.D, T0);
  const mine = F.picksOf(s.D, 0), theirs = F.picksOf(s.D, 1);
  // two of my picks for their first: I overpay a lot, so the bot says yes
  const t = { from: 0, to: 1, give: [F.pickId(mine[0]), F.pickId(mine[1])], get: [F.pickId(theirs[2])] };
  const r = F.propose(s.D, s.ctx, t, T0 + 1000);
  assert.ok(r.ok && r.accepted, JSON.stringify(r));
  assert.equal(s.D.order[mine[0]], 1); assert.equal(s.D.order[mine[1]], 1); assert.equal(s.D.order[theirs[2]], 0);
  assert.equal(s.D.via[theirs[2]], 1);
  assert.equal(r.trade.added.length, 1, 'they add their latest pick to even it out');
  assert.equal(s.D.order[theirs.at(-1)], 0);
  assert.equal(F.picksOf(s.D, 0).length, s.D.rounds);
  // a lowball gets turned down
  const low = F.propose(s.D, s.ctx, { from: 0, to: 2, give: [F.pickId(F.picksOf(s.D, 0).at(-1))], get: [F.pickId(F.picksOf(s.D, 2)[0])] }, T0 + 2000);
  assert.ok(low.ok && !low.accepted && low.why);
});

test('trades: drafted players move with their board spot', () => {
  const s = setup('nba', { human: 0 });
  let now = T0; F.start(s.D, now);
  while (F.rosters(s.D)[0].length < 2 || F.rosters(s.D)[3].length < 2) {
    now += 500;
    const c = F.onClock(s.D, now);
    if (c && c.team === 0) F.pick(s.D, s.ctx, 0, F.autoChoice(s.D, s.ctx, 0).id, now);
    F.tick(s.D, s.ctx, now);
  }
  const a = F.rosters(s.D)[0][0], b = F.rosters(s.D)[3][0];
  const ok = F.tradeCheck(s.D, s.ctx, { from: 0, to: 3, give: [a], get: [b] });
  assert.ok(ok.ok, ok.why);
  s.D.teams[3].owner = 'Sam';
  const r = F.propose(s.D, s.ctx, { from: 0, to: 3, give: [a], get: [b] }, now);
  assert.ok(r.pending, 'a manager has to answer');
  assert.equal(F.respond(s.D, s.ctx, r.trade.id, 0, true, now).ok, false, 'only the other side answers');
  assert.ok(F.respond(s.D, s.ctx, r.trade.id, 3, true, now).ok);
  assert.ok(F.rosters(s.D)[0].includes(b) && F.rosters(s.D)[3].includes(a));
  const pk = s.D.board.find((x) => x && x.pid === b);
  assert.equal(pk.drafter, 3);
});

test('trades: rosters stay legal, and offers that go stale close', () => {
  const s = setup('nfl', { human: 0 });
  F.start(s.D, T0);
  const mine = F.picksOf(s.D, 0), theirs = F.picksOf(s.D, 1);
  // three picks for one would leave them more picks than spots, unless it's balanced
  const big = { from: 0, to: 1, give: mine.slice(0, 3).map(F.pickId), get: [F.pickId(theirs[5])] };
  assert.equal(F.tradeCheck(s.D, s.ctx, big).ok, false);
  assert.match(F.tradeCheck(s.D, s.ctx, big).why, /room/);
  const even = F.balance(s.D, big);
  assert.equal(even.get.length, 3);
  assert.ok(F.tradeCheck(s.D, s.ctx, even).ok);
  // an offer for a pick that gets made before anyone answers expires
  s.D.teams[1].owner = 'Sam';
  const c = F.onClock(s.D, T0);
  const owner = c.team, other = owner === 0 ? 2 : 0;
  s.D.teams[owner].owner = s.D.teams[owner].owner || 'X'; s.D.teams[other].owner = s.D.teams[other].owner || 'Y';
  const r = F.propose(s.D, s.ctx, { from: other, to: owner, give: [F.pickId(F.picksOf(s.D, other).at(-1))], get: [F.pickId(c.index)] }, T0 + 100);
  assert.ok(r.pending);
  F.pick(s.D, s.ctx, owner, F.autoChoice(s.D, s.ctx, owner).id, T0 + 200);
  assert.equal(r.trade.status, 'expired');
});

test('trades: bots sometimes offer to move up when a manager is on the clock', () => {
  let offers = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const s = setup('nfl', { human: 4, seed });
    let now = T0; F.start(s.D, now);
    for (let i = 0; i < 400 && s.D.phase === 'live'; i++) {
      now += 1500;
      F.tick(s.D, s.ctx, now);
      const c = F.onClock(s.D, now);
      if (c && c.team === 4) F.pick(s.D, s.ctx, 4, F.autoChoice(s.D, s.ctx, 4).id, now);
    }
    assert.equal(s.D.phase, 'done');
    for (const T of s.D.trades) {
      assert.equal(T.to, 4); assert.equal(T.give.length, 2); assert.equal(T.get.length, 2);
      assert.equal(T.status, 'expired', 'unanswered offers close when the pick is made');
      offers++;
    }
  }
  assert.ok(offers >= 5, `${offers} offers`);
});

test('trades: auctions have none', () => {
  const s = setup('nba', { type: 'auction' });
  assert.equal(s.D.trading, false);
});

/* ---------- time bank ---------- */
function bankSetup(key, opts = {}) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S[key]), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 10, lineup });
  const D = F.create({ sport, teams: 10, seed: 5, now: T0, lineup, botDelay: 1000, bank: { perRound: 30, floor: 10 } });
  D.teams[0].owner = 'David';
  return { sport, players, D, ctx: F.context(D, players, sport) };
}
// The manager takes `secs` on every pick; bots move on their own.
function bankRun(s, secs) {
  let now = T0; F.start(s.D, now);
  for (let i = 0; i < 20000 && s.D.phase === 'live'; i++) {
    const c = F.onClock(s.D, now);
    if (c && c.team === 0 && secs != null && now - s.D.clockStart >= secs * 1000) F.pick(s.D, s.ctx, 0, F.autoChoice(s.D, s.ctx, 0).id, now);
    F.tick(s.D, s.ctx, now);
    now += 500;
  }
  return now;
}

test('time bank: every team starts with 30 seconds a round, and fast drafting keeps more of it', () => {
  const fast = bankSetup('nfl'), slow = bankSetup('nfl');
  assert.ok(fast.D.teams.every((t) => t.bank === 30 * fast.D.rounds * 1000));
  bankRun(fast, 3); bankRun(slow, 40);
  assert.equal(fast.D.phase, 'done'); assert.equal(slow.D.phase, 'done');
  const f = F.bankShare(fast.D)[0], sl = F.bankShare(slow.D)[0];
  assert.ok(f > 0.85, `fast kept ${f}`);
  assert.equal(sl, 0, 'the slow drafter ran out');
  const bots = F.bankShare(fast.D).slice(1);
  assert.ok(bots.every((x) => x > 0.05 && x < 0.95), `bots spend some of theirs: ${bots.map((x) => x.toFixed(2))}`);
  assert.ok(new Set(bots.map((x) => x.toFixed(2))).size > 3, 'bots draft at different paces');
});

test('time bank: once it runs out, every pick gets the 10-second floor', () => {
  const s = bankSetup('nba');
  s.D.teams[0].bank = 0;
  F.start(s.D, T0);
  let now = T0;
  while (F.onClock(s.D, now).team !== 0) { now += 500; F.tick(s.D, s.ctx, now); }
  const c = F.onClock(s.D, now);
  assert.equal(c.deadline - s.D.clockStart, 10000);
  F.tick(s.D, s.ctx, c.deadline + 1);
  assert.ok(s.D.board[c.index] && s.D.board[c.index].auto, 'autopick at the floor');
});

test('time bank: leftover time becomes league FAAB, half to one and a half budgets', () => {
  const G = require('../fantasy-kit/league.js');
  const s = bankSetup('nfl');
  bankRun(s, 2);
  const L = G.create({ sport: s.sport, draft: s.D, now: T0, settings: { faab: 100 } });
  const share = F.bankShare(s.D);
  L.teams.forEach((t, i) => assert.equal(t.faab, Math.round(100 * (0.5 + share[i]))));
  assert.ok(L.teams[0].faab > Math.max(...L.teams.slice(1).map((t) => t.faab)) - 1, 'the fast drafter has the most');
  const Lg = G.create({ sport: s.sport, draft: s.D, now: T0, settings: { format: 'guillotine' } });
  assert.equal(Lg.teams[0].faab, Math.round(1000 * (0.5 + share[0])), 'scales to a guillotine budget');
});
