/* Banner 19: CBA engine. Pure functions over a world state; no DOM.
   Seasons are indexed from 2026-27 = 0. Money is whole dollars.
   Rules follow the 2023 CBA as summarized by the league and by reporters. Where a 2026-27 figure is not
   published (the trade-matching bands), the 2023 amount is grown with the cap and flagged in the UI. */
(function (root) {
  "use strict";
  let D = null;                                     // base constants (data.cba)
  const CBA = {};
  CBA.init = cba => { D = cba; };
  CBA.D = () => D;

  // ---------- Season figures ----------
  const g = i => Math.pow(D.growth, i);
  const k1 = x => Math.round(x / 1000) * 1000;
  CBA.k1 = k1;
  CBA.seasonName = i => `${2026 + i}-${String((27 + i) % 100).padStart(2, "0")}`;
  CBA.line = (k, i) => {
    if (k === "match_low") return i === 0 ? D.match.low : k1(D.match.low * g(i));
    if (k === "match_high") return i === 0 ? D.match.high : k1(D.match.high * g(i));
    return i === 0 ? D[k] : k1(D[k] * g(i));
  };
  CBA.cap = i => CBA.line("cap", i);
  CBA.tax = i => CBA.line("tax", i);
  CBA.a1 = i => CBA.line("a1", i);
  CBA.a2 = i => CBA.line("a2", i);
  CBA.minTeam = i => CBA.line("min_team", i);
  CBA.minSal = (yos, i) => Math.round(D.min_scale[Math.max(0, Math.min(10, yos))] * g(i));
  // A one-year veteran minimum counts as the two-year minimum against the cap and tax (the league pays the rest)
  CBA.minCapHit = (yos, i) => CBA.minSal(Math.min(yos, 2), i);
  CBA.maxPct = yos => yos >= 10 ? D.max_pct[2] : yos >= 7 ? D.max_pct[1] : D.max_pct[0];
  CBA.maxSal = (yos, i) => k1(CBA.cap(i) * CBA.maxPct(yos));
  CBA.cashLimit = i => k1(CBA.cap(i) * 0.0515);
  CBA.rookieY1 = (pick, i) => k1(D.rookie[Math.max(0, Math.min(29, pick - 1))] * 1e6 * g(i));
  // Rookie scale deal starting season i: two guaranteed years, team options on years three and four
  CBA.rookieDeal = (pick, i) => {
    const y1 = CBA.rookieY1(pick, i), y2 = k1(y1 * 1.05), y3 = k1(y2 * 1.048), y4 = k1(y3 * 1.80);
    const sal = []; sal[i] = y1; sal[i + 1] = y2; sal[i + 2] = y3; sal[i + 3] = y4;
    return { sal, opt: { [i + 2]: "TO", [i + 3]: "TO" } };
  };
  // Qualifying offer: first-rounders get a raise over year four that shrinks for top picks; others 125% or min + $200K
  CBA.qualifyingOffer = (p, i) => {
    const prev = (p.c.sal && p.c.sal[i - 1]) || 0;
    if (p.c.rk && p.c.rk[1] > 0) {
      const pick = p.c.rk[1];
      return Math.max(k1(prev * (1.3 + 0.2 * (pick - 1) / 29)), CBA.minSal(p.yos, i) + 200000);
    }
    return Math.max(k1(prev * 1.25), CBA.minSal(p.yos, i) + 200000);
  };

  // ---------- Contracts ----------
  // c.sal[i] salary; c.opt[i] PO, TO, MO or NG; c.dec[i] = "in" | "out" once decided.
  CBA.OPT_NAME = { PO: "Player option", TO: "Team option", MO: "Mutual option", NG: "Non-guaranteed" };
  CBA.OPT_SHORT = { PO: "PO", TO: "TO", MO: "MO", NG: "NG" };
  // decide(p, j, kind) answers options not yet decided (a projection or the user's scenario)
  CBA.optionState = (p, j, decide) => {
    const c = p.c;
    if (!c.opt || !c.opt[j]) return null;
    return (c.dec && c.dec[j]) || (decide ? decide(p, j, c.opt[j]) : "in");
  };
  CBA.salaryIn = (p, i, decide) => {
    const c = p.c;
    if (!c || !c.sal) return 0;
    const s = c.sal[i] || 0;
    if (!s) return 0;
    // a declined option ends the deal for that season and every later one
    for (let j = 0; j <= i; j++) if (c.opt && c.opt[j] && CBA.optionState(p, j, decide) === "out") return 0;
    return s;
  };
  CBA.lastYear = (p, decide, from = 0) => {
    let last = -1;
    for (let i = Math.max(0, from); i < from + 12; i++) if (CBA.salaryIn(p, i, decide) > 0) last = i;
    return last;
  };
  // Trade kicker: 15% of the guaranteed money left, capped by the player's max, added for the acquiring team.
  // Returns the bump for season i (spread evenly over the guaranteed seasons left).
  CBA.kicker = (p, i, decide) => {
    const c = p.c;
    if (!c || !c.kick || c.kickWaived) return 0;
    let rem = 0, room = 0, n = 0;
    for (let j = i; j < i + 6; j++) {
      const s = CBA.salaryIn(p, j, decide);
      if (!s) continue;
      if (c.opt && c.opt[j] && c.opt[j] !== "TO") continue;   // option years don't count
      rem += s; n++; room += Math.max(0, CBA.maxSal(p.yos + (j - i), j) - s);
    }
    if (!n) return 0;
    return k1(Math.min(rem * c.kick, room) / n);
  };

  // Salary shapes. Bird re-signings and extensions may rise or fall by up to 8% of year one a season, others 5%.
  CBA.buildSalaries = (years, total, shape, raise) => {
    const r = shape === "up" ? raise : shape === "down" ? -raise : 0;
    const w = Array.from({ length: years }, (_, k) => 1 + r * k);
    const y1 = total / w.reduce((a, b) => a + b, 0);
    const out = w.map(x => k1(y1 * x));
    out[years - 1] += total - out.reduce((a, b) => a + b, 0);
    return out;
  };
  // Over-38 rule (as written in the 2017 CBA, carried forward): in a deal of four or more seasons, seasons that start
  // after the player turns 38 count as deferred pay spread over the earlier seasons.
  CBA.over38 = (ageAtStart, years) => {
    if (years < 4) return { applies: false, zero: 0 };
    let zero = 0;
    for (let k = 0; k < years; k++) if (ageAtStart + k >= 38) zero++;
    return { applies: zero > 0, zero };
  };
  // Veteran extension limit: year one up to 140% of the larger of his final salary or the extension base,
  // up to five seasons in total counting what's left.
  CBA.extLimit = (p, i) => {
    const last = CBA.lastYear(p, null, i);
    const cur = (p.c.sal && p.c.sal[last]) || 0;
    const base = CBA.line("ext_base", i);
    const years = last - i + 1;
    if (p.c.rk && p.c.rk[1] > 0) return { start: last + 1, first: CBA.maxSal(p.yos + years, last + 1), maxYears: 5, kind: "rookie" };
    return { start: last + 1, first: Math.min(k1(1.4 * Math.max(cur, base)), CBA.maxSal(p.yos + years, last + 1)),
             maxYears: Math.max(0, Math.min(4, 5 - years)), kind: "veteran" };
  };
  CBA.extEligible = (p, i) => {
    const c = p.c;
    if (p.two) return { ok: false, why: "Two-way contract" };
    const last = CBA.lastYear(p, null, i);
    if (last < i) return { ok: false, why: "Not under contract" };
    if (c.rk && c.rk[1] > 0) {
      const fourth = c.rk[0] - 2026 + 3;      // season index of year four
      if (i === fourth) return { ok: true, kind: "rookie", why: "Rookie scale extension window (before his fourth season starts)" };
      if (i < fourth) return { ok: false, why: `Rookie extension window: summer before ${CBA.seasonName(fourth)}` };
    }
    if (c.ext) return { ok: false, why: "Signed an extension in the last year" };
    if (i - (c.signed ?? -2) < 2) return { ok: false, why: `Eligible two years after signing (${CBA.seasonName((c.signed ?? 0) + 2)})` };
    if (last - i >= 4) return { ok: false, why: "Already signed four or more seasons out" };
    if (c.how === "min" && last === i) return { ok: false, why: "One-year minimum deals can't be extended" };
    return { ok: true, kind: "veteran", why: "Eligible for a veteran extension" };
  };

  // ---------- Cap holds ----------
  CBA.birdOf = p => (p.c && (p.c.bird || 0) >= 3) ? "Bird" : (p.c && p.c.bird === 2) ? "Early Bird" : "Non-Bird";
  // Hold for a player whose deal ended after season i-1
  CBA.holdFor = (p, i, prevSal) => {
    const avg = CBA.line("avg", Math.max(0, i - 1));
    const bird = CBA.birdOf(p);
    let pct;
    const rookie = p.c.rk && p.c.rk[1] > 0;
    if (rookie && bird === "Bird") pct = prevSal >= avg ? 2.5 : 3.0;
    else if (bird === "Bird") pct = prevSal >= avg ? 1.5 : 1.9;
    else if (bird === "Early Bird") pct = 1.3;
    else pct = 1.2;
    let amt = Math.min(k1(prevSal * pct), CBA.maxSal(p.yos + 1, i));
    amt = Math.max(amt, CBA.minSal(p.yos + 1, i));
    let qo = 0;
    if (rookie || p.c.rfa) { qo = CBA.qualifyingOffer(p, i); amt = Math.max(amt, qo); }
    return { amt, pct, bird, qo };
  };

  // ---------- Tax ----------
  const rateAt = (b, rates) => b < rates.length ? rates[b] : rates[rates.length - 1] + D.tax_inc * (b - rates.length + 1);
  CBA.taxBill = (payroll, i, repeater) => {
    const over = payroll - CBA.tax(i);
    if (over <= 0) return 0;
    const step = CBA.line("tax_step", i), rates = repeater ? D.tax_rep : D.tax_std;
    let bill = 0, left = over, b = 0;
    while (left > 0) { const chunk = Math.min(step, left); bill += chunk * rateAt(b, rates); left -= chunk; b++; }
    return Math.round(bill);
  };
  CBA.marginalTax = (payroll, i, repeater) => {
    const over = payroll - CBA.tax(i);
    if (over < 0) return 0;
    return rateAt(Math.floor(over / CBA.line("tax_step", i)), repeater ? D.tax_rep : D.tax_std);
  };
  CBA.status = (payroll, i) =>
    payroll > CBA.a2(i) ? "a2" : payroll > CBA.a1(i) ? "a1" : payroll > CBA.tax(i) ? "tax" : payroll > CBA.cap(i) ? "over" : "room";
  CBA.STATUS_NAME = { room: "Under the cap", over: "Over the cap", tax: "In the tax", a1: "Over the first apron", a2: "Over the second apron" };
  CBA.LEVEL_NAME = { cap: "salary cap", tax: "tax line", a1: "first apron", a2: "second apron" };
  CBA.levelAmt = (lvl, i) => lvl === "a1" ? CBA.a1(i) : lvl === "a2" ? CBA.a2(i) : lvl === "tax" ? CBA.tax(i) : CBA.cap(i);

  // ---------- Trade matching ----------
  // Most a team can take back for `out` dollars when it ends the trade over the cap.
  CBA.matchMax = (out, i, post) => {
    if (post === "a1" || post === "a2") return out;              // 100% over the first apron
    const low = CBA.line("match_low", i), high = CBA.line("match_high", i), plus = D.match.plus;
    if (out <= low) return 2 * out + plus;
    if (out <= high) return out + low + plus;
    return Math.floor(1.25 * out) + plus;
  };
  CBA.matchRule = (out, i, post) => {
    if (post === "a1" || post === "a2") return "100% of outgoing (over the first apron)";
    const low = CBA.line("match_low", i), high = CBA.line("match_high", i);
    if (out <= low) return "200% of outgoing + $250K";
    if (out <= high) return `outgoing + ${(low / 1e6).toFixed(1)}M + $250K`;
    return "125% of outgoing + $250K";
  };

  /* Trade structure solver. One team's side of a trade.
     out: [{id, sal}] players sent, inn: [{id, sal}] players received (salary incl. any kicker),
     tpes: [{id, amt, usable, why}] existing exceptions, i: season, post: status after the trade.
     Each incoming player is absorbed by an existing TPE, matched against one outgoing player (a simple
     trade that can leave a TPE), or matched against an aggregated group of two or more outgoing players.
     Outgoing players nobody is matched against leave TPEs worth their full salary.
     Picks the legal structure with the biggest new TPE, then the most new TPE in total. */
  CBA.solveStructure = (out, inn, tpes, i, post, underCapAfter) => {
    if (underCapAfter) return { ok: true, room: true, subs: [], newTpes: [], used: [], expanded: false, aggregated: false };
    const usableT = tpes.filter(t => t.usable);
    const plus = (post === "a1" || post === "a2") ? 0 : D.match.plus;
    const n = out.length, m = inn.length, k = usableT.length;
    if (m > 6 || n > 7) return { ok: false, why: "Too many players to structure (six in, seven out at most)" };
    const targets = k + n + 1;                      // TPEs, single outgoing players, the aggregate pool
    let best = null;
    const asg = new Array(m).fill(0);
    const total = Math.pow(targets, m);
    for (let code = 0; code < total; code++) {
      let x = code;
      for (let a = 0; a < m; a++) { asg[a] = x % targets; x = Math.floor(x / targets); }
      // TPE absorption
      const tIn = new Array(k).fill(0), sIn = new Array(n).fill(0); let poolIn = 0, bad = false;
      for (let a = 0; a < m; a++) {
        const t = asg[a];
        if (t < k) tIn[t] += inn[a].sal; else if (t < k + n) sIn[t - k] += inn[a].sal; else poolIn += inn[a].sal;
      }
      for (let t = 0; t < k; t++) if (tIn[t] > usableT[t].amt + plus) { bad = true; break; }
      if (bad) continue;
      // singles: an outgoing player with incoming matched to him
      let expanded = false;
      const newT = [], singles = new Set();
      for (let s = 0; s < n; s++) {
        if (!sIn[s]) continue;
        singles.add(s);
        if (sIn[s] > CBA.matchMax(out[s].sal, i, post)) { bad = true; break; }
        if (sIn[s] > out[s].sal) expanded = true;
        if (out[s].sal > sIn[s]) newT.push({ amt: out[s].sal - sIn[s], from: out[s].id, partial: true });
      }
      if (bad) continue;
      // free outgoing players: some go into the pool (only if the pool has incoming), the rest leave full TPEs
      const free = []; for (let s = 0; s < n; s++) if (!singles.has(s)) free.push(s);
      const subsets = poolIn > 0 ? (1 << free.length) : 1;
      for (let mask = 0; mask < subsets; mask++) {
        let poolOut = 0, cnt = 0; const pool = [];
        for (let f = 0; f < free.length; f++) if (mask & (1 << f)) { poolOut += out[free[f]].sal; cnt++; pool.push(free[f]); }
        if (poolIn > 0) {
          if (cnt < 2) continue;                    // a pool of one is a single (covered above)
          if (poolIn > CBA.matchMax(poolOut, i, post)) continue;
        }
        const nt = newT.slice();
        for (const f of free) if (!pool.includes(f) && out[f].sal > 0) nt.push({ amt: out[f].sal, from: out[f].id });
        const exp = expanded || (poolIn > poolOut);
        const agg = poolIn > 0 && cnt >= 2;
        if (agg && post === "a2") continue;          // second-apron teams can't aggregate
        const big = nt.reduce((a, t) => Math.max(a, t.amt), 0), sum = nt.reduce((a, t) => a + t.amt, 0);
        const usedAmt = tIn.reduce((a, b) => a + b, 0);
        // score: biggest TPE, then total TPE, then avoid hard-cap triggers, then save existing TPE room
        const score = big * 1e3 + sum - (exp ? 5e5 : 0) - (agg ? 5e5 : 0) - usedAmt * 1e-3;
        if (!best || score > best.score) {
          best = {
            score, ok: true, expanded: exp, aggregated: agg, newTpes: nt.sort((a, b) => b.amt - a.amt),
            used: usableT.map((t, j) => ({ id: t.id, amt: tIn[j] })).filter(u => u.amt > 0),
            subs: [
              ...[...singles].map(s => ({ out: [out[s].id], outSal: out[s].sal, in: inn.filter((_, a) => asg[a] === k + s).map(p => p.id), inSal: sIn[s] })),
              ...(poolIn > 0 ? [{ out: pool.map(f => out[f].id), outSal: poolOut, in: inn.filter((_, a) => asg[a] === k + n).map(p => p.id), inSal: poolIn, agg: true }] : []),
              ...usableT.map((t, j) => tIn[j] > 0 ? { tpe: t.id, tpeAmt: t.amt, in: inn.filter((_, a) => asg[a] === j).map(p => p.id), inSal: tIn[j] } : null).filter(Boolean)
            ]
          };
        }
      }
    }
    if (!best) {
      const outSal = out.reduce((a, p) => a + p.sal, 0), inSal = inn.reduce((a, p) => a + p.sal, 0);
      const max = CBA.matchMax(outSal, i, post);
      const blocked = tpes.filter(t => !t.usable && t.why).map(t => `its ${(t.amt / 1e6).toFixed(1)}M trade exception is off-limits (${t.why.toLowerCase()})`);
      const why = post === "a2" && n > 1
        ? "Over the second apron after this trade, so it can't combine salaries, and no single player matches."
        : n === 0
          ? `Takes on $${(inSal / 1e6).toFixed(2)}M without sending salary back, and ${blocked.length ? blocked.join("; ") : "has no trade exception big enough"}.`
          : `Takes back $${(inSal / 1e6).toFixed(2)}M but can only take back $${(max / 1e6).toFixed(2)}M for $${(outSal / 1e6).toFixed(2)}M out (${CBA.matchRule(outSal, i, post)}).${blocked.length ? " Also, " + blocked.join("; ") + "." : ""}`;
      return { ok: false, why, max, outSal, inSal };
    }
    return best;
  };

  // ---------- Stepien rule: a team can't be without a first-round pick in consecutive future drafts ----------
  CBA.stepien = (firstsByYear, fromYear) => {
    for (let y = fromYear; y < fromYear + 6; y++) {
      if (!(firstsByYear[y] > 0) && !(firstsByYear[y + 1] > 0)) return { ok: false, why: `No first-round pick in ${y} or ${y + 1} (Stepien rule)` };
    }
    return { ok: true };
  };

  if (typeof module !== "undefined") module.exports = CBA; else root.CBA = CBA;
})(typeof window !== "undefined" ? window : globalThis);
