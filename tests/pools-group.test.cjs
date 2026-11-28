// A pool's group, game after game (fantasy-kit/pools.js nextGameCard, groupStrip, invitesHtml): the owner starts the
// next game for everyone, members see the invite on the Pools page and the pool page, and join with a tap.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { JSDOM, VirtualConsole } = require("jsdom");
const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(url, game, opts = {}) {
  const vc = new VirtualConsole(); // jsdom can't follow a page change: note it instead
  const nav = []; vc.on("jsdomError", (e) => { if (/navigation/i.test(e.message)) nav.push(e.message); });
  const dom = new JSDOM(`<!doctype html><html lang="en"${game ? ` data-game="${game}"` : ""}><body><main><div id="app"></div></main></body></html>`, { url, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {}; w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = async () => ({ ok: true, json: async () => ({}) });
  const errs = []; w.addEventListener("error", (e) => errs.push(e.message));
  const calls = [];
  const B = Object.assign({ ok: true, lock: "2026-12-12T17:00:00Z", pool: { id: "BOWL26", name: "Bowl Buddies", kind: "bowls", season: 2026, owner: true, extra: {} },
    games: [], members: [{ id: "me", name: "David", me: true, owner: true }, { id: "u2", name: "Mike" }, { id: "u3", name: "Sam" }], picks: [], log: [], links: [] }, opts.board || {});
  w.FK = { cloud: { user: () => ({ id: "me", email: "d@x.com" }), lastEmail: () => "", fromLink: async () => null, map: {}, NFL: {}, nflPost: async () => ({}),
    rpc: async (fn, a) => {
      calls.push([fn, JSON.parse(JSON.stringify(a || {}))]);
      if (fn === "mm_board") return JSON.parse(JSON.stringify(B));
      if (fn === "mm_remind_get") return { remind: false };
      if (fn === "mm_pools_mine") return opts.mine || [];
      if (fn === "mm_invites_mine") return opts.invites || [];
      if (fn === "mm_pool_spawn") return opts.spawn || { ok: true, id: "CFP26", kind: a.p_kind, name: a.p_name, invited: 2 };
      if (fn === "mm_invite_answer") return a.p_yes ? { ok: true, id: a.p_pool } : { ok: true };
      return [];
    } } };
  w.eval(src("fantasy-kit/nav.js")); w.eval(src("fantasy-kit/pools-core.js")); w.eval(src("fantasy-kit/wins-core.js")); w.eval(src("fantasy-kit/pools.js"));
  for (let i = 0; i < 100 && !w.document.querySelector(".pl-tabs, .pl-yours"); i++) await pause(20);
  return { w, errs, calls, nav, app: w.document.getElementById("app") };
}
const button = (app, text) => [...app.querySelectorAll("button")].find((b) => b.textContent.trim() === text);

test("the owner starts the next game: the card offers the season's other games and says who gets invited", async () => {
  const { w, errs, calls, nav, app } = await boot("https://davidsolar.dev/pools/bowls/?p=BOWL26", "bowls");
  try {
    button(app, "Settings").click(); await pause(30);
    const card = app.querySelector(".pl-next");
    assert.ok(card, "the next-game card");
    assert.match(card.textContent, /All 2 other members get an invite/);
    const kinds = [...card.querySelectorAll("select[name=kind] option")].map((o) => o.value);
    assert.ok(kinds.includes("cfpo") && kinds.includes("nflpo"), kinds.join());
    assert.ok(!kinds.includes("bowls"), "not the game it already is");
    card.querySelector("select[name=kind]").value = "cfpo";
    card.querySelector("form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); await pause(40);
    const sp = calls.find((c) => c[0] === "mm_pool_spawn");
    assert.deepEqual(sp[1], { p_from: "BOWL26", p_kind: "cfpo", p_name: "Bowl Buddies" });
    assert.match(w.sessionStorage.getItem("pl-flash"), /2 people from Bowl Buddies got an invite/);
    assert.equal(nav.length, 1, "moves to the new pool");
    assert.deepEqual(errs, []);
  } finally { w.close(); }
});

test("a member's pool page shows the group's other games: open the one you're in, join the one you're invited to", async () => {
  const board = { pool: { id: "BOWL26", name: "Bowl Buddies", kind: "bowls", season: 2026, owner: false, extra: { next: ["CFP26", "NFL26"] } },
    members: [{ id: "u1", name: "David", owner: true }, { id: "me", name: "Mike", me: true }],
    links: [{ id: "CFP26", kind: "cfpo", name: "Bowl Buddies", rel: "next", in: false, invited: true, members: 1 }, { id: "NFL26", kind: "nflpo", name: "Bowl Buddies", rel: "next", in: true, invited: false, members: 3 }] };
  const { w, errs, calls, nav, app } = await boot("https://davidsolar.dev/pools/bowls/?p=BOWL26", "bowls", { board });
  try {
    const strip = app.querySelector(".pl-group");
    assert.ok(strip); assert.match(strip.textContent, /College Football Playoff bracket/); assert.match(strip.textContent, /NFL playoff bracket/);
    assert.equal(strip.querySelectorAll("[data-inv]").length, 1, "one Join, for the invite");
    assert.ok(strip.querySelector('a[href="/pools/nfl-bracket/?p=NFL26"]'));
    strip.querySelector("[data-inv]").click(); await pause(40);
    assert.deepEqual(calls.find((c) => c[0] === "mm_invite_answer")[1], { p_pool: "CFP26", p_yes: true });
    assert.equal(nav.length, 1);
    assert.equal(app.querySelector(".pl-next"), null, "only the owner gets the next-game card");
    assert.deepEqual(errs, []);
  } finally { w.close(); }
});

test("the Pools page lists invites first, and No thanks clears one", async () => {
  const invites = [{ id: "CFP26", name: "Bowl Buddies", kind: "cfpo", season: 2026, from: "BOWL26", fromName: "Bowl Buddies", by: "David", members: 1 }];
  const { w, errs, calls, app } = await boot("https://davidsolar.dev/pools/", null, { invites });
  try {
    const inv = app.querySelector(".pl-invs");
    assert.ok(inv); assert.match(inv.textContent, /You're invited/); assert.match(inv.textContent, /David started it for Bowl Buddies/);
    button(inv, "No thanks").click(); await pause(40);
    assert.deepEqual(calls.find((c) => c[0] === "mm_invite_answer")[1], { p_pool: "CFP26", p_yes: false });
    assert.deepEqual(errs, []);
  } finally { w.close(); }
});
