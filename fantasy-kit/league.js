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
  const m = factory(FK.sports || (typeof require !== "undefined" ? require("./sports.js") : null), FK.draft || (typeof require !== "undefined" ? require("./draft.js") : null), FK.value || (typeof require !== "undefined" ? require("./value.js") : null));
  if (typeof module !== "undefined" && module.exports) module.exports = m;
  else (root.FK = root.FK || {}).league = m;
})(this, function (S, F, V) {
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
      taxi: teams.map((t, i) => (D && D.taxi && D.taxi[i] ? D.taxi[i].filter((id) => rosters[i].includes(id)) : [])),
      schedule: guillotine || s.format === "roto" ? Array.from({ length: s.weeks }, () => []) : roundRobin(n, s.weeks, rng(seed + 7)), results: {}, week: 1,
      tx: [], trades: [], claims: [], waivers: {}, watch: {}, draft: D || null, nextId: 1,
      alive: teams.map((t) => t.id), chopped: [], waiverRuns: {},
    };
    // all-play with an odd number of teams: the team the schedule leaves out each week plays a second game instead
    if (s.tally === "allplay" && n % 2 && n > 1 && !guillotine) L.schedule.forEach((games, w) => {
      const playing = new Set(games.flat()), out = teams.map((t) => t.id).filter((id) => !playing.has(id));
      for (const id of out) games.push([id, games.length ? games[w % games.length][0] : teams.find((t) => t.id !== id).id]);
    });
    // divisions: teams split evenly, in team order (0, 1, 2 in divisions A, B, C, then around again)
    if (!guillotine && s.format !== "roto" && s.divisions >= 2 && n >= 2 * s.divisions) {
      L.divs = teams.map((t) => t.id % s.divisions);
      L.divNames = (s.divNames || DIV_NAMES[s.divisions] || []).slice(0, s.divisions);
    } else s.divisions = 0;
    if (s.median && (guillotine || s.format === "roto" || s.tally === "allplay" || s.tally === "cats")) s.median = false;
    // a rookie draft's picks can go on the taxi squad, rookies or not
    if (D && D.rookie) { L.taxiOk = {}; for (const pk of D.board || []) if (pk && pk.pid && !pk.keeper) L.taxiOk[pk.pid] = true; }
    if (D && D.promoted) L.promoted = Object.assign({}, D.promoted);
    if (D && D.futurePicks && Object.keys(D.futurePicks).length) L.picks = Object.assign({}, D.futurePicks);
    // a vampire league: the vampire's claim is always first
    if (s.vampire && teams[s.vampire.team] && !guillotine && s.format !== "roto") { L.bites = []; vampireFirst(L); } else delete s.vampire;
    if (D) log(L, D.done || L.created, { type: "draft", team: -1, text: `Draft complete: ${F.made(D).length} picks` });
    // pick your opponent: no divisions, head to head only; week 2's picks open now
    if (s.pyo && (guillotine || s.format === "roto")) delete s.pyo;
    if (s.pyo) { s.divisions = 0; delete L.divs; pyoOpen(L, null, 2, L.created); }
    for (const k of ["robin", "conquest", "crown", "hangover"]) if (s[k] && (guillotine || s.format === "roto")) delete s[k];
    if (s.topBonus && !guillotine) delete s.topBonus;
    if (s.crown) L.crown = { king: s.crown.king != null && teams[s.crown.king] ? s.crown.king : null, pot: s.crown.start != null ? s.crown.start : 10, since: 1, reigns: [] };
    return L;
  }

  const DIV_NAMES = { 2: ["East", "West"], 3: ["North", "South", "West"], 4: ["North", "South", "East", "West"] };
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
  // With game-time locks he can only start for it before his first game, so a pickup made before then counts his
  // whole week, not the share of the week that was left.
  function joined(L, teamId, pid, now, ctx) { const k = ctx ? kickOf(L, ctx.byId[pid]) : undefined; (L.joined = L.joined || {})[pid] = { team: teamId, week: L.week, f: k != null && k > now ? 0 : weekFrac(L, now) }; }

  /* ---------- game-time locks ---------- */
  // In a league on real games a player locks when his pro team's first game of the week starts: until the week is over
  // he can't move into or out of a lineup, and can't leave the roster from one (dropped, traded, put on IR). Football
  // teams play once a week, so that's his game; basketball and baseball lock for the week at the first game, the way
  // weekly-lineup leagues do. That keeps whole-week box scores exact: nobody starts a player after his game.
  // L.kick, from the live feed's schedule and saved with the league so the clock and every page agree:
  // { week, teams: { pro team: first kickoff ms } }. Without it (a simulated league), nothing locks.
  function setKicks(L, live) {
    if (!L.settings.real || !live || !live.games || !live.start || L.week > totalWeeks(L)) return false;
    if (Math.abs(Date.parse(live.start + "T12:00:00Z") - weekStart(L, L.week)) >= 2.5 * DAY) return false;
    const teams = {};
    for (const [t, gs] of Object.entries(live.games)) {
      // a game the feed shows under way or over has started, whatever its listed time says
      // (and keeps the earliest time it was seen started, so a lock never moves later)
      const seen = Date.parse(live.updated) || null, was = L.kick && L.kick.week === L.week ? L.kick.teams[t] : undefined;
      const started = (gs || []).some((g) => g.state && g.state !== "pre");
      let at = Math.min(...(gs || []).map((g) => Date.parse(g.at)).filter(Number.isFinite));
      if (started && seen) at = Math.min(Number.isFinite(at) ? at : seen, seen, was != null ? was : Infinity);
      if (Number.isFinite(at)) teams[t] = at;
    }
    if (!Object.keys(teams).length) return false;
    const k = { week: L.week, teams };
    if (L.kick && JSON.stringify(L.kick) === JSON.stringify(k)) return false;
    L.kick = k;
    return true;
  }
  const kickOf = (L, p) => (L.kick && L.kick.week === L.week && p && p.t && L.kick.teams[p.t] != null ? L.kick.teams[p.t] : undefined);
  const isLocked = (L, p, w, now) => w === L.week && now != null && kickOf(L, p) != null && now >= kickOf(L, p);
  const firstKick = (L) => (L.kick && L.kick.week === L.week ? Math.min(...Object.values(L.kick.teams)) : null);
  // a locked player in a team's lineup this week: he can't leave it
  const lockedStarter = (L, ctx, teamId, pid, now) => isLocked(L, ctx.byId[pid], L.week, now) && lineupFor(L, ctx, teamId, L.week).includes(pid);
  const lockWhy = (p) => `${p.n}'s game has started, so he's locked in until the week ends`;
  // Lineups nobody set (bots, and anyone who never changed theirs) are filled in automatically, which would let them
  // shift after games start. Half an hour before the week's first game, each one is saved as it stands.
  function freezeLineups(L, ctx, now) {
    const at = firstKick(L), w = L.week;
    if (at == null || now < at - 30 * 60e3 || L.settings.bestBall || w > totalWeeks(L)) return false;
    let any = false;
    for (const t of L.teams) {
      if (!isAlive(L, t.id) || (L.lineups[w] && L.lineups[w][t.id])) continue;
      (L.lineups[w] = L.lineups[w] || {})[t.id] = lineupFor(L, ctx, t.id, w).slice();
      any = true;
    }
    return any;
  }
  // "Start my best lineup" around the locked players: they stay where they are, the rest fill the open slots.
  function bestLineup(L, ctx, teamId, w, now) {
    const cur = lineupFor(L, ctx, teamId, w).slice(), slots = L.settings.lineup;
    const fixed = cur.map((id) => !!id && isLocked(L, ctx.byId[id], w, now));
    const pool = healthy(L, ctx, teamId).filter((p) => !isLocked(L, p, w, now) && !cur.some((id, i) => fixed[i] && id === p.id));
    const open = slots.map((s, i) => i).filter((i) => !fixed[i]);
    const got = F.assign(ctx.sport, pool, open.map((i) => slots[i]));
    const out = cur.map((id, i) => (fixed[i] ? id : null));
    open.forEach((i, k) => { out[i] = got[k] ? got[k].id : null; });
    // a slot with no healthy player left: a hurt one who fits beats an empty one
    const used = new Set(out.filter(Boolean));
    for (const i of open) {
      if (out[i]) continue;
      const q = L.rosters[teamId].map((id) => ctx.byId[id]).filter((p) => p && !used.has(p.id) && !held(L, teamId).includes(p.id) && !isLocked(L, p, w, now) && S.fits(ctx.sport, p, slots[i])).sort((a, b) => (b.v || 0) - (a.v || 0))[0];
      if (q) { out[i] = q.id; used.add(q.id); }
    }
    return weighted(L, ctx, out, fixed);
  }
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
    const ros = L.rosters[teamId], ir = held(L, teamId);
    if (saved) return saved.map((id) => (id && ros.includes(id) && !ir.includes(id) ? id : null));
    return weighted(L, ctx, fillLineup(L, ctx, teamId).map((p) => (p ? p.id : null)));
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
      if (taxiOf(L, teamId).includes(id)) return { ok: false, why: `${p.n} is on the taxi squad: promote him first` };
      if (!S.fits(ctx.sport, p, L.settings.lineup[i])) return { ok: false, why: `${p.n} can't play ${L.settings.lineup[i]}` };
    }
    // a player whose game has started stays where he is, in the lineup or out of it
    if (now != null && L.kick) {
      const cur = lineupFor(L, ctx, teamId, w);
      for (let i = 0; i < L.settings.lineup.length; i++) {
        const was = cur[i] || null, will = slots[i] || null;
        if (was === will) continue;
        if (was && isLocked(L, ctx.byId[was], w, now) && !slots.includes(was)) return { ok: false, why: lockWhy(ctx.byId[was]) };
        if (was && isLocked(L, ctx.byId[was], w, now)) return { ok: false, why: `${ctx.byId[was].n}'s game has started, so he stays in his spot` };
        if (will && isLocked(L, ctx.byId[will], w, now)) return { ok: false, why: `${ctx.byId[will].n}'s game has started, so he can't move into the lineup` };
      }
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

  const healthy = (L, ctx, teamId) => L.rosters[teamId].filter((id) => !held(L, teamId).includes(id)).map((id) => ctx.byId[id]).filter((p) => p && !/^(out|ir|o)$/i.test(p.inj || ""));
  // How many lineup slots a set of players can't fill with healthy players (IR doesn't count).
  function holes(L, ctx, teamId, ids) {
    const ir = held(L, teamId);
    const ps = ids.filter((id) => !ir.includes(id)).map((id) => ctx.byId[id]).filter((p) => p && !/^(out|ir|o)$/i.test(p.inj || ""));
    return F.assign(ctx.sport, ps, L.settings.lineup).filter((x) => !x).length;
  }
  function projectedBest(L, ctx, teamId) { return weighted(L, ctx, F.assign(ctx.sport, healthy(L, ctx, teamId), L.settings.lineup).map((p) => (p ? p.id : null))); }
  // A slot that counts extra (a showdown captain) goes to the best starter who can play it, swapping with whoever had
  // it when that player fits the other slot. `keep` marks slots that can't change (locked players).
  function weighted(L, ctx, ids, keep) {
    const m = L.settings.mult, slots = L.settings.lineup;
    if (!m) return ids;
    const out = ids.slice(), v = (id) => (id && ctx.byId[id] ? ctx.byId[id].v || 0 : -Infinity);
    const order = slots.map((s, i) => i).filter((i) => (m[slots[i]] || 1) > 1 && !(keep && keep[i])).sort((a, b) => m[slots[b]] - m[slots[a]]);
    for (const i of order) {
      let best = i;
      for (let j = 0; j < out.length; j++) {
        if (j === i || (keep && keep[j]) || (m[slots[j]] || 1) > (m[slots[i]] || 1) || !out[j] || v(out[j]) <= v(out[best])) continue;
        if (!S.fits(ctx.sport, ctx.byId[out[j]], slots[i]) || (out[i] && !S.fits(ctx.sport, ctx.byId[out[i]], slots[j]))) continue;
        best = j;
      }
      if (best !== i) [out[i], out[best]] = [out[best], out[i]];
    }
    return out;
  }
  // The best lineup of healthy players, with any slot still open filled by a hurt player who fits (better than empty).
  function fillLineup(L, ctx, teamId) {
    const slots = L.settings.lineup, ir = held(L, teamId);
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
    const leavers = Object.keys((L.left && L.left[w] && L.left[w][teamId]) || {}).filter((id) => !L.rosters[teamId].includes(id) || held(L, teamId).includes(id)).map((id) => ctx.byId[id]).filter(Boolean);
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
    if (w in ctx._rw) return sinceStart(L, ctx, ctx._rw[w]);
    const t = weekStart(L, w);
    const hit = Object.values(R.weeks).find((x) => Math.abs(Date.parse(x.start + "T12:00:00Z") - t) < 2.5 * DAY);
    ctx._rw[w] = hit || { lines: {}, final: false, missing: true };
    return sinceStart(L, ctx, ctx._rw[w]);
  }
  // A league that began midweek (L.baseline: each player's line for that week when it began) counts only what came
  // after: the week's lines less the baseline. Worked out again only when the week's lines change (a live poll).
  function sinceStart(L, ctx, rw) {
    const b = L.baseline;
    if (!b || !rw || !rw.lines || rw.start !== b.start) return rw;
    const c = ctx._since || (ctx._since = {});
    if (c.src === rw.lines && c.rw === rw && c.final === rw.final) return c.out;
    const minus = (x, y) => (Array.isArray(x) ? x.map((v, i) => (v || 0) - ((y && y[i]) || 0)) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, minus(v, y && y[k])])) : x);
    const lines = {};
    for (const [id, line] of Object.entries(rw.lines)) lines[id] = b.lines[id] ? minus(line, b.lines[id]) : line;
    c.src = rw.lines; c.rw = rw; c.final = rw.final;
    c.out = Object.assign({}, rw, { lines, since: b.at });
    return c.out;
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
  // A weeks file has one line (R.line, R.cols, and each player's week is an array) or several (R.lines maps each
  // line to its columns, and each player's week is { line: array }), as baseball's batting and pitching do.
  const realPts = (R, sc, line, p) => {
    const at = (k) => {
      const d = k.indexOf("."), lk = d > 0 ? k.slice(0, d) : null, c = d > 0 ? k.slice(d + 1) : k;
      if (R.lines) { const keys = lk ? [lk] : Object.keys(R.lines); return sum(keys.map((x) => { const i = (R.lines[x] || []).indexOf(c); return i >= 0 && line[x] ? line[x][i] || 0 : 0; })); }
      if (lk && lk !== R.line) return 0;
      const i = R.cols.indexOf(c); return i >= 0 ? line[i] || 0 : 0;
    };
    return (sc.weights ? sum(Object.entries(sc.weights).map(([k, x]) => at(k) * x)) : at(sc.col)) + (p ? S.extraPts(sc, p, at) : 0);
  };
  function playerWeek(L, ctx, p, w, frac = 1, whole) {
    const form = formOf(L, p, w);
    const sc = scoring(L, ctx);
    const rw = realWeek(L, ctx, w);
    if (rw) {
      // the box score so far; a player who joined or left midweek counts for his share of it
      const R = ctx.hooks.real, line = rw.lines[p.id];
      const share = whole > 0 ? Math.max(0, Math.min(1, frac / whole)) : frac > 0 ? 1 : 0;
      if (sc.type === "points") return { pts: line ? realPts(R, sc, line, p) * share : 0, real: true };
      const out = {};
      for (const [key, def] of Object.entries(ctx.sport.data.lines)) {
        const cols = R.lines ? R.lines[key] : R.cols, vals = R.lines ? line && line[key] : line;
        if (!cols || (!R.lines && key !== R.line && !(def.cols.every((c) => cols.includes(c))))) continue;
        out[key] = def.cols.map((c) => { const i = cols.indexOf(c); const v = vals && i >= 0 ? vals[i] || 0 : 0; return /^(avg|obp|ops|era|whip|fg|ft)$/.test(c) ? v : v * share; });
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
    const slotsOf = best || lineupFor(L, ctx, teamId, w), ids = slotsOf.filter(Boolean);
    const lines = ids.map((id) => [ctx.byId[id], ctx.byId[id] && playerWeek(L, ctx, ctx.byId[id], w, effFrac(L, teamId, id, w, frac), frac)]).filter((x) => x[0]);
    if (sc.type === "points") {
      // a slot can count extra (a showdown's captain, 1.5x)
      const players = Object.fromEntries(lines.map(([p, s]) => [p.id, s.pts * slotMult(L, slotsOf.indexOf(p.id), p.id)]));
      const banked = (L.banked && L.banked[w] && L.banked[w][teamId]) || {};
      for (const [id, v] of Object.entries(banked)) players[id] = (players[id] || 0) + v;
      return { total: sum(Object.values(players)), players, lineup: best, banked: Object.keys(banked) };
    }
    return Object.assign(catsOf(ctx, sc, lines.map((x) => x[1])), { total: null, lineup: best });
  }
  // Category totals from player lines ({ line: values }): counting stats add up, a percentage is made from its parts,
  // and a rate stat (AVG, ERA) is weighted by its volume (AB, IP).
  function catsOf(ctx, sc, lines) {
    const cats = {}, parts = {};
    for (const c of sc.cats) {
      const line = c.line || "pg";
      const has = lines.filter((s) => s && s[line]);
      const ix = (col) => ctx.sport.cols[line][col];
      if (c.num) { const n = sum(has.map((s) => s[line][ix(c.num)])), d = sum(has.map((s) => s[line][ix(c.den)])); cats[c.k] = d ? n / d : 0; parts[c.k] = [n, d]; }
      else if (c.rate) { const wt = sum(has.map((s) => s[line][ix(c.w)])), x = sum(has.map((s) => s[line][ix(c.rate)] * s[line][ix(c.w)])); cats[c.k] = wt ? x / wt : 0; parts[c.k] = [x, wt]; }
      else cats[c.k] = sum(has.map((s) => s[line][ix(c.col)]));
    }
    return { cats, parts };
  }
  // How a player's week should end in a category league: his line so far plus his rate over the games he has left.
  // With the live feed, games left are his pro team's (one in progress counts half); without it, the rest of the week.
  // A player who's out projects nothing more; a doubtful or questionable one, a share.
  const RATIO = /^(avg|obp|ops|era|whip|fg|ft)$/, PLAYS = [[/^(out|o|ir|il|sus|suspended|pup|nfi|dtd-out)/i, 0], [/^(doubtful|d)$/i, 0.3], [/^(questionable|q|gtd|dtd|day-to-day)$/i, 0.85]];
  function gamesLeft(L, ctx, p, w, frac) {
    const R = ctx.hooks && ctx.hooks.real, lv = R && R.live, rw = realWeek(L, ctx, w);
    if (lv && rw && !rw.missing && rw.start === lv.start && lv.teams) { const t = lv.teams[p.t]; return t ? t.left + 0.5 * t.live : 0; }
    const wk = WEEK[ctx.sport.key] || { weeks: 20 };
    return Math.max(0, 1 - frac) * (GAMES[ctx.sport.key] || 82) / wk.weeks;
  }
  const plays = (p) => { const tag = String(p.inj || "").trim(); if (!tag) return 1; const hit = PLAYS.find(([re]) => re.test(tag)); return hit ? hit[1] : 1; };
  function projectLine(L, ctx, teamId, p, w, frac) {
    const sofar = playerWeek(L, ctx, p, w, effFrac(L, teamId, p.id, w, frac), frac);
    const wk = WEEK[ctx.sport.key] || { weeks: 20 }, g = GAMES[ctx.sport.key] || 82, togo = gamesLeft(L, ctx, p, w, frac) * plays(p);
    const rest = {};
    for (const [line, def] of Object.entries(ctx.sport.data.lines)) {
      if (def.proj || wk[line] == null) continue;
      const base = V && V.rateLine ? V.rateLine(ctx.sport, p, line) : p.l[line];
      if (!base) continue;
      const f = (wk[line] * wk.weeks / g) * togo;   // a season line to one pro team game, times the games left
      rest[line] = def.cols.map((c, i) => (RATIO.test(c) ? base[i] || 0 : (base[i] || 0) * f));
    }
    return [sofar, rest];
  }
  // A category team's projected week, and the odds it wins more categories. Each category's margin is uncertain in
  // proportion to what's still to come, so a category settles as the week plays out.
  function projectCats(L, ctx, teamId, w, frac) {
    const sc = scoring(L, ctx);
    if (sc.type === "points") return null;
    const lines = [], rest = [];
    for (const id of lineupFor(L, ctx, teamId, w).filter(Boolean)) {
      const p = ctx.byId[id]; if (!p) continue;
      const [a, b] = projectLine(L, ctx, teamId, p, w, frac);
      lines.push(a, b); rest.push(b);
    }
    const r = catsOf(ctx, sc, rest);
    return Object.assign(catsOf(ctx, sc, lines), { rest: r.cats, restParts: r.parts });
  }
  // How much one category can still move, for one team. Counting stats: what's left to come, spread wider than chance
  // (DISP, a variance-to-mean ratio, since a big night or a rainout moves several at once). Rates and percentages:
  // the spread of one attempt (UNIT) over the attempts still to come, as a share of all of the week's attempts.
  const DISP = { pts: 3.5, reb: 2, ast: 2, stl: 1.3, blk: 1.5, tov: 1.3, tpm: 1.6, r: 2, rbi: 2.2, hr: 1.3, sb: 1.6, h: 1.2, tb: 3, k: 2.2, w: 1, l: 1, sv: 1, hld: 1, qs: 1, bb: 1.5, er: 2 };
  const UNIT = { fg: 0.5, ft: 0.45, avg: 0.43, obp: 0.47, ops: 0.95, era: 7.5, whip: 1.1 };
  function catSpread(c, pj) {
    if (c.num || c.rate) {
      const all = (pj.parts[c.k] || [0, 0])[1], left = (pj.restParts[c.k] || [0, 0])[1];
      return all > 0 && left > 0 ? (UNIT[c.k] != null ? UNIT[c.k] : 0.5) * Math.sqrt(left) / all : 0;
    }
    return Math.sqrt(Math.max(0, pj.rest[c.k] || 0) * (DISP[c.col] || 2));
  }
  const normal = (z) => 1 / (1 + Math.exp(-1.702 * z));
  // Each category's chance, then the chance of winning more categories than you lose, adding them up one at a time.
  function catOdds(L, ctx, pa, pb) {
    const sc = scoring(L, ctx), probs = {};
    for (const c of sc.cats) {
      const m = (pa.cats[c.k] - pb.cats[c.k]) * (c.low ? -1 : 1), sd = Math.hypot(catSpread(c, pa), catSpread(c, pb));
      probs[c.k] = sd > 1e-9 ? normal(m / sd) : m > 0 ? 1 : m < 0 ? 0 : 0.5;
    }
    let dist = [1];
    for (const c of sc.cats) { const q = probs[c.k], next = new Array(dist.length + 1).fill(0); dist.forEach((v, i) => { next[i + 1] += v * q; next[i] += v * (1 - q); }); dist = next; }
    const n = sc.cats.length; let win = 0;
    dist.forEach((v, k) => { if (k > n - k) win += v; else if (k === n - k) win += v / 2; });
    // the projected record: categories each side is expected to win, so it reads the same way as the odds
    const sa = Math.round(sum(Object.values(probs)));
    return { probs, win, sa, sb: n - sa };
  }
  // How much a lineup slot counts: settings.mult, by slot name (a showdown's CPT, 1.5), or 1
  // ...times what a heist put on the player himself (L.pmult: a stolen player's 1.5x, a jinxed one's half)
  const slotMult = (L, i, pid) => ((i >= 0 && L.settings.mult && L.settings.mult[L.settings.lineup[i]]) || 1) * ((pid != null && L.pmult && L.pmult[pid]) || 1);
  // What a team should score this week with average form.
  function projection(L, ctx, teamId, w) {
    const sc = scoring(L, ctx);
    const wk = WEEK[ctx.sport.key] || { weeks: 20 };
    const lu = lineupFor(L, ctx, teamId, w), ids = lu.filter(Boolean);
    if (sc.type === "points") return { total: sum(ids.map((id) => (ctx.byId[id] ? (ctx.byId[id].v / wk.weeks) * slotMult(L, lu.indexOf(id), id) : 0))) };
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
      // a category week: where each category should end up, and the odds of winning more of them
      if (!ctx.hooks.score && scoring(L, ctx).type !== "points") {
        const oa = outlook(L, ctx, a, w), ob = outlook(L, ctx, b, w);
        const ja = projectCats(L, ctx, a, w, frac), jb = projectCats(L, ctx, b, w, frac), pc = compare(L, ctx, ja, jb), od = catOdds(L, ctx, ja, jb);
        return Object.assign({ a, b, final: false, i, kind, live: frac > 0 && frac < 1, frac, ta: x, tb: y, pa: od.sa, pb: od.sb, winProb: od.win, proj: { cats: pc.cats, sa: od.sa, sb: od.sb, ties: 0, probs: od.probs }, outlook: oa && ob ? [oa, ob] : undefined }, c);
      }
      const pa = projection(L, ctx, a, w), pb = projection(L, ctx, b, w);
      // a real week with the live feed: the score so far plus what each starter has left to play
      const oa = outlook(L, ctx, a, w), ob = outlook(L, ctx, b, w);
      if (oa && ob) {
        const sc = scoring(L, ctx), left = oa.left + ob.left, all = left + oa.played + ob.played;
        const fr = all ? 1 - left / all : frac;
        const wp = sc.type === "points" ? liveWin(c.sa + oa.rem, c.sb + ob.rem, oa.vr + ob.vr) : winProb(L, ctx, c, pa.total, pb.total, fr);
        return Object.assign({ a, b, final: false, i, kind, live: fr > 0 && fr < 1, frac: fr, ta: x, tb: y, pa: sc.type === "points" ? c.sa + oa.rem : pa.total, pb: sc.type === "points" ? c.sb + ob.rem : pb.total, winProb: wp, outlook: [oa, ob] }, c);
      }
      return Object.assign({ a, b, final: false, i, kind, live: frac > 0 && frac < 1, frac, ta: x, tb: y, pa: pa.total, pb: pb.total, winProb: winProb(L, ctx, c, pa.total, pb.total, frac) }, c);
    });
  }
  // What a team's starters have left this week, from the live feed (ctx.hooks.real.live.teams: each pro team's
  // games played, in progress and left): expected points still to come, their variance, and starter-games played
  // and left. A game in progress counts as half played. null without the feed for this week.
  const GAMES = { nba: 82, nfl: 17, mlb: 162 }, SPREAD = { nba: 0.38, nfl: 0.62, mlb: 1.0 };
  function outlook(L, ctx, teamId, w) {
    const R = ctx.hooks && ctx.hooks.real, lv = R && R.live, rw = realWeek(L, ctx, w);
    if (!lv || !rw || rw.missing || rw.start !== lv.start || !lv.teams) return null;
    const sc = scoring(L, ctx), g = GAMES[ctx.sport.key] || 82, k = SPREAD[ctx.sport.key] || 0.5;
    let rem = 0, vr = 0, played = 0, left = 0;
    const lu = lineupFor(L, ctx, teamId, w);
    for (const id of lu.filter(Boolean)) {
      const p = ctx.byId[id], t = p && lv.teams[p.t];
      if (!p || !t) continue;
      // a points rate is per game the player plays (sc.games a season), and a player who's out won't add to it
      const togo = t.left + 0.5 * t.live, per = sc.type === "points" ? ((p.v || 0) / (sc.games || g)) * plays(p) * slotMult(L, lu.indexOf(id), id) : 0;
      rem += per * togo; vr += togo * (k * per) ** 2;
      played += t.played + 0.5 * t.live; left += togo;
    }
    return { rem, vr, played, left };
  }
  const liveWin = (a, b, vr) => (vr <= 1e-6 ? (a > b ? 1 : a < b ? 0 : 0.5) : 1 / (1 + Math.exp(-1.702 * (a - b) / Math.sqrt(vr))));
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
    const runAt = L.settings.waiverAt != null ? weekStart(L, w + 1) + L.settings.waiverAt * HOUR : waiverClear(L, now);
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
      runDue(L, ctx, now);
      return { ok: true };
    }
    if (isGuillotine(L)) {
      if (L.alive.length <= 1) return { ok: false, why: "The season is over" };
      L.lineups[w] = L.lineups[w] || {};
      for (const t of L.alive) { const x = teamWeek(L, ctx, t, w, 1); L.lineups[w][t] = x.lineup || lineupFor(L, ctx, t, w); }
      chop(L, ctx, now);
      topBonus(L, w, now);
      if (L.alive.length <= 1) log(L, now, { type: "champion", team: L.alive[0], text: "Last team standing" });
      L.week = L.alive.length <= 1 ? totalWeeks(L) + 1 : w + 1;
      if (L.week > totalWeeks(L)) { closeSeason(L, now); return { ok: true, over: true }; }
      if (L.settings.waiverAt == null) runDue(L, ctx, now);
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
    if (w <= L.settings.weeks) { openBites(L, w, games, now); openRaids2(L, ctx, w, games, now); crownWeek(L, games, w, now); }
    // pick your opponent: this week's picks are final, and next week's open
    if (L.pyo && !L.pyo.done && L.pyo.week <= L.week) { runPyo(L, ctx, Math.max(now, L.pyo.due)); pyoDone(L, now); }
    if (L.settings.pyo && w + 2 <= L.settings.weeks) pyoOpen(L, ctx, w + 2, now);
    if (L.week > totalWeeks(L)) { closeSeason(L, now); return { ok: true, over: true }; }
    reorderWaivers(L);
    runDue(L, ctx, now);
    return { ok: true };
  }

  // settings.waiverOrder "standings": every week the priority resets to the reverse of the standings (worst team
  // first), instead of rolling (a winning claim sends a team to the back). The vampire still claims first.
  function reorderWaivers(L) {
    if (L.settings.waiverOrder !== "standings" || isGuillotine(L)) return;
    standings(L).map((r) => r.team).reverse().forEach((t, i) => (L.teams[t].priority = i + 1));
    vampireFirst(L);
  }

  /* ---------- vampire leagues ---------- */
  // settings.vampire = { team, samePos, double }: one team (the vampire) skips the draft and builds from free agents.
  // Each regular-season week it wins, it may take any player from the team it beat and give back one of its own
  // (samePos: of the same position). double: it also bites the week's lowest scorer. No bites in the playoffs. The
  // vampire has the first waiver claim every week. A bite stays open two days into the next week, then it's made for
  // the vampire: the best player it can take, for its least valuable player.
  const vampireOf = (L) => (L.settings.vampire && L.teams[L.settings.vampire.team] ? L.settings.vampire.team : null);
  const BITE_HOURS = 48;
  function openBites(L, w, games, now) {
    const v = vampireOf(L);
    if (v == null) return;
    const g = games.find((x) => x.a === v || x.b === v);
    if (!g || g.w === "t" || !g.w) return;
    const won = (g.w === "a" && g.a === v) || (g.w === "b" && g.b === v);
    if (!won) return;
    const due = weekStart(L, w + 1) + BITE_HOURS * HOUR;
    L.bites = L.bites || [];
    const loser = g.a === v ? g.b : g.a;
    L.bites.push({ id: L.nextId++, week: w, victim: loser, why: "beat", status: "open", at: now, due });
    if (L.settings.vampire.double) {
      const low = games.flatMap((x) => [[x.a, x.sa], [x.b, x.sb]]).filter(([t]) => t !== v && t !== loser).sort((a, b) => a[1] - b[1])[0];
      if (low) L.bites.push({ id: L.nextId++, week: w, victim: low[0], why: "lowest", status: "open", at: now, due });
    }
  }
  // who takes in a bite: the vampire, or b.by (Robin Hood's lowest scorer, Conquest's winner); like for like per bite
  const takerOf = (L, b) => (b.by != null ? b.by : vampireOf(L));
  const likeFor = (L, b) => (b.like != null ? !!b.like : !!(L.settings.vampire && L.settings.vampire.samePos));
  const openBite = (L) => (L.bites || []).find((b) => b.status === "open" && b.by == null) || null;
  const openRaids = (L, team) => (L.bites || []).filter((b) => b.status === "open" && b.by != null && b.by === team);
  function biteCheck(L, ctx, b, take, give) {
    if (!b || b.status !== "open") return { ok: false, why: "That bite is no longer open" };
    const v = takerOf(L, b), p = ctx.byId[take], q = give ? ctx.byId[give] : null;
    if (!p || !L.rosters[b.victim].includes(take)) return { ok: false, why: `${p ? p.n : "He"} isn't on ${L.teams[b.victim].name}` };
    if ((b.protect || []).includes(take)) return { ok: false, why: `${p.n} is protected` };
    if ((L.ir[b.victim] || []).includes(take) && b.by != null) return { ok: false, why: `${p.n} is on injured reserve` };
    const room = L.rosters[v].length - held(L, v).length < maxRoster(L);
    if (!give && !room) return { ok: false, why: "Pick one of your players to give back" };
    if (give && (!q || !L.rosters[v].includes(give))) return { ok: false, why: "That player isn't on your roster" };
    if (give && likeFor(L, b) && S.positions(p)[0] !== S.positions(q)[0]) return { ok: false, why: `This league swaps like for like: give back a ${S.positions(p)[0]}` };
    return { ok: true };
  }
  function bite(L, ctx, id, take, give, now, auto) {
    const b = (L.bites || []).find((x) => x.id === id), v = b ? takerOf(L, b) : null;
    const c = biteCheck(L, ctx, b, take, give);
    if (!c.ok) return c;
    bank(L, ctx, b.victim, take, now);
    if (give) bank(L, ctx, v, give, now);
    L.rosters[b.victim] = L.rosters[b.victim].filter((x) => x !== take).concat(give ? [give] : []);
    L.rosters[v] = L.rosters[v].filter((x) => x !== give).concat(take);
    for (const t of [b.victim, v]) { L.ir[t] = (L.ir[t] || []).filter((x) => x !== take && x !== give); if (L.taxi && L.taxi[t]) L.taxi[t] = L.taxi[t].filter((x) => x !== take && x !== give); }
    for (const w of Object.keys(L.lineups)) if (+w >= L.week) for (const t of [b.victim, v]) { const lu = L.lineups[w][t]; if (lu) L.lineups[w][t] = lu.map((x) => (x === take || x === give ? null : x)); }
    joined(L, v, take, now, ctx); if (give) joined(L, b.victim, give, now, ctx);
    Object.assign(b, { status: "done", take, give: give || null, done: now, auto: !!auto });
    const who = b.why === "robin" ? "Robin Hood: " : b.why === "conquest" ? "Spoils of war: " : "";
    log(L, now, { type: "bite", kind: b.why, team: v, other: b.victim, adds: [take], drops: give ? [give] : [], text: `${who}${ctx.byId[take].n} taken from ${L.teams[b.victim].name}${give ? `, ${ctx.byId[give].n} given back` : ""}${auto ? ` (made for ${b.by != null ? L.teams[v].name : "the vampire"})` : ""}` });
    refresh(L, ctx);
    return { ok: true };
  }
  // The bite a bot vampire makes (and the one made for a human vampire who runs out of time): the most valuable
  // player it can take that its roster has a use for, for its own least valuable player (of his position, if swaps
  // are like for like).
  function autoBite(L, ctx, b) {
    const v = takerOf(L, b), like = likeFor(L, b);
    const mine = L.rosters[v].filter((x) => !held(L, v).includes(x)).map((x) => ctx.byId[x]).filter(Boolean);
    const room = L.rosters[v].length - held(L, v).length < maxRoster(L);
    const val = (p) => (p.$ || 0) + Math.max(0, p.vor || 0) * 0.01;
    const off = new Set((b.protect || []).concat(b.by != null ? L.ir[b.victim] || [] : []));
    for (const p of L.rosters[b.victim].filter((x) => !off.has(x)).map((x) => ctx.byId[x]).filter(Boolean).sort((a, b2) => val(b2) - val(a))) {
      const pool = like ? mine.filter((q) => S.positions(q)[0] === S.positions(p)[0]) : mine;
      const give = room ? null : pool.sort((a, b2) => val(a) - val(b2))[0];
      if (!room && !give) continue;
      if (give && val(give) >= val(p)) continue;
      return { take: p.id, give: give ? give.id : null };
    }
    return null;
  }
  function runBites(L, ctx, now) {
    let n = 0;
    for (const b of (L.bites || []).filter((x) => x.status === "open")) {
      const v = takerOf(L, b);
      if (v == null) continue;
      const bot = !L.teams[v].owner;
      if (!bot && now < b.due) continue;
      const pick = autoBite(L, ctx, b);
      if (pick) { if (bite(L, ctx, b.id, pick.take, pick.give, bot ? Math.max(b.at, Math.min(now, b.due)) : b.due, !bot).ok) n++; }
      else { b.status = "skipped"; b.done = now; }
    }
    return n;
  }
  // A bot vampire's first roster, before week 1: the best free agent for each starting slot, then the best left for
  // the bench.
  function vampireFill(L, ctx, now) {
    const v = vampireOf(L);
    if (v == null || L.teams[v].owner || L.rosters[v].length) return 0;
    const slots = L.settings.lineup, n0 = maxRoster(L), picked = [];
    const pool = ctx.free.filter((p) => !/^(out|ir|o)$/i.test(p.inj || "")).slice(0, 400);
    for (const sl of slots) { const p = pool.find((x) => !picked.includes(x) && S.fits(ctx.sport, x, sl)); if (p) picked.push(p); }
    for (const p of pool) { if (picked.length >= n0) break; if (!picked.includes(p) && !(ctx.sport.late && S.isLate(ctx.sport, p))) picked.push(p); }
    let k = 0;
    for (const p of picked.slice(0, n0)) if (addDrop(L, ctx, v, p.id, null, now).ok) k++;
    return k;
  }
  /* ---------- twists: Robin Hood, Conquest, Kingslayer, The Hangover, pick your opponent, the top-score bonus ---------- */
  // The players a raided team keeps: its `n` most valuable (not counting injured reserve).
  const raidVal = (p) => (p.$ || 0) + Math.max(0, p.vor || 0) * 0.01;
  const protectOf = (L, ctx, team, n) => L.rosters[team].filter((x) => !(L.ir[team] || []).includes(x)).map((x) => ctx.byId[x]).filter(Boolean).sort((a, b) => raidVal(b) - raidVal(a)).slice(0, Math.max(0, n | 0)).map((p) => p.id);
  // settings.robin { protect, like }: after each regular-season week the lowest scorer takes one player from the top
  // scorer (who keeps his `protect` best) and gives one back. settings.conquest { protect, like }: every winner takes one
  // player from the team it beat the same way. Each raid stays open two days into the next week, then it's made for
  // the taker (a bot raids at once).
  function openRaids2(L, ctx, w, games, now) {
    const due = weekStart(L, w + 1) + BITE_HOURS * HOUR;
    const add = (by, victim, why, rule) => { if (by === victim || by == null || victim == null) return; L.bites = L.bites || []; L.bites.push({ id: L.nextId++, week: w, by, victim, why, status: "open", at: now, due, like: !!rule.like, protect: protectOf(L, ctx, victim, rule.protect != null ? rule.protect : 2) }); };
    const rb = L.settings.robin, cq = L.settings.conquest;
    if (rb) {
      const rows = games.flatMap((g) => [[g.a, g.sa], [g.b, g.sb]]).filter(([t, sc]) => L.teams[t] && Number.isFinite(sc));
      if (rows.length >= 2) {
        rows.sort((a, b) => b[1] - a[1] || L.teams[a[0]].priority - L.teams[b[0]].priority);
        const rich = rows[0], poor = rows[rows.length - 1];
        if (rich[1] > poor[1]) add(poor[0], rich[0], "robin", rb);
      }
    }
    if (cq) for (const g of games) if ((g.w === "a" || g.w === "b") && L.teams[g.a] && L.teams[g.b]) add(g.w === "a" ? g.a : g.b, g.w === "a" ? g.b : g.a, "conquest", cq);
  }
  // settings.crown { start, step, keep } (Kingslayer): one team wears the crown and the bounty grows by `step` every week
  // he keeps it; he collects `keep` FAAB for each week he survives. Beat the king and you take the crown and the pot.
  // The first king is settings.crown.king (last season's champion) or else week 1's top scorer.
  function crownWeek(L, games, w, now) {
    const cr = L.settings.crown; if (!cr || w > L.settings.weeks) return;
    const st = (L.crown = L.crown || { king: cr.king != null && L.teams[cr.king] ? cr.king : null, pot: cr.start != null ? cr.start : 10, since: 1, reigns: [] });
    const faab = L.settings.waivers === "faab";
    if (st.king == null) {
      const top = games.flatMap((g) => [[g.a, g.sa], [g.b, g.sb]]).filter(([t, sc]) => L.teams[t] && Number.isFinite(sc)).sort((a, b) => b[1] - a[1])[0];
      if (!top) return;
      Object.assign(st, { king: top[0], since: w + 1, pot: cr.start != null ? cr.start : 10 });
      log(L, now, { type: "crown", team: top[0], text: `${L.teams[top[0]].name} had the top score and takes the crown. The bounty starts at $${st.pot}` });
      return;
    }
    const g = games.find((x) => x.a === st.king || x.b === st.king);
    const lost = g && ((g.w === "a" && g.b === st.king) || (g.w === "b" && g.a === st.king));
    if (lost) {
      const slayer = g.a === st.king ? g.b : g.a, pot = st.pot;
      if (faab) L.teams[slayer].faab += pot;
      st.reigns.push({ king: st.king, from: st.since, to: w, by: slayer, pot });
      log(L, now, { type: "crown", team: slayer, other: st.king, faab: faab ? pot : null, text: `${L.teams[slayer].name} beat the king, ${L.teams[st.king].name}, and takes the crown${faab ? ` and the $${pot} bounty` : ""}` });
      Object.assign(st, { king: slayer, since: w + 1, pot: cr.start != null ? cr.start : 10 });
    } else {
      st.pot += cr.step != null ? cr.step : 10;
      if (faab && cr.keep) L.teams[st.king].faab += cr.keep;
    }
  }
  const kingOf = (L) => (L.crown ? L.crown.king : null);
  // settings.hangover (The Hangover): last week's winners can't add free agents or claim anyone this week.
  function hungover(L, team) {
    if (!L.settings.hangover || L.week < 2 || L.week > L.settings.weeks) return null;
    const res = L.results[L.week - 1], g = Array.isArray(res) ? res.find((x) => x.a === team || x.b === team) : null;
    const won = g && ((g.w === "a" && g.a === team) || (g.w === "b" && g.b === team));
    return won ? `${L.teams[team].name} won last week. The Hangover: no free-agent moves until week ${L.week + 1}` : null;
  }
  // settings.topBonus (guillotine): the week's top scorer gets this much FAAB, a reason to spend early.
  function topBonus(L, w, now) {
    const amt = L.settings.topBonus; if (!amt || !isGuillotine(L)) return;
    const rows = ((L.results[w] && L.results[w].block) || []).filter((r) => !r.out);
    const top = rows.slice().sort((a, b) => b.score - a.score)[0];
    if (!top) return;
    L.teams[top.team].faab += amt;
    log(L, now, { type: "bonus", team: top.team, faab: amt, text: `Top score of week ${w}: ${L.teams[top.team].name} gets $${amt} of FAAB` });
  }
  // settings.pyo (pick your opponent): during week w-1 the teams pick their week w opponents, worst record first (for
  // week 2, the reverse of the draft order). Each team gets 12 hours on its turn; a bot picks at once, and a team that
  // runs out of time gets the weakest team left. Nobody picks the team it plays this week while another is left.
  const PYO_HOURS = 12;
  function pyoOpen(L, ctx, target, now) {
    if (!L.settings.pyo || target < 2 || target > L.settings.weeks) return;
    const ids = L.teams.map((t) => t.id);
    const order = target === 2 ? (L.draft && L.draft.round1 ? L.draft.round1.slice().reverse() : ids) : standings(L).map((r) => r.team).reverse();
    L.pyo = { week: target, order: order.filter((t) => ids.includes(t)), pairs: [], at: now, due: weekStart(L, target) };
  }
  const pyoPaired = (L) => new Set((L.pyo ? L.pyo.pairs : []).flat());
  const pyoTurn = (L) => (L.pyo && !L.pyo.done ? L.pyo.order.find((t) => !pyoPaired(L).has(t)) : null);
  const pyoLast = (L, t, target) => { const g = (L.schedule[target - 2] || []).find((x) => x.includes(t)); return g ? (g[0] === t ? g[1] : g[0]) : null; };
  function pyoOptions(L, t) {
    if (!L.pyo || L.pyo.done) return [];
    const paired = pyoPaired(L), left = L.pyo.order.filter((x) => x !== t && !paired.has(x));
    const fresh = left.filter((x) => x !== pyoLast(L, t, L.pyo.week));
    return fresh.length ? fresh : left;
  }
  function pyoPick(L, ctx, t, opp, now, auto) {
    if (!L.pyo || L.pyo.done) return { ok: false, why: "There's no pick open" };
    if (pyoTurn(L) !== t) return { ok: false, why: "It isn't your turn to pick" };
    if (!pyoOptions(L, t).includes(opp)) return { ok: false, why: opp === pyoLast(L, t, L.pyo.week) ? "You play them this week: pick someone else" : "That team is taken" };
    L.pyo.pairs.push([t, opp]); L.pyo.at = now;
    log(L, now, { type: "pyo", team: t, other: opp, text: `${L.teams[t].name} picked ${L.teams[opp].name} for week ${L.pyo.week}${auto ? " (picked for them)" : ""}` });
    const left = L.pyo.order.filter((x) => !pyoPaired(L).has(x));
    if (left.length === 2) L.pyo.pairs.push([left[0], left[1]]);
    if (left.length <= 2) pyoDone(L, now);
    return { ok: true };
  }
  function pyoDone(L, now) {
    const P = L.pyo; if (!P || P.done) return;
    P.done = now;
    L.schedule[P.week - 1] = P.pairs.map((x) => x.slice());
    (L.picked = L.picked || {})[P.week] = P.pairs.map((x) => x[0]);
  }
  // a bot's pick (and the pick made for a team whose time ran out): the weakest team it can pick
  function pyoAuto(L, ctx, t) {
    const opts = pyoOptions(L, t); if (!opts.length) return null;
    const pf = Object.fromEntries(standings(L).map((r) => [r.team, r]));
    const str = (x) => (L.week > 1 && pf[x] ? (pf[x].w || 0) * 1000 + (pf[x].pf || 0) : 0) + projectedBest(L, ctx, x);
    return opts.sort((a, b) => str(a) - str(b))[0];
  }
  function runPyo(L, ctx, now) {
    let n = 0;
    for (let guard = 0; guard < 40; guard++) {
      const t = pyoTurn(L); if (t == null) break;
      const late = now >= L.pyo.due, slow = now >= L.pyo.at + PYO_HOURS * HOUR;
      if (L.teams[t].owner && !late && !slow) break;
      const opp = pyoAuto(L, ctx, t); if (opp == null) break;
      const at = L.teams[t].owner ? Math.min(now, late ? L.pyo.due : L.pyo.at + PYO_HOURS * HOUR) : now;
      if (pyoPick(L, ctx, t, opp, at, !!L.teams[t].owner).ok) n++; else break;
    }
    if (L.pyo && !L.pyo.done && now >= L.pyo.due) pyoDone(L, now);
    return n;
  }
  const skipBite = (L, id, now) => { const b = (L.bites || []).find((x) => x.id === id && x.status === "open"); if (!b) return { ok: false, why: "No open bite" }; b.status = "skipped"; b.done = now; return { ok: true }; };
  // the vampire's waiver claim always comes first
  function vampireFirst(L) {
    const v = vampireOf(L);
    if (v == null) return;
    const others = L.teams.filter((t) => t.id !== v).sort((a, b) => a.priority - b.priority);
    others.forEach((t, i) => (t.priority = i + 1));
    L.teams[v].priority = 0;
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
      // all-play with an odd number of teams: one team plays a second game so nobody sits out; its score counts once
      const once = new Set();
      for (const g of res) {
        const A = rows[g.a], B = rows[g.b];
        if (tally !== "allplay" || !once.has(g.a)) { A.pf += g.sa; A.pa += g.sb; }
        if (tally !== "allplay" || !once.has(g.b)) { B.pf += g.sb; B.pa += g.sa; }
        once.add(g.a); once.add(g.b);
        const fa = g.w === "a" ? "W" : g.w === "b" ? "L" : "T";
        A.form.push(fa); B.form.push(fa === "W" ? "L" : fa === "L" ? "W" : "T");
        // each category counts: a 6-3 week is six wins and three losses
        if (tally === "cats") { A.w += g.sa; A.l += g.sb; B.w += g.sb; B.l += g.sa; A.t += g.ties || 0; B.t += g.ties || 0; }
        else if (tally !== "allplay") {
          if (g.w === "a") { A.w++; B.l++; } else if (g.w === "b") { B.w++; A.l++; } else { A.t++; B.t++; }
        }
      }
      // median scoring: a second game each week against the league's median score
      if (L.settings.median && tally !== "allplay" && res.length) {
        const sc = res.flatMap((g) => [[g.a, g.sa], [g.b, g.sb]]), xs = sc.map((x) => x[1]).sort((a, b) => a - b);
        const m = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
        for (const [t, x] of sc) { const r = rows[t]; if (x > m) { r.w++; r.mw = (r.mw || 0) + 1; } else if (x < m) { r.l++; r.ml = (r.ml || 0) + 1; } else { r.t++; r.mt = (r.mt || 0) + 1; } }
      }
      // all-play: every team's score against every other team's that week
      if (tally === "allplay") {
        const seen = new Set(), sc = res.flatMap((g) => [[g.a, g.sa], [g.b, g.sb]]).filter(([t]) => !seen.has(t) && seen.add(t));
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
    // divisions: each division's leader, then everyone else, decides the playoff seeds
    if (L.divs) {
      const seeds = seedOrder(L, sorted);
      sorted.forEach((r) => { r.div = L.divs[r.team]; const k = seeds.indexOf(r.team); r.seed = k >= 0 && k < L.settings.playoffTeams ? k + 1 : null; r.inPlayoffs = r.seed != null; r.divLeader = sorted.find((x) => L.divs[x.team] === r.div) === r; });
    }
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
  // Playoff seeding: with divisions, every division winner is seeded ahead of the wild cards (as long as the field
  // has room for all of them), best record first within each group. Without divisions it's the standings.
  function seedOrder(L, st) {
    st = st || standings(L);
    const order = st.map((r) => r.team);
    if (!L.divs || L.settings.playoffTeams < L.settings.divisions) return order;
    const leaders = [];
    for (const t of order) if (!leaders.some((x) => L.divs[x] === L.divs[t])) leaders.push(t);
    return leaders.concat(order.filter((t) => !leaders.includes(t)));
  }
  // The league median for a finished or live week (points of every team that played), or null.
  function medianOf(L, ctx, w, frac = 1) {
    if (!L.settings.median) return null;
    const xs = matchups(L, ctx, w, frac).flatMap((g) => [g.sa, g.sb]).filter((x) => x != null).sort((a, b) => a - b);
    if (!xs.length) return null;
    return xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
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
    const st = standings(L), seeds = seedOrder(L, st).slice(0, s.playoffTeams);
    const cons = s.consolation === "bracket" ? st.map((r) => r.team).filter((t) => !seeds.includes(t)).slice(0, 2 ** R) : [];
    const consR = cons.length >= 2 ? Math.ceil(Math.log2(cons.length)) : 0;
    const seedOf = (t) => { const k = seeds.indexOf(t); return k >= 0 ? k : st.findIndex((r) => r.team === t); };
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
  // A season's records for the league's history: the best and worst weekly scores, the biggest and closest wins, and
  // the longest winning streak. Points leagues only for scores (a category week is a count of categories, not a
  // score); guillotine weeks count their scores too. Playoff games count, marked as such.
  function records(L) {
    const done = Math.min(L.week - 1, totalWeeks(L)), out = {}, name = (t) => L.teams[t] && L.teams[t].name;
    const top = (k, v, x, better) => { if (out[k] == null || better(v, out[k].v)) out[k] = Object.assign({ v }, x); };
    const hi = (a, b) => a > b, lo = (a, b) => a < b;
    const run = {};
    for (let w = 1; w <= done; w++) {
      const res = L.results[w];
      if (!res || res.roto) continue;
      const po = w > L.settings.weeks;
      if (res.block) { for (const r of res.block) { top("high", r.score, { team: r.team, name: name(r.team), week: w }, hi); top("low", r.score, { team: r.team, name: name(r.team), week: w }, lo); } continue; }
      for (const g of res) {
        if (!g.cats) {
          for (const [t, x] of [[g.a, g.sa], [g.b, g.sb]]) { top("high", x, { team: t, name: name(t), week: w, po }, hi); top("low", x, { team: t, name: name(t), week: w, po }, lo); }
          if (g.w === "a" || g.w === "b") {
            const [win, lose, m] = g.w === "a" ? [g.a, g.b, g.sa - g.sb] : [g.b, g.a, g.sb - g.sa];
            const x = { win, lose, winName: name(win), loseName: name(lose), week: w, po, score: g.w === "a" ? [g.sa, g.sb] : [g.sb, g.sa] };
            top("blowout", m, x, hi); top("closest", m, x, lo);
          }
        }
        else if (g.w === "a" || g.w === "b") {                  // a category week: the most lopsided count of categories
          const [win, lose] = g.w === "a" ? [g.a, g.b] : [g.b, g.a], sc = g.w === "a" ? [g.sa, g.sb] : [g.sb, g.sa];
          top("blowout", sc[0] - sc[1], { win, lose, winName: name(win), loseName: name(lose), week: w, po, score: sc, cats: true }, hi);
        }
        if (po) continue;                                      // streaks are regular season only
        for (const [t, r] of [[g.a, "a"], [g.b, "b"]]) {
          run[t] = g.w === r ? (run[t] || 0) + 1 : 0;
          if (run[t] >= 2) top("streak", run[t], { team: t, name: name(t), through: w }, hi);
        }
      }
    }
    for (const k of Object.keys(out)) if (typeof out[k].v === "number") out[k].v = Math.round(out[k].v * 100) / 100;
    return out;
  }
  // A finished season in a few lines, for the league's history.
  function summary(L) {
    const st = standings(L), fin = finish(L), champ = fin.champion != null ? fin.champion : st[0] && st[0].team;
    const who = (t) => (t != null && L.teams[t] ? { team: t, name: L.teams[t].name, owner: L.teams[t].owner } : null);
    // where each team finished: the playoffs decide the top places, the standings the rest
    const place = {}, order = [fin.champion, fin.runnerUp, fin.third].filter((t) => t != null);
    order.forEach((t, i) => (place[t] = i + 1));
    let k = order.length; for (const r of st) if (place[r.team] == null) place[r.team] = ++k;
    return { season: L.season, year: (L.draft && L.draft.year) || 1, sport: L.sport, format: L.settings.format || "h2h", champion: champ != null ? who(champ) : null, runnerUp: who(fin.runnerUp), third: who(fin.third),
      playoffTeams: L.settings.playoffTeams || 0, records: records(L),
      standings: st.map((r) => ({ team: r.team, name: L.teams[r.team].name, owner: L.teams[r.team].owner, rank: r.rank, place: place[r.team], w: r.w, l: r.l, t: r.t, pts: r.pts != null ? r.pts : r.pf, pa: r.pa })) };
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
  // A dynasty's new season: after the rookie draft rosters run long, and every team cuts down before week 1. Bots
  // cut right away; a manager who hasn't by the time week 1 starts loses his lowest-valued bench players.
  const overLimit = (L, team) => Math.max(0, L.rosters[team].length - held(L, team).length - maxRoster(L));
  function cutDown(L, ctx, now, all) {
    let n = 0;
    for (const t of L.teams) {
      if (!all && t.owner) continue;
      stashRookies(L, ctx, t.id, now, true);
      let k = overLimit(L, t.id);
      if (!k) continue;
      const lu = lineupFor(L, ctx, t.id, L.week), ir = held(L, t.id);
      const cut = L.rosters[t.id].filter((id) => !lu.includes(id) && !ir.includes(id)).map((id) => ctx.byId[id]).filter(Boolean).sort((a, b) => (a.vor || 0) - (b.vor || 0));
      for (const p of cut.slice(0, k)) { const r = addDrop(L, ctx, t.id, null, p.id, now); if (r.ok) n++; }
    }
    return n;
  }

  /* ---------- commissioner tools ---------- */
  // Rules the commissioner can change mid-season, and when. Anything that would rewrite games already played
  // (the regular season's length, scoring) only changes before week 1; playoff rules only before the playoffs.
  const RULES = {
    waivers: (v) => (v === "faab" || v === "rolling" ? v : null), waiverHours: (v) => clampInt(v, 0, 168), waiverDays: (v) => clampInt(v, 0, 5), gameLock: (v) => (v === "week" || v === "off" ? v : null), maxAdds: (v) => clampInt(v, 0, 50),
    ir: (v) => clampInt(v, 0, 6), bench: (v) => clampInt(v, 0, 20), deadline: (v) => clampInt(v, 0, 52), tradeReview: (v) => (["vote", "commish", "none"].includes(v) ? v : null),
    waiverOrder: (v) => (v === "rolling" || v === "standings" ? v : null), minBid: (v) => clampInt(v, 0, 5), maxAddsSeason: (v) => clampInt(v, 0, 200),
    reviewHours: (v) => clampInt(v, 1, 168), vetoShare: (v) => (Number.isFinite(+v) && +v > 0 && +v <= 1 ? +v : null), offerHours: (v) => clampInt(v, 1, 336),
    trades: (v) => !!v, median: (v) => !!v, bestBall: (v) => !!v, posMax: (v) => (v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clampInt(x, 0, 30)]).filter(([, x]) => x)) : null),
    playoffTeams: (v) => clampInt(v, 0, 32), playoffLegs: (v) => (["1", "final2", "all2"].includes(String(v)) ? String(v) : null), consolation: (v) => (["none", "third", "bracket"].includes(v) ? v : null),
    weeks: (v) => clampInt(v, 1, 30), taxi: (v) => clampInt(v, 0, 6),
  };
  const clampInt = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : null);
  const PLAYOFF_RULES = ["playoffTeams", "playoffLegs", "consolation"];
  function setRules(L, patch, now) {
    if (isGuillotine(L) && Object.keys(patch).some((k) => ["playoffTeams", "playoffLegs", "consolation", "median", "weeks"].includes(k))) return { ok: false, why: "A guillotine league has no playoffs or schedule to change" };
    const s = L.settings, changed = [];
    for (const [k, raw] of Object.entries(patch)) {
      if (!RULES[k]) return { ok: false, why: `${k} can't be changed` };
      const v = RULES[k](raw);
      if (v == null) return { ok: false, why: `That isn't a valid value for ${k}` };
      if (JSON.stringify(s[k]) === JSON.stringify(v)) continue;
      if (k === "weeks" && L.week > 1) return { ok: false, why: "The season's length can only change before week 1" };
      if (k === "weeks" && (s.format === "roto" || isGuillotine(L))) return { ok: false, why: "This league's length is set by its format" };
      if (PLAYOFF_RULES.includes(k) && L.week > s.weeks) return { ok: false, why: "The playoffs have started" };
      if (k === "median" && (s.format !== "h2h" || s.tally === "allplay" || s.tally === "cats")) return { ok: false, why: "The median game is for head-to-head leagues with one win a week" };
      changed.push(k); s[k] = v;
    }
    if (changed.includes("weeks")) L.schedule = roundRobin(L.teams.length, s.weeks, rng(L.seed + 7));
    if (changed.some((k) => PLAYOFF_RULES.includes(k) || k === "weeks")) {
      s.playoffTeams = Math.min(s.playoffTeams, L.teams.length); if (s.playoffTeams < 2) s.playoffTeams = 0;
      s.playoffWeeks = planOf(s).reduce((a, rd) => a + rd.weeks.length, 0);
    }
    if (changed.length) log(L, now, { type: "commish", team: -1, text: `Rules changed: ${changed.join(", ")}` });
    return { ok: true, changed };
  }
  // Move any player: to another team, or to free agency (to: null). The commissioner's word goes, so roster limits
  // don't block it; a team left over the limit has to cut.
  function commishMove(L, ctx, pid, to, now) {
    const from = L.rosters.findIndex((r) => r.includes(pid));
    if (!ctx.byId[pid]) return { ok: false, why: "No such player" };
    if (from === to) return { ok: false, why: "He's already there" };
    if (to != null && !L.teams[to]) return { ok: false, why: "No such team" };
    if (from >= 0) dropOne(L, from, pid, now);
    delete L.waivers[pid];
    if (to != null) { L.rosters[to].push(pid); joined(L, to, pid, now, ctx); }
    log(L, now, { type: "commish", team: to != null ? to : from, adds: to != null ? [pid] : [], drops: to == null ? [pid] : [], text: `${ctx.byId[pid].n} moved ${from >= 0 ? `from ${L.teams[from].name} ` : ""}${to != null ? `to ${L.teams[to].name}` : "to free agency"} by the commissioner` });
    refresh(L, ctx);
    return { ok: true };
  }
  // Undo an accepted trade, if every player is still where it sent him.
  function reverseTrade(L, ctx, id, now) {
    const t = L.trades.find((x) => x.id === id);
    if (!t || t.status !== "accepted") return { ok: false, why: "Only an accepted trade can be reversed" };
    for (const pid of t.give) if (!L.rosters[t.to].includes(pid)) return { ok: false, why: `${ctx.byId[pid] ? ctx.byId[pid].n : "A player"} isn't on ${L.teams[t.to].name} anymore` };
    for (const pid of t.get) if (!L.rosters[t.from].includes(pid)) return { ok: false, why: `${ctx.byId[pid] ? ctx.byId[pid].n : "A player"} isn't on ${L.teams[t.from].name} anymore` };
    for (const k of t.pickGive || []) if (pickOwner(L, k) !== t.to) return { ok: false, why: "A pick in the trade has moved again" };
    for (const k of t.pickGet || []) if (pickOwner(L, k) !== t.from) return { ok: false, why: "A pick in the trade has moved again" };
    for (const pid of t.give) { dropOne(L, t.to, pid, now); delete L.waivers[pid]; L.rosters[t.from].push(pid); }
    for (const pid of t.get) { dropOne(L, t.from, pid, now); delete L.waivers[pid]; L.rosters[t.to].push(pid); }
    L.teams[t.from].faab += (t.faabGive || 0) - (t.faabGet || 0);
    L.teams[t.to].faab += (t.faabGet || 0) - (t.faabGive || 0);
    for (const k of t.pickGive || []) L.picks[k] = t.from;
    for (const k of t.pickGet || []) L.picks[k] = t.to;
    t.status = "reversed"; t.reversed = now;
    log(L, now, { type: "commish", team: t.from, other: t.to, adds: t.give, drops: t.get, text: "Trade reversed by the commissioner" });
    refresh(L, ctx);
    return { ok: true };
  }
  // Team details: name, abbreviation, FAAB left, and the waiver order (an array of team ids, first in line first).
  function editTeam(L, id, patch, now) {
    const t = L.teams[id];
    if (!t) return { ok: false, why: "No such team" };
    if (patch.name != null) { const n = String(patch.name).replace(/[\x00-\x1f<>]/g, "").trim().slice(0, 28); if (!n) return { ok: false, why: "Give the team a name" }; t.name = n; }
    if (patch.abbr != null) { const a = String(patch.abbr).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4); if (a) t.abbr = a; }
    if (patch.faab != null) { const f = clampInt(patch.faab, 0, 100000); if (f == null) return { ok: false, why: "FAAB must be a number" }; t.faab = f; }
    if (patch.div != null && L.divs) { const d = clampInt(patch.div, 0, L.settings.divisions - 1); if (d == null) return { ok: false, why: "No such division" }; L.divs[id] = d; }
    log(L, now, { type: "commish", team: id, text: `Team details changed by the commissioner` });
    return { ok: true };
  }
  function setWaiverOrder(L, order, now) {
    if (!Array.isArray(order) || order.length !== L.teams.length || new Set(order).size !== order.length || order.some((x) => !L.teams[x])) return { ok: false, why: "Put every team in the order once" };
    order.forEach((id, i) => (L.teams[id].priority = i));
    log(L, now, { type: "commish", team: -1, text: "Waiver order changed by the commissioner" });
    return { ok: true };
  }
  function setDivisions(L, names, now) {
    if (!L.divs) return { ok: false, why: "This league has no divisions" };
    const ns = (names || []).map((x) => String(x || "").replace(/[\x00-\x1f<>]/g, "").trim().slice(0, 24));
    if (ns.length !== L.settings.divisions || ns.some((x) => !x)) return { ok: false, why: "Name every division" };
    L.divNames = ns;
    return { ok: true };
  }

  /* ---------- the trading block ---------- */
  // Players a team says it would move. A manager lists his own (L.block). A bot lists the bench players it can
  // spare most: its best two off the bench, leaving kickers and defenses out.
  function blockOf(L, ctx, team) {
    const ros = L.rosters[team] || [], set = L.block && L.block[team];
    if (L.teams[team].owner || set) return (set || []).filter((id) => ros.includes(id));
    if (!isAlive(L, team)) return [];
    const lu = lineupFor(L, ctx, team, Math.min(L.week, totalWeeks(L))), ir = held(L, team);
    return ros.filter((id) => !lu.includes(id) && !ir.includes(id)).map((id) => ctx.byId[id])
      .filter((p) => p && !(ctx.sport.late && S.isLate(ctx.sport, p))).sort((a, b) => b.vor - a.vor).slice(0, 2).map((p) => p.id);
  }
  function setBlock(L, team, pid, on) {
    if (!(L.rosters[team] || []).includes(pid)) return { ok: false, why: "He isn't on your team" };
    L.block = L.block || {};
    const cur = (L.block[team] || []).filter((id) => L.rosters[team].includes(id));
    const i = cur.indexOf(pid);
    if (on && i < 0) { if (cur.length >= 6) return { ok: false, why: "Six on the block at most. Take someone off first." }; cur.push(pid); }
    if (!on && i >= 0) cur.splice(i, 1);
    L.block[team] = cur;
    return { ok: true };
  }
  // What a team is looking for, in its own words (a manager's note) or, for a bot, the position it's weakest at.
  function blockNote(L, ctx, team) {
    if (L.blockNote && L.blockNote[team]) return L.blockNote[team];
    if (L.teams[team].owner) return "";
    const lu = lineupFor(L, ctx, team, Math.min(L.week, totalWeeks(L))), slots = L.settings.lineup;
    let worst = null;
    slots.forEach((sl, i) => {
      if (ctx.sport.slots[sl] === "*" || (ctx.sport.late || []).includes(sl)) return;
      const p = lu[i] && ctx.byId[lu[i]], v = p ? p.vor : -1e9;
      if (!worst || v < worst.v) worst = { sl, v };
    });
    return worst ? `Looking for ${worst.sl === "FLEX" || worst.sl === "SFLEX" || worst.sl === "UTIL" || worst.sl === "UT" ? "depth" : `a ${worst.sl}`}` : "";
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
  // Waivers run like the big leagues': a dropped player clears at the processing hour (3 AM Eastern) after
  // settings.waiverDays full business days (drop on Monday with 2 days, he clears early Thursday), and the claims on
  // him run then, highest bid first. In football (settings.gameLock "week"), a free agent whose game has started this
  // week can't be picked up until next week: he goes on waivers until the first processing time of the next week.
  const PROCESS_HOUR = 3;
  // the wall clock in New York for a moment: { y, m, d, wd (0 Sunday), h }
  function etParts(ms) {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", hourCycle: "h23" });
    const o = {}; for (const x of f.formatToParts(new Date(ms))) o[x.type] = x.value;
    return { y: +o.year, m: +o.month, d: +o.day, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday), h: +o.hour % 24 };
  }
  // the moment a New York date and hour happens (Eastern is UTC-4 or UTC-5; try both)
  function etAt(y, m, d, h) {
    for (const off of [4, 5]) { const ms = Date.UTC(y, m - 1, d, h + off); const q = etParts(ms); if (q.d === d && q.h === h) return ms; }
    return Date.UTC(y, m - 1, d, h + 5);
  }
  const nextDay = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d + 1)); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; };
  const weekday = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const waiverDays = (L) => (L.settings.waiverDays != null ? L.settings.waiverDays : Math.round((L.settings.waiverHours != null ? L.settings.waiverHours : 48) / 24));
  // when a player dropped at `now` clears: the processing hour the day after `days` full business days
  function waiverClear(L, now, days = waiverDays(L)) {
    if (!days) return now;
    const t = etParts(now);
    let [y, m, d] = [t.y, t.m, t.d], left = days;
    while (left > 0) { [y, m, d] = nextDay(y, m, d); const wd = weekday(y, m, d); if (wd !== 0 && wd !== 6) left--; }
    [y, m, d] = nextDay(y, m, d);
    return etAt(y, m, d, PROCESS_HOUR);
  }
  // the first processing time once next week has started
  function nextWeekClear(L) {
    const t = etParts(weekStart(L, L.week + 1));
    let at = etAt(t.y, t.m, t.d, PROCESS_HOUR);
    if (at < weekStart(L, L.week + 1)) { const [y, m, d] = nextDay(t.y, t.m, t.d); at = etAt(y, m, d, PROCESS_HOUR); }
    return at;
  }
  const gameLockOn = (L) => (L.settings.gameLock ? L.settings.gameLock === "week" : L.sport === "nfl");
  // free agents whose game this week has started: on waivers until next week
  function lockPlayed(L, ctx, now) {
    if (!gameLockOn(L) || !L.kick || L.kick.week !== L.week) return 0;
    const started = new Set(Object.entries(L.kick.teams).filter(([, at]) => now >= at).map(([t]) => t));
    if (!started.size) return 0;
    const until = nextWeekClear(L);
    let n = 0;
    for (const p of ctx.free) if (started.has(p.t) && !(L.waivers[p.id] > now)) { L.waivers[p.id] = until; n++; }
    return n;
  }
  // when a player clears: his own waiver time (a drop, a game lock), or, right after the draft, when the whole
  // undrafted pool clears (L.openWaivers), so the first manager online doesn't get the best of it
  const clearAt = (L, pid) => (L.waivers[pid] != null ? L.waivers[pid] : L.openWaivers || null);
  const onWaivers = (L, pid, now) => { const at = clearAt(L, pid); return at != null && at > now; };
  // Pickups this week: adds and won claims (trades don't count). settings.maxAdds caps them, if set.
  const pickups = (L, teamId) => L.tx.filter((x) => x.team === teamId && x.week === L.week && (x.type === "add" || x.type === "add/drop" || x.type === "waiver")).length;
  // settings.maxAddsSeason: a cap on pickups for the whole season (a vampire's first roster doesn't count)
  const seasonPickups = (L, teamId) => L.tx.filter((x) => x.team === teamId && (x.type === "add" || x.type === "add/drop" || x.type === "waiver") && !(vampireOf(L) === teamId && x.week === 1)).length;
  const seasonPickupsLeft = (L, teamId) => (L.settings.maxAddsSeason ? Math.max(0, L.settings.maxAddsSeason - seasonPickups(L, teamId)) : Infinity);
  // (a vampire filling its first roster isn't held to the weekly limit)
  const pickupsLeft = (L, teamId) => (L.settings.maxAdds && !(vampireOf(L) === teamId && L.week === 1) ? Math.max(0, L.settings.maxAdds - pickups(L, teamId)) : Infinity);
  function canRoster(L, ctx, teamId, add, drops, pickup) {
    if (L.week > totalWeeks(L)) return { ok: false, why: "The season is over" };
    if (!isAlive(L, teamId)) return { ok: false, why: "That team has been chopped" };
    const ros = L.rosters[teamId].filter((id) => !(drops || []).includes(id));
    const hg = add && pickup ? hungover(L, teamId) : null;
    if (hg) return { ok: false, why: hg };
    if (add && pickup && pickupsLeft(L, teamId) <= 0) return { ok: false, why: `You've used all ${L.settings.maxAdds} pickups this week` };
    if (add && pickup && seasonPickupsLeft(L, teamId) <= 0) return { ok: false, why: `You've used all ${L.settings.maxAddsSeason} pickups for the season` };
    // settings.posMax { QB: 4 }: at most that many players whose main position it is
    const pm = L.settings.posMax || {}, ap = add && ctx.byId[add] ? S.positions(ctx.byId[add])[0] : null;
    if (ap && pm[ap] && ros.filter((id) => ctx.byId[id] && S.positions(ctx.byId[id])[0] === ap).length >= pm[ap]) return { ok: false, why: `A roster can have at most ${pm[ap]} ${ap}` };
    const irKept = held(L, teamId).filter((x) => !(drops || []).includes(x)).length;
    // a drop on its own always goes through (a dynasty roster cutting down can be over the limit)
    if (add && ros.length + 1 > maxRoster(L) + irKept) return { ok: false, why: ros.length > maxRoster(L) + irKept ? `Roster is over the limit: drop ${ros.length - maxRoster(L) - irKept + 1} first` : "Roster is full: pick someone to drop" };
    if (ctx.hooks.check) { const c = ctx.hooks.check(L, teamId, add ? ctx.byId[add] : null, drops, ctx); if (c && !c.ok) return c; }
    return { ok: true };
  }
  function dropOne(L, teamId, pid, now) {
    L.rosters[teamId] = L.rosters[teamId].filter((x) => x !== pid);
    L.ir[teamId] = (L.ir[teamId] || []).filter((x) => x !== pid);
    if (L.taxi && L.taxi[teamId]) L.taxi[teamId] = L.taxi[teamId].filter((x) => x !== pid);
    for (const w of Object.keys(L.lineups)) if (+w >= L.week && L.lineups[w][teamId]) L.lineups[w][teamId] = L.lineups[w][teamId].map((x) => (x === pid ? null : x));
    L.waivers[pid] = waiverClear(L, now);
  }
  // A free agent who isn't on waivers: added right away.
  function addDrop(L, ctx, teamId, add, drop, now) {
    if (L.week > totalWeeks(L)) return { ok: false, why: "The season is over" };
    // after a heist rosters are set for the week: the only move is filling a spot a steal emptied
    if (L.settings.frozen && drop) return { ok: false, why: "Rosters are set for the week. You can only fill a spot a steal emptied" };
    if (add && ctx.own[add] != null) return { ok: false, why: `${ctx.byId[add].n} is on a roster` };
    if (add && gameLockOn(L) && !onWaivers(L, add, now) && isLocked(L, ctx.byId[add], L.week, now)) L.waivers[add] = nextWeekClear(L);
    if (add && onWaivers(L, add, now)) return { ok: false, why: `${ctx.byId[add].n} is on waivers until ${waiverWhen(clearAt(L, add))}: put in a claim` };
    if (drop && !L.rosters[teamId].includes(drop)) return { ok: false, why: "That player isn't on your roster" };
    if (drop && lockedStarter(L, ctx, teamId, drop, now)) return { ok: false, why: lockWhy(ctx.byId[drop]) };
    const ok = canRoster(L, ctx, teamId, add, drop ? [drop] : [], true);
    if (!ok.ok) return ok;
    if (drop) { bank(L, ctx, teamId, drop, now); dropOne(L, teamId, drop, now); }
    if (add) { L.rosters[teamId].push(add); delete L.waivers[add]; joined(L, teamId, add, now, ctx); }
    // a heist fill-in goes straight into the open spot he fits
    if (add && L.settings.frozen) {
      const w = L.week, cur = lineupFor(L, ctx, teamId, w).slice(), i = cur.findIndex((id, k) => !id && S.fits(ctx.sport, ctx.byId[add], L.settings.lineup[k]));
      if (i >= 0) { cur[i] = add; (L.lineups[w] = L.lineups[w] || {})[teamId] = cur; }
    }
    log(L, now, { type: add && drop ? "add/drop" : add ? "add" : "drop", team: teamId, adds: add ? [add] : [], drops: drop ? [drop] : [] });
    refresh(L, ctx);
    return { ok: true };
  }
  function claim(L, ctx, teamId, add, drop, bid, now) {
    if (L.settings.frozen && drop) return { ok: false, why: "Rosters are set for the week" };
    if (ctx.own[add] != null) return { ok: false, why: `${ctx.byId[add].n} is on a roster` };
    bid = Math.max(L.settings.minBid, Math.round(bid || 0));
    if (L.settings.waivers === "faab" && bid > L.teams[teamId].faab) return { ok: false, why: `You have $${L.teams[teamId].faab} of FAAB` };
    if (drop && lockedStarter(L, ctx, teamId, drop, now)) return { ok: false, why: lockWhy(ctx.byId[drop]) };
    const ok = canRoster(L, ctx, teamId, add, drop ? [drop] : [], true);
    if (!ok.ok) return ok;
    // changing a claim keeps its place in your claim order
    const was = L.claims.find((c) => c.team === teamId && c.add === add && c.status === "open");
    L.claims = L.claims.filter((c) => c !== was);
    L.claims.push({ id: L.nextId++, team: teamId, add, drop: drop || null, bid, at: was ? was.at : now, ord: was ? claimOrd(was) : now, status: "open" });
    return { ok: true };
  }
  // A team's own claims run in this order: highest bid first, then the order the team set.
  const claimOrd = (c) => (c.ord != null ? c.ord : c.at);
  const myClaims = (L, teamId) => L.claims.filter((c) => c.team === teamId && c.status === "open").sort((a, b) => b.bid - a.bid || claimOrd(a) - claimOrd(b));
  // Move a claim up or down among the team's claims. With FAAB the bid decides, so only claims with the same bid can swap.
  function moveClaim(L, teamId, id, dir) {
    const list = myClaims(L, teamId), i = list.findIndex((c) => c.id === id), j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return { ok: false, why: "That claim can't move that way" };
    const a = list[i], b = list[j];
    if (L.settings.waivers === "faab" && a.bid !== b.bid) return { ok: false, why: "The higher bid runs first: change a bid to change the order" };
    const x = claimOrd(a); a.ord = claimOrd(b); b.ord = x;
    if (a.ord === b.ord) a.ord += dir < 0 ? -1 : 1;
    return { ok: true };
  }
  const cancelClaim = (L, id) => { const c = L.claims.find((x) => x.id === id && x.status === "open"); if (!c) return { ok: false, why: "No such claim" }; c.status = "cancelled"; return { ok: true }; };
  // Highest bid wins; ties go to waiver priority. A team that wins moves to the back of the priority line.
  // settings.waiverPrice "second" (a Vickrey auction): the winner pays the second-highest bid plus $1, never more
  // than his own bid, so the best bid is simply what the player is worth to you. A lone bid pays the lowest bid.
  const vickrey = (L) => L.settings.waivers === "faab" && L.settings.waiverPrice === "second";
  function waiverPrice(L, c, rivals) {
    if (!vickrey(L)) return c.bid;
    const others = rivals.filter((x) => x !== c).map((x) => Math.min(x.bid, L.teams[x.team].faab));
    const second = others.length ? Math.max(...others) : null;
    return Math.min(c.bid, second == null ? Math.max(0, L.settings.minBid || 0) : second + 1);
  }
  const waiverWhen = (at) => new Date(at).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET";
  // claims for the players whose waivers have cleared, each batch at the moment it cleared
  function runDue(L, ctx, now) {
    const open = L.claims.filter((c) => c.status === "open");
    const due = [...new Set(open.filter((c) => clearAt(L, c.add) != null && clearAt(L, c.add) <= now).map((c) => clearAt(L, c.add)))].sort((a, b) => a - b);
    let n = 0;
    for (const at of due) n += runWaivers(L, ctx, at, new Set(open.filter((c) => c.status === "open" && clearAt(L, c.add) === at).map((c) => c.add))).length;
    // a claim on a player who's off waivers already (a free agent now) runs right away
    const loose = new Set(open.filter((c) => c.status === "open" && clearAt(L, c.add) == null).map((c) => c.add));
    if (loose.size) n += runWaivers(L, ctx, now, loose).length;
    return n;
  }
  function runWaivers(L, ctx, now, only) {
    const open = L.claims.filter((c) => c.status === "open" && (!only || only.has(c.add)));
    const won = [];
    // highest bid first; on a tie the better waiver priority, which changes after every win, then the earlier claim
    const next = () => open.filter((c) => c.status === "open").sort((a, b) => b.bid - a.bid || L.teams[a.team].priority - L.teams[b.team].priority || claimOrd(a) - claimOrd(b))[0];
    for (let c = next(); c; c = next()) {
      const t = L.teams[c.team];
      const rivals = open.filter((x) => x.add === c.add && x.status === "open");
      c.done = now; c.week = L.week;
      const why = ctx.own[c.add] != null ? `${(ctx.byId[c.add] || {}).n || "He"} was already taken`
        : L.settings.waivers === "faab" && c.bid > t.faab ? `Only $${t.faab} left by then`
        : c.drop && !L.rosters[c.team].includes(c.drop) ? `${(ctx.byId[c.drop] || {}).n || "Your drop"} was already gone`
        : c.drop && lockedStarter(L, ctx, c.team, c.drop, now) ? `${(ctx.byId[c.drop] || {}).n || "Your drop"} was locked in your lineup`
        : !canRoster(L, ctx, c.team, c.add, c.drop ? [c.drop] : [], true).ok ? canRoster(L, ctx, c.team, c.add, c.drop ? [c.drop] : [], true).why.replace("Roster is full: pick someone to drop", "No roster spot open") : null;
      if (why) { c.status = "failed"; c.why = why; continue; }
      if (c.drop) { bank(L, ctx, c.team, c.drop, now); dropOne(L, c.team, c.drop, now); }
      L.rosters[c.team].push(c.add); delete L.waivers[c.add]; joined(L, c.team, c.add, now, ctx);
      const price = waiverPrice(L, c, rivals);
      if (L.settings.waivers === "faab") { t.faab -= price; c.paid = price; }
      c.status = "won";
      for (const x of rivals) if (x !== c) { x.status = "lost"; x.lostTo = c.team; x.done = now; x.week = L.week; }
      const mx = Math.max(...L.teams.map((x) => x.priority));
      for (const x of L.teams) if (x.priority > t.priority) x.priority--;
      t.priority = mx;
      vampireFirst(L);
      log(L, now, { type: "waiver", team: c.team, adds: [c.add], drops: c.drop ? [c.drop] : [], faab: L.settings.waivers === "faab" ? price : null, bid: vickrey(L) ? c.bid : undefined, bids: rivals.length });
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
    if (taxiOf(L, teamId).includes(pid)) return { ok: false, why: `${p.n} is on the taxi squad` };
    if (!irSlots(L)) return { ok: false, why: "This league has no IR spots" };
    if (ir.length >= irSlots(L)) return { ok: false, why: `Your IR ${irSlots(L) === 1 ? "spot is" : "spots are"} full` };
    if (!irEligible(p)) return { ok: false, why: `${p.n} isn't out or on IR, so he can't go there` };
    if (lockedStarter(L, ctx, teamId, pid, now)) return { ok: false, why: lockWhy(p) };
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
    if (drop && lockedStarter(L, ctx, teamId, drop, now)) return { ok: false, why: lockWhy(ctx.byId[drop]) };
    L.ir[teamId] = ir.filter((x) => x !== pid);
    joined(L, teamId, pid, now, ctx);
    if (drop) { bank(L, ctx, teamId, drop, now); dropOne(L, teamId, drop, now); log(L, now, { type: "drop", team: teamId, adds: [], drops: [drop] }); }
    log(L, now, { type: "ir", team: teamId, adds: [], drops: [], text: `${p.n} back from IR` });
    refresh(L, ctx);
    return { ok: true };
  }
  // Players who can't stay on IR any longer (they're healthy) block other moves until they come off, like Yahoo.
  const irBlocked = (L, ctx, teamId) => (L.ir[teamId] || []).filter((id) => !irEligible(ctx.byId[id]));

  /* ---------- dynasty taxi squads ---------- */
  // settings.taxi: spots on each dynasty roster for rookies to develop. Like IR, they don't count against the roster
  // and they can't start. A rookie, or anyone a team took in its rookie draft, can go there; once a player is promoted
  // he can't go back. A player traded off a taxi squad arrives active.
  const taxiOf = (L, t) => (L.taxi && L.taxi[t]) || [];
  const held = (L, t) => (L.ir[t] || []).concat(taxiOf(L, t));
  const taxiSlots = (L) => (L.settings.dynasty ? Math.max(0, L.settings.taxi || 0) : 0);
  const taxiEligible = (L, ctx, pid) => { const p = ctx.byId[pid]; return !!p && !(L.promoted && L.promoted[pid]) && !!(p.rk || (L.taxiOk && L.taxiOk[pid])); };
  function toTaxi(L, ctx, teamId, pid, now) {
    const p = ctx.byId[pid];
    if (L.week > totalWeeks(L)) return { ok: false, why: "The season is over" };
    if (!taxiSlots(L)) return { ok: false, why: "This league has no taxi squad" };
    if (!L.rosters[teamId].includes(pid)) return { ok: false, why: "He isn't on your roster" };
    if ((L.ir[teamId] || []).includes(pid)) return { ok: false, why: `${p.n} is on IR` };
    const tx = ((L.taxi = L.taxi || L.teams.map(() => []))[teamId] = L.taxi[teamId] || []);
    if (tx.includes(pid)) return { ok: false, why: `${p.n} is already on the taxi squad` };
    if (tx.length >= taxiSlots(L)) return { ok: false, why: "Your taxi squad is full" };
    if (L.promoted && L.promoted[pid]) return { ok: false, why: `${p.n} was promoted, so he can't go back` };
    if (!taxiEligible(L, ctx, pid)) return { ok: false, why: `Only rookies can go on the taxi squad` };
    bank(L, ctx, teamId, pid, now);
    tx.push(pid);
    for (const w of Object.keys(L.lineups)) if (+w >= L.week && L.lineups[w][teamId]) L.lineups[w][teamId] = L.lineups[w][teamId].map((x) => (x === pid ? null : x));
    log(L, now, { type: "taxi", team: teamId, adds: [], drops: [], text: `${p.n} to the taxi squad` });
    return { ok: true };
  }
  // Up from the taxi squad for good: he needs a roster spot, so a full roster drops someone.
  function promote(L, ctx, teamId, pid, drop, now) {
    const tx = taxiOf(L, teamId), p = ctx.byId[pid];
    if (L.week > totalWeeks(L)) return { ok: false, why: "The season is over" };
    if (!tx.includes(pid)) return { ok: false, why: `${p ? p.n : "He"} isn't on the taxi squad` };
    if (L.rosters[teamId].length - held(L, teamId).length + 1 > maxRoster(L) && !drop) return { ok: false, why: "Your roster is full: drop someone to promote him", needDrop: true };
    if (drop && (drop === pid || !L.rosters[teamId].includes(drop) || held(L, teamId).includes(drop))) return { ok: false, why: "Pick someone on your active roster to drop" };
    L.taxi[teamId] = tx.filter((x) => x !== pid);
    (L.promoted = L.promoted || {})[pid] = true;
    joined(L, teamId, pid, now, ctx);
    if (drop) { bank(L, ctx, teamId, drop, now); dropOne(L, teamId, drop, now); log(L, now, { type: "drop", team: teamId, adds: [], drops: [drop] }); }
    log(L, now, { type: "taxi", team: teamId, adds: [], drops: [], text: `${p.n} promoted from the taxi squad` });
    refresh(L, ctx);
    return { ok: true };
  }
  // Fills open taxi spots with a team's best eligible rookies who aren't starting. Bots do it whenever they have room;
  // cutDown does it for everyone before anyone is dropped.
  function stashRookies(L, ctx, teamId, now, onlyIfOver) {
    let n = 0;
    while (taxiOf(L, teamId).length < taxiSlots(L) && (!onlyIfOver || overLimit(L, teamId) > 0)) {
      const lu = lineupFor(L, ctx, teamId, L.week), h = held(L, teamId);
      const p = L.rosters[teamId].filter((id) => !lu.includes(id) && !h.includes(id) && taxiEligible(L, ctx, id)).map((id) => ctx.byId[id]).sort((a, b) => (b.vor || 0) - (a.vor || 0))[0];
      if (!p || !toTaxi(L, ctx, teamId, p.id, now).ok) break;
      n++;
    }
    return n;
  }

  /* ---------- trades ---------- */
  // Trade value: auction dollars (at least $1 a player) plus FAAB at a tenth of a dollar per dollar.
  /* ---------- dynasty: next season's draft picks, traded like players ---------- */
  // settings.dynasty = { rounds, picks }: every roster carries over, next season opens with a rounds-long rookie and
  // free agent draft, and when picks is on those picks can be traded. A pick is "round:team", the team it started
  // with; L.picks maps a traded pick to the team that holds it now.
  // A dynasty's offseason: the season is over and the next hasn't started. Trades stay open (players and picks).
  const offseason = (L) => !!L.settings.dynasty && !isGuillotine(L) && L.week > totalWeeks(L);
  // Picks for next season are "round:team"; the season after that, "round:team:2". When a new season starts, the
  // later ones become next season's.
  const PICK_YEARS = 2;
  const pickYear = (key) => +(key.split(":")[2] || 1);
  const pickRounds = (L) => (L.settings.dynasty && L.settings.dynasty.picks !== false ? L.settings.dynasty.rounds || 3 : 0);
  const pickOwner = (L, key) => { const o = L.picks && L.picks[key]; return o != null ? o : +key.split(":")[1]; };
  function picksOf(L, team) {
    const out = [], R = pickRounds(L);
    for (let y = 1; y <= (R ? PICK_YEARS : 0); y++) for (let r = 1; r <= R; r++) for (const t of L.teams) { const k = y > 1 ? `${r}:${t.id}:${y}` : `${r}:${t.id}`; if (pickOwner(L, k) === team) out.push(k); }
    return out;
  }
  const pickLabel = (L, key) => { const [r, t] = key.split(":").map(Number); return `${pickYear(key) > 1 ? "Two seasons out: " : ""}${ordinal(r)}-round pick${pickOwner(L, key) !== t ? `, from ${L.teams[t].name}` : ""}`; };
  // What a pick is worth: the free agent who'd go about there, by where its team sits in the standings now (worst
  // picks first), plus a little for the upside of a rookie.
  function pickSlot(L, key) {
    const [r, t] = key.split(":").map(Number), n = L.teams.length;
    const order = standings(L).map((x) => x.team).reverse();
    return (r - 1) * n + (pickYear(key) > 1 ? Math.floor(n / 2) : Math.max(0, order.indexOf(t)));
  }
  // Next year's class (ctx.hooks.prospects, from the Big Board) as this league would draft it: each prospect priced
  // against this league's players at his position, then in order of that price, so a 1-QB league lets quarterbacks
  // slide and a superflex league doesn't. His board score (weighted average rank) stands in for draft capital: the
  // consensus top prospect compares to about the 5th player at his position, and each step down the board is worth
  // less as the board goes on (the square root), so a clear #1 stands apart and the middle of a class bunches up.
  const CLASS_FIT = { nfl: { RB: [2, 3], WR: [3, 3.2], TE: [4, 2.6], QB: [5, 3] }, nba: { "*": [10, 9] } };
  function classValues(L, ctx) {
    const cls = ctx.hooks && ctx.hooks.prospects, fit = CLASS_FIT[ctx.sport.key];
    if (!cls || !cls.length || !fit) return null;
    if (ctx._class && ctx._class.src === cls) return ctx._class.list;
    const byPos = {};
    const curve = (pos) => byPos[pos] || (byPos[pos] = ctx.players.filter((p) => pos === "*" || S.positions(p)[0] === pos).map((p) => Math.max(0, p.$ || 0)).sort((a, b) => b - a));
    const list = cls.map((pr) => {
      const pos = fit["*"] ? "*" : String(pr.pos).split("/").find((x) => fit[x]);
      if (!pos) return null;
      const [a, b] = fit[pos], at = Math.round(a + b * Math.sqrt(Math.max(1, pr.score || pr.rank))) - 1, c = curve(pos);
      return { pr, v: c.length ? c[Math.min(c.length - 1, at)] : 0, like: at + 1, pos };
    }).filter(Boolean).sort((x, y) => y.v - x.v || (x.pr.score || x.pr.rank) - (y.pr.score || y.pr.rank));
    ctx._class = { src: cls, list };
    return list;
  }
  // The prospect next year's class puts at a pick's slot, or null (and none for a pick two seasons out).
  const pickProspect = (L, ctx, key) => { const cl = pickYear(key) === 1 && classValues(L, ctx); return cl ? (cl[pickSlot(L, key)] || {}).pr || null : null; };
  function pickValue(L, ctx, key) {
    const r = +key.split(":")[0], far = pickYear(key) > 1, slot = pickSlot(L, key), R = pickRounds(L) || 3, n = L.teams.length;
    // a pick two seasons out could land anywhere, so it's priced at the middle of its round, and a little lower
    const pool = ctx.free.slice().sort((a, b) => (b.$ || 0) - (a.$ || 0));
    const fa = (pool[slot] && pool[slot].$) || 1, cl = classValues(L, ctx);
    // no class to go on (baseball, or the board didn't load): the free agent at that slot, plus a rookie's upside
    if (!cl) return Math.max(2, (fa * 1.3 + (R - r + 1) * 2) * (far ? 0.85 : 1));
    // with the class: the better of the prospect and the free agent at that slot, plus a little that steps down pick
    // by pick, so a late 2nd is still worth more than a late 3rd when both are $1 players
    const v = Math.max(fa, (cl[slot] || { v: 0 }).v, 1) + 2 * R * Math.max(0, 1 - slot / (R * n));
    return Math.max(1, v * (far ? 0.85 : 1));
  }
  const ordinal = (k) => k + (k % 100 >= 11 && k % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[k % 10] || "th");
  const pValue = (ctx, id) => Math.max(1, (ctx.byId[id] && ctx.byId[id].$) || 0) + Math.max(0, (ctx.byId[id] && ctx.byId[id].vor) || 0) * 0.01;
  const sideValue = (ctx, ids, faab = 0) => sum(ids.map((id) => pValue(ctx, id))) + faab * 0.1;
  function tradeCheck(L, ctx, t, now) {
    if (L.settings.trades === false) return { ok: false, why: "This league has no trades" };
    if (!isAlive(L, t.from) || !isAlive(L, t.to)) return { ok: false, why: "That team has been chopped" };
    if (t.from === t.to) return { ok: false, why: "Pick another team" };
    const pg = t.pickGive || [], pr = t.pickGet || [];
    if (!t.give.length && !t.get.length && !pg.length && !pr.length) return { ok: false, why: "Add at least one player" };
    for (const k of pg) if (pickOwner(L, k) !== t.from) return { ok: false, why: `${L.teams[t.from].name} doesn't have that pick` };
    for (const k of pr) if (pickOwner(L, k) !== t.to) return { ok: false, why: `${L.teams[t.to].name} doesn't have that pick` };
    if ((pg.length || pr.length) && !pickRounds(L)) return { ok: false, why: "This league doesn't trade draft picks" };
    const off = offseason(L);
    if (!off && L.settings.deadline && L.week > L.settings.deadline) return { ok: false, why: `The trade deadline was week ${L.settings.deadline}` };
    if (!off && L.week > totalWeeks(L)) return { ok: false, why: "The season is over" };
    const busy = new Set(L.trades.filter((x) => x.status === "review" && x.id !== t.id).flatMap((x) => x.give.concat(x.get)));
    for (const id of t.give.concat(t.get)) if (busy.has(id)) return { ok: false, why: `${ctx.byId[id].n} is already in a trade the league is reviewing` };
    for (const id of t.give) if (!L.rosters[t.from].includes(id)) return { ok: false, why: `${ctx.byId[id].n} isn't on ${L.teams[t.from].name}` };
    if (now != null) for (const [team, ids] of [[t.from, t.give], [t.to, t.get]]) for (const id of ids) if (lockedStarter(L, ctx, team, id, now)) return { ok: false, why: `${lockWhy(ctx.byId[id])}. Try again after the week` };
    for (const id of t.get) if (!L.rosters[t.to].includes(id)) return { ok: false, why: `${ctx.byId[id].n} isn't on ${L.teams[t.to].name}` };
    if ((t.faabGive || 0) > L.teams[t.from].faab || (t.faabGet || 0) > L.teams[t.to].faab) return { ok: false, why: "Not enough FAAB" };
    const after = (team, out, inn, drops) => L.rosters[team].length - out.length + inn.length - drops.length;
    const irLeft = (team, out) => held(L, team).filter((x) => !out.includes(x)).length;   // IR players traded away arrive active
    // the offseason has no roster limit: rosters cut down before next season's week 1 anyway
    if (!off && after(t.from, t.give, t.get, t.dropsFrom || []) > maxRoster(L) + irLeft(t.from, t.give)) return { ok: false, why: `${L.teams[t.from].name} would have too many players: add a drop` };
    if (!off && after(t.to, t.get, t.give, t.dropsTo || []) > maxRoster(L) + irLeft(t.to, t.get)) return { ok: false, why: `${L.teams[t.to].name} would have too many players` };
    if (ctx.hooks.tradeCheck) { const c = ctx.hooks.tradeCheck(L, t, ctx); if (c && !c.ok) return c; }
    return { ok: true };
  }
  function propose(L, ctx, from, to, give, get, now, extra = {}) {
    const t = { id: L.nextId++, from, to, give: give.slice(), get: get.slice(), pickGive: (extra.pickGive || []).slice(), pickGet: (extra.pickGet || []).slice(), faabGive: extra.faabGive || 0, faabGet: extra.faabGet || 0, dropsFrom: extra.dropsFrom || [], dropsTo: [], note: extra.note || "", at: now, status: "pending", counterOf: extra.counterOf || null };
    const c = tradeCheck(L, ctx, t, now);
    if (!c.ok) return c;
    if (t.counterOf) { const o = L.trades.find((x) => x.id === t.counterOf); if (o && o.status === "pending") { o.status = "countered"; o.done = now; } }
    L.trades.push(t);
    return { ok: true, trade: t };
  }
  function respond(L, ctx, id, accept, now, why) {
    const t = L.trades.find((x) => x.id === id);
    if (!t || t.status !== "pending") return { ok: false, why: "That offer is no longer open" };
    if (!accept) { t.status = "rejected"; t.done = now; t.why = why || ""; return { ok: true }; }
    const c = tradeCheck(L, ctx, t, now);
    if (!c.ok) return c;
    if (L.settings.tradeReview === "none") return execute(L, ctx, t, now);
    t.status = "review"; t.accepted = now; t.reviewEnds = now + L.settings.reviewHours * HOUR; t.votes = {};
    return { ok: true, review: true };
  }
  const cancelTrade = (L, id, now) => { const t = L.trades.find((x) => x.id === id && x.status === "pending"); if (!t) return { ok: false, why: "No open offer" }; t.status = "cancelled"; t.done = now; return { ok: true }; };
  // tradeReview "commish": the commissioner reviews alone (commishVeto), so the league has no votes
  const voters = (L, t) => (L.settings.tradeReview === "commish" ? [] : L.teams.filter((x) => x.id !== t.from && x.id !== t.to).map((x) => x.id));
  function commishVeto(L, id, now, why) {
    const t = L.trades.find((x) => x.id === id && x.status === "review");
    if (!t) return { ok: false, why: "That trade isn't under review" };
    t.status = "vetoed"; t.done = now; t.why = why || "Vetoed by the commissioner";
    log(L, now, { type: "veto", team: t.from, other: t.to, trade: t.id, text: "The commissioner vetoed a trade" });
    return { ok: true };
  }
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
    const c = tradeCheck(L, ctx, t, now);
    if (!c.ok) return c;
    for (const id of t.give) bank(L, ctx, t.from, id, now);
    for (const id of t.get) bank(L, ctx, t.to, id, now);
    for (const id of t.dropsFrom || []) { bank(L, ctx, t.from, id, now); dropOne(L, t.from, id, now); }
    L.rosters[t.from] = L.rosters[t.from].filter((x) => !t.give.includes(x)).concat(t.get);
    L.rosters[t.to] = L.rosters[t.to].filter((x) => !t.get.includes(x)).concat(t.give);
    // a player traded off IR arrives active; his old team's IR spot opens
    L.ir[t.from] = (L.ir[t.from] || []).filter((x) => !t.give.includes(x));
    L.ir[t.to] = (L.ir[t.to] || []).filter((x) => !t.get.includes(x));
    if (L.taxi) { L.taxi[t.from] = taxiOf(L, t.from).filter((x) => !t.give.includes(x)); L.taxi[t.to] = taxiOf(L, t.to).filter((x) => !t.get.includes(x)); }
    // the players who left come out of the set lineups; everyone else stays where the manager put them
    const moved = new Set(t.give.concat(t.get));
    for (const w of Object.keys(L.lineups)) if (+w >= L.week) for (const team of [t.from, t.to]) { const lu = L.lineups[w][team]; if (lu) L.lineups[w][team] = lu.map((x) => (moved.has(x) ? null : x)); }
    for (const id of t.get) joined(L, t.from, id, now, ctx);
    for (const id of t.give) joined(L, t.to, id, now, ctx);
    L.teams[t.from].faab += (t.faabGet || 0) - (t.faabGive || 0);
    L.teams[t.to].faab += (t.faabGive || 0) - (t.faabGet || 0);
    if ((t.pickGive || []).length || (t.pickGet || []).length) {
      L.picks = L.picks || {};
      for (const k of t.pickGive || []) L.picks[k] = t.to;
      for (const k of t.pickGet || []) L.picks[k] = t.from;
    }
    t.status = "accepted"; t.done = now;
    log(L, now, { type: "trade", team: t.from, other: t.to, adds: t.get, drops: t.give, trade: t.id, faab: (t.faabGive || t.faabGet) ? [t.faabGive || 0, t.faabGet || 0] : null,
      picks: (t.pickGive || []).length || (t.pickGet || []).length ? [t.pickGet || [], t.pickGive || []] : null });
    refresh(L, ctx);
    return { ok: true };
  }
  // A bot takes a deal that leaves it ahead on value.
  function botAnswer(L, ctx, t) {
    const pv = (ks) => sum((ks || []).map((k) => pickValue(L, ctx, k)));
    const gets = sideValue(ctx, t.give, t.faabGive) + pv(t.pickGive), gives = sideValue(ctx, t.get, t.faabGet) + pv(t.pickGet);
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
        const worst = L.rosters[t.id].filter((x) => !held(L, t.id).includes(x)).map((x) => ctx.byId[x]).filter(Boolean).sort((a, b) => a.vor - b.vor)[0];
        activate(L, ctx, t.id, id, L.rosters[t.id].length - held(L, t.id).length >= maxRoster(L) && worst ? worst.id : null, now);
      }
      const hurt = L.rosters[t.id].map((x) => ctx.byId[x]).filter((p) => p && irEligible(p) && !held(L, t.id).includes(p.id)).sort((a, b) => b.vor - a.vor);
      for (const p of hurt) if (!toIR(L, ctx, t.id, p.id, now).ok) break;
      // taxi squad: promote a rookie who'd now start, then stash the rookies sitting on the bench
      if (taxiSlots(L)) {
        for (const id of taxiOf(L, t.id).slice()) {
          const p = ctx.byId[id];
          if (!p || /^(out|ir|o)$/i.test(p.inj || "")) continue;
          const best = F.assign(ctx.sport, healthy(L, ctx, t.id).concat(p), L.settings.lineup).filter(Boolean).map((q) => q.id);
          if (!best.includes(id)) continue;
          const room = L.rosters[t.id].length - held(L, t.id).length < maxRoster(L);
          const cut = room ? null : L.rosters[t.id].filter((x) => !held(L, t.id).includes(x) && !best.includes(x)).map((x) => ctx.byId[x]).filter(Boolean).sort((a, b) => a.vor - b.vor)[0];
          if (room || cut) promote(L, ctx, t.id, id, cut ? cut.id : null, now);
        }
        stashRookies(L, ctx, t.id, now, false);
      }
    }
    // a bot with an empty lineup slot fills it first: the best free agent who fits, for its least useful player
    // whose drop doesn't open another hole
    for (const t of L.teams) {
      if (t.owner || !isAlive(L, t.id)) continue;
      const ids = L.rosters[t.id], now0 = holes(L, ctx, t.id, ids);
      if (!now0) continue;
      const order = ids.map((id) => ctx.byId[id]).filter(Boolean).sort((a, b) => (a.vor || 0) - (b.vor || 0));
      for (const p of ctx.free.filter((x) => !onWaivers(L, x.id, now) && !/^(out|ir|o)$/i.test(x.inj || "")).slice(0, 150)) {
        const room = ids.length - held(L, t.id).length < maxRoster(L);
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
        const c = claim(L, ctx, t.id, p.id, ros.length - held(L, t.id).length >= maxRoster(L) ? drop.id : null, bid, now);
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
    const pastDeadline = L.settings.deadline && L.week > L.settings.deadline && !offseason(L);
    for (const t of L.trades) if (t.status === "pending" && (now >= offerEnds(L, t) || pastDeadline)) { t.status = "expired"; t.done = pastDeadline ? now : offerEnds(L, t); }
    let n = finalize(L, ctx, now);
    n += botsAnswer(L, ctx, now, 0);
    n += runBites(L, ctx, now);
    if (L.pyo && !L.pyo.done) n += runPyo(L, ctx, now);
    lockPlayed(L, ctx, now);
    if (L.settings.waiverAt == null) n += runDue(L, ctx, now);
    L.waiverRuns = L.waiverRuns || {};
    if (L.settings.waiverAt != null && L.week <= totalWeeks(L) && !L.waiverRuns[L.week] && now >= waiverRunAt(L)) {
      const at = waiverRunAt(L);
      L.waiverRuns[L.week] = at;
      n += runWaivers(L, ctx, at).length;
    }
    return n;
  }

  return { takerOf, openRaids, protectOf, kingOf, hungover, pyoTurn, pyoOptions, pyoPick, pyoAuto, runPyo, pyoLast, PYO_HOURS, realPts, commishVeto, reorderWaivers, seasonPickups, seasonPickupsLeft, vampireFill, vampireOf, openBite, biteCheck, bite, autoBite, runBites, skipBite, vampireFirst, summary, records, taxiOf, held, taxiSlots, taxiEligible, toTaxi, promote, stashRookies, DEFAULTS, WEEK, realWeek, canFinish, lineupLocked, isRoto, rotoLive, rotoStandings, pickups, pickupsLeft, create, roundRobin, context, refresh, maxRoster, totalWeeks, weekStart, lineupFor, setLineup, move, scoring, playerWeek, teamWeek, projection, compare, matchups, winProb,
    finishWeek, slotMult, setKicks, isLocked, freezeLineups, bestLineup, lockedStarter, projectCats, projectLine, catOdds, gamesLeft, plays, formOf, hot, standings, outlook, playoffGames, bracket, playoffPlan, roundOf, postseason, finish, seedOrder, medianOf, DIV_NAMES, blockOf, setBlock, blockNote, setRules, commishMove, reverseTrade, editTeam, setWaiverOrder, setDivisions, offseason, pickYear, pickSlot, pickProspect, pickRounds, pickOwner, picksOf, pickLabel, pickValue, overLimit, cutDown, power, onWaivers, canRoster, addDrop, claim, cancelClaim, moveClaim, myClaims, runWaivers, pValue, sideValue, tradeCheck, propose, respond, cancelTrade,
    voters, vetoesNeeded, vote, finalize, execute, botAnswer, botsAnswer, botWeek, tick, log,
    weekFrac, joined, effFrac, bank, waiverPrice, waiverClear, nextWeekClear, waiverDays, clearAt, gameLockOn, lockPlayed, runDue, waiverWhen, fillLineup, offerEnds, closeSeason, IR_OK, irEligible, irSlots, toIR, activate, irBlocked, GUILLOTINE, isGuillotine, isAlive, block, chopOdds, chop, champion, survival, waiverRunAt, botBids, bestBallIds };
});
