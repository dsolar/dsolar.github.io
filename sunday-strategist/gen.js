/* Sunday Strategist film room: builds a full scenario from one real snap in real-plays.js.

   What's real comes from the data: teams, score, clock, down and distance, personnel, formation
   family, box count, rushers, blitzers, coverage, result. What's built here, and labeled as built:
   the exact alignment drawn on the field, which defenders rushed, and each option's assignments.

   Grading follows the game's one rule, process apart from result:
   - each option's grade is its chance of success against the coverages the shown shell usually
     means and the rush the box can send (what you could know before the snap);
   - the rep itself resolves against what the defense actually did.
   Pass windows come from data.matrix (concept vs coverage, with the reason); run windows come from
   counting blockers against the box. */
(function (root, api) {
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SS_GEN = api;
})(this, (function (root) {
  var BX = 26.65; // the ball sits in the middle of the field; the real spot isn't charted
  var GROUP = { "Cover 0": "zero", "Cover 1": "man", "2-Man": "twoMan", "Cover 2": "two", "Cover 3": "three", "Cover 9": "three",
    "Cover 4 (quarters)": "quarters", "Cover 6": "quarters", "Combination coverage": "quarters" };
  var CALL = { "Cover 0": "gen-cover-0", "Cover 1": "gen-cover-1", "2-Man": "gen-2-man", "Cover 2": "gen-cover-2", "Cover 3": "gen-cover-3",
    "Cover 9": "gen-cover-9", "Cover 4 (quarters)": "gen-cover-4", "Cover 6": "gen-cover-6", "Combination coverage": "gen-combo" };
  var SHELL = { zero: "zero", man: "one", three: "one", twoMan: "two", two: "two", quarters: "two" };
  var DEEP = { zero: 0, man: 1, three: 3, twoMan: 2, two: 2, quarters: 4 };
  var MANISH = { zero: true, man: true, twoMan: true };
  // What a shell usually turns into after the snap (league-wide, roughly): the basis of the process grade.
  var PRIOR = {
    zero: { zero: 0.75, man: 0.25 },
    one: { man: 0.5, three: 0.45, zero: 0.05 },
    two: { two: 0.3, quarters: 0.4, twoMan: 0.1, three: 0.1, man: 0.1 }
  };
  var PASS = {
    quick: { need: 1.4, yards: 6, spread: 3, intRisk: 0.03, hot: true },
    smash: { need: 2.4, yards: 11, spread: 5, intRisk: 0.04, hot: true },
    mesh: { need: 2.3, yards: 7, spread: 4, intRisk: 0.03, hot: true },
    dagger: { need: 2.8, yards: 16, spread: 5, intRisk: 0.05 },
    verts: { need: 2.9, yards: 24, spread: 9, intRisk: 0.1 },
    "pa-shot": { need: 2.8, yards: 28, spread: 10, intRisk: 0.07 },
    fade: { need: 1.9, yards: 22, spread: 8, intRisk: 0.06 },
    screen: { need: 1.5, yards: 7, spread: 6, intRisk: 0.02 }
  };
  var RUN = {
    "inside-zone": { base: 0.52, per: 0.09, yards: 6, spread: 3, failYards: 2, failSpread: 2 },
    "outside-zone": { base: 0.49, per: 0.08, yards: 7, spread: 4, failYards: 1, failSpread: 2 },
    power: { base: 0.52, per: 0.1, yards: 5, spread: 3, failYards: 1, failSpread: 1 },
    draw: { base: 0.36, per: 0.06, yards: 7, spread: 4, failYards: 1, failSpread: 2 },
    sneak: { base: 0.8, per: 0.03, yards: 2, spread: 1, failYards: 0, failSpread: 1 }
  };
  var MENU = {
    "first-ten": ["inside-zone", "outside-zone", "pa-shot", "quick", "smash"],
    "second-long": ["inside-zone", "draw", "screen", "dagger", "smash"],
    "second-medium": ["inside-zone", "power", "quick", "smash", "pa-shot"],
    "second-short": ["power", "inside-zone", "pa-shot", "quick", "fade"],
    "third-short": ["power", "inside-zone", "quick", "mesh", "pa-shot"],
    "third-medium": ["quick", "mesh", "smash", "dagger", "draw"],
    "third-long": ["dagger", "verts", "smash", "screen", "draw"],
    "fourth-down": ["power", "inside-zone", "quick", "mesh", "pa-shot"],
    "red-zone": ["inside-zone", "power", "mesh", "smash", "fade"],
    "goal-line": ["power", "inside-zone", "fade", "quick", "pa-shot"],
    "two-minute": ["quick", "smash", "dagger", "verts", "draw"]
  };

  // The fitted tables (model.js, from tools/strategist_model.py). Without them the hand-set tables below still work.
  var M = null;
  try { M = typeof module === "object" && module.exports ? require("./model.js") : root.SS_MODEL || null; } catch (e) { M = null; }
  var GNAME = { zero: "Cover 0", man: "Cover 1", twoMan: "2-Man", two: "Cover 2", three: "Cover 3", quarters: "quarters" };
  var DGNAME = { early: "1st and 2nd down", short: "3rd and 4th and short", medium: "3rd and 4th and medium", long: "3rd and 4th and long", red: "the red zone" };
  var RGNAME = { short: "short yardage", standard: "standard downs", long: "long yardage" };
  function dgOf(r) { return r.yl100 <= 20 ? "red" : r.down <= 2 ? "early" : r.dist <= 2 ? "short" : r.dist <= 6 ? "medium" : "long"; }
  function rgOf(r) { return r.dist <= 2 ? "short" : r.down >= 2 && r.dist >= 7 ? "long" : "standard"; }
  function bucket(box) { return box <= 5 ? "5" : box >= 8 ? "8" : String(box); }
  // Pass: a called pass's real success rate here (sacks and throwaways included), scaled by how this concept does
  // relative to all targeted throws. Route charting only sees where the ball went, so the ratio, not the raw rate, is the concept's edge.
  function passRate(c, r, g, box) {
    if (!M) return null;
    var dg = dgOf(r), cell = (M.pass[c] || {})[dg] || (c === "fade" ? (M.pass.verts || {})[dg] : null), db = (M.dropback[dg] || {})[g], tg = (M.targeted[dg] || {})[g];
    if (!cell || !db || !tg) return null;
    var x = cell[g] || cell.all, bx = (M.box[dg] || {})[bucket(box || r.box || 6)], all = (M.box[dg] || {})["6"];
    var boxAdj = bx && all ? bx[0] / all[0] : 1; // passes do a little better against loaded boxes
    return { rate: clamp(db[0] * x[0] / tg[0] * boxAdj, 0.03, 0.95), n: x[1], dg: dg };
  }
  function runRate(c, r, box) {
    if (!M) return null;
    var rg = rgOf(r), adv = String(clamp(blockers(r) - box, -3, 2)), base = c === "outside-zone" ? "outside-zone" : c === "sneak" ? "sneak" : "inside-zone";
    var table = (M.run[base] || {})[rg] || (M.run[base] || {}).short;
    if (!table) return null;
    var x = base === "sneak" ? table.all : (table[adv] || table.all), rate = x[0];
    if (c === "sneak" && r.dist > 1) rate *= 0.35;
    if (c === "power") rate += r.dist <= 2 ? 0.03 : -0.03;
    if (c === "draw") rate += rg === "long" ? 0.05 : -0.05;
    return { rate: clamp(rate, 0.03, 0.95), n: x[1], rg: rg, adv: +adv };
  }
  function coveragePrior(r, shell, box) {
    var p = M && M.prior[r.pkg + "|" + bucket(box) + "|" + r.situation], out = {}, sum = 0;
    if (p) Object.keys(SHELL).forEach(function (g) { if (SHELL[g] === shell && p[g]) { out[g] = p[g]; sum += p[g]; } });
    if (sum < 0.15) return PRIOR[shell];
    Object.keys(out).forEach(function (g) { out[g] /= sum; });
    return out;
  }
  function first(t) { return t.split(". ")[0].replace(/\.$/, ""); }
  function dataLine(c, r, g, box) {
    var map = { stick: "quick", "hot-slant": "quick" }, k = map[c] || c;
    if (RUN[k] || k === "draw") {
      var x = runRate(k, r, box || 7);
      if (!x) return null;
      var adv = x.adv;
      return "NFL since 2023: runs like this on " + RGNAME[x.rg] + (k === "sneak" ? "" : " with " + (adv > 0 ? "more blockers than box defenders" : adv === 0 ? "even numbers in the box" : (-adv) + " more in the box than blockers")) + " succeeded " + pct(x.rate) + " (" + x.n.toLocaleString("en-US") + " runs).";
    }
    if (!g) return null;
    var y = passRate(k, r, g, box);
    if (!y) return null;
    return "NFL since 2023: this kind of throw against " + GNAME[g] + " on " + DGNAME[y.dg] + " succeeded " + pct(y.rate) + " (" + y.n.toLocaleString("en-US") + " throws, adjusted for sacks and throwaways).";
  }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function word(n) { return ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] || String(n); }
  function dd(r) { return ["", "1st", "2nd", "3rd", "4th"][r.down] + " and " + (r.yl100 <= r.dist ? "goal" : r.dist); }
  function pct(x) { return Math.round(x * 100) + "%"; }

  /* ---------- the offense on the field ---------- */
  function offense(r) {
    var backs = +r.offPers[0], tes = +r.offPers[1], wrs = r.wrs || Math.max(0, 5 - backs - tes), extraOL = Math.max(0, (r.ol || 5) - 5);
    var fb = Math.min(r.fb || 0, backs), form = r.formation || "Shotgun", gun = form === "Shotgun", pistol = form === "Pistol";
    var P = [];
    function add(id, label, role, x, y) { P.push({ id: id, label: label, role: role, x: r1(clamp(x, 1.5, 51.8)), y: y }); }
    ["LT", "LG", "C", "RG", "RT"].forEach(function (id, i) { add(id, id, ["Left tackle", "Left guard", "Center", "Right guard", "Right tackle"][i], BX - 2.6 + 1.3 * i, -1); });
    add("QB", "QB", "Quarterback (" + (gun ? "shotgun" : pistol ? "pistol" : "under center") + ")", BX, gun ? -5 : pistol ? -4 : -1.8);
    var inline = [];
    for (var e = 0; e < extraOL; e++) inline.push(["OL" + (e + 2), "T", "Extra offensive lineman"]);
    for (var t = 0; t < tes; t++) inline.push([t ? "Y" + (t + 1) : "Y", t ? "U" : "Y", "Tight end"]);
    // Attached on alternating sides, strength to the right; a third and fourth go to the wing.
    var right = 0, left = 0;
    inline.forEach(function (x, i) {
      var side = i % 2 === 0 ? 1 : -1, n = side > 0 ? right++ : left++;
      add(x[0], x[1], x[2] + (n ? ", wing " : ", attached ") + (side > 0 ? "right" : "left"), BX + side * (3.9 + n * 1.2), n ? -2.2 : -1);
    });
    var backIds = [];
    for (var b = 0; b < backs; b++) {
      var isFb = b < fb, id = isFb ? "FB" : backIds.indexOf("RB") < 0 ? "RB" : "RB2";
      backIds.push(id);
      var x = BX, y = -6.5;
      if (gun) { x = backs === 1 ? BX - 1.8 : BX + (b ? 1.8 : -1.8); y = -5; }
      else if (pistol) { x = backs === 1 ? BX : BX + (b ? 1.8 : -1.8); y = backs === 1 ? -7 : -5.5; }
      else if (backs >= 2) { y = isFb ? -4.3 : -7; x = isFb || fb ? BX : BX + (b ? 1.8 : -1.8); }
      add(id, id === "RB2" ? "RB" : id, isFb ? "Fullback" : "Running back", x, y);
    }
    // Receivers: the first two go wide, the rest fill the slots, strength right.
    var spots = [[-1, 18, -1, "X", "Receiver, wide left"], [1, 18, -1, "Z", "Receiver, wide right"], [1, 10, -1.8, "H", "Slot receiver, right"],
      [-1, 10, -1.8, "S", "Slot receiver, left"], [1, 6.5, -1.8, "F", "Inside slot, right"]];
    if (wrs === 1) spots = [spots[0]];
    for (var w = 0; w < wrs && w < spots.length; w++) { var s = spots[w]; add(s[3], s[3], s[4], BX + s[0] * s[1], s[2]); }
    if (!backs && P.length < 11) add("F", "F", "Back split out as a receiver, right", BX + 6.5, -1.8);
    while (P.length < 11) add("W" + P.length, "W", "Receiver", BX + 14, -1.8);
    return P.slice(0, 11);
  }

  /* ---------- the defense on the field ---------- */
  function defense(r, g, offP) {
    var d = r.def7 || { dl: 4, olb: 0, lb: 2, cb: 2, s: 3 };
    var edges = d.dl <= 3 ? Math.min(d.olb, 2) : 0, dl = d.dl, lbs = d.lb + d.olb - edges, dbs = d.cb + d.s;
    var total = dl + edges + lbs + dbs;
    if (total < 11) lbs += 11 - total;
    var P = [], box = r.box || (dl + edges + lbs), shell = SHELL[g];
    function add(id, label, role, x, y) { P.push({ id: id, label: label, role: role, x: r1(clamp(x, 1, 52.3)), y: r1(y) }); }
    var front = dl + edges;
    for (var i = 0; i < front; i++) {
      var x = BX + (front === 1 ? 0 : -4.6 + 9.2 * i / (front - 1));
      var isEdge = edges && (i === 0 || i === front - 1);
      var outer = i === 0 || i === front - 1;
      add(isEdge ? (i === 0 ? "EL" : "ER") : "D" + (i + 1), isEdge || outer ? "E" : (front % 2 && i === (front - 1) / 2 ? "N" : "T"),
        isEdge ? "Outside linebacker on the edge" : outer ? "Defensive end" : (front % 2 && i === (front - 1) / 2 ? "Nose tackle" : "Defensive tackle"), x, 1);
    }
    var lbNames = [["M", "Mike linebacker"], ["W", "Will linebacker"], ["S", "Sam linebacker"], ["J", "Linebacker"], ["J", "Linebacker"]];
    var inBox = front;
    for (var l = 0; l < lbs; l++) {
      var apex = inBox >= box; // more linebackers than box spots: walk him out over the slot
      var lx = apex ? BX + (l % 2 ? -7.5 : 7.5) : BX + [0.6, -2.6, 3.4, -4.8, 4.8][l % 5];
      add("LB" + (l + 1), lbNames[l][0], lbNames[l][1] + (apex ? ", walked out" : ""), lx, apex ? 4 : 4.5);
      if (!apex) inBox++;
    }
    // Defensive backs: corners on the widest receivers, nickel and dime over the slots, safeties by shell.
    var wide = offP.filter(function (p) { return /^[XZHSFW]/.test(p.id) || p.id === "Y" || p.id === "Y2"; }).sort(function (a, b) { return a.x - b.x; });
    var leftW = wide.length ? wide[0] : { x: BX - 16 }, rightW = wide.length ? wide[wide.length - 1] : { x: BX + 16 };
    var press = MANISH[g], corners = Math.min(d.cb, 2) || 2, extra = Math.max(0, dbs - corners - Math.min(d.s, 2)), safeties = dbs - corners - extra;
    add("CBL", "CB", "Cornerback, left", leftW.x, press ? 1.5 : 6.5);
    if (corners > 1 || dbs > 1) add("CBR", "CB", "Cornerback, right", rightW.x, press ? 1.5 : 6.5);
    var slots = offP.filter(function (p) { return /^[HSF]$/.test(p.id); });
    for (var n = 0; n < extra; n++) {
      var sl = slots[n] || { x: BX + (n % 2 ? -8 : 8) };
      add(n ? "DB" + (n + 1) : "NB", n ? "DB" : "NB", n ? "Dime back" : "Nickel back", sl.x - Math.sign(sl.x - BX) * 0.8, r.blitzers ? 2 : 4);
    }
    var need = Math.max(0, box - inBox), sp = [];
    if (shell === "two") sp = [[BX - 9, 12.5], [BX + 9, 12.5]];
    else if (shell === "one") sp = [[BX, 13], [BX + 5.5, 8]];
    else sp = [[BX - 4, 7.5], [BX + 5, 6]];
    for (var k = 0; k < safeties; k++) {
      var down = k < need && k >= safeties - need; // the strong safety comes down into the box first
      var pos = sp[k] || [BX + 3, 10];
      if (down || (k === 1 && need > 0)) pos = [BX + (k ? 4.6 : -4.6), 5.5];
      add(k ? "SS" : "FS", k ? "SS" : "FS", k ? "Strong safety" : "Free safety", pos[0], pos[1]);
    }
    while (P.length < 11) add("X" + P.length, "LB", "Linebacker", BX + 2, 5);
    return P.slice(0, 11).sort(function (a, b) { return a.x - b.x; });
  }

  /* ---------- what the defense did ---------- */
  function actual(r, g, D, O, kind) {
    var post = {}, rushers = [], droppers = [], events = [];
    var front = D.filter(function (p) { return p.y <= 1; }), others = D.filter(function (p) { return p.y > 1; });
    var qb = O.filter(function (p) { return p.id === "QB"; })[0];
    if (kind === "run") {
      var rx = BX + ({ left: -5, right: 5 }[r.runLoc] || 0);
      D.forEach(function (p, i) {
        var deep = p.y > 9;
        post[p.id] = { x: r1(clamp(p.x + (rx - p.x) * (p.y <= 1 ? 0.35 : 0.55), 1, 52.3)), y: r1(p.y <= 1 ? -0.5 : deep ? 7 : 2) };
        if (p.y <= 1) rushers.push(p.id); else droppers.push(p.id);
      });
      events.push({ t: 0.2, text: "The front attacks its gaps. " + word(r.box || 7).replace(/^./, function (c) { return c.toUpperCase(); }) + " in the box." });
      events.push({ t: 0.8, text: "The linebackers and safeties fit the run " + (r.runLoc === "middle" ? "up the middle" : "to the " + r.runLoc) + "." });
      return { rushers: rushers, droppers: droppers, post: post, events: events, call: "gen-run-fit", coverage: r.coverage ? r.coverage + " behind the run fit" : "Run fit (coverage not charted on runs)", pressure: "run" };
    }
    var R = clamp(r.rushers || 4, 3, 8);
    var order = front.slice();
    var blitzOrder = others.filter(function (p) { return /^LB/.test(p.id); }).sort(function (a, b) { return Math.abs(a.x - BX) - Math.abs(b.x - BX); })
      .concat(others.filter(function (p) { return p.id === "NB" || /^DB/.test(p.id); }), others.filter(function (p) { return p.id === "SS"; }), others.filter(function (p) { return p.id === "FS"; }));
    var rushSet = order.slice(0, Math.min(R, order.length));
    // Fewer rushers than linemen: the extra lineman drops into coverage (simulated pressure); he's placed with the underneath droppers below.
    for (var b = 0; rushSet.length < R && b < blitzOrder.length; b++) rushSet.push(blitzOrder[b]);
    rushSet.forEach(function (p) {
      rushers.push(p.id);
      post[p.id] = { x: r1(p.x * 0.55 + qb.x * 0.45), y: r1(qb.y + 1.6) };
    });
    var cover = D.filter(function (p) { return rushers.indexOf(p.id) < 0; });
    var deepN = Math.min(DEEP[g], cover.length);
    var deepPick = cover.slice().sort(function (a, b) {
      function rank(p) { return /S$/.test(p.id) ? 0 : /^CB/.test(p.id) ? 1 : 2; }
      return rank(a) - rank(b) || b.y - a.y;
    });
    if (g === "three") deepPick = cover.filter(function (p) { return p.id === "FS"; }).concat(cover.filter(function (p) { return /^CB/.test(p.id); }), cover.filter(function (p) { return p.id === "SS"; }));
    var deep = deepPick.slice(0, deepN).sort(function (a, b) { return a.x - b.x; });
    var lanes = { 1: [[BX, 16, "Deep middle"]], 2: [[BX - 12, 16, "Deep half"], [BX + 12, 16, "Deep half"]],
      3: [[BX - 16, 15, "Deep third"], [BX, 16, "Deep middle third"], [BX + 16, 15, "Deep third"]],
      4: [[BX - 18, 14, "Deep quarter"], [BX - 6, 15, "Deep quarter"], [BX + 6, 15, "Deep quarter"], [BX + 18, 14, "Deep quarter"]] }[deepN] || [];
    deep.forEach(function (p, i) { droppers.push(p.id); post[p.id] = { x: r1(lanes[i][0]), y: lanes[i][1], zone: lanes[i][2] }; });
    var under = cover.filter(function (p) { return deep.indexOf(p) < 0; }).sort(function (a, b) { return a.x - b.x; });
    var targets = O.filter(function (p) { return !/^(LT|LG|C|RG|RT|QB|OL\d)$/.test(p.id); }).sort(function (a, b) { return a.x - b.x; });
    var names = ["Flat", "Curl", "Hook", "Hook", "Curl", "Flat", "Hook"];
    under.forEach(function (p, i) {
      if (droppers.indexOf(p.id) < 0) droppers.push(p.id);
      if (MANISH[g] && targets.length) {
        var t = targets.reduce(function (a, b) { return Math.abs(b.x - p.x) < Math.abs(a.x - p.x) ? b : a; });
        targets.splice(targets.indexOf(t), 1);
        post[p.id] = { x: r1(clamp(t.x, 1, 52.3)), y: 6, zone: "Man: " + t.label };
      } else {
        var zx = under.length === 1 ? BX : BX - 15 + 30 * i / (under.length - 1);
        post[p.id] = { x: r1(zx), y: 7, zone: under.length >= 5 ? names[i] : i === 0 || i === under.length - 1 ? "Curl-flat" : "Hook" };
      }
    });
    var blitzed = rushers.filter(function (id) { return !front.some(function (p) { return p.id === id; }); }).length;
    events.push({ t: 0.3, text: word(R).replace(/^./, function (c) { return c.toUpperCase(); }) + " rush" + (blitzed ? ", " + word(blitzed) + " of them off the second level" : R < front.length ? ": a lineman drops into coverage" : "") + "." });
    events.push({ t: 0.7, text: r.coverage + (MANISH[g] ? ": man coverage behind it." : ": zone behind it.") });
    return { rushers: rushers, droppers: droppers, post: post, events: events, call: CALL[r.coverage] || "gen-cover-3", coverage: r.coverage, pressure: ["", "", "", "four", "four", "five", "six", "six", "six"][R] };
  }

  /* ---------- options and their grades ---------- */
  function blockers(r) { return 5 + Math.max(0, (r.ol || 5) - 5) + Math.min(2, +r.offPers[1]) + (r.fb || 0); }
  function runWindow(c, r, box) {
    var R = RUN[c], adv = blockers(r) - box, w = R.base + R.per * adv;
    if (c === "sneak") w = r.dist <= 1 ? 0.8 + 0.02 * adv : 0.2;
    if (c === "power" && r.dist <= 2) w += 0.06;
    if (c === "draw") w += (r.dist >= 7 ? 0.08 : -0.06);
    if (r.yl100 <= 5 && c !== "sneak") w -= 0.06;
    return clamp(w, 0.08, 0.92);
  }
  function passWindow(c, g, r, data) {
    var w = data.matrix[c][g][0], box = r.box || 7;
    if (c === "pa-shot") w += box >= 8 ? 0.08 : box <= 6 ? -0.08 : 0; // the fake only works if they're loaded up to stop the run
    if (r.yl100 <= 20) w += { verts: -0.2, "pa-shot": -0.15, dagger: -0.1, fade: 0.1, mesh: 0.04, quick: 0.02 }[c] || 0;
    return clamp(w, 0.05, 0.95);
  }
  function hold(blk, R) { return blk >= R ? clamp(2.6 + 0.4 * (blk - R), 1.2, 3.9) : clamp(1.5 - 0.2 * (R - blk - 1), 0.9, 1.5); }
  function needYards(r) { return r.yl100 <= r.dist ? r.dist : r.down === 1 ? Math.ceil(r.dist * 0.4) : r.down === 2 ? Math.ceil(r.dist * 0.6) : r.dist; }
  function pAtLeast(mid, spread, need) {
    if (spread <= 0) return mid >= need ? 1 : 0;
    var lo = mid - spread, hi = mid + spread;
    var n = hi - lo + 1, ok = 0;
    for (var y = lo; y <= hi; y++) if (y >= need) ok++;
    return ok / n;
  }
  // Chance an option succeeds (gets the yards this down needs), before the snap: shell prior, rush the box can send.
  function processOdds(c, r, shell, data, box) {
    var need = needYards(r);
    if (RUN[c] && runRate(c, r, box)) return runRate(c, r, box).rate;
    if (PASS[c] && M) {
      var pr = coveragePrior(r, shell, box), t = 0, w = 0;
      Object.keys(pr).forEach(function (g) { var x = passRate(c, r, g, box); if (x) { t += pr[g] * x.rate; w += pr[g]; } });
      if (w > 0.5) return t / w;
    }
    if (RUN[c]) {
      var R = RUN[c], w = runWindow(c, r, box);
      return 0.85 * w * pAtLeast(R.yards, R.spread, need) + (1 - 0.85 * w) * pAtLeast(R.failYards, R.failSpread, need);
    }
    var P = PASS[c], rushes = box >= 7 ? [[4, 0.5], [5, 0.35], [6, 0.15]] : [[4, 0.7], [5, 0.25], [6, 0.05]], total = 0;
    Object.keys(PRIOR[shell]).forEach(function (g) {
      rushes.forEach(function (rr) {
        var h = hold(6, rr[0]), w = passWindow(c, g, r, data);
        if (c === "screen" && rr[0] >= 5) w += 0.1;
        var timing = h >= P.need ? 1 : P.hot ? 0.7 : 0.35;
        total += PRIOR[shell][g] * rr[1] * 0.85 * w * timing * pAtLeast(P.yards, P.spread, need);
      });
    });
    return total;
  }

  // The window that makes a rep succeed as often as the real rate against what the defense actually did:
  // success = window x (the critical assignments holding up), plus the small luck and failed-but-enough cases.
  function calibrate(target, asg, luck, failOk) {
    var crit = asg.filter(function (a) { return a.critical; }).reduce(function (m, a) { return m * Math.min(1, a.p + (a.keyBonus || 0)); }, 1);
    var q = luck + (1 - luck) * failOk;
    target = Math.min(0.97, target + 0.03); // the sim loses about 3 points to pressure and interceptions; measured over all film snaps
    return Math.round(clamp((target - q) / (1 - q) / crit, 0.05, 0.95) * 100) / 100;
  }

  function pick(O, ids) { for (var i = 0; i < ids.length; i++) { var p = O.filter(function (x) { return x.id === ids[i]; })[0]; if (p) return p; } return O.filter(function (x) { return x.id === "QB"; })[0]; }
  function nearest(D, x, y, filter) {
    var c = D.filter(filter || function () { return true; });
    if (!c.length) c = D;
    return c.reduce(function (a, b) { return Math.hypot(b.x - x, b.y - y) < Math.hypot(a.x - x, a.y - y) ? b : a; });
  }

  function plays(r, g, shell, data, O, D, act) {
    var box = r.box || 7, runX = BX + ({ left: -5, right: 5 }[r.runLoc] || 0);
    var menu = (MENU[r.situation] || MENU["first-ten"]).slice();
    if (r.dist <= 1 && menu.indexOf("sneak") < 0 && (r.down >= 3 || r.yl100 <= 3)) menu[1] = "sneak";
    var mike = nearest(D, BX, 4.5, function (p) { return /^LB/.test(p.id); });
    var fs = D.filter(function (p) { return p.id === "FS"; })[0] || nearest(D, BX, 15);
    var X = pick(O, ["X", "Z", "Y"]), Z = pick(O, ["Z", "H", "Y", "X"]), H = pick(O, ["H", "Y", "S", "F", "Z"]), Y = pick(O, ["Y", "H", "F", "S"]), RB = pick(O, ["RB", "FB", "F"]);
    var flatD = nearest(D, H.x, 3, function (p) { return p.y > 1; }), cbR = D.filter(function (p) { return p.id === "CBR"; })[0] || nearest(D, Z.x, 6);
    var actualW = function (c) { return MANISH[g] !== undefined || GROUP[r.coverage] ? passWindow(c, g, r, data) : passWindow(c, g, r, data); };
    var out = menu.map(function (c) {
      var concept = data.concepts[c], why, routes = [], key, asg, opt;
      var odds = processOdds(c, r, shell, data, box);
      if (RUN[c]) {
        var R = RUN[c], adv = blockers(r) - box;
        key = nearest(D, runX, 4.5, function (p) { return p.y > 1 && p.y < 9; });
        why = word(box).replace(/^./, function (s) { return s.toUpperCase(); }) + " in the box against " + word(blockers(r)) + " blockers: " +
          (adv > 0 ? "you have more blockers than they have defenders. That's a run look." : adv === 0 ? "even numbers, so the back has to beat one man." : "they have " + word(-adv) + " more defender" + (adv < -1 ? "s" : "") + " than you can block, and the extra man makes the tackle.") + " " + first(concept.plain) + ".";
        if (c === "sneak") why = r.dist <= 1 ? "A yard or less: the sneak is the highest-percentage play in football for one yard. The quarterback is already at the line." : "The sneak gets a yard. This needs " + r.dist + ".";
        var tx = c === "outside-zone" ? BX + 9 : c === "sneak" ? BX : runX;
        routes = [{ from: c === "sneak" ? "QB" : RB.id, path: [[(c === "sneak" ? BX : RB.x), c === "sneak" ? -0.5 : -2], [tx, 1], [tx, 6]] }];
        asg = [
          { player: c === "sneak" ? "C" : "LG", assignment: c === "power" ? "Pull and kick out the end man on the line" : c === "sneak" ? "Drive the nose tackle off the ball" : "Combo the down lineman up to the linebacker", key: nearest(D, BX, 1).id, win: "Wins at the point of attack", fail: "Gets stood up; the hole closes", p: 0.8, critical: true },
          { player: c === "sneak" ? "QB" : RB.id, assignment: c === "sneak" ? "Follow the center, get low, get the yard" : "Read the " + key.role.split(",")[0].toLowerCase() + " and hit the hole he leaves", key: key.id, win: "Picks the right hole", fail: "Runs into the unblocked defender", p: 0.8, keyBonus: 0.08, critical: true }
        ];
        opt = { kind: "run", need: 0, window: r1(runWindow(c, r, box) * 100) / 100, yards: Math.max(R.yards, needYards(r) + R.spread), spread: R.spread, failYards: R.failYards, failSpread: R.failSpread, luck: 0.04 };
        var rr = runRate(c, r, box);
        if (rr) opt.window = calibrate(rr.rate, asg, 0.04, pAtLeast(opt.failYards, opt.failSpread, needYards(r)));
        var dl = dataLine(c, r, null, box);
        if (dl) why += " " + dl;
        opt.data = !!dl;
      } else {
        var P = PASS[c], w = passWindow(c, g, r, data);
        if (c === "screen" && (r.rushers || 4) >= 5) w += 0.1;
        var cp = coveragePrior(r, shell, box), pri = Object.keys(cp).sort(function (a, b) { return cp[b] - cp[a]; }).slice(0, 2);
        why = first(concept.plain) + ". From this look (" + shell + "-high, " + word(box) + " in the box), defenses " + (M ? "played" : "usually play") + " " + pri.map(function (k) { return { zero: "Cover 0", man: "Cover 1", twoMan: "2-Man", two: "Cover 2", three: "Cover 3", quarters: "quarters" }[k]; }).join(" or ") +
          (M && pri[0] ? " most (" + pct(cp[pri[0]]) + " of the time since 2023)" : "") + ". " + data.matrix[c][pri[0]][1];
        if (shell === "zero") why = first(concept.plain) + ". " + data.matrix[c].zero[1];
        key = { quick: flatD, smash: cbR, mesh: mike, dagger: mike, verts: fs, "pa-shot": fs, fade: cbR, screen: mike }[c];
        var rec = { quick: [Z, [[Z.x - 3.5, 5]]], smash: [H, [[H.x, 8], [H.x + 4, 13]]], mesh: [Y, [[BX, 3.5], [BX - 9, 4]]], dagger: [Z, [[Z.x, 14], [BX + 2, 14.5]]],
          verts: [H, [[H.x, 18]]], "pa-shot": [Z, [[Z.x, 12], [Z.x - 7, 20]]], fade: [X, [[X.x + 1.5, 18]]], screen: [RB, [[RB.x + 4, -2], [RB.x + 7, 1]]] }[c];
        routes = [{ from: rec[0].id, path: rec[1] }];
        if (c === "quick" && H.id !== Z.id) routes.push({ from: H.id, path: [[H.x + 4, 2]] });
        if (c === "smash" && Z.id !== H.id) routes.push({ from: Z.id, path: [[Z.x, 5], [Z.x - 0.5, 4.5]] });
        if (c === "mesh" && H.id !== Y.id) routes.push({ from: H.id, path: [[BX, 3], [BX + 10, 3]] });
        if (c === "dagger" && H.id !== Z.id) routes.push({ from: H.id, path: [[H.x, 18]] });
        if (c === "verts") [X, Z, Y].forEach(function (p) { if (p.id !== H.id) routes.push({ from: p.id, path: [[p.x, 18]] }); });
        if (c === "pa-shot") routes.push({ from: X.id, path: [[X.x, 18]] });
        asg = [
          { player: "QB", assignment: "Read the " + key.role.split(",")[0].toLowerCase() + " and throw away from him on time", key: key.id, win: "Throws on rhythm to the open side", fail: "Throws where the " + key.role.split(",")[0].toLowerCase() + " is", p: 0.82, keyBonus: 0.08, critical: true },
          { player: rec[0].id, assignment: { quick: "Slant inside, win leverage on the third step", smash: "Corner route over the hitch", mesh: "Cross underneath and rub the man defenders", dagger: "Deep dig behind the linebackers", verts: "Seam up the middle", "pa-shot": "Post behind the safeties after the fake", fade: "Win the release and get on top", screen: "Sell the block, then catch it behind the line" }[c],
            key: (MANISH[g] ? nearest(D, rec[0].x, 3) : key).id, win: "Wins his route", fail: "Gets covered up", p: c === "screen" ? 0.8 : 0.78, critical: true }
        ];
        opt = { need: P.need, window: r1(w * 100) / 100, yards: Math.max(P.yards, needYards(r) + P.spread), spread: P.spread, intRisk: P.intRisk, luck: c === "verts" || c === "pa-shot" || c === "fade" ? 0.08 : 0.03 };
        var pr2 = passRate(c, r, g, box);
        if (pr2) { opt.window = calibrate(pr2.rate, asg, opt.luck, 0); w = opt.window; }
        var sh = { quick: 0.45, mesh: 0.45, screen: 0.5, smash: 0.3, dagger: 0.2 }[c];
        if (sh && needYards(r) > 2) { opt.short = sh; opt.shortYards = Math.max(1, needYards(r) - 3); }
        var dl2 = dataLine(c, r, Object.keys(coveragePrior(r, shell, box)).sort(function (a, b) { return coveragePrior(r, shell, box)[b] - coveragePrior(r, shell, box)[a]; })[0], box);
        if (dl2) why += " " + dl2;
        opt.data = !!dl2;
        if (P.hot) opt.hot = { window: r1(w * 0.85 * 100) / 100, yards: Math.max(3, Math.round(P.yards * 0.7)), spread: 2, text: "Ball out early to the quick route" };
      }
      return Object.assign({ id: c, concept: c, label: concept.name, detail: first(concept.plain) + ".", conflict: key.id, why: why, key: { answer: key.id, partial: {} }, routes: routes, assignments: asg, odds: odds }, opt);
    });
    // Grades: the best pre-snap odds earn the top grade; the rest are graded by how far behind they are.
    var best = Math.max.apply(null, out.map(function (o) { return o.odds; }));
    var worst = Math.min.apply(null, out.map(function (o) { return o.odds; }));
    var bigYards = out.slice().sort(function (a, b) { return (b.yards + b.spread) - (a.yards + a.spread); })[0];
    // Within 2 points of the best is a statistical tie: the data can't separate them, so they share the top grade.
    out.forEach(function (o) {
      var gap = Math.max(0, best - o.odds - 0.02);
      o.grade = Math.round(clamp(95 - 170 * gap, 25, 95));
      o.category = gap === 0 ? "recommended" : o.odds === worst && best - worst > 0.05 ? "poor" : o === bigYards ? "aggressive" : "valid";
      o.why += o.kind === "run" ? "" : o.data ? " Weighing the coverages this look really turns into, this call succeeds about " + pct(o.odds) + " of the time." : " Before the snap, this call succeeds about " + pct(o.odds) + " of the time from this look.";
      delete o.odds; delete o.data;
    });
    return out;
  }

  function protections(r, D, act, O) {
    var box = r.box || 7, R = r.kind === "pass" ? (r.rushers || 4) : 4, third = r.down >= 3 && r.dist >= 7;
    var threat = nearest(D, BX, 2.5, function (p) { return p.y > 1 && p.y < 6; });
    var edge = nearest(D, BX + 5, 1, function (p) { return p.y <= 1; });
    var tight = O.filter(function (p) { return /^Y/.test(p.id); })[0];
    var hasBack = O.some(function (p) { return /^(RB|FB)/.test(p.id); });
    var g5 = box <= 6 ? 92 : box === 7 ? 75 : 60, g6 = box <= 6 ? 85 : box === 7 ? 92 : 88, g7 = (box <= 6 ? 62 : box === 7 ? 72 : 82) - (third ? 10 : 0);
    var list = [
      { id: "five", label: "Five-man protection, everyone else runs a route", detail: "The line blocks; the back releases. Any extra rusher is the quarterback's to beat with a quick throw.", blk: 5, grade: g5, hotPlan: true,
        why: box <= 6 ? "With " + word(box) + " in the box, five blockers plus a hot answer covers what can realistically come, and you get five receivers out." : word(box).replace(/^./, function (c) { return c.toUpperCase(); }) + " in the box is more than five can block: this only works if the ball comes out hot.",
        assignments: [{ player: "QB", assignment: "Beat any free rusher with a quick throw", key: threat.id, win: "Ball out before he arrives", fail: "Holds it; the free rusher gets there", p: 0.85 }] },
      { id: "six", label: "Six-man: the back stays in to block", detail: "The back checks the linebackers before releasing.", blk: 6, grade: g6,
        why: box >= 7 ? "With " + word(box) + " in the box, a sixth blocker picks up the linebacker who can come. One fewer route, but the right count." : "Sound, and safe. It costs a receiver against a box that can't send many more than five.",
        assignments: [{ player: hasBack ? pick(O, ["RB", "FB"]).id : "C", assignment: "Pick up the first linebacker who comes", key: threat.id, win: "Squares him up", fail: "Misses the blitzer", p: 0.88 }] },
      { id: "max", label: "Max protection: back and tight end stay in", detail: "Seven block; three receivers go out.", blk: tight ? 7 : 6, grade: Math.max(40, g7),
        why: box >= 8 ? "Everyone they can bring is blocked. Against " + word(box) + " in the box that's real, and play action pairs well with it." : "Seven blockers for a box of " + word(box) + ": safe, but you've taken receivers off the field" + (third ? " on a down where you need to get to the sticks." : "."),
        assignments: [{ player: tight ? tight.id : "RT", assignment: "Block the edge rusher", key: edge.id, win: "Walls him off", fail: "Gets beat inside", p: 0.9 }] }
    ];
    return list.map(function (p) {
      var o = { id: p.id, label: p.label, detail: p.detail, hold: r1(hold(p.blk, R)), grade: p.grade, category: p.grade >= 90 ? "recommended" : p.grade >= 75 ? "valid" : "safe", why: p.why, assignments: p.assignments };
      if (p.hotPlan) o.hotPlan = true;
      return o;
    });
  }

  function contingencies(menu) {
    function grades(f) { var o = {}; menu.forEach(function (c) { o[c] = f(c); }); return o; }
    var hot = { quick: 95, smash: 88, mesh: 90, screen: 80, dagger: 45, verts: 40, "pa-shot": 40, fade: 60 };
    var sight = { quick: 85, smash: 80, mesh: 80, screen: 60, dagger: 65, verts: 65, "pa-shot": 55, fade: 70 };
    return [
      { id: "built-in", label: "Built-in hot: if a rusher comes free, ball out to the quick route now", onPressure: "hot",
        grades: grades(function (c) { return RUN[c] ? 75 : hot[c]; }), why: "Quick game, smash and mesh carry their own hot answer. The deep concepts don't, and on a run the back's read is the answer." },
      { id: "sight", label: "Sight adjust: the slot converts to a slant against pressure", onPressure: "sight",
        throw: { window: 0.45, yards: 7, spread: 3, intRisk: 0.08, text: "Sight-adjusted slant" },
        grades: grades(function (c) { return RUN[c] ? 65 : sight[c]; }), why: "A real tool against man pressure; against zone pressure it can throw into the defender replacing the blitzer." },
      { id: "throwaway", label: "If the window closes, climb and throw it away", onPressure: "throwaway",
        grades: grades(function (c) { return RUN[c] ? 65 : 75; }), why: "A sound floor: an incompletion beats a sack. It isn't an answer to the pressure, just a way to survive it." },
      { id: "none", label: "Hold it: trust the protection", onPressure: "none",
        grades: grades(function (c) { return RUN[c] ? 70 : 25; }), why: "On a pass, trusting the protection against more rushers than blockers is how drives end. On a run it barely matters." }
    ];
  }

  function diagnosis(r, g, shell, D, act) {
    var pk = r.pkg, box = r.box || 7;
    var pkgOpt = [{ id: "heavy", label: "Goal line (3 or fewer DBs)" }, { id: "base", label: "Base (4 DBs)" }, { id: "nickel", label: "Nickel (5 DBs)" }, { id: "dime", label: "Dime (6+ DBs)" }];
    var pkgIdx = { heavy: 0, base: 1, nickel: 2, dime: 3, quarter: 3 }[pk];
    var pc = {}; pkgOpt.forEach(function (o, i) { pc[o.id] = i === pkgIdx ? 100 : Math.abs(i - pkgIdx) === 1 ? 40 : 0; });
    var sh = { zero: 0, one: 1, two: 2 }, sc = {};
    ["two", "one", "zero"].forEach(function (k) { sc[k] = k === shell ? 100 : Math.abs(sh[k] - sh[shell]) === 1 ? 40 : 0; });
    var bx = box <= 5 ? "5" : box >= 8 ? "8" : String(box), bc = {};
    ["5", "6", "7", "8"].forEach(function (k) { bc[k] = k === bx ? 100 : Math.abs(+k - +bx) === 1 ? 50 : 0; });
    var R = r.kind === "pass" ? clamp(r.rushers || 4, 4, 6) : box >= 8 ? 6 : box === 7 ? 5 : 4;
    var pr = { four: 0, five: 0, six: 0 }, rk = ["four", "five", "six"][R - 4];
    Object.keys(pr).forEach(function (k, i) { pr[k] = k === rk ? 100 : Math.abs(i - (R - 4)) === 1 ? 60 : 20; });
    var threats = D.filter(function (p) { return p.y <= 6 && !/^CB/.test(p.id); }).map(function (p) { return p.id; });
    var critical = act.rushers.filter(function (id) { return threats.indexOf(id) >= 0 && !D.filter(function (p) { return p.id === id && p.y <= 1; }).length; })[0] || threats[threats.length - 1];
    var dbs = (r.def7 ? r.def7.cb + r.def7.s : 5);
    return { questions: [
      { id: "personnel", prompt: "What defensive personnel is on the field?", kind: "single", options: pkgOpt, credit: pc, error: "personnel",
        explain: "Count the defensive backs: " + word(dbs) + ". That's " + { heavy: "a goal-line package", base: "base", nickel: "nickel", dime: "dime", quarter: "quarter (seven DBs)" }[pk] + " against your " + r.offPers + " personnel." },
      { id: "shell", prompt: "What safety shell is the defense showing?", kind: "single", options: [{ id: "two", label: "Two-high" }, { id: "one", label: "One-high" }, { id: "zero", label: "Zero (no deep safety)" }], credit: sc, error: "shell",
        explain: r.kind === "run" && !r.coverage ? "Coverage isn't charted on runs, so the shell drawn is inferred from the box: " + shell + "-high." : "The charted coverage was " + r.coverage + ", which starts from a " + shell + "-high shell. The drawing shows that shell; real defenses can rotate out of it." },
      { id: "box", prompt: "How many defenders are in the box?", kind: "single", options: [{ id: "5", label: "5 or fewer" }, { id: "6", label: "6" }, { id: "7", label: "7" }, { id: "8", label: "8 or more" }], credit: bc, error: "box-count",
        explain: "Charted: " + box + " in the box. You have " + blockers(r) + " run blockers (five linemen" + (blockers(r) > 5 ? " plus " + (blockers(r) - 5) + " tight end" + (blockers(r) > 6 ? "s and backs" : "") : "") + "). " + (blockers(r) > box ? "More blockers than defenders: a run look." : blockers(r) === box ? "Even numbers." : "They have more than you can block.") },
      { id: "rushers", prompt: "Tap every defender who could rush.", kind: "rushers", answer: threats, critical: critical, error: "pressure-count",
        explain: "Everyone within about 6 yards of the line who isn't a pressed corner can get to the quarterback in time: " + word(threats.length) + " defenders here." },
      { id: "pressure", prompt: "If you throw, how many will most likely rush?", kind: "single", options: [{ id: "four", label: "Four" }, { id: "five", label: "Five" }, { id: "six", label: "Six or more" }], credit: pr, error: "pressure-count",
        explain: r.kind === "pass" ? "Charted: " + (r.rushers || 4) + " rushed, " + (r.blitzers || 0) + " of them blitzers. Partial credit for one off: before the snap, the box only tells you what's possible." : "Nobody rushed (it was a run), so this is graded on the evidence: a box of " + box + " most often means a " + rk + "-man rush if you throw." }
    ] };
  }

  function motions(r, g, O, D, act) {
    var m = pick(O, ["H", "S", "F", "Z", "X", "Y"]);
    var to = m.x > BX ? BX - 8 : BX + 8;
    var follower = MANISH[g] ? nearest(D, m.x, 3, function (p) { return p.y > 1 && !/^D\d|^E[LR]/.test(p.id); }) : null;
    var moves = {};
    if (follower) moves[follower.id] = [r1(to + (follower.x > m.x ? 0.8 : -0.8)), follower.y];
    else { var lb = nearest(D, BX, 4.5, function (p) { return /^LB/.test(p.id); }); moves[lb.id] = [r1(lb.x + (to > m.x ? 1.2 : -1.2)), lb.y]; }
    var known = r.kind === "pass" || r.coverage;
    return [
      { id: "none", label: "No motion", text: "Snap it. You keep your formation and the defense keeps its secrets." },
      { id: "jet", label: "Motion " + m.label + " across the formation", detail: "The " + m.role.split(",")[0].toLowerCase() + " runs across before the snap.", path: { from: m.id, to: [r1(to), -1.8] }, moves: moves,
        text: (follower ? "The " + follower.role.split(",")[0].toLowerCase() + " ran with him across the formation: that points to man coverage." : "Nobody ran with him; the linebackers just bumped over a step. That points to zone.") + " Evidence, not proof: defenses fake both." + (known ? "" : " (Inferred: coverage wasn't charted on this run.)"),
        clue: follower ? "On motion a defender traveled with the receiver: man coverage." : "On motion nobody traveled, the linebackers bumped: zone." }
    ];
  }

  function clues(r, g, shell) {
    var box = r.box || 7, b = blockers(r), out = [];
    out.push({ text: word(box).replace(/^./, function (c) { return c.toUpperCase(); }) + " in the box against " + word(b) + " run blockers. " + (b > box ? "The numbers favor the run." : b === box ? "Even numbers." : "They can outnumber your run blocking."), kind: "meaningful" });
    out.push({ text: shell.replace(/^./, function (c) { return c.toUpperCase(); }) + "-high shell before the snap.", kind: r.kind === "pass" ? "meaningful" : "uncertain" });
    if (r.kind === "pass") {
      if ((r.blitzers || 0) > 0) out.push({ text: "A second-level defender lined up close enough to blitz, and did.", kind: "meaningful" });
      if ((r.rushers || 4) <= 4 && box >= 7) out.push({ text: "The loaded box looked like pressure; only " + word(r.rushers || 4) + " rushed.", kind: "deceptive" });
      if (MANISH[g]) out.push({ text: "Pressed corners: man coverage is likely, but press can bail into zone.", kind: "uncertain" });
    } else out.push({ text: "Coverage isn't charted on runs; the shell is inferred from the box.", kind: "uncertain" });
    return out;
  }

  /* One real snap in, one schema-valid scenario out. */
  function build(data, real, r) {
    var teams = real.teams || {};
    var off = teams[r.off] || r.off, def = teams[r.def] || r.def;
    var g = GROUP[r.coverage] || ((r.box || 7) >= 8 ? "three" : "quarters");
    var shell = SHELL[g];
    var O = offense(r), D = defense(r, g, O), act = actual(r, g, D, O, r.kind);
    // Near the goal line nobody lines up, drops or runs past the end line.
    var cap = r.yl100 <= 25 ? r.yl100 + 9.5 : 99;
    D.forEach(function (p) { p.y = Math.min(p.y, cap - 1.5); });
    Object.keys(act.post).forEach(function (id) { act.post[id].y = Math.min(act.post[id].y, cap); });
    var P = plays(r, g, shell, data, O, D, act);
    P.forEach(function (p) { p.routes.forEach(function (rt) { rt.path = rt.path.map(function (q) { return [q[0], Math.min(q[1], cap)]; }); }); });
    var menu = P.map(function (p) { return p.id; });
    var prot = protections(r, D, act, O);
    var bestProt = prot.slice().sort(function (a, b) { return b.grade - a.grade; })[0].id;
    var bestPlay = P.filter(function (p) { return p.category === "recommended"; })[0].id;
    var yl = r.yl100 <= 50 ? r.yl100 : 100 - r.yl100, diff = r.offScore - r.defScore;
    var t = r.tendency || {}, sitLabel = (real.situations || {})[r.situation] || r.situation;
    var tidy = function (s) { return s.replace(/^./, function (c) { return c.toUpperCase(); }); };
    var interactions = [];
    if (menu.indexOf("mesh") >= 0) interactions.push({ when: { protection: "max", play: "mesh" }, window: -0.25, play: -15, note: "Max protection keeps the tight end in, and mesh needs two crossers." });
    ["dagger", "verts", "pa-shot"].forEach(function (c) { if (menu.indexOf(c) >= 0 && (r.box || 7) >= 7) interactions.push({ when: { protection: "five", play: c }, protection: -25, note: "Five-man protection on a long-developing route against a full box: nothing quick to throw if they bring one more." }); });
    menu.forEach(function (c) { if (RUN[c]) interactions.push({ when: { play: c }, note: "On a run the protection call doesn't matter: the line is run blocking." }); });
    var pers = { "10": "1 back, 0 tight ends, 4 receivers", "11": "1 back, 1 tight end, 3 receivers", "12": "1 back, 2 tight ends, 2 receivers", "13": "1 back, 3 tight ends, 1 receiver",
      "21": "2 backs, 1 tight end, 2 receivers", "22": "2 backs, 2 tight ends, 1 receiver", "20": "2 backs, 0 tight ends, 3 receivers", "01": "no backs, 1 tight end, 4 receivers", "02": "no backs, 2 tight ends, 3 receivers", "23": "2 backs, 3 tight ends" }[r.offPers] || r.offPers;
    var pk = { heavy: "Goal line: three or fewer defensive backs", base: "Base: four defensive backs", nickel: "Nickel: five defensive backs", dime: "Dime: six defensive backs", quarter: "Quarter: seven defensive backs" }[r.pkg];
    var d7 = r.def7 || {};
    return {
      id: r.id, title: off + (r.home === r.off ? " vs " : " at ") + def,
      subtitle: (r.round ? r.round + ", " + r.season + " season" : "Week " + r.week + ", " + r.season) + " · " + sitLabel,
      module: "film-room", situation: r.situation, order: 1000, type: "adapted", status: "published", version: 1,
      provenance: {
        type: "adapted",
        label: "A real snap. The situation, personnel, box count, rush, coverage and result are NFL data. The exact alignment and which defenders rushed are drawn from them, not charted.",
        sources: ["nflverse play-by-play " + r.season, "nflverse participation (NGS) " + r.season, "FTN charting via nflverse " + r.season],
        fieldConfidence: { situation: "verified", personnel: "verified", result: "verified", box: "expert-charted", rush: r.kind === "pass" ? "expert-charted" : "unknown", coverage: r.coverage ? "expert-charted" : "inferred", alignment: "inferred", assignments: "inferred" },
        reviewer: "generated", notes: "Built by gen.js from the charted snap."
      },
      historical: { season: r.season, week: r.week, gameId: r.gameId, playId: String(r.playId), offense: r.off, defense: r.def, description: r.desc, result: r.result },
      real: r, teams: { off: r.off, def: r.def, offName: off, defName: def },
      context: {
        quarter: r.qtr, clock: r.clock, score: { you: r.offScore, opp: r.defScore }, down: r.down, distance: r.dist,
        yardLine: Math.max(1, yl), side: r.yl100 <= 50 ? "opp" : "own", hash: "middle",
        objective: (r.down >= 3 ? (r.yl100 <= r.dist ? "Score, or it's " + (r.down === 3 ? "a field goal try or fourth down" : "a turnover on downs") + "." : "Convert, or it's " + (r.down === 3 ? "fourth down" : "a turnover on downs") + ".") : r.down === 1 ? "Stay on schedule: 4 yards is a win." : "Get back on schedule: a manageable third down or better.") +
          (r.qtr >= 4 && diff <= 0 ? (diff < 0 ? " Down " + -diff : " Tied") + " in the " + (r.qtr > 4 ? "overtime" : "fourth quarter") + "." : ""),
        scouting: t.n ? "On " + sitLabel.toLowerCase() + " dropbacks in " + r.season + ", the " + def + " blitzed " + pct(t.blitz) + " of the time" + (t.top ? " and played " + t.top + " most (" + pct(t.topRate) + ")" : "") + ". Charting, " + t.n + " snaps." : "Not enough charted snaps to scout this defense here."
      },
      offense: { personnel: r.offPers, personnelText: r.offPers + " personnel: " + pers, formation: (r.formation || "Shotgun") + (r.offPers[0] === "2" && r.formation === "Under Center" ? " (I-formation family)" : ""), players: O },
      defense: { personnel: r.pkg, personnelText: pk, front: (d7.dl <= 3 && d7.olb >= 2 ? "Odd front: three down linemen with outside linebackers on the edges" : d7.dl + "-down front"), shell: shell + "-high", boxCount: r.box || 7, players: D },
      actual: { call: act.call, pressure: act.pressure, rushers: act.rushers, droppers: act.droppers, coverage: act.coverage,
        rotation: r.kind === "run" ? "It was a run: the defense fit the run. " + (r.coverage ? "Charted coverage behind it: " + r.coverage + "." : "Coverage isn't charted on runs.") : (r.coverage + ", " + (r.manZone || (MANISH[g] ? "man" : "zone")) + " coverage, " + (r.rushers || 4) + " rushers (charted). Which defenders rushed is drawn from that count."),
        post: act.post, events: act.events },
      diagnosis: diagnosis(r, g, shell, D, act),
      motions: motions(r, g, O, D, act),
      protections: prot, plays: P, contingencies: contingencies(menu), interactions: interactions,
      recommended: { motion: "none", protection: bestProt, play: bestPlay, contingency: "built-in" },
      clues: clues(r, g, shell),
      next: t.n && t.top ? "On " + sitLabel.toLowerCase() + " in " + r.season + ", the " + def + " played " + t.top + " on " + pct(t.topRate) + " of dropbacks. Expect it again, and have the call that beats it ready." : "Next time you see this look, count the box first.",
      takeaway: data.situations[r.situation] || "Count the box, read the shell, then call it.",
      learning: { objectives: ["Read the box and the shell", "Pick the call for the down and distance"], tags: ["situational", r.kind === "run" ? "run-vs-box" : "coverage-id"], misconceptions: [], difficulty: 2, transfer: [], revisitDays: 3 }
    };
  }

  return { build: build, GROUP: GROUP, processOdds: processOdds, blockers: blockers, passRate: passRate, runRate: runRate, dataLine: dataLine, model: function () { return M; } };
})(this));
