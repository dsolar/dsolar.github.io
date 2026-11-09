/* MLB Hub: screens. The numbers come from model.js; the data from data/hub.json and data/fa.json (built every
   morning by tools/mlb_hub_build.py). Routes live in the address bar so any view can be shared:
     #/standings?y=2028   #/team/BOS?y=2029   #/teams   #/value   #/trade?a=..&b=..   #/fa   #/method */
(function () {
  "use strict";
  var M = window.MLBModel, H = null, HUB = null;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var view = $("#view"), years = $("#years"), yearbar = $("#yearbar"), fillBox = $("#fill");
  var state = { year: null, route: "standings", arg: null, q: {} };
  var SPOT_XY = { // field spots, % of the field box
    CF: [50, 13], LF: [19, 25], RF: [81, 25], SS: [34, 45], "2B": [66, 45], "3B": [15, 61], "1B": [85, 61],
    C: [50, 89], DH: [14, 89]
  };

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function f1(x) { return x == null || isNaN(x) ? "—" : (Math.round(x * 10) / 10).toFixed(1); }
  function f0(x) { return x == null || isNaN(x) ? "—" : String(Math.round(x)); }
  function pct(x, d) { return x == null ? "—" : (x * 100).toFixed(d == null ? 1 : d) + "%"; }
  function money(m, d) { // $M in, "$24.5M" out
    if (m == null || isNaN(m)) return "—";
    var neg = m < 0, a = Math.abs(m);
    var s = a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(d == null ? 1 : d) : a.toFixed(d == null ? 1 : d);
    return (neg ? "-" : "") + "$" + s + "M";
  }
  function signed(m) { return m == null ? "—" : (m > 0 ? "+" : "") + money(m); }
  function team(abbr) { return H.byAbbr[abbr] || { abbr: abbr, name: abbr, color: "#33415c", espn: String(abbr || "").toLowerCase() }; }
  function logo(abbr, size) {
    var t = team(abbr);
    size = size || 22;
    return '<img class="logo" src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/mlb/500/' + esc(t.espn) + '.png&w=' + size * 2 + '&h=' + size * 2 + '" alt="" width="' + size + '" height="' + size + '" loading="lazy" onerror="this.style.visibility=\'hidden\'">';
  }
  function face(p, size) {
    if (!p) return "";
    var mlb = typeof p.id === "number";
    return window.DSFaces.html({ sport: "mlb", id: mlb ? p.id : null, name: p.n, color: team(p.t).color, size: size || 24, milb: p.g === "min" });
  }
  function hand(p) {
    var h = p.p ? p.th : p.b;
    return h ? '<span class="hand' + (h === "S" ? " s" : "") + '" title="' + (p.p ? "Throws " : "Bats ") + h + '">' + esc(h) + "</span>" : "";
  }
  function pname(p, size, extra) {
    return '<span class="pl" data-p="' + esc(p.id) + '">' + face(p, size || 22) + (extra || "") + '<span class="nm">' + esc(p.n) + "</span></span>";
  }
  function last(n) { var a = String(n || "").replace(/ (Jr\.|Sr\.|II|III|IV)$/, "").split(" "); return a.length > 1 ? a.slice(1).join(" ") : n; }
  function yearsList() { var a = []; for (var i = 0; i < H.cfg.years; i++) a.push(H.season + i); return a; }
  function href(route, q) {
    var qs = Object.keys(q || {}).filter(function (k) { return q[k] != null && q[k] !== ""; }).map(function (k) { return k + "=" + encodeURIComponent(q[k]); }).join("&");
    return "#/" + route + (qs ? "?" + qs : "");
  }
  function save(k, v) { try { localStorage.setItem("mlbhub." + k, JSON.stringify(v)); } catch (e) { /* storage off */ } }
  function load(k, d) { try { var v = localStorage.getItem("mlbhub." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }

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
    state.year = y && y >= H.season && y < H.season + H.cfg.years ? y : (state.year || H.season);
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
    years.innerHTML = yearsList().map(function (y) {
      return '<button type="button" data-y="' + y + '" aria-pressed="' + (y === state.year) + '">' + y + "</button>";
    }).join("");
  }
  years.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-y]");
    if (!b) return;
    state.year = +b.dataset.y;
    var q = Object.assign({}, state.q, { y: state.year === H.season ? null : state.year });
    location.hash = href(state.route + (state.arg ? "/" + state.arg : ""), q);
  });
  fillBox.addEventListener("change", function () { H.set("fill", fillBox.checked); save("fill", fillBox.checked); render(); });
  window.addEventListener("hashchange", function () { closeCard(); render(); window.scrollTo({ top: Math.min(window.scrollY, 200) }); });

  // ---------- standings ----------
  function standings() {
    var y = state.year, rows = H.standings(y);
    var first = y === H.season;
    var html = '<h2 class="sec">' + y + " Projected Standings</h2>" +
      '<p class="lede">' + (first
        ? "FanGraphs Depth Charts projections and playing time, " + (HUB.systems.indexOf("zips") >= 0 ? "Steamer and ZiPS blended" : "Steamer (ZiPS joins when it's published)") + ". Odds from " + H.cfg.sims.toLocaleString() + " simulated seasons. Click a team for its depth chart."
        : "Built from contracts, team control, aging and each farm system: players leave when their deals end, prospects arrive at their ETA. " + (H.cfg.fill ? "Open spots are filled with modest free agents." : "Open spots are left at replacement level.") + " Rougher every year out.") + "</p>";
    html += '<div class="leagues">';
    ["AL", "NL"].forEach(function (lg) {
      html += "<div>";
      ["East", "Central", "West"].forEach(function (dv) {
        var d = rows.filter(function (r) { return r.t.lg === lg && r.t.div === dv; }).sort(function (a, b) { return b.wins - a.wins; });
        html += '<div class="div"><h3>' + lg + " " + dv + '</h3><div class="scroll"><table class="t"><thead><tr><th>Team</th><th>W-L</th><th>Win%</th><th>Playoffs</th><th>Div</th><th>WS</th><th>RS</th><th>RA</th><th>Diff</th></tr></thead><tbody>';
        d.forEach(function (r) {
          var w = Math.round(r.wins), diff = r.rs - r.ra;
          html += '<tr class="go" data-team="' + r.t.abbr + '"><td class="tm">' + logo(r.t.abbr) + '<span class="nm">' + esc(r.t.name) + "</span></td>" +
            "<td>" + w + "-" + (162 - w) + "</td><td>" + (r.wins / 162).toFixed(3).replace(/^0/, "") + "</td>" +
            '<td><span class="bar">' + pct(r.playoff) + '<i><b style="width:' + (r.playoff * 100).toFixed(0) + '%"></b></i></span></td>' +
            "<td>" + pct(r.div) + "</td><td><b>" + pct(r.ws) + "</b></td><td>" + f0(r.rs) + "</td><td>" + f0(r.ra) + '</td><td class="' + (diff >= 0 ? "pos" : "neg") + '">' + (diff >= 0 ? "+" : "") + f0(diff) + "</td></tr>";
        });
        html += "</tbody></table></div></div>";
      });
      html += "</div>";
    });
    html += "</div>";
    view.innerHTML = html;
  }
  view.addEventListener("click", function (e) {
    var tr = e.target.closest("[data-team]");
    if (tr && !e.target.closest("[data-p]")) {
      location.hash = href("team/" + tr.dataset.team, { y: state.year === H.season ? null : state.year });
      return;
    }
    var p = e.target.closest("[data-p]");
    if (p && !e.target.closest(".results")) { openCard(p.dataset.p); }
  });

  // ---------- teams ----------
  function teamsPage() {
    var rows = H.standings(H.season);
    var by = {};
    rows.forEach(function (r) { by[r.t.abbr] = r; });
    var html = '<h2 class="sec">Teams</h2><p class="lede">Every organization: depth chart, contracts, the farm, and the year slider.</p>';
    ["AL", "NL"].forEach(function (lg) {
      html += '<div class="teamgrid">';
      H.teams.filter(function (t) { return t.lg === lg; }).sort(function (a, b) { return a.div.localeCompare(b.div) || a.name.localeCompare(b.name); }).forEach(function (t) {
        var r = by[t.abbr];
        html += '<a href="#/team/' + t.abbr + '">' + logo(t.abbr, 34) + "<div><b>" + esc(t.name) + "</b><span>" + lg + " " + t.div + " · " + Math.round(r.wins) + "-" + (162 - Math.round(r.wins)) + "</span></div></a>";
      });
      html += "</div>";
    });
    view.innerHTML = html;
  }

  function teamPage() {
    var abbr = (state.arg || "BOS").toUpperCase(), t = team(abbr), y = state.year;
    if (!H.byAbbr[abbr]) { teamsPage(); return; }
    var tm = H.team(abbr, y), st = H.standings(y).filter(function (r) { return r.t.abbr === abbr; })[0];
    var w = Math.round(st.wins);
    var html = '<div class="thead">' + logo(abbr, 54) + "<div><h2>" + esc(t.name) + '</h2><div class="meta">' + t.lg + " " + t.div + " · " + y + " projected " + w + "-" + (162 - w) + "</div></div>" +
      '<a class="back" href="' + href("standings", { y: y === H.season ? null : y }) + '">← Standings</a></div>';
    html += '<div class="teampick">' + H.teams.filter(function (x) { return x.lg === t.lg && x.div === t.div && x.abbr !== abbr; }).map(function (x) {
      return '<a href="' + href("team/" + x.abbr, { y: y === H.season ? null : y }) + '">' + logo(x.abbr, 18) + esc(x.name) + "</a>";
    }).join("") + "</div>";
    html += '<div class="stats">' +
      stat(pct(st.playoff), "Playoffs") + stat(pct(st.ws), "World Series") +
      stat(ordinal(H.rank(y, "bat", tm.bat)), "Hitting") + stat(ordinal(H.rank(y, "pit", tm.pit)), "Pitching") +
      stat(f1(tm.war), "Team WAR") + stat(money(H.payroll(abbr, y), 0), "Payroll") + "</div>";
    html += '<div class="legend">' + ["Fringe", "Weak", "Average", "Strong", "Elite"].map(function (k) { return '<span class="T-' + k + '">' + k + "</span>"; }).join("") + "</div>";
    html += field(tm, y);
    // what changed going into this season
    if (!tm.first) {
      html += '<div class="two">' + listPanel("Gone from last year", tm.departures, function (e) {
        var on = !!H.resigned[e.p.id];
        return pname(e.p, 26) + '<span class="grow"></span><span class="sub">' + esc(e.kind) + " · " + f1(e.war) + ' WAR</span><button class="btn' + (on ? " on" : "") + '" data-resign="' + esc(e.p.id) + '">' + (on ? "Re-signed" : "Re-sign") + "</button>";
      }, "Contracts ended or team control ran out") +
        listPanel("Called up", tm.arrivals, function (e) {
          return pname(e.p, 26) + '<span class="grow"></span><span class="sub">' + (e.p.fv ? "FV " + esc(e.p.fv) + " · " : "") + esc(e.p.pos || "") + " · " + f1(e.war) + " WAR</span>";
        }, "Prospects who win a job this year") + "</div>";
    }
    html += rosterTables(tm, y);
    html += '<div class="two">' + payrollPanel(abbr, y) + farmPanel(abbr) + "</div>";
    view.innerHTML = html;
  }
  function stat(v, k) { return '<div class="stat"><b>' + v + "</b><span>" + k + "</span></div>"; }
  function ordinal(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  view.addEventListener("click", function (e) {
    var b = e.target.closest("[data-resign]");
    if (!b) return;
    e.stopPropagation();
    H.toggleResign(isNaN(+b.dataset.resign) ? b.dataset.resign : +b.dataset.resign);
    render();
  }, true);

  // The bench player most likely to cover each spot: his listed position first, spread so one utility man
  // isn't the backup everywhere
  function backupMap(tm) {
    var out = {}, load = {};
    M.FIELD_ORDER.forEach(function (slot) {
      if (!tm.line[slot]) return;
      var best = null, score = -1e9;
      tm.bench.forEach(function (e) {
        if (!M.canPlay(e.p, slot)) return;
        var el = e.p.el || [e.p.pos], i = el.indexOf(slot);
        var s = (i === 0 ? 3 : i > 0 ? 2 : slot === "DH" ? 0.5 : 1) - (load[e.p.id] || 0) * 1.5 + e.war * 0.2;
        if (s > score) { score = s; best = e; }
      });
      if (best) { out[slot] = [best]; load[best.p.id] = (load[best.p.id] || 0) + 1; }
    });
    return out;
  }
  function field(tm, y) {
    var html = '<div class="fieldwrap"><div class="field">' + fieldSvg(), bk = backupMap(tm);
    M.FIELD_ORDER.forEach(function (slot) {
      var xy = SPOT_XY[slot], e = tm.line[slot], rows = e ? [e].concat(bk[slot] || []) : [];
      var war = rows.reduce(function (s, r, i) { return s + (i === 0 ? r.war : r.war * 0.5); }, 0);
      var tier = H.tier(y, slot, e ? e.war : 0);
      html += '<div class="spot" data-slot="' + slot + '" style="left:' + xy[0] + "%;top:" + xy[1] + '%"><header class="T-' + tier + '"><span>' + slot + "</span><span>" + f1(war) + "</span></header>";
      if (!e) html += '<div class="r fillr">' + (H.cfg.fill && !tm.first ? "Offseason FA Fill" : "Open") + "</div>";
      rows.forEach(function (r) {
        html += '<div class="r" data-p="' + esc(r.p.id) + '">' + face(r.p, 18) + '<span class="n">' + esc(last(r.p.n)) + (r.debut ? ' <span class="pill new">New</span>' : "") + '</span><span class="w">' + f1(r.war) + "</span></div>";
      });
      html += "</div>";
    });
    html += "</div>";
    var spW = tm.rot.reduce(function (s, e) { return s + e.war; }, 0), rpW = tm.pen.reduce(function (s, e) { return s + e.war; }, 0);
    html += '<div class="staff">' + staffBox("SP / Rotation", "SP", spW, tm.rot, 5, y) + staffBox("RP / Bullpen", "RP", rpW, tm.pen, 8, y) + "</div></div>";
    return html;
  }
  function staffBox(label, key, war, list, n, y) {
    var html = '<div class="spot"><header class="T-' + H.tier(y, key, war) + '"><span>' + label + "</span><span>" + f1(war) + '</span></header><div class="cols">';
    for (var i = 0; i < n; i++) {
      var e = list[i];
      html += e ? '<div class="r" data-p="' + esc(e.p.id) + '"><span class="n">' + esc(last(e.p.n)) + (e.debut ? ' <span class="pill new">New</span>' : "") + '</span><span class="w">' + f1(e.war) + "</span></div>"
        : '<div class="r fillr">' + (H.cfg.fill ? "FA Fill" : "Open") + "</div>";
    }
    return html + "</div></div>";
  }
  function fieldSvg() {
    return '<svg viewBox="0 0 118 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="M59 98 L4 43 Q59 -18 114 43 Z" fill="var(--grass)" opacity=".55"/>' +
      '<path d="M59 98 L4 43 Q59 -18 114 43 Z" fill="none" stroke="var(--grass-2)" stroke-width=".6"/>' +
      '<path d="M59 96 L34 71 Q59 40 84 71 Z" fill="var(--dirt)" opacity=".55"/>' +
      '<path d="M59 90 L44 75 L59 60 L74 75 Z" fill="var(--grass-2)" opacity=".8"/>' +
      '<g fill="#fff"><rect x="57.6" y="88.6" width="2.8" height="2.8" transform="rotate(45 59 90)"/><rect x="72.6" y="73.6" width="2.4" height="2.4" transform="rotate(45 73.8 74.8)"/><rect x="57.8" y="58.8" width="2.4" height="2.4" transform="rotate(45 59 60)"/><rect x="43" y="73.6" width="2.4" height="2.4" transform="rotate(45 44.2 74.8)"/></g>' +
      '<circle cx="59" cy="75" r="2.2" fill="var(--dirt)"/></svg>';
  }
  function listPanel(title, items, fn, sub) {
    return '<div class="panel"><h3>' + esc(title) + " <small>" + esc(sub || "") + '</small></h3><ul class="rlist">' +
      (items.length ? items.map(function (e) { return "<li>" + fn(e) + "</li>"; }).join("") : '<li class="note">Nobody.</li>') + "</ul></div>";
  }
  function status(p, y) {
    var t = H.terms(p, y);
    var tag = t.kind === "Signed" ? money(t.salary) : t.kind === "Club option" || t.kind === "Player option" ? t.kind + " " + money(t.salary) : t.kind;
    if (/^Arb/.test(t.kind)) tag += " " + money(t.salary) + (t.est ? "*" : "");
    return '<span class="pill' + (t.kind === "Re-signed" ? " up" : "") + '">' + esc(tag) + "</span>";
  }
  function rosterTables(tm, y) {
    var first = tm.first, html = '<div class="two">';
    var lineup = M.FIELD_ORDER.filter(function (s) { return tm.line[s]; }).map(function (s) { return Object.assign({ slot: s }, tm.line[s]); });
    var batHead = first ? "<th>PA</th><th>wRC+</th><th>Def</th><th>WAR</th>" : "<th>Age</th><th>Status</th><th>WAR</th>";
    var batRow = function (e) {
      var p = e.p, pj = p.pj || {};
      return "<tr><td>" + pname(p, 22, hand(p)) + "</td><td>" + esc(e.slot || p.pos || "") + "</td>" + (first
        ? "<td>" + f0(pj.pa) + "</td><td>" + f0(pj.wrc) + '</td><td class="' + ((pj.def || 0) >= 0 ? "pos" : "neg") + '">' + f1(pj.def) + "</td><td><b>" + f1(e.war) + "</b></td>"
        : "<td>" + H.ageAt(p, y) + "</td><td>" + status(p, y) + "</td><td><b>" + f1(e.war) + "</b></td>") + "</tr>";
    };
    var pitHead = first ? "<th>IP</th><th>ERA</th><th>K-BB%</th><th>WAR</th>" : "<th>Age</th><th>Status</th><th>WAR</th>";
    var pitRow = function (e, i, role) {
      var p = e.p, pj = p.pj || {};
      return "<tr><td>" + pname(p, 22, hand(p)) + "</td><td>" + esc(first ? (p.role || role + (i + 1)) : role + (i + 1)) + "</td>" + (first
        ? "<td>" + f0(pj.ip) + "</td><td>" + (pj.era != null ? pj.era.toFixed(2) : "—") + "</td><td>" + (pj.kbb != null ? (pj.kbb * 100).toFixed(1) + "%" : "—") + "</td><td><b>" + f1(e.war) + "</b></td>"
        : "<td>" + H.ageAt(p, y) + "</td><td>" + status(p, y) + "</td><td><b>" + f1(e.war) + "</b></td>") + "</tr>";
    };
    html += tablePanel("Lineup", "<th>Player</th><th>Pos</th>" + batHead, lineup.map(batRow).join(""), f1(lineup.reduce(function (s, e) { return s + e.war; }, 0)) + " WAR");
    html += tablePanel("Rotation", "<th>Pitcher</th><th>Role</th>" + pitHead, tm.rot.map(function (e, i) { return pitRow(e, i, "SP"); }).join(""), f1(tm.rot.reduce(function (s, e) { return s + e.war; }, 0)) + " WAR");
    html += tablePanel("Bench", "<th>Player</th><th>Pos</th>" + batHead, tm.bench.map(function (e) { return batRow(Object.assign({ slot: (e.p.el || [e.p.pos]).join("/") }, e)); }).join(""), "");
    html += tablePanel("Bullpen", "<th>Pitcher</th><th>Role</th>" + pitHead, tm.pen.map(function (e, i) { return pitRow(e, i, "RP"); }).join(""), f1(tm.pen.reduce(function (s, e) { return s + e.war; }, 0)) + " WAR");
    html += "</div>";
    if (first && tm.il.length) html += tablePanel("Injured list", "<th>Player</th><th>Pos</th><th>Note</th>", tm.il.map(function (e) { return "<tr><td>" + pname(e.p, 22) + "</td><td>" + esc(e.p.pos || "") + '</td><td style="white-space:normal;text-align:left">' + esc(e.p.inj || "") + "</td></tr>"; }).join(""), "");
    if (!first) html += '<p class="note">* Arbitration salaries are estimates: 25%, 40% and 60% of market value in years one to three.</p>';
    return html;
  }
  function tablePanel(title, head, body, right) {
    return '<div class="panel"><h3>' + esc(title) + " <small>" + esc(right || "") + '</small></h3><div class="scroll"><table class="t"><thead><tr>' + head + "</tr></thead><tbody>" + (body || '<tr><td class="note">Nobody yet.</td></tr>') + "</tbody></table></div></div>";
  }
  function payrollPanel(abbr, y) {
    var html = '<div class="panel"><h3>Payroll <small>committed and estimated, $M</small></h3><div class="body"><div class="payroll">';
    yearsList().forEach(function (yy) { html += '<div class="' + (yy === y ? "cur" : "") + '"><b>' + money(H.payroll(abbr, yy), 0).replace("$", "$") + "</b><span>" + yy + "</span></div>"; });
    html += '</div><p class="note" style="margin:8px 0 0">Guaranteed salaries plus arbitration and pre-arb estimates for everyone still under control. Free agents to be signed aren\'t in it.</p></div></div>';
    return html;
  }
  function farmPanel(abbr) {
    var list = H.org(abbr).filter(function (p) { return p.fv && p.g === "min"; }).sort(function (a, b) { return (a.orgr || 99) - (b.orgr || 99); }).slice(0, 12);
    return listPanel("Farm system", list, function (p) {
      return pname(p, 26) + '<span class="grow"></span><span class="sub">' + esc(p.pos || "") + " · " + esc(p.lvl || "") + " · age " + (p.age ? Math.floor(p.age) : "—") + " · ETA " + (p.eta || "—") + '</span><span class="pill">FV ' + esc(p.fv) + "</span>";
    }, HUB.board ? "FanGraphs' The Board" : "prospect grades arrive with the next pull");
  }

  // ---------- player card ----------
  var card = $("#card"), cardBody = $("#cardBody");
  function openCard(id) {
    var p = H.byId[id] || H.byId[+id];
    if (!p) return;
    var s = H.surplus(p), t = team(p.t), pj = p.pj || {};
    var html = '<div class="card-h">' + face(p, 72) + "<div><h3>" + esc(p.n) + '</h3><div class="meta">' + logo(p.t, 18) + " " + esc(t.name) + " · " + esc((p.el || [p.pos]).join("/")) +
      " · age " + (p.age != null ? Math.floor(p.age) : "—") + (p.b ? " · B/T " + esc(p.b) + "/" + esc(p.th) : "") + "</div></div></div>";
    html += '<div class="card-b"><div class="kv">';
    html += kv(f1(H.warAt(p, H.season)), H.season + " WAR");
    if (p.p) html += kv(pj.era != null ? pj.era.toFixed(2) : "—", "ERA") + kv(f0(pj.ip), "IP");
    else html += kv(f0(pj.wrc), "wRC+") + kv(f0(pj.pa), "PA");
    html += kv(p.st != null ? p.st.toFixed(2) : "—", "Service yrs") + kv(money(s.pv), "Surplus (PV)");
    if (p.fv) html += kv(esc(p.fv) + (p.risk ? " / " + esc(p.risk) : ""), "FV / risk") + kv(p.eta || "—", "ETA") + kv(p.ovr ? "#" + p.ovr : "—", "Overall rank");
    html += "</div>";
    if (p.tldr) html += '<p class="tldr">' + esc(p.tldr) + "</p>";
    if (p.c && p.c.desc) html += '<p class="tldr"><b>Contract:</b> ' + esc(p.c.desc) + (p.c.note ? " " + esc(p.c.note) : "") + "</p>";
    else if (p.acq) html += '<p class="tldr">' + esc(p.acq) + "</p>";
    html += statTables(p);
    html += '<h4 class="card-sec">Contract value</h4><div class="scroll"><table class="t"><thead><tr><th>Year</th><th>Age</th><th>Status</th><th>WAR</th><th>Value</th><th>Salary</th><th>Surplus</th></tr></thead><tbody>';
    s.rows.forEach(function (r) {
      html += "<tr><td>" + r.y + "</td><td>" + H.ageAt(p, r.y) + '</td><td style="text-align:left"><span class="pill">' + esc(r.kind) + "</span></td><td>" + f1(r.war) + "</td><td>" + money(r.value) + "</td><td>" + money(r.salary) + (r.est ? "*" : "") + '</td><td class="' + (r.surplus >= 0 ? "pos" : "neg") + '">' + signed(r.surplus) + "</td></tr>";
    });
    if (!s.rows.length) html += '<tr><td class="note" colspan="7">No years under contract or control.</td></tr>';
    html += "</tbody></table></div>";
    html += '<p class="note">Total ' + signed(s.total) + ", " + signed(s.pv) + " discounted at " + pct(H.cfg.discount, 0) + " a year. A win costs " + money(H.cfg.dpw) + " in " + H.season + ", up " + pct(H.cfg.inflation, 0) + " a year." +
      (s.prospect ? " Prospect value is scaled by his risk grade (" + pct(s.hit, 0) + ")." : "") + "</p>";
    html += '<p><button class="btn" data-add="a" data-id="' + esc(p.id) + '">Add to trade: side A</button> <button class="btn" data-add="b" data-id="' + esc(p.id) + '">Side B</button> <a class="btn" href="' + href("team/" + p.t) + '">' + esc(t.name) + " depth chart</a></p></div>";
    cardBody.innerHTML = html;
    if (!card.open) card.showModal();
  }
  // The numbers behind the value: the coming season's projection, the last three MLB seasons, the minor league line
  function d3(x) { return x == null ? "—" : Number(x).toFixed(3).replace(/^0/, ""); }
  function statTables(p) {
    var pj = p.pj || {}, html = "", src = p.pjs === "dc" ? "FanGraphs Depth Charts" : "Steamer";
    var tbl = function (title, head, rows) {
      return rows.length ? '<h4 class="card-sec">' + title + '</h4><div class="scroll"><table class="t"><thead><tr>' + head.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr></thead><tbody>" +
        rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>" : "";
    };
    var bat = !p.p, pit = p.p || p.two;
    var proj = [];
    if (bat && p.pj) proj.push([H.season + " " + src, f0(pj.pa), f0(pj.hr), f0(pj.sb), d3(pj.avg) + "/" + d3(pj.obp) + "/" + d3(pj.slg), f0(pj.wrc), f1(pj.def), "<b>" + f1(pj.war) + "</b>"]);
    if (bat && p.zips && p.zips.pa) proj.push([H.season + " ZiPS", f0(p.zips.pa), "—", "—", "—", f0(p.zips.wrc), "—", "<b>" + f1(p.zips.war) + "</b>"]);
    html += tbl("Projection", ["", "PA", "HR", "SB", "AVG/OBP/SLG", "wRC+", "Def", "WAR"], proj);
    var pp = [];
    if (p.p && p.pj) pp.push([H.season + " " + src, f0(pj.ip), f0(pj.gs), pj.era != null ? pj.era.toFixed(2) : "—", pj.fip != null ? pj.fip.toFixed(2) : "—", pj.kbb != null ? (pj.kbb * 100).toFixed(1) + "%" : "—", pj.k9 != null ? pj.k9.toFixed(1) : "—", f0(pj.sv), "<b>" + f1(pj.war) + "</b>"]);
    if (p.two) pp.push([H.season + " pitching", f0(p.two.ip), f0(p.two.gs), p.two.era != null ? p.two.era.toFixed(2) : "—", "—", "—", "—", "—", "<b>" + f1(p.two.war) + "</b>"]);
    if (p.p && p.zips && p.zips.ip) pp.push([H.season + " ZiPS", f0(p.zips.ip), "—", p.zips.era != null ? p.zips.era.toFixed(2) : "—", "—", "—", "—", "—", "<b>" + f1(p.zips.war) + "</b>"]);
    if (pit) html += tbl(bat ? "Pitching projection" : "Projection", ["", "IP", "GS", "ERA", "FIP", "K-BB%", "K/9", "SV", "WAR"], pp);
    var hb = (p.hist && p.hist.b) || [], hp = (p.hist && p.hist.p) || [];
    if (bat || hb.length) html += tbl("Last seasons", ["Year", "Tm", "G", "PA", "HR", "R", "RBI", "SB", "AVG/OBP/SLG"],
      hb.slice().reverse().map(function (r) { return [r[0], esc(r[1] || ""), r[2], r[3], r[4], r[5], r[6], r[7], d3(r[8]) + "/" + d3(r[9]) + "/" + d3(r[10])]; }));
    if (pit && hp.length) html += tbl(bat ? "Last seasons pitching" : "Last seasons", ["Year", "Tm", "G", "GS", "IP", "W-L", "SV", "K", "BB", "ERA", "WHIP"],
      hp.slice().reverse().map(function (r) { return [r[0], esc(r[1] || ""), r[2], r[3], r[4], r[5] + "-" + r[6], r[7], r[8], r[9], r[10] != null ? Number(r[10]).toFixed(2) : "—", r[11] != null ? Number(r[11]).toFixed(2) : "—"]; }));
    if (p.ml) {
      var m = p.ml;
      html += m.ip != null
        ? tbl("Minor leagues, " + (H.season - 1), ["Level", "G", "GS", "IP", "ERA", "WHIP", "K%", "BB%"], [[esc(m.lv || ""), m.G, m.GS, m.ip, m.era, m.whip, m.k != null ? m.k + "%" : "—", m.bb != null ? m.bb + "%" : "—"]])
        : tbl("Minor leagues, " + (H.season - 1), ["Level", "G", "PA", "HR", "SB", "AVG/OBP/SLG", "wRC+"], [[esc(m.lv || ""), m.G, m.PA, m.HR, m.SB, d3(m.avg) + "/" + d3(m.obp) + "/" + d3(m.slg), m.wrc != null ? m.wrc : "—"]]);
    }
    if (!html) html = '<p class="note">No stats on file yet.</p>';
    return html;
  }
  function kv(v, k) { return "<div><b>" + v + "</b><span>" + k + "</span></div>"; }
  function closeCard() { if (card.open) card.close(); }
  card.addEventListener("click", function (e) {
    if (e.target === card || e.target.closest("[data-close]")) { closeCard(); return; }
    var add = e.target.closest("[data-add]");
    if (add) {
      var tr = Object.assign({ a: [], b: [], c: [], teams: {} }, load("trade", {})), id = add.dataset.id;
      tr.teams = tr.teams || {};
      ["a", "b", "c"].forEach(function (k) { tr[k] = (tr[k] || []).filter(function (x) { return String(x) !== id; }); });
      tr[add.dataset.add].push(isNaN(+id) ? id : +id);
      var pl = H.byId[id] || H.byId[+id];
      if (pl && tr.teams[add.dataset.add] !== pl.t) tr.teams[add.dataset.add] = (tr[add.dataset.add].every(function (x) { var q = H.byId[x]; return q && q.t === pl.t; })) ? pl.t : null;
      save("trade", tr);
      closeCard();
      location.hash = tradeHash(tr);
    }
  });

  // ---------- trade value leaderboard ----------
  function controls(extra) {
    return '<div class="controls">' +
      '<label>$ per WAR (' + H.season + ')<input type="number" step="0.1" min="2" max="30" data-cfg="dpw" value="' + H.cfg.dpw.toFixed(1) + '"></label>' +
      '<label>Yearly inflation %<input type="number" step="0.5" min="0" max="10" data-cfg="inflation" value="' + (H.cfg.inflation * 100).toFixed(1) + '"></label>' +
      '<label>Discount rate %<input type="number" step="0.5" min="0" max="20" data-cfg="discount" value="' + (H.cfg.discount * 100).toFixed(1) + '"></label>' +
      '<label title="Teams pay for less than the full projection: a margin of safety for injuries and misses">WAR counted %<input type="number" step="5" min="50" max="100" data-cfg="haircut" value="' + (H.cfg.haircut * 100).toFixed(0) + '"></label>' +
      '<label title="How much an unproven big leaguer\'s value (under 3 years of service) keeps from one year to the next">Young players keep %<input type="number" step="5" min="50" max="100" data-cfg="youngFade" value="' + (H.cfg.youngFade * 100).toFixed(0) + '"></label>' + (extra || "") + "</div>";
  }
  view.addEventListener("change", function (e) {
    var c = e.target.closest("[data-cfg]");
    if (!c) return;
    var v = +c.value;
    if (isNaN(v)) return;
    H.set(c.dataset.cfg, c.dataset.cfg === "dpw" ? v : v / 100);
    surplusCache = null;
    render();
  });
  var surplusCache = null;
  function allSurplus() {
    if (surplusCache) return surplusCache;
    surplusCache = H.players.map(function (p) { var s = H.surplus(p); return { p: p, s: s }; });
    return surplusCache;
  }
  function valuePage() {
    var q = state.q, sortDir = q.sort === "worst" ? 1 : -1, kind = q.k || "all", tm = q.t || "";
    var list = allSurplus().filter(function (x) {
      var p = x.p;
      if (tm && p.t !== tm) return false;
      if (kind === "bat" && (p.p || p.g === "min")) return false;
      if (kind === "pit" && (!p.p || p.g === "min")) return false;
      if (kind === "pros" && !(p.fv && p.g === "min")) return false;
      if (q.s && p.n.toLowerCase().indexOf(q.s.toLowerCase()) < 0) return false;
      return x.s.rows.length > 0;
    }).sort(function (a, b) { return sortDir * (a.s.pv - b.s.pv); }).slice(0, 150);
    var opt = function (v, l, cur) { return '<option value="' + v + '"' + (v === cur ? " selected" : "") + ">" + l + "</option>"; };
    var html = '<h2 class="sec">Trade Value</h2><p class="lede">Surplus value: what a player should produce over the rest of his contract or team control, at the market price of a win, minus what he\'s paid. ' +
      (H.market ? "The price of a win (" + money(H.cfg.dpw) + ") is read from the last few winters of free agent deals." : "The price of a win is an assumption until the free agent data arrives.") + " Change any assumption and every number updates.</p>";
    html += controls('<label>Team<select data-q="t">' + opt("", "All teams", tm) + H.teams.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (t) { return opt(t.abbr, t.name, tm); }).join("") + "</select></label>" +
      '<label>Players<select data-q="k">' + opt("all", "Everyone", kind) + opt("bat", "MLB hitters", kind) + opt("pit", "MLB pitchers", kind) + opt("pros", "Prospects", kind) + "</select></label>" +
      '<label>Show<select data-q="sort">' + opt("", "Most surplus", q.sort || "") + opt("worst", "Worst contracts", q.sort || "") + "</select></label>" +
      '<label>Search<input type="search" data-q="s" value="' + esc(q.s || "") + '" placeholder="Player"></label>');
    html += '<div class="panel"><div class="scroll"><table class="t"><thead><tr><th>Player</th><th>Team</th><th>Pos</th><th>Age</th><th>Contract</th><th>Thru</th><th>' + H.season + ' WAR</th><th>Total</th><th>Surplus (PV)</th></tr></thead><tbody>';
    list.forEach(function (x, i) {
      var p = x.p, s = x.s, lastY = s.rows.length ? s.rows[s.rows.length - 1].y : "—";
      var ctr = p.c && p.c.desc ? p.c.desc.replace(/\s*\(.*?\)/, "") : p.fv && p.g === "min" ? "Prospect · FV " + p.fv : s.rows[0] ? s.rows[0].kind : "";
      html += "<tr><td>" + (i + 1) + ". " + pname(p, 22) + "</td><td>" + logo(p.t, 18) + "</td><td>" + esc(p.pos || "") + "</td><td>" + (p.age ? Math.floor(p.age) : "—") +
        '</td><td style="text-align:left;max-width:220px;overflow:hidden;text-overflow:ellipsis">' + esc(ctr) + "</td><td>" + lastY + "</td><td>" + f1(H.warAt(p, H.season)) + "</td><td>" + signed(s.total) +
        '</td><td class="' + (s.pv >= 0 ? "pos" : "neg") + '"><b>' + signed(s.pv) + "</b></td></tr>";
    });
    html += "</tbody></table></div></div>";
    view.innerHTML = html;
  }
  view.addEventListener("change", function (e) {
    var c = e.target.closest("[data-q]");
    if (!c) return;
    var q = Object.assign({}, state.q);
    q[c.dataset.q] = c.value || null;
    location.hash = href(state.route, q);
  });

  // ---------- trade builder ----------
  // A trade lives in the address bar: a=, b=, c= are each side's players; ta=, tb=, tc= the team each side is
  function tradeHash(tr) {
    var q = {};
    ["a", "b", "c"].forEach(function (k) {
      if (tr[k] && tr[k].length) q[k] = tr[k].join(",");
      if (tr.teams && tr.teams[k]) q["t" + k] = tr.teams[k];
    });
    if (tr.three) q.three = 1;
    return href("trade", q);
  }
  function tradeState() {
    var q = state.q, tr = { a: [], b: [], c: [], teams: {}, three: !!q.three }, any = false;
    ["a", "b", "c"].forEach(function (k) {
      if (q[k]) { any = true; tr[k] = q[k].split(",").map(function (x) { return isNaN(+x) ? x : +x; }).filter(function (id) { return H.byId[id]; }); }
      if (q["t" + k] && H.byAbbr[q["t" + k]]) { any = true; tr.teams[k] = q["t" + k]; }
    });
    if (!any) { var saved = load("trade", null); if (saved) tr = Object.assign(tr, saved, { teams: saved.teams || {} }); }
    if ((tr.c || []).length || tr.teams.c) tr.three = true;
    return tr;
  }
  function sideName(tr, k, i) { return tr.teams[k] ? team(tr.teams[k]).name : "Side " + "ABC"[i]; }
  function tradePage() {
    var tr = tradeState();
    save("trade", tr);
    var sides = tr.three ? ["a", "b", "c"] : ["a", "b"], totals = {};
    var teamOpts = function (cur) {
      return '<option value="">Any team</option>' + H.teams.slice().sort(function (x, y) { return x.name.localeCompare(y.name); })
        .map(function (t) { return '<option value="' + t.abbr + '"' + (t.abbr === cur ? " selected" : "") + ">" + esc(t.name) + "</option>"; }).join("");
    };
    var html = '<h2 class="sec">Trade Builder</h2><p class="lede">Pick a team for each side, then add players and prospects from its roster and farm (or search anyone). Compare the surplus value changing hands. Every trade has its own link, so you can send it.</p>';
    html += controls();
    html += '<div class="sides">';
    sides.forEach(function (k, i) {
      var ids = tr[k] || [], tot = 0, rows = "", tm = tr.teams[k];
      ids.forEach(function (id) {
        var p = H.byId[id], sv = H.surplus(p);
        tot += sv.pv;
        rows += "<li>" + pname(p, 28) + '<span class="grow"><span class="sub">' + logo(p.t, 14) + " " + esc(p.pos || "") + " · " + (p.c && p.c.desc ? esc(p.c.desc.replace(/\s*\(.*?\)/, "")) : p.fv && p.g === "min" ? "FV " + esc(p.fv) : esc((sv.rows[0] || {}).kind || "")) +
          '</span></span><b class="' + (sv.pv >= 0 ? "pos" : "neg") + '">' + signed(sv.pv) + '</b><button class="xbtn" data-rm="' + k + '" data-id="' + esc(id) + '" aria-label="Remove">×</button></li>';
      });
      totals[k] = tot;
      html += '<div class="side"><div class="side-h">' + (tm ? logo(tm, 28) : "") + '<select data-tside="' + k + '" aria-label="Team for side ' + "ABC"[i] + '">' + teamOpts(tm) + "</select></div>" +
        '<div class="search"><input type="search" placeholder="' + (tm ? "Search the " + esc(team(tm).name) : "Search any player or prospect") + '" data-side="' + k + '" autocomplete="off"><div class="results" hidden></div></div>' +
        '<p class="sends">Sends</p><ul class="rlist">' + (rows || '<li class="note">No one yet.</li>') + '</ul><div class="tot"><span>Surplus sent</span><span class="num">' + signed(tot) + "</span></div>" +
        (tm ? orgPicker(tm, k, ids) : "") + "</div>";
    });
    html += "</div>";
    if (!tr.three) html += '<p><button class="btn" data-three>+ Add a third team</button></p>';
    var a = totals.a || 0, b = totals.b || 0;
    if ((tr.a || []).length && (tr.b || []).length && !tr.three) {
      var d = a - b, close = Math.abs(d) < Math.max(5, 0.1 * Math.max(Math.abs(a), Math.abs(b)));
      var na = sideName(tr, "a", 0), nb = sideName(tr, "b", 1);
      html += '<div class="verdict">' + (close ? "<b>Even.</b> The surplus going each way is within " + money(Math.abs(d)) + "."
        : "<b>" + esc(d > 0 ? nb : na) + " win" + (/s$/.test(d > 0 ? nb : na) ? "" : "s") + "</b> by " + money(Math.abs(d)) + " of surplus value.") +
        "<small>" + esc(na) + " send " + signed(a) + ", " + esc(nb) + " send " + signed(b) + ". Surplus isn't everything: contenders pay for wins now, and a team's payroll room matters.</small></div>";
    } else if (tr.three && sides.every(function (k) { return (tr[k] || []).length; })) {
      html += '<div class="verdict"><b>Three-team deal.</b> ' + sides.map(function (k, i) { return esc(sideName(tr, k, i)) + " send " + signed(totals[k]); }).join(" · ") + "<small>Compare what each side gives up.</small></div>";
    }
    html += '<p><button class="btn" data-clear>Clear the trade</button></p>';
    view.innerHTML = html;
  }
  // A team's roster and farm, best surplus first, to add with one tap
  function orgPicker(abbr, k, ids) {
    var on = {};
    (ids || []).forEach(function (id) { on[id] = 1; });
    var list = H.org(abbr).map(function (p) { return { p: p, s: H.surplus(p) }; })
      .filter(function (x) { return x.s.rows.length && !on[x.p.id]; })
      .sort(function (x, y) { return (x.p.g === "min") - (y.p.g === "min") || y.s.pv - x.s.pv; });
    var row = function (x) {
      return '<button type="button" class="org-row" data-pick="' + esc(x.p.id) + '" data-side="' + k + '">' + face(x.p, 22) + '<span class="grow">' + esc(x.p.n) + ' <span class="note">' + esc(x.p.pos || "") + (x.p.fv && x.p.g === "min" ? " · FV " + esc(x.p.fv) : "") + '</span></span><b class="' + (x.s.pv >= 0 ? "pos" : "neg") + '">' + signed(x.s.pv) + "</b></button>";
    };
    var mlb = list.filter(function (x) { return x.p.g !== "min"; }), farm = list.filter(function (x) { return x.p.g === "min"; }).slice(0, 25);
    return '<details class="org" open><summary>' + esc(team(abbr).name) + " roster</summary>" + mlb.map(row).join("") + "</details>" +
      '<details class="org"><summary>Farm system</summary>' + farm.map(row).join("") + "</details>";
  }
  var searchIdx = null;
  function search(q, abbr) {
    if (!searchIdx) searchIdx = H.players.map(function (p) { return { p: p, k: p.n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") }; });
    q = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    if (q.length < 2) return [];
    return searchIdx.filter(function (x) { return x.k.indexOf(q) >= 0 && (!abbr || x.p.t === abbr); })
      .sort(function (a, b) { return (b.k.indexOf(q) === 0) - (a.k.indexOf(q) === 0) || (b.p.g !== "min") - (a.p.g !== "min") || (b.p.rate || 0) - (a.p.rate || 0); })
      .slice(0, 12).map(function (x) { return x.p; });
  }
  view.addEventListener("input", function (e) {
    var inp = e.target.closest("input[data-side]");
    if (!inp) return;
    var tr = tradeState(), box = inp.nextElementSibling, res = search(inp.value, tr.teams[inp.dataset.side]);
    box.hidden = !res.length;
    box.innerHTML = res.map(function (p) {
      return '<button type="button" data-pick="' + esc(p.id) + '" data-side="' + inp.dataset.side + '">' + face(p, 22) + "<span>" + esc(p.n) + ' <span class="note">' + esc(p.t) + " · " + esc(p.pos || "") + (p.fv && p.g === "min" ? " · FV " + esc(p.fv) : "") + "</span></span></button>";
    }).join("");
  });
  view.addEventListener("keydown", function (e) {
    var inp = e.target.closest("input[data-side]");
    if (inp && e.key === "Enter") { var b = inp.nextElementSibling.querySelector("button"); if (b) b.click(); }
  });
  view.addEventListener("change", function (e) {
    var sel = e.target.closest("select[data-tside]");
    if (!sel) return;
    var tr = tradeState(), k = sel.dataset.tside;
    tr.teams[k] = sel.value || null;
    if (sel.value) tr[k] = (tr[k] || []).filter(function (id) { return H.byId[id] && H.byId[id].t === sel.value; });
    save("trade", tr);
    location.hash = tradeHash(tr);
  });
  view.addEventListener("click", function (e) {
    var pick = e.target.closest("[data-pick]"), rm = e.target.closest("[data-rm]"), clear = e.target.closest("[data-clear]"), three = e.target.closest("[data-three]");
    if (!pick && !rm && !clear && !three) return;
    e.stopPropagation();
    var tr = tradeState();
    if (clear) tr = { a: [], b: [], c: [], teams: {}, three: false };
    if (three) tr.three = true;
    if (pick) {
      var id = isNaN(+pick.dataset.pick) ? pick.dataset.pick : +pick.dataset.pick;
      ["a", "b", "c"].forEach(function (k) { tr[k] = (tr[k] || []).filter(function (x) { return x !== id; }); });
      tr[pick.dataset.side].push(id);
    }
    if (rm) {
      var rid = isNaN(+rm.dataset.id) ? rm.dataset.id : +rm.dataset.id;
      tr[rm.dataset.rm] = tr[rm.dataset.rm].filter(function (x) { return x !== rid; });
    }
    save("trade", tr);
    location.hash = tradeHash(tr);
  }, true);

  // ---------- free agents ----------
  function faPage() {
    var mk = H.market, board = H.faBoard(), q = state.q;
    var html = '<h2 class="sec">Free Agents</h2>';
    if (!board.length) {
      view.innerHTML = html + '<p class="lede">This winter\'s free agent class arrives with the next data pull.</p>';
      return;
    }
    var signedN = board.filter(function (x) { return x.signedAav; }).length;
    html += '<p class="lede">' + board.length + " free agents, " + signedN + " signed so far. <b>Fair</b> is what each is worth per year over the crowd's contract length at the market price of a win (" + money(H.cfg.dpw) + "). <b>Market</b> adjusts for what deals of that length have actually gone for compared with that price. The crowd numbers are FanGraphs readers' median predictions.</p>";
    if (mk) html += marketCallout(mk);
    var show = q.f || "all";
    var opt = function (v, l) { return '<option value="' + v + '"' + (v === show ? " selected" : "") + ">" + l + "</option>"; };
    html += controls('<label>Show<select data-q="f">' + opt("all", "Everyone") + opt("open", "Still unsigned") + opt("signed", "Signed") + opt("bat", "Hitters") + opt("sp", "Starters") + opt("rp", "Relievers") + "</select></label>");
    var list = board.filter(function (x) {
      var pos = String(x.r.pos || "");
      if (show === "open") return !x.signedAav;
      if (show === "signed") return !!x.signedAav;
      if (show === "rp") return /RP/.test(pos);
      if (show === "sp") return /SP/.test(pos);
      if (show === "bat") return !/P$|SP|RP/.test(pos);
      return true;
    });
    html += '<div class="panel"><div class="scroll"><table class="t"><thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>From</th><th>Proj WAR</th><th>QO</th><th>Crowd</th><th>Fair / yr</th><th>Market / yr</th><th>Signed</th><th>vs Market</th></tr></thead><tbody>';
    list.forEach(function (x, i) {
      var r = x.r, p = x.p || { id: r.id, n: r.n, t: null };
      var pl = x.p ? pname(x.p, 24) : '<span class="pl">' + window.DSFaces.html({ sport: "mlb", id: r.id, name: r.n, size: 24 }) + '<span class="nm">' + esc(r.n) + "</span></span>";
      if (!x.p && r.id) pl = pl.replace('class="pl"', 'class="pl" data-fa="' + esc(r.id) + '"');
      html += "<tr><td>" + (i + 1) + ". " + pl + "</td><td>" + esc(r.pos || "") + "</td><td>" + (x.age || "—") + "</td><td>" + (r.from ? esc(r.from) : "") + "</td><td>" + f1(x.war) + "</td><td>" + (r.qo ? '<span class="pill warn">QO</span>' : "") +
        "</td><td>" + (r.my ? r.my + " yr · " + money(x.crowdAav) : "—") + "</td><td>" + money(x.spotAav) + "</td><td><b>" + money(x.mktAav) + "</b></td><td>" +
        (x.signedAav ? esc(r.to || "") + " " + (r.yrs || "?") + " yr · " + money(x.signedAav) : '<span class="note">unsigned</span>') + "</td><td class=\"" + (x.gap == null ? "" : x.gap > 0 ? "neg" : "pos") + '">' +
        (x.gap == null ? "" : (x.gap > 0 ? "+" : "") + pct(x.gap, 0)) + "</td></tr>";
    });
    html += "</tbody></table></div></div>";
    if (mk) html += marketSection(mk);
    view.innerHTML = html;
  }
  function marketCallout(mk) {
    var b = mk.buckets[0].rows, get = function (k) { return b.filter(function (r) { return r.k === k; })[0]; };
    var long = get("6+ years"), mid = get("4-5 years"), one = get("1 year"), q = mk.buckets[4].rows.filter(function (r) { return r.k !== "No QO"; })[0];
    var sg = function (x) { return (x >= 0 ? "+" : "") + pct(x, 0); };
    var lead = mk.how === "crowd"
      ? "A projected win costs about <b>" + money(H.cfg.dpw) + "</b> this winter: Steamer's projections for this class against the crowd's predicted contracts (" + money(mk.crowdDpw) + " a win, " + mk.crowdN + " players), plus the " + sg(mk.crowdErr - 1) + " past crowds missed by."
      : "A projected win costs about <b>" + money(H.cfg.dpw) + "</b> this winter, carried forward from the last three classes.";
    return '<div class="callout">' + lead +
      (one && long ? " Against the going rate, one-year deals came in at <b>" + sg(one.prem) + "</b>; " + (mid ? "four- and five-year deals at <b>" + sg(mid.prem) + "</b>, " : "") + "six years or more at <b>" + sg(long.prem) + "</b>. Teams pay a premium for length, up front, for the years they expect to regret." : "") +
      (q ? " Players who turned down a qualifying offer got <b>" + sg(q.prem) + "</b>." : "") + "</div>";
  }
  function marketSection(mk) {
    var html = '<h2 class="sec">What free agents cost</h2><p class="lede">Every deal of the last few winters for a player projected at 1+ WAR, against that winter\'s market price of the wins it should buy. Projections at signing are estimated from the season before, fit to how Steamer projects this winter\'s class, and aged over the contract. Above zero means teams paid more than the going rate. Bars run from -50% to +50%.</p>';
    html += '<div class="prem">';
    mk.buckets.forEach(function (b) {
      html += '<div class="panel"><h3>' + esc(b.label) + '</h3><div class="body"><table class="t"><thead><tr><th></th><th>Deals</th><th>Premium</th><th></th></tr></thead><tbody>';
      b.rows.forEach(function (r) {
        var w = Math.max(-0.5, Math.min(0.5, r.prem)), left = w >= 0 ? 50 : 50 + w * 100, width = Math.abs(w) * 100;
        html += "<tr><td>" + esc(r.k) + "</td><td>" + r.n + '</td><td class="' + (r.prem >= 0 ? "neg" : "pos") + '">' + (r.prem >= 0 ? "+" : "") + pct(r.prem, 0) +
          '</td><td><div class="pbar"><span class="mid"></span><b style="left:' + left + "%;width:" + width + "%;background:" + (r.prem >= 0 ? "var(--red)" : "var(--up)") + '"></b></div></td></tr>';
      });
      html += "</tbody></table></div></div>";
    });
    html += "</div>";
    html += '<div class="panel"><h3>How the crowd did <small>actual contracts vs FanGraphs readers\' predictions</small></h3><div class="body"><div class="payroll">' +
      Object.keys(mk.crowdByClass).sort().map(function (y) { var r = mk.crowdByClass[y] - 1; return '<div><b class="' + (r >= 0 ? "neg" : "pos") + '">' + (r >= 0 ? "+" : "") + pct(r, 0) + "</b><span>" + (y - 1) + "-" + String(y).slice(2) + " winter</span></div>"; }).join("") +
      '</div><p class="note" style="margin:8px 0 0">Total dollars signed for against the crowd\'s predicted total, deals of $3M or more. Positive means players got more than the crowd guessed.</p></div></div>';
    var surprise = [];
    Object.keys(H.fa.classes || {}).forEach(function (y) {
      if (+y >= H.season) return;
      H.fa.classes[y].forEach(function (r) {
        if (!r.aav || !r.yrs || !r.ma || !r.my) return;
        var tot = r.aav * r.yrs / 1e6, ct = r.ma * r.my / 1e6;
        if (Math.max(tot, ct) < 40) return;
        surprise.push({ y: +y, r: r, tot: tot, ct: ct, d: tot / ct - 1 });
      });
    });
    var over = surprise.slice().sort(function (a, b) { return b.d - a.d; }).slice(0, 8), under = surprise.slice().sort(function (a, b) { return a.d - b.d; }).slice(0, 8);
    var row = function (x) { return "<li>" + window.DSFaces.html({ sport: "mlb", id: x.r.id, name: x.r.n, size: 26 }) + '<span class="grow">' + esc(x.r.n) + '<span class="sub">' + (x.y - 1) + "-" + String(x.y).slice(2) + " · " + esc(x.r.to || "") + " · signed " + x.r.yrs + " yr, " + money(x.tot, 0) + " · crowd " + x.r.my + " yr, " + money(x.ct, 0) + '</span></span><b class="' + (x.d > 0 ? "neg" : "pos") + '">' + (x.d > 0 ? "+" : "") + pct(x.d, 0) + "</b></li>"; };
    html += '<div class="two"><div class="panel"><h3>Got more than the crowd guessed <small>$40M+ deals</small></h3><ul class="rlist">' + over.map(row).join("") + '</ul></div><div class="panel"><h3>Got less <small>$40M+ deals</small></h3><ul class="rlist">' + under.map(row).join("") + "</ul></div></div>";
    return html;
  }

  // ---------- method ----------
  function methodPage() {
    var mk = H.market;
    view.innerHTML = '<div class="method"><h2 class="sec">How it works</h2>' +
      "<h3>Where the numbers come from</h3><ul>" +
      "<li><b>Projections:</b> FanGraphs Depth Charts (" + (HUB.systems.indexOf("zips") >= 0 ? "Steamer and ZiPS" : "Steamer; ZiPS is added automatically once it's published") + ") for the coming season, with FanGraphs' own playing time. Steamer covers the minor leaguers too.</li>" +
      "<li><b>Rosters and depth:</b> RosterResource, every organization from the majors down to A ball, with service time and options.</li>" +
      "<li><b>Contracts:</b> RosterResource payroll pages, year by year, with options and arbitration years (" + HUB.payrollTeams + " of 30 teams on file).</li>" +
      "<li><b>Prospects:</b> FanGraphs' The Board: FV grade, risk and ETA" + (HUB.board ? " (" + esc(HUB.board) + ")" : "") + ".</li>" +
      "<li><b>Free agents:</b> RosterResource's free agent tracker for this winter and the five before it, including crowd predictions and the contracts players signed.</li>" +
      "<li><b>Photos:</b> linked from MLB's own servers.</li></ul>" +
      "<h3>The year slider</h3><p>" + H.season + " is FanGraphs' Depth Charts as published. Every later season is built here: a player stays while he's under a guaranteed contract, a club option worth picking up, a player option he'd keep, or team control (pre-arb under three years of service, arbitration until six). Everyone else becomes a free agent, unless you re-sign him on his team's page. Ratings age a year at a time (modest gains into the mid-20s, flat at 27 and 28, falling from 29 and faster after 32), and playing time grows slowly from FanGraphs' share for the coming season. Prospects arrive at their ETA (or by level when there isn't one) and grow toward the WAR their FV grade implies over their first three seasons. Each spot goes to the best available player who can play it; a team gets five starters and eight relievers. Spots nobody can fill are \"FA Fill\": a replacement player, or a modest free agent if teams sign them (the switch). Wins scale from team WAR so later seasons spread the way Depth Charts' do.</p>" +
      "<h3>Surplus value</h3><p>For each season of contract or control: projected WAR × the price of a win, minus salary, discounted " + pct(H.cfg.discount, 0) + " a year. Like front offices, it counts " + pct(H.cfg.haircut, 0) + " of projected WAR (a margin of safety for injuries and misses), and an unproven big leaguer (under three years of service) keeps " + pct(H.cfg.youngFade, 0) + " of his value from one year to the next, since long control on a short track record is worth less than its projection adds up to. Those two defaults are calibrated to Baseball Trade Values' published values, and you can change both on the Trade Value tab. Value never drops below zero (a team can always play a replacement for the minimum), and a pre-arb or arbitration year can't cost the team more than it's worth, since those salaries aren't guaranteed. Arbitration pays 25/40/60% of market value (a fourth year 70%); pre-arb players earn the minimum (" + money(H.cfg.minSalary) + ", until the next CBA says otherwise). Club options are exercised only when they're worth it, and a player option only comes back when it's bad for the team. A prospect's value is scaled by his risk grade.</p>" +
      "<h3>The price of a win</h3><p>" + (mk ? (mk.how === "crowd" ? "This winter's free agents: Steamer's projected WAR for each, aged over the contract the crowd predicts, against the crowd's predicted dollars, then adjusted by how far past crowds landed from real contracts (" + ((mk.crowdErr - 1) >= 0 ? "+" : "") + pct(mk.crowdErr - 1, 0) + "). That gives " + money(H.cfg.dpw) + " per win." : "Carried forward from the last three winters' deals: " + money(H.cfg.dpw) + " per win.") + " The premium patterns on the Free Agents tab come from every deal of the last five winters for a player projected at 1+ WAR, against that winter's going rate. Past classes don't carry the projection at signing, so it's estimated from the season before, fit to how Steamer projects this winter's class." : "The free agent data hasn't arrived yet, so the price of a win is an assumption: " + money(H.cfg.dpw) + ".") + "</p>" +
      "<h3>What it doesn't know</h3><ul><li>Trades and signings that haven't happened, beyond the switch for filling open spots.</li><li>Injuries after the first season, platoons, and teams' payroll limits.</li><li>Super Two arbitration, and anything the next CBA changes (the current one expires December 1, 2026).</li></ul>" +
      '<p class="note">Data pulled ' + esc(HUB.pulled || "—") + ", built " + esc(HUB.built) + (HUB.failed && HUB.failed.length ? " (last pull missed: " + esc(HUB.failed.join(", ")) + "; using the previous copy)" : "") + ".</p></div>";
  }

  // ---------- start ----------
  Promise.all([
    fetch("data/hub.json", { cache: "no-cache" }).then(function (r) { return r.json(); }),
    fetch("data/fa.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : { classes: {} }; }).catch(function () { return { classes: {} }; })
  ]).then(function (d) {
    HUB = d[0];
    H = new M.Hub(HUB, d[1]);
    var f = load("fill", true);
    fillBox.checked = f;
    H.set("fill", f);
    $("#kicker").textContent = "MLB · " + HUB.season + " projections";
    $("#foot").textContent = "Data from FanGraphs (Depth Charts, Steamer, RosterResource, The Board), pulled " + (HUB.pulled || "—") + ". Photos from MLB.";
    render();
  }).catch(function (e) {
    view.innerHTML = '<p class="loading">Couldn\'t load the data. ' + esc(e.message) + "</p>";
  });
})();
