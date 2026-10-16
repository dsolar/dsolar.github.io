/* Win Probability: game rules. No DOM in here, so it runs in the browser and in Node (tools/win_probability_check.js).
   Scenario data comes from data.js (window.WP_DATA), built from the data package by build_bank.py. */
(function (root) {
  "use strict";

  // ---------- tunables ----------
  const CLOSE = 1.0;        // options within this many points of win probability are a close call: full credit
  const TIERS = [           // by win probability given up versus the best option
    { id: "defensible", max: 2.5, points: 70, label: "Defensible" },
    { id: "costly", max: 5.0, points: 35, label: "Costly" },
    { id: "blunder", max: Infinity, points: 0, label: "Blunder" },
  ];
  const BONUS_POINTS = 25;
  // Letter grade follows decision points, with bonuses reported separately.
  const GRADES = [
    { g: "A+", min: 97, line: "An outstanding day on the sideline." },
    { g: "A", min: 90, line: "Excellent decisions. Keep the headset." },
    { g: "B", min: 80, line: "A strong game with room to sharpen a few calls." },
    { g: "C", min: 70, line: "Some good calls. A few worth reviewing." },
    { g: "D", min: 60, line: "Time to spend another week in the film room." },
    { g: "F", min: 0, line: "Your coordinator would like a word." },
  ];
  const AGGRESSION = { punt: 0, fg: 1, go: 2, kick: 0, two: 1, defend: 0, let: 1 };
  const SAFE_ORDER = ["punt", "fg", "kick", "defend", "go", "two", "let"]; // what the coordinator picks when the clock runs out

  // ---------- seeded randomness (Daily Challenge must match for everyone) ----------
  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(arr, rand) { return arr[Math.floor(rand() * arr.length)]; }
  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ---------- scenario helpers ----------
  function rankedOptions(s) {
    return Object.entries(s.opts).sort((a, b) => b[1] - a[1]);
  }
  function gapOf(s) {
    const r = rankedOptions(s);
    return r.length > 1 ? +(r[0][1] - r[1][1]).toFixed(1) : 0;
  }
  function optionLabel(s, key) {
    if (s.labels && s.labels[key]) return s.labels[key];
    switch (key) {
      case "go": return s.kind === "4th" && s.yl <= s.ytg ? "Go for the touchdown" : "Go for it";
      case "punt": return "Punt";
      case "fg": return `Kick the ${s.inputs && s.inputs.fgDist ? s.inputs.fgDist + "-yard " : ""}field goal`;
      case "kick": return "Kick the extra point";
      case "two": return "Go for two";
      case "let": return "Let them score";
      case "defend": return "Play defense";
      default: return key;
    }
  }
  function shortLabel(key) {
    return { go: "Go for it", punt: "Punt", fg: "Field goal", kick: "Extra point", two: "Go for two", let: "Let them score", defend: "Play defense" }[key] || key;
  }
  function gerund(key) {
    return { go: "Going for it", punt: "Punting", fg: "The field goal", kick: "Kicking the extra point", two: "Going for two", let: "Letting them score", defend: "Playing defense" }[key] || key;
  }
  function optionOrder(s) {
    const order = ["go", "fg", "punt", "two", "kick", "let", "defend"];
    return s.practice ? Object.keys(s.opts) : order.filter((k) => k in s.opts);
  }
  function safeChoice(s) {
    return SAFE_ORDER.find((k) => k in s.opts) || Object.keys(s.opts)[0];
  }

  // ---------- grading ----------
  function grade(s, choice) {
    const ranked = rankedOptions(s);
    const best = ranked[0][0];
    const bestWp = ranked[0][1];
    if (s.practice) {
      const correct = s.accepted.includes(choice);
      return { choice, best: s.answer, cost: 0, lost: 0, tier: correct ? "optimal" : "costly", tierLabel: correct ? "Good call" : "Review the situation", points: correct ? 100 : 35, direction: "same", practice: true };
    }
    const cost = Math.max(0, +(bestWp - s.opts[choice]).toFixed(1));
    let tier;
    if (s.disputed && (s.disputed.accepted || Object.keys(s.opts)).includes(choice)) tier = { id: choice === best ? "optimal" : "close", points: 100, label: choice === best ? "Optimal" : "Close call" };
    else if (cost < CLOSE) tier = choice === best ? { id: "optimal", points: 100, label: "Optimal" } : { id: "close", points: 100, label: "Close call" };
    else tier = Object.assign({}, TIERS.find((t) => cost < t.max));
    const lost = tier.id === "optimal" || tier.id === "close" ? 0 : cost;
    const direction = AGGRESSION[choice] < AGGRESSION[best] ? "conservative" : AGGRESSION[choice] > AGGRESSION[best] ? "aggressive" : "same";
    return { choice, best, cost, lost, tier: tier.id, tierLabel: tier.label, points: tier.points, direction };
  }

  function badgesFor(s, g, opts) {
    const out = [];
    const goEdge = s.opts.go != null ? s.opts.go - Math.max(s.opts.punt ?? -1, s.opts.fg ?? -1) : null;
    if (opts.timedOut) out.push({ id: "delay", label: "Delay of Game", note: "The clock ran out, so your coordinator made the safe call." });
    if (s.kind === "4th" && g.choice === "punt" && goEdge >= 5) out.push({ id: "coward_punt", label: "Coward Punt", note: "Going for it was worth " + goEdge.toFixed(1) + " more points." });
    if (s.kind === "4th" && g.choice === "fg" && s.opts.go - s.opts.fg >= 5) out.push({ id: "took_points", label: "Took the Points (They Took You)", note: "" });
    if (s.kind === "4th" && g.choice === "go" && g.best !== "go" && g.cost >= 5) out.push({ id: "loose_cannon", label: "Loose Cannon", note: "" });
    if (s.kind === "pat" && g.cost >= 3) out.push({ id: "folklore", label: "Coached by Folklore", note: "" });
    if (opts.outcome && opts.outcome.success === false && (g.tier === "optimal" || g.tier === "close")) out.push({ id: "bad_break", label: "Good Call, Bad Break", note: "" });
    if (opts.outcome && opts.outcome.success === true && g.cost >= 3) out.push({ id: "got_away", label: "Got Away With One", note: "" });
    return out;
  }

  // ---------- simulated outcome (never changes the grade) ----------
  function simulate(s, choice, rand) {
    const i = s.inputs || {};
    const r = rand();
    switch (choice) {
      case "go": {
        const p = (i.conv ?? 50) / 100;
        const scoreTry = s.yl <= s.ytg;
        return { success: r < p, text: r < p ? (scoreTry ? "Touchdown." : "Converted. First down.") : (scoreTry ? "Stopped short of the goal line." : "Stopped short. Turnover on downs."), p };
      }
      case "fg": {
        const p = (i.fgp ?? 80) / 100;
        return { success: r < p, text: r < p ? "It's good." : "No good.", p };
      }
      case "punt": return { success: null, text: "Punt away. Your defense takes the field.", p: null };
      case "kick": {
        const p = (i.xp ?? 94) / 100;
        return { success: r < p, text: r < p ? "Extra point is good." : "Extra point is no good.", p };
      }
      case "two": {
        const p = (i.two ?? 48) / 100;
        return { success: r < p, text: r < p ? "Two-point try is good." : "Two-point try fails.", p };
      }
      case "let": return { success: null, text: "They walk in. You get the ball back with time on the clock.", p: null };
      case "defend": return { success: null, text: "You make a stand at the goal line.", p: null };
      default: return { success: null, text: "", p: null };
    }
  }
  function processResultTag(g, outcome) {
    if (!outcome || outcome.success == null) return null;
    const good = g.tier === "optimal" || g.tier === "close" || g.tier === "defensible";
    if (good && outcome.success) return "Good call, good result";
    if (good && !outcome.success) return "Good call, bad break";
    if (!good && outcome.success) return "Bad call, got lucky";
    return "Bad call, punished";
  }

  // ---------- explanations ----------
  const f1 = (v) => (v == null ? "?" : (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, ""));
  function explain(s) {
    const i = s.inputs || {};
    const lines = [];
    if (s.kind === "4th" && s.model === "nfl4th") {
      if ("go" in s.opts) lines.push(`Going for it ${s.yl <= s.ytg ? "scores" : "converts"} about ${f1(i.conv)}% of the time. Make it and you're at ${f1(i.wpS)}% to win, miss and you're at ${f1(i.wpF)}%. That works out to ${f1(s.opts.go)}%.`);
      if ("fg" in s.opts) lines.push(`A ${i.fgDist}-yard field goal is good about ${f1(i.fgp)}% of the time: ${f1(i.wpM)}% if it's good, ${f1(i.wpX)}% if it isn't, so ${f1(s.opts.fg)}% overall.`);
      if ("punt" in s.opts) lines.push(`Punting leaves you at ${f1(s.opts.punt)}%.`);
    } else if (s.kind === "pat" && s.model === "nfl4th") {
      lines.push(`The extra point is good about ${f1(i.xp)}% of the time. A two-point try converts about ${f1(i.two)}%.`);
      lines.push(`After this try you're at ${f1(i.wp0)}% to win with no points, ${f1(i.wp1)}% with one, ${f1(i.wp2)}% with two. Kicking is worth ${f1(s.opts.kick)}%; going for two, ${f1(s.opts.two)}%.`);
    } else if (s.kind === "let") {
      lines.push("If Bradshaw goes down at the 1, the Giants can bleed the clock to about 20 seconds and kick a short field goal. New England's chances fall to roughly 4 to 8%.");
      lines.push("Let him score and Brady gets the ball back down 4 with 57 seconds and a timeout: about 15%.");
    } else if (s.model === "espn") {
      lines.push(`ESPN's model had going for it at ${f1(s.opts.go)}% and the field goal at ${f1(s.opts.fg)}%. A field goal here gives Kansas City the ball knowing exactly what it needs.`);
    }
    const r = rankedOptions(s);
    const gap = r.length > 1 ? r[0][1] - r[1][1] : 0;
    if (s.disputed) lines.push(s.disputed.note);
    else if (gap < CLOSE) lines.push("The options are within a point of each other, so either call is defensible.");
    else lines.push(`${gerund(r[0][0])} is worth ${f1(gap)} more points of win probability than ${gerund(r[1][0]).toLowerCase()}.`);
    return lines;
  }
  function assumptions(s) {
    const a = [];
    if (s.model === "nfl4th") a.push("Model: nfl4th by Ben Baldwin. It accounts for score, clock, timeouts, field position, the Vegas line and roof type.");
    if (s.model === "espn") a.push("Numbers: ESPN Analytics, as reported after the game.");
    if (s.model === "anfl") a.push("Numbers: Advanced NFL Stats, as analyzed by the Harvard Sports Analysis Collective in 2012.");
    if (s.model === "nfl4th") a.push("It doesn't know about injuries, the specific matchup, or this kicker's leg beyond league averages.");
    if (s.wind >= 15 && s.roof === "outdoors") a.push(`Wind is ${s.wind} mph. The model treats weather only through averages, so kicks are riskier than it thinks.`);
    if (s.rules) a.push(s.rules);
    return a;
  }

  // ---------- game building ----------
  function pools(data) {
    const s = data.scenarios.filter((x) => {
      // A low WP gap can reflect low conversion odds, not an interesting decision.
      const seconds = x.clock.split(":").reduce((a, v) => a * 60 + Number(v), 0);
      return !(x.kind === "4th" && x.best === "punt" && x.ytg >= 8 && x.yl >= 50 && (x.qtr < 4 || seconds > 120));
    });
    return {
      fourth: s.filter((x) => x.kind === "4th"),
      pat: s.filter((x) => x.kind === "pat"),
      famous: data.famous,
    };
  }
  function pickFresh(list, rand, seen, filter) {
    let cand = list.filter((x) => (!filter || filter(x)) && !seen.has(x.id));
    if (!cand.length) cand = list.filter((x) => !filter || filter(x));
    const p = pick(cand, rand);
    seen.add(p.id);
    return p;
  }
  function buildGame(data, mode, opts) {
    opts = opts || {};
    const seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 2 ** 31);
    const rand = mulberry32(seed);
    const P = pools(data);
    const seen = new Set(opts.seen || []);
    const d = (lvl) => (x) => x.diff === lvl;
    const notCoin = (x) => x.diff !== "coin";
    let list = [];
    if (mode === "clock" || mode === "overtime") {
      list = shuffle(data.practice.filter((x) => x.kind === mode), rand);
    } else if (mode === "quick") {
      list = [
        pickFresh(P.fourth, rand, seen, d("easy")), pickFresh(P.fourth, rand, seen, d("easy")),
        pickFresh(P.fourth, rand, seen, d("medium")), pickFresh(P.pat, rand, seen, notCoin),
        pickFresh(P.fourth, rand, seen, d("medium")), pickFresh(P.famous, rand, seen),
        pickFresh(P.fourth, rand, seen, d("hard")), pickFresh(P.pat, rand, seen, notCoin),
        pickFresh(P.fourth, rand, seen, d("hard")), pickFresh(P.fourth, rand, seen, (x) => x.diff === "coin" || x.diff === "hard"),
      ];
    } else if (mode === "fourth") {
      const famous4 = P.famous.filter((x) => x.kind === "4th");
      list = [
        pickFresh(P.fourth, rand, seen, d("easy")), pickFresh(P.fourth, rand, seen, d("easy")), pickFresh(P.fourth, rand, seen, d("medium")),
        pickFresh(P.fourth, rand, seen, d("medium")), pickFresh(famous4, rand, seen), pickFresh(P.fourth, rand, seen, d("medium")),
        pickFresh(P.fourth, rand, seen, d("hard")), pickFresh(P.fourth, rand, seen, d("hard")), pickFresh(P.fourth, rand, seen, d("hard")),
        pickFresh(P.fourth, rand, seen, d("coin")),
      ];
    } else if (mode === "pat") {
      const famousPat = P.famous.filter((x) => x.kind === "pat");
      list = [];
      for (let i = 0; i < 9; i++) list.push(pickFresh(P.pat, rand, seen, i < 7 ? notCoin : null));
      list.splice(4, 0, pickFresh(famousPat, rand, seen));
    } else if (mode === "daily") {
      // Same five for everyone on a given date: ignore personal history.
      const none = new Set();
      const fam = P.famous[(opts.dayIndex || 0) % P.famous.length];
      list = [pickFresh(P.fourth, rand, none, d("medium")), pickFresh(P.pat, rand, none, notCoin), fam,
        pickFresh(P.fourth, rand, none, d("hard")), pickFresh(P.fourth, rand, none, d("hard"))];
    } else if (mode === "survival") {
      list = []; // drawn one at a time with nextSurvival()
    }
    return { mode, seed, rand, list, seen };
  }
  function nextSurvival(data, game, index) {
    const P = pools(data);
    const r = game.rand();
    const level = index < 4 ? "easy" : index < 9 ? "medium" : "hard";
    if (r < 0.1) return pickFresh(P.famous, game.rand, game.seen);
    if (r < 0.25) return pickFresh(P.pat, game.rand, game.seen, (x) => x.diff !== "coin");
    return pickFresh(P.fourth, game.rand, game.seen, (x) => x.diff === level);
  }
  const SURVIVAL_STRIKE = (g) => g.tier === "costly" || g.tier === "blunder";

  // ---------- end-of-game summary ----------
  function summarize(results, data) {
    const n = results.length;
    const lost = results.reduce((a, r) => a + r.g.lost, 0);
    const points = results.reduce((a, r) => a + r.g.points + (r.bonus && r.bonus.correct ? BONUS_POINTS : 0), 0);
    const basePoints = results.reduce((a, r) => a + r.g.points, 0);
    const bonusPoints = points - basePoints;
    const scorePct = n ? basePoints / n : 0;
    const gradeRow = GRADES.find((x) => scorePct >= x.min);

    const misses = results.filter((r) => !r.s.practice && !r.s.disputed && r.g.lost > 0);
    const agg = misses.filter((r) => r.g.direction === "aggressive").length;
    const cons = misses.filter((r) => r.g.direction === "conservative").length;
    const clearGo = results.filter(r => r.s.kind === "4th" && !r.s.disputed && r.g.best === "go" && gapOf(r.s) >= 2);
    const timidPunts = clearGo.filter(r => r.g.choice === "punt" && r.g.cost >= 3);
    const reckless = results.filter(r => r.s.kind === "4th" && r.g.choice === "go" && r.g.cost >= 3);
    let style = { id: "analytically_minded", label: "Analytically Minded", line: "You usually find the edge, whether that means attacking or taking the sensible punt." };
    if (timidPunts.length >= 2 && timidPunts.length >= clearGo.length / 2)
      style = { id: "punters_best_friend", label: "Punter's Best Friend", line: "You repeatedly sent out the punter when going for it had a clear edge." };
    else if (reckless.length >= 2)
      style = { id: "loose_cannon", label: "Loose Cannon", line: "You kept attacking even when the numbers strongly favored another call." };
    else if (cons >= 2 && cons > agg && clearGo.filter(r => r.g.choice === "go").length === 0)
      style = { id: "cautious", label: "Safety First", line: "You leaned toward taking the points when the model preferred another shot." };
    else if (scorePct < 80)
      style = { id: "film_room", label: "Back to the Film Room", line: "The decisions were mixed. Review the alternatives and find your next edge." };

    // Strengths and weaknesses by the kind of call the math wanted
    const cat = (r) => (r.s.practice ? (r.s.kind === "clock" ? "Clock situations" : "Overtime situations") : r.s.famous ? "Famous calls" : r.s.kind === "pat" ? (r.g.best === "two" ? "Two-point spots" : "Extra-point spots")
      : { go: "Go-for-it spots", punt: "Punt spots", fg: "Field goal spots" }[r.g.best] || "Other");
    const byCat = {};
    for (const r of results) { const c = cat(r); (byCat[c] = byCat[c] || []).push(r.g.points); }
    const cats = Object.entries(byCat).filter(([, v]) => v.length >= 2).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length, v.length]);
    cats.sort((a, b) => b[1] - a[1]);
    const strength = cats.length ? cats[0] : null;
    const weakness = cats.length > 1 && cats[cats.length - 1][1] < cats[0][1] ? cats[cats.length - 1] : null;

    return { n, basePoints, bonusPoints, scorePct, wpCount: results.filter(r => !r.s.practice).length, lost: +lost.toFixed(1), points, grade: gradeRow.g, gradeLine: gradeRow.line, style, misses: misses.length, agg, cons,
      strength, weakness, coach: coachMatch(results, data && data.coaches) };
  }

  function coachMatch(results, coaches) {
    if (!coaches || !coaches.length) return null;
    const fourth = results.filter((r) => r.s.kind === "4th" && "go" in r.s.opts);
    const goSpots = fourth.filter((r) => r.g.best === "go" && gapOf(r.s) >= 2);
    const kickSpots = fourth.filter((r) => r.g.best !== "go" && r.s.opts[r.g.best] - r.s.opts.go >= 2);
    if (goSpots.length + kickSpots.length < 2) return null;
    const gwg = goSpots.length ? (100 * goSpots.filter((r) => r.g.choice === "go").length) / goSpots.length : null;
    const gwk = kickSpots.length ? (100 * kickSpots.filter((r) => r.g.choice === "go").length) / kickSpots.length : null;
    let best = null;
    for (const c of coaches) {
      let dist = 0;
      if (gwg != null) dist += Math.abs(gwg - c.go_pct_when_model_says_go);
      if (gwk != null) dist += 1.5 * Math.abs(gwk - c.go_pct_when_model_says_kick);
      if (!best || dist < best.dist) best = { c, dist };
    }
    const c = best.c;
    const years = c.first_season === c.last_season ? `${c.first_season}` : `${c.first_season}-${String(c.last_season).slice(2)}`;
    const reckless = gwk != null && gwk >= 34;
    return {
      coach: c.coach, years, pool: c.pool, goWhenGo: gwg, goWhenKick: gwk,
      coachGoWhenGo: c.go_pct_when_model_says_go,
      line: reckless
        ? `No NFL coach since 2014 has gone for it this often when the math said kick. The closest is ${c.coach}.`
        : `Closest tendency match: ${c.coach} (${years}). In your ${goSpots.length} clear go-for-it opportunities, you went for it ${gwg == null ? "N/A" : Math.round(gwg) + "%"} of the time; his rate was ${Math.round(c.go_pct_when_model_says_go)}%. This is a small-sample comparison, not a coaching rating.`,
    };
  }

  const SQUARE = { optimal: "🟩", close: "🟩", defensible: "🟨", costly: "🟧", blunder: "🟥" };
  function shareText(summary, results, meta) {
    const grid = results.map((r) => SQUARE[r.g.tier]).join("");
    const head = meta.mode === "daily" ? `Make the Call Daily, ${meta.dateLabel}` : `Make the Call: ${meta.modeLabel}`;
    const lostLine = !summary.wpCount ? "Rules and strategy practice" : summary.lost ? `${summary.lost} points of win probability left on the table` : "Not a point of win probability left on the table";
    return `${head}\nGrade ${summary.grade}. ${summary.style.label}\n${summary.basePoints}/${summary.n * 100} decision points (+${summary.bonusPoints} bonus)\n${lostLine}\n${grid}\nhttps://davidsolar.dev/win-probability/`;
  }

  const api = { CLOSE, TIERS, GRADES, BONUS_POINTS, hashString, mulberry32, shuffle, rankedOptions, gapOf, optionLabel, shortLabel,
    optionOrder, safeChoice, grade, badgesFor, simulate, processResultTag, explain, assumptions, buildGame, nextSurvival,
    SURVIVAL_STRIKE, summarize, coachMatch, shareText, pools };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WPEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
