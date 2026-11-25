// The Big Board's player card (draft/board.js) with college numbers from draft/prospects.json (tools/draft_college.py)
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { JSDOM } = require("jsdom");
const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const html = src("draft/index.html");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (f) => JSON.parse(src(f));

async function boot(hash) {
  // keep the page's markup and its own inline script; load the local scripts it lists, in order
  const scripts = [...html.matchAll(/<script src="([^"]+?)(?:\?v=[^"]*)?"[^>]*><\/script>/g)].map((m) => m[1]).filter((s) => !/analytics|projects|navigation/.test(s));
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const body = html.replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(body, { url: "https://davidsolar.dev/draft/" + hash, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {};
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = async (url) => {
    url = String(url);
    if (/gamelog|espn/.test(url)) return new Promise(() => {}); // ESPN never answers here, so the slot stays put
    const m = /(nba2028|nba|nfl|prospects)\.json/.exec(url);
    if (!m) return { ok: false, json: async () => null };
    return { ok: true, json: async () => json("draft/" + m[1] + ".json") };
  };
  for (const s of scripts) w.eval(src(path.join("draft", s)));
  for (const s of inline) w.eval(s);
  for (let i = 0; i < 100 && !w.document.querySelector("#tbody tr.p"); i++) await pause(20);
  return w;
}
const open = async (w, id) => {
  w.document.querySelector(`#tbody tr.p[data-id="${id}"]`).click();
  for (let i = 0; i < 100 && !/Profile/.test((w.document.getElementById("cardBody") || {}).textContent || ""); i++) await pause(20);
  return w.document.getElementById("cardBody");
};

test("an NBA prospect's card: where he's ranked, his college profile, measurables, and no boxes", async () => {
  const D = json("draft/nba.json"), P = json("draft/prospects.json").nba;
  const p = D.players.find((x) => P[x.id] && P[x.id].prof && +x.on > 1 && x.hi !== x.lo);
  const w = await boot("#nba");
  try {
    const c = await open(w, p.id), t = c.textContent;
    assert.match(t, /Where he's ranked/);
    assert.match(t, new RegExp(`Ranked \\d+(st|nd|rd|th) to \\d+(st|nd|rd|th) across`));
    assert.ok(c.querySelector(".rs .rs-con"), "the consensus marker");
    assert.equal(c.querySelectorAll(".rs .rs-dot").length, new Set(Object.values(p.ranks)).size, "one dot per rank");
    assert.match(t, new RegExp("percentile vs " + P[p.id].pool));
    assert.equal(c.querySelectorAll(".pc-bars .pc-pr").length, P[p.id].prof.length);
    assert.match(t, /Measurables/); assert.ok(c.querySelector(".pc-spec"));
    assert.match(t, /on draft night/);
    assert.ok(!c.querySelector(".pc-facts"), "the old boxed facts are gone from this card");
    assert.ok(c.querySelector('.pc-gl[data-gl="ncaab"][data-espn="' + P[p.id].espn + '"]') || !w.GameLog, "recent games from his ESPN id");
    // Stats tab: the per-game line and shooting
    const st = c.querySelector('[data-pane="st"]').textContent;
    assert.match(st, /Per game/); assert.match(st, /Field goals/); assert.match(st, /Threes/);
    assert.ok(!/undefined|NaN/.test(t + st));
  } finally { w.close(); }
});

test("an NFL prospect's card has his position's season tables and hometown", async () => {
  const D = json("draft/nfl.json"), P = json("draft/prospects.json").nfl;
  const p = D.players.find((x) => P[x.id] && P[x.id].groups && P[x.id].home);
  const w = await boot("#nfl");
  try {
    const c = await open(w, p.id), t = c.textContent;
    assert.match(t, new RegExp("percentile vs FBS"));
    assert.match(t, /Hometown/);
    assert.ok(t.includes(P[p.id].home));
    const st = c.querySelector('[data-pane="st"]').textContent;
    assert.ok(st.includes(P[p.id].groups[0][0]), "his main stat group");
    assert.ok(!/undefined|NaN/.test(t + st));
  } finally { w.close(); }
});

test("a prospect who never moved gets a sentence, not a flat chart; overseas players still get a card", async () => {
  const D = json("draft/nba.json"), P = json("draft/prospects.json").nba;
  const flat = D.players.find((x) => { const h = x.hist.filter((v) => v != null); return h.length > 2 && h.every((v) => v === h[0]); });
  const away = D.players.find((x) => !P[x.id]);
  const w = await boot("#nba");
  try {
    if (flat) { w.document.querySelector(`#tbody tr.p[data-id="${flat.id}"]`).click(); await pause(80); assert.match(w.document.getElementById("cardBody").textContent, /on every update since/); }
    if (away) {
      w.document.querySelector(`#tbody tr.p[data-id="${away.id}"]`).click(); await pause(80);
      const t = w.document.getElementById("cardBody").textContent;
      assert.match(t, /Where he's ranked/); assert.ok(!/Profile/.test(t)); assert.ok(!/undefined|NaN/.test(t));
    }
  } finally { w.close(); }
});
