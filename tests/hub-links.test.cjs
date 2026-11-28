// The links between Draft Lab's player cards and the hubs. Needs jsdom, like the hub UI tests:
//   npm install --no-save --prefix /tmp/qa jsdom && NODE_PATH=/tmp/qa/node_modules node --test tests/hub-links.test.cjs
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { JSDOM } = require("jsdom");
const ROOT = path.join(__dirname, ".."), read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function page(url) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div class="mast"><h1>Hub</h1></div><div id="top"></div><div id="app"></div></body></html>', { url, runScripts: "outside-only", pretendToBeVisual: true }), w = dom.window;
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, addListener() {} }));
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  return w;
}

test("a hub that can't find a linked player opens its search with his name typed", () => {
  const w = page("https://davidsolar.dev/nba/?card=some-bench-guy&n=Some+Bench+Guy");
  w.eval(read("assets/search.js"));
  const opened = [];
  w.Search.mount({ sport: "nba", index: () => [{ id: "jayson-tatum", kind: "p", name: "Jayson Tatum" }], open: (x) => opened.push(x.id) });
  w.Search.miss("jayson-tatum");          // not the linked id (a click inside the hub): nothing happens
  assert.equal(w.document.querySelector("dialog.ds-srch"), null);
  w.Search.miss("some-bench-guy");
  const dlg = w.document.querySelector("dialog.ds-srch");
  assert.ok(dlg && dlg.hasAttribute("open"), "the search box is open");
  assert.equal(dlg.querySelector("input").value, "Some Bench Guy");
  assert.match(dlg.querySelector(".ds-srch-list").textContent, /No player or team matches/);
  dlg.close(); w.Search.miss("some-bench-guy");
  assert.ok(!dlg.hasAttribute("open"), "once only");
  w.Search.open();                        // the Search button still starts empty
  assert.equal(dlg.querySelector("input").value, "");
});

test("a link without a name, or a hub opened plainly, never opens the search box", () => {
  for (const url of ["https://davidsolar.dev/nba/?card=some-bench-guy", "https://davidsolar.dev/nba/"]) {
    const w = page(url);
    w.eval(read("assets/search.js"));
    w.Search.mount({ sport: "nba", index: () => [], open() {} });
    w.Search.miss("some-bench-guy");
    assert.equal(w.document.querySelector("dialog.ds-srch"), null, url);
  }
});

test("Draft Lab's card: recent games in Overview and a link to the player's hub", () => {
  const w = page("https://davidsolar.dev/fantasy/mock/");
  for (const f of ["fantasy-kit/nav.js", "fantasy-kit/sports.js", "fantasy-kit/value.js", "fantasy-kit/draft.js", "assets/faces.js", "assets/pcard.js", "fantasy-kit/ui.js"]) w.eval(read(f));
  const { sports: S, value: V, ui: U } = w.FK;
  const want = { nba: ["nba", "id"], nfl: ["nfl", "espn"], mlb: ["mlb", "id"], nhl: ["nhl", "id"], cbb: ["ncaab", "id"], cfb: ["ncaaf", "id"] };
  for (const key of Object.keys(want)) {
    const data = JSON.parse(read(`fantasy-kit/data/${key}.json`)), sport = S.attach(Object.assign({}, S[key]), data), players = data.players.map((p) => ({ ...p }));
    V.evaluate(sport, players, { teams: 10, lineup: sport.lineup });
    const p = players.find((x) => x.espn || want[key][1] === "id") , d = new w.DOMParser().parseFromString(U.playerCard(sport, p, {}), "text/html");
    const slot = d.querySelector('[data-pane="overview"] .pc-glslot'), a = d.querySelector(".pc-foot a.pc-hub");
    assert.ok(slot, `${key}: a game log slot in Overview`);
    assert.equal(slot.dataset.gl, want[key][0]); assert.equal(slot.dataset.name, p.n);
    const u = new w.URL(a.getAttribute("href"), "https://davidsolar.dev");
    assert.equal(u.pathname, `/${key}/`); assert.equal(u.searchParams.get("card"), String(p[want[key][1]])); assert.equal(u.searchParams.get("n"), p.n);
    assert.equal(a.target, "_blank", "a new tab, so a draft room stays open");
    assert.doesNotMatch(U.playerCard(sport, p, { recent: false }), /pc-glslot/, `${key}: recent: false leaves the slot out`);
    const def = players.find((x) => (x.pos || []).includes("DEF"));
    if (def) assert.doesNotMatch(U.playerCard(sport, def, {}), /pc-glslot|class="pc-hub"/, `${key}: a team defense gets neither`);
  }
});
