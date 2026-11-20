/* Draft Lab: bring a league's settings in from Sleeper, ESPN or Yahoo. Each reader turns that site's settings into a
   patch for the Start a league form (the same fields the form reads back), plus notes on anything that didn't carry
   over exactly, so a commissioner can set up the same league here in a minute and see what to check.
   Sleeper: its public API (league + draft JSON). ESPN: a public league's mSettings view (any of the four sports).
   Yahoo: the text of the league's Settings page, copied and pasted (Yahoo's API needs each user's sign-in).
   No DOM, no network: callers fetch and pass the data in. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.FK = root.FK || {}).importer = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PLAYOFFS = [0, 2, 3, 4, 6, 8, 10, 12];
  const CLOCKS = [30, 45, 60, 90, 120, 180, 300, 600, 3600, 28800];
  const snapDown = (v, list) => list.filter((x) => x <= v).pop() ?? list[0];
  const snapNear = (v, list) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), list[0]);
  const num = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
  const result = (source) => ({ source, name: "", form: {}, notes: [], unmapped: [] });

  // ---------- lineups ----------
  // Each site's slot names to Draft Lab's (fantasy-kit/sports.js slots). A slot that has no exact match takes the
  // nearest one and says so; IR and bench are counted, not placed.
  const NEAR = { "REC_FLEX": ["FLEX", "WR/TE flex"], "WRRB_FLEX": ["FLEX", "RB/WR flex"], "W/R": ["FLEX", "RB/WR flex"], "W/T": ["FLEX", "WR/TE flex"],
    "RB/WR": ["FLEX", "RB/WR flex"], "WR/TE": ["FLEX", "WR/TE flex"], "LF": ["OF", "LF"], "CF": ["OF", "CF"], "RF": ["OF", "RF"], "DH": ["UTIL", "DH"],
    "IF": ["UTIL", "IF"], "SG/SF": ["UTIL", "SG/SF"], "G/F": ["UTIL", "G/F"], "PF/C": ["UTIL", "PF/C"], "F/C": ["UTIL", "F/C"], "Team QB": ["QB", "Team QB"],
    "DT": ["DL", "DT"], "DE": ["DL", "DE"], "CB": ["DB", "CB"], "S": ["DB", "S"], "EDGE": ["DL", "Edge"] };
  function lineupFrom(slots, sport, r) {
    const lineup = [];
    let bench = 0, ir = 0, taxi = 0;
    const near = {};
    for (let s of slots) {
      s = String(s).trim();
      const u = s.toUpperCase();
      if (["BN", "BE", "BENCH"].includes(u)) { bench++; continue; }
      if (["IR", "IL", "IL+", "IR+", "NA", "RESERVE"].includes(u)) { ir++; continue; }
      if (u === "TAXI") { taxi++; continue; }
      const map = { SUPER_FLEX: "SFLEX", "Q/W/R/T": "SFLEX", SUPERFLEX: "SFLEX", OP: "SFLEX", "W/R/T": "FLEX", "RB/WR/TE": "FLEX", UTIL: "UTIL", UT: "UTIL", "D/ST": "DEF", DST: "DEF", IDP_FLEX: "IDP", DP: "IDP", D: sport === "nhl" ? "D" : "DEF",
        "2B/SS": "MI", "1B/3B": "CI", W: sport === "nhl" ? "W" : "FLEX", P: "P" };
      let k = map[u] || map[s] || u;
      if (!sport || !sport.slots || !sport.slots[k]) {
        const n = NEAR[s] || NEAR[u];
        if (n && sport.slots[n[0]]) { near[n[1]] = (near[n[1]] || 0) + 1; k = n[0]; }
        else { r.unmapped.push(`${s} lineup spot`); continue; }
      }
      lineup.push(k);
    }
    for (const [what, n] of Object.entries(near)) r.notes.push(`${n > 1 ? n + " " : ""}${what} spot${n > 1 ? "s" : ""} became ${what.includes("flex") || what === "DH" || what === "IF" || what.includes("/") ? "the nearest flex spot here" : "the nearest position here"}`);
    return { lineup, bench, ir, taxi };
  }

  // ---------- Sleeper ----------
  // Sleeper's scoring keys to Draft Lab's point stats (football and basketball)
  const SLEEPER_NFL = { pass_yd: "pass_yd", pass_td: "pass_td", pass_int: "pass_int", pass_att: "pass_att", pass_cmp: "pass_cmp", pass_2pt: "pass_2pt", pass_fd: "pass_fd", pass_sack: "pass_sacked",
    rush_yd: "rush_yd", rush_td: "rush_td", rush_att: "rush_att", rush_2pt: "rush_2pt", rush_fd: "rush_fd", rec: "rec", rec_yd: "rec_yd", rec_td: "rec_td", rec_2pt: "rec_2pt", rec_fd: "rec_fd", rec_tgt: "rec_tgt",
    fum_lost: "fum_lost", fum: "fum", xpm: "xpm", xpmiss: "xpmiss", fga: "fga", def_td: "def_td", int: "def_int", sack: "def_sack", ff: "ff", fum_rec: "fum_rec", safe: "safe", def_st_td: "def_st_td",
    st_td: "def_st_td", kr_td: "def_st_td", pr_td: "def_st_td", st_fum_rec: "fum_rec", st_ff: "ff", def_st_fum_rec: "fum_rec", def_st_ff: "ff", fum_rec_td: "def_td", int_ret_td: "def_td",
    idp_tkl_solo: "idp_tkl_solo", idp_tkl_ast: "idp_tkl_ast", idp_sack: "idp_sack", idp_tkl_loss: "idp_tkl_loss", idp_qb_hit: "idp_qb_hit", idp_int: "idp_int", idp_ff: "idp_ff",
    idp_fum_rec: "idp_fum_rec", idp_pass_def: "idp_pass_def", idp_def_td: "idp_def_td", idp_safe: "idp_safe" };
  const SLEEPER_NBA = { pts: "pts", reb: "reb", ast: "ast", stl: "stl", blk: "blk", to: "tov", tov: "tov", tpm: "tpm", fg3m: "tpm", "3pm": "tpm", fgm: "fgm", fga: "fga", ftm: "ftm", fta: "fta",
    tpa: "tpa", fg3a: "tpa", oreb: "oreb", dreb: "dreb", pf: "pf", dd: "dd", td: "td", td3: "td", tf: "td" };
  // Sleeper's football bonuses that Draft Lab has as scoring extras
  const SLEEPER_EXTRAS = { bonus_rec_te: ["tepOn", "tepAmt", "TE premium"], bonus_rush_yd_100: ["b100rOn", "b100rAmt", "100-yard rushing bonus"],
    bonus_rec_yd_100: ["b100cOn", "b100cAmt", "100-yard receiving bonus"], bonus_pass_yd_300: ["b300pOn", "b300pAmt", "300-yard passing bonus"] };

  function fromSleeper(lg, draft, sports) {
    const r = result("Sleeper");
    if (!lg || !lg.league_id) throw new Error("That doesn't look like a Sleeper league.");
    const key = { nfl: "nfl", nba: "nba" }[lg.sport];
    if (!key) throw new Error(`Draft Lab doesn't run ${String(lg.sport || "that sport").toUpperCase()} leagues yet.`);
    const sport = sports[key], st = lg.settings || {}, f = r.form;
    r.name = lg.name || "";
    f.sport = key; f.name = lg.name || ""; f.teams = num(lg.total_rosters) || num(st.num_teams) || 10;
    const lu = lineupFrom(lg.roster_positions || [], sport, r);
    if (lu.lineup.length) f.lineup = lu.lineup.join(" ");
    f.bench = lu.bench;
    if (num(st.reserve_slots) != null || lu.ir) f.ir = num(st.reserve_slots) ?? lu.ir;
    f.kind = st.type === 2 ? "dynasty" : st.type === 1 ? "keeper" : "redraft";
    if (st.type === 1 && num(st.max_keepers)) f.keepN = num(st.max_keepers);
    if (num(st.taxi_slots) != null && st.type === 2) f.taxi = num(st.taxi_slots);
    if (num(st.playoff_teams) != null) { const p = snapDown(num(st.playoff_teams), PLAYOFFS.filter((x) => x <= f.teams)); f.playoffs = p; if (p !== num(st.playoff_teams)) r.notes.push(`${st.playoff_teams} playoff teams became ${p}`); }
    if (num(st.playoff_week_start) > 1) f.weeks = num(st.playoff_week_start) - 1;
    if (num(st.trade_deadline) != null) f.deadline = st.trade_deadline >= 99 || !st.trade_deadline ? 0 : Math.min(num(st.trade_deadline), (f.weeks || 14) - 1);
    if (st.waiver_type === 2 || num(st.waiver_budget) > 0) { f.waivers = "faab"; if (num(st.waiver_budget) != null) f.faab = num(st.waiver_budget); }
    else { f.waivers = "rolling"; f.waiverOrder = st.waiver_type === 1 ? "standings" : "rolling"; }
    if (num(st.waiver_clear_days) != null) f.waiverDays = Math.max(1, Math.min(3, num(st.waiver_clear_days)));
    if (st.league_average_match) f.median = 1;
    if (num(st.divisions) > 1) f.divs = num(st.divisions);
    f.season = "h2h";
    // scoring: everything Sleeper weights that Draft Lab has, as custom points
    const map = key === "nfl" ? SLEEPER_NFL : SLEEPER_NBA, sc = lg.scoring_settings || {}, w = {};
    const kick = [["fgm_0_19", 0], ["fgm_20_29", 1], ["fgm_30_39", 2], ["fgm_40_49", 3], ["fgm_50p", 4], ["fgm_50_59", 4], ["fgm", 5]];
    for (const [k, v0] of Object.entries(sc)) {
      const v = num(v0);
      if (!v) continue;
      if (map[k]) { w[map[k]] = v; continue; }
      if (SLEEPER_EXTRAS[k]) { const [on, amt, label] = SLEEPER_EXTRAS[k]; f[on] = 1; f[amt] = v; continue; }
      if (kick.some(([x]) => x === k) || /^fgmiss|^pts_allow|^yds_allow/.test(k)) continue;
      r.unmapped.push(k.replace(/_/g, " "));
    }
    if (key === "nfl") {
      // kicking: one value per field goal (Sleeper's 30-39 yard value), and the 50+ value as a bonus on top
      const base = num(sc.fgm_30_39) ?? num(sc.fgm) ?? num(sc.fgm_40_49);
      if (base) w.fgm = base;
      const long = num(sc.fgm_50p) ?? num(sc.fgm_50_59);
      if (base && long && long > base) w.fgm_50p = long - base;
      if (Object.keys(sc).some((k) => /^fgm_(0_19|20_29|40_49)$/.test(k) && num(sc[k]) !== base)) r.notes.push("Field goals score one value by distance band here: kept the 30-39 yard value, with 50+ yards as a bonus");
      if (Object.keys(sc).some((k) => /^pts_allow|^yds_allow/.test(k))) r.notes.push("Team defense points-allowed tiers use Draft Lab's standard scale");
    }
    if (Object.keys(w).length) { f.scoring = "cp"; f.weights = w; }
    // the draft: type, auction budget, pick clock, rounds
    if (draft) {
      const t = String(draft.type || "").toLowerCase();
      if (t === "snake" || t === "linear" || t === "auction") f.type = t;
      const ds = draft.settings || {};
      if (t === "auction" && num(ds.budget)) f.aBudget = num(ds.budget);
      if (num(ds.pick_timer)) f.clock = snapNear(num(ds.pick_timer), CLOCKS);
      if (num(ds.reversal_round) > 0) r.notes.push(`Third-round reversal (round ${ds.reversal_round}) isn't carried over`);
    }
    r.unmapped = [...new Set(r.unmapped)];
    return r;
  }

  // ---------- ESPN ----------
  const ESPN_GAME = { nfl: "ffl", nba: "fba", mlb: "flb", nhl: "fhl" };
  const ESPN_SLOTS = {
    nfl: { 0: "QB", 1: "Team QB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 6: "TE", 7: "OP", 8: "DT", 9: "DE", 10: "LB", 11: "DL", 12: "CB", 13: "S", 14: "DB", 15: "DP", 16: "D/ST", 17: "K", 20: "BN", 21: "IR", 23: "FLEX", 24: "EDGE" },
    nba: { 0: "PG", 1: "SG", 2: "SF", 3: "PF", 4: "C", 5: "G", 6: "F", 7: "SG/SF", 8: "G/F", 9: "PF/C", 10: "F/C", 11: "UTIL", 12: "BN", 13: "IR" },
    mlb: { 0: "C", 1: "1B", 2: "2B", 3: "3B", 4: "SS", 5: "OF", 6: "2B/SS", 7: "1B/3B", 8: "LF", 9: "CF", 10: "RF", 11: "DH", 12: "UTIL", 13: "P", 14: "SP", 15: "RP", 16: "BN", 17: "IL", 19: "IF" },
    nhl: { 0: "C", 1: "LW", 2: "RW", 3: "F", 4: "D", 5: "G", 6: "UTIL", 7: "BN", 8: "IR" },
  };
  // ESPN stat ids Draft Lab can score (football and basketball; baseball and hockey come over as settings only)
  const ESPN_NFL = { 0: "pass_att", 1: "pass_cmp", 3: "pass_yd", 4: "pass_td", 19: "pass_2pt", 20: "pass_int", 23: "rush_att", 24: "rush_yd", 25: "rush_td", 26: "rush_2pt", 42: "rec_yd", 43: "rec_td",
    44: "rec_2pt", 53: "rec", 58: "rec_tgt", 64: "pass_sacked", 68: "fum", 72: "fum_lost", 83: "fgm", 86: "xpm", 88: "xpmiss", 94: "def_td", 95: "def_int", 96: "fum_rec", 98: "safe", 99: "def_sack",
    106: "ff", 101: "def_st_td", 102: "def_st_td", 103: "def_td", 104: "def_td", 63: "def_td", 93: "def_st_td", 107: "idp_tkl_ast", 108: "idp_tkl_solo", 113: "idp_pass_def" };
  const ESPN_NFL_LABEL = { 97: "Blocked kicks", 117: "D/ST tackles for loss", 119: "D/ST 3-and-outs", 113: "Passes defended", 114: "Kickoff return yards", 115: "Punt return yards", 127: "Yards allowed", 64: "Times sacked" };
  const ESPN_NBA = { 0: "pts", 1: "blk", 2: "stl", 3: "ast", 4: "oreb", 5: "dreb", 6: "reb", 11: "tov", 13: "fgm", 14: "fga", 15: "ftm", 16: "fta", 17: "tpm", 18: "tpa", 37: "dd", 38: "td", 40: "min" };
  const ESPN_NBA_CATS = { 0: "pts", 1: "blk", 2: "stl", 3: "ast", 4: "oreb", 5: "dreb", 6: "reb", 11: "tov", 13: "fgm", 15: "ftm", 17: "tpm", 18: "tpa", 19: "fg", 20: "ft", 21: "tpp", 37: "dd", 38: "td", 40: "min" };
  const ESPN_SEASON = { H2H_POINTS: "h2h", H2H_CATEGORY: "h2hcats", H2H_MOST_CATEGORIES: "h2h", ROTO: "roto", TOTAL_POINTS: "h2h" };

  function fromEspn(lg, key, sports) {
    const r = result("ESPN");
    const s = (lg && lg.settings) || null;
    if (!s) throw new Error("ESPN didn't send this league's settings.");
    const sport = sports[key], f = r.form;
    r.name = s.name || "";
    f.sport = key; f.name = s.name || ""; f.teams = num(s.size) || (lg.teams || []).length || 10;
    const counts = (s.rosterSettings && s.rosterSettings.lineupSlotCounts) || {}, names = ESPN_SLOTS[key], slots = [];
    for (const [id, n] of Object.entries(counts)) for (let i = 0; i < n; i++) if (names[id]) slots.push(names[id]); else if (n) r.unmapped.push(`ESPN lineup spot ${id}`);
    const lu = lineupFrom(slots, sport, r);
    // ESPN's counts have no order: put them in Draft Lab's (QB, RB, WR, TE, FLEX ... K, DEF)
    const keys = Object.keys(sport.slots);
    lu.lineup.sort((a, b) => keys.indexOf(a) - keys.indexOf(b));
    if (lu.lineup.length) f.lineup = lu.lineup.join(" ");
    f.bench = lu.bench; if (lu.ir) f.ir = lu.ir;
    const sc = s.scoringSettings || {}, sch = s.scheduleSettings || {}, dr = s.draftSettings || {}, ac = s.acquisitionSettings || {};
    f.season = ESPN_SEASON[sc.scoringType] || "h2h";
    if (sc.scoringType === "TOTAL_POINTS") r.notes.push("ESPN's total-points standings became head-to-head here");
    if (num(sch.matchupPeriodCount)) f.weeks = num(sch.matchupPeriodCount);
    if (num(sch.playoffTeamCount) != null) { const p = snapDown(num(sch.playoffTeamCount), PLAYOFFS.filter((x) => x <= f.teams)); f.playoffs = p; if (p !== num(sch.playoffTeamCount)) r.notes.push(`${sch.playoffTeamCount} playoff teams became ${p}`); }
    if (Array.isArray(sch.divisions) && sch.divisions.length > 1) f.divs = sch.divisions.length;
    if (sch.playoffMatchupPeriodLengthByRound && Object.values(sch.playoffMatchupPeriodLengthByRound).some((x) => x > 1)) r.notes.push("Two-week playoff rounds aren't carried over: playoff rounds here are one week each");
    const dt = String(dr.type || "").toUpperCase();
    if (dt === "AUCTION") { f.type = "auction"; if (num(dr.auctionBudget)) f.aBudget = num(dr.auctionBudget); } else if (dt === "SNAKE") f.type = "snake";
    if (num(dr.timePerSelection)) f.clock = snapNear(num(dr.timePerSelection), CLOCKS);
    if (num(dr.keeperCount) > 0) { f.kind = "keeper"; f.keepN = num(dr.keeperCount); } else f.kind = "redraft";
    if (ac.isUsingAcquisitionBudget || num(ac.acquisitionBudget) > 0) { f.waivers = "faab"; if (num(ac.acquisitionBudget)) f.faab = num(ac.acquisitionBudget); } else f.waivers = "rolling";
    if (num(ac.waiverHours)) f.waiverDays = Math.max(1, Math.min(3, Math.round(num(ac.waiverHours) / 24)));
    if (s.tradeSettings && num(s.tradeSettings.deadlineDate) > 0) r.notes.push("Set the trade deadline: ESPN's is a date, Draft Lab's is a week");
    const items = sc.scoringItems || [];
    if (key === "nfl" || key === "nba") {
      const cats = f.season !== "h2h" || (sc.scoringType || "").includes("CATEGORY") || sc.scoringType === "ROTO";
      if (key === "nba" && cats) {
        const out = [];
        for (const it of items) { const c = ESPN_NBA_CATS[it.statId]; if (c) out.push(c); else r.unmapped.push(`ESPN stat ${it.statId}`); }
        if (out.length >= 2) { f.scoring = "cc"; f.cats = [...new Set(out)]; }
      } else {
        const map = key === "nfl" ? ESPN_NFL : ESPN_NBA, w = {}, add = (k, v) => { w[k] = +((w[k] || 0) + v).toFixed(4); };
        // a stat's value: its points, or (team defense, slot 16) the override ESPN keeps for that slot
        const val = (it) => num(it.points) || (it.pointsOverrides ? num(it.pointsOverrides["16"]) : 0) || 0;
        const fgBand = {}, missBand = {};
        for (const it of items) {
          const v = val(it);
          if (!v) continue;
          const id = it.statId, k = map[id];
          if (key === "nfl") {
            // incompletions (attempts minus completions) and missed kicks (tries minus makes) become those stats
            if (id === 2) { add("pass_att", v); add("pass_cmp", -v); continue; }
            if ([80, 77, 74, 201, 198].includes(id)) { fgBand[id] = v; continue; }
            if ([82, 79, 85, 76, 73].includes(id)) { missBand[id] = v; continue; }
            // 100-yard and 300-yard game bonuses
            if (id === 37) { f.b100rOn = 1; f.b100rAmt = v; continue; }
            if (id === 56) { f.b100cOn = 1; f.b100cAmt = v; continue; }
            if (id === 17) { f.b300pOn = 1; f.b300pAmt = v; continue; }
            if ([38, 57, 18].includes(id)) { r.notes.push(`ESPN's ${id === 38 ? "200-yard rushing" : id === 57 ? "200-yard receiving" : "400-yard passing"} bonus isn't carried over (the 100/300-yard one is)`); continue; }
            if ((id >= 89 && id <= 92) || (id >= 120 && id <= 136)) continue;   // points/yards-allowed tiers
          }
          // several ESPN stats can land on one of ours (kick and punt return TDs are both special teams TDs): each is
          // one event, so the first value stands rather than adding up
          if (k) { if (w[k] == null) w[k] = v; continue; }
          r.unmapped.push(ESPN_NFL_LABEL[id] || `ESPN stat ${id}`);
        }
        if (key === "nfl") {
          // field goals: the shortest band's value per make, the 50+ value as a bonus on top; misses the same way
          const base = fgBand[80] ?? fgBand[77] ?? fgBand[74];
          if (base) { add("fgm", base); const long = fgBand[74] ?? fgBand[201] ?? fgBand[198]; if (long && long > base) w.fgm_50p = +(long - base).toFixed(2); }
          if (Object.keys(fgBand).length > 1) r.notes.push(`Field goals: kept ${base} per make${w.fgm_50p ? ` and a ${w.fgm_50p}-point 50+ bonus` : ""}; ESPN's other distance bands (${Object.entries(fgBand).map(([i, v]) => `${{ 80: "under 40", 77: "40-49", 74: "50+", 201: "60+", 198: "50-59" }[i] || i}: ${v}`).join(", ")}) aren't separate here`);
          const miss = missBand[82] ?? missBand[85] ?? missBand[79];
          if (miss) { add("fga", miss); add("fgm", -miss); if (Object.keys(missBand).length > 1) r.notes.push(`Missed field goals: kept ${miss} for every miss`); }
          if (items.some((it) => (it.statId >= 89 && it.statId <= 92) || (it.statId >= 120 && it.statId <= 136))) r.notes.push("Team defense points- and yards-allowed tiers use Draft Lab's standard scale");
        }
        if (items.some((it) => it.pointsOverrides && Object.keys(it.pointsOverrides).some((slot) => slot !== "16" && num(it.pointsOverrides[slot]) !== num(it.points)))) r.notes.push("Position-specific point values (like a TE premium) need setting by hand under scoring");
        if (Object.keys(w).length) { f.scoring = "cp"; f.weights = w; }
      }
    } else r.notes.push(`${key.toUpperCase()} scoring didn't carry over: pick the categories or points under scoring`);
    r.unmapped = [...new Set(r.unmapped)];
    return r;
  }

  // ---------- Yahoo (pasted Settings page) ----------
  const YAHOO_NBA_CATS = { "FG%": "fg", "FT%": "ft", "3PTM": "tpm", "3PM": "tpm", PTS: "pts", REB: "reb", AST: "ast", ST: "stl", STL: "stl", BLK: "blk", TO: "tov", OREB: "oreb", DREB: "dreb", "3PT%": "tpp", DD: "dd", TD: "td", FTM: "ftm", FGM: "fgm", "A/T": "ato", PF: "pf" };
  const YAHOO_MLB_CATS = { R: "r", HR: "hr", RBI: "rbi", SB: "sb", AVG: "avg", OBP: "obp", SLG: "slg", OPS: "ops", H: "h", TB: "tb", "2B": "2b", "3B": "3b", BB: "bb", NSB: "nsb", W: "w", SV: "sv", K: "k", ERA: "era", WHIP: "whip", HLD: "hld", QS: "qs", L: "l", "SV+H": "svh", "K/9": "k9", IP: "ip" };
  const YAHOO_NHL_CATS = { G: "g", A: "a", "+/-": "pm", PIM: "pim", PPP: "ppp", SOG: "sog", W: "wins", GAA: "gaa", "SV%": "svp", SHO: "so", HIT: "hits", BLK: "blocks", P: "pts", PPG: "ppg", SHP: "shp", FW: "fow", SV: "saves", GA: "ga" };
  const YAHOO_NFL_PTS = [[/^passing yards/i, "pass_yd"], [/^passing touchdowns/i, "pass_td"], [/^interceptions?$/i, "pass_int"], [/^rushing yards/i, "rush_yd"], [/^rushing touchdowns/i, "rush_td"],
    [/^receptions/i, "rec"], [/^receiving yards/i, "rec_yd"], [/^receiving touchdowns/i, "rec_td"], [/^return touchdowns/i, "def_st_td"], [/^2-point conversions/i, "rec_2pt"], [/^fumbles lost/i, "fum_lost"],
    [/^offensive fumble return td/i, null], [/^field goals? (made )?(0-19|20-29|30-39)/i, "fgm"], [/^point after attempt made|^pat made/i, "xpm"], [/^sack/i, "def_sack"], [/^interception$/i, "def_int"],
    [/^fumble recovery/i, "fum_rec"], [/^touchdown$/i, "def_td"], [/^safety/i, "safe"], [/^kickoff and punt return touchdowns/i, "def_st_td"]];
  const YAHOO_NBA_PTS = [[/^points scored/i, "pts"], [/^total rebounds/i, "reb"], [/^assists/i, "ast"], [/^steals/i, "stl"], [/^blocked shots/i, "blk"], [/^turnovers/i, "tov"], [/^3-point shots made/i, "tpm"],
    [/^field goals made/i, "fgm"], [/^field goals attempted/i, "fga"], [/^free throws made/i, "ftm"], [/^free throws attempted/i, "fta"], [/^double-doubles/i, "dd"], [/^triple-doubles/i, "td"], [/^offensive rebounds/i, "oreb"], [/^defensive rebounds/i, "dreb"]];

  function fromYahooText(text, sports) {
    const r = result("Yahoo"), f = r.form;
    const lines = String(text || "").split(/\r?\n/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (lines.length < 3) throw new Error("Paste the whole Settings page from your Yahoo league.");
    // a label and its value: "Label: value" on one line, or a label line followed by its value line
    const get = (re) => { for (let i = 0; i < lines.length; i++) { const m = lines[i].match(new RegExp("^(?:" + re.source + ")\\s*:?\\s*(.*)$", "i")); if (m) return (m[m.length - 1] || lines[i + 1] || "").trim(); } return ""; };
    const name = get(/League Name/);
    r.name = name; if (name) f.name = name;
    const roster = get(/Roster Positions/);
    const pos = roster.split(/,\s*/).map((x) => x.trim()).filter(Boolean);
    const has = (x) => pos.some((p) => p.toUpperCase() === x);
    const key = has("QB") ? "nfl" : has("PG") || has("SG") ? "nba" : has("1B") || has("SP") ? "mlb" : has("LW") || has("RW") ? "nhl" : "";
    if (!key) throw new Error("Couldn't find the Roster Positions line. Copy the whole Settings page (Ctrl+A, then Ctrl+C) and paste it here.");
    const sport = sports[key];
    f.sport = key;
    const teams = num((get(/Max Teams|Number of Teams/).match(/\d+/) || [])[0]);
    if (teams) f.teams = teams;
    const lu = lineupFrom(pos.map((p) => (p === "Util" ? "UTIL" : p)), sport, r);
    if (lu.lineup.length) f.lineup = lu.lineup.join(" ");
    f.bench = lu.bench; if (lu.ir) f.ir = lu.ir;
    const stype = get(/Scoring Type/).toLowerCase();
    f.season = /roto/.test(stype) ? "roto" : /categories/.test(stype) ? "h2hcats" : "h2h";
    const draft = get(/Draft Type/).toLowerCase();
    if (/auction/.test(draft)) { f.type = "auction"; const b = num((get(/Draft Budget|Salary Cap|Auction Budget/).match(/\d+/) || [])[0]); if (b) f.aBudget = b; } else if (draft) f.type = "snake";
    const wt = get(/Waiver Type/).toLowerCase();
    if (/fab|faab/.test(wt)) { f.waivers = "faab"; const b = num((get(/FAB Balance|FAAB Budget|Waiver Budget/).match(/\d+/) || [])[0]); if (b) f.faab = b; }
    else if (wt) { f.waivers = "rolling"; f.waiverOrder = /reverse|standings/.test(wt) ? "standings" : "rolling"; }
    const wdays = num((get(/Waiver Time/).match(/\d+/) || [])[0]); if (wdays) f.waiverDays = Math.max(1, Math.min(3, wdays));
    const po = get(/Playoffs/); const pt = num((po.match(/\((\d+) teams?\)/i) || po.match(/(\d+) teams/i) || [])[1]);
    if (pt != null) f.playoffs = snapDown(pt, PLAYOFFS.filter((x) => x <= (f.teams || 12)));
    const wk = num((po.match(/week (\d+)/i) || [])[1]); if (wk > 1) f.weeks = wk - 1;
    const keep = num((get(/Keepers?|Max Keepers/).match(/\d+/) || [])[0]); f.kind = keep ? "keeper" : "redraft"; if (keep) f.keepN = keep;
    if (get(/Trade End Date|Trade Deadline/)) r.notes.push("Set the trade deadline: Yahoo's is a date, Draft Lab's is a week");
    // scoring: categories from the Stat Categories line, points from Stat Modifiers
    const cats = get(/Stat Categories/);
    const catMap = key === "nba" ? YAHOO_NBA_CATS : key === "mlb" ? YAHOO_MLB_CATS : key === "nhl" ? YAHOO_NHL_CATS : null;
    if (catMap && cats && f.season !== "h2h" || (catMap && cats && /categor/.test(stype))) {
      const out = [];
      for (const m of cats.matchAll(/\(([^)]+)\)/g)) { const k = catMap[m[1].trim().toUpperCase()] || catMap[m[1].trim()]; if (k) out.push(k); else r.unmapped.push(m[1]); }
      if (out.length >= 2) { f.scoring = "cc"; f.cats = [...new Set(out)]; }
    } else {
      const rules = key === "nfl" ? YAHOO_NFL_PTS : key === "nba" ? YAHOO_NBA_PTS : null, w = {};
      if (rules) {
        const start = lines.findIndex((x) => /^stat modifiers/i.test(x));
        for (const l of start >= 0 ? lines.slice(start + 1) : lines) {
          const m = l.match(/^([A-Za-z0-9 \-+()/']+?)\s*:?\s*(-?\d+(?:\.\d+)?)\s*(?:points?)?(?:\s*\(?(\d+(?:\.\d+)?) yards? per point\)?)?$/i);
          if (!m) continue;
          const hit = rules.find(([re]) => re.test(m[1].trim()));
          if (!hit || !hit[1]) continue;
          const yardsPer = num(m[3]);
          w[hit[1]] = yardsPer ? +(1 / yardsPer).toFixed(4) : num(m[2]);
        }
        // "Passing Yards: 25 yards per point" style
        for (const l of lines) { const m = l.match(/^(passing|rushing|receiving) yards\s*:?\s*(\d+) yards? per point/i); if (m) w[m[1].toLowerCase().slice(0, 4) === "pass" ? "pass_yd" : m[1].toLowerCase().startsWith("rush") ? "rush_yd" : "rec_yd"] = +(1 / +m[2]).toFixed(4); }
        if (Object.keys(w).length) { f.scoring = "cp"; f.weights = w; }
        else r.notes.push("Couldn't read the point values: check scoring by hand");
      } else if (!catMap || !cats) r.notes.push("Couldn't read the scoring: check it by hand");
    }
    r.unmapped = [...new Set(r.unmapped)];
    return r;
  }

  // ---------- what was pasted ----------
  // A link or ID: which site, the league id, and (ESPN) the sport and season
  function parseInput(s) {
    const t = String(s || "").trim();
    if (!t) return null;
    let m = t.match(/sleeper\.(?:app|com)\/leagues?\/(\d{6,})/i) || t.match(/^(\d{15,})$/);
    if (m) return { source: "sleeper", id: m[1] };
    m = t.match(/fantasy\.espn\.com\/(football|basketball|baseball|hockey)\/[^?]*\?(.*)/i);
    if (m) {
      const q = new URLSearchParams(m[2]);
      const id = q.get("leagueId");
      if (id) return { source: "espn", id, sport: { football: "nfl", basketball: "nba", baseball: "mlb", hockey: "nhl" }[m[1].toLowerCase()], season: num(q.get("seasonId")) };
    }
    if (/^\d{4,12}$/.test(t)) return { source: "espn", id: t };
    if (/yahoo\.com/i.test(t) && t.length < 200) return { source: "yahoo-link" };
    if (t.split(/\n/).length > 3) return { source: "yahoo", text: t };
    return null;
  }

  // the season an ESPN league uses for a sport today (basketball and hockey seasons are named for the year they end)
  function espnSeason(key, now) {
    const d = new Date(now || Date.now()), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    if (key === "nba" || key === "nhl") return m >= 9 ? y + 1 : y;
    if (key === "nfl") return m <= 2 ? y - 1 : y;
    return m <= 1 ? y - 1 : y;
  }

  return { fromSleeper, fromEspn, fromYahooText, parseInput, espnSeason, ESPN_GAME, lineupFrom };
});
