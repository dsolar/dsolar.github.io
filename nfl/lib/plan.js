/* NFL Hub: rough player value and the suggestion engine.

   Value (version 1, labeled rough on the site): what a starter at his position costs on the market, times how much
   he plays. The positional price is the average contract (APY) of the players ranked in the starting tier at that
   position league-wide (32 quarterbacks, 64 corners, 96 interior linemen...). His share is his snap share this
   season in his phase, so a full-time starter is worth the starter price and a rotational player much less.
   Age takes a little off each later year, more at running back and less at quarterback.

   Suggestions for a team's planning year (the next league year by default), each with the exact cap math:
     cut         saves real cap with little dead money, from a player the value says is paid more than he's worth
     restructure big base salary on a player the team clearly keeps
     extend      starter entering the last year of his deal (or a young quarterback on his rookie deal)
     trade       saves more by trade than by release (guarantees go with him)
     expiring    a starter whose deal ends this season: re-sign or tag */
(function (root) {
  "use strict";
  const C = root.NFLCap || (typeof require !== "undefined" ? require("./cap.js") : null);
  const P = {};
  // Position groups and starters per team
  const GROUP = { QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE", T: "OT", OT: "OT", G: "IOL", C: "IOL", OG: "IOL", OL: "IOL",
    DE: "EDGE", OLB: "EDGE", EDGE: "EDGE", DT: "IDL", NT: "IDL", DL: "IDL", LB: "LB", ILB: "LB", MLB: "LB",
    CB: "CB", DB: "CB", S: "S", SS: "S", FS: "S", SAF: "S", K: "K", P: "P", LS: "LS" };
  const STARTERS = { QB: 1, RB: 1, WR: 3, TE: 1, OT: 2, IOL: 3, EDGE: 2, IDL: 2, LB: 2, CB: 3, S: 2, K: 1, P: 1, LS: 1 };
  const DEF = new Set(["EDGE", "IDL", "LB", "CB", "S"]);
  const AGE_FALL = { QB: 0.03, RB: 0.12, WR: 0.07, TE: 0.06, OT: 0.05, IOL: 0.05, EDGE: 0.07, IDL: 0.06, LB: 0.07, CB: 0.09, S: 0.07, K: 0.02, P: 0.02, LS: 0.02 };
  const PEAK = { QB: 32, RB: 26, WR: 28, TE: 29, OT: 30, IOL: 30, EDGE: 28, IDL: 29, LB: 28, CB: 27, S: 28, K: 34, P: 34, LS: 34 };
  P.GROUP = GROUP; P.STARTERS = STARTERS;
  P.group = p => GROUP[p.dpos] || GROUP[p.pos] || "WR";

  P.init = W => {
    P.buildRatings(W);
    W.rookieCost = (code, y) => P.rookieCost(W, code, y).total;
    // starter price at each position: average APY of the starting tier league-wide
    const byG = {};
    for (const p of W.players) {
      if (!p.c || !p.c.apy) continue;
      (byG[P.group(p)] = byG[P.group(p)] || []).push(p.c.apy);
    }
    W.price = {};
    for (const g of Object.keys(STARTERS)) {
      const a = (byG[g] || []).sort((x, y) => y - x), n = 32 * STARTERS[g];
      const top = a.slice(0, n);
      W.price[g] = top.length ? top.reduce((s, v) => s + v, 0) / top.length : 1;
    }
    // league-wide APY rank tables for extension prices
    W.apys = {};
    for (const g of Object.keys(byG)) W.apys[g] = byG[g].sort((x, y) => y - x);
    return W;
  };
  // Share of his phase's snaps this season (0..1); without snap data, his depth chart rank stands in
  P.share = (W, p) => {
    const g = P.group(p);
    if (p.snaps && p.snaps[3] >= 2) return Math.min(1, g === "K" || g === "P" || g === "LS" ? Math.max(p.snaps[2] * 3, 0.9) : DEF.has(g) ? p.snaps[1] : p.snaps[0]);
    const d = P.depthRank(W, p);
    return d === 1 ? 0.85 : d === 2 ? 0.35 : 0.1;
  };
  P.depthRank = (W, p) => {
    const t = W.depth[p.t];
    if (!t) return 3;
    const r = t.rows.filter(x => x[3] === p.id).map(x => x[2]);
    return r.length ? Math.min(...r) : 4;
  };
  // What his play is worth in a season (millions). Two halves: the starter price at his position times how much he
  // plays, and the market's own verdict, his contract's average when he signed it (grown with the cap), scaled by
  // whether he's still playing like it. A rookie-scale deal says nothing about quality, so rookies get only the first.
  P.rookieDeal = p => !!(p.draft && p.draft[0] && p.c && p.c.signed === p.draft[0] && (p.c.yrs || 0) <= 5);
  // Value: his position's starter price, times how much he plays, times how well: the quality multiplier from the
  // player rating (on-field plus-minus and this season's production, below), then blended 70/30 with the market's own
  // verdict, his contract (a rookie deal says nothing about quality, so rookies get only the first part).
  P.value = (W, p, y) => {
    const g = P.group(p), sh = P.share(W, p), age = (p.age || 26) + (y - W.season);
    const aging = k => Math.max(0.2, 1 - Math.max(0, k - PEAK[g]) * AGE_FALL[g]);
    const q = P.quality(W, p);
    const role = W.price[g] * Math.pow(sh, 1.25) * q.mult * aging(age);
    if (P.rookieDeal(p) || !p.c || !p.c.apy) return role;
    const grown = p.c.apy * Math.pow(1.07, Math.max(0, W.season - (p.c.signed || W.season)));
    const own = grown * Math.min(1, sh / 0.6) * aging(age) / aging((p.age || 26));
    return 0.7 * role + 0.3 * own;
  };

  // ---------- the player rating ----------
  // Two parts, each as standard deviations above or below the average player at his position:
  //   on-field: his plus-minus from the last two seasons of play-by-play (tools/nfl_rating.py: every play's EPA
  //             explained by the 22 players on the field), trusted more the more snaps it rests on
  //   production: this season's box score per game (EPA per play for quarterbacks; yards, touchdowns and EPA against
  //             the average play for backs and receivers; pressure numbers for pass rushers; tackles, plays on the
  //             ball and turnovers for linebackers and defensive backs). Linemen have none, so they're all on-field.
  // The mix leans on production where the box score sees a player well (quarterbacks, receivers) and on the on-field
  // number where it doesn't. The multiplier on his position's price runs from 0.3 (well below average) to 2.3.
  const MIX = { QB: 0.35, RB: 0.4, WR: 0.4, TE: 0.5, OT: 1, IOL: 1, EDGE: 0.5, IDL: 0.6, LB: 0.6, CB: 0.65, S: 0.65, K: 0, P: 0, LS: 0 };
  P.MIX = MIX;
  function prodScore(W, s, g) {
    const b = W.base || { rush: 0, rec: 0 }, gm = Math.max(1, s.games);
    const tkl = s.def_tackles_solo + 0.5 * s.def_tackle_assists;
    const oaR = s.rushing_epa - s.carries * b.rush, oaC = s.receiving_epa - s.targets * b.rec;
    switch (g) {
      case "QB": { const pl = s.attempts + s.sacks_suffered + s.carries; return pl >= 40 ? { v: (s.passing_epa + s.rushing_epa) / pl, n: pl, k: 100 } : null; }
      case "RB": return s.carries + s.targets >= 25 ? { v: (s.rushing_yards + s.receiving_yards + 20 * (s.rushing_tds + s.receiving_tds) + 6 * (oaR + oaC)) / gm, n: gm, k: 2 } : null;
      case "WR": case "TE": return s.targets >= 12 ? { v: (s.receiving_yards + 20 * s.receiving_tds + 6 * oaC) / gm, n: gm, k: 2 } : null;
      case "EDGE": case "IDL": return s.games >= 3 ? { v: (3 * s.def_sacks + s.def_qb_hits + 1.5 * s.def_tackles_for_loss + 2 * s.def_fumbles_forced + 0.15 * tkl) / gm, n: gm, k: 3 } : null;
      case "LB": return s.games >= 3 ? { v: (0.4 * tkl + 1.5 * s.def_tackles_for_loss + 3 * s.def_sacks + 4 * s.def_interceptions + 1.5 * s.def_pass_defended + 2 * s.def_fumbles_forced) / gm, n: gm, k: 3 } : null;
      case "CB": case "S": return s.games >= 3 ? { v: (5 * s.def_interceptions + 2 * s.def_pass_defended + 0.3 * tkl + 2 * s.def_fumbles_forced + s.def_tackles_for_loss + 2 * s.def_sacks) / gm, n: gm, k: 3 } : null;
      default: return null;
    }
  }
  const DEF_G = new Set(["EDGE", "IDL", "LB", "CB", "S"]);
  P.buildRatings = W => {
    const ci = {}; if (W.stats) W.stats.cols.forEach((c, i) => { ci[c] = i; });
    const statOf = id => { const v = W.stats && W.stats.p[id]; if (!v) return null; const o = {}; for (const k in ci) o[k] = v[ci[k]]; return o; };
    // league-average EPA per carry and per target
    if (W.stats) {
      let c = 0, re = 0, t = 0, ce = 0;
      for (const v of Object.values(W.stats.p)) { c += v[ci.carries]; re += v[ci.rushing_epa]; t += v[ci.targets]; ce += v[ci.receiving_epa]; }
      W.base = { rush: c ? re / c : 0, rec: t ? ce / t : 0 };
    }
    const raw = {};                       // id -> { on, onN, prod, prodN }
    for (const p of W.players) {
      const g = P.group(p), r = W.rating && W.rating.p[p.id], s = statOf(p.id), o = {};
      if (r) { const def = DEF_G.has(g); o.on = def ? r[1] : r[0]; o.onN = def ? r[3] : r[2]; }
      const pr = s ? prodScore(W, s, g) : null;
      if (pr) { o.prod = pr.v; o.prodN = pr.n; o.prodK = pr.k; }
      raw[p.id] = o;
    }
    // standardize within position (players with real samples set the scale)
    const z = {};
    const groups = {};
    for (const p of W.players) (groups[P.group(p)] = groups[P.group(p)] || []).push(p);
    for (const [g, ps] of Object.entries(groups)) {
      const stat = key => {
        const vals = ps.map(p => raw[p.id]).filter(o => o[key] != null && (key === "on" ? o.onN >= 250 : true)).map(o => o[key]);
        if (vals.length < 8) return null;
        const mean = vals.reduce((a, v) => a + v, 0) / vals.length, sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) * (v - mean), 0) / vals.length) || 1;
        return { mean, sd };
      };
      const so = stat("on"), sp = stat("prod");
      for (const p of ps) {
        const o = raw[p.id];
        const zon = so && o.on != null ? (o.on - so.mean) / so.sd * (o.onN / (o.onN + 500)) : null;
        const zpr = sp && o.prod != null ? (o.prod - sp.mean) / sp.sd * (o.prodN / (o.prodN + o.prodK)) : null;
        const w = MIX[g] ?? 0.5;
        let zz = 0;
        if (zon != null && zpr != null) zz = w * zon + (1 - w) * zpr;
        else if (zon != null) zz = zon;
        else if (zpr != null) zz = zpr;
        z[p.id] = { zz, zon, zpr };
      }
      // the blend of two shrunk numbers is narrower than either, so re-scale it so regulars at each position spread
      // one standard deviation per unit again (part-timers keep their shrink toward average; never stretched more than 2x)
      const reg = ps.filter(p => { const o = raw[p.id]; return (o.onN || 0) >= 400 || (o.prodN || 0) >= (o.prodK || 1) * 3; }).map(p => z[p.id].zz);
      let sd = 1;
      if (reg.length >= 8) { const m = reg.reduce((a, v) => a + v, 0) / reg.length; sd = Math.max(0.5, Math.sqrt(reg.reduce((a, v) => a + (v - m) * (v - m), 0) / reg.length)) || 1; }
      for (const p of ps) {
        const q = z[p.id], zz = q.zz / sd;
        z[p.id] = { z: Math.max(-3, Math.min(3.25, zz)), zon: q.zon, zpr: q.zpr, mult: Math.max(0.3, Math.min(2.3, 1 + 0.45 * zz)) };
      }
    }
    W.quality = z;
  };
  P.quality = (W, p) => (W.quality && W.quality[p.id]) || { z: 0, mult: 1, zon: null, zpr: null };
  // Market price for an extension: the APY at the rank his value implies among players at his position
  P.extensionApy = (W, p, y) => {
    const g = P.group(p), list = W.apys[g] || [], v = P.value(W, p, y);
    const i = list.findIndex(a => a <= v * 1.1);
    const at = i < 0 ? list[list.length - 1] || v : list[Math.max(0, i - 2)];
    return Math.max(C.minSalary(p.exp || 0, y) * 1.5, at * Math.pow(1.07, y - W.season));
  };
  // Franchise tag: the NFL's 2026 non-exclusive tag at his tag position, grown with the cap (the tag is a five-year
  // average share of the cap), or 120% of his last cap number if that's more
  P.TAG2026 = { QB: 43.895, RB: 14.293, WR: 27.298, TE: 15.045, OL: 25.773, DE: 24.434, DT: 27.127, LB: 26.865, CB: 21.161, S: 20.149, K: 6.649 };
  P.tagPos = p => {
    const g = P.group(p);
    return { QB: "QB", RB: "RB", WR: "WR", TE: "TE", OT: "OL", IOL: "OL", IDL: "DT", LB: "LB", CB: "CB", S: "S", K: "K", P: "K", LS: "K" }[g] || (g === "EDGE" ? (/LB/.test(p.pos || "") ? "LB" : "DE") : "LB");
  };
  P.tagPrice = (W, p, y) => {
    const base = P.TAG2026[P.tagPos(p)] * (C.BASE[y] || C.BASE[2034]) / C.BASE[2026];
    return Math.max(base, 1.2 * C.capHit(p, y - 1));
  };
  P.tag = (W, g, y) => P.TAG2026[{ OT: "OL", IOL: "OL", IDL: "DT", EDGE: "DE", P: "K", LS: "K" }[g] || g] * (C.BASE[y] || C.BASE[2034]) / C.BASE[2026];

  // Rookie contracts by draft slot: this year's class's average salaries, smoothed, grown with the cap each year.
  // A rookie deal starts low and climbs (base salaries rise, the bonus is spread evenly), so year by year it runs
  // about 85%, 95%, 105% and 115% of its average.
  P.rookieCurve = W => {
    if (W._rc) return W._rc;
    const pts = W.players.filter(p => p.draft && p.draft[0] === W.season && p.draft[1] && p.c && p.c.apy && (p.c.yrs || 0) >= 3).map(p => [p.draft[1], p.c.apy]).sort((a, b) => a[0] - b[0]);
    const curve = [];
    for (let n = 1; n <= 262; n++) {
      const near = pts.filter(q => Math.abs(q[0] - n) <= (n < 40 ? 2 : 6)).map(q => q[1]).sort((a, b) => a - b);
      curve[n] = near.length ? near[Math.floor(near.length / 2)] : (curve[n - 1] || 1.1);
    }
    return (W._rc = curve);
  };
  // The picks a team has in a draft: next year's from the Big Board's order (Tankathon), later years its own seven at
  // the same spots
  P.picksIn = (W, code, y) => {
    const order = (W.draft && W.draft.picks) || [];
    if (y === W.season + 1) return order.filter(x => x[3] === code).map(x => ({ n: x[0], round: x[1], from: x[2] }));
    const own = order.filter(x => x[2] === code && x[1] <= 7);
    const seen = {}, out = [];
    for (const x of own) if (!seen[x[1]]) { seen[x[1]] = 1; out.push({ n: x[0], round: x[1], from: code, est: true }); }
    return out;
  };
  // Cap a team's draft classes take in a year: each pick's rookie cap hit, less the minimum salary of the player he
  // pushes off the top 51 (how Over The Cap's "effective cap space" counts it)
  P.rookieCost = (W, code, y) => {
    let tot = 0, list = [];
    for (let cls = W.season + 1; cls <= Math.min(y, W.season + 3); cls++) {
      const k = y - cls; if (k > 3) continue;
      const grow = Math.pow(1.07, cls - W.season), curve = P.rookieCurve(W);
      for (const pk of P.picksIn(W, code, cls)) {
        const hit = curve[Math.min(262, pk.n)] * grow * [0.85, 0.95, 1.05, 1.15][k];
        const eff = Math.max(0, hit - C.minSalary(0, y));
        tot += eff; if (cls === y) list.push(Object.assign({ hit, eff }, pk));
      }
    }
    return { total: tot, list };
  };

  P.suggest = (W, code, y) => {
    const out = [];
    const ps = W.players.filter(p => p.t === code && p.c && p.st !== "DEV");
    for (const p of ps) {
      const r = p.c.rows[y], g = P.group(p), val = P.value(W, p, y), share = P.share(W, p);
      const last = C.lastYear(p);
      if (r && !r[C.R.void]) {
        const cap = r[C.R.cap], cut = C.effect(p, { kind: "cut", year: y }), june = C.effect(p, { kind: "cutJune", year: y }), tr = C.effect(p, { kind: "trade", year: y });
        const saveCut = -(cut.delta[y] || 0), saveJune = -(june.delta[y] || 0), saveTrade = -(tr.delta[y] || 0);
        const over = cap - val;
        if (cap >= 3 && saveCut >= Math.max(2.5, cap * 0.45) && over > Math.max(2, cap * 0.25)) {
          out.push({ kind: "cut", p, y, score: saveCut + over, cap, val, save: saveCut, saveJune, dead: cut.dead[y] || 0, deadNext: june.dead[y + 1] || 0,
            why: (C.guaranteeLeft(p, y) < 0.1 ? "No guarantees left. " : "") + "Saves " + m(saveCut) + " (" + m(saveJune) + " after June 1) against " + m(cut.dead[y] || 0) + " dead; value about " + m(val) + " for a " + m(cap) + " cap number." });
        }
        if (saveTrade >= Math.max(3, saveCut + 3) && cap >= 8 && over > 2) {
          out.push({ kind: "trade", p, y, score: saveTrade + Math.max(0, over) * 0.5, cap, val, save: saveTrade, dead: tr.dead[y] || 0,
            why: "Trading saves " + m(saveTrade) + " (cutting saves " + m(saveCut) + "): his " + m(C.guaranteeLeft(p, y)) + " in guarantees go with him. " + m(tr.dead[y] || 0) + " in bonus money stays behind." });
        }
        const rs = C.effect(p, { kind: "restructure", year: y });
        const freed = -(rs.delta[y] || 0);
        if (freed >= 5 && share >= 0.55 && C.yearsLeft(p, y) >= 2 && val >= cap * 0.5) {
          const later = Object.keys(rs.delta).filter(k => +k > y).reduce((a, k) => a + rs.delta[k], 0);
          out.push({ kind: "restructure", p, y, score: freed * 0.8, cap, val, save: freed, later,
            why: "Converting " + m(rs.converted) + " of base salary to a bonus frees " + m(freed) + " in " + y + " and adds " + m(later) + " over " + (rs.over - 1) + " later year" + (rs.over > 2 ? "s" : "") + ". The bill grows if he's ever cut." });
        }
        if (last === y && share >= 0.6 && (p.age || 30) <= 29) {
          const apy = P.extensionApy(W, p, y + 1), ext = C.effect(p, { kind: "extend", year: y, years: 3, apy, lowerNow: true });
          out.push({ kind: "extend", p, y, score: val * 1.2, cap, val, apy, now: -(ext.delta[y] || 0),
            why: "Last year of his deal. A 3-year extension near " + m(apy) + " a year " + ((ext.delta[y] || 0) < 0 ? "would lower this year's cap by " + m(-(ext.delta[y] || 0)) + " if his base is folded into the bonus." : "keeps this year's cap about the same.") });
        }
      }
      if (last === y - 1 && share >= 0.6) {
        const tag = P.tagPrice(W, p, y), apy = P.extensionApy(W, p, y);
        out.push({ kind: "expiring", p, y, score: val, cap: 0, val, apy, tag,
          why: "Deal ends after " + (y - 1) + ". Re-signing likely costs about " + m(apy) + " a year; the franchise tag would be about " + m(tag) + " for one year." });
      }
    }
    // Franchise tag: each team's two best starters whose deals run out, with the tag's price against his market
    const exp = out.filter(x => x.kind === "expiring" && P.group(x.p) !== "LS" && (x.p.age || 30) <= 31).sort((a, b) => b.val - a.val).slice(0, 2);
    for (const x of exp) {
      const r = x.apy / x.tag;
      out.push({ kind: "tag", p: x.p, y, score: x.val, cap: 0, val: x.val, apy: x.apy, tag: x.tag, ratio: r,
        verdict: r >= 0.85 ? "fair" : r >= 0.6 ? "pricey" : "steep",
        why: "The " + P.tagPos(x.p) + " tag would cost about " + m(x.tag) + " for " + y + " (fully guaranteed), against a market of about " + m(x.apy) + " a year. " +
          (r >= 0.85 ? "Close to his market: a reasonable one-year hold." : r >= 0.6 ? "Pricier than his market, but it keeps him off it while a long-term deal gets done." : "Well above his market: re-signing is the better route.") });
    }
    return out.sort((a, b) => b.score - a.score);
  };
  // Team strength ahead. This season's rating (from the market and results) carries forward only partly; NFL teams
  // regress hard year to year. The rest comes from what's under contract that year (each player's rough value,
  // aging), the draft class, and the cap space left to add talent, priced at about half its face value.
  P.resources = (W, code, y, rating) => {
    let roster = 0, qb = null;
    for (const p of W.players) {
      if (p.t !== code || !p.c || p.st === "DEV") continue;
      const r = p.c.rows[y];
      if (!r || r[C.R.void]) continue;
      const v = P.value(W, p, y); roster += v;
      if (P.group(p) === "QB" && (!qb || v > qb.v)) qb = { p, v };
    }
    let draft = 0;
    if (y > W.season) for (let cls = W.season + 1; cls <= y; cls++) for (const pk of P.picksIn(W, code, cls)) draft += P.rookieCurve(W)[Math.min(262, pk.n)] * (pk.round === 1 ? 1.6 : pk.round <= 3 ? 1.2 : 0.6);
    const ty = C.teamYears(W, code, [], y, y)[0];
    const space = y > W.season ? Math.max(0, ty.space) : 0;
    return { roster, draft, space, qb, total: roster + draft + space * 0.5 };
  };
  P.power = (W, ratings, y) => {
    const codes = Object.keys(ratings), now = y === W.season;
    const res = {}; codes.forEach(c => { res[c] = P.resources(W, c, y); });
    // dollars to points: fit this season's ratings to this season's roster value
    const r0 = {}; codes.forEach(c => { r0[c] = P.resources(W, c, W.season).roster; });
    const mean0 = codes.reduce((a, c) => a + r0[c], 0) / codes.length;
    let sxy = 0, sxx = 0; codes.forEach(c => { const x = r0[c] - mean0; sxy += x * ratings[c]; sxx += x * x; });
    const b = sxx ? sxy / sxx : 0;
    const meanY = codes.reduce((a, c) => a + res[c].total, 0) / codes.length;
    const keep = now ? 1 : y === W.season + 1 ? 0.45 : 0.25;
    const out = codes.map(c => ({ code: c, res: res[c], rating: keep * ratings[c] + (now ? 0 : (1 - keep) * b * (res[c].total - meanY)) }));
    out.sort((a, b2) => b2.rating - a.rating);
    out.forEach((x, i) => { x.rank = i + 1; });
    return out;
  };

  function m(v) { return (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(1) + "M"; }

  if (typeof module !== "undefined" && module.exports) module.exports = P;
  root.NFLPlan = P;
})(typeof window !== "undefined" ? window : globalThis);
