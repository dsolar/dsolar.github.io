// March Madness fantasy: the rules (fantasy-kit/pools-core.js mmff, mmffPoints) and the status the reminders use
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path");
const P = require(path.join(__dirname, "..", "fantasy-kit/pools-core.js"));
const games = [{ id: "g1", round: 1, a: "1", b: "2", tip: "2027-03-19T17:00:00Z" }, { id: "g2", round: 2, a: "1", b: "3", tip: "2027-03-21T17:00:00Z" }];
const board = (picks, o) => Object.assign({ pool: { kind: "mmff", season: 2027 }, games, members: [{ id: "me", name: "David", me: true }, { id: "u2", name: "Mike" }], picks }, o || {});

test("box-score points: 1 a point, 1.2 a rebound, 1.5 an assist, 3 a steal or block, minus 1 a turnover", () => {
  assert.equal(P.mmffPoints({ pts: 20, reb: 5, ast: 3, stl: 1, blk: 1, tov: 2 }), 34.5);
  assert.deepEqual(P.mmffSlots("G1"), ["G"]); assert.deepEqual(P.mmffSlots("F2"), ["F", "C"]); assert.deepEqual(P.mmffSlots("UTIL"), ["G", "F", "C"]);
});

test("a round scores once it has box scores; totals add up across rounds; used players are remembered by round", () => {
  const picks = [{ user: "me", slot: "r1:G1", team: "10@1" }, { user: "me", slot: "r1:F1", team: "11@2" }, { user: "me", slot: "r2:G1", team: "12@1" }, { user: "u2", slot: "r1:G1", team: "20@2" }];
  const X = P.mmff(board(picks), { 1: { players: { 10: 30, 11: 12.5, 20: 50 } } });
  const me = X.rows.find((r) => r.me), mike = X.rows.find((r) => r.id === "u2");
  assert.equal(me.rounds[1].pts, 42.5); assert.equal(me.rounds[2].pts, null, "no box scores for round 2 yet");
  assert.equal(me.total, 42.5); assert.equal(mike.total, 50); assert.equal(X.rows[0].id, "u2");
  assert.deepEqual(me.used, { 10: 1, 11: 1, 12: 2 });
});

test("status: practice before Selection Sunday, then the lineup due at the round's next tip", () => {
  assert.equal(P.status(board([], { projected: true }), Date.parse("2027-03-01T12:00:00Z")).tone, "wait");
  const due = P.status(board([{ user: "me", slot: "r1:G1", team: "10@1" }]), Date.parse("2027-03-18T12:00:00Z"));
  assert.equal(due.tone, "todo"); assert.equal(due.due, Date.parse("2027-03-19T17:00:00Z")); assert.match(due.text, /Round of 64: 4 spots open/);
  const set = P.status(board(["G1", "G2", "F1", "F2", "UTIL"].map((s, i) => ({ user: "me", slot: "r1:" + s, team: `${10 + i}@1` }))), Date.parse("2027-03-18T12:00:00Z"));
  assert.equal(set.tone, "ok");
});
