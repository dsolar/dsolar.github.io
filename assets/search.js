// Find any player or team in a hub: a Search button in the hub's header (or "/" from anywhere on the page) opens a box
// that matches as you type and opens the hub's own player card or team page. Each hub calls Search.mount once:
//   Search.mount({ sport, hint, index: () => [{id, kind: "p" | "t", name, sub, also, w}], pic: (item, size) => markup,
//                  open: (item) => {} })
//   index  every player and team; built the first time the box opens (the hub's data is loaded by then).
//          also: other words that should match (team name, school, position), w: how prominent (sorts ties)
//   pic    the headshot or logo for a result
//   open   what picking a result does: the hub's openCard(id) for a player, its team route for a team
// Recent picks are kept per hub (ds-srch:<sport>) and shown before you type.
(function () {
  if (window.Search) return;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var norm = function (s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); };
  var cfg = null, idx = null, dlg = null, input = null, list = null, cur = 0, shown = [];

  function build() {
    idx = (cfg.index() || []).filter(function (x) { return x && x.name; }).map(function (x) {
      var n = norm(x.name);
      return { x: x, n: n, words: n.split(" "), also: norm(x.also || "").split(" ").filter(Boolean) };
    });
  }
  // every word typed has to start a word of the name (or of the extra words); a match at the start of the name ranks first
  function find(q) {
    var t = norm(q).split(" ").filter(Boolean);
    if (!t.length) return [];
    var out = [];
    idx.forEach(function (e) {
      var s = 0;
      for (var i = 0; i < t.length; i++) {
        var w = t[i], inName = e.words.some(function (x) { return x.indexOf(w) === 0; });
        if (inName) { s += 10; continue; }
        if (e.also.some(function (x) { return x.indexOf(w) === 0; })) { s += 3; continue; }
        return;
      }
      if (e.n.indexOf(t.join(" ")) === 0) s += 8;
      if (e.n === t.join(" ")) s += 20;
      out.push({ e: e, s: s + Math.min(5, (e.x.w || 0)) + (e.x.kind === "t" ? 2 : 0) });
    });
    out.sort(function (a, b) { return b.s - a.s || (b.e.x.w || 0) - (a.e.x.w || 0) || a.e.n.localeCompare(b.e.n); });
    var teams = out.filter(function (r) { return r.e.x.kind === "t"; }).slice(0, 4), players = out.filter(function (r) { return r.e.x.kind !== "t"; }).slice(0, 10);
    // whichever group holds the best match goes first
    var first = players.length && (!teams.length || players[0].s > teams[0].s) ? players.concat(teams) : teams.concat(players);
    return first.map(function (r) { return r.e.x; });
  }
  function hl(name, q) {
    var t = norm(q).split(" ").filter(Boolean), parts = String(name).split(/(\s+)/);
    return parts.map(function (p) { var n = norm(p); return n && t.some(function (w) { return n.indexOf(w) === 0; }) ? "<mark>" + esc(p) + "</mark>" : esc(p); }).join("");
  }
  var KEY = function () { return "ds-srch:" + cfg.sport; };
  function recent() { try { return JSON.parse(localStorage.getItem(KEY())) || []; } catch (e) { return []; } }
  function remember(x) {
    var r = recent().filter(function (y) { return !(y.id === x.id && y.kind === x.kind); });
    r.unshift({ id: x.id, kind: x.kind });
    try { localStorage.setItem(KEY(), JSON.stringify(r.slice(0, 6))); } catch (e) { /* private mode */ }
  }
  function draw() {
    var q = input.value;
    var items, head;
    if (norm(q)) { items = find(q); head = items.length ? "" : '<p class="ds-sr-empty">No player or team matches “' + esc(q) + "”.</p>"; }
    else {
      var byKey = {}; idx.forEach(function (e) { byKey[e.x.kind + ":" + e.x.id] = e.x; });
      items = recent().map(function (r) { return byKey[r.kind + ":" + r.id]; }).filter(Boolean);
      head = items.length ? '<p class="ds-sr-lbl">Recent</p>' : '<p class="ds-sr-empty">' + esc(cfg.hint || "Type a player or a team.") + "</p>";
    }
    shown = items; cur = 0;
    var lastKind = null;
    list.innerHTML = head + items.map(function (x, i) {
      var lbl = norm(q) && x.kind !== lastKind ? '<p class="ds-sr-lbl">' + (x.kind === "t" ? "Teams" : "Players") + "</p>" : "";
      lastKind = x.kind;
      return lbl + '<div class="ds-sr" role="option" id="ds-sr-' + i + '" data-i="' + i + '" aria-selected="' + (i === cur) + '"><span class="ds-sr-pic">' + (cfg.pic ? cfg.pic(x, 32) : "") + '</span><span class="ds-sr-txt"><b>' + (norm(q) ? hl(x.name, q) : esc(x.name)) + "</b><small>" + esc(x.sub || "") + "</small></span></div>";
    }).join("");
    input.setAttribute("aria-activedescendant", items.length ? "ds-sr-0" : "");
  }
  function move(d) {
    if (!shown.length) return;
    cur = (cur + d + shown.length) % shown.length;
    list.querySelectorAll(".ds-sr").forEach(function (el) { el.setAttribute("aria-selected", +el.dataset.i === cur); });
    var el = list.querySelector('[data-i="' + cur + '"]'); if (el) el.scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", "ds-sr-" + cur);
  }
  function pick(i) {
    var x = shown[i]; if (!x) return;
    remember(x); close();
    setTimeout(function () { cfg.open(x); }, 0);
  }
  function close() { if (dlg && dlg.open) dlg.close(); }
  function open() {
    if (!cfg) return;
    if (!idx || !idx.length) build();
    if (!dlg) {
      dlg = document.createElement("dialog"); dlg.className = "ds-srch"; dlg.setAttribute("aria-label", "Search");
      dlg.innerHTML = '<div class="ds-srch-box"><div class="ds-srch-in"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
        '<input type="search" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="ds-sr-list" aria-autocomplete="list"><button type="button" class="ds-srch-x">Close</button></div>' +
        '<div class="ds-srch-list" id="ds-sr-list" role="listbox"></div></div>';
      document.body.appendChild(dlg);
      input = dlg.querySelector("input"); list = dlg.querySelector(".ds-srch-list");
      input.addEventListener("input", draw);
      input.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
        else if (e.key === "Enter") { e.preventDefault(); pick(cur); }
      });
      list.addEventListener("click", function (e) { var r = e.target.closest(".ds-sr"); if (r) pick(+r.dataset.i); });
      list.addEventListener("mousemove", function (e) { var r = e.target.closest(".ds-sr"); if (r && +r.dataset.i !== cur) { cur = +r.dataset.i; list.querySelectorAll(".ds-sr").forEach(function (el) { el.setAttribute("aria-selected", +el.dataset.i === cur); }); } });
      dlg.querySelector(".ds-srch-x").addEventListener("click", close);
      dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });
    }
    input.placeholder = cfg.placeholder || "Search players and teams";
    input.value = "";
    draw();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    input.focus();
  }
  // "/" anywhere outside a text field opens it
  document.addEventListener("keydown", function (e) {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || !cfg) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable) || (dlg && dlg.open)) return;
    e.preventDefault(); open();
  });

  function button() {
    var mast = document.querySelector(".mast");
    if (!mast || mast.querySelector(".ds-sbtn")) return;
    var b = document.createElement("button");
    b.type = "button"; b.className = "ds-sbtn"; b.setAttribute("aria-label", cfg.placeholder || "Search players and teams");
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>Search</span><kbd>/</kbd>';
    b.addEventListener("click", open);
    // floats beside the hub's title (kicker and h1), clear of the sport pills above it
    var anchor = mast.querySelector(".kicker") || mast.querySelector("h1");
    if (anchor) anchor.parentNode.insertBefore(b, anchor); else mast.appendChild(b);
  }
  if (!document.getElementById("ds-srch-css")) {
    var st = document.createElement("style"); st.id = "ds-srch-css";
    st.textContent =
      ".ds-sbtn{float:right;margin:6px 0 0 12px;display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 12px 0 11px;border:1px solid var(--rule,#d5d9e0);border-radius:999px;background:var(--card,#fff);color:var(--ink,#111);font:600 14px/1 var(--body,inherit);cursor:pointer}" +
      ".ds-sbtn svg,.ds-srch-in svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;flex:none}.ds-sbtn kbd{font:600 11px/1 var(--body,inherit);color:var(--muted,#6b7280);border:1px solid var(--rule,#d5d9e0);border-radius:5px;padding:3px 6px}" +
      ".ds-sbtn:hover{border-color:var(--ink,#111)}.ds-sbtn:focus-visible{outline:2px solid var(--ink,#111);outline-offset:2px}" +
      "@media (max-width:640px){.ds-sbtn{width:42px;height:42px;padding:0;justify-content:center;margin-top:4px}.ds-sbtn span,.ds-sbtn kbd{display:none}}" +
      "dialog.ds-srch{padding:0;border:0;background:transparent;max-width:none;max-height:none;width:100%;height:100%;margin:0;inset:0}dialog.ds-srch::backdrop{background:rgba(15,23,42,.45)}" +
      ".ds-srch-box{width:min(600px,calc(100% - 24px));margin:10vh auto 0;background:var(--card,#fff);color:var(--ink,#111);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.25);overflow:hidden;display:flex;flex-direction:column;max-height:76vh}" +
      ".ds-srch-in{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 16px;border-bottom:1px solid var(--rule,#e5e7eb)}.ds-srch-in svg{color:var(--muted,#6b7280)}" +
      ".ds-srch-in input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:inherit;font:500 18px/1.3 var(--body,inherit);padding:6px 0}.ds-srch-in input::-webkit-search-cancel-button{display:none}" +
      ".ds-srch-x{border:0;background:var(--rule-2,#f1f3f6);color:inherit;border-radius:8px;padding:8px 10px;font:600 13px/1 var(--body,inherit);cursor:pointer}" +
      ".ds-srch-list{overflow-y:auto;padding:6px 6px 10px;overscroll-behavior:contain}.ds-sr-lbl{margin:10px 10px 4px;font:700 12px/1 var(--body,inherit);color:var(--muted,#6b7280)}.ds-sr-empty{margin:18px 12px;color:var(--muted,#6b7280);font-size:15px}" +
      ".ds-sr{display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:10px;cursor:pointer}.ds-sr[aria-selected=true]{background:var(--rule-2,#f1f3f6)}" +
      ".ds-sr-pic{width:32px;height:32px;flex:none;display:grid;place-items:center;overflow:hidden;border-radius:50%}.ds-sr-pic img{width:32px!important;height:32px!important;object-fit:contain}" +
      ".ds-sr-txt{min-width:0}.ds-sr-txt b{display:block;font-size:15.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ds-sr-txt small{display:block;margin-top:2px;font-size:13px;color:var(--muted,#6b7280)}" +
      ".ds-sr mark{background:none;color:inherit;font-weight:800}" +
      "@media (max-width:640px){.ds-srch-box{width:100%;height:100%;max-height:none;margin:0;border-radius:0}.ds-srch-in input{font-size:17px}}";
    document.head.appendChild(st);
  }
  function mount(c) {
    cfg = c; idx = null;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", button); else button();
  }
  // a hub whose data changed (a new day, a trade) can ask for the list to be rebuilt
  window.Search = { mount: mount, open: open, refresh: function () { idx = null; } };
})();
