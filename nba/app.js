/* NBA Hub: screens. The numbers come from hub.js (built on the shared library in nba/lib); the data from feeds the
   site already refreshes every day. Routes live in the address bar so any view can be shared:
     #/standings?y=2   #/team/BOS?y=1   #/teams   #/value?k=picks   #/trade?ta=BOS&tb=LAL&a=..&b=..   #/fa   #/method */
(function () {
  "use strict";
  var Hub = window.NBAHub, H = null, CBA = window.CBA, Mo = window.Model;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var view = $("#view"), years = $("#years"), yearbar = $("#yearbar"), fillBox = $("#fill"), card = $("#card"), cardBody = $("#cardBody");
  var state = { year: 0, route: "standings", arg: null, q: {} };
  var POS_ORDER = { PG: 1, G: 1.5, SG: 2, SF: 3, F: 3.5, PF: 4, C: 5 };

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function f1(x) { return x == null || isNaN(x) ? "—" : (Math.round(x * 10) / 10).toFixed(1); }
  function f0(x) { return x == null || isNaN(x) ? "—" : String(Math.round(x)); }
  function pct(x, d) { if (x == null || isNaN(x)) return "—"; if (x > 0 && x < 0.005 && !d) return "<1%"; if (x > 0.995 && x < 1 && !d) return ">99%"; return (x * 100).toFixed(d || 0) + "%"; }
  function money(v, d) { // dollars in, "$24.5M" out
    if (v == null || isNaN(v)) return "—";
    var m = v / 1e6, neg = m < 0, a = Math.abs(m);
    return (neg ? "-" : "") + "$" + (a >= 100 ? a.toFixed(0) : a.toFixed(d == null ? 1 : d)) + "M";
  }
  function signed(v) { return v == null ? "—" : (v > 0 ? "+" : "") + money(v); }
  function rt(r) { return (r >= 0 ? "+" : "") + r.toFixed(1); }
  function sname(i) { return CBA.seasonName(i); }
  function team(c) { return H.teams[c] || { code: c, name: c, short: c, color: "#33415c", espn: String(c || "").toLowerCase() }; }
  function logo(c, size) {
    var t = team(c); size = size || 22;
    return '<img class="logo" src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/' + esc(t.espn) + ".png&w=" + size * 2 + "&h=" + size * 2 + '" alt="" width="' + size + '" height="' + size + '" loading="lazy" onerror="this.style.visibility=\'hidden\'">';
  }
  function face(p, size) {
    if (!p) return "";
    if (p.fill) return '<span class="fillface" style="width:' + (size || 24) + "px;height:" + (size || 24) + 'px">FA</span>';
    if (p.rook && p.prospect) return window.DSFaces.html({ sport: "ncaab", name: p.n, color: team(p.t).color, size: size || 24 });
    if (p.rook) return logo(p.from, size || 24);
    return window.DSFaces.html({ sport: "nba", id: p.espn || null, name: p.n, color: team(p.t).color, size: size || 24 });
  }
  function pname(p, size, extra) {
    if (p.fill || p.rook) return '<span class="pl static">' + face(p, size || 22) + '<span class="nm">' + esc(p.n) + "</span>" + (extra || "") + "</span>";
    return '<span class="pl" data-p="' + esc(p.id) + '">' + face(p, size || 22) + '<span class="nm">' + esc(p.n) + "</span>" + (extra || "") + "</span>";
  }
  function tier(r) { return r < -1.5 ? "Fringe" : r < -0.3 ? "Weak" : r < 1.0 ? "Average" : r < 2.5 ? "Strong" : "Elite"; }
  function rchip(r) { return '<span class="rchip T-' + tier(r) + '" title="Impact per 100 possessions">' + rt(r) + "</span>"; }
  function posOf(p) { return (p.ps && p.ps.length ? p.ps.join("/") : p.pos === "G" ? "G" : p.pos === "B" ? "C" : "F"); }
  function href(route, q) {
    var qs = Object.keys(q || {}).filter(function (k) { return q[k] != null && q[k] !== ""; }).map(function (k) { return k + "=" + encodeURIComponent(q[k]); }).join("&");
    return "#/" + route + (qs ? "?" + qs : "");
  }
  function save(k, v) { try { localStorage.setItem("nbahub." + k, JSON.stringify(v)); } catch (e) { /* storage off */ } }
  function load(k, d) { try { var v = localStorage.getItem("nbahub." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function stat(v, k) { return '<div class="stat"><b>' + v + "</b><span>" + k + "</span></div>"; }
  function kv(v, k) { return "<div><b>" + v + "</b><span>" + k + "</span></div>"; }
  function tablePanel(title, head, body, right) {
    return '<div class="panel"><h3>' + esc(title) + " <small>" + (right || "") + '</small></h3><div class="scroll"><table class="t"><thead><tr>' + head + "</tr></thead><tbody>" + (body || '<tr><td class="note">Nobody.</td></tr>') + "</tbody></table></div></div>";
  }
  function listPanel(title, items, fn, sub) {
    return '<div class="panel"><h3>' + esc(title) + " <small>" + esc(sub || "") + '</small></h3><ul class="rlist">' +
      (items.length ? items.map(function (e) { return "<li>" + fn(e) + "</li>"; }).join("") : '<li class="note">Nobody.</li>') + "</ul></div>";
  }
  function ordinal(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function yq(i) { return i ? i : null; }

  // ---------- routing ----------
  function parse() {
    var h = location.hash.replace(/^#\/?/, ""), qs = "";
    var i = h.indexOf("?");
    if (i >= 0) { qs = h.slice(i + 1); h = h.slice(0, i); }
    var parts = h.split("/").filter(Boolean), q = {};
    qs.split("&").forEach(function (kv) { if (!kv) return; var a = kv.split("="); q[a[0]] = decodeURIComponent(a[1] || ""); });
    state.route = parts[0] || "standings";
    state.arg = parts[1] || null;
    state.q = q;
    var y = +q.y;
    state.year = y >= 0 && y < Hub.YEARS ? y : 0;
  }
  function render() {
    parse();
    document.querySelectorAll(".tabs a").forEach(function (a) {
      var on = a.dataset.tab === state.route || (a.dataset.tab === "teams" && state.route === "team") || (a.dataset.tab === "contracts" && state.route === "picks");
      if (a.dataset.tab === "contracts") a.setAttribute("href", href("contracts/" + (state.route === "team" || state.route === "contracts" ? (state.arg || "BOS").toUpperCase() : load("team", "BOS")), {}));
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    var withYears = state.route === "standings" || state.route === "team" || state.route === "contracts";
    yearbar.hidden = !withYears;
    if (withYears) drawYears();
    if (state.route === "team" && state.arg) save("team", state.arg.toUpperCase());
    var fn = { standings: standings, team: teamPage, teams: teamsPage, contracts: contractsPage, picks: picksPage, value: valuePage, trade: tradePage, fa: faPage, method: methodPage }[state.route] || standings;
    fn();
  }
  function drawYears() {
    var b = "";
    for (var i = 0; i < Hub.YEARS; i++) b += '<button type="button" data-y="' + i + '" aria-pressed="' + (i === state.year) + '">' + sname(i) + "</button>";
    years.innerHTML = b;
  }
  years.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-y]");
    if (!b) return;
    var q = Object.assign({}, state.q, { y: yq(+b.dataset.y) });
    location.hash = href(state.route + (state.arg ? "/" + state.arg : ""), q);
  });
  fillBox.addEventListener("change", function () { H.set("fill", fillBox.checked); save("fill", fillBox.checked); render(); });
  window.addEventListener("hashchange", function () { closeCard(); render(); window.scrollTo({ top: Math.min(window.scrollY, 200) }); });

  // ---------- standings ----------
  function standings() {
    var i = state.year, rows = H.standings(i), first = i === 0;
    var html = '<h2 class="sec">' + sname(i) + (first ? " Projected Standings" : " Projection") + "</h2>" +
      '<p class="lede">' + (first
        ? "Each team's real record (" + Math.round(H.played) + " games in), then the rest of the season played out " + H.cfg.sims.toLocaleString() + " times from today's rosters: play-in, playoffs and the 3-2-1 lottery included. Click a team for its rotation and cap sheet."
        : "Built from contracts: players leave when their deals end (restricted free agents worth their price are matched), everyone ages a year at a time, and each team's draft picks arrive at their projected slot. " + (H.cfg.fill ? "Open spots go to the free agents a team's cap position can buy." : "Open spots are left at replacement level.") + " Rougher every year out.") + "</p>";
    html += '<div class="leagues stack">';
    ["E", "W"].forEach(function (conf) {
      var d = rows.filter(function (r) { return r.conf === conf; });
      html += '<div class="div"><h3>' + (conf === "E" ? "Eastern" : "Western") + ' Conference</h3><div class="scroll"><table class="t"><thead><tr><th>Team</th>' + (first ? "<th>Now</th>" : "") + "<th>Proj</th><th>Net</th><th>Playoffs</th><th>Play-in</th><th>Conf</th><th>Title</th>" + (first ? "<th>Avg pick</th>" : "") + "</tr></thead><tbody>";
      d.forEach(function (r, k) {
        var w = Math.round(r.projW);
        html += '<tr class="go' + (k === 6 || k === 10 ? " cut" : "") + '" data-team="' + r.code + '"><td class="tm">' + (k + 1) + ". " + logo(r.code) + '<span class="nm">' + esc(r.name) + "</span></td>" +
          (first ? "<td>" + r.w + "-" + r.l + "</td>" : "") + "<td><b>" + w + "-" + (82 - w) + '</b></td><td class="' + (r.net >= 0 ? "pos" : "neg") + '">' + rt(r.net) + "</td>" +
          '<td><span class="bar">' + pct(r.playoffs) + '<i><b style="width:' + (r.playoffs * 100).toFixed(0) + '%"></b></i></span></td>' +
          "<td>" + pct(r.playin) + "</td><td>" + pct(r.confW) + "</td><td><b>" + pct(r.title) + "</b></td>" +
          (first ? '<td title="Chance of a top-4 pick: ' + pct(r.top4) + '">' + (r.avgPick <= 16 ? f1(r.avgPick) : "—") + "</td>" : "") + "</tr>";
      });
      html += "</tbody></table></div></div>";
    });
    html += "</div>";
    if (first) html += lotteryPanel(rows);
    html += '<p class="note">Seeds 1-6 make the playoffs; 7-10 go to the play-in (lines mark the cuts). Net is projected points per 100 possessions better than an average team.</p>';
    view.innerHTML = html;
  }
  function lotteryPanel(rows) {
    var lot = rows.slice().sort(function (a, b) { return a.avgPick - b.avgPick; }).slice(0, 16);
    return tablePanel("The 2027 lottery", "<th>Team</th><th>Proj</th><th>No. 1</th><th>Top 4</th><th>Avg pick</th><th>Pick goes to</th>",
      lot.map(function (r) {
        var pk = H.W.picks.find(function (x) { return x.y === 2027 && x.r === 1 && x.from === r.code; });
        var to = pk && pk.owner !== r.code ? logo(pk.owner, 16) + " " + esc(team(pk.owner).short) + (pk.prot ? ' <span class="note">(' + esc(pk.note || "protected") + ")</span>" : "") : '<span class="note">Own pick</span>';
        if (pk && pk.locked && pk.owner === r.code) to = '<span class="note">' + esc(pk.note || "") + "</span>";
        var w = Math.round(r.projW);
        return '<tr class="go" data-team="' + r.code + '"><td class="tm">' + logo(r.code) + '<span class="nm">' + esc(r.name) + "</span></td><td>" + w + "-" + (82 - w) + "</td><td>" + pct(r.no1, 1) + "</td><td>" + pct(r.top4) + "</td><td><b>" + f1(r.avgPick) + '</b></td><td style="text-align:left;white-space:normal">' + to + "</td></tr>";
      }).join(""), "The worst three records get two balls, not three, and can't fall below 12th");
  }
  view.addEventListener("click", function (e) {
    var tr = e.target.closest("[data-team]");
    if (tr && !e.target.closest("[data-p]") && !e.target.closest("button")) {
      location.hash = href("team/" + tr.dataset.team, { y: yq(state.year) });
      return;
    }
    var p = e.target.closest("[data-p]");
    if (p && !e.target.closest(".results") && !e.target.closest("button")) openCard(p.dataset.p);
  });

  // ---------- teams ----------
  function teamsPage() {
    var rows = H.standings(0), by = {};
    rows.forEach(function (r) { by[r.code] = r; });
    var html = '<h2 class="sec">Teams</h2><p class="lede">Every team: rotation, cap sheet through ' + sname(Hub.YEARS - 1) + ", draft picks, and the year slider.</p>";
    ["E", "W"].forEach(function (conf) {
      html += '<h3 class="subsec">' + (conf === "E" ? "East" : "West") + '</h3><div class="teamgrid">';
      H.codes.filter(function (c) { return team(c).conf === conf; }).sort(function (a, b) { return team(a).name.localeCompare(team(b).name); }).forEach(function (c) {
        var r = by[c], w = Math.round(r.projW);
        html += '<a href="#/team/' + c + '">' + logo(c, 34) + "<div><b>" + esc(team(c).name) + "</b><span>" + r.w + "-" + r.l + " now · projected " + w + "-" + (82 - w) + "</span></div></a>";
      });
      html += "</div>";
    });
    view.innerHTML = html;
  }

  // ---------- team page ----------
  function teamPage() {
    var code = (state.arg || "BOS").toUpperCase(), i = state.year;
    if (!H.teams[code]) { teamsPage(); return; }
    var t = team(code), st = H.standings(i).filter(function (r) { return r.code === code; })[0];
    var conf = H.standings(i).filter(function (r) { return r.conf === t.conf; });
    var seed = conf.findIndex(function (r) { return r.code === code; }) + 1;
    var pay = H.payroll(code, i), status = CBA.status(pay, i);
    var w = Math.round(st.projW);
    var html = teamHead(code, i, "team") + teamPicker(code, i, "team");
    html += '<div class="stats">' + stat(ordinal(seed), (t.conf === "E" ? "East" : "West") + " seed") + stat(pct(st.playoffs), "Playoffs") + stat(pct(st.title), "Title") +
      stat(rt(st.net), "Net rating") + stat('<a href="' + href("contracts/" + code, { y: yq(i) }) + '">' + money(pay, 0) + "</a>", "Payroll") + stat(esc(CBA.STATUS_NAME[status]), "Cap position") + "</div>";
    var lu = H.lineup(code, i), roster = H.rosterAt(code, i);
    html += '<div class="legend">' + ["Fringe", "Weak", "Average", "Strong", "Elite"].map(function (k) { return '<span class="T-' + k + '">' + k + "</span>"; }).join("") + '<span class="note">impact per 100 possessions</span></div>';
    html += court(lu.starters, lu.slots);
    html += '<p class="note center">' + (i === 0 ? "The usual starting five: most games started this season, with the last game breaking ties. Minutes are what each player is averaging." : "Projected: the best player at each position by rating, the bench by rating.") + "</p>";
    html += depthChart(lu, i);
    if (i > 0) html += changes(code, i);
    var inj = roster.filter(function (e) { return e.p.inj; });
    html += tablePanel("Roster", "<th>Player</th><th>Pos</th><th>Age</th><th>Impact</th><th>Min</th><th>" + (i === 0 ? "Pts / Reb / Ast" : "Salary") + "</th><th>Contract</th>",
      lu.starters.concat(lu.bench).map(function (x, k) {
        var p = x.p, mins = lu.mins[p.id] || 0;
        var line = i === 0 ? (p.line ? f1(p.line.pts) + " / " + f1(p.line.reb) + " / " + f1(p.line.ast) : "—") : money(x.sal);
        return "<tr" + (k === 5 || k === 10 ? ' class="cut"' : "") + "><td>" + pname(p, 24, p.inj ? ' <span class="pill warn" title="' + esc(p.inj) + '">' + esc(p.inj) + "</span>" : "") + "</td><td>" + esc(posOf(p)) + "</td><td>" + (p.fill || p.age == null ? "—" : p.rook ? p.age + i - p.arrive : p.age + i) + "</td><td>" + rchip(x.r) + "</td><td>" + (mins ? f0(mins) : "—") + "</td><td>" + line + "</td><td>" + contractCell(x, i) + "</td></tr>";
      }).join(""), (i === 0 ? "This season's numbers" : "") + (inj.length && i === 0 ? " · " + inj.length + " on the injury report" : ""));
    html += '<p class="note">Cap sheet, exceptions and draft picks are on the <a href="' + href("contracts/" + code, { y: yq(i) }) + '">Contracts tab</a>.</p>';
    view.innerHTML = html;
  }
  function teamHead(code, i, route) {
    var t = team(code), st = H.standings(i).filter(function (r) { return r.code === code; })[0], w = Math.round(st.projW);
    return '<div class="thead">' + logo(code, 54) + "<div><h2>" + esc(t.name) + '</h2><div class="meta">' + (t.conf === "E" ? "East" : "West") + " · " + sname(i) + (i === 0 ? " · " + t.w + "-" + t.l + " now" : "") + " · projected " + w + "-" + (82 - w) + "</div></div>" +
      '<div class="tlinks"><a class="' + (route === "team" ? "on" : "") + '" href="' + href("team/" + code, { y: yq(i) }) + '">Rotation</a><a class="' + (route === "contracts" ? "on" : "") + '" href="' + href("contracts/" + code, { y: yq(i) }) + '">Contracts</a></div></div>';
  }
  function teamPicker(code, i, route) {
    var t = team(code);
    return '<div class="teampick">' + H.codes.filter(function (c) { return team(c).conf === t.conf && c !== code; }).sort(function (a, b) { return team(a).name.localeCompare(team(b).name); }).map(function (c) {
      return '<a href="' + href(route + "/" + c, { y: yq(i) }) + '">' + logo(c, 18) + esc(team(c).short) + "</a>";
    }).join("") + '<select class="allteams" data-goteam="' + route + '" aria-label="Any team"><option value="">Other team…</option>' + H.codes.filter(function (c) { return team(c).conf !== t.conf; }).sort(function (a, b) { return team(a).name.localeCompare(team(b).name); }).map(function (c) { return '<option value="' + c + '">' + esc(team(c).name) + "</option>"; }).join("") + "</select></div>";
  }
  view.addEventListener("change", function (e) {
    var s = e.target.closest("select[data-goteam]");
    if (s && s.value) location.hash = href(s.dataset.goteam + "/" + s.value, { y: yq(state.year) });
  });
  function statusPill(x, i) {
    var p = x.p;
    if (x.how === "fill") return '<span class="pill fill">' + (x.p.n.indexOf("Replacement") === 0 ? "Open spot" : "Signing") + "</span>";
    if (x.how === "rookie") return '<span class="pill new">' + p.year + " No. " + p.slot + "</span>";
    if (x.how === "re-signed") return '<span class="pill up">Re-signed</span>';
    var last = H.lastYear(p), opt = p.c.opt && p.c.opt[i];
    if (opt) return '<span class="pill">' + esc(CBA.OPT_NAME[opt]) + "</span>";
    return '<span class="pill">Thru ' + sname(last) + "</span>";
  }
  // A contract as it's written: each season left, the money, and any option, then how it ends
  function contractYears(p, i) {
    var c = p.c || {}, out = [];
    for (var j = i; j < (c.sal || []).length; j++) if (c.sal[j] > 0) out.push({ j: j, sal: c.sal[j], opt: c.opt && c.opt[j] });
    return out;
  }
  function contractCell(x, i) {
    var p = x.p;
    if (x.how !== "contract") return statusPill(x, i);
    var ys = contractYears(p, i);
    if (!ys.length) return statusPill(x, i);
    var tot = ys.reduce(function (a, y) { return a + y.sal; }, 0), opts = ys.filter(function (y) { return y.opt; });
    return '<span class="cyrs"><b>' + ys.length + " yr" + (ys.length > 1 ? "s" : "") + ", " + money(tot, 0) + "</b>" +
      opts.map(function (y) { return '<span class="otag o-' + y.opt + '" title="' + esc(CBA.OPT_NAME[y.opt]) + " for " + sname(y.j) + '">' + CBA.OPT_SHORT[y.opt] + " " + sname(y.j).slice(2) + "</span>"; }).join("") +
      '<small>then ' + esc(H.faKind(p)) + "</small></span>";
  }
  function contractStrip(p, i) {
    var ys = contractYears(p, i);
    if (!ys.length) return "";
    return '<div class="cstrip">' + ys.map(function (y) {
      return '<div class="cy' + (y.opt ? " o-" + y.opt : "") + '"><span>' + sname(y.j) + "</span><b>" + money(y.sal) + "</b><small>" + (y.opt ? esc(CBA.OPT_NAME[y.opt]) : "Guaranteed") + "</small></div>";
    }).join("") + '<div class="cy end"><span>After ' + sname(ys[ys.length - 1].j) + "</span><b>" + esc(H.faKind(p)) + "</b><small>" + (H.faKind(p) === "RFA" ? "team can match" : "free to sign anywhere") + "</small></div></div>";
  }
  // Starting five on a half court
  function court(five, slots) {
    var spots = [[50, 18], [82, 34], [18, 34], [70, 70], [34, 74]], lbl = slots || ["PG", "SG", "SF", "PF", "C"];
    var html = '<div class="courtwrap"><div class="court">' + courtSvg();
    five.forEach(function (x, k) {
      var s = spots[k], open = !(x.p.fill || x.p.rook);
      html += '<div class="cspot" style="left:' + s[0] + "%;top:" + s[1] + '%">' + (open ? '<button type="button" class="cbtn" data-p="' + esc(x.p.id) + '">' : '<div class="cbtn">') +
        face(x.p, 52) + '<span class="cn">' + esc(x.p.n) + '</span><span class="cr T-' + tier(x.r) + '">' + lbl[k] + " · " + rt(x.r) + "</span>" + (x.starts && x.starts[1] ? '<span class="cg">' + x.starts[0] + " of " + x.starts[1] + " starts</span>" : "") + (open ? "</button>" : "</div>") + "</div>";
    });
    return html + "</div></div>";
  }
  function courtSvg() {
    return '<svg viewBox="0 0 500 360" aria-hidden="true" preserveAspectRatio="none"><rect x="0" y="0" width="500" height="360" class="wood"/>' +
      '<g class="lines"><rect x="2" y="2" width="496" height="356"/><rect x="170" y="190" width="160" height="168"/><circle cx="250" cy="190" r="60"/>' +
      '<path d="M30 358 V300 A220 220 0 0 1 470 300 V358"/><path d="M190 2 A60 60 0 0 0 310 2"/><circle cx="250" cy="330" r="9"/><line x1="220" y1="342" x2="280" y2="342"/></g></svg>';
  }
  // Depth chart: one row per position, the starter first and then the backups who play there, with minutes
  function depthChart(lu, i) {
    var SL = ["PG", "SG", "SF", "PF", "C"], cols = { PG: [], SG: [], SF: [], PF: [], C: [] };
    lu.starters.forEach(function (x, k) { cols[(lu.slots || SL)[k]].push({ x: x, start: true }); });
    lu.bench.forEach(function (x) {
      var ps = x.p.ps && x.p.ps.length ? x.p.ps : x.p.pos === "G" ? ["PG", "SG"] : x.p.pos === "B" ? ["C", "PF"] : ["SF", "PF"];
      var slot = ps.find(function (s) { return cols[s]; }) || "SF";
      cols[slot].push({ x: x });
    });
    var html = '<div class="panel"><h3>Depth chart <small>' + (i === 0 ? "minutes per game this season" : "projected minutes per game") + '</small></h3><div class="dchart">' +
      '<div class="dhead"><span>Pos</span><span>Starter</span><span>Bench</span></div>';
    SL.forEach(function (s) {
      var list = cols[s], tot = list.reduce(function (a, d) { return a + (lu.mins[d.x.p.id] || 0); }, 0);
      var cell = function (d) {
        var m = lu.mins[d.x.p.id] || 0, p = d.x.p;
        return '<span class="dp' + (d.start ? " st" : "") + (m < 1 ? " dnp" : "") + ' T-' + tier(d.x.r) + 'b"' + (p.fill || p.rook ? "" : ' data-p="' + esc(p.id) + '"') + ">" + face(p, d.start ? 30 : 24) +
          '<span class="dn"><b>' + esc(d.start ? p.n : shortName(p.n)) + "</b><small>" + (m >= 1 ? f0(m) + " min" : "DNP") + " · " + rt(d.x.r) + "</small></span></span>";
      };
      var st = list.filter(function (d) { return d.start; }), bn = list.filter(function (d) { return !d.start; });
      html += '<div class="drow2"><span class="dpos"><b>' + s + "</b><small>" + f0(tot) + " min</small></span>" +
        '<span class="dst">' + (st.length ? st.map(cell).join("") : '<span class="dp empty">—</span>') + '</span><span class="dbn">' + (bn.length ? bn.map(cell).join("") : '<span class="dp empty">No backup</span>') + "</span></div>";
    });
    return html + '</div><p class="note">Bench players are listed at the first position they play. The colored edge is the impact tier.</p></div>';
  }
  function shortName(n) { var parts = String(n).split(" "); return parts.length > 1 ? parts[0][0] + ". " + parts.slice(1).join(" ") : n; }
  // Who left and who arrived going into this season
  function changes(code, i) {
    var gone = [], come = [];
    Object.values(H.W.P).forEach(function (p) {
      if (p.t !== code || p.two) return;
      if (H.salaryAt(p, i - 1) > 0 && !H.salaryAt(p, i)) gone.push(p);
    });
    H.rosterAt(code, i).forEach(function (x) { if (x.how === "rookie" && x.p.arrive === i) come.push(x); if (x.how === "fill") come.push(x); });
    return '<div class="two">' + listPanel("Gone from last season", gone, function (p) {
      var on = H.kept(p), kind = H.faKind(p);
      return pname(p, 26) + '<span class="grow"></span><span class="sub">' + kind + " · " + rt(H.rating(p, i)) + '</span><button class="btn' + (on ? " on" : "") + '" data-resign="' + esc(p.id) + '">' + (on ? "Re-signed" : "Re-sign") + "</button>";
    }, "Contracts that ran out") + listPanel("Arriving", come, function (x) {
      return pname(x.p, 26) + '<span class="grow"></span><span class="sub">' + (x.how === "rookie" ? (x.p.school ? esc(x.p.school) + " · " : "") : "") + money(x.sal) + " · " + rt(x.r) + "</span>";
    }, "Draft picks and free agent signings") + "</div>" +
      '<p class="note">Re-signing keeps a player at his market price for as long as the market would go. Restricted free agents are matched by default when they\'re worth it.</p>';
  }
  view.addEventListener("click", function (e) {
    var b = e.target.closest("[data-resign]");
    if (!b) return;
    e.stopPropagation();
    var p = H.W.P[b.dataset.resign];
    H.keep[p.id] = !H.kept(p);
    save("keep", H.keep);
    H.reset();
    render();
  }, true);

  // ---------- contracts ----------
  function contractsPage() {
    var code = (state.arg || load("team", "BOS")).toUpperCase(), i = state.year;
    if (!H.teams[code]) code = "BOS";
    save("team", code);
    var T = H.tools(code, 0), lbl = { room: "Under the cap", over: "Over the cap", tax: "In the tax", a1: "Over the first apron", a2: "Over the second apron" };
    var html = teamHead(code, i, "contracts") + teamPicker(code, i, "contracts");
    html += '<div class="stats">' + stat(money(T.pay, 1), sname(0) + " payroll") + stat(esc(lbl[T.status]), "Cap position") +
      stat(T.toTax >= 0 ? money(T.toTax) + " under" : money(-T.toTax) + " over", "Tax line") + stat(T.toA1 >= 0 ? money(T.toA1) + " under" : money(-T.toA1) + " over", "First apron") +
      stat(T.taxBill ? money(T.taxBill) : "None", "Tax bill" + (T.rep ? " (repeater)" : "")) + stat(T.roster + " + " + T.two, "Standard + two-way") + "</div>";
    var flags = [];
    if (T.hard) flags.push('<span class="pill fill">Hard-capped at the ' + esc(CBA.LEVEL_NAME[T.hard]) + "</span> " + esc(T.hardWhy));
    flags.push(T.rep ? '<span class="pill warn">Repeater</span> Paid tax in at least three of the last four seasons, so any bill this season is at repeater rates.' : '<span class="pill">Not a repeater</span> Tax this season would be at standard rates.');
    html += '<div class="panel"><h3>What ' + esc(team(code).short) + " can do now <small>" + sname(0) + '</small></h3><p class="flags">' + flags.join("<br>") + '</p><div class="scroll"><table class="t"><thead><tr><th>Tool</th><th>Amount</th><th>Usable</th><th>Notes</th></tr></thead><tbody>' +
      T.tools.map(function (x) { return "<tr><td>" + esc(x.name) + "</td><td>" + (x.amt ? money(x.amt) : "—") + "</td><td>" + (x.ok ? '<span class="pill up">Yes</span>' : '<span class="pill">No</span>') + '</td><td class="note" style="text-align:left;white-space:normal">' + esc(x.why) + "</td></tr>"; }).join("") +
      '</tbody></table></div><p class="note">Trade exceptions as of Nov 2026; mid-level use as of mid-July (Hoops Rumors). A signing since then may have used more.</p></div>';
    html += repeaterPanel(code);
    html += capSheet(code, i);
    var ext = H.extensions(code);
    html += tablePanel("Extension eligible now", "<th>Player</th><th>Kind</th><th>Max first year</th><th>Max years</th><th>Starts</th><th>Worth then</th><th>Market then</th>", ext.map(function (e) {
      return "<tr><td>" + pname(e.p, 22) + "</td><td>" + esc(e.kind === "rookie" ? "Rookie scale" : "Veteran") + "</td><td>" + money(e.first) + "</td><td>" + (e.years || "—") + "</td><td>" + sname(e.start) + "</td><td>" + money(e.prod) + "</td><td>" + money(e.market) + "</td></tr>";
    }).join(""), "Worth then: his projected production that season. Market: what he'd get as a free agent");
    html += picksPanel(code);
    view.innerHTML = html;
  }
  // The repeater clock: five seasons of real tax history, then each projected season (tap one to say the team pays
  // or ducks that year), whether a bill is at repeater rates, what the repeater costs, and the standard-rate runway
  var repAssume = {};
  function repeaterPanel(code) {
    var A = repAssume[code] || {}, R = H.repeaterClock(code, A), tm = team(code).short;
    var chips = R.rows.map(function (r) {
      var cls = "rc" + (r.paid ? " paid" : "") + (r.rep && r.paid ? " rep" : "") + (r.hist ? " hist" : " fut") + (r.forced ? " forced" : "") + (r.j === 0 ? " now" : "");
      var sub = r.hist ? (r.paid ? "Paid tax" : "Under") : (r.paid ? (r.rep ? "Repeater tax" : "Standard tax") : "Under") + (r.forced ? " (your call)" : "");
      var detail = r.hist ? "" : (r.over >= 0 ? money(r.over) + " over" : money(-r.over) + " under") + (r.paid && r.bill ? " · bill " + money(r.bill) : "");
      return (r.hist ? "<div" : '<button type="button" data-rep="' + code + ":" + r.j + '"') + ' class="' + cls + '"><span>' + sname(r.j) + "</span><b>" + sub + "</b>" +
        (r.n != null ? "<small>" + r.n + " of prior 4 taxed" + (r.rep ? ": repeater" : "") + "</small>" : "<small>&nbsp;</small>") + (detail ? "<em>" + detail + "</em>" : "") + (r.hist ? "</div>" : "</button>");
    }).join("");
    var now = R.rows.filter(function (r) { return r.j === 0; })[0];
    var lines = [];
    lines.push(now.rep ? "<b>" + esc(tm) + " are repeaters this season.</b> They paid tax in " + now.n + " of the last four seasons, so any " + sname(0) + " bill is at repeater rates ($2.50 to $4.25 per dollar instead of $1.50 to $3.25)."
      : "<b>" + esc(tm) + " are not repeaters this season.</b> " + now.n + " of the last four seasons in the tax, so a " + sname(0) + " bill would be at standard rates.");
    if (now.rep && !now.paid) lines.push("They're projected under the line this season, which resets the clock.");
    if (R.start != null) {
      var fromS = sname(R.start), lastS = R.run ? sname(R.start + R.run - 1) : null;
      lines.push(R.run >= 6 ? "From " + fromS + " they could pay the tax every season and never hit repeater rates."
        : R.run ? "<b>Standard-rate runway: " + R.run + " season" + (R.run > 1 ? "s" : "") + ".</b> Paying tax every season from " + fromS + " stays at standard rates through " + lastS + "; " + sname(R.start + R.run) + " would be at repeater rates."
        : "");
    }
    var cost = R.rows.filter(function (r) { return !r.hist && r.paid && r.rep; }).reduce(function (a, r) { return a + (r.bill - r.billStd); }, 0);
    if (cost > 0) lines.push("On these projections the repeater adds <b>" + money(cost) + "</b> to their tax bills over what standard rates would cost.");
    return '<div class="panel"><h3>Repeater clock <small>a bill is at repeater rates after tax in 3 of the prior 4 seasons</small></h3><div class="repclock">' + chips + "</div>" +
      '<p class="flags">' + lines.filter(Boolean).join("<br>") + '</p><p class="note">Past seasons are who actually finished over the line (Hoops Rumors). Later seasons follow the projected payroll at the tax line; tap one to make the team pay or duck the tax that year and watch the clock move.' +
      (Object.keys(A).length ? ' <button type="button" class="linkbtn" data-represet="' + code + '">Back to the projection</button>' : "") + "</p></div>";
  }
  view.addEventListener("click", function (e) {
    var b = e.target.closest("[data-rep]"), rs = e.target.closest("[data-represet]");
    if (rs) { delete repAssume[rs.dataset.represet]; render(); return; }
    if (!b) return;
    var parts = b.dataset.rep.split(":"), code = parts[0], j = +parts[1], A = repAssume[code] || (repAssume[code] = {});
    var proj = H.payroll(code, j) > CBA.tax(j);
    if (A[j] == null) A[j] = !proj; else delete A[j];   // tap: the other way from the projection; tap again: back
    render();
  });
  // Every traded pick in the league: who owns it, its protection, where it projects
  function tcell(c) { return '<span class="tcell">' + logo(c, 18) + "<span>" + esc(team(c).short) + "</span></span>"; }
  function picksPage() {
    var q = state.q, yr = q.y2 || "", tm = q.t || "";
    var all = H.allPicks().filter(function (pk) { return (!yr || String(pk.y) === yr) && (!tm || pk.from === tm || pk.owner === tm); });
    var years = []; H.allPicks().forEach(function (pk) { if (years.indexOf(pk.y) < 0) years.push(pk.y); });
    var html = '<h2 class="sec">Traded picks</h2><p class="lede">Every first- and second-round pick that has changed hands, with its protection and where it projects to land. Pick terms come from the Big Board\'s ledger (Tankathon and RealGM), refreshed daily.</p>';
    html += controls('<label>Year<select data-q="y2"><option value="">All</option>' + years.map(function (y) { return '<option value="' + y + '"' + (String(y) === yr ? " selected" : "") + ">" + y + "</option>"; }).join("") + "</select></label>" + teamSelect(tm));
    var protText = function (pk) {
      var bits = [];
      if (pk.prot) bits.push(pk.r === 2 ? "Protected " + (pk.prot.lo + (pk.prot.hi <= 30 ? 30 : 0)) + "-" + (pk.prot.hi + (pk.prot.hi <= 30 ? 30 : 0)) : pk.prot.lo === 1 ? "Top-" + pk.prot.hi + " protected" : "Protected " + pk.prot.lo + "-" + pk.prot.hi);
      if (pk.group) bits.push("Better-of group");
      return bits.length ? bits.join(" · ") : "Unprotected";
    };
    html += tablePanel(all.length + " picks", "<th>Pick</th><th>Original team</th><th>Owned by</th><th>Protection</th><th>Proj. slot</th><th>Conveys</th><th>Value</th><th>Notes</th>", all.map(function (pk) {
      var info = H.pickInfo(pk);
      return "<tr><td>" + pk.y + " " + (pk.r === 1 ? "1st" : "2nd") + "</td><td>" + tcell(pk.from) + "</td><td>" + (pk.owner === "OUT" ? "Forfeited" : tcell(pk.owner)) + "</td><td>" +
        (pk.prot || pk.group ? "<b>" + esc(protText(pk)) + "</b>" : '<span class="note">Unprotected</span>') + "</td><td>" + f1(info.avg) + "</td><td>" + (pk.prot ? pct(info.conveys) : "") + "</td><td>" + money(H.pickValue(pk, H.cfg.mode)) + '</td><td class="note" style="text-align:left;white-space:normal">' + esc(pk.note || "") + "</td></tr>";
    }).join(""), "Conveys: share of simulations where the protection doesn't hold");
    var sw = (H.W.swaps || []).filter(function (s) { return (!yr || String(s.y) === yr) && (!tm || s.from === tm || s.owner === tm); });
    if (sw.length) html += tablePanel("Swap rights", "<th>Pick</th><th>Holder</th><th>Swaps with</th><th>Value</th><th>Notes</th>", sw.map(function (s) {
      return "<tr><td>" + s.y + " " + (s.r === 1 ? "1st" : "2nd") + "</td><td>" + tcell(s.owner) + "</td><td>" + tcell(s.from) + "</td><td>" + money(H.swapValue(s, H.cfg.mode)) + '</td><td class="note" style="text-align:left;white-space:normal">' + esc(s.note || "Takes the better of the two picks") + "</td></tr>";
    }).join(""), "");
    view.innerHTML = html;
  }
  // Every player's salary each season, the options, and the lines that matter
  function capSheet(code, i0) {
    var cols = [0, 1, 2, 3, 4];
    var list = Object.values(H.W.P).filter(function (p) { return p.t === code && !p.two && cols.some(function (j) { return H.salaryAt(p, j) > 0; }); })
      .sort(function (a, b) { return H.salaryAt(b, 0) - H.salaryAt(a, 0) || H.salaryAt(b, 1) - H.salaryAt(a, 1); });
    var rooks = [];
    for (var j = 1; j < Hub.YEARS; j++) H.rookies(j).forEach(function (r) { if (r.t === code) rooks.push(r); });
    var cell = function (p, j) {
      var s = p.rook ? (p.c.sal[j] || 0) : H.salaryAt(p, j);
      if (!s) return "<td></td>";
      var opt = !p.rook && p.c.opt && p.c.opt[j], re = !p.rook && !H.salary(p, j);
      var cls = opt === "PO" ? "o-po" : opt === "TO" ? "o-to" : opt === "NG" ? "o-ng" : opt === "MO" ? "o-po" : re ? "o-re" : p.rook ? "o-rk" : "";
      return '<td class="' + cls + (j === i0 ? " on" : "") + '"' + (opt ? ' title="' + esc(CBA.OPT_NAME[opt]) + '"' : re ? ' title="Projected re-signing at market price"' : "") + ">" + money(s) + "</td>";
    };
    var two = Object.values(H.W.P).filter(function (p) { return p.t === code && p.two; });
    var body = list.map(function (p) { return "<tr><td>" + pname(p, 20) + '</td><td class="note">' + esc(posOf(p)) + "</td>" + cols.map(function (j) { return cell(p, j); }).join("") + "</tr>"; }).join("") +
      rooks.map(function (p) {
        var nm = p.year + " No. " + p.slot + " pick" + (p.from !== p.t ? " (via " + p.from + ")" : "") + (p.prospect ? ' <span class="note">proj. ' + esc(p.n) + "</span>" : "");
        return '<tr><td><span class="pl static">' + logo(p.from, 18) + '<span class="nm">' + nm + '</span></span></td><td class="note">Draft</td>' + cols.map(function (j) { return cell(p, j); }).join("") + "</tr>";
      }).join("");
    H.W.T[code].dead.forEach(function (d) {
      body += '<tr><td><span class="pl static"><span class="fillface" style="width:20px;height:20px">$</span><span class="nm">' + esc(d.n) + '</span></span></td><td class="note">Dead</td>' + cols.map(function (j) { return d.sal[j] ? '<td class="o-ng">' + money(d.sal[j]) + "</td>" : "<td></td>"; }).join("") + "</tr>";
    });
    var tot = cols.map(function (j) { return H.payroll(code, j); });
    body += '<tr class="tot"><td colspan="2">Payroll (with open spots filled)</td>' + tot.map(function (x, j) { return "<td" + (j === i0 ? ' class="on"' : "") + "><b>" + money(x) + "</b></td>"; }).join("") + "</tr>";
    body += '<tr class="lines"><td colspan="2">Salary cap</td>' + cols.map(function (j) { return "<td>" + money(CBA.cap(j)) + "</td>"; }).join("") + "</tr>";
    body += '<tr class="lines"><td colspan="2">Tax line</td>' + cols.map(function (j) { return "<td>" + money(CBA.tax(j)) + "</td>"; }).join("") + "</tr>";
    body += '<tr class="lines"><td colspan="2">First / second apron</td>' + cols.map(function (j) { return "<td>" + money(CBA.a1(j), 0) + " / " + money(CBA.a2(j), 0) + "</td>"; }).join("") + "</tr>";
    body += '<tr class="lines"><td colspan="2">Position</td>' + cols.map(function (j) { var s = CBA.status(tot[j], j); return '<td><span class="pill ' + (s === "a2" || s === "a1" ? "fill" : s === "tax" ? "warn" : s === "room" ? "up" : "") + '">' + esc({ room: "Room", over: "Over cap", tax: "Tax", a1: "1st apron", a2: "2nd apron" }[s]) + "</span></td>"; }).join("") + "</tr>";
    var html = tablePanel("Cap sheet", "<th>Player</th><th></th>" + cols.map(function (j) { return "<th>" + sname(j) + "</th>"; }).join(""), body,
      '<span class="o-po key">Player option</span> <span class="o-to key">Team option</span> <span class="o-ng key">Non-guaranteed</span> <span class="o-re key">Projected re-signing</span> <span class="o-rk key">Draft pick</span>');
    html += '<p class="note">Dead money: this season from Spotrac\'s team totals; later seasons only where Spotrac lists them. Draft picks show up starting the season after their draft (a 2027 pick is paid from 2027-28), at the slot each pick is projected to land, with the rookie scale for that slot. 2027 picks name the Big Board\'s player at that slot.' + (two.length ? " Two-way and 10-day deals (not on the cap sheet): " + two.map(function (p) { return esc(p.n); }).join(", ") + "." : "") + "</p>";
    return html;
  }
  function picksPanel(code) {
    var own = H.picksOf(code), owed = H.picksOwed(code), swaps = H.swapsOf(code);
    var row = function (pk, mine) {
      var info = H.pickInfo(pk);
      return "<tr><td>" + logo(pk.from, 16) + " " + esc(H.pickName(pk)) + "</td><td>" + (mine ? "" : logo(pk.owner === "OUT" ? pk.from : pk.owner, 16) + " " + esc(pk.owner === "OUT" ? "Forfeited" : team(pk.owner).short)) + "</td><td>" + f1(info.avg) + "</td><td>" + (pk.prot ? pct(info.conveys) : "") +
        "</td><td>" + money(H.pickValue(pk, "prod")) + "</td><td>" + money(H.pickValue(pk, "market")) + '</td><td class="note" style="text-align:left;white-space:normal">' + esc(pk.note || "") + "</td></tr>";
    };
    var head = "<th>Pick</th><th>To</th><th>Proj. slot</th><th>Conveys</th><th>Value</th><th>Market</th><th>Notes</th>";
    var sw = swaps.map(function (s) { return "<tr><td>" + logo(s.from, 16) + " " + s.y + " " + (s.r === 1 ? "1st" : "2nd") + " swap with " + esc(team(s.from).short) + "</td><td></td><td></td><td></td><td>" + money(H.swapValue(s, "prod")) + "</td><td>" + money(H.swapValue(s, "market")) + '</td><td class="note" style="text-align:left">' + esc(s.note || "Can swap its own pick for theirs if theirs lands higher") + "</td></tr>"; }).join("");
    return '<div>' + tablePanel("Draft picks owned", head, own.filter(function (pk) { return pk.r === 1 || pk.y <= 2029; }).map(function (pk) { return row(pk, true); }).join("") + sw, "Value: what that slot has produced. Market: what teams pay for it") +
      tablePanel("Own picks owed away", head, owed.map(function (pk) { return row(pk, false); }).join(""), "") + '<p class="note"><a href="#/picks">Every traded pick in the league, with protections</a></p></div>';
  }

  // ---------- player card ----------
  function openCard(id) {
    var p = H.W.P[id];
    if (!p) return;
    var s = H.surplus(p), sm = H.surplus(p, H.cfg.mode === "market" ? "prod" : "market"), t = team(p.t);
    var html = '<div class="card-h">' + face(p, 72) + "<div><h3>" + esc(p.n) + '</h3><div class="meta">' + logo(p.t, 18) + " " + esc(t.name) + " · " + esc(posOf(p)) +
      " · age " + (p.age != null ? p.age : "—") + " · " + (p.yos != null ? p.yos + " yrs in the league" : "") + "</div></div></div>";
    html += '<div class="card-b"><div class="kv">';
    html += kv(rt(H.rating(p, 0)), "Impact now") + kv(rt(H.rating(p, 2)), "In " + sname(2)) + kv(pct(p.h || 0.85), "Games played (health)");
    if (p.line) html += kv(f1(p.line.pts) + " / " + f1(p.line.reb) + " / " + f1(p.line.ast), "This season (" + p.line.gp + " gp)");
    if (p.darko != null) html += kv(rt(p.darko), "DARKO today");
    if (p.bpm != null) html += kv(rt(p.bpm), "BPM this season");
    html += "</div>";
    if (contractYears(p, 0).length) html += '<h4 class="card-sec">Contract</h4>' + contractStrip(p, 0);
    var vt = s.rows.reduce(function (a, r) { return a + r.value * Math.pow(1 + H.cfg.disc, -r.j); }, 0), ct = s.rows.reduce(function (a, r) { return a + r.sal * Math.pow(1 + H.cfg.disc, -r.j); }, 0);
    html += '<div class="vcs"><div><span>Value</span><b>' + money(vt) + "</b><small>" + (H.cfg.mode === "market" ? "what teams would pay him" : "what he should produce") + '</small></div><i>−</i><div><span>Contract</span><b>' + money(ct) +
      '</b><small>what he\'ll be paid</small></div><i>=</i><div class="' + (s.pv >= 0 ? "up" : "dn") + '"><span>Surplus</span><b>' + signed(s.pv) + "</b><small>" + s.rows.length + " season" + (s.rows.length === 1 ? "" : "s") + (H.cfg.disc > 0 ? ", discounted" : "") + "</small></div></div>";
    html += '<p class="tldr">' + (H.cfg.mode === "market" ? "Production view" : "Market view") + ": " + signed(sm.pv) + ". " + esc(p.note || "") + (p.form ? " This season's play has moved his rating " + rt(p.form) + "." : "") + "</p>";
    html += '<h4 class="card-sec">Contract value</h4><div class="scroll"><table class="t"><thead><tr><th>Season</th><th>Age</th><th>Impact</th><th>Value</th><th>Salary</th><th>Surplus</th></tr></thead><tbody>';
    s.rows.forEach(function (r) {
      html += "<tr><td>" + r.season + (r.opt ? ' <span class="pill">' + esc(r.opt) + "</span>" : "") + (r.part < 1 ? ' <span class="note">(rest of season)</span>' : "") + "</td><td>" + (p.age + r.j) + "</td><td>" + rchip(r.r) + "</td><td>" + money(r.value) + "</td><td>" + money(r.sal) + '</td><td class="' + (r.surplus >= 0 ? "pos" : "neg") + '">' + signed(r.surplus) + "</td></tr>";
    });
    html += '<tr class="tot"><td colspan="5">Discounted at ' + pct(H.cfg.disc) + ' a year</td><td class="' + (s.pv >= 0 ? "pos" : "neg") + '"><b>' + signed(s.pv) + "</b></td></tr>";
    html += "</tbody></table></div>";
    var ee = CBA.extEligible(p, 0);
    if (ee.ok) { var el = CBA.extLimit(p, 0); html += '<p class="note">Extension eligible now (' + esc(ee.kind) + "): up to " + money(el.first) + " in " + sname(el.start) + (el.maxYears ? ", " + el.maxYears + " years" : "") + ".</p>"; }
    var e = H.lastYear(p);
    if (e >= 0 && e < Hub.YEARS - 1) html += '<p class="note">Becomes a' + (H.faKind(p) === "RFA" ? " restricted" : "n unrestricted") + " free agent after " + sname(e) + ". Market estimate then: " + money(Mo.market(p, e + 1, H.W)) + " a year.</p>";
    html += '<p><button class="btn" data-add="a" data-id="' + esc(p.id) + '">Add to trade</button> <a class="btn" href="' + href("team/" + p.t) + '">' + esc(t.name) + "</a></p></div>";
    cardBody.innerHTML = html;
    if (!card.open) card.showModal();
  }
  function closeCard() { if (card.open) card.close(); }
  card.addEventListener("click", function (e) {
    if (e.target === card || e.target.closest("[data-close]")) { closeCard(); return; }
    var add = e.target.closest("[data-add]");
    if (add) {
      var tr = tradeState(), p = H.W.P[add.dataset.id];
      var side = tr.sides.indexOf(p.t);
      if (side < 0) {
        side = tr.sides.findIndex(function (c) { return !c; });
        if (side < 0) side = tr.sides.length < 5 ? tr.sides.length : 0;
        tr.assets = tr.assets.filter(function (a) { return a.from !== side; });
        tr.sides[side] = p.t;
      }
      if (!tr.assets.some(function (a) { return a.id === p.id; })) tr.assets.push({ kind: "p", id: p.id, from: side, to: -1 });
      closeCard();
      location.hash = tradeHash(tr);
    }
  });

  // ---------- trade value ----------
  function controls(extra) {
    return '<div class="controls">' +
      '<label title="Production: what he should produce, priced off the cap. Market: what teams would pay him (the market model, capped at the max)">Value as<select data-cfg="mode"><option value="prod"' + (H.cfg.mode !== "market" ? " selected" : "") + '>Production</option><option value="market"' + (H.cfg.mode === "market" ? " selected" : "") + ">Market price</option></select></label>" +
      '<label title="Each later season counts this much less. 7% matches the cap\'s growth, so values read in today\'s cap dollars">Discount %<input type="number" step="1" min="0" max="20" data-cfg="disc" value="' + (H.cfg.disc * 100).toFixed(0) + '"></label>' +
      '<label title="How much more a star\'s impact is worth than the same impact spread across role players. 1.0 is linear (minutes times impact); higher favors stars">Star premium<select data-cfg="convex">' + [1, 1.25, 1.5, 1.75, 2].map(function (v) { return '<option value="' + v + '"' + (H.cfg.convex === v ? " selected" : "") + ">" + v.toFixed(2) + "</option>"; }).join("") + "</select></label>" +
      '<label title="Share of a young player\'s projected improvement that counts in his value">Growth counted<select data-cfg="growth">' + [0, 0.25, 0.5, 0.75, 1].map(function (v) { return '<option value="' + v + '"' + (H.cfg.growth === v ? " selected" : "") + ">" + (v * 100) + "%</option>"; }).join("") + "</select></label>" + (extra || "") + "</div>";
  }
  view.addEventListener("change", function (e) {
    var c = e.target.closest("[data-cfg]");
    if (!c) return;
    var k = c.dataset.cfg, v = k === "mode" ? c.value : k === "convex" || k === "growth" ? +c.value : +c.value / 100;
    if (k !== "mode" && isNaN(v)) return;
    H.set(k, v); save(k, v);
    render();
  });
  view.addEventListener("change", function (e) {
    var c = e.target.closest("[data-q]");
    if (!c) return;
    var q = Object.assign({}, state.q);
    q[c.dataset.q] = c.value || null;
    location.hash = href(state.route, q);
  });
  function teamSelect(cur, key) {
    return '<label>Team<select data-q="' + (key || "t") + '"><option value="">All teams</option>' + H.codes.slice().sort(function (a, b) { return team(a).name.localeCompare(team(b).name); }).map(function (c) { return '<option value="' + c + '"' + (c === cur ? " selected" : "") + ">" + esc(team(c).name) + "</option>"; }).join("") + "</select></label>";
  }
  function valuePage() {
    var q = state.q, kind = q.k || "players", tm = q.t || "", worst = q.sort === "worst";
    var opt = function (v, l, cur) { return '<option value="' + v + '"' + (v === cur ? " selected" : "") + ">" + l + "</option>"; };
    var html = '<h2 class="sec">Trade Value</h2><p class="lede">' + (H.cfg.mode === "market"
      ? "Value is what teams would pay each player on the open market (the market model behind Banner 19, fit to current veteran contracts and capped at the max). "
      : "Value is what each player should produce over the rest of his contract: minutes times impact above replacement, with a premium for star impact, priced at what teams pay for production on the open market. ") +
      "Contract is what he'll be paid. Surplus is the difference, in real dollars (set a discount to see today's cap dollars). Picks are valued by what their projected slot has produced in past drafts, or in the market view, by what teams pay for them. The star premium and growth settings change the whole board; How it works explains them.</p>";
    html += controls(teamSelect(tm) + '<label>Show<select data-q="k">' + opt("players", "Players", kind) + opt("picks", "Draft picks", kind) + "</select></label>" +
      (kind === "players" ? '<label>Sort<select data-q="sort">' + opt("", "Most surplus", q.sort || "") + opt("worst", "Worst contracts", q.sort || "") + "</select></label>" +
        '<label>Search<input type="search" data-q="s" value="' + esc(q.s || "") + '" placeholder="Player"></label>' : ""));
    if (kind === "picks") {
      var picks = H.W.picks.filter(function (pk) { return pk.owner !== "OUT" && (!tm || pk.owner === tm) && (pk.r === 1 || pk.y <= 2028); })
        .map(function (pk) { return { pk: pk, v: H.pickValue(pk) }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 150);
      html += tablePanel("Draft picks", "<th>Pick</th><th>Owner</th><th>Proj. slot</th><th>Conveys</th><th>Value</th><th>Notes</th>", picks.map(function (x, k) {
        var info = H.pickInfo(x.pk);
        return "<tr><td>" + (k + 1) + ". " + logo(x.pk.from, 16) + " " + esc(H.pickName(x.pk)) + "</td><td>" + logo(x.pk.owner, 16) + " " + esc(team(x.pk.owner).short) + "</td><td>" + f1(info.avg) + "</td><td>" + (x.pk.prot ? pct(info.conveys) : "") + "</td><td><b>" + money(x.v) + '</b></td><td class="note" style="text-align:left;white-space:normal">' + esc(x.pk.note || "") + "</td></tr>";
      }).join(""), "Second-rounders after 2028 left off");
      view.innerHTML = html;
      return;
    }
    var list = H.valueBoard().filter(function (x) {
      if (tm && x.p.t !== tm) return false;
      if (q.s && x.p.n.toLowerCase().indexOf(q.s.toLowerCase()) < 0) return false;
      return true;
    });
    if (worst) list = list.slice().reverse();
    list = list.slice(0, 150);
    html += '<div class="panel"><div class="scroll"><table class="t"><thead><tr><th>Player</th><th>Team</th><th>Pos</th><th>Age</th><th>Impact</th><th>Thru</th><th>Value</th><th>Contract</th><th>Surplus</th></tr></thead><tbody>';
    list.forEach(function (x, k) {
      var p = x.p, s = x.s, v = s.rows.reduce(function (a, r) { return a + r.value * Math.pow(1 + H.cfg.disc, -r.j); }, 0), c = s.rows.reduce(function (a, r) { return a + r.sal * Math.pow(1 + H.cfg.disc, -r.j); }, 0);
      var last = s.rows.length ? s.rows[s.rows.length - 1].season : "—";
      html += "<tr><td>" + (k + 1) + ". " + pname(p, 22) + "</td><td>" + logo(p.t, 18) + "</td><td>" + esc(posOf(p)) + "</td><td>" + p.age + "</td><td>" + rchip(H.rating(p, 0)) + "</td><td>" + esc(last) + "</td><td>" + money(v) + "</td><td>" + money(c) +
        '</td><td class="' + (s.pv >= 0 ? "pos" : "neg") + '"><b>' + signed(s.pv) + "</b></td></tr>";
    });
    html += "</tbody></table></div></div>";
    view.innerHTML = html;
  }

  // ---------- trade builder ----------
  // A trade lives in the address bar: ta..te are the teams (up to five); a..e what each sends:
  // "p:jayson-tatum", "k:2028-1-BOS" or "c:2500000" (cash), with "~c" when it goes somewhere other than the next team.
  var L5 = "abcde";
  function tradeHash(tr) {
    var q = {};
    tr.sides.forEach(function (c, k) { if (c) q["t" + L5[k]] = c; });
    tr.sides.forEach(function (c, k) {
      var mine = tr.assets.filter(function (a) { return a.from === k; });
      if (mine.length) q[L5[k]] = mine.map(function (a) { return a.kind + ":" + a.id + (a.to >= 0 && a.to !== a.from ? "~" + L5[a.to] : ""); }).join(",");
    });
    if (tr.sides.length > 2) q.n = tr.sides.length;
    if (state.q.find) q.find = state.q.find;
    save("trade", q);
    return href("trade", q);
  }
  function tradeState() {
    var q = state.route === "trade" ? state.q : {};
    if (!q.ta && !q.tb && !q.a && !q.b) q = load("trade", {}) || {};
    var n = Math.max(2, +q.n || 0), tr = { sides: [], assets: [] };
    for (var k = 0; k < 5; k++) if (q["t" + L5[k]] || q[L5[k]]) n = Math.max(n, k + 1);
    for (k = 0; k < n; k++) tr.sides.push(H.teams[q["t" + L5[k]]] ? q["t" + L5[k]] : null);
    for (k = 0; k < n; k++) (q[L5[k]] || "").split(",").filter(Boolean).forEach(function (s) {
      var m = /^([pkc]):([^~]+)(?:~([a-e]))?$/.exec(s);
      if (!m) return;
      if (m[1] === "p" && !H.W.P[m[2]]) return;
      if (m[1] === "k" && !H.W.picks.find(function (x) { return x.id === m[2]; })) return;
      tr.assets.push({ kind: m[1], id: m[2], from: k, to: m[3] ? L5.indexOf(m[3]) : -1 });
    });
    return tr;
  }
  function destOf(tr, a) { return a.to >= 0 && a.to !== a.from && a.to < tr.sides.length ? a.to : (a.from + 1) % tr.sides.length; }
  function pickOf(id) { return H.W.picks.find(function (x) { return x.id === id; }); }
  // Salary matching at a glance: what comes in against what the rules let this team take back
  function gauge(r) {
    if (!r.inSal && !r.outSal) return "";
    var room = r.P2 <= CBA.cap(0), max = room ? null : r.outSal > 0 ? H.matchMax(r.outSal, r.post) : 0;
    var top = Math.max(r.inSal, max || 0, 1) * 1.08, ok = room || r.inSal <= (max || 0) + 1;
    return '<div class="gauge ' + (ok ? "ok" : "bad") + '"><div class="gbar"><b style="width:' + (r.inSal / top * 100).toFixed(1) + '%"></b>' + (max != null ? '<i style="left:' + (max / top * 100).toFixed(1) + '%" title="Most it can take back"></i>' : "") + "</div><small>" +
      (room ? "Takes back " + money(r.inSal) + " into cap room" : "Takes back <b>" + money(r.inSal) + "</b> of " + money(max) + " allowed" + (ok ? "" : ": " + money(r.inSal - max) + " too much")) + "</small></div>";
  }
  // When a deal fails, look for the one roster player a team could add (or take off) that makes it legal
  function fixes(tr, chk) {
    var out = [], fail = tr.sides.filter(function (c) { return !chk.teams[c].ok; });
    var base = tr.assets.map(function (a) { return { kind: a.kind, id: a.id, amt: a.kind === "c" ? +a.id : 0, from: tr.sides[a.from], to: tr.sides[destOf(tr, a)] }; });
    var used = {}; tr.assets.forEach(function (a) { used[a.kind + ":" + a.id] = 1; });
    var tries = 0;
    tr.sides.forEach(function (c, k) {
      if (out.length >= 4) return;
      // a failing team sends more salary, or a partner sends filler to a team under its limit
      var partner = tr.sides.map(function (x, j) { return j; }).filter(function (j) { return j !== k; })
        .sort(function (a, b) { return (fail.indexOf(tr.sides[b]) >= 0) - (fail.indexOf(tr.sides[a]) >= 0); })[0];
      var pool = Object.values(H.W.P).filter(function (p) { return p.t === c && !p.two && H.salary(p, 0) > 0 && !used["p:" + p.id]; }).sort(function (a, b) { return H.salary(a, 0) - H.salary(b, 0); });
      for (var n = 0; n < pool.length && tries < 40 && out.length < 4; n++) {
        tries++;
        var mv = base.concat([{ kind: "p", id: pool[n].id, amt: 0, from: c, to: tr.sides[partner] }]);
        var t = H.checkTrade({ teams: tr.sides, moves: mv });
        if (t.ok) out.push({ p: pool[n], k: k, to: partner });
      }
    });
    if (!out.length) return "";
    return '<div class="fixes"><b>Ways to make it work</b>' + out.map(function (f) {
      return '<button type="button" class="fixbtn" data-pick="p:' + esc(f.p.id) + '" data-side="' + f.k + '" data-to="' + f.to + '">' + logo(tr.sides[f.k], 16) + " " + esc(team(tr.sides[f.k]).short) + " add " + esc(f.p.n) + " (" + money(H.salary(f.p, 0)) + ")</button>";
    }).join("") + "</div>";
  }
  function assetLine(a, tr, k, outgoing) {
    var to = destOf(tr, a), right = "", sub = "", label;
    if (a.kind === "p") {
      var p = H.W.P[a.id], last = H.lastYear(p), left = 0;
      for (var j = 0; j <= last; j++) left += H.salary(p, j);
      label = pname(p, 30);
      sub = esc(posOf(p)) + " · " + p.age + " · thru " + sname(last) + (p.c.opt && Object.keys(p.c.opt).length ? " (" + Object.keys(p.c.opt).map(function (j) { return p.c.opt[j] + " " + sname(+j).slice(2); }).join(", ") + ")" : "") + " · " + money(left) + " total";
      var kick = outgoing ? 0 : H.kicker(p);
      right = '<b class="sal">' + money(H.salary(p, 0) + kick) + "</b>";
      sub = esc(posOf(p)) + " · age " + p.age + " · " + rt(H.rating(p, 0)) + " impact · then " + esc(H.faKind(p)) + '<span class="minis">' + contractYears(p, 0).map(function (y) {
        return '<span class="mini' + (y.opt ? " o-" + y.opt : "") + '"><i>' + sname(y.j).slice(2) + (y.opt ? " " + CBA.OPT_SHORT[y.opt] : "") + "</i>" + money(y.sal) + "</span>";
      }).join("") + "</span>";
      if (kick) sub += ' · <span class="pill warn">includes ' + money(kick) + " trade kicker</span>";
    } else if (a.kind === "k") {
      var pk = pickOf(a.id);
      label = '<span class="pl static">' + logo(pk.from, 26) + '<span class="nm">' + esc(H.pickName(pk)) + "</span></span>";
      sub = "Projected slot " + f1(H.pickInfo(pk).avg) + (pk.note ? " · " + esc(pk.note) : "");
      right = '<b class="sal pick">Pick</b>';
    } else {
      label = '<span class="pl static"><span class="cashicon">$</span><span class="nm">Cash</span></span>';
      sub = "Counts against the " + money(CBA.cashLimit(0)) + " a season each team can send and receive";
      right = '<b class="sal">' + money(+a.id) + "</b>";
    }
    var dest = outgoing && tr.sides.length > 2 ? '<select class="dest" data-dest="' + esc(a.kind + ":" + a.id) + '" aria-label="Sends to">' + tr.sides.map(function (c, j) { return j === k ? "" : '<option value="' + j + '"' + (j === to ? " selected" : "") + ">To " + esc(c ? team(c).short : "team " + (j + 1)) + "</option>"; }).join("") + "</select>" : "";
    var from = !outgoing ? '<span class="fromtag">' + logo(tr.sides[a.from], 14) + " from " + esc(team(tr.sides[a.from]).short) + "</span>" : "";
    return '<li class="asset">' + label + right + '<div class="asub">' + sub + from + "</div>" + (outgoing ? '<div class="aact">' + dest + '<button class="xbtn" data-rm="' + esc(a.kind + ":" + a.id) + '" aria-label="Remove">×</button></div>' : "") + "</li>";
  }
  function tradePage() {
    var tr = tradeState(), n = tr.sides.length, ready = tr.sides.every(Boolean);
    var opts = function (cur, taken) {
      return '<option value="">Pick a team</option>' + H.codes.slice().sort(function (a, b) { return team(a).name.localeCompare(team(b).name); }).filter(function (c) { return c === cur || taken.indexOf(c) < 0; }).map(function (c) { return '<option value="' + c + '"' + (c === cur ? " selected" : "") + ">" + esc(team(c).name) + "</option>"; }).join("");
    };
    var moves = ready ? tr.assets.map(function (a) { return { kind: a.kind, id: a.id, amt: a.kind === "c" ? +a.id : 0, from: tr.sides[a.from], to: tr.sides[destOf(tr, a)] }; }) : [];
    var chk = ready && moves.length ? H.checkTrade({ teams: tr.sides, moves: moves }) : null;
    var sum = chk ? H.tradeSummary({ teams: tr.sides, moves: moves }) : null;
    var html = '<h2 class="sec">Trade Builder</h2><p class="lede">Up to five teams. Add players, picks or cash from each roster; every deal is checked against the 2023 CBA as it stands in ' + sname(0) + ": salary matching by apron tier, trade exceptions, hard caps, cash limits, roster limits and the Stepien rule.</p>";
    html += finderPanel();
    var warns = ready && moves.length ? H.tradeWarnings({ teams: tr.sides, moves: moves }) : [];
    if (warns.length) html += '<div class="tbanner warnb"><b>Heads up</b><span>' + warns.map(esc).join("<br>") + "</span></div>";
    if (chk) html += '<div class="tbanner ' + (chk.ok ? "ok" : "bad") + '"><b>' + (chk.ok ? "Trade works" : "Trade doesn't work") + "</b><span>" + (chk.ok ? "Every team passes the cap rules." : tr.sides.filter(function (c) { return !chk.teams[c].ok; }).map(function (c) { return esc(team(c).short); }).join(" and ") + " fail" + (tr.sides.filter(function (c) { return !chk.teams[c].ok; }).length === 1 ? "s" : "") + " the cap rules (details below).") + '</span><button class="btn" data-copy>Copy link</button></div>';
    if (chk && !chk.ok) html += fixes(tr, chk);
    html += '<div class="tcols n' + n + '">';
    tr.sides.forEach(function (code, k) {
      var mine = tr.assets.filter(function (a) { return a.from === k; });
      var inc = tr.assets.filter(function (a) { return destOf(tr, a) === k && a.from !== k; });
      var r = chk && code ? chk.teams[code] : null;
      var head = '<div class="tc-h" style="--tc:' + (code ? team(code).color : "var(--rule)") + '">' + (code ? logo(code, 34) : "") + '<select data-tside="' + k + '" aria-label="Team ' + (k + 1) + '">' + opts(code, tr.sides) + "</select>" + (n > 2 ? '<button class="xbtn" data-dropteam="' + k + '" aria-label="Remove team">×</button>' : "") + "</div>";
      var money0 = "";
      if (code) {
        var before = H.payroll(code, 0), after = r ? r.P2 : before, sb = CBA.status(before, 0), sa = CBA.status(after, 0);
        var nm = { room: "Room", over: "Over cap", tax: "Tax", a1: "1st apron", a2: "2nd apron" };
        var rep = H.tools(code, 0).rep, tb0 = CBA.taxBill(before, 0, rep), tb1 = CBA.taxBill(after, 0, rep);
        money0 = '<div class="tc-pay"><div><span>Payroll</span><b>' + money(before) + (r ? ' <i>→</i> ' + money(after) : "") + '</b></div><div><span>Position</span><b><span class="pill ' + (sb === "a1" || sb === "a2" ? "fill" : "") + '">' + nm[sb] + "</span>" + (r && sa !== sb ? ' <i>→</i> <span class="pill ' + (sa === "a1" || sa === "a2" ? "fill" : "") + '">' + nm[sa] + "</span>" : "") + "</b></div>" +
          '<div><span>Tax bill' + (rep ? " (repeater)" : "") + "</span><b>" + (tb0 ? money(tb0) : "None") + (r && tb1 !== tb0 ? ' <i>→</i> ' + (tb1 ? money(tb1) : "None") : "") + "</b></div>" +
          '<div><span>To the tax line</span><b>' + (CBA.tax(0) - after >= 0 ? money(CBA.tax(0) - after) + " under" : money(after - CBA.tax(0)) + " over") + "</b></div></div>" + (r ? gauge(r) : "");
      }
      var outSal = mine.reduce(function (a, x) { return a + (x.kind === "p" ? H.salary(H.W.P[x.id], 0) : 0); }, 0);
      var inSal = inc.reduce(function (a, x) { return a + (x.kind === "p" ? H.salary(H.W.P[x.id], 0) + H.kicker(H.W.P[x.id]) : 0); }, 0);
      html += '<div class="tc">' + head + money0 +
        '<div class="tc-sec"><h4>Sends <span>' + money(outSal) + '</span></h4><ul class="assets">' + (mine.length ? mine.map(function (a) { return assetLine(a, tr, k, true); }).join("") : '<li class="note">Nothing yet. Add from the roster below.</li>') + "</ul></div>" +
        '<div class="tc-sec in"><h4>Receives <span>' + money(inSal) + '</span></h4><ul class="assets">' + (inc.length ? inc.map(function (a) { return assetLine(a, tr, k, false); }).join("") : '<li class="note">Nothing yet.</li>') + "</ul></div>" +
        (code ? assetPicker(code, k, tr) : "") + "</div>";
    });
    html += "</div>";
    html += '<p class="tbtns">' + (n < 5 ? '<button class="btn" data-addteam>+ Add a team</button> ' : "") + '<button class="btn" data-clear>Clear the trade</button></p>';
    if (chk) html += matchTable(tr, chk) + valueTable(tr, sum);
    view.innerHTML = html;
  }
  view.addEventListener("input", function (e) {
    var f = e.target.closest("[data-rfilter]");
    if (!f) return;
    var v = f.value.trim().toLowerCase();
    f.closest("details").querySelectorAll(".org-row[data-name]").forEach(function (b) { b.hidden = v && b.dataset.name.indexOf(v) < 0; });
  });
  // Trade finder: pick a player, get legal deals from around the league
  function finderPanel() {
    var q = state.q, target = q.find && H.W.P[q.find] ? H.W.P[q.find] : null;
    var all = H.players().slice().sort(function (a, b) { return a.n.localeCompare(b.n); });
    var html = '<details class="panel finder"' + (target ? " open" : "") + '><summary><h3 style="display:inline">Trade finder <small>pick a player, get legal deals from every other team</small></h3></summary>' +
      '<div class="controls"><label>Player<input list="fplayers" data-find value="' + esc(target ? target.n : "") + '" placeholder="Type a name"></label><datalist id="fplayers">' + all.map(function (p) { return '<option value="' + esc(p.n) + '">' + esc(team(p.t).short) + "</option>"; }).join("") + "</datalist></div>";
    if (target) {
      var res = H.findTrades(target.id);
      html += res.length ? '<ul class="rlist">' + res.map(function (r) {
        var get = r.moves.filter(function (m) { return m.to === target.t; }), give = r.moves.filter(function (m) { return m.from === target.t && m.id !== target.id; });
        var nm = function (m) { return m.kind === "p" ? esc(H.W.P[m.id].n) + " (" + money(H.salary(H.W.P[m.id], 0)) + ")" : esc(H.pickName(pickOf(m.id))); };
        var hq = { ta: target.t, tb: r.team, a: r.moves.filter(function (m) { return m.from === target.t; }).map(function (m) { return m.kind + ":" + m.id; }).join(","), b: r.moves.filter(function (m) { return m.from === r.team; }).map(function (m) { return m.kind + ":" + m.id; }).join(","), find: target.id };
        return "<li>" + logo(r.team, 24) + '<span class="grow"><b>' + esc(team(r.team).short) + "</b> send " + get.map(nm).join(", ") + (give.length ? '; <span class="note">' + esc(team(target.t).short) + " adds " + give.map(nm).join(", ") + "</span>" : "") + '</span><span class="sub">' + (Math.abs(r.gap) < 1e6 ? "even" : (r.gap > 0 ? esc(team(target.t).short) : esc(team(r.team).short)) + " +" + money(Math.abs(r.gap))) + '</span><a class="btn" href="' + href("trade", hq) + '">Load</a></li>';
      }).join("") + "</ul>" : '<p class="note">No legal deal within reach of even. Try the market view or a different discount.</p>';
      html += '<p class="note">Packages of one to three players that make the salaries work for both teams, evened up with draft picks from whichever side gets less, checked against every cap rule. Balanced on ' + (H.cfg.mode === "market" ? "market" : "production") + " surplus.</p>";
    }
    return html + "</details>";
  }
  view.addEventListener("change", function (e) {
    var f = e.target.closest("[data-find]");
    if (!f) return;
    var p = H.players().find(function (x) { return x.n.toLowerCase() === f.value.trim().toLowerCase(); });
    if (!p) return;
    var q = Object.assign({}, state.route === "trade" ? state.q : {}, { find: p.id });
    location.hash = href("trade", q);
  });
  // The salary math, team by team: what goes out, what comes back, what the rules allow, and how it gets done
  function matchTable(tr, chk) {
    var nm = { room: "Under the cap", over: "Over the cap", tax: "In the tax", a1: "Over the 1st apron", a2: "Over the 2nd apron" };
    var rows = tr.sides.map(function (c) {
      var r = chk.teams[c], sol = r.sol || {}, how = [];
      if (sol.room) how.push("Absorbs it in cap room");
      (sol.subs || []).forEach(function (sb) {
        if (sb.tpe) how.push("Uses its " + money(sb.tpeAmt) + " trade exception for " + sb.in.map(function (id) { return esc(H.W.P[id].n); }).join(", "));
        else if (sb.agg) how.push("Combines " + sb.out.map(function (id) { return esc(H.W.P[id].n); }).join(" + ") + " (" + money(sb.outSal) + ") to take back " + money(sb.inSal));
        else how.push(sb.out.map(function (id) { return esc(H.W.P[id].n); }).join("") + " (" + money(sb.outSal) + ") for " + sb.in.map(function (id) { return esc(H.W.P[id].n); }).join(", ") + " (" + money(sb.inSal) + ")");
      });
      (sol.newTpes || []).filter(function (x) { return x.amt >= 250000; }).forEach(function (x) { how.push("Creates a " + money(x.amt) + " trade exception (" + esc((H.W.P[x.from] || {}).n || x.from) + ")"); });
      if (r.newHard) how.push("Hard-caps them at the " + esc(CBA.LEVEL_NAME[r.newHard]));
      var max = r.outSal > 0 ? H.matchMax(r.outSal, r.post) : null;
      return "<tr><td class=\"tm\">" + logo(c) + '<span class="nm">' + esc(team(c).short) + "</span></td><td>" + money(r.outSal) + "</td><td>" + money(r.inSal) + "</td><td>" + (r.P2 <= CBA.cap(0) ? "Any (room)" : max != null ? money(max) + ' <span class="note">' + esc(H.matchRule(r.outSal, r.post)) + "</span>" : "—") + "</td><td>" + esc(nm[r.post]) + "</td><td>" + (r.ok ? '<span class="pill up">Works</span>' : '<span class="pill fill">Fails</span>') + '</td><td class="how">' + (how.length ? how.join("<br>") : "—") + (r.msgs.length ? '<ul class="msgs">' + r.msgs.map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") + "</ul>" : "") + "</td></tr>";
    }).join("");
    return tablePanel("Salary matching", "<th>Team</th><th>Out</th><th>In</th><th>Can take back</th><th>After the trade</th><th></th><th>How it's done</th>", rows, "This season's salaries, trade kickers included");
  }
  function valueTable(tr, sum) {
    return tablePanel("What each team gets", "<th>Team</th><th>Surplus (production)</th><th>Surplus (market)</th><th>Wins this season</th>", tr.sides.map(function (c) {
      var s = sum[c];
      return '<tr><td class="tm">' + logo(c) + '<span class="nm">' + esc(team(c).short) + '</span></td><td class="' + (s.prod >= 0 ? "pos" : "neg") + '"><b>' + signed(s.prod) + '</b></td><td class="' + (s.market >= 0 ? "pos" : "neg") + '">' + signed(s.market) + "</td><td>" + f1(s.winsBefore) + " → <b>" + f1(s.winsAfter) + "</b></td></tr>";
    }).join(""), "Positive: takes in more value than it gives up");
  }
  // A team's roster (by salary), its tradable picks and cash
  function assetPicker(code, k, tr) {
    var on = {};
    tr.assets.forEach(function (a) { on[a.kind + ":" + a.id] = 1; });
    var ps = Object.values(H.W.P).filter(function (p) { return p.t === code && !p.two && H.salary(p, 0) > 0 && !on["p:" + p.id]; })
      .sort(function (a, b) { return H.salary(b, 0) - H.salary(a, 0); });
    var pks = H.picksOf(code).filter(function (pk) { return !on["k:" + pk.id] && !pk.locked && (pk.r === 1 || pk.y <= 2029); });
    var tpes = H.W.T[code].tpes;
    var dec15 = H.asOf < "2026-12-15";
    return '<details class="org" open><summary>Roster</summary><input class="rfilter" type="search" placeholder="Filter by name" data-rfilter="' + k + '"><div class="rhead"><span>Player</span><span>' + sname(0) + "</span><span>Thru</span></div>" + ps.map(function (p) {
      var locked = dec15 && p.c && p.c.signed === 0 && !(p.c.rk && p.c.rk[1] > 0);
      return '<button type="button" class="org-row' + (locked ? " locked" : "") + '" data-pick="p:' + esc(p.id) + '" data-side="' + k + '" data-name="' + esc(p.n.toLowerCase()) + '"' + (locked ? ' title="Signed this offseason: can\'t be traded until Dec. 15"' : "") + ">" + face(p, 22) + '<span class="grow">' + esc(p.n) + ' <span class="note">' + esc(posOf(p)) + "</span>" + (locked ? ' <span class="pill warn">Dec 15</span>' : "") + '</span><b class="sal">' + money(H.salary(p, 0)) + '</b><span class="thru">' + sname(H.lastYear(p)).slice(2) + "</span></button>";
    }).join("") + "</details>" +
      '<details class="org"><summary>Draft picks</summary>' + pks.map(function (pk) {
        return '<button type="button" class="org-row" data-pick="k:' + esc(pk.id) + '" data-side="' + k + '">' + logo(pk.from, 18) + '<span class="grow">' + esc(H.pickName(pk)) + '</span><span class="note">slot ' + f1(H.pickInfo(pk).avg) + "</span></button>";
      }).join("") + "</details>" +
      '<details class="org"><summary>Cash and exceptions</summary><div class="cashrow"><input type="number" min="0.1" max="' + (CBA.cashLimit(0) / 1e6).toFixed(1) + '" step="0.5" placeholder="$M" data-cashamt="' + k + '"><button class="btn" data-addcash="' + k + '">Add cash</button></div>' +
      (tpes.length ? '<p class="note">Trade exceptions (used automatically when they help):</p><ul class="tpes">' + tpes.map(function (x) { return "<li>" + money(x.amt) + " · " + esc(x.from) + ' <span class="note">expires ' + esc(x.exp) + "</span></li>"; }).join("") + "</ul>" : '<p class="note">No trade exceptions.</p>') + "</details>";
  }
  view.addEventListener("change", function (e) {
    var sel = e.target.closest("select[data-tside]"), dest = e.target.closest("select[data-dest]");
    if (!sel && !dest) return;
    var tr = tradeState();
    if (sel) {
      var k = +sel.dataset.tside;
      tr.sides[k] = sel.value || null;
      tr.assets = tr.assets.filter(function (a) { return a.from !== k; });
    } else {
      var a = tr.assets.find(function (x) { return x.kind + ":" + x.id === dest.dataset.dest; });
      if (a) a.to = +dest.value;
    }
    location.hash = tradeHash(tr);
  });
  view.addEventListener("click", function (e) {
    var pick = e.target.closest("[data-pick]"), rm = e.target.closest("[data-rm]"), clear = e.target.closest("[data-clear]"), add = e.target.closest("[data-addteam]"),
      drop = e.target.closest("[data-dropteam]"), cash = e.target.closest("[data-addcash]"), copy = e.target.closest("[data-copy]");
    if (!pick && !rm && !clear && !add && !drop && !cash && !copy) return;
    e.stopPropagation();
    if (copy) { try { navigator.clipboard.writeText(location.href); copy.textContent = "Link copied"; } catch (x) { /* no clipboard */ } return; }
    var tr = tradeState();
    if (clear) tr = { sides: [null, null], assets: [] };
    if (add && tr.sides.length < 5) tr.sides.push(null);
    if (drop) {
      var d = +drop.dataset.dropteam;
      tr.assets = tr.assets.filter(function (a) { return a.from !== d; }).map(function (a) { return Object.assign({}, a, { from: a.from > d ? a.from - 1 : a.from, to: a.to === d ? -1 : a.to > d ? a.to - 1 : a.to }); });
      tr.sides.splice(d, 1);
    }
    if (pick) {
      var m = pick.dataset.pick.split(":"), kind = m[0], id = m.slice(1).join(":");
      tr.assets = tr.assets.filter(function (a) { return !(a.kind === kind && a.id === id); });
      tr.assets.push({ kind: kind, id: id, from: +pick.dataset.side, to: pick.dataset.to != null ? +pick.dataset.to : -1 });
    }
    if (cash) {
      var k = +cash.dataset.addcash, inp = view.querySelector('[data-cashamt="' + k + '"]'), v = Math.round((+inp.value || 0) * 1e6);
      if (v > 0) { tr.assets = tr.assets.filter(function (a) { return !(a.kind === "c" && a.from === k); }); tr.assets.push({ kind: "c", id: String(Math.min(v, CBA.cashLimit(0))), from: k, to: -1 }); }
    }
    if (rm) tr.assets = tr.assets.filter(function (a) { return a.kind + ":" + a.id !== rm.dataset.rm; });
    location.hash = tradeHash(tr);
  }, true);

  // ---------- free agents ----------
  function faPage() {
    var q = state.q, yr = Math.min(Hub.YEARS - 1, Math.max(1, +q.yr || 1)), fa = H.faClass(yr), cap = H.capOutlook(yr), prem = H.premium();
    var yopts = ""; for (var j = 1; j < Hub.YEARS; j++) yopts += '<option value="' + j + '"' + (j === yr ? " selected" : "") + ">Summer " + (2026 + j) + " (" + sname(j) + ")</option>";
    var html = '<h2 class="sec">Free Agents</h2><p class="lede">Everyone whose contract ends before the season you pick, with options called the way the model expects. Fair value is what he should produce per year over the deal the market would give him; the market estimate is what teams would actually pay. Restricted free agents can be matched by their own team. Later summers are rougher: trades, extensions and re-signings between now and then aren\'t known.</p>';
    html += controls('<label>Class<select data-q="yr">' + yopts + "</select></label>" + teamSelect(q.t || ""));
    var list = fa.filter(function (x) { return !q.t || x.team === q.t; }).slice(0, 120);
    html += tablePanel("The " + (2026 + yr) + " class", "<th>Player</th><th>Team</th><th>Age</th><th>Type</th><th>Impact</th><th>Years</th><th>Fair value</th><th>Market</th><th>Gap</th>", list.map(function (x, k) {
      var gap = x.fair - x.market;
      return "<tr><td>" + (k + 1) + ". " + pname(x.p, 22, x.opt ? ' <span class="pill" title="Projected to decline his ' + esc(CBA.OPT_NAME[x.opt].toLowerCase()) + '">' + esc(x.opt) + " out</span>" : "") + "</td><td>" + logo(x.team, 18) + "</td><td>" + x.age + "</td><td>" + (x.kind === "RFA" ? '<span class="pill up">RFA</span>' : '<span class="pill">UFA</span>') + "</td><td>" + rchip(x.r) + "</td><td>" + x.yrs + "</td><td>" + money(x.fair) + "</td><td><b>" + money(x.market) + '</b></td><td class="' + (gap >= 0 ? "pos" : "neg") + '">' + signed(gap) + "</td></tr>";
    }).join(""), "Gap: positive means a bargain at the market price");
    html += tablePanel("Who can spend in " + sname(yr), "<th>Team</th><th>Committed</th><th>Room (renounce all)</th><th>Cap holds</th><th>Room with holds</th><th>Players</th><th>Best tool</th>", cap.map(function (c) {
      var hl = c.holdList.slice().sort(function (a, b) { return b.amt - a.amt; }).slice(0, 4).map(function (h) { return esc(h.n) + " " + money(h.amt); }).join(", ");
      return '<tr class="go" data-team="' + c.code + '"><td class="tm">' + logo(c.code) + '<span class="nm">' + esc(team(c.code).name) + "</span></td><td>" + money(c.committed) + '</td><td class="' + (c.room > 0 ? "pos" : "neg") + '">' + (c.room > 0 ? money(c.room) : "—") + '</td><td title="' + hl + '">' + (c.holds ? money(c.holds) : "—") + '</td><td class="' + (c.roomHolds > 0 ? "pos" : "neg") + '">' + (c.roomHolds > 0 ? money(c.roomHolds) : "—") + "</td><td>" + c.n + "</td><td>" + esc(c.tool) + "</td></tr>";
    }).join(""), "Against a " + money(CBA.cap(yr)) + " cap. Holds: free agents a team keeps rights to (hover for the biggest); renouncing them frees the room");
    html += '<div class="panel"><h3>What contracts cost against what they buy <small>Every veteran contract on the books now</small></h3><div class="prem">' +
      prem.groups.filter(function (g) { return g.n >= 5; }).map(function (g) {
        var d = g.ratio - 1;
        return '<div><span>' + esc(g.label) + '</span><b class="' + (d <= 0 ? "pos" : "neg") + '">' + (d >= 0 ? "+" : "") + pct(d) + "</b><small>" + g.n + " deals</small></div>";
      }).join("") + '</div><p class="note">Median salary against production value this season: +30% means teams pay 30% more than the production is worth. Rookie-scale and minimum deals are left out, since the league sets those.</p></div>';
    view.innerHTML = html;
  }

  // ---------- how it works ----------
  function methodPage() {
    var pk = H.curve;
    var html = '<h2 class="sec">How it works</h2><div class="method">' +
      "<h3>The league today</h3><p>Built fresh every time the page opens, from feeds the site already refreshes every day: contracts from Basketball-Reference and rosters, injuries and season stats from ESPN (twice a day, the same feed Hard Cap uses), standings every morning, and the draft order, every pick owed and the consensus 2027 board from the Big Board. A waived player catching on somewhere new counts as a two-way there while his old team pays off the rest.</p>" +
      "<h3>Ratings</h3><p>Every player has an impact rating per 100 possessions, offense plus defense, from Banner 19's blend of DARKO (half), RAPM, CraftedNBA and the box score. The DARKO half is live: Kostya Medvedovsky and Andrew Patton's daily plus-minus is pulled from <a href=\"https://www.darko.app/\">darko.app</a> every morning" + (H.darkoThrough ? " (ratings through " + esc(H.darkoThrough) + ")" : "") + " and replaces the June numbers the cap sheet was built on; this year's rookies move halfway from their draft-slot guess to DARKO's number. Basketball-Reference's Box Plus/Minus moves the other half, faded in by minutes (about " + H.cfg.blend.toLocaleString() + " minutes to move it halfway). Ratings age on Stephen Noh's curve, and young players grow toward their ceiling.</p>" +
      "<h3>Lineups and minutes</h3><p>This season uses real rotations: each team's starting five from its most recent game and the minutes every player is averaging, scaled to 240 a game among the players available (anyone ruled out for the season sits). Later seasons don't have that, so the best player at each position starts (by the positions he plays, so two centers don't start together) and the bench plays by rating: 34, 33, 32, 30 and 28 minutes for the starters, then 24, 20, 16, 13 and 10.</p>" +
      "<h3>Standings and odds</h3><p>Ratings times minutes give each team a net rating, and every game left on a fresh schedule is played " + H.cfg.sims.toLocaleString() + " times from each team's real record. Then the play-in, the playoffs and the lottery: 16 lottery teams, three balls each, two for the 9 and 10 seeds and the three worst records, one for each 7-8 play-in loser, and the worst three can't fall below 12th.</p>" +
      "<h3>The year slider</h3><p>" + sname(0) + " is today's rosters. Every later season is built from contracts: options are called on value (a team option is picked up when he's worth it, a player option comes back when it's bad for the team), and when a deal ends he's gone, unless he's a restricted free agent worth his price (matched by default) or you re-sign him on his team's page. Each team's first-round picks arrive at their projected slot on rookie-scale deals (2027 from the simulations, using the Big Board's player at that slot; later drafts from the season before). Better-of picks go to whoever gets them where the picks are projected to land. Open spots go to the free agents a team's cap position can buy: a starter with real cap room, a rotation player with the mid-level, minimums after that.</p>" +
      "<h3>Surplus value</h3><p>For each season left on a contract: value minus salary" + (H.cfg.disc > 0 ? ", discounted " + pct(H.cfg.disc) + " a year (about the cap's growth, so values read in today's cap dollars)" : ", in real dollars (set a discount rate, 7% is about the cap's growth, to see today's cap dollars)") + ". This season only counts the part still to play.</p>" +
      "<p><b>Production</b> is minutes times impact above replacement (-2.5, what a free minimum-salary player gives you), with that impact raised to the power of the star premium (" + H.cfg.convex.toFixed(2) + "). The premium is there because minutes and roster spots are scarce: one +4 player is worth far more than two +1 players, and the max means stars are always paid less than they're worth. With a linear price (1.0), cheap role players on long minimum deals outranked stars. Minutes are what he actually plays, fading over a few seasons toward what his rating would earn. It's priced at what teams pay for production on the open market: the rate is read off players the max doesn't hold down (a market price under a quarter of the cap) who play real minutes, so a role player's production is worth about what role players get and a star's runs past his max. (Scaling to the whole league's payroll instead ran about a fifth rich, since it spread the sunk money in bad contracts onto everyone who produces.) Only " + pct(H.cfg.growth) + " of a young player's projected improvement counts, since a lot of it never shows up; decline counts in full. A first- or second-year player's rating starts as a guess from his draft slot, so this season's play moves it faster than a veteran's. Both settings are adjustable on the Trade Value tab.</p>" +
      "<p><b>Market</b> is what teams would pay him: Banner 19's market model, fit to 317 veteran contracts, capped at the max. It mostly prices minutes and scoring, barely impact, which is why it disagrees with production.</p>" +
      "<h3>Draft picks</h3><p>What each slot is worth comes from what picks 1 to 60 in the 2001-2018 drafts actually produced: each of a player's first eight seasons valued with the same production model, minus what his slot pays today (the rookie scale, team options picked up only when he's worth it, and for stars the part of their second contract above the max). Busts count. The curve is fit to the averages (any one career capped at $350M, so one LeBron can't bend it): No. 1 is worth about " + money(pk[0]) + ", No. 5 " + money(pk[4]) + ", No. 15 " + money(pk[14]) + ", No. 30 " + money(pk[29]) + " and No. 45 " + money(pk[44]) + ". A pick's value averages over every slot it could land in: the simulations for 2027, a spread around the projected slot after that (wider each year out). A protected pick only counts the slots where it conveys. The market view uses what teams pay for picks in trades instead.</p>" +
      "<h3>Trades and team tools</h3><p>The same rules Banner 19 runs: salary matching by apron tier (200% plus $250K for small salaries, outgoing plus a set amount in the middle, 125% for big ones, 100% over the first apron), trade exceptions (each team's real ones, open as of Nov 2026; teams over the first apron can't use ones made last season), hard caps at the first or second apron when a team takes back more salary, combines salaries or sends cash, the cash limit, the 15-man roster limit and the Stepien rule. Deals with three to five teams check each team on everything it sends and gets. Each team's mid-level use and hard caps come from Hoops Rumors' July tracking; repeater status from the last four tax seasons.</p>" +
      "<h3>Cap holds, dead money and extensions</h3><p>Next summer's room is shown both ways: if a team renounces everyone, and with the cap holds for free agents it keeps rights to. Dead money is this season's team totals from Spotrac (later seasons only where Spotrac lists them). Extension eligibility and maximums follow the 2023 CBA: rookie-scale players the summer before their fourth season, veterans with two or fewer years left, up to 140% of their salary or the max.</p>" +
      "<h3>Trade finder</h3><p>Pick a player and every other team's packages of one to three players that make the salaries work for both sides come back, evened up with draft picks from whichever team gets less, and checked against every cap rule.</p>" +
      "<h3>What it doesn't do</h3><p>Aggregation windows and other timing rules aren't enforced (players signed this summer and the deadline get a warning). No second-round rookies on the slider, and the most tangled pick conditions (Oklahoma City's chain of 2027 swaps) stay with whoever holds them today. Mid-level use after mid-July isn't tracked.</p>" +
      '<p class="note">Built on the shared NBA library (nba/lib) that Banner 19 and Hard Cap also run on, so a cap rule or contract fix lands in all three.</p></div>';
    view.innerHTML = html;
  }

  // ---------- start ----------
  function get(u, opt) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }).catch(function (e) { if (opt) return null; throw e; }); }
  Promise.all([get("../celtics/data.json"), get("../hardcap/stats.json", true), get("../hardcap/contracts.json", true), get("../celtics/live.json", true), get("../draft/nba.json", true), get("data/picks.json"), get("../tools/draft_teams.json", true), get("data/tpes.json", true), get("data/exceptions.json", true), get("data/dead.json", true), get("data/darko.json", true), get("data/taxhist.json", true)])
    .then(function (r) {
      H = Hub.build({ data: r[0], stats: r[1] || {}, fixes: r[2], live: r[3], board: r[4] || {}, picks: r[5], teams: r[6], tpes: r[7], exceptions: r[8], dead: r[9], darko: r[10], taxhist: r[11] }, { mode: load("mode", "prod"), disc: load("disc", 0.07), fill: load("fill", true), convex: load("convex", 1.5), growth: load("growth", 0.5) });
      H.keep = load("keep", {}) || {};
      fillBox.checked = H.cfg.fill;
      $("#foot").innerHTML = "Rosters and contracts as of " + esc(H.asOf) + ". Updated every day from Basketball-Reference, ESPN, DARKO and the Big Board.";
      render();
    })
    .catch(function (e) { view.innerHTML = '<p class="loading">Couldn\'t load the league: ' + esc(e.message) + "</p>"; });
})();
