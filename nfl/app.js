/* NFL Hub: screens. The cap math lives in lib/cap.js, the rough value and suggestions in lib/plan.js; the data in
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
    var alt = p.espn ? "https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/" + p.espn + ".png&w=" + px + "&h=" + Math.round(px * 0.73) : "";
    var img = '<img class="ds-face-img" src="https://static.www.nfl.com/image/upload/c_thumb,g_face,w_' + px + ",h_" + px + ",f_auto,q_auto/league/" + esc(p.hs) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="' +
      (alt ? "if(!this.dataset.alt){this.dataset.alt=1;this.parentNode.classList.add('espn');this.src='" + alt + "';return;}" : "") + "this.parentNode&&this.parentNode.classList.remove('has-face');this.remove()\">";
    var ini = esc(String(p.n).split(" ").filter(function (w) { return !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(w); }).map(function (w, i, a) { return i === 0 || i === a.length - 1 ? w[0] : ""; }).join("").toUpperCase());
    return base.replace('class="ds-face', 'class="ds-face has-face').replace(/<span class="ds-face-ini">[^<]*<\/span>/, '<span class="ds-face-ini">' + ini + "</span>" + img);
  }
  function lastName(n) { var w = String(n).split(" ").filter(function (x) { return !/^(Jr\.?|Sr\.?|II|III|IV|V)$/.test(x); }); return w.length ? w[w.length - 1] : n; }
  function posOf(p) { return p.dpos && p.dpos !== "NA" ? p.dpos : p.pos; }
  function pname(p, size, extra) { return '<span class="pl" data-p="' + esc(p.id) + '">' + face(p, size || 22) + '<span class="nm">' + esc(p.n) + "</span>" + (extra || "") + "</span>"; }
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
  function moveTitle(mv) { return (KIND[mv.kind] || mv.kind) + (mv.kind === "extend" || mv.kind === "resign" ? ", 3 yrs at " + m(mv.apy) : mv.kind === "tag" ? " at " + m(mv.amount) : ""); }
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
    state.route = parts[0] || "league"; state.arg = parts[1] ? parts[1].toUpperCase() : null; state.q = q;
  }
  function render() {
    parse();
    document.querySelectorAll(".tabs a").forEach(function (a) {
      var on = a.dataset.tab === state.route || (a.dataset.tab === "teams" && state.route === "team") || (a.dataset.tab === "cap" && state.route === "league");
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    ({ standings: standingsPage, teams: teamsPage, team: teamPage, players: playersPage, cap: leaguePage, league: leaguePage, method: methodPage }[state.route] || standingsPage)();
  }
  window.addEventListener("hashchange", render);

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
    if (R) rows = list.map(function (p) { var s = st(p); return s && R.min(s) ? { p: p, s: s, score: R.score(s) } : null; }).filter(Boolean).sort(function (a, b) { return b.score - a.score; });
    else rows = list.map(function (p) { return { p: p, s: st(p), score: P.share(W, p) }; }).filter(function (x) { return x.score > 0.2; }).sort(function (a, b) { return b.score - a.score; });
    var html = '<h2 class="sec">Player rankings</h2><p class="lede">This season\'s production by position, from the box score. EPA is expected points added: how much each play moved the team\'s chances of scoring. The average run loses a little (' + baselines().rush.toFixed(2) + " per carry) and the average target gains some (+" + baselines().rec.toFixed(2) + "), so backs and receivers are measured against those averages: \"EPA vs avg\" is how many points better than an average player he's been on his touches." + ' Linemen have no box-score stats, so they rank by snap share here; the play-by-play rating coming next will grade them properly. Tap a player for his stats, game log and contract.</p>';
    html += '<div class="controls"><label>Position<select data-q="g">' + Object.keys(GROUP_NAME).map(function (k) { return '<option value="' + k + '"' + (k === g ? " selected" : "") + ">" + GROUP_NAME[k] + "</option>"; }).join("") + '</select></label><label>Team<select data-q="t"><option value="">All teams</option>' + codes().map(function (c) { return '<option value="' + c + '"' + (c === tm ? " selected" : "") + ">" + esc(team(c).name) + "</option>"; }).join("") + "</select></label></div>";
    var cols = R ? R.cols : [["Snap share", "_share"]];
    html += tablePanel(GROUP_NAME[g] + " · " + rows.length, "<th>#</th><th>Player</th><th>Team</th><th>Age</th><th>G</th>" + cols.map(function (c) { return "<th>" + c[0] + "</th>"; }).join("") + "<th>2026 cap</th><th>Rough value</th>",
      rows.slice(0, 100).map(function (x, i) {
        var p = x.p, s = x.s || {};
        return "<tr><td>" + (i + 1) + "</td><td>" + pname(p, 24) + '</td><td class="tm">' + logo(p.t, 18) + '<span class="nm">' + esc(p.t) + "</span></td><td>" + (p.age ? Math.floor(p.age) : "—") + "</td><td>" + (s.games || (p.snaps ? p.snaps[3] : "—")) + "</td>" +
          cols.map(function (c) { if (c[1] === "_share") return "<td>" + Math.round(P.share(W, p) * 100) + "%</td>"; var v = statVal(s, c[1]); return "<td>" + (v == null ? "—" : Math.abs(v % 1) > 0.001 ? v.toFixed(1) : v) + "</td>"; }).join("") +
          "<td>" + m(C.capHit(p, 2026)) + "</td><td>" + m(P.value(W, p, 2026)) + "</td></tr>";
      }).join(""), R ? "ranked on a production score from these columns" : "ranked by snap share", "rank");
    view.innerHTML = html;
  }
  view.addEventListener("change", function (e) {
    var c = e.target.closest("[data-q]");
    if (!c) return;
    var q = Object.assign({}, state.q); q[c.dataset.q] = c.value || null;
    location.hash = href(state.route + (state.arg ? "/" + state.arg : ""), q);
  });

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
    return html;
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
          return '<span class="uc' + (starter ? " st" : "") + '"' + (p ? ' data-p="' + esc(p.id) + '"' : "") + ">" + (p ? face(p, starter ? 30 : 22) : "") + '<span><b>' + esc(starter ? r[4] : lastName(r[4])) + "</b>" + (starter && p ? "<small>" + esc(keyStat(p)) + "</small>" : "") + "</span></span>";
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
    html += '<div class="subtabs">' + [["overview", "Overview"], ["depth", "Depth chart"], ["plan", "Offseason planner"], ["sheet", "Cap sheet"]].map(function (x) { return '<a href="' + href("team/" + code, Object.assign({}, state.q, { v: x[0] })) + '"' + (v === x[0] ? ' aria-current="page"' : "") + ">" + x[1] + "</a>"; }).join("") + "</div>";
    if (v === "sheet") html += capSheet(code, ms);
    else if (v === "depth") html += depthChart(code);
    else if (v === "plan") html += planner(code, y, ms, base, plan);
    else html += overview(code);
    view.innerHTML = html;
  }
  view.addEventListener("change", function (e) {
    var s = e.target.closest("select[data-goteam]");
    if (s) { location.hash = href("team/" + s.value, { v: state.q.v, y: state.q.y }); return; }
    var a = e.target.closest("select[data-act]");
    if (a && a.value) {
      var code = state.arg || load("team", "NE"), ms = movesOf(code).filter(function (x) { return x.id !== a.dataset.act; });
      var y = +state.q.y || 2027, mv = { kind: a.value, id: a.dataset.act, year: y };
      if (a.value === "extend") { var p = W.byId[a.dataset.act]; mv.apy = P.extensionApy(W, p, y + 1); mv.years = 3; }
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
      if (a[3]) mv.apy = +a[3]; if (a[4]) mv.amount = +a[4]; if (mv.kind === "extend" || mv.kind === "resign") mv.years = 3;
      var ms = movesOf(code).filter(function (x) { return x.id !== mv.id; }); ms.push(mv); setMoves(code, ms); return;
    }
    if (rm) { setMoves(code, movesOf(code).filter(function (x) { return x.id !== rm.dataset.rmmove; })); return; }
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
      '<tr class="tot"><td>Space today</td>' + base.map(function (r) { return '<td class="' + (r.space >= 0 ? "pos" : "neg") + '">' + m(r.space) + "</td>"; }).join("") + "</tr>" +
      (ms.length ? "<tr><td>Your moves</td>" + plan.map(function (r) { return '<td class="' + (r.moves <= 0 ? "pos" : "neg") + '">' + (Math.abs(r.moves) > 0.05 ? sm(-r.moves) : "—") + "</td>"; }).join("") + "</tr>" +
        '<tr class="tot"><td>With your plan</td>' + plan.map(function (r) { return '<td class="' + (r.space >= 0 ? "pos" : "neg") + '"><b>' + m(r.space) + "</b></td>"; }).join("") + "</tr>" : "") +
      '</tbody></table></div><p class="note">2026 and 2027 start from Over The Cap\'s team figures (carryover included). Later years count only today\'s contracts against a projected cap, so they look roomier than they will be.</p></div>';
    // suggestions as cards: the money first
    var groups = [["cut", "Cut", "Saves real money with little dead money"], ["trade", "Trade", "Saves more traded than cut: his guarantees leave with him"],
      ["restructure", "Restructure", "Room now on a player the team keeps, paid back later"], ["extend", "Extend", "Starters in the last year of their deals"],
      ["expiring", "Re-sign or tag", "Starters whose deals end after " + (y - 1)]];
    html += '<h3 class="subsec">Ideas for ' + y + '</h3><p class="note">The cap numbers are exact. Who\'s worth keeping uses the rough value, so treat these as starting points.</p><div class="sugs">';
    groups.forEach(function (g) {
      var list = sug.filter(function (s) { return s.kind === g[0]; }).slice(0, 4);
      if (!list.length) return;
      html += '<div class="panel"><h3>' + g[1] + " <small>" + g[2] + "</small></h3>" + list.map(function (s) {
        var num = s.kind === "expiring" ? m(s.apy) + "/yr" : s.kind === "extend" ? (s.now > 0.05 ? sm(s.now) : m(s.apy) + "/yr") : sm(s.save);
        var btns = on[s.p.id] ? '<span class="pill up">' + esc(KIND[on[s.p.id].kind]) + "</span>" : s.kind === "expiring"
          ? '<button type="button" class="btn sm" data-addmove="' + esc("resign|" + s.p.id + "|" + y + "|" + s.apy.toFixed(2)) + '">Re-sign</button><button type="button" class="btn sm" data-addmove="' + esc("tag|" + s.p.id + "|" + y + "||" + s.tag.toFixed(2)) + '">Tag</button>'
          : '<button type="button" class="btn sm" data-addmove="' + esc(s.kind === "extend" ? "extend|" + s.p.id + "|" + y + "|" + s.apy.toFixed(2) : s.kind + "|" + s.p.id + "|" + y) + '">Add</button><button type="button" class="btn sm ghost" data-opts="' + esc(s.p.id) + '">Options</button>';
        return '<div class="scard"><div class="sc-top">' + pname(s.p, 34) + '<span class="note">' + esc(posOf(s.p)) + " · " + (s.p.age ? Math.floor(s.p.age) : "—") + (s.cap ? " · " + m(s.cap) + " cap hit" : "") + '</span><b class="big ' + (s.kind === "expiring" ? "" : "pos") + '">' + num + '</b></div><p>' + esc(s.why) + '</p><div class="sc-btns">' + btns + "</div></div>";
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
    var apy = P.extensionApy(W, p, y + 1);
    var opts = [["cut", "Cut him before June 1", "Every remaining bonus dollar and guarantee hits now"], ["cutJune", "Cut him after June 1", "Splits the dead money over two years (two of these a year)"],
      ["trade", "Trade him", "Bonus money stays behind; salary and guarantees go"], ["tradeJune", "Trade him after June 1", "Same, with the bonus money split over two years"],
      ["restructure", "Restructure", "Turn base salary into a bonus spread over his remaining years"], ["restructureV", "Restructure with void years", "Spread it over five years, adding fake years at the end"],
      ["extend", "Extend 3 years at " + m(apy) + "/yr", "Market estimate; this year's base folded into a signing bonus"]];
    var html = '<div class="card-h">' + face(p, 56) + "<div><h3>" + esc(p.n) + '</h3><div class="meta">' + esc(posOf(p)) + " · " + m(C.capHit(p, y)) + " cap hit in " + y + " · rough value " + m(P.value(W, p, y)) + '</div></div></div><div class="card-b"><table class="t choose"><thead><tr><th>Move</th><th>' + y + "</th><th>Dead money</th><th>Later years</th><th></th></tr></thead><tbody>";
    opts.forEach(function (o) {
      var mv = { kind: o[0], id: id, year: y }; if (o[0] === "extend") { mv.apy = apy; mv.years = 3; }
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
  function openCard(id) {
    var p = W.byId[id];
    if (!p) return;
    var t = team(p.t), c = p.c || {}, ys = Object.keys(c.rows || {}).map(Number).sort();
    var html = '<div class="card-h">' + face(p, 72) + "<div><h3>" + esc(p.n) + '</h3><div class="meta">' + logo(p.t, 18) + " " + esc(t.name) + " · " + esc(posOf(p)) + " · age " + (p.age ? Math.floor(p.age) : "—") + " · " + p.exp + " yrs exp" + (p.draft ? " · " + p.draft[0] + " pick " + p.draft[1] : "") + "</div></div></div>";
    html += '<div class="card-b"><div class="kv">' + "<div><b>" + (c.yrs ? c.yrs + " yr, " + m(c.value) : "—") + "</b><span>Contract (" + (c.signed || "—") + ")</span></div><div><b>" + m(c.apy) + "</b><span>Per year</span></div><div><b>" + m(c.gtd) + "</b><span>Guaranteed</span></div>" +
      "<div><b>" + (p.snaps ? Math.round(P.share(W, p) * 100) + "%" : "—") + "</b><span>Snap share (" + (p.snaps ? p.snaps[3] + " g" : "none yet") + ")</span></div><div><b>" + m(P.value(W, p, W.season)) + "</b><span>Rough value / yr</span></div></div>";
    html += statBlock(p) + '<div id="glog"></div>';
    if (ys.length) {
      html += '<h4 class="card-sec">Contract year by year</h4><div class="scroll"><table class="t"><thead><tr><th>Year</th><th title="Base salary">Base</th><th title="Signing and option bonus money counted this year">Bonus</th><th title="Roster, workout and other bonuses">Other</th><th title="Guaranteed salary">Gtd</th><th>Cap hit</th><th title="Dead money if cut before June 1">Dead</th><th title="Cap saved by cutting him before June 1">Saves</th><th title="Cap saved with a post-June 1 cut">June 1</th></tr></thead><tbody>' + ys.map(function (y) {
        var r = c.rows[y], cut = !r[C.R.void] ? C.effect(p, { kind: "cut", year: y }) : null, june = !r[C.R.void] ? C.effect(p, { kind: "cutJune", year: y }) : null;
        return "<tr" + (r[C.R.void] ? ' class="muted-row"' : "") + "><td>" + y + (r[C.R.void] ? " (void)" : r[C.R.est] ? " (est.)" : "") + "</td><td>" + m(r[0]) + "</td><td>" + m(r[1]) + "</td><td>" + m(r[2] + r[3]) + "</td><td>" + (r[4] ? m(r[4]) : "—") + "</td><td><b>" + m(r[5]) + "</b></td><td>" + (cut ? m(cut.dead[y] || 0) : "") + '</td><td class="' + (cut && -(cut.delta[y] || 0) >= 0 ? "pos" : "neg") + '">' + (cut ? sm(-(cut.delta[y] || 0)) : "") + "</td><td>" + (june ? sm(-(june.delta[y] || 0)) : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
      html += '<p class="note">Bonus: signing and option bonus money spread over the deal. Dead and Saves: if he\'s cut before June 1. June 1: savings with a post-June 1 cut. Cutting before June 1 puts every remaining bonus dollar and guarantee on that year; after June 1 (or with one of the two post-June 1 designations) the later years\' share moves to the next year. Contract data from Over The Cap via nflverse.</p>';
    } else html += '<p class="note">No contract in the feed.</p>';
    html += '<p><a class="btn" href="' + href("team/" + p.t, { v: "plan" }) + '">' + esc(t.name) + " planner</a>" + (c.otc ? ' <a class="btn" href="https://overthecap.com/player/x/' + esc(c.otc) + '/" target="_blank" rel="noopener">Over The Cap page</a>' : "") + "</p></div>";
    cardBody.innerHTML = html;
    if (!card.open) card.showModal();
    gameLog(p);
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
  card.addEventListener("click", function (e) {
    if (e.target === card || e.target.closest("[data-close]")) { card.close(); return; }
    var ch = e.target.closest("[data-choose]"), un = e.target.closest("[data-unchoose]");
    if (ch || un) {
      var code = state.arg || load("team", "NE");
      var ms = movesOf(code).filter(function (x) { return x.id !== (ch ? ch.dataset.choose.split("|")[1] : un.dataset.unchoose); });
      if (ch) { var a = ch.dataset.choose.split("|"), mv = { kind: a[0], id: a[1], year: +a[2] }; if (a[3]) { mv.apy = +a[3]; mv.years = 3; } ms.push(mv); }
      card.close(); setMoves(code, ms);
    }
  });

  // ---------- method ----------
  function methodPage() {
    view.innerHTML = '<div class="method"><h2 class="sec">How it works</h2>' +
      "<h3>Standings and odds</h3><p>Each team gets a strength rating in points against an average team, fit to two things from this season: the betting market's point spread for every game that had one (the market already prices injuries and quarterback changes) and the actual scoring margins (counted about a third as much), pulled toward average so a few games can't make a juggernaut. Home field is worth 1.6 points. The rest of the season is played " + SIM.sims.toLocaleString() + " times, using the posted spread where there is one and the rating gap otherwise, with real results landing about 13.5 points either side of the line; each run also nudges every team's rating a little, since nobody knows them exactly. Then the playoffs: four division winners and three wild cards per conference, a bye for the top seed. Ties break on division record for division titles and conference record for wild cards, then a coin flip, a simpler version of the NFL's tiebreakers.</p>" +
      "<h3>Player rankings</h3><p>This season's box score from nflverse, ranked by position on a production score: total EPA (expected points added) for quarterbacks; yards, touchdowns and EPA for running backs and receivers; sacks, quarterback hits and tackles for loss for pass rushers; tackles, plays on the ball and turnovers for linebackers and defensive backs. Linemen don't have box-score stats, so they're listed by snap share until the play-by-play rating arrives. Tap any player for his season, game log and contract.</p>" +
      "<h3>The data</h3><p>Rosters, contracts, depth charts and snap counts come from <a href=\"https://github.com/nflverse/nflverse-data\">nflverse</a>'s public data, refreshed every morning: Over The Cap's contract data (each year's base salary, bonus proration, roster bonuses, guarantees and cap number), the NFL's weekly rosters, ESPN's depth charts and Pro Football Reference's snap counts. Team cap figures with carryover and dead money for 2026 and 2027 are Over The Cap's (as of " + esc((W.teamcap || {}).asOf || "") + "). Deals signed this year that don't have a year-by-year breakdown yet are estimated (marked on the cap sheet).</p>" +
      "<h3>The cap rules</h3><p>Cut before June 1: every remaining year of bonus proration and every remaining guarantee counts that year. After June 1, or with a post-June 1 designation: that year keeps only its own proration and guarantee, the rest moves to the next year. Trade: the old team keeps the bonus proration on the same June 1 split, and the guarantees and salary go with the player. Restructure: base salary above the minimum becomes a signing bonus spread over the years left (up to five; with void years, always five). Extension: three new years at the market average, a signing bonus of 35% of the new money spread over up to five years, with this year's base above the minimum folded in.</p>" +
      "<h3>Cap space ahead</h3><p>2026 and 2027 use Over The Cap's team cap, contracts and dead money, so the starting point matches theirs. 2028 on use a projected base cap (" + m(C.BASE[2028], 0) + " in 2028, up 7% a year) and only contracts signed today: no carryover, no new signings, no rookie classes, so later years look roomier than they will be.</p>" +
      "<h3>Rough value (version 1)</h3><p>Half of it is his position's starter price, the average contract of the players in the starting tier league-wide, times his snap share this season. The other half is the market's own verdict, his contract's average grown with the cap, scaled down if he's playing less than a starter. Rookie deals say nothing about quality, so rookies get only the first half. Age takes a share off each later year, most at running back, least at quarterback. A real player rating built from play-by-play data is the next version.</p>" +
      "<h3>Suggestions</h3><p>Cut: saves at least 45% of his cap number and he's paid well over the rough value. Trade: saves at least $3M more than a release (the guarantees leave with him). Restructure: at least $5M of room on a starter with two or more years left. Extend: a starter 29 or younger in the last year of his deal, priced at the contract average of players his value ranks with. Expiring: starters whose deals end this season, with an estimated franchise tag (the top five cap numbers at the position).</p></div>";
  }

  // ---------- start ----------
  function get(u, opt) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }).catch(function (e) { if (opt) return null; throw e; }); }
  Promise.all([get("data/league.json"), get("data/teamcap.json", true), get("../tools/draft_teams.json")]).then(function (r) {
    TEAMS = r[2].nfl;
    W = P.init(C.newWorld(r[0], r[1]));
    W.games = r[0].games || []; W.stats = r[0].stats || null;
    SIM = S.simulate(W.games, Object.keys(S.divOf), { sims: 6000 });
    $("#foot").innerHTML = "Rosters and contracts as of " + esc(r[0].updated) + " (week " + r[0].week + "). Data from nflverse: Over The Cap contracts, NFL rosters, ESPN depth charts, Pro Football Reference snap counts.";
    render();
  }).catch(function (e) { view.innerHTML = '<p class="loading">Couldn\'t load the league: ' + esc(e.message) + "</p>"; });
})();
