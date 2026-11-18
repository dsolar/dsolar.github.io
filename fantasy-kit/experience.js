/* Shared entry, rule templates and recommendations. No DOM, storage or network. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.FK = root.FK || {}).experience = api;
})(this, function () {
  "use strict";
  const RULE_FIELDS = ("sport teams type clock aBudget season weeks trades scoring lineup bench playoffs deadline review faab waiverDays gameLock weights cats waivers ir maxAdds posMax keepers keeperCost legs cons median bestball divs rookie fpicks taxi ohold tep ptd b100r b100c b300p reviewHours vetoShare waiverOrder minBid waiverPrice maxAddsSeason dealOn dealMax ladOn ladSeed ladReach splitAfter pyrOn pyrTeams pyrMode pyrK pyrTop pyrBot capBudget capBonus hcOn hcScale confOn reseed confs cbbEnd cfbEnd tvOn pyoOn robinOn robinP conqOn conqP conqLike crownOn crownStep crownKeep hangOn tbOn tbAmt reveal kind rlOn rlRound respins hzOn hzShields hzSteals hzJinxes hzClock keepN tepOn tepAmt b100rOn b100rAmt b100cOn b100cAmt b300pOn b300pAmt vampOn vampWho poolOnly proRounds proRule nhlDaily minGoalieGames chaseOn chaseWeeks elSteals elFreeze elTax elGold sx slKind slWeek slOne slGames").split(" ");
  RULE_FIELDS.push("slPeriod");
  const BAD = new Set(["__proto__", "constructor", "prototype"]);
  function safe(value, depth = 0) {
    if (depth > 5) return undefined;
    if (value == null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= 1e7 ? value : undefined;
    if (typeof value === "string") return value.slice(0, 500);
    if (Array.isArray(value)) return value.slice(0, 100).map((x) => safe(x, depth + 1)).filter((x) => x !== undefined);
    if (typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 120).filter(([k]) => !BAD.has(k)).map(([k, v]) => [k, safe(v, depth + 1)]).filter(([, v]) => v !== undefined));
  }
  function rulesOf(form) {
    return Object.fromEntries(RULE_FIELDS.filter((k) => Object.hasOwn(form, k)).map((k) => [k, safe(form[k])]).filter(([, v]) => v !== undefined));
  }
  const encode = (form) => JSON.stringify({ v: 1, rules: rulesOf(form) });
  function decode(text, S) {
    if (typeof text !== "string" || text.length > 20000) throw new Error("That rule template is too large.");
    let doc;
    try { doc = JSON.parse(text); } catch (e) { throw new Error("That rule template could not be read."); }
    if (!doc || doc.v !== 1 || !doc.rules || Array.isArray(doc.rules) || !S.ALL[doc.rules.sport]) throw new Error("That rule template uses an unsupported sport or version.");
    const r = rulesOf(doc.rules), sp = S.ALL[r.sport];
    if (r.slPeriod != null && (typeof r.slPeriod !== "string" || !/^(day:\d{4}-\d{2}-\d{2}|week:([1-9]|1[0-8]))$/.test(r.slPeriod))) throw new Error("That game window could not be read.");
    if (r.teams != null && (!Number.isInteger(r.teams) || r.teams < 2 || r.teams > 20)) throw new Error("A template needs between 2 and 20 teams.");
    if (r.lineup != null && (typeof r.lineup !== "string" || r.lineup.split(/[\s,]+/).filter(Boolean).some((k) => !sp.slots[k] || k === "BN"))) throw new Error("That template has an invalid roster slot.");
    for (const k of ["cats", "confs"]) if (r[k] != null && (!Array.isArray(r[k]) || r[k].some((x) => typeof x !== "string"))) throw new Error("That template has an invalid category or conference list.");
    for (const k of ["weights", "posMax", "sx"]) if (r[k] != null && (typeof r[k] !== "object" || Array.isArray(r[k]))) throw new Error("That template has invalid scoring or roster settings.");
    if (r.sx && (!Array.isArray(r.sx.pos) || !Array.isArray(r.sx.bonus) || !r.sx.mult || typeof r.sx.mult !== "object" || Array.isArray(r.sx.mult) || r.sx.pos.concat(r.sx.bonus).some((row) => !Array.isArray(row) || row.length !== 3))) throw new Error("That template has invalid scoring extras.");
    for (const k of ["weights", "posMax"]) if (r[k] && Object.values(r[k]).some((v) => typeof v !== "number" || !Number.isFinite(v))) throw new Error("Scoring weights and roster limits must be numbers.");
    if (r.scoring && !sp.scorings[r.scoring] && !["cp", "cc"].includes(r.scoring)) throw new Error("That scoring system is not available for this sport.");
    if (r.kind && !["redraft", "keeper", "dynasty", "week"].includes(r.kind)) throw new Error("That league type is not available.");
    if (r.type && !["snake", "linear", "3rr", "auction", "mystery", "elephant", "pack", "sealed", "cap"].includes(r.type)) throw new Error("That draft format is not available.");
    return r;
  }
  function applyQuery(form, params, S) {
    const notes = [];
    if (params.get("rules")) Object.assign(form, decode(params.get("rules"), S), { customize: true });
    const sp = S.ALL[form.sport];
    if (params.has("scoring")) {
      if (sp.scorings[params.get("scoring")]) form.scoring = params.get("scoring");
      else notes.push("That scoring preset is unavailable for this sport. Review the selected scoring.");
    }
    if (params.has("catset")) {
      const p = ((S.CAT_PRESETS || {})[form.sport] || []).find((x) => x.k === params.get("catset"));
      if (p) { form.scoring = "cc"; form.cats = p.cats.slice(); form.customize = true; }
      else notes.push("That category preset is unavailable. Review the selected categories.");
    }
    return notes;
  }
  function rankingConfig(S, key, cfg) {
    const c = cfg && cfg.sport === key ? cfg : {}, sp = S.ALL[key];
    return { teams: Number.isInteger(c.teams) && c.teams >= 2 && c.teams <= 20 ? c.teams : 10, budget: c.budget > 0 ? c.budget : 200,
      lineup: c.lineup ? c.lineup.split(/[\s,]+/).filter((x) => sp.slots[x] && x !== "BN") : sp.lineup.slice(), bench: c.bench == null ? sp.bench : c.bench,
      scoring: sp.scorings[c.scoring] ? c.scoring : Object.keys(sp.scorings)[0] };
  }
  const mockConflict = (sport, mock) => !!(sport && mock && mock.D && mock.D.sport !== sport);

  // Only rules cross this boundary. Names, rosters, invites, account data and completed scores never do.
  function fromDraft(D, settings) {
    const s = Object.assign({}, D.season || {}, settings || {}), spec = D.scoringSpec;
    const r = { sport: D.sport, teams: D.teams.length, type: D.cap ? "cap" : D.sealed ? "sealed" : D.type, clock: D.bidClock || D.clock || 90,
      scoring: D.scoring, lineup: (D.lineup || s.lineup || []).join(" "), bench: D.bench, kind: s.oneWeek ? "week" : s.dynasty ? "dynasty" : s.keepers > 0 ? "keeper" : "redraft",
      season: s.format === "h2h" || !s.format ? s.tally === "cats" ? "h2hcats" : s.tally === "allplay" ? "allplay" : "h2h" : s.format,
      weeks: s.weeks, bestball: s.bestBall ? 1 : 0, playoffs: s.playoffTeams, review: s.tradeReview || s.review, trades: s.trades === false ? 0 : 1,
      waiverDays: s.waiverDays != null ? s.waiverDays : s.waiverHours != null ? s.waiverHours / 24 : undefined, keepN: s.keepers, nhlDaily: s.daily, minGoalieGames: s.minGoalieGames,
      legs: s.playoffLegs, cons: s.consolation, divs: s.divisions, taxi: s.taxi, cbbEnd: s.collegeEnd, cfbEnd: s.collegeEnd };
    for (const k of ["ir", "maxAdds", "maxAddsSeason", "posMax", "faab", "waivers", "deadline", "gameLock", "reviewHours", "vetoShare", "waiverOrder", "minBid", "waiverPrice", "median", "confs", "poolOnly"]) if (s[k] != null) r[k] = s[k];
    if (spec) {
      r.scoring = spec.type === "cats" ? "cc" : spec.base || "cp";
      if (spec.cats) r.cats = spec.cats.slice(); if (spec.weights) r.weights = spec.weights;
      r.sx = { pos: Object.entries(spec.pos || {}).flatMap(([pos, weights]) => Object.entries(weights).map(([stat, points]) => [pos, stat, points])), mult: spec.posMult || {}, bonus: (spec.bonus || []).map((b) => [b.stat, b.at, b.pts]) };
    }
    if (D.auction) { r.aBudget = D.auction.budget; r.clock = D.auction.bidClock; }
    if (D.cap) { r.capBudget = D.cap.budget; r.capBonus = D.cap.bonus ? 1 : 0; }
    if (D.steals) Object.assign(r, { elSteals: D.steals.perTeam, elFreeze: D.steals.freeze, elTax: Math.round(D.steals.tax * 100), elGold: Math.round(D.steals.golden * 100) });
    if (D.roulette) Object.assign(r, { rlOn: 1, rlRound: D.roulette.each === "round" ? 1 : 0, respins: D.roulette.respins });
    if (D.trivia) r.tvOn = 1;
    if (s.dynasty) { r.rookie = s.dynasty.rounds; r.fpicks = s.dynasty.picks === false ? 0 : 1; }
    if (s.robin) Object.assign(r, { robinOn: 1, robinP: s.robin.protect });
    if (s.conquest) Object.assign(r, { conqOn: 1, conqP: s.conquest.protect, conqLike: s.conquest.like ? 1 : 0 });
    if (s.crown) Object.assign(r, { crownOn: 1, crownStep: s.crown.step, crownKeep: s.crown.keep });
    if (s.hangover) r.hangOn = 1; if (s.pyo) r.pyoOn = 1;
    if (s.topBonus) Object.assign(r, { tbOn: 1, tbAmt: s.topBonus });
    if (s.ladder) Object.assign(r, { ladOn: 1, ladSeed: s.ladder.seed, ladReach: s.ladder.reach });
    if (s.split) r.splitAfter = s.split.after;
    if (s.heist) Object.assign(r, { hzOn: 1, hzShields: s.heist.shields, hzSteals: s.heist.steals, hzJinxes: s.heist.jinxes, hzClock: s.heist.clock });
    if (s.slate) Object.assign(r, { slKind: s.slate.kind });
    if (D.hardCap) { r.hcOn = 1; r.hcScale = D.hardCap.scale || "auto"; }
    return rulesOf(r);
  }
  function targets(game, team, scoring) {
    if (!game || game.final || !game.proj || !game.proj.probs || !scoring.cats) return [];
    return scoring.cats.map((c) => ({ category: c, probability: team === game.a ? game.proj.probs[c.k] : 1 - game.proj.probs[c.k] }))
      .filter((x) => Number.isFinite(x.probability) && x.probability >= 0.2 && x.probability <= 0.8)
      .sort((a, b) => Math.abs(a.probability - 0.5) - Math.abs(b.probability - 0.5)).slice(0, 3);
  }
  function reliableSample(S, sport, p) {
    const lines = Object.entries(sport.gMax || {}).filter(([k, x]) => p.l && p.l[k] && x.hi >= 4);
    return !lines.length || lines.some(([k, x]) => (S.stat(sport, p, k, x.col) || 0) >= Math.ceil(x.hi * 0.4));
  }
  function draftAdvice(F, D, ctx, team) {
    if (team == null || !D.teams[team] || D.phase === "done" || !["snake", "linear", "3rr", "auction"].includes(D.type) || D.roulette || D.trivia) return null;
    const legal = ctx.available.slice(0, 120).filter((p) => F.canAdd(D, ctx, team, p).ok);
    if (!legal.length) return null;
    const best = legal[0], fit = legal.reduce((b, p) => F.worth(D, ctx, team, p) > F.worth(D, ctx, team, b) ? p : b, best);
    const next = D.type === "auction" ? null : F.nextPickOf(D, team);
    const first = D.type === "auction" ? null : D.board.findIndex((p, i) => !p && D.order[i] != null) + 1;
    const wait = next == null || !first ? null : Math.max(0, next - first);
    const later = wait == null ? null : legal[Math.min(legal.length - 1, wait)];
    return { best, fit, later, wait, next };
  }
  return { RULE_FIELDS, rulesOf, encode, decode, applyQuery, rankingConfig, mockConflict, fromDraft, targets, reliableSample, draftAdvice };
});
