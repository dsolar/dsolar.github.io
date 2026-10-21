/* Guillotine league survival odds: a Monte Carlo simulation.

   Each simulated week, every team still alive gets a score:
     this week    points already scored (exact: Yahoo's Points for games it shows as Final, live
                  scoring for games since), plus the expected points of starters still to play.
                  Until a starter's game locks, managers are assumed to fix holes (empty spots, byes,
                  players ruled out): the higher of Yahoo's projection of the lineup as set and the
                  best lineup the roster can still field. Only players still to play can swing, and a
                  player can't lose more than a couple of points, so a team that's done scoring is
                  locked at its total.
     later weeks  its average over its last 3 completed weeks, pulled part of the way toward
                  the league average (rosters churn as cut teams' players hit waivers)
   plus random noise (CV of the mean). The lowest score is cut. Repeat until one team is left.
   Run that thousands of times and count.

   Works in the browser (window.GuillotineSim) and in Node (module.exports) for testing. */
(function (root) {
  "use strict";

  var DEFAULTS = {
    runs: 20000,
    recentWeeks: 3, // how many completed weeks make up a team's recent average
    shrink: 0.25,   // later weeks: share of the way each team is pulled toward the league average
    // Weekly noise, as a share of the expected score. Calibrated on this season's real cuts: run on the
    // teams alive in Weeks 3-6, the median lowest score averaged 83.2 against 84.2 actual (0.22 gave 75.3).
    cv: 0.17,
    fabPts: 8,      // later weeks: points per week for twice the average money left (less money, a penalty)
    fabRamp: 3,     // weeks for that money to turn into better players
    floorPerPlayer: -2 // the worst a starter still to play is assumed to add (fumbles, picks)
  };

  // How much a player's weekly score swings, as a share of his projection. Quarterbacks are the
  // steadiest; tight ends the least predictable. Used only to split a team's swing among its players.
  var POS_CV = { QB: 0.40, RB: 0.55, WR: 0.65, TE: 0.75, K: 0.6, DEF: 0.8 };

  // Starting spots, and who can fill each. With nested flex spots, filling the narrowest first is optimal.
  var SLOTS = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "W/R/T", "Q/W/R/T"];
  var ELIG = { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DEF: ["DEF"],
    "W/R/T": ["RB", "WR", "TE"], "W/R": ["RB", "WR"], "W/T": ["WR", "TE"], "Q/W/R/T": ["QB", "RB", "WR", "TE"] };
  var OUT_RE = /^(O|IR|IR-R|PUP|PUP-R|NA|SUSP)$/;

  function unavailable(p) { return !!p.bye || OUT_RE.test(p.status || ""); }
  // In a starting spot in Yahoo (not counting a bench player the page assumes for an empty spot).
  function isSet(p) { return !p.empty && p.slot !== "BN" && p.slot !== "IR"; }
  function isStarter(p) { return !p.empty && ((p.slot !== "BN" && p.slot !== "IR") || !!p.assumed_slot); }
  function hasStarted(p, pregame) { return !pregame && !!(p.final || p.live || p.yfinal); }
  function projOf(p) { return unavailable(p) ? 0 : (p.proj || 0); }

  // The best lineup a team can still field. Starters whose games have begun stay where they are; every
  // other starting spot goes to the highest-projected player who hasn't played yet and isn't on a bye,
  // Out or on IR. Before kickoff that's simply the best legal lineup. Null without player projections.
  function fixedLineup(t, pregame) {
    var roster = (t.roster || []).filter(function (p) { return !p.empty; });
    if (!roster.some(function (p) { return (p.proj || 0) > 0; })) return null;
    var slots = (t.roster || []).filter(function (p) { return p.slot !== "BN" && p.slot !== "IR"; }).map(function (p) { return p.slot; });
    if (!slots.length) slots = SLOTS.slice();
    var locked = roster.filter(function (p) { return isSet(p) && hasStarted(p, pregame); });
    locked.forEach(function (p) { var i = slots.indexOf(p.slot); if (i >= 0) slots.splice(i, 1); });
    var pool = roster.filter(function (p) {
      return p.slot !== "IR" && locked.indexOf(p) < 0 && !hasStarted(p, pregame) && !unavailable(p) && (p.proj || 0) > 0;
    }).sort(function (a, b) { return b.proj - a.proj; });
    var width = function (s) { return (ELIG[s] || [s]).length; };
    var picks = [];
    slots.sort(function (a, b) { return width(a) - width(b); }).forEach(function (s) {
      var ok = ELIG[s] || [s];
      for (var i = 0; i < pool.length; i++) {
        if (ok.indexOf(pool[i].pos) >= 0) { picks.push(pool.splice(i, 1)[0]); return; }
      }
    });
    return locked.concat(picks);
  }

  // This week for one team, as of now. full = the team's expected full-week score for this lineup
  // (Yahoo's projection, the fixed lineup's, or its average); lineup = who starts (default: the lineup as
  // set); scale = the pregame total the swing is measured against. Returns points banked, expected points
  // still to come, how much those can swing, and which starters are still to play.
  function thisWeek(t, full, o, lineup, scale) {
    var pregame = !!o.pregame;
    var roster = (t.roster || []).filter(function (p) { return !p.empty; });
    var starters = lineup || roster.filter(isSet);
    if (!starters.length) starters = roster.filter(isStarter);
    if (!starters.length) starters = roster.filter(function (p) { return p.in_best; });
    var base = pregame ? 0 : (typeof t.points === "number" ? t.points : 0);
    if (!starters.length) {
      var rem0 = Math.max(full - base, 0);
      return { banked: base, remMu: rem0, sd: o.cv * full, nRem: rem0 > 0 ? 9 : 0, left: [], done: rem0 === 0 && base > 0, played: 0 };
    }
    // Starters whose points aren't in Yahoo's Points yet. Byes and players ruled out project to zero,
    // the same as in Yahoo's team projection.
    var pend = starters.filter(function (p) { return pregame || !p.yfinal; });
    var S = pend.reduce(function (a, p) { return a + projOf(p); }, 0);
    var w = function (p, f) { var x = (POS_CV[p.pos] || 0.6) * projOf(p) * (f == null ? 1 : f); return x * x; };
    var all2 = starters.reduce(function (a, p) { return a + w(p); }, 0);
    // Yahoo's expectation for those players, used to scale Sleeper's per-player projections
    var yRem = Math.max(full - base, 0);
    var k = S > 0 ? yRem / S : 1;
    var banked = base, remMu = 0, rem2 = 0, left = [], played = starters.length - pend.length;
    pend.forEach(function (p) {
      var pj = projOf(p);
      if (!pregame && (p.final || p.live)) {
        banked += p.actual || 0;
        if (p.final) { played++; return; }
        var f = 1 - (p.frac || 0);
        remMu += k * pj * f; rem2 += w(p, f); left.push(p);
        return;
      }
      if (unavailable(p)) { played++; return; }
      remMu += k * pj; rem2 += w(p); left.push(p);
    });
    // No player projections: Yahoo's (or the stand-in) total is all there is to go on.
    if (S === 0 && yRem > 0) { remMu = yRem; rem2 = all2 || 1; }
    if (scale == null) scale = (typeof t.proj_pre === "number" && t.proj_pre > 0 && !pregame) ? t.proj_pre : full;
    var sd = all2 > 0 ? o.cv * scale * Math.sqrt(rem2 / all2) : o.cv * remMu;
    return { banked: banked, remMu: remMu, sd: sd, nRem: left.length, left: left, done: left.length === 0, played: played };
  }

  // Small seeded generator, so everyone who opens the page sees the same numbers.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function normalSource(rand) {
    var spare = null;
    return function () {
      if (spare !== null) { var s = spare; spare = null; return s; }
      var u = 0, v = 0;
      while (u === 0) u = rand();
      v = rand();
      var r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * v;
      spare = r * Math.sin(th);
      return r * Math.cos(th);
    };
  }

  function mean(xs) { var s = 0; for (var i = 0; i < xs.length; i++) s += xs[i]; return xs.length ? s / xs.length : null; }
  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // Turn data.json into the inputs the simulation needs.
  function model(data, opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    var week = data.week;
    var first = data.first_week || 1;   // scores[0] is this week
    var completed = week - first;       // how many weeks have final scores
    var teams = data.teams || [];

    var alive = teams.filter(function (t) { return !t.out; });
    var fallen = teams.filter(function (t) { return t.out; })
      .map(function (t) {
        var s = typeof t.cut === "number" ? t.cut : t.scores && t.scores[t.out - first];
        return { name: t.name, week: t.out, score: typeof s === "number" ? s : null };
      })
      .sort(function (a, b) { return b.week - a.week; });

    alive.forEach(function (t) {
      if (typeof t.avg === "number") { t._recent = t.avg; return; }
      var played = (t.scores || []).slice(0, completed).filter(function (x) { return typeof x === "number"; });
      t._recent = played.length ? mean(played.slice(-o.recentWeeks)) : null;
    });
    var known = alive.map(function (t) { return t._recent; }).filter(function (x) { return x !== null; });
    var leagueAvg = known.length ? mean(known) : 100;
    // Money left buys the players cut teams drop. Measured against the average budget still alive,
    // so the league as a whole doesn't inflate; above average helps, below average hurts.
    var budgets = alive.map(function (t) { return t.faab; }).filter(function (x) { return typeof x === "number"; });
    var avgFab = budgets.length ? mean(budgets) : 0;

    var rows = alive.map(function (t) {
      var recent = t._recent === null ? leagueAvg : t._recent;
      // Later weeks: half season average, half what the current roster projects to (the better of
      // this week and next, so a bye week doesn't drag it down). Rosters improve as cut teams'
      // players get picked up, and the season average alone would miss that.
      var strength = Math.max(t.best || 0, t.best_next || 0);
      var base = strength > 0 ? (recent + strength) / 2 : recent;
      var later = (1 - o.shrink) * base + o.shrink * leagueAvg;
      // This week, managers are assumed to fix lineup holes (empty spots, byes, players ruled out) before
      // their games lock. So a team gets the higher of (a) Yahoo's projection of the lineup as set and
      // (b) the best lineup it can still field. Starters whose games have begun count as they are.
      var yProj = o.pregame && typeof t.proj_pre === "number" && t.proj_pre > 0 ? t.proj_pre : t.proj;
      var hasProj = typeof yProj === "number" && yProj > 0;
      var hasBest = typeof t.best === "number" && t.best > 0;
      var base0 = o.pregame ? 0 : (typeof t.points === "number" ? t.points : 0);
      var setScale = !o.pregame && typeof t.proj_pre === "number" && t.proj_pre > 0 ? t.proj_pre : yProj;
      var A = hasProj ? thisWeek(t, yProj, o, null, setScale) : null;
      var B = null, fixFull = null;
      var lineup = fixedLineup(t, o.pregame);
      if (lineup && lineup.length) {
        var lineupPre = lineup.reduce(function (a, p) { return a + projOf(p); }, 0);
        fixFull = base0 + lineup.reduce(function (a, p) { return a + (o.pregame || !p.yfinal ? projOf(p) : 0); }, 0);
        B = thisWeek(t, fixFull, o, lineup, lineupPre);
      } else if (hasProj && typeof t.avg === "number" && (t.roster || []).length) {
        // No player projections: each hole in the lineup as set is worth a ninth of the team's average.
        var holes = t.roster.filter(function (p) {
          return p.slot !== "BN" && p.slot !== "IR" && (p.empty || (unavailable(p) && !hasStarted(p, o.pregame)));
        }).length;
        if (holes) { fixFull = yProj + holes * t.avg / 9; B = thisWeek(t, fixFull, o, null, fixFull - base0); }
      }
      var nowA = A ? A.banked + A.remMu : 0, nowB = B ? B.banked + B.remMu : -Infinity;
      var useFix = !!B && nowB > nowA;
      var wk = useFix ? B : A || thisWeek(t, later, o);
      var basis = useFix ? "fix" : A ? "yahoo" : "avg";
      var start = useFix ? fixFull : A ? yProj : later;
      var now = wk.banked + wk.remMu;
      var fixGain = useFix ? nowB - nowA : 0;
      // The tag means a lineup change: someone moves in. When the best lineup is the lineup as set, the
      // gap is only Sleeper projecting it higher than Yahoo, so the higher number counts but isn't tagged.
      var moves = useFix && (!lineup || lineup.some(function (p) { return !isSet(p); }));
      var fabEdge = avgFab > 0 && typeof t.faab === "number" ? o.fabPts * (t.faab / avgFab - 1) : 0;
      return {
        name: t.name,
        faab: typeof t.faab === "number" ? t.faab : null,
        mine: !!t.mine,
        basis: basis,                                   // yahoo: lineup as set; fix: holes filled; avg: no projection
        proj: hasProj ? yProj : null,                   // Yahoo's projection of the lineup as set
        projPre: typeof t.proj_pre === "number" && t.proj_pre > 0 ? t.proj_pre : (hasProj ? yProj : null),
        setNow: nowA,                                   // expected score if the lineup stays as set
        fixGain: fixGain,                               // points the fixed lineup adds over the lineup as set
        assumesFix: fixGain >= 5 && moves,              // worth flagging: the odds count on a lineup change
        lineup: useFix && lineup ? lineup.map(function (p) { return p.name; }) : null,
        best: hasBest ? t.best : null,
        recent: t._recent,
        start: start,                                   // expected score before any game this week
        locked: wk.banked,                              // points already scored this week
        gamesFinal: o.pregame ? 0 : wk.played,          // starters whose games are over
        remMu: wk.remMu,                                // expected points still to come
        nRem: wk.nRem,                                  // starters still to play
        left: wk.left.map(function (p) { return p.name; }),
        done: !o.pregame && wk.done,                    // every starter has played: the score is final
        now: now,                                       // expected score this week, as of now
        sdNow: wk.sd,                                   // only points still to be played can swing
        later: later,                                   // expected score in later weeks, before money
        fabEdge: fabEdge                                // points per week the budget adds once spent
      };
    });

    return { week: week, rows: rows, fallen: fallen, leagueAvg: leagueAvg, opts: o };
  }

  function simulate(data, opts) {
    var m = model(data, opts);
    var o = m.opts, rows = m.rows, n = rows.length;
    var weeksLeft = Math.max(n - 1, 0);
    var runs = o.runs;
    var gauss = normalSource(mulberry32(o.seed != null ? o.seed : hash(String(data.updated || "") + n)));

    var chopNow = new Float64Array(n);
    var aliveAfter = [];
    for (var i = 0; i < n; i++) aliveAfter.push(new Float64Array(weeksLeft));
    var lows = [];
    for (var w = 0; w < weeksLeft; w++) lows.push(new Float64Array(runs).fill(NaN));
    var alive = new Uint8Array(n);
    var nowBank = rows.map(function (r) { return r.locked; });
    var nowRem = rows.map(function (r) { return r.remMu; });
    var nowSd = rows.map(function (r) { return r.sdNow; });
    var nowFloor = rows.map(function (r) { return r.nRem * o.floorPerPlayer; });
    var laterMu = rows.map(function (r) { return r.later; });
    var fabEdge = rows.map(function (r) { return r.fabEdge; });

    for (var r = 0; r < runs; r++) {
      alive.fill(1);
      for (var k = 0; k < weeksLeft; k++) {
        var lowScore = Infinity, low = -1;
        for (var j = 0; j < n; j++) {
          if (!alive[j]) continue;
          var s;
          if (k === 0) {
            // Banked points are fixed; only the players still to play swing, and not below a floor.
            s = nowBank[j] + (nowSd[j] > 0 ? Math.max(nowRem[j] + nowSd[j] * gauss(), nowFloor[j]) : nowRem[j]);
          } else {
            var mj = laterMu[j] + fabEdge[j] * Math.min(k / o.fabRamp, 1);
            s = mj + o.cv * mj * gauss();
          }
          if (s < lowScore) { lowScore = s; low = j; }
        }
        alive[low] = 0;
        lows[k][r] = lowScore;
        if (k === 0) chopNow[low]++;
        for (j = 0; j < n; j++) if (alive[j]) aliveAfter[j][k]++;
      }
    }

    var out = rows.map(function (row, idx) {
      var surv = Array.prototype.map.call(aliveAfter[idx], function (c) { return c / runs; });
      return Object.assign({}, row, {
        pChop: weeksLeft ? chopNow[idx] / runs : 0,
        surv: surv, // surv[k] = chance of still being alive after week (week + k)
        pWin: weeksLeft ? surv[weeksLeft - 1] : 1
      });
    });

    // The lowest score each week: this week's cut line, and how it should rise as weak teams go.
    var cuts = lows.map(function (arr, k) {
      var sorted = Array.prototype.slice.call(arr).sort(function (a, b) { return a - b; });
      return { week: m.week + k, p10: quantile(sorted, 0.1), median: quantile(sorted, 0.5), p90: quantile(sorted, 0.9) };
    });
    return {
      week: m.week,
      lastWeek: m.week + weeksLeft - 1,
      weeksLeft: weeksLeft,
      runs: runs,
      teams: out,
      fallen: m.fallen,
      cut: cuts[0] || { median: null, p90: null },
      cuts: cuts,
      leagueAvg: m.leagueAvg,
      opts: o
    };
  }

  var api = { simulate: simulate, model: model, thisWeek: thisWeek, fixedLineup: fixedLineup, isStarter: isStarter, isSet: isSet, DEFAULTS: DEFAULTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GuillotineSim = api;
})(this);
