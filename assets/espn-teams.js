// The six hubs as ESPN sees them, for pages that read ESPN directly (my-teams/, tonight/): where each sport lives in
// ESPN's site API, how a hub's team id maps to ESPN's (the college hubs already use ESPN's ids), and the hub's own
// links for a team and for a game preview.
(function () {
  if (window.ESPNTeams) return;
  var lower = function (map) { return function (c) { return map[c] || String(c).toLowerCase(); }; };
  var API = "https://site.web.api.espn.com/apis/site/v2/sports/";
  var Q = "region=us&lang=en&contentorigin=espn";
  var SPORTS = [
    { k: "nba", label: "NBA", path: "basketball/nba", hub: "/nba/", espn: lower({ BRK: "bkn", CHO: "cha", PHO: "phx", GSW: "gs", NOP: "no", NYK: "ny", SAS: "sa", UTA: "utah", WAS: "wsh" }),
      back: { BKN: "BRK", CHA: "CHO", PHX: "PHO", GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" }, team: function (id) { return "#/team/" + id; },
      preview: function (g) { return "#/game/" + g.id; } },
    { k: "nfl", label: "NFL", path: "football/nfl", hub: "/nfl/", espn: lower({ WAS: "wsh" }), back: { WSH: "WAS" }, team: function (id) { return "#/team/" + id; },
      preview: function (g, S) { var a = S.back[g.away.abbr] || g.away.abbr, h = S.back[g.home.abbr] || g.home.abbr; return "#/game/" + a + "-" + h + (g.week ? "?w=" + g.week : ""); } },
    { k: "nhl", label: "NHL", path: "hockey/nhl", hub: "/nhl/", espn: lower({ NJD: "nj", LAK: "la", TBL: "tb", SJS: "sj", UTA: "utah", MTL: "mtl", WSH: "wsh" }),
      back: { NJ: "NJD", LA: "LAK", TB: "TBL", SJ: "SJS", UTAH: "UTA", MON: "MTL", WAS: "WSH" }, team: function (id) { return "#/team/" + id; },
      preview: function (g) { return "#/game/" + g.id; } },
    { k: "mlb", label: "MLB", path: "baseball/mlb", hub: "/mlb/", espn: lower({ CWS: "chw", ATH: "oak" }), back: { CHW: "CWS", OAK: "ATH" }, team: function (id) { return "#team/" + id; },
      preview: function () { return null; } },
    { k: "ncaab", label: "NCAAB", path: "basketball/mens-college-basketball", hub: "/cbb/", espn: String, back: {}, college: true, board: "groups=50&limit=1000",
      team: function (id) { return "#/team?id=" + encodeURIComponent(id); },
      preview: function (g) { return "#/matchup?a=" + encodeURIComponent(g.away.id) + "&b=" + encodeURIComponent(g.home.id); } },
    { k: "ncaaf", label: "NCAAF", path: "football/college-football", hub: "/cfb/", espn: String, back: {}, college: true, board: "groups=80&limit=400",
      team: function (id) { return "#/team?id=" + encodeURIComponent(id); },
      preview: function (g) { return "#/matchup?a=" + encodeURIComponent(g.away.id) + "&b=" + encodeURIComponent(g.home.id) + "&site=" + (g.neutral ? "n" : "b"); } }
  ];
  var BY = {}; SPORTS.forEach(function (s) { BY[s.k] = s; });
  // the id a hub (and the follow list) uses for an ESPN team: ESPN's id for college, the hub's code for the pros
  function hubId(S, t) { return S.college ? String(t.id) : (S.back[t.abbr] || t.abbr); }
  window.ESPNTeams = { SPORTS: SPORTS, BY: BY, API: API, Q: Q, hubId: hubId,
    schedule: function (S, id) { return API + S.path + "/teams/" + encodeURIComponent(S.espn(id)) + "/schedule?" + Q; },
    scoreboard: function (S, ymd) { return API + S.path + "/scoreboard?" + Q + "&dates=" + ymd + (S.board ? "&" + S.board : ""); } };
})();
