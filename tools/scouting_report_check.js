/* Checks Scouting Report's data. Run from the repo root:  node tools/scouting_report_check.js
   Every prospect has a real quote with who said it and a source link, plus the facts the file shows; no quote names
   him; quotes stay short; his name can be typed into the guess box; and the experts aren't right too often. */
const assert = require("assert");
globalThis.window = globalThis;
require("../guess-the-pick/engine.js");
require("../guess-the-pick/names.js");
require("../scouting-report/data.js");
const G = window.GTP, D = window.SR_DATA;
assert.ok(D.length >= 30, "enough prospects for a week of dailies");
const ids = new Set();
for (const p of D) {
  assert.ok(!ids.has(p.id), "one entry per prospect: " + p.n); ids.add(p.id);
  for (const k of ["n", "lg", "y", "pk", "tm", "col", "pos", "size", "stat", "q", "who", "outlet", "when", "url"]) assert.ok(p[k] !== undefined && p[k] !== "", `${p.n}: ${k}`);
  assert.ok(/^https?:\/\//.test(p.url), p.n + ": the source is a link");
  assert.ok(p.q.split(/\s+/).length <= 25, p.n + ": the quote is 25 words or fewer");
  assert.ok(p.y >= 2000 && p.y <= 2021, p.n + ": drafted 2000 to 2021");
  assert.ok(["pan", "glow"].includes(p.angle) && ["steal", "bust", "star"].includes(p.kind), p.n + ": angle and kind");
  for (const part of p.n.split(/[ .\-']+/)) if (part.length >= 4) assert.ok(!new RegExp("\\b" + part + "\\b", "i").test(p.q), `${p.n}: the quote says "${part}"`);
  const pool = G.pool(D.filter((x) => x.lg === p.lg).map((x) => ({ n: x.n, f: 0 })), window.GTP_NAMES[p.lg]);
  assert.strictEqual(G.judge(p.n, p, pool), "right", p.n + ": his own name is a right answer");
}
const right = D.filter((p) => p.right).length / D.length;
assert.ok(right < 0.5, "the experts are right sometimes, not usually (" + Math.round(right * 100) + "%)");
console.log(`All Scouting Report checks passed: ${D.length} prospects, experts right on ${Math.round(right * 100)}%`);
