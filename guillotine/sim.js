/* Guillotine league survival odds: a Monte Carlo simulation.

   Each simulated week, every team still alive gets a score:
     this week    its Yahoo projection
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
    cv: 0.22,       // weekly noise, as a share of the expected score
    fabPts: 8,      // later weeks: points per week for twice the average money left (less money, a penalty)
    fabRamp: 3      // weeks for that money to turn into better players
  };

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
      // This week: Yahoo's projection, plus a bench stand-in for any empty starting spot (t.fill); with
      // no lineup set (projection 0), the team's best possible lineup; failing both, its average.
      var hasProj = typeof t.proj === "number" && t.proj > 0;
      var hasBest = typeof t.best === "number" && t.best > 0;
      var fill = hasProj ? (t.fill || 0) : 0;
      var basis = hasProj ? "yahoo" : hasBest ? "best" : "avg";
      var start = basis === "yahoo" ? t.proj + fill : basis === "best" ? t.best : later;
      // Games already final: swap their projections for what those starters actually scored.
      var locked = o.pregame ? 0 : (t.locked || 0);
      var shift = o.pregame ? 0 : locked - (t.locked_proj || 0);
      var now = start + shift;
      var fabEdge = avgFab > 0 && typeof t.faab === "number" ? o.fabPts * (t.faab / avgFab - 1) : 0;
      return {
        name: t.name,
        faab: typeof t.faab === "number" ? t.faab : null,
        mine: !!t.mine,
        basis: basis,
        proj: hasProj ? t.proj + fill : null,
        fill: fill,                                     // points from stand-ins for empty starting spots
        best: hasBest ? t.best : null,
        recent: t._recent,
        start: start,                                   // expected score before any game this week
        locked: locked,                                 // points already banked from final games
        gamesFinal: o.pregame ? 0 : (t.games_final || 0),
        now: now,                                       // expected score this week, as of now
        sdNow: o.cv * Math.max(now - locked, 3),        // only points still to be played can swing
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
    var nowMu = rows.map(function (r) { return r.now; });
    var nowSd = rows.map(function (r) { return r.sdNow; });
    var laterMu = rows.map(function (r) { return r.later; });
    var fabEdge = rows.map(function (r) { return r.fabEdge; });

    for (var r = 0; r < runs; r++) {
      alive.fill(1);
      for (var k = 0; k < weeksLeft; k++) {
        var mu = k === 0 ? nowMu : laterMu;
        var lowScore = Infinity, low = -1;
        for (var j = 0; j < n; j++) {
          if (!alive[j]) continue;
          var mj = k === 0 ? mu[j] : mu[j] + fabEdge[j] * Math.min(k / o.fabRamp, 1);
          var s = mj + (k === 0 ? nowSd[j] : o.cv * mj) * gauss();
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

  var api = { simulate: simulate, model: model, DEFAULTS: DEFAULTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GuillotineSim = api;
})(this);
