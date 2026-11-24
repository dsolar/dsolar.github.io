/* Shared player card for the hubs (and later Draft Lab): one frame, tabs per kind of data.
   window.PCard.html(o) returns the card's markup for a hub's <dialog id="card"> body:
     o.face     markup for the headshot (the hub's own face())
     o.name     player name (plain text)
     o.color    team color, for the ring around the face
     o.team     markup for the team (logo + name, maybe a link)
     o.meta     [strings]  position, age, class, size...
     o.chips    [[text, kind]]  kind: "inj" (amber), "tag" (blue), "" (plain); text is plain
     o.head     [{v, l, tone}]  up to four headline numbers; tone "up" / "dn" colors the number
     o.tabs     [{id, label, html}]  in the shared order: Overview, Stats, Skills, Shooting, Tracking, Contract, Draft
     o.tab      the tab to open (falls back to the first; the last tab picked is remembered across cards)
     o.foot     markup under the tabs (buttons, notes)
   Pieces for the panes: PCard.sec, PCard.bars, PCard.line, PCard.facts, PCard.table.
   Tabs use [data-ctab] buttons and [data-pane] panes (the NBA Hub's existing contract); clicks are handled here. */
(function () {
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var last = null;
  try { last = sessionStorage.getItem("pcard.tab"); } catch (e) {}

  function html(o) {
    var tabs = (o.tabs || []).filter(function (t) { return t && t.html; });
    var want = o.tab || last, cur = tabs.some(function (t) { return t.id === want; }) ? want : tabs.length ? tabs[0].id : null;
    var h = '<div class="pc"><div class="pc-hd" style="--tc:' + esc(o.color || "var(--ink)") + '"><div class="pc-face">' + (o.face || "") + "</div><div><h3>" + esc(o.name) + "</h3>" +
      '<div class="pc-meta">' + (o.team ? '<span class="pc-tm">' + o.team + "</span>" : "") + (o.meta || []).filter(Boolean).map(function (m) { return "<span>" + esc(m) + "</span>"; }).join("") + "</div></div></div>";
    var chips = (o.chips || []).filter(function (c) { return c && c[0]; });
    if (chips.length) h += '<div class="pc-chips">' + chips.map(function (c) { return '<span class="pc-chip' + (c[1] ? " " + c[1] : "") + '">' + esc(c[0]) + "</span>"; }).join("") + "</div>";
    var head = (o.head || []).filter(function (x) { return x && x.v != null && x.v !== ""; }).slice(0, 4);
    if (head.length) h += '<div class="pc-head" style="--n:' + head.length + '">' + head.map(function (x) { return "<div><b" + (x.tone ? ' class="' + x.tone + '"' : "") + ">" + esc(x.v) + "</b><span>" + esc(x.l) + "</span></div>"; }).join("") + "</div>";
    if (tabs.length > 1) h += '<div class="ctabs pc-tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" data-ctab="' + t.id + '" aria-selected="' + (t.id === cur) + '">' + esc(t.label) + "</button>"; }).join("") + "</div>";
    h += tabs.map(function (t) { return '<div class="cpane pc-pane" data-pane="' + t.id + '"' + (t.id === cur ? "" : " hidden") + ">" + t.html + "</div>"; }).join("");
    if (o.foot) h += '<div class="pc-foot">' + o.foot + "</div>";
    return h + "</div>";
  }

  // a section label, with an optional note on the right ("percentile vs guards")
  function sec(title, aside) { return '<p class="pc-sec"><span>' + esc(title) + "</span>" + (aside ? "<em>" + esc(aside) + "</em>" : "") + "</p>"; }

  // percentile color: blue below average, gray around it, red above
  function color(v) {
    var t = Math.max(0, Math.min(100, v)) / 100, mx = function (a, b, k) { return Math.round(a + (b - a) * k); };
    var c = t < 0.5 ? [mx(47, 190, t * 2), mx(107, 196, t * 2), mx(181, 206, t * 2)] : [mx(190, 198, (t - 0.5) * 2), mx(196, 12, (t - 0.5) * 2), mx(206, 48, (t - 0.5) * 2)];
    return "rgb(" + c.join(",") + ")";
  }
  // rows: [{label, sub, pct}] (pct 0-100; null rows are skipped). The shared percentile row.
  function bars(rows) {
    return '<div class="pc-bars">' + rows.filter(function (r) { return r && r.pct != null && isFinite(r.pct); }).map(function (r) {
      var v = Math.round(r.pct);
      return '<div class="pc-pr"><span class="l">' + esc(r.label) + (r.sub != null && r.sub !== "" ? "<small>" + esc(r.sub) + "</small>" : "") + '</span><span class="bar"><i style="width:' + Math.max(3, v) + "%;background:" + color(v) + '"></i></span><span class="n">' + v + "</span></div>";
    }).join("") + "</div>";
  }
  // the next game: {when: [line1, line2], what: markup, sub: text, right: text}
  function line(g) {
    return '<div class="pc-line"><span class="when">' + (g.when || []).map(esc).join("<br>") + '</span><span class="what">' + (g.what || "") + (g.sub ? "<small>" + esc(g.sub) + "</small>" : "") + "</span>" + (g.right ? '<span class="r">' + esc(g.right) + "</span>" : "") + "</div>";
  }
  // small facts, three across: [[value, label], ...]
  function facts(list) {
    return '<div class="pc-facts">' + list.filter(function (x) { return x && x[0] != null && x[0] !== ""; }).map(function (x) { return "<div><b>" + esc(x[0]) + "</b><span>" + (x[2] ? x[1] : esc(x[1])) + "</span></div>"; }).join("") + "</div>";
  }
  // a compact table that scrolls sideways: head [labels], rows [[cells]] (cells are text), cur = index of the row to bold
  function table(head, rows, cur) {
    return '<div class="pc-tw"><table><thead><tr>' + head.map(function (x) { return "<th>" + esc(x) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r, i) { return "<tr" + (i === cur ? ' class="cur"' : "") + ">" + r.map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".pc [data-ctab], .pgw [data-ctab]");
    if (!b) return;
    var root = b.closest(".pc, .pgw"), id = b.getAttribute("data-ctab"), game = root.classList.contains("pgw");
    root.querySelectorAll("[data-ctab]").forEach(function (x) { if (x.closest(".pc, .pgw") === root) x.setAttribute("aria-selected", x === b); });
    root.querySelectorAll("[data-pane]").forEach(function (p) { if (p.closest(".pc, .pgw") === root) p.hidden = p.getAttribute("data-pane") !== id; });
    if (game) { gameLast = id; try { sessionStorage.setItem("pgame.tab", id); } catch (err) {} }
    else { last = id; try { sessionStorage.setItem("pcard.tab", id); } catch (err) {} }
  });

  // The shared game page: a scoreboard header, up to four numbers, the win-probability bar, then tabs in the same order
  // on every hub (Matchup, Players, Injuries, Betting, Details). o:
  //   away, home   {logo, name, rec, href, score, color}   (score shows once the game is live or final)
  //   at           "at" or "vs" (neutral site)
  //   status       markup: tip time and TV, "Final", or the live clock
  //   meta         [markup]  week, conference game, venue...
  //   head         [{v, l, tone, html}]  the hub's line, the book's line, the total, a market price
  //   prob         {away: 0-1, src: "Hub" / "Kalshi"}  the bar under the numbers
  //   verdict      markup: one line on what the numbers say ("BYU by 2.5, projected 76-73")
  //   tabs         [{id, label, html}]  ids: matchup, players, injuries, betting, details (others allowed)
  //   tab          the tab to open (else the last one picked on any game page, else the first)
  //   before       markup above the header (a back link, the matchup pickers)
  var gameLast = null;
  try { gameLast = sessionStorage.getItem("pgame.tab"); } catch (e) {}
  function game(o) {
    var side = function (t, k) {
      var sc = t.score != null && t.score !== "" ? '<b class="pg-sc">' + esc(t.score) + "</b>" : "";
      return '<a class="pg-t pg-' + k + (t.won ? " won" : "") + '" href="' + esc(t.href || "#") + '" style="--tc:' + esc(t.color || "var(--ink)") + '"><span class="pg-logo">' + (t.logo || "") + '</span><span class="pg-nm"><b>' + esc(t.name) + "</b><small>" + esc(t.rec || "") + "</small></span>" + sc + "</a>";
    };
    var head = (o.head || []).filter(function (x) { return x && x.v != null && x.v !== ""; }).slice(0, 4);
    var tabs = (o.tabs || []).filter(function (t) { return t && t.html; });
    var want = o.tab || gameLast, cur = tabs.some(function (t) { return t.id === want; }) ? want : tabs.length ? tabs[0].id : null;
    var pr = o.prob && o.prob.away != null && isFinite(o.prob.away) ? Math.max(0, Math.min(1, o.prob.away)) : null;
    var pc = function (x) { return x >= 0.995 ? ">99%" : x <= 0.005 ? "<1%" : Math.round(x * 100) + "%"; };
    var h = (o.before || "") + '<div class="pgw"><section class="pg">' +
      '<p class="pg-status">' + (o.status || "") + ((o.meta || []).filter(Boolean).length ? '<span class="pg-meta">' + o.meta.filter(Boolean).join(" · ") + "</span>" : "") + "</p>" +
      '<div class="pg-teams">' + side(o.away, "a") + '<span class="pg-at">' + esc(o.at || "at") + "</span>" + side(o.home, "h") + "</div>" +
      (o.verdict ? '<p class="pg-verdict">' + o.verdict + "</p>" : "") +
      (head.length ? '<div class="pc-head" style="--n:' + head.length + '">' + head.map(function (x) { return "<div><b" + (x.tone ? ' class="' + x.tone + '"' : "") + ">" + (x.html ? x.v : esc(x.v)) + "</b><span>" + esc(x.l) + "</span></div>"; }).join("") + "</div>" : "") +
      (pr != null ? '<div class="pg-prob" title="Chance to win' + (o.prob.src ? ", from " + esc(o.prob.src) : "") + '"><span class="pg-pa">' + pc(pr) + '</span><span class="pg-bar"><i style="width:' + (pr * 100).toFixed(1) + "%;background:" + esc(o.away.color || "var(--ink)") + '"></i><i style="background:' + esc(o.home.color || "var(--muted)") + '"></i></span><span class="pg-ph">' + pc(1 - pr) + "</span>" + (o.prob.src ? '<small class="pg-src">' + esc(o.prob.src) + "</small>" : "") + "</div>" : "") +
      (tabs.length > 1 ? '<div class="pg-tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" data-ctab="' + t.id + '" aria-selected="' + (t.id === cur) + '">' + esc(t.label) + "</button>"; }).join("") + "</div>" : "") +
      "</section>" + tabs.map(function (t) { return '<div class="pg-pane" data-pane="' + t.id + '"' + (t.id === cur ? "" : " hidden") + ">" + t.html + "</div>"; }).join("") + "</div>";
    return h;
  }

  // The shared team page header: logo, name, a line of context, chips, up to four headline numbers, then the page's
  // sections as tabs (links: each is a route in the hub). o: {logo, name, color, meta: [..], chips: [[text, kind]],
  // head: [{v, l, tone}], tabs: [{label, href, on}], after (markup under the tabs, like a team picker)}
  function teamHead(o) {
    var head = (o.head || []).filter(function (x) { return x && x.v != null && x.v !== ""; }).slice(0, 4);
    var chips = (o.chips || []).filter(function (c) { return c && c[0]; });
    return '<section class="pt" style="--tc:' + esc(o.color || "var(--ink)") + '"><div class="pt-hd">' + (o.logo ? '<div class="pt-logo">' + o.logo + "</div>" : "") + "<div><h2>" + esc(o.name) + "</h2>" +
      '<div class="pc-meta">' + (o.meta || []).filter(Boolean).map(function (m) { return "<span>" + m + "</span>"; }).join("") + "</div></div>" +
      // follow: {sport, id} puts the shared Follow star (assets/follow.js) in the corner
      (o.follow && window.Follow ? '<div class="pt-fol">' + window.Follow.star(o.follow.sport, o.follow.id, o.follow.name || o.name) + "</div>" : "") + "</div>" +
      (chips.length ? '<div class="pc-chips">' + chips.map(function (c) { return '<span class="pc-chip' + (c[1] ? " " + c[1] : "") + '">' + esc(c[0]) + "</span>"; }).join("") + "</div>" : "") +
      (head.length ? '<div class="pc-head" style="--n:' + head.length + '">' + head.map(function (x) { return "<div><b" + (x.tone ? ' class="' + x.tone + '"' : "") + ">" + (x.html ? x.v : esc(x.v)) + "</b><span>" + esc(x.l) + "</span></div>"; }).join("") + "</div>" : "") +
      ((o.tabs || []).length > 1 ? '<nav class="pt-tabs" aria-label="Team pages">' + o.tabs.map(function (t) { return '<a href="' + t.href + '"' + (t.on ? ' aria-current="page"' : "") + ">" + esc(t.label) + "</a>"; }).join("") + "</nav>" : "") +
      "</section>" + (o.after || "");
  }

  window.PCard = { html: html, sec: sec, bars: bars, line: line, facts: facts, table: table, color: color, esc: esc, teamHead: teamHead, game: game };
})();
