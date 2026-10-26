/* Live scoring for the Bastille Day guillotine league, shared by /guillotine/ and the home-page ticker.

   get(data, relayUrl)  this week's points so far (Sleeper's public stats, scored with Bastille Day rules)
                        and every NFL game's state and clock (ESPN's public scoreboard): from the relay
                        (tools/live-relay.js) when there is one, else straight from both feeds.
   apply(data, live)    a copy of data.json with live scoring laid over it: points so far are banked, and
                        each starter's projection counts only for the share of his game already played.

   Works in the browser (window.GuillotineLive) and in Node (module.exports). */
(function (root) {
  "use strict";

  var SCORING = { pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
    rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2 };
  var SUFFIX = { jr: 1, sr: 1, ii: 1, iii: 1, iv: 1, v: 1 };
  var norm = function (name) {
    return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.'’`-]/g, "")
      .split(/\s+/).filter(function (w) { return w && !SUFFIX[w]; }).join(" ");
  };
  var getJSON = function (url) {
    return fetch(url, { cache: "no-store" }).then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); });
  };

  function score(s) {
    var total = 0, any = false;
    for (var k in SCORING) if (k in s) { any = true; total += (s[k] || 0) * SCORING[k]; }
    return !any && typeof s.pts_half_ppr === "number" ? s.pts_half_ppr : Math.round(total * 100) / 100;
  }
  function fraction(st) {
    var state = (st.type || {}).state;
    if (state === "post") return 1;
    if (state !== "in") return 0;
    var p = st.period || 1, left = typeof st.clock === "number" ? st.clock : 900;
    return p > 4 ? 0.98 : Math.min(1, ((p - 1) * 900 + (900 - left)) / 3600);
  }
  // A team's starters: its set lineup plus anyone assumed into an empty spot, else its best lineup.
  function startersOf(t) {
    var roster = (t && t.roster) || [];
    var s = roster.filter(function (p) { return (p.slot !== "BN" && p.slot !== "IR" && !p.empty) || p.assumed_slot; });
    return s.length ? s : roster.filter(function (p) { return p.in_best; });
  }

  // The same answer the relay gives, built in the browser (used only if the relay isn't set up).
  function direct(data) {
    var q = "?season_type=regular&position%5B%5D=QB&position%5B%5D=RB&position%5B%5D=WR&position%5B%5D=TE";
    return Promise.all([
      getJSON("https://api.sleeper.com/stats/nfl/" + data.season + "/" + data.week + q),
      getJSON("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=" + data.season + "&seasontype=2&week=" + data.week)
    ]).then(function (res) {
      var want = {};
      (data.teams || []).forEach(function (t) { (t.roster || []).forEach(function (p) { if (p.name) want[norm(p.name) + "|" + p.pos] = p.nfl; }); });
      var pts = {};
      (res[0] || []).forEach(function (e) {
        var pl = e.player || {}, key = norm((pl.first_name || "") + " " + (pl.last_name || "")) + "|" + pl.position;
        if (!(key in want)) return;
        var team = (e.team || pl.team || "").toUpperCase();
        if (pts[key] && pts[key].team === want[key] && team !== want[key]) return;
        var s = e.stats || {};
        pts[key] = { pts: score(s), gp: !!s.gp, team: team };
      });
      var games = {};
      ((res[1] || {}).events || []).forEach(function (ev) {
        var st = ev.status || {}, comp = (ev.competitions || [])[0] || {};
        var g = { state: (st.type || {}).state || "pre", frac: fraction(st), period: st.period || 0, clock: st.displayClock || "", start: ev.date };
        (comp.competitors || []).forEach(function (c) { var a = ((c.team || {}).abbreviation || "").toUpperCase(); games[a === "WSH" ? "WAS" : a] = g; });
      });
      return { season: data.season, week: data.week, fetched: new Date().toISOString(), games: games, pts: pts };
    });
  }
  function get(data, relay) {
    var fallback = function () { return direct(data); };
    return relay ? getJSON(relay).then(function (b) { if (b.error || !b.games) throw new Error(b.error); return b; }).catch(fallback) : fallback();
  }
  function apply(data, live) {
    var d = JSON.parse(JSON.stringify(data));
    if (!live || live.week !== d.week || !live.games) return d;
    var anyStarted = false, games = 0;
    Object.keys(live.games).forEach(function (k) {
      var g = live.games[k];
      if (g.state === "in") games++;
      if (g.state !== "pre") anyStarted = true;
    });
    d.teams.forEach(function (t) {
      if (t.out || !t.roster) return;
      t.roster.forEach(function (p) {
        if (p.empty || p.bye) return;
        var g = live.games[p.nfl], s = live.pts[norm(p.name) + "|" + p.pos];
        if (p.yfinal && typeof p.yahoo_actual === "number") {
          p.final = true; p.actual = p.yahoo_actual; delete p.live; delete p.frac; return;
        }
        delete p.final; delete p.live; delete p.actual; delete p.frac;
        if (!g || g.state === "pre") return;
        p.actual = s ? s.pts : 0;
        if (g.state === "post") p.final = true; else { p.live = true; p.frac = g.frac; p.clock = g.period ? (g.period > 4 ? "OT" : "Q" + g.period) + " " + g.clock : "in progress"; }
      });
      var st = startersOf(t), locked = 0, lockedProj = 0, n = 0;
      st.forEach(function (p) {
        if (!p.final && !p.live) return;
        locked += p.actual || 0;
        lockedProj += (p.proj || 0) * (p.final ? 1 : p.frac || 0);
        n++;
      });
      t.locked = Math.round(locked * 100) / 100;
      t.locked_proj = Math.round(lockedProj * 100) / 100;
      t.games_final = n;
    });
    d.live = { fetched: live.fetched, inProgress: Math.round(games / 2), anyStarted: anyStarted };
    return d;
  }

  var api = { get: get, apply: apply, direct: direct, startersOf: startersOf, norm: norm, score: score, fraction: fraction };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GuillotineLive = api;
})(this);
