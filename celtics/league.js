/* Banner 19: the league. World state, books, cap tools, trade checks, front-office AI, season sim.
   Depends on CBA (cba.js) and Model (model.js). No DOM. */
(function (root) {
  "use strict";
  const CBA = root.CBA || require("./cba.js");
  const Mo = root.Model || require("./model.js");
  const L = {};
  const clone = x => JSON.parse(JSON.stringify(x));
  const sum = a => a.reduce((s, x) => s + x, 0);
  const M$ = x => "$" + (x / 1e6).toFixed(Math.abs(x) >= 1e8 ? 1 : 2) + "M";
  L.M$ = M$;

  // ---------- Calendar ----------
  // Season i: preseason Oct 15, opening night Oct 20, deadline window Feb 1-4, regular season ends Apr 11,
  // draft late June, options June 29, free agency July 1 (the new season's books start).
  const Y = i => 2026 + i;
  L.dates = i => ({
    pre: `${Y(i)}-10-15`, open: `${Y(i)}-10-20`, deadline: `${Y(i) + 1}-02-01`, deadlineEnd: `${Y(i) + 1}-02-04`,
    end: `${Y(i) + 1}-04-11`, playoffs: `${Y(i) + 1}-04-18`, finals: `${Y(i) + 1}-06-15`, draft: `${Y(i) + 1}-06-24`,
    options: `${Y(i) + 1}-06-29`, fa: `${Y(i) + 1}-07-01`, camp: `${Y(i) + 1}-09-29`
  });
  L.PHASES = ["pre", "reg", "deadline", "reg2", "playoffs", "draft", "expansion", "options", "fa", "summer"];
  L.PHASE_NAME = { pre: "Preseason", reg: "Regular season", deadline: "Trade deadline", reg2: "Regular season", playoffs: "Playoffs",
                   draft: "Draft", expansion: "Expansion draft", options: "Option decisions", fa: "Free agency", summer: "Summer" };
  L.inSeason = W => ["pre", "reg", "deadline", "reg2", "playoffs"].includes(W.phase);
  // fraction of the current season's salary still to be paid (for trade value)
  L.seasonLeft = W => {
    if (!L.inSeason(W) || W.phase === "pre") return 1;
    const d = L.dates(W.season), t = Date.parse(W.date), a = Date.parse(d.open), b = Date.parse(d.end);
    return Math.max(0.05, Math.min(1, (b - t) / (b - a)));
  };

  // ---------- World ----------
  const BIRD_BOS = { "jayson-tatum": 10, "paul-george": 3, "derrick-white": 5, "mitchell-robinson": 1, "sam-hauser": 6,
    "payton-pritchard": 7, "ron-harper-jr": 2, "chris-cenac-jr": 1, "hugo-gonzalez": 2, "luka-garza": 2, "baylor-scheierman": 3,
    "neemias-queta": 4, "mike-conley": 1, "jordan-walsh": 4, "amari-williams": 1, "dillon-mitchell": 1 };
  L.newWorld = (data, live, seed) => {
    CBA.init(data.cba);
    const W = { v: 1, seed: seed || 19, tick: 0, season: 0, phase: "pre", date: "2026-10-15", P: {}, T: {}, picks: [],
      plan: { opt: {}, resign: {}, renounce: {}, optout: {} }, queue: [], log: [], news: [], offers: [],
      draft: {}, settings: { expansion: false, noTax0: true, a2Once: true }, hist: [], seasons: {}, boxFrom: "2026-10-15" };
    for (const p0 of data.players) {
      const p = clone(p0);
      p.c.sal = Array.from({ length: 5 }, (_, i) => p.c.sal[i] || 0);
      p.c.dec = {};
      p.c.bird = p.t === "BOS" ? (BIRD_BOS[p.id] ?? 1) : (p.c.rk ? 1 : 3);
      if (p.id === "payton-pritchard") p.noTrade = "2027-04-13";      // six months after a big-raise extension
      p.h = p.h ?? 0.85;
      if (p.o == null) { p.o = -1.6; p.d = -0.4; }
      p.o0 = p.o;                                                        // offense when his 2025-26 numbers were put up
      W.P[p.id] = p;
    }
    for (const [code, t] of Object.entries(data.teams)) {
      W.T[code] = { code, name: t.name, conf: t.conf, fo: t.fo, rep: t.rep, tpes: [], dead: [], holds: [], used: {}, hard: {},
        taxHist: t.rep ? { "-4": true, "-3": true, "-2": true, "-1": true } : {}, w: 0, l: 0, rot: null };
    }
    const B = W.T.BOS, cx = data.celtics;
    B.tpes = cx.tpe.map((t, k) => ({ id: "tpe-bos-" + k, amt: t.amt, orig: t.amt, from: t.from, made: t.made, exp: t.exp, season: t.season }));
    B.holds = cx.holds.map(h => ({ n: h.n, amt: h.amt, kind: h.kind, season: 0 }));
    B.used = { 0: { ntmle: data.cba.ntmle } };
    B.hard = { 0: "a1" };
    B.hardWhy = { 0: "Signed Mitchell Robinson with the full non-taxpayer mid-level" };
    B.taxHist = { "-4": true, "-3": true, "-2": true, "-1": false };
    B.coach = cx.coach; B.owner = cx.owner;
    W.T.MEM.tpes = [{ id: "tpe-mem-0", amt: 28_800_000, from: "Jaren Jackson Jr.", made: "2026-02-05", exp: "2027-02-05", season: -1 }];
    // Draft picks 2027-2033: everyone owns their own, then Boston's real ledger
    for (let y = 2027; y <= 2033; y++) for (const code of Object.keys(W.T)) for (const r of [1, 2])
      W.picks.push({ id: `${y}-${r}-${code}`, y, r, from: code, owner: code });
    const pk = id => W.picks.find(p => p.id === id);
    pk("2028-1-PHI").owner = "BOS"; pk("2028-1-PHI").alt = "2028-1-LAC"; pk("2028-1-PHI").note = "Better of Philadelphia's and the Clippers'";
    pk("2028-1-LAC").owner = "PHI"; pk("2028-1-LAC").note = "Worse of Philadelphia's and the Clippers' goes to Philadelphia";
    pk("2028-1-BOS").swap = "SAS"; pk("2028-1-BOS").note = "San Antonio can swap (top-1 protected)";
    pk("2029-1-BOS").owner = "POR";
    pk("2031-1-PHI").owner = "BOS";
    pk("2027-2-PHI").owner = "BOS"; pk("2028-2-PHI").owner = "BOS";
    for (let y = 2027; y <= 2033; y++) pk(`${y}-2-BOS`).owner = "OUT";   // Boston's own seconds: traded away over the years
    W.draft[2027] = L.scoutClass(data.draft["2027"], 2027, W.seed);
    // ESPN's board stops at 60; generated prospects fill out the undrafted pool
    const extra = L.genClass(2027, W.seed).slice(0, 30).map((g, k) => ({ id: g.id, n: g.n, pos: g.pos, school: g.school, age: g.age, gen: true, rank: 61 + k }));
    W.draft[2027] = W.draft[2027].concat(L.scoutClass(extra, 2027, W.seed + 1));
    W.recruits = data.recruits || {};
    W.owner = { name: "Bill Chisholm", trust: 60, mandate: { season: 0, rule: "tax", text: "No tax in 2026-27." }, log: [] };
    W.live = live || null;
    L.applyLive(W, live);
    if (L.newSchedule) L.newSchedule(W);
    return W;
  };
  L.teamPlayers = (W, code, opts = {}) => Object.values(W.P).filter(p => p.t === code && (opts.two || !p.two));
  L.isOver = (W, d) => W.date >= d;

  // ---------- Prospects ----------
  // Expected rookie-year rating and ceiling by draft slot (or board rank)
  L.rookieNow = k => +(-0.35 - 1.65 * Math.pow(Math.min(1.25, (k - 1) / 59), 0.7)).toFixed(2);
  L.rookiePot = k => +(4.0 - 5.2 * Math.pow(Math.min(1.25, (k - 1) / 59), 0.6)).toFixed(2);
  // Public view comes from the big board rank. The truth (how good he really becomes) is hidden and seeded.
  L.scoutClass = (list, year, seed) => {
    const rng = Mo.rng(seed * 7919 + year);
    return list.map(x => {
      const k = x.rank, f = Math.min(1.25, (k - 1) / 59);
      // rookie-year impact, calibrated to how the 2024 and 2025 classes rated as rookies on this same scale
      const estNow = L.rookieNow(k);
      const estPot = L.rookiePot(k);                         // where he's headed by 25
      return Object.assign({}, x, { year, estNow: +estNow.toFixed(2), estPot: +estPot.toFixed(2),
        trueNow: +(estNow + Mo.gauss(rng) * 0.5).toFixed(2), truePot: +(estPot + Mo.gauss(rng) * 1.1).toFixed(2) });
    });
  };
  // Later classes: no public big board exists yet, so these are generated (and labeled that way)
  const FIRST = ["Jalen", "Malik", "Cam", "Darius", "Ty", "Amari", "Jayden", "Isaiah", "Elijah", "Marcus", "Kofi", "Luca", "Nikola", "Andre", "Caleb", "Xavier", "Trey", "Mason", "Omari", "Quentin", "Rasheed", "Tobi", "Dante", "Elias", "Bryce", "Kendall", "Jordan", "Micah", "Silas", "Theo"];
  const LAST = ["Brooks", "Okafor", "Ramirez", "Diallo", "Whitfield", "Castellanos", "Mbeki", "Haynes", "Lindqvist", "Coleman", "Dorsey", "Petrovic", "Asante", "Holloway", "Quinn", "Barnett", "Ndiaye", "Sutton", "Varga", "Ellison", "Tate", "Kowalski", "Mensah", "Pryor", "Bello", "Garnett", "Rhodes", "Sampson", "Ibeh", "Wainwright"];
  const POS = ["PG", "SG", "SF", "PF", "C"];
  L.genClass = (year, seed) => {
    const rng = Mo.rng(seed * 104729 + year);
    const used = new Set(), list = [];
    for (let k = 1; k <= 100; k++) {
      let n; do { n = FIRST[Math.floor(rng() * FIRST.length)] + " " + LAST[Math.floor(rng() * LAST.length)]; } while (used.has(n)); used.add(n);
      list.push({ id: "gen-" + year + "-" + k, n, pos: POS[Math.floor(rng() * 5)], school: "Generated prospect", age: +(19 + rng() * 3).toFixed(1), rank: k, gen: true });
    }
    return L.scoutClass(list, year, seed);
  };

  // ---------- Live stats (ESPN, pulled nightly into live.json) ----------
  L.applyLive = (W, live) => {
    if (!live || !live.players || live.season !== CBA.seasonName(W.season)) return;
    for (const p of Object.values(W.P)) {
      const s = live.players[p.id];
      if (!s) continue;
      p.live = s;
      // Shooting form nudges offense: true shooting vs his 2025-26 mark at his usage, faded in by games played
      if (s.gp >= 5 && s.fga + s.fta > 0 && p.ts) {
        const ts = s.pts / (2 * (s.fga + 0.44 * s.fta));
        const nudge = Math.max(-0.75, Math.min(0.75, (ts - p.ts) * (p.usg || 18) / 20 * 10)) * Math.min(1, s.gp / 40) * 0.5;
        p.o = +(p.o + nudge).toFixed(2); p.form = +nudge.toFixed(2);
      }
    }
  };

  // ---------- Decisions used by projections ----------
  // Undecided options: the user's scenario, else what the model expects.
  L.decider = (W) => {
    const memo = W._memo || (W._memo = {});
    return (p, j, kind) => {
      const key = p.id + "@" + j;
      const set = W.plan.opt[key];
      if (set && kind !== "MO") return set;
      const mk = key + ":" + (set || "") + ":" + W.tick;
      if (memo[mk]) return memo[mk];
      let d = "in";
      const s = p.c.sal[j] || 0;
      if (kind === "PO") d = L.optOdds(W, p, j).pIn >= 0.5 ? "in" : "out";
      else if (kind === "TO") d = Mo.mv(p, j, W) >= s * 0.8 ? "in" : "out";
      else if (kind === "NG") d = Mo.mv(p, j, W) >= s * 0.7 ? "in" : "out";
      else if (kind === "MO") {
        // the 2026-style "mutual" option: picked up if either side wants it
        const team = set || (Mo.mv(p, j, W) >= s * 0.8 ? "in" : "out");
        d = team === "in" || L.optOdds(W, p, j).pIn >= 0.5 ? "in" : "out";
      }
      memo[mk] = d;
      return d;
    };
  };
  L.optionView = (W, p, j) => {
    const kind = p.c.opt[j]; if (!kind) return null;
    const key = p.id + "@" + j, set = W.plan.opt[key], dec = p.c.dec[j];
    const s = p.c.sal[j] || 0, mv = Mo.mv(p, j, W);
    const po = (kind === "PO" || kind === "MO") ? L.optOdds(W, p, j) : null;
    const final = dec || L.decider(W)(p, j, kind);
    return { kind, set, dec, final, pIn: po ? po.pIn : null, po, mv, mkt: Mo.market(p, j, W), sal: s, teamWants: mv >= s * 0.8 };
  };
  // How happy a player is where he is (0-1): half how good the team is, half how big his role is
  L.happy = (W, p) => {
    if (!W.T[p.t]) return 0.5;
    const memo = W._memo || (W._memo = {}), key = "happy:" + p.id;
    if (memo[key] != null) return memo[key];
    const ranks = W._ranks || L.strengthRanks(W);            // 1 = worst
    const team = ((ranks[p.t] || 15) - 1) / (Object.keys(W.T).length - 1);
    const mins = (L.rotationFor(W, p.t).mins || {})[p.id] || 0;
    const role = Math.max(0, Math.min(1, mins / 30));
    return (memo[key] = 0.5 * team + 0.5 * role);
  };
  L.optOdds = (W, p, j) => Mo.playerOptionOdds(p, j, W, L.happy(W, p));

  // ---------- Books ----------
  L.repeater = (W, code, i, proj) => {
    const t = W.T[code]; let n = 0;
    for (let j = i - 4; j < i; j++) {
      if (t.taxHist[j] != null) { if (t.taxHist[j]) n++; }
      else if (j >= W.season && proj) { if (proj(j) > CBA.tax(j)) n++; }
    }
    return n >= 3;
  };
  // The repeater clock in words: is a bill this season at repeater rates, and what staying under buys next season
  L.repeaterNote = (W, code = "BOS") => {
    const t = W.T[code], i = W.season;
    const paid = j => !!t.taxHist[j];
    const n = [i - 4, i - 3, i - 2, i - 1].filter(paid).length;
    const yrs = [i - 4, i - 3, i - 2, i - 1].filter(paid).map(j => CBA.seasonName(j));
    const nextIfUnder = [i - 3, i - 2, i - 1].filter(paid).length, nextIfOver = nextIfUnder + 1;
    const now = n >= 3 ? `Boston paid tax in ${n} of the last four seasons (${yrs.join(", ")}), so any ${CBA.seasonName(i)} bill is at repeater rates.`
      : `Boston paid tax in ${n} of the last four seasons${n ? ` (${yrs.join(", ")})` : ""}: standard rates this season.`;
    const next = nextIfOver >= 3 && nextIfUnder < 3 ? ` Stay under this season and ${CBA.seasonName(i + 1)} is at standard rates; pay tax and Boston is a repeater next season too.`
      : nextIfUnder >= 3 ? ` Even staying under, ${CBA.seasonName(i + 1)} would still be at repeater rates.` : ` ${CBA.seasonName(i + 1)} is at standard rates either way.`;
    return { repeater: n >= 3, text: now + next };
  };
  // Projected slot of a team's pick (1 = best) from current strength, regressed to the middle further out
  L.projSlot = (W, from, y) => {
    const ranks = W._ranks || L.strengthRanks(W);
    const yrs = Math.max(0, y - (2027 + W.season));
    const s0 = ranks[from] ?? 15.5;
    return Math.max(1, Math.min(30, Math.round(15.5 + (s0 - 15.5) * Math.pow(0.75, yrs))));
  };
  L.strengthRanks = W => {
    const nets = L.teamNets(W);
    const order = Object.keys(nets).sort((a, b) => nets[a] - nets[b]);   // worst first -> slot 1
    const out = {}; order.forEach((c, k) => { out[c] = k + 1; });
    W._ranks = out; return out;
  };

  // Full books for one team and season. Returns rows, holds, totals, status, tax.
  L.books = (W, code, i) => {
    const t = W.T[code], dec = L.decider(W);
    const roster = Object.values(W.P).filter(p => p.t === code && !p.two);
    const rows = [];
    for (const p of roster) {
      const s = CBA.salaryIn(p, i, dec);
      if (s > 0) rows.push({ p, sal: s, opt: p.c.opt[i] || null, state: CBA.optionState(p, i, dec) });
    }
    const dead = t.dead.map(d => ({ n: d.n, sal: d.sal[i] || 0, why: d.why })).filter(d => d.sal > 0);
    const holds = [];
    if (i === W.season) {
      for (const h of t.holds) if (!h.renounced && (h.season ?? i) === i) holds.push({ n: h.n, amt: h.amt, kind: h.kind, id: h.id });
      for (const p of Object.values(W.P)) if (p.t === "FA" && p.rights && p.rights.team === code && !p.rights.renounced)
        holds.push({ n: p.n, id: p.id, amt: p.rights.hold, kind: p.rights.kind });
    } else if (i > W.season) {
      for (const p of roster) {
        const last = CBA.lastYear(p, dec, W.season);
        if (last !== i - 1) continue;
        if (W.plan.renounce[p.id]) continue;
        const re = W.plan.resign[p.id];
        if (re) continue;                                    // planned re-signing shows as a contract below
        const ageAt = p.age + (i - W.season);
        if (ageAt >= 40) continue;
        const pp = Object.assign({}, p, { c: Object.assign({}, p.c, { bird: (p.c.bird || 0) + (i - 1 - W.season) }) });   // bird counts seasons with the team through the current one
        const h = CBA.holdFor(pp, i, p.c.sal[i - 1]);
        holds.push({ n: p.n, id: p.id, amt: h.amt, kind: h.bird + (h.qo ? " (restricted, QO " + M$(h.qo) + ")" : ""), proj: true });
      }
      // planned re-signings and opt-out deals
      for (const [id, re] of Object.entries(W.plan.resign)) {
        const p = W.P[id]; if (!p || p.t !== code) continue;
        const k = i - re.start; if (k >= 0 && k < re.sal.length) rows.push({ p, sal: re.sal[k], plan: re.label || "Planned re-signing" });
      }
      // first-round picks not yet signed
      const draftYear = 2026 + i;
      for (const pk of W.picks) if (pk.owner === code && pk.r === 1 && pk.y === draftYear) {
        const slot = L.pickSlot(W, pk);
        holds.push({ n: `${L.pickName(W, pk.id)}, about No. ${slot}`, amt: CBA.rookieY1(slot, i), kind: "Draft pick", pick: pk.id, proj: true });
      }
    }
    // the George-style plans replace the option year
    const salaries = sum(rows.map(r => r.sal)) + sum(dead.map(d => d.sal));
    const count = rows.length;
    const fillN = i > W.season ? Math.max(0, 14 - count - holds.filter(h => h.kind === "Draft pick").length) : 0;
    const fill = fillN * CBA.minSal(0, i);
    const payroll = salaries + fill;
    const holdAmt = sum(holds.map(h => h.amt));
    const chargeN = Math.max(0, 12 - count - holds.length);
    const capNum = payroll + holdAmt + chargeN * CBA.minSal(0, i);
    const proj = j => j === i ? payroll : L.payrollAt(W, code, j);
    const rep = L.repeater(W, code, i, proj);
    return { code, i, rows: rows.sort((a, b) => b.sal - a.sal), dead, holds, fillN, fill, payroll, holdAmt, chargeN, capNum, count,
      status: (st => st === "room" && capNum > CBA.cap(i) ? "over" : st)(CBA.status(payroll, i)), tax: CBA.taxBill(payroll, i, rep), rep,
      cap: CBA.cap(i), taxLine: CBA.tax(i), a1: CBA.a1(i), a2: CBA.a2(i), hard: t.hard[i] || null };
  };
  L.payrollAt = (W, code, j) => {
    const memo = W._pay || (W._pay = {});
    const key = code + ":" + j + ":" + W.tick;
    if (memo[key] != null) return memo[key];
    const b = L.books(W, code, j);
    return (memo[key] = b.payroll);
  };
  // Payroll right now (no fill-ins), the number trades are tested against
  L.payrollNow = (W, code) => {
    const dec = L.decider(W), i = W.season, t = W.T[code];
    return sum(Object.values(W.P).filter(p => p.t === code && !p.two).map(p => CBA.salaryIn(p, i, dec))) + sum(t.dead.map(d => d.sal[i] || 0));
  };
  L.rosterCount = (W, code) => Object.values(W.P).filter(p => p.t === code && !p.two && CBA.salaryIn(p, W.season, L.decider(W)) > 0).length;
  L.bump = W => { W.tick++; W._memo = {}; W._pay = {}; W._ranks = null; W._nets = null; };

  // ---------- Cap tools ----------
  L.tpeUsable = (W, t, tpe, post) => {
    if (tpe.exp && W.date > tpe.exp) return { ok: false, why: "Expired" };
    if ((post === "a1" || post === "a2") && tpe.season < W.season) return { ok: false, why: "Made last season; can't be used by a team over the first apron" };
    if (tpe.snt && post === "a2") return { ok: false, why: "Made in a sign-and-trade; off-limits over the second apron" };
    return { ok: true };
  };
  L.tools = (W, code, i) => {
    const t = W.T[code], b = L.books(W, code, i), used = t.used[i] || {};
    const pay = b.payroll, cap = b.cap, out = [];
    const hard = t.hard[i];
    const room = Math.max(0, cap - b.capNum);
    const headroom = lvl => CBA.levelAmt(lvl, i) - pay;
    const usedRoom = used.room || b.capNum < cap;
    out.push({ key: "room", name: "Cap room", amt: room, ok: room > 0, why: room > 0 ? "Under the cap (counting holds)" : `${M$(b.capNum - cap)} over the cap, counting holds` });
    const nt = CBA.line("ntmle", i) - (used.ntmle || 0);
    const ntOk = !usedRoom && pay > cap - CBA.line("ntmle", i) && nt > 0 && headroom("a1") > 0 && !used.rmle && hard !== "a2-only";
    out.push({ key: "ntmle", name: "Non-taxpayer mid-level", amt: Math.max(0, Math.min(nt, headroom("a1"))), ok: ntOk && nt > 0,
      why: used.ntmle >= CBA.line("ntmle", i) ? "Used" : headroom("a1") <= 0 ? "Over the first apron" : usedRoom ? "Teams under the cap get the room mid-level instead" : `Up to ${M$(nt)} for up to four years. Over ${M$(CBA.line("tmle", i))} or three-plus years hard-caps at the first apron` });
    const tm = CBA.line("tmle", i) - (used.tmle || 0);
    out.push({ key: "tmle", name: "Taxpayer mid-level", amt: Math.max(0, Math.min(tm, headroom("a2"))), ok: !used.ntmle && !used.room && tm > 0 && headroom("a2") > 0,
      why: used.ntmle ? "Can't use both mid-levels" : headroom("a2") <= 0 ? "Over the second apron" : `Up to ${M$(tm)} for two years. Hard-caps at the second apron` });
    const bae = CBA.line("bae", i) - (used.bae || 0), baeLast = (t.used[i - 1] || {}).bae;
    out.push({ key: "bae", name: "Bi-annual exception", amt: Math.max(0, Math.min(bae, headroom("a1"))), ok: !usedRoom && bae > 0 && headroom("a1") > 0 && !baeLast,
      why: baeLast ? "Used last season (every other year only)" : headroom("a1") <= 0 ? "Over the first apron" : `Up to ${M$(bae)} for two years. Hard-caps at the first apron` });
    out.push({ key: "rmle", name: "Room mid-level", amt: usedRoom ? CBA.line("rmle", i) - (used.rmle || 0) : 0, ok: usedRoom && !used.ntmle,
      why: usedRoom ? `Up to ${M$(CBA.line("rmle", i))} after using cap room` : "Only for teams that use cap room" });
    for (const tp of t.tpes) {
      if (tp.exp && W.date > tp.exp && i === W.season) continue;
      const u = L.tpeUsable(W, t, tp, b.status);
      out.push({ key: tp.id, name: `Trade exception (${tp.from})`, amt: tp.amt, ok: u.ok, tpe: true, exp: tp.exp,
        why: u.ok ? `Absorb up to ${M$(tp.amt + CBA.D().match.plus)} without sending salary back. Expires ${L.fmtDate(tp.exp)}` : u.why });
    }
    const minRoom = hard ? CBA.levelAmt(hard, i) - pay : Infinity;
    out.push({ key: "min", name: "Minimum contracts", amt: CBA.minSal(2, i), ok: minRoom >= CBA.minSal(0, i), why: minRoom >= CBA.minSal(2, i) ? "Always available. Up to two years" : minRoom >= CBA.minSal(0, i) ? `Only ${M$(minRoom)} under the hard cap: a rookie-minimum player fits, a veteran minimum doesn't` : "No room under the hard cap" });
    return { tools: out, hard, hardWhy: (t.hardWhy || {})[i], books: b };
  };
  L.fmtDate = s => { if (!s) return ""; const d = new Date(s + "T12:00:00Z"); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };

  // ---------- Front-office valuation ----------
  const MODE_NOW = { contend: 1.35, rise: 1.1, retool: 0.85, rebuild: 0.6 };
  const MODE_PICK = { contend: 0.75, rise: 1.0, retool: 1.15, rebuild: 1.4 };
  const MODE_YOUTH = { contend: 0.6, rise: 1.1, retool: 1.1, rebuild: 1.4 };
  L.prefMult = (fo, p) => {
    let m = 1;
    const w = fo.wants || [];
    if (w.includes("shooting") && (p.tpar || 0) >= 0.4 && (p.ts || 0) >= 0.57) m *= 1.12;
    if (w.includes("defense") && (p.d || 0) >= 1) m *= 1.12;
    if (w.includes("size") && p.pos === "B") m *= 1.08;
    if (w.includes("stars") && Mo.r(p) >= 3) m *= 1.2;
    if (w.includes("youth") && p.age <= 23) m *= 1.12;
    if (w.includes("possessions") && (p.tpar || 0) >= 0.45) m *= 1.05;
    return m;
  };
  // The money side: what a dollar of salary costs this team in season j given where its payroll sits
  L.costMult = (W, code, j, payroll) => {
    const fo = W.T[code].fo;
    const pay = payroll ?? L.payrollAt(W, code, j);
    if (pay <= CBA.tax(j)) return fo.mode === "contend" ? 0.95 : fo.mode === "rebuild" ? 1.05 : 1;
    const mt = CBA.marginalTax(pay, j, W.T[code].rep);
    const f = fo.tax === "pay" ? 0.15 : fo.tax === "dodge" ? 0.35 : 0.8;
    return 1 + mt * f * (j === W.season ? 1 : 0.5);      // future tax bills are less certain
  };
  L.playerValue = (W, code, p, opts = {}) => {
    const fo = W.T[code].fo, i = W.season, dec = L.decider(W);
    const frac = L.seasonLeft(W);
    const wNow = MODE_NOW[fo.mode] || 1;
    let pm = L.prefMult(fo, p);
    if (fo.mode === "contend" || fo.mode === "rise") pm *= 1 + 0.12 * Math.max(0, Mo.r(p) - 2);   // stars win titles
    let v = 0;
    // rebuilding teams look further out and care less about this season; contenders the reverse
    const horizon = fo.mode === "rebuild" ? 5 : fo.mode === "retool" ? 4 : 3;
    const rate = fo.mode === "rebuild" ? 0.92 : fo.mode === "contend" ? 0.82 : 0.86;
    const ageNow = p.age;
    const ageW = fo.mode === "rebuild" ? (ageNow >= 30 ? 0.75 : ageNow >= 27 ? 0.9 : ageNow <= 23 ? 1.1 : 1) : fo.mode === "retool" ? (ageNow >= 31 ? 0.88 : 1) : 1;
    const last = Math.min(i + horizon, Math.max(i, CBA.lastYear(p, dec, i)));
    for (let j = i; j <= last; j++) {
      const k = j - i, s = CBA.salaryIn(p, j, dec) + (j === i && opts.kick ? opts.kick : 0);
      if (!s && j > i) break;
      // analytics shops pay for impact; traditional ones for what the market (box score, minutes) says
      const a = fo.analytics ?? 0.6;
      // production value runs rich next to what the market pays, so it's discounted a quarter
      const mv = (a * 0.75 * Mo.mv(p, j, W) + (1 - a) * Mo.market(p, j, W)) * pm * ageW;
      const disc = Math.pow(rate, k);
      const w = (k === 0 ? wNow * frac : k === 1 ? (wNow + 1) / 2 : 1) * disc;
      const cost = s * L.costMult(W, code, j) * (k === 0 ? frac : 1) * disc;
      v += w * mv - cost;
    }
    if (p.age <= 24 && p.pot != null && p.pot > Mo.r(p)) v += 0.35 * (p.pot - Mo.r(p)) * 5e6 * (MODE_YOUTH[fo.mode] || 1);
    // a rookie-scale player comes with restricted free agency: the team keeps him past his deal
    if (p.c && p.c.rk && p.c.rk[1] > 0 && p.age <= 24) {
      const after = CBA.lastYear(p, dec, i) + 1;
      if (after - i <= horizon) v += 0.3 * Math.max(0, Mo.mv(p, after, W) * 0.75 - Mo.market(p, after, W)) * Math.pow(rate, after - i) * (MODE_YOUTH[fo.mode] || 1);
    }
    return v;
  };
  // Projected slot for a pick, taking the better of two when a pick conveys as the best of a pair
  L.pickSlot = (W, pk) => {
    let slot = L.projSlot(W, pk.from, pk.y);
    if (pk.alt) { const pa = W.picks.find(x => x.id === pk.alt); if (pa) slot = Math.min(slot, L.projSlot(W, pa.from, pk.y)); }
    return slot;
  };
  // Chance a protected pick actually conveys (slot is uncertain, more so further out)
  L.conveyOdds = (W, pk, upTo) => {
    if (!upTo) return 1;
    const yrs = Math.max(0, pk.y - (2027 + W.season));
    const slot = L.pickSlot(W, pk) + (pk.r === 2 ? 30 : 0), sd = 4 + 2.5 * yrs;
    return 1 - Mo.phi((upTo + 0.5 - slot) / sd);
  };
  L.pickValue = (W, code, pk, upTo) => {
    const fo = W.T[code].fo;
    const yrs = Math.max(0, pk.y - (2027 + W.season) + (L.inSeason(W) ? 0 : -1));
    let slot = L.pickSlot(W, pk);
    if (pk.alt) slot -= 1;                                   // the better of two is worth a bit more than either
    const base = pk.r === 1 ? 110e6 * Math.exp(-(Math.max(1, slot) - 1) / 5.5) + 5e6 : 2.5e6;
    const w = (MODE_PICK[fo.mode] || 1) * ((fo.wants || []).includes("picks") ? 1.2 : 1);
    const prot = upTo ?? (pk.prot ? pk.prot.upTo : 0);
    const c = L.conveyOdds(W, pk, prot);
    // a first that doesn't convey rolls into a later pick, so it keeps some value
    return base * w * Math.pow(0.93, yrs) * (c + (pk.r === 1 ? (1 - c) * 0.35 : 0));
  };
  L.protName = (pk, upTo) => !upTo ? "" : pk.r === 2 ? "protected 31-" + upTo : "top-" + upTo + " protected";
  L.pickName = (W, id, upTo) => {
    const pk = W.picks.find(x => x.id === id); if (!pk) return id;
    const pa = pk.alt ? W.picks.find(x => x.id === pk.alt) : null;
    const whose = pa ? `better of ${pk.from} and ${pa.from}` : pk.from;
    const prot = L.protName(pk, upTo ?? (pk.prot ? pk.prot.upTo : 0));
    return `${pk.y} ${pk.r === 1 ? "first" : "second"} (${whose}${prot ? ", " + prot : ""})`;
  };
  // The smallest thing a team can send so a trade has something going each way
  L.token = (W, code, exclude = []) => {
    const sec = W.picks.filter(x => x.owner === code && x.r === 2 && !x.used && !exclude.includes(x.id)).sort((a, b) => b.y - a.y)[0];
    if (sec) return { picks: [sec.id], prot: { [sec.id]: 55 }, cash: 0 };
    return { picks: [], prot: {}, cash: 250000 };
  };

  // ---------- Trades ----------
  // tr = { a, b, side: { [code]: { players:[ids], picks:[ids], cash } }, kickWaive:{id:true}, snt:{id:{years,total,shape}} }
  // Each side lists what that team SENDS.
  L.checkTrade = (W, tr) => {
    const i = W.season, res = { ok: true, teams: {}, issues: [] };
    const dec = L.decider(W);
    const codes = [tr.a, tr.b];
    const sends = c => tr.side[c] || { players: [], picks: [], cash: 0 };
    for (const code of codes) {
      const other = codes.find(c => c !== code);
      const t = W.T[code], out = sends(code), inn = sends(other);
      const r = { code, msgs: [], ok: true };
      const outP = out.players.map(id => W.P[id]), inP = inn.players.map(id => W.P[id]);
      const sal = (p, recv) => {
        if (tr.snt && tr.snt[p.id]) return tr.snt[p.id].sal[0];
        return CBA.salaryIn(p, i, dec) + (recv && !(tr.kickWaive || {})[p.id] ? CBA.kicker(p, i, dec) : 0);
      };
      const outL = outP.map(p => ({ id: p.id, sal: sal(p, false) })), inL = inP.map(p => ({ id: p.id, sal: sal(p, true) }));
      const sntOut = outP.filter(p => tr.snt && tr.snt[p.id]);
      const P = L.payrollNow(W, code) + sum(sntOut.map(p => tr.snt[p.id].sal[0]));
      const outSal = sum(outL.map(x => x.sal)), inSal = sum(inL.map(x => x.sal));
      const P2 = P - outSal + inSal;
      const post = CBA.status(P2, i);
      Object.assign(r, { P, P2, outSal, inSal, post, kick: sum(inP.map(p => (tr.kickWaive || {})[p.id] ? 0 : CBA.kicker(p, i, dec))) });
      const tpes = t.tpes.filter(tp => !(tp.exp && W.date > tp.exp)).map(tp => Object.assign({}, tp, L.tpeUsable(W, t, tp, post), { usable: L.tpeUsable(W, t, tp, post).ok }));
      const sol = (outL.length || inL.length) ? CBA.solveStructure(outL, inL, tpes, i, post, P2 <= CBA.cap(i)) : { ok: true, subs: [], newTpes: [], used: [] };
      r.sol = sol;
      if (!sol.ok) { r.ok = false; r.msgs.push(sol.why); }
      // hard caps: existing and new
      const triggers = [];
      if (sol.ok && sol.expanded) triggers.push(["a1", "takes back more salary than it sends"]);
      if (sol.ok && sol.aggregated) triggers.push(["a2", "combines salaries"]);
      if ((out.cash || 0) > 0) triggers.push(["a2", "sends cash"]);
      if (tr.snt && inP.some(p => tr.snt[p.id])) triggers.push(["a1", "receives a sign-and-trade"]);
      if (t.hard[i]) triggers.push([t.hard[i], "is already hard-capped"]);
      r.newHard = null;
      for (const [lvl, why] of triggers) {
        const lim = CBA.levelAmt(lvl, i);
        if (P2 > lim) { r.ok = false; r.msgs.push(why === "is already hard-capped" ? `Hard-capped at the ${CBA.LEVEL_NAME[lvl]}; this would end ${M$(P2 - lim)} over it.` : `This trade ${why}, which hard-caps a team at the ${CBA.LEVEL_NAME[lvl]}, and it would end ${M$(P2 - lim)} over.`); }
        else if (!t.hard[i] || (lvl === "a1" && t.hard[i] === "a2")) r.newHard = lvl === "a1" || r.newHard === "a1" ? "a1" : "a2";
      }
      if (r.newHard === t.hard[i]) r.newHard = null;
      if ((out.cash || 0) > 0 && post === "a2") { r.ok = false; r.msgs.push("Teams over the second apron can't send cash."); }
      const cashSent = ((t.cash || {})[i] || {}).out || 0, cashGot = ((t.cash || {})[i] || {}).in || 0;
      if ((out.cash || 0) + cashSent > CBA.cashLimit(i)) { r.ok = false; r.msgs.push(`Cash limit: ${M$(CBA.cashLimit(i))} a season.`); }
      if ((inn.cash || 0) + cashGot > CBA.cashLimit(i)) { r.ok = false; r.msgs.push(`Can only receive ${M$(CBA.cashLimit(i))} in cash a season.`); }
      // roster size
      const n0 = L.rosterCount(W, code) + sntOut.length, n2 = n0 - outP.length + inP.length;
      const maxR = ["reg", "deadline", "reg2", "playoffs"].includes(W.phase) ? 15 : 21;
      r.n2 = n2;
      if (n2 > maxR) { r.ok = false; r.msgs.push(`Roster would be ${n2}. The limit is ${maxR}; waive someone first.`); }
      if (L.inSeason(W) && n2 < 13) r.msgs.push(`Leaves ${n2} players. Teams must get back to 14 within two weeks.`);
      // sign-and-trades: three or four years, his old team must hold his Bird rights, the receiver ends under the first apron
      for (const p of outP) if (tr.snt && tr.snt[p.id]) {
        const s = tr.snt[p.id];
        if (!(p.rights && p.rights.team === code && !p.rights.renounced)) { r.ok = false; r.msgs.push(`${p.n}: only the team holding his rights can sign-and-trade him.`); }
        if (s.sal.length < 3 || s.sal.length > 4) { r.ok = false; r.msgs.push(`${p.n}: a sign-and-trade has to run three or four seasons.`); }
        if (W.phase !== "fa") { r.ok = false; r.msgs.push("Sign-and-trades happen in free agency."); }
        const ask = Mo.faHaul(p, i, W);
        if (s.sal[0] < Math.min(ask.aav, CBA.maxSal(p.yos, i)) * 0.9) { r.ok = false; r.msgs.push(`${p.n} won't sign for that: he wants about ${M$(Math.min(ask.aav, CBA.maxSal(p.yos, i)))} a year.`); }
      }
      if (tr.snt && inP.some(p => tr.snt[p.id]) && P2 > CBA.a1(i)) { r.ok = false; r.msgs.push("A team taking a sign-and-trade must end under the first apron."); }
      // trade restrictions
      for (const p of outP) {
        if (p.noTrade && W.date < p.noTrade) { r.ok = false; r.msgs.push(`${p.n} can't be traded until ${L.fmtDate(p.noTrade)}.`); }
        if (p.two) { r.ok = false; r.msgs.push(`${p.n} is on a two-way deal.`); }
        if (p.tradeOk && W.date < p.tradeOk && !(tr.snt && tr.snt[p.id])) { r.ok = false; r.msgs.push(`${p.n} signed recently and can't be traded until ${L.fmtDate(p.tradeOk)}.`); }
      }
      // every trade needs something going each way, even if it's a protected second or a little cash
      if (!out.players.length && !(out.picks || []).length && !(out.cash > 0) && (inn.players.length || (inn.picks || []).length)) {
        r.ok = false; r.msgs.push(`${t.name} has to send something back, even a protected second-round pick or cash.`);
      }
      // picks (Stepien)
      const firsts = {};
      for (const pk of W.picks) if (pk.owner === code && pk.r === 1) firsts[pk.y] = (firsts[pk.y] || 0) + 1;
      for (const id of out.picks || []) { const pk = W.picks.find(x => x.id === id); if (pk && pk.r === 1) firsts[pk.y]--; }
      for (const id of inn.picks || []) { const pk = W.picks.find(x => x.id === id); if (pk && pk.r === 1) firsts[pk.y] = (firsts[pk.y] || 0) + 1; }
      const st = CBA.stepien(firsts, 2027 + W.season + (L.inSeason(W) ? 0 : 0) + (W.phase === "fa" || W.phase === "summer" ? 0 : 0));
      if (!st.ok) { r.ok = false; r.msgs.push(st.why); }
      if (!r.ok) res.ok = false;
      res.teams[code] = r;
    }
    return res;
  };
  // A player as he'd be after a sign-and-trade (new contract), for valuations
  L.sntView = (W, tr, id) => {
    const p = W.P[id], s = tr.snt && tr.snt[id];
    if (!s) return p;
    const c = { sal: [], opt: {}, dec: {}, signed: W.season, bird: p.c.bird || 3, how: "snt" };
    s.sal.forEach((x, k) => { c.sal[W.season + k] = x; });
    return Object.assign({}, p, { c });
  };
  L.sntRoom = W => W.phase === "fa";
  // A CPU front office's reaction. Positive = they'd do it.
  L.aiReact = (W, tr, code) => {
    const other = tr.a === code ? tr.b : tr.a;
    const t = W.T[code], fo = t.fo, i = W.season;
    const give = tr.side[code] || { players: [], picks: [], cash: 0 }, get = tr.side[other] || { players: [], picks: [], cash: 0 };
    const chk = L.checkTrade(W, tr).teams[code];
    const why = [];
    let vin = 0, vout = 0;
    // value players at this team's post-trade payroll for the money side
    for (const id of get.players) vin += L.playerValue(W, code, L.sntView(W, tr, id), { kick: (tr.kickWaive || {})[id] || (tr.snt || {})[id] ? 0 : CBA.kicker(W.P[id], i, L.decider(W)) });
    for (const id of give.players) vout += (tr.snt || {})[id] ? 0 : L.playerValue(W, code, W.P[id]);   // a free agent leaving costs nothing he was under contract for
    const prot = tr.prot || {};
    for (const id of get.picks || []) vin += L.pickValue(W, code, W.picks.find(x => x.id === id), prot[id]);
    for (const id of give.picks || []) vout += L.pickValue(W, code, W.picks.find(x => x.id === id), prot[id]);
    vin += (get.cash || 0) * (fo.mode === "rebuild" ? 1 : 0.8); vout += give.cash || 0;
    // tax stance
    const P2 = chk ? chk.P2 : L.payrollNow(W, code);
    const P = L.payrollNow(W, code);
    let veto = null;
    if (fo.tax === "never" && P2 > CBA.tax(i) && P2 > P) veto = `${t.name} won't go into the tax`;
    if (fo.tax === "dodge" && P2 > CBA.a2(i) && P2 > P) veto = `${t.name} won't cross the second apron`;
    if (fo.tax === "dodge" && fo.mode !== "contend" && P2 > CBA.tax(i) && P2 > P) veto = `${t.name} won't pay tax for a team that isn't contending`;
    // tax savings or costs this season count as real money
    const repeat = t.rep;
    const taxDelta = (CBA.taxBill(P2, i, repeat) - CBA.taxBill(P, i, repeat)) * L.seasonLeft(W);
    vin -= taxDelta * (fo.tax === "pay" ? 0.4 : fo.tax === "dodge" ? 0.9 : 1.2);
    const delta = vin - vout;
    const need = Math.max(5e5, 0.04 * Math.abs(vout));
    if (taxDelta < -1e6) why.push(`Saves ${t.name} ${M$(-taxDelta)} in tax`);
    if (taxDelta > 1e6) why.push(`Adds ${M$(taxDelta)} to their tax bill`);
    if ((get.picks || []).length && MODE_PICK[fo.mode] > 1) why.push("They want picks");
    if (fo.mode === "contend" && get.players.some(id => Mo.r(W.P[id]) >= 1)) why.push("Helps them now");
    const verdict = veto ? "no" : delta >= need ? "yes" : delta >= -Math.max(3e6, 0.15 * Math.abs(vout)) ? "close" : "no";
    return { verdict, delta, vin, vout, veto, why, need };
  };
  // Boston's own read of a trade (Stevens' lens)
  L.ourValue = (W, tr) => {
    const code = "BOS", other = tr.a === code ? tr.b : tr.a;
    const give = tr.side[code] || { players: [], picks: [] }, get = tr.side[other] || { players: [], picks: [] };
    let v = 0;
    for (const id of get.players) v += L.playerValue(W, code, L.sntView(W, tr, id));
    for (const id of give.players) v -= (tr.snt || {})[id] ? 0 : L.playerValue(W, code, W.P[id]);
    const prot = tr.prot || {};
    for (const id of get.picks || []) v += L.pickValue(W, code, W.picks.find(x => x.id === id), prot[id]);
    for (const id of give.picks || []) v -= L.pickValue(W, code, W.picks.find(x => x.id === id), prot[id]);
    v += (get.cash || 0) - (give.cash || 0);
    return v;
  };

  // ---------- Future picks ----------
  // Every team owns its own picks seven drafts out. The opening ledger stops at 2033, so each new league year
  // (and every older save on load) adds the next year; without it the Stepien check fails every trade from 2028-29.
  L.ensurePicks = W => {
    const need = 2027 + (W.season || 0) + 7;
    let last = 2026; for (const pk of W.picks) if (pk.y > last) last = pk.y;
    for (let y = last + 1; y <= need; y++) for (const code of Object.keys(W.T)) for (const r of [1, 2])
      W.picks.push({ id: `${y}-${r}-${code}`, y, r, from: code, owner: code });
  };

  // ---------- Strength ----------
  L.rotationFor = (W, code, avail) => {
    const t = W.T[code];
    const ps = L.teamPlayers(W, code, { two: true }).filter(p => !avail || avail(p));
    if (code === "BOS" && t.rot) {
      // the user's minutes; anyone missing gets his minutes spread over the others in the rotation
      const mins = {}; let tot = 0;
      for (const p of ps) { const m = Math.min(42, t.rot[p.id] || 0); if (m) { mins[p.id] = m; tot += m; } }
      // a game has 240 minutes: scale the plan to fit whether it's short or over (over used to count as extra strength)
      if (tot > 0 && Math.abs(tot - 240) > 0.01) {
        const k = 240 / tot; for (const id in mins) mins[id] = Math.min(42, mins[id] * k);
        let left = 240 - Object.values(mins).reduce((a, b) => a + b, 0);
        for (const p of ps.filter(p => !mins[p.id]).sort((a, b) => Mo.r(b) - Mo.r(a))) { if (left <= 0) break; const m = Math.min(left, 16); mins[p.id] = m; left -= m; }
      }
      if (tot > 0) return { mins, order: Object.keys(mins).sort((a, b) => mins[b] - mins[a]) };
    }
    return Mo.autoRotation(ps.filter(p => !p.two || ps.filter(q => !q.two).length < 10));
  };
  L.teamRaw = (W, code, avail) => {
    const rot = L.rotationFor(W, code, avail);
    return Mo.raw(L.teamPlayers(W, code, { two: true }), rot.mins);
  };
  L.leagueMean = W => { const raws = Object.keys(W.T).map(c => L.teamRaw(W, c)); return sum(raws) / raws.length; };
  L.teamNets = W => {
    if (W._nets) return W._nets;
    const raws = {}; for (const c of Object.keys(W.T)) raws[c] = L.teamRaw(W, c);
    const mean = sum(Object.values(raws)) / Object.keys(raws).length;
    const nets = {}; for (const c in raws) nets[c] = Mo.netOf(raws[c], mean);
    W._mean = mean;
    return (W._nets = nets);
  };
  L.projWins = (W, code) => {
    const nets = L.teamNets(W);
    const opp = Object.keys(nets).filter(c => c !== code).map(c => nets[c]);
    return Mo.expWins(nets[code], opp);
  };

  if (typeof module !== "undefined") module.exports = L; else root.League = L;
})(typeof window !== "undefined" ? window : globalThis);
