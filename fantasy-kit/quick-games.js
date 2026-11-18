/* Quick Games' choices and setup handoff. Shared by the page and Node checks; no DOM or network. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.FK = root.FK || {}).quickGames = api;
})(this, function () {
  "use strict";
  const SPORTS = {
    nfl: { short: "NFL", name: "Football", duration: "One week or one game", headline: "Make Sunday\nyour league.",
      intro: "The full week, Sunday afternoon, or one primetime matchup. Pick your window, bring your group, and let the real games settle it.",
      scoring: "half", scoringLabel: "Half PPR", unit: "week", verb: "Kickoff", next: "Next kickoff", theme: "field", hub: "/fantasy/nfl/", hubLabel: "NFL rankings & formats",
      ideas: [["The Sunday crew", "Sunday's day games. A live draft. Everyone chasing the same top score."], ["A primetime rivalry", "One matchup, a captain at 1.5x, and bragging rights when the game ends."], ["No meeting required", "Build salary-cap lineups or submit sealed lists before the first kickoff."]] },
    cfb: { short: "NCAAF", name: "College football", duration: "One night or one week", headline: "Own the weekend.\nPlay your Saturday.",
      intro: "The full FBS week, Saturday's main slate, primetime, or midweek MACtion. Pick your games, draft your college stars, and settle it on the field.",
      scoring: "half", scoringLabel: "Half PPR", unit: "slate", verb: "Kickoff", next: "Next kickoff", theme: "college-football", hub: "/cfb/", hubLabel: "Explore the College Football Hub",
      ideas: [["A proper football Saturday", "Build from the main slate or keep it to Saturday night. Your contest scores only the games you choose."], ["Friday lights and MACtion", "A smaller group, a midweek rivalry, or a Friday slate. Play the available FBS matchups without a season-long commitment."], ["Your favorite matchup", "Make one game a showdown: a captain at 1.5x and five flex spots. Finish when that game's final."]] },
    nba: { short: "NBA", name: "Basketball", duration: "One night of NBA", headline: "Your group.\nTonight's games.",
      intro: "Turn a night of basketball into a league. Play the whole slate, stay up for the late games, or make one matchup the main event.",
      scoring: "points", scoringLabel: "Fantasy points", unit: "night", verb: "Tip-off", next: "Next tip-off", theme: "court", hub: "/fantasy/nba/", hubLabel: "NBA rankings & formats",
      ideas: [["A full night of hoops", "Draft from the main slate. Real positions when there are four or more games."], ["The late-night crew", "Choose the late window. Smaller slates use a captain and flexible roster spots."], ["Make it a series", "Run it back on the next slate with the same group and keep a record of the rivalry."]] },
    cbb: { short: "NCAAB", name: "College hoops", duration: "One day of college hoops", headline: "Big games.\nOne-day glory.",
      intro: "A hand-picked college slate, real players, and your friends. Build around the day's featured matchups, with college lineups and DraftKings scoring.",
      scoring: "dk", scoringLabel: "DraftKings points", unit: "day", verb: "Tip-off", next: "Next tip-off", theme: "college", hub: "/cbb/", hubLabel: "Explore the College Hoops Hub",
      ideas: [["The featured slate", "Games selected by the College Hoops Hub. Pick your favorites or take the full slate."], ["Guards, forwards, flex", "Four or more games: three guards, three forwards, and two flex. Smaller slates use a captain."], ["Play your own angle", "Draft your sleepers, rank a sealed list, or fit your lineup under a salary cap."]] },
  };
  const MODES = [
    { key: "snake", name: "Live draft", tag: "Pick together", text: "One player, one team. Take turns in a snake draft with a 30-second pick clock.", timing: "Meet in the draft room" },
    { key: "cap", name: "Salary cap", tag: "No draft needed", text: "Everyone builds under $50,000. Players can appear on more than one team; unique picks earn 1.25x.", timing: "Build before the first game" },
    { key: "sealed", name: "Sealed lists", tag: "At your own pace", text: "Rank players privately. Once everyone's lists lock, the draft runs automatically.", timing: "Submit lists before the deadline" },
  ];
  const sportKey = (key) => SPORTS[key] ? key : "nfl";
  const initial = (key) => ({ sport: sportKey(key), period: "", kind: "", one: "", games: [], mode: "snake", teams: 4, match: "allplay", scoring: SPORTS[sportKey(key)].scoring });
  const periods = (data, SL, now = Date.now()) => ((data && data.weeks) || []).filter((w) => w && Array.isArray(w.games) && SL.open(w, now).length).slice().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  function view(state, data, S, SL, counts, now = Date.now()) {
    const sport = sportKey(state.sport), cfg = SPORTS[sport], ws = periods(data, SL, now);
    const w = SL.resolvePeriod(ws, state.period), options = w ? SL.list(w, now) : [];
    const kind = state.kind || (options[0] || {}).kind || "full";
    const open = w ? SL.open(w, now) : [];
    const ids = kind === "one" ? [state.one || (open[0] || {}).id] : kind === "custom" ? state.games || [] : null;
    const slate = w ? SL.pick(w, kind, ids, now) : null;
    const mode = MODES.some((m) => m.key === state.mode) ? state.mode : "snake";
    const wantedTeams = Number(state.teams) || 4;
    const lu = slate ? SL.lineup(slate.games.length, mode === "cap" ? 2 : wantedTeams, sport) : null;
    const roster = lu ? lu.lineup.length + (mode === "cap" ? 0 : lu.bench) : 0;
    const poolCount = slate && counts ? slate.teams.reduce((n, t) => n + (counts[t] || 0), 0) : null;
    const ceiling = S.football(sport) && slate && slate.games.length === 1 ? 6 : 16;
    const max = mode === "cap" ? 16 : poolCount != null ? Math.max(2, Math.min(ceiling, Math.floor(poolCount / Math.max(1, roster)))) : slate && slate.games.length === 1 ? 4 : 16;
    const teamOptions = [2, 4, 6, 8, 10, 12, 14, 16].filter((n) => n <= max);
    const teams = teamOptions.reduce((b, n) => Math.abs(n - wantedTeams) < Math.abs(b - wantedTeams) ? n : b, teamOptions[0]);
    const lineup = slate ? SL.lineup(slate.games.length, mode === "cap" ? 2 : teams, sport) : null;
    const scoring = S[sport].scorings[state.scoring] && S[sport].scorings[state.scoring].type === "points" ? state.scoring : cfg.scoring;
    const match = state.match === "h2h" ? "h2h" : "allplay";
    return { sport, cfg, periods: ws, w, kind, options, open, slate, mode, teams, teamOptions, lineup, poolCount, scoring, match,
      error: data && data.error ? "The schedule could not be reached." : state.period && !w ? "That game window has closed. Choose another date." : !w ? "" : !slate ? kind === "custom" ? "Select at least one game." : "That selection is no longer available. Choose another window or matchup." : "" };
  }
  function rules(v, SL) {
    if (!v.slate || v.error) return null;
    const r = { sport: v.sport, kind: "week", teams: v.teams, type: v.mode, clock: 30, scoring: v.scoring, season: v.match,
      slPeriod: SL.periodKey(v.w), slKind: v.kind, slWeek: v.periods.indexOf(v.w), lineup: v.lineup.lineup.join(" "), bench: v.mode === "cap" ? 0 : v.lineup.bench,
      ir: 0, playoffs: 0, capBudget: 50000, capBonus: 1 };
    if (v.kind === "one") r.slOne = v.slate.games[0].id;
    if (v.kind === "custom") r.slGames = v.slate.games.map((g) => g.id);
    return r;
  }
  function setupHref(v, E, SL, custom = false) {
    const r = rules(v, SL); if (!r) return "";
    return "/fantasy/leagues/?" + new URLSearchParams({ w: "1", s: v.sport, quick: "1", rules: E.encode(r), ...(custom ? { custom: "1" } : {}) });
  }
  function mockHref(sport) {
    const s = sportKey(sport);
    return "/fantasy/mock/?" + new URLSearchParams({ s, scoring: SPORTS[s].scoring }) + "#setup";
  }
  function seriesFor(mine, sport) {
    const by = new Map();
    for (const l of mine || []) {
      if (!l.oneWeek || l.sport !== sport) continue;
      const key = l.series || l.id, prev = by.get(key);
      if (!prev || (l.seriesN || 1) > (prev.seriesN || 1)) by.set(key, l);
    }
    return Array.from(by.values()).sort((a, b) => (Date.parse(b.updated) || 0) - (Date.parse(a.updated) || 0));
  }
  function scoringRows(v, S) {
    const w = S.football(v.sport) ? { ...S.POINT_DEFAULTS[v.sport], rec: v.scoring === "ppr" ? 1 : v.scoring === "std" ? 0 : 0.5 } : S[v.sport].scorings[v.scoring].weights;
    const fields = S.football(v.sport) ? [["pass_td", "Passing TD"], ["rush_td", "Rushing TD"], ["rec_td", "Receiving TD"], ["rec", "Reception"], ["pass_int", "Interception"]]
      : [["pts", "Point"], ["reb", "Rebound"], ["ast", "Assist"], ["stl", "Steal"], ["blk", "Block"], ["tov", "Turnover"], ...(w.dd ? [["dd", "Double-double bonus"], ["td", "Triple-double bonus"]] : [])];
    return fields.map(([k, label]) => ({ key: k, label, value: w[k] || 0 }));
  }
  return { SPORTS, MODES, sportKey, initial, periods, view, rules, setupHref, mockHref, seriesFor, scoringRows };
});
