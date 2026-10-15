/* Banner 19: transactions and the season. Extends League (league.js). No DOM. */
(function (root) {
  "use strict";
  const CBA = root.CBA || require("./cba.js");
  const Mo = root.Model || require("./model.js");
  const L = root.League || require("./league.js");
  const sum = a => a.reduce((s, x) => s + x, 0);
  const M$ = L.M$;
  const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const addMonths = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, 10); };
  L.addDays = addDays;
  const news = (W, text, kind = "move", team) => { W.news.unshift({ d: W.date, text, kind, team: team || null }); if (W.news.length > 400) W.news.length = 400; };
  L.news = news;
  const rng = W => { W.rs = (W.rs || W.seed * 2654435761) >>> 0; return () => { W.rs = (W.rs + 0x6D2B79F5) >>> 0; let t = W.rs; t = Math.imul(t ^ t >>> 15, 1 | t); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  L.rng = rng;

  // ================= Transactions =================
  L.applyTrade = (W, tr) => {
    const chk = L.checkTrade(W, tr);
    const i = W.season, dec = L.decider(W);
    const codes = [tr.a, tr.b];
    for (const code of codes) {
      const other = codes.find(c => c !== code), t = W.T[code], r = chk.teams[code];
      // exceptions used, exceptions created
      if (r.sol && r.sol.used) for (const u of r.sol.used) {
        const tp = t.tpes.find(x => x.id === u.id); if (tp) tp.amt = Math.max(0, tp.amt - u.amt);
      }
      t.tpes = t.tpes.filter(x => x.amt > 250000);
      if (r.sol && r.sol.newTpes) for (const nt of r.sol.newTpes) {
        if (nt.amt < 250000) continue;
        t.tpes.push({ id: "tpe-" + code + "-" + (W.tick + 1) + "-" + nt.from, amt: nt.amt, from: W.P[nt.from].n, made: W.date, exp: addDays(addMonths(W.date, 12), 0), season: i, snt: !!(tr.snt && tr.snt[nt.from]) });
      }
      if (r.newHard) { t.hard[i] = r.newHard; (t.hardWhy || (t.hardWhy = {}))[i] = `A ${L.fmtDate(W.date)} trade that ${r.newHard === "a1" ? "took back more salary than it sent" : "combined salaries or sent cash"}`; }
      const side = tr.side[code] || {};
      if (side.cash) { t.cash = t.cash || {}; t.cash[i] = t.cash[i] || { in: 0, out: 0 }; t.cash[i].out += side.cash; const o = W.T[other]; o.cash = o.cash || {}; o.cash[i] = o.cash[i] || { in: 0, out: 0 }; o.cash[i].in += side.cash; }
    }
    // players move (sign-and-trades sign first), kickers paid, picks change hands
    for (const code of codes) {
      const other = codes.find(c => c !== code), side = tr.side[code] || { players: [], picks: [] };
      for (const id of side.players) {
        const p = W.P[id];
        if (tr.snt && tr.snt[id]) {
          const s = tr.snt[id];
          p.c = { sal: [], opt: {}, dec: {}, signed: i, bird: p.c.bird || 3, how: "snt" };
          s.sal.forEach((x, k) => { p.c.sal[i + k] = x; });
          p.rights = null;
        } else if (!(tr.kickWaive || {})[id]) {
          const bump = CBA.kicker(p, i, dec);
          if (bump) for (let j = i; j < i + 6; j++) if (CBA.salaryIn(p, j, dec) && !(p.c.opt[j] && p.c.opt[j] !== "TO")) p.c.sal[j] += bump;
        }
        if (code === "BOS") { delete W.plan.resign[id]; for (const k of Object.keys(W.plan.opt)) if (k.startsWith(id + "@")) delete W.plan.opt[k]; delete W.plan.renounce[id]; }
        p.t = other;
        p.acq = W.date;
      }
      for (const pid of side.picks || []) { const pk = W.picks.find(x => x.id === pid); if (pk) pk.owner = other; }
    }
    const names = c => (tr.side[c].players.map(id => W.P[id].n).concat((tr.side[c].picks || []).map(id => L.pickName(W, id)))).join(", ") || "nothing";
    news(W, `${W.T[tr.a].name} trade ${names(tr.a)} to ${W.T[tr.b].name} for ${names(tr.b)}.`, "trade", tr.a === "BOS" || tr.b === "BOS" ? "BOS" : null);
    L.bump(W);
    return chk;
  };
  L.pickName = (W, id) => {
    const pk = W.picks.find(x => x.id === id); if (!pk) return id;
    return `${pk.y} ${pk.r === 1 ? "first" : "second"} (${pk.from})`;
  };

  // Extensions: new seasons added after his current deal
  L.extend = (W, code, id, years, total, shape) => {
    const p = W.P[id], i = W.season, lim = CBA.extLimit(p, i);
    const sal = CBA.buildSalaries(years, total, shape, 0.08);
    sal.forEach((x, k) => { p.c.sal[lim.start + k] = x; });
    const prev = p.c.sal[lim.start - 1] || 0;
    p.c.ext = true; p.c.signed = i;
    if (sal[0] > prev * 1.05 && lim.kind === "veteran") p.noTrade = addMonths(W.date, 6);
    news(W, `${W.T[code].name} extend ${p.n}: ${years} years, ${M$(total)} from ${CBA.seasonName(lim.start)}.`, "sign", code);
    L.bump(W);
  };
  // Signing a free agent (or re-signing your own)
  L.sign = (W, code, id, years, total, shape, via) => {
    const p = W.P[id], i = W.season, t = W.T[code];
    const raise = via === "bird" ? 0.08 : 0.05;
    const sal = CBA.buildSalaries(years, total, shape, raise);
    const own = p.rights && p.rights.team === code;
    p.c = { sal: [], opt: {}, dec: {}, signed: i, bird: own ? (p.c.bird || 3) : 1, how: via, rk: p.c && p.c.rk && own ? p.c.rk : null };
    sal.forEach((x, k) => { p.c.sal[i + k] = x; });
    if (via === "min" && years === 1) p.c.sal[i] = Math.min(p.c.sal[i], CBA.minCapHit(p.yos, i));
    p.t = code; p.rights = null; p.two = false;
    p.tradeOk = L.inSeason(W) ? addMonths(W.date, 3) : `${2026 + i}-12-15`;
    t.used[i] = t.used[i] || {};
    if (["ntmle", "tmle", "bae", "rmle"].includes(via)) t.used[i][via] = (t.used[i][via] || 0) + sal[0];
    if (via === "room") t.used[i].room = true;
    const hardLvl = via === "bae" ? "a1" : via === "ntmle" && (sal[0] > CBA.line("tmle", i) || years >= 3) ? "a1" : via === "tmle" ? "a2" : null;
    if (hardLvl && (!t.hard[i] || hardLvl === "a1")) { t.hard[i] = hardLvl; (t.hardWhy || (t.hardWhy = {}))[i] = `Used the ${({ bae: "bi-annual exception", ntmle: "non-taxpayer mid-level", tmle: "taxpayer mid-level" })[via]} on ${p.n}`; }
    // the cap hold comes off the books when he signs
    t.holds = t.holds.filter(h => h.id !== id);
    news(W, `${t.name} ${own ? "re-sign" : "sign"} ${p.n}: ${years} year${years > 1 ? "s" : ""}, ${M$(total)}${via === "min" ? " (minimum)" : ""}.`, "sign", code);
    L.bump(W);
  };
  // Waive: remaining guaranteed money becomes dead money; stretch spreads it over twice the years left plus one
  L.waive = (W, code, id, stretch) => {
    const p = W.P[id], i = W.season, t = W.T[code], dec = L.decider(W);
    const rem = [];
    for (let j = i; j < i + 8; j++) {
      const s = CBA.salaryIn(p, j, dec); if (!s) continue;
      if (p.c.opt[j] === "NG" || p.c.opt[j] === "TO") break;        // unguaranteed seasons simply go away
      rem.push(j === i ? Math.round(s * L.seasonLeft(W)) : s);
    }
    const dead = [];
    if (stretch && rem.length) {
      const tot = sum(rem.slice(L.inSeason(W) ? 1 : 0)), yrs = (rem.length - (L.inSeason(W) ? 1 : 0)) * 2 + 1;
      if (L.inSeason(W)) dead[i] = rem[0];
      for (let k = 0; k < yrs; k++) dead[i + (L.inSeason(W) ? 1 : 0) + k] = Math.round(tot / yrs);
    } else rem.forEach((x, k) => { dead[i + k] = x; });
    if (rem.length) t.dead.push({ n: p.n, sal: dead, why: stretch ? "Waived and stretched" : "Waived" });
    p.t = "FA"; p.c = { sal: [], opt: {}, dec: {}, signed: i, bird: 0 }; p.rights = null;
    news(W, `${t.name} waive ${p.n}${stretch ? " and stretch his salary" : ""}.`, "move", code);
    L.bump(W);
  };

  // ================= Schedule and sim =================
  // A full or remaining schedule: pairs teams until every team has its games, same-conference opponents weighted up
  L.newSchedule = (W, startRec) => {
    const r = rng(W), codes = Object.keys(W.T);
    const rem = {};
    for (const c of codes) rem[c] = 82 - (startRec ? (startRec[c].w + startRec[c].l) : 0);
    const games = [];
    let guard = 0;
    // pair the team with the most games left against teams that also have the most left (always completes)
    while (guard++ < 6000) {
      const left = codes.filter(c => rem[c] > 0).sort((a, b) => rem[b] - rem[a]);
      if (left.length < 2) break;
      const a = left[0];
      const top = rem[left[1]];
      const cands = left.slice(1).filter(c => rem[c] >= top - 2);
      const wts = cands.map(c => (W.T[c].conf === W.T[a].conf ? 1.6 : 1));
      let x = r() * sum(wts), k = 0; while (x > wts[k] && k < cands.length - 1) { x -= wts[k]; k++; }
      const b = cands[k];
      games.push(r() < 0.5 ? { h: a, a: b } : { h: b, a: a });
      rem[a]--; rem[b]--;
    }
    // lay games out over the days left, no team twice in a day, an even number of games a day
    for (let s = games.length - 1; s > 0; s--) { const j = Math.floor(r() * (s + 1)); [games[s], games[j]] = [games[j], games[s]]; }
    const d = L.dates(W.season);
    const start = startRec ? addDays(W.date, 1) : d.open;
    const days = Math.max(20, Math.round((Date.parse(d.end) - Date.parse(start)) / 864e5) + 1);
    const pending = games.slice(); const out = [];
    for (let day = 0; pending.length; day++) {
      const target = day < days ? Math.floor((day + 1) * games.length / days) - Math.floor(day * games.length / days) : pending.length;
      const busy = new Set(); let placed = 0;
      for (let k = 0; k < pending.length && placed < target; k++) {
        const g = pending[k];
        if (busy.has(g.h) || busy.has(g.a)) continue;
        g.d = addDays(start, Math.min(day, days + 30)); out.push(g); busy.add(g.h); busy.add(g.a); pending.splice(k, 1); k--; placed++;
      }
      if (day > days + 60) { for (const g of pending) { g.d = addDays(start, day); out.push(g); } break; }
    }
    W.sched = out;
    for (const c of codes) { W.T[c].w = startRec ? startRec[c].w : 0; W.T[c].l = startRec ? startRec[c].l : 0; W.T[c].inj = {}; }
    W.games = [];
    L.bump(W);
  };
  L.liveStart = W => {
    const lv = W.live;
    if (!lv || !lv.standings || lv.season !== CBA.seasonName(W.season)) return null;
    const rec = {}; let any = 0;
    for (const c of Object.keys(W.T)) { const s = lv.standings[c] || { w: 0, l: 0 }; rec[c] = { w: s.w, l: s.l }; any += s.w + s.l; }
    return any ? rec : null;
  };

  // Availability: streaky injuries from each player's health (share of games he's expected to play)
  const INJ_LEN = 8;
  const availToday = (W, code, r) => {
    const t = W.T[code]; t.inj = t.inj || {};
    const out = new Set();
    for (const p of L.teamPlayers(W, code, { two: true })) {
      let o = t.inj[p.id] || 0;
      if (o > 0) { if (r() < 1 / INJ_LEN) o = 0; }
      else { const q = (1 - p.h) / (p.h * INJ_LEN); if (r() < q) o = 1; }
      t.inj[p.id] = o;
      if (o) out.add(p.id);
    }
    return out;
  };
  L.simGame = (W, g, r) => {
    const mean = W._mean ?? (L.teamNets(W), W._mean);
    const outH = availToday(W, g.h, r), outA = availToday(W, g.a, r);
    const nh = Mo.netOf(L.teamRaw(W, g.h, p => !outH.has(p.id)), mean);
    const na = Mo.netOf(L.teamRaw(W, g.a, p => !outA.has(p.id)), mean);
    const margin = nh - na + 1.5 + Mo.gauss(r) * 12;
    const hw = margin > 0;
    const base = 112 + Mo.gauss(r) * 6;
    let mg = Math.max(1, Math.round(Math.abs(margin)));
    const hs = Math.round(base + (hw ? mg / 2 : -mg / 2)), as = hs + (hw ? -mg : mg);
    g.hs = hs; g.as = as; g.done = true;
    W.T[hw ? g.h : g.a].w++; W.T[hw ? g.a : g.h].l++;
    if (g.h === "BOS" || g.a === "BOS") {
      const outB = g.h === "BOS" ? outH : outA;
      W.games.push({ d: g.d, opp: g.h === "BOS" ? g.a : g.h, home: g.h === "BOS", us: g.h === "BOS" ? hs : as, them: g.h === "BOS" ? as : hs, out: [...outB].map(id => W.P[id].n) });
    }
  };
  L.simUntil = (W, date) => {
    const r = rng(W);
    L.teamNets(W);
    for (const g of W.sched) {
      if (g.done) continue;
      if (g.d > date) break;
      L.simGame(W, g, r);
    }
    W.date = date;
    L.bump(W);
  };
  L.gamesLeft = W => W.sched.filter(g => !g.done).length;

  // ================= Standings and playoffs =================
  L.standings = (W, conf) => {
    const ts = Object.values(W.T).filter(t => !conf || t.conf === conf);
    return ts.sort((a, b) => (b.w / Math.max(1, b.w + b.l) - a.w / Math.max(1, a.w + a.l)) || (b.w - a.w) || (L.teamNets(W)[b.code] - L.teamNets(W)[a.code]));
  };
  const series = (W, hi, lo, r, best = 7) => {
    const nets = L.teamNets(W);
    let wh = 0, wl = 0; const need = Math.ceil(best / 2); const homeHi = [1, 1, 0, 0, 1, 0, 1];
    let g = 0;
    while (wh < need && wl < need) {
      const home = best === 1 ? true : homeHi[g];
      const p = Mo.winPct(nets[hi], nets[lo], home);
      if (r() < p) wh++; else wl++; g++;
    }
    return { hi, lo, wh, wl, win: wh > wl ? hi : lo };
  };
  L.playoffs = W => {
    const r = rng(W), post = { conf: {}, rounds: [] };
    const seeds = {};
    for (const conf of ["E", "W"]) {
      const st = L.standings(W, conf).map(t => t.code);
      // play-in: 7v8 winner is the 7 seed; loser hosts the 9v10 winner for the 8 seed
      const g78 = series(W, st[6], st[7], r, 1), g910 = series(W, st[8], st[9], r, 1);
      const l78 = g78.win === st[6] ? st[7] : st[6];
      const g8 = series(W, l78, g910.win, r, 1);
      seeds[conf] = [...st.slice(0, 6), g78.win, g8.win];
      post.conf[conf] = { order: st, playin: { g78, g910, g8, l78 }, seeds: seeds[conf] };
    }
    let alive = {};
    for (const conf of ["E", "W"]) {
      const s = seeds[conf];
      const r1 = [[0, 7], [3, 4], [2, 5], [1, 6]].map(([a, b]) => series(W, s[a], s[b], r));
      const r2 = [series(W, ...sortSeed(r1[0].win, r1[1].win, s), r), series(W, ...sortSeed(r1[2].win, r1[3].win, s), r)];
      const cf = series(W, ...sortSeed(r2[0].win, r2[1].win, s), r);
      alive[conf] = cf.win;
      post.rounds.push({ conf, r1, r2, cf });
    }
    const e = alive.E, w = alive.W, te = W.T[e], tw = W.T[w];
    const hi = te.w >= tw.w ? e : w, lo = hi === e ? w : e;
    post.finals = series(W, hi, lo, r);
    post.champ = post.finals.win;
    W.post = post;
    news(W, `${W.T[post.champ].name} win the ${2027 + W.season} title, beating ${W.T[post.finals.win === hi ? lo : hi].name} ${Math.max(post.finals.wh, post.finals.wl)}-${Math.min(post.finals.wh, post.finals.wl)}.`, "title");
    return post;
  };
  function sortSeed(a, b, s) { return s.indexOf(a) < s.indexOf(b) ? [a, b] : [b, a]; }
  // How far Boston went
  L.bostonRun = W => {
    const p = W.post; if (!p) return null;
    if (p.champ === "BOS") return "Won the title";
    if (p.finals.hi === "BOS" || p.finals.lo === "BOS") return "Lost in the Finals";
    for (const rd of p.rounds) {
      if (rd.cf.hi === "BOS" || rd.cf.lo === "BOS") return "Lost in the conference finals";
      if (rd.r2.some(s => s.hi === "BOS" || s.lo === "BOS")) return "Lost in the second round";
      if (rd.r1.some(s => s.hi === "BOS" || s.lo === "BOS")) return "Lost in the first round";
    }
    const pin = p.conf.E.playin;
    if ([pin.g78.hi, pin.g78.lo, pin.g910.hi, pin.g910.lo].includes("BOS")) return "Lost in the play-in";
    return "Missed the playoffs";
  };

  // Title odds by Monte Carlo from current nets (for the contender test and the header)
  L.titleOdds = (W, n = 200) => {
    const nets = L.teamNets(W), r = Mo.rng(W.seed + W.tick * 31);
    const codes = Object.keys(W.T), wins = {}; codes.forEach(c => { wins[c] = 0; });
    for (let k = 0; k < n; k++) {
      // regular season by expectation plus noise, then a quick bracket
      const rec = {};
      for (const c of codes) rec[c] = L.inSeason(W) && W.T[c].w + W.T[c].l > 0
        ? W.T[c].w + (82 - W.T[c].w - W.T[c].l) * (0.5 + nets[c] / 30) + Mo.gauss(r) * 3
        : 41 + nets[c] * 2.6 + Mo.gauss(r) * 5;
      const bracket = conf => codes.filter(c => W.T[c].conf === conf).sort((a, b) => rec[b] - rec[a]).slice(0, 8);
      const play = (a, b) => { const p = Mo.phi((nets[a] - nets[b]) / 12 * 2.2); return r() < p ? a : b; };
      const champ = conf => { let s = bracket(conf); while (s.length > 1) { const nx = []; for (let j = 0; j < s.length / 2; j++) nx.push(play(s[j], s[s.length - 1 - j])); s = nx; } return s[0]; };
      wins[play(champ("E"), champ("W"))]++;
    }
    const out = {}; for (const c of codes) out[c] = wins[c] / n;
    return out;
  };

  if (typeof module !== "undefined") module.exports = L; else root.League = L;
})(typeof window !== "undefined" ? window : globalThis);
