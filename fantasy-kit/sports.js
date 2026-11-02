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
  const f2 = (v) => (v == null ? "-" : v.toFixed(2));
  const f0 = (v) => (v == null ? "-" : String(Math.round(v)));

  // Reads a stat. Each sport carries its data's column lists after FK.sports.attach(sport, data).
  function stat(sport, p, line, col) {
    const l = p && p.l && p.l[line];
    if (!l) return null;
    const i = sport.cols[line] ? sport.cols[line][col] : -1;
    return i == null || i < 0 ? null : l[i];
  }

  /* ---------- basketball ---------- */
  const nba = {
    key: "nba", name: "Basketball", league: "NBA", unit: "game",
    positions: ["PG", "SG", "SF", "PF", "C"],
    colors: { PG: 1, SG: 2, SF: 3, PF: 4, C: 5 },
    slots: { PG: ["PG"], SG: ["SG"], G: ["PG", "SG"], SF: ["SF"], PF: ["PF"], F: ["SF", "PF"], C: ["C"], UTIL: "*", BN: "*" },
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

  /* ---------- football ---------- */
  const nfl = {
    key: "nfl", name: "Football", league: "NFL", unit: "game",
    positions: ["QB", "RB", "WR", "TE", "K", "DEF"],
    colors: { QB: 5, RB: 3, WR: 1, TE: 4, K: 6, DEF: 2 },
    slots: { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], FLEX: ["RB", "WR", "TE"], SFLEX: ["QB", "RB", "WR", "TE"], K: ["K"], DEF: ["DEF"], BN: "*" },
    lineup: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"],
    bench: 6,
    posMax: { QB: 3, RB: 7, WR: 7, TE: 3, K: 1, DEF: 1 },
    late: ["K", "DEF"],
    sample: { line: "tot", col: "g", k: 3 },
    scorings: {
      half: { label: "Half PPR", type: "points", line: "tot", col: "pts_half_ppr", proj: 1, games: 17 },
      ppr: { label: "PPR", type: "points", line: "tot", col: "pts_ppr", proj: 2, games: 17 },
      std: { label: "Standard", type: "points", line: "tot", col: "pts_std", proj: 0, games: 17 },
    },
    columns: [
      { line: "tot", col: "g", label: "G", fmt: f0 },
      { fpts: true, label: "FPTS", fmt: f1, title: "Fantasy points this season" },
      { fpg: true, label: "FP/G", fmt: f1, title: "Fantasy points per game" },
      { line: "tot", col: "pass_yd", label: "PaYd", fmt: f0, hide: "s" },
      { line: "tot", col: "pass_td", label: "PaTD", fmt: f0, hide: "s" },
      { line: "tot", col: "pass_int", label: "Int", fmt: f0, hide: "s" },
      { line: "tot", col: "rush_yd", label: "RuYd", fmt: f0, hide: "s" },
      { line: "tot", col: "rush_td", label: "RuTD", fmt: f0, hide: "s" },
      { line: "tot", col: "rec", label: "Rec", fmt: f0, hide: "s" },
      { line: "tot", col: "rec_yd", label: "ReYd", fmt: f0, hide: "s" },
      { line: "tot", col: "rec_td", label: "ReTD", fmt: f0, hide: "s" },
    ],
  };

  /* ---------- baseball ---------- */
  const HIT = ["C", "1B", "2B", "3B", "SS", "OF", "UT"];
  // Z-scores measure against players a league would roster: regulars, starters and closers.
  const mlbBase = (sport, p, line) => (line === "bat" ? (stat(sport, p, "bat", "pa") || 0) >= 400
    : (stat(sport, p, "pit", "ip") || 0) >= 110 || (stat(sport, p, "pit", "sv") || 0) >= 12);
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
        label: "8x8 (R H HR RBI SB TB AVG OPS / W L SV K HLD ERA WHIP QS)", type: "cats",
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
      { line: "pit", col: "ip", label: "IP", fmt: f1, group: "pit", hide: "s" },
      { line: "pit", col: "w", label: "W", fmt: f0, group: "pit" },
      { line: "pit", col: "sv", label: "SV", fmt: f0, group: "pit" },
      { line: "pit", col: "k", label: "K", fmt: f0, group: "pit" },
      { line: "pit", col: "era", label: "ERA", fmt: f2, group: "pit" },
      { line: "pit", col: "whip", label: "WHIP", fmt: f2, group: "pit", hide: "s" },
    ],
  };

  const ALL = { nba, nfl, mlb };

  // Links a sport to the columns of its data file, so stat() can read the compact arrays.
  function attach(sport, data) {
    sport.cols = {};
    for (const [line, def] of Object.entries(data.lines || {})) sport.cols[line] = Object.fromEntries(def.cols.map((c, i) => [c, i]));
    sport.data = { season: data.season, updated: data.updated, source: data.source, lines: data.lines };
    sport.hasAge = (data.players || []).some((p) => p.age);
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

  return { ALL, nba, nfl, mlb, attach, stat, positions, fits, isLate, fmt: { r3, f1, f2, f0 } };
});
