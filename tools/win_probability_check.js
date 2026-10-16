// Checks for Win Probability (davidsolar.dev/win-probability/): data sanity, game building, grading, and
// grade calibration against a few simulated players.
// Run from the repo root:  node tools/win_probability_check.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const dir = path.join(__dirname, "..", "win-probability");
const ctx = { window: {}, globalThis: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, "data.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(dir, "practice.js"), "utf8"), ctx);
const D = ctx.window.WP_DATA;
const E = require(path.join(dir, "engine.js"));

let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log("FAIL:", msg); } };

// ---- data sanity
const all = D.scenarios.concat(D.famous);
const ids = new Set();
for (const s of all) {
  check(!ids.has(s.id), "duplicate id " + s.id); ids.add(s.id);
  check(Object.keys(s.opts).length >= 2, "fewer than two options " + s.id);
  for (const [k, v] of Object.entries(s.opts)) check(typeof v === "number" && v >= 0 && v <= 100, `bad wp ${s.id} ${k}=${v}`);
  check(s.best === E.rankedOptions(s)[0][0], "best mismatch " + s.id);
  check(D.teams[s.you] && D.teams[s.opp], "missing team " + s.id);
  check(Array.isArray(s.score) && s.score.length === 2 && Array.isArray(s.to), "score/timeouts " + s.id);
  check(typeof s.clock === "string" && /^\d{1,2}:\d{2}$/.test(s.clock), "clock " + s.id + " " + s.clock);
  if (s.kind === "4th" && s.model === "nfl4th") check(s.inputs && s.inputs.conv != null, "4th inputs " + s.id);
  if (s.kind === "pat") check(s.inputs && s.inputs.xp != null && s.inputs.two != null, "pat inputs " + s.id);
}
console.log(`scenarios: ${D.scenarios.length} + ${D.famous.length} famous, teams: ${Object.keys(D.teams).length}, coaches: ${D.coaches.length}`);

// ---- game building
const lengths = { quick: 10, fourth: 10, pat: 10, daily: 5, clock: 6, overtime: 4 };
for (const mode of Object.keys(lengths)) {
  for (let seed = 1; seed <= 300; seed++) {
    const g = E.buildGame(D, mode, { seed, dayIndex: seed });
    check(g.list.length === lengths[mode], `${mode} length ${g.list.length}`);
    check(g.list.every(Boolean), `${mode} undefined scenario seed ${seed}`);
    if (mode !== "daily") check(new Set(g.list.map((s) => s.id)).size === g.list.length, `${mode} duplicate in game seed ${seed}`);
  }
}
const d1 = E.buildGame(D, "daily", { seed: E.hashString("wp-daily-2026-10-16"), dayIndex: 0 }).list.map((s) => s.id).join();
const d2 = E.buildGame(D, "daily", { seed: E.hashString("wp-daily-2026-10-16"), dayIndex: 0, seen: ["x"] }).list.map((s) => s.id).join();
check(d1 === d2, "daily is not deterministic");
const q = E.buildGame(D, "quick", { seed: 7 }).list;
check(q.filter((s) => s.famous).length >= 1, "quick game has no famous call");
check(q.filter((s) => s.kind === "pat").length >= 2, "quick game has no two-point calls");
const surv = E.buildGame(D, "survival", { seed: 3 });
for (let i = 0; i < 40; i++) surv.list.push(E.nextSurvival(D, surv, i));
check(surv.list.every(Boolean), "survival draw failed");

// ---- grading
for (const s of all) {
  const g = E.grade(s, s.best);
  check(g.points === 100 && g.lost === 0, "best call not full credit " + s.id);
  for (const k of Object.keys(s.opts)) {
    const x = E.grade(s, k);
    check(x.cost >= 0 && x.lost >= 0 && x.points >= 0 && x.points <= 100, "grade range " + s.id);
  }
  check(E.safeChoice(s) in s.opts, "safe choice missing " + s.id);
}
const harb = D.famous.find((s) => s.id === "famous-harbaugh-2pt-at-pit");
check(harb && E.grade(harb, "kick").points === 100 && E.grade(harb, "two").points === 100, "disputed call should give full credit both ways");

// ---- calibration: play many games with different strategies
function play(strategy, games) {
  const tally = {}, styles = {}, lost = [];
  for (let seed = 1; seed <= games; seed++) {
    const g = E.buildGame(D, "quick", { seed });
    const rand = E.mulberry32(seed * 7919);
    const results = g.list.map((s) => { const c = strategy(s, rand); return { s, g: E.grade(s, c) }; });
    const sum = E.summarize(results, D);
    tally[sum.grade] = (tally[sum.grade] || 0) + 1;
    styles[sum.style.label] = (styles[sum.style.label] || 0) + 1;
    lost.push(sum.lost);
  }
  lost.sort((a, b) => a - b);
  return { grades: tally, styles, medianLost: lost[Math.floor(lost.length / 2)] };
}
const keys = (s) => Object.keys(s.opts);
const strategies = {
  "always best": (s) => s.best,
  "coin flipper": (s, r) => keys(s)[Math.floor(r() * keys(s).length)],
  "punter's best friend": (s) => E.safeChoice(s),
  "always go": (s) => ("go" in s.opts ? "go" : "two" in s.opts ? "two" : s.best),
  "real NFL coach": (s) => (s.real && s.real.did in s.opts ? s.real.did : s.best),
  "sharp but human (80% best)": (s, r) => (r() < 0.8 ? s.best : keys(s)[Math.floor(r() * keys(s).length)]),
};
for (const [name, fn] of Object.entries(strategies)) {
  const r = play(fn, 1500);
  console.log(name.padEnd(28), "median lost", String(r.medianLost).padStart(5), JSON.stringify(r.grades), JSON.stringify(r.styles));
}
const best = E.summarize(E.buildGame(D, "quick", { seed: 11 }).list.map((s) => ({ s, g: E.grade(s, s.best) })), D);
check(best.grade === "A+" && best.style.id === "analytically_minded", "perfect game should be A+ Analytically Minded");

// Regression: one moderate mistake in ten should still be an A; bonus cannot change grade.
const regression = E.buildGame(D, "quick", {seed:11}).list.map(s => ({s,g:E.grade(s,s.best)}));
regression[0].g = {...regression[0].g,points:35,lost:3.5,cost:3.5};
const reg = E.summarize(regression,D);
check(reg.grade === "A" && reg.basePoints === 935, "935/1000 must be an A");
regression[0].bonus={correct:true};
check(E.summarize(regression,D).grade === reg.grade, "bonus changed the grade");
for(const s of D.practice) {
  for(const key of Object.keys(s.opts)) check(E.grade(s,key).points === (s.accepted.includes(key)?100:35), "practice credit " + s.id);
}
const fg66=all.filter(s=>s.kind==="4th" && s.model==="nfl4th" && s.inputs.fgDist===66 && Number.isFinite(s.inputs.wpM));
check(fg66.every(s=>"fg" in s.opts), "missing 66-yard FG option");
const scenarios=E.pools(D).fourth;
check(!scenarios.some(s=>s.best==="punt"&&s.ytg>=8&&s.yl>=50&&s.qtr<4), "obvious long punt still in pool");
const bold=all.find(s=>s.kind==="4th"&&s.best==="go"&&s.yl>=75&&s.ytg===1);
const mild=all.filter(s=>s.kind==="4th"&&s.best==="go"&&s.opts.fg!=null&&s.opts.go-s.opts.fg>=1.5&&s.opts.go-s.opts.fg<2.5).slice(0,2);
check(Boolean(bold)&&mild.length===2,"personality regression fixtures missing");
const balanced=[{s:bold,g:E.grade(bold,"go")},...mild.map(s=>({s,g:E.grade(s,"fg")}))];
check(E.summarize(balanced,D).style.id!=="punters_best_friend","field goals wrongly trigger punter label");
console.log(fails ? `${fails} checks failed` : "all checks passed");
process.exit(fails ? 1 : 0);
