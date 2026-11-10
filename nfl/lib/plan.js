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
  // player rating (on-field plus-minus and this season's production, below), aged forward for future seasons, then
  // blended 70/30 with the market's own verdict, his contract (a rookie deal says nothing about quality, so rookies
  // get only the first part).
  const aging = (g, k) => Math.max(0.2, 1 - Math.max(0, k - PEAK[g]) * AGE_FALL[g]);
  // His rating's multiplier in a future season: this season's, grown for young players still short of their
  // position's peak (+0.1 standard deviations a year, up to the peak) and cut by the position's aging rate for each
  // year past it (compounding). This season's rating already reflects how he plays at his current age, so only the years ahead move it.
  const GROW = 0.1;
  const zAt = (W, p, y) => {
    const g = P.group(p), q = P.quality(W, p), n = y - W.season;
    if (n <= 0) return q.z;
    const a0 = p.age || 26, ay = a0 + n;
    const grow = GROW * Math.max(0, Math.min(ay, PEAK[g]) - a0);
    const past = Math.max(0, ay - Math.max(a0, PEAK[g]));          // years ahead that fall past his peak
    return (1 + 0.45 * (q.z + grow)) * Math.pow(1 - AGE_FALL[g], past) / 0.45 - 1 / 0.45;
  };
  P.multAt = (W, p, y) => y <= W.season ? P.quality(W, p).mult : Math.max(0.3, Math.min(2.3, 1 + 0.45 * zAt(W, p, y)));
  // The same thing on the rating's own scale (standard deviations; 50 + 15z on screen)
  P.ratingZ = (W, p, y) => Math.max(-3, Math.min(3.25, zAt(W, p, y)));
  P.PEAK = PEAK;
  P.value = (W, p, y, shareOverride) => {
    const g = P.group(p), sh = shareOverride != null ? shareOverride : P.share(W, p), age = (p.age || 26) + (y - W.season);
    const role = W.price[g] * Math.pow(sh, 1.25) * P.multAt(W, p, y);
    if (P.rookieDeal(p) || !p.c || !p.c.apy) return role;
    const grown = p.c.apy * Math.pow(1.07, Math.max(0, W.season - (p.c.signed || W.season)));
    const own = grown * Math.min(1, sh / 0.6) * aging(g, age) / aging(g, p.age || 26);
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
      // one standard deviation per unit again (part-timers keep their shrink toward average; never stretched more than 2x).
      // The two parts get the same stretch, so on the player card they average to the overall.
      const reg = ps.filter(p => { const o = raw[p.id]; return (o.onN || 0) >= 400 || (o.prodN || 0) >= (o.prodK || 1) * 3; }).map(p => z[p.id].zz);
      let sd = 1;
      if (reg.length >= 8) { const m = reg.reduce((a, v) => a + v, 0) / reg.length; sd = Math.max(0.5, Math.sqrt(reg.reduce((a, v) => a + (v - m) * (v - m), 0) / reg.length)) || 1; }
      for (const p of ps) {
        const q = z[p.id], zz = q.zz / sd;
        z[p.id] = { z: Math.max(-3, Math.min(3.25, zz)), zon: q.zon == null ? null : q.zon / sd, zpr: q.zpr == null ? null : q.zpr / sd, mult: Math.max(0.3, Math.min(2.3, 1 + 0.45 * zz)) };
      }
    }
    W.quality = z;
  };
  P.quality = (W, p) => (W.quality && W.quality[p.id]) || { z: 0, mult: 1, zon: null, zpr: null };
  // Market price for an extension: the APY at the rank his value implies among players at his position
  // His next contract, from comparable deals: veterans at his position who signed in the last three years (no rookie
  // deals), nearest to him in rating, age at signing and playing time (starters compared with starters). The average per year leans 70/30 on what they
  // got (grown with the cap) and on his own value that season (60/25/15 for a veteran, with his last deal as the third part); years and the guaranteed share are theirs, with years
  // capped by age (one year at 33 or older, two at 31-32, three at 30). y is the first season of the new deal.
  // His healthy role: this season's snap share, or a starter's if he's first on the depth chart or was a regular over the
  // last two seasons (injured stars shouldn't be priced as backups)
  P.role = (W, q) => {
    W._role = W._role || {};
    if (W._role[q.id] != null) return W._role[q.id];
    const r = W.rating && W.rating.p[q.id], plays = r ? Math.max(r[2], r[3]) : 0;
    return (W._role[q.id] = Math.min(1, Math.max(P.share(W, q), P.depthRank(W, q) === 1 ? 0.8 : 0, plays >= 600 ? 0.8 : 0)));
  };
  P.contract = (W, p, y) => {
    W._ce = W._ce || {};
    const key = p.id + ":" + y;
    if (W._ce[key]) return W._ce[key];
    const role = q => P.role(W, q);
    const g = P.group(p), age = (p.age || 26) + (y - W.season), z = P.ratingZ(W, p, y), sh = role(p);
    if (!W._pool) {
      W._pool = {};
      for (const q of W.players) {
        const c = q.c;
        if (!c || !c.apy || !c.signed || c.signed < W.season - 3 || /Drafted|Rookie/i.test(c.type || "") || P.rookieDeal(q) || !(c.yrs >= 1)) continue;
        (W._pool[P.group(q)] = W._pool[P.group(q)] || []).push(q);
      }
    }
    let cands = (W._pool[g] || []).filter(q => q.id !== p.id);
    const sameRole = cands.filter(q => Math.abs(role(q) - sh) <= 0.3);       // starters with starters, backups with backups
    if (sameRole.length >= 6) cands = sameRole;
    const pool = cands.map(q => {
      const qa = (q.age || 26) - (W.season - q.c.signed);
      const d = Math.hypot((P.quality(W, q).z - z) / 0.4, (qa - age) / 2.5, (role(q) - sh) / 0.3);
      return { q, d, qa };
    }).sort((a, b) => a.d - b.d).slice(0, 6);
    let wsum = 0, lap = 0, yrs = [], gs = 0;
    for (const x of pool) {
      const w = 1 / (0.3 + x.d), c = x.q.c;
      wsum += w; lap += w * Math.log(c.apy * Math.pow(1.07, y - c.signed));
      yrs.push([c.yrs, w]); gs += w * Math.min(1, (c.gtd || 0) / (c.value || c.apy * c.yrs));
    }
    const min = C.minSalary(p.exp || 0, y) * Math.pow(1.07, 0);
    const compApy = wsum ? Math.exp(lap / wsum) : P.value(W, p, y, sh);
    const v = Math.max(min, P.value(W, p, y, sh));
    // a veteran's last deal anchors the talks a little (aged forward with him)
    const vet = p.c && p.c.apy && !P.rookieDeal(p) ? p.c.apy * Math.pow(1.07, y - (p.c.signed || W.season)) * P.multAt(W, p, y) / P.quality(W, p).mult : null;
    let apy = Math.max(min, vet ? Math.exp(0.6 * Math.log(compApy) + 0.25 * Math.log(v) + 0.15 * Math.log(Math.max(min, vet))) : Math.exp(0.7 * Math.log(compApy) + 0.3 * Math.log(v)));
    yrs.sort((a, b) => a[0] - b[0]);
    let acc = 0, ny = 1; for (const [n, w] of yrs) { acc += w; if (acc >= wsum / 2) { ny = n; break; } }
    ny = Math.max(1, Math.min(ny, age >= 33 ? 1 : age >= 31 ? 2 : age >= 30 ? 3 : 5));
    const gshare = wsum ? gs / wsum : 0.3, total = apy * ny;
    const out = { apy, yrs: ny, total, gtd: Math.min(total, total * gshare), comps: pool.slice(0, 4).map(x => ({ id: x.q.id, n: x.q.n, t: x.q.t, age: Math.floor(x.qa), signed: x.q.c.signed, yrs: x.q.c.yrs, apy: x.q.c.apy, gtd: x.q.c.gtd })) };
    return (W._ce[key] = out);
  };
  P.extensionApy = (W, p, y) => P.contract(W, p, y).apy;

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
  // Where each team is expected to pick in a draft (1-32 within a round). Next year's draft: the season sim's average
  // slot, with a 10th-90th percentile range. The year after: from that season's projected power ranking (worst first).
  P.slots = (W, y) => {
    W._slots = W._slots || {};
    if (W._slots[y]) return W._slots[y];
    const out = {};
    if (y === W.season + 1 && W.sim) {
      for (const [t, o] of Object.entries(W.sim.teams)) {
        let c = 0, lo = 1, hi = 32;
        for (let k = 1; k <= 32; k++) { c += o.pickDist[k] || 0; if (c < 0.1) lo = k + 1; if (c < 0.9) hi = k + 1; }
        out[t] = { slot: o.pick, lo: Math.min(lo, 32), hi: Math.min(hi, 32) };
      }
    } else if (W.sim && y <= W.season + 3) {
      const ratings = {}; for (const [t, o] of Object.entries(W.sim.teams)) ratings[t] = o.rating;
      const pw = P.power(W, ratings, y - 1);
      pw.forEach(x => { const sl = 33 - x.rank; out[x.code] = { slot: sl, lo: Math.max(1, sl - 10), hi: Math.min(32, sl + 10), rough: true }; });
    }
    return (W._slots[y] = out);
  };
  // The picks a team has in a draft. Next year's: the Big Board's order (Tankathon, by today's records) for who owns
  // what, with the expected spot from the sim. Later years: every team's own seven, less picks it has traded away and
  // plus picks it holds from others (the Big Board's list of future picks owed).
  P.picksIn = (W, code, y) => {
    const order = (W.draft && W.draft.picks) || [], sl = P.slots(W, y);
    const at = (from, round, fallback) => sl[from] ? Math.round((round - 1) * 32 + sl[from].slot) : fallback;
    if (y === W.season + 1) {
      const first = {}, seen = {};
      order.forEach(x => { if (first[x[1]] == null) first[x[1]] = x[0]; });
      return order.filter(x => x[3] === code).map(x => {
        const regular = !seen[x[1] + x[2]] && (seen[x[1] + x[2]] = 1) && x[0] - first[x[1]] < 32;
        const s = regular ? sl[x[2]] : null;
        return { n: x[0], en: s ? Math.round(first[x[1]] + s.slot - 1) : x[0], lo: s ? first[x[1]] + s.lo - 1 : null, hi: s ? first[x[1]] + s.hi - 1 : null, round: x[1], from: x[2], comp: !regular,
          k: s ? Math.round(s.slot) : Math.min(32, x[0] - first[x[1]] + 1), klo: s ? s.lo : null, khi: s ? s.hi : null };   // k: spot within the round
      });
    }
    const owed = ((W.future && W.future.owed) || []).filter(o => o[1] === y);
    const out = [];
    for (let rd = 1; rd <= 7; rd++) {
      const gone = owed.find(o => o[0] === code && o[2] === rd);
      if (!gone || gone[4] === "swap") out.push({ round: rd, from: code, est: true });
    }
    owed.filter(o => o[0] !== code && o[3].split("/").includes(code)).forEach(o => out.push({ round: o[2], from: o[0], est: true, cond: o[4] === "cond" || o[3].includes("/") }));
    out.forEach(pk => { const s = sl[pk.from]; pk.en = pk.n = at(pk.from, pk.round, (pk.round - 1) * 32 + 16); pk.k = s ? Math.round(s.slot) : 16; if (s) { pk.lo = (pk.round - 1) * 32 + s.lo; pk.hi = (pk.round - 1) * 32 + s.hi; pk.klo = s.lo; pk.khi = s.hi; pk.rough = true; } });
    return out.sort((a, b) => a.en - b.en);
  };
  // Picks a team has traded away in a draft (who holds them)
  P.picksOut = (W, code, y) => {
    if (y === W.season + 1) {
      const order = (W.draft && W.draft.picks) || [];
      return order.filter(x => x[2] === code && x[3] !== code).map(x => ({ n: x[0], round: x[1], to: x[3] }));
    }
    return ((W.future && W.future.owed) || []).filter(o => o[1] === y && o[0] === code && o[4] !== "swap").map(o => ({ round: o[2], to: o[3], cond: o[4] }));
  };
  // Cap a team's draft classes take in a year: each pick's rookie cap hit, less the minimum salary of the player he
  // pushes off the top 51 (how Over The Cap's "effective cap space" counts it)
  P.rookieCost = (W, code, y) => {
    let tot = 0, list = [];
    for (let cls = W.season + 1; cls <= Math.min(y, W.season + 3); cls++) {
      const k = y - cls; if (k > 3) continue;
      const grow = Math.pow(1.07, cls - W.season), curve = P.rookieCurve(W);
      for (const pk of P.picksIn(W, code, cls)) {
        const hit = curve[Math.min(262, pk.en || pk.n)] * grow * [0.85, 0.95, 1.05, 1.15][k];
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
          const est = P.contract(W, p, y + 1), apy = est.apy, ext = C.effect(p, { kind: "extend", year: y, years: est.yrs, apy, lowerNow: true });
          out.push({ kind: "extend", p, y, score: val * 1.2, cap, val, apy, years: est.yrs, est, now: -(ext.delta[y] || 0),
            why: "Last year of his deal. Comparable deals point to " + est.yrs + " year" + (est.yrs > 1 ? "s" : "") + ", " + m(est.total) + " (" + m(apy) + " a year, " + m(est.gtd) + " guaranteed), which " + ((ext.delta[y] || 0) < 0 ? "would lower this year's cap by " + m(-(ext.delta[y] || 0)) + " if his base is folded into the bonus." : "keeps this year's cap about the same.") });
        }
      }
      if (last === y - 1 && share >= 0.6) {
        const tag = P.tagPrice(W, p, y), est = P.contract(W, p, y), apy = est.apy;
        out.push({ kind: "expiring", p, y, score: val, cap: 0, val, apy, tag, est, years: est.yrs,
          why: "Deal ends after " + (y - 1) + ". Re-signing likely takes about " + est.yrs + " year" + (est.yrs > 1 ? "s" : "") + ", " + m(est.total) + " (" + m(apy) + " a year, " + m(est.gtd) + " guaranteed)." });
      }
    }
    // Franchise tag: only real candidates. A starter (60%+ of snaps) rated 60 or better for next season, 30 or younger,
    // at a position that gets tagged, whose market is at least 65% of the tag (otherwise he'd never be tagged: a
    // long-term deal is far cheaper). At most two per team.
    const cand = out.filter(x => x.kind === "expiring" && !/^(K|P|LS)$/.test(P.group(x.p)) && (x.p.age || 30) + 1 <= 30.99 &&
      P.ratingZ(W, x.p, y) >= 0.67 && x.apy >= 0.65 * x.tag).sort((a, b) => b.val - a.val).slice(0, 2);
    for (const x of cand) {
      const r = x.apy / x.tag, est = P.contract(W, x.p, y);
      out.push({ kind: "tag", p: x.p, y, score: x.val, cap: 0, val: x.val, apy: x.apy, tag: x.tag, ratio: r, est,
        verdict: r >= 0.9 ? "fair" : "pricey",
        why: "The " + P.tagPos(x.p) + " tag would cost about " + m(x.tag) + " for " + y + ", fully guaranteed. His market: about " + est.yrs + " year" + (est.yrs > 1 ? "s" : "") + ", " + m(est.total) + " (" + m(est.apy) + " a year, " + m(est.gtd) + " guaranteed). " +
          (r >= 0.9 ? "The tag is close to his market, so it's a reasonable one-year hold." : "The tag costs more than his market for a year, but it keeps him off the market while a long-term deal gets done.") });
    }
    return out.sort((a, b) => b.score - a.score);
  };
  // ---------- trade value: what picks it takes to get a player ----------
  // Draft picks in points on a modern trade chart (No. 1 = 1000, No. 10 about 470, No. 32 about 210, No. 64 about 90,
  // No. 100 about 40), the shape teams' recent pick-for-pick trades follow. A pick a year out is worth 85% of its
  // expected spot.
  P.pickPoints = (n, yearsOut) => 1000 * Math.exp(-0.2 * Math.pow(Math.max(1, n) - 1, 0.6)) * Math.pow(0.85, yearsOut || 0);
  P.pickForPoints = pts => { if (pts >= 1000) return 1; let lo = 1, hi = 262; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (P.pickPoints(mid) >= pts) lo = mid; else hi = mid; } return lo; };
  // A player in the same points. The trade market pays for talent above what's easy to find: his position's starter
  // price, times his healthy role, times how far his rating multiplier sits above a replacement-level player's (a
  // rating of about 38), over the next three seasons with aging. Seasons he's under contract count fully; seasons
  // after, 60% (the new team gets first crack at re-signing him, but at market price). Then the contract: each
  // season under contract adds 60% of what his market price (from comparable deals) exceeds what he's paid, or takes
  // away 60% of what he's overpaid (veteran deals at their average per year, since back-loaded cap numbers are rarely all paid).
  // Quarterbacks carry a 40% premium on top: they go for more picks than their salaries alone suggest (Stafford,
  // Wilson, Watson). Calibrated so top receivers land where A.J. Brown, Davante Adams and Tyreek Hill did: a first
  // plus a day-two pick, 350-450 points.
  const TV_PTS = 9, TV_DISC = 0.85, REPL = 0.64, AFTER = 0.6, TV_SUR = 0.6, QB_PREMIUM = 1.4;
  P.tradeValue = (W, p, y) => {
    y = y || W.season + 1;
    const g = P.group(p), last = C.lastYear(p) || W.season, rows = [];
    const healthy = P.role(W, p);
    const est = P.contract(W, p, Math.max(y, last + 1));
    let talent = 0, surplus = 0;
    for (let i = 0; i < 3; i++) {
      const yy = y + i, d = Math.pow(TV_DISC, i);
      const under = yy <= last && p.c && p.c.rows[yy] && !p.c.rows[yy][C.R.void];
      const above = W.price[g] * Math.pow(healthy, 1.25) * Math.max(0, P.multAt(W, p, yy) - REPL);
      const market = P.contract(W, p, yy).apy;
      const cost = !under ? market : P.rookieDeal(p) ? C.capHit(p, yy) : Math.min(C.capHit(p, yy), (p.c.apy || 0));
      talent += d * above * (under ? 1 : AFTER) * (g === "QB" ? QB_PREMIUM : 1);
      if (under) surplus += d * TV_SUR * (market - cost);
      rows.push({ y: yy, above, market, cost, under });
    }
    const dollars = talent + surplus;
    return { pts: dollars * TV_PTS, dollars, talent, surplus, rows, last, est, freeAgent: last < y };
  };
  // A points total as picks: the single pick it matches, or above the No. 1 pick, No. 1 plus what's left
  P.pointsAsPicks = pts => {
    const out = []; let left = pts;
    while (left > 15 && out.length < 4) { const n = P.pickForPoints(Math.min(1000, left)); out.push(n); left -= P.pickPoints(n); if (pts < 1000) break; }
    return out;
  };
  // Plain-English name for a pick number
  P.pickLabel = n => n === 1 ? "the No. 1 pick" : n <= 3 ? "a top-3 pick" : n <= 10 ? "a top-10 pick" : n <= 21 ? "a mid first" : n <= 32 ? "a late first" : n <= 48 ? "an early second" : n <= 64 ? "a late second" :
    n <= 100 ? "a third" : n <= 140 ? "a fourth" : n <= 180 ? "a fifth" : n <= 220 ? "a sixth" : "a seventh";
  // The cheapest ways a team could pay it from its own picks (this draft and next): every set of up to four picks (six
  // for the biggest prices)
  // worth at least 95% of the target, ranked by how little they overpay (and fewer picks first)
  P.packages = (W, code, pts) => {
    const pool = [];
    [W.season + 1, W.season + 2].forEach((yr, k) => P.picksIn(W, code, yr).forEach(pk => pool.push(Object.assign({ yr, pts: P.pickPoints(pk.en, k) }, pk))));
    pool.sort((a, b) => b.pts - a.pts);
    const MAXP = pts > 700 ? 6 : 4, top = pool.slice(0, pts > 700 ? 12 : 14), out = [];
    const rec = (i, chosen, sum) => {
      if (sum >= pts * 0.95) { out.push({ picks: chosen.slice(), sum }); return; }
      if (chosen.length >= MAXP || i >= top.length) return;
      for (let j = i; j < top.length; j++) { chosen.push(top[j]); rec(j + 1, chosen, sum + top[j].pts); chosen.pop(); }
    };
    if (pts > 0) rec(0, [], 0);
    const score = x => Math.abs(x.sum / pts - 1) + 0.05 * x.picks.length;
    out.sort((a, b) => score(a) - score(b));
    // a few different shapes: the closest fit, one without this year's first, one that leans on next year
    const pick = [], seen = new Set();
    const add = x => { if (!x) return; const k = x.picks.map(q => q.yr + ":" + q.en).join(","); if (!seen.has(k)) { seen.add(k); pick.push(x); } };
    add(out[0]);
    add(out.find(x => !x.picks.some(q => q.yr === W.season + 1 && q.round === 1)));
    add(out.find(x => x.picks.filter(q => q.yr === W.season + 2).length >= x.picks.length / 2));
    add(out.find(x => x.picks.length === 1));
    return { list: pick.slice(0, 4), pool, enough: pool.reduce((a, q) => a + q.pts, 0) >= pts * 0.95 };
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
    if (y > W.season) for (let cls = W.season + 1; cls <= y; cls++) for (const pk of P.picksIn(W, code, cls)) draft += P.rookieCurve(W)[Math.min(262, pk.en || pk.n)] * (pk.round === 1 ? 1.6 : pk.round <= 3 ? 1.2 : 0.6);
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
