// Oscars ballot: the rules (fantasy-kit/pools-core.js oscars) and the page (fantasy-kit/pools.js oscPicks, oscResults)
// on the season's ballot file (fantasy/pools/oscars-2027.json)
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { JSDOM } = require("jsdom");
const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const P = require(path.join(ROOT, "fantasy-kit/pools-core.js"));
const BAL = JSON.parse(src("fantasy/pools/oscars-2027.json"));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOW = "2027-03-14T23:00:00Z";
const real = () => Object.assign(JSON.parse(JSON.stringify(BAL)), { projected: false });
function board(o) {
  o = o || {};
  return { ok: true, lock: SHOW, ballot: o.ballot || real(), pool: { id: "OSC27", name: "Oscar night", kind: "oscars", season: 2027, owner: o.owner !== false, extra: Object.assign({ answers: o.answers || {} }, o.extra || {}) },
    games: [], field: [], members: [{ id: "me", name: "David", me: true }, { id: "u2", name: "Mike" }], picks: o.picks || [] };
}

test("the ballot file: 24 categories, ids the database accepts, Best Picture worth 5, no repeated nominee in a category", () => {
  assert.equal(BAL.cats.length, 24);
  assert.equal(BAL.cats.find((c) => c.id === "pic").pts, 5);
  assert.equal(BAL.cats.find((c) => c.id === "pic").noms.length, 10);
  BAL.cats.forEach((c) => {
    assert.ok(/^[a-z0-9]{1,16}$/.test(c.id), c.id);
    const ids = c.noms.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, c.id);
    ids.forEach((i) => assert.ok(/^[a-z0-9-]{1,40}$/.test(i), i));
    if (c.noms.length && c.id !== "pic") assert.equal(c.noms.length, 5, c.id);
  });
  assert.equal(Date.parse(BAL.start), Date.parse(SHOW));
});

test("a right pick scores its category's points; the owner's marks beat the file; the show's length breaks ties", () => {
  const B0 = real(); B0.cats.find((c) => c.id === "actor").win = "andrew-scott";
  const picks = [
    { user: "me", slot: "p:pic", team: "odyssey" }, { user: "me", slot: "p:actor", team: "andrew-scott" }, { user: "me", slot: "tb", team: "200" },
    { user: "u2", slot: "p:pic", team: "odyssey" }, { user: "u2", slot: "p:actor", team: "andrew-scott" }, { user: "u2", slot: "tb", team: "240" }];
  const O = P.oscars(board({ ballot: B0, picks, answers: { pic: "odyssey" }, extra: { tbAnswer: 230 } }), Date.parse("2027-03-15T06:00:00Z"));
  const me = O.rows.find((r) => r.me), mike = O.rows.find((r) => r.id === "u2");
  assert.equal(me.points, 8); assert.equal(mike.points, 8);
  assert.equal(O.rows[0].id, "u2", "240 is closer to 230 than 200");
  assert.equal(O.graded, 2); assert.equal(O.runtime, 230); assert.equal(O.done, false);
  const O2 = P.oscars(board({ ballot: B0, picks, answers: { actor: "john-malkovich" } }), Date.now());
  assert.equal(O2.rows.find((r) => r.me).points, 0, "the owner's mark wins over the file");
});

test("a pick on someone who wasn't nominated doesn't count", () => {
  const O = P.oscars(board({ picks: [{ user: "me", slot: "p:pic", team: "the-room" }, { user: "me", slot: "p:dir", team: "christopher-nolan" }], answers: { pic: "the-room" } }), Date.now());
  const me = O.rows.find((r) => r.me);
  assert.equal(me.picked, 1); assert.equal(me.points, 0);
});

test("status: practice before the nominations, due at the show after, the standings once it starts", () => {
  const prac = P.status(board({ ballot: BAL, picks: [{ user: "me", slot: "p:pic", team: "odyssey" }] }), Date.parse("2026-12-01T12:00:00Z"));
  assert.equal(prac.tone, "wait"); assert.match(prac.text, /Practice ballot: 1 of 21/);
  const due = P.status(board({ picks: [{ user: "me", slot: "p:pic", team: "odyssey" }] }), Date.parse("2027-03-01T12:00:00Z"));
  assert.equal(due.tone, "todo"); assert.equal(due.due, Date.parse(SHOW)); assert.match(due.text, /1 of 21 picked/);
  const live = P.status(board({ picks: [{ user: "me", slot: "p:pic", team: "odyssey" }], answers: { pic: "odyssey" } }), Date.parse("2027-03-15T00:00:00Z"));
  assert.equal(live.tone, "ok"); assert.match(live.text, /1 of 21 announced/);
  // the reminder job has no ballot file: it goes by the date and counts the picks it can see
  const job = board({ picks: [] }); delete job.ballot;
  assert.equal(P.status(job, Date.parse("2026-12-01T12:00:00Z")).tone, "wait");
  const j2 = P.status(job, Date.parse("2027-03-14T20:00:00Z"));
  assert.equal(j2.tone, "todo"); assert.equal(j2.due, Date.parse(SHOW));
});

async function boot(now, o) {
  const dom = new JSDOM('<!doctype html><body><main><div id="app"></div></main></body>', { url: "https://davidsolar.dev/fantasy/pools/?p=OSC27", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, RealDate = w.Date, off = now - RealDate.now();
  w.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } };
  w.scrollTo = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const ballot = (o && o.ballot) || real();
  w.fetch = async (u) => ({ ok: true, json: async () => (/oscars-2027\.json/.test(u) ? JSON.parse(JSON.stringify(ballot)) : {}) });
  const errs = []; w.addEventListener("error", (e) => errs.push(e.message));
  const B = board(o); delete B.ballot; const calls = [];
  w.FK = { cloud: { user: () => ({ id: "me", email: "d@x.com" }), lastEmail: () => "", fromLink: async () => null, map: {}, NFL: {}, nflPost: async () => ({}),
    rpc: async (fn, a) => { calls.push([fn, a]); if (fn === "mm_board") return JSON.parse(JSON.stringify(B));
      if (fn === "mm_save_props") { B.picks = Object.entries(a.p_picks).map(([q, k]) => ({ user: "me", slot: "p:" + q, team: k })); return { ok: true, saved: Object.keys(a.p_picks).length }; }
      if (fn === "mm_pool_extra") { if (a.p_set.answers) B.pool.extra.answers = Object.assign({}, B.pool.extra.answers, a.p_set.answers); return { ok: true }; }
      if (fn === "mm_remind_get") return { remind: true }; return []; } } };
  w.eval(src("fantasy-kit/nav.js")); w.eval(src("fantasy-kit/pools-core.js")); w.eval(src("fantasy-kit/wins-core.js")); w.eval(src("fantasy-kit/pools.js"));
  for (let i = 0; i < 100 && !w.document.querySelector(".pl-ocs, .pl-note"); i++) await pause(20);
  return { w, d: w.document, errs, calls, B };
}
const click = async (w, el) => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await pause(60); };

test("page: pick, fill the rest with the favorites, save only nominated picks", async () => {
  const { w, d, errs, calls } = await boot(Date.parse("2027-02-01T12:00:00Z"), { picks: [{ user: "me", slot: "p:pic", team: "the-room" }] });
  assert.match(d.querySelector(".pl-note").textContent, /practice picks wasn't nominated/);
  assert.equal(d.querySelectorAll(".pl-oc").length, 21);
  await click(w, d.querySelector('[data-osc="dir|curry-barker"]'));
  assert.equal(d.querySelector('[data-osc="dir|curry-barker"]').getAttribute("aria-pressed"), "true");
  await click(w, d.querySelector("[data-oscfav]"));
  await click(w, d.querySelector("[data-oscsave]"));
  const save = calls.find((c) => c[0] === "mm_save_props")[1];
  assert.equal(Object.keys(save.p_picks).length, 21);
  assert.equal(save.p_picks.dir, "curry-barker", "a pick already made stays");
  assert.equal(save.p_picks.pic, "odyssey", "the favorite replaces a pick that missed");
  assert.deepEqual(errs, []);
});

test("page: after the show starts the owner marks winners on the Winners tab", async () => {
  const { w, d, errs, calls } = await boot(Date.parse("2027-03-15T01:00:00Z"), { picks: [{ user: "me", slot: "p:pic", team: "odyssey" }, { user: "u2", slot: "p:pic", team: "artificial" }] });
  await click(w, d.querySelector('[data-tab="games"]'));
  const b = d.querySelector('[data-oscans="pic|odyssey"]');
  assert.match(b.textContent, /50%/); assert.match(b.textContent, /David/);
  await click(w, b); await pause(60);
  const ex = calls.find((c) => c[0] === "mm_pool_extra")[1];
  assert.deepEqual(JSON.parse(JSON.stringify(ex.p_set)), { answers: { pic: "odyssey" } });
  assert.ok(d.querySelector('[data-oscans="pic|odyssey"]').classList.contains("right"));
  assert.deepEqual(errs, []);
});
