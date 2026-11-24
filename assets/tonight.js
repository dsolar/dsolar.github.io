/* Tonight's games for the NBA and NHL hubs: game cards and previews, shared by both.
   Data: <hub>/data/tonight.json (tools/tonight_pull.py, from ESPN) and <hub>/data/betting.json (tools/betting_pull.py:
   Action Network's share of bets and Kalshi prices, keyed by ESPN game id). Each hub passes a config:
     team(espnAbbr, espnName) -> {code, short, name, logo: html, link: url} for its own team pages
     rows: [[label, ownKey, oppKey, dir, fmt]] -> preview bars: one team's own number against the other's number
           (oppKey "d:<key>" reads what opponents did against that team; dir 1 = higher is better for the offense)
     href(route, query) -> the hub's own link builder; base: the hub's routes for the list and a preview */
(function () {
  "use strict";
  var T = { data: null, bets: null, wait: null };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function load() {
    var get = function (u) { return fetch(u, { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    if (!T.wait) T.wait = Promise.all([get("data/tonight.json"), get("data/betting.json")]).then(function (r) { T.data = r[0]; T.bets = r[1] && r[1].games && !Array.isArray(r[1].games) ? r[1] : { games: {} }; });
    return T.wait;
  }
  function etDay(d) { return new Date(d.getTime()).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
  function tipTxt(g) { return new Date(g.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET"; }
  function dayLabel(day) { return new Date(day + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }); }
  var betOk = function (p) { return p != null && p > 0 && p < 100; };
  var kfmt = function (v) { return v >= 10000 ? Math.round(v / 1000) + "K" : v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(Math.round(v)); };
  var sgn = function (v) { return Math.abs(v) < 0.25 ? "PK" : (v > 0 ? "+" : "−") + String(Math.abs(v)).replace(/\.0$/, ""); };
  function color(pc) {   // blue (bad) to red (good), the hubs' percentile scale
    var t = Math.max(0, Math.min(100, pc)) / 100, mx = function (a, b, k) { return Math.round(a + (b - a) * k); };
    var c = t < 0.5 ? [mx(54, 222, t * 2), mx(97, 222, t * 2), mx(173, 222, t * 2)] : [mx(222, 210, (t - 0.5) * 2), mx(222, 45, (t - 0.5) * 2), mx(222, 73, (t - 0.5) * 2)];
    return "rgb(" + c.join(",") + ")";
  }
  function betLine(g, cfg, big) {
    var b = T.bets && T.bets.games[g.id]; if (!b) return "";
    var x = b.an, k = b.k, bits = [], H = cfg.team(g.h.ab, g.h.n), A = cfg.team(g.a.ab, g.a.n);
    if (x && x.sp && x.sp[0] != null && betOk(x.sp[1])) { var hs = x.sp[1] >= 50; bits.push("<b>" + Math.round(hs ? x.sp[1] : 100 - x.sp[1]) + "%</b> " + esc((hs ? H : A).code) + " " + sgn(hs ? x.sp[0] : -x.sp[0])); }
    else if (x && x.ml && betOk(x.ml[2])) { var hm = x.ml[2] >= 50; bits.push("<b>" + Math.round(hm ? x.ml[2] : 100 - x.ml[2]) + "%</b> " + esc((hm ? H : A).code) + " to win"); }
    if (x && x.tot && x.tot[0] != null && betOk(x.tot[1])) bits.push("<b>" + Math.round(Math.max(x.tot[1], 100 - x.tot[1])) + "%</b> " + (x.tot[1] >= 50 ? "over" : "under") + " " + x.tot[0]);
    var out = bits.length ? '<span title="Share of bets across the books Action Network tracks' + (x.n ? ", " + x.n.toLocaleString() + " bets" : "") + '">Bets ' + bits.join(" · ") + (x.n ? " <small>" + kfmt(x.n) + " bets</small>" : "") + "</span>" : "";
    if (k && k.h != null && k.a != null && (k.v || 0) >= 500) { var hf = k.h >= k.a; out += '<span title="Kalshi price on each team\'s wins market, ' + Math.round(k.v).toLocaleString() + ' contracts traded">Kalshi <b>' + esc((hf ? H : A).code) + " " + Math.round(100 * (hf ? k.h : k.a)) + "¢</b> <small>" + kfmt(k.v) + " traded</small></span>"; }
    return out ? '<div class="' + (big ? "bets big" : "bets") + '">' + out + "</div>" : "";
  }
  function injFor(name) { var t = T.data && T.data.inj && T.data.inj[name]; return t ? t.rows : []; }
  function injSummary(name) {
    var c = {}; injFor(name).forEach(function (r) { var s = (r.st || "").toLowerCase(); var k = /out|injured reserve|^ir/.test(s) ? "out" : /doubt/.test(s) ? "doubtful" : /quest|day-to-day|game-time/.test(s) ? "questionable" : null; if (k) c[k] = (c[k] || 0) + 1; });
    return ["out", "doubtful", "questionable"].filter(function (k) { return c[k]; }).map(function (k) { return c[k] + " " + k; }).join(", ");
  }
  function lineTxt(g) { return g.line ? esc(g.line) + (g.ou ? " · O/U " + esc(g.ou) : "") : "—"; }

  function list(cfg, q) {
    if (!T.data) return null;
    var games = T.data.games || [], days = Array.from(new Set(games.map(function (g) { return g.day; }))).sort();
    var today = etDay(new Date()), day = q.d && days.indexOf(q.d) >= 0 ? q.d : (days.filter(function (d) { return d >= today; })[0] || days[days.length - 1]);
    var i = days.indexOf(day), gs = games.filter(function (g) { return g.day === day; }).sort(function (a, b) { return a.at.localeCompare(b.at); });
    var nav = '<div class="wknav">' + (i > 0 ? '<a href="' + cfg.href(cfg.base, { d: days[i - 1] }) + '">← ' + esc(dayLabel(days[i - 1]).split(",")[0]) + "</a>" : "<span></span>") + "<b>" + esc(dayLabel(day)) + (day === today ? " · tonight" : "") + "</b>" + (i < days.length - 1 ? '<a href="' + cfg.href(cfg.base, { d: days[i + 1] }) + '">' + esc(dayLabel(days[i + 1]).split(",")[0]) + " →</a>" : "<span></span>") + "</div>";
    var cards = gs.map(function (g) {
      var H = cfg.team(g.h.ab, g.h.n), A = cfg.team(g.a.ab, g.a.n), done = g.st === "post", live = g.st === "in";
      var side = function (t, x, won) { return '<div class="wgt' + (won ? " won" : "") + '">' + t.logo + '<a class="nm" href="' + t.link + '">' + esc(t.short) + "</a><small>" + esc(x.rec || "") + "</small>" + (done || live ? '<b class="sc">' + (x.s == null ? "" : x.s) + "</b>" : "") + "</div>"; };
      var inj = done ? "" : [[A, g.a], [H, g.h]].map(function (p) { var s = injSummary(p[1].n); return s ? "<span>" + esc(p[0].code) + ": " + s + "</span>" : ""; }).filter(Boolean).join("");
      return '<article class="wg' + (live ? " is-live" : "") + '"><header><span>' + (done ? "<b>Final</b>" : live ? '<b class="live">' + esc(g.detail || "Live") + "</b>" : tipTxt(g)) + (g.tv && g.tv.length ? " · " + esc(g.tv.join(", ")) : "") + "</span></header>" +
        side(A, g.a, done && g.a.s > g.h.s) + side(H, g.h, done && g.h.s > g.a.s) +
        "<footer><span>Line <b>" + lineTxt(g) + '</b></span><a href="' + cfg.href(cfg.preview + "/" + g.id, {}) + '">Preview →</a></footer>' +
        (inj ? '<div class="injline">' + inj + "</div>" : "") + betLine(g, cfg) + "</article>";
    }).join("");
    return '<h2 class="sec">Tonight</h2><p class="lede">Every game with the tip time, TV, the line, the public betting split and the injury report, and a preview of each one: each team\'s numbers against the other\'s, ranked league-wide.</p>' + nav +
      (cards ? '<div class="wkgames">' + cards + "</div>" : '<p class="note">No games this day.</p>') +
      '<p class="note">Schedule, lines (DraftKings, via ESPN) and injuries from ESPN. Bets: share of bets across the books <a href="https://www.actionnetwork.com" target="_blank" rel="noopener">Action Network</a> tracks. Kalshi: price on each team\'s wins market at <a href="https://kalshi.com" target="_blank" rel="noopener">Kalshi</a>, shown once 500+ contracts have traded.</p>';
  }

  function val(team, key) { var t = T.data.teams[team]; if (!t) return null; if (typeof key === "function") return key(t); return key.indexOf("d:") === 0 ? t.d[key.slice(2)] : t.o[key]; }
  function pct(key, v, dir) {
    if (v == null) return null;
    var vals = Object.keys(T.data.teams).map(function (c) { return val(c, key); }).filter(function (x) { return x != null && isFinite(x); });
    var lo = vals.filter(function (x) { return x < v; }).length, eq = vals.filter(function (x) { return x === v; }).length;
    var p = Math.round(100 * (lo + Math.max(0, eq - 1) / 2) / Math.max(1, vals.length - 1));
    return dir > 0 ? p : 100 - p;
  }
  function muSide(cfg, off, def, offT, defT, word) {
    var bar = function (pc, s) { var c = color(pc), w = Math.max(4, pc); return '<i class="' + s + '"><em style="width:' + w + "%;background:" + c + '"></em><b style="' + (s === "l" ? "right" : "left") + ":calc(" + w + "% - 13px);background:" + c + ";color:" + (pc >= 80 || pc <= 20 ? "#fff" : "var(--ink)") + '">' + pc + "</b></i>"; };
    var wins = 0, loses = 0, n = 0;
    var rows = cfg.rows.map(function (r) {
      var ov = val(off, r[1]), dv = val(def, r[2]); var op = pct(r[1], ov, r[3]), dp = pct(r[2], dv, -r[3] * (r[5] || 1));
      if (op == null || dp == null) return "";
      n++; if (op > dp) wins++; else if (dp > op) loses++;
      return '<div class="mu-r">' + bar(op, "l") + '<span class="mid">' + r[0] + "<small>" + r[4](ov) + " · " + r[4](dv) + "</small></span>" + bar(dp, "r") + "</div>";
    }).join("");
    if (!n) return "";
    var verdict = wins > loses ? esc(offT.code) + " has the edge in " + wins + " of " + n : loses > wins ? esc(defT.code) + " has the edge in " + loses + " of " + n : "Even";
    return '<div class="panel"><h3>' + esc(offT.short) + " " + word + " <small>" + verdict + '</small></h3><div class="body"><div class="mups"><div class="mu-r mu-h"><span>' + offT.logo + esc(offT.code) + " " + cfg.sides[0] + '</span><span></span><span>' + esc(defT.code) + " " + cfg.sides[1] + " " + defT.logo + "</span></div>" + rows + "</div></div></div>";
  }
  function injPanel(t, name) {
    var rows = injFor(name).slice(0, 12);
    return '<div class="panel"><h3>' + t.logo + " " + esc(t.short) + " injuries <small>" + (rows.length ? "ESPN's report" : "none listed") + "</small></h3>" +
      (rows.length ? '<ul class="rlist">' + rows.map(function (r) { return "<li><b>" + esc(r.n) + '</b><span class="grow sub">' + esc(r.pos || "") + (r.note ? " · " + esc(r.note) : "") + '</span><span class="num">' + esc(r.st || "") + "</span></li>"; }).join("") + "</ul>" : "") + "</div>";
  }
  function preview(cfg, id) {
    if (!T.data) return null;
    var g = (T.data.games || []).filter(function (x) { return x.id === id; })[0];
    if (!g) return '<p class="note">That game isn\'t in the next week\'s schedule. <a href="' + cfg.href(cfg.base, {}) + '">Tonight\'s games</a></p>';
    var H = cfg.team(g.h.ab, g.h.n), A = cfg.team(g.a.ab, g.a.n), done = g.st === "post";
    var head = '<div class="gphead">' + [[A, g.a], [H, g.h]].map(function (p) { return '<a class="gpt" href="' + p[0].link + '">' + p[0].logo.replace(/width="\d+"|height="\d+"|style="[^"]*"/g, "").replace("<img", '<img style="width:48px;height:48px"') + "<b>" + esc(p[0].name) + "</b><small>" + esc(p[1].rec || "") + (done ? " · " + p[1].s : "") + "</small></a>"; }).join('<span class="gpat">' + (g.neutral ? "vs" : "at") + "</span>") + "</div>";
    var meta = '<p class="gpmeta">' + (done ? "Final" : g.st === "in" ? esc(g.detail || "Live") : esc(dayLabel(g.day)) + " · " + tipTxt(g)) + (g.tv && g.tv.length ? " · " + esc(g.tv.join(", ")) : "") + " · Line <b>" + lineTxt(g) + "</b></p>";
    var stats = T.data.teams[g.a.ab] && T.data.teams[g.h.ab];
    return '<p class="back"><a href="' + cfg.href(cfg.base, { d: g.day }) + '">← ' + esc(dayLabel(g.day)) + "</a></p>" + head + meta + betLine(g, cfg, true) +
      (stats ? '<div class="two">' + muSide(cfg, g.a.ab, g.h.ab, A, H, cfg.word) + muSide(cfg, g.h.ab, g.a.ab, H, A, cfg.word) + '</div><p class="note">' + cfg.note + "</p>" : '<p class="note">Team stats aren\'t in yet.</p>') +
      '<div class="two">' + injPanel(A, g.a.n) + injPanel(H, g.h.n) + "</div>";
  }
  // a team's next game for the shared player card: {today, when, what, sub, right} or null. code(ab) maps ESPN's abbreviation to the hub's
  function next(cfg, code, me) {
    if (!T.data) return null;
    var now = Date.now() - 3 * 36e5, g = (T.data.games || []).filter(function (x) { return x.st !== "post" && Date.parse(x.at) > now && (code(x.h.ab, x.h.n) === me || code(x.a.ab, x.a.n) === me); }).sort(function (a, b) { return a.at.localeCompare(b.at); })[0];
    if (!g) return null;
    var home = code(g.h.ab, g.h.n) === me, o = home ? g.a : g.h, ot = cfg.team(o.ab, o.n), d = new Date(g.at), b = T.bets && T.bets.games[g.id], k = b && b.k;
    var today = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }) === new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    var win = k && k.h != null ? (home ? k.h : k.a) : null;
    return { today: today, when: [today ? "Today" : d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" }), d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).replace(":00", "")],
      what: (home ? "vs " : "at ") + '<a href="' + cfg.href(cfg.preview + "/" + g.id, {}) + '">' + esc(ot.name || o.n) + "</a>",
      sub: [g.line ? g.line : "", g.ou ? "O/U " + g.ou : "", win != null ? "Kalshi odds" : ""].filter(Boolean).join(", "), right: win != null ? Math.round(win * 100) + "%" : "" };
  }
  window.Tonight = { load: load, list: list, preview: preview, next: next, ready: function () { return !!T.data; } };
})();
