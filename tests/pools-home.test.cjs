// The pools home page (fantasy-kit/pools.js home()): Up next by the calendar, every card naming its sport, squares
// out of "Playing now" until the playoffs, one list of your pools by what's due, and the catalog folded once you have some
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { JSDOM } = require("jsdom");
const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(now, signed, mine) {
  const dom = new JSDOM('<!doctype html><body><main><div id="app"></div></main></body>', { url: "https://davidsolar.dev/fantasy/pools/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, RealDate = w.Date, off = now - RealDate.now();
  w.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } };
  w.scrollTo = () => {}; w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = async () => ({ ok: true, json: async () => ({}) });
  const errs = []; w.addEventListener("error", (e) => errs.push(e.message));
  const soon = new RealDate(now + 864e5).toISOString();
  w.FK = { cloud: { user: () => (signed ? { id: "me", email: "d@x.com" } : null), lastEmail: () => "", fromLink: async () => null, map: {}, NFL: {}, nflPost: async () => ({}),
    signIn: async () => ({}), passwordSignIn: async () => ({}),
    rpc: async (fn) => fn === "mm_pools_mine" ? (mine || []) : fn === "pk_groups_mine" ? (signed ? [{ name: "Friday Picks", members: 9 }] : [])
      : fn === "pk_board" ? { week: 13, me: { w: 9, l: 7, p: 0 }, games: [{ kickoff: soon, spread: -3, locked: false, pick: null }] }
      : fn === "mm_board" ? { ok: false } : fn === "wn_mine" ? [] : [] } };
  w.eval(src("fantasy-kit/nav.js")); w.eval(src("fantasy-kit/sport-art.js")); w.eval(src("fantasy-kit/pools-core.js")); w.eval(src("fantasy-kit/wins-core.js")); w.eval(src("fantasy-kit/pools.js"));
  for (let i = 0; i < 100 && !w.document.querySelector(".pl-sports"); i++) await pause(20);
  return { w, errs, app: w.document.getElementById("app") };
}

test("signed out in late November: organized by sport, in-season sports first; Up next is the bowl pick'em; squares waits for the playoffs", async () => {
  const { w, errs, app } = await boot(Date.parse("2026-11-25T15:00:00Z"), false);
  try {
    const nx = app.querySelector(".pl-next");
    assert.ok(nx, "an Up next spot"); assert.match(nx.textContent, /Bowl pick'em/); assert.match(nx.textContent, /Dec 6/);
    assert.deepEqual([...app.querySelectorAll(".pl-sbar button")].map((b) => b.textContent.trim()), ["All sports", "NFL", "NBA", "NCAAF", "Oscars", "NCAAB"]);
    assert.deepEqual([...app.querySelectorAll(".pl-door")].map((d) => d.id), ["sp-nfl", "sp-nba", "sp-cfb", "sp-osc", "sp-cbb"], "what's in season first, then by what opens soonest");
    const nfl = app.querySelector("#sp-nfl").textContent;
    assert.match(nfl, /Super Bowl squares\s*Fill it now/, "squares says Fill it now, not Live now");
    assert.match(app.querySelector("#sp-cfb .pl-door-st").textContent, /Matchups Dec 6/);
    assert.ok(app.querySelector("#sp-nfl").classList.contains("wide"), "six NFL games run the full width");
    assert.deepEqual(errs, []);
  } finally { w.close(); }
});

test("signed in: one list by what's due, Up next skips a game you're already in, and a sport in the bar narrows everything", async () => {
  const mine = [{ id: "BOWL26", name: "Bowl Season", kind: "bowls", members: 5 }, { id: "S1", name: "Office survivor", kind: "nfl", members: 14 }];
  const { w, errs, app } = await boot(Date.parse("2026-11-25T15:00:00Z"), true, mine);
  try {
    const names = () => [...app.querySelectorAll(".pl-list li b")].map((b) => b.textContent);
    assert.equal(names()[0], "Friday Picks", "the pick'em group due tomorrow comes first: " + names().join(", "));
    assert.ok(!app.querySelector(".pl-next"), "no 'make a bowl pool' when he's in one");
    app.querySelector('.pl-sbar [data-sport="cfb"]').click(); await pause(60);
    assert.deepEqual(names(), ["Bowl Season"]);
    assert.deepEqual([...app.querySelectorAll(".pl-door")].map((d) => d.id), ["sp-cfb"]);
    assert.equal(w.location.hash, "#cfb");
    app.querySelector('.pl-sbar [data-sport=""]').click(); await pause(60);
    assert.equal(app.querySelectorAll(".pl-door").length, 5);
    assert.deepEqual(errs, []);
  } finally { w.close(); }
});
test("January: Up next moves to the NFL playoff bracket, and says the field is set once it is", async () => {
  const a = await boot(Date.parse("2027-01-05T15:00:00Z"), false);
  try { assert.match(a.app.querySelector(".pl-next").textContent, /NFL playoff bracket[\s\S]*Practice on the projected field/); } finally { a.w.close(); }
  const b = await boot(Date.parse("2027-01-12T15:00:00Z"), false);
  try { assert.match(b.app.querySelector(".pl-next").textContent, /The field is set\. Brackets lock/); } finally { b.w.close(); }
});
test("February: Up next is the bracket, or the Oscars ballot for someone already in a bracket pool; the Oscars filter shows the ballot", async () => {
  const a = await boot(Date.parse("2027-02-20T15:00:00Z"), false);
  try {
    assert.match(a.app.querySelector(".pl-next").textContent, /March Madness bracket/);
    a.app.querySelector('.pl-sbar [data-sport="osc"]').click(); await pause(60);
    assert.match(a.app.querySelector(".pl-next").textContent, /Oscars ballot/);
  } finally { a.w.close(); }
  const b = await boot(Date.parse("2027-02-20T15:00:00Z"), true, [{ id: "BR27", name: "Office bracket", kind: "bracket", members: 8 }]);
  try { assert.match(b.app.querySelector(".pl-next").textContent, /Oscars ballot/); } finally { b.w.close(); }
});
