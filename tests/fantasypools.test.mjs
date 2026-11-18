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
