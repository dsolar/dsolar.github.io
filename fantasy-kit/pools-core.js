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
   FK.pools.winProb(a, b)            a's chance to beat b on a neutral floor, from the hub's ratings

   NFL survivor, season long (board.games from pk_games: { id, week, kickoff, away, home, ap, hp, final, line }):
   FK.pools.nflWeeks(games)          the pool's weeks, each with its games, first and last kickoff
   FK.pools.nfl(board, now)          { weeks, rows, winners, status }: who's alive, each entry's picks and results
   FK.pools.nflChoices(board, week, uid, now)  that week's teams, why the others are out, and each one's chance to win
   FK.pools.lineProb(line)           the home team's chance to win from its spread (a 3-point favorite wins about 59%)

   Postseason (board.games from po_games: { id, round, label, conf, kickoff, a, b, an, bn, ap, bp, w, final, line }):
   FK.pools.bowls(board, now)        { rows, n, done }: each entry's points, right and wrong picks, points still possible
   FK.pools.bowlsCheck(picks, n)     { ok, why }: each confidence number used once, from 1 to n
   FK.pools.autoRank(games, picks, prob)  the numbers reassigned so the surest picks carry the most
   FK.pools.bracket(field, picks)    the NFL bracket your picks make: each conference's games by round, reseeded
   FK.pools.nflpo(board, now)        { rows, done }: each entry's points, points still possible, champion
   FK.pools.nflff(board, stats)      playoff fantasy: each entry's lineup and points by round, and its total
   FK.pools.ffSlots(slot)            the positions a lineup spot takes (FLEX: RB, WR or TE) */
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
     The last one standing wins (in a pool of more than one). When everyone still alive goes out on the same day, or
     more than one survives the title game, the tiebreaker is the highest combined seeds of their winning picks; a tie
     there splits it. */
  var topSeeds = function (rs) {
    var hi = Math.max.apply(null, rs.map(function (r) { return r.seeds; }));
    return rs.filter(function (r) { return r.seeds === hi; }).map(function (r) { return r.id; });
  };
  function survivor(board, now) {
    now = now == null ? Date.now() : ms(now);
    var ds = days(board.games || []), by = picksBy(board), winners = null, status = "open";
    var rows = (board.members || []).map(function (m) { return { id: m.id, name: m.name, me: !!m.me, alive: true, out: null, wins: 0, seeds: 0, cells: {} }; });
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
          if (g.w === team) { r.wins++; r.seeds += seedOf(board.games, team) || 0; r.cells[day.n] = { team: team, win: true, game: g.id }; }
          else { r.cells[day.n] = { team: team, loss: true, game: g.id }; lost.push(r); }
        } else r.cells[day.n] = { team: team, live: ms(g.tip) <= now, game: g.id };
      });
      if (lost.length && lost.length === alive.length) { winners = topSeeds(alive); status = "done"; break; }
      lost.forEach(function (r) { r.alive = false; r.out = day.n; });
      var left = rows.filter(function (r) { return r.alive; });
      // the last one standing wins as soon as everyone else is out, even with his own pick still to play
      if (rows.length > 1 && left.length === 1) { winners = [left[0].id]; status = "done"; }
    }
    if (!winners && ds.length && ds[ds.length - 1].round === 6 && ds[ds.length - 1].done) { winners = topSeeds(rows.filter(function (r) { return r.alive; })); status = "done"; }
    rows.forEach(function (r) { r.winner = !!winners && winners.indexOf(r.id) >= 0; });
    rows.sort(function (a, b) { return (b.winner - a.winner) || (b.alive - a.alive) || ((b.out || 99) - (a.out || 99)) || (b.seeds - a.seeds) || (b.wins - a.wins) || String(a.name).localeCompare(String(b.name)); });
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

  /* The 5-team game: five teams whose seeds add up to 25 or more, locked at the first round's first tip. Ties on points
     go to the higher combined seeds, then the deepest run (best team's wins, then the next best, and so on), then split. */
  var deeper = function (a, b) {
    for (var i = 0; i < Math.max(a.length, b.length); i++) { var d = (b[i] || 0) - (a[i] || 0); if (d) return d; }
    return 0;
  };
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
        return { team: t, seed: seedOf(games, t), pts: pts[t] || 0, wins: won[t] || 0, alive: !lost[t], left: left };
      });
      var total = teams.reduce(function (a, x) { return a + (x.pts || 0); }, 0);
      return { id: m.id, name: m.name, me: !!m.me, teams: teams, picked: slots.length === 5, points: total,
        seeds: teams.reduce(function (a, x) { return a + (x.seed || 0); }, 0),
        deep: teams.map(function (x) { return x.wins || 0; }).sort(function (a, b) { return b - a; }),
        max: total + teams.reduce(function (a, x) { return a + (x.left || 0); }, 0) };
    });
    var cmp = function (a, b) { return (b.points - a.points) || (b.seeds - a.seeds) || deeper(a.deep, b.deep); };
    rows.sort(function (a, b) { return cmp(a, b) || (b.max - a.max) || String(a.name).localeCompare(String(b.name)); });
    var place = 0;
    rows.forEach(function (r, i) { if (!i || cmp(rows[i - 1], r)) place = i + 1; r.place = place; });
    var titleDone = games.some(function (g) { return g.round === 6 && g.final; });
    return { rows: rows, lock: lock, locked: lock != null && now >= lock, done: titleDone,
      winners: titleDone ? rows.filter(function (r) { return r.place === 1 && r.picked; }).map(function (r) { return r.id; }) : null };
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

  /* NFL survivor. One team a week to win outright, from the pool's first week through week 18, never the same team
     twice. A loss or a tie, or no pick by the week's last kickoff, is out. The last one standing wins; when everyone
     still alive goes out the same week, or more than one makes it through week 18, they split it. */
  var NFL_LAST = 18;
  function nflWeeks(games) {
    var by = {};
    (games || []).forEach(function (g) { (by[g.week] = by[g.week] || []).push(g); });
    return Object.keys(by).map(Number).sort(function (a, b) { return a - b; }).map(function (w) {
      var gs = by[w].slice().sort(function (x, y) { return ms(x.kickoff) - ms(y.kickoff); });
      return { week: w, games: gs, first: ms(gs[0].kickoff), lock: Math.max.apply(null, gs.map(function (g) { return ms(g.kickoff); })), done: gs.every(function (g) { return g.final; }) };
    });
  }
  var nflGame = function (wk, team) { return wk.games.filter(function (g) { return g.away === team || g.home === team; })[0] || null; };
  var nflWon = function (g, team) { var mine = team === g.home ? g.hp : g.ap, them = team === g.home ? g.ap : g.hp; return mine > them; };
  function nfl(board, now) {
    now = now == null ? Date.now() : ms(now);
    var ws = nflWeeks(board.games), by = picksBy(board), winners = null, status = "open";
    var rows = (board.members || []).map(function (m) { return { id: m.id, name: m.name, me: !!m.me, alive: true, out: null, wins: 0, margin: 0, cells: {} }; });
    for (var k = 0; k < ws.length && !winners; k++) {
      var wk = ws[k], alive = rows.filter(function (r) { return r.alive; }), lost = [], open = false;
      if (!alive.length) break;
      alive.forEach(function (r) {
        var mine = by[r.id] || {}, slot = "w" + wk.week, has = Object.prototype.hasOwnProperty.call(mine, slot), team = mine[slot];
        if (!has) {
          if (now >= wk.lock) { r.cells[wk.week] = { miss: true }; lost.push(r); } else { r.cells[wk.week] = { none: true }; open = true; }
          return;
        }
        if (team == null) { r.cells[wk.week] = { hidden: true }; open = true; return; }
        var g = nflGame(wk, team);
        if (!g) { r.cells[wk.week] = { team: team, bad: true }; return; }
        if (g.final) {
          var opp = team === g.home ? g.away : g.home;
          if (nflWon(g, team)) { r.wins++; r.margin += Math.abs(g.hp - g.ap); r.cells[wk.week] = { team: team, opp: opp, win: true, game: g.id }; }
          else { r.cells[wk.week] = { team: team, opp: opp, loss: true, tie: g.hp === g.ap, game: g.id }; lost.push(r); }
        } else { r.cells[wk.week] = { team: team, live: ms(g.kickoff) <= now, game: g.id }; open = true; }
      });
      if (lost.length && lost.length === alive.length && !open) { winners = alive.map(function (r) { return r.id; }); status = "done"; break; }
      lost.forEach(function (r) { r.alive = false; r.out = wk.week; });
      var left = rows.filter(function (r) { return r.alive; });
      if (rows.length > 1 && left.length === 1) { winners = [left[0].id]; status = "done"; }
      if (open) break; // later weeks wait on this one
    }
    var last = ws[ws.length - 1];
    if (!winners && last && last.week === NFL_LAST && last.done) { winners = rows.filter(function (r) { return r.alive; }).map(function (r) { return r.id; }); status = "done"; }
    rows.forEach(function (r) { r.winner = !!winners && winners.indexOf(r.id) >= 0; });
    rows.sort(function (a, b) { return (b.winner - a.winner) || (b.alive - a.alive) || ((b.out || 99) - (a.out || 99)) || (b.wins - a.wins) || String(a.name).localeCompare(String(b.name)); });
    return { weeks: ws, rows: rows, winners: winners, status: status };
  }
  // the home team's chance to win from its spread (negative is favored), a normal curve with a 13.5-point spread
  var lineProb = function (line) { return line == null ? null : normCdf(-Number(line) / 13.5); };
  function nflChoices(board, week, uid, now) {
    now = now == null ? Date.now() : ms(now);
    var wk = nflWeeks(board.games).filter(function (w) { return w.week === week; })[0];
    if (!wk) return [];
    var mine = picksBy(board)[uid] || {}, used = {};
    Object.keys(mine).forEach(function (s) { if (s !== "w" + week && mine[s]) used[mine[s]] = +s.slice(1); });
    var out = [];
    wk.games.forEach(function (g) {
      var ph = lineProb(g.line);
      [[g.home, g.away, ph, true], [g.away, g.home, ph == null ? null : 1 - ph, false]].forEach(function (x) {
        var why = ms(g.kickoff) <= now || g.final ? "Kicked off" : used[x[0]] ? "Used in week " + used[x[0]] : null;
        out.push({ team: x[0], opp: x[1], home: x[3], p: x[2], kickoff: ms(g.kickoff), game: g, why: why, picked: mine["w" + week] === x[0] });
      });
    });
    return out;
  }

  /* Bowl pick'em: a right pick scores its confidence number. Ties go to more right picks, then the closest guess at
     the title game's total points (once it's final), then they share the place. */
  var tbOff = function (tb, total) { return tb == null || total == null ? Infinity : Math.abs(tb - total); };
  function bowls(board, now) {
    now = now == null ? Date.now() : ms(now);
    var games = board.games || [], by = {}, n = games.length;
    (board.picks || []).forEach(function (p) { (by[p.user] = by[p.user] || {})[p.slot] = p; });
    var title = games.filter(function (g) { return g.round === 4; })[0], total = title && title.final ? (title.ap || 0) + (title.bp || 0) : null;
    // someone else's picks stay hidden until each game kicks off, so for them the games still to come are unknown:
    // their max counts every number they haven't played yet (an upper bound), and nothing says their picks are missing
    var future = games.some(function (g) { return ms(g.kickoff) > now; }), all = n * (n + 1) / 2;
    var rows = (board.members || []).map(function (m) {
      var mine = by[m.id] || {}, pts = 0, right = 0, wrong = 0, left = 0, picked = 0, played = 0;
      games.forEach(function (g) {
        var k = mine["g" + g.id];
        if (!k || !k.team) return;
        picked++;
        var v = k.pts || 0;
        if (ms(g.kickoff) <= now) played += v;
        if (g.final && g.w) { if (g.w === k.team) { pts += v; right++; } else wrong++; } else left += v;
      });
      var hidden = !m.me && future, max = hidden ? pts + left + Math.max(0, all - played - left) : pts + left;
      var tb = mine.tb && mine.tb.team != null && mine.tb.team !== "" ? Number(mine.tb.team) : null;
      return { id: m.id, name: m.name, me: !!m.me, points: pts, right: right, wrong: wrong, picked: picked, hidden: hidden, max: max, tb: tb, off: tbOff(tb, total) };
    });
    var cmp = function (a, b) { return (b.points - a.points) || (b.right - a.right) || (a.off - b.off); };
    rows.sort(function (a, b) { return cmp(a, b) || (b.max - a.max) || String(a.name).localeCompare(String(b.name)); });
    var place = 0;
    rows.forEach(function (r, i) { if (!i || cmp(rows[i - 1], r)) place = i + 1; r.place = place; });
    var done = !!games.length && games.every(function (g) { return g.final; });
    return { rows: rows, n: n, total: total, done: done, winners: done ? rows.filter(function (r) { return r.place === 1; }).map(function (r) { return r.id; }) : null };
  }
  function bowlsCheck(picks, n) {
    var seen = {};
    for (var id in picks) {
      var v = picks[id] && picks[id].pts;
      if (v == null || v === "") continue;
      if (v < 1 || v > n) return { ok: false, why: "Numbers run from 1 to " + n + "." };
      if (seen[v]) return { ok: false, why: "You used " + v + " twice. Each number goes on one game." };
      seen[v] = 1;
    }
    return { ok: true, why: "" };
  }
  // give the open games' numbers out again, the surest pick getting the biggest: locked games keep theirs
  // keep: {gameId: true} for games numbered by hand, which keep their numbers too. pickedOnly: number just the games
  // with a pick (a tap as you go), leaving the rest blank
  function autoRank(games, picks, prob, now, keep, pickedOnly) {
    now = now == null ? Date.now() : ms(now);
    keep = keep || {};
    var locked = {}, open = [];
    games.forEach(function (g) {
      var k = picks[g.id];
      if (ms(g.kickoff) <= now || (keep[g.id] && k && k.pts)) { if (k && k.pts) locked[k.pts] = 1; return; }
      var p = k && k.team ? prob(g, k.team) : null;
      open.push({ id: g.id, sure: p == null ? 0.5 : p, picked: !!(k && k.team), kick: ms(g.kickoff) });
    });
    var free = [];
    for (var v = games.length; v >= 1; v--) if (!locked[v]) free.push(v);
    // picked games first by how sure, then games still to pick (the title game and other later rounds)
    open.sort(function (a, b) { return (b.picked - a.picked) || (b.sure - a.sure) || (a.kick - b.kick); });
    var out = {};
    Object.keys(picks).forEach(function (id) { out[id] = Object.assign({}, picks[id]); });
    if (pickedOnly) open = open.filter(function (o) { if (!o.picked && out[o.id]) out[o.id].pts = null; return o.picked; });
    open.forEach(function (o, i) { out[o.id] = Object.assign({}, out[o.id] || {}, { pts: free[i] }); });
    return out;
  }

  /* NFL bracket: seven seeds a conference. The 1 seed sits out the Wild Card round (2-7, 3-6, 4-5); the divisional round
     reseeds, the 1 seed playing the lowest seed left. Slots: A or N, then wc1..wc3, dv1 (the top seed's game), dv2, cf;
     and sb. A team scores for each round it wins that you had it winning: 1, 2, 4, 8. */
  var NFL_PTS = [0, 1, 2, 4, 8];
  function bracket(field, picks) {
    picks = picks || {};
    var out = { confs: {}, sb: null, champ: null };
    ["AFC", "NFC"].forEach(function (cf) {
      var c = cf[0], seed = {}, team = {};
      (field || []).forEach(function (f) { if (f.conf === cf) { seed[f.team] = f.seed; team[f.seed] = f.team; } });
      var pickOf = function (slot, a, b) { var t = picks[c + slot]; return t && (t === a || t === b) ? t : null; };
      var wc = [[2, 7], [3, 6], [4, 5]].map(function (x, i) { var a = team[x[0]], b = team[x[1]]; return { slot: c + "wc" + (i + 1), a: a, b: b, pick: pickOf("wc" + (i + 1), a, b) }; });
      var dv = [{ slot: c + "dv1", a: team[1], b: null, pick: null }, { slot: c + "dv2", a: null, b: null, pick: null }];
      var adv = wc.map(function (g) { return g.pick; });
      if (adv.every(Boolean)) {
        var bySeed = adv.slice().sort(function (x, y) { return seed[x] - seed[y]; });
        dv[0].b = bySeed[2]; dv[1].a = bySeed[0]; dv[1].b = bySeed[1];
      }
      dv.forEach(function (g, i) { g.pick = g.a && g.b ? pickOf("dv" + (i + 1), g.a, g.b) : null; });
      var cg = { slot: c + "cf", a: dv[0].pick, b: dv[1].pick, pick: null };
      if (cg.a && cg.b) { if (seed[cg.b] < seed[cg.a]) { var t = cg.a; cg.a = cg.b; cg.b = t; } cg.pick = pickOf("cf", cg.a, cg.b); }
      out.confs[cf] = { bye: team[1], wc: wc, dv: dv, cf: cg, seed: seed };
    });
    var sa = out.confs.AFC.cf.pick, sn = out.confs.NFC.cf.pick;
    out.sb = { slot: "sb", a: sa, b: sn, pick: sa && sn && (picks.sb === sa || picks.sb === sn) ? picks.sb : null };
    out.champ = out.sb.pick;
    return out;
  }
  // the picks a bracket keeps: only slots whose team still fits after an earlier change
  function bracketPicks(field, picks) {
    var b = bracket(field, picks), out = {};
    ["AFC", "NFC"].forEach(function (cf) { var c = b.confs[cf]; c.wc.concat(c.dv, [c.cf]).forEach(function (g) { if (g.pick) out[g.slot] = g.pick; }); });
    if (b.sb.pick) out.sb = b.sb.pick;
    return out;
  }
  function nflpo(board, now) {
    var games = board.games || [], won = { 1: {}, 2: {}, 3: {}, 4: {} }, out = {}, by = {};
    games.forEach(function (g) {
      if (!g.final || !g.w) return;
      won[g.round][g.w] = true;
      var loser = g.w === g.a ? g.b : g.a; if (loser) out[loser] = true;
    });
    (board.picks || []).forEach(function (p) { (by[p.user] = by[p.user] || {})[p.slot] = p.team; });
    var sb = games.filter(function (g) { return g.round === 4; })[0], total = sb && sb.final ? (sb.ap || 0) + (sb.bp || 0) : null;
    var roundOf = function (slot) { return slot === "sb" ? 4 : /cf$/.test(slot) ? 3 : /dv/.test(slot) ? 2 : 1; };
    var rows = (board.members || []).map(function (m) {
      var mine = by[m.id] || {}, pts = 0, left = 0, picked = 0;
      Object.keys(mine).forEach(function (slot) {
        if (slot === "tb" || !mine[slot]) return;
        picked++;
        var r = roundOf(slot), t = mine[slot];
        if (won[r][t]) pts += NFL_PTS[r]; else if (!out[t]) left += NFL_PTS[r];
      });
      var tb = mine.tb != null && mine.tb !== "" ? Number(mine.tb) : null;
      return { id: m.id, name: m.name, me: !!m.me, points: pts, max: pts + left, picked: picked, champ: mine.sb || null, tb: tb, off: tbOff(tb, total) };
    });
    var cmp = function (a, b) { return (b.points - a.points) || (a.off - b.off); };
    rows.sort(function (a, b) { return cmp(a, b) || (b.max - a.max) || String(a.name).localeCompare(String(b.name)); });
    var place = 0;
    rows.forEach(function (r, i) { if (!i || cmp(rows[i - 1], r)) place = i + 1; r.place = place; });
    var done = !!(sb && sb.final);
    return { rows: rows, total: total, done: done, winners: done ? rows.filter(function (r) { return r.place === 1; }).map(function (r) { return r.id; }) : null };
  }

  /* NFL playoff fantasy: a nine-man lineup each round, each player once all postseason, half-PPR points. Each player
     locks at his own game's kickoff.
     stats: { round: { players: { id: [std, half, ppr] } } } from fk-live ?sport=nfl&post=N. */
  var FF_SLOTS = ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX", "K", "DEF"];
  var ffSlots = function (slot) { return slot === "FLEX" ? ["RB", "WR", "TE"] : [slot.replace(/\d$/, "")]; };
  var FF_SCORING = { std: 0, half: 1, ppr: 2 };
  function nflff(board, stats) {
    stats = stats || {};
    // the pool's scoring: each stat line is [standard, half PPR, PPR]
    var si = FF_SCORING[((board.pool && board.pool.extra) || {}).scoring] != null ? FF_SCORING[board.pool.extra.scoring] : 1;
    var by = {};
    // a pick is "playerId@TEAM": the team says when he locks
    (board.picks || []).forEach(function (p) { var m = /^r([1-4]):(\w+)$/.exec(p.slot); if (!m || !p.team) return; ((by[p.user] = by[p.user] || {})[m[1]] = by[p.user][m[1]] || {})[m[2]] = String(p.team).split("@")[0]; });
    var rows = (board.members || []).map(function (mb) {
      var mine = by[mb.id] || {}, rounds = {}, total = 0, used = [];
      for (var r = 1; r <= 4; r++) {
        var lu = mine[r] || {}, pts = 0, scored = !!(stats[r] && stats[r].players), each = {};
        FF_SLOTS.forEach(function (sl) {
          var id = lu[sl]; if (!id) return;
          used.push(id);
          var line = scored ? stats[r].players[id] : null, v = line ? line[si] : 0;
          each[sl] = scored ? v : null; pts += v;
        });
        pts = Math.round(pts * 100) / 100;
        rounds[r] = { lineup: lu, pts: scored ? pts : null, each: each, set: Object.keys(lu).length };
        if (scored) total += pts;
      }
      return { id: mb.id, name: mb.name, me: !!mb.me, rounds: rounds, total: Math.round(total * 100) / 100, used: used };
    });
    rows.sort(function (a, b) { return (b.total - a.total) || String(a.name).localeCompare(String(b.name)); });
    var place = 0;
    rows.forEach(function (r, i) { if (!i || rows[i - 1].total !== r.total) place = i + 1; r.place = place; });
    return { rows: rows };
  }

  /* How far each playoff team should go: the bracket played out many times, reseeded the NFL's way, each game from the
     teams' regular-season point differential a game (pd / gp) plus 1.5 for the home side (the better seed; the Super
     Bowl is neutral), on a 13.5-point spread. Games already final count as played. Returns { TEAM: [wc, div, conf, sb,
     champ] }: the chance it plays in each round, then wins it all, and games, its expected number of games. */
  function reach(field, games, n, rnd) {
    n = n || 4000; rnd = rnd || Math.random;
    var seed = {}, conf = {}, str = {}, done = {};
    (field || []).forEach(function (f) { seed[f.team] = f.seed; conf[f.team] = f.conf; str[f.team] = f.gp ? (f.pd || 0) / f.gp : 0; });
    (games || []).forEach(function (g) { if (g.final && g.w && g.a && g.b) done[g.round + ":" + [g.a, g.b].sort().join("-")] = g.w; });
    var out = {}; Object.keys(seed).forEach(function (t) { out[t] = [0, 0, 0, 0, 0]; });
    var play = function (r, a, b, neutral) {
      var k = done[r + ":" + [a, b].sort().join("-")]; if (k) return k;
      var home = neutral ? 0 : seed[a] < seed[b] ? 1.5 : -1.5;
      return rnd() < normCdf((str[a] - str[b] + home) / 13.5) ? a : b;
    };
    for (var i = 0; i < n; i++) {
      var champs = [];
      ["AFC", "NFC"].forEach(function (cf) {
        var bySeed = {}; Object.keys(seed).forEach(function (t) { if (conf[t] === cf) bySeed[seed[t]] = t; });
        if (!bySeed[1]) return;
        var adv = [[2, 7], [3, 6], [4, 5]].map(function (x) { var a = bySeed[x[0]], b = bySeed[x[1]]; out[a][0]++; out[b][0]++; return play(1, a, b); });
        adv.sort(function (x, y) { return seed[x] - seed[y]; });
        var d1 = [bySeed[1], adv[2]], d2 = [adv[0], adv[1]];
        d1.concat(d2).forEach(function (t) { out[t][1]++; });
        var w1 = play(2, d1[0], d1[1]), w2 = play(2, d2[0], d2[1]);
        out[w1][2]++; out[w2][2]++;
        var c = play(3, w1, w2); out[c][3]++; champs.push(c);
      });
      if (champs.length === 2) out[play(4, champs[0], champs[1], true)][4]++;
    }
    var res = {};
    Object.keys(out).forEach(function (t) { var x = out[t].map(function (v) { return v / n; }); res[t] = { p: x, games: x[0] + x[1] + x[2] + x[3] }; });
    return res;
  }

  /* NFL survivor planner. games: the NFL hub's schedule ([type, week, date, away, home, awayScore, homeScore, spread
     with the home side favored positive, neutral, ...]); ratings: each team's points better than average (the hub's
     model). Each game not yet played: the posted spread if there is one, else the rating gap plus 1.6 at home, on a
     13.5-point spread. Then the best path: one team a week, each team once, chosen to give the best chance of getting
     through every week left (an assignment that maximizes the product of the win chances, the Hungarian method).
     Returns { weeks, grid: { TEAM: { week: p } }, path: [{ week, team, p }], odds }. */
  function assign(cost) {
    // rows (weeks) to distinct columns (teams), least total cost; cost is rows x cols with rows <= cols
    var n = cost.length, m = cost[0] ? cost[0].length : 0, INF = 1e18;
    var u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
    for (var i = 1; i <= n; i++) {
      p[0] = i; var j0 = 0, minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
      do {
        used[j0] = true; var i0 = p[j0], delta = INF, j1 = 0;
        for (var j = 1; j <= m; j++) if (!used[j]) {
          var cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
        j0 = j1;
      } while (p[j0] !== 0);
      do { var jn = way[j0]; p[j0] = p[jn]; j0 = jn; } while (j0);
    }
    var out = new Array(n); for (var c = 1; c <= m; c++) if (p[c]) out[p[c] - 1] = c - 1;
    return out;
  }
  function survPlan(opt) {
    var games = opt.games || [], R = opt.ratings || {}, used = {}, from = opt.from, to = opt.to || 18, hfa = opt.hfa == null ? 1.6 : opt.hfa;
    (opt.used || []).forEach(function (t) { used[t] = true; });
    var grid = {}, weeks = [];
    for (var w = from; w <= to; w++) weeks.push(w);
    games.forEach(function (g) {
      if (g[0] !== "REG" || g[1] < from || g[1] > to) return;
      // a game already played this week can't be picked: -1 marks it (a team with no game that week has its bye)
      if (g[5] != null) { (grid[g[4]] = grid[g[4]] || {})[g[1]] = -1; (grid[g[3]] = grid[g[3]] || {})[g[1]] = -1; return; }
      var a = g[3], h = g[4], sp = g[7] != null ? g[7] : (R[h] || 0) - (R[a] || 0) + (g[8] ? 0 : hfa), ph = normCdf(sp / 13.5);
      (grid[h] = grid[h] || {})[g[1]] = ph; (grid[a] = grid[a] || {})[g[1]] = 1 - ph;
    });
    var teams = Object.keys(grid).filter(function (t) { return !used[t]; }).sort();
    var path = [], odds = 1;
    if (teams.length >= weeks.length && weeks.length) {
      var cost = weeks.map(function (wk) { return teams.map(function (t) { var q = grid[t][wk]; return q > 0 ? -Math.log(q) : 1e6; }); });
      var pick = assign(cost);
      weeks.forEach(function (wk, i) { var t = teams[pick[i]], q = grid[t] && grid[t][wk]; path.push({ week: wk, team: t, p: q || 0 }); odds *= q || 0; });
    }
    return { weeks: weeks, grid: grid, path: path, odds: odds, teams: teams };
  }

  /* Super Bowl squares. A 10 by 10 board: the AFC champion across the top (columns), the NFC champion down the side
     (rows). A pick { slot: "s37", team: "x" } is a member's square (37 = row 3, column 7); team "n:Name" is a name the
     owner put on it. Once drawn, pool.extra.nums = { r: [10 digits], c: [10 digits] } says which score digit each row
     and column is. After the 1st quarter, the half, the 3rd quarter and the final, the square at the last digit of
     each team's score wins that period's share (pool.extra.pay, percents). game.lines = { a: [...], b: [...] } holds
     each quarter's points for the away (a) and home (b) team. */
  var SQ_PERIODS = ["1st quarter", "Halftime", "3rd quarter", "Final"];
  function squares(board, now) {
    now = now == null ? Date.now() : ms(now);
    var ex = (board.pool && board.pool.extra) || {}, games = board.games || [], field = board.field || [];
    var names = {}, me = null;
    (board.members || []).forEach(function (m) { names[m.id] = m.name; if (m.me) me = m.id; });
    var cells = [], counts = {};
    for (var i = 0; i < 100; i++) cells.push(null);
    (board.picks || []).forEach(function (p) {
      var m = /^s(\d+)$/.exec(p.slot || ""); if (!m || !p.team) return;
      var guest = String(p.team).indexOf("n:") === 0, name = guest ? String(p.team).slice(2) : names[p.user] || "Someone";
      cells[+m[1]] = { user: p.user, name: name, guest: guest, mine: !guest && p.user === me };
      counts[name] = (counts[name] || 0) + 1;
    });
    var confOf = function (t) { var f = field.filter(function (x) { return x.team === t; })[0]; return f ? f.conf : null; };
    var sb = games.filter(function (g) { return g.round === 4; })[0] || null;
    var champ = function (cf) { var g = games.filter(function (x) { return x.round === 3 && (x.conf === cf || String(x.label || "").indexOf(cf) === 0); })[0]; return g && g.final ? g.w : null; };
    var top = null, side = null;
    if (sb && sb.a && sb.b) { if (confOf(sb.a) === "NFC" || confOf(sb.b) === "AFC") { top = sb.b; side = sb.a; } else { top = sb.a; side = sb.b; } }
    else { top = champ("AFC"); side = champ("NFC"); }
    var nums = ex.nums || null, pay = ex.pay || [20, 20, 20, 40], price = ex.price != null ? Number(ex.price) : null;
    var claimed = cells.filter(Boolean).length, pot = price ? price * claimed : null;
    var sqAt = function (topScore, sideScore) {
      if (!nums) return null;
      var c = nums.c.indexOf(topScore % 10), r = nums.r.indexOf(sideScore % 10);
      return r * 10 + c;
    };
    var periods = [], live = null;
    if (sb && top && side) {
      var L = sb.lines || {}, tl = (top === sb.a ? L.a : L.b) || [], sl = (top === sb.a ? L.b : L.a) || [];
      var started = ms(sb.kickoff) <= now;
      for (var k = 0; k < 4; k++) {
        var done = k < 3 ? (tl.length >= k + 2 || !!sb.final) : !!sb.final;
        if (!done) continue;
        var ts = k < 3 ? tl.slice(0, k + 1).reduce(function (a, v) { return a + v; }, 0) : (top === sb.a ? sb.ap : sb.bp);
        var ss = k < 3 ? sl.slice(0, k + 1).reduce(function (a, v) { return a + v; }, 0) : (top === sb.a ? sb.bp : sb.ap);
        var n = sqAt(ts, ss);
        periods.push({ k: k, label: SQ_PERIODS[k], top: ts, side: ss, sq: n, cell: n == null ? null : cells[n], pay: pay[k], amount: pot != null ? Math.round(pot * pay[k]) / 100 : null });
      }
      if (started && !sb.final) {
        var tNow = top === sb.a ? sb.ap : sb.bp, sNow = top === sb.a ? sb.bp : sb.ap;
        if (tNow != null && sNow != null) live = { top: tNow, side: sNow, sq: sqAt(tNow, sNow) };
      }
    }
    var people = Object.keys(counts).map(function (nm) {
      var won = periods.filter(function (x) { return x.cell && x.cell.name === nm; });
      return { name: nm, squares: counts[nm], wins: won.map(function (x) { return x.label; }), amount: won.reduce(function (a, x) { return a + (x.amount || 0); }, 0),
        mine: cells.some(function (c) { return c && c.mine && c.name === nm; }) };
    }).sort(function (a, b) { return (b.amount - a.amount) || (b.wins.length - a.wins.length) || (b.squares - a.squares) || a.name.localeCompare(b.name); });
    return { cells: cells, nums: nums, top: top, side: side, game: sb, periods: periods, live: live, claimed: claimed, cap: ex.cap || 10, price: price, pot: pot, pay: pay,
      mine: cells.filter(function (c) { return c && c.mine; }).length, people: people, locked: !!nums };
  }

  /* The weekly recap for one member: what happened in the last eight days, the top of the standings, where they stand,
     and what's due next. null when no game in the pool finished in that time. Returns { lines: [...], due }. */
  function recap(board, now, stats) {
    now = now == null ? Date.now() : ms(now);
    var kind = board.pool && board.pool.kind, games = board.games || [], since = now - 8 * 864e5;
    var when = function (g) { return ms(g.kickoff || g.tip); };
    var recent = games.filter(function (g) { return g.final && when(g) >= since && when(g) <= now; });
    if (!recent.length || kind === "squares") return null;
    var names = {}; (board.members || []).forEach(function (m) { names[m.id] = m.name; });
    var lines = [], list = function (a) { return a.length <= 2 ? a.join(" and ") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; };
    var top = function (rows, val) {
      var t = rows.slice(0, 3).map(function (r) { return r.place + ". " + r.name + " (" + val(r) + ")"; }).join(", ");
      var me = rows.filter(function (r) { return r.me; })[0];
      lines.push("Top of the standings: " + t + ".");
      if (me && me.place > 3) lines.push("You're " + ord(me.place) + " of " + rows.length + " (" + val(me) + ").");
    };
    if (kind === "nfl" || kind === "survivor") {
      var S = kind === "nfl" ? nfl(board, now) : survivor(board, now), unit = kind === "nfl" ? "week" : "day";
      var periods = (S.weeks || S.days).filter(function (w) { return w.done && w.lock >= since; });
      periods.forEach(function (w) {
        var k = w.week || w.n, out = S.rows.filter(function (r) { return r.out === k; }).map(function (r) { return r.name; });
        lines.push((unit === "week" ? "Week " : "Day ") + k + ": " + (out.length ? list(out) + (out.length === 1 ? " went out." : " went out.") : "everyone survived."));
      });
      var alive = S.rows.filter(function (r) { return r.alive; }).length, meR = S.rows.filter(function (r) { return r.me; })[0];
      if (S.winners) lines.push(S.winners.length > 1 ? "The pool is over: " + list(S.winners.map(function (w) { return names[w]; })) + " split it." : "The pool is over: " + names[S.winners[0]] + " won it.");
      else lines.push(alive + " of " + S.rows.length + " still alive." + (meR ? (meR.alive ? " You're one of them." : " You went out in " + unit + " " + meR.out + ".") : ""));
    } else if (kind === "bowls") {
      var B = bowls(board, now);
      lines.push(recent.length + (recent.length === 1 ? " game" : " games") + " finished this week.");
      top(B.rows, function (r) { return r.points + " pts"; });
    } else if (kind === "five") {
      var F = five(board, now);
      top(F.rows, function (r) { return r.points + " pts"; });
    } else if (kind === "nflpo") {
      var Pq = nflpo(board, now);
      top(Pq.rows, function (r) { return r.points + " pts"; });
    } else if (kind === "nflff") {
      var X = nflff(board, stats);
      top(X.rows, function (r) { return r.total + " pts"; });
    }
    var st = status(board, now, stats);
    return { lines: lines, due: st.tone === "todo" ? st.due || null : null, todo: st.tone === "todo" ? st.text : null };
  }

  /* Where you stand in a pool, in one line, for the pools list: { text, tone, due }. tone is "todo" (a pick is missing
     and its deadline is still ahead; due is that deadline, in ms), "ok" (in it, nothing to do), "out", "won", "wait"
     (nothing to pick yet) or "done". The text has no times in it; the page words due itself. */
  var ord = function (n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  var nextAfter = function (times, now) { var f = times.filter(function (t) { return t > now; }); return f.length ? Math.min.apply(null, f) : null; };
  var standing = function (rows, unit) {
    var me = rows.filter(function (r) { return r.me; })[0];
    if (!me) return "";
    return rows.length > 1 ? ord(me.place) + " of " + rows.length + (unit != null ? ", " + unit(me) : "") : (unit ? unit(me) : "");
  };
  function status(board, now, stats) {
    now = now == null ? Date.now() : ms(now);
    var kind = board.pool && board.pool.kind, games = board.games || [], uid = ((board.members || []).filter(function (m) { return m.me; })[0] || {}).id;
    var mine = picksBy(board)[uid] || {}, n = (board.members || []).length;
    var surv = function (res, units, startedAt) {
      var me = res.rows.filter(function (r) { return r.me; })[0] || {};
      var left = res.rows.filter(function (r) { return r.alive; }).length;
      if (me.winner) return { text: res.winners.length > 1 ? "You won (shared)" : "You won", tone: "won" };
      if (res.status === "done") return { text: "Over", tone: "done" };
      if (!me.alive) return { text: "Out in " + units + " " + me.out, tone: "out" };
      var open = (res.days || res.weeks).filter(function (d) { return !d.done; })[0];
      if (!open) return { text: "Alive", tone: "ok" };
      var key = open.n || open.week, cell = me.cells && me.cells[key];
      var alive = left + " of " + n + " left";
      if (cell && cell.none) return { text: (n > 1 ? "Alive, " + alive : "Alive") + ". Pick needed", tone: "todo", due: nextAfter(open.games.map(startedAt), now) || open.lock };
      return { text: (n > 1 ? "Alive, " + alive : "Alive"), tone: "ok" };
    };
    if (kind === "nfl") {
      if (!games.length) return { text: "Waiting for the schedule", tone: "wait" };
      return surv(nfl(board, now), "week", function (g) { return ms(g.kickoff); });
    }
    if (kind === "survivor") {
      if (board.projected || !games.some(function (g) { return g.round >= 1; })) return { text: "Field set on Selection Sunday", tone: "wait" };
      return surv(survivor(board, now), "day", function (g) { return ms(g.tip); });
    }
    if (kind === "props") {
      var lkP = board.lock ? ms(board.lock) : null, PR = props(board, now), meP2 = PR.rows.filter(function (r) { return r.me; })[0] || {}, nq = PR.sheet.length;
      if (PR.done) return meP2.place === 1 ? { text: "You won", tone: "won" } : { text: "Finished " + standing(PR.rows), tone: "done" };
      if (!lkP || now < lkP) return meP2.picked >= nq ? { text: "Sheet in", tone: "ok" } : { text: meP2.picked ? meP2.picked + " of " + nq + " answered" : "Fill out your sheet", tone: "todo", due: lkP };
      return { text: standing(PR.rows, function (r) { return r.points + " pts"; }) + (PR.graded < nq ? ", " + PR.graded + " of " + nq + " graded" : ""), tone: "ok" };
    }
    if (kind === "bracket") {
      var lkB = board.fiveLock ? ms(board.fiveLock) : null, MB = mmBracket(board, now), meM = MB.rows.filter(function (r) { return r.me; })[0] || {};
      if (!MB.field.ready) return { text: "Field set on Selection Sunday", tone: "wait" };
      if (board.projected) return { text: meM.picked ? "Practice bracket: " + meM.picked + " of 63 picked" : "Practice on the projected field", tone: "wait" };
      if (MB.done) return meM.place === 1 ? { text: "You won", tone: "won" } : { text: "Finished " + standing(MB.rows), tone: "done" };
      if (!lkB || now < lkB) return meM.picked >= 63 ? { text: "Bracket in", tone: "ok" } : { text: meM.picked ? meM.picked + " of 63 picked" : "Fill out your bracket", tone: "todo", due: lkB };
      return { text: standing(MB.rows, function (r) { return r.points + " pts"; }), tone: "ok" };
    }
    if (kind === "five") {
      var F = five(board, now), me5 = F.rows.filter(function (r) { return r.me; })[0] || {};
      if (board.projected || F.lock == null) return { text: "Field set on Selection Sunday", tone: "wait" };
      if (!F.locked) return me5.picked ? { text: "Teams in", tone: "ok" } : { text: "Pick 5 teams", tone: "todo", due: F.lock };
      if (F.done) return me5.place === 1 && me5.picked ? { text: "You won", tone: "won" } : { text: "Finished " + standing(F.rows), tone: "done" };
      return { text: standing(F.rows, function (r) { return r.points + " pts"; }), tone: "ok" };
    }
    if (kind === "bowls") {
      var set = games.filter(function (g) { return g.a && g.b; });
      if (!set.length) return { text: "Waiting for matchups", tone: "wait" };
      var B = bowls(board, now), meB = B.rows.filter(function (r) { return r.me; })[0] || {};
      if (B.done) return meB.place === 1 ? { text: "You won", tone: "won" } : { text: "Finished " + standing(B.rows), tone: "done" };
      var open = set.filter(function (g) { return ms(g.kickoff) > now && !mine["g" + g.id]; });
      var started = games.some(function (g) { return ms(g.kickoff) <= now; });
      var where = started ? standing(B.rows, function (r) { return r.points + " pts"; }) : "";
      // the due time drives the reminder emails (supabase/functions/fk-clock): someone who hasn't made a single pick
      // gets one before the first bowl and then no more, rather than one before every game
      var any = Object.keys(mine).some(function (k) { return k[0] === "g" && mine[k]; });
      if (open.length) return { text: open.length + (open.length === 1 ? " pick" : " picks") + " to make" + (where ? ". " + where : ""), tone: "todo", due: any || !started ? nextAfter(open.map(function (g) { return ms(g.kickoff); }), now) : null };
      return { text: where || "All picks in", tone: "ok" };
    }
    if (kind === "nflpo") {
      var lk = board.lock ? ms(board.lock) : null, P = nflpo(board, now), meP = P.rows.filter(function (r) { return r.me; })[0] || {};
      if (P.done) return meP.place === 1 ? { text: "You won", tone: "won" } : { text: "Finished " + standing(P.rows), tone: "done" };
      if (!lk || now < lk) {
        if ((board.field || []).length < 14) return { text: "Field set after week 18", tone: "wait" };
        return meP.picked >= 13 ? { text: "Bracket in", tone: "ok" } : { text: "Finish your bracket", tone: "todo", due: lk };
      }
      return { text: standing(P.rows, function (r) { return r.points + " pts"; }), tone: "ok" };
    }
    if (kind === "nflff") {
      var X = nflff(board, stats), meX = X.rows.filter(function (r) { return r.me; })[0] || { rounds: {} };
      var sb = games.filter(function (g) { return g.round === 4; })[0];
      if (sb && sb.final) return meX.place === 1 ? { text: "You won", tone: "won" } : { text: "Finished " + standing(X.rows), tone: "done" };
      for (var r = 1; r <= 4; r++) {
        var rg = games.filter(function (g) { return g.round === r && g.a && g.b; });
        var fut = rg.map(function (g) { return ms(g.kickoff); }).filter(function (t) { return t > now; });
        if (!rg.length || !fut.length) continue;
        var setN = (meX.rounds[r] || {}).set || 0;
        if (setN < FF_SLOTS.length) return { text: (setN ? FF_SLOTS.length - setN + " spots open" : "Set your lineup") + (r > 1 ? ". " + standing(X.rows) : ""), tone: "todo", due: Math.min.apply(null, fut) };
        return { text: r > 1 ? standing(X.rows) : "Lineup set", tone: "ok" };
      }
      if (!games.some(function (g) { return g.a && g.b; })) {
        var proj = (board.field || []).filter(function (f) { return f.seed >= 2 && f.seed <= 7; }).length === 12;
        if (!proj) return { text: "Opens after week 18", tone: "wait" };
        var s1 = (meX.rounds[1] || {}).set || 0;
        return { text: s1 >= FF_SLOTS.length ? "Projected lineup set" : "Projected Wild Card lineup open", tone: "wait" };
      }
      return { text: standing(X.rows), tone: "ok" };
    }
    if (kind === "squares") {
      var S = squares(board, now), mineN = S.mine;
      var won = S.periods.filter(function (x) { return x.cell && x.cell.mine; });
      if (S.game && S.game.final) return won.length ? { text: "Won " + won.map(function (x) { return x.label; }).join(", "), tone: "won" } : { text: "Over", tone: "done" };
      if (won.length) return { text: "Won " + won.map(function (x) { return x.label; }).join(", ") + " so far", tone: "ok" };
      if (!S.locked) return mineN ? { text: mineN + (mineN === 1 ? " square" : " squares") + ". Numbers not drawn yet", tone: "ok" } : { text: "Claim your squares", tone: "todo", due: S.game ? ms(S.game.kickoff) - 30 * 60e3 : null };
      return { text: mineN + (mineN === 1 ? " square" : " squares") + ", numbers drawn", tone: "ok" };
    }
    return { text: "", tone: "ok" };
  }


  /* March Madness bracket ('bracket'). All 63 games from the Round of 64 to the title, picked before the first Round of
     64 tip. A right pick scores 10, 20, 40, 80, 160 and 320 points by round; ties go to the closest guess at the title
     game's total points. Slots: b:<region>:<round>:<k> for rounds 1-4 inside a region (k counts matchups down the
     region from the 1-16 game), b:ff:<0|1> for the semifinals, b:ch for the champion. An Opening Round slot holds both
     teams until it's played: pick either one through. */
  var MM_ORDER = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];
  var MM_PTS = [0, 10, 20, 40, 80, 160, 320];
  var MM_REGIONS = ["East", "West", "South", "Midwest"];
  // which regions meet in each national semifinal. Set it with the real bracket on Selection Sunday; until then the
  // first region listed plays the fourth and the second the third (the projection's East-Midwest and West-South)
  var MM_FF = { 2027: null };
  var mmK = function (seed) { var i = MM_ORDER.indexOf(+seed); return i < 0 ? null : i >> 1; };
  function mmField(board) {
    var games = board.games || [], regs = [], seedOf = {}, regionOf = {}, mates = {};
    games.forEach(function (g) { if ((g.round === 0 || g.round === 1) && g.region && regs.indexOf(g.region) < 0) regs.push(g.region); });
    regs.sort(function (a, b) { var x = MM_REGIONS.indexOf(a), y = MM_REGIONS.indexOf(b); return (x < 0 ? 9 : x) - (y < 0 ? 9 : y) || (a < b ? -1 : 1); });
    var put = function (t, seed, reg) { if (!t) return; if (seed != null) seedOf[t] = +seed; regionOf[t] = reg; };
    games.forEach(function (g) {
      if (g.round === 0) { put(g.a, g.as, g.region); put(g.b, g.bs, g.region); if (g.a && g.b) { mates[g.a] = g.b; mates[g.b] = g.a; } }
      if (g.round === 1) { put(g.a, g.as, g.region); put(g.b, g.bs, g.region); }
    });
    // each region: the eight Round of 64 matchups, each side one team or an Opening Round pair
    var regions = {};
    regs.forEach(function (r) {
      var m = []; for (var k = 0; k < 8; k++) m.push([[], []]);
      Object.keys(regionOf).forEach(function (t) {
        if (regionOf[t] !== r || seedOf[t] == null) return;
        var i = MM_ORDER.indexOf(seedOf[t]); if (i < 0) return;
        var side = m[i >> 1][i & 1]; if (side.indexOf(t) < 0) side.push(t);
      });
      // an Opening Round winner who's through shows alone; until then the pair shares the slot
      games.forEach(function (g) { if (g.round === 0 && g.region === r && g.final && g.w) { var i = MM_ORDER.indexOf(seedOf[g.w]); if (i >= 0) m[i >> 1][i & 1] = [g.w]; } });
      regions[r] = m;
    });
    var cfg = MM_FF[board.pool && board.pool.season], ff = cfg && cfg.every(function (x) { return regs.indexOf(x[0]) >= 0 && regs.indexOf(x[1]) >= 0; }) ? cfg
      : regs.length === 4 ? [[regs[0], regs[3]], [regs[1], regs[2]]] : [];
    return { regions: regions, names: regs, seedOf: seedOf, regionOf: regionOf, mates: mates, ff: ff, ready: regs.length === 4 };
  }
  // the slot a team fills by winning in a round
  function mmSlot(F, team, round) {
    var reg = F.regionOf[team], k = mmK(F.seedOf[team]);
    if (reg == null || k == null) return null;
    if (round <= 4) return "b:" + reg + ":" + round + ":" + (k >> (round - 1));
    if (round === 5) { for (var x = 0; x < F.ff.length; x++) if (F.ff[x].indexOf(reg) >= 0) return "b:ff:" + x; return null; }
    return "b:ch";
  }
  // the teams that can fill a slot, given a bracket's picks so far: [[side A teams], [side B teams]]
  function mmFeed(F, picks, slot) {
    var p = slot.split(":"), one = function (s) { return picks[s] ? [picks[s]] : []; };
    if (p[1] === "ch") return [one("b:ff:0"), one("b:ff:1")];
    if (p[1] === "ff") { var pr = F.ff[+p[2]] || []; return [one("b:" + pr[0] + ":4:0"), one("b:" + pr[1] + ":4:0")]; }
    var reg = p[1], r = +p[2], k = +p[3];
    if (r === 1) return ((F.regions[reg] || [])[k] || [[], []]).map(function (x) { return x.slice(); });
    return [one("b:" + reg + ":" + (r - 1) + ":" + (2 * k)), one("b:" + reg + ":" + (r - 1) + ":" + (2 * k + 1))];
  }
  // every slot, round by round
  function mmSlots(F) {
    var out = [];
    for (var r = 1; r <= 4; r++) F.names.forEach(function (reg) { for (var k = 0; k < 8 >> (r - 1); k++) out.push({ slot: "b:" + reg + ":" + r + ":" + k, round: r, region: reg, k: k }); });
    out.push({ slot: "b:ff:0", round: 5, k: 0 }, { slot: "b:ff:1", round: 5, k: 1 }, { slot: "b:ch", round: 6, k: 0 });
    return out;
  }
  // set a pick and clear anything later that no longer follows from it
  function mmPick(F, picks, slot, team) {
    var out = Object.assign({}, picks);
    if (team) out[slot] = team; else delete out[slot];
    mmSlots(F).forEach(function (x) {
      if (!out[x.slot]) return;
      var feed = mmFeed(F, out, x.slot), ok = feed[0].concat(feed[1]).indexOf(out[x.slot]) >= 0;
      if (!ok) delete out[x.slot];
    });
    return out;
  }
  // the favorite in every open slot, round by round (prob(a, b) is a's chance)
  function mmFill(F, picks, prob) {
    var out = Object.assign({}, picks);
    mmSlots(F).forEach(function (x) {
      if (out[x.slot]) return;
      var feed = mmFeed(F, out, x.slot), a = feed[0], b = feed[1];
      var best = function (side) { return side.slice().sort(function (u, v) { return (prob(v, u) || 0.5) - (prob(u, v) || 0.5); })[0]; };
      var ta = best(a), tb = best(b);
      if (!ta && !tb) return;
      out[x.slot] = !tb ? ta : !ta ? tb : ((prob(ta, tb) == null ? 0.5 : prob(ta, tb)) >= 0.5 ? ta : tb);
    });
    return out;
  }
  function mmBracket(board, now) {
    now = now == null ? Date.now() : ms(now);
    var F = mmField(board), games = board.games || [], by = {};
    (board.picks || []).forEach(function (p) { if (p.team != null) (by[p.user] = by[p.user] || {})[p.slot] = p.team; });
    var won = {}, out = {}, done = {};
    games.forEach(function (g) {
      if (!g.final || !g.w) return;
      var loser = g.w === g.a ? g.b : g.a; if (loser) out[loser] = true;
      if (g.round >= 1) { var sl = mmSlot(F, g.w, g.round); if (sl) { won[sl] = g.w; done[sl] = true; } }
    });
    var title = games.filter(function (g) { return g.round === 6; })[0], total = title && title.final ? (title.ap || 0) + (title.bp || 0) : null;
    var slots = mmSlots(F);
    var rows = (board.members || []).map(function (m) {
      var mine = by[m.id] || {}, pts = 0, left = 0, right = 0, picked = 0;
      slots.forEach(function (x) {
        var t = mine[x.slot]; if (!t) return;
        picked++;
        if (done[x.slot]) { if (won[x.slot] === t) { pts += MM_PTS[x.round]; right++; } }
        else if (!out[t]) left += MM_PTS[x.round];
      });
      var tb = mine.tb != null && mine.tb !== "" ? Number(mine.tb) : null;
      return { id: m.id, name: m.name, me: !!m.me, points: pts, right: right, picked: picked, max: pts + left, champ: mine["b:ch"] || null, tb: tb, off: tbOff(tb, total), hidden: !m.me && !Object.keys(mine).length };
    });
    var cmp = function (a, b) { return (b.points - a.points) || (a.off - b.off); };
    rows.sort(function (a, b) { return cmp(a, b) || (b.max - a.max) || String(a.name).localeCompare(String(b.name)); });
    var place = 0;
    rows.forEach(function (r, i) { if (!i || cmp(rows[i - 1], r)) place = i + 1; r.place = place; });
    var fin = !!(title && title.final);
    return { rows: rows, field: F, won: won, out: out, total: total, done: fin, n: slots.length, winners: fin ? rows.filter(function (r) { return r.place === 1; }).map(function (r) { return r.id; }) : null };
  }


  /* Super Bowl prop sheet ('props'). The sheet is the pool's (board.pool.extra.props): each question has choices, points
     and maybe a line ({line} in its text). {AFC} and {NFC} in a choice are the two teams. A right answer scores its
     points; the owner marks answers (extra.answers), and winner, total and margin grade themselves from the final.
     Ties go to the closest guess at the game's total points. */
  function propsGame(board) { return (board.games || []).filter(function (g) { return g.round === 4; })[0] || null; }
  function propsConf(board) { var c = {}; (board.field || []).forEach(function (f) { c[f.team] = f.conf; }); return c; }
  function propsAuto(q, board) {
    var g = propsGame(board); if (!q.auto || !g || !g.final || g.ap == null || g.bp == null) return null;
    var tot = g.ap + g.bp, mg = Math.abs(g.ap - g.bp);
    if (q.auto === "total" && q.line != null) return tot > q.line ? 0 : 1;
    if (q.auto === "margin") return mg <= 3 ? 0 : mg <= 7 ? 1 : mg <= 14 ? 2 : 3;
    if (q.auto === "winner") { var w = g.ap > g.bp ? g.a : g.b, cf = propsConf(board)[w]; var i = (q.opts || []).indexOf("{" + cf + "}"); return i >= 0 ? i : null; }
    return null;
  }
  function propsAnswer(q, board) {
    var a = ((board.pool && board.pool.extra) || {}).answers || {};
    return a[q.id] != null ? +a[q.id] : propsAuto(q, board);
  }
  function props(board, now) {
    var sheet = ((board.pool && board.pool.extra) || {}).props || [], by = {};
    (board.picks || []).forEach(function (p) { if (p.team != null) (by[p.user] = by[p.user] || {})[p.slot] = p.team; });
    var ans = {}; sheet.forEach(function (q) { ans[q.id] = propsAnswer(q, board); });
    var g = propsGame(board), total = g && g.final && g.ap != null ? g.ap + g.bp : null;
    var rows = (board.members || []).map(function (m) {
      var mine = by[m.id] || {}, pts = 0, right = 0, left = 0, picked = 0;
      sheet.forEach(function (q) {
        var v = mine["p:" + q.id]; if (v == null || v === "") return;
        picked++;
        if (ans[q.id] == null) left += +q.pts || 1;
        else if (+v === ans[q.id]) { pts += +q.pts || 1; right++; }
      });
      var tb = mine.tb != null && mine.tb !== "" ? Number(mine.tb) : null;
      return { id: m.id, name: m.name, me: !!m.me, points: pts, right: right, picked: picked, max: pts + left, tb: tb, off: tbOff(tb, total) };
    });
    var cmp = function (a, b) { return (b.points - a.points) || (a.off - b.off); };
    rows.sort(function (a, b) { return cmp(a, b) || (b.max - a.max) || String(a.name).localeCompare(String(b.name)); });
    var place = 0;
    rows.forEach(function (r, i) { if (!i || cmp(rows[i - 1], r)) place = i + 1; r.place = place; });
    var graded = sheet.filter(function (q) { return ans[q.id] != null; }).length, done = !!sheet.length && graded === sheet.length && total != null;
    return { rows: rows, sheet: sheet, answers: ans, graded: graded, total: total, done: done, winners: done ? rows.filter(function (r) { return r.place === 1; }).map(function (r) { return r.id; }) : null };
  }

  var api = { PTS: PTS, ROUNDS: ROUNDS, MIN_SEEDS: MIN_SEEDS, days: days, field: field, seedOf: seedOf, survivor: survivor, choices: choices, five: five, fiveCheck: fiveCheck, xPts: xPts, winProb: winProb, NFL_LAST: NFL_LAST, nflWeeks: nflWeeks, nfl: nfl, nflChoices: nflChoices, lineProb: lineProb, normCdf: normCdf,
    bowls: bowls, bowlsCheck: bowlsCheck, autoRank: autoRank, NFL_PTS: NFL_PTS, bracket: bracket, bracketPicks: bracketPicks, nflpo: nflpo, FF_SLOTS: FF_SLOTS, ffSlots: ffSlots, nflff: nflff, reach: reach, status: status, ord: ord, squares: squares, SQ_PERIODS: SQ_PERIODS, survPlan: survPlan, assign: assign, recap: recap,
    MM_PTS: MM_PTS, MM_FF: MM_FF, mmField: mmField, mmSlot: mmSlot, mmFeed: mmFeed, mmSlots: mmSlots, mmPick: mmPick, mmFill: mmFill, mmBracket: mmBracket,
    props: props, propsAnswer: propsAnswer, propsAuto: propsAuto, propsGame: propsGame, propsConf: propsConf };
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FK = root.FK || {}; root.FK.pools = api; }
})(typeof window !== "undefined" ? window : this);
