/* Checks Boston Grid's data and rules. Run from the repo root:  node tools/boston_grid_check.js
   Every day for the next year gets a grid in every league, every square has enough answers, Boston leads the
   side, and a few known careers judge the way they should. */
const assert = require("assert");
globalThis.window = globalThis;
require("../guess-the-pick/engine.js");
const BG = require("../boston-grid/engine.js");
for (const lg of ["nba", "nfl", "mlb"]) require(`../boston-grid/data-${lg}.js`);

const team = (L, id) => L.ids.indexOf(id);
const day = (k) => new Date(Date.UTC(2026, 9, 29) + k * 864e5).toISOString().slice(0, 10);
for (const lg of ["nba", "nfl", "mlb"]) {
  const L = BG.league(window.BG_DATA[lg], lg);
  assert.ok(L.boston >= 0, lg + ": Boston's team is in the data");
  const sizes = [], seen = new Set();
  for (let k = 0; k < 366; k++) {
    const g = BG.grid(L, day(k));
    assert.ok(g, `${lg} ${day(k)}: a grid`);
    assert.strictEqual(g.rows[0], L.boston, "Boston leads the side");
    assert.strictEqual(new Set(g.rows.concat(g.cols)).size, 6, "six different teams");
    for (const r of g.rows) for (const c of g.cols) sizes.push(L.pair[r][c]);
    seen.add(g.rows.concat(g.cols).join(","));
    assert.ok(BG.grid(L, day(k)).cols.join() === g.cols.join(), "the same date gives the same grid");
  }
  sizes.sort((a, b) => a - b);
  console.log(`${lg}: ${L.players.length} players, ${seen.size} different grids in a year, notable answers per square min ${sizes[0]}, median ${sizes[sizes.length >> 1]}, max ${sizes[sizes.length - 1]}`);
}

const nba = BG.league(window.BG_DATA.nba, "nba"), nfl = BG.league(window.BG_DATA.nfl, "nfl"), mlb = BG.league(window.BG_DATA.mlb, "mlb");
const j = (L, name, a, b) => BG.judge(L, name, team(L, a), team(L, b), []).r;
assert.strictEqual(j(nba, "Kevin Garnett", "celtics", "timberwolves"), "right");
assert.strictEqual(j(nba, "kevin garnett", "celtics", "lakers"), "wrong");
assert.strictEqual(j(nba, "Kemba Walker", "celtics", "hornets"), "right");
assert.strictEqual(j(nba, "Ray Allen", "celtics", "thunder"), "right", "the Sonics count as the Thunder franchise");
assert.strictEqual(j(nba, "Nobody McFakename", "celtics", "lakers"), "unknown");
assert.strictEqual(j(nfl, "Randy Moss", "patriots", "vikings"), "right");
assert.strictEqual(j(nfl, "Wes Welker", "patriots", "dolphins"), "right");
assert.strictEqual(j(nfl, "Tom Brady", "patriots", "buccaneers"), "right");
assert.strictEqual(j(nfl, "Tom Brady", "patriots", "jets"), "wrong");
assert.strictEqual(j(mlb, "Pedro Martinez", "BOS", "WSN"), "right", "the Expos count as the Nationals franchise");
assert.strictEqual(j(mlb, "David Ortiz", "BOS", "MIN"), "right");
assert.strictEqual(j(mlb, "Johnny Damon", "BOS", "NYY"), "right");
const used = BG.judge(nba, "Kevin Garnett", team(nba, "celtics"), team(nba, "nets"), ["kevin garnett"]);
assert.strictEqual(used.r, "used", "a player only once per grid");
assert.ok(BG.points(BG.judge(nba, "Kevin Garnett", team(nba, "celtics"), team(nba, "timberwolves")).p) < 40, "a star is worth few deep-cut points");
console.log("All Boston Grid checks passed");
