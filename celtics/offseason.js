/* Banner 19: GM mode. Phases, deadline offers, the 3-2-1 lottery, the draft, options, free agency,
   training camp, and the optional expansion draft. Extends League. No DOM. */
(function (root) {
  "use strict";
  const CBA = root.CBA || require("./cba.js");
  const Mo = root.Model || require("./model.js");
  const L = root.League || require("./league.js");
  const sum = a => a.reduce((s, x) => s + x, 0);
  const M$ = L.M$;
  const news = (...a) => L.news(...a);
  const pv = (W, code, p) => L.playerValue(W, code, p);
  const teamCodes = W => Object.keys(W.T);

  // ================= In-season phases =================
  L.cpuRosters = W => {
    const i = W.season, dec = L.decider(W);
    for (const code of teamCodes(W)) {
      if (code === "BOS") continue;
      for (const p of L.teamPlayers(W, code)) if (p.c.opt[i] === "NG" && !p.c.dec[i]) p.c.dec[i] = Mo.mv(p, i, W) >= p.c.sal[i] * 0.7 ? "in" : "out";
      for (const p of L.teamPlayers(W, code)) if (!(CBA.salaryIn(p, i, dec) > 0)) { p.t = "FA"; p.rights = null; }
      let ps = L.teamPlayers(W, code);
      while (ps.length > 15) { const cut = ps.sort((a, b) => pv(W, code, a) - pv(W, code, b))[0]; L.waive(W, code, cut.id, false); ps = L.teamPlayers(W, code); }
    }
    L.bump(W);
  };
  L.startSeason = W => {
    L.cpuRosters(W);
    const n = L.rosterCount(W, "BOS");
    if (n > 15) return { ok: false, why: `Boston has ${n} players under contract. Get to 15 before opening night (Moves: waive).` };
    const rec = W.season === 0 ? L.liveStart(W) : null;
    if (rec) { L.newSchedule(W, rec); W.date = W.live.updated ? W.live.updated.slice(0, 10) : W.date; news(W, `Picked up from the real standings as of ${L.fmtDate(W.date)}.`, "info"); }
    else if (!W.sched || !W.sched.length || W.sched.some(g => g.done)) L.newSchedule(W);
    W.phase = "reg";
    if (!rec) W.date = L.dates(W.season).open;
    L.bump(W);
    return { ok: true };
  };
  L.simDays = (W, days) => {
    const d = L.dates(W.season);
    let target = L.addDays(W.date, days);
    if (W.phase === "reg" && target >= d.deadline) target = d.deadline;
    if (target >= d.end) target = d.end;
    L.simUntil(W, target);
    if (W.phase === "reg" && W.date >= d.deadline) L.openDeadline(W);
    else if (W.date >= d.end) W.phase = W.phase === "deadline" ? "deadline" : "reg2";
    return W.date;
  };
  L.openDeadline = W => {
    W.phase = "deadline"; W.date = L.dates(W.season).deadline;
    W.offers = (W.offers || []).filter(o => !o.done).concat(L.makeOffers(W, 5));
    news(W, `Deadline week. ${W.offers.filter(o => !o.done).length} teams called Boston.`, "info", "BOS");
    L.bump(W);
  };
  L.closeDeadline = W => {
    W.phase = "reg2"; W.date = L.dates(W.season).deadlineEnd;
    W.offers.forEach(o => { if (!o.done) { o.done = true; o.result = "expired"; } });
    // CPU teams that never pay tax dump salary on their own if they're over
    L.cpuDeadlineDumps(W);
    L.bump(W);
  };
  L.finishRegular = W => {
    if (W.phase === "reg" ) { L.simUntil(W, L.dates(W.season).deadline); L.openDeadline(W); return; }
    if (W.phase === "deadline") L.closeDeadline(W);
    L.simUntil(W, "9999-12-31");                           // every scheduled game, even a straggler
    W.phase = "playoffs"; W.date = L.dates(W.season).end;
    L.bump(W);
  };
  L.runPlayoffs = W => {
    L.playoffs(W);
    const B = W.T.BOS, run = L.bostonRun(W);
    const year = 2027 + W.season;
    if (W.post.champ === "BOS") { W.titles = W.titles || []; W.titles.push(year); }
    const b = L.books(W, "BOS", W.season);
    W.hist.push({ season: W.season, w: B.w, l: B.l, run, payroll: b.payroll, tax: b.tax, champ: W.post.champ });
    W.phase = "draft"; W.date = L.dates(W.season).finals;
    L.bump(W);
    return run;
  };

  // ================= Deadline offers =================
  // Teams call Boston with deals they'd actually sign off on. Each one is checked against the CBA for both sides.
  L.makeOffers = (W, max) => {
    const r = L.rng(W), out = [], i = W.season, dec = L.decider(W);
    const sal = p => CBA.salaryIn(p, i, dec);
    const codes = teamCodes(W).filter(c => c !== "BOS").sort(() => r() - 0.5);
    const tradeable = (p, code) => !(p.noTrade && W.date < p.noTrade) && !p.two && sal(p) > 0;
    const bos = L.teamPlayers(W, "BOS").filter(p => tradeable(p, "BOS"));
    const ok = tr => { const c = L.checkTrade(W, tr); return c.ok && L.aiReact(W, tr, tr.b).verdict === "yes"; };
    const mk = (code, give, get, note) => ({ id: "o" + W.tick + "-" + out.length + "-" + code, from: code, done: false, note,
      tr: { a: "BOS", b: code, side: { BOS: { players: give.players || [], picks: give.picks || [], cash: 0 }, [code]: { players: get.players || [], picks: get.picks || [], cash: 0 } }, kickWaive: {} } });
    const combos = (arr, k) => { const res = []; const rec = (st, cur) => { if (cur.length && cur.length <= k) res.push(cur.slice()); if (cur.length === k) return; for (let x = st; x < arr.length; x++) { cur.push(arr[x]); rec(x + 1, cur); cur.pop(); } }; rec(0, []); return res; };
    const ourVal = id => pv(W, "BOS", W.P[id]);
    let budget = 2500;                                   // cap on trade checks so deadline day stays quick
    const tryAdd = (cands) => {
      let best = null;
      for (const c of cands) {
        if (budget-- <= 0) break;
        if (!ok(c.tr)) continue;
        const v = L.ourValue(W, c.tr);
        if (v < c.tol) continue;
        if (!best || v > best.v) best = { o: c, v };
      }
      if (best) out.push(best.o);
      return !!best;
    };
    for (const code of codes) {
      if (out.length >= max || budget <= 0) break;
      const t = W.T[code], fo = t.fo, pay = L.payrollNow(W, code);
      const theirs = L.teamPlayers(W, code).filter(p => tradeable(p, code));
      const picks = W.picks.filter(x => x.owner === code && x.y >= 2027 + i && !x.used).sort((a, b) => b.r - a.r || b.y - a.y);
      const sweet = [[], picks.filter(x => x.r === 2).slice(0, 1), picks.filter(x => x.r === 2).slice(0, 2), picks.filter(x => x.r === 1).slice(0, 1)].map(a => a.map(x => x.id));
      const cheapBos = bos.filter(p => p.id !== "jayson-tatum").sort((a, b) => ourVal(a.id) / Math.max(1, sal(a)) - ourVal(b.id) / Math.max(1, sal(b))).slice(0, 6);
      // 1) money moves: a team that wants out from under the tax sends Boston a contract, paying to do it
      const wantsOut = (fo.tax === "never" && pay > CBA.tax(i) - 3e6) || (fo.tax === "dodge" && pay > CBA.tax(i) && fo.mode !== "contend") || (pay > CBA.a2(i) && fo.tax !== "pay");
      if (wantsOut) {
        const dumps = theirs.filter(p => sal(p) >= 2e6 && !(p.c.rk && p.age <= 23)).sort((a, b) => pv(W, code, a) - pv(W, code, b)).slice(0, 5);
        const cands = [];
        for (const p of dumps) for (const sw of sweet) for (const back of [[], ...cheapBos.slice(0, 3).map(x => [x.id])]) {
          const o = mk(code, { players: back }, { players: [p.id], picks: sw }, `${fo.lead} wants ${/s$/.test(p.n) ? p.n + "'" : p.n + "'s"} salary off the books${sw.length ? " and will pay you to take it" : ""}.`);
          o.tol = -2e6; cands.push(o);
        }
        if (tryAdd(cands)) continue;
      }
      // 2) a contender or riser asks for a Boston player and builds a package around him
      if (fo.mode === "contend" || fo.mode === "rise") {
        const targets = bos.filter(p => Mo.r(p) >= 0.3 && sal(p) <= 40e6).map(p => ({ p, d: pv(W, code, p) - ourVal(p.id) })).sort((a, b) => b.d - a.d).slice(0, 2);
        const fodder = theirs.filter(p => sal(p) > 0).sort((a, b) => pv(W, code, a) / Math.max(1, sal(a)) - pv(W, code, b) / Math.max(1, sal(b))).slice(0, 7);
        const cands = [];
        for (const { p: target } of targets) for (const pkg of combos(fodder, 3)) {
          const s2 = pkg.reduce((a, x) => a + sal(x), 0);
          if (s2 > sal(target) * 2.2 + 3e6 || s2 < sal(target) * 0.4 - 3e6) continue;
          for (const sw of sweet) {
            if (sw.some(id => id.split("-")[1] === "1") && ourVal(target.id) < 15e6) continue;   // no firsts for role players
            const o = mk(code, { players: [target.id] }, { players: pkg.map(x => x.id), picks: sw }, `${fo.lead} wants ${target.n} for a playoff push.`); o.tol = -Math.max(3e6, 0.15 * Math.abs(ourVal(target.id))); cands.push(o);
          }
        }
        if (tryAdd(cands)) continue;
      }
      // 3) sellers: rebuilding or retooling teams move a veteran for Boston's young players and picks
      if (fo.mode === "rebuild" || fo.mode === "retool") {
        const vets = theirs.filter(p => p.age >= 26 && Mo.r(p) >= 0.8).sort((a, b) => Mo.r(b) - Mo.r(a)).slice(0, 2);
        const bp = W.picks.filter(x => x.owner === "BOS" && x.y >= 2027 + i && !x.used).sort((a, b) => b.r - a.r || b.y - a.y);
        const bsweet = [[], bp.filter(x => x.r === 2).slice(0, 1), bp.filter(x => x.r === 1).slice(-1)].map(a => a.map(x => x.id));
        const cands = [];
        for (const vet of vets) for (const pkg of combos(cheapBos, 3)) {
          const s2 = pkg.reduce((a, x) => a + sal(x), 0);
          if (s2 < sal(vet) * 0.75 - 1e6 || s2 > sal(vet) * 2 + 3e6) continue;
          for (const sw of bsweet) { const o = mk(code, { players: pkg.map(x => x.id), picks: sw }, { players: [vet.id] }, `${fo.lead} is selling. ${vet.n} is available.`); o.tol = -Math.max(4e6, 0.15 * Math.abs(pv(W, "BOS", vet))); cands.push(o); }
        }
        tryAdd(cands);
      }
    }
    return out;
  };
  L.acceptOffer = (W, id) => {
    const o = W.offers.find(x => x.id === id);
    if (!o || o.done) return { ok: false, why: "That offer is gone." };
    const chk = L.checkTrade(W, o.tr), re = L.aiReact(W, o.tr, o.tr.b);
    if (!chk.ok) return { ok: false, why: Object.values(chk.teams).flatMap(t => t.msgs).join(" ") };
    if (re.verdict !== "yes") { o.done = true; o.result = "pulled"; return { ok: false, why: `${W.T[o.from].name} pulled the offer.` }; }
    L.applyTrade(W, o.tr); o.done = true; o.result = "accepted";
    return { ok: true };
  };
  L.cpuDeadlineDumps = W => {
    const i = W.season;
    for (const code of teamCodes(W)) {
      if (code === "BOS") continue;
      const t = W.T[code];
      if (t.fo.tax !== "never") continue;
      const pay = L.payrollNow(W, code);
      if (pay <= CBA.tax(i)) continue;
      // find any team with room or an exception to take its worst contract (simplified: salary leaves the league ledger)
      const p = L.teamPlayers(W, code).filter(x => CBA.salaryIn(x, i, L.decider(W)) >= pay - CBA.tax(i)).sort((a, b) => pv(W, code, a) - pv(W, code, b))[0];
      if (!p) continue;
      const taker = teamCodes(W).filter(c => c !== code && c !== "BOS" && L.payrollNow(W, c) + CBA.salaryIn(p, i, L.decider(W)) < CBA.cap(i)).sort((a, b) => L.payrollNow(W, a) - L.payrollNow(W, b))[0];
      if (!taker) continue;
      const pk = W.picks.find(x => x.owner === code && x.r === 2 && x.y > 2027 + i);
      p.t = taker; if (pk) pk.owner = taker;
      news(W, `${t.name} dump ${p.n} on ${W.T[taker].name}${pk ? " with a second-round pick" : ""} to get under the tax.`, "trade");
    }
    L.bump(W);
  };

  // ================= Lottery and draft =================
  L.draftYear = W => 2027 + W.season;
  L.runLottery = W => {
    const r = L.rng(W), year = L.draftYear(W);
    const all = L.standings(W).slice().reverse().map(t => t.code);       // worst first
    const bottom3 = all.slice(0, 3);
    const lot = [];
    for (const conf of ["E", "W"]) {
      const c = W.post.conf[conf], st = c.order;
      lot.push({ code: c.playin.l78, balls: 1 });
      for (let k = 8; k < st.length; k++) lot.push({ code: st[k], balls: k <= 9 ? 2 : (bottom3.includes(st[k]) ? 2 : 3) });
    }
    // draw every lottery slot
    const pool = lot.slice(), order = [];
    while (pool.length) {
      const tot = sum(pool.map(x => x.balls)); let x = r() * tot, k = 0;
      while (x > pool[k].balls && k < pool.length - 1) { x -= pool[k].balls; k++; }
      order.push(pool.splice(k, 1)[0].code);
    }
    // the bottom three can't fall below 12th
    for (const code of bottom3) {
      const k = order.indexOf(code);
      if (k > 11) { order.splice(k, 1); order.splice(11, 0, code); }
    }
    // no No. 1 two years running
    W.lotHist = W.lotHist || {};
    if (W.lotHist[order[0]] === year - 1 && order.length > 1) { const a = order[0]; order[0] = order[1]; order[1] = a; }
    W.lotHist[order[0]] = year;
    const rest = all.filter(c => !order.includes(c));
    const r1 = order.concat(rest.sort((a, b) => W.T[a].w / Math.max(1, W.T[a].w + W.T[a].l) - W.T[b].w / Math.max(1, W.T[b].w + W.T[b].l)));
    const r2 = all.slice();
    const slots = [];
    r1.forEach((from, k) => slots.push({ slot: k + 1, round: 1, from }));
    r2.forEach((from, k) => slots.push({ slot: 31 + k, round: 2, from }));
    // who owns each pick
    for (const s of slots) {
      const pk = W.picks.find(x => x.y === year && x.r === s.round && x.from === s.from);
      s.owner = pk ? pk.owner : s.from; s.pid = pk ? pk.id : null;
    }
    const slotOf = from => slots.find(s => s.round === 1 && s.from === from);
    // Boston-San Antonio swap (2028, top-1 protected) and the better-of Philadelphia/Clippers pick
    for (const pk of W.picks.filter(x => x.y === year && x.swap)) {
      const mine = slotOf(pk.from), theirs = slotOf(pk.swap);
      if (mine && theirs && mine.slot < theirs.slot && mine.slot !== 1 && mine.owner === "BOS") { mine.owner = W.picks.find(x => x.id === `${year}-1-${pk.swap}`).owner; theirs.owner = "BOS"; news(W, `San Antonio swaps ${year} firsts with Boston.`, "draft", "BOS"); }
    }
    for (const pk of W.picks.filter(x => x.y === year && x.alt)) {
      const a = slotOf(pk.from), b = slotOf(W.picks.find(x => x.id === pk.alt).from);
      if (a && b && b.slot < a.slot) { const o = a.owner; a.owner = b.owner; b.owner = o; }
    }
    for (const s of slots) if (s.owner === "OUT") s.owner = teamCodes(W).filter(c => c !== "BOS")[Math.floor(r() * (teamCodes(W).length - 1))];
    if (!W.draft[year]) W.draft[year] = L.genClass(year, W.seed);
    W.ds = { year, slots, next: 0, lottery: order.slice(0, 16), balls: lot };
    const bos = slots.filter(s => s.owner === "BOS");
    news(W, `Lottery: ${W.T[order[0]].name} win the No. 1 pick.${bos.length ? ` Boston picks ${bos.map(s => "No. " + s.slot).join(" and ")}.` : ""}`, "draft");
    L.bump(W);
    return W.ds;
  };
  const posBucket = pos => pos === "C" ? "B" : pos === "PF" || pos === "SF" ? "W" : "G";
  L.boardValue = (W, code, x) => {
    const fo = W.T[code].fo;
    const potW = fo.mode === "rebuild" ? 0.8 : fo.mode === "contend" ? 0.5 : 0.65;
    return x.estPot * potW + x.estNow * (1 - potW) - x.rank * 0.002;
  };
  L.available = W => { const ds = W.ds, taken = new Set(ds.slots.filter(s => s.pick).map(s => s.pick)); return W.draft[ds.year].filter(x => !taken.has(x.id)); };
  L.makePick = (W, prospectId) => {
    const ds = W.ds, s = ds.slots[ds.next], x = W.draft[ds.year].find(y => y.id === prospectId);
    const i = W.season + 1;                                // rookie deals start next season
    const pid = x.id + "-nba";
    const pos = posBucket(x.pos);
    const p = { id: pid, n: x.n, t: s.owner, age: Math.floor(x.age), yos: 0, pos, ps: [x.pos], o: +(x.trueNow * 0.6).toFixed(2), d: +(x.trueNow * 0.4).toFixed(2),
      pot: x.truePot, h: 0.88, tpar: pos === "B" ? 0.15 : pos === "G" ? 0.42 : 0.38, ts: 0.55, usg: 18, note: `${ds.year} draft, No. ${s.slot}${x.gen ? " (generated prospect)" : ""}, from ${x.school}.`,
      c: { sal: [], opt: {}, dec: {}, signed: i, bird: 0, rk: s.round === 1 ? [ds.year, s.slot] : null } };
    if (s.round === 1) { const d = CBA.rookieDeal(s.slot, i); p.c.sal = d.sal; p.c.opt = d.opt; }
    else { p.c.sal[i] = CBA.minSal(0, i); p.c.sal[i + 1] = CBA.minSal(1, i + 1); p.c.opt = { [i + 1]: "NG" }; p.c.rfa = true; }
    W.P[pid] = p; s.pick = x.id; s.player = pid;
    if (s.pid) { const pk = W.picks.find(y => y.id === s.pid); if (pk) pk.used = true; }
    ds.next++;
    if (s.owner === "BOS" || s.slot <= 3) news(W, `No. ${s.slot}: ${W.T[s.owner].name} take ${x.n} (${x.pos}, ${x.school}).`, "draft", s.owner === "BOS" ? "BOS" : null);
    L.bump(W);
    return p;
  };
  // CPU picks until it's Boston's turn (or the draft ends)
  L.draftToBoston = W => {
    const ds = W.ds;
    while (ds.next < ds.slots.length) {
      const s = ds.slots[ds.next];
      if (s.owner === "BOS") return s;
      const av = L.available(W).sort((a, b) => L.boardValue(W, s.owner, b) - L.boardValue(W, s.owner, a));
      if (!av.length) { ds.next++; continue; }
      L.makePick(W, av[0].id);
    }
    return null;
  };
  L.finishDraft = W => {
    W.picks = W.picks.filter(x => x.y !== W.ds.year);
    W.ds.done = true;
    if (W.settings.expansion && W.ds.year === 2028 && !W.expanded) L.runExpansion(W);
    W.phase = "options"; W.date = L.dates(W.season).options;
    L.bump(W);
  };

  // ================= Options (June 29) =================
  // Players decide their options; CPU teams decide theirs; Boston's team calls come from the plan.
  L.optionCalls = W => {
    const j = W.season + 1, dec = L.decider(W), r = L.rng(W), out = [];
    for (const p of Object.values(W.P)) {
      if (!W.T[p.t] || !p.c || !p.c.opt || !p.c.opt[j] || p.c.dec[j]) continue;
      const kind = p.c.opt[j], bos = p.t === "BOS";
      let d;
      if (kind === "PO") {
        const re = bos ? W.plan.resign[p.id] : null;
        if (re && re.label === "Opt-out and re-sign" && re.start === j) {
          const odds = Mo.optOutDealOdds(p, j, re.sal.length, sum(re.sal), W).odds;
          if (r() < odds) { d = "out"; W.handshake = W.handshake || {}; W.handshake[p.id] = re; out.push(`${p.n} opts out and agrees to re-sign: ${re.sal.length} years, ${M$(sum(re.sal))}.`); }
          else { d = "in"; delete W.plan.resign[p.id]; out.push(`${p.n} turned down the opt-out deal and picked up his option.`); }
        } else d = r() < Mo.playerOptionOdds(p, j, W).pIn ? "in" : "out";
      } else if (kind === "TO" || kind === "NG") d = bos ? (W.plan.opt[p.id + "@" + j] || dec(p, j, kind)) : dec(p, j, kind);
      else if (kind === "MO") {
        const team = bos ? (W.plan.opt[p.id + "@" + j] || (Mo.mv(p, j, W) >= p.c.sal[j] * 0.8 ? "in" : "out")) : (Mo.mv(p, j, W) >= p.c.sal[j] * 0.8 ? "in" : "out");
        const player = r() < Mo.playerOptionOdds(p, j, W).pIn ? "in" : "out";
        d = team === "in" || player === "in" ? "in" : "out";
      }
      if (kind === "NG") continue;                          // guarantees are decided in camp
      p.c.dec[j] = d;
      if (bos || p.c.sal[j] >= 15e6) news(W, `${p.n} (${W.T[p.t].name}): ${CBA.OPT_NAME[kind].toLowerCase()} ${d === "in" ? "picked up" : "declined"}, ${M$(p.c.sal[j])}.`, "option", bos ? "BOS" : null);
    }
    for (const k of Object.keys(W.plan.opt)) if (+k.split("@")[1] <= j) delete W.plan.opt[k];
    out.forEach(x => news(W, x, "option", "BOS"));
    L.bump(W);
    return out;
  };

  // ================= New league year (July 1) =================
  L.newLeagueYear = W => {
    const prev = W.season, r = L.rng(W);
    for (const code of teamCodes(W)) { const t = W.T[code]; t.taxHist[prev] = L.payrollNow(W, code) > CBA.tax(prev); if (L.payrollNow(W, code) > CBA.a2(prev)) (t.overA2 || (t.overA2 = [])).push(prev); }
    W.season = prev + 1;
    const i = W.season, dec = L.decider(W);
    W.date = L.dates(prev).fa;
    for (const p of Object.values(W.P)) {
      if (p.t === "RET") continue;
      const team = p.t;
      Mo.develop(p, r);
      p.yos = (p.yos || 0) + (W.T[team] ? 1 : 0);
      if (!W.T[team]) {
        if (p.t === "FA" && (p.age >= 40 || (p.age >= 35 && Mo.r(p) < -1.5) || (Mo.r(p) < -3.2 && p.age >= 27))) { p.t = "RET"; }
        continue;
      }
      if (p.two) { p.t = "FA"; p.two = false; p.rights = null; p.c = { sal: [], opt: {}, dec: {}, signed: i, bird: 0 }; continue; }
      if (CBA.salaryIn(p, i, dec) > 0) { p.c.bird = (p.c.bird || 0) + 1; p.c.ext = false; continue; }
      // contract over: free agent, with his old team holding his rights (bird already counts the season just played)
      const prevSal = p.c.sal[prev] || CBA.minSal(p.yos, prev);
      const h = CBA.holdFor(p, i, prevSal);
      const rfa = !!((p.c.rk && p.c.rk[1] > 0 && p.c.rk[0] + 4 <= 2026 + i) || p.c.rfa) && p.yos <= 4;
      p.rights = { team, kind: h.bird, hold: h.amt, rfa, qo: rfa ? CBA.qualifyingOffer(p, i) : 0, prevSal, tendered: false };
      p.t = "FA";
      if (p.age >= 39 || (p.age >= 36 && Mo.r(p) < -1.6)) { p.t = "RET"; p.rights = null; news(W, `${p.n} retires.`, "info", team === "BOS" ? "BOS" : null); }
    }
    for (const code of teamCodes(W)) {
      const t = W.T[code];
      t.holds = []; t.w = 0; t.l = 0; t.inj = {};
      t.tpes = t.tpes.filter(x => !(x.exp && W.date > x.exp));
      if (t.rot) for (const id of Object.keys(t.rot)) if (!W.P[id] || W.P[id].t !== code) delete t.rot[id];
    }
    // qualifying offers: CPU teams tender the ones worth it; Boston tenders unless the plan renounced him
    for (const p of Object.values(W.P)) {
      if (p.t !== "FA" || !p.rights || !p.rights.rfa) continue;
      const bos = p.rights.team === "BOS";
      const worth = Mo.mv(p, i, W) >= p.rights.qo * 0.9;
      p.rights.tendered = bos ? !W.plan.renounce[p.id] && worth : worth;
      if (!p.rights.tendered) p.rights.rfa = false;
    }
    // Boston's renounced players
    for (const id of Object.keys(W.plan.renounce)) { const p = W.P[id]; if (p && p.rights && p.rights.team === "BOS") p.rights.renounced = true; }
    W.plan.renounce = {};
    // handshake deals agreed at the option deadline
    for (const [id, re] of Object.entries(W.handshake || {})) {
      const p = W.P[id]; if (!p || p.t !== "FA") continue;
      L.signSal(W, "BOS", id, re.sal, "bird", re.label);
    }
    W.handshake = {};
    for (const id of Object.keys(W.plan.resign)) if (W.plan.resign[id].start <= i) delete W.plan.resign[id];
    W.phase = "fa"; W.faRound = 0; W.faOffers = {}; W.post = null;
    news(W, `Free agency opens for ${CBA.seasonName(i)}. The cap is ${M$(CBA.cap(i))}, the tax line ${M$(CBA.tax(i))}.`, "info");
    L.bump(W);
  };
  L.signSal = (W, code, id, sal, via, label) => {
    const total = sum(sal);
    L.sign(W, code, id, sal.length, total, "flat", via);
    const p = W.P[id], i = W.season;
    p.c.sal = []; sal.forEach((x, k) => { p.c.sal[i + k] = x; });
    if (label) p.note = `${label}, ${CBA.seasonName(i)}.`;
    L.bump(W);
  };

  // ================= Free agency =================
  // What a team can spend on one player right now, and with which tool
  L.budget = (W, code, p) => {
    const i = W.season, t = W.T[code], used = t.used[i] || {};
    const pay = L.payrollNow(W, code);
    const own = p && p.rights && p.rights.team === code && !p.rights.renounced;
    const holds = sum(Object.values(W.P).filter(q => q.t === "FA" && q.rights && q.rights.team === code && !q.rights.renounced && q.id !== (p && p.id)).map(q => q.rights.hold));
    const n = L.rosterCount(W, code);
    const capNum = pay + holds + Math.max(0, 12 - n) * CBA.minSal(0, i);
    const room = CBA.cap(i) - capNum;
    const hard = t.hard[i] ? CBA.levelAmt(t.hard[i], i) : Infinity;
    const opts = [];
    if (own) opts.push({ via: "bird", amt: Math.min(CBA.maxSal(p.yos, i), hard - pay) });
    if (room > 0) opts.push({ via: "room", amt: Math.min(room, hard - pay) });
    if (!used.room && room <= 0 && pay + CBA.line("ntmle", i) <= Math.min(CBA.a1(i), hard) && !used.ntmle) opts.push({ via: "ntmle", amt: CBA.line("ntmle", i) - (used.ntmle || 0) });
    if (!used.ntmle && pay + CBA.line("tmle", i) <= Math.min(CBA.a2(i), hard) && !used.tmle) opts.push({ via: "tmle", amt: CBA.line("tmle", i) });
    if (!used.room && !used.bae && !(t.used[i - 1] || {}).bae && pay + CBA.line("bae", i) <= Math.min(CBA.a1(i), hard)) opts.push({ via: "bae", amt: CBA.line("bae", i) });
    if (used.room && !used.rmle) opts.push({ via: "rmle", amt: CBA.line("rmle", i) });
    opts.push({ via: "min", amt: p ? CBA.minSal(p.yos, i) : CBA.minSal(2, i) });
    return { opts: opts.filter(o => o.amt > 0), pay, room, n };
  };
  // Will this front office pay this much in this season, given its tax stance?
  const affordable = (W, code, aav) => {
    const i = W.season, fo = W.T[code].fo, pay = L.payrollNow(W, code) + aav;
    if (fo.tax === "never") return pay <= CBA.tax(i);
    if (fo.tax === "dodge") return fo.mode === "contend" ? pay <= CBA.a1(i) : pay <= CBA.tax(i);
    return pay <= CBA.a2(i) + 2e6;
  };
  L.faRound = W => {
    const i = W.season, r = L.rng(W), round = W.faRound || 0;
    const res = [0.97, 0.88, 0.75, 0.6][Math.min(3, round)];
    const fas = Object.values(W.P).filter(p => p.t === "FA" && !p.offerSheet).sort((a, b) => Mo.mv(b, i, W) - Mo.mv(a, i, W));
    const signed = [];
    const odds = L.titleOdds(W, 60);
    for (const p of fas) {
      const ask = Mo.faHaul(p, i, W);
      const offers = [];
      // Boston's offer (made on the board)
      const bo = (W.faOffers || {})[p.id];
      if (bo) {
        const b = L.budget(W, "BOS", p).opts.find(o => o.via === bo.via);
        const sal = CBA.buildSalaries(bo.years, bo.total, bo.shape || "flat", bo.via === "bird" ? 0.08 : 0.05);
        if (b && sal[0] <= b.amt + 1000 && (L.rosterCount(W, "BOS") < 15 || !L.inSeason(W))) offers.push({ code: "BOS", years: bo.years, total: bo.total, via: bo.via, shape: bo.shape || "flat" });
        else bo.failed = b ? `Only ${M$(b.amt)} available through that tool now.` : "That tool isn't available anymore.";
      }
      // CPU teams: his old team first, then the rest
      const cands = teamCodes(W).filter(c => c !== "BOS").map(c => ({ c, s: L.prefMult(W.T[c].fo, p) * (W.T[c].fo.mode === "contend" ? 1.15 : 1) * (0.7 + r() * 0.6) * (L.rosterCount(W, c) < 13 ? 1.4 : L.rosterCount(W, c) >= 15 ? 0.2 : 1) }))
        .sort((a, b) => b.s - a.s).slice(0, 8).map(x => x.c);
      if (p.rights && p.rights.team !== "BOS" && !cands.includes(p.rights.team)) cands.unshift(p.rights.team);
      for (const c of cands) {
        if (L.rosterCount(W, c) >= 15) continue;
        const own = p.rights && p.rights.team === c && !p.rights.renounced;
        const value = Mo.mv(p, i, W) * L.prefMult(W.T[c].fo, p) * (own ? 1.05 : 1);
        const want = Math.min(value, ask.aav * (1.02 - 0.05 * r()));
        if (want < ask.aav * res && want < CBA.minSal(p.yos, i) * 1.05) continue;
        const b = L.budget(W, c, p);
        const tool = b.opts.filter(o => o.amt >= Math.min(want, o.amt) && (o.via !== "min" || want <= CBA.minSal(p.yos, i) * 1.2)).sort((x, y) => y.amt - x.amt)[0];
        if (!tool) continue;
        const aav = Math.min(want, tool.amt);
        const franchise = own && (Mo.r(p) >= 2.5 || Mo.mv(p, i, W) >= 0.18 * CBA.cap(i));
        if (!franchise && !affordable(W, c, aav) && aav > CBA.minSal(p.yos, i) * 1.01) continue;
        const years = tool.via === "min" ? Math.min(2, ask.years) : tool.via === "tmle" || tool.via === "bae" ? Math.min(2, ask.years) : ask.years;
        offers.push({ code: c, years, total: aav * years, via: tool.via, shape: "flat" });
      }
      if (!offers.length) continue;
      const score = o => o.total / o.years * (1 + Math.min(o.years, ask.years) * 0.04) * (1 + 0.25 * (odds[o.code] || 0)) * (p.rights && p.rights.team === o.code ? 1.04 : 1);
      offers.sort((a, b) => score(b) - score(a));
      const best = offers[0];
      const floor = Math.max(CBA.minSal(p.yos, i), ask.aav * res);
      if (best.total / best.years < floor - 1000) continue;
      // restricted free agents: the old team can match
      if (p.rights && p.rights.rfa && p.rights.tendered && best.code !== p.rights.team) {
        if (p.rights.team === "BOS") { p.offerSheet = best; news(W, `${W.T[best.code].name} sign ${p.n} to an offer sheet: ${best.years} years, ${M$(best.total)}. Boston can match.`, "sign", "BOS"); continue; }
        const rt = p.rights.team;
        if (Mo.mv(p, i, W) * 1.1 >= best.total / best.years && affordable(W, rt, best.total / best.years)) {
          L.sign(W, rt, p.id, best.years, best.total, "flat", "bird"); signed.push(p.id);
          news(W, `${W.T[rt].name} match ${W.T[best.code].name}'s offer sheet for ${p.n}.`, "sign");
          continue;
        }
      }
      if (best.code === "BOS") delete W.faOffers[p.id];
      L.sign(W, best.code, p.id, best.years, best.total, best.shape, best.via);
      signed.push(p.id);
    }
    if (round >= 3) {
      for (const p of Object.values(W.P).filter(q => q.t === "FA" && !q.offerSheet)) {
        const ask = Mo.faHaul(p, i, W);
        if (ask.aav < CBA.minSal(p.yos, i) * 1.6) continue;
        const own = p.rights && !p.rights.renounced && p.rights.team !== "BOS" ? p.rights.team : null;
        if (own && L.rosterCount(W, own) < 15) { L.sign(W, own, p.id, Math.min(ask.years, 3), Math.round(ask.aav * 0.85) * Math.min(ask.years, 3), "flat", "bird"); signed.push(p.id); continue; }
        const roomy = teamCodes(W).filter(c => c !== "BOS" && L.rosterCount(W, c) < 15).map(c => ({ c, b: L.budget(W, c, p) })).map(x => ({ c: x.c, amt: Math.max(...x.b.opts.filter(o => o.via !== "min").map(o => o.amt), 0) })).sort((a, b) => b.amt - a.amt)[0];
        if (roomy && roomy.amt >= CBA.minSal(p.yos, i) * 1.5) { const aav = Math.min(roomy.amt, ask.aav); const via = L.budget(W, roomy.c, p).opts.find(o => o.amt >= aav - 1000 && o.via !== "min"); if (via) { L.sign(W, roomy.c, p.id, Math.min(2, ask.years), aav * Math.min(2, ask.years), "flat", via.via); signed.push(p.id); } }
      }
    }
    W.faRound = round + 1;
    W.date = L.addDays(W.date, round === 0 ? 5 : 4);
    L.bump(W);
    return signed;
  };
  L.matchSheet = (W, id, match) => {
    const p = W.P[id], o = p.offerSheet; if (!o) return;
    p.offerSheet = null;
    if (match) { L.sign(W, "BOS", id, o.years, o.total, "flat", "bird"); news(W, `Boston matches the offer sheet for ${p.n}.`, "sign", "BOS"); }
    else { p.rights = null; L.sign(W, o.code, id, o.years, o.total, "flat", o.via); news(W, `Boston lets ${p.n} go to ${W.T[o.code].name}.`, "sign", "BOS"); }
  };

  // ================= Camp: rosters to 15, new schedule =================
  L.toCamp = W => {
    const i = W.season, r = L.rng(W), dec = L.decider(W);
    for (const p of Object.values(W.P)) if (p.t === "FA" && p.offerSheet) L.matchSheet(W, p.id, false);
    // unsigned restricted free agents take their qualifying offers
    for (const p of Object.values(W.P)) if (p.t === "FA" && p.rights && p.rights.rfa && p.rights.tendered && p.rights.team !== "BOS")
      L.sign(W, p.rights.team, p.id, 1, p.rights.qo, "flat", "bird");
    for (const code of teamCodes(W)) {
      if (code === "BOS") continue;
      // non-guaranteed years: keep the ones worth it
      for (const p of L.teamPlayers(W, code)) if (p.c.opt[i] === "NG" && !p.c.dec[i]) p.c.dec[i] = Mo.mv(p, i, W) >= p.c.sal[i] * 0.7 ? "in" : "out";
      let ps = L.teamPlayers(W, code).filter(p => CBA.salaryIn(p, i, dec) > 0 || p.c.sal[i] > 0);
      for (const p of L.teamPlayers(W, code)) if (!(CBA.salaryIn(p, i, L.decider(W)) > 0)) { p.t = "FA"; p.rights = null; }
      ps = L.teamPlayers(W, code);
      while (ps.length > 15) { const cut = ps.sort((a, b) => pv(W, code, a) - pv(W, code, b))[0]; L.waive(W, code, cut.id, false); ps = L.teamPlayers(W, code); }
      while (ps.length < 14) {
        const fa = Object.values(W.P).filter(p => p.t === "FA" && !p.offerSheet && Mo.faHaul(p, i, W).aav <= CBA.minSal(p.yos, i) * 1.4).sort((a, b) => Mo.r(b) - Mo.r(a))[0];
        if (!fa) break;
        L.sign(W, code, fa.id, 1, CBA.minCapHit(fa.yos, i), "flat", "min");
        ps = L.teamPlayers(W, code);
      }
    }
    // Boston: fill to 14 with the best minimum players left, so opening night is legal
    let nb = L.teamPlayers(W, "BOS");
    while (nb.length < 14) {
      const fa = Object.values(W.P).filter(p => p.t === "FA" && !p.offerSheet && !(p.rights && p.rights.team === "BOS") && Mo.faHaul(p, i, W).aav <= CBA.minSal(p.yos, i) * 2).sort((a, b) => Mo.r(b) - Mo.r(a))[0];
      if (!fa) break;
      L.sign(W, "BOS", fa.id, 1, CBA.minCapHit(fa.yos, i), "flat", "min");
      news(W, `Boston fills the 14th roster spot with ${fa.n} on a minimum deal.`, "sign", "BOS");
      nb = L.teamPlayers(W, "BOS");
    }
    // Boston's own non-guaranteed calls from the plan
    for (const p of L.teamPlayers(W, "BOS")) if (p.c.opt[i] === "NG" && !p.c.dec[i]) p.c.dec[i] = W.plan.opt[p.id + "@" + i] || "in";
    for (const p of Object.values(W.P)) if (p.t === "FA" && p.rights) { p.rights = null; }
    W.phase = "pre"; W.date = L.dates(i).pre; W.offers = [];
    L.newSchedule(W);
    news(W, `Training camp for ${CBA.seasonName(i)}.`, "info");
    L.bump(W);
  };

  // ================= Expansion =================
  // 2004 Bobcats rules: each team protects eight; an expansion team takes at most one player from each team.
  const expValue = (W, p, i) => {
    const sal = CBA.salaryIn(p, i, L.decider(W));
    let v = 0;
    for (let k = 0; k < 3; k++) { const s = CBA.salaryIn(p, i + k, L.decider(W)); if (!s && k) break; v += (Mo.valueOf(Mo.rAhead(p, i - W.season + k), p.h, i + k, p.yos + k) - s) * Math.pow(0.9, k); }
    if (p.age <= 25 && p.pot != null) v += Math.max(0, p.pot - Mo.r(p)) * 4e6;
    return v + (sal ? 0 : -5e6);
  };
  L.protectList = (W, code, i) => {
    const dec = L.decider(W);
    const ps = Object.values(W.P).filter(p => p.t === code && !p.two && CBA.salaryIn(p, i, dec) > 0);
    if (code === "BOS" && W.expProtect && W.expProtect.length) return ps.filter(p => W.expProtect.includes(p.id)).slice(0, 8);
    return ps.sort((a, b) => (Mo.r(b) + (b.age <= 25 ? 0.5 * Math.max(0, (b.pot || 0) - Mo.r(b)) : 0)) - (Mo.r(a) + (a.age <= 25 ? 0.5 * Math.max(0, (a.pot || 0) - Mo.r(a)) : 0))).slice(0, 8);
  };
  L.expansionPreview = W => {
    if (W.expanded || W.season > 1) return null;
    const i = 2, dec = L.decider(W);
    const under = Object.values(W.P).filter(p => p.t === "BOS" && !p.two && CBA.salaryIn(p, i, dec) > 0);
    const protect = L.protectList(W, "BOS", i);
    const exposed = under.filter(p => !protect.includes(p)).map(p => ({ p, v: expValue(W, p, i) })).sort((a, b) => b.v - a.v);
    const likely = exposed[0] || null;
    let why = "";
    if (likely) {
      const p = likely.p, yrs = CBA.lastYear(p, dec, i) - i + 1;
      why = `${p.n} would be ${p.age + (i - W.season)} in 2028-29 with ${yrs} year${yrs > 1 ? "s" : ""} left at ${M$(CBA.salaryIn(p, i, dec))}. He's the best value Boston can't protect.`;
      if (exposed.length > 1) why += ` Next in line: ${exposed[1].p.n}.`;
    }
    return { i, protect, exposed, likely, why };
  };
  L.runExpansion = W => {
    const i = W.season + 1, r = L.rng(W);
    const exp = [{ code: "SEA", name: "Seattle SuperSonics", conf: "W" }, { code: "LVA", name: "Las Vegas Aces", conf: "W" }];
    W.T.MEM.conf = "E";
    for (const e of exp) W.T[e.code] = { code: e.code, name: e.name, conf: e.conf, fo: { lead: "Expansion GM", title: "General manager", tax: "never", mode: "rebuild", wants: ["youth", "picks"], style: "Brand-new franchise building from the expansion draft." }, rep: false, tpes: [], dead: [], holds: [], used: {}, hard: {}, taxHist: {}, w: 0, l: 0, rot: null, expansion: true };
    const pool = [];
    for (const code of teamCodes(W)) {
      if (exp.some(e => e.code === code)) continue;
      const prot = new Set(L.protectList(W, code, i).map(p => p.id));
      for (const p of Object.values(W.P)) if (p.t === code && !p.two && !prot.has(p.id) && CBA.salaryIn(p, i, L.decider(W)) > 0) pool.push({ p, code, v: expValue(W, p, i) });
    }
    pool.sort((a, b) => b.v - a.v);
    const lost = new Set();
    let k = 0;
    for (const x of pool) {
      if (lost.has(x.code)) continue;
      const e = exp[k % 2];
      x.p.t = e.code; lost.add(x.code); k++;
      if (x.code === "BOS") news(W, `Expansion draft: ${e.name} take ${x.p.n} from Boston.`, "draft", "BOS");
      if (lost.size >= teamCodes(W).length - 2) break;
    }
    for (const e of exp) for (let y = 2029; y <= 2035; y++) for (const rd of [1, 2]) W.picks.push({ id: `${y}-${rd}-${e.code}`, y, r: rd, from: e.code, owner: e.code });
    W.expanded = true;
    news(W, "Seattle and Las Vegas join the league for 2028-29. Memphis moves to the East.", "info");
    L.bump(W);
  };

  if (typeof module !== "undefined") module.exports = L; else root.League = L;
})(typeof window !== "undefined" ? window : globalThis);
