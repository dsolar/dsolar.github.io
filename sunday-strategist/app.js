/* Sunday Strategist page: draws the field, walks through the five decision steps, shows the review.
   No football lives here: options, grades and explanations come from scenarios.js through engine.js. */
(function () {
  var D = window.SS_DATA, E = window.SS_ENGINE, V = window.SS_SCHEMA;
  var $ = function (id) { return document.getElementById(id); };
  var NS = "http://www.w3.org/2000/svg";
  var STORE = "ss-record-v1", PREFS = "ss-prefs-v1";
  var STEPS = [
    { id: "diagnose", label: "Diagnose" }, { id: "adjust", label: "Adjust" }, { id: "protect", label: "Protect" },
    { id: "call", label: "Call" }, { id: "answer", label: "Answer" }
  ];
  var PX = 10, LOS = 200; // 10 px per yard; the line of scrimmage sits 200 px down the drawing
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var phone = window.matchMedia ? matchMedia("(max-width: 720px)") : { matches: false };

  var st = null; // the snap in progress

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function load(k, fallback) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: the game still works */ } }
  function say(t) { $("live").textContent = ""; setTimeout(function () { $("live").textContent = t; }, 30); }
  function ord(n) { return ["", "1st", "2nd", "3rd", "4th"][n] || n + "th"; }
  function pct(x) { return Math.round(x * 100) + "%"; }
  function by(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  // Like a coaching diagram, the box is drawn wider than life so eleven players near the ball stay readable:
  // the 5 yards either side of the ball are stretched, the rest of the width is squeezed to fit.
  function sx(x) {
    var ball = st ? ballX() : 26.65, d = x - ball, edge = d < 0 ? ball : 53.3 - ball, k = 1.55, core = 5;
    var a = Math.abs(d), out = a <= core ? a * k : core * k + (a - core) * (edge - core * k) / (edge - core);
    return (ball + (d < 0 ? -out : out)) * PX;
  }
  function ballX() { var h = st.sc.context.hash; return h === "left" ? 23.58 : h === "right" ? 29.73 : 26.65; }
  function sy(y) { return LOS - y * PX; }

  // Refuse content that fails the schema rather than render half a scenario.
  var all = E.catalog(D, window.SS_REAL);
  var problems = V.validate({ concepts: D.concepts, defenses: D.defenses, tags: D.tags, confidence: D.confidence, scenarios: all });
  var scenarios = all.filter(function (s) { return s.status === "published"; }).sort(function (a, b) { return a.order - b.order; });
  var lessons = scenarios.filter(function (s) { return !s.real; });
  var film = scenarios.filter(function (s) { return s.module === "film-room"; });
  var pool = { scenarios: scenarios };
  function realOf(id) { return scenarios.filter(function (s) { return s.lesson === id; }); }
  if (problems.length) {
    $("module").innerHTML = '<div class="load-error"><b>The scenario data didn\'t pass validation.</b><br>' + problems.slice(0, 5).map(esc).join("<br>") + "</div>";
    if (window.console) console.error("Sunday Strategist data problems", problems);
    return;
  }

  // Team logos come from ESPN's CDN, like Make the Call; a logo that fails to load leaves the abbreviation.
  function logo(abbr, size) {
    var a = abbr === "LA" ? "lar" : abbr === "WAS" ? "wsh" : String(abbr).toLowerCase();
    return '<img class="logo" src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500-dark/' + esc(a) + '.png&w=64&h=64" alt="" width="' + (size || 22) + '" height="' + (size || 22) + '" loading="lazy" onerror="this.remove()">';
  }

  /* ---------- start screen ---------- */
  function renderStart() {
    var rec = load(STORE, null);
    $("side").innerHTML = '<span>You call the</span><button type="button" data-side="offense" aria-pressed="' + (side === "offense") + '">Offense</button><button type="button" data-side="defense" aria-pressed="' + (side === "defense") + '">Defense</button>';
    Array.prototype.forEach.call($("side").querySelectorAll("button"), function (b) {
      b.onclick = function () { side = b.getAttribute("data-side"); var p = load(PREFS, {}); p.side = side; save(PREFS, p); renderStart(); };
    });
    $("module").hidden = side === "defense";
    renderDefLessons(rec);
    var items = lessons.map(function (s, i) {
      var r = rec && rec.scenarios[s.id], reals = realOf(s.id);
      var played = reals.filter(function (x) { return rec && rec.scenarios[x.id]; }).length;
      return '<li><button type="button" data-start="' + esc(s.id) + '"><span class="n">' + (i + 1) + '</span><span class="t">' + esc(s.title) + '</span>' +
        '<span class="b' + (r ? " done" : "") + '">' + (r ? esc(E.letter(r.best)) : "New") + '</span><span class="s">' +
        esc(ord(s.context.down) + " and " + (s.context.distance <= 3 ? "short" : s.context.distance >= 8 ? "long" : "medium") + " · " + s.defense.shell.replace("-", " ") + " · " + D.defenses[s.actual.call].name) + "</span></button>" +
        (reals.length ? '<button type="button" class="real-btn" data-real="' + esc(s.id) + '"><span class="logos">' + reals.slice(0, 8).map(function (x) { return logo(x.real.off, 18); }).join("") +
          '</span><span>' + reals.length + " real snaps" + (played ? " · " + played + " played" : "") + " \u2192</span></button>" : "") + "</li>";
    }).join("");
    $("module").innerHTML = '<h2>Lessons: pressure, coverage and the box</h2>' +
      '<p>Nine looks every quarterback has to beat: nickel pressure and its bluff, man and zero pressure, quarters, the post-snap rotation, simulated pressure, 2-Man on third and long, and an eight-man box. Learn each one, then call it on real NFL snaps from 2023 to 2025.</p>' +
      '<ul class="scen-list">' + items + '</ul><button type="button" class="primary" id="go">' + (rec ? "Play your next rep" : "Start") + " →</button>";
    renderFilm(rec);
    var rep = E.report(rec, D);
    $("report").innerHTML = '<h2 id="report-h">Your read report</h2>' + (rec ? rep.tags.map(function (t) {
      return '<div class="meter"><span>' + esc(t.label) + '</span><span class="bar" role="img" aria-label="' + esc(t.label + ": " + (t.level == null ? "not practiced yet" : t.level + " out of 100")) + '"><i style="width:' + (t.level || 0) + '%"></i></span><b>' + (t.level == null ? "—" : t.level) + "</b></div>";
    }).join("") + (rep.errors.length ? '<p class="errs">Most common miss: ' + esc(rep.errors[0].label) + " (" + rep.errors[0].count + "×). The next scenario is picked to work on it.</p>" : "")
      : '<p class="empty">Play a scenario and this tracks how well you read each skill, process grades only, and what you miss most.</p>');
    $("go").onclick = function () { begin(E.next(pool, load(STORE, null), Date.now(), null)); };
    Array.prototype.forEach.call(document.querySelectorAll("[data-start]"), function (b) { b.onclick = function () { begin(b.getAttribute("data-start")); }; });
    Array.prototype.forEach.call(document.querySelectorAll("[data-real]"), function (b) {
      b.onclick = function () { begin(E.next({ scenarios: realOf(b.getAttribute("data-real")) }, load(STORE, null), Date.now(), null)); };
    });
  }

  var side = load(PREFS, {}).side === "defense" ? "defense" : "offense";
  function recId(id) { return side === "defense" ? "def:" + id : id; }

  /* ---------- film room: every real snap, filterable ---------- */
  var filters = load(PREFS, {}).film || {};
  // A stable shuffle, so the list mixes situations, seasons and teams instead of following the file's order.
  function mix(id) { var h = 2166136261; for (var i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return h >>> 0; }
  film.sort(function (a, b) { return mix(a.id) - mix(b.id); });
  function filmMatches() {
    return film.filter(function (s) {
      var r = s.real;
      return (!filters.sit || r.situation === filters.sit) && (!filters.pers || r.offPers === filters.pers) && (!filters.pkg || (filters.pkg === "dime" ? /dime|quarter/.test(r.pkg) : r.pkg === filters.pkg)) &&
        (!filters.kind || r.kind === filters.kind) && (!filters.team || r.off === filters.team || r.def === filters.team);
    });
  }
  function renderFilm(rec) {
    var box = $("film");
    if (!film.length) { box.hidden = true; return; }
    var count = function (f) { var m = {}; film.forEach(function (s) { var k = f(s.real); m[k] = (m[k] || 0) + 1; }); return m; };
    function select(id, label, opts) {
      return '<label class="flt"><span>' + label + '</span><select data-f="' + id + '"><option value="">All</option>' + opts.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (filters[id] === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>";
      }).join("") + "</select></label>";
    }
    var sits = Object.keys(window.SS_REAL.situations).map(function (k) { return [k, window.SS_REAL.situations[k]]; });
    var pc = count(function (r) { return r.offPers; }), pers = Object.keys(pc).sort(function (a, b) { return pc[b] - pc[a]; }).map(function (k) { return [k, k + " personnel"]; });
    var teams = Object.keys(window.SS_REAL.teams).sort(function (a, b) { return window.SS_REAL.teams[a].localeCompare(window.SS_REAL.teams[b]); }).map(function (k) { return [k, window.SS_REAL.teams[k]]; });
    var list = filmMatches(), played = list.filter(function (s) { return rec && rec.scenarios[recId(s.id)]; }).length;
    box.innerHTML = '<h2>Film room' + (side === "defense" ? ": call the defense" : "") + '</h2><p>' + film.length + " real snaps from 2023 to 2025, every down and distance, every personnel group, runs and passes. " +
      (side === "defense" ? "You're the defensive coordinator: read their personnel, match it, call the pressure and coverage, and the real play runs against you." : "Pick a situation or a team, or let it deal you one.") + "</p>" +
      '<div class="flts">' + select("sit", "Situation", sits) + select("pers", "Your personnel", pers) +
      select("pkg", "Their package", [["heavy", "Goal line"], ["base", "Base"], ["nickel", "Nickel"], ["dime", "Dime"]]) + select("kind", "Real call", [["run", "Run"], ["pass", "Pass"]]) + select("team", "Team", teams) + "</div>" +
      '<p class="flt-count">' + list.length + " snap" + (list.length === 1 ? "" : "s") + " match" + (played ? " · " + played + " played" : "") + "</p>" +
      '<ul class="film-list">' + list.slice(0, 12).map(function (s) {
        var r = s.real, done = rec && rec.scenarios[recId(s.id)];
        return '<li><button type="button" data-start="' + esc(s.id) + '"><span class="fl-teams">' + logo(r.off, 20) + "<b>" + esc(r.off) + "</b><span>" + (r.home === r.off ? "vs" : "at") + "</span>" + logo(r.def, 20) + "<b>" + esc(r.def) + "</b></span>" +
          '<span class="fl-sit">' + esc(["", "1st", "2nd", "3rd", "4th"][r.down] + " & " + (r.yl100 <= r.dist ? "goal" : r.dist) + " · " + r.offPers + " vs " + r.pkg + " · " + (r.round || "Wk " + r.week) + " " + r.season) + "</span>" +
          '<span class="fl-grade' + (done ? " done" : "") + '">' + (done ? esc(E.letter(done.best)) : "") + "</span></button></li>";
      }).join("") + "</ul>" + (list.length ? '<button type="button" class="primary" id="deal">Deal me one \u2192</button>' : "");
    Array.prototype.forEach.call(box.querySelectorAll("select"), function (el) {
      el.onchange = function () { filters[el.getAttribute("data-f")] = el.value; var p = load(PREFS, {}); p.film = filters; save(PREFS, p); renderFilm(load(STORE, null)); };
    });
    Array.prototype.forEach.call(box.querySelectorAll("[data-start]"), function (b) { b.onclick = function () { begin(b.getAttribute("data-start")); }; });
    if ($("deal")) $("deal").onclick = function () {
      var pool = filmMatches(), fresh = pool.filter(function (s) { var r = load(STORE, null); return !(r && r.scenarios[recId(s.id)]); });
      var from = fresh.length ? fresh : pool;
      begin(from[Math.floor(Math.random() * from.length)].id);
    };
  }

  /* ---------- a snap ---------- */
  function onField(r) {
    return ["QB " + r.qb, "RB " + r.rb, "TE " + r.te, "WR " + r.wr.join(", ")].filter(function (x) { return !/ (null|undefined)$/.test(x); }).join(" · ");
  }
  function begin(id) {
    if (side === "defense" && by(film, id)) return beginDef(id);
    var sc = by(scenarios, id) || scenarios[0];
    st = { sc: sc, step: 0, answers: { rushers: [] }, pick: { motion: "none" }, seed: (Date.now() % 100000) + 1, snapped: false, recorded: false };
    var lesson = !sc.real ? sc : sc.lesson ? by(lessons, sc.lesson) : null;
    header(sc, lesson ? "Lesson " + (lessons.indexOf(lesson) + 1) + " of " + lessons.length + ": " + lesson.title + (sc.real ? " · real snap" : "") : "Film room · " + (window.SS_REAL.situations[sc.situation] || "") + " · real snap");
    drawField();
    renderStep();
    window.scrollTo(0, 0);
    $("scen-title").focus({ preventScroll: true });
  }
  function header(sc, where) {
    $("stage").classList.remove("snapped");
    if (st) st.card = null;
    fitSit();
    $("start").hidden = true; $("play").hidden = false; $("review").hidden = true; $("review").innerHTML = "";
    $("where").textContent = where;
    $("scen-title").innerHTML = sc.real ? logo(sc.real.off, 40) + esc(sc.title) + logo(sc.real.def, 40) : esc(sc.title);
    $("scen-sub").textContent = sc.real ? sc.subtitle : "";
    $("scen-sub").hidden = !sc.real;
    $("prov").innerHTML = "<b>" + esc(sc.type === "synthetic" ? "Synthetic" : "Real snap") + "</b><span>" + esc(sc.provenance.label) + "</span>";
    var c = sc.context;
    $("bug").innerHTML = (sc.real
      ? '<div class="team">' + logo(sc.real.off, 26) + '<span><small>' + esc(sc.real.off) + '</small><b>' + c.score.you + '</b></span></div><div class="team">' + logo(sc.real.def, 26) + '<span><small>' + esc(sc.real.def) + '</small><b>' + c.score.opp + '</b></span></div>'
      : '<div><small>You</small><b>' + c.score.you + '</b></div><div><small>Opp</small><b>' + c.score.opp + '</b></div>') +
      '<div><small>' + (c.quarter > 4 ? "OT" : "Q" + c.quarter) + '</small><b>' + esc(c.clock) + '</b></div><div class="down"><small>' + (c.side === "opp" ? "Opp " : "Own ") + c.yardLine + '</small><b>' + ord(c.down) + " &amp; " + c.distance + "</b></div>";
  }

  function positions() {
    var pos = {}, sc = st.sc, m = by(sc.motions, st.pick.motion);
    sc.offense.players.concat(sc.defense.players).forEach(function (p) { pos[p.id] = [p.x, p.y]; });
    if (m && m.path && (st.step > 1 || st.motionShown)) {
      if (!m.path.back) pos[m.path.from] = m.path.to;
      Object.keys(m.moves || {}).forEach(function (id) { pos[id] = m.moves[id]; });
    }
    if (st.snapped) Object.keys(sc.actual.post).forEach(function (id) { pos[id] = [sc.actual.post[id].x, sc.actual.post[id].y]; });
    if (st.motionMid) pos[m.path.from] = m.path.to; // yo-yo motion, mid-trip
    return pos;
  }

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function drawField() {
    var sc = st.sc, svg = $("field"), c = sc.context;
    while (svg.lastChild && svg.lastChild.id !== "field-title") svg.removeChild(svg.lastChild);
    var defs = el("defs", {}, svg);
    var mk = el("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0 0L10 5L0 10z", fill: "#F7D23E" }, mk);
    var mk2 = el("marker", { id: "arrow-d", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0 0L10 5L0 10z", fill: "#FF7A6B" }, mk2);
    el("rect", { x: 0, y: 0, width: 533, height: 300, fill: "#123A2A" }, svg);
    // Five-yard lines, numbered like the real field from this spot.
    for (var k = -9; k <= 20; k++) {
      var abs = c.side === "opp" ? c.yardLine - k : c.yardLine + k; // yard line number going downfield
      var num = abs > 50 ? 100 - abs : abs;
      if (num % 5 !== 0 || num <= 0) continue;
      el("line", { x1: 0, x2: 533, y1: sy(k), y2: sy(k), stroke: "rgba(241,244,236,.22)", "stroke-width": num % 10 === 0 ? 1.6 : 1 }, svg);
      if (num % 10 === 0) ["left", "right"].forEach(function (side) {
        var t = el("text", { x: side === "left" ? 22 : 511, y: sy(k) + 4, "text-anchor": "middle", fill: "rgba(241,244,236,.32)", "font-size": 13, "font-family": "Saira Extra Condensed, sans-serif", "font-weight": 700 }, svg);
        t.textContent = num;
      });
    }
    for (var y = -9; y <= 20; y++) [23.58, 29.73].forEach(function (hx) {
      el("line", { x1: sx(hx) - 3, x2: sx(hx) + 3, y1: sy(y), y2: sy(y), stroke: "rgba(241,244,236,.28)", "stroke-width": 1 }, svg);
    });
    if (c.side === "opp" && c.yardLine <= 20) { // the end zone, when it's on screen
      el("rect", { x: 0, y: 0, width: 533, height: Math.max(0, sy(c.yardLine)), fill: "rgba(95,168,255,.10)" }, svg);
      el("line", { x1: 0, x2: 533, y1: sy(c.yardLine), y2: sy(c.yardLine), stroke: "rgba(241,244,236,.75)", "stroke-width": 3 }, svg);
      if (c.yardLine + 10 <= 20) el("line", { x1: 0, x2: 533, y1: sy(c.yardLine + 10), y2: sy(c.yardLine + 10), stroke: "rgba(241,244,236,.5)", "stroke-width": 2 }, svg);
      var ez = el("text", { x: 266, y: Math.max(14, sy(c.yardLine + 5) + 6), "text-anchor": "middle", "font-size": 18, fill: "rgba(241,244,236,.28)", "font-family": "Saira Extra Condensed, sans-serif", "font-weight": 800, "letter-spacing": "6" }, svg);
      ez.textContent = "END ZONE";
    }
    el("line", { x1: 0, x2: 533, y1: sy(0), y2: sy(0), stroke: "#5FA8FF", "stroke-width": 2 }, svg);
    if (c.distance <= 20 && !(c.side === "opp" && c.distance >= c.yardLine)) el("line", { x1: 0, x2: 533, y1: sy(c.distance), y2: sy(c.distance), stroke: "#F7D23E", "stroke-width": 2 }, svg);
    el("g", { id: "f-zones", class: "over" }, svg);
    el("g", { id: "f-routes", class: "routes" }, svg);
    el("g", { id: "f-rush", class: "over" }, svg);
    var pl = el("g", { id: "f-players" }, svg);
    var labels = load(PREFS, {}).labels !== false;
    $("labels").checked = labels;
    sc.offense.players.forEach(function (p) {
      var g = el("g", { class: "pl off", "data-id": p.id }, pl);
      el("circle", { class: "body", r: 10.5, fill: "#EEF2F5", stroke: "#0D1821", "stroke-width": 1.5 }, g);
      var t = el("text", { class: "lab", y: 3.6, "text-anchor": "middle", "font-size": p.label.length > 2 ? 8 : p.label.length > 1 ? 9.5 : 11, "font-weight": 700, fill: "#0D1821", "font-family": "Saira, sans-serif" }, g);
      t.textContent = p.label;
    });
    (st.hideD ? [] : sc.defense.players).forEach(function (p) {
      var g = el("g", { class: "pl def", "data-id": p.id, tabindex: -1, role: "checkbox", "aria-checked": "false", "aria-label": p.role }, pl);
      el("circle", { class: "ring", r: 15, fill: "none", stroke: "#F7D23E", "stroke-width": 2.5, "stroke-dasharray": "4 3" }, g);
      el("rect", { class: "body", x: -10, y: -10, width: 20, height: 20, rx: 3, fill: "#FF7A6B", stroke: "#0D1821", "stroke-width": 1.5 }, g);
      var t = el("text", { class: "lab", y: 3.6, "text-anchor": "middle", "font-size": p.label.length > 2 ? 8 : p.label.length > 1 ? 9.5 : 11, "font-weight": 700, fill: "#0D1821", "font-family": "Saira, sans-serif" }, g);
      t.textContent = p.label;
      g.addEventListener("click", function () { if (st.step === 0 && !st.snapped && st.side !== "defense") toggleRusher(p.id); });
      g.addEventListener("keydown", function (e) { if ((e.key === " " || e.key === "Enter") && st.step === 0 && !st.snapped) { e.preventDefault(); toggleRusher(p.id); } });
    });
    el("circle", { cx: sx(ballX()), cy: sy(0) + 3, r: 3, fill: "#8C4A26" }, svg);
    setLabels(labels);
    place(true);
  }

  function setLabels(on) {
    if (st) st.labels = on;
    Array.prototype.forEach.call($("field").querySelectorAll(".def .lab"), function (t) { t.style.display = on ? "" : "none"; });
  }

  function place(instant) {
    var pos = positions();
    Array.prototype.forEach.call($("field").querySelectorAll(".pl"), function (g) {
      var id = g.getAttribute("data-id"), p = pos[id];
      if (instant) { g.style.transition = "none"; }
      g.style.transform = "translate(" + sx(p[0]) + "px," + sy(p[1]) + "px)";
      if (instant) { g.getBoundingClientRect(); g.style.transition = ""; }
      var isDef = g.classList.contains("def");
      if (isDef) {
        var sel = st.answers.rushers.indexOf(id) >= 0;
        g.classList.toggle("sel", sel && !st.snapped);
        g.setAttribute("aria-checked", sel ? "true" : "false");
        var pick = st.step === 0 && !st.snapped && st.side !== "defense";
        g.classList.toggle("pick", pick);
        g.setAttribute("tabindex", pick ? 0 : -1);
      }
    });
    fieldText(pos);
  }

  function fieldText(pos) {
    var sc = st.sc;
    function line(p) {
      var q = pos[p.id], side = q[0] < 26.65 ? "left" : "right";
      var depth = Math.abs(q[1]) < 0.6 ? "on the line" : Math.round(Math.abs(q[1])) + (q[1] > 0 ? " yards downfield" : " yards deep");
      return "<li>" + esc(p.role) + ": " + Math.round(Math.abs(q[0] - 26.65)) + " yards " + side + " of center, " + depth + "</li>";
    }
    $("field-text").innerHTML = "<p><b>" + (st.snapped ? "After the snap" : "Before the snap") + ".</b> The ball is on the " + esc(sc.context.hash) + " hash.</p>" +
      "<b>Offense</b><ul>" + sc.offense.players.map(line).join("") + "</ul><b>Defense</b><ul>" + sc.defense.players.map(line).join("") + "</ul>";
  }

  function toggleRusher(id) {
    var r = st.answers.rushers, i = r.indexOf(id);
    if (i >= 0) r.splice(i, 1); else r.push(id);
    place();
    var box = document.querySelector('input[name="rushers"][value="' + id + '"]');
    if (box) box.checked = i < 0;
    say(by(st.sc.defense.players, id).role + (i < 0 ? " marked" : " unmarked") + " as a possible rusher. " + r.length + " marked.");
    updateNav();
  }

  function routeLayer(play) {
    var g = $("f-routes"), pos = positions();
    while (g.lastChild) g.removeChild(g.lastChild);
    Array.prototype.forEach.call($("field").querySelectorAll(".off"), function (x) { x.classList.remove("hl"); });
    var m = by(st.sc.motions, st.pick.motion);
    if (m && m.path && st.step >= 1 && !st.snapped) {
      var a = by(st.sc.offense.players, m.path.from), pts = [[a.x, a.y], m.path.to];
      if (m.path.back) pts.push([a.x, a.y]);
      el("path", { d: "M" + pts.map(function (p) { return sx(p[0]) + " " + sy(p[1]); }).join("L"), fill: "none", stroke: "#8FD6B0", "stroke-width": 2, "stroke-dasharray": "2 4", "marker-end": "url(#arrow)" }, g);
    }
    if (!play) return;
    play.routes.forEach(function (r) {
      var p = pos[r.from], d = "M" + sx(p[0]) + " " + sy(p[1]) + r.path.map(function (q) { return "L" + sx(q[0]) + " " + sy(q[1]); }).join("");
      el("path", { d: d, fill: "none", stroke: "#F7D23E", "stroke-width": 2.5, "stroke-linejoin": "round", "marker-end": "url(#arrow)", opacity: .95 }, g);
      var who = $("field").querySelector('.off[data-id="' + r.from + '"]');
      if (who) who.classList.add("hl");
    });
  }

  /* ---------- the five steps ---------- */
  function radio(name, items, current, render) {
    return '<div class="opts">' + items.map(function (o) {
      return '<label class="opt"><input type="radio" name="' + name + '" value="' + esc(o.id) + '"' + (current === o.id ? " checked" : "") + "><span>" + (render ? render(o) : "<b>" + esc(o.label) + "</b>") + "</span></label>";
    }).join("") + "</div>";
  }
  function detail(o) { return "<b>" + esc(o.label) + "</b>" + (o.detail ? "<small>" + esc(o.detail) + "</small>" : ""); }

  // Their personnel stays hidden until you've read it yourself in step 1.
  function renderSit() {
    var sc = st.sc, c = sc.context, told = st.step > 0 || st.snapped;
    $("sit").innerHTML = [["Your personnel", sc.offense.personnelText + ". " + sc.offense.formation + "."],
      ["Their personnel", told ? sc.defense.personnelText + ". " + sc.defense.front + "." : "Count them yourself: that's question one."],
      ["The job", c.objective], ["Scouting report", c.scouting]].concat(sc.real && sc.real.qb ? [["On the field for the " + sc.teams.offName, onField(sc.real)]] : [])
      .map(function (x) { return "<div><dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + "</dd></div>"; }).join("");
  }
  // Rusher checklist: where each defender is, not what he is (that would answer question one).
  function spot(p) {
    var d = p.y <= 1.2 ? "on the line" : Math.round(p.y) + (Math.round(p.y) === 1 ? " yd deep" : " yds deep"), side = p.x < ballX() - 0.5 ? "left" : p.x > ballX() + 0.5 ? "right" : "middle";
    return d + ", " + side;
  }

  function renderStep() {
    if (st.side === "defense") return renderDefStep();
    var sc = st.sc, s = STEPS[st.step], f = $("step"), html = "";
    renderSit();
    $("steps").innerHTML = STEPS.map(function (x, i) { return "<li" + (i < st.step ? ' class="done"' : "") + (i === st.step ? ' aria-current="step"' : "") + ">" + x.label + "</li>"; }).join("");
    if (s.id === "diagnose") {
      html = "<h2>What are they showing you?</h2><p class=\"hint\">Read it before you call it. Nothing here is certain yet; answer with your best read of the evidence.</p>";
      sc.diagnosis.questions.forEach(function (q) {
        if (q.kind === "rushers") {
          html += '<fieldset><legend>' + esc(q.prompt) + ' <small class="hint">On the field or here.</small></legend><div class="opts chips">' + sc.defense.players.map(function (p) {
            return '<label class="opt"><input type="checkbox" name="rushers" value="' + esc(p.id) + '"' + (st.answers.rushers.indexOf(p.id) >= 0 ? " checked" : "") + "><span><b>" + esc(st.labels === false ? "#" + (sc.defense.players.indexOf(p) + 1) : p.label) + "</b><small>" + esc(spot(p)) + "</small></span></label>";
          }).join("") + "</div></fieldset>";
        } else html += "<fieldset><legend>" + esc(q.prompt) + '</legend><div class="opts row">' + radio(q.id, q.options, st.answers[q.id]).replace('<div class="opts">', "").replace(/<\/div>$/, "") + "</div></fieldset>";
      });
      html += '<fieldset><legend>How sure are you of that read?</legend><div class="opts row">' + radio("confidence", D.confidence, st.answers.confidence).replace('<div class="opts">', "").replace(/<\/div>$/, "") + "</div></fieldset>";
    } else if (s.id === "adjust") {
      var m = by(sc.motions, st.pick.motion);
      html = "<h2>Make them declare</h2><p class=\"hint\">Motion and shifts are questions you ask the defense. The answer is evidence, not proof.</p><fieldset><legend>Before the snap</legend>" + radio("motion", sc.motions, st.pick.motion, detail) + "</fieldset>";
      if (st.motionShown && m) html += '<div class="reveal-note" role="status"><b>' + (m.id === "none" ? "No motion" : "What it showed") + "</b>" + esc(m.text) + "</div>";
    } else if (s.id === "protect") {
      html = "<h2>Set the protection</h2><p class=\"hint\">Count them: who can come, who's blocking, and who's the quarterback's problem?</p><fieldset><legend>Protection</legend>" + radio("protection", sc.protections, st.pick.protection, detail) + "</fieldset>";
    } else if (s.id === "call") {
      var play = by(sc.plays, st.pick.play);
      html = "<h2>Call the play</h2><p class=\"hint\">The routes draw on the field as you pick.</p><fieldset><legend>Play</legend>" + radio("play", sc.plays, st.pick.play, function (o) {
        return "<b>" + esc(o.label) + "</b><small>" + esc(D.concepts[o.concept].family + ". " + o.detail) + "</small>";
      }) + "</fieldset>";
      if (play) html += "<fieldset><legend>On this call, whose reaction decides where the ball goes?</legend>" + '<div class="opts chips">' + sc.defense.players.map(function (p) {
        return '<label class="opt"><input type="radio" name="key" value="' + esc(p.id) + '"' + (st.pick.key === p.id ? " checked" : "") + "><span><b>" + esc(p.label) + "</b><small>" + esc(p.role.split(",")[0]) + "</small></span></label>";
      }).join("") + "</div></fieldset>";
    } else if (s.id === "answer") {
      html = "<h2>If it goes wrong</h2><p class=\"hint\">Decide now what happens if a rusher comes free. After the snap there's no time.</p><fieldset><legend>Your answer</legend>" + radio("contingency", sc.contingencies, st.pick.contingency) + "</fieldset>";
    }
    html += '<div class="nav">' + '<button type="button" class="ghost" id="back">← Back</button>' +
      '<span class="need" id="need"></span><button type="submit" class="primary" id="next">' + (st.step === STEPS.length - 1 ? "Snap it" : "Next →") + "</button></div>";
    f.innerHTML = html;
    if ($("back")) $("back").onclick = function () {
      if (cardBack() || !st.step) return;
      st.step--; st.card = 99; renderStep(); place(); routeLayer(by(sc.plays, st.pick.play));
    };
    routeLayer(st.step >= 3 ? by(sc.plays, st.pick.play) : null);
    place();
    updateNav();
    cards();
  }

  /* ---------- phones: one question at a time, the field locked above ---------- */
  function sets() { return Array.prototype.slice.call($("step").querySelectorAll("fieldset")); }
  function answered(set) { return !!set.querySelector("input:checked"); }
  function lastStep() { return st.step === (st.side === "defense" ? DSTEPS : STEPS).length - 1; }
  function cards() {
    var f = $("step"), list = sets(), old = f.querySelector(".card-progress");
    if (old) old.parentNode.removeChild(old);
    var on = phone.matches && !st.snapped && list.length > 1;
    f.classList.toggle("cards", on);
    if ($("back")) $("back").style.visibility = st.step > 0 || (on && st.card > 0) ? "" : "hidden";
    if (!on) { list.forEach(function (x) { x.classList.remove("on"); }); f.classList.remove("last"); return; }
    if (st.card == null) { st.card = 0; while (st.card < list.length - 1 && answered(list[st.card])) st.card++; }
    st.card = Math.max(0, Math.min(st.card, list.length - 1));
    list.forEach(function (x, i) { x.classList.toggle("on", i === st.card); });
    f.classList.toggle("last", st.card === list.length - 1);
    var prog = document.createElement("p");
    prog.className = "card-progress";
    prog.innerHTML = "<span>Question " + (st.card + 1) + " of " + list.length + "</span>" + list.map(function (x, i) { return '<i class="' + (i === st.card ? "now" : answered(x) ? "done" : "") + '"></i>'; }).join("");
    list[0].parentNode.insertBefore(prog, list[0]);
    // The rusher question is multi-select: it moves on when you say so.
    var cur = list[st.card];
    if (cur.querySelector('input[type="checkbox"]') && !cur.querySelector(".card-done")) {
      var done = document.createElement("button");
      done.type = "button"; done.className = "ghost card-done"; done.textContent = "Done \u2192";
      done.onclick = function () { if (answered(cur)) advance(); else say("Tap at least one defender."); };
      cur.appendChild(done);
    }
  }
  // After an answer on a phone: the next question, then the next step. The snap always waits for a tap.
  function advance() {
    if (!phone.matches || st.snapped) return;
    var list = sets();
    if ($("step").classList.contains("cards") && st.card < list.length - 1) {
      st.card++;
      cards();
      var lg = list[st.card].querySelector("legend"); if (lg) { lg.tabIndex = -1; lg.focus({ preventScroll: true }); }
      return;
    }
    if (!lastStep() && !missing()) $("step").requestSubmit ? $("step").requestSubmit() : $("next").click();
  }
  function afterAnswer(name) {
    if (!phone.matches || name === "rushers" || name === "motion") return;
    setTimeout(advance, reduce ? 0 : 260);
  }
  function cardBack() {
    if (!$("step").classList.contains("cards") || !st.card) return false;
    st.card--; cards();
    return true;
  }
  if (phone.addEventListener) phone.addEventListener("change", function () { if (st && !st.snapped) { cards(); fitSit(); } });
  function fitSit() { var w = $("sitwrap"); if (w) w.open = !phone.matches; }

  function missing() {
    if (st.side === "defense") return defMissing();
    var a = st.answers, p = st.pick, s = STEPS[st.step].id;
    if (s === "diagnose") {
      var left = st.sc.diagnosis.questions.filter(function (q) { return q.kind === "rushers" ? !a.rushers.length : !a[q.id]; }).length + (a.confidence ? 0 : 1);
      return left ? left + " to answer" : "";
    }
    if (s === "protect") return p.protection ? "" : "Pick a protection";
    if (s === "call") return !p.play ? "Pick a play" : !p.key ? "Pick the key defender" : "";
    if (s === "answer") return p.contingency ? "" : "Pick your answer";
    return "";
  }
  function updateNav() {
    var m = missing();
    if ($("need")) $("need").textContent = m;
    if ($("next")) $("next").disabled = !!m;
  }

  $("step").addEventListener("change", function (e) {
    if (st.side === "defense") return defChange(e.target);
    var t = e.target, n = t.name, sc = st.sc;
    if (n === "rushers") { toggleRusher(t.value); return; }
    if (n === "motion") {
      st.pick.motion = t.value; st.motionShown = true;
      renderStep();
      // A yo-yo motion goes to its spot and comes back; the defense's reaction stays on the field.
      var m = by(sc.motions, t.value);
      if (m.path && m.path.back && !reduce) {
        st.motionMid = true; place();
        setTimeout(function () { st.motionMid = false; place(); }, 900);
      }
      say(m.text);
      return;
    }
    if (n === "confidence" || sc.diagnosis.questions.some(function (q) { return q.id === n; })) st.answers[n] = t.value;
    else if (n === "play") { st.pick.play = t.value; st.pick.key = null; renderStep(); var q = $("step").querySelector('input[name="play"]:checked'); if (q) q.focus({ preventScroll: true }); afterAnswer(n); return; }
    else st.pick[n] = t.value;
    updateNav();
    afterAnswer(n);
  });
  $("step").addEventListener("submit", function (e) {
    e.preventDefault();
    if (st.side === "defense") return defSubmit();
    if (missing()) return;
    if (st.step < STEPS.length - 1) {
      st.step++; st.card = null;
      renderStep();
      focusStep();
      return;
    }
    snap();
  });
  $("labels").addEventListener("change", function () { var p = load(PREFS, {}); p.labels = this.checked; save(PREFS, p); setLabels(this.checked); if (st && st.step === 0 && !st.snapped && st.side !== "defense") renderStep(); });
  $("prov").onclick = function () { this.classList.toggle("open"); };
  $("quit").onclick = function () { clearTimeout(reviewTimer); reviewTimer = null; $("play").hidden = true; $("start").hidden = false; renderStart(); window.scrollTo(0, 0); };

  /* ---------- the snap and the review ---------- */
  function unlock() {
    $("stage").classList.add("snapped");
    $("step").classList.remove("cards");
    if (phone.matches) $("stage").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }
  function snap() {
    var sc = st.sc;
    st.snapped = true;
    unlock();
    routeLayer(null);
    place();
    drawPost();
    Array.prototype.forEach.call($("step").querySelectorAll("input,button"), function (x) { x.disabled = true; });
    $("steps").innerHTML = STEPS.map(function (x) { return '<li class="done">' + x.label + "</li>"; }).join("");
    later(function () { renderReview(true); });
  }

  function drawPost() {
    var sc = st.sc, rush = $("f-rush"), zones = $("f-zones"), pre = {};
    var m = by(sc.motions, st.pick.motion);
    sc.defense.players.forEach(function (p) { pre[p.id] = (m && m.moves && m.moves[p.id]) || [p.x, p.y]; });
    while (rush.lastChild) rush.removeChild(rush.lastChild);
    while (zones.lastChild) zones.removeChild(zones.lastChild);
    sc.defense.players.forEach(function (p) {
      var a = pre[p.id], b = sc.actual.post[p.id], rusher = sc.actual.rushers.indexOf(p.id) >= 0;
      if (rusher) el("path", { d: "M" + sx(a[0]) + " " + sy(a[1]) + "L" + sx(b.x) + " " + sy(b.y + 0.9), stroke: "#FF7A6B", "stroke-width": 2.5, fill: "none", "marker-end": "url(#arrow-d)" }, rush);
      else if (Math.hypot(a[0] - b.x, a[1] - b.y) > 1.5) el("path", { d: "M" + sx(a[0]) + " " + sy(a[1]) + "L" + sx(b.x) + " " + sy(b.y), stroke: "#FF7A6B", "stroke-width": 1.5, "stroke-dasharray": "4 4", fill: "none", opacity: .8 }, rush);
      if (b.zone) {
        el("ellipse", { cx: sx(b.x), cy: sy(b.y), rx: 40, ry: 22, fill: "rgba(255,122,107,.10)", stroke: "rgba(255,122,107,.45)", "stroke-width": 1 }, zones);
        var t = el("text", { x: sx(b.x), y: sy(b.y) - 16, "text-anchor": "middle", "font-size": 10.5, fill: "#FFD0C9", "font-family": "Saira, sans-serif", "font-weight": 600 }, zones);
        t.textContent = b.zone.split(" (")[0];
      }
    });
    var cov = el("text", { x: 266, y: 16, "text-anchor": "middle", "font-size": 15, fill: "#F7D23E", "font-family": "Saira Extra Condensed, sans-serif", "font-weight": 800, "letter-spacing": ".5" }, rush);
    cov.textContent = sc.actual.pressure === "run" ? "Run · " + sc.actual.coverage : (sc.actual.pressure === "four" ? "4-man rush" : sc.actual.pressure === "five" ? "5-man pressure" : "6+ pressure") + " · " + sc.actual.coverage;
    requestAnimationFrame(function () { rush.classList.add("on"); zones.classList.add("on"); });
  }

  function gradeClass(l) { return "g-" + l.charAt(0); }

  function renderReview(first) {
    var sc = st.sc, rv = E.review(sc, st.pick, st.answers, st.seed), rep = rv.rep, box = $("review");
    if (first && !st.recorded) { save(STORE, E.record(load(STORE, null), sc, rv, Date.now())); st.recorded = true; }
    var good = rep.firstDown || rep.touchdown, bad = rep.kind === "sack" || rep.kind === "int";
    var resultText = rep.timeline[rep.timeline.length - 1].text;
    var G = [["diagnosis", "Diagnosis", "process"], ["call", "Call", "process"], ["protection", "Protection", "process"], ["contingency", "Answer", "process"], ["execution", "Execution", "outcome"], ["result", "Result", "outcome"]];
    var motion = by(sc.motions, st.pick.motion), def = D.defenses[sc.actual.call], concept = D.concepts[rv.choices.play.concept];
    var clues = sc.clues.slice();
    if (motion && motion.clue) clues.unshift({ text: motion.clue, kind: "meaningful" });
    var e = rv.expected;
    var html =
      '<p class="result-line ' + (good ? "good" : bad ? "bad" : "") + '" id="result-line" tabindex="-1">' + esc(resultText) + "</p>" +
      '<p class="verdict"><b>' + esc(rv.verdict.title) + ".</b>" + esc(rv.verdict.text) + "</p>" +
      '<div class="grades">' + G.map(function (g) {
        var l = rv.letters[g[0]];
        return '<div class="grade ' + g[2] + " " + gradeClass(l) + '"><b>' + esc(l) + "</b><small>" + g[1] + "</small></div>";
      }).join("") + '</div><p class="grade-key"><span><i style="background:var(--mint)"></i>Process: your decisions (' + rv.process + "/100)</span><span><i style=\"background:var(--orange)\"></i>Outcome: this one rep</span></p>" +
      '<div class="odds"><p>Run this exact call 400 times and it ' + verb(e) + " <b>" + pct(rate(e)) + "</b> of the time, averaging <b>" + e.avgYards.toFixed(1) + " yards</b>" +
      (e.turnover >= 0.005 ? ", with an interception " + pct(e.turnover) + " of the time" : "") + (e.sack >= 0.005 ? " and a sack " + pct(e.sack) : "") + ".</p>" +
      '<button type="button" class="ghost" id="again">Run this rep again</button></div>' +

      (sc.real ? reality(sc, rv) : "") +
      sec(1, "Your read", '<ul class="qlist">' + rv.diagnosis.items.map(function (i) {
        var cls = i.credit >= 90 ? "ok" : i.credit >= 50 ? "part" : "no";
        return '<li><div class="q"><span>' + esc(i.prompt) + '</span><span class="pill ' + cls + '">' + (cls === "ok" ? "Right" : cls === "part" ? "Partly" : "Missed") + '</span></div><div class="ans">You: ' + esc(i.yours) + (i.credit < 90 ? " · Best read: " + esc(i.correct) : "") + "</div>" +
          (i.note ? '<div class="ex">' + esc(i.note) + "</div>" : "") + '<div class="ex">' + esc(i.explain) + "</div></li>";
      }).join("") + "</ul>" + (rv.diagnosis.calibration.text ? '<p class="calib">' + esc(rv.diagnosis.calibration.text) + "</p>" : "")) +

      sec(2, "What the defense actually did", "<p><b>" + esc(def.name) + ".</b> " + esc(def.plain) + "</p><p>" + esc(sc.actual.rotation) + "</p>" +
        "<p><b>Rushed:</b> " + esc(sc.actual.rushers.map(roleOf).join(", ")) + ". <b>Dropped:</b> " + esc((sc.actual.droppers || []).map(roleOf).join(", ") || "none") + ".</p>" +
        "<p><b>Where it's soft:</b> " + esc(def.vulnerable.join("; ")) + ".</p>") +

      sec(3, "What mattered", '<ul class="clues">' + clues.map(function (c) {
        return '<li><span class="pill ' + c.kind + '">' + ({ meaningful: "Meaningful", deceptive: "Deceptive", uncertain: "Uncertain" })[c.kind] + "</span><span>" + esc(c.text) + "</span></li>";
      }).join("") + "</ul>") +

      sec(4, "Your call: " + rv.choices.play.label, "<p>" + esc(concept.plain) + "</p><p><b>Against this defense:</b> " + esc(rv.choices.play.why) + "</p>" +
        "<p><b>Key defender.</b> " + esc(rv.key.note) + "</p><p><b>Protection.</b> " + esc(rv.choices.protection.why) + "</p><p><b>Your answer.</b> " + esc(rv.choices.contingency.why) + "</p>" +
        (rep.notes.length ? '<ul class="notes">' + rep.notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>" : "")) +

      sec(5, "Who needed to hold up", '<div class="cards">' + rep.cards.map(function (c) {
        return '<div class="acard ' + (c.held ? "held" : "fail") + '"><span class="tag">' + (c.source === "protection" ? "Protection" : "The call") + (c.critical ? " · must hold up" : "") + "</span><h4>" + esc(c.role) + "<span>" + (c.held ? "✓ Held up" : "✗ Didn't") + "</span></h4>" +
          "<p><b>Job:</b> " + esc(c.assignment) + "</p><p><b>Against:</b> " + esc(c.keyRole) + "</p><p><b>" + (c.held ? "Won:" : "Lost:") + "</b> " + esc(c.held ? c.win : c.fail) + "</p>" +
          (c.source === "concept" ? "<p><b>Odds:</b> " + pct(c.p) + "</p>" : "") + "</div>";
      }).join("") + "</div>") +

      sec(6, "Where it turned", '<ol class="timeline">' + rep.timeline.map(function (t) { return "<li><time>" + t.t.toFixed(1) + "s</time>" + esc(t.text) + "</li>"; }).join("") + "</ol>" +
        '<p class="decisive"><b>Why:</b> ' + esc(rep.decisive) + "</p>") +

      sec(7, "The other calls", "<p>Each one run 300 times with the best protection and answer for it, so the comparison is about the call.</p>" + '<ul class="alts">' + rv.alternatives.map(function (a) {
        return '<li class="' + (a.yours ? "yours" : "") + '"><div class="head"><span class="pill ' + (a.category === "poor" ? "no" : a.category === "recommended" ? "ok" : "part") + '">' + esc(a.categoryLabel) + "</span><b>" + esc(a.label) + "</b>" + (a.yours ? '<span class="pill uncertain">Your call</span>' : "") +
          '<span class="stats">' + pct(rate(a.odds)) + " " + short(a.odds) + " · " + a.odds.avgYards.toFixed(1) + " yds" + (a.odds.turnover >= 0.005 ? " · " + pct(a.odds.turnover) + " INT" : "") + "</span></div><p>" + esc(a.why) + (lessonData(sc, a.id) ? " " + esc(lessonData(sc, a.id)) : "") + "</p></li>";
      }).join("") + "</ul>") +

      sec(8, "Next time", "<p>" + esc(sc.next) + "</p>") +
      '<div class="takeaway"><small>Takeaway</small><p>' + esc(sc.takeaway) + "</p></div>" +
      '<div class="after"><button type="button" class="primary" id="next-scen">Next scenario →</button><button type="button" class="ghost" id="replay">Call this one again</button><button type="button" class="ghost" id="home">Back to start</button></div>';
    box.innerHTML = html;
    box.hidden = false;
    $("again").onclick = function () { st.seed = (st.seed * 48271) % 2147483647 || 7; renderReview(false); say("New rep. " + $("result-line").textContent); };
    $("next-scen").onclick = function () { begin(E.next(pool, load(STORE, null), Date.now(), sc.id)); };
    $("replay").onclick = function () { begin(sc.id); };
    $("home").onclick = function () { $("quit").click(); };
    if (first) {
      $("result-line").focus({ preventScroll: true });
      box.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }
  function reality(sc, rv) {
    var r = sc.real, chip = function (k) { return '<span class="pill ' + (k === "Verified" ? "ok" : k === "Charted" ? "uncertain" : "part") + '">' + k + "</span>"; };
    var res = r.td ? "Touchdown" : r.result === "int" ? "Intercepted" : r.result === "sack" ? "Sacked" : r.result === "incomplete" ? "Incomplete" : r.yards + (r.yards === 1 ? " yard" : " yards") + (r.first ? ", first down" : "");
    var rows = [
      ["Verified", "Result", res + ". Expected points added: " + (r.epa > 0 ? "+" : "") + r.epa.toFixed(2) + "."],
      ["Verified", "The play", r.desc],
      r.kind === "run" ? ["Verified", "The run", (r.rusher || "The back") + " ran " + (r.runLoc === "middle" ? "up the middle" : "to the " + (r.runLoc || "line")) + (r.runGap ? ", through the " + r.runGap + " area" : "") + "."] :
      ["Charted", "The throw", (r.target ? r.passer + " targeted " + r.target + (r.route ? " on a " + r.route.toLowerCase() + " route" : "") : r.passer + " threw it") + (r.ttt ? ", " + r.ttt.toFixed(1) + "s after the snap" : "") + "." + (r.playAction ? " Play action." : "") + (r.motion ? " Motion before the snap." : "")],
      r.kind === "run" ? ["Charted", "The defense", (r.box ? r.box + " in the box" : "Box not charted") + (r.coverage ? ", " + r.coverage + " behind it" : "; coverage isn't charted on runs") + ". Personnel: " + r.pkg + "."] :
      ["Charted", "The defense", (r.rushers || 0) + " rushers, " + (r.blitzers || 0) + " of them blitzers, " + r.coverage + (r.manZone ? " (" + r.manZone + ")" : "") + (r.box ? ", " + r.box + " in the box" : "") + ". " + (r.pressure ? "The quarterback was pressured." : "No pressure on the quarterback.")],
      ["Reconstructed", "The drawing", sc.lesson ? "Which defenders rushed and where everyone lined up come from the lesson, not from charting." : "Built from the charted personnel, formation, box count, rush and coverage. Exact spots and which defenders rushed aren't charted."]
    ];
    var yourOdds = Math.round(rate(rv.expected) * 100);
    return sec("\u2605", "What really happened", '<ul class="real-facts">' + rows.map(function (x) { return "<li>" + chip(x[0]) + "<b>" + esc(x[1]) + "</b><span>" + esc(x[2]) + "</span></li>"; }).join("") + "</ul>" +
      "<p>Your call " + verb(rv.expected) + " " + yourOdds + "% of the time against what this defense did. The real call " + (r.epa > 0 ? "worked (it added expected points)" : "didn't work (it lost expected points)") + ", once. One snap is evidence, not a verdict: a real call isn't right because it happened, and it isn't wrong because it failed.</p>", true);
  }
  // Third and fourth down count conversions; earlier downs count the game's success rule (4 yards on 1st and 10, and so on).
  function late() { return st.sc.context.down >= 3; }
  function rate(o) { return late() ? o.convert : o.success; }
  function verb(o) { return late() ? "converts" : "gains " + o.need + "+ yards"; }
  function short(o) { return late() ? "convert" : o.need + "+ yds"; }
  // Lessons are hand-graded; show what the real data says about the same kind of call next to it.
  function lessonData(sc, playId) {
    if (sc.module === "film-room" || !window.SS_GEN) return null;
    var p = by(sc.plays, playId), c = sc.context, def = D.defenses[sc.actual.call];
    var r = { down: c.down, dist: c.distance, yl100: c.side === "opp" ? c.yardLine : 100 - c.yardLine, box: sc.defense.boxCount, offPers: sc.offense.personnel || "11", ol: 5, fb: 0 };
    return window.SS_GEN.dataLine(p.concept, r, def && def.group, sc.defense.boxCount);
  }
  // On phones the review sections fold up (headline, grades and takeaway stay out), so it fits in a couple of screens.
  function sec(n, title, body, open) {
    if (phone.matches) return '<details class="sec"' + (open ? " open" : "") + "><summary><h3><span>" + n + "</span>" + esc(title) + "</h3></summary>" + body + "</details>";
    return '<section class="sec"><h3><span>' + n + "</span>" + esc(title) + "</h3>" + body + "</section>";
  }
  function roleOf(id) { var p = by(st.sc.defense.players, id); return p ? p.role.split(",")[0].toLowerCase() : id; }

  /* ---------- defensive coordinator mode (defense.js does the football) ---------- */
  var F = window.SS_DEF;
  var DSTEPS = [{ id: "read", label: "Read" }, { id: "personnel", label: "Personnel" }, { id: "pressure", label: "Pressure" }, { id: "coverage", label: "Coverage" }, { id: "takeaway", label: "Take away" }];
  var AREA_NAME = { run: "run", quick: "quick game and screens", middle: "intermediate middle", deep: "deep shots" };
  /* Defense-side lessons: hand-written teaching, grades from defense.js (scenarios.js defenseLessons). */
  var dlessons = (D.defenseLessons || []).slice().sort(function (a, b) { return a.order - b.order; });
  var dproblems = V.validateDefense ? V.validateDefense(D, F) : [];
  if (dproblems.length) { if (window.console) console.error("Defense lesson problems", dproblems); dlessons = []; }
  function dlessonSnaps(id) { return film.filter(function (s) { return s.dlesson === id; }); }
  function lessonReal(L) {
    return Object.assign({ id: L.id, off: "OFF", def: "DEF", home: "OFF", season: 2026, week: 1, gameId: "synthetic", playId: 0, result: L.snap.kind === "run" ? "run" : "complete", epa: 0, yards: 0, tendency: {} }, L.snap);
  }
  function renderDefLessons(rec) {
    var box = $("dmodule");
    box.hidden = side !== "defense" || !dlessons.length;
    if (box.hidden) return;
    box.innerHTML = "<h2>Defense lessons</h2><p>Five situations every coordinator has to win: matching personnel, playing the sticks, the empty set, the goal line and the two-minute drill. Learn each, then call it on real NFL snaps.</p>" +
      '<ul class="scen-list">' + dlessons.map(function (L, i) {
        var r = rec && rec.scenarios["def:" + L.id], reals = dlessonSnaps(L.id), played = reals.filter(function (x) { return rec && rec.scenarios["def:" + x.id]; }).length;
        return '<li><button type="button" data-dstart="' + esc(L.id) + '"><span class="n">' + (i + 1) + '</span><span class="t">' + esc(L.title) + '</span><span class="b' + (r ? " done" : "") + '">' + (r ? esc(E.letter(r.best)) : "New") + '</span><span class="s">' +
          esc(ord(L.snap.down) + " & " + (L.snap.yl100 <= L.snap.dist ? "goal" : L.snap.dist) + " · " + L.snap.offPers + " personnel · " + L.context.objective) + "</span></button>" +
          (reals.length ? '<button type="button" class="real-btn" data-dreal="' + esc(L.id) + '"><span class="logos">' + reals.slice(0, 8).map(function (x) { return logo(x.real.off, 18); }).join("") + "</span><span>" + reals.length + " real snaps" + (played ? " · " + played + " played" : "") + " \u2192</span></button>" : "") + "</li>";
      }).join("") + '</ul><button type="button" class="primary" id="dgo">' + (rec ? "Play your next rep" : "Start") + " \u2192</button>";
    Array.prototype.forEach.call(box.querySelectorAll("[data-dstart]"), function (b) { b.onclick = function () { beginDef(b.getAttribute("data-dstart")); }; });
    Array.prototype.forEach.call(box.querySelectorAll("[data-dreal]"), function (b) { b.onclick = function () { beginDef(nextDef(dlessonSnaps(b.getAttribute("data-dreal")))); }; });
    $("dgo").onclick = function () {
      var rec2 = load(STORE, null), fresh = dlessons.filter(function (L) { return !(rec2 && rec2.scenarios["def:" + L.id]); });
      beginDef(fresh.length ? fresh[0].id : nextDef(film.filter(function (s) { return s.dlesson; }).concat(film)));
    };
  }
  // An unplayed snap from the pool if there is one, otherwise any.
  function nextDef(pool, skip) {
    var rec = load(STORE, null), fresh = pool.filter(function (s) { return !(rec && rec.scenarios["def:" + s.id]) && s.id !== skip; });
    var from = fresh.length ? fresh : pool;
    return from[Math.floor(Math.random() * from.length)].id;
  }
  function beginDef(id) {
    var L = by(dlessons, id), base, lesson = L;
    if (L) base = window.SS_GEN.build(D, window.SS_REAL, lessonReal(L));
    else { base = by(film, id); lesson = base.dlesson ? by(dlessons, base.dlesson) : null; }
    st = { side: "defense", base: base, r: base.real, lesson: lesson, synthetic: !!L, step: 0, answers: { rushers: [] }, call: {}, pick: { motion: "none" }, seed: (Date.now() % 100000) + 1, snapped: false, recorded: false, hideD: true };
    st.sc = F.view(D, window.SS_REAL, st.r, {});
    var where = lesson ? "Defense lesson " + (dlessons.indexOf(lesson) + 1) + " of " + dlessons.length + ": " + lesson.title + (L ? "" : " · real snap") : "Film room · " + (window.SS_REAL.situations[base.situation] || "") + " · you call the defense";
    header(base, where);
    if (L) {
      var sn = L.snap;
      $("scen-title").textContent = L.title;
      $("scen-sub").hidden = true;
      $("prov").innerHTML = "<b>Synthetic</b><span>" + esc(L.provenance.label) + "</span>";
      $("bug").innerHTML = '<div><small>Them</small><b>' + sn.offScore + '</b></div><div><small>You</small><b>' + sn.defScore + '</b></div><div><small>' + (sn.qtr > 4 ? "OT" : "Q" + sn.qtr) + "</small><b>" + esc(sn.clock) + '</b></div><div class="down"><small>' + (sn.yl100 <= 50 ? "Your " + sn.yl100 : "Their " + (100 - sn.yl100)) + "</small><b>" + ord(sn.down) + " &amp; " + (sn.yl100 <= sn.dist ? "Goal" : sn.dist) + "</b></div>";
    } else {
      $("prov").innerHTML = "<b>Real snap</b><span>You're the " + esc(base.teams.defName) + "' defensive coordinator. The offense's personnel, formation and the play they ran are real; your defense is drawn from your call.</span>";
    }
    drawField();
    renderDefStep();
    window.scrollTo(0, 0);
    $("scen-title").focus({ preventScroll: true });
  }
  function offenseLine(r) {
    var a = F.areaDist(r), n = F.offenseDist(r).n;
    return "From " + r.offPers + " personnel on " + (window.SS_REAL.situations[r.situation] || "this down").toLowerCase() + ", offenses ran it " + pct(a.run) + " of the time, threw quick " + pct(a.quick) + ", went to the intermediate middle " + pct(a.middle) + " and took deep shots " + pct(a.deep) + (n ? " (" + n.toLocaleString("en-US") + " snaps, 2023 to 2025)." : ".");
  }
  function renderSitDef() {
    var sc = st.base, r = st.r, c = sc.context, told = st.step > 0 || st.snapped, pk = F.PACKAGES.filter(function (p) { return p.id === st.call.pkg; })[0];
    $("sit").innerHTML = [["Their offense", told ? sc.offense.personnelText + ". " + sc.offense.formation + "." : "Count them yourself: that's question one."],
      ["Your defense", pk ? pk.label + ". " + pk.detail : "You pick it in step 2."],
      ["The job", r.down >= 3 ? "Get off the field: stop them short of the sticks." : r.yl100 <= 20 ? "Hold them to a field goal or less." : "Win the down: keep them under " + E.needYards(c) + " yards so they're behind schedule."],
      ["Scouting report", st.synthetic ? st.lesson.context.scouting : offenseLine(r)]].map(function (x) { return "<div><dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + "</dd></div>"; }).join("");
    if (st.synthetic) $("sit").querySelectorAll("dd")[2].textContent = st.lesson.context.objective;
  }
  // In a lesson, each option's small text is the lesson's reason for it, so it teaches as you pick.
  function why(kind, items) {
    var w = st.lesson && st.lesson.why[kind];
    return w ? items.map(function (o) { return Object.assign({}, o, { detail: w[o.id] || o.detail }); }) : items;
  }
  function renderDefStep() {
    var r = st.r, f = $("step"), s = DSTEPS[st.step], html = "", a = st.answers, c = st.call;
    renderSitDef();
    $("steps").innerHTML = DSTEPS.map(function (x, i) { return "<li" + (i < st.step ? ' class="done"' : "") + (i === st.step ? ' aria-current="step"' : "") + ">" + x.label + "</li>"; }).join("");
    if (s.id === "read") {
      var pers = ["10", "11", "12", "13", "21", "22"];
      if (pers.indexOf(r.offPers) < 0) pers.push(r.offPers);
      html = "<h2>Read the offense</h2><p class=\"hint\">Count their backs and tight ends, then think about what this personnel runs on this down.</p>" +
        '<fieldset><legend>What personnel are they in?</legend><div class="opts row">' + pers.map(function (p) { return '<label class="opt"><input type="radio" name="pers" value="' + p + '"' + (a.pers === p ? " checked" : "") + "><span><b>" + p + "</b><small>" + (+p[0]) + " back" + (p[0] === "1" ? "" : "s") + ", " + (+p[1]) + " TE</small></span></label>"; }).join("") + "</div></fieldset>" +
        "<fieldset><legend>What are they most likely to run?</legend>" + radio("likely", F.AREAS.map(function (x) { return { id: x.id, label: { run: "A run", quick: "A quick throw or screen", middle: "An intermediate throw", deep: "A deep shot" }[x.id] }; }), a.likely) + "</fieldset>" +
        '<fieldset><legend>How sure are you of that read?</legend><div class="opts row">' + radio("confidence", D.confidence, a.confidence).replace('<div class="opts">', "").replace(/<\/div>$/, "") + "</div></fieldset>";
    } else if (s.id === "personnel") {
      html = "<h2>Match their personnel</h2><p class=\"hint\">Your package sets the box count and who covers their receivers. Your defense draws on the field as you pick.</p><fieldset><legend>Your package</legend>" + radio("pkg", why("pkg", F.PACKAGES), c.pkg, detail) + "</fieldset>";
    } else if (s.id === "pressure") {
      html = "<h2>Call the pressure</h2><p class=\"hint\">How many come, and from where.</p><fieldset><legend>Pressure</legend>" + radio("pressure", why("pressure", F.PRESSURES), c.pressure, detail) + "</fieldset>";
    } else if (s.id === "coverage") {
      var pz = F.PRESSURES.filter(function (p) { return p.id === c.pressure; })[0];
      html = "<h2>Call the coverage</h2><p class=\"hint\">These are the coverages that go with " + esc(pz.label.toLowerCase()) + ".</p><fieldset><legend>Coverage</legend>" + radio("cov", why("cov", pz.covers.map(function (k) { return { id: k, label: F.COVERAGES[k].label, detail: F.COVERAGES[k].detail }; })), c.cov, detail) + "</fieldset>";
    } else {
      html = "<h2>What do you take away?</h2><p class=\"hint\">Every call gives something up. Pick what you refuse to let them have.</p><fieldset><legend>Take away</legend>" + radio("area", why("area", F.AREAS), c.area, detail) + "</fieldset>";
    }
    html += '<div class="nav">' + '<button type="button" class="ghost" id="back">\u2190 Back</button>' +
      '<span class="need" id="need"></span><button type="submit" class="primary" id="next">' + (st.step === DSTEPS.length - 1 ? "Snap it" : "Next \u2192") + "</button></div>";
    f.innerHTML = html;
    if ($("back")) $("back").onclick = function () { if (cardBack() || !st.step) return; st.step--; st.card = 99; renderDefStep(); };
    updateNav();
    cards();
  }
  function defMissing() {
    var a = st.answers, c = st.call, s = DSTEPS[st.step].id;
    if (s === "read") return (a.pers ? 0 : 1) + (a.likely ? 0 : 1) + (a.confidence ? 0 : 1) ? "Answer all three" : "";
    if (s === "personnel") return c.pkg ? "" : "Pick a package";
    if (s === "pressure") return c.pressure ? "" : "Pick a pressure";
    if (s === "coverage") return c.cov ? "" : "Pick a coverage";
    return c.area ? "" : "Pick what you take away";
  }
  function redrawDefense() {
    st.hideD = !st.call.pkg;
    st.sc = F.view(D, window.SS_REAL, st.r, st.call);
    drawField();
  }
  function defChange(t) {
    var n = t.name;
    if (n === "pers" || n === "likely" || n === "confidence") st.answers[n] = t.value;
    else {
      st.call[n] = t.value;
      if (n === "pressure") { var pz = F.PRESSURES.filter(function (p) { return p.id === t.value; })[0]; if (pz.covers.indexOf(st.call.cov) < 0) st.call.cov = pz.covers.length === 1 ? pz.covers[0] : null; }
      if (n === "pkg" || n === "pressure" || n === "cov") redrawDefense();
      if (n === "pkg") renderSitDef();
    }
    updateNav();
    afterAnswer(n);
  }
  // Moves focus to the new step's heading. On phones the field sticks to the top of the screen, so scroll the
  // step to just below it instead of letting focus() park the first options underneath the field.
  function focusStep() {
    var h = $("step").querySelector("h2"); if (!h) return;
    h.tabIndex = -1; h.focus({ preventScroll: true });
    var fw = document.querySelector(".field-wrap"), stuck = 0;
    if (fw && getComputedStyle(fw).position === "sticky") stuck = fw.getBoundingClientRect().height;
    var top = $("step").getBoundingClientRect().top + window.scrollY - stuck - 10;
    if (stuck || $("step").getBoundingClientRect().top < 0) window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }
  // The pause between the snap and the review; cancelled on Quit so it can't land on the next play
  var reviewTimer = null;
  function later(fn) {
    clearTimeout(reviewTimer);
    var cur = st;
    reviewTimer = setTimeout(function () { reviewTimer = null; if (st === cur && !$("play").hidden) fn(); }, reduce ? 0 : phone.matches ? 1500 : 900);
  }

  function defSubmit() {
    if (defMissing()) return;
    if (st.step < DSTEPS.length - 1) {
      st.step++; st.card = null;
      renderDefStep();
      focusStep();
      return;
    }
    st.snapped = true;
    unlock();
    redrawDefense();
    place();
    drawPost();
    Array.prototype.forEach.call($("step").querySelectorAll("input,button"), function (x) { x.disabled = true; });
    $("steps").innerHTML = DSTEPS.map(function (x) { return '<li class="done">' + x.label + "</li>"; }).join("");
    later(function () { renderDefReview(true); });
  }
  function callText(c) {
    var pk = F.PACKAGES.filter(function (p) { return p.id === c.pkg; })[0], pz = F.PRESSURES.filter(function (p) { return p.id === c.pressure; })[0];
    return pk.label + ", " + pz.label.toLowerCase() + ", " + F.COVERAGES[c.cov].label + ", taking away the " + AREA_NAME[c.area];
  }
  function epaText(v) { return (v > 0 ? "+" : "") + v.toFixed(2); }
  function renderDefReview(first) {
    var r = st.r, rv = F.review(r, st.answers, st.call, st.seed), rep = rv.rep, box = $("review");
    if (first && !st.recorded) {
      save(STORE, E.record(load(STORE, null), { id: "def:" + (st.synthetic ? st.lesson.id : st.base.id), learning: { tags: st.lesson ? st.lesson.learning.tags : ["dc-personnel", "dc-coverage"] } }, rv, Date.now()));
      st.recorded = true;
    }
    var good = rep.stopped, last = rep.events[rep.events.length - 1].text;
    if (good && !rep.firstDown && /for \d+ yards?\.$/.test(last) && r.down >= 3) last += " Short of the sticks: a stop.";
    else if (good && /for \d+ yards?\.$/.test(last)) last += " Under what they needed: a stop.";
    var G = [["read", "Read", "process"], ["personnel", "Personnel", "process"], ["call", "Call", "process"], ["takeaway", "Take away", "process"], ["result", "Result", "outcome"]];
    var a = rv.areaDist, likelyName = { run: "a run", quick: "a quick throw or screen", middle: "an intermediate throw", deep: "a deep shot" };
    var real = r.kind === "run" ? (r.rusher || "The back") + " ran " + (r.runLoc === "middle" ? "up the middle" : "to the " + (r.runLoc || "line")) + "." : (r.target ? r.passer + " threw to " + r.target + (r.route ? " (" + r.route.toLowerCase() + ")" : "") : r.passer + " dropped back") + ".";
    var html =
      '<p class="result-line ' + (good ? "good" : "bad") + '" id="result-line" tabindex="-1">' + esc(last) + "</p>" +
      '<p class="verdict"><b>' + esc(rv.verdict.title) + ".</b>" + esc(rv.verdict.text) + "</p>" +
      '<div class="grades grades-5">' + G.map(function (g) { var l = rv.letters[g[0]]; return '<div class="grade ' + g[2] + " " + gradeClass(l) + '"><b>' + esc(l) + "</b><small>" + g[1] + "</small></div>"; }).join("") + "</div>" +
      '<p class="grade-key"><span><i style="background:var(--mint)"></i>Process: your calls (' + rv.process + "/100)</span><span><i style=\"background:var(--orange)\"></i>Outcome: this one rep</span></p>" +
      '<div class="odds"><p>Against what offenses run here, your call allows <b>' + epaText(rv.expected) + " expected points</b> per play and a <b>" + pct(rv.expectedSuccess) + "</b> success rate. The best call on the board allows " + epaText(rv.best.v) + ". Against the play they actually ran, it holds " + pct(1 - rep.p) + " of the time.</p>" +
      '<button type="button" class="ghost" id="again">Run this rep again</button></div>' +
      sec(1, "Your read", '<ul class="qlist"><li><div class="q"><span>Their personnel</span><span class="pill ' + (st.answers.pers === r.offPers ? "ok\">Right" : "no\">Missed") + "</span></div><div class=\"ans\">You: " + esc(st.answers.pers) + " · Real: " + esc(r.offPers) + "</div></li>" +
        '<li><div class="q"><span>What they were most likely to run</span><span class="pill ' + (st.answers.likely === rv.likely ? "ok\">Right" : "part\">" + rv.grades.read + "/100") + "</span></div><div class=\"ans\">You: " + esc(likelyName[st.answers.likely]) + " · Most likely: " + esc(likelyName[rv.likely]) + "</div><div class=\"ex\">" + esc(offenseLine(r)) + "</div></li></ul>" +
        (st.lesson ? '<p class="calib">' + esc(st.lesson.read.pers + " " + st.lesson.read.likely) + "</p>" : "")) +
      (st.lesson ? sec("\u2605", "What mattered", '<ul class="clues">' + st.lesson.clues.map(function (c) {
        return '<li><span class="pill ' + c.kind + '">' + ({ meaningful: "Meaningful", deceptive: "Deceptive", uncertain: "Uncertain" })[c.kind] + "</span><span>" + esc(c.text) + "</span></li>";
      }).join("") + "</ul>") : "") +
      sec(2, st.synthetic ? "What the offense ran" : "What the offense really ran", st.synthetic ? '<ul class="real-facts"><li><span class="pill part">Synthetic</span><b>The play</b><span>' + esc(r.desc + " That's " + F.NAMES[rep.concept] + ".") + "</span></li></ul>" :
        '<ul class="real-facts"><li><span class="pill ok">Verified</span><b>The play</b><span>' + esc(r.desc) + "</span></li><li><span class=\"pill uncertain\">Charted</span><b>In your terms</b><span>" + esc(real + " That's " + F.NAMES[rep.concept] + ".") + "</span></li></ul>") +
      sec(3, "Your call against it", "<p><b>" + esc(callText(st.call)) + ".</b> " + (F.mismatch(r, st.call.pkg) ? "That leaves " + F.mismatch(r, st.call.pkg) + " of their receivers on linebackers. " : "") + "</p>" +
        (st.lesson ? '<ul class="notes">' + [["pkg", st.call.pkg], ["pressure", st.call.pressure], ["cov", st.call.cov], ["area", st.call.area]].map(function (x) { return "<li>" + esc(st.lesson.why[x[0]][x[1]]) + "</li>"; }).join("") + "</ul>" : "") +
        '<div class="cards">' + rep.cards.map(function (c) { return '<div class="acard ' + (c.held ? "held" : "fail") + '"><h4>' + esc(c.who) + "<span>" + (c.held ? "\u2713 Won" : "\u2717 Lost") + "</span></h4><p><b>Job:</b> " + esc(c.job) + "</p><p><b>" + (c.held ? "Won:" : "Lost:") + "</b> " + esc(c.held ? c.win : c.fail) + "</p></div>"; }).join("") + "</div>" +
        '<ol class="timeline">' + rep.events.map(function (t) { return "<li><time>" + t.t.toFixed(1) + "s</time>" + esc(t.text) + "</li>"; }).join("") + "</ol>") +
      (st.synthetic ? "" : sec(4, "What the real defense called", '<ul class="real-facts"><li><span class="pill uncertain">Charted</span><b>Their call</b><span>' + esc(r.pkg.replace(/^./, function (x) { return x.toUpperCase(); }) + (r.box ? ", " + r.box + " in the box" : "") + (r.kind === "pass" ? ", " + (r.rushers || 0) + " rushers, " + (r.coverage || "coverage not charted") : ", coverage " + (r.coverage || "not charted on runs"))) + "</span></li><li><span class=\"pill ok\">Verified</span><b>How it went</b><span>" +
        esc((r.td ? "Touchdown" : r.result === "int" ? "Intercepted" : r.result === "sack" ? "Sack" : r.result === "incomplete" ? "Incomplete" : r.yards + " yards" + (r.first ? ", first down" : "")) + ". Offense's expected points: " + epaText(r.epa) + ".") + "</span></li></ul>")) +
      (st.lesson ? sec("\u2713", "The lesson's call", "<p><b>" + esc(callText(st.lesson.best)) + ".</b></p>" + '<ul class="notes">' + [["pkg", st.lesson.best.pkg], ["pressure", st.lesson.best.pressure], ["cov", st.lesson.best.cov], ["area", st.lesson.best.area]].map(function (x) { return "<li>" + esc(st.lesson.why[x[0]][x[1]]) + "</li>"; }).join("") + "</ul>") : "") +
      sec(5, "The best call in each package", "<p>Each package with its best pressure, coverage and take-away against what offenses run here. Lower is better for you.</p>" + '<ul class="alts">' + rv.alternatives.map(function (x, i) {
        return '<li class="' + (x.call.pkg === st.call.pkg ? "yours" : "") + '"><div class="head"><span class="pill ' + (i === 0 ? "ok" : "part") + '">' + (i === 0 ? "Best" : "#" + (i + 1)) + "</span><b>" + esc(callText(x.call)) + "</b>" + (x.call.pkg === st.call.pkg ? '<span class="pill uncertain">Your package</span>' : "") + '<span class="stats">' + epaText(x.allowed) + " EPA/play</span></div></li>";
      }).join("") + "</ul>") +
      (st.lesson ? sec(6, "Next time", "<p>" + esc(st.lesson.next) + "</p>") : "") +
      '<div class="takeaway"><small>Takeaway</small><p>' + esc(st.lesson ? st.lesson.takeaway : (D.situationsDefense || {})[r.situation] || "Match their personnel, then take away what this personnel runs on this down.") + "</p></div>" +
      '<div class="after"><button type="button" class="primary" id="next-scen">Next snap \u2192</button><button type="button" class="ghost" id="replay">Call this one again</button><button type="button" class="ghost" id="home">Back to start</button></div>';
    box.innerHTML = html;
    box.hidden = false;
    $("again").onclick = function () { st.seed = (st.seed * 48271) % 2147483647 || 7; renderDefReview(false); say("New rep. " + $("result-line").textContent); };
    $("next-scen").onclick = function () {
      // In a lesson, its real snaps come next; otherwise another film snap.
      beginDef(st.lesson && dlessonSnaps(st.lesson.id).length ? nextDef(dlessonSnaps(st.lesson.id), st.base.id) : nextDef(filmMatches(), st.base.id));
    };
    $("replay").onclick = function () { beginDef(st.synthetic ? st.lesson.id : st.base.id); };
    $("home").onclick = function () { $("quit").click(); };
    if (first) { $("result-line").focus({ preventScroll: true }); box.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); }
  }

  renderStart();
})();
