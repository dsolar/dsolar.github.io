/* The ticker across the top of the home page: today's games and each team's next one, ESPN BottomLine
   style, straight from ESPN's free public feeds (no key needed). To add or drop a team, edit TEAMS below:
   path is ESPN's sport/league, id the team's ESPN abbreviation or number, tag the short league label.
   Where the data comes from:
     - each team's schedule: its next game, both teams' logos, AP ranks, TV and the Gamecast link
     - the league scoreboard for that game's date: score, clock and period, records, odds, finals
     - ESPN's Matchup Predictor (NFL, NBA, college football): our side's chance to win
     - calendar/prices.json, which Night Out's price watcher keeps: lowest ticket price for home games
     - assets/picks.json: David's picks, graded when the game ends (how to add one is in that file)
   Times are Boston time. While a game is on, the ticker refreshes every 30 seconds. */
(function () {
  var TEAMS = [
    { name: "Patriots", key: "patriots", path: "football/nfl", id: "ne", tag: "NFL" },
    { name: "Celtics", key: "celtics", path: "basketball/nba", id: "bos", tag: "NBA" },
    { name: "Red Sox", key: "redsox", path: "baseball/mlb", id: "bos", tag: "MLB" },
    { name: "Bruins", key: "bruins", path: "hockey/nhl", id: "bos", tag: "NHL" },
    { name: "BC", key: "bc-football", path: "football/college-football", id: "103", tag: "BC football" },
    { name: "BC", key: "bc-hoops", path: "basketball/mens-college-basketball", id: "103", tag: "BC hoops" },
    { name: "Penn State", key: "psu-football", path: "football/college-football", id: "213", tag: "PSU football" },
    { name: "Penn State", key: "psu-hoops", path: "basketball/mens-college-basketball", id: "213", tag: "PSU hoops" }
  ];
  // The league scoreboards leave most college games out unless asked for the whole division.
  var BOARD_QUERY = { "football/college-football": "&groups=80&limit=300", "basketball/mens-college-basketball": "&groups=50&limit=400" };
  var API = "https://site.api.espn.com/apis/site/v2/sports/";
  var PREDICTOR = { "football/nfl": 1, "basketball/nba": 1, "football/college-football": 1 };   // leagues ESPN predicts
  var TZ = "America/New_York";
  var CACHE_MS = 10 * 60e3;      // schedules and other days' scoreboards are reused this long; today's never are
  var STEP_MS = 5000;            // the ticker moves one game along this often

  var bar = document.getElementById("scores"), list = document.getElementById("scoreboard-list");
  if (!bar || !list) return;
  var viewport = bar.querySelector(".tk-viewport"), note = document.getElementById("scoreboard-note");
  var timer = null, fails = 0, last = null, schedules = {}, boards = {}, files = { at: 0 }, predictions = {};

  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  // "2026-10-22" for a moment, in Boston time
  var dayET = function (d) { return new Date(d).toLocaleDateString("en-CA", { timeZone: TZ }); };
  var clock = function (d) { return new Date(d).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }); };
  var weekday = function (d) { return new Date(d).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "numeric", day: "numeric" }); };
  var hourET = function (d) { return +new Date(d).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }); };
  var isToday = function (g) { return g.state === "in" || dayET(g.date) === dayET(Date.now()); };
  var scoreOf = function (c) { var s = c && c.score; return s == null ? "" : typeof s === "object" ? (s.displayValue != null ? s.displayValue : s.value) : s; };

  function getJSON(url) {
    return fetch(url).then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); });
  }

  // ESPN's logo files are 500px; its image service hands back a 64px copy (a few KB) for a 22px spot.
  function small(href) {
    var m = /^https:\/\/a\.espncdn\.com(\/i\/teamlogos\/[^?#]+\.png)$/.exec(href || "");
    return m ? "https://a.espncdn.com/combiner/i?img=" + m[1] + "&w=64&h=64" : href;
  }
  // The ticker is always dark, so it takes ESPN's dark-background logo when there is one.
  function logoOf(t) {
    var all = t.logos || [], has = function (l, r) { return (l.rel || []).indexOf(r) >= 0; };
    var pick = function (test) { return (all.filter(test)[0] || {}).href; };
    return pick(function (l) { return has(l, "scoreboard") && has(l, "dark"); }) || pick(function (l) { return has(l, "dark"); })
      || pick(function (l) { return has(l, "default"); }) || t.logo;
  }
  function side(c) {
    var t = c.team || {}, rank = (c.curatedRank || {}).current;
    return { id: String(t.id), abbr: t.abbreviation || "", name: t.shortDisplayName || t.displayName || t.abbreviation || "TBD",
      logo: logoOf(t), rank: rank && rank <= 25 ? rank : null, score: scoreOf(c), winner: c.winner === true, record: "" };
  }

  // One schedule game, boiled down to what a ticker item needs.
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
    var g = { id: String(ev.id), date: ev.date, home: me.homeAway === "home", timeKnown: comp.timeValid !== false,
      us: side(me), them: side(opp), tv: tv.slice(0, 2).join(", "), url: link && link.href, odds: "", situation: "",
      wp: null, tix: null, pick: "", graded: "" };
    setStatus(g, comp.status || ev.status);
    return g;
  }
  function setStatus(g, status) {
    var type = (status || {}).type || {};
    g.state = type.state || "pre";              // pre, in or post
    g.done = type.completed === true;           // post but not done: postponed, canceled
    g.detail = type.shortDetail || type.detail || "";
  }

  // The league scoreboard for the game's date: score, clock and period, records, odds.
  function overlay(g, comp, status) {
    setStatus(g, comp.status || status);
    (comp.competitors || []).forEach(function (c) {
      var id = String((c.team || {}).id), s = id === g.us.id ? g.us : id === g.them.id ? g.them : null;
      if (!s) return;
      s.score = scoreOf(c);
      s.winner = c.winner === true;
      var rec = (c.records || []).filter(function (r) { return r.type === "total" || r.name === "overall"; })[0] || (c.records || [])[0];
      s.record = rec && /[1-9]/.test(rec.summary || "") ? rec.summary : "";   // no "0-0" before a season starts
    });
    var o = (comp.odds || [])[0];
    g.odds = o && g.state === "pre" ? [o.details, o.overUnder != null ? "O/U " + o.overUnder : ""].filter(Boolean).join(" · ") : "";
    var sit = comp.situation;
    g.situation = g.state === "in" && sit && (sit.downDistanceText || sit.shortDownDistanceText) || "";
  }

  // A team's game from its schedule: the one in progress, else today's, else the next one.
  // Regular season first; the postseason schedule is only asked for when the regular season is done.
  function teamRow(team) {
    var url = API + team.path + "/teams/" + team.id + "/schedule";
    var played = false, us = null;
    var pick = function (data) {
      var now = Date.now(), today = dayET(now);
      if ((data.events || []).length) played = true;
      var games = (data.events || []).map(function (ev) { return game(team, ev); }).filter(Boolean)
        .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
      if (!us && games.length) us = games[0].us;
      return games.filter(function (g) { return g.state === "in"; })[0]
        || games.filter(function (g) { return dayET(g.date) === today; }).sort(function (a, b) { return (a.state === "post") - (b.state === "post"); })[0]
        || games.filter(function (g) { return g.state === "pre" && new Date(g.date) > now; })[0];
    };
    return getJSON(url + "?seasontype=2").then(function (data) {
      return pick(data) || getJSON(url + "?seasontype=3").then(pick, function () { return null; });
    }).then(function (g) { return { team: team, game: g || null, over: !g && played, us: us, at: Date.now() }; },
            function () { return { team: team, error: true }; });
  }

  function logo(s) {
    if (!s || !s.logo) return '<span class="tk-mono" aria-hidden="true">' + esc(s && s.abbr) + "</span>";
    return '<img class="tk-logo" src="' + esc(small(s.logo)) + '" alt="" width="22" height="22" loading="lazy" data-abbr="' + esc(s.abbr) + '">';
  }

  function item(r) {
    var t = r.team, g = r.game;
    if (!g) {
      return '<li class="tk-item tk-quiet"><div class="tk-top"><span class="tk-tag">' + esc(t.tag) + "</span></div>"
        + '<div class="tk-line">' + logo(r.us) + '<span class="tk-name">' + esc(t.name) + "</span></div>"
        + '<div class="tk-foot">' + (r.error ? "Schedule unavailable" : r.over ? "Offseason" : "No games scheduled") + "</div></li>";
    }
    var showScore = g.state === "in" || g.state === "post" && g.done;
    var line = function (s, other) {
      var lost = g.state === "post" && g.done && other.winner;
      return '<div class="tk-line' + (s === g.us ? " tk-us" : "") + (lost ? " tk-lost" : "") + '">' + logo(s)
        + '<span class="tk-name">' + (s.rank ? '<span class="tk-rank">' + s.rank + "</span>" : "") + esc(s.abbr || s.name)
        + (s.record ? "<small>" + esc(s.record) + "</small>" : "") + "</span>"
        + '<span class="tk-pts">' + (showScore ? esc(s.score) : "") + "</span></div>";
    };
    var away = g.home ? g.them : g.us, home = g.home ? g.us : g.them;
    var status;
    if (g.state === "in") status = '<span class="tk-live"><span class="tk-dot" aria-hidden="true"></span>Live</span> ' + esc(g.detail);
    else if (g.state === "post") status = esc(g.detail || "Final") + (g.done && (g.us.winner || g.them.winner) ? ' <span class="tk-wl">' + (g.us.winner ? "W" : "L") + "</span>" : "");
    else {
      var time = g.timeKnown ? clock(g.date) : "TBD";
      status = isToday(g) ? (g.timeKnown && hourET(g.date) >= 17 ? "Tonight " : "Today ") + esc(time) : esc(weekday(g.date)) + " · " + esc(time);
    }
    var dot = ' <span aria-hidden="true">·</span> ';
    var lines = g.state === "pre" ? [[g.tv, g.tix ? "Tix $" + Math.round(g.tix.low) + (g.tix.down ? " ↓" : "") : ""],
                                     [g.odds, g.wp != null ? "ESPN: " + (g.us.abbr || g.us.name) + " " + g.wp + "%" : ""]]
      : g.state === "in" ? [[g.situation, g.tv]] : [];
    var foot = lines.map(function (l) { return l.filter(Boolean).map(esc).join(dot); }).filter(Boolean)
      .map(function (l) { return '<div class="tk-foot">' + l + "</div>"; }).join("");
    var mark = { won: "✓ ", lost: "✗ ", push: "Push · " }[g.graded] || "Pick: ";
    var pick = g.pick ? '<div class="tk-pick tk-pick-' + (g.graded || "open") + '">' + mark + esc(g.pick) + "</div>" : "";
    var inner = '<div class="tk-top"><span class="tk-tag">' + esc(t.tag) + '</span><span class="tk-status">' + status + "</span></div>"
      + line(away, home) + line(home, away) + (foot || pick ? foot + pick : '<div class="tk-foot">&nbsp;</div>');
    var cls = "tk-item" + (g.state === "in" ? " tk-now" : isToday(g) ? " tk-today" : "");
    return '<li class="' + cls + '">' + (g.url ? '<a href="' + esc(g.url) + '" aria-label="' + esc(label(r)) + '">' + inner + "</a>" : inner) + "</li>";
  }
  // What a screen reader hears for one game: "Bruins vs Predators, tonight 7:00 PM, NESN"
  function label(r) {
    var g = r.game, parts = [r.team.name + (g.home ? " vs " : " at ") + g.them.name];
    if (g.state === "in" || g.state === "post" && g.done) parts.push(g.us.score + " to " + g.them.score);
    parts.push(g.state === "pre" ? (isToday(g) ? "today " : weekday(g.date) + " ") + (g.timeKnown ? clock(g.date) : "time TBD") : g.detail);
    if (g.tv && g.state !== "post") parts.push(g.tv);
    if (g.state === "pre" && g.odds) parts.push("odds " + g.odds);
    if (g.state === "pre" && g.wp != null) parts.push("ESPN gives " + r.team.name + " a " + g.wp + " percent chance");
    if (g.tix) parts.push("tickets from $" + Math.round(g.tix.low));
    if (g.pick) parts.push("my pick " + g.pick + (g.graded ? ", " + g.graded : ""));
    return parts.join(", ");
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
    var keep = viewport.scrollLeft;
    list.innerHTML = rows.map(item).join("");
    viewport.scrollLeft = keep;
    var today = rows.filter(function (r) { return r.game && isToday(r.game); }).length;
    var live = rows.filter(function (r) { return r.game && r.game.state === "in"; }).length;
    note.textContent = live ? live + " live" : today ? today + " today" : "Next up";
    bar.hidden = rows.every(function (r) { return r.error; });
  }
  // A logo that doesn't load gives way to the team's abbreviation.
  list.addEventListener("error", function (e) {
    var img = e.target;
    if (img.tagName !== "IMG") return;
    var mono = document.createElement("span");
    mono.className = "tk-mono"; mono.setAttribute("aria-hidden", "true"); mono.textContent = img.getAttribute("data-abbr") || "";
    img.replaceWith(mono);
  }, true);

  function board(path, ymd) {
    var key = path + "|" + ymd, have = boards[key], today = ymd === dayET(Date.now()).replace(/-/g, "");
    if (have && !today && Date.now() - have.at < CACHE_MS) return have.events;
    var events = getJSON(API + path + "/scoreboard?dates=" + ymd + (BOARD_QUERY[path] || ""))
      .then(function (d) { return d.events || []; }, function () { return null; });
    boards[key] = { at: Date.now(), events: events };
    return events;
  }
  // Schedules are reused for 10 minutes; each game's league scoreboard fills in the rest.
  function rows() {
    var now = Date.now();
    return Promise.all(TEAMS.map(function (team, i) {
      var have = schedules[i];
      if (have && !have.error && now - have.at < CACHE_MS) return have;
      return teamRow(team).then(function (r) { if (!r.error || !have) schedules[i] = r; return r.error && have ? have : r; });
    })).then(function (list) {
      return Promise.all(list.map(function (r) {
        if (!r.game) return r;
        // Copies, so a later refresh starts again from the schedule rather than an old overlay
        var copy = Object.assign({}, r, { game: Object.assign({}, r.game, { us: Object.assign({}, r.game.us), them: Object.assign({}, r.game.them) }) });
        return board(r.team.path, dayET(r.game.date).replace(/-/g, "")).then(function (events) {
          var ev = (events || []).filter(function (e) { return String(e.id) === copy.game.id; })[0];
          if (ev) overlay(copy.game, (ev.competitions || [])[0] || {}, ev.status);
          return copy;
        });
      }));
    }).then(extras);
  }

  // Ticket prices, picks and ESPN's win probability, layered on after the scores.
  function sideFiles() {
    if (!files.at || Date.now() - files.at > CACHE_MS) {
      var v = "?v=" + Math.floor(Date.now() / CACHE_MS);
      files = { at: Date.now(),
        prices: getJSON("calendar/prices.json" + v).then(function (d) { return d.events || {}; }, function () { return {}; }),
        picks: getJSON("assets/picks.json" + v).then(function (d) { return d.picks || {}; }, function () { return {}; }) };
    }
    return Promise.all([files.prices, files.picks]);
  }
  function predictor(r) {
    var g = r.game;
    if (!PREDICTOR[r.team.path] || g.state !== "pre" || new Date(g.date) - Date.now() > 7 * 864e5) return Promise.resolve(null);
    var have = predictions[g.id];
    if (have && Date.now() - have.at < 3 * CACHE_MS) return have.pct;
    var pct = getJSON(API + r.team.path + "/summary?event=" + g.id).then(function (d) {
      var p = d.predictor || {}, mine = [p.homeTeam || {}, p.awayTeam || {}].filter(function (s) { return String(s.id) === g.us.id; })[0];
      var n = mine ? parseFloat(mine.gameProjection) : NaN;
      return isFinite(n) ? Math.round(n) : null;
    }, function () { return null; });
    predictions[g.id] = { at: Date.now(), pct: pct };
    return pct;
  }
  function extras(list) {
    return sideFiles().then(function (f) {
      var prices = f[0], picks = f[1];
      return Promise.all(list.map(function (r) {
        var g = r.game;
        if (!g) return r;
        var rec = prices["espn-" + g.id], h = rec && rec.history || [];
        if (rec && rec.low && g.state === "pre") g.tix = { low: rec.low, down: h.length > 1 && h[h.length - 1][1] < h[h.length - 2][1] };
        g.pick = picks[g.id] || picks[r.team.key + " " + dayET(g.date)] || "";
        g.graded = g.pick ? grade(g.pick, g) : "";
        return predictor(r).then(function (pct) { g.wp = pct; return r; });
      }));
    });
  }
  // "BOS -1.5", "NE +3", "BOS ML" or "BOS -142" (a moneyline), "O 50.5", "U 6.5": won, lost or push once it's final.
  function grade(pick, g) {
    if (!(g.state === "post" && g.done)) return "";
    var us = parseFloat(g.us.score), them = parseFloat(g.them.score);
    if (!isFinite(us) || !isFinite(them)) return "";
    var m = /^\s*(o|over|u|under)\s*(\d+(?:\.\d+)?)\s*$/i.exec(pick);
    if (m) { var total = us + them, line = +m[2]; return total === line ? "push" : (total > line) === /^o/i.test(m[1]) ? "won" : "lost"; }
    m = /^\s*([a-z]{2,5})\s*([+-]?\d+(?:\.\d+)?)?\s*(ml)?\s*$/i.exec(pick);
    if (!m) return "";
    var team = m[1].toUpperCase(), ours = team === g.us.abbr.toUpperCase(), theirs = team === g.them.abbr.toUpperCase();
    if (!ours && !theirs) return "";
    var spread = m[2] && !m[3] && Math.abs(+m[2]) < 100 ? +m[2] : 0;   // three digits is a moneyline price, not a spread
    var margin = (ours ? us - them : them - us) + spread;
    return margin === 0 ? "push" : margin > 0 ? "won" : "lost";
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

  // ---- Moving it along: one game every few seconds, paused while someone is looking at or touching it.
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var held = false, resumeAt = 0;
  var stepWidth = function () { var first = list.querySelector(".tk-item"); return first ? first.getBoundingClientRect().width + 10 : 240; };
  function move(dir) {
    var max = viewport.scrollWidth - viewport.clientWidth;
    if (max <= 2) return;
    var behavior = still ? "auto" : "smooth";
    if (dir > 0 && viewport.scrollLeft >= max - 4) viewport.scrollTo({ left: 0, behavior: behavior });
    else if (dir < 0 && viewport.scrollLeft <= 4) viewport.scrollTo({ left: max, behavior: behavior });
    else viewport.scrollBy({ left: dir * stepWidth(), behavior: behavior });
  }
  bar.querySelector(".tk-prev").addEventListener("click", function () { resumeAt = Date.now() + 15e3; move(-1); });
  bar.querySelector(".tk-next").addEventListener("click", function () { resumeAt = Date.now() + 15e3; move(1); });
  ["mouseenter", "focusin"].forEach(function (e) { bar.addEventListener(e, function () { held = true; }); });
  ["mouseleave", "focusout"].forEach(function (e) { bar.addEventListener(e, function () { held = false; }); });
  viewport.addEventListener("touchstart", function () { resumeAt = Date.now() + 15e3; }, { passive: true });
  if (!still) setInterval(function () {
    if (!held && Date.now() > resumeAt && document.visibilityState === "visible" && !bar.hidden) move(1);
  }, STEP_MS);

  refresh();
})();
