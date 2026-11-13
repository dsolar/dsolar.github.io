/* Homepage picks and complete collections use the same project registry. */
(function () {
  "use strict";
  var esc = window.ProjectCards.esc;
  // signed in to a Draft Lab account on this site (fantasy-kit/cloud.js keeps the session here): the members-only
  // projects get their own section on the home page, and show nowhere else
  function signedIn() { try { var s = JSON.parse(localStorage.getItem("fk-auth:session")); return !!(s && s.refresh); } catch (e) { return false; } }
  function visible(showHidden) { return (window.PROJECTS || []).filter(function (p) { return !p.section && !p.members && (showHidden || !p.hidden); }); }
  function tiles(entries, showHidden) { return '<ul class="tiles">' + entries.map(function (p, i) { return window.ProjectCards.tile(p, { base: "/", showHidden: showHidden, order: i + 1 }); }).join("") + '</ul>'; }
  function section(g, entries, picks, showHidden, more) {
    return '<section class="world-group" id="' + g.id + '" aria-labelledby="' + g.id + '-title"><div class="world-heading"><div><p class="world-label">' + esc(g.label) + '</p><h2 id="' + g.id + '-title">' + esc(g.title) + '</h2></div><p>' + esc(g.intro) + '</p></div>' + tiles(picks, showHidden || !!g.members) + (more || '') + '</section>';
  }
  function home(showHidden) {
    var all = visible(showHidden);
    // the hubs: first on the page, right after the hero (the #hubs block in index.html), every one of them
    var hubs = all.filter(function (p) { return p.hub; });
    var sims = all.filter(function (p) { return p.type === "Simulations" && !p.hub && !p.hidden; });
    var hubBox = document.getElementById("hubs-list");
    if (hubBox) hubBox.innerHTML = hubs.length ? section({ id: "hubs-group", label: "01 / Hubs", title: "Every roster. Every contract.", intro: "Standings, cap sheets, trade value and draft boards for the NBA, NFL and MLB, refreshed every day." }, hubs, hubs, showHidden,
      sims.length ? '<div class="collection-more"><span>Plus ' + sims.length + ' front-office ' + (sims.length === 1 ? 'game' : 'games') + ': ' + sims.map(function (p) { return esc(p.title); }).join(', ') + '</span><a href="/simulations/">Explore hubs &amp; tools <span aria-hidden="true">→</span></a></div>' : '') : "";
    var groups = [
      { type: "Games", id: "games", label: "03 / Games", title: "Got a few minutes?", intro: "A few favorites for a quick break. The full collection has daily challenges, strategy games, and chess.", limit: 4, url: "/games/", action: "Explore all games" },
      // the Nick projects: their own section, only for people signed in
      { members: true, id: "nick", label: "Signed in / Nick", title: "All things Nick.", intro: "Walk him home through Montreal, or text him whenever you like." },
      // unlocked with the app code: hidden simulations (Dynasty Mode and the like), social tools and fantasy pages
      { type: "Simulations", hiddenOnly: true, id: "simulations", label: "Unlocked / Simulations", title: "Still in the shop.", intro: "Your additional front-office projects." },
      { type: "Social Tools", id: "social", label: "Unlocked / Social tools", title: "For the group chat.", intro: "Your additional projects." },
      { type: "Fantasy Leagues", hiddenOnly: true, id: "unlocked-fantasy", label: "Unlocked / Fantasy", title: "More league tools.", intro: "Your additional fantasy projects." }
    ];
    var nick = signedIn() ? (window.PROJECTS || []).filter(function (p) { return p.members && !p.section; }) : [];
    document.getElementById("catalog").innerHTML = groups.map(function (g) {
      var entries = g.members ? nick : all.filter(function (p) { return p.type === g.type && !p.hub && (!g.hiddenOnly || p.hidden); });
      if (!entries.length) return "";
      var picks = g.limit ? entries.filter(function (p) { return p.homeFeatured && !p.hidden; }).slice(0, g.limit) : entries;
      if (g.limit && !picks.length) picks = entries.filter(function (p) { return !p.hidden; }).slice(0, g.limit);
      if (g.limit && showHidden) picks = picks.concat(entries.filter(function (p) { return p.hidden; }));
      return section(g, entries, picks, showHidden, g.url ? '<div class="collection-more"><span>' + entries.length + ' games to explore</span><a href="' + g.url + '">' + esc(g.action) + ' <span aria-hidden="true">→</span></a></div>' : '');
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
      { title: "Hubs", intro: "Standings, cap sheets, trade value and draft boards, refreshed every day.", entries: all.filter(function (p) { return p.hub; }) },
      { title: "Take the GM seat", intro: "Your roster, your contracts, your season.", entries: all.filter(function (p) { return !p.hub; }) }
    ];
    document.getElementById("collection").innerHTML = groups.filter(function (g) { return g.entries.length; }).map(function (g) {
      return '<section class="collection-group"><div class="collection-heading"><h2>' + esc(g.title) + '</h2><p>' + esc(g.intro) + '</p></div>' + tiles(g.entries, showHidden) + '</section>';
    }).join("");
    var count = document.getElementById("collection-count"); if (count) count.textContent = all.length + (key === "games" ? " games" : " hubs & tools");
  }
  window.ProjectCatalog = { home: home, collection: collection };
  var page = document.body.dataset.collection;
  if (page) collection(page);
})();
