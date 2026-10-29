/* Boston Grid: the rules. Today's grid, whether a guess fits a square, and the points. No screens here (app.js).
   Borrows Guess the Pick's engine (../guess-the-pick/engine.js) for name matching, the Boston date and the
   seeded random numbers, so the daily rolls over at the same moment as the other games.

   The grid: three teams across the top, three down the side, and Boston's team always leads the side
   (Celtics, Patriots, Red Sox). A square wants a player who played for both of its teams. Every square has
   at least MIN_FAIR answers that people actually remember (fame of at least NOTABLE, still playing in 2000
   or later), so no square is a trick question. Nine guesses in all, a player once per grid.
   Points: a right answer is worth 10 to 100 deep-cut points by how well known the player is in his league:
   10 for its most famous player, 90 for the least famous notable one, 100 for anyone below that line. */
(function (root) {
  var G = root.GTP || (typeof require !== "undefined" ? require("../guess-the-pick/engine.js") : null);
  var BOSTON = { nba: "celtics", nfl: "patriots", mlb: "BOS" };
  var NOTABLE = { nba: 0.16, nfl: 0.2, mlb: 0.14 }, RECENT = 0, MIN_FAIR = 4, MAX_EASY = 60, GUESSES = 9;
  var DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
  var cache = {};

  // The league's players with their teams as a bitmask, the notable ones, and every name for the guess box
  function league(data, lg) {
    if (cache[lg] && cache[lg].src === data) return cache[lg];
    var ids = data.ids, players = [], byName = {}, names = [];
    data.players.forEach(function (r) {
      var mask = 0;
      for (var i = 0; i < r[2].length; i++) mask |= 1 << DIGITS.indexOf(r[2][i]);
      var yr = r[3] + (r[3] < 50 ? 2000 : 1900);
      var p = { n: r[0], f: r[1], m: mask, y: yr, k: G.norm(r[0]) };
      p.notable = p.f >= NOTABLE[lg] && yr >= 2000 + RECENT;
      players.push(p);
      if (!byName[p.k]) { byName[p.k] = []; names.push(r[0]); }
      byName[p.k].push(p);
    });
    // Deep-cut points by where a player ranks among the league's notable players (the data is in fame order):
    // the best-known is worth 10, the least-known notable player 90, anyone below the line 100
    var notable = players.filter(function (p) { return p.notable; }), nn = Math.max(1, notable.length - 1);
    notable.forEach(function (p, i) { p.pts = 10 + Math.round(80 * i / nn); });
    players.forEach(function (p) { if (p.pts == null) p.pts = 100; });
    var L = { src: data, lg: lg, ids: ids, teams: data.teams, players: players, byName: byName, names: names,
      boston: ids.indexOf(BOSTON[lg]), pool: G.pool([], names) };
    // How many notable players each pair of franchises share
    var n = ids.length, pair = [];
    for (var a = 0; a < n; a++) { pair.push([]); for (var b = 0; b < n; b++) pair[a].push(0); }
    players.forEach(function (p) {
      if (!p.notable) return;
      for (var a = 0; a < n; a++) if (p.m & (1 << a)) for (var b = a + 1; b < n; b++) if (p.m & (1 << b)) { pair[a][b]++; pair[b][a]++; }
    });
    L.pair = pair;
    cache[lg] = L;
    return L;
  }

  // Today's grid for a league: rows [Boston, x, y] and three columns, the same for everyone on a Boston date
  function grid(L, day) {
    var rand = G.seeded("boston-grid|" + L.lg + "|" + (day || G.dailyKey()));
    var n = L.ids.length, fair = function (a, b) { var c = L.pair[a][b]; return c >= MIN_FAIR; };
    var pick = function (avoid) { var t; do { t = Math.floor(rand() * n); } while (avoid.indexOf(t) >= 0); return t; };
    for (var tries = 0; tries < 5000; tries++) {
      var rows = [L.boston], cols = [];
      for (var i = 0; i < 3; i++) cols.push(pick(rows.concat(cols)));
      for (i = 0; i < 2; i++) rows.push(pick(rows.concat(cols)));
      var ok = true, easy = 0;
      for (var r = 0; r < 3 && ok; r++) for (var c = 0; c < 3; c++) {
        if (!fair(rows[r], cols[c])) { ok = false; break; }
        if (L.pair[rows[r]][cols[c]] > MAX_EASY) easy++;
      }
      if (ok && easy <= 3) return { rows: rows, cols: cols };
    }
    return null;
  }

  function both(p, a, b) { return (p.m & (1 << a)) && (p.m & (1 << b)); }

  // Every player who fits a square, best known first
  function answers(L, a, b) { return L.players.filter(function (p) { return both(p, a, b); }); }

  // A guess for square (a, b): { ok: true, p } for a right answer; "used" if he's already on the grid;
  // "wrong" for a real player who doesn't fit; "unknown" for a name the game doesn't know
  function judge(L, guess, a, b, used) {
    var k = G.norm(guess);
    if (!k) return { r: "unknown" };
    var same = L.byName[k] || L.byName[(L.pool.bySquash[G.squash(guess)] || {}).k];
    if (!same) return { r: "unknown" };
    if (used && used.indexOf(same[0].k) >= 0) return { r: "used", p: same[0] };
    var fit = same.filter(function (p) { return both(p, a, b); })[0];
    return fit ? { r: "right", p: fit } : { r: "wrong", p: same[0] };
  }

  function points(p) { return p.pts; }

  var api = { BOSTON: BOSTON, GUESSES: GUESSES, MIN_FAIR: MIN_FAIR, league: league, grid: grid, answers: answers, judge: judge, points: points };
  root.BG = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
