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

  // ================= Rosters =================
  // Guaranteed money still owed if a team waived him today
  L.deadIfWaived = (W, p) => {
    const i = W.season, dec = L.decider(W); let s = 0;
    for (let j = i; j < i + 6; j++) { const x = CBA.salaryIn(p, j, dec); if (!x) continue; if (p.c.opt[j] === "NG" || p.c.opt[j] === "TO") break; s += x; }
    return s;
  };
  // Get a CPU roster to 15 the way real teams do: non-guaranteed and minimum deals go first, then the smallest
  // dead-money hit. Never someone signed this summer.
  L.trimRoster = (W, code, max = 15) => {
    let ps = L.teamPlayers(W, code);
    while (ps.length > max) {
      const fresh = p => (p.c.signed >= W.season && p.c.how && p.c.how !== "min") || (p.c.rk && p.c.rk[1] > 0 && 2026 + W.season - p.c.rk[0] <= (p.c.rk[1] <= 14 ? 4 : 2));
      const cands = ps.filter(p => !fresh(p));
      const pool = cands.length ? cands : ps;
      // keeping a player is worth what he produces, less whatever cutting him would save (guaranteed money is spent either way)
      const dec = L.decider(W), i = W.season;
      const keep = p => {
        let prod = 0, owed = 0;
        for (let j = i; j < i + 3; j++) { const s = CBA.salaryIn(p, j, dec); if (!s) break; prod += Mo.mv(p, j, W) * Math.pow(0.85, j - i); owed += s; }
        return prod - Math.max(0, owed - L.deadIfWaived(W, p));
      };
      const cut = pool.map(p => ({ p, k: keep(p) })).sort((a, b) => a.k - b.k)[0].p;
      L.waive(W, code, cut.id, false);
      ps = L.teamPlayers(W, code);
    }
  };
  L.cpuRosters = W => {
    const i = W.season, dec = L.decider(W);
    for (const code of teamCodes(W)) {
      if (code === "BOS") continue;
      for (const p of L.teamPlayers(W, code)) if (p.c.opt[i] === "NG" && !p.c.dec[i]) p.c.dec[i] = Mo.mv(p, i, W) >= p.c.sal[i] * 0.7 ? "in" : "out";
      for (const p of L.teamPlayers(W, code)) if (!(CBA.salaryIn(p, i, dec) > 0)) { p.t = "FA"; p.rights = null; p.faDate = W.date; }
      L.trimRoster(W, code);
    }
    L.bump(W);
  };

  // ================= Ownership =================
  // Bill Chisholm's patience. Results against expectations and the tax bill move it; it sets next season's rule.
  L.MANDATES = {
    a2once: "Spend what it takes for a real title shot. The second apron is fine, just not two years running.",
    a2: "Tax is fine. Stay under the second apron.",
    a1: "Stay under the first apron.",
    tax: "Get under the tax."
  };
  L.ensureOwner = W => {
    if (!W.owner) W.owner = { name: "Bill Chisholm", trust: 60, mandate: { season: 0, rule: "tax", text: "No tax in 2026-27." }, log: [] };
    return W.owner;
  };
  L.ruleFor = trust => trust >= 75 ? "a2once" : trust >= 55 ? "a2" : trust >= 35 ? "a1" : "tax";
  L.mandateCheck = (W, payroll, i = W.season) => {
    const o = L.ensureOwner(W), m = o.mandate;
    if (!m || m.season !== i) return { ok: true };
    const lvl = m.rule === "tax" ? CBA.tax(i) : m.rule === "a1" ? CBA.a1(i) : CBA.a2(i);
    if (m.rule === "a2once") {
      const last = (W.T.BOS.overA2 || []).includes(i - 1);
      return payroll > lvl && last ? { ok: false, text: "Over the second apron two years running." } : { ok: true };
    }
    return payroll > lvl ? { ok: false, text: `${M$(payroll - lvl)} over the ${CBA.LEVEL_NAME[m.rule === "tax" ? "tax" : m.rule]}. Ownership's rule: ${m.text}` } : { ok: true, room: lvl - payroll };
  };
  const PTS = { "Won the title": 5, "Lost in the Finals": 4, "Lost in the conference finals": 3, "Lost in the second round": 2, "Lost in the first round": 1, "Lost in the play-in": 0.4, "Missed the playoffs": 0 };
  // What ownership expects in the playoffs from where Boston ranked in the preseason (title odds are long for everyone)
  L.expectedRun = rank => rank <= 1 ? 3.0 : rank <= 3 ? 2.6 : rank <= 6 ? 2.0 : rank <= 10 ? 1.3 : rank <= 16 ? 0.7 : 0.3;
  const EXP_NAME = x => x >= 3 ? "the conference finals" : x >= 2.5 ? "the second round or better" : x >= 2 ? "the second round" : x >= 1.3 ? "a playoff series" : x >= 0.7 ? "the play-in" : "progress";
  const sgn = x => (x >= 0 ? "+" : "") + Math.round(x);
  L.ownerReview = (W, run, payroll, tax) => {
    const o = L.ensureOwner(W), i = W.season, e = W.exp || {};
    const rank = e.rank || 10, expPts = L.expectedRun(rank);
    const res = PTS[run] ?? 0;
    const kept = L.mandateCheck(W, payroll, i).ok;
    const before = o.trust;
    const B = W.T.BOS;
    // the regular season counts: beating the projection by a lot buys real credit even if the playoffs go badly
    const dReg = e.projWins ? Math.max(-10, Math.min(10, 0.8 * (B.w - e.projWins))) : 0;
    const dPost = 5 * (res - expPts);
    const dTax = tax ? -(tax / 8e6) * (res < expPts ? 1.3 : res > expPts ? 0.7 : 1) : 0;   // big bills sting more when the run falls short
    const dRule = kept ? 4 : -18, dTitle = res === 5 ? 15 : 0;
    const d = dReg + dPost + dTax + dRule + dTitle;
    o.trust = Math.max(0, Math.min(100, Math.round(before + d)));
    const rule = L.ruleFor(o.trust);
    const lines = [];
    if (e.projWins) lines.push(`${B.w}-${B.l} against a ${Math.round(e.projWins)}-win projection: ${sgn(dReg)}.`);
    lines.push(`${run}; he expected ${EXP_NAME(expPts)}: ${sgn(dPost + dTitle)}.`);
    lines.push(tax ? `A ${M$(tax)} tax bill: ${sgn(dTax)}.` : "No tax bill.");
    lines.push(kept ? `Kept his rule: +4.` : `Broke his rule: -18.`);
    if (o.trust < 15) { o.fired = true; lines.push("Ownership has seen enough: you're fired."); }
    else lines.push(`Next season: ${L.MANDATES[rule]}`);
    o.mandate = { season: i + 1, rule, text: L.MANDATES[rule] };
    o.log.unshift({ season: i, before, after: o.trust, run, tax, text: lines.join(" ") });
    news(W, `${o.name}: ${lines.join(" ")}`, "owner", "BOS");
    return o;
  };

  // ================= In-season phases =================
  L.startSeason = W => {
    L.cpuRosters(W);
    L.ensureOwner(W);
    const n = L.rosterCount(W, "BOS");
    if (n > 15) return { ok: false, why: `Boston has ${n} players under contract. Get to 15 before opening night (Moves: waive).` };
    const rec = W.season === 0 ? L.liveStart(W) : null;
    if (rec) { L.newSchedule(W, rec); W.date = W.live.updated ? W.live.updated.slice(0, 10) : W.date; news(W, `Picked up from the real standings as of ${L.fmtDate(W.date)}.`, "info"); }
    else if (!W.sched || !W.sched.length || W.sched.some(g => g.done)) L.newSchedule(W);
    W.phase = "reg";
    if (!rec) W.date = L.dates(W.season).open;
    const nets = L.teamNets(W), rank = Object.values(nets).filter(x => x > nets.BOS).length + 1;
    W.exp = { season: W.season, projWins: L.projWins(W, "BOS"), rank, odds: (L.titleOdds(W, 120).BOS || 0) };
    L.bump(W);
    return { ok: true };
  };
  // Calls start coming three weeks before the deadline, a couple a week; each one is good for about ten days
  L.expireOffers = W => { for (const o of W.offers || []) if (!o.done && o.exp && W.date > o.exp) { o.done = true; o.result = "expired"; } };
  L.simDays = (W, days) => {
    const d = L.dates(W.season);
    let target = L.addDays(W.date, days);
    if (W.phase === "reg" && target >= d.deadline) target = d.deadline;
    if (target >= d.end) target = "9999-12-31";                 // last week: finish every scheduled game
    L.simUntil(W, target);
    if (target === "9999-12-31") W.date = d.end;
    L.expireOffers(W);
    if (W.phase === "reg" || W.phase === "reg2" || W.phase === "deadline") L.inSeasonSignings(W);
    let calls = 0;
    if (W.phase === "reg" && W.date >= L.addDays(d.deadline, -21) && W.date < d.deadline) {
      const busy = new Set((W.offers || []).filter(o => !o.done).map(o => o.from));
      const more = L.makeOffers(W, 2, busy).map(o => Object.assign(o, { exp: L.addDays(W.date, 10) < d.deadlineEnd ? L.addDays(W.date, 10) : d.deadlineEnd }));
      W.offers = (W.offers || []).concat(more); calls = more.length;
      if (calls) news(W, `${calls} team${calls > 1 ? "s" : ""} called about a trade.`, "info", "BOS");
    }
    if (W.phase === "reg" && W.date >= d.deadline) L.openDeadline(W);
    else if (W.date >= d.end) W.phase = W.phase === "deadline" ? "deadline" : "reg2";
    L.bump(W);
    return { date: W.date, calls };
  };
  L.openDeadline = W => {
    W.phase = "deadline"; W.date = L.dates(W.season).deadline;
    L.expireOffers(W);
    const busy = new Set((W.offers || []).filter(o => !o.done).map(o => o.from));
    W.offers = (W.offers || []).concat(L.makeOffers(W, 4, busy).map(o => Object.assign(o, { exp: L.dates(W.season).deadlineEnd })));
    news(W, `Deadline week. ${W.offers.filter(o => !o.done).length} offers on the table.`, "info", "BOS");
    L.bump(W);
  };
  L.closeDeadline = W => {
    W.phase = "reg2"; W.date = L.dates(W.season).deadlineEnd;
    (W.offers || []).forEach(o => { if (!o.done) { o.done = true; o.result = "expired"; } });
    L.cpuDeadlineDumps(W);
    L.bump(W);
  };
  L.finishRegular = W => {
    if (W.phase === "reg") { L.simUntil(W, L.dates(W.season).deadline); L.openDeadline(W); return; }
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
    L.ownerReview(W, run, b.payroll, b.tax);
    W.phase = "draft"; W.date = L.dates(W.season).finals;
    L.bump(W);
    return run;
  };

  // ================= Trade calls =================
  // Teams call with deals they'd sign off on: the most they can get that Boston might take. Every offer is
  // checked against the CBA for both sides, and every trade has something going each way.
  L.makeOffers = (W, max, skip) => {
    const r = L.rng(W), out = [], i = W.season, dec = L.decider(W);
    const sal = p => CBA.salaryIn(p, i, dec);
    const codes = teamCodes(W).filter(c => c !== "BOS" && !(skip && skip.has(c))).sort(() => r() - 0.5);
    const tradeable = p => !(p.noTrade && W.date < p.noTrade) && !(p.tradeOk && W.date < p.tradeOk) && !p.two && sal(p) > 0;
    const bos = L.teamPlayers(W, "BOS").filter(tradeable);
    const mk = (code, give, get, note) => {
      const tr = { a: "BOS", b: code, side: { BOS: { players: give.players || [], picks: give.picks || [], cash: give.cash || 0 }, [code]: { players: get.players || [], picks: get.picks || [], cash: get.cash || 0 } }, kickWaive: {}, prot: Object.assign({}, give.prot || {}, get.prot || {}) };
      // nothing going back? Boston sends the smallest thing it can
      if (!tr.side.BOS.players.length && !tr.side.BOS.picks.length && !tr.side.BOS.cash) { const tk = L.token(W, "BOS"); tr.side.BOS.picks = tk.picks; tr.side.BOS.cash = tk.cash; Object.assign(tr.prot, tk.prot); }
      if (!tr.side[code].players.length && !tr.side[code].picks.length && !tr.side[code].cash) { const tk = L.token(W, code); tr.side[code].picks = tk.picks; tr.side[code].cash = tk.cash; Object.assign(tr.prot, tk.prot); }
      return { id: "o" + W.tick + "-" + out.length + "-" + code, from: code, done: false, note, tr };
    };
    const combos = (arr, k) => { const res = []; const rec = (st, cur) => { if (cur.length && cur.length <= k) res.push(cur.slice()); if (cur.length === k) return; for (let x = st; x < arr.length; x++) { cur.push(arr[x]); rec(x + 1, cur); cur.pop(); } }; rec(0, []); return res; };
    const ourVal = id => pv(W, "BOS", W.P[id]);
    let budget = 2200;                                   // cap on trade checks so a sim week stays quick
    const tryAdd = cands => {
      let best = null;
      for (const c of cands) {
        if (budget-- <= 0) break;
        const chk = L.checkTrade(W, c.tr);
        if (!chk.ok) continue;
        if (chk.teams.BOS.P2 > chk.teams.BOS.P && !L.mandateCheck(W, chk.teams.BOS.P2).ok) continue;   // they know Boston's owner won't allow it
        // a salary dump has to actually take money off their books
        if (c.cut && chk.teams[c.tr.b].P - chk.teams[c.tr.b].P2 < c.cut) continue;
        const re = L.aiReact(W, c.tr, c.tr.b);
        if (re.verdict !== "yes") continue;
        const v = L.ourValue(W, c.tr);
        if (v < c.tol) continue;
        // they ask for as much as they think Boston will stand for
        if (!best || re.delta > best.d) best = { o: c, d: re.delta };
      }
      if (best) { out.push(best.o); best.o.tr.side.BOS.players.forEach(id => asked.add(id)); }
      return !!best;
    };
    const asked = new Set((W.offers || []).filter(o => !o.done).flatMap(o => o.tr.side.BOS.players));
    for (const code of codes) {
      if (out.length >= max || budget <= 0) break;
      const t = W.T[code], fo = t.fo, pay = L.payrollNow(W, code);
      const theirs = L.teamPlayers(W, code).filter(tradeable);
      const picks = W.picks.filter(x => x.owner === code && x.y >= 2027 + i && !x.used).sort((a, b) => b.r - a.r || b.y - a.y);
      const seconds = picks.filter(x => x.r === 2), firsts = picks.filter(x => x.r === 1);
      // a first goes out protected: lottery-protected from a good team, top-10 from a middling one
      const protFirst = () => { const f = firsts.slice(-1)[0]; if (!f) return null; const slot = L.pickSlot(W, f); return { picks: [f.id], prot: { [f.id]: slot >= 18 ? 14 : slot >= 10 ? 10 : 5 } }; };
      const cheapBos = bos.filter(p => p.id !== "jayson-tatum").sort((a, b) => ourVal(a.id) / Math.max(1, sal(a)) - ourVal(b.id) / Math.max(1, sal(b))).slice(0, 6);
      // 1) money moves: a team that wants out of the tax sends Boston a contract, and pays for it with seconds.
      //    A first only for a contract that's truly underwater.
      const wantsOut = (fo.tax === "never" && pay > CBA.tax(i) - 3e6) || (fo.tax === "dodge" && pay > CBA.tax(i) && fo.mode !== "contend") || (pay > CBA.a2(i) && fo.tax !== "pay");
      if (wantsOut) {
        const dumps = theirs.filter(p => sal(p) >= 2e6 && !(p.c.rk && p.age <= 23)).sort((a, b) => pv(W, code, a) - pv(W, code, b)).slice(0, 5);
        const cands = [];
        for (const p of dumps) {
          const bad = pv(W, code, p) <= -20e6;
          const sweets = [{ picks: [] }, { picks: seconds.slice(0, 1).map(x => x.id) }, { picks: seconds.slice(0, 2).map(x => x.id) }].concat(bad && protFirst() ? [protFirst()] : []);
          // anything Boston sends back has to be much cheaper, or it isn't a salary dump
          const backs = [[], ...cheapBos.filter(x => sal(x) <= sal(p) * 0.4).slice(0, 3).map(x => [x.id])];
          for (const sw of sweets) for (const back of backs) {
            const o = mk(code, { players: back }, { players: [p.id], picks: sw.picks, prot: sw.prot }, `${fo.lead} wants ${/s$/.test(p.n) ? p.n + "'" : p.n + "'s"} salary off the books${sw.picks.length ? " and will attach a pick to move it" : ""}.`);
            o.tol = -1.5e6; o.cut = Math.max(2e6, 0.6 * sal(p)); cands.push(o);
          }
        }
        if (tryAdd(cands)) continue;
      }
      // 2) a contender or riser asks for a Boston player and builds a package around him
      if (fo.mode === "contend" || fo.mode === "rise") {
        const targets = bos.filter(p => Mo.r(p) >= 0.3 && sal(p) <= 40e6 && !asked.has(p.id)).map(p => ({ p, d: pv(W, code, p) - ourVal(p.id) })).sort((a, b) => b.d - a.d).slice(0, 2);
        const fodder = theirs.filter(p => sal(p) > 0).sort((a, b) => pv(W, code, a) / Math.max(1, sal(a)) - pv(W, code, b) / Math.max(1, sal(b))).slice(0, 7);
        const cands = [];
        for (const { p: target } of targets) for (const pkg of combos(fodder, 3)) {
          const s2 = pkg.reduce((a, x) => a + sal(x), 0);
          if (s2 > sal(target) * 2.2 + 3e6 || s2 < sal(target) * 0.4 - 3e6) continue;
          // a first only for a real difference-maker, and protected
          const real = pv(W, code, target) >= 25e6 && Mo.r(target) >= 1.5;
          const sweets = [{ picks: [] }, { picks: seconds.slice(0, 1).map(x => x.id) }, { picks: seconds.slice(0, 2).map(x => x.id) }].concat(real && protFirst() ? [protFirst()] : []);
          for (const sw of sweets) { const o = mk(code, { players: [target.id] }, { players: pkg.map(x => x.id), picks: sw.picks, prot: sw.prot }, `${fo.lead} wants ${target.n}.`); o.tol = -Math.max(3e6, 0.15 * Math.abs(ourVal(target.id))); cands.push(o); }
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

  // ================= Shopping a contract =================
  // Every team's price to take Boston players off the books: what they'd give, or what Boston has to attach.
  // Ordered from best to worst for Boston.
  L.shopPlayers = (W, ids) => {
    const i = W.season, dec = L.decider(W), out = [];
    const sal = p => CBA.salaryIn(p, i, dec);
    const bp = W.picks.filter(x => x.owner === "BOS" && x.y >= 2027 + i && !x.used).sort((a, b) => a.y - b.y || a.r - b.r);
    const b2 = bp.filter(x => x.r === 2), b1 = bp.filter(x => x.r === 1).sort((a, b) => b.y - a.y);   // farthest-out first is cheapest
    const P0 = L.payrollNow(W, "BOS");
    for (const code of teamCodes(W)) {
      if (code === "BOS") continue;
      const theirs = L.teamPlayers(W, code).filter(p => sal(p) > 0 && !p.two && !(p.noTrade && W.date < p.noTrade));
      const cp = W.picks.filter(x => x.owner === code && x.y >= 2027 + i && !x.used).sort((a, b) => b.r - a.r || b.y - a.y);
      const c2 = cp.filter(x => x.r === 2), c1 = cp.filter(x => x.r === 1);
      // salary they might need to send back to make the trade legal for them: their least valuable per dollar
      const fodder = theirs.sort((a, b) => pv(W, code, a) / Math.max(1, sal(a)) - pv(W, code, b) / Math.max(1, sal(b))).slice(0, 3);
      const outSal = ids.reduce((a, id) => a + sal(W.P[id]), 0);
      const backs = [[], ...fodder.filter(p => sal(p) <= outSal * 0.7).sort((a, b) => sal(a) - sal(b)).map(p => [p.id])];
      const variants = [];
      for (const back of backs) {
        if (c1.length) variants.push({ get: { players: back, picks: [c1[c1.length - 1].id] }, give: {} });
        if (c2.length > 1) variants.push({ get: { players: back, picks: c2.slice(0, 2).map(x => x.id) }, give: {} });
        if (c2.length) variants.push({ get: { players: back, picks: [c2[0].id] }, give: {} });
        variants.push({ get: { players: back }, give: {} });
        if (b2.length) variants.push({ get: { players: back }, give: { picks: [b2[0].id] } });
        if (b2.length > 1) variants.push({ get: { players: back }, give: { picks: b2.slice(0, 2).map(x => x.id) } });
        for (const f of b1) { variants.push({ get: { players: back }, give: { picks: [f.id], prot: { [f.id]: 10 } } }); variants.push({ get: { players: back }, give: { picks: [f.id] } }); }
      }
      for (const v of variants) {
        const tr = { a: "BOS", b: code, side: { BOS: { players: ids.slice(), picks: v.give.picks || [], cash: 0 }, [code]: { players: v.get.players || [], picks: v.get.picks || [], cash: 0 } }, kickWaive: {}, prot: Object.assign({}, v.give.prot || {}) };
        if (!tr.side[code].players.length && !tr.side[code].picks.length) { const tk = L.token(W, code); tr.side[code].picks = tk.picks; tr.side[code].cash = tk.cash; Object.assign(tr.prot, tk.prot); }
        const chk = L.checkTrade(W, tr);
        if (!chk.ok) continue;
        const re = L.aiReact(W, tr, code);
        if (re.verdict !== "yes") continue;
        const P2 = chk.teams.BOS.P2;
        out.push({ code, tr, ours: L.ourValue(W, tr), saved: P0 - P2, taxSaved: CBA.taxBill(P0, i, L.repeater(W, "BOS", i)) - CBA.taxBill(P2, i, L.repeater(W, "BOS", i)), tpe: (chk.teams.BOS.sol.newTpes || []).reduce((a, x) => Math.max(a, x.amt), 0) });
        break;                                               // variants run best-for-Boston first
      }
    }
    return out.sort((a, b) => (b.taxSaved + b.ours + 0.2 * b.saved) - (a.taxSaved + a.ours + 0.2 * a.saved));
  };
  L.cpuDeadlineDumps = W => {
    const i = W.season;
    for (const code of teamCodes(W)) {
      if (code === "BOS") continue;
      const t = W.T[code];
      if (t.fo.tax !== "never") continue;
      const pay = L.payrollNow(W, code);
      if (pay <= CBA.tax(i)) continue;
      const p = L.teamPlayers(W, code).filter(x => CBA.salaryIn(x, i, L.decider(W)) >= pay - CBA.tax(i)).sort((a, b) => pv(W, code, a) - pv(W, code, b))[0];
      if (!p) continue;
      const taker = teamCodes(W).filter(c => c !== code && c !== "BOS" && L.payrollNow(W, c) + CBA.salaryIn(p, i, L.decider(W)) < CBA.cap(i)).sort((a, b) => L.payrollNow(W, a) - L.payrollNow(W, b))[0];
      if (!taker) continue;
      const pk = W.picks.find(x => x.owner === code && x.r === 2 && x.y > 2027 + i);
      p.t = taker; if (pk) pk.owner = taker;
      news(W, `${t.name} send ${p.n}${pk ? " and a second-round pick" : ""} to ${W.T[taker].name} to get under the tax.`, "trade");
    }
    L.bump(W);
  };

  // ================= Next step =================
  // One button that always knows what comes next
  L.nextAction = W => {
    const o = L.ensureOwner(W);
    if (o.fired) return { act: "seRehire", label: "Start over as the new GM" };
    const ph = W.phase;
    if (ph === "pre") return { act: "seStart", label: "Start the season" };
    if (ph === "reg" || ph === "reg2") {
      if (!L.gamesLeft(W) || W.date >= L.dates(W.season).end) return { act: "seEnd", label: "Start the playoffs" };
      const calls = (W.offers || []).filter(x => !x.done).length;
      return { act: "seWeek", label: calls ? `Sim a week (${calls} call${calls > 1 ? "s" : ""} waiting)` : "Sim a week" };
    }
    if (ph === "deadline") return { act: "seClose", label: "Close the deadline" };
    if (ph === "playoffs") return { act: "sePlay", label: "Play the playoffs" };
    if (ph === "draft") {
      const ds = W.ds && W.ds.year === L.draftYear(W) ? W.ds : null;
      if (!ds) return { act: "seLottery", label: "Run the lottery" };
      if (ds.next >= ds.slots.length || ds.done) return { act: "dfDone", label: "On to option decisions" };
      if (ds.slots[ds.next].owner === "BOS") return { act: "dfGo", label: `Make Boston's pick (No. ${ds.slots[ds.next].slot})` };
      return { act: "dfRun", label: ds.slots.slice(ds.next).some(x => x.owner === "BOS") ? "Draft to Boston's pick" : "Finish the draft" };
    }
    if (ph === "expansion") return W.expanded ? { act: "exDone", label: "On to option decisions" } : { act: "exRun", label: "Run the expansion draft" };
    if (ph === "options") return L.expansionDue(W) ? { act: "exOpen", label: "Hold the expansion draft" } : { act: "opGo", label: "Make the calls, open free agency" };
    if (ph === "fa") return (W.faRound || 0) >= 4 ? { act: "faCamp", label: "To training camp" } : { act: "faNext", label: `Next free-agency round (${(W.faRound || 0) + 1} of 4)` };
    return { act: "seStart", label: "Next" };
  };

  // ================= Lottery and draft =================
  L.draftYear = W => 2027 + W.season;
  // Classes after 2027: real high school recruits as one-and-done freshmen, real prospects who went undrafted
  // last year coming back, then generated players to fill out the board.
  const HS_SLOTS = [1, 2, 3, 5, 6, 8, 10, 12, 14, 16, 19, 22, 25, 28, 31, 34, 37];
  L.buildClass = (W, year) => {
    const rec = (W.recruits || {})[year] || [];
    const list = [];
    rec.forEach((x, k) => list.push({ id: x.id, n: x.n, pos: x.pos, school: x.school, age: 19, rank: HS_SLOTS[k] ?? 40 + k, real: true }));
    const prev = W.draft[year - 1] || [];
    const taken = new Set(Object.values(W.P).map(p => p.n));
    const back = prev.filter(x => !taken.has(x.n) && !x.gen && x.age + 1 < 24).slice(0, 25);
    let slot = 4;
    for (const x of back) {
      while (list.some(y => y.rank === slot)) slot++;
      list.push({ id: x.id, n: x.n, pos: x.pos, school: x.school + " (returning)", age: +(x.age + 1).toFixed(1), rank: slot, real: !x.gen, trueNow: x.trueNow + 0.3, truePot: x.truePot });
      slot += 2;
    }
    const gen = L.genClass(year, W.seed).filter(g => !list.some(y => y.n === g.n));
    let k = 1;
    for (const g of gen) { while (list.some(y => y.rank === k)) k++; if (list.length >= 90) break; list.push(Object.assign({}, g, { rank: k })); }
    const scouted = L.scoutClass(list.sort((a, b) => a.rank - b.rank).map((x, j) => Object.assign({}, x, { rank: j + 1 })), year, W.seed);
    // returning players keep what was really in them
    return scouted.map((x, j) => { const o = list.find(y => y.id === x.id); return o && o.truePot != null ? Object.assign(x, { trueNow: o.trueNow, truePot: o.truePot }) : x; });
  };
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
    // protected picks that land inside their protection stay home; a protected first rolls to next year's first
    for (const s of slots) {
      const pk = s.pid ? W.picks.find(x => x.id === s.pid) : null;
      if (!pk || !pk.prot || s.slot > pk.prot.upTo) continue;
      const recv = s.owner; s.owner = pk.prot.back;
      if (pk.r === 1) {
        const next = W.picks.find(x => x.y === year + 1 && x.r === 1 && x.from === pk.from && x.owner === pk.prot.back && !x.prot);
        if (next) next.owner = recv;
        news(W, `${W.T[pk.prot.back].name} keep their ${year} first (${L.protName(pk, pk.prot.upTo)}). ${next ? `${W.T[recv].name} get their ${year + 1} first instead.` : ""}`, "draft", recv === "BOS" || pk.prot.back === "BOS" ? "BOS" : null);
      }
    }
    for (const s of slots) if (s.owner === "OUT") s.owner = teamCodes(W).filter(c => c !== "BOS")[Math.floor(r() * (teamCodes(W).length - 1))];
    if (!W.draft[year]) W.draft[year] = L.buildClass(W, year);
    W.ds = { year, slots, next: 0, lottery: order.slice(0, 16), balls: lot };
    const bos = slots.filter(s => s.owner === "BOS");
    news(W, `Lottery: ${W.T[order[0]].name} win the No. 1 pick.${bos.length ? ` Boston picks ${bos.map(s => "No. " + s.slot).join(" and ")}.` : ""}`, "draft");
    L.bump(W);
    return W.ds;
  };
  const posBucket = pos => pos === "C" ? "B" : pos === "PF" || pos === "SF" ? "W" : "G";
  // Each front office has its own board: its scouts' read on a prospect (seeded, so it's stable), what the roster
  // needs, and its taste (young upside for analytics shops, size for teams that want it)
  const hashStr = str => { let h = 2166136261; for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 16777619); } return h >>> 0; };
  L.needAt = (W, code, bucket) => {
    const i = W.season + 1, dec = L.decider(W);
    const good = Object.values(W.P).filter(p => p.t === code && !p.two && (p.pos || "W") === bucket && CBA.salaryIn(p, i, dec) > 0 && Mo.rAhead(p, 1) >= 0).length;
    return Math.max(0, (bucket === "W" ? 3 : 2) - good);
  };
  L.boardValue = (W, code, x) => {
    const fo = W.T[code].fo;
    const potW = fo.mode === "rebuild" ? 0.8 : fo.mode === "contend" ? 0.5 : 0.65;
    const rr = Mo.rng(hashStr(code + "|" + x.id) ^ W.seed);
    const scout = Mo.gauss(rr) * 0.55;
    const bucket = posBucket(x.pos);
    const need = L.needAt(W, code, bucket) * (fo.mode === "contend" ? 0.25 : fo.mode === "rebuild" ? 0.08 : 0.15);
    let taste = 0;
    if ((fo.wants || []).includes("size") && bucket === "B") taste += 0.2;
    if ((fo.wants || []).includes("youth") || (fo.analytics || 0.6) >= 0.75) taste += Math.max(0, 20 - x.age) * 0.15;
    return x.estPot * potW + x.estNow * (1 - potW) + scout + need + taste - x.rank * 0.002;
  };
  L.boardFor = (W, code) => L.available(W).map(x => ({ x, v: L.boardValue(W, code, x) })).sort((a, b) => b.v - a.v).map(y => y.x);
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
    else {
      // second-rounders: usually a two-way deal (no cap hit), if there's a two-way spot open
      const open = L.twoWays(W, s.owner, i).length < 3;
      const asTwo = open && (s.owner === "BOS" ? ds.bosTwo !== false : x.estNow < -0.9);
      if (asTwo) { p.two = true; p.c.how = "two"; p.c.twoEnd = i + 1; }
      else { p.c.sal[i] = CBA.minSal(0, i); p.c.sal[i + 1] = CBA.minSal(1, i + 1); p.c.opt = { [i + 1]: "NG" }; p.c.rfa = true; }
    }
    p.since = i;
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
      const av = L.boardFor(W, s.owner);
      if (!av.length) { ds.next++; continue; }
      L.makePick(W, av[0].id);
    }
    return null;
  };
  L.finishDraft = W => {
    // the best older prospects nobody drafted become free agents (two-way and camp candidates); the young ones go back to school
    const taken = new Set(W.ds.slots.filter(s => s.pick).map(s => s.pick)), i = W.season + 1;
    const undrafted = W.draft[W.ds.year].filter(x => !taken.has(x.id) && (x.gen || x.age >= 20.5)).sort((a, b) => a.rank - b.rank).slice(0, 45);
    for (const x of undrafted) {
      const pid = x.id + "-nba"; if (W.P[pid]) continue;
      const pos = posBucket(x.pos);
      W.P[pid] = { id: pid, n: x.n, t: "FA", age: Math.floor(x.age), yos: 0, pos, ps: [x.pos], o: +(x.trueNow * 0.6).toFixed(2), d: +(x.trueNow * 0.4).toFixed(2),
        pot: x.truePot, h: 0.88, tpar: pos === "B" ? 0.15 : pos === "G" ? 0.42 : 0.38, ts: 0.55, usg: 16, faDate: W.date, undrafted: true,
        note: `Undrafted in ${W.ds.year}${x.gen ? " (generated prospect)" : ""}, from ${x.school}.`, c: { sal: [], opt: {}, dec: {}, signed: i, bird: 0 } };
    }
    W.picks = W.picks.filter(x => x.y !== W.ds.year);
    W.ds.done = true;
    W.phase = L.expansionDue(W) ? "expansion" : "options"; W.date = L.dates(W.season).options;
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
        } else d = r() < L.optOdds(W, p, j).pIn ? "in" : "out";
      } else if (kind === "TO" || kind === "NG") d = bos ? (W.plan.opt[p.id + "@" + j] || dec(p, j, kind)) : dec(p, j, kind);
      else if (kind === "MO") {
        const team = bos ? (W.plan.opt[p.id + "@" + j] || (Mo.mv(p, j, W) >= p.c.sal[j] * 0.8 ? "in" : "out")) : (Mo.mv(p, j, W) >= p.c.sal[j] * 0.8 ? "in" : "out");
        const player = r() < L.optOdds(W, p, j).pIn ? "in" : "out";
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
    L.ensurePicks(W);
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
      if (p.two) {
        if ((p.c.twoEnd ?? prev) >= i) continue;               // a two-year two-way deal carries over
        // a two-way deal that ends: his team can tender a qualifying offer and keep him as a restricted free agent
        const qo = CBA.minSal(p.yos, i) + 200000;
        p.t = "FA"; p.two = false; p.faDate = W.date; p.c = { sal: [], opt: {}, dec: {}, signed: i, bird: 1 };
        p.rights = Mo.r(p) >= -1 ? { team, kind: "Non-Bird", hold: qo, rfa: true, qo, prevSal: CBA.minSal(p.yos, prev), tendered: false, two: true } : null;
        continue;
      }
      if (CBA.salaryIn(p, i, dec) > 0) { p.c.bird = (p.c.bird || 0) + 1; p.c.ext = false; continue; }
      // contract over: free agent, with his old team holding his rights (bird already counts the season just played)
      const prevSal = p.c.sal[prev] || CBA.minSal(p.yos, prev);
      const h = CBA.holdFor(p, i, prevSal);
      const rfa = !!((p.c.rk && p.c.rk[1] > 0 && p.c.rk[0] + 4 <= 2026 + i) || p.c.rfa) && p.yos <= 4;
      p.rights = { team, kind: h.bird, hold: h.amt, rfa, qo: rfa ? CBA.qualifyingOffer(p, i) : 0, prevSal, tendered: false };
      p.t = "FA"; p.faDate = W.date;
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
      const planQo = (W.plan.qo || {})[p.id];
      p.rights.tendered = bos ? (planQo != null ? planQo : worth) && !W.plan.renounce[p.id] : worth;
      if (!p.rights.tendered) p.rights.rfa = false;
    }
    // Boston's renounced players
    for (const id of Object.keys(W.plan.renounce)) { const p = W.P[id]; if (p && p.rights && p.rights.team === "BOS") p.rights.renounced = true; }
    W.plan.renounce = {}; W.plan.qo = {};
    // handshake deals agreed at the option deadline
    for (const [id, re] of Object.entries(W.handshake || {})) {
      const p = W.P[id]; if (!p || p.t !== "FA") continue;
      L.signSal(W, "BOS", id, re.sal, "bird", re.label);
    }
    W.handshake = {};
    for (const id of Object.keys(W.plan.resign)) if (W.plan.resign[id].start <= i) delete W.plan.resign[id];
    W.phase = "fa"; W.faRound = 0; W.faOffers = {}; W.post = null; W.offers = [];
    news(W, `Free agency opens for ${CBA.seasonName(i)}. The cap is ${M$(CBA.cap(i))}, the tax line ${M$(CBA.tax(i))}.`, "info");
    L.sntOffers(W);
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
    const minAmt = p ? CBA.minSal(p.yos, i) : CBA.minSal(2, i);
    if (pay + Math.min(minAmt, CBA.minCapHit(p ? p.yos : 2, i)) <= hard) opts.push({ via: "min", amt: minAmt });
    return { opts: opts.filter(o => o.amt > 0), pay, room, n };
  };
  // Will this front office pay this much in this season, given its tax stance?
  const affordable = (W, code, aav) => {
    const i = W.season, fo = W.T[code].fo, pay = L.payrollNow(W, code) + aav;
    if (fo.tax === "never") return pay <= CBA.tax(i);
    if (fo.tax === "dodge") return fo.mode === "contend" ? pay <= CBA.a1(i) : pay <= CBA.tax(i);
    return pay <= CBA.a2(i) + 2e6;
  };
  // A contract's yearly average relative to its first year, with standard raises (8% on Bird rights, 5% otherwise)
  const raiseFac = (years, raise) => 1 + raise * (years - 1) / 2;
  L.raiseFac = raiseFac;
  const raiseOf = via => via === "bird" ? 0.08 : via === "min" ? 0 : 0.05;
  const yearsFor = (via, ask) => via === "min" || via === "tmle" || via === "bae" ? Math.min(2, ask.years) : ask.years;
  // What a CPU team would offer a free agent right now (or null)
  const cpuOffer = (W, c, p, ask, res, r) => {
    const i = W.season, own = p.rights && p.rights.team === c && !p.rights.renounced;
    if (L.rosterCount(W, c) >= 15 && !(Mo.r(p) >= 1.5)) return null;
    const value = Mo.mv(p, i, W) * L.prefMult(W.T[c].fo, p) * (own ? 1.05 : 1);
    const want = Math.min(value, ask.aav * (1.02 - 0.05 * r()));
    if (want < ask.aav * res && want < CBA.minSal(p.yos, i) * 1.05) return null;
    const b = L.budget(W, c, p);
    // the tool that can pay the most per year over the deal, raises included
    const tool = b.opts.filter(o => o.via !== "min" || want <= CBA.minSal(p.yos, i) * 1.2)
      .map(o => ({ o, cap: o.amt * raiseFac(yearsFor(o.via, ask), raiseOf(o.via)) })).sort((x, y) => y.cap - x.cap)[0];
    if (!tool) return null;
    const aav = Math.min(want, tool.cap);
    const franchise = own && (Mo.r(p) >= 2.5 || Mo.mv(p, i, W) >= 0.18 * CBA.cap(i));
    if (!franchise && !affordable(W, c, aav) && aav > CBA.minSal(p.yos, i) * 1.01) return null;
    const years = yearsFor(tool.o.via, ask);
    return { code: c, years, total: aav * years, via: tool.o.via, shape: tool.o.via === "min" ? "flat" : "up" };
  };
  L.faRound = W => {
    const i = W.season, r = L.rng(W), round = W.faRound || 0;
    const res = [0.97, 0.88, 0.75, 0.6][Math.min(3, round)];
    const fas = Object.values(W.P).filter(p => p.t === "FA" && !p.offerSheet).sort((a, b) => Mo.mv(b, i, W) - Mo.mv(a, i, W));
    const signed = [];
    const odds = L.titleOdds(W, 60);
    for (const p of fas) {
      if (p.t !== "FA") continue;
      const ask = Mo.faHaul(p, i, W);
      const offers = [];
      // Boston's offer (made on the board)
      const bo = (W.faOffers || {})[p.id];
      if (bo && bo.via === "two") {
        if (L.twoWays(W, "BOS", i).length < 3 && L.takesTwoWay(W, p)) { L.signTwoWay(W, "BOS", p.id, bo.years); delete W.faOffers[p.id]; signed.push(p.id); continue; }
        bo.failed = "He wants a standard contract.";
      } else if (bo) {
        const b = L.budget(W, "BOS", p).opts.find(o => o.via === bo.via);
        const sal = CBA.buildSalaries(bo.years, bo.total, bo.shape || "up", raiseOf(bo.via));
        if (b && sal[0] <= b.amt + 1000 && (L.rosterCount(W, "BOS") < 15 || !L.inSeason(W))) offers.push({ code: "BOS", years: bo.years, total: bo.total, via: bo.via, shape: bo.shape || "up" });
        else bo.failed = b ? `Only ${M$(b.amt)} available through that tool now.` : "That tool isn't available anymore.";
      }
      // CPU teams: his old team first, then the teams that like him most
      const cands = teamCodes(W).filter(c => c !== "BOS").map(c => ({ c, s: L.prefMult(W.T[c].fo, p) * (W.T[c].fo.mode === "contend" ? 1.15 : 1) * (0.7 + r() * 0.6) * (L.rosterCount(W, c) < 13 ? 1.4 : L.rosterCount(W, c) >= 15 ? 0.2 : 1) }))
        .sort((a, b) => b.s - a.s).slice(0, 8).map(x => x.c);
      if (p.rights && p.rights.team !== "BOS" && !cands.includes(p.rights.team)) cands.unshift(p.rights.team);
      // undrafted rookies wait for two-way and camp deals; CPU teams don't hand them standard contracts in July
      if (!(p.undrafted && !p.yos)) for (const c of cands) { const o = cpuOffer(W, c, p, ask, res, r); if (o) offers.push(o); }
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
          L.sign(W, rt, p.id, best.years, best.total, "up", "bird"); signed.push(p.id);
          news(W, `${W.T[rt].name} match ${W.T[best.code].name}'s offer sheet for ${p.n}.`, "sign");
          continue;
        }
      }
      if (best.code === "BOS") delete W.faOffers[p.id];
      L.sign(W, best.code, p.id, best.years, best.total, best.shape, best.via);
      if (best.code !== "BOS") L.trimRoster(W, best.code, 15);
      signed.push(p.id);
    }
    if (round >= 3) signed.push(...L.placeLeftovers(W, "summer"));
    W.faRound = round + 1;
    W.date = L.addDays(W.date, round === 0 ? 5 : 4);
    L.sntOffers(W);
    L.bump(W);
    return signed;
  };
  // Nobody good stays unsigned: late in the summer (and every week of the season) the players left take what's out
  // there. His old team gets the first call, then whoever has the most to spend, then a one-year minimum.
  L.placeLeftovers = (W, when) => {
    const i = W.season, out = [], busy = new Set();
    // real rotation players only; minimum-level guys fill camp rosters and two-way spots instead
    const left = Object.values(W.P).filter(q => q.t === "FA" && !q.offerSheet && !(q.rights && q.rights.team === "BOS" && !q.rights.renounced && when === "summer") && Mo.r(q) >= -0.6 && Mo.faHaul(q, i, W).aav > CBA.minSal(q.yos, i) * 1.3)
      .sort((a, b) => Mo.r(b) - Mo.r(a));
    const worst = {};
    for (const c of teamCodes(W)) worst[c] = Math.min(9, ...L.teamPlayers(W, c).filter(q => CBA.salaryIn(q, i, L.decider(W)) > 0).map(q => Mo.r(q)));
    for (const p of left) {
      const ask = Mo.faHaul(p, i, W), star = Mo.r(p) >= 1.5;
      if (when === "season" && (Date.parse(W.date) - Date.parse(p.faDate || W.date)) / 864e5 < 10 && !star) continue;
      // a spot, or a roster where he's clearly better than the worst player (who gets cut)
      const room = c => !busy.has(c) && (L.rosterCount(W, c) < 15 || ((star || (when !== "summer" && Mo.r(p) >= worst[c] + 1.2)) && L.rosterCount(W, c) < 16));
      const own = p.rights && !p.rights.renounced && p.rights.team !== "BOS" && W.T[p.rights.team] ? p.rights.team : null;
      const done = (c, years, total, via) => { L.sign(W, c, p.id, years, total, via === "min" ? "flat" : "up", via); L.trimRoster(W, c); out.push(p.id); if (when === "season") busy.add(c); };
      if (own && room(own)) {
        const b = L.budget(W, own, p).opts.find(o => o.via === "bird");
        if (b) { const yrs = Math.min(ask.years, 3), aav = Math.min(ask.aav * 0.9, b.amt * raiseFac(yrs, 0.08)); done(own, yrs, Math.round(aav * yrs), "bird"); continue; }
      }
      const offers = teamCodes(W).filter(c => c !== "BOS" && room(c)).map(c => {
        const b = L.budget(W, c, p).opts.filter(o => o.via !== "min");
        const best = b.map(o => ({ o, cap: o.amt * raiseFac(yearsFor(o.via, ask), raiseOf(o.via)) })).sort((x, y) => y.cap - x.cap)[0];
        return best ? { c, via: best.o.via, cap: best.cap } : null;
      }).filter(Boolean).sort((a, b) => b.cap - a.cap);
      const top = offers[0];
      if (top && top.cap >= Math.min(ask.aav * 0.55, CBA.minSal(p.yos, i) * 2)) {
        const yrs = Math.min(2, ask.years), aav = Math.min(top.cap, ask.aav);
        done(top.c, yrs, Math.round(aav * yrs), top.via); continue;
      }
      // a one-year minimum to prove it, with whoever has a spot (good players only)
      if (Mo.r(p) >= 0) {
        const c = teamCodes(W).filter(x => x !== "BOS" && room(x)).sort((a, b) => L.teamNets(W)[b] - L.teamNets(W)[a])[0];
        if (c) done(c, 1, CBA.minCapHit(p.yos, i), "min");
      }
    }
    if (out.length) L.bump(W);
    return out;
  };
  // Two-way deals: up to three per team, players with fewer than four years of service, no cap hit
  L.twoWays = (W, code, upTo) => Object.values(W.P).filter(p => p.t === code && p.two && (upTo == null || (p.c.twoEnd ?? W.season) >= upTo));
  L.twoEligible = p => (p.yos || 0) <= 3;
  // will he take a two-way? Undrafted rookies and fringe young players will; anyone with a real market won't
  L.takesTwoWay = (W, p) => L.twoEligible(p) && p.age <= 26 && (p.undrafted || Mo.r(p) <= -1 || Mo.faHaul(p, W.season, W).aav <= CBA.minSal(p.yos, W.season) * 1.4);
  L.signTwoWay = (W, code, id, years = 1) => {
    const p = W.P[id], i = W.season + (W.phase === "draft" || W.phase === "options" || W.phase === "expansion" ? 1 : 0);
    p.t = code; p.two = true; p.rights = null; p.offerSheet = null;
    p.c = { sal: [], opt: {}, dec: {}, signed: i, bird: 0, how: "two", twoEnd: i + Math.max(1, Math.min(2, years)) - 1 };
    p.since = i;
    news(W, `${W.T[code].name} sign ${p.n} to a two-way deal.`, "sign", code === "BOS" ? "BOS" : null);
    L.bump(W);
  };
  // Sign-and-trade calls: a team that wants one of Boston's free agents but can't fit him with room or an
  // exception offers something for him instead (the receiving team has to stay under the first apron)
  L.sntOffers = W => {
    if (W.phase !== "fa") return [];
    const i = W.season, r = L.rng(W), dec = L.decider(W), made = [];
    W.offers = (W.offers || []).filter(o => !(o.snt && (o.done || !W.P[o.snt] || W.P[o.snt].t !== "FA")));
    const mine = Object.values(W.P).filter(p => p.t === "FA" && p.rights && p.rights.team === "BOS" && !p.rights.renounced && !p.offerSheet && Mo.r(p) >= 0.3);
    for (const p of mine) {
      if ((W.offers || []).some(o => !o.done && o.snt === p.id)) continue;
      const ask = Mo.faHaul(p, i, W);
      if (ask.aav < 8e6) continue;
      const years = Math.max(3, Math.min(4, ask.years));
      const y1 = CBA.k1(Math.min(ask.aav, CBA.maxSal(p.yos, i)) / raiseFac(years, 0.05));
      const sal = Array.from({ length: years }, (_, k) => CBA.k1(y1 * (1 + 0.05 * k)));
      const teams = teamCodes(W).filter(c => c !== "BOS" && L.rosterCount(W, c) < 15).filter(c => {
        const b = L.budget(W, c, p).opts.filter(o => o.via !== "min" && o.via !== "bird");
        const most = Math.max(0, ...b.map(o => o.amt));
        return most < y1 * 0.9 && L.payrollNow(W, c) + y1 <= CBA.a1(i) - 1e6;     // can't sign him outright, can absorb him
      }).map(c => ({ c, s: L.prefMult(W.T[c].fo, p) * (0.8 + r() * 0.4) })).sort((a, b) => b.s - a.s).slice(0, 4).map(x => x.c);
      for (const c of teams) {
        const theirs = L.teamPlayers(W, c).filter(q => CBA.salaryIn(q, i, dec) > 0 && !(q.tradeOk && W.date < q.tradeOk) && !(q.noTrade && W.date < q.noTrade));
        const seconds = W.picks.filter(x => x.owner === c && x.r === 2 && x.y > 2027 + i - 1 && !x.used).sort((a, b) => a.y - b.y);
        const firsts = W.picks.filter(x => x.owner === c && x.r === 1 && x.y > 2027 + i - 1 && !x.used && !x.prot).sort((a, b) => b.y - a.y);
        const fodder = theirs.sort((a, b) => L.playerValue(W, c, a) / Math.max(1, CBA.salaryIn(a, i, dec)) - L.playerValue(W, c, b) / Math.max(1, CBA.salaryIn(b, i, dec))).slice(0, 3);
        const variants = [];
        for (const back of [[], ...fodder.map(q => [q.id])]) {
          if (firsts.length) variants.push({ players: back, picks: [firsts[0].id], prot: { [firsts[0].id]: 14 } });
          if (seconds.length > 1) variants.push({ players: back, picks: seconds.slice(0, 2).map(x => x.id) });
          if (seconds.length) variants.push({ players: back, picks: [seconds[0].id] });
        }
        let pick = null;
        for (const v of variants) {
          const tr = { a: "BOS", b: c, side: { BOS: { players: [p.id], picks: [], cash: 0 }, [c]: { players: v.players, picks: v.picks, cash: 0 } }, kickWaive: {}, prot: v.prot || {}, snt: { [p.id]: { sal } } };
          const chk = L.checkTrade(W, tr); if (!chk.ok) continue;
          const re = L.aiReact(W, tr, c); if (re.verdict !== "yes") continue;
          if (!pick || re.delta < pick.d) pick = { tr, d: re.delta };       // the least they can get away with
        }
        if (pick) {
          const o = { id: "snt" + W.tick + "-" + p.id + "-" + c, from: c, done: false, snt: p.id, exp: L.dates(i - 1).camp, tr: pick.tr,
            note: `${W.T[c].fo.lead} wants ${p.n} but can't fit him under the cap. Sign-and-trade: ${years} years, ${M$(sal.reduce((x, y) => x + y, 0))}.` };
          W.offers.push(o); made.push(o);
          break;
        }
      }
    }
    if (made.length) news(W, `${made.length} team${made.length > 1 ? "s" : ""} called about a sign-and-trade.`, "info", "BOS");
    return made;
  };
  L.matchSheet = (W, id, match) => {
    const p = W.P[id], o = p.offerSheet; if (!o) return;
    p.offerSheet = null;
    if (match) { L.sign(W, "BOS", id, o.years, o.total, "flat", "bird"); news(W, `Boston matches the offer sheet for ${p.n}.`, "sign", "BOS"); }
    else { p.rights = null; L.sign(W, o.code, id, o.years, o.total, "flat", o.via); news(W, `Boston lets ${p.n} go to ${W.T[o.code].name}.`, "sign", "BOS"); }
  };

  // ================= Camp: rosters to 15, new schedule =================
  L.cpuExtensions = W => {
    const i = W.season, r = L.rng(W), dec = L.decider(W);
    for (const p of Object.values(W.P)) {
      if (!W.T[p.t] || p.t === "BOS" || p.two) continue;
      if (CBA.lastYear(p, dec, i) !== i || Mo.r(p) < 1 || p.age > 32) continue;
      const e = CBA.extEligible(p, i); if (!e.ok) continue;
      if (r() > (Mo.r(p) >= 2.5 ? 0.85 : 0.55)) continue;
      const lim = CBA.extLimit(p, i), ask = Mo.faHaul(p, i + 1, W);
      const yrs = Math.max(1, Math.min(lim.maxYears || 4, ask.years));
      const aav = Math.min(lim.first, ask.aav * (0.95 + r() * 0.1));
      L.extend(W, p.t, p.id, yrs, Math.round(aav * yrs), "flat");
    }
  };
  L.toCamp = W => {
    const i = W.season, r = L.rng(W), dec = L.decider(W);
    while ((W.faRound || 0) < 4) L.faRound(W);                 // every round runs before camp
    L.cpuExtensions(W);
    for (const p of Object.values(W.P)) if (p.t === "FA" && p.offerSheet) L.matchSheet(W, p.id, false);
    // unsigned restricted free agents take their qualifying offers
    for (const p of Object.values(W.P)) if (p.t === "FA" && p.rights && p.rights.rfa && p.rights.tendered && p.rights.team !== "BOS")
      L.sign(W, p.rights.team, p.id, 1, p.rights.qo, "flat", "bird");
    L.placeLeftovers(W, "camp");
    for (const code of teamCodes(W)) {
      if (code === "BOS") continue;
      // non-guaranteed years: keep the ones worth it
      for (const p of L.teamPlayers(W, code)) if (p.c.opt[i] === "NG" && !p.c.dec[i]) p.c.dec[i] = Mo.mv(p, i, W) >= p.c.sal[i] * 0.7 ? "in" : "out";
      for (const p of L.teamPlayers(W, code)) if (!(CBA.salaryIn(p, i, L.decider(W)) > 0)) { p.t = "FA"; p.rights = null; p.faDate = W.date; }
      L.trimRoster(W, code);
      // a two-way player who's earned it gets a standard deal if there's a spot
      for (const p of L.twoWays(W, code).sort((a, b) => Mo.r(b) - Mo.r(a))) {
        if (Mo.r(p) < 0.3 || L.rosterCount(W, code) >= 15) break;
        p.two = false; p.c.sal[i] = CBA.minSal(p.yos, i); p.c.sal[i + 1] = CBA.minSal(p.yos + 1, i + 1); p.c.opt = { [i + 1]: "NG" }; p.c.signed = i; p.c.how = "min";
        news(W, `${W.T[code].name} convert ${p.n} to a standard contract.`, "sign");
      }
      let ps = L.teamPlayers(W, code);
      while (ps.length < 14) {
        const fa = Object.values(W.P).filter(p => p.t === "FA" && !p.offerSheet && !(p.rights && p.rights.team === "BOS" && !p.rights.renounced) && Mo.faHaul(p, i, W).aav <= CBA.minSal(p.yos, i) * 1.4).sort((a, b) => Mo.r(b) - Mo.r(a))[0];
        if (!fa) break;
        L.sign(W, code, fa.id, 1, CBA.minCapHit(fa.yos, i), "flat", "min");
        ps = L.teamPlayers(W, code);
      }
    }
    // two-way spots, taking turns: the best young players left who'll take one
    for (let round = 0; round < 3; round++) for (const code of teamCodes(W).filter(c => c !== "BOS").sort((a, b) => L.teamNets(W)[a] - L.teamNets(W)[b])) {
      if (L.twoWays(W, code).length >= 3) continue;
      const fa = Object.values(W.P).filter(p => p.t === "FA" && !p.offerSheet && !(p.rights && p.rights.team === "BOS" && !p.rights.renounced) && L.takesTwoWay(W, p)).sort((a, b) => Mo.r(b) - Mo.r(a))[0];
      if (fa) L.signTwoWay(W, code, fa.id, 1);
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
  // In season: teams with an open spot sign the best free agents who've waited long enough (one a week each)
  L.inSeasonSignings = W => L.placeLeftovers(W, "season");

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
    // this year's draft picks are exempt (the real expansion draft comes before the draft)
    const ps = Object.values(W.P).filter(p => p.t === code && !p.two && CBA.salaryIn(p, i, dec) > 0 && p.since !== i);
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
  // Due in the 2028 offseason (after the draft, before options) when the setting is on
  L.expansionDue = W => !!(W.settings && W.settings.expansion) && !W.expanded && W.season === 1 && ["draft", "expansion", "options"].includes(W.phase) && (W.phase !== "draft" || (W.ds && W.ds.done));
  L.runExpansion = W => {
    const i = W.season + 1, r = L.rng(W);
    const exp = [{ code: "SEA", name: "Seattle SuperSonics", conf: "W" }, { code: "LVA", name: "Las Vegas", conf: "W" }];
    W.T.MEM.conf = "E";
    for (const e of exp) W.T[e.code] = { code: e.code, name: e.name, conf: e.conf, fo: { lead: "Expansion GM", title: "General manager", tax: "never", mode: "rebuild", wants: ["youth", "picks"], style: "Brand-new franchise building from the expansion draft." }, rep: false, tpes: [], dead: [], holds: [], used: {}, hard: {}, taxHist: {}, w: 0, l: 0, rot: null, expansion: true };
    const pool = [];
    for (const code of teamCodes(W)) {
      if (exp.some(e => e.code === code)) continue;
      const prot = new Set(L.protectList(W, code, i).map(p => p.id));
      for (const p of Object.values(W.P)) if (p.t === code && !p.two && !prot.has(p.id) && p.since !== i && CBA.salaryIn(p, i, L.decider(W)) > 0) pool.push({ p, code, v: expValue(W, p, i) });
    }
    pool.sort((a, b) => b.v - a.v);
    const lost = new Set(), picks = [];
    let k = 0;
    for (const x of pool) {
      if (lost.has(x.code)) continue;
      const e = exp[k % 2];
      x.p.t = e.code; x.p.since = i; lost.add(x.code); k++;
      picks.push({ n: k, to: e.code, from: x.code, id: x.p.id, name: x.p.n, sal: CBA.salaryIn(x.p, i, L.decider(W)) });
      if (x.code === "BOS") news(W, `Expansion draft: ${e.name} take ${x.p.n} from Boston.`, "draft", "BOS");
      if (lost.size >= teamCodes(W).length - 2) break;
    }
    W.expResult = { picks, protectedBos: L.protectList(W, "BOS", i).map(p => p.id) };
    for (const e of exp) for (let y = 2029; y <= 2035; y++) for (const rd of [1, 2]) W.picks.push({ id: `${y}-${rd}-${e.code}`, y, r: rd, from: e.code, owner: e.code });
    W.expanded = true;
    news(W, "Seattle and Las Vegas join the league for 2028-29. Memphis moves to the East.", "info");
    L.bump(W);
  };

  if (typeof module !== "undefined") module.exports = L; else root.League = L;
})(typeof window !== "undefined" ? window : globalThis);
