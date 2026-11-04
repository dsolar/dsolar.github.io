/* A salary-cap practice draft. The same rules as Hard Cap, with no league server. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./engine.js"));
  else root.HardCapPractice = factory(root.HardCap);
})(this, function (H) {
  "use strict";
  function create(cba, now, seed) {
    var L = H.newLeague({ cba: cba, teams: 10, name: "Your practice draft", now: now, seed: seed,
      settings: { roster: 12, capMode: "tiers", lineScale: H.DEFAULTS.lineScale, buyIn: 0, prospectAuction: "skip" } });
    H.setOrder(L, L.teams.map(function (t) { return t.id; }));
    L.teams[0].owner = "You"; L.teams[0].name = "Your team"; L.teams[0].abbr = "YOU";
    H.startDraft(L, now);
    return L;
  }
  // Only bots advance automatically. The visitor's seat never times out.
  function advance(L, pool, now) {
    var c, count = 0;
    while ((c = H.onClock(L, now)) && c.team !== 0 && count < L.nba.order.length) {
      var p = H.autoChoice(L, pool, c.team, H.rng(L.seed + L.nba.picks.length * 31 + 3));
      var result = H.draftPick(L, pool, c.team, p.id, now, p.relaxed ? { relaxed: true } : true);
      if (!result.ok) break;
      count++;
    }
    return count;
  }
  function pick(L, pool, id, now) {
    var result = H.draftPick(L, pool, 0, id, now, false);
    if (result.ok) advance(L, pool, now);
    return result;
  }
  return { create: create, advance: advance, pick: pick };
});
