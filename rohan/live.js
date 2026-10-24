(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var STARTERS = { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1, "D/ST": 1, K: 1 };
  var SUFFIX = { jr: 1, sr: 1, ii: 1, iii: 1, iv: 1, v: 1 };
  var data = null;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function norm(name) {
    return String(name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[.'’`-]/g, "").split(/\s+/).filter(function (w) { return w && !SUFFIX[w]; }).join(" ");
  }

  function teamCode(team) {
    team = String(team || "").toUpperCase();
    return team === "WSH" ? "WAS" : team;
  }

  function playerKey(p) {
    return p[3] === "D/ST" ? "DST|" + teamCode(p[2]) : norm(p[1]) + "|" + p[3];
  }

  function isStarter(p) { return !!STARTERS[p[0]]; }

  function formatStamp(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString("en-US", {
      timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    }) + " ET";
  }

  function renderMatchups() {
    var teams = {};
    data.teams.forEach(function (t) { teams[t.name] = t; });
    $("live-matchups").innerHTML = data.matchups.map(function (m) {
      var a = teams[m.away], h = teams[m.home];
      var favorite = m.away_proj > m.home_proj ? m.away : m.home;
      var margin = Math.abs(m.away_proj - m.home_proj).toFixed(1);
      return '<article class="matchup-card">' +
        side(a, m.away_proj) + '<div class="at">AT</div>' + side(h, m.home_proj) +
        '<p class="matchup-note">ESPN favors ' + esc(shortTeam(favorite)) + ' by ' + margin + '</p></article>';
    }).join("");
  }

  function side(team, projection) {
    return '<div class="matchup-side"><div><b>' + esc(team.name) + '</b><small>' + esc(team.record) + ' · ' + ordinal(team.rank) + '</small></div>' +
      '<div class="scores"><span class="live-score" data-team="' + esc(team.name) + '">0.0</span><small>LIVE</small></div>' +
      '<div class="proj"><strong>' + projection.toFixed(1) + '</strong><small>ESPN PROJ</small></div></div>';
  }

  function shortTeam(name) {
    return name.replace("The Championship Winnin Crunch*", "The Crunch").replace("The Price Is Bijan, B****", "Price Is Bijan");
  }

  function ordinal(n) {
    var mod10 = n % 10, mod100 = n % 100;
    return n + (mod10 === 1 && mod100 !== 11 ? "st" : mod10 === 2 && mod100 !== 12 ? "nd" : mod10 === 3 && mod100 !== 13 ? "rd" : "th");
  }

  function renderThursday() {
    var codes = [data.thursday.away, data.thursday.home];
    var groups = data.teams.map(function (t) {
      var hit = t.players.filter(function (p) { return codes.indexOf(p[2]) !== -1; });
      return { team: t, starters: hit.filter(isStarter), reserves: hit.filter(function (p) { return !isStarter(p); }) };
    }).filter(function (g) { return g.starters.length || g.reserves.length; });
    var starterCount = groups.reduce(function (n, g) { return n + g.starters.length; }, 0);
    var activeTeams = groups.filter(function (g) { return g.starters.length; }).length;
    $("tn-summary").textContent = starterCount + " starters across " + activeTeams + " Rohan teams played Thursday night.";
    $("tn-groups").innerHTML = groups.map(function (g) {
      return '<article class="tn-team"><div class="tn-team-head"><div><h3>' + esc(g.team.name) + '</h3><p>' + esc(g.team.owner) + '</p></div>' +
        '<span>' + g.starters.length + ' start' + (g.starters.length === 1 ? '' : 's') + '</span></div>' +
        '<div class="tn-players">' + g.starters.map(function (p) { return playerChip(p, true); }).join("") +
        g.reserves.map(function (p) { return playerChip(p, false); }).join("") + '</div></article>';
    }).join("");
  }

  function playerChip(p, starter) {
    var status = p[4] ? '<i class="injury">' + esc(p[4]) + '</i>' : '';
    return '<div class="tn-player' + (starter ? '' : ' reserve') + '" data-player="' + esc(playerKey(p)) + '"><span><b>' + esc(p[1]) + '</b>' +
      '<small>' + esc((starter ? p[0] : p[0] === "IR" ? "IR" : "Bench") + ' · ' + p[2] + ' ' + p[3]) + '</small></span>' + status +
      '<strong class="player-live">0.0</strong></div>';
  }

  function renderByes() {
    var bye = data.bye_next;
    var groups = data.teams.map(function (t) {
      var hit = t.players.filter(function (p) { return bye.indexOf(p[2]) !== -1; });
      return { team: t, starters: hit.filter(isStarter), reserves: hit.filter(function (p) { return !isStarter(p) && p[0] !== "IR"; }) };
    }).filter(function (g) { return g.starters.length || g.reserves.length; }).sort(function (a, b) {
      return b.starters.length - a.starters.length || a.team.rank - b.team.rank;
    });
    $("bye-team-list").innerHTML = groups.map(function (g) {
      var list = g.starters.map(function (p) { return '<b>' + esc(p[1]) + ' <small>' + esc(p[0]) + '</small></b>'; }).join(', ');
      var reserves = g.reserves.length ? '<p>Also on bench: ' + g.reserves.map(function (p) { return esc(p[1]); }).join(', ') + '</p>' : '';
      return '<li><span class="bye-count">' + g.starters.length + '<small>starter' + (g.starters.length === 1 ? '' : 's') + '</small></span>' +
        '<div><h3>' + esc(g.team.name) + '</h3><div class="bye-names">' + (list || '<span>No current starters</span>') + '</div>' + reserves + '</div></li>';
    }).join("");
  }

  function renderRosters() {
    $("roster-list").innerHTML = data.teams.slice().sort(function (a, b) { return a.rank - b.rank; }).map(function (t) {
      var starters = t.players.filter(isStarter), bench = t.players.filter(function (p) { return p[0] === "Bench"; }), ir = t.players.filter(function (p) { return p[0] === "IR"; });
      return '<details class="current-team"><summary><span><b>' + esc(t.name) + '</b><small>' + esc(t.owner) + '</small></span><strong>' + esc(t.record) + ' · ' + ordinal(t.rank) + '</strong></summary>' +
        '<div class="roster-scroll"><table class="current-roster"><thead><tr><th>Slot</th><th>Player</th><th>NFL</th><th>Status</th></tr></thead><tbody>' +
        rosterRows(starters) + (bench.length ? '<tr class="roster-sep"><th colspan="4">Bench</th></tr>' + rosterRows(bench) : '') +
        (ir.length ? '<tr class="roster-sep"><th colspan="4">Injured reserve</th></tr>' + rosterRows(ir) : '') +
        '</tbody></table></div></details>';
    }).join("");
  }

  function rosterRows(players) {
    return players.map(function (p) {
      return '<tr><td>' + esc(p[0]) + '</td><td><b>' + esc(p[1]) + '</b></td><td>' + esc(p[2] + ' · ' + p[3]) + '</td><td>' + (p[4] ? '<span class="status-dot">' + esc(p[4]) + '</span>' : '—') + '</td></tr>';
    }).join("");
  }

  function value(s, key) { return Number(s[key] || 0); }

  function scoreStats(s, pos) {
    var total = 0;
    if (pos === "K") {
      total += value(s, "xpm") - value(s, "xpmiss");
      total += 3 * (value(s, "fgm_0_19") + value(s, "fgm_20_29") + value(s, "fgm_30_39"));
      total += 4 * value(s, "fgm_40_49") + 5 * (value(s, "fgm_50_59") + value(s, "fgm_60p") + value(s, "fgm_50p"));
      total -= 2 * (value(s, "fgmiss_0_19") + value(s, "fgmiss_20_29") + value(s, "fgmiss_30_39"));
      total -= value(s, "fgmiss_40_49");
      return Math.round(total * 100) / 100;
    }
    if (pos === "DEF" || pos === "D/ST") {
      var td = "def_st_td" in s ? value(s, "def_st_td") : value(s, "def_td") + value(s, "st_td");
      total += td * 6 + value(s, "sack") + value(s, "blk_kick") * 4 + value(s, "int") * 2;
      total += value(s, "fum_rec") + value(s, "fum_force") * 2 + value(s, "safe") * 3;
      var pa = Number(s.pts_allow);
      if (isFinite(pa)) total += pa === 0 ? 10 : pa <= 6 ? 8 : pa <= 13 ? 5 : pa <= 17 ? 2 : pa <= 21 ? 0 : pa <= 27 ? -1 : pa <= 34 ? -4 : pa <= 45 ? -7 : -10;
      return Math.round(total * 100) / 100;
    }
    var completions = value(s, "pass_cmp"), attempts = value(s, "pass_att");
    total += value(s, "pass_yd") * .04 + completions * .7 - Math.max(0, attempts - completions);
    total += value(s, "pass_td") * 4 - value(s, "pass_int") * 2 + value(s, "pass_2pt") * 2;
    total += value(s, "rush_yd") * .13 + value(s, "rush_td") * 6 + value(s, "rush_2pt") * 2;
    total += value(s, "rec_yd") * .13 + value(s, "rec") * .5 + value(s, "rec_td") * 6 + value(s, "rec_2pt") * 2;
    if (value(s, "rush_yd") >= 200) total += 3; else if (value(s, "rush_yd") >= 100) total += 1.5;
    if (value(s, "rec_yd") >= 200) total += 3; else if (value(s, "rec_yd") >= 100) total += 1.5;
    total += (value(s, "kick_ret_yd") + value(s, "punt_ret_yd")) / 25;
    total += (value(s, "kick_ret_td") + value(s, "punt_ret_td") + value(s, "fum_rec_td")) * 6;
    total -= value(s, "fum_lost") * 2;
    return Math.round(total * 100) / 100;
  }

  function buildLive(stats, board) {
    var points = {}, games = {};
    (stats || []).forEach(function (entry) {
      var p = entry.player || {}, s = entry.stats || {}, pos = p.position || entry.position || "";
      var team = teamCode(entry.team || p.team || "");
      var key = pos === "DEF" ? "DST|" + team : norm((p.first_name || "") + " " + (p.last_name || "")) + "|" + pos;
      points[key] = { pts: scoreStats(s, pos), team: team, played: !!s.gp };
    });
    ((board || {}).events || []).forEach(function (event) {
      var status = event.status || {}, comp = (event.competitions || [])[0] || {};
      var game = { state: (status.type || {}).state || "pre", clock: status.displayClock || "", period: status.period || 0 };
      (comp.competitors || []).forEach(function (c) { games[teamCode((c.team || {}).abbreviation)] = game; });
    });
    return { points: points, games: games };
  }

  function applyLive(live) {
    data.teams.forEach(function (t) {
      var total = t.players.filter(isStarter).reduce(function (sum, p) {
        return sum + ((live.points[playerKey(p)] || {}).pts || 0);
      }, 0);
      Array.prototype.forEach.call(document.querySelectorAll('.live-score[data-team="' + cssEscape(t.name) + '"]'), function (el) { el.textContent = total.toFixed(1); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-player]"), function (el) {
      var item = live.points[el.getAttribute("data-player")];
      var score = el.querySelector(".player-live");
      if (score) score.textContent = (item ? item.pts : 0).toFixed(1);
      var team = (item && item.team) || "";
      var game = live.games[team];
      el.classList.toggle("is-live", !!game && game.state === "in");
      el.classList.toggle("is-final", !!game && game.state === "post");
    });
    var gameList = Object.keys(live.games).map(function (k) { return live.games[k]; });
    var inProgress = gameList.filter(function (g) { return g.state === "in"; }).length / 2;
    var finished = gameList.filter(function (g) { return g.state === "post"; }).length / 2;
    var spotlight = $("thursday-spotlight");
    if (spotlight) {
      var thursdayGame = live.games[teamCode(data.thursday.away)] || live.games[teamCode(data.thursday.home)];
      spotlight.hidden = !!(thursdayGame && thursdayGame.state === "post");
    }
    var tag = $("live-state");
    if (inProgress) { tag.textContent = "LIVE · " + inProgress + " GAME" + (inProgress === 1 ? "" : "S"); tag.className = "live-pill on"; }
    else if (finished) { tag.textContent = "RESULTS IN"; tag.className = "live-pill"; }
    else { tag.textContent = "PREGAME"; tag.className = "live-pill"; }
  }

  function cssEscape(value) {
    return String(value).replace(/(["\\])/g, "\\$1");
  }

  function getJSON(url) {
    return fetch(url, { cache: "no-store" }).then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); });
  }

  function refreshLive() {
    var statsUrl = "https://api.sleeper.com/stats/nfl/" + data.season + "/" + data.week + "?season_type=regular" +
      "&position%5B%5D=QB&position%5B%5D=RB&position%5B%5D=WR&position%5B%5D=TE&position%5B%5D=K&position%5B%5D=DEF";
    var boardUrl = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=" + data.season + "&seasontype=2&week=" + data.week;
    return Promise.all([getJSON(statsUrl), getJSON(boardUrl)]).then(function (res) {
      applyLive(buildLive(res[0], res[1]));
      $("live-updated").textContent = "Live check " + formatStamp(new Date().toISOString()) + " · ESPN projections snapshot " + formatStamp(data.updated);
    }).catch(function () {
      $("live-updated").textContent = "ESPN projections and rosters updated " + formatStamp(data.updated) + " · live stat feed will retry";
    });
  }

  getJSON("league.json?v=20261024b").then(function (league) {
    data = league;
    renderMatchups();
    renderThursday();
    renderByes();
    renderRosters();
    $("week-dashboard").hidden = false;
    refreshLive();
    window.setInterval(refreshLive, 60000);
  }).catch(function () {
    $("dashboard-error").hidden = false;
  });
}());
