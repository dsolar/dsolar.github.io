// Super Bowl prop sheet: the rules (fantasy-kit/pools-core.js props) and the page (fantasy-kit/pools.js propsPicks,
// propsAnswers) on the standard sheet (tests/fixtures/props-sheet.json, the same as mm_props_default in the database)
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { JSDOM } = require("jsdom");
const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const P = require(path.join(ROOT, "fantasy-kit/pools-core.js"));
const SHEET = JSON.parse(src("tests/fixtures/props-sheet.json"));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const KICK = "2027-02-14T23:30:00Z";
function board(o) {
  o = o || {};
  return { ok: true, lock: KICK, pool: { id: "PROP27", name: "Party", kind: "props", season: 2026, owner: true, extra: { props: SHEET, answers: o.answers || {} } },
    games: [{ id: "sb", round: 4, kickoff: KICK, a: "KC", b: "PHI", final: !!o.final, ap: o.final ? 27 : null, bp: o.final ? 24 : null }],
    field: [{ team: "KC", conf: "AFC" }, { team: "PHI", conf: "NFC" }],
    members: [{ id: "me", name: "David", me: true }, { id: "u2", name: "Mike" }], picks: o.picks || [] };
}

test("the standard sheet: 19 questions, the winner worth 2, every question with 2 to 6 choices", () => {
  assert.equal(SHEET.length, 19);
  assert.equal(SHEET.find((q) => q.id === "winner").pts, 2);
  SHEET.forEach((q) => { assert.ok(q.opts.length >= 2 && q.opts.length <= 6, q.id); assert.ok(/^[a-z0-9]{1,16}$/.test(q.id)); });
});

test("winner, total and margin grade themselves from the final; marked answers count; the total breaks ties", () => {
  const picks = [
    { user: "me", slot: "p:winner", team: "0" }, { user: "me", slot: "p:total", team: "0" }, { user: "me", slot: "p:margin", team: "0" }, { user: "me", slot: "p:toss", team: "0" }, { user: "me", slot: "tb", team: "50" },
    { user: "u2", slot: "p:winner", team: "1" }, { user: "u2", slot: "p:total", team: "1" }, { user: "u2", slot: "p:toss", team: "0" }, { user: "u2", slot: "tb", team: "40" }];
  const B = P.props(board({ final: true, picks, answers: { toss: 0 } }), Date.parse("2027-02-15T12:00:00Z"));
  // KC 27, PHI 24: the AFC wins (2), 51 is over 47.5, a 3-point margin is "1 to 3", heads is marked
  assert.equal(B.answers.winner, 0); assert.equal(B.answers.total, 0); assert.equal(B.answers.margin, 0);
  const me = B.rows.find((r) => r.me), mike = B.rows.find((r) => r.id === "u2");
  assert.equal(me.points, 2 + 1 + 1 + 1); assert.equal(mike.points, 1);
  assert.equal(B.rows[0].id, "me");
  assert.equal(B.total, 51);
  assert.equal(B.graded, 4, "the rest wait for the owner");
  assert.equal(me.max, me.points, "his unanswered questions have no picks, so nothing more to win");
});

test("status: an unfinished sheet is due at kickoff; after kickoff it's the standings", () => {
  const before = P.status(board({ picks: [{ user: "me", slot: "p:toss", team: "1" }] }), Date.parse("2027-02-10T12:00:00Z"));
  assert.equal(before.tone, "todo"); assert.equal(before.due, Date.parse(KICK)); assert.match(before.text, /1 of 19 answered/);
  const after = P.status(board({ picks: [{ user: "me", slot: "p:toss", team: "0" }], answers: { toss: 0 } }), Date.parse("2027-02-15T01:00:00Z"));
  assert.equal(after.tone, "ok"); assert.match(after.text, /1 of 19 graded/);
});

async function boot(now, o) {
  const dom = new JSDOM('<!doctype html><body><main><div id="app"></div></main></body>', { url: "https://davidsolar.dev/fantasy/pools/?p=PROP27", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, RealDate = w.Date, off = now - RealDate.now();
  w.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } };
  w.scrollTo = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = async () => ({ ok: true, json: async () => ({}) });
  const errs = []; w.addEventListener("error", (e) => errs.push(e.message));
  const B = board(o), calls = [];
  w.FK = { cloud: { user: () => ({ id: "me", email: "d@x.com" }), lastEmail: () => "", fromLink: async () => null, map: {}, NFL: { KC: ["KC", "Chiefs"], PHI: ["PHI", "Eagles"] }, nflPost: async () => ({}),
    rpc: async (fn, a) => { calls.push([fn, a]); if (fn === "mm_board") return JSON.parse(JSON.stringify(B));
      if (fn === "mm_save_props") { B.picks = Object.entries(a.p_picks).map(([q, k]) => ({ user: "me", slot: "p:" + q, team: k })); return { ok: true, saved: Object.keys(a.p_picks).length }; }
      if (fn === "mm_pool_extra") { if (a.p_set.answers) B.pool.extra.answers = Object.assign({}, B.pool.extra.answers, a.p_set.answers); return { ok: true }; }
      if (fn === "mm_remind_get") return { remind: true }; return []; } } };
  w.eval(src("fantasy-kit/nav.js")); w.eval(src("fantasy-kit/pools-core.js")); w.eval(src("fantasy-kit/wins-core.js")); w.eval(src("fantasy-kit/pools.js"));
  for (let i = 0; i < 100 && !w.document.querySelector(".pl-props, .pl-note"); i++) await pause(20);
  return { w, errs, calls, app: w.document.getElementById("app") };
}

test("the page: team names fill in, pick and save; after kickoff the owner marks an answer on the Answers tab", async () => {
  const a = await boot(Date.parse("2027-02-01T15:00:00Z"));
  try {
    assert.match(a.app.textContent, /Super Bowl, Feb 14/);
    assert.match(a.app.querySelector('[data-pp="winner|0"]').textContent, /Chiefs/);
    a.app.querySelector('[data-pp="toss|1"]').click(); await pause(20);
    a.app.querySelector('[data-pp="winner|1"]').click(); await pause(20);
    a.app.querySelector("[data-ppsave]").click(); await pause(60);
    const save = a.calls.find((c) => c[0] === "mm_save_props")[1];
    assert.equal(JSON.stringify(save.p_picks), JSON.stringify({ toss: "1", winner: "1" }));
    assert.match(a.app.textContent, /Saved: 2 answered\./);
    assert.deepEqual(a.errs, []);
  } finally { a.w.close(); }
  const b = await boot(Date.parse("2027-02-15T15:00:00Z"), { final: true, picks: [{ user: "me", slot: "p:toss", team: "0" }, { user: "u2", slot: "p:toss", team: "1" }] });
  try {
    b.app.querySelector('[data-tab="games"]').click(); await pause(30);
    assert.match(b.app.textContent, /Coin toss/); assert.match(b.app.textContent, /50%/);
    b.app.querySelector('[data-ppans="toss|0"]').click(); await pause(60);
    assert.equal(JSON.stringify(b.calls.find((c) => c[0] === "mm_pool_extra")[1].p_set), JSON.stringify({ answers: { toss: 0 } }));
    assert.ok(b.app.querySelector('[data-ppans="toss|0"]').classList.contains("right"));
    assert.deepEqual(b.errs, []);
  } finally { b.w.close(); }
});
