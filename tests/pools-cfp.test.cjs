// College Football Playoff bracket pool: the page (fantasy-kit/pools.js cfpPicksView, cfpTable, the games view) on the
// college hub's own data (cfb/data/extras.json season_sim.projected for the field, hub.json for names)
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { JSDOM } = require("jsdom");
const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const EXTRAS = JSON.parse(src("cfb/data/extras.json")), HUB = JSON.parse(src("cfb/data/hub.json"));
const SEEDS = EXTRAS.season_sim.projected.seeds;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCK = "2026-12-19T01:00:00Z";
const pgames = () => [
  { id: "g1", round: 1, kickoff: LOCK, a: SEEDS[8], b: SEEDS[7] }, { id: "g2", round: 1, kickoff: "2026-12-19T17:00:00Z", a: SEEDS[11], b: SEEDS[4] },
  { id: "g3", round: 1, kickoff: "2026-12-19T21:00:00Z", a: SEEDS[9], b: SEEDS[6] }, { id: "g4", round: 1, kickoff: "2026-12-20T01:00:00Z", a: SEEDS[10], b: SEEDS[5] },
  { id: "b1", round: 0, kickoff: "2026-12-13T17:00:00Z", a: "1", b: "2" },
];

async function boot(now, opts = {}) {
  const dom = new JSDOM('<!doctype html><html lang="en" data-game="cfpo"><body><main><div id="app"></div></main></body></html>', { url: "https://davidsolar.dev/pools/cfp-bracket/?p=CFP26", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, RealDate = w.Date, off = now - RealDate.now();
  w.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } };
  w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {}; w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = async (u) => ({ ok: true, json: async () => (/extras\.json/.test(String(u)) ? EXTRAS : /cfb\/data\/hub\.json/.test(String(u)) ? HUB : /teams\.json/.test(String(u)) ? { teams: {} } : {}) });
  const errs = []; w.addEventListener("error", (e) => errs.push(e.message));
  const B = { ok: true, lock: LOCK, pool: { id: "CFP26", name: "Playoff Pals", kind: "cfpo", season: 2026, owner: true, extra: {} },
    games: opts.games || pgames(), members: [{ id: "me", name: "David", me: true }, { id: "u2", name: "Mike" }], picks: opts.picks || [] };
  const saved = [];
  w.FK = { cloud: { user: () => ({ id: "me", email: "d@x.com" }), lastEmail: () => "", fromLink: async () => null, map: {}, NFL: {}, nflPost: async () => ({}),
    rpc: async (fn, a) => {
      if (fn === "mm_board") return JSON.parse(JSON.stringify(B));
      if (fn === "mm_remind_get") return { remind: false };
      if (fn === "mm_save_cfpo") { saved.push(a); B.picks = Object.entries(a.p_picks).map(([slot, team]) => ({ user: "me", slot, team })).concat(a.p_tb != null ? [{ user: "me", slot: "tb", team: String(a.p_tb) }] : []); return { ok: true }; }
      return {};
    } } };
  w.eval(src("fantasy-kit/nav.js")); w.eval(src("fantasy-kit/pools-core.js")); w.eval(src("fantasy-kit/wins-core.js")); w.eval(src("fantasy-kit/pools.js"));
  for (let i = 0; i < 100 && !w.document.querySelector(".pl-kconf, .pl-st"); i++) await pause(20);
  return { w, errs, saved, app: w.document.getElementById("app") };
}
const tab = async (app, name) => { const b = [...app.querySelectorAll("button, a")].find((x) => x.textContent.trim() === name); assert.ok(b, "a " + name + " tab"); b.click(); await pause(30); };

test("picking: a practice note, the byes wait on first-round winners, picks flow through, saving sends 11 picks and the tiebreak", async () => {
  const { w, errs, saved, app } = await boot(Date.parse("2026-11-29T15:00:00Z"));
  try {
    if (!app.querySelector(".pl-kconf")) await tab(app, "Picks");
    assert.match(app.textContent, /Practice bracket\./);
    assert.equal(app.querySelectorAll(".pl-kconf").length, 2);
    assert.match(app.textContent, /Winner 8\/9/);
    const short = (sd) => HUB.teams.find((t) => t.id === SEEDS[sd - 1]).short;
    assert.ok(app.textContent.includes(short(1)) && app.textContent.includes(short(12)), "seeds 1 and 12 show by name");
    // pick the higher seed everywhere, round by round
    const slots = ["r1", "r2", "r3", "r4", "q1", "q2", "q3", "q4", "s1", "s2", "ch"];
    for (const s of slots) {
      const opts = [...app.querySelectorAll(`[data-kb^="${s}|"]`)];
      assert.equal(opts.length, 2, s + " has two teams");
      const best = opts.sort((x, y) => SEEDS.indexOf(x.dataset.kb.split("|")[1]) - SEEDS.indexOf(y.dataset.kb.split("|")[1]))[0];
      best.click(); await pause(10);
    }
    assert.match(app.textContent, /11 of 11 picked/);
    const tb = app.querySelector("[data-ktb]"); tb.value = "51"; tb.dispatchEvent(new w.Event("input", { bubbles: true }));
    app.querySelector("[data-ksave]").click(); await pause(60);
    assert.equal(saved.length, 1);
    assert.equal(Object.keys(saved[0].p_picks).length, 11);
    assert.equal(saved[0].p_picks.ch, SEEDS[0]); assert.equal(saved[0].p_picks.q1, SEEDS[0]); assert.equal(saved[0].p_picks.r1, SEEDS[7]);
    assert.equal(saved[0].p_tb, 51);
    assert.deepEqual(errs, []);
  } finally { w.close(); }
});

test("after the lock: everyone's champion shows in the standings and the games view lists the first round, not the bowls", async () => {
  const games = pgames(); games[0].final = true; games[0].w = SEEDS[7]; games[0].ap = 20; games[0].bp = 27;
  const picks = [{ user: "me", slot: "r1", team: SEEDS[7] }, { user: "me", slot: "ch", team: SEEDS[0] }, { user: "u2", slot: "r1", team: SEEDS[8] }, { user: "u2", slot: "ch", team: SEEDS[1] }];
  const { w, errs, app } = await boot(Date.parse("2026-12-20T15:00:00Z"), { games, picks });
  try {
    if (!app.querySelector(".pl-st")) await tab(app, "Standings");
    const rows = [...app.querySelectorAll(".pl-st tbody tr")];
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent, /David/); assert.equal(rows[0].cells[2].textContent, "1"); assert.equal(rows[0].cells[3].textContent, "9", "max: 1 won, 8 still live");
    const short = (id) => HUB.teams.find((t) => t.id === id).short;
    assert.ok(rows[1].textContent.includes(short(SEEDS[1])), "Mike's champion shows after the lock");
    await tab(app, "Scores");
    assert.equal(app.querySelectorAll(".pl-gms > *").length, 4, "the four first-round games, no bowls");
    assert.match(app.textContent, /Under each team: who has it winning this round\./);
    assert.deepEqual(errs, []);
  } finally { w.close(); }
});
