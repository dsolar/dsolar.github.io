// The bowl pick'em's pool page (fantasy-kit/pools.js) against a stand-in server: the standings tab draws (it crashed
// on a field from the 5 teams pool), and friends' hidden picks don't read as missing
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { JSDOM } = require("jsdom");
const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function board(now) {
  const games = [];
  for (let i = 0; i < 6; i++) games.push({ id: "g" + i, round: i === 5 ? 4 : 0, label: "Bowl " + i, kickoff: new Date(Date.parse("2026-12-20T18:00:00Z") + i * 864e5).toISOString(),
    a: i === 5 ? null : "A" + i, b: i === 5 ? null : "B" + i, ap: null, bp: null, w: null, final: false });
  games.slice(0, 3).forEach((g) => { if (Date.parse(g.kickoff) + 4 * 3600e3 < now) { g.final = true; g.ap = 21; g.bp = 14; g.w = g.a; } });
  const members = [{ id: "me", name: "David", me: true }, { id: "u2", name: "Mike" }];
  const picks = [];
  games.forEach((g, i) => { if (!g.a) return; picks.push({ user: "me", slot: "g" + g.id, team: g.a, pts: 6 - i }); if (Date.parse(g.kickoff) <= now) picks.push({ user: "u2", slot: "g" + g.id, team: g.b, pts: i + 1 }); });
  return { ok: true, lock: games[5].kickoff, pool: { id: "BOWL26", name: "Bowl test", kind: "bowls", season: 2026, owner: true, extra: {} }, games, members, picks };
}
async function boot(now, tab, noMine) {
  const dom = new JSDOM('<!doctype html><body><main><div id="app"></div></main></body>', { url: "https://davidsolar.dev/fantasy/pools/?p=BOWL26", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, RealDate = w.Date, off = now - RealDate.now();
  w.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } };
  w.scrollTo = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = async () => ({ ok: true, json: async () => ({}) });
  const errs = []; w.addEventListener("error", (e) => errs.push(e.message)); w.addEventListener("unhandledrejection", (e) => errs.push(String(e.reason && e.reason.message)));
  w.FK = { cloud: { user: () => ({ id: "me", email: "d@x.com" }), lastEmail: () => "", fromLink: async () => null, map: {}, NFL: {}, nflPost: async () => ({}),
    rpc: async (fn) => (fn === "mm_board" ? (noMine ? Object.assign(board(now), { picks: board(now).picks.filter((k) => k.user !== "me") }) : board(now)) : fn === "mm_remind_get" ? { remind: false, recap: false } : []) } };
  w.eval(src("fantasy-kit/nav.js"));
  w.FK.cloud = Object.assign(w.FK.cloud, {});
  w.eval(src("fantasy-kit/pools-core.js")); w.eval(src("fantasy-kit/wins-core.js")); w.eval(src("fantasy-kit/pools.js"));
  for (let i = 0; i < 100 && !w.document.querySelector("[data-tab]"); i++) await pause(20);
  if (tab) { w.document.querySelector(`[data-tab="${tab}"]`).click(); await pause(50); }
  return { w, errs };
}

test("bowl standings draw mid-season, and a friend's hidden picks don't read as missing", async () => {
  const { w, errs } = await boot(Date.parse("2026-12-23T12:00:00Z"), "standings");
  try {
    const t = w.document.getElementById("app").textContent;
    assert.deepEqual(errs, []);
    assert.match(t, /David/); assert.match(t, /Mike/);
    assert.ok(!/of 5 picked/.test(t), "no line from the 5 teams pool");
    const row = [...w.document.querySelectorAll(".pl-st tbody tr")].find((r) => /Mike/.test(r.textContent)), mike = row.textContent, cells = [...row.cells].map((c) => c.textContent.trim());
    assert.ok(!/of \d+ picked/.test(mike), "his later picks are hidden, not missing: " + mike);
    // Max for him: his points plus every number he hasn't played yet (1..6 minus the 1, 2, 3 already played)
    assert.equal(cells[4], "15", "his max counts the numbers still to play: " + cells.join(" | "));
  } finally { w.close(); }
});

test("the pool page loads before the matchups are set", async () => {
  const { w, errs } = await boot(Date.parse("2026-11-25T12:00:00Z"));
  try {
    assert.deepEqual(errs, []);
    assert.ok(w.document.getElementById("app").textContent.length > 0);
  } finally { w.close(); }
});

test("a tap picks and numbers only that game; the favorites button fills the rest; a hand-set number stays put", async () => {
  const { w, errs } = await boot(Date.parse("2026-12-10T12:00:00Z"), null, true);
  try {
    const app = w.document.getElementById("app");
    const nums = () => [...app.querySelectorAll("select[data-bpts]")].map((s) => s.value);
    assert.match(app.textContent, /Tap a team to pick it\./, "no 'Saved.' before any pick");
    app.querySelector('[data-bteam="g1|A1"]').click(); await pause(20);
    assert.deepEqual(nums().filter(Boolean).length, 1, "only the picked game gets a number");
    // set one by hand, then let the favorites fill the rest: the hand-set number survives
    const sel = app.querySelector('select[data-bpts="g1"]'); sel.value = "2"; sel.dispatchEvent(new w.Event("change", { bubbles: true })); await pause(20);
    app.querySelector("[data-bfav]") && app.querySelector("[data-bfav]").click(); await pause(20);
    assert.equal(app.querySelector('select[data-bpts="g1"]').value, "2");
    assert.deepEqual(errs, []);
  } finally { w.close(); }
});

test("played games fold into one line and the list starts at the next open game", async () => {
  const { w, errs } = await boot(Date.parse("2026-12-23T12:00:00Z"));
  try {
    const app = w.document.getElementById("app"), fold = app.querySelector(".pl-bdone");
    assert.ok(fold && !fold.open, "folded");
    assert.match(fold.querySelector("summary").textContent, /3 games played/);
    assert.match(fold.querySelector("summary").textContent, /3-0, 15 points/);
    assert.match(app.textContent, /1st of 2/);
    assert.match(app.textContent, /playoff game fills in as teams advance/);
    assert.deepEqual(errs, []);
  } finally { w.close(); }
});

test("reminders: no pick at all means one before the first bowl, then none; a kickoff ESPN hasn't timed reads 'time TBA'", async () => {
  const { w } = await boot(Date.parse("2026-12-10T12:00:00Z"));
  try {
    const P = w.FK.pools, b = board(Date.parse("2026-12-23T12:00:00Z"));
    b.picks = b.picks.filter((k) => k.user !== "me");
    const before = P.status(Object.assign({}, b, { picks: [] }), Date.parse("2026-12-10T12:00:00Z"), "me");
    assert.ok(before.due, "one before the season starts");
    const after = P.status(b, Date.parse("2026-12-23T12:00:00Z"), "me");
    assert.equal(after.tone, "todo"); assert.equal(after.due, null, "no more once games are under way and he hasn't picked");
    const mine = board(Date.parse("2026-12-23T12:00:00Z"));
    mine.games[4].a = "A4"; mine.games[4].b = "B4"; mine.picks = mine.picks.filter((k) => k.slot !== "gg4");
    assert.ok(P.status(mine, Date.parse("2026-12-23T12:00:00Z"), "me").due, "someone who's picking still gets them");
  } finally { w.close(); }
  assert.ok(/time TBA/.test(src("fantasy-kit/pools.js")));
});
