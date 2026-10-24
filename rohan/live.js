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

  function detailRows(players) {
    return players.map(function (p) {
      var key = playerKey(p);
      var proj = p[0] === "IR" ? '—' : (data.bye_next.indexOf(p[2]) !== -1 ? 'Bye' :
        '<span class="player-proj" data-proj-player="' + esc(key) + '">…</span>');
      return '<tr><td>' + esc(p[0]) + '</td><td><b>' + esc(p[1]) + '</b></td><td>' + proj + '</td>' +
        '<td data-player="' + esc(key) + '"><strong class="player-live">0.0</strong></td></tr>';
    }).join("");
  }

  function detailTeam(t) {
    var starters = t.players.filter(isStarter);
    var bench = t.players.filter(function (p) { return p[0] === "Bench"; });
    var ir = t.players.filter(function (p) { return p[0] === "IR"; });
    var html = '<div class="detail-team"><h4>' + esc(t.name) + '</h4><div class="roster-scroll"><table class="current-roster"><thead><tr><th>Slot</th><th>Player</th><th>Proj</th><th>Live</th></tr></thead><tbody>' +
      detailRows(starters);
    if (bench.length) html += '<tr class="roster-sep"><th colspan="4">Bench</th></tr>' + detailRows(bench);
    if (ir.length) html += '<tr class="roster-sep"><th colspan="4">Injured reserve</th></tr>' + detailRows(ir);
    return html + '</tbody></table></div></div>';
  }

  function matchupDetail(m, teams) {
    return '<div class="matchup-detail" hidden>' + detailTeam(teams[m.away]) + detailTeam(teams[m.home]) +
      '<p class="matchup-note">Projections from Sleeper, scored with Rohan rules. ESPN projections remain official.</p></div>';
  }

  function matchupCard(m, teams, featured) {
    var a = teams[m.away], h = teams[m.home];
    var favorite = m.away_proj > m.home_proj ? m.away : m.home;
    var margin = Math.abs(m.away_proj - m.home_proj).toFixed(1);
    var total = m.away_proj + m.home_proj;
    var share = total ? Math.round(m.away_proj / total * 100) : 50;
    return '<article class="matchup-card' + (featured ? ' featured' : '') + '" tabindex="0" role="button" aria-expanded="false">' +
      (featured ? '<div class="matchup-featured-tag">FEATURED MATCHUP</div>' : '') +
      side(a, m.away_proj) + '<div class="at">AT</div>' + side(h, m.home_proj) +
      '<div class="matchup-bar" title="Projected points split"><i style="width:' + share + '%"></i></div>' +
      '<p class="matchup-note">ESPN favors ' + esc(shortTeam(favorite)) + ' by ' + margin + '</p>' +
      '<p class="matchup-note winprob" data-winprob="' + esc(m.away) + '">Muse win probability: …</p>' +
      '<p class="matchup-note expand-hint">Click for player projections ↓</p>' +
      matchupDetail(m, teams) + '</article>';
  }

  function renderMatchups() {
    var teams = {};
    data.teams.forEach(function (t) { teams[t.name] = t; });
    var list = data.matchups.slice();
    var featured = null, best = -Infinity;
    list.forEach(function (m) {
      var total = m.away_proj + m.home_proj;
      if (total > best) { best = total; featured = m; }
    });
    var rest = list.filter(function (m) { return m !== featured; });
    $("live-matchups").innerHTML = (featured ? matchupCard(featured, teams, true) : "") +
      rest.map(function (m) { return matchupCard(m, teams, false); }).join("");
  }

  var projPoints = null, projPromise = null;
  var lastLive = null, histSd = null, histMean = {}, histPromise = null;
  var POS_FALLBACK_SD = { QB: 7, RB: 6, WR: 6, TE: 4.5, K: 3, DEF: 4.5, "D/ST": 4.5 };
  var TEAM_SHIFT_SD = 12, SIMS = 10000;
  var MISS = { Q: 0.20, DTD: 0.10, D: 0.75 };

  function buildProj(proj) {
    var points = {};
    (proj || []).forEach(function (entry) {
      var p = entry.player || {}, s = entry.stats || {}, pos = p.position || entry.position || "";
      var isDef = (pos === "DEF" || pos === "D/ST");
      if (!s || Object.keys(s).length === 0) return;
      if (!isDef && !p.first_name && !p.last_name) return;
      if (isDef && s.pts_allow == null) { points["DST|" + teamCode(entry.team || p.team || "")] = null; return; }
      var key = isDef ? "DST|" + teamCode(entry.team || p.team || "") : norm((p.first_name || "") + " " + (p.last_name || "")) + "|" + pos;
      points[key] = scoreStats(s, pos);
    });
    return points;
  }

  function getProjections() {
    if (!projPromise) {
      var url = "https://api.sleeper.com/projections/nfl/" + data.season + "/" + data.week + "?season_type=regular" +
        "&position%5B%5D=QB&position%5B%5D=RB&position%5B%5D=WR&position%5B%5D=TE&position%5B%5D=K&position%5B%5D=DEF";
      projPromise = getJSON(url).then(function (res) {
        projPoints = buildProj(res);
        return projPoints;
      }).catch(function () { projPoints = {}; return projPoints; });
    }
    return projPromise;
  }

  function fillProj() {
    if (!projPoints) return;
    Array.prototype.forEach.call(document.querySelectorAll("[data-proj-player]"), function (el) {
      var v = projPoints[el.getAttribute("data-proj-player")];
      el.textContent = (v == null || isNaN(v)) ? "—" : v.toFixed(1);
    });
  }

  function sampleSd(values) {
    if (values.length < 2) return null;
    var mean = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
    var sq = values.reduce(function (a, x) { return a + (x - mean) * (x - mean); }, 0);
    return Math.sqrt(sq / (values.length - 1));
  }

  function median(values) {
    if (!values.length) return null;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function statsUrlFor(w) {
    return "https://api.sleeper.com/stats/nfl/" + data.season + "/" + w + "?season_type=regular" +
      "&position%5B%5D=QB&position%5B%5D=RB&position%5B%5D=WR&position%5B%5D=TE&position%5B%5D=K&position%5B%5D=DEF";
  }

  function getHistory() {
    if (!histPromise) {
      var weeks = [];
      for (var w = 1; w < data.week; w++) weeks.push(w);
      histPromise = Promise.all(weeks.map(function (w) {
        return getJSON(statsUrlFor(w)).catch(function () { return []; });
      })).then(function (all) {
        var perPlayer = {}, perPos = {};
        all.forEach(function (stats) {
          (stats || []).forEach(function (entry) {
            var p = entry.player || {}, s = entry.stats || {}, pos = p.position || entry.position || "";
            if (!s.gp) return;
            var team = teamCode(entry.team || p.team || "");
            var key = pos === "DEF" ? "DST|" + team : norm((p.first_name || "") + " " + (p.last_name || "")) + "|" + pos;
            (perPlayer[key] = perPlayer[key] || []).push(scoreStats(s, pos));
            perPos[key] = pos;
          });
        });
        var sdsByPos = {};
        Object.keys(perPlayer).forEach(function (key) {
          var sd = sampleSd(perPlayer[key]);
          if (sd != null && perPlayer[key].length >= 3) {
            (sdsByPos[perPos[key]] = sdsByPos[perPos[key]] || []).push(sd);
          }
        });
        histSd = {}; histMean = {};
        Object.keys(perPlayer).forEach(function (key) {
          var arr = perPlayer[key];
          histMean[key] = Math.round(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length * 100) / 100;
          var sd = sampleSd(arr);
          var posMed = median(sdsByPos[perPos[key]] || []);
          histSd[key] = sd != null ? sd : (posMed != null ? posMed : (POS_FALLBACK_SD[perPos[key]] || 6));
        });
        return histSd;
      }).catch(function () { histSd = {}; return histSd; });
    }
    return histPromise;
  }

  var randnSpare = null;
  function randn() {
    if (randnSpare != null) { var v = randnSpare; randnSpare = null; return v; }
    var u = 0, v2 = 0, sq = 0;
    do { u = Math.random() * 2 - 1; v2 = Math.random() * 2 - 1; sq = u * u + v2 * v2; } while (sq >= 1 || sq === 0);
    var mul = Math.sqrt(-2 * Math.log(sq) / sq);
    randnSpare = v2 * mul;
    return u * mul;
  }

  function simPlayer(p) {
    var key = playerKey(p);
    var team = teamCode(p[2]);
    var game = lastLive.games[team];
    var banked = ((lastLive.points[key] || {}).pts || 0);
    if (data.bye_next.indexOf(p[2]) !== -1) return 0;
    if (game && game.state === "post") return banked;
    var status = p[4];
    if (status === "O" || status === "IR") return 0;
    var proj = projPoints[key];
    var mean = (proj != null && !isNaN(proj)) ? proj : (histMean[key] != null ? histMean[key] : 0);
    var sd = (histSd && histSd[key]) || 6;
    var isKick = (p[3] === "K" || p[3] === "DEF" || p[3] === "D/ST");
    if (game && game.state === "in") {
      var rem = Math.max(0, mean - banked) + randn() * sd * 0.6;
      return banked + (isKick ? Math.max(-5, rem) : Math.max(0, rem));
    }
    var miss = MISS[status] || 0;
    if (miss && Math.random() < miss) return 0;
    var total = mean + randn() * sd;
    return isKick ? Math.max(-5, total) : Math.max(0, total);
  }

  function simMatchup(m, teams) {
    var aStarters = teams[m.away].players.filter(isStarter);
    var hStarters = teams[m.home].players.filter(isStarter);
    var wins = 0, ties = 0;
    for (var i = 0; i < SIMS; i++) {
      var a = randn() * TEAM_SHIFT_SD, h = randn() * TEAM_SHIFT_SD;
      aStarters.forEach(function (p) { a += simPlayer(p); });
      hStarters.forEach(function (p) { h += simPlayer(p); });
      if (a > h) wins++;
      else if (a === h) ties++;
    }
    return (wins + 0.5 * ties) / SIMS;
  }

  function maybeRenderWinProbs() {
    if (!projPoints || !histSd || !lastLive) return;
    var teams = {};
    data.teams.forEach(function (t) { teams[t.name] = t; });
    Array.prototype.forEach.call(document.querySelectorAll("[data-winprob]"), function (el) {
      var m = null;
      data.matchups.forEach(function (x) { if (x.away === el.getAttribute("data-winprob")) m = x; });
      if (!m) return;
      var pa = simMatchup(m, teams), ph = 1 - pa;
      var aTxt = esc(shortTeam(m.away)) + " " + Math.round(pa * 100) + "%";
      var hTxt = esc(shortTeam(m.home)) + " " + Math.round(ph * 100) + "%";
      el.innerHTML = "Muse win probability: " + (pa > 0.5 ? "<b>" + aTxt + "</b>" : aTxt) +
        " · " + (ph > 0.5 ? "<b>" + hTxt + "</b>" : hTxt);
    });
  }

  function toggleMatchup(card) {
    var detail = card.querySelector(".matchup-detail");
    if (!detail) return;
    var open = detail.hidden;
    detail.hidden = !open;
    card.setAttribute("aria-expanded", String(open));
    var hint = card.querySelector(".expand-hint");
    if (hint) hint.textContent = open ? "Hide player projections ↑" : "Click for player projections ↓";
    if (open) getProjections().then(fillProj);
  }

  function setupMatchupToggle() {
    var grid = $("live-matchups");
    grid.addEventListener("click", function (e) {
      var card = e.target.closest ? e.target.closest(".matchup-card") : null;
      if (card) toggleMatchup(card);
    });
    grid.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var card = e.target.closest ? e.target.closest(".matchup-card") : null;
      if (card) { e.preventDefault(); toggleMatchup(card); }
    });
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

  var ALL_TEAMS = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB","HOU","IND","JAX","KC","LAC","LAR","LV","MIA","MIN","NE","NO","NYG","NYJ","PHI","PIT","SF","SEA","TB","TEN","WSH"];

  function byeGroups(codes) {
    return data.teams.map(function (t) {
      var hit = t.players.filter(function (p) { return codes.indexOf(p[2]) !== -1 && p[0] !== "IR"; });
      return { team: t, players: hit };
    }).filter(function (g) { return g.players.length; }).sort(function (a, b) {
      return b.players.length - a.players.length || a.team.rank - b.team.rank;
    });
  }

  function byeListHTML(groups) {
    return groups.map(function (g) {
      var list = g.players.map(function (p) {
        return '<b>' + esc(p[1]) + ' <small>' + esc(p[0] === "Bench" ? "Bench" : p[0]) + '</small></b>';
      }).join(', ');
      return '<li><span class="bye-count">' + g.players.length + '<small>player' + (g.players.length === 1 ? '' : 's') + '</small></span>' +
        '<div><h3>' + esc(g.team.name) + '</h3><div class="bye-names">' + list + '</div></div></li>';
    }).join("");
  }

  function renderByes() {
    var groups = byeGroups(data.bye_next);
    $("bye-team-list").innerHTML = groups.length ? byeListHTML(groups) :
      '<li><span>No Rohan players on this week\'s bye teams.</span></li>';
    var nextEl = $("bye-next-list");
    if (!nextEl) return;
    nextEl.innerHTML = '<li><span>Checking next week\'s board\u2026</span></li>';
    getJSON("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=" + data.season + "&seasontype=2&week=" + (data.week + 1)).then(function (board) {
      var events = (board || {}).events || [];
      var playing = {};
      events.forEach(function (event) {
        var comp = (event.competitions || [])[0] || {};
        (comp.competitors || []).forEach(function (c) { playing[(c.team || {}).abbreviation] = true; });
      });
      var bye = ALL_TEAMS.filter(function (code) { return !playing[code]; });
      if (events.length < 10 || bye.length < 1 || bye.length > 6) throw new Error("board incomplete");
      var nextGroups = byeGroups(bye);
      nextEl.innerHTML = nextGroups.length ? byeListHTML(nextGroups) :
        '<li><span>No Rohan players on next week\'s bye teams.</span></li>';
    }).catch(function () {
      nextEl.innerHTML = '<li><span>Next week\'s bye teams aren\'t on the ESPN board yet.</span></li>';
    });
  }

  var INJURY_STATUS = { Q: 1, O: 1, DTD: 1, D: 1 };

  function renderInjuries() {
    var groups = data.teams.map(function (t) {
      var hit = t.players.filter(function (p) { return p[0] !== "IR" && INJURY_STATUS[p[4]]; });
      hit.sort(function (a, b) { return (isStarter(a) ? 0 : 1) - (isStarter(b) ? 0 : 1); });
      return { team: t, players: hit };
    }).filter(function (g) { return g.players.length; });
    $("injury-list").innerHTML = groups.length ? groups.map(function (g) {
      var list = g.players.map(function (p) {
        return '<b>' + esc(p[1]) + '</b> <small>' + esc(p[0]) + ' · ' + esc(p[2]) + '</small> <span class="status-dot">' + esc(p[4]) + '</span>';
      }).join(', ');
      return '<li><span class="bye-count">' + g.players.length + '<small>player' + (g.players.length === 1 ? '' : 's') + '</small></span>' +
        '<div><h3>' + esc(g.team.name) + '</h3><div class="bye-names">' + list + '</div></div></li>';
    }).join("") : '<li><span>No questionable, doubtful, or out designations on any roster this week.</span></li>';
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
    lastLive = live;
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
      var thursdayDone = !!(thursdayGame && thursdayGame.state === "post");
      spotlight.hidden = thursdayDone;
      var thursdayLink = document.querySelector('.page-nav a[href="#thursday-spotlight"]');
      if (thursdayLink) thursdayLink.hidden = thursdayDone;
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
      maybeRenderWinProbs();
      $("live-updated").textContent = "Live check " + formatStamp(new Date().toISOString()) + " · ESPN projections snapshot " + formatStamp(data.updated);
    }).catch(function () {
      $("live-updated").textContent = "ESPN projections and rosters updated " + formatStamp(data.updated) + " · live stat feed will retry";
    });
  }

  getJSON("league.json?v=20261024b").then(function (league) {
    data = league;
    renderMatchups();
    setupMatchupToggle();
    renderThursday();
    renderByes();
    renderInjuries();
    renderRosters();
    $("week-dashboard").hidden = false;
    refreshLive();
    getProjections().then(function () { fillProj(); maybeRenderWinProbs(); });
    getHistory().then(maybeRenderWinProbs);
    window.setInterval(refreshLive, 60000);
  }).catch(function () {
    $("dashboard-error").hidden = false;
  });
}());

/* Collapsible page sections (Oct 2026): every live block and reference
   section gets an Expand/Collapse toggle in its title row. This-week blocks
   start open, reference blocks start collapsed, and each visitor's choices
   persist in localStorage. Subnav links expand their target first. */
(function () {
  "use strict";
  var STORE_KEY = "rohan-sections-v1";
  var LIVE_OPEN = { matchups: 1, injuries: 1, "thursday-spotlight": 1, byes: 1, rosters: 1 };
  function slug(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
  }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveState(state) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }
  var state = loadState();
  var blocks = [];
  function setCollapsed(block, collapsed) {
    block.sec.classList.toggle("is-collapsed", collapsed);
    block.btn.textContent = collapsed ? "\u25b8 Expand section" : "\u25be Collapse section";
    block.btn.setAttribute("aria-expanded", String(!collapsed));
    state[block.key] = collapsed;
    saveState(state);
  }
  document.querySelectorAll(".live-block, section.section, section.champion").forEach(function (sec) {
    var title = sec.querySelector(":scope > .live-title, :scope > .section-title, :scope > .champ-copy");
    if (!title) return;
    var heading = title.querySelector("h2, h3");
    var key = sec.id || slug(heading ? heading.textContent : "");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "collapse-toggle";
    title.appendChild(btn);
    title.classList.add("collapse-title");
    sec.classList.add("collapsible");
    var block = { sec: sec, title: title, btn: btn, key: key };
    btn.addEventListener("click", function () { setCollapsed(block, !sec.classList.contains("is-collapsed")); });
    blocks.push(block);
  });
  blocks.forEach(function (b) {
    setCollapsed(b, Object.prototype.hasOwnProperty.call(state, b.key) ? state[b.key] : !LIVE_OPEN[b.key]);
  });
  function blockFor(el) {
    for (var i = 0; i < blocks.length; i++) if (blocks[i].sec === el) return blocks[i];
    return null;
  }
  function expandChain(target) {
    var node = target;
    while (node && node !== document.body) {
      var b = blockFor(node);
      if (b && b.sec.classList.contains("is-collapsed")) setCollapsed(b, false);
      node = node.parentElement;
    }
  }
  function goTo(hash, smooth) {
    var target = document.querySelector(hash);
    if (!target) return;
    expandChain(target);
    requestAnimationFrame(function () {
      target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    });
  }
  document.querySelectorAll(".page-nav a").forEach(function (a) {
    a.addEventListener("click", function (e) {
      var hash = a.getAttribute("href");
      if (hash && hash.charAt(0) === "#") {
        e.preventDefault();
        history.replaceState(null, "", hash);
        goTo(hash, true);
      }
    });
  });
  var expandAll = document.getElementById("expand-all-sections");
  var collapseAll = document.getElementById("collapse-all-sections");
  if (expandAll) expandAll.addEventListener("click", function () { blocks.forEach(function (b) { setCollapsed(b, false); }); });
  if (collapseAll) collapseAll.addEventListener("click", function () { blocks.forEach(function (b) { setCollapsed(b, true); }); });
  if (location.hash) goTo(location.hash, false);
}());
