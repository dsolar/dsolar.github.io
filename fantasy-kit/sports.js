/* Fantasy Kit: sport configs. No DOM and no network, so pages, tests and servers can all load it.

   A sport says what a roster looks like and how players are measured:
     positions  the real positions a player can carry, in display order
     slots      each lineup slot and the positions that can fill it ("*" is anyone)
     lineup     the default starting slots; bench is the default number of bench spots
     posMax     the most a drafted roster should carry at a position (bots and autopicks respect it)
     late       positions bots leave for the last rounds (kickers and defenses)
     scorings   named ways to score: categories (z-scores) or points (a column of the data)
     columns    stat columns for player tables, by data line
   Player data comes from fantasy-kit/data/<sport>.json (tools/fantasykit_data.py), where each player has
   l[line] = values in that line's cols order. stat(p, line, col) reads one. */
(function (root, factory) {
  const m = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = m;
  else (root.FK = root.FK || {}).sports = m;
})(this, function () {
  "use strict";

  const r3 = (v) => (v == null ? "-" : v.toFixed(3).replace(/^0/, ""));
  const f1 = (v) => (v == null ? "-" : v.toFixed(1));
  // innings the way box scores write them: 172 and two thirds is 172.2
  const fip = (x) => (x == null ? "" : `${Math.floor(x + 1e-6)}.${Math.round((x - Math.floor(x + 1e-6)) * 3)}`);
  const f2 = (v) => (v == null ? "-" : v.toFixed(2));
  const f0 = (v) => (v == null ? "-" : String(Math.round(v)));

  // Reads a stat. Each sport carries its data's column lists after FK.sports.attach(sport, data). `col` is a column's
  // name, or a weighted sum of columns ({ col: weight }) for the formula categories (wOBA's parts, steals plus
  // blocks); a sum the data can't make (a column it doesn't have) is null.
  function stat(sport, p, line, col) {
    const l = p && p.l && p.l[line];
    if (!l) return null;
    const cm = sport.cols[line];
    if (col && typeof col === "object") {
      let t = 0;
      for (const [c, w] of Object.entries(col)) { const i = cm ? cm[c] : null; if (i == null || i < 0) return null; t += (l[i] || 0) * w; }
      return t;
    }
    const i = cm ? cm[col] : -1;
    return i == null || i < 0 ? null : l[i];
  }
  // The same on a raw line (a week's box-score array) with its column map; a column the line lacks counts as 0.
  const lineVal = (row, cm, col) => {
    if (!row || !cm) return 0;
    if (col && typeof col === "object") { let t = 0; for (const [c, w] of Object.entries(col)) t += ((cm[c] != null ? row[cm[c]] : 0) || 0) * w; return t; }
    return (cm[col] != null ? row[cm[col]] : 0) || 0;
  };
  // A ratio category from its parts: makes over attempts, or a formula's sum over its volume, scaled (K/9 is 9 times
  // strikeouts per inning) and shifted (FIP's constant).
  const ratioVal = (c, n, d) => (d ? (c.mult || 1) * n / d + (c.add || 0) : 0);
  // The columns a category reads, so a pick list can leave out the ones a sport's data can't make yet.
  const catCols = (c) => [c.col, c.num, c.den, c.rate, c.w].filter((x) => x != null).flatMap((x) => (typeof x === "object" ? Object.keys(x) : [x]));
  const catOk = (sport, c) => !sport.cols || catCols(c).every((x) => sport.cols[c.line || "pg"] && sport.cols[c.line || "pg"][x] != null);

  /* ---------- basketball ---------- */
  const nba = {
    key: "nba", name: "Basketball", league: "NBA", unit: "game",
    positions: ["PG", "SG", "SF", "PF", "C"],
    colors: { PG: 1, SG: 2, SF: 3, PF: 4, C: 5 },
    slots: { PG: ["PG"], SG: ["SG"], G: ["PG", "SG"], SF: ["SF"], PF: ["PF"], F: ["SF", "PF"], C: ["C"], UTIL: "*", CPT: "*", BN: "*" },   // CPT: a one-day captain
    lineup: ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL", "UTIL"],
    bench: 3,
    posMax: { C: 5 },
    late: [],
    sample: { line: "pg", col: "eg", k: 12 },           // small samples lean toward replacement level (eg counts last season too)
    scorings: {
      cats9: {
        label: "9 categories", type: "cats", line: "pg",
        cats: [
          { k: "fg", label: "FG%", num: "fgm", den: "fga", fmt: r3 },
          { k: "ft", label: "FT%", num: "ftm", den: "fta", fmt: r3 },
          { k: "tpm", label: "3PM", col: "tpm" },
          { k: "pts", label: "PTS", col: "pts" },
          { k: "reb", label: "REB", col: "reb" },
          { k: "ast", label: "AST", col: "ast" },
          { k: "stl", label: "STL", col: "stl" },
          { k: "blk", label: "BLK", col: "blk" },
          { k: "tov", label: "TO", col: "tov", low: true },
        ],
        base: (sport, p) => (stat(sport, p, "pg", "min") || 0) >= 20 && (stat(sport, p, "pg", "eg") || 0) >= 12,
      },
      points: {
        label: "Points", type: "points", line: "pg", per: "game", games: 72,
        weights: { pts: 1, reb: 1.2, ast: 1.5, stl: 3, blk: 3, tov: -1, tpm: 0.5 },
      },
    },
    columns: [
      { line: "pg", col: "gp", label: "GP", fmt: f0 },
      { line: "pg", col: "min", label: "MIN", fmt: f1, hide: "s" },
      { line: "pg", col: "pts", label: "PTS", fmt: f1 },
      { line: "pg", col: "reb", label: "REB", fmt: f1 },
      { line: "pg", col: "ast", label: "AST", fmt: f1 },
      { line: "pg", col: "stl", label: "STL", fmt: f1, hide: "s" },
      { line: "pg", col: "blk", label: "BLK", fmt: f1, hide: "s" },
      { line: "pg", col: "tpm", label: "3PM", fmt: f1, hide: "s" },
      { line: "pg", label: "FG%", ratio: ["fgm", "fga"], fmt: r3, hide: "s" },
      { line: "pg", label: "FT%", ratio: ["ftm", "fta"], fmt: r3, hide: "s" },
      { line: "pg", col: "tov", label: "TO", fmt: f1, hide: "s" },
    ],
  };

  /* ---------- college basketball ---------- */
  // The CBB Hub's player pool (fantasy-kit/data/cbb.json, tools/cbb_dfs.py): every Division I school, guards and
  // forwards as DraftKings lists them (a center plays forward). One-day games use DraftKings' scoring; season leagues
  // score real Monday-Sunday weeks (weeks-cbb.json, tools/fantasykit_cbb.mjs) and can keep the pool to chosen
  // conferences (settings.confs). The season runs November to the national title game; a league can stop sooner.
  const cbb = {
    key: "cbb", name: "College hoops", league: "NCAA", unit: "game", college: true,
    positions: ["G", "F"],
    colors: { G: 1, F: 4 },
    slots: { G: ["G"], F: ["F"], UTIL: "*", CPT: "*", BN: "*" },
    lineup: ["G", "G", "G", "F", "F", "F", "UTIL", "UTIL"],
    bench: 4,
    oneDayBench: 1,
    posMax: {},
    late: [],
    // the pool's "eg" is 0 (no prior season blended in), so small samples count games played
    sample: { line: "pg", col: "gp", k: 4 },
    scorings: {
      dk: {
        label: "DraftKings points", type: "points", line: "pg", per: "game", games: 31,
        weights: { pts: 1, tpm: 0.5, reb: 1.25, ast: 1.5, stl: 2, blk: 2, tov: -0.5, dd: 1.5, td: 3 },
      },
      points: {
        label: "Points", type: "points", line: "pg", per: "game", games: 31,
        weights: { pts: 1, reb: 1.2, ast: 1.5, stl: 3, blk: 3, tov: -1, tpm: 0.5 },
      },
      cats9: {
        label: "9 categories", type: "cats", line: "pg", games: 31,
        cats: [
          { k: "fg", label: "FG%", num: "fgm", den: "fga", fmt: r3 },
          { k: "ft", label: "FT%", num: "ftm", den: "fta", fmt: r3 },
          { k: "tpm", label: "3PM", col: "tpm" },
          { k: "pts", label: "PTS", col: "pts" },
          { k: "reb", label: "REB", col: "reb" },
          { k: "ast", label: "AST", col: "ast" },
          { k: "stl", label: "STL", col: "stl" },
          { k: "blk", label: "BLK", col: "blk" },
          { k: "tov", label: "TO", col: "tov", low: true },
        ],
        // measured against regulars: real minutes and enough games to mean something
        base: (sport, p) => (stat(sport, p, "pg", "min") || 0) >= 22 && (stat(sport, p, "pg", "gp") || 0) >= 2,
      },
    },
    columns: [
      { line: "pg", col: "gp", label: "GP", fmt: f0 },
      { line: "pg", col: "min", label: "MIN", fmt: f1, hide: "s" },
      { line: "pg", col: "pts", label: "PTS", fmt: f1 },
      { line: "pg", col: "reb", label: "REB", fmt: f1 },
      { line: "pg", col: "ast", label: "AST", fmt: f1 },
      { line: "pg", col: "stl", label: "STL", fmt: f1, hide: "s" },
      { line: "pg", col: "blk", label: "BLK", fmt: f1, hide: "s" },
      { line: "pg", col: "tpm", label: "3PM", fmt: f1, hide: "s" },
      { line: "pg", label: "FG%", ratio: ["fgm", "fga"], fmt: r3, hide: "s" },
      { line: "pg", col: "tov", label: "TO", fmt: f1, hide: "s" },
    ],
  };
  // sports with a one-day game: tonight's games, scored on the night's box scores
  const DAILY = ["nba", "cbb"];
  const daily = (k) => DAILY.includes(k && k.key ? k.key : k);

  /* ---------- football ---------- */
  const nfl = {
    key: "nfl", name: "Football", league: "NFL", unit: "game",
    positions: ["QB", "RB", "WR", "TE", "K", "DEF"],
    colors: { QB: 5, RB: 3, WR: 1, TE: 4, K: 6, DEF: 2 },
    // CPT and UTIL take anyone, kickers and defenses too: a showdown's captain and its flex spots
    slots: { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], FLEX: ["RB", "WR", "TE"], SFLEX: ["QB", "RB", "WR", "TE"], CPT: ["QB", "RB", "WR", "TE", "K", "DEF"], UTIL: ["QB", "RB", "WR", "TE", "K", "DEF"], K: ["K"], DEF: ["DEF"], BN: "*" },
    lineup: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF"],
    bench: 6,
    posMax: { QB: 3, RB: 7, WR: 7, TE: 3, K: 1, DEF: 1 },
    late: ["K", "DEF"],
    sample: { line: "tot", col: "g", k: 3 },
    // custom category leagues start from this (football has no category preset): season totals so far, measured
    // against players a league would roster
    catsTemplate: { label: "Categories", type: "cats", line: "tot", games: 17, cats: [],
      base: (sport, p) => (stat(sport, p, "tot", "g") || 0) >= 4 && (stat(sport, p, "tot", "pts_half_ppr") || 0) >= 50 },
    scorings: {
      half: { label: "Half PPR", type: "points", line: "tot", col: "pts_half_ppr", proj: 1, games: 17 },
      ppr: { label: "PPR", type: "points", line: "tot", col: "pts_ppr", proj: 2, games: 17 },
      std: { label: "Standard", type: "points", line: "tot", col: "pts_std", proj: 0, games: 17 },
    },
    columns: [
      { line: "tot", col: "g", label: "G", fmt: f0 },
      { fpts: true, label: "FPTS", fmt: f1, title: "Fantasy points this season" },
      { fpg: true, label: "FP/G", fmt: f1, title: "Fantasy points per game" },
      { line: "tot", col: "pass_yd", pos: ["QB"], label: "PaYd", fmt: f0, hide: "s" },
      { line: "tot", col: "pass_td", pos: ["QB"], label: "PaTD", fmt: f0, hide: "s" },
      { line: "tot", col: "pass_int", pos: ["QB"], label: "Int", fmt: f0, hide: "s" },
      { line: "tot", col: "rush_yd", pos: ["QB", "RB", "FLEX", "SFLEX"], label: "RuYd", fmt: f0, hide: "s" },
      { line: "tot", col: "rush_td", pos: ["QB", "RB", "FLEX", "SFLEX"], label: "RuTD", fmt: f0, hide: "s" },
      { line: "tot", col: "rec", pos: ["RB", "WR", "TE", "FLEX", "SFLEX"], label: "Rec", fmt: f0, hide: "s" },
      { line: "tot", col: "rec_yd", pos: ["RB", "WR", "TE", "FLEX", "SFLEX"], label: "ReYd", fmt: f0, hide: "s" },
      { line: "tot", col: "rec_td", pos: ["RB", "WR", "TE", "FLEX", "SFLEX"], label: "ReTD", fmt: f0, hide: "s" },
    ],
  };

  /* ---------- baseball ---------- */
  const HIT = ["C", "1B", "2B", "3B", "SS", "OF", "UT"];
  // Z-scores measure against players a league would roster: regulars, starters and closers.
  const mlbBase = (sport, p, line) => (line === "bat" ? (stat(sport, p, "bat", "pa") || 0) >= 400
    : (stat(sport, p, "pit", "ip") || 0) >= 110 || (stat(sport, p, "pit", "sv") || 0) >= 12 || (stat(sport, p, "pit", "hld") || 0) >= 12);
  // Counting stats paced to a full season (600 plate appearances, 175 innings for a starter, 65 for a reliever).
  const mlbPace = {
    bat: { col: "pa", full: 600, k: 200 },
    pit: { col: "ip", full: (sport, p) => (p.pos.includes("SP") ? 175 : 65), k: 60 },
  };
  const mlb = {
    key: "mlb", name: "Baseball", league: "MLB", unit: "season",
    positions: ["C", "1B", "2B", "3B", "SS", "OF", "UT", "SP", "RP"],
    colors: { C: 6, "1B": 4, "2B": 2, "3B": 5, SS: 3, OF: 1, UT: 6, SP: 7, RP: 8 },
    slots: { C: ["C"], "1B": ["1B"], "2B": ["2B"], "3B": ["3B"], SS: ["SS"], MI: ["2B", "SS"], CI: ["1B", "3B"], OF: ["OF"], UTIL: HIT, SP: ["SP"], RP: ["RP"], P: ["SP", "RP"], BN: "*" },
    lineup: ["C", "1B", "2B", "3B", "SS", "OF", "OF", "OF", "UTIL", "UTIL", "SP", "SP", "RP", "RP", "P", "P", "P", "P"],
    bench: 5,
    posMax: { C: 3, SP: 9, RP: 7 },
    late: [],
    groups: { bat: HIT, pit: ["SP", "RP"] },
    scorings: {
      roto5: {
        label: "5x5 categories", type: "cats",
        cats: [
          { k: "r", label: "R", line: "bat", col: "r" },
          { k: "hr", label: "HR", line: "bat", col: "hr" },
          { k: "rbi", label: "RBI", line: "bat", col: "rbi" },
          { k: "sb", label: "SB", line: "bat", col: "sb" },
          { k: "avg", label: "AVG", line: "bat", rate: "avg", w: "ab", fmt: r3 },
          { k: "w", label: "W", line: "pit", col: "w" },
          { k: "sv", label: "SV", line: "pit", col: "sv" },
          { k: "k", label: "K", line: "pit", col: "k" },
          { k: "era", label: "ERA", line: "pit", rate: "era", w: "ip", low: true, fmt: f2 },
          { k: "whip", label: "WHIP", line: "pit", rate: "whip", w: "ip", low: true, fmt: f2 },
        ],
        base: mlbBase, pace: mlbPace,
      },
      yoenis: {
        label: "8x8 categories", type: "cats",
        cats: [
          { k: "r", label: "R", line: "bat", col: "r" },
          { k: "h", label: "H", line: "bat", col: "h" },
          { k: "hr", label: "HR", line: "bat", col: "hr" },
          { k: "rbi", label: "RBI", line: "bat", col: "rbi" },
          { k: "sb", label: "SB", line: "bat", col: "sb" },
          { k: "tb", label: "TB", line: "bat", col: "tb" },
          { k: "avg", label: "AVG", line: "bat", rate: "avg", w: "ab", fmt: r3 },
          { k: "ops", label: "OPS", line: "bat", rate: "ops", w: "pa", fmt: r3 },
          { k: "w", label: "W", line: "pit", col: "w" },
          { k: "l", label: "L", line: "pit", col: "l", low: true },
          { k: "sv", label: "SV", line: "pit", col: "sv" },
          { k: "k", label: "K", line: "pit", col: "k" },
          { k: "hld", label: "HLD", line: "pit", col: "hld" },
          { k: "era", label: "ERA", line: "pit", rate: "era", w: "ip", low: true, fmt: f2 },
          { k: "whip", label: "WHIP", line: "pit", rate: "whip", w: "ip", low: true, fmt: f2 },
          { k: "qs", label: "QS", line: "pit", col: "qs" },
        ],
        base: mlbBase, pace: mlbPace,
      },
    },
    columns: [
      { line: "bat", col: "r", label: "R", fmt: f0, group: "bat" },
      { line: "bat", col: "hr", label: "HR", fmt: f0, group: "bat" },
      { line: "bat", col: "rbi", label: "RBI", fmt: f0, group: "bat" },
      { line: "bat", col: "sb", label: "SB", fmt: f0, group: "bat" },
      { line: "bat", col: "avg", label: "AVG", fmt: r3, group: "bat" },
      { line: "bat", col: "ops", label: "OPS", fmt: r3, group: "bat", hide: "s" },
      { line: "pit", col: "ip", label: "IP", fmt: fip, group: "pit", hide: "s" },
      { line: "pit", col: "w", label: "W", fmt: f0, group: "pit" },
      { line: "pit", col: "sv", label: "SV", fmt: f0, group: "pit" },
      { line: "pit", col: "k", label: "K", fmt: f0, group: "pit" },
      { line: "pit", col: "era", label: "ERA", fmt: f2, group: "pit" },
      { line: "pit", col: "whip", label: "WHIP", fmt: f2, group: "pit", hide: "s" },
    ],
  };

  /* ---------- hockey ---------- */
  const SKATERS = ["C", "LW", "RW", "D"];
  const NHL_CATS = [
    { k: "g", label: "G", line: "sk", col: "g" },
    { k: "a", label: "A", line: "sk", col: "a" },
    { k: "pm", label: "+/−", line: "sk", col: "pm" },
    { k: "pim", label: "PIM", line: "sk", col: "pim" },
    { k: "ppp", label: "PPP", line: "sk", col: "ppp" },
    { k: "sog", label: "SOG", line: "sk", col: "sog" },
    { k: "wins", label: "W", line: "goalie", col: "w" },
    { k: "gaa", label: "GAA", line: "goalie", rate: "gaa", w: "min", low: true, fmt: f2 },
    { k: "svp", label: "SV%", line: "goalie", num: "saves", den: "sa", fmt: r3 },
    { k: "so", label: "SO", line: "goalie", col: "so" },
  ];
  const nhl = {
    key: "nhl", name: "Hockey", league: "NHL", unit: "season", gamesCol: "gp",
    positions: ["C", "LW", "RW", "D", "G"],
    colors: { C: 1, LW: 3, RW: 4, D: 0, G: 5 },
    slots: { C: ["C"], LW: ["LW"], RW: ["RW"], W: ["LW", "RW"], F: ["C", "LW", "RW"], D: ["D"], G: ["G"], UTIL: SKATERS, BN: "*" },
    lineup: ["C", "C", "LW", "LW", "RW", "RW", "D", "D", "D", "D", "G", "G"],
    bench: 4, posMax: { G: 4 }, late: [],
    groups: { sk: SKATERS, goalie: ["G"] }, groupLabels: { sk: "Skaters", goalie: "Goalies" },
    scorings: {
      cats10: { label: "10 categories", type: "cats", cats: NHL_CATS },
      bangers: { label: "12 categories: hits + blocks", type: "cats", cats: NHL_CATS.concat([
        { k: "hits", label: "HIT", line: "sk", col: "hits" }, { k: "blocks", label: "BLK", line: "sk", col: "blk" },
      ]) },
      points: { label: "Points", type: "points", line: "sk", games: 82,
        weights: { "sk.g": 3, "sk.a": 2, "sk.ppp": 1, "sk.shp": 1, "sk.sog": 0.4, "sk.hits": 0.2, "sk.blk": 0.4,
          "goalie.w": 4, "goalie.saves": 0.2, "goalie.ga": -1, "goalie.so": 3 } },
    },
    columns: [
      { line: "sk", col: "gp", label: "GP", fmt: f0, group: "sk" },
      { line: "sk", col: "g", label: "G", title: "Goals", fmt: f0, group: "sk" },
      { line: "sk", col: "a", label: "A", fmt: f0, group: "sk" },
      { line: "sk", col: "pts", label: "PTS", title: "Goals plus assists", fmt: f0, group: "sk" },
      { line: "sk", col: "pm", label: "+/−", fmt: f0, group: "sk", hide: "s" },
      { line: "sk", col: "ppp", label: "PPP", fmt: f0, group: "sk" },
      { line: "sk", col: "sog", label: "SOG", fmt: f0, group: "sk" },
      { line: "sk", col: "hits", label: "HIT", fmt: f0, group: "sk", hide: "s" },
      { line: "sk", col: "blk", label: "BLK", title: "Blocked shots", fmt: f0, group: "sk", hide: "s" },
      { line: "goalie", col: "gp", label: "GP", fmt: f0, group: "goalie" },
      { line: "goalie", col: "w", label: "W", fmt: f0, group: "goalie" },
      { line: "goalie", col: "saves", label: "SV", fmt: f0, group: "goalie" },
      { line: "goalie", col: "gaa", label: "GAA", fmt: f2, group: "goalie" },
      { line: "goalie", col: "svp", label: "SV%", fmt: r3, group: "goalie" },
      { line: "goalie", col: "so", label: "SO", fmt: f0, group: "goalie", hide: "s" },
    ],
  };

  const ALL = { nba, nfl, mlb, nhl, cbb };
  // the sports a season league, a mock draft or a rankings page offers
  const SEASON_SPORTS = Object.values(ALL).filter((s) => !s.dailyOnly);

  // Links a sport to the columns of its data file, so stat() can read the compact arrays.
  function attach(sport, data) {
    sport.cols = {};
    for (const [line, def] of Object.entries(data.lines || {})) sport.cols[line] = Object.fromEntries(def.cols.map((c, i) => [c, i]));
    sport.data = { season: data.season, prev: data.prev || null, updated: data.updated, source: data.source, lines: data.lines };
    sport.hasAge = (data.players || []).some((p) => p.age);
    // a pool that carries its own teams (college: 365 schools) brings their colors and logos with it
    if (data.teams && !Array.isArray(data.teams)) {
      TEAM_COLORS[sport.key] = Object.assign(TEAM_COLORS[sport.key] || {}, Object.fromEntries(Object.entries(data.teams).filter(([, t]) => t && t.c).map(([k, t]) => [k, t.c])));
      LOGOS[sport.key] = Object.assign(LOGOS[sport.key] || {}, Object.fromEntries(Object.entries(data.teams).filter(([, t]) => t && t.logo).map(([k, t]) => [k, t.logo])));
    }
    return sport;
  }

  // Positions a player can play, and whether he fits a slot.
  const positions = (p) => (p && p.pos ? p.pos : []);
  function fits(sport, p, slot) {
    const ok = sport.slots[slot];
    if (!ok) return false;
    return ok === "*" || positions(p).some((x) => ok.includes(x));
  }
  // Players who only fill late slots (kickers, defenses) are "late" for bots.
  const isLate = (sport, p) => positions(p).length > 0 && positions(p).every((x) => sport.late.includes(x));

  /* ---------- custom scoring ---------- */
  // A league's own scoring, kept as plain data with the draft (D.scoringSpec) and rebuilt here:
  //   { type: "points", weights: { stat: value } }   stat keys from POINT_STATS (baseball's are "bat.r", "pit.k")
  //   { type: "cats", cats: ["fg", "ft", ...] }       category keys from catCatalog(sport)
  // withScoring(sport, spec) adds it to the sport as the "custom" scoring.
  const POINT_STATS = {
    nba: [["pts", "Points"], ["reb", "Rebounds"], ["ast", "Assists"], ["stl", "Steals"], ["blk", "Blocks"], ["tov", "Turnovers"], ["tpm", "3-pointers made"],
      ["fgm", "Field goals made"], ["fga", "Field goals tried"], ["ftm", "Free throws made"], ["fta", "Free throws tried"],
      ["tpa", "3-pointers tried"], ["oreb", "Offensive rebounds"], ["dreb", "Defensive rebounds"], ["pf", "Personal fouls"], ["dd", "Double-doubles"],
      ["td", "Triple-doubles"], ["pm", "Plus/minus"], ["min", "Minutes"]],
    get cbb() { return this.nba.filter(([k]) => k !== "pm"); },
    nfl: [["pass_yd", "Passing yards"], ["pass_td", "Passing TDs"], ["pass_int", "Interceptions thrown"], ["rush_att", "Carries"], ["rush_yd", "Rushing yards"], ["rush_td", "Rushing TDs"],
      ["rec", "Receptions"], ["rec_yd", "Receiving yards"], ["rec_td", "Receiving TDs"], ["fum_lost", "Fumbles lost"], ["fgm", "Field goals made"], ["xpm", "Extra points made"],
      ["def_td", "Defensive TDs"], ["def_int", "Interceptions caught"], ["def_sack", "Sacks"], ["pts_allow", "Points allowed"],
      ["pass_att", "Pass attempts"], ["pass_cmp", "Completions"], ["rec_tgt", "Targets"], ["pass_fd", "Passing first downs"], ["rush_fd", "Rushing first downs"],
      ["rec_fd", "Receiving first downs"], ["pass_2pt", "2-pt passes"], ["rush_2pt", "2-pt runs"], ["rec_2pt", "2-pt catches"], ["fum", "Fumbles"],
      ["fga", "Field goals tried"], ["fgm_50p", "Field goals of 50+ yards"], ["xpmiss", "Extra points missed"], ["fum_rec", "Fumble recoveries"],
      ["ff", "Forced fumbles"], ["safe", "Safeties"], ["def_st_td", "Special teams TDs"], ["yds_allow", "Yards allowed"],
      ["epa_pass", "Passing EPA"], ["epa_rush", "Rushing EPA"], ["epa_rec", "Receiving EPA"], ["pass_sacked", "Times sacked"],
      ["air_rec", "Receiving air yards"], ["yac_rec", "Yards after catch"]],
    mlb: [["bat.r", "Runs"], ["bat.h", "Hits"], ["bat.hr", "Home runs"], ["bat.rbi", "RBI"], ["bat.sb", "Stolen bases"], ["bat.tb", "Total bases"],
      ["pit.ip", "Innings pitched"], ["pit.w", "Wins"], ["pit.l", "Losses"], ["pit.sv", "Saves"], ["pit.hld", "Holds"], ["pit.k", "Strikeouts"], ["pit.er", "Earned runs"],
      ["pit.bb", "Walks allowed"], ["pit.h", "Hits allowed"], ["pit.qs", "Quality starts"],
      ["bat.2b", "Doubles"], ["bat.3b", "Triples"], ["bat.bb", "Walks"], ["bat.hbp", "Hit by pitch"], ["bat.so", "Strikeouts (batting)"], ["bat.cs", "Caught stealing"],
      ["bat.sf", "Sacrifice flies"], ["pit.gs", "Games started"], ["pit.hr", "Home runs allowed"], ["pit.hbp", "Batters hit"]],
    nhl: [["sk.g", "Goals"], ["sk.a", "Assists"], ["sk.pm", "Plus/minus"], ["sk.pim", "Penalty minutes"], ["sk.ppp", "Power-play points"], ["sk.ppg", "Power-play goals"],
      ["sk.shp", "Shorthanded points"], ["sk.sog", "Shots on goal"], ["sk.hits", "Hits"], ["sk.blk", "Blocked shots"],
      ["goalie.w", "Goalie wins"], ["goalie.saves", "Saves"], ["goalie.ga", "Goals against"], ["goalie.so", "Shutouts"],
      ["sk.pts", "Points"], ["goalie.gs", "Goalie starts"], ["goalie.l", "Goalie losses"], ["goalie.otl", "Overtime losses"], ["goalie.sa", "Shots against"],
      ["sk.tka", "Takeaways"], ["sk.gva", "Giveaways"], ["sk.fow", "Faceoffs won"], ["sk.fol", "Faceoffs lost"], ["sk.sat", "Shot attempts"]],
  };
  const POINT_DEFAULTS = {
    nba: { pts: 1, reb: 1.2, ast: 1.5, stl: 3, blk: 3, tov: -1, tpm: 0.5 },
    nfl: { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6, fum_lost: -2, fgm: 3, xpm: 1, def_td: 6, def_int: 2, def_sack: 1 },
    mlb: { "bat.r": 1, "bat.tb": 1, "bat.rbi": 1, "bat.sb": 1, "pit.ip": 3, "pit.w": 2, "pit.l": -2, "pit.sv": 5, "pit.hld": 2, "pit.k": 1, "pit.er": -2, "pit.bb": -1, "pit.h": -1 },
    nhl: Object.assign({}, nhl.scorings.points.weights),
    cbb: Object.assign({}, cbb.scorings.dk.weights),
  };
  // Every category any of a sport's presets uses, plus a few common extras.
  // Categories no preset uses, for custom category leagues: the advanced ones are formulas over the box-score
  // columns (num and den can be weighted sums; mult and add scale the ratio), so they add up across players and weeks
  // exactly like FG% does. adv marks them for the pick list. wOBA uses FanGraphs' recent linear weights.
  const pct1 = (v) => (v == null ? "-" : (v * 100).toFixed(1) + "%");
  const EXTRA_CATS = {
    get cbb() { return this.nba.filter((c) => c.k !== "pm"); },     // college box scores carry no plus/minus
    nba: [
      { k: "oreb", label: "OREB", col: "oreb", title: "Offensive rebounds" },
      { k: "dreb", label: "DREB", col: "dreb", title: "Defensive rebounds" },
      { k: "tpa", label: "3PA", col: "tpa", title: "3-pointers attempted" },
      { k: "tpp", label: "3P%", num: "tpm", den: "tpa", fmt: r3, unit: 0.48, title: "3-point percentage" },
      { k: "dd", label: "DD", col: "dd", title: "Double-doubles" },
      { k: "td", label: "TD", col: "td", title: "Triple-doubles" },
      { k: "pm", label: "+/-", col: "pm", title: "Plus/minus" },
      { k: "pf", label: "PF", col: "pf", low: true, title: "Personal fouls (lower is better)" },
      { k: "ftm", label: "FTM", col: "ftm", title: "Free throws made" },
      { k: "fgm", label: "FGM", col: "fgm", title: "Field goals made" },
      { k: "min", label: "MIN", col: "min", title: "Minutes" },
      { k: "stocks", label: "STL+BLK", col: { stl: 1, blk: 1 }, title: "Steals plus blocks" },
      { k: "pra", label: "PTS+REB+AST", col: { pts: 1, reb: 1, ast: 1 }, title: "Points, rebounds and assists" },
      { k: "pr", label: "PTS+REB", col: { pts: 1, reb: 1 }, title: "Points plus rebounds" },
      { k: "pa", label: "PTS+AST", col: { pts: 1, ast: 1 }, title: "Points plus assists" },
      { k: "ts", label: "TS%", num: { pts: 1 }, den: { fga: 2, fta: 0.88 }, fmt: r3, adv: true, title: "True shooting: points per shot, free throws counted" },
      { k: "efg", label: "eFG%", num: { fgm: 1, tpm: 0.5 }, den: "fga", fmt: r3, adv: true, title: "Effective field goal percentage: a three counts as 1.5 makes" },
      { k: "ato", label: "A/TO", num: "ast", den: "tov", fmt: f2, unit: 1.2, adv: true, title: "Assists per turnover" },
      { k: "tpar", label: "3PAr", num: "tpa", den: "fga", fmt: r3, unit: 0.45, adv: true, title: "3-point attempt rate: share of shots from three" },
      { k: "ftr", label: "FTr", num: "fta", den: "fga", fmt: r3, unit: 0.4, adv: true, title: "Free throw rate: free throws tried per shot" },
      { k: "orbr", label: "OREB share", num: "oreb", den: "reb", fmt: pct1, unit: 0.45, adv: true, title: "Share of his rebounds on offense" },
      { k: "ppm", label: "PTS/36", num: "pts", den: "min", mult: 36, fmt: f1, unit: 8, adv: true, title: "Points per 36 minutes" },
      { k: "rpm", label: "REB/36", num: "reb", den: "min", mult: 36, fmt: f1, unit: 4, adv: true, title: "Rebounds per 36 minutes" },
      { k: "apm", label: "AST/36", num: "ast", den: "min", mult: 36, fmt: f1, unit: 3, adv: true, title: "Assists per 36 minutes" },
      { k: "stocks36", label: "STK/36", num: { stl: 1, blk: 1 }, den: "min", mult: 36, fmt: f1, unit: 1.5, adv: true, title: "Steals plus blocks per 36 minutes" },
      { k: "tovr", label: "TOV%", num: "tov", den: { fga: 1, fta: 0.44, tov: 1 }, low: true, fmt: pct1, unit: 0.35, adv: true, title: "Turnovers per possession used (lower is better)" },
      { k: "gmsc", label: "Game Score", col: { pts: 1, fgm: 0.4, fga: -0.7, fta: -0.4, ftm: 0.4, oreb: 0.7, dreb: 0.3, stl: 1, ast: 0.7, blk: 0.7, pf: -0.4, tov: -1 }, fmt: f1, adv: true, title: "John Hollinger's Game Score, added up: one number for a whole box score" },
    ],
    nfl: [
      { k: "pass_yd", label: "Pass yds", line: "tot", col: "pass_yd", title: "Passing yards" },
      { k: "pass_td", label: "Pass TD", line: "tot", col: "pass_td", title: "Passing touchdowns" },
      { k: "pass_int", label: "INT", line: "tot", col: "pass_int", low: true, title: "Interceptions thrown (lower is better)" },
      { k: "pass_cmp", label: "Cmp", line: "tot", col: "pass_cmp", title: "Completions" },
      { k: "rush_yd", label: "Rush yds", line: "tot", col: "rush_yd", title: "Rushing yards" },
      { k: "rush_td", label: "Rush TD", line: "tot", col: "rush_td", title: "Rushing touchdowns" },
      { k: "rush_att", label: "Carries", line: "tot", col: "rush_att", title: "Carries" },
      { k: "rec", label: "Rec", line: "tot", col: "rec", title: "Receptions" },
      { k: "rec_yd", label: "Rec yds", line: "tot", col: "rec_yd", title: "Receiving yards" },
      { k: "rec_td", label: "Rec TD", line: "tot", col: "rec_td", title: "Receiving touchdowns" },
      { k: "rec_tgt", label: "Targets", line: "tot", col: "rec_tgt", title: "Targets" },
      { k: "skill_td", label: "TD", line: "tot", col: { rush_td: 1, rec_td: 1 }, title: "Rushing and receiving touchdowns" },
      { k: "scrim", label: "Scrim yds", line: "tot", col: { rush_yd: 1, rec_yd: 1 }, title: "Yards from scrimmage: rushing plus receiving" },
      { k: "tot_yd", label: "Total yds", line: "tot", col: { pass_yd: 1, rush_yd: 1, rec_yd: 1 }, title: "Passing, rushing and receiving yards" },
      { k: "fd", label: "1st downs", line: "tot", col: { pass_fd: 1, rush_fd: 1, rec_fd: 1 }, title: "First downs passing, rushing and receiving" },
      { k: "two", label: "2-pt", line: "tot", col: { pass_2pt: 1, rush_2pt: 1, rec_2pt: 1 }, title: "Two-point conversions" },
      { k: "fum_lost", label: "Fum lost", line: "tot", col: "fum_lost", low: true, title: "Fumbles lost (lower is better)" },
      { k: "fgm", label: "FGM", line: "tot", col: "fgm", title: "Field goals made" },
      { k: "fg50", label: "FG 50+", line: "tot", col: "fgm_50p", title: "Field goals of 50 yards or more" },
      { k: "xpm", label: "XPM", line: "tot", col: "xpm", title: "Extra points made" },
      { k: "def_sack", label: "Sacks", line: "tot", col: "def_sack", title: "Defensive sacks" },
      { k: "def_int", label: "Def INT", line: "tot", col: "def_int", title: "Interceptions caught" },
      { k: "takeaways", label: "Takeaways", line: "tot", col: { def_int: 1, fum_rec: 1 }, title: "Interceptions plus fumble recoveries" },
      { k: "def_td", label: "Def TD", line: "tot", col: { def_td: 1, def_st_td: 1 }, title: "Defensive and special teams touchdowns" },
      { k: "pts_allow", label: "Pts allowed", line: "tot", col: "pts_allow", low: true, title: "Points allowed (lower is better)" },
      { k: "yds_allow", label: "Yds allowed", line: "tot", col: "yds_allow", low: true, title: "Yards allowed (lower is better)" },
      { k: "cmp_pct", label: "Cmp%", line: "tot", num: "pass_cmp", den: "pass_att", fmt: pct1, unit: 0.48, adv: true, title: "Completion percentage" },
      { k: "ypa", label: "Y/A", line: "tot", num: "pass_yd", den: "pass_att", fmt: f1, unit: 8, adv: true, title: "Yards per pass attempt" },
      { k: "aya", label: "AY/A", line: "tot", num: { pass_yd: 1, pass_td: 20, pass_int: -45 }, den: "pass_att", fmt: f1, unit: 10, adv: true, title: "Adjusted yards per attempt: a touchdown is worth 20 yards, an interception costs 45" },
      { k: "td_pct", label: "TD%", line: "tot", num: "pass_td", den: "pass_att", fmt: pct1, unit: 0.2, adv: true, title: "Touchdown passes per attempt" },
      { k: "int_pct", label: "INT%", line: "tot", num: "pass_int", den: "pass_att", low: true, fmt: pct1, unit: 0.15, adv: true, title: "Interceptions per attempt (lower is better)" },
      { k: "ypc", label: "Y/C", line: "tot", num: "rush_yd", den: "rush_att", fmt: f1, unit: 6, adv: true, title: "Yards per carry" },
      { k: "catch", label: "Catch%", line: "tot", num: "rec", den: "rec_tgt", fmt: pct1, unit: 0.47, adv: true, title: "Catch rate: catches per target" },
      { k: "ypt", label: "Y/Tgt", line: "tot", num: "rec_yd", den: "rec_tgt", fmt: f1, unit: 9, adv: true, title: "Yards per target" },
      { k: "ypr", label: "Y/R", line: "tot", num: "rec_yd", den: "rec", fmt: f1, unit: 9, adv: true, title: "Yards per reception" },
      { k: "ypto", label: "Yds/touch", line: "tot", num: { rush_yd: 1, rec_yd: 1 }, den: { rush_att: 1, rec: 1 }, fmt: f1, unit: 7, adv: true, title: "Scrimmage yards per carry or catch" },
      { k: "fg_pct", label: "FG%", line: "tot", num: "fgm", den: "fga", fmt: pct1, unit: 0.35, adv: true, title: "Field goal percentage" },
      // nflverse's play-by-play stats: they come in overnight, so a game's EPA counts the next morning, not live
      { k: "epa", label: "EPA", line: "tot", col: { epa_pass: 1, epa_rush: 1, epa_rec: 1 }, fmt: f1, adv: true, title: "Expected points added, passing, rushing and receiving: how much each play moved his team's scoring odds (counts the morning after a game)" },
      { k: "epa_pass", label: "Pass EPA", line: "tot", col: "epa_pass", fmt: f1, adv: true, title: "Expected points added on dropbacks, sacks included (counts the morning after a game)" },
      { k: "epa_rush", label: "Rush EPA", line: "tot", col: "epa_rush", fmt: f1, adv: true, title: "Expected points added on carries (counts the morning after a game)" },
      { k: "epa_rec", label: "Rec EPA", line: "tot", col: "epa_rec", fmt: f1, adv: true, title: "Expected points added on targets (counts the morning after a game)" },
      { k: "epa_play", label: "EPA/play", line: "tot", num: { epa_pass: 1, epa_rush: 1, epa_rec: 1 }, den: { pass_att: 1, pass_sacked: 1, rush_att: 1, rec_tgt: 1 }, fmt: f2, unit: 0.25, adv: true, title: "Expected points added per dropback, carry or target (counts the morning after a game)" },
      { k: "epa_db", label: "EPA/dropback", line: "tot", num: "epa_pass", den: { pass_att: 1, pass_sacked: 1 }, fmt: f2, unit: 0.25, adv: true, title: "Passing EPA per dropback, sacks included (counts the morning after a game)" },
      { k: "epa_car", label: "EPA/carry", line: "tot", num: "epa_rush", den: "rush_att", fmt: f2, unit: 0.2, adv: true, title: "Rushing EPA per carry (counts the morning after a game)" },
      { k: "epa_tgt", label: "EPA/target", line: "tot", num: "epa_rec", den: "rec_tgt", fmt: f2, unit: 0.35, adv: true, title: "Receiving EPA per target (counts the morning after a game)" },
      { k: "cpoe", label: "CPOE", line: "tot", num: "cpoe_x", den: "pass_att", mult: 100, fmt: f1, unit: 6, adv: true, title: "Completion percentage over expected: completions beyond what the throws' difficulty predicts, per 100 attempts (counts the morning after a game)" },
      { k: "anya", label: "ANY/A", line: "tot", num: { pass_yd: 1, pass_td: 20, pass_int: -45, sack_yd: -1 }, den: { pass_att: 1, pass_sacked: 1 }, fmt: f1, unit: 9, adv: true, title: "Adjusted net yards per attempt: AY/A with sacks and sack yards taken off (sacks count the morning after a game)" },
      { k: "sack_pct", label: "Sack%", line: "tot", num: "pass_sacked", den: { pass_att: 1, pass_sacked: 1 }, low: true, fmt: pct1, unit: 0.08, adv: true, title: "Sacks per dropback (lower is better; counts the morning after a game)" },
      { k: "tgt_share", label: "Tgt share", line: "tot", num: "rec_tgt", den: "tm_tgt", fmt: pct1, unit: 0.25, adv: true, title: "Target share: his share of his team's targets in the games he played (counts the morning after a game)" },
      { k: "air_share", label: "Air yds share", line: "tot", num: "air_rec", den: "tm_air", fmt: pct1, unit: 0.35, adv: true, title: "His share of his team's air yards in the games he played (counts the morning after a game)" },
      { k: "adot", label: "aDOT", line: "tot", num: "air_rec", den: "rec_tgt", fmt: f1, unit: 10, adv: true, title: "Average depth of target: how far downfield his targets were thrown (counts the morning after a game)" },
      { k: "yac_r", label: "YAC/rec", line: "tot", num: "yac_rec", den: "rec", fmt: f1, unit: 6, adv: true, title: "Yards after the catch per reception (counts the morning after a game)" },
      { k: "racr", label: "RACR", line: "tot", num: "rec_yd", den: "air_rec", fmt: f2, unit: 1, adv: true, title: "Receiver air conversion ratio: receiving yards per air yard targeted (counts the morning after a game)" },
      { k: "air_yd", label: "Air yds", line: "tot", col: "air_rec", adv: true, title: "Receiving air yards: how far downfield all his targets went (counts the morning after a game)" },
      { k: "yac", label: "YAC", line: "tot", col: "yac_rec", adv: true, title: "Yards after the catch (counts the morning after a game)" },
    ],
    mlb: [
      { k: "obp", label: "OBP", line: "bat", rate: "obp", w: "pa", fmt: r3 },
      { k: "slg", label: "SLG", line: "bat", num: "tb", den: "ab", fmt: r3, unit: 0.6, title: "Slugging percentage" },
      { k: "xbh", label: "XBH", line: "bat", col: { "2b": 1, "3b": 1, hr: 1 }, title: "Extra-base hits" },
      { k: "2b", label: "2B", line: "bat", col: "2b", title: "Doubles" },
      { k: "3b", label: "3B", line: "bat", col: "3b", title: "Triples" },
      { k: "bb", label: "BB", line: "bat", col: "bb", title: "Walks" },
      { k: "so", label: "K (bat)", line: "bat", col: "so", low: true, title: "Batter strikeouts (lower is better)" },
      { k: "hbp", label: "HBP", line: "bat", col: "hbp", title: "Hit by pitch" },
      { k: "cs", label: "CS", line: "bat", col: "cs", low: true, title: "Caught stealing (lower is better)" },
      { k: "nsb", label: "NSB", line: "bat", col: { sb: 1, cs: -1 }, title: "Net stolen bases: steals minus caught stealing" },
      { k: "rrbi", label: "R+RBI", line: "bat", col: { r: 1, rbi: 1 }, title: "Runs plus runs batted in" },
      { k: "iso", label: "ISO", line: "bat", num: { tb: 1, h: -1 }, den: "ab", fmt: r3, unit: 0.45, adv: true, title: "Isolated power: extra bases per at-bat" },
      { k: "woba", label: "wOBA", line: "bat", num: { bb: 0.689, ibb: -0.689, hbp: 0.72, h: 0.882, "2b": 0.372, "3b": 0.708, hr: 1.168 }, den: { ab: 1, bb: 1, ibb: -1, sf: 1, hbp: 1 }, fmt: r3, unit: 0.5, adv: true, title: "Weighted on-base average: each way of reaching base weighted by the runs it's worth" },
      { k: "bbp", label: "BB%", line: "bat", num: "bb", den: "pa", fmt: pct1, unit: 0.28, adv: true, title: "Walks per plate appearance" },
      { k: "kp", label: "K%", line: "bat", num: "so", den: "pa", low: true, fmt: pct1, unit: 0.42, adv: true, title: "Strikeouts per plate appearance (lower is better)" },
      { k: "bbk", label: "BB/K", line: "bat", num: "bb", den: "so", fmt: f2, unit: 1, adv: true, title: "Walks per strikeout" },
      { k: "babip", label: "BABIP", line: "bat", num: { h: 1, hr: -1 }, den: { ab: 1, so: -1, hr: -1, sf: 1 }, fmt: r3, unit: 0.46, adv: true, title: "Batting average on balls in play" },
      { k: "hrpa", label: "HR%", line: "bat", num: "hr", den: "pa", fmt: pct1, unit: 0.18, adv: true, title: "Home runs per plate appearance" },
      { k: "k9", label: "K/9", line: "pit", num: "k", den: "ip", mult: 9, fmt: f2, unit: 1, adv: true, title: "Strikeouts per nine innings" },
      { k: "bb9", label: "BB/9", line: "pit", num: "bb", den: "ip", mult: 9, low: true, fmt: f2, unit: 0.6, adv: true, title: "Walks per nine innings (lower is better)" },
      { k: "h9", label: "H/9", line: "pit", num: "h", den: "ip", mult: 9, low: true, fmt: f2, unit: 0.9, adv: true, title: "Hits per nine innings (lower is better)" },
      { k: "hr9", label: "HR/9", line: "pit", num: "hr", den: "ip", mult: 9, low: true, fmt: f2, unit: 0.45, adv: true, title: "Home runs per nine innings (lower is better)" },
      { k: "kbb", label: "K/BB", line: "pit", num: "k", den: "bb", fmt: f2, unit: 2, adv: true, title: "Strikeouts per walk" },
      { k: "kpp", label: "K% (pit)", line: "pit", num: "k", den: "bf", fmt: pct1, unit: 0.42, adv: true, title: "Strikeouts per batter faced" },
      { k: "bbpp", label: "BB% (pit)", line: "pit", num: "bb", den: "bf", low: true, fmt: pct1, unit: 0.28, adv: true, title: "Walks per batter faced (lower is better)" },
      { k: "kbbp", label: "K-BB%", line: "pit", num: { k: 1, bb: -1 }, den: "bf", fmt: pct1, unit: 0.45, adv: true, title: "Strikeouts minus walks, per batter faced" },
      { k: "fip", label: "FIP", line: "pit", num: { hr: 13, bb: 3, hbp: 3, k: -2 }, den: "ip", add: 3.1, low: true, fmt: f2, unit: 4, adv: true, title: "Fielding independent pitching: ERA from strikeouts, walks and home runs alone (lower is better)" },
      { k: "svh", label: "SV+HLD", line: "pit", col: { sv: 1, hld: 1 }, title: "Saves plus holds" },
      { k: "wqs", label: "W+QS", line: "pit", col: { w: 1, qs: 1 }, title: "Wins plus quality starts" },
      { k: "ip", label: "IP", line: "pit", col: "ip", fmt: f1, title: "Innings pitched" },
      { k: "gs", label: "GS", line: "pit", col: "gs", title: "Games started" },
      { k: "er", label: "ER", line: "pit", col: "er", low: true, title: "Earned runs (lower is better)" },
      { k: "hra", label: "HR allowed", line: "pit", col: "hr", low: true, title: "Home runs allowed (lower is better)" },
      { k: "bba", label: "BB allowed", line: "pit", col: "bb", low: true, title: "Walks allowed (lower is better)" },
    ],
    nhl: [
      { k: "pts", label: "PTS", line: "sk", col: "pts", title: "Points" },
      { k: "ppg", label: "PPG", line: "sk", col: "ppg", title: "Power-play goals" },
      { k: "ppa", label: "PPA", line: "sk", col: { ppp: 1, ppg: -1 }, title: "Power-play assists" },
      { k: "shp", label: "SHP", line: "sk", col: "shp", title: "Shorthanded points" },
      { k: "hb", label: "HIT+BLK", line: "sk", col: { hits: 1, blk: 1 }, title: "Hits plus blocked shots" },
      { k: "toi", label: "TOI", line: "sk", col: "min", fmt: f0, title: "Minutes on ice" },
      { k: "gp", label: "GP", line: "sk", col: "gp", title: "Games played" },
      { k: "shpct", label: "SH%", line: "sk", num: "g", den: "sog", fmt: pct1, unit: 0.3, adv: true, title: "Shooting percentage: goals per shot" },
      { k: "p60", label: "P/60", line: "sk", num: "pts", den: "min", mult: 60, fmt: f2, unit: 2, adv: true, title: "Points per 60 minutes" },
      { k: "g60", label: "G/60", line: "sk", num: "g", den: "min", mult: 60, fmt: f2, unit: 1.2, adv: true, title: "Goals per 60 minutes" },
      { k: "sog60", label: "SOG/60", line: "sk", num: "sog", den: "min", mult: 60, fmt: f1, unit: 3, adv: true, title: "Shots per 60 minutes" },
      { k: "ppshare", label: "PP share", line: "sk", num: "ppp", den: "pts", fmt: pct1, unit: 0.45, adv: true, title: "Share of his points on the power play" },
      { k: "tka", label: "TK", line: "sk", col: "tka", title: "Takeaways" },
      { k: "gva", label: "GV", line: "sk", col: "gva", low: true, title: "Giveaways (lower is better)" },
      { k: "fow", label: "FOW", line: "sk", col: "fow", title: "Faceoffs won" },
      { k: "sat", label: "SAT", line: "sk", col: "sat", title: "Shot attempts: on goal, missed and blocked" },
      { k: "tkgv", label: "TK-GV", line: "sk", col: { tka: 1, gva: -1 }, adv: true, title: "Takeaways minus giveaways: puck management" },
      { k: "fop", label: "FO%", line: "sk", num: "fow", den: { fow: 1, fol: 1 }, fmt: pct1, unit: 0.5, adv: true, title: "Faceoff percentage, weighted by faceoffs taken" },
      { k: "netfo", label: "FOW-FOL", line: "sk", col: { fow: 1, fol: -1 }, adv: true, title: "Faceoffs won minus faceoffs lost" },
      { k: "sat60", label: "SAT/60", line: "sk", num: "sat", den: "min", mult: 60, fmt: f1, unit: 6, adv: true, title: "Shot attempts per 60 minutes" },
      { k: "shacc", label: "Shot accuracy", line: "sk", num: "sog", den: "sat", fmt: pct1, unit: 0.5, adv: true, title: "Share of his shot attempts that reached the net" },
      { k: "saves", label: "SV", line: "goalie", col: "saves", title: "Saves" },
      { k: "gs", label: "GS", line: "goalie", col: "gs", title: "Goalie starts" },
      { k: "ga", label: "GA", line: "goalie", col: "ga", low: true, title: "Goals against (lower is better)" },
      { k: "gsaa", label: "GSAA", line: "goalie", col: { saves: 1, sa: -0.9 }, fmt: f1, adv: true, title: "Goals saved above average: saves beyond a .900 goalie on the same shots" },
    ],
  };
  // Ready-made custom category setups, one click in league setup: a starting point the league can still edit.
  const CAT_PRESETS = {
    nba: [
      { k: "eff", name: "Efficiency", blurb: "True shooting, ball security and plus/minus over raw volume", cats: ["ts", "pts", "reb", "ast", "stocks", "tpm", "ato", "tovr", "pm"] },
      { k: "p36", name: "Per 36", blurb: "Production per minute, so a bench scorer counts like a starter", cats: ["ppm", "rpm", "apm", "stocks36", "ts", "tpp", "ato", "tovr"] },
      { k: "plus", name: "9-cat plus", blurb: "The standard nine with double-doubles and triple-doubles", cats: ["fg", "ft", "tpm", "pts", "reb", "ast", "stl", "blk", "tov", "dd", "td"] },
    ],
    // college: the pro presets without plus/minus, which college box scores don't carry
    get cbb() { return this.nba.map((x) => Object.assign({}, x, { blurb: x.blurb.replace(" and plus/minus", ""), cats: x.cats.filter((k) => k !== "pm") })); },
    nfl: [
      { k: "epa", name: "Analytics", blurb: "EPA, CPOE, ANY/A and target share", cats: ["epa", "epa_play", "cpoe", "anya", "tgt_share", "ypto", "fd", "skill_td"] },
      { k: "eff", name: "Efficiency", blurb: "Rates only: no credit for volume alone", cats: ["anya", "cmp_pct", "td_pct", "int_pct", "ypc", "ypt", "catch", "ypto"] },
      { k: "vol", name: "Volume", blurb: "Touches, yards, first downs and touchdowns", cats: ["tot_yd", "fd", "rec", "rush_att", "rec_tgt", "skill_td", "pass_td", "two"] },
    ],
    mlb: [
      { k: "saber", name: "Sabermetrics", blurb: "wOBA, ISO and walk rate for hitters; FIP and K-BB% for pitchers", cats: ["woba", "iso", "bbp", "nsb", "rrbi", "fip", "kbbp", "whip", "svh", "ip"] },
      { k: "obp", name: "OBP and QS", blurb: "5x5 with on-base percentage, quality starts and saves plus holds", cats: ["r", "hr", "rbi", "sb", "obp", "k", "qs", "svh", "era", "whip"] },
      { k: "six", name: "6x6", blurb: "Adds slugging and K/BB, with net steals", cats: ["r", "hr", "rbi", "nsb", "obp", "slg", "k", "qs", "svh", "era", "whip", "kbb"] },
    ],
    nhl: [
      { k: "adv", name: "Analytics", blurb: "Scoring and shot attempts per 60, faceoff percentage and goals saved above average", cats: ["p60", "g60", "sat60", "ppp", "fop", "hb", "gsaa", "svp"] },
      { k: "bang", name: "Banger", blurb: "Hits, blocks and penalty minutes count as much as goals", cats: ["g", "a", "ppp", "sog", "hits", "blocks", "pim", "wins", "svp", "gaa"] },
      { k: "two", name: "Two-way", blurb: "Takeaways, faceoffs and plus/minus alongside the scoring", cats: ["g", "a", "pm", "ppp", "tkgv", "fow", "hb", "wins", "svp", "gaa"] },
    ],
  };
  // Every category a custom league can pick: the presets' and the extras. With data attached, only the ones its
  // columns can make.
  // Combos: two or more stats added together (PTS+REB+AST, R+RBI, HIT+BLK, scrimmage yards), a group of their own in
  // the pickers. A category is one when its name adds stats up, or it's one of football's yardage totals.
  const COMBO_KEYS = new Set(["scrim", "tot_yd"]);
  const isCombo = (c) => !c.adv && (/[A-Za-z]\+[A-Za-z]/.test(c.label) || COMBO_KEYS.has(c.k));
  function catCatalog(sport, o = {}) {
    const seen = new Map();
    for (const sc of Object.values(ALL[sport.key].scorings)) if (sc.type === "cats") for (const c of sc.cats) if (!seen.has(c.k)) seen.set(c.k, c);
    for (const c of EXTRA_CATS[sport.key] || []) if (!seen.has(c.k)) seen.set(c.k, c);
    for (const c of seen.values()) if (c.combo == null) c.combo = isCombo(c);
    return [...seen.values()].filter((c) => o.all || catOk(sport, c));
  }
  function customScoring(sport, spec) {
    const base = ALL[sport.key].scorings;
    if (spec.type === "points") {
      const pm = spec.posMult ? Object.fromEntries(Object.entries(spec.posMult).filter(([, x]) => Number.isFinite(+x) && +x > 0 && +x !== 1).map(([k, x]) => [k, +x])) : null;
      // game bonuses only where a scoring week is one game (football); a basketball or baseball week sums many games
      const bonus = spec.bonus && spec.bonus.length && BONUS_OK[sport.key] ? spec.bonus.filter((b) => b && b.stat && +b.at > 0 && +b.pts).map((b) => ({ stat: b.stat, at: +b.at, pts: +b.pts })) : null;
      const pos = spec.pos ? cleanPos(spec.pos) : null;
      const extra = { pos: pos && Object.keys(pos).length ? pos : null, bonus: bonus && bonus.length ? bonus : null, posMult: pm && Object.keys(pm).length ? pm : null };
      // a preset plus extras: the preset's own columns and projections, with the extras added on top
      if (spec.base && base[spec.base] && base[spec.base].type === "points") return Object.assign({}, base[spec.base], extra, { label: base[spec.base].label + extraLabel(spec), custom: true, base: spec.base });
      const pts = Object.values(base).find((x) => x.type === "points") || {};
      const hoops = sport.key === "nba" || sport.key === "cbb";
      const line = sport.key === "nfl" ? "tot" : hoops ? "pg" : sport.key === "nhl" ? "sk" : "bat";
      return { label: "Custom points", type: "points", line, per: hoops ? "game" : undefined, games: pts.games || (sport.key === "mlb" ? 162 : 17),
        weights: Object.assign({}, spec.weights), projScale: sport.key === "nfl" ? 1 : undefined, custom: true, ...extra, label: "Custom points" + extraLabel(spec) };
    }
    const cats = Object.values(base).find((x) => x.type === "cats") || ALL[sport.key].catsTemplate;
    // every category the league picked, even one this data file can't make yet (it scores once the columns arrive)
    const all = catCatalog(sport, { all: true });
    return Object.assign({}, cats, { label: "Custom categories", cats: (spec.cats || []).map((k) => all.find((c) => c.k === k)).filter(Boolean), custom: true });
  }
  // drop zeroes and junk from { pos: { stat: points } }
  function cleanPos(pos) {
    const out = {};
    for (const [ps, w] of Object.entries(pos || {})) {
      const keep = Object.fromEntries(Object.entries(w || {}).filter(([, v]) => Number.isFinite(+v) && +v !== 0).map(([k, v]) => [k, +v]));
      if (Object.keys(keep).length) out[ps] = keep;
    }
    return out;
  }
  /* Extras on top of any points scoring (scoring v2):
       spec.pos      { TE: { rec: 0.5 }, "*": { pass_td: 2 } }  extra points per stat for a position ("*" is everyone)
       spec.posMult  { TE: 1.5 }                                 a position's whole score times this (the other kind of
                                                                 TE premium); applied after everything else
       spec.bonus    [{ stat: "rush_yd", at: 100, pts: 3 }]      points for a game that reaches a mark. Rows stack, so
                                                                 100 and 200 yards make a tiered bonus. Football only.
     A week's box score is one game in football, so a bonus counts once a week; a season projection counts the games a
     player is likely to reach the mark in, from his average and a typical spread game to game. Position points and
     multipliers are linear, so they work on any sport's week totals. */
  const BONUS_OK = { nfl: true };
  const BONUS_NAMES = { rush_yd: "rushing", rec_yd: "receiving", pass_yd: "passing" };
  const statName = (sportKey, k) => { const hit = (POINT_STATS[sportKey] || []).find(([x]) => x === k || x.split(".").pop() === k); return hit ? hit[1] : k.replace(/^(bat|pit)\./, "").replace(/_/g, " "); };
  function extraLabel(spec) {
    const out = [];
    if (spec.pos && spec.pos.TE && spec.pos.TE.rec) out.push(`TE premium +${spec.pos.TE.rec}`);
    if (spec.posMult && +spec.posMult.TE > 0 && +spec.posMult.TE !== 1) out.push(`TE premium ${+spec.posMult.TE}x`);
    if (spec.pos && spec.pos["*"] && spec.pos["*"].pass_td) out.push(`${4 + spec.pos["*"].pass_td}-point passing TDs`);
    const others = Object.entries(spec.posMult || {}).filter(([k, x]) => k !== "TE" && +x > 0 && +x !== 1).length + Object.entries(spec.pos || {}).reduce((a, [ps, w]) => a + Object.entries(w || {}).filter(([k, v]) => +v && !(ps === "TE" && k === "rec") && !(ps === "*" && k === "pass_td")).length, 0);
    if (others) out.push(`${others} position rule${others > 1 ? "s" : ""}`);
    if (spec.bonus && spec.bonus.length) out.push(spec.bonus.every((x) => /_yd$/.test(x.stat || "")) ? "yardage bonuses" : "game bonuses");
    return out.length ? `, ${out.join(", ")}` : "";
  }
  // plain-English lines for a scoring's extras, for the league's Format card
  function bonusLines(sc, sportKey) {
    const out = [], sk = sportKey || (sc.line === "pg" ? "nba" : sc.line === "tot" ? "nfl" : "mlb");
    for (const [pos, w] of Object.entries(sc.pos || {})) for (const [k, v] of Object.entries(w)) if (v) out.push(pos === "TE" && k === "rec" ? `TE catches: +${v} each` : pos === "*" && k === "pass_td" ? `Passing TDs: ${4 + v} points` : `${pos === "*" ? "Everyone" : pos}, ${statName(sk, k).toLowerCase()}: ${v > 0 ? "+" : ""}${v} each`);
    for (const [pos, x] of Object.entries(sc.posMult || {})) out.push(`${pos} scores ${x}x`);
    for (const b of sc.bonus || []) out.push(BONUS_NAMES[b.stat] && b.stat.endsWith("_yd") ? `${b.at}-yard ${BONUS_NAMES[b.stat]} game: +${b.pts}` : `${b.at}+ ${statName(sk, b.stat).toLowerCase()} in a game: +${b.pts}`);
    return out;
  }
  // The extras for one player, given at(stat) for his line: per-stat position points, and bonuses either counted
  // (games == null: a single game, so the mark is reached or not) or expected over a season of `games`.
  const normCdf = (z) => 1 / (1 + Math.exp(-1.702 * z));
  // how much a stat swings game to game around its average m: yards about half their average, counts like a Poisson
  const gameSd = (stat, m) => (/_yd$/.test(stat) ? 0.55 * m + 8 : Math.sqrt(Math.max(m, 0.05)) * 1.1 + 0.3);
  function extraPts(sc, p, at, games) {
    if (!sc.pos && !sc.bonus) return 0;
    let x = 0;
    const main = positions(p)[0];
    for (const w of [sc.pos && sc.pos["*"], sc.pos && sc.pos[main]]) if (w) for (const [k, v] of Object.entries(w)) x += (at(k) || 0) * v;
    for (const b of sc.bonus || []) {
      const v = at(b.stat) || 0;
      if (games == null) { if (v >= b.at) x += b.pts; continue; }
      if (!games || v <= 0) continue;
      const m = v / games, sd = gameSd(b.stat, m);
      x += games * (1 - normCdf((b.at - m) / sd)) * b.pts;
    }
    return x;
  }
  // a position's multiplier (1 when none)
  const posMultOf = (sc, p) => (sc && sc.posMult && p ? sc.posMult[positions(p)[0]] || 1 : 1);
  // A player's points under a points scoring: the base (weights, or a preset's column), the extras, then the
  // position multiplier. Every place that scores points goes through here (values, week projections, box scores).
  function pointsOf(sc, p, at, games) {
    const base = sc.weights ? Object.entries(sc.weights).reduce((a, [k, w]) => a + (at(k) || 0) * w, 0) : at(sc.col) || 0;
    return (base + (p ? extraPts(sc, p, at, games) : 0)) * posMultOf(sc, p);
  }
  const withScoring = (sport, spec) => (spec && (spec.type === "points" || spec.type === "cats")
    ? Object.assign({}, sport, { scorings: Object.assign({}, sport.scorings, { custom: customScoring(sport, spec) }) }) : sport);

  /* ---------- next year's class, from the Big Board (draft/nba.json, draft/nfl.json) ---------- */
  // The prospects a fantasy league would draft (football: QB, RB, WR, TE; basketball: everyone), in consensus order,
  // each with his place in that fantasy class (fr, from 1). The board's score is his weighted average rank.
  const FANTASY_POS = { nfl: ["QB", "RB", "WR", "TE"] };
  function prospectClass(board, sportKey) {
    if (!board || !Array.isArray(board.players)) return [];
    const keep = FANTASY_POS[sportKey];
    return board.players.filter((p) => !keep || String(p.pos || "").split("/").some((x) => keep.includes(x)))
      .slice().sort((a, b) => (a.score || a.rank) - (b.score || b.rank))
      .map((p, i) => ({ id: p.id, n: p.n, pos: p.pos, school: p.school, rank: p.rank, fr: i + 1, score: p.score, hi: p.hi, lo: p.lo, on: p.on, hist: p.hist || [],
        yr: p.yr, age: p.age, ht: p.ht, wt: p.wt, stats: p.stats || null, year: board.year }));
  }

  /* ---------- prospects and the prospect rounds ---------- */
  /* A keeper or dynasty league can end its draft with prospect rounds (D.season.prospects = { rounds, rule }): picks
     from the prospect pool that go straight to the taxi squad. The pool rides along with the league as extra players
     (doc.extraPlayers, built here by prospectPlayers): baseball's from FanGraphs' board (data/prospects-mlb.json),
     football's and basketball's from the Big Board's next class (draft/<sport>.json).
       rule "strict": never played in the bigs (on the board and not in the league's player file)
       rule "loose":  rookie-eligible: anyone on the board, plus this season's rookies (p.rk)
     A prospect carries pro: 1, his rank on the board (prk), and for baseball FV, ETA and level. */
  const FG_TEAM = { WSN: "WSH", CHW: "CWS", KCR: "KC", SDP: "SD", SFG: "SF", TBR: "TB", AZ: "ARI", OAK: "ATH" };
  const FG_POS = { SP: ["SP"], RHP: ["SP"], LHP: ["SP"], SIRP: ["RP"], MIRP: ["RP"], RP: ["RP"], CF: ["OF"], LF: ["OF"], RF: ["OF"], OF: ["OF"], DH: ["UT"], TWP: ["UT", "SP"] };
  const NBA_POS = { G: ["PG", "SG"], F: ["SF", "PF"], "G-F": ["SG", "SF"], "F-C": ["PF", "C"] };
  function prospectPlayers(sportKey, src, limit = 250) {
    if (!src || !Array.isArray(src.players)) return [];
    if (sportKey === "mlb") {
      const rk = (x) => (Number.isFinite(x.rank) ? x.rank : 9999);
      return src.players.slice().sort((a, b) => rk(a) - rk(b) || (parseInt(b.fv) || 0) - (parseInt(a.fv) || 0)).slice(0, limit).map((x, i) => ({
        id: String(x.mlbam || `fg:${x.n}`), n: x.n, t: FG_TEAM[x.t] || x.t, pos: (FG_POS[x.pos] || [x.pos]).slice(), age: x.age ? Math.floor(x.age) : undefined,
        pro: 1, prk: i + 1, fv: x.fv, eta: x.eta, lv: x.lv, l: {}, rank: 5001 + i }));
    }
    return prospectClass(src, sportKey).slice(0, limit).map((x) => {
      const pos = String(x.pos || "").split("/").flatMap((ps) => (sportKey === "nba" ? NBA_POS[ps] || [ps] : [ps])).filter((ps) => (sportKey === "nfl" ? ["QB", "RB", "WR", "TE"] : nba.positions).includes(ps));
      return { id: `bb:${x.id}`, n: x.n, t: "", school: x.school, pos: [...new Set(pos.length ? pos : sportKey === "nba" ? ["SF"] : ["WR"])], age: x.age ? Math.floor(x.age) : undefined, pro: 1, prk: x.fr, l: {}, rank: 5000 + x.fr };
    });
  }
  // A league's extra players laid into its pool: new ones added, and a prospect who's already in the player file keeps
  // his lines and picks up his prospect marks (bigs: 1 when he has big-league time, not just a projection)
  function withExtras(players, doc) {
    const xs = doc && Array.isArray(doc.extraPlayers) ? doc.extraPlayers : null;
    if (!xs) return players;
    const by = new Map(players.map((p) => [p.id, p]));
    for (const x of xs) {
      const p = by.get(x.id);
      if (!p) { const q = Object.assign({ l: {}, rank: 9999 }, x); players.push(q); by.set(q.id, q); }
      // big-league time is a real stat line (a projection alone doesn't count)
      else if (x.pro) Object.assign(p, { pro: 1, bigs: p.l && ["bat", "pit", "tot", "pg"].some((k) => p.l[k]) ? 1 : 0, prk: x.prk, fv: x.fv, eta: x.eta, lv: x.lv });
    }
    return players;
  }
  // A new season's prospect pool: the current board (fresh), plus last season's extras who are still on a roster (a
  // prospect who fell off the board, or graduated, stays with his team). keep: the rostered ids.
  function refreshProspects(fresh, old, keep) {
    const have = new Set((fresh || []).map((p) => p.id)), held = keep instanceof Set ? keep : new Set(keep || []);
    return (fresh || []).concat((old || []).filter((x) => held.has(x.id) && !have.has(x.id)));
  }
  const prospectRule = (doc) => (doc && ((doc.settings && doc.settings.prospects) || (doc.season && doc.season.prospects) || doc.prospects)) || null;
  // whether a player counts as a prospect under a rule ("strict" or "loose")
  const isProspect = (rule, p) => !!p && (rule === "loose" ? !!(p.pro || p.rk) : !!(p.pro && !p.bigs));

  // Which sport is in season. Each runs on a month-day window (mmdd), wrapping the new year where needed:
  // regular season start to the end of the fantasy season. The default sport is the one whose fantasy season matters
  // most right now: football from August drafts until its fantasy playoffs end in early January, then basketball,
  // then baseball from its March drafts through July.
  const SEASONS = { nfl: [901, 107], nba: [1020, 415], mlb: [325, 928], nhl: [929, 415], cbb: [1101, 410] };
  const DEFAULT_SPORT = [[801, 107, "nfl"], [108, 314, "nba"], [315, 731, "mlb"]];
  const mmdd = (d) => (d.getMonth() + 1) * 100 + d.getDate();
  const within = (x, [a, b]) => (a <= b ? x >= a && x <= b : x >= a || x <= b);
  const seasonOn = (key, date) => !!SEASONS[key] && within(mmdd(date || new Date()), SEASONS[key]);
  // when this fantasy season ends: the next SEASONS end date after t, or null in the offseason (no cap then)
  function seasonEnd(key, t) {
    const se = SEASONS[key]; if (!se) return null;
    const now = new Date(t || Date.now());
    if (!within(mmdd(now), se)) return null;
    let end = new Date(now.getFullYear(), Math.floor(se[1] / 100) - 1, se[1] % 100, 23, 59);
    if (end.getTime() < now.getTime()) end = new Date(now.getFullYear() + 1, Math.floor(se[1] / 100) - 1, se[1] % 100, 23, 59);
    return end.getTime();
  }
  // college hoops' March: Selection Sunday is the Sunday from March 11 to 17, the regular season (before the
  // conference tournaments) ends a week before it, and the title game is the Monday three weeks after it. A league
  // that plays through the NCAA tournament runs to the Sunday after, so the title game is in its last week.
  const COLLEGE_ENDS = { reg: -7, conf: 0, ncaa: 28 };
  function collegeEnd(kind, t) {
    const now = new Date(t || Date.now()), y = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
    const sel = new Date(y, 2, 11, 23, 59); while (sel.getDay() !== 0) sel.setDate(sel.getDate() + 1);
    sel.setDate(sel.getDate() + (COLLEGE_ENDS[kind] != null ? COLLEGE_ENDS[kind] : 0));
    return sel.getTime();
  }
  const inSeason = (date) => { const x = mmdd(date || new Date()); return (DEFAULT_SPORT.find(([a, b]) => within(x, [a, b])) || [0, 0, "nfl"])[2]; };

  // Each pro team's main color, for its abbreviation next to a player's name. Colors only: no logos or marks.
  const TEAM_COLORS = {
    nhl: { ANA: "#F47A38", BOS: "#FFB81C", BUF: "#003087", CAR: "#CC0000", CBJ: "#002654", CGY: "#D2001C", CHI: "#CF0A2C", COL: "#6F263D", DAL: "#006847", DET: "#CE1126", EDM: "#041E42", FLA: "#C8102E", LAK: "#111111", MIN: "#154734", MTL: "#AF1E2D", NJD: "#CE1126", NSH: "#FFB81C", NYI: "#00539B", NYR: "#0038A8", OTT: "#C52032", PHI: "#F74902", PIT: "#FCB514", SEA: "#001628", SJS: "#006D75", STL: "#002F87", TBL: "#002868", TOR: "#003E7E", UTA: "#6CACE4", VAN: "#00205B", VGK: "#B4975A", WPG: "#041E42", WSH: "#C8102E" },
    nba: { ATL: "#E03A3E", BOS: "#007A33", BRK: "#000000", CHO: "#1D1160", CHI: "#CE1141", CLE: "#860038", DAL: "#00538C", DEN: "#0E2240", DET: "#C8102E", GSW: "#1D428A",
      HOU: "#CE1141", IND: "#002D62", LAC: "#C8102E", LAL: "#552583", MEM: "#5D76A9", MIA: "#98002E", MIL: "#00471B", MIN: "#0C2340", NOP: "#0C2340", NYK: "#006BB6",
      OKC: "#007AC1", ORL: "#0077C0", PHI: "#006BB6", PHO: "#1D1160", POR: "#E03A3E", SAC: "#5A2D81", SAS: "#000000", TOR: "#CE1141", UTA: "#002B5C", WAS: "#002B5C" },
    nfl: { ARI: "#97233F", ATL: "#A71930", BAL: "#241773", BUF: "#00338D", CAR: "#0085CA", CHI: "#0B162A", CIN: "#FB4F14", CLE: "#311D00", DAL: "#003594", DEN: "#FB4F14",
      DET: "#0076B6", GB: "#203731", HOU: "#03202F", IND: "#002C5F", JAX: "#006778", KC: "#E31837", LAC: "#0080C6", LAR: "#003594", LV: "#000000", MIA: "#008E97",
      MIN: "#4F2683", NE: "#002244", NO: "#D3BC8D", NYG: "#0B2265", NYJ: "#125740", PHI: "#004C54", PIT: "#FFB612", SEA: "#002244", SF: "#AA0000", TB: "#D50A0A",
      TEN: "#0C2340", WAS: "#5A1414" },
    mlb: { ARI: "#A71930", ATH: "#003831", ATL: "#CE1141", BAL: "#DF4601", BOS: "#BD3039", CHC: "#0E3386", CWS: "#27251F", CIN: "#C6011F", CLE: "#00385D", COL: "#333366",
      DET: "#0C2340", HOU: "#002D62", KC: "#004687", LAA: "#BA0021", LAD: "#005A9C", MIA: "#00A3E0", MIL: "#12284B", MIN: "#002B5C", NYM: "#002D72", NYY: "#0C2340",
      PHI: "#E81828", PIT: "#FDB827", SD: "#2F241D", SEA: "#0C2C56", SF: "#FD5A1E", STL: "#C41E3A", TB: "#092C5C", TEX: "#003278", TOR: "#134A8E", WSH: "#AB0003" },
  };
  // light team colors (gold, yellow) take dark text
  const inkOn = (hex) => { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#111" : "#fff"; };
  // Team logos from ESPN's image server, as on the Big Board: its code for each team where it differs from ours.
  const ESPN_CODES = { nba: { BRK: "bkn", CHO: "cha", PHO: "phx", GSW: "gs", NOP: "no", SAS: "sa", UTA: "utah", WAS: "wsh", NYK: "ny" },
    nfl: { WAS: "wsh" }, mlb: { CWS: "chw", ATH: "oak" } };
  const LOGOS = {};
  const teamLogo = (sportKey, abbr, px = 28) => LOGOS[sportKey] ? (LOGOS[sportKey][abbr] ? `https://a.espncdn.com/combiner/i?img=${LOGOS[sportKey][abbr].replace(/^https:\/\/a\.espncdn\.com/, "")}&w=${px}&h=${px}` : null) : (TEAM_COLORS[sportKey] && TEAM_COLORS[sportKey][abbr]
    ? `https://a.espncdn.com/combiner/i?img=/i/teamlogos/${sportKey}/500/${(ESPN_CODES[sportKey] || {})[abbr] || String(abbr).toLowerCase()}.png&w=${px}&h=${px}` : null);
  // A team's chip: its color, and whichever of white or near-black reads better on it. When neither reaches 4.5:1
  // (a mid blue like Carolina's), the color is darkened a little until white text does.
  const relLum = (n) => [n >> 16, (n >> 8) & 255, n & 255].map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
  const chipCache = {};
  function teamColor(sportKey, abbr) {
    const c = (TEAM_COLORS[sportKey] || {})[abbr];
    if (!c) return null;
    if (chipCache[c]) return chipCache[c];
    let n = parseInt(c.slice(1), 16);
    const onWhite = (m) => 1.05 / (relLum(m) + 0.05), onDark = (m) => (relLum(m) + 0.05) / (relLum(0x111111) + 0.05);
    if (onDark(n) >= 4.5 && onDark(n) >= onWhite(n)) return (chipCache[c] = { bg: c, ink: "#111" });
    for (let k = 0; k < 12 && onWhite(n) < 4.5; k++) n = [16, 8, 0].reduce((a, sh) => a | (Math.round(((n >> sh) & 255) * 0.92) << sh), 0);
    return (chipCache[c] = { bg: "#" + n.toString(16).padStart(6, "0"), ink: "#fff" });
  }

  // A league drawn from a few pro teams (a showdown's one game): doc is a draft (its season) or a league (its settings).
  /* A conference-only player pool (settings.poolOnly / D.season.poolOnly): AL or NL baseball, AFC or NFC football,
     East or West basketball. Only that half's players can be drafted or added. A rostered player traded to the other
     half stays on his roster but stops scoring (the AL-only rule), and a player traded in joins the free agents. */
  const POOL_SETS = {
    nhl: { East: ["BOS", "BUF", "CAR", "CBJ", "DET", "FLA", "MTL", "NJD", "NYI", "NYR", "OTT", "PHI", "PIT", "TBL", "TOR", "WSH"], West: ["ANA", "CGY", "CHI", "COL", "DAL", "EDM", "LAK", "MIN", "NSH", "SEA", "SJS", "STL", "UTA", "VAN", "VGK", "WPG"] },
    mlb: { AL: ["ATH", "BAL", "BOS", "CLE", "CWS", "DET", "HOU", "KC", "LAA", "MIN", "NYY", "SEA", "TB", "TEX", "TOR"], NL: ["ARI", "ATL", "CHC", "CIN", "COL", "LAD", "MIA", "MIL", "NYM", "PHI", "PIT", "SD", "SF", "STL", "WSH"] },
    nfl: { AFC: ["BAL", "BUF", "CIN", "CLE", "DEN", "HOU", "IND", "JAX", "KC", "LAC", "LV", "MIA", "NE", "NYJ", "PIT", "TEN"], NFC: ["ARI", "ATL", "CAR", "CHI", "DAL", "DET", "GB", "LAR", "MIN", "NO", "NYG", "PHI", "SEA", "SF", "TB", "WAS"] },
    nba: { East: ["ATL", "BOS", "BRK", "CHO", "CHI", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS"], West: ["DAL", "DEN", "GSW", "HOU", "LAC", "LAL", "MEM", "MIN", "NOP", "OKC", "PHO", "POR", "SAC", "SAS", "UTA"] },
  };
  const POOL_NAMES = { AL: "AL-only", NL: "NL-only", AFC: "AFC-only", NFC: "NFC-only", East: "East-only", West: "West-only" };
  const poolRuleOf = (doc) => (doc && ((doc.settings && doc.settings.poolOnly) || (doc.season && doc.season.poolOnly))) || null;
  const poolTeams = (sportKey, rule) => (rule && POOL_SETS[sportKey] && POOL_SETS[sportKey][rule]) || null;
  // a pool of chosen teams: one-day slates, and college leagues kept to chosen conferences (season.pool, settings.pool)
  const poolOf = (doc) => (doc && ((doc.settings && doc.settings.pool) || (doc.season && doc.season.pool) || (doc.season && doc.season.showdown && doc.season.showdown.teams) || (doc.season && doc.season.slate && doc.season.slate.teams))) || poolTeams(doc && doc.sport, poolRuleOf(doc)) || null;
  // everyone on a league's rosters (a player traded out of a conference-only pool keeps his spot)
  const rosteredSets = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  function rostered(doc, id) {
    if (!doc || !Array.isArray(doc.rosters)) return false;
    let hit = rosteredSets && rosteredSets.get(doc);
    const key = doc.rosters.map((r) => r.length).join(",");
    if (!hit || hit.key !== key) { hit = { key, set: new Set(doc.rosters.flat()) }; if (rosteredSets) rosteredSets.set(doc, hit); }
    return hit.set.has(id);
  }
  const inPool = (doc, p) => { const t = poolOf(doc); return !t || t.includes(p.t) || (!!poolRuleOf(doc) && rostered(doc, p.id)); };
  // a rostered player whose team is outside a conference-only pool: he doesn't score
  const outOfPool = (doc, p) => { const rule = poolRuleOf(doc), t = rule && poolTeams(doc.sport, rule); return !!(t && p && !t.includes(p.t)); };
  /* Baseball position eligibility. The feed works out each player's positions Yahoo's way (ELIG: a hitter qualifies at
     a position with 10 games or 5 starts there, a pitcher at SP with 3 starts and at RP with 5 relief appearances, from
     last season and, once it's under way, this one) and carries the counts behind them (p.pg: one { pos: [games,
     starts] } per season). A league with its own thresholds (settings.elig, the same shape as ELIG) recomputes them. */
  const ELIG = { g: 10, gs: 5, sp: 3, rp: 5 };
  const ELIG_PRESETS = { yahoo: ["10 games or 5 starts (Yahoo)", ELIG], espn: ["20 games (ESPN)", { g: 20, gs: 0, sp: 5, rp: 8 }], easy: ["5 games or 3 starts", { g: 5, gs: 3, sp: 2, rp: 3 }] };
  const ORDER = ["C", "1B", "2B", "3B", "SS", "OF", "UT", "SP", "RP"];
  function eligibleAt(p, t) {
    if (!p || !Array.isArray(p.pg)) return null;
    const ok = new Set(), hitter = p.l && p.l.bat, pitcher = p.l && p.l.pit;
    for (const season of p.pg) for (const [pos, [g, gs]] of Object.entries(season || {})) {
      if (pos === "SP" ? pitcher && t.sp && gs >= t.sp : pos === "RP" ? pitcher && t.rp && g >= t.rp : hitter && ((t.g && g >= t.g) || (t.gs && gs >= t.gs))) ok.add(pos);
    }
    const bats = [...ok].filter((x) => x !== "SP" && x !== "RP"), arms = [...ok].filter((x) => x === "SP" || x === "RP");
    // a hitter who qualifies nowhere keeps the feed's spot (UT for a DH); a pitcher short on both counts keeps his role
    const out = (hitter ? (bats.length ? bats : p.pos.filter((x) => x !== "SP" && x !== "RP")) : []).concat(pitcher ? (arms.length ? arms : p.pos.filter((x) => x === "SP" || x === "RP")) : []);
    return out.length ? out.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)) : null;
  }
  function applyElig(players, t) {
    if (!t || (t.g === ELIG.g && t.gs === ELIG.gs && t.sp === ELIG.sp && t.rp === ELIG.rp)) return players;
    for (const p of players) { const ps = eligibleAt(p, t); if (ps) p.pos = ps; }
    return players;
  }
  // A one-day game (basketball's day slates): the slate's day, from a league's settings or a draft's season, or null
  const dayOf = (doc) => { const sl = doc && ((doc.settings && doc.settings.slate) || (doc.season && doc.season.slate)); return (sl && sl.day) || null; };
  // A showdown: one game, a captain who scores half again, five spots that take anyone, no bench
  // The NFL week a one-week game or a showdown plays (doc: a league, with settings, or a draft, with season): its
  // slate's week, or for a showdown made before showdowns kept theirs, the week its game is in (New York time, so a
  // Monday night game is Monday's). null unless the data has a projection line for that week (lines "wk<N>").
  function weekFor(doc, sport) {
    const st = (doc && doc.settings) || {}, s = st.slate || st.showdown ? st : (doc && doc.season) || st;
    const L = (sport && sport.data && sport.data.lines) || {}, weeks = Object.values(L).filter((l) => l.week != null);
    let n = (s.slate && s.slate.week) || (s.showdown && s.showdown.week) || null;
    const at = s.showdown && s.showdown.at;
    if (n == null && at) {
      const d = new Date(typeof at === "number" ? at : Date.parse(at)).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const hit = weeks.find((l) => l.start <= d && d <= l.end);
      n = hit ? hit.week : null;
    }
    return n != null && weeks.some((l) => l.week === Number(n)) ? Number(n) : null;
  }
  const SHOWDOWN = { lineup: ["CPT", "UTIL", "UTIL", "UTIL", "UTIL", "UTIL"], bench: 0, mult: { CPT: 1.5 } };
  /* ---------- college conferences (football), for a league that limits starters from one ---------- */
  // Each FBS school's conference this season (2026). Independents (Notre Dame, UConn) and schools outside FBS have
  // none, and no limit.
  const CONF = {
    SEC: ["Alabama", "Arkansas", "Auburn", "Florida", "Georgia", "Kentucky", "LSU", "Ole Miss", "Mississippi State", "Missouri", "Oklahoma", "South Carolina", "Tennessee", "Texas", "Texas A&M", "Vanderbilt"],
    "Big Ten": ["Illinois", "Indiana", "Iowa", "Maryland", "Michigan", "Michigan State", "Minnesota", "Nebraska", "Northwestern", "Ohio State", "Oregon", "Penn State", "Purdue", "Rutgers", "UCLA", "USC", "Washington", "Wisconsin"],
    "Big 12": ["Arizona", "Arizona State", "Baylor", "BYU", "Cincinnati", "Colorado", "Houston", "Iowa State", "Kansas", "Kansas State", "Oklahoma State", "TCU", "Texas Tech", "UCF", "Utah", "West Virginia"],
    ACC: ["Boston College", "California", "Clemson", "Duke", "Florida State", "Georgia Tech", "Louisville", "Miami", "NC State", "North Carolina", "Pittsburgh", "SMU", "Stanford", "Syracuse", "Virginia", "Virginia Tech", "Wake Forest"],
    "Pac-12": ["Boise State", "Colorado State", "Fresno State", "Oregon State", "San Diego State", "Texas State", "Utah State", "Washington State"],
    American: ["Army", "Charlotte", "East Carolina", "Florida Atlantic", "Memphis", "Navy", "North Texas", "Rice", "Temple", "Tulane", "Tulsa", "UAB", "USF", "UTSA"],
    "Mountain West": ["Air Force", "Hawaii", "Nevada", "New Mexico", "San Jose State", "UNLV", "Wyoming", "UTEP", "Northern Illinois", "North Dakota State"],
    "Sun Belt": ["Appalachian State", "Arkansas State", "Coastal Carolina", "Georgia Southern", "Georgia State", "James Madison", "Louisiana", "Louisiana-Monroe", "Louisiana Tech", "Marshall", "Old Dominion", "South Alabama", "Southern Miss", "Troy"],
    "Conference USA": ["Delaware", "FIU", "Jacksonville State", "Kennesaw State", "Liberty", "Middle Tennessee", "Missouri State", "New Mexico State", "Sam Houston", "Western Kentucky"],
    MAC: ["Akron", "Ball State", "Bowling Green", "Buffalo", "Central Michigan", "Eastern Michigan", "Kent State", "Miami (OH)", "Ohio", "Sacramento State", "Toledo", "UMass", "Western Michigan"],
  };
  const P4 = ["SEC", "Big Ten", "Big 12", "ACC"];
  // other spellings the data uses
  const ALIAS = { "louisiana state": "lsu", "southern california": "usc", "southern cal": "usc", "brigham young": "byu", "texas christian": "tcu", "central florida": "ucf", "southern methodist": "smu", pitt: "pittsburgh",
    "north carolina state": "nc state", unc: "north carolina", "miami fl": "miami", "miami florida": "miami", cal: "california", "uc berkeley": "california", "texas a m": "texas a m", mississippi: "ole miss",
    "miami ohio": "miami oh", "south florida": "usf", "florida international": "fiu", "alabama birmingham": "uab", "texas san antonio": "utsa", "texas el paso": "utep", "nevada las vegas": "unlv",
    "louisiana lafayette": "louisiana", "louisiana monroe": "louisiana monroe", ulm: "louisiana monroe", "southern mississippi": "southern miss", massachusetts: "umass", "app state": "appalachian state",
    "middle tennessee state": "middle tennessee", "sam houston state": "sam houston", "bowling green state": "bowling green", "san jose state": "san jose state", "hawai i": "hawaii", "army west point": "army",
    "cal state sacramento": "sacramento state", "east carolina": "east carolina", "ecu": "east carolina", "fau": "florida atlantic", "jmu": "james madison" };
  function school(name) {
    let x = String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " ").replace(/\bst\.?(?=\s|$)/g, "state").replace(/\bcol\.?(?=\s|$)/g, "college")
      .replace(/^the |^university of |\buniversity\b/g, "").replace(/[().,'\u2019-]/g, " ").replace(/\s+/g, " ").trim();
    return ALIAS[x] != null ? ALIAS[x] : x;
  }
  const SCHOOL = {};
  for (const [c, list] of Object.entries(CONF)) for (const x of list) SCHOOL[school(x)] = c;
  const conference = (college) => SCHOOL[school(college)] || null;
  const confOf = (p) => (p && p.col ? conference(p.col) : null);
  const power4 = (c) => P4.includes(c);
  // a short label for a tag next to a player's name
  const confShort = (c) => ({ "Conference USA": "C-USA", "Mountain West": "MWC", American: "AAC" })[c] || c;

  return { collegeEnd, COLLEGE_ENDS, cbb, DAILY, daily, SEASON_SPORTS, lineVal, ratioVal, catCols, catOk, EXTRA_CATS, CAT_PRESETS, refreshProspects, prospectPlayers, withExtras, prospectRule, isProspect, POOL_SETS, POOL_NAMES, poolRuleOf, poolTeams, outOfPool, pointsOf, posMultOf, cleanPos, BONUS_OK, statName, ELIG, ELIG_PRESETS, eligibleAt, applyElig, conference, confOf, power4, confShort, ALL, nba, nfl, mlb, nhl, poolOf, inPool, dayOf, weekFor, SHOWDOWN, attach, TEAM_COLORS, teamColor, teamLogo, stat, positions, fits, isLate, fmt: { r3, f1, f2, f0, ip: fip, pct1 }, POINT_STATS, POINT_DEFAULTS, catCatalog, customScoring, withScoring, extraPts, bonusLines, inSeason, seasonOn, seasonEnd, prospectClass };
});
