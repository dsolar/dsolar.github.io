/* The home page scoreboard: today's games and each team's next one, straight from ESPN's free public
   feeds (no key needed). To add or drop a team, edit TEAMS below: path is ESPN's sport/league and id is
   the team's ESPN abbreviation or number.
   Where the data comes from:
     - each team's schedule: its next game, both teams' logos, AP ranks, TV and the Gamecast link
     - the league scoreboard for today: live score, clock and period, records, finals
   Times are Boston time. While a game is on, the scoreboard part refreshes every 30 seconds. */
(function () {
  var TEAMS = [
    { name: "Patriots", path: "football/nfl", id: "ne" },
    { name: "Celtics", path: "basketball/nba", id: "bos" },
    { name: "Red Sox", path: "baseball/mlb", id: "bos" },
    { name: "Bruins", path: "hockey/nhl", id: "bos" },
    { name: "BC football", path: "football/college-football", id: "103" },
    { name: "BC basketball", path: "basketball/mens-college-basketball", id: "103" },
    { name: "Penn State football", path: "football/college-football", id: "213" },
    { name: "Penn State basketball", path: "basketball/mens-college-basketball", id: "213" }
  ];
  // The league scoreboards leave most college games out unless asked for the whole division.
  var BOARD_QUERY = { "football/college-football": "&groups=80&limit=300", "basketball/mens-college-basketball": "&groups=50&limit=400" };
  var API = "https://site.api.espn.com/apis/site/v2/sports/";
  var TZ = "America/New_York";
  var SCHEDULE_MS = 10 * 60e3;   // a team's schedule is reused for this long; live numbers come from the scoreboard

  var list = document.getElementById("scoreboard-list");
  if (!list) return;
  var section = document.getElementById("scores"), note = document.getElementById("scoreboard-note");
  var timer = null, fails = 0, last = null, schedules = {};

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
  var isToday = function (g) { return g.state === "in" || dayET(g.date) === dayET(Date.now()); };
  var scoreOf = function (c) { var s = c && c.score; return s == null ? "" : typeof s === "object" ? (s.displayValue != null ? s.displayValue : s.value) : s; };

  function getJSON(url) {
    return fetch(url).then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); });
  }

  // ESPN's logo files are 500px; its image service hands back a 64px copy (a few KB) for a 24px spot.
  function small(href) {
    var m = /^https:\/\/a\.espncdn\.com(\/i\/teamlogos\/[^?#]+\.png)$/.exec(href || "");
    return m ? "https://a.espncdn.com/combiner/i?img=" + m[1] + "&w=64&h=64" : href;
  }
  function logos(t) {
    var all = t.logos || [], has = function (l, r) { return (l.rel || []).indexOf(r) >= 0; };
    var pick = function (test) { return (all.filter(test)[0] || {}).href; };
    return {
      light: pick(function (l) { return has(l, "scoreboard") && !has(l, "dark"); }) || pick(function (l) { return has(l, "default"); }) || t.logo,
      dark: pick(function (l) { return has(l, "scoreboard") && has(l, "dark"); }) || pick(function (l) { return has(l, "dark") && !has(l, "scoreboard"); })
    };
  }
  function side(c, name) {
    var t = c.team || {}, img = logos(t), rank = (c.curatedRank || {}).current;
    return { id: String(t.id), name: name || t.shortDisplayName || t.displayName || t.abbreviation || "TBD", abbr: t.abbreviation || "",
      logo: img.light, logoDark: img.dark, rank: rank && rank <= 25 ? rank : null,
      score: scoreOf(c), winner: c.winner === true, record: "" };
  }

  // One schedule game, boiled down to what a row needs.
  function game(team, ev) {
    var comp = (ev.competitions || [])[0] || {};
    var sides = comp.competitors || [];
    var mine = function (c) { var t = c.team || {}; return String(t.id) === team.id || String(t.abbreviation || "").toLowerCase() === team.id; };
    var me = sides.filter(mine)[0], opp = sides.filter(function (c) { return c !== me; })[0];
    if (!me || !opp) return null;
    // TV: national channels and our own side's (NESN, not the other team's local feed). Subscription packages
    // like League Pass are skipped; streams (Prime Video, ESPN+) show only when nothing is on TV.
    var homeAway = me.homeAway === "home" ? "Home" : "Away";
    var ours = (comp.broadcasts || []).filter(function (b) {
      var market = (b.market || {}).type, kind = (b.type || {}).shortName;
      return kind !== "Subscription Package" && (!market || market === "National" || market === homeAway);
    });
    var onTV = ours.filter(function (b) { return (b.type || {}).shortName === "TV"; });
    var tv = (onTV.length ? onTV : ours).map(function (b) { return (b.media && b.media.shortName) || (b.names || [])[0]; })
      .filter(function (n, i, all) { return n && all.indexOf(n) === i; });
    var link = (ev.links || []).filter(function (l) { return (l.rel || []).indexOf("summary") >= 0 && (l.rel || []).indexOf("desktop") >= 0; })[0];
    var g = {
      id: String(ev.id), date: ev.date, home: me.homeAway === "home",
      timeKnown: comp.timeValid !== false,
      us: side(me, team.name), them: side(opp),
      tv: tv.slice(0, 2).join(", "),
      url: link && link.href
    };
    setStatus(g, comp.status || ev.status);
    return g;
  }
  function setStatus(g, status) {
    var type = (status || {}).type || {};
    g.state = type.state || "pre";              // pre, in or post
    g.done = type.completed === true;           // post but not done: postponed, canceled
    g.detail = type.shortDetail || type.detail || "";
  }

  // Today's numbers from the league scoreboard: live score, clock and period, records, finals.
  function overlay(g, comp, status) {
    setStatus(g, comp.status || status);
    (comp.competitors || []).forEach(function (c) {
      var id = String((c.team || {}).id), s = id === g.us.id ? g.us : id === g.them.id ? g.them : null;
      if (!s) return;
      s.score = scoreOf(c);
      s.winner = c.winner === true;
      var rec = (c.records || []).filter(function (r) { return r.type === "total" || r.name === "overall"; })[0] || (c.records || [])[0];
      s.record = rec ? rec.summary : "";
    });
    var sit = comp.situation;
    g.situation = g.state === "in" && sit && (sit.downDistanceText || sit.shortDownDistanceText) || "";
  }

  // A team's next game from its schedule: the one in progress, else today's, else the next one.
  // Regular season first; the postseason schedule is only asked for when the regular season is done.
  function teamRow(team) {
    var url = API + team.path + "/teams/" + team.id + "/schedule";
    var played = false, ourLogo = null;
    var pick = function (data) {
      var now = Date.now(), today = dayET(now);
      if ((data.events || []).length) played = true;
      var games = (data.events || []).map(function (ev) { return game(team, ev); }).filter(Boolean)
        .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
      if (!ourLogo && games.length) ourLogo = games[0].us;
      return games.filter(function (g) { return g.state === "in"; })[0]
        || games.filter(function (g) { return dayET(g.date) === today; }).sort(function (a, b) { return (a.state === "post") - (b.state === "post"); })[0]
        || games.filter(function (g) { return g.state === "pre" && new Date(g.date) > now; })[0];
    };
    return getJSON(url + "?seasontype=2").then(function (data) {
      return pick(data) || getJSON(url + "?seasontype=3").then(pick, function () { return null; });
    }).then(function (g) { return { team: team, game: g || null, over: !g && played, logo: ourLogo, at: Date.now() }; },
            function () { return { team: team, error: true }; });
  }

  function logo(s) {
    if (!s || !s.logo) return '<span class="sb-mono" aria-hidden="true">' + esc(s && s.abbr) + "</span>";
    return '<picture class="sb-logo">' + (s.logoDark ? '<source media="(prefers-color-scheme: dark)" srcset="' + esc(small(s.logoDark)) + '">' : "")
      + '<img src="' + esc(small(s.logo)) + '" alt="" width="24" height="24" loading="lazy" data-abbr="' + esc(s.abbr) + '"></picture>';
  }
  var rankTag = function (s) { return s.rank ? '<span class="sb-rank">#' + s.rank + "</span>" : ""; };
  var tvTag = function (g) { return g.tv ? '<span class="sb-tv">' + esc(g.tv) + "</span>" : ""; };

  // Live, today and final: a two-line card like a real scoreboard, away team on top.
  function card(g) {
    var showScore = g.state === "in" || g.state === "post" && g.done;
    var line = function (s, other) {
      var lost = g.state === "post" && g.done && other.winner;
      return '<span class="sb-line' + (s === g.us ? " sb-us" : "") + (lost ? " sb-lost" : "") + '">' + logo(s)
        + '<span class="sb-name">' + rankTag(s) + esc(s.name) + (s.record ? "<small>" + esc(s.record) + "</small>" : "") + "</span>"
        + '<span class="sb-pts">' + (showScore ? esc(s.score) : "") + "</span></span>";
    };
    var away = g.home ? g.them : g.us, home = g.home ? g.us : g.them;
    var teams = line(away, home) + line(home, away);
    var status;
    if (g.state === "in") {
      status = '<span class="sb-live"><span class="sb-dot" aria-hidden="true"></span>Live</span><b>' + esc(g.detail) + "</b>"
        + (g.situation ? '<span class="sb-sit">' + esc(g.situation) + "</span>" : "") + tvTag(g);
    } else if (g.state === "post") {
      var result = g.done && (g.us.winner || g.them.winner) ? '<span class="sb-wl' + (g.us.winner ? "" : " sb-l") + '">' + (g.us.winner ? "W" : "L") + "</span>" : "";
      status = "<b>" + esc(g.detail || "Final") + "</b>" + result;
    } else {
      var time = g.timeKnown ? clock(g.date) : "Time TBD";
      status = "<b>" + (g.timeKnown && hourET(g.date) >= 17 ? "Tonight " : "Today ") + esc(time) + "</b>" + tvTag(g);
    }
    return '<li class="sb-row sb-card' + (g.state === "in" ? " sb-now" : "") + '">'
      + (g.url ? '<a class="sb-teams" href="' + esc(g.url) + '">' + teams + "</a>" : '<span class="sb-teams">' + teams + "</span>")
      + '<span class="sb-status">' + status + "</span></li>";
  }

  // Upcoming: one compact line.
  function next(g) {
    var matchup = logo(g.us) + '<span class="sb-who">' + esc(g.us.name) + '</span><span class="sb-vs">' + (g.home ? "vs" : "at") + "</span>"
      + logo(g.them) + '<span class="sb-opp">' + rankTag(g.them) + esc(g.them.name) + "</span>";
    var when = esc(weekday(g.date)) + " · " + (g.timeKnown ? esc(clock(g.date)) : "TBD");
    return '<li class="sb-row sb-next">' + (g.url ? '<a class="sb-matchup" href="' + esc(g.url) + '">' + matchup + "</a>" : '<span class="sb-matchup">' + matchup + "</span>")
      + '<span class="sb-when">' + when + tvTag(g) + "</span></li>";
  }

  function row(r) {
    if (r.game) return isToday(r.game) ? card(r.game) : next(r.game);
    return '<li class="sb-row sb-next sb-quiet"><span class="sb-matchup">' + logo(r.logo) + '<span class="sb-who">' + esc(r.team.name) + "</span></span>"
      + '<span class="sb-when">' + (r.error ? "Schedule unavailable" : r.over ? "Offseason" : "No games scheduled") + "</span></li>";
  }

  // Live games first, then the rest of today by start time, then today's finals, then the next games by date.
  function rank(r) {
    var g = r.game;
    if (!g) return [4, 0];
    if (g.state === "in") return [0, +new Date(g.date)];
    if (isToday(g)) return [g.state === "post" ? 2 : 1, +new Date(g.date)];
    return [3, +new Date(g.date)];
  }

  function render(rows) {
    rows = rows.slice().sort(function (a, b) { var x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1]; });
    list.innerHTML = rows.map(row).join("");
    var playing = rows.filter(function (r) { return r.game && isToday(r.game); }).length;
    note.textContent = rows.every(function (r) { return r.error; }) ? "Scores aren't available right now. Try again in a bit."
      : playing ? playing + (playing === 1 ? " game today" : " games today") : "No games today";
    section.hidden = false;
  }
  // A logo that doesn't load gives way to the team's abbreviation.
  list.addEventListener("error", function (e) {
    var img = e.target;
    if (img.tagName !== "IMG") return;
    var mono = document.createElement("span");
    mono.className = "sb-mono"; mono.setAttribute("aria-hidden", "true"); mono.textContent = img.getAttribute("data-abbr") || "";
    img.parentNode.replaceWith(mono);
  }, true);

  // Schedules are reused for 10 minutes; today's league scoreboards are fetched fresh every time.
  function rows() {
    var now = Date.now();
    return Promise.all(TEAMS.map(function (team, i) {
      var have = schedules[i];
      if (have && !have.error && now - have.at < SCHEDULE_MS) return have;
      return teamRow(team).then(function (r) { if (!r.error || !have) schedules[i] = r; return r.error && have ? have : r; });
    })).then(function (list) {
      var boards = {};
      list.forEach(function (r) {
        var g = r.game;
        if (!g || !isToday(g)) return;
        var key = r.team.path + "|" + dayET(g.date).replace(/-/g, "");
        if (!boards[key]) boards[key] = getJSON(API + r.team.path + "/scoreboard?dates=" + key.split("|")[1] + (BOARD_QUERY[r.team.path] || ""))
          .then(function (d) { return d.events || []; }, function () { return null; });
      });
      var keys = Object.keys(boards);
      return Promise.all(keys.map(function (k) { return boards[k]; })).then(function (results) {
        var byId = {};
        results.forEach(function (events) { (events || []).forEach(function (ev) { byId[String(ev.id)] = ev; }); });
        // Copies, so a later refresh starts again from the schedule rather than an old overlay
        return list.map(function (r) {
          if (!r.game) return r;
          var copy = Object.assign({}, r, { game: Object.assign({}, r.game, { us: Object.assign({}, r.game.us), them: Object.assign({}, r.game.them) }) });
          var ev = byId[copy.game.id];
          if (ev) overlay(copy.game, (ev.competitions || [])[0] || {}, ev.status);
          return copy;
        });
      });
    });
  }

  // Every 30 seconds while a game is on; every minute in the 15 minutes before one starts; otherwise wake up
  // 15 minutes before today's next game. A failed refresh keeps the last numbers and backs off.
  function schedule(list) {
    clearTimeout(timer);
    var now = Date.now(), wait = null;
    list.forEach(function (r) {
      var g = r.game;
      if (!g) return;
      if (g.state === "in") wait = 30e3;
      else if (g.state === "pre" && isToday(g)) {
        var until = new Date(g.date) - now - 15 * 60e3;
        var w = until <= 0 ? 60e3 : until;
        wait = wait == null ? w : Math.min(wait, w);
      }
    });
    if (wait != null) timer = setTimeout(refresh, Math.min(wait, 60 * 60e3));
  }
  function refresh() {
    clearTimeout(timer);
    if (document.visibilityState === "hidden") return;
    rows().then(function (list) {
      if (list.every(function (r) { return r.error; }) && last) throw new Error("all failed");
      fails = 0; last = list;
      render(list);
      schedule(list);
    }).catch(function () {
      fails++;
      if (last) timer = setTimeout(refresh, Math.min(60e3 * Math.pow(2, fails - 1), 600e3));
    });
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") refresh(); });
  refresh();
})();
