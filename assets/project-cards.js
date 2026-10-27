/* Draws one project card from an entry in assets/projects.js. Used by the home page and the kids page.
   ProjectCards.card(project, { showHidden, base }): showHidden opens hidden apps (the home page's app code);
   base prefixes the project's relative links and cover (the kids page passes "/"). */
(function () {
  var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var when = function (ym) {
    var p = String(ym || "").split("-");
    return p.length === 2 ? MONTHS[+p[1] - 1] + " " + p[0] : esc(ym);
  };
  var slug = function (url) { return String(url || "").replace(/\/+$/, "").split("/").pop().replace(/\.html$/, "") || ""; };
  var list = function (items) {
    if (items.length < 2) return items.join("");
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  };

  // NFL logos from ESPN's image service: a 64px copy for a 22px spot, and the dark-background version in dark mode
  var nflLogo = function (abbr) {
    var a = (abbr === "WAS" ? "wsh" : String(abbr).toLowerCase());
    var url = function (v) { return "https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/" + v + "/" + a + ".png&w=64&h=64"; };
    return '<picture class="mu-logo"><source media="(prefers-color-scheme: dark)" srcset="' + esc(url("500-dark")) + '">'
      + '<img src="' + esc(url("500")) + '" alt="" width="22" height="22" loading="lazy" data-abbr="' + esc(abbr) + '"></picture>';
  };
  var matchups = function (p) {
    if (!p.matchups || !p.matchups.length) return "";
    return '<div class="matchups"><p class="matchups-label">Famous calls inside</p><ul>' + p.matchups.map(function (m) {
      return '<li><span class="mu-teams">' + nflLogo(m.you) + "<b>" + esc(m.you) + "</b><span>" + (m.home || m.neutral ? "vs" : "at") + "</span>"
        + nflLogo(m.opp) + "<b>" + esc(m.opp) + "</b></span><span class=\"mu-label\">" + esc(m.label) + "</span></li>";
    }).join("") + "</ul></div>";
  };
  function card(p, opts) {
    opts = opts || {};
    var showHidden = !!opts.showHidden;
    // Relative links and covers get the page's base ("/" on pages below the home page); full addresses don't.
    var at = function (u) { return u && opts.base && !/^([a-z]+:|\/|#)/i.test(u) ? opts.base + u : u; };
    var building = p.status === "building";
    var accessible = !building || (showHidden && p.hidden);
    var cover = p.cover || {};
    var style = (cover.bg ? "--cover-bg:" + cover.bg + ";" : "") + (cover.band ? "--cover-band:" + cover.band : "");
    var art = cover.image
      ? '<img src="' + esc(at(cover.image)) + '" alt="" loading="lazy" width="1040" height="780">'
      : '<span class="typeset">' + esc(p.title) + "</span>";
    var facts = (p.facts || []).map(function (f) {
      return "<div><dt>" + esc(f[1]) + "</dt><dd>" + esc(f[0]) + "</dd></div>";
    }).join("");
    var url = at(p.url);
    var title = !accessible ? esc(p.title) : '<a href="' + esc(url) + '">' + esc(p.title) + "</a>";
    var id = p.external ? slug(p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")) : slug(p.url);
    return '<article class="entry' + (p.spotlight ? ' spotlight' : '') + '" id="' + esc(id) + '" data-type="' + esc(p.type) + '" style="' + esc(style) + '">'
      + '<div class="entry-meta"><span class="type">' + esc(p.type) + "</span>" + (p.featured ? '<span class="featured-tag">Featured</span>' : '')
      + (building ? '<span class="state">In progress</span>' : "<span>" + when(p.released) + "</span>") + "</div>"
      + (!accessible ? '<div class="entry-cover" aria-hidden="true">' + art + '<span class="band"></span></div>'
                  : '<a class="entry-cover" href="' + esc(url) + '" tabindex="-1" aria-hidden="true">' + art + '<span class="band"></span></a>')
      + '<div class="entry-body"><h3>' + title + "</h3>"
      + (p.question ? '<p class="question">' + esc(p.question) + "</p>" : "")
      + '<p class="summary">' + esc(p.summary) + "</p>"
      + (facts ? '<dl class="facts">' + facts + "</dl>" : "")
      + (!accessible ? "" : '<div class="actions"><a class="btn" href="' + esc(url) + '"><span class="dot" aria-hidden="true"></span>' + esc(p.action || ({"Fantasy Leagues":"View League","Simulations":"Run Simulation","Games":"Play Game","Social Tools":"Open Tool"}[p.type] || "Explore Project")) + (p.external ? " ↗" : "") + "</a></div>")
      + (p.stack && p.stack.length ? '<p class="stack">Built with ' + esc(list(p.stack)) + "</p>" : "")
      + "</div>" + matchups(p) + "</article>";
  }

  window.ProjectCards = { card: card, esc: esc };
})();
