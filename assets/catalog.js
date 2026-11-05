/* Homepage picks and complete collections use the same project registry. */
(function () {
  "use strict";
  var esc = window.ProjectCards.esc;
  // signed in to a Draft Lab account on this site (fantasy-kit/cloud.js keeps the session here): the members-only
  // projects get their own section on the home page, and show nowhere else
  function signedIn() { try { var s = JSON.parse(localStorage.getItem("fk-auth:session")); return !!(s && s.refresh); } catch (e) { return false; } }
  function visible(showHidden) { return (window.PROJECTS || []).filter(function (p) { return !p.section && !p.members && (showHidden || !p.hidden); }); }
  function tiles(entries, showHidden) { return '<ul class="tiles">' + entries.map(function (p, i) { return window.ProjectCards.tile(p, { base: "/", showHidden: showHidden, order: i + 1 }); }).join("") + '</ul>'; }
  function home(showHidden) {
    var all = visible(showHidden);
    var groups = [
      { type: "Games", id: "games", label: "02 / Games", title: "Got a few minutes?", intro: "A few favorites for a quick break. The full collection has daily challenges, strategy games, and chess.", limit: 4, url: "/games/", action: "Explore all games" },
      // the Nick projects: their own section, only for people signed in
      { members: true, id: "nick", label: "Signed in / Nick", title: "All things Nick.", intro: "Walk him home through Montreal, or text him whenever you like." },
      { type: "Simulations", id: "simulations", label: "03 / Simulations & Tools", title: "You’re running the front office.", intro: "Build a roster. Work the cap. See whether your big idea survives a season.", limit: 2, url: "/simulations/", action: "Explore simulations & tools" },
      { type: "Social Tools", id: "social", label: "Unlocked / Social tools", title: "For the group chat.", intro: "Your additional projects." },
      { type: "Fantasy Leagues", id: "unlocked-fantasy", label: "Unlocked / Fantasy", title: "More league tools.", intro: "Your additional fantasy projects." }
    ];
    var nick = signedIn() ? (window.PROJECTS || []).filter(function (p) { return p.members && !p.section; }) : [];
    document.getElementById("catalog").innerHTML = groups.map(function (g) {
      var entries = g.members ? nick : all.filter(function (p) { return p.type === g.type && (g.type !== "Fantasy Leagues" || p.hidden); });
      if (!entries.length) return "";
      var picks = g.limit ? entries.filter(function (p) { return p.homeFeatured && !p.hidden; }).slice(0, g.limit) : entries;
      if (g.limit && !picks.length) picks = entries.filter(function (p) { return !p.hidden; }).slice(0, g.limit);
      if (g.limit && showHidden) picks = picks.concat(entries.filter(function (p) { return p.hidden; }));
      return '<section class="world-group" id="' + g.id + '" aria-labelledby="' + g.id + '-title"><div class="world-heading"><div><p class="world-label">' + esc(g.label) + '</p><h2 id="' + g.id + '-title">' + esc(g.title) + '</h2></div><p>' + esc(g.intro) + '</p></div>' + tiles(picks, showHidden || !!g.members)
        + (g.url ? '<div class="collection-more"><span>' + entries.length + (g.type === "Games" ? ' games to explore' : ' simulations & tools') + '</span><a href="' + g.url + '">' + esc(g.action) + ' <span aria-hidden="true">→</span></a></div>' : '') + '</section>';
    }).join("");
  }
  function collection(key) {
    var showHidden = false;
    try { showHidden = sessionStorage.getItem("dsolar-hidden-apps") === "shown"; } catch (e) {}
    var all = visible(showHidden).filter(function (p) { return p.type === (key === "games" ? "Games" : "Simulations"); });
    var groups = key === "games" ? [
      { title: "Daily challenges", intro: "A fresh challenge for the group chat, every day.", entries: all.filter(function (p) { return p.daily; }) },
      { title: "Strategy & more", intro: "Read the play. Find the corner. Take another turn.", entries: all.filter(function (p) { return !p.daily; }) }
    ] : [
      { title: "Take the GM seat", intro: "Your roster, your contracts, your season.", entries: all.filter(function (p) { return p.url !== "draft/"; }) },
      { title: "Scout the next draft", intro: "Real prospect boards, consensus rankings, and a mock draft.", entries: all.filter(function (p) { return p.url === "draft/"; }) }
    ];
    document.getElementById("collection").innerHTML = groups.filter(function (g) { return g.entries.length; }).map(function (g) {
      return '<section class="collection-group"><div class="collection-heading"><h2>' + esc(g.title) + '</h2><p>' + esc(g.intro) + '</p></div>' + tiles(g.entries, showHidden) + '</section>';
    }).join("");
    var count = document.getElementById("collection-count"); if (count) count.textContent = all.length + (key === "games" ? " games" : " simulations & tools");
  }
  window.ProjectCatalog = { home: home, collection: collection };
  var page = document.body.dataset.collection;
  if (page) collection(page);
})();
