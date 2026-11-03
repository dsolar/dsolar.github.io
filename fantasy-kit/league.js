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
    tradeReview: "vote", reviewHours: 24, vetoShare: 0.5, deadline: 11, ir: 1, trades: true, chops: 1, offerHours: 48 };
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
    else if (s.format === "roto") { s.playoffTeams = 0; s.playoffWeeks = 0; }
    else { s.playoffTeams = Math.min(s.playoffTeams, n); s.playoffTeams = s.playoffTeams >= 2 ? s.playoffTeams : 0; s.playoffWeeks = planOf(s).reduce((a, rd) => a + rd.weeks.length, 0); }
    const seed = opts.seed != null ? opts.seed : D ? D.seed + 1 : Math.floor(Math.random() * 2 ** 31);
    const rosters = D ? F.rosters(D) : (opts.rosters || teams.map(() => []));
    // waiver priority starts as the reverse of the draft order
    if (D) D.round1.slice().reverse().forEach((id, i) => (teams[id].priority = i));
    const L = {
      v: 1, kind: "fk-league", sport: sport.key, scoring: opts.scoring || (D && D.scoring) || Object.keys(sport.scorings)[0],
      name: opts.name || "Fantasy League", season: opts.season || "", seed, created: opts.now || Date.now(), start: opts.start || opts.now || Date.now(),
      settings: s, teams, rosters: rosters.map((r) => r.slice()), ir: teams.map(() => []), lineups: {},
      schedule: guillotine || s.format === "roto" ? Array.from({ length: s.weeks }, () => []) : roundRobin(n, s.weeks, rng(seed + 7)), results: {}, week: 1,
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
  // Rotisserie: no weekly games; season totals in each category, ranked, the best team getting n points.
  const isRoto = (L) => L.settings.format === "roto";
  const isAlive = (L, teamId) => !isGuillotine(L) || (L.alive || []).includes(teamId);
  const totalWeeks = (L) => L.settings.weeks + L.settings.playoffWeeks;
  const weekStart = (L, w) => L.start + (w - 1) * 7 * DAY;
  const log = (L, at, e) => { const x = Object.assign({ id: L.nextId++, at, week: L.week }, e); L.tx.push(x); return x; };

  /* ---------- moves during a week ---------- */
  // How far into the current week `now` is, 0 to 1.
  const weekFrac = (L, now) => Math.max(0, Math.min(1, (now - weekStart(L, L.week)) / (7 * DAY)));
  // A player who joins a team mid-week only scores the rest of that week for it.
  function joined(L, teamId, pid, now) { (L.joined = L.joined || {})[pid] = { team: teamId, week: L.week, f: weekFrac(L, now) }; }
  function effFrac(L, teamId, pid, w, frac) {
    const j = L.joined && L.joined[pid];
    const gone = L.left && L.left[w] && L.left[w][teamId] && L.left[w][teamId][pid];
    const upTo = gone != null && !(j && j.team === teamId && j.week === w && j.f >= gone) ? Math.min(frac, gone) : frac;
    return j && j.team === teamId && j.week === w ? Math.max(0, upTo - j.f) : upTo;
  }
  // A player who leaves a lineup mid-week (dropped, traded, put on IR) keeps the points he'd already scored for it.
  function bank(L, ctx, teamId, pid, now) {
    if (L.week > totalWeeks(L) || !ctx.byId[pid] || scoring(L, ctx).type !== "points") return;
    const w = L.week, f = weekFrac(L, now);
    if (f <= 0) return;
    if (L.settings.bestBall) {                              // best ball picks the lineup at the end, so he stays a candidate
      ((((L.left = L.left || {})[w] = L.left[w] || {})[teamId] = L.left[w][teamId] || {}))[pid] = f;
      return;
    }
    const counting = lineupFor(L, ctx, teamId, w);
    if (!counting.includes(pid)) return;
    const pts = playerWeek(L, ctx, ctx.byId[pid], w, effFrac(L, teamId, pid, w, f), f).pts;
    const b = (((L.banked = L.banked || {})[w] = L.banked[w] || {})[teamId] = L.banked[w][teamId] || {});
    b[pid] = (b[pid] || 0) + pts;
  }

  /* ---------- lineups ---------- */
  function lineupFor(L, ctx, teamId, w) {
    const saved = L.lineups[w] && L.lineups[w][teamId];
    if (L.settings.bestBall && w >= L.week) return projectedBest(L, ctx, teamId);
    const ros = L.rosters[teamId], ir = L.ir[teamId] || [];
    if (saved) return saved.map((id) => (id && ros.includes(id) && !ir.includes(id) ? id : null));
    return fillLineup(L, ctx, teamId).map((p) => (p ? p.id : null));
  }
  function setLineup(L, ctx, teamId, w, slots, now) {
    if (L.settings.bestBall) return { ok: false, why: "Best ball sets your lineup for you" };
    if (lineupLocked(L, w, now)) return { ok: false, why: `Week ${w} is locked` };
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
  function move(L, ctx, teamId, w, pid, toSlot, now) {
    const cur = lineupFor(L, ctx, teamId, w).slice();
    const from = cur.indexOf(pid);
    if (toSlot === "BN" || toSlot == null) { if (from >= 0) cur[from] = null; return setLineup(L, ctx, teamId, w, cur, now); }
    const other = cur[toSlot];
    cur[toSlot] = pid;
    if (from >= 0) cur[from] = other && S.fits(ctx.sport, ctx.byId[other], L.settings.lineup[from]) ? other : null;
    return setLineup(L, ctx, teamId, w, cur, now);
  }

  const healthy = (L, ctx, teamId) => L.rosters[teamId].filter((id) => !(L.ir[teamId] || []).includes(id)).map((id) => ctx.byId[id]).filter((p) => p && !/^(out|ir|o)$/i.test(p.inj || ""));
  // How many lineup slots a set of players can't fill with healthy players (IR doesn't count).
  function holes(L, ctx, teamId, ids) {
    const ir = L.ir[teamId] || [];
    const ps = ids.filter((id) => !ir.includes(id)).map((id) => ctx.byId[id]).filter((p) => p && !/^(out|ir|o)$/i.test(p.inj || ""));
    return F.assign(ctx.sport, ps, L.settings.lineup).filter((x) => !x).length;
  }
  function projectedBest(L, ctx, teamId) { return F.assign(ctx.sport, healthy(L, ctx, teamId), L.settings.lineup).map((p) => (p ? p.id : null)); }
  // The best lineup of healthy players, with any slot still open filled by a hurt player who fits (better than empty).
  function fillLineup(L, ctx, teamId) {
    const slots = L.settings.lineup, ir = L.ir[teamId] || [];
    const first = F.assign(ctx.sport, healthy(L, ctx, teamId), slots);
    const used = new Set(first.filter(Boolean).map((p) => p.id));
    const hurt = L.rosters[teamId].filter((id) => !ir.includes(id) && !used.has(id)).map((id) => ctx.byId[id]).filter(Boolean).sort((a, b) => (b.v || 0) - (a.v || 0));
    for (let i = 0; i < slots.length; i++) {
      if (first[i]) continue;
      const k = hurt.findIndex((p) => S.fits(ctx.sport, p, slots[i]));
      if (k >= 0) first[i] = hurt.splice(k, 1)[0];
    }
    return first;
  }
  // Best ball: the best lineup this roster could have started, by what each player actually scored this week. In a
  // category league a player's week counts as his value moved by his form.
  function bestBallIds(L, ctx, teamId, w, frac) {
    const sc = scoring(L, ctx);
    const leavers = Object.keys((L.left && L.left[w] && L.left[w][teamId]) || {}).filter((id) => !L.rosters[teamId].includes(id) || (L.ir[teamId] || []).includes(id)).map((id) => ctx.byId[id]).filter(Boolean);
    const ps = healthy(L, ctx, teamId).concat(leavers).map((p) => {
      const v = sc.type === "points" ? playerWeek(L, ctx, p, w, effFrac(L, teamId, p.id, w, frac), frac).pts : (p.v || 0) + 0.5 * (formOf(L, p, w) - 1) * Math.max(1, Math.abs(p.v || 0));
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
  /* ---------- real box scores ---------- */
  // A league scored on real games (settings.real) reads each week's totals from hooks.real, the weekly file
  // (fantasy-kit/data/weeks-<sport>.json): the data week that starts within two days of the league week. A week
  // the data doesn't have yet counts as no games played, never as made-up stats.
  function realWeek(L, ctx, w) {
    const R = ctx.hooks && ctx.hooks.real;
    if (!L.settings.real || !R || !R.weeks) return null;
    if (ctx._rwOf !== R) { ctx._rw = {}; ctx._rwOf = R; }
    if (w in ctx._rw) return ctx._rw[w];
    const t = weekStart(L, w);
    const hit = Object.values(R.weeks).find((x) => Math.abs(Date.parse(x.start + "T12:00:00Z") - t) < 2.5 * DAY);
    return (ctx._rw[w] = hit || { lines: {}, final: false, missing: true });
  }
  // Can the week close? Its time is up, and in a real league the data has the whole week (or it's three days late,
  // so a broken feed can't stall the season forever).
  function canFinish(L, ctx, now) {
    const end = weekStart(L, L.week + 1);
    if (L.week > totalWeeks(L) || now < end) return false;
    const rw = realWeek(L, ctx, L.week);
    return !rw || !!rw.final || now >= end + 3 * DAY;
  }
  // Once a week's time is up its lineups are locked, even while the league waits for the last box scores.
  const lineupLocked = (L, w, now) => w < L.week || (now != null && now >= weekStart(L, w + 1));
  const realPts = (R, sc, line) => {
    const at = (k) => { const d = k.indexOf("."); if (d > 0 && k.slice(0, d) !== R.line) return 0; const i = R.cols.indexOf(d > 0 ? k.slice(d + 1) : k); return i >= 0 ? line[i] || 0 : 0; };
    return sc.weights ? sum(Object.entries(sc.weights).map(([k, x]) => at(k) * x)) : at(sc.col);
  };
  function playerWeek(L, ctx, p, w, frac = 1, whole) {
    const form = formOf(L, p, w);
    const sc = scoring(L, ctx);
    const rw = realWeek(L, ctx, w);
    if (rw) {
      // the box score so far; a player who joined or left midweek counts for his share of it
      const R = ctx.hooks.real, line = rw.lines[p.id];
      const share = whole > 0 ? Math.max(0, Math.min(1, frac / whole)) : frac > 0 ? 1 : 0;
      if (sc.type === "points") return { pts: line ? realPts(R, sc, line) * share : 0, real: true };
      const out = {};
      for (const [key, def] of Object.entries(ctx.sport.data.lines)) {
        if (key !== R.line && !(def.cols.every((c) => R.cols.includes(c)))) continue;
        out[key] = def.cols.map((c) => { const i = R.cols.indexOf(c); const v = line && i >= 0 ? line[i] || 0 : 0; return /^(avg|obp|ops|era|whip|fg|ft)$/.test(c) ? v : v * share; });
      }
      return out;
    }
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
    const lines = ids.map((id) => [ctx.byId[id], ctx.byId[id] && playerWeek(L, ctx, ctx.byId[id], w, effFrac(L, teamId, id, w, frac), frac)]).filter((x) => x[0]);
    if (sc.type === "points") {
      const players = Object.fromEntries(lines.map(([p, s]) => [p.id, s.pts]));
      const banked = (L.banked && L.banked[w] && L.banked[w][teamId]) || {};
      for (const [id, v] of Object.entries(banked)) players[id] = (players[id] || 0) + v;
      return { total: sum(Object.values(players)), players, lineup: best, banked: Object.keys(banked) };
    }
    const cats = {}, parts = {};
    for (const c of sc.cats) {
      const line = c.line || "pg";
      const has = lines.filter(([, s]) => s[line]);
      const ix = (col) => ctx.sport.cols[line][col];
      if (c.num) { const n = sum(has.map(([, s]) => s[line][ix(c.num)])), d = sum(has.map(([, s]) => s[line][ix(c.den)])); cats[c.k] = d ? n / d : 0; parts[c.k] = [n, d]; }
      else if (c.rate) { const wt = sum(has.map(([, s]) => s[line][ix(c.w)])), x = sum(has.map(([, s]) => s[line][ix(c.rate)] * s[line][ix(c.w)])); cats[c.k] = wt ? x / wt : 0; parts[c.k] = [x, wt]; }
      else cats[c.k] = sum(has.map(([, s]) => s[line][ix(c.col)]));
    }
    return { cats, parts, total: null, lineup: best };
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
    // compare what the page shows: counting stats to a tenth, rates to three places, so 0.0 vs 0.0 is a tie
    const shown = (c, v) => (c.fmt ? +String(c.fmt(v)).replace(/[^0-9.-]/g, "") : c.num || c.rate ? Math.round(v * 1000) / 1000 : Math.round(v * 10) / 10);
    for (const c of sc.cats) {
      const x = a.cats[c.k], y = b.cats[c.k];
      const sx = shown(c, x), sy = shown(c, y);
      const d = sx === sy ? 0 : (sx > sy ? 1 : -1) * (c.low ? -1 : 1);
      cats[c.k] = [x, y, d];
      if (d > 0) wa++; else if (d < 0) wb++; else t++;
    }
    return { sa: wa, sb: wb, ties: t, cats, w: wa > wb ? "a" : wa < wb ? "b" : "t" };
  }
  // Every game of a week, final or (for the current week) in progress at `frac` of the week.
  function matchups(L, ctx, w, frac = 1) {
    if (isGuillotine(L) || isRoto(L)) return [];
    const games = w <= L.settings.weeks ? L.schedule[w - 1] : playoffGames(L, ctx, w);
    return games.map((pair, i) => {
      const [a, b] = pair, kind = pair.kind || (w > L.settings.weeks ? "title" : null);
      if (L.results[w] && L.results[w][i]) return Object.assign({ a, b, final: true, i, kind }, L.results[w][i]);
      const x = teamWeek(L, ctx, a, w, frac), y = teamWeek(L, ctx, b, w, frac);
      const c = compare(L, ctx, x, y);
      const pa = projection(L, ctx, a, w), pb = projection(L, ctx, b, w);
      return Object.assign({ a, b, final: false, i, kind, live: frac > 0 && frac < 1, frac, ta: x, tb: y, pa: pa.total, pb: pb.total, winProb: winProb(L, ctx, c, pa.total, pb.total, frac) }, c);
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
    if (frac <= 0) rows.forEach((r) => (r.score = 0));          // nobody has played: rank by projection
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
  // After the final: open offers and claims close, so nothing is left hanging over the champion.
  function closeSeason(L, now) {
    for (const t of L.trades) if (t.status === "pending" || t.status === "review") { t.status = "expired"; t.done = now; }
    for (const c of L.claims) if (c.status === "open") { c.status = "cancelled"; c.done = now; }
  }
  const champion = (L) => (isGuillotine(L) ? (L.alive.length === 1 ? L.alive[0] : null) : null);

  // Closes the current week: results stored, lineups frozen, waivers run, the next week starts.
  function finishWeek(L, ctx, now) {
    const w = L.week;
    if (w > totalWeeks(L)) return { ok: false, why: "The season is over" };
    if (isRoto(L)) {
      // every team's week in each category, with the parts of the rate stats, so season totals add up exactly
      const sc = scoring(L, ctx);
      L.lineups[w] = L.lineups[w] || {};
      const teams = {};
      for (const t of L.teams) {
        const x = teamWeek(L, ctx, t.id, w, 1);
        teams[t.id] = { cats: x.cats || {}, parts: x.parts || {} };
        L.lineups[w][t.id] = x.lineup || lineupFor(L, ctx, t.id, w);
      }
      L.results[w] = { roto: teams, cats: sc.cats.map((c) => ({ k: c.k, low: !!c.low, ratio: !!(c.num || c.rate) })) };
      L.week = w + 1;
      if (L.week > totalWeeks(L)) { closeSeason(L, now); return { ok: true, over: true }; }
      runWaivers(L, ctx, now);
      return { ok: true };
    }
    if (isGuillotine(L)) {
      if (L.alive.length <= 1) return { ok: false, why: "The season is over" };
      L.lineups[w] = L.lineups[w] || {};
      for (const t of L.alive) { const x = teamWeek(L, ctx, t, w, 1); L.lineups[w][t] = x.lineup || lineupFor(L, ctx, t, w); }
      chop(L, ctx, now);
      if (L.alive.length <= 1) log(L, now, { type: "champion", team: L.alive[0], text: "Last team standing" });
      L.week = L.alive.length <= 1 ? totalWeeks(L) + 1 : w + 1;
      if (L.week > totalWeeks(L)) { closeSeason(L, now); return { ok: true, over: true }; }
      if (L.settings.waiverAt == null) runWaivers(L, ctx, now);
      refresh(L, ctx);
      return { ok: true };
    }
    const games = matchups(L, ctx, w, 1);
    L.results[w] = games.map((g) => ({ a: g.a, b: g.b, kind: g.kind || undefined, sa: g.sa, sb: g.sb, ties: g.ties || 0, w: g.w, cats: g.cats || null, ta: g.ta && g.ta.players ? { players: g.ta.players } : null, tb: g.tb && g.tb.players ? { players: g.tb.players } : null }));
    L.lineups[w] = L.lineups[w] || {};
    const best = {};
    if (L.settings.bestBall) for (const g of games) { if (g.ta && g.ta.lineup) best[g.a] = g.ta.lineup; if (g.tb && g.tb.lineup) best[g.b] = g.tb.lineup; }
    for (const t of L.teams) L.lineups[w][t.id] = best[t.id] || lineupFor(L, ctx, t.id, w);
    L.week = w + 1;
    if (L.week > totalWeeks(L)) { closeSeason(L, now); return { ok: true, over: true }; }
    runWaivers(L, ctx, now);
    return { ok: true };
  }

  /* ---------- standings and playoffs ---------- */
  function standings(L, upTo, live) {
    if (isGuillotine(L)) return survival(L);
    if (isRoto(L)) return rotoStandings(L, upTo, live);
    const last = Math.min(upTo || L.settings.weeks, L.settings.weeks);
    const rows = L.teams.map((t) => ({ team: t.id, w: 0, l: 0, t: 0, pf: 0, pa: 0, streak: "", form: [] }));
    const tally = L.settings.tally || "game";
    for (let w = 1; w <= last; w++) {
      const res = L.results[w] || [];
      for (const g of res) {
        const A = rows[g.a], B = rows[g.b];
        A.pf += g.sa; A.pa += g.sb; B.pf += g.sb; B.pa += g.sa;
        const fa = g.w === "a" ? "W" : g.w === "b" ? "L" : "T";
        A.form.push(fa); B.form.push(fa === "W" ? "L" : fa === "L" ? "W" : "T");
        // each category counts: a 6-3 week is six wins and three losses
        if (tally === "cats") { A.w += g.sa; A.l += g.sb; B.w += g.sb; B.l += g.sa; A.t += g.ties || 0; B.t += g.ties || 0; }
        else if (tally !== "allplay") {
          if (g.w === "a") { A.w++; B.l++; } else if (g.w === "b") { B.w++; A.l++; } else { A.t++; B.t++; }
        }
      }
      // all-play: every team's score against every other team's that week
      if (tally === "allplay") {
        const sc = res.flatMap((g) => [[g.a, g.sa], [g.b, g.sb]]);
        for (const [t, x] of sc) for (const [u, y] of sc) { if (t === u) continue; if (x > y) rows[t].w++; else if (x < y) rows[t].l++; else rows[t].t++; }
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
  // Rotisserie standings: each category's season total ranked across the league (n points for the best, 1 for the
  // worst, ties split), added up. `live` is { week: teamWeek rows } for the week in progress, or null.
  function rotoStandings(L, upTo, live) {
    const last = Math.min(upTo || L.settings.weeks, L.settings.weeks);
    const n = L.teams.length;
    let cats = null;
    const tot = L.teams.map(() => ({}));
    const addWeek = (wk, defs) => {
      cats = cats || defs;
      for (const t of L.teams) {
        const x = wk[t.id] || { cats: {}, parts: {} };
        for (const c of defs) {
          const acc = tot[t.id][c.k] || (tot[t.id][c.k] = c.ratio ? [0, 0] : 0);
          if (c.ratio) { const pt = x.parts[c.k] || [0, 0]; acc[0] += pt[0]; acc[1] += pt[1]; } else tot[t.id][c.k] = acc + (x.cats[c.k] || 0);
        }
      }
    };
    for (let w = 1; w <= last; w++) if (L.results[w] && L.results[w].roto) addWeek(L.results[w].roto, L.results[w].cats);
    if (live && live.rows) addWeek(live.rows, live.cats);
    cats = cats || [];
    const rows = L.teams.map((t) => {
      const v = {};
      for (const c of cats) { const a = tot[t.id][c.k]; v[c.k] = c.ratio ? (a && a[1] ? a[0] / a[1] : 0) : a || 0; }
      return { team: t.id, vals: v, catPts: {}, pts: 0, w: 0, l: 0, t: 0, pa: 0, form: [], streak: "" };
    });
    for (const c of cats) {
      const sorted = rows.slice().sort((a, b) => (a.vals[c.k] - b.vals[c.k]) * (c.low ? -1 : 1));   // worst first
      for (let i = 0; i < sorted.length;) {
        let j = i; while (j + 1 < sorted.length && Math.abs(sorted[j + 1].vals[c.k] - sorted[i].vals[c.k]) < 1e-9) j++;
        const pts = (i + 1 + j + 1) / 2;                                        // ties split the points
        for (let k = i; k <= j; k++) { sorted[k].catPts[c.k] = pts; sorted[k].pts += pts; }
        i = j + 1;
      }
    }
    const out = rows.sort((a, b) => b.pts - a.pts || a.team - b.team);
    out.forEach((r, i) => { r.rank = i + 1; r.pf = r.pts; r.pct = n > 1 ? r.pts / (cats.length * n || 1) : 0; r.gb = out[0].pts - r.pts; r.inPlayoffs = false; });
    return out;
  }
  // The week in progress, for live roto standings.
  function rotoLive(L, ctx, frac) {
    if (!isRoto(L) || L.week > totalWeeks(L)) return null;
    const sc = scoring(L, ctx);
    const rows = {};
    for (const t of L.teams) { const x = teamWeek(L, ctx, t.id, L.week, frac); rows[t.id] = { cats: x.cats || {}, parts: x.parts || {} }; }
    return { rows, cats: sc.cats.map((c) => ({ k: c.k, low: !!c.low, ratio: !!(c.num || c.rate) })) };
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
  /* Playoffs. settings.playoffTeams can be any number from 2 up: when it isn't a power of two the top seeds get
     byes. settings.playoffLegs: "1" (a week a round), "final2" (a two-week final), "all2" (every round two weeks,
     scores added up). settings.consolation: "none", "third" (the semifinal losers play for third) or "bracket" (the
     best of the teams that missed play their own bracket, finishing the same week as the final). Ties in a round go
     to the higher seed. */
  const ROUNDS = (R, r) => (r === R ? "Final" : r === R - 1 ? "Semifinals" : r === R - 2 ? "Quarterfinals" : `Round ${r}`);
  function planOf(s) {
    const m = s.playoffTeams || 0;
    if (m < 2) return [];
    const R = Math.ceil(Math.log2(m)), out = [];
    let w = s.weeks + 1;
    for (let r = 1; r <= R; r++) {
      const legs = s.playoffLegs === "all2" || (s.playoffLegs === "final2" && r === R) ? 2 : 1;
      out.push({ round: r, name: ROUNDS(R, r), weeks: Array.from({ length: legs }, (_, i) => w + i) });
      w += legs;
    }
    return out;
  }
  const playoffPlan = (L) => planOf(L.settings);
  const roundOf = (L, w) => playoffPlan(L).find((rd) => rd.weeks.includes(w)) || null;
  // One round of a bracket from its entrants, best seed first: in a field that isn't a power of two the top seeds
  // sit out (a bye), and the rest play best against worst. Returns the games and the slots, in bracket order.
  function pairUp(E) {
    const P = 2 ** Math.ceil(Math.log2(Math.max(2, E.length))), slots = [];
    for (let i = 0; i < P / 2; i++) slots.push(E[P - 1 - i] == null ? { bye: E[i] } : { a: E[i], b: E[P - 1 - i] });
    return slots;
  }
  // How a game came out over the round's weeks: the legs add up. null until every leg is final.
  function decide(L, rd, a, b) {
    let sa = 0, sb = 0;
    for (const w of rd.weeks) {
      const g = (L.results[w] || []).find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
      if (!g) return null;
      if (g.a === a) { sa += g.sa; sb += g.sb; } else { sa += g.sb; sb += g.sa; }
    }
    return sb > sa ? { win: b, lose: a, sa, sb } : { win: a, lose: b, sa, sb };
  }
  // The whole postseason as far as results allow: for each round, the title games (with byes), a third-place
  // game, and the consolation games, each with its outcome once the round is over.
  function postseason(L) {
    const plan = playoffPlan(L), R = plan.length, s = L.settings;
    if (!R) return [];
    const st = standings(L), seeds = st.slice(0, s.playoffTeams).map((r) => r.team);
    const cons = s.consolation === "bracket" ? st.slice(s.playoffTeams, s.playoffTeams + 2 ** R).map((r) => r.team) : [];
    const consR = cons.length >= 2 ? Math.ceil(Math.log2(cons.length)) : 0;
    const seedOf = (t) => st.findIndex((r) => r.team === t);
    let main = seeds, low = cons, semiLosers = [];
    const out = [];
    for (const rd of plan) {
      const r = rd.round, row = { round: r, name: rd.name, weeks: rd.weeks, main: [], third: null, cons: [] };
      if (main) {
        const slots = pairUp(main), next = [];
        for (const sl of slots) {
          if (sl.bye != null) { row.main.push({ bye: sl.bye }); next.push(sl.bye); continue; }
          const res = decide(L, rd, sl.a, sl.b);
          row.main.push({ a: sl.a, b: sl.b, res });
          next.push(res ? res.win : null);
          if (r === R - 1) semiLosers.push(res ? res.lose : null);
        }
        main = next.every((x) => x != null) ? next : null;
      }
      if (r === R && s.consolation === "third" && R >= 2 && semiLosers.length === 2 && semiLosers.every((x) => x != null)) {
        const [a, b] = semiLosers.slice().sort((x, y) => seedOf(x) - seedOf(y));
        row.third = { a, b, res: decide(L, rd, a, b) };
      }
      if (consR && r > R - consR && low) {
        const slots = pairUp(low), next = [];
        for (const sl of slots) {
          if (sl.bye != null) { row.cons.push({ bye: sl.bye }); next.push(sl.bye); continue; }
          const res = decide(L, rd, sl.a, sl.b);
          row.cons.push({ a: sl.a, b: sl.b, res });
          next.push(res ? res.win : null);
        }
        low = next.every((x) => x != null) ? next : null;
      }
      out.push(row);
    }
    return out;
  }
  // The games of one playoff week, title games first (so the final is always game 0), then third place, then the
  // consolation bracket. Each pair carries its kind.
  function playoffGames(L, ctx, w) {
    const rd = roundOf(L, w);
    if (!rd) return [];
    const row = postseason(L).find((x) => x.round === rd.round);
    if (!row) return [];
    const tag = (g, kind) => Object.assign([g.a, g.b], { kind });
    return row.main.filter((g) => g.bye == null && g.a != null && g.b != null).map((g) => tag(g, "title"))
      .concat(row.third ? [tag(row.third, "third")] : [], row.cons.filter((g) => g.bye == null && g.a != null && g.b != null).map((g) => tag(g, "cons")));
  }
  // How the season ended: the champion and runner-up, third place, and the consolation winner, as far as decided.
  function finish(L) {
    if (isGuillotine(L)) return { champion: champion(L) };
    const st = standings(L);
    if (isRoto(L) || !L.settings.playoffTeams) return { champion: L.week > totalWeeks(L) && st[0] ? st[0].team : null };
    const ps = postseason(L), last = ps[ps.length - 1], fin = last && last.main[0] && last.main[0].res;
    return { champion: fin ? fin.win : null, runnerUp: fin ? fin.lose : null, third: last && last.third && last.third.res ? last.third.res.win : null,
      consolation: last && last.cons[0] && last.cons[0].res ? last.cons[0].res.win : null };
  }
  // The playoffs so far, a round at a time, for the standings page.
  function bracket(L, ctx) {
    const out = [];
    for (const rd of playoffPlan(L)) {
      for (const w of rd.weeks) {
        if (w > L.week) return out;
        const games = matchups(L, ctx, w, w < L.week ? 1 : 0);
        out.push({ week: w, round: rd.name, leg: rd.weeks.length > 1 ? `${rd.weeks.indexOf(w) + 1} of 2` : "", games });
      }
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
  // Pickups this week: adds and won claims (trades don't count). settings.maxAdds caps them, if set.
  const pickups = (L, teamId) => L.tx.filter((x) => x.team === teamId && x.week === L.week && (x.type === "add" || x.type === "add/drop" || x.type === "waiver")).length;
  const pickupsLeft = (L, teamId) => (L.settings.maxAdds ? Math.max(0, L.settings.maxAdds - pickups(L, teamId)) : Infinity);
  function canRoster(L, ctx, teamId, add, drops, pickup) {
    if (L.week > totalWeeks(L)) return { ok: false, why: "The season is over" };
    if (!isAlive(L, teamId)) return { ok: false, why: "That team has been chopped" };
    const ros = L.rosters[teamId].filter((id) => !(drops || []).includes(id));
    if (add && pickup && pickupsLeft(L, teamId) <= 0) return { ok: false, why: `You've used all ${L.settings.maxAdds} pickups this week` };
    // settings.posMax { QB: 4 }: at most that many players whose main position it is
    const pm = L.settings.posMax || {}, ap = add && ctx.byId[add] ? S.positions(ctx.byId[add])[0] : null;
    if (ap && pm[ap] && ros.filter((id) => ctx.byId[id] && S.positions(ctx.byId[id])[0] === ap).length >= pm[ap]) return { ok: false, why: `A roster can have at most ${pm[ap]} ${ap}` };
    const irKept = (L.ir[teamId] || []).filter((x) => !(drops || []).includes(x)).length;
    if (ros.length + (add ? 1 : 0) > maxRoster(L) + irKept) return { ok: false, why: "Roster is full: pick someone to drop" };
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
    if (L.week > totalWeeks(L)) return { ok: false, why: "The season is over" };
    if (add && ctx.own[add] != null) return { ok: false, why: `${ctx.byId[add].n} is on a roster` };
    if (add && onWaivers(L, add, now)) return { ok: false, why: `${ctx.byId[add].n} is on waivers: put in a claim` };
    if (drop && !L.rosters[teamId].includes(drop)) return { ok: false, why: "That player isn't on your roster" };
    const ok = canRoster(L, ctx, teamId, add, drop ? [drop] : [], true);
    if (!ok.ok) return ok;
    if (drop) { bank(L, ctx, teamId, drop, now); dropOne(L, teamId, drop, now); }
    if (add) { L.rosters[teamId].push(add); delete L.waivers[add]; joined(L, teamId, add, now); }
    log(L, now, { type: add && drop ? "add/drop" : add ? "add" : "drop", team: teamId, adds: add ? [add] : [], drops: drop ? [drop] : [] });
    refresh(L, ctx);
    return { ok: true };
  }
  function claim(L, ctx, teamId, add, drop, bid, now) {
    if (ctx.own[add] != null) return { ok: false, why: `${ctx.byId[add].n} is on a roster` };
    bid = Math.max(L.settings.minBid, Math.round(bid || 0));
    if (L.settings.waivers === "faab" && bid > L.teams[teamId].faab) return { ok: false, why: `You have $${L.teams[teamId].faab} of FAAB` };
    const ok = canRoster(L, ctx, teamId, add, drop ? [drop] : [], true);
    if (!ok.ok) return ok;
    L.claims = L.claims.filter((c) => !(c.team === teamId && c.add === add && c.status === "open"));
    L.claims.push({ id: L.nextId++, team: teamId, add, drop: drop || null, bid, at: now, status: "open" });
    return { ok: true };
  }
  const cancelClaim = (L, id) => { const c = L.claims.find((x) => x.id === id && x.status === "open"); if (!c) return { ok: false, why: "No such claim" }; c.status = "cancelled"; return { ok: true }; };
  // Highest bid wins; ties go to waiver priority. A team that wins moves to the back of the priority line.
  function runWaivers(L, ctx, now) {
    const open = L.claims.filter((c) => c.status === "open");
    const won = [];
    // highest bid first; on a tie the better waiver priority, which changes after every win, then the earlier claim
    const next = () => open.filter((c) => c.status === "open").sort((a, b) => b.bid - a.bid || L.teams[a.team].priority - L.teams[b.team].priority || a.at - b.at)[0];
    for (let c = next(); c; c = next()) {
      const t = L.teams[c.team];
      const rivals = open.filter((x) => x.add === c.add && x.status === "open");
      c.done = now; c.week = L.week;
      const why = ctx.own[c.add] != null ? `${(ctx.byId[c.add] || {}).n || "He"} was already taken`
        : L.settings.waivers === "faab" && c.bid > t.faab ? `Only $${t.faab} left by then`
        : c.drop && !L.rosters[c.team].includes(c.drop) ? `${(ctx.byId[c.drop] || {}).n || "Your drop"} was already gone`
        : !canRoster(L, ctx, c.team, c.add, c.drop ? [c.drop] : [], true).ok ? canRoster(L, ctx, c.team, c.add, c.drop ? [c.drop] : [], true).why.replace("Roster is full: pick someone to drop", "No roster spot open") : null;
      if (why) { c.status = "failed"; c.why = why; continue; }
      if (c.drop) { bank(L, ctx, c.team, c.drop, now); dropOne(L, c.team, c.drop, now); }
      L.rosters[c.team].push(c.add); delete L.waivers[c.add]; joined(L, c.team, c.add, now);
      if (L.settings.waivers === "faab") t.faab -= c.bid;
      c.status = "won";
      for (const x of rivals) if (x !== c) { x.status = "lost"; x.lostTo = c.team; x.done = now; x.week = L.week; }
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

  /* ---------- injured reserve ---------- */
  // Who can go on IR: players out, on IR, PUP, suspended or on the injured list. Day-to-day and questionable can't.
  const IR_OK = /^(ir|out|o|pup|na|sus|suspension|suspended|il\d*|injured reserve)$/i;
  const irEligible = (p) => !!p && IR_OK.test(String(p.inj || "").trim());
  const irSlots = (L) => Math.max(0, L.settings.ir || 0);
  // An IR spot doesn't count against the roster, so putting a hurt player there frees a spot for a pickup.
  function toIR(L, ctx, teamId, pid, now) {
    const p = ctx.byId[pid];
    if (L.week > totalWeeks(L)) return { ok: false, why: "The season is over" };
    if (!isAlive(L, teamId)) return { ok: false, why: "That team has been chopped" };
    if (!L.rosters[teamId].includes(pid)) return { ok: false, why: "He isn't on your roster" };
    const ir = (L.ir[teamId] = L.ir[teamId] || []);
    if (ir.includes(pid)) return { ok: false, why: `${p.n} is already on IR` };
    if (!irSlots(L)) return { ok: false, why: "This league has no IR spots" };
    if (ir.length >= irSlots(L)) return { ok: false, why: `Your IR ${irSlots(L) === 1 ? "spot is" : "spots are"} full` };
    if (!irEligible(p)) return { ok: false, why: `${p.n} isn't out or on IR, so he can't go there` };
    bank(L, ctx, teamId, pid, now);
    ir.push(pid);
    for (const w of Object.keys(L.lineups)) if (+w >= L.week && L.lineups[w][teamId]) L.lineups[w][teamId] = L.lineups[w][teamId].map((x) => (x === pid ? null : x));
    log(L, now, { type: "ir", team: teamId, adds: [], drops: [], text: `${p.n} to IR` });
    return { ok: true };
  }
  // Back from IR: he needs a roster spot again, so a full roster has to drop someone.
  function activate(L, ctx, teamId, pid, drop, now) {
    const ir = L.ir[teamId] || [];
    const p = ctx.byId[pid];
    if (L.week > totalWeeks(L)) return { ok: false, why: "The season is over" };
    if (!ir.includes(pid)) return { ok: false, why: `${p ? p.n : "He"} isn't on IR` };
    const active = L.rosters[teamId].length - ir.length;
    if (active + 1 > maxRoster(L) && !drop) return { ok: false, why: "Your roster is full: drop someone to activate him", needDrop: true };
    if (drop && (drop === pid || !L.rosters[teamId].includes(drop))) return { ok: false, why: "Pick someone on your roster to drop" };
    L.ir[teamId] = ir.filter((x) => x !== pid);
    joined(L, teamId, pid, now);
    if (drop) { bank(L, ctx, teamId, drop, now); dropOne(L, teamId, drop, now); log(L, now, { type: "drop", team: teamId, adds: [], drops: [drop] }); }
    log(L, now, { type: "ir", team: teamId, adds: [], drops: [], text: `${p.n} back from IR` });
    refresh(L, ctx);
    return { ok: true };
  }
  // Players who can't stay on IR any longer (they're healthy) block other moves until they come off, like Yahoo.
  const irBlocked = (L, ctx, teamId) => (L.ir[teamId] || []).filter((id) => !irEligible(ctx.byId[id]));

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
    if (L.week > totalWeeks(L)) return { ok: false, why: "The season is over" };
    const busy = new Set(L.trades.filter((x) => x.status === "review" && x.id !== t.id).flatMap((x) => x.give.concat(x.get)));
    for (const id of t.give.concat(t.get)) if (busy.has(id)) return { ok: false, why: `${ctx.byId[id].n} is already in a trade the league is reviewing` };
    for (const id of t.give) if (!L.rosters[t.from].includes(id)) return { ok: false, why: `${ctx.byId[id].n} isn't on ${L.teams[t.from].name}` };
    for (const id of t.get) if (!L.rosters[t.to].includes(id)) return { ok: false, why: `${ctx.byId[id].n} isn't on ${L.teams[t.to].name}` };
    if ((t.faabGive || 0) > L.teams[t.from].faab || (t.faabGet || 0) > L.teams[t.to].faab) return { ok: false, why: "Not enough FAAB" };
    const after = (team, out, inn, drops) => L.rosters[team].length - out.length + inn.length - drops.length;
    const irLeft = (team, out) => (L.ir[team] || []).filter((x) => !out.includes(x)).length;   // IR players traded away arrive active
    if (after(t.from, t.give, t.get, t.dropsFrom || []) > maxRoster(L) + irLeft(t.from, t.give)) return { ok: false, why: `${L.teams[t.from].name} would have too many players: add a drop` };
    if (after(t.to, t.get, t.give, t.dropsTo || []) > maxRoster(L) + irLeft(t.to, t.get)) return { ok: false, why: `${L.teams[t.to].name} would have too many players` };
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
    for (const id of t.give) bank(L, ctx, t.from, id, now);
    for (const id of t.get) bank(L, ctx, t.to, id, now);
    for (const id of t.dropsFrom || []) { bank(L, ctx, t.from, id, now); dropOne(L, t.from, id, now); }
    L.rosters[t.from] = L.rosters[t.from].filter((x) => !t.give.includes(x)).concat(t.get);
    L.rosters[t.to] = L.rosters[t.to].filter((x) => !t.get.includes(x)).concat(t.give);
    // a player traded off IR arrives active; his old team's IR spot opens
    L.ir[t.from] = (L.ir[t.from] || []).filter((x) => !t.give.includes(x));
    L.ir[t.to] = (L.ir[t.to] || []).filter((x) => !t.get.includes(x));
    // the players who left come out of the set lineups; everyone else stays where the manager put them
    const moved = new Set(t.give.concat(t.get));
    for (const w of Object.keys(L.lineups)) if (+w >= L.week) for (const team of [t.from, t.to]) { const lu = L.lineups[w][team]; if (lu) L.lineups[w][team] = lu.map((x) => (moved.has(x) ? null : x)); }
    for (const id of t.get) joined(L, t.from, id, now);
    for (const id of t.give) joined(L, t.to, id, now);
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
    // bots park their hurt players on IR, and bring back the healthy ones when there's room
    for (const t of L.teams) {
      if (t.owner || !isAlive(L, t.id)) continue;
      for (const id of irBlocked(L, ctx, t.id)) {
        const worst = L.rosters[t.id].filter((x) => !(L.ir[t.id] || []).includes(x)).map((x) => ctx.byId[x]).filter(Boolean).sort((a, b) => a.vor - b.vor)[0];
        activate(L, ctx, t.id, id, L.rosters[t.id].length - (L.ir[t.id] || []).length >= maxRoster(L) && worst ? worst.id : null, now);
      }
      const hurt = L.rosters[t.id].map((x) => ctx.byId[x]).filter((p) => p && irEligible(p) && !(L.ir[t.id] || []).includes(p.id)).sort((a, b) => b.vor - a.vor);
      for (const p of hurt) if (!toIR(L, ctx, t.id, p.id, now).ok) break;
    }
    // a bot with an empty lineup slot fills it first: the best free agent who fits, for its least useful player
    // whose drop doesn't open another hole
    for (const t of L.teams) {
      if (t.owner || !isAlive(L, t.id)) continue;
      const ids = L.rosters[t.id], now0 = holes(L, ctx, t.id, ids);
      if (!now0) continue;
      const order = ids.map((id) => ctx.byId[id]).filter(Boolean).sort((a, b) => (a.vor || 0) - (b.vor || 0));
      for (const p of ctx.free.filter((x) => !onWaivers(L, x.id, now) && !/^(out|ir|o)$/i.test(x.inj || "")).slice(0, 150)) {
        const room = ids.length - (L.ir[t.id] || []).length < maxRoster(L);
        const drop = room ? null : order.find((d) => holes(L, ctx, t.id, ids.filter((x) => x !== d.id).concat(p.id)) < now0);
        if (!room && !drop) continue;
        if (holes(L, ctx, t.id, ids.filter((x) => !drop || x !== drop.id).concat(p.id)) >= now0) continue;
        if (addDrop(L, ctx, t.id, p.id, drop ? drop.id : null, now).ok) break;
      }
    }
    for (const t of L.teams) {
      if (t.owner || !isAlive(L, t.id) || r() > 0.45) continue;
      // Bots chase form: value counts, and so does how a player has played the last two weeks.
      const span = Math.max(1e-6, Math.abs(ctx.players.reduce((m, p) => Math.max(m, p.vor || 0), 0)));
      const heat = (p) => (p.vor || 0) + span * 0.12 * (hot(L, p) - 1) * 3;
      const ros = L.rosters[t.id].map((id) => ctx.byId[id]).filter(Boolean).sort((a, b) => heat(a) - heat(b));
      const worst = ros[0];
      const before = holes(L, ctx, t.id, L.rosters[t.id]);
      // never a move that leaves a starting slot empty (like a fifth kicker for the only quarterback)
      const keeps = (p) => holes(L, ctx, t.id, L.rosters[t.id].filter((x) => x !== worst.id).concat(p.id)) <= before;
      const cand = ctx.free.filter((p) => !onWaivers(L, p.id, now)).slice(0, 40).filter((p) => worst && heat(p) > heat(worst) && S.positions(p).some((x) => S.positions(worst).includes(x) || r() < 0.4) && keeps(p));
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
        const ok = (id, ids, give, get) => holes(L, ctx, id, ids.filter((x) => x !== give).concat(get)) <= holes(L, ctx, id, ids);
        if (ga && gb && Math.abs(pValue(ctx, ga) - pValue(ctx, gb)) < 6 && ok(a.id, L.rosters[a.id], ga, gb) && ok(b.id, L.rosters[b.id], gb, ga)) {
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
        const c = claim(L, ctx, t.id, p.id, ros.length - (L.ir[t.id] || []).length >= maxRoster(L) ? drop.id : null, bid, now);
        if (c.ok) { bids++; n++; }
      }
    }
    return n;
  }
  // Moves the league forward: trades past review go through, bots answer offers, and a midweek waiver run happens
  // once its time comes.
  const offerEnds = (L, t) => t.at + (L.settings.offerHours || 48) * HOUR;
  function tick(L, ctx, now) {
    // offers nobody answered close after offerHours
    const pastDeadline = L.settings.deadline && L.week > L.settings.deadline;
    for (const t of L.trades) if (t.status === "pending" && (now >= offerEnds(L, t) || pastDeadline)) { t.status = "expired"; t.done = pastDeadline ? now : offerEnds(L, t); }
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

  return { DEFAULTS, WEEK, realWeek, canFinish, lineupLocked, isRoto, rotoLive, rotoStandings, pickups, pickupsLeft, create, roundRobin, context, refresh, maxRoster, totalWeeks, weekStart, lineupFor, setLineup, move, scoring, playerWeek, teamWeek, projection, compare, matchups, winProb,
    finishWeek, formOf, hot, standings, playoffGames, bracket, playoffPlan, roundOf, postseason, finish, power, onWaivers, canRoster, addDrop, claim, cancelClaim, runWaivers, pValue, sideValue, tradeCheck, propose, respond, cancelTrade,
    voters, vetoesNeeded, vote, finalize, execute, botAnswer, botsAnswer, botWeek, tick, log,
    weekFrac, joined, effFrac, bank, fillLineup, offerEnds, closeSeason, IR_OK, irEligible, irSlots, toIR, activate, irBlocked, GUILLOTINE, isGuillotine, isAlive, block, chopOdds, chop, champion, survival, waiverRunAt, botBids, bestBallIds };
});
