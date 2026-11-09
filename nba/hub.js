/* NBA Hub: the model. No DOM, no network: the page and the tests both load it.

   Everything is built on the shared NBA library (nba/lib): Banner 19's ratings, aging, contract value, cap rules and
   trade checks, and Hard Cap's contract merge. The league is assembled fresh on every load from feeds that already
   refresh every day:
     celtics/data.json      the cap sheet: every player's rating, health, contract and the CBA figures
     hardcap/stats.json     contracts (Basketball-Reference) and rosters, injuries, season BPM (twice a day)
     hardcap/contracts.json hand-checked contract fixes
     celtics/live.json      standings (every morning)
     draft/nba.json         the 2027 draft order, who owns each pick, every future pick owed, the consensus board
     nba/data/picks.json    what each draft slot is worth, from 2001-2018 drafts (tools/nba_pick_curve.py)

   Seasons are indexed from 2026-27 = 0, the same as the library. Money is whole dollars. */
(function (root) {
  "use strict";
  const req = (k, f) => root[k] || (typeof require !== "undefined" ? require(f) : null);
  const CBA = req("CBA", "./lib/cba.js");
  const Mo = req("Model", "./lib/model.js");
  const L = req("League", "./lib/league.js");
  if (typeof require !== "undefined" && !L.playoffs) { require("./lib/season.js"); require("./lib/offseason.js"); }
  const NC = req("NbaContracts", "./lib/contracts.js");

  const YEARS = 5;
  const sum = a => a.reduce((s, x) => s + x, 0);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  // The draft board and the team file use ESPN-style codes for three teams
  const CODE = { BKN: "BRK", CHA: "CHO", PHX: "PHO" };
  const fix = c => CODE[c] || c;

  const DEFAULTS = {
    sims: 1000,          // simulated rest-of-seasons for this season's odds
    futureSims: 400,     // quick simulated seasons for later years
    disc: 0.07,          // yearly discount on surplus: the cap's own growth, so values read in today's cap dollars
    mode: "prod",        // "prod": what he should produce; "market": what teams would pay him
    fill: true,          // teams fill open roster spots with free agents they can afford
    blend: 2500,         // minutes of this season's BPM it takes to move a rating halfway
  };

  function build(inp, opts) {
    const cfg = Object.assign({}, DEFAULTS, opts || {});
    const data = inp.data, stats = inp.stats || {}, live = inp.live || null, board = inp.board || {};
    const curve = (inp.picks && inp.picks.curve) || [];
    CBA.init(data.cba);

    // ---------- The league today ----------
    const nba = NC.latestContracts(data, stats, inp.fixes || null);
    const idx = NC.rosterIndex(stats);
    const players = [];
    const injured = {};
    const seenName = new Set();
    for (const p0 of nba.players) {
      // the same player under two spellings ("a-j-green" on the cap sheet, "aj-green" in a hand fix): keep the first
      const nk = NC.nameKeys(p0.id)[0] + "|" + p0.t;
      if (seenName.has(nk)) continue;
      seenName.add(nk);
      const p = JSON.parse(JSON.stringify(p0));
      if (!p.c || !p.c.sal) p.c = { sal: [0, 0, 0, 0, 0], opt: {} };
      const now = NC.nbaTeam(p, idx);
      if (now) p.t = now;
      const recent = stats.wk ? Object.keys(stats.wk).map(Number).sort((a, b) => b - a).slice(0, 2).some(w => stats.wk[w][p.id]) : false;
      if ((now === null && !recent) || p.noDeal) continue;            // off every roster: not part of the league now
      if (p.deal) p.two = true;                                       // two-way and 10-day deals aren't standard spots
      if (p.limbo) p.two = true;                                      // his contract row is dead money; he plays on a two-way
      const r = stats.rosters && (stats.rosters[p.id] || stats.rosters[NC.nameKeys(p.id)[0]]);
      if (r && r[3]) p.espn = +r[3];
      if (p.c.opt) delete p.c.opt[0];                                 // this season's calls are made: he's on the roster
      if (p.o == null) { p.o = -1.6; p.d = -0.4; }
      if (p.yos == null) p.yos = 1;
      p.o0 = p.o; p.d0 = p.d;
      // This season so far: Basketball-Reference's BPM, faded in by minutes played
      const v = stats.vorp && (stats.vorp[p.id] || stats.vorp[NC.nameKeys(p.id)[0]]);
      const a = stats.avg && stats.avg[String(2027)] && stats.avg[String(2027)][p.id];
      const mins = a ? a[0] * a[1] : 0;
      if (v && mins > 0) {
        const w = mins / (mins + cfg.blend);
        const shift = w * (v[1] - (p.o + p.d));
        p.o = +(p.o + shift * 0.6).toFixed(2); p.d = +(p.d + shift * 0.4).toFixed(2);
        p.form = +shift.toFixed(2); p.bpm = v[1]; p.vorp = v[0];
      }
      if (a) p.line = { gp: a[0], min: a[1], pts: a[7], reb: a[8], ast: a[10] };
      const inj = stats.inj && stats.inj[p.id];
      if (inj) {
        p.inj = inj[0];
        if (/out for the (rest of the )?season|season-ending|remainder of the season/i.test(inj[1] || "")) injured[p.id] = true;
      }
      players.push(p);
    }
    // Over 15 standard contracts: anyone whose contract row sits with another team is playing on a two-way or 10-day
    // deal here while his old team pays off the rest (a waived player catching on), so he doesn't take a spot
    const count = {};
    for (const p of players) if (!p.two && p.c.sal[0]) count[p.t] = (count[p.t] || 0) + 1;
    for (const p of players) {
      const bb = stats.contracts && stats.contracts[p.id];
      const rows = bb ? [bb.slice(0, 3), ...bb.slice(3)] : [];
      if (!p.two && count[p.t] > 15 && rows.length && !rows.some(r => r[0] === p.t)) { p.two = true; p.deadElsewhere = rows[0][0]; count[p.t]--; }
    }
    // Banner 19's world, set to today: real records, this season's remaining schedule, the real pick ledger
    const asOf = (live && live.updated ? live.updated : stats.updated || "2026-11-09").slice(0, 10);
    const W = L.newWorld(Object.assign({}, data, { players }), live ? Object.assign({}, live, { players: null }) : null, 19);
    W.phase = "reg"; W.date = asOf;
    for (const p of Object.values(W.P)) if (!p.c.sal.length) p.c.sal = [0, 0, 0, 0, 0];
    const rec = L.liveStart(W);
    L.newSchedule(W, rec);
    const played = rec ? sum(Object.values(rec).map(x => x.w + x.l)) / 30 : 0;
    const frac0 = clamp((82 - played) / 82, 0, 1);                 // share of this season still to play
    const codes = Object.keys(W.T);
    const teamInfo = {};
    const brand = (inp.teams && inp.teams.nba) || {};
    for (const c of codes) {
      const raw = Object.entries(brand).find(([k]) => fix(k) === c);
      const b = raw ? raw[1] : {};
      teamInfo[c] = { code: c, name: W.T[c].name, short: b.name || W.T[c].name.split(" ").pop(), city: b.city || "", conf: W.T[c].conf,
        color: (b.c && b.c[0]) || "#33415c", color2: (b.c && b.c[1]) || "#888", espn: b.espn || c.toLowerCase(), w: W.T[c].w, l: W.T[c].l };
    }
    // Pick ledger: 2027 from the current draft order (who owns each team's pick), 2028-33 from every future pick owed
    setPicks(W, board, codes);
    const dec = L.decider(W);

    const H = { cfg, W, CBA, Mo, L, teams: teamInfo, codes, asOf, frac0, played, injured, curve, board, set, reset: () => memo.clear() };
    const memo = new Map();
    const cache = (k, f) => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k); };
    function set(k, v) { cfg[k] = v; memo.clear(); }

    // ---------- Contracts, re-signings and who's on each team in a season ----------
    H.keep = {};                     // user calls on expiring players: id -> true (re-sign) / false (let go)
    H.salary = (p, i) => CBA.salaryIn(p, i, dec);
    H.lastYear = p => CBA.lastYear(p, dec, 0);
    H.faKind = p => {
      const c = p.c || {}, n = H.lastYear(p) + 1;
      const rookie = (c.rk && c.rk[1] > 0 && c.rk[1] <= 30) || c.rfa;
      return rookie && (p.yos || 0) + n - 1 <= 4 ? "RFA" : "UFA";
    };
    H.rating = (p, i) => p.rook ? rookRating(p, i) : Mo.rAhead(p, i);
    const marketAt = (p, i) => Mo.market(p, i, W);
    const prodAt = (p, i) => Mo.mv(p, i, W);
    // A new deal for a player whose contract ends: what the market pays, for as long as the market would go
    H.newDeal = (p, start) => {
      const age = Mo.ageIn(p, start, W), r = Mo.rAhead(p, start);
      const yrs = Math.min(Mo.faYears(age, r), YEARS - start + 2);
      const aav = marketAt(p, start);
      return { start, yrs, aav, sal: k => Math.round(aav * Math.pow(1.05, k - start)) };
    };
    // Default call when his deal is up: restricted free agents worth their price get matched; everyone else walks
    H.defaultKeep = p => {
      const e = H.lastYear(p);
      if (e < 0 || e >= YEARS - 1) return false;
      if (H.faKind(p) !== "RFA") return false;
      return prodAt(p, e + 1) >= 0.8 * marketAt(p, e + 1);
    };
    H.kept = p => (p.id in H.keep ? H.keep[p.id] : H.defaultKeep(p));
    H.salaryAt = (p, i) => {
      const s = H.salary(p, i);
      if (s > 0) return s;
      const e = H.lastYear(p);
      if (e >= 0 && i > e && H.kept(p)) { const d = H.newDeal(p, e + 1); if (i < d.start + d.yrs) return d.sal(i); }
      return 0;
    };

    // ---------- Team strength ----------
    const ratedCopy = (p, i) => {
      const r = H.rating(p, i), r0 = Mo.r(p) || 0.0001;
      return { id: p.id, pos: p.pos || "W", o: (p.o || 0) * r / r0, d: (p.d || 0) * r / r0, _r: r, ref: p };
    };
    function strength(list) {
      const rot = Mo.autoRotation(list);
      return { raw: Mo.raw(list, rot.mins), rot };
    }
    function netsFrom(raws) {
      const mean = sum(Object.values(raws)) / codes.length, nets = {};
      for (const c of codes) nets[c] = Mo.netOf(raws[c], mean);
      return nets;
    }

    // Season 0: this roster, minus anyone out for the season
    H.roster0 = code => Object.values(W.P).filter(p => p.t === code && !p.two && H.salary(p, 0) > 0);
    H.nets0 = () => cache("nets0", () => {
      const raws = {}, rots = {};
      for (const c of codes) {
        const list = H.roster0(c).filter(p => !injured[p.id]).map(p => ratedCopy(p, 0));
        const s = strength(list); raws[c] = s.raw; rots[c] = s.rot;
      }
      return { nets: netsFrom(raws), rots };
    });

    // ---------- Monte Carlo: the rest of this season, the play-in, the playoffs and the lottery ----------
    function bracket(rng, nets, wins) {
      const out = { seeds: {}, playin: {}, champ: null, conf: {}, order: {} };
      const win = (a, b, home) => rng() < Mo.winPct(nets[a], nets[b], home) ? a : b;
      const series = (hi, lo) => {
        let wh = 0, wl = 0; const homeHi = [1, 1, 0, 0, 1, 0, 1]; let g = 0;
        while (wh < 4 && wl < 4) { if (rng() < Mo.winPct(nets[hi], nets[lo], !!homeHi[g])) wh++; else wl++; g++; }
        return wh > wl ? hi : lo;
      };
      for (const conf of ["E", "W"]) {
        const st = codes.filter(c => W.T[c].conf === conf).map(c => [c, wins[c] + rng() * 0.01]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
        out.order[conf] = st;
        const w78 = win(st[6], st[7], true), l78 = w78 === st[6] ? st[7] : st[6];
        const w910 = win(st[8], st[9], true);
        const w8 = win(l78, w910, true);
        out.seeds[conf] = [...st.slice(0, 6), w78, w8];
        out.playin[conf] = { teams: st.slice(6, 10), l78 };
        const s = out.seeds[conf];
        const ord = (a, b) => s.indexOf(a) < s.indexOf(b) ? [a, b] : [b, a];
        const r1 = [[0, 7], [3, 4], [2, 5], [1, 6]].map(([a, b]) => series(s[a], s[b]));
        const r2 = [series(...ord(r1[0], r1[1])), series(...ord(r1[2], r1[3]))];
        out.conf[conf] = series(...ord(r2[0], r2[1]));
      }
      const e = out.conf.E, w = out.conf.W;
      out.champ = wins[e] >= wins[w] ? series(e, w) : series(w, e);
      return out;
    }
    // Full draft order for one simulated season: the lottery for the 16 lottery teams, then everyone else by record;
    // the second round worst to best
    function draftOrder(rng, wins, br) {
      const all = codes.slice().sort((a, b) => wins[a] - wins[b] || (rng() - 0.5));
      const bottom3 = all.slice(0, 3);
      const lot = L.lotteryEntries(br.order, { E: br.playin.E.l78, W: br.playin.W.l78 }, bottom3);
      const r1 = L.lotteryDraw(lot, bottom3, rng);
      const rest = all.filter(c => !r1.includes(c));
      return { r1: r1.concat(rest), r2: all };
    }
    H.season0 = () => cache("season0", () => {
      const { nets } = H.nets0();
      const rng = Mo.rng(2027);
      const games = W.sched.filter(g => !g.done);
      const N = cfg.sims, out = {};
      for (const c of codes) out[c] = { code: c, w: W.T[c].w, l: W.T[c].l, wins: 0, top6: 0, playin: 0, playoffs: 0, confW: 0, title: 0, slots: new Array(31).fill(0), slots2: new Array(31).fill(0), top4: 0, no1: 0, seedSum: 0 };
      const sd = 2.0 * Math.sqrt(frac0);
      for (let k = 0; k < N; k++) {
        const nk = {}; for (const c of codes) nk[c] = nets[c] + Mo.gauss(rng) * sd;
        const wins = {}; for (const c of codes) wins[c] = W.T[c].w;
        for (const g of games) { if (rng() < Mo.winPct(nk[g.h], nk[g.a], true)) wins[g.h]++; else wins[g.a]++; }
        const br = bracket(rng, nk, wins);
        for (const c of codes) out[c].wins += wins[c];
        for (const conf of ["E", "W"]) {
          br.order[conf].forEach((c, j) => { out[c].seedSum += j + 1; if (j < 6) out[c].top6++; else if (j < 10) out[c].playin++; });
          br.seeds[conf].forEach(c => out[c].playoffs++);
          out[br.conf[conf]].confW++;
        }
        out[br.champ].title++;
        const d = draftOrder(rng, wins, br);
        d.r1.forEach((c, j) => { out[c].slots[j + 1]++; if (j < 4) out[c].top4++; if (j === 0) out[c].no1++; });
        d.r2.forEach((c, j) => { out[c].slots2[j + 1]++; });
      }
      for (const c of codes) {
        const o = out[c];
        o.projW = o.wins / N; o.projL = 82 - o.projW; o.net = nets[c];
        for (const k of ["top6", "playin", "playoffs", "confW", "title", "top4", "no1"]) o[k] /= N;
        o.seed = o.seedSum / N;
        o.slots = o.slots.map(x => x / N); o.slots2 = o.slots2.map(x => x / N);
        o.avgPick = sum(o.slots.map((p, s) => p * s));
      }
      return out;
    });

    // ---------- Later seasons: who's on the roster, rookies, free agent fills, projected wins ----------
    // Rookies: ratings from the draft slot (Banner 19's curve, calibrated on recent classes), growing toward a ceiling
    function rookRating(p, i) {
      const k = i - p.arrive;
      let r = p.r0, a = p.age;
      for (let j = 0; j < k; j++) { if (a <= 25 && p.pot > r) r += (p.pot - r) * (a <= 21 ? 0.3 : a <= 23 ? 0.25 : 0.2); else r += Mo.ageStep(a + 1); a++; }
      return r;
    }
    const prospects = (board.players || []).slice().sort((a, b) => a.rank - b.rank);
    // Where each team's pick lands in a draft: 2027 from the simulations, later drafts from the season before
    H.draftSlots = year => cache("slots" + year, () => {
      const i = year - 2027;                                  // the season that decides this draft
      let avg;
      if (i === 0) { const s0 = H.season0(); avg = Object.fromEntries(codes.map(c => [c, s0[c].avgPick])); }
      else { const s = H.seasonProj(i); avg = Object.fromEntries(codes.map(c => [c, s.teams[c].projW])); }
      const order = codes.slice().sort((a, b) => avg[a] - avg[b]);   // pick 1 first (low avg pick, or fewest wins)
      return Object.fromEntries(order.map((c, j) => [c, j + 1]));
    });
    H.rookies = i => cache("rook" + i, () => {
      if (i < 1) return [];
      const year = 2026 + i, slots = H.draftSlots(year), out = [];
      for (const c of codes) {
        const slot = slots[c];
        const pk = W.picks.find(x => x.y === year && x.r === 1 && x.from === c);
        const owner = pk ? (pk.prot && slot >= pk.prot.lo && slot <= pk.prot.hi ? pk.prot.back : pk.owner) : c;
        if (!owner || owner === "OUT" || !W.T[owner]) continue;
        const x = year === 2027 ? prospects[slot - 1] : null;
        const deal = CBA.rookieDeal(slot, i);
        const pos = x ? (/C|PF/.test(x.pos) ? (x.pos === "C" ? "B" : "W") : /G/.test(x.pos) ? "G" : "W") : ["G", "W", "B"][slot % 3];
        out.push({ id: "rook-" + year + "-" + slot, n: x ? x.n : year + " No. " + slot + " pick" + (owner !== c ? " (" + c + ")" : ""), rook: true, t: owner, from: c, slot, year, arrive: i,
          age: x && x.age ? Math.round(x.age) : 20, r0: L.rookieNow(slot), pot: L.rookiePot(slot), pos, prospect: x ? x.id : null, school: x ? x.school : "",
          c: { sal: deal.sal, opt: {} }, h: 0.88, yos: 0, o: L.rookieNow(slot) * 0.6, d: L.rookieNow(slot) * 0.4 });
      }
      return out;
    });
    H.rosterAt = (code, i) => cache("ros" + code + ":" + i, () => {
      if (i === 0) return H.roster0(code).map(p => ({ p, sal: H.salary(p, 0), r: H.rating(p, 0), how: "contract" }));
      const out = [];
      for (const p of Object.values(W.P)) {
        if (p.t !== code || p.two) continue;
        const s = H.salaryAt(p, i);
        if (s > 0) out.push({ p, sal: s, r: H.rating(p, i), how: H.salary(p, i) > 0 ? "contract" : "re-signed" });
      }
      for (let j = 1; j <= i; j++) for (const rk of H.rookies(j)) if (rk.t === code) {
        const s = rk.c.sal[i] || 0;
        if (s > 0) out.push({ p: rk, sal: s, r: rookRating(rk, i), how: "rookie" });
      }
      // Open spots: a team signs what its cap position allows (cap room, then the mid-level, then minimums)
      const payroll = sum(out.map(x => x.sal));
      let room = CBA.cap(i) - payroll, mle = false, spent = 0;
      for (let n = out.length; n < 13; n++) {
        let r = -2.5, sal = CBA.minSal(3, i), kind = "Replacement player";
        if (cfg.fill) {
          if (room > 0.22 * CBA.cap(i)) { r = 1.4; sal = Math.round(0.22 * CBA.cap(i)); kind = "Free agent (cap room)"; room -= sal; }
          else if (room > 0.09 * CBA.cap(i)) { r = 0.2; sal = Math.round(0.09 * CBA.cap(i)); kind = "Free agent (cap room)"; room -= sal; }
          else if (!mle && payroll + spent < CBA.a1(i)) { r = -0.6; sal = CBA.line(payroll > CBA.cap(i) ? "ntmle" : "rmle", i); kind = "Free agent (mid-level)"; mle = true; }
          else { r = -1.6; kind = "Free agent (minimum)"; }
        }
        spent += sal;
        out.push({ p: { id: "fill-" + code + "-" + i + "-" + n, n: kind, fill: true, t: code, pos: ["G", "W", "B"][n % 3], age: 28 }, sal, r, how: "fill" });
      }
      return out;
    });
    H.payroll = (code, i) => sum(H.rosterAt(code, i).map(x => x.sal));
    H.seasonProj = i => cache("proj" + i, () => {
      if (i === 0) {
        const s0 = H.season0();
        return { i, teams: s0, nets: H.nets0().nets };
      }
      const raws = {}, rots = {};
      for (const c of codes) {
        const list = H.rosterAt(c, i).map(x => ({ id: x.p.id, pos: x.p.pos || "W", o: x.r * 0.6, d: x.r * 0.4 }));
        const s = strength(list); raws[c] = s.raw; rots[c] = s.rot;
      }
      const nets = netsFrom(raws);
      const rng = Mo.rng(2027 + i * 101), N = cfg.futureSims, sd = 1.6 + 0.6 * i;
      const out = {};
      for (const c of codes) {
        const opp = codes.filter(x => x !== c).map(x => nets[x]);
        out[c] = { code: c, projW: Mo.expWins(nets[c], opp), net: nets[c], playoffs: 0, playin: 0, confW: 0, title: 0, top6: 0, rot: rots[c] };
      }
      for (let k = 0; k < N; k++) {
        const nk = {}, wins = {};
        for (const c of codes) { nk[c] = nets[c] + Mo.gauss(rng) * sd; }
        for (const c of codes) wins[c] = clamp(out[c].projW + (nk[c] - nets[c]) * 2.6 + Mo.gauss(rng) * 3, 5, 77);
        const br = bracket(rng, nk, wins);
        for (const conf of ["E", "W"]) {
          br.order[conf].forEach((c, j) => { if (j < 6) out[c].top6++; else if (j < 10) out[c].playin++; });
          br.seeds[conf].forEach(c => out[c].playoffs++);
          out[br.conf[conf]].confW++;
        }
        out[br.champ].title++;
      }
      for (const c of codes) { for (const k of ["top6", "playin", "playoffs", "confW", "title"]) out[c][k] /= N; out[c].projL = 82 - out[c].projW; }
      return { i, teams: out, nets };
    });
    H.standings = i => {
      const s = H.seasonProj(i);
      return codes.map(c => Object.assign({}, s.teams[c], teamInfo[c])).sort((a, b) => b.projW - a.projW);
    };

    // ---------- Surplus: what a contract is worth against what it pays ----------
    const discAt = j => Math.pow(1 + cfg.disc, -j);
    H.surplus = (p, mode) => {
      mode = mode || cfg.mode;
      return cache("sur" + p.id + mode + cfg.disc, () => {
        const rows = [];
        const e = H.lastYear(p);
        for (let j = 0; j <= Math.max(e, -1) && j < 6; j++) {
          const sal = H.salary(p, j);
          if (!sal) continue;
          const part = j === 0 ? frac0 : 1;
          const v = mode === "market" ? marketAt(p, j) : prodAt(p, j);
          const opt = p.c.opt && p.c.opt[j] ? p.c.opt[j] : "";
          rows.push({ j, season: CBA.seasonName(j), r: H.rating(p, j), value: v * part, sal: sal * part, surplus: (v - sal) * part, pv: (v - sal) * part * discAt(j), opt, part });
        }
        const pv = sum(rows.map(r => r.pv));
        return { rows, pv, total: sum(rows.map(r => r.surplus)), years: rows.length, salLeft: sum(rows.map(r => r.sal)) };
      });
    };

    // ---------- Draft picks ----------
    const MARKET_PICK = (slot, round) => round === 1 ? 110e6 * Math.exp(-(Math.max(1, slot) - 1) / 5.5) + 5e6 : 2.5e6;
    const pickCurve = s => curve[clamp(Math.round(s), 1, 60) - 1] || 0;
    // Where a team's pick could land: the simulations for 2027, a spread around the projected slot after that
    H.slotDist = (from, year, round) => cache("sd" + from + year + round, () => {
      if (year === 2027) {
        const s0 = H.season0()[from];
        return (round === 1 ? s0.slots : s0.slots2).map((p, s) => [s, p]).filter(x => x[0] > 0 && x[1] > 0);
      }
      const yrs = year - 2027;
      let center;
      if (yrs <= YEARS - 1) { const sp = H.seasonProj(yrs); const order = codes.slice().sort((a, b) => sp.teams[a].projW - sp.teams[b].projW); center = order.indexOf(from) + 1; }
      else center = 15.5;
      center = 15.5 + (center - 15.5) * Math.pow(0.8, Math.max(0, yrs - 1));
      const sd = 4 + 2.5 * yrs, out = [];
      let tot = 0;
      for (let s = 1; s <= 30; s++) { const w = Math.exp(-0.5 * Math.pow((s - center) / sd, 2)); out.push([s, w]); tot += w; }
      return out.map(([s, w]) => [s, w / tot]);
    });
    H.pickInfo = pk => {
      const dist = H.slotDist(pk.from, pk.y, pk.r);
      const prot = pk.prot;
      const conveys = prot ? sum(dist.filter(([s]) => s < prot.lo || s > prot.hi).map(x => x[1])) : 1;
      const avg = sum(dist.map(([s, p]) => s * p)) / Math.max(1e-9, sum(dist.map(x => x[1])));
      return { dist, conveys, avg: avg + (pk.r === 2 ? 30 : 0) };
    };
    H.pickValue = (pk, mode) => {
      mode = mode || cfg.mode;
      return cache("pv" + pk.id + mode + cfg.disc, () => {
        const info = H.pickInfo(pk), yrs = pk.y - 2027;
        let v = 0;
        for (const [s, p] of info.dist) {
          if (pk.prot && s >= pk.prot.lo && s <= pk.prot.hi) continue;      // stays with the original team
          const slot = s + (pk.r === 2 ? 30 : 0);
          v += p * (mode === "market" ? MARKET_PICK(slot, pk.r) : pickCurve(slot));
        }
        const grow = Math.pow(CBA.D().growth, yrs);
        return mode === "market" ? v * Math.pow(0.93, yrs) : v * grow * discAt(yrs);
      });
    };
    H.pickName = pk => {
      const from = teamInfo[pk.from] ? teamInfo[pk.from].short : pk.from;
      let s = pk.y + " " + (pk.r === 1 ? "1st" : "2nd") + (pk.owner !== pk.from ? " (" + from + ")" : "");
      if (pk.prot) s += pk.r === 2 ? ", protected " + pk.prot.lo + "-" + pk.prot.hi : pk.prot.lo === 1 ? ", top-" + pk.prot.hi + " protected" : ", protected " + pk.prot.lo + "-" + pk.prot.hi;
      return s;
    };
    H.picksOf = code => W.picks.filter(pk => pk.owner === code).sort((a, b) => a.y - b.y || a.r - b.r);
    H.picksOwed = code => W.picks.filter(pk => pk.from === code && pk.owner !== code).sort((a, b) => a.y - b.y || a.r - b.r);

    // ---------- Boards ----------
    H.players = () => Object.values(W.P).filter(p => !p.two && H.salary(p, 0) > 0);
    H.valueBoard = mode => cache("vb" + (mode || cfg.mode) + cfg.disc, () =>
      H.players().map(p => ({ p, s: H.surplus(p, mode) })).sort((a, b) => b.s.pv - a.s.pv));
    // This summer's class: everyone whose deal ends after this season (options as the model expects them to go)
    H.faClass = () => cache("fa" + cfg.disc, () => {
      const out = [];
      for (const p of H.players()) {
        if (H.lastYear(p) !== 0) continue;
        const opt = p.c.opt && p.c.opt[1];
        const age = Mo.ageIn(p, 1, W), r = Mo.rAhead(p, 1), yrs = Mo.faYears(age, r);
        let prod = 0, mkt = 0;
        for (let k = 0; k < yrs; k++) { prod += prodAt(p, 1 + k); mkt += marketAt(p, 1 + k); }
        out.push({ p, kind: H.faKind(p), opt, age, r, yrs, fair: prod / yrs, market: mkt / yrs, team: p.t, keep: H.kept(p) });
      }
      return out.sort((a, b) => b.r - a.r);
    });
    // Next summer's spending power: cap room after the deals already on the books and rookies, or the exception
    H.capOutlook = i => cache("cap" + i, () => codes.map(c => {
      const committed = sum(Object.values(W.P).filter(p => p.t === c && !p.two).map(p => H.salary(p, i)))
        + sum(H.rookies(i).filter(r => r.t === c).map(r => r.c.sal[i] || 0));
      const n = Object.values(W.P).filter(p => p.t === c && !p.two && H.salary(p, i) > 0).length + H.rookies(i).filter(r => r.t === c).length;
      const room = CBA.cap(i) - committed;
      const tool = room > CBA.line("rmle", i) ? "Cap room" : committed < CBA.a1(i) ? "Non-taxpayer mid-level" : committed < CBA.a2(i) ? "Taxpayer mid-level" : "Minimums only";
      return { code: c, committed, room, n, tool, status: CBA.status(committed, i) };
    }).sort((a, b) => b.room - a.room));
    // What deals pay against what they buy: every veteran contract on the books, grouped by kind
    H.premium = () => cache("prem", () => {
      const rows = [];
      for (const p of H.players()) {
        const c = p.c || {}, sal = H.salary(p, 0);
        if (c.rk && c.rk[1] > 0) continue;                                   // rookie scale: set by the league
        if (sal <= CBA.minSal(10, 0) * 1.02) continue;                          // minimums
        const prod = prodAt(p, 0), yrs = H.lastYear(p) + 1, age = p.age;
        rows.push({ p, sal, prod, ratio: sal / prod, yrs, age, max: sal >= CBA.cap(0) * 0.245 });
      }
      const med = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
      const group = (label, f) => { const g = rows.filter(f); return { label, n: g.length, ratio: med(g.map(x => x.ratio)) }; };
      return {
        rows,
        groups: [
          group("Max deals", r => r.max),
          group("Four or more years left", r => !r.max && r.yrs >= 4),
          group("Two or three years left", r => !r.max && r.yrs >= 2 && r.yrs <= 3),
          group("Final season", r => !r.max && r.yrs === 1),
          group("Age 30 and up", r => !r.max && r.age >= 30),
          group("Age 25 and under", r => !r.max && r.age <= 25),
          group("$30M and up (not max)", r => !r.max && r.sal >= 30e6),
          group("$10M to $20M", r => r.sal >= 10e6 && r.sal < 20e6),
        ],
      };
    });

    // ---------- Trades ----------
    // tr: { teams: [codes], moves: [{ kind: "p" | "k", id, from, to }] }
    H.checkTrade = tr => {
      if (tr.teams.length === 2) {
        const [a, b] = tr.teams;
        const side = c => ({ players: tr.moves.filter(m => m.from === c && m.kind === "p").map(m => m.id), picks: tr.moves.filter(m => m.from === c && m.kind === "k").map(m => m.id), cash: 0 });
        return L.checkTrade(W, { a, b, side: { [a]: side(a), [b]: side(b) } });
      }
      return L.checkTradeMulti(W, tr);
    };
    H.assetValue = (m, mode) => m.kind === "p" ? H.surplus(W.P[m.id], mode).pv : H.pickValue(W.picks.find(x => x.id === m.id), mode);
    H.tradeSummary = tr => {
      const out = {};
      for (const c of tr.teams) out[c] = { prod: 0, market: 0, salIn: 0, salOut: 0, inn: [], out: [] };
      for (const m of tr.moves) {
        const vp = H.assetValue(m, "prod"), vm = H.assetValue(m, "market");
        const sal = m.kind === "p" ? H.salary(W.P[m.id], 0) : 0;
        out[m.to].prod += vp; out[m.to].market += vm; out[m.to].salIn += sal; out[m.to].inn.push(m);
        out[m.from].prod -= vp; out[m.from].market -= vm; out[m.from].salOut += sal; out[m.from].out.push(m);
      }
      // This season's wins, before and after
      const { nets } = H.nets0();
      const raws = {};
      const moved = {};
      for (const m of tr.moves) if (m.kind === "p") moved[m.id] = m.to;
      for (const c of codes) {
        const list = Object.values(W.P).filter(p => !p.two && H.salary(p, 0) > 0 && !injured[p.id] && (moved[p.id] || p.t) === c).map(p => ratedCopy(p, 0));
        raws[c] = strength(list).raw;
      }
      const after = netsFrom(raws);
      for (const c of tr.teams) {
        const opp = n => codes.filter(x => x !== c).map(x => n[x]);
        const wLeft = 82 - W.T[c].w - W.T[c].l;
        out[c].winsBefore = W.T[c].w + Mo.expWins(nets[c], opp(nets), wLeft);
        out[c].winsAfter = W.T[c].w + Mo.expWins(after[c], opp(after), wLeft);
      }
      return out;
    };
    H.findPlayer = id => W.P[id] || null;
    H.teamPlayers = code => Object.values(W.P).filter(p => p.t === code);
    return H;
  }

  // 2027: the owner of each team's pick from the current draft order. 2028-33: the ledger of picks owed.
  function setPicks(W, board, codes) {
    W.picks = [];
    for (let y = 2027; y <= 2033; y++) for (const c of codes) for (const r of [1, 2]) W.picks.push({ id: `${y}-${r}-${c}`, y, r, from: c, owner: c });
    const pk = id => W.picks.find(p => p.id === id);
    for (const row of ((board.order || {}).picks || [])) {
      const [, round, owner, from] = row;
      const p = pk(`2027-${round}-${fix(from)}`);
      if (p && W.T[fix(owner)]) p.owner = fix(owner);
    }
    // 2027 firsts with protections or conditions (the Big Board's rule list, from RealGM)
    for (const x of (((board.rules || {}).first) || [])) {
      if (x.type === "to") {
        const p = pk(`2027-1-${fix(x.orig)}`); if (!p) continue;
        p.owner = fix(x.to);
        if (x.keep) p.prot = { lo: x.keep[0], hi: x.keep[1], back: p.from };
        if (x.note && x.note !== "Unprotected") p.note = x.note;
      } else if (x.type === "split") {
        const p = pk(`2027-1-${fix(x.orig)}`); if (!p) continue;
        const [a, b] = x.ranges;
        p.owner = fix(b[2]); p.prot = { lo: a[0], hi: a[1], back: fix(a[2]) }; p.note = x.note; p.locked = true;
      } else if (x.type === "swap") {
        const p = pk(`2027-1-${fix(x.with)}`); if (p) { p.note = x.note; p.locked = true; }
      } else if (x.type === "favorable") {
        for (const o of x.picks) { const p = pk(`2027-1-${fix(o)}`); if (p) { p.note = x.note; p.locked = true; } }
      } else if (x.type === "okc") {
        for (const o of ["OKC", "DEN", "LAC", "TOR"]) { const p = pk(`2027-1-${o}`); if (p) { p.note = x.note; p.locked = true; } }
      }
    }
    for (const row of ((board.future || {}).owed || [])) {
      const [from0, y, r, to0, kind] = row;
      const p = pk(`${y}-${r}-${fix(from0)}`);
      if (!p) continue;
      const tos = String(to0).split("/").map(fix);
      if (kind === "forfeit") { p.owner = "OUT"; p.note = "Forfeited by the league"; continue; }
      if (kind === "swap") { p.note = (p.note ? p.note + "; " : "") + tos.join(" or ") + " can swap"; p.swapBy = tos; p.locked = true; continue; }
      const to = tos[0];
      if (to === "?" || !W.T[to]) { p.note = "Conditional"; p.locked = true; continue; }
      p.owner = to;
      if (tos.length > 1 || kind === "fav" || kind === "cond") { p.note = kind === "fav" ? "Goes to " + tos.join(" or ") + " (more/less favorable)" : "Goes to " + tos.join(" or ") + " depending on where picks land"; p.locked = true; }
      const m = /^(\d+)-(\d+)$/.exec(kind || "");
      if (m) {
        const lo = +m[1] - (r === 2 ? 30 : 0), hi = +m[2] - (r === 2 ? 30 : 0);
        p.prot = { lo: Math.max(1, lo), hi: Math.min(30, hi), back: p.from };
        p.note = p.note || (r === 1 ? (+m[1] === 1 ? "Top-" + m[2] + " protected" : "Protected " + m[1] + "-" + m[2]) : "Protected " + m[1] + "-" + m[2]);
      }
    }
  }

  const NBAHub = { build, YEARS, DEFAULTS, fix };
  if (typeof module !== "undefined") module.exports = NBAHub; else root.NBAHub = NBAHub;
})(typeof window !== "undefined" ? window : globalThis);
