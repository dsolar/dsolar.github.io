/* NFL cap engine for the NFL Hub: cap hits, dead money, and what every move does to a team's cap, year by year.

   Contracts come in as rows by league year (millions): [base, proration, roster bonus, other bonuses,
   guaranteed salary, cap number, void year, estimated]. Proration is the signing and option bonus money spread
   over the deal (at most five years), which is what turns into dead money when a player leaves.

   The rules (2020 CBA as it stands):
   - Release before June 1: every remaining year's proration and every remaining guarantee counts now.
   - Release after June 1 (or a "post-June 1" designation, two a year): this year keeps only its own proration and
     guarantee; the rest lands next year. This year's savings are bigger, next year pays the difference.
   - Trade: the old team keeps the proration (same June 1 split); guarantees and salary go with the player.
   - Restructure: base salary above the minimum turns into a signing bonus, prorated over the years left (up to
     five, void years added if needed). This year's cap drops; the later years and the dead money go up.
   - Extension: new years at the new average, with a signing bonus prorated over up to five years.
   A move is { kind: "cut" | "cutJune" | "trade" | "tradeJune" | "restructure" | "extend" | "tag", id, year, ... }. */
(function (root) {
  "use strict";
  const C = {};
  const M = 1e6;
  // Base caps (millions). 2026 is official, 2027 is Over The Cap's projection; later years grow 7%.
  C.BASE = { 2026: 301.2, 2027: 327.0 };
  for (let y = 2028; y <= 2034; y++) C.BASE[y] = Math.round(C.BASE[y - 1] * 1.07 * 10) / 10;
  // Minimum salaries by credited seasons (0, 1, 2, 3, 4-6, 7+), millions. 2026 from the CBA schedule; later years
  // step up the way the schedule does.
  const MIN = { 2026: [0.885, 1.005, 1.075, 1.15, 1.22, 1.3] };
  for (let y = 2027; y <= 2034; y++) MIN[y] = MIN[y - 1].map(v => Math.round((v + 0.045) * 1000) / 1000);
  C.minSalary = (exp, y) => (MIN[y] || MIN[2034])[Math.min(5, exp >= 7 ? 5 : exp >= 4 ? 4 : Math.max(0, exp))];

  const R = { base: 0, pr: 1, rb: 2, oth: 3, gtd: 4, cap: 5, void: 6, est: 7 };
  C.R = R;
  const rowsOf = p => (p && p.c && p.c.rows) || {};
  const yearsOf = p => Object.keys(rowsOf(p)).map(Number).sort((a, b) => a - b);
  const row = (p, y) => rowsOf(p)[y] || null;
  C.capHit = (p, y) => { const r = row(p, y); return r ? r[R.cap] : 0; };
  C.lastYear = p => { const ys = yearsOf(p).filter(y => !row(p, y)[R.void]); return ys.length ? ys[ys.length - 1] : null; };
  C.voidYears = p => yearsOf(p).filter(y => row(p, y)[R.void]);
  C.yearsLeft = (p, y) => yearsOf(p).filter(k => k >= y && !row(p, k)[R.void]).length;
  // Proration and guarantees from a year on
  const sumFrom = (p, y, i, strict) => yearsOf(p).filter(k => (strict ? k > y : k >= y)).reduce((a, k) => a + row(p, k)[i], 0);
  C.prorationLeft = (p, y) => sumFrom(p, y, R.pr);
  C.guaranteeLeft = (p, y) => yearsOf(p).filter(k => k >= y && !row(p, k)[R.void]).reduce((a, k) => a + row(p, k)[R.gtd], 0);
  // A player's own cash due this year that isn't proration: what leaves with him in a trade
  const salaryPart = r => r[R.base] + r[R.rb] + r[R.oth];

  // What a move does: per-year changes to this team's cap ({year: delta}, negative = savings), dead money it creates,
  // and what the other team takes on in a trade
  C.effect = (p, mv) => {
    const y = mv.year, r0 = row(p, y), out = { delta: {}, dead: {}, other: {}, notes: [] };
    const add = (o, k, v) => { if (Math.abs(v) > 1e-6) o[k] = (o[k] || 0) + v; };
    const ys = yearsOf(p).filter(k => k >= y);
    // A deal that has run out: re-sign him (new years at the new average, a 35% signing bonus spread up to five
    // years) or put the franchise tag on him for one year
    if (mv.kind === "resign") {
      const addY = mv.years || 3, apy = mv.apy || 0, bonus = apy * addY * 0.35, n = Math.min(5, addY);
      for (let k = y; k < y + addY; k++) add(out.delta, k, apy - bonus / addY);
      for (let k = y; k < y + n; k++) add(out.delta, k, bonus / n);
      out.bonus = bonus; return out;
    }
    if (mv.kind === "tag") { add(out.delta, y, mv.amount || 0); return out; }
    if (!r0) { out.notes.push("No contract in " + y + "."); return out; }
    if (mv.kind === "cut" || mv.kind === "cutJune" || mv.kind === "trade" || mv.kind === "tradeJune") {
      const june = mv.kind === "cutJune" || mv.kind === "tradeJune", trade = mv.kind.startsWith("trade");
      for (const k of ys) add(out.delta, k, -row(p, k)[R.cap]);                       // his cap numbers come off
      const prNow = june ? row(p, y)[R.pr] : C.prorationLeft(p, y);
      const prNext = june ? sumFrom(p, y, R.pr, true) : 0;
      const gNow = trade ? 0 : june ? row(p, y)[R.gtd] : C.guaranteeLeft(p, y);
      const gNext = trade ? 0 : june ? yearsOf(p).filter(k => k > y && !row(p, k)[R.void]).reduce((a, k) => a + row(p, k)[R.gtd], 0) : 0;
      add(out.dead, y, prNow + gNow); add(out.delta, y, prNow + gNow);
      if (prNext + gNext > 0) { add(out.dead, y + 1, prNext + gNext); add(out.delta, y + 1, prNext + gNext); }
      if (trade) for (const k of ys) if (!row(p, k)[R.void]) add(out.other, k, salaryPart(row(p, k)));
      return out;
    }
    if (mv.kind === "restructure") {
      const min = C.minSalary(p.exp || 0, y), room = Math.max(0, r0[R.base] - min);
      const amt = Math.min(mv.amount != null ? mv.amount : room, room);
      const real = C.yearsLeft(p, y), n = Math.max(1, Math.min(5, mv.voids ? 5 : real));
      if (amt <= 0) { out.notes.push("No base salary above the minimum to convert."); return out; }
      const per = amt / n;
      add(out.delta, y, -amt);
      for (let k = y; k < y + n; k++) add(out.delta, k, per);
      out.converted = amt; out.over = n; out.addsVoid = Math.max(0, n - real);
      return out;
    }
    if (mv.kind === "extend") {
      // new years at the new average; a signing bonus (default 35% of new money) prorated over up to five years,
      // with this year's base above the minimum folded in when lowerNow is set
      const addY = mv.years || 3, apy = mv.apy, last = C.lastYear(p) || y;
      const newMoney = apy * addY, bonus = mv.bonus != null ? mv.bonus : newMoney * 0.35;
      const conv = mv.lowerNow ? Math.max(0, r0[R.base] - C.minSalary(p.exp || 0, y)) : 0;
      const n = Math.min(5, C.yearsLeft(p, y) + addY), per = (bonus + conv) / n;
      add(out.delta, y, -conv);
      for (let k = y; k < y + n; k++) add(out.delta, k, per);
      for (let k = last + 1; k <= last + addY; k++) add(out.delta, k, apy - bonus / addY);
      out.bonus = bonus; out.over = n; out.newYears = [last + 1, last + addY];
      return out;
    }
    return out;
  };

  // Team cap by year: the base cap plus carryover (Over The Cap's team figure for 2026 and 2027), dead money already
  // on the books, every contract, and the moves. Our own contract sums are pinned to Over The Cap's for those two
  // years (in season, practice squad and midseason signings make the raw sums run a little high).
  C.teamYears = (W, code, moves, from, to) => {
    const tc = W.teamcap || {}, out = [];
    const ps = W.players.filter(p => p.t === code);
    for (let y = from; y <= to; y++) {
      const otc = tc.years && tc.years[y] && tc.years[y][code];
      const ours = ps.reduce((a, p) => a + C.capHit(p, y), 0);
      const cap = otc ? otc.teamCap / M : C.BASE[y];
      const dead = otc ? otc.dead / M : 0;
      const pin = otc ? otc.active / M - ours : 0;
      const rookies = W.rookieCost && y > W.season ? W.rookieCost(code, y) : 0;
      out.push({ y, cap, dead, active: ours + pin, ours, pin, rookies, space: cap - dead - ours - pin - rookies, moves: 0, newDead: 0 });
    }
    for (const mv of moves || []) {
      const p = W.byId[mv.id];
      if (!p) continue;
      const e = C.effect(p, mv);
      for (const r of out) {
        const d = e.delta[r.y] || 0, nd = e.dead[r.y] || 0;
        r.moves += d; r.newDead += nd; r.space -= d;
      }
      if (mv.kind.startsWith("trade") && mv.to) {
        /* the other team's cap is changed when its own sheet is built */
      }
    }
    return out;
  };

  // A whole roster's commitments by year (for the cap sheet)
  C.sheet = (W, code, from, to) => W.players.filter(p => p.t === code && p.c).map(p => {
    const yrs = {};
    for (let y = from; y <= to; y++) { const r = row(p, y); if (r) yrs[y] = r; }
    return { p, yrs, cap: C.capHit(p, from) };
  }).filter(x => Object.keys(x.yrs).length).sort((a, b) => b.cap - a.cap);

  // "Cap credit card": proration already pushed into future years (what's owed if everyone were gone), and the part
  // sitting in void years, money that only exists to lower today's cap
  C.creditCard = (W, code, y) => {
    let future = 0, voids = 0;
    for (const p of W.players.filter(q => q.t === code && q.c)) {
      for (const k of yearsOf(p)) if (k > y) { future += row(p, k)[R.pr]; if (row(p, k)[R.void]) voids += row(p, k)[R.pr]; }
    }
    return { future, voids };
  };

  C.newWorld = (league, teamcap) => {
    const W = { season: league.season, players: league.players, depth: league.depth || {}, teamcap: teamcap || null, byId: {} };
    for (const p of W.players) W.byId[p.id] = p;
    return W;
  };

  if (typeof module !== "undefined" && module.exports) module.exports = C;
  root.NFLCap = C;
})(typeof window !== "undefined" ? window : globalThis);
