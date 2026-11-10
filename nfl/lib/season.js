/* NFL Hub: team ratings and the rest of the season, simulated.

   Ratings: each team's strength in points against an average team, fit by least squares to two things this season:
   the betting market's point spreads (every game that had a line, weight 1; the market already knows about injuries
   and quarterback changes) and actual scoring margins (weight 0.35), pulled toward zero so a few games don't make a
   team look like a juggernaut. Home field is worth 1.6 points.

   The simulation plays every remaining game 10,000 times: the posted spread where there is one, otherwise the rating
   gap, with a final margin spread of 13.5 points (about how far real results land from the line). Each run also
   nudges every team's rating a little, since we don't know them exactly. Then the playoffs: four division winners
   and three wild cards per conference, the top seed gets the bye, higher seed hosts, and a neutral Super Bowl.
   Ties for a spot break on division record (for division titles) or conference record (wild cards), then a coin flip:
   a simplified version of the NFL's tiebreakers. */
(function (root) {
  "use strict";
  const S = {};
  S.DIV = {
    "AFC East": ["BUF", "MIA", "NE", "NYJ"], "AFC North": ["BAL", "CIN", "CLE", "PIT"], "AFC South": ["HOU", "IND", "JAX", "TEN"], "AFC West": ["DEN", "KC", "LV", "LAC"],
    "NFC East": ["DAL", "NYG", "PHI", "WAS"], "NFC North": ["CHI", "DET", "GB", "MIN"], "NFC South": ["ATL", "CAR", "NO", "TB"], "NFC West": ["ARI", "LAR", "SF", "SEA"]
  };
  S.divOf = {}; S.confOf = {};
  for (const [d, ts] of Object.entries(S.DIV)) for (const t of ts) { S.divOf[t] = d; S.confOf[t] = d.slice(0, 3); }
  const HFA = 1.6, SD = 13.5;
  S.HFA = HFA;
  // Normal CDF
  const Phi = x => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
  S.winProb = (spreadHome) => Phi(spreadHome / SD);

  // games: [type, week, date, away, home, awayScore, homeScore, spread (home favored +), neutral, divGame]
  S.ratings = (games, teams) => {
    const idx = {}; teams.forEach((t, i) => { idx[t] = i; });
    const n = teams.length, A = Array.from({ length: n }, () => new Float64Array(n)), b = new Float64Array(n);
    const add = (h, a, y, w, neutral) => {
      const i = idx[h], j = idx[a]; if (i == null || j == null) return;
      const yy = y - (neutral ? 0 : HFA);
      A[i][i] += w; A[j][j] += w; A[i][j] -= w; A[j][i] -= w; b[i] += w * yy; b[j] -= w * yy;
    };
    for (const g of games) {
      if (g[0] !== "REG") continue;
      if (g[7] != null) add(g[4], g[3], g[7], 1, g[8]);
      if (g[5] != null && g[6] != null) add(g[4], g[3], Math.max(-21, Math.min(21, g[6] - g[5])), 0.35, g[8]);
    }
    for (let i = 0; i < n; i++) A[i][i] += 0.6;                       // pull toward average
    // solve A r = b (Gaussian elimination; small system)
    const M = A.map((row, i) => Array.from(row).concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    const out = {}; teams.forEach((t, i) => { out[t] = M[i][n] / M[i][i]; });
    const mean = teams.reduce((s, t) => s + out[t], 0) / n;
    teams.forEach(t => { out[t] -= mean; });
    return out;
  };

  // Records so far
  S.records = (games, teams) => {
    const R = {}; teams.forEach(t => { R[t] = { w: 0, l: 0, t: 0, dw: 0, dl: 0, cw: 0, cl: 0, pf: 0, pa: 0 }; });
    for (const g of games) {
      if (g[0] !== "REG" || g[5] == null) continue;
      tally(R, g[3], g[4], g[5], g[6], g[9]);
    }
    return R;
  };
  function tally(R, a, h, as, hs, div) {
    const A = R[a], H = R[h]; if (!A || !H) return;
    const conf = S.confOf[a] === S.confOf[h];
    A.pf += as; A.pa += hs; H.pf += hs; H.pa += as;
    if (as === hs) { A.t++; H.t++; if (div) { A.dw += 0.5; A.dl += 0.5; H.dw += 0.5; H.dl += 0.5; } if (conf) { A.cw += 0.5; A.cl += 0.5; H.cw += 0.5; H.cl += 0.5; } return; }
    const W = as > hs ? A : H, L = as > hs ? H : A;
    W.w++; L.l++;
    if (div) { W.dw++; L.dl++; }
    if (conf) { W.cw++; L.cl++; }
  }

  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  S.simulate = (games, teams, opts) => {
    opts = opts || {};
    const sims = opts.sims || 10000, r = rng(opts.seed || 2026), rat = S.ratings(games, teams), base = S.records(games, teams);
    const left = games.filter(g => g[0] === "REG" && g[5] == null);
    const out = {}; teams.forEach(t => { out[t] = { wins: 0, losses: 0, div: 0, playoffs: 0, bye: 0, conf: 0, sb: 0, seeds: new Array(8).fill(0), winDist: new Array(18).fill(0) }; });
    const winP = new Map();                                               // each remaining game's average home win chance
    const pct = rec => (rec.w + 0.5 * rec.t) / Math.max(1, rec.w + rec.l + rec.t);
    for (let s = 0; s < sims; s++) {
      const R = {}, noise = {};
      for (const t of teams) { const b0 = base[t]; R[t] = Object.assign({}, b0); noise[t] = gauss(r) * 1.5; }
      for (const g of left) {
        const a = g[3], h = g[4];
        const sp = g[7] != null ? g[7] + (noise[h] - noise[a]) : rat[h] - rat[a] + (g[8] ? 0 : HFA) + noise[h] - noise[a];
        const p = S.winProb(sp), hw = r() < p;
        if (s === 0) winP.set(g, S.winProb(g[7] != null ? g[7] : rat[h] - rat[a] + (g[8] ? 0 : HFA)));
        tally(R, a, h, hw ? 0 : 1, hw ? 1 : 0, g[9]);
      }
      // seeds
      const seedsBy = {};
      for (const conf of ["AFC", "NFC"]) {
        const winners = [], rest = [];
        for (const [d, ts] of Object.entries(S.DIV)) {
          if (!d.startsWith(conf)) continue;
          const order = ts.slice().sort((x, y) => (pct(R[y]) - pct(R[x])) || ((R[y].dw - R[y].dl) - (R[x].dw - R[x].dl)) || (r() - 0.5));
          winners.push(order[0]); rest.push(...order.slice(1));
          out[order[0]].div++;
        }
        const ord = (x, y) => (pct(R[y]) - pct(R[x])) || ((R[y].cw - R[y].cl) - (R[x].cw - R[x].cl)) || (r() - 0.5);
        winners.sort(ord); rest.sort(ord);
        const seeds = winners.concat(rest.slice(0, 3));
        seeds.forEach((t, i) => { out[t].playoffs++; out[t].seeds[i]++; });
        out[seeds[0]].bye++;
        seedsBy[conf] = seeds;
      }
      // playoffs
      const game = (hi, lo, neutral) => S.winProb(rat[hi] - rat[lo] + noise[hi] - noise[lo] + (neutral ? 0 : HFA)) > r() ? hi : lo;
      const champ = {};
      for (const conf of ["AFC", "NFC"]) {
        const sd = seedsBy[conf];
        let alive = [sd[0], game(sd[1], sd[6]), game(sd[2], sd[5]), game(sd[3], sd[4])];
        alive.sort((x, y) => sd.indexOf(x) - sd.indexOf(y));
        const d1 = game(alive[0], alive[3]), d2 = game(alive[1], alive[2]);
        const [hi, lo] = sd.indexOf(d1) < sd.indexOf(d2) ? [d1, d2] : [d2, d1];
        champ[conf] = game(hi, lo);
        out[champ[conf]].conf++;
      }
      out[game(champ.AFC, champ.NFC, true)].sb++;
      for (const t of teams) { out[t].wins += R[t].w + 0.5 * R[t].t; out[t].losses += R[t].l + 0.5 * R[t].t; out[t].winDist[Math.min(17, Math.round(R[t].w + 0.5 * R[t].t))]++; }
    }
    for (const t of teams) {
      const o = out[t];
      ["wins", "losses", "div", "playoffs", "bye", "conf", "sb"].forEach(k => { o[k] /= sims; });
      o.seeds = o.seeds.map(v => v / sims); o.winDist = o.winDist.map(v => v / sims);
      o.rating = rat[t]; o.rec = base[t];
    }
    return { teams: out, ratings: rat, records: base, winP, left, sims };
  };

  if (typeof module !== "undefined" && module.exports) module.exports = S;
  root.NFLSeason = S;
})(typeof window !== "undefined" ? window : globalThis);
