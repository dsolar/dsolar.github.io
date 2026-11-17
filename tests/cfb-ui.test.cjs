const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { JSDOM } = require("jsdom");
const ROOT = path.join(__dirname, ".."), html = fs.readFileSync(path.join(ROOT, "cfb/index.html"), "utf8").replace(/<script[^>]*src=[^>]*><\/script>/g, "");
const core = fs.readFileSync(path.join(ROOT, "cfb/model.js"), "utf8"), app = fs.readFileSync(path.join(ROOT, "cfb/app.js"), "utf8");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "cfb/data/hub.json"), "utf8")), extras = JSON.parse(fs.readFileSync(path.join(ROOT, "cfb/data/extras.json"), "utf8")), players = JSON.parse(fs.readFileSync(path.join(ROOT, "cfb/data/players.json"), "utf8"));
const cfbdPath = path.join(ROOT, "cfb/data/cfbd.json"), cfbd = fs.existsSync(cfbdPath) ? JSON.parse(fs.readFileSync(cfbdPath, "utf8")) : null;
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await pause(10); } assert.fail("UI condition did not settle"); }
async function boot(hash = "#/week", opts = {}) {
  const dom = new JSDOM(html, { url: "https://davidsolar.dev/cfb/" + hash, runScripts: "outside-only", pretendToBeVisual: true }), w = dom.window;
  w.scrollTo = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  w.AbortSignal.timeout = () => new w.AbortController().signal;
  w.fetch = async url => { url = String(url); if (url.includes("espn.com")) throw Error("offline test"); if (url.includes("cfbd")) { const c = opts.noCfbd ? null : cfbd; return c ? { ok: true, json: async () => structuredClone(c) } : { ok: false, json: async () => ({}) }; } const body = url.includes("extras") ? extras : url.includes("players") ? players : data; return { ok: true, json: async () => structuredClone(body) }; };
  const ready = new Promise(resolve => w.document.addEventListener("cfb:ready", resolve, { once: true }));
  w.eval(core); w.eval(app); await ready; await pause(0); return w;
}
async function go(w, hash) { w.location.hash = hash; const tab = hash.startsWith("#/team?") ? "teams" : hash.split("/")[1].split("?")[0]; await until(() => w.document.querySelector('[data-tab="' + tab + '"]')?.getAttribute("aria-current") === "page"); await pause(20); }
const text = w => w.document.querySelector("#view").textContent;

test("every section renders from the actual snapshot without printing missing values", async () => {
  const w = await boot(); try {
    for (const name of ["week", "playoff", "ratings", "matchup", "conferences", "teams", "players", "heisman", "prospects", "method"]) {
      await go(w, "#/" + name); assert.ok(text(w).trim().length > 300, name + " has useful content"); assert.ok(!/\bundefined\b|\bNaN\b|\[object/.test(text(w)), name + " does not print missing values");
    }
    for (const c of ["rush", "rec", "def"]) { await go(w, "#/players?cat=" + c); assert.ok(w.document.querySelectorAll("tbody tr").length > 20, c); assert.ok(!/\bNaN\b|\bundefined\b/.test(text(w))); }
    await go(w, "#/ratings?view=chart"); assert.ok(w.document.querySelector("svg.sc-chart circle"));
    for (const t of data.teams.slice(0, 12).concat(data.teams.slice(-3))) { await go(w, "#/team?id=" + t.id); assert.ok(text(w).includes(t.short)); assert.ok(!/\bundefined\b|\bNaN\b/.test(text(w)), t.short + " page"); }
    for (const c of data.conferences.filter(c => !c.independent)) { await go(w, "#/conferences?conf=" + encodeURIComponent(c.short)); assert.equal(w.document.querySelectorAll("#race ~ .panel tbody tr").length, c.teams.length); }
  } finally { w.close(); }
});
test("this week's games carry the hub line, a total and a watchability score", async () => {
  const w = await boot("#/week"); try {
    const cards = w.document.querySelectorAll(".gm"); assert.ok(cards.length > 0);
    const pre = [...cards].find(c => /O\/U/.test(c.textContent)); assert.ok(pre, "a card shows a total");
    for (const c of cards) assert.ok(Number(c.dataset.watch) >= 0 && Number(c.dataset.watch) <= 100);
  } finally { w.close(); }
});
test("the projected bracket shows twelve seeded teams and the bubble", async () => {
  const w = await boot("#/playoff"); try {
    const seeds = [...w.document.querySelectorAll(".cfp .tmr .sd")].map(x => x.textContent).filter(Boolean);
    assert.equal(new Set(seeds).size, 12); assert.ok(w.document.querySelectorAll(".bubble li").length >= 6);
    w.document.querySelector('[data-sort="title"]').click(); assert.ok(w.location.hash.includes("sort=title"));
  } finally { w.close(); }
});
test("the spread machine swaps sides and shows a verdict", async () => {
  const [a, b] = data.teams, w = await boot("#/matchup?a=" + a.id + "&b=" + b.id + "&site=n"); try {
    assert.ok(w.document.querySelector(".verdict")); w.document.querySelector("[data-swap]").click(); await pause(20); assert.ok(w.location.hash.includes("a=" + b.id));
  } finally { w.close(); }
});
test("following a team persists locally and filters the team grid; player cards open", async () => {
  const w = await boot("#/teams"); try {
    const star = w.document.querySelector("[data-fav]"), id = star.dataset.fav; star.click();
    assert.ok(JSON.parse(w.localStorage.getItem("ds-cfb:favorites")).includes(id));
    await go(w, "#/teams?follow=1"); assert.equal(w.document.querySelectorAll(".tg").length, 1);
    await go(w, "#/heisman"); w.document.querySelector("[data-player]").click(); assert.ok(w.document.querySelector("#card").hasAttribute("open"));
    assert.ok(!/\bundefined\b|\bNaN\b/.test(w.document.querySelector("#cardBody").textContent));
  } finally { w.close(); }
});

test("the hub works without CollegeFootballData and adds its efficiency views when present", async () => {
  const w = await boot("#/ratings", { noCfbd: true }); try {
    assert.ok(!w.document.querySelector('[data-v="adv"]'), "no efficiency view without CFBD");
    await go(w, "#/team?id=" + data.teams[0].id); assert.ok(!/Efficiency/.test(text(w)));
  } finally { w.close(); }
  if (!cfbd || !cfbd.advanced) return;
  const v = await boot("#/ratings?view=adv"); try {
    assert.ok(v.document.querySelectorAll("tbody tr").length > 100); assert.ok(!/\bundefined\b|\bNaN\b/.test(text(v)));
    v.document.querySelector('[data-asort="oEpa"]').click(); assert.ok(v.location.hash.includes("asort=oEpa"));
    for (const h of ["#/team?id=" + data.teams[0].id, "#/matchup", "#/players", "#/heisman", "#/week", "#/method"]) { await go(v, h); assert.ok(!/\bundefined\b|\bNaN\b/.test(text(v)), h); }
    await go(v, "#/team?id=" + data.teams[0].id); assert.ok(/Efficiency/.test(text(v)));
  } finally { v.close(); }
});
