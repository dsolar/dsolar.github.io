/* The home page scoreboard: today's games and each team's next one, straight from ESPN's public
   schedules (no key needed). To add or drop a team, edit TEAMS below: path is ESPN's sport/league,
   id is the team's ESPN abbreviation or number, and color is the chip next to its name.
   Times are Boston time. Live games refresh every minute while the page is open. */
(function () {
  var TEAMS = [
    { name: "Patriots", path: "football/nfl", id: "ne", color: "#002244" },
    { name: "Celtics", path: "basketball/nba", id: "bos", color: "#007A33" },
    { name: "Red Sox", path: "baseball/mlb", id: "bos", color: "#BD3039" },
    { name: "Bruins", path: "hockey/nhl", id: "bos", color: "#FFB81C" },
    { name: "BC football", path: "football/college-football", id: "103", color: "#98002E" },
    { name: "BC basketball", path: "basketball/mens-college-basketball", id: "103", color: "#98002E" },
    { name: "Penn State football", path: "football/college-football", id: "213", color: "#041E42" },
    { name: "Penn State basketball", path: "basketball/mens-college-basketball", id: "213", color: "#041E42" }
  ];
  var API = "https://site.api.espn.com/apis/site/v2/sports/";
  var TZ = "America/New_York";

  var list = document.getElementById("scoreboard-list");
  if (!list) return;
  var section = document.getElementById("scores"), note = document.getElementById("scoreboard-note");
  var timer = null, fails = 0, last = null;

  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  // "2026-10-22" for a moment, in Boston time
  var dayET = function (d) { return new Date(d).toLocaleDateString("en-CA", { timeZone: TZ }); };
  var clock = function (d) { return new Date(d).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }); };
  var weekday = function (d) { return new Date(d).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }); };
  var hourET = function (d) { return +new Date(d).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }); };
  var scoreOf = function (c) { var s = c && c.score; return s == null ? "" : typeof s === "object" ? (s.displayValue != null ? s.displayValue : s.value) : s; };

  function getJSON(url) {
    return fetch(url).then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); });
  }

  // One schedule game, boiled down to what a row needs. Same shape the calendar build reads.
  function game(team, ev) {
    var comp = (ev.competitions || [])[0] || {};
    var sides = comp.competitors || [];
    var mine = function (c) { var t = c.team || {}; return String(t.id) === team.id || String(t.abbreviation || "").toLowerCase() === team.id; };
    var me = sides.filter(mine)[0], opp = sides.filter(function (c) { return c !== me; })[0];
    if (!me || !opp) return null;
    var status = comp.status || ev.status || {}, type = status.type || {};
    // TV: national channels and our own side's (NESN, not the other team's local feed). Subscription packages
    // like League Pass are skipped; streams (Prime Video, ESPN+) show only when nothing is on TV.
    var side = me.homeAway === "home" ? "Home" : "Away";
    var ours = (comp.broadcasts || []).filter(function (b) {
      var market = (b.market || {}).type, kind = (b.type || {}).shortName;
      return kind !== "Subscription Package" && (!market || market === "National" || market === side);
    });
    var onTV = ours.filter(function (b) { return (b.type || {}).shortName === "TV"; });
    var tv = (onTV.length ? onTV : ours).map(function (b) { return (b.media && b.media.shortName) || (b.names || [])[0]; })
      .filter(function (n, i, all) { return n && all.indexOf(n) === i; });
    var link = (ev.links || []).filter(function (l) { return (l.rel || []).indexOf("gamecast") >= 0 || (l.rel || []).indexOf("summary") >= 0; })[0];
    var o = opp.team || {};
    return {
      date: ev.date,
      state: type.state || "pre",                 // pre, in or post
      detail: type.shortDetail || type.detail || "",
      timeKnown: comp.timeValid !== false && type.name !== "STATUS_TBD",
      home: me.homeAway === "home",
      opp: o.shortDisplayName || o.displayName || o.abbreviation || "TBD",
      us: scoreOf(me), them: scoreOf(opp),
      won: me.winner === true, lost: opp.winner === true,
      tv: tv.slice(0, 2).join(", "),
      url: link && link.href
    };
  }

  // A team's row: the game in progress, else today's, else the next one. Regular season first; the
  // postseason schedule is only asked for when the regular season has nothing left.
  function teamRow(team) {
    var url = API + team.path + "/teams/" + team.id + "/schedule";
    var played = false;
    var pick = function (data) {
      var now = Date.now(), today = dayET(now);
      if ((data.events || []).length) played = true;
      var games = (data.events || []).map(function (ev) { return game(team, ev); }).filter(Boolean)
        .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
      return games.filter(function (g) { return g.state === "in"; })[0]
        || games.filter(function (g) { return dayET(g.date) === today; }).sort(function (a, b) { return (a.state === "post") - (b.state === "post"); })[0]
        || games.filter(function (g) { return g.state === "pre" && new Date(g.date) > now; })[0];
    };
    return getJSON(url + "?seasontype=2").then(function (data) {
      return pick(data) || getJSON(url + "?seasontype=3").then(pick, function () { return null; });
    }).then(function (g) { return { team: team, game: g || null, over: !g && played }; }, function () { return { team: team, error: true }; });
  }

  function when(g) {
    var today = dayET(g.date) === dayET(Date.now());
    if (g.state === "in") return '<span class="sb-live"><span class="sb-dot" aria-hidden="true"></span>Live</span> ' + esc(g.detail);
    if (g.state === "post") return esc(g.detail || "Final");
    var time = g.timeKnown ? clock(g.date) : "Time TBD";
    if (today) return (g.timeKnown && hourET(g.date) >= 17 ? "Tonight " : "Today ") + esc(time);
    return esc(weekday(g.date)) + " · " + esc(time);
  }

  function row(r) {
    var t = r.team, g = r.game;
    var chip = '<span class="sb-chip" style="background:' + esc(t.color) + '" aria-hidden="true"></span>';
    var name = '<span class="sb-team">' + chip + esc(t.name) + "</span>";
    if (r.error) return '<li class="sb-row sb-quiet">' + name + '<span class="sb-game">Schedule unavailable</span></li>';
    if (!g) return '<li class="sb-row sb-quiet">' + name + '<span class="sb-game">' + (r.over ? "Offseason" : "No games scheduled") + "</span></li>";
    var today = g.state !== "pre" || dayET(g.date) === dayET(Date.now());
    var matchup = (g.home ? "vs " : "at ") + esc(g.opp);
    var score = g.state !== "pre" && g.us !== "" ? ' <b class="sb-score">' + esc(g.us) + "–" + esc(g.them) + "</b>"
      + (g.state === "post" && (g.won || g.lost) ? " " + (g.won ? "W" : "L") : "") : "";
    var label = g.url ? '<a href="' + esc(g.url) + '">' + matchup + "</a>" : matchup;
    return '<li class="sb-row' + (today ? " sb-today" : "") + (g.state === "in" ? " sb-now" : "") + '">' + name
      + '<span class="sb-game">' + label + score + "</span>"
      + '<span class="sb-when">' + when(g) + (g.tv && g.state !== "post" ? '<span class="sb-tv">' + esc(g.tv) + "</span>" : "") + "</span></li>";
  }

  // Live games first, then the rest of today by start time, then the next games by date, then teams with none.
  function rank(r) {
    var g = r.game;
    if (!g) return [4, 0];
    if (g.state === "in") return [0, +new Date(g.date)];
    if (dayET(g.date) === dayET(Date.now())) return [g.state === "post" ? 2 : 1, +new Date(g.date)];
    return [3, +new Date(g.date)];
  }

  function render(rows) {
    rows.sort(function (a, b) { var x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1]; });
    list.innerHTML = rows.map(row).join("");
    var playing = rows.filter(function (r) { return r.game && r.game.state !== "pre" || r.game && dayET(r.game.date) === dayET(Date.now()); }).length;
    note.textContent = rows.every(function (r) { return r.error; }) ? "Scores aren't available right now. Try again in a bit."
      : playing ? playing + (playing === 1 ? " game today" : " games today") : "No games today";
    section.hidden = false;
  }

  // Every minute while a game is on or about to start; a failed refresh keeps the last numbers and backs off.
  function schedule(rows) {
    clearTimeout(timer);
    var soon = rows.some(function (r) {
      var g = r.game;
      return g && (g.state === "in" || g.state === "pre" && new Date(g.date) - Date.now() < 15 * 60e3 && dayET(g.date) === dayET(Date.now()));
    });
    if (soon) timer = setTimeout(refresh, 60e3);
  }
  function refresh() {
    clearTimeout(timer);
    if (document.visibilityState === "hidden") return;
    Promise.all(TEAMS.map(teamRow)).then(function (rows) {
      // Keep a team's last good row if only its refresh failed
      if (last) rows = rows.map(function (r, i) { return r.error && last[i] && !last[i].error ? last[i] : r; });
      if (rows.every(function (r) { return r.error; }) && last) throw new Error("all failed");
      fails = 0; last = rows.slice();
      render(rows);
      schedule(rows);
    }).catch(function () {
      fails++;
      if (last) timer = setTimeout(refresh, Math.min(60e3 * Math.pow(2, fails - 1), 600e3));
    });
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") refresh(); });
  refresh();
})();
