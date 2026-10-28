/* Guess the Pick: screens, the guess box and saved progress. The rules live in engine.js, the picks in data.js.
   Saved on this device (localStorage):
     gtp-sport                    the last sport picked
     gtp-daily-SPORT-YYYY-MM-DD   today's daily ten so far, so a refresh picks up where you left off
     gtp-best-SPORT               best endless score */
(function () {
  var DATA = window.GTP_DATA, G = window.GTP;
  if (!DATA || !G) return;
  var $ = function (id) { return document.getElementById(id); };
  var LEAGUE = { nba: "NBA", nfl: "NFL" };
  var SQUARE = ["⬛", "🟧", "🟨", "🟩"];   // 0 to 3 points
  var VERDICT = ["Missed it", "Just made it", "Got it", "Nailed it"];

  var store = {
    get: function (k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window: this visit only */ } }
  };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  };
  var ordinal = function (n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  var initials = function (name) {
    return name.replace(/\b(Jr\.?|Sr\.?|II|III|IV)\b/g, "").trim().split(/\s+/).map(function (w) { return w.charAt(0).toUpperCase() + "."; }).join(" ");
  };
  function logo(sport, code, abbr, size) {
    if (!code) return "<b>" + esc(abbr) + "</b>";
    var src = "https://a.espncdn.com/combiner/i?img=/i/teamlogos/" + sport + "/500-dark/" + code + ".png&w=" + size + "&h=" + size;
    return '<img src="' + esc(src) + '" alt="" data-abbr="' + esc(abbr) + '">';
  }
  document.addEventListener("error", function (e) {   // a logo that won't load gives way to the abbreviation
    var img = e.target;
    if (img.tagName === "IMG" && img.closest(".logo")) img.outerHTML = "<b>" + esc(img.getAttribute("data-abbr")) + "</b>";
  }, true);

  var sport = store.get("gtp-sport") || "nba";
  var asked = (/[?&]sport=(nba|nfl)/i.exec(location.search) || [])[1];
  if (asked) sport = asked.toLowerCase();
  var picks, pool, mode, game, cur, today = G.dailyKey();
  $("years").textContent = "last 20 drafts, " + DATA.years[0] + " to " + DATA.years[1];

  function load(s) {
    sport = s; picks = DATA[s]; pool = G.pool(picks);
    store.set("gtp-sport", s);
    document.querySelectorAll(".sport").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-sport") === s)); });
    homeStatus();
  }
  function dailyKey() { return "gtp-daily-" + sport + "-" + today; }
  function homeStatus() {
    var d = store.get(dailyKey());
    var total = d ? d.results.reduce(function (a, r) { return a + r.s; }, 0) : 0;
    $("daily-status").textContent = !d || !d.results.length ? "New today"
      : d.results.length >= G.DAILY ? "Done today: " + total + "/" + G.DAILY * G.POINTS : "In progress: " + d.results.length + " of " + G.DAILY;
    var best = store.get("gtp-best-" + sport);
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
    game = saved && saved.order ? saved : { order: G.daily(picks, sport), results: [] };
    store.set(dailyKey(), game);
    if (game.results.length >= G.DAILY) return finish();
    newPick(game.order[game.results.length], game.cur);
  }
  function startEndless() {
    mode = "endless";
    game = { results: [], seen: [], misses: 0 };
    newPick(G.endless(picks, game.seen));
  }

  // ---- One pick
  function newPick(i, resume) {
    cur = resume && resume.i === i ? resume : { i: i, hints: 0, wrong: [], done: false };
    if (mode === "daily") { game.cur = cur; store.set(dailyKey(), game); }
    var p = picks[i];
    show("play");
    var card = $("card"); card.classList.remove("enter"); void card.offsetWidth; card.classList.add("enter");
    $("card-league").textContent = LEAGUE[sport] + " Draft";
    $("card-year").textContent = p.y + " draft";
    if (p.r === 1) {
      $("plate-round").textContent = "Pick"; $("plate-pick").textContent = p.p; $("plate-overall").textContent = "Round 1";
    } else {
      $("plate-round").textContent = "Round " + p.r; $("plate-pick").textContent = p.rp; $("plate-overall").textContent = ordinal(p.p) + " overall";
    }
    $("plate").setAttribute("aria-label", p.r === 1 ? "Pick " + p.p : "Round " + p.r + ", pick " + p.rp + ", " + ordinal(p.p) + " overall");
    $("team-logo").innerHTML = logo(sport, p.tl, p.t, 96);
    $("team-name").textContent = p.tn;
    $("moved").hidden = !p.to;
    if (p.to) {
      $("moved-logo").innerHTML = logo(sport, p.tol, p.to, 64);
      $("moved-text").innerHTML = (p.late ? "Debuted with " : "Went to ") + "<b>" + esc(p.ton) + "</b>";
    }
    $("guess").value = ""; closeList();
    $("msg").textContent = ""; $("msg").className = "msg";
    $("reveal").hidden = true; $("guess-area").hidden = false;
    hud(); drawClues(); drawPoints();
    if (cur.done) return reveal(cur.gaveUp);
    if (window.matchMedia("(hover: hover)").matches) $("guess").focus();
  }
  function points() { return Math.max(0, G.POINTS - cur.hints - cur.wrong.length); }
  function drawPoints() {
    var n = points(), h = "";
    for (var k = 0; k < G.POINTS; k++) h += '<i class="' + (k < n ? "" : "used") + '"></i>';
    $("pts").innerHTML = h + "<span>" + n + " point" + (n === 1 ? "" : "s") + " on the table</span>";
    $("wrongs").innerHTML = cur.wrong.map(function (w) { return "<span>" + esc(w) + "</span>"; }).join("");
    var hint = $("hint");
    hint.disabled = cur.hints >= 2 || n <= 1;
    hint.textContent = cur.hints >= 2 ? "No hints left" : n <= 1 ? "Last point: no more hints"
      : cur.hints === 0 ? "Hint: position & school (−1)" : "Hint: initials (−1)";
  }
  function drawClues() {
    var p = picks[cur.i], h = "";
    if (cur.hints >= 1) h += '<div class="clue"><span>Profile</span>' + esc([p.pos, p.col].filter(Boolean).join(" · ")) + "</div>";
    if (cur.hints >= 2) h += '<div class="clue"><span>Initials</span>' + esc(initials(p.n)) + "</div>";
    $("clues").innerHTML = h;
  }
  function hud() {
    var total = game.results.reduce(function (a, r) { return a + r.s; }, 0);
    if (mode === "daily") {
      var n = game.results.length, track = "";
      for (var k = 0; k < G.DAILY; k++) track += '<i class="' + (k < n ? "s" + game.results[k].s : k === n ? "on" : "") + '"></i>';
      $("hud-mode").innerHTML = '<span class="track" aria-hidden="true">' + track + "</span>";
      $("hud-right").innerHTML = '<span class="score"><b>' + total + "</b> / " + G.DAILY * G.POINTS + "</span>";
      $("card-count").textContent = (n + 1) + " of " + G.DAILY;
    } else {
      var lives = "";
      for (var j = 0; j < G.LIVES; j++) lives += '<i class="' + (j < G.LIVES - game.misses ? "" : "gone") + '"></i>';
      $("hud-mode").innerHTML = '<span class="lives" aria-label="' + (G.LIVES - game.misses) + ' misses left">' + lives + "</span>";
      $("hud-right").innerHTML = '<span class="score"><b>' + total + "</b> points</span>";
      $("card-count").textContent = "Pick " + (game.results.length + 1);
    }
  }

  function guess(text) {
    if (cur.done) return;
    closeList();
    var p = picks[cur.i], verdict = G.judge(text, p, pool);
    var msg = $("msg");
    if (verdict === "unknown") {
      msg.className = "msg"; msg.textContent = text.trim() ? "That name isn't in the game. Try one of the suggestions." : "";
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
  function hint() {
    if (cur.done || cur.hints >= 2 || points() <= 1) return;
    cur.hints++;
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
    $("verdict").className = "verdict v" + s;
    $("verdict").textContent = (gaveUp ? "Here's who it was" : VERDICT[s]) + (s ? " · +" + s : "");
    $("answer").textContent = p.n;
    var where = p.to ? " Picked by the " + p.tn + ", " + (p.late ? "debuted with the " : "went to the ") + p.ton + "." : "";
    $("facts").innerHTML = "<b>" + esc([p.pos, p.col].filter(Boolean).join(" · ")) + "</b><br>" + esc(p.line) + "." + esc(where);
    var last = mode === "daily" ? game.results.length >= G.DAILY : game.misses >= G.LIVES;
    $("next").textContent = last ? "See how you did" : "Next pick";
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
    var squares = game.results.map(function (r) { return SQUARE[r.s]; }).join("");
    if (mode === "daily") {
      var max = G.DAILY * G.POINTS;
      $("done-title").textContent = LEAGUE[sport] + " daily · " + niceDate();
      $("done-score").innerHTML = total + "<small>/" + max + "</small>";
      $("done-grade").textContent = total >= 27 ? "War room material." : total >= 21 ? "You'd keep your GM job." : total >= 14 ? "Solid. A few reaches." : total >= 7 ? "The fans are booing." : "Traded for a second-rounder.";
      var other = sport === "nba" ? "nfl" : "nba", otherDone = (store.get("gtp-daily-" + other + "-" + today) || { results: [] }).results.length >= G.DAILY;
      $("again").textContent = otherDone ? "Play endless" : "Play the " + LEAGUE[other] + " daily";
      $("again").onclick = function () { if (otherDone) startEndless(); else { load(other); startDaily(); } };
      tick();
    } else {
      var prev = store.get("gtp-best-" + sport), best = prev || 0, isBest = prev == null || total > best;
      if (isBest) store.set("gtp-best-" + sport, total);
      $("done-title").textContent = LEAGUE[sport] + " endless";
      $("done-score").innerHTML = total + "<small> pts</small>";
      $("done-grade").textContent = (prev == null ? "First run in the books. " : isBest ? "New best! " : "Best: " + best + ". ") + game.results.length + " picks, three strikes.";
      $("again").textContent = "Run it back";
      $("again").onclick = startEndless;
      $("countdown").textContent = "";
    }
    $("done-squares").textContent = squares.length > 40 ? squares.slice(-40 * 2) : squares;
    $("recap").innerHTML = game.results.map(function (r) {
      var p = picks[r.i];
      return '<li><i class="s' + r.s + '"></i><div><b>' + esc(p.n) + "</b><br><span>" + p.y + " · " + (p.r === 1 ? "Pick " + p.p : "Round " + p.r + ", pick " + p.rp)
        + " · " + esc(p.t) + (p.to ? " → " + esc(p.to) : "") + "</span></div><span>+" + r.s + "</span></li>";
    }).join("");
    $("share").onclick = function () { share(total, squares); };
    homeStatus();
  }
  function niceDate() {
    return new Date(today + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }
  var clock = null;
  function tick() {
    clearInterval(clock);
    var draw = function () {
      var now = new Date(), et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      var left = (24 * 3600) - (et.getHours() * 3600 + et.getMinutes() * 60 + et.getSeconds());
      var h = Math.floor(left / 3600), m = Math.floor(left % 3600 / 60);
      $("countdown").textContent = "Next daily in " + h + "h " + m + "m (midnight, Boston time)";
      if (G.dailyKey() !== today) { today = G.dailyKey(); homeStatus(); }
    };
    draw(); clock = setInterval(draw, 30e3);
  }
  function share(total, squares) {
    var text = mode === "daily"
      ? "Guess the Pick · " + LEAGUE[sport] + " daily · " + niceDate() + "\n" + squares + " " + total + "/" + G.DAILY * G.POINTS
      : "Guess the Pick · " + LEAGUE[sport] + " endless\n" + total + " points over " + game.results.length + " picks";
    text += "\nhttps://davidsolar.dev/guess-the-pick/";
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

  // ---- The guess box: suggestions as you type, arrow keys to move, Enter or a tap to guess
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
    var v = input.value;
    // One suggestion left and the box doesn't match a full name yet: that's the guess.
    if (options.length === 1 && G.judge(v, picks[cur.i], pool) === "unknown") v = options[0];
    guess(v);
  });

  // ---- Buttons
  document.querySelectorAll(".sport").forEach(function (b) { b.addEventListener("click", function () { load(b.getAttribute("data-sport")); }); });
  $("start-daily").addEventListener("click", startDaily);
  $("start-endless").addEventListener("click", startEndless);
  $("hint").addEventListener("click", hint);
  $("give-up").addEventListener("click", function () { if (!cur.done) finishPick(0, true); });
  $("next").addEventListener("click", next);
  $("back").addEventListener("click", function () { clearInterval(clock); homeStatus(); show("home"); });
  $("menu").addEventListener("click", function () { clearInterval(clock); homeStatus(); show("home"); });

  load(sport);
})();
