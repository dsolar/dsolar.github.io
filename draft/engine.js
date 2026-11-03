/* The Big Board's mock draft engine: draft order (with the NBA lottery and every 2027 first-round protection),
   and how the other 29 or 31 teams pick. No page code here, so it runs in the browser and in node tests. */
(function (root) {
  "use strict";

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

  /* Where every team stands, worst first, for one of two orders:
     "standings": the records right now (Tankathon's order breaks ties); "projected": ESPN's projected final
     records (BPI and FPI). */
  function standing(D, mode) {
    const base = D.order.picks.filter((p) => p[1] === 1).sort((a, b) => a[0] - b[0]).map((p) => p[3]);
    const tie = (t) => base.indexOf(t);
    const pct = (t) => {
      if (mode === "projected" && D.proj && D.proj.teams && D.proj.teams[t]) { const x = D.proj.teams[t]; return x.w / (x.w + x.l); }
      const r = String((D.records || {})[t] || "").split("-").map(Number);
      return r.length >= 2 && r[0] + r[1] > 0 ? (r[0] + (r[2] || 0) / 2) / (r[0] + r[1] + (r[2] || 0)) : 0.5;
    };
    return Object.keys(D.teams).sort((a, b) => pct(a) - pct(b) || tie(a) - tie(b)).map((t) => ({ t, pct: pct(t) }));
  }

  /* NBA conference seeds for a mode: ESPN's playoff seeds as it stands, or seeds from projected records. */
  function seedsFor(D, mode, ranked) {
    const seeds = {};
    if (mode !== "projected" && D.seeds && Object.keys(D.seeds).length >= Object.keys(D.teams).length) return { ...D.seeds };
    for (const conf of ["East", "West"]) {
      ranked.filter((x) => (D.teams[x.t] || {}).conf === conf).slice().reverse().forEach((x, i) => { seeds[x.t] = i + 1; });
    }
    return seeds;
  }

  /* The NBA's 3-2-1 lottery, new for 2027. 16 teams, all 16 picks drawn. Balls: 2 each for the three worst
     records, 3 each for the other seven teams outside the play-in, 2 each for the 9 and 10 seeds, 1 each for
     the losers of the 7-8 play-in games. The worst three can fall no lower than 12. Nobody wins No. 1 two years
     running or a top-five pick three years running (D.rules.lottery lists who's barred). */
  function lottery321(D, mode, rand) {
    const ranked = standing(D, mode);
    const seeds = seedsFor(D, mode, ranked);
    const worst = ranked.map((x) => x.t);
    const outside = worst.filter((t) => seeds[t] >= 11).slice(0, 10);
    const balls = {};
    outside.forEach((t, i) => { balls[t] = i < 3 ? 2 : 3; });
    worst.filter((t) => seeds[t] === 9 || seeds[t] === 10).forEach((t) => { balls[t] = 2; });
    // The 7-8 play-in game in each conference: the 7 seed wins 60% of the time; the loser joins the lottery.
    const playIn = {};
    for (const conf of ["East", "West"]) {
      const s7 = worst.find((t) => seeds[t] === 7 && D.teams[t].conf === conf);
      const s8 = worst.find((t) => seeds[t] === 8 && D.teams[t].conf === conf);
      if (!s7 || !s8) continue;
      const loser = rand ? (rand() < 0.6 ? s8 : s7) : s8;
      balls[loser] = 1;
      playIn[loser] = true;
    }
    const pool = worst.filter((t) => balls[t]);
    const floorTeams = outside.slice(0, 3);
    const L = (D.rules && D.rules.lottery) || {};
    const no1 = new Set(L.no1 || []), top5 = new Set(L.top5 || []);
    if (!rand) return { order: pool, balls, seeds, playIn, floorTeams };
    const left = pool.slice(), order = [];
    for (let k = 1; k <= pool.length; k++) {
      const mustFloor = floorTeams.filter((t) => left.includes(t));
      let pickFrom = left.filter((t) => !(k === 1 && no1.has(t)) && !(k <= 5 && top5.has(t)));
      if (mustFloor.length && mustFloor.length >= 12 - k + 1) pickFrom = mustFloor;
      if (!pickFrom.length) pickFrom = left.slice();
      const tot = pickFrom.reduce((s2, t) => s2 + balls[t], 0);
      let r = rand() * tot, i = 0;
      for (; i < pickFrom.length - 1; i++) { r -= balls[pickFrom[i]]; if (r < 0) break; }
      const t = pickFrom[i];
      order.push(t);
      left.splice(left.indexOf(t), 1);
    }
    return { order, balls, seeds, playIn, floorTeams };
  }

  // Each team's chance at No. 1 under the 3-2-1 lottery, for the lottery screen.
  function oddsAtOne(D, mode) {
    // Simulated, so the No. 1 ban, the floor and the 7-8 play-in coin all count.
    D._odds = D._odds || {};
    if (D._odds[mode]) return D._odds[mode];
    const N = 6000, hits = {}, rand = rng(20270);
    for (let k = 0; k < N; k++) {
      const t = lottery321(D, mode, rand).order[0];
      hits[t] = (hits[t] || 0) + 1;
    }
    const out = {};
    lottery321(D, mode, null).order.concat(Object.keys(hits)).forEach((t) => { out[t] = (hits[t] || 0) / N; });
    return (D._odds[mode] = out);
  }

  /* The full order for a mock.
     opts.order: "standings" (as the season stands) or "projected" (ESPN's projected final records).
     opts.lottery: a seed to draw the NBA lottery, or null for the order before any drawing.
     Returns [{ n, rnd, owner, orig, note, jump }]. */
  function buildOrder(D, opts) {
    opts = opts || {};
    const mode = opts.order === "projected" ? "projected" : "standings";
    const tank = D.order.picks.map((p) => ({ n: p[0], rnd: p[1], owner: p[2], orig: p[3] }));
    // Who owns each original team's pick in each round, as the trades stand today.
    const ownerOf = {};
    tank.forEach((p) => { ownerOf[`${p.rnd}-${p.orig}`] = ownerOf[`${p.rnd}-${p.orig}`] || p.owner; });

    if (D.league === "nfl") {
      if (mode === "standings") return tank.map((p) => ({ ...p, note: "" }));
      const order = standing(D, "projected").map((x) => x.t);
      const out = [];
      const rounds = [...new Set(tank.map((p) => p.rnd))];
      for (const r of rounds) {
        const inRound = tank.filter((p) => p.rnd === r);
        const seen = new Set(), regular = [], comp = [];
        inRound.forEach((p) => { if (seen.has(p.orig)) comp.push(p); else { seen.add(p.orig); regular.push(p); } });
        regular.sort((a, b) => order.indexOf(a.orig) - order.indexOf(b.orig));
        regular.concat(comp).forEach((p) => out.push({ rnd: r, orig: p.orig, owner: p.owner, note: "", jump: 0 }));
      }
      out.forEach((p, i) => { p.n = i + 1; });
      return out;
    }

    // NBA: the 3-2-1 lottery for 1-16, record for 17-30; round two mirrors round one for its first 16.
    const L = lottery321(D, mode, opts.lottery == null ? null : rng(opts.lottery));
    const ranked = standing(D, mode).map((x) => x.t);
    const lotto = L.order;
    const rest = ranked.filter((t) => !lotto.includes(t));
    const order1 = lotto.concat(rest);
    const before = lottery321(D, mode, null).order.concat(rest);
    const slot = {};
    order1.forEach((t, i) => { slot[t] = i + 1; });
    const res = resolve(slot, D.rules && D.rules.first);
    const out = order1.map((t, i) => ({ n: i + 1, rnd: 1, orig: t, owner: res.owner[t], note: res.notes[t] || "",
      jump: opts.lottery == null ? 0 : before.indexOf(t) - i, balls: L.balls[t] || 0 }));
    const order2 = lotto.concat(rest);
    order2.forEach((t, i) => out.push({ n: 31 + i, rnd: 2, orig: t, owner: ownerOf[`2-${t}`] || t, note: "" }));
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
  const QB_W = [1, 0.7, 0.45, 0.3, 0.2];
  const qbReach = (pickNo) => pickNo + Math.max(9, pickNo * 0.6);
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
        if (pos === "QB" && ni < 0) v += 4 + p.score * 0.15;   // a team with its quarterback rarely spends a high pick on another
        else if (pos === "QB" && ni >= 0 && !taken.includes("QB")) {
          // QB premium, within reason: a team that needs a quarterback will reach for one, but only so far
          // (No. 17 at No. 9 happens; a third-rounder at No. 9 doesn't), and less the lower QB sits on its list.
          if (p.score <= qbReach(pickNo)) v -= QB_W[ni] * Math.min(Math.max(0, p.score - pickNo) * 0.75 + 2, pickNo * 0.8 + 2);
        } else if (ni >= 0 && !taken.includes(pos) && p.score <= pickNo * 1.35 + 8) {
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

  // A pick in this draft. NFL: the chart picked for the mock, Jimmy Johnson (what draft-day trades still track)
  // or Fitzgerald-Spielberger (contract surplus value). NBA: no standard chart exists, so a curve: 100 at No. 1,
  // about 10 at No. 30, falling to about 1 at No. 60 (second-rounders are cheap, unguaranteed).
  function chartOf(D) {
    const v = D.values || {};
    return Array.isArray(v) ? v : v[D.chart || "jj"] || v.jj || [];
  }
  function pickValue(D, n) {
    if (D.league === "nfl") { const c = chartOf(D); return c[Math.max(1, Math.min(n, c.length)) - 1] || 1; }
    const k = Math.max(1, Math.min(n, 60));
    return k <= 30 ? 100 * Math.exp(-0.08 * (k - 1)) : 9.8 * Math.exp(-0.07 * (k - 30));
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
            if (kind === "forfeit") { a.owner = null; a.ok = false; a.note = "Forfeited (league penalty)"; }
            else if (kind === "swap") { a.ok = false; a.note = `Swap rights: ${to.replace(/\//g, " or ")}`; }
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

  /* A future pick's value, the way front offices count it: a round lower for every year out (next year's 1st is
     worth a pick in the middle of this year's 2nd, two years out a 3rd), at a slot pulled toward the middle of
     the round, halfway for next year and three quarters for the year after, from where the team stands now.
     A protected pick only counts for the share of likely landing spots where it actually conveys. */
  function futureValue(D, a) {
    const N = Object.keys(D.teams).length, mid = (N + 1) / 2, k = Math.max(1, a.year - (D.year || 2027));
    const proj = mid + (slotNow(D, a.orig) - mid) * Math.pow(0.5, k);
    const rounds = D.league === "nba" ? 2 : 7;
    let v;
    if (D.league === "nba") {
      // NBA future firsts are the scarcest currency there is (the Stepien rule caps how many a team can move),
      // so they barely discount; seconds are the change teams make deals with.
      v = pickValue(D, Math.round((a.rd - 1) * N + proj)) * Math.pow(a.rd === 1 ? 0.95 : 0.85, k);
    } else if (a.rd - 1 + k >= rounds) v = pickValue(D, rounds * N) * Math.pow(0.5, a.rd - 1 + k - rounds + 1);
    else v = pickValue(D, Math.round((a.rd - 1 + k) * N + proj));
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
    return `${a.year} ${rd}${a.owner !== a.orig ? ` (${a.orig})` : ""}${protLabel(D, a)}`;
  }
  // "top-5 protected", "lottery protected", and for an NBA first with none, "unprotected", so nobody misses it.
  function protLabel(D, a) {
    if (!a.prot) return D.league === "nba" && a.rd === 1 ? ", unprotected" : "";
    const [lo, hi] = a.prot.split("-").map(Number);
    if (lo === 1 && hi === 14 && D.league === "nba") return ", lottery protected";
    if (lo === 1) return `, top-${hi} protected`;
    return `, protected ${a.prot}`;
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
  function botAccepts(give, get, rand, eager, premium) {
    if (!give || give <= 0) return get > 0;
    const need = 1.04 + (premium || 0) - (eager ? 0.05 : 0) + (rand() - 0.5) * 0.06;
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
      let target = avail[0];
      if (!target) break;
      // A QB-needy team calls harder when a quarterback it would reach for is here and won't last to its pick.
      const needs = (D.needs || {})[t] || [];
      const qbNeed = D.league === "nfl" ? needs.indexOf("QB") : -1;
      const qb = qbNeed >= 0 && qbNeed <= 1 ? avail.find((p) => nflPos(p.pos) === "QB" && p.score <= qbReach(cur.n) && p.score < next.n - 3) : null;
      if (qb) target = qb;
      const gone = avail.slice(0, Math.max(1, Math.round((next.n - cur.n) * 0.9))).length;
      const keen = target.score < next.n - 3 && gone > 2 && rand() < (qb ? 0.85 : 0.55 + 0.15 * (st.chaos || 0.5));
      if (!keen) continue;
      /* What they can put in. NBA: these deals run on second-rounders and this year's picks. A future first goes
         only to climb into the lottery, and its protection follows how real trade-ups were written: into the top
         three, light (Philadelphia's 2017 jump from 3 to 1 used a top-1 protected first, Dallas's 2018 jump from 5
         to 3 a top-5 protected one), into picks 4 to 8 top-10, later in the lottery the whole lottery. Unprotected
         firsts happen, but rarely, and the offer says so. NFL: this year's picks first, future firsts last. */
      const nba = D.league === "nba";
      const cands = theirs.slice(1, 5).map((p) => ({ kind: "pick", n: p.n }));
      const futs = st.ledger.filter((a) => a.owner === t && a.ok && !a.prot).sort((a, b) => a.year - b.year || a.rd - b.rd);
      const variants = !nba ? [""]
        : cur.n <= 3 ? ["1-1", "1-3", "1-5", ...(rand() < 0.35 ? [""] : [])]
        : cur.n <= 8 ? ["1-10", "1-5", ...(rand() < 0.12 ? [""] : [])]
        : cur.n <= 14 ? ["1-14", "1-10", ...(rand() < 0.06 ? [""] : [])]
        : rand() < 0.04 ? [""] : [];
      futs.filter((a) => a.rd === 1).slice(0, 2).forEach((a) => {
        variants.forEach((prot) => cands.push({ kind: "future", a: prot ? { ...a, prot, note: `Protected ${prot}` } : a }));
      });
      futs.filter((a) => a.rd === 2 || (!nba && a.rd === 3)).slice(0, 4).forEach((a) => cands.push({ kind: "future", a }));
      const lead = { kind: "pick", n: next.n };
      const leadV = assetValue(D, lead);
      if (leadV < V * 0.4) continue;
      // Moving up costs a premium, more near the top.
      const want = V * (1.03 + (cur.n <= 10 ? 0.05 : 0) + (qb ? 0.06 : 0) + rand() * 0.07);
      const maxExtra = nba ? 3 : (cur.n <= 5 ? 3 : 2);
      // The cheapest-looking package that clears it: least overpay, with a cost on each future first (teams
      // hate giving them) and a little on every extra piece.
      // In the NBA the lighter the protection, the harder a team swallows: unprotected costs most.
      const firstCost = (x) => {
        if (x.kind !== "future" || x.a.rd !== 1) return 0;
        if (!nba) return V * 0.15;
        const hi = x.a.prot ? Number(x.a.prot.split("-")[1]) : 0;
        return V * (0.1 + 0.2 * Math.max(0, 14 - hi) / 14);
      };
      let best = null, bestScore = Infinity;
      const vals = cands.map((x) => assetValue(D, x));
      const n = cands.length;
      const tryCombo = (idx) => {
        const sumV = leadV + idx.reduce((s2, i) => s2 + vals[i], 0);
        if (sumV < want || sumV > V * (qb ? 1.4 : 1.3)) return;
        const ids = idx.map((i) => cands[i].kind === "future" ? cands[i].a.id : "n" + cands[i].n);
        if (new Set(ids).size < ids.length) return;   // two versions of the same pick
        const firsts = idx.filter((i) => cands[i].kind === "future" && cands[i].a.rd === 1).length;
        if (firsts > 1 && cur.n > 3) return;
        const score = (sumV - want) + idx.reduce((s2, i) => s2 + firstCost(cands[i]), 0) + idx.length * V * 0.02;
        if (score < bestScore) { bestScore = score; best = idx; }
      };
      tryCombo([]);
      for (let i = 0; i < n; i++) {
        tryCombo([i]);
        if (maxExtra < 2) continue;
        for (let j = i + 1; j < n; j++) {
          tryCombo([i, j]);
          if (maxExtra < 3) continue;
          for (let k = j + 1; k < n; k++) tryCombo([i, j, k]);
        }
      }
      if (!best) continue;
      const pkg = [lead].concat(best.map((i) => cands[i]));
      const sum = leadV + best.reduce((s2, i) => s2 + vals[i], 0);
      const moves = pkg.filter((x) => x.kind === "future").map((x) => ({ id: x.a.id, from: t, to: cur.owner }));
      if (!stepienOK(D, st.ledger, moves).ok) continue;
      const unprot = nba && pkg.some((x) => x.kind === "future" && x.a.rd === 1 && !x.a.prot);
      offers.push({ team: t, give: pkg, value: sum, ratio: sum / V, target: target.id, qb: !!qb,
        note: unprot ? (cur.n <= 3 ? "Unprotected first: they really want this pick" : "Unprotected first: rare for a pick this low") : "" });
    }
    return offers;
  }

  // A pick's grade against the consensus: positive is value (taken later than his rank), negative a reach.
  function value(pick, player) { return pick - player.rank; }

  const api = { rng, lottery321, oddsAtOne, standing, resolve, buildOrder, botPick, nflPos, value, pickValue, ledger, futureValue,
    assetValue, assetLabel, protLabel, stepienOK, firstsGap, botAccepts, offersFor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DraftEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
