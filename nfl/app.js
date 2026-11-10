/* NFL Hub: screens. The cap math lives in lib/cap.js, the rough value and suggestions in lib/plan.js; the data in
   data/league.json (nflverse, refreshed every morning) and data/teamcap.json (Over The Cap's team figures).
   Routes:  #/league   #/team/KC?y=2027&v=plan|sheet|depth   #/method
   A team's planned moves live in this browser and in the link (m=cut:ID:2027,...), so a plan can be shared. */
(function () {
  "use strict";
  var C = window.NFLCap, P = window.NFLPlan, W = null, TEAMS = null;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var view = $("#view"), card = $("#card"), cardBody = $("#cardBody");
  var state = { route: "league", arg: null, q: {} };
  var YEARS = [2026, 2027, 2028, 2029, 2030];
  var KIND = { cut: "Cut", cutJune: "Cut (post-June 1)", trade: "Trade", tradeJune: "Trade (post-June 1)", restructure: "Restructure", restructureV: "Restructure + void years", extend: "Extend" };

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function m(v, d) { if (v == null || isNaN(v)) return "—"; var a = Math.abs(v); return (v < -0.005 ? "-" : "") + "$" + (a >= 100 ? a.toFixed(0) : a.toFixed(d == null ? 1 : d)) + "M"; }
  function sm(v) { return v == null ? "—" : (v > 0.05 ? "+" : "") + m(v); }
  function save(k, v) { try { localStorage.setItem("nflhub." + k, JSON.stringify(v)); } catch (e) { /* storage off */ } }
  function load(k, d) { try { var v = localStorage.getItem("nflhub." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function stat(v, k) { return '<div class="stat"><b>' + v + "</b><span>" + k + "</span></div>"; }
  function team(c) { var t = TEAMS[c] || {}; return { code: c, name: (t.city ? t.city + " " : "") + (t.name || c), short: t.name || c, color: (t.c || ["#33415c"])[0], espn: t.espn || String(c).toLowerCase(), conf: t.conf }; }
  function logo(c, size) { size = size || 22; return '<img class="logo" src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/' + esc(team(c).espn) + ".png&w=" + size * 2 + "&h=" + size * 2 + '" alt="" width="' + size + '" height="' + size + '" loading="lazy" onerror="this.style.visibility=\'hidden\'">'; }
  function face(p, size) { return window.DSFaces.html({ sport: "nfl", id: p.espn || null, name: p.n, color: team(p.t).color, size: size || 24 }); }
  function lastName(n) { var w = String(n).split(" ").filter(function (x) { return !/^(Jr\.?|Sr\.?|II|III|IV|V)$/.test(x); }); return w.length ? w[w.length - 1] : n; }
  function posOf(p) { return p.dpos && p.dpos !== "NA" ? p.dpos : p.pos; }
  function pname(p, size, extra) { return '<span class="pl" data-p="' + esc(p.id) + '">' + face(p, size || 22) + '<span class="nm">' + esc(p.n) + "</span>" + (extra || "") + "</span>"; }
  function href(route, q) {
    var qs = Object.keys(q || {}).filter(function (k) { return q[k] != null && q[k] !== ""; }).map(function (k) { return k + "=" + encodeURIComponent(q[k]); }).join("&");
    return "#/" + route + (qs ? "?" + qs : "");
  }
  function tablePanel(title, head, body, right) {
    return '<div class="panel"><h3>' + esc(title) + " <small>" + (right || "") + '</small></h3><div class="scroll"><table class="t"><thead><tr>' + head + "</tr></thead><tbody>" + (body || '<tr><td class="note">Nothing here.</td></tr>') + "</tbody></table></div></div>";
  }
  var codes = function () { return Object.keys(TEAMS).sort(function (a, b) { return team(a).name.localeCompare(team(b).name); }); };

  // ---------- plans (moves per team) ----------
  function movesOf(code) {
    var fromUrl = state.route === "team" && state.arg === code && state.q.m != null ? decodeMoves(state.q.m) : null;
    return fromUrl || load("plan." + code, []);
  }
  function setMoves(code, ms) { save("plan." + code, ms); var q = Object.assign({}, state.q, { m: encodeMoves(ms) || null }); location.hash = href("team/" + code, q); }
  function encodeMoves(ms) { return ms.map(function (x) { return [x.kind, x.id, x.year, x.amount != null ? x.amount : "", x.apy != null ? x.apy.toFixed(2) : "", x.years || ""].join(":"); }).join(","); }
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
      if (a.dataset.tab === "team") a.setAttribute("href", href("team/" + (state.route === "team" && state.arg ? state.arg : load("team", "NE"))));
      if (a.dataset.tab === state.route) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    ({ league: leaguePage, team: teamPage, method: methodPage }[state.route] || leaguePage)();
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
    var th = function (k, l) { return '<th><a href="' + href("league", { s: k }) + '"' + (k === sort ? ' class="on"' : "") + ">" + l + "</a></th>"; };
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
    if (p && !e.target.closest("button") && !e.target.closest("select")) openCard(p.dataset.p);
  });

  // ---------- team ----------
  function teamPage() {
    var code = state.arg && TEAMS[state.arg] ? state.arg : load("team", "NE");
    save("team", code);
    var y = +state.q.y || 2027, v = state.q.v || "plan", t = team(code), ms = movesOf(code);
    var base = C.teamYears(W, code, [], 2026, 2030), plan = C.teamYears(W, code, ms.map(eng), 2026, 2030), cc = C.creditCard(W, code, 2026);
    var html = '<div class="thead">' + logo(code, 54) + "<div><h2>" + esc(t.name) + '</h2><div class="meta">' + esc(t.conf || "") + " · " + W.players.filter(function (p) { return p.t === code && p.st === "ACT"; }).length + " on the active roster</div></div>" +
      '<select class="allteams" data-goteam aria-label="Team">' + codes().map(function (c) { return '<option value="' + c + '"' + (c === code ? " selected" : "") + ">" + esc(team(c).name) + "</option>"; }).join("") + "</select></div>";
    html += '<div class="stats">' + stat(m(base[0].space), "2026 cap space") + stat('<i class="' + (plan[1].space >= 0 ? "pos" : "neg") + '">' + m(plan[1].space) + "</i>", "2027 space" + (ms.length ? " (with plan)" : "")) + stat(m(base[0].dead), "2026 dead money") +
      stat(m(cc.future), "Pushed into later years") + stat(cc.voids > 0.05 ? m(cc.voids) : "None", "In void years") + "</div>";
    html += '<div class="subtabs">' + [["plan", "Offseason planner"], ["sheet", "Cap sheet"], ["depth", "Depth chart"]].map(function (x) { return '<a href="' + href("team/" + code, Object.assign({}, state.q, { v: x[0] })) + '"' + (v === x[0] ? ' aria-current="page"' : "") + ">" + x[1] + "</a>"; }).join("") + "</div>";
    if (v === "sheet") html += capSheet(code, ms);
    else if (v === "depth") html += depthChart(code);
    else html += planner(code, y, ms, base, plan);
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
      if (a[3]) mv.apy = +a[3]; if (mv.kind === "extend") mv.years = 3;
      var ms = movesOf(code).filter(function (x) { return x.id !== mv.id; }); ms.push(mv); setMoves(code, ms); return;
    }
    if (rm) { setMoves(code, movesOf(code).filter(function (x) { return x.id !== rm.dataset.rmmove; })); return; }
    if (clr) { setMoves(code, []); return; }
    if (cp) { try { navigator.clipboard.writeText(location.href); cp.textContent = "Link copied"; } catch (x) { /* no clipboard */ } }
  });

  // The planner: suggestions, the moves so far, and the five-year picture before and after
  function planner(code, y, ms, base, plan) {
    var sug = P.suggest(W, code, y), on = {};
    ms.forEach(function (x) { on[x.id] = x; });
    var html = '<div class="controls"><label>Planning year<select data-planyear>' + [2026, 2027, 2028].map(function (k) { return '<option value="' + k + '"' + (k === y ? " selected" : "") + ">" + k + (k === 2027 ? " (next offseason)" : k === 2026 ? " (this season)" : "") + "</option>"; }).join("") + "</select></label></div>";
    // five-year picture
    html += '<div class="panel"><h3>Cap space by year <small>' + (ms.length ? ms.length + " move" + (ms.length > 1 ? "s" : "") + " in the plan" : "no moves yet: add from the suggestions or the cap sheet") + '</small></h3><div class="scroll"><table class="t five"><thead><tr><th></th>' + YEARS.map(function (k) { return "<th>" + k + "</th>"; }).join("") + "</tr></thead><tbody>" +
      "<tr><td>Team cap</td>" + base.map(function (r) { return "<td>" + m(r.cap) + "</td>"; }).join("") + "</tr>" +
      "<tr><td>Contracts</td>" + base.map(function (r) { return "<td>" + m(r.active) + "</td>"; }).join("") + "</tr>" +
      "<tr><td>Dead money on the books</td>" + base.map(function (r) { return "<td>" + m(r.dead) + "</td>"; }).join("") + "</tr>" +
      '<tr class="tot"><td>Space now</td>' + base.map(function (r) { return '<td class="' + (r.space >= 0 ? "pos" : "neg") + '">' + m(r.space) + "</td>"; }).join("") + "</tr>" +
      (ms.length ? "<tr><td>The plan</td>" + plan.map(function (r) { return '<td class="' + (r.moves <= 0 ? "pos" : "neg") + '">' + sm(-r.moves) + "</td>"; }).join("") + "</tr>" +
        "<tr><td>New dead money</td>" + plan.map(function (r) { return "<td>" + (r.newDead > 0.05 ? m(r.newDead) : "—") + "</td>"; }).join("") + "</tr>" +
        '<tr class="tot"><td>Space with the plan</td>' + plan.map(function (r) { return '<td class="' + (r.space >= 0 ? "pos" : "neg") + '"><b>' + m(r.space) + "</b></td>"; }).join("") + "</tr>" : "") +
      '</tbody></table></div><p class="note">2026 and 2027 team cap (carryover included) and dead money from Over The Cap. Later years: the projected base cap (' + m(C.BASE[2028], 0) + " in 2028, up 7% a year) and only the contracts signed today, so they look roomier than they'll be.</p></div>";
    // moves
    if (ms.length) {
      html += '<div class="panel"><h3>The plan <small><button type="button" class="linkbtn" data-copyplan>Copy link</button> · <button type="button" class="linkbtn" data-clearplan>Clear</button></small></h3><ul class="rlist">' + ms.map(function (mv) {
        var p = W.byId[mv.id], e = C.effect(p, eng(mv)), d = e.delta[mv.year] || 0;
        var bits = [sm(-d) + " in " + mv.year];
        Object.keys(e.delta).filter(function (k) { return +k > mv.year && Math.abs(e.delta[k]) > 0.05; }).slice(0, 3).forEach(function (k) { bits.push(sm(-e.delta[k]) + " in " + k); });
        var dead = Object.keys(e.dead).map(function (k) { return m(e.dead[k]) + " dead in " + k; });
        return "<li>" + pname(p, 26) + '<span class="grow"><b>' + esc(KIND[mv.kind] || mv.kind) + (mv.kind === "extend" ? " (3 yrs, " + m(mv.apy) + "/yr)" : "") + '</b> <span class="note">' + bits.join(" · ") + (dead.length ? " · " + dead.join(", ") : "") + (e.notes.length ? " · " + esc(e.notes.join(" ")) : "") + '</span></span><button type="button" class="xbtn" data-rmmove="' + esc(mv.id) + '" aria-label="Remove">×</button></li>';
      }).join("") + "</ul></div>";
    }
    // suggestions
    var groups = [["cut", "Cut candidates", "Big savings, little dead money, paid more than the rough value"], ["trade", "Trade candidates", "Save more traded than released, because the guarantees go with him"],
      ["restructure", "Restructure candidates", "Big base salaries on players the team keeps: room now, a bigger bill later"], ["extend", "Extension candidates", "Starters entering the last year of their deals"],
      ["expiring", "Expiring starters", "Deals ending after " + (y - 1) + ": re-sign, tag or let walk"]];
    html += '<h3 class="subsec">Suggestions for ' + y + '</h3><p class="note">The cap math is exact; who\'s worth keeping uses a rough value (his position\'s starter price times his snap share, blended with his contract), so treat these as worth exploring, not verdicts.</p><div class="sugs">';
    groups.forEach(function (g) {
      var list = sug.filter(function (s) { return s.kind === g[0]; }).slice(0, 5);
      html += '<div class="panel"><h3>' + g[1] + " <small>" + g[2] + '</small></h3><ul class="rlist">' + (list.length ? list.map(function (s) {
        var act = s.kind === "expiring" ? "" : s.kind === "extend" ? "extend|" + s.p.id + "|" + y + "|" + s.apy.toFixed(2) : s.kind + "|" + s.p.id + "|" + y;
        var inPlan = on[s.p.id];
        return "<li>" + pname(s.p, 26) + '<span class="grow"><span class="note">' + esc(posOf(s.p)) + " · " + (s.p.age ? Math.floor(s.p.age) : "—") + (s.cap ? " · " + m(s.cap) + " cap" : "") + "</span><br>" + esc(s.why) + "</span>" +
          (act ? (inPlan ? '<span class="pill up">In plan</span>' : '<button type="button" class="btn sm" data-addmove="' + esc(act) + '">Add</button>') : "") + "</li>";
      }).join("") : '<li class="note">Nobody stands out.</li>') + "</ul></div>";
    });
    html += "</div>";
    // the roster with an action on each
    html += capSheet(code, ms, y, true);
    return html;
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
        (withActions ? "<td>" + (mv ? '<span class="pill up">' + esc(KIND[mv.kind]) + "</span>" : r && !r[C.R.void] ? '<select data-act="' + esc(p.id) + '" aria-label="Move"><option value="">…</option>' + Object.keys(KIND).map(function (k) { return '<option value="' + k + '">' + KIND[k] + "</option>"; }).join("") + "</select>" : "") + "</td>" : "") + "</tr>";
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
        var xy = SPOTS[key] || SPOTS[key.replace(/[0-9]/g, "")] || [50, side === "o" ? 80 : 20];
        var p = W.byId[r[3]];
        out.push('<div class="dspot" style="left:' + xy[0] + "%;top:" + xy[1] + '%">' + (p ? '<button type="button" data-p="' + esc(p.id) + '">' + face(p, 30) + "</button>" : "") + '<span class="dn"><b>' + esc(r[1]) + "</b> " + esc(lastName(r[4])) + "</span></div>");
      });
      return out.join("");
    };
    var html = '<div class="gridwrap"><div class="gridiron"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="100" class="turf"/>' +
      [10, 20, 30, 40, 50, 60, 70, 80, 90].map(function (k) { return '<line x1="0" x2="100" y1="' + k + '" y2="' + k + '" class="yd"/>'; }).join("") + '<line x1="0" x2="100" y1="50" y2="50" class="los"/></svg>' +
      place(def, "d") + place(off, "o") + "</div></div>";
    html += '<p class="note center">ESPN\'s depth chart as of ' + esc(d.dt) + ": defense (" + esc(def || "") + ") on top, offense (" + esc(off || "") + ") below. Tap a player for his contract.</p>";
    // full chart as a table
    var pos = {};
    d.rows.forEach(function (r) { if (r[0] !== off && r[0] !== def) return; (pos[r[1]] = pos[r[1]] || []).push(r); });
    html += tablePanel("Depth chart", "<th>Pos</th><th>Starter</th><th>2nd</th><th>3rd</th>", Object.keys(pos).map(function (k) {
      var list = pos[k].sort(function (a, b) { return a[2] - b[2]; }).slice(0, 3);
      return "<tr><td><b>" + esc(k) + "</b></td>" + [0, 1, 2].map(function (i) { var r = list[i], p = r && W.byId[r[3]]; return "<td>" + (p ? pname(p, 20) : r ? esc(r[4]) : "") + "</td>"; }).join("") + "</tr>";
    }).join(""), "");
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
    if (ys.length) {
      html += '<h4 class="card-sec">Year by year</h4><div class="scroll"><table class="t"><thead><tr><th>Year</th><th>Base</th><th>Bonus proration</th><th>Roster + other</th><th>Guaranteed</th><th>Cap</th><th>Dead if cut</th><th>Saves</th><th>Post-June 1 saves</th></tr></thead><tbody>' + ys.map(function (y) {
        var r = c.rows[y], cut = !r[C.R.void] ? C.effect(p, { kind: "cut", year: y }) : null, june = !r[C.R.void] ? C.effect(p, { kind: "cutJune", year: y }) : null;
        return "<tr" + (r[C.R.void] ? ' class="muted-row"' : "") + "><td>" + y + (r[C.R.void] ? " (void)" : r[C.R.est] ? " (est.)" : "") + "</td><td>" + m(r[0]) + "</td><td>" + m(r[1]) + "</td><td>" + m(r[2] + r[3]) + "</td><td>" + (r[4] ? m(r[4]) : "—") + "</td><td><b>" + m(r[5]) + "</b></td><td>" + (cut ? m(cut.dead[y] || 0) : "") + '</td><td class="' + (cut && -(cut.delta[y] || 0) >= 0 ? "pos" : "neg") + '">' + (cut ? sm(-(cut.delta[y] || 0)) : "") + "</td><td>" + (june ? sm(-(june.delta[y] || 0)) : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
      html += '<p class="note">Cutting before June 1 puts every remaining bonus dollar and guarantee on that year; after June 1 (or with one of the two post-June 1 designations) the later years\' share moves to the next year. Contract data from Over The Cap via nflverse.</p>';
    } else html += '<p class="note">No contract in the feed.</p>';
    html += '<p><a class="btn" href="' + href("team/" + p.t, { v: "plan" }) + '">' + esc(t.name) + " planner</a>" + (c.otc ? ' <a class="btn" href="https://overthecap.com/player/x/' + esc(c.otc) + '/" target="_blank" rel="noopener">Over The Cap page</a>' : "") + "</p></div>";
    cardBody.innerHTML = html;
    if (!card.open) card.showModal();
  }
  card.addEventListener("click", function (e) { if (e.target === card || e.target.closest("[data-close]")) card.close(); });

  // ---------- method ----------
  function methodPage() {
    view.innerHTML = '<div class="method"><h2 class="sec">How it works</h2>' +
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
    $("#foot").innerHTML = "Rosters and contracts as of " + esc(r[0].updated) + " (week " + r[0].week + "). Data from nflverse: Over The Cap contracts, NFL rosters, ESPN depth charts, Pro Football Reference snap counts.";
    render();
  }).catch(function (e) { view.innerHTML = '<p class="loading">Couldn\'t load the league: ' + esc(e.message) + "</p>"; });
})();
