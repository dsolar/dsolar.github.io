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
  const money = v => "$" + (v / 1e6).toFixed(1) + "M";
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
    growth: 0.5,         // share of a young player's projected improvement that counts in his value
    convex: 1.5,         // production = minutes x (impact above replacement) ^ convex
    blendRookie: 1000,   // a first- or second-year player's rating is mostly a draft-slot guess, so his play moves it faster
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
    // DARKO, pulled daily from darko.app: half of every cap-sheet rating is DARKO as of June 3, so swap in today's
    const slug = (n) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const dk = inp.darko && inp.darko.p ? {} : null, dkJune = {};
    if (dk) {
      for (const r of inp.darko.p) { const k = NC.nameKeys(slug(r[0]))[0]; dk[k] = dk[k] ? "?" : r; }
      for (const [n, v] of Object.entries(inp.darko.june || {})) dkJune[NC.nameKeys(slug(n))[0]] = v;
    }
    const DARKO_W = 0.5;
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
      // Today's DARKO in place of June's (DARKO already folds in this season's games). A player DARKO didn't rate
      // in June (this year's rookies) moves halfway from his draft-slot guess to DARKO's number.
      const inj0 = stats.inj && stats.inj[p.id];
      const out0 = inj0 && /out for the (rest of the )?season|season-ending|remainder of the season/i.test(inj0[1] || "");
      const dr = dk && dk[NC.nameKeys(p.id)[0]];
      if (dr && dr !== "?" && !out0) {                              // DARKO shrinks players who sit; leave the season-long injured be
        const jn = dkJune[NC.nameKeys(p.id)[0]];
        if (jn) { p.o += DARKO_W * (dr[2] - jn[0]); p.d += DARKO_W * (dr[3] - jn[1]); }
        else { p.o += DARKO_W * (dr[2] - p.o); p.d += DARKO_W * (dr[3] - p.d); }
        p.o = +p.o.toFixed(2); p.d = +p.d.toFixed(2);
        p.darko = +(dr[2] + dr[3]).toFixed(1);
      }
      // This season so far: Basketball-Reference's BPM, faded in by minutes played. With today's DARKO in, the box
      // score only moves the other half of the rating (RAPM, CraftedNBA, last year's box score), so it counts half.
      const v = stats.vorp && (stats.vorp[p.id] || stats.vorp[NC.nameKeys(p.id)[0]]);
      const a = stats.avg && stats.avg[String(2027)] && stats.avg[String(2027)][p.id];
      const mins = a ? a[0] * a[1] : 0;
      if (v && mins > 0) {
        const w = (p.darko != null ? 1 - DARKO_W : 1) * mins / (mins + ((p.yos ?? 3) <= 1 ? cfg.blendRookie : cfg.blend));
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
      if (p.two || !rows.length || rows.some(r => r[0] === p.t)) continue;
      // His only contract is an old team's option for this season, and he's playing somewhere else: the option was
      // declined, so nobody owes it, and he's here on a new deal the feeds don't price yet (two-way or camp deal)
      const declined = rows.every(r => r[2] && r[2]["0"] === "TO");
      if (declined) { p.two = true; p.declinedBy = rows[0][0]; p.c = { sal: [0, 0, 0, 0, 0], opt: {} }; count[p.t]--; continue; }
      if (count[p.t] > 15) { p.two = true; p.deadElsewhere = rows[0][0]; count[p.t]--; }
    }
    // Banner 19's world, set to today: real records, this season's remaining schedule, the real pick ledger
    const asOf = (live && live.updated ? live.updated : stats.updated || "2026-11-09").slice(0, 10);
    const W = L.newWorld(Object.assign({}, data, { players }), live ? Object.assign({}, live, { players: null }) : null, 19);
    W.phase = "reg"; W.date = asOf;
    for (const p of Object.values(W.P)) if (!p.c.sal.length) p.c.sal = [0, 0, 0, 0, 0];
    // The real tax history (the world starts with a rough one): who finished over the line in each of the last five seasons
    if (inp.taxhist && inp.taxhist.paid) {
      for (const c of Object.keys(W.T)) {
        W.T[c].taxHist = {};
        for (const [k, list] of Object.entries(inp.taxhist.paid)) W.T[c].taxHist[k] = list.includes(c);
      }
    }
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
    // Every team's real trade exceptions, mid-level use and hard caps
    const tp = (inp.tpes && inp.tpes.teams) || {}, ex = (inp.exceptions && inp.exceptions.teams) || {};
    for (const c of codes) {
      const t = W.T[c];
      t.tpes = (tp[c] || []).filter(x => !x.exp || x.exp >= asOf).map((x, k) => ({ id: "tpe-" + c + "-" + k, amt: x.amt, orig: x.amt, from: x.from, made: x.made, exp: x.exp, season: x.season ?? -1 }));
      const e = ex[c];
      t.used = {}; t.hard = {}; t.hardWhy = {};
      if (e) {
        if (e.kind === "ntmle") { t.used[0] = { ntmle: e.used }; if (e.used > 0) { t.hard[0] = "a1"; t.hardWhy[0] = "Used the non-taxpayer mid-level" + (e.on ? " (" + e.on + ")" : ""); } }
        else if (e.kind === "tmle") { t.used[0] = { tmle: e.used, ntmleOff: true }; if (e.used > 0) { t.hard[0] = "a2"; t.hardWhy[0] = "Used the taxpayer mid-level" + (e.on ? " (" + e.on + ")" : ""); } }
        else if (e.kind === "room") t.used[0] = { room: true, rmle: e.used };
        t.mleNote = e.on ? e.on : "";
      }
      if (((inp.exceptions || {}).baeUsedLastYear || []).includes(c)) t.used[-1] = { bae: 1 };
      t.dead = (((inp.dead || {}).teams || {})[c] || []).map(d => ({ n: d.n, sal: d.sal.slice(), why: "Dead money" }));
    }
    const dec = L.decider(W);

    const H = { cfg, W, CBA, Mo, L, teams: teamInfo, codes, asOf, frac0, played, injured, curve, board, set, reset: () => memo.clear() };
    const memo = new Map();
    const cache = (k, f) => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k); };
    function set(k, v) { cfg[k] = v; memo.clear(); }

    // ---------- Contracts, re-signings and who's on each team in a season ----------
    H.keep = {};                     // user calls on expiring players: id -> true (re-sign) / false (let go)
    H.salary = (p, i) => CBA.salaryIn(p, i, dec);
    H.kicker = p => CBA.kicker(p, 0, dec);           // trade kicker this season, paid by the team that trades for him
    H.lastYear = p => CBA.lastYear(p, dec, 0);
    H.faKind = p => {
      const c = p.c || {}, n = H.lastYear(p) + 1;
      const rookie = (c.rk && c.rk[1] > 0 && c.rk[1] <= 30) || c.rfa;
      return rookie && (p.yos || 0) + n - 1 <= 4 ? "RFA" : "UFA";
    };
    // Ratings ahead: decline counts in full, but only part of a young player's projected growth (cfg.growth),
    // since a lot of projected growth never shows up. Rookies on the slider grow on their own draft-slot curve.
    H.rating = (p, i) => {
      if (p.rook) return rookRating(p, i);
      const r0 = Mo.r(p), r = Mo.rAhead(p, i);
      return r > r0 ? r0 + (r - r0) * cfg.growth : r;
    };
    const marketAt = (p, i) => Mo.market(p, i, W);
    // Minutes: what he's actually playing this season (3+ games), fading toward what his rating earns in later years
    const mpgNow = p => (p.line && p.line.gp >= 3 ? p.line.min : null);
    // The minutes a rating earns (Banner 19's role minutes, smoothed so a rating crossing a line doesn't jump)
    const ROLE = [[-3, 10], [-2, 17], [-0.9, 25], [1, 30], [2, 32], [4, 34]];
    const roleMin = r => { if (r <= ROLE[0][0]) return ROLE[0][1]; for (let k = 1; k < ROLE.length; k++) if (r <= ROLE[k][0]) { const [a, x] = ROLE[k - 1], [b, y] = ROLE[k]; return x + (y - x) * (r - a) / (b - a); } return 34; };
    H.mpgAt = (p, i) => {
      const r = H.rating(p, i), base = roleMin(r), a = mpgNow(p);
      if (a == null || p.rook) return base;
      return clamp(base + (a - roleMin(H.rating(p, 0))) * Math.pow(0.85, i), 0, 38);
    };
    // Production: Stephen Noh's salary model (minutes times impact, scaled to the cap) on real minutes, then scaled
    // once so the whole league's production adds up to what the whole league is paid this season. A dollar of
    // production costs what teams actually pay for it, on average; surplus is who's ahead of that and who's behind.
    const CAP_2526 = 154_647_000;
    // Impact above replacement (-2.5, the level of a free minimum-salary player) counts more than linearly
    // (cfg.convex): minutes and roster spots are scarce, so one +4 player is worth far more than two +1 players,
    // and teams can't buy stars at any price because the max holds their pay down. Linear pricing made cheap
    // role players outrank stars.
    const rawProd = (p, i) => {
      const r = H.rating(p, i), games = Math.min(76, 82 * (p.h ?? 0.85));
      const v = games * H.mpgAt(p, i) * Math.pow(Math.max(0, r + 2.5), cfg.convex);
      return v * CBA.cap(i) / CAP_2526;
    };
    const Kfor = () => cache("K" + cfg.convex + cfg.growth, () => {
      let sv = 0, ss = 0;
      for (const p of Object.values(W.P)) { if (p.two) continue; const sal = CBA.salaryIn(p, 0, dec); if (!sal) continue; sv += rawProd(p, 0); ss += sal; }
      return sv > 0 ? ss / sv : 1;
    });
    Object.defineProperty(H, "K", { get: Kfor });
    const prodAt = (p, i) => Math.max(CBA.minSal((p.yos ?? 3) + i, i), Kfor() * rawProd(p, i));
    H.prodAt = prodAt; H.marketAt = marketAt;
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
    // Lineups. This season: the real starting five (each team's latest game) and real minutes per game, scaled to
    // 240 among the players available. Later seasons: the best player at each spot (PG, SG, SF, PF, C, by the
    // positions he plays), so two centers don't start together, then the bench by rating.
    const SLOTS = ["PG", "SG", "SF", "PF", "C"];
    const MIN_START = [34, 33, 32, 30, 28], MIN_BENCH = [24, 20, 16, 13, 10];
    const posList = p => (p.ps && p.ps.length ? p.ps : p.pos === "G" ? ["PG", "SG"] : p.pos === "B" ? ["C", "PF"] : ["SF", "PF"]);
    function bySlots(entries) {
      const open = new Set(SLOTS), five = {}, rest = [];
      for (const e of entries.slice().sort((a, b) => b.r - a.r)) {
        const slot = open.size ? posList(e.p).find(x => open.has(x)) : null;
        if (slot) { five[slot] = e; open.delete(slot); } else rest.push(e);
      }
      for (const slot of [...open]) { const e = rest.shift(); if (e) five[slot] = e; }
      return { five, rest };
    }
    // Five players onto PG..C with the least stretch: a player costs nothing at his listed position, a little at his
    // second one, and one step for every position away (so a SG/PG plays the point before a forward does)
    function fitFive(five) {
      const idx = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };
      const cost = (e, k) => {
        const ps = posList(e.p);
        return Math.min(...ps.map((x, n) => Math.abs((idx[x] ?? 2) - k) + (n ? 0.25 : 0)));
      };
      let best = null, bestC = Infinity;
      const perm = (left, chosen) => {
        if (!left.length) { const c = chosen.reduce((a, e, k) => a + cost(e, k), 0); if (c < bestC) { bestC = c; best = chosen.slice(); } return; }
        left.forEach((e, n) => perm(left.filter((_, m) => m !== n), chosen.concat([e])));
      };
      perm(five, []);
      const out = {};
      (best || []).forEach((e, k) => { out[SLOTS[k]] = e; });
      return out;
    }
    function buildLineup(entries, i, code) {
      const live = i === 0;
      let starters, bench, mins = {};
      if (live) {
        const latest = stats.lineups && stats.lineups[code];
        const ids = new Set(entries.map(e => e.p.id));
        const real = latest && latest[1].every(id => ids.has(id)) ? latest[1] : null;
        const st = id => (stats.starts && stats.starts[id]) || [0, 0];
        const want = e => { const m = mpgNow(e.p); return m == null ? Mo.roleMin(e.r) * 0.6 : m; };
        const pool = entries.slice().sort((a, b) => want(b) - want(a));
        // The usual starting five: most starts this season (one game's lineup is often a rest night), with last game's
        // starters breaking ties (a starting job that changed hands) and never two true centers when a forward is there
        if (stats.starts && entries.some(e => st(e.p.id)[0] > 0)) {
          const last = new Set(real || []);
          const ranked = pool.slice().sort((a, b) => (st(b.p.id)[0] + (last.has(b.p.id) ? 0.5 : 0)) - (st(a.p.id)[0] + (last.has(a.p.id) ? 0.5 : 0)) || (want(b) - want(a)));
          const isC = e => /^C/.test(e.p.pos || "") && !/F/.test(e.p.pos || "");
          starters = [];
          for (const e of ranked) {
            if (starters.length === 5) break;
            if (isC(e) && starters.some(isC) && ranked.some(x => !starters.includes(x) && x !== e && !isC(x) && st(x.p.id)[0] > 0)) continue;
            starters.push(e);
          }
        } else if (real) starters = real.map(id => entries.find(e => e.p.id === id));
        else starters = SLOTS.map(sl => bySlots(pool).five[sl]).filter(Boolean);
        starters.forEach(e => { e.starts = st(e.p.id); });
        bench = pool.filter(e => !starters.includes(e));
        let tot = 0;
        for (const e of entries) { mins[e.p.id] = want(e); tot += mins[e.p.id]; }
        const k = tot > 0 ? 240 / tot : 0;
        for (const id in mins) mins[id] = Math.min(38, mins[id] * k);
      } else {
        const { five, rest } = bySlots(entries);
        starters = SLOTS.map(sl => five[sl]).filter(Boolean);
        bench = rest;
        starters.slice().sort((a, b) => b.r - a.r).forEach((e, k) => { mins[e.p.id] = MIN_START[k]; });
        bench.forEach((e, k) => { mins[e.p.id] = MIN_BENCH[k] || 0; });
      }
      // starters placed PG to C by the positions they play
      const fit = starters.length === 5 ? fitFive(starters) : bySlots(starters).five;
      const order = SLOTS.map(sl => fit[sl]).filter(Boolean);
      bench = bench.slice().sort((a, b) => (mins[b.p.id] || 0) - (mins[a.p.id] || 0));
      return { starters: order, slots: SLOTS.filter(sl => fit[sl]), bench, mins, real: live && !!(stats.lineups && stats.lineups[code]) };
    }
    H.buildLineup = buildLineup;
    function strengthOf(entries, i, code) {
      const lu = buildLineup(entries, i, code);
      const list = entries.map(e => ({ id: e.p.id, pos: e.p.pos || "W", o: e.r * 0.6, d: e.r * 0.4 }));
      return { raw: Mo.raw(list, lu.mins), lu };
    }
    H.lineup = (code, i) => cache("lu" + code + ":" + i, () => buildLineup(H.rosterAt(code, i).filter(e => i > 0 || !injured[e.p.id]), i, code));
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
        const entries = H.rosterAt(c, 0).filter(e => !injured[e.p.id]);
        const s = strengthOf(entries, 0, c); raws[c] = s.raw; rots[c] = s.lu;
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
        let owner = pk ? (pk.prot && slot >= pk.prot.lo && slot <= pk.prot.hi ? pk.prot.back : pk.owner) : c;
        const g = pk && H.groupOf(pk);
        if (g) owner = assignGroup(g, Object.fromEntries(g.picks.map(id => [id, slots[id.split("-")[2]]])))[pk.id];
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
      const payroll = sum(out.map(x => x.sal)) + H.dead(code, i);
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
    H.dead = (code, i) => sum(W.T[code].dead.map(d => d.sal[i] || 0));
    H.payroll = (code, i) => sum(H.rosterAt(code, i).map(x => x.sal)) + H.dead(code, i);
    H.seasonProj = i => cache("proj" + i, () => {
      if (i === 0) {
        const s0 = H.season0();
        return { i, teams: s0, nets: H.nets0().nets };
      }
      const raws = {}, rots = {};
      for (const c of codes) {
        const s = strengthOf(H.rosterAt(c, i), i, c); raws[c] = s.raw; rots[c] = s.lu;
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
      return cache("sur" + p.id + mode + cfg.disc + cfg.growth, () => {
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
    // Groups (better-of picks) and swaps: play out where the picks land many times and count who ends up with what
    const sampler = dist => { const cum = []; let t = 0; for (const [sl, p] of dist) { t += p; cum.push([sl, t]); } return u => { u *= t; for (const [sl, c] of cum) if (u <= c) return sl; return cum.length ? cum[cum.length - 1][0] : 15; }; };
    const slotVal = (slot, round, mode) => { const sl = slot + (round === 2 ? 30 : 0); return mode === "market" ? MARKET_PICK(sl, round) : pickCurve(sl); };
    const yearAdj = (yrs, mode) => mode === "market" ? Math.pow(0.93, yrs) : Math.pow(CBA.D().growth, yrs) * discAt(yrs);
    H.groupOf = pk => pk.group ? W.pickGroups.find(g => g.id === pk.group) : null;
    H.groupValues = (g, mode) => cache("gv" + g.id + mode + cfg.disc, () => {
      const picks = g.picks.map(id => W.picks.find(x => x.id === id));
      const samp = picks.map(p => sampler(H.slotDist(p.from, p.y, p.r)));
      const rng = Mo.rng(g.id.length * 7919 + picks[0].y), N = 3000, got = {};
      for (let k = 0; k < N; k++) {
        const slots = {}; picks.forEach((p, j) => { slots[p.id] = samp[j](rng()); });
        const a = assignGroup(g, slots);
        for (const id in a) got[a[id]] = (got[a[id]] || 0) + slotVal(slots[id], picks[0].r, mode) / N;
      }
      const adj = yearAdj(picks[0].y - 2027, mode);
      for (const k in got) got[k] *= adj;
      return got;
    });
    H.swapValue = (sw, mode) => cache("sw" + sw.id + (mode || cfg.mode) + cfg.disc, () => {
      mode = mode || cfg.mode;
      const a = sampler(H.slotDist(sw.from, sw.y, sw.r)), b = sampler(H.slotDist(sw.holder, sw.y, sw.r));
      const rng = Mo.rng(sw.id.length * 31 + sw.y), N = 3000; let v = 0;
      for (let k = 0; k < N; k++) v += Math.max(0, slotVal(a(rng()), sw.r, mode) - slotVal(b(rng()), sw.r, mode)) / N;
      return v * yearAdj(sw.y - 2027, mode);
    });
    H.swapsOf = code => W.swaps.filter(s => s.holder === code);
    H.pickValue = (pk, mode) => {
      mode = mode || cfg.mode;
      const g = H.groupOf(pk);
      if (g) {
        const got = H.groupValues(g, mode), mine = W.picks.filter(x => x.group === g.id && x.owner === pk.owner).length || 1;
        return (got[pk.owner] || 0) / mine;
      }
      const sw = W.swaps.find(x => x.from === pk.from && x.y === pk.y && x.r === pk.r);
      if (sw) return Math.max(0, H.pickValue0(pk, mode) - H.swapValue(sw, mode));
      return H.pickValue0(pk, mode);
    };
    H.pickValue0 = (pk, mode) => {
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
      if (pk.prot) s += pk.r === 2 ? ", protected " + (pk.prot.lo + (pk.prot.hi <= 30 ? 30 : 0)) + "-" + (pk.prot.hi + (pk.prot.hi <= 30 ? 30 : 0)) : pk.prot.lo === 1 ? ", top-" + pk.prot.hi + " protected" : ", protected " + pk.prot.lo + "-" + pk.prot.hi;
      return s;
    };
    H.picksOf = code => W.picks.filter(pk => pk.owner === code).sort((a, b) => a.y - b.y || a.r - b.r);
    H.picksOwed = code => W.picks.filter(pk => pk.from === code && pk.owner !== code).sort((a, b) => a.y - b.y || a.r - b.r);

    // ---------- Boards ----------
    H.players = () => Object.values(W.P).filter(p => !p.two && H.salary(p, 0) > 0);
    H.valueBoard = mode => cache("vb" + (mode || cfg.mode) + cfg.disc + cfg.growth, () =>
      H.players().map(p => ({ p, s: H.surplus(p, mode) })).sort((a, b) => b.s.pv - a.s.pv));
    // This summer's class: everyone whose deal ends after this season (options as the model expects them to go)
    // A summer's free agent class: everyone whose deal ends the season before (options as the model expects them).
    // i is the season they'd sign for: 1 = summer 2027.
    H.faClass = (i = 1) => cache("fa" + i + cfg.disc, () => {
      const out = [];
      for (const p of H.players()) {
        if (H.lastYear(p) !== i - 1) continue;
        const opt = p.c.opt && p.c.opt[i];
        const age = Mo.ageIn(p, i, W), r = Mo.rAhead(p, i), yrs = Mo.faYears(age, r);
        let prod = 0, mkt = 0;
        for (let k = 0; k < yrs; k++) { prod += prodAt(p, i + k); mkt += marketAt(p, i + k); }
        out.push({ p, kind: H.faKind(p), opt, age, r, yrs, fair: prod / yrs, market: mkt / yrs, team: p.t, keep: H.kept(p) });
      }
      return out.sort((a, b) => b.r - a.r);
    });
    // What a team can do right now: cap room, exceptions left, trade exceptions, hard cap, repeater, roster spots
    H.tools = (code, i = 0) => cache("tools" + code + i, () => {
      const t = W.T[code], pay = H.payroll(code, i), status = CBA.status(pay, i);
      const out = [];
      const used = t.used[i] || {}, hard = t.hard[i];
      const head = lvl => CBA.levelAmt(lvl, i) - pay;
      const room = CBA.cap(i) - pay;
      if (room > 0) out.push({ name: "Cap room", amt: room, ok: true, why: "Under the cap" });
      const nt = CBA.line("ntmle", i) - (used.ntmle || 0);
      if (i === 0 && used.room) out.push({ name: "Room mid-level", amt: Math.max(0, CBA.line("rmle", i) - (used.rmle || 0)), ok: CBA.line("rmle", i) - (used.rmle || 0) > 0, why: "Used cap room this summer, so the room exception is its mid-level" });
      else if (i === 0 && used.ntmleOff) out.push({ name: "Taxpayer mid-level", amt: Math.max(0, CBA.line("tmle", i) - (used.tmle || 0)), ok: CBA.line("tmle", i) - (used.tmle || 0) > 0 && head("a2") > 0, why: (used.tmle ? "Used " + (t.mleNote || "") + ". " : "") + "Signing only, hard-caps at the second apron" });
      else if (status === "a2") out.push({ name: "Mid-level", amt: 0, ok: false, why: "Over the second apron: no mid-level" });
      else if (status === "a1") out.push({ name: "Taxpayer mid-level", amt: CBA.line("tmle", i), ok: true, why: "Over the first apron. Signing only, hard-caps at the second apron" });
      else out.push({ name: "Non-taxpayer mid-level", amt: Math.max(0, Math.min(nt, head("a1"))), ok: nt > 0 && head("a1") > 0, why: (used.ntmle ? "Used " + money(used.ntmle) + (t.mleNote ? " (" + t.mleNote + ")" : "") + ". " : "") + "Can sign or absorb a player in a trade; hard-caps at the first apron" });
      const baeLast = (t.used[i - 1] || {}).bae;
      if (!used.room && status !== "a1" && status !== "a2") out.push({ name: "Bi-annual exception", amt: baeLast ? 0 : CBA.line("bae", i), ok: !baeLast && head("a1") > 0, why: baeLast ? "Used last season (every other year)" : "Two years max; hard-caps at the first apron" });
      for (const x of t.tpes) {
        const u = L.tpeUsable(W, t, x, status);
        out.push({ name: "Trade exception: " + x.from, amt: x.amt, ok: u.ok, tpe: true, exp: x.exp, why: u.ok ? "Absorb a player making up to " + money(x.amt + CBA.D().match.plus) + " with nothing back. Expires " + L.fmtDate(x.exp) : u.why });
      }
      const rep = L.repeater(W, code, i, j => H.payroll(code, j));
      const n = H.rosterAt(code, i).filter(e => !e.p.fill).length;
      return { tools: out, pay, status, hard, hardWhy: t.hardWhy[i] || "", rep, taxBill: CBA.taxBill(pay, i, rep), roster: n, two: Object.values(W.P).filter(p => p.t === code && p.two).length,
        toTax: CBA.tax(i) - pay, toA1: CBA.a1(i) - pay, toA2: CBA.a2(i) - pay };
    });
    // The repeater clock: tax paid (history, then each later season's projected payroll unless the user says otherwise),
    // whether a bill that season would be at repeater rates, and how long a run of standard-rate tax seasons the team has
    H.repeaterClock = (code, assume) => {
      const t = W.T[code], A = assume || {}, rows = [];
      const paid = j => j < 0 ? !!t.taxHist[j] : A[j] != null ? A[j] : j >= YEARS ? false : H.payroll(code, j) > CBA.tax(j);
      const repAt = (j, pf) => { let n = 0; for (let k = j - 4; k < j; k++) if (pf(k)) n++; return n; };
      for (let j = -5; j < YEARS; j++) {
        const pay = j >= 0 ? H.payroll(code, j) : null, n = j >= -1 ? repAt(j, paid) : null, rep = n != null && n >= 3;
        rows.push({ j, paid: paid(j), hist: j < 0, forced: A[j] != null, pay, over: j >= 0 ? pay - CBA.tax(j) : null, n, rep,
          bill: j >= 0 && pay > CBA.tax(j) ? CBA.taxBill(pay, j, rep) : 0, billStd: j >= 0 && pay > CBA.tax(j) ? CBA.taxBill(pay, j, false) : 0 });
      }
      // The runway: the first season from now a tax bill would be at standard rates, then pay every season after it
      let start = null;
      for (let j = 0; j < YEARS + 4 && start == null; j++) if (repAt(j, paid) < 3) start = j;
      let run = 0;
      if (start != null) {
        const pf = k => k >= start ? true : paid(k);
        for (let j = start; j < start + 6; j++) { if (repAt(j, pf) >= 3) break; run++; }
      }
      return { rows, start, run, nowRep: rows.find(r => r.j === 0).rep, n0: rows.find(r => r.j === 0).n };
    };
    // Every traded pick in the league, with its protection
    H.allPicks = () => W.picks.filter(pk => pk.owner !== pk.from).slice().sort((a, b) => a.y - b.y || a.r - b.r || a.from.localeCompare(b.from));
    // Next summer's spending power: cap room after the deals already on the books and rookies, or the exception
    // Next summer's spending power: room before cap holds (if the team renounces everyone) and after them
    // (Banner 19's holds: free agents it still has Bird rights to, and its own first-round picks)
    H.capOutlook = i => cache("cap" + i, () => codes.map(c => {
      const committed = sum(Object.values(W.P).filter(p => p.t === c && !p.two).map(p => H.salary(p, i)))
        + sum(H.rookies(i).filter(r => r.t === c).map(r => r.c.sal[i] || 0)) + H.dead(c, i);
      const n = Object.values(W.P).filter(p => p.t === c && !p.two && H.salary(p, i) > 0).length + H.rookies(i).filter(r => r.t === c).length;
      let holds = 0, holdList = [];
      try {
        const b = L.books(W, c, i);
        holdList = b.holds.filter(h => h.kind !== "Draft pick");
        holds = sum(holdList.map(h => h.amt));
      } catch (e) { /* books unavailable for this season */ }
      const room = CBA.cap(i) - committed, roomHolds = CBA.cap(i) - committed - holds;
      const tool = room > CBA.line("rmle", i) ? "Cap room" : committed < CBA.a1(i) ? "Non-taxpayer mid-level" : committed < CBA.a2(i) ? "Taxpayer mid-level" : "Minimums only";
      return { code: c, committed, room, roomHolds, holds, holdList, n, tool, status: CBA.status(committed, i) };
    }).sort((a, b) => b.room - a.room));
    // Who can sign an extension right now, and for how much
    H.extensions = code => Object.values(W.P).filter(p => p.t === code && !p.two && H.salary(p, 0) > 0).map(p => {
      const e = CBA.extEligible(p, 0);
      if (!e.ok) return null;
      const lim = CBA.extLimit(p, 0);
      return { p, kind: e.kind, why: e.why, first: lim.first, years: lim.maxYears, start: lim.start, market: marketAt(p, lim.start), prod: prodAt(p, lim.start) };
    }).filter(Boolean);
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
    H.checkTrade = tr => L.checkTradeMulti(W, { teams: tr.teams, moves: tr.moves });
    H.matchMax = (out, post) => CBA.matchMax(out, 0, post);
    H.matchRule = (out, post) => CBA.matchRule(out, 0, post);
    H.assetValue = (m, mode) => m.kind === "c" ? (m.amt || 0) : m.kind === "p" ? H.surplus(W.P[m.id], mode).pv : H.pickValue(W.picks.find(x => x.id === m.id), mode);
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
        const entries = Object.values(W.P).filter(p => !p.two && H.salary(p, 0) > 0 && !injured[p.id] && (moved[p.id] || p.t) === c).map(p => ({ p, r: H.rating(p, 0), sal: H.salary(p, 0) }));
        raws[c] = strengthOf(entries, 0, c).raw;
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
    // Better-of groups: hand each pick to whoever gets it where the picks are projected to land today
    for (const g of W.pickGroups) {
      const slots = {};
      for (const id of g.picks) { const p = W.picks.find(x => x.id === id); slots[id] = H.pickInfo(Object.assign({}, p, { prot: null })).avg; }
      const a = assignGroup(g, slots);
      for (const id of g.picks) { const p = W.picks.find(x => x.id === id); p.owner = a[id]; p.locked = a[id] !== g.to[0]; }
    }
    memo.clear();
    // Things the cap rules here don't block but a real trade would run into
    const deadline = L.dates(0).deadlineEnd;
    H.deadline = deadline;
    H.tradeWarnings = tr => {
      const out = [];
      if (asOf > deadline && asOf < L.dates(0).finals) out.push("It's past this season's trade deadline (" + L.fmtDate(deadline) + " in Banner 19's calendar): no trades until after the season.");
      for (const m of tr.moves) {
        const p = m.kind === "p" ? W.P[m.id] : null;
        if (p && p.c && p.c.signed === 0 && !(p.c.rk && p.c.rk[1] > 0) && asOf < "2026-12-15") out.push(p.n + " signed this offseason; free agents who sign in the summer can't be traded until Dec. 15.");
      }
      return out;
    };
    // Trade finder: packages from every other team that make the salaries work for a target player, balanced
    // with draft picks when one side gives up more value. Only legal deals come back.
    H.findTrades = (pid, mode) => {
      mode = mode || cfg.mode;
      const p = W.P[pid];
      if (!p) return [];
      const A = p.t, S = H.salary(p, 0), kickA = H.kicker(p), vT = H.surplus(p, mode).pv;
      const payA = H.payroll(A, 0), out = [];
      for (const B of codes) {
        if (B === A) continue;
        const payB = H.payroll(B, 0);
        const pool = Object.values(W.P).filter(q => q.t === B && !q.two && H.salary(q, 0) > 0).sort((a, b) => H.salary(b, 0) - H.salary(a, 0)).slice(0, 13);
        const combos = [];
        const n = pool.length;
        for (let a = 0; a < n; a++) {
          combos.push([pool[a]]);
          for (let b = a + 1; b < n; b++) {
            combos.push([pool[a], pool[b]]);
            for (let c = b + 1; c < n; c++) combos.push([pool[a], pool[b], pool[c]]);
          }
        }
        const cands = [];
        for (const combo of combos) {
          const T = sum(combo.map(q => H.salary(q, 0))), kickB = sum(combo.map(q => H.kicker(q)));
          const postB = payB - T + S + kickA, postA = payA - S + T + kickB;
          const okB = postB <= CBA.cap(0) || S + kickA <= CBA.matchMax(T, 0, CBA.status(postB, 0));
          const okA = postA <= CBA.cap(0) || T + kickB <= CBA.matchMax(S, 0, CBA.status(postA, 0));
          if (!okA || !okB) continue;
          const v = sum(combo.map(q => H.surplus(q, mode).pv));
          cands.push({ combo, v, gap: v - vT });          // gap > 0: A gets more than it gives
        }
        cands.sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap));
        let found = 0;
        for (const c of cands.slice(0, 40)) {
          if (found >= 2) break;
          const moves = [{ kind: "p", id: p.id, from: A, to: B }].concat(c.combo.map(q => ({ kind: "p", id: q.id, from: B, to: A })));
          let gap = c.gap;
          // the side getting less adds draft picks (smallest that close the gap first) until it's close to even
          const payer = gap < 0 ? B : A, sign = gap < 0 ? 1 : -1;
          const picks = H.picksOf(payer).filter(pk => !pk.locked).map(pk => ({ pk, v: H.pickValue(pk, mode) })).filter(x => x.v > 0).sort((x, y) => x.v - y.v);
          let added = 0;
          while (Math.abs(gap) > 4e6 && added < 3) {
            const need = Math.abs(gap);
            const x = picks.find(y => y.v >= need * 0.8 && y.v <= need * 1.25) || picks.filter(y => y.v < need).pop();
            if (!x) break;
            picks.splice(picks.indexOf(x), 1);
            moves.push({ kind: "k", id: x.pk.id, from: payer, to: payer === A ? B : A });
            gap += sign * x.v; added++;
          }
          if (Math.abs(gap) > Math.max(12e6, Math.abs(vT) * 0.2)) continue;
          const chk = H.checkTrade({ teams: [A, B], moves });
          if (!chk.ok) continue;
          out.push({ team: B, moves, gap, legal: true });
          found++;
        }
      }
      return out.sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap)).slice(0, 15);
    };
    H.findPlayer = id => W.P[id] || null;
    H.teamPlayers = code => Object.values(W.P).filter(p => p.t === code);
    H.darkoThrough = (inp.darko && inp.darko.through) || null;
    return H;
  }

  // 2027: the owner of each team's pick from the current draft order. 2028-33: the ledger of picks owed.
  function setPicks(W, board, codes) {
    W.picks = []; W.pickGroups = []; W.swaps = [];
    const favRows = {};
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
        const ids = x.picks.map(o => `2027-1-${fix(o)}`).filter(pk);
        for (const id of ids) { const p = pk(id); p.note = x.note; p.group = "g2027-" + ids.join("-"); }
        W.pickGroups.push({ id: "g2027-" + ids.join("-"), picks: ids, to: x.to.map(fix), bar: Object.fromEntries(Object.entries(x.bar || {}).map(([k, v]) => [fix(k), v])), lastKeep: x.lastKeep || null, fallback: x.fallback ? fix(x.fallback) : null, alt: {}, note: x.note });
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
      if (kind === "swap") {
        p.note = (p.note ? p.note + "; " : "") + tos.join(" or ") + " can swap";
        if (W.T[tos[0]]) { p.swapBy = tos[0]; W.swaps.push({ id: `swap-${y}-${r}-${p.from}-${tos[0]}`, y, r, from: p.from, holder: tos[0], note: tos.length > 1 ? "Swap rights shared with " + tos.slice(1).join(", ") : "" }); }
        continue;
      }
      if (kind === "fav" && W.T[tos[0]]) {
        // the first team takes the most favorable pick of the group; each other pick goes to its own second team
        const key = `${y}-${r}-${tos[0]}`;
        (favRows[key] = favRows[key] || { y, r, best: tos[0], picks: [] }).picks.push({ id: p.id, alt: tos[1] && W.T[tos[1]] ? tos[1] : null, tos });
        p.owner = tos[0];
        continue;
      }
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
    for (const g of Object.values(favRows)) {
      const id = `g${g.y}-${g.r}-${g.best}`, alt = {};
      for (const x of g.picks) { alt[x.id] = x.alt; pk(x.id).group = id; }
      const froms = g.picks.map(x => x.id.split("-")[2]);
      const others = [...new Set(g.picks.map(x => x.alt || x.id.split("-")[2]))];
      const note = g.picks.length > 1 ? (g.best + " gets the best of " + froms.join(", ") + "; " + (g.picks.length > 2 ? "the others go to " : "the other goes to ") + others.join(" or ")) : "Goes to " + g.picks[0].tos.join(" or ") + " (more/less favorable)";
      for (const x of g.picks) pk(x.id).note = note;
      W.pickGroups.push({ id, picks: g.picks.map(x => x.id), to: [g.best], bar: {}, lastKeep: null, fallback: null, alt, note });
    }
  }
  // Who gets each pick in a group, given where every pick in it lands (slots: pick id -> slot)
  function assignGroup(g, slots) {
    const res = {};
    let pool = g.picks.slice(), rec = g.to.slice();
    for (const [from, [lo, hi]] of Object.entries(g.bar || {})) {
      const id = g.picks.find(x => x.split("-")[2] === from);
      if (id && slots[id] >= lo && slots[id] <= hi) { res[id] = from; pool = pool.filter(x => x !== id); rec = rec.filter(x => x !== from); }
    }
    pool.sort((a, b) => slots[a] - slots[b]);
    pool.forEach((id, k) => {
      let o = rec[k] || g.alt[id] || id.split("-")[2];
      if (k === pool.length - 1 && pool.length > 1 && g.lastKeep && slots[id] >= g.lastKeep[0] && slots[id] <= g.lastKeep[1] && g.fallback) o = g.fallback;
      res[id] = o;
    });
    return res;
  }

  const NBAHub = { build, YEARS, DEFAULTS, fix };
  if (typeof module !== "undefined") module.exports = NBAHub; else root.NBAHub = NBAHub;
})(typeof window !== "undefined" ? window : globalThis);
