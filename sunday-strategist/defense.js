/* Sunday Strategist, defensive side: you're the coordinator.
   Read the offense, match personnel, call the pressure and coverage, pick what to take away.
   Then the real offensive play from that snap runs against your call.

   Everything is graded with the fitted model (model.js) through gen.js's rates:
   - what offenses actually call from this personnel in this situation (model.offense)
   - how each kind of play does against each coverage and box (gen.passRate, gen.runRate)
   - how each package fares against each personnel group (model.allowed)
   - how much more pressure each extra rusher brings (model.rush)
   Process grades judge your call against what the offense was likely to run;
   the rep judges it against what they did run. Pure functions, no DOM. */
(function (root, api) {
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SS_DEF = api;
})(this, (function (root) {
  var G = typeof module === "object" && module.exports ? require("./gen.js") : root.SS_GEN;
  var M = G && G.model();

  var PACKAGES = [
    { id: "heavy", label: "Goal line", detail: "Five or six linemen, extra linebackers, three DBs. Built to stop the run at the goal line.", front: 8, d7: { dl: 5, olb: 0, lb: 3, cb: 2, s: 1 } },
    { id: "base", label: "Base", detail: "Four down linemen, three linebackers, four DBs. Strong against the run and tight ends.", front: 7, d7: { dl: 4, olb: 0, lb: 3, cb: 2, s: 2 } },
    { id: "nickel", label: "Nickel", detail: "A fifth DB replaces a linebacker. The default against three receivers.", front: 6, d7: { dl: 4, olb: 0, lb: 2, cb: 3, s: 2 } },
    { id: "dime", label: "Dime", detail: "Six DBs, one linebacker. Built for passing downs; light against the run.", front: 5, d7: { dl: 4, olb: 0, lb: 1, cb: 4, s: 2 } }
  ];
  var PRESSURES = [
    { id: "four", label: "Four-man rush", detail: "Rush four, drop seven. The most coverage you can play.", rush: 4, blitz: 0, covers: ["man", "twoMan", "two", "three", "quarters"] },
    { id: "sim", label: "Simulated pressure", detail: "Still four rushers, but a linebacker or DB blitzes and a lineman drops. Confuses the protection without giving up coverage.", rush: 4, blitz: 1, covers: ["three", "quarters"] },
    { id: "fire", label: "Five-man zone pressure", detail: "A fire zone: five rush, three deep, three underneath.", rush: 5, blitz: 1, covers: ["three", "two"] },
    { id: "man5", label: "Five-man man pressure", detail: "Five rush, man-to-man behind it with a free safety.", rush: 5, blitz: 1, covers: ["man"] },
    { id: "zero", label: "Zero blitz", detail: "Six or more rush, man-to-man with nobody deep. Win fast or give up a big play.", rush: 6, blitz: 2, covers: ["zero"] }
  ];
  var COVERAGES = {
    zero: { label: "Cover 0", detail: "Man, nobody deep.", shell: "zero", name: "Cover 0" },
    man: { label: "Cover 1", detail: "Man with a free safety in the middle.", shell: "one", name: "Cover 1" },
    twoMan: { label: "2-Man", detail: "Man underneath, two safeties deep.", shell: "two", name: "2-Man" },
    two: { label: "Cover 2", detail: "Five underneath zones, two deep halves.", shell: "two", name: "Cover 2" },
    three: { label: "Cover 3", detail: "Three deep, four underneath; a safety rolls down.", shell: "one", name: "Cover 3" },
    quarters: { label: "Quarters", detail: "Four deep defenders reading the routes; safeties fit the run.", shell: "two", name: "Cover 4 (quarters)" }
  };
  var AREAS = [
    { id: "run", label: "The run", detail: "Fit every gap; safeties fast downhill." },
    { id: "quick", label: "Quick game and screens", detail: "Sit on slants, flats and the back." },
    { id: "middle", label: "The intermediate middle", detail: "Wall off digs, crossers and the corner route." },
    { id: "deep", label: "Deep shots", detail: "Keep everything in front; nothing over the top." }
  ];
  var AREA_OF = { "inside-zone": "run", "outside-zone": "run", power: "run", sneak: "run", draw: "run", quick: "quick", screen: "quick", mesh: "middle", dagger: "middle", smash: "middle", verts: "deep", "pa-shot": "deep", fade: "deep", dropback: "middle" };
  var NAMES = { "inside-zone": "an inside run", "outside-zone": "an outside run", sneak: "a quarterback sneak", quick: "a quick throw", screen: "a screen", mesh: "a crossing route", dagger: "an intermediate dig or curl", smash: "a corner or deep out", verts: "a vertical shot", "pa-shot": "a play-action shot", fade: "a fade", dropback: "a dropback pass" };

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function rng(seed) { var a = (seed >>> 0) || 1; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // What the offense really ran, in the game's concept terms (the same mapping tools/strategist_model.py uses).
  function conceptOf(r) {
    if (r.kind === "run") return r.rusher && r.rusher === r.qb && r.dist <= 1 ? "sneak" : r.runGap === "end" ? "outside-zone" : "inside-zone";
    if (r.screen) return "screen";
    var route = String(r.route || "").toUpperCase(), air = r.airYards;
    if (route === "SLANT" || route === "QUICK OUT" || (route === "HITCH/CURL" && air != null && air <= 9)) return "quick";
    if (route === "HITCH/CURL" || route === "IN/DIG") return "dagger";
    if (route === "CORNER" || route === "DEEP OUT") return "smash";
    if (route === "SHALLOW CROSS/DRAG") return "mesh";
    if (route === "GO" || route === "POST" || route === "WHEEL") return route === "GO" && r.yl100 <= 20 ? "fade" : r.playAction ? "pa-shot" : "verts";
    return "dropback";
  }

  // What offenses call from this personnel in this situation (2023 to 2025).
  function offenseDist(r) {
    var o = M && M.offense[r.situation + "|" + r.offPers], out = {}, sum = 0;
    if (o && o.n >= 20) Object.keys(o).forEach(function (k) { if (k !== "n" && k !== "other") { out[k] = o[k]; sum += o[k]; } });
    if (sum < 0.3) out = { run: 0.45, quick: 0.2, dagger: 0.1, smash: 0.08, mesh: 0.05, screen: 0.05, verts: 0.04, "pa-shot": 0.03 }, sum = 1;
    Object.keys(out).forEach(function (k) { out[k] /= sum; });
    // A run is split into its kinds by where offenses usually run in that down group.
    if (out.run) { var run = out.run; delete out.run; if (r.dist <= 1 && (r.down >= 3 || r.yl100 <= 3)) { out.sneak = run * 0.35; run *= 0.65; } out["inside-zone"] = run * 0.75; out["outside-zone"] = run * 0.25; }
    return { dist: out, n: o ? o.n : 0 };
  }
  function areaDist(r) {
    var d = offenseDist(r).dist, a = { run: 0, quick: 0, middle: 0, deep: 0 };
    Object.keys(d).forEach(function (k) { a[AREA_OF[k] || "middle"] += d[k]; });
    return a;
  }

  function sitGroup(r) { return r.situation || (r.down <= 2 ? "early" : "late"); }
  // How a package fares against this personnel, relative to the average package (model.allowed).
  function pkgFactor(r, pkg, kind) {
    if (!M) return 1;
    var sg = sitGroup(r), rows = PACKAGES.map(function (p) { return M.allowed[r.offPers + "|" + p.id + "|" + kind + "|" + sg]; });
    var mine = M.allowed[r.offPers + "|" + pkg + "|" + kind + "|" + sg];
    var have = rows.filter(Boolean);
    if (!mine || have.length < 2) {
      // Thin data: the plain rule. Heavy personnel punishes light packages on runs; receivers punish heavy ones on passes.
      var heavy = +r.offPers[1] + +r.offPers[0] >= 3, light = pkg === "dime" || pkg === "nickel", big = pkg === "heavy" || pkg === "base";
      if (kind === "run") return heavy && light ? 1.1 : !heavy && big ? 0.97 : 1;
      return !heavy && big ? 1.08 : heavy && light ? 0.97 : 1;
    }
    var avg = have.reduce(function (s, x) { return s + x[0]; }, 0) / have.length;
    return clamp(mine[0] / avg, 0.8, 1.2);
  }
  function box(call) {
    var p = byId(PACKAGES, call.pkg), c = COVERAGES[call.cov];
    return clamp(p.front + (c && c.shell !== "two" ? 1 : 0), 4, 10);
  }
  function pressure(rush) { var t = M && M.rush[String(clamp(rush, 3, 7))], b = M && M.rush["4"]; return t && b ? t.pressure - b.pressure : (rush - 4) * 0.09; }
  function dgOf(r) { return r.yl100 <= 20 ? "red" : r.down <= 2 ? "early" : r.dist <= 2 ? "short" : r.dist <= 6 ? "medium" : "long"; }
  function rgOf(r) { return r.dist <= 2 ? "short" : r.down >= 2 && r.dist >= 7 ? "long" : "standard"; }
  function rushKey(n) { return n <= 4 ? "4" : n === 5 ? "5" : "6"; }
  // Pass cell for this coverage and rush, then the concept's edge relative to all targeted throws (index 0 = success, 2 = EPA).
  function passCell(r, call, c, i) {
    var dg = dgOf(r), pz = byId(PRESSURES, call.pressure), cr = ((M.covRush[dg] || {})[call.cov] || {})[rushKey(pz.rush)] || (M.dropback[dg] || {})[call.cov];
    if (!cr) return null;
    var k = c === "dropback" ? null : c === "fade" && !(M.pass.fade || {})[dg] ? "verts" : c, cell = k && (M.pass[k] || {})[dg], tg = (M.targeted[dg] || {})[call.cov];
    var x = cell && (cell[call.cov] || cell.all);
    var v = cr[i];
    if (x && tg) v = i === 0 ? v * x[0] / tg[0] : v + (x[2] - tg[2]);
    return v;
  }
  function runCell(r, call, c, i) {
    var base = c === "outside-zone" ? "outside-zone" : c === "sneak" ? "sneak" : "inside-zone", rg = rgOf(r), t = (M.run[base] || {})[rg] || (M.run[base] || {}).short;
    if (!t) return null;
    var adv = String(clamp(G.blockers(r) - box(call), -3, 2)), x = base === "sneak" ? t.all : (t[adv] || t.all);
    return x[i];
  }
  // How a package fares against this personnel, as an EPA difference from the average package.
  function pkgEpa(r, pkg, kind) {
    var sg = sitGroup(r), rows = PACKAGES.map(function (p) { return M.allowed[r.offPers + "|" + p.id + "|" + kind + "|" + sg]; }).filter(Boolean);
    var mine = M.allowed[r.offPers + "|" + pkg + "|" + kind + "|" + sg];
    if (!mine || rows.length < 2 || mine[2] == null) return (pkgFactor(r, pkg, kind) - 1) * 0.5;
    var w = mine[1] / (mine[1] + 150); // a package rarely used here is mostly noise: shrink it toward average
    return clamp(w * (mine[2] - rows.reduce(function (s, x) { return s + x[2]; }, 0) / rows.length), -0.25, 0.25);
  }

  // Receivers your defensive backs can't match: everyone past the safeties' two gets a linebacker. Each one costs you on passes.
  function mismatch(r, pkg) {
    var p = byId(PACKAGES, pkg), dbs = p.d7.cb + p.d7.s, wrs = r.wrs != null ? r.wrs : 3;
    return Math.max(0, wrs + 2 - dbs);
  }
  // The offense's chance of success with play c against your call (drives the rep).
  function allowed(r, call, c) {
    var area = AREA_OF[c] || "middle", rate;
    if (area === "run") rate = (runCell(r, call, c, 0) || 0.45) * pkgFactor(r, call.pkg, "run");
    else rate = (passCell(r, call, c, 0) || 0.45) * pkgFactor(r, call.pkg, "pass") * (call.pressure === "sim" ? 0.97 : 1) * (1 + 0.06 * mismatch(r, call.pkg));
    rate *= call.area === area ? 0.85 : 1.04;
    return clamp(rate, 0.02, 0.97);
  }
  // Expected points the offense gains with play c against your call (drives the grades: big plays and turnovers count).
  function epa(r, call, c) {
    var area = AREA_OF[c] || "middle", v;
    if (area === "run") v = (runCell(r, call, c, 2) || 0) + pkgEpa(r, call.pkg, "run");
    else v = (passCell(r, call, c, 2) || 0.05) + pkgEpa(r, call.pkg, "pass") - (call.pressure === "sim" ? 0.02 : 0) + 0.07 * mismatch(r, call.pkg);
    return v + (call.area === area ? -0.08 : 0.02);
  }
  function expectedAllowed(r, call) {
    var d = offenseDist(r).dist, t = 0;
    Object.keys(d).forEach(function (c) { t += d[c] * epa(r, call, c); });
    return t;
  }
  function expectedSuccess(r, call) {
    var d = offenseDist(r).dist, t = 0;
    Object.keys(d).forEach(function (c) { t += d[c] * allowed(r, call, c); });
    return t;
  }
  function validCalls() {
    var out = [];
    PACKAGES.forEach(function (p) { PRESSURES.forEach(function (z) { z.covers.forEach(function (cv) { AREAS.forEach(function (a) { out.push({ pkg: p.id, pressure: z.id, cov: cv, area: a.id }); }); }); }); });
    return out;
  }
  function bestOf(r, filter) {
    var best = null;
    validCalls().filter(filter || function () { return true; }).forEach(function (c) { var v = expectedAllowed(r, c); if (!best || v < best.v) best = { call: c, v: v }; });
    return best;
  }
  // Grades by expected points allowed: within 0.015 EPA of the best is a tie (the data can't separate them).
  function gradeGap(gap) { return Math.round(clamp(95 - 220 * Math.max(0, gap - 0.015), 25, 95)); }
  function letter(n) { return n >= 97 ? "A+" : n >= 93 ? "A" : n >= 90 ? "A-" : n >= 87 ? "B+" : n >= 83 ? "B" : n >= 80 ? "B-" : n >= 77 ? "C+" : n >= 73 ? "C" : n >= 70 ? "C-" : n >= 60 ? "D" : "F"; }
  function needYards(r) { return r.yl100 <= r.dist ? r.dist : r.down === 1 ? Math.ceil(r.dist * 0.4) : r.down === 2 ? Math.ceil(r.dist * 0.6) : r.dist; }

  /* One rep: the real offensive play against your call. */
  function resolve(r, call, seed) {
    var R = rng(seed || 1), c = conceptOf(r), p = allowed(r, call, c), area = AREA_OF[c] || "middle", need = needYards(r);
    var pz = byId(PRESSURES, call.pressure), pass = area !== "run", deep = area === "deep";
    var ok = R() < p, kind, yards, events = [{ t: 0, text: "Snap." }];
    var pressured = pass && R() < clamp(((M.rush[String(clamp(pz.rush, 3, 7))] || {}).pressure || 0.26) + (call.pressure === "sim" ? 0.05 : 0), 0.1, 0.6);
    events.push({ t: 0.3, text: pass ? pz.rush + " rush" + (pz.blitz ? ", " + pz.blitz + " of them blitzing" : "") + ". " + (pressured ? "The pressure gets home fast." : "The protection holds.") : "They run it. Your " + box(call) + "-man box fits the run." });
    if (pass) events.push({ t: 0.8, text: COVERAGES[call.cov].label + " behind it. They go to " + NAMES[c] + "." });
    if (ok) {
      kind = pass ? "complete" : "run";
      yards = need + Math.floor(R() * (deep ? 22 : pass ? 9 : 6));
      if (call.area === area) yards = Math.max(need, yards - 3);
    } else if (pass) {
      var x = R();
      if (pressured && x < 0.3) { kind = "sack"; yards = -6 - Math.floor(R() * 4); }
      else if (x < (deep ? 0.08 : 0.04)) { kind = "int"; yards = 0; }
      else if (need > 2 && x < 0.55) { kind = "complete"; yards = Math.max(0, need - 1 - Math.floor(R() * 4)); }
      else { kind = "incomplete"; yards = 0; }
    } else { kind = "run"; yards = Math.max(-2, need - 1 - Math.floor(R() * (need + 3))); }
    var td = yards >= r.yl100 && kind !== "sack" && kind !== "int";
    if (td) yards = r.yl100;
    var first = td || (yards >= r.dist && kind !== "sack" && kind !== "int");
    var stopped = !ok;
    events.push({ t: pass ? 2.2 : 1.6, text: td ? "Touchdown." : kind === "sack" ? "Sack, " + -yards + "-yard loss." : kind === "int" ? "Intercepted!" : kind === "incomplete" ? "Incomplete." : (kind === "run" ? "Run" : "Complete") + " for " + yards + " yards" + (first ? ". First down." : ".") });
    var cards = [];
    if (pass) {
      cards.push({ who: "Your rush", job: pz.label + " against their protection", held: pressured, win: "Got pressure on the quarterback", fail: "No pressure; the quarterback had time" });
      cards.push({ who: "Your coverage", job: COVERAGES[call.cov].label + " against " + NAMES[c], held: stopped, win: "Took it away", fail: "They found the soft spot" });
    } else {
      var blk = G.blockers(r), b = box(call);
      cards.push({ who: "Your front", job: b + " in the box against " + blk + " run blockers", held: stopped, win: b > blk ? "The extra man made the tackle" : "Won one-on-one at the point of attack", fail: b <= blk ? "They had a blocker for every defender" : "A missed fit opened the hole" });
    }
    cards.push({ who: "Your take-away", job: byId(AREAS, call.area).label, held: call.area === area, win: "You took away exactly what they ran", fail: "They ran " + NAMES[c] + ", which you didn't take away" });
    return { concept: c, area: area, p: p, success: ok, kind: kind, yards: yards, firstDown: first, touchdown: td, stopped: stopped, events: events, cards: cards, pressured: pressured };
  }

  function review(r, answers, call, seed) {
    var dist = areaDist(r), maxA = Math.max.apply(null, Object.keys(dist).map(function (k) { return dist[k]; }));
    var likely = Object.keys(dist).sort(function (a, b) { return dist[b] - dist[a]; })[0];
    var readPers = answers.pers === r.offPers ? 100 : 0;
    var readCall = Math.round(100 * (dist[answers.likely] || 0) / maxA);
    var mine = expectedAllowed(r, call);
    var best = bestOf(r), bestPkg = bestOf(r, function (c) { return c.pkg === call.pkg; }), bestCall = bestOf(r, function (c) { return c.pkg === call.pkg && c.area === call.area; });
    var grades = {
      read: Math.round((readPers + readCall) / 2),
      personnel: gradeGap(bestPkg.v - best.v),
      call: gradeGap(expectedAllowed(r, { pkg: call.pkg, pressure: call.pressure, cov: call.cov, area: call.area }) - bestCall.v),
      takeaway: Math.round(100 * dist[call.area] / maxA),
      result: 0
    };
    var rep = resolve(r, call, seed);
    grades.result = rep.touchdown ? 5 : rep.kind === "int" ? 100 : rep.kind === "sack" ? 97 : rep.stopped ? 90 : rep.firstDown ? 25 : 55;
    var process = Math.round((grades.read + grades.personnel + grades.call + grades.takeaway) / 4);
    var errors = [];
    if (grades.read < 70) errors.push("dc-read");
    if (grades.personnel < 75) errors.push("dc-personnel");
    if (grades.call < 75) errors.push("dc-call");
    // Ranked alternatives: the best call in each package, so the comparison is about personnel and coverage.
    var alts = PACKAGES.map(function (p) { var b = bestOf(r, function (c) { return c.pkg === p.id; }); return { call: b.call, allowed: b.v, yours: false }; })
      .sort(function (a, b) { return a.allowed - b.allowed; });
    var good = process >= 80, won = grades.result >= 75;
    return {
      rep: rep, grades: grades, letters: Object.keys(grades).reduce(function (o, k) { o[k] = letter(grades[k]); return o; }, {}), process: process, errors: errors,
      expected: mine, expectedSuccess: expectedSuccess(r, call), best: best, alternatives: alts, likely: likely, areaDist: dist, offense: offenseDist(r),
      verdict: good && won ? { title: "Good call, good result", text: "The process earned the stop." } : good ? { title: "Good call, bad result", text: "Your call was right for what they usually run here; this rep went their way." }
        : won ? { title: "Bad call, good result", text: "You got the stop, but this call gives up more than the alternatives over many snaps." } : { title: "Bad call, bad result", text: "The review shows where it turned." }
    };
  }

  // The defense drawn for your call: gen.js builds it from your package, box, rush and coverage.
  function view(data, real, r, call) {
    var p = byId(PACKAGES, call.pkg || "nickel"), cv = COVERAGES[call.cov || "quarters"], pz = byId(PRESSURES, call.pressure || "four");
    var mod = Object.assign({}, r, { pkg: p.id, def7: p.d7, box: box({ pkg: p.id, cov: call.cov || "quarters" }), coverage: cv.name, rushers: pz.rush, blitzers: pz.blitz });
    return G.build(data, real, mod);
  }

  return { PACKAGES: PACKAGES, PRESSURES: PRESSURES, COVERAGES: COVERAGES, AREAS: AREAS, NAMES: NAMES, conceptOf: conceptOf, offenseDist: offenseDist, areaDist: areaDist,
    allowed: allowed, epa: epa, mismatch: mismatch, expectedAllowed: expectedAllowed, expectedSuccess: expectedSuccess, bestOf: bestOf, resolve: resolve, review: review, view: view, box: box, letter: letter };
})(this));
