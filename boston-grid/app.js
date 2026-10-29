/* Boston Grid: screens, the guess box and saved progress. The rules are in engine.js, the players in data-*.js
   (loaded one league at a time, the NFL file is the big one).
   Saved on this device (localStorage):
     bg-sport                   the last league picked
     bg-daily-SPORT-YYYY-MM-DD  today's grid so far: squares, guesses left, who's been used
     gtp-name, gtp-device       the board name and device id, shared with Guess the Pick and Journeyman */
(function () {
  var G = window.GTP, BG = window.BG;
  if (!G || !BG) return;
  var $ = function (id) { return document.getElementById(id); };
  var LEAGUE = { nba: "NBA", nfl: "NFL", mlb: "MLB" }, SPORTS = ["nba", "nfl", "mlb"];
  var store = {
    get: function (k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window: this visit only */ } }
  };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function toast(t) { var el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, 2600); }

  // ---- Data, one league at a time
  var loading = {};
  function loadData(sp) {
    if (window.BG_DATA && window.BG_DATA[sp]) return Promise.resolve(window.BG_DATA[sp]);
    if (!loading[sp]) loading[sp] = new Promise(function (ok, fail) {
      var s = document.createElement("script");
      s.src = "data-" + sp + ".js?v=1"; s.onload = function () { ok(window.BG_DATA[sp]); }; s.onerror = fail;
      document.head.appendChild(s);
    });
    return loading[sp];
  }

  // ---- State
  var asked = (/[?&]sport=(nba|nfl|mlb)/i.exec(location.search) || [])[1];
  var sport = (asked || store.get("bg-sport") || "nba").toLowerCase();
  if (SPORTS.indexOf(sport) < 0) sport = "nba";
  var today = G.dailyKey(), L = null, grid = null, game = null, sel = -1, sugg = [], hi = -1, confirmStop = false;
  function key(sp, day) { return "bg-daily-" + (sp || sport) + "-" + (day || today); }
  function fresh() { return { cells: [null, null, null, null, null, null, null, null, null], left: BG.GUESSES, used: [], misses: 0, done: false }; }
  function save() { store.set(key(), game); }
  function filled() { return game.cells.filter(Boolean).length; }
  function deep() { return game.cells.reduce(function (a, c) { return a + (c ? c.pts : 0); }, 0); }
  function rc(i) { return [grid.rows[Math.floor(i / 3)], grid.cols[i % 3]]; }
  function team(i) { var id = L.ids[i]; return L.teams[id]; }
  function light(hex) {
    var h = String(hex || "#000").replace("#", ""); if (h.length < 6) return false;
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 170;
  }
  function nick(i) { return team(i)[1]; }

  // ---- Drawing the wall
  function teamTile(i, home) {
    var t = team(i), c1 = t[2], c2 = t[3];
    return '<div class="team' + (light(c1) ? " light" : "") + (home ? " home" : "") + '" style="--t1:' + esc(c1) + ";--t2:" + esc(c2) + '">'
      + "<small>" + esc(t[0]) + "</small><b>" + esc(t[1]) + "</b></div>";
  }
  function draw() {
    var html = '<div class="corner" aria-label="' + game.left + ' guesses left"><b>' + game.left + "</b><span>Guesses</span></div>";
    grid.cols.forEach(function (c) { html += teamTile(c, false); });
    for (var r = 0; r < 3; r++) {
      html += teamTile(grid.rows[r], r === 0);
      for (var c = 0; c < 3; c++) {
        var i = r * 3 + c, cell = game.cells[i], pair = nick(grid.rows[r]) + " and " + nick(grid.cols[c]);
        if (cell) html += '<button type="button" class="cell got' + (game.done ? " open-done" : "") + '" data-i="' + i + '" aria-label="' + esc(pair) + ": " + esc(cell.n) + '"><span class="nm">' + esc(cell.n) + '</span><span class="pts">+' + cell.pts + "</span></button>";
        else if (game.done) html += '<button type="button" class="cell miss open-done" data-i="' + i + '" aria-label="' + esc(pair) + ': empty. Show who fits"><span class="nm">Show</span></button>';
        else html += '<button type="button" class="cell' + (i === sel ? " sel" : "") + '" data-i="' + i + '" aria-label="' + esc(pair) + ': empty"><span class="plus" aria-hidden="true">+</span></button>';
      }
    }
    $("grid").innerHTML = html;
    var lights = "";
    for (var k = 0; k < BG.GUESSES; k++) {
      var used = BG.GUESSES - game.left;
      lights += '<i class="' + (k < filled() ? "on" : k < used ? "off" : "") + '"></i>';
    }
    $("lights").innerHTML = lights;
    $("lights").setAttribute("aria-label", filled() + " right, " + game.misses + " wrong, " + game.left + " guesses left");
    $("status").textContent = game.done ? filled() + " of 9 · " + deep() + " deep-cut points" : filled() + " of 9 filled";
    $("stop").hidden = game.done || BG.GUESSES - game.left === 0;
    $("stop").textContent = confirmStop ? "Tap again to end today's grid" : "I'm done";
    $("date").textContent = new Date(today + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
    document.querySelectorAll(".sports button").forEach(function (b) {
      var sp = b.getAttribute("data-sport"), g = store.get(key(sp));
      b.setAttribute("aria-pressed", String(sp === sport));
      b.querySelector(".tick").textContent = g && g.done ? "✓" : "";
    });
  }

  // ---- The guess box
  function openGuess(i) {
    sel = i; draw();
    var p = rc(i), f = $("guess");
    f.hidden = false; $("note").textContent = ""; $("note").className = "note";
    $("guess-title").innerHTML = "Played for the <b>" + esc(nick(p[0])) + "</b> and the <b>" + esc(nick(p[1])) + "</b>";
    $("guess-in").hidden = false; f.querySelector('button[type="submit"]').hidden = false;
    $("guess-in").value = ""; showSugg("");
    $("guess-in").focus({ preventScroll: true });
    if (window.matchMedia("(min-width: 641px)").matches) f.scrollIntoView({ block: "nearest", behavior: "smooth" });
    else {   // on a phone the box covers the bottom of the screen: keep the square being guessed above it
      var cell = document.querySelector('.cell[data-i="' + i + '"]'), over = cell && cell.getBoundingClientRect().bottom - (f.getBoundingClientRect().top - 10);
      if (over > 0) window.scrollBy({ top: over, behavior: "smooth" });
    }
  }
  function closeGuess() { sel = -1; $("guess").hidden = true; draw(); }
  function showSugg(text) {
    sugg = text.trim().length >= 2 ? G.suggest(text, L.pool, 6) : []; hi = -1;
    $("sugg").innerHTML = sugg.map(function (n, k) { return '<li><button type="button" role="option" data-k="' + k + '">' + esc(n) + "</button></li>"; }).join("");
  }
  function guess(text) {
    if (sel < 0 || game.done) return;
    var p = rc(sel), res = BG.judge(L, text, p[0], p[1], game.used), note = $("note");
    note.className = "note";
    if (res.r === "unknown") { note.textContent = text.trim() ? "No player by that name since 1990. Pick one from the list." : ""; return; }
    if (res.r === "used") { note.textContent = res.p.n + " is already on your grid. One square each."; return; }
    game.left--;
    if (res.r === "wrong") {
      game.misses++;
      note.textContent = res.p.n + " never played for both. " + game.left + " guess" + (game.left === 1 ? "" : "es") + " left.";
      var c = document.querySelector('.cell[data-i="' + sel + '"]');
      if (c) { c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake"); }
      $("guess-in").select();
    } else {
      game.cells[sel] = { n: res.p.n, pts: BG.points(res.p) };
      game.used.push(res.p.k);
    }
    if (!game.left || filled() === 9) game.done = true;
    save();
    if (res.r === "right" || game.done) { $("guess").hidden = true; sel = -1; }
    draw();
    if (game.done) finish();
  }
  function showAnswers(i) {
    var p = rc(i), list = BG.answers(L, p[0], p[1]).slice(0, 12), f = $("guess");
    sel = i; f.hidden = false;
    $("guess-title").innerHTML = "<b>" + esc(nick(p[0])) + "</b> and <b>" + esc(nick(p[1])) + "</b>: " + BG.answers(L, p[0], p[1]).length + " players since 1990";
    $("guess-in").hidden = true; f.querySelector('button[type="submit"]').hidden = true;
    $("sugg").innerHTML = list.map(function (pl) { return '<li><button type="button" tabindex="-1">' + esc(pl.n) + ' <small style="opacity:.7">+' + BG.points(pl) + "</small></button></li>"; }).join("");
    $("note").textContent = ""; draw();
  }

  // ---- Finished
  function finish() {
    $("done").hidden = false;
    var n = filled(), d = deep();
    $("done-title").textContent = n === 9 ? "Immaculate." : n >= 7 ? "Strong grid." : n >= 4 ? "Respectable." : n >= 1 ? "Rough day at the park." : "Swing and a miss.";
    $("d-sq").textContent = n + "/9"; $("d-deep").textContent = d;
    $("d-line").textContent = n === 9 ? "Every square. Now try to do it with nobody anyone's heard of." : n ? "Deep-cut points break ties on the board: lesser-known players earn more." : "Tomorrow's a new grid.";
    var other = SPORTS.filter(function (s) { var g = store.get(key(s)); return s !== sport && !(g && g.done); })[0];
    $("next-sport").hidden = !other;
    if (other) { $("next-sport").textContent = "Play the " + LEAGUE[other] + " grid"; $("next-sport").onclick = function () { setSport(other); window.scrollTo({ top: 0, behavior: "smooth" }); }; }
    // The best-known answers, skipping the one you used
    var html = "";
    for (var i = 0; i < 9; i++) {
      var p = rc(i), mine = game.cells[i] && G.norm(game.cells[i].n);
      var top = BG.answers(L, p[0], p[1]).filter(function (x) { return x.k !== mine; }).slice(0, 3).map(function (x) { return esc(x.n); });
      html += "<li><b>" + esc(nick(p[0])) + " + " + esc(nick(p[1])) + "</b>" + (top.join(", ") || "Nobody else") + "</li>";
    }
    $("who-list").innerHTML = html;
    var name = store.get("gtp-name");
    if (name) $("board-name").value = name;
    if (name && !game.posted) postScore(name); else loadBoard();
  }
  function shareText() {
    var rows = [];
    for (var r = 0; r < 3; r++) { var s = ""; for (var c = 0; c < 3; c++) s += game.cells[r * 3 + c] ? "🟩" : "⬜"; rows.push(s); }
    var date = new Date(today + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return "Boston Grid · " + LEAGUE[sport] + " · " + date + "\n" + rows.join("\n") + "\n" + filled() + "/9 · " + deep() + " deep-cut points\nhttps://davidsolar.dev/boston-grid/?sport=" + sport;
  }

  // ---- The group board (Supabase, tools/boston_grid_supabase.sql)
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
  function squares() { return game.cells.map(function (c) { return c ? "1" : "0"; }).join(""); }
  function postScore(name) {
    var sp = sport, day = today, g = game;
    $("board-note").textContent = "Posting…";
    rpc("bg_post", { p_day: day, p_sport: sp, p_device: deviceId(), p_player: name, p_squares: squares(), p_deep: deep() }).then(function () {
      store.set("gtp-name", name); g.posted = name; store.set(key(sp, day), g);
      if (sp === sport && day === today) loadBoard();
    }, function () { $("board-note").textContent = "Couldn't post right now. Try again in a minute."; drawBoard([]); });
  }
  function loadBoard() {
    var sp = sport, day = today;
    $("board-note").textContent = "Loading the board…";
    rpc("bg_board", { p_sport: sp, p_day: day, p_device: deviceId() }).then(function (rows) {
      if (sp !== sport || day !== today) return;
      $("board-note").textContent = ""; drawBoard(rows || []);
    }, function () { $("board-note").textContent = "The board isn't loading right now."; drawBoard([]); });
  }
  function drawBoard(rows) {
    var name = store.get("gtp-name"), posted = !!(game.posted);
    $("board-form").hidden = posted; $("board-me").hidden = !posted;
    if (posted) $("board-me-name").textContent = game.posted;
    if (!rows.length) { $("board-list").innerHTML = '<li class="muted" style="display:block">No grids posted yet today.</li>'; return; }
    $("board-list").innerHTML = rows.map(function (r, k) {
      var sq = (r.squares || "").replace(/1/g, "🟩").replace(/0/g, "⬜");
      return '<li class="' + (r.me ? "me" : "") + '"><span class="rk">' + (k + 1) + "</span><span>" + esc(r.player) + '</span><span class="sq" aria-hidden="true">' + sq + '</span><b class="pt">' + r.score + "/9 <small>" + r.deep + "</small></b></li>";
    }).join("");
    if (name && !$("board-name").value) $("board-name").value = name;
  }

  // ---- Switching leagues, starting up
  function setSport(sp) {
    sport = sp; store.set("bg-sport", sp); today = G.dailyKey(); sel = -1; confirmStop = false;
    $("guess").hidden = true; $("done").hidden = true;
    $("grid").innerHTML = '<p class="muted" style="grid-column:1/-1;color:var(--chalk-2)">Loading the grid…</p>';
    loadData(sp).then(function (data) {
      if (sp !== sport) return;
      L = BG.league(data, sp); grid = BG.grid(L, today);
      var saved = store.get(key());
      game = saved && Array.isArray(saved.cells) ? saved : fresh();
      draw();
      if (game.done) finish();
    }, function () { $("grid").innerHTML = '<p style="grid-column:1/-1">The players didn’t load. Check the connection and refresh.</p>'; });
  }

  document.querySelector(".sports").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-sport]"); if (b && b.getAttribute("data-sport") !== sport) setSport(b.getAttribute("data-sport"));
  });
  $("grid").addEventListener("click", function (e) {
    var c = e.target.closest(".cell"); if (!c || !game) return;
    var i = +c.getAttribute("data-i");
    if (game.done) return showAnswers(i);
    if (game.cells[i]) return;
    if (G.dailyKey() !== today) return setSport(sport);   // the tab sat open past midnight: today's grid instead
    openGuess(i);
  });
  $("guess-in").addEventListener("input", function (e) { showSugg(e.target.value); $("note").textContent = ""; });
  $("guess-in").addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); if (!sugg.length) return;
      hi = (hi + (e.key === "ArrowDown" ? 1 : -1) + sugg.length) % sugg.length;
      document.querySelectorAll("#sugg button").forEach(function (b, k) { b.classList.toggle("on", k === hi); });
    } else if (e.key === "Escape") closeGuess();
  });
  $("sugg").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-k]"); if (!b) return;
    $("guess-in").value = sugg[+b.getAttribute("data-k")]; guess($("guess-in").value);
    if (!$("guess").hidden) { $("guess-in").focus(); showSugg(""); }
  });
  $("guess").addEventListener("submit", function (e) {
    e.preventDefault();
    var text = hi >= 0 && sugg[hi] ? sugg[hi] : $("guess-in").value;
    // One suggestion left for what's typed: that's who they mean
    if (hi < 0 && sugg.length === 1 && !L.byName[G.norm(text)]) text = sugg[0];
    guess(text); if (!$("guess").hidden) showSugg($("guess-in").value);
  });
  $("guess-cancel").addEventListener("click", closeGuess);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("guess").hidden) closeGuess(); });
  $("stop").addEventListener("click", function () {
    if (!confirmStop) { confirmStop = true; draw(); setTimeout(function () { confirmStop = false; if (game && !game.done) draw(); }, 4000); return; }
    confirmStop = false; game.done = true; save(); $("guess").hidden = true; sel = -1; draw(); finish();
  });
  $("share").addEventListener("click", function () {
    var t = shareText();
    var ok = function () { toast("Copied. Paste it in the group chat."); };
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) navigator.share({ text: t }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(t).then(ok, function () { window.prompt("Copy this:", t); });
    else window.prompt("Copy this:", t);
  });
  $("board-form").addEventListener("submit", function (e) {
    e.preventDefault(); var n = $("board-name").value.trim().slice(0, 24); if (n) postScore(n);
  });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && G.dailyKey() !== today && game && sel < 0) setSport(sport); });

  setSport(sport);
})();
