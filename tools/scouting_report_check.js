/* Checks Scouting Report's data. Run from the repo root:  node tools/scouting_report_check.js
   Every prospect has a report, a projection and the facts the file shows; no report gives his name away or uses
   an em dash; his name can be typed into the guess box; and the scouts-right mix stays surprising. */
const assert = require("assert");
globalThis.window = globalThis;
require("../guess-the-pick/engine.js");
require("../guess-the-pick/names.js");
require("../scouting-report/data.js");
const G = window.GTP, D = window.SR_DATA;
assert.ok(D.length >= 150, "enough prospects for months of dailies");
const ids = new Set();
for (const p of D) {
  assert.ok(!ids.has(p.id), "one entry per prospect: " + p.n); ids.add(p.id);
  for (const k of ["n", "lg", "y", "pk", "tm", "col", "pos", "size", "stat", "rep", "proj"]) assert.ok(p[k] !== undefined && p[k] !== "", `${p.n}: ${k}`);
  assert.ok(p.y >= 2000 && p.y <= 2021, p.n + ": drafted 2000 to 2021");
  assert.ok(["pan", "glow"].includes(p.angle) && ["steal", "bust", "star"].includes(p.kind), p.n + ": angle and kind");
  const text = p.rep + " " + p.proj;
  assert.ok(!/[—–]/.test(text), p.n + ": no em or en dashes");
  for (const part of p.n.split(/[ .\-']+/)) if (part.length >= 4) assert.ok(!new RegExp("\\b" + part + "\\b", "i").test(text), `${p.n}: the report says "${part}"`);
  const pool = G.pool(D.filter((x) => x.lg === p.lg).map((x) => ({ n: x.n, f: 0 })), window.GTP_NAMES[p.lg]);
  assert.strictEqual(G.judge(p.n, p, pool), "right", p.n + ": his own name is a right answer");
}
const right = D.filter((p) => p.right).length / D.length;
assert.ok(right > 0.15 && right < 0.4, "the scouts are right sometimes, not usually (" + Math.round(right * 100) + "%)");
console.log(`All Scouting Report checks passed: ${D.length} prospects, scouts right on ${Math.round(right * 100)}%`);
