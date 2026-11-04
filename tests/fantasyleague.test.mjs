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

test('claim order: equal bids run in the order you set, a higher bid always runs first, and editing keeps the place', () => {
  const s = season('nfl', { scoring: 'half' });
  const L = s.L, ctx = s.ctx;
  L.settings.waivers = 'faab';
  const fas = ctx.free.filter((p) => !G.onWaivers(L, p.id, T0 + DAY)).slice(0, 3);
  const drop = L.rosters[0].map((id) => ctx.byId[id]).sort((a, b) => a.v - b.v)[0].id;
  // both claims drop the same player, so only the one that runs first can win
  assert.ok(G.claim(L, ctx, 0, fas[0].id, drop, 5, T0 + DAY).ok);
  assert.ok(G.claim(L, ctx, 0, fas[1].id, drop, 5, T0 + DAY + 1).ok);
  assert.ok(G.claim(L, ctx, 0, fas[2].id, drop, 9, T0 + DAY + 2).ok);
  const ids = () => G.myClaims(L, 0).map((c) => c.add);
  assert.deepEqual(ids(), [fas[2].id, fas[0].id, fas[1].id], 'highest bid first, then the order they went in');
  const c1 = L.claims.find((c) => c.add === fas[1].id && c.status === 'open');
  assert.equal(G.moveClaim(L, 0, c1.id, -1).ok, true);
  assert.deepEqual(ids(), [fas[2].id, fas[1].id, fas[0].id]);
  const c2 = L.claims.find((c) => c.add === fas[1].id && c.status === 'open');
  assert.equal(G.moveClaim(L, 0, c2.id, -1).ok, false, 'a $5 bid cannot jump a $9 bid');
  // raising the $5 bid's amount, then setting it back, keeps its place among the $5 bids
  assert.ok(G.claim(L, ctx, 0, fas[1].id, drop, 6, T0 + 3 * 3600e3).ok);
  assert.ok(G.claim(L, ctx, 0, fas[1].id, drop, 5, T0 + 4 * 3600e3).ok);
  assert.deepEqual(ids(), [fas[2].id, fas[1].id, fas[0].id]);
  // cancel the $9 so the $5s decide it
  G.cancelClaim(L, L.claims.find((c) => c.add === fas[2].id && c.status === 'open').id);
  const won = G.runWaivers(L, ctx, T0 + 2 * DAY);
  assert.deepEqual(won.map((c) => c.add), [fas[1].id]);
  assert.equal(L.claims.find((c) => c.add === fas[0].id && c.team === 0 && c.status !== 'cancelled').status, 'failed');
});

test('category projections: so far plus the rest of the week, odds that settle as the week ends', () => {
  const s = season('nba', { scoring: 'cats9' });
  const L = s.L, ctx = s.ctx;
  const [a, b] = L.schedule[0][0];
  const half = G.projectCats(L, ctx, a, 1, 0.5), now = G.matchups(L, ctx, 1, 0.5).find((m) => m.a === a);
  for (const c of G.scoring(L, ctx).cats) {
    if (!c.num && !c.rate) assert.ok(half.cats[c.k] >= now.ta.cats[c.k] - 1e-9, `${c.k}: the projection keeps what's already in`);
    assert.ok(now.proj.probs[c.k] >= 0 && now.proj.probs[c.k] <= 1);
  }
  assert.ok(now.winProb > 0 && now.winProb < 1);
  assert.equal(now.proj.sa + now.proj.sb + now.proj.ties, G.scoring(L, ctx).cats.length);
  // with the week over nothing is left to come: the projection is the result and the odds are certain
  const done = G.matchups(L, ctx, 1, 1).find((m) => m.a === a);
  assert.deepEqual([done.proj.sa, done.proj.sb], [done.sa, done.sb]);
  for (const q of Object.values(done.proj.probs)) assert.ok(q === 0 || q === 1 || q === 0.5);
  // a player who's out adds nothing more
  assert.equal(G.plays({ inj: 'Out' }), 0);
  assert.equal(G.plays({ inj: '' }), 1);
});

test('one-week league this week: starts in the week that is on, and only what comes after the start counts', () => {
  const Z = require('../fantasy-kit/season.js');
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nba.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nba), data);
  const players = data.players.map((p) => ({ ...p }));
  const lineup = sport.lineup.filter((x) => x !== 'BN');
  V.evaluate(sport, players, { teams: 2, lineup, scoring: 'points' });
  // a Wednesday: the week began Monday at 13:00 UTC
  const wed = Date.UTC(2026, 10, 4, 15, 0, 0), mon = Date.UTC(2026, 10, 2, 13, 0, 0);
  const D = F.create({ sport, teams: 2, seed: 4, now: wed - 3600e3, lineup, botDelay: 0, scoring: 'points' });
  D.teams[0].owner = 'David';
  F.start(D, wed - 3600e3); D.teams[0].auto = true; F.tick(D, F.context(D, players, sport), wed - 3600e3 + 1);
  D.season = { format: 'h2h', weeks: 1, when: 'now', oneWeek: true, playoffTeams: 0, deadline: 0 };
  const pid = D.board.find((x) => x && x.team === 0).pid, W = { sport: 'nba', season: data.season, line: 'pg', cols: ['gp', 'eg', 'min', 'fgm', 'fga', 'ftm', 'fta', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov'], weeks: {} };
  const line = (g, pts) => [g, 0, 30 * g, 0, 0, 0, 0, 0, pts, 5 * g, 4 * g, 0, 0, 0];
  W.weeks['3'] = { start: '2026-11-02', end: '2026-11-08', final: false, lines: { [pid]: line(2, 50) } };
  const L = Z.begin(D, sport, { now: wed, real: W });
  assert.equal(L.start, mon, 'starts in the week that is on');
  assert.equal(G.totalWeeks(L), 1);
  assert.deepEqual(L.baseline.lines[pid], line(2, 50), 'what he had done before the start');
  const ctx = G.context(L, players, sport, { real: W });
  const p = ctx.byId[pid];
  assert.equal(G.playerWeek(L, ctx, p, 1, 0.5).pts, 0, 'nothing yet since the start');
  W.weeks['3'].lines = { [pid]: line(3, 80) };   // a game later: 30 points, a few rebounds and assists
  const after = G.playerWeek(L, ctx, p, 1, 0.6).pts;
  assert.ok(after > 30 && after < 50, `only the new game counts (${after})`);
  // next week, or with less than a day left this week, it plays the next full week instead
  D.season.when = 'next';
  assert.equal(Z.begin(D, sport, { now: wed, real: W }).start, mon + 7 * 864e5);
  D.season.when = 'now';
  assert.equal(Z.begin(D, sport, { now: mon + 7 * 864e5 - 3 * 3600e3, real: W }).start, mon + 7 * 864e5);
});

test('game-time locks: a player whose game has started stays put, and a pickup before his game counts his whole week', () => {
  const s = season('nfl', { scoring: 'half' });
  const L = s.L, ctx = s.ctx;
  L.settings.real = true;
  const now = G.weekStart(L, 1) + 3 * 864e5;   // Friday
  const lu = G.lineupFor(L, ctx, 0, 1), starter = ctx.byId[lu[0]];
  const bench = L.rosters[0].map((id) => ctx.byId[id]).find((p) => !lu.includes(p.id) && p.t !== starter.t);
  // the live feed's schedule: the starter's team has played, everyone else kicks off Sunday
  const teams = {}; for (const p of s.players) if (p.t) teams[p.t] = now + 2 * 864e5;
  teams[starter.t] = now - 864e5;
  assert.ok(G.setKicks(L, { start: new Date(G.weekStart(L, 1)).toISOString().slice(0, 10), games: Object.fromEntries(Object.entries(teams).map(([t, at]) => [t, [{ at: new Date(at).toISOString(), state: at < now ? 'post' : 'pre' }]])) }));
  assert.equal(G.isLocked(L, starter, 1, now), true);
  assert.equal(G.isLocked(L, bench, 1, now), false);
  assert.equal(G.move(L, ctx, 0, 1, starter.id, 'BN', now).ok, false, 'a locked starter cannot be benched');
  const slot = L.settings.lineup.indexOf(L.settings.lineup.find((x, i) => i !== 0 && S.fits(ctx.sport, bench, x)));
  if (slot >= 0) assert.equal(G.move(L, ctx, 0, 1, bench.id, slot, now).ok, true, 'an unlocked bench player can move in');
  assert.equal(G.addDrop(L, ctx, 0, null, starter.id, now).ok, false, 'a locked starter cannot be dropped');
  // the best lineup keeps the locked starter where he is
  assert.equal(G.bestLineup(L, ctx, 0, 1, now)[0], starter.id);
  // lineups nobody saved are saved half an hour before the first game
  delete (L.lineups[1] || {})[3];
  assert.ok(G.freezeLineups(L, ctx, now));
  assert.ok(L.lineups[1][3], 'a bot lineup is saved once games start');
  // a free agent picked up before his game counts all of it
  const fa = ctx.free.find((p) => p.t && p.t !== starter.t && !G.onWaivers(L, p.id, now));
  const cut = L.rosters[0].map((id) => ctx.byId[id]).find((p) => !G.lineupFor(L, ctx, 0, 1).includes(p.id) && p.id !== bench.id);
  assert.ok(G.addDrop(L, ctx, 0, fa.id, cut.id, now).ok);
  assert.equal(L.joined[fa.id].f, 0);
});

test('showdown: one game\'s pool, a captain who counts 1.5x and goes to the best player, everyone locked at kickoff', () => {
  const Z = require('../fantasy-kit/season.js');
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const teams = ['BUF', 'MIA'];
  const players = data.players.filter((p) => teams.includes(p.t)).map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 2, lineup: S.SHOWDOWN.lineup, bench: 0, scoring: 'half' });
  const now = Date.UTC(2026, 10, 4, 15), at = now + 864e5;
  const D = F.create({ sport, teams: 2, seed: 9, now, lineup: S.SHOWDOWN.lineup, bench: 0, botDelay: 0, scoring: 'half' });
  D.teams[0].owner = 'David';
  F.start(D, now); D.teams[0].auto = true; F.tick(D, F.context(D, players, sport), now + 1);
  D.season = { format: 'h2h', weeks: 1, when: 'now', oneWeek: true, playoffTeams: 0, deadline: 0, ir: 0, showdown: { id: '401', teams, at, label: 'BUF @ MIA' } };
  const L = Z.begin(D, sport, { now: now + 2 });
  const ctx = G.context(L, players, sport);
  assert.deepEqual(L.settings.pool, teams);
  assert.ok(L.rosters.flat().every((id) => teams.includes(ctx.byId[id].t)));
  const lu = G.lineupFor(L, ctx, 0, 1), cap = ctx.byId[lu[0]];
  assert.equal(L.settings.lineup[0], 'CPT');
  assert.ok(lu.every((id) => !id || ctx.byId[id].v <= cap.v), 'the captain is the best starter');
  const tw = G.teamWeek(L, ctx, 0, 1, 1);
  const plain = G.playerWeek(L, ctx, cap, 1, 1, 1).pts;
  assert.ok(Math.abs(tw.players[cap.id] - plain * 1.5) < 1e-9, 'the captain scores 1.5x');
  assert.equal(G.isLocked(L, cap, 1, at - 1), false);
  assert.equal(G.isLocked(L, cap, 1, at), true, 'kickoff locks everyone');
});

test('team roulette: every pick comes from the team the wheel lands on, a round can share one, and a re-spin draws another', () => {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const players = data.players.map((p) => ({ ...p }));
  const lineup = sport.lineup.filter((x) => x !== 'BN');
  V.evaluate(sport, players, { teams: 4, lineup, scoring: 'half' });
  const teams = [...new Set(players.map((p) => p.t).filter((t) => t && t !== 'FA'))];
  for (const each of ['pick', 'round']) {
    const D = F.create({ sport, teams: 4, seed: 21, now: T0, lineup, botDelay: 0, scoring: 'half' });
    D.roulette = { teams, each, respins: 1, spins: {}, used: {} };
    const ctx = F.context(D, players, sport);
    F.start(D, T0);
    const byRound = {};
    for (let k = 0; k < D.order.length; k++) {
      const want = F.wheelFor(D, ctx, D.order[k]);
      assert.ok(want, `pick ${k + 1} has a team`);
      assert.ok(players.filter((p) => p.t === want).some((p) => F.canAdd(D, ctx, D.order[k], p).ok));
      assert.equal(F.tick(D, ctx, T0 + k + 1, 1), 1);
      const p = ctx.byId[D.board[k].pid];
      assert.equal(p.t, want, `pick ${k + 1} came from ${want}`);
      const r = Math.floor(k / 4); (byRound[r] = byRound[r] || new Set()).add(want);
    }
    if (each === 'round') assert.ok(Object.values(byRound).filter((x) => x.size === 1).length >= D.rounds - 3, 'a round mostly shares one team (one is skipped only when a roster has no use for it)');
    assert.equal(D.phase, 'done');
  }
  // a re-spin on the clock changes the team, once
  const D = F.create({ sport, teams: 2, seed: 5, now: T0, lineup, botDelay: 60e3, scoring: 'half' });
  D.teams[0].owner = 'David';
  D.roulette = { teams, each: 'pick', respins: 1, spins: {}, used: {} };
  const ctx = F.context(D, players, sport);
  F.start(D, T0);
  const was = F.wheelFor(D, ctx, 0), r = F.respin(D, ctx, 0, T0 + 1);
  assert.ok(r.ok); assert.notEqual(r.team, was); assert.equal(F.wheelFor(D, ctx, 0), r.team);
  assert.equal(F.respin(D, ctx, 0, T0 + 2).ok, false, 'one re-spin a draft');
  const off = players.find((p) => p.t !== r.team && ctx.own[p.id] == null);
  assert.equal(F.pick(D, ctx, 0, off.id, T0 + 3).ok, false, 'a player from another team is refused');
});

test('heist: shields block, a steal takes the player at 1.5x and frees a hole to fill, a jinx halves, rosters freeze', () => {
  const Z = require('../fantasy-kit/season.js');
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const players = data.players.map((p) => ({ ...p }));
  const lineup = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX'];
  V.evaluate(sport, players, { teams: 2, lineup, bench: 0, scoring: 'half' });
  const now = Date.UTC(2026, 10, 4, 15);
  const D = F.create({ sport, teams: 2, seed: 13, now, lineup, bench: 0, botDelay: 0, scoring: 'half' });
  D.teams[0].owner = 'David'; D.teams[1].owner = 'Bea';
  D.season = { format: 'h2h', weeks: 1, oneWeek: true, playoffTeams: 0, deadline: 0, ir: 0, heist: { shields: 3, steals: 1, jinxes: 1, clock: 60 } };
  const ctx = F.context(D, players, sport);
  F.start(D, now); D.teams[0].auto = true; D.teams[1].auto = true; F.tick(D, ctx, now + 1);
  D.teams[0].auto = false; D.teams[1].auto = false;
  assert.equal(D.phase, 'heist', 'the heist follows the last pick');
  const a = F.heistLineup(D, ctx, 0), b = F.heistLineup(D, ctx, 1);
  // David shields three, steals Bea's QB and jinxes her TE; Bea shields her TE and steals nothing
  assert.equal(F.heistMove(D, ctx, 0, { shield: a.slice(0, 4), steal: [], jinx: [] }, now).ok, false, 'four shields is one too many');
  assert.ok(F.heistMove(D, ctx, 0, { shield: a.slice(1, 4), steal: [b[0]], jinx: [b[6]] }, now).ok);
  assert.ok(F.heistMove(D, ctx, 1, { shield: [b[6]], steal: [], jinx: [] }, now).ok);
  assert.ok(F.heistTick(D, ctx, now + 2));
  assert.equal(D.phase, 'done');
  const ev = D.heist.result.events;
  assert.ok(ev.find((e) => e.type === 'steal' && e.ok), 'the steal of an unshielded QB works');
  assert.ok(ev.find((e) => e.type === 'jinx' && !e.ok), 'the jinx on a shielded TE fails');
  const L = Z.begin(D, sport, { now: now + 3 });
  const lc = G.context(L, players, sport);
  assert.ok(L.rosters[0].includes(b[0]) && !L.rosters[1].includes(b[0]), 'the QB changed teams');
  assert.ok(!L.rosters[0].includes(a[0]), "the thief's own QB was released");
  assert.equal(L.pmult[b[0]], 1.5);
  assert.equal(L.rosters[1].length, 7, 'the robbed team has a hole');
  assert.equal(G.addDrop(L, lc, 0, null, L.rosters[0][3], now + 4).ok, false, 'no drops after a heist');
  const fa = lc.free.find((p) => S.positions(p).includes('QB'));
  assert.ok(G.addDrop(L, lc, 1, fa.id, null, now + 4).ok, 'the robbed team fills the hole');
  assert.equal(G.lineupFor(L, lc, 1, 1)[0], fa.id, 'and he goes straight into the open spot');
  const tw = G.teamWeek(L, lc, 0, 1, 1), plain = G.playerWeek(L, lc, lc.byId[b[0]], 1, 1, 1).pts;
  assert.ok(Math.abs(tw.players[b[0]] - plain * 1.5) < 1e-9, 'the stolen QB scores 1.5x for the thief');
  assert.deepEqual(L.schedule[0], D.heist.pairs);
});

test('pack draft: alike packs, every pick from the pack in front of you, passing left then right, full lineups', () => {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const players = data.players.map((p) => ({ ...p }));
  const lineup = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX'];
  V.evaluate(sport, players, { teams: 4, lineup, bench: 2, scoring: 'half' });
  const D = F.create({ sport, type: 'pack', teams: 4, seed: 8, now: T0, lineup, bench: 2, botDelay: 0, scoring: 'half' });
  F.dealPacks(D, players, sport);
  assert.deepEqual(D.packs.sizes, [5, 5]);
  assert.equal(D.trading, false);
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const tot = D.packs.cards[0].map((ids) => ids.reduce((s, id) => s + Math.max(0, byId[id].v), 0));
  assert.ok(Math.max(...tot) / Math.min(...tot) < 1.35, `the first packs are alike: ${tot.map(Math.round).join(', ')}`);
  const ctx = F.context(D, players, sport);
  F.start(D, T0);
  // turn by turn: each team's pick is from the pack in front of it
  const n = 4;
  for (let t = 0; t < D.rounds; t++) {
    const before = Object.fromEntries(D.round1.map((team) => [team, F.packFor(D, ctx, team)]));
    // in turn 1 of a set each seat holds its own pack; a turn later, the pack from the seat to its left (or right)
    const { q, j } = F.packAt(D, t);
    if (j === 1) { const seat0 = D.round1[0], from = q % 2 === 0 ? n - 1 : 1; assert.ok(D.packs.cards[q][from].includes(before[seat0][0]) || D.packs.cards[q][from].some((id) => before[seat0].includes(id))); }
    F.tick(D, ctx, T0 + t + 1, n);
    for (const team of D.round1) { const pk = D.board[t * n + D.round1.indexOf(team)]; assert.ok(before[team].includes(pk.pid), `turn ${t + 1}: ${D.teams[team].name} picked from its pack`); }
  }
  assert.equal(D.phase, 'done');
  for (const team of D.round1) {
    const ros = F.rosters(D)[team].map((id) => byId[id]);
    assert.equal(ros.length, 10);
    assert.ok(F.assign(sport, ros, lineup).every(Boolean), `${D.teams[team].name} fills its lineup`);
  }
});
