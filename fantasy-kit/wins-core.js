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
   FK.wins.turn(order, n)                whose pick the nth is (from 1) in a snake
   FK.wins.total(board)                  picks in the whole draft
   FK.wins.onClock(board)                { n, user, round, inRound } or null (not started, or done)
   FK.wins.maxPer(sport, entries)        the most teams each entry can draft
   FK.wins.since(base, now)              a team's { w, l } since the baseline (never below zero)
   FK.wins.table(board, records)         entries ranked: [{ id, name, me, rank, w, l, pct, teams: [{ team, n, w, l }] }]
   FK.wins.available(board, records)     teams nobody has, best record first
   FK.wins.status(row, now)              a pool's line for the pools list, from wn_mine's row */
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
        if (g[0] !== "REG" || as == null || hs == null || !out[a] || !out[h] || as === hs) return;
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
  var total = function (board) { var d = board && board.pool && board.pool.draft; return d ? d.order.length * board.pool.per : 0; };
  function onClock(board) {
    var p = board && board.pool, d = p && p.draft;
    if (!d || p.done) return null;
    var n = (board.picks || []).length + 1, m = d.order.length;
    if (n > total(board)) return null;
    return { n: n, user: turn(d.order, n), round: Math.floor((n - 1) / m) + 1, inRound: ((n - 1) % m) + 1 };
  }
  var maxPer = function (sport, entries) { var n = Object.keys(TEAMS[sport] || {}).length; return Math.max(1, Math.min(16, Math.floor(n / Math.max(1, entries)))); };
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
  function status(row) {
    if (!row) return null;
    if (!row.started) return { text: row.members + (row.members === 1 ? " entry" : " entries") + ", draft not started", tone: "wait" };
    if (!row.done) return row.up ? { text: "You're up: pick " + (row.picks + 1), tone: "todo" } : { text: "Drafting: pick " + (row.picks + 1) + " of " + row.members * row.per, tone: "wait" };
    return { text: row.members + " entries, " + row.per + " teams each", tone: "ok" };
  }

  var api = { TEAMS: TEAMS, SPORTS: SPORTS, logo: logo, teamName: teamName, teamFull: teamFull, records: records, turn: turn, total: total, onClock: onClock,
    maxPer: maxPer, since: since, table: table, available: available, status: status };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.FK = root.FK || {}).wins = api;
})(this);
