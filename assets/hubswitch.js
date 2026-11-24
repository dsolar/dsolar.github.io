/* Sport switcher for the hubs (mlb/, nba/, nfl/, nhl/, cbb/, cfb/): MLB · NBA · NFL · NHL · CBB · CFB pills at the top of each hub's header.
   Switching keeps you on the same kind of page where the other hub has one (Trade Value to Trade Value, Free Agents
   to Free Agents, contracts to contracts), and otherwise lands on that hub's front page. */
(function () {
  "use strict";
  var HUBS = ["mlb", "nba", "nfl", "nhl", "cbb", "cfb"];
  var here = (location.pathname.match(/\/(mlb|nba|nfl|nhl|cbb|cfb|my-teams)\/?/) || [])[1];
  if (!here) return;
  if (here === "my-teams") here = "mine";

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

  var css = ".hubswitch{display:flex;gap:6px;margin:0 0 12px}" +
    ".hubswitch a{font:700 12px/1 var(--body,system-ui);letter-spacing:.08em;padding:6px 11px;border-radius:999px;text-decoration:none;" +
    "color:var(--muted,#667);border:1px solid var(--rule,#d9dce1);background:transparent}" +
    ".hubswitch a:hover{color:var(--ink,#111);border-color:var(--ink,#111)}" +
    ".hubswitch a[aria-current=page]{color:#fff;background:var(--navy,#002244);border-color:var(--navy,#002244)}" +
    ".hubswitch a.hs-mine span:first-child{color:#d4a514}.hubswitch a.hs-mine{letter-spacing:.02em}" +
    // phones: all six pills fit on one line, and a page's intro paragraph folds to two lines (tap to read it all)
    "@media (max-width:640px){.hubswitch{gap:4px;justify-content:space-between}.hubswitch a{flex:1 1 0;text-align:center;letter-spacing:.02em;padding:6px 0;font-size:11.5px}.hubswitch a.hs-mine{flex:0 0 32px}.hubswitch .hs-l{display:none}" +
    "p.lede{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;cursor:pointer}p.lede.open{display:block;-webkit-line-clamp:unset}}";
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  document.addEventListener("click", function (e) {
    var p = e.target.closest && e.target.closest("p.lede");
    if (p && !e.target.closest("a,button,input,select") && window.matchMedia("(max-width:640px)").matches) p.classList.toggle("open");
  });

  var nav = document.createElement("nav");
  nav.className = "hubswitch";
  nav.setAttribute("aria-label", "Switch sport");
  // My teams first: every team you follow, across the hubs (my-teams/)
  nav.innerHTML = '<a href="../my-teams/" class="hs-mine"' + (here === "mine" ? ' aria-current="page"' : "") + ' data-hub="mine" aria-label="My teams"><span aria-hidden="true">★</span><span class="hs-l"> My teams</span></a>' + HUBS.map(function (s) {
    return '<a href="../' + s + '/"' + (s === here ? ' aria-current="page"' : "") + ' data-hub="' + s + '">' + ({ cbb: "NCAAB", cfb: "NCAAF" }[s] || s.toUpperCase()) + "</a>";
  }).join("");
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
  window.addEventListener("hashchange", function () { Array.prototype.forEach.call(nav.querySelectorAll("a"), aim); });

  function place() {
    var mast = document.querySelector(".mast");
    if (!mast) return;
    var kicker = mast.querySelector(".kicker");
    (kicker ? kicker.parentNode : mast).insertBefore(nav, kicker || mast.firstChild);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", place); else place();
})();
