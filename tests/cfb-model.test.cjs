const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const M = require("../cfb/model.js");
const ROOT = path.join(__dirname, "..");
const hub = JSON.parse(fs.readFileSync(path.join(ROOT, "cfb/data/hub.json"), "utf8"));
const X = JSON.parse(fs.readFileSync(path.join(ROOT, "cfb/data/extras.json"), "utf8"));
const P = JSON.parse(fs.readFileSync(path.join(ROOT, "cfb/data/players.json"), "utf8"));

const toy = { hfa: 2.5, sd: 14, base: 27, bar: 15, ratings: { a: { power: 20, o: 8, d: -12 }, b: { power: 5, o: 2, d: -3 }, c: { power: -10, o: -4, d: 6 } } };

test("missing values stay missing while a real zero survives", () => { assert.equal(M.num(null), null); assert.equal(M.num(""), null); assert.equal(M.num(0), 0); });
test("the spread is symmetric and home field is worth exactly the documented edge", () => {
  const n = M.line("a", "b", true, toy), flip = M.line("b", "a", true, toy), h = M.line("a", "b", false, toy);
  assert.equal(M.round(n.spread + flip.spread), 0); assert.equal(M.round(n.prob + flip.prob, 2), 1);
  assert.equal(M.round(h.spread - n.spread), 2.5); assert.equal(M.line("a", "zzz", true, toy), null);
});
test("projected scores agree with the spread and add to the total", () => {
  const l = M.line("a", "c", false, toy); assert.ok(Math.abs(l.hp - l.ap - l.spread) <= 0.11); assert.ok(Math.abs(l.hp + l.ap - l.total) <= 0.11); assert.ok(l.prob > 0.9);
});
test("the edge against the book uses the home team's margin", () => {
  assert.equal(M.edge({ spread: 7 }, { market: { spread: 3.5 } }), 3.5); assert.equal(M.edge({ spread: 7 }, {}), null);
});
test("a road win over a strong team is worth more than a home win over a weak one", () => {
  assert.ok(M.resumeValue("a", -1, true, toy) > M.resumeValue("c", 1, true, toy)); assert.ok(M.resumeValue("c", 1, false, toy) < -0.9);
});

test("the published snapshot is current-season, complete and internally consistent", () => {
  assert.ok(hub.teams.length >= 130, "every FBS team"); const ids = new Set(hub.teams.map(t => t.id)); assert.equal(ids.size, hub.teams.length);
  assert.ok(hub.conferences.length >= 10); const inConf = hub.conferences.flatMap(c => c.teams); assert.equal(new Set(inConf).size, hub.teams.length);
  assert.ok(hub.games.length >= 600); assert.equal(new Set(hub.games.map(g => g.id)).size, hub.games.length);
  for (const g of hub.games) { assert.ok(ids.has(g.home) || ids.has(g.away)); if (g.state === "pre") { assert.equal(g.hs, null); assert.equal(g.as, null); } }
  for (const t of hub.teams) { assert.ok(X.ratings[t.id], t.short + " has a hub rating"); assert.ok(Number.isFinite(X.ratings[t.id].power)); }
  assert.equal(new Set(P.players.map(p => p.id)).size, P.players.length);
  for (const p of P.players) { assert.ok(ids.has(p.teamId)); for (const v of Object.values(p.s || {})) assert.ok(Number.isFinite(v)); }
});
test("the browser line matches the line the updater logged", () => {
  const games = Object.entries(X.lines.games).filter(([, v]) => !v.final).slice(0, 25);
  for (const [id, v] of games) {
    const g = hub.games.find(x => x.id === id); if (!g || g.state !== "pre") continue;
    // Python and JavaScript round halves differently, so allow a tenth of a point.
    const l = M.line(g.home, g.away, g.neutral, X); assert.ok(Math.abs(l.spread - v.spread) <= 0.11); assert.ok(Math.abs(l.total - v.total) <= 0.11); assert.ok(Math.abs(l.prob - v.prob) <= 0.002);
  }
});
test("the simulation fills a 12-team field every season and the odds add up", () => {
  const S = X.season_sim, T = Object.values(S.teams), sum = k => T.reduce((s, o) => s + (typeof k === "function" ? k(o) : o[k]), 0);
  assert.ok(Math.abs(sum("cfp") - 12) < 0.02, "12 teams make it"); assert.ok(Math.abs(sum("bye") - 4) < 0.02, "four byes");
  assert.ok(Math.abs(sum(o => o.r[3]) - 1) < 0.01, "one champion"); assert.ok(Math.abs(sum(o => o.r[2]) - 2) < 0.02, "two finalists");
  assert.ok(Math.abs(sum("auto") - 5) < 0.02, "five automatic bids");
  const champs = hub.conferences.filter(c => !c.independent).length; assert.ok(Math.abs(sum("champ") - champs) < 0.02, "one champion per conference");
  for (const o of T) { assert.ok(o.cfp >= o.bye && o.cfp >= o.r[0] && o.r[0] >= o.r[1] && o.r[1] >= o.r[2] && o.r[2] >= o.r[3]); assert.ok(o.champ <= o.ccg + 1e-9); }
  assert.equal(S.projected.seeds.length, 12); assert.equal(new Set(S.projected.seeds).size, 12);
});
test("the Heisman ladder is ranked, scaled to 100 and points at real players", () => {
  const L = X.heisman.ladder, ids = new Set(P.players.map(p => p.id)); assert.ok(L.length >= 20); assert.equal(L[0].score, 100);
  L.forEach((r, i) => { assert.equal(r.rank, i + 1); assert.ok(ids.has(r.id)); if (i) assert.ok(r.score <= L[i - 1].score); });
});
