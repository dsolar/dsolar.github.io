/* Fantasy hub: the overview (/fantasy/) and the sport pages (/fantasy/nba/, /nfl/, /mlb/, /nhl/).

   A page says what it is with <body data-page="overview" | "nba" | "nfl" | "mlb" | "nhl">, and this file fills in the parts
   marked with data-* containers. Load after kit.css, hub.css, faces.css and these scripts (in order):
     fantasy-kit/sports.js, fantasy-kit/value.js, assets/faces.js, fantasy/hub.js
   Rankings, scoring options and categories come straight from Draft Lab (FK.sports, FK.value and its data files), so
   anything added there (a new category, a new stat) shows up here on its own. */
(function () {
  "use strict";
  var S = window.FK && window.FK.sports, V = window.FK && window.FK.value;
  var ROOT = (function () { var s = document.currentScript && document.currentScript.src; return s ? s.replace(/fantasy\/hub\.js.*$/, "") : "/"; })();
  var KIT = ROOT + "fantasy-kit/";
  var page = document.body.dataset.page || "overview";
  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var read = function (k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };

  /* ---------- icons and fields ---------- */
  var SPRITE = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
    '<symbol id="i-nhl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m7 3 4 11 8-3 2 5-10 4a4 4 0 0 1-5-2L2 7"/><ellipse cx="17" cy="5" rx="3.5" ry="1.5"/><path d="M13.5 5v2c0 2 7 2 7 0V5"/></symbol>' +
    '<symbol id="f-nhl" viewBox="0 0 420 280" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="2.5"><rect x="25" y="25" width="370" height="230" rx="65"/><path d="M210 25v230M140 25v230M280 25v230M60 55v170M360 55v170"/><circle cx="210" cy="140" r="35"/><circle cx="100" cy="85" r="25"/><circle cx="100" cy="195" r="25"/><circle cx="320" cy="85" r="25"/><circle cx="320" cy="195" r="25"/><path d="M60 120a20 20 0 0 1 0 40M360 120a20 20 0 0 0 0 40"/></symbol>' +
    '<symbol id="i-nba" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6c2.4 2.2 3.4 4 3.4 6.4s-1 4.2-3.4 6.4M18.4 5.6c-2.4 2.2-3.4 4-3.4 6.4s1 4.2 3.4 6.4"/></symbol>' +
    '<symbol id="i-nfl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.2 19.8C2.6 14 5 8.4 8.7 5.8 11.6 3.7 16 3.3 19.8 4.2c1.6 5.8-.8 11.4-4.5 14-2.9 2.1-7.3 2.5-11.1 1.6z"/><path d="M9 15l6-6M10.5 10.5l1.5 1.5M12 9l1.5 1.5M9 12l1.5 1.5M5 14.5l4.5 4.5M14.5 5l4.5 4.5"/></symbol>' +
    '<symbol id="i-mlb" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M6.2 5.2c2.2 1.9 3.2 4.2 3.2 6.8s-1 4.9-3.2 6.8M17.8 5.2c-2.2 1.9-3.2 4.2-3.2 6.8s1 4.9 3.2 6.8"/><path d="M8.2 8l1.5-.6M9 11l1.6-.2M9 14l1.6.3M15.8 8l-1.5-.6M15 11l-1.6-.2M15 14l-1.6.3" stroke-width="1.4"/></symbol>' +
    '<symbol id="i-home" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/></symbol>' +
    '<symbol id="i-draft" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M9 9v11M15 9v11"/></symbol>' +
    '<symbol id="i-rank" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V11M10 20V5M16 20v-6M22 20H2"/></symbol>' +
    '<symbol id="i-friends" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.7.8 2.7 2.5 3 5.2"/></symbol>' +
    '<symbol id="i-bolt" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></symbol>' +
    '<symbol id="i-cap" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18M3 17h18"/><path d="M7 7v10M12 4v16M17 7v10"/></symbol>' +
    '<symbol id="i-one" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></symbol>' +
    '<symbol id="i-star" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></symbol>' +
    '<symbol id="i-mask" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0 0 6-3 9-6 9-1.5 0-2.3-1-3-2-.7 1-1.5 2-3 2-3 0-6-3-6-9z"/><path d="M7 11h2M15 11h2"/></symbol>' +
    '<symbol id="i-fang" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16l-2 6H6z"/><path d="M8 11l1.5 5L11 11M13 11l1.5 5L16 11"/></symbol>' +
    '<symbol id="i-half" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" opacity=".35"/></symbol>' +
    '<symbol id="i-seed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21v-9"/><path d="M12 12c0-4 3-7 7-7 0 4-3 7-7 7zM12 14c0-3-2.5-5.5-6-5.5 0 3 2.5 5.5 6 5.5z"/></symbol>' +
    '<symbol id="i-key" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/></symbol>' +
    '<symbol id="i-roto" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.3h18M3 14.6h18M9 4v16"/></symbol>' +
    '<symbol id="f-nba" viewBox="0 0 420 280" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="2.5"><rect x="20" y="20" width="420" height="240"/><rect x="250" y="88" width="190" height="104"/><circle cx="250" cy="140" r="52"/><path d="M440 34H330a118 118 0 0 0 0 212h110"/><circle cx="395" cy="140" r="9"/><path d="M408 120v40"/><circle cx="20" cy="140" r="44"/></symbol>' +
    '<symbol id="f-nfl" viewBox="0 0 420 280" fill="none" stroke="#fff" stroke-opacity=".15" stroke-width="2.5"><path d="M40 0v280M110 0v280M180 0v280M250 0v280M320 0v280M390 0v280"/><path d="M75 96v10M145 96v10M215 96v10M285 96v10M355 96v10M75 174v10M145 174v10M215 174v10M285 174v10M355 174v10" stroke-width="2"/><g fill="#fff" fill-opacity=".14" stroke="none" font-family="Archivo,Arial,sans-serif" font-weight="800" font-size="30"><text x="88" y="236">2 0</text><text x="158" y="236">3 0</text><text x="228" y="236">4 0</text><text x="298" y="236">5 0</text></g></symbol>' +
    '<symbol id="f-mlb" viewBox="0 0 420 280" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="2.5"><path d="M280 250 380 150 280 50 180 150z"/><path d="M280 250 60 30M280 250 500 30"/><path d="M140 110a200 200 0 0 1 280 0"/><circle cx="280" cy="158" r="14"/><rect x="374" y="144" width="12" height="12" transform="rotate(45 380 150)"/><rect x="274" y="44" width="12" height="12" transform="rotate(45 280 50)"/><rect x="174" y="144" width="12" height="12" transform="rotate(45 180 150)"/><path d="M272 250h16l-8 9z"/></symbol>' +
    '</defs></svg>';
  document.body.insertAdjacentHTML("afterbegin", SPRITE);
  var ic = function (id) { return '<svg class="ic" aria-hidden="true"><use href="#' + id + '"/></svg>'; };
  var field = function (k) { return '<svg class="field" viewBox="0 0 420 280" aria-hidden="true"><use href="#f-' + k + '"/></svg>'; };

  /* ---------- the sports ---------- */
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS_L = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // Seasons match Draft Lab (sports.js SEASONS): first games to the end of the fantasy season. Draft windows are the
  // few weeks before.
  var SPORTS = {
    nba: {
      name: "Basketball", league: "NBA", season: [1020, 415], draft: [1001, 1019],
      tag: "Category and points leagues on real per-game lines, plus one-night drafts and a salary-cap dynasty.",
      blurb: "Categories or points, one night or a dynasty.",
      presets: [["cats9", "Categories"], ["points", "Points"]],
      modes: [
        { i: "i-one", t: "One day", n: true, d: "Draft tonight's games with your group: the main slate, the late games or one game. A winner when the last game ends.", u: "fantasy-kit/week.html?s=nba", go: "Pick tonight's slate" },
        { i: "i-bolt", t: "Quick games", d: "Draft now, play this week's real games and crown a winner. Games before the draft don't count.", u: "fantasy-kit/leagues.html?w=1&s=nba", go: "Start a quick game" },
        { i: "i-star", t: "Showdown", d: "One game, a captain at 1.5x and five flex. Snake or a $50 auction.", u: "fantasy-kit/leagues.html?w=1&s=nba&slate=one", go: "Pick a game" },
        { i: "i-cap", t: "Hard Cap", d: "Salary-cap dynasty on real NBA contracts: one hard line and a Prospect Board.", u: "hardcap/", go: "Open Hard Cap" }
      ],
      demos: [["nba", "HH", "Head to head", "Hardwood Heads", "f=h"], ["nba:g", "LT", "Best ball guillotine", "Last Team Standing", "f=g"]]
    },
    nfl: {
      name: "Football", league: "NFL", season: [901, 107], draft: [801, 905],
      tag: "Half PPR, PPR, standard, your own points or your own categories, with position premiums, yardage bonuses and the guillotine front and center.",
      blurb: "PPR to custom points, plus the guillotine.",
      presets: [["half", "Half PPR"], ["ppr", "PPR"], ["std", "Standard"]],
      modes: [
        { i: "i-bolt", t: "Quick games", d: "Draft tonight, play this week's real games, crown a winner. Pick the full slate, Sunday, prime time or your own games.", u: "fantasy-kit/leagues.html?w=1&s=nfl", go: "Start a quick game" },
        { i: "i-star", t: "Showdown", d: "One game, a captain at 1.5x and five flex. Snake or a $50 auction.", u: "fantasy-kit/leagues.html?w=1&s=nfl&slate=one", go: "Pick a game" },
        { i: "i-mask", t: "Heist", d: "Right after the draft, everyone secretly shields their own starters and steals or jinxes the other team's.", u: "fantasy-kit/leagues.html?w=1&s=nfl", go: "Plan a heist" },
        { i: "i-fang", t: "Vampire", d: "One team skips the draft, builds from free agents, and takes a player from every team it beats.", u: "fantasy-kit/leagues.html?s=nfl", go: "Start a league" }
      ],
      demos: [["nfl", "SS", "Head to head", "Sunday Scaries", "f=h"], ["nfl:g", "OH", "Best ball guillotine", "Off With Their Heads", "f=g"]],
      mine: "guillotine"
    },
    mlb: {
      name: "Baseball", league: "MLB", season: [325, 928], draft: [301, 324],
      tag: "Roto or head to head on any categories you want, or points, with last season paced to a full year and Steamer projections.",
      blurb: "Roto, H2H or points, on any categories.",
      presets: [["roto5", "5x5"], ["yoenis", "8x8"]],
      modes: [
        { i: "i-roto", t: "Rotisserie", d: "The original: season totals, ranked category by category. No weekly matchups.", u: "fantasy-kit/leagues.html?s=mlb", go: "Start a roto league" },
        { i: "i-half", t: "AL-only or NL-only", d: "Draft from one league's players. A player traded to the other league stops scoring for you.", u: "fantasy-kit/leagues.html?s=mlb", go: "Start a league" },
        { i: "i-key", t: "Keepers", d: "Keep players into next year at the cost of a round or a price. Dynasty, too.", u: "fantasy-kit/leagues.html?s=mlb", go: "Start a keeper league" },
        { i: "i-seed", t: "Prospect rounds", d: "Extra rounds after the main draft for prospects only, off FanGraphs' board. They start on the taxi squad.", u: "fantasy-kit/leagues.html?s=mlb", go: "Start a dynasty" }
      ],
      demos: [["mlb", "BM", "Head to head", "Bullpen Mafia", "f=h"], ["mlb:g", "SD", "Best ball guillotine", "Sudden Death", "f=g"]],
      mine: "yoenis"
    },
    nhl: {
      name: "Hockey", league: "NHL", season: [929, 415], draft: [901, 928],
      tag: "Build around the stars. Find value on the blue line. Real NHL scoring, separate skater and goalie lineups, and year-by-year contract details.",
      blurb: "10 categories, hits and blocks, or points. Real NHL contracts.",
      presets: [["cats10", "10-cat"], ["bangers", "Hits + blocks"], ["points", "Points"]],
      modes: [
        { i: "i-bolt", t: "Quick games", d: "Draft a roster for the next full Monday–Sunday scoring week. A winner when that week's games finish.", u: "fantasy-kit/leagues.html?w=1&s=nhl", go: "Start a quick game" },
        { i: "i-roto", t: "Categories or points", d: "Start with 10 categories, add hits and blocks, or choose your own points. Goalie ratios use actual saves, shots and minutes.", u: "fantasy-kit/leagues.html?s=nhl", go: "Set up a league" },
        { i: "i-key", t: "Keepers and dynasty", d: "Keep players into next year or carry your whole roster forward. Value forecasts account for different goalie workloads.", u: "fantasy-kit/leagues.html?s=nhl", go: "Build a lasting roster" },
        { i: "i-cap", t: "Contracts and cap sheets", d: "Compare real NHL cap hits, salary, bonuses and remaining contract years. Open a player card in Draft Lab for the details.", u: "nhl/#/contracts", go: "Explore NHL contracts" }
      ],
      demos: [["nhl", "FA", "Head to head", "Frozen Assets", "f=h"], ["nhl:g", "SI", "Best ball guillotine", "Sudden Death on Ice", "f=g"]]
    }
  };
  var ORDER = ["nba", "nfl", "mlb", "nhl"];
  var md = function (d) { return (d.getMonth() + 1) * 100 + d.getDate(); };
  var within = function (x, r) { return r[0] <= r[1] ? x >= r[0] && x <= r[1] : x >= r[0] || x <= r[1]; };
  var mdText = function (x) { return MONTHS[Math.floor(x / 100) - 1] + " " + (x % 100); };
  var today = md(new Date());
  var inSeason = function (k) { return within(today, SPORTS[k].season); };
  var inDraft = function (k) { return within(today, SPORTS[k].draft); };
  function statusOf(k) {
    var s = SPORTS[k];
    if (inSeason(k)) return { on: true, text: "In season through " + mdText(s.season[1]) };
    if (inDraft(k)) return { on: true, text: "Draft season" };
    return { on: false, text: "Drafts start in " + MONTHS_L[Math.floor(s.draft[0] / 100) - 1] };
  }

  /* ---------- theme ---------- */
  function theme() {
    var btn = $("#theme"); if (!btn) return;
    var root = document.documentElement;
    var paint = function () { btn.textContent = root.dataset.theme === "dark" ? "Light mode" : "Dark mode"; };
    btn.addEventListener("click", function () {
      var dark = root.dataset.theme !== "dark";
      if (dark) root.dataset.theme = "dark"; else delete root.dataset.theme;
      try { localStorage.setItem("fk-lab:theme", JSON.stringify(dark ? "dark" : "light")); } catch (e) { /* private mode */ }
      paint();
    });
    paint();
  }

  /* ---------- Draft Lab's header, then the sport pages ---------- */
  // The same masthead and sections as every Draft Lab page (fantasy-kit/nav.js), with Home current, and below it the
  // sport pages as their own row.
  function bar() {
    var el = $("[data-fbar]"); if (!el) return;
    var N = window.FK && window.FK.nav;
    if (N && !$(".fk-top")) {
      var tab = function (t) {
        var h = t[0] === "home" ? ROOT + "fantasy/" : N.href(t[0], { kit: KIT, sport: page === "overview" ? "" : page });
        return '<a href="' + h + '"' + (t[0] === "home" ? ' aria-current="page"' : "") + ">" + esc(t[1]) + "</a>";
      };
      el.insertAdjacentHTML("beforebegin", '<header class="fk-top hub-top"><div class="fk-mast fk-band"><div class="wrap">' +
        '<a class="fk-brand" href="' + ROOT + 'fantasy/"><img src="' + KIT + 'mark.svg" alt=""><b class="disp">Draft Lab</b></a>' +
        '<span class="grow"></span><div class="fk-who"><button class="btn sm ghost fh-theme" type="button" id="theme">Dark mode</button></div></div></div>' +
        '<div class="fk-nav"><div class="wrap"><nav aria-label="Sections">' + N.TABS.map(tab).join("") + "</nav></div></div></header>");
    }
    var link = function (k, label, icon, href) {
      return '<a class="t ' + k + '" href="' + href + '"' + (page === k ? ' aria-current="page"' : "") + ">" + ic(icon) + label + "</a>";
    };
    el.setAttribute("aria-label", "Sports");
    el.innerHTML = '<div class="wrap">' + link("overview", "All sports", "i-home", ROOT + "fantasy/") + '<span class="sep" aria-hidden="true"></span>' +
      ORDER.map(function (k) { return link(k, SPORTS[k].name, "i-" + k, ROOT + "fantasy/" + k + "/"); }).join("") + "</div>";
    var current = $('[aria-current="page"]', el); if (current) current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /* ---------- Draft Lab data: rankings ---------- */
  var cache = {};
  function sportData(k) {
    if (!cache[k]) cache[k] = fetch(KIT + "data/" + k + ".json").then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.players || !S || !V) return null;
      return { sport: S.attach(S.ALL[k], d), players: d.players };
    }).catch(function () { return null; });
    return cache[k];
  }
  function ranked(k, scoring) {
    return sportData(k).then(function (D) {
      if (!D) return null;
      var ps = D.players.slice();
      V.evaluate(D.sport, ps, { teams: 12, scoring: scoring });
      ps.sort(function (a, b) { return (a.rank || 1e9) - (b.rank || 1e9) || (b.vor || 0) - (a.vor || 0); });
      return { sport: D.sport, players: ps.map(function (p) { return { p: p, d: p.$ || 0, rank: p.rank, prank: p.prank }; }) };
    });
  }
  var f1 = function (x) { return (Math.round((x || 0) * 10) / 10).toFixed(1); };
  var avg = function (x) { return (x || 0).toFixed(3).replace(/^0/, ""); };
  function lineOf(k, sp, p) {
    var st = function (l, c) { return S.stat(sp, p, l, c) || 0; };
    if (k === "nba") return f1(st("pg", "pts")) + " pts, " + f1(st("pg", "reb")) + " reb, " + f1(st("pg", "ast")) + " ast";
    if (k === "nfl") return f1(p.fpg) + " pts a game";
    if (k === "nhl") return p.pos.indexOf("G") >= 0 ? st("goalie", "w") + " W, " + st("goalie", "gaa").toFixed(2) + " GAA, " + avg(st("goalie", "svp")) + " SV%" : st("sk", "g") + " G, " + st("sk", "a") + " A, " + st("sk", "sog") + " SOG";
    var pitcher = p.pos.every(function (x) { return x === "SP" || x === "RP"; });
    if (pitcher) return p.pos.indexOf("RP") >= 0 && st("pit", "sv") > st("pit", "w") ? st("pit", "sv") + " SV, " + st("pit", "k") + " K, " + st("pit", "era").toFixed(2) + " ERA" : st("pit", "w") + " W, " + st("pit", "k") + " K, " + st("pit", "era").toFixed(2) + " ERA";
    return st("bat", "hr") + " HR, " + st("bat", "sb") + " SB, " + avg(st("bat", "avg"));
  }
  function face(k, p, size) {
    var c = S.TEAM_COLORS[k] && S.TEAM_COLORS[k][p.t];
    if (k === "nhl") return '<span class="ds-face has-face" style="--face-size:' + size + 'px;--face-bg:' + (c || "#33415c") + ';--face-ink:#fff" aria-hidden="true"><span class="ds-face-ini">' + esc(p.n.split(" ").map(function (s) { return s[0]; }).join("")) + '</span><img src="' + esc(p.head) + '" alt="" loading="lazy" onerror="this.parentNode.classList.remove(\'has-face\');this.remove()"></span>';
    var id = k === "nba" ? p.espn : k === "mlb" ? p.id : null;
    return window.DSFaces ? window.DSFaces.html({ sport: k, id: id, name: p.n, color: c || "#33415c", size: size }) : "";
  }
  var team = function (k, abbr) { var c = S.TEAM_COLORS[k] && S.TEAM_COLORS[k][abbr]; return '<span class="tm"><i style="background:' + (c || "#8894a4") + '"></i>' + esc(abbr || "FA") + "</span>"; };
  var posName = function (sp, p) { return (p.pos || []).filter(function (x) { return x !== "UT" || p.pos.length === 1; }).join("/"); };

  // the full board on a sport page: the top ten under a scoring preset
  function board(el, k) {
    var s = SPORTS[k], preset = s.presets[0][0];
    el.innerHTML = '<div class="mod-h"><div><span class="kick">Draft Lab rankings</span><h2>Top of the board</h2></div><div class="segs" role="group" aria-label="Scoring">' +
      s.presets.map(function (p, i) { return '<button type="button" data-preset="' + p[0] + '" aria-pressed="' + (i === 0) + '">' + esc(p[1]) + "</button>"; }).join("") + "</div></div>" +
      '<ol class="rk" data-rk><li class="rk-empty" style="display:block">Loading the board...</li></ol>' +
      '<div class="rk-foot"><span>12 teams, standard lineup. Values are auction dollars on a $200 budget.</span><a class="more" href="' + KIT + "?s=" + k + '#rankings">Full rankings &rarr;</a></div>';
    var draw = function () {
      ranked(k, preset).then(function (R) {
        var ol = $("[data-rk]", el);
        if (!R) { ol.innerHTML = '<li class="rk-empty" style="display:block">The board couldn\'t load. <a href="' + KIT + "?s=" + k + '#rankings">Open the rankings in Draft Lab</a>.</li>'; return; }
        var top = R.players.slice(0, 10), max = Math.max(1, top[0].d);
        ol.innerHTML = top.map(function (r, i) {
          var p = r.p;
          return '<li><span class="n">' + (i + 1) + "</span>" + face(k, p, 40) + '<div class="who"><b>' + esc(p.n) + '</b><div class="meta">' + team(k, p.t) +
            '<span class="pos">' + esc(r.prank || posName(R.sport, p)) + '</span></div></div><span class="line">' + esc(lineOf(k, R.sport, p)) +
            '</span><div class="val"><b>$' + Math.round(r.d) + '</b><div class="bar"><i style="width:' + Math.max(4, Math.round(100 * r.d / max)) + '%"></i></div></div></li>';
        }).join("");
        if (window.DSFaces && window.DSFaces.scan) window.DSFaces.scan(ol);
      });
    };
    $$("[data-preset]", el).forEach(function (b) {
      b.addEventListener("click", function () {
        preset = b.dataset.preset;
        $$("[data-preset]", el).forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        draw();
      });
    });
    draw();
  }

  /* ---------- scoring, from Draft Lab's own lists ---------- */
  function scoring(el, k) {
    var sp = S.ALL[k], stats = S.POINT_STATS[k] || [], def = S.POINT_DEFAULTS[k] || {}, cats = S.catCatalog(sp);
    var val = function (v) { return v == null ? "" : "<em>" + (v > 0 ? "+" : "") + (Math.round(v * 100) / 100) + "</em>"; };
    var pointsChips = stats.map(function (s) { return '<span class="chip">' + esc(s[1]) + " " + val(def[s[0]]) + "</span>"; }).join("");
    var chipOf = function (c) { return '<span class="chip' + (c.low ? " low" : "") + '"' + (c.title ? ' title="' + esc(c.title) + '"' : "") + ">" + esc(c.label) + (c.low ? " <em title=\"Lower is better\">&darr;</em>" : "") + "</span>"; };
    var catChips = cats.filter(function (c) { return !c.adv && !c.combo; }).map(chipOf).join(""), advChips = cats.filter(function (c) { return c.adv; }).map(chipOf).join(""),
      comboChips = cats.filter(function (c) { return c.combo && !c.adv; }).map(chipOf).join("");
    var catsOk = cats.length > 0;
    var wins = catsOk ? [
      ["Head to head, points", "Play one team a week. More points wins."],
      ["Head to head, each category", "Every category is its own win or loss, like 6-3-0."],
      ["Rotisserie", "Season totals, ranked category by category."],
      ["Head to head, most categories", "Win more categories than your opponent for one win."],
      ["Total points", "No matchups: every point all season adds up, and the most points wins."],
      ["All-play", "Your points against every team, every week, like going 9-2."]
    ] : [
      ["Head to head", "Play one team a week. More points wins."],
      ["Total points", "No matchups: every point all season adds up, and the most points wins."],
      ["All-play", "Your points against every team, every week, like going 9-2."]
    ];
    el.innerHTML = '<div class="mod-h"><div><span class="kick">Scoring</span><h2>Score it your way</h2></div><a class="more" href="' + KIT + "leagues.html?s=" + k + '">Set up scoring &rarr;</a></div>' +
      '<div class="score"><div><h3>Points</h3><p>Give any stat any value. These are the starting values' + (k === "nfl" ? ", and you can add position premiums like a TE premium and yardage bonuses on top" : "") + ".</p><div class=\"chips\">" + pointsChips + "</div></div>" +
      (catsOk ? "<div><h3>Categories</h3><p>Pick any of these, as many as you want. Rate stats are weighted by playing time.</p><div class=\"chips\">" + catChips + "</div>" +
          (comboChips ? '<h4 class="adv-h">Combos</h4><div class="chips">' + comboChips + "</div>" : "") +
          (advChips ? '<h4 class="adv-h">Advanced</h4><div class="chips">' + advChips + "</div>" : "") + readyMade(sp, k) + "</div>"
        : "<div><h3>Extras</h3><p>On top of any points scoring. Football leagues score in points; category leagues aren't built for football yet.</p><div class=\"chips\">" +
          [["TE premium", "+0.5 a catch"], ["6-point passing TDs", ""], ["100-yard rushing game", "+3"], ["100-yard receiving game", "+3"], ["300-yard passing game", "+3"], ["Points by position", ""]].map(function (x) { return '<span class="chip">' + esc(x[0]) + (x[1] ? " <em>" + esc(x[1]) + "</em>" : "") + "</span>"; }).join("") + "</div></div>") +
      '<div><h3>How you win</h3><p>From most to least common.</p><ol class="wins">' + wins.map(function (w) { return "<li><div><b>" + esc(w[0]) + "</b><span>" + esc(w[1]) + "</span></div></li>"; }).join("") +
      '<li class="addon"><div><b>Median game</b><span>Add-on for head to head: also play the league median for a second result each week.</span></div></li></ol></div></div>';
  }

  // the one-click category setups league setup offers, each with its categories
  function readyMade(sp, k) {
    var sets = (S.CAT_PRESETS || {})[k] || [], all = S.catCatalog(sp, { all: true });
    if (!sets.length) return "";
    var lab = function (key) { var c = all.filter(function (x) { return x.k === key; })[0]; return c ? c.label : key; };
    return '<h4 class="adv-h">Ready-made setups</h4><div class="rsets">' + sets.map(function (p) {
      return '<a class="rset" href="' + KIT + "leagues.html?s=" + k + '"><b>' + esc(p.name) + "</b><span>" + esc(p.blurb) + "</span><i>" + p.cats.map(function (c) { return esc(lab(c)); }).join(" &middot; ") + "</i></a>";
    }).join("") + "</div>";
  }

  /* ---------- demo leagues ---------- */
  function demos(el, k) {
    el.innerHTML = '<div class="mod-h"><div><span class="kick">Play now</span><h2>Demo leagues</h2></div></div><div class="mod-b"><div class="lgs">' +
      SPORTS[k].demos.map(function (d) {
        return '<a class="lg" data-demo="' + d[0] + '" href="' + KIT + "league.html?s=" + k + "&amp;" + d[4] + '"><span class="av md">' + d[1] + '</span><span class="lt"><small>' + esc(d[2]) + "</small><b>" + esc(d[3]) + "</b><span>" +
          (d[4] === "f=g" ? "Lowest score each week is chopped." : "Bots, a season moving in real time.") + '</span></span><em class="st">Play</em></a>';
      }).join("") + '</div><p class="ps" style="margin:12px 0 0">Demo leagues save in this browser. Jump in any week.</p></div>';
    $$("[data-demo]", el).forEach(function (a) {
      var L = read("fk-demo:" + a.dataset.demo);
      if (!L || !L.settings) return;
      var weeks = L.settings.weeks + (L.settings.playoffWeeks || 0), over = L.week > weeks, cls = "live";
      var note = over ? "Season over" : "Week " + L.week + " of " + weeks;
      if (L.settings.format === "guillotine" && L.alive && !over) { var alive = L.alive.indexOf(0) >= 0; note = "Week " + L.week + (alive ? ", alive" : ", chopped"); if (!alive) cls = "out"; }
      var st = $(".st", a); st.textContent = note; if (!over) st.classList.add(cls);
    });
  }

  /* ---------- my leagues, with a line of live data each ---------- */
  var MINE = {
    guillotine: { k: "nfl", url: "guillotine/", kind: "Football guillotine", name: "Bastille Day Odds", go: "See who's next",
      d: "Weekly survival odds for a 15-team guillotine league, from 20,000 simulated seasons every update.",
      live: function () {
        return fetch(ROOT + "guillotine/data.json").then(function (r) { return r.json(); }).then(function (d) {
          var alive = (d.teams || []).filter(function (t) { return !t.out && t.roster; });
          var best = alive.filter(function (t) { return t.proj != null; }).sort(function (a, b) { return b.proj - a.proj; })[0];
          return ["Week " + d.week, alive.length + " of " + d.total_teams + " alive", best ? "Top projection: " + best.name : ""];
        });
      } },
    yoenis: { k: "mlb", url: "yoenis/", kind: "Baseball keeper league", name: "Don't Forget to Wipe Yoenis", go: "Open the record book",
      d: "The record book for a 16-team Yahoo keeper league: every champion, standing and draft pick since 2013, plus keeper costs.",
      live: function () {
        return fetch(ROOT + "yoenis/data.json").then(function (r) { return r.json(); }).then(function (d) {
          var s = (d.seasons || [])[d.seasons.length - 1], champ = s && (s.standings || []).filter(function (x) { return x[0] === 1; })[0];
          return [(d.seasons || []).length + " seasons", s && champ ? s.year + " champion: " + s.teams[champ[1]] : ""];
        });
      } }
  };
  function mine(key) {
    var m = MINE[key];
    var html = '<a class="lgm ' + m.k + '" href="' + ROOT + m.url + '">' + field(m.k) + "<small>" + ic("i-" + m.k) + esc(m.kind) + "</small><b>" + esc(m.name) + "</b><span>" + esc(m.d) +
      '</span><div class="live" data-live="' + key + '"></div><em class="go">' + esc(m.go) + "</em></a>";
    return html;
  }
  function fillMine() {
    $$("[data-live]").forEach(function (el) {
      MINE[el.dataset.live].live().then(function (bits) {
        el.innerHTML = bits.filter(Boolean).map(function (b) { return "<span>" + esc(b) + "</span>"; }).join("");
      }).catch(function () { /* the card works without it */ });
    });
  }

  /* ---------- a sport page ---------- */
  function sportPage(k) {
    var s = SPORTS[k], st = statusOf(k);
    document.body.classList.add(k);
    var hero = $("[data-hero]");
    var defScoring = S.ALL[k].scorings[s.presets[0][0]];
    hero.className = "hero sport " + k;
    hero.innerHTML = field(k) + '<div class="wrap"><span class="eyebrow">Fantasy ' + esc(s.league) + "</span>" +
      '<h1 class="disp"><span class="badge-ic">' + ic("i-" + k) + "</span>" + esc(s.name) + '</h1><p class="lede">' + esc(s.tag) + '</p><span class="status' + (st.on ? " on" : "") + '">' + esc(st.text) + "</span>" +
      '<div class="cta"><a class="btn sp-go" href="' + KIT + "?s=" + k + '#home">Mock a ' + s.name.toLowerCase() + ' draft</a><a class="btn" href="' + KIT + "?s=" + k + '#rankings">Rankings</a><a class="btn" href="' + KIT + "leagues.html?s=" + k + '">Start a league</a></div>' +
      '<div class="facts"><div><small>Season</small><b>' + mdText(s.season[0]) + " to " + mdText(s.season[1]) + "</b></div><div><small>Draft season</small><b>" + MONTHS_L[Math.floor(s.draft[0] / 100) - 1] +
      "</b></div><div><small>Default scoring</small><b>" + esc(defScoring ? defScoring.label : "Points") + "</b></div></div></div>";
    board($("[data-board]"), k);
    demos($("[data-demos]"), k);
    var side = $("[data-side]");
    if (side) side.innerHTML = k === "nhl" ? '<a class="lgm nhl" href="' + ROOT + 'nhl/#/contracts">' + field("nhl") + '<small>' + ic("i-cap") + 'Real NHL contracts</small><b>Know the deal</b><span>Cap hits, salary, bonuses and contract years, alongside team cap sheets. Reported figures carry their source; estimates are marked.</span><em class="go">Explore contracts</em></a>' : s.mine ? mine(s.mine) : '<a class="lgm nba" href="' + ROOT + 'hardcap/">' + field("nba") + "<small>" + ic("i-cap") + "League type</small><b>Hard Cap</b><span>Salary-cap dynasty on real NBA contracts: one hard line, and a Prospect Board for the next class.</span><em class=\"go\">Open Hard Cap</em></a>";
    $("[data-modes]").innerHTML = s.modes.map(function (m) {
      return '<a class="mode" href="' + ROOT + m.u + '"><span class="mi">' + ic(m.i) + "</span><b>" + esc(m.t) + (m.n ? ' <em class="new">New</em>' : "") + "</b><span>" + esc(m.d) + '</span><span class="go">' + esc(m.go) + " &rarr;</span></a>";
    }).join("");
    $("[data-modes-h]").textContent = "More ways to play " + s.name.toLowerCase();
    scoring($("[data-scoring]"), k);
    fillMine();
  }

  /* ---------- the overview ---------- */
  function doors(el) {
    el.innerHTML = ORDER.map(function (k) {
      var s = SPORTS[k], st = statusOf(k);
      return '<a class="door ' + k + '" href="' + ROOT + "fantasy/" + k + '/">' + field(k) + '<div class="door-top"><div class="row"><span class="badge-ic">' + ic("i-" + k) + '</span><span class="status' + (st.on ? " on" : "") + '">' + esc(st.text) + "</span></div>" +
        '<h3 class="disp">' + esc(s.name) + "</h3><p>" + esc(s.blurb) + '</p></div><div class="door-board"><div class="h"><span>Top of the board</span><span>$</span></div><ol data-door="' + k + '"><li class="ph" style="display:block">Loading...</li></ol></div>' +
        '<div class="door-foot"><span>Open ' + s.name.toLowerCase() + '</span><span class="arr">&rarr;</span></div></a>';
    }).join("");
    ORDER.forEach(function (k) {
      ranked(k, SPORTS[k].presets[0][0]).then(function (R) {
        var ol = $('[data-door="' + k + '"]');
        if (!R) { ol.innerHTML = '<li class="ph" style="display:block">Rankings are in Draft Lab.</li>'; return; }
        ol.innerHTML = R.players.slice(0, 3).map(function (r, i) {
          return '<li><span class="n">' + (i + 1) + "</span>" + face(k, r.p, 32) + "<div><b>" + esc(r.p.n) + "</b><small>" + esc(r.p.t || "FA") + ", " + esc(posName(R.sport, r.p)) + '</small></div><span class="d">$' + Math.round(r.d) + "</span></li>";
        }).join("");
      });
    });
  }
  function calendar(el) {
    var pct = function (x) { var d = new Date(2027, Math.floor(x / 100) - 1, x % 100); return 100 * (d - new Date(2027, 0, 1)) / (365 * 864e5); };
    var segs = function (r, cls, label) {
      var a = pct(r[0]), b = pct(r[1]) + 0.3;
      var one = function (x, y, l) { return '<span class="seg ' + cls + '" style="left:' + x.toFixed(2) + "%;width:" + Math.max(1, y - x).toFixed(2) + '%">' + (l || "") + "</span>"; };
      return a <= b ? one(a, b, label) : one(a, 100, label) + one(0, b, "");
    };
    var now = pct(today);
    el.innerHTML = '<div class="cal-axis"><span></span><div class="cal-months">' + MONTHS.map(function (m) { return "<span>" + m + "</span>"; }).join("") + "</div></div>" +
      ORDER.map(function (k) {
        var s = SPORTS[k];
        return '<div class="cal-row ' + k + '"><span class="lbl">' + ic("i-" + k) + esc(s.name) + '</span><div class="track">' + segs(s.draft, "draft", "") + segs(s.season, "", "Season") + (k === ORDER[ORDER.length - 1] ? '<span class="today" style="left:' + now.toFixed(2) + '%"></span>' : '<span class="today nolabel" style="left:' + now.toFixed(2) + '%"></span>') + '</div></div>';
      }).join("") + '<div class="cal-key"><span><i class="d"></i>Draft season</span><span><i></i>Fantasy season</span></div>';
  }
  function overview() {
    doors($("[data-doors]"));
    calendar($("[data-cal]"));
    var mineEl = $("[data-mine]");
    if (mineEl) { mineEl.innerHTML = mine("guillotine") + mine("yoenis"); fillMine(); }
    // the hero's numbers count what's on the page
    $$("[data-count]").forEach(function (b) { b.textContent = $$(b.dataset.count).length; });
    // a mock draft in progress goes first in the hero
    var mock = read("fk-lab:mock"), cta = $("[data-cta]");
    if (cta && mock && mock.D && mock.D.phase !== "done") {
      var a = document.createElement("a");
      a.className = "btn go"; a.href = KIT + "#draft";
      a.textContent = "Back to your " + ((SPORTS[mock.D.sport] || {}).name || "").toLowerCase() + " mock";
      cta.insertBefore(a, cta.firstChild);
      cta.children[1].className = "btn";
    }
  }

  bar();
  theme();
  if (SPORTS[page]) sportPage(page); else overview();
})();
