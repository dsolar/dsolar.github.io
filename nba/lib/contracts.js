/* Shared NBA library: the latest contracts and rosters.
   Layers the nightly feeds (Basketball-Reference contracts, ESPN rosters, both in hardcap/stats.json) and the
   hand-checked fixes (hardcap/contracts.json) over the cap sheet in celtics/data.json. Hard Cap and the NBA hub
   both use it, so a contract fix lands everywhere at once. No DOM, no network. */
(function (root) {
  "use strict";
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

  const NbaContracts = { nameKeys, rosterIndex, nbaTeam, onNbaRoster, mergeContracts, latestContracts, ESPN_POS, posLetter, freeAgency, contractType };
  if (typeof module !== "undefined") module.exports = NbaContracts; else root.NbaContracts = NbaContracts;
})(typeof window !== "undefined" ? window : globalThis);
