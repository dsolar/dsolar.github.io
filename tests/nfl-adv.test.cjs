// NFL Hub advanced stats (nfl/data/adv.json from tools/nfl_adv.py): every row lines up with its pool's columns
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const A = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "nfl/data/adv.json"), "utf8"));

test("each pool's rows carry one number per column, and percentiles only for known columns", () => {
  for (const pool of ["qb", "rb", "rec", "rush", "cov"]) {
    const cols = A.cols[pool];
    assert.ok(Array.isArray(cols) && cols.length, pool + " has columns");
    for (const [id, r] of Object.entries(A[pool] || {})) {
      assert.equal(r.x.length, cols.length, `${pool} ${id} lines up`);
      for (const k of Object.keys(r.pct || {})) assert.ok(cols.includes(k), `${pool} ${id} pct ${k}`);
      for (const v of Object.values(r.pct || {})) assert.ok(v >= 0 && v <= 100);
    }
  }
});

test("team style: one number and one rank per column for each team", () => {
  for (const [t, v] of Object.entries(A.teams || {})) {
    assert.equal(v.length, A.tcols.length, t);
    assert.equal((A.trank[t] || []).length, A.tcols.length, t + " ranks");
  }
});
