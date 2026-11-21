// March Madness pools: node --test tests/fantasypools.test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const P = require('../fantasy-kit/pools-core.js');

// a small tournament: four first-round games over two days, two second-round games, a title game
const T = (d, h) => `2027-03-${d}T${String(h).padStart(2, '0')}:00:00Z`;
const g = (id, round, day, tip, a, as, b, bs, w) => ({ id, round, day: `2027-03-${day}`, tip, a, as, b, bs, w: w || null, final: !!w });
const games = (res = {}) => [
  g('ff', 0, 16, T(16, 22), 'K', 16, 'L', 16, res.ff),
  g('r1', 1, 18, T(18, 16), 'A', 1, 'B', 16, res.r1),
  g('r2', 1, 18, T(18, 18), 'C', 8, 'D', 9, res.r2),
  g('r3', 1, 19, T(19, 16), 'E', 2, 'F', 15, res.r3),
  g('r4', 1, 19, T(19, 18), 'G', 7, 'H', 10, res.r4),
  ...(res.s1 !== undefined ? [g('s1', 2, 20, T(20, 16), 'A', 1, res.r2 || 'C', 8, res.s1)] : []),
];
const members = [{ id: 'u1', name: 'Ann' }, { id: 'u2', name: 'Bo' }, { id: 'u3', name: 'Cy' }];
const pk = (user, slot, team) => ({ user, slot, team });

test('survivor days start with the first round and skip the First Four', () => {
  const ds = P.days(games());
  assert.equal(ds.length, 2);
  assert.deepEqual(ds.map((d) => d.day), ['2027-03-18', '2027-03-19']);
  assert.equal(ds[0].games.length, 2);
});

test('survivor: no 1 or 2 seeds on day 1, a team only once, and nothing after tip-off', () => {
  const board = { games: games(), members, picks: [pk('u1', 'd1', 'C')] };
  const c = P.choices(board, 1, 'u1', T(18, 10));
  assert.equal(c.find((x) => x.team === 'A').why, 'No 1 or 2 seeds on day 1');
  assert.equal(c.find((x) => x.team === 'C').picked, true);
  const c2 = P.choices(board, 2, 'u1', T(19, 10));
  assert.equal(c2.find((x) => x.team === 'E').why, null);           // a 2 seed is fine after day 1
  const used = { games: games(), members, picks: [pk('u1', 'd1', 'G')] };
  // G plays day 2; picked on day 1 here only to check it's then used up
  assert.match(P.choices(used, 2, 'u1', T(19, 10)).find((x) => x.team === 'G').why, /Used on day 1/);
  assert.equal(P.choices(board, 1, 'u1', T(18, 17)).find((x) => x.team === 'B').why, 'Tipped off');
});

test('survivor: a loss or a missed day is out, the last one standing wins', () => {
  const b = { games: games({ r1: 'A', r2: 'D' }), members, picks: [pk('u1', 'd1', 'D'), pk('u2', 'd1', 'C')] };
  const s = P.survivor(b, T(18, 23));
  const by = Object.fromEntries(s.rows.map((r) => [r.id, r]));
  assert.equal(by.u1.alive, true);
  assert.equal(by.u2.alive, false);
  assert.equal(by.u2.out, 1);
  assert.equal(by.u3.cells[1].miss, true);                           // no pick, and the day's games have all tipped
  assert.deepEqual(s.winners, ['u1']);
  assert.equal(s.status, 'done');
});

test('survivor: a pick still to play keeps you alive, and others\' hidden picks stay hidden', () => {
  const b = { games: games(), members, picks: [pk('u1', 'd1', 'C'), pk('u2', 'd1', null)] };
  const s = P.survivor(b, T(18, 10));
  const by = Object.fromEntries(s.rows.map((r) => [r.id, r]));
  assert.equal(by.u2.cells[1].hidden, true);
  assert.equal(by.u3.cells[1].none, true);
  assert.equal(s.rows.every((r) => r.alive), true);
  assert.equal(s.winners, null);
});

test('survivor: when everyone alive loses the same day, they split the win', () => {
  const b = { games: games({ r1: 'A', r2: 'C', r3: 'F', r4: 'G' }), members: members.slice(0, 2),
    picks: [pk('u1', 'd1', 'C'), pk('u2', 'd1', 'C'), pk('u1', 'd2', 'E'), pk('u2', 'd2', 'H')] };
  const s = P.survivor(b, T(19, 23));
  assert.deepEqual(s.winners.sort(), ['u1', 'u2']);
  assert.equal(s.rows.every((r) => r.winner), true);
});

test('5 teams: seeds have to reach 25, five different teams from the field', () => {
  const b = { games: games(), members, picks: [] };
  assert.equal(P.fiveCheck(b, ['A', 'B', 'C', 'D', 'E']).ok, true);   // 1+16+8+9+2 = 36
  const low = P.fiveCheck(b, ['A', 'E', 'C', 'G', 'H']);              // 1+2+8+7+10 = 28: fine
  assert.equal(low.ok, true);
  assert.equal(P.fiveCheck({ games: [g('x', 1, 18, T(18, 1), 'A', 1, 'E', 2), g('y', 1, 18, T(18, 2), 'C', 3, 'G', 4), g('z', 1, 18, T(18, 3), 'H', 5, 'Q', 6)] }, ['A', 'E', 'C', 'G', 'H']).why, 'Your seeds add up to 15. They need to reach 25.');
  assert.equal(P.fiveCheck(b, ['A', 'A', 'B', 'C', 'D']).ok, false);
  assert.equal(P.fiveCheck(b, ['A', 'B', 'C', 'D']).why, 'Pick 1 more.');
  assert.equal(P.fiveCheck(b, ['A', 'B', 'C', 'D', 'K']).ok, true);   // a First Four team is in the field
});

test('5 teams: each win scores 1, 2, 4... by round, First Four wins score nothing, a loss ends the upside', () => {
  const b = { games: games({ ff: 'K', r1: 'A', r2: 'C', s1: 'A' }), members: members.slice(0, 2),
    picks: ['A', 'B', 'C', 'D', 'K'].map((t, i) => pk('u1', 'f' + (i + 1), t)).concat(['E', 'F', 'G', 'H', 'L'].map((t, i) => pk('u2', 'f' + (i + 1), t))) };
  const f = P.five(b, T(20, 23));
  const u1 = f.rows.find((r) => r.id === 'u1');
  assert.equal(u1.points, 1 + 2 + 1);                                   // A won twice (1 + 2), C once (1), K's First Four win counts 0
  assert.equal(u1.teams.find((t) => t.team === 'C').alive, false);      // C lost to A in the second round
  assert.equal(u1.teams.find((t) => t.team === 'A').left, 4 + 8 + 16 + 32);
  assert.equal(f.locked, true);
  assert.equal(f.rows[0].id, 'u1');
});

test('expected points and win chances come from the hub', () => {
  assert.equal(P.xPts({ r: [1, 1, 0, 0, 0, 0, 0] }), 1);
  assert.equal(P.xPts({ r: [0.5, 0.5, 0.25, 0, 0, 0, 0] }), 1 + 0.5 * 2);
  assert.ok(Math.abs(P.winProb({ bpi: 10 }, { bpi: 10 }) - 0.5) < 1e-6);
  assert.ok(P.winProb({ bpi: 20 }, { bpi: 9 }) > 0.8);
});

test('survivor tiebreak: same-day wipeout goes to the higher seeds of winning picks', () => {
  // u1 won day 1 with D (9), u2 with C... both lose day 2; D beat C so give u2 the 8-9 game's other side via r1
  const b = { games: games({ r1: 'B', r2: 'D', r3: 'E', r4: 'G' }), members: members.slice(0, 2),
    picks: [pk('u1', 'd1', 'D'), pk('u2', 'd1', 'B'), pk('u1', 'd2', 'F'), pk('u2', 'd2', 'H')] };
  const s = P.survivor(b, T(19, 23));
  assert.deepEqual(s.winners, ['u2']);                               // 16 seed B beats 9 seed D
  assert.equal(s.rows[0].id, 'u2');
  assert.equal(s.rows[0].seeds, 16);
});

test('5 teams tiebreak: points, then seeds, then the deepest run', () => {
  const gs = [
    g('a1', 1, 18, T(18, 1), 'A', 5, 'B', 12, 'A'), g('a2', 1, 18, T(18, 2), 'C', 5, 'D', 12, 'D'),
    g('a3', 1, 18, T(18, 3), 'E', 5, 'F', 12, 'F'), g('a4', 1, 18, T(18, 4), 'G', 5, 'H', 12, 'G'),
    g('a5', 1, 18, T(18, 5), 'K', 5, 'L', 12, 'K'),
    g('b1', 2, 20, T(20, 1), 'A', 5, 'D', 12, 'A'), g('b2', 2, 20, T(20, 2), 'F', 12, 'G', 5, 'F'),
  ];
  const five = (u, ts) => ts.map((t, i) => pk(u, 'f' + i, t));
  const run = (p1, p2) => P.five({ games: gs, members: members.slice(0, 2), picks: [...five('u1', p1), ...five('u2', p2)] }, T(21, 1));
  // both 3 points and 39 seeds: u1's A won two games, u2's best team won one, so u1 is ahead
  let F = run(['A', 'B', 'C', 'E', 'H'], ['D', 'G', 'K', 'B', 'C']);
  assert.deepEqual(F.rows.map((r) => [r.points, r.seeds]), [[3, 39], [3, 39]]);
  assert.equal(F.rows[0].id, 'u1');
  assert.deepEqual(F.rows.map((r) => r.place), [1, 2]);
  // same points, but u2's seeds are higher: seeds come first
  F = run(['A', 'B', 'C', 'E', 'H'], ['D', 'G', 'K', 'B', 'L']);
  assert.equal(F.rows[0].id, 'u2');
  // identical in every way: a shared place
  F = run(['A', 'B', 'C', 'E', 'H'], ['A', 'B', 'C', 'E', 'H']);
  assert.deepEqual(F.rows.map((r) => r.place), [1, 1]);
});

// ---------- NFL survivor ----------
const ng = (id, week, day, away, home, ap, hp, line) => ({ id, week, kickoff: `2026-11-${String(day).padStart(2, '0')}T18:00:00Z`, away, home, ap: ap ?? null, hp: hp ?? null, final: ap != null, line: line ?? null });
const nmem = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }, { id: 'c', name: 'Cy' }];
const np = (user, w, team) => ({ user, slot: 'w' + w, team });

test('NFL survivor: a loss, a tie and a missed week are out; the last one standing wins', () => {
  const games = [ng('g1', 11, 22, 'NYJ', 'BUF', 10, 30, -9.5), ng('g2', 11, 22, 'DAL', 'PHI', 21, 21, -3), ng('g3', 12, 29, 'KC', 'DEN', 27, 20, 2.5), ng('g4', 12, 29, 'MIA', 'NE', 13, 24)];
  const b = { games, members: nmem, picks: [np('a', 11, 'BUF'), np('b', 11, 'PHI'), np('a', 12, 'KC'), np('c', 11, 'BUF')] };
  const s = P.nfl(b, '2026-12-05T00:00:00Z');
  const by = Object.fromEntries(s.rows.map((r) => [r.id, r]));
  assert.equal(by.b.out, 11); assert.ok(by.b.cells[11].tie);       // a tie is a loss
  assert.equal(by.c.out, 12); assert.ok(by.c.cells[12].miss);      // no week 12 pick once its games kicked off
  assert.deepEqual(s.winners, ['a']);
  assert.equal(s.rows[0].id, 'a');
});

test('NFL survivor: everyone left losing the same week split it; an unplayed pick holds the next week', () => {
  const games = [ng('g1', 11, 22, 'NYJ', 'BUF', 30, 10), ng('g2', 11, 22, 'DAL', 'PHI', 31, 21)];
  let s = P.nfl({ games, members: nmem.slice(0, 2), picks: [np('a', 11, 'BUF'), np('b', 11, 'PHI')] }, '2026-11-24T00:00:00Z');
  assert.deepEqual(s.winners.sort(), ['a', 'b']);
  const live = [ng('g1', 11, 22, 'NYJ', 'BUF'), ng('g2', 11, 23, 'DAL', 'PHI')];
  s = P.nfl({ games: live, members: nmem.slice(0, 2), picks: [np('a', 11, 'BUF'), np('b', 11, null)] }, '2026-11-22T19:00:00Z');
  assert.equal(s.winners, null);
  assert.ok(s.rows.every((r) => r.alive));
  assert.ok(s.rows.find((r) => r.id === 'a').cells[11].live);
  assert.ok(s.rows.find((r) => r.id === 'b').cells[11].hidden);
});

test('NFL survivor choices: used teams and kicked-off games are out, chances come from the line', () => {
  const games = [ng('g1', 11, 22, 'NYJ', 'BUF', 10, 30, -9.5), ng('g3', 12, 29, 'KC', 'DEN', null, null, 3), ng('g4', 12, 30, 'BUF', 'NE', null, null, 7)];
  const ch = P.nflChoices({ games, members: nmem, picks: [np('a', 11, 'BUF')] }, 12, 'a', '2026-11-28T00:00:00Z');
  const by = Object.fromEntries(ch.map((c) => [c.team, c]));
  assert.equal(by.BUF.why, 'Used in week 11');
  assert.equal(by.KC.why, null);
  assert.ok(by.KC.p > 0.5 && by.DEN.p < 0.5);                      // DEN +3 at home: KC is favored
  assert.ok(Math.abs(P.lineProb(-3) - 0.588) < 0.01);
});
