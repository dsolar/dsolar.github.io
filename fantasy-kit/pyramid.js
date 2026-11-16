/* Fantasy Kit: promotion and relegation between two linked leagues (a pyramid). No DOM and no network: the setup
   form, the league pages, the commissioner's new-season button and the tests all read it.

   A pyramid is two leagues of the same sport made together, a top tier and a lower tier. The lower tier can have
   fewer teams. Each league's D.season.pyramid (and L.settings.pyramid once the season starts) is
     { id, tier: 1 | 2, other: <the other league's id>, names: [top, lower], mode: "swap" | "playoff", k }
   Managers move, rosters don't: every season is a fresh draft in both tiers (redraft only).

   At the end of the season, on the regular-season table:
     swap     the top tier's bottom k go down and the lower tier's top k come up
     playoff  the same, plus one more place decided by a one-week playoff: the top tier's last safe team (k+1th from
              the bottom) against the lower tier's next team (k+1th). It's played the week after the regular season
              (the first playoff week), or the last regular week when the league has no playoffs. Higher score wins;
              a tie keeps the top-tier team up.
   A promoted manager takes the relegated team's spot (and its place in next season's draft order), with his own team
   name, abbreviation and color. The worst relegated team swaps with the best promoted one, and so on.

   API
     rules(p)                          { mode, k } with defaults
     maxK(n1, n2, mode)                the most teams that can move each way for these tier sizes
     zones(L)                          { team: "down" | "playoff" | "up" } on the current table
     playoffWeek(L)                    the week the playoff is played
     over(L)                           the season is finished
     result(top, topCtx, bot, botCtx)  { down, up, playoff, pairs, final }: who moves
     nextDrafts(top, topCtx, bot, botCtx, sport, o)  { top, bot, result }: both tiers' next drafts with managers moved
     events(result, top, bot)          emails for the managers who moved */
(function (root, factory) {
  const isNode = typeof module !== "undefined" && module.exports;
  const m = factory(isNode ? require("./league.js") : null, isNode ? require("./season.js") : null);
  if (isNode) module.exports = m;
  else (root.FK = root.FK || {}).pyramid = m;
})(this, function (G0, Z0) {
  "use strict";
  const G = () => G0 || window.FK.league, Z = () => Z0 || window.FK.season;
  const MODES = ["swap", "playoff"];
  const NAMES = ["Premier", "Championship"];

  function rules(p) {
    const q = p || {};
    return { mode: MODES.includes(q.mode) ? q.mode : "swap", k: Math.max(1, Math.min(3, Number(q.k) || 2)), names: Array.isArray(q.names) && q.names.length === 2 ? q.names : NAMES };
  }
  // at most half of either tier moves (the playoff spot counts), and never more than three each way
  function maxK(n1, n2, mode) {
    const extra = mode === "playoff" ? 1 : 0;
    const room = (n) => Math.floor(n / 2) - extra;
    return Math.max(0, Math.min(3, room(n1), room(n2)));
  }
  const pyr = (L) => (L && L.settings && L.settings.pyramid) || null;
  const table = (L) => G().standings(L).map((r) => r.team);
  const over = (L) => !!L && (G().finish(L).champion != null || L.week > G().totalWeeks(L));

  function zones(L) {
    const p = pyr(L);
    if (!p) return {};
    const r = rules(p), t = table(L), out = {};
    if (p.tier === 1) {
      t.slice(-r.k).forEach((id) => (out[id] = "down"));
      if (r.mode === "playoff" && t.length > r.k) out[t[t.length - r.k - 1]] = "playoff";
    } else {
      t.slice(0, r.k).forEach((id) => (out[id] = "up"));
      if (r.mode === "playoff" && t.length > r.k) out[t[r.k]] = "playoff";
    }
    return out;
  }
  const playoffWeek = (L) => (L.settings.playoffWeeks > 0 ? L.settings.weeks + 1 : L.settings.weeks);
  const weekPts = (L, ctx, team, w) => { const x = G().teamWeek(L, ctx, team, w); return x && x.total != null ? Math.round(x.total * 100) / 100 : 0; };

  function result(top, topCtx, bot, botCtx) {
    const r = rules(pyr(top) || pyr(bot));
    const t1 = table(top), t2 = table(bot);
    const down = t1.slice(-r.k).reverse(), up = t2.slice(0, r.k);
    let playoff = null;
    if (r.mode === "playoff" && t1.length > r.k && t2.length > r.k) {
      const a = t1[t1.length - r.k - 1], b = t2[r.k], week = playoffWeek(top);
      const pa = weekPts(top, topCtx, a, week), pb = weekPts(bot, botCtx, b, week);
      playoff = { top: a, bot: b, week, topPts: pa, botPts: pb, winner: pb > pa ? "bot" : "top" };
      if (playoff.winner === "bot") { down.push(a); up.push(b); }
    }
    return { down, up, playoff, pairs: down.map((d, i) => [d, up[i]]), final: over(top) && over(bot) };
  }

  // the parts of a team that travel with its manager
  const who = (t) => ({ name: t.name, abbr: t.abbr, owner: t.owner, color: t.color });
  function nextDrafts(top, topCtx, bot, botCtx, sport, o = {}) {
    const res = result(top, topCtx, bot, botCtx);
    const D1 = Z().nextDraft(top, topCtx, sport, {}, { now: o.now, seed: o.seed });
    const D2 = Z().nextDraft(bot, botCtx, sport, {}, { now: o.now, seed: o.seed != null ? o.seed / 2 : undefined });
    for (const [a, b] of res.pairs) {
      const ta = who(top.teams[a]), tb = who(bot.teams[b]);
      Object.assign(D1.teams[a], tb); Object.assign(D2.teams[b], ta);
    }
    // what happened, for both leagues' history and their front pages next season
    const last = { year: (top.draft && top.draft.year) || 1, down: res.pairs.map(([a]) => top.teams[a].name), up: res.pairs.map(([, b]) => bot.teams[b].name),
      playoff: res.playoff ? { top: top.teams[res.playoff.top].name, bot: bot.teams[res.playoff.bot].name, topPts: res.playoff.topPts, botPts: res.playoff.botPts, winner: res.playoff.winner } : null };
    for (const D of [D1, D2]) if (D.season && D.season.pyramid) D.season.pyramid = Object.assign({}, D.season.pyramid, { last });
    return { top: D1, bot: D2, result: res };
  }

  // emails: the moved managers hear where they're going (team ids are next season's spots)
  function events(res, top, bot) {
    const r = rules(pyr(top)), out = [];
    for (const [a, b] of res.pairs) {
      out.push({ league: "bot", team: b, kind: "pyramid", subject: `Relegated to the ${r.names[1]}`, body: `${top.teams[a].name} finished in the drop zone and goes down to the ${r.names[1]} next season. Win it and you're back up.` });
      out.push({ league: "top", team: a, kind: "pyramid", subject: `Promoted to the ${r.names[0]}`, body: `${bot.teams[b].name} goes up to the ${r.names[0]} next season. Next season's draft is open there now.` });
    }
    return out;
  }

  return { MODES, NAMES, rules, maxK, zones, playoffWeek, over, result, nextDrafts, events };
});
