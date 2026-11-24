/* NFL Hub: screens. The cap math lives in lib/cap.js, the player rating, value and suggestions in lib/plan.js; the data in
   data/league.json (nflverse, refreshed every morning) and data/teamcap.json (Over The Cap's team figures).
   Routes:  #/league   #/team/KC?y=2027&v=plan|sheet|depth   #/method
   A team's planned moves live in this browser and in the link (m=cut:ID:2027,...), so a plan can be shared. */
(function () {
  "use strict";
  var C = window.NFLCap, P = window.NFLPlan, S = window.NFLSeason, W = null, TEAMS = null, SIM = null, WEEKS = null;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var view = $("#view"), card = $("#card"), cardBody = $("#cardBody");
  var state = { route: "league", arg: null, q: {} };
  var YEARS = [2026, 2027, 2028, 2029, 2030];
  var KIND = { cut: "Cut", cutJune: "Cut (post-June 1)", trade: "Trade", tradeJune: "Trade (post-June 1)", restructure: "Restructure", restructureV: "Restructure + void years", extend: "Extend", resign: "Re-sign", tag: "Franchise tag" };

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function m(v, d) { if (v == null || isNaN(v)) return "—"; var a = Math.abs(v); return (v < -0.005 ? "-" : "") + "$" + (a >= 100 ? a.toFixed(0) : a.toFixed(d == null ? 1 : d)) + "M"; }
  function sm(v) { return v == null ? "—" : (v > 0.05 ? "+" : "") + m(v); }
  function save(k, v) { try { localStorage.setItem("nflhub." + k, JSON.stringify(v)); } catch (e) { /* storage off */ } }
  function load(k, d) { try { var v = localStorage.getItem("nflhub." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function stat(v, k) { return '<div class="stat"><b>' + v + "</b><span>" + k + "</span></div>"; }
  function team(c) { var t = TEAMS[c] || {}; return { code: c, name: (t.city ? t.city + " " : "") + (t.name || c), short: t.name || c, color: (t.c || ["#33415c"])[0], espn: t.espn || String(c).toLowerCase(), conf: t.conf }; }
  function logo(c, size) { size = size || 22; return '<img class="logo" src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/' + esc(team(c).espn) + ".png&w=" + size * 2 + "&h=" + size * 2 + '" alt="" width="' + size + '" height="' + size + '" loading="lazy" onerror="this.style.visibility=\'hidden\'">'; }
  // Headshots: NFL.com's (nearly every rostered player has one), falling back to ESPN's, then initials
  function face(p, size) {
    size = size || 24;
    if (!p.hs) return window.DSFaces.html({ sport: "nfl", id: p.espn || null, name: p.n, color: team(p.t).color, size: size });
    var base = window.DSFaces.html({ sport: "nfl", id: null, name: "", title: p.n, color: team(p.t).color, size: size, hide: true });
    var px = size * 3 <= 120 ? 120 : 240;
    // NFL.com's photo, then ESPN's (by id, or by name from the faces registry when the player has no ESPN id)
    var byName = !p.espn && window.DSFaces.find ? window.DSFaces.find("nfl", p.n) : null;
    var alt = p.espn ? "https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/" + p.espn + ".png&w=" + px + "&h=" + Math.round(px * 0.73)
      : byName ? window.DSFaces.url("nfl", byName, { size: size }) : "";
    var img = '<img class="ds-face-img" src="https://static.www.nfl.com/image/upload/c_thumb,g_face,w_' + px + ",h_" + px + ",f_auto,q_auto/league/" + esc(p.hs) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="' +
      (alt ? "if(!this.dataset.alt){this.dataset.alt=1;this.parentNode.classList.add('espn');this.src='" + alt + "';return;}" : "") + "this.parentNode&&this.parentNode.classList.remove('has-face');this.remove()\">";
    var ini = esc(String(p.n).split(" ").filter(function (w) { return !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(w); }).map(function (w, i, a) { return i === 0 || i === a.length - 1 ? w[0] : ""; }).join("").toUpperCase());
    return base.replace('class="ds-face', 'class="ds-face has-face').replace(/<span class="ds-face-ini">[^<]*<\/span>/, '<span class="ds-face-ini">' + ini + "</span>" + img);
  }
  function lastName(n) { var w = String(n).split(" ").filter(function (x) { return !/^(Jr\.?|Sr\.?|II|III|IV|V)$/.test(x); }); return w.length ? w[w.length - 1] : n; }
  // The player rating on a 0-100 scale: 50 is an average player at his position, each 15 points one standard deviation
  function zScore(z) { return Math.max(1, Math.min(99, Math.round(50 + 15 * z))); }
  function score(p, y) { return zScore(y && y > W.season ? P.ratingZ(W, p, y) : P.quality(W, p).z); }
  function chipCls(s) { return s >= 75 ? "e" : s >= 60 ? "g" : s >= 40 ? "a" : "w"; }
  function scoreChip(p, y) { var s = score(p, y), mine = W.adj && W.adj[p.id]; return '<span class="rscore ' + chipCls(s) + (mine ? " mine" : "") + '" title="Player rating' + (mine ? " with your read (" + (mine > 0 ? "+" : "") + mine + ")" : "") + (y && y > W.season ? " projected for " + y + ", aging included" : "") + ': 50 is an average player at his position">' + s + "</span>"; }
  function posOf(p) { return p.dpos && p.dpos !== "NA" ? p.dpos : p.pos; }
  function pname(p, size, extra) { return '<span class="pl" data-p="' + esc(p.id) + '">' + face(p, size || 22) + '<span class="nm">' + esc(p.n) + "</span>" + injTag(p) + (extra || "") + "</span>"; }
  // This week's injury report (nflverse): Q questionable, D doubtful, O out (P probable), with the injury and practice
  // participation on hover. Only the current week's report shows: once the week's games are played it's history
  var INJ_CODE = { Probable: "P", Questionable: "Q", Doubtful: "D", Out: "O" };
  function injTag(p) {
    var j = p && p.inj;
    if (!j || !INJ_CODE[j[0]] || (W && W.week && j[3] < W.week)) return "";
    var c = INJ_CODE[j[0]], tip = j[0] + (j[1] ? " (" + j[1].toLowerCase() + ")" : "") + (j[2] ? ". " + ({ "did not participate in practice": "Didn't practice", "limited participation in practice": "Limited in practice", "full participation in practice": "Full practice" }[j[2].toLowerCase()] || j[2]) : "") + ". Week " + j[3] + " injury report.";
    return ' <span class="injd inj-' + c.toLowerCase() + '" data-tip="' + esc(tip) + '" tabindex="0" role="img" aria-label="' + esc(j[0]) + '">' + c + "</span>";
  }
  function href(route, q) {
    var qs = Object.keys(q || {}).filter(function (k) { return q[k] != null && q[k] !== ""; }).map(function (k) { return k + "=" + encodeURIComponent(q[k]); }).join("&");
    return "#/" + route + (qs ? "?" + qs : "");
  }
  function tablePanel(title, head, body, right, cls) {
    return '<div class="panel"><h3>' + esc(title) + " <small>" + (right || "") + '</small></h3><div class="scroll"><table class="t' + (cls ? " " + cls : "") + '"><thead><tr>' + head + "</tr></thead><tbody>" + (body || '<tr><td class="note">Nothing here.</td></tr>') + "</tbody></table></div></div>";
  }
  var codes = function () { return Object.keys(TEAMS).sort(function (a, b) { return team(a).name.localeCompare(team(b).name); }); };

  // ---------- plans (moves per team) ----------
  function movesOf(code) {
    var fromUrl = state.route === "team" && state.arg === code && state.q.m != null ? decodeMoves(state.q.m) : null;
    return fromUrl || load("plan." + code, []);
  }
  function setMoves(code, ms) { save("plan." + code, ms); var q = Object.assign({}, state.q, { m: encodeMoves(ms) || null }); location.hash = href("team/" + code, q); }
  function encodeMoves(ms) { return ms.map(function (x) { return [x.kind, x.id, x.year, x.amount != null ? x.amount : "", x.apy != null ? x.apy.toFixed(2) : "", x.years || ""].join(":"); }).join(","); }
  function moveTitle(mv) { return (KIND[mv.kind] || mv.kind) + (mv.kind === "extend" || mv.kind === "resign" ? ", " + (mv.years || 3) + " yr" + ((mv.years || 3) > 1 ? "s" : "") + " at " + m(mv.apy) : mv.kind === "tag" ? " at " + m(mv.amount) : ""); }
  // Years for a new deal: what comparable contracts point to
  function estYears(id, kind, y) { var p = W.byId[id]; return p ? P.contract(W, p, kind === "extend" ? y + 1 : y).yrs : 3; }
  // A contract estimate as "$X/yr" with years, total and guarantees under it
  function dealCell(e) {
    return '<span class="deal" title="Comparable deals: ' + esc(e.comps.map(function (c) { return c.n + " (" + c.t + ", " + c.signed + ", age " + c.age + "): " + c.yrs + " yr" + (c.yrs > 1 ? "s" : "") + ", " + m(c.apy * c.yrs) + ", " + m(c.gtd || 0) + " gtd"; }).join("; ")) + '"><b>' + m(e.apy) + "/yr</b><small>" + e.yrs + " yr" + (e.yrs > 1 ? "s" : "") + ", " + m(e.total) + ", " + m(e.gtd) + " gtd</small></span>";
  }
  function decodeMoves(s) {
    return String(s || "").split(",").filter(Boolean).map(function (t) {
      var a = t.split(":"), mv = { kind: a[0], id: a[1], year: +a[2] };
      if (a[3]) mv.amount = +a[3]; if (a[4]) mv.apy = +a[4]; if (a[5]) mv.years = +a[5];
      return mv;
    }).filter(function (x) { return W.byId[x.id]; });
  }
  // engine form of a move (restructure with void years is a flag)
  function eng(mv) { return mv.kind === "restructureV" ? Object.assign({}, mv, { kind: "restructure", voids: true }) : Object.assign({}, mv, mv.kind === "extend" ? { lowerNow: true } : {}); }

  // ---------- routing ----------
  function parse() {
    var h = location.hash.replace(/^#\/?/, ""), qs = "", i = h.indexOf("?");
    if (i >= 0) { qs = h.slice(i + 1); h = h.slice(0, i); }
    var parts = h.split("/").filter(Boolean), q = {};
    qs.split("&").forEach(function (kv) { if (!kv) return; var a = kv.split("="); q[a[0]] = decodeURIComponent(a[1] || ""); });
    state.route = parts[0] || "standings"; state.arg = parts[1] ? parts[1].toUpperCase() : null; state.q = q;
  }
  // Four sections, as in the NBA Hub; grouped pages get a sub-tab row, and a section tab returns to the page last used in it
  var GROUP = { week: "games", game: "games", standings: "standings", power: "standings", teams: "teams", team: "teams", offseason: "teams", cap: "teams", league: "teams", players: "players", ngs: "players", contracts: "players", fa: "moves", trade: "moves" };
  var SUBS = {
    games: [["week", "This week"]],
    standings: [["standings", "Standings"], ["power", "Power rankings"]],
    teams: [["teams", "Teams"], ["offseason", "Offseason"], ["cap", "League cap"]],
    players: [["players", "Players"], ["ngs", "Next Gen Stats"], ["contracts", "Contracts"]],
    moves: [["fa", "Free agents"], ["trade", "Trade value"]]
  };
  function render() {
    parse();
    var cur = state.route === "team" ? "teams" : state.route === "league" ? "cap" : state.route === "game" ? "week" : state.route, group = GROUP[state.route] || "standings", subs = SUBS[group];
    if (subs.some(function (x) { return x[0] === cur; })) save("sub." + group, cur);
    document.querySelectorAll(".tabs a").forEach(function (a) {
      if (a.dataset.tab === group) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      var last = load("sub." + a.dataset.tab, null);
      if (last && SUBS[a.dataset.tab]) a.setAttribute("href", href(last, {}));
    });
    var st = $("#subtabs");
    st.hidden = false;
    st.innerHTML = subs.map(function (x) { return '<a href="' + href(x[0], {}) + '"' + (x[0] === cur ? ' aria-current="page"' : "") + ">" + x[1] + "</a>"; }).join("");
    ({ week: weekPage, game: gamePage, standings: standingsPage, power: powerPage, fa: faPage, teams: teamsPage, team: teamPage, players: playersPage, ngs: ngsPage, contracts: contractsPage, trade: tradePage, offseason: offseasonPage, cap: leaguePage, league: leaguePage, method: methodPage }[state.route] || standingsPage)();
  }
  window.addEventListener("hashchange", function () { if (card && card.open) card.close(); render(); });

  // ---------- this week: game cards and previews ----------
  // Team offense and defense from play-by-play (data/teamstats.json, tools/nfl_teamstats.py), public betting
  // (data/betting.json: Action Network share of bets, Kalshi prices; tools/betting_pull.py) and Next Gen Stats.
  var TS = null, BETN = null, wkWait = null;
  function loadWeek() {
    var get = function (u) { return fetch(u, { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    if (!wkWait) wkWait = Promise.all([get("data/teamstats.json"), get("data/betting.json"), loadNgs()]).then(function (r) { TS = r[0] || { teams: {} }; BETN = r[1] || { games: {} }; });
    return wkWait;
  }
  function regGames() { return W.games.filter(function (g) { return g[0] === "REG"; }); }
  function upcomingWeek() { var open = regGames().filter(function (g) { return g[5] == null; }).map(function (g) { return g[1]; }); return open.length ? Math.min.apply(null, open) : Math.max.apply(null, regGames().map(function (g) { return g[1]; })); }
  function gkey(g) { return g[2] + "|" + g[3] + "|" + g[4]; }
  function recordOf(code) {
    var w = 0, l = 0, t = 0;
    regGames().forEach(function (g) { if (g[5] == null) return; var home = g[4] === code; if (!home && g[3] !== code) return; var us = home ? g[6] : g[5], them = home ? g[5] : g[6]; if (us > them) w++; else if (us < them) l++; else t++; });
    return w + "-" + l + (t ? "-" + t : "");
  }
  function kickTxt(g) {
    var d = new Date(g[2] + "T12:00:00"), day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    if (!g[10]) return day;
    var hm = g[10].split(":"), h = +hm[0], ap = h >= 12 ? "PM" : "AM";
    return day + " · " + ((h % 12) || 12) + ":" + hm[1] + " " + ap + " ET";
  }
  function lineOf(g) {
    var v = g[7];
    if (v == null) { var b = BETN && BETN.games && BETN.games[gkey(g)]; if (b && b.an && b.an.sp && b.an.sp[0] != null) v = -b.an.sp[0]; }   // before nflverse posts a line, the betting feed's consensus
    if (v == null) return "—"; if (Math.abs(v) < 0.25) return "Pick'em"; return esc(v > 0 ? g[4] : g[3]) + " −" + String(Math.abs(v)).replace(/\.0$/, "");
  }
  function injuredOf(code, wk) {
    var rank = { O: 0, D: 1, Q: 2, P: 3 };
    return W.players.filter(function (p) { return p.t === code && p.inj && INJ_CODE[p.inj[0]] && p.inj[3] >= wk && p.inj[0] !== "Probable"; })
      .sort(function (a, b) { return rank[INJ_CODE[a.inj[0]]] - rank[INJ_CODE[b.inj[0]]] || score(b) - score(a); });
  }
  function injSummary(code, wk) {
    var c = { O: 0, D: 0, Q: 0 }; injuredOf(code, wk).forEach(function (p) { c[INJ_CODE[p.inj[0]]]++; });
    var bits = []; if (c.O) bits.push(c.O + " out"); if (c.D) bits.push(c.D + " doubtful"); if (c.Q) bits.push(c.Q + " questionable");
    return bits.join(", ");
  }
  var betOk = function (p) { return p != null && p > 0 && p < 100; };
  var kfmt = function (v) { return v >= 10000 ? Math.round(v / 1000) + "K" : v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(Math.round(v)); };
  var sgn = function (v) { return Math.abs(v) < 0.25 ? "PK" : (v > 0 ? "+" : "−") + String(Math.abs(v)).replace(/\.0$/, ""); };
  function betLine(g, big) {
    var b = BETN && BETN.games && BETN.games[gkey(g)]; if (!b) return "";
    var x = b.an, k = b.k, bits = [];
    if (x && x.sp && x.sp[0] != null && betOk(x.sp[1])) { var hs = x.sp[1] >= 50; bits.push("<b>" + Math.round(hs ? x.sp[1] : 100 - x.sp[1]) + "%</b> " + esc(hs ? g[4] : g[3]) + " " + sgn(hs ? x.sp[0] : -x.sp[0])); }
    else if (x && x.ml && betOk(x.ml[2])) { var hm = x.ml[2] >= 50; bits.push("<b>" + Math.round(hm ? x.ml[2] : 100 - x.ml[2]) + "%</b> " + esc(hm ? g[4] : g[3]) + " to win"); }
    if (x && x.tot && x.tot[0] != null && betOk(x.tot[1])) bits.push("<b>" + Math.round(Math.max(x.tot[1], 100 - x.tot[1])) + "%</b> " + (x.tot[1] >= 50 ? "over" : "under") + " " + x.tot[0]);
    var out = bits.length ? '<span title="Share of bets across the books Action Network tracks' + (x.n ? ", " + x.n.toLocaleString() + " bets" : "") + '">Bets ' + bits.join(" · ") + (x.n ? " <small>" + kfmt(x.n) + " bets</small>" : "") + "</span>" : "";
    if (k && k.h != null && k.a != null && (k.v || 0) >= 500) { var hf = k.h >= k.a; out += '<span title="Kalshi price on each team\'s wins market, ' + Math.round(k.v).toLocaleString() + ' contracts traded">Kalshi <b>' + esc(hf ? g[4] : g[3]) + " " + Math.round(100 * (hf ? k.h : k.a)) + "¢</b> <small>" + kfmt(k.v) + " traded</small></span>"; }
    return out ? '<div class="' + (big ? "bets big" : "bets") + '">' + out + "</div>" : "";
  }
  function weekPage() {
    if (!TS) { view.innerHTML = '<p class="loading">Loading this week…</p>'; loadWeek().then(function () { if (state.route === "week") render(); }); return; }
    var up = upcomingWeek(), wk = +state.q.w || up, maxW = Math.max.apply(null, regGames().map(function (g) { return g[1]; }));
    var gs = regGames().filter(function (g) { return g[1] === wk; }).sort(function (a, b) { return (a[2] + (a[10] || "")).localeCompare(b[2] + (b[10] || "")); });
    var nav = '<div class="wknav">' + (wk > 1 ? '<a href="' + href("week", { w: wk - 1 }) + '">← Week ' + (wk - 1) + "</a>" : "<span></span>") + "<b>Week " + wk + (wk === up ? " · this week" : "") + "</b>" + (wk < maxW ? '<a href="' + href("week", { w: wk + 1 }) + '">Week ' + (wk + 1) + " →</a>" : "<span></span>") + "</div>";
    var cards = gs.map(function (g) {
      var done = g[5] != null, a = g[3], h = g[4];
      var side = function (c, sc, won) { return '<div class="wgt' + (won ? " won" : "") + '">' + logo(c, 24) + '<a class="nm" href="' + href("team/" + c, {}) + '">' + esc(team(c).short) + "</a><small>" + recordOf(c) + "</small>" + (done ? '<b class="sc">' + sc + "</b>" : "") + "</div>"; };
      var inj = done ? "" : [a, h].map(function (c) { var s = injSummary(c, wk); return s ? '<span title="This week\'s injury report">' + esc(c) + ": " + s + "</span>" : ""; }).filter(Boolean).join("");
      return '<article class="wg"><header><span>' + (done ? "<b>Final</b>" : kickTxt(g)) + (g[8] ? " · Neutral" : "") + (g[9] ? ' · <span class="pill">Division</span>' : "") + "</span></header>" +
        side(a, g[5], done && g[5] > g[6]) + side(h, g[6], done && g[6] > g[5]) +
        "<footer><span>Line <b>" + lineOf(g) + '</b></span><a href="' + href("game/" + a + "-" + h, { w: wk }) + '">Preview →</a></footer>' +
        (inj ? '<div class="injline">' + inj + "</div>" : "") + betLine(g) + "</article>";
    }).join("");
    view.innerHTML = '<h2 class="sec">This week</h2><p class="lede">Every game with the line, the public betting split, the injury report and a preview: each side\'s offense against the other\'s defense, ranked against all 32 teams.</p>' + nav +
      (cards ? '<div class="wkgames">' + cards + "</div>" : '<p class="note">No games this week.</p>') +
      '<p class="note">Lines from nflverse (the consensus closing number for finished games). Bets: share of bets across the books <a href="https://www.actionnetwork.com" target="_blank" rel="noopener">Action Network</a> tracks. Kalshi: price on each team\'s wins market at <a href="https://kalshi.com" target="_blank" rel="noopener">Kalshi</a>, shown once 500+ contracts have traded.</p>';
  }
  // offense rows: label, key, direction for the offense (1 = higher is better), format
  var MU_ROWS = [["EPA per play", "epa", 1, "e"], ["Success rate", "sr", 1, "p"], ["Passing", "pass", 1, "e"], ["Running", "rush", 1, "e"], ["Explosive plays", "xpl", 1, "p"], ["Sacks", "sack", -1, "p"], ["Red zone TDs", "rz", 1, "p"], ["Third downs", "3d", 1, "p"], ["Turnovers a game", "to", -1, "g"]];
  function tsFmt(v, f) { if (v == null) return "—"; return f === "e" ? (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2) : f === "p" ? (100 * v).toFixed(1) + "%" : v.toFixed(1); }
  function tsPct(side, key, v, dir) {
    if (v == null) return null;
    var vals = Object.keys(TS.teams).map(function (c) { return TS.teams[c][side][key]; }).filter(function (x) { return x != null; });
    var lo = vals.filter(function (x) { return x < v; }).length, eq = vals.filter(function (x) { return x === v; }).length;
    var p = Math.round(100 * (lo + Math.max(0, eq - 1) / 2) / Math.max(1, vals.length - 1));
    return dir > 0 ? p : 100 - p;
  }
  function muSide(off, def) {
    var o = TS.teams[off], d = TS.teams[def]; if (!o || !d) return "";
    var bar = function (pc, s) { var c = ngColor(pc), w = Math.max(4, pc); return '<i class="' + s + '"><em style="width:' + w + "%;background:" + c + '"></em><b style="' + (s === "l" ? "right" : "left") + ":calc(" + w + "% - 13px);background:" + c + ";color:" + (pc >= 80 || pc <= 20 ? "#fff" : "var(--ink)") + '">' + pc + "</b></i>"; };
    var wins = 0, loses = 0;
    var rows = MU_ROWS.map(function (r) {
      var op = tsPct("off", r[1], o.off[r[1]], r[2]), dp = tsPct("def", r[1], d.def[r[1]], -r[2]);
      if (op == null || dp == null) return "";
      if (op > dp) wins++; else if (dp > op) loses++;
      return '<div class="mu-r">' + bar(op, "l") + '<span class="mid">' + r[0] + "<small>" + tsFmt(o.off[r[1]], r[3]) + " · " + tsFmt(d.def[r[1]], r[3]) + "</small></span>" + bar(dp, "r") + "</div>";
    }).join("");
    var n = wins + loses + 0, verdict = wins > loses ? esc(off) + " offense has the edge in " + wins + " of " + MU_ROWS.length : loses > wins ? esc(def) + " defense has the edge in " + loses + " of " + MU_ROWS.length : "Even";
    return '<div class="panel"><h3>When ' + esc(team(off).short) + " have the ball <small>" + verdict + '</small></h3><div class="body"><div class="mups"><div class="mu-r mu-h"><span>' + logo(off, 18) + esc(off) + ' offense</span><span></span><span>' + esc(def) + " defense " + logo(def, 18) + "</span></div>" + rows + "</div></div></div>";
  }
  function keyPlayers(code) {
    if (!NG || NG.none) return "";
    var pick = function (pool, sortKey, nTop) {
      var idx = {}; (NG.cols[pool] || []).forEach(function (k, i) { idx[k] = i; });
      return Object.keys(NG[pool] || {}).filter(function (id) { var p = W.byId[id]; return (p ? p.t : NG[pool][id].t) === code; })
        .map(function (id) { return { id: id, d: NG[pool][id], idx: idx }; }).sort(function (a, b) { return (b.d.x[b.idx[sortKey]] || 0) - (a.d.x[a.idx[sortKey]] || 0); }).slice(0, nTop);
    };
    var chip = function (r, key, lab, dec) { var v = r.d.x[r.idx[key]], pc = r.d.pct ? r.d.pct[key] : null; if (v == null) return ""; return '<span class="ngchip" style="background:' + ngColor(pc) + ";color:" + ngInk(pc) + '"' + (pc != null ? ' title="' + ngOrd(pc) + ' percentile"' : "") + ">" + lab + " " + (dec ? (v > 0 && /^(cpoe|ryoe_att|yacoe)$/.test(key) ? "+" : "") + v.toFixed(dec) : Math.round(v)) + "</span>"; };
    var row = function (r, chips) { var p = W.byId[r.id]; return "<li>" + (p ? pname(p, 22) : esc(r.d.n)) + '<span class="grow"></span>' + chips + "</li>"; };
    var html = pick("qb", "att", 1).map(function (r) { return row(r, chip(r, "cpoe", "CPOE", 1) + chip(r, "ttt", "TTT", 2)); }).join("") +
      pick("rb", "att", 1).map(function (r) { return row(r, chip(r, "ryoe_att", "RYOE/att", 2) + chip(r, "ypc", "YPC", 1)); }).join("") +
      pick("rec", "yds", 3).map(function (r) { return row(r, chip(r, "sep", "Sep", 2) + chip(r, "yacoe", "YACOE", 1)); }).join("");
    return html ? '<div class="panel"><h3>' + logo(code, 18) + " " + esc(team(code).short) + ' key players <small>Next Gen Stats, shaded by percentile at the position</small></h3><ul class="rlist">' + html + "</ul></div>" : "";
  }
  function injPanel(code, wk) {
    var list = injuredOf(code, wk).slice(0, 12), out = W.players.some(function (p) { return p.inj && p.inj[3] >= wk; });
    return '<div class="panel"><h3>' + logo(code, 18) + " " + esc(team(code).short) + " injuries <small>" + (list.length ? "this week's report" : out ? "none listed" : "this week's report isn't out yet (it starts Wednesday)") + "</small></h3>" +
      (list.length ? '<ul class="rlist">' + list.map(function (p) { return "<li>" + pname(p, 22) + '<span class="grow sub">' + esc(posOf(p)) + (p.inj[1] ? " · " + esc(p.inj[1]) : "") + '</span><span class="num">' + esc(p.inj[0]) + "</span></li>"; }).join("") + "</ul>" : "") + "</div>";
  }
  function gamePage() {
    if (!TS) { view.innerHTML = '<p class="loading">Loading the preview…</p>'; loadWeek().then(function () { if (state.route === "game") render(); }); return; }
    var pr = String(state.arg || "").split("-"), a = pr[0], h = pr[1], wk = +state.q.w || upcomingWeek();
    var g = regGames().filter(function (x) { return x[3] === a && x[4] === h && (!state.q.w || x[1] === wk); })[0];
    if (!g) { view.innerHTML = '<p class="note">That game isn\'t on the schedule. <a href="' + href("week", {}) + '">This week\'s games</a></p>'; return; }
    wk = g[1];
    var done = g[5] != null;
    var head = '<div class="gphead">' + [a, h].map(function (c, i) { var sc = i ? g[6] : g[5]; return '<a class="gpt" href="' + href("team/" + c, {}) + '">' + logo(c, 48) + "<b>" + esc(team(c).name) + "</b><small>" + recordOf(c) + (done ? " · " + sc : "") + "</small></a>"; }).join('<span class="gpat">' + (g[8] ? "vs" : "at") + "</span>") + "</div>";
    var meta = '<p class="gpmeta">' + (done ? "Final" : kickTxt(g)) + " · Week " + wk + (g[9] ? " · Division game" : "") + " · Line <b>" + lineOf(g) + "</b></p>";
    var ts = TS.teams[a] && TS.teams[h];
    view.innerHTML = '<p class="back"><a href="' + href("week", { w: wk }) + '">← Week ' + wk + "</a></p>" + head + meta + betLine(g, true) +
      (ts ? '<div class="two">' + muSide(a, h) + muSide(h, a) + '</div><p class="note">Percentiles against all 32 teams this season, each side\'s offense next to the other\'s defense: red is good, blue is bad, and the bigger number wins the row. EPA per play, success rate, passing, running and explosive plays leave out garbage time. From nflverse play-by-play through week ' + TS.week + ".</p>" : '<p class="note">Team numbers are still loading from the play-by-play.</p>') +
      '<div class="two"><div>' + keyPlayers(a) + injPanel(a, wk) + "</div><div>" + keyPlayers(h) + injPanel(h, wk) + "</div></div>";
  }

  // ---------- league ----------
  function leaguePage() {
    var rows = codes().map(function (c) {
      var ty = C.teamYears(W, c, [], 2026, 2028), cc = C.creditCard(W, c, 2026);
      return { c: c, ty: ty, cc: cc };
    });
    var sort = state.q.s || "s27";
    var key = { s26: function (r) { return -r.ty[0].space; }, s27: function (r) { return -r.ty[1].space; }, s28: function (r) { return -r.ty[2].space; }, dead: function (r) { return -r.ty[0].dead; }, card: function (r) { return -r.cc.future; } }[sort] || function (r) { return -r.ty[1].space; };
    rows.sort(function (a, b) { return key(a) - key(b); });
    var th = function (k, l) { return '<th><a href="' + href("cap", { s: k }) + '"' + (k === sort ? ' class="on"' : "") + ">" + l + "</a></th>"; };
    var html = '<h2 class="sec">The league\'s cap</h2><p class="lede">Every team\'s cap space this season and the next two, the dead money it\'s already carrying, and the bill it has pushed into future years with signing bonuses, restructures and void years. Click a team to plan its offseason.</p>';
    html += tablePanel("All 32 teams", "<th>Team</th>" + th("s26", "2026 space") + th("s27", "2027 space") + th("s28", "2028 space") + th("dead", "2026 dead money") + th("card", "Pushed into later years") + "<th>In void years</th>",
      rows.map(function (r) {
        return '<tr class="go" data-team="' + r.c + '"><td class="tm">' + logo(r.c) + '<span class="nm">' + esc(team(r.c).name) + "</span></td>" + r.ty.map(function (t) { return '<td class="' + (t.space >= 0 ? "pos" : "neg") + '">' + m(t.space) + "</td>"; }).join("") +
          "<td>" + m(r.ty[0].dead) + "</td><td>" + m(r.cc.future) + "</td><td>" + (r.cc.voids > 0.05 ? m(r.cc.voids) : "—") + "</td></tr>";
      }).join(""), "2026 and 2027 cap and dead money from Over The Cap; later years from each contract");
    view.innerHTML = html;
  }
  view.addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-team]");
    if (tr && !e.target.closest("[data-p]")) { location.hash = href("team/" + tr.dataset.team); return; }
    var p = e.target.closest("[data-p]");
    if (p && !e.target.closest("select") && !(e.target.closest("button") && !e.target.closest("button").dataset.p)) openCard(p.dataset.p);
  });

  // ---------- standings by division ----------
  function rec(r) { return r.w + "-" + r.l + (r.t ? "-" + r.t : ""); }
  function pctTxt(x) { return x >= 0.995 ? ">99%" : x > 0 && x < 0.005 ? "<1%" : Math.round(x * 100) + "%"; }
  function bar(x, cls) { return '<span class="obar ' + (cls || "") + '"><i style="width:' + Math.max(0, Math.min(100, x * 100)).toFixed(1) + '%"></i><b>' + pctTxt(x) + "</b></span>"; }
  function divCard(d) {
    var ts = S.DIV[d].slice().sort(function (a, b) { return SIM.teams[b].wins - SIM.teams[a].wins; });
    return '<div class="dcard"><h4>' + esc(d) + '</h4><div class="drows"><div class="dhd"><span>Team</span><span>Now</span><span>Proj.</span><span>Division</span><span>Playoffs</span><span>Title</span></div>' + ts.map(function (t) {
      var o = SIM.teams[t], w = o.wins;
      return '<a class="drow3" href="' + href("team/" + t) + '" style="--tc:' + team(t).color + '">' + '<span class="tn">' + logo(t, 26) + "<b>" + esc(team(t).short) + "</b></span><span>" + rec(o.rec) + "</span><span>" + w.toFixed(1) + "-" + (17 - w).toFixed(1) + "</span>" +
        "<span>" + bar(o.div, "dv") + "</span><span>" + bar(o.playoffs, "po") + '</span><span class="sbp">' + pctTxt(o.sb) + "</span></a>";
    }).join("") + "</div></div>";
  }
  function standingsPage() {
    var html = '<h2 class="sec">Standings and odds</h2><p class="lede">Every division with each team\'s record, projected final record and its odds to win the division, make the playoffs and win the Super Bowl, from the rest of the season played ' + SIM.sims.toLocaleString() + " times. Team strength comes from the betting market's point spreads and this season's scoring margins.</p>";
    ["AFC", "NFC"].forEach(function (cf) {
      html += '<h3 class="subsec">' + cf + '</h3><div class="divgrid">' + Object.keys(S.DIV).filter(function (d) { return d.indexOf(cf) === 0; }).map(divCard).join("") + "</div>";
    });
    // the playoff picture: most likely seeds right now
    html += '<div class="two">' + ["AFC", "NFC"].map(function (cf) {
      var ts = Object.keys(SIM.teams).filter(function (t) { return S.confOf[t] === cf; }).sort(function (a, b) { return SIM.teams[b].playoffs - SIM.teams[a].playoffs || SIM.teams[b].wins - SIM.teams[a].wins; });
      return tablePanel(cf + " playoff race", "<th>Team</th><th>Proj. wins</th><th>Bye</th><th>Playoffs</th><th>Conference</th><th>Super Bowl</th>", ts.map(function (t, i) {
        var o = SIM.teams[t];
        return '<tr class="go' + (i === 7 ? " cutline" : "") + '" data-team="' + t + '"><td class="tm">' + logo(t) + '<span class="nm">' + esc(team(t).short) + "</span></td><td>" + o.wins.toFixed(1) + "</td><td>" + pctTxt(o.bye) + "</td><td><b>" + pctTxt(o.playoffs) + "</b></td><td>" + pctTxt(o.conf) + "</td><td>" + pctTxt(o.sb) + "</td></tr>";
      }).join(""), "seven make it; the top seed gets the bye");
    }).join("") + "</div>";
    view.innerHTML = html;
  }

  // ---------- team picker by division ----------
  function teamsPage() {
    var html = '<h2 class="sec">Teams</h2><p class="lede">Each team\'s outlook, depth chart, schedule and cap planner.</p>';
    ["AFC", "NFC"].forEach(function (cf) {
      html += '<h3 class="subsec">' + cf + '</h3><div class="divgrid">' + Object.keys(S.DIV).filter(function (d) { return d.indexOf(cf) === 0; }).map(function (d) {
        return '<div class="dcard"><h4>' + esc(d) + '</h4><div class="tiles">' + S.DIV[d].map(function (t) {
          var o = SIM.teams[t], ty = C.teamYears(W, t, [], 2027, 2027)[0];
          return '<a class="tile" href="' + href("team/" + t) + '" style="--tc:' + team(t).color + '">' + logo(t, 40) + "<span><b>" + esc(team(t).short) + "</b><small>" + rec(o.rec) + " · proj. " + o.wins.toFixed(1) + " wins</small><small>" + pctTxt(o.playoffs) + " playoffs · " + m(ty.space) + " 2027 space</small></span></a>";
        }).join("") + "</div></div>";
      }).join("") + "</div>";
    });
    view.innerHTML = html;
  }

  // ---------- player rankings ----------
  var STAT_IDX = null, BASE = null;
  // League-average EPA per carry and per target: a run usually loses expected points, so raw rushing EPA is negative
  // for most backs and punishes the ones who carry the most. Players are measured against the average instead.
  function baselines() {
    if (BASE) return BASE;
    var t = { c: 0, re: 0, tg: 0, ce: 0 };
    Object.keys(W.stats.p).forEach(function (id) { var v = W.stats.p[id], ci = STAT_IDX; t.c += v[ci.carries]; t.re += v[ci.rushing_epa]; t.tg += v[ci.targets]; t.ce += v[ci.receiving_epa]; });
    BASE = { rush: t.c ? t.re / t.c : 0, rec: t.tg ? t.ce / t.tg : 0 };
    return BASE;
  }
  function epaOA(s, kind) {
    var b = baselines();
    var r = s.rushing_epa - s.carries * b.rush, c = s.receiving_epa - s.targets * b.rec;
    return kind === "rush" ? r : kind === "rec" ? c : r + c;
  }
  function st(p) {
    if (!W.stats || !W.stats.p[p.id]) return null;
    if (!STAT_IDX) { STAT_IDX = {}; W.stats.cols.forEach(function (c, i) { STAT_IDX[c] = i; }); }
    var v = W.stats.p[p.id], o = {};
    Object.keys(STAT_IDX).forEach(function (k) { o[k] = v[STAT_IDX[k]]; });
    return o;
  }
  // production score by position group (this season's box score; linemen have none, so they rank by snaps)
  var RANK = {
    QB: { min: function (s) { return s.attempts >= 60; }, score: function (s) { return s.passing_epa + s.rushing_epa; }, cols: [["Att", "attempts"], ["Yds", "passing_yards"], ["TD", "passing_tds"], ["INT", "passing_interceptions"], ["Rush yds", "rushing_yards"], ["EPA", null]] },
    RB: { min: function (s) { return s.carries + s.receptions >= 30; }, score: function (s) { return s.rushing_yards + s.receiving_yards + 20 * (s.rushing_tds + s.receiving_tds) + 6 * epaOA(s); }, cols: [["Car", "carries"], ["Rush yds", "rushing_yards"], ["Yds/car", "ypc"], ["Rec", "receptions"], ["Rec yds", "receiving_yards"], ["TD", "tds"], ["EPA vs avg", "oa"]] },
    WR: { min: function (s) { return s.targets >= 15; }, score: function (s) { return s.receiving_yards + 20 * s.receiving_tds + 6 * epaOA(s, "rec"); }, cols: [["Tgt", "targets"], ["Rec", "receptions"], ["Yds", "receiving_yards"], ["TD", "receiving_tds"], ["EPA vs avg", "oaRec"]] },
    TE: { min: function (s) { return s.targets >= 10; }, score: function (s) { return s.receiving_yards + 20 * s.receiving_tds + 6 * epaOA(s, "rec"); }, cols: [["Tgt", "targets"], ["Rec", "receptions"], ["Yds", "receiving_yards"], ["TD", "receiving_tds"], ["EPA vs avg", "oaRec"]] },
    EDGE: { min: function (s) { return s.games >= 3; }, score: function (s) { return 3 * s.def_sacks + s.def_qb_hits + 1.5 * s.def_tackles_for_loss + 2 * s.def_fumbles_forced + 0.15 * (s.def_tackles_solo + 0.5 * s.def_tackle_assists); }, cols: [["Sacks", "def_sacks"], ["QB hits", "def_qb_hits"], ["TFL", "def_tackles_for_loss"], ["FF", "def_fumbles_forced"], ["Tkl", "tkl"]] },
    IDL: { min: function (s) { return s.games >= 3; }, score: function (s) { return 3 * s.def_sacks + s.def_qb_hits + 1.5 * s.def_tackles_for_loss + 2 * s.def_fumbles_forced + 0.2 * (s.def_tackles_solo + 0.5 * s.def_tackle_assists); }, cols: [["Sacks", "def_sacks"], ["QB hits", "def_qb_hits"], ["TFL", "def_tackles_for_loss"], ["FF", "def_fumbles_forced"], ["Tkl", "tkl"]] },
    LB: { min: function (s) { return s.games >= 3; }, score: function (s) { return 0.4 * (s.def_tackles_solo + 0.5 * s.def_tackle_assists) + 1.5 * s.def_tackles_for_loss + 3 * s.def_sacks + 4 * s.def_interceptions + 1.5 * s.def_pass_defended + 2 * s.def_fumbles_forced; }, cols: [["Tkl", "tkl"], ["TFL", "def_tackles_for_loss"], ["Sacks", "def_sacks"], ["INT", "def_interceptions"], ["PD", "def_pass_defended"]] },
    CB: { min: function (s) { return s.games >= 3; }, score: function (s) { return 5 * s.def_interceptions + 2 * s.def_pass_defended + 0.3 * (s.def_tackles_solo + 0.5 * s.def_tackle_assists) + 2 * s.def_fumbles_forced + s.def_tackles_for_loss; }, cols: [["INT", "def_interceptions"], ["PD", "def_pass_defended"], ["Tkl", "tkl"], ["FF", "def_fumbles_forced"]] },
    S: { min: function (s) { return s.games >= 3; }, score: function (s) { return 5 * s.def_interceptions + 2 * s.def_pass_defended + 0.35 * (s.def_tackles_solo + 0.5 * s.def_tackle_assists) + 2 * s.def_fumbles_forced + s.def_tackles_for_loss + 2 * s.def_sacks; }, cols: [["INT", "def_interceptions"], ["PD", "def_pass_defended"], ["Tkl", "tkl"], ["TFL", "def_tackles_for_loss"], ["FF", "def_fumbles_forced"]] },
    K: { min: function (s) { return s.fg_att >= 5; }, score: function (s) { return s.fg_made - 2 * (s.fg_att - s.fg_made) + 0.05 * s.fg_long; }, cols: [["FG", "fg_made"], ["Att", "fg_att"], ["Long", "fg_long"]] }
  };
  var ONE = { QB: "quarterback", RB: "running back", WR: "wide receiver", TE: "tight end", OT: "tackle", IOL: "interior lineman", EDGE: "edge rusher", IDL: "interior defensive lineman", LB: "linebacker", CB: "cornerback", S: "safety", K: "kicker", P: "punter", LS: "long snapper" };
  var GROUP_NAME = { QB: "Quarterbacks", RB: "Running backs", WR: "Wide receivers", TE: "Tight ends", OT: "Offensive tackles", IOL: "Interior line", EDGE: "Edge rushers", IDL: "Interior defensive line", LB: "Linebackers", CB: "Cornerbacks", S: "Safeties", K: "Kickers" };
  function statVal(s, key) {
    if (key === "tkl") return s.def_tackles_solo + s.def_tackle_assists;
    if (key === "tds") return s.rushing_tds + s.receiving_tds;
    if (key === "epa2") return s.rushing_epa + s.receiving_epa;
    if (key === "oa") return epaOA(s);
    if (key === "oaRec") return epaOA(s, "rec");
    if (key === "ypc") return s.carries ? Math.round(s.rushing_yards / s.carries * 10) / 10 : 0;
    if (key === null) return s.passing_epa + s.rushing_epa;
    return s[key];
  }
  function playersPage() {
    var g = state.q.g || "QB", tm = state.q.t || "";
    var list = W.players.filter(function (p) { return P.group(p) === g && (!tm || p.t === tm) && p.st !== "DEV"; });
    var R = RANK[g], rows;
    // ranked on the player rating; anyone playing real snaps or with a real box score qualifies
    // anyone playing this season: a real box score, or a real share of snaps over three or more games
    rows = list.map(function (p) { var s = st(p), q = P.quality(W, p), ok = (s && s.games >= 3 && (!R || R.min(s))) || (p.snaps && p.snaps[3] >= 3 && P.share(W, p) > 0.35); return ok ? { p: p, s: s, score: q.z } : null; })
      .filter(Boolean).sort(function (a, b) { return b.score - a.score; });
    var html = '<h2 class="sec">Player rankings</h2><p class="lede">Ranked by the player rating (50 is an average starter-level player at the position): his on-field plus-minus from the last two seasons of play-by-play, blended with this season\'s production. EPA is expected points added: how much each play moved the team\'s chances of scoring. The average run loses a little (' + baselines().rush.toFixed(2) + " per carry) and the average target gains some (+" + baselines().rec.toFixed(2) + "), so backs and receivers are measured against those averages: \"EPA vs avg\" is how many points better than an average player he's been on his touches." + ' Linemen have no box-score stats, so their rating is all on-field. Tap a player for his stats, game log and contract.</p>';
    html += '<div class="controls"><label>Position<select data-q="g">' + Object.keys(GROUP_NAME).map(function (k) { return '<option value="' + k + '"' + (k === g ? " selected" : "") + ">" + GROUP_NAME[k] + "</option>"; }).join("") + '</select></label><label>Team<select data-q="t"><option value="">All teams</option>' + codes().map(function (c) { return '<option value="' + c + '"' + (c === tm ? " selected" : "") + ">" + esc(team(c).name) + "</option>"; }).join("") + "</select></label></div>";
    var cols = (R ? R.cols : []).concat([["Snaps", "_share"]]);
    // Next Gen Stats beside the rating for the skill spots, shaded by percentile at the position (loads after the page)
    var NGK = { QB: [["CPOE", "cpoe", 1], ["Time to throw", "ttt", 2]], RB: [["RYOE/att", "ryoe_att", 2], ["Beat exp.", "beat", 1]], WR: [["Separation", "sep", 2], ["YAC over exp.", "yacoe", 2]], TE: [["Separation", "sep", 2], ["YAC over exp.", "yacoe", 2]] }[g] || [];
    if (NGK.length && !NG) loadNgs().then(function () { if (state.route === "players") render(); });
    var ngPoolK = ngPool(g), ngIdx = {};
    if (NG && NG.cols && NG.cols[ngPoolK]) NG.cols[ngPoolK].forEach(function (k, i) { ngIdx[k] = i; });
    var ngCell = function (p, c) {
      var d = NG && NG[ngPoolK] && NG[ngPoolK][p.id];
      if (!d) return "<td>" + (NG ? "—" : "…") + "</td>";
      var v = d.x[ngIdx[c[1]]], pc = (d.pct || {})[c[1]];
      return pc == null ? "<td>" + ngFmt(v, c[2]) + "</td>" : '<td class="ngc" style="background:' + ngColor(pc) + ";color:" + ngInk(pc) + '" title="' + ngOrd(pc) + ' percentile">' + ngFmt(v, c[2]) + "</td>";
    };
    html += tablePanel(GROUP_NAME[g] + " · " + rows.length, "<th>#</th><th>Player</th><th>Team</th><th>Age</th><th>Rating</th><th>G</th>" + cols.map(function (c) { return "<th>" + c[0] + "</th>"; }).join("") + NGK.map(function (c) { return '<th title="Next Gen Stats, qualified players">' + c[0] + "</th>"; }).join("") + "<th>2026 cap</th><th>Value</th>",
      rows.slice(0, 100).map(function (x, i) {
        var p = x.p, s = x.s || {};
        return "<tr><td>" + (i + 1) + "</td><td>" + pname(p, 24, x.cc ? ' <span class="pill warn" title="' + esc(x.cc.why) + '">cap casualty?</span>' : "") + '</td><td class="tm">' + logo(p.t, 18) + '<span class="nm">' + esc(p.t) + "</span></td><td>" + (p.age ? Math.floor(p.age) : "—") + "</td><td>" + scoreChip(p) + "</td><td>" + (s.games || (p.snaps ? p.snaps[3] : "—")) + "</td>" +
          cols.map(function (c) { if (c[1] === "_share") return "<td>" + Math.round(P.share(W, p) * 100) + "%</td>"; var v = statVal(s, c[1]); return "<td>" + (v == null ? "—" : Math.abs(v % 1) > 0.001 ? v.toFixed(1) : v) + "</td>"; }).join("") +
          NGK.map(function (c) { return ngCell(p, c); }).join("") +
          "<td>" + m(C.capHit(p, 2026)) + "</td><td>" + m(P.value(W, p, 2026)) + "</td></tr>";
      }).join(""), "ranked on the player rating: on-field plus-minus and three seasons of production", "rank");
    view.innerHTML = html;
  }
  view.addEventListener("change", function (e) {
    var gmo = e.target.closest("[data-gmon]");
    if (gmo) { var q4 = Object.assign({}, state.q); q4[gmo.dataset.gmon] = gmo.checked ? "1" : null; location.hash = href(state.route + "/" + state.arg, q4); return; }
    var gmk = e.target.closest("[data-gm]");
    if (gmk) { var q2 = Object.assign({}, state.q); q2[gmk.dataset.gm] = gmk.checked ? null : "0"; location.hash = href(state.route + "/" + state.arg, q2); return; }
    var ck = e.target.closest("[data-qchk]");
    if (ck) { var q1 = Object.assign({}, state.q); q1[ck.dataset.qchk] = ck.checked ? "1" : null; location.hash = href(state.route + (state.arg ? "/" + state.arg : ""), q1); return; }
    var c = e.target.closest("[data-q]");
    if (!c) return;
    var q = Object.assign({}, state.q); q[c.dataset.q] = c.value || null;
    location.hash = href(state.route + (state.arg ? "/" + state.arg : ""), q);
  });


  // ---------- draft picks a team has to sign ----------
  function picksCard(code) {
    var html = '<div class="card-h">' + logo(code, 48) + "<div><h3>" + esc(team(code).name) + ' draft picks</h3><div class="meta">Rookie cap hits by year, from the current draft order</div></div></div><div class="card-b">';
    [W.season + 1, W.season + 2].forEach(function (y) {
      var rc = P.rookieCost(W, code, y), list = rc.list;
      html += '<h4 class="card-sec">' + y + " draft" + (y > W.season + 1 ? " (rough: spots from the " + (y - 1) + " power ranking)" : " (expected spots from the season sim)") + '</h4><div class="scroll"><table class="t"><thead><tr><th>Expected pick</th><th>Round</th><th>From</th><th>' + y + " cap hit</th><th>Counts against space</th></tr></thead><tbody>" +
        list.map(function (x) { return "<tr><td>" + (x.en || x.n) + "</td><td>" + x.round + "</td><td>" + (x.from !== code ? logo(x.from, 16) + " " + esc(x.from) : "Own") + "</td><td>" + m(x.hit) + "</td><td>" + m(x.eff) + "</td></tr>"; }).join("") +
        '<tr class="tot"><td colspan="4">Total</td><td>' + m(list.reduce(function (a, x) { return a + x.eff; }, 0)) + "</td></tr></tbody></table></div>";
    });
    html += '<p class="note">Rookie salaries follow the slot: this year\'s class\'s contracts by pick, grown with the cap. "Counts against space" takes off the minimum salary of the player each rookie pushes off the top 51, the way Over The Cap counts effective cap space.</p></div>';
    cardBody.innerHTML = html;
    if (!card.open) card.showModal();
  }

  // ---------- team draft tab: the picks it owns this year and next, where they're likely to land ----------
  function draftTab(code) {
    var t = team(code), html = "", curve = P.rookieCurve(W), NT = P.needs(W, W.season + 1)[code];
    if (NT.top.length) html += '<p class="note">Positions to target: ' + NT.top.map(function (x) { return "<b>" + esc(GROUP_SHORT[x.g]) + "</b> (" + x.grade + ")"; }).join(", ") + '. See the <a href="' + href("team/" + code, { v: "overview" }) + '">roster grades</a>.</p>';
    [W.season + 1, W.season + 2].forEach(function (y) {
      var next = y === W.season + 1, picks = P.picksIn(W, code, y), out = P.picksOut(W, code, y), sl = P.slots(W, y)[code], grow = Math.pow(1.07, y - W.season);
      var rc = {}; P.rookieCost(W, code, y).list.forEach(function (x) { rc[x.round + ":" + x.from + ":" + (x.en || x.n)] = x; });
      var firstPk = picks[0], cost = picks.reduce(function (a, x) { return a + curve[Math.min(262, x.en)] * grow * 0.85; }, 0);
      html += '<div class="panel"><h3>' + y + " draft <small>" + (next ? "own slot expected at No. " + (sl ? sl.slot.toFixed(1) : "?") + " in each round (80% range " + (sl ? sl.lo + "-" + sl.hi : "?") + "), from " + (W.sim ? W.sim.sims : "") + " simulated seasons" : "rough: slots from the " + (y - 1) + " power ranking; each team's own seven unless traded") + "</small></h3>";
      html += '<div class="stats sm">' + stat(picks.length, "Picks") + stat(picks.filter(function (x) { return x.round <= 3; }).length, "In rounds 1-3") + stat(firstPk ? "No. " + firstPk.en : "—", "First pick (expected)") + stat(m(cost), "Rookie class, year-one cap") + "</div>";
      // the board: 32 slots per round, his picks marked at their expected spot, the likely range shaded
      html += '<div class="dboard" style="--tc:' + t.color + '">' + [1, 2, 3, 4, 5, 6, 7].map(function (rd) {
        var mine = picks.filter(function (x) { return x.round === rd; });
        var cells = "";
        for (var k = 1; k <= 32; k++) {
          var at = mine.filter(function (x) { return Math.min(32, Math.max(1, x.k)) === k; })[0];
          var inR = mine.some(function (x) { return x.klo && k >= x.klo && k <= x.khi; });
          cells += '<i class="' + (at ? "pk" + (at.from !== code ? " via" : "") : inR ? "rg" : "") + '"' + (at ? ' title="Round ' + rd + ", expected No. " + at.en + (at.from !== code ? " (from " + at.from + ")" : "") + '"' : "") + "></i>";
        }
        return '<div class="drow"><span>R' + rd + "</span><div>" + cells + "</div></div>";
      }).join("") + '<div class="dlegend"><span><i class="pk"></i>own pick</span><span><i class="pk via"></i>from another team</span><span><i class="rg"></i>likely range</span></div></div>';
      html += '<div class="scroll"><table class="t"><thead><tr><th>Round</th>' + (next ? "<th>Pick today</th>" : "") + "<th>Expected</th><th>Likely range</th><th>From</th><th>Rookie deal (4 yrs)</th><th>" + y + " cap</th></tr></thead><tbody>" +
        (picks.length ? picks.map(function (x) {
          var apy = curve[Math.min(262, x.en)] * grow;
          return "<tr><td>" + x.round + (x.comp ? ' <span class="pill">comp</span>' : "") + "</td>" + (next ? "<td>" + x.n + "</td>" : "") + "<td><b>" + x.en + "</b></td><td>" + (x.lo ? x.lo + "-" + x.hi : "—") + "</td><td>" + (x.from !== code ? logo(x.from, 16) + " " + esc(x.from) + (x.cond ? ' <span class="pill warn">conditional</span>' : "") : "Own") + "</td><td>" + m(apy * 4) + "</td><td>" + m(apy * 0.85) + "</td></tr>";
        }).join("") : '<tr><td colspan="7" class="note">No picks.</td></tr>') + "</tbody></table></div>";
      if (out.length) html += '<p class="note"><b>Traded away:</b> ' + out.map(function (x) { return "round " + x.round + (x.n ? " (No. " + x.n + ")" : "") + " to " + esc(x.to) + (x.cond === "cond" ? " (conditional)" : ""); }).join(", ") + ".</p>";
      html += "</div>";
    });
    html += '<p class="note">Who owns what: the Big Board\'s draft order (Tankathon, by today\'s records) and its list of future picks already traded. Expected spots: in each simulated season, teams that miss the playoffs pick worst record first, then playoff teams by the round they went out in. Compensatory picks keep their spot. Rookie deals follow the slot: this year\'s class\'s contracts by pick, grown with the cap. <a href="../draft/">Mock the draft on the Big Board</a>.</p>';
    return html;
  }

  // ---------- contracts: every deal's value against its cost, league-wide ----------
  // Value: each season left on his deal (the rest of this one, then the full seasons) at what his play is worth
  // (P.value: his position's starter price, his healthy role and rating). Surplus: value minus cap hits. Trade value:
  // the Trade value tab's price in draft picks (talent above replacement plus the contract's bonus or drag).
  function contractRow(p) {
    var last = Math.min(C.lastYear(p) || W.season, W.season + 4), left = P.seasonLeft(W), v = 0, c = 0;
    for (var y = W.season; y <= last; y++) {
      var r = p.c.rows[y]; if (!r || r[C.R.void]) continue;
      var part = y === W.season ? left : 1;
      v += P.value(W, p, y) * part; c += C.capHit(p, y) * part;
    }
    return { p: p, v: v, c: c, s: v - c, last: last, tv: tvOf(p) };
  }
  function contractsPage() {
    var q = state.q, g = q.g || "", tm = q.t || "", sk = q.sort || "s", asc = /-asc$/.test(sk), base = sk.replace(/-asc$/, "");
    if (!W._contracts) W._contracts = W.players.filter(function (p) { return p.c && p.c.rows && p.st !== "DEV" && (C.lastYear(p) || 0) >= W.season && C.capHit(p, W.season) > 1.2; }).map(contractRow);
    var list = W._contracts.filter(function (x) { return (!g || P.group(x.p) === g) && (!tm || x.p.t === tm) && (!q.s0 || x.p.n.toLowerCase().indexOf(q.s0.toLowerCase()) >= 0); });
    var key = { s: function (x) { return x.s; }, tv: function (x) { return x.tv.pts; }, v: function (x) { return x.v; }, c: function (x) { return x.c; }, r: function (x) { return P.quality(W, x.p).z; }, age: function (x) { return -(x.p.age || 30); } }[base] || function (x) { return x.s; };
    list = list.slice().sort(function (a, b) { return asc ? key(a) - key(b) : key(b) - key(a); }).slice(0, 150);
    var th = function (k, l, tip) { var on = base === k, nx = on && !asc ? k + "-asc" : k; return "<th" + (on ? ' class="on" aria-sort="' + (asc ? "ascending" : "descending") + '"' : "") + (tip ? ' title="' + esc(tip) + '"' : "") + '><a href="' + href("contracts", Object.assign({}, q, { sort: nx === "s" ? null : nx })) + '">' + l + "</a></th>"; };
    var opt = function (v, l, cur) { return '<option value="' + v + '"' + (v === cur ? " selected" : "") + ">" + l + "</option>"; };
    var html = '<h2 class="sec">Contracts and value</h2><p class="lede">Every deal in the league: what the player is worth over the rest of his contract against what it costs under the cap, and what he\'d bring in a trade. <a href="' + href("method") + '#value">How it works</a>.</p>';
    html += '<div class="controls"><label>Position<select data-q="g">' + opt("", "All positions", g) + Object.keys(GROUP_NAME).map(function (k) { return opt(k, GROUP_NAME[k], g); }).join("") + "</select></label>" +
      '<label>Team<select data-q="t">' + opt("", "All teams", tm) + codes().map(function (c) { return opt(c, team(c).name, tm); }).join("") + "</select></label>" +
      '<label>Sort<select data-q="sort">' + opt("", "Most surplus", q.sort || "") + opt("s-asc", "Worst contracts", q.sort || "") + opt("tv", "Best trade value", q.sort || "") + "</select></label>" +
      '<label class="grow">Search<input type="search" data-q="s0" value="' + esc(q.s0 || "") + '" placeholder="Player"></label></div>';
    html += tablePanel("Contracts", '<th>Player</th><th>Team</th><th>Pos</th>' + th("age", "Age") + th("r", "Rating", "50 is an average player at his position") + "<th>Thru</th>" + th("v", "Value", "What his play is worth over the rest of his deal") + th("c", "Cap", "His cap hits over the rest of his deal") + th("s", "Surplus", "Value minus cap hits") + th("tv", "Trade value", "What he'd bring in a trade, in draft picks"),
      list.map(function (x) {
        var p = x.p, pr = P.priceText(x.tv.pts);
        return "<tr><td>" + pname(p, 22) + '</td><td class="tm">' + logo(p.t, 18) + '<span class="nm">' + esc(p.t) + "</span></td><td>" + esc(P.group(p)) + "</td><td>" + (p.age ? Math.floor(p.age) : "—") + "</td><td>" + scoreChip(p) + "</td><td>" + x.last + "</td><td>" + m(x.v) + "</td><td>" + m(x.c) +
          '</td><td class="' + (x.s >= 0 ? "pos" : "neg") + '"><b>' + sm(x.s) + '</b></td><td title="' + esc(pr.long) + ' (' + Math.round(x.tv.pts) + ' points)">' + esc(pr.short) + "</td></tr>";
      }).join(""), list.length >= 150 ? "Top 150 shown" : list.length + " contracts", "tcon");
    view.innerHTML = html;
  }

  // ---------- trade value: pick a player, see what picks it takes to get him ----------
  function pickChip(pk, code) {
    return '<span class="pchip' + (pk.yr > W.season + 1 ? " fut" : "") + '"><b>' + pk.yr + " R" + pk.round + "</b> No. " + pk.en + (pk.from !== code ? " <small>via " + esc(pk.from) + "</small>" : "") + "</span>";
  }
  function asPicksText(pts) { return P.priceText(pts).long; }
  function tvPool() { return W.players.filter(function (p) { return p.c && p.st !== "DEV" && C.lastYear(p) > W.season && P.role(W, p) >= 0.5 && P.quality(W, p).z > -0.5; }); }
  function tvOf(p) { W._tvc = W._tvc || {}; return W._tvc[p.id] || (W._tvc[p.id] = P.tradeValue(W, p)); }
  function tvAll() {
    if (W._tvAll) return W._tvAll;
    W._tvAll = tvPool().map(function (p) { return { p: p, tv: tvOf(p) }; });
    return W._tvAll;
  }
  // after the first screen is up, work out trade values a few dozen at a time while the phone is idle, so the
  // Trade value tab opens instantly later
  function warmTrade() {
    var pool = tvPool(), i = 0, idle = window.requestIdleCallback || function (f) { return setTimeout(function () { f({ timeRemaining: function () { return 8; } }); }, 50); };
    var step = function (dl) { var t0 = Date.now(); while (i < pool.length && (dl.timeRemaining() > 2 || Date.now() - t0 < 8)) tvOf(pool[i++]); if (i < pool.length) idle(step); };
    idle(step);
  }
  function pickCurve(marks) {
    var w = Math.max(340, Math.min(1100, (view.clientWidth || 900) - 24)), h = w < 600 ? 170 : 220, padL = 40, padB = 24, X = function (n) { return padL + Math.sqrt((n - 1) / 259) * (w - padL - 10); }, Y = function (v) { return 8 + (1 - v / 1000) * (h - padB - 8); };
    var d = ""; for (var n = 1; n <= 260; n += (n < 40 ? 1 : 4)) d += (d ? "L" : "M") + X(n).toFixed(1) + "," + Y(P.pickPoints(n)).toFixed(1);
    var svg = '<svg class="pcurve" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="Draft pick value chart">';
    [0, 250, 500, 750, 1000].forEach(function (v) { svg += '<line x1="' + padL + '" x2="' + (w - 10) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" class="grid"/><text x="' + (padL - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + v + "</text>"; });
    [1, 10, 32, 64, 100, 160, 224].forEach(function (n) { svg += '<text x="' + X(n) + '" y="' + (h - 6) + '" text-anchor="middle">' + n + "</text>"; });
    svg += '<path d="' + d + '" class="line"/>';
    (marks || []).forEach(function (mk) {
      if (mk.kind === "player") { var n = Math.max(1, mk.n); svg += '<line x1="' + X(n) + '" x2="' + X(n) + '" y1="' + Y(Math.min(1000, mk.pts)) + '" y2="' + (h - padB) + '" class="mk"/><circle cx="' + X(n) + '" cy="' + Y(Math.min(1000, mk.pts)) + '" r="6" class="mkdot"/><text x="' + (X(n) + 9) + '" y="' + (Y(Math.min(1000, mk.pts)) - 6) + '" class="mklab">' + esc(mk.label) + "</text>"; }
      else svg += '<circle cx="' + X(mk.n) + '" cy="' + Y(mk.pts) + '" r="4" class="pk' + (mk.fut ? " fut" : "") + '"><title>' + esc(mk.label) + "</title></circle>";
    });
    return svg + "</svg>";
  }
  // This season's trade deadline (4 p.m. ET); before it, a trade can happen now
  var DEADLINE = new Date("2026-11-10T21:00:00Z");
  function tradePage() {
    var id = state.q.p, p = id && W.byId[id], open = Date.now() < DEADLINE.getTime();
    var when = state.q.w === "post" ? "post" : state.q.w === "pre" ? "pre" : open ? "now" : "pre";
    var buyer = state.q.t && TEAMS[state.q.t] && (!p || state.q.t !== p.t) ? state.q.t : null;
    var html = '<h2 class="sec">Trade value</h2><p class="lede">Pick a player and the team trading for him. He\'s priced in draft picks: what he\'s worth on the field above a replacement-level player (aging included), adjusted for what the new team would pay him against his market, on the same kind of chart teams use to trade picks for picks. Then it builds the offer from both teams\' actual picks that lands closest, and shows the money on each side.</p>';
    var opts = W.players.filter(function (q) { return q.c && q.st !== "DEV"; }).sort(function (a, b) { return a.n.localeCompare(b.n); });
    html += '<div class="controls"><label class="grow">Player<input list="tvlist" data-tradep placeholder="Type a name" value="' + (p ? esc(p.n + " · " + p.t + " " + posOf(p)) : "") + '"><datalist id="tvlist">' + opts.map(function (q) { return '<option value="' + esc(q.n + " · " + q.t + " " + posOf(q)) + '">'; }).join("") + "</datalist></label>" +
      '<label>Trading for him<select data-q="t"><option value="">Pick a team</option>' + codes().filter(function (c) { return !p || c !== p.t; }).map(function (c) { return '<option value="' + c + '"' + (c === buyer ? " selected" : "") + ">" + esc(team(c).name) + "</option>"; }).join("") + "</select></label>" +
      '<label>When<select data-q="w">' + (open ? '<option value="now"' + (when === "now" ? " selected" : "") + ">Now, before today's deadline (4 p.m. ET)</option>" : "") + '<option value="pre"' + (when === "pre" ? " selected" : "") + ">" + (W.season + 1) + ' offseason, before June 1</option><option value="post"' + (when === "post" ? " selected" : "") + ">" + (W.season + 1) + " offseason, after June 1</option></select></label></div>";
    if (!p) {
      var all = tvAll().slice().sort(function (a, b) { return b.tv.pts - a.tv.pts; });
      html += tablePanel("Most valuable trade assets", "<th>#</th><th class=\"lft\">Player</th><th>Team</th><th>Pos</th><th>Age</th><th>Rating</th><th>Signed through</th><th>Trade price</th><th>Points</th>",
        all.slice(0, 40).map(function (x, i) { var n = P.pickForPoints(x.tv.pts); return "<tr><td>" + (i + 1) + '</td><td class="lft"><a class="plink" href="' + href("trade", { p: x.p.id }) + '">' + face(x.p, 22) + " " + esc(x.p.n) + '</a></td><td class="tm">' + logo(x.p.t, 18) + '<span class="nm">' + esc(x.p.t) + "</span></td><td>" + esc(posOf(x.p)) + "</td><td>" + Math.floor(x.p.age || 0) + "</td><td>" + scoreChip(x.p) + "</td><td>" + C.lastYear(x.p) + '</td><td data-v="' + x.tv.pts.toFixed(0) + '">' + (function (pt) { return esc(pt.short) + (pt.single ? ' <small class="note">No. ' + pt.single + "</small>" : ""); })(P.priceText(x.tv.pts)) + "</td><td>" + Math.round(x.tv.pts) + "</td></tr>"; }).join(""), "under contract past this season, priced for the " + (W.season + 1) + " offseason; tap one to price him");
      var worst = all.slice().sort(function (a, b) { return a.tv.pts - b.tv.pts; }).filter(function (x) { return x.tv.pts < 0; }).slice(0, 12);
      if (worst.length) html += tablePanel("Hardest contracts to move", '<th class="lft">Player</th><th>Team</th><th>Pos</th><th>Age</th><th>Rating</th><th>Through</th><th title="What a new team would owe him from ' + (W.season + 1) + ' on: his cap numbers less the signing-bonus money, which stays behind">New team takes on</th><th title="What comparable deals say he\'s worth">His market</th><th title="The bonus money his team still owes, which lands on its cap if he\'s traded before June 1">Old team\'s dead money</th><th title="The old team\'s cap change next season if he\'s traded before June 1: his cap number off, his bonus money on">Old team, ' + (W.season + 1) + ' cap</th><th>Price to move him</th>',
        worst.map(function (x) { var p = x.p, mo = P.tradeMoney(W, p, p.t, "pre"), take = mo.rows.reduce(function (a, r) { return a + r.buyerAdds; }, 0), yrs = mo.rows.filter(function (r) { return r.buyerAdds > 0.05; }).length, dead = mo.rows.reduce(function (a, r) { return a + r.sellerDead; }, 0), clears = mo.rows[0] ? mo.rows[0].sellerSaves : 0, mk = P.contract(W, p, W.season + 1).apy;
          return '<tr><td class="lft"><a class="plink" href="' + href("trade", { p: p.id }) + '">' + face(p, 22) + " " + esc(p.n) + '</a></td><td class="tm">' + logo(p.t, 18) + '<span class="nm">' + esc(p.t) + "</span></td><td>" + esc(posOf(p)) + "</td><td>" + Math.floor(p.age || 0) + "</td><td>" + scoreChip(p, W.season + 1) + "</td><td>" + C.lastYear(p) + '</td><td data-v="' + take.toFixed(1) + '"><b>' + m(take) + "</b><small class=\"note\"> over " + yrs + " yr" + (yrs === 1 ? "" : "s") + " (" + m(yrs ? take / yrs : 0) + "/yr)</small></td><td>" + m(mk) + "/yr</td><td>" + m(dead) + '</td><td class="pos">' + m(clears) + '</td><td data-v="' + x.tv.pts.toFixed(0) + '">' + esc(P.priceText(-x.tv.pts).long.replace(/ \(about No\. \d+\)/, "")) + "</td></tr>"; }).join(""),
        "a new team would owe him more than his play is worth, so his team has to pay picks to move him");
      if (worst.length) html += '<p class="note">How these are picked: his trade value comes out below zero, meaning what a new team would pay him over the rest of his deal (cap numbers less the signing-bonus money, which stays behind) beats his market price by more than his on-field worth makes up. The old team\'s cap column is its change next season if he\'s traded before June 1 (his cap number comes off, his remaining bonus money lands as dead money); over the whole deal it clears exactly what the new team takes on. "Price to move him" is what his team would have to attach. Open one to build the deal with a specific team.</p>';
      view.innerHTML = html; return;
    }
    var tv = P.tradeValue(W, p, when), pts = tv.pts, g = P.group(p), seller = p.t;
    html += '<div class="panel tvcard"><div class="tv-top">' + face(p, 64) + '<div><h3><button type="button" class="linkish" data-p="' + esc(p.id) + '">' + esc(p.n) + "</button></h3><div class=\"meta\">" + esc(team(p.t).name) + " · " + esc(posOf(p)) + " · age " + Math.floor(p.age || 0) + " · " + (p.c ? m(p.c.apy) + " a year through " + tv.last : "no contract") + '</div></div><div class="tv-rt">' + scoreChip(p) + "</div></div>";
    if (tv.freeAgent) html += '<p class="tv-verdict">His deal ends after ' + tv.last + ', so in the offseason he\'s a free agent, not a trade target: signing him should take about <b>' + tv.est.yrs + " year" + (tv.est.yrs > 1 ? "s" : "") + ", " + m(tv.est.total) + "</b> (" + m(tv.est.apy) + " a year, " + m(tv.est.gtd) + " guaranteed).</p>" + (open ? '<p class="note">Before today\'s deadline he\'s a rental: switch When to "Now" to price him.</p>' : "");
    else if (pts <= 0) html += '<p class="tv-verdict">His contract is a burden: a team would want about <b>' + esc(asPicksText(-pts)) + "</b> to take him on.</p>";
    else html += '<p class="tv-verdict">It would take about <b>' + esc(asPicksText(pts)) + '</b>.</p><p class="note">' + Math.round(pts) + " points on the pick chart, where a contender's late first (around No. " + P.FIRST + ") is about " + Math.round(P.pickPoints(P.FIRST)) + " and a second (around No. " + P.SECOND + ") about " + Math.round(P.pickPoints(P.SECOND)) + (tv.rental ? ". A rental: his deal ends after this season, so most of the price is the rest of this year plus the inside track on re-signing him." : ".") + "</p>" +
      (tv.pedigree && tv.pedigree.pts >= pts - 0.5 ? '<p class="note">Priced on upside: he was the No. ' + tv.pedigree.pick + " pick in " + tv.pedigree.year + ", and a young first-round quarterback still carries part of that pick's value (" + Math.round(tv.pedigree.fade * 100) + "% this far out" + (tv.pedigree.f < 0.999 ? ", cut to " + Math.round(tv.pedigree.f * 100) + "% for how far his play has fallen short of the slot" : ", with no NFL snaps yet to judge him by") + "), which tops what his play alone is worth.</p>" : "");
    html += "</div>";
    var marks = [{ kind: "player", n: P.pickForPoints(Math.max(1, pts)), pts: Math.max(0, pts), label: p.n.split(" ").slice(-1)[0] + (pts >= 1000 ? " (above No. 1)" : "") }];
    if (buyer && pts > 0 && !tv.freeAgent) {
      var bo = P.bestOffers(W, buyer, seller, pts), sel = state.q.o != null ? state.q.o.split(",").filter(Boolean) : null;
      var best = bo.list[0];
      if (!sel) sel = best ? best.give.map(function (q) { return q.key; }).concat(best.back.map(function (q) { return q.key; })) : [];
      var on = {}; sel.forEach(function (k) { on[k] = 1; });
      var give = bo.B.filter(function (q) { return on[q.key]; }), back = bo.S.filter(function (q) { return on[q.key]; });
      var gs = give.reduce(function (a, q) { return a + q.pts; }, 0), bs = back.reduce(function (a, q) { return a + q.pts; }, 0), net = gs - bs, pct = net / pts;
      bo.B.forEach(function (q) { marks.push({ kind: "pick", n: q.en, pts: q.pts, fut: q.yr > W.season + 1, label: team(buyer).name + " " + q.yr + " round " + q.round + ", No. " + q.en + ": " + Math.round(q.pts) + " pts" }); });
      var chip = function (q, side) { return '<button type="button" class="pchip' + (on[q.key] ? " on" : "") + (q.yr > W.season + 1 ? " fut" : "") + '" data-offer="' + esc(q.key) + '"><b>' + q.yr + " R" + q.round + "</b> No. " + q.en + (q.from !== side ? " <small>via " + esc(q.from) + "</small>" : "") + "<em>" + Math.round(q.pts) + "</em></button>"; };
      html += '<div class="panel"><h3>The deal <small>closest fit from both teams\' picks, at their expected spots; tap any pick to add or remove it</small></h3><div class="deal2">' +
        '<div class="side">' + logo(buyer, 28) + "<div><b>" + esc(team(buyer).name) + ' send</b><div class="chips">' + (give.length ? give.map(function (q) { return chip(q, buyer); }).join("") : '<span class="note">nothing yet</span>') + '</div><span class="note">' + Math.round(gs) + ' pts</span></div></div>' +
        '<div class="side">' + logo(seller, 28) + "<div><b>" + esc(team(seller).name) + " send</b><div class=\"chips\">" + face(p, 22) + " <b>" + esc(p.n) + "</b>" + back.map(function (q) { return chip(q, seller); }).join("") + '</div><span class="note">' + Math.round(pts) + " pts" + (back.length ? " + " + Math.round(bs) + " in picks back" : "") + "</span></div></div></div>" +
        '<div class="dealbar"><div class="pkg-bar"><i style="width:' + Math.max(0, Math.min(100, pct / 1.3 * 100)).toFixed(1) + '%"></i><span style="left:' + (100 / 1.3).toFixed(1) + '%"></span></div><b class="' + (Math.abs(pct - 1) <= 0.05 ? "pos" : pct < 1 ? "neg" : "") + '">' + (Math.abs(pct - 1) <= 0.02 ? "Even" : pct < 1 ? Math.round((1 - pct) * 100) + "% short" : Math.round((pct - 1) * 100) + "% over") + "</b>" +
        (state.q.o != null ? '<button type="button" class="btn sm ghost" data-offerreset>Back to the closest fit</button>' : "") + "</div>";
      if (bo.list.length > 1) html += '<div class="alts"><span class="note">Other ways to get there:</span>' + bo.list.slice(1).map(function (x) {
        var k = x.give.map(function (q) { return q.key; }).concat(x.back.map(function (q) { return q.key; })).join(",");
        return '<a class="alt" href="' + href("trade", Object.assign({}, state.q, { o: k })) + '">' + x.give.map(function (q) { return q.yr + " R" + q.round; }).join(" + ") + (x.back.length ? " for " + x.back.map(function (q) { return q.yr + " R" + q.round; }).join(" + ") + " back" : "") + " <small>" + Math.round(x.net) + " pts</small></a>";
      }).join("") + "</div>";
      html += '<details class="allpicks"><summary>Every pick on the table (' + bo.B.length + " " + esc(buyer) + ", " + bo.S.length + " " + esc(seller) + ')</summary><div class="ap"><div><b>' + esc(team(buyer).name) + '</b><div class="chips">' + bo.B.map(function (q) { return chip(q, buyer); }).join("") + "</div></div><div><b>" + esc(team(seller).name) + ' (coming back)</b><div class="chips">' + bo.S.map(function (q) { return chip(q, seller); }).join("") + "</div></div></div></details>";
      html += "</div>";
    }
    if (buyer && pts <= 0 && !tv.freeAgent) {
      // a contract to dump: the old team pays the new one in picks to take him
      var dump = P.bestOffers(W, seller, buyer, -pts), dx = dump.list[0];
      html += '<div class="panel"><h3>The deal <small>his contract costs more than his play is worth, so the ' + esc(team(seller).name) + " attach picks</small></h3>" +
        (dx ? '<div class="deal2"><div class="side">' + logo(seller, 28) + "<div><b>" + esc(team(seller).name) + ' send</b><div class="chips">' + face(p, 22) + " <b>" + esc(p.n) + "</b>" + dx.give.map(function (q) { return pickChip(q, seller); }).join("") + '</div><span class="note">' + Math.round(dx.sum) + " pts in picks</span></div></div>" +
          '<div class="side">' + logo(buyer, 28) + "<div><b>" + esc(team(buyer).name) + ' take him on</b><div class="chips">' + (dx.back.length ? dx.back.map(function (q) { return pickChip(q, buyer); }).join("") : '<span class="note">and send nothing back</span>') + "</div></div></div></div>" : '<p class="note pad">Not even the ' + esc(team(seller).name) + "' picks cover it.</p>") + "</div>";
    }
    if (buyer && !tv.freeAgent) {
      // the money on both sides
      var mo = P.tradeMoney(W, p, buyer, when);
      html += '<div class="panel"><h3>The money <small>' + (when === "now" ? "traded now: the new team pays the rest of this season's salary; the old team's later bonus money all hits this year" : when === "pre" ? "traded before June 1: the old team takes all of his remaining bonus money at once" : "traded after June 1: the old team splits his remaining bonus money over two years") + '</small></h3><div class="scroll"><table class="t"><thead><tr><th>Season</th><th>' + esc(buyer) + " take on</th><th>" + esc(buyer) + " space after</th><th>" + esc(seller) + " dead money</th><th>" + esc(seller) + " cap change</th><th>" + esc(seller) + " space after</th></tr></thead><tbody>" +
        mo.rows.map(function (r) { var after = r.buyerSpace != null ? r.buyerSpace - r.buyerAdds : null, safter = r.sellerSpace != null ? r.sellerSpace + r.sellerSaves : null;
          return "<tr><td>" + r.y + "</td><td>" + (r.buyerAdds > 0.05 ? m(r.buyerAdds) : "—") + '</td><td class="' + (after != null && after < 0 ? "neg" : "") + '">' + (after != null ? m(after) : "—") + "</td><td>" + (r.sellerDead > 0.05 ? m(r.sellerDead) : "—") + '</td><td class="' + (r.sellerSaves >= 0 ? "pos" : "neg") + '">' + sm(r.sellerSaves) + "</td><td>" + (safter != null ? m(safter) : "—") + "</td></tr>"; }).join("") + "</tbody></table></div>";
      var short = mo.rows.filter(function (r) { return r.buyerSpace != null && r.buyerSpace - r.buyerAdds < 0; })[0];
      html += '<p class="note pad">' + (short ? "The " + esc(team(buyer).name) + " would be " + m(-(short.buyerSpace - short.buyerAdds)) + " over the cap in " + short.y + ", so they'd have to clear room first (a restructure or a cut) or have the " + esc(team(seller).name) + " keep some salary. " : "The " + esc(team(buyer).name) + " can fit him. ") +
        (mo.rows[0].sellerSaves < 0 ? "The " + esc(team(seller).name) + " would lose cap room in " + mo.rows[0].y + " by moving him, which makes them harder to deal with." : "The " + esc(team(seller).name) + " clear " + m(mo.rows.reduce(function (a, r) { return a + Math.max(0, r.sellerSaves); }, 0)) + " over the life of the deal.") + "</p></div>";
    } else if (!buyer && !tv.freeAgent && pts > 0) {
      var cost0 = (tv.rows[0] || {}).cost || 0, fits = P.fits(W, p, when === "now" ? W.season + 1 : W.season + 1, cost0);
      html += '<div class="panel"><h3>Likely buyers <small>teams with ' + esc(ONE[g] || g) + ' among their top needs for ' + (W.season + 1) + " and room for his salary</small></h3>" +
        (fits.length ? '<div class="buyers">' + fits.slice(0, 6).map(function (f) { var T = P.needs(W)[f.code]; return '<a class="buyer" href="' + href("trade", Object.assign({}, state.q, { t: f.code, o: null })) + '">' + logo(f.code, 26) + "<span><b>" + esc(team(f.code).name) + '</b><small class="note">' + esc(ONE[g] || g) + " need No. " + (f.rank + 1) + " · " + m(f.space) + " in " + (W.season + 1) + " space</small></span></a>"; }).join("") + "</div>" : '<p class="note pad">No team has his position among its top needs with room to fit him. Pick one anyway to build a deal.</p>') + "</div>";
    }
    // the season-by-season build
    html += '<div class="panel"><h3>How he\'s priced <small>season by season</small></h3><div class="scroll"><table class="t tvrows"><thead><tr><th>Season</th><th>Status</th><th>Counts</th><th>Worth above replacement</th><th>His market price</th><th>New team pays</th><th>Contract effect</th></tr></thead><tbody>' +
      tv.rows.map(function (r) { var eff = r.under ? (r.market >= r.cost ? 0.6 : 0.35) * (r.market - r.cost) : 0; return "<tr><td>" + r.y + "</td><td>" + (r.under ? "Under contract" : '<span class="note">Re-signed at market (60%)</span>') + "</td><td>" + Math.round(r.w * 100) + "%</td><td>" + m(r.above * (g === "QB" ? 1.1 : 1)) + "</td><td>" + m(r.market) + "</td><td>" + (r.under ? m(r.cost) : "—") + '</td><td class="' + (r.under ? (eff >= 0 ? "pos" : "neg") : "") + '">' + (r.under ? sm(eff) : "—") + "</td></tr>"; }).join("") +
      '<tr class="tot"><td colspan="3">Total</td><td>' + m(tv.talent) + "</td><td></td><td></td><td>" + sm(tv.surplus) + "</td></tr></tbody></table></div></div>";
    html += '<div class="panel"><h3>The pick chart <small>points by pick; ' + (buyer ? "dots are the " + esc(team(buyer).name) + "' picks (hollow: next year's, at 85%)" : "the marker is his price") + "</small></h3>" + pickCurve(marks) + "</div>";
    html += '<p class="note">How it\'s priced: his position\'s starter price, times his healthy role, times how far his rating multiplier sits above a replacement-level player\'s (a rating near 38), squared so stars cost far more than average starters, season by season with aging (steeper from four years past his position\'s peak); seasons after his deal ends count 60%, less as he ages, since the new team only gets first crack at re-signing him at market. Quarterbacks carry a premium that grows with how good they are (none for an average starter, about 1.7x for an MVP-level one), since franchise quarterbacks almost never come available and teams pay No. 1-pick prices to find one. A starting quarterback is priced as an every-snap player when healthy. Seasons past the usual end of a career (37 for a quarterback, 33 for most positions) count only the chance he\'s still playing, about 15 points less each year. A young first-round quarterback with no rated snaps yet is worth the expected value of a quarterback taken in that slot (65% of the pick, fading each year), not the best case. Each season under contract then adds 60% of what his market price (from comparable deals) beats what the new team pays (his cap number less the bonus proration, which stays behind), or takes away 35% of what he\'s overpaid; a cheap deal never adds more than half again his on-field worth. Calibrated on this year\'s trades: Jeffery Simmons (two late firsts and a fourth), Myles Garrett (Jared Verse, a first, a second and a third), and the Colts\' reported asking price of a second for Jonathan Taylor. Each team\'s picks are worth what their expected spot is worth, so a Patriots second and a Browns second aren\'t the same. A model, not a scouting report: teams pay more for need and less for injury risk.</p>';
    view.innerHTML = html;
  }
  // ---------- offseason outlook: needs, likely cuts, tags and extensions across the league ----------
  function offseasonPage() {
    var y = W.season + 1, N = P.needs(W, y), sec = state.q.s || "needs";
    var html = '<h2 class="sec">The ' + y + ' offseason</h2><p class="lede">What every team needs, who\'s likely to be cut, who could get the franchise tag and whose extension is coming, all from the same ratings, contracts and cap math as the rest of the hub.</p>';
    html += '<div class="subtabs">' + [["needs", "Team needs"], ["cuts", "Likely cap casualties"], ["tags", "Franchise tags"], ["ext", "Extensions to watch"]].map(function (x) { return '<a href="' + href("offseason", { s: x[0] === "needs" ? null : x[0] }) + '"' + (sec === x[0] ? ' aria-current="page"' : "") + ">" + x[1] + "</a>"; }).join("") + "</div>";
    if (sec === "cuts") {
      var cc = P.casualties(W, y).filter(function (x) { return x.label !== "Long shot"; });
      html += tablePanel("Likely cap casualties · " + cc.length, '<th class="lft">Player</th><th>Team</th><th>Pos</th><th>Age</th><th>Rating</th><th>' + y + " cap</th><th>Saves if cut</th><th>Dead money</th><th>After June 1</th><th>Odds</th><th>Fits</th>",
        cc.slice(0, 80).map(function (x) { var p = x.p;
          return '<tr><td class="lft">' + pname(p, 22) + '</td><td class="tm">' + logo(x.team, 18) + '<span class="nm">' + esc(x.team) + "</span></td><td>" + esc(posOf(p)) + "</td><td>" + Math.floor((p.age || 0) + 1) + "</td><td>" + scoreChip(p, y) + "</td><td>" + m(x.cap) + '</td><td class="pos">' + (x.kind === "cut" ? sm(x.save) : '<span class="note">trade: </span>' + sm(x.save)) + "</td><td>" + m(x.dead || 0) + "</td><td>" + (x.saveJune != null ? sm(x.saveJune) : "—") + '</td><td data-v="' + x.lik.toFixed(2) + '"><span class="pill ' + (x.label === "Likely" ? "fill" : "warn") + '">' + x.label + '</span></td><td class="fits">' + P.fits(W, p, y, x.val * 1.2).slice(0, 3).map(function (f) { return '<a href="' + href("team/" + f.code) + '" title="' + esc(team(f.code).name) + '">' + logo(f.code, 20) + "</a>"; }).join("") + "</td></tr>"; }).join(""),
        "cuts that save most of his cap number on a player paid well past his value; likelier on teams tight on room");
      html += '<p class="note">Odds weigh how much of his cap number a cut saves, how far he\'s paid past his value (at his healthy role), whether his team is tight on ' + y + ' room, and age. "Trade" means a trade saves real money where a cut wouldn\'t, because his guarantees leave with him. Turn on "Add likely cap casualties" on the <a href="' + href("fa", { cc: "1" }) + '">Free agents</a> tab to see them in the class.</p>';
    } else if (sec === "tags") {
      var tags = []; Object.keys(N).forEach(function (c) { P.suggest(W, c, y).forEach(function (s0) { if (s0.kind === "tag") tags.push(Object.assign({ team: c }, s0)); }); });
      tags.sort(function (a, b) { return b.val - a.val; });
      html += tablePanel("Franchise tag candidates · " + tags.length, '<th class="lft">Player</th><th>Team</th><th>Pos</th><th>Age</th><th>Rating \'' + String(y).slice(2) + "</th><th>Tag</th><th>His market</th><th>Verdict</th>",
        tags.map(function (x) { return '<tr><td class="lft">' + pname(x.p, 22) + '</td><td class="tm">' + logo(x.team, 18) + '<span class="nm">' + esc(x.team) + "</span></td><td>" + esc(posOf(x.p)) + "</td><td>" + Math.floor((x.p.age || 0) + 1) + "</td><td>" + scoreChip(x.p, y) + "</td><td>" + m(x.tag) + '</td><td data-v="' + x.apy.toFixed(2) + '">' + dealCell(x.est) + '</td><td><span class="pill ' + (x.verdict === "fair" ? "up" : "warn") + '">' + (x.verdict === "fair" ? "Fair price" : "Pricey") + "</span></td></tr>"; }).join(""),
        "a starter rated 60+, 30 or younger, whose market is at least 65% of the tag");
    } else if (sec === "ext") {
      var ex = []; Object.keys(N).forEach(function (c) { P.suggest(W, c, y).forEach(function (s0) { if (s0.kind === "extend") ex.push(Object.assign({ team: c }, s0)); }); });
      ex.sort(function (a, b) { return b.val - a.val; });
      html += tablePanel("Extensions to watch · " + ex.length, '<th class="lft">Player</th><th>Team</th><th>Pos</th><th>Age</th><th>Rating</th><th>' + y + " cap now</th><th>Likely extension</th><th>" + y + " cap change</th>",
        ex.slice(0, 60).map(function (x) { return '<tr><td class="lft">' + pname(x.p, 22) + '</td><td class="tm">' + logo(x.team, 18) + '<span class="nm">' + esc(x.team) + "</span></td><td>" + esc(posOf(x.p)) + "</td><td>" + Math.floor((x.p.age || 0) + 1) + "</td><td>" + scoreChip(x.p) + "</td><td>" + m(x.cap) + '</td><td data-v="' + x.apy.toFixed(2) + '">' + dealCell(x.est) + '</td><td class="' + (x.now > 0.05 ? "pos" : "") + '">' + (x.now > 0.05 ? sm(x.now) : "about even") + "</td></tr>"; }).join(""),
        "starters 29 or younger entering the last year of their deals");
    } else {
      html += '<div class="needgrid">' + codes().map(function (c) { var T = N[c];
        return '<a class="ncard" href="' + href("team/" + c) + '" style="--tc:' + team(c).color + '"><div class="nc-h">' + logo(c, 24) + "<b>" + esc(team(c).name) + '</b></div><div class="nc-n">' + (T.top.length ? T.top.slice(0, 3).map(function (x) { return '<span class="nchip g' + x.grade + '" title="' + esc(x.why) + '">' + esc(GROUP_SHORT[x.g]) + " <b>" + x.grade + "</b></span>"; }).join("") : '<span class="note">No glaring holes</span>') + "</div></a>"; }).join("") + "</div>";
      html += '<p class="note">Each team\'s starters under contract for ' + y + ", rated with aging and graded against the other 31 teams (A is top fifth, F bottom fifth). Needs are the weakest groups, weighted by how much the position matters, with empty starting spots counted at replacement level. Hover a need for why; open a team for all eleven grades. These drive the Fits column on Free agents and the likely buyers on Trade value.</p>";
    }
    view.innerHTML = html;
  }

  // ---------- play GM: run the whole offseason for one team ----------
  function gmTab(code, ms) {
    var q = state.q, on = function (k) { return q[k] !== "0"; }, fa = q.f != null ? +q.f : 4, ban = (q.b || "").split(",").filter(Boolean);
    var y = W.season + 1, r = P.simulateOffseason(W, code, { moves: ms.map(eng), cuts: on("c"), resign: on("r"), tag: on("g"), fa: fa, rivals: on("rb"), outbid: q.ob === "1", draft: on("d"), ban: ban });
    var tog = function (k, label) { return '<label class="tog"><input type="checkbox" data-gm="' + k + '"' + (on(k) ? " checked" : "") + "> " + label + "</label>"; };
    var html = '<p class="lede">Run the ' + y + " offseason for the " + esc(team(code).name) + ": your moves from the planner first, then the model handles the rest the way the hub would advise, and the end shows how the roster, the cap and next season's power ranking change. Turn steps off, skip any signing, or change the planner and come back.</p>";
    html += '<div class="controls gmc">' + tog("c", "Make the likely cuts") + tog("g", "Tag real candidates") + tog("r", "Re-sign starters worth it") + '<label>Free agents to sign<select data-q="f">' + [0, 1, 2, 3, 4, 5, 6].map(function (k) { return '<option value="' + k + '"' + (k === fa ? " selected" : "") + ">" + k + "</option>"; }).join("") + "</select></label>" + tog("rb", "Rival bids") + '<label class="tog"><input type="checkbox" data-gmon="ob"' + (q.ob === "1" ? " checked" : "") + "> Outbid them</label>" + tog("d", "Draft for needs") +
      (ban.length ? '<button type="button" class="btn sm ghost" data-gmunban>Bring back ' + ban.length + " skipped</button>" : "") + "</div>";
    var b = r.before, a = r.after, rk0 = b.power ? b.power.rank : null, rk1 = a.power ? a.power.rank : null;
    html += '<div class="stats">' + stat(m(b.space) + ' <i class="arr">→</i> <em class="' + (a.space >= 0 ? "pos" : "neg") + '">' + m(a.space) + "</em>", y + " cap space") +
      stat(rk0 != null ? "No. " + rk0 + ' <i class="arr">→</i> <em class="' + (rk1 < rk0 ? "pos" : rk1 > rk0 ? "neg" : "") + '">No. ' + rk1 + "</em>" : "—", y + " power ranking") +
      stat(P.NEED_GROUPS.filter(function (g) { return a.groups[g].grade < b.groups[g].grade; }).length + " up · " + P.NEED_GROUPS.filter(function (g) { return a.groups[g].grade > b.groups[g].grade; }).length + " down", "Position grades") + "</div>";
    html += '<div class="panel"><h3>Roster grades <small>before and after, against the other 31 teams as they stand</small></h3><div class="grades ba">' + P.NEED_GROUPS.map(function (g) { var g0 = b.groups[g].grade, g1 = a.groups[g].grade;
      return '<span class="gr2"><small>' + esc(GROUP_SHORT[g]) + '</small><span><b class="g' + g0 + '">' + g0 + '</b><i class="' + (g1 < g0 ? "pos" : g1 > g0 ? "neg" : "") + '">' + (g1 < g0 ? "▲" : g1 > g0 ? "▼" : "→") + '</i><b class="g' + g1 + '">' + g1 + "</b></span></span>"; }).join("") + "</div></div>";
    var L = r.log, row = function (p, right, extra) { return '<li><div class="l">' + pname(p, 24) + '<div class="sub">' + esc(posOf(p)) + " · age " + Math.floor((p.age || 0) + 1) + (extra || "") + '</div></div><span class="r">' + right + "</span></li>"; };
    var card = function (title, sub, items) { return items ? '<div class="panel"><h3>' + title + " <small>" + sub + '</small></h3><ul class="gml">' + items + "</ul></div>" : ""; };
    html += '<div class="gmgrid">';
    html += card("Your moves", '<a href="' + href("team/" + code, Object.assign({}, q, { v: "plan" })) + '">edit in the planner</a>', L.user.map(function (mv) { var p = W.byId[mv.id]; return p ? row(p, esc(moveTitle(mv))) : ""; }).join(""));
    html += card("Cut", "the model's likely cap casualties", L.cuts.map(function (x) { return row(x.p, '<b class="pos">' + sm(x.save) + "</b> <small>" + m(x.dead || 0) + " dead</small>"); }).join(""));
    html += card("Tagged", "franchise tag, one year", L.tagged.map(function (x) { return row(x.p, m(x.amount)); }).join(""));
    html += card("Re-signed", "starters worth at least 85% of their market", L.resigned.map(function (x) { return row(x.p, dealCell(x.est)); }).join(""));
    html += card("Let walk", "starters the model wouldn't pay", L.walked.map(function (x) { return row(x.p, '<small class="note">market ' + m(x.est.apy) + "/yr</small>"); }).join(""));
    html += card("Signed in free agency", "the biggest lift to a top need per dollar, priced as the starter he'd be" + (on("rb") ? ", against rival bids" : "") + "; tap × to skip one", L.signed.map(function (x) {
      var rv = x.bidders && x.bidders.length ? ' <small class="note">beat ' + x.bidders.map(esc).join(", ") + " (" + Math.round((x.odds || 1) * 100) + "% odds, +" + Math.round(x.bump * 100) + "% over his market)</small>" : "";
      return row(x.p, dealCell(x.est), ' <span class="pill">' + esc(GROUP_SHORT[x.g]) + "</span>" + (x.cut ? ' <span class="pill warn">cut by ' + esc(x.from) + "</span>" : ' <small class="note">from ' + esc(x.from) + "</small>") + rv).replace("</li>", '<button type="button" class="x" data-gmban="' + esc(x.p.id) + '" title="Skip him">×</button></li>'); }).join("") || (fa ? '<li class="note">Nobody on the market lifts a top need within the room left.</li>' : ""));
    html += card("Lost to rival bids", "you offered his going price; he chose another team" + (q.ob === "1" ? "" : ' (try "Outbid them")'), L.lost.map(function (x) { return row(x.p, '<span class="lost">' + logo(x.to, 18) + " " + esc(team(x.to).name) + '</span><small class="note">' + m(x.price) + "/yr · your odds " + Math.round(x.odds * 100) + "%</small>", ' <span class="pill">' + esc(GROUP_SHORT[x.g]) + "</span>"); }).join(""));
    html += card("Draft", "a mock of the " + y + " draft at expected spots: best on the Big Board's consensus who fits a need", L.drafted.map(function (x) { var pr = x.prospect;
      return '<li><span class="pk">R' + x.round + " · No. " + x.n + '</span><div class="l"><b>' + (pr ? esc(pr.n) : "Day 3 prospect") + '</b><div class="sub">' + (pr ? esc(pr.pos) + " · " + esc(pr.school || "") + " · board No. " + pr.rank : esc(GROUP_SHORT[x.g] || x.g)) + '</div></div><span class="r">' + scoreTxt(P.rookieZ(x.n)) + "</span></li>"; }).join(""));
    html += "</div>";
    html += '<p class="note">Assumptions: free agents are everyone whose team wouldn\'t keep them (by the same rule used here for re-signing) plus other teams\' likely cuts. With rival bids on, the three keenest other teams (his position among their top needs, room for him) bid too: each raises his price 8%, and he picks a team with odds that favor contenders and the teams that need him most; your offer at the going price counts more than any one rival\'s, and Outbid them adds 12% to the price and half again to your odds. Results are fixed per player, so the same choices give the same offseason. First-year cap hits on signings are 80% of the yearly average (bonus proration lowers year one); $5M is kept spare. Draft picks follow each team\'s expected spot; rookies are rated by pick (a top-5 pick about 55 as a rookie, a late first about 42, a day-three pick in the low 30s). The power ranking uses the same projection as the Power rankings tab, with this team\'s roster value and cap space changed.</p>';
    return html;
  }
  function scoreTxt(z) { var v = Math.max(1, Math.min(99, Math.round(50 + 15 * z))); return '<span class="rscore ' + chipCls(v) + '" title="Projected rookie-season rating">' + v + "</span>"; }

  // ---------- power rankings ----------
  var RATINGS = null;
  function ratings() { if (!RATINGS) { RATINGS = {}; Object.keys(SIM.teams).forEach(function (t) { RATINGS[t] = SIM.teams[t].rating; }); } return RATINGS; }
  function powerPage() {
    var y = +state.q.y || W.season, now = y === W.season, pw = P.power(W, ratings(), y), base = now ? null : P.power(W, ratings(), W.season), r0 = {};
    if (base) base.forEach(function (x) { r0[x.code] = x.rank; });
    var html = '<h2 class="sec">Power rankings</h2><p class="lede">' + (now ? "This season: every team's strength in points against an average team, from the betting market's spreads and this season's scoring margins." :
      y + " projected: this season's strength carries forward only partly (NFL teams regress hard), and the rest comes from what each team has under contract that year, its draft classes and the cap space it has to add players.") + "</p>";
    html += '<div class="subtabs">' + [W.season, W.season + 1, W.season + 2].map(function (k) { return '<a href="' + href("power", { y: k === W.season ? null : k }) + '"' + (k === y ? ' aria-current="page"' : "") + ">" + (k === W.season ? "This season" : k) + "</a>"; }).join("") + "</div>";
    var max = Math.max.apply(null, pw.map(function (x) { return Math.abs(x.rating); })) || 1;
    var tick = Math.max(1, Math.round(max / 2));
    html += '<div class="panel"><div class="pr-scale"><span></span><span class="pr-axis"><i style="left:' + (50 - tick / max * 50) + '%">-' + tick + '</i><i style="left:50%">0</i><i style="left:' + (50 + tick / max * 50) + '%">+' + tick + '</i></span><span class="note">pts</span></div><ol class="power">' + pw.map(function (x) {
      var c = x.code, o = SIM.teams[c], res = x.res, mv = base ? r0[c] - x.rank : 0;
      var side = now ? '<span class="pr-meta">' + rec(o.rec) + " · proj. " + o.wins.toFixed(1) + " wins · " + pctTxt(o.playoffs) + " playoffs · " + pctTxt(o.sb) + " title</span>"
        : '<span class="pr-meta">' + m(res.roster, 0) + " under contract · " + (res.qb ? "QB " + esc(lastName(res.qb.p.n)) : '<b class="neg">no QB under contract</b>') + " · " + m(res.space, 0) + " cap space · " + m(res.draft, 0) + " draft value</span>";
      return '<li><a href="' + href("team/" + c) + '" style="--tc:' + team(c).color + '"><span class="pr-rank">' + x.rank + "</span>" + logo(c, 30) + '<span class="pr-name"><b>' + esc(team(c).name) + "</b>" + side + "</span>" +
        '<span class="pr-move ' + (mv > 0 ? "pos" : mv < 0 ? "neg" : "") + '">' + (!base ? "" : mv > 0 ? "▲" + mv : mv < 0 ? "▼" + (-mv) : "–") + "</span>" +
        '<span class="pr-bar"><i class="' + (x.rating >= 0 ? "up" : "dn") + '" style="width:' + (Math.abs(x.rating) / max * 50).toFixed(1) + '%"></i></span><span class="pr-r">' + (x.rating >= 0 ? "+" : "") + x.rating.toFixed(1) + "</span></a></li>";
    }).join("") + "</ol></div>";
    html += '<p class="note">' + (now ? "Points against an average team on a neutral field." : "Projected points against an average team. The arrows compare with this season's ranking. Value under contract is each player's value that year, aging included.") + "</p>";
    view.innerHTML = html;
  }

  // ---------- free agents ----------
  function faPage() {
    var y = +state.q.c || W.season + 1, g = state.q.g || "", tm = state.q.t || "";
    var withCC = state.q.cc === "1" && y === W.season + 1, ccById = {};
    if (withCC) P.casualties(W, y).filter(function (x) { return x.label !== "Long shot" && x.kind === "cut"; }).forEach(function (x) { ccById[x.p.id] = x; });
    var list = W.players.filter(function (p) { return p.c && (C.lastYear(p) === y - 1 || ccById[p.id]) && p.st !== "DEV" && (!g || P.group(p) === g) && (!tm || p.t === tm); })
      .map(function (p) { var e = P.contract(W, p, y); return { p: p, val: P.value(W, p, y, P.role(W, p)), est: e, apy: e.apy, tag: P.tagPrice(W, p, y), cc: ccById[p.id] }; })
      .sort(function (a, b) { return b.val - a.val; });
    var html = '<h2 class="sec">Free agents</h2><p class="lede">Everyone whose contract runs out before the ' + y + " season, ranked by value (position price, snaps and player rating); tap any column to sort by it. The next contract comes from comparable deals: veterans at his position who signed in the last three years, nearest to him in rating, age and role (hover one to see them). The tag is the NFL's franchise tag at his position grown with the cap (or 120% of his last cap hit if that's more).</p>";
    html += '<div class="controls"><label>Class<select data-q="c">' + [W.season + 1, W.season + 2, W.season + 3].map(function (k) { return '<option value="' + k + '"' + (k === y ? " selected" : "") + ">" + k + "</option>"; }).join("") + '</select></label><label>Position<select data-q="g"><option value="">All</option>' + Object.keys(GROUP_NAME).map(function (k) { return '<option value="' + k + '"' + (k === g ? " selected" : "") + ">" + GROUP_NAME[k] + "</option>"; }).join("") +
      '</select></label><label>Team<select data-q="t"><option value="">All teams</option>' + codes().map(function (c) { return '<option value="' + c + '"' + (c === tm ? " selected" : "") + ">" + esc(team(c).name) + "</option>"; }).join("") + "</select></label>" +
      (y === W.season + 1 ? '<label class="chk"><input type="checkbox" data-qchk="cc"' + (withCC ? " checked" : "") + "> Add likely cap casualties</label>" : "") + "</div>";
    html += tablePanel("The " + y + " class · " + list.length, "<th>#</th><th>Player</th><th>Team</th><th>Pos</th><th>Age</th><th>Rating</th><th title=\"Projected rating that season, aging included\">&rsquo;" + String(y).slice(2) + "</th><th>Snaps</th><th>This season</th><th>Value</th><th title=\"Teams with his position among their top three needs and cap space for him\">Fits</th><th title=\"From comparable deals: veterans at his position who signed in the last three years, nearest in rating, age and role. Hover a deal for the comparisons.\">Next contract</th><th>Tag</th><th>" + (y - 1) + " cap</th>",
      list.slice(0, state.q.all === "1" ? 400 : 50).map(function (x, i) {
        var p = x.p, r = x.apy / x.tag, tagCls = r >= 0.85 ? "up" : r >= 0.6 ? "warn" : "";
        return "<tr><td>" + (i + 1) + "</td><td>" + pname(p, 24, x.cc ? ' <span class="pill warn" title="' + esc(x.cc.why) + '">cap casualty?</span>' : "") + '</td><td class="tm">' + logo(p.t, 18) + '<span class="nm">' + esc(p.t) + "</span></td><td>" + esc(posOf(p)) + "</td><td>" + (p.age ? Math.floor(p.age + y - W.season) : "—") + "</td><td>" + scoreChip(p) + "</td><td>" + scoreChip(p, y) + "</td><td>" + (p.snaps ? Math.round(P.share(W, p) * 100) + "%" : "—") + '</td><td class="note">' + esc(keyStat(p)) + "</td><td><b>" + m(x.val) + "</b></td><td class=\"fits\">" + P.fits(W, p, y, x.apy).slice(0, 3).map(function (f) { return '<a href="' + href("team/" + f.code) + '" title="' + esc(team(f.code).name) + ": need No. " + (f.rank + 1) + ", " + m(f.space) + ' in space">' + logo(f.code, 20) + "</a>"; }).join("") + "</td><td data-v=\"" + x.apy.toFixed(2) + '">' + dealCell(x.est) + '</td><td><span class="pill ' + tagCls + '" title="Market as a share of the tag: ' + Math.round(r * 100) + '%">' + m(x.tag) + "</span></td><td>" + m(C.capHit(p, y - 1)) + "</td></tr>";
      }).join(""), "green tag: about his market, yellow: pricier, gray: well above", "rank");
    if (list.length > 50 && state.q.all !== "1") html += '<p class="more"><a class="btn sm" href="' + href("fa", Object.assign({}, state.q, { all: "1" })) + '">Show all ' + list.length + "</a></p>";
    view.innerHTML = html;
  }
  // ---------- team overview: outlook, schedule, depth chart by unit ----------
  function overview(code) {
    var o = SIM.teams[code], gs = W.games.filter(function (g) { return g[0] === "REG" && (g[3] === code || g[4] === code); }).sort(function (a, b) { return a[1] - b[1]; });
    var html = '<div class="ovgrid"><div class="panel"><h3>Schedule <small>results, then each game\'s win chance</small></h3><ul class="sched">';
    gs.forEach(function (g) {
      var home = g[4] === code, opp = home ? g[3] : g[4], done = g[5] != null;
      var res = "";
      if (done) { var us = home ? g[6] : g[5], them = home ? g[5] : g[6]; res = '<b class="' + (us > them ? "pos" : us < them ? "neg" : "") + '">' + (us > them ? "W" : us < them ? "L" : "T") + " " + us + "-" + them + "</b>"; }
      else { var ph = SIM.winP.get(g); var pw = ph == null ? null : home ? ph : 1 - ph; res = pw == null ? "" : bar(pw, pw >= 0.5 ? "po" : "dv"); }
      html += '<li><span class="wk">' + g[1] + '</span><span class="op">' + (home ? "vs" : "@") + " " + logo(opp, 20) + " " + esc(team(opp).short) + (g[9] ? ' <span class="pill">Div</span>' : "") + '</span><span class="rs">' + res + "</span></li>";
    });
    html += "</ul></div><div>";
    // win distribution
    var maxp = Math.max.apply(null, o.winDist);
    html += '<div class="panel"><h3>Final wins <small>share of simulated seasons</small></h3><div class="wdist">' + o.winDist.map(function (v, k) { return '<span title="' + k + " wins: " + pctTxt(v) + '"><i style="height:' + (maxp ? v / maxp * 100 : 0).toFixed(0) + '%"></i><small>' + k + "</small></span>"; }).join("") + "</div></div>";
    html += '<div class="panel"><h3>Seed odds</h3><div class="seeds">' + o.seeds.slice(0, 7).map(function (v, k) { return '<span><b>' + pctTxt(v) + "</b><small>No. " + (k + 1) + "</small></span>"; }).join("") + '<span><b>' + pctTxt(1 - o.playoffs) + "</b><small>Out</small></span></div></div>";
    html += unitDepth(code) + "</div></div>";
    return needsPanel(code) + html;
  }
  // Grades by position group for next season and the biggest needs, with why
  var GROUP_SHORT = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", OT: "Tackle", IOL: "Int. OL", EDGE: "Edge", IDL: "Int. DL", LB: "LB", CB: "CB", S: "Safety" };
  function needsPanel(code) {
    var y = W.season + 1, T = P.needs(W, y)[code], bb = (W.bbNeeds || {})[code] || [];
    var bbg = bb.map(function (x) { return x === "DL" ? "IDL" : x; });
    var html = '<div class="panel needs"><h3>' + y + " roster grades and needs <small>starters under contract for " + y + ", rated with aging, against the other 31 teams</small></h3>";
    html += '<div class="grades">' + P.NEED_GROUPS.map(function (g) { var G = T.groups[g]; return '<span class="gr g' + G.grade + '" title="' + esc(GROUP_SHORT[g]) + ": starters average " + Math.round(50 + 15 * G.mean) + (G.why ? "; " + esc(G.why) : "") + '"><b>' + G.grade + "</b><small>" + esc(GROUP_SHORT[g]) + "</small></span>"; }).join("") + "</div>";
    html += '<ol class="needlist">' + (T.top.length ? T.top.map(function (x) { return "<li><b>" + esc(GROUP_SHORT[x.g]) + '</b> <span class="pill ' + (x.grade === "F" ? "fill" : "warn") + '">' + x.grade + "</span> " + esc(x.why) + (bbg.indexOf(x.g) >= 0 ? ' <small class="note">(also on the Big Board\'s list)</small>' : "") + "</li>"; }).join("") : '<li class="note">No glaring holes: every group grades C or better.</li>') + "</ol>";
    if (bb.length) html += '<p class="note pad">The Big Board\'s draft needs: ' + bb.map(esc).join(", ") + ".</p>";
    return html + "</div>";
  }
  // Depth chart by unit: starter first, then the backups, each with the stat that matters
  var UNITS = { Offense: ["QB", "RB", "FB", "WR1", "WR2", "Slot", "WR", "TE", "LT", "LG", "C", "RG", "RT"], Defense: ["LDE", "DE", "EDGE", "LDT", "DT", "NT", "RDT", "RDE", "LOLB", "WLB", "LILB", "MLB", "LB", "RILB", "SLB", "ROLB", "LCB", "CB", "RCB", "NB", "SS", "S", "FS"], "Special teams": ["PK", "K", "P", "LS", "H", "PR", "KR"] };
  function keyStat(p) {
    var s = st(p); if (!s) return p.snaps ? Math.round(P.share(W, p) * 100) + "% snaps" : "";
    var g = P.group(p);
    if (g === "QB") return s.passing_yards + " yds · " + s.passing_tds + " TD";
    if (g === "RB") return s.rushing_yards + " rush yds";
    if (g === "WR" || g === "TE") return s.receptions + " rec · " + s.receiving_yards + " yds";
    if (g === "EDGE" || g === "IDL") return s.def_sacks + " sacks · " + s.def_qb_hits + " hits";
    if (g === "LB") return (s.def_tackles_solo + s.def_tackle_assists) + " tkl";
    if (g === "CB" || g === "S") return s.def_interceptions + " INT · " + s.def_pass_defended + " PD";
    if (g === "K") return s.fg_made + "/" + s.fg_att + " FG";
    return p.snaps ? Math.round(P.share(W, p) * 100) + "% snaps" : "";
  }
  function unitDepth(code) {
    var d = W.depth[code];
    if (!d) return "";
    var by = {}; d.rows.forEach(function (r) { (by[r[0]] = by[r[0]] || []).push(r); });
    var off = Object.keys(by).find(function (g) { return by[g].some(function (r) { return r[1] === "QB"; }); });
    var def = Object.keys(by).find(function (g) { return by[g].some(function (r) { return /CB/.test(r[1]); }); });
    var stg = Object.keys(by).find(function (g) { return by[g].some(function (r) { return r[1] === "P" || r[1] === "PK"; }); });
    var html = "";
    [["Offense", off], ["Defense", def], ["Special teams", stg]].forEach(function (u) {
      if (!u[1]) return;
      var rows = by[u[1]], pos = {};
      // receivers: ESPN ranks them together across the three spots; the top three by rank fill WR1, WR2 and the slot
      // (the lowest-numbered field spots are the outside receivers), and the rest are backups
      var wrs = rows.filter(function (r) { return r[1] === "WR"; }).sort(function (a, b) { return a[2] - b[2]; });
      var nWr = Object.keys(wrs.reduce(function (o, r) { o[r[5] || 0] = 1; return o; }, {})).length;
      var wrStart = wrs.slice(0, nWr).sort(function (a, b) { return (a[5] || 0) - (b[5] || 0); }), wrBack = wrs.slice(nWr);
      rows.forEach(function (r) { if (r[1] !== "WR") (pos[r[1]] = pos[r[1]] || []).push(r); });
      wrStart.forEach(function (r, i) {
        var k = nWr >= 3 && i === nWr - 1 ? "Slot" : "WR" + (i + 1);
        pos[k] = [[r[0], k, 1, r[3], r[4], 0]].concat(wrBack.filter(function (b, j) { return j % nWr === i; }).map(function (b, j) { return [b[0], k, j + 2, b[3], b[4], 0]; }));
      });
      var order = Object.keys(pos).sort(function (a, b) { var A = UNITS[u[0]].indexOf(a), B = UNITS[u[0]].indexOf(b); return (A < 0 ? 99 : A) - (B < 0 ? 99 : B); });
      html += '<div class="panel"><h3>' + u[0] + " <small>" + esc(u[1]) + '</small></h3><div class="ulist">' + order.map(function (k) {
        var list = pos[k].sort(function (a, b) { return a[2] - b[2]; });
        var nStart = Object.keys(list.reduce(function (o, r) { o[r[5] || 0] = 1; return o; }, {})).length;
        if (k === "NB" && /base/i.test(u[1])) nStart = 0;
        var chip = function (r, starter) {
          var p = W.byId[r[3]];
          return '<span class="uc' + (starter ? " st" : "") + '"' + (p ? ' data-p="' + esc(p.id) + '"' : "") + ">" + (p ? face(p, starter ? 30 : 22) : "") + '<span><b>' + esc(starter ? r[4] : lastName(r[4])) + "</b>" + (starter && p ? "<small>" + score(p) + " rating · " + esc(keyStat(p)) + "</small>" : "") + "</span></span>";
        };
        return '<div class="urow"><span class="up">' + esc(k) + '</span><span class="us">' + list.slice(0, Math.max(1, nStart)).map(function (r) { return chip(r, true); }).join("") + '</span><span class="ub">' + list.slice(Math.max(1, nStart), Math.max(1, nStart) + 3).map(function (r) { return chip(r, false); }).join("") + "</span></div>";
      }).join("") + "</div></div>";
    });
    return html;
  }

  // ---------- team ----------
  function teamPage() {
    var code = state.arg && TEAMS[state.arg] ? state.arg : load("team", "NE");
    save("team", code);
    var y = +state.q.y || 2027, v = state.q.v || "overview", t = team(code), ms = movesOf(code), o = SIM.teams[code];
    var base = C.teamYears(W, code, [], 2026, 2030), plan = C.teamYears(W, code, ms.map(eng), 2026, 2030), cc = C.creditCard(W, code, 2026);
    var html = '<div class="thead tband" style="--tc:' + t.color + '">' + logo(code, 64) + "<div><h2>" + esc(t.name) + '</h2><div class="meta">' + esc(S.divOf[code]) + " · " + rec(o.rec) + " · projected " + o.wins.toFixed(1) + "-" + (17 - o.wins).toFixed(1) + " · strength " + (o.rating >= 0 ? "+" : "") + o.rating.toFixed(1) + " pts</div></div>" +
      '<select class="allteams" data-goteam aria-label="Team">' + codes().map(function (c) { return '<option value="' + c + '"' + (c === code ? " selected" : "") + ">" + esc(team(c).name) + "</option>"; }).join("") + "</select></div>";
    html += '<div class="stats">' + stat(pctTxt(o.div), "Win the division") + stat(pctTxt(o.playoffs), "Make the playoffs") + stat(pctTxt(o.bye), "No. 1 seed") + stat(pctTxt(o.sb), "Win the Super Bowl") + "</div>";
    html += '<div class="stats sm">' + stat(m(base[0].space), "2026 cap space") + stat('<i class="' + (plan[1].space >= 0 ? "pos" : "neg") + '">' + m(plan[1].space) + "</i>", "2027 space" + (ms.length ? " (with plan)" : "")) + stat(m(base[0].dead), "2026 dead money") +
      stat(m(cc.future), "Pushed into later years") + stat(cc.voids > 0.05 ? m(cc.voids) : "None", "In void years") + "</div>";
    html += '<div class="subtabs">' + [["overview", "Overview"], ["depth", "Depth chart"], ["draft", "Draft"], ["plan", "Offseason planner"], ["gm", "Play GM"], ["sheet", "Cap sheet"], ["ngs", "Next Gen Stats"]].map(function (x) { return '<a href="' + href("team/" + code, Object.assign({}, state.q, { v: x[0] })) + '"' + (v === x[0] ? ' aria-current="page"' : "") + ">" + x[1] + "</a>"; }).join("") + "</div>";
    if (v === "sheet") html += capSheet(code, ms);
    else if (v === "depth") html += depthChart(code);
    else if (v === "draft") html += draftTab(code);
    else if (v === "gm") html += gmTab(code, ms);
    else if (v === "plan") html += planner(code, y, ms, base, plan);
    else if (v === "ngs") html += teamNgs(code);
    else html += overview(code);
    view.innerHTML = html;
  }
  view.addEventListener("change", function (e) {
    var tp = e.target.closest("input[data-tradep]");
    if (tp) { var hit = W.players.filter(function (q) { return q.n + " · " + q.t + " " + posOf(q) === tp.value; })[0]; if (hit) location.hash = href("trade", { p: hit.id, t: state.q.t && state.q.t !== hit.t ? state.q.t : null }); return; }
    var s = e.target.closest("select[data-goteam]");
    if (s) { location.hash = href("team/" + s.value, { v: state.q.v, y: state.q.y }); return; }
    var a = e.target.closest("select[data-act]");
    if (a && a.value) {
      var code = state.arg || load("team", "NE"), ms = movesOf(code).filter(function (x) { return x.id !== a.dataset.act; });
      var y = +state.q.y || 2027, mv = { kind: a.value, id: a.dataset.act, year: y };
      if (a.value === "extend") { var p = W.byId[a.dataset.act]; mv.apy = P.extensionApy(W, p, y + 1); mv.years = estYears(p.id, "extend", y); }
      ms.push(mv); setMoves(code, ms);
    }
    var yr = e.target.closest("select[data-planyear]");
    if (yr) location.hash = href("team/" + (state.arg || load("team", "NE")), Object.assign({}, state.q, { y: yr.value }));
  });
  view.addEventListener("click", function (e) {
    var code = state.arg || load("team", "NE");
    var add = e.target.closest("[data-addmove]"), rm = e.target.closest("[data-rmmove]"), clr = e.target.closest("[data-clearplan]"), cp = e.target.closest("[data-copyplan]");
    if (add) {
      var a = add.dataset.addmove.split("|"), mv = { kind: a[0], id: a[1], year: +a[2] };
      if (a[3]) mv.apy = +a[3]; if (a[4]) mv.amount = +a[4]; if (mv.kind === "extend" || mv.kind === "resign") mv.years = estYears(mv.id, mv.kind, mv.year);
      var ms = movesOf(code).filter(function (x) { return x.id !== mv.id; }); ms.push(mv); setMoves(code, ms); return;
    }
    if (rm) { setMoves(code, movesOf(code).filter(function (x) { return x.id !== rm.dataset.rmmove; })); return; }
    var gb = e.target.closest("[data-gmban]"), gu = e.target.closest("[data-gmunban]");
    if (gb || gu) { var q3 = Object.assign({}, state.q), bl = (q3.b || "").split(",").filter(Boolean); if (gb) bl.push(gb.dataset.gmban); q3.b = gu ? null : bl.join(","); location.hash = href("team/" + state.arg, q3); return; }
    var of = e.target.closest("[data-offer]"), ofr = e.target.closest("[data-offerreset]");
    if (of || ofr) {
      var q0 = Object.assign({}, state.q);
      if (ofr) q0.o = null;
      else {
        var cur = Array.prototype.map.call(view.querySelectorAll(".deal2 .pchip.on"), function (b) { return b.dataset.offer; });
        var k = of.dataset.offer, ix = cur.indexOf(k);
        if (ix >= 0) cur.splice(ix, 1); else cur.push(k);
        q0.o = cur.join(",");
      }
      location.hash = href("trade", q0); return;
    }
    var pk = e.target.closest("[data-picks]");
    if (pk) { picksCard(pk.dataset.picks); return; }
    var op = e.target.closest("[data-opts]");
    if (op) { moveChooser(op.dataset.opts); return; }
    if (clr) { setMoves(code, []); return; }
    if (cp) { try { navigator.clipboard.writeText(location.href); cp.textContent = "Link copied"; } catch (x) { /* no clipboard */ } }
  });

  // The planner: suggestions, the moves so far, and the five-year picture before and after
  function planner(code, y, ms, base, plan) {
    var sug = P.suggest(W, code, y), on = {};
    ms.forEach(function (x) { on[x.id] = x; });
    var yi = YEARS.indexOf(y), b0 = base[yi] || base[1], p0 = plan[yi] || plan[1], gain = p0.space - b0.space;
    // the scoreboard: stays at the top while scrolling
    var html = '<div class="planbar"><label>Plan for<select data-planyear>' + [2026, 2027, 2028].map(function (k) { return '<option value="' + k + '"' + (k === y ? " selected" : "") + ">" + k + (k === 2027 ? " offseason" : k === 2026 ? " (now)" : "") + "</option>"; }).join("") + "</select></label>" +
      '<div class="pb-num"><span>' + y + " cap space</span><b>" + m(b0.space) + (ms.length ? ' <i>→</i> <em class="' + (p0.space >= 0 ? "pos" : "neg") + '">' + m(p0.space) + "</em>" : "") + "</b></div>" +
      (ms.length ? '<div class="pb-num"><span>Your moves</span><b class="' + (gain >= 0 ? "pos" : "neg") + '">' + sm(gain) + '</b></div><div class="pb-num"><span>New dead money</span><b>' + m(p0.newDead) + "</b></div>" : '<p class="pb-hint">Add moves from the suggestions below, or tap <b>Options</b> next to any player to compare every move for him.</p>') +
      (ms.length ? '<div class="pb-act"><button type="button" class="btn sm" data-copyplan>Share</button><button type="button" class="btn sm" data-clearplan>Reset</button></div>' : "") + "</div>";
    // the moves so far
    if (ms.length) {
      html += '<div class="panel"><h3>Your plan <small>' + ms.length + " move" + (ms.length > 1 ? "s" : "") + '</small></h3><ul class="rlist moves">' + ms.map(function (mv) {
        var p = W.byId[mv.id], e = C.effect(p, eng(mv)), d = -(e.delta[mv.year] || 0);
        var later = Object.keys(e.delta).filter(function (k) { return +k > mv.year; }).reduce(function (a, k) { return a - e.delta[k]; }, 0);
        var dead = Object.keys(e.dead).reduce(function (a, k) { return a + e.dead[k]; }, 0);
        return "<li>" + pname(p, 30) + '<span class="grow"><b>' + esc(moveTitle(mv)) + '</b><span class="note">' + (dead > 0.05 ? m(dead) + " dead money" : "No dead money") + (Math.abs(later) > 0.05 ? " · " + sm(later) + " in later years" : "") + '</span></span><b class="big ' + (d >= 0 ? "pos" : "neg") + '">' + sm(d) + '</b><button type="button" class="xbtn" data-rmmove="' + esc(mv.id) + '" aria-label="Remove">×</button></li>';
      }).join("") + "</ul></div>";
    }
    // five years
    html += '<div class="panel"><h3>Cap space by year</h3><div class="scroll"><table class="t five"><thead><tr><th></th>' + YEARS.map(function (k) { return "<th>" + k + "</th>"; }).join("") + "</tr></thead><tbody>" +
      "<tr><td>Team cap</td>" + base.map(function (r) { return "<td>" + m(r.cap) + "</td>"; }).join("") + "</tr>" +
      "<tr><td>Contracts</td>" + base.map(function (r) { return "<td>" + m(r.active) + "</td>"; }).join("") + "</tr>" +
      "<tr><td>Dead money</td>" + base.map(function (r) { return "<td>" + m(r.dead) + "</td>"; }).join("") + "</tr>" +
      '<tr><td>Draft picks to sign <button type="button" class="linkbtn" data-picks="' + code + '">which?</button></td>' + base.map(function (r) { return "<td>" + (r.rookies > 0.05 ? m(r.rookies) : "—") + "</td>"; }).join("") + "</tr>" +
      '<tr class="tot"><td>Space today</td>' + base.map(function (r) { return '<td class="' + (r.space >= 0 ? "pos" : "neg") + '">' + m(r.space) + "</td>"; }).join("") + "</tr>" +
      (ms.length ? "<tr><td>Your moves</td>" + plan.map(function (r) { return '<td class="' + (r.moves <= 0 ? "pos" : "neg") + '">' + (Math.abs(r.moves) > 0.05 ? sm(-r.moves) : "—") + "</td>"; }).join("") + "</tr>" +
        '<tr class="tot"><td>With your plan</td>' + plan.map(function (r) { return '<td class="' + (r.space >= 0 ? "pos" : "neg") + '"><b>' + m(r.space) + "</b></td>"; }).join("") + "</tr>" : "") +
      '</tbody></table></div><p class="note">2026 and 2027 start from Over The Cap\'s team figures (carryover included). Draft picks: each pick\'s rookie cap hit less the minimum-salary player he pushes off the top 51 (2027 at each pick\'s expected spot from the season sim, 2028 from the 2027 power ranking, with traded picks counted). Later years count only today\'s contracts against a projected cap, so they look roomier than they will be.</p></div>';
    // suggestions as cards: the money first
    var groups = [["cut", "Cut", "Saves real money with little dead money"], ["trade", "Trade", "Saves more traded than cut: his guarantees leave with him"],
      ["restructure", "Restructure", "Room now on a player the team keeps, paid back later"], ["extend", "Extend", "Starters in the last year of their deals"],
      ["tag", "Franchise tag", "Real candidates only: rated 60+, 30 or younger, market near the tag price"], ["expiring", "Re-sign or let walk", "Starters whose deals end after " + (y - 1)]];
    html += '<h3 class="subsec">Ideas for ' + y + '</h3><p class="note">The cap numbers are exact. Who\'s worth keeping uses the player rating and value, so treat these as strong starting points, not verdicts.</p><div class="sugs">';
    var tagged = {}; sug.forEach(function (s) { if (s.kind === "tag") tagged[s.p.id] = 1; });
    groups.forEach(function (g) {
      var list = sug.filter(function (s) { return s.kind === g[0]; }).slice(0, 4);
      if (!list.length && g[0] === "tag") { html += '<div class="panel"><h3>Franchise tag <small>' + g[2] + '</small></h3><p class="note pad">No real candidates this year: nobody whose deal runs out is good enough, young enough and priced close enough to the tag to be worth it.</p></div>'; return; }
      if (!list.length) return;
      html += '<div class="panel"><h3>' + g[1] + " <small>" + g[2] + "</small></h3>" + list.map(function (s) {
        var num = s.kind === "tag" ? m(s.tag) : s.kind === "expiring" ? m(s.apy) + "/yr" : s.kind === "extend" ? (s.now > 0.05 ? sm(s.now) : m(s.apy) + "/yr") : sm(s.save);
        var btns = on[s.p.id] ? '<span class="pill up">' + esc(KIND[on[s.p.id].kind]) + "</span>" : s.kind === "tag"
          ? '<button type="button" class="btn sm" data-addmove="' + esc("tag|" + s.p.id + "|" + y + "||" + s.tag.toFixed(2)) + '">Tag him</button><button type="button" class="btn sm ghost" data-addmove="' + esc("resign|" + s.p.id + "|" + y + "|" + s.apy.toFixed(2)) + '">Re-sign instead</button> <span class="pill ' + (s.verdict === "fair" ? "up" : s.verdict === "pricey" ? "warn" : "fill") + '">' + (s.verdict === "fair" ? "Fair price" : s.verdict === "pricey" ? "Pricey" : "Steep") + "</span>"
          : s.kind === "expiring"
          ? '<button type="button" class="btn sm" data-addmove="' + esc("resign|" + s.p.id + "|" + y + "|" + s.apy.toFixed(2)) + '">Re-sign</button>' + (tagged[s.p.id] ? '<button type="button" class="btn sm" data-addmove="' + esc("tag|" + s.p.id + "|" + y + "||" + s.tag.toFixed(2)) + '">Tag</button>' : "")
          : '<button type="button" class="btn sm" data-addmove="' + esc(s.kind === "extend" ? "extend|" + s.p.id + "|" + y + "|" + s.apy.toFixed(2) : s.kind + "|" + s.p.id + "|" + y) + '">Add</button><button type="button" class="btn sm ghost" data-opts="' + esc(s.p.id) + '">Options</button>';
        return '<div class="scard"><div class="sc-top">' + pname(s.p, 34) + '<span class="note">' + esc(posOf(s.p)) + " · " + (s.p.age ? Math.floor(s.p.age) : "—") + (s.cap ? " · " + m(s.cap) + " cap hit" : "") + '</span><b class="big ' + (s.kind === "expiring" || s.kind === "tag" ? "" : "pos") + '">' + num + '</b></div><p>' + esc(s.why) + '</p><div class="sc-btns">' + btns + "</div></div>";
      }).join("") + "</div>";
    });
    html += "</div>";
    html += capSheet(code, ms, y, true);
    return html;
  }
  // Every move for one player, side by side: what it does this year, the dead money, and the years after
  function moveChooser(id) {
    var p = W.byId[id], y = +state.q.y || 2027, code = p.t, cur = movesOf(code).filter(function (x) { return x.id === id; })[0];
    if (!p.c || !p.c.rows[y] || p.c.rows[y][C.R.void]) { cardBody.innerHTML = '<div class="card-b"><p>No contract year in ' + y + " to work with.</p></div>"; if (!card.open) card.showModal(); return; }
    var est = P.contract(W, p, y + 1), apy = est.apy;
    var opts = [["cut", "Cut him before June 1", "Every remaining bonus dollar and guarantee hits now"], ["cutJune", "Cut him after June 1", "Splits the dead money over two years (two of these a year)"],
      ["trade", "Trade him", "Bonus money stays behind; salary and guarantees go"], ["tradeJune", "Trade him after June 1", "Same, with the bonus money split over two years"],
      ["restructure", "Restructure", "Turn base salary into a bonus spread over his remaining years"], ["restructureV", "Restructure with void years", "Spread it over five years, adding fake years at the end"],
      ["extend", "Extend " + est.yrs + " year" + (est.yrs > 1 ? "s" : "") + " at " + m(apy) + "/yr", m(est.total) + " total, " + m(est.gtd) + " guaranteed, from comparable deals; this year's base folded into a signing bonus"]];
    var html = '<div class="card-h">' + face(p, 56) + "<div><h3>" + esc(p.n) + '</h3><div class="meta">' + esc(posOf(p)) + " · " + m(C.capHit(p, y)) + " cap hit in " + y + " · rating " + score(p) + " · value " + m(P.value(W, p, y)) + '</div></div></div><div class="card-b"><table class="t choose"><thead><tr><th>Move</th><th>' + y + "</th><th>Dead money</th><th>Later years</th><th></th></tr></thead><tbody>";
    opts.forEach(function (o) {
      var mv = { kind: o[0], id: id, year: y }; if (o[0] === "extend") { mv.apy = apy; mv.years = est.yrs; }
      var e = C.effect(p, eng(mv)), now = -(e.delta[y] || 0), dead = Object.keys(e.dead).reduce(function (a, k) { return a + e.dead[k]; }, 0);
      var later = Object.keys(e.delta).filter(function (k) { return +k > y; }).reduce(function (a, k) { return a - e.delta[k]; }, 0);
      var none = (o[0].indexOf("restructure") === 0 && !e.converted);
      html += "<tr" + (cur && cur.kind === o[0] ? ' class="planned"' : "") + '><td><b>' + o[1] + '</b><small class="note">' + o[2] + '</small></td><td class="' + (now >= 0 ? "pos" : "neg") + '"><b>' + (none ? "—" : sm(now)) + "</b></td><td>" + (dead > 0.05 ? m(dead) : "—") + '</td><td class="' + (later >= 0 ? "pos" : "neg") + '">' + (Math.abs(later) > 0.05 ? sm(later) : "—") + "</td><td>" +
        (none ? "" : cur && cur.kind === o[0] ? '<span class="pill up">Chosen</span>' : '<button type="button" class="btn sm" data-choose="' + esc([o[0], id, y, mv.apy ? mv.apy.toFixed(2) : ""].join("|")) + '">Choose</button>') + "</td></tr>";
    });
    html += '</tbody></table><p class="note">Green is cap room gained, red is room lost. Later years: the total change across the seasons after ' + y + ".</p>" + (cur ? '<p><button type="button" class="btn sm" data-unchoose="' + esc(id) + '">Remove his move from the plan</button></p>' : "") + "</div>";
    cardBody.innerHTML = html;
    if (!card.open) card.showModal();
  }

  // Every contract by year, with the dead money if he's cut, and (in the planner) a move menu
  function capSheet(code, ms, y, withActions) {
    y = y || +state.q.y || 2027;
    var on = {}; (ms || []).forEach(function (x) { on[x.id] = x; });
    var rows = C.sheet(W, code, 2026, 2030);
    var html = '<div class="panel"><h3>' + (withActions ? "Cap sheet and moves" : "Cap sheet") + " <small>cap numbers by year; dead money and savings if cut before June 1 in " + y + '</small></h3><div class="scroll"><table class="t sheet"><thead><tr><th>Player</th><th>Pos</th><th>Age</th>' + YEARS.map(function (k) { return "<th>" + k + "</th>"; }).join("") +
      "<th>Dead if cut " + y + "</th><th>Saves</th>" + (withActions ? "<th>Move</th>" : "") + "</tr></thead><tbody>";
    rows.forEach(function (x) {
      var p = x.p, r = x.yrs[y], cut = r && !r[C.R.void] ? C.effect(p, { kind: "cut", year: y }) : null, mv = on[p.id];
      html += "<tr" + (mv ? ' class="planned"' : "") + "><td>" + pname(p, 22, p.st === "RES" ? ' <span class="pill warn">IR</span>' : p.st === "DEV" ? ' <span class="pill">PS</span>' : "") + "</td><td>" + esc(posOf(p)) + "</td><td>" + (p.age ? Math.floor(p.age) : "—") + "</td>" +
        YEARS.map(function (k) { var rr = x.yrs[k]; return rr ? '<td class="' + (rr[C.R.void] ? "void" : "") + (rr[C.R.est] ? " est" : "") + '"' + (rr[C.R.void] ? ' title="Void year: bonus proration only"' : rr[C.R.est] ? ' title="Estimated: this deal has no year-by-year breakdown yet"' : "") + ">" + m(rr[C.R.cap]) + "</td>" : '<td class="none"></td>'; }).join("") +
        "<td>" + (cut ? m(cut.dead[y] || 0) : "") + '</td><td class="' + (cut && -(cut.delta[y] || 0) > 0 ? "pos" : "neg") + '">' + (cut ? sm(-(cut.delta[y] || 0)) : "") + "</td>" +
        (withActions ? "<td>" + (r && !r[C.R.void] ? '<button type="button" class="btn sm' + (mv ? " on" : "") + '" data-opts="' + esc(p.id) + '">' + (mv ? esc(KIND[mv.kind]) : "Options") + "</button>" : "") + "</td>" : "") + "</tr>";
    });
    return html + '</tbody></table></div><p class="note">Italic: void years (signing bonus money only, there to lower earlier cap numbers). Dotted: estimated, for deals signed this year that have no year-by-year breakdown yet.</p></div>';
  }

  // The depth chart on a field: the starting eleven on offense and defense from ESPN's newest chart
  var SPOTS = {
    QB: [50, 74], RB: [50, 86], FB: [41, 81], WR: [10, 66], "WR2": [91, 66], "WR3": [85, 74], TE: [72, 66], "TE2": [28, 66], "RB2": [60, 84], LT: [34, 63], LG: [42, 63], C: [50, 63], RG: [58, 63], RT: [66, 63],
    LDE: [35, 40], LDT: [44, 40], NT: [50, 40], RDT: [56, 40], RDE: [65, 40], DT: [44, 40], DT2: [56, 40], DE: [33, 40], DE2: [67, 40], EDGE: [27, 38], EDGE2: [73, 38], WLB: [27, 32], MLB: [50, 27], SLB: [73, 32], LILB: [42, 26], RILB: [58, 26], LB: [42, 26], LB2: [58, 26], LOLB: [27, 36], ROLB: [73, 36],
    LCB: [10, 31], RCB: [90, 31], NB: [83, 25], CB: [10, 31], CB2: [90, 31], SS: [38, 13], FS: [62, 13], S: [38, 13], S2: [62, 13], PK: [50, 95], P: [50, 95]
  };
  function depthChart(code) {
    var d = W.depth[code];
    if (!d) return '<p class="note">No depth chart in the feed for this team yet.</p>';
    // offense: the formation group with the most rows that has QB; defense: the one with CBs
    var by = {};
    d.rows.forEach(function (r) { (by[r[0]] = by[r[0]] || []).push(r); });
    var off = Object.keys(by).find(function (g) { return by[g].some(function (r) { return r[1] === "QB"; }); });
    var def = Object.keys(by).find(function (g) { return by[g].some(function (r) { return /CB/.test(r[1]); }); });
    var place = function (g, side) {
      var out = [], rows = by[g] || [], slots = {}, cnt = {}, picked = [];
      rows.forEach(function (r) { (slots[r[1]] = slots[r[1]] || {})[r[5] || 0] = 1; });
      Object.keys(slots).forEach(function (abb) {
        if (abb === "FB" && !/FB|2RB|21|22/.test(g)) return;           // ESPN lists a fullback in sets without one
        if (abb === "NB" && /base/i.test(g)) return;                     // and a nickel back in its base defense
        var n = Object.keys(slots[abb]).length;
        rows.filter(function (r) { return r[1] === abb; }).sort(function (a, b) { return a[2] - b[2]; }).slice(0, n).forEach(function (r) { picked.push(r); });
      });
      picked.sort(function (a, b) { return (a[5] || 0) - (b[5] || 0); }).forEach(function (r) {
        cnt[r[1]] = (cnt[r[1]] || 0) + 1;
        var key = cnt[r[1]] > 1 ? r[1] + cnt[r[1]] : r[1];
        var label = r[1] === "WR" ? (cnt.WR === 3 ? "Slot" : "WR" + cnt.WR) : r[1];
        var xy = SPOTS[key] || SPOTS[key.replace(/[0-9]/g, "")] || [50, side === "o" ? 80 : 20];
        var p = W.byId[r[3]];
        out.push('<div class="dspot" style="left:' + xy[0] + "%;top:" + xy[1] + '%">' + (p ? '<button type="button" data-p="' + esc(p.id) + '">' + face(p, 30) + "</button>" : "") + '<span class="dn"><b>' + esc(label) + "</b> " + esc(lastName(r[4])) + "</span></div>");
      });
      return out.join("");
    };
    var html = '<div class="gridwrap"><div class="gridiron"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="100" class="turf"/>' +
      [10, 20, 30, 40, 50, 60, 70, 80, 90].map(function (k) { return '<line x1="0" x2="100" y1="' + k + '" y2="' + k + '" class="yd"/>'; }).join("") + '<line x1="0" x2="100" y1="50" y2="50" class="los"/></svg>' +
      place(def, "d") + place(off, "o") + "</div></div>";
    html += '<p class="note center">ESPN\'s depth chart as of ' + esc(d.dt) + ": defense (" + esc(def || "") + ") on top, offense (" + esc(off || "") + ") below. Tap a player for his contract.</p>";
    html += unitDepth(code);
    return html;
  }

  // ---------- player card ----------
  // the player card, on the shared frame (assets/pcard.js): Overview, Stats, Next Gen, Contract
  function nextGameOf(code) {
    var gs = W.games.filter(function (g) { return g[0] === "REG" && g[5] == null && (g[3] === code || g[4] === code); }).sort(function (a, b) { return a[1] - b[1]; });
    var g = gs[0]; if (!g) return null;
    var home = g[4] === code, o = home ? g[3] : g[4], d = new Date(g[2] + "T12:00:00");
    var ln = lineOf(g).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
    var tm = g[10] ? (function (h, mi) { return (h % 12 || 12) + (mi === "00" ? "" : ":" + mi) + (h >= 12 ? " PM" : " AM") + " ET"; })(+g[10].split(":")[0], g[10].split(":")[1]) : "";
    return { when: [d.toLocaleDateString("en-US", { weekday: "short" }), d.toLocaleDateString("en-US", { month: "short", day: "numeric" })], what: (home ? "vs " : "at ") + '<a href="' + href("game/" + g[3] + "-" + g[4], { w: g[1] }) + '">' + esc(team(o).name) + "</a>",
      sub: ["Week " + g[1], ln && ln !== "—" ? ln : "", tm].filter(Boolean).join(", ") };
  }
  function openCard(id) {
    var p = W.byId[id];
    if (!p) return;
    var PC = window.PCard, t = team(p.t), c = p.c || {}, ys = Object.keys(c.rows || {}).map(Number).sort(), g = P.group(p), s = st(p);
    // overview: rating, next game, value
    var ov = ratingBlock(p);
    var ng = nextGameOf(p.t);
    if (ng) ov += PC.sec("Next game") + PC.line(ng);
    ov += PC.sec("Value") + PC.facts([[p.snaps ? Math.round(P.share(W, p) * 100) + "%" : "—", "Snap share" + (p.snaps ? " (" + p.snaps[3] + " g)" : "")], [m(P.value(W, p, W.season)), "Value this season"], [m(P.value(W, p, W.season + 1)), "Value next season"]]);
    // stats: season line and game log (the log loads into #glog)
    var stp = statBlock(p) + '<div id="glog"></div>';
    // contract
    var ct = PC.facts([[c.yrs ? c.yrs + " yr, " + m(c.value) : "—", "Contract (" + (c.signed || "—") + ")"], [m(c.apy), "Per year"], [m(nowHit(p, c)), W.season + " cap hit" + (c.apy && Math.abs(nowHit(p, c) - c.apy) > Math.max(1, c.apy * 0.25) ? " (escalators and bonuses move it off the average)" : "")], [m(c.gtd), "Guaranteed"]]) +
      nextDeal(p) + (p.c && C.lastYear(p) > W.season ? '<p class="tvlink"><a class="btn sm" href="' + href("trade", { p: p.id }) + '">What would it take to trade for him?</a></p>' : "");
    if (ys.length) {
      ct += '<h4 class="card-sec">Contract year by year</h4><div class="scroll"><table class="t"><thead><tr><th>Year</th><th title="Base salary">Base</th><th title="Signing and option bonus money counted this year">Bonus</th><th title="Roster, workout and other bonuses">Other</th><th title="Guaranteed salary">Gtd</th><th>Cap hit</th><th title="Dead money if cut before June 1">Dead</th><th title="Cap saved by cutting him before June 1">Saves</th><th title="Cap saved with a post-June 1 cut">June 1</th></tr></thead><tbody>' + ys.map(function (y) {
        var r = c.rows[y], cut = !r[C.R.void] ? C.effect(p, { kind: "cut", year: y }) : null, june = !r[C.R.void] ? C.effect(p, { kind: "cutJune", year: y }) : null;
        return "<tr" + (r[C.R.void] ? ' class="muted-row"' : "") + "><td>" + y + (r[C.R.void] ? " (void)" : r[C.R.est] ? " (est.)" : "") + "</td><td>" + m(r[0]) + "</td><td>" + m(r[1]) + "</td><td>" + m(r[2] + r[3]) + "</td><td>" + (r[4] ? m(r[4]) : "—") + "</td><td><b>" + m(r[5]) + "</b></td><td>" + (cut ? m(cut.dead[y] || 0) : "") + '</td><td class="' + (cut && -(cut.delta[y] || 0) >= 0 ? "pos" : "neg") + '">' + (cut ? sm(-(cut.delta[y] || 0)) : "") + "</td><td>" + (june ? sm(-(june.delta[y] || 0)) : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
      ct += '<p class="note">Bonus: signing and option bonus money spread over the deal. Dead and Saves: if he\'s cut before June 1. June 1: savings with a post-June 1 cut. Cutting before June 1 puts every remaining bonus dollar and guarantee on that year; after June 1 (or with one of the two post-June 1 designations) the later years\' share moves to the next year. Contract data from Over The Cap via nflverse.</p>';
    } else ct += '<p class="note">No contract in the feed.</p>';
    var foot = '<div class="pc-acts"><a href="' + href("team/" + p.t, { v: "plan" }) + '">' + esc(t.name) + " planner</a>" + (c.otc ? '<a href="https://overthecap.com/player/x/' + esc(c.otc) + '/" target="_blank" rel="noopener">Over The Cap</a>' : "") + "</div>";
    var mine = (W.adj && W.adj[p.id]) || 0, steps = [-15, -10, -5, 5, 10, 15];
    foot += '<p class="myadj"><label>Your read <select data-adj="' + esc(p.id) + '"><option value="0"' + (mine ? "" : " selected") + ">Model\'s rating</option>" + steps.map(function (v) { return '<option value="' + v + '"' + (v === mine ? " selected" : "") + ">" + (v > 0 ? "+" : "") + v + " rating points</option>"; }).join("") + '</select></label> <span class="note">Moves his rating, value, trade value and next contract for you only. The season odds don\'t use player ratings.</span></p>';
    // chips and the headline row
    var j = p.inj, chips = [];
    if (j && INJ_CODE[j[0]] && !(W.week && j[3] < W.week)) chips.push([j[0] + (j[1] ? " (" + j[1].toLowerCase() + ")" : ""), INJ_CODE[j[0]] === "O" ? "out" : "inj"]);
    if (p.draft && p.exp <= 1) chips.push([p.draft[0] + " draft, pick " + p.draft[1], "tag"]);
    var ks = null;
    if (s) {
      if (g === "QB") ks = { v: s.passing_yards, l: "Pass yards" }; else if (g === "RB") ks = { v: s.rushing_yards, l: "Rush yards" }; else if (g === "WR" || g === "TE") ks = { v: s.receiving_yards, l: "Rec yards" };
      else if (g === "EDGE" || g === "IDL") ks = { v: s.def_sacks, l: "Sacks" }; else if (g === "LB") ks = { v: s.def_tackles_solo + s.def_tackle_assists, l: "Tackles" }; else if (g === "CB" || g === "S") ks = { v: s.def_interceptions + " / " + s.def_pass_defended, l: "INT / PD" };
      else if (g === "K") ks = { v: s.fg_made + "/" + s.fg_att, l: "Field goals" };
    }
    var head = [{ v: score(p), l: "Player rating" }, ks, { v: p.snaps ? Math.round(P.share(W, p) * 100) + "%" : null, l: "Snap share" }, { v: c.apy ? m(nowHit(p, c)) : null, l: W.season + " cap hit" }];
    var hasNgs = /^(QB|RB|WR|TE)$/.test(g);
    card.dataset.pid = id;
    cardBody.innerHTML = PC.html({ face: face(p, 60), name: p.n, color: t.color, team: '<a href="' + href("team/" + p.t) + '">' + logo(p.t, 18) + " " + esc(t.name) + "</a>",
      meta: [posOf(p), p.age ? "Age " + Math.floor(p.age) : "", p.exp === 0 ? "Rookie" : p.exp + " yrs exp", p.draft && p.exp > 1 ? p.draft[0] + " pick " + p.draft[1] : ""], chips: chips, head: head,
      tabs: [{ id: "ov", label: "Overview", html: ov }, { id: "st", label: "Stats", html: stp }, hasNgs ? { id: "tr", label: "Next Gen", html: '<div id="ngsc"><p class="note">Loading Next Gen Stats…</p></div>' } : null, { id: "ct", label: "Contract", html: ct }],
      foot: foot });
    if (!card.open) card.showModal();
    gameLog(p);
    ngsCard(p);
  }
  // ---------- Next Gen Stats ----------
  // nfl/data/ngs.json from tools/nfl_ngs.py: NGS's qualified season totals by GSIS id, in three pools (qb, rb, rec),
  // each player's numbers in x (order in NG.cols[pool]) and percentiles within his position in pct
  var NG = null, ngWait = null;
  function loadNgs() {
    if (!ngWait) ngWait = fetch("data/ngs.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (j) { NG = j || { cols: {}, qb: {}, rb: {}, rec: {}, none: true }; return NG; });
    return ngWait;
  }
  // label, key, decimals, tooltip; the pool's percentile (when it has one) shades the cell
  var NGCOLS = {
    qb: [["Att", "att", 0], ["Yds", "yds", 0], ["TD", "td", 0], ["INT", "int", 0], ["Rating", "rate", 1], ["Cmp%", "cmp", 1], ["xCmp%", "xcmp", 1, "Expected completion %: how often an average passer completes these same throws, from receiver separation, distance, pressure and more"], ["CPOE", "cpoe", 1, "Completion % over expected"], ["Time to throw", "ttt", 2, "Seconds from snap to release"], ["Air yds", "iay", 1, "Average air yards per attempt"], ["Air yds (comp)", "cay", 1, "Average air yards per completion"], ["Air yds to sticks", "sticks", 1, "How far past (or short of) the first-down marker his throws travel"], ["Tight window%", "aggr", 1, "Share of throws into tight coverage (a defender within a yard)"]],
    rb: [["Att", "att", 0], ["Yds", "yds", 0], ["Yds/att", "ypc", 1], ["TD", "td", 0], ["RYOE", "ryoe", 0, "Rush yards over expected: yards beyond what an average back would gain from the same blocking and defenders"], ["RYOE/att", "ryoe_att", 2], ["Beat expected", "beat", 1, "Share of carries that gained more than expected"], ["Efficiency", "eff", 2, "Yards run per yard gained: lower is a more north-south runner"], ["8+ in box%", "box8", 1, "Share of carries against eight or more defenders in the box"], ["Time to LOS", "tlos", 2, "Seconds to reach the line of scrimmage"]],
    rec: [["Tgt", "tgt", 0], ["Rec", "rec", 0], ["Yds", "yds", 0], ["TD", "td", 0], ["Catch%", "catch", 1], ["Separation", "sep", 2, "Yards from the nearest defender when the ball arrives or the pass is thrown"], ["Cushion", "cush", 2, "Yards between him and his defender at the snap"], ["Air yds", "iay", 1, "Average depth of his targets"], ["Air yds share", "share", 1, "His share of his team's intended air yards"], ["YAC", "yac", 1, "Yards after catch per reception"], ["xYAC", "xyac", 1], ["YAC over exp.", "yacoe", 2, "YAC per catch beyond what an average receiver gets on the same catches"]]
  };
  function ngColor(v) {
    if (v == null) return "transparent";
    var t = Math.max(0, Math.min(100, v)) / 100, mix = function (a, b, k) { return Math.round(a + (b - a) * k); };
    var c = t < 0.5 ? [mix(54, 222, t * 2), mix(97, 222, t * 2), mix(173, 222, t * 2)] : [mix(222, 210, (t - 0.5) * 2), mix(222, 45, (t - 0.5) * 2), mix(222, 73, (t - 0.5) * 2)];
    return "rgb(" + c.join(",") + ")";
  }
  function ngInk(v) { return v != null && (v >= 80 || v <= 20) ? "#fff" : "inherit"; }
  function ngOrd(n) { var v = n % 100; return n + (v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"); }
  function ngFmt(v, d) { return v == null ? "—" : d ? v.toFixed(d) : String(Math.round(v)); }
  function ngPool(g) { return g === "QB" ? "qb" : g === "RB" ? "rb" : "rec"; }
  function ngsPage() {
    if (!NG) { view.innerHTML = '<p class="loading">Loading Next Gen Stats…</p>'; loadNgs().then(function () { if (state.route === "ngs") render(); }); return; }
    var g = /^(QB|RB|WR|TE)$/.test(state.q.g) ? state.q.g : "QB", pool = ngPool(g), cols = NGCOLS[pool], idx = {};
    (NG.cols[pool] || []).forEach(function (k, i) { idx[k] = i; });
    var sort = idx[state.q.s] != null ? state.q.s : { qb: "cpoe", rb: "ryoe", rec: "sep" }[pool], dir = state.q.d === "asc" ? 1 : -1, sq = (state.q.q || "").toLowerCase();
    var rows = Object.keys(NG[pool] || {}).map(function (id) { return { id: id, d: NG[pool][id] }; })
      .filter(function (r) { return (pool !== "rec" || r.d.pos === g) && (!sq || String(r.d.n).toLowerCase().indexOf(sq) >= 0); });
    var val = function (r) { var v = r.d.x[idx[sort]]; return v == null ? -dir * 1e9 : v; };
    rows.sort(function (a, b) { return dir * (val(a) - val(b)); });
    var th = function (c) {
      var on = c[1] === sort, nd = on && dir < 0 ? "asc" : null;
      return '<th><a href="' + href("ngs", Object.assign({}, state.q, { s: c[1], d: nd })) + '"' + (on ? ' class="on"' : "") + (c[3] ? ' title="' + esc(c[3]) + '"' : "") + ">" + c[0] + (on ? (dir < 0 ? " ↓" : " ↑") : "") + "</a></th>";
    };
    var html = '<h2 class="sec">Next Gen Stats</h2><p class="lede">The NFL\'s player tracking numbers: chips in every player\'s shoulder pads record where everyone is ten times a second. Over expected stats compare each player with what an average player would do in the same spots. Shaded cells are percentiles within the position: red is good, blue is bad. Click a column to sort, a player for his card.</p>';
    html += '<div class="controls"><label>Position<select data-q="g">' + [["QB", "Quarterbacks"], ["RB", "Running backs"], ["WR", "Wide receivers"], ["TE", "Tight ends"]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === g ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select></label><label>Search<input type="search" data-q="q" value="' + esc(state.q.q || "") + '" placeholder="Player"></label></div>';
    html += tablePanel({ QB: "Quarterbacks", RB: "Running backs", WR: "Wide receivers", TE: "Tight ends" }[g] + " · " + rows.length, "<th>Player</th><th class=\"hm\">Team</th>" + cols.map(th).join(""),
      rows.map(function (r) {
        var p = W.byId[r.id], P2 = r.d.pct || {};
        return "<tr><td>" + (p ? pname(p, 24) : esc(r.d.n)) + '</td><td class="tm hm">' + logo(r.d.t, 18) + '<span class="nm">' + esc(r.d.t) + "</span></td>" + cols.map(function (c) {
          var v = r.d.x[idx[c[1]]], pc = P2[c[1]];
          return pc == null ? "<td>" + ngFmt(v, c[2]) + "</td>" : '<td class="ngc" style="background:' + ngColor(pc) + ";color:" + ngInk(pc) + '" title="' + ngOrd(pc) + ' percentile">' + ngFmt(v, c[2]) + "</td>";
        }).join("") + "</tr>";
      }).join(""), "qualified players, " + (NG.season || "") + " through week " + (NG.week || "—"), "trkt");
    html += '<p class="note">From the NFL\'s <a href="https://nextgenstats.nfl.com/" rel="noopener">Next Gen Stats</a> via nflverse, pulled ' + esc((NG.pulled || "").slice(0, 10)) + ". Only qualified players are listed (NGS's own cutoffs: about 14 attempts a game for quarterbacks, 6.25 carries for backs, 1.875 catches for receivers).</p>";
    view.innerHTML = html;
  }
  // a team's qualified players in Next Gen Stats, by position, shaded by percentile
  function teamNgs(code) {
    if (!NG) { loadNgs().then(function () { if (state.route === "team" && state.q.v === "ngs") render(); }); return '<p class="loading">Loading Next Gen Stats…</p>'; }
    var html = '<p class="lede">This season\'s NFL tracking numbers for this team\'s qualified players, shaded by percentile at the position: red is good, blue is bad. <a href="' + href("ngs", {}) + '">League leaderboards</a>.</p>';
    var any = false;
    [["qb", "Quarterbacks"], ["rb", "Running backs"], ["rec", "Receivers"]].forEach(function (pg) {
      var pool = pg[0], idx = {}; (NG.cols[pool] || []).forEach(function (k, i) { idx[k] = i; });
      var ids = Object.keys(NG[pool] || {}).filter(function (id) { var p = W.byId[id]; return (p ? p.t : NG[pool][id].t) === code; });
      if (!ids.length) return;
      any = true;
      var cols = NGCOLS[pool];
      html += tablePanel(pg[1], "<th>Player</th>" + (pool === "rec" ? "<th>Pos</th>" : "") + cols.map(function (c) { return "<th" + (c[3] ? ' title="' + esc(c[3]) + '"' : "") + ">" + c[0] + "</th>"; }).join(""),
        ids.map(function (id) {
          var d = NG[pool][id], p = W.byId[id], P2 = d.pct || {};
          return "<tr><td>" + (p ? pname(p, 22) : esc(d.n)) + "</td>" + (pool === "rec" ? "<td>" + esc(d.pos) + "</td>" : "") + cols.map(function (c) {
            var v = d.x[idx[c[1]]], pc = P2[c[1]];
            return pc == null ? "<td>" + ngFmt(v, c[2]) + "</td>" : '<td class="ngc" style="background:' + ngColor(pc) + ";color:" + ngInk(pc) + '" title="' + ngOrd(pc) + ' percentile">' + ngFmt(v, c[2]) + "</td>";
          }).join("") + "</tr>";
        }).join(""), "", "trkt");
    });
    return any ? html : html + '<p class="note">None of this team\'s players meet the NGS qualifying cutoffs yet.</p>';
  }
  function ngsCard(p) {
    var el = document.getElementById("ngsc");
    if (!el) return;
    var draw = function () {
      var pool = ngPool(P.group(p)), d = NG && NG[pool] && NG[pool][p.id];
      if (!d) { el.innerHTML = '<p class="note">No Next Gen Stats for him yet: NGS only lists players with enough volume (a qualified passer, rusher or receiver).</p>'; return; }
      var idx = {}; (NG.cols[pool] || []).forEach(function (k, i) { idx[k] = i; });
      var bars = NGCOLS[pool].filter(function (c) { return d.pct && d.pct[c[1]] != null; });
      var plain = NGCOLS[pool].filter(function (c) { return !(d.pct && d.pct[c[1]] != null) && !/^(att|yds|td|int|tgt|rec)$/.test(c[1]); });
      var PC = window.PCard;
      el.innerHTML = PC.sec("Next Gen Stats", "percentile among " + (pool === "rec" ? d.pos + "s" : pool === "qb" ? "QBs" : "RBs")) +
        PC.bars(bars.map(function (c) { return { label: c[0], sub: ngFmt(d.x[idx[c[1]]], c[2]), pct: d.pct[c[1]] }; })) +
        PC.facts(plain.map(function (c) { return [ngFmt(d.x[idx[c[1]]], c[2]), c[0]]; })) + '<p class="note"><a href="' + href("ngs", { g: P.group(p) }) + '">Full Next Gen leaderboards</a>. From NFL Next Gen Stats.</p>';
    };
    if (NG) draw(); else loadNgs().then(draw);
  }
  // this season's cap hit as the year-by-year table shows it
  function nowHit(p, c) { var r = c && c.rows && c.rows[W.season]; return r ? r[5] : C.capHit(p, W.season); }
  // The rating and its two parts
  // His next deal, for players whose contracts end within two seasons: the estimate and the deals behind it
  function nextDeal(p) {
    if (!p.c || P.rookieDeal(p) && C.lastYear(p) > W.season + 1) return "";
    var last = C.lastYear(p); if (!last || last > W.season + 1) return "";
    var y = last + 1, e = P.contract(W, p, y), tag = P.tagPrice(W, p, y);
    var html = '<h4 class="card-sec">Next contract (' + y + ')</h4><div class="ndeal"><div><b>' + e.yrs + " yr" + (e.yrs > 1 ? "s" : "") + ", " + m(e.total) + '</b><span class="note">' + m(e.apy) + " a year · " + m(e.gtd) + " guaranteed · franchise tag " + m(tag) + "</span></div></div>";
    html += '<div class="scroll"><table class="t"><thead><tr><th>Comparable deal</th><th>Signed</th><th>Age then</th><th>Rating now</th><th>Years</th><th>Total</th><th>Per year</th><th>Guaranteed</th></tr></thead><tbody>' +
      e.comps.map(function (c) { var q = W.byId[c.id]; return "<tr><td>" + (q ? pname(q, 20) : esc(c.n)) + ' <small class="note">' + esc(c.t) + "</small></td><td>" + c.signed + "</td><td>" + c.age + "</td><td>" + (q ? scoreChip(q) : "—") + "</td><td>" + c.yrs + "</td><td>" + m(c.apy * c.yrs) + "</td><td>" + m(c.apy) + "</td><td>" + m(c.gtd || 0) + "</td></tr>"; }).join("") + "</tbody></table></div>";
    return html + '<p class="note">Veterans at his position who signed in the last three years, nearest to him in rating, age at signing and role. The per-year figure leans on what they got (grown with the cap), then on his own value' + (P.rookieDeal(p) ? "" : " and his last deal") + "; years are capped by age (one at 33 or older, two at 31-32).</p>";
  }
  function ratingBlock(p) {
    var q = P.quality(W, p), r = W.rating && W.rating.p[p.id], g = P.group(p), def = /^(EDGE|IDL|LB|CB|S)$/.test(g);
    var w = P.MIX[g] == null ? 0.5 : P.MIX[g], s = st(p);
    var meter = function (label, z, weight, note) {
      var v = z == null ? null : zScore(z), raw = z == null ? null : 50 + 15 * z;
      var shown = v == null ? "—" : raw > 99.5 ? '<span title="Off the top of the scale: about ' + Math.round(raw) + '">99+</span>' : raw < 0.5 ? '<span title="Off the bottom of the scale: about ' + Math.round(raw) + '">&lt;1</span>' : v;
      return '<div class="rm"><div class="rm-h"><b>' + label + "</b>" + (weight != null ? '<span class="note">' + Math.round(weight * 100) + "% of the rating</span>" : "") + '<span class="rm-v">' + shown + "</span></div>" +
        '<div class="rm-t"><i class="mid"></i>' + (v == null ? "" : '<i class="fill ' + chipCls(v) + '" style="width:' + v + '%"></i>') + "</div>" + (note ? '<div class="note">' + note + "</div>" : "") + "</div>";
    };
    var onNote = r ? (def ? r[1] : r[0]).toFixed(1) + " EPA per 100 plays " + (def ? "saved" : "added") + " vs an average " + esc(g) + ", " + (def ? r[3] : r[2]) + " plays in 2024-25" + ((def ? r[3] : r[2]) < 500 ? " (small sample, pulled toward average)" : "")
      : "No snaps in 2024-25";
    var prNote = q.zpr == null ? (/^(OT|IOL)$/.test(g) ? "Linemen have no box-score stats" : "Not enough playing time this season") : keyStat(p) + (s ? " in " + s.games + " games" : "");
    var useOn = q.zon != null, usePr = q.zpr != null;
    var html = '<h4 class="card-sec">Player rating</h4><div class="rcard"><div class="rc-big">' + scoreChip(p) + '<span class="note">50 = average ' + esc(ONE[g] || g) + "</span></div>" +
      '<div class="rc-parts">' + meter("On-field plus-minus", q.zon, useOn && usePr ? w : useOn ? 1 : null, onNote) + meter("Production, 2024-26", q.zpr, useOn && usePr ? 1 - w : usePr ? 1 : null, prNote) + "</div></div>";
    // what's driving it, in a sentence
    var lead = useOn && usePr ? (Math.abs(q.zon - q.zpr) < 0.5 ? "Both halves agree" : (q.zpr > q.zon ? "His production is carrying it" : "His on-field impact is carrying it") + ", so watch " + (q.zpr > q.zon ? "whether it holds up" : "whether the box score catches up"))
      : useOn ? "All on-field: the box score doesn't see his position" : usePr ? "All production: too few snaps in 2024-25 for an on-field number" : "No data yet, so he's rated average";
    // the next few seasons with aging
    var ys = [W.season, W.season + 1, W.season + 2, W.season + 3], peak = P.PEAK[g], age = p.age || 26;
    html += '<p class="note rc-why">' + lead + ".</p>";
    html += '<div class="rproj"><span class="note">Ahead, aging included</span>' + ys.map(function (y) { return '<span><small>' + (y === W.season ? "Now" : y) + "</small>" + scoreChip(p, y) + "<small>age " + Math.floor(age + y - W.season) + "</small></span>"; }).join("") +
      '<span class="note">' + esc(ONE[g] ? ONE[g][0].toUpperCase() + ONE[g].slice(1) : g) + " peak: about " + peak + (age >= peak ? "; he's past it, so expect a slide" : age + 1 < peak ? "; still climbing" : "") + "</span></div>";
    return html;
  }
  // This season's line, by what the position does
  function statBlock(p) {
    var s = st(p), g = P.group(p);
    if (!s) return '<p class="note">' + (p.snaps ? "Plays " + Math.round(P.share(W, p) * 100) + "% of his unit's snaps (" + p.snaps[3] + " games). " : "") + "No box-score stats this season" + (/OT|IOL/.test(g) ? " (linemen don't get any)." : ".") + "</p>";
    var cells = [["Games", s.games]];
    var sg = function (v) { return (v >= 0 ? "+" : "") + v.toFixed(1); };
    if (g === "QB") cells = cells.concat([["Comp/Att", s.completions + "/" + s.attempts], ["Yards", s.passing_yards], ["TD", s.passing_tds], ["INT", s.passing_interceptions], ["Sacked", s.sacks_suffered], ["Rush yds", s.rushing_yards], ["EPA", sg(s.passing_epa + s.rushing_epa)]]);
    else if (g === "RB") cells = cells.concat([["Carries", s.carries], ["Rush yds", s.rushing_yards], ["Yds/car", s.carries ? (s.rushing_yards / s.carries).toFixed(1) : "—"], ["Rec", s.receptions], ["Rec yds", s.receiving_yards], ["TD", s.rushing_tds + s.receiving_tds], ["EPA vs avg", sg(epaOA(s))]]);
    else if (g === "WR" || g === "TE") cells = cells.concat([["Targets", s.targets], ["Rec", s.receptions], ["Yards", s.receiving_yards], ["Yds/rec", s.receptions ? (s.receiving_yards / s.receptions).toFixed(1) : "—"], ["TD", s.receiving_tds], ["EPA vs avg", sg(epaOA(s, "rec"))]]);
    else if (g === "K") cells = cells.concat([["FG", s.fg_made + "/" + s.fg_att], ["Long", s.fg_long]]);
    else if (g === "P") cells = cells.concat([["Punts", s.pt_att], ["Net yds", s.pt_net_yards]]);
    else cells = cells.concat([["Tackles", s.def_tackles_solo + s.def_tackle_assists], ["TFL", s.def_tackles_for_loss], ["Sacks", s.def_sacks], ["QB hits", s.def_qb_hits], ["INT", s.def_interceptions], ["PD", s.def_pass_defended], ["FF", s.def_fumbles_forced]]);
    return '<h4 class="card-sec">' + W.season + ' season</h4><div class="kv stats-kv">' + cells.map(function (c) { return "<div><b>" + c[1] + "</b><span>" + c[0] + "</span></div>"; }).join("") + "</div>";
  }
  // Game by game, loaded the first time a card opens
  function gameLog(p) {
    var el = document.getElementById("glog");
    if (!el) return;
    var draw = function () {
      var rows = WEEKS && WEEKS.p[p.id];
      if (!rows || !rows.length) { el.innerHTML = ""; return; }
      var ci = {}; WEEKS.cols.forEach(function (c, i) { ci[c] = i; });
      var g = P.group(p), cols;
      if (g === "QB") cols = [["C/A", function (r) { return r[ci.completions] + "/" + r[ci.attempts]; }], ["Yds", "passing_yards"], ["TD", "passing_tds"], ["INT", "passing_interceptions"], ["Rush", "rushing_yards"]];
      else if (g === "RB") cols = [["Car", "carries"], ["Yds", "rushing_yards"], ["TD", "rushing_tds"], ["Rec", "receptions"], ["Rec yds", "receiving_yards"]];
      else if (g === "WR" || g === "TE") cols = [["Tgt", "targets"], ["Rec", "receptions"], ["Yds", "receiving_yards"], ["TD", "receiving_tds"]];
      else if (g === "K") cols = [["FG", function (r) { return r[ci.fg_made] + "/" + r[ci.fg_att]; }]];
      else cols = [["Tkl", function (r) { return r[ci.def_tackles_solo] + r[ci.def_tackle_assists]; }], ["Sacks", "def_sacks"], ["Hits", "def_qb_hits"], ["INT", "def_interceptions"], ["PD", "def_pass_defended"]];
      var cell = function (r, c) { return typeof c[1] === "function" ? c[1](r) : r[ci[c[1]]]; };
      el.innerHTML = '<h4 class="card-sec">Game log</h4><div class="scroll"><table class="t"><thead><tr><th>Wk</th><th>Opp</th>' + cols.map(function (c) { return "<th>" + c[0] + "</th>"; }).join("") + "</tr></thead><tbody>" +
        rows.slice().sort(function (a, b) { return a[0] - b[0]; }).map(function (r) { return "<tr><td>" + r[0] + '</td><td class="tm">' + logo(r[1], 16) + '<span class="nm">' + esc(r[1]) + "</span></td>" + cols.map(function (c) { return "<td>" + cell(r, c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
    };
    if (WEEKS) draw();
    else fetch("data/weeks.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { WEEKS = j || { cols: [], p: {} }; draw(); }).catch(function () { el.innerHTML = ""; });
  }
  card.addEventListener("change", function (e) {
    var a = e.target.closest("[data-adj]");
    if (!a) return;
    var v = +a.value; if (v) W.adj[a.dataset.adj] = v; else delete W.adj[a.dataset.adj];
    save("adj", W.adj); P.resetCaches(W); openCard(a.dataset.adj); render();
  });
  card.addEventListener("click", function (e) {
    if (e.target === card || e.target.closest("[data-close]")) { card.close(); return; }
    var ch = e.target.closest("[data-choose]"), un = e.target.closest("[data-unchoose]");
    if (ch || un) {
      var code = state.arg || load("team", "NE");
      var ms = movesOf(code).filter(function (x) { return x.id !== (ch ? ch.dataset.choose.split("|")[1] : un.dataset.unchoose); });
      if (ch) { var a = ch.dataset.choose.split("|"), mv = { kind: a[0], id: a[1], year: +a[2] }; if (a[3]) { mv.apy = +a[3]; mv.years = estYears(mv.id, mv.kind, mv.year); } ms.push(mv); }
      card.close(); setMoves(code, ms);
    }
  });

  // ---------- method ----------
  function methodPage() {
    var sec = function (t, body) { return "<h3>" + t + "</h3>" + body; }, P_ = function (t) { return "<p>" + t + "</p>"; };
    view.innerHTML = '<div class="method"><h2 class="sec">How it works</h2>' +
      P_("Everything here comes from public data and one set of models that feed each other: a team strength rating for the standings, a player rating for every player, a value and a market price for every contract, and the cap rules to move them around. Each section below covers one piece.") +
      sec("Standings and playoff odds", P_("Each team gets a strength rating in points against an average team, fit to the betting market's point spread for every game that had one (the market already prices injuries and quarterback changes) and the actual scoring margins (counted about a third as much), pulled toward average so a few games can't make a juggernaut. Home field is worth 1.6 points. The rest of the season is played " + SIM.sims.toLocaleString() + " times, using the posted spread where there is one and the rating gap otherwise, with results landing about 13.5 points either side of the line; each run also nudges every team's rating a little, since nobody knows them exactly. Then the playoffs: four division winners and three wild cards per conference, a bye for the top seed. Ties break on division record for division titles and conference record for wild cards, then a coin flip, a simpler version of the NFL's tiebreakers. Each run also sets the next draft order.")) +
      sec("Power rankings", P_("This season: each team's strength rating. The next two seasons: this season's rating carries 45% of the way into next year and 25% into the year after (NFL teams regress hard), and the rest comes from each team's resources that year: the value of everyone under contract (aging included), its draft classes, and half the face value of its cap space, since free agents rarely return full value. Resources become points on the same scale that links this season's ratings to this season's rosters.")) +
      sec("The player rating", P_("Two parts, each measured against the average player at his position. <b>On the field:</b> football's version of basketball's RAPM. Every run and pass from the last two seasons (2025 fully, 2024 at half, garbage time left out) is explained by the 22 players on the field, using nflverse's participation data and each play's EPA (expected points added), so every player gets a number for how much better his side does with him out there, separated from his teammates and opponents. A ridge penalty pulls everyone toward average, hardest for players with few snaps. This season's participation file isn't published until the season ends, so this season comes in through the second part.") +
        P_("<b>Production:</b> the box score over the last three seasons (this one fully, last season at 70%, the one before at 40%, each against its own season's averages, so an injured star or a slow start doesn't erase a track record), per game: EPA per play for quarterbacks; yards, touchdowns and EPA against the average play for backs and receivers; sacks, hits and tackles for loss for pass rushers; tackles, plays on the ball and turnovers for linebackers and defensive backs. It's trusted more as the games add up.") +
        P_("The mix leans on production where the box score sees a player well (65% for quarterbacks, 75% for edge rushers, 70% for interior defensive linemen, whose plus-minus is noisy) and on the on-field number where it doesn't (all of it for offensive linemen). On the scale, 50 is the average player at the position and every 15 points is a standard deviation. Player rankings sort on it; tap any player for the breakdown, his season, game log and contract.")) +
      sec("The rating ahead", P_("This season's rating already reflects how a player plays at his current age, so only future seasons move. Players short of their position's peak (running backs about 26, corners 27, receivers, edge rushers and linebackers 28, tight ends and interior defenders 29, linemen 30, quarterbacks 32) gain a little each year until they reach it. Each year past the peak takes a share off, compounding (12% a year at running back, 9% at corner, 3% at quarterback), and from four years past the peak the fall speeds up to twice that plus 4 points a year. Young first-round quarterbacks also get upside: their rating moves toward what their draft slot usually becomes (about 72 for a top-5 pick, 66 for picks 6-15, 60 for a late first), half the gap in a year, fading as they age out of it by 28. Player cards show the next three seasons.")) +
      sec('<span id="value">Value</span>', P_("What a player's play is worth in a season: his position's starter price (the average contract of the starting tier league-wide), times how much he plays, times a quality multiplier from the rating (0.3 for well below average up to 2.3), blended 70/30 with the market's own verdict, his contract average grown with the cap. Rookie deals say nothing about quality, so rookies get only the first part. Future seasons use the rating ahead.") + P_("How much he plays: this season's real snap share for this season, so missed games count, and his healthy role for every season after, so a star who's hurt this year (Micah Parsons, Myles Garrett) isn't priced as a backup for the rest of his contract.") + P_("<b>Contracts:</b> the Contracts tab adds this up over the rest of every deal (this season's share still to play, then each full season, up to five) against his cap hits. Surplus is value minus cap hits; trade value is the price in draft picks from the trade model below.")) +
      sec("Next contracts", P_("Every estimate comes from comparable deals: the six veterans at his position who signed in the last three years (no rookie deals) nearest to him in rating, age at signing and role, with starters compared only with starters. The per-year figure is 70% what they got (grown with the cap) and 30% his own value that season; for a veteran, his last deal takes 15% of it. Years are the comparable deals' middle length, capped by age (one year at 33 or older, two at 31-32, three at 30), and the guarantee is their guaranteed share of the total. Hover an estimate, or open the player's card, to see the deals behind it.")) +
      sec("Free agents and the franchise tag", P_("Everyone whose deal runs out before a season, ranked by value, with his next contract and the teams it fits (his position among their top three needs and cap space for his price). Turn on likely cap casualties to add the players expected to be cut. The tag is the NFL's 2026 non-exclusive franchise tag at his tag position (all offensive linemen share one; edge rushers listed as linebackers get the linebacker tag), grown with the cap, or 120% of his last cap hit if that's more. Only real candidates are flagged: a starter rated 60 or better for next season, 30 or younger, whose market is at least 65% of the tag, at most two per team, marked a fair price (90% or more of the tag) or pricey. Most teams have none.")) +
      sec("Team needs", P_("For next season, each position group's starters under contract that year (healthy role decides who starts, the rating ahead decides how good), with empty starting spots counted at replacement level. Grades are where that lands among the 32 teams: A is the top fifth, F the bottom fifth, so a fifth of the league gets an F at every position by design. Needs are the weakest groups weighted by how much the position matters (quarterback 1.6, tackle and edge 1.2, receiver and corner 1.1, down to running back 0.6), with the reason: starters who can leave in free agency, open spots, a weak starter, an aging one. The Big Board's hand-kept draft needs are shown alongside.")) +
      sec("Draft picks", P_("Who owns each pick comes from the Big Board (Tankathon's order plus its list of future picks already traded). Where a pick lands is the season sim's expected spot for next year's draft (teams that miss the playoffs pick worst record first, then playoff teams by the round they went out in) and the next year's projected power ranking for the one after. Rookie contracts follow the slot: this year's class's deals by pick, grown with the cap. Each rookie counts his cap hit less the minimum salary of the player he pushes off the top 51, as Over The Cap's effective cap space does. Each team's Draft tab shows every pick with its likely range.")) +
      sec("Trade value", P_("<b>Picks</b> are points on a modern trade chart: No. 1 is 1,000, No. 10 about 470, No. 32 about 210, No. 64 about 90, No. 100 about 40, and a pick a year out counts 85% of its expected spot. Each team's picks are worth their own expected spot, so not every second-rounder is equal.") +
        P_("<b>Players</b> are priced in the same points: what he's worth on the field over the next three seasons above a replacement-level player at his position, squared so stars cost far more than average starters, at his healthy role with the rating ahead. Seasons after his deal ends count 60% (less for older players), since the new team only gets first crack at re-signing him. Then his contract: what the new team pays is his cap number less his signing-bonus money, which stays behind as the old team's dead money; being underpaid against his market adds 60% of the gap, being overpaid takes away 35%, and a cheap deal never adds more than half again his on-field worth.") +
        P_("<b>Quarterbacks</b> carry a premium that grows with quality (none for an average starter, about 1.7 times for an MVP-level one): if the No. 1 overall pick cost two firsts, two seconds and a starting receiver in 2023, a proven MVP costs more. Young first-round quarterbacks never price below part of the pick they were (85% of the slot's value in their first season, fading to 30% by year five, cut further the more their play has fallen short). <b>Non-quarterbacks</b> top out near two firsts and a second, because no modern non-quarterback has gone for more than two firsts plus extras (Khalil Mack, Jalen Ramsey, Jamal Adams, Laremy Tunsil, Micah Parsons, Jeffery Simmons), with Myles Garrett's Jared Verse-plus-picks package the high-water mark.") +
        P_("<b>Calibration:</b> 2026's trades. Jeffery Simmons went to the Bears for two late firsts and a fourth, Myles Garrett to the Rams for Jared Verse, a first, a second and a third, and the Colts reportedly asked a second for Jonathan Taylor. Prices are said in firsts and seconds: a contender's late first (around No. 28) and second (around No. 56) for deals up to two firsts, growing toward average firsts and seconds for the biggest quarterback deals, which sellers fill with better picks.") +
        P_("<b>Timing:</b> before this season's trade deadline he's priced on the rest of this season (by weeks left) plus two more, and the old team's later bonus money all lands this year. In the offseason it's the next three seasons, with the old team's dead money all at once before June 1 or split over two years after. <b>The deal</b> is built from both teams' picks over the next two drafts: up to five from the buyer and up to two coming back, whichever lands closest with the fewest picks; tap picks to build your own. A player whose contract outweighs his play is a burden, and the deal flips: his team attaches picks to move him. The money table shows each side's cap change and space after, and flags when the buyer can't fit him. Hardest contracts to move lists the players whose value comes out below zero, with what a new team would take on and what it would take to move them.")) +
      sec("The offseason planner and suggestions", P_("Stack moves for a team and see its cap five years out. Suggestions: <b>cut</b> when it saves at least 45% of his cap number and he's paid well past his value at his healthy role; <b>trade</b> when trading saves at least $3M more than a release (his guarantees leave with him); <b>restructure</b> for at least $5M of room on a starter with two or more years left; <b>extend</b> a starter 29 or younger in the last year of his deal, at the length and price comparable deals point to; <b>re-sign or let walk</b> for starters whose deals end; and the franchise tag for real candidates only.")) +
      sec("Play GM", P_("Each team page's Play GM tab runs its next offseason in order. Your planner moves come first. Then, each with a switch: the model's likely cuts, franchise tags on real candidates, and re-signing its own free agents who are starters worth at least 85% of their market (31 or younger, with room to fit them). Then free agency, one signing at a time: whoever lifts a top-four need the most per dollar, priced as the starter he'd be, from a market of every free agent his own team wouldn't keep plus other teams' likely cuts. With rival bids on, the three keenest other teams (his position among their top needs, room for him) bid too: each raises his price 8%, and he picks a team with odds that favor contenders and the teams that need him most; your offer at the going price counts more than any one rival's, and Outbid them adds 12% to the price and half again to your odds. Results are fixed per player, so the same choices give the same offseason. Last, a mock draft at expected spots, where every team takes the best player on the Big Board's consensus within a few spots who fits a need it hasn't filled; rookies are rated by pick. The end shows next season's cap space, position grades and power ranking before and after.")) +
      sec("Likely cap casualties", P_("Every cut idea league-wide (a cut that saves at least 45% of his cap number on a player paid well past his value at his healthy role), with odds from how much the cut saves, how far he's overpaid, whether his team is tight on room, and age. Core special teamers are left out, since the model doesn't value special teams play.")) +
      sec("The cap rules", P_("<b>Cut</b> before June 1: every remaining year of bonus proration and every remaining guarantee counts that year. After June 1, or with a post-June 1 designation: that year keeps only its own proration and guarantee, and the rest moves to the next year. <b>Trade:</b> the old team keeps the bonus proration on the same June 1 split; the guarantees and salary go with the player. <b>Restructure:</b> base salary above the minimum becomes a signing bonus spread over the years left (up to five; with void years, always five). <b>Extension and re-signing:</b> new years at the estimated market price, with a signing bonus spread over up to five years and this year's base above the minimum folded in.")) +
      sec("Cap space ahead", P_("2026 and 2027 use Over The Cap's team cap, contracts and dead money, so the starting point matches theirs. 2028 on use a projected base cap (" + m(C.BASE[2028], 0) + " in 2028, up 7% a year) and only contracts signed today plus the draft classes: no carryover and no new signings, so later years look roomier than they will be.")) +
      (W.fresh ? sec("Data feeds", '<table class="t tfeed"><thead><tr><th>Feed</th><th>Last updated</th><th>Refreshed</th></tr></thead><tbody>' + W.fresh.map(function (f) { var d = f.when ? Math.round((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(String(f.when).slice(0, 10))) / 864e5) : null; return "<tr" + (f.stale ? ' class="stale"' : "") + "><td>" + esc(f.label) + "</td><td>" + (f.when ? esc(String(f.when).slice(0, 10)) + ' <span class="note">(' + (d <= 0 ? "today" : d === 1 ? "yesterday" : d + " days ago") + ")</span>" : "Didn\'t load") + (f.stale ? " <b>behind</b>" : "") + "</td><td>" + (f.how === "otc" ? "From Over The Cap every week or two" : f.label === "Player rating" ? "Every Monday" : "Daily, automatic") + "</td></tr>"; }).join("") + "</tbody></table>" + P_("A check runs every afternoon and flags any automatic feed that\'s gone quiet (game feeds are exempt from February to August).")) : "") +
      sec("The data", P_("Rosters, contracts, depth charts, snap counts and stats come from <a href=\"https://github.com/nflverse/nflverse-data\">nflverse</a>'s public data, refreshed every morning: Over The Cap's contract data (each year's base salary, bonus proration, roster bonuses, guarantees and cap number), the NFL's weekly rosters, ESPN's depth charts, Pro Football Reference's snap counts and three seasons of box scores. The play-by-play rating is rebuilt every Monday. Team cap figures with carryover and dead money for 2026 and 2027 are Over The Cap's (as of " + esc((W.teamcap || {}).asOf || "") + "). Deals signed this year that don't have a year-by-year breakdown yet are estimated and marked on the cap sheet. Draft order, prospects and future picks come from the <a href=\"../draft/\">Big Board</a>.")) +
      "</div>";
  }


  // ---------- sortable tables: tap a column header to sort by it, tap again to flip ----------
  function cellVal(td) {
    if (!td) return null;
    if (td.dataset.v != null) return +td.dataset.v;
    var t = td.textContent.trim();
    if (!t || t === "—" || t === "–") return null;
    var neg = /^-|^−|^▼/.test(t), mt = t.replace(/[,$%+▲▼−]/g, "").replace(/^-/, "").match(/^\d+(\.\d+)?/);
    return mt ? (neg ? -1 : 1) * parseFloat(mt[0]) : t.toLowerCase();
  }
  document.addEventListener("click", function (e) {
    var th = e.target.closest("table.t thead th");
    if (!th || th.closest("table.choose") || e.target.closest("button,a,select")) return;
    var table = th.closest("table"), tb = table.tBodies[0], col = Array.prototype.indexOf.call(th.parentNode.children, th);
    if (!tb || th.textContent.trim() === "#") return;
    var rows = Array.prototype.filter.call(tb.rows, function (r) { return !r.classList.contains("tot") && r.cells.length > col; });
    if (rows.length < 2) return;
    var vals = rows.map(function (r) { return cellVal(r.cells[col]); });
    var numeric = vals.filter(function (v) { return typeof v === "number"; }).length >= vals.filter(function (v) { return v != null; }).length / 2;
    var dir = th.getAttribute("aria-sort") === (numeric ? "descending" : "ascending") ? (numeric ? "ascending" : "descending") : (numeric ? "descending" : "ascending");
    var sign = dir === "ascending" ? 1 : -1;
    var idx = rows.map(function (r, i) { return i; }).sort(function (a, b) {
      var x = vals[a], y = vals[b];
      if (x == null || (numeric && typeof x !== "number")) return 1;
      if (y == null || (numeric && typeof y !== "number")) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sign || a - b;
    });
    var tail = Array.prototype.filter.call(tb.rows, function (r) { return rows.indexOf(r) < 0; });
    idx.forEach(function (i) { tb.appendChild(rows[i]); });
    tail.forEach(function (r) { tb.appendChild(r); });
    Array.prototype.forEach.call(th.parentNode.children, function (h) { h.removeAttribute("aria-sort"); });
    th.setAttribute("aria-sort", dir);
    var hash = th.parentNode.children[0];
    if (hash && hash.textContent.trim() === "#") idx.forEach(function (i, k) { rows[i].cells[0].textContent = k + 1; });
  });

  // ---------- start ----------
  function get(u, opt) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }).catch(function (e) { if (opt) return null; throw e; }); }
  Promise.all([get("data/league.json"), get("data/teamcap.json", true), get("../tools/draft_teams.json"), get("../draft/nfl.json", true), get("data/rating.json", true)]).then(function (r) {
    TEAMS = r[2].nfl;
    W = P.init(C.newWorld(r[0], r[1], r[4]));
    // data freshness: a banner when a feed has gone quiet, and the list under How it works
    if (window.Fresh) {
      var inSeason = (function () { var mo = new Date().getMonth() + 1; return mo >= 9 || mo === 1; })();
      W.fresh = Fresh.check({ "nfl/data/league.json": r[0], "nfl/data/teamcap.json": r[1], "draft/nfl.json": r[3], "nfl/data/rating.json": r[4] }, Date.now(), Fresh.NFL).map(function (f) { f.stale = f.stale && (inSeason || f.manual); return f; });
      var stale = W.fresh.filter(function (f) { return f.stale; }), fb = $("#fresh");
      if (stale.length && fb) { fb.hidden = false; fb.innerHTML = "<b>Some data is behind.</b> " + stale.map(function (f) { return esc(f.label) + (f.when ? " last updated " + esc(String(f.when).slice(0, 10)) : " didn't load"); }).join("; ") + '. Numbers that lean on it may be off. <a href="#/method">See the data feeds</a>'; }
    }
    W.adj = {}; var adj0 = load("adj", {}) || {}; Object.keys(adj0).forEach(function (id) { if (W.byId[id]) W.adj[id] = +adj0[id]; });
    W.draft = r[3] && r[3].order ? r[3].order : null;
    W.future = r[3] && r[3].future ? r[3].future : null;
    W.bbNeeds = r[3] && r[3].needs ? r[3].needs : null;
    W.board = r[3] && r[3].players ? r[3].players : [];
    W.games = r[0].games || []; W.stats = r[0].stats || null; W.week = r[0].week || 10;
    SIM = S.simulate(W.games, Object.keys(S.divOf), { sims: 6000 });
    W.sim = SIM;
    $("#foot").innerHTML = "Rosters and contracts as of " + esc(r[0].updated) + " (week " + r[0].week + "). Data from nflverse: Over The Cap contracts, NFL rosters, ESPN depth charts, Pro Football Reference snap counts." + ' <a href="#/method">How it works</a>.';
    render();
    setTimeout(warmTrade, 1200);
  }).catch(function (e) { view.innerHTML = '<p class="loading">Couldn\'t load the league: ' + esc(e.message) + "</p>"; });
})();
