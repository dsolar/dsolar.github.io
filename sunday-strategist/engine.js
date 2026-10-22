/* Sunday Strategist rules engine. Pure functions, no DOM: the page and the tests both use it.

   A snap resolves in four explainable stages (docs/ARCHITECTURE.md):
     1. structure   does the call create a window against what the defense actually did?
     2. timing      does the protection last as long as the concept needs?
     3. execution   does each player who has to hold up, hold up? (seeded rolls)
     4. variance    the catch, the yards, the occasional low-odds play
   Every result carries the reason it happened. A seed makes a rep repeatable; expected()
   runs the same call hundreds of times so a good call can be told apart from a lucky one. */
(function (root, api) {
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SS_ENGINE = api;
})(this, (function (root) {
  var CONF = { guess: 0.25, some: 0.5, strong: 0.75, certain: 0.95 };
  var CATEGORY_ORDER = ["recommended", "high-floor", "aggressive", "conservative", "valid", "safe", "risky", "poor"];
  var CATEGORY_LABEL = {
    recommended: "Recommended", "high-floor": "High floor", aggressive: "Aggressive", conservative: "Conservative",
    valid: "Valid", safe: "Safe", risky: "Risky", poor: "Poor fit"
  };
  // The error taxonomy: every wrong answer is filed under one of these, and the next scenario is chosen by them.
  var ERRORS = {
    personnel: "Personnel misidentification",
    shell: "Shell misidentification",
    "pressure-count": "Pressure-count error",
    "protection-count": "Protection-count error",
    "conflict-defender": "Wrong conflict defender",
    "concept-protection": "Concept-protection mismatch",
    "missing-answer": "Missing post-snap answer",
    "replacement-defender": "Threw into the replacement defender",
    "box-count": "Box-count error",
    "dc-read": "Misread what the offense was likely to run",
    "dc-personnel": "Personnel mismatch on defense",
    "dc-call": "Pressure or coverage mismatch",
    overconfidence: "Coverage overconfidence"
  };

  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function roll(r, mid, spread) { return Math.round(mid - spread + r() * (2 * spread)); }
  function player(sc, id) { return byId(sc.offense.players, id) || byId(sc.defense.players, id); }
  function role(sc, id) { var p = player(sc, id); return p ? p.role.split(",")[0] : id; }
  function letter(n) {
    if (n >= 97) return "A+"; if (n >= 93) return "A"; if (n >= 90) return "A-";
    if (n >= 87) return "B+"; if (n >= 83) return "B"; if (n >= 80) return "B-";
    if (n >= 77) return "C+"; if (n >= 73) return "C"; if (n >= 70) return "C-";
    if (n >= 60) return "D"; return "F";
  }

  function choices(sc, pick) {
    var c = {
      motion: byId(sc.motions, pick.motion || "none"),
      protection: byId(sc.protections, pick.protection),
      play: byId(sc.plays, pick.play),
      contingency: byId(sc.contingencies, pick.contingency)
    };
    ["motion", "protection", "play", "contingency"].forEach(function (k) { if (!c[k]) throw new Error("Unknown " + k + ": " + pick[k]); });
    return c;
  }

  // Interactions are the scenario's own notes on how two choices combine (max protection keeps your stick runner in, etc.).
  function interactions(sc, pick) {
    var m = { hold: 0, window: 0, need: 0, play: 0, protection: 0, notes: [] };
    (sc.interactions || []).forEach(function (x) {
      var w = x.when || {};
      for (var k in w) if ((pick[k] || (k === "motion" ? "none" : null)) !== w[k]) return;
      m.hold += x.hold || 0; m.window += x.window || 0; m.need += x.need || 0;
      m.play += x.play || 0; m.protection += x.protection || 0;
      m.notes.push(x.note);
    });
    return m;
  }

  function scoreDiagnosis(sc, answers) {
    answers = answers || {};
    var items = sc.diagnosis.questions.map(function (q) {
      var mine = answers[q.id], credit, correct, yours, note = "";
      if (q.kind === "rushers") {
        mine = (mine || []).filter(function (id) { return byId(sc.defense.players, id); });
        var hit = mine.filter(function (id) { return q.answer.indexOf(id) >= 0; });
        var extra = mine.filter(function (id) { return q.answer.indexOf(id) < 0; });
        credit = clamp(Math.round(100 * hit.length / q.answer.length - 15 * extra.length), 0, 100);
        if (mine.indexOf(q.critical) < 0) { credit = Math.min(credit, 50); note = "You left out the " + role(sc, q.critical).toLowerCase() + ", the threat this whole play is about."; }
        else if (extra.length) note = "Too many: " + extra.map(function (id) { return role(sc, id).toLowerCase(); }).join(", ") + " can't get home in time.";
        yours = mine.length ? mine.map(function (id) { return player(sc, id).label; }).join(", ") : "None picked";
        correct = q.answer.map(function (id) { return player(sc, id).label; }).join(", ");
      } else {
        credit = (q.credit || {})[mine] || 0;
        var o = byId(q.options, mine), best = q.options.filter(function (o) { return q.credit[o.id] === 100; })[0];
        yours = o ? o.label : "No answer"; correct = best.label;
      }
      return { id: q.id, prompt: q.prompt, yours: yours, correct: correct, credit: credit, explain: q.explain, note: note, error: credit < 70 ? q.error : null };
    });
    var score = Math.round(items.reduce(function (a, b) { return a + b.credit; }, 0) / items.length);
    var c = CONF[answers.confidence], calibration = { level: answers.confidence || null, kind: "none", text: "" };
    if (c != null) {
      if (c >= 0.75 && score < 60) calibration = { level: answers.confidence, kind: "overconfident", text: "A high-confidence miss. That's a misconception worth fixing, not just a gap: the next rep will push back on it." };
      else if (c <= 0.25 && score >= 80) calibration = { level: answers.confidence, kind: "underconfident", text: "You called it a guess and got it right. You know more than you're giving yourself credit for." };
      else if (c >= 0.75 && score >= 80) calibration = { level: answers.confidence, kind: "calibrated", text: "Confident and right. That's the goal." };
      else calibration = { level: answers.confidence, kind: "calibrated", text: "Your confidence matched your read." };
    }
    var errors = items.map(function (i) { return i.error; }).filter(Boolean);
    if (calibration.kind === "overconfident") errors.push("overconfidence");
    return { score: score, items: items, calibration: calibration, errors: unique(errors) };
  }
  function unique(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  /* One rep of the call against what the defense actually did. */
  function resolve(sc, pick, seed) {
    var r = rng(seed == null ? 1 : seed), ch = choices(sc, pick), P = ch.protection, C = ch.play, K = ch.contingency;
    var m = interactions(sc, pick), run = C.kind === "run", ctx = sc.context;
    var hold = Math.max(0.3, P.hold + m.hold), need = Math.max(0, C.need + m.need);
    var keyRight = pick.key === C.key.answer;
    var beat = !run && hold < need;
    var route = { window: clamp(C.window + m.window, 0.02, 0.98), yards: C.yards, spread: C.spread || 0, intRisk: C.intRisk || 0, text: C.label, early: false };
    var pressure = null, hotMissing = false;
    if (beat) {
      if (K.onPressure === "hot" && C.hot) { pressure = "hot"; route = { window: C.hot.window, yards: C.hot.yards, spread: C.hot.spread || 0, intRisk: C.intRisk || 0, text: C.hot.text, early: true }; }
      else if (K.onPressure === "sight") { pressure = "sight"; route = { window: K.throw.window, yards: K.throw.yards, spread: K.throw.spread || 0, intRisk: K.throw.intRisk || 0, text: K.throw.text, early: true }; }
      else if (K.onPressure === "throwaway") pressure = "throwaway";
      else { hotMissing = K.onPressure === "hot"; pressure = r() < 0.7 ? "sack" : "hurried"; }
    }

    // Who had to hold up: the protection's people (pass plays only), then the concept's.
    var cards = [];
    // The first protection assignment is the weak point: it fails when the rush beats the timing,
    // unless the plan was to throw hot off that rusher and the ball came out.
    if (!run) P.assignments.forEach(function (a, i) {
      cards.push(card(sc, a, i > 0 || !beat || (P.hotPlan && route.early), "protection", a.p));
    });
    C.assignments.forEach(function (a) {
      var p = a.p + (a.keyBonus && keyRight ? a.keyBonus : 0);
      if (beat && a.player === "QB" && !route.early) p -= 0.2;
      var held = r() < clamp(p, 0, 1);
      cards.push(card(sc, a, held, "concept", clamp(p, 0, 1), a.critical));
    });

    var kind, yards = 0, luck = false, decisive;
    var throwT = route.early ? Math.max(0.6, hold - 0.1) : need;
    var critFail = cards.filter(function (c) { return c.source === "concept" && c.critical && !c.held; })[0];
    if (pressure === "sack") {
      kind = "sack"; yards = roll(r, -7, 2);
      decisive = "The " + role(sc, P.assignments[0].key).toLowerCase() + " got home at " + hold.toFixed(1) + "s. The routes needed " + need.toFixed(1) + "s" + (hotMissing ? ", and this call has no quick route for a hot throw." : ", and there was no hot answer.");
    } else if (pressure === "hurried") {
      kind = r() < route.intRisk * 1.5 ? "int" : "incomplete";
      decisive = "Pressure arrived at " + hold.toFixed(1) + "s, before the concept was ready at " + need.toFixed(1) + "s. The quarterback threw it under duress.";
    } else if (pressure === "throwaway") {
      kind = "throwaway";
      decisive = "Pressure arrived at " + hold.toFixed(1) + "s, before the routes were ready. The quarterback climbed and threw it away: no sack, no first down.";
    } else {
      var structural = r() < route.window;
      var ok = !critFail && structural;
      if (!ok && r() < (C.luck || 0)) { ok = true; luck = true; }
      if (ok) {
        kind = run ? "run" : "complete"; yards = roll(r, route.yards, route.spread);
        if (luck) decisive = "A low-odds win: a player made a play the structure didn't give him. Enjoy it; don't plan on it.";
        else decisive = (route.early ? route.text + " beat the pressure." : "The window was there and everyone who had to hold up did.") + " " + C.why.split(". ")[0] + ".";
      } else if (run) {
        kind = "run"; yards = roll(r, C.failYards || 0, C.failSpread || 0);
        decisive = critFail ? critFail.player + ": " + critFail.fail + "." : "The " + role(sc, C.conflict).toLowerCase() + " was in the lane.";
      } else {
        kind = r() < route.intRisk ? "int" : "incomplete";
        if (kind === "incomplete" && C.short && !route.early && r() < C.short) { kind = "complete"; yards = roll(r, C.shortYards, 1); }
        decisive = critFail ? critFail.player + ": " + critFail.fail + "." : "The window closed: the " + role(sc, C.conflict).toLowerCase() + " was right where the ball was going.";
      }
    }
    var td = ctx.side === "opp" && yards >= ctx.yardLine;
    if (td) yards = ctx.yardLine;
    var first = !td && yards >= ctx.distance && kind !== "sack";

    var timeline = [{ t: 0, text: "Snap." }].concat(sc.actual.events.slice());
    if (run) timeline.push({ t: 1.0, text: "Handoff. The rush is upfield; the back looks for the lane." });
    else {
      if (beat) timeline.push({ t: hold, text: "Protection breaks: the " + role(sc, P.assignments[0].key).toLowerCase() + " is free." });
      else timeline.push({ t: Math.max(0, need - 0.01), text: "The pocket is still clean. The protection was good for " + hold.toFixed(1) + "s; the call needed " + need.toFixed(1) + "s." });
      if (pressure !== "sack" && pressure !== "throwaway") timeline.push({ t: throwT, text: route.early ? route.text + "." : "Ball out." });
    }
    var endT = run ? 2.2 : (pressure === "sack" ? hold + 0.3 : throwT + 0.5);
    timeline.push({ t: endT, text: summary(kind, yards, first, td) });
    timeline.sort(function (a, b) { return a.t - b.t; });

    return {
      seed: seed, kind: kind, yards: yards, firstDown: first, touchdown: td, turnover: kind === "int",
      luck: luck, pressure: pressure, beat: beat, hold: hold, need: need, window: route.window,
      throwText: route.text, cards: cards, timeline: timeline, decisive: decisive, notes: m.notes, mods: m
    };
  }
  function card(sc, a, held, source, p, critical) {
    return { player: a.player, role: role(sc, a.player), assignment: a.assignment, key: a.key, keyRole: role(sc, a.key), win: a.win, fail: a.fail, held: held, p: p, critical: !!critical || source === "protection", source: source };
  }
  function summary(kind, yards, first, td) {
    if (td) return "Touchdown.";
    if (kind === "sack") return "Sack, " + Math.abs(yards) + "-yard loss.";
    if (kind === "int") return "Intercepted.";
    if (kind === "incomplete") return "Incomplete.";
    if (kind === "throwaway") return "Thrown away.";
    var what = kind === "run" ? "Run" : "Complete";
    return what + " for " + yards + (yards === 1 ? " yard" : " yards") + (first ? ". First down." : ".");
  }

  function resultScore(rep, sc) {
    if (rep.touchdown) return 100;
    if (rep.kind === "int") return 0;
    if (rep.kind === "sack") return 15;
    if (rep.firstDown) return 95;
    if (rep.kind === "incomplete" || rep.kind === "throwaway") return 45;
    if (rep.yards <= 0) return 40;
    var share = rep.yards / sc.context.distance;
    return share >= 0.55 ? 78 : 60;
  }

  /* The same call, n times: the decision's real quality, separate from one roll of the dice. */
  // The game's success rule: 40% of the distance on 1st down, 60% on 2nd, all of it on 3rd and 4th (or a touchdown).
  function needYards(ctx) {
    var goal = ctx.side === "opp" && ctx.yardLine <= ctx.distance;
    return goal ? ctx.distance : ctx.down === 1 ? Math.ceil(ctx.distance * 0.4) : ctx.down === 2 ? Math.ceil(ctx.distance * 0.6) : ctx.distance;
  }
  function expected(sc, pick, n) {
    n = n || 400;
    var t = { first: 0, yards: 0, int: 0, sack: 0, big: 0, ok: 0 }, need = needYards(sc.context);
    for (var i = 1; i <= n; i++) {
      var x = resolve(sc, pick, i * 7919);
      if (x.firstDown || x.touchdown) t.first++;
      if (x.touchdown || (x.kind !== "int" && x.kind !== "sack" && x.yards >= need)) t.ok++;
      t.yards += x.yards;
      if (x.kind === "int") t.int++;
      if (x.kind === "sack") t.sack++;
      if (x.yards >= 20) t.big++;
    }
    return { n: n, convert: t.first / n, success: t.ok / n, need: need, avgYards: t.yards / n, turnover: t.int / n, sack: t.sack / n, explosive: t.big / n };
  }

  /* Everything the review screen shows, from structured facts only. */
  function review(sc, pick, answers, seed) {
    var ch = choices(sc, pick), rep = resolve(sc, pick, seed), m = rep.mods;
    var diag = scoreDiagnosis(sc, answers);
    var C = ch.play;
    var keyScore = pick.key === C.key.answer ? 100 : (C.key.partial && C.key.partial[pick.key] ? 50 : 0);
    var keyNote = keyScore === 100 ? "Right: on this call, the " + role(sc, C.key.answer).toLowerCase() + " decides where the ball goes."
      : (C.key.partial && C.key.partial[pick.key]) || "On this call the " + role(sc, C.key.answer).toLowerCase() + " decides where the ball goes.";
    var concept = clamp(C.grade + m.play, 0, 100);
    var grades = {
      diagnosis: diag.score,
      call: Math.round(0.8 * concept + 0.2 * keyScore),
      protection: clamp(ch.protection.grade + m.protection, 0, 100),
      contingency: ch.contingency.grades[C.id],
      execution: execution(rep),
      result: resultScore(rep, sc)
    };
    var process = Math.round((grades.diagnosis + grades.call + grades.protection + grades.contingency) / 4);
    var good = process >= 80, won = grades.result >= 75;
    var verdict = good && won ? { title: "Good call, good result", text: "The process earned it." }
      : good ? { title: "Good call, bad result", text: "The decision was right; this rep wasn't. Run it again and it converts more often than anything else on the board." }
      : won ? { title: "Bad call, good result", text: "It worked. Don't learn the wrong lesson: the same call fails more often than it works." }
      : { title: "Bad call, bad result", text: "The result matched the decision. The review shows where it turned." };

    var errors = diag.errors.slice();
    if (keyScore < 100) errors.push("conflict-defender");
    if (grades.protection < 70) errors.push("protection-count");
    if (grades.contingency < 50) errors.push("missing-answer");
    if (C.category === "poor" || (ch.contingency.onPressure === "sight" && rep.pressure === "sight")) errors.push("replacement-defender");
    if (m.play < -10) errors.push("concept-protection");

    var alts = sc.plays.map(function (p) {
      var alt = { motion: sc.recommended.motion, protection: sc.recommended.protection, contingency: sc.recommended.contingency, play: p.id, key: p.key.answer };
      return { id: p.id, label: p.label, category: p.category, categoryLabel: CATEGORY_LABEL[p.category], why: p.why, grade: p.grade, yours: p.id === pick.play, odds: expected(sc, alt, 300) };
    }).sort(function (a, b) { return CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || b.grade - a.grade; });

    return {
      rep: rep, diagnosis: diag, grades: grades, letters: map(grades, letter), process: process, verdict: verdict,
      key: { score: keyScore, note: keyNote, answer: C.key.answer, answerRole: role(sc, C.key.answer) },
      choices: ch, expected: expected(sc, pick, 400), alternatives: alts, errors: unique(errors)
    };
  }
  function execution(rep) {
    var cs = rep.cards.filter(function (c) { return c.critical; });
    if (!cs.length) return 70;
    return Math.round(100 * cs.filter(function (c) { return c.held; }).length / cs.length);
  }
  function map(o, f) { var out = {}; for (var k in o) out[k] = f(o[k]); return out; }

  /* Mastery: per skill tag, across sessions. Plain JSON so the page can keep it in localStorage. */
  function emptyRecord() { return { v: 1, tags: {}, scenarios: {}, errors: {} }; }
  function record(rec, sc, rv, now) {
    rec = rec && rec.v === 1 ? rec : emptyRecord();
    sc.learning.tags.forEach(function (t) {
      var x = rec.tags[t] || (rec.tags[t] = { seen: 0, total: 0, last: 0 });
      x.seen++; x.total += rv.process; x.last = now;
    });
    var s = rec.scenarios[sc.id] || (rec.scenarios[sc.id] = { plays: 0, best: 0, last: 0 });
    s.plays++; s.best = Math.max(s.best, rv.process); s.last = now;
    rv.errors.forEach(function (e) { rec.errors[e] = (rec.errors[e] || 0) + 1; });
    return rec;
  }
  function report(rec, data) {
    rec = rec || emptyRecord();
    var tags = Object.keys(data.tags).map(function (t) {
      var x = rec.tags[t];
      return { id: t, label: data.tags[t], seen: x ? x.seen : 0, level: x ? Math.round(x.total / x.seen) : null };
    });
    var errors = Object.keys(rec.errors).map(function (e) { return { id: e, label: ERRORS[e] || e, count: rec.errors[e] }; })
      .sort(function (a, b) { return b.count - a.count; });
    return { tags: tags, errors: errors };
  }
  /* What to play next: anything unseen first, then whatever is weakest and due for a revisit. */
  function next(data, rec, now, currentId) {
    rec = rec || emptyRecord();
    var pool = data.scenarios.filter(function (s) { return s.status === "published"; });
    var unseen = pool.filter(function (s) { return !rec.scenarios[s.id] && s.id !== currentId; }).sort(function (a, b) { return a.order - b.order; });
    if (unseen.length) return unseen[0].id;
    var best = null, bestScore = -Infinity;
    pool.forEach(function (s) {
      if (s.id === currentId && pool.length > 1) return;
      var mastery = s.learning.tags.reduce(function (a, t) { var x = rec.tags[t]; return a + (x ? x.total / x.seen : 0); }, 0) / s.learning.tags.length;
      var days = (now - ((rec.scenarios[s.id] || {}).last || 0)) / 86400000;
      var score = (100 - mastery) + 20 * Math.min(2, days / Math.max(1, s.learning.revisitDays));
      if (score > bestScore) { bestScore = score; best = s.id; }
    });
    return best || pool[0].id;
  }

  /* Real snaps (real-plays.js, from tools/strategist_real.py) replay a lesson in a real game.
     Facts come from the data; the drawing and the option grades come from the lesson. */
  function pct0(x) { return Math.round(x * 100) + "%"; }
  function fromReal(data, real, r) {
    var t = byId(data.scenarios, r.lesson);
    if (!t) return null;
    var s = JSON.parse(JSON.stringify(t)), teams = real.teams || {};
    var off = teams[r.off] || r.off, def = teams[r.def] || r.def;
    s.id = r.id; s.lesson = t.id; s.type = "adapted"; s.status = "published";
    s.title = off + (r.home === r.off ? " vs " : " at ") + def;
    s.subtitle = (r.round ? r.round + ", " + r.season + " season" : "Week " + r.week + ", " + r.season) + " · " + t.title;
    s.provenance = {
      type: "adapted",
      label: "A real snap. The situation, players, rush, coverage and result are NFL data. The pre-snap alignment on the field is drawn from the lesson, not charted.",
      sources: ["nflverse play-by-play " + r.season, "nflverse participation (NGS) " + r.season, "FTN charting via nflverse " + r.season],
      fieldConfidence: { situation: "verified", personnel: "verified", result: "verified", rush: "expert-charted", coverage: "expert-charted", alignment: "inferred", assignments: "inferred" },
      reviewer: "generated", notes: "Matched to the lesson by down, distance, coverage, rush count and blitz."
    };
    s.historical = { season: r.season, week: r.week, gameId: r.gameId, playId: String(r.playId), offense: r.off, defense: r.def, description: r.desc, result: r.result };
    s.real = r;
    s.teams = { off: r.off, def: r.def, offName: off, defName: def };
    var yl = r.yl100 <= 50 ? r.yl100 : 100 - r.yl100, diff = r.offScore - r.defScore;
    var late = r.qtr >= 4 ? (diff < 0 ? " Down " + -diff + " in the " + (r.qtr > 4 ? "overtime" : "fourth quarter") + "." : diff === 0 ? " Tied in the " + (r.qtr > 4 ? "overtime" : "fourth quarter") + "." : "") : "";
    s.context = {
      quarter: r.qtr, clock: r.clock, score: { you: r.offScore, opp: r.defScore }, down: r.down, distance: r.dist,
      yardLine: Math.max(1, yl), side: r.yl100 <= 50 ? "opp" : "own", hash: t.context.hash,
      objective: (r.down === 3 ? "Convert, or it's fourth down." : "Stay ahead of the chains: a first down is great, and 4 yards sets up a manageable third.") + late,
      scouting: r.tendency && r.tendency.n ? "The " + def + " blitzed on " + pct0(r.tendency.blitz) + " of third-down dropbacks in " + r.season +
        (r.tendency.coverage != null ? " and played " + r.coverage + " on " + pct0(r.tendency.coverage) : "") + " (charting, " + r.tendency.n + " snaps)." : t.context.scouting
    };
    return s;
  }
  /* Every playable scenario: the lessons, then real snaps interleaved across lessons (spaced and mixed). */
  function catalog(data, real) {
    var list = data.scenarios.slice(), seen = {};
    var gen = typeof module === "object" && module.exports ? require("./gen.js") : root.SS_GEN, film = 0;
    ((real && real.plays) || []).forEach(function (r) {
      var dl = r.lesson && /^def-/.test(r.lesson);
      if (!r.lesson || dl) { // film snaps, and the real snaps of defense-side lessons (played like film, tagged with their lesson)
        if (!gen) return;
        var g = gen.build(data, real, r);
        g.order = 1000 + film++;
        if (dl) g.dlesson = r.lesson;
        list.push(g);
        return;
      }
      var s = fromReal(data, real, r);
      if (!s) return;
      var k = seen[s.lesson] = (seen[s.lesson] || 0) + 1;
      s.order = byId(data.scenarios, s.lesson).order + 10 * k;
      list.push(s);
    });
    return list;
  }

  return {
    rng: rng, needYards: needYards, fromReal: fromReal, catalog: catalog, letter: letter, interactions: interactions, scoreDiagnosis: scoreDiagnosis, resolve: resolve,
    expected: expected, review: review, emptyRecord: emptyRecord, record: record, report: report, next: next,
    ERRORS: ERRORS, CATEGORY_LABEL: CATEGORY_LABEL
  };
})(this));
