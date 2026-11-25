// Recent games on player cards (assets/gamelog.js) and following players (assets/follow.js, assets/pcard.js)
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { JSDOM } = require("jsdom");
const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const gamelog = src("assets/gamelog.js"), follow = src("assets/follow.js"), pcard = src("assets/pcard.js");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ESPN's game log, in the shape the real feed has (names, labels, events keyed by id, seasonTypes > categories > events)
function feed(names, rows, opts = {}) {
  const events = {}, cat = [];
  rows.forEach((stats, i) => {
    const id = String(401900000 + i);
    events[id] = { id, gameDate: new Date(Date.UTC(2026, 10, 23) - i * 2 * 864e5).toISOString(), atVs: i % 2 ? "@" : "vs", score: "110-100", gameResult: i % 3 ? "W" : "L",
      opponent: { abbreviation: "OP" + i }, links: [{ rel: ["summary", "desktop", "event"], href: "https://www.espn.com/game/" + id }] };
    cat.push({ eventId: id, stats });
  });
  const seasonTypes = [{ displayName: "2026-27 Regular Season", categories: [{ type: "event", events: cat }] }];
  if (opts.preseason) seasonTypes.push({ displayName: "2026-27 Preseason", categories: [{ events: [{ eventId: "999", stats: rows[0] }] }] });
  if (opts.preseason) events["999"] = { id: "999", gameDate: "2026-12-30T00:00:00Z", atVs: "vs", opponent: { abbreviation: "PRE" } };
  return { labels: names.map((n) => n.slice(0, 3).toUpperCase()), names, events, seasonTypes };
}
const HOOPS = ["minutes", "fieldGoalsMade-fieldGoalsAttempted", "totalRebounds", "assists", "points"];
const hoopsRows = Array.from({ length: 14 }, (_, i) => [String(30 + i % 5), "8-15", String(5 + i % 4), String(3 + i % 3), String(20 + i)]);
const QB = ["completions", "passingAttempts", "passingYards", "passingTouchdowns", "interceptions", "sacks", "rushingAttempts", "rushingYards"];
const qbRows = Array.from({ length: 9 }, (_, i) => ["20", "31", String(200 + i * 10), "2", "1", "3", "4", String(10 + i)]);

function boot(routes) {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { url: "https://davidsolar.dev/nba/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, calls = [];
  w.fetch = async (url) => {
    url = String(url); calls.push(url);
    for (const [re, body] of routes) if (re.test(url)) { if (body instanceof Error) throw body; return { ok: body !== null, json: async () => structuredClone(body) }; }
    return { ok: false, json: async () => null };
  };
  w.eval(follow); w.eval(pcard); w.eval(gamelog);
  return { w, calls };
}

test("a slot fills in with the last games as a chart, a stat switcher and a table", async () => {
  const { w, calls } = boot([[/athletes\/3112335\/gamelog/, feed(HOOPS, hoopsRows, { preseason: true })]]);
  try {
    w.document.getElementById("host").innerHTML = w.GameLog.slot({ league: "nba", espn: 3112335, name: "Nikola Jokic" });
    await pause(60);
    const el = w.document.querySelector(".pc-gl");
    assert.ok(el, "the slot stays when there are games");
    assert.equal(el.querySelectorAll(".gl-c").length, 10, "ten games charted");
    assert.match(el.textContent, /Last 10 games, 2026-27/);
    assert.ok(!/PRE/.test(el.textContent), "preseason games are left out");
    assert.equal(el.querySelectorAll(".gl-t tbody tr").length, 5, "the last five games in the table");
    // newest game is on the right of the chart and on top of the table
    const cols = [...el.querySelectorAll(".gl-o")].map((x) => x.textContent);
    assert.equal(cols[cols.length - 1], "OP0");
    assert.match(el.querySelector(".gl-t tbody tr").textContent, /OP0/);
    assert.ok(calls.some((u) => /site\.web\.api\.espn\.com\/apis\/common\/v3\/sports\/basketball\/nba\/athletes\/3112335\/gamelog/.test(u)));
    // switch the stat: rebounds
    const chips = [...el.querySelectorAll("[data-glm]")].map((b) => b.textContent);
    assert.deepEqual(chips.slice(0, 3), ["Points", "Rebounds", "Assists"]);
    el.querySelector('[data-glm="totalRebounds"]').click();
    assert.equal(w.document.querySelector('.pc-gl [aria-pressed="true"]').textContent, "Rebounds");
    const vs = [...w.document.querySelectorAll(".pc-gl .gl-v")]; assert.equal(vs[vs.length - 1].textContent, "5", "the newest game's rebounds");
    assert.ok(!/undefined|NaN/.test(w.document.querySelector(".pc-gl").textContent));
  } finally { w.close(); }
});

test("a quarterback charts his yards, and his sacks and interceptions aren't offered as his stats", async () => {
  const { w } = boot([[/gamelog/, feed(QB, qbRows)]]);
  try {
    const d = await w.GameLog.load("nfl", { espn: 1, name: "Josh Allen" });
    const html = w.GameLog.html(d, { rows: 0 });
    w.document.getElementById("host").innerHTML = html;
    assert.equal(w.document.querySelector('[aria-pressed="true"]').textContent, "Pass yards");
    const chips = [...w.document.querySelectorAll("[data-glm]")].map((b) => b.textContent);
    assert.ok(!chips.includes("Sacks") && !chips.includes("INT"), chips.join(","));
    assert.equal(w.document.querySelectorAll(".gl-t").length, 0, "rows: 0 leaves the table out");
    assert.match(w.GameLog.last(d), /^Nov 22 vs OP0, L 110‑100: 200 pass yds/);
  } finally { w.close(); }
});

test("without an ESPN id the player is found by name, once", async () => {
  const { w, calls } = boot([[/v3\/search/, { items: [{ id: "4321", displayName: "Connor McDavid", type: "player", league: "nhl" }, { id: "9", displayName: "Connor McDavid", type: "player", league: "nfl" }] }],
    [/athletes\/4321\/gamelog/, feed(["goals", "assists", "points", "shotsTotal", "timeOnIcePerGame"], Array.from({ length: 6 }, (_, i) => ["1", "1", "2", String(3 + i), "21:30"]))]]);
  try {
    const d = await w.GameLog.load("nhl", { name: "Connor McDavid" });
    assert.equal(d.espn, "4321", "the NHL match, not the namesake in another league");
    assert.equal(w.localStorage.getItem("gl-id:nhl:connormcdavid"), "4321");
    assert.equal(w.GameLog._num("21:30"), 21.5);
    const before = calls.filter((u) => /search/.test(u)).length;
    await w.GameLog.load("nhl", { name: "Connor McDavid" });
    assert.equal(calls.filter((u) => /search/.test(u)).length, before, "the id is remembered");
  } finally { w.close(); }
});

test("no games or ESPN down: the slot removes itself", async () => {
  const { w } = boot([[/gamelog/, new Error("offline")]]);
  try {
    w.document.getElementById("host").innerHTML = w.GameLog.slot({ league: "nba", espn: 5, name: "Nobody" }) + w.GameLog.slot({ league: "mlb", name: "Not Found" });
    await pause(60);
    assert.equal(w.document.querySelectorAll(".pc-gl").length, 0);
    assert.equal(w.GameLog.slot({ league: "cricket", name: "X" }), "", "unknown leagues get no slot");
  } finally { w.close(); }
});

test("following a player from his card keeps his name, team and link for My teams", async () => {
  const { w } = boot([]);
  try {
    const host = w.document.getElementById("host");
    host.innerHTML = w.PCard.html({ name: "Nikola Jokic", tabs: [{ id: "ov", label: "Overview", html: "<p>x</p>" }],
      follow: { sport: "nba-p", id: "nikola-jokic", name: "Nikola Jokic", info: { t: "Nuggets", espn: "3112335", href: "/nba/?card=nikola-jokic" } } });
    const b = host.querySelector(".pc-fol [data-follow]");
    assert.equal(b.getAttribute("data-follow"), "nba-p:nikola-jokic");
    assert.equal(b.title, "Follow this player");
    b.click();
    assert.ok(w.Follow.has("nba-p", "nikola-jokic"));
    assert.equal(host.querySelector(".pc-fol [data-follow]").getAttribute("aria-pressed"), "true");
    const ps = w.Follow.players();
    assert.equal(ps.length, 1);
    assert.equal(ps[0].league, "nba"); assert.equal(ps[0].n, "Nikola Jokic"); assert.equal(ps[0].t, "Nuggets"); assert.equal(ps[0].href, "/nba/?card=nikola-jokic");
    assert.ok(JSON.parse(w.localStorage.getItem("ds-fav:pinfo"))["nba-p:nikola-jokic"], "saved under ds-fav: so the account sync carries it");
    host.querySelector(".pc-fol [data-follow]").click();
    assert.equal(w.Follow.players().length, 0);
    assert.deepEqual(JSON.parse(w.localStorage.getItem("ds-fav:pinfo")), {}, "unfollowing drops his info too");
    // a team star still says team
    assert.match(w.Follow.star("nba", "BOS", "Celtics"), /Follow this team/);
  } finally { w.close(); }
});

test("every hub's card asks for recent games and a follow button, and every hub opens a card from ?card=", () => {
  const HUB = { nba: "nba", nfl: "nfl", nhl: "nhl", mlb: "mlb", cbb: "ncaab", cfb: "ncaaf" };
  for (const [dir, lg] of Object.entries(HUB)) {
    const app = src(dir + "/app.js"), html = src(dir + "/index.html");
    assert.ok(app.includes('GameLog.slot({ league: "' + lg + '"'), dir + " card has recent games");
    assert.ok(app.includes('sport: "' + lg + '-p"'), dir + " card has the follow button");
    assert.ok(/get\("card"\)/.test(app), dir + " opens ?card=");
    assert.ok(/assets\/gamelog\.js\?v=/.test(html), dir + " loads gamelog.js");
    const pc = html.indexOf("assets/pcard.js"), gl = html.indexOf("assets/gamelog.js");
    assert.ok(pc > 0 && gl > pc, dir + " loads gamelog.js after pcard.js");
  }
  assert.ok(/assets\/gamelog\.js/.test(src("my-teams/index.html")) && /Your players/.test(src("my-teams/index.html")));
});
