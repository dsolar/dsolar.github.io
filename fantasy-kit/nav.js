/* Draft Lab's one navigation, shared by every Draft Lab page: the home page and sport pages (fantasy/), and the
   draft, league and quick-game pages (fantasy-kit/).

   FK.nav.TABS                  the sections, in order: [key, label]
   FK.nav.href(tab, o)          a section's address. o.kit: the path to fantasy-kit/ from this page ("" on a kit page,
                                "../fantasy-kit/" on the home page); o.sport: the sport for the demo league; o.here: on
                                fantasy-kit/index.html itself, where the draft room's pages are just hashes
   FK.nav.HOME                  the home page from fantasy-kit/ ("../fantasy/")
   FK.nav.SPORTS                the sport pages: [key, label], each at fantasy/<key>/ */
(function (root) {
  "use strict";
  var TABS = [["home", "Home"], ["leagues", "Your leagues"], ["draft", "Mock draft"], ["rankings", "Rankings"], ["week", "Quick games"], ["league", "Demo league"]];
  var SPORTS = [["nba", "NBA"], ["nfl", "NFL"], ["nhl", "NHL"], ["mlb", "MLB"], ["cbb", "NCAAB"], ["cfb", "NCAAF"]];
  var HOME = "../fantasy/";
  function href(tab, o) {
    o = o || {};
    var kit = o.kit || "", q = o.sport ? "?s=" + encodeURIComponent(o.sport) : "";
    if (tab === "home") return kit + HOME;
    if (tab === "leagues") return kit + "leagues.html";
    if (tab === "week") return kit + "week.html";
    if (tab === "league") return kit + "league.html" + q;
    // the draft room's own pages are hash routes of fantasy-kit/index.html
    return (o.here ? "" : kit || "./") + "#" + tab;
  }
  var nav = { TABS: TABS, SPORTS: SPORTS, HOME: HOME, href: href };
  if (typeof module !== "undefined" && module.exports) module.exports = nav;
  else (root.FK = root.FK || {}).nav = nav;
})(this);
