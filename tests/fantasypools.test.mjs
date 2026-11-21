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

// ---------- bowl pick'em ----------
const bg = (id, round, day, a, b, ap, bp) => ({ id, round, label: 'Bowl ' + id, kickoff: `2026-12-${String(day).padStart(2, '0')}T20:00:00Z`, a, b, ap: ap ?? null, bp: bp ?? null, w: ap == null ? null : ap > bp ? a : b, final: ap != null });
const bp = (user, game, team, pts) => ({ user, slot: 'g' + game, team, pts });

test('bowls: right picks score their numbers; ties go to right picks, then the title game total', () => {
  const games = [bg('1', 0, 13, '61', '87', 30, 20), bg('2', 0, 14, '99', '84', 10, 24), bg('3', 4, 30, '2390', '61', 21, 17)];
  const picks = [bp('a', '1', '61', 3), bp('a', '2', '99', 1), bp('a', '3', '61', 2), bp('b', '1', '87', 1), bp('b', '2', '84', 3), bp('b', '3', '61', 2),
    { user: 'a', slot: 'tb', team: '40' }, { user: 'b', slot: 'tb', team: '50' }];
  const B = P.bowls({ games, members: nmem.slice(0, 2), picks }, '2027-01-01T00:00:00Z');
  assert.deepEqual(B.rows.map((r) => [r.id, r.points, r.right]), [['a', 3, 1], ['b', 3, 1]]);
  assert.equal(B.total, 38);                                        // a guessed 40, closer than b's 50
  assert.equal(B.rows[0].place, 1); assert.equal(B.rows[1].place, 2);
  assert.ok(B.done); assert.deepEqual(B.winners, ['a']);
});

test('bowls: numbers once each; auto-rank gives the surest pick the biggest number and leaves locked games alone', () => {
  assert.equal(P.bowlsCheck({ 1: { pts: 2 }, 2: { pts: 2 } }, 3).ok, false);
  assert.equal(P.bowlsCheck({ 1: { pts: 4 } }, 3).ok, false);
  const games = [bg('1', 0, 13, 'x', 'y'), bg('2', 0, 20, 'p', 'q'), bg('3', 0, 21, 'm', 'n'), bg('4', 4, 30, null, null)];
  const prob = (g, t) => ({ x: 0.55, q: 0.9, m: 0.7 })[t];
  const out = P.autoRank(games, { 1: { team: 'x', pts: 4 }, 2: { team: 'q' }, 3: { team: 'm' } }, prob, '2026-12-15T00:00:00Z');
  assert.equal(out[1].pts, 4);                                      // game 1 has kicked off: it keeps 4
  assert.deepEqual([out[2].pts, out[3].pts, out[4].pts], [3, 2, 1]); // 90% gets 3, 70% gets 2, the unpicked title game 1
});

// ---------- NFL bracket ----------
const field = ['BUF', 'KC', 'JAX', 'CIN', 'DEN', 'PIT', 'CLE'].map((t, i) => ({ team: t, conf: 'AFC', seed: i + 1 }))
  .concat(['SF', 'DET', 'NYG', 'CAR', 'MIN', 'CHI', 'GB'].map((t, i) => ({ team: t, conf: 'NFC', seed: i + 1 })));

test('NFL bracket: the divisional round reseeds, and a changed pick drops what it fed', () => {
  const picks = { Awc1: 'CLE', Awc2: 'JAX', Awc3: 'DEN' };         // 7, 3 and 5 seeds win
  let b = P.bracket(field, picks);
  assert.deepEqual([b.confs.AFC.dv[0].a, b.confs.AFC.dv[0].b], ['BUF', 'CLE']);   // the 1 seed gets the lowest seed left
  assert.deepEqual([b.confs.AFC.dv[1].a, b.confs.AFC.dv[1].b], ['JAX', 'DEN']);
  b = P.bracket(field, Object.assign({}, picks, { Adv1: 'CLE', Adv2: 'JAX', Acf: 'CLE' }));
  assert.equal(b.confs.AFC.cf.pick, 'CLE');
  // KC beats CLE in the Wild Card round instead: CLE's later picks no longer fit
  const kept = P.bracketPicks(field, Object.assign({}, picks, { Awc1: 'KC', Adv1: 'CLE', Acf: 'CLE' }));
  assert.equal(kept.Adv1, undefined); assert.equal(kept.Acf, undefined); assert.equal(kept.Awc1, 'KC');
});

test('NFL bracket scoring: 1, 2, 4, 8 a round; points still possible drop when a team is out', () => {
  const games = [{ id: 'w1', round: 1, a: 'CLE', b: 'KC', ap: 10, bp: 20, w: 'KC', final: true }, { id: 'w2', round: 1, a: 'PIT', b: 'JAX', ap: 24, bp: 17, w: 'PIT', final: true }];
  const picks = [{ user: 'a', slot: 'Awc1', team: 'KC' }, { user: 'a', slot: 'Awc2', team: 'JAX' }, { user: 'a', slot: 'Acf', team: 'KC' }, { user: 'a', slot: 'sb', team: 'KC' }];
  const R = P.nflpo({ games, members: nmem.slice(0, 1), picks }).rows[0];
  assert.equal(R.points, 1);                                        // KC won its Wild Card game; JAX lost
  assert.equal(R.max, 1 + 4 + 8);                                   // KC can still win the AFC and the Super Bowl
  assert.equal(R.champ, 'KC');
});

// ---------- NFL playoff fantasy ----------
test('playoff fantasy: half-PPR points by round, totals, and every player an entry has used', () => {
  const picks = [{ user: 'a', slot: 'r1:QB', team: '4984@BUF' }, { user: 'a', slot: 'r1:FLEX', team: '9509@KC' }, { user: 'a', slot: 'r2:QB', team: '6904@PHI' },
    { user: 'b', slot: 'r1:QB', team: '6904@PHI' }];
  const stats = { 1: { players: { 4984: [20, 24.5, 29], 9509: [10, 12.25, 14.5], 6904: [18, 18, 18] } }, 2: { players: { 6904: [9, 9.5, 10] } } };
  const F = P.nflff({ members: nmem.slice(0, 2), picks }, stats);
  const a = F.rows.find((r) => r.id === 'a');
  assert.equal(a.rounds[1].pts, 36.75);
  assert.equal(a.rounds[2].pts, 9.5);
  assert.equal(a.rounds[3].pts, null);                              // no stats yet: not scored
  assert.equal(a.total, 46.25);
  assert.deepEqual(a.used.sort(), ['4984', '6904', '9509']);
  assert.equal(F.rows[0].id, 'a');
  assert.deepEqual(P.ffSlots('FLEX'), ['RB', 'WR', 'TE']); assert.deepEqual(P.ffSlots('RB2'), ['RB']);
});

test('playoff reach: byes skip the Wild Card round, finals count, stronger teams go further', () => {
  const f = field.map((x) => Object.assign({}, x, { gp: 17, pd: x.team === 'BUF' ? 170 : x.team === 'CLE' ? -40 : 0 }));
  let s = 1; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const R = P.reach(f, [], 3000, rnd);
  assert.equal(R.BUF.p[0], 0); assert.equal(R.BUF.p[1], 1);         // the 1 seed rests, then plays the divisional round
  assert.equal(R.KC.p[0], 1);
  assert.ok(R.BUF.p[3] > R.JAX.p[3]);                              // +10 a game reaches the Super Bowl more often
  const done = P.reach(f, [{ round: 1, a: 'CLE', b: 'KC', w: 'CLE', final: true }], 2000, rnd);
  assert.equal(done.KC.p[1], 0); assert.equal(done.CLE.p[1], 1);    // CLE won: it's in the divisional round for sure
  assert.ok(Math.abs(R.KC.games - (R.KC.p[0] + R.KC.p[1] + R.KC.p[2] + R.KC.p[3])) < 1e-9);
});

test('pool status: picks still to make come with a deadline; standings, outs and waits say so', () => {
  const me = (id) => nmem.map((m) => Object.assign({}, m, { me: m.id === id }));
  // NFL survivor: week 12 open, Ann has no pick yet: due at the next kickoff still ahead
  const games = [ng('g1', 11, 22, 'NYJ', 'BUF', 10, 30), ng('g3', 12, 29, 'KC', 'DEN'), ng('g4', 12, 30, 'MIA', 'NE')];
  let s = P.status({ pool: { kind: 'nfl' }, games, members: me('a'), picks: [np('a', 11, 'BUF'), np('b', 11, 'NYJ'), np('c', 11, 'BUF')] }, '2026-11-29T20:00:00Z');
  assert.equal(s.tone, 'todo'); assert.equal(s.due, Date.parse('2026-11-30T18:00:00Z')); assert.match(s.text, /2 of 3 left/);
  s = P.status({ pool: { kind: 'nfl' }, games, members: me('b'), picks: [np('a', 11, 'BUF'), np('b', 11, 'NYJ'), np('c', 11, 'BUF')] }, '2026-11-29T20:00:00Z');
  assert.equal(s.tone, 'out'); assert.equal(s.text, 'Out in week 11');
  s = P.status({ pool: { kind: 'nfl' }, games, members: me('c'), picks: [np('a', 11, 'BUF'), np('b', 11, 'NYJ'), np('c', 11, 'BUF'), np('c', 12, 'NE')] }, '2026-11-29T20:00:00Z');
  assert.equal(s.tone, 'ok');
  // bowls: two unpicked games ahead, the earliest one is the deadline; before anything kicks off there's no place yet
  const bgs = [bg('1', 0, 13, '61', '87'), bg('2', 0, 14, '99', '84'), bg('3', 4, 30, '2390', '61')];
  s = P.status({ pool: { kind: 'bowls' }, games: bgs, members: me('a'), picks: [bp('a', '1', '61', 3)] }, '2026-12-10T00:00:00Z');
  assert.equal(s.text, '2 picks to make'); assert.equal(s.due, Date.parse('2026-12-14T20:00:00Z'));
  s = P.status({ pool: { kind: 'bowls' }, games: bgs.map((g, i) => i ? g : Object.assign({}, g, { ap: 30, bp: 20, w: '61', final: true })), members: me('a'),
    picks: [bp('a', '1', '61', 3), bp('a', '2', '99', 2), bp('a', '3', '61', 1), bp('b', '1', '87', 3)] }, '2026-12-13T23:00:00Z');
  assert.equal(s.text, '1st of 3, 3 pts'); assert.equal(s.tone, 'ok');
  s = P.status({ pool: { kind: 'bowls' }, games: [bg('9', 2, 31, null, '333')], members: me('a'), picks: [] }, '2026-11-21T00:00:00Z');
  assert.equal(s.tone, 'wait');
  // March Madness before the field is set
  assert.equal(P.status({ pool: { kind: 'five' }, projected: true, games: [], members: me('a'), picks: [] }).tone, 'wait');
  assert.equal(P.ord(1) + P.ord(2) + P.ord(3) + P.ord(11) + P.ord(22), '1st2nd3rd11th22nd');
});

test('squares: claims, the drawn numbers, and each quarter\'s winning square from the score\'s last digits', () => {
  const members = [{ id: 'a', name: 'Ann', me: true }, { id: 'b', name: 'Bo' }];
  const fieldSq = [{ team: 'KC', conf: 'AFC', seed: 1 }, { team: 'SF', conf: 'NFC', seed: 1 }];
  // SF is listed away (a), KC home (b): KC still goes across the top as the AFC team
  const sb = { id: 'sb', round: 4, kickoff: '2027-02-14T23:30:00Z', a: 'SF', b: 'KC', ap: 20, bp: 17, final: false, lines: { a: [7, 3, 0], b: [0, 14, 3] } };
  const nums = { c: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], r: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] };
  const picks = [{ user: 'a', slot: 's97', team: 'x' }, { user: 'b', slot: 's84', team: 'x' }, { user: 'a', slot: 's50', team: 'n:Uncle Joe' }];
  const board = { pool: { kind: 'squares', extra: { nums, price: 5, pay: [20, 20, 20, 40] } }, games: [sb], field: fieldSq, members, picks };
  const S = P.squares(board, '2027-02-15T01:00:00Z');
  assert.equal(S.top, 'KC'); assert.equal(S.side, 'SF');
  // after Q1 KC 0, SF 7: column 0, row of 7 = index 2 -> square 20 (empty). Half: KC 14, SF 10 -> col 4, row of 0 = 9 -> 94
  assert.equal(S.periods.length, 2);                                // Q3 is still being played (no 4th quarter yet)
  assert.deepEqual(S.periods.map((x) => x.sq), [20, 94]);
  assert.equal(S.periods[0].cell, null);                            // nobody had it
  assert.equal(S.cells[50].name, 'Uncle Joe'); assert.ok(S.cells[50].guest); assert.ok(!S.cells[50].mine);
  assert.equal(S.mine, 1); assert.equal(S.claimed, 3); assert.equal(S.pot, 15);
  assert.equal(S.live.sq, 97);                                      // right now KC 17, SF 20: column 7, row of 0 (9)
  const final = P.squares(Object.assign({}, board, { games: [Object.assign({}, sb, { final: true, ap: 20, bp: 27, lines: { a: [7, 3, 0, 10], b: [0, 14, 3, 10] } })] }), '2027-02-15T03:00:00Z');
  assert.equal(final.periods.length, 4);
  assert.equal(final.periods[3].sq, 97);                            // KC 27 -> col 7; SF 20 -> 0 -> row 9: Ann's square
  assert.equal(final.periods[3].cell.name, 'Ann'); assert.equal(final.periods[3].amount, 6);
  assert.equal(final.people[0].name, 'Ann');
  assert.equal(P.status(Object.assign({}, board, { games: final.game ? [final.game] : [] }), '2027-02-15T03:00:00Z').tone, 'won');
});

test('survivor planner: each team once, the best overall path, byes and used teams left out', () => {
  // three weeks; AAA is great every week, BBB only in week 2: the planner saves AAA for a week BBB can't cover
  const G = (wk, a, h, sp) => ['REG', wk, '2026-12-0' + wk, a, h, null, null, sp, 0, 0];
  const games = [G(1, 'XXX', 'AAA', 10), G(1, 'YYY', 'CCC', 3), G(2, 'ZZZ', 'BBB', 12), G(2, 'WWW', 'AAA', 11), G(3, 'VVV', 'AAA', 9), G(3, 'UUU', 'CCC', 2)];
  const out = P.survPlan({ games, ratings: {}, from: 1, to: 3 });
  const by = Object.fromEntries(out.path.map((x) => [x.week, x.team]));
  assert.equal(by[2], 'BBB');                                       // take BBB in week 2 so AAA covers week 1 or 3
  assert.equal(new Set(out.path.map((x) => x.team)).size, 3);       // never the same team twice
  assert.ok(out.odds > 0 && out.odds < 1);
  const noA = P.survPlan({ games, ratings: {}, from: 1, to: 3, used: ['AAA'] });
  assert.ok(!noA.path.some((x) => x.team === 'AAA'));
  // no posted spread: the rating gap plus home field decides
  const r = P.survPlan({ games: [['REG', 4, 'd', 'BAD', 'GOOD', null, null, null, 0, 0]], ratings: { GOOD: 5, BAD: -5 }, from: 4, to: 4 });
  assert.equal(r.path[0].team, 'GOOD'); assert.ok(r.grid.GOOD[4] > 0.75);
});
