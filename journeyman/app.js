/* Journeyman: screens, the guess box and saved progress. Players are in data.js; the scoring, daily ten and
   name matching come from Guess the Pick's engine (../guess-the-pick/engine.js), shared on purpose.
   Saved on this device (localStorage):
     jm-sport                    the last sport picked
     jm-daily2-SPORT-YYYY-MM-DD  today's daily ten so far, so a refresh picks up where you left off
     jm-best-SPORT               best endless score
     gtp-name, gtp-device        the board name and device id, shared with Guess the Pick */
(function () {
  var DATA = window.JM_DATA, G = window.GTP;
  if (!DATA || !G) return;
  var $ = function (id) { return document.getElementById(id); };
  var LEAGUE = { nba: "NBA", nfl: "NFL", mlb: "MLB" };
  var SPORTS = ["nba", "nfl", "mlb"];
  var tier = function (s) { return s >= 4 ? 3 : s >= 2 ? 2 : s >= 1 ? 1 : 0; };
  var SQUARE = ["⬛", "🟧", "🟨", "🟩"];
  var square = function (s) { return SQUARE[tier(s)]; };
  var VERDICT = ["Missed it", "Just made it", "Got there", "Got it", "Got it", "Nailed it"];
  // The hint menu: three from the player's own facts (h[0..2], labels vary by sport), his career line and initials
  var HINTS = [
    { id: "h0", cost: 1, label: function (p) { return p.h[0][0]; }, text: function (p) { return p.h[0][1]; } },
    { id: "h1", cost: 1, label: function (p) { return p.h[1][0]; }, text: function (p) { return p.h[1][1]; } },
    { id: "h2", cost: 1, label: function (p) { return p.h[2][0]; }, text: function (p) { return p.h[2][1]; } },
    { id: "line", cost: 1, label: function () { return "Career"; }, text: function (p) { return p.line; } },
    { id: "init", cost: 2, label: function () { return "Initials"; }, text: function (p) { return initials(p.n); } }
  ];

  var store = {
    get: function (k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window: this visit only */ } }
  };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  };
  var initials = function (name) {
    return name.replace(/\b(Jr\.?|Sr\.?|II|III|IV)\b/g, "").trim().split(/\s+/).map(function (w) { return w.charAt(0).toUpperCase() + "."; }).join(" ");
  };
  function dark(hex) {
    var n = parseInt(String(hex).slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b < 70;
  }
  // A team in the path: [code, name as it was then, primary, accent, ESPN logo code]
  function team(k) { return DATA[sport + "_teams"][k]; }
  function badge(t) {
    return '<b style="background:' + t[2] + ";color:" + (dark(t[3]) ? "#FFFFFF" : t[3]) + '">' + esc(t[0]) + "</b>";
  }
  function logo(t) {
    if (!t[4]) return badge(t);
    var src = "https://a.espncdn.com/combiner/i?img=/i/teamlogos/" + sport + "/500-dark/" + t[4] + ".png&w=80&h=80";
    return '<img src="' + esc(src) + '" alt="" data-team="' + esc(JSON.stringify(t)) + '">';
  }
  document.addEventListener("error", function (e) {   // a logo that won't load gives way to a badge in the team's colors
    var img = e.target;
    if (img.tagName === "IMG" && img.closest(".logo")) {
      try { img.outerHTML = badge(JSON.parse(img.getAttribute("data-team"))); } catch (x) { img.remove(); }
    }
  }, true);
  // "2008-09" for one NBA season, "2003-2009" for a run of them; NFL and MLB stops are calendar years
  function years(s) {
    var a = s[1], b = s[2];
    if (a === b) return String(a);
    if (sport === "nba" && b - a === 1) return a + "-" + String(b).slice(2);
    return a + "-" + b;
  }

  // ---- The group board (tools/journeyman_supabase.sql), same Supabase project as Guess the Pick
  var SUPABASE_URL = "https://baxrczyufqbzrogftmyn.supabase.co";
  var SUPABASE_KEY = "sb_publishable_brDXGevzcoI7mBaPO7Plow_yaUy4gk4";
  function rpc(fn, body) {
    var headers = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
    var call = function (h) { return fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, { method: "POST", headers: h, body: JSON.stringify(body) }); };
    return call(headers).then(function (res) {
      return res.status === 401 ? call(Object.assign({ Authorization: "Bearer " + SUPABASE_KEY }, headers)) : res;
    }).then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.status === 204 ? null : res.json();
    });
  }
  function deviceId() {
    var id = store.get("gtp-device");
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
      store.set("gtp-device", id);
    }
    return id;
  }
  function weekStart(day) {
    var d = new Date(day + "T12:00:00Z"), back = (d.getUTCDay() + 6) % 7;
    return new Date(d - back * 864e5).toISOString().slice(0, 10);
  }

  var sport = store.get("jm-sport") || "nba";
  var asked = (/[?&]sport=(nba|nfl|mlb)/i.exec(location.search) || [])[1];
  if (asked) sport = asked.toLowerCase();
  if (SPORTS.indexOf(sport) < 0) sport = "nba";
  var picks, pool, mode, game, cur, today = G.dailyKey();

  function load(s) {
    sport = s; picks = DATA[s]; pool = G.pool(picks, (window.GTP_NAMES || {})[s]);
    store.set("jm-sport", s);
    document.querySelectorAll(".sport").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-sport") === s)); });
    homeStatus();
  }
  function dailyKey(s) { return "jm-daily2-" + (s || sport) + "-" + today; }   // "2": the smaller, better-known pool from Oct 28
  function homeStatus() {
    var d = store.get(dailyKey());
    var total = d ? d.results.reduce(function (a, r) { return a + r.s; }, 0) : 0;
    $("daily-status").textContent = !d || !d.results.length ? "New today"
      : d.results.length >= G.DAILY ? "Done today: " + total + "/" + G.DAILY * G.POINTS : "In progress: " + d.results.length + " of " + G.DAILY;
    var best = store.get("jm-best-" + sport);
    $("endless-status").textContent = best != null ? "Best run: " + best + " point" + (best === 1 ? "" : "s") : "No runs yet";
  }
  function show(id) {
    ["home", "play", "done"].forEach(function (s) { $(s).hidden = s !== id; });
    document.body.setAttribute("data-screen", id);
    window.scrollTo(0, 0);
  }

  // ---- Starting a game
  function startDaily() {
    mode = "daily";
    var saved = store.get(dailyKey());
    game = saved && saved.order ? saved : { order: G.daily(picks, "jm-" + sport), results: [] };
    store.set(dailyKey(), game);
    if (game.results.length >= G.DAILY) return finish();
    newPick(game.order[game.results.length], game.cur);
  }
  function startEndless() {
    mode = "endless";
    game = { results: [], seen: [], misses: 0 };
    newPick(G.endless(picks, game.seen));
  }

  // ---- One player
  function newPick(i, resume) {
    cur = resume && resume.i === i ? resume : { i: i, used: [], wrong: [], done: false };
    if (mode === "daily") { game.cur = cur; store.set(dailyKey(), game); }
    var p = picks[i];
    show("play");
    var card = $("card"); card.classList.remove("enter"); void card.offsetWidth; card.classList.add("enter");
    $("card-league").textContent = LEAGUE[sport];
    $("path-meta").textContent = p.s.length + " stops \u00B7 " + p.s[0][1] + "-" + p.s[p.s.length - 1][2];
    $("path").classList.toggle("tight", p.s.length > 8);
    $("path").innerHTML = p.s.map(function (s) {
      var t = team(s[0]);
      return '<li class="stop" style="--c1:' + t[2] + ";--c2:" + t[3] + '"><span class="logo">' + logo(t) + '</span><span class="tn">'
        + esc(t[1]) + '</span><span class="yr">' + years(s) + "</span></li>";
    }).join("");
    $("guess").value = ""; closeList();
    $("msg").textContent = ""; $("msg").className = "msg";
    $("reveal").hidden = true; $("guess-area").hidden = false;
    hud(); drawClues(); drawPoints();
    if (cur.done) return reveal(cur.gaveUp);
    if (window.matchMedia("(hover: hover)").matches) $("guess").focus();
  }
  function spent() {
    return cur.used.reduce(function (a, id) { return a + HINTS.filter(function (h) { return h.id === id; })[0].cost; }, 0);
  }
  function points() { return Math.max(0, G.POINTS - spent() - cur.wrong.length); }
  function drawPoints() {
    var n = points(), h = "";
    for (var k = 0; k < G.POINTS; k++) h += '<i class="' + (k < n ? "" : "used") + '"></i>';
    $("pts").innerHTML = h + "<span>" + n + " point" + (n === 1 ? "" : "s") + " on the table</span>";
    $("wrongs").innerHTML = cur.wrong.map(function (w) { return "<span>" + esc(w) + "</span>"; }).join("");
    var p = picks[cur.i];
    $("hints").innerHTML = HINTS.map(function (h) {
      var has = !!h.text(p), used = cur.used.indexOf(h.id) >= 0, afford = n - h.cost >= 1;
      var why = !has ? "n/a" : used ? "shown" : !afford ? "can't afford" : "−" + h.cost;
      return '<button type="button" class="tool hint" data-hint="' + h.id + '"' + (used || !has || !afford ? " disabled" : "")
        + (used ? ' aria-pressed="true"' : "") + ">" + esc(h.label(p)) + " <small>" + why + "</small></button>";
    }).join("");
  }
  function drawClues() {
    var p = picks[cur.i];
    $("clues").innerHTML = HINTS.filter(function (h) { return cur.used.indexOf(h.id) >= 0; }).map(function (h) {
      return '<div class="clue"><span>' + esc(h.label(p)) + "</span>" + esc(h.text(p)) + "</div>";
    }).join("");
  }
  function hud() {
    var total = game.results.reduce(function (a, r) { return a + r.s; }, 0);
    if (mode === "daily") {
      var n = game.results.length, track = "";
      for (var k = 0; k < G.DAILY; k++) track += '<i class="' + (k < n ? "s" + tier(game.results[k].s) : k === n ? "on" : "") + '"></i>';
      $("hud-mode").innerHTML = '<span class="track" aria-hidden="true">' + track + "</span>";
      $("hud-right").innerHTML = '<span class="score"><b>' + total + "</b> / " + G.DAILY * G.POINTS + "</span>";
      $("card-count").textContent = (n + 1) + " of " + G.DAILY;
    } else {
      var lives = "";
      for (var j = 0; j < G.LIVES; j++) lives += '<i class="' + (j < G.LIVES - game.misses ? "" : "gone") + '"></i>';
      $("hud-mode").innerHTML = '<span class="lives" aria-label="' + (G.LIVES - game.misses) + ' misses left">' + lives + "</span>";
      $("hud-right").innerHTML = '<span class="score"><b>' + total + "</b> points</span>";
      $("card-count").textContent = "Player " + (game.results.length + 1);
    }
  }

  function guess(text) {
    if (cur.done) return;
    closeList();
    var p = picks[cur.i], verdict = G.judge(text, p, pool);
    var msg = $("msg");
    if (verdict === "ambiguous") {
      msg.className = "msg"; msg.textContent = "A few players go by " + text.trim() + ". Type the full name.";
      return;
    }
    if (verdict === "unknown") {
      msg.className = "msg"; msg.textContent = text.trim() ? "No player by that name. Check the spelling or pick a suggestion." : "";
      return;
    }
    if (verdict === "right") return finishPick(points(), false);
    var shown = (pool.byKey[G.norm(text)] || {}).n || text.trim();
    if (cur.wrong.some(function (w) { return G.norm(w) === G.norm(shown); })) {
      msg.className = "msg"; msg.textContent = "Already tried " + shown + ".";
      return;
    }
    cur.wrong.push(shown);
    $("guess").value = "";
    save();
    if (points() === 0) return finishPick(0, false);
    msg.className = "msg bad"; msg.textContent = "Not " + shown + ".";
    drawPoints();
  }
  function hint(id) {
    var h = HINTS.filter(function (x) { return x.id === id; })[0];
    if (!h || cur.done || cur.used.indexOf(id) >= 0 || !h.text(picks[cur.i]) || points() - h.cost < 1) return;
    cur.used.push(id);
    save(); drawClues(); drawPoints();
    if (window.matchMedia("(hover: hover)").matches) input.focus();
  }
  function finishPick(s, gaveUp) {
    cur.done = true; cur.s = s; cur.gaveUp = gaveUp;
    game.results.push({ i: cur.i, s: s });
    if (mode === "endless") { game.seen.push(cur.i); if (!s) game.misses++; }
    save(); hud(); reveal(gaveUp);
  }
  function reveal(gaveUp) {
    var p = picks[cur.i], s = cur.s || 0;
    $("guess-area").hidden = true; $("reveal").hidden = false;
    $("verdict").className = "verdict v" + tier(s);
    $("verdict").textContent = (gaveUp ? "Here's who it was" : VERDICT[s]) + (s ? " · +" + s : "");
    $("answer").textContent = p.n;
    $("facts").innerHTML = "<b>" + esc(p.h.map(function (h) { return h[1]; }).filter(Boolean).join(" · ")) + "</b><br>"
      + esc(p.line) + ". " + p.s.length + " stops with " + p.fr + " different franchises.";
    var last = mode === "daily" ? game.results.length >= G.DAILY : game.misses >= G.LIVES;
    $("next").textContent = last ? "See how you did" : "Next player";
    $("next").focus({ preventScroll: true });
  }
  function save() {
    if (mode === "daily") { game.cur = cur; store.set(dailyKey(), game); }
  }
  function next() {
    if (mode === "daily") {
      game.cur = null; store.set(dailyKey(), game);
      if (game.results.length >= G.DAILY) return finish();
      return newPick(game.order[game.results.length]);
    }
    if (game.misses >= G.LIVES) return finish();
    newPick(G.endless(picks, game.seen));
  }

  // ---- Results
  function finish() {
    show("done");
    var total = game.results.reduce(function (a, r) { return a + r.s; }, 0);
    var squares = game.results.map(function (r) { return square(r.s); }).join("");
    if (mode === "daily") {
      $("done-title").textContent = LEAGUE[sport] + " daily · " + niceDate();
      $("done-score").innerHTML = total + "<small>/" + G.DAILY * G.POINTS + "</small>";
      $("done-grade").textContent = total >= 45 ? "You could run a front office." : total >= 35 ? "You read the transaction wire." : total >= 24 ? "You know your waiver claims." : total >= 12 ? "A few too many stops for you." : "Designated for assignment.";
      var other = SPORTS.filter(function (s) { return s !== sport && (store.get(dailyKey(s)) || { results: [] }).results.length < G.DAILY; })[0];
      $("again").textContent = other ? "Play the " + LEAGUE[other] + " daily" : "Play endless";
      $("again").onclick = function () { if (other) { load(other); startDaily(); } else startEndless(); };
      tick();
      $("board").hidden = false;
      boardSquares = game.results.map(function (r) { return r.s; }).join("");
      var name = store.get("gtp-name");
      if (name && game.posted !== name) postScore(name); else loadBoard();
    } else {
      var prev = store.get("jm-best-" + sport), best = prev || 0, isBest = prev == null || total > best;
      if (isBest) store.set("jm-best-" + sport, total);
      $("done-title").textContent = LEAGUE[sport] + " endless";
      $("done-score").innerHTML = total + "<small> pts</small>";
      $("done-grade").textContent = (prev == null ? "First run in the books. " : isBest ? "New best! " : "Best: " + best + ". ") + game.results.length + " players, three strikes.";
      $("again").textContent = "Run it back";
      $("again").onclick = startEndless;
      $("countdown").textContent = "";
      $("board").hidden = true;
    }
    $("done-squares").textContent = squares.length > 40 ? squares.slice(-40 * 2) : squares;
    $("recap").innerHTML = game.results.map(function (r, k) {
      var p = picks[r.i];
      return '<li><i class="s' + tier(r.s) + '"></i><div><b>' + esc(p.n) + "</b><br><span>" + p.s.length + " stops, "
        + p.s[0][1] + "-" + p.s[p.s.length - 1][2] + '</span><span class="hit" data-k="' + k + '"></span></div><span>+' + r.s + "</span></li>";
    }).join("");
    $("share").onclick = function () { share(total, squares); };
    hits = null;
    homeStatus();
  }
  var boardSquares = "", boardTab = "today", boardRows = [], hits = null;
  function postScore(name) {
    $("board-note").textContent = "Posting…";
    rpc("jm_post", { p_day: today, p_sport: sport, p_device: deviceId(), p_player: name, p_squares: boardSquares }).then(function () {
      store.set("gtp-name", name);
      game.posted = name; store.set(dailyKey(), game);
      loadBoard();
    }, function () { $("board-note").textContent = "Couldn't post right now. Try again in a minute."; drawBoard(); });
  }
  function loadBoard() {
    var day = today;
    $("board-note").textContent = "Loading the board…";
    rpc("jm_board", { p_sport: sport, p_from: weekStart(today), p_to: day }).then(function (rows) {
      if (day !== today) return;
      boardRows = rows || [];
      $("board-note").textContent = "";
      drawBoard();
    }, function () { $("board-note").textContent = "The board isn't loading right now."; drawBoard(); });
  }
  function todays() {
    var by = {}, names = {};
    boardRows.forEach(function (r) { if (r.day === today) by[r.device] = r; });
    return Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; })
      .filter(function (r) { var n = r.player.toLowerCase(); if (names[n]) return false; names[n] = true; return true; });
  }
  function drawBoard() {
    var name = store.get("gtp-name"), me = (name || "").toLowerCase();
    $("board-form").hidden = !!(name && game.posted === name);
    $("board-me").hidden = !(name && game.posted === name);
    if (name) { $("board-name").value = name; $("board-me-name").textContent = name; }
    document.querySelectorAll("#board .tabs button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-tab") === boardTab)); });
    var html = "";
    if (boardTab === "today") {
      var rows = todays().sort(function (a, b) { return b.score - a.score || (a.created_at < b.created_at ? -1 : 1); });
      html = rows.map(function (r, k) {
        var sq = r.squares.split("").map(function (c) { return square(+c); }).join("");
        return '<li class="' + (r.player.toLowerCase() === me ? "me" : "") + '"><b class="rk">' + (k + 1) + '</b><span class="nm">' + esc(r.player)
          + '</span><span class="sq" aria-hidden="true">' + sq + '</span><b class="pt">' + r.score + "</b></li>";
      }).join("");
      if (!rows.length && !$("board-note").textContent) html = '<li class="empty">Nobody on the board yet today. Be first.</li>';
      hits = rows.length ? boardSquares.split("").map(function (c, k) { return rows.filter(function (r) { return r.squares.charAt(k) !== "0"; }).length; }) : null;
      drawHits(rows.length);
    } else {
      var seen = {}, tot = {};
      boardRows.slice().reverse().forEach(function (r) {
        var key = r.day + "|" + r.device;
        if (seen[key]) return; seen[key] = true;
        var who = r.player.toLowerCase(), dayKey = who + "|" + r.day;
        if (seen[dayKey]) return; seen[dayKey] = true;
        tot[who] = tot[who] || { player: r.player, score: 0, days: 0 };
        tot[who].score += r.score; tot[who].days++;
      });
      var week = Object.keys(tot).map(function (k) { return tot[k]; }).sort(function (a, b) { return b.score - a.score || b.days - a.days; });
      html = week.map(function (r, k) {
        return '<li class="' + (r.player.toLowerCase() === me ? "me" : "") + '"><b class="rk">' + (k + 1) + '</b><span class="nm">' + esc(r.player)
          + '</span><span class="sq">' + r.days + " day" + (r.days === 1 ? "" : "s") + '</span><b class="pt">' + r.score + "</b></li>";
      }).join("");
      if (!week.length && !$("board-note").textContent) html = '<li class="empty">No scores yet this week.</li>';
    }
    $("board-list").innerHTML = html;
  }
  function drawHits(n) {
    document.querySelectorAll("#recap .hit").forEach(function (el) {
      var k = +el.getAttribute("data-k");
      el.textContent = hits && n > 1 ? " · " + hits[k] + " of " + n + " got it" : "";
    });
  }
  $("board-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("board-name").value.replace(/\s+/g, " ").trim().slice(0, 24);
    if (name) postScore(name);
  });
  $("board-change").addEventListener("click", function () {
    $("board-form").hidden = false; $("board-me").hidden = true;
    $("board-name").focus(); $("board-name").select();
  });
  document.querySelectorAll("#board .tabs button").forEach(function (b) {
    b.addEventListener("click", function () { boardTab = b.getAttribute("data-tab"); drawBoard(); });
  });

  function niceDate() {
    return new Date(today + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }
  var clock = null;
  function tick() {
    clearInterval(clock);
    var draw = function () {
      var et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      var left = (24 * 3600) - (et.getHours() * 3600 + et.getMinutes() * 60 + et.getSeconds());
      $("countdown").textContent = "Next daily in " + Math.floor(left / 3600) + "h " + Math.floor(left % 3600 / 60) + "m (midnight, Boston time)";
      if (G.dailyKey() !== today) { today = G.dailyKey(); homeStatus(); }
    };
    draw(); clock = setInterval(draw, 30e3);
  }
  function share(total, squares) {
    var text = mode === "daily"
      ? "Journeyman · " + LEAGUE[sport] + " daily · " + niceDate() + "\n" + squares + " " + total + "/" + G.DAILY * G.POINTS
      : "Journeyman · " + LEAGUE[sport] + " endless\n" + total + " points over " + game.results.length + " players";
    text += "\nhttps://davidsolar.dev/journeyman/";
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      navigator.share({ text: text }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () { toast("Copied. Paste it in the group chat."); }, function () { toast(text); });
    } else toast(text);
  }
  var toastTimer = null;
  function toast(t) {
    var el = $("toast"); el.textContent = t; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  // ---- The guess box
  var input = $("guess"), list = $("suggestions"), active = -1, options = [];
  function closeList() { list.hidden = true; list.innerHTML = ""; options = []; active = -1; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); }
  function drawList() {
    options = G.suggest(input.value, pool, 6);
    if (!options.length) return closeList();
    var words = G.norm(input.value).split(" ").filter(Boolean);
    list.innerHTML = options.map(function (n, k) {
      var label = n.split(" ").map(function (w) {
        var nw = G.norm(w), hit = words.filter(function (q) { return nw.indexOf(q) === 0; })[0];
        return hit ? "<mark>" + esc(w.slice(0, hit.length)) + "</mark>" + esc(w.slice(hit.length)) : esc(w);
      }).join(" ");
      return '<li role="option" id="opt-' + k + '" aria-selected="' + (k === active) + '" data-k="' + k + '">' + label + "</li>";
    }).join("");
    list.hidden = false; input.setAttribute("aria-expanded", "true");
    if (active >= 0) input.setAttribute("aria-activedescendant", "opt-" + active); else input.removeAttribute("aria-activedescendant");
  }
  input.addEventListener("input", function () { active = -1; drawList(); if ($("msg").className === "msg") $("msg").textContent = ""; });
  input.addEventListener("keydown", function (e) {
    if (list.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      drawList();
    } else if (e.key === "Escape") closeList();
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); var n = options[active]; input.value = n; guess(n); }
  });
  input.addEventListener("blur", function () { setTimeout(function () { if (document.activeElement !== input) closeList(); }, 120); });
  list.addEventListener("mousedown", function (e) { e.preventDefault(); });
  list.addEventListener("click", function (e) {
    var li = e.target.closest("li"); if (!li) return;
    var n = options[+li.getAttribute("data-k")]; input.value = n; guess(n);
  });
  $("guess-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var v = input.value, first = G.judge(v, picks[cur.i], pool);
    if (options.length === 1 && (first === "unknown" || first === "ambiguous")) v = options[0];
    guess(v);
  });

  // ---- Buttons
  document.querySelectorAll(".sport").forEach(function (b) { b.addEventListener("click", function () { load(b.getAttribute("data-sport")); }); });
  $("start-daily").addEventListener("click", startDaily);
  $("start-endless").addEventListener("click", startEndless);
  $("hints").addEventListener("click", function (e) { var b = e.target.closest("button[data-hint]"); if (b) hint(b.getAttribute("data-hint")); });
  $("give-up").addEventListener("click", function () { if (!cur.done) finishPick(0, true); });
  $("next").addEventListener("click", next);
  $("back").addEventListener("click", function () { clearInterval(clock); homeStatus(); show("home"); });
  $("menu").addEventListener("click", function () { clearInterval(clock); homeStatus(); show("home"); });

  load(sport);
})();
