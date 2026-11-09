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
      var on = a.dataset.tab === state.route || (a.dataset.tab === "teams" && state.route === "team");
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    var withYears = state.route === "standings" || state.route === "team";
    yearbar.hidden = !withYears;
    if (withYears) drawYears();
    var fn = { standings: standings, team: teamPage, teams: teamsPage, value: valuePage, trade: tradePage, fa: faPage, method: methodPage }[state.route] || standings;
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
    var ros = H.rosterAt(code, i), pay = H.payroll(code, i), status = CBA.status(pay, i);
    var w = Math.round(st.projW);
    var html = '<div class="thead">' + logo(code, 54) + "<div><h2>" + esc(t.name) + '</h2><div class="meta">' + (t.conf === "E" ? "East" : "West") + " · " + sname(i) + (i === 0 ? " · " + t.w + "-" + t.l + " now" : "") + " · projected " + w + "-" + (82 - w) + "</div></div>" +
      '<a class="back" href="' + href("standings", { y: yq(i) }) + '">← Standings</a></div>';
    html += '<div class="teampick">' + H.codes.filter(function (c) { return team(c).conf === t.conf && c !== code; }).sort(function (a, b) { return team(a).name.localeCompare(team(b).name); }).map(function (c) {
      return '<a href="' + href("team/" + c, { y: yq(i) }) + '">' + logo(c, 18) + esc(team(c).short) + "</a>";
    }).join("") + "</div>";
    html += '<div class="stats">' + stat(ordinal(seed), (t.conf === "E" ? "East" : "West") + " seed") + stat(pct(st.playoffs), "Playoffs") + stat(pct(st.title), "Title") +
      stat(rt(st.net), "Net rating") + stat(money(pay, 0), "Payroll") + stat(esc(CBA.STATUS_NAME[status]), "Cap position") + "</div>";
    html += '<div class="legend">' + ["Fringe", "Weak", "Average", "Strong", "Elite"].map(function (k) { return '<span class="T-' + k + '">' + k + "</span>"; }).join("") + '<span class="note">impact per 100 possessions</span></div>';
    var rot = Mo.autoRotation(ros.map(function (x) { return { id: x.p.id, pos: x.p.pos || "W", o: x.r * 0.6, d: x.r * 0.4 }; }));
    var byId = {}; ros.forEach(function (x) { byId[x.p.id] = x; });
    var order = rot.order.map(function (id) { return byId[id]; });
    html += court(order.slice(0, 5), i);
    if (i > 0) html += changes(code, i);
    html += tablePanel("Rotation", "<th>Player</th><th>Pos</th><th>Age</th><th>Impact</th><th>Min</th><th>" + (i === 0 ? "This season" : "Salary") + "</th><th>Status</th>",
      order.map(function (x, k) {
        var p = x.p, mins = rot.mins[p.id] || 0;
        var line = i === 0 && p.line ? f1(p.line.pts) + " / " + f1(p.line.reb) + " / " + f1(p.line.ast) : money(x.sal);
        return "<tr" + (k === 5 || k === 10 ? ' class="cut"' : "") + "><td>" + pname(p, 24, p.inj ? ' <span class="pill warn" title="' + esc(p.inj) + '">' + esc(p.inj) + "</span>" : "") + "</td><td>" + esc(posOf(p)) + "</td><td>" + (p.fill || p.age == null ? "—" : p.rook ? p.age + i - p.arrive : p.age + i) + "</td><td>" + rchip(x.r) + "</td><td>" + (mins || "—") + "</td><td>" + line + "</td><td>" + statusPill(x, i) + "</td></tr>";
      }).join(""), i === 0 ? "pts / reb / ast this season" : "");
    html += capSheet(code, i);
    html += picksPanel(code);
    view.innerHTML = html;
  }
  function statusPill(x, i) {
    var p = x.p;
    if (x.how === "fill") return '<span class="pill fill">' + (x.p.n.indexOf("Replacement") === 0 ? "Open spot" : "Signing") + "</span>";
    if (x.how === "rookie") return '<span class="pill new">' + p.year + " No. " + p.slot + "</span>";
    if (x.how === "re-signed") return '<span class="pill up">Re-signed</span>';
    var last = H.lastYear(p), opt = p.c.opt && p.c.opt[i];
    if (opt) return '<span class="pill">' + esc(CBA.OPT_NAME[opt]) + "</span>";
    return '<span class="pill">Thru ' + sname(last) + "</span>";
  }
  // Starting five on a half court, guards up top and bigs at the rim
  function court(five, i) {
    var spots = [["PG", 50, 18], ["SG", 82, 34], ["SF", 18, 34], ["PF", 70, 70], ["C", 34, 74]];
    var sorted = five.filter(Boolean).slice().sort(function (a, b) {
      var pa = POS_ORDER[(a.p.ps || [])[0]] || (a.p.pos === "G" ? 1.5 : a.p.pos === "B" ? 5 : 3);
      var pb = POS_ORDER[(b.p.ps || [])[0]] || (b.p.pos === "G" ? 1.5 : b.p.pos === "B" ? 5 : 3);
      return pa - pb;
    });
    var html = '<div class="courtwrap"><div class="court">' + courtSvg();
    sorted.forEach(function (x, k) {
      var s = spots[k];
      html += '<div class="cspot" style="left:' + s[1] + "%;top:" + s[2] + '%">' + (x.p.fill || x.p.rook ? "" : '<button type="button" class="cbtn" data-p="' + esc(x.p.id) + '">') +
        face(x.p, 52) + '<span class="cn">' + esc(x.p.n) + '</span><span class="cr T-' + tier(x.r) + '">' + esc((x.p.ps && x.p.ps[0]) || s[0]) + " · " + rt(x.r) + "</span>" + (x.p.fill || x.p.rook ? "" : "</button>") + "</div>";
    });
    html += "</div></div>";
    return html;
  }
  function courtSvg() {
    return '<svg viewBox="0 0 500 360" aria-hidden="true" preserveAspectRatio="none"><rect x="0" y="0" width="500" height="360" class="wood"/>' +
      '<g class="lines"><rect x="2" y="2" width="496" height="356"/><rect x="170" y="190" width="160" height="168"/><circle cx="250" cy="190" r="60"/>' +
      '<path d="M30 358 V300 A220 220 0 0 1 470 300 V358"/><path d="M190 2 A60 60 0 0 0 310 2"/><circle cx="250" cy="330" r="9"/><line x1="220" y1="342" x2="280" y2="342"/></g></svg>';
  }
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
      return pname(x.p, 26) + '<span class="grow"></span><span class="sub">' + (x.how === "rookie" ? (x.p.school ? esc(x.p.school) + " · " : "") + money(x.sal) : esc(money(x.sal))) + " · " + rt(x.r) + "</span>";
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
      return '<td class="' + cls + '"' + (opt ? ' title="' + esc(CBA.OPT_NAME[opt]) + '"' : re ? ' title="Projected re-signing at market price"' : "") + ">" + money(s) + "</td>";
    };
    var body = list.map(function (p) { return "<tr><td>" + pname(p, 20) + "</td>" + cols.map(function (j) { return cell(p, j); }).join("") + "</tr>"; }).join("") +
      rooks.map(function (p) { return "<tr><td>" + pname(p, 20) + "</td>" + cols.map(function (j) { return cell(p, j); }).join("") + "</tr>"; }).join("");
    var tot = cols.map(function (j) { return H.payroll(code, j); });
    body += '<tr class="tot"><td>Payroll (with fills)</td>' + tot.map(function (x, j) { return "<td" + (j === i0 ? ' class="on"' : "") + "><b>" + money(x) + "</b></td>"; }).join("") + "</tr>";
    body += '<tr class="lines"><td>Salary cap</td>' + cols.map(function (j) { return "<td>" + money(CBA.cap(j)) + "</td>"; }).join("") + "</tr>";
    body += '<tr class="lines"><td>Tax line</td>' + cols.map(function (j) { return "<td>" + money(CBA.tax(j)) + "</td>"; }).join("") + "</tr>";
    body += '<tr class="lines"><td>First / second apron</td>' + cols.map(function (j) { return "<td>" + money(CBA.a1(j), 0) + " / " + money(CBA.a2(j), 0) + "</td>"; }).join("") + "</tr>";
    body += '<tr class="lines"><td>Position</td>' + cols.map(function (j) { var s = CBA.status(tot[j], j); return '<td><span class="pill ' + (s === "a2" || s === "a1" ? "fill" : s === "tax" ? "warn" : s === "room" ? "up" : "") + '">' + esc({ room: "Room", over: "Over cap", tax: "Tax", a1: "1st apron", a2: "2nd apron" }[s]) + "</span></td>"; }).join("") + "</tr>";
    return tablePanel("Cap sheet", "<th>Player</th>" + cols.map(function (j) { return "<th>" + sname(j) + "</th>"; }).join(""), body,
      '<span class="o-po key">Player option</span> <span class="o-to key">Team option</span> <span class="o-ng key">Non-guaranteed</span> <span class="o-re key">Projected re-signing</span> <span class="o-rk key">Draft pick</span>');
  }
  function picksPanel(code) {
    var own = H.picksOf(code), owed = H.picksOwed(code);
    var row = function (pk, mine) {
      var info = H.pickInfo(pk);
      return "<tr><td>" + logo(pk.from, 16) + " " + esc(H.pickName(pk)) + "</td><td>" + (mine ? "" : logo(pk.owner === "OUT" ? pk.from : pk.owner, 16) + " " + esc(pk.owner === "OUT" ? "Forfeited" : team(pk.owner).short)) + "</td><td>" + f1(info.avg) + "</td><td>" + (pk.prot ? pct(info.conveys) : "") +
        "</td><td>" + money(H.pickValue(pk, "prod")) + "</td><td>" + money(H.pickValue(pk, "market")) + '</td><td class="note" style="text-align:left;white-space:normal">' + esc(pk.note || "") + "</td></tr>";
    };
    var head = "<th>Pick</th><th>To</th><th>Proj. slot</th><th>Conveys</th><th>Value</th><th>Market</th><th>Notes</th>";
    return '<div class="two">' + tablePanel("Draft picks owned", head, own.filter(function (pk) { return pk.r === 1 || pk.y <= 2029; }).map(function (pk) { return row(pk, true); }).join(""), "Value: what that slot has produced. Market: what teams pay for it") +
      tablePanel("Own picks owed away", head, owed.map(function (pk) { return row(pk, false); }).join(""), "") + "</div>";
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
    if (p.bpm != null) html += kv(rt(p.bpm), "BPM this season");
    html += "</div>";
    var vt = s.rows.reduce(function (a, r) { return a + r.value * Math.pow(1 + H.cfg.disc, -r.j); }, 0), ct = s.rows.reduce(function (a, r) { return a + r.sal * Math.pow(1 + H.cfg.disc, -r.j); }, 0);
    html += '<div class="vcs"><div><span>Value</span><b>' + money(vt) + "</b><small>" + (H.cfg.mode === "market" ? "what teams would pay him" : "what he should produce") + '</small></div><i>−</i><div><span>Contract</span><b>' + money(ct) +
      '</b><small>what he\'ll be paid</small></div><i>=</i><div class="' + (s.pv >= 0 ? "up" : "dn") + '"><span>Surplus</span><b>' + signed(s.pv) + "</b><small>" + s.rows.length + " season" + (s.rows.length === 1 ? "" : "s") + ", discounted</small></div></div>";
    html += '<p class="tldr">' + (H.cfg.mode === "market" ? "Production view" : "Market view") + ": " + signed(sm.pv) + ". " + esc(p.note || "") + (p.form ? " This season's play has moved his rating " + rt(p.form) + "." : "") + "</p>";
    html += '<h4 class="card-sec">Contract value</h4><div class="scroll"><table class="t"><thead><tr><th>Season</th><th>Age</th><th>Impact</th><th>Value</th><th>Salary</th><th>Surplus</th></tr></thead><tbody>';
    s.rows.forEach(function (r) {
      html += "<tr><td>" + r.season + (r.opt ? ' <span class="pill">' + esc(r.opt) + "</span>" : "") + (r.part < 1 ? ' <span class="note">(rest of season)</span>' : "") + "</td><td>" + (p.age + r.j) + "</td><td>" + rchip(r.r) + "</td><td>" + money(r.value) + "</td><td>" + money(r.sal) + '</td><td class="' + (r.surplus >= 0 ? "pos" : "neg") + '">' + signed(r.surplus) + "</td></tr>";
    });
    html += '<tr class="tot"><td colspan="5">Discounted at ' + pct(H.cfg.disc) + ' a year</td><td class="' + (s.pv >= 0 ? "pos" : "neg") + '"><b>' + signed(s.pv) + "</b></td></tr>";
    html += "</tbody></table></div>";
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
        if (side < 0) side = tr.sides.length < 3 ? tr.sides.length : 0;
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
      '<label title="Each later season counts this much less. 7% matches the cap\'s growth, so values read in today\'s cap dollars">Discount %<input type="number" step="1" min="0" max="20" data-cfg="disc" value="' + (H.cfg.disc * 100).toFixed(0) + '"></label>' + (extra || "") + "</div>";
  }
  view.addEventListener("change", function (e) {
    var c = e.target.closest("[data-cfg]");
    if (!c) return;
    var k = c.dataset.cfg, v = k === "mode" ? c.value : +c.value / 100;
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
      : "Value is what each player should produce over the rest of his contract, priced the way the cap prices production (Stephen Noh's salary model, the one Banner 19 uses). ") +
      "Contract is what he'll be paid. Surplus is the difference, each season discounted. Picks are valued by what their projected slot has produced in past drafts, or in the market view, by what teams pay for them.</p>";
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
  // A trade lives in the address bar: ta, tb, tc are the teams; a, b, c what each sends ("p:jayson-tatum",
  // "k:2028-1-BOS"), with "~c" on the end when a three-team deal sends it somewhere other than the next team.
  function tradeHash(tr) {
    var q = {}, L = "abc";
    tr.sides.forEach(function (c, k) { if (c) q["t" + L[k]] = c; });
    tr.sides.forEach(function (c, k) {
      var mine = tr.assets.filter(function (a) { return a.from === k; });
      if (mine.length) q[L[k]] = mine.map(function (a) { return a.kind + ":" + a.id + (a.to >= 0 && tr.sides.length === 3 ? "~" + L[a.to] : ""); }).join(",");
    });
    if (tr.sides.length === 3) q.three = 1;
    save("trade", q);
    return href("trade", q);
  }
  function tradeState() {
    var q = state.route === "trade" ? state.q : {}, L = "abc";
    if (!q.ta && !q.tb && !q.a && !q.b) q = load("trade", {}) || {};
    var n = q.three || q.tc || q.c ? 3 : 2, tr = { sides: [], assets: [] };
    for (var k = 0; k < n; k++) tr.sides.push(H.teams[q["t" + L[k]]] ? q["t" + L[k]] : null);
    for (k = 0; k < n; k++) (q[L[k]] || "").split(",").filter(Boolean).forEach(function (s) {
      var m = /^([pk]):([^~]+)(?:~([abc]))?$/.exec(s);
      if (!m) return;
      var ok = m[1] === "p" ? H.W.P[m[2]] : H.W.picks.find(function (x) { return x.id === m[2]; });
      if (!ok) return;
      tr.assets.push({ kind: m[1], id: m[2], from: k, to: m[3] ? L.indexOf(m[3]) : -1 });
    });
    return tr;
  }
  function destOf(tr, a) { return a.to >= 0 && a.to !== a.from ? a.to : (a.from + 1) % tr.sides.length; }
  function tradePage() {
    var tr = tradeState(), n = tr.sides.length, L = "abc";
    var opts = function (cur) {
      return '<option value="">Pick a team</option>' + H.codes.slice().sort(function (a, b) { return team(a).name.localeCompare(team(b).name); }).map(function (c) { return '<option value="' + c + '"' + (c === cur ? " selected" : "") + ">" + esc(team(c).name) + "</option>"; }).join("");
    };
    var html = '<h2 class="sec">Trade Builder</h2><p class="lede">Pick the teams, then add players and draft picks from each side. Every trade is checked against the real cap rules (salary matching by apron tier, hard caps, roster limits and the Stepien rule), shows the surplus changing hands both ways, and gets its own link.</p>';
    html += controls();
    html += '<div class="sides">';
    var moves = [], ready = tr.sides.every(Boolean);
    tr.sides.forEach(function (code, k) {
      var mine = tr.assets.filter(function (a) { return a.from === k; }), rows = "", tot = 0;
      mine.forEach(function (a) {
        var to = destOf(tr, a), v = a.kind === "p" ? H.surplus(H.W.P[a.id]).pv : H.pickValue(H.W.picks.find(function (x) { return x.id === a.id; }));
        tot += v;
        if (ready) moves.push({ kind: a.kind, id: a.id, from: code, to: tr.sides[to] });
        var label = a.kind === "p" ? pname(H.W.P[a.id], 28) : '<span class="pl static">' + logo(H.W.picks.find(function (x) { return x.id === a.id; }).from, 22) + '<span class="nm">' + esc(H.pickName(H.W.picks.find(function (x) { return x.id === a.id; }))) + "</span></span>";
        var sub = a.kind === "p" ? money(H.salary(H.W.P[a.id], 0)) + " this season · thru " + sname(H.lastYear(H.W.P[a.id])) : "Projected slot " + f1(H.pickInfo(H.W.picks.find(function (x) { return x.id === a.id; })).avg);
        var dest = n === 3 ? '<select class="dest" data-dest="' + esc(a.kind + ":" + a.id) + '" aria-label="Sends to">' + tr.sides.map(function (c, j) { return j === k ? "" : '<option value="' + j + '"' + (j === to ? " selected" : "") + ">to " + esc(c ? team(c).short : "Team " + L[j].toUpperCase()) + "</option>"; }).join("") + "</select>" : "";
        rows += "<li>" + label + '<span class="grow"><span class="sub">' + sub + "</span></span>" + dest + '<b class="' + (v >= 0 ? "pos" : "neg") + '">' + signed(v) + '</b><button class="xbtn" data-rm="' + esc(a.kind + ":" + a.id) + '" aria-label="Remove">×</button></li>';
      });
      html += '<div class="side"><div class="side-h">' + (code ? logo(code, 28) : "") + '<select data-tside="' + k + '" aria-label="Team ' + L[k].toUpperCase() + '">' + opts(code) + "</select></div>" +
        '<p class="sends">Sends</p><ul class="rlist">' + (rows || '<li class="note">Nothing yet.</li>') + '</ul><div class="tot"><span>Surplus sent</span><span class="num">' + signed(tot) + "</span></div>" +
        (code ? assetPicker(code, k, tr) : "") + "</div>";
    });
    html += "</div>";
    if (n === 2) html += '<p><button class="btn" data-three>+ Add a third team</button></p>';
    if (ready && moves.length) html += verdict(tr, moves);
    html += '<p><button class="btn" data-clear>Clear the trade</button></p>';
    view.innerHTML = html;
  }
  function verdict(tr, moves) {
    var chk = H.checkTrade({ teams: tr.sides, moves: moves }), sum = H.tradeSummary({ teams: tr.sides, moves: moves });
    var html = '<div class="verdict ' + (chk.ok ? "legal" : "illegal") + '"><b>' + (chk.ok ? "This trade works under the cap rules." : "This trade doesn't work as built.") + "</b><div class=\"tgrid\">";
    tr.sides.forEach(function (c) {
      var r = chk.teams[c], s = sum[c];
      html += '<div class="tcol"><h4>' + logo(c, 22) + " " + esc(team(c).short) + "</h4>" +
        '<div class="kvs"><span>Surplus (production)</span><b class="' + (s.prod >= 0 ? "pos" : "neg") + '">' + signed(s.prod) + "</b>" +
        '<span>Surplus (market)</span><b class="' + (s.market >= 0 ? "pos" : "neg") + '">' + signed(s.market) + "</b>" +
        "<span>Salary in / out</span><b>" + money(s.salIn) + " / " + money(s.salOut) + "</b>" +
        "<span>Payroll after</span><b>" + money(r.P2) + ' <span class="pill' + (r.post === "a1" || r.post === "a2" ? " fill" : "") + '">' + esc({ room: "Room", over: "Over cap", tax: "Tax", a1: "1st apron", a2: "2nd apron" }[r.post] || "") + "</span></b>" +
        "<span>Projected wins</span><b>" + f1(s.winsBefore) + " → " + f1(s.winsAfter) + "</b></div>" +
        (r.msgs.length ? '<ul class="msgs">' + r.msgs.map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") + "</ul>" : '<p class="note">' + (r.newHard ? "Legal, and it hard-caps them at the " + esc(CBA.LEVEL_NAME[r.newHard]) + " for the rest of the season." : "Legal for them.") + "</p>") + "</div>";
    });
    html += "</div><small>Surplus is what each team gains: positive means it takes in more value than it gives up. Contenders pay for wins now; rebuilding teams pay for picks and young players.</small></div>";
    return html;
  }
  // A team's roster and picks, best surplus first, to add with one tap
  function assetPicker(code, k, tr) {
    var on = {};
    tr.assets.forEach(function (a) { on[a.kind + ":" + a.id] = 1; });
    var ps = Object.values(H.W.P).filter(function (p) { return p.t === code && !p.two && H.salary(p, 0) > 0 && !on["p:" + p.id]; })
      .map(function (p) { return { p: p, v: H.surplus(p).pv }; }).sort(function (a, b) { return H.salary(b.p, 0) - H.salary(a.p, 0); });
    var pks = H.picksOf(code).filter(function (pk) { return !on["k:" + pk.id] && !pk.locked && (pk.r === 1 || pk.y <= 2029); });
    return '<details class="org" open><summary>' + esc(team(code).short) + " roster (by salary)</summary>" + ps.map(function (x) {
      return '<button type="button" class="org-row" data-pick="p:' + esc(x.p.id) + '" data-side="' + k + '">' + face(x.p, 22) + '<span class="grow">' + esc(x.p.n) + ' <span class="note">' + money(H.salary(x.p, 0)) + "</span></span><b class=\"" + (x.v >= 0 ? "pos" : "neg") + '">' + signed(x.v) + "</b></button>";
    }).join("") + "</details>" +
      '<details class="org"><summary>Draft picks</summary>' + pks.map(function (pk) {
        var v = H.pickValue(pk);
        return '<button type="button" class="org-row" data-pick="k:' + esc(pk.id) + '" data-side="' + k + '">' + logo(pk.from, 18) + '<span class="grow">' + esc(H.pickName(pk)) + '</span><b class="pos">' + money(v) + "</b></button>";
      }).join("") + "</details>";
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
    var pick = e.target.closest("[data-pick]"), rm = e.target.closest("[data-rm]"), clear = e.target.closest("[data-clear]"), three = e.target.closest("[data-three]");
    if (!pick && !rm && !clear && !three) return;
    e.stopPropagation();
    var tr = tradeState();
    if (clear) tr = { sides: [null, null], assets: [] };
    if (three) tr.sides.push(null);
    if (pick) {
      var m = pick.dataset.pick.split(":"), kind = m[0], id = m.slice(1).join(":");
      tr.assets = tr.assets.filter(function (a) { return !(a.kind === kind && a.id === id); });
      tr.assets.push({ kind: kind, id: id, from: +pick.dataset.side, to: -1 });
    }
    if (rm) tr.assets = tr.assets.filter(function (a) { return a.kind + ":" + a.id !== rm.dataset.rm; });
    location.hash = tradeHash(tr);
  }, true);

  // ---------- free agents ----------
  function faPage() {
    var q = state.q, fa = H.faClass(), cap = H.capOutlook(1), prem = H.premium();
    var html = '<h2 class="sec">2027 Free Agents</h2><p class="lede">Everyone whose contract ends after this season, with options called the way the model expects. Fair value is what he should produce per year over the deal the market would give him; the market estimate is what teams would actually pay. Restricted free agents can be matched by their own team.</p>';
    html += controls(teamSelect(q.t || ""));
    var list = fa.filter(function (x) { return !q.t || x.team === q.t; }).slice(0, 120);
    html += tablePanel("The class", "<th>Player</th><th>Team</th><th>Age</th><th>Type</th><th>Impact next year</th><th>Years</th><th>Fair value</th><th>Market</th><th>Gap</th>", list.map(function (x, k) {
      var gap = x.fair - x.market;
      return "<tr><td>" + (k + 1) + ". " + pname(x.p, 22, x.opt ? ' <span class="pill" title="Projected to decline his ' + esc(CBA.OPT_NAME[x.opt].toLowerCase()) + '">' + esc(x.opt) + " out</span>" : "") + "</td><td>" + logo(x.team, 18) + "</td><td>" + x.age + "</td><td>" + (x.kind === "RFA" ? '<span class="pill up">RFA</span>' : '<span class="pill">UFA</span>') + "</td><td>" + rchip(x.r) + "</td><td>" + x.yrs + "</td><td>" + money(x.fair) + "</td><td><b>" + money(x.market) + '</b></td><td class="' + (gap >= 0 ? "pos" : "neg") + '">' + signed(gap) + "</td></tr>";
    }).join(""), "Gap: positive means a bargain at the market price");
    html += tablePanel("Who can spend in " + sname(1), "<th>Team</th><th>Committed</th><th>Cap room</th><th>Players</th><th>Best tool</th>", cap.map(function (c) {
      return '<tr class="go" data-team="' + c.code + '"><td class="tm">' + logo(c.code) + '<span class="nm">' + esc(team(c.code).name) + "</span></td><td>" + money(c.committed) + '</td><td class="' + (c.room > 0 ? "pos" : "neg") + '">' + (c.room > 0 ? money(c.room) : "—") + "</td><td>" + c.n + "</td><td>" + esc(c.tool) + "</td></tr>";
    }).join(""), "Contracts and rookie deals already on the books against a " + money(CBA.cap(1)) + " cap, before cap holds");
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
      "<h3>Ratings</h3><p>Every player has an impact rating per 100 possessions, offense plus defense, from Banner 19's blend of DARKO, RAPM, CraftedNBA and the box score. This season's play moves it: Basketball-Reference's Box Plus/Minus, faded in by minutes (it takes about " + H.cfg.blend.toLocaleString() + " minutes to move a rating halfway). Ratings age on Stephen Noh's curve, and young players grow toward their ceiling.</p>" +
      "<h3>Standings and odds</h3><p>Each team plays its best ten by rating in a set rotation (34, 33, 32, 30 and 28 minutes for the starters down to 10 for the tenth man); minutes left over go to replacement level. That gives a net rating, and every game left on a fresh schedule is played " + H.cfg.sims.toLocaleString() + " times from each team's real record. Then the play-in, the playoffs and the lottery: 16 lottery teams, three balls each, two for the 9 and 10 seeds and the three worst records, one for each 7-8 play-in loser, and the worst three can't fall below 12th. Anyone ruled out for the season sits.</p>" +
      "<h3>The year slider</h3><p>" + sname(0) + " is today's rosters. Every later season is built from contracts: options are called on value (a team option is picked up when he's worth it, a player option comes back when it's bad for the team), and when a deal ends he's gone, unless he's a restricted free agent worth his price (matched by default) or you re-sign him on his team's page. Each team's first-round picks arrive at their projected slot (2027 from the simulations, using the Big Board's player at that slot; later drafts from the season before) on rookie-scale deals. Open spots go to the free agents a team's cap position can buy: a starter with real cap room, a rotation player with the mid-level, minimums after that.</p>" +
      "<h3>Surplus value</h3><p>For each season left on a contract: value minus salary, discounted " + pct(H.cfg.disc) + " a year (the cap's growth, so values read in today's cap dollars). This season only counts the part still to play. <b>Production</b> prices what he should produce the way the cap prices it (Stephen Noh's salary model: minutes times impact, scaled to the cap). <b>Market</b> is what teams would pay him: Banner 19's market model, fit to 317 veteran contracts, capped at the max. Stars come out far ahead in the production view because the max holds their pay down; stars in decline come out far behind.</p>" +
      "<h3>Draft picks</h3><p>What each slot is worth comes from what picks 1 to 60 in the 2001-2018 drafts actually produced: each of a player's first eight seasons valued with the same production model, minus what his slot pays today (the rookie scale, team options picked up only when he's worth it, and for stars the part of their second contract above the max). Busts count. The curve is fit to the averages (any one career capped at $200M, so one LeBron can't bend it): No. 1 is worth about " + money(pk[0]) + ", No. 5 " + money(pk[4]) + ", No. 15 " + money(pk[14]) + ", No. 30 " + money(pk[29]) + " and No. 45 " + money(pk[44]) + ". A pick's value averages over every slot it could land in: the simulations for 2027, a spread around the projected slot after that (wider each year out). A protected pick only counts the slots where it conveys. The market view uses what teams pay for picks in trades instead.</p>" +
      "<h3>Trades</h3><p>The same rules Banner 19 runs: salary matching by apron tier (200% plus $250K for small salaries, outgoing plus a set amount in the middle, 125% for big ones, 100% over the first apron), trade exceptions, hard caps at the first or second apron when a team takes back more salary or combines salaries, the 15-man roster limit and the Stepien rule. Three-team deals check each team on everything it sends and gets.</p>" +
      "<h3>What it doesn't do</h3><p>No cap holds or exceptions in the free agent outlook (room is before holds), no second-round rookies on the slider, and 2027 pick protections come from the Big Board's rule list; the most tangled ones (swaps and best-of picks) stay with whoever holds them today. Rest-of-season injuries only count when the report says out for the season.</p>" +
      '<p class="note">Built on the shared NBA library (nba/lib) that Banner 19 and Hard Cap also run on, so a cap rule or contract fix lands in all three.</p></div>';
    view.innerHTML = html;
  }

  // ---------- start ----------
  function get(u, opt) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }).catch(function (e) { if (opt) return null; throw e; }); }
  Promise.all([get("../celtics/data.json"), get("../hardcap/stats.json", true), get("../hardcap/contracts.json", true), get("../celtics/live.json", true), get("../draft/nba.json", true), get("data/picks.json"), get("../tools/draft_teams.json", true)])
    .then(function (r) {
      H = Hub.build({ data: r[0], stats: r[1] || {}, fixes: r[2], live: r[3], board: r[4] || {}, picks: r[5], teams: r[6] }, { mode: load("mode", "prod"), disc: load("disc", 0.07), fill: load("fill", true) });
      H.keep = load("keep", {}) || {};
      fillBox.checked = H.cfg.fill;
      $("#foot").innerHTML = "Rosters and contracts as of " + esc(H.asOf) + ". Updated every day from Basketball-Reference, ESPN and the Big Board.";
      render();
    })
    .catch(function (e) { view.innerHTML = '<p class="loading">Couldn\'t load the league: ' + esc(e.message) + "</p>"; });
})();
