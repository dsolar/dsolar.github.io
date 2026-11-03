/* The Big Board's mock draft engine: draft order (with the NBA lottery and every 2027 first-round protection),
   and how the other 29 or 31 teams pick. No page code here, so it runs in the browser and in node tests. */
(function (root) {
  "use strict";

  // 2019-format lottery: chances per 1,000 for the 14 worst records, top four picks drawn.
  const ODDS = [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5];

  function rng(seed) {   // mulberry32: a seeded random, so a draft can be replayed
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // lotteryTeams: the 14 worst teams, worst first. Returns them in draft order after the drawing.
  function lottery(lotteryTeams, rand) {
    const pool = lotteryTeams.map((t, i) => ({ t, w: ODDS[i] || 0 }));
    const won = [];
    for (let k = 0; k < 4; k++) {
      const tot = pool.reduce((s, x) => s + x.w, 0);
      let r = rand() * tot;
      let i = 0;
      for (; i < pool.length - 1; i++) { r -= pool[i].w; if (r < 0) break; }
      won.push(pool.splice(i, 1)[0].t);
    }
    return won.concat(pool.map((x) => x.t));
  }

  // slot: original team -> its pick number in round one. Returns original team -> who picks there.
  function resolve(slot, rules) {
    const owner = {};
    Object.keys(slot).forEach((t) => { owner[t] = t; });
    const notes = {};
    const inRange = (n, r) => r && n >= r[0] && n <= r[1];
    for (const r of rules || []) {
      if (r.type === "to") {
        if (!inRange(slot[r.orig], r.keep)) { owner[r.orig] = r.to; notes[r.orig] = r.note; }
        else notes[r.orig] = `${r.note}: stays home, would have gone to ${r.to}`;
      } else if (r.type === "split") {
        const hit = r.ranges.find((x) => inRange(slot[r.orig], x));
        if (hit) owner[r.orig] = hit[2];
        notes[r.orig] = r.note;
      } else if (r.type === "swap") {
        // holder may swap its own pick for the other team's own pick
        const a = r.holder, b = r.with;
        if (owner[a] === a && owner[b] === b && slot[b] < slot[a]) { owner[b] = a; owner[a] = b; }
        notes[a] = notes[b] = r.note;
      } else if (r.type === "favorable") {
        const bar = r.bar || {};
        const eligible = r.picks.filter((t) => !inRange(slot[t], bar[t])).sort((x, y) => slot[x] - slot[y]);
        const to = r.to.filter((t) => !(bar[t] && inRange(slot[t], bar[t])));
        eligible.forEach((t, i) => { if (to[i]) owner[t] = to[i]; });
        const last = eligible[eligible.length - 1];
        if (r.lastKeep && last && inRange(slot[last], r.lastKeep)) owner[last] = r.fallback;
        r.picks.forEach((t) => { notes[t] = r.note; });
      } else if (r.type === "okc") {
        const held = ["OKC", "DEN"].filter((t) => owner[t] === "OKC");
        if (held.length && owner.LAC === "LAC") {
          const worst = held.sort((x, y) => slot[y] - slot[x])[0];
          if (slot.LAC < slot[worst]) { owner.LAC = "OKC"; owner[worst] = "LAC"; }
        }
        const mine = ["LAC", "OKC", "DEN"].find((t) => owner[t] === "LAC");
        if (mine && owner.TOR === "TOR" && slot.TOR < slot[mine]) { owner.TOR = "LAC"; owner[mine] = "TOR"; }
        ["OKC", "DEN", "LAC", "TOR"].forEach((t) => { notes[t] = notes[t] || r.note; });
      }
    }
    Object.keys(notes).forEach((t) => { if (owner[t] === t && !/stays home/.test(notes[t])) delete notes[t]; });
    return { owner, notes };
  }

  /* The full order for a mock.
     D: the league file (order, rules). opts.lottery: "standings" (as the season stands) or a seed to draw one.
     Returns [{ n, rnd, owner, orig, note, jump }]. */
  function buildOrder(D, opts) {
    const base = D.order.picks.map((p) => ({ n: p[0], rnd: p[1], owner: p[2], orig: p[3] }));
    if (D.league !== "nba" || !opts || opts.lottery == null || opts.lottery === "standings") {
      return base.map((p) => ({ ...p, note: noteFor(D, p) }));
    }
    const r1 = base.filter((p) => p.rnd === 1).sort((a, b) => a.n - b.n);
    const byRecord = r1.map((p) => p.orig);
    const drawn = lottery(byRecord.slice(0, 14), rng(opts.lottery));
    const order1 = drawn.concat(byRecord.slice(14));
    const slot = {};
    order1.forEach((t, i) => { slot[t] = i + 1; });
    const res = resolve(slot, D.rules && D.rules.first);
    const out = order1.map((t, i) => ({ n: i + 1, rnd: 1, orig: t, owner: res.owner[t], note: res.notes[t] || "", jump: byRecord.indexOf(t) + 1 - (i + 1) }));
    base.filter((p) => p.rnd > 1).forEach((p) => out.push({ ...p, note: "" }));
    return out;
  }

  function noteFor(D, p) {
    if (p.rnd !== 1 || !D.rules || p.owner === p.orig) return "";
    const r = (D.rules.first || []).find((x) => x.orig === p.orig || x.holder === p.orig || x.with === p.orig || (x.picks || []).includes(p.orig) || (x.type === "okc" && ["OKC", "DEN", "LAC", "TOR"].includes(p.orig)));
    return r ? r.note : "";
  }

  /* How a bot team picks. Each player's value is his consensus average plus noise that grows with the
     randomness setting and with his rank (the boards agree on the top, not on No. 40), plus small nudges:
     NFL position value, and not doubling up on a position the team already took. Lowest value goes. */
  const NFL_POS = { QB: -2.5, EDGE: -1.5, OT: -1, CB: -0.5, WR: 0, DL: 0, IOL: 1.5, LB: 2, S: 2, TE: 2.5, RB: 3 };
  function botPick(available, ctx) {
    const rand = ctx.rand, chaos = ctx.chaos == null ? 0.5 : ctx.chaos;
    const taken = ctx.taken || [];
    let best = null, bestV = Infinity;
    const look = available.slice(0, 40);
    for (const p of look) {
      const g = gauss(rand);
      let v = p.score + g * (1.5 + p.score * 0.12) * (0.25 + chaos * 1.5);
      if (ctx.league === "nfl") {
        const pos = (p.pos || "").toUpperCase();
        v += (NFL_POS[pos] || 0) * (p.score > 12 ? 1 : 0.4);
        if (taken.includes(pos)) v += 6 + p.score * 0.1;
      } else {
        const g2 = posGroup(p.pos);
        if (taken.filter((x) => posGroup(x) === g2).length >= 1) v += 2;
      }
      if (v < bestV) { bestV = v; best = p; }
    }
    return best;
  }
  function posGroup(pos) {
    const f = String(pos || "").toUpperCase().split(/[\/-]/)[0];
    return f === "PG" || f === "SG" || f === "G" ? "g" : f === "C" ? "b" : "w";
  }
  function gauss(rand) {
    let u = 0, v = 0;
    while (!u) u = rand();
    while (!v) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // A pick's grade against the consensus: positive is value (taken later than his rank), negative a reach.
  function value(pick, player) { return pick - player.rank; }

  const api = { ODDS, rng, lottery, resolve, buildOrder, botPick, value };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DraftEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
