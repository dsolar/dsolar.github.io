/* Scouting Report: screens, the guess box and saved progress. The prospects and their real pre-draft quotes are in data.js
   (built by tools/scouting_report_build.py). Name matching, the Boston date and seeded random numbers come from
   Guess the Pick's engine, and the guess box knows every player in Guess the Pick's names.js, so a suggestion
   never gives the answer away.
   Saved on this device (localStorage):
     sr-daily-YYYY-MM-DD   today's five so far
     sr-best               best endless run
     sr-seen               the last 120 files seen in endless, so it doesn't repeat itself
     gtp-name, gtp-device  the board name and device id, shared with the other games */
(function () {
  var G = window.GTP, DATA = window.SR_DATA;
  if (!G || !DATA) return;
  var $ = function (id) { return document.getElementById(id); };
  var POINTS = 5, DAILY = 5, LIVES = 3, LEAGUE = { nfl: "NFL", nba: "NBA" };
  var store = {
    get: function (k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window: this visit only */ } }
  };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function toast(t) { var el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, 2600); }
  var tier = function (s) { return s >= 4 ? 3 : s >= 2 ? 2 : s >= 1 ? 1 : 0; };
  var SQUARE = ["⬛", "🟧", "🟨", "🟩"];

  // The guess box knows every name in the league, not just the prospects
  var pools = {};
  function pool(lg) {
    if (!pools[lg]) pools[lg] = G.pool(DATA.filter(function (p) { return p.lg === lg; }).map(function (p) { return { n: p.n, f: 0 }; }), (window.GTP_NAMES || {})[lg]);
    return pools[lg];
  }

  // The clues, in the order they sit on the file
  var CLUES = [
    { id: "pos", label: "Position", text: function (p) { return p.pos; } },
    { id: "cls", label: "Draft class", text: function (p) { return String(p.y); } },
    { id: "col", label: "School", text: function (p) { return p.col; } },
    { id: "size", label: "Size", text: function (p) { return p.size; } }
  ];

  // ---- Today's five: walk the whole list in a seeded order, so nobody repeats until everyone's been used
  var today = G.dailyKey();
  function dayIndex(d) { return Math.round((Date.parse(d + "T12:00:00Z") - Date.parse("2026-10-30T12:00:00Z")) / 864e5); }
  var perms = {};
  function perm(cycle) {
    if (perms[cycle]) return perms[cycle];
    var rand = G.seeded("scouting-report|" + cycle), a = DATA.map(function (_, i) { return i; });
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return (perms[cycle] = a);
  }
  function dailyFive(day) {
    var n = DATA.length, out = [], k = (((dayIndex(day) * DAILY) % (n * 1000)) + n * 1000) % (n * 1000);
    for (var j = 0; out.length < DAILY && j < DAILY * 3; j++) {
      var at = k + j, i = perm(Math.floor(at / n))[at % n];
      if (out.indexOf(i) < 0) out.push(i);
    }
    return out;
  }

  // ---- State
  var mode, game, cur, sugg = [], hi = -1;
  function dkey() { return "sr-daily-" + today; }
  function show(id) { ["home", "play", "done"].forEach(function (s) { $(s).hidden = s !== id; }); document.body.setAttribute("data-screen", id); window.scrollTo(0, 0); }
  function total() { return game.results.reduce(function (a, r) { return a + r.s; }, 0); }
  function homeStatus() {
    today = G.dailyKey();
    var d = restore(store.get(dkey()));
    $("daily-status").textContent = !d || !d.results.length ? "New today" : d.results.length >= DAILY ? "Done today: " + d.results.reduce(function (a, r) { return a + r.s; }, 0) + "/25" : "In progress: " + d.results.length + " of 5";
    var b = store.get("sr-best");
    $("endless-status").textContent = b != null ? "Best run: " + b + " point" + (b === 1 ? "" : "s") : "No runs yet";
  }

  // A saved daily is kept by prospect id, so it still opens after the folder changes. One saved by an older
  // version of the folder (positions, not ids) or naming a prospect who's gone starts today's five fresh.
  var AT = {};
  DATA.forEach(function (p, i) { AT[p.id] = i; });
  function restore(saved) {
    if (!saved || !Array.isArray(saved.ids) || !saved.ids.every(function (id) { return id in AT; })) return null;
    saved.order = saved.ids.map(function (id) { return AT[id]; });
    saved.results = (saved.results || []).filter(function (r) { return r.id in AT; }).map(function (r) { return { i: AT[r.id], id: r.id, s: r.s }; });
    return saved;
  }
  function startDaily() {
    today = G.dailyKey(); mode = "daily";
    game = restore(store.get(dkey()));
    if (!game) {
      var order = dailyFive(today);
      game = { order: order, ids: order.map(function (i) { return DATA[i].id; }), results: [] };
    }
    if (game.results.length >= DAILY) return finish();
    show("play"); next();
  }
  function startEndless() {
    mode = "endless";
    var seen = store.get("sr-seen") || [], rand = Math.random, order = DATA.map(function (_, i) { return i; })
      .filter(function (i) { return seen.indexOf(DATA[i].id) < 0; });
    if (order.length < 20) order = DATA.map(function (_, i) { return i; });
    for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)), t = order[i]; order[i] = order[j]; order[j] = t; }
    game = { order: order, results: [], misses: 0 };
    show("play"); next();
  }
  function next() {
    var n = game.results.length;
    if (mode === "daily" && n >= DAILY) return finish();
    if (mode === "endless" && (game.misses >= LIVES || n >= game.order.length)) return finish();
    if (!DATA[game.order[n]]) { store.set(dkey(), null); return mode === "daily" ? startDaily() : startEndless(); }
    cur = { i: game.order[n], used: [], wrong: [], done: false };
    drawFile(); hud();
    $("ask").hidden = false; $("went").hidden = true; $("note").textContent = "";
    $("guess").value = ""; showSugg("");
    $("guess").focus({ preventScroll: true });
  }
  function points() { return Math.max(0, POINTS - cur.used.length - cur.wrong.length); }
  function hud() {
    var n = game.results.length, at = n + (cur && !cur.done ? 1 : 0);
    if (mode === "daily") {
      var t = "";
      for (var k = 0; k < DAILY; k++) t += '<i class="' + (k < n ? "s" + tier(game.results[k].s) : k === n ? "on" : "") + '"></i>';
      $("hud-left").innerHTML = '<span class="track" aria-label="File ' + Math.min(at || 1, DAILY) + ' of 5">' + t + "</span>";
      $("hud-right").innerHTML = "<b>" + total() + "</b> / 25 · <button type=\"button\" class=\"quit\" id=\"quit\">Quit</button>";
    } else {
      var l = "";
      for (var j = 0; j < LIVES; j++) l += '<i class="' + (j < LIVES - game.misses ? "" : "gone") + '"></i>';
      $("hud-left").innerHTML = "File " + Math.max(1, at) + ' <span class="lives" aria-label="' + (LIVES - game.misses) + ' lives left">' + l + "</span>";
      $("hud-right").innerHTML = "<b>" + total() + "</b> points · <button type=\"button\" class=\"quit\" id=\"quit\">Quit</button>";
    }
    $("quit").onclick = function () { if (mode === "endless" && game.results.length) finish(); else { homeStatus(); show("home"); } };
    var pips = "";
    for (var q = 0; q < POINTS; q++) pips += '<i class="' + (q < points() ? "" : "used") + '"></i>';
    $("pips").innerHTML = pips + "<span>" + points() + " point" + (points() === 1 ? "" : "s") + " on the table</span>";
  }

  function drawFile() {
    var p = DATA[cur.i], open = cur.done;
    $("folder").setAttribute("data-tab", "Prospect file · " + LEAGUE[p.lg]);
    $("file-lg").textContent = LEAGUE[p.lg];
    $("file-no").textContent = "file no. " + String(1000 + (p.id.length * 37 + p.y) % 9000);
    $("quote").textContent = p.q + "\u201D";
    // Who said it shows from the start; when (which gives away the class) waits for the bar or the reveal
    var when = open || cur.used.indexOf("cls") >= 0 ? p.when : "";
    // An outlet with no named writer (DraftExpress, NFL.com's profiles) shows once, not twice
    var outlet = p.who.indexOf(p.outlet) === 0 ? "" : p.outlet;
    $("cite").innerHTML = esc(p.who) + "<small>" + esc([outlet, when].filter(Boolean).join(", ")) + "</small>";
    var html = "<dt>Name</dt><dd>" + (open ? '<span class="shown">' + esc(p.n) + "</span>" : '<span class="name-bar" aria-label="Hidden"></span>') + "</dd>";
    CLUES.forEach(function (c) {
      var shown = open || cur.used.indexOf(c.id) >= 0, text = c.text(p) || "Unknown";
      html += "<dt>" + c.label + "</dt><dd>" + (shown ? '<span class="shown">' + esc(text) + "</span>"
        : '<button type="button" class="redact" data-clue="' + c.id + '"' + (points() <= 1 ? " disabled" : "") + ">Lift for 1 point</button>") + "</dd>";
    });
    html += "<dt>Drafted</dt><dd>" + (open ? '<span class="shown">' + esc(drafted(p)) + "</span>" : '<span class="name-bar" style="width:min(11rem,50%)"></span>') + "</dd>";
    $("fields").innerHTML = html;
    $("stamp").innerHTML = open ? '<div class="stamp ' + (p.right ? "right" : "wrong") + '">' + (p.right ? "Nailed it" : "Whiffed") + "<small>" + kindLine(p) + "</small></div>" : "";
  }
  function drafted(p) { return p.y + ", " + (p.lg === "nfl" ? "round " + p.rd + ", " : "") + "pick " + p.pk + " by the " + p.tm; }
  function kindLine(p) { return p.kind === "steal" ? "He was a steal" : p.kind === "bust" ? "He was a bust" : p.angle === "glow" ? "Star, as advertised" : "He was a star"; }

  // ---- Guessing
  function showSugg(text) {
    var p = DATA[cur.i];
    sugg = text.trim().length >= 2 ? G.suggest(text, pool(p.lg), 6) : []; hi = -1;
    $("sugg").innerHTML = sugg.map(function (n, k) { return '<li><button type="button" role="option" data-k="' + k + '">' + esc(n) + "</button></li>"; }).join("");
  }
  function guess(text) {
    if (!cur || cur.done) return;
    var p = DATA[cur.i], r = G.judge(text, p, pool(p.lg)), note = $("note");
    if (r === "right") return reveal(false);
    if (r === "unknown") { note.textContent = text.trim() ? "No player by that name. Pick one from the list." : ""; return; }
    if (r === "ambiguous") { note.textContent = "More than one player by that name. Use his full name."; return; }
    var k = G.norm(text);
    if (cur.wrong.indexOf(k) >= 0) { note.textContent = "Already tried him."; return; }
    cur.wrong.push(k);
    if (!points()) return reveal(true);
    note.textContent = "Not him. " + points() + " point" + (points() === 1 ? "" : "s") + " left.";
    $("guess").select(); hud(); drawFile();
  }
  function lift(id) {
    if (cur.done || cur.used.indexOf(id) >= 0 || points() <= 1) return;
    cur.used.push(id); hud(); drawFile();
  }
  function reveal(gaveUp) {
    var p = DATA[cur.i], s = gaveUp ? 0 : points();
    cur.done = true;
    game.results.push({ i: cur.i, id: p.id, s: s });
    if (mode === "endless") {
      if (!s) game.misses++;
      var seen = store.get("sr-seen") || []; seen.push(p.id); store.set("sr-seen", seen.slice(-120));
    } else store.set(dkey(), game);
    $("ask").hidden = true;
    drawFile(); hud();
    var hon = p.hon && p.hon.length ? p.hon.join(", ") : "None";
    var w = $("went"), c1 = p.tc ? p.tc[0] : "#333", c2 = p.tc ? p.tc[1] : "#999";
    w.hidden = false;
    w.innerHTML = '<article class="card"><div class="card-band' + (light(c1) ? " light" : "") + '" style="--t1:' + esc(c1) + ";--t2:" + esc(c2) + '">'
      + esc(p.y + " draft" + (p.lg === "nfl" ? ", round " + p.rd : "") + ", pick " + p.pk) + "<b>" + esc(p.tm) + "</b></div>"
      + '<div class="card-body"><h3>' + esc(p.n) + "</h3>"
      + '<dl class="facts"><div><dt>Games</dt><dd>' + p.g.toLocaleString() + "</dd></div><div><dt>Career</dt><dd>" + esc(p.stat) + "</dd></div><div><dt>Honors</dt><dd>" + esc(hon) + "</dd></div></dl>"
      + (p.ctx ? '<p class="ctx">' + esc(p.ctx) + "</p>" : "")
      + '<div class="foot"><span class="pts">' + (s ? "+" + s : "0") + " point" + (s === 1 ? "" : "s") + '</span><span class="src">Quote: <a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.who) + (p.who.indexOf(p.outlet) === 0 ? "" : ", " + esc(p.outlet)) + "</a></span></div>"
      + '</div></article><div class="next-row"><button class="btn" type="button" id="next">' + (lastOne() ? "See how you did" : "Next file") + "</button></div>";
    $("next").onclick = next;
    $("next").focus({ preventScroll: true });
    w.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function light(hex) {
    var h = String(hex || "").replace("#", ""); if (h.length < 6) return false;
    return 0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16) > 170;
  }
  function lastOne() { return mode === "daily" ? game.results.length >= DAILY : game.misses >= LIVES; }
  // ---- Finished
  function finish() {
    show("done");
    var t = total(), max = game.results.length * POINTS;
    if (mode === "daily") {
      $("done-score").innerHTML = t + "<small> / 25</small>";
      $("done-grade").textContent = t >= 22 ? "Front-office material. You'd have drafted Brady in round one." : t >= 16 ? "A real eye for talent." : t >= 10 ? "Area scout. Long drives, cold coffee." : t >= 5 ? "You'd have taken the guy with the great pro day." : "You are the reason these reports exist.";
      $("again").textContent = "Play endless";
      $("board").hidden = false;
      var name = store.get("gtp-name");
      if (name) $("board-name").value = name;
      if (name && !game.posted) postScore(name); else loadBoard();
    } else {
      var prev = store.get("sr-best"), best = prev == null || t > prev;
      if (best) store.set("sr-best", t);
      $("done-score").innerHTML = t + "<small> points</small>";
      $("done-grade").textContent = game.results.length + " files" + (best && t ? ". A new best." : prev != null ? ". Best: " + prev + "." : ".");
      $("again").textContent = "Run it back";
      $("board").hidden = true;
    }
    $("recap").innerHTML = game.results.map(function (r) {
      var p = DATA[r.i];
      return '<li><i style="background:' + ["#6B2A2A", "#E08A3C", "#C9A227", "#3F9D62"][tier(r.s)] + '"></i><span><b>' + esc(p.n) + "</b> · " + LEAGUE[p.lg] + " " + p.y + ", pick " + p.pk + '</span><span class="tag ' + (p.right ? "right" : "wrong") + '">' + (p.right ? "Nailed it" : "Whiffed") + "</span></li>";
    }).join("") || '<li class="muted">No files yet.</li>';
    $("share").hidden = mode !== "daily";
  }
  function shareText() {
    var sq = game.results.map(function (r) { return SQUARE[tier(r.s)]; }).join("");
    var date = new Date(today + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return "Scouting Report · " + date + "\n" + sq + " " + total() + "/25\nhttps://davidsolar.dev/scouting-report/";
  }

  // ---- The group board (Supabase, tools/scouting_report_supabase.sql)
  var SUPABASE_URL = "https://baxrczyufqbzrogftmyn.supabase.co", SUPABASE_KEY = "sb_publishable_brDXGevzcoI7mBaPO7Plow_yaUy4gk4";
  function rpc(fn, body) {
    var headers = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
    var call = function (h) { return fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, { method: "POST", headers: h, body: JSON.stringify(body) }); };
    return call(headers).then(function (res) { return res.status === 401 ? call(Object.assign({ Authorization: "Bearer " + SUPABASE_KEY }, headers)) : res; })
      .then(function (res) { if (!res.ok) throw new Error(res.status); return res.status === 204 ? null : res.json(); });
  }
  function deviceId() {
    var id = store.get("gtp-device");
    if (!id) { id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now(); store.set("gtp-device", id); }
    return id;
  }
  function postScore(name) {
    var day = today, g = game;
    $("board-note").textContent = "Posting…";
    rpc("sr_post", { p_day: day, p_device: deviceId(), p_player: name, p_squares: g.results.map(function (r) { return r.s; }).join("") }).then(function () {
      store.set("gtp-name", name); g.posted = name; store.set("sr-daily-" + day, g);
      loadBoard();
    }, function () { $("board-note").textContent = "Couldn't post right now. Try again in a minute."; drawBoard([]); });
  }
  function loadBoard() {
    var day = today;
    $("board-note").textContent = "Loading the board…";
    rpc("sr_board", { p_day: day, p_device: deviceId() }).then(function (rows) {
      if (day !== today) return;
      $("board-note").textContent = ""; drawBoard(rows || []);
    }, function () { $("board-note").textContent = "The board isn't loading right now."; drawBoard([]); });
  }
  function drawBoard(rows) {
    var posted = !!game.posted;
    $("board-form").hidden = posted; $("board-me").hidden = !posted;
    if (posted) $("board-me-name").textContent = game.posted;
    $("board-list").innerHTML = rows.length ? rows.map(function (r, k) {
      var sq = String(r.squares || "").split("").map(function (c) { return SQUARE[tier(+c)]; }).join("");
      return '<li class="' + (r.me ? "me" : "") + '"><span class="muted">' + (k + 1) + "</span><span>" + esc(r.player) + '</span><span class="sq" aria-hidden="true">' + sq + "</span><b>" + r.score + "</b></li>";
    }).join("") : '<li class="muted" style="display:block">No scores posted yet today.</li>';
  }

  // ---- Wiring
  $("start-daily").onclick = startDaily;
  $("start-endless").onclick = startEndless;
  $("again").onclick = startEndless;
  $("home-btn").onclick = function () { homeStatus(); show("home"); };
  $("fields").addEventListener("click", function (e) { var b = e.target.closest("[data-clue]"); if (b) lift(b.getAttribute("data-clue")); });
  $("guess").addEventListener("input", function (e) { showSugg(e.target.value); $("note").textContent = ""; });
  $("guess").addEventListener("keydown", function (e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault(); if (!sugg.length) return;
    hi = (hi + (e.key === "ArrowDown" ? 1 : -1) + sugg.length) % sugg.length;
    document.querySelectorAll("#sugg button").forEach(function (b, k) { b.classList.toggle("on", k === hi); });
  });
  $("sugg").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-k]"); if (!b) return;
    $("guess").value = sugg[+b.getAttribute("data-k")]; guess($("guess").value);
    if (!cur.done) { showSugg(""); $("guess").focus(); }
  });
  $("ask").addEventListener("submit", function (e) {
    e.preventDefault();
    var text = hi >= 0 && sugg[hi] ? sugg[hi] : $("guess").value;
    guess(text); if (!cur.done) showSugg($("guess").value);
  });
  $("give-up").onclick = function () { reveal(true); };
  $("share").onclick = function () {
    var t = shareText(), ok = function () { toast("Copied. Paste it in the group chat."); };
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) navigator.share({ text: t }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(t).then(ok, function () { window.prompt("Copy this:", t); });
    else window.prompt("Copy this:", t);
  };
  $("board-form").addEventListener("submit", function (e) { e.preventDefault(); var n = $("board-name").value.trim().slice(0, 24); if (n) postScore(n); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && $("home").hidden === false) homeStatus(); });
  homeStatus();
})();
