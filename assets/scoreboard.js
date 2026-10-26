/* The ticker across the top of the home page, ESPN BottomLine style, with three views to switch between:
     Tonight      today's games and each team's next one, plus big games (below)
     Last night   yesterday's finals: our teams' and the big games'
     Guillotine   the Bastille Day league live: each team's points so far and its chance of being cut,
                  from guillotine/data.json, guillotine/live.js and guillotine/sim.js
   The choice is remembered on this device; ?ticker=last (or tonight, guillotine) opens a view directly.
   Without a choice, it opens on Guillotine while NFL games are on, else Tonight.
   Games come straight from ESPN's free public feeds (no key needed). To add or drop a team, edit TEAMS below:
   path is ESPN's sport/league, id the team's ESPN abbreviation or number, tag the short league label.
   Where the data comes from:
     - each team's schedule: its next game, both teams' logos, AP ranks, TV and the Gamecast link
     - the league scoreboard for that game's date: score, clock and period, records, odds, finals
     - the same scoreboard's ticket listing: the lowest resale price (Vivid Seats, via ESPN)
     - assets/picks.json: David's picks, graded when the game ends (how to add one is in that file)
   Big games from around the sports world follow our teams' games (see BIG below for what counts).
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
  // Big games, from these leagues' scoreboards for today and the next two days: any playoff or postseason game,
  // ranked vs. ranked in college, special events ESPN headlines (international, outdoor), and NFL games
  // between two teams at .650 or better. Never more than MAX_BIG, and never our own teams' games twice.
  var BIG = [
    { path: "football/nfl", tag: "NFL" }, { path: "basketball/nba", tag: "NBA" }, { path: "hockey/nhl", tag: "NHL" },
    { path: "baseball/mlb", tag: "MLB" }, { path: "football/college-football", tag: "College football", college: true },
    { path: "basketball/mens-college-basketball", tag: "College hoops", college: true }
  ];
  var BIG_DAYS = 3, MAX_BIG = 6;
  var TZ = "America/New_York";
  var CACHE_MS = 10 * 60e3;      // schedules and other days' scoreboards are reused this long; today's never are
  var STEP_MS = 5000;            // the ticker moves one game along this often
  // The guillotine view. Its script versions should match the ones guillotine/index.html loads.
  var LEAGUE = { dir: "guillotine/", scripts: ["sim.js?v=9", "live.js?v=1"], mine: "Holofernes", runs: 4000 };
  var VIEWS = ["tonight", "last", "guillotine"], VIEW_KEY = "ticker-view";

  var bar = document.getElementById("scores"), list = document.getElementById("scoreboard-list");
  if (!bar || !list) return;
  var viewport = bar.querySelector(".tk-viewport"), note = document.getElementById("scoreboard-note");
  var timer = null, fails = 0, last = {}, schedules = {}, boards = {}, files = { at: 0 };
  var view = "tonight", buttons = [].slice.call(bar.querySelectorAll(".tk-views button"));

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
  // "20261025": the day before today, in Boston time
  var yesterday = function () { return new Date(new Date(dayET(Date.now()) + "T12:00:00Z") - 864e5).toISOString().slice(0, 10).replace(/-/g, ""); };
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
      || pick(function (l) { return has(l, "default"); })
      || (t.logo && t.logo.replace("/500/", "/500-dark/"));   // scoreboard teams carry one logo; its dark twin sits beside it
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
      tix: null, pick: "", graded: "" };
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
  function overlay(g, comp, status, path) {
    setStatus(g, comp.status || status);
    (comp.competitors || []).forEach(function (c) {
      var id = String((c.team || {}).id), s = id === g.us.id ? g.us : id === g.them.id ? g.them : null;
      if (!s) return;
      s.score = scoreOf(c);
      s.winner = c.winner === true;
      var rec = (c.records || []).filter(function (r) { return r.type === "total" || r.name === "overall"; })[0] || (c.records || [])[0];
      s.record = rec && /[1-9]/.test(rec.summary || "") ? rec.summary : "";   // no "0-0" before a season starts
    });
    // "Tickets as low as $46": Vivid Seats' lowest resale price, which ESPN carries on its scoreboard
    var tix = /\$\s*([\d,]+)/.exec(((comp.tickets || [])[0] || {}).summary || "");
    g.tix = tix && g.state === "pre" ? { low: +tix[1].replace(/,/g, "") } : null;
    // Each team's own number sits on its line: the moneyline in hockey and baseball, the spread everywhere else.
    var o = (comp.odds || [])[0] || {}, money = /hockey|baseball/.test(path || "");
    var market = money ? o.moneyline : o.pointSpread;
    [[g.us, g.home ? "home" : "away"], [g.them, g.home ? "away" : "home"]].forEach(function (pair) {
      var m = market && market[pair[1]] || {}, v = m.close || m.open || {};
      pair[0].line = g.state === "pre" ? String((money ? v.odds : v.line) || "") : "";
    });
    if (g.state === "pre" && !g.us.line && !g.them.line && o.details) {   // only the favorite's number came back
      var fav = /^([A-Z]{2,5})\s+(\S+)$/.exec(o.details);
      if (fav) [g.us, g.them].forEach(function (x) { if (x.abbr === fav[1]) x.line = fav[2]; });
    }
    g.odds = g.state === "pre" && o.overUnder != null ? "O/U " + o.overUnder : "";
    // Only the favorite's number is shown (the lower, more negative one); the over/under takes the other row.
    var num = function (x) { var n = parseFloat(x.line); return isFinite(n) ? n : Infinity; };
    var fav = num(g.us) < num(g.them) ? g.us : num(g.them) < num(g.us) ? g.them : null;
    if (fav && num(fav) < 0) {
      var dog = fav === g.us ? g.them : g.us;
      dog.line = g.odds; g.odds = "";
    } else if (g.odds) { g.us.line = g.them.line = ""; }   // no clear favorite: just the total, in the footer
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

  // A tile with no game on it: a message, or a league summary.
  function noteItem(tag, title, foot, href) {
    var inner = '<div class="tk-top"><span class="tk-tag">' + esc(tag) + "</span></div>"
      + '<div class="tk-line tk-gline"><span class="tk-name">' + esc(title) + "</span></div>"
      + '<div class="tk-foot">' + esc(foot) + "</div>";
    return '<li class="tk-item tk-quiet">' + (href ? '<a href="' + esc(href) + '">' + inner + "</a>" : inner) + "</li>";
  }

  function item(r) {
    if (r.note) return noteItem(r.note[0], r.note[1], r.note[2], r.note[3]);
    if (r.league) return gItem(r);
    var t = r.team, g = r.game;
    if (!g) {
      return '<li class="tk-item tk-quiet"><div class="tk-top"><span class="tk-tag">' + esc(t.tag) + "</span></div>"
        + '<div class="tk-line">' + logo(r.us) + '<span class="tk-name">' + esc(t.name) + "</span></div>"
        + '<div class="tk-foot">' + (r.error ? "Schedule unavailable" : r.over ? "Offseason" : "No games scheduled") + "</div></li>";
    }
    var showScore = g.state === "in" || g.state === "post" && g.done;
    var line = function (s, other) {
      var lost = g.state === "post" && g.done && other.winner;
      return '<div class="tk-line' + (s === g.us && !r.big ? " tk-us" : "") + (lost ? " tk-lost" : "") + '">' + logo(s)
        + '<span class="tk-name">' + (s.rank ? '<span class="tk-rank">' + s.rank + "</span>" : "") + esc(s.abbr || s.name)
        + (s.record ? "<small>" + esc(s.record) + "</small>" : "")
        + "</span>" + (showScore ? '<span class="tk-pts">' + esc(s.score) + "</span>" : '<span class="tk-odds">' + esc(s.line || "") + "</span>") + "</div>";
    };
    var away = g.home ? g.them : g.us, home = g.home ? g.us : g.them;
    var status;
    if (g.state === "in") status = '<span class="tk-live"><span class="tk-dot" aria-hidden="true"></span>Live</span> ' + esc(g.detail);
    else if (g.state === "post") status = esc(g.detail || "Final") + (g.done && !r.big && (g.us.winner || g.them.winner) ? ' <span class="tk-wl">' + (g.us.winner ? "W" : "L") + "</span>" : "");
    else {
      var time = g.timeKnown ? clock(g.date) : "TBD";
      status = isToday(g) ? (g.timeKnown && hourET(g.date) >= 17 ? "Tonight " : "Today ") + esc(time) : esc(weekday(g.date)) + " · " + esc(time);
    }
    var dot = ' <span aria-hidden="true">·</span> ';
    var lines = g.state === "pre" ? [[g.tv, g.tix ? "Tix $" + g.tix.low.toLocaleString("en-US") : "", g.odds]]
      : g.state === "in" ? [[g.situation, g.tv]] : [];
    var foot = lines.map(function (l) { return l.filter(Boolean).map(esc).join(dot); }).filter(Boolean)
      .map(function (l) { return '<div class="tk-foot">' + l + "</div>"; }).join("");
    var mark = { won: "✓ ", lost: "✗ ", push: "Push · " }[g.graded] || "Pick: ";
    var pick = g.pick ? '<div class="tk-pick tk-pick-' + (g.graded || "open") + '">' + mark + esc(g.pick) + "</div>" : "";
    var inner = '<div class="tk-top"><span class="tk-tag">' + esc(t.tag) + '</span><span class="tk-status">' + status + "</span></div>"
      + line(away, home) + line(home, away) + (foot || pick ? foot + pick : '<div class="tk-foot">&nbsp;</div>');
    var cls = "tk-item" + (r.big ? " tk-big" : "") + (g.state === "in" ? " tk-now" : isToday(g) ? " tk-today" : "");
    return '<li class="' + cls + '">' + (g.url ? '<a href="' + esc(g.url) + '" aria-label="' + esc(label(r)) + '">' + inner + "</a>" : inner) + "</li>";
  }
  // What a screen reader hears for one game: "Bruins vs Predators, tonight 7:00 PM, NESN"
  function label(r) {
    var g = r.game, parts = [r.big ? g.us.name + " at " + g.them.name + ", " + r.team.tag : r.team.name + (g.home ? " vs " : " at ") + g.them.name];
    if (g.state === "in" || g.state === "post" && g.done) parts.push(g.us.score + " to " + g.them.score);
    parts.push(g.state === "pre" ? (isToday(g) ? "today " : weekday(g.date) + " ") + (g.timeKnown ? clock(g.date) : "time TBD") : g.detail);
    if (g.tv && g.state !== "post") parts.push(g.tv);
    if (g.state === "pre") [g.us, g.them].forEach(function (x) {
      if (x.line) parts.push(/^O\/U/.test(x.line) ? x.line.replace("O/U", "over-under") : x.abbr + " favored, " + x.line);
    });
    if (g.state === "pre" && g.odds) parts.push(g.odds.replace("O/U", "over-under"));
    if (g.tix) parts.push("tickets from $" + Math.round(g.tix.low));
    if (g.pick) parts.push("my pick " + g.pick + (g.graded ? ", " + g.graded : ""));
    return parts.join(", ");
  }

  // Live games first, then the rest of today by start time, then today's finals, then the next games by date.
  // Live and today: our teams before the big games. Later games simply by date.
  function rank(r) {
    var g = r.game, b = r.big ? 1 : 0;
    if (!g) return [4, b, 0];
    if (g.state === "in") return [0, b, +new Date(g.date)];
    if (isToday(g)) return [g.state === "post" ? 2 : 1, b, +new Date(g.date)];
    return [3, 0, +new Date(g.date)];
  }

  function render(rows) {
    if (view === "tonight") rows = rows.slice().sort(function (a, b) { var x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
    var keep = viewport.scrollLeft;
    // ESPN down: say so, and keep the bar up so the other views can still be picked.
    if (rows.every(function (r) { return r.error; })) rows = [{ note: ["Scoreboard", "Scores unavailable", "Trying again shortly"] }];
    list.innerHTML = rows.map(item).join("");
    viewport.scrollLeft = keep;
    var today = rows.filter(function (r) { return r.game && !r.big && isToday(r.game); }).length;
    var live = rows.filter(function (r) { return r.game && r.game.state === "in"; }).length;
    var finals = rows.filter(function (r) { return r.game && r.game.state === "post"; }).length;
    note.textContent = view === "guillotine" ? rows.note || ""
      : view === "last" ? (finals ? finals + (finals === 1 ? " final" : " finals") : "")
      : live ? live + " live" : today ? today + " today" : "Next up";
    bar.hidden = false;
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
          if (ev) overlay(copy.game, (ev.competitions || [])[0] || {}, ev.status, r.team.path);
          return copy;
        });
      }));
    }).then(extras).then(function (list) {
      var ours = {};
      list.forEach(function (r) { if (r.game) ours[r.game.id] = 1; });
      return bigGames(ours).then(function (big) { return list.concat(big); }, function () { return list; });
    });
  }

  function bigReason(ev, league) {
    var comp = (ev.competitions || [])[0] || {}, sides = comp.competitors || [];
    var note = ((comp.notes || [])[0] || {}).headline || "";
    if ((ev.season || {}).type === 3) return note || league.tag + " playoffs";
    if (league.college) {
      var ranks = sides.map(function (c) { return (c.curatedRank || {}).current || 99; });
      return sides.length === 2 && ranks.every(function (n) { return n <= 25; }) ? "Top 25 matchup" : "";
    }
    if (note) return note;
    if (league.path === "football/nfl") {
      var pct = sides.map(function (c) {
        var m = /^(\d+)-(\d+)(?:-(\d+))?/.exec(((c.records || [])[0] || {}).summary || "");
        if (!m) return 0;
        var w = +m[1], l = +m[2], t = +(m[3] || 0), n = w + l + t;
        return n >= 5 ? (w + t / 2) / n : 0;
      });
      if (sides.length === 2 && pct.every(function (x) { return x >= 0.65; })) return "Big matchup";
    }
    return "";
  }
  // Today's and the next days' big games, or (finals) one past day's finished ones.
  function bigGames(ours, finals) {
    var days = [];
    if (finals) days.push(finals);
    else for (var n = 0; n < BIG_DAYS; n++) days.push(dayET(Date.now() + n * 864e5).replace(/-/g, ""));
    var jobs = [];
    BIG.forEach(function (league) {
      days.forEach(function (d) {
        jobs.push(board(league.path, d).then(function (evs) { return (evs || []).map(function (ev) { return { league: league, ev: ev }; }); }));
      });
    });
    return Promise.all(jobs).then(function (lists) {
      var out = [], seen = {};
      [].concat.apply([], lists).forEach(function (x) {
        var ev = x.ev, why = bigReason(ev, x.league), id = String(ev.id);
        if (!why || ours[id] || seen[id]) return;
        var comp = (ev.competitions || [])[0] || {};
        var away = (comp.competitors || []).filter(function (c) { return c.homeAway === "away"; })[0];
        var g = away && game({ id: String((away.team || {}).id) }, ev);   // "us" is the away team, listed on top
        if (!g) return;
        overlay(g, comp, ev.status, x.league.path);
        if (finals ? !(g.state === "post" && g.done) : g.state === "post" && !isToday(g)) return;   // in Tonight, yesterday's final is old news
        var national = (comp.broadcasts || []).filter(function (b) { return b.market === "national"; })
          .map(function (b) { return (b.names || [])[0]; }).filter(Boolean);
        if (national.length) g.tv = national.slice(0, 2).join(", ");
        seen[id] = 1;
        out.push({ team: { name: g.us.name, tag: why, path: x.league.path, key: "" }, game: g, big: true });
      });
      return out.sort(function (a, b) { var x = rank(a), y = rank(b); return x[0] - y[0] || x[2] - y[2]; }).slice(0, MAX_BIG);
    });
  }

  // Picks, layered on after the scores.
  function sideFiles() {
    if (!files.at || Date.now() - files.at > CACHE_MS) {
      var v = "?v=" + Math.floor(Date.now() / CACHE_MS);
      files = { at: Date.now(),
        picks: getJSON("assets/picks.json" + v).then(function (d) { return d.picks || {}; }, function () { return {}; }) };
    }
    return files.picks;
  }
  function extras(list) {
    return sideFiles().then(function (picks) {
      return list.map(function (r) {
        var g = r.game;
        if (!g) return r;
        g.pick = picks[g.id] || picks[r.team.key + " " + dayET(g.date)] || "";
        g.graded = g.pick ? grade(g.pick, g) : "";
        return r;
      });
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
    var v = view;
    ({ tonight: rows, last: lastNight, guillotine: leagueRows })[v]().then(function (list) {
      if (v !== view) return;                                            // switched views while this loaded
      if (list.every(function (r) { return r.error; }) && last[v]) throw new Error("all failed");
      fails = 0; last[v] = list;
      render(list);
      if (v === "tonight") schedule(list);
      else if (list.wait) timer = setTimeout(refresh, list.wait);
    }).catch(function () {
      if (v !== view) return;
      fails++;
      if (!last[v]) {
        var msg = v === "guillotine" ? ["Bastille Day", "League unavailable", "Trying again shortly", "guillotine/"] : [v === "last" ? "Last night" : "Scoreboard", "Scores unavailable", "Trying again shortly"];
        render([{ note: msg }]);
      }
      timer = setTimeout(refresh, Math.min(60e3 * Math.pow(2, fails - 1), 600e3));
    });
  }

  // ---- Last night: our teams' games from yesterday's league scoreboards, then the big finals.
  function lastNight() {
    var ymd = yesterday();
    return Promise.all(TEAMS.map(function (team) {
      return board(team.path, ymd).then(function (events) {
        var ours = (events || []).map(function (ev) { return { ev: ev, g: game(team, ev) }; }).filter(function (x) { return x.g; })[0];
        if (!ours) return null;
        overlay(ours.g, (ours.ev.competitions || [])[0] || {}, ours.ev.status, team.path);
        return { team: team, game: ours.g };
      });
    })).then(function (list) {
      return extras(list.filter(Boolean));
    }).then(function (ours) {
      var ids = {};
      ours.forEach(function (r) { ids[r.game.id] = 1; });
      return bigGames(ids, ymd).then(function (big) { return big; }, function () { return []; }).then(function (big) {
        var out = ours.length ? ours : [{ note: ["Last night", "Our teams", "No games last night"] }];
        return out.concat(big);
      });
    });
  }

  // ---- Guillotine: the Bastille Day league, live. Most likely to be cut first.
  var leagueScripts = null;
  function loadLeagueScripts() {
    if (window.GuillotineSim && window.GuillotineLive) return Promise.resolve();
    if (!leagueScripts) leagueScripts = Promise.all(LEAGUE.scripts.map(function (f) {
      return new Promise(function (ok, fail) {
        var s = document.createElement("script");
        s.src = LEAGUE.dir + f; s.onload = ok;
        s.onerror = function () { leagueScripts = null; s.remove(); fail(new Error(f)); };
        document.head.appendChild(s);
      });
    }));
    return leagueScripts;
  }
  function leagueRows() {
    var fresh = "?v=" + Math.floor(Date.now() / 60e3);
    return loadLeagueScripts().then(function () {
      return Promise.all([getJSON(LEAGUE.dir + "data.json" + fresh), getJSON(LEAGUE.dir + "league.json" + fresh).catch(function () { return {}; })]);
    }).then(function (res) {
      var data = res[0];
      return window.GuillotineLive.get(data, (res[1] || {}).live_url).catch(function () { return null; }).then(function (live) {
        var d = window.GuillotineLive.apply(data, live);
        var sim = window.GuillotineSim.simulate(d, { runs: LEAGUE.runs });
        var byName = {};
        d.teams.forEach(function (t) { byName[t.name] = t; });
        var standing = sim.teams.slice().sort(function (a, b) { return b.now - a.now; }).map(function (t) { return t.name; });
        var top = sim.teams.reduce(function (a, b) { return b.pChop > a.pChop ? b : a; }, sim.teams[0] || {});
        var playing = 0, toPlay = 0;
        var tiles = sim.teams.slice().sort(function (a, b) { return b.pChop - a.pChop || a.now - b.now; }).map(function (t) {
          var on = window.GuillotineLive.startersOf(byName[t.name]).filter(function (p) { return p.live; }).length;
          playing += on; toPlay += t.nRem;
          return { league: true, t: t, rank: standing.indexOf(t.name) + 1, playing: on,
            mine: t.mine || t.name === LEAGUE.mine, block: t === top && t.pChop > 0 && sim.weeksLeft > 0 };
        });
        var head = { league: true, head: true, week: d.week, league_name: d.league || "Bastille Day", cut: sim.cut.median,
          alive: sim.teams.length, playing: playing, toPlay: toPlay, champ: sim.weeksLeft ? "" : (sim.teams[0] || {}).name };
        var out = [head].concat(tiles);
        out.note = playing ? playing + " playing" : "Week " + d.week;
        // Every minute while a league player's game is on; every 10 minutes when a game starts within 3 hours.
        var games = (live && live.games) || {}, soon = Object.keys(games).some(function (k) {
          var t = Date.parse(games[k].start) - Date.now();
          return games[k].state === "pre" && t < 3 * 3600e3 && t > -3600e3;
        });
        out.wait = d.live && d.live.inProgress ? 60e3 : soon ? 600e3 : null;
        return out;
      });
    });
  }
  function gItem(r) {
    var dot = ' <span aria-hidden="true">·</span> ';
    if (r.head) {
      var foot = r.playing ? r.playing + " players on the field" : r.toPlay ? r.toPlay + " starters still to play" : "All games final";
      var body = r.champ
        ? '<div class="tk-line tk-gline"><span class="tk-name">Champion</span><span class="tk-pts">' + esc(r.champ) + "</span></div>"
        : '<div class="tk-line tk-gline"><span class="tk-name">Cut line</span><span class="tk-pts">' + (r.cut != null ? "~" + Math.round(r.cut) : "–") + "</span></div>";
      return '<li class="tk-item tk-ghead"><a href="' + LEAGUE.dir + '" aria-label="' + esc(r.league_name + ", week " + r.week + ", cut line about " + Math.round(r.cut) + ". Full odds") + '">'
        + '<div class="tk-top"><span class="tk-tag">' + esc(r.league_name) + '</span><span class="tk-status">Week ' + esc(r.week) + "</span></div>"
        + body + '<div class="tk-foot">' + esc(r.alive + " alive") + dot + esc(foot) + "</div></a></li>";
    }
    var t = r.t, p = t.pChop;
    var odds = t.done && p > 0.995 ? "Cut" : p < 0.005 ? "Safe" : Math.max(1, Math.round(p * 100)) + "% cut";
    var left = t.nRem - r.playing;
    var status = r.playing ? '<span class="tk-live"><span class="tk-dot" aria-hidden="true"></span>' + r.playing + " on</span>" + (left > 0 ? ", " + left + " to go" : "")
      : t.done ? "Final" : t.nRem + " to play";
    var inner = '<div class="tk-top"><span class="tk-tag">' + (r.block ? "On the block" : "#" + r.rank + (r.mine ? " · Mine" : "")) + "</span>"
      + '<span class="tk-status tk-chop">' + odds + "</span></div>"
      + '<div class="tk-line tk-gline' + (r.mine ? " tk-us" : "") + '"><span class="tk-name">' + esc(t.name) + '</span><span class="tk-pts">' + t.locked.toFixed(1) + "</span></div>"
      + '<div class="tk-foot">' + status + (t.done ? "" : dot + "Proj " + t.now.toFixed(1)) + "</div>";
    var label = t.name + ", " + t.locked.toFixed(1) + " points" + (t.done ? ", final" : ", projected " + t.now.toFixed(1)) + ", " + (odds === "Safe" ? "safe" : odds === "Cut" ? "cut" : odds.replace("cut", "chance of being cut"));
    var cls = "tk-item tk-g" + (r.block ? " tk-block" : "") + (r.playing ? " tk-now" : "") + (r.mine ? " tk-mine" : "");
    return '<li class="' + cls + '"><a href="' + LEAGUE.dir + '" aria-label="' + esc(label) + '">' + inner + "</a></li>";
  }

  // ---- The view switch
  function setView(v, remember) {
    if (VIEWS.indexOf(v) < 0) v = "tonight";
    view = v; fails = 0;
    clearTimeout(timer);
    bar.setAttribute("data-show", v);
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === v)); });
    if (remember) try { localStorage.setItem(VIEW_KEY, v); } catch (e) { /* private window: just this visit */ }
    viewport.scrollLeft = 0;
    if (last[v]) render(last[v]);
    else if (v !== "tonight") { bar.hidden = false; list.innerHTML = noteItem(v === "last" ? "Last night" : "Bastille Day", "Loading…", "\u00a0"); note.textContent = ""; }
    refresh();
  }
  buttons.forEach(function (b) {
    b.addEventListener("click", function () { resumeAt = Date.now() + 15e3; setView(b.getAttribute("data-view"), true); });
  });
  function start() {
    var asked = (/[?&]ticker=(\w+)/.exec(location.search) || [])[1], saved = null;
    try { saved = localStorage.getItem(VIEW_KEY); } catch (e) { /* no storage */ }
    if (VIEWS.indexOf(asked) >= 0) return setView(asked, true);
    if (VIEWS.indexOf(saved) >= 0) return setView(saved, false);
    // No choice yet: the league while NFL games are on, otherwise tonight's games.
    board("football/nfl", dayET(Date.now()).replace(/-/g, "")).then(function (events) {
      var on = (events || []).some(function (ev) { return ((ev.status || {}).type || {}).state === "in"; });
      setView(on ? "guillotine" : "tonight", false);
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

  start();
})();
