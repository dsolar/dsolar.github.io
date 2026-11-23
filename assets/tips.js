/* Hover (or tap) descriptions for column headers and filter buttons across the hubs.
   Any <th>, filter button or chip whose label matches an entry below gets a short description, shown in a floating
   tip so tables that scroll sideways don't clip it. Existing native titles on those elements are shown the same way.
   Labels are matched case-insensitively, ignoring sort arrows. Hub-specific entries win over the shared ones. */
(function () {
  "use strict";
  var SHARED = {
    "gp": "Games played", "g": "Games played", "min": "Minutes a game", "pos": "Position", "age": "Age today", "ht": "Height", "yr": "Class year",
    "pts": "Points a game", "reb": "Rebounds a game", "ast": "Assists a game", "stl": "Steals a game", "blk": "Blocks a game",
    "ts%": "True shooting: points per shooting attempt, with threes and free throws counted at their real value",
    "w-l": "Wins and losses", "win%": "Winning percentage", "conf": "Conference", "overall": "Overall record",
    "playoffs": "Chance to make the playoffs, from season simulations", "proj": "Projected final record, from season simulations",
    "7-day": "Change in rank over the last seven days", "bets": "The side most bets are on, across the books Action Network tracks",
    "line": "The point spread", "court": "Home, away or neutral site",
    "signal": "The value-watch signal being graded", "record": "Wins, losses and pushes against the closing line",
    "win %": "Share of graded games won, pushes left out. Break-even at standard −110 juice is 52.4%",
    "epa": "Expected points added: how much each play changed the expected score, summed",
    "epa/play": "Expected points added per play", "rating": "Passer rating", "qbr": "ESPN's Total QBR (0-100), which credits a quarterback for every play he's part of",
    "cmp%": "Completion percentage", "td": "Touchdowns", "int": "Interceptions", "yds": "Yards", "att": "Attempts", "cmp": "Completions", "y/a": "Yards per pass attempt",
    "#": "Rank"
  };
  var HUB = {
    cbb: {
      "rk": "The hub's rating rank (Haslametrics adjusted efficiency)",
      "mkt": "Market rating rank: team ratings fit to every closing point spread this season (teams with 2+ lined games). It's 80% of the hub's line",
      "bpi": "ESPN's Basketball Power Index rank", "sor": "ESPN's Strength of Record rank: how hard the team's record would be for a typical top-25 team to match",
      "off": "Adjusted offense: points scored per 100 possessions against an average defense", "def": "Adjusted defense: points allowed per 100 possessions against an average offense (lower is better)",
      "pace": "Possessions per 40 minutes, adjusted for opponents", "3pa%": "Share of shots taken from three", "rim%": "Share of shots taken at the rim",
      "3p%": "Three-point percentage", "opp 3p%": "Opponents' three-point percentage (lower is better)",
      "proj": "ESPN BPI's projected final record", "conf %": "ESPN BPI's chance to win the regular-season conference title", "ncaa": "The hub's chance to make the NCAA tournament",
      "net": "NCAA Evaluation Tool rank, the selection committee's main sorting tool", "avg net": "Average NET rank of the conference's teams", "top-3 net": "Average NET rank of the conference's three best teams",
      "best team": "The conference's highest-rated team", "teams": "Teams in the conference", "proj bids": "Projected NCAA tournament bids, averaged across season simulations",
      "make it": "Chance to make the NCAA tournament", "make ncaa": "Chance to make the NCAA tournament", "auto bid": "Chance to win the conference's automatic bid",
      "r32": "Chance to reach the round of 32", "sweet 16": "Chance to reach the Sweet 16", "elite 8": "Chance to reach the Elite Eight", "final four": "Chance to reach the Final Four",
      "title game": "Chance to reach the national title game", "champion": "Chance to win the national title", "bpi title": "ESPN BPI's chance to win the national title",
      "proj conf": "Projected conference record", "win": "The hub's chance to win this game",
      "gmsc": "Game Score a game: a one-number box-score summary on a points-like scale",
      "contenders": "Teams with a real shot at the title", "bubble": "Teams near the NCAA tournament cut line", "all 365": "Every Division I team",
      "by conference": "Grouped by conference", "cut line": "The last teams in and first teams out", "neutral": "Played on a neutral court",
      "naismith list": "The hub's Naismith Player of the Year ladder", "big board": "NBA draft prospects in college", "freshmen": "First-year players only",
      "leaders": "Statistical leaders", "table": "Every player, sortable", "offense vs defense": "Each team plotted by adjusted offense and defense"
    },
    cfb: {
      "power": "The hub's power rating: points better than an average FBS team on a neutral field", "hub power": "The hub's power rating rank", "hub résumé": "The hub's résumé rank: how much a team's results are worth, schedule included",
      "fpi": "ESPN's Football Power Index rank", "fpi conf": "ESPN FPI's chance to win the conference", "prev": "Previous rank",
      "avg power": "Average power rating of the conference's teams", "top-3": "Average power rating of the conference's three best teams", "favorite": "The conference title favorite",
      "teams": "Teams in the conference", "proj cfp bids": "Projected College Football Playoff bids, averaged across simulations",
      "proj conf": "Projected conference record", "title game": "Chance to reach the conference title game", "win conf": "Chance to win the conference", "make cfp": "Chance to make the College Football Playoff",
      "cfp": "College Football Playoff ranking", "make": "Chance to make the playoff", "auto bid": "Chance to earn an automatic bid as a top conference champion",
      "bye": "Chance to earn a first-round bye (a top-four seed)", "host r1": "Chance to host a first-round game (seeds 5-8)", "qf": "Chance to reach the quarterfinals",
      "semis": "Chance to reach the semifinals", "final": "Chance to reach the national title game", "champion": "Chance to win the national title", "avg seed": "Average playoff seed when in the field",
      "hub": "The hub's line for this game", "book": "The sportsbook line", "win": "The hub's chance to win this game", "result": "Final score",
      "rush": "Rushing yards", "r-td": "Rushing touchdowns", "rec": "Receptions", "proj": "Projected final record",
      "ranked": "Teams in the current rankings", "following": "Teams you follow", "contenders": "Teams with a real playoff shot", "all 138": "Every FBS team",
      "passing": "Passing leaders", "rushing": "Rushing leaders", "receiving": "Receiving leaders", "defense": "Defensive leaders", "neutral": "Played at a neutral site"
    },
    nfl: {
      "proj. wins": "Projected wins, from season simulations", "bye": "Chance to earn the conference's first-round bye", "conference": "Chance to win the conference",
      "super bowl": "Chance to win the Super Bowl", "xcmp%": "Expected completion percentage, given each throw's difficulty",
      "cpoe": "Completion percentage over expected: completion rate above what each throw's difficulty predicts",
      "time to throw": "Average seconds from snap to throw", "air yds": "Average air yards per attempt", "air yds (comp)": "Average air yards per completion",
      "tight window%": "Share of throws into tight coverage (a defender within a yard)", "rush yds": "Rushing yards", "snaps": "Snaps played",
      "2026 cap": "2026 salary cap hit", "value": "What his play is worth over the rest of his deal, against what it costs"
    },
    nba: {
      "now": "Current record", "proj": "Projected final record, from season simulations", "net": "Projected net rating: points per 100 possessions better than opponents",
      "play-in": "Chance to finish 7th-10th and land in the play-in", "conf": "Chance to win the conference", "title": "Chance to win the championship", "avg pick": "Average draft pick across simulations",
      "impact": "Impact per 100 possessions, on the hub's rating scale", "contract": "Years and money left on his deal",
      "miles": "Miles run a game", "speed": "Average speed, mph", "avg speed": "Average speed, mph", "on offense": "Miles run on offense a game", "on defense": "Miles run on defense a game",
      "offense mph": "Average speed on offense", "defense mph": "Average speed on defense", "drives": "Drives to the basket a game", "touches": "Touches a game",
      "pot. ast": "Potential assists: passes that would be assists if the shot went in", "c&s 3pa": "Catch-and-shoot three attempts a game", "c&s 3p%": "Catch-and-shoot three-point percentage",
      "deflections": "Deflections a game", "contests": "Shots contested a game", "opp. rim fg%": "Opponents' shooting at the rim when he's defending (lower is better)"
    },
    nhl: {
      "w-l-ot": "Wins, regulation losses and overtime losses", "pts": "Standings points (players: points a game)", "cup": "Chance to win the Stanley Cup",
      "tier": "The hub's player tier, from his projected wins above replacement", "skater": "Skater", "a": "Assists", "p": "Points", "toi": "Time on ice a game",
      "thru": "The season his contract runs through", "this season": "Goals above replacement this season so far", "cap hit": "2026-27 salary cap hit",
      "sv%": "Save percentage", "gaa": "Goals against a game (lower is better)", "mid-range sv%": "Save percentage on mid-range shots", "long-range sv%": "Save percentage on long-range shots",
      "division": "Standings by division", "wild card": "The wild card race", "league": "League-wide standings", "forwards": "Forwards only", "defense": "Defensemen only", "goalies": "Goalies only"
    },
    mlb: {
      "div": "Chance to win the division", "ws": "Chance to win the World Series", "rs": "Runs scored (projected over the full season)", "ra": "Runs allowed (projected over the full season)", "diff": "Run differential",
      "pa": "Plate appearances", "xwoba": "Expected wOBA: the quality of contact and plate discipline, from Statcast, on the on-base scale",
      "xba": "Expected batting average from the quality of contact", "xslg": "Expected slugging from the quality of contact", "avg ev": "Average exit velocity, mph", "max ev": "Hardest-hit ball, mph",
      "barrel%": "Share of batted balls hit at the ideal speed and angle", "hard hit%": "Share of batted balls at 95 mph or harder", "bat speed": "Average swing speed, mph",
      "sprint": "Sprint speed: feet per second on his fastest runs", "oaa": "Outs above average in the field", "swing runs": "Runs from his swing and take decisions",
      "wrc+": "Weighted runs created plus: total offense against the league average (100), park adjusted", "def": "Fielding and position value, in runs", "war": "Wins above replacement",
      "role": "Rotation or bullpen role", "ip": "Innings pitched", "era": "Earned run average", "k-bb%": "Strikeout rate minus walk rate"
    }
  };
  var hub = (location.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
  var dict = Object.assign({}, SHARED, HUB[hub] || {});
  var key = function (t) { return String(t || "").replace(/[▾▴▲▼↓↑⬍]/g, "").replace(/\s+/g, " ").trim().toLowerCase(); };

  function annotate(root) {
    (root || document).querySelectorAll("th, .seg button, .seg a, .chips button, .chips a").forEach(function (el) {
      if (el.dataset.hint || el.dataset.tip || el.dataset.hintSkip) return;
      if (el.title) { el.dataset.hint = el.title; el.removeAttribute("title"); }
      else { var d = dict[key(el.textContent)]; if (!d) { el.dataset.hintSkip = "1"; return; } el.dataset.hint = d; }
      if (el.tagName === "TH" && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
      el.classList.add("has-hint");
    });
  }

  var css = document.createElement("style");
  css.textContent = ".has-hint{cursor:help}th.has-hint{text-decoration:underline dotted rgba(0,0,0,.28);text-underline-offset:3px}" +
    ".hint-tip{position:fixed;z-index:9999;max-width:min(300px,calc(100vw - 16px));background:#14213d;color:#fff;font:500 12.5px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:0;text-transform:none;" +
    "padding:7px 10px;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.22);pointer-events:none;opacity:0;transition:opacity .08s}.hint-tip.on{opacity:1}";
  document.head.appendChild(css);
  var tip = document.createElement("div"); tip.className = "hint-tip"; tip.setAttribute("role", "tooltip");
  var timer = null, cur = null, lastTap = null;   // a tap on a sortable header redraws the table; re-show the tip on the new header
  function show(el) {
    if (!el || !el.dataset.hint) return;
    if (!tip.parentNode) document.body.appendChild(tip);
    cur = el; tip.textContent = el.dataset.hint; tip.classList.add("on");
    var r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    var top = r.top - h - 8; if (top < 8) top = r.bottom + 8;
    tip.style.left = left + "px"; tip.style.top = top + "px";
  }
  function hide() { cur = null; tip.classList.remove("on"); clearTimeout(timer); }
  document.addEventListener("pointerover", function (e) { var el = e.target.closest && e.target.closest("[data-hint]"); if (e.pointerType === "touch") return; if (el) show(el); else if (cur) hide(); });
  document.addEventListener("pointerdown", function (e) { var el = e.target.closest && e.target.closest("[data-hint]"); if (e.pointerType !== "touch" || !el) return; lastTap = { hint: el.dataset.hint, t: Date.now() }; show(el); clearTimeout(timer); timer = setTimeout(hide, 2600); });
  document.addEventListener("focusin", function (e) { var el = e.target.closest && e.target.closest("[data-hint]"); if (el) show(el); });
  document.addEventListener("focusout", hide);
  window.addEventListener("scroll", function () { if (!lastTap || Date.now() - lastTap.t > 900) hide(); }, true);
  window.addEventListener("resize", hide);

  var queued = false;
  function queue() {
    if (queued) return; queued = true;
    requestAnimationFrame(function () {
      queued = false; annotate(document);
      if (lastTap && Date.now() - lastTap.t < 900 && (!cur || !document.body.contains(cur))) {
        var again = [].find.call(document.querySelectorAll("[data-hint]"), function (x) { return x.dataset.hint === lastTap.hint; });
        if (again) { show(again); clearTimeout(timer); timer = setTimeout(hide, 2600); }
      }
    });
  }
  function start() { annotate(document); new MutationObserver(queue).observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
