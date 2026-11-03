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
     randomness setting and with his rank (the boards agree on the top, not on No. 40), plus small nudges.
     NFL: position value, the team's needs (NFL.com's list), and no doubling up at a position.
     Needs are kept from taking over three ways: the pull is worth a few spots at most and shrinks at the top
     of the draft (best player available wins there), a need stops counting once it's filled, and a need never
     moves a player who'd be a big reach at this pick. Lowest value goes. */
  const NFL_POS = { QB: -2.5, EDGE: -1.5, OT: -1, CB: -0.5, WR: 0, DL: 0, IOL: 1.5, LB: 2, S: 2, TE: 2.5, RB: 3 };
  const NEED_W = [3, 2.2, 1.5, 1, 0.6];
  function botPick(available, ctx) {
    const rand = ctx.rand, chaos = ctx.chaos == null ? 0.5 : ctx.chaos;
    const taken = ctx.taken || [], needs = ctx.needs || [], pickNo = ctx.pick || 1;
    let best = null, bestV = Infinity;
    const look = available.slice(0, 40);
    for (const p of look) {
      const g = gauss(rand);
      let v = p.score + g * (1.5 + p.score * 0.12) * (0.25 + chaos * 1.5);
      if (ctx.league === "nfl") {
        const pos = nflPos(p.pos);
        v += (NFL_POS[pos] || 0) * (p.score > 12 ? 1 : 0.4);
        if (taken.includes(pos)) v += 6 + p.score * 0.1;
        const ni = needs.indexOf(pos);
        if (ni >= 0 && !taken.includes(pos) && p.score <= pickNo * 1.35 + 8) {
          v -= NEED_W[ni] * Math.min(1, 0.35 + pickNo / 40) * (1 + p.score / 60);
        }
      } else {
        const g2 = posGroup(p.pos);
        if (taken.filter((x) => posGroup(x) === g2).length >= 1) v += 2;
      }
      if (v < bestV) { bestV = v; best = p; }
    }
    return best;
  }
  function nflPos(pos) {
    const p = String(pos || "").toUpperCase().split(/[\/]/)[0];
    return p === "DT" || p === "IDL" || p === "NT" ? "DL" : p === "OG" || p === "C" || p === "OL" ? "IOL" : p === "DE" ? "EDGE" : p === "NB" ? "CB" : p;
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


  // ---------- pick values and trades ----------

  // A pick in this draft. NFL: the Fitzgerald-Spielberger chart. NBA: no standard chart exists, so a curve:
  // 100 at No. 1, about 10 at No. 30, falling to about 1 at No. 60 (second-rounders are cheap, unguaranteed).
  function pickValue(D, n) {
    if (D.league === "nfl") return (D.values && D.values[Math.min(n, D.values.length) - 1]) || 150;
    return n <= 30 ? 100 * Math.exp(-0.08 * (n - 1)) : 9.8 * Math.exp(-0.07 * (n - 30));
  }

  // Every future pick in the trade window, with who holds it now and whether it can move.
  function ledger(D) {
    const F = D.future || { years: [], owed: [] };
    const rounds = D.league === "nba" ? 2 : 7;
    const owed = {};
    (F.owed || []).forEach((o) => { owed[`${o[0]}-${o[1]}-${o[2]}`] = o; });
    const out = [];
    for (const t of Object.keys(D.teams)) {
      for (const y of F.years) {
        for (let rd = 1; rd <= rounds; rd++) {
          const id = `${t}-${y}-${rd}`, o = owed[id];
          const a = { id, orig: t, year: y, rd, owner: t, prot: "", ok: true, note: "" };
          if (o) {
            const to = o[3], kind = o[4];
            if (kind === "swap") { a.ok = false; a.note = `Swap rights: ${to.replace(/\//g, " or ")}`; }
            else if (to.includes("/") || kind === "fav" || kind === "cond" || to === "?") { a.owner = null; a.ok = false; a.note = to === "?" ? "Owed, terms vary" : `Owed to ${to.replace(/\//g, " or ")}`; }
            else { a.owner = to; if (/^\d+-\d+$/.test(kind)) { a.prot = kind; a.note = `Protected ${kind}`; } }
          }
          out.push(a);
        }
      }
    }
    return out;
  }

  // Where a team's pick would land this year (its first-round slot as the season stands), 1 to 30 or 32.
  function slotNow(D, team) {
    const p = D.order.picks.find((x) => x[1] === 1 && x[3] === team);
    return p ? p[0] : Math.ceil(Object.keys(D.teams).length / 2);
  }

  // A future pick's value: projected slot pulled toward the middle the further out it is, a discount per year,
  // and for a protected pick only the share of likely landing spots where it actually conveys.
  function futureValue(D, a) {
    const N = Object.keys(D.teams).length, mid = (N + 1) / 2, k = Math.max(1, a.year - (D.year || 2027));
    const proj = mid + (slotNow(D, a.orig) - mid) * Math.pow(D.league === "nba" ? 0.5 : 0.4, k);
    let v;
    if (D.league === "nfl") v = pickValue(D, Math.round((a.rd - 1) * 32 + proj)) * Math.pow(0.75, k);
    else v = pickValue(D, Math.round((a.rd - 1) * 30 + proj)) * Math.pow(0.85, k);
    if (a.prot) {
      const [lo, hi] = a.prot.split("-").map(Number);
      let conv = 0, tot = 0;
      for (let s = Math.max(1, Math.round(proj - 8)); s <= Math.min(N * 2, Math.round(proj + 8)); s++) {
        const slot = (a.rd - 1) * N + s;
        tot++; if (slot < lo || slot > hi) conv++;
      }
      v *= tot ? Math.max(0.15, conv / tot) : 1;
    }
    return v;
  }

  // Asset values. A current pick is { kind: "pick", n }; a future one is { kind: "future", a }.
  function assetValue(D, x) { return x.kind === "pick" ? pickValue(D, x.n) : futureValue(D, x.a); }
  function assetLabel(D, x) {
    if (x.kind === "pick") return `No. ${x.n}`;
    const a = x.a, rd = a.rd === 1 ? "1st" : a.rd === 2 ? "2nd" : a.rd === 3 ? "3rd" : `${a.rd}th`;
    return `${a.year} ${rd}${a.owner !== a.orig ? ` (${a.orig})` : ""}${a.prot ? `, protected ${a.prot}` : ""}`;
  }

  /* NBA trade rules for future picks. Stepien rule: a team can't be left without a first-round pick in two
     straight future drafts. Picks can only be traded seven drafts out (the ledger already stops at 2033).
     Only a trade that creates a new gap is blocked, since some teams already have gaps the way protections
     and swaps are written. */
  function firstsGap(L, team, years) {
    const has = (y) => L.some((a) => a.year === y && a.rd === 1 && a.owner === team);
    const gaps = [];
    for (let i = 0; i < years.length - 1; i++) if (!has(years[i]) && !has(years[i + 1])) gaps.push(years[i]);
    return gaps;
  }
  function stepienOK(D, L, moves) {
    if (D.league !== "nba") return { ok: true };
    const years = (D.future || {}).years || [];
    const teams = [...new Set(moves.map((m) => m.from).concat(moves.map((m) => m.to)))];
    const before = Object.fromEntries(teams.map((t) => [t, firstsGap(L, t, years).length]));
    const after = L.map((a) => { const m = moves.find((x) => x.id === a.id); return m ? { ...a, owner: m.to } : a; });
    for (const t of teams) {
      const g = firstsGap(after, t, years);
      if (g.length > before[t]) return { ok: false, team: t, year: g[g.length - 1] };
    }
    return { ok: true };
  }

  // Does a bot take this? It wants a little more than it gives, plus noise; desperate teams less so.
  function botAccepts(give, get, rand, eager) {
    if (!give || give <= 0) return get > 0;
    const need = 1.04 - (eager ? 0.05 : 0) + (rand() - 0.5) * 0.06;
    return get / give >= need;
  }

  /* Offers for the user's pick while he's on the clock. A team calls if a player it likes better than the rest
     is still here and probably won't last to its own pick. Its package starts with its next pick and adds
     what it takes to clear the pick's value by a little, without overpaying by much. */
  function offersFor(D, st, rand) {
    const cur = st.picks[st.i], V = pickValue(D, cur.n);
    const avail = st.available;
    const offers = [];
    const teams = Object.keys(D.teams).filter((t) => !st.mine.has(t) && t !== cur.owner);
    for (const t of teams.sort(() => rand() - 0.5)) {
      if (offers.length >= 3) break;
      const theirs = st.picks.filter((p, j) => j > st.i && p.owner === t && !p.player);
      if (!theirs.length) continue;
      const next = theirs[0];
      const target = avail[0];
      if (!target) break;
      const gone = avail.slice(0, Math.max(1, Math.round((next.n - cur.n) * 0.9))).length;
      const keen = target.score < next.n - 3 && gone > 2 && rand() < 0.55 + 0.15 * (st.chaos || 0.5);
      if (!keen) continue;
      const pool = theirs.map((p) => ({ kind: "pick", n: p.n }))
        .concat(st.ledger.filter((a) => a.owner === t && a.ok).sort((a, b) => a.year - b.year || a.rd - b.rd).map((a) => ({ kind: "future", a })));
      const pkg = [pool[0]];
      let sum = assetValue(D, pool[0]);
      const want = V * (1.02 + rand() * 0.12);
      const rest = pool.slice(1).map((x) => ({ x, v: assetValue(D, x) })).sort((a, b) => a.v - b.v);
      while (sum < want && rest.length) {
        const gap = want - sum;
        let pickI = rest.findIndex((r) => r.v >= gap);
        if (pickI < 0) pickI = rest.length - 1;
        const r = rest.splice(pickI, 1)[0];
        pkg.push(r.x); sum += r.v;
      }
      if (sum < V || sum > V * 1.45) continue;
      const moves = pkg.filter((x) => x.kind === "future").map((x) => ({ id: x.a.id, from: t, to: cur.owner }));
      if (!stepienOK(D, st.ledger, moves).ok) continue;
      offers.push({ team: t, give: pkg, value: sum, ratio: sum / V, target: target.id });
    }
    return offers;
  }

  // A pick's grade against the consensus: positive is value (taken later than his rank), negative a reach.
  function value(pick, player) { return pick - player.rank; }

  const api = { ODDS, rng, lottery, resolve, buildOrder, botPick, nflPos, value, pickValue, ledger, futureValue,
    assetValue, assetLabel, stepienOK, firstsGap, botAccepts, offersFor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DraftEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
