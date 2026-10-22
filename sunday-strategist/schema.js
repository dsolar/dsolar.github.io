/* Sunday Strategist: validates scenario content before the game trusts it.
   validate(data) returns a list of problems ("scenarios[0].plays[2].key.answer: ..."); empty means valid.
   The page refuses to load a scenario that fails, and engine.test.cjs runs it on every bundled scenario.
   docs/DATA_MODEL.md describes each field in plain English. */
(function (root, api) {
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SS_SCHEMA = api;
})(this, (function () {
  var TYPES = ["verified", "reconstructed", "adapted", "synthetic"];
  var STATUSES = ["draft", "review", "approved", "published", "deprecated"];
  var CONFIDENCE = ["verified", "derived", "expert-charted", "inferred", "synthetic", "unknown"];
  var ON_PRESSURE = ["hot", "sight", "throwaway", "none"];
  var CLUES = ["meaningful", "deceptive", "uncertain"];
  var CATEGORIES = ["recommended", "high-floor", "aggressive", "conservative", "valid", "safe", "risky", "poor"];
  var WHEN = { motion: "motions", protection: "protections", play: "plays", contingency: "contingencies" };

  function validate(data) {
    var errs = [];
    function err(path, msg) { errs.push(path + ": " + msg); }
    function str(o, k, path) { if (typeof o[k] !== "string" || !o[k].trim()) err(path + "." + k, "required text"); }
    function num(o, k, path, lo, hi) {
      if (typeof o[k] !== "number" || !isFinite(o[k])) return err(path + "." + k, "required number");
      if (o[k] < lo || o[k] > hi) err(path + "." + k, "must be between " + lo + " and " + hi);
    }
    function list(o, k, path) { if (!Array.isArray(o[k]) || !o[k].length) { err(path + "." + k, "required non-empty list"); return []; } return o[k]; }
    function unique(items, path) {
      var seen = {};
      items.forEach(function (x, i) {
        if (!x || typeof x.id !== "string" || !x.id) return err(path + "[" + i + "].id", "required id");
        if (seen[x.id]) err(path + "[" + i + "].id", "duplicate id " + x.id);
        seen[x.id] = true;
      });
      return seen;
    }

    if (!data || typeof data !== "object") return ["data: missing"];
    if (typeof data.concepts !== "object" || !data.concepts) err("concepts", "required");
    if (typeof data.defenses !== "object" || !data.defenses) err("defenses", "required");
    var concepts = data.concepts || {}, defenses = data.defenses || {}, tagNames = data.tags || {};
    Object.keys(concepts).forEach(function (k) { ["name", "plain", "stresses", "timing"].forEach(function (f) { str(concepts[k], f, "concepts." + k); }); });
    Object.keys(defenses).forEach(function (k) { ["name", "plain"].forEach(function (f) { str(defenses[k], f, "defenses." + k); }); });
    unique(list(data, "confidence", "data"), "confidence");
    var scenarios = list(data, "scenarios", "data");
    unique(scenarios, "scenarios");

    scenarios.forEach(function (s, si) {
      var p = "scenarios[" + si + "]";
      ["id", "title", "module", "takeaway", "next"].forEach(function (k) { str(s, k, p); });
      if (TYPES.indexOf(s.type) < 0) err(p + ".type", "must be one of " + TYPES.join(", "));
      if (STATUSES.indexOf(s.status) < 0) err(p + ".status", "must be one of " + STATUSES.join(", "));

      // Provenance: every fact says where it came from. Only synthetic scenarios may skip a real source.
      var pv = s.provenance || {};
      if (pv.type !== s.type) err(p + ".provenance.type", "must match the scenario type");
      str(pv, "label", p + ".provenance");
      if (!Array.isArray(pv.sources)) err(p + ".provenance.sources", "required list (empty only for synthetic)");
      Object.keys(pv.fieldConfidence || {}).forEach(function (k) {
        if (CONFIDENCE.indexOf(pv.fieldConfidence[k]) < 0) err(p + ".provenance.fieldConfidence." + k, "must be one of " + CONFIDENCE.join(", "));
      });
      if (!pv.fieldConfidence || !Object.keys(pv.fieldConfidence).length) err(p + ".provenance.fieldConfidence", "required");
      if (s.type !== "synthetic") {
        if (!pv.sources || !pv.sources.length) err(p + ".provenance.sources", "a real or adapted play needs at least one source");
        var h = s.historical || {};
        ["gameId", "playId", "offense", "defense"].forEach(function (k) { str(h, k, p + ".historical"); });
        num(h, "season", p + ".historical", 1999, 2100);
      } else if (s.historical) {
        err(p + ".historical", "a synthetic scenario must not point at a real game");
      }

      var c = s.context || {};
      num(c, "quarter", p + ".context", 1, 5);
      if (!/^\d{1,2}:\d{2}$/.test(c.clock || "")) err(p + ".context.clock", "use M:SS");
      num(c, "down", p + ".context", 1, 4);
      num(c, "distance", p + ".context", 1, 99);
      num(c, "yardLine", p + ".context", 1, 50);
      if (["own", "opp"].indexOf(c.side) < 0) err(p + ".context.side", "own or opp");
      if (["left", "middle", "right"].indexOf(c.hash) < 0) err(p + ".context.hash", "left, middle or right");
      if (!c.score || typeof c.score.you !== "number" || typeof c.score.opp !== "number") err(p + ".context.score", "{ you, opp } numbers");
      str(c, "objective", p + ".context");

      var off = unique(list(s.offense || {}, "players", p + ".offense"), p + ".offense.players");
      var def = unique(list(s.defense || {}, "players", p + ".defense"), p + ".defense.players");
      ["offense", "defense"].forEach(function (side) {
        var ps = (s[side] || {}).players || [];
        if (ps.length !== 11) err(p + "." + side + ".players", "needs 11 players, has " + ps.length);
        ps.forEach(function (pl, i) {
          var pp = p + "." + side + ".players[" + i + "]";
          str(pl, "label", pp); str(pl, "role", pp);
          num(pl, "x", pp, 0, 53.3);
          if (side === "offense") num(pl, "y", pp, -15, 0); else num(pl, "y", pp, 0, 25);
          if (side === "offense" && def[pl.id]) err(pp + ".id", "offense and defense ids must differ");
        });
        str(s[side] || {}, "personnelText", p + "." + side);
      });
      var isDef = function (id) { return !!def[id]; }, isOff = function (id) { return !!off[id]; };

      var a = s.actual || {};
      if (!defenses[a.call]) err(p + ".actual.call", "unknown defense " + a.call);
      list(a, "rushers", p + ".actual").forEach(function (id) { if (!isDef(id)) err(p + ".actual.rushers", "unknown defender " + id); });
      (a.droppers || []).forEach(function (id) {
        if (!isDef(id)) err(p + ".actual.droppers", "unknown defender " + id);
        if ((a.rushers || []).indexOf(id) >= 0) err(p + ".actual.droppers", id + " can't both rush and drop");
      });
      ((s.defense || {}).players || []).forEach(function (pl) { if (!(a.post || {})[pl.id]) err(p + ".actual.post", "no post-snap spot for " + pl.id); });
      str(a, "coverage", p + ".actual");
      (a.events || []).forEach(function (e, i) { num(e, "t", p + ".actual.events[" + i + "]", 0, 10); str(e, "text", p + ".actual.events[" + i + "]"); });

      list(s.diagnosis || {}, "questions", p + ".diagnosis").forEach(function (q, i) {
        var qp = p + ".diagnosis.questions[" + i + "]";
        str(q, "prompt", qp); str(q, "explain", qp); str(q, "error", qp);
        if (q.kind === "single") {
          var opts = unique(list(q, "options", qp), qp + ".options");
          var best = 0;
          Object.keys(q.credit || {}).forEach(function (k) {
            if (!opts[k]) err(qp + ".credit." + k, "not an option");
            best = Math.max(best, q.credit[k]);
          });
          if (best !== 100) err(qp + ".credit", "one option must earn 100");
        } else if (q.kind === "rushers") {
          list(q, "answer", qp).forEach(function (id) { if (!isDef(id)) err(qp + ".answer", "unknown defender " + id); });
          if ((q.answer || []).indexOf(q.critical) < 0) err(qp + ".critical", "must be in the answer");
        } else err(qp + ".kind", "single or rushers");
      });

      var ids = {};
      Object.keys(WHEN).forEach(function (k) { ids[WHEN[k]] = unique(list(s, WHEN[k], p), p + "." + WHEN[k]); });
      if (!ids.motions.none) err(p + ".motions", "needs a 'none' option");
      s.motions.forEach(function (m, i) {
        var mp = p + ".motions[" + i + "]";
        str(m, "label", mp); str(m, "text", mp);
        if (m.path && !isOff(m.path.from)) err(mp + ".path.from", "unknown offensive player");
        Object.keys(m.moves || {}).forEach(function (id) { if (!isDef(id)) err(mp + ".moves", "unknown defender " + id); });
      });
      function assignments(items, path) {
        (items || []).forEach(function (x, i) {
          var ap = path + "[" + i + "]";
          if (!isOff(x.player)) err(ap + ".player", "unknown offensive player " + x.player);
          if (!isDef(x.key)) err(ap + ".key", "unknown defender " + x.key);
          ["assignment", "win", "fail"].forEach(function (k) { str(x, k, ap); });
          num(x, "p", ap, 0, 1);
        });
      }
      s.protections.forEach(function (x, i) {
        var xp = p + ".protections[" + i + "]";
        str(x, "label", xp); str(x, "why", xp);
        num(x, "hold", xp, 0, 6); num(x, "grade", xp, 0, 100);
        if (CATEGORIES.indexOf(x.category) < 0) err(xp + ".category", "unknown category");
        assignments(x.assignments, xp + ".assignments");
      });
      s.plays.forEach(function (x, i) {
        var xp = p + ".plays[" + i + "]";
        if (!concepts[x.concept]) err(xp + ".concept", "unknown concept " + x.concept);
        str(x, "label", xp); str(x, "why", xp);
        num(x, "need", xp, 0, 6); num(x, "window", xp, 0, 1); num(x, "grade", xp, 0, 100); num(x, "yards", xp, -20, 99);
        if (CATEGORIES.indexOf(x.category) < 0) err(xp + ".category", "unknown category");
        if (!isDef(x.conflict)) err(xp + ".conflict", "unknown defender");
        if (!x.key || !isDef(x.key.answer)) err(xp + ".key.answer", "unknown defender");
        Object.keys((x.key || {}).partial || {}).forEach(function (id) { if (!isDef(id)) err(xp + ".key.partial", "unknown defender " + id); });
        (x.routes || []).forEach(function (r, j) { if (!isOff(r.from)) err(xp + ".routes[" + j + "].from", "unknown offensive player"); });
        if (x.hot) num(x.hot, "window", xp + ".hot", 0, 1);
        var crit = (x.assignments || []).filter(function (y) { return y.critical; });
        if (!crit.length) err(xp + ".assignments", "needs at least one critical assignment");
        assignments(x.assignments, xp + ".assignments");
      });
      s.contingencies.forEach(function (x, i) {
        var xp = p + ".contingencies[" + i + "]";
        str(x, "label", xp); str(x, "why", xp);
        if (ON_PRESSURE.indexOf(x.onPressure) < 0) err(xp + ".onPressure", "must be one of " + ON_PRESSURE.join(", "));
        if (x.onPressure === "sight" && !(x.throw && typeof x.throw.window === "number")) err(xp + ".throw", "a sight adjust needs its throw");
        s.plays.forEach(function (pl) { if (typeof (x.grades || {})[pl.id] !== "number") err(xp + ".grades", "no grade for play " + pl.id); });
      });
      (s.interactions || []).forEach(function (x, i) {
        Object.keys(x.when || {}).forEach(function (k) {
          if (!WHEN[k]) err(p + ".interactions[" + i + "].when", "unknown key " + k);
          else if (!ids[WHEN[k]][x.when[k]]) err(p + ".interactions[" + i + "].when." + k, "unknown id " + x.when[k]);
        });
        str(x, "note", p + ".interactions[" + i + "]");
      });
      var rec = s.recommended || {};
      Object.keys(WHEN).forEach(function (k) { if (!ids[WHEN[k]][rec[k]]) err(p + ".recommended." + k, "unknown id " + rec[k]); });
      list(s, "clues", p).forEach(function (x, i) { str(x, "text", p + ".clues[" + i + "]"); if (CLUES.indexOf(x.kind) < 0) err(p + ".clues[" + i + "].kind", "must be one of " + CLUES.join(", ")); });
      var l = s.learning || {};
      list(l, "objectives", p + ".learning");
      list(l, "tags", p + ".learning").forEach(function (t) { if (!tagNames[t]) err(p + ".learning.tags", "no label for tag " + t + " in data.tags"); });
      num(l, "revisitDays", p + ".learning", 0, 365);
    });
    return errs;
  }

  return { validate: validate, TYPES: TYPES, CONFIDENCE: CONFIDENCE };
})());
