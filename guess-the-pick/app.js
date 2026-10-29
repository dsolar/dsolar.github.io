/* Guess the Pick: screens, the guess box and saved progress. The rules live in engine.js, the picks in data.js.
   Saved on this device (localStorage):
     gtp-sport                    the last sport picked
     gtp-daily5-SPORT-YYYY-MM-DD  today's daily ten so far, so a refresh picks up where you left off
     gtp-best5-SPORT              best endless score
   (The "5" keys started when picks went from 3 points to 5; the older 3-point keys are simply ignored.) */
(function () {
  var DATA = window.GTP_DATA, G = window.GTP;
  if (!DATA || !G) return;
  var $ = function (id) { return document.getElementById(id); };
  var LEAGUE = { nba: "NBA", nfl: "NFL" };
  // 0 to 5 points: a tier for the colors (green 4-5, yellow 2-3, orange 1, black 0), a verdict for the reveal
  var tier = function (s) { return s >= 4 ? 3 : s >= 2 ? 2 : s >= 1 ? 1 : 0; };
  var SQUARE = ["⬛", "🟧", "🟨", "🟩"];
  var square = function (s) { return SQUARE[tier(s)]; };
  var VERDICT = ["Missed it", "Just made it", "Got there", "Got it", "Got it", "Nailed it"];
  // The hint menu. Each costs points, can be bought in any order, and can't take a pick down to zero.
  var HINTS = [
    { id: "pos", label: "Position", cost: 1, text: function (p) { return p.pos; } },
    { id: "col", label: "School", cost: 1, text: function (p) { return p.col; } },
    { id: "size", label: "Size", cost: 1, text: function (p) { return p.size; } },
    { id: "pb", label: "Pick before", cost: 1, text: function (p) { return p.pb; } },
    { id: "init", label: "Initials", cost: 2, text: function (p) { return initials(p.n); } }
  ];

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
  // NBA team colors (primary, accent). Teams that moved or renamed keep the colors they wore then; ESPN has no
  // logo for them, so their badge is the abbreviation in those colors.
  var NBA_COLORS = {
    ATL: ["#E03A3E", "#C1D32F"], BOS: ["#007A33", "#BA9653"], BRK: ["#000000", "#FFFFFF"], NJN: ["#002A60", "#CD1041"],
    CHA: ["#F26532", "#2C5697"], CHO: ["#1D1160", "#00788C"], CHI: ["#CE1141", "#000000"], CLE: ["#860038", "#FDBB30"],
    DAL: ["#00538C", "#B8C4CA"], DEN: ["#0E2240", "#FEC524"], DET: ["#C8102E", "#1D42BA"], GSW: ["#1D428A", "#FFC72C"],
    HOU: ["#CE1141", "#C4CED4"], IND: ["#002D62", "#FDBB30"], LAC: ["#C8102E", "#1D428A"], LAL: ["#552583", "#FDB927"],
    MEM: ["#5D76A9", "#12173F"], MIA: ["#98002E", "#F9A01B"], MIL: ["#00471B", "#EEE1C6"], MIN: ["#0C2340", "#78BE20"],
    NOH: ["#002B5C", "#00788C"], NOK: ["#002B5C", "#00788C"], NOP: ["#0C2340", "#85714D"], NYK: ["#006BB6", "#F58426"],
    OKC: ["#007AC1", "#EF3B24"], SEA: ["#00653A", "#FFC200"], ORL: ["#0077C0", "#C4CED4"], PHI: ["#006BB6", "#ED174C"],
    PHO: ["#1D1160", "#E56020"], POR: ["#E03A3E", "#000000"], SAC: ["#5A2D81", "#63727A"], SAS: ["#000000", "#C4CED4"],
    TOR: ["#CE1141", "#000000"], UTA: ["#002B5C", "#F9A01B"], WAS: ["#002B5C", "#E31837"]
  };
  // NFL team colors (primary, accent), with the old ones for teams that moved: Oakland, San Diego, St. Louis
  var NFL_COLORS = {
    ARI: ["#97233F", "#FFB612"], ATL: ["#A71930", "#000000"], BAL: ["#241773", "#9E7C0C"], BUF: ["#00338D", "#C60C30"],
    CAR: ["#0085CA", "#101820"], CHI: ["#0B162A", "#C83803"], CIN: ["#FB4F14", "#000000"], CLE: ["#311D00", "#FF3C00"],
    DAL: ["#003594", "#869397"], DEN: ["#002244", "#FB4F14"], DET: ["#0076B6", "#B0B7BC"], GNB: ["#203731", "#FFB612"],
    HOU: ["#03202F", "#A71930"], IND: ["#002C5F", "#A2AAAD"], JAX: ["#006778", "#D7A22A"], KAN: ["#E31837", "#FFB81C"],
    LAC: ["#0080C6", "#FFC20E"], SDG: ["#002A5E", "#FFC20E"], LAR: ["#003594", "#FFA300"], STL: ["#002244", "#B3995D"],
    LVR: ["#000000", "#A5ACAF"], OAK: ["#000000", "#A5ACAF"], MIA: ["#008E97", "#FC4C02"], MIN: ["#4F2683", "#FFC62F"],
    NOR: ["#101820", "#D3BC8D"], NWE: ["#002244", "#C60C30"], NYG: ["#0B2265", "#A71930"], NYJ: ["#125740", "#FFFFFF"],
    PHI: ["#004C54", "#A5ACAF"], PIT: ["#101820", "#FFB612"], SEA: ["#002244", "#69BE28"], SFO: ["#AA0000", "#B3995D"],
    TAM: ["#D50A0A", "#B1BABF"], TEN: ["#0C2340", "#4B92DB"], WAS: ["#5A1414", "#FFB612"]
  };
  function colors(abbr) { return (sport === "nba" ? NBA_COLORS : NFL_COLORS)[abbr]; }
  // Dark accents (black, near-black navy) read badly as text on a dark badge, so those badges use white.
  function dark(hex) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b < 70;
  }
  // A badge for a team with no logo at all (the SuperSonics): its abbreviation, in its colors.
  function badge(abbr) {
    var c = colors(abbr);
    return '<b' + (c ? ' style="background:' + c[0] + ";color:" + (dark(c[1]) ? "#FFFFFF" : c[1]) + '"' : "") + ">" + esc(abbr) + "</b>";
  }
  function logo(sport, code, abbr, size) {
    if (!code) return badge(abbr);
    var src = "https://a.espncdn.com/combiner/i?img=/i/teamlogos/" + sport + "/500-dark/" + code + ".png&w=" + size + "&h=" + size;
    return '<img src="' + esc(src) + '" alt="" data-abbr="' + esc(abbr) + '">';
  }
  document.addEventListener("error", function (e) {   // a logo that won't load gives way to the abbreviation badge
    var img = e.target;
    if (img.tagName === "IMG" && img.closest(".logo")) img.outerHTML = badge(img.getAttribute("data-abbr"));
    if (img.tagName === "IMG" && img.closest(".watermark")) img.remove();
  }, true);
  // Paint the card in the picking team's colors.
  function brand(p) {
    var card = $("card"), c = colors(p.t), w = $("watermark");
    card.classList.toggle("branded", !!c);
    card.style.setProperty("--t1", c ? c[0] : "");
    card.style.setProperty("--t2", c ? c[1] : "");
    w.innerHTML = c && p.tl ? '<img src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/' + sport + "/500-dark/" + p.tl + '.png&w=400&h=400" alt="">' : "";
  }

  // ---- The group board: daily scores in Supabase (tools/guess_the_pick_supabase.sql), same project as Make the Call
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
  // Monday of this week, Boston time, as "2026-10-26"
  function weekStart(day) {
    var d = new Date(day + "T12:00:00Z"), back = (d.getUTCDay() + 6) % 7;
    return new Date(d - back * 864e5).toISOString().slice(0, 10);
  }

  var sport = store.get("gtp-sport") || "nba";
  var asked = (/[?&]sport=(nba|nfl)/i.exec(location.search) || [])[1];
  if (asked) sport = asked.toLowerCase();
  var picks, pool, mode, game, cur, today = G.dailyKey();
  $("years").textContent = "last 20 drafts, " + DATA.years[0] + " to " + DATA.years[1];

  function load(s) {
    sport = s; picks = DATA[s]; pool = G.pool(picks, (window.GTP_NAMES || {})[s]);
    store.set("gtp-sport", s);
    document.querySelectorAll(".sport").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-sport") === s)); });
    homeStatus();
  }
  function dailyKey() { return "gtp-daily5-" + sport + "-" + today; }
  function homeStatus() {
    var d = store.get(dailyKey());
    var total = d ? d.results.reduce(function (a, r) { return a + r.s; }, 0) : 0;
    $("daily-status").textContent = !d || !d.results.length ? "New today"
      : d.results.length >= G.DAILY ? "Done today: " + total + "/" + G.DAILY * G.POINTS : "In progress: " + d.results.length + " of " + G.DAILY;
    var best = store.get("gtp-best5-" + sport);
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
    cur = resume && resume.i === i ? resume : { i: i, used: [], wrong: [], done: false };
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
    brand(p);
    $("team-logo").innerHTML = logo(sport, p.tl, p.t, 160);
    $("team-name").textContent = p.tn;
    $("moved").hidden = !p.to;
    if (p.to) {
      $("moved-logo").innerHTML = logo(sport, p.tol, p.to, 96);
      $("moved-text").innerHTML = (p.late ? "Debuted with " : "Went to ") + "<b>" + esc(p.ton) + "</b>";
    }
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
      var why = !has ? "n/a" : used ? "shown" : !afford ? "can't afford" : "\u2212" + h.cost;
      return '<button type="button" class="tool hint" data-hint="' + h.id + '"' + (used || !has || !afford ? " disabled" : "")
        + (used ? ' aria-pressed="true"' : "") + ">" + h.label + " <small>" + why + "</small></button>";
    }).join("");
  }
  function drawClues() {
    var p = picks[cur.i];
    $("clues").innerHTML = HINTS.filter(function (h) { return cur.used.indexOf(h.id) >= 0; }).map(function (h) {
      return '<div class="clue"><span>' + h.label + "</span>" + esc(h.text(p)) + "</div>";
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
      $("card-count").textContent = "Pick " + (game.results.length + 1);
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
    var where = p.to ? " Picked by the " + p.tn + ", " + (p.late ? "debuted with the " : "went to the ") + p.ton + "." : "";
    $("facts").innerHTML = "<b>" + esc([p.pos, p.col].filter(Boolean).join(" · ")) + "</b><br>" + esc(p.line) + "." + esc(where);
    $("context").innerHTML = context(p);
    var last = mode === "daily" ? game.results.length >= G.DAILY : game.misses >= G.LIVES;
    $("next").textContent = last ? "See how you did" : "Next pick";
    $("next").focus({ preventScroll: true });
  }
  // The picks around him: up to two before and two after, same round only. Nobody from further down the draft.
  var NEAR = 2;
  function context(p) {
    var near = picks.filter(function (x) { return x.y === p.y && x.r === p.r && x !== p && Math.abs(x.p - p.p) <= NEAR; })
      .sort(function (a, b) { return a.p - b.p; });
    var slot = function (x) { return x.r === 1 ? "#" + x.p : "Round " + x.r + ", #" + x.p; };
    var rows = near.map(function (x) {
      var d = x.p - p.p, n = Math.abs(d);
      return [slot(x) + " " + x.n, (n === 1 ? "one pick " : n + " picks ") + (d < 0 ? "before" : "after")];
    });
    var top = picks.filter(function (x) { return x.y === p.y; }).sort(function (a, b) { return b.f - a.f; })[0];
    if (top === p && p.f >= 0.3) rows.push(["Best career in the " + p.y + " draft", ""]);
    if (!rows.length) return "";
    return '<p class="ctx-label">Around him in the ' + p.y + " " + LEAGUE[sport] + " draft</p><ul>" + rows.map(function (r) {
      return "<li><b>" + esc(r[0]) + "</b>" + (r[1] ? "<span>" + esc(r[1]) + "</span>" : "") + "</li>";
    }).join("") + "</ul>";
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
      var max = G.DAILY * G.POINTS;
      $("done-title").textContent = LEAGUE[sport] + " daily · " + niceDate();
      $("done-score").innerHTML = total + "<small>/" + max + "</small>";
      $("done-grade").textContent = total >= 45 ? "War room material." : total >= 35 ? "You'd keep your GM job." : total >= 24 ? "Solid. A few reaches." : total >= 12 ? "The fans are booing." : "Traded for a second-rounder.";
      var other = sport === "nba" ? "nfl" : "nba", otherDone = (store.get("gtp-daily5-" + other + "-" + today) || { results: [] }).results.length >= G.DAILY;
      $("again").textContent = otherDone ? "Play endless" : "Play the " + LEAGUE[other] + " daily";
      $("again").onclick = function () { if (otherDone) startEndless(); else { load(other); startDaily(); } };
      tick();
      $("board").hidden = false;
      boardSquares = game.results.map(function (r) { return r.s; }).join("");
      var name = store.get("gtp-name");
      if (name && game.posted !== name) postScore(name); else loadBoard();
    } else {
      var prev = store.get("gtp-best5-" + sport), best = prev || 0, isBest = prev == null || total > best;
      if (isBest) store.set("gtp-best5-" + sport, total);
      $("done-title").textContent = LEAGUE[sport] + " endless";
      $("done-score").innerHTML = total + "<small> pts</small>";
      $("done-grade").textContent = (prev == null ? "First run in the books. " : isBest ? "New best! " : "Best: " + best + ". ") + game.results.length + " picks, three strikes.";
      $("again").textContent = "Run it back";
      $("again").onclick = startEndless;
      $("countdown").textContent = "";
      $("board").hidden = true;
    }
    $("done-squares").textContent = squares.length > 40 ? squares.slice(-40 * 2) : squares;
    $("recap").innerHTML = game.results.map(function (r, k) {
      var p = picks[r.i];
      return '<li><i class="s' + tier(r.s) + '"></i><div><b>' + esc(p.n) + "</b><br><span>" + p.y + " · " + (p.r === 1 ? "Pick " + p.p : "Round " + p.r + ", pick " + p.rp)
        + " · " + esc(p.t) + (p.to ? " → " + esc(p.to) : "") + '</span><span class="hit" data-k="' + k + '"></span></div><span>+' + r.s + "</span></li>";
    }).join("");
    $("share").onclick = function () { share(total, squares); };
    hits = null;
    homeStatus();
  }
  // Post today's score under a name (once per device per day; posting again renames it), then show the board.
  var boardSquares = "", boardTab = "today", boardRows = [], hits = null;
  function postScore(name) {
    $("board-note").textContent = "Posting\u2026";
    rpc("gtp_post5", { p_day: today, p_sport: sport, p_device: deviceId(), p_player: name, p_squares: boardSquares }).then(function () {
      store.set("gtp-name", name);
      game.posted = name; store.set(dailyKey(), game);
      loadBoard();
    }, function () { $("board-note").textContent = "Couldn't post right now. Try again in a minute."; drawBoard(); });
  }
  function loadBoard() {
    var day = today, from = weekStart(today);
    $("board-note").textContent = "Loading the board\u2026";
    rpc("gtp_board5", { p_sport: sport, p_from: from, p_to: day }).then(function (rows) {
      if (day !== today) return;
      boardRows = rows || [];
      $("board-note").textContent = "";
      drawBoard();
    }, function () { $("board-note").textContent = "The board isn't loading right now."; drawBoard(); });
  }
  // One row per device per day (its latest name), so a rename doesn't count twice, and one per name,
  // so playing on a phone and a laptop counts the first score only.
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
    var list = $("board-list"), html = "";
    if (boardTab === "today") {
      var rows = todays().sort(function (a, b) { return b.score - a.score || (a.created_at < b.created_at ? -1 : 1); });
      html = rows.map(function (r, k) {
        var sq = r.squares.split("").map(function (c) { return square(+c); }).join("");
        return '<li class="' + (r.player.toLowerCase() === me ? "me" : "") + '"><b class="rk">' + (k + 1) + "</b><span class=\"nm\">" + esc(r.player)
          + '</span><span class="sq" aria-hidden="true">' + sq + "</span><b class=\"pt\">" + r.score + "</b></li>";
      }).join("");
      if (!rows.length && !$("board-note").textContent) html = '<li class="empty">Nobody on the board yet today. Be first.</li>';
      // How the group did on each pick, for the recap
      hits = rows.length ? boardSquares.split("").map(function (c, k) { return rows.filter(function (r) { return r.squares.charAt(k) !== "0"; }).length; }) : null;
      drawHits(rows.length);
    } else {
      var seen = {}, tot = {};
      boardRows.slice().reverse().forEach(function (r) {   // newest first, so each device's latest name wins
        var key = r.day + "|" + r.device;
        if (seen[key]) return; seen[key] = true;
        var who = r.player.toLowerCase(), dayKey = who + "|" + r.day;
        if (seen[dayKey]) return; seen[dayKey] = true;       // two devices, one name, one day: only one score counts
        tot[who] = tot[who] || { player: r.player, score: 0, days: 0 };
        tot[who].score += r.score; tot[who].days++;
      });
      var week = Object.keys(tot).map(function (k) { return tot[k]; }).sort(function (a, b) { return b.score - a.score || b.days - a.days; });
      html = week.map(function (r, k) {
        return '<li class="' + (r.player.toLowerCase() === me ? "me" : "") + '"><b class="rk">' + (k + 1) + "</b><span class=\"nm\">" + esc(r.player)
          + '</span><span class="sq">' + r.days + " day" + (r.days === 1 ? "" : "s") + "</span><b class=\"pt\">" + r.score + "</b></li>";
      }).join("");
      if (!week.length && !$("board-note").textContent) html = '<li class="empty">No scores yet this week.</li>';
    }
    list.innerHTML = html;
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
    if (!name) return;
    postScore(name);
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
    var first = G.judge(v, picks[cur.i], pool);
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
