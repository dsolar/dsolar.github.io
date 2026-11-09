/* Banner 19: basketball model. Ratings, aging, contract value, player and front-office decisions, season sim.
   Ratings are impact per 100 possessions (offense + defense) from the 31st Franchise blend (DARKO, RAPM,
   CraftedNBA, box score), aged on Stephen Noh's curve. Contract value is Noh's salary model.
   Depends on CBA (cba.js). No DOM. */
(function (root) {
  "use strict";
  const CBA = root.CBA || (typeof require !== "undefined" ? require("./cba.js") : null);
  const M = {};

  // ---------- Random ----------
  M.rng = seed => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  M.gauss = rng => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  M.phi = x => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- Ratings and aging ----------
  M.r = p => (p.o || 0) + (p.d || 0);
  M.ageStep = a => a < 21 ? 0.65 : ({ 21: 0.5, 22: 0.45, 23: 0.40, 24: 0.10, 25: 0.10, 26: 0.10, 27: 0, 28: 0, 29: -0.05, 30: -0.1, 31: -0.2, 32: -0.3, 33: -0.45, 34: -0.65, 35: -0.9 })[a] ?? -1.2;
  // p.age is his age in the current season (it goes up each summer), so look ahead from the current season
  M.ageIn = (p, i, W) => p.age + (i - (W ? W.season : 0));
  // Expected rating k seasons from now (mean path). Young players move toward their potential.
  M.rAhead = (p, k) => {
    let r = M.r(p), a = p.age;
    for (let j = 0; j < k; j++) {
      if (a <= 25 && p.pot != null && p.pot > r) r += (p.pot - r) * (a <= 21 ? 0.3 : a <= 23 ? 0.25 : 0.2);
      else r += M.ageStep(a + 1);
      a++;
    }
    return r;
  };
  // One offseason of development with noise
  M.develop = (p, rng) => {
    const a = p.age, r = M.r(p);
    let step;
    if (a <= 25 && p.pot != null && p.pot > r) step = (p.pot - r) * (a <= 21 ? 0.3 : a <= 23 ? 0.25 : 0.2);
    else step = M.ageStep(a + 1);
    // young players mostly get better: their bad summers are smaller than their good ones
    const sig = a <= 22 ? 0.6 : a <= 29 ? 0.5 : 0.45;
    let z = M.gauss(rng) * sig;
    if (z < 0 && a <= 23) z *= 0.55;
    const d = step + z;
    p.o = +(p.o + d * 0.6).toFixed(2); p.d = +(p.d + d * 0.4).toFixed(2);
    if (p.pot != null) p.pot = +(Math.max(p.pot + z * 0.5, M.r(p))).toFixed(2);
    p.h = clamp((p.h || 0.85) + (rng() - 0.5) * 0.08 - (a >= 31 ? 0.012 : 0), 0.4, 0.96);
    p.age = a + 1;
    p.lastDev = +d.toFixed(2);
  };
  // Display ratings: league percentile-ish 40-99 scale like the 31st Franchise
  M.ovr = p => clamp(Math.round(70 + 3.6 * M.r(p)), 35, 99);

  // ---------- Contract value (Stephen Noh's salary model, in that season's dollars) ----------
  const CAP_2526 = 154_647_000;
  M.roleMin = r => r >= 4 ? 34 : r >= 2 ? 32 : r >= 1 ? 30 : r >= -0.9 ? 25 : r >= -2 ? 17 : 10;
  M.valueOf = (r, h, i, yos) => {
    const games = Math.min(76, 82 * (h ?? 0.85));
    let v = games * M.roleMin(r) / 1475 * (r + 3) * 4.32e6;
    const boost = Math.min(0.10, Math.pow(Math.abs(r) / 4, 1.2) * 0.10);
    v *= r > 0 ? 1 + boost : r < 0 ? 1 - boost : 1;
    v *= CBA.cap(i) / CAP_2526;
    const floor = CBA.minSal(yos ?? 3, i);
    return Math.max(floor, v < 3e6 * CBA.cap(i) / CAP_2526 ? floor : v);
  };
  M.mv = (p, i, W) => M.valueOf(M.rAhead(p, i - W.season), p.h, i, (p.yos ?? 3) + (i - W.season));
  // ---------- The market (what teams actually pay) ----------
  // A log-linear fit on current veteran contracts (data.cba.market): impact, scoring, minutes and age.
  // Points and minutes come from his real numbers, fading toward what his rating implies as seasons pass.
  const ppgFor = r => clamp(3 + 3.2 * (r + 2), 2, 32) * Math.min(1, M.roleMin(r) / 32);
  M.statLine = (p, i, W) => {
    const r = M.rAhead(p, i - W.season), k = Math.pow(0.7, Math.max(0, i - (p.statSeason ?? 0)));
    const lv = p.live && p.live.gp >= 10 ? p.live : null;
    const ppg0 = lv ? lv.ppg : p.ppg, mpg0 = lv ? lv.mpg : p.mpg;
    const ppg = ppg0 != null ? ppgFor(r) + (ppg0 - ppgFor(M.r(p))) * k : ppgFor(r);
    const mpg = mpg0 != null ? M.roleMin(r) + (mpg0 - M.roleMin(M.r(p))) * k : M.roleMin(r);
    return { r, ppg: Math.max(0, ppg), mpg: clamp(mpg, 0, 38) };
  };
  M.market = (p, i, W) => {
    const b = CBA.D().market, s = M.statLine(p, i, W), age = M.ageIn(p, i, W), yos = (p.yos ?? 3) + i - W.season;
    let share = Math.exp(b[0] + b[1] * Math.max(s.r, -3) + b[2] * s.ppg + b[3] * s.mpg + b[4] * Math.max(0, age - 30) + b[5] * Math.max(0, 25 - age));
    let v = share * CBA.cap(i);
    if (age >= 34) v *= Math.pow(0.85, age - 33);                       // the market fades old players fast
    if (s.r >= 3.2 || (s.r >= 2.5 && s.ppg >= 19)) v = Math.max(v, 0.95 * CBA.maxSal(yos, i));   // stars get the max
    return clamp(v, CBA.minSal(yos, i), CBA.maxSal(yos, i));
  };
  // What a player believes he's worth: the market, with a name premium for players who've been paid like stars
  M.perceived = (p, i, W) => {
    const prior = Math.max(...[W.season - 1, W.season, W.season + 1].map(j => (p.c && p.c.sal && p.c.sal[j]) || 0));
    const yos = (p.yos ?? 3) + i - W.season;
    // an undrafted rookie gets a minimum-level deal his first summer, whatever his rating
    if (p.undrafted && !p.yos && i === W.season) return CBA.minSal(0, i) * 1.15;
    return Math.min(CBA.maxSal(yos, i), Math.max(M.market(p, i, W) * 1.05, 0.15 * prior, CBA.minSal(yos, i)));
  };
  // Stars want long deals into their thirties; role players get shorter ones
  M.faYears = (age, r) => {
    const star = (r ?? 0) >= 2.5, good = (r ?? 0) >= 0.8;
    return age <= 29 ? 4 : age <= 31 ? (star ? 4 : 3) : age <= 33 ? (star ? 3 : 2) : age <= 35 ? (good ? 2 : 1) : 1;
  };
  // Unsigned free agents come down over time: about 1.2% a week, to 60% of the opening ask
  M.askDecay = (p, W) => {
    if (!p.faDate || !W.date) return 1;
    const weeks = Math.max(0, (Date.parse(W.date) - Date.parse(p.faDate)) / 6048e5);
    let k = Math.max(0.6, 1 - 0.012 * weeks);
    // once the season tips off, an unsigned player's price falls fast: most end up taking what's there
    const open = Date.UTC(2026 + (W.season || 0), 9, 20), now = Date.parse(W.date);
    if (now > open && ["reg", "deadline", "reg2"].includes(W.phase)) k *= Math.max(0.4, 0.9 - 0.06 * (now - open) / 6048e5);
    return k;
  };
  // Chance a player keeps playing at a given age
  M.keepsPlaying = (age, r) => age < 34 ? 1 : age >= 41 ? 0.15 : clamp(1 - (age - 33) * 0.12 + (r + 1) * 0.08, 0.1, 1);
  // Expected free-agent haul if he hits the market in season i (sum over the deal he'd get)
  M.faHaul = (p, i, W) => {
    const age = M.ageIn(p, i, W);
    const yrs = M.faYears(age, M.rAhead(p, i - W.season));
    const dk = i === W.season ? M.askDecay(p, W) : 1;
    let tot = 0, alive = 1;
    for (let k = 0; k < yrs; k++) {
      alive *= M.keepsPlaying(age + k, M.rAhead(p, i - W.season + k));
      tot += M.perceived(p, i + k, W) * (k === 0 ? 1 : alive);
    }
    tot *= dk;
    return { total: tot, years: yrs, aav: tot / yrs };
  };

  // ---------- Player decisions ----------
  // Player option for season j at salary s: in if the option beats what the market would give him.
  // happy (0-1): a good team and a real role. Happy players stay when it's close; unhappy ones look around.
  M.playerOptionOdds = (p, j, W, happy = 0.5) => {
    const s = p.c.sal[j] || 0;
    const age = M.ageIn(p, j, W);
    const out = M.faHaul(p, j, W);
    // opting in: the option salary, then the market a year older for the rest of the deal he could get now
    const later = M.faHaul(p, j + 1, W);
    // money a year from now isn't guaranteed (injury, decline, a cooler market), so it's worth less than a deal today
    const laterPart = later.total * (out.years - 1) / Math.max(1, later.years) * M.keepsPlaying(age + 1, M.rAhead(p, j - W.season + 1)) * 0.85;
    const inside = s + laterPart;
    const ratio = out.total / Math.max(1, inside);
    const center = 1.02 + 0.10 * happy;
    const pOut = 1 / (1 + Math.exp(-(ratio - center) / 0.05));
    return { pIn: 1 - pOut, outside: out, inside, laterPart, option: s, happy };
  };
  // A player's view of an offer (re-sign, extension, opt-out deal). Returns acceptance odds.
  // alt: what he expects otherwise, in total dollars. security: older players value guaranteed money.
  M.offerOdds = (offerTotal, alt, age) => {
    const sec = age >= 33 ? 1.08 : age >= 30 ? 1.04 : 1.0;
    const x = (offerTotal * sec - alt) / Math.max(1e6, 0.10 * alt);
    return clamp(1 / (1 + Math.exp(-x)), 0.01, 0.99);
  };
  // "Opt out and re-sign": he declines his option for season j and signs years/total starting in j.
  M.optOutDealOdds = (p, j, years, total, W) => {
    const age = M.ageIn(p, j, W);
    const s = p.c.sal[j] || 0;
    // staying put: the option year, then the market for the remaining years of the proposed term
    let alt = s, alive = 1;
    for (let k = 1; k < years; k++) {
      alive *= M.keepsPlaying(age + k - 2, M.rAhead(p, j - W.season + k));     // players expect to last longer than the odds say
      alt += M.perceived(p, j + k, W) * alive;
    }
    return { odds: M.offerOdds(total, alt, age), alt };
  };
  M.extensionOdds = (p, start, years, total, W) => {
    const age = M.ageIn(p, start, W);
    const fa = M.faHaul(p, start, W);
    // his expected haul over the same term (the market deal, extended at his later value if the offer runs longer)
    let alt = 0;
    for (let k = 0; k < years; k++) alt += k < fa.years ? fa.aav : M.perceived(p, start + k, W) * 0.8;
    return { odds: M.offerOdds(total, alt * 1.03, age), alt };
  };

  // ---------- Team strength ----------
  const MINUTES = [34, 33, 32, 30, 28, 24, 20, 16, 13, 10];
  const REPL = -2.5, SCALE = 0.95, KNEE = 8, KNEE_RATE = 0.5, STAR_K = 0.35;
  M.MINUTES = MINUTES;
  M.knee = v => v <= KNEE ? v : KNEE + (v - KNEE) * KNEE_RATE;
  // Auto rotation: best ten by rating, a guard and a big in the first five when possible
  M.autoRotation = players => {
    const ps = players.slice().sort((a, b) => M.r(b) - M.r(a));
    const cnt = { G: 0, W: 0, B: 0 }, cap = { G: 2, W: 3, B: 2 };
    const five = [];
    for (const p of ps) { const k = p.pos || "W"; if (five.length < 5 && cnt[k] < cap[k]) { five.push(p); cnt[k]++; } }
    for (const p of ps) if (five.length < 5 && !five.includes(p)) five.push(p);
    for (const pos of ["G", "B"]) if (!five.some(p => p.pos === pos)) {
      const sub = ps.find(p => !five.includes(p) && p.pos === pos);
      if (sub) { five.sort((a, b) => M.r(a) - M.r(b)); const out = five.findIndex(p => cnt[p.pos || "W"] > 1); if (out >= 0) { cnt[five[out].pos || "W"]--; five.splice(out, 1, sub); cnt[pos]++; } }
    }
    const bench = ps.filter(p => !five.includes(p));
    // keep a backup guard and big in the first four off the bench
    for (const pos of ["G", "B"]) {
      const k = bench.findIndex(p => p.pos === pos);
      if (k > 3) { const [x] = bench.splice(k, 1); bench.splice(3, 0, x); }
    }
    const order = [...five.sort((a, b) => M.r(b) - M.r(a)), ...bench];
    const mins = {};
    order.forEach((p, k) => { mins[p.id] = MINUTES[k] || 0; });
    return { order: order.map(p => p.id), mins };
  };
  // Minutes by position. Real teams need guards and bigs on the floor; lopsided rotations cost a little.
  M.posMinutes = (players, mins) => { const b = { G: 0, W: 0, B: 0 }; for (const p of players) b[p.pos || "W"] += mins[p.id] || 0; return b; };
  M.posPenalty = b => 0.04 * (Math.max(0, 70 - b.G) + Math.max(0, 50 - b.W) + Math.max(0, 40 - b.B) + Math.max(0, b.B - 100) + Math.max(0, b.G - 140));
  // Raw strength for a set of players and minutes
  M.raw = (players, mins) => {
    let raw = 0, used = 0;
    for (const p of players) {
      const m = mins[p.id] || 0;
      if (!m) continue;
      const r = M.r(p);
      raw += (r + STAR_K * Math.max(0, r - 2)) * m / 48; used += m;
    }
    raw += REPL * Math.max(0, 240 - used) / 48;
    raw -= M.posPenalty(M.posMinutes(players, mins));
    return raw;
  };
  M.netOf = (raw, mean) => M.knee((raw - mean) * SCALE);
  M.winPct = (net, oppNet, home) => M.phi((net - oppNet + (home ? 1.5 : -1.5)) / 12);
  // Wins expected over a season against a list of opponent nets
  M.expWins = (net, oppNets, games = 82) => {
    let s = 0; for (const o of oppNets) s += 0.5 * (M.winPct(net, o, true) + M.winPct(net, o, false));
    return s / oppNets.length * games;
  };

  if (typeof module !== "undefined") module.exports = M; else root.Model = M;
})(typeof window !== "undefined" ? window : globalThis);
