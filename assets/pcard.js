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
    var b = e.target.closest && e.target.closest(".pc [data-ctab]");
    if (!b) return;
    var root = b.closest(".pc"), id = b.getAttribute("data-ctab");
    root.querySelectorAll("[data-ctab]").forEach(function (x) { x.setAttribute("aria-selected", x === b); });
    root.querySelectorAll("[data-pane]").forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== id; });
    last = id; try { sessionStorage.setItem("pcard.tab", id); } catch (err) {}
  });

  // The shared team page header: logo, name, a line of context, chips, up to four headline numbers, then the page's
  // sections as tabs (links: each is a route in the hub). o: {logo, name, color, meta: [..], chips: [[text, kind]],
  // head: [{v, l, tone}], tabs: [{label, href, on}], after (markup under the tabs, like a team picker)}
  function teamHead(o) {
    var head = (o.head || []).filter(function (x) { return x && x.v != null && x.v !== ""; }).slice(0, 4);
    var chips = (o.chips || []).filter(function (c) { return c && c[0]; });
    return '<section class="pt" style="--tc:' + esc(o.color || "var(--ink)") + '"><div class="pt-hd">' + (o.logo ? '<div class="pt-logo">' + o.logo + "</div>" : "") + "<div><h2>" + esc(o.name) + "</h2>" +
      '<div class="pc-meta">' + (o.meta || []).filter(Boolean).map(function (m) { return "<span>" + m + "</span>"; }).join("") + "</div></div></div>" +
      (chips.length ? '<div class="pc-chips">' + chips.map(function (c) { return '<span class="pc-chip' + (c[1] ? " " + c[1] : "") + '">' + esc(c[0]) + "</span>"; }).join("") + "</div>" : "") +
      (head.length ? '<div class="pc-head" style="--n:' + head.length + '">' + head.map(function (x) { return "<div><b" + (x.tone ? ' class="' + x.tone + '"' : "") + ">" + (x.html ? x.v : esc(x.v)) + "</b><span>" + esc(x.l) + "</span></div>"; }).join("") + "</div>" : "") +
      ((o.tabs || []).length > 1 ? '<nav class="pt-tabs" aria-label="Team pages">' + o.tabs.map(function (t) { return '<a href="' + t.href + '"' + (t.on ? ' aria-current="page"' : "") + ">" + esc(t.label) + "</a>"; }).join("") + "</nav>" : "") +
      "</section>" + (o.after || "");
  }

  window.PCard = { html: html, sec: sec, bars: bars, line: line, facts: facts, table: table, color: color, esc: esc, teamHead: teamHead };
})();
