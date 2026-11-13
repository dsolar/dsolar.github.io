/* NHL Hub: screens. Everything comes from data/hub.json, built every morning by tools/nhl_hub_build.py from NHL's API
   and MoneyPuck.com's season files. Routes live in the address bar so any view can be shared:
     #/standings?v=wc   #/teams   #/team/BOS   #/players?g=D&t=BOS&s=war   #/method */
(function () {
  "use strict";
  var H = null, TEAMS = {}, PLAYERS = {}, ROSTER = {};
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var view = $("#view"), card = $("#card"), cardBody = $("#cardBody");
  var state = { route: "standings", arg: null, q: {} };

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function f1(x) { return x == null || isNaN(x) ? "—" : (Math.round(x * 10) / 10).toFixed(1); }
  function f2(x) { return x == null || isNaN(x) ? "—" : x.toFixed(2); }
  function sgn(x, d) { if (x == null || isNaN(x)) return "—"; var s = x.toFixed(d == null ? 1 : d); return x > 0 ? "+" + s : s.replace("-", "−"); }
  function pct(x) {
    if (x == null) return "—";
    if (x >= 0.9995) return ">99.9%";
    if (x > 0 && x < 0.001) return "<0.1%";
    return (x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0) + "%";
  }
  function oddbar(x) { return '<span class="oddbar">' + pct(x) + '<i><b style="width:' + Math.round(Math.min(1, x || 0) * 100) + '%"></b></i></span>'; }
  function toi(min) { if (!min) return "—"; var m = Math.floor(min), s = Math.round((min - m) * 60); if (s === 60) { m++; s = 0; } return m + ":" + (s < 10 ? "0" : "") + s; }
  function ord(n) { var v = n % 100; return n + (v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"); }
  function logo(t, size) { return t ? '<img class="logo" src="' + esc(t.logo) + '" alt="" loading="lazy"' + (size ? ' style="width:' + size + "px;height:" + size + 'px"' : "") + ">" : ""; }
  function hs(p, size) { return '<img class="hs" src="' + esc(p.head || "") + '" alt="" loading="lazy" style="--s:' + (size || 28) + 'px" onerror="this.style.visibility=\'hidden\'">'; }
  function pname(p, size) {
    return '<span class="pl" data-p="' + p.id + '">' + (size === 0 ? "" : hs(p, size || 24)) + '<span class="nm">' + esc(p.name) + "</span></span>";
  }
  function last(p) { var n = p.name.split(" "); return n.slice(1).join(" ") || p.name; }
  function rec(t) { var r = t.rec; return r.wins + "-" + r.losses + "-" + r.otLosses; }
  function gd(t) { return t.rec.goalFor - t.rec.goalAgainst; }
  function posLabel(p) { return { C: "C", L: "LW", R: "RW", D: "D", G: "G" }[p.pos] || p.pos; }

  // How good a player is next to the league's regulars at his position, from his rank
  var TIERS = {
    F: [[32, "Star"], [96, "First line"], [192, "Top six"], [288, "Middle six"], [384, "Bottom six"], [1e9, "Depth"]],
    D: [[20, "No. 1 D"], [64, "Top pair"], [128, "Top four"], [192, "Third pair"], [1e9, "Depth"]],
    G: [[8, "Elite"], [20, "Good starter"], [32, "Starter"], [64, "Backup"], [1e9, "Depth"]]
  };
  function tier(p) {
    var list = TIERS[p.grp], i;
    for (i = 0; i < list.length; i++) if (p.rank <= list[i][0]) return { label: list[i][1], i: Math.min(4, Math.round(i * 4 / (list.length - 1))) };
    return { label: "Depth", i: 4 };
  }
  function tierDot(p) { var t = tier(p); return '<i class="tierdot t' + t.i + '" title="' + esc(t.label) + '"></i>'; }

  // ---------- one game ----------
  function pois(l, k) { var f = 1; for (var i = 2; i <= k; i++) f *= i; return Math.exp(-l) * Math.pow(l, k) / f; }
  // home margin in goals -> chance the home team wins (in regulation, or in overtime and the shootout)
  function homeWin(margin) {
    var P = H.params, lh = Math.max(0.4, P.regGoals + margin / 2), la = Math.max(0.4, P.regGoals - margin / 2);
    var ph = [], pa = [], i, j, w = 0, t = 0;
    for (i = 0; i < 15; i++) { ph.push(pois(lh, i)); pa.push(pois(la, i)); }
    for (i = 0; i < 15; i++) { t += ph[i] * pa[i]; for (j = 0; j < i; j++) w += ph[i] * pa[j]; }
    return w + t / (1 + Math.exp(-margin * 0.55));
  }
  function winVs(team, opp, home) { var m = team.rating - opp.rating + (home ? 1 : -1) * H.params.homeEdge; return homeWin(m); }

  // ---------- routing ----------
  function parse() {
    var h = location.hash.replace(/^#\/?/, ""), parts = h.split("?"), path = parts[0].split("/"), q = {};
    (parts[1] || "").split("&").forEach(function (kv) { if (!kv) return; var a = kv.split("="); q[decodeURIComponent(a[0])] = decodeURIComponent(a[1] || ""); });
    state.route = path[0] || "standings";
    state.arg = path[1] || null;
    state.q = q;
  }
  function go(route, arg, q) {
    var s = "#/" + route + (arg ? "/" + arg : ""), k = Object.keys(q || {}).filter(function (x) { return q[x] !== "" && q[x] != null; });
    if (k.length) s += "?" + k.map(function (x) { return encodeURIComponent(x) + "=" + encodeURIComponent(q[x]); }).join("&");
    if (location.hash !== s) location.hash = s; else render();
  }
  function setQ(patch) { var q = Object.assign({}, state.q, patch); go(state.route, state.arg, q); }

  function render() {
    parse();
    var r = state.route, tab = r === "team" ? "teams" : r;
    document.querySelectorAll(".tabs a").forEach(function (a) { if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    if (r === "teams") view.innerHTML = teamsView();
    else if (r === "team" && TEAMS[state.arg]) view.innerHTML = teamView(TEAMS[state.arg]);
    else if (r === "players") view.innerHTML = playersView();
    else if (r === "method") view.innerHTML = methodView();
    else view.innerHTML = standingsView();
    var k = { standings: "Standings", teams: "Teams", team: TEAMS[state.arg] ? TEAMS[state.arg].name : "Teams", players: "Player Ratings", method: "How it works" }[r] || "Standings";
    document.title = k + " · NHL Hub | David Solar";
  }

  // ---------- standings ----------
  function standRow(t, i, cut, wide) {
    return '<tr class="go' + (cut ? " cut" : "") + '" data-team="' + t.abbr + '">' +
      '<td class="tm"><span class="rk">' + (i + 1) + "</span>" + logo(t) + '<span class="nm">' + esc(t.common) + "</span></td>" +
      "<td class=\"hide-m\">" + t.rec.gamesPlayed + "</td><td class=\"hide-m\">" + rec(t) + "</td><td><b>" + t.rec.points + '</b></td><td class="hide-m ' + (gd(t) > 0 ? "pos" : gd(t) < 0 ? "neg" : "") + '">' + sgn(gd(t), 0) + "</td>" +
      '<td class="hide-m ' + (t.rating > 0 ? "pos" : "neg") + '">' + sgn(t.rating, 2) + "</td>" +
      "<td>" + Math.round(t.projPts) + '</td><td class="odds">' + oddbar(t.odds.po) + "</td>" + (wide ? '<td class="hide-m">' + pct(t.odds.div) + "</td>" : "") + "<td>" + pct(t.odds.cup) + "</td></tr>";
  }
  function standHead(wide) { return STAND_HEAD.replace(wide ? "" : '<th class="hide-m">Division</th>', ""); }
  var STAND_HEAD = "<thead><tr><th>Team</th><th class=\"hide-m\">GP</th><th class=\"hide-m\">W-L-OT</th><th>PTS</th><th class=\"hide-m\" title=\"Goal differential\">GD</th>" +
    '<th class="hide-m" title="Goals a game better than an average team, on neutral ice">Strength</th>' +
    '<th title="Projected points at the end of the regular season">Proj</th><th>Playoffs</th><th class="hide-m">Division</th><th>Cup</th></tr></thead>';
  function byPoints(a, b) { return b.rec.points - a.rec.points || a.rec.gamesPlayed - b.rec.gamesPlayed || b.rec.regulationWins - a.rec.regulationWins || b.projPts - a.projPts; }

  function standingsView() {
    var v = state.q.v || "div";
    var teams = H.teams.slice();
    var fav = teams.slice().sort(function (a, b) { return b.odds.cup - a.odds.cup; }).slice(0, 8);
    var h = '<h2 class="sec">Stanley Cup odds</h2><p class="lede">The rest of the regular season, ' + H.gamesLeft.toLocaleString() + " games, played out " +
      H.sims.toLocaleString() + " times from each team's strength, then the playoffs to the Cup. Updated every morning through " + fmtDate(H.asOf) + ".</p>" +
      '<div class="cupstrip">' + fav.map(function (t) { return '<a href="#/team/' + t.abbr + '">' + logo(t, 30) + "<div><b>" + pct(t.odds.cup) + "</b><span>" + esc(t.common) + "</span></div></a>"; }).join("") + "</div>";
    h += '<div class="toolbar"><h2 class="sec" style="margin:0">Standings</h2><div class="seg" role="group" aria-label="Standings view">' +
      [["div", "Division"], ["wc", "Wild card"], ["league", "League"]].map(function (x) { return '<button type="button" data-v="' + x[0] + '" aria-pressed="' + (v === x[0]) + '">' + x[1] + "</button>"; }).join("") + "</div></div>";
    if (v === "league") {
      teams.sort(byPoints);
      h += '<div class="div"><table class="t">' + standHead(true) + "<tbody>" + teams.map(function (t, i) { return standRow(t, i, i === 15, true); }).join("") + "</tbody></table></div>";
    } else {
      h += '<div class="leagues">' + ["E", "W"].map(function (c) {
        var ct = teams.filter(function (t) { return t.conf === c; }), divs = {};
        ct.forEach(function (t) { (divs[t.div] = divs[t.div] || []).push(t); });
        var names = Object.keys(divs).sort();
        var out = '<div class="conf"><h3 class="ch">' + (c === "E" ? "Eastern" : "Western") + " Conference</h3>";
        if (v === "div") {
          out += names.map(function (d) {
            var rows = divs[d].sort(byPoints);
            return '<div class="div"><h3>' + esc(d) + '</h3><table class="t">' + standHead(false) + "<tbody>" + rows.map(function (t, i) { return standRow(t, i, i === 2); }).join("") + "</tbody></table></div>";
          }).join("");
        } else {
          var top = [], rest = [];
          names.forEach(function (d) { var rows = divs[d].sort(byPoints); top.push([d, rows.slice(0, 3)]); rest = rest.concat(rows.slice(3)); });
          rest.sort(byPoints);
          out += top.map(function (x) { return '<div class="div"><h3>' + esc(x[0]) + ' · top three</h3><table class="t">' + standHead(false) + "<tbody>" + x[1].map(function (t, i) { return standRow(t, i, false); }).join("") + "</tbody></table></div>"; }).join("");
          out += '<div class="div"><h3>Wild card</h3><table class="t">' + standHead(false) + "<tbody>" + rest.map(function (t, i) { return standRow(t, i, i === 1); }).join("") + "</tbody></table></div>";
        }
        return out + "</div>";
      }).join("") + "</div>";
    }
    h += '<p class="note">Strength is goals a game better than an average team on neutral ice. Home ice is worth another ' + H.params.homeEdge.toFixed(2) +
      " goals a game. The dashed line marks the playoff cut. Ties in the table go to fewer games played, then regulation wins.</p>";
    return h;
  }
  function fmtDate(s) {
    if (!s) return "";
    var d = new Date(s + "T12:00:00");
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  }

  // ---------- teams ----------
  function teamsView() {
    var h = '<h2 class="sec">Teams</h2><p class="lede">Every team\'s lines and pairings, goalies, roster ratings and what\'s left of its schedule.</p>';
    ["E", "W"].forEach(function (c) {
      var ct = H.teams.filter(function (t) { return t.conf === c; }), divs = {};
      ct.forEach(function (t) { (divs[t.div] = divs[t.div] || []).push(t); });
      Object.keys(divs).sort().forEach(function (d) {
        h += '<h3 class="card-sec">' + esc(d) + '</h3><div class="teamgrid">' + divs[d].sort(byPoints).map(function (t) {
          return '<a href="#/team/' + t.abbr + '">' + logo(t, 34) + "<div><b>" + esc(t.name) + "</b><span>" + rec(t) + " · " + t.rec.points + " pts · playoffs " + pct(t.odds.po) + "</span></div></a>";
        }).join("") + "</div>";
      });
    });
    return h;
  }

  function man(id, extra) {
    var p = PLAYERS[id];
    if (!p) return '<div class="man"><div class="who"><b>—</b></div></div>';
    return '<div class="man" data-p="' + p.id + '">' + hs(p, 30) + '<div class="who"><b>' + tierDot(p) + esc(last(p)) + "</b><span>" + posLabel(p) + " · " + sgn(p.war, 1) + " WAR" + (extra ? " · " + extra : "") + "</span></div></div>";
  }
  // forwards in a line as left wing, center, right wing where their listed positions allow
  function orderLine(ids) {
    var ps = ids.map(function (i) { return PLAYERS[i]; }).filter(Boolean);
    if (ps.length !== 3) return ids;
    var slots = { L: null, C: null, R: null }, left = [];
    ps.forEach(function (p) { if (slots[p.pos] === null) slots[p.pos] = p; else left.push(p); });
    ["L", "C", "R"].forEach(function (k) { if (!slots[k]) slots[k] = left.shift(); });
    return [slots.L, slots.C, slots.R].map(function (p) { return p.id; });
  }
  function unitRow(label, sub, ids, res, n) {
    return '<div class="unit"><div class="lab">' + label + (sub ? "<small>" + sub + "</small>" : "") + '</div><div class="men" style="--n:' + (n || ids.length) + '">' +
      ids.map(function (i) { return man(i); }).join("") + '</div><div class="res">' + (res || "") + "</div></div>";
  }
  function lineRes(l) {
    return "<b>" + (l.xgp == null ? "—" : (l.xgp * 100).toFixed(0) + "%") + "</b>xG share · " + l.gf + "-" + l.ga + " goals<br>" + Math.round(l.min) + " min together";
  }

  function teamView(t) {
    var r = t.rec, ps = ROSTER[t.abbr] || [];
    var rank = H.teams.slice().sort(function (a, b) { return b.rating - a.rating; }).indexOf(t) + 1;
    var h = '<div class="thead">' + logo(t, 54) + "<div><h2>" + esc(t.name) + '</h2><div class="meta">' + rec(t) + " · " + r.points + " points in " + r.gamesPlayed + " games · " +
      esc(t.div) + " Division · L10 " + r.l10Wins + "-" + r.l10Losses + "-" + r.l10OtLosses + " · " + (r.streakCode ? r.streakCode + r.streakCount + " streak" : "") +
      '</div></div><a class="back" href="#/teams">All teams</a></div>';
    h += '<div class="teampick">' + H.teams.slice().sort(function (a, b) { return a.abbr < b.abbr ? -1 : 1; }).map(function (x) {
      return '<a href="#/team/' + x.abbr + '"' + (x === t ? ' style="border-color:var(--ink)"' : "") + ">" + logo(x, 18) + x.abbr + "</a>";
    }).join("") + "</div>";
    h += '<div class="stats">' +
      '<div class="stat"><b class="' + (t.rating >= 0 ? "pos" : "neg") + '">' + sgn(t.rating, 2) + "</b><span>Strength · " + ord(rank) + "</span></div>" +
      '<div class="stat"><b>' + Math.round(t.projPts) + "</b><span>Projected points</span></div>" +
      '<div class="stat"><b>' + pct(t.odds.po) + "</b><span>Make playoffs</span></div>" +
      '<div class="stat"><b>' + pct(t.odds.div) + "</b><span>Win division</span></div>" +
      '<div class="stat"><b>' + pct(t.odds.cf) + "</b><span>Reach conf. final</span></div>" +
      '<div class="stat"><b>' + pct(t.odds.cup) + "</b><span>Win the Cup</span></div></div>";

    // lines and pairings
    var lines = '<div class="rink"><h3>Forward lines <small>Most-used 5-on-5 trios this season, among players still here</small></h3>';
    lines += t.lines.length ? t.lines.map(function (l, i) { return unitRow("Line " + (i + 1), "", orderLine(l.ids), lineRes(l), 3); }).join("") : '<p class="note">No line data yet.</p>';
    lines += '</div><div class="rink"><h3>Defense pairs <small>Most-used 5-on-5 pairs</small></h3>';
    lines += t.pairs.length ? t.pairs.map(function (l, i) { return unitRow("Pair " + (i + 1), "", l.ids, lineRes(l), 2); }).join("") : '<p class="note">No pairing data yet.</p>';
    lines += '</div><div class="rink"><h3>Goalies <small>Expected share of the starts left</small></h3>' +
      t.goalies.map(function (g, i) { var p = PLAYERS[g[0]]; return unitRow(i === 0 ? "Starter" : "Backup", "", [g[0]], "<b>" + Math.round(g[1] * 100) + "%</b>of starts" + (p && p.now ? "<br>" + (p.now.sv != null ? p.now.sv.toFixed(3).replace(/^0/, "") + " sv%" : "") : ""), 1); }).join("") + "</div>";
    var special = '<div class="rink"><h3>Special teams <small>By ice time a game</small></h3>' +
      (t.pp.length ? unitRow("PP1", toi(avgUse(t.pp.slice(0, 5), "pp")) + " a game", t.pp.slice(0, 5), "", 5) : "") +
      (t.pp.length > 5 ? unitRow("PP2", toi(avgUse(t.pp.slice(5, 10), "pp")) + " a game", t.pp.slice(5, 10), "", 5) : "") +
      (t.pk.length ? unitRow("PK", "most used", t.pk.slice(0, 4), "", 4) : "") + "</div>";
    h += lines + special;

    // strength breakdown
    var C = t.comp, parts = [["evo", "Even-strength offense"], ["evd", "Even-strength defense"], ["ppo", "Power play"], ["pkd", "Penalty kill"], ["gk", "Goaltending"], ["fin", "Finishing"], ["pen", "Penalties"], ["fo", "Faceoffs"]];
    var mx = Math.max.apply(null, parts.map(function (x) { return Math.abs(C[x[0]] || 0); }).concat([0.15]));
    var brk = '<div class="panel"><h3>Where the strength comes from <small>Goals a game vs average, from the lineup</small></h3><div class="body">' +
      parts.map(function (x) { return compbar(x[1], C[x[0]] || 0, mx, 2); }).join("") +
      '<p class="note" style="margin:8px 0 0">The lineup\'s ratings say ' + sgn(t.prior, 2) + " goals a game; its results so far (expected goals, and some of its real goal differential) say " + sgn(t.obs, 2) +
      ". After " + r.gamesPlayed + " games the strength above leans " + Math.round(r.gamesPlayed / (r.gamesPlayed + H.params.teamK) * 100) + "% on the results.</p></div></div>";
    // the next stretch of the schedule
    var games = H.schedule.filter(function (g) { return g[3] == null && (g[1] === t.abbr || g[2] === t.abbr); }).slice(0, 10);
    var done = H.schedule.filter(function (g) { return g[3] != null && (g[1] === t.abbr || g[2] === t.abbr); }).slice(-5).reverse();
    var sch = '<div class="panel"><h3>Next ten games <small>Chance to win</small></h3><ul class="games">' + games.map(function (g) {
      var home = g[2] === t.abbr, opp = TEAMS[home ? g[1] : g[2]], p = winVs(t, opp, home);
      return '<li><span class="d">' + shortDate(g[0]) + "</span>" + logo(opp, 22) + "<span>" + (home ? "vs " : "at ") + esc(opp.common) + "</span><b>" + Math.round(p * 100) + "%</b></li>";
    }).join("") + '</ul></div><div class="panel"><h3>Last five</h3><ul class="games">' + done.map(function (g) {
      var home = g[2] === t.abbr, opp = TEAMS[home ? g[1] : g[2]], us = home ? g[4] : g[3], them = home ? g[3] : g[4];
      var res = us > them ? "W" : g[5] && g[5] !== "REG" ? "OTL" : "L";
      return '<li><span class="d">' + shortDate(g[0]) + "</span>" + logo(opp, 22) + "<span>" + (home ? "vs " : "at ") + esc(opp.common) + "</span><b>" + res + " " + us + "-" + them + (g[5] && g[5] !== "REG" ? " " + g[5] : "") + "</b></li>";
    }).join("") + "</ul></div>";
    h += '<div class="two"><div>' + brk + "</div><div>" + sch + "</div></div>";

    // roster
    var sk = ps.filter(function (p) { return p.grp !== "G"; }).sort(function (a, b) { return b.war - a.war; });
    var gs = ps.filter(function (p) { return p.grp === "G"; }).sort(function (a, b) { return b.war - a.war; });
    h += '<h3 class="card-sec">Roster</h3><div class="div"><table class="t"><thead><tr><th>Skater</th><th>Pos</th><th class="hide-m">Age</th><th>GP</th><th>G</th><th>A</th><th>P</th><th class="hide-m">TOI</th>' +
      '<th title="Wins above replacement over 82 games at his ice time">WAR/82</th><th class="hide-m" title="Goals above replacement this season so far">This season</th></tr></thead><tbody>' +
      sk.map(function (p) {
        var n = p.now || {};
        return '<tr><td>' + pname(p) + "</td><td>" + posLabel(p) + '</td><td class="hide-m">' + (p.age || "—") + "</td><td>" + (n.gp || 0) + "</td><td>" + (n.g || 0) + "</td><td>" + (n.a || 0) + "</td><td>" + (n.pts || 0) +
          '</td><td class="hide-m">' + (n.toi ? toi(n.toi / 60) : "—") + "</td><td><b>" + tierDot(p) + f1(p.war) + '</b></td><td class="hide-m">' + (p.gar_now == null ? "—" : sgn(p.gar_now) + " GAR") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    h += '<div class="div"><table class="t"><thead><tr><th>Goalie</th><th class="hide-m">Age</th><th>GP</th><th>W-L-OT</th><th>Sv%</th><th class="hide-m">GAA</th><th title="Wins above replacement over 58 starts">WAR/58</th><th class="hide-m">This season</th></tr></thead><tbody>' +
      gs.map(function (p) {
        var n = p.now || {};
        return "<tr><td>" + pname(p) + '</td><td class="hide-m">' + (p.age || "—") + "</td><td>" + (n.gp || 0) + "</td><td>" + (n.gp ? n.w + "-" + n.l + "-" + n.otl : "—") + "</td><td>" + (n.sv != null && n.gp ? n.sv.toFixed(3).replace(/^0/, "") : "—") +
          '</td><td class="hide-m">' + (n.gaa != null && n.gp ? n.gaa.toFixed(2) : "—") + "</td><td><b>" + tierDot(p) + f1(p.war) + '</b></td><td class="hide-m">' + (p.gar_now == null ? "—" : sgn(p.gar_now) + " GAR") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    return h;
  }
  function avgUse(ids, k) { var s = 0, n = 0; ids.forEach(function (i) { var p = PLAYERS[i]; if (p && p.use) { s += p.use[k]; n++; } }); return n ? s / n : 0; }
  function shortDate(s) { var d = new Date(s + "T12:00:00"); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  function compbar(label, v, mx, d) {
    var w = Math.min(50, Math.abs(v) / mx * 50);
    return '<div class="compbar"><span>' + label + '</span><span class="track"><i></i><b style="' + (v >= 0 ? "left:50%" : "right:50%") + ";width:" + w.toFixed(1) + "%;background:" + (v >= 0 ? "var(--up)" : "var(--down)") + '"></b></span><span class="v">' + sgn(v, d == null ? 1 : d) + "</span></div>";
  }

  // ---------- players ----------
  var SK_COLS = [
    ["war", "WAR/82", "Wins above replacement over 82 games at his ice time"], ["gar_now", "This season", "Goals above replacement so far this season, before any regression"],
    ["evo", "EV off", "Even-strength offense, goals above average over 82"], ["evd", "EV def", "Even-strength defense"], ["ppo", "PP", "Power play"], ["pkd", "PK", "Penalty kill"],
    ["fin", "Finish", "Finishing: goals over his own expected goals, mostly regressed away"], ["pen", "Pen", "Penalties drawn minus taken"]
  ];
  function playersView() {
    var q = state.q, g = q.g || "F", team = q.t || "", s = q.s || "war", find = (q.q || "").toLowerCase(), page = +(q.p || 0), per = 50;
    var list = H.players.filter(function (p) { return p.grp === g && (!team || p.team === team) && (!find || p.name.toLowerCase().indexOf(find) >= 0); });
    function val(p) {
      if (s === "war") return p.war; if (s === "gar_now") return p.gar_now == null ? -99 : p.gar_now;
      if (s === "age") return -(p.age || 0); if (s === "gsax60") return p.gsax60;
      return p.comp ? p.comp[s] : 0;
    }
    list.sort(function (a, b) { return val(b) - val(a); });
    var pages = Math.max(1, Math.ceil(list.length / per)); page = Math.min(page, pages - 1);
    var shown = list.slice(page * per, page * per + per);
    var h = '<h2 class="sec">Player ratings</h2><p class="lede">Wins above replacement for every skater and goalie on an NHL roster, from three seasons of MoneyPuck\'s expected goals, weighted toward this one. ' +
      "A replacement player is the kind of skater or goalie a team can call up or claim for nothing. Click anyone for the breakdown.</p>";
    h += '<div class="controls"><label>Position<span class="seg" role="group">' + [["F", "Forwards"], ["D", "Defense"], ["G", "Goalies"]].map(function (x) {
      return '<button type="button" data-g="' + x[0] + '" aria-pressed="' + (g === x[0]) + '">' + x[1] + "</button>";
    }).join("") + '</span></label><label>Team<select id="pteam"><option value="">All teams</option>' +
      H.teams.slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; }).map(function (t) { return '<option value="' + t.abbr + '"' + (t.abbr === team ? " selected" : "") + ">" + esc(t.name) + "</option>"; }).join("") +
      '</select></label><label>Find<input type="search" id="pfind" placeholder="Player name" value="' + esc(q.q || "") + '"></label></div>';
    var cols = g === "G" ? [["war", "WAR/58", "Wins above replacement over 58 starts"], ["gsax60", "GSAx/60", "Goals saved above expected a 60 minutes, regressed: the talent estimate"], ["gar_now", "This season", "Goals above replacement so far this season"]] : SK_COLS;
    h += '<div class="div"><table class="t ptab"><thead><tr><th>#</th><th>Player</th><th class="hide-m">Team</th><th>Pos</th><th class="hide-m">Age</th><th class="hide-m">Tier</th>' +
      cols.map(function (c, i) { return '<th class="sort' + (s === c[0] ? " on" : "") + (i > 0 ? " hide-m" : "") + '" data-s="' + c[0] + '" title="' + esc(c[2]) + '">' + c[1] + (s === c[0] ? " ▾" : "") + "</th>"; }).join("") + "</tr></thead><tbody>" +
      shown.map(function (p, i) {
        var t = TEAMS[p.team];
        var cells = g === "G" ? ["<b>" + f1(p.war) + "</b>", sgn(p.gsax60, 2), p.gar_now == null ? "—" : sgn(p.gar_now)]
          : ["<b>" + f1(p.war) + "</b>", p.gar_now == null ? "—" : sgn(p.gar_now), sgn(p.comp.evo), sgn(p.comp.evd), sgn(p.comp.ppo), sgn(p.comp.pkd), sgn(p.comp.fin), sgn(p.comp.pen)];
        return "<tr><td>" + (page * per + i + 1) + "</td><td>" + pname(p) + '</td><td class="hide-m"><a href="#/team/' + p.team + '" style="display:inline-flex;gap:5px;align-items:center;color:inherit;text-decoration:none">' + logo(t, 18) + p.team + "</a></td><td>" + posLabel(p) +
          '</td><td class="hide-m">' + (p.age || "—") + '</td><td class="hide-m">' + tierDot(p) + esc(tier(p).label) + "</td>" + cells.map(function (c, j) { return "<td" + (j > 0 ? ' class="hide-m"' : "") + ">" + c + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>";
    if (pages > 1) h += '<div class="pager">' + (page * per + 1) + "–" + Math.min(list.length, page * per + per) + " of " + list.length +
      ' <button class="btn" data-pg="' + (page - 1) + '"' + (page ? "" : " disabled") + '>Previous</button><button class="btn" data-pg="' + (page + 1) + '"' + (page < pages - 1 ? "" : " disabled") + ">Next</button></div>";
    h += '<p class="note">Component columns are goals above an average player over 82 games at his ice time; WAR counts from replacement level, so it also credits playing a lot. About ' + H.params.goalsPerWin + " goals make a win.</p>";
    return h;
  }

  // ---------- player card ----------
  function openCard(id) {
    var p = PLAYERS[id];
    if (!p) return;
    var t = TEAMS[p.team], tr = tier(p), G = p.grp === "G";
    var ht = p.ht ? Math.floor(p.ht / 12) + "'" + (p.ht % 12) + '"' : "";
    var h = '<div class="card-h">' + hs(p, 72) + "<div><h3>" + esc(p.name) + '</h3><div class="meta">' + logo(t, 18) + " " + esc(t ? t.name : p.team) + " · " + posLabel(p) + (p.num ? " · #" + p.num : "") +
      (p.age ? " · age " + p.age : "") + (p.shoots ? " · " + (G ? "catches " : "shoots ") + p.shoots : "") + (ht ? " · " + ht + (p.wt ? ", " + p.wt + " lb" : "") : "") + (p.country ? " · " + esc(p.country) : "") + "</div></div></div>";
    h += '<div class="card-b"><div class="kv"><div><b>' + f1(p.war) + "</b><span>" + (G ? "WAR / 58 starts" : "WAR / 82") + "</span></div><div><b>" + ord(p.rank) + "</b><span>among " + (G ? "goalies" : p.grp === "D" ? "defensemen" : "forwards") +
      "</span></div><div><b>" + tierDot(p) + esc(tr.label) + "</b><span>Tier</span></div><div><b>" + (p.gar_now == null ? "—" : sgn(p.gar_now)) + "</b><span>GAR this season</span></div></div>";
    h += '<div class="cardtabs" role="tablist"><button type="button" role="tab" data-ct="rate" aria-selected="true">Rating</button><button type="button" role="tab" data-ct="stats" aria-selected="false">Stats</button></div>';
    h += '<div data-pane="rate">' + (G ? goalieRating(p) : skaterRating(p)) + "</div>";
    h += '<div data-pane="stats" hidden>' + (G ? goalieStats(p) : skaterStats(p)) + "</div></div>";
    cardBody.innerHTML = h;
    if (!card.open) card.showModal();
  }
  function skaterRating(p) {
    var C = p.comp, parts = [["evo", "EV offense"], ["evd", "EV defense"], ["ppo", "Power play"], ["pkd", "Penalty kill"], ["fin", "Finishing"], ["pen", "Penalties"], ["fo", "Faceoffs"]];
    var mx = Math.max.apply(null, parts.map(function (x) { return Math.abs(C[x[0]]); }).concat([3]));
    var avg = parts.reduce(function (s, x) { return s + C[x[0]]; }, 0);
    var u = p.use;
    return '<p class="tldr">Goals above an average ' + (p.grp === "D" ? "defenseman" : "forward") + " over 82 games at his ice time (" + toi(u.all) + " a game: " + toi(u.ev) + " at 5-on-5, " +
      toi(u.pp) + " on the power play, " + toi(u.pk) + " killing penalties).</p>" +
      parts.map(function (x) { return compbar(x[1], C[x[0]], mx); }).join("") +
      '<p class="note" style="margin-top:10px">Total ' + sgn(avg) + " goals above average. A replacement " + (p.grp === "D" ? "defenseman" : "forward") + " at the same minutes would be " +
      sgn(H.repl[p.grp] * u.all / 60 * 82) + ", so he's " + sgn(p.gar) + " goals above replacement, or " + f1(p.war) + " wins.</p>";
  }
  function goalieRating(p) {
    var s = p.seasons || [], tot = s.reduce(function (a, x) { return a + x.gsax; }, 0);
    return '<p class="tldr">Goals saved above expected: the expected goals on every shot he faced, from MoneyPuck\'s shot model, minus the goals he let in. It swings a lot from year to year, so the rating pulls hard toward a below-average goalie until he has a big sample.</p>' +
      '<div class="kv"><div><b>' + sgn(p.gsax60, 2) + "</b><span>GSAx a 60, rated</span></div><div><b>" + sgn(tot) + "</b><span>GSAx, last 3 seasons</span></div><div><b>" + sgn(H.repl.G, 2) + "</b><span>Replacement a 60</span></div></div>" +
      '<p class="note">Rated ' + sgn(p.gsax60, 2) + " against average and " + sgn(p.gar60, 2) + " against replacement every 60 minutes: over 58 starts that's " + f1(p.war) + " wins.</p>";
  }
  function yr(y) { return y + "-" + String(y + 1).slice(2); }
  function skaterStats(p) {
    var s = p.seasons || [];
    var n = p.now;
    var h = '<table class="t"><thead><tr><th>Season</th><th>Team</th><th>GP</th><th>G</th><th>A</th><th>P</th><th class="hide-m">TOI</th><th class="hide-m">ixG</th><th class="hide-m">SOG</th><th title="Share of 5-on-5 expected goals with him on the ice">xG%</th><th class="hide-m">Hits</th><th class="hide-m">Blk</th></tr></thead><tbody>' +
      s.map(function (x) { return "<tr><td>" + yr(x.yr) + "</td><td>" + x.team + "</td><td>" + x.gp + "</td><td>" + x.g + "</td><td>" + x.a + "</td><td><b>" + x.pts + '</b></td><td class="hide-m">' + toi(x.toi) + '</td><td class="hide-m">' + f1(x.ixg) + '</td><td class="hide-m">' + x.sog + "</td><td>" + (x.xgp == null ? "—" : (x.xgp * 100).toFixed(1) + "%") + '</td><td class="hide-m">' + x.hits + '</td><td class="hide-m">' + x.blk + "</td></tr>"; }).join("") +
      "</tbody></table>";
    if (n && n.gp) h += '<p class="note">This season from the NHL: ' + n.gp + " GP, " + n.g + " G, " + n.a + " A, " + (n.pm > 0 ? "+" : "") + n.pm + ", " + n.ppg + " power-play goals, " + n.sog + " shots" + (n.fo ? ", " + (n.fo * 100).toFixed(1) + "% on faceoffs" : "") + ".</p>";
    if (!s.length) h = '<p class="note">No NHL games in the last three seasons.</p>';
    return h;
  }
  function goalieStats(p) {
    var s = p.seasons || [];
    if (!s.length) return '<p class="note">No NHL games in the last three seasons.</p>';
    return '<table class="t"><thead><tr><th>Season</th><th>Team</th><th>GP</th><th>Shots</th><th>GA</th><th>Sv%</th><th class="hide-m">xGA</th><th>GSAx</th></tr></thead><tbody>' +
      s.map(function (x) { return "<tr><td>" + yr(x.yr) + "</td><td>" + x.team + "</td><td>" + x.gp + "</td><td>" + x.sa + "</td><td>" + x.ga + "</td><td>" + (x.sv == null ? "—" : x.sv.toFixed(3).replace(/^0/, "")) + '</td><td class="hide-m">' + f1(x.xga) + "</td><td><b>" + sgn(x.gsax) + "</b></td></tr>"; }).join("") + "</tbody></table>";
  }

  // ---------- how it works ----------
  function methodView() {
    var P = H.params;
    return '<div class="method"><h2 class="sec">How it works</h2>' +
      "<h3>Where the numbers come from</h3><p>Standings, rosters, this season's box-score stats and the schedule come from the NHL's own stats API. Everything built on expected goals comes from " +
      '<a href="https://moneypuck.com" rel="noopener">MoneyPuck.com</a>\'s public season files: on-ice and individual expected goals for every skater, every goalie\'s shots faced, team totals and line combinations, for this season and the two before it. ' +
      "MoneyPuck's expected goals give every shot a chance of going in from where and how it was taken. The hub rebuilds every morning.</p>" +
      "<h3>Player ratings</h3><p>Each skater is rated in goals a 60 minutes against an average player, in parts:</p><ul>" +
      "<li><b>Even-strength offense and defense.</b> Expected goals for and against while he's on the ice at 5-on-5, measured two ways: against the league's rate, and against his own team when he's on the bench. " +
      "Each counts for part of the credit (" + Math.round(P.credit.league * 100) + "% and " + Math.round(P.credit.rel * 100) + "% of the difference), since four teammates share the ice with him. Those shares were set so that a lineup's ratings add up to its results: rate every player on 2024-25, price 2025-26's lineups at those ratings, and the predicted goal differentials matched the real ones one for one.</li>" +
      "<li><b>Power play and penalty kill.</b> On-ice expected goals for at 5-on-4 and against at 4-on-5, against the league.</li>" +
      "<li><b>Finishing.</b> Goals over his own expected goals. Most of this is luck from year to year, so it's pulled hard toward zero.</li>" +
      "<li><b>Penalties and faceoffs.</b> Penalties drawn minus taken at " + P.penValue + " goals each (what a power play is worth), and faceoffs won minus lost at " + P.foValue + " goals each.</li></ul>" +
      "<p>The three seasons are blended by minutes, with this season counting fully, last season " + Math.round(P.seasonW["1"] * 100) + "% and the one before " + Math.round(P.seasonW["2"] * 100) + "%. " +
      "Every part is then pulled toward a slightly below-average player, as if he'd also played " + P.prior.ev + " average minutes at even strength (fewer for special teams). A player with a short track record stays close to that until he earns his way off it.</p>" +
      "<p><b>Goalies</b> are rated on goals saved above expected (the expected goals of every shot faced, minus goals allowed) for each unblocked shot, measured against the league's own rate, and pulled toward below average as if he'd faced another " + P.prior.g.toLocaleString() + " shots, because save results swing so much.</p>" +
      "<p><b>Wins above replacement.</b> A replacement player is the kind a team can call up or claim off waivers: the average of the skaters just outside the league's regulars (past the 416th forward and 224th defenseman by ice time), and the goalies just past the top 64. " +
      "Today that's " + sgn(H.repl.F, 2) + " goals a 60 for forwards, " + sgn(H.repl.D, 2) + " for defensemen and " + sgn(H.repl.G, 2) + " for goalies. Goals over that, at his ice time over 82 games (58 starts for goalies), divided by " + P.goalsPerWin + " goals a win, is his WAR. " +
      "\"This season\" is the same arithmetic on this season's games only, with nothing pulled toward average.</p>" +
      "<h3>Team strength</h3><p>Two reads on each team, in goals a game against an average team. The roster: the ratings of its top twelve forwards and six defensemen by ice time, plus its goalies weighted by their expected share of the starts. " +
      "The results: this season's expected-goal differential a game (adjusted for score and home ice), plus 30% of the real goal differential's difference from it, since some finishing and goaltending is real. " +
      "Early on the roster read carries most of the weight; it counts like " + P.teamK + " games, so after " + P.teamK + " games the two count equally.</p>" +
      "<h3>The season, " + H.sims.toLocaleString() + " times</h3><p>Every game left is played out with each team's goals drawn from a Poisson distribution around " + P.regGoals + " in regulation, shifted by the gap in strength and " + P.homeEdge + " goals for home ice. " +
      "Ties go to overtime and the shootout, which lean slightly toward the better team, and the loser gets a point. Standings break ties on points, then regulation wins, then regulation and overtime wins, then wins. " +
      "The top three in each division and two wild cards per conference make the playoffs, in the NHL's bracket (the better division winner draws the second wild card), and every series is played game by game, 2-2-1-1-1, with home ice to the team that finished higher.</p>" +
      "<h3>Lines and pairings</h3><p>Each team's most-used 5-on-5 forward trios and defense pairs this season from MoneyPuck's line data, keeping only players still on the roster and never using a player twice. They show who has played together, not tonight's lineup, so a new trade or an injury won't show up until the new combination has logged minutes.</p>" +
      "<h3>What it doesn't know</h3><ul><li>Injuries: an injured player still counts if he's on the roster, and a call-up counts at his own (usually small) sample.</li><li>Contracts and the cap. Those are coming.</li><li>Quality of competition and teammates beyond the on-ice/off-ice comparison, so a fourth-liner sheltered from top lines can look a little better than he is.</li></ul>" +
      '<p class="note">Expected goals and line data from <a href="https://moneypuck.com" rel="noopener">MoneyPuck.com</a>; standings, rosters and stats from the NHL. Built ' + esc(H.built.slice(0, 10)) + ".</p></div>";
  }

  // ---------- events ----------
  view.addEventListener("click", function (e) {
    var el;
    if ((el = e.target.closest("[data-p]"))) { openCard(+el.dataset.p); return; }
    if ((el = e.target.closest("tr[data-team]"))) { go("team", el.dataset.team); return; }
    if ((el = e.target.closest("[data-v]"))) { setQ({ v: el.dataset.v }); return; }
    if ((el = e.target.closest("[data-g]"))) { setQ({ g: el.dataset.g, s: "war", p: "" }); return; }
    if ((el = e.target.closest("th[data-s]"))) { setQ({ s: el.dataset.s, p: "" }); return; }
    if ((el = e.target.closest("[data-pg]"))) { setQ({ p: el.dataset.pg }); window.scrollTo({ top: view.offsetTop - 10 }); }
  });
  view.addEventListener("change", function (e) { if (e.target.id === "pteam") setQ({ t: e.target.value, p: "" }); });
  var typing;
  view.addEventListener("input", function (e) {
    if (e.target.id !== "pfind") return;
    clearTimeout(typing);
    var v = e.target.value;
    typing = setTimeout(function () {
      history.replaceState(null, "", location.pathname + "#/players?" + ["g=" + (state.q.g || "F"), state.q.t ? "t=" + state.q.t : "", state.q.s ? "s=" + state.q.s : "", v ? "q=" + encodeURIComponent(v) : ""].filter(Boolean).join("&"));
      parse();
      view.innerHTML = playersView();
      var box = $("#pfind"); box.focus(); box.setSelectionRange(v.length, v.length);
    }, 180);
  });
  card.addEventListener("click", function (e) {
    var el;
    if (e.target === card || e.target.closest("[data-close]")) { card.close(); return; }
    if ((el = e.target.closest("[data-ct]"))) {
      card.querySelectorAll("[data-ct]").forEach(function (b) { b.setAttribute("aria-selected", b === el ? "true" : "false"); });
      card.querySelectorAll("[data-pane]").forEach(function (p) { p.hidden = p.dataset.pane !== el.dataset.ct; });
    }
  });
  window.addEventListener("hashchange", render);

  fetch("data/hub.json?d=" + new Date().toISOString().slice(0, 10)).then(function (r) { return r.json(); }).then(function (d) {
    H = d;
    H.teams.forEach(function (t) { TEAMS[t.abbr] = t; });
    H.players.forEach(function (p) { PLAYERS[p.id] = p; (ROSTER[p.team] = ROSTER[p.team] || []).push(p); });
    $("#foot").innerHTML = 'Expected goals and lines from <a href="https://moneypuck.com" rel="noopener">MoneyPuck.com</a>. Standings, rosters and stats from the NHL. Updated ' + fmtDate(H.asOf) + ".";
    render();
  }).catch(function () { view.innerHTML = '<p class="loading">The hub didn\'t load. Try again in a minute.</p>'; });
})();
