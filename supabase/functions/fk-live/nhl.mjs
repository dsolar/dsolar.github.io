// NHL box scores use the same columns in the daily import and the live relay.
// Keep additive counts, then rebuild goalie ratios from saves/shots and goals/minutes.
// takeaways, giveaways, faceoffs won and lost and shot attempts on the end (faceoffs and missed or blocked shots come
// from the play-by-play, so a box read without it counts them 0)
export const SK_COLS = ["gp", "g", "a", "pts", "pm", "pim", "ppp", "ppg", "shp", "sog", "hits", "blk", "min", "tka", "gva", "fow", "fol", "sat"];
export const GOALIE_COLS = ["gp", "gs", "w", "l", "otl", "saves", "sa", "ga", "so", "min", "gaa", "svp"];
export const NHL_LINES = { sk: SK_COLS, goalie: GOALIE_COLS };
const minutes = (s) => { const [m, sec] = String(s || "0:00").split(":").map(Number); return (m || 0) + (sec || 0) / 60; };
const value = (v) => typeof v === "object" && v ? v.default : v;
export const gameState = (g) => g.gameScheduleState === "PPD" || ["PPD", "CNCL"].includes(g.gameState) ? "off" : ["OFF", "FINAL"].includes(g.gameState) ? "post" : ["LIVE", "CRIT"].includes(g.gameState) ? "in" : "pre";

export function goalieRates(row) {
  const x = row.slice(), ix = (k) => GOALIE_COLS.indexOf(k), min = x[ix("min")] || 0, sa = x[ix("sa")] || 0;
  x[ix("gaa")] = min ? (x[ix("ga")] || 0) * 60 / min : 0;
  x[ix("svp")] = sa ? (x[ix("saves")] || 0) / sa : 0;
  return x;
}
export function mergeLines(into, from) {
  for (const [id, lines] of Object.entries(from || {})) {
    const a = (into[id] ||= {});
    // a game kept before the columns grew is shorter: the longer line sets the length, missing parts count 0
    for (const key of Object.keys(NHL_LINES)) if (lines[key]) { const b = a[key] || []; a[key] = Array.from({ length: Math.max(b.length, lines[key].length) }, (_, i) => (lines[key][i] || 0) + (b[i] || 0)); }
  }
  return into;
}
export function finishLines(lines) {
  return Object.fromEntries(Object.entries(lines).map(([id, x]) => [id, { ...x, ...(x.goalie ? { goalie: goalieRates(x.goalie) } : {}) }]));
}

// The box score has PP goals, but not PP assists. The goal summary supplies both
// assists and strength; shootout goals never become skater goals or goalie GA.
// Faceoffs won and lost and shots that missed or were blocked, by player, from the play-by-play (not the shootout).
export function playCounts(pbp) {
  const out = {}, add = (id, k) => { if (id == null) return; const r = (out[String(id)] ||= { fow: 0, fol: 0, miss: 0 }); r[k]++; };
  for (const p of pbp?.plays || []) {
    if (p.periodDescriptor?.periodType === "SO") continue;
    const d = p.details || {};
    if (p.typeDescKey === "faceoff") { add(d.winningPlayerId, "fow"); add(d.losingPlayerId, "fol"); }
    else if (p.typeDescKey === "missed-shot" || p.typeDescKey === "blocked-shot") add(d.shootingPlayerId, "miss");
  }
  return out;
}
export function boxLines(box, landing, pbp) {
  if (!box?.playerByGameStats) throw new Error("NHL box score has no player stats");
  if (!Array.isArray(landing?.summary?.scoring)) throw new Error("NHL scoring summary is missing");
  const out = {}, special = {}, nonSO = {};
  for (const period of landing.summary.scoring) {
    if (period.periodDescriptor?.periodType === "SO") continue;
    for (const g of period.goals || []) {
      const team = value(g.teamAbbrev); nonSO[team] = (nonSO[team] || 0) + 1;
      const strength = String(g.strength || "").toLowerCase();
      const key = strength === "pp" ? "ppp" : strength === "sh" ? "shp" : null;
      if (!key) continue;
      for (const id of [g.playerId, ...(g.assists || []).map((a) => a.playerId)]) if (id != null) {
        const r = (special[String(id)] ||= { ppp: 0, shp: 0 }); r[key]++;
      }
    }
  }
  const final = gameState(box) === "post", plays = playCounts(pbp);
  for (const [side, other] of [["awayTeam", "homeTeam"], ["homeTeam", "awayTeam"]]) {
    const stats = box.playerByGameStats[side] || {};
    for (const p of [...(stats.forwards || []), ...(stats.defense || stats.defensemen || [])]) {
      const min = minutes(p.toi);
      if (!min && !p.goals && !p.assists && !p.sog) continue;
      const id = String(p.playerId), sp = special[id] || {}, pc = plays[id] || {};
      out[id] = { sk: [1, p.goals || 0, p.assists || 0, p.points ?? ((p.goals || 0) + (p.assists || 0)), p.plusMinus || 0, p.pim || 0,
        sp.ppp || 0, p.powerPlayGoals || 0, sp.shp || 0, p.sog || 0, p.hits || 0, p.blockedShots || 0, min,
        p.takeaways || 0, p.giveaways || 0, pc.fow || 0, pc.fol || 0, (p.sog || 0) + (pc.miss || 0)] };
    }
    const played = (stats.goalies || []).filter((p) => minutes(p.toi) > 0 || p.shotsAgainst > 0);
    const opponent = box[other]?.abbrev;
    for (const p of played) {
      const min = minutes(p.toi), ga = p.goalsAgainst || 0, sa = p.shotsAgainst || 0;
      const saves = p.saves ?? Math.max(0, sa - ga), win = final && p.decision === "W" ? 1 : 0;
      const loss = final && p.decision === "L" ? 1 : 0, ot = box.periodDescriptor?.periodType !== "REG";
      // Shared shutouts and an empty-net goal against do not earn an individual SO.
      const so = final && played.length === 1 && ga === 0 && !(nonSO[opponent] || 0) ? 1 : 0;
      out[String(p.playerId)] = { goalie: goalieRates([1, p.starter ? 1 : 0, win, loss && !ot ? 1 : 0, loss && ot ? 1 : 0, saves, sa, ga, so, min, 0, 0]) };
    }
  }
  return out;
}
