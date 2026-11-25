/* MLB Hub: screens. The numbers come from model.js; the data from data/hub.json and data/fa.json (built every
   morning by tools/mlb_hub_build.py). Routes live in the address bar so any view can be shared:
     #/standings?y=2028   #/team/BOS?y=2029   #/teams   #/value   #/trade?a=..&b=..   #/fa   #/method */
(function () {
  "use strict";
  var M = window.MLBModel, H = null, HUB = null;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var view = $("#view"), years = $("#years"), yearbar = $("#yearbar"), fillBox = $("#fill");
  var state = { year: null, route: "standings", arg: null, q: {} };
  // Fence distances in feet (left-field line, left-center, center, right-center, right-field line) and any wall that
  // stands out, for drawing each team's own park. Approximate, from published dimensions.
  var PARKS = {
    ARI: ["Chase Field", [330, 374, 407, 374, 334]], ATL: ["Truist Park", [335, 385, 400, 375, 325]],
    BAL: ["Camden Yards", [333, 376, 400, 373, 318]], BOS: ["Fenway Park", [310, 379, 390, 380, 302], { lf: "37-ft Green Monster" }],
    CHC: ["Wrigley Field", [355, 368, 400, 368, 353]], CWS: ["Rate Field", [330, 375, 400, 375, 335]],
    CIN: ["Great American Ball Park", [328, 379, 404, 370, 325]], CLE: ["Progressive Field", [325, 370, 400, 375, 325], { lf: "19-ft wall" }],
    COL: ["Coors Field", [347, 390, 415, 375, 350]], DET: ["Comerica Park", [345, 370, 412, 365, 330]],
    HOU: ["Daikin Park", [315, 362, 409, 373, 326], { lf: "Crawford Boxes" }], KC: ["Kauffman Stadium", [330, 387, 410, 387, 330]],
    LAA: ["Angel Stadium", [347, 390, 396, 370, 350]], LAD: ["Dodger Stadium", [330, 375, 395, 375, 330]],
    MIA: ["loanDepot park", [344, 386, 400, 387, 335]], MIL: ["American Family Field", [344, 371, 400, 374, 345]],
    MIN: ["Target Field", [339, 377, 404, 367, 328], { rf: "23-ft wall" }], NYM: ["Citi Field", [335, 370, 408, 375, 330]],
    NYY: ["Yankee Stadium", [318, 399, 408, 385, 314], { rf: "short porch" }], ATH: ["Sutter Health Park", [330, 388, 403, 388, 325]],
    PHI: ["Citizens Bank Park", [329, 374, 401, 369, 330]], PIT: ["PNC Park", [325, 389, 399, 375, 320], { rf: "21-ft Clemente Wall" }],
    SD: ["Petco Park", [334, 357, 396, 382, 322]], SF: ["Oracle Park", [339, 364, 391, 415, 309], { rf: "24-ft wall, Triples Alley" }],
    SEA: ["T-Mobile Park", [331, 378, 401, 381, 326]], STL: ["Busch Stadium", [336, 375, 400, 375, 335]],
    TB: ["Tropicana Field", [315, 370, 404, 370, 322]], TEX: ["Globe Life Field", [329, 372, 407, 374, 326]],
    TOR: ["Rogers Centre", [328, 368, 400, 359, 328]], WSH: ["Nationals Park", [336, 377, 402, 370, 335]]
  };
  // Where each card sits, in feet from home plate (x toward first base, y toward center field). The drawing's frame runs
  // 272 ft either side of the plate and from 452 ft out to 70 ft behind it, so feet map straight onto the box.
  var VB = { x: -272, y: -452, w: 544, h: 522 };
  var SPOT_FT = {
    CF: [0, 340], LF: [-150, 268], RF: [150, 268], SS: [-64, 166], "2B": [64, 166], "3B": [-104, 88], "1B": [104, 88],
    C: [0, -36], DH: [-196, -36]
  };
  var SPOT_XY = {};
  Object.keys(SPOT_FT).forEach(function (k) {
    var f = SPOT_FT[k]; SPOT_XY[k] = [((f[0] - VB.x) / VB.w * 100).toFixed(2), ((-f[1] - VB.y) / VB.h * 100).toFixed(2)];
  });

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
  function ord(n) { var v = n % 100; return n + (v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"); }
  // A free agent's name on the Free Agents tab: his player card once he's on a roster (a signing shows its grade
  // there), otherwise his free agent card
  function faName(x, size) {
    var r = x.r;
    if (x.p) return pname(x.p, size);
    return '<button type="button" class="pl card-link" data-fa="' + esc(faKey(r)) + '">' + window.DSFaces.html({ sport: "mlb", id: r.id, name: r.n, size: size }) + '<span class="nm">' + esc(r.n) + '</span></button>';
  }
  // One line on a signing: the grade and why
  function gradeLine(x) {
    var gr = x && x.grade, r = x && x.r;
    if (!gr) return "";
    var nd = gr.need, tn = r.to && team(r.to) ? team(r.to).name : r.to;
    var needTxt = !nd ? "" : gr.credit
      ? " It fills a hole: without him the " + esc(tn) + "' " + esc(nd.label) + " ranks " + ord(nd.rank) + " in the majors and he adds " + f1(nd.up) + " WAR there, so a bit more premium is forgiven."
      : " Without him the " + esc(tn) + "' " + esc(nd.label) + " would rank " + ord(nd.rank) + " (he adds " + f1(nd.up) + " WAR there): an upgrade more than a hole filled.";
    return '<p class="graded">' + gradeTag(gr) + "<span><b>" + r.yrs + " yr, " + money(gr.paid, 0) + "</b> against a market price of " + money(gr.mkt, 0) + " for deals this long: " +
      pct(Math.abs(gr.edge), 0) + (gr.edge >= 0 ? " under" : " over") + " market" + (gr.pick ? ", counting a small dock for the qualifying-offer pick" : "") + "." + needTxt + "</span></p>";
  }
  // A projection counted at less than face value, and why
  function faithNote(r, trust, proj) {
    if (!(trust < 1)) return "";
    var rec = r.mlb ? (/SP|RP|P$/.test(String(r.pos || "")) ? Math.round(r.mlb[1] || 0) + " big league innings" : (r.mlb[0] || 0) + " big league plate appearances") : "a thin big league record";
    return "FanGraphs projects " + f1(proj) + " WAR, counted here at " + pct(trust, 0) + ": " + rec + " over the last three seasons, so the projection leans on numbers from outside the majors.";
  }
  function gradeTag(gr) { return gr ? '<span class="grade g-' + gr.g.charAt(0).toLowerCase() + '" title="' + esc(pct(Math.abs(gr.edge), 0) + (gr.edge >= 0 ? " under" : " over") + " market" + (gr.pick ? ", after the qualifying-offer pick" : "") + (gr.credit ? "; fills a need" : "")) + '">' + esc(gr.g) + "</span>" : ""; }
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
    return '<span class="pl" data-p="' + esc(p.id) + '">' + face(p, size || 22) + (extra || "") + '<span class="nm">' + esc(p.n) + "</span>" + injTag(p) + "</span>";
  }
  // On the injured list (or the restricted list): a tag with RosterResource's note on hover, the way every hub shows injuries
  function injTag(p) {
    if (!p || !p.inj || p.g === "min") return "";
    var res = /restricted/i.test(p.inj), code = res ? "RES" : "IL";
    return ' <span class="injd inj-' + code.toLowerCase() + '" data-tip="' + esc((res ? "" : "Injured list: ") + p.inj) + '" tabindex="0" role="img" aria-label="' + esc(p.inj) + '">' + code + "</span>";
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
    // the Contracts tab is a team's contracts & cap view (the last team opened, or Boston)
    if (state.route === "contracts") { state.route = "team"; state.arg = state.arg || load("team", "BOS"); state.q.view = "money"; }
    if (state.route === "team" && state.arg) save("team", state.arg.toUpperCase());
    var y = +q.y;
    state.year = y && y >= H.season && y < H.season + H.cfg.years ? y : (state.year || H.season);
  }
  // Four sections, as in the NBA Hub; grouped pages get a sub-tab row, and a section tab returns to the page last used in it
  var GROUP = { standings: "standings", teams: "teams", team: "teams", statcast: "players", luck: "players", arsenal: "players", value: "trades", trade: "trades", fa: "fa" };
  // the teams you follow (assets/follow.js), above the main pages; redrawn when you follow or unfollow
  function yoursSlot() {
    var el = document.getElementById("ds-yours-slot");
    if (!el) { el = document.createElement("div"); el.id = "ds-yours-slot"; view.parentNode.insertBefore(el, view); }
    var show = window.Follow && H && ["standings","teams"].indexOf(state.route) >= 0;
    el.innerHTML = show ? Follow.strip("mlb", Object.keys(H.byAbbr).map(function (a) { var t = team(a); return { id: a, href: href("team/" + a, {}), logo: logo(a, 28), name: t.short || t.name, sub: "" }; })) : "";
  }
  window.addEventListener("ds-follow", function (e) { if (e.detail && e.detail.sport === "mlb") yoursSlot(); });
  function render() {
    parse();
    var money = state.route === "team" && state.q.view === "money", group = GROUP[state.route] || "standings";
    var moneyHref = href("team/" + (state.route === "team" && state.arg ? state.arg.toUpperCase() : load("team", "BOS")), { view: "money" });
    var SUBS = { teams: [["teams", "Teams", href("teams", {})], ["money", "Contracts", moneyHref]], players: [["statcast", "Statcast", href("statcast", {})], ["luck", "Expected vs. actual", href("luck", {})], ["arsenal", "Pitch arsenals", href("arsenal", {})]], trades: [["value", "Trade value", href("value", {})], ["trade", "Builder", href("trade", {})]] };
    var cur = money ? "money" : state.route === "team" ? "teams" : state.route, subs = SUBS[group];
    if (subs && (state.route === "value" || state.route === "trade")) save("sub.trades", state.route);
    if (group === "players") save("sub.players", state.route);
    document.querySelectorAll(".tabs a").forEach(function (a) {
      if (a.dataset.tab === group) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      if (a.dataset.tab === "trades") a.setAttribute("href", href(load("sub.trades", "value"), {}));
      if (a.dataset.tab === "players") a.setAttribute("href", href(load("sub.players", "statcast"), {}));
    });
    var st = $("#subtabs");
    st.hidden = !subs;
    if (subs) st.innerHTML = subs.map(function (x) { return '<a href="' + x[2] + '"' + (x[0] === cur ? ' aria-current="page"' : "") + ">" + x[1] + "</a>"; }).join("");
    var withYears = state.route === "standings" || state.route === "team";
    yearbar.hidden = !withYears;
    if (withYears) drawYears();
    var fn = { standings: standings, team: teamPage, teams: teamsPage, statcast: statcastPage, luck: luckPage, arsenal: arsenalPage, value: valuePage, trade: tradePage, fa: faPage, method: methodPage }[state.route] || standings;
    fn();
    yoursSlot();
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
    if (p && !e.target.closest(".results")) { openCard(p.dataset.p); return; }
    var fa = e.target.closest("[data-fa]");
    if (fa) openFaCard(fa.dataset.fa, fa.dataset.tab);
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
    var sub = state.q.view === "money" ? "money" : state.q.view === "farm" ? "farm" : state.q.view === "statcast" ? "statcast" : "depth";
    var subHref = function (k) { return href("team/" + abbr, { y: y === H.season ? null : y, view: k === "depth" ? null : k }); };
    // the shared team header (assets/pcard.js), its pages as tabs, then the division picker
    var html = window.PCard.teamHead({ logo: logo(abbr, 44), name: t.name, follow: { sport: "mlb", id: abbr }, color: t.color || "var(--ink)",
      meta: [t.lg + " " + t.div, y + " projection"],
      chips: [[money(H.payroll(abbr, y), 0) + " payroll", ""], [f1(tm.war) + " team WAR", ""], ["Hitting " + ordinal(H.rank(y, "bat", tm.bat)) + ", pitching " + ordinal(H.rank(y, "pit", tm.pit)), ""]],
      head: [{ v: w + "-" + (162 - w), l: "Projected" }, { v: pct(st.playoff), l: "Playoffs" }, { v: pct(st.ws), l: "World Series" }],
      tabs: [{ label: "Depth chart", href: subHref("depth"), on: sub === "depth" }, { label: "Contracts and cap", href: subHref("money"), on: sub === "money" }, { label: "Farm system", href: subHref("farm"), on: sub === "farm" }, { label: "Statcast", href: subHref("statcast"), on: sub === "statcast" }] });
    html += '<div class="teampick">' + H.teams.filter(function (x) { return x.lg === t.lg && x.div === t.div && x.abbr !== abbr; }).map(function (x) {
      return '<a href="' + href("team/" + x.abbr, { y: y === H.season ? null : y }) + '">' + logo(x.abbr, 18) + esc(x.name) + "</a>";
    }).join("") + "</div>";
    if (sub === "money") { view.innerHTML = html + moneyView(abbr, y); return; }
    if (sub === "farm") { view.innerHTML = html + farmPanel(abbr, true); return; }
    if (sub === "statcast") { view.innerHTML = html + teamStatcast(abbr); return; }
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
    html += '<p class="note">Salaries, contracts and the luxury tax are on the <a href="' + href("team/" + abbr, { y: y === H.season ? null : y, view: "money" }) + '">Contracts &amp; cap</a> tab; every prospect on <a href="' + href("team/" + abbr, { view: "farm" }) + '">Farm system</a>.</p>';
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
    var park = PARKS[tm.abbr] || ["", [], {}], notes = park[2] ? Object.keys(park[2]).map(function (k) { return park[2][k]; }) : [];
    var html = '<div class="fieldwrap"><p class="park"><b>' + esc(park[0]) + "</b>" + (park[1].length ? " · " + park[1].join(" · ") + " ft" : "") + (notes.length ? " · " + esc(notes.join(", ")) : "") +
      '</p><div class="field">' + fieldSvg(tm.abbr), bk = backupMap(tm);
    M.FIELD_ORDER.forEach(function (slot) {
      var xy = SPOT_XY[slot], e = tm.line[slot], rows = e ? [e].concat((bk[slot] || []).slice(0, 1)) : [];
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
  // A team's park: its real outline (assets from GeomMLBStadiums, tools/mlb_parks_build.py) when we have one, labeled
  // with the published distances; otherwise drawn through those five distances
  var SHAPES = null;
  function fieldSvg(abbr) {
    var sh = SHAPES && SHAPES[abbr];
    if (!sh || !sh.outfield_outer || sh.outfield_outer.length < 10) return fieldSvgApprox(abbr);
    var park = PARKS[abbr] || ["", [], {}], d = park[1], walls = park[2] || {};
    var P = function (pts, close) { return "M" + pts.map(function (q) { return q[0] + " " + (-q[1]); }).join(" L") + (close ? " Z" : ""); };
    var poly = function (k, fill, extra) { return sh[k] && sh[k].length > 2 ? '<path d="' + P(sh[k], true) + '" fill="' + fill + '"' + (extra || "") + "/>" : ""; };
    var ang = function (q) { return Math.atan2(q[0], q[1]) * 180 / Math.PI; };
    var wall = function (side) { // the fence along a notable wall, drawn heavier
      var seg = sh.outfield_outer.filter(function (q) { var a = ang(q); return Math.hypot(q[0], q[1]) > 240 && (side === "lf" ? a < -20 && a > -50 : a > 20 && a < 50); });
      return seg.length > 1 ? '<path d="' + P(seg) + '" fill="none" stroke="var(--monster)" stroke-width="7" stroke-linecap="round" opacity=".85"/>' : "";
    };
    var labels = d.length ? [-45, -22.5, 0, 22.5, 45].map(function (a, i) {
      var r = a * Math.PI / 180, ft = d[i] + (i === 2 ? 26 : 30);
      return '<text x="' + (Math.sin(r) * ft).toFixed(0) + '" y="' + (-Math.cos(r) * ft + (i === 2 ? 0 : 8)).toFixed(0) + '" text-anchor="middle" class="ft2">' + d[i] + "</text>";
    }).join("") : "";
    var b = function (x, y) { return '<rect x="' + (x - 3.5) + '" y="' + (-y - 3.5) + '" width="7" height="7" transform="rotate(45 ' + x + " " + (-y) + ')" fill="#fff"/>'; };
    return '<svg viewBox="' + [VB.x, VB.y, VB.w, VB.h].join(" ") + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      poly("outfield_outer", "var(--dirt)", ' opacity=".5"') + poly("outfield_inner", "var(--grass)", ' opacity=".6"') +
      '<path d="' + P(sh.outfield_outer, true) + '" fill="none" stroke="var(--grass-2)" stroke-width="2.5"/>' +
      (walls.lf ? wall("lf") : "") + (walls.rf ? wall("rf") : "") +
      poly("infield_outer", "var(--dirt)", ' opacity=".65"') + poly("infield_inner", "var(--grass-2)", ' opacity=".85"') +
      (d.length ? '<path d="M' + (-d[0] * .7071).toFixed(0) + " " + (-d[0] * .7071).toFixed(0) + ' L0 0 L' + (d[4] * .7071).toFixed(0) + " " + (-d[4] * .7071).toFixed(0) + '" fill="none" stroke="#fff" stroke-width="1.8" opacity=".9"/>' : "") +
      b(63.6, 63.6) + b(0, 127.3) + b(-63.6, 63.6) + '<circle cx="0" cy="-60.5" r="9" fill="var(--dirt)"/>' +
      '<path d="M0 3 L-6 -3 L-6 -8 L6 -8 L6 -3 Z" fill="#fff"/>' + labels + "</svg>";
  }
  // A team's park to scale when there's no traced outline: the fence through its five published distances, drawn in
  // the same feet-from-home frame as the traced parks so the cards land in the same places
  function fieldSvgApprox(abbr) {
    var park = PARKS[abbr] || ["", [330, 375, 400, 375, 330]], d = park[1], walls = park[2] || {};
    var pt = function (deg, ft) { var a = deg * Math.PI / 180; return [ft * Math.sin(a), -ft * Math.cos(a)]; };
    var xy = function (q) { return q[0].toFixed(1) + " " + q[1].toFixed(1); };
    var fence = [pt(-45, d[0]), pt(-22.5, d[1]), pt(0, d[2]), pt(22.5, d[3]), pt(45, d[4])];
    var path = "M0 0 L" + xy(fence[0]);
    for (var i = 0; i < 4; i++) { // a smooth fence through the five points (Catmull-Rom as Bezier)
      var p0 = fence[Math.max(0, i - 1)], p1 = fence[i], p2 = fence[i + 1], p3 = fence[Math.min(4, i + 2)];
      path += " C" + xy([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]) + " " + xy([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]) + " " + xy(p2);
    }
    path += " Z";
    var first = pt(45, 90), second = pt(0, 127.3), third = pt(-45, 90), mound = pt(0, 60.5);
    var dirt = "M0 0 L" + xy(pt(-45, 120)) + " A155 155 0 0 1 " + xy(pt(45, 120)) + " Z";
    var labels = fence.map(function (f, i) {
      var lab = pt([-45, -22.5, 0, 22.5, 45][i], d[i] + (i === 2 ? 26 : 30));
      return '<text x="' + lab[0].toFixed(0) + '" y="' + (lab[1] + (i === 2 ? 0 : 8)).toFixed(0) + '" text-anchor="middle" class="ft2">' + d[i] + "</text>";
    }).join("");
    var wall = function (side) {
      var a = side === "lf" ? [fence[0], fence[1]] : [fence[3], fence[4]];
      return '<path d="M' + xy(a[0]) + " L" + xy(a[1]) + '" stroke="var(--monster)" stroke-width="7" stroke-linecap="round" opacity=".85"/>';
    };
    var b = function (q) { return '<rect x="' + (q[0] - 3.5).toFixed(1) + '" y="' + (q[1] - 3.5).toFixed(1) + '" width="7" height="7" transform="rotate(45 ' + xy(q).replace(" ", " ") + ')" fill="#fff"/>'; };
    return '<svg viewBox="' + [VB.x, VB.y, VB.w, VB.h].join(" ") + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<path d="' + path + '" fill="var(--grass)" opacity=".55"/><path d="' + path + '" fill="none" stroke="var(--grass-2)" stroke-width="2.5"/>' +
      (walls.lf ? wall("lf") : "") + (walls.rf ? wall("rf") : "") +
      '<path d="' + dirt + '" fill="var(--dirt)" opacity=".6"/>' +
      '<path d="M0 0 L' + xy(first) + " L" + xy(second) + " L" + xy(third) + ' Z" fill="var(--grass-2)" opacity=".85"/>' +
      '<path d="M' + xy(pt(-45, d[0])) + ' L0 0 L' + xy(pt(45, d[4])) + '" fill="none" stroke="#fff" stroke-width="1.8" opacity=".9"/>' +
      b(first) + b(second) + b(third) + '<circle cx="' + mound[0].toFixed(1) + '" cy="' + mound[1].toFixed(1) + '" r="9" fill="var(--dirt)"/>' +
      '<path d="M0 3 L-6 -3 L-6 -8 L6 -8 L6 -3 Z" fill="#fff"/>' + labels + "</svg>";
  }
  function listPanel(title, items, fn, sub) {
    return '<div class="panel"><h3>' + esc(title) + " <small>" + esc(sub || "") + '</small></h3><ul class="rlist">' +
      (items.length ? items.map(function (e) { return "<li>" + fn(e) + "</li>"; }).join("") : '<li class="note">Nobody.</li>') + "</ul></div>";
  }
  function status(p, y) {
    var t = H.terms(p, y);
    var tag = t.kind === "Signed" ? money(t.salary) : /option|Stays/.test(t.kind) && t.on ? t.kind + " " + money(t.salary) : t.kind;
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
  function tablePanel(title, head, body, right, cls) {
    return '<div class="panel"><h3>' + esc(title) + " <small>" + esc(right || "") + '</small></h3><div class="scroll"><table class="t' + (cls ? " " + cls : "") + '"><thead><tr>' + head + "</tr></thead><tbody>" + (body || '<tr><td class="note">Nobody yet.</td></tr>') + "</tbody></table></div></div>";
  }
  // The payroll grid: every player's salary each season, how it's set (guaranteed, option, arbitration estimate,
  // pre-arb), and the totals, like RosterResource's payroll pages
  function payrollPanel(abbr, y, withDead) {
    var yrs = yearsList(), org = H.org(abbr);
    var cell = function (p, yy) {
      var t = H.terms(p, yy);
      if (t.kind === "Minors") return null;
      if (!t.on && !(t.option && t.salary)) return { cls: "fa", txt: t.kind === "Free agent" ? "FA" : "", sal: 0 };
      if (t.kind === "Option declined") return { cls: "opt off", txt: money(t.salary) + " buyout", sal: t.salary, tip: "Club option declined" };
      var cls = /option|Stays/.test(t.kind) ? "opt" : /^Arb/.test(t.kind) ? "arb" : t.kind === "Pre-arb" ? "pre" : t.kind === "Re-signed" ? "re" : "g";
      var tag = { opt: t.kind === "Club option" ? "CO" : "PO", arb: t.kind.replace("Arb ", "A"), pre: "", re: "RS", g: "" }[cls];
      return { cls: cls, txt: money(t.salary) + (t.est ? "*" : ""), tag: tag, sal: t.salary, tip: t.kind };
    };
    var rows = [], rest = yrs.map(function () { return 0; }), restN = 0;
    org.forEach(function (p) {
      var cells = yrs.map(function (yy) { return cell(p, yy); });
      var any = cells.some(function (c) { return c && c.sal > 0; });
      if (!any) return;
      var keep = p.g !== "min" || (p.c && p.c.yrs && p.c.yrs.some(function (r) { return r[2] === "G"; }));
      if (!keep) { cells.forEach(function (c, i) { if (c) rest[i] += c.sal; }); restN++; return; }
      rows.push({ p: p, cells: cells, first: cells[0] && cells[0].sal || 0, tot: cells.reduce(function (a, c) { return a + (c ? c.sal : 0); }, 0) });
    });
    rows.sort(function (a, b) { return b.first - a.first || b.tot - a.tot; });
    var totals = yrs.map(function (yy, i) { return rows.reduce(function (a, r) { return a + (r.cells[i] ? r.cells[i].sal : 0); }, 0) + rest[i]; });
    var html = '<div class="panel payroll-grid"><h3>Payroll <small>salary by season, $M</small></h3><div class="scroll"><table class="t pg"><thead><tr><th>Player</th><th>Contract</th>' +
      yrs.map(function (yy) { return '<th class="' + (yy === y ? "cur" : "") + '">' + yy + "</th>"; }).join("") + "<th>Total</th></tr></thead><tbody>";
    rows.forEach(function (r) {
      var p = r.p, desc = p.c && p.c.desc ? p.c.desc.replace(/\s*\(.*?\)/, "") : r.cells[0] ? r.cells[0].tip || "" : "";
      html += "<tr><td>" + pname(p, 20) + ' <span class="note">' + esc(p.pos || "") + '</span></td><td class="desc">' + esc(desc) + "</td>" +
        r.cells.map(function (c, i) {
          if (!c) return '<td class="' + (yrs[i] === y ? "cur" : "") + '"></td>';
          return '<td class="pc ' + c.cls + (yrs[i] === y ? " cur" : "") + '"' + (c.tip ? ' title="' + esc(c.tip) + '"' : "") + ">" + esc(c.txt) + (c.tag ? "<sup>" + esc(c.tag) + "</sup>" : "") + "</td>";
        }).join("") + "<td><b>" + money(r.tot) + "</b></td></tr>";
    });
    if (restN) html += '<tr class="muted-row"><td colspan="2">Call-ups and depth at the minimum (' + restN + ")</td>" + rest.map(function (v, i) { return '<td class="' + (yrs[i] === y ? "cur" : "") + '">' + (v ? money(v) : "") + "</td>"; }).join("") + "<td></td></tr>";
    var deadRow = yrs.map(function (yy) { return deadFor(abbr, yy).reduce(function (a, d) { return a + d[1] / 1e6; }, 0); });
    if (withDead && deadRow.some(function (v) { return v; })) {
      html += '<tr class="muted-row"><td colspan="2">Dead money and other payments</td>' + deadRow.map(function (v, i) { return '<td class="' + (yrs[i] === y ? "cur" : "") + '">' + (v ? money(v) : "") + "</td>"; }).join("") + "<td></td></tr>";
      totals = totals.map(function (v, i) { return v + deadRow[i]; });
    }
    html += '<tr class="tot"><td colspan="2">Total payroll</td>' + totals.map(function (v, i) { return '<td class="' + (yrs[i] === y ? "cur" : "") + '"><b>' + money(v, 0) + "</b></td>"; }).join("") + "<td></td></tr>";
    html += '</tbody></table></div><div class="body"><p class="legend-row"><span class="pc g">Guaranteed</span><span class="pc opt">Option<sup>CO/PO</sup></span><span class="pc arb">Arbitration*<sup>A1-A3</sup></span><span class="pc pre">Pre-arb</span><span class="pc re">Re-signed<sup>RS</sup></span><span class="pc fa">FA</span></p>' +
      '<p class="note" style="margin:6px 0 0">* Arbitration salaries are estimates (36%, 58% and 87% of market value). Options are picked up or declined on value. Free agents still to be signed aren\'t in it.</p></div></div>';
    return html;
  }
  function farmPanel(abbr, all) {
    var list = H.org(abbr).filter(function (p) { return p.fv && p.g === "min"; }).sort(function (a, b) { return (a.orgr || 99) - (b.orgr || 99); }).slice(0, all ? 60 : 12);
    return listPanel("Farm system", list, function (p) {
      var sv = H.surplus(p);
      return pname(p, 26) + '<span class="grow"></span><span class="sub">' + esc(p.pos || "") + " · " + esc(p.lvl || "") + " · age " + (p.age ? Math.floor(p.age) : "—") + " · ETA " + (p.eta || "—") + (p.ovr ? " · #" + p.ovr + " overall" : "") +
        '</span><span class="pill">FV ' + esc(p.fv) + '</span><b class="' + (sv.pv >= 0 ? "pos" : "neg") + '" style="min-width:64px;text-align:right">' + signed(sv.pv) + "</b>";
    }, HUB.board ? "FanGraphs' The Board, with each prospect's surplus value" : "prospect grades arrive with the next pull");
  }

  // ---------- contracts & cap ----------
  // The luxury tax: 2026's thresholds until the next CBA (the current one expires December 1, 2026) sets new ones
  var CBT = [244, 264, 284, 304], BENEFITS = 17;
  function cbtHit(p, yy) { // what a player counts against the tax: his contract's average value, else his salary
    var t = H.terms(p, yy);
    if (!(t.on || (t.option && t.salary))) return 0;
    if (p.c && p.c.yrs) for (var i = 0; i < p.c.yrs.length; i++) {
      var r = p.c.yrs[i];
      if (r[0] === yy && r[5] && t.on && (t.kind === "Signed" || /option|Stays/.test(t.kind))) return r[5] / 1e6;
    }
    return t.salary || 0;
  }
  function svc(st) { // years.days, the way service time is written (172 days to a year)
    if (st == null) return "—";
    var y = Math.floor(st + 1e-9), d = Math.round((st - y) * 172);
    if (d >= 172) { y++; d = 0; }
    return y + "." + String(d).padStart(3, "0");
  }
  function deadFor(abbr, yy) {
    return (team(abbr).dead || []).filter(function (d) { return d[0] === yy && !/potential buyout/i.test(d[2]); });
  }
  function moneyView(abbr, y) {
    var yrs = yearsList(), org = H.org(abbr);
    var pay = yrs.map(function (yy) { return H.payroll(abbr, yy) + deadFor(abbr, yy).reduce(function (a, d) { return a + d[1] / 1e6; }, 0); });
    var cbt = yrs.map(function (yy) { return org.reduce(function (a, p) { return a + cbtHit(p, yy); }, 0) + deadFor(abbr, yy).reduce(function (a, d) { return a + d[1] / 1e6; }, 0) + BENEFITS; });
    var guar = yrs.map(function (yy) {
      return org.reduce(function (a, p) { var t = H.terms(p, yy); return a + (t.on && t.kind === "Signed" ? t.salary : 0); }, 0);
    });
    var i0 = yrs.indexOf(y), room = CBT[0] - cbt[i0];
    var html = '<div class="stats">' + stat(money(pay[i0], 0), y + " payroll") + stat(money(cbt[i0], 0), "Tax payroll (est.)") +
      stat(money(Math.abs(room), 0), room >= 0 ? "Under the tax" : "Over the tax") +
      stat(money(guar.slice(1).reduce(function (a, b) { return a + b; }, 0), 0), "Guaranteed after " + y) +
      stat(money(deadFor(abbr, y).reduce(function (a, d) { return a + d[1] / 1e6; }, 0), 1), "Dead money " + y) + "</div>";
    // tax payroll against the thresholds, by season
    var max = Math.max(CBT[3] + 20, Math.max.apply(null, cbt) + 10);
    html += '<div class="panel"><h3>Luxury tax <small>tax payroll by season against 2026\'s thresholds</small></h3><div class="body cbt">';
    yrs.forEach(function (yy, i) {
      var v = cbt[i], tier = v >= CBT[3] ? 4 : v >= CBT[2] ? 3 : v >= CBT[1] ? 2 : v >= CBT[0] ? 1 : 0;
      html += '<div class="cbt-row' + (yy === y ? " cur" : "") + '"><span class="yr">' + yy + '</span><div class="cbt-bar"><b class="t' + tier + '" style="width:' + (v / max * 100).toFixed(1) + '%"></b>' +
        CBT.map(function (c, k) { return '<i style="left:' + (c / max * 100).toFixed(1) + '%" title="' + ["Tax line", "Second tier", "Third tier", "Top tier"][k] + " $" + c + 'M"></i>'; }).join("") +
        '</div><span class="v">' + money(v, 0) + "</span></div>";
    });
    html += '<p class="note" style="margin:8px 0 0">Tax payroll counts each contract at its average annual value, plus arbitration and pre-arb estimates, money owed for players no longer here, and about $' + BENEFITS + "M in player benefits. Lines mark 2026\'s thresholds ($" + CBT.join("M, $") + "M): the next CBA will set 2027\'s. Later seasons only count players still under contract or control.</p></div></div>";
    html += payrollPanel(abbr, y, pay);
    // every contract's terms
    var rows = org.filter(function (p) { return p.c && p.c.yrs && p.c.yrs.some(function (r) { return r[2] === "G" || r[2] === "VO"; }); })
      .map(function (p) {
        var g = p.c.yrs.filter(function (r) { return r[2] === "G" || r[2] === "VO"; });
        var left = g.reduce(function (a, r) { return a + (r[1] || 0); }, 0) / 1e6, thru = g.length ? g[g.length - 1][0] : null;
        var opts = p.c.yrs.filter(function (r) { return /CO|PO|MO|OO/.test(r[2]); }).map(function (r) { return r[0] + " " + { CO: "club", PO: "player", MO: "mutual", OO: "opt-out" }[r[2]]; });
        return { p: p, left: left, thru: thru, opts: opts, aav: (p.c.aav || 0) / 1e6 };
      }).sort(function (a, b) { return b.aav - a.aav; });
    html += '<div class="panel"><h3>Contracts <small>guaranteed deals, by average annual value</small></h3><div class="scroll"><table class="t"><thead><tr><th>Player</th><th>Age</th><th>Deal</th><th>Type</th><th>AAV</th><th>Left (from ' + H.season + ')</th><th>Through</th><th>Options</th><th>Surplus</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var sv = H.surplus(r.p);
        return "<tr><td>" + pname(r.p, 20) + ' <span class="note">' + esc(r.p.pos || "") + "</span></td><td>" + (r.p.age ? Math.floor(r.p.age) : "—") + '</td><td class="desc">' + esc(r.p.c.desc || "") + "</td><td>" + esc(r.p.c.type || "") + "</td><td>" + money(r.aav) +
          "</td><td>" + money(r.left) + "</td><td>" + (r.thru || "—") + '</td><td class="desc">' + esc(r.opts.join(", ")) + '</td><td class="' + (sv.pv >= 0 ? "pos" : "neg") + '">' + signed(sv.pv) + "</td></tr>";
      }).join("") + "</tbody></table></div></div>";
    // arbitration and pre-arb: who's under team control and when he reaches free agency
    var ctl = org.filter(function (p) { return p.g !== "min" && !rows.some(function (r) { return r.p === p; }); }).map(function (p) {
      var fa = null;
      for (var yy = H.season; yy <= H.season + 8; yy++) { var t = H.terms(p, yy); if (!t.on && t.kind === "Free agent") { fa = yy; break; } }
      return { p: p, t: H.terms(p, H.season), fa: fa };
    }).sort(function (a, b) { return (b.t.salary || 0) - (a.t.salary || 0); });
    html += '<div class="panel"><h3>Team control <small>arbitration and pre-arb players, with the season each reaches free agency</small></h3><div class="scroll"><table class="t"><thead><tr><th>Player</th><th>Age</th><th>Service</th><th>' + H.season + '</th><th>Salary</th><th>Free agent</th><th>Surplus</th></tr></thead><tbody>' +
      ctl.map(function (r) {
        var sv = H.surplus(r.p);
        return "<tr><td>" + pname(r.p, 20) + ' <span class="note">' + esc(r.p.pos || "") + "</span></td><td>" + (r.p.age ? Math.floor(r.p.age) : "—") + "</td><td>" + svc(r.p.st) +
          '</td><td><span class="pill">' + esc(r.t.kind) + "</span></td><td>" + (r.t.on ? money(r.t.salary) + (r.t.est ? "*" : "") : "—") + "</td><td>" + (r.fa ? "after " + (r.fa - 1) : "—") + '</td><td class="' + (sv.pv >= 0 ? "pos" : "neg") + '">' + signed(sv.pv) + "</td></tr>";
      }).join("") + "</tbody></table></div></div>";
    var dead = (team(abbr).dead || []).filter(function (d) { return !/potential buyout/i.test(d[2]); });
    if (dead.length) html += '<div class="panel"><h3>Dead money and other payments <small>owed outside active contracts</small></h3><ul class="rlist">' +
      dead.map(function (d) { return '<li><span class="num" style="min-width:44px">' + d[0] + '</span><span class="grow">' + esc(d[2].replace(/^\$ /, "")) + '</span><b class="' + (d[1] > 0 ? "neg" : "pos") + '">' + money(d[1] / 1e6) + "</b></li>"; }).join("") + "</ul></div>";
    return html;
  }

  // ---------- player card ----------
  var card = $("#card"), cardBody = $("#cardBody");
  function openCard(id) {
    var p = H.byId[id] || H.byId[+id];
    if (!p) return;
    var s = H.surplus(p), t = team(p.t), pj = p.pj || {};
    var PC = window.PCard, ov = "", ct = "";
    var fth = p.faith || 1; // a thin big league record: WAR shown as counted
    var head = [{ v: f1(H.warAt(p, H.season) * fth), l: H.season + " WAR" + (fth < 1 ? " (adj.)" : " (proj.)") }].concat(p.p ? [{ v: pj.era != null ? pj.era.toFixed(2) : "—", l: "ERA (proj.)" }, { v: f0(pj.ip), l: "Innings (proj.)" }] : [{ v: f0(pj.wrc), l: "wRC+ (proj.)" }, { v: f0(pj.pa), l: "PA (proj.)" }], [{ v: svc(p.st), l: "Service time" }]);
    if (p.fv) ov += PC.sec("Prospect") + PC.facts([[p.fv + (p.risk ? " / " + p.risk : ""), "FV / risk"], [p.eta || "—", "ETA"], [p.ovr ? "#" + p.ovr : "—", "Overall rank"]]);
    // headline numbers are plain totals over the deal, so the contract reads as what he's actually owed; the
    // discounted (today's dollars) figures sit underneath and in the table
    var sumV = s.rows.reduce(function (a, r) { return a + r.value; }, 0), sumC = s.rows.reduce(function (a, r) { return a + r.salary; }, 0);
    var nS = s.rows.length ? s.rows.length + " season" + (s.rows.length > 1 ? "s" : "") : "";
    ct += '<div class="vcs"><div><span>Value</span><b>' + money(sumV) + "</b><small>what he should produce" + (nS ? ", " + nS : "") + '</small></div><i>−</i><div><span>Contract</span><b>' + money(sumC) +
      "</b><small>what he'll be paid" + (nS ? ", " + nS : "") + '</small></div><i>=</i><div class="' + (s.total >= 0 ? "up" : "dn") + '"><span>Surplus</span><b>' + signed(s.total) + "</b><small>" + (!s.rows.length ? "not worth a roster spot" : H.cfg.discount > 0 ? signed(s.pv) + " in today's dollars" : "over the deal") + "</small></div></div>";
    if (s.rows.length) { var rg = H.range(p); ct += '<p class="note vrange">Likely range: <b>' + signed(rg.lo) + "</b> to <b>" + signed(rg.hi) + "</b>" + (H.cfg.discount > 0 ? " in today's dollars" : "") + ", if he lands " + pct(rg.k, 0) + " below or above his projection (" + (s.prospect ? "his risk grade sets how wide" : "wider when his seasons have swung or he isn't established") + ").</p>"; }
    var fx = H.faBoard().filter(function (b) { return String(b.r.id) === String(p.id) && b.r.to === p.t; })[0];
    ct += gradeLine(fx && fx.grade ? fx : null);
    if (fx && fx.trust < 1) ct += '<p class="note">' + esc(faithNote(fx.r, fx.trust, fx.proj)) + " His value below counts it the same way.</p>";
    if (p.tldr) ov += '<p class="tldr">' + esc(p.tldr) + "</p>";
    var lk = svLuck(p.id, !!p.p);
    if (lk && lk.tag) ov += '<p class="tldr"><b>Statcast:</b> ' + lk.line + ". " + (lk.tag === "due" ? "His contact was better than his results, so expect a bounce back. A buy-low." : "His results beat his contact, so expect a step back. A sell-high.") + (H.cfg.statcast && p.svd ? " With Lean on Statcast on, his projection moves " + (p.svd > 0 ? "+" : "") + p.svd.toFixed(1) + " WAR this season and half that next." : "") + "</p>";
    else if (H.cfg.statcast && p.svd) ov += '<p class="tldr"><b>Lean on Statcast:</b> ' + (lk ? lk.line + ", so h" : "H") + "is projection moves " + (p.svd > 0 ? "+" : "") + p.svd.toFixed(1) + " WAR this season and half that next.</p>";
    if (p.c && p.c.desc) ov += '<p class="tldr"><b>Contract:</b> ' + esc(p.c.desc) + (p.c.note ? " " + esc(p.c.note) : "") + "</p>";
    else if (p.acq) ov += '<p class="tldr">' + esc(p.acq) + "</p>";
    var stats = statTables(p);
    var hasSv = typeof p.id === "number";
    var svp = hasSv ? svPane(p) : "";
    if (hasSv && !SV) loadSavant().then(function () { var pn = card.querySelector('[data-pane="tr"]'); if (pn) pn.innerHTML = svPane(p); });
    ct += '<h4 class="card-sec">Contract value</h4><div class="scroll"><table class="t"><thead><tr><th>Year</th><th>Age</th><th>Status</th><th>Proj WAR</th><th>Counted</th><th>Value</th><th>Salary</th><th>Surplus</th></tr></thead><tbody>';
    s.rows.forEach(function (r) {
      ct += "<tr><td>" + r.y + "</td><td>" + H.ageAt(p, r.y) + '</td><td style="text-align:left"><span class="pill">' + esc(r.kind) + "</span></td><td>" + f1(r.war) + "</td><td>" + (r.war > 0 && Math.abs(r.cw - r.war) > r.war * 0.03 ? '<span title="Counted at ' + pct(r.cw / r.war, 0) + ' of the projection">' + f1(r.cw) + "*</span>" : f1(r.cw)) + "</td><td>" + money(r.value) + "</td><td>" + money(r.salary) + (r.est ? "*" : "") + '</td><td class="' + (r.surplus >= 0 ? "pos" : "neg") + '">' + signed(r.surplus) + "</td></tr>";
    });
    if (!s.rows.length) ct += '<tr><td class="note" colspan="8">Projects below his pay in every controlled season: a team would cut him before paying more than he\'s worth.</td></tr>';
    else {
      var tp = s.rows.reduce(function (a, r) { return a + r.war; }, 0), tw = s.rows.reduce(function (a, r) { return a + r.cw; }, 0), tv = s.rows.reduce(function (a, r) { return a + r.value; }, 0), ts = s.rows.reduce(function (a, r) { return a + r.salary; }, 0);
      ct += '<tr class="tot"><td colspan="3">Total</td><td>' + f1(tp) + "</td><td>" + f1(tw) + "</td><td>" + money(tv) + "</td><td>" + money(ts) + '</td><td class="' + (s.total >= 0 ? "pos" : "neg") + '">' + "<b>" + signed(s.total) + "</b></td></tr>";
    }
    ct += "</tbody></table></div>";
    var share = M.outlookShare(p, H.cfg), rr = M.recentRead(p);
    if (H.cfg.youngReg && (p.st || 0) < 3 && !s.prospect && p.rate > 0.3) {
      var lean = H.cfg.youngReg * (1 - (rr ? rr.rel : 0));
      if (lean > 0.02) ct += '<p class="note">Young player: with ' + (rr ? pct(rr.rel, 0) : "none") + " of two full seasons' playing time behind him, his projection leans " + pct(lean, 0) + " of the way toward an average regular (" + f1(H.cfg.youngTo == null ? 2 : H.cfg.youngTo) + " WAR a full season), since short records miss often. The lean fades as his record grows.</p>";
    }
    if (Math.abs(share - 1) > 0.02 && rr) ct += '<p class="note">Outlook: FanGraphs projects ' + f1(p.rate) + " WAR a full season; his last three seasons ran at " + f1(rr.rate) + " (weighted toward the latest" + (Math.abs(rr.rate - rr.avg) > 0.05 ? ", with a career year that isn't his latest tempered toward his median season" : "") + ")" + (rr.avail < 0.97 ? ", and he's played " + pct(rr.avail, 0) + " of the time FanGraphs projects for him (missed time counts half)" : "") + ", so he's counted at " + pct(share, 0) + " of the projection.</p>";
    // why counted WAR differs from the projection, in one note
    var why = [];
    if (Math.abs(share - 1) > 0.02 && rr) why.push("the outlook above");
    if (p.faith) why.push("a thin big league record");
    else if (s.prospect) why.push("his chance of reaching the majors (" + pct(s.hit, 0) + ")");
    else if (s.rows.some(function (r) { return r.y > H.season && r.war > 0 && r.cw < r.war * share * (r.y - H.season > (H.cfg.lateAfter == null ? 3 : H.cfg.lateAfter) - 1 ? Math.pow(H.cfg.lateFade || 1, r.y - H.season - (H.cfg.lateAfter == null ? 3 : H.cfg.lateAfter) + 1) : 1) * 0.97; }))
      why.push("he's not established yet (under three years of service and short of two full seasons' playing time), so seasons after the coming one count part of his projection, more as his record grows");
    if (H.cfg.lateFade < 1 && (p.st || 0) < 6 && s.rows.some(function (r) { return r.y - H.season >= (H.cfg.lateAfter == null ? 3 : H.cfg.lateAfter); }))
      why.push("seasons more than " + (H.cfg.lateAfter == null ? 3 : H.cfg.lateAfter) + " years out count " + pct(H.cfg.lateFade, 0) + " a year, compounding, since projections that far ahead miss more often (the Far-off seasons setting on Trade Value)");
    if (s.rows.some(function (r) { return r.war > 0 && Math.abs(r.cw - r.war) > r.war * 0.03; }) && why.length)
      ct += '<p class="note">* Counted WAR differs from the projection: ' + why.join("; ") + ".</p>";
    ct += '<p class="note">Value is counted WAR times the price of a win: ' + money(H.cfg.dpw) + " in " + H.season + ", up " + pct(H.cfg.inflation, 0) + " a year" +
      (H.cfg.tiered ? ", priced by tier (a win from a 1-WAR player costs about 78% of that, from a 3+ WAR player about 115%, the way the market pays)" : "") + ".</p>";
    var lk2 = svLuck(p.id, !!p.p), chips = [];
    if (lk2 && lk2.tag) chips.push([lk2.tag === "due" ? "Statcast: buy low" : "Statcast: sell high", lk2.tag === "due" ? "tag" : "inj"]);
    if (p.fv) chips.push(["Prospect, FV " + p.fv, "tag"]);
    if (!ov) ov = '<p class="note">' + esc(p.n) + " projects for " + f1(H.warAt(p, H.season) * fth) + " WAR in " + H.season + ". The Contract tab has his value year by year.</p>";
    if (window.GameLog && p.g !== "min") ov += GameLog.slot({ league: "mlb", name: p.n }); // found by name: the hub keeps MLB ids, not ESPN's
    ov += PC.sec("Value") + PC.facts([[money(sumV), "What he should produce" + (nS ? ", " + nS : "")], [money(sumC), "What he'll be paid"], [signed(s.total), "Surplus"]]);
    cardBody.innerHTML = PC.html({ face: face(p, 60), name: p.n, color: t.color || "var(--ink)", team: '<a href="' + href("team/" + p.t) + '">' + logo(p.t, 18) + " " + esc(t.name) + "</a>",
      meta: [(p.el || [p.pos]).join("/"), p.age != null ? "Age " + Math.floor(p.age) : "", p.b ? "B/T " + p.b + "/" + p.th : ""], chips: chips, head: head,
      tabs: [{ id: "ov", label: "Overview", html: ov }, { id: "st", label: "Stats", html: stats }, hasSv ? { id: "tr", label: "Statcast", html: svp } : null, { id: "ct", label: "Contract", html: ct }],
      foot: '<div class="pc-acts"><button type="button" data-add="a" data-id="' + esc(p.id) + '">Trade: side A</button><button type="button" data-add="b" data-id="' + esc(p.id) + '">Side B</button><a href="' + href("team/" + p.t) + '">' + esc(t.name) + " depth</a></div>",
      follow: { sport: "mlb-p", id: p.id, name: p.n, info: { t: t.name, href: "/mlb/?card=" + encodeURIComponent(p.id) } } });
    if (!card.open) card.showModal();
  }
  // A free agent who isn't on a roster yet: his projection, the crowd's contract, what he's worth year by year
  function faKey(r) { return r.id != null ? String(r.id) : "fg:" + r.fg; }
  function openFaCard(id, tab) {
    var x = H.faBoard().filter(function (b) { return faKey(b.r) === String(id); })[0];
    var tracked = SV && (SV.bat[id] || SV.pit[id]);
    if (!x && !tracked) return;
    var pc = window.PCard, r = x ? x.r : { id: id, n: tracked.n };
    var tabs = tracked ? [{ id: "tr", label: "Statcast", html: svPane({ id: id, p: !!SV.pit[id] && !SV.bat[id] }) }] : [];
    var hist = (historyData.unrostered || {})[id];
    if (hist) tabs.unshift({ id: "st", label: "Stats", html: statTables({ id: id, hist: hist, p: !hist.b }) });
    var frame = { name: r.n, face: window.DSFaces.html({ sport: "mlb", id: r.id, name: r.n, size: 60 }), tabs: tabs, tab: tab };
    if (!x) {
      cardBody.innerHTML = pc.html(frame);
      if (!card.open) card.showModal();
      return;
    }
    frame.team = r.to ? esc(team(r.to).name) : "";
    frame.meta = [r.pos, x.age && "Age " + x.age, r.b && "B/T " + r.b + "/" + r.th, r.from && "From " + team(r.from).name];
    frame.chips = [[x.signed ? "Signed" : "Free agent", "tag"]];
    frame.head = [{ v: f1(x.war), l: H.season + " projected WAR" }, { v: r.my ? r.my + " yr" : "—", l: "Crowd's length" }, { v: money(x.crowdAav), l: "Crowd's AAV" }, { v: r.qo ? money(r.qo / 1e6) : "None", l: "Qualifying offer" }];
    var html = '<div class="vcs"><div><span>Fair</span><b>' + money(x.spotAav) + '</b><small>per year, at ' + money(H.cfg.dpw) + ' a win</small></div><i>·</i><div><span>Market</span><b>' + money(x.mktAav) +
      '</b><small>what deals this long go for</small></div><i>·</i><div class="' + (x.signed ? (x.gap > 0 ? "dn" : "up") : "") + '"><span>' + (x.signed ? "Signed" : "Status") + "</span><b>" + (x.signed ? x.signedAav ? money(x.signedAav) : "Terms pending" : "Unsigned") + "</b><small>" +
      (x.signed ? esc(r.to || "") + " · " + (r.yrs || "?") + " yr" + (x.gap != null ? " · " + (x.gap > 0 ? "+" : "") + pct(x.gap, 0) + " vs market" : "") : "still on the market") + "</small></div></div>";
    var gr = x.grade, aavS = x.signedAav;
    if (x.trust < 1) html += '<p class="note">' + esc(faithNote(r, x.trust, x.proj)) + "</p>";
    html += gradeLine(x);
    html += '<h4 class="card-sec">Year by year over ' + (aavS ? "his " : "a ") + x.yrs + '-year deal</h4><div class="scroll"><table class="t"><thead><tr><th>Year</th><th>Age</th><th>WAR</th><th>Worth</th>' + (aavS ? "<th>Salary</th><th>Surplus</th>" : "") + "</tr></thead><tbody>";
    var tot = 0, totW = 0, totS = 0;
    x.path.forEach(function (w, k) {
      var worth = w * H.cfg.dpw * Math.pow(1 + H.cfg.inflation, k), sal = gr ? gr.paid / x.yrs : aavS; tot += worth; totW += w;
      if (aavS) totS += sal;
      html += "<tr><td>" + (H.season + k) + "</td><td>" + (x.age + k) + "</td><td>" + f1(w) + "</td><td>" + money(worth) + "</td>" +
        (aavS ? "<td>" + money(sal) + '</td><td class="' + (worth - sal >= 0 ? "pos" : "neg") + '">' + signed(worth - sal) + "</td>" : "") + "</tr>";
    });
    if (aavS && gr && gr.pick) html += '<tr><td colspan="4">Draft pick and pool money (qualifying offer)</td><td>' + money(gr.pick) + '</td><td class="neg">' + signed(-gr.pick) + "</td></tr>";
    var cost = totS + (gr && gr.pick ? gr.pick : 0);
    html += '<tr class="tot"><td colspan="2">Total</td><td>' + f1(totW) + "</td><td>" + money(tot) + "</td>" + (aavS ? "<td>" + money(cost) + '</td><td class="' + (tot - cost >= 0 ? "pos" : "neg") + '"><b>' + signed(tot - cost) + "</b></td>" : "") + "</tr></tbody></table></div>";
    if (aavS && gr) html += '<p class="note">Surplus here is production: what his projected WAR is worth at the price of a win, minus what he\'s paid (spread evenly, at his average salary). The grade measures against market price instead, since teams have to pay what free agents get, and ' + x.yrs + "-year deals have gone for " + pct(Math.abs(gr.mkt / tot - 1), 0) + (gr.mkt >= tot ? " more" : " less") + " than the wins they buy.</p>";
    html += '<p class="note">WAR ages from his projection; a win costs ' + money(H.cfg.dpw) + " in " + H.season + ", up " + pct(H.cfg.inflation, 0) + " a year. The crowd numbers are FanGraphs readers' median predictions.</p>";
    tabs.unshift({ id: "ct", label: "Contract", html: html });
    cardBody.innerHTML = pc.html(frame);
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
    var hb = (p.hist && p.hist.b) || [], hp = (p.hist && p.hist.p) || [];
    var rates = (historyData.rates || {})[p.id] || {};
    if (bat || hb.length) html += tbl("Last seasons", ["Year", "Tm", "G", "PA", "HR", "R", "RBI", "SB", "AVG/OBP/SLG", "OPS", "BB%", "K%"],
      hb.slice().sort(function (x, y) { return x[0] - y[0]; }).map(function (r) { return [r[0], esc(r[1] || ""), r[2], r[3], r[4], r[5], r[6], r[7], d3(r[8]) + "/" + d3(r[9]) + "/" + d3(r[10]), d3((rates[r[0]] || {}).ops), pct((rates[r[0]] || {}).bbRate), pct((rates[r[0]] || {}).kRate)]; }));
    if (hp.length) html += tbl(bat ? "Last seasons pitching" : "Last seasons", ["Year", "Tm", "G", "GS", "IP", "W-L", "SV", "K", "BB", "ERA", "WHIP", "K−BB%"],
      hp.slice().sort(function (x, y) { return x[0] - y[0]; }).map(function (r) { return [r[0], esc(r[1] || ""), r[2], r[3], r[4], r[5] + "-" + r[6], r[7], r[8], r[9], r[10] != null ? Number(r[10]).toFixed(2) : "—", r[11] != null ? Number(r[11]).toFixed(2) : "—", pct((rates[r[0]] || {}).kbb)]; }));
    if (p.ml) {
      var m = p.ml;
      html += m.ip != null
        ? tbl("Minor leagues, " + (H.season - 1), ["Level", "G", "GS", "IP", "ERA", "WHIP", "K%", "BB%"], [[esc(m.lv || ""), m.G, m.GS, m.ip, m.era, m.whip, m.k != null ? m.k + "%" : "—", m.bb != null ? m.bb + "%" : "—"]])
        : tbl("Minor leagues, " + (H.season - 1), ["Level", "G", "PA", "HR", "SB", "AVG/OBP/SLG", "wRC+"], [[esc(m.lv || ""), m.G, m.PA, m.HR, m.SB, d3(m.avg) + "/" + d3(m.obp) + "/" + d3(m.slg), m.wrc != null ? m.wrc : "—"]]);
    }
    var proj = [];
    if (bat && p.pj) proj.push([H.season + " " + src, f0(pj.pa), f0(pj.hr), f0(pj.sb), d3(pj.avg) + "/" + d3(pj.obp) + "/" + d3(pj.slg), f0(pj.wrc), f1(pj.def), "<b>" + f1(pj.war) + "</b>"]);
    if (bat && p.zips && p.zips.pa) proj.push([H.season + " ZiPS", f0(p.zips.pa), "—", "—", "—", f0(p.zips.wrc), "—", "<b>" + f1(p.zips.war) + "</b>"]);
    html += tbl("Projection", ["", "PA", "HR", "SB", "AVG/OBP/SLG", "wRC+", "Def", "WAR"], proj);
    var pp = [];
    if (p.p && p.pj) pp.push([H.season + " " + src, f0(pj.ip), f0(pj.gs), pj.era != null ? pj.era.toFixed(2) : "—", pj.fip != null ? pj.fip.toFixed(2) : "—", pj.kbb != null ? (pj.kbb * 100).toFixed(1) + "%" : "—", pj.k9 != null ? pj.k9.toFixed(1) : "—", f0(pj.sv), "<b>" + f1(pj.war) + "</b>"]);
    if (p.two) pp.push([H.season + " pitching", f0(p.two.ip), f0(p.two.gs), p.two.era != null ? p.two.era.toFixed(2) : "—", "—", "—", "—", "—", "<b>" + f1(p.two.war) + "</b>"]);
    if (p.p && p.zips && p.zips.ip) pp.push([H.season + " ZiPS", f0(p.zips.ip), "—", p.zips.era != null ? p.zips.era.toFixed(2) : "—", "—", "—", "—", "—", "<b>" + f1(p.zips.war) + "</b>"]);
    if (pit) html += tbl(bat ? "Pitching projection" : "Projection", ["", "IP", "GS", "ERA", "FIP", "K-BB%", "K/9", "SV", "WAR"], pp);
    if (!html) html = '<p class="note">No stats on file yet.</p>';
    return html;
  }
  function kv(v, k) { return "<div><b>" + v + "</b><span>" + k + "</span></div>"; }
  function closeCard() { if (card.open) card.close(); }
  card.addEventListener("click", function (e) {
    var ct = e.target.closest("[data-ctab]");
    if (ct) {
      card.querySelectorAll("[data-ctab]").forEach(function (b) { b.setAttribute("aria-selected", b === ct ? "true" : "false"); });
      card.querySelectorAll("[data-cpane]").forEach(function (pn) { pn.hidden = pn.dataset.cpane !== ct.dataset.ctab; });
      return;
    }
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

  // ---------- Statcast (Baseball Savant) ----------
  // SV: mlb/data/savant.json, pulled daily by tools/mlb_savant.py. bat/pit by MLB id: n name, pct percentile ranks,
  // x [PA, BA, xBA, SLG, xSLG, wOBA, xwOBA (, ERA, xERA)], ev [avg EV, max EV, sweet spot %, barrel %, barrels/PA,
  // 95+ mph %, launch angle], bt [bat speed, swing length, squared up/swing, blast/swing, hard swing rate, whiff/swing],
  // spd [sprint speed, home to first], oaa [pos, OAA, fielding runs], sw [swing/take runs: all, heart, shadow, chase,
  // waste], ars [[type, name, usage %, RV/100, RV, whiff %, put away %, xwOBA, hard hit %, pitches]].
  var SV = null, svWait = null, historyData = {};
  function loadSavant() {
    if (svWait) return svWait;
    svWait = fetch("data/savant.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) {
      SV = j || { bat: {}, pit: {}, none: true };
      if (GROUP[state.route] === "players" || /^(fa|value|trade)$/.test(state.route) || (state.route === "team" && state.q.view === "statcast")) render();
      return SV;
    });
    return svWait;
  }
  // Savant's percentile colors: red is good, blue is bad, gray is average
  function pctColor(v) {
    if (v == null) return "transparent";
    var t = Math.max(0, Math.min(100, v)) / 100, mix = function (a, b, k) { return Math.round(a + (b - a) * k); };
    var c = t < 0.5 ? [mix(54, 222, t * 2), mix(97, 222, t * 2), mix(173, 222, t * 2)] : [mix(222, 210, (t - 0.5) * 2), mix(222, 45, (t - 0.5) * 2), mix(222, 73, (t - 0.5) * 2)];
    return "rgb(" + c.join(",") + ")";
  }
  function pctInk(v) { return v != null && (v >= 80 || v <= 20) ? "#fff" : "var(--ink)"; }
  function pctCell(v, show) { return '<td class="pc" style="background:' + pctColor(v) + ";color:" + pctInk(v) + '"' + (v != null ? ' title="' + ord(v) + ' percentile"' : "") + ">" + (show != null ? show : v != null ? v : "—") + "</td>"; }
  function f3(x) { return x == null || isNaN(x) ? "—" : x.toFixed(3).replace(/^0/, ""); }
  // a Savant player as the hub knows him (team, photo, card), or by name alone if he isn't on a hub roster
  function svWho(id, d) {
    var p = H.byId[id] || H.byId[+id];
    if (p) return '<td class="tm">' + pname(p, 22) + '</td><td class="tmc hm">' + logo(p.t, 16) + "</td>";
    // not on a hub roster (an unsigned free agent, say): his MLB photo and name, and his Savant team when it has one
    var ph = window.DSFaces ? window.DSFaces.html({ sport: "mlb", id: +id, name: d.n, size: 22 }) : "";
    return '<td class="tm"><button type="button" class="pl card-link" data-tab="tr" data-fa="' + esc(id) + '">' + ph + '<span class="nm">' + esc(d.n || id) + '</span></button></td><td class="tmc hm">' + (d.t && H.byAbbr[d.t] ? logo(d.t, 16) : "") + "</td>";
  }
  // Statcast's luck read on one player: actual against expected (wOBA vs. xwOBA for hitters, ERA vs. xERA for pitchers).
  // "Due" hit better than his results, "Lucky" got more than he hit. About the top and bottom tenth of qualified players
  function svLuck(id, pit) {
    if (!SV || SV.none || id == null) return null;
    var b = SV.bat[id], q = SV.pit[id], d = pit === true ? q : pit === false ? b : b || q;
    if (!d || !d.x) return null;
    var isP = d === q;
    if (isP) {
      if (d.x[7] == null || d.x[8] == null) return null;
      var g = d.x[7] - d.x[8];
      return { p: true, gap: g, era: d.x[7], xera: d.x[8], tag: g >= 0.75 ? "due" : g <= -0.75 ? "lucky" : null, line: "ERA " + d.x[7].toFixed(2) + " vs. xERA " + d.x[8].toFixed(2) };
    }
    if (d.x[5] == null || d.x[6] == null) return null;
    var h = d.x[5] - d.x[6];
    return { p: false, gap: h, xw: d.x[6], tag: h <= -0.025 ? "due" : h >= 0.025 ? "lucky" : null, line: "wOBA " + f3(d.x[5]) + " vs. xwOBA " + f3(d.x[6]) };
  }
  function svBadge(id, pit) {
    var L = svLuck(id, pit);
    if (!L || !L.tag) return "";
    var tip = L.line + (L.tag === "due" ? ": his contact was better than his results (buy low)" : ": his results beat his contact (sell high)");
    return ' <span class="pill sv-' + L.tag + '" title="' + esc(tip) + '">' + (L.tag === "due" ? "Due" : "Lucky") + "</span>";
  }
  function svExp(id, pit) { var L = svLuck(id, pit); return !L ? "—" : L.p ? L.xera.toFixed(2) : f3(L.xw); }
  function svRv(v) { return v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v); }
  // The "Lean on Statcast" lens: nudge each qualified player's projection by a third of the gap between last season's
  // expected stats and his results, in WAR for a full season (a third because the projections already use some of
  // what xwOBA knows). Hitters: wOBA points to runs at the wOBA scale over his projected plate appearances; pitchers:
  // ERA against xERA over his projected innings; about 10 runs a win. Capped at a win either way. Off by default.
  var SV_K = 1 / 3, SV_CAP = 1;
  function svDelta(id, p, r) {
    var L = svLuck(id, p ? !!p.p : r ? /P$|SP|RP/.test(String(r.pos || "")) : undefined);
    if (!L) return 0;
    var pj = (p && p.pj) || {}, d;
    if (L.p) { var ip = pj.ip || (r && /RP/.test(String(r.pos || "")) ? 60 : 150); d = SV_K * L.gap * ip / 9 / 10; }
    else { var pa = pj.pa || 500; d = SV_K * -L.gap / 1.25 * pa / 10; }
    return Math.max(-SV_CAP, Math.min(SV_CAP, Math.round(d * 100) / 100));
  }
  function applyStatcast(on) {
    H.svd = {};
    H.players.forEach(function (p) { delete p.svd; });
    if (on && SV && !SV.none) {
      H.players.forEach(function (p) { var d = svDelta(p.id, p); if (d) { p.svd = d; H.svd[p.id] = d; } });
      var cls = (H.fa && H.fa.classes && H.fa.classes[H.season]) || [];
      cls.forEach(function (r) { if (r.id && H.svd[r.id] == null) { var d = svDelta(r.id, null, r); if (d) H.svd[r.id] = d; } });
    }
    H.set("statcast", !!on);
    surplusCache = null;
  }
  function svWaitNote() { return '<p class="loading">Loading Statcast…</p>'; }
  function svHead(title, lede) { return '<h2 class="sec">' + title + '</h2><p class="lede">' + lede + "</p>"; }
  function svSeg(name, cur, items) { return '<div class="svseg" role="group">' + items.map(function (x) { return '<a href="' + href(state.route, Object.assign({}, state.q, (function () { var o = {}; o[name] = x[0]; return o; })())) + '" class="' + (cur === x[0] ? "on" : "") + '" aria-pressed="' + (cur === x[0]) + '">' + x[1] + "</a>"; }).join("") + "</div>"; }
  function svSortTh(k, label, cur, title) { return '<th><a href="' + href(state.route, Object.assign({}, state.q, { s: k })) + '"' + (k === cur ? ' class="on"' : "") + (title ? ' title="' + esc(title) + '"' : "") + ">" + label + "</a></th>"; }

  function statcastPage() {
    if (!SV) { loadSavant(); view.innerHTML = svWaitNote(); return; }
    var kind = state.q.k === "p" ? "p" : "b", q = (state.q.q || "").toLowerCase();
    var html = svHead("Statcast", "Every qualified player's " + (SV.season || "") + " Statcast numbers from Baseball Savant, shaded by percentile the way Savant does it: red is good, blue is bad. Click a column to sort, a player for his card.");
    html += '<div class="controls">' + svSeg("k", kind, [["b", "Hitters"], ["p", "Pitchers"]]) + '<label>Search<input type="search" data-q="q" value="' + esc(state.q.q || "") + '" placeholder="Player"></label></div>';
    if (kind === "b") {
      var sort = state.q.s || "xwoba";
      var rows = Object.keys(SV.bat).map(function (id) { return { id: id, d: SV.bat[id] }; }).filter(function (r) { return r.d.x && r.d.x[0] && (!q || String(r.d.n).toLowerCase().indexOf(q) >= 0); });
      var key = { xwoba: function (d) { return d.x[6]; }, xba: function (d) { return d.x[2]; }, xslg: function (d) { return d.x[4]; }, ev: function (d) { return d.ev && d.ev[0]; }, max: function (d) { return d.ev && d.ev[1]; }, brl: function (d) { return d.ev && d.ev[3]; }, hh: function (d) { return d.ev && d.ev[5]; }, bs: function (d) { return d.bt && d.bt[0]; }, spd: function (d) { return d.spd && d.spd[0]; }, oaa: function (d) { return d.oaa && d.oaa[1]; }, rv: function (d) { return d.sw && d.sw[0]; } }[sort] || function (d) { return d.x[6]; };
      rows.sort(function (a, b) { return (key(b.d) == null ? -1e9 : key(b.d)) - (key(a.d) == null ? -1e9 : key(a.d)); });
      html += trkPanel("Hitters", "<th>Player</th><th class=\"hm\"></th><th class=\"hm\">PA</th>" + svSortTh("xwoba", "xwOBA", sort, "Expected weighted on-base average, from quality of contact, strikeouts and walks") + svSortTh("xba", "xBA", sort) + svSortTh("xslg", "xSLG", sort) + svSortTh("ev", "Avg EV", sort, "Average exit velocity") + svSortTh("max", "Max EV", sort) + svSortTh("brl", "Barrel%", sort) + svSortTh("hh", "Hard hit%", sort, "Batted balls at 95 mph or harder") + svSortTh("bs", "Bat speed", sort) + svSortTh("spd", "Sprint", sort, "Feet per second on his fastest runs") + svSortTh("oaa", "OAA", sort, "Outs above average in the field") + svSortTh("rv", "Swing runs", sort, "Runs from his swing and take decisions"),
        rows.slice(0, 250).map(function (r) {
          var d = r.d, P = d.pct || {};
          return "<tr>" + svWho(r.id, d) + "<td class=\"hm\">" + f0(d.x[0]) + "</td>" + pctCell(P.xwoba, f3(d.x[6])) + pctCell(P.xba, f3(d.x[2])) + pctCell(P.xslg, f3(d.x[4])) + pctCell(P.exit_velocity, d.ev ? f1(d.ev[0]) : "—") + pctCell(P.max_ev, d.ev ? f1(d.ev[1]) : "—") + pctCell(P.brl_percent, d.ev ? f1(d.ev[3]) : "—") + pctCell(P.hard_hit_percent, d.ev ? f1(d.ev[5]) : "—") + pctCell(P.bat_speed, d.bt ? f1(d.bt[0]) : "—") + pctCell(P.sprint_speed, d.spd ? f1(d.spd[0]) : "—") + pctCell(P.oaa, d.oaa ? (d.oaa[1] > 0 ? "+" : "") + d.oaa[1] : "—") + "<td>" + (d.sw ? (d.sw[0] > 0 ? "+" : "") + f1(d.sw[0]) : "—") + "</td></tr>";
        }).join(""), rows.length + " qualified hitters");
    } else {
      var sortp = state.q.s || "xera";
      var prow = Object.keys(SV.pit).map(function (id) { return { id: id, d: SV.pit[id] }; }).filter(function (r) { return r.d.x && r.d.x[0] && (!q || String(r.d.n).toLowerCase().indexOf(q) >= 0); });
      var pk = { xera: function (d) { return -(d.x[8] == null ? 99 : d.x[8]); }, era: function (d) { return -(d.x[7] == null ? 99 : d.x[7]); }, xwoba: function (d) { return -d.x[6]; } }[sortp] || function (d) { var v = (d.pct || {})[sortp]; return v == null ? -1 : v; };
      prow.sort(function (a, b) { return pk(b.d) - pk(a.d); });
      var cols = [["k_percent", "K%"], ["bb_percent", "BB%"], ["whiff_percent", "Whiff%"], ["chase_percent", "Chase%"], ["brl_percent", "Barrel%"], ["hard_hit_percent", "Hard hit%"], ["fb_velocity", "FB velo"], ["fb_spin", "FB spin"]];
      html += trkPanel("Pitchers", "<th>Player</th><th class=\"hm\"></th><th class=\"hm\">PA</th>" + svSortTh("era", "ERA", sortp) + svSortTh("xera", "xERA", sortp, "Expected ERA, from quality of contact allowed, strikeouts and walks") + svSortTh("xwoba", "xwOBA", sortp) + cols.map(function (c) { return svSortTh(c[0], c[1], sortp, "Percentile"); }).join(""),
        prow.slice(0, 250).map(function (r) {
          var d = r.d, P = d.pct || {};
          return "<tr>" + svWho(r.id, d) + "<td class=\"hm\">" + f0(d.x[0]) + "</td><td>" + (d.x[7] != null ? d.x[7].toFixed(2) : "—") + "</td>" + pctCell(P.xera, d.x[8] != null ? d.x[8].toFixed(2) : "—") + pctCell(P.xwoba, f3(d.x[6])) + cols.map(function (c) { return pctCell(P[c[0]]); }).join("") + "</tr>";
        }).join(""), prow.length + " qualified pitchers. The last eight columns are percentiles");
    }
    if (q && !(kind === "b" ? rows : prow).length) html += '<p class="note">No qualified ' + (kind === "b" ? "hitter" : "pitcher") + ' matches "' + esc(state.q.q) + '". Savant only ranks players who met its playing-time cutoffs, so anyone who missed much of the season drops off. His card still shows what Savant has.</p>';
    html += svFoot();
    view.innerHTML = html;
  }
  function trkPanel(title, head, body, right) { return tablePanel(title, head, body, right, "trkt"); }
  function svFoot() { return '<p class="note">From <a href="https://baseballsavant.mlb.com/" rel="noopener">Baseball Savant</a>, pulled ' + esc(SV && SV.pulled ? SV.pulled.slice(0, 10) : "—") + ". Qualified players only (Savant's own cutoffs).</p>"; }

  // A team's Statcast: last season's numbers for the players on its roster now, PA-weighted into team lines and ranked
  function svTeams() {
    var T = {};
    var add = function (abbr, k, d, w) { var t = T[abbr] = T[abbr] || { b: { pa: 0, xw: 0, w: 0 }, p: { pa: 0, xe: 0, e: 0 } }; t[k].pa += w; if (k === "b") { t.b.xw += d.x[6] * w; t.b.w += d.x[5] * w; } else { t.p.xe += d.x[8] * w; t.p.e += d.x[7] * w; } };
    Object.keys(SV.bat).forEach(function (id) { var p = H.byId[id] || H.byId[+id], d = SV.bat[id]; if (p && p.t && d.x && d.x[0] && d.x[5] != null && d.x[6] != null) add(p.t, "b", d, d.x[0]); });
    Object.keys(SV.pit).forEach(function (id) { var p = H.byId[id] || H.byId[+id], d = SV.pit[id]; if (p && p.t && d.x && d.x[0] && d.x[7] != null && d.x[8] != null) add(p.t, "p", d, d.x[0]); });
    Object.keys(T).forEach(function (a) { var t = T[a]; t.xwoba = t.b.pa ? t.b.xw / t.b.pa : null; t.woba = t.b.pa ? t.b.w / t.b.pa : null; t.xera = t.p.pa ? t.p.xe / t.p.pa : null; t.era = t.p.pa ? t.p.e / t.p.pa : null; });
    return T;
  }
  function teamStatcast(abbr) {
    if (!SV) { loadSavant(); return svWaitNote(); }
    var T = svTeams(), me = T[abbr] || {}, all = Object.keys(T);
    var rk = function (k, low) { var v = me[k]; if (v == null) return "—"; return ordinal(1 + all.filter(function (a) { return T[a][k] != null && (low ? T[a][k] < v : T[a][k] > v); }).length); };
    var html = '<p class="lede">Last season\'s Statcast numbers for the players on this roster now, from Baseball Savant: expected stats credit how hard and at what angle each ball was hit, not where it landed. Team lines weight each player by his plate appearances. Red is good, blue is bad.</p>';
    html += '<div class="stats">' + stat(f3(me.xwoba), "Hitters' xwOBA (" + rk("xwoba") + ")") + stat(me.woba != null ? (me.woba - me.xwoba > 0 ? "+" : "") + f3(me.woba - me.xwoba) : "—", "wOBA minus xwOBA") +
      stat(me.xera != null ? me.xera.toFixed(2) : "—", "Pitchers' xERA (" + rk("xera", true) + ")") + stat(me.era != null ? (me.era - me.xera > 0 ? "+" : "") + (me.era - me.xera).toFixed(2) : "—", "ERA minus xERA") + "</div>";
    var bats = Object.keys(SV.bat).filter(function (id) { var p = H.byId[id] || H.byId[+id]; return p && p.t === abbr && SV.bat[id].x && SV.bat[id].x[0]; }).sort(function (a, b) { return SV.bat[b].x[0] - SV.bat[a].x[0]; });
    var pits = Object.keys(SV.pit).filter(function (id) { var p = H.byId[id] || H.byId[+id]; return p && p.t === abbr && SV.pit[id].x && SV.pit[id].x[0]; }).sort(function (a, b) { return SV.pit[b].x[0] - SV.pit[a].x[0]; });
    html += trkPanel("Hitters", "<th>Player</th><th class=\"hm\"></th><th class=\"hm\">PA</th><th>wOBA</th><th>xwOBA</th><th>xBA</th><th>xSLG</th><th>Barrel%</th><th>Avg EV</th><th>Hard hit%</th><th>Bat speed</th><th>Sprint</th>",
      bats.map(function (id) { var d = SV.bat[id], P = d.pct || {}, p = H.byId[id] || H.byId[+id];
        return '<tr><td class="tm">' + pname(p, 22) + svBadge(id, false) + "</td><td class=\"hm\"></td><td class=\"hm\">" + f0(d.x[0]) + "</td><td>" + f3(d.x[5]) + "</td>" + pctCell(P.xwoba, f3(d.x[6])) + pctCell(P.xba, f3(d.x[2])) + pctCell(P.xslg, f3(d.x[4])) + pctCell(P.brl_percent, d.ev ? f1(d.ev[3]) : "—") + pctCell(P.exit_velocity, d.ev ? f1(d.ev[0]) : "—") + pctCell(P.hard_hit_percent, d.ev ? f1(d.ev[5]) : "—") + pctCell(P.bat_speed, d.bt ? f1(d.bt[0]) : "—") + pctCell(P.sprint_speed, d.spd ? f1(d.spd[0]) : "—") + "</tr>"; }).join(""),
      bats.length + " qualified last season");
    html += trkPanel("Pitchers", "<th>Player</th><th class=\"hm\"></th><th class=\"hm\">PA</th><th>ERA</th><th>xERA</th><th>xwOBA</th><th>K%</th><th>BB%</th><th>Whiff%</th><th>Chase%</th><th>Barrel%</th><th>FB velo</th>",
      pits.map(function (id) { var d = SV.pit[id], P = d.pct || {}, p = H.byId[id] || H.byId[+id];
        return '<tr><td class="tm">' + pname(p, 22) + svBadge(id, true) + "</td><td class=\"hm\"></td><td class=\"hm\">" + f0(d.x[0]) + "</td><td>" + (d.x[7] != null ? d.x[7].toFixed(2) : "—") + "</td>" + pctCell(P.xera, d.x[8] != null ? d.x[8].toFixed(2) : "—") + pctCell(P.xwoba, f3(d.x[6])) + ["k_percent", "bb_percent", "whiff_percent", "chase_percent", "brl_percent", "fb_velocity"].map(function (k) { return pctCell(P[k]); }).join("") + "</tr>"; }).join(""),
      pits.length + " qualified last season; the last six columns are percentiles");
    return html + svFoot();
  }

  // who's outrun his contact, and who's due: actual against expected
  function luckPage() {
    if (!SV) { loadSavant(); view.innerHTML = svWaitNote(); return; }
    var kind = state.q.k === "p" ? "p" : "b";
    var html = svHead("Expected vs. actual", "Statcast's expected stats credit each batted ball by how hard and at what angle it was hit, not where it landed. The gap shows who got lucky and who's due, since the expected numbers predict next year better than the real ones.");
    html += '<div class="controls">' + svSeg("k", kind, [["b", "Hitters"], ["p", "Pitchers"]]) + "</div>";
    if (kind === "b") {
      var r = Object.keys(SV.bat).map(function (id) { var d = SV.bat[id]; return d.x && d.x[5] != null && d.x[6] != null ? { id: id, d: d, gap: d.x[5] - d.x[6] } : null; }).filter(Boolean);
      var row = function (x) { return "<tr>" + svWho(x.id, x.d) + "<td class=\"hm\">" + f0(x.d.x[0]) + "</td><td>" + f3(x.d.x[5]) + "</td><td>" + f3(x.d.x[6]) + '</td><td class="' + (x.gap > 0 ? "neg" : "pos") + '"><b>' + (x.gap > 0 ? "+" : "") + f3(x.gap) + "</b></td><td>" + f3(x.d.x[1]) + " / " + f3(x.d.x[2]) + "</td><td>" + f3(x.d.x[3]) + " / " + f3(x.d.x[4]) + "</td></tr>"; };
      var head = "<th>Player</th><th class=\"hm\"></th><th class=\"hm\">PA</th><th>wOBA</th><th>xwOBA</th><th>Gap</th><th>BA / xBA</th><th>SLG / xSLG</th>";
      html += '<div class="grid2">' + trkPanel("Due for better", head, r.slice().sort(function (a, b) { return a.gap - b.gap; }).slice(0, 25).map(row).join(""), "hit better than he got") +
        trkPanel("Outran his contact", head, r.slice().sort(function (a, b) { return b.gap - a.gap; }).slice(0, 25).map(row).join(""), "got more than he hit") + "</div>";
    } else {
      var pr = Object.keys(SV.pit).map(function (id) { var d = SV.pit[id]; return d.x && d.x[7] != null && d.x[8] != null ? { id: id, d: d, gap: d.x[7] - d.x[8] } : null; }).filter(Boolean);
      var prow = function (x) { return "<tr>" + svWho(x.id, x.d) + "<td class=\"hm\">" + f0(x.d.x[0]) + "</td><td>" + x.d.x[7].toFixed(2) + "</td><td>" + x.d.x[8].toFixed(2) + '</td><td class="' + (x.gap > 0 ? "pos" : "neg") + '"><b>' + (x.gap > 0 ? "+" : "") + x.gap.toFixed(2) + "</b></td><td>" + f3(x.d.x[5]) + " / " + f3(x.d.x[6]) + "</td></tr>"; };
      var ph = "<th>Player</th><th class=\"hm\"></th><th class=\"hm\">PA</th><th>ERA</th><th>xERA</th><th>Gap</th><th>wOBA / xwOBA</th>";
      html += '<div class="grid2">' + trkPanel("Due for better", ph, pr.slice().sort(function (a, b) { return b.gap - a.gap; }).slice(0, 25).map(prow).join(""), "ERA above his xERA") +
        trkPanel("Outran his contact", ph, pr.slice().sort(function (a, b) { return a.gap - b.gap; }).slice(0, 25).map(prow).join(""), "ERA below his xERA") + "</div>";
    }
    view.innerHTML = html + svFoot();
  }

  // the best pitches in baseball, by run value, filtered by type
  function arsenalPage() {
    if (!SV) { loadSavant(); view.innerHTML = svWaitNote(); return; }
    var type = state.q.t || "all", sort = state.q.s || "rv100", aq = (state.q.q || "").toLowerCase();
    var html = svHead("Pitch arsenals", "Every pitch thrown at least a few hundred times, ranked by run value: runs saved compared with an average pitch in the same counts. Per 100 is the rate; the total rewards pitches thrown a lot.");
    var TYPES = [["all", "All"], ["FF", "4-seam"], ["SI", "Sinker"], ["FC", "Cutter"], ["SL", "Slider"], ["ST", "Sweeper"], ["CU", "Curve"], ["CH", "Changeup"], ["FS", "Splitter"]];
    html += '<div class="controls">' + svSeg("t", type, TYPES) + '<label>Search<input type="search" data-q="q" value="' + esc(state.q.q || "") + '" placeholder="Player"></label></div>';
    var rows = [];
    Object.keys(SV.pit).forEach(function (id) { (SV.pit[id].ars || []).forEach(function (a) { if ((type === "all" || a[0] === type || (type === "CU" && a[0] === "KC")) && (a[9] || 0) >= 250 && (!aq || String(SV.pit[id].n).toLowerCase().indexOf(aq) >= 0)) rows.push({ id: id, d: SV.pit[id], a: a }); }); });
    // run value in Savant's pitcher file is from the pitcher's side: positive is runs saved
    var key = { rv100: function (r) { return r.a[3] || 0; }, rv: function (r) { return r.a[4] || 0; }, whiff: function (r) { return r.a[5] || 0; }, pa: function (r) { return r.a[6] || 0; }, xw: function (r) { return -(r.a[7] || 1); }, use: function (r) { return r.a[2] || 0; } }[sort] || function (r) { return r.a[3] || 0; };
    rows.sort(function (a, b) { return key(b) - key(a); });
    var flip = svRv;
    html += trkPanel("Best pitches", "<th>Player</th><th class=\"hm\"></th><th>Pitch</th>" + svSortTh("use", "Usage", sort) + svSortTh("rv100", "Runs per 100", sort, "Runs saved per 100 pitches") + svSortTh("rv", "Runs", sort, "Runs saved over the season") + svSortTh("whiff", "Whiff%", sort) + svSortTh("pa", "Put away%", sort, "Two-strike pitches that end in a strikeout") + svSortTh("xw", "xwOBA", sort) + "<th>Hard hit%</th><th>Pitches</th>",
      rows.slice(0, 200).map(function (r) { var a = r.a; return "<tr>" + svWho(r.id, r.d) + '<td style="text-align:left">' + esc(a[1]) + "</td><td>" + f1(a[2]) + "%</td><td><b>" + flip(a[3]) + "</b></td><td>" + flip(a[4]) + "</td><td>" + f1(a[5]) + "</td><td>" + f1(a[6]) + "</td><td>" + f3(a[7]) + "</td><td>" + f1(a[8]) + "</td><td>" + f0(a[9]) + "</td></tr>"; }).join(""),
      rows.length + " pitches");
    view.innerHTML = html + svFoot();
  }

  // the card's Statcast tab: Savant-style percentile bars, expected stats, batted balls or the arsenal
  function svPane(p) {
    if (!SV) return '<p class="note">Loading Statcast…</p>';
    var d = (p.p ? SV.pit : SV.bat)[p.id] || (p.p ? SV.bat : SV.pit)[p.id];
    if (!d) return '<p class="note">No ' + (SV.season || "") + " Statcast numbers for him (Savant lists qualified players, and pitchers with enough batters faced).</p>";
    var P = d.pct || {}, isP = d === SV.pit[p.id];
    var bars = isP ? [["xera", "xERA"], ["xwoba", "xwOBA"], ["k_percent", "K%"], ["bb_percent", "BB%"], ["whiff_percent", "Whiff%"], ["chase_percent", "Chase%"], ["brl_percent", "Barrel%"], ["hard_hit_percent", "Hard hit%"], ["exit_velocity", "Avg EV"], ["fb_velocity", "Fastball velo"], ["fb_spin", "Fastball spin"], ["curve_spin", "Curve spin"]]
      : [["xwoba", "xwOBA"], ["xba", "xBA"], ["xslg", "xSLG"], ["exit_velocity", "Avg EV"], ["max_ev", "Max EV"], ["brl_percent", "Barrel%"], ["hard_hit_percent", "Hard hit%"], ["bat_speed", "Bat speed"], ["squared_up_rate", "Squared up"], ["k_percent", "K%"], ["bb_percent", "BB%"], ["whiff_percent", "Whiff%"], ["chase_percent", "Chase%"], ["sprint_speed", "Sprint speed"], ["oaa", "Outs above avg"], ["arm_strength", "Arm strength"]];
    var html = window.PCard.sec((SV.season || "") + " percentile rankings", "vs MLB " + (isP ? "pitchers" : "hitters")) + window.PCard.bars(bars.filter(function (b) { return P[b[0]] != null; }).map(function (b) { return { label: b[1], pct: P[b[0]] }; }));
    if (Object.keys(P).length < 5) html += '<p class="note">He fell short of Savant\'s playing-time cutoffs for most percentile ranks' + (isP ? ", common for relievers" : "") + ".</p>";
    if (d.x) html += '<div class="kv">' + (isP ? kv(d.x[7] != null ? d.x[7].toFixed(2) : "—", "ERA") + kv(d.x[8] != null ? d.x[8].toFixed(2) : "—", "xERA") : kv(f3(d.x[1]), "BA") + kv(f3(d.x[2]), "xBA") + kv(f3(d.x[4]), "xSLG")) + kv(f3(d.x[5]), "wOBA") + kv(f3(d.x[6]), "xwOBA") + "</div>";
    if (!isP && d.ev) html += '<div class="kv">' + kv(f1(d.ev[0]), "Avg EV") + kv(f1(d.ev[1]), "Max EV") + kv(f1(d.ev[3]) + "%", "Barrel%") + kv(f1(d.ev[2]) + "%", "Sweet spot") + kv(d.bt ? f1(d.bt[0]) : "—", "Bat speed") + kv(d.spd ? f1(d.spd[0]) : "—", "Sprint ft/s") + "</div>";
    if (isP && d.ars) html += '<h4 class="card-sec">Arsenal</h4><div class="scroll"><table class="t"><thead><tr><th>Pitch</th><th>Usage</th><th>Runs/100</th><th>Whiff%</th><th>Put away%</th><th>xwOBA</th></tr></thead><tbody>' +
      d.ars.map(function (a) { return '<tr><td style="text-align:left">' + esc(a[1]) + "</td><td>" + f1(a[2]) + "%</td><td>" + svRv(a[3]) + "</td><td>" + f1(a[5]) + "</td><td>" + f1(a[6]) + "</td><td>" + f3(a[7]) + "</td></tr>"; }).join("") + "</tbody></table></div>";
    return html + '<p class="note">Red is good, blue is bad, from <a href="https://baseballsavant.mlb.com/savant-player/' + esc(p.id) + '" rel="noopener">his Baseball Savant page</a>.</p>';
  }

  // ---------- trade value leaderboard ----------
  function controls(extra) {
    return '<div class="controls">' +
      '<label>$ per WAR (' + H.season + ')<input type="number" step="0.1" min="2" max="30" data-cfg="dpw" value="' + H.cfg.dpw.toFixed(1) + '"></label>' +
      '<label>Yearly inflation %<input type="number" step="0.5" min="0" max="10" data-cfg="inflation" value="' + (H.cfg.inflation * 100).toFixed(1) + '"></label>' +
      '<label>Discount rate %<input type="number" step="0.5" min="0" max="20" data-cfg="discount" value="' + (H.cfg.discount * 100).toFixed(1) + '"></label>' +
      '<label title="Seasons more than three years out count this share of the projection, compounding: projections that far ahead miss more often. 100% counts the full projection every season">Far-off seasons count %<input type="number" step="5" min="50" max="100" data-cfg="lateFade" value="' + (H.cfg.lateFade * 100).toFixed(0) + '"></label>' +
      '<label title="Teams pay for less than the full projection: a margin of safety for injuries and misses">WAR counted %<input type="number" step="5" min="50" max="100" data-cfg="haircut" value="' + (H.cfg.haircut * 100).toFixed(0) + '"></label>' +
      '<label title="Production: what he should produce. Market: what a free agent gets for that many years, length premium included (like Baseball Trade Values)">Value as<select data-cfg-lens><option value="production"' + (H.cfg.lens !== "market" ? " selected" : "") + '>Production</option><option value="market"' + (H.cfg.lens === "market" ? " selected" : "") + ">Market price</option></select></label>" +
      '<label title="How much an unproven big leaguer\'s value (under 3 years of service and short of two full seasons\' playing time) keeps from one year to the next">Young players keep %<input type="number" step="5" min="30" max="100" data-cfg="youngFade" value="' + (H.cfg.youngFade * 100).toFixed(0) + '"></label>' +
      '<label class="chk" title="Nudges each qualified player\'s projection by a third of the gap between last season\'s Statcast expected stats and his results: due-for-better players gain, lucky ones lose (up to a win either way). Your read, not the model: the projections already use some of this.">Lean on Statcast<input type="checkbox" data-statcast' + (H.cfg.statcast ? " checked" : "") + "></label>" + (extra || "") + "</div>";
  }
  view.addEventListener("change", function (e) {
    var c = e.target.closest("[data-statcast]");
    if (!c) return;
    var on = c.checked;
    save("statcast", on);
    loadSavant().then(function () { applyStatcast(on); render(); });
  });
  view.addEventListener("change", function (e) {
    var l = e.target.closest("[data-cfg-lens]");
    if (!l) return;
    H.set("lens", l.value);
    save("lens", l.value);
    surplusCache = null;
    render();
  });
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
    }).sort(function (a, b) { return sortDir * (a.s.pv - b.s.pv); });
    var total = list.length, shown = Math.min(total, Math.max(150, +q.n || 150));
    list = list.slice(0, shown);
    var opt = function (v, l, cur) { return '<option value="' + v + '"' + (v === cur ? " selected" : "") + ">" + l + "</option>"; };
    var html = '<h2 class="sec">Trade Value</h2><p class="lede">Value is what a player should produce over the rest of his contract or team control, at the market price of a win. Contract is what he\'ll be paid. Surplus is the difference, in real contract dollars (set a discount rate below to see today\'s dollars). ' +
      (H.market ? "The price of a win (" + money(H.cfg.dpw) + ") is read from the last few winters of free agent deals." : "The price of a win is an assumption until the free agent data arrives.") + " Change any assumption and every number updates.</p>";
    html += '<p class="note"><span class="pill sv-due">Due</span> and <span class="pill sv-lucky">Lucky</span> come from Statcast: a hitter whose wOBA ran .025 below or above his xwOBA last season, or a pitcher whose ERA ran three-quarters of a run above or below his xERA. Expected stats predict next year better than the real ones, so Due is a buy-low and Lucky a sell-high. <a href="#/luck">See the full lists</a>.</p>';
    html += controls('<label>Team<select data-q="t">' + opt("", "All teams", tm) + H.teams.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (t) { return opt(t.abbr, t.name, tm); }).join("") + "</select></label>" +
      '<label>Players<select data-q="k">' + opt("all", "Everyone", kind) + opt("bat", "MLB hitters", kind) + opt("pit", "MLB pitchers", kind) + opt("pros", "Prospects", kind) + "</select></label>" +
      '<label>Show<select data-q="sort">' + opt("", "Most surplus", q.sort || "") + opt("worst", "Worst contracts", q.sort || "") + "</select></label>" +
      '<label>Search<input type="search" data-q="s" value="' + esc(q.s || "") + '" placeholder="Player"></label>');
    html += '<div class="panel"><div class="scroll"><table class="t"><thead><tr><th>Player</th><th>Team</th><th>Pos</th><th>Age</th><th>Contract</th><th>Thru</th><th>' + H.season + ' WAR</th><th>Value</th><th>Contract</th><th>Surplus</th></tr></thead><tbody>';
    list.forEach(function (x, i) {
      var p = x.p, s = x.s, lastY = s.rows.length ? s.rows[s.rows.length - 1].y : "—";
      var ctr = p.c && p.c.desc ? p.c.desc.replace(/\s*\(.*?\)/, "") : p.fv && p.g === "min" ? "Prospect · FV " + p.fv : s.rows[0] ? s.rows[0].kind : "";
      html += "<tr><td>" + (i + 1) + ". " + pname(p, 22) + svBadge(p.id, !!p.p) + "</td><td>" + logo(p.t, 18) + "</td><td>" + esc(p.pos || "") + "</td><td>" + (p.age ? Math.floor(p.age) : "—") +
        '</td><td style="text-align:left;max-width:220px;overflow:hidden;text-overflow:ellipsis">' + esc(ctr) + "</td><td>" + lastY + "</td><td>" + f1(H.warAt(p, H.season)) + "</td><td>" + money(s.valuePV) + "</td><td>" + money(s.contractPV) +
        '</td><td class="' + (s.pv >= 0 ? "pos" : "neg") + '"><b>' + signed(s.pv) + "</b></td></tr>";
    });
    html += "</tbody></table></div>" +
      '<div class="body more-row"><span class="note">Showing ' + shown.toLocaleString() + " of " + total.toLocaleString() + " players. Search finds anyone.</span>" +
      (shown < total ? ' <a class="btn" href="' + href("value", Object.assign({}, q, { n: shown + 150 })) + '">Show 150 more</a> <a class="btn" href="' + href("value", Object.assign({}, q, { n: total })) + '">Show all</a>' : "") + "</div></div>";
    view.innerHTML = html;
  }
  view.addEventListener("change", function (e) {
    var c = e.target.closest("[data-q]");
    if (!c) return;
    var q = Object.assign({}, state.q);
    q[c.dataset.q] = c.value || null;
    if (c.dataset.q !== "n") delete q.n; // a new filter starts back at the top 150
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
      var ids = tr[k] || [], tot = 0, rows = "", tm = tr.teams[k], tv = 0, tc = 0;
      ids.forEach(function (id) {
        var p = H.byId[id], sv = H.surplus(p);
        tot += sv.pv; tv += sv.valuePV; tc += sv.contractPV;
        rows += "<li>" + pname(p, 28) + svBadge(p.id, !!p.p) + '<span class="grow"><span class="sub">' + logo(p.t, 14) + " " + esc(p.pos || "") + " · " + (p.c && p.c.desc ? esc(p.c.desc.replace(/\s*\(.*?\)/, "")) : p.fv && p.g === "min" ? "FV " + esc(p.fv) : esc((sv.rows[0] || {}).kind || "")) +
          '</span></span><b class="' + (sv.pv >= 0 ? "pos" : "neg") + '">' + signed(sv.pv) + '</b><button class="xbtn" data-rm="' + k + '" data-id="' + esc(id) + '" aria-label="Remove">×</button></li>';
      });
      totals[k] = tot;
      var rg = ids.reduce(function (a, id) { var r = H.range(H.byId[id]); return [a[0] + r.lo, a[1] + r.hi]; }, [0, 0]);
      html += '<div class="side"><div class="side-h">' + (tm ? logo(tm, 28) : "") + '<select data-tside="' + k + '" aria-label="Team for side ' + "ABC"[i] + '">' + teamOpts(tm) + "</select></div>" +
        '<div class="search"><input type="search" placeholder="' + (tm ? "Search the " + esc(team(tm).name) : "Search any player or prospect") + '" data-side="' + k + '" autocomplete="off"><div class="results" hidden></div></div>' +
        '<p class="sends">Sends</p><ul class="rlist">' + (rows || '<li class="note">No one yet.</li>') + '</ul><div class="tot"><span>Surplus sent</span><span class="num">' + signed(tot) + '</span></div><p class="note" style="margin:4px 0 0">Value ' + money(tv) + " − contracts " + money(tc) + (ids.length ? ". Likely range " + signed(rg[0]) + " to " + signed(rg[1]) : "") + "</p>" +
        (tm ? orgPicker(tm, k, ids) : "") + "</div>";
    });
    html += "</div>";
    if (!tr.three) html += '<p><button class="btn" data-three>+ Add a third team</button></p>';
    var a = totals.a || 0, b = totals.b || 0;
    if ((tr.a || []).length && (tr.b || []).length && !tr.three) {
      // the grades go above the two sides, where they're seen as the deal changes (the org lists below run long)
      var at = html.indexOf('<div class="sides">');
      html = html.slice(0, at) + tradeGrades(tr, totals) + html.slice(at);
    } else if (tr.three && sides.every(function (k) { return (tr[k] || []).length; })) {
      html += '<div class="verdict"><b>Three-team deal.</b> ' + sides.map(function (k, i) { return esc(sideName(tr, k, i)) + " send " + signed(totals[k]); }).join(" · ") + "<small>Compare what each side gives up.</small></div>";
    }
    html += '<p><button class="btn" data-clear>Clear the trade</button></p>';
    view.innerHTML = html;
  }
  // Trade grades, like the signing grades: each team's surplus in against surplus out (model.js gradeTrade), with the
  // same credit for taking in a player who fills a hole, and next season's WAR changing hands for the win-now view
  function sentBy(tr, k) { // the team a side is: its pick, or the club all its players come from
    if (tr.teams[k]) return tr.teams[k];
    var ts = (tr[k] || []).map(function (id) { return H.byId[id].t; });
    return ts.length && ts.every(function (t) { return t === ts[0]; }) ? ts[0] : null;
  }
  function nowWar(ids) {
    return (ids || []).reduce(function (a, id) { var r = H.surplus(H.byId[id]).rows[0]; return a + (r && r.y === H.season ? r.war : 0); }, 0);
  }
  function tradeNeed(abbr, ids) {
    if (!abbr) return null;
    var best = null;
    (ids || []).forEach(function (id) {
      var p = H.byId[id], r = H.surplus(p).rows[0];
      if (p.g === "min" || !r || r.y !== H.season || p.t === abbr) return;
      var pos = p.p ? (/SP/.test(p.pos || "") ? "SP" : "RP") : (p.el && p.el.length ? p.el : [p.pos]).join("/");
      if (pos === "RP") return; // the hole test covers lineup spots and the rotation
      var nd = H.need({ to: abbr, id: p.id, pos: pos }, r.war);
      if (nd && (!best || (nd.fills && !best.fills) || (nd.fills === best.fills && nd.up > best.up))) best = Object.assign({ p: p }, nd);
    });
    return best;
  }
  function sideSd(ids) { return Math.sqrt((ids || []).reduce(function (a, id) { var r = H.range(H.byId[id]); return a + r.sd * r.sd; }, 0)); }
  function tradeGrades(tr, totals) {
    var sd = Math.sqrt(Math.pow(sideSd(tr.a), 2) + Math.pow(sideSd(tr.b), 2));
    var rows = ["a", "b"].map(function (k, i) {
      var o = k === "a" ? "b" : "a", abbr = sentBy(tr, k), nd = tradeNeed(abbr, tr[o]);
      return { k: k, name: sideName(tr, k, i), abbr: abbr, gr: M.gradeTrade(totals[k] || 0, totals[o] || 0, nd, sd), now: nowWar(tr[o]) - nowWar(tr[k]) };
    });
    var win = rows[0].gr.net > 0 ? rows[0] : rows[1], d = Math.abs(rows[0].gr.net);
    var even = /^B$/.test(rows[0].gr.g) && /^B$/.test(rows[1].gr.g) || d < 2;
    var html = '<div class="verdict tgrades"><p class="tg-head">' + (even ? "<b>About even.</b> The surplus going each way is within " + money(d) + "."
      : "<b>" + esc(win.name) + " win" + (/s$/.test(win.name) ? "" : "s") + "</b> by " + money(d) + " of surplus value, and come out ahead in about " + pct(win.gr.pWin, 0) + " of outcomes.") + "</p>";
    rows.forEach(function (r) {
      var gr = r.gr, nd = gr.need;
      var tip = (gr.edge >= 0 ? "Takes in " : "Gives up ") + pct(Math.abs(gr.edge), 0) + " more surplus than it " + (gr.edge >= 0 ? "sends" : "gets") + (gr.credit ? "; fills a need" : "");
      html += '<div class="tg-row"><span class="grade g-' + gr.g.charAt(0).toLowerCase() + '" title="' + esc(tip) + '">' + esc(gr.g) + "</span>" +
        (r.abbr ? logo(r.abbr, 22) : "") + '<div class="grow"><b>' + esc(r.name) + "</b>" + (gr.credit ? ' <span class="pill up" title="Takes in a player who fills a hole">Need</span>' : "") +
        "<small>Gets " + signed(gr.got) + ", gives " + signed(gr.sent) + " (" + signed(gr.net) + "). " + H.season + ": " + (Math.abs(r.now) < 0.05 ? "no change in WAR" : (r.now > 0 ? "+" : "") + r.now.toFixed(1) + " WAR") +
        (nd && nd.fills ? ". " + esc(nd.p.n) + " fills a hole: without him their " + esc(nd.label) + " ranks " + ord(nd.rank) + " in MLB" : "") + ".</small></div></div>";
    });
    return html + "<small>Grades weigh the surplus each team takes in against what it gives up, as a share of the bigger side, scaled by how sure the edge is (each player's value range: wide for prospects and for players whose seasons swing). Even is a B, a sure edge of 8% a B+, 18% an A-, 30% an A, 50% an A+, and the same steps down to an F. Taking in a player who fills a hole gives 8 points of room, as with signings. Surplus isn't everything: contenders pay for wins now, and payroll room matters.</small></div>";
  }

  // A team's roster and farm, best surplus first, to add with one tap
  function orgPicker(abbr, k, ids) {
    var on = {};
    (ids || []).forEach(function (id) { on[id] = 1; });
    var list = H.org(abbr).map(function (p) { return { p: p, s: H.surplus(p) }; })
      .filter(function (x) { return x.s.rows.length && !on[x.p.id]; })
      .sort(function (x, y) { return (x.p.g === "min") - (y.p.g === "min") || y.s.pv - x.s.pv; });
    var row = function (x) {
      return '<button type="button" class="org-row" data-pick="' + esc(x.p.id) + '" data-side="' + k + '">' + face(x.p, 22) + '<span class="grow">' + esc(x.p.n) + ' <span class="note">' + esc(x.p.pos || "") + (x.p.fv && x.p.g === "min" ? " · FV " + esc(x.p.fv) : "") + "</span>" + svBadge(x.p.id, !!x.p.p) + '</span><b class="' + (x.s.pv >= 0 ? "pos" : "neg") + '">' + signed(x.s.pv) + "</b></button>";
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
    var signedN = board.filter(function (x) { return x.signed; }).length;
    html += '<p class="lede">' + (board.length - signedN) + " free agents still unsigned, " + signedN + " signed so far.</p>";
    html += gradesPanel(board);
    html += '<p class="note"><span class="pill sv-due">Due</span> and <span class="pill sv-lucky">Lucky</span> come from Statcast: a hitter whose wOBA ran .025 below or above his xwOBA last season, or a pitcher whose ERA ran three-quarters of a run above or below his xERA. Expected stats predict next year better than the real ones, so Due is a buy-low and Lucky a sell-high. <a href="#/luck">See the full lists</a>.</p>';
    var show = q.f || "open";
    var opt = function (v, l) { return '<option value="' + v + '"' + (v === show ? " selected" : "") + ">" + l + "</option>"; };
    html += controls('<label>Show<select data-q="f">' + opt("open", "Still unsigned") + opt("all", "Everyone") + opt("signed", "Signed") + opt("bat", "Hitters") + opt("sp", "Starters") + opt("rp", "Relievers") + "</select></label>");
    var list = board.filter(function (x) {
      var pos = String(x.r.pos || "");
      if (show === "signed") return x.signed;
      if (show !== "all" && x.signed) return false; // the pool is who's still out there; signings sit in the graded panel
      if (show === "rp") return /RP/.test(pos);
      if (show === "sp") return /SP/.test(pos);
      if (show === "bat") return !/P$|SP|RP/.test(pos);
      return true;
    });
    var withSigned = list.some(function (x) { return x.signed; });
    html += '<div class="panel"><div class="scroll"><table class="t"><thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>From</th><th>Proj WAR</th><th title="Statcast expected stats: xwOBA for hitters, xERA for pitchers">xwOBA / xERA</th><th>QO</th><th>Crowd</th><th>Fair / yr</th><th>Market / yr</th>' + (withSigned ? "<th>Signed</th><th>vs Market</th><th>Grade</th>" : "") + "</tr></thead><tbody>";
    list.forEach(function (x, i) {
      var r = x.r, pl = faName(x, 24), fp = /P$|SP|RP/.test(String(r.pos || ""));
      html += "<tr><td>" + (x.rank || "—") + ". " + pl + svBadge(r.id, fp) + "</td><td>" + esc(r.pos || "") + "</td><td>" + (x.age || "—") + "</td><td>" + teamMark(r.from, 20) + "</td><td>" + (x.trust < 1 ? '<span title="' + esc(faithNote(r, x.trust, x.proj)) + '">' + f1(x.war) + "*</span>" : f1(x.war)) + "</td><td>" + svExp(r.id, fp) + "</td><td>" + (r.qo ? '<span class="pill warn">QO</span>' : "") +
        "</td><td>" + (r.my ? r.my + " yr · " + money(x.crowdAav) : "—") + "</td><td>" + money(x.spotAav) + "</td><td><b>" + money(x.mktAav) + "</b></td>" + (!withSigned ? "</tr>" : "<td>" +
        (x.signed ? esc(r.to || "") + " " + (r.yrs || "?") + " yr · " + money(x.signedAav) : '<span class="note">unsigned</span>') + "</td><td class=\"" + (x.gap == null ? "" : x.gap > 0 ? "neg" : "pos") + '">' +
        (x.gap == null ? "" : (x.gap > 0 ? "+" : "") + pct(x.gap, 0)) + "</td><td>" + gradeTag(x.grade) + "</td></tr>");
    });
    html += "</tbody></table></div></div>";
    html += '<h2 class="sec">How these numbers work</h2><p class="lede"><b>Fair</b> is what each free agent is worth per year over the crowd\'s contract length (or the length he signed for): his projected wins at the market price of a win (' + money(H.cfg.dpw) + '), adjusted for what players of his tier have gone for. <b>Market</b> adds what deals of that length have actually gone for: one-year deals come in well under the going rate, long ones over it. A player coming off a big league club with little big league time (under about 1,000 plate appearances, 300 innings as a starter or 120 in relief over three seasons) has his projection counted at 55-100%, since it leans on minor league or overseas numbers teams discount (marked *); players signing from Japan or Korea keep theirs. The crowd numbers are FanGraphs readers\' median predictions.</p>' +
      '<p class="lede"><b>Grades</b> weigh what a team pays against the market price for deals that long. B runs from 6% under market to 10% over, since teams expect to pay a small premium; a signing that fills a hole (a spot in the bottom third of the league that he improves by most of a win) gets a little more room, and a qualifying-offer player costs a small dock (about ' + money(H.cfg.qoPickCost) + ' for the lost pick). <b>Surplus</b> is what he should produce over the deal minus his salary, discounted, as on his card. Deals awaiting contract terms or a projection are marked pending.</p>';
    if (mk) html += marketCallout(mk) + marketSection(mk);
    view.innerHTML = html;
  }
  // Every signed deal this winter, best value first. Signed players leave the pool table below (by default) and live here
  // A team as a logo (name on hover); leagues abroad (NPB, KBO) as a short label
  function teamMark(abbr, size) {
    if (!abbr) return "";
    var t = H.byAbbr[abbr];
    return t ? '<span class="tm" title="' + esc(t.name) + '">' + logo(abbr, size) + "</span>" : '<span class="pill" title="' + esc(abbr) + '">' + esc(abbr) + "</span>";
  }
  function gradesPanel(board) {
    var all = board.filter(function (x) { return x.signed && x.rank != null && x.rank <= 25; });
    if (!all.length) return "";
    var per = 10, pages = Math.ceil(all.length / per), pg = Math.min(pages, Math.max(1, +state.q.dp || 1));
    var deals = all.slice((pg - 1) * per, pg * per);
    var html = '<div class="panel"><h3>Deals so far <small>' + all.length + " of the top 25 free agents signed</small></h3>" + '<div class="scroll"><table class="t grades"><thead><tr><th>Grade</th><th title="Rank in this winter\'s free agent class, by projected value">FA rank</th><th>Player</th><th>From</th><th></th><th>To</th><th>Deal</th><th>Market price</th><th>vs Market</th><th>Surplus</th></tr></thead><tbody>';
    deals.forEach(function (x) {
      var r = x.r, gr = x.grade, sv = x.p ? H.surplus(x.p).total : gr ? gr.prod : null;
      var tot = gr ? gr.paid : r.tot ? r.tot / 1e6 : r.yrs && x.signedAav ? x.signedAav * r.yrs : null;
      var mkt = gr ? gr.mkt : x.mktAav && r.yrs ? x.mktAav * r.yrs : null;
      var edge = gr ? gr.edge : mkt && tot != null ? (mkt - tot) / mkt : null;
      var why = !x.signedAav || !r.yrs ? "Contract terms pending" : "Projection pending";
      html += "<tr" + (gr ? "" : ' class="ungraded"') + "><td>" + (gr ? gradeTag(gr) + (gr.credit ? ' <span class="pill up" title="Fills a hole on this team">Need</span>' : "") : '<span class="grade g-n" title="' + esc(why) + '">' + esc(why) + '</span>') +
        "</td><td>" + (x.rank || "—") + "</td><td>" + faName(x, 24) + "</td><td>" + teamMark(r.from, 20) + '</td><td class="arrow">→</td><td>' + teamMark(r.to, 20) +
        "</td><td>" + (r.yrs || "?") + " yr · " + money(tot, tot < 10 ? 1 : 0) + (gr && gr.pick ? ' <span class="pill warn" title="Small dock for giving up a pick to sign a qualifying-offer player">QO</span>' : "") +
        "</td><td>" + (mkt != null ? money(mkt, mkt < 10 ? 1 : 0) : "—") + '</td><td class="' + (edge == null ? "" : edge >= 0 ? "pos" : "neg") + '">' + (edge == null ? "—" : pct(Math.abs(edge), 0) + (edge >= 0 ? " under" : " over")) +
        '</td><td class="' + (sv == null ? "" : sv >= 0 ? "pos" : "neg") + '">' + (sv == null ? "—" : signed(sv)) + "</td></tr>";
    });
    if (pages > 1) {
      var link = function (n, label) { return '<a class="btn" href="' + href("fa", Object.assign({}, state.q, { dp: n })) + '">' + label + "</a>"; };
      html += "</tbody></table></div>" + '<div class="body more-row"><span class="note">' + ((pg - 1) * per + 1) + "-" + Math.min(pg * per, all.length) + " of " + all.length + "</span>" +
        (pg > 1 ? link(pg - 1, "← Previous") : "") + (pg < pages ? link(pg + 1, "Next →") : "") + "</div></div>";
    } else html += "</tbody></table></div></div>";
    return html;
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
      "<li><b>Photos:</b> linked from MLB's own servers.</li>" +
      "<li><b>Ballparks:</b> each park's outline from GeomMLBStadiums (Ben Dilday, MIT license), traced from MLB Gameday's field diagrams as of 2023, labeled with published distances. A fence moved since then won't show; the A's Sacramento park is drawn from its published distances.</li></ul>" +
      "<h3>The year slider</h3><p>" + H.season + " is FanGraphs' Depth Charts as published. Every later season is built here: a player stays while he's under a guaranteed contract, a club option worth picking up, a player option he'd keep, or team control (pre-arb under three years of service, arbitration until six). Everyone else becomes a free agent, unless you re-sign him on his team's page. Ratings age a year at a time by season age (modest gains into the mid-20s, flat at 27 and 28, then falling about a fifth of a win a year at 29-30 and a third of a win from the early 30s on), and playing time grows slowly from FanGraphs' share for the coming season. Prospects arrive at their ETA (or by level when there isn't one) and grow toward the WAR their FV grade implies over their first three seasons. Each spot goes to the best available player who can play it; a team gets five starters and eight relievers. Spots nobody can fill are \"FA Fill\": a replacement player, or a modest free agent if teams sign them (the switch). Wins scale from team WAR so later seasons spread the way Depth Charts' do.</p>" +
      "<h3>Surplus value</h3><p>For each season of contract or control: projected WAR × the price of a win, minus salary" + (H.cfg.discount > 0 ? ", discounted " + pct(H.cfg.discount, 0) + " a year" : ", in real contract dollars (no discounting unless you set a rate)") + ". It counts the full projection, since the price of a win is read off what teams actually pay per projected WAR (cutting the WAR again would undervalue every veteran on a market deal; set a margin of safety on the Trade Value tab if you want one). A two-way player's pitching counts on top of his hitting. A player who isn't established yet (under three years of service and short of two full seasons' playing time: about 1,000 PA, 300 innings as a starter or 120 in relief) has seasons after the coming one counted at " + pct(H.cfg.youngFade, 0) + " of his projection with no big league record, rising toward 100% as he builds one (" + pct(H.cfg.extFade, 0) + " to start for a player already signed to an extension). The cut is flat, not compounding, and the card marks those seasons. These settings, and the arbitration shares below, are calibrated to Baseball Trade Values' November 2026 numbers. Value never drops below zero (a team can always play a replacement for the minimum), and a pre-arb or arbitration year can't cost the team more than it's worth, since those salaries aren't guaranteed. Arbitration pays 36/58/87% of market value (a fourth year 95%); pre-arb players earn the minimum (" + money(H.cfg.minSalary) + ", until the next CBA says otherwise). Club options are exercised only when they're worth it. A player option or opt-out is used when the rest of the deal pays more than he'd be worth over those years, so a player owed a lot on a long tail stays. A prospect's value is scaled by his risk grade.</p>" +
      "<h3>The price of a win</h3><p>" + (mk ? (mk.how === "crowd" ? "This winter's free agents: Steamer's projected WAR for each, aged over the contract the crowd predicts, against the crowd's predicted dollars, then adjusted by how far past crowds landed from real contracts (" + ((mk.crowdErr - 1) >= 0 ? "+" : "") + pct(mk.crowdErr - 1, 0) + "). That gives " + money(H.cfg.dpw) + " per win." : "Carried forward from the last three winters' deals: " + money(H.cfg.dpw) + " per win.") + " The premium patterns on the Free Agents tab come from every deal of the last five winters for a player projected at 1+ WAR, against that winter's going rate. Past classes don't carry the projection at signing, so it's estimated from the season before, fit to how Steamer projects this winter's class." : "The free agent data hasn't arrived yet, so the price of a win is an assumption: " + money(H.cfg.dpw) + ".") + "</p>" +
      "<h3>The hub's outlook</h3><p>FanGraphs' projections regress everyone toward the middle. The hub blends them with what each player has actually done: his WAR over the last three seasons per full season (600 PA; 180 innings as a starter, 65 in relief), weighted 5/4/3 toward the latest, against his projected full-season rate. " + pct(H.cfg.blend, 0) + " of the gap counts, scaled by how much playing time backs it (full at two seasons' worth), and the card says when it moves a player. Two guards keep one season from carrying the read. A career year that isn't his latest is tempered: the rate is half that weighted average and half his median season (a latest-season peak counts in full, since that's a trend). And missed time counts: how much of a full season he has actually played, weighted the same way, is set against the playing time FanGraphs projects, and half of any shortfall comes off (seasons before his first full one don't count against a young player, since a call-up isn't missed time). Standings and depth charts still use FanGraphs as published.</p>" +
      "<h3>Value ranges</h3><p>Every value carries a likely range: what he's worth if he lands below or above his projection by a share that depends on what's known. About 20% for a steady veteran, wider when his seasons have swung (Maikel Garcia's 1.2, 5.6 and 1.8 WAR) or he isn't established, up to 60%; a prospect's comes from his risk grade (35% for Low up to 80% for Extreme). Salaries don't move, and a pre-arb or arbitration year can't go below zero, since a team can non-tender a player who isn't worth his raise. The range is roughly an 80% band.</p>" +
      "<h3>Free agent value</h3><p>A free agent's value is his projected wins at the market price of a win, priced by tier (what players of his caliber have gone for) and, for the market price, by contract length (one-year deals come in well under the going rate, long deals over it); length and tier are read together from the last five winters, since most one-year deals go to lesser players. A player coming off a big league club with little big league time has his projection counted at 55-100%: full at about 1,000 plate appearances, 300 innings as a starter or 120 in relief over the last three seasons, 55% with none. Those projections lean on minor league or overseas numbers that teams discount until a player holds up in the majors. Players signing from Japan or Korea keep their full projection, since teams bid on those records. A signed player's card counts his value the same way.</p>" +
      "<h3>Far-off seasons and star pricing</h3><p>Seasons more than " + (H.cfg.lateAfter == null ? 3 : H.cfg.lateAfter) + " years out count " + pct(H.cfg.lateFade, 0) + " of the projection a year, compounding (" + pct(H.cfg.lateFade, 0) + ", then " + pct(H.cfg.lateFade * H.cfg.lateFade, 0) + "...), since projections that far ahead miss more often. That's for players short of six years' service (long team control, or an early extension on a short record); a veteran's later seasons already carry the aging curve, which steepens by half again from age 33. Set Far-off seasons to 100% on Trade Value to count the full projection every season. Wins are priced by tier: a win from a 1-WAR player costs about 78% of the going rate and one from a 3+ WAR player about 115%, since role players are plentiful and stars aren't. Both are calibrated to Baseball Trade Values' November 2026 values for players on long extensions (Witt, Crow-Armstrong, Merrill, Chourio, Carroll, Rafaela, Anthony). Player cards show projected and counted WAR side by side.</p>" +
      "<h3>Deal grades</h3><p>Each daily refresh grades major-league free-agent signings with known terms and a WAR projection. The grade compares what the team pays with what deals of that length have gone for (the market price on the Free Agents tab), and a team that signs another club's qualifying-offer player takes a small dock (about " + money(H.cfg.qoPickCost) + ") for the draft pick and pool money it gives up. Teams expect to pay a little over the going rate, so a B runs from 6% under market to 10% over. 6-15% under is a B+, 15-25% an A-, 25-40% an A, more than that an A+. Over market, 10-18% is a B-, then C+, C at 27%, D at 37% and F at 50% or more. A signing that fills a hole gets 8 points more room: without him, the spot (or the rotation, for a starter) ranks in the bottom third of the league, and he improves it by at least three quarters of a win. The player card lays out his projected WAR, what it's worth and his salary, season by season, so the surplus behind the grade is visible. The market study has fewer comparable deals for low-WAR players, particularly relievers. Grades follow the projections, so a deal can move a little as Steamer updates.</p>" +
      "<h3>Trade grades</h3><p>The Trade Builder grades each team in a two-team deal the way signings are graded: the surplus it takes in against the surplus it gives up, as a share of the bigger side (at least $20M, so a swap of spare parts doesn't swing a full letter). An even swap is a B. Winning by 8% of the deal is a B+, 18% an A-, 30% an A and 50% an A+; losing by the same steps gives a B-, C+, C, D and F. The edge is scaled by how sure it is: from both sides' value ranges, the chance the winning side really comes out ahead (P), times 2P - 1. A sure thing keeps its full edge, a 75% chance keeps half, and a coin flip grades as even, so a team that gives up steady value for a player whose seasons swing isn't handed an F. A team that takes in a hitter or starter who fills a hole (by the same test as signings) gets 8 points more room. Next season's WAR changing hands is shown beside the grade, since a contender may happily lose on surplus to win now.</p>" +
      "<h3>Production value or market price</h3><p>By default, value is what a player should produce: projected WAR, aged a year at a time, at the going rate for a win. Some trade-value sites (Baseball Trade Values, for one) value a player at what he'd get as a free agent instead. Free agent deals pay a premium for length (deals of six years or more ran about 19% over the going rate in the last five winters), so a star's long contract can look fair there and underwater here. The Value as switch on the Trade Value tab flips to market price: a remaining term of four or five years gets the premium those deals drew (" + pct(H.cfg.lenPrem ? H.cfg.lenPrem[4] : 0, 0) + "), six or more theirs (" + pct(H.cfg.lenPrem ? H.cfg.lenPrem[6] : 0, 0) + ").</p>" +
      "<h3>What it doesn't know</h3><ul><li>Trades and signings that haven't happened, beyond the switch for filling open spots.</li><li>Injuries after the first season, platoons, and teams' payroll limits.</li><li>Super Two arbitration, and anything the next CBA changes (the current one expires December 1, 2026).</li></ul>" +
      '<p class="note">Data pulled ' + esc(HUB.pulled || "—") + ", built " + esc(HUB.built) + (HUB.failed && HUB.failed.length ? " (last pull missed: " + esc(HUB.failed.join(", ")) + "; using the previous copy)" : "") + ".</p>" +
      '<h3>Statcast and the "Lean on Statcast" setting</h3><p>Baseball Savant\'s expected stats credit each batted ball by how hard and at what angle it was hit, not where it landed. Tested on every hitter and pitcher with 300+ plate appearances in back-to-back seasons from 2018 to 2026, last season\'s xwOBA predicts next season\'s wOBA better than last season\'s wOBA does (out of sample, R\u00b2 .265 against .224 for hitters, .157 against .121 for pitchers). The projections here already use quality of contact, though, so the setting is off by default and, when on, counts only a third of each player\'s gap: a hitter\'s wOBA minus xwOBA turned into runs at the wOBA scale (about 1.25) over his projected plate appearances, a pitcher\'s ERA minus xERA over his projected innings, about 10 runs a win, capped at a win either way, all of it this season and half the next. Every spring the hub saves its preseason projections and last season\'s Statcast (mlb/data/archive), so the setting can be checked against what actually happens, and made the default if it beats the projections alone.</p></div>';
  }

  // ---------- start ----------
  // park shapes (team pages) and past seasons (player cards) load alongside, without holding up the first screen
  Promise.all([
    fetch("data/hub.json", { cache: "no-cache" }).then(function (r) { return r.json(); }),
    fetch("data/fa.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : { classes: {} }; }).catch(function () { return { classes: {} }; })
  ]).then(function (d) {
    HUB = d[0];
    H = new M.Hub(HUB, d[1]);
    H.set("lens", load("lens", "production") === "market" ? "market" : "production");
    var f = load("fill", true);
    fillBox.checked = f;
    H.set("fill", f);
    $("#kicker").textContent = "MLB · " + HUB.season + " projections";
    $("#foot").innerHTML = "Data from FanGraphs (Depth Charts, Steamer, RosterResource, The Board), pulled " + esc(HUB.pulled || "—") + '. Photos from MLB. <a href="#/method">How it works</a>.';
    render();
    // a link straight to a player's card (My teams uses it): /mlb/?card=<id>
    var dl = new URLSearchParams(location.search).get("card"); if (dl && (H.byId[dl] || H.byId[+dl])) openCard(dl);
    // after the first screen: park shapes (team pages), past seasons (player cards), then Statcast
    fetch("data/parks.json").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (p) { SHAPES = (p && p.parks) || null; if (state.route === "team") render(); });
    fetch("data/history.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (h) { historyData = h && h.season === HUB.season ? h : {}; });
    loadSavant().then(function () { if (load("statcast", false)) { applyStatcast(true); render(); } });
  }).catch(function (e) {
    view.innerHTML = '<p class="loading">Couldn\'t load the data. ' + esc(e.message) + "</p>";
  });
  // find any player or team (assets/search.js)
  if (window.Search) Search.mount({ sport: "mlb", placeholder: "Search MLB players and teams", hint: "Type a player or a team, like Devers or Red Sox.",
    index: function () {
      if (!H || !H.byId) return [];
      var out = Object.keys(H.byAbbr).map(function (a) { var t = team(a); return { id: a, kind: "t", name: t.name, sub: (t.lg || "") + " " + (t.div || ""), also: a, w: 5 }; });
      Object.keys(H.byId).forEach(function (id) { var p = H.byId[id]; if (!p || !p.n) return; var t = team(p.t); out.push({ id: id, kind: "p", name: p.n, sub: (H.byAbbr[p.t] ? t.name : "Free agent") + (p.pos ? ", " + p.pos : ""), also: (p.t || "") + " " + (p.pos || ""), w: Math.max(0, Math.min(5, (p.pj && p.pj.war) || 0)) }); });
      return out;
    },
    pic: function (x, s) { return x.kind === "t" ? logo(x.id, s) : face(H.byId[x.id], s); },
    open: function (x) { if (x.kind === "t") location.hash = href("team/" + x.id, {}); else openCard(x.id); } });
})();
