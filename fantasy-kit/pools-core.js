/* Draft Lab's March Madness pools: the rules, with no page attached (node --test tests/fantasypools.test.mjs).
   The server (tools/fantasykit_pools.sql) keeps the games and the picks and enforces the locks; everything here works
   from a board as mm_board returns it: { games: [{ id, round, region, day, tip, a, b, as, bs, ap, bp, w, final }],
   members: [{ id, name, me }], picks: [{ user, slot, team }] } (a pick's team is null while it's hidden from you).

   FK.pools.days(games)              survivor's days: every date with a game from the first round on, in order
   FK.pools.survivor(board, now)     { days, rows, winners, status }: who's alive, each entry's picks and results
   FK.pools.choices(board, day, uid, now)  the teams you can take on a day, and why the others are out
   FK.pools.five(board, now)         { rows, lock, locked }: each entry's five teams, points and points still possible
   FK.pools.fiveCheck(board, teams)  { ok, seeds, why }: five different teams in the field whose seeds reach 25
   FK.pools.xPts(team)               expected points in the 5-team game, from the hub's tournament sim (teams.json r)
   FK.pools.winProb(a, b)            a's chance to beat b on a neutral floor, from the hub's ratings */
(function (root) {
  "use strict";
  // every win scores by its round: 1, 2, 4, 8, 16, 32 (First Four wins don't count)
  var PTS = [0, 1, 2, 4, 8, 16, 32];
  var ROUNDS = ["First Four", "First round", "Second round", "Sweet 16", "Elite Eight", "Final Four", "Title game"];
  var MIN_SEEDS = 25, SD = 11;
  var ms = function (t) { return typeof t === "number" ? t : Date.parse(t); };

  function seedOf(games, team) {
    for (var i = 0; i < games.length; i++) { var g = games[i]; if (g.a === team && g.as != null) return g.as; if (g.b === team && g.bs != null) return g.bs; }
    return null;
  }
  // the field: everyone in a First Four or first-round game (a projected bracket's First Four losers included)
  function field(games) {
    var out = {};
    games.forEach(function (g) { if (g.round <= 1) [[g.a, g.as], [g.b, g.bs]].forEach(function (x) { if (x[0] && x[1] != null) out[x[0]] = x[1]; }); });
    return out;
  }
  function days(games) {
    var by = {};
    games.forEach(function (g) { if (g.round >= 1) (by[g.day] = by[g.day] || []).push(g); });
    return Object.keys(by).sort().map(function (d, i) {
      var gs = by[d].slice().sort(function (x, y) { return ms(x.tip) - ms(y.tip); });
      return { n: i + 1, day: d, round: Math.min.apply(null, gs.map(function (g) { return g.round; })), games: gs,
        first: ms(gs[0].tip), lock: Math.max.apply(null, gs.map(function (g) { return ms(g.tip); })), done: gs.every(function (g) { return g.final; }) };
    });
  }
  var gameOn = function (day, team) { return day.games.filter(function (g) { return g.a === team || g.b === team; })[0] || null; };
  var picksBy = function (board) {
    var by = {};
    (board.picks || []).forEach(function (p) { (by[p.user] = by[p.user] || {})[p.slot] = p.team; });
    return by;
  };

  /* Survivor. A pick wins when its team wins; a loss, or no pick by the time the day's last game has tipped, is out.
     When everyone still alive goes out on the same day, they split the win. The last one standing wins (in a pool of
     more than one), and whoever survives the title game splits it. */
  function survivor(board, now) {
    now = now == null ? Date.now() : ms(now);
    var ds = days(board.games || []), by = picksBy(board), winners = null, status = "open";
    var rows = (board.members || []).map(function (m) { return { id: m.id, name: m.name, me: !!m.me, alive: true, out: null, wins: 0, cells: {} }; });
    for (var k = 0; k < ds.length && !winners; k++) {
      var day = ds[k], alive = rows.filter(function (r) { return r.alive; }), lost = [];
      if (!alive.length) break;
      alive.forEach(function (r) {
        var mine = by[r.id] || {}, has = Object.prototype.hasOwnProperty.call(mine, "d" + day.n), team = mine["d" + day.n];
        if (!has) {
          if (now >= day.lock) { r.cells[day.n] = { miss: true }; lost.push(r); } else r.cells[day.n] = { none: true };
          return;
        }
        if (team == null) { r.cells[day.n] = { hidden: true }; return; }
        var g = gameOn(day, team);
        if (!g) { r.cells[day.n] = { team: team, bad: true }; return; }
        if (g.final && g.w) {
          if (g.w === team) { r.wins++; r.cells[day.n] = { team: team, win: true, game: g.id }; }
          else { r.cells[day.n] = { team: team, loss: true, game: g.id }; lost.push(r); }
        } else r.cells[day.n] = { team: team, live: ms(g.tip) <= now, game: g.id };
      });
      if (lost.length && lost.length === alive.length) { winners = alive.map(function (r) { return r.id; }); status = "done"; break; }
      lost.forEach(function (r) { r.alive = false; r.out = day.n; });
      var left = rows.filter(function (r) { return r.alive; });
      // the last one standing wins as soon as everyone else is out, even with his own pick still to play
      if (rows.length > 1 && left.length === 1) { winners = [left[0].id]; status = "done"; }
    }
    if (!winners && ds.length && ds[ds.length - 1].round === 6 && ds[ds.length - 1].done) { winners = rows.filter(function (r) { return r.alive; }).map(function (r) { return r.id; }); status = "done"; }
    rows.forEach(function (r) { r.winner = !!winners && winners.indexOf(r.id) >= 0; });
    rows.sort(function (a, b) { return (b.winner - a.winner) || (b.alive - a.alive) || ((b.out || 99) - (a.out || 99)) || (b.wins - a.wins) || String(a.name).localeCompare(String(b.name)); });
    return { days: ds, rows: rows, winners: winners, status: status };
  }

  // the teams you can take on a day: each with its game, and a reason when it's not available
  function choices(board, dayN, uid, now) {
    now = now == null ? Date.now() : ms(now);
    var ds = days(board.games || []), day = ds[dayN - 1];
    if (!day) return [];
    var mine = picksBy(board)[uid] || {}, used = {};
    Object.keys(mine).forEach(function (s) { if (s !== "d" + dayN && mine[s]) used[mine[s]] = +s.slice(1); });
    var out = [];
    day.games.forEach(function (g) {
      [[g.a, g.as, g.b, g.bs], [g.b, g.bs, g.a, g.as]].forEach(function (x) {
        if (!x[0]) return;
        var why = ms(g.tip) <= now || g.final ? "Tipped off" : used[x[0]] ? "Used on day " + used[x[0]] : dayN === 1 && x[1] != null && x[1] <= 2 ? "No 1 or 2 seeds on day 1" : null;
        out.push({ team: x[0], seed: x[1], opp: x[2], oppSeed: x[3], tip: ms(g.tip), game: g, why: why, picked: mine["d" + dayN] === x[0] });
      });
    });
    return out;
  }

  /* The 5-team game: five teams whose seeds add up to 25 or more, locked at the first round's first tip. */
  function fiveCheck(board, teams) {
    var f = field(board.games || []), seeds = 0, uniq = {};
    for (var i = 0; i < teams.length; i++) {
      if (uniq[teams[i]]) return { ok: false, seeds: seeds, why: "Pick five different teams." };
      uniq[teams[i]] = 1;
      if (f[teams[i]] == null) return { ok: false, seeds: seeds, why: "One of those teams isn't in the field." };
      seeds += f[teams[i]];
    }
    if (teams.length !== 5) return { ok: false, seeds: seeds, why: teams.length < 5 ? "Pick " + (5 - teams.length) + " more." : "Pick only five." };
    if (seeds < MIN_SEEDS) return { ok: false, seeds: seeds, why: "Your seeds add up to " + seeds + ". They need to reach " + MIN_SEEDS + "." };
    return { ok: true, seeds: seeds, why: "" };
  }
  function five(board, now) {
    now = now == null ? Date.now() : ms(now);
    var games = board.games || [], by = picksBy(board), pts = {}, won = {}, lost = {};
    games.forEach(function (g) {
      if (!g.final || !g.w) return;
      var loser = g.w === g.a ? g.b : g.a;
      if (loser) lost[loser] = true;
      if (g.round >= 1) { pts[g.w] = (pts[g.w] || 0) + PTS[g.round]; won[g.w] = Math.max(won[g.w] || 0, g.round); }
    });
    var r1 = games.filter(function (g) { return g.round === 1; }).map(function (g) { return ms(g.tip); });
    var lock = r1.length ? Math.min.apply(null, r1) : null;
    var rows = (board.members || []).map(function (m) {
      var mine = by[m.id] || {}, slots = Object.keys(mine).filter(function (s) { return s[0] === "f"; }).sort();
      var teams = slots.map(function (s) {
        var t = mine[s];
        if (t == null) return { hidden: true };
        var left = 0;
        if (!lost[t]) for (var r = (won[t] || 0) + 1; r <= 6; r++) left += PTS[r];
        return { team: t, seed: seedOf(games, t), pts: pts[t] || 0, alive: !lost[t], left: left };
      });
      var total = teams.reduce(function (a, x) { return a + (x.pts || 0); }, 0);
      return { id: m.id, name: m.name, me: !!m.me, teams: teams, picked: slots.length === 5, points: total,
        max: total + teams.reduce(function (a, x) { return a + (x.left || 0); }, 0) };
    });
    rows.sort(function (a, b) { return (b.points - a.points) || (b.max - a.max) || String(a.name).localeCompare(String(b.name)); });
    var place = 0;
    rows.forEach(function (r, i) { if (!i || r.points !== rows[i - 1].points) place = i + 1; r.place = place; });
    var titleDone = games.some(function (g) { return g.round === 6 && g.final; });
    return { rows: rows, lock: lock, locked: lock != null && now >= lock, done: titleDone };
  }

  // expected points from the hub's sim: its chance to win each round (given it makes the field) times the round's points
  function xPts(t) {
    if (!t || !t.r || !(t.r[0] > 0)) return null;
    var x = 0;
    for (var k = 1; k <= 6 && k < t.r.length; k++) x += (t.r[k] / t.r[0]) * PTS[k];
    return x;
  }
  function normCdf(z) {
    var t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2);
    var q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - q : q;
  }
  function winProb(a, b) { return a && b && a.bpi != null && b.bpi != null ? normCdf((a.bpi - b.bpi) / SD) : null; }

  var api = { PTS: PTS, ROUNDS: ROUNDS, MIN_SEEDS: MIN_SEEDS, days: days, field: field, seedOf: seedOf, survivor: survivor, choices: choices, five: five, fiveCheck: fiveCheck, xPts: xPts, winProb: winProb };
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FK = root.FK || {}; root.FK.pools = api; }
})(typeof window !== "undefined" ? window : this);
