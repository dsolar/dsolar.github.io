/* Recent games for any player card, from ESPN's game log (it allows calls from the browser).
   A card drops in a slot and this file fills it once it's on the page:
     GameLog.slot({ league: "nba", espn: 3112335, name: "Nikola Jokic", n: 10 })
   league: nba, nfl, nhl, mlb, ncaab, ncaaf. Without an ESPN id (the MLB and NHL hubs use their leagues' ids) the
   player is found by name with ESPN's search, and the id is remembered.
   What it draws: the last games as bars for one stat (chips switch the stat), a dashed line at his average over those
   games, and the last five games as a small table. No games, or ESPN down: the slot removes itself.
   GameLog.load(league, {espn, name}) resolves to {season, labels, names, games: [newest first]} or null;
   GameLog.last(data) is a one-line summary of his latest game (My teams uses it). */
(function () {
  if (window.GameLog) return;
  var PATH = { nba: "basketball/nba", nfl: "football/nfl", nhl: "hockey/nhl", mlb: "baseball/mlb", ncaab: "basketball/mens-college-basketball", ncaaf: "football/college-football" };
  var SLUG = { nba: "nba", nfl: "nfl", nhl: "nhl", mlb: "mlb", ncaab: "mens-college-basketball", ncaaf: "college-football" };
  var API = "https://site.web.api.espn.com/apis/common/v3/";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var norm = function (s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z]/g, ""); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };

  // the stats a chart can show, best first; a chip appears for each one he has any of
  var METRICS = {
    hoops: [["points", "Points"], ["totalRebounds", "Rebounds"], ["assists", "Assists"], ["threePointFieldGoalsMade-threePointFieldGoalsAttempted", "Threes"], ["minutes", "Minutes"]],
    nhl: [["points", "Points"], ["goals", "Goals"], ["shotsTotal", "Shots"], ["timeOnIcePerGame", "Ice time"], ["saves", "Saves"], ["savePct", "Save %"], ["goalsAgainst", "Goals against"]],
    mlbBat: [["hits", "Hits"], ["homeRuns", "Home runs"], ["RBIs", "RBI"], ["runs", "Runs"], ["walks", "Walks"]],
    mlbPitch: [["strikeouts", "Strikeouts"], ["innings", "Innings"], ["earnedRuns", "Earned runs"], ["hits", "Hits allowed"], ["walks", "Walks"]],
    football: [["passingYards", "Pass yards"], ["rushingYards", "Rush yards"], ["receivingYards", "Rec yards"], ["receptions", "Catches"], ["passingTouchdowns", "Pass TD"], ["totalTackles", "Tackles"], ["sacks", "Sacks"], ["interceptions", "INT"]]
  };
  // the table's columns, by ESPN's stat names (short labels where ESPN repeats one, like YDS)
  var COLS = {
    hoops: ["minutes", "points", "totalRebounds", "assists", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted"],
    nhl: ["timeOnIcePerGame", "goals", "assists", "points", "shotsTotal", "plusMinus", "saves", "savePct", "goalsAgainst"],
    mlbBat: ["atBats", "hits", "homeRuns", "RBIs", "walks", "strikeouts"],
    mlbPitch: ["innings", "hits", "earnedRuns", "walks", "strikeouts", "pitches"],
    football: ["completions", "passingAttempts", "passingYards", "passingTouchdowns", "interceptions", "rushingAttempts", "rushingYards", "rushingTouchdowns", "receptions", "receivingYards", "receivingTouchdowns", "totalTackles", "sacks"]
  };
  var LABEL = {
    passingYards: "Pass yds", rushingYards: "Rush yds", receivingYards: "Rec yds", passingTouchdowns: "Pass TD", rushingTouchdowns: "Rush TD",
    receivingTouchdowns: "Rec TD", rushingAttempts: "Car", receptions: "Rec", completions: "Cmp", passingAttempts: "Att", interceptions: "INT",
    totalTackles: "Tkl", sacks: "Sacks", timeOnIcePerGame: "TOI", "fieldGoalsMade-fieldGoalsAttempted": "FG", "threePointFieldGoalsMade-threePointFieldGoalsAttempted": "3PT"
  };
  // short words for the summary line
  var WORD = { points: "pts", totalRebounds: "reb", assists: "ast", goals: "G", shotsTotal: "SOG", saves: "saves", hits: "H", homeRuns: "HR", RBIs: "RBI",
    strikeouts: "K", innings: "IP", earnedRuns: "ER", passingYards: "pass yds", rushingYards: "rush yds", receivingYards: "rec yds", receptions: "rec",
    passingTouchdowns: "pass TD", rushingTouchdowns: "rush TD", receivingTouchdowns: "rec TD", totalTackles: "tkl", sacks: "sacks" };

  function kind(league, names) {
    if (league === "nba" || league === "ncaab") return "hoops";
    if (league === "nhl") return "nhl";
    if (league === "mlb") return names.indexOf("innings") >= 0 || names.indexOf("earnedRuns") >= 0 ? "mlbPitch" : "mlbBat";
    return "football";
  }
  // "26:58" is minutes, "14-22" counts the first number, ".241" and "63.6" are numbers
  function num(v) {
    if (v == null || v === "" || v === "--") return null;
    var s = String(v), m = /^(\d+):(\d\d)$/.exec(s);
    if (m) return +m[1] + m[2] / 60;
    m = /^(-?\d+)-(\d+)$/.exec(s);
    if (m) return +m[1];
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  var mem = {}, flying = {};
  function findId(league, name) {
    var key = "gl-id:" + league + ":" + norm(name), have = store.get(key);
    if (have) return Promise.resolve(have === "-" ? null : have);
    return fetch(API + "search?type=player&limit=10&query=" + encodeURIComponent(name)).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var items = ((j && j.items) || []).filter(function (x) { return x.type === "player" && x.league === SLUG[league]; });
      var hit = items.filter(function (x) { return norm(x.displayName) === norm(name); })[0] || (items.length === 1 ? items[0] : null);
      store.set(key, hit ? String(hit.id) : "-");
      return hit ? String(hit.id) : null;
    });
  }
  function parse(league, j) {
    if (!j || !j.names || !j.events) return null;
    var names = j.names, labels = j.labels || names, seen = {}, games = [], season = "";
    (j.seasonTypes || []).forEach(function (st) {
      if (/preseason|spring/i.test(st.displayName || "")) return;      // spring training and preseason don't count
      if (!season) season = String(st.displayName || "").replace(/\s*(Regular Season|Postseason)\s*$/i, "");
      (st.categories || []).forEach(function (c) {
        (c.events || []).forEach(function (e) {
          var ev = j.events[e.eventId];
          if (!ev || seen[e.eventId] || !e.stats) return;
          seen[e.eventId] = 1;
          var row = {};
          names.forEach(function (nm, i) { row[nm] = e.stats[i]; });
          games.push({ id: e.eventId, date: ev.gameDate, at: ev.atVs === "@", opp: (ev.opponent && (ev.opponent.abbreviation || ev.opponent.displayName)) || "",
            res: ev.gameResult || "", score: ev.score || "", raw: row,
            link: ((ev.links || []).filter(function (l) { return (l.rel || []).indexOf("desktop") >= 0; })[0] || {}).href || "" });
        });
      });
    });
    if (!games.length) return null;
    games.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return { league: league, season: season, names: names, labels: labels, kind: kind(league, names), games: games };
  }
  function load(league, who) {
    who = who || {};
    if (!PATH[league] || (!who.espn && !who.name)) return Promise.resolve(null);
    var k = league + ":" + (who.espn || norm(who.name));
    if (mem[k] && Date.now() - mem[k].at < 6e5) return Promise.resolve(mem[k].d);
    if (flying[k]) return flying[k];
    var idP = who.espn ? Promise.resolve(String(who.espn)) : findId(league, who.name);
    flying[k] = idP.then(function (id) {
      if (!id) return null;
      return fetch(API + "sports/" + PATH[league] + "/athletes/" + encodeURIComponent(id) + "/gamelog").then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { var d = parse(league, j); if (d) d.espn = id; return d; });
    }).catch(function () { return null; }).then(function (d) { mem[k] = { at: Date.now(), d: d }; delete flying[k]; return d; });
    return flying[k];
  }

  function metrics(d) {
    var qb = d.names.indexOf("passingAttempts") >= 0;
    return METRICS[d.kind].filter(function (m) {
      if (d.names.indexOf(m[0]) < 0) return false;
      if (qb && (m[0] === "sacks" || m[0] === "interceptions")) return false; // a passer's sacks and picks are ones he took and threw
      return d.games.some(function (g) { return num(g.raw[m[0]]) > 0; });
    });
  }
  function pick(d, list) {
    var want = null;
    try { want = sessionStorage.getItem("gl-m:" + d.kind); } catch (e) { want = null; }
    if (want && list.some(function (m) { return m[0] === want; })) return want;
    if (d.kind === "football") { // his main job: the yards he piles up most
      var tot = function (nm) { return d.games.reduce(function (s, g) { return s + (num(g.raw[nm]) || 0); }, 0); };
      var yds = list.filter(function (m) { return /Yards$/.test(m[0]); }).sort(function (a, b) { return tot(b[0]) - tot(a[0]); });
      if (yds.length) return yds[0][0];
    }
    return list.length ? list[0][0] : null;
  }
  var fmt = function (v, nm) { if (v == null) return "–"; if (nm === "timeOnIcePerGame" || nm === "minutes" && v % 1) return Math.floor(v) + ":" + String(Math.round(v % 1 * 60)).padStart(2, "0"); if (nm === "savePct") return v.toFixed(3).replace(/^0/, ""); return v % 1 ? v.toFixed(1) : String(v); };
  var day = function (iso) { var t = new Date(iso); return isNaN(t) ? "" : t.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }); };

  function chart(d, nm, n) {
    var list = d.games.slice(0, n).reverse(), vals = list.map(function (g) { return num(g.raw[nm]); });
    var got = vals.filter(function (v) { return v != null; });
    if (!got.length) return "";
    var max = Math.max.apply(null, got.concat([1])), avg = got.reduce(function (s, v) { return s + v; }, 0) / got.length;
    var all = d.games.map(function (g) { return num(g.raw[nm]); }).filter(function (v) { return v != null; });
    var sAvg = all.reduce(function (s, v) { return s + v; }, 0) / all.length;
    var label = (METRICS[d.kind].filter(function (m) { return m[0] === nm; })[0] || [nm, nm])[1];
    var cols = list.map(function (g, i) {
      var v = vals[i], h = v == null ? 0 : Math.max(v > 0 ? 4 : 1.5, v / max * 100), hot = v != null && v >= avg && v > 0;
      return '<div class="gl-c" title="' + esc(day(g.date) + " " + (g.at ? "at " : "vs ") + g.opp + ", " + g.res + " " + g.score + ": " + fmt(v, nm) + " " + label.toLowerCase()) + '">' +
        '<span class="gl-v">' + esc(fmt(v, nm)) + '</span><span class="gl-b' + (hot ? " gl-hot" : "") + '" style="height:' + h.toFixed(1) + '%"></span>' +
        '<span class="gl-o">' + (g.at ? "@" : "") + esc(g.opp) + '</span><span class="gl-r' + (g.res === "W" ? " gl-w" : g.res === "L" ? " gl-l" : "") + '">' + esc(g.res || "") + "</span></div>";
    }).join("");
    var line = '<span class="gl-avg" style="bottom:' + (avg / max * 100).toFixed(1) + '%"></span>';
    var aside = "Avg " + fmt(Math.round(avg * 10) / 10, nm === "savePct" ? nm : "") + (list.length < d.games.length ? ", " + fmt(Math.round(sAvg * 10) / 10, nm === "savePct" ? nm : "") + " on the season" : "");
    return { html: '<div class="gl-chart" role="img" aria-label="' + esc(label + " in his last " + list.length + " games, average " + aside.replace(/^Avg /, "")) + '" style="--n:' + list.length + '"><div class="gl-plot">' + cols + line + "</div></div>", aside: aside, label: label };
  }
  function table(d, rows) {
    var want = COLS[d.kind].filter(function (nm) { return d.names.indexOf(nm) >= 0; });
    if (d.kind === "football") want = want.filter(function (nm) { return d.games.some(function (g) { return num(g.raw[nm]) > 0; }); });
    if (!want.length) want = d.names.slice(0, 6);
    want = want.slice(0, 7);
    var lab = function (nm) { return LABEL[nm] || d.labels[d.names.indexOf(nm)] || nm; };
    return '<div class="gl-tw"><table class="gl-t"><thead><tr><th>Date</th><th>Opp</th><th>Result</th>' + want.map(function (nm) { return "<th>" + esc(lab(nm)) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      d.games.slice(0, rows).map(function (g) {
        return "<tr><td>" + esc(day(g.date)) + "</td><td>" + (g.at ? "@ " : "") + esc(g.opp) + '</td><td class="' + (g.res === "W" ? "gl-w" : g.res === "L" ? "gl-l" : "") + '">' +
          (g.link ? '<a href="' + esc(g.link) + '" target="_blank" rel="noopener">' : "") + esc((g.res ? g.res + " " : "") + g.score) + (g.link ? "</a>" : "") + "</td>" +
          want.map(function (nm) { return "<td>" + esc(g.raw[nm] == null ? "–" : g.raw[nm]) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>";
  }
  function html(d, o) {
    o = o || {};
    var list = metrics(d), nm = o.metric && list.some(function (m) { return m[0] === o.metric; }) ? o.metric : pick(d, list);
    if (!nm) return "";
    var n = Math.min(o.n || 10, d.games.length), c = chart(d, nm, n);
    if (!c) return "";
    var sec = window.PCard ? window.PCard.sec("Last " + n + (n === 1 ? " game" : " games") + (d.season ? ", " + d.season : ""), c.aside)
      : '<p class="pc-sec"><span>Last ' + n + " games</span><em>" + esc(c.aside) + "</em></p>";
    var chips = list.length > 1 ? '<div class="gl-chips" role="group" aria-label="Stat to chart">' + list.map(function (m) { return '<button type="button" data-glm="' + esc(m[0]) + '" aria-pressed="' + (m[0] === nm) + '">' + esc(m[1]) + "</button>"; }).join("") + "</div>" : "";
    return sec + chips + c.html + (o.rows === 0 ? "" : table(d, o.rows || 5));
  }
  // his latest game in a line: "Nov 22 at BOS, W 112-105: 31 pts, 8 reb, 6 ast"
  function last(d) {
    if (!d || !d.games.length) return "";
    var g = d.games[0], list = metrics(d).slice(0, 3);
    var bits = list.map(function (m) { var v = num(g.raw[m[0]]); return v == null ? "" : fmt(v, m[0]) + " " + (WORD[m[0]] || m[1].toLowerCase()); }).filter(Boolean);
    return day(g.date) + " " + (g.at ? "at " : "vs ") + g.opp + ", " + (g.res ? g.res + " " : "") + String(g.score).replace(/-/g, "\u2011") + (bits.length ? ": " + bits.join(", ") : ""); // a score doesn't break at its hyphen
  }

  function slot(o) {
    if (!o || !PATH[o.league] || (!o.espn && !o.name)) return "";
    return '<div class="pc-gl" data-gl="' + esc(o.league) + '"' + (o.espn ? ' data-espn="' + esc(o.espn) + '"' : "") + ' data-name="' + esc(o.name || "") + '"' +
      (o.n ? ' data-n="' + (+o.n) + '"' : "") + (o.rows != null ? ' data-rows="' + (+o.rows) + '"' : "") + '><p class="gl-wait">Loading recent games…</p></div>';
  }
  function fill(el) {
    el.setAttribute("data-gl-on", "1");
    var league = el.getAttribute("data-gl"), who = { espn: el.getAttribute("data-espn"), name: el.getAttribute("data-name") };
    load(league, who).then(function (d) {
      var h = d ? html(d, { n: +el.getAttribute("data-n") || 10, rows: el.hasAttribute("data-rows") ? +el.getAttribute("data-rows") : 5 }) : "";
      if (!h) { el.remove(); return; }
      el._gl = d; el.innerHTML = h;
    });
  }
  function hydrate(root) { (root || document).querySelectorAll(".pc-gl:not([data-gl-on])").forEach(fill); }
  if (typeof document !== "undefined") {
    var queued = false;
    new MutationObserver(function () { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; hydrate(); }); })
      .observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-glm]"), el = b && b.closest(".pc-gl");
      if (!el || !el._gl) return;
      e.preventDefault(); e.stopPropagation();
      try { sessionStorage.setItem("gl-m:" + el._gl.kind, b.getAttribute("data-glm")); } catch (x) { /* private mode */ }
      el.innerHTML = html(el._gl, { metric: b.getAttribute("data-glm"), n: +el.getAttribute("data-n") || 10, rows: el.hasAttribute("data-rows") ? +el.getAttribute("data-rows") : 5 });
    });
  }
  window.GameLog = { load: load, html: html, last: last, slot: slot, hydrate: hydrate, parse: parse, _num: num };
})();
