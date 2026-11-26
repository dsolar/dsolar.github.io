/* Draft Lab's wins pool: the rules, with no page attached (node --test tests/fantasywins.test.mjs).
   Friends draft real teams in a snake, and the most combined wins from draft day forward takes it. The server
   (tools/fantasykit_wins.sql) keeps the pool, the entries and the picks and enforces the order; everything here works
   from a board as wn_board returns it:
     { pool: { id, name, sport, per, mine, draft: { order: [user ids], started, teams, base: { CODE: { w, l } } }, done },
       members: [{ id, name, me }], picks: [{ n, user, team, at, by }] }
   and from records: { CODE: { w, l } }, each team's record today, from the site's own standings files.

   FK.wins.TEAMS[sport]                  { CODE: [city, name] } in the hubs' codes
   FK.wins.logo(sport, code, px)         ESPN's logo for a team
   FK.wins.records(sport, data)          records from celtics/live.json (nba) or nfl/data/games.json (nfl)
   FK.wins.nflLive(data, week)           games.json with this week's finals filled in from pk_board (the pick'em sync,
                                         every 10 minutes), since games.json only refreshes once a day
   FK.wins.turn(order, n)                whose pick the nth is (from 1) in a snake
   FK.wins.total(board)                  picks in the whole draft
   FK.wins.onClock(board)                { n, user, round, inRound } or null (not started, or done)
   FK.wins.maxPer(sport, entries)        the most teams each entry can draft
   FK.wins.since(base, now)              a team's { w, l } since the baseline (never below zero)
   FK.wins.table(board, records)         entries ranked: [{ id, name, me, rank, w, l, pct, teams: [{ team, n, w, l }] }]
   FK.wins.available(board, records)     teams nobody has, best record first
   FK.wins.status(row, now)              a pool's line for the pools list, from wn_mine's row

   Over/under pools (board.pool.mode "ou"): each pick is a team and a side ("o" or "u") against its win-total line,
   draft.lines = { CODE: wins to the half }, the site's projection of final wins the day the draft started. A team
   can go twice, once each way. A pick scores final wins less the line (over) or the reverse (under); until a team's
   season is in, "final wins" is today's projection.
   FK.wins.projections(sport, data)      { CODE: projected final wins } from nba/data/proj.json or nfl/data/fpi.json
   FK.wins.lines(proj)                   those rounded to the half: the lines a draft starts with
   FK.wins.final(sport, rec, proj)       { w, done }: a team's final wins, actual once its games are all in
   FK.wins.margin(side, line, wins)      what a pick is worth
   FK.wins.tableOu(board, recs, proj)    entries ranked by total margin: [{ ..., m, teams: [{ team, side, line, est, done, m }] }]
   FK.wins.sides(board, recs, proj)      every team with its line and which sides are open */
(function (root) {
  "use strict";
  var TEAMS = {
    nba: { ATL: ["Atlanta", "Hawks"], BOS: ["Boston", "Celtics"], BRK: ["Brooklyn", "Nets"], CHI: ["Chicago", "Bulls"], CHO: ["Charlotte", "Hornets"], CLE: ["Cleveland", "Cavaliers"],
      DAL: ["Dallas", "Mavericks"], DEN: ["Denver", "Nuggets"], DET: ["Detroit", "Pistons"], GSW: ["Golden State", "Warriors"], HOU: ["Houston", "Rockets"], IND: ["Indiana", "Pacers"],
      LAC: ["Los Angeles", "Clippers"], LAL: ["Los Angeles", "Lakers"], MEM: ["Memphis", "Grizzlies"], MIA: ["Miami", "Heat"], MIL: ["Milwaukee", "Bucks"], MIN: ["Minnesota", "Timberwolves"],
      NOP: ["New Orleans", "Pelicans"], NYK: ["New York", "Knicks"], OKC: ["Oklahoma City", "Thunder"], ORL: ["Orlando", "Magic"], PHI: ["Philadelphia", "76ers"], PHO: ["Phoenix", "Suns"],
      POR: ["Portland", "Trail Blazers"], SAC: ["Sacramento", "Kings"], SAS: ["San Antonio", "Spurs"], TOR: ["Toronto", "Raptors"], UTA: ["Utah", "Jazz"], WAS: ["Washington", "Wizards"] },
    nfl: { ARI: ["Arizona", "Cardinals"], ATL: ["Atlanta", "Falcons"], BAL: ["Baltimore", "Ravens"], BUF: ["Buffalo", "Bills"], CAR: ["Carolina", "Panthers"], CHI: ["Chicago", "Bears"],
      CIN: ["Cincinnati", "Bengals"], CLE: ["Cleveland", "Browns"], DAL: ["Dallas", "Cowboys"], DEN: ["Denver", "Broncos"], DET: ["Detroit", "Lions"], GB: ["Green Bay", "Packers"],
      HOU: ["Houston", "Texans"], IND: ["Indianapolis", "Colts"], JAX: ["Jacksonville", "Jaguars"], KC: ["Kansas City", "Chiefs"], LAC: ["Los Angeles", "Chargers"], LAR: ["Los Angeles", "Rams"],
      LV: ["Las Vegas", "Raiders"], MIA: ["Miami", "Dolphins"], MIN: ["Minnesota", "Vikings"], NE: ["New England", "Patriots"], NO: ["New Orleans", "Saints"], NYG: ["New York", "Giants"],
      NYJ: ["New York", "Jets"], PHI: ["Philadelphia", "Eagles"], PIT: ["Pittsburgh", "Steelers"], SEA: ["Seattle", "Seahawks"], SF: ["San Francisco", "49ers"], TB: ["Tampa Bay", "Buccaneers"],
      TEN: ["Tennessee", "Titans"], WAS: ["Washington", "Commanders"] },
  };
  var SPORTS = { nba: { key: "nba", name: "NBA", games: 82 }, nfl: { key: "nfl", name: "NFL", games: 17 } };
  // the hubs' codes that ESPN spells another way, for its logo server
  var ESPN = { nba: { BRK: "bkn", CHO: "cha", PHO: "phx", GSW: "gs", NOP: "no", NYK: "ny", SAS: "sa", UTA: "utah", WAS: "wsh" }, nfl: { WAS: "wsh" } };
  function logo(sport, code, px) {
    var e = (ESPN[sport] || {})[code] || String(code || "").toLowerCase(), s = (px || 28) * 2;
    return "https://a.espncdn.com/combiner/i?img=/i/teamlogos/" + sport + "/500/" + e + ".png&w=" + s + "&h=" + s;
  }
  var teamName = function (sport, code) { var t = (TEAMS[sport] || {})[code]; return t ? t[1] : code; };
  var teamFull = function (sport, code) { var t = (TEAMS[sport] || {})[code]; return t ? t[0] + " " + t[1] : code; };

  // Every team's record today. NBA: celtics/live.json's standings. NFL: counted from the hub's schedule (a tie is
  // neither a win nor a loss here, like the standings' win column).
  function records(sport, data) {
    var out = {}, codes = Object.keys(TEAMS[sport] || {});
    codes.forEach(function (c) { out[c] = { w: 0, l: 0 }; });
    if (!data) return null;
    if (sport === "nba") {
      var st = data.standings;
      if (!st) return null;
      codes.forEach(function (c) { if (st[c]) out[c] = { w: +st[c].w || 0, l: +st[c].l || 0 }; });
      return out;
    }
    if (sport === "nfl") {
      if (!Array.isArray(data.games)) return null;
      data.games.forEach(function (g) {
        var a = g[3], h = g[4], as = g[5], hs = g[6];
        if (g[0] !== "REG" || as == null || hs == null || !out[a] || !out[h]) return;
        if (as === hs) { out[a].t = (out[a].t || 0) + 1; out[h].t = (out[h].t || 0) + 1; return; }
        if (as > hs) { out[a].w++; out[h].l++; } else { out[h].w++; out[a].l++; }
      });
      return out;
    }
    return null;
  }

  function turn(order, n) {
    var m = (order || []).length;
    if (!m || n < 1) return null;
    var r = Math.floor((n - 1) / m), k = (n - 1) % m;
    return order[r % 2 === 0 ? k : m - 1 - k];
  }
  var isOu = function (board) { return !!(board && board.pool && board.pool.mode === "ou"); };
  var total = function (board) { var d = board && board.pool && board.pool.draft; return d ? d.order.length * board.pool.per : 0; };
  function onClock(board) {
    var p = board && board.pool, d = p && p.draft;
    if (!d || p.done) return null;
    var n = (board.picks || []).length + 1, m = d.order.length;
    if (n > total(board)) return null;
    return { n: n, user: turn(d.order, n), round: Math.floor((n - 1) / m) + 1, inRound: ((n - 1) % m) + 1 };
  }
  var maxPer = function (sport, entries, mode) { var n = Object.keys(TEAMS[sport] || {}).length * (mode === "ou" ? 2 : 1); return Math.max(1, Math.min(16, Math.floor(n / Math.max(1, entries)))); };
  function since(base, now) {
    base = base || { w: 0, l: 0 }; now = now || base;
    return { w: Math.max(0, (now.w || 0) - (base.w || 0)), l: Math.max(0, (now.l || 0) - (base.l || 0)) };
  }
  // Entries ranked by wins since the draft, then fewer losses. Entries level on both share a rank.
  function table(board, recs) {
    var p = board.pool, d = p.draft || {}, base = d.base || {}, by = {};
    (board.members || []).forEach(function (m) { by[m.id] = { id: m.id, name: m.name, me: !!m.me, w: 0, l: 0, teams: [] }; });
    (board.picks || []).forEach(function (k) {
      var row = by[k.user]; if (!row) return;
      var s = recs ? since(base[k.team], recs[k.team]) : { w: 0, l: 0 };
      row.teams.push({ team: k.team, n: k.n, w: s.w, l: s.l });
      row.w += s.w; row.l += s.l;
    });
    var order = d.order || [];
    var rows = Object.keys(by).map(function (id) { return by[id]; });
    rows.forEach(function (r) { r.pct = r.w + r.l ? r.w / (r.w + r.l) : 0; r.teams.sort(function (a, b) { return b.w - a.w || a.l - b.l || a.n - b.n; }); });
    rows.sort(function (a, b) { return b.w - a.w || a.l - b.l || order.indexOf(a.id) - order.indexOf(b.id) || String(a.name).localeCompare(String(b.name)); });
    rows.forEach(function (r, i) { var up = rows[i - 1]; r.rank = up && up.w === r.w && up.l === r.l ? up.rank : i + 1; });
    return rows;
  }
  function available(board, recs) {
    var d = board.pool.draft; if (!d) return [];
    var taken = {}; (board.picks || []).forEach(function (k) { taken[k.team] = 1; });
    var pct = function (r) { return r && r.w + r.l ? r.w / (r.w + r.l) : 0; };
    return d.teams.filter(function (t) { return !taken[t]; }).map(function (t) { var r = (recs && recs[t]) || (d.base && d.base[t]) || { w: 0, l: 0 }; return { team: t, w: r.w, l: r.l, pct: pct(r) }; })
      .sort(function (a, b) { return b.pct - a.pct || b.w - a.w || (a.team < b.team ? -1 : 1); });
  }
  // ---------- over/under ----------
  // the projections' codes that the standings spell another way
  var PROJ_CODE = { nba: { BKN: "BRK", CHA: "CHO", PHX: "PHO" }, nfl: {} };
  function projections(sport, data) {
    var t = data && data.teams, out = {}, n = 0;
    if (!t) return null;
    Object.keys(t).forEach(function (k) {
      var code = (PROJ_CODE[sport] || {})[k] || k, v = sport === "nba" ? t[k].w : t[k].projW;
      if ((TEAMS[sport] || {})[code] && typeof v === "number" && isFinite(v)) { out[code] = v; n++; }
    });
    return n === Object.keys(TEAMS[sport] || {}).length ? out : null;
  }
  function lines(proj) {
    if (!proj) return null;
    var out = {};
    Object.keys(proj).forEach(function (k) { out[k] = Math.round(proj[k] * 2) / 2; });
    return out;
  }
  // A team's final wins: what it has once every game is in, today's projection until then (or its pace, if there's
  // no projection to be had).
  function final(sport, rec, proj) {
    var G = SPORTS[sport].games, r = rec || { w: 0, l: 0 }, gp = (r.w || 0) + (r.l || 0) + (r.t || 0);
    if (gp >= G) return { w: r.w || 0, done: true };
    if (typeof proj === "number" && isFinite(proj)) return { w: Math.max(r.w || 0, Math.min(G - (r.l || 0), proj)), done: false };
    return { w: gp ? Math.round((r.w / gp) * G * 10) / 10 : G / 2, done: false };
  }
  var margin = function (side, line, wins) { return Math.round((side === "u" ? line - wins : wins - line) * 10) / 10; };
  function tableOu(board, recs, proj) {
    var d = board.pool.draft || {}, ln = d.lines || {}, by = {}, order = d.order || [];
    (board.members || []).forEach(function (m) { by[m.id] = { id: m.id, name: m.name, me: !!m.me, m: 0, teams: [] }; });
    (board.picks || []).forEach(function (k) {
      var row = by[k.user]; if (!row) return;
      var f = recs ? final(board.pool.sport, recs[k.team], proj ? proj[k.team] : null) : { w: ln[k.team], done: false };
      var mg = recs && ln[k.team] != null ? margin(k.side, ln[k.team], f.w) : 0;
      row.teams.push({ team: k.team, side: k.side, n: k.n, line: ln[k.team], est: Math.round(f.w * 10) / 10, done: f.done, m: mg });
      row.m = Math.round((row.m + mg) * 10) / 10;
    });
    var rows = Object.keys(by).map(function (id) { return by[id]; });
    rows.forEach(function (r) { r.teams.sort(function (a, b) { return b.m - a.m || a.n - b.n; }); });
    rows.sort(function (a, b) { return b.m - a.m || order.indexOf(a.id) - order.indexOf(b.id) || String(a.name).localeCompare(String(b.name)); });
    rows.forEach(function (r, i) { var up = rows[i - 1]; r.rank = up && up.m === r.m ? up.rank : i + 1; });
    return rows;
  }
  function sides(board, recs, proj) {
    var d = board.pool.draft; if (!d) return [];
    var ln = d.lines || {}, took = {};
    (board.picks || []).forEach(function (k) { took[k.team + ":" + k.side] = k; });
    return d.teams.map(function (t) {
      var r = (recs && recs[t]) || (d.base && d.base[t]) || { w: 0, l: 0 };
      return { team: t, w: r.w, l: r.l, line: ln[t], est: proj && proj[t] != null ? Math.round(proj[t] * 10) / 10 : null, o: took[t + ":o"] || null, u: took[t + ":u"] || null };
    }).sort(function (a, b) { return (b.line || 0) - (a.line || 0) || (a.team < b.team ? -1 : 1); });
  }

  function status(row) {
    if (!row) return null;
    if (!row.started) return { text: row.members + (row.members === 1 ? " entry" : " entries") + ", draft not started", tone: "wait" };
    if (!row.done) return row.up ? { text: "You're up: pick " + (row.picks + 1), tone: "todo" } : { text: "Drafting: pick " + (row.picks + 1) + " of " + row.members * row.per, tone: "wait" };
    return { text: row.members + " entries, " + row.per + " teams each", tone: "ok" };
  }

  function nflLive(data, wk) {
    if (!data || !Array.isArray(data.games) || !wk || !Array.isArray(wk.games) || wk.stype !== 2) return data;
    var code = function (t) { return t === "WSH" ? "WAS" : t; }, n = 0;
    var games = data.games.map(function (g) {
      if (g[0] !== "REG" || g[1] !== wk.week || g[5] != null) return g;
      var x = wk.games.filter(function (y) { return y.final && code(y.away) === g[3] && code(y.home) === g[4] && y.awayScore != null && y.homeScore != null; })[0];
      if (!x) return g;
      n++; var out = g.slice(); out[5] = x.awayScore; out[6] = x.homeScore; return out;
    });
    return n ? Object.assign({}, data, { games: games, live: n }) : data;
  }
  var api = { TEAMS: TEAMS, SPORTS: SPORTS, logo: logo, teamName: teamName, teamFull: teamFull, records: records, nflLive: nflLive, turn: turn, total: total, onClock: onClock,
    maxPer: maxPer, since: since, table: table, available: available, status: status,
    isOu: isOu, projections: projections, lines: lines, final: final, margin: margin, tableOu: tableOu, sides: sides };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.FK = root.FK || {}).wins = api;
})(this);
