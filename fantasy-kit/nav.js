/* Draft Lab's one navigation, shared by every Draft Lab page: the home page and sport pages (fantasy/), and the
   draft, league and quick-game pages (fantasy-kit/).

   FK.nav.TABS                  the sections, in order: [key, label]
   FK.nav.href(tab, o)          a section's address (URLS): Draft Lab's pages all live under /fantasy/, their files under
                                /fantasy-kit/. o.sport: the sport for the demo league; o.here: on the mock draft page
                                itself, where the draft room is just a hash
   FK.nav.HOME                  the home page ("/fantasy/")
   FK.nav.SPORTS                the sport pages: [key, label], each at fantasy/<key>/ */
(function (root) {
  "use strict";
  var TABS = [["home", "Home"], ["leagues", "My leagues"], ["draft", "Mock draft"], ["rankings", "Rankings"], ["week", "Quick games"]];   // Pools is its own product now: the Hubs / Draft Lab / Pools switch
  var SPORTS = [["nba", "NBA"], ["nfl", "NFL"], ["nhl", "NHL"], ["mlb", "MLB"], ["cbb", "NCAAB"], ["cfb", "NCAAF"]];
  var HOME = "/fantasy/";
  var URLS = { home: HOME, leagues: "/fantasy/leagues/", draft: "/fantasy/mock/", rankings: "/fantasy/rankings/", week: "/fantasy/quick/", pools: "/fantasy/pools/", league: "/fantasy/demo/" };
  function href(tab, o) {
    o = o || {};
    var q = o.sport ? "?s=" + encodeURIComponent(o.sport) : "";
    if (tab === "league") return URLS.league + q;
    // the mock draft's room is a hash on its own page
    if (tab === "draft") return (o.here ? "" : URLS.draft + q) + "#draft";
    if (["rankings", "week"].includes(tab)) return URLS[tab] + q;
    return URLS[tab] || HOME;
  }
  // a league's own page
  var leagueUrl = function (id) { return "/fantasy/league/?id=" + encodeURIComponent(id); };
  // On a phone the site bar, the Draft Lab bar and a page's own row take a third of the screen. Scrolling down tucks
  // the site bar away (body.fk-tuck); scrolling up, or reaching the top, brings it back.
  function tuck() {
    if (typeof window === "undefined" || !window.matchMedia) return;
    var mq = window.matchMedia("(max-width: 760px)"), last = window.scrollY || 0, on = false;
    var set = function (x) { if (x !== on) { on = x; document.body.classList.toggle("fk-tuck", x); } };
    window.addEventListener("scroll", function () {
      var y = window.scrollY || 0;
      if (!mq.matches || y < 80) set(false);
      else if (y > last + 6) set(true);
      else if (y < last - 6) set(false);
      last = y;
    }, { passive: true });
  }
  if (typeof document !== "undefined") { if (document.body) tuck(); else document.addEventListener("DOMContentLoaded", tuck); }
  /* Player search in the masthead: findHtml(kit) is the box; typing searches every sport's players (data/search.json,
     loaded on first use) and a pick opens his card on the rankings page (fantasy/rankings/?s=<sport>&p=<id>). */
  var SHORT = { nba: "NBA", nfl: "NFL", nhl: "NHL", mlb: "MLB", cbb: "NCAAB", cfb: "NCAAF" };
  var esc = function (x) { return String(x == null ? "" : x).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var norm = function (x) { return String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); };
  function findHtml(kit) {
    return '<form class="fk-find" role="search" data-kit="' + esc(kit || "") + '" onsubmit="return false"><label class="sr" for="fk-find-q">Find a player</label>' +
      '<input id="fk-find-q" type="search" placeholder="Find a player" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-controls="fk-find-r" aria-expanded="false">' +
      '<ul id="fk-find-r" class="fk-find-r" role="listbox" hidden></ul></form>';
  }
  var index = null;
  function loadIndex(kit) {
    if (!index) index = fetch(kit + "data/search.json").then(function (r) { return r.ok ? r.json() : { players: [] }; }).then(function (d) {
      return (d.players || []).map(function (r) { return { k: r[0], id: r[1], n: r[2], t: r[3], pos: r[4], q: norm(r[2]) }; });
    }).catch(function () { return []; });
    return index;
  }
  function find(list, q) {
    var words = norm(q).split(" ").filter(Boolean); if (!words.length) return [];
    var out = [];
    for (var i = 0; i < list.length && out.length < 200; i++) {
      var p = list[i], ok = true, score = 0;
      for (var j = 0; j < words.length; j++) {
        var at = p.q.indexOf(words[j]);
        if (at < 0) { ok = false; break; }
        score += at === 0 ? 3 : p.q.charAt(at - 1) === " " ? 2 : 0;
      }
      if (ok) out.push({ p: p, s: score });
    }
    out.sort(function (a, b) { return b.s - a.s || a.p.n.length - b.p.n.length; });
    return out.slice(0, 8).map(function (x) { return x.p; });
  }
  function wireFind() {
    if (typeof document === "undefined") return;
    var t = null;
    document.addEventListener("input", function (e) {
      var box = e.target.closest && e.target.closest(".fk-find"); if (!box || e.target.tagName !== "INPUT") return;
      var input = e.target, ul = box.querySelector(".fk-find-r"), kit = box.dataset.kit || "";
      clearTimeout(t);
      t = setTimeout(function () {
        loadIndex(kit).then(function (list) {
          var hits = find(list, input.value);
          ul.innerHTML = hits.map(function (p, i) {
            return '<li role="option" id="fk-find-' + i + '"><a href="' + esc(URLS.rankings + "?s=" + p.k + "&p=" + encodeURIComponent(p.id)) + '"><b>' + esc(p.n) + '</b><small>' + esc(SHORT[p.k] || p.k) + " &middot; " + esc(p.pos) + (p.t ? " &middot; " + esc(p.t) : "") + "</small></a></li>";
          }).join("") || (input.value.trim().length > 1 ? '<li class="none">No players by that name</li>' : "");
          ul.hidden = !ul.innerHTML; input.setAttribute("aria-expanded", String(!ul.hidden));
        });
      }, 120);
    });
    document.addEventListener("focusin", function (e) { var box = e.target.closest && e.target.closest(".fk-find"); if (box) loadIndex(box.dataset.kit || ""); });
    document.addEventListener("keydown", function (e) {
      var box = e.target.closest && e.target.closest(".fk-find"); if (!box) return;
      var links = Array.prototype.slice.call(box.querySelectorAll(".fk-find-r a")), i = links.indexOf(document.activeElement);
      if (e.key === "ArrowDown" && links.length) { e.preventDefault(); links[Math.min(links.length - 1, i + 1)].focus(); }
      else if (e.key === "ArrowUp" && links.length) { e.preventDefault(); if (i <= 0) box.querySelector("input").focus(); else links[i - 1].focus(); }
      else if (e.key === "Enter" && e.target.tagName === "INPUT" && links.length) { e.preventDefault(); links[0].click(); }
      else if (e.key === "Escape") { var ul = box.querySelector(".fk-find-r"); ul.hidden = true; box.querySelector("input").blur(); }
    });
    document.addEventListener("click", function (e) {
      document.querySelectorAll(".fk-find-r").forEach(function (ul) { if (!ul.parentNode.contains(e.target)) ul.hidden = true; });
    });
  }
  wireFind();
  var nav = { TABS: TABS, SPORTS: SPORTS, HOME: HOME, URLS: URLS, leagueUrl: leagueUrl, href: href, findHtml: findHtml };
  if (typeof module !== "undefined" && module.exports) module.exports = nav;
  else (root.FK = root.FK || {}).nav = nav;
})(this);
