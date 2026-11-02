/* Hard Cap rules engine. No DOM and no network: the app and the tests both load it, and every page in a league
   runs the same rules on the same shared document, so they all agree on what happened.

   What lives here: the player pool and its nine-category value (plus HC Score, value over replacement per $10M),
   spending tiers and their ceilings, the minimum-salary reserve, live and slow draft clocks with queues and
   autopicks, the prospect FAAB auction, FAAB waivers, trades, nine-category weekly matchups, Game Score,
   the schedule and the standings. */
(function (root) {
  "use strict";

  const CATS = [
    { k: "fg", label: "FG%", pct: true },
    { k: "ft", label: "FT%", pct: true },
    { k: "tpm", label: "3PM" },
    { k: "pts", label: "PTS" },
    { k: "reb", label: "REB" },
    { k: "ast", label: "AST" },
    { k: "stl", label: "STL" },
    { k: "blk", label: "BLK" },
    { k: "tov", label: "TO", low: true },
  ];
  const VORP_CAT = { k: "vorp", label: "VORP", dec: 1 };
  const catsFor = (L) => (L && L.settings && L.settings.vorpCat === false ? CATS : [...CATS, VORP_CAT]);
  // Column order of stats.json lines (weekly totals and per-game averages).
  const COLS = ["gp", "min", "fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "oreb", "ast", "stl", "blk", "tov", "pf"];
  const C = Object.fromEntries(COLS.map((k, i) => [k, i]));
  const HOUR = 3600e3;

  const DEFAULTS = {
    roster: 12, prospects: 2, faab: 100, minBid: 1,
    draftMode: "live", clock: 60, slowHours: 8, botDelay: 1500, auctionHours: 24,
    regWeeks: 21, playoffTeams: 4, startWeek: 1, tierDeadline: 21, tradeDeadline: 18, buyIn: 100,
    irSlots: 2, irRule: "out", vorpCat: true, twoWayMax: 3,
    lineScale: 1.75,                                                  // hard-cap leagues: the line, in real NBA caps
    // Soft cap: everyone gets the real second apron free and can go over, up to two real caps, by paying luxury tax
    // in real money into the pot ($ per $1M over, by bracket). Over in 2 of the last 3 seasons adds the repeater rate.
    capMode: "soft", taxBrackets: [[10, 2], [10, 3], [null, 5]], repeaterAdd: 2,
    prospectAuction: "live", auctionClock: 30, slowAuctionHours: 4,   // live nominate-and-bid auction after the draft; or "sealed" or "skip"   // two-way and 10-day players a team can carry, like the NBA
    tradeReview: "vote", reviewHours: 48, vetoShare: 0.5,   // "vote": the league can veto; "commish": the commissioner can; "none"
    lineGraceHours: 72,                                     // time to get back under the line after a real-world salary change
    vetoHours: 24, payout: [60, 25, 15],
    summerMin: 50, summerMax: 100, compDollars: 10,   // summer draft budgets: best team gets the min, worst the max                 // "out": only players ESPN lists as Out; "any": commissioner trusts everyone
  };
  // Starting lineup: nine starters, three on the bench. Only starters score. Lineups are weekly.
  const SLOTS = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"];
  const ELIG = { PG: ["PG"], SG: ["SG"], G: ["PG", "SG"], SF: ["SF"], PF: ["PF"], F: ["SF", "PF"], C: ["C"], UTIL: null };
  const positions = (p) => (p.ps && p.ps.length ? p.ps : { G: ["PG", "SG"], W: ["SF", "SG"], B: ["PF", "C"] }[p.pos] || ["SF"]);
  const eligible = (p, slot) => !ELIG[slot] || positions(p).some((x) => ELIG[slot].includes(x));
  const isOut = (inj) => !!(inj && /^out/i.test(inj[0] || ""));
  // Each line is a multiple of the real NBA line. Ten fantasy teams each need 12 of the league's best players, but
  // one real cap only pays for about half of them; 1.75 real caps lets the good players get rostered and leaves the
  // overpaid ones on the board.
  function defaultTiers(cba, scale = 1) {
    const x = (v) => (scale === 1 ? v : Math.round((v * scale) / 1e4) * 1e4);
    return [
      { k: "cap", label: "Cap team", line: x(cba.cap), add: 0 },
      { k: "tax", label: "Tax team", line: x(cba.tax), add: 25 },
      { k: "apron1", label: "First apron", line: x(cba.a1), add: 50 },
      { k: "apron2", label: "Second apron", line: x(cba.a2), add: 100 },
    ];
  }

  /* ---------- small helpers ---------- */
  function rng(seed) {                        // mulberry32: same seed, same result on every page
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const money = (n) => (n < 0 ? "-" : "") + "$" + (Math.abs(n) / 1e6).toFixed(Math.abs(n) >= 1e8 ? 1 : 2).replace(/\.?0+$/, "") + "M";
  const isProspect = (id) => typeof id === "string" && id.startsWith("c-");
  const log = (L, at, kind, team, text) => { L.log.push({ at, kind, team, text }); if (L.log.length > 600) L.log.splice(0, L.log.length - 600); };

  /* ---------- player pool ---------- */
  function blendLine(prev, cur) {
    if (!prev && !cur) return null;
    if (!prev) return cur.slice();
    if (!cur) return prev.slice();
    const w = cur[0] / (cur[0] + 12);           // lean on this season as games pile up
    return prev.map((v, i) => (i === 0 ? prev[0] + cur[0] : v * (1 - w) + cur[i] * w));
  }

  /* ---------- real NBA roster moves ----------
     Traded: he stays on your team at the same salary; only his NBA team changes.
     Waived, bought out, released or retired (on no NBA roster): his contract comes off your books automatically and
     he can't be signed until a real team signs him again.
     New deals (a waived player catching on, a two-way converted, a new signing) enter free agency at the real salary
     once the cap sheet has them; the commissioner can add one by hand in the meantime. */
  // Names differ between sources ("Ron Holland" and "Ronald Holland II"), so match on the name without suffixes,
  // then on first initial plus last name.
  const SUFFIX = /^(jr|sr|ii|iii|iv|v)$/;
  const nameKeys = (slug) => {
    const parts = slug.split("-").filter((x) => !SUFFIX.test(x));
    return [parts.join("-"), parts.length > 1 ? parts[0][0] + "-" + parts[parts.length - 1] : parts.join("-")];
  };
  function rosterIndex(stats) {
    const r = stats && stats.rosters;
    if (!r || (stats.rosterTeams || 0) < 30) return null;          // only trust a complete pull
    const full = {}, short = {};
    for (const [id, v] of Object.entries(r)) { const [f, s2] = nameKeys(id); full[f] = v[0]; short[s2] = short[s2] ? "?" : v[0]; }
    return { r, full, short };
  }
  // His current NBA team, or null when he's on no roster. undefined when there's no complete roster pull.
  function nbaTeam(p, idx) {
    if (!idx) return undefined;
    if (idx.r[p.id]) return idx.r[p.id][0];
    const [f, s2] = nameKeys(p.id);
    if (idx.full[f]) return idx.full[f];
    if (idx.short[s2]) return idx.short[s2] === "?" ? p.t : idx.short[s2];
    return null;
  }
  const onNbaRoster = (p, idx) => nbaTeam(p, idx) !== null;
  // League-level contract fixes from the commissioner: new signings, corrected salaries.
  function mergeContracts(nba, extra) {
    if (!extra || !Object.keys(extra).length) return nba;
    const players = nba.players.filter((p) => !extra[p.id]);
    for (const [id, c] of Object.entries(extra)) {
      const base = nba.players.find((p) => p.id === id) || {};
      players.push(Object.assign({}, base, { id, n: c.n || base.n, t: c.t || base.t, pos: c.pos || base.pos || "W", ps: c.ps || base.ps || [],
        age: c.age || base.age || 25, yos: base.yos || 1, two: false, c: Object.assign({}, base.c || {}, { sal: c.sal, opt: c.opt || {}, signed: (base.c && base.c.signed) || 0 }) }));
    }
    return Object.assign({}, nba, { players });
  }

  const ESPN_POS = { PG: ["PG"], SG: ["SG"], G: ["PG", "SG"], SF: ["SF"], PF: ["PF"], F: ["SF", "PF"], C: ["C"] };
  const posLetter = (ps) => (ps.includes("C") ? "B" : ps.some((x) => x.includes("G")) ? "G" : "W");

  /* The latest contracts, layered over the cap sheet in celtics/data.json:
     1. stats.contracts: every standard NBA contract from Basketball-Reference, refreshed with the box scores. When it's
        there it's the truth for salaries and option years (it already includes real trade kickers and extensions), a
        player on the cap sheet who isn't on it is no longer on a standard deal, and a signing the cap sheet hasn't
        caught up with is added.
     2. fixes (hardcap/contracts.json): hand-checked additions and changes, players on two-way or 10-day deals, and
        players no longer under contract. They fill in until Basketball-Reference has the player (or always, with
        force: true), so a two-way who converts or a waived player who re-signs comes back on his own.
     A player with no standard contract never enters the pool; he shows up on waivers once he signs one. */
  function latestContracts(nba, stats, fixes) {
    const bb = stats && stats.contracts;
    const rosters = (stats && stats.rosters) || {};
    let players = nba.players.slice();
    const report = { updated: 0, added: 0, off: 0 };
    const onBB = new Set();
    if (bb && Object.keys(bb).length >= 350) {
      const short = {};
      for (const id of Object.keys(bb)) { const k = nameKeys(id)[1]; short[k] = short[k] ? "?" : id; }
      const full = {};
      for (const id of Object.keys(bb)) full[nameKeys(id)[0]] = id;
      const find0 = (id) => (bb[id] ? id : full[nameKeys(id)[0]] || (short[nameKeys(id)[1]] !== "?" && short[nameKeys(id)[1]]) || null);
      // The row for the team he's on now. Basketball-Reference also lists dead money owed by teams that waived a
      // player; when the ESPN rosters put him somewhere else, that row isn't a contract he holds.
      const rowFor = (k, id) => {
        const rows = [bb[k].slice(0, 3), ...bb[k].slice(3)];
        const r = rosters[id] || rosters[k];
        if (!r) return rows[0];
        const hit = rows.find((x) => x[0] === r[0]);
        if (hit) return hit;
        // One row under another team: either a real trade one feed hasn't caught yet, or dead money while he plays
        // on a two-way somewhere. Keep the contract (never release someone over feed lag) unless the fixes file
        // says he's off a standard deal.
        mismatch.add(id);
        return rows.length === 1 ? rows[0] : rows[rows.length - 1];
      };
      const mismatch = new Set();
      const pick = {};
      const find = (id) => { const k = find0(id); if (!k) return null; const row = rowFor(k, id); if (!row) return null; pick[id] = row; return k; };
      const seen = new Set();
      const unmatched = [];
      players = players.map((p) => {
        if (p.two) return p;
        const k = find(p.id);
        if (!k) { if (p.c && p.c.sal && p.c.sal[0]) unmatched.push(p.id); return p; }
        seen.add(k); onBB.add(p.id);
        // Two rows means one is dead money, and the page repeats the same figures on both, so the cap sheet's
        // numbers stand. A lone row under another team is dead money too, or a trade one feed hasn't caught yet:
        // he can't be signed until it clears, but nobody loses him over it.
        if (bb[k].length > 3) return p;
        if (mismatch.has(p.id)) return Object.assign({}, p, { limbo: true });
        const [t, sal, opt0] = pick[p.id];
        const opt = Object.fromEntries(Object.entries(opt0).filter(([i]) => +i > 0));   // this season's option is already decided
        const s5 = sal.slice(0, 6);                     // every season Basketball-Reference lists, up to six
        const old = (p.c && p.c.sal) || [];
        if (s5.join() === old.join() && JSON.stringify(opt) === JSON.stringify((p.c && p.c.opt) || {})) return p;
        report.updated++;
        const o = Object.fromEntries(Object.entries(opt).filter(([i]) => +i < 6));
        // Basketball-Reference doesn't mark non-guaranteed years; keep the cap sheet's where the year still exists.
        for (const [i, v] of Object.entries((p.c && p.c.opt) || {})) if (v === "NG" && s5[+i] && !o[i]) o[i] = v;
        return Object.assign({}, p, { t: t && t.length === 3 ? p.t : p.t, c: Object.assign({}, p.c || {}, { sal: s5, opt: o }) });
      });
      report.mismatch = [...mismatch];
      // Only trust "not on the list" when matching worked for nearly everyone; a parsing hiccup shouldn't empty rosters.
      if (unmatched.length <= 40) {
        const off = new Set(unmatched);
        players = players.map((p) => (off.has(p.id) ? Object.assign({}, p, { noDeal: true }) : p));
        report.off = off.size;
      }
      const have = new Set(players.map((p) => p.id));
      for (const [id, row0] of Object.entries(bb)) {
        if (seen.has(id) || have.has(id)) continue;
        const r = rosters[id] || rosters[full[nameKeys(id)[0]]];
        if (!r) continue;                                  // on no NBA roster: dead money, not a player to sign
        const row = rowFor(id, id) || (rosters[id] ? null : row0);
        if (!row) continue;
        const [t, sal, opt] = row;
        const ps = (r && ESPN_POS[r[2]]) || ["SF"];
        players.push({ id, n: (r && r[1]) || id.replace(/-/g, " ").replace(/\b\w/g, (x) => x.toUpperCase()), t: (r && r[0]) || t, pos: posLetter(ps), ps,
          age: 25, yos: 1, c: { sal: sal.slice(0, 6), opt: Object.fromEntries(Object.entries(opt).filter(([i]) => +i > 0 && +i < 6)), signed: 0 }, fresh: true });
        onBB.add(id); report.added++;
      }
    }
    if (fixes) {
      const applies = ([id, f]) => f.force || !onBB.has(id) || (report.mismatch || []).includes(id);
      const drop = new Set([...Object.entries(fixes.nonCap || {}), ...Object.entries(fixes.gone || {})].filter(applies).map(([id]) => id));
      players = players.map((p) => (drop.has(p.id) ? Object.assign({}, p, { noDeal: true }) : p));
      players = mergeContracts({ players }, Object.fromEntries(Object.entries(fixes.add || {}).filter(applies))).players;
    }
    // Two-way and 10-day players are in the pool too, at their real salaries: a two-way earns half the rookie
    // minimum, a 10-day deal ten days of his minimum. Anyone on an NBA roster without a standard deal is one of
    // the two (rosters carry 15 standard spots and 3 two-ways), so this stays current on its own.
    if (stats && stats.rosters && (stats.rosterTeams || 0) >= 30) {
      const minS = (nba.cba && nba.cba.min_scale) || [1357762];
      const twoWay = Math.round(minS[0] / 2);
      const tenDay = (yos) => Math.round((minS[Math.min(yos || 0, minS.length - 1)] * 10) / 174);
      const byId = new Map(players.map((p) => [p.id, p]));
      const byFull = new Map(players.map((p) => [nameKeys(p.id)[0], p]));
      const kindOf = (id) => (fixes && fixes.nonCap && fixes.nonCap[id] && fixes.nonCap[id].kind === "10-day" ? "10-day" : "two-way");
      for (const [id, r] of Object.entries(stats.rosters)) {
        const p = byId.get(id) || byFull.get(nameKeys(id)[0]);
        if (p && !p.two && !p.noDeal && p.c && p.c.sal && p.c.sal[0]) continue;   // standard deal
        if (p && p.limbo && !p.noDeal) continue;
        const kind = kindOf(p ? p.id : id);
        const ps = p && p.ps && p.ps.length ? p.ps : ESPN_POS[r[2]] || ["SF"];
        const sal = kind === "10-day" ? tenDay(p && p.yos) : twoWay;
        const q = Object.assign({}, p || { id, n: r[1], pos: posLetter(ps), ps, age: 25, yos: 0 }, {
          t: r[0], two: false, noDeal: false, limbo: false, deal: kind, c: Object.assign({}, (p && p.c) || {}, { sal: [sal, 0, 0, 0, 0], opt: {}, signed: 0 }) });
        if (p) players[players.indexOf(p)] = q; else players.push(q);
        report.twoWay = (report.twoWay || 0) + 1;
      }
    }
    return Object.assign({}, nba, { players, contractReport: report, liveBoard: (stats && stats.prospects) || nba.liveBoard });
  }

  function buildPool(nba, stats) {
    const idx = rosterIndex(stats);
    const avg = (stats && stats.avg) || {};
    const yrs = Object.keys(avg).sort();
    const cur = yrs.length ? avg[yrs[yrs.length - 1]] : {};
    const prev = yrs.length > 1 ? avg[yrs[yrs.length - 2]] : {};
    const players = [];
    for (const p of nba.players) {
      const sal = (p.c && p.c.sal) || [];
      // Two-way and 10-day deals aren't eligible until they're standard contracts. A player who just lost his standard
      // deal stays in the list only so a team holding him can be cleared; he's never available.
      if (!sal[0] || p.two) continue;
      players.push({
        id: p.id, n: p.n, t: p.t, pos: p.pos, ps: p.ps || [], age: p.age, yos: p.yos,
        sal: sal[0], future: sal.slice(1).filter((x) => x > 0), opt: (p.c && p.c.opt) || {},
        tier: p.tier || "", note: p.note || "", rating: (p.o || 0) + (p.d || 0), pot: p.pot != null ? p.pot : (p.o || 0) + (p.d || 0),
        fa: freeAgency(p, sal),
        line: blendLine(prev[p.id], cur[p.id]), cur: cur[p.id] || null, prev: prev[p.id] || null,
      });
      const q = players[players.length - 1];
      const now = nbaTeam(q, idx);
      if (now && now !== p.t) { q.was = p.t; q.t = now; }        // traded for real: same contract, new team
      // A player with box scores in the last two weeks is on a roster, whatever the roster pull says.
      const recent = stats && stats.wk ? Object.keys(stats.wk).map(Number).sort((x, y) => y - x).slice(0, 2).some((w) => stats.wk[w][p.id]) : false;
      q.gone = (now === null && !recent) || !!p.noDeal || !!p.limbo;
      if (p.noDeal) q.noDeal = true;
      if (p.limbo) q.limbo = true;
      const v = stats && stats.vorp && (stats.vorp[p.id] || stats.vorp[nameKeys(p.id)[0]]);
      q.bbv = v ? v[0] : null; q.bpm = v ? v[1] : null;
      q.vpm = q.bbv != null ? (q.bbv / (q.sal / 1e6)) * 10 : null;   // V/M: season VORP per $1M of salary, x10
      q.ctype = p.deal === "10-day" ? "10-day" : p.deal ? "Two-way" : contractType(p, sal[0], nba.cba);
      if (p.deal) q.deal = p.deal;
    }
    rankNineCat(players);
    return players;
  }

  // When his deal runs out and whether his team can match (restricted: a first-round rookie-scale deal ending
  // within his first four seasons). Same rule Banner 19 uses.
  function freeAgency(p, sal) {
    const n = sal.filter((x) => x > 0).length;
    const c = p.c || {};
    const rookie = (c.rk && c.rk[1] > 0 && c.rk[1] <= 30) || c.rfa;
    return { year: 2026 + n, kind: rookie && (p.yos || 0) + n - 1 <= 4 ? "RFA" : "UFA" };
  }

  // What kind of deal it is, in plain words.
  function contractType(p, sal, cba) {
    const c = p.c || {};
    if (c.rk && c.rk[1] > 0) return c.rk[1] <= 30 ? "Rookie scale" : "Second-round";
    if (cba && sal >= cba.cap * 0.245) return "Max";
    if (cba && cba.min_scale && sal <= Math.max(...cba.min_scale) * 1.02) return "Minimum";
    return "Veteran";
  }

  // Nine-category value: z-scores per game across the regular rotation, percentages weighted by volume.
  function rankNineCat(players) {
    const live = players.filter((p) => p.line && p.line[C.min] >= 16 && p.line[C.gp] >= 8);
    const base = live.length >= 60 ? live : players.filter((p) => p.line);
    const per = (p) => {
      const l = p.line;
      return { fgm: l[C.fgm], fga: l[C.fga], ftm: l[C.ftm], fta: l[C.fta], tpm: l[C.tpm], pts: l[C.pts], reb: l[C.reb],
        ast: l[C.ast], stl: l[C.stl], blk: l[C.blk], tov: l[C.tov] };
    };
    const rows = base.map(per);
    const fgLg = sum(rows.map((r) => r.fgm)) / Math.max(1, sum(rows.map((r) => r.fga)));
    const ftLg = sum(rows.map((r) => r.ftm)) / Math.max(1, sum(rows.map((r) => r.fta)));
    const impact = (r) => ({ ...r, fg: r.fgm - fgLg * r.fga, ft: r.ftm - ftLg * r.fta });
    const imp = rows.map(impact);
    const stat = {};
    for (const c of CATS) {
      const xs = imp.map((r) => r[c.k]);
      const m = sum(xs) / Math.max(1, xs.length);
      const sd = Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / Math.max(1, xs.length)) || 1;
      stat[c.k] = [m, sd];
    }
    for (const p of players) {
      if (!p.line) { p.z = -3 + p.rating * 0.3; p.zc = null; continue; }
      const r = impact(per(p));
      const zc = {};
      for (const c of CATS) { const [m, sd] = stat[c.k]; zc[c.k] = ((r[c.k] - m) / sd) * (c.low ? -1 : 1); }
      p.zc = zc;
      p.z = sum(Object.values(zc)) * (0.55 + 0.45 * Math.min(1, p.line[C.min] / 24));
    }
    // Small samples get pulled toward a below-replacement player: 11 good games last season shouldn't rank a
    // two-way ahead of a full-time starter. Each player keeps gp / (gp + 20) of his own line, so 6 games keeps
    // under a quarter, 41 keeps two-thirds and a full season keeps 80%.
    const raw = players.slice().sort((a, b) => b.z - a.z);
    const floor = raw[Math.min(raw.length - 1, 119)].z - 1;
    for (const p of players) if (p.line) { const g = p.line[C.gp] || 0, w = g / (g + 20); p.z = w * p.z + (1 - w) * floor; }
    const sorted = players.slice().sort((a, b) => b.z - a.z);
    sorted.forEach((p, i) => (p.rank = i + 1));
    // HC Score: value over a replacement player (the 120th best) per $10M of salary.
    const repl = sorted[Math.min(sorted.length - 1, 119)].z;
    for (const p of players) { p.zvor = p.z - repl; p.hc = p.zvor / (p.sal / 1e7); }
    // Dynasty value: this season's production, leaned toward upside and youth.
    const pots = players.map((p) => p.pot);
    const pm = sum(pots) / pots.length, psd = Math.sqrt(sum(pots.map((x) => (x - pm) ** 2)) / pots.length) || 1;
    const zs = players.map((p) => p.z), zm = sum(zs) / zs.length, zsd = Math.sqrt(sum(zs.map((x) => (x - zm) ** 2)) / zs.length) || 1;
    for (const p of players) p.dyn = 0.6 * p.z + 0.4 * (zm + ((p.pot - pm) / psd) * zsd) + Math.max(-2, Math.min(1.5, (26 - p.age) * 0.25));
    players.slice().sort((a, b) => b.dyn - a.dyn).forEach((p, i) => (p.dynRank = i + 1));
  }

  // The preseason board from the cap sheet, moved along by Tankathon's live big board when it's there (prospects.json):
  // current rank, this season's line, and spots moved since the preseason board. Prospects who join the live board
  // later are added, so they can be bid on.
  function buildProspects(nba, live) {
    live = live || nba.liveBoard;
    const out = ((nba.draft && nba.draft["2027"]) || []).map((p) => ({ id: "c-" + p.id, n: p.n, pos: p.pos, school: p.school, age: p.age, rank: p.rank, pre: p.rank, cls: 2027 }));
    const board = live && live.board;
    if (!board || board.length < 30) return out;
    const key = (id) => nameKeys(id.replace(/^c-/, ""))[0];
    const by = new Map(out.map((p) => [key(p.id), p]));
    const days = Object.keys(live.hist || {}).sort();
    const first = days.length ? live.hist[days[0]] : {};
    const seen = new Set();
    for (const r of board) {
      if (!(r.rank > 0 && r.rank <= 300)) continue;             // later draft classes sit below the board
      let p = by.get(key(r.id));
      if (!p) {
        p = { id: "c-" + r.id, n: r.n, pos: String(r.pos || "SF").split("/")[0], school: r.school, age: null, pre: first[r.id] || null, cls: 2027, late: true };
        out.push(p); by.set(key(r.id), p);
      }
      seen.add(p);
      p.rank = r.rank; p.stats = r.stats || {}; p.posFull = r.pos || p.pos; if (r.school) p.school = r.school;
      p.move = p.pre != null ? p.pre - r.rank : null;
    }
    for (const p of out) if (!seen.has(p)) { p.rank = 900 + p.pre; p.off = true; p.move = null; }
    return out.sort((a, b) => a.rank - b.rank);
  }

  /* ---------- the league document ---------- */
  const TEAM_NAMES = [
    ["Wellesley Wingspan", "WEL"], ["Fenway Faders", "FEN"], ["Southie Splash", "STH"], ["Back Bay Bigs", "BAY"],
    ["Brookline Bucketeers", "BKL"], ["Quincy Quicksilver", "QCY"], ["Somerville Swing", "SOM"], ["Dorchester Dimes", "DOT"],
    ["Medford Mavens", "MED"], ["Newton Nets", "NWT"], ["Worcester Wolves", "WOR"], ["Revere Rebounders", "REV"],
    ["Waltham Wizards", "WAL"], ["Natick Knights", "NAT"], ["Lowell Lumberjacks", "LOW"], ["Salem Spellcasters", "SAL"],
    ["Dedham Dunkers", "DED"], ["Wellfleet Whalers", "WFT"], ["Malden Marksmen", "MAL"], ["Framingham Flyers", "FRA"],
  ];
  const BOT_STYLES = ["value", "stars", "balanced", "youth", "value", "balanced", "stars", "youth", "balanced", "value", "stars", "balanced", "youth", "value", "stars", "balanced", "youth", "value", "stars", "balanced"];

  function newLeague(opts) {
    const s = Object.assign({}, DEFAULTS, opts.settings || {});
    if (s.capMode === "soft") {
      s.freeLine = s.freeLine || opts.cba.a2;
      s.hardLine = s.hardLine || 2 * opts.cba.cap;
      s.tiers = [{ k: "soft", label: "Soft cap", line: s.hardLine, add: 0 }];
    } else s.tiers = s.tiers || defaultTiers(opts.cba, s.lineScale || 1);
    const seed = opts.seed || Math.floor(Math.random() * 2 ** 31);
    const n = Math.max(4, Math.min(opts.maxTeams || 16, Math.round((opts.teams || 10) / 2) * 2));   // even, 4 to 16
    s.playoffTeams = Math.min(s.playoffTeams, n);
    const teams = TEAM_NAMES.slice(0, n).map(([name, abbr], i) => ({
      id: i, name, abbr, owner: null, style: BOT_STYLES[i % BOT_STYLES.length],
      faab: s.faab, tier: 0, tierLog: [], hist: [], prospects: [], queue: [], ir: [], lineups: {},
    }));
    const r = rng(seed + 11);
    const order = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return {
      v: 2, seed, name: opts.name || "Hard Cap League", created: opts.now || Date.now(), opener: opts.opener || "2026-10-20", settings: s, teams,
      phase: "lobby", nba: { round1: order, order: snakeFrom(order, s.roster), picks: [], clockStart: null, paused: false, left: null },
      auction: { results: [] }, schedule: roundRobin(n, s.regWeeks, rng(seed + 7)),
      trades: [], log: [], due: {}, lastWaiverRun: null, waived: {},
    };
  }

  function snakeFrom(first, rounds) {
    const out = [];
    for (let r = 0; r < rounds; r++) out.push(...(r % 2 ? first.slice().reverse() : first));
    return out;
  }
  const snake = (n, rounds) => snakeFrom([...Array(n).keys()], rounds);

  function setOrder(L, first) {
    L.nba.round1 = first.slice();
    L.nba.order = snakeFrom(first, L.settings.roster);
  }

  function roundRobin(n, weeks, r) {
    const arr = [...Array(n).keys()];
    const rounds = [];
    for (let k = 0; k < n - 1; k++) {
      const pairs = [];
      for (let i = 0; i < n / 2; i++) pairs.push([arr[i], arr[n - 1 - i]]);
      rounds.push(pairs);
      arr.splice(1, 0, arr.pop());
    }
    for (let i = rounds.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [rounds[i], rounds[j]] = [rounds[j], rounds[i]]; }
    const out = [];
    for (let w = 0; w < weeks; w++) out.push(rounds[w % rounds.length].map((p) => p.slice()));
    return out;
  }

  /* ---------- tiers ---------- */
  const totalWeeks = (L) => L.settings.regWeeks + 2;
  const tierOf = (L, team) => L.settings.tiers[team.tier || 0];
  const ceilingOf = (L, team) => tierOf(L, team).line;
  const isSoft = (L) => L.settings.capMode === "soft";
  const freeLine = (L, team) => (isSoft(L) ? L.settings.freeLine : ceilingOf(L, team));
  // Luxury tax on a payroll, in whole dollars.
  function taxFor(L, pay, repeater) {
    if (!isSoft(L)) return 0;
    let over = (pay - L.settings.freeLine) / 1e6, tax = 0;
    for (const [width, rate] of L.settings.taxBrackets) {
      if (over <= 0) break;
      const part = width == null ? over : Math.min(over, width);
      tax += part * (rate + (repeater ? L.settings.repeaterAdd : 0));
      over -= part;
    }
    return tax > 0 ? Math.ceil(tax - 1e-9) : 0;
  }
  // Over in 2 of the last 3 assessed seasons.
  const isRepeater = (L, team) => ((L.taxHist && L.taxHist[team.id]) || []).slice(-3).filter(Boolean).length >= 2;
  const taxPaid = (L, team) => (L.tax && L.tax.assessed && L.tax.assessed[team.id] ? L.tax.assessed[team.id].tax : 0);
  const owed = (L, team) => L.settings.buyIn + tierOf(L, team).add + taxPaid(L, team);
  const pot = (L) => sum(L.teams.map((t) => owed(L, t)));
  // How far a team will spend on its own: bots in a soft-cap league go a little over by temperament; an autopick
  // never puts a manager into the tax, since that's real money.
  const BOT_TAX = { stars: 25e6, balanced: 12e6, youth: 6e6, value: 0 };
  const spendLimit = (L, team) => (!isSoft(L) ? ceilingOf(L, team) : Math.min(ceilingOf(L, team), L.settings.freeLine + (team.owner ? 0 : BOT_TAX[team.style] || 0)));

  // Upgrades are one way: once a team agrees to pay for a tier, it stays there for the season.
  function upgradeTier(L, teamId, to, now, week) {
    const team = L.teams[teamId];
    if (!(to > (team.tier || 0)) || to >= L.settings.tiers.length) return { ok: false, why: "Tiers only go up" };
    if (L.phase === "league" && week > L.settings.tierDeadline) return { ok: false, why: `Upgrades closed after week ${L.settings.tierDeadline}` };
    const from = tierOf(L, team), tier = L.settings.tiers[to];
    team.tier = to;
    team.tierLog.push({ tier: to, at: now, week: L.phase === "league" ? week : 0 });
    log(L, now, "tier", teamId, `${team.name} moved up to ${tier.label} (${money(tier.line)} ceiling), adding $${tier.add - from.add} to the pot`);
    return { ok: true };
  }

  /* ---------- rosters and payroll ---------- */
  // A roster spot is {pid, from, to}: the weeks it counts for. to = null while he's still on the team.
  // Players on IR stay on the team but don't count against the roster limit or the line.
  const rostered = (team) => team.hist.filter((h) => h.to == null).map((h) => h.pid);
  const active = (team) => { const ir = team.ir || []; return rostered(team).filter((id) => !ir.includes(id)); };
  const payroll = (team, byId) => sum(active(team).map((id) => (byId[id] ? byId[id].sal : 0)));

  function owners(L) {
    const o = {};
    for (const t of L.teams) { for (const id of rostered(t)) o[id] = t.id; for (const id of t.prospects) o[id] = t.id; }
    return o;
  }

  // A healthy player sitting on IR makes the roster illegal: no adds or trades until he's activated or released.
  function irProblem(L, team, inj) {
    if (L.settings.irRule === "any") return null;
    const bad = (team.ir || []).find((id) => !isOut(inj && inj[id]));
    return bad || null;
  }

  function moveToIR(L, pool, teamId, pid, inj, now, week) {
    const team = L.teams[teamId];
    team.ir = team.ir || [];
    if (!rostered(team).includes(pid) || team.ir.includes(pid)) return { ok: false, why: "He isn't on your active roster" };
    if (team.ir.length >= L.settings.irSlots) return { ok: false, why: `Both IR spots are full` };
    if (L.settings.irRule !== "any" && !isOut(inj && inj[pid])) return { ok: false, why: "Only players listed as Out on the injury report can go on IR" };
    team.ir.push(pid);
    clearFromLineups(L, team, pid, now);
    const p = pool.find((x) => x.id === pid);
    log(L, now, "ir", teamId, `${team.name} moved ${p ? p.n : pid} to IR (${p ? money(p.sal) : ""} off the books)`);
    return { ok: true };
  }

  function activateIR(L, pool, teamId, pid, drop, now, week) {
    const team = L.teams[teamId];
    if (!(team.ir || []).includes(pid)) return { ok: false, why: "He isn't on IR" };
    const byId = Object.fromEntries(pool.map((p) => [p.id, p]));
    const act = active(team).filter((x) => x !== drop);
    if (act.length >= L.settings.roster) return { ok: false, why: "Your roster is full: release someone to bring him back" };
    const pay = sum(act.map((x) => byId[x].sal)) + byId[pid].sal;
    if (pay > ceilingOf(L, team)) return { ok: false, why: `Bringing him back puts you ${money(pay - ceilingOf(L, team))} over your line` };
    if (drop) { const r = dropPlayer(L, pool, teamId, drop, week, now); if (!r.ok) return r; }
    team.ir = team.ir.filter((x) => x !== pid);
    log(L, now, "ir", teamId, `${team.name} activated ${byId[pid].n} from IR`);
    return { ok: true };
  }

  // Anyone rostered who is on no NBA roster comes off the books. Runs on every server tick.
  function releaseGone(L, pool, week, now) {
    let n = 0;
    for (const t of L.teams) {
      for (const pid of rostered(t)) {
        const p = pool.find((x) => x.id === pid);
        if (!p || !p.gone || (p.limbo && !p.noDeal)) continue;
        dropPlayer(L, pool, t.id, pid, week, now);
        delete L.waived[pid];
        L.log[L.log.length - 1].text = p.noDeal
          ? `${p.n} is no longer on a standard NBA contract, so ${money(p.sal)} came off ${t.name}'s books`
          : `${p.n} is off every NBA roster (waived or released), so ${money(p.sal)} came off ${t.name}'s books`;
        L.log[L.log.length - 1].kind = "nba";
        n++;
      }
    }
    return n;
  }

  /* ---------- lineups ---------- */
  // Fill the nine slots with the best players who can play them: most specific slots first, then bump a starter
  // to a more flexible slot when that opens room for a better player.
  function autoLineup(players) {
    const order = players.slice().sort((a, b) => b.z - a.z);
    const slots = Array(SLOTS.length).fill(null);
    const pref = [0, 1, 3, 4, 6, 2, 5, 7, 8];          // PG SG SF PF C, then G F, then UTIL
    for (const p of order) {
      let placed = false;
      for (const i of pref) if (!slots[i] && eligible(p, SLOTS[i])) { slots[i] = p; placed = true; break; }
      if (placed) continue;
      for (const i of pref) {
        if (!eligible(p, SLOTS[i]) || !slots[i]) continue;
        const q = slots[i];
        const j = pref.find((k) => !slots[k] && eligible(q, SLOTS[k]));
        if (j != null) { slots[j] = q; slots[i] = p; placed = true; break; }
      }
    }
    return slots.map((p) => (p ? p.id : null));
  }

  // UTC time a week's lineup locks: 7 p.m. Eastern on its first day (UTC-4 from the second Sunday of March to the
  // first Sunday of November, UTC-5 otherwise).
  function lockTime(opener, w) {
    const d = weekStart(opener, w);
    const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
    const sunday = (mon, nth) => { const f = new Date(Date.UTC(y, mon, 1)).getUTCDay(); return 1 + ((7 - f) % 7) + 7 * (nth - 1); };
    const dst = (m > 2 && m < 10) || (m === 2 && day >= sunday(2, 2)) || (m === 10 && day < sunday(10, 1));
    return Date.UTC(y, m, day, dst ? 23 : 24, 0, 0);
  }

  function lineupFor(L, team, w, byId) {
    const ros = rosterInWeek(team, w);
    const saved = team.lineups && team.lineups[w];
    if (saved) return saved.map((id) => (id && ros.includes(id) ? id : null));
    const ir = team.ir || [];
    return autoLineup(ros.filter((id) => !ir.includes(id)).map((id) => byId[id]).filter(Boolean));
  }

  function setLineup(L, pool, teamId, w, slots, now, opener) {
    if (now >= lockTime(opener, w)) return { ok: false, why: `Week ${w} lineups locked at its first tip` };
    const team = L.teams[teamId];
    const byId = Object.fromEntries(pool.map((p) => [p.id, p]));
    const ros = rosterInWeek(team, w), ir = team.ir || [];
    const seen = new Set();
    for (let i = 0; i < SLOTS.length; i++) {
      const id = slots[i];
      if (!id) continue;
      if (seen.has(id)) return { ok: false, why: `${byId[id].n} is in two slots` };
      seen.add(id);
      if (!ros.includes(id)) return { ok: false, why: `${byId[id] ? byId[id].n : id} isn't on your roster that week` };
      if (ir.includes(id)) return { ok: false, why: `${byId[id].n} is on IR` };
      if (!eligible(byId[id], SLOTS[i])) return { ok: false, why: `${byId[id].n} can't play ${SLOTS[i]}` };
    }
    team.lineups = team.lineups || {};
    team.lineups[w] = slots.slice(0, SLOTS.length).map((x) => x || null);
    return { ok: true };
  }

  function clearFromLineups(L, team, pid, now) {
    for (const [w, sl] of Object.entries(team.lineups || {})) if (sl.includes(pid) && now < lockTime(L.opener || "2026-10-20", +w)) team.lineups[w] = sl.map((x) => (x === pid ? null : x));
  }

  // Locks in every team's lineup for weeks that have started, so a later move never rewrites a finished week.
  function lockLineups(L, pool, now, opener) {
    const byId = Object.fromEntries(pool.map((p) => [p.id, p]));
    let changed = 0;
    for (let w = L.settings.startWeek; w <= totalWeeks(L) && lockTime(opener, w) <= now; w++) {
      for (const t of L.teams) {
        t.lineups = t.lineups || {};
        if (!t.lineups[w]) { t.lineups[w] = lineupFor(L, t, w, byId); changed++; }
      }
    }
    return changed;
  }
  function context(L, pool) {
    const byId = Object.fromEntries(pool.map((p) => [p.id, p]));
    const own = owners(L);
    return { byId, own, available: pool.filter((p) => own[p.id] == null) };
  }

  // What a team must hold back to fill its open spots. Pessimistic on purpose: it assumes every other team's open
  // spots go to the very cheapest players first, so a legal pick can never strand a roster later in the draft.
  // twLeft: how many more two-ways this team may sign, so the reserve can't count on a bench full of them.
  function reserve(k, available, skip, othersOpen = 0, twLeft = Infinity) {
    if (k <= 0) return 0;
    const rows = [];
    for (const p of available) if (p.id !== skip && !p.gone) rows.push([p.sal, !!p.deal]);
    rows.sort((a, b) => a[0] - b[0]);
    let total = 0, n = 0, tw = 0;
    for (let i = othersOpen; i < rows.length && n < k; i++) {
      if (rows[i][1]) { if (tw >= twLeft) continue; tw++; }
      total += rows[i][0]; n++;
    }
    if (n < k && rows.length) total += (k - n) * rows[rows.length - 1][0];
    return total;
  }
  const isTwoWay = (p) => !!(p && p.deal);
  const twoWaysOn = (team, byId, except = []) => active(team).filter((id) => !except.includes(id) && isTwoWay(byId[id])).length;
  const openSpots = (L, except) => sum(L.teams.filter((t) => t.id !== except).map((t) => Math.max(0, L.settings.roster - active(t).length)));

  // Can this team add this player (optionally releasing someone) and stay under its ceiling?
  // During the draft it must also be able to fill every open spot at the cheapest salaries left.
  function check(L, team, player, ctx, opts = {}) {
    const ceiling = opts.limit != null ? Math.min(opts.limit, ceilingOf(L, team)) : ceilingOf(L, team);
    const ros = active(team);
    const drops = (opts.drops || (opts.drop ? [opts.drop] : [])).filter((d) => ros.includes(d));
    const dropSal = sum(drops.map((d) => ctx.byId[d].sal));
    const count = ros.length - drops.length;
    if (count >= L.settings.roster) return { ok: false, why: "Roster is full" };
    if (player.gone) return { ok: false, why: `${player.n} isn't on an NBA roster` };
    const twMax = L.settings.twoWayMax == null ? 3 : L.settings.twoWayMax;
    const twHave = twoWaysOn(team, ctx.byId, drops) + (isTwoWay(player) ? 1 : 0);
    if (isTwoWay(player) && twHave > twMax) return { ok: false, why: `Already carrying ${twMax} two-way players, the limit` };
    const pay = payroll(team, ctx.byId) - dropSal;
    const open = L.settings.roster - count - 1;
    const hold = opts.reserve ? reserve(open, ctx.available, player.id, L.phase === "nba" ? openSpots(L, team.id) : 0, twMax - twHave) : 0;
    const after = pay + player.sal;
    if (after + hold > ceiling) {
      return { ok: false, after, hold, room: ceiling - pay - hold,
        why: hold ? `Over the line: ${money(after)} plus ${money(hold)} held for ${open} open spot${open === 1 ? "" : "s"}`
          : `Over the ${money(ceiling)} line by ${money(after - ceiling)}` };
    }
    return { ok: true, after, hold, room: ceiling - after - hold };
  }

  /* ---------- the NBA draft ---------- */
  const clockLen = (L) => (L.settings.draftMode === "slow" ? L.settings.slowHours * HOUR : L.settings.clock * 1000);

  function onClock(L, now) {
    if (L.phase !== "nba") return null;
    const n = L.nba.picks.length;
    if (n >= L.nba.order.length) return null;
    const teams = L.teams.length;
    const left = L.nba.paused ? L.nba.left : L.nba.clockStart + clockLen(L) - (now || 0);
    return { pick: n + 1, round: Math.floor(n / teams) + 1, inRound: (n % teams) + 1, team: L.nba.order[n],
      total: L.nba.order.length, deadline: L.nba.clockStart + clockLen(L), left };
  }

  function nextPickOf(L, teamId) {
    for (let k = L.nba.picks.length; k < L.nba.order.length; k++) if (L.nba.order[k] === teamId) return k + 1;
    return null;
  }

  function startDraft(L, now) {
    if (L.phase !== "lobby") return { ok: false, why: "The draft already started" };
    L.phase = "nba";
    L.nba.clockStart = now; L.nba.paused = false; L.nba.started = now;
    log(L, now, "draft", -1, `The draft is open (${L.settings.draftMode === "slow" ? `slow, ${L.settings.slowHours} hours a pick` : `live, ${L.settings.clock} seconds a pick`})`);
    return { ok: true };
  }

  function pauseDraft(L, now, pause) {
    if (L.phase !== "nba") return { ok: false, why: "The draft isn't running" };
    if (pause && !L.nba.paused) { L.nba.left = Math.max(0, L.nba.clockStart + clockLen(L) - now); L.nba.paused = true; }
    else if (!pause && L.nba.paused) { L.nba.clockStart = now - (clockLen(L) - L.nba.left); L.nba.paused = false; L.nba.left = null; }
    return { ok: true };
  }

  function draftPick(L, pool, teamId, pid, now, auto) {
    const clock = onClock(L, now);
    if (!clock) return { ok: false, why: "The draft isn't open" };
    if (clock.team !== teamId) return { ok: false, why: "It's not your pick" };
    const team = L.teams[teamId];
    if (pid === null) {                              // nobody fits under the line: the spot stays open for waivers
      if (!auto) return { ok: false, why: "Pick a player" };
      L.nba.picks.push({ team: teamId, pid: null, auto: true, at: now });
    } else {
      const ctx = context(L, pool);
      const p = ctx.byId[pid];
      if (!p) return { ok: false, why: "Unknown player" };
      if (ctx.own[pid] != null) return { ok: false, why: `${p.n} is already taken` };
      const c = check(L, team, p, ctx, { reserve: !(auto && auto.relaxed) });
      if (!c.ok) return c;
      team.hist.push({ pid, from: L.settings.startWeek, to: null });
      for (const t of L.teams) t.queue = t.queue.filter((x) => x !== pid);
      L.nba.picks.push({ team: teamId, pid, auto: !!auto, at: now });
    }
    L.nba.clockStart = now;
    if (L.nba.picks.length >= L.nba.order.length) {
      L.phase = "prospects";
      L.nba.done = now;
      const mode = L.settings.prospectAuction || "sealed";
      if (mode === "live") {
        // A short break, then the live auction: two minutes for a live draft, right away for a slow one.
        startLiveAuction(L, now, L.settings.draftMode === "slow" ? 0 : 2 * 60000);
        log(L, now, "draft", -1, "The draft is complete. The live Prospect Board auction starts in two minutes.");
      } else {
        L.due.auction = new Date(now + L.settings.auctionHours * HOUR).toISOString();
        log(L, now, "draft", -1, "The draft is complete. The Prospect Board auction is open.");
        if (mode === "skip") L.skipAuction = true;
      }
    }
    return { ok: true };
  }

  // How a bot (or an empty queue) values a player right now.
  function botScore(L, team, p, ctx, r) {
    const ros = active(team);
    const left = L.settings.roster - ros.length;
    const room = spendLimit(L, team) - payroll(team, ctx.byId);
    const pace = room / Math.max(1, left);
    let s = p.z;
    const over = p.sal - pace * 1.35;
    if (over > 0) s -= over / 7.5e6;
    if (team.style === "value") s += (pace - p.sal) / 2.2e7;
    if (team.style === "stars" && p.sal > 3.5e7) s += 0.8;
    if (team.style === "youth" && p.age <= 24) s += 0.7;
    if (team.style === "youth" && p.age >= 32) s -= 0.6;
    const posCount = ros.filter((id) => ctx.byId[id] && ctx.byId[id].pos === p.pos).length;
    if (posCount >= 4) s -= 0.9 * (posCount - 3);
    return s + (r ? (r() - 0.5) * 1.1 : 0);
  }

  // The pick a team gets when its clock runs out: its queue first, then the best fit.
  function autoChoice(L, pool, teamId, r) {
    const ctx = context(L, pool);
    const team = L.teams[teamId];
    for (const id of team.queue || []) {
      const p = ctx.byId[id];
      if (p && ctx.own[id] == null && check(L, team, p, ctx, { reserve: true, limit: spendLimit(L, team) }).ok) return p;
    }
    let best = null, bestS = -Infinity;
    const saved = team.style;
    if (team.owner) team.style = "balanced";
    for (const p of ctx.available) {
      if (!check(L, team, p, ctx, { reserve: true, limit: spendLimit(L, team) }).ok) continue;
      const s = botScore(L, team, p, ctx, r);
      if (s > bestS) { bestS = s; best = p; }
    }
    team.style = saved;
    if (best) return best;
    // Nothing fits with the reserve: take the cheapest player who fits at all, or leave the spot open.
    const fits = ctx.available.filter((p) => check(L, team, p, ctx, { limit: spendLimit(L, team) }).ok || check(L, team, p, ctx).ok).sort((a, b) => a.sal - b.sal || b.z - a.z);
    return fits.length ? Object.assign({ relaxed: true }, fits[0]) : { id: null, relaxed: true };
  }

  // Moves the draft forward to `now`: bots pick after a short delay, anyone whose clock ran out gets an autopick
  // stamped at the moment it expired. Every page that can write runs this; the save order decides who did it.
  function catchUp(L, pool, now, maxPicks = 400) {
    let made = 0;
    while (made < maxPicks && L.phase === "nba" && !L.nba.paused) {
      const c = onClock(L, now);
      if (!c) break;
      const team = L.teams[c.team];
      const bot = !team.owner;
      const delay = L.settings.draftMode === "slow" ? 0 : L.settings.botDelay;
      const at = bot ? L.nba.clockStart + delay : c.deadline;
      if (now < at) break;
      const p = autoChoice(L, pool, c.team, rng(L.seed + L.nba.picks.length * 31 + 3));
      const r = draftPick(L, pool, c.team, p.id, at, p.relaxed ? { relaxed: true } : true);
      if (!r.ok) break;
      made++;
    }
    return made;
  }

  function undoPick(L, now) {
    if (!L.nba.picks.length || (L.phase !== "nba" && L.phase !== "prospects")) return { ok: false, why: "No pick to undo" };
    if (L.phase === "prospects" && L.auction.results.length) return { ok: false, why: "The auction already ran" };
    const pk = L.nba.picks.pop();
    const team = L.teams[pk.team];
    if (pk.pid) team.hist = team.hist.filter((h) => !(h.pid === pk.pid && h.to == null));
    L.phase = "nba"; L.nba.clockStart = now; delete L.due.auction;
    log(L, now, "commish", -1, "The commissioner took back the last pick");
    return { ok: true, pick: pk };
  }

  /* ---------- the Prospect Board auction ---------- */
  // Blind bids out of the season's FAAB. Highest bid wins; ties go to the team that picked later in round 1.
  // A team stops winning once both prospect spots are full or it can't cover the bid. Unclaimed prospects
  // stay available all season through normal waivers.
  function botAuctionBids(L, prospects, teamId, r) {
    const team = L.teams[teamId];
    const out = [];
    const picks = prospects.slice().sort((a, b) => a.rank - b.rank).slice(0, 18);
    for (const p of picks) {
      if (out.length >= 4) break;
      if (r() < 0.55) continue;
      const amt = Math.max(1, Math.round(team.faab * 0.22 * Math.max(0.15, 1 - p.rank / 30) * (0.6 + 0.8 * r())));
      out.push({ add: p.id, amt });
    }
    return out;
  }

  /* ---------- the live Prospect Board auction ----------
     Teams nominate in first-round order. A nomination opens at the nominator's bid; every new bid resets the clock
     (30 seconds live, hours in a slow league). When it runs out, the high bidder wins and pays from season FAAB.
     A team with its prospect spots full drops out; a manager can pass on nominating for the rest of the auction.
     It ends when no one is left to nominate. Bots nominate the best prospect left and bid up to their own value. */
  const auctionLen = (L) => (L.settings.draftMode === "slow" ? (L.settings.slowAuctionHours || 4) * HOUR : (L.settings.auctionClock || 30) * 1000);
  const nominateLen = (L) => (L.settings.draftMode === "slow" ? (L.settings.slowAuctionHours || 4) * HOUR : 60000);
  function hash01(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }
  function botValue(L, prospects, teamId, pid) {
    const p = prospects.find((x) => x.id === pid);
    if (!p) return 0;
    if (hash01(`${pid}:${teamId}:${L.seed}`) < 0.3) return L.settings.minBid;          // not interested past the opener
    const u = hash01(`${L.seed}:${teamId}:${pid}`);
    return Math.max(L.settings.minBid, Math.round(L.settings.faab * 0.24 * Math.max(0.12, 1 - (p.rank - 1) / 35) * (0.6 + 0.8 * u)));
  }
  const spotsLeft = (L, t) => L.settings.prospects - t.prospects.length;
  const canBid = (L, t) => spotsLeft(L, t) > 0 && t.faab >= L.settings.minBid;
  function startLiveAuction(L, now, delay = 0, started = true) {
    L.pauction = { order: L.nba.round1.slice(), turn: 0, lot: null, passed: [], results: [], started: started ? now + delay : null, nomEnds: null, last: now + delay, paused: null };
    if (started) { L.pauction.nomEnds = now + delay + nominateLen(L); L.due.auction = new Date(now + delay).toISOString(); }
    else delete L.due.auction;
  }
  function auctionNominator(L) {
    const A = L.pauction, n = A.order.length;
    for (let k = 0; k < n; k++) { const id = A.order[(A.turn + k) % n], t = L.teams[id]; if (canBid(L, t) && !A.passed.includes(id)) return id; }
    return null;
  }
  const auctionLeft = (L, prospects) => { const own = owners(L); return prospects.filter((p) => own[p.id] == null && !p.off && p.rank <= 300).sort((a, b) => a.rank - b.rank); };
  function auctionDue(L, prospects) {
    const A = L.pauction;
    if (!A || A.paused || A.started == null) return null;
    if (A.lot) {
      const interested = L.teams.some((t) => !t.owner && t.id !== A.lot.team && canBid(L, t) && Math.min(t.faab, botValue(L, prospects, t.id, A.lot.pid)) > A.lot.bid);
      return Math.min(A.lot.ends, interested ? A.lot.at + L.settings.botDelay : Infinity);
    }
    const nom = auctionNominator(L);
    if (nom == null) return A.last;
    return L.teams[nom].owner ? Math.max(A.started, A.nomEnds) : Math.max(A.started, A.last + L.settings.botDelay);
  }
  const setDue = (L, prospects) => { const d = auctionDue(L, prospects); if (d == null || !Number.isFinite(d)) delete L.due.auction; else L.due.auction = new Date(d).toISOString(); };
  function nominate(L, prospects, teamId, pid, amt, now) {
    const A = L.pauction;
    if (!A || L.phase !== "prospects") return { ok: false, why: "There's no live auction" };
    if (A.started == null || now < A.started) return { ok: false, why: "The auction hasn't started" };
    if (A.paused) return { ok: false, why: "The commissioner paused the auction" };
    if (A.lot) return { ok: false, why: "A prospect is already up" };
    if (auctionNominator(L) !== teamId) return { ok: false, why: "It isn't your nomination" };
    if (!auctionLeft(L, prospects).some((p) => p.id === pid)) return { ok: false, why: "He's already taken" };
    const t = L.teams[teamId], bid = Math.floor(+amt || L.settings.minBid);
    if (bid < L.settings.minBid) return { ok: false, why: `The opening bid is at least $${L.settings.minBid}` };
    if (bid > t.faab) return { ok: false, why: `You have $${t.faab} of FAAB` };
    A.lot = { pid, bid, team: teamId, nominator: teamId, at: now, ends: now + auctionLen(L), bids: 1 };
    A.turn = (A.order.indexOf(teamId) + 1) % A.order.length;
    setDue(L, prospects);
    return { ok: true };
  }
  function auctionBid(L, prospects, teamId, amt, now) {
    const A = L.pauction, lot = A && A.lot;
    if (!lot) return { ok: false, why: "Nobody is up for bid" };
    if (A.paused) return { ok: false, why: "The commissioner paused the auction" };
    if (now >= lot.ends) return { ok: false, why: "Time ran out on that one" };
    const t = L.teams[teamId], bid = Math.floor(+amt);
    if (lot.team === teamId) return { ok: false, why: "You're already the high bidder" };
    if (!canBid(L, t)) return { ok: false, why: "Your prospect spots are full" };
    if (!(bid > lot.bid)) return { ok: false, why: `The bid is already $${lot.bid}` };
    if (bid > t.faab) return { ok: false, why: `You have $${t.faab} of FAAB` };
    lot.bid = bid; lot.team = teamId; lot.at = now; lot.ends = Math.max(lot.ends, now + auctionLen(L)); lot.bids++;
    setDue(L, prospects);
    return { ok: true };
  }
  function passNomination(L, prospects, teamId, now) {
    const A = L.pauction;
    if (!A || A.lot || auctionNominator(L) !== teamId) return { ok: false, why: "It isn't your nomination" };
    A.passed.push(teamId); A.last = now; A.nomEnds = now + nominateLen(L);
    log(L, now, "auction", teamId, `${L.teams[teamId].name} is done nominating`);
    setDue(L, prospects);
    return { ok: true };
  }
  function pauseAuction(L, prospects, now, pause) {
    const A = L.pauction;
    if (!A) return { ok: false, why: "There's no live auction" };
    if (pause && !A.paused) { A.paused = now; delete L.due.auction; }
    else if (!pause && A.paused) {
      const gap = now - A.paused; A.paused = null;
      if (A.lot) { A.lot.ends += gap; A.lot.at += gap; }
      if (A.nomEnds) A.nomEnds += gap; A.last += gap;
      setDue(L, prospects);
    }
    return { ok: true };
  }
  function beginAuction(L, prospects, now, delay = 10000) {
    const A = L.pauction;
    if (!A) return { ok: false, why: "There's no live auction" };
    if (A.started != null && A.started <= now) return { ok: false, why: "It's already running" };
    A.started = now + delay; A.last = now + delay; A.nomEnds = now + delay + nominateLen(L);
    log(L, now, "auction", -1, "The live Prospect Board auction is starting");
    setDue(L, prospects);
    return { ok: true };
  }
  function sellLot(L, prospects, at) {
    const A = L.pauction, lot = A.lot, t = L.teams[lot.team];
    t.prospects.push(lot.pid); t.faab -= lot.bid;
    A.results.push({ team: lot.team, pid: lot.pid, amt: lot.bid, won: true, nominator: lot.nominator, at });
    const p = prospects.find((q) => q.id === lot.pid);
    log(L, at, "auction", lot.team, `${t.name} won ${p ? p.n : lot.pid} for $${lot.bid} FAAB`);
    A.lot = null; A.last = at; A.nomEnds = at + nominateLen(L);
  }
  function finishLive(L, at) {
    const A = L.pauction;
    L.auction = { results: A.results, closed: at, live: true };
    L.phase = "league";
    delete L.due.auction;
    L.due.waiver = nextWaiverRun(at);
    log(L, at, "auction", -1, `The live Prospect Board auction is over: ${A.results.length} prospect${A.results.length === 1 ? "" : "s"} signed. The rest are on waivers.`);
  }
  // Moves the auction forward to now: sells expired lots, lets bots bid and nominate, nominates for a manager whose
  // nomination clock ran out. Every step is stamped with the moment it was due, so a late catch-up plays it straight.
  function auctionTick(L, prospects, now) {
    const A = L.pauction;
    if (!A || L.phase !== "prospects" || A.paused || A.started == null) return 0;
    let n = 0;
    for (let guard = 0; guard < 400; guard++) {
      const due = auctionDue(L, prospects);
      if (due == null || now < due) break;
      if (A.lot) {
        const lot = A.lot;
        if (due >= lot.ends) { sellLot(L, prospects, lot.ends); n++; continue; }
        const bidders = L.teams.filter((t) => !t.owner && t.id !== lot.team && canBid(L, t))
          .map((t) => ({ t, v: Math.min(t.faab, botValue(L, prospects, t.id, lot.pid)) })).filter((x) => x.v > lot.bid);
        if (!bidders.length) { lot.at = lot.ends; continue; }
        const b = bidders[lot.bids % bidders.length];
        const amt = Math.min(b.v, lot.bid + 1 + Math.floor(hash01(lot.pid + ":" + lot.bids) * 3));
        lot.bid = amt; lot.team = b.t.id; lot.at = due; lot.ends = Math.max(lot.ends, due + auctionLen(L)); lot.bids++; n++;
        continue;
      }
      const nom = auctionNominator(L), left = auctionLeft(L, prospects);
      if (nom == null || !left.length) { finishLive(L, due); n++; break; }
      const t = L.teams[nom];
      const pick = t.owner ? left[0] : left.slice(0, 6).sort((a, b) => botValue(L, prospects, nom, b.id) - botValue(L, prospects, nom, a.id))[0];
      A.lot = { pid: pick.id, bid: L.settings.minBid, team: nom, nominator: nom, at: due, ends: due + auctionLen(L), bids: 1, auto: !!t.owner };
      A.turn = (A.order.indexOf(nom) + 1) % A.order.length;
      n++;
    }
    if (L.phase === "prospects") setDue(L, prospects);
    return n;
  }

  // The commissioner ends a live auction early (what's sold stays sold) or sets one up after the season started.
  function endAuction(L, now) {
    if (!L.pauction || L.phase !== "prospects") return { ok: false, why: "There's no live auction" };
    if (L.pauction.lot) L.pauction.lot = null;
    finishLive(L, now);
    return { ok: true };
  }
  function reopenAuction(L, prospects, now) {
    if (L.phase !== "league") return { ok: false, why: "Only once the draft is done" };
    if (L.teams.some((t) => t.prospects.length) || (L.auction && L.auction.results && L.auction.results.length)) return { ok: false, why: "Prospects have already been signed" };
    L.phase = "prospects";
    startLiveAuction(L, now, 0, false);
    log(L, now, "auction", -1, "The commissioner set up a live Prospect Board auction");
    return { ok: true };
  }

  // opts.skip: close it with no bids at all, bots included; every prospect goes to waivers.
  function resolveAuction(L, prospects, sealed, now, opts = {}) {
    if (L.phase !== "prospects") return { ok: false, why: "The auction isn't open" };
    // A live auction moves on its own clock; the server and the pages both call in here when something is due.
    if (L.pauction && !opts.skip) { const n = auctionTick(L, prospects, now); return n ? { ok: true, live: true } : { ok: false, why: "" }; }
    if (L.skipAuction) opts = Object.assign({}, opts, { skip: true });
    const r = rng(L.seed + 991);
    const all = [];
    const tieRank = Object.fromEntries(L.nba.round1.map((id, i) => [id, i]));
    for (const t of opts.skip ? [] : L.teams) {
      const bids = t.owner ? (sealed[t.id] || sealed[String(t.id)] || []) : botAuctionBids(L, prospects, t.id, r);
      bids.forEach((b, i) => {
        const amt = Math.floor(+b.amt);
        if (prospects.find((p) => p.id === b.add) && amt >= L.settings.minBid) all.push({ team: t.id, add: b.add, amt, i });
      });
    }
    all.sort((a, b) => b.amt - a.amt || tieRank[b.team] - tieRank[a.team] || a.i - b.i);
    const taken = new Set();
    const results = [];
    for (const b of all) {
      const team = L.teams[b.team];
      let why = null;
      if (taken.has(b.add)) why = "Outbid";
      else if (team.prospects.length >= L.settings.prospects) why = "Prospect spots full";
      else if (b.amt > team.faab) why = "Not enough FAAB left";
      if (!why) { team.prospects.push(b.add); team.faab -= b.amt; taken.add(b.add); }
      results.push({ team: b.team, pid: b.add, amt: b.amt, won: !why, why });
    }
    L.auction = { results, closed: now };
    L.phase = "league";
    delete L.due.auction;
    L.due.waiver = nextWaiverRun(now);
    const won = results.filter((x) => x.won);
    for (const x of won) {
      const p = prospects.find((q) => q.id === x.pid);
      log(L, now, "auction", x.team, `${L.teams[x.team].name} won ${p ? p.n : x.pid} for $${x.amt} FAAB`);
    }
    log(L, now, "auction", -1, opts.skip ? "The commissioner skipped the Prospect Board auction; every prospect is on waivers" : `The Prospect Board auction closed: ${won.length} prospect${won.length === 1 ? "" : "s"} signed`);
    return { ok: true, results };
  }

  /* ---------- the season ---------- */
  function weekStart(opener, w) {
    const o = new Date(opener + "T12:00:00");
    const mon = new Date(o); mon.setDate(o.getDate() - ((o.getDay() + 6) % 7));
    return w === 1 ? o : new Date(mon.getTime() + (w - 1) * 7 * 864e5);
  }
  function weekDates(opener, w) {
    const o = new Date(opener + "T12:00:00");
    const mon = new Date(o); mon.setDate(o.getDate() - ((o.getDay() + 6) % 7));
    return [weekStart(opener, w), new Date(mon.getTime() + ((w - 1) * 7 + 6) * 864e5)];
  }
  // NBA games a team plays in a fantasy week (stats.sched: team -> Eastern game dates).
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function gamesInWeek(stats, team, opener, w) {
    const days = stats && stats.sched && stats.sched[team];
    if (!days) return null;
    const [a, b] = weekDates(opener, w), lo = ymd(a), hi = ymd(b);
    return days.filter((d) => d >= lo && d <= hi).length;
  }
  function weekOf(opener, day) {
    const o = new Date(opener + "T12:00:00");
    const mon = new Date(o); mon.setDate(o.getDate() - ((o.getDay() + 6) % 7));
    const d = new Date(day); d.setHours(12, 0, 0, 0);
    return Math.max(1, Math.floor((d - mon) / (7 * 864e5)) + 1);
  }
  // Waivers run at 3 a.m. Eastern every Monday (8 a.m. UTC, close enough across daylight saving).
  function nextWaiverRun(now) {
    const d = new Date(now);
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8, 0, 0));
    let add = (8 - t.getUTCDay()) % 7;
    if (add === 0 && t.getTime() <= now) add = 7;
    return new Date(t.getTime() + add * 864e5).toISOString();
  }

  const rosterInWeek = (team, w) => team.hist.filter((h) => h.from <= w && (h.to == null || h.to >= w)).map((h) => h.pid);

  function gameScore(l) {
    const dreb = l[C.reb] - l[C.oreb];
    return l[C.pts] + 0.4 * l[C.fgm] - 0.7 * l[C.fga] - 0.4 * (l[C.fta] - l[C.ftm]) + 0.7 * l[C.oreb] + 0.3 * dreb
      + l[C.stl] + 0.7 * l[C.ast] + 0.7 * l[C.blk] - 0.4 * l[C.pf] - l[C.tov];
  }

  // Stats lines with each player's VORP gained that week appended (index 15), from the weekly season-VORP readings.
  function withVorp(stats) {
    const wk = (stats && stats.wk) || {}, snaps = (stats && stats.vorpWk) || {};
    const out = {};
    for (const [w, lines] of Object.entries(wk)) {
      const cur = snaps[w], prev = snaps[String(+w - 1)];
      if (!cur || !prev) { out[w] = lines; continue; }
      const o = {};
      for (const [pid, l] of Object.entries(lines)) o[pid] = cur[pid] != null ? [...l, Math.round((cur[pid] - (prev[pid] || 0)) * 10) / 10] : l;
      o.__vorp = true;
      out[w] = o;
    }
    return out;
  }

  function teamWeek(L, team, w, wk, byId) {
    const lines = (wk && wk[String(w)]) || {};
    const t = Object.fromEntries(COLS.map((k) => [k, 0]));
    t.gmsc = 0;
    const per = [];
    const lineup = lineupFor(L, team, w, byId);
    const bench = rosterInWeek(team, w).filter((id) => !lineup.includes(id));
    const rows = [...lineup.map((pid, i) => ({ pid, slot: SLOTS[i] })), ...bench.map((pid) => ({ pid, slot: (team.ir || []).includes(pid) ? "IR" : "BN" }))];
    for (const { pid, slot } of rows) {
      const starter = slot !== "BN" && slot !== "IR";
      if (!pid) { per.push({ pid: null, slot, gp: 0, gmsc: 0, starter }); continue; }
      const l = pid === "__vorp" ? null : lines[pid];
      if (!l) { per.push({ pid, slot, gp: 0, gmsc: 0, starter }); continue; }
      const g = gameScore(l);
      if (starter) { COLS.forEach((k, i) => (t[k] += l[i])); t.gmsc += g; }
      per.push({ pid, slot, gp: l[C.gp], gmsc: g, line: l, starter });
    }
    t.fg = t.fga ? t.fgm / t.fga : null;
    t.ft = t.fta ? t.ftm / t.fta : null;
    t.vorp = lines.__vorp ? Math.round(per.filter((x) => x.starter && x.line && x.line[15] != null).reduce((a, x) => a + x.line[15], 0) * 10) / 10 : null;
    return { t, per };
  }

  function compare(a, b, cats) {
    const res = [];
    let w = 0, l = 0, t = 0;
    for (const c of cats || CATS) {
      const x = a[c.k], y = b[c.k];
      if (c.k === "vorp" && x == null && y == null) continue;   // no VORP readings for that week yet
      let out = "t";
      if (x == null && y == null) out = "t";
      else if (x == null) out = "l";
      else if (y == null) out = "w";
      else {
        const d = c.pct ? Math.round(x * 1000) - Math.round(y * 1000) : Math.round(x * 10) - Math.round(y * 10);
        out = d === 0 ? "t" : (d > 0) !== !!c.low ? "w" : "l";
      }
      if (out === "w") w++; else if (out === "l") l++; else t++;
      res.push({ cat: c, a: x, b: y, out });
    }
    return { cats: res, w, l, t };
  }

  function matchups(L, w, wk, byId) {
    if (w > L.settings.regWeeks) {
      const b = bracket(L, wk, byId);
      if (w === L.settings.regWeeks + 1) return b.semis.map((m, i) => ({ ...m, label: i ? "Semifinal: 2 vs 3" : "Semifinal: 1 vs 4" }));
      if (w === L.settings.regWeeks + 2 && b.final) return [{ ...b.final, label: "Final" }, { ...b.third, label: "Third place" }];
      return [];
    }
    return (L.schedule[w - 1] || []).map(([i, j]) => {
      const A = teamWeek(L, L.teams[i], w, wk, byId), B = teamWeek(L, L.teams[j], w, wk, byId);
      return { a: i, b: j, A, B, cmp: compare(A.t, B.t, catsFor(L)) };
    });
  }

  // Standings count every category: a 6-3 week is six wins and three losses. Game Score breaks ties.
  function standings(L, upTo, wk, byId) {
    const rows = L.teams.map((t) => ({ id: t.id, w: 0, l: 0, t: 0, mw: 0, ml: 0, mt: 0, gmsc: 0, pf: [] }));
    for (let w = L.settings.startWeek; w <= Math.min(upTo, L.settings.regWeeks, L.schedule.length); w++) {
      if (!wk || !wk[String(w)]) continue;
      for (const m of matchups(L, w, wk, byId)) {
        const A = rows[m.a], B = rows[m.b], c = m.cmp;
        A.w += c.w; A.l += c.l; A.t += c.t; B.w += c.l; B.l += c.w; B.t += c.t;
        A.gmsc += m.A.t.gmsc; B.gmsc += m.B.t.gmsc;
        if (c.w > c.l) { A.mw++; B.ml++; A.pf.push("W"); B.pf.push("L"); }
        else if (c.l > c.w) { B.mw++; A.ml++; A.pf.push("L"); B.pf.push("W"); }
        else { A.mt++; B.mt++; A.pf.push("T"); B.pf.push("T"); }
      }
    }
    for (const r of rows) r.pct = r.w + r.l + r.t ? (r.w + r.t / 2) / (r.w + r.l + r.t) : 0;
    return rows.sort((a, b) => b.pct - a.pct || b.gmsc - a.gmsc || a.id - b.id);
  }

  /* ---------- playoffs ---------- */
  // Top four after the regular season. Week regWeeks+1: 1 vs 4 and 2 vs 3. Week regWeeks+2: the final and a third-place
  // game. A tied matchup goes to Game Score, then the higher seed.
  function winnerOf(m, seedA, seedB) {
    const c = m.cmp;
    if (c.w !== c.l) return c.w > c.l ? m.a : m.b;
    if (Math.abs(m.A.t.gmsc - m.B.t.gmsc) > 1e-9) return m.A.t.gmsc > m.B.t.gmsc ? m.a : m.b;
    return seedA < seedB ? m.a : m.b;
  }
  function bracket(L, wk, byId) {
    const R = L.settings.regWeeks;
    const seeds = standings(L, R, wk, byId).slice(0, 4).map((r) => r.id);
    const one = (a, b, w) => { const A = teamWeek(L, L.teams[a], w, wk, byId), B = teamWeek(L, L.teams[b], w, wk, byId); return { a, b, A, B, cmp: compare(A.t, B.t, catsFor(L)), w }; };
    const done = (w) => !!(wk && wk[String(w)]);
    const semis = [one(seeds[0], seeds[3], R + 1), one(seeds[1], seeds[2], R + 1)];
    let final = null, third = null, champ = null, place = null;
    if (done(R + 1)) {
      const w1 = winnerOf(semis[0], 1, 4), w2 = winnerOf(semis[1], 2, 3);
      const l1 = w1 === semis[0].a ? semis[0].b : semis[0].a, l2 = w2 === semis[1].a ? semis[1].b : semis[1].a;
      final = one(w1, w2, R + 2); third = one(l1, l2, R + 2);
      if (done(R + 2)) {
        const sd = (id) => seeds.indexOf(id) + 1;
        const c = winnerOf(final, sd(w1), sd(w2)), t = winnerOf(third, sd(l1), sd(l2));
        champ = c; place = [c, c === final.a ? final.b : final.a, t];
      }
    }
    return { seeds, semis, final, third, champ, place };
  }

  /* ---------- the summer draft ---------- */
  // One FAAB auction for incoming rookies and unsigned free agents. Worse teams get bigger budgets, scaled evenly from
  // the champion's floor to the last-place ceiling, plus a bonus for each expiring player they let walk.
  function summerBudgets(L, order, walked) {
    const n = order.length, s = L.settings;
    const out = {};
    order.forEach((id, i) => {
      const base = n > 1 ? Math.round(s.summerMin + ((s.summerMax - s.summerMin) * i) / (n - 1)) : s.summerMax;
      out[id] = base + ((walked && walked[id]) || 0) * s.compDollars;
    });
    return out;
  }

  /* ---------- free agency ---------- */
  // Checks a FAAB bid before it's sealed. It's checked again when waivers run, since rosters move in between.
  function bidCheck(L, pool, prospects, teamId, bid, inj) {
    const team = L.teams[teamId];
    const sick = irProblem(L, team, inj);
    if (sick && !isProspect(bid.add)) { const sp = pool.find((x) => x.id === sick); return { ok: false, why: `${sp ? sp.n : "A player"} is healthy on IR: activate or release him first` }; }
    const ctx = context(L, pool);
    const amt = Math.floor(+bid.amt);
    if (!(amt >= L.settings.minBid)) return { ok: false, why: `Bids start at $${L.settings.minBid}` };
    if (amt > team.faab) return { ok: false, why: `You have $${team.faab} of FAAB` };
    if (ctx.own[bid.add] != null) return { ok: false, why: "He's on a roster" };
    if (L.waived[bid.add] === teamId) return { ok: false, why: "You can't claim back a player you released this week" };
    if (isProspect(bid.add)) {
      if (!prospects.find((p) => p.id === bid.add)) return { ok: false, why: "Unknown prospect" };
      if (team.prospects.length >= L.settings.prospects && !(bid.drop && team.prospects.includes(bid.drop)))
        return { ok: false, why: "Both prospect spots are full: pick one to release" };
      return { ok: true };
    }
    const p = ctx.byId[bid.add];
    if (!p) return { ok: false, why: "Unknown player" };
    if (bid.drop && !active(team).includes(bid.drop)) return { ok: false, why: "You can only release your own player" };
    return check(L, team, p, ctx, { drop: bid.drop });
  }

  function dropPlayer(L, pool, teamId, pid, week, now) {
    const team = L.teams[teamId];
    if (isProspect(pid)) {
      if (!team.prospects.includes(pid)) return { ok: false, why: "Not one of your prospects" };
      team.prospects = team.prospects.filter((x) => x !== pid);
    } else {
      const h = team.hist.find((x) => x.pid === pid && x.to == null);
      if (!h) return { ok: false, why: "Not on your roster" };
      team.ir = (team.ir || []).filter((x) => x !== pid);
      clearFromLineups(L, team, pid, now);
      h.to = week;                                     // his current week still counts; his salary is gone now
      if (h.to < h.from) team.hist.splice(team.hist.indexOf(h), 1);
    }
    L.waived[pid] = teamId;
    const p = pool.find((x) => x.id === pid);
    log(L, now, "drop", teamId, `${team.name} released ${p ? p.n : pid}`);
    return { ok: true };
  }

  function botWaiverBids(L, pool, r) {
    const ctx = context(L, pool);
    const free = ctx.available.slice().sort((a, b) => b.z - a.z).slice(0, 25);
    const out = {};
    for (const team of L.teams) {
      if (team.owner || team.faab < 1 || r() < 0.45) continue;
      const ros = active(team).map((id) => ctx.byId[id]).filter(Boolean).sort((a, b) => a.z - b.z);
      const worst = ros[0];
      if (!worst) continue;
      for (const p of free) {
        if (p.z < worst.z + 0.6) break;
        const amt = Math.max(1, Math.min(team.faab, Math.round((p.z - worst.z) * (2 + r() * 3))));
        if (check(L, team, p, ctx, { drop: worst.id, limit: spendLimit(L, team) }).ok) { out[team.id] = [{ add: p.id, drop: worst.id, amt }]; break; }
      }
    }
    return out;
  }

  // Highest bid wins; ties go to the team lower in the standings. Signings count from the week after `week`.
  function runWaivers(L, pool, prospects, sealed, week, order, now, inj) {
    const r = rng(L.seed + week * 13 + 5);
    const bots = botWaiverBids(L, pool, r);
    const rankOf = Object.fromEntries((order || L.teams.map((t) => t.id)).map((id, i) => [id, i]));
    const all = [];
    for (const t of L.teams) {
      const list = t.owner ? (sealed[t.id] || sealed[String(t.id)] || []) : bots[t.id] || [];
      list.forEach((b, i) => all.push({ team: t.id, add: b.add, drop: b.drop || null, amt: Math.floor(+b.amt), i }));
    }
    all.sort((a, b) => b.amt - a.amt || rankOf[b.team] - rankOf[a.team] || a.i - b.i);
    const results = [];
    for (const b of all) {
      const ctx = context(L, pool);
      const team = L.teams[b.team];
      if (ctx.own[b.add] != null) { results.push({ ...b, ok: false, why: "Signed by someone else" }); continue; }
      const c = bidCheck(L, pool, prospects, b.team, b, inj);
      if (!c.ok) { results.push({ ...b, ok: false, why: c.why }); continue; }
      const name = isProspect(b.add) ? (prospects.find((p) => p.id === b.add) || {}).n : ctx.byId[b.add].n;
      if (b.drop) dropPlayer(L, pool, b.team, b.drop, week, now);
      if (isProspect(b.add)) team.prospects.push(b.add);
      else team.hist.push({ pid: b.add, from: week + 1, to: null });
      team.faab -= b.amt;
      results.push({ ...b, ok: true });
      const salary = isProspect(b.add) ? "prospect rights" : `${money(ctx.byId[b.add].sal)} salary`;
      log(L, now, "add", b.team, `${team.name} signed ${name} for $${b.amt} FAAB (${salary})`);
    }
    L.waived = {};
    L.lastWaiverRun = { at: now, week, results: results.map((x) => ({ team: x.team, add: x.add, amt: x.amt, ok: x.ok, why: x.why || null })) };
    L.due.waiver = nextWaiverRun(now);
    return results;
  }

  /* ---------- trades ---------- */
  // give: pieces leaving `from`; get: pieces leaving `to`. Players or prospects. Moves count from next week.
  function tradeCheck(L, pool, t) {
    const ctx = context(L, pool);
    const A = L.teams[t.from], B = L.teams[t.to];
    for (const id of t.give) if (ctx.own[id] !== A.id) return { ok: false, why: `${A.name} no longer has everyone in this deal` };
    for (const id of t.get) if (ctx.own[id] !== B.id) return { ok: false, why: `${B.name} no longer has everyone in this deal` };
    const nb = (ids) => ids.filter((x) => !isProspect(x));
    const pr = (ids) => ids.filter(isProspect);
    const side = (team, out, inn) => {
      const act = active(team), outAct = nb(out).filter((x) => act.includes(x));      // IR players leaving free nothing
      const before = payroll(team, ctx.byId);
      const count = act.length - outAct.length + nb(inn).length;
      if (count > L.settings.roster) return `${team.name} would have ${count} active players`;
      const twMax = L.settings.twoWayMax == null ? 3 : L.settings.twoWayMax;
      const tw = twoWaysOn(team, ctx.byId, nb(out)) + nb(inn).filter((x) => isTwoWay(ctx.byId[x])).length;
      if (tw > twMax && tw > twoWaysOn(team, ctx.byId)) return `${team.name} would have ${tw} two-way players (limit ${twMax})`;
      const pc = team.prospects.length - pr(out).length + pr(inn).length;
      if (pc > L.settings.prospects) return `${team.name} would have ${pc} prospects`;
      const pay = payroll(team, ctx.byId) - sum(outAct.map((x) => ctx.byId[x].sal)) + sum(nb(inn).map((x) => ctx.byId[x].sal));
      // A team already over its line (a real-world raise) may make any deal that cuts its payroll.
      if (pay > ceilingOf(L, team) && !(before > ceilingOf(L, team) && pay < before)) return `${team.name} would be ${money(pay - ceilingOf(L, team))} over its ${money(ceilingOf(L, team))} ${isSoft(L) ? "ceiling" : "line"}`;
      return null;
    };
    const fg = t.faabGive || 0, ft = t.faabGet || 0;
    if (fg < 0 || ft < 0 || fg % 1 || ft % 1) return { ok: false, why: "FAAB in a deal is whole dollars" };
    if (fg > A.faab) return { ok: false, why: `${A.name} only has $${A.faab} of FAAB` };
    if (ft > B.faab) return { ok: false, why: `${B.name} only has $${B.faab} of FAAB` };
    const why = side(A, t.give, t.get) || side(B, t.get, t.give);
    return why ? { ok: false, why } : { ok: true };
  }

  function proposeTrade(L, pool, from, to, give, get, now, faabGive = 0, faabGet = 0, week = 1) {
    if (L.phase !== "league") return { ok: false, why: "Trades open after the draft" };
    if (week > L.settings.tradeDeadline) return { ok: false, why: `The trade deadline was the end of week ${L.settings.tradeDeadline}` };
    if (from === to || (!give.length && !get.length && !faabGive && !faabGet)) return { ok: false, why: "Pick something on both sides" };
    const t = { id: `${now.toString(36)}${from}${to}${L.trades.length.toString(36)}`, from, to, give, get, faabGive: Math.floor(faabGive) || 0, faabGet: Math.floor(faabGet) || 0, at: now, status: "pending" };
    const c = tradeCheck(L, pool, t);
    if (!c.ok) return c;
    L.trades.push(t);
    return { ok: true, trade: t };
  }

  function respondTrade(L, pool, id, accept, week, now) {
    const t = L.trades.find((x) => x.id === id);
    if (!t || t.status !== "pending") return { ok: false, why: "That offer isn't open" };
    if (!accept) { t.status = "declined"; t.closed = now; return { ok: true }; }
    const c = tradeCheck(L, pool, t);
    if (!c.ok) { t.status = "failed"; t.closed = now; t.why = c.why; return c; }
    // With a league vote, an accepted deal waits out the review window before anything moves.
    if (L.settings.tradeReview === "vote" && voters(L, t).length) {
      t.status = "review"; t.accepted = now; t.reviewEnds = now + L.settings.reviewHours * HOUR; t.votes = {};
      log(L, now, "trade", t.from, `${L.teams[t.from].name} and ${L.teams[t.to].name} agreed to a trade; the league has ${L.settings.reviewHours} hours to review it`);
      return { ok: true, review: true };
    }
    return applyTrade(L, pool, t, week, now);
  }

  // Managers outside the deal; bots don't vote.
  const voters = (L, t) => L.teams.filter((x) => x.owner && x.id !== t.from && x.id !== t.to).map((x) => x.id);
  const vetoesNeeded = (L, t) => Math.max(1, Math.ceil(voters(L, t).length * L.settings.vetoShare));

  function voteTrade(L, id, teamId, veto, now) {
    const t = L.trades.find((x) => x.id === id);
    if (!t || t.status !== "review") return { ok: false, why: "That trade isn't up for review" };
    if (!voters(L, t).includes(teamId)) return { ok: false, why: "Only managers outside the deal can vote" };
    t.votes = t.votes || {};
    if (veto) t.votes[teamId] = now; else delete t.votes[teamId];
    if (Object.keys(t.votes).length >= vetoesNeeded(L, t)) {
      t.status = "vetoed"; t.vetoed = now;
      log(L, now, "trade", -1, `The league vetoed the ${L.teams[t.from].name} and ${L.teams[t.to].name} trade`);
    }
    return { ok: true };
  }

  // Deals whose review window has closed go through, if they still work.
  function finalizeTrades(L, pool, now, week) {
    let n = 0;
    for (const t of L.trades) {
      if (t.status !== "review" || now < t.reviewEnds) continue;
      const c = tradeCheck(L, pool, t);
      if (!c.ok) { t.status = "failed"; t.closed = now; t.why = c.why; n++; continue; }
      applyTrade(L, pool, t, week, now); n++;
    }
    return n;
  }

  function applyTrade(L, pool, t, week, now) {
    const move = (fromT, toT, ids) => {
      for (const id2 of ids) {
        if (isProspect(id2)) { fromT.prospects = fromT.prospects.filter((x) => x !== id2); toT.prospects.push(id2); continue; }
        const h = fromT.hist.find((x) => x.pid === id2 && x.to == null);
        h.to = week; if (h.to < h.from) fromT.hist.splice(fromT.hist.indexOf(h), 1);
        toT.hist.push({ pid: id2, from: week + 1, to: null });
      }
    };
    const A = L.teams[t.from], B = L.teams[t.to];
    for (const x of [...t.give]) { A.ir = (A.ir || []).filter((y) => y !== x); clearFromLineups(L, A, x, now); }
    for (const x of [...t.get]) { B.ir = (B.ir || []).filter((y) => y !== x); clearFromLineups(L, B, x, now); }
    move(A, B, t.give); move(B, A, t.get);
    A.faab += (t.faabGet || 0) - (t.faabGive || 0); B.faab += (t.faabGive || 0) - (t.faabGet || 0);
    t.status = "accepted"; t.closed = now;
    const nm = (ids, f) => [...ids.map((x) => (pool.find((p) => p.id === x) || { n: x.replace(/^c-/, "") }).n), ...(f ? [`$${f} FAAB`] : [])].join(", ") || "nothing";
    log(L, now, "trade", t.from, `${A.name} traded ${nm(t.give, t.faabGive)} to ${B.name} for ${nm(t.get, t.faabGet)}`);
    // Anything else pending that this deal broke is no longer possible.
    for (const o of L.trades) if ((o.status === "pending" || o.status === "review") && !tradeCheck(L, pool, o).ok) { o.status = "failed"; o.closed = now; o.why = "A player moved in another deal"; }
    return { ok: true };
  }

  /* ---------- over the line after a real-world change ----------
     A real trade kicker, an option or a corrected salary can push a team over its line. It can't add salary while it's
     over, and it has until the first lineup lock at least lineGraceHours away to get back under: release someone,
     make a trade that cuts payroll, or move up a tier. If it's still over then, the clock releases its lowest-ranked
     players until it fits. */
  // Luxury tax: payroll is snapshotted when the trade deadline passes and again when the regular season ends; each team
  // pays on the higher of the two, so dumping salary on the last day doesn't dodge it.
  function assessTax(L, byId, now, opener) {
    if (!isSoft(L) || L.phase !== "league") return 0;
    L.tax = L.tax || { season: L.settings.season || "2026-27", deadline: null, assessed: null };
    let n = 0;
    if (!L.tax.deadline && now >= lockTime(opener, L.settings.tradeDeadline + 1)) {
      L.tax.deadline = Object.fromEntries(L.teams.map((t) => [t.id, payroll(t, byId)])); n++;
    }
    if (!L.tax.assessed && now >= lockTime(opener, L.settings.regWeeks + 1)) {
      L.tax.assessed = {}; L.taxHist = L.taxHist || {};
      for (const t of L.teams) {
        const pay = Math.max(payroll(t, byId), (L.tax.deadline || {})[t.id] || 0), rep = isRepeater(L, t), tax = taxFor(L, pay, rep);
        L.tax.assessed[t.id] = { payroll: pay, over: Math.max(0, pay - L.settings.freeLine), tax, repeater: rep };
        (L.taxHist[t.id] = L.taxHist[t.id] || []).push(tax > 0);
        if (tax) log(L, now, "tax", t.id, `${t.name} owes $${tax} in luxury tax${rep ? " at the repeater rate" : ""}: ${money(pay - L.settings.freeLine)} over the ${money(L.settings.freeLine)} line`);
      }
      n++;
    }
    return n;
  }

  function enforceLine(L, pool, now, week, opener) {
    const byId = Object.fromEntries(pool.map((p) => [p.id, p]));
    let changed = assessTax(L, byId, now, opener);
    for (const t of L.teams) {
      const over = payroll(t, byId) - ceilingOf(L, t);
      if (over <= 0) { if (t.overSince) { delete t.overSince; delete t.overDeadline; changed++; } continue; }
      if (!t.overSince) {
        t.overSince = now;
        let w = week, dl = lockTime(opener, w);
        while (dl < now + L.settings.lineGraceHours * HOUR) dl = lockTime(opener, ++w);
        t.overDeadline = dl;
        log(L, now, "line", t.id, `${t.name} is ${money(over)} over its ${money(ceilingOf(L, t))} ${isSoft(L) ? "ceiling" : "line"} after a real salary change. It has until ${new Date(dl).toISOString().slice(0, 10)} to get back under`);
        changed++;
        continue;
      }
      if (now < t.overDeadline) continue;
      const cut = active(t).map((id) => byId[id]).filter(Boolean).sort((a, b) => a.z - b.z);
      while (payroll(t, byId) > ceilingOf(L, t) && cut.length) {
        const p = cut.shift();
        dropPlayer(L, pool, t.id, p.id, week, now);
        L.log[L.log.length - 1].text = `${t.name} was still over its ${isSoft(L) ? "ceiling" : "line"} at the deadline, so ${p.n} (${money(p.sal)}) was released`;
        L.log[L.log.length - 1].kind = "line";
      }
      delete t.overSince; delete t.overDeadline;
      changed++;
    }
    return changed;
  }

  // The commissioner can undo an accepted trade within the veto window, as long as nobody in it has moved since.
  function vetoTrade(L, pool, id, now) {
    const t = L.trades.find((x) => x.id === id);
    if (!t || t.status !== "accepted") return { ok: false, why: "Only an accepted trade can be vetoed" };
    if (now - t.closed > L.settings.vetoHours * HOUR) return { ok: false, why: `The ${L.settings.vetoHours}-hour veto window has closed` };
    const A = L.teams[t.from], B = L.teams[t.to];
    const back = (fromT, toT, ids) => {                       // pieces that went fromT -> toT come back
      for (const x of ids) {
        if (isProspect(x)) { if (!toT.prospects.includes(x)) return `${x} has moved again`; continue; }
        if (!toT.hist.some((h) => h.pid === x && h.to == null)) return "A player in the deal has moved again";
      }
      return null;
    };
    const why = back(A, B, t.give) || back(B, A, t.get);
    if (why) return { ok: false, why };
    const undo = (fromT, toT, ids) => {
      for (const x of ids) {
        if (isProspect(x)) { toT.prospects = toT.prospects.filter((y) => y !== x); fromT.prospects.push(x); continue; }
        const nh = toT.hist.filter((h) => h.pid === x && h.to == null).pop();
        toT.hist.splice(toT.hist.indexOf(nh), 1);
        toT.ir = (toT.ir || []).filter((y) => y !== x);
        const oh = fromT.hist.filter((h) => h.pid === x).pop();
        if (oh && oh.to != null && oh.to + 1 >= nh.from) oh.to = null; else fromT.hist.push({ pid: x, from: nh.from, to: null });
        for (const tm of [fromT, toT]) for (const [w, sl] of Object.entries(tm.lineups || {})) if (+w >= nh.from) tm.lineups[w] = sl.map((y) => (y === x ? null : y));
      }
    };
    undo(A, B, t.give); undo(B, A, t.get);
    A.faab += (t.faabGive || 0) - (t.faabGet || 0); B.faab += (t.faabGet || 0) - (t.faabGive || 0);
    t.status = "vetoed"; t.vetoed = now;
    log(L, now, "trade", -1, `The commissioner vetoed the ${A.name} and ${B.name} trade; everyone went back`);
    return { ok: true };
  }

  // Bots take a deal that improves them by a clear margin and fits.
  function botWantsTrade(L, pool, t) {
    const byId = Object.fromEntries(pool.map((p) => [p.id, p]));
    const val = (ids, f) => sum(ids.map((x) => (isProspect(x) ? 1.5 : (byId[x] ? byId[x].z : 0)))) + (f || 0) * 0.15;
    return val(t.give, t.faabGive) - val(t.get, t.faabGet) >= 0.4 && tradeCheck(L, pool, t).ok;
  }

  const E = {
    latestContracts, gamesInWeek, isSoft, freeLine, taxFor, isRepeater, taxPaid, spendLimit, assessTax, endAuction, reopenAuction, startLiveAuction, auctionNominator, auctionLeft, nominate, auctionBid, passNomination, pauseAuction, beginAuction, auctionTick, botValue, isTwoWay, twoWaysOn, CATS, VORP_CAT, catsFor, withVorp, voteTrade, finalizeTrades, applyTrade, voters, vetoesNeeded, enforceLine, contractType,
    COLS, C, DEFAULTS, HOUR, totalWeeks, rosterIndex, onNbaRoster, mergeContracts, releaseGone, SLOTS, ELIG, positions, eligible, isOut, rostered, irProblem, moveToIR, activateIR,
    autoLineup, lockTime, lineupFor, setLineup, lockLineups, defaultTiers, rng, money, isProspect, buildPool, buildProspects, rankNineCat, newLeague,
    snake, snakeFrom, setOrder, roundRobin, tierOf, ceilingOf, owed, pot, upgradeTier, active, payroll, owners, context, reserve,
    check, clockLen, onClock, nextPickOf, startDraft, pauseDraft, draftPick, botScore, autoChoice, catchUp, undoPick,
    botAuctionBids, resolveAuction, bracket, winnerOf, summerBudgets, vetoTrade, TEAM_NAMES, weekStart, weekDates, weekOf, nextWaiverRun, rosterInWeek, gameScore, teamWeek, compare,
    matchups, standings, bidCheck, dropPlayer, botWaiverBids, runWaivers, tradeCheck, proposeTrade, respondTrade, botWantsTrade,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = E;
  else root.HardCap = E;
})(this);
