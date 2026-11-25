/* Sport switcher for the hubs (mlb/, nba/, nfl/, nhl/, cbb/, cfb/): MLB · NBA · NFL · NHL · CBB · CFB pills at the top of each hub's header.
   Switching keeps you on the same kind of page where the other hub has one (Trade Value to Trade Value, Free Agents
   to Free Agents, contracts to contracts), and otherwise lands on that hub's front page. */
(function () {
  "use strict";
  var HUBS = ["mlb", "nba", "nfl", "nhl", "cbb", "cfb"];
  var here = (location.pathname.match(/\/(mlb|nba|nfl|nhl|cbb|cfb|my-teams|tonight)\/?/) || [])[1];
  // the Big Board (draft/) wears the NBA or NFL hub's frame, by its address
  var onBoard = !here && /\/draft\//.test(location.pathname);
  if (onBoard) here = /^#nfl/.test(location.hash) ? "nfl" : "nba";
  if (!here) return;
  if (here === "my-teams" || here === "tonight") here = "mine";

  // Each hub's address for a kind of page. Kinds: standings, teams, contracts, value, builder, fa, method
  var TO = {
    mlb: { standings: "#standings", teams: "#teams", contracts: "#team/BOS?view=money", value: "#value", builder: "#trade", fa: "#fa", method: "#method" },
    nba: { standings: "#/standings", teams: "#/teams", contracts: "#/contracts/BOS", value: "#/value", builder: "#/trade", fa: "#/fa", method: "#/method" },
    nfl: { standings: "#/standings", teams: "#/teams", contracts: "#/cap", value: "#/trade", builder: "#/trade", fa: "#/fa", method: "#/method" },
    // its player ratings stand in for the other hubs' value boards
    nhl: { standings: "#/standings", teams: "#/teams", contracts: "#/contracts", value: "#/players", method: "#/method" },
    cbb: { standings: "#/ratings", teams: "#/teams", value: "#/players", method: "#/method" },
    cfb: { standings: "#/ratings", teams: "#/teams", value: "#/players", method: "#/method" }
  };
  // The kind of page this hub is showing now, from its address
  function kind() {
    var h = location.hash.replace(/^#\/?/, ""), route = h.split(/[/?]/)[0], q = h.split("?")[1] || "";
    if (here === "mlb") {
      if (route === "team") return /view=money/.test(q) ? "contracts" : "teams";
      if (route === "trade") return "builder";
      return { standings: 1, teams: 1, contracts: 1, value: 1, fa: 1, method: 1 }[route] ? route : null;
    }
    if (here === "nba") {
      if (route === "team") return "teams";
      if (route === "picks") return "contracts";
      if (route === "trade") return "builder";
      return { standings: 1, teams: 1, contracts: 1, value: 1, fa: 1, method: 1 }[route] ? route : null;
    }
    if (here === "nhl") {
      if (route === "team") return "teams";
      if (route === "players") return "value";
      return { standings: 1, teams: 1, contracts: 1, method: 1 }[route] ? route : null;
    }
    if (here === "mine") return null;
    if (here === "cfb") return { ratings: "standings", conferences: "standings", playoff: "standings", week: "standings", teams: "teams", team: "teams", players: "value", heisman: "value", prospects: "value", method: "method" }[route] || null;
    if (here === "cbb") return { ratings: "standings", conferences: "standings", bracket: "standings", bubble: "standings", today: "standings", teams: "teams", team: "teams", players: "value", naismith: "value", prospects: "value", method: "method" }[route] || null;
    // nfl: its Trade Value page is also where trades are built; Power Rankings sit with standings
    if (route === "trade") return "value";
    if (route === "cap" || route === "offseason") return "contracts";
    if (route === "power") return "standings";
    if (route === "players" || route === "team") return "teams";
    return { standings: 1, teams: 1, fa: 1, method: 1 }[route] ? route : null;
  }

  /* The same sport bar as Draft Lab's (fantasy/hub.css .fbar): a white strip right under the site header, each sport
     with its icon and color (fantasy-kit/sport-art.js), the one you're on filled in its color. */
  var SC = { mine: "#B88A14", mlb: "#3B6FF0", nba: "#C2410C", nfl: "#10A36B", nhl: "#168AA4", cbb: "#7C4DDB", cfb: "#C8102E" };
  var css = ".hubswitch{background:var(--card,#fff);border-bottom:1px solid var(--rule,#e1e5eb);box-shadow:0 1px 2px rgba(16,24,40,.05)}" +
    ".hubswitch .hs-in{display:flex;align-items:center;gap:4px;max-width:1180px;margin:0 auto;padding:0 max(16px,env(safe-area-inset-left));min-height:58px;overflow-x:auto;scrollbar-width:none}" +
    ".hubswitch .hs-in::-webkit-scrollbar{display:none}" +
    ".hubswitch a{--sp:#002244;flex:none;display:inline-flex;align-items:center;gap:8px;padding:8px 15px;border-radius:999px;font:800 14.5px/1 Barlow,var(--body,system-ui),sans-serif;color:#566273!important;text-decoration:none!important;white-space:nowrap;border:1px solid transparent;transition:background .12s,color .12s}" +
    ".hubswitch a svg{width:18px!important;height:18px!important;flex:none;color:var(--sp)!important;display:block}" +
    ".hubswitch a:hover{background:#ECEFF3;color:#0E1621!important}" +
    ".hubswitch a[aria-current=page]{background:var(--sp);color:#fff!important;box-shadow:0 4px 14px -6px var(--sp)}" +
    ".hubswitch a[aria-current=page] svg{color:#fff!important}" +
    ".hubswitch a:focus-visible{outline:2px solid var(--ink,#0E1621);outline-offset:2px}" +
    ".hubswitch .hs-sep{flex:none;width:1px;height:24px;background:var(--rule,#e1e5eb);margin:0 8px}" +
    // phones: a page's intro paragraph folds to two lines (tap to read it all)
    "@media (max-width:640px){.hubswitch .hs-in{min-height:52px;gap:2px}.hubswitch a{padding:8px 12px;font-size:14px}" +
    "p.lede{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;cursor:pointer}p.lede.open{display:block;-webkit-line-clamp:unset}}" +
    // the hub's kicker reads like Draft Lab's eyebrow: a short rule, then the words
    ".mast .kicker{display:inline-flex;align-items:center;gap:8px;letter-spacing:.12em}.mast .kicker::before{content:'';width:18px;height:2px;background:currentColor}";
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
  // the sport icons, the same drawings as Draft Lab's (fantasy-kit/sport-art.js), inline so no page's own icons get in the way
  var ICON = {"star": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z\"/></svg>", "mlb": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M6.2 5.2c2.2 1.9 3.2 4.2 3.2 6.8s-1 4.9-3.2 6.8M17.8 5.2c-2.2 1.9-3.2 4.2-3.2 6.8s1 4.9 3.2 6.8\"/><path d=\"M8.2 8l1.5-.6M9 11l1.6-.2M9 14l1.6.3M15.8 8l-1.5-.6M15 11l-1.6-.2M15 14l-1.6.3\" stroke-width=\"1.4\"/></svg>", "nba": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 3v18M3 12h18M5.6 5.6c2.4 2.2 3.4 4 3.4 6.4s-1 4.2-3.4 6.4M18.4 5.6c-2.4 2.2-3.4 4-3.4 6.4s1 4.2 3.4 6.4\"/></svg>", "nfl": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4.2 19.8C2.6 14 5 8.4 8.7 5.8 11.6 3.7 16 3.3 19.8 4.2c1.6 5.8-.8 11.4-4.5 14-2.9 2.1-7.3 2.5-11.1 1.6z\"/><path d=\"M9 15l6-6M10.5 10.5l1.5 1.5M12 9l1.5 1.5M9 12l1.5 1.5M5 14.5l4.5 4.5M14.5 5l4.5 4.5\"/></svg>", "nhl": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"m7 3 4 11 8-3 2 5-10 4a4 4 0 0 1-5-2L2 7\"/><ellipse cx=\"17\" cy=\"5\" rx=\"3.5\" ry=\"1.5\"/><path d=\"M13.5 5v2c0 2 7 2 7 0V5\"/></svg>", "cbb": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"4\" y=\"3\" width=\"16\" height=\"9\" rx=\"1.5\"/><rect x=\"9\" y=\"7\" width=\"6\" height=\"5\"/><path d=\"M7 12h10M8 12l1.5 9M16 12l-1.5 9M9 15h6M9.6 18h4.8M11 12l-.5 9M13 12l.5 9\"/></svg>", "cfb": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M6 3v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3\"/><path d=\"M12 13v8M9 21h6\"/></svg>"};
  var ART = { mine: "star", mlb: "mlb", nba: "nba", nfl: "nfl", nhl: "nhl", cbb: "cbb", cfb: "cfb" };
  function icons() {
    Array.prototype.forEach.call(nav.querySelectorAll("a[data-hub]"), function (a) { if (!a.querySelector("svg")) a.insertAdjacentHTML("afterbegin", ICON[ART[a.dataset.hub]]); });
  }

  document.addEventListener("click", function (e) {
    var p = e.target.closest && e.target.closest("p.lede");
    if (p && !e.target.closest("a,button,input,select") && window.matchMedia("(max-width:640px)").matches) p.classList.toggle("open");
  });

  var nav = document.createElement("nav");
  nav.className = "hubswitch";
  nav.setAttribute("aria-label", "Switch sport");
  // My teams first: every team you follow, across the hubs (my-teams/)
  nav.innerHTML = '<div class="hs-in"><a href="../my-teams/" class="hs-mine"' + (here === "mine" ? ' aria-current="page"' : "") + ' data-hub="mine" style="--sp:' + SC.mine + '">My teams</a><span class="hs-sep" aria-hidden="true"></span>' + HUBS.map(function (s) {
    return '<a href="../' + s + '/"' + (s === here ? ' aria-current="page"' : "") + ' data-hub="' + s + '" style="--sp:' + SC[s] + '">' + ({ cbb: "NCAAB", cfb: "NCAAF" }[s] || s.toUpperCase()) + "</a>";
  }).join("") + "</div>";
  icons();
  // links follow the page you're on, so they're set when you hover, focus or tap rather than once
  function aim(a) {
    var s = a.dataset.hub;
    if (s === here || s === "mine") return;
    var k = kind(), target = k && TO[s][k];
    a.href = "../" + s + "/" + (target || "");
  }
  Array.prototype.forEach.call(nav.querySelectorAll("a"), function (a) {
    ["mouseenter", "focus", "touchstart", "mousedown"].forEach(function (ev) { a.addEventListener(ev, function () { aim(a); }, { passive: true }); });
    aim(a);
  });
  window.addEventListener("hashchange", function () {
    if (onBoard) {   // the board switched between the NBA and NFL classes
      here = /^#nfl/.test(location.hash) ? "nfl" : "nba";
      Array.prototype.forEach.call(nav.querySelectorAll("a[data-hub]"), function (a) { if (a.dataset.hub === here) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    }
    Array.prototype.forEach.call(nav.querySelectorAll("a"), aim);
  });

  // right under the site header, the full width of the page
  function place() {
    var bar = document.querySelector("[data-ds-navigation]") || document.querySelector(".ds-navigation");
    if (bar && bar.parentNode) bar.parentNode.insertBefore(nav, bar.nextSibling);
    else { var mast = document.querySelector(".mast"); if (mast) mast.parentNode.insertBefore(nav, mast); }
    // on a phone the strip scrolls: start it with your sport in view
    var on = nav.querySelector("[aria-current]"), row = nav.querySelector(".hs-in");
    if (on && row && on.offsetLeft + on.offsetWidth > row.clientWidth) row.scrollLeft = on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", place); else place();
})();
