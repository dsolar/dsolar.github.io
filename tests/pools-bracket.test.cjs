// March Madness bracket pool: the rules (fantasy-kit/pools-core.js mm*) and the page (fantasy-kit/pools.js bkPicks),
// on the college hub's projected 2027 field (tests/fixtures/mm-projected-2027.json: 12 Opening Round games, 32 first-round)
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { JSDOM } = require("jsdom");
const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const P = require(path.join(ROOT, "fantasy-kit/pools-core.js"));
const GAMES = JSON.parse(src("tests/fixtures/mm-projected-2027.json"));
const TEAMS = JSON.parse(src("cbb/data/teams.json")).teams;
const prob = (a, b) => P.winProb(TEAMS[a], TEAMS[b]);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const board = (picks, games) => ({ pool: { season: 2027 }, games: games || GAMES, members: [{ id: "me", name: "David", me: true }, { id: "u2", name: "Mike" }], picks: picks || [] });

test("the field: four regions, the Opening Round pairs share a slot, East meets Midwest and West meets South", () => {
  const F = P.mmField(board());
  assert.deepEqual(F.names, ["East", "West", "South", "Midwest"]);
  assert.ok(F.ready);
  assert.deepEqual(F.ff, [["East", "Midwest"], ["West", "South"]]);
  let pairs = 0;
  F.names.forEach((r) => F.regions[r].forEach((m) => m.forEach((side) => { assert.ok(side.length === 1 || side.length === 2); if (side.length === 2) pairs++; })));
  assert.equal(pairs, 12, "12 Opening Round games");
  assert.equal(P.mmSlots(F).length, 63);
});

test("filling in favorites picks all 63; an upset clears what depended on the loser", () => {
  const F = P.mmField(board());
  const picks = P.mmFill(F, {}, prob);
  assert.equal(Object.keys(picks).length, 63);
  const one = picks["b:East:1:0"], dog = F.regions.East[0][1][0];
  const after = P.mmPick(F, picks, "b:East:1:0", dog);
  assert.equal(after["b:East:1:0"], dog);
  assert.ok(!Object.values(after).includes(one), "the 1 seed is gone from every later round");
  assert.ok(Object.keys(after).length < 63);
});

test("scoring: 10-20-40-80-160-320 by round, max drops when a pick is out, and the title total breaks ties", () => {
  const F = P.mmField(board());
  const mine = P.mmFill(F, {}, prob);
  const games = GAMES.map((g) => Object.assign({}, g));
  // the East 1-16 game: the favorite wins; the 8-9 game: an upset of my pick
  const g1 = games.find((g) => g.round === 1 && g.region === "East" && g.as === 1); g1.final = true; g1.w = mine["b:East:1:0"]; g1.ap = 80; g1.bp = 60;
  const g2 = games.find((g) => g.round === 1 && g.region === "East" && g.as === 8); g2.final = true; g2.w = mine["b:East:1:1"] === g2.a ? g2.b : g2.a; g2.ap = 70; g2.bp = 71;
  const picks = Object.entries(mine).map(([slot, team]) => ({ user: "me", slot, team }));
  const B = P.mmBracket(board(picks, games), Date.parse("2027-03-19T12:00:00Z"));
  const me = B.rows.find((r) => r.me);
  assert.equal(me.points, 10);
  // max: everything still possible, which leaves out every pick of the team that lost
  const lostTeam = mine["b:East:1:1"], rnd = (s) => (s === "b:ch" ? 6 : s.startsWith("b:ff") ? 5 : +s.split(":")[2]);
  const gone = Object.entries(mine).filter(([, t]) => t === lostTeam).reduce((x, [s]) => x + P.MM_PTS[rnd(s)], 0);
  const full = 32 * 10 + 16 * 20 + 8 * 40 + 4 * 80 + 2 * 160 + 320;
  assert.equal(me.max, full - gone, "max: " + me.max);
  assert.equal(B.n, 63);
});

async function boot(now) {
  const dom = new JSDOM('<!doctype html><body><main><div id="app"></div></main></body>', { url: "https://davidsolar.dev/fantasy/pools/?p=MM27", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, RealDate = w.Date, off = now - RealDate.now();
  w.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } };
  w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {}; w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = async (u) => ({ ok: true, json: async () => (/teams\.json/.test(String(u)) ? { teams: TEAMS } : {}) });
  const errs = []; w.addEventListener("error", (e) => errs.push(e.message));
  const B = { ok: true, fiveLock: GAMES.find((g) => g.round === 1).tip, projected: true, pool: { id: "MM27", name: "Office Madness", kind: "bracket", season: 2027, owner: true, extra: {} },
    games: GAMES, members: [{ id: "me", name: "David", me: true }, { id: "u2", name: "Mike" }], picks: [] };
  const saved = [];
  w.FK = { cloud: { user: () => ({ id: "me", email: "d@x.com" }), lastEmail: () => "", fromLink: async () => null, map: {}, NFL: {}, nflPost: async () => ({}),
    rpc: async (fn, a) => { if (fn === "mm_board") return JSON.parse(JSON.stringify(B)); if (fn === "mm_remind_get") return { remind: true }; if (fn === "mm_save_bracket") { saved.push(a); B.picks = Object.entries(a.p_picks).map(([slot, team]) => ({ user: "me", slot, team })); return { ok: true, saved: Object.keys(a.p_picks).length }; } return []; } } };
  w.eval(src("fantasy-kit/nav.js")); w.eval(src("fantasy-kit/pools-core.js")); w.eval(src("fantasy-kit/wins-core.js")); w.eval(src("fantasy-kit/pools.js"));
  for (let i = 0; i < 100 && !w.document.querySelector(".pl-bkreg"); i++) await pause(20);
  return { w, errs, saved, app: w.document.getElementById("app") };
}

test("the page: a practice note, pick a game, fill the rest, see the Final Four, and save all 63", async () => {
  const { w, errs, saved, app } = await boot(Date.parse("2027-02-20T15:00:00Z"));
  try {
    assert.match(app.textContent, /Practice bracket\. This is the college hub's projected field: each conference's favorite takes its automatic bid/);
    assert.equal(app.querySelectorAll(".pl-bkreg .pl-bkm").length, 15, "a region's 15 games");
    assert.match(app.textContent, /Tap a team to pick it\./);
    app.querySelector('[data-bk^="b:East:1:0|"]').click(); await pause(20);
    assert.match(app.textContent, /1 of 63 picked/);
    app.querySelector("[data-bkfill]").click(); await pause(20);
    assert.match(app.textContent, /63 of 63 picked/); assert.match(app.textContent, /wins it all/);
    app.querySelector('[data-bkreg="ff"]').click(); await pause(20);
    assert.match(app.textContent, /East vs Midwest/); assert.match(app.textContent, /Title game/);
    app.querySelector("[data-bksave]").click(); await pause(60);
    assert.equal(Object.keys(saved[0].p_picks).length, 63);
    assert.match(app.textContent, /Saved: 63 of 63 picked\./);
    assert.deepEqual(errs, []);
  } finally { w.close(); }
});
