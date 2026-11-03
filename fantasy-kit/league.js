/* Fantasy Kit: the season. No DOM and no network, like draft.js.

   A league document holds teams, rosters, weekly lineups, the schedule, results, free agency, waivers, trades and the
   transaction log. Functions take (L, ctx, ...) where ctx = context(L, players, sport, hooks) holds the evaluated
   pool. Scoring is a hook: a league with real box scores passes hooks.score(L, ctx, teamId, week) -> { total, cats };
   without it, weeks are simulated from player values, which is what the demo league uses.

   Formats (settings.format): "h2h", head to head with playoffs, or "guillotine": everyone scores every week, the
   lowest team is chopped and its players go on waivers, and the last team standing wins. settings.bestBall makes
   lineups automatic in either: each week counts the best lineup a roster could have started.

   Everything that changes the league takes `now` (ms) and stays deterministic for the same calls. */
(function (root, factory) {
  const FK = root.FK || {};
  const m = factory(FK.sports || (typeof require !== "undefined" ? require("./sports.js") : null), FK.draft || (typeof require !== "undefined" ? require("./draft.js") : null));
  if (typeof module !== "undefined" && module.exports) module.exports = m;
  else (root.FK = root.FK || {}).league = m;
})(this, function (S, F) {
  "use strict";
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const DAY = 864e5, HOUR = 36e5;
  const rng = F.rng, hash01 = F.hash01;
  function gauss(r) { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // How a season line turns into one week: basketball plays about 3.4 games a week, baseball and football split a season.
  const WEEK = { nba: { pg: 3.4, weeks: 24 }, nfl: { tot: 1 / 17, weeks: 17 }, mlb: { bat: 1 / 26, pit: 1 / 26, weeks: 26 } };
  const COLORS = 12;

  const DEFAULTS = { format: "h2h", bestBall: false, weeks: 14, playoffTeams: 4, faab: 100, minBid: 0, waivers: "faab", waiverHours: 48, waiverAt: null,
    tradeReview: "vote", reviewHours: 24, vetoShare: 0.5, deadline: 11, ir: 1, trades: true, chops: 1 };
  // A guillotine league's own defaults: one season budget, no trades, waivers that run midweek so a chopped roster
  // is back in play for the next week.
  const GUILLOTINE = { faab: 1000, trades: false, waiverAt: 60, playoffTeams: 0, deadline: 0 };

  /* ---------- making a league ---------- */
  function create(opts) {
    const sport = typeof opts.sport === "string" ? S.ALL[opts.sport] : opts.sport;
    const D = opts.draft;
    const given = opts.settings || {};
    const s = Object.assign({}, DEFAULTS, given.format === "guillotine" ? GUILLOTINE : {}, given);
    // a time-bank draft pays out: leftover time sets each team's FAAB, from half the league's budget to one and a half times it
    const share = D && D.bank ? F.bankShare(D) : null;
    const teams = (D ? D.teams : opts.teams).map((t, i) => ({ id: i, name: t.name, abbr: t.abbr, owner: t.owner || null, color: t.color != null ? t.color : (i * 5) % COLORS,
      faab: share ? Math.round(s.faab * (0.5 + share[i])) : s.faab, priority: i }));
    if (share) s.faabBank = true;
    const n = teams.length;
    s.lineup = (opts.lineup || (D && D.lineup) || sport.lineup).slice();
    s.bench = opts.bench != null ? opts.bench : D ? D.bench : sport.bench;
    const guillotine = s.format === "guillotine";
    if (guillotine) { s.chops = Math.max(1, s.chops); s.weeks = Math.ceil((n - 1) / s.chops); s.playoffTeams = 0; s.playoffWeeks = 0; }
    else { s.playoffTeams = Math.min(s.playoffTeams, n - (n % 2)); s.playoffWeeks = Math.ceil(Math.log2(Math.max(2, s.playoffTeams))); }
    const seed = opts.seed != null ? opts.seed : D ? D.seed + 1 : Math.floor(Math.random() * 2 ** 31);
    const rosters = D ? F.rosters(D) : (opts.rosters || teams.map(() => []));
    // waiver priority starts as the reverse of the draft order
    if (D) D.round1.slice().reverse().forEach((id, i) => (teams[id].priority = i));
    const L = {
      v: 1, kind: "fk-league", sport: sport.key, scoring: opts.scoring || (D && D.scoring) || Object.keys(sport.scorings)[0],
      name: opts.name || "Fantasy League", season: opts.season || "", seed, created: opts.now || Date.now(), start: opts.start || opts.now || Date.now(),
      settings: s, teams, rosters: rosters.map((r) => r.slice()), ir: teams.map(() => []), lineups: {},
      schedule: guillotine ? Array.from({ length: s.weeks }, () => []) : roundRobin(n, s.weeks, rng(seed + 7)), results: {}, week: 1,
      tx: [], trades: [], claims: [], waivers: {}, watch: {}, draft: D || null, nextId: 1,
      alive: teams.map((t) => t.id), chopped: [], waiverRuns: {},
    };
    if (D) log(L, D.done || L.created, { type: "draft", team: -1, text: `Draft complete: ${F.made(D).length} picks` });
    return L;
  }

  // Everyone plays everyone, then repeats: the circle method.
  function roundRobin(n, weeks, r) {
    const ids = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    const rounds = [];
    const a = ids.slice();
    if (n % 2) a.push(-1);
    const m = a.length;
    for (let k = 0; k < m - 1; k++) {
      const games = [];
      for (let i = 0; i < m / 2; i++) { const x = a[i], y = a[m - 1 - i]; if (x >= 0 && y >= 0) games.push(k % 2 ? [y, x] : [x, y]); }
      rounds.push(games);
      a.splice(1, 0, a.pop());
    }
    return Array.from({ length: weeks }, (_, w) => rounds[w % rounds.length].map((g) => g.slice()));
  }

  function context(L, players, sport, hooks) {
    sport = sport || S.ALL[L.sport];
    const byId = Object.fromEntries(players.map((p) => [p.id, p]));
    const own = {};
    L.rosters.forEach((ids, t) => ids.forEach((id) => (own[id] = t)));
    const free = players.filter((p) => own[p.id] == null).sort((a, b) => a.rank - b.rank);
    return { sport, players, byId, own, free, hooks: hooks || {} };
  }
  const refresh = (L, ctx) => Object.assign(ctx, context(L, ctx.players, ctx.sport, ctx.hooks));
  const maxRoster = (L) => L.settings.lineup.length + L.settings.bench;
  const isGuillotine = (L) => L.settings.format === "guillotine";
  const isAlive = (L, teamId) => !isGuillotine(L) || (L.alive || []).includes(teamId);
  const totalWeeks = (L) => L.settings.weeks + L.settings.playoffWeeks;
  const weekStart = (L, w) => L.start + (w - 1) * 7 * DAY;
  const log = (L, at, e) => { const x = Object.assign({ id: L.nextId++, at, week: L.week }, e); L.tx.push(x); return x; };

  /* ---------- lineups ---------- */
  function lineupFor(L, ctx, teamId, w) {
    const saved = L.lineups[w] && L.lineups[w][teamId];
    if (L.settings.bestBall && w >= L.week) return projectedBest(L, ctx, teamId);
    const ros = L.rosters[teamId], ir = L.ir[teamId] || [];
    if (saved) return saved.map((id) => (id && ros.includes(id) && !ir.includes(id) ? id : null));
    const ps = ros.filter((id) => !ir.includes(id)).map((id) => ctx.byId[id]).filter((p) => p && !/^(out|ir|o)$/i.test(p.inj || ""));
    return F.assign(ctx.sport, ps, L.settings.lineup).map((p) => (p ? p.id : null));
  }
  function setLineup(L, ctx, teamId, w, slots) {
    if (L.settings.bestBall) return { ok: false, why: "Best ball sets your lineup for you" };
    if (w < L.week) return { ok: false, why: `Week ${w} is locked` };
    const ros = L.rosters[teamId], seen = new Set();
    for (let i = 0; i < L.settings.lineup.length; i++) {
      const id = slots[i];
      if (!id) continue;
      const p = ctx.byId[id];
      if (seen.has(id)) return { ok: false, why: `${p.n} is in two slots` };
      seen.add(id);
      if (!ros.includes(id)) return { ok: false, why: `${p ? p.n : id} isn't on your roster` };
      if (!S.fits(ctx.sport, p, L.settings.lineup[i])) return { ok: false, why: `${p.n} can't play ${L.settings.lineup[i]}` };
    }
    (L.lineups[w] = L.lineups[w] || {})[teamId] = L.settings.lineup.map((_, i) => slots[i] || null);
    return { ok: true };
  }
  // Swap a roster player into a slot (or to the bench): the Yahoo "Move" flow.
  function move(L, ctx, teamId, w, pid, toSlot) {
    const cur = lineupFor(L, ctx, teamId, w).slice();
    const from = cur.indexOf(pid);
    if (toSlot === "BN" || toSlot == null) { if (from >= 0) cur[from] = null; return setLineup(L, ctx, teamId, w, cur); }
    const other = cur[toSlot];
    cur[toSlot] = pid;
    if (from >= 0) cur[from] = other && S.fits(ctx.sport, ctx.byId[other], L.settings.lineup[from]) ? other : null;
    return setLineup(L, ctx, teamId, w, cur);
  }

  const healthy = (L, ctx, teamId) => L.rosters[teamId].filter((id) => !(L.ir[teamId] || []).includes(id)).map((id) => ctx.byId[id]).filter((p) => p && !/^(out|ir|o)$/i.test(p.inj || ""));
  function projectedBest(L, ctx, teamId) { return F.assign(ctx.sport, healthy(L, ctx, teamId), L.settings.lineup).map((p) => (p ? p.id : null)); }
  // Best ball: the best lineup this roster could have started, by what each player actually scored this week. In a
  // category league a player's week counts as his value moved by his form.
  function bestBallIds(L, ctx, teamId, w, frac) {
    const sc = scoring(L, ctx);
    const ps = healthy(L, ctx, teamId).map((p) => {
      const v = sc.type === "points" ? playerWeek(L, ctx, p, w, frac).pts : (p.v || 0) + 0.5 * (formOf(L, p, w) - 1) * Math.max(1, Math.abs(p.v || 0));
      return Object.assign({}, p, { v, _id: p.id });
    });
    return F.assign(ctx.sport, ps, L.settings.lineup).map((p) => (p ? p._id : null));
  }

  /* ---------- scoring ---------- */
  const scoring = (L, ctx) => ctx.sport.scorings[L.scoring] || Object.values(ctx.sport.scorings)[0];

  // One player's simulated week: his line scaled to a week, times a random form factor.
  const formOf = (L, p, w) => Math.max(0.05, 1 + 0.38 * gauss(rng(L.seed * 7 + w * 7919 + hash01(p.id) * 1e6)));
  // How a player is trending: his last two weeks of form.
  const hot = (L, p) => (L.week > 1 ? (formOf(L, p, L.week - 1) + (L.week > 2 ? formOf(L, p, L.week - 2) : 1)) / 2 : 1);
  function playerWeek(L, ctx, p, w, frac = 1) {
    const form = formOf(L, p, w);
    const sc = scoring(L, ctx);
    const wk = WEEK[ctx.sport.key] || { weeks: 20 };
    if (sc.type === "points") return { pts: (p.v / wk.weeks) * form * frac };
    const out = {};
    for (const [line, def] of Object.entries(ctx.sport.data.lines)) {
      if (!p.l[line] || wk[line] == null) continue;
      const f = wk[line] * form * frac;
      out[line] = def.cols.map((c, i) => (/^(avg|obp|ops|era|whip|fg|ft)$/.test(c) ? p.l[line][i] : p.l[line][i] * f));
    }
    return out;
  }
  // A team's week: points of its starters, or each category's total.
  function teamWeek(L, ctx, teamId, w, frac = 1) {
    if (ctx.hooks.score) return ctx.hooks.score(L, ctx, teamId, w, frac);
    const sc = scoring(L, ctx);
    const best = L.settings.bestBall && w >= L.week ? bestBallIds(L, ctx, teamId, w, frac) : null;
    const ids = (best || lineupFor(L, ctx, teamId, w)).filter(Boolean);
    const lines = ids.map((id) => [ctx.byId[id], playerWeek(L, ctx, ctx.byId[id], w, frac)]).filter((x) => x[0]);
    if (sc.type === "points") {
      const players = Object.fromEntries(lines.map(([p, s]) => [p.id, s.pts]));
      return { total: sum(Object.values(players)), players, lineup: best };
    }
    const cats = {};
    for (const c of sc.cats) {
      const line = c.line || "pg";
      const has = lines.filter(([, s]) => s[line]);
      const ix = (col) => ctx.sport.cols[line][col];
      if (c.num) { const n = sum(has.map(([, s]) => s[line][ix(c.num)])), d = sum(has.map(([, s]) => s[line][ix(c.den)])); cats[c.k] = d ? n / d : 0; }
      else if (c.rate) { const wt = sum(has.map(([, s]) => s[line][ix(c.w)])); cats[c.k] = wt ? sum(has.map(([, s]) => s[line][ix(c.rate)] * s[line][ix(c.w)])) / wt : 0; }
      else cats[c.k] = sum(has.map(([, s]) => s[line][ix(c.col)]));
    }
    return { cats, total: null, lineup: best };
  }
  // What a team should score this week with average form.
  function projection(L, ctx, teamId, w) {
    const sc = scoring(L, ctx);
    const wk = WEEK[ctx.sport.key] || { weeks: 20 };
    const ids = lineupFor(L, ctx, teamId, w).filter(Boolean);
    if (sc.type === "points") return { total: sum(ids.map((id) => (ctx.byId[id] ? ctx.byId[id].v / wk.weeks : 0))) };
    return { total: sum(ids.map((id) => (ctx.byId[id] ? ctx.byId[id].v : 0))) };
  }
  function compare(L, ctx, a, b) {
    const sc = scoring(L, ctx);
    if (sc.type === "points") return { sa: a.total, sb: b.total, w: a.total > b.total ? "a" : a.total < b.total ? "b" : "t" };
    let wa = 0, wb = 0, t = 0;
    const cats = {};
    for (const c of sc.cats) {
      const x = a.cats[c.k], y = b.cats[c.k];
      const d = Math.abs(x - y) < 1e-9 ? 0 : (x > y ? 1 : -1) * (c.low ? -1 : 1);
      cats[c.k] = [x, y, d];
      if (d > 0) wa++; else if (d < 0) wb++; else t++;
    }
    return { sa: wa, sb: wb, ties: t, cats, w: wa > wb ? "a" : wa < wb ? "b" : "t" };
  }
  // Every game of a week, final or (for the current week) in progress at `frac` of the week.
  function matchups(L, ctx, w, frac = 1) {
    if (isGuillotine(L)) return [];
    const games = w <= L.settings.weeks ? L.schedule[w - 1] : playoffGames(L, ctx, w);
    return games.map(([a, b], i) => {
      if (L.results[w] && L.results[w][i]) return Object.assign({ a, b, final: true, i }, L.results[w][i]);
      const x = teamWeek(L, ctx, a, w, frac), y = teamWeek(L, ctx, b, w, frac);
      const c = compare(L, ctx, x, y);
      const pa = projection(L, ctx, a, w), pb = projection(L, ctx, b, w);
      return Object.assign({ a, b, final: false, i, live: frac > 0 && frac < 1, frac, ta: x, tb: y, pa: pa.total, pb: pb.total, winProb: winProb(L, ctx, c, pa.total, pb.total, frac) }, c);
    });
  }
  // A simple live win probability: the projected margin shrinks toward the current margin as the week plays out.
  function winProb(L, ctx, c, pa, pb, frac) {
    const sc = scoring(L, ctx);
    if (sc.type === "points") {
      const now = c.sa - c.sb, rest = (pa - pb) * (1 - frac);
      const sd = Math.max(1, (pa + pb) * 0.14 * Math.sqrt(1 - frac + 0.02));
      return 1 / (1 + Math.exp(-((now + rest) / sd) * 1.6));
    }
    const edge = (pa - pb) * (1 - frac) * 0.12 + (c.sa - c.sb) * (0.12 + 0.4 * frac * frac);
    return 1 / (1 + Math.exp(-edge));
  }

  /* ---------- the guillotine ---------- */
  // Every team still alive this week, best to worst, with each one's odds of being chopped. Points leagues rank by
  // points. Category leagues rank like roto: in each category the best team gets n points, the worst gets 1.
  function block(L, ctx, w, frac = 1) {
    if (L.results[w] && L.results[w].block) return L.results[w].block.map((r) => Object.assign({ final: true }, r));
    const sc = scoring(L, ctx);
    const alive = w === L.week ? L.alive.slice() : (L.results[w - 1] && L.results[w - 1].alive) || L.alive.slice();
    const rows = alive.map((t) => { const x = teamWeek(L, ctx, t, w, frac), p = projection(L, ctx, t, w); return { team: t, wk: x, proj: p.total, players: x.players || null, lineup: x.lineup || null }; });
    if (sc.type === "points") rows.forEach((r) => (r.score = r.wk.total));
    else {
      rows.forEach((r) => { r.score = 0; r.cats = {}; });
      for (const c of sc.cats) {
        const sorted = rows.slice().sort((a, b) => (a.wk.cats[c.k] - b.wk.cats[c.k]) * (c.low ? -1 : 1));
        sorted.forEach((r, i) => { r.score += i + 1; r.cats[c.k] = r.wk.cats[c.k]; });
      }
    }
    chopOdds(L, ctx, rows, w, frac, sc.type === "points");
    rows.sort((a, b) => b.score - a.score || b.proj - a.proj);
    rows.forEach((r, i) => { r.rank = i + 1; r.final = false; r.live = frac > 0 && frac < 1; r.frac = frac; delete r.wk; });
    return rows;
  }
  // The chance each team ends the week lowest: what's left of each team's projection plays out with noise, a few
  // hundred times. Category leagues use roster strength as the projection.
  function chopOdds(L, ctx, rows, w, frac, points) {
    const k = L.settings.chops, sims = 500, r = rng(L.seed * 3 + w * 101 + Math.round(frac * 1000));
    const hits = rows.map(() => 0);
    const rest = 1 - frac;
    const zs = (xs) => { const m = sum(xs) / xs.length, d = Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / xs.length) || 1; return xs.map((x) => (x - m) / d); };
    // points: what's banked plus the rest of the projection; categories: standing so far blended with roster strength
    const zScore = points ? null : zs(rows.map((x) => x.score)), zProj = points ? null : zs(rows.map((x) => x.proj));
    const mean = rows.map((x, j) => (points ? x.score + x.proj * rest : frac * zScore[j] + rest * zProj[j]));
    const sd = rows.map((x) => (points ? Math.max(1, x.proj * 0.16 * Math.sqrt(rest + 0.0001)) : 0.15 + 0.9 * Math.sqrt(rest)));
    for (let i = 0; i < sims; i++) {
      const fin = rows.map((x, j) => mean[j] + sd[j] * gauss(r));
      const order = fin.map((v, j) => [v, j]).sort((a, b) => a[0] - b[0]);
      for (let c = 0; c < k && c < order.length - 1; c++) hits[order[c][1]]++;
    }
    rows.forEach((x, j) => (x.chop = frac >= 1 ? null : hits[j] / sims));
  }
  // The week ends: the lowest team is chopped and everything it had goes on waivers until the next waiver run.
  function chop(L, ctx, now) {
    const w = L.week;
    const rows = block(L, ctx, w, 1);
    // settings.immune { team: lastWeek } protects a team through that week (the demo keeps your seat until you arrive)
    const imm = L.settings.immune || {};
    const open = rows.filter((r) => !(imm[r.team] >= w));
    const out = open.slice(-Math.min(L.settings.chops, rows.length - 1)).map((r) => r.team);
    const runAt = L.settings.waiverAt != null ? weekStart(L, w + 1) + L.settings.waiverAt * HOUR : now + L.settings.waiverHours * HOUR;
    L.results[w] = { block: rows.map((r) => ({ team: r.team, score: r.score, proj: r.proj, rank: r.rank, cats: r.cats || null, players: r.players, lineup: r.lineup, out: out.includes(r.team) })), chopped: out, alive: L.alive.slice() };
    for (const t of out) {
      const roster = L.rosters[t].slice();
      const row = rows.find((r) => r.team === t);
      L.chopped.push({ team: t, week: w, score: row.score, at: now, roster, faab: L.teams[t].faab, place: L.alive.length });
      for (const pid of roster) { dropOne(L, t, pid, now); L.waivers[pid] = runAt; }
      L.claims.forEach((c) => { if (c.team === t && c.status === "open") c.status = "cancelled"; });
      L.alive = L.alive.filter((x) => x !== t);
      log(L, now, { type: "chop", team: t, drops: roster, text: `Chopped in week ${w} with ${roster.length} players back on waivers` });
    }
    return out;
  }
  const champion = (L) => (isGuillotine(L) ? (L.alive.length === 1 ? L.alive[0] : null) : null);

  // Closes the current week: results stored, lineups frozen, waivers run, the next week starts.
  function finishWeek(L, ctx, now) {
    const w = L.week;
    if (w > totalWeeks(L)) return { ok: false, why: "The season is over" };
    if (isGuillotine(L)) {
      if (L.alive.length <= 1) return { ok: false, why: "The season is over" };
      L.lineups[w] = L.lineups[w] || {};
      for (const t of L.alive) { const x = teamWeek(L, ctx, t, w, 1); L.lineups[w][t] = x.lineup || lineupFor(L, ctx, t, w); }
      chop(L, ctx, now);
      if (L.alive.length <= 1) log(L, now, { type: "champion", team: L.alive[0], text: "Last team standing" });
      L.week = L.alive.length <= 1 ? totalWeeks(L) + 1 : w + 1;
      if (L.settings.waiverAt == null) runWaivers(L, ctx, now);
      refresh(L, ctx);
      return { ok: true };
    }
    const games = matchups(L, ctx, w, 1);
    L.results[w] = games.map((g) => ({ a: g.a, b: g.b, sa: g.sa, sb: g.sb, ties: g.ties || 0, w: g.w, cats: g.cats || null, ta: g.ta && g.ta.players ? { players: g.ta.players } : null, tb: g.tb && g.tb.players ? { players: g.tb.players } : null }));
    L.lineups[w] = L.lineups[w] || {};
    const best = {};
    if (L.settings.bestBall) for (const g of games) { if (g.ta && g.ta.lineup) best[g.a] = g.ta.lineup; if (g.tb && g.tb.lineup) best[g.b] = g.tb.lineup; }
    for (const t of L.teams) L.lineups[w][t.id] = best[t.id] || lineupFor(L, ctx, t.id, w);
    L.week = w + 1;
    runWaivers(L, ctx, now);
    return { ok: true };
  }

  /* ---------- standings and playoffs ---------- */
  function standings(L, upTo) {
    if (isGuillotine(L)) return survival(L);
    const last = Math.min(upTo || L.settings.weeks, L.settings.weeks);
    const rows = L.teams.map((t) => ({ team: t.id, w: 0, l: 0, t: 0, pf: 0, pa: 0, streak: "", form: [] }));
    for (let w = 1; w <= last; w++) {
      for (const g of L.results[w] || []) {
        const A = rows[g.a], B = rows[g.b];
        A.pf += g.sa; A.pa += g.sb; B.pf += g.sb; B.pa += g.sa;
        if (g.w === "a") { A.w++; B.l++; A.form.push("W"); B.form.push("L"); }
        else if (g.w === "b") { B.w++; A.l++; A.form.push("L"); B.form.push("W"); }
        else { A.t++; B.t++; A.form.push("T"); B.form.push("T"); }
      }
    }
    for (const r of rows) {
      const g = r.w + r.l + r.t;
      r.pct = g ? (r.w + r.t / 2) / g : 0;
      let k = r.form.length - 1, s = r.form[k], n = 0;
      while (k >= 0 && r.form[k] === s) { n++; k--; }
      r.streak = s ? s + n : "";
    }
    const sorted = rows.slice().sort((a, b) => b.pct - a.pct || b.pf - a.pf || a.team - b.team);
    const lead = sorted[0];
    sorted.forEach((r, i) => { r.rank = i + 1; r.gb = ((lead.w - r.w) + (r.l - lead.l)) / 2; r.inPlayoffs = i < L.settings.playoffTeams; });
    return sorted;
  }
  // Guillotine standings: teams still alive by points this season, then the chopped, last one out first.
  function survival(L) {
    const rows = L.teams.map((t) => {
      const weeks = Object.keys(L.results).map(Number).sort((a, b) => a - b).map((w) => (L.results[w].block || []).find((r) => r.team === t.id)).filter(Boolean);
      const c = (L.chopped || []).find((x) => x.team === t.id);
      return { team: t.id, alive: !c, out: c ? c.week : null, place: c ? c.place : null, pf: sum(weeks.map((r) => r.score)), last: weeks.length ? weeks[weeks.length - 1].score : null,
        close: weeks.filter((r, i) => r.rank >= (L.results[i + 1].block.length - 1)).length,
        weeks: weeks.length, w: c ? c.week - 1 : weeks.length, l: c ? 1 : 0, t: 0, pa: 0, pct: 0, streak: "", form: [], gb: 0 };
    });
    const alive = rows.filter((r) => r.alive).sort((a, b) => b.pf - a.pf || a.team - b.team);
    const dead = rows.filter((r) => !r.alive).sort((a, b) => b.out - a.out || b.pf - a.pf);
    const out = alive.concat(dead);
    out.forEach((r, i) => { r.rank = i + 1; r.inPlayoffs = r.alive; });
    return out;
  }
  // Playoff games for a week after the regular season: seeds 1 v 4, 2 v 3 and so on, winners advance.
  function playoffGames(L, ctx, w) {
    const k = w - L.settings.weeks;
    let alive = standings(L).slice(0, L.settings.playoffTeams).map((r) => r.team);
    for (let pw = 1; pw < k; pw++) {
      const res = L.results[L.settings.weeks + pw];
      if (!res) break;
      alive = res.map((g) => (g.w === "b" ? g.b : g.a));
    }
    const games = [];
    for (let i = 0; i < alive.length / 2; i++) games.push([alive[i], alive[alive.length - 1 - i]]);
    return games;
  }
  function bracket(L, ctx) {
    const out = [];
    for (let k = 1; k <= L.settings.playoffWeeks; k++) {
      const w = L.settings.weeks + k;
      if (w > L.week) break;
      out.push({ week: w, round: k === L.settings.playoffWeeks ? "Final" : k === L.settings.playoffWeeks - 1 ? "Semifinals" : `Round ${k}`, games: matchups(L, ctx, w, w < L.week ? 1 : 0) });
    }
    return out;
  }
  // Power rankings: record, points and roster strength together.
  function power(L, ctx) {
    if (isGuillotine(L)) return survival(L).map((r) => ({ team: r.team, rank: r.rank, move: 0, score: r.pf }));
    const st = standings(L);
    const str = L.teams.map((t) => sum(lineupFor(L, ctx, t.id, L.week).filter(Boolean).map((id) => (ctx.byId[id] ? ctx.byId[id].vor : 0))));
    const zs = (xs) => { const m = sum(xs) / xs.length, sd = Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / xs.length) || 1; return xs.map((x) => (x - m) / sd); };
    const byTeam = Object.fromEntries(st.map((r) => [r.team, r]));
    const pct = zs(L.teams.map((t) => byTeam[t.id].pct)), pf = zs(L.teams.map((t) => byTeam[t.id].pf)), s = zs(str);
    const prev = L.prevPower || {};
    const rows = L.teams.map((t, i) => ({ team: t.id, score: 0.4 * pct[i] + 0.25 * pf[i] + 0.35 * s[i] })).sort((a, b) => b.score - a.score);
    rows.forEach((r, i) => { r.rank = i + 1; r.move = prev[r.team] ? prev[r.team] - r.rank : 0; });
    return rows;
  }

  /* ---------- free agency and waivers ---------- */
  const onWaivers = (L, pid, now) => L.waivers[pid] != null && L.waivers[pid] > now;
  function canRoster(L, ctx, teamId, add, drops) {
    if (!isAlive(L, teamId)) return { ok: false, why: "That team has been chopped" };
    const ros = L.rosters[teamId].filter((id) => !(drops || []).includes(id));
    if (ros.length + (add ? 1 : 0) > maxRoster(L) + (L.ir[teamId] || []).length) return { ok: false, why: "Roster is full: pick someone to drop" };
    if (ctx.hooks.check) { const c = ctx.hooks.check(L, teamId, add ? ctx.byId[add] : null, drops, ctx); if (c && !c.ok) return c; }
    return { ok: true };
  }
  function dropOne(L, teamId, pid, now) {
    L.rosters[teamId] = L.rosters[teamId].filter((x) => x !== pid);
    L.ir[teamId] = (L.ir[teamId] || []).filter((x) => x !== pid);
    for (const w of Object.keys(L.lineups)) if (+w >= L.week && L.lineups[w][teamId]) L.lineups[w][teamId] = L.lineups[w][teamId].map((x) => (x === pid ? null : x));
    L.waivers[pid] = now + L.settings.waiverHours * HOUR;
  }
  // A free agent who isn't on waivers: added right away.
  function addDrop(L, ctx, teamId, add, drop, now) {
    if (add && ctx.own[add] != null) return { ok: false, why: `${ctx.byId[add].n} is on a roster` };
    if (add && onWaivers(L, add, now)) return { ok: false, why: `${ctx.byId[add].n} is on waivers: put in a claim` };
    if (drop && !L.rosters[teamId].includes(drop)) return { ok: false, why: "That player isn't on your roster" };
    const ok = canRoster(L, ctx, teamId, add, drop ? [drop] : []);
    if (!ok.ok) return ok;
    if (drop) dropOne(L, teamId, drop, now);
    if (add) { L.rosters[teamId].push(add); delete L.waivers[add]; }
    log(L, now, { type: add && drop ? "add/drop" : add ? "add" : "drop", team: teamId, adds: add ? [add] : [], drops: drop ? [drop] : [] });
    refresh(L, ctx);
    return { ok: true };
  }
  function claim(L, ctx, teamId, add, drop, bid, now) {
    if (ctx.own[add] != null) return { ok: false, why: `${ctx.byId[add].n} is on a roster` };
    bid = Math.max(L.settings.minBid, Math.round(bid || 0));
    if (L.settings.waivers === "faab" && bid > L.teams[teamId].faab) return { ok: false, why: `You have $${L.teams[teamId].faab} of FAAB` };
    const ok = canRoster(L, ctx, teamId, add, drop ? [drop] : []);
    if (!ok.ok) return ok;
    L.claims = L.claims.filter((c) => !(c.team === teamId && c.add === add && c.status === "open"));
    L.claims.push({ id: L.nextId++, team: teamId, add, drop: drop || null, bid, at: now, status: "open" });
    return { ok: true };
  }
  const cancelClaim = (L, id) => { const c = L.claims.find((x) => x.id === id && x.status === "open"); if (!c) return { ok: false, why: "No such claim" }; c.status = "cancelled"; return { ok: true }; };
  // Highest bid wins; ties go to waiver priority. A team that wins moves to the back of the priority line.
  function runWaivers(L, ctx, now) {
    const open = L.claims.filter((c) => c.status === "open").sort((a, b) => b.bid - a.bid || L.teams[a.team].priority - L.teams[b.team].priority || a.at - b.at);
    const won = [];
    for (const c of open) {
      if (c.status !== "open") continue;
      const t = L.teams[c.team];
      const rivals = open.filter((x) => x.add === c.add && x.status === "open");
      if (ctx.own[c.add] != null || (L.settings.waivers === "faab" && c.bid > t.faab) || (c.drop && !L.rosters[c.team].includes(c.drop)) || !canRoster(L, ctx, c.team, c.add, c.drop ? [c.drop] : []).ok) { c.status = "failed"; continue; }
      if (c.drop) dropOne(L, c.team, c.drop, now);
      L.rosters[c.team].push(c.add); delete L.waivers[c.add];
      if (L.settings.waivers === "faab") t.faab -= c.bid;
      c.status = "won";
      for (const x of rivals) if (x !== c) { x.status = "lost"; x.lostTo = c.team; }
      const mx = Math.max(...L.teams.map((x) => x.priority));
      for (const x of L.teams) if (x.priority > t.priority) x.priority--;
      t.priority = mx;
      log(L, now, { type: "waiver", team: c.team, adds: [c.add], drops: c.drop ? [c.drop] : [], faab: L.settings.waivers === "faab" ? c.bid : null, bids: rivals.length });
      refresh(L, ctx);
      won.push(c);
    }
    for (const id of Object.keys(L.waivers)) if (L.waivers[id] <= now) delete L.waivers[id];
    return won;
  }
  // When waivers run this week: settings.waiverAt hours after the week starts, or when the week ends.
  const waiverRunAt = (L, w = L.week) => (L.settings.waiverAt != null ? weekStart(L, w) + L.settings.waiverAt * HOUR : weekStart(L, w + 1));

  /* ---------- trades ---------- */
  // Trade value: auction dollars (at least $1 a player) plus FAAB at a tenth of a dollar per dollar.
  const pValue = (ctx, id) => Math.max(1, (ctx.byId[id] && ctx.byId[id].$) || 0) + Math.max(0, (ctx.byId[id] && ctx.byId[id].vor) || 0) * 0.01;
  const sideValue = (ctx, ids, faab = 0) => sum(ids.map((id) => pValue(ctx, id))) + faab * 0.1;
  function tradeCheck(L, ctx, t) {
    if (L.settings.trades === false) return { ok: false, why: "This league has no trades" };
    if (!isAlive(L, t.from) || !isAlive(L, t.to)) return { ok: false, why: "That team has been chopped" };
    if (t.from === t.to) return { ok: false, why: "Pick another team" };
    if (!t.give.length && !t.get.length) return { ok: false, why: "Add at least one player" };
    if (L.settings.deadline && L.week > L.settings.deadline) return { ok: false, why: `The trade deadline was week ${L.settings.deadline}` };
    for (const id of t.give) if (!L.rosters[t.from].includes(id)) return { ok: false, why: `${ctx.byId[id].n} isn't on ${L.teams[t.from].name}` };
    for (const id of t.get) if (!L.rosters[t.to].includes(id)) return { ok: false, why: `${ctx.byId[id].n} isn't on ${L.teams[t.to].name}` };
    if ((t.faabGive || 0) > L.teams[t.from].faab || (t.faabGet || 0) > L.teams[t.to].faab) return { ok: false, why: "Not enough FAAB" };
    const after = (team, out, inn, drops) => L.rosters[team].length - out.length + inn.length - drops.length;
    if (after(t.from, t.give, t.get, t.dropsFrom || []) > maxRoster(L) + (L.ir[t.from] || []).length) return { ok: false, why: `${L.teams[t.from].name} would have too many players: add a drop` };
    if (after(t.to, t.get, t.give, t.dropsTo || []) > maxRoster(L) + (L.ir[t.to] || []).length) return { ok: false, why: `${L.teams[t.to].name} would have too many players` };
    if (ctx.hooks.tradeCheck) { const c = ctx.hooks.tradeCheck(L, t, ctx); if (c && !c.ok) return c; }
    return { ok: true };
  }
  function propose(L, ctx, from, to, give, get, now, extra = {}) {
    const t = { id: L.nextId++, from, to, give: give.slice(), get: get.slice(), faabGive: extra.faabGive || 0, faabGet: extra.faabGet || 0, dropsFrom: extra.dropsFrom || [], dropsTo: [], note: extra.note || "", at: now, status: "pending", counterOf: extra.counterOf || null };
    const c = tradeCheck(L, ctx, t);
    if (!c.ok) return c;
    if (t.counterOf) { const o = L.trades.find((x) => x.id === t.counterOf); if (o && o.status === "pending") { o.status = "countered"; o.done = now; } }
    L.trades.push(t);
    return { ok: true, trade: t };
  }
  function respond(L, ctx, id, accept, now, why) {
    const t = L.trades.find((x) => x.id === id);
    if (!t || t.status !== "pending") return { ok: false, why: "That offer is no longer open" };
    if (!accept) { t.status = "rejected"; t.done = now; t.why = why || ""; return { ok: true }; }
    const c = tradeCheck(L, ctx, t);
    if (!c.ok) return c;
    if (L.settings.tradeReview === "none") return execute(L, ctx, t, now);
    t.status = "review"; t.accepted = now; t.reviewEnds = now + L.settings.reviewHours * HOUR; t.votes = {};
    return { ok: true, review: true };
  }
  const cancelTrade = (L, id, now) => { const t = L.trades.find((x) => x.id === id && x.status === "pending"); if (!t) return { ok: false, why: "No open offer" }; t.status = "cancelled"; t.done = now; return { ok: true }; };
  const voters = (L, t) => L.teams.filter((x) => x.id !== t.from && x.id !== t.to).map((x) => x.id);
  const vetoesNeeded = (L, t) => Math.max(1, Math.ceil(voters(L, t).length * L.settings.vetoShare));
  function vote(L, ctx, id, teamId, veto, now) {
    const t = L.trades.find((x) => x.id === id && x.status === "review");
    if (!t) return { ok: false, why: "That trade isn't under review" };
    if (!voters(L, t).includes(teamId)) return { ok: false, why: "Teams in the trade can't vote" };
    t.votes[teamId] = veto ? "veto" : "ok";
    if (Object.values(t.votes).filter((v) => v === "veto").length >= vetoesNeeded(L, t)) { t.status = "vetoed"; t.done = now; log(L, now, { type: "veto", team: t.from, other: t.to, trade: t.id }); }
    return { ok: true };
  }
  function finalize(L, ctx, now) {
    let n = 0;
    for (const t of L.trades) if (t.status === "review" && now >= t.reviewEnds) { const r = execute(L, ctx, t, now); if (!r.ok) { t.status = "failed"; t.why = r.why; } n++; }
    return n;
  }
  function execute(L, ctx, t, now) {
    const c = tradeCheck(L, ctx, t);
    if (!c.ok) return c;
    for (const id of t.dropsFrom || []) dropOne(L, t.from, id, now);
    L.rosters[t.from] = L.rosters[t.from].filter((x) => !t.give.includes(x)).concat(t.get);
    L.rosters[t.to] = L.rosters[t.to].filter((x) => !t.get.includes(x)).concat(t.give);
    for (const w of Object.keys(L.lineups)) if (+w >= L.week) { delete (L.lineups[w] || {})[t.from]; delete (L.lineups[w] || {})[t.to]; }
    L.teams[t.from].faab += (t.faabGet || 0) - (t.faabGive || 0);
    L.teams[t.to].faab += (t.faabGive || 0) - (t.faabGet || 0);
    t.status = "accepted"; t.done = now;
    log(L, now, { type: "trade", team: t.from, other: t.to, adds: t.get, drops: t.give, trade: t.id, faab: (t.faabGive || t.faabGet) ? [t.faabGive || 0, t.faabGet || 0] : null });
    refresh(L, ctx);
    return { ok: true };
  }
  // A bot takes a deal that leaves it ahead on value.
  function botAnswer(L, ctx, t) {
    const gets = sideValue(ctx, t.give, t.faabGive), gives = sideValue(ctx, t.get, t.faabGet);
    if (gets >= gives * 1.06 + 1) return { accept: true };
    return { accept: false, why: gives > gets * 1.5 ? "Not even close." : "Close, but not enough coming back." };
  }
  // Bots answer offers to them right away (the demo), or after `delay` ms.
  function botsAnswer(L, ctx, now, delay = 0) {
    let n = 0;
    for (const t of L.trades) {
      if (t.status !== "pending" || L.teams[t.to].owner || now - t.at < delay) continue;
      const a = botAnswer(L, ctx, t);
      respond(L, ctx, t.id, a.accept, now, a.why);
      n++;
    }
    return n;
  }

  /* ---------- bots in season ---------- */
  // Each week a few bots pick up the best free agent who beats their weakest player, and now and then two bots trade.
  function botWeek(L, ctx, now, r) {
    for (const t of L.teams) {
      if (t.owner || !isAlive(L, t.id) || r() > 0.45) continue;
      // Bots chase form: value counts, and so does how a player has played the last two weeks.
      const span = Math.max(1e-6, Math.abs(ctx.players.reduce((m, p) => Math.max(m, p.vor || 0), 0)));
      const heat = (p) => (p.vor || 0) + span * 0.12 * (hot(L, p) - 1) * 3;
      const ros = L.rosters[t.id].map((id) => ctx.byId[id]).filter(Boolean).sort((a, b) => heat(a) - heat(b));
      const worst = ros[0];
      const cand = ctx.free.filter((p) => !onWaivers(L, p.id, now)).slice(0, 40).filter((p) => worst && heat(p) > heat(worst) && S.positions(p).some((x) => S.positions(worst).includes(x) || r() < 0.4));
      if (!cand.length || !worst) continue;
      const p = cand[Math.floor(r() * Math.min(5, cand.length))];
      if (r() < 0.35 && L.settings.waivers === "faab" && t.faab > 0) claim(L, ctx, t.id, p.id, worst.id, Math.min(t.faab, Math.round(r() * 12)), now);
      else addDrop(L, ctx, t.id, p.id, worst.id, now);
    }
    if (r() < 0.3 && L.settings.trades !== false) {
      const bots = L.teams.filter((t) => !t.owner && isAlive(L, t.id));
      if (bots.length >= 2) {
        const a = bots[Math.floor(r() * bots.length)], b = bots.filter((x) => x !== a)[Math.floor(r() * (bots.length - 1))];
        const ra = L.rosters[a.id].slice().sort((x, y) => ctx.byId[y].$ - ctx.byId[x].$), rb = L.rosters[b.id].slice().sort((x, y) => ctx.byId[y].$ - ctx.byId[x].$);
        const ga = ra[2 + Math.floor(r() * 4)], gb = rb[2 + Math.floor(r() * 4)];
        if (ga && gb && Math.abs(pValue(ctx, ga) - pValue(ctx, gb)) < 6) {
          const res = propose(L, ctx, a.id, b.id, [ga], [gb], now);
          if (res.ok) respond(L, ctx, res.trade.id, true, now + 3 * HOUR);
        }
      }
    }
  }
  // Guillotine bots bid on what the chopped team left behind. Each one looks at the players who would start for it
  // over its weakest starter and bids a share of its budget: more for a better player, more as the season runs down
  // (money is worth less late, and there are fewer players left to buy), and a little private taste.
  function botBids(L, ctx, now, r) {
    const pool = Object.keys(L.waivers).filter((id) => L.waivers[id] > now && ctx.own[id] == null).map((id) => ctx.byId[id]).filter(Boolean).sort((a, b) => b.$ - a.$);
    if (!pool.length) return 0;
    const left = Math.max(1, totalWeeks(L) - L.week + 1), late = 1 - left / Math.max(1, totalWeeks(L));
    let n = 0;
    for (const t of L.teams) {
      if (t.owner || !isAlive(L, t.id) || t.faab <= 0) continue;
      const ros = L.rosters[t.id].map((id) => ctx.byId[id]).filter(Boolean);
      const starters = new Set(F.assign(ctx.sport, ros, L.settings.lineup).filter(Boolean).map((p) => p.id));
      const keepers = ros.filter((p) => starters.has(p.id)).sort((a, b) => a.v - b.v);
      const bench = ros.filter((p) => !starters.has(p.id)).sort((a, b) => a.v - b.v);
      let bids = 0;
      for (const p of pool.slice(0, 25)) {
        if (bids >= 4) break;
        const after = F.assign(ctx.sport, ros.filter((q) => q !== (bench[0] || keepers[0])).concat(p), L.settings.lineup).filter(Boolean);
        const gain = sum(after.map((q) => q.v)) - sum(keepers.map((q) => q.v));
        if (gain <= 0 && r() > 0.15) continue;
        const want = Math.min(1, (p.$ || 1) / 45) * (0.06 + 0.8 * late * late) * (0.6 + 0.8 * r());
        const bid = Math.max(L.settings.minBid, Math.min(t.faab, Math.round(t.faab * want)));
        const drop = bench.length ? bench[0] : keepers[0];
        if (!drop) continue;
        const c = claim(L, ctx, t.id, p.id, ros.length >= maxRoster(L) ? drop.id : null, bid, now);
        if (c.ok) { bids++; n++; }
      }
    }
    return n;
  }
  // Moves the league forward: trades past review go through, bots answer offers, and a midweek waiver run happens
  // once its time comes.
  function tick(L, ctx, now) {
    let n = finalize(L, ctx, now);
    n += botsAnswer(L, ctx, now, 0);
    L.waiverRuns = L.waiverRuns || {};
    if (L.settings.waiverAt != null && L.week <= totalWeeks(L) && !L.waiverRuns[L.week] && now >= waiverRunAt(L)) {
      const at = waiverRunAt(L);
      L.waiverRuns[L.week] = at;
      n += runWaivers(L, ctx, at).length;
    }
    return n;
  }

  return { DEFAULTS, WEEK, create, roundRobin, context, refresh, maxRoster, totalWeeks, weekStart, lineupFor, setLineup, move, scoring, playerWeek, teamWeek, projection, compare, matchups, winProb,
    finishWeek, formOf, hot, standings, playoffGames, bracket, power, onWaivers, canRoster, addDrop, claim, cancelClaim, runWaivers, pValue, sideValue, tradeCheck, propose, respond, cancelTrade,
    voters, vetoesNeeded, vote, finalize, execute, botAnswer, botsAnswer, botWeek, tick, log,
    GUILLOTINE, isGuillotine, isAlive, block, chopOdds, chop, champion, survival, waiverRunAt, botBids, bestBallIds };
});
