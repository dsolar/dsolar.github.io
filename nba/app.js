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
  function team(c) { return (H && H.teams[c]) || { code: c, name: c, short: c, color: "#33415c", espn: String(c || "").toLowerCase() }; }
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
  // Injury badge: red for out (with the season-long ones marked), amber for day-to-day; the latest news on hover
  // Injury: one letter (P probable, Q questionable, D doubtful, O out), the status, return and latest note on hover
  var INJ_WORD = { P: "Probable", Q: "Questionable", D: "Doubtful", O: "Out" };
  function injTag(p) {
    var j = H.injuryTag && H.injuryTag(p);
    if (!j) return "";
    var c = j.code || (j.dtd ? "Q" : "O");
    var head = j.season ? "Out for the season" : INJ_WORD[c] + (c === "O" && j.back && !j.guess && j.back > H.asOf ? ", back around " + fmtShort(j.back) : "");
    var tip = head + (j.note ? ". " + j.note : "") + (j.date ? " (" + fmtShort(j.date) + ")" : "");
    return ' <span class="injd inj-' + c.toLowerCase() + (j.season ? " sea" : "") + '" data-tip="' + esc(tip) + '" tabindex="0" role="img" aria-label="' + esc(head) + '">' + c + "</span>";
  }

  function shortName(n) { var w = String(n || "").split(" "); if (w.length < 2) return n; var suf = /^(Jr\.?|Sr\.?|II|III|IV)$/.test(w[w.length - 1]) ? w.pop() : ""; return w[0].charAt(0) + ". " + w.slice(1).join(" ") + (suf ? " " + suf : ""); }
  function pname(p, size, extra) {
    extra = (extra || "") + (p.fill || p.rook ? "" : injTag(p));
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
  // Links into the Big Board (draft/): ?p= opens a prospect, ?at= jumps to that spot on the board
  function howLink() { return '<a href="' + href("method") + '">How it works</a>'; }
  function boardHref(q, key) { return "../draft/#" + (key || "nba") + (q ? "?" + q : ""); }
  function boardAt(slot, year) { var y = year || 2027, x = ((H.prospectsBy || {})[y] || [])[Math.round(slot) - 1]; return x ? '<a href="' + boardHref("at=" + Math.round(slot), y === 2027 ? "nba" : "nba" + y) + '" title="No. ' + Math.round(slot) + " on the " + y + ' Big Board">' + esc(shortName(x.n)) + "</a>" : ""; }
  function kv(v, k) { return "<div><b>" + v + "</b><span>" + k + "</span></div>"; }
  function tablePanel(title, head, body, right, cls) {
    return '<div class="panel"><h3>' + esc(title) + " <small>" + (right || "") + '</small></h3><div class="scroll"><table class="t' + (cls ? " " + cls : "") + '"><thead><tr>' + head + "</tr></thead><tbody>" + (body || '<tr><td class="note">Nobody.</td></tr>') + "</tbody></table></div></div>";
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
    state.route = parts[0] || "tonight";
    state.arg = parts[1] || null;
    state.q = q;
    var y = +q.y;
    state.year = y >= 0 && y < Hub.YEARS ? y : 0;
  }
  // Scrolling tables: focusable and named, so a keyboard can scroll them (WCAG 2.1.1)
  function scrollA11y(root) {
    root.querySelectorAll(".scroll:not([tabindex])").forEach(function (el) {
      var h = el.closest(".panel, section, .lusec");
      var name = h && h.querySelector("h3, h2");
      el.setAttribute("tabindex", "0"); el.setAttribute("role", "region");
      el.setAttribute("aria-label", name ? name.childNodes[0].textContent.trim() || "Table" : "Table");
    });
  }
  new MutationObserver(function () { scrollA11y(view); }).observe(view, { childList: true, subtree: true });
  var subtabs = $("#subtabs");
  var GROUP = { tonight: "tonight", game: "tonight", standings: "standings", teams: "teams", team: "teams", style: "teams", contracts: "teams", ratings: "players", rank: "players", track: "players", lineups: "players", trade: "trades", value: "players", fa: "fa", draft: "draft", picks: "draft" };
  var SUBS = {
    players: [["ratings", "Ratings"], ["rank", "Rankings"], ["track", "Tracking"], ["value", "Contracts"], ["lineups", "Lineups"]],
    draft: [["draft", "Lottery odds", "", "Lottery"], ["picks", "Traded picks", "", "Picks"], ["", "Big Board", "../draft/#nba"], ["", "Mock draft", "../draft/#nba/mock", "Mock"], ["", "More", "../draft/#nba/challenge"]]
  };
  // the teams you follow (assets/follow.js), above the main pages; redrawn when you follow or unfollow
  function yoursSlot() {
    var el = document.getElementById("ds-yours-slot");
    if (!el) { el = document.createElement("div"); el.id = "ds-yours-slot"; view.parentNode.insertBefore(el, view); }
    var show = window.Follow && H && ["tonight","standings","teams"].indexOf(state.route) >= 0;
    el.innerHTML = show ? Follow.strip("nba", Object.keys(H.teams).map(function (c) { var t = team(c); return { id: c, href: href("team/" + c, {}), logo: logo(c, 28), name: t.short, sub: t.w != null ? t.w + "-" + t.l : "" }; })) : "";
  }
  window.addEventListener("ds-follow", function (e) { if (e.detail && e.detail.sport === "nba") yoursSlot(); });
  function render() {
    parse();
    // Six sections; grouped ones get a sub-tab row
    var group = GROUP[state.route] || "";
    document.querySelectorAll(".tabs a").forEach(function (a) {
      if (a.dataset.tab === group) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      // a section tab returns to the page last used in it
      var last = load("sub." + a.dataset.tab, null);
      if (last && SUBS[a.dataset.tab]) a.setAttribute("href", href(last, {}));
    });
    var subs = SUBS[group];
    subtabs.hidden = !subs;
    if (subs) {
      if (subs.some(function (x) { return x[0] === state.route; })) save("sub." + group, state.route);
      subtabs.innerHTML = subs.map(function (x) { var l = x[3] ? '<span class="fl">' + x[1] + '</span><span class="sl">' + x[3] + "</span>" : x[1]; return x[2] ? '<a href="' + x[2] + '">' + l + "</a>" : '<a href="' + href(x[0], {}) + '"' + (x[0] === state.route ? ' aria-current="page"' : "") + ">" + l + "</a>"; }).join("");
    }
    var withYears = state.route === "standings" || state.route === "team" || state.route === "contracts";
    yearbar.hidden = !withYears;
    if (withYears) drawYears();
    if ((state.route === "team" || state.route === "style") && state.arg) save("team", state.arg.toUpperCase());
    var fn = { tonight: tonightPage, game: gamePage, draft: draftPage, standings: standings, team: teamPage, teams: teamsPage, contracts: contractsPage, picks: picksPage, value: valuePage, trade: tradePage, fa: faPage, ratings: ratingsPage, rank: rankPage, track: trackPage, lineups: lineupsPage, style: stylePage, method: methodPage }[state.route] || standings;
    fn();
    yoursSlot();
  }
  // ---------- tonight: game cards and previews (assets/tonight.js, data/tonight.json) ----------
  var ESPN2CODE = null;
  // before the league model is built (Tonight draws from tonight.json alone): ESPN's abbreviations and logos
  var ESPN_LITE = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS", BKN: "BRK", CHA: "CHO", PHX: "PHO" };
  function tonightCfg() {
    if (!ESPN2CODE && H) { ESPN2CODE = {}; Object.keys(H.teams).forEach(function (c) { ESPN2CODE[String(H.teams[c].espn || c).toUpperCase()] = c; }); }
    var f1 = function (v) { return v == null ? "—" : v.toFixed(1); }, p1 = function (v) { return v == null ? "—" : v.toFixed(1) + "%"; };
    return {
      base: "tonight", preview: "game", word: "on offense", sides: ["offense", "defense"],
      href: href,
      team: function (ab, name) {
        if (!H) { var c0 = ESPN_LITE[ab] || ab; return { code: c0, short: String(name || ab).split(" ").pop(), name: name || ab, logo: '<img class="logo" src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/' + esc(String(ab).toLowerCase()) + '.png&w=48&h=48" alt="" width="24" height="24" loading="lazy" onerror="this.style.visibility=\'hidden\'">', link: href("team/" + c0, {}) }; }
        var c = ESPN2CODE[ab] || ab, t = team(c); return { code: c, short: t.short || c, name: t.name || name, logo: logo(c, 24), link: href("team/" + c, {}), color: t.color };
      },
      rows: [["Points a game", "avgPoints", "d:avgPoints", 1, f1], ["Field goal %", "fieldGoalPct", "d:fieldGoalPct", 1, p1], ["3-point %", "threePointFieldGoalPct", "d:threePointFieldGoalPct", 1, p1],
        ["Threes made", "avgThreePointFieldGoalsMade", "d:avgThreePointFieldGoalsMade", 1, f1], ["Free throw attempts", "avgFreeThrowsAttempted", "d:avgFreeThrowsAttempted", 1, f1],
        ["Offensive rebounds", "avgOffensiveRebounds", "d:avgOffensiveRebounds", 1, f1], ["Assists", "avgAssists", "d:avgAssists", 1, f1], ["Turnovers", "avgTurnovers", "d:avgTurnovers", -1, f1]],
      note: "Season averages from ESPN, ranked against all 30 teams: each team's offense next to what the other team's opponents have done against it. Red is good, blue is bad, and the bigger number wins the row."
    };
  }
  function tonightPage() {
    if (!window.Tonight || !Tonight.ready()) { view.innerHTML = '<p class="loading">Loading tonight\'s games…</p>'; if (window.Tonight) Tonight.load().then(function () { if (state.route === "tonight") render(); }); return; }
    view.innerHTML = Tonight.list(tonightCfg(), state.q || {});
  }
  function gamePage() {
    if (!window.Tonight || !Tonight.ready()) { view.innerHTML = '<p class="loading">Loading the preview…</p>'; if (window.Tonight) Tonight.load().then(function () { if (state.route === "game") render(); }); return; }
    view.innerHTML = Tonight.preview(tonightCfg(), state.arg);
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

  // ESPN's BPI beside the hub's projections (data/bpi.json, tools/nba_bpi.py)
  var BPI = null, bpiWait = null;
  function loadBpi() { if (!bpiWait) bpiWait = fetch("data/bpi.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) { BPI = j && j.teams ? j : { teams: {} }; return BPI; }); return bpiWait; }
  // ---------- standings ----------
  function standings() {
    var i = state.year, rows = H.standings(i), first = i === 0;
    if (!BPI) loadBpi().then(function () { if (state.route === "standings" && BPI && Object.keys(BPI.teams).length) render(); });
    var bp = first && BPI && Object.keys(BPI.teams).length ? BPI.teams : null;
    var html = '<h2 class="sec">' + sname(i) + (first ? " Projected Standings" : " Projection") + "</h2>" +
      '<p class="lede">' + (first
        ? "Real records, then the rest of the season simulated " + H.cfg.sims.toLocaleString() + " times from today's rosters."
        : 'Built from contracts, so it gets rougher every year out. ' + howLink() + ' has the rules.') + "</p>";
    html += '<div class="leagues stack">';
    ["E", "W"].forEach(function (conf) {
      var d = rows.filter(function (r) { return r.conf === conf; });
      html += '<div class="div"><h3>' + (conf === "E" ? "Eastern" : "Western") + ' Conference</h3><div class="scroll"><table class="t tstand' + (first ? " now" : "") + '"><thead><tr><th>Team</th>' + (first ? "<th>Now</th>" : "") + "<th>Proj</th><th>Net</th>" + (bp ? '<th title="ESPN Basketball Power Index: points per game better than an average team, and ESPN\'s projected record">ESPN BPI</th>' : "") + "<th>Playoffs</th><th>Play-in</th><th>Conf</th><th>Title</th>" + (first ? "<th>Avg pick</th>" : "") + "</tr></thead><tbody>";
      d.forEach(function (r, k) {
        var w = Math.round(r.projW);
        html += '<tr class="go' + (k === 6 || k === 10 ? " cut" : "") + '" data-team="' + r.code + '"><td class="tm"><span class="srk">' + (k + 1) + ".</span>" + logo(r.code) + '<span class="nm"><span class="nmf">' + esc(r.name) + '</span><span class="nms">' + esc(team(r.code).short) + "</span></span></td>" +
          (first ? "<td>" + r.w + "-" + r.l + "</td>" : "") + "<td><b>" + w + "-" + (82 - w) + '</b></td><td class="' + (r.net >= 0 ? "pos" : "neg") + '">' + rt(r.net) + "</td>" +
          (bp ? (bp[r.code] ? '<td title="BPI rank ' + bp[r.code].rank + "; ESPN title odds " + (bp[r.code].title != null ? bp[r.code].title.toFixed(1) + "%" : "—") + '">' + (bp[r.code].bpi >= 0 ? "+" : "") + bp[r.code].bpi.toFixed(1) + ' <small class="bpw">' + Math.round(bp[r.code].projW) + "-" + Math.round(bp[r.code].projL) + "</small></td>" : "<td>—</td>") : "") +
          '<td><span class="bar">' + pct(r.playoffs) + '<i><b style="width:' + (r.playoffs * 100).toFixed(0) + '%"></b></i></span></td>' +
          "<td>" + pct(r.playin) + "</td><td>" + pct(r.confW) + "</td><td><b>" + pct(r.title) + "</b></td>" +
          (first ? '<td title="Chance of a top-4 pick: ' + pct(r.top4) + '">' + (r.avgPick <= 16 ? f1(r.avgPick) : "—") + "</td>" : "") + "</tr>";
      });
      html += "</tbody></table></div></div>";
    });
    html += "</div>";
    if (first) html += '<p class="note">Lottery odds for every team are under <a href="' + href("draft", {}) + '">Draft</a>.</p>';
    html += '<p class="note">Seeds 1-6 make the playoffs; 7-10 go to the play-in (lines mark the cuts). Net is projected points per 100 possessions better than an average team.' + (bp ? " ESPN BPI is ESPN\'s own Basketball Power Index (points per game better than average) and its projected record, for comparison" + (BPI.updated ? " (updated " + esc(String(BPI.updated).slice(0, 10)) + ")" : "") + "." : "") + "</p>";
    view.innerHTML = html;
  }
  function draftPage() {
    var rows = H.standings(0);
    view.innerHTML = '<h2 class="sec">2027 Draft</h2><p class="lede">Lottery odds from the season simulations, and who\'s ranked at each pick on the <a href="' + boardHref() + '">Big Board</a>.</p>' +
      lotteryPanel(rows) + lotteryGrid(rows) + lotteryRules();
  }
  function lotteryPanel(rows) {
    var lot = rows.slice().sort(function (a, b) { return a.avgPick - b.avgPick; }).slice(0, 16);
    var bans = H.lottoBans || {};
    var short = function (t) { t = String(t || ""); return t.length > 34 ? t.slice(0, 32).replace(/[\s,;:]+\S*$/, "") + "…" : t; };
    // one compact row per team: the numbers in columns, who gets the pick and who's ranked there in a line under the name
    return tablePanel("The 2027 lottery", "<th>Team</th><th>Proj</th><th>No. 1</th><th>Top 4</th><th>Avg</th>",
      lot.map(function (r, k) {
        var pk = H.W.picks.find(function (x) { return x.y === 2027 && x.r === 1 && x.from === r.code; });
        var bits = [];
        if ((bans.no1 || []).indexOf(r.code) >= 0) bits.push('<span class="pill warn" title="Won No. 1 last year, so it can\'t win it again">No No. 1</span>');
        if ((bans.noTop5 || []).indexOf(r.code) >= 0) bits.push('<span class="pill warn" title="Top-five picks two years running, so it can\'t land top five again">No top 5</span>');
        if (pk && pk.owner !== r.code && pk.owner !== "OUT") bits.push('<span title="' + esc(pk.note || "") + '">to ' + esc(team(pk.owner).short) + (pk.prot ? " (" + esc(short(pk.note || "protected")) + ")" : "") + "</span>");
        else if (pk && pk.locked && pk.note) bits.push('<span title="' + esc(pk.note) + '">' + esc(short(pk.note)) + "</span>");
        var bd = boardAt(k + 1); if (bd) bits.push('<span class="nw">Board: ' + bd + "</span>");
        var w = Math.round(r.projW);
        return '<tr class="go" data-team="' + r.code + '"><td class="tm lotm">' + logo(r.code) + '<span class="nm"><span class="nmf">' + esc(r.name) + '</span><span class="nms">' + esc(team(r.code).short) + '</span><small class="lsub">' + bits.join(" · ") + "</small></span></td><td>" + w + "-" + (82 - w) + "</td><td>" + pct(r.no1, 1) + "</td><td>" + pct(r.top4) + "</td><td><b>" + f1(r.avgPick) + "</b></td></tr>";
      }).join(""), "The worst three records get two balls, not three, and can't fall below 12th");
  }
  // Every lottery team's odds at each pick, from the season simulations (which play out the season, the play-in and the
  // 3-2-1 draw); shaded by likelihood
  function oddsCell(p) {
    if (!(p > 0.0005)) return '<td class="lo0"></td>';
    var a = Math.min(1, Math.sqrt(p / 0.35)), al = 0.08 + 0.82 * a, dark = al >= 0.6;
    // no shade sits in the middle band where neither dark nor white text has enough contrast
    if (dark) al = Math.max(al, 0.76);
    return '<td class="lo" style="background:rgba(29,66,138,' + al.toFixed(2) + ");color:" + (dark ? "#fff" : "inherit") + '" title="' + (p * 100).toFixed(1) + '%">' + (p < 0.01 ? "&lt;1" : Math.round(p * 100)) + "</td>";
  }
  function lotteryGrid(rows) {
    var lot = rows.slice().sort(function (a, b) { return a.avgPick - b.avgPick; }).slice(0, 18);
    var head = "<th>Team</th>" + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map(function (k) { return "<th>" + k + "</th>"; }).join("") + "<th>17+</th>";
    return '<div class="panel lotgrid"><h3>Odds at every pick <small>percent, from ' + H.cfg.sims.toLocaleString() + " simulated seasons and lotteries</small></h3><div class=\"scroll\"><table class=\"t lgt\"><thead><tr>" + head + "</tr></thead><tbody>" +
      lot.map(function (r) {
        var sl = r.slots || [], rest = 0; for (var k = 17; k < sl.length; k++) rest += sl[k] || 0;
        var cells = ""; for (k = 1; k <= 16; k++) cells += oddsCell(sl[k] || 0);
        return '<tr class="go" data-team="' + r.code + '"><td class="tm">' + logo(r.code) + '<span class="nm">' + esc(team(r.code).short) + "</span></td>" + cells + oddsCell(rest) + "</tr>";
      }).join("") + '</tbody></table></div><p class="note">Under the 3-2-1 lottery the worst records aren\'t the likeliest No. 1: the three worst get two balls each, the next seven three each, so a team finishing fourth to tenth-worst has the best shot. The worst three can\'t fall below 12th, and every one of the 16 lottery picks is drawn.</p></div>';
  }
  function lotteryRules() {
    var T = H.lottoTable && H.lottoTable();
    if (!T) return "";
    var balls = function (k) { return k <= 3 ? 2 : k <= 10 ? 3 : k <= 14 ? 2 : 1; };
    var who = function (k) { return k <= 10 ? (k === 1 ? "Worst record" : k + (k === 2 ? "nd" : k === 3 ? "rd" : "th") + "-worst") : k <= 14 ? "9-10 seed (play-in)" : "7-8 play-in loser"; };
    var rowsH = []; for (var k = 1; k <= 16; k++) {
      var t = T[k], ev = 0, top4 = 0, worst = 0;
      for (var sl = 1; sl <= 30; sl++) { ev += t[sl] * sl; if (sl <= 4) top4 += t[sl]; if (t[sl] > 0.0005) worst = sl; }
      rowsH.push("<tr><td style=\"text-align:left\">" + who(k) + "</td><td>" + balls(k) + "</td><td>" + pct(t[1], 1) + "</td><td>" + pct(top4) + "</td><td>" + f1(ev) + "</td><td>" + worst + "</td></tr>");
    }
    return tablePanel("How 3-2-1 works, by finish", "<th>Finish</th><th>Balls</th><th>No. 1</th><th>Top 4</th><th>Avg pick</th><th>Lowest</th>", rowsH.join(""), "The odds for each lottery spot on its own, before the season decides who lands where");
  }
  view.addEventListener("click", function (e) {
    var tr = e.target.closest("[data-team]");
    if (tr && !e.target.closest("[data-p]") && !e.target.closest("button")) {
      location.hash = href("team/" + tr.dataset.team, { y: yq(state.year) });
      return;
    }
    // a button inside a player row (follow, add) is its own action; a button that is the player (the court's five) opens his card
    var p = e.target.closest("[data-p]"), btn = e.target.closest("button");
    if (p && !e.target.closest(".results") && (!btn || btn === p)) openCard(p.dataset.p);
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
        return "<tr" + (k === 5 || k === 10 ? ' class="cut"' : "") + "><td>" + pname(p, 24) + "</td><td>" + esc(posOf(p)) + "</td><td>" + (p.fill || p.age == null ? "—" : p.rook ? p.age + i - p.arrive : p.age + i) + "</td><td>" + rchip(x.r) + "</td><td>" + (mins ? f0(mins) : "—") + "</td><td>" + line + "</td><td>" + contractCell(x, i) + "</td></tr>";
      }).join(""), (i === 0 ? "This season's numbers" : "") + (inj.length && i === 0 ? " · " + inj.length + " on the injury report" : ""));
    if (i === 0) html += teamLineups(code) + teamTracking(code);
    html += '<p class="note">Cap sheet, exceptions and draft picks are on the <a href="' + href("contracts/" + code, { y: yq(i) }) + '">Contracts tab</a>.</p>';
    view.innerHTML = html;
  }
  // the shared team header (assets/pcard.js): record and outlook up top, Rotation / Contracts / Style as tabs
  function teamHead(code, i, route) {
    var t = team(code), all = H.standings(i), st = all.filter(function (r) { return r.code === code; })[0], w = Math.round(st.projW);
    var conf = all.filter(function (r) { return r.conf === t.conf; }), seed = conf.findIndex(function (r) { return r.code === code; }) + 1;
    var pay = H.payroll(code, i), status = CBA.status(pay, i);
    return window.PCard.teamHead({ logo: logo(code, 44), name: t.name, follow: { sport: "nba", id: code }, color: t.color,
      meta: [(t.conf === "E" ? "Eastern" : "Western") + " Conference", sname(i) + (i === 0 ? ", " + t.w + "-" + t.l + " now" : "")],
      chips: [[CBA.STATUS_NAME[status] + ", " + money(pay, 0) + " payroll", status === "a2" || status === "a1" ? "inj" : ""], st.net != null ? [rt(st.net) + " net rating", st.net >= 0 ? "tag" : ""] : null],
      head: [{ v: w + "-" + (82 - w), l: "Projected" }, { v: ordinal(seed), l: (t.conf === "E" ? "East" : "West") + " seed" }, { v: pct(st.playoffs), l: "Playoffs" }, { v: pct(st.title), l: "Title" }],
      tabs: [{ label: "Rotation", href: href("team/" + code, { y: yq(i) }), on: route === "team" }, { label: "Contracts", href: href("contracts/" + code, { y: yq(i) }), on: route === "contracts" }, { label: "Style", href: href("style/" + code), on: route === "style" }] });
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
        face(x.p, 52) + '<span class="cn"><span class="cnf">' + esc(x.p.n) + '</span><span class="cns">' + esc(shortName(x.p.n)) + '</span></span><span class="cr T-' + tier(x.r) + '">' + lbl[k] + " · " + rt(x.r) + "</span>" + (x.starts && x.starts[1] ? '<span class="cg">' + x.starts[0] + " of " + x.starts[1] + '<span class="cgw"> starts</span></span>' : "") + (open ? "</button>" : "</div>") + "</div>";
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
      // No minutes total per position: each player sits under one listed position with all of his minutes, so a row's
      // sum isn't minutes played at that spot (it ran past 48 for every team)
      var list = cols[s];
      var cell = function (d) {
        var m = lu.mins[d.x.p.id] || 0, p = d.x.p;
        return '<span class="dp' + (d.start ? " st" : "") + (m < 1 ? " dnp" : "") + ' T-' + tier(d.x.r) + 'b"' + (p.fill || p.rook ? "" : ' data-p="' + esc(p.id) + '"') + ">" + face(p, d.start ? 30 : 24) +
          '<span class="dn"><b>' + esc(d.start ? p.n : shortName(p.n)) + "</b><small>" + (m >= 1 ? f0(m) + " min" : "DNP") + " · " + rt(d.x.r) + "</small></span></span>";
      };
      var st = list.filter(function (d) { return d.start; }), bn = list.filter(function (d) { return !d.start; });
      html += '<div class="drow2"><span class="dpos"><b>' + s + "</b></span>" +
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
      '<p class="note">Re-signing keeps a player at his market price for as long as the market would go. By default a team keeps anyone worth at least 85% of that price who\'s 33 or younger, since his Bird rights let it go over the cap to do it; restricted free agents are matched at a lower bar. Tap to change a call.</p>';
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
    html += '<div class="panel"><h3>What ' + esc(team(code).short) + " can do now <small>" + sname(0) + '</small></h3><p class="flags">' + flags.join("<br>") + '</p><div class="scroll"><table class="t ttools"><thead><tr><th>Tool</th><th>Amount</th><th>Usable</th><th class="tnc">Notes</th></tr></thead><tbody>' +
      T.tools.map(function (x) { return '<tr><td class="tname">' + esc(x.name) + '<small class="tnote">' + esc(x.why) + "</small></td><td>" + (x.amt ? money(x.amt) : "—") + "</td><td>" + (x.ok ? '<span class="pill up">Yes</span>' : '<span class="pill">No</span>') + '</td><td class="note tnc" style="text-align:left;white-space:normal">' + esc(x.why) + "</td></tr>"; }).join("") +
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
    var q = state.q, yr = q.y2 || "", tm = q.t || "", dir = tm ? (q.dir || "") : "";
    // with a team picked: incoming (other teams' picks it owns) or outgoing (its own picks someone else owns)
    var all = H.allPicks().filter(function (pk) {
      if (yr && String(pk.y) !== yr) return false;
      if (!tm) return true;
      if (dir === "in") return pk.owner === tm && pk.from !== tm;
      if (dir === "out") return pk.from === tm && pk.owner !== tm;
      return pk.from === tm || pk.owner === tm;
    });
    var years = []; H.allPicks().forEach(function (pk) { if (years.indexOf(pk.y) < 0) years.push(pk.y); });
    var html = '<h2 class="sec">Traded picks</h2><p class="lede">Every traded pick, its protection and where it projects to land. Projected 2027 and 2028 firsts link to the <a href="' + boardHref() + '">Big Board</a>.</p>';
    html += controls('<label>Year<select data-q="y2"><option value="">All</option>' + years.map(function (y) { return '<option value="' + y + '"' + (String(y) === yr ? " selected" : "") + ">" + y + "</option>"; }).join("") + "</select></label>" + teamSelect(tm) +
      (tm ? '<label>Direction<select data-q="dir"><option value="">Both</option><option value="in"' + (dir === "in" ? " selected" : "") + '>Incoming</option><option value="out"' + (dir === "out" ? " selected" : "") + ">Outgoing</option></select></label>" : ""));
    var protText = function (pk) {
      var bits = [];
      if (pk.prot) bits.push(pk.r === 2 ? "Protected " + (pk.prot.lo + (pk.prot.hi <= 30 ? 30 : 0)) + "-" + (pk.prot.hi + (pk.prot.hi <= 30 ? 30 : 0)) : pk.prot.lo === 1 ? "Top-" + pk.prot.hi + " protected" : "Protected " + pk.prot.lo + "-" + pk.prot.hi);
      if (pk.group) bits.push("Better-of group");
      return bits.length ? bits.join(" · ") : "Unprotected";
    };
    html += tablePanel(all.length + " picks", "<th>Pick</th><th>From</th><th>Owner</th><th>Protection</th><th>Proj. slot</th><th>Conveys</th><th>Value</th><th>Notes</th>", all.map(function (pk) {
      var info = H.pickInfo(pk);
      return "<tr><td>" + pk.y + " " + (pk.r === 1 ? "1st" : "2nd") + "</td><td>" + tcell(pk.from) + "</td><td>" + (pk.owner === "OUT" ? "Forfeited" : tcell(pk.owner)) + "</td><td>" +
        (pk.prot || pk.group ? "<b>" + esc(protText(pk)) + "</b>" : '<span class="note">Unprotected</span>') + "</td><td>" + ((pk.y === 2027 || pk.y === 2028) && pk.r === 1 && info.avg ? '<a href="' + boardHref("at=" + Math.round(info.avg), pk.y === 2027 ? "nba" : "nba2028") + '" title="Who\'s ranked there on the Big Board">' + f1(info.avg) + "</a>" : f1(info.avg)) + "</td><td>" + (pk.prot ? pct(info.conveys) : "") + "</td><td>" + money(H.pickValue(pk, H.cfg.mode)) + '</td><td class="note" style="text-align:left;white-space:normal">' + esc(pk.note || "") + "</td></tr>";
    }).join(""), "Conveys: share of simulations where the protection doesn't hold", "tpicks");
    var sw = (H.W.swaps || []).filter(function (s) { return (!yr || String(s.y) === yr) && (!tm || s.from === tm || s.holder === tm); });
    if (sw.length) html += tablePanel("Swap rights", "<th>Pick</th><th>Holder</th><th>Swaps with</th><th>Value</th><th>Notes</th>", sw.map(function (s) {
      return "<tr><td>" + s.y + " " + (s.r === 1 ? "1st" : "2nd") + "</td><td>" + tcell(s.holder) + "</td><td>" + tcell(s.from) + "</td><td>" + money(H.swapValue(s, H.cfg.mode)) + '</td><td class="note" style="text-align:left;white-space:normal">' + esc(s.note || "Takes the better of the two picks") + "</td></tr>";
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
        var nm = p.year + " No. " + p.slot + " pick" + (p.from !== p.t ? " (via " + p.from + ")" : "") + (p.prospect ? ' <span class="note">proj. <a href="' + boardHref("p=" + encodeURIComponent(p.prospect), p.board) + '">' + esc(p.n) + "</a></span>" : "");
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
    // a more/less favorable group is one pick for this team, whichever pick it turns out to be: one row, with this
    // team's share of the group's value (groups where it only gets the leftover pick count too)
    var groups = H.W.pickGroups.filter(function (g) {
      return g.picks.some(function (id) { var pk = H.pickById(id); return pk.owner === code; }) || (g.to || []).indexOf(code) >= 0 || Object.keys(g.alt || {}).some(function (id) { return g.alt[id] === code; });
    });
    var inGroup = {}; groups.forEach(function (g) { g.picks.forEach(function (id) { inGroup[id] = g; }); });
    var grow = groups.map(function (g) {
      var pks = g.picks.map(function (id) { return H.pickById(id); }), y = pks[0].y, r = pks[0].r;
      var best = (g.to || [])[0] === code, froms = pks.map(function (pk) { return team(pk.from).short; });
      var label = y + " " + (r === 1 ? "1st" : "2nd") + (pks.length < 2 ? "" : best ? ", best of " + froms.join(", ") : pks.length === 2 ? ", worse of " + froms.join(", ") : ", from " + froms.join(", "));
      var avg = pks.reduce(function (a, pk) { return a + H.pickInfo(pk).avg; }, 0) / pks.length;
      return { y: y, r: r, html: "<tr><td>" + pks.map(function (pk) { return logo(pk.from, 16); }).join("") + " " + esc(label) + "</td><td></td><td>" + f1(avg) + "</td><td></td><td>" + money((H.groupValues(g, "prod")[code]) || 0) + "</td><td>" + money((H.groupValues(g, "market")[code]) || 0) + '</td><td class="note" style="text-align:left;white-space:normal">' + esc(g.note || "") + "</td></tr>" };
    });
    var head = "<th>Pick</th><th>To</th><th>Proj. slot</th><th>Conveys</th><th>Value</th><th>Market</th><th>Notes</th>";
    var sw = swaps.map(function (s) { return { y: s.y, r: s.r, html: "<tr><td>" + logo(s.from, 16) + " " + s.y + " " + (s.r === 1 ? "1st" : "2nd") + " swap with " + esc(team(s.from).short) + "</td><td></td><td></td><td></td><td>" + money(H.swapValue(s, "prod")) + "</td><td>" + money(H.swapValue(s, "market")) + '</td><td class="note" style="text-align:left;white-space:normal">' + esc(s.note || "Can swap its own pick for theirs if theirs lands higher") + "</td></tr>" }; });
    var mine = own.filter(function (pk) { return !inGroup[pk.id]; }).map(function (pk) { return { y: pk.y, r: pk.r, html: row(pk, true) }; }).concat(grow, sw)
      .sort(function (a, b) { return a.y - b.y || a.r - b.r; }).map(function (x) { return x.html; }).join("");
    return '<div>' + tablePanel("Draft picks owned", head, mine, "Value: what that slot has produced. Market: what teams pay for it") +
      tablePanel("Own picks owed away", head, owed.filter(function (pk) { return !inGroup[pk.id]; }).map(function (pk) { return row(pk, false); }).join(""), "") + '<p class="note"><a href="#/picks">Every traded pick in the league, with protections</a></p></div>';
  }

  // ---------- player card ----------
  // his team's next game from the Tonight data (loads it the first time; the card fills it in when it lands)
  function nextGameFor(code, id0) {
    if (!window.Tonight) return null;
    if (!Tonight.ready()) { Tonight.load().then(function () { if (card.open && card.dataset.pid === id0 && Tonight.ready()) openCard(id0); }); return null; }
    var cfg = tonightCfg();
    return Tonight.next(cfg, function (ab) { return ESPN2CODE[ab] || ab; }, code);
  }
  var cardTab = "ov";
  function openCard(id) {
    var p = H.W.P[id];
    if (!p) return;
    var s = H.surplus(p), sm = H.surplus(p, H.cfg.mode === "market" ? "prod" : "market"), t = team(p.t), r = H.adv ? p.adv : null;
    var P = window.PCard, panes = {};
    var tabs = [["ov", "Overview"]].concat(hasBox(p) ? [["st", "Stats"]] : [], r ? [["sk", "Skills"]] : [], r && r.zones && r.zones.rim ? [["sh", "Shooting"]] : [], p.rook || p.fill ? [] : [["tr", "Tracking"]], [["ct", "Contract"]]);
    if (!tabs.some(function (x) { return x[0] === cardTab; })) cardTab = "ov";
    // overview
    var ov = "";
    if (r) {
      var cats = Object.keys(H.adv.cats).filter(function (c) { return CAT_IMP.indexOf(c) < 0 && r.r[c] != null; }).sort(function (a, b) { return r.r[b] - r.r[a]; });
      if (cats.length > 6) cats = cats.slice(0, 4).concat(cats.slice(-2));
      ov += P.sec("Best and worst at", "percentile, then rank among " + GROUP1[r.g]) + P.bars(cats.map(function (c) { return { label: H.adv.cats[c], sub: r.rp[c] == null ? "" : ord(r.rp[c]) + " of " + GROUP1[r.g], pct: r.r[c] }; }));
    }
    var ng = nextGameFor(p.t, id);
    if (ng) ov += P.sec(ng.today ? "Tonight" : "Next game") + P.line(ng);
    if (window.GameLog) ov += GameLog.slot({ league: "nba", espn: p.espn, name: p.n });
    var oof = null;
    if (p.oo && p.oo[2] != null && p.oo[4] != null) { var non = p.oo[2] - p.oo[3], noff = p.oo[4] - p.oo[5]; oof = [(non - noff > 0 ? "+" : "") + f1(non - noff), "On/off per 100 (" + p.oo[1] + " poss)"]; }
    else if (r && r.s.onoff != null) oof = [(r.s.onoff > 0 ? "+" : "") + f1(r.s.onoff), "On/off per 100"];
    var vo = !p.rook && H.valRanks()[p.id];
    ov += P.sec("Ratings") + P.facts([[rt(H.rating(p, 0)), "Impact now"], [rt(H.rating(p, 2)), "In " + sname(2)], [pct(p.h || 0.85), "Games played (health)"], p.darko != null ? [rt(p.darko), "DARKO today"] : null, p.bpm != null ? [rt(p.bpm), "BPM this season"] : null, oof,
      vo && (vo.gs != null || vo.cR) ? [rt(vo.val), '<a href="' + href("rank", {}) + '">Value rating</a> (No. ' + vo.vR + ")", true] : null, p.ringer ? ["No. " + p.ringer, "Ringer Top 100"] : null, p.two ? ["Two-way", "Contract"] : [signed(H.tradeValue(p)), "Trade value"]]);
    if (contractYears(p, 0).length) ov += P.sec("Contract") + contractStrip(p, 0);
    panes.ov = ov;
    // stats
    if (hasBox(p)) panes.st = statsPane(p);
    // skills
    if (r) {
      var st = r.s, pc = function (x) { return x == null ? "—" : (x * 100).toFixed(1) + "%"; };
      panes.sk = skillBars(r) +
        '<p class="note">Percentiles among players with real minutes (99 is best), then his rank among ' + GROUP1[r.g] + "." + (r.mp ? " Last season counts at half weight while this one is young." : "") + "</p>" +
        '<div class="kv">' + kv(f1(st.pts100), "Points per 100") + kv(pc(st.ts), "True shooting") + kv(f1(st.usg) + "%", "Usage") + kv(f1(st.unast100), "Unassisted pts / 100") + kv(f1(st.ast) + "%", "Assist rate") + kv(f1(st.tov) + "%", "Turnover rate") +
        kv(f1(st.orb) + " / " + f1(st.drb), "Off / def reb %") + kv(f1(st.stl) + " / " + f1(st.blk), "Steal / block %") + (st.ortg ? kv(f0(st.ortg) + " / " + f0(st.drtg), "Off / def rating") : "") + "</div>";
    }
    // shooting
    if (r && r.zones && r.zones.rim) {
      var st2 = r.s;
      panes.sh = shotChart(r.zones) + zoneTable(r.zones) +
        '<div class="kv">' + kv(pct(st2.p3, 1), "3P% (regressed)") + kv(f1(st2.fg3a100), "3PA per 100") + kv(pct(st2.pft, 1), "FT% (regressed)") + kv(pct(st2.prim, 1), "Rim FG% (regressed)") + kv(f1(st2.rim100), "Rim attempts / 100") + kv(pct(st2.ast_share), "Of his buckets assisted") + "</div>" +
        '<p class="note">Regressed percentages are pulled toward the league average by how many shots back them up.</p>';
    }
    // tracking (loads the first time a card opens)
    if (!p.rook && !p.fill) {
      panes.tr = trackPane(p);
      if (!TRK) loadTrack().then(function () { var pn = card.querySelector('[data-pane="tr"]'); if (pn) pn.innerHTML = trackPane(p); });
    }
    // contract
    var ct = "";
    if (p.two) ct += twoWayNote(p);
    else if (contractYears(p, 0).length) ct += contractStrip(p, 0);
    var dsc = function (x) { return Math.pow(1 + H.cfg.disc, -x.j); };
    if (!p.two) {
    var vt = s.rows.reduce(function (a, x) { return a + x.value * dsc(x); }, 0), cf = s.rows.reduce(function (a, x) { return a + x.sal * dsc(x); }, 0), net = vt - cf;
    // Surplus is the plain difference, value minus every dollar of salary. Trade value is what the market makes of it:
    // real deals take on salary at about the salary weight (see the method page), so an overpaid player can still
    // bring something back
    ct += '<div class="vcs"><div><span>Value</span><b>' + money(vt) + "</b><small>" + (H.cfg.mode === "market" ? "what teams would pay him" : "what he should produce") + '</small></div><i>−</i><div><span>Salary</span><b>' + money(cf) +
      "</b><small>what he'll be paid</small></div><i>=</i><div class=\"" + (net >= 0 ? "up" : "dn") + '"><span>Surplus</span><b>' + signed(net) + "</b><small>" + (net >= 0 ? "underpaid" : "overpaid") + ", " + s.rows.length + " season" + (s.rows.length === 1 ? "" : "s") + (H.cfg.disc > 0 ? ", discounted" : "") + "</small></div></div>";
    var spv = H.surplus(p, "prod").pv, mpv = H.surplus(p, "market").pv, tv = H.tradeValue(p), salW = H.cfg.salW ?? 1;
    // 1. the number and where it comes from; 2. why it differs from his surplus; 3. his own story, apart
    ct += '<p class="tldr"><b>Trade value: ' + signed(tv) + ".</b> What his contract is worth to a team trading for him: the average of what he should produce (" + signed(spv) + ") and what teams pay players like him (" + signed(mpv) + ").</p>";
    if (salW < 1) ct += '<p class="note">Teams trading for a player count only about ' + Math.round(salW * 100) + "% of his salary this season and next (more for later years), so " +
      (net < 0 && tv > 0 ? "he's overpaid, but he still brings something back." : net < 0 ? "his deal hurts less than its face value, but it still costs a team." : "he's worth even more in a trade than his surplus says.") + "</p>";
    var story = [p.note ? esc(p.note) : "", p.form && Math.abs(p.form) >= 0.05 ? "This season's play has moved his rating " + (p.form > 0 ? "up " : "down ") + f1(Math.abs(p.form)) + "." : ""].filter(Boolean).join(" ");
    if (story) ct += '<p class="note">' + story + "</p>";
    var bv = s.prior ? 0 : H.birdValue(p);
    if (bv >= 1e6) ct += '<p class="note"><b>Bird rights:</b> The ' + esc(team(p.t).short) + " can go over the cap to re-sign him when his deal ends after " + sname(H.lastYear(p)) + ". Worth about " + money(bv) + " to them, more if they're over the cap and couldn't replace him in free agency. Trade grades and the deal finder include it.</p>";
    if (s.prior) ct += '<p class="note">Still on his rookie deal, so ' + Math.round((1 - s.prior.w) * 100) + "% of his trade value comes from what No. " + s.prior.slot + " picks are worth (" + signed(s.prior.value) + " over the rest of a draftee's first eight seasons) and " + Math.round(s.prior.w * 100) + "% from his own projection (" + signed(s.prior.model) + "). His own play takes over as the minutes pile up.</p>";
    ct += '<div class="scroll"><table class="t"><thead><tr><th>Season</th><th>Age</th><th>Impact</th><th>Value</th><th>Salary</th><th title="Value minus salary">Surplus</th><th title="Value minus salary at the trade-market weight">Trade value</th></tr></thead><tbody>';
    s.rows.forEach(function (x) {
      var sp = x.value - x.sal;
      ct += "<tr><td>" + x.season + (x.opt ? ' <span class="pill">' + esc(x.opt) + "</span>" : "") + (x.part < 1 ? ' <span class="note">(rest of season)</span>' : "") + "</td><td>" + (p.age + x.j) + "</td><td>" + rchip(x.r) + "</td><td>" + money(x.value) + "</td><td>" + money(x.sal) + '</td><td class="' + (sp >= 0 ? "pos" : "neg") + '">' + signed(sp) + '</td><td class="' + (x.surplus >= 0 ? "pos" : "neg") + '">' + signed(x.surplus) + "</td></tr>";
    });
    ct += '<tr class="tot"><td colspan="5">Total, ' + (H.cfg.mode === "market" ? "what teams pay players like him" : "what he should produce") + ", discounted " + pct(H.cfg.disc) + " a year" + (s.prior ? ", with the draft-slot blend" : "") + '</td><td class="' + (net >= 0 ? "pos" : "neg") + '"><b>' + signed(net) + '</b></td><td class="' + (s.pv >= 0 ? "pos" : "neg") + '"><b>' + signed(s.pv) + "</b></td></tr></tbody></table></div>";
    if (Math.abs(s.pv - tv) >= 0.05) ct += '<p class="note">The table shows one of the two reads; the trade value at the top averages both.</p>';
    }
    var ee = CBA.extEligible(p, 0);
    if (ee.ok) { var el = CBA.extLimit(p, 0); ct += '<p class="note">Extension eligible now (' + esc(ee.kind) + "): up to " + money(el.first) + " in " + sname(el.start) + (el.maxYears ? ", " + el.maxYears + " years" : "") + ".</p>"; }
    var e = H.lastYear(p);
    if (!p.two && e >= 0 && e < Hub.YEARS - 1) ct += '<p class="note">Becomes a' + (H.faKind(p) === "RFA" ? " restricted" : "n unrestricted") + " free agent after " + sname(e) + (p.age != null ? ", at " + (p.age + e + 1) : "") + ". Market estimate then: " + money(Mo.market(p, e + 1, H.W)) + " a year.</p>";
    panes.ct = ct;
    var foot = "";
    if (!p.rook && !p.fill) {
      var mine = H.adj[p.id] || 0, steps = [-2, -1.5, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.5, 2];
      foot += '<p class="myadj"><label>Your read <select data-adj="' + esc(p.id) + '">' + steps.map(function (v) { return '<option value="' + v + '"' + (v === mine ? " selected" : "") + ">" + (v === 0 ? "Model\'s rating" : (v > 0 ? "+" : "") + v + " per 100") + "</option>"; }).join("") + '</select></label> <span class="note">Moves his value rating, contract value and trade value for you only. Win projections stay on the model.</span></p>';
    }
    foot = '<div class="pc-acts"><a href="' + href("team/" + p.t) + '">' + esc(t.short || t.name) + " page</a>" + (p.prospect ? '<a href="' + boardHref("p=" + encodeURIComponent(p.prospect), p.board) + '">On the Big Board</a>' : "") + '<button type="button" class="pri" data-add="a" data-id="' + esc(p.id) + '">Add to trade</button></div>' + foot;
    // chips: injury, archetype, contract type
    var j = H.injuryTag && H.injuryTag(p), chips = [];
    if (j) { var jc = j.code || (j.dtd ? "Q" : "O"); chips.push([(j.season ? "Out for the season" : INJ_WORD[jc] + (jc === "O" && j.back && !j.guess && j.back > H.asOf ? ", back around " + fmtShort(j.back) : "")) + (j.note && /\(([^)]{2,24})\)/.test(j.note) ? " (" + j.note.match(/\(([^)]{2,24})\)/)[1] + ")" : ""), jc === "O" || j.season ? "out" : "inj"]); }
    if (r && r.arch) chips.push([r.arch, "tag"]);
    if (p.two) chips.push(["Two-way contract", ""]);
    var big = r ? r.g === "B" : /C/.test(posOf(p)), vo2 = !p.rook && H.valRanks()[p.id];
    var head = [{ v: rt(H.rating(p, 0)), l: "Impact per 100", tone: H.rating(p, 0) >= 0 ? "up" : "dn" }];
    if (p.line) head.push({ v: f1(p.line.pts), l: "Points" }, big ? { v: f1(p.line.reb), l: "Rebounds" } : { v: f1(p.line.ast), l: "Assists" });
    if (vo2 && (vo2.gs != null || vo2.cR)) head.push({ v: "No. " + vo2.vR, l: "Value rating" });
    else if (!p.two && contractYears(p, 0).length) head.push({ v: money(H.salary(p, 0)), l: "Salary" });
    var age = r && r.age != null ? Math.floor(r.age) : p.age;
    card.dataset.pid = id;
    cardBody.innerHTML = P.html({ face: face(p, 60), name: p.n, color: t.color, team: '<a href="' + href("team/" + p.t) + '">' + logo(p.t, 18) + " " + esc(t.short || t.name) + "</a>",
      meta: [posOf(p), age != null ? "Age " + age : "", p.yos != null && !p.two ? (p.yos === 0 ? "Rookie" : ord(p.yos + 1) + " season") : ""], chips: chips, head: head,
      tabs: tabs.map(function (x) { return { id: x[0], label: x[1], html: panes[x[0]] || "" }; }), tab: cardTab, foot: foot,
      follow: { sport: "nba-p", id: p.id, name: p.n, info: { t: t.short || t.name, espn: p.espn || "", href: "/nba/?card=" + encodeURIComponent(p.id) } } });
    if (!card.open) card.showModal();
  }
  // ---------- the card's Stats tab: box-score lines from hardcap/stats.json (per game), this season and last, then by week
  // cols: gp min fgm fga ftm fta tpm pts reb oreb ast stl blk tov pf tpa pm dd td
  function boxOf(p, yr) { var a = H.box && H.box.avg && H.box.avg[String(yr)]; return a && a[p.id]; }
  function hasBox(p) { return !p.fill && !p.rook && !!(boxOf(p, 2027) || boxOf(p, 2026)); }
  function statsPane(p) {
    var pc = function (m, a) { return a > 0 ? (100 * m / a).toFixed(1) : "—"; };
    var line = function (label, a, note) {
      return "<tr><td>" + label + (note ? ' <span class="note">' + note + "</span>" : "") + "</td><td>" + a[0] + "</td><td>" + f1(a[1]) + "</td><td><b>" + f1(a[7]) + "</b></td><td>" + f1(a[8]) + "</td><td>" + f1(a[10]) + "</td><td>" + f1(a[11]) + "</td><td>" + f1(a[12]) + "</td><td>" + f1(a[13]) +
        "</td><td>" + pc(a[2], a[3]) + "</td><td>" + f1(a[6]) + "-" + f1(a[15]) + "</td><td>" + pc(a[6], a[15]) + "</td><td>" + pc(a[4], a[5]) + "</td></tr>";
    };
    var head = "<th>Season</th><th>GP</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TOV</th><th>FG%</th><th>3PM-A</th><th>3P%</th><th>FT%</th>";
    var now = boxOf(p, 2027), prev = boxOf(p, 2026);
    var html = '<h4 class="card-sec">Per game</h4><div class="scroll"><table class="t"><thead><tr>' + head + "</tr></thead><tbody>" + (now ? line("2026-27", now) : "") + (prev ? line("2025-26", prev) : "") + "</tbody></table></div>";
    // week by week this season: the weekly totals, shown per game
    var wk = (H.box && H.box.wk) || {}, weeks = Object.keys(wk).map(Number).sort(function (a, b) { return b - a; }).filter(function (w) { return wk[w][p.id]; });
    if (weeks.length) {
      var open = H.box.opener ? new Date(H.box.opener + "T12:00:00Z") : null;
      var wkLabel = function (w) { if (!open) return "Week " + w; var d = new Date(open.getTime() + (w - 1) * 7 * 864e5); return "Week " + w + ' <span class="note">' + fmtShort(d.toISOString().slice(0, 10)) + "</span>"; };
      html += '<h4 class="card-sec">By week</h4><div class="scroll"><table class="t"><thead><tr><th>Week</th><th>G</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TOV</th><th>FG</th><th>3P</th><th>FT</th></tr></thead><tbody>' +
        weeks.map(function (w) {
          var t = wk[w][p.id], g = t[0] || 1, pg = function (i) { return f1(t[i] / g); };
          return "<tr><td>" + wkLabel(w) + "</td><td>" + t[0] + "</td><td>" + pg(1) + "</td><td><b>" + pg(7) + "</b></td><td>" + pg(8) + "</td><td>" + pg(10) + "</td><td>" + pg(11) + "</td><td>" + pg(12) + "</td><td>" + pg(13) +
            "</td><td>" + t[2] + "-" + t[3] + "</td><td>" + t[6] + "-" + t[15] + "</td><td>" + t[4] + "-" + t[5] + "</td></tr>";
        }).join("") + "</tbody></table></div><p class=\"note\">Week columns are per game, except the shooting columns, which are makes and attempts for the week.</p>";
    }
    var r = H.adv ? p.adv : null;
    if (r && r.s) html += '<div class="kv">' + kv(r.s.ts != null ? (r.s.ts * 100).toFixed(1) + "%" : "—", "True shooting") + kv(r.s.usg != null ? f1(r.s.usg) + "%" : "—", "Usage") + kv(f1(r.s.pts100), "Points per 100") + (r.s.ortg ? kv(f0(r.s.ortg) + " / " + f0(r.s.drtg), "Off / def rating") : "") + "</div>";
    return html + '<p class="note">From ESPN box scores, updated daily. Skills has the advanced numbers and how they rank.</p>';
  }
  // Two-way and 10-day deals don't count against the cap, so the hub carries them at no salary; the card says what they are
  function twoWayNote(p) {
    var fx = (H.fixes && H.fixes.nonCap && H.fixes.nonCap[p.id]) || {}, ten = fx.kind === "10-day";
    var minS = (H.minScale && H.minScale[0]) || 1357762;
    return '<div class="kv">' + kv(ten ? "10-day" : "Two-way", "Contract") + kv(money(ten ? minS * 10 / 174 : minS / 2), ten ? "For the 10 days" : "Salary this season") + kv("No", "Counts against the cap") + "</div>" +
      '<p class="tldr">' + (ten ? "A 10-day contract: ten days at his minimum, then the team keeps him on another or lets him go." :
        "A two-way contract: he can play up to 50 regular-season games for the " + esc(team(p.t).short) + " and spends the rest with its G League team. It pays half the rookie minimum and doesn't count against the cap or the tax, so it has no trade value until he's converted to a standard deal, which needs an open roster spot.") +
      (fx.note ? " " + esc(fx.note) + "." : "") + "</p>";
  }
  function closeCard() { if (card.open) card.close(); }
  function saveAdj() { save("adj", H.adj); }
  card.addEventListener("change", function (e) {
    var a = e.target.closest("[data-adj]");
    if (!a) return;
    H.setAdj(a.dataset.adj, +a.value); saveAdj();
    var keep = cardTab; openCard(a.dataset.adj); cardTab = keep; render();
  });
  card.addEventListener("click", function (e) {
    if (e.target === card || e.target.closest("[data-close]")) { closeCard(); return; }
    var tb = e.target.closest("[data-ctab]");
    if (tb) {
      cardTab = tb.dataset.ctab;
      card.querySelectorAll("[data-ctab]").forEach(function (b) { b.setAttribute("aria-selected", b === tb); });
      card.querySelectorAll("[data-pane]").forEach(function (x) { x.hidden = x.dataset.pane !== cardTab; });
      return;
    }
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


  // ---------- lineups ----------
  // Five-man units, trios and duos and on/off, all from pbpstats' possessions this season (tools/nba_lineups.py).
  // Ratings are points per 100 possessions; net color runs red to green from -20 to +20.
  function netColor(v) { return v == null ? "transparent" : xl(Math.max(0, Math.min(99, 50 + v * 2.5))); }
  function netCell(v, cls) { return '<td class="hc' + (cls ? " " + cls : "") + '" style="background:' + netColor(v) + '">' + (v == null ? "—" : (v > 0 ? "+" : "") + f1(v)) + "</td>"; }
  function luP(nid) { return H.luIds && H.W.P[H.luIds[nid]]; }
  function luLast(nid) { var p = luP(nid), n = p ? p.n : (H.lu.names[nid] || "?"); return n.split(" ").slice(1).join(" ") || n; }
  function luFaces(ids, size) {
    return '<span class="lu">' + ids.map(function (nid) {
      var p = luP(nid), f = p ? face(p, size || 24) : window.DSFaces.html({ sport: "nba", name: H.lu.names[nid] || "?", size: size || 24 });
      return '<span class="lup"' + (p ? ' data-p="' + esc(p.id) + '"' : "") + ' title="' + esc(p ? p.n : H.lu.names[nid] || "") + '">' + f + '<span class="lun">' + esc(luLast(nid)) + "</span></span>";
    }).join("") + '<span class="lunames">' + ids.map(function (nid) { return esc(luLast(nid)); }).join(", ") + "</span></span>";
  }
  function rate(pts, poss) { return poss ? 100 * pts / poss : null; }
  function luRows(kind, code) {
    var out = [];
    Object.keys(H.luTeams).forEach(function (c) {
      if (code && c !== code) return;
      var t = H.luTeams[c];
      if (kind === "5") t.l5.forEach(function (u) { out.push({ c: c, ids: u[0], min: u[1], op: u[2], dp: u[3], o: rate(u[4], u[2]), d: rate(u[5], u[3]), f3: u[6], rim: u[7] }); });
      else (kind === "3" ? t.l3 : t.l2).forEach(function (u) { out.push({ c: c, ids: u[0], min: u[1], op: u[2], dp: u[3], o: rate(u[4], u[2]), d: rate(u[5], u[3]) }); });
    });
    out.forEach(function (x) { x.poss = x.op + x.dp; x.net = x.o != null && x.d != null ? x.o - x.d : null; });
    return out;
  }
  function ooRows(code) {
    var out = [];
    Object.keys(H.luTeams).forEach(function (c) {
      if (code && c !== code) return;
      var t = H.luTeams[c];
      Object.keys(t.onoff).forEach(function (nid) {
        var v = t.onoff[nid], on = v[2] != null && v[3] != null ? v[2] - v[3] : null, off = v[4] != null && v[5] != null ? v[4] - v[5] : null;
        out.push({ c: c, nid: nid, min: v[0], poss: v[1], oOn: v[2], dOn: v[3], oOff: v[4], dOff: v[5], on: on, off: off, diff: on != null && off != null ? on - off : null, possOff: v[6] });
      });
    });
    return out;
  }
  // ----- lineup modules -----
  function luFace(nid, size) {
    var p = luP(nid);
    return p ? face(p, size) : window.DSFaces.html({ sport: "nba", name: H.lu.names[nid] || "?", size: size });
  }
  function signedNet(v) { return v == null ? "—" : (v > 0 ? "+" : "") + f1(v); }
  function netCls(v) { return v == null ? "" : v >= 0 ? "pos" : "neg"; }
  // a five-man unit as a card: team color, five faces with names, net rating up top
  function unitCard(x) {
    var t = team(x.c);
    return '<article class="ucard" style="--tc:' + esc(t.color) + '"><header>' + logo(x.c, 22) + "<span>" + esc(t.short) + '</span><b class="unet ' + netCls(x.net) + '">' + signedNet(x.net) + "</b></header>" +
      '<div class="ufive">' + x.ids.map(function (nid) {
        var p = luP(nid);
        return '<span class="uman"' + (p ? ' data-p="' + esc(p.id) + '"' : "") + ">" + luFace(nid, 46) + "<small>" + esc(luLast(nid)) + "</small></span>";
      }).join("") + "</div>" +
      '<footer><span><b>' + f1(x.o) + "</b> off</span><span><b>" + f1(x.d) + "</b> def</span><span><b>" + f0(x.min) + "</b> min</span><span><b>" + x.poss + "</b> poss</span></footer></article>";
  }
  function duoCard(x) {
    var t = team(x.c);
    return '<article class="dcard" style="--tc:' + esc(t.color) + '"><span class="dfaces">' + x.ids.map(function (nid) { var p = luP(nid); return "<span" + (p ? ' data-p="' + esc(p.id) + '"' : "") + ">" + luFace(nid, 40) + "</span>"; }).join("") + '</span><span class="dwho"><b>' + x.ids.map(function (nid) { return esc(luLast(nid)); }).join(" + ") + "</b><small>" + logo(x.c, 14) + " " + f0(x.min) + " min together</small></span><b class=\"unet " + netCls(x.net) + '">' + signedNet(x.net) + "</b></article>";
  }
  // a ranked row: faces, names, and a net bar out from zero
  var NET_SPAN = 40;
  function netBar(v) {
    var w = v == null ? 0 : Math.min(1, Math.abs(v) / NET_SPAN) * 50;
    return '<span class="nbar"><i class="z"></i><i class="b ' + netCls(v) + '" style="' + (v >= 0 ? "left:50%" : "right:50%") + ";width:" + w.toFixed(1) + '%"></i></span><b class="nval ' + netCls(v) + '">' + signedNet(v) + "</b>";
  }
  function lineRow(x, rank, showTeam) {
    return '<li class="lrow' + (rank ? "" : " nork") + '">' + (rank ? '<span class="lrk">' + rank + "</span>" : "") + '<span class="lwho">' + (showTeam ? logo(x.c, 18) : "") + '<span class="fstack">' + x.ids.map(function (nid) { var p = luP(nid); return "<span" + (p ? ' data-p="' + esc(p.id) + '"' : "") + ' title="' + esc(p ? p.n : H.lu.names[nid] || "") + '">' + luFace(nid, 30) + "</span>"; }).join("") + '</span><span class="lnames">' + x.ids.map(function (nid) { return esc(luLast(nid)); }).join(", ") + "</span></span>" +
      '<span class="lbar">' + netBar(x.net) + '</span><span class="lmeta">' + f1(x.o) + " / " + f1(x.d) + "<small>" + f0(x.min) + " min, " + x.poss + " poss</small></span></li>";
  }
  // on/off as a dumbbell: hollow dot with him off, filled dot with him on
  var DB = 30;
  function dbX(v) { return (Math.max(-DB, Math.min(DB, v)) + DB) / (2 * DB) * 100; }
  function dumbbell(list, showTeam) {
    var html = '<div class="dbell"><div class="dbaxis"><span></span><span class="dbscale"><i style="left:' + dbX(-20) + '%">-20</i><i style="left:' + dbX(-10) + '%">-10</i><i style="left:50%">0</i><i style="left:' + dbX(10) + '%">+10</i><i style="left:' + dbX(20) + '%">+20</i></span><span>On/off</span></div>';
    list.forEach(function (x) {
      var p = luP(x.nid), a = dbX(x.off), b = dbX(x.on), lo = Math.min(a, b), hi = Math.max(a, b);
      html += '<div class="dbrow"><span class="dbwho"' + (p ? ' data-p="' + esc(p.id) + '"' : "") + ">" + (showTeam ? logo(x.c, 16) : "") + luFace(x.nid, 26) + '<span class="nm"><span class="full">' + esc(p ? p.n : H.lu.names[x.nid]) + '</span><span class="short">' + esc(shortName(p ? p.n : H.lu.names[x.nid])) + '</span></span></span><span class="dbplot"><i class="z"></i><i class="ln ' + netCls(x.diff) + '" style="left:' + lo.toFixed(1) + "%;width:" + (hi - lo).toFixed(1) + '%"></i><i class="off" style="left:' + a.toFixed(1) + '%" title="Off: ' + signedNet(x.off) + '"></i><i class="on ' + netCls(x.diff) + '" style="left:' + b.toFixed(1) + '%" title="On: ' + signedNet(x.on) + '"></i></span><b class="dbd ' + netCls(x.diff) + '">' + signedNet(x.diff) + "</b></div>";
    });
    return html + '<p class="dbkey"><span class="k off"></span>Team net rating with him off <span class="k on"></span>with him on (per 100 possessions)</p></div>';
  }
  // two-man chemistry: every pair of a team's top players, net rating together
  function duoGrid(code, minP) {
    var t = H.luTeams[code], oo = ooRows(code).sort(function (a, b) { return b.min - a.min; }).slice(0, 9), ids = oo.map(function (x) { return x.nid; }), pair = {};
    t.l2.forEach(function (u) { pair[u[0].slice().sort().join("|")] = u; });
    var head = "<th></th>" + ids.map(function (nid) { var p = luP(nid); return '<th class="dgf"' + (p ? ' data-p="' + esc(p.id) + '"' : "") + ' title="' + esc(p ? p.n : "") + '">' + luFace(nid, 28) + "</th>"; }).join("");
    var body = ids.map(function (r, i) {
      var p = luP(r);
      return '<tr><th class="dgn"' + (p ? ' data-p="' + esc(p.id) + '"' : "") + ">" + luFace(r, 26) + '<span class="dgl">' + esc(luLast(r)) + "</span></th>" + ids.map(function (c, j) {
        if (i === j) { var me = oo[i]; return '<td class="dgself" title="' + esc(luLast(r)) + ' on the floor">' + signedNet(me.on) + "</td>"; }
        var u = pair[[r, c].sort().join("|")];
        if (!u || u[2] + u[3] < minP) return '<td class="dgnone"></td>';
        var net = rate(u[4], u[2]) - rate(u[5], u[3]);
        return '<td style="background:' + netColor(net) + '" title="' + esc(luLast(r) + " + " + luLast(c)) + ": " + signedNet(net) + " in " + u[1] + ' min">' + Math.round(net) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return '<div class="dgrid scroll"><table><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div><p class=\"note\">Net rating per 100 possessions with both on the floor; the diagonal is each player on his own. Blank: under " + minP + " possessions together.</p>";
  }
  function luSection(title, sub, body, more) {
    return '<section class="lusec"><div class="lusec-h"><h3>' + esc(title) + "</h3>" + (sub ? "<small>" + sub + "</small>" : "") + (more || "") + "</div>" + body + "</section>";
  }
  function lineupsPage() {
    if (!H.lu) { view.innerHTML = '<h2 class="sec">Lineups</h2><p class="lede">Lineups haven\'t loaded. They rebuild daily; try again in a bit.</p>'; return; }
    var q = state.q, tm = H.luTeams[q.t] ? q.t : "", list = { "5": 1, "3": 1, "2": 1, oo: 1 }[q.list] ? q.list : "", minP = +q.min || 150;
    var link = function (extra) { return href("lineups", Object.assign({}, q, { pg: null }, extra)); };
    var html = '<h2 class="sec">Lineups</h2><p class="lede">Which units work, which pairs click and who swings his team most, per 100 possessions this season.</p>';
    html += '<div class="luctl"><label>Team<select data-q="t"><option value="">The whole league</option>' + H.codes.slice().sort(function (a, b) { return team(a).name.localeCompare(team(b).name); }).map(function (c) { return '<option value="' + c + '"' + (c === tm ? " selected" : "") + ">" + esc(team(c).name) + "</option>"; }).join("") + "</select></label>" +
      '<div class="chips" role="group" aria-label="Possession floor"><span>At least</span>' + [100, 150, 250, 400].map(function (v) { return '<a href="' + link({ min: v === 150 ? null : v }) + '"' + (v === minP ? ' aria-current="true"' : "") + ">" + v + "</a>"; }).join("") + "<span>possessions</span></div></div>";
    // One short tab row on every lineups view, so it fits a phone on one line
    var tabs = [["", "Overview"], ["5", "Five-man"], ["3", "Trios"], ["2", "Duos"], ["oo", "On/off"]];
    html += '<div class="seg luseg">' + tabs.map(function (x) { return '<a href="' + link({ list: x[0] || null, sort: null }) + '"' + ((list || "") === x[0] ? ' aria-current="page"' : "") + ">" + x[1] + "</a>"; }).join("") + "</div>";
    if (list) { html += fullList(list, tm, minP, q, link); view.innerHTML = html; return; }
    if (tm) { html += teamLab(tm, minP, link); view.innerHTML = html; return; }
    var units = luRows("5", "").filter(function (x) { return x.poss >= minP; });
    var best = units.slice().sort(function (a, b) { return b.net - a.net; }), duos = luRows("2", "").filter(function (x) { return x.poss >= minP * 3; }).sort(function (a, b) { return b.net - a.net; });
    var oo = ooRows("").filter(function (x) { return x.poss >= minP * 2 && x.possOff >= 100 && x.diff != null; }).sort(function (a, b) { return b.diff - a.diff; });
    var see = function (k, n) { return '<a class="more" href="' + link({ list: k }) + '">All ' + n + "</a>"; };
    html += luSection("The best five-man units", units.length + " units with " + minP + "+ possessions", '<div class="ucards">' + best.slice(0, 6).map(unitCard).join("") + "</div>", see("5", units.length));
    html += luSection("Biggest on/off swings", "Players with " + minP * 2 + "+ possessions on the floor", dumbbell(oo.slice(0, 12), true), see("oo", oo.length));
    html += luSection("Best duos", minP * 3 + "+ possessions together", '<div class="dcards">' + duos.slice(0, 8).map(duoCard).join("") + "</div>", see("2", duos.length));
    html += luSection("The worst five-man units", "", '<div class="ucards">' + best.slice(-3).reverse().map(unitCard).join("") + "</div>");
    html += '<p class="note">Updated ' + esc(H.lu.updated.replace("T", " ").replace("Z", " UTC")) + ". Off is every lineup a player isn't in, so on/off flatters starters on deep teams. How it works has the details.</p>";
    view.innerHTML = html;
  }
  function fullList(kind, tm, minP, q, link) {
    var names = { "5": "Five-man units", "3": "Trios", "2": "Duos", oo: "On/off" };
    var html = "";
    var worst = q.sort === "worst", floor = kind === "5" ? minP : kind === "oo" ? minP * 2 : kind === "3" ? minP * 2 : minP * 3;
    var rows, pages, pg, start, body;
    if (kind === "oo") {
      rows = ooRows(tm).filter(function (x) { return x.poss >= floor && x.possOff >= 50 && x.diff != null; }).sort(function (a, b) { return worst ? a.diff - b.diff : b.diff - a.diff; });
    } else {
      rows = luRows(kind, tm).filter(function (x) { return x.poss >= floor; }).sort(function (a, b) { return worst ? a.net - b.net : b.net - a.net; });
    }
    pages = Math.max(1, Math.ceil(rows.length / PER)); pg = Math.min(pages, Math.max(1, +q.pg || 1)); start = (pg - 1) * PER;
    var page = rows.slice(start, start + PER);
    body = kind === "oo" ? dumbbell(page, !tm) : '<ol class="lrows">' + page.map(function (x, k) { return lineRow(x, start + k + 1, !tm); }).join("") + "</ol>";
    html += luSection((worst ? "Worst " : "Best ") + names[kind].toLowerCase(), rows.length + " with " + floor + "+ possessions" + (tm ? ", " + esc(team(tm).short) : ""),
      rows.length ? body : '<p class="note">Nothing that size yet. Lower the possession floor.</p>', '<a class="more" href="' + link({ sort: worst ? null : "worst" }) + '">' + (worst ? "Show best" : "Show worst") + "</a>");
    if (pages > 1) html += '<nav class="pager">' + (pg > 1 ? '<a class="btn" href="' + link({ pg: pg - 1 }) + '">Previous</a>' : '<span class="btn off">Previous</span>') + "<span>" + (start + 1) + "-" + Math.min(rows.length, start + PER) + " of " + rows.length + "</span>" + (pg < pages ? '<a class="btn" href="' + link({ pg: pg + 1 }) + '">Next</a>' : '<span class="btn off">Next</span>') + "</nav>";
    return html;
  }
  function teamLab(code, minP, link) {
    var t = H.luTeams[code], tt = team(code), tot = t.tot, net = rate(tot[3], tot[1]) - rate(tot[4], tot[2]);
    var units = luRows("5", code), used = units.slice().sort(function (a, b) { return b.min - a.min; }), top = used[0];
    var good = units.filter(function (x) { return x.poss >= minP; }).sort(function (a, b) { return b.net - a.net; })[0];
    var oo = ooRows(code).filter(function (x) { return x.min >= 40 && x.diff != null; }).sort(function (a, b) { return b.diff - a.diff; });
    var html = '<div class="lab" style="--tc:' + esc(tt.color) + '"><div class="lab-h">' + '<span class="tlogo">' + logo(code, 43) + '</span><div><small>Lineup lab</small><b>' + esc(tt.name) + '</b></div><div class="lab-k"><span><b class="' + netCls(net) + '">' + signedNet(net) + "</b>Team net</span>" +
      (top ? "<span><b class=\"" + netCls(top.net) + '">' + signedNet(top.net) + "</b>Most-used five (" + f0(top.min) + " min)</span>" : "") + (good ? "<span><b class=\"" + netCls(good.net) + '">' + signedNet(good.net) + "</b>Best five, " + minP + "+ poss</span>" : "") + "</div></div></div>";
    html += luSection("Most-used lineups", "Five-man units by minutes", '<ol class="lrows">' + used.slice(0, 10).map(function (x) { return lineRow(x, 0, false); }).join("") + "</ol>", '<a class="more" href="' + link({ list: "5" }) + '">All ' + units.length + "</a>");
    html += luSection("Two-man chemistry", "", duoGrid(code, Math.round(minP / 2)));
    html += luSection("On/off", "Everyone with 40+ minutes", dumbbell(oo, false));
    return html;
  }
  function teamLineups(code) {
    if (!H.lu || !H.luTeams[code]) return "";
    var used = luRows("5", code).sort(function (a, b) { return b.min - a.min; }).slice(0, 5);
    var oo = ooRows(code).filter(function (x) { return x.min >= 60 && x.diff != null; }).sort(function (a, b) { return b.diff - a.diff; });
    return '<div class="lupanels">' + luSection("Most-used lineups", "This season", '<ol class="lrows">' + used.map(function (x) { return lineRow(x, 0, false); }).join("") + "</ol>", '<a class="more" href="' + href("lineups", { t: code }) + '">Lineup lab</a>') +
      luSection("On/off", "Everyone with 60+ minutes", dumbbell(oo, false)) + "</div>";
  }

  // ---------- team style ----------
  // What a team does and what it allows, from every lineup it has played (tools/nba_lineups.py), ranked across the league
  var ORD = function (n) { return n == null ? "—" : ordinal(n); };
  // each number: label, how to show it, and which way is good (1: more is better, -1: less is better, 0: neither)
  var SM = {
    rtg: ["Rating", function (v) { return f1(v); }, 1], efg: ["Effective FG%", function (v) { return pct(v, 1); }, 1], tov: ["Turnovers per 100", function (v) { return f1(v); }, -1],
    orb: ["Offensive rebound %", function (v) { return pct(v, 1); }, 1], ftr: ["Free-throw points per shot", function (v) { return v == null ? "—" : v.toFixed(2); }, 1],
    pace: ["Pace (possessions per 48)", function (v) { return f1(v); }, 0], rate3: ["Share of shots from three", function (v) { return pct(v); }, 0],
    ast: ["Buckets assisted", function (v) { return pct(v); }, 0], unast100: ["Unassisted points per 100", function (v) { return f1(v); }, 0],
    sc100: ["Second-chance points per 100", function (v) { return f1(v); }, 1], pb100: ["Putback points per 100", function (v) { return f1(v); }, 1]
  };
  // league rank where 1 is best for this side (defense flips the direction)
  function bestRank(st, side, k) {
    var r = st[side].rk[k], dir = SM[k][2] * (side === "d" ? -1 : 1);
    return r == null ? null : dir >= 0 ? r : 31 - r;
  }
  function rankPill(r, neutral) {
    if (r == null) return "";
    return '<span class="rpill"' + (neutral ? "" : ' style="background:' + xl((30 - r) / 29 * 99) + '"') + ">" + ORD(r) + "</span>";
  }
  function styleTags(st) {
    var o = st.o, d = st.d, tags = [];
    var or = function (k) { return bestRank(st, "o", k); }, dr = function (k) { return bestRank(st, "d", k); };
    if (or("rtg") <= 5) tags.push(["Elite offense", "g"]); else if (or("rtg") >= 26) tags.push(["Struggling offense", "r"]);
    if (dr("rtg") <= 5) tags.push(["Elite defense", "g"]); else if (dr("rtg") >= 26) tags.push(["Leaky defense", "r"]);
    if (o.rk.pace <= 5) tags.push(["Plays fast", ""]); else if (o.rk.pace >= 26) tags.push(["Slows it down", ""]);
    if (o.rk.rate3 <= 5) tags.push(["Lives behind the arc", ""]); else if (o.rk.rate3 >= 26) tags.push(["Rarely shoots threes", ""]);
    if (o.zrk && o.zrk.rim <= 5) tags.push(["Attacks the rim", ""]);
    if (o.zrk && (o.zrk.lmid <= 4 || o.zrk.smid <= 4)) tags.push(["Mid-range heavy", ""]);
    if (o.rk.ast <= 5) tags.push(["Moves the ball", ""]); else if (o.rk.ast >= 26) tags.push(["Lots of isolation", ""]);
    if (or("orb") <= 5) tags.push(["Crashes the glass", ""]);
    if (dr("tov") <= 5) tags.push(["Forces turnovers", "g"]);
    if (d.zrk && d.zrk.rim >= 26) tags.push(["Walls off the rim", "g"]);
    if (d.rk.rate3 >= 26) tags.push(["Runs shooters off the line", "g"]);
    if (or("tov") >= 27) tags.push(["Careless with the ball", "r"]);
    return tags.slice(0, 6);
  }
  function styleZones(side, st) {
    var zs = {}, lg = H.lu.lgZones || {};
    ["rim", "smid", "lmid", "c3", "a3"].forEach(function (z) { var v = st[side].zones[z]; zs[z] = [v[0], v[1], lg[z] ? lg[z][1] : null]; });
    return zs;
  }
  function styleZoneTable(side, st) {
    var nm = { rim: "At the rim", smid: "Short mid-range", lmid: "Long mid-range", c3: "Corner 3", a3: "Above-the-break 3" }, lg = H.lu.lgZones || {};
    return '<table class="t sz"><thead><tr><th>Zone</th><th>Share</th><th title="League rank by share of shots">Rank</th><th>FG%</th><th>NBA</th></tr></thead><tbody>' + ["rim", "smid", "lmid", "c3", "a3"].map(function (z) {
      var v = st[side].zones[z], l = lg[z] || [], dlt = v[1] != null && l[1] != null ? (v[1] - l[1]) * (side === "d" ? -1 : 1) : null;
      return "<tr><td>" + nm[z] + "</td><td>" + pct(v[0]) + '</td><td class="note">' + ORD(st[side].zrk ? st[side].zrk[z] : null) + '</td><td class="' + (dlt == null ? "" : dlt >= 0 ? "pos" : "neg") + '"><b>' + pct(v[1], 1) + "</b></td><td>" + pct(l[1], 1) + "</td></tr>";
    }).join("") + "</tbody></table>";
  }
  function stylePage() {
    var code = (state.arg || load("team", "BOS")).toUpperCase();
    if (!H.teams[code]) code = "BOS";
    var t = team(code), lt = H.luTeams && H.luTeams[code], st = lt && lt.style;
    var html = teamHead(code, 0, "style") + teamPicker(code, 0, "style");
    if (!st) { view.innerHTML = html + '<p class="lede">Team style numbers haven\'t loaded. They rebuild daily with the lineups.</p>'; return; }
    var tags = styleTags(st), net = st.o.rtg - st.d.rtg;
    // net rating rank across the league (1st is best)
    var netRk = 1 + Object.keys(H.luTeams).filter(function (c) { var x = H.luTeams[c].style; return x && x.o.rtg - x.d.rtg > net + 1e-9; }).length;
    html += '<div class="sty-hero" style="--tc:' + esc(t.color) + '"><div class="sty-k">' +
      '<div><b>' + f1(st.o.rtg) + "</b><span>Offense</span>" + rankPill(bestRank(st, "o", "rtg")) + "</div>" +
      '<div><b>' + f1(st.d.rtg) + "</b><span>Defense</span>" + rankPill(bestRank(st, "d", "rtg")) + "</div>" +
      '<div><b class="' + (net >= 0 ? "pos" : "neg") + '">' + (net >= 0 ? "+" : "") + f1(net) + "</b><span>Net rating</span>" + rankPill(netRk) + "</div>" +
      '<div><b>' + f1(st.o.pace) + "</b><span>Pace</span>" + rankPill(st.o.rk.pace, true) + "</div></div>" +
      (tags.length ? '<div class="sty-tags">' + tags.map(function (x) { return '<span class="stag ' + x[1] + '">' + esc(x[0]) + "</span>"; }).join("") + "</div>" : "") + "</div>";
    // four factors
    var ff = ["efg", "tov", "orb", "ftr"];
    html += luSection("The four factors", "What wins possessions, on both ends. Ranks: 1st is best.",
      '<div class="ffgrid"><div class="ffh"></div><div class="ffh">Offense</div><div class="ffh">Defense</div>' + ff.map(function (k) {
        var dl = k === "orb" ? "Opponent offensive rebound %" : k === "tov" ? "Turnovers forced per 100" : "Opponent " + SM[k][0].charAt(0).toLowerCase() + SM[k][0].slice(1);
        return '<div class="ffl">' + SM[k][0] + '</div><div class="ffc"><b>' + SM[k][1](st.o[k]) + "</b>" + rankPill(bestRank(st, "o", k)) + '</div><div class="ffc" title="' + esc(dl) + '"><b>' + SM[k][1](st.d[k]) + "</b>" + rankPill(bestRank(st, "d", k)) + "</div>";
      }).join("") + "</div>");
    // ratings vs. results
    var tc = H.teamCheck && H.teamCheck(code);
    if (tc) {
      var all = H.codes.map(function (c) { return { c: c, x: H.teamCheck(c) }; }).filter(function (o) { return o.x; }).sort(function (a, b) { return b.x.gap - a.x.gap; });
      var gRk = 1 + all.findIndex(function (o) { return o.c === code; }), sg = function (v) { return (v >= 0 ? "+" : "") + f1(v); };
      var read = Math.abs(tc.gap) < 2 ? "Right about where its players' ratings say it should be." : tc.gap > 0 ? "Better than its players' ratings add up to: the system, the fit, shooting luck or ratings that are too low." : "Worse than its players' ratings add up to: bad fit, bad luck or ratings that are too high.";
      html += luSection("Ratings vs. results", "Each player's impact rating times his share of the minutes, against the team's actual net rating. " + tc.games + " games, so expect noise until midseason.",
        '<div class="kv"><div><b>' + sg(tc.implied) + "</b><span>Ratings add up to</span></div><div><b>" + sg(tc.actual) + "</b><span>Actual net rating</span></div><div><b class=\"" + (tc.gap >= 0 ? "pos" : "neg") + '">' + sg(tc.gap) + "</b><span>Beating the ratings by (" + ORD(gRk) + " of " + all.length + ")</span></div></div>" +
        '<p class="tldr">' + read + "</p>" +
        '<div class="two">' + tablePanel("Where it comes from", "<th>Player</th><th>Min share</th><th>Impact</th><th>Adds</th>", tc.rows.slice(0, 9).map(function (x) { return "<tr><td>" + pname(x.p, 20) + "</td><td>" + Math.round(x.share * 100) + "%</td><td>" + rchip(x.r) + "</td><td>" + sg(x.add) + "</td></tr>"; }).join(""), "Share of a full game's minutes", "ttc") +
        tablePanel("Across the league", "<th>Team</th><th>Ratings</th><th>Actual</th><th>Gap</th>", all.map(function (o) { return "<tr" + (o.c === code ? ' class="me"' : "") + '><td><a href="' + href("style/" + o.c, {}) + '">' + logo(o.c, 16) + " " + esc(team(o.c).short) + "</a></td><td>" + sg(o.x.implied) + "</td><td>" + sg(o.x.actual) + '</td><td class="' + (o.x.gap >= 0 ? "pos" : "neg") + '">' + sg(o.x.gap) + "</td></tr>"; }).join(""), "Best gap first", "ttc") + "</div>");
    }
    // shot diets
    zoneInv = false; var offChart = shotChart(styleZones("o", st));
    zoneInv = true; var defChart = shotChart(styleZones("d", st)); zoneInv = false;
    html += luSection("Shot diet", "Where they shoot, and what they allow. Colors compare accuracy with the league: green is good for them.",
      '<div class="sty-two"><div><h4 class="card-sec">Their shots</h4>' + offChart + styleZoneTable("o", st) + '</div><div><h4 class="card-sec">Opponents\' shots</h4>' + defChart + styleZoneTable("d", st) + "</div></div>");
    // how they play
    var hp = ["pace", "rate3", "ast", "unast100", "sc100", "pb100"];
    html += luSection("How they play", "League ranks: 1st is the most", '<div class="sty-nums">' + hp.map(function (k) {
      return "<div><b>" + SM[k][1](st.o[k]) + "</b><span>" + SM[k][0] + "</span><small>" + ORD(st.o.rk[k]) + "</small></div>";
    }).join("") + "</div>");
    // the roster's skills
    if (H.adv) {
      var ps = H.adv.players.filter(function (r) { return r.t === code && r.mc >= 30; }).sort(function (a, b) { return b.mc - a.mc; });
      var cols = ["shoot", "finish", "create", "pass", "secure", "rimd", "reb", "off", "def"];
      html += luSection("The rotation's skills", "Percentiles league-wide; 99 is best", '<div class="panel"><div class="scroll"><table class="t rt"><thead><tr><th class="pn">Player</th><th class="hm">Min</th><th class="hm">Type</th>' + cols.map(function (c) { return '<th class="hc">' + CAT_SHORT[c] + "</th>"; }).join("") + "</tr></thead><tbody>" +
        ps.map(function (r) { return '<tr><td class="pn">' + advName(r, 22) + '</td><td class="hm mn">' + r.mc + '</td><td class="hm">' + archBadge(r.arch) + "</td>" + cols.map(function (c) { return hcell(r.r[c], H.adv.cats[c] + ": " + ORD(r.r[c])); }).join("") + "</tr>"; }).join("") + "</tbody></table></div></div>", '<a class="more" href="' + href("ratings", { t: code }) + '">Ratings</a>');
    }
    html += '<p class="note">From every lineup the team has played this season (pbpstats), updated daily. Free-throw points per shot stands in for free-throw rate. <a href="' + href("lineups", { t: code }) + '">Lineup lab</a></p>';
    view.innerHTML = html;
  }

  // ---------- ratings ----------
  // Skill ratings come from tools/nba_ratings.py: every category is a percentile among players with real minutes,
  // league-wide or against his position group (guards, wings, bigs).
  var CAT_OFF = ["shoot", "finish", "score", "create", "pass", "secure"], CAT_DEF = ["rimd", "reb", "steal"], CAT_IMP = ["overall", "off", "def"];
  var CAT_SHORT = { overall: "Overall", off: "Off", def: "Def", shoot: "Shoot", finish: "Finish", score: "Score", create: "Create", pass: "Pass", secure: "Secure", reb: "Reb", rimd: "Rim D", steal: "Steals" };
  var GROUP1 = { G: "guards", W: "wings", B: "bigs" };
  var ARCH = { // short badge and family for each archetype; the full name shows on hover and in the card
    "Two-way superstar": ["SUP", "star"], "Primary creator": ["CRE", "cre"], "Shot creator": ["SC", "cre"], "Three-level scorer": ["SCR", "cre"], "Floor general": ["FG", "cre"],
    "Shooter": ["SH", "sht"], "3-and-D wing": ["3&D", "sht"], "3-and-D guard": ["3&D", "sht"], "Defensive stopper": ["DEF", "def"], "Slasher": ["SL", "sht"], "Connector": ["CON", "role"], "Role player": ["ROL", "role"],
    "Playmaking big": ["PB", "big"], "Scoring big": ["SB", "big"], "Stretch rim protector": ["SRP", "big"], "Rim protector": ["RP", "big"], "Stretch big": ["STR", "big"], "Rim runner": ["RR", "big"], "Rotation big": ["BIG", "big"]
  };
  // an icon for each archetype, drawn on a 16-unit grid in the badge's color: what the player does, at a glance
  var ARCH_ICON = (function () {
    var st = function (d, w) { return '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="' + (w || 1.6) + '" stroke-linecap="round" stroke-linejoin="round"/>'; };
    var fl = function (d) { return '<path d="' + d + '" fill="currentColor"/>'; };
    var shield = "M8 1.6 13.4 3.6V8c0 3.4-5.4 6.4-5.4 6.4S2.6 11.4 2.6 8V3.6Z";
    return {
      "Two-way superstar": fl("M8 1.4l1.95 4.3 4.6.45-3.5 3.05 1.05 4.55L8 11.4l-4.1 2.35 1.05-4.55-3.5-3.05 4.6-.45Z"),
      "Primary creator": fl("M9.2 1.4 3.4 9h4.1l-1 5.6 6.1-8H8.4Z"),
      "Shot creator": st("M8 3a5 5 0 1 0 0 10A5 5 0 1 0 8 3M8 1v3.4M8 11.6V15M1 8h3.4M11.6 8H15") + fl("M8 6.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 1 0 0-2.8"),
      "Three-level scorer": fl("M1.8 10h3.4v4.4H1.8ZM6.3 6.4h3.4v8H6.3ZM10.8 2.6h3.4v11.8h-3.4Z"),
      "Floor general": st("M1.4 8C3.6 4.2 12.4 4.2 14.6 8 12.4 11.8 3.6 11.8 1.4 8Z") + fl("M8 5.9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 1 0 0-4.2"),
      "Shooter": st("M3 13.2C3.6 6.8 8 3.4 12.6 5.6M11 7.4h3.6") + fl("M3 11.4a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 1 0 0-3.6"),
      "3-and-D wing": st(shield) + st("M5.2 9.6C6 6.4 10 6.4 10.8 9.6", 1.4),
      "3-and-D guard": st(shield) + st("M5.2 9.6C6 6.4 10 6.4 10.8 9.6", 1.4),
      "Defensive stopper": fl(shield),
      "Slasher": st("M1.8 12.6 6 8.2l3 2.2 5.2-6.4M10.6 4h3.6v3.6"),
      "Connector": st("M6.8 5.2H4.4a2.8 2.8 0 0 0 0 5.6h2.4M9.2 5.2h2.4a2.8 2.8 0 0 1 0 5.6H9.2M5.6 8h4.8"),
      "Role player": st("M2.6 2.8h3.6a1.8 1.8 0 1 1 3.6 0h3.6v3.6a1.8 1.8 0 1 1 0 3.6v3.6H2.6Z", 1.4),
      "Playmaking big": st("M3.4 11.8 8 3.8l4.6 8M3.4 11.8h9.2", 1.3) + fl("M8 1.8a2 2 0 1 0 0 4 2 2 0 1 0 0-4M3.4 9.8a2 2 0 1 0 0 4 2 2 0 1 0 0-4M12.6 9.8a2 2 0 1 0 0 4 2 2 0 1 0 0-4"),
      "Scoring big": fl("M8 1.2c1.6 3.2 5.2 4.6 5.2 8.8a5.2 5.2 0 0 1-10.4 0c0-2.6 1.5-3.6 2.6-5.2.3 2 1.3 3 2.6 3-1-2.6-.6-4.6 0-6.6Z"),
      "Stretch rim protector": st(shield) + st("M5 8.4h6M6.6 6.8 5 8.4l1.6 1.6M9.4 6.8 11 8.4 9.4 10", 1.3),
      "Rim protector": st("M2.4 2.4h11.2", 2.4) + st("M3.4 6.6h9.2M4.4 6.6 5.8 13h4.4l1.4-6.4M6.4 6.6l.7 6.4M9.6 6.6l-.7 6.4", 1.3),
      "Stretch big": st("M1.8 8h12.4M4.8 5 1.8 8l3 3M11.2 5l3 3-3 3"),
      "Rim runner": st("M3.6 2.4h8.8", 2.2) + st("M8 14.4V5.4M4.8 8.4 8 5.2l3.2 3.2"),
      "Rotation big": st("M2 3.6h12v4.4H2ZM2 8h12v4.4H2ZM8 3.6V8M5 8v4.4M11 8v4.4", 1.3)
    };
  })();
  function archIcon(a, px) {
    var ic = ARCH_ICON[a];
    return ic ? '<svg viewBox="0 0 16 16" width="' + (px || 16) + '" height="' + (px || 16) + '" aria-hidden="true" focusable="false">' + ic + "</svg>" : "";
  }
  function archBadge(a) {
    var x = ARCH[a] || ["?", "role"], ic = archIcon(a);
    return '<span class="ab ab-' + x[1] + (ic ? " ab-ico" : "") + '" data-tip="' + esc(a) + '" tabindex="0" role="img" aria-label="' + esc(a) + '">' + (ic || esc(x[0])) + "</span>";
  }
  // the key under the ratings table: every archetype by family
  function archKey() {
    var fam = [["star", "Stars"], ["cre", "Creators"], ["sht", "Shooters and wings"], ["def", "Defenders"], ["big", "Bigs"], ["role", "Role players"]];
    return '<div class="archkey">' + fam.map(function (f) {
      var names = Object.keys(ARCH).filter(function (a) { return ARCH[a][1] === f[0] && a !== "3-and-D guard"; });
      return names.length ? "<div><b>" + f[1] + "</b>" + names.map(function (a) { return '<span class="ak">' + archBadge(a) + esc(a === "3-and-D wing" ? "3-and-D" : a) + "</span>"; }).join("") + "</div>" : "";
    }).join("") + "</div>";
  }
  // Excel's three-color scale: red at 0, yellow at 50, green at 99
  function mix(c1, c2, t) { return "rgb(" + [0, 1, 2].map(function (i) { return Math.round(c1[i] + (c2[i] - c1[i]) * t); }).join(",") + ")"; }
  var XR = [248, 105, 107], XY = [255, 235, 132], XG = [99, 190, 123];
  function xl(v) { return v == null ? "transparent" : v < 50 ? mix(XR, XY, v / 50) : mix(XY, XG, Math.min(1, (v - 50) / 49)); }
  function hcell(v, title) { return '<td class="hc"' + (v == null ? "" : ' style="background:' + xl(v) + '"') + (title ? ' title="' + esc(title) + '"' : "") + ">" + (v == null ? "—" : v) + "</td>"; }
  function advPos(r) { var p = r.id && H.W.P[r.id]; return p ? posOf(p) : (r.pos || "").replace(/-/g, "/"); }
  function advName(r, size) {
    var p = r.id && H.W.P[r.id];
    if (p) return pname(p, size || 22);
    return '<span class="pl static">' + window.DSFaces.html({ sport: "nba", name: r.n, color: team(r.t).color, size: size || 22 }) + '<span class="nm">' + esc(r.n) + "</span></span>";
  }
  function ord(n) { return n == null ? "—" : ordinal(n); }
  var PER = 50;

  // ---------- player tracking (nba/data/tracking.json) ----------
  // The NBA's tracking cameras, pulled weekly through a browser (stats.nba.com refuses cloud servers) and published by
  // tools/nba_tracking.py: per-game numbers by NBA id, percentiles among players with 10+ minutes in 5+ games
  var TRK = null, trkWait = null;
  function loadTrack() {
    if (!trkWait) trkWait = fetch("data/tracking.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (j) {
        TRK = j || { cols: [], p: {}, dl: {}, none: true };
        TRK.ix = {}; TRK.cols.forEach(function (c, i) { TRK.ix[c] = i; });
        var AB = { BKN: "BRK", CHA: "CHO", PHX: "PHO" }; // the NBA's codes to the hub's
        Object.keys(TRK.p).forEach(function (k) { var d = TRK.p[k]; if (AB[d.t]) d.t = AB[d.t]; });
        TRK.hub = {}; // NBA id -> hub player id, through the ratings' ids, then Draft Lab's name match
        if (H.adv) H.adv.players.forEach(function (r) { if (r.nba && r.id) TRK.hub[String(r.nba)] = r.id; });
        Object.keys(TRK.dl || {}).forEach(function (pid) { var n = TRK.dl[pid]; if (!TRK.hub[n] && H.W.P[pid]) TRK.hub[n] = pid; });
        TRK.of = {}; Object.keys(TRK.hub).forEach(function (n) { TRK.of[TRK.hub[n]] = n; });
        if (state.route === "track" || state.route === "team") render();
        return TRK;
      });
    return trkWait;
  }
  // [key, label, format, tooltip]; f: 1 one decimal, 2 two, p a share, i a whole number
  var TRK_VIEWS = {
    move: { name: "Movement", sort: "dist", cols: [["dist", "Miles", 1, "Miles run a game"], ["dist_o", "On offense", 1], ["dist_d", "On defense", 1], ["spd", "Avg speed", 2, "Average speed, mph"], ["spd_o", "Offense mph", 2], ["spd_d", "Defense mph", 2]] },
    create: { name: "Creating", sort: "drv", cols: [["drv", "Drives", 1, "Drives a game"], ["drv_pts", "Drive pts", 1, "His points off drives"], ["drv_fg", "Drive FG%", "p"], ["drv_ast", "Drive ast", 1], ["drv_tov", "Drive TOV", 1], ["tch", "Touches", 1], ["top", "Time of poss.", 1, "Minutes with the ball a game"], ["sec_tch", "Sec/touch", 2], ["drib_tch", "Dribbles/touch", 2], ["passes", "Passes", 1], ["pot_ast", "Potential ast", 1, "Passes that would be assists if the shot went in"], ["ast_pts", "Ast pts created", 1], ["sec_ast", "Hockey ast", 1, "The pass before the assist"]] },
    shoot: { name: "Shooting", sort: "cs3a", cols: [["cs3a", "C&S 3PA", 1, "Catch-and-shoot threes a game"], ["cs3", "C&S 3P%", "p"], ["cs_efg", "C&S eFG%", "p"], ["pu_fga", "Pull-up FGA", 1], ["pu3", "Pull-up 3P%", "p"], ["pu_efg", "Pull-up eFG%", "p"]] },
    defend: { name: "Defense & hustle", sort: "defl", cols: [["rim_fga", "Rim shots faced", 1, "Shots at the rim he defended a game"], ["rim_fg", "Opp. rim FG%", "p", "Opponents' shooting at the rim with him defending (lower ranks higher)"], ["contest", "Contests", 1], ["defl", "Deflections", 1], ["charges", "Charges", 2], ["loose", "Loose balls", 2], ["boxouts", "Box outs", 1], ["reb_ch", "Reb chances", 1, "Times he was near a rebound"], ["reb_con", "Contested reb%", "p"], ["scr_pts", "Screen ast pts", 1, "Points off his screens"]] }
  };
  function trkFmt(v, f) { return v == null ? "—" : f === "p" ? (v * 100).toFixed(1) : f === 2 ? v.toFixed(2) : f === "i" ? String(Math.round(v)) : v.toFixed(1); }
  function trkColor(v) {
    if (v == null) return "transparent";
    var t = Math.max(0, Math.min(100, v)) / 100, mx = function (a, b, k) { return Math.round(a + (b - a) * k); };
    var c = t < 0.5 ? [mx(54, 222, t * 2), mx(97, 222, t * 2), mx(173, 222, t * 2)] : [mx(222, 210, (t - 0.5) * 2), mx(222, 45, (t - 0.5) * 2), mx(222, 73, (t - 0.5) * 2)];
    return "rgb(" + c.join(",") + ")";
  }
  function trkCell(d, c) {
    var v = d.x[TRK.ix[c[0]]], pc = (d.pct || {})[c[0]];
    return pc == null ? "<td>" + trkFmt(v, c[2]) + "</td>" : '<td class="pc" style="background:' + trkColor(pc) + ";color:" + (pc >= 80 || pc <= 20 ? "#fff" : "inherit") + '" title="' + ord(pc) + ' percentile">' + trkFmt(v, c[2]) + "</td>";
  }
  function trkName(id, d) {
    var p = TRK.hub[id] && H.W.P[TRK.hub[id]];
    return p ? pname(p, 22) : '<span class="pl static">' + window.DSFaces.html({ sport: "nba", name: d.n, color: team(d.t).color, size: 22 }) + '<span class="nm">' + esc(d.n) + "</span></span>";
  }
  function trackPage() {
    if (!TRK) { view.innerHTML = '<p class="loading">Loading tracking…</p>'; loadTrack(); return; }
    var q = state.q, v = TRK_VIEWS[q.v] ? q.v : "move", V = TRK_VIEWS[v], all = q.all === "1", tm = q.t || "", find = (q.q || "").toLowerCase();
    var sort = V.cols.some(function (c) { return c[0] === q.s; }) ? q.s : V.sort, asc = sort === "rim_fg" || sort === "drv_tov";
    var opt = function (val, l, cur) { return '<option value="' + val + '"' + (val === cur ? " selected" : "") + ">" + l + "</option>"; };
    var rows = Object.keys(TRK.p).map(function (id) { return { id: id, d: TRK.p[id] }; }).filter(function (r) {
      var d = r.d, qual = (d.gp || 0) >= TRK.qual.gp && (d.min || 0) >= TRK.qual.min;
      return (all || qual || find) && (!tm || d.t === tm) && (!find || String(d.n).toLowerCase().indexOf(find) >= 0);
    });
    // a rate sorts only players with enough attempts behind it (TRK.vol, the same rule as the percentiles)
    var vol = (TRK.vol || {})[sort], enough = function (d) { return !vol || (d.x[TRK.ix[vol[0]]] || 0) * (d.gp || 0) >= vol[1]; };
    var key = function (r) { var x = r.d.x[TRK.ix[sort]]; return x == null || !enough(r.d) ? (asc ? 1e9 : -1e9) : x; };
    rows.sort(function (a, b) { return asc ? key(a) - key(b) : key(b) - key(a); });
    var html = '<h2 class="sec">Player tracking</h2><p class="lede">The NBA\'s tracking cameras follow every player and the ball 25 times a second. These are this season\'s numbers a game: how far and fast he moves, how he creates, how he shoots off the catch and the dribble, and the defense and hustle plays the box score misses. Shaded cells are percentiles among players with ' + TRK.qual.min + "+ minutes in " + TRK.qual.gp + "+ games: red is good, blue is bad. Click a column to sort, a player for his card.</p>";
    html += '<div class="controls"><label>Show<select data-q="v">' + Object.keys(TRK_VIEWS).map(function (k) { return opt(k, TRK_VIEWS[k].name, v); }).join("") + '</select></label><label>Team<select data-q="t">' + opt("", "All teams", tm) +
      Object.keys(H.W.T || {}).sort().map(function (t) { return opt(t, team(t).name, tm); }).join("") + '</select></label><label>Search<input type="search" data-q="q" value="' + esc(q.q || "") + '" placeholder="Player"></label>' +
      '<label>Players<select data-q="all">' + opt("", "Regulars (" + TRK.qual.min + "+ min)", all ? "1" : "") + opt("1", "Everyone", all ? "1" : "") + "</select></label></div>";
    var th = function (c) { return '<th><a href="' + href("track", Object.assign({}, q, { s: c[0] })) + '"' + (c[0] === sort ? ' class="on"' : "") + (c[3] ? ' title="' + esc(c[3]) + '"' : "") + ">" + c[1] + "</a></th>"; };
    html += tablePanel(V.name, "<th>Player</th><th class=\"hm\">Team</th><th class=\"hm\">GP</th><th class=\"hm\">MIN</th>" + V.cols.map(th).join(""),
      rows.slice(0, 200).map(function (r) { var d = r.d; return "<tr><td>" + trkName(r.id, d) + '</td><td class="tm hm">' + logo(d.t, 18) + '<span class="nm">' + esc(d.t) + '</span></td><td class="hm">' + (d.gp || "—") + '</td><td class="hm">' + f1(d.min) + "</td>" + V.cols.map(function (c) { return trkCell(d, c); }).join("") + "</tr>"; }).join(""),
      rows.length + " players" + (rows.length > 200 ? ", top 200 shown" : ""), "trkt");
    var trkAge = TRK.pulled ? (Date.now() - Date.parse(TRK.pulled)) / 864e5 : null;
    if (trkAge != null && trkAge > 9) html = html.replace('<div class="controls">', '<p class="fresh">These numbers are ' + Math.floor(trkAge) + " days old: the weekly pull (it runs through David's browser, since the NBA blocks cloud servers) has missed. They'll catch up on the next one.</p><div class=\"controls\">");
    html += '<p class="note">From <a href="https://www.nba.com/stats/players/speed-distance" rel="noopener">NBA.com tracking</a>, pulled ' + esc(String(TRK.pulled || "").slice(0, 10)) + " (it refreshes weekly). Percentages are shown as percents, and sort and rank only players with enough attempts this season (25 catch-and-shoot threes, 35 pull-ups, 40 drives, 40 rim shots defended).</p>";
    view.innerHTML = html;
  }
  // the team's players in the tracking data, a column or two from each view
  function teamTracking(code) {
    if (!TRK) { loadTrack(); return ""; }
    var cols = [["dist", "Miles", 1], ["spd", "Speed", 2], ["drv", "Drives", 1], ["tch", "Touches", 1], ["pot_ast", "Pot. ast", 1], ["cs3a", "C&S 3PA", 1], ["cs3", "C&S 3P%", "p"], ["defl", "Deflections", 1], ["contest", "Contests", 1], ["rim_fg", "Opp. rim FG%", "p"]];
    var ids = Object.keys(TRK.p).filter(function (id) { var hp = TRK.hub[id] && H.W.P[TRK.hub[id]]; return (hp ? hp.t : TRK.p[id].t) === code && (TRK.p[id].gp || 0) >= 3; })
      .sort(function (a, b) { return (TRK.p[b].min || 0) - (TRK.p[a].min || 0); });
    if (!ids.length) return "";
    return tablePanel("Player tracking", "<th>Player</th><th class=\"hm\">MIN</th>" + cols.map(function (c) { return "<th>" + c[1] + "</th>"; }).join(""),
      ids.map(function (id) { var d = TRK.p[id]; return "<tr><td>" + trkName(id, d) + "</td><td class=\"hm\">" + f1(d.min) + "</td>" + cols.map(function (c) { return trkCell(d, c); }).join("") + "</tr>"; }).join(""),
      'Per game this season, shaded by percentile among regulars. <a href="' + href("track", { t: code }) + '">More</a>', "trkt");
  }
  function trackPane(p) {
    if (!TRK) return '<p class="note">Loading tracking…</p>';
    var id = (p.adv && p.adv.nba) || TRK.of[p.id] || (TRK.dl || {})[p.id], d = id && TRK.p[String(id)];
    if (!d) return '<p class="note">No tracking numbers for him this season yet.</p>';
    var bars = function (keys) {
      return keys.map(function (k) {
        var c = null; Object.keys(TRK_VIEWS).some(function (vk) { c = TRK_VIEWS[vk].cols.filter(function (x) { return x[0] === k; })[0]; return c; });
        var v = (d.pct || {})[k], val = d.x[TRK.ix[k]];
        if (v == null || !c) return null;
        return { label: c[1], sub: trkFmt(val, c[2]) + (c[2] === "p" ? "%" : ""), pct: v };
        return '<div class="svb"' + (c[3] ? ' title="' + esc(c[3]) + '"' : "") + "><span>" + c[1] + ' <small style="font-weight:600;color:var(--faint)">' + trkFmt(val, c[2]) + (c[2] === "p" ? "%" : "") + '</small></span><i><em style="width:' + Math.max(4, v) + "%;background:" + trkColor(v) + '"></em><b style="left:calc(' + Math.max(4, v) + "% - 13px);background:" + trkColor(v) + ";color:" + (v >= 80 || v <= 20 ? "#fff" : "var(--ink)") + '">' + v + "</b></i></div>";
      }).filter(Boolean);
    };
    var sec = function (title, keys) { var b = bars(keys); return b.length ? window.PCard.sec(title) + window.PCard.bars(b) : ""; };
    return '<p class="note">' + d.gp + " games, " + f1(d.min) + " minutes a game. Percentile among regulars (" + TRK.qual.min + "+ minutes): red is good, blue is bad.</p>" +
      sec("Movement", ["dist", "spd"]) + sec("Creating", ["drv", "drv_pts", "drv_fg", "tch", "pot_ast", "ast_pts"]) + sec("Shooting", ["cs3a", "cs3", "pu_fga", "pu3"]) + sec("Defense & hustle", ["rim_fga", "rim_fg", "contest", "defl", "loose", "boxouts", "reb_con", "scr_pts"]) +
      '<p class="note"><a href="' + href("track", {}) + '">Full tracking leaderboards</a>. From NBA.com, pulled ' + esc(String(TRK.pulled || "").slice(0, 10)) + ".</p>";
  }
  function ratingsPage() {
    var A = H.adv;
    if (!A) { view.innerHTML = '<h2 class="sec">Ratings</h2><p class="lede">The skill ratings haven\'t loaded. They rebuild daily; try again in a bit.</p>'; return; }
    var q = state.q, by = A.cats[q.by] ? q.by : "overall", vs = q.vs === "pos" ? "rp" : "r", pos = q.pos || "", tm = q.t || "", all = q.all === "1";
    var opt = function (v, l, cur) { return '<option value="' + v + '"' + (v === cur ? " selected" : "") + ">" + l + "</option>"; };
    var pool = A.players.filter(function (r) { return all || r.q; });
    var hasPos = function (r) { return !pos || advPos(r).split("/").indexOf(pos) >= 0; };
    var list = pool.filter(function (r) {
      if (!hasPos(r)) return false;
      if (tm && r.t !== tm) return false;
      if (q.s && r.n.toLowerCase().indexOf(q.s.toLowerCase()) < 0) return false;
      if (q.a && r.arch !== q.a) return false;
      return true;
    }).sort(function (a, b) { return ((b[vs][by] == null ? -1 : b[vs][by]) - (a[vs][by] == null ? -1 : a[vs][by])) || ((b.s.imp || -9) - (a.s.imp || -9)); });
    var link = function (extra) { return href("ratings", Object.assign({}, q, { pg: null }, extra)); };
    var html = '<h2 class="sec">Ratings</h2><p class="lede">Every player\'s game in twelve skills, as percentiles among the ' + A.pool + " players with real minutes. 99 is best.</p>";
    // leaders: top three in each category
    html += '<div class="leaders">' + Object.keys(A.cats).map(function (c) {
      var top = pool.filter(hasPos).slice().sort(function (a, b) { return (b[vs][c] || 0) - (a[vs][c] || 0) || (b.s.imp || -9) - (a.s.imp || -9); }).slice(0, 3);
      return '<div class="ldr' + (c === by ? " on" : "") + '"><a class="ldr-h" href="' + link({ by: c === "overall" ? null : c }) + '">' + esc(A.cats[c]) + "</a><ol>" +
        top.map(function (r) { return "<li>" + advName(r, 20) + "</li>"; }).join("") + "</ol></div>";
    }).join("") + "</div>";
    var archs = {};
    pool.forEach(function (r) { archs[r.arch] = (archs[r.arch] || 0) + 1; });
    html += '<div class="controls">' +
      '<label>Rank by<select data-q="by">' + Object.keys(A.cats).map(function (c) { return opt(c === "overall" ? "" : c, A.cats[c], by === "overall" ? "" : by); }).join("") + "</select></label>" +
      '<label>Position<select data-q="pos">' + opt("", "All", pos) + ["PG", "SG", "SF", "PF", "C"].map(function (x) { return opt(x, x, pos); }).join("") + "</select></label>" +
      teamSelect(tm) +
      '<label>Type<select data-q="a">' + opt("", "Any", q.a || "") + Object.keys(archs).sort().map(function (a) { return opt(a, (ARCH[a] ? ARCH[a][0] + ": " : "") + a + " (" + archs[a] + ")", q.a || ""); }).join("") + "</select></label>" +
      '<label>Percentiles vs<select data-q="vs">' + opt("", "League", q.vs || "") + opt("pos", "Position group", q.vs || "") + "</select></label>" +
      '<label>Search<input type="search" data-q="s" value="' + esc(q.s || "") + '" placeholder="Player"></label>' +
      '<label class="chk"><input type="checkbox" data-q="all" value="1"' + (all ? " checked" : "") + "> Low minutes too</label></div>";
    var cols = ["off", "def"].concat(CAT_OFF, CAT_DEF);
    var th = function (c, label, cls) { return '<th class="' + (cls || "hc") + (c === by ? " on" : "") + '"><a href="' + link({ by: c === "overall" ? null : c }) + '" title="' + esc(A.cats[c]) + '">' + (label || CAT_SHORT[c]) + "</a></th>"; };
    var pages = Math.max(1, Math.ceil(list.length / PER)), pg = Math.min(pages, Math.max(1, +q.pg || 1)), start = (pg - 1) * PER;
    html += '<div class="panel"><div class="scroll"><table class="t rt"><thead><tr><th class="pn">Player</th><th class="hm">Pos</th><th class="hm">Age</th><th class="hm" title="Minutes this season">Min</th><th class="hm">Type</th>' + th("overall", "Impact", "imp") + cols.map(function (c) { return th(c); }).join("") + "</tr></thead><tbody>";
    list.slice(start, start + PER).forEach(function (r, k) {
      html += '<tr><td class="pn"><span class="rk">' + (start + k + 1) + "</span>" + (r.t ? '<span class="rtlogo">' + logo(r.t, 16) + "</span>" : "") + advName(r, 22) + '</td><td class="hm ps">' + esc(advPos(r)) + '</td><td class="hm">' + (r.age != null ? Math.floor(r.age) : "—") + '</td><td class="hm mn">' + r.mc + '</td><td class="hm">' + archBadge(r.arch) + '</td><td class="imp">' + (r.s.imp != null ? rchip(r.s.imp) : "—") + "</td>" +
        cols.map(function (c) { return hcell(r[vs][c], A.cats[c] + ": " + ord(r.r[c]) + " in the league, " + ord(r.rp[c]) + " among " + GROUP1[r.g]); }).join("") + "</tr>";
    });
    if (!list.length) html += '<tr><td class="note" colspan="16">Nobody matches.</td></tr>';
    html += "</tbody></table></div></div>";
    if (pages > 1) {
      html += '<nav class="pager" aria-label="Pages">' + (pg > 1 ? '<a class="btn" href="' + link({ pg: pg - 1 }) + '">Previous</a>' : '<span class="btn off">Previous</span>') +
        "<span>" + (start + 1) + "-" + Math.min(list.length, start + PER) + " of " + list.length + "</span>" +
        (pg < pages ? '<a class="btn" href="' + link({ pg: pg + 1 }) + '">Next</a>' : '<span class="btn off">Next</span>') + "</nav>";
    }
    html += '<p class="note">Impact is points per 100 possessions better than average (DARKO, or box plus-minus where DARKO has no number). Hover a cell for league and position-group ranks, or an icon for the player type. Updated ' + esc(A.updated.replace("T", " ").replace("Z", " UTC")) + ". How it works explains every category.</p>";
    html += '<h3 class="keyh">Player types</h3>' + archKey();
    view.innerHTML = html;
  }
  // shot chart and skill bars for the player card
  var zoneInv = false;
  function zoneColor(z) { if (!z || z[1] == null) return "z-n"; var d = (z[1] - z[2]) * (zoneInv ? -1 : 1); return d >= 0.06 ? "z5" : d >= 0.02 ? "z4" : d > -0.02 ? "z3" : d > -0.06 ? "z2" : "z1"; }
  function shotChart(zs) {
    var lab = function (k, x, y) {
      var z = zs[k]; if (!z) return "";
      return '<text x="' + x + '" y="' + y + '" class="zl">' + (z[1] == null ? "—" : Math.round(z[1] * 100) + "%") + '</text><text x="' + x + '" y="' + (y + 17) + '" class="zf">' + Math.round(z[0] * 100) + "% of shots</text>";
    };
    return '<div class="shot"><svg viewBox="0 0 500 330" role="img" aria-label="Shot chart: field goal percentage by zone">' +
      '<rect width="500" height="330" class="zw ' + zoneColor(zs.a3) + '"/>' +
      '<rect x="0" y="0" width="30" height="141.5" class="' + zoneColor(zs.c3) + '"/><rect x="470" y="0" width="30" height="141.5" class="' + zoneColor(zs.c3) + '"/>' +
      '<path d="M30,0 L30,141.5 A237.5,237.5 0 0 0 470,141.5 L470,0 Z" class="' + zoneColor(zs.lmid) + '"/>' +
      '<path d="M120,0 A140,140 0 1 0 380,0 Z" class="' + zoneColor(zs.smid) + '"/>' +
      '<circle cx="250" cy="52" r="58" class="' + zoneColor(zs.rim) + '"/>' +
      '<g class="cl"><path d="M30,0 L30,141.5 A237.5,237.5 0 0 0 470,141.5 L470,0"/><path d="M120,0 A140,140 0 1 0 380,0"/><circle cx="250" cy="52" r="58"/><line x1="220" y1="40" x2="280" y2="40"/><circle cx="250" cy="52" r="9"/></g>' +
      lab("rim", 250, 62) + lab("smid", 250, 150) + lab("lmid", 250, 222) + lab("a3", 250, 288) +
      (zs.c3 ? '<text x="12" y="320" class="zf sm">Corner 3s: ' + (zs.c3[1] == null ? "—" : Math.round(zs.c3[1] * 100) + "%") + ", " + Math.round(zs.c3[0] * 100) + "% of shots</text>" : "") +
      '</svg><div class="zkey"><span class="z1"></span>Well below average<span class="z3"></span>Average<span class="z5"></span>Well above</div></div>';
  }
  function zoneTable(zs) {
    var nm = { rim: "At the rim", smid: "Short mid-range", lmid: "Long mid-range", c3: "Corner 3", a3: "Above-the-break 3" };
    return '<div class="scroll"><table class="t"><thead><tr><th>Zone</th><th>Share</th><th>FG%</th><th>NBA avg</th></tr></thead><tbody>' +
      ["rim", "smid", "lmid", "c3", "a3"].filter(function (k) { return zs[k]; }).map(function (k) {
        var z = zs[k], d = z[1] == null ? null : z[1] - z[2];
        return "<tr><td>" + nm[k] + "</td><td>" + pct(z[0]) + "</td><td class=\"" + (d == null ? "" : d >= 0 ? "pos" : "neg") + "\"><b>" + (z[1] == null ? "—" : pct(z[1], 1)) + "</b></td><td>" + pct(z[2], 1) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  function skillBars(r) {
    var A = H.adv, P = window.PCard;
    var rows = function (cs) { return P.bars(cs.map(function (c) { return { label: A.cats[c], sub: r.rp[c] == null ? "" : ord(r.rp[c]) + " of " + GROUP1[r.g], pct: r.r[c] }; })); };
    return P.sec("Impact", "percentile, then rank among " + GROUP1[r.g]) + rows(CAT_IMP) + P.sec("Offense") + rows(CAT_OFF) + P.sec("Defense") + rows(CAT_DEF);
  }



  // ---------- trade value ----------
  // Page filters stay in view; the model's knobs fold into "Model settings" (open state remembered)
  function controls(extra) {
    var sum = (H.cfg.mode === "market" ? "Market" : "Production") + ", " + Math.round(H.cfg.disc * 100) + "% discount, " + H.cfg.convex + "x stars, " + Math.round(H.cfg.growth * 100) + "% growth, " + Math.round((H.cfg.salW ?? 1) * 100) + "% salary" + (H.cfg.vblend === "imp" ? ", impact only" : "") + (Object.keys(H.adj || {}).length ? ", " + Object.keys(H.adj).length + " of your reads" : "");
    return '<div class="controls">' + (extra || "") + '<details class="msets"' + (load("msets", false) ? " open" : "") + '><summary>Model settings <span>' + esc(sum) + '</span></summary><div class="msets-b">' +
      '<label title="Production: what he should produce, priced off the cap. Market: what teams would pay him (the market model, capped at the max)">Value as<select data-cfg="mode"><option value="prod"' + (H.cfg.mode !== "market" ? " selected" : "") + '>Production</option><option value="market"' + (H.cfg.mode === "market" ? " selected" : "") + ">Market price</option></select></label>" +
      '<label title="Each later season counts this much less. 7% matches the cap\'s growth, so values read in today\'s cap dollars">Discount %<input type="number" step="1" min="0" max="20" data-cfg="disc" value="' + (H.cfg.disc * 100).toFixed(0) + '"></label>' +
      '<label title="How much more a star\'s impact is worth than the same impact spread across role players. 1.0 is linear (minutes times impact); higher favors stars">Star premium<select data-cfg="convex">' + [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5].map(function (v) { return '<option value="' + v + '"' + (H.cfg.convex === v ? " selected" : "") + ">" + v.toFixed(2) + "</option>"; }).join("") + "</select></label>" +
      '<label title="What a player\'s value rating counts. Impact only, or impact mixed with his box score (Game Score per 100) and his spot in the Ringer\'s Top 100. Win projections always use impact">Value counts<select data-cfg="vblend">' + [["imp", "Impact only"], ["bal", "Impact, box, Ringer"], ["box", "More box score"], ["con", "More Ringer"]].map(function (o) { return '<option value="' + o[0] + '"' + (H.cfg.vblend === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>" +
      '<label title="Share of a young player\'s projected improvement that counts in his value">Growth counted<select data-cfg="growth">' + [0, 0.25, 0.5, 0.75, 1].map(function (v) { return '<option value="' + v + '"' + (H.cfg.growth === v ? " selected" : "") + ">" + (v * 100) + "%</option>"; }).join("") + "</select></label>" +
      '<label title="What a dollar of salary costs a team in value. Teams must spend to the salary floor and unused cap room disappears, so recent trades price salary at about half to three quarters of face value. 100% counts every dollar">Salary weight<select data-cfg="salW">' + [0.25, 0.5, 0.75, 1].map(function (v) { return '<option value="' + v + '"' + ((H.cfg.salW ?? 1) === v ? " selected" : "") + ">" + (v * 100) + "%</option>"; }).join("") + "</select></label></div>" + adjList() + "</details></div>";
  }
  function adjList() {
    var ids = Object.keys(H.adj || {});
    if (!ids.length) return "";
    return '<div class="adjs"><b>Your reads:</b> ' + ids.map(function (id) { var p = H.W.P[id]; return p ? '<span class="pl" data-p="' + esc(id) + '"><span class="nm">' + esc(p.n) + "</span></span> " + (H.adj[id] > 0 ? "+" : "") + H.adj[id] : ""; }).join(", ") + ' <button type="button" class="btn sm" data-adjclear>Clear all</button></div>';
  }
  view.addEventListener("click", function (e) {
    if (!e.target.closest("[data-adjclear]")) return;
    Object.keys(H.adj).forEach(function (id) { H.setAdj(id, 0); }); saveAdj(); render();
  });
  view.addEventListener("toggle", function (e) { if (e.target.classList && e.target.classList.contains("msets")) save("msets", e.target.open); }, true);
  view.addEventListener("change", function (e) {
    var c = e.target.closest("[data-cfg]");
    if (!c) return;
    var k = c.dataset.cfg, v = k === "mode" || k === "vblend" ? c.value : k === "convex" || k === "growth" || k === "salW" ? +c.value : +c.value / 100;
    if (k !== "mode" && k !== "vblend" && isNaN(v)) return;
    H.set(k, v); save(k === "convex" ? "convex3" : k === "salW" ? "salW2" : k, v);
    render();
  });
  view.addEventListener("change", function (e) {
    var c = e.target.closest("[data-q]");
    if (!c) return;
    var q = Object.assign({}, state.q);
    q[c.dataset.q] = c.type === "checkbox" ? (c.checked ? c.value : null) : c.value || null;
    location.hash = href(state.route, q);
  });
  function teamSelect(cur, key) {
    return '<label>Team<select data-q="' + (key || "t") + '"><option value="">All teams</option>' + H.codes.slice().sort(function (a, b) { return team(a).name.localeCompare(team(b).name); }).map(function (c) { return '<option value="' + c + '"' + (c === cur ? " selected" : "") + ">" + esc(team(c).name) + "</option>"; }).join("") + "</select></label>";
  }
  // ---------- rankings: our value rating against the Ringer's Top 100 ----------
  function rankPage() {
    var q = state.q, tm = q.t || "", sort = q.sort || "", only = q.r === "1", V = H.valRanks(), rg = H.ringer;
    var opt = function (v, l, cur) { return '<option value="' + v + '"' + (v === cur ? " selected" : "") + ">" + l + "</option>"; };
    var rows = H.players().filter(function (p) { var o = V[p.id]; return o && (o.gs != null || o.cR) && (o.vR <= 200 || o.cR); }).map(function (p) { return { p: p, o: V[p.id] }; });
    var html = '<h2 class="sec">Rankings</h2><p class="lede">Our value rating next to the Ringer\'s Top 100' + (rg ? " (" + esc(fmtShort(rg.updated)) + ")" : "") + ". The value rating mixes impact, box score and the Ringer, and it\'s what prices every contract. " + howLink() + ".</p>";
    var gap = function (x) { return x.o.cR ? x.o.iR - x.o.cR : null; };
    var big = rows.filter(function (x) { return x.o.cR && x.o.cR <= 50 && x.p.adv && x.p.adv.mp >= 400; });
    var rHigh = big.slice().sort(function (a, b) { return gap(b) - gap(a); }).slice(0, 8);
    var nHigh = rows.filter(function (x) { return x.o.iR <= 50; }).map(function (x) { return { p: x.p, o: x.o, g: (x.o.cR || 130) - x.o.iR }; }).sort(function (a, b) { return b.g - a.g; }).slice(0, 8);
    var line = function (x, txt) { return pname(x.p, 20) + ' <span class="note">' + txt + "</span>"; };
    html += '<div class="two">' + listPanel("The Ringer likes more", rHigh, function (x) { return line(x, "Ringer " + x.o.cR + ", impact " + x.o.iR); }, "Ringer's top 50 vs. our impact rank") +
      listPanel("The numbers like more", nHigh, function (x) { return line(x, "impact " + x.o.iR + ", " + (x.o.cR ? "Ringer " + x.o.cR : "not in the Top 100")); }, "Our top 50 by impact") + "</div>";
    html += controls(teamSelect(tm) + '<label>Sort<select data-q="sort">' + opt("", "Value rating", sort) + opt("imp", "Impact", sort) + opt("box", "Box score", sort) + opt("rg", "Ringer", sort) + opt("gap", "Biggest gaps", sort) + "</select></label>" +
      '<label class="chk"><input type="checkbox" data-q="r" value="1"' + (only ? " checked" : "") + "> Top 100 only</label>");
    rows = rows.filter(function (x) { return (!tm || x.p.t === tm) && (!only || x.o.cR); });
    var key = { "": function (o) { return o.vR; }, imp: function (o) { return o.iR; }, box: function (o) { return o.bR || 999; }, rg: function (o) { return o.cR || 999; }, gap: function (o) { return o.cR ? -Math.abs(o.iR - o.cR) : 999; } }[sort] || function (o) { return o.vR; };
    rows.sort(function (a, b) { return key(a.o) - key(b.o); });
    var rk = function (n, cur) { return n ? (cur ? "<b>" + n + "</b>" : String(n)) : '<span class="note">—</span>'; };
    var body = rows.slice(0, 150).map(function (x) {
      var o = x.o, g = gap(x);
      return "<tr><td>" + pname(x.p, 20) + "</td><td>" + logo(x.p.t, 18) + "</td><td>" + x.p.age + "</td><td>" + rchip(o.val) + (o.adj ? ' <span class="note" title="Includes your read (' + (o.adj > 0 ? "+" : "") + o.adj + ')">yours</span>' : "") + "</td><td>" + rk(o.vR, !sort) + "</td><td>" + rk(o.iR, sort === "imp") + "</td><td" + (o.gs != null ? ' title="Game Score ' + f1(o.gs) + ' per 100"' : "") + ">" + rk(o.bR, sort === "box") + "</td><td>" + rk(o.cR, sort === "rg") +
        '</td><td title="Our impact rank minus the Ringer rank">' + (g == null ? "" : (g > 0 ? "+" : "") + g) + "</td></tr>";
    }).join("");
    html += tablePanel("Value rating", '<th>Player</th><th>Team</th><th>Age</th><th title="Impact, box score and Ringer, on the impact scale">Rating</th><th>Ours</th><th title="Impact (Banner, BPM, DARKO)">Impact</th><th title="Game Score per 100 possessions">Box</th><th>Ringer</th><th title="Our impact rank minus the Ringer rank. Plus: the Ringer is higher">Gap</th>', body, rows.length > 150 ? "Top 150 shown" : "", "trank");
    view.innerHTML = html;
  }

  function valuePage() {
    var q = state.q, kind = q.k || "players", tm = q.t || "", sk = q.sort || "tv";
    if (sk === "worst") sk = "tv-asc";
    var opt = function (v, l, cur) { return '<option value="' + v + '"' + (v === cur ? " selected" : "") + ">" + l + "</option>"; };
    var html = '<h2 class="sec">Contracts and value</h2><p class="lede">What every player is worth over his contract, against what he\'s paid, and what that makes him worth in a trade. ' + howLink() + ' explains the settings.</p>';
    html += controls(teamSelect(tm) + '<label>Show<select data-q="k">' + opt("players", "Players", kind) + opt("picks", "Draft picks", kind) + "</select></label>" +
      (kind === "players" ? '<label>Sort<select data-q="sort">' + opt("", "Best trade value", q.sort || "") + opt("tv-asc", "Worst trade value", q.sort || "") + opt("sur", "Most surplus", q.sort || "") + opt("sur-asc", "Worst surplus", q.sort || "") + "</select></label>" +
        '<label>Search<input type="search" data-q="s" value="' + esc(q.s || "") + '" placeholder="Player"></label>' : ""));
    if (kind === "picks") {
      var picks = H.W.picks.filter(function (pk) { return pk.owner !== "OUT" && (!tm || pk.owner === tm) && (tm || pk.r === 1 || pk.y <= 2028); })
        .map(function (pk) { return { pk: pk, v: H.pickValue(pk) }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 150);
      html += tablePanel("Draft picks", "<th>Pick</th><th>Owner</th><th>Proj. slot</th><th>Conveys</th><th>Value</th><th>Notes</th>", picks.map(function (x, k) {
        var info = H.pickInfo(x.pk);
        return "<tr><td>" + (k + 1) + ". " + logo(x.pk.from, 16) + " " + esc(H.pickName(x.pk)) + "</td><td>" + logo(x.pk.owner, 16) + " " + esc(team(x.pk.owner).short) + "</td><td>" + f1(info.avg) + "</td><td>" + (x.pk.prot ? pct(info.conveys) : "") + "</td><td><b>" + money(x.v) + '</b></td><td class="note" style="text-align:left;white-space:normal">' + esc(x.pk.note || "") + "</td></tr>";
      }).join(""), tm ? "" : "Second-rounders after 2028 left off; pick a team to see all of its picks");
      view.innerHTML = html;
      return;
    }
    var list = H.valueBoard().filter(function (x) {
      if (tm && x.p.t !== tm) return false;
      if (q.s && x.p.n.toLowerCase().indexOf(q.s.toLowerCase()) < 0) return false;
      return true;
    });
    // every column sorts: click a header for its best first, again for its worst first
    var disc = function (x, f) { return x.s.rows.reduce(function (a, r) { return a + f(r) * Math.pow(1 + H.cfg.disc, -r.j); }, 0); };
    list.forEach(function (x) { x.v = disc(x, function (r) { return r.value; }); x.c = disc(x, function (r) { return r.sal; }); });
    var keyOf = { tv: function (x) { return x.tv; }, sur: function (x) { return x.v - x.c; }, val: function (x) { return x.v; }, sal: function (x) { return x.c; }, age: function (x) { return -x.p.age; }, rt: function (x) { return H.valRating(x.p, 0); } };
    var base = sk.replace(/-asc$/, ""), asc = /-asc$/.test(sk), kf = keyOf[base] || keyOf.tv;
    list = list.slice().sort(function (a, b) { return asc ? kf(a) - kf(b) : kf(b) - kf(a); }).slice(0, 150);
    var first = H.medianFirst ? H.medianFirst() : 0;
    var th = function (k, label, tip) { var on = base === k, nx = on && !asc ? k + "-asc" : k; return '<th class="srt' + (on ? " on" : "") + '"' + (on ? ' aria-sort="' + (asc ? "ascending" : "descending") + '"' : "") + (tip ? ' title="' + esc(tip) + '"' : "") + '><a href="' + href("value", Object.assign({}, q, { sort: nx === "tv" ? null : nx })) + '">' + label + "</a></th>"; };
    html += '<div class="panel"><div class="scroll"><table class="t tval"><thead><tr><th>Player</th><th>Team</th><th>Pos</th>' + th("age", "Age") + th("rt", "Rating", "Value rating: impact, box score and the Ringer. What prices the contract") + "<th>Thru</th>" + th("val", "Value") + th("sal", "Salary") + th("sur", "Surplus", "Value minus salary, every dollar counted") + th("tv", "Trade value", "Value minus salary at the trade-market weight, plus restricted free agency for young players, with the production and market views averaged. A median first-round pick is worth about " + money(first) + " on this scale") + '</tr></thead><tbody>';
    list.forEach(function (x, k) {
      var p = x.p, s = x.s, v = x.v, c = x.c;
      var last = s.rows.length ? s.rows[s.rows.length - 1].season : "—";
      html += "<tr><td>" + (k + 1) + ". " + pname(p, 22) + "</td><td>" + logo(p.t, 18) + "</td><td>" + esc(posOf(p)) + "</td><td>" + p.age + "</td><td>" + rchip(H.valRating(p, 0)) + "</td><td>" + esc(last) + "</td><td>" + money(v) + "</td><td>" + money(c) +
        '</td><td class="' + (v - c >= 0 ? "pos" : "neg") + '">' + signed(v - c) + '</td><td class="' + (x.tv >= 0 ? "pos" : "neg") + '"' + (first > 0 ? ' title="About ' + Math.abs(x.tv / first).toFixed(1) + " median firsts" + (x.tv < 0 ? " to move" : "") + '"' : "") + "><b>" + signed(x.tv) + "</b></td></tr>";
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
      var m = /^([pkcs]):([^~]+)(?:~([a-e]))?$/.exec(s);
      if (!m) return;
      if (m[1] === "p" && (!H.W.P[m[2]] || (tr.sides[k] && H.W.P[m[2]].t !== tr.sides[k]))) return;          // he's moved on since the link was made
      if (m[1] === "k" && (!H.pickById(m[2]) || (tr.sides[k] && H.pickById(m[2]).owner !== tr.sides[k]))) return;
      if (m[1] === "s" && (!/^\d{4}-[12]-[A-Z]{3}$/.test(m[2]) || (tr.sides[k] && m[2].slice(-3) !== tr.sides[k]))) return;
      tr.assets.push({ kind: m[1], id: m[2], from: k, to: m[3] ? L5.indexOf(m[3]) : -1 });
    });
    return tr;
  }
  function destOf(tr, a) { return a.to >= 0 && a.to !== a.from && a.to < tr.sides.length ? a.to : (a.from + 1) % tr.sides.length; }
  function pickOf(id) { return H.pickById(id); }
  function poss(n) { return /s$/.test(n) ? n + "'" : n + "'s"; }
  function swapFor(tr, a) { return H.swapOf({ kind: "s", id: a.id, from: tr.sides[a.from], to: tr.sides[destOf(tr, a)] }); }
  function baseId(id) { return String(id).split("@")[0]; }
  // Salary matching at a glance: what comes in against what the rules let this team take back
  function gauge(r) {
    if (!r.inSal && !r.outSal) return "";
    var room = r.P2 <= CBA.cap(0), max = room ? null : r.outSal > 0 ? H.matchMax(r.outSal, r.post) : 0;
    var top = Math.max(r.inSal, max || 0, 1) * 1.08, ok = room || r.inSal <= (max || 0) + 1;
    return '<div class="gauge ' + (ok ? "ok" : "bad") + '"><div class="gbar"><b style="width:' + (r.inSal / top * 100).toFixed(1) + '%"></b>' + (max != null ? '<i style="left:' + (max / top * 100).toFixed(1) + '%" title="Most it can take back"></i>' : "") + "</div><small>" +
      (room ? "Takes back " + money(r.inSal) + " into cap room" : "Takes back <b>" + money(r.inSal) + "</b> of " + money(max) + " allowed" + (ok ? "" : ": " + money(r.inSal - max) + " too much")) + "</small></div>";
  }
  // When a deal fails, look for one or two roster players a team could add that make it legal, including players who
  // only become tradable later (shown with the date)
  function fixes(tr, chk) {
    var out = [], fail = tr.sides.filter(function (c) { return !chk.teams[c].ok; });
    var base = tr.assets.map(function (a) { return { kind: a.kind, id: a.id, amt: a.kind === "c" ? +a.id : 0, from: tr.sides[a.from], to: tr.sides[destOf(tr, a)] }; });
    var used = {}; tr.assets.forEach(function (a) { used[a.kind + ":" + a.id] = 1; });
    var budget = 160, seen = {};
    var tryAdd = function (k, to, players) {
      if (budget-- <= 0) return;
      var key = k + ">" + players.map(function (p) { return p.id; }).sort().join(",");
      if (seen[key]) return; seen[key] = 1;
      var mv = base.concat(players.map(function (p) { return { kind: "p", id: p.id, amt: 0, from: tr.sides[k], to: tr.sides[to] }; }));
      var t = H.checkTrade({ teams: tr.sides, moves: mv });
      if (!t.ok) return;
      var after = tr.sides.map(function (c) { return t.teams[c].after; }).filter(Boolean).sort().pop() || null;
      var waive = tr.sides.reduce(function (a, c) { return a + (t.teams[c].waive || 0); }, 0);
      out.push({ k: k, to: to, players: players, after: after, waive: waive, sal: players.reduce(function (a, p) { return a + H.salary(p, 0); }, 0), cost: players.reduce(function (a, p) { return a + Math.max(0, H.surplus(p).pv); }, 0) });
    };
    tr.sides.forEach(function (c, k) {
      var partner = tr.sides.map(function (x, j) { return j; }).filter(function (j) { return j !== k; })
        .sort(function (a, b) { return (fail.indexOf(tr.sides[b]) >= 0) - (fail.indexOf(tr.sides[a]) >= 0); })[0];
      var pool = Object.values(H.W.P).filter(function (p) { return p.t === c && !p.two && H.salary(p, 0) > 0 && !used["p:" + p.id]; }).sort(function (a, b) { return H.salary(a, 0) - H.salary(b, 0); });
      pool.forEach(function (p) { tryAdd(k, partner, [p]); });
      var mid = pool.filter(function (p) { return H.salary(p, 0) >= 2e6; }).slice(-10);
      for (var x = 0; x < mid.length; x++) for (var y = x + 1; y < mid.length; y++) tryAdd(k, partner, [mid[x], mid[y]]);
    });
    if (!out.length) return "";
    // a pair that includes a player who works alone adds nothing
    var soloOK = {}; out.forEach(function (f) { if (f.players.length === 1) soloOK[f.k + ":" + f.players[0].id] = 1; });
    out = out.filter(function (f) { return f.players.length === 1 || !f.players.some(function (p) { return soloOK[f.k + ":" + p.id]; }); });
    // fewest players, available now, no waivers, least salary
    out.sort(function (a, b) { return (a.players.length - b.players.length) || ((a.after ? 1 : 0) - (b.after ? 1 : 0)) || (a.waive - b.waive) || (a.cost - b.cost) || (a.sal - b.sal); });
    var pick = [], singles = 0, pairs = 0;
    out.forEach(function (f) { if (f.players.length === 1 ? singles < 3 : pairs < 3) { pick.push(f); if (f.players.length === 1) singles++; else pairs++; } });
    return '<div class="fixes"><b>Ways to make it work</b>' + pick.map(function (f) {
      return '<button type="button" class="fixbtn" data-picks="' + esc(f.players.map(function (p) { return "p:" + p.id; }).join(",")) + '" data-side="' + f.k + '" data-to="' + f.to + '">' + logo(tr.sides[f.k], 16) + " " + esc(team(tr.sides[f.k]).short) + " add " + f.players.map(function (p) { return esc(p.n) + " (" + money(H.salary(p, 0)) + ")"; }).join(" + ") +
        (f.after ? ' <span class="pill warn">after ' + esc(fmtShort(f.after)) + "</span>" : "") + (f.waive ? ' <span class="pill">waive ' + f.waive + "</span>" : "") + "</button>";
    }).join("") + "</div>";
  }
  function assetLine(a, tr, k, outgoing) {
    var to = destOf(tr, a), right = "", sub = "", label, protSel = "";
    if (a.kind === "p") {
      var p = H.W.P[a.id], last = H.lastYear(p), left = 0;
      for (var j = 0; j <= last; j++) left += H.salary(p, j);
      label = pname(p, outgoing ? 26 : 30);
      sub = esc(posOf(p)) + " · " + p.age + " · thru " + sname(last) + (p.c.opt && Object.keys(p.c.opt).length ? " (" + Object.keys(p.c.opt).map(function (j) { return p.c.opt[j] + " " + sname(+j).slice(2); }).join(", ") + ")" : "") + " · " + money(left) + " total";
      var kick = outgoing ? 0 : H.kicker(p);
      right = '<b class="sal">' + money(H.salary(p, 0) + kick) + "</b>";
      sub = esc(posOf(p)) + " · age " + p.age + " · " + rt(H.rating(p, 0)) + " impact · then " + esc(H.faKind(p)) + '<span class="minis">' + contractYears(p, 0).map(function (y) {
        return '<span class="mini' + (y.opt ? " o-" + y.opt : "") + '"><i>' + sname(y.j).slice(2) + (y.opt ? " " + CBA.OPT_SHORT[y.opt] : "") + "</i>" + money(y.sal) + "</span>";
      }).join("") + "</span>";
      if (kick) sub += ' · <span class="pill warn">includes ' + money(kick) + " trade kicker</span>";
    } else if (a.kind === "k") {
      var pk = pickOf(a.id), base = H.W.picks.find(function (x) { return x.id === baseId(a.id); });
      label = '<span class="pl static">' + logo(pk.from, 26) + '<span class="nm">' + esc(H.pickName(pk)) + "</span></span>";
      sub = "Projected slot " + f1(H.pickInfo(pk).avg) + (pk.note ? " · " + esc(pk.note) : "");
      if (outgoing && base && base.r === 1 && !base.prot) protSel = '<select class="protsel" data-prot="' + esc(baseId(a.id)) + '" aria-label="Protection" title="Protect the pick: if it lands in the range, it stays and turns into a second-rounder. The 3-2-1 lottery bars new top-12 to top-15 protections."><option value="">Unprotected</option>' + H.PROTECT.map(function (n) { return '<option value="' + n + '"' + (pk.newProt === n ? " selected" : "") + ">Top " + n + "</option>"; }).join("") + "</select>";
      right = '<b class="sal pick">Pick</b>';
    } else if (a.kind === "s") {
      var sw = swapFor(tr, a);
      label = '<span class="pl static">' + logo(sw.from, 26) + '<span class="nm">' + esc(sw.y + " " + (sw.r === 1 ? "1st" : "2nd") + "-round swap") + "</span></span>";
      sub = esc(team(sw.holder).short) + " can take " + esc(poss(team(sw.from).short)) + " " + sw.y + " pick in place of its own if it lands higher" + (sw.ok ? "" : ' · <b class="neg">' + esc(sw.why) + "</b>");
      right = '<b class="sal pick">Swap</b>';
    } else {
      label = '<span class="pl static"><span class="cashicon">$</span><span class="nm">Cash</span></span>';
      sub = "Counts against the " + money(CBA.cashLimit(0)) + " a season each team can send and receive";
      right = '<b class="sal">' + money(+a.id) + "</b>";
    }
    var dest = outgoing && tr.sides.length > 2 ? '<span class="dchips" role="group" aria-label="Sends to"><i>to</i>' + tr.sides.map(function (c, j) { return j === k || !c ? "" : '<button type="button" class="dchip' + (j === to ? " on" : "") + '" data-destto="' + esc(a.kind + ":" + a.id) + "|" + j + '" title="To ' + esc(team(c).short) + '" style="--tc:' + esc(team(c).color) + '">' + logo(c, 18) + "</button>"; }).join("") + "</span>" : "";
    var from = !outgoing ? '<span class="fromtag">' + logo(tr.sides[a.from], 14) + " from " + esc(team(tr.sides[a.from]).short) + "</span>" : "";
    if (outgoing && a.kind !== "s") sub = a.kind === "p" ? esc(posOf(H.W.P[a.id])) + ", thru " + sname(H.lastYear(H.W.P[a.id])) : a.kind === "k" ? "Projected slot " + f1(H.pickInfo(pickOf(a.id)).avg) + (pickOf(a.id).newProt ? ", conveys " + pct(H.pickInfo(pickOf(a.id)).conveys) : "") + protSel : "";
    return '<li class="asset' + (outgoing ? " out" : "") + '"' + (outgoing ? ' draggable="true" data-akey="' + esc(a.kind + ":" + a.id) + '"' : "") + ">" + label + right + '<div class="asub">' + sub + from + "</div>" + (outgoing ? '<div class="aact">' + dest + '<button class="xbtn" data-rm="' + esc(a.kind + ":" + a.id) + '" aria-label="Remove">×</button></div>' : "") + "</li>";
  }
  // The trade card: what each team gets, in its colors, with a verdict, the money and a grade
  function grade(v) {
    var m = v / 1e6;
    // bands set against Kevin Pelton's grades of the 2025-26 deadline deals: at half these widths the hub ran almost
    // two letter steps from his grades on average, at these widths about 1.3 (he rarely goes below C)
    return m >= 120 ? "A+" : m >= 70 ? "A" : m >= 40 ? "A-" : m >= 16 ? "B+" : m >= -16 ? "B" : m >= -40 ? "B-" : m >= -70 ? "C+" : m >= -120 ? "C" : m >= -200 ? "D" : "F";
  }
  function tile(a, tr, k) {
    var fitTag = "";
    if (a.kind === "p" && tr.sides[k]) { var ft = H.fit(H.W.P[a.id], tr.sides[k]); if (ft.fills.length) fitTag = '<span class="fitpill" title="Strong where ' + esc(team(tr.sides[k]).short) + '\'s rotation is weak">Fills a need: ' + ft.fills.map(function (x) { return H.FIT_NAME[x]; }).join(", ") + "</span>"; }
    var from = tr.sides.length > 2 ? '<span class="tfrom">' + logo(tr.sides[a.from], 14) + " from " + esc(team(tr.sides[a.from]).short) + "</span>" : "";
    var rm = '<button type="button" class="trm" data-rm="' + esc(a.kind + ":" + a.id) + '" aria-label="Take out of the trade" title="Take out of the trade">×</button>';
    if (a.kind === "p") {
      var p = H.W.P[a.id], last = H.lastYear(p), left = 0, kick = H.kicker(p);
      for (var j = 0; j <= last; j++) left += H.salary(p, j);
      var until = [p.tradeOk, p.noTrade].filter(function (d) { return d && H.asOf < d; }).sort().pop();
      var lock = until ? ' <span class="pill warn tlock" title="Can\'t be traded until then">' + esc(fmtShort(until)) + "</span>" : "";
      return '<div class="tile" data-p="' + esc(p.id) + '">' + face(p, 52) + '<div class="tl"><b>' + esc(p.n) + lock + injTag(p) + "</b><span>" + esc(posOf(p)) + ", " + p.age + " " + rchip(H.rating(p, 0)) + "</span><small>" + (last > 0 ? "Thru " + sname(last) + ", " + money(left) + " total" : "Expiring") + (H.faKind(p) === "RFA" ? ", then RFA" : "") + "</small>" + fitTag + from + '</div><div class="tsal">' + money(H.salary(p, 0) + kick) + (kick ? "<small>with kicker</small>" : "") + "</div>" + rm + "</div>";
    }
    if (a.kind === "k") {
      var pk = pickOf(a.id), info = H.pickInfo(pk);
      return '<div class="tile pk"><span class="tpk">' + logo(pk.from, 34) + '</span><div class="tl"><b>' + esc(H.pickName(pk)) + "</b><small>Projected slot " + f1(info.avg) + (pk.note ? ", " + esc(pk.note) : "") + "</small>" + from + '</div><div class="tsal">Pick</div>' + rm + "</div>";
    }
    if (a.kind === "s") {
      var sw = swapFor(tr, a), mine = H.slotDist(sw.holder, sw.y, sw.r), theirs = H.slotDist(sw.from, sw.y, sw.r);
      var av = function (d) { return d.reduce(function (t, x) { return t + x[0] * x[1]; }, 0) / Math.max(1e-9, d.reduce(function (t, x) { return t + x[1]; }, 0)); };
      return '<div class="tile pk"><span class="tpk">' + logo(sw.from, 34) + '</span><div class="tl"><b>Swap of ' + sw.y + " " + (sw.r === 1 ? "1sts" : "2nds") + " with " + esc(team(sw.from).short) + "</b><small>Takes theirs if it lands higher: theirs projects " + f1(av(theirs)) + ", its own " + f1(av(mine)) + (sw.ok ? "" : ". " + esc(sw.why)) + "</small>" + from + '</div><div class="tsal">Swap</div>' + rm + "</div>";
    }
    return '<div class="tile pk"><span class="tpk cash">$</span><div class="tl"><b>Cash</b><small>Counts against the ' + money(CBA.cashLimit(0)) + " limit</small>" + from + '</div><div class="tsal">' + money(+a.id) + "</div>" + rm + "</div>";
  }
  function fmtShort(d) { var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(d || ""); return m ? ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."][+m[2] - 1] + " " + (+m[3]) : d; }
  // how each team gets it done under the cap rules, and where it lands
  function capDetail(c, r, s) {
    var t = H.W.T[c], rep = H.tools(c, 0).rep, P0 = r.P, P2 = r.P2, tax = CBA.tax(0), a1 = CBA.a1(0), a2 = CBA.a2(0), lines = [], sol = r.sol || {};
    var nameOf = function (id) { return esc((H.W.P[id] || {}).n || id); };
    // salary mechanics
    if (sol.room) lines.push("Absorbs the incoming salary into cap room.");
    (sol.subs || []).forEach(function (sb) {
      if (sb.tpe) { var tp = (t.tpes || []).find(function (x) { return x.id === sb.tpe; }) || {}; lines.push("Takes " + sb.in.map(nameOf).join(" and ") + " (" + money(sb.inSal) + ") into its " + money(sb.tpeAmt) + " trade exception" + (tp.from ? " from " + esc(tp.from) : "") + "."); }
      else if (sb.agg) lines.push("Combines " + sb.out.map(nameOf).join(" + ") + " (" + money(sb.outSal) + ") to take back " + sb.in.map(nameOf).join(" and ") + " (" + money(sb.inSal) + ").");
      else lines.push("Matches " + sb.out.map(nameOf).join("") + " (" + money(sb.outSal) + ") for " + sb.in.map(nameOf).join(" and ") + " (" + money(sb.inSal) + ").");
    });
    (sol.newTpes || []).filter(function (x) { return x.amt >= 250000; }).forEach(function (x) { lines.push("Creates a new " + money(x.amt) + " trade exception from " + nameOf(x.from) + (x.partial ? " (the difference)" : "") + ", good for a year."); });
    if (r.newHard) lines.push("Hard-caps them at the " + esc(CBA.LEVEL_NAME[r.newHard]) + " for the rest of the season.");
    // where they land
    var w = [], was = CBA.status(P0, 0), now = CBA.status(P2, 0), order = { room: 0, over: 1, tax: 2, a1: 3, a2: 4 };
    if (P2 > tax && P0 <= tax) w.push('<b class="neg">Moves into the tax</b>, ' + money(P2 - tax) + " over");
    else if (P2 <= tax && P0 > tax) w.push('<b class="pos">Gets out of the tax</b>, ' + money(tax - P2) + " under");
    else if (P2 > tax) w.push("In the tax, " + money(P2 - tax) + " over (was " + money(P0 - tax) + ")");
    else w.push(money(tax - P2) + " under the tax (was " + money(tax - P0) + ")");
    if (P2 > a2) w.push('<b class="neg">over the second apron</b> by ' + money(P2 - a2));
    else if (P2 > a1) w.push((order[was] < 3 ? '<b class="neg">over the first apron</b>' : "over the first apron") + " by " + money(P2 - a1) + ", " + money(a2 - P2) + " under the second");
    else if (P2 > tax) w.push(money(a1 - P2) + " under the first apron");
    w.push(rep ? "a repeat taxpayer" : "not a repeater");
    var taxLine = s.taxBefore || s.taxAfter ? "Tax bill " + money(s.taxBefore) + " → " + money(s.taxAfter) + (s.taxAfter !== s.taxBefore ? ' (<b class="' + (s.taxAfter < s.taxBefore ? "pos" : "neg") + '">' + (s.taxAfter < s.taxBefore ? "saves " : "adds ") + money(Math.abs(s.taxBefore - s.taxAfter)) + "</b>)" : "") : "";
    var strip = "";
    if (s.dPay && s.dPay.some(function (x) { return Math.abs(x) >= 1e5; })) {
      var later = s.dPay.slice(1).reduce(function (a, x) { return a + x; }, 0);
      strip = '<div class="paystrip" aria-label="Payroll change by season">' + s.dPay.map(function (x, j) {
        return '<span class="' + (Math.abs(x) < 1e5 ? "z" : x > 0 ? "neg" : "pos") + '"><i>' + sname(j).slice(2) + "</i>" + (Math.abs(x) < 1e5 ? "—" : (x > 0 ? "+" : "-") + money(Math.abs(x))) + "</span>";
      }).join("") + "</div>" + (Math.abs(later) >= 1e6 ? '<p class="capw">' + (later > 0 ? '<b class="neg">Takes on ' + money(later) + "</b> in salary after this season" : '<b class="pos">Clears ' + money(-later) + "</b> in salary after this season") + (s.dTax && s.dTax.slice(1).some(function (x) { return Math.abs(x) >= 1e5; }) ? ", with " + (s.dTax.slice(1).reduce(function (a, x) { return a + x; }, 0) >= 0 ? "tax savings of " : "added tax of ") + money(Math.abs(s.dTax.slice(1).reduce(function (a, x) { return a + x; }, 0))) + " on salary already committed" : "") + ".</p>" : "") + (s.taxRows && s.taxRows.some(function (r) { return r.bill > 0 && r.bill - r.counted >= 1e6; }) ? '<p class="capw note">Tax savings count up to what shedding the salary another way would cost (about 40 cents a dollar over the line, 60 this season), since a team over the tax can usually get under in some other deal: ' + money(s.taxRows.reduce(function (a, r) { return a + Math.max(0, r.bill); }, 0)) + " in real bills, " + money(s.taxRows.reduce(function (a, r) { return a + Math.max(0, r.counted); }, 0)) + " counted.</p>" : "");
    }
    return '<div class="capd">' + strip + '<p class="capw">' + w.join("; ") + "." + (taxLine ? " " + taxLine + "." : "") + "</p>" + (lines.length ? '<ul class="caph">' + lines.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>" : "") + "</div>";
  }
  function tradeCard(tr, chk, sum, moves) {
    var n = tr.sides.length, fails = tr.sides.filter(function (c) { return !chk.teams[c].ok; });
    var after = tr.sides.map(function (c) { return chk.teams[c].after; }).filter(Boolean).sort().pop();
    var trm = { teams: tr.sides, moves: moves };
    var cls = !chk.ok ? "bad" : after ? "wait" : "ok";
    var html = '<div class="tcard"><div class="tcard-top ' + cls + '"><span class="tmark">' + (cls === "bad" ? "✕" : cls === "wait" ? "◷" : "✓") + "</span><div><b>" + (cls === "bad" ? "Trade doesn't work" : cls === "wait" ? "Trade works starting " + fmtShort(after) : "Trade works") + "</b><span>" +
      (cls === "bad" ? fails.map(function (c) { return esc(team(c).short); }).join(" and ") + (fails.length === 1 ? " fails" : " fail") + " the cap rules." : cls === "wait" ? "Someone in it can't be traded until then; every cap rule passes." : "Every team passes the cap rules.") + '</span></div><button class="btn" data-snap>Save image</button><button class="btn" data-copy>Copy link</button></div><div class="tcard-cols n' + n + '">';
    tr.sides.forEach(function (c, k) {
      var t = team(c), r = chk.teams[c], s = sum[c], gd = H.tradeGrade(c, trm, sum), g = grade(gd.total), inc = tr.assets.filter(function (a) { return destOf(tr, a) === k && a.from !== k; });
      var tierName = { contend: "Contender", middle: "In the middle", rebuild: "Rebuilding" }[gd.tier];
      var why = "Value by their own situation " + signed(gd.value) + (gd.wins ? ", wins this season " + signed(gd.wins) : "") + (gd.tax ? ", luxury tax " + signed(gd.tax) : "");
      var billSum = (sum[c].dTax || []).reduce(function (a, x) { return a + x; }, 0);
      if (gd.tax && billSum > 0 && billSum - gd.tax >= 1e6) why += " (the real bills drop " + money(billSum) + ", but savings count only up to what getting under another way would cost)";
      html += '<section class="tside" style="--tc:' + esc(t.color) + '"><header><span class="twater" aria-hidden="true">' + logo(c, 150) + '</span><span class="tlogo">' + logo(c, 52) + '</span><div class="tname"><small>' + esc(t.city || "") + "</small><b>" + esc(t.short) + "</b><em>" + tierName + "</em>" + (H.teamNeeds(c).top.length ? '<span class="tneeds">Needs ' + H.teamNeeds(c).top.map(function (x) { return H.FIT_NAME[x]; }).join(", ") + "</span>" : "") + '</div><span class="grade g' + g.charAt(0) + '" title="' + esc(why) + '">' + g + "</span></header>" +
        '<div class="tget"><h5>Receives</h5>' + (inc.length ? inc.map(function (a) { return tile(a, tr, k); }).join("") : '<p class="note">Nothing yet.</p>') + "</div>" +
        '<footer><p class="tverdict ' + (r.ok ? (r.after ? "wait" : "ok") : "bad") + '">' + (r.ok ? (r.after ? "◷ Works for " + esc(t.short) + " starting " + fmtShort(r.after) : "✓ Works for " + esc(t.short)) : (r.msgs.length ? "✕ " + esc(r.msgs[0]) + (r.msgs.length > 1 ? '<details class="moremsg"><summary>' + (r.msgs.length - 1) + " more reason" + (r.msgs.length > 2 ? "s" : "") + "</summary>" + r.msgs.slice(1).map(function (m) { return "✕ " + esc(m); }).join("<br>") + "</details>" : "") : "✕ Fails the cap rules")) + "</p>" +
        (r.notes && r.notes.length ? '<ul class="tnotes">' + r.notes.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
        '<dl class="tnums"><div><dt>Payroll</dt><dd>' + money(r.P) + " → <b>" + money(r.P2) + '</b></dd></div><div><dt>Wins this season</dt><dd>' + f1(s.winsBefore) + " → <b>" + f1(s.winsAfter) + '</b> <span class="' + (gd.dw >= 0 ? "pos" : "neg") + '">' + (gd.dw >= 0 ? "+" : "") + f1(gd.dw) + "</span></dd></div>" +
        '<div class="span2"><dt>Grade</dt><dd class="' + (gd.total >= 0 ? "pos" : "neg") + '"><b>' + signed(gd.total) + '</b><small class="vsplit">' + esc(why) + "</small></dd></div></dl>" +
        capDetail(c, r, s) + gauge(r) + "</footer></section>";
    });
    return html + "</div></div>";
  }
  // ---------- the trade snap: the trade card as a picture to share ----------
  // Drawn on a canvas so it saves as one PNG. ESPN's logo and headshot servers allow cross-origin drawing.
  function snapImg(src) {
    return new Promise(function (res) {
      if (!src) { res(null); return; }
      var im = new Image(), done = false;
      im.crossOrigin = "anonymous";
      im.onload = function () { if (!done) { done = true; res(im); } };
      im.onerror = function () { if (!done) { done = true; res(null); } };
      setTimeout(function () { if (!done) { done = true; res(null); } }, 6000);
      im.src = src;
    });
  }
  function logoSrc(c) { return "https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/" + team(c).espn + ".png&w=160&h=160"; }
  function headSrc(p) {
    var id = p.espn || (window.DSFaces.find && window.DSFaces.find("nba", p.n));
    return id ? window.DSFaces.url("nba", id, { size: 80 }) : "";
  }
  function fit(ctx, txt, w) {
    if (ctx.measureText(txt).width <= w) return txt;
    while (txt.length > 1 && ctx.measureText(txt + "…").width > w) txt = txt.slice(0, -1);
    return txt + "…";
  }
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function circleImg(ctx, im, x, y, d, bg, ini, cover) {
    ctx.save(); ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); ctx.closePath(); ctx.fillStyle = bg; ctx.fill(); ctx.clip();
    if (im) {
      if (cover) { var sw = im.width, sh = im.height, sc = Math.max(d / sw, d / sh) * 1.25; ctx.drawImage(im, x + d / 2 - sw * sc / 2, y + d - sh * sc + d * 0.06, sw * sc, sh * sc); }
      else { var pad = d * 0.14; ctx.drawImage(im, x + pad, y + pad, d - 2 * pad, d - 2 * pad); }
    } else if (ini) { ctx.fillStyle = /^#(fff|ECEBE6)/i.test(bg) ? "#56637A" : "#fff"; ctx.font = "700 " + Math.round(d * 0.36) + "px Barlow, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(ini, x + d / 2, y + d / 2 + 1); }
    ctx.restore();
  }
  function snapTrade(tr, chk, sum) {
    var n = tr.sides.length, colW = 380, gap = 18, pad = 28, W = Math.max(1080, pad * 2 + n * colW + (n - 1) * gap);
    colW = (W - pad * 2 - (n - 1) * gap) / n;
    var incs = tr.sides.map(function (c, k) { return tr.assets.filter(function (a) { return destOf(tr, a) === k && a.from !== k; }); });
    var rows = Math.max(1, Math.max.apply(null, incs.map(function (x) { return x.length; }))), TILE = 92;
    var H0 = 96, HEAD = 104, FOOT = 128, Hh = H0 + 22 + HEAD + 36 + rows * TILE + FOOT + 64;
    var load = [];
    tr.sides.forEach(function (c, k) {
      load.push(snapImg(logoSrc(c)));
      incs[k].forEach(function (a) { load.push(snapImg(a.kind === "p" ? headSrc(H.W.P[a.id]) : a.kind === "k" ? logoSrc(pickOf(a.id).from) : a.kind === "s" ? logoSrc(tr.sides[a.from]) : "")); });
    });
    var fonts = document.fonts && document.fonts.load ? Promise.all(["800 30px Besley", "700 20px Barlow", "700 22px 'Barlow Condensed'"].map(function (f) { return document.fonts.load(f).catch(function () {}); })) : Promise.resolve();
    return Promise.all([fonts, window.DSFaces.load ? window.DSFaces.load("nba") : null]).then(function () { return Promise.all(load); }).then(function (ims) {
      var S = 2, cv = document.createElement("canvas");
      cv.width = W * S; cv.height = Hh * S;
      var ctx = cv.getContext("2d"); ctx.scale(S, S);
      ctx.fillStyle = "#F5F4F0"; ctx.fillRect(0, 0, W, Hh);
      // title bar
      ctx.fillStyle = "#002244"; ctx.fillRect(0, 0, W, H0);
      ctx.fillStyle = "#C60C30"; ctx.fillRect(0, H0 - 5, W, 5);
      ctx.fillStyle = "#fff"; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
      ctx.font = "800 34px Besley, Georgia, serif"; ctx.fillText(n > 2 ? n + "-team trade" : "The trade", pad, 52);
      ctx.font = "600 15px Barlow, sans-serif"; ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.fillText("NBA Hub, " + H.asOf, pad, 76);
      var vt = chk.ok ? "✓  Trade works" : "✕  Doesn't work";
      ctx.font = "700 18px Barlow, sans-serif"; var vw = ctx.measureText(vt).width + 32;
      rrect(ctx, W - pad - vw, 30, vw, 38, 19); ctx.fillStyle = chk.ok ? "#16804A" : "#C0392B"; ctx.fill();
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText(vt, W - pad - vw / 2, 55);
      var ii = 0, y0 = H0 + 22;
      tr.sides.forEach(function (c, k) {
        var t = team(c), r = chk.teams[c], sm = sum[c], gdS = H.tradeGrade(c, { teams: tr.sides, moves: tr.assets.map(function (a) { return { kind: a.kind, id: a.id, amt: a.kind === "c" ? +a.id : 0, from: tr.sides[a.from], to: tr.sides[destOf(tr, a)] }; }) }, sum), bvs = gdS.total, g = grade(bvs), x = pad + k * (colW + gap), colH = HEAD + 36 + rows * TILE + FOOT;
        ctx.save(); ctx.shadowColor = "rgba(0,34,68,.10)"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 3; rrect(ctx, x, y0, colW, colH, 16); ctx.fillStyle = "#fff"; ctx.fill(); ctx.restore();
        ctx.save(); rrect(ctx, x, y0, colW, colH, 16); ctx.clip();
        ctx.fillStyle = t.color; ctx.fillRect(x, y0, colW, HEAD);
        ctx.fillStyle = "rgba(255,255,255,.28)"; ctx.fillRect(x, y0 + HEAD - 4, colW, 4);
        ctx.restore();
        ctx.save(); ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = 6; ctx.beginPath(); ctx.arc(x + 20 + 32, y0 + HEAD / 2, 32, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.restore();
        circleImg(ctx, ims[ii++], x + 20, y0 + HEAD / 2 - 32, 64, "#fff", c);
        ctx.textAlign = "left"; ctx.fillStyle = "#fff";
        ctx.font = "700 12px Barlow, sans-serif"; ctx.fillText((t.city || "").toUpperCase().split("").join(String.fromCharCode(8202)), x + 100, y0 + 42);
        ctx.font = "800 28px Besley, Georgia, serif"; ctx.fillText(fit(ctx, t.short, colW - 100 - 76), x + 100, y0 + 74);
        // grade
        var gc = { A: ["#D4EFD9", "#17663A"], B: ["#EEF4C9", "#4F6A00"], C: ["#FBE5CC", "#9A5B00"], D: ["#F9D9D9", "#A32020"], F: ["#F9D9D9", "#A32020"] }[g.charAt(0)];
        rrect(ctx, x + colW - 72, y0 + HEAD / 2 - 28, 56, 56, 12); ctx.fillStyle = gc[0]; ctx.fill();
        ctx.fillStyle = gc[1]; ctx.font = "800 26px Besley, Georgia, serif"; ctx.textAlign = "center"; ctx.fillText(g, x + colW - 44, y0 + HEAD / 2 + 9);
        // receives
        ctx.textAlign = "left"; ctx.fillStyle = "#66717F"; ctx.font = "700 12px Barlow, sans-serif"; ctx.fillText("RECEIVES", x + 20, y0 + HEAD + 26);
        var ty = y0 + HEAD + 36;
        if (!incs[k].length) { ctx.fillStyle = "#66717F"; ctx.font = "500 15px Barlow, sans-serif"; ctx.fillText("Nothing", x + 20, ty + 40); }
        incs[k].forEach(function (a, j) {
          var yy = ty + j * TILE, im = ims[ii++];
          if (j) { ctx.fillStyle = "#E8EAED"; ctx.fillRect(x + 16, yy, colW - 32, 1); }
          var title, sub, sub2, right, injLbl = "";
          if (a.kind === "p") {
            var p = H.W.P[a.id], last = H.lastYear(p);
            circleImg(ctx, im, x + 16, yy + 12, 66, team(p.t).color, window.DSFaces.initials(p.n), true);
            title = p.n; sub = posOf(p) + ", age " + p.age + ", " + rt(H.rating(p, 0)) + " impact"; sub2 = last > 0 ? "Thru " + sname(last) : "Expiring"; right = money(H.salary(p, 0) + H.kicker(p));
            var ij = H.injuryTag(p); injLbl = ij ? (ij.season ? "OUT FOR SEASON" : (INJ_WORD[ij.code] || (ij.dtd ? "Questionable" : "Out")).toUpperCase()) : "";
          } else if (a.kind === "k") {
            var pk = pickOf(a.id);
            circleImg(ctx, im, x + 16, yy + 12, 66, "#ECEBE6", pk.from);
            title = H.pickName(pk); sub = "Projected slot " + f1(H.pickInfo(pk).avg); sub2 = ""; right = "Pick";
          } else if (a.kind === "s") {
            var swp = swapFor(tr, a);
            circleImg(ctx, im, x + 16, yy + 12, 66, "#ECEBE6", swp.from);
            title = "Swap of " + swp.y + " " + (swp.r === 1 ? "1sts" : "2nds") + " with " + team(swp.from).short; sub = "Takes theirs if it lands higher"; sub2 = ""; right = "Swap";
          } else {
            circleImg(ctx, null, x + 16, yy + 12, 66, "#16804A", "$");
            title = "Cash"; sub = ""; sub2 = ""; right = money(+a.id);
          }
          if (n > 2) sub2 = (sub2 ? sub2 + ", " : "") + "from " + team(tr.sides[a.from]).short;
          ctx.font = "700 21px 'Barlow Condensed', sans-serif"; var rw = ctx.measureText(right).width;
          ctx.fillStyle = "#002244"; ctx.textAlign = "right"; ctx.fillText(right, x + colW - 18, yy + 52);
          ctx.textAlign = "left"; ctx.font = "700 18px Barlow, sans-serif";
          var tmax = colW - 100 - rw - 30;
          if (injLbl) { ctx.font = "700 11px 'Barlow Condensed', sans-serif"; var iw = ctx.measureText(injLbl).width + 12; ctx.font = "700 18px Barlow, sans-serif"; tmax -= iw + 8; }
          var tt = fit(ctx, title, tmax); ctx.fillText(tt, x + 96, yy + 38);
          if (injLbl) {
            var tx = x + 96 + ctx.measureText(tt).width + 8;
            ctx.fillStyle = injLbl === "DAY-TO-DAY" ? "#FBE5CC" : "#B42525"; rrect(ctx, tx, yy + 24, iw, 18, 5); ctx.fill();
            ctx.fillStyle = injLbl === "DAY-TO-DAY" ? "#8A5300" : "#FFFFFF"; ctx.font = "700 11px 'Barlow Condensed', sans-serif"; ctx.fillText(injLbl, tx + 6, yy + 37);
          }
          ctx.fillStyle = "#56637A"; ctx.font = "500 14px Barlow, sans-serif"; ctx.fillText(fit(ctx, sub, colW - 100 - rw - 30), x + 96, yy + 59);
          if (sub2) { ctx.fillStyle = "#66717F"; ctx.font = "500 13px Barlow, sans-serif"; ctx.fillText(fit(ctx, sub2, colW - 100 - rw - 30), x + 96, yy + 78); }
        });
        // footer
        var fy = y0 + HEAD + 36 + rows * TILE;
        ctx.save(); rrect(ctx, x, y0, colW, colH, 16); ctx.clip(); ctx.fillStyle = "#ECEBE6"; ctx.fillRect(x, fy, colW, FOOT); ctx.restore();
        ctx.fillStyle = r.ok ? "#16804A" : "#C0392B"; ctx.font = "700 14px Barlow, sans-serif"; ctx.textAlign = "left";
        ctx.fillText(fit(ctx, r.ok ? "✓ Works for " + t.short : "✕ " + (r.msgs[0] || "Fails the cap rules"), colW - 36), x + 18, fy + 26);
        var cell = function (lbl, val, cx, cy, col) {
          ctx.fillStyle = "#66717F"; ctx.font = "700 11px Barlow, sans-serif"; ctx.fillText(lbl, cx, cy);
          ctx.fillStyle = col || "#002244"; ctx.font = "600 17px 'Barlow Condensed', sans-serif"; ctx.fillText(fit(ctx, val, colW / 2 - 26), cx, cy + 21);
        };
        var dw = sm.winsAfter - sm.winsBefore;
        cell("PAYROLL", money(H.payroll(c, 0)) + " → " + money(r.P2), x + 18, fy + 54);
        cell("WINS THIS SEASON", f1(sm.winsBefore) + " → " + f1(sm.winsAfter) + " (" + (dw >= 0 ? "+" : "") + f1(dw) + ")", x + colW / 2 + 6, fy + 54);
        cell("VALUE", signed(bvs), x + 18, fy + 98, bvs >= 0 ? "#16804A" : "#C0392B");
        cell("SALARY IN / OUT", money(r.inSal) + " / " + money(r.outSal), x + colW / 2 + 6, fy + 98);
      });
      ctx.fillStyle = "#56637A"; ctx.font = "600 14px Barlow, sans-serif"; ctx.textAlign = "left";
      ctx.fillText("Checked against the 2023 CBA. Grades weigh value by each team's situation, wins and luxury tax.", pad, Hh - 26);
      ctx.textAlign = "right"; ctx.fillStyle = "#002244"; ctx.font = "700 15px Barlow, sans-serif"; ctx.fillText("davidsolar.dev/nba", W - pad, Hh - 26);
      return cv;
    });
  }
  function openSnap() {
    var tr = tradeState();
    if (!tr.sides.every(Boolean) || !tr.assets.length) return;
    var moves = tr.assets.map(function (a) { return { kind: a.kind, id: a.id, amt: a.kind === "c" ? +a.id : 0, from: tr.sides[a.from], to: tr.sides[destOf(tr, a)] }; });
    var chk = H.checkTrade({ teams: tr.sides, moves: moves }), sum = H.tradeSummary({ teams: tr.sides, moves: moves });
    cardBody.innerHTML = '<div class="snapbox"><h3>Share this trade</h3><p class="note">Drawing the picture…</p></div>';
    if (!card.open) card.showModal();
    var name = "trade-" + tr.sides.join("-").toLowerCase() + ".png";
    snapTrade(tr, chk, sum).then(function (cv) {
      cv.toBlob(function (blob) {
        if (!blob) { cardBody.innerHTML = '<div class="snapbox"><h3>Share this trade</h3><p class="note">Couldn\'t draw the picture in this browser. Copy the link instead.</p></div>'; return; }
        var url = URL.createObjectURL(blob), file = null;
        try { file = new File([blob], name, { type: "image/png" }); } catch (e) { /* old browser */ }
        var canShare = file && navigator.canShare && navigator.canShare({ files: [file] });
        cardBody.innerHTML = '<div class="snapbox"><h3>Share this trade</h3><img class="snapimg" src="' + url + '" alt="The trade card as a picture"><p class="snapbtns">' +
          (canShare ? '<button class="btn" data-snapshare>Share</button> ' : "") + '<a class="btn" href="' + url + '" download="' + name + '">Download</a> <button class="btn" data-copy>Copy link</button></p></div>';
        var sh = cardBody.querySelector("[data-snapshare]");
        if (sh) sh.addEventListener("click", function () { navigator.share({ files: [file], title: "NBA trade", url: location.href }).catch(function () {}); });
        var cp = cardBody.querySelector("[data-copy]");
        cp.addEventListener("click", function () { try { navigator.clipboard.writeText(location.href); cp.textContent = "Link copied"; } catch (x) { /* no clipboard */ } });
      }, "image/png");
    });
  }

  var tradePicking = -1;
  function teamGrid(k, taken) {
    return '<div class="tgrid">' + H.codes.slice().sort(function (a, b) { return team(a).name.localeCompare(team(b).name); }).map(function (c) {
      var used = taken.indexOf(c) >= 0;
      return '<button type="button" class="tg' + (used ? " used" : "") + '"' + (used ? " disabled" : "") + ' data-setteam="' + k + ":" + c + '" title="' + esc(team(c).name) + '">' + logo(c, 30) + "<span>" + esc(c) + "</span></button>";
    }).join("") + "</div>";
  }
  function tradePage() {
    var tr = tradeState(), n = tr.sides.length, ready = tr.sides.every(Boolean);
    var opts = function (cur, taken) {
      return '<option value="">Pick a team</option>' + H.codes.slice().sort(function (a, b) { return team(a).name.localeCompare(team(b).name); }).filter(function (c) { return c === cur || taken.indexOf(c) < 0; }).map(function (c) { return '<option value="' + c + '"' + (c === cur ? " selected" : "") + ">" + esc(team(c).name) + "</option>"; }).join("");
    };
    var moves = ready ? tr.assets.map(function (a) { return { kind: a.kind, id: a.id, amt: a.kind === "c" ? +a.id : 0, from: tr.sides[a.from], to: tr.sides[destOf(tr, a)] }; }) : [];
    var chk = ready && moves.length ? H.checkTrade({ teams: tr.sides, moves: moves }) : null;
    var sum = chk ? H.tradeSummary({ teams: tr.sides, moves: moves }) : null;
    var html = '<h2 class="sec">Trade Builder</h2><p class="lede">Up to five teams. Every deal is checked against the CBA\'s trade rules as they stand in ' + sname(0) + ".</p>";
    html += finderPanel();
    var warns = ready && moves.length ? H.tradeWarnings({ teams: tr.sides, moves: moves }) : [];
    if (warns.length) html += '<div class="tbanner warnb"><b>Heads up</b><span>' + warns.map(esc).join("<br>") + "</span></div>";
    if (chk) html += tradeCard(tr, chk, sum, moves);
    else if (ready) html += '<div class="tcard empty"><p>Add players, picks or cash from each team below. The trade card fills in as you go.</p></div>';
    if (chk && !chk.ok) html += fixes(tr, chk);
    html += '<div class="tcols n' + n + '">';
    tr.sides.forEach(function (code, k) {
      var mine = tr.assets.filter(function (a) { return a.from === k; });
      var inc = tr.assets.filter(function (a) { return destOf(tr, a) === k && a.from !== k; });
      var r = chk && code ? chk.teams[code] : null;
      var picking = !code || tradePicking === k;
      var head = code ? '<div class="tc-h filled" style="--tc:' + esc(team(code).color) + '"><span class="tlogo sm">' + logo(code, 35) + '</span><b class="tc-name">' + esc(team(code).name) + '</b><button type="button" class="tc-chg" data-chteam="' + k + '">' + (tradePicking === k ? "Cancel" : "Change") + "</button>" + (n > 2 ? '<button class="xbtn light" data-dropteam="' + k + '" aria-label="Remove team">×</button>' : "") + "</div>"
        : '<div class="tc-h"><b class="tc-name">' + (k === 0 ? "Pick the first team" : "Pick team " + (k + 1)) + "</b>" + (n > 2 ? '<button class="xbtn" data-dropteam="' + k + '" aria-label="Remove team">×</button>' : "") + "</div>";
      if (picking) head += teamGrid(k, tr.sides);
      var money0 = "";
      if (code) {
        var pay0 = H.payroll(code, 0), st0 = CBA.status(pay0, 0);
        money0 = '<p class="tc-line">' + money(pay0) + " payroll, " + esc({ room: "under the cap", over: "over the cap", tax: "in the tax", a1: "over the 1st apron", a2: "over the 2nd apron" }[st0]) + ", " + (CBA.tax(0) - pay0 >= 0 ? money(CBA.tax(0) - pay0) + " under the tax" : money(pay0 - CBA.tax(0)) + " over the tax") + "</p>";
      }
      var outSal = mine.reduce(function (a, x) { return a + (x.kind === "p" ? H.salary(H.W.P[x.id], 0) : 0); }, 0);
      var inSal = inc.reduce(function (a, x) { return a + (x.kind === "p" ? H.salary(H.W.P[x.id], 0) + H.kicker(H.W.P[x.id]) : 0); }, 0);
      html += '<div class="tc" data-dropside="' + k + '">' + head + (picking && code ? "" : money0) +
        '<div class="tc-sec"><h4>Sends <span>' + money(outSal) + (inSal ? ' <i class="note">gets ' + money(inSal) + "</i>" : "") + '</span></h4><ul class="assets">' + (mine.length ? mine.map(function (a) { return assetLine(a, tr, k, true); }).join("") : '<li class="note">Nothing yet. Add from the roster below.</li>') + "</ul></div>" +
        (code && !picking ? assetPicker(code, k, tr) : "") + "</div>";
    });
    html += "</div>";
    html += '<p class="tbtns">' + (n < 5 ? '<button class="btn" data-addteam>+ Add a ' + (n === 2 ? "third" : n === 3 ? "fourth" : "fifth") + " team</button> " : "") + '<button class="btn" data-clear>Clear the trade</button>' + (n > 2 ? '<span class="note"> Each piece goes where its logo chips point.</span>' : '<span class="note"> Deals can have up to five teams.</span>') + "</p>";
    if (chk) html += '<details class="panel capdet"><summary><h3 style="display:inline">Cap details <small>salary matching, exceptions and value by team</small></h3></summary>' + matchTable(tr, chk) + valueTable(tr, sum) + "</details>";
    view.innerHTML = html;
    fillDeals();
  }
  view.addEventListener("input", function (e) {
    var f = e.target.closest("[data-rfilter]");
    if (!f) return;
    var v = f.value.trim().toLowerCase();
    f.closest("details").querySelectorAll(".org-row[data-name]").forEach(function (b) { b.hidden = v && b.dataset.name.indexOf(v) < 0; });
  });
  // Trade finder: start from a team (win-win, buyer or seller) or from one player, get legal deals from around the league
  var dealCache = {};
  var TIER = { contend: "Contender", middle: "In the middle", rebuild: "Rebuilding" };
  function finderPanel() {
    var q = state.q, by = q.fby === "player" ? "player" : "team", mode = { buy: 1, sell: 1 }[q.fmode] ? q.fmode : "win";
    var target = q.find && H.W.P[q.find] ? H.W.P[q.find] : null, ft = H.teams[q.fteam] ? q.fteam : "";
    var open = !!(target || ft || q.fby);
    var link = function (extra) { return href("trade", Object.assign({}, q, extra)); };
    var html = '<details class="panel finder"' + (open ? " open" : "") + '><summary><h3 style="display:inline">Trade finder <small>legal deals from around the league, for a team or a player</small></h3></summary><div class="fbody">';
    html += '<div class="fctl"><div class="seg">' + '<a href="' + link({ fby: "team", find: null }) + '"' + (by === "team" ? ' aria-current="page"' : "") + ">Start from a team</a>" + '<a href="' + link({ fby: "player", fteam: null }) + '"' + (by === "player" ? ' aria-current="page"' : "") + ">Start from a player</a></div>";
    var modes = by === "team" ? [["win", "Win-win", "Both teams come out ahead by their own goals"], ["buy", "Buyer", "Add win-now players for picks and young players"], ["sell", "Seller", "Move veterans for picks and young players"]]
      : [["win", "Win-win", "Deals both teams like"], ["sell", "Picks and youth back", "His team gets picks and young players"]];
    if (by === "player" && mode === "buy") mode = "win";
    html += '<div class="chips fmodes">' + modes.map(function (m) { return '<a href="' + link({ fmode: m[0] === "win" ? null : m[0] }) + '"' + (m[0] === mode ? ' aria-current="true"' : "") + ' title="' + esc(m[2]) + '">' + m[1] + "</a>"; }).join("") + "</div></div>";
    if (by === "team") {
      html += '<div class="controls"><label>Team<select data-q="fteam"><option value="">Pick a team</option>' + H.codes.slice().sort(function (a, b) { return team(a).name.localeCompare(team(b).name); }).map(function (c) { return '<option value="' + c + '"' + (c === ft ? " selected" : "") + ">" + esc(team(c).name) + " (" + TIER[H.teamCtx(c).tier].toLowerCase() + ")</option>"; }).join("") + "</select></label></div>";
    } else {
      var all = H.players().slice().sort(function (a, b) { return a.n.localeCompare(b.n); });
      html += '<div class="controls"><label>Player<input list="fplayers" data-find value="' + esc(target ? target.n : "") + '" placeholder="Type a name"></label><datalist id="fplayers">' + all.map(function (p) { return '<option value="' + esc(p.n) + '">' + esc(team(p.t).short) + "</option>"; }).join("") + "</datalist></div>";
    }
    var team0 = by === "team" ? ft : target ? target.t : "";
    if (team0) {
      var key = team0 + "|" + mode + "|" + (by === "player" && target ? target.id : "") + "|" + H.cfg.salW;
      html += '<div class="fres" data-dealkey="' + esc(key) + '">' + (dealCache[key] ? dealList(dealCache[key], team0) : '<p class="note">Searching every team\'s roster and picks…</p>') + "</div>";
      html += '<p class="note">' + esc(team(team0).short) + " is " + TIER[H.teamCtx(team0).tier].toLowerCase() + " (" + pct(H.teamCtx(team0).po) + " to make the playoffs). Contenders count wins this season; rebuilding teams count picks and young players for more and veterans for less. Value averages the production and market views, with salary at its weight on the Trade Value tab. Every deal passes the cap rules.</p>";
    }
    return html + "</div></details>";
  }
  function dealSide(d, c) {
    var gets = d.moves.filter(function (m) { return m.to === c; });
    return gets.map(function (m) {
      if (m.kind === "p") { var p = H.W.P[m.id]; return '<span class="dpc" data-p="' + esc(p.id) + '">' + face(p, 26) + "<span><b>" + esc(p.n) + injTag(p) + "</b><small>" + esc(posOf(p)) + ", " + p.age + ", " + money(H.salary(p, 0)) + "</small></span></span>"; }
      if (m.kind === "s") { var sw = H.swapOf(m); return '<span class="dpc pk">' + logo(sw.from, 22) + "<span><b>" + esc(sw.y + " 1st-round swap") + "</b><small>Takes " + esc(poss(team(sw.from).short)) + " pick if it's higher</small></span></span>"; }
      var pk = pickOf(m.id); return '<span class="dpc pk">' + logo(pk.from, 22) + "<span><b>" + esc(H.pickName(pk)) + "</b><small>Slot " + f1(H.pickInfo(pk).avg) + "</small></span></span>";
    }).join("");
  }
  function dealList(list, A) {
    if (!list.length) {
      var fs = H.firstsStatus(A), why = "";
      if (!fs.ok.length) why = " " + esc(team(A).short) + " can't trade a first-round pick right now" + (fs.blocked.length ? ": " + fs.blocked.map(function (b) { return b.pk.y + " (" + esc(b.why.charAt(0).toLowerCase() + b.why.slice(1)) + ")"; }).join(", ") : ", since it owns none of its future firsts") + ". The Stepien rule checks every way a protected pick it owes could convey.";
      return '<p class="note">Nothing legal turned up that both teams would take.' + why + " Try another mode, or a lower salary weight on the Trade Value tab.</p>";
    }
    return '<div class="dlist">' + list.map(function (d) {
      var B = d.team, hq = { ta: A, tb: B, a: d.moves.filter(function (m) { return m.from === A; }).map(function (m) { return m.kind + ":" + m.id; }).join(","), b: d.moves.filter(function (m) { return m.from === B; }).map(function (m) { return m.kind + ":" + m.id; }).join(",") };
      var side = function (c, u) {
        var ctx = H.teamCtx(c), g = grade(u.u), bits = [];
        bits.push('<span class="' + (u.value >= 0 ? "pos" : "neg") + '" title="What the players and picks are worth to this team, by its age lean, fit and cap room">' + signed(u.value) + " players and picks</span>");
        if (Math.abs(u.dw) >= 0.05) bits.push('<span class="' + (!ctx.winW ? "nil" : u.dw >= 0 ? "pos" : "neg") + '" title="' + (ctx.winW ? "Worth " + money(ctx.winW) + " a win to this team" : "Rebuilding, so this season's wins don't move its grade either way") + '">' + (u.dw >= 0 ? "+" : "") + f1(u.dw) + " wins</span>");
        if (Math.abs(u.tax) >= 0.5e6) bits.push('<span class="' + (u.tax >= 0 ? "pos" : "neg") + '" title="Luxury tax, every season the contracts run (later seasons count less)">' + (u.tax >= 0 ? "saves " : "adds ") + money(Math.abs(u.tax)) + " tax</span>");
        return '<div class="dside" style="--tc:' + esc(team(c).color) + '"><div class="dh">' + logo(c, 22) + "<b>" + esc(team(c).short) + "</b><small>" + TIER[ctx.tier] + '</small><span class="grade sm g' + g.charAt(0) + '" title="This team\'s grade: ' + esc(signed(u.u)) + ' by its own goals">' + g + '</span></div><div class="dlbl">Gets</div><div class="dgets">' + (dealSide(d, c) || '<span class="note">Nothing</span>') + '</div><div class="dnum">' + bits.join("") + "</div></div>";
      };
      return '<article class="dcardf">' + side(A, d.uA) + '<span class="dswap" aria-hidden="true">⇄</span>' + side(B, d.uB) + '<div class="dact">' + (d.after ? '<span class="dafter">Works from ' + esc(fmtShort(d.after)) + "</span>" : "") + '<a class="btn" href="' + href("trade", hq) + '">Load</a></div></article>';
    }).join("") + "</div>";
  }
  function fillDeals() {
    var box = view.querySelector(".fres[data-dealkey]");
    if (!box || dealCache[box.dataset.dealkey]) return;
    var k = box.dataset.dealkey, parts = k.split("|");
    if (fillDeals.busy === k) return;
    fillDeals.busy = k;
    H.findDeals({ team: parts[0], mode: parts[1], player: parts[2] || null }, true).then(function (list) {
      dealCache[k] = list; fillDeals.busy = null;
      var now = view.querySelector('.fres[data-dealkey="' + k + '"]');
      if (now) now.innerHTML = dealList(dealCache[k], parts[0]);
    });
  }
  view.addEventListener("change", function (e) {
    var f = e.target.closest("[data-find]");
    if (!f) return;
    var p = H.players().find(function (x) { return x.n.toLowerCase() === f.value.trim().toLowerCase(); });
    if (!p) return;
    var q = Object.assign({}, state.route === "trade" ? state.q : {}, { find: p.id, fby: "player" });
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
    tr.assets.forEach(function (a) { on[a.kind + ":" + baseId(a.id)] = 1; });
    var ps = Object.values(H.W.P).filter(function (p) { return p.t === code && !p.two && H.salary(p, 0) > 0 && !on["p:" + p.id]; })
      .sort(function (a, b) { return H.salary(b, 0) - H.salary(a, 0); });
    var pks = H.picksOf(code).filter(function (pk) { return !on["k:" + pk.id] && !pk.locked && !pk.frozen && (pk.r === 1 || pk.y <= 2029); });
    var frozen = H.picksOf(code).filter(function (pk) { return pk.frozen; });
    var tpes = H.W.T[code].tpes;
    var dec15 = H.asOf < "2026-12-15";
    return '<details class="org" open><summary>Roster</summary><input class="rfilter" type="search" placeholder="Filter by name" data-rfilter="' + k + '"><div class="rhead"><span>Player</span><span>' + sname(0) + "</span><span>Thru</span></div>" + ps.map(function (p) {
      var locked = dec15 && p.c && p.c.signed === 0 && !(p.c.rk && p.c.rk[1] > 0);
      return '<button type="button" draggable="true" class="org-row' + (locked ? " locked" : "") + '" data-pick="p:' + esc(p.id) + '" data-side="' + k + '" data-name="' + esc(p.n.toLowerCase()) + '"' + (locked ? ' title="Signed this offseason: can\'t be traded until Dec. 15"' : "") + ">" + face(p, 22) + '<span class="grow">' + esc(p.n) + ' <span class="note">' + esc(posOf(p)) + "</span>" + injTag(p) + (locked ? ' <span class="pill warn">Dec 15</span>' : "") + '</span><b class="sal">' + money(H.salary(p, 0)) + '</b><span class="thru">' + sname(H.lastYear(p)).slice(2) + "</span></button>";
    }).join("") + "</details>" +
      '<div class="orgx">' + '<details class="org"><summary>Draft picks</summary>' + pks.map(function (pk) {
        return '<button type="button" draggable="true" class="org-row" data-pick="k:' + esc(pk.id) + '" data-side="' + k + '">' + logo(pk.from, 18) + '<span class="grow">' + esc(H.pickName(pk)) + '</span><span class="note">slot ' + f1(H.pickInfo(pk).avg) + "</span></button>";
      }).join("") + frozen.map(function (pk) { return '<div class="org-row locked" title="Frozen: the team finished a season over the second apron">' + logo(pk.from, 18) + '<span class="grow">' + esc(H.pickName(pk)) + ' <span class="pill warn">Frozen</span></span></div>'; }).join("") + "</details>" +
      (function () {
        // pick swaps this team can offer: years it still owns its own first, with nothing already attached
        var yrs = [];
        for (var y = 2027; y <= 2032; y++) { var own = H.W.picks.find(function (x) { return x.id === y + "-1-" + code; }); if (own && own.owner === code && !own.prot && !own.group && !own.locked && !own.frozen && !on["s:" + y + "-1-" + code] && !H.W.swaps.some(function (x) { return x.y === y && x.r === 1 && (x.from === code || x.holder === code); })) yrs.push(y); }
        return yrs.length ? '<details class="org"><summary>Pick swaps</summary><p class="note">Give a team the right to take your first instead of its own that year, if yours lands higher. It has to own its own pick that year too.</p>' + yrs.map(function (y) {
          return '<button type="button" draggable="true" class="org-row" data-pick="s:' + y + "-1-" + code + '" data-side="' + k + '">' + logo(code, 18) + '<span class="grow">' + y + ' 1st-round swap</span><span class="note">slot ' + f1(H.pickInfo(H.W.picks.find(function (x) { return x.id === y + "-1-" + code; })).avg) + "</span></button>";
        }).join("") + "</details>" : "";
      })() +
      '<details class="org"><summary>Cash and exceptions</summary><div class="cashrow"><input type="number" min="0.1" max="' + (CBA.cashLimit(0) / 1e6).toFixed(1) + '" step="0.5" placeholder="$M" data-cashamt="' + k + '"><button class="btn" data-addcash="' + k + '">Add cash</button></div>' +
      (tpes.length ? '<p class="note">Trade exceptions (used automatically when they help):</p><ul class="tpes">' + tpes.map(function (x) { return "<li>" + money(x.amt) + " · " + esc(x.from) + ' <span class="note">expires ' + esc(x.exp) + "</span></li>"; }).join("") + "</ul>" : '<p class="note">No trade exceptions.</p>') + "</details></div>";
  }
  view.addEventListener("change", function (e) {
    var ps = e.target.closest("select[data-prot]");
    if (!ps) return;
    var tr = tradeState(), b = ps.dataset.prot, a = tr.assets.find(function (x) { return x.kind === "k" && baseId(x.id) === b; });
    if (a) { a.id = ps.value ? b + "@" + ps.value : b; location.hash = tradeHash(tr); }
  });
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
    var picks = e.target.closest("[data-picks]"), pick = picks ? null : e.target.closest("[data-pick]"), rm = e.target.closest("[data-rm]"), clear = e.target.closest("[data-clear]"), add = e.target.closest("[data-addteam]"),
      drop = e.target.closest("[data-dropteam]"), cash = e.target.closest("[data-addcash]"), copy = e.target.closest("[data-copy]"), snap = e.target.closest("[data-snap]"),
      chg = e.target.closest("[data-chteam]"), setT = e.target.closest("[data-setteam]"), dto = e.target.closest("[data-destto]");
    if (!picks && !pick && !rm && !clear && !add && !drop && !cash && !copy && !snap && !chg && !setT && !dto) return;
    e.stopPropagation();
    if (snap) { openSnap(); return; }
    if (chg) { var ck = +chg.dataset.chteam; tradePicking = tradePicking === ck ? -1 : ck; render(); return; }
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
    if (picks) picks.dataset.picks.split(",").forEach(function (pp) {
      var m2 = pp.split(":"), kd = m2[0], id2 = m2.slice(1).join(":");
      tr.assets = tr.assets.filter(function (a) { return !(a.kind === kd && a.id === id2); });
      tr.assets.push({ kind: kd, id: id2, from: +picks.dataset.side, to: picks.dataset.to != null ? +picks.dataset.to : -1 });
    });
    if (cash) {
      var k = +cash.dataset.addcash, inp = view.querySelector('[data-cashamt="' + k + '"]'), v = Math.round((+inp.value || 0) * 1e6);
      if (v > 0) { tr.assets = tr.assets.filter(function (a) { return !(a.kind === "c" && a.from === k); }); tr.assets.push({ kind: "c", id: String(Math.min(v, CBA.cashLimit(0))), from: k, to: -1 }); }
    }
    if (rm) tr.assets = tr.assets.filter(function (a) { return a.kind + ":" + a.id !== rm.dataset.rm; });
    if (setT) {
      var sp = setT.dataset.setteam.split(":"), sk = +sp[0];
      if (tr.sides[sk] !== sp[1]) tr.assets = tr.assets.filter(function (a) { return a.from !== sk; });
      tr.sides[sk] = sp[1]; tradePicking = -1;
    }
    if (dto) {
      var dp = dto.dataset.destto.split("|"), da = tr.assets.find(function (x) { return x.kind + ":" + x.id === dp[0]; });
      if (da) da.to = +dp[1];
    }
    location.hash = tradeHash(tr);
  }, true);
  // Drag a roster row or an outgoing piece onto another team's column to send it there (desktop)
  var dragging = null;
  view.addEventListener("dragstart", function (e) {
    var row = e.target.closest("[data-pick][draggable]"), as = e.target.closest("[data-akey]");
    if (!row && !as) return;
    dragging = row ? { pick: row.dataset.pick, side: +row.dataset.side } : { akey: as.dataset.akey };
    try { e.dataTransfer.setData("text/plain", "trade"); e.dataTransfer.effectAllowed = "move"; } catch (x) { /* old browser */ }
    view.classList.add("dragging");
  });
  view.addEventListener("dragend", function () { dragging = null; view.classList.remove("dragging"); view.querySelectorAll(".tc.over").forEach(function (x) { x.classList.remove("over"); }); });
  view.addEventListener("dragover", function (e) {
    var col = e.target.closest("[data-dropside]");
    if (!dragging || !col) return;
    e.preventDefault();
    view.querySelectorAll(".tc.over").forEach(function (x) { if (x !== col) x.classList.remove("over"); });
    col.classList.add("over");
  });
  view.addEventListener("drop", function (e) {
    var col = e.target.closest("[data-dropside]");
    if (!dragging || !col) return;
    e.preventDefault();
    var tr = tradeState(), j = +col.dataset.dropside, d = dragging;
    dragging = null;
    if (!tr.sides[j]) return;
    if (d.pick) {
      var m = d.pick.split(":"), kind = m[0], id = m.slice(1).join(":");
      tr.assets = tr.assets.filter(function (a) { return !(a.kind === kind && a.id === id); });
      tr.assets.push({ kind: kind, id: id, from: d.side, to: j === d.side ? -1 : j });
    } else {
      var a = tr.assets.find(function (x) { return x.kind + ":" + x.id === d.akey; });
      if (a && j !== a.from) a.to = j;
    }
    location.hash = tradeHash(tr);
  });

  // ---------- free agents ----------
  function faPage() {
    var q = state.q, yr = Math.min(Hub.YEARS - 1, Math.max(1, +q.yr || 1)), fa = H.faClass(yr), cap = H.capOutlook(yr), prem = H.premium();
    var yopts = ""; for (var j = 1; j < Hub.YEARS; j++) yopts += '<option value="' + j + '"' + (j === yr ? " selected" : "") + ">Summer " + (2026 + j) + " (" + sname(j) + ")</option>";
    var html = '<h2 class="sec">Free Agents</h2><p class="lede">Everyone whose contract ends before the season you pick, with options called the way the model expects.</p>';
    html += controls('<label>Class<select data-q="yr">' + yopts + "</select></label>" + teamSelect(q.t || ""));
    // the top 50 until you ask for the whole class (a long scroll on a phone)
    var full = fa.filter(function (x) { return !q.t || x.team === q.t; }), list = q.all === "1" || q.t ? full.slice(0, 120) : full.slice(0, 50);
    // Expected to opt in, so not in the class below, but with a real chance of opting out
    var mo = H.maybeOut(yr).filter(function (x) { return !q.t || x.team === q.t; });
    if (mo.length) html += tablePanel("Could opt out", "<th>Player</th><th>Team</th><th>Option</th><th>Market</th><th>Chance</th>", mo.map(function (x) {
      return "<tr><td>" + pname(x.p, 22) + "</td><td>" + logo(x.team, 18) + "</td><td>" + money(x.sal) + "</td><td>" + money(x.market) + "</td><td><b>" + pct(x.pOut) + "</b></td></tr>";
    }).join(""), "Expected to opt in, with a 20% or better chance of opting out instead", "tmo");
    html += tablePanel("The " + (2026 + yr) + " class", "<th>Player</th><th>Team</th><th>Age</th><th>Type</th><th>Impact</th><th>Years</th><th>Fair value</th><th>Market</th><th>Gap</th>", list.map(function (x, k) {
      var gap = x.fair - x.market;
      return "<tr><td>" + (k + 1) + ". " + pname(x.p, 22, x.opt ? ' <span class="pill" title="Projected to decline his ' + esc(CBA.OPT_NAME[x.opt].toLowerCase()) + '">' + esc(x.opt) + " out</span>" : "") + "</td><td>" + logo(x.team, 18) + "</td><td>" + x.age + "</td><td>" + (x.kind === "RFA" ? '<span class="pill up">RFA</span>' : '<span class="pill">UFA</span>') + "</td><td>" + rchip(x.r) + "</td><td>" + x.yrs + "</td><td>" + money(x.fair) + "</td><td><b>" + money(x.market) + '</b></td><td class="' + (gap >= 0 ? "pos" : "neg") + '">' + signed(gap) + "</td></tr>";
    }).join(""), "Gap: positive means a bargain at the market price", "tfa");
    if (list.length < Math.min(full.length, 120)) html += '<p><a class="btn" href="' + href("fa", Object.assign({}, q, { all: "1" })) + '">Show the next ' + (Math.min(full.length, 120) - list.length) + " free agents</a></p>";

    html += tablePanel("Who can spend in " + sname(yr), "<th>Team</th><th>Committed</th><th>Room (renounce all)</th><th>Cap holds</th><th>Room with holds</th><th>Players</th><th>Best tool</th>", cap.map(function (c) {
      var hl = c.holdList.slice().sort(function (a, b) { return b.amt - a.amt; }).slice(0, 4).map(function (h) { return esc(h.n) + " " + money(h.amt); }).join(", ");
      return '<tr class="go" data-team="' + c.code + '"><td class="tm">' + logo(c.code) + '<span class="nm">' + esc(team(c.code).name) + "</span></td><td>" + money(c.committed) + '</td><td class="' + (c.room > 0 ? "pos" : "neg") + '">' + (c.room > 0 ? money(c.room) : "—") + '</td><td title="' + hl + '">' + (c.holds ? money(c.holds) : "—") + '</td><td class="' + (c.roomHolds > 0 ? "pos" : "neg") + '">' + (c.roomHolds > 0 ? money(c.roomHolds) : "—") + "</td><td>" + c.n + "</td><td>" + esc(c.tool) + "</td></tr>";
    }).join(""), "Against a " + money(CBA.cap(yr)) + " cap. Holds: free agents a team keeps rights to (hover for the biggest); renouncing them frees the room", "tspend");
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
      (H.fresh ? '<h3 id="feeds">Data feeds</h3><table class="t tfeed"><thead><tr><th>Feed</th><th>Last updated</th><th>Refreshed by</th></tr></thead><tbody>' + H.fresh.map(function (f) { return "<tr" + (f.stale ? ' class="stale"' : "") + "><td>" + esc(f.label) + "</td><td>" + (f.when ? esc(fmtShort(f.when)) + (f.age != null ? ' <span class="note">(' + (function () { var d = Math.round((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(String(f.when).slice(0, 10))) / 864e5); return d <= 0 ? "today" : d === 1 ? "yesterday" : d + " days ago"; })() + ")</span>" : "") : "Didn\'t load") + (f.stale ? " <b>behind</b>" : "") + "</td><td>" + (f.how === "nba-ringer" ? "Checked daily; the Ringer reshuffles every few weeks" : f.manual ? "Updated by hand" : "Daily, automatic") + "</td></tr>"; }).join("") + '</tbody></table><p class="note">A check runs every afternoon and flags any automatic feed that\'s gone quiet (game feeds are exempt in the offseason and over the All-Star break).</p>' : "") +
      "<h3>The league today</h3><p>Built fresh every time the page opens, from feeds the site already refreshes every day: contracts from Basketball-Reference and rosters, injuries and season stats from ESPN (the same feed Hard Cap uses), standings, and the draft order, every pick owed and the consensus 2027 board from the Big Board. A waived player catching on somewhere new counts as a two-way there while his old team pays off the rest.</p>" +
      "<h3>Ratings</h3><p>Every player has an impact rating per 100 possessions, offense plus defense, from Banner 19's blend of DARKO (half), RAPM, CraftedNBA and the box score. The DARKO half is live: Kostya Medvedovsky and Andrew Patton's daily plus-minus is pulled from <a href=\"https://www.darko.app/\">darko.app</a> daily" + (H.darkoThrough ? " (ratings through " + esc(H.darkoThrough) + ")" : "") + " and replaces the June numbers the cap sheet was built on; this year's rookies move halfway from their draft-slot guess to DARKO's number. Basketball-Reference's Box Plus/Minus moves the other half, faded in by minutes (about " + H.cfg.blend.toLocaleString() + " minutes to move it halfway). Ratings age on Stephen Noh's curve, and young players grow toward their ceiling.</p>" +
      "<h3>Skill ratings</h3><p>The Ratings tab breaks every player into twelve categories, rebuilt daily from <a href=\"https://www.pbpstats.com/\">pbpstats</a> (possessions, shots by zone, assisted and unassisted points, assists by shot type), Basketball-Reference (advanced, per-100, shooting and play-by-play tables) and DARKO. Each category is a weighted blend of a few stats, scored against everyone with real minutes and shown as a percentile, league-wide or against his position group (guards, wings and bigs, from Basketball-Reference's estimate of the positions he's actually played). <b>Shooting</b>: 3-point percentage and volume, free throws and mid-range accuracy. <b>Finishing</b>: accuracy and volume at the rim, plus free-throw rate. <b>Scoring</b>: points per 100 possessions and true shooting. <b>Creation</b>: unassisted points per 100 and usage. <b>Playmaking</b>: assist rate and points created by assists. <b>Ball security</b>: turnovers against what his usage and passing load predict, so a lead guard isn't graded against a corner shooter. <b>Rim protection</b>: block rate and defensive rebounding. <b>Rebounding</b>: both glass rates. <b>Disruption</b>: steal rate. <b>Offensive, defensive and overall impact</b>: DARKO's plus-minus, or box plus-minus shrunk by minutes where DARKO has no number. Shooting percentages are pulled toward the league average by how many shots back them up (75 threes, 40 free throws, 40 rim attempts), and early in the season last year counts at half weight. The archetype is a label read off the profile (a big with 70th-percentile rim protection among bigs is a rim protector, a guard or wing with top-15% creation and 75th-percentile playmaking is a primary creator).</p>" +
      "<h3>Team style</h3><p>Each team's Style tab adds up every lineup it has played this season on both ends (pbpstats' lineup and opponent-lineup totals): offensive and defensive rating, pace, the four factors (effective field-goal percentage, turnovers per 100 possessions, offensive rebound rate, and free-throw points per shot standing in for free-throw rate), where its shots come from and how often they go in, and the same for its opponents. Every number is ranked across the league. The labels (\"Plays fast\", \"Walls off the rim\") come from top-five and bottom-five ranks.</p>" +
      "<h3>Lineups and on/off</h3><p>Every team's five-man units come from <a href=\"https://www.pbpstats.com/\">pbpstats</a> daily: possessions, points scored and allowed. Trios and duos add up every five-man unit they were part of, and a player's on/off compares every lineup he's in with every one he isn't, so all three come from the same possessions and agree with each other. Ratings are points per 100 possessions. Small samples swing wildly (a +40 lineup over 30 minutes means little), which is why every view has a possession minimum. A starter's off numbers are mostly bench units, so on/off flatters starters on deep teams and punishes them on thin ones.</p>" +
      "<h3>Lineups and minutes</h3><p>This season uses real rotations: each team's starting five from its most recent game and the minutes every player is averaging, scaled to 240 a game among the players available (anyone ruled out for the season sits). Later seasons don't have that, so the best player at each position starts (by the positions he plays, so two centers don't start together) and the bench plays by rating: 34, 33, 32, 30 and 28 minutes for the starters, then 24, 20, 16, 13 and 10.</p>" +
      "<h3>Standings and odds</h3><p>Ratings times minutes give each team a net rating, and every game left on a fresh schedule is played " + H.cfg.sims.toLocaleString() + " times from each team's real record. Then the play-in, the playoffs and the lottery: 16 lottery teams, three balls each, two for the 9 and 10 seeds and the three worst records, one for each 7-8 play-in loser, and the worst three can't fall below 12th.</p>" +
      "<h3>The year slider</h3><p>" + sname(0) + " is today's rosters. Every later season is built from contracts: options are called on value (a team option is picked up when he's worth it, a player option comes back when it's bad for the team), and when a deal ends he's gone, unless he's a restricted free agent worth his price (matched by default) or you re-sign him on his team's page. Each team's first-round picks arrive at their projected slot on rookie-scale deals (2027 from the simulations, using the Big Board's player at that slot; later drafts from the season before). Better-of picks go to whoever gets them where the picks are projected to land. Open spots go to the free agents a team's cap position can buy: a starter with real cap room, a rotation player with the mid-level, minimums after that.</p>" +
      "<h3>Surplus value</h3><p>For each season left on a contract: value minus salary" + (H.cfg.disc > 0 ? ", discounted " + pct(H.cfg.disc) + " a year (about the cap's growth, so values read in today's cap dollars)" : ", in real dollars (set a discount rate, 7% is about the cap's growth, to see today's cap dollars)") + ". This season only counts the part still to play.</p>" +
      "<p><b>Production</b> is minutes times value rating (below) above replacement (-2.5, what a free minimum-salary player gives you), with that margin raised to the power of the star premium (" + H.cfg.convex.toFixed(2) + "). The premium is there because minutes and roster spots are scarce: one +4 player is worth far more than two +1 players, and the max means stars are always paid less than they're worth. With a linear price (1.0), cheap role players on long minimum deals outranked stars. Minutes are what he actually plays (with last season counting as 10 games, so a player back from a short injury isn\'t priced at a full starter\'s load), fading over a few seasons toward what his rating would earn. It's priced so the whole league's production adds up to the whole league's payroll: a dollar of production costs what teams actually spend on it, on average. The max holds star pay down, so stars come out well ahead of their contracts, and mid-priced deals, the worst value in free agency, come out somewhat behind. (Pricing off what role players get as free agents instead made the middle look half-wasted.) Only " + pct(H.cfg.growth) + " of a young player's projected improvement counts, since a lot of it never shows up; decline counts in full. A first- or second-year player's rating starts as a guess from his draft slot, so this season's play moves it faster than a veteran's. Both settings are adjustable on the Trade Value tab.</p>" +
      "<p><b>Value rating.</b> Production doesn\'t run on impact alone. Each player\'s value rating mixes three reads, each put on the impact scale by rank (the 20th-best box score gets the impact of our 20th-best player): impact (Banner, BPM, DARKO; 55%), box production (Hollinger\'s Game Score per 100 possessions from this season blended with last; 25%, less on few minutes) and consensus (his spot in the Ringer\'s Top 100; 20%). A player outside the Top 100 splits that share between the other two. Position matters too: the average big rates about 0.8 above the average guard or wing on impact, but teams pay bigs far less for the same rating, because rebounding and rim protection show up loudly in plus-minus and bigs are easier to replace. Half of each position\'s gap to the league comes out of the value rating, and box scores rank within position, since Game Score leans big as well. Impact still leads because it\'s the best single read on winning, but plus-minus metrics are noisy and miss the scarcity of high-usage scorers, which teams pay for and box scores catch, and the Ringer adds the film read and context the numbers can\'t. The gap between a player\'s value rating and his impact today carries into later seasons, so aging still runs off the impact projection. Win projections use impact only. Change the mix under Model settings; the Rankings tab lays all three side by side. On any player card, <b>Your read</b> adds your own adjustment (up to two points per 100 either way) on top: it moves his value, contract value and trade value in your browser only, is listed under Model settings, and never touches win projections.</p>" +
      "<p><b>Availability</b> scales every season's production by the share of games he's expected to play. The cap sheet's number is last season's games played, which made one long injury (a torn Achilles) look permanent, so it's pulled 60% of the way to a typical 85%, then updated with this season's games played out of his team's games, with the history counting for two seasons.</p>" +
      "<p><b>Market</b> is what teams would pay him: Banner 19's market model, fit to 317 veteran contracts, capped at the max. It mostly prices minutes and scoring, barely impact, which is why it disagrees with production.</p>" +
      "<h3>Players on rookie deals</h3><p>A player in his first four seasons is valued mostly by his draft slot at first: what that slot has produced over a draftee's first eight seasons (or, in the market view, what teams pay for it), for the part of those eight seasons still ahead. That also covers the restricted free agency and Bird rights that come after the rookie deal. His own projection takes over as he plays: about half after one full season, most of it by his fourth. His own projection counts restricted free agency too: the seasons through his eighth at what he\'d be paid (his market price, capped at the 25% rookie-scale max), only where he\'s worth more, at 75% for the risk of an offer sheet or a holdout. Young players grow toward their potential but never slower than the typical age curve, so a 19-year-old who has already outplayed his draft-night potential keeps growing. Without that, a No. 1 pick lost most of his value the night he was drafted, because a 19-year-old's first box scores are rough.</p>" +
      "<h3>Draft picks</h3><p>What each slot is worth comes from what picks 1 to 60 in the 2001-2018 drafts actually produced: each of a player's first eight seasons valued with the same production model, minus what his slot pays today (the rookie scale, team options picked up only when he's worth it, and for stars the part of their second contract above the max). Busts count. The curve is fit to the averages (any one career capped at $350M, so one LeBron can't bend it): No. 1 is worth about " + money(pk[0]) + ", No. 5 " + money(pk[4]) + ", No. 15 " + money(pk[14]) + ", No. 30 " + money(pk[29]) + " and No. 45 " + money(pk[44]) + ". A pick's value averages the value of every slot it could land in, weighted by its odds (not the value of the average slot, which would undersell a pick with a real shot at the top three). For 2027 the simulations play out the season, the play-in and the 3-2-1 lottery: the three worst teams get two balls each, the next seven three each, the 9 and 10 seeds two, the 7-8 play-in losers one, and the worst three can't fall below 12th, so the worst record isn't the likeliest No. 1 anymore. Later drafts spread where a team could finish around its projected record (wider each year out) and run each finish through the same lottery. A protected pick only counts the slots where it conveys. The market view uses what teams pay for picks in trades instead.</p>" +
      "<h3>Pick swaps and injuries</h3><p><b>Swaps.</b> Under Draft picks in the trade builder, a team can give another the right to swap firsts in a year: the team getting it takes the other's pick in place of its own if it lands higher. Both teams have to own their own first that year with no swap, protection or condition on either, and neither pick can move in the same trade. It's valued by playing out where both picks land thousands of times, and costs the team giving it 30% more than it's worth to the team getting it, since giving one up means losing control of your own pick. The trade finder uses a swap only when picks alone can't close a gap, and never more than one per deal. <b>Injuries.</b> The badge comes from the daily injury feed: red for out (solid for out for the season), amber for day-to-day, the latest news on hover. A torn Achilles or ACL, a note saying he'll miss the season, or a player stepping away counts as out for the season; otherwise the note's timeline (\"four to six weeks\", \"re-evaluated in four months\") sets a return date, and a player still listed out past it gets another week. The games he'll miss come off this season's value and wins, and the standings: a player out for part of what's left counts as the full team for the share he plays and the team without him for the share he misses.</p>" +
      "<h3>Trades and team tools</h3><p>The same rules Banner 19 runs: salary matching by apron tier (200% plus $250K for small salaries, outgoing plus a set amount in the middle, 125% for big ones, 100% over the first apron), trade exceptions (each team's real ones, open as of Nov 2026; teams over the first apron can't use ones made last season), hard caps at the first or second apron when a team takes back more salary, combines salaries or sends cash, the cash limit, the 15-man roster limit and the Stepien rule. Deals with three to five teams check each team on everything it sends and gets. Each team's mid-level use and hard caps come from Hoops Rumors' July tracking; repeater status from the last four tax seasons.</p>" +
      "<h3>Cap holds, dead money and extensions</h3><p>Next summer's room is shown both ways: if a team renounces everyone, and with the cap holds for free agents it keeps rights to. Dead money is this season's team totals from Spotrac (later seasons only where Spotrac lists them). Extension eligibility and maximums follow the 2023 CBA: rookie-scale players the summer before their fourth season, veterans with two or fewer years left, up to 140% of their salary or the max. A player traded after signing a rookie-scale extension but before it starts carries the poison pill: the team getting him counts the average of this season and every extension year for salary matching, while his old team sends out only this season's salary.</p>" +
      "<h3>The trade card</h3><p>Each team's column shows what it receives, whether the deal passes the cap rules for that team, payroll and cap position before and after, its projected wins this season before and after, and a grade. The grade weighs the deal by the team's own situation, the same way the trade finder does: value averages the production and market views (they disagree most about picks and young players), a contender also counts this season's wins (about $6 million a win), a rebuilding team counts picks and young players for more and veterans for less, and an expiring veteran for half (it would lose him for nothing in the summer). Luxury tax saved or added counts too: this season's bill in full and next season's at half. Roster overages are a footnote (the team would waive someone), and a player who can't be traded yet makes the deal work starting that date. Each team's footer spells out how it's done under the cap rules (which trade exception takes whom, what new exception it creates), where it lands against the tax and aprons, and whether it's a repeater. Grades: A+ at $60M or more, A at $35M, A- at $20M, B+ at $8M, B within $8M either way, then B-, C+, C and D at -$20M, -$35M, -$60M and -$100M, and F below that. Letters run from B (within $16 million of even) up through B+ ($16 million), A- ($40 million), A ($70 million) and A+ ($120 million), and down the same way to C, D and F; the bands are set so the 2025-26 deadline deals grade close to Kevin Pelton's ESPN grades of them. The grade only measures value; a contender giving up future value for wins now can still be making the right call.</p>" +
      "<h3>Salary weight</h3><p>Two numbers on the Contracts tab. <b>Surplus</b> is value minus salary, every dollar counted: is he paid more or less than he produces. <b>Trade value</b>, what the list ranks, counts salary at the trade-market weight below, adds restricted free agency for young players, and averages two views of his worth: production (what he should produce) and market (what teams pay for his minutes and scoring, fit to 317 veteran contracts). Teams trade on both, and on last season\'s deals the average fit real trades better than either view alone. The trade finder and grades use the same average. It runs on a narrower scale than surplus (the worst contracts sit around -$90 million, not -$115 million) because that\'s how trades price money; read it against draft picks, which use the same scale: a median first is worth about " + money(H.medianFirst()) + ".</p><p>Trade value counts salary at 75% of face value by default. Teams have to spend to the salary floor and unused cap room disappears, so a dollar of salary doesn't cost a team a dollar of value. Treating the 2025-26 deadline deals and the 2026 summer's big trades (Giannis, Kawhi, Morant) as fair to both sides puts the real cost at about half to three quarters: on the 26 of those trades the model can match player by player, 50% and 75% miss by about $10.5 million a deal (median), face value by $14 million. The picks in those deals aren\'t in the data, and leaving them out flatters lower weights (a salary dump looks fair only if salary is cheap), so the default is 75%. A flat weight also beat discounting only the first slice of each salary. Set it from 25% to 100% under Model settings. Player cards show both: surplus is value minus every dollar of salary, trade value counts salary at this weight. In the trade finder and the trade card's grades the weight also depends on the team: 15 points lower with $20 million or more of room under the tax (that's how the Nets could take Julius Randle, or Terance Mann with the 22nd pick attached), 5 lower with some room, and 10 more off this season's salary for a rebuilding team, whose season is gone either way. A taxpaying team's extra cost is the tax itself, counted separately.</p>" +
      "<h3>Timing, protections, fit and long-term money</h3><p><b>Timing rules.</b> Free agents signed in the summer can't be traded until Dec. 15, and a player acquired by trade can't be combined with other salaries for two months (tracked from the daily rosters, so any team change counts); either makes a deal work starting that date rather than failing it, unless the date falls after the Feb. 11 trade deadline, when the deal can't happen this season at all (a veteran extension with a raise over 40% blocks trades for six months, so Payton Pritchard's October extension keeps him off the market until April). A team's first-round pick seven years out is frozen when it finishes a season over the second apron (Boston, Minnesota and Phoenix's 2032 firsts; Cleveland's 2033), and frozen picks can't be traded. The 2027 lottery follows the 3-2-1 rules: Washington's pick can't be first again and Utah's can't be top five a third straight year. A team can't trade for a player it traded away within the past year: from the past year's trades, dated, plus any trade since, caught by the twice-daily roster snapshot (a player straight from one team to another between snapshots; one who drops off every roster and turns up later counts as a signing). <b>Stepien.</b> A team that trades a first can't be left without one in back-to-back future years, checked every way its picks could convey: a protected first it owes that rolls over (Miami's 2027 to Charlotte, unprotected in 2028) could take either year's pick, and another team's protected pick it holds might go back, so neither counts as owned. <b>Protections.</b> Any first-round pick you send can be protected (top 3, 5, 8, 10, 11, 16 or 20; the 3-2-1 lottery bars new top-12 to top-15 protections). In the protected range it stays and turns into a second-rounder, and its value counts only the slots where it conveys. <b>Fit.</b> Each team's needs come from its rotation: the minutes-weighted percentiles of its nine heaviest-minute players in shooting, finishing, shot creation, playmaking, ball security, rim protection, rebounding and perimeter defense. A player strong where his new team is weak counts for up to 25% more to it. <b>Long-term money.</b> Grades count the luxury tax for every season the contracts run (tax added: this season in full, then 60%, 45%, 35% and 25%; tax saved: up to what shedding the salary another way would cost), and salary further out costs more: a salary dollar counts at the salary weight this season and next, then 10 points more each season after, since money years out eats flexibility. The card shows each team's payroll change season by season.</p>" +
      "<h3>Trade finder</h3><p>Start from a team or from one player. Every team weighs a deal by where it is: contenders (65% or better to make the playoffs) also count the wins it adds this season, about $6 million a win; rebuilding teams (30% or worse) count picks for 30% more and players by age (24 and under 30% more, 25 a bit more, 27 a bit less, 29 30% less, 30 and older 45% less), count this season's play at 40% since it's next year on that matters to them, and count expiring veterans at half since they'd walk for nothing; teams in between lean the same way, more gently. A player whose deal ends inside the five-year window also brings his Bird rights: the gap between what he'd produce on his next deal and what the market charges (half of it, averaging in the market view), plus 15% of his production a season for a team over the cap that couldn't replace him in free agency (5% with room), over three seasons, times the chance he re-signs (60%, or 85% for a restricted free agent). So an expiring good player can beat a lesser one with years left. A team trying to win doesn't take on a player who's out for the season, and injured players lose the part of this season they'll miss. Each side's grade adds the luxury tax it saves or adds over every season the contracts run. Tax added counts in full this season and less after; tax saved counts only up to what getting under some other way would cost (about 40 cents per dollar shed over the line, 60 this season), so a team projected $20 million over next season doesn't value a dump at its whole $38 million bill, and rebuilding teams over the line stop attaching lottery picks just to save it. That's what lets a deal work for both sides, since on one value scale every trade is zero-sum. <b>Win-win</b> finds deals both teams come out ahead on, and a contender can't get worse this season in one. A team's young core (its top three by rating or minutes, 27 or under, and young players on 25% of the cap or more) isn't offered up. Players who can't be traded until Dec. 15 count when the date is within six weeks; those deals say when they work. A quick estimate of wins finds the candidates, then the shortlist runs the trade card's full season simulation, so the wins on a deal match what loading it shows. In that simulation a newcomer takes minutes from the end of the bench first, not a slice from everyone, and a power forward can cover center minutes when a team is short of bigs. <b>Buyer</b> adds win-now players for picks, young players and salary, keeping the overpay modest. <b>Seller</b> moves veterans to teams trying to win and asks for picks and young players while the buyer still comes out ahead. Every deal is checked against the full cap rules, roster limits and the Stepien rule, which only limits trading first-round picks away (a team already short from older deals can still trade players).</p>" +
      "<h3>Free agents</h3><p>The list is everyone whose contract ends before the season you pick, with options called the way the model expects: a player option is declined when he's more likely to opt out than in, a team option when he's worth less than 80% of his salary. Players the model expects to opt in but who have at least a 20% chance of opting out are listed separately under Could opt out. Fair value is what he should produce per year over the deal the market would give him; the market estimate is what teams would actually pay. Restricted free agents can be matched by their own team. Later summers are rougher, since trades, extensions and re-signings between now and then aren't known.</p>" +
      "<h3>Later seasons</h3><p>A player whose deal ends re-signs if he's worth at least 85% of his market price and is 33 or younger (his team holds his Bird rights, so it can go over the cap to keep him; restricted free agents are matched at a lower bar). Everyone else leaves, everyone ages a year at a time, and each team's draft picks arrive where the 3-2-1 lottery is likeliest to put them. Open spots go to the free agents a team's cap position can buy, unless that box is unchecked.</p>" +
      "<h3>What it doesn't do</h3><p>Aggregation windows and other timing rules aren't enforced (players signed this summer and the deadline get a warning). No second-round rookies on the slider, and the most tangled pick conditions (Oklahoma City's chain of 2027 swaps) stay with whoever holds them today. Mid-level use after mid-July isn't tracked.</p>" +
      '<p class="note">Built on the shared NBA library (nba/lib) that Banner 19 and Hard Cap also run on, so a cap rule or contract fix lands in all three.</p></div>';
    view.innerHTML = html;
  }

  // ---------- start ----------
  // Tonight (the front page) and game previews only need tonight.json: draw them as soon as it lands, then again
  // with the full league once it's built
  parse();
  if ((state.route === "tonight" || state.route === "game") && window.Tonight) Tonight.load().then(function () {
    if (H || (state.route !== "tonight" && state.route !== "game")) return;
    if (state.route === "game") gamePage(); else tonightPage();
    var tb = document.querySelector('.tabs a[data-tab="tonight"]'); if (tb) tb.setAttribute("aria-current", "page");
  });
  function get(u, opt) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }).catch(function (e) { if (opt) return null; throw e; }); }
  Promise.all([get("../celtics/data.json"), get("../hardcap/stats.json", true), get("../hardcap/contracts.json", true), get("../celtics/live.json", true), get("../draft/nba.json", true), get("data/picks.json"), get("../tools/draft_teams.json", true), get("data/tpes.json", true), get("data/exceptions.json", true), get("data/dead.json", true), get("data/darko.json", true), get("data/taxhist.json", true), get("data/ratings.json", true), get("data/lineups.json", true), get("data/frozen.json", true), get("data/moves.json", true), get("data/trades.json", true), get("../draft/nba2028.json", true), get("data/ringer100.json", true)])
    .then(function (r) {
      H = Hub.build({ data: r[0], stats: r[1] || {}, fixes: r[2], live: r[3], board: r[4] || {}, picks: r[5], teams: r[6], tpes: r[7], exceptions: r[8], dead: r[9], darko: r[10], taxhist: r[11], ratings: r[12], lineups: r[13], frozen: r[14], moves: r[15], trades: r[16], board2028: r[17], ringer: r[18] }, { mode: load("mode", "prod"), disc: load("disc", 0.07), fill: load("fill", true), convex: load("convex3", 1.5), growth: load("growth", 0.5), salW: load("salW2", 0.75), vblend: load("vblend", "bal") });
      // Data freshness: a banner when a feed has gone quiet, and the full list under How it works
      if (window.Fresh) {
        H.fresh = Fresh.check({ "hardcap/stats.json": r[1], "celtics/live.json": r[3], "draft/nba.json": r[4], "nba/data/darko.json": r[10], "nba/data/ratings.json": r[12], "nba/data/lineups.json": r[13], "nba/data/ringer100.json": r[18] });
        var stale = H.fresh.filter(function (f) { return f.stale; }), fb = $("#fresh");
        if (stale.length && fb) {
          fb.hidden = false;
          var desc = stale.length > 3 ? stale.length + " feeds haven\'t updated since " + esc(fmtShort(stale.map(function (f) { return f.when || ""; }).sort()[0] || "")) : stale.map(function (f) { return esc(f.label) + (f.when ? " last updated " + esc(fmtShort(f.when)) : " didn't load"); }).join("; ");
          fb.innerHTML = "<b>Some data is behind.</b> " + desc + '. Numbers that lean on it may be off. <a href="' + href("method", {}) + '">See the data feeds</a>';
        }
      }
      H.box = r[1] || {}; H.fixes = r[2] || {}; H.minScale = r[0] && r[0].cba && r[0].cba.min_scale;
      H.keep = load("keep", {}) || {};
      var adj0 = load("adj", {}) || {}; Object.keys(adj0).forEach(function (id) { if (H.W.P[id]) H.adj[id] = +adj0[id]; }); if (Object.keys(H.adj).length) H.reset();
      fillBox.checked = H.cfg.fill;
      $("#foot").innerHTML = "Rosters and contracts as of " + esc(H.asOf) + ". Updated every day from Basketball-Reference, ESPN, DARKO, pbpstats and the Big Board. " + howLink() + ".";
      render();
      // a link straight to a player's card (My teams uses it): /nba/?card=<id>
      var dl = new URLSearchParams(location.search).get("card"); if (dl && H.W.P[dl]) openCard(dl); else if (dl && window.Search) Search.miss(dl);
    })
    .catch(function (e) { view.innerHTML = '<p class="loading">Couldn\'t load the league: ' + esc(e.message) + "</p>"; });
  // find any player or team (assets/search.js)
  if (window.Search) Search.mount({ sport: "nba", placeholder: "Search NBA players and teams", hint: "Type a player or a team, like Tatum or Celtics.",
    index: function () {
      if (!H || !H.W || !H.W.P) return [];
      var out = Object.keys(H.teams).map(function (c) { var t = team(c); return { id: c, kind: "t", name: t.name, sub: (t.conf === "E" ? "East" : "West") + (t.w != null ? ", " + t.w + "-" + t.l : ""), also: c + " " + (t.short || ""), w: 5 }; });
      Object.keys(H.W.P).forEach(function (id) { var p = H.W.P[id]; if (!p || !p.n || p.fill) return; var t = team(p.t); out.push({ id: id, kind: "p", name: p.n, sub: (H.teams[p.t] ? t.short : "Free agent") + (p.pos ? ", " + p.pos : ""), also: (t.name || "") + " " + (p.t || ""), w: Math.min(5, (H.salary(p, 0) || 0) / 1e7) }); });
      return out;
    },
    pic: function (x, s) { return x.kind === "t" ? logo(x.id, s) : face(H.W.P[x.id], s); },
    open: function (x) { if (x.kind === "t") location.hash = href("team/" + x.id, {}); else openCard(x.id); } });
})();
