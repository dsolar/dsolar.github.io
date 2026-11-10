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
    // each year ahead past his peak takes the position's aging rate; from four years past it, the fall speeds up
    // (twice the rate plus 4 points a year): late-career decline is steep at every position
    let keep = 1;
    for (let a = Math.floor(a0); a < Math.floor(ay); a++) if (a >= PEAK[g]) keep *= a >= PEAK[g] + 4 ? 1 - (2 * AGE_FALL[g] + 0.04) : 1 - AGE_FALL[g];
    return (1 + 0.45 * (q.z + grow)) * Math.max(0.05, keep) / 0.45 - 1 / 0.45;
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
    // a regular from the last two seasons counts as a starter only if he's on injured reserve, or off the depth chart
    // and missing most of this season (not if he's listed as a backup)
    const dr = P.depthRank(W, q), missed = q.st === "RES" || dr >= 4 && (!q.snaps || q.snaps[3] <= Math.max(2, ((W.week || 10) - 1) * 0.4));
    return (W._role[q.id] = Math.min(1, Math.max(P.share(W, q), dr === 1 ? 0.8 : 0, plays >= 600 && missed ? 0.8 : 0)));
  };
  P.contract = (W, p, y, roleOverride) => {
    W._ce = W._ce || {};
    const key = p.id + ":" + y + ":" + (roleOverride || "");
    if (W._ce[key]) return W._ce[key];
    const role = q => P.role(W, q);
    const g = P.group(p), age = (p.age || 26) + (y - W.season), z = P.ratingZ(W, p, y), sh = roleOverride || role(p);
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
      // value at his healthy role (an injured starter isn't a cut candidate); core special teamers aren't valued by
      // the model at all, so they're left out of cut and trade ideas
      const r = p.c.rows[y], g = P.group(p), share = P.share(W, p), val = P.value(W, p, y, P.role(W, p));
      const stOnly = /^(K|P|LS)$/.test(g) || (p.snaps && p.snaps[2] >= 0.35 && Math.max(p.snaps[0], p.snaps[1]) < 0.3);
      const last = C.lastYear(p);
      if (r && !r[C.R.void]) {
        const cap = r[C.R.cap], cut = C.effect(p, { kind: "cut", year: y }), june = C.effect(p, { kind: "cutJune", year: y }), tr = C.effect(p, { kind: "trade", year: y });
        const saveCut = -(cut.delta[y] || 0), saveJune = -(june.delta[y] || 0), saveTrade = -(tr.delta[y] || 0);
        const over = cap - val;
        if (!stOnly && cap >= 3 && saveCut >= Math.max(2.5, cap * 0.45) && over > Math.max(2, cap * 0.25)) {
          out.push({ kind: "cut", p, y, score: saveCut + over, cap, val, save: saveCut, saveJune, dead: cut.dead[y] || 0, deadNext: june.dead[y + 1] || 0,
            why: (C.guaranteeLeft(p, y) < 0.1 ? "No guarantees left. " : "") + "Saves " + m(saveCut) + " (" + m(saveJune) + " after June 1) against " + m(cut.dead[y] || 0) + " dead; value about " + m(val) + " for a " + m(cap) + " cap number." });
        }
        if (!stOnly && saveTrade >= Math.max(3, saveCut + 3) && cap >= 8 && over > 2) {
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
  // season under contract adds 60% of what his market price (from comparable deals) exceeds what the new team would
  // pay him (his cap number less the bonus proration, which stays behind in a trade), or takes away 35% of what he's
  // overpaid (teams discount pricey deals less than the math says: they're trading for the player).
  // Quarterbacks carry a 10% premium on top, and the contract bonus is capped at half the talent value, which puts
  // prime starters near three firsts and older ones near two (Watson, Wilson, Stafford). Calibrated so top receivers land where A.J. Brown, Davante Adams and Tyreek Hill did: a first
  // plus a day-two pick, 350-450 points.
  const TV_PTS = 9, TV_DISC = 0.85, REPL = 0.64, AFTER = 0.6, TV_SUR = 0.6, TV_OVER = 0.35, QB_PREMIUM = 1.1, TV_CURVE = 2.0;
  // when: "now" (before this season's trade deadline: the rest of this season, then two more), "pre" or "post" (the
  // next offseason, before or after June 1: the next three seasons). The June 1 choice only moves the old team's dead
  // money, not what he's worth.
  P.tradeValue = (W, p, when) => {
    when = when || "pre";
    const now = when === "now", g = P.group(p), last = C.lastYear(p) || W.season, rows = [];
    const left = now ? P.seasonLeft(W) : 1;
    const years = now ? [W.season, W.season + 1, W.season + 2] : [W.season + 1, W.season + 2, W.season + 3];
    const wts = now ? [left, 0.92, 0.78] : [1, TV_DISC, TV_DISC * TV_DISC];
    const healthy = P.role(W, p);
    const est = P.contract(W, p, Math.max(years[0], last + 1));
    let talent = 0, surplus = 0;
    years.forEach((yy, i) => {
      const d = wts[i];
      const under = yy <= last && p.c && p.c.rows[yy] && !p.c.rows[yy][C.R.void];
      // convex (squared): the market pays far more for stars than for average starters, normalized at a good starter
      // (~70); seasons after his deal count less as he ages past his peak, and not at all six years past it
      const x = Math.max(0, P.multAt(W, p, yy) - REPL), above = W.price[g] * Math.pow(healthy, 1.25) * Math.pow(x, TV_CURVE) / Math.pow(1.1, TV_CURVE - 1);
      const ageThen = (p.age || 26) + (yy - W.season), afterW = ageThen <= PEAK[g] + 4 ? AFTER : ageThen <= PEAK[g] + 6 ? AFTER / 2 : 0;
      const market = P.contract(W, p, yy).apy;
      // what the new team pays: his cap number less the signing-bonus proration, which stays with the old team
      const r = under ? p.c.rows[yy] : null, cost = !under ? market : Math.max(0, r[C.R.cap] - r[C.R.pr]);
      talent += d * above * (under ? 1 : afterW) * (g === "QB" ? QB_PREMIUM : 1);
      if (under) surplus += d * (market >= cost ? TV_SUR : TV_OVER) * (market - cost);
      rows.push({ y: yy, w: d, above, market, cost: under && i === 0 && now ? cost * left : cost, under });
    });
    // a cheap contract helps, but never more than half again what his play is worth: teams trade for the player
    surplus = Math.min(surplus, 0.5 * talent);
    const dollars = talent + surplus;
    return { pts: dollars * TV_PTS, dollars, talent, surplus, rows, last, est, when, freeAgent: !now && last < years[0], rental: now && last === W.season };
  };
  // Share of this season still to play (from the league file's week)
  P.seasonLeft = W => Math.max(0, Math.min(1, (18 - ((W.week || 10) - 1)) / 18));
  // The money on both sides of a trade, by season. Old team: the bonus proration still to come becomes dead money
  // (all of it at once now or before June 1; after June 1, this year's share now and the rest next year), and his
  // cap numbers come off. New team: his salary from then on (the rest of this season's, if now).
  P.tradeMoney = (W, p, buyer, when) => {
    const now = when === "now", y0 = now ? W.season : W.season + 1, left = now ? P.seasonLeft(W) : 1;
    const last = C.lastYear(p) || W.season, rows = [], R_ = C.R;
    const yrs = []; for (let y = y0; y <= Math.min(last, y0 + 4); y++) if (p.c.rows[y] && !p.c.rows[y][R_.void]) yrs.push(y);
    const prLeft = Object.keys(p.c.rows).map(Number).filter(y => y >= y0).reduce((a, y) => a + p.c.rows[y][R_.pr], 0);
    const prNow = when === "post" ? p.c.rows[y0] ? p.c.rows[y0][R_.pr] : 0 : prLeft, prNext = prLeft - prNow;
    const space = {}; C.teamYears(W, buyer, [], W.season, W.season + 4).forEach(x => { space[x.y] = x.space; });
    const sspace = {}; C.teamYears(W, p.t, [], W.season, W.season + 4).forEach(x => { sspace[x.y] = x.space; });
    for (let y = y0; y <= Math.max(y0 + 1, yrs[yrs.length - 1] || y0); y++) {
      const r = p.c.rows[y], cap = r && !r[R_.void] ? r[R_.cap] : 0, pr = r ? r[R_.pr] : 0;
      const paid = r && !r[R_.void] ? Math.max(0, cap - pr) * (y === W.season ? left : 1) : 0;
      const dead = y === y0 ? prNow : y === y0 + 1 ? prNext : 0;
      // old team: this season's cap number stays except the salary still to be paid; later seasons it all comes off
      // old team's cap change: this season (now) it sheds the salary still to be paid but takes the later proration
      // early; otherwise it sheds the whole cap number and takes the dead money
      const saves = y === W.season ? paid - (prLeft - pr) : cap - dead;
      rows.push({ y, buyerAdds: paid, buyerSpace: space[y], sellerDead: dead, sellerSaves: saves, sellerSpace: sspace[y] });
    }
    return { rows, y0 };
  };
  // A points total as picks: the single pick it matches, or above the No. 1 pick, No. 1 plus what's left
  P.pointsAsPicks = pts => {
    const out = []; let left = pts;
    while (left > 15 && out.length < 4) { const n = P.pickForPoints(Math.min(1000, left)); out.push(n); left -= P.pickPoints(n); if (pts < 1000) break; }
    return out;
  };
  // A price in round terms. Up to about the No. 12 pick it's one pick ("a late second, about No. 50"); above that,
  // how many average firsts and seconds it adds up to ("two firsts and a second"), the way big trades are described.
  P.roundAvg = r => { let t = 0; for (let n = (r - 1) * 32 + 1; n <= r * 32; n++) t += P.pickPoints(n); return t / 32; };
  P.priceText = pts => {
    const words = ["no", "a", "two", "three", "four", "five", "six"];
    if (pts <= 15) return { short: "Nothing", long: "next to nothing", single: 262 };
    if (pts <= P.pickPoints(12)) { const n = P.pickForPoints(pts); return { short: P.pickLabel(n).replace(/^an? /, "").replace(/^\w/, c => c.toUpperCase()), long: P.pickLabel(n) + (n > 1 ? " (about No. " + n + ")" : ""), single: n }; }
    const a1 = P.roundAvg(1), a2 = P.roundAvg(2), a3 = P.roundAvg(3);
    let n1 = Math.floor(pts / a1), rem = pts - n1 * a1;
    if (rem > 0.75 * a1) { n1++; rem = 0; }
    let n2 = Math.floor(rem / a2), rem2 = rem - n2 * a2;
    if (rem2 > 0.6 * a2) { n2++; rem2 = 0; }
    const n3 = n2 === 0 && rem2 > 0.6 * a3 ? 1 : 0;
    const part = (k, one, many) => k === 1 ? "a " + one : (words[k] || k) + " " + many;
    const bits = [part(n1, "first", "firsts")]; if (n2) bits.push(part(n2, "second", "seconds")); if (n3) bits.push("a third");
    const long = bits.length > 1 ? bits.slice(0, -1).join(", ") + " and " + bits[bits.length - 1] : bits[0];
    return { short: [n1 + (n1 === 1 ? " first" : " firsts")].concat(n2 ? [n2 + (n2 === 1 ? " second" : " seconds")] : []).concat(n3 ? ["a third"] : []).join(" + "), long, firsts: n1, seconds: n2 };
  };

  // ---------- team needs ----------
  // For a season: each position group's starters under contract that year (his healthy role decides who starts,
  // his rating that season, aging included, how good), with empty starting spots filled at replacement level. The
  // group's grade is where that lands among the 32 teams; a need is a weak group, weighted by how much the position
  // matters (quarterback most, running back least).
  const IMP = { QB: 1.6, OT: 1.2, EDGE: 1.2, WR: 1.1, CB: 1.1, IDL: 1.0, IOL: 0.9, S: 0.85, LB: 0.8, TE: 0.8, RB: 0.6 };
  P.NEED_GROUPS = Object.keys(IMP);
  P.needs = (W, y) => {
    y = y || W.season + 1;
    W._needs = W._needs || {};
    if (W._needs[y]) return W._needs[y];
    const teams = {}, byG = {};
    const codes = [...new Set(W.players.map(p => p.t).filter(Boolean))];
    for (const code of codes) {
      const mine = W.players.filter(p => p.t === code && p.c && P.NEED_GROUPS.includes(P.group(p)));
      const T = { groups: {}, top: [] };
      for (const g of P.NEED_GROUPS) {
        const k = STARTERS[g], all = mine.filter(p => P.group(p) === g);
        const signed = all.filter(p => (C.lastYear(p) || 0) >= y && p.st !== "DEV" || P.rookieDeal(p) && (C.lastYear(p) || 0) >= y);
        const ranked = signed.map(p => ({ p, z: P.ratingZ(W, p, y), role: P.role(W, p) })).sort((a, b) => (b.role >= 0.4 ? b.z : b.z - 1.2) - (a.role >= 0.4 ? a.z : a.z - 1.2));
        const st = ranked.slice(0, k), filled = st.filter(x => x.role >= 0.4 || x.z > 0).length;
        const zs = st.map(x => x.role >= 0.4 || x.z > 0 ? x.z : Math.min(x.z, -0.6)); while (zs.length < k) zs.push(-1);
        const mean = zs.reduce((a, v) => a + v, 0) / k;
        const leaving = all.filter(p => (C.lastYear(p) || 0) === y - 1 && P.role(W, p) >= 0.5).sort((a, b) => P.role(W, b) - P.role(W, a));
        const old = st.filter(x => (x.p.age || 26) + (y - W.season) >= PEAK[g] + 3).map(x => x.p);
        T.groups[g] = { mean, starters: st, filled, k, leaving, old };
        (byG[g] = byG[g] || []).push(mean);
      }
      teams[code] = T;
    }
    for (const g of P.NEED_GROUPS) byG[g].sort((a, b) => a - b);
    W._needArr = W._needArr || {}; W._needArr[y] = byG;
    for (const code of codes) {
      const T = teams[code];
      for (const g of P.NEED_GROUPS) {
        const G = T.groups[g], arr = byG[g], below = arr.filter(v => v < G.mean - 1e-9).length / Math.max(1, arr.length - 1);
        G.pct = below; G.grade = below >= 0.8 ? "A" : below >= 0.6 ? "B" : below >= 0.4 ? "C" : below >= 0.2 ? "D" : "F";
        G.score = IMP[g] * (0.5 - G.mean) + (G.k - G.filled) * 0.25 * IMP[g];
        const bits = [];
        if (G.leaving.length) bits.push(G.leaving.slice(0, 2).map(p => p.n).join(" and ") + (G.leaving.length > 2 ? " and others" : "") + " can be free agent" + (G.leaving.length > 1 ? "s" : ""));
        if (G.filled < G.k) bits.push((G.filled ? "only " + G.filled + " of " + G.k : "no") + " starter" + (G.k > 1 ? "s" : "") + " signed for " + y);
        const weak = G.starters.filter(x => x.role >= 0.4 && x.z < -0.3).sort((a, b) => a.z - b.z)[0];
        if (weak) bits.push(weak.p.n + " rates " + Math.round(50 + 15 * weak.z));
        if (G.old.length) bits.push(G.old[0].n + " will be " + Math.floor((G.old[0].age || 30) + (y - W.season)));
        const best = G.starters.filter(x => x.role >= 0.4)[0];
        G.why = bits.length ? bits.join("; ") : best ? "starters average " + Math.round(50 + 15 * G.mean) + " (best: " + best.p.n + ", " + Math.round(50 + 15 * best.z) + ")" : "no proven starter";
      }
      T.top = P.NEED_GROUPS.map(g => Object.assign({ g }, T.groups[g])).filter(x => x.grade === "D" || x.grade === "F" || x.score > 0.9).sort((a, b) => b.score - a.score).slice(0, 4);
    }
    return (W._needs[y] = teams);
  };
  // A position group's strength from any list of players ({z, role}): the same starter pick and empty-spot rule as
  // the needs, and its grade against the league's other teams that season
  P.groupMean = (g, list) => {
    const k = STARTERS[g];
    const ranked = list.slice().sort((a, b) => (b.role >= 0.4 ? b.z : b.z - 1.2) - (a.role >= 0.4 ? a.z : a.z - 1.2)).slice(0, k);
    const zs = ranked.map(x => x.role >= 0.4 || x.z > 0 ? x.z : Math.min(x.z, -0.6)); while (zs.length < k) zs.push(-1);
    return { mean: zs.reduce((a, v) => a + v, 0) / k, starters: ranked };
  };
  P.gradeOf = (W, y, g, mean) => {
    P.needs(W, y);
    const arr = W._needArr[y][g], below = arr.filter(v => v < mean - 1e-9).length / Math.max(1, arr.length - 1);
    return { pct: below, grade: below >= 0.8 ? "A" : below >= 0.6 ? "B" : below >= 0.4 ? "C" : below >= 0.2 ? "D" : "F" };
  };
  P.IMP = IMP;

  // Teams that need a player at his position and can afford him in a season (need in their top three, cap space for
  // his price), best fits first
  P.fits = (W, p, y, price) => {
    const g = P.group(p), N = P.needs(W, y), out = [];
    for (const [code, T] of Object.entries(N)) {
      if (code === p.t) continue;
      const i = T.top.findIndex(x => x.g === g);
      if (i < 0 || i > 2) continue;
      const sp = C.teamYears(W, code, [], y, y)[0].space;
      if (price != null && sp < price * 0.8) continue;
      out.push({ code, rank: i, score: T.top[i].score, space: sp });
    }
    return out.sort((a, b) => a.rank - b.rank || b.score - a.score);
  };
  // Likely cap casualties for a season: every cut idea league-wide, marked likely when the cut saves most of his cap
  // number, he's paid well past his value, and his team is tight on room or has better options
  P.casualties = (W, y) => {
    y = y || W.season + 1;
    const out = [], codes = [...new Set(W.players.map(p => p.t).filter(Boolean))];
    for (const code of codes) {
      const sp = C.teamYears(W, code, [], y, y)[0].space;
      for (const s of P.suggest(W, code, y)) {
        if (s.kind !== "cut" && s.kind !== "trade") continue;
        const ratio = s.save / Math.max(1, s.cap), over = (s.cap - s.val) / Math.max(1, s.cap), age = (s.p.age || 27) + (y - W.season);
        const lik = ratio * 0.5 + over * 0.6 + (sp < 10 ? 0.15 : 0) + (age >= PEAK[P.group(s.p)] + 3 ? 0.1 : 0);
        out.push(Object.assign({}, s, { team: code, space: sp, lik, label: lik >= 0.75 ? "Likely" : lik >= 0.55 ? "Possible" : "Long shot" }));
      }
    }
    return out.sort((a, b) => b.lik - a.lik);
  };

  // Plain-English name for a pick number
  P.pickLabel = n => n === 1 ? "the No. 1 pick" : n <= 3 ? "a top-3 pick" : n <= 10 ? "a top-10 pick" : n <= 21 ? "a mid first" : n <= 32 ? "a late first" : n <= 48 ? "an early second" : n <= 64 ? "a late second" :
    n <= 100 ? "a third" : n <= 140 ? "a fourth" : n <= 180 ? "a fifth" : n <= 220 ? "a sixth" : "a seventh";
  // Every pick a team owns in the next two drafts, with its points at its expected spot (next year's at 85%)
  P.pickPool = (W, code) => {
    const pool = [];
    [W.season + 1, W.season + 2].forEach((yr, k) => P.picksIn(W, code, yr).forEach(pk => pool.push(Object.assign({ yr, key: code + ":" + yr + ":" + pk.round + ":" + pk.from + ":" + pk.en, pts: P.pickPoints(pk.en, k) }, pk))));
    return pool.sort((a, b) => b.pts - a.pts);
  };
  // The offer that lands closest to the price: up to five of the buyer's picks, with up to two of the seller's coming
  // back to even it out. Fewer picks win ties.
  P.bestOffers = (W, buyer, seller, pts) => {
    const B = P.pickPool(W, buyer), S = P.pickPool(W, seller), out = [];
    if (pts <= 0) return { list: [], B, S };
    const top = B.slice(0, 14), back = [[]];
    S.slice(0, 16).forEach((a, i) => { back.push([a]); S.slice(i + 1, 16).forEach(b => back.push([a, b])); });
    const bsum = x => x.reduce((a, q) => a + q.pts, 0);
    back.forEach(x => { x.sum = bsum(x); });
    back.sort((a, b) => a.sum - b.sum);
    const consider = (chosen, sum) => {
      const gap = sum - pts;                                   // how much the buyer is over
      let best = null;
      for (const x of back) {
        if (x.length && x.sum > gap + pts * 0.05) break;       // coming back can't exceed what he's over (by much)
        const err = Math.abs(gap - x.sum) / pts + 0.04 * (chosen.length + x.length);
        if (!best || err < best.err) best = { err, back: x };
      }
      out.push({ give: chosen.slice(), sum, back: best.back, net: sum - best.back.sum, err: best.err });
    };
    const rec = (i, chosen, sum) => {
      if (chosen.length && sum >= pts * 0.9) consider(chosen, sum);
      if (chosen.length >= 5 || i >= top.length || sum > pts * 1.6) return;
      for (let j = i; j < top.length; j++) { chosen.push(top[j]); rec(j + 1, chosen, sum + top[j].pts); chosen.pop(); }
    };
    rec(0, [], 0);
    out.sort((a, b) => a.err - b.err);
    const list = [], seen = new Set();
    const add = x => { if (!x) return; const k = x.give.map(q => q.key).join() + "|" + x.back.map(q => q.key).join(); if (!seen.has(k)) { seen.add(k); list.push(x); } };
    add(out[0]);
    add(out.find(x => !x.give.some(q => q.yr === W.season + 1 && q.round === 1)));
    add(out.find(x => !x.back.length));
    add(out.find(x => x.give.filter(q => q.yr === W.season + 2).length > x.give.length / 2));
    return { list: list.slice(0, 4), B, S, short: !out.length };
  };

  // ---------- the offseason simulator ----------
  // Rookies' first-season rating by pick (most start below average) and how much they play
  P.rookieZ = n => Math.max(-1.2, Math.min(0.6, 0.6 - 0.32 * Math.log(Math.max(1, n))));
  P.rookieRole = round => round === 1 ? 0.8 : round === 2 ? 0.6 : round === 3 ? 0.4 : 0.2;
  const BB_POS = { DL: ["IDL"], "OT/IOL": ["OT", "IOL"], "S/CB": ["S", "CB"], "LB/EDGE": ["LB", "EDGE"], WR: ["WR"], CB: ["CB"], EDGE: ["EDGE"], QB: ["QB"], OT: ["OT"], S: ["S"], RB: ["RB"], LB: ["LB"], IOL: ["IOL"], TE: ["TE"] };
  P.bbGroups = pos => BB_POS[pos] || [pos];
  // Who each team would keep among its own free agents: starters worth at least 85% of their market, 31 or younger
  P.keeps = (W, p, y) => P.role(W, p) >= 0.5 && (p.age || 30) + (y - W.season) <= 31.99 && P.value(W, p, y, P.role(W, p)) >= 0.85 * P.contract(W, p, y).apy;
  // The free agent market for a season: every expiring player his team wouldn't keep, plus likely cap casualties
  P.market = (W, y) => {
    W._mkt = W._mkt || {};
    if (W._mkt[y]) return W._mkt[y];
    const out = W.players.filter(p => p.c && p.st !== "DEV" && C.lastYear(p) === y - 1 && !P.keeps(W, p, y)).map(p => ({ p, from: p.t, cut: false }));
    P.casualties(W, y).filter(x => x.label === "Likely" && x.kind === "cut").forEach(x => out.push({ p: x.p, from: x.team, cut: true }));
    return (W._mkt[y] = out);
  };
  // A mock draft of next year's class: picks in expected order; each team takes the best player on the Big Board's
  // consensus within a few spots of the top who fits one of its top three needs, otherwise the best one left. Past
  // the board, a generic prospect at its top need.
  P.mockDraft = (W, y, needsFor) => {
    const order = ((W.draft && W.draft.picks) || []).map(x => x.slice());
    const sl = P.slots(W, y), first = {};
    order.forEach(x => { if (first[x[1]] == null) first[x[1]] = x[0]; });
    const key = x => { const s = sl[x[2]]; return x[0] - first[x[1]] < 32 && s ? (x[1] - 1) * 32 + s.slot : x[0]; };
    order.sort((a, b) => a[1] - b[1] || key(a) - key(b));
    const board = ((W.board) || []).slice().sort((a, b) => a.rank - b.rank), taken = new Set(), out = [];
    const left = {}, got = {};                                // each team's needs, crossed off as it fills them
    order.forEach((x, i) => {
      const owner = x[3];
      const done = (got[owner] = got[owner] || []);
      if (!left[owner] || !left[owner].length) {               // out of needs: the next groups it hasn't drafted yet
        left[owner] = (needsFor(owner) || []).concat(["LB", "CB", "S", "IDL", "EDGE", "OT", "IOL", "WR", "TE", "RB"]).filter((g, k, a) => a.indexOf(g) === k && !done.includes(g)).slice(0, 4);
      }
      const needs = left[owner].slice(0, 3);
      const avail = board.filter(b => !taken.has(b.id)), top = avail.slice(0, 6);
      let pick = top.find(b => P.bbGroups(b.pos).some(g => needs.includes(g)));
      if (!pick) pick = top.find(b => !P.bbGroups(b.pos).some(g => done.includes(g))) || avail[0];   // best left, not a position it already took
      if (pick) taken.add(pick.id);
      const g = pick ? (P.bbGroups(pick.pos).find(q => needs.includes(q)) || P.bbGroups(pick.pos)[0]) : (needs[0] || ["LB", "CB", "S", "IDL", "EDGE", "WR"][i % 6]);
      const at = left[owner].indexOf(g); if (at >= 0) left[owner].splice(at, 1);
      got[owner].push(g);
      out.push({ n: i + 1, round: x[1], owner, from: x[2], prospect: pick || null, g });
    });
    return out;
  };
  // Run one team's offseason. opts: moves (the planner's moves for that season), cuts, resign, tag (follow the model
  // on each), fa (how many free agents to sign at most), draft (draft for needs), ban (players not to sign)
  P.simulateOffseason = (W, code, opts) => {
    opts = opts || {};
    const y = W.season + 1, moves = (opts.moves || []).filter(m => m.year === y).map(m => Object.assign({}, m));
    const ban = new Set(opts.ban || []), log = { user: moves.slice(), cuts: [], resigned: [], tagged: [], walked: [], signed: [], drafted: [] };
    const ratings = {}; if (W.sim) for (const [t, o] of Object.entries(W.sim.teams)) ratings[t] = o.rating;
    const before = { space: C.teamYears(W, code, [], y, y)[0].space, power: null, groups: {} };
    const N0 = P.needs(W, y)[code];
    P.NEED_GROUPS.forEach(g => { before.groups[g] = { mean: N0.groups[g].mean, grade: N0.groups[g].grade }; });
    const byId = id => W.byId[id];
    const gone = new Set(moves.filter(m => /^(cut|trade)/.test(m.kind)).map(m => m.id));
    const kept = new Set(moves.filter(m => m.kind === "tag" || m.kind === "resign").map(m => m.id));
    // 1. the model's cuts
    if (opts.cuts) P.casualties(W, y).filter(x => x.team === code && x.kind === "cut" && x.label === "Likely" && !gone.has(x.p.id) && !kept.has(x.p.id)).forEach(x => {
      moves.push({ kind: "cut", id: x.p.id, year: y }); gone.add(x.p.id); log.cuts.push({ p: x.p, save: x.save, dead: x.dead });
    });
    // 2. tags and re-signings of its own free agents
    const expiring = W.players.filter(p => p.t === code && p.c && C.lastYear(p) === y - 1 && p.st !== "DEV" && !kept.has(p.id));
    if (opts.tag) P.suggest(W, code, y).filter(s => s.kind === "tag").forEach(s => {
      if (kept.has(s.p.id)) return;
      moves.push({ kind: "tag", id: s.p.id, year: y, amount: s.tag }); kept.add(s.p.id); log.tagged.push({ p: s.p, amount: s.tag });
    });
    let space = () => C.teamYears(W, code, moves, y, y)[0].space;
    expiring.filter(p => !kept.has(p.id)).sort((a, b) => P.value(W, b, y) - P.value(W, a, y)).forEach(p => {
      const e = P.contract(W, p, y);
      if (opts.resign && P.keeps(W, p, y) && space() - e.apy > 5) { moves.push({ kind: "resign", id: p.id, year: y, apy: e.apy, years: e.yrs }); kept.add(p.id); log.resigned.push({ p, est: e }); }
      else if (P.role(W, p) >= 0.4) log.walked.push({ p, est: e });
    });
    // the roster as it stands: under contract for the season, or kept, and not cut or traded
    const roster = {};
    P.NEED_GROUPS.forEach(g => { roster[g] = []; });
    W.players.filter(p => p.t === code && p.c && !gone.has(p.id) && ((C.lastYear(p) || 0) >= y || kept.has(p.id)) && P.NEED_GROUPS.includes(P.group(p)))
      .forEach(p => roster[P.group(p)].push({ p, z: P.ratingZ(W, p, y), role: P.role(W, p) }));
    const needOrder = () => P.NEED_GROUPS.map(g => { const gm = P.groupMean(g, roster[g]); return { g, mean: gm.mean, score: IMP[g] * (0.5 - gm.mean) }; }).sort((a, b) => b.score - a.score);
    // 3. free agency: the signing that lifts a top need the most per dollar, while room lasts (keeping $5M spare)
    let faSpend = 0;
    const pool = P.market(W, y).filter(x => x.p.t !== code && !ban.has(x.p.id));
    for (let k = 0; k < (opts.fa || 0); k++) {
      const top = needOrder().slice(0, 4).filter(x => x.score > 0), room = space() - faSpend - 5;
      let best = null;
      for (const x of pool) {
        const g = P.group(x.p); if (!top.find(t => t.g === g)) continue;
        if (log.signed.find(s => s.p.id === x.p.id)) continue;
        const z = P.ratingZ(W, x.p, y), role = Math.max(0.6, P.role(W, x.p));
        const e = P.contract(W, x.p, y, role); if (e.apy * 0.8 > room) continue;           // priced as the starter he'd be
        const now = P.groupMean(g, roster[g]).mean, after = P.groupMean(g, roster[g].concat([{ p: x.p, z, role }])).mean;
        const gain = (after - now) * IMP[g];
        if (gain <= 0.02) continue;
        const sc = gain / Math.pow(e.apy + 2, 0.5);
        if (!best || sc > best.sc) best = { x, e, z, role, g, gain, sc };
      }
      if (!best) break;
      roster[best.g].push({ p: best.x.p, z: best.z, role: best.role });
      faSpend += best.e.apy * 0.8;
      log.signed.push({ p: best.x.p, from: best.x.from, cut: best.x.cut, est: best.e, g: best.g });
    }
    // 4. the draft, with this team's needs after free agency
    if (opts.draft) {
      const mine = needOrder().filter(x => x.score > 0).map(x => x.g);
      const md = P.mockDraft(W, y, t => t === code ? mine : (P.needs(W, y)[t].top.map(x => x.g)));
      md.filter(x => x.owner === code).forEach(x => {
        const z = P.rookieZ(x.n), role = P.rookieRole(x.round);
        roster[x.g].push({ p: null, z, role, rookie: x });
        log.drafted.push(x);
      });
    }
    const after = { space: space() - faSpend, groups: {} };
    P.NEED_GROUPS.forEach(g => { const gm = P.groupMean(g, roster[g]); after.groups[g] = Object.assign({ mean: gm.mean, starters: gm.starters }, P.gradeOf(W, y, g, gm.mean)); });
    // power ranking: what's left on the roster, the cap room left, at the same dollars-to-points scale
    if (W.sim) {
      const val = p => P.value(W, p, y, P.role(W, p));
      const dRoster = log.signed.reduce((a, s) => a + val(s.p), 0) + log.resigned.concat(log.tagged).reduce((a, s) => a + val(s.p), 0) - log.cuts.reduce((a, s) => a + val(s.p), 0) -
        log.user.filter(m => /^(cut|trade)/.test(m.kind)).reduce((a, m) => a + (byId(m.id) && byId(m.id).c.rows[y] ? val(byId(m.id)) : 0), 0);
      const pw0 = P.power(W, ratings, y), pw1 = P.power(W, ratings, y, { [code]: { roster: dRoster, space: after.space - before.space } });
      before.power = pw0.find(x => x.code === code); after.power = pw1.find(x => x.code === code);
    }
    return { y, before, after, log, moves, faSpend };
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
  P.power = (W, ratings, y, adj) => {
    const codes = Object.keys(ratings), now = y === W.season;
    const res = {}; codes.forEach(c => { res[c] = Object.assign({}, P.resources(W, c, y)); const a = adj && adj[c]; if (a) { res[c].roster += a.roster || 0; res[c].space = Math.max(0, res[c].space + (a.space || 0)); res[c].total = res[c].roster + res[c].draft + res[c].space * 0.5; } });
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
