/* Fantasy Kit: a shared league's clock and its emails. No DOM and no network, so the same code runs on a league
   page (live.js) and in the scheduled job that keeps leagues moving when nobody has a page open
   (supabase/functions/fk-clock).

   FK.season:
     startAfter(t, sportKey)              the season's first week: the next Monday at 13:00 UTC (Tuesday for football),
                                          after the night's box scores are in, so real weeks line up with the data
     begin(D, sport, { name, season, real })  the league that follows a finished draft; real scores it on real games
     catchUp(L, ctx, now)                 plays every week that has ended, runs bots, waivers and trade reviews; true if anything changed
     driveDraft(D, ctx, now)              a draft's overdue picks (bots, expired clocks); true if anything changed
     events(before, after, o)             the emails a save should send: [{ team, kind, subject, body }]
                                          o: { name, url, seats, me, byId, now } */
(function (root, factory) {
  const FK = root.FK || {};
  const req = typeof require !== "undefined" ? require : null;
  const m = factory(FK.draft || (req ? req("./draft.js") : null), FK.league || (req ? req("./league.js") : null));
  if (typeof module !== "undefined" && module.exports) module.exports = m;
  else (root.FK = root.FK || {}).season = m;
})(this, function (F, G) {
  "use strict";
  const DAY = 864e5, HOUR = 36e5;

  function startAfter(t, sportKey) {
    const d = new Date(t), want = sportKey === "nfl" ? 2 : 1;
    d.setUTCHours(13, 0, 0, 0);
    let add = (want - d.getUTCDay() + 7) % 7;
    if (add === 0 && d.getTime() <= t) add = 7;
    return d.getTime() + add * DAY;
  }

  function begin(D, sport, o = {}) {
    const s = D.season || { format: "h2h", weeks: 14 };
    const weeks = s.weeks || 14, n = D.teams.length;
    // the commissioner's choices from the start-a-league form (D.season), with defaults for anything left out.
    // A guillotine is best ball unless the form says otherwise (bestBall: false), so managers set lineups.
    const settings = s.format === "guillotine" ? { format: "guillotine", bestBall: s.bestBall !== false, waiverAt: 60, faab: s.faab || 1000 }
      : { format: s.format === "roto" ? "roto" : "h2h", tally: s.tally || "game", weeks, playoffTeams: s.format === "roto" ? 0 : Math.min(s.playoffTeams != null ? s.playoffTeams : 4, n),
        playoffLegs: s.playoffLegs || "1", consolation: s.consolation || "none",
        deadline: s.deadline != null ? s.deadline : Math.max(1, weeks - 3), tradeReview: ["none", "commish"].includes(s.review) ? s.review : "vote", reviewHours: s.reviewHours || 24, vetoShare: s.vetoShare || 0.5,
        waiverDays: s.waiverDays != null ? s.waiverDays : 2, gameLock: s.gameLock || (sport && sport.key === "nfl" ? "week" : "off"), faab: s.faab || 100, waivers: s.waivers === "rolling" ? "rolling" : "faab" };
    // roster rules from the form: IR spots, a weekly pickup limit, position limits
    if (s.ir != null) settings.ir = s.ir;
    if (s.maxAdds) settings.maxAdds = s.maxAdds;
    if (s.maxAddsSeason) settings.maxAddsSeason = s.maxAddsSeason;
    if (s.minBid != null) settings.minBid = s.minBid;
    if (s.waiverOrder === "standings") settings.waiverOrder = "standings";
    if (s.waiverPrice === "second") settings.waiverPrice = "second";
    if (s.posMax && Object.keys(s.posMax).length) settings.posMax = Object.assign({}, s.posMax);
    // at most this many starters from one college conference
    if (s.confMax) settings.confMax = s.confMax;
    // weekly extras: a game against the league median, best ball lineups, divisions
    if (s.median) settings.median = true;
    // a one-week league has no trades: there's no week after this one to build for
    if (s.oneWeek) settings.trades = false;
    if (s.bestBall && s.format !== "guillotine") settings.bestBall = true;
    if (s.divisions) settings.divisions = s.divisions;
    // a vampire league (football, head to head): which team is the vampire, and its swap rules
    if (s.vampire && s.format !== "guillotine" && s.format !== "roto") settings.vampire = { team: s.vampire.team, samePos: !!s.vampire.samePos, double: !!s.vampire.double };
    // the twists: pick your opponent, Robin Hood, Conquest, Kingslayer and The Hangover (head to head), the top-score
    // bonus (guillotine)
    const cl = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : d);
    if (s.format !== "guillotine" && s.format !== "roto") {
      if (s.pyo) settings.pyo = true;
      if (s.robin) settings.robin = { protect: cl(s.robin.protect, 0, 8, 2), like: !!s.robin.like };
      if (s.conquest) settings.conquest = { protect: cl(s.conquest.protect, 0, 8, 3), like: !!s.conquest.like };
      if (s.crown) settings.crown = { start: cl(s.crown.start, 0, 500, 10), step: cl(s.crown.step, 0, 200, 10), keep: cl(s.crown.keep, 0, 100, 5), king: s.crown.king != null ? s.crown.king : undefined };
      if (s.hangover) settings.hangover = true;
    } else if (s.format === "guillotine" && s.topBonus) settings.topBonus = cl(s.topBonus, 0, 500, 25);
    if (s.dynasty) settings.dynasty = { rounds: s.dynasty.rounds || 3, picks: s.dynasty.picks !== false };
    if (s.dynasty && s.taxi) settings.taxi = Math.max(0, Math.min(6, s.taxi | 0));
    // keepers: how many each team carries into next season, and what each one costs
    if (s.keepers) { settings.keepers = s.keepers; settings.keeperCost = s.keeperCost || (D.type === "auction" ? "price" : "round"); }
    // a climbing keeper rule comes over from last season (nextDraft) or the form
    // next season's draft picks can be traded (keepers leagues; "offseason": only between seasons)
    if (s.pickTrades) settings.pickTrades = s.pickTrades;
    if (D.keeperRule || s.keeperRule) { settings.keeperRule = Object.assign({}, D.keeperRule || s.keeperRule); settings.keepers = D.keepersN || s.keepers || settings.keepers || 5; }
    // a draft that ran out on the clock while nobody was around is "done" in the past; start after now, not then
    const at = Math.max(D.done || 0, o.now || Date.now());
    // a one-week league set for this week starts in the week that's on, if enough of it is left to play
    // (a slate or a showdown plays the week its games are in, however little of it is left)
    const lastKick = s.slate ? s.slate.last : s.showdown ? s.showdown.at : null, cur = weekOf(at, sport.key);
    // a one-day slate plays its own night: it starts now and its one week ends with its last game (settings.span)
    const day = s.slate && s.slate.day && !s.showdown ? s.slate : null;
    const thisWeek = day ? false : lastKick != null ? lastKick < cur + 7 * DAY : s.when === "now" && sport.key !== "mlb" && cur + 7 * DAY - at >= MIN_LEFT;
    const start = day ? at : thisWeek ? cur : startAfter(at, sport.key);
    // o.real: a weeks file (real scoring if its box scores reach the league's start) or true
    if (o.real && (o.real === true || realCovers(o.real, start))) settings.real = true;
    // a showdown: one game's two teams, a captain who counts half again, and free agency with no waiting
    const sd = s.showdown;
    if (sd) Object.assign(settings, { pool: sd.teams.slice(), mult: { CPT: 1.5 }, waiverDays: 0, gameLock: "off", showdown: { id: sd.id, label: sd.label, at: sd.at, week: sd.week } });
    // a one-week slate: the games it drafted from (a whole week, Sunday, the night games or games picked), each one's
    // kickoff its lock, and free agency with no waiting
    const sl = s.slate && !sd ? s.slate : null;
    if (sl) Object.assign(settings, { pool: sl.teams.slice(), waiverDays: 0, gameLock: "off", slate: { kind: sl.kind, label: sl.label, week: sl.week, first: sl.first, last: sl.last, games: sl.games.length } }, sl.mult ? { mult: Object.assign({}, sl.mult) } : {});
    // a one-day slate scores its own games (settings.slate.list, from their box scores) and its week runs from now to
    // three hours after the last tip; it closes once every game is final (league.js)
    if (day) {
      Object.assign(settings.slate, { day: day.day, list: day.games.map((g) => ({ id: g.id, away: g.away, home: g.home, at: Date.parse(g.at) })) });
      settings.span = { end: Math.max(at + HOUR, day.last + 3 * HOUR) };
    }
    const L = G.create({ sport, draft: D, name: o.name || D.name, season: o.season || "", now: at, start, scoring: D.scoring, settings });
    // each keeper's cost history: what he was first worth, and the years he's been kept (this one counted)
    if (D.keepInfo) L.keepInfo = JSON.parse(JSON.stringify(D.keepInfo));
    // its kickoff locks everyone, even before a page has seen the live feed
    if (sd && sd.at && L.week === 1) L.kick = { week: 1, teams: Object.fromEntries(sd.teams.map((t) => [t, sd.at])) };
    if (sl && L.week === 1) L.kick = { week: 1, teams: Object.fromEntries(sl.games.flatMap((g) => [[g.away, Date.parse(g.at)], [g.home, Date.parse(g.at)]])) };
    // a heist: the lineups it left (stolen players moved, the thieves' bumped players released), each player's 1.5x or
    // half, the week's matchups as the heist paired them, and rosters set for the week but for filling a robbed spot
    const hr = D.heist && D.heist.result;
    if (hr) {
      L.rosters = L.teams.map((t) => (hr.lineups[t.id] || []).filter(Boolean));
      L.lineups[1] = Object.fromEntries(L.teams.map((t) => [t.id, (hr.lineups[t.id] || []).slice()]));
      L.pmult = Object.assign({}, hr.mult);
      L.heist = { pairs: D.heist.pairs, events: hr.events, released: hr.released, shields: hr.shields };
      if ((L.settings.weeks || 1) === 1 && L.schedule && L.schedule.length) L.schedule[0] = D.heist.pairs.map((p) => p.slice());
      Object.assign(L.settings, { frozen: true, trades: false, ir: 0 });
      L.waivers = {};
    }
    // the undrafted pool starts on waivers and clears like a drop (business days after the draft), so claims, not
    // whoever's online first, decide who gets the best of it. Not for one-week leagues, showdowns or guillotines.
    if (!hr && !sd && !sl && !settings.vampire && settings.format !== "guillotine" && (settings.weeks || 14) > 1 && s.draftWaivers !== false && G.waiverDays(L) > 0) L.openWaivers = G.waiverClear(L, at);
    // a salary cap game: the lineups are the entries, set for the week; a player only one team picked scores the bonus
    if (D.cap && D.cap.lineups) {
      L.lineups[1] = Object.fromEntries(L.teams.map((t) => [t.id, (D.cap.lineups[t.id] || []).slice()]));
      L.pmult = Object.assign({}, L.pmult || {}, Object.fromEntries((D.cap.unique || []).map((pid) => [pid, D.cap.bonus || 1])));
      Object.assign(L.settings, { frozen: true, trades: false, ir: 0, cap: { budget: D.cap.budget, bonus: D.cap.bonus || null } });
      L.waivers = {}; delete L.openWaivers;
    }
    // started midweek: what every player had done this week before the league began doesn't count
    if (thisWeek && settings.real && o.real && o.real !== true) L.baseline = { start: weekKeyOf(o.real, start), at, lines: JSON.parse(JSON.stringify(linesAt(o.real, start) || {})) };
    return L;
  }
  // the week that's on at t: the latest week start at or before t
  const MIN_LEFT = 20 * HOUR;
  const weekOf = (t, sportKey) => startAfter(t - 7 * DAY, sportKey);
  // a weeks file's week that begins at `start` (its dates are days; a week start is 13:00 UTC on that day)
  const weekRow = (weeks, start) => Object.values((weeks && weeks.weeks) || {}).find((x) => Math.abs(Date.parse(x.start + "T12:00:00Z") - start) < 2.5 * DAY);
  const weekKeyOf = (weeks, start) => { const w = weekRow(weeks, start); return w ? w.start : new Date(start).toISOString().slice(0, 10); };
  const linesAt = (weeks, start) => { const w = weekRow(weeks, start); return w ? w.lines : null; };

  // Do a weeks file's box scores reach a season starting at `start`? They do while the real season is on (its
  // latest week ends within a week of the start); out of season they don't, and the league is simulated.
  function realCovers(weeks, start) {
    const ends = Object.values((weeks && weeks.weeks) || {}).map((w) => Date.parse(w.end + "T23:59:59Z")).filter(Boolean);
    return ends.length > 0 && Math.max(...ends) >= start - 8 * DAY;
  }
  // Lays the live feed (C.live) over a weeks file: the feed's week replaces that week's lines, unless the file has
  // already closed it, or joins the file if the week is new. Each pro team's games played, live and left this week
  // ride along as weeks.live, for live win chances. True if anything changed.
  function mergeLive(weeks, live) {
    if (!weeks || !live || !live.start || live.error || String(live.season) !== String(weeks.season)) return false;
    const before = weeks.live && weeks.live.updated, wasStale = !!(weeks.live && weeks.live.stale);
    const k = Object.keys(weeks.weeks || {}).find((x) => weeks.weeks[x].start === live.start);
    const wk = k ? weeks.weeks[k] : null;
    if (wk && wk.final) { weeks.live = null; return false; }
    // what changed since the last poll of this same week: the scoring plays the matchup page lists
    const old = wk ? wk.lines : weeks.weeks && weeks.weeks.live && weeks.weeks.live.start === live.start ? weeks.weeks.live.lines : null;
    const feed = weeks.live && weeks.live.start === live.start ? weeks.live.feed || [] : [];
    if (old && before && before !== live.updated) {
      const diff = (a, b) => (Array.isArray(b) ? (b.some((x, i) => x !== ((a || [])[i] || 0)) ? b.map((x, i) => x - ((a || [])[i] || 0)) : null)
        : b && typeof b === "object" ? (() => { const o = {}; let any = false; for (const k of Object.keys(b)) { const d = diff((a || {})[k], b[k]); if (d) { o[k] = d; any = true; } } return any ? o : null; })() : null);
      for (const [id, line] of Object.entries(live.players || {})) { const d = diff(old[id], line); if (d) feed.push({ id, at: live.updated, d }); }
    }
    if (wk) wk.lines = live.players || {};
    else (weeks.weeks = weeks.weeks || {})["live"] = { start: live.start, end: live.end, final: false, lines: live.players || {} };
    weeks.live = { start: live.start, updated: live.updated, teams: live.teams || {}, games: live.games || {}, proj: live.proj || null, boxes: live.boxes || null, players: live.players || {}, stale: !!live.stale, errors: live.errors || [], feed: feed.slice(-300) };
    return before !== live.updated || wasStale !== !!live.stale;
  }
  // A one-day league's game ids (to ask fk-live ?games= for), or null
  const slateGames = (L) => { const sl = L && L.settings && L.settings.slate; return sl && sl.day && Array.isArray(sl.list) ? sl.list.map((g) => g.id) : null; };
  // Lays fk-live ?games= over a weeks file: weeks.games[id] = { state, lines } for each game, which a one-day league
  // scores from. A finished game is kept once seen. True if anything changed.
  function mergeGames(weeks, res) {
    if (!weeks || !res || !res.games) return false;
    const g = (weeks.games = weeks.games || {});
    let changed = false;
    for (const [id, x] of Object.entries(res.games)) {
      if (!x || (g[id] && g[id].state === "post" && x.state !== "post")) continue;
      const before = g[id] ? JSON.stringify(g[id]) : "";
      g[id] = { state: x.state || "pre", lines: x.lines || {} };
      if (JSON.stringify(g[id]) !== before) changed = true;
    }
    if (changed) weeks.gamesAt = (weeks.gamesAt || 0) + 1;
    return changed;
  }
  function catchUp(L, ctx, now) {
    if (!L) return false;
    const before = JSON.stringify(L);
    // keeper picks: a reminder a day before they lock (to whoever hasn't picked, through events()), and the lock itself
    if (L.next && L.next.due) {
      if (!L.next.reminded && now >= L.next.due - DAY && now < L.next.due) L.next.reminded = now;
      if (!L.next.locked && now >= L.next.due) L.next.locked = now;
      // moved later after it locked: open again, and remind again
      if (L.next.locked && now < L.next.due) { delete L.next.locked; if (now < L.next.due - DAY) delete L.next.reminded; }
    }
    // a dynasty's long rosters after the rookie draft: bots cut now, everyone else by the start of week 1
    if (L.week === 1) G.cutDown(L, ctx, Math.min(now, L.start), now >= L.start);
    // a bot vampire builds its roster from free agents before week 1
    if (L.week === 1 && G.vampireOf(L) != null) G.vampireFill(L, ctx, Math.min(now, L.start));
    // guillotine bots bid on the chopped roster early in the week, before the midweek waiver run
    const bids = () => {
      L.botBid = L.botBid || {};
      const at = G.weekStart(L, L.week) + HOUR;
      if (!G.isGuillotine(L) || L.botBid[L.week] || now < at || L.week > G.totalWeeks(L)) return;
      L.botBid[L.week] = true;
      G.botBids(L, ctx, at, F.rng(L.seed + L.week * 41));
    };
    // a real league waits for the week's last box scores before closing it
    while (G.canFinish(L, ctx, now)) {
      const end = G.weekStart(L, L.week + 1);
      bids();
      if (G.isGuillotine(L)) G.tick(L, ctx, G.waiverRunAt(L) + 1);
      // simulated weeks have no game times, so bots make their moves late in the week; on real games they did at the start
      if (!L.settings.real) G.botWeek(L, ctx, end - 2 * DAY, F.rng(L.seed + L.week * 13));
      G.tick(L, ctx, end - DAY);
      L.prevPower = Object.fromEntries(G.power(L, ctx).map((r) => [r.team, r.rank]));
      G.finishWeek(L, ctx, end);
    }
    bids();
    // real games: bots set up for the week as it starts, before any kickoff, and lineups nobody set are saved as they
    // stand half an hour before the first game, so nothing shifts once players lock
    if (L.settings.real && L.week <= G.totalWeeks(L) && now >= G.weekStart(L, L.week) && !(L.botRan && L.botRan[L.week])) {
      (L.botRan = L.botRan || {})[L.week] = true;
      G.botWeek(L, ctx, now, F.rng(L.seed + L.week * 13));
    }
    G.freezeLineups(L, ctx, now);
    G.tick(L, ctx, now);
    lineupCheck(L, ctx, now);
    return JSON.stringify(L) !== before;
  }

  // Once a week, before the games start, note every team whose lineup has an empty spot or a starter who's out, for
  // the reminder email (events below). Football checks Thursday afternoon, before the first kickoff; the daily sports
  // check a couple of hours into the week. Best ball sets lineups itself, so it never needs one.
  const REMIND_AT = { nfl: 56 * HOUR, nba: 2 * HOUR, mlb: 2 * HOUR };
  const OUT = /^(out|ir|o|doubtful|d|pup|sus|suspension|suspended|il\d*|injured reserve)$/i;
  function lineupCheck(L, ctx, now) {
    const w = L.week;
    if (L.settings.bestBall || w > G.totalWeeks(L) || (L.reminders && L.reminders[w])) return;
    const at = G.weekStart(L, w) + (REMIND_AT[L.sport] != null ? REMIND_AT[L.sport] : 2 * HOUR);
    if (now < at || now >= G.weekStart(L, w + 1)) return;
    const slots = L.settings.lineup, out = {};
    for (const t of L.teams) {
      if (G.isGuillotine(L) && !G.isAlive(L, t.id)) continue;
      if (w > L.settings.weeks && !G.isGuillotine(L)) { let gs = []; try { gs = G.playoffGames(L, ctx, w) || []; } catch (e) { gs = []; } if (!gs.some((g) => g && (g[0] === t.id || g[1] === t.id))) continue; }
      let ids; try { ids = G.lineupFor(L, ctx, t.id, w); } catch (e) { continue; }
      const empty = slots.filter((s, i) => !ids[i]);
      const hurt = ids.map((id) => id && ctx.byId[id]).filter((p) => p && OUT.test(String(p.inj || "").trim())).map((p) => ({ n: p.n, pos: (p.pos || [])[0] || "", inj: p.inj }));
      if (empty.length || hurt.length) out[t.id] = { empty, hurt };
    }
    (L.reminders = L.reminders || {})[w] = { at: now, teams: out };
  }

  // sealed: the entries for a salary cap game or a sealed draft ({ team: entry }), once they're due
  const sealedKind = (D) => (D && D.phase === "setup" ? (D.cap ? "cap" : D.sealed ? "rank" : null) : null);
  const sealedDue = (D) => (D ? (D.cap ? D.cap.due : D.sealed ? D.sealed.due : null) : null);
  function driveDraft(D, ctx, now, sealed) {
    if (D && D.phase === "heist") return F.heistTick(D, ctx, now);
    if (sealedKind(D)) {
      if (now < sealedDue(D) || !sealed) return false;
      return D.cap ? F.capReveal(D, ctx, sealed, sealedDue(D)) : F.sealedRun(D, ctx, sealed, sealedDue(D));
    }
    // a draft set for a time (D.startAt): a reminder an hour before, then it starts on its own. Anyone who isn't
    // there when the clock runs out gets the best player left.
    if (D && D.phase === "setup" && D.startAt) {
      let ch = false;
      if (!D.reminded && now >= D.startAt - HOUR && now < D.startAt) { D.reminded = now; ch = true; }
      if (now >= D.startAt) { F.start(D, now, ctx); ch = true; }
      if (D.phase !== "live") return ch;
      return F.tick(D, ctx, now, 2000) > 0 || ch;
    }
    if (!D || D.phase !== "live") return false;
    const held = F.offerHold(D, now);                     // an answered offer (or one held long enough) lets the draft go on
    if (D.paused) return held;
    return F.tick(D, ctx, now, 2000) > 0 || held;
  }

  /* ---------- emails ---------- */
  const ord = (n) => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10] || "th");
  const fmtS = (x) => (typeof x === "number" ? (Number.isInteger(x) ? String(x) : x.toFixed(1)) : String(x));
  const when = (t) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

  // A team's roster right after the draft, for the email: position, player, pro team and how he was drafted,
  // in the lineup's position order (QB, RB, WR...) and draft order within a position.
  function draftRoster(L, team, byId) {
    const D = L.draft || {}, ids = (L.rosters || [])[team] || [];
    if (!ids.length) return null;
    const order = [];
    for (const s of L.settings.lineup || D.lineup || []) if (!order.includes(s)) order.push(s);
    const per = (D.round1 || D.teams || []).length || 1, pick = {}, paid = {};
    (D.board || []).forEach((pk, i) => { if (pk && pk.pid != null && pk.team === team) pick[pk.pid] = { i, n: pk.n, keeper: pk.keeper }; });
    (D.sales || []).forEach((x) => { if (x.team === team) paid[x.pid] = x; });
    const rows = ids.map((pid) => {
      const p = byId[pid] || {}, pos = (p.pos || [])[0] || "", k = pick[pid], $ = paid[pid];
      const how = $ ? `$${$.price}${$.keeper ? ", keeper" : ""}` : k ? `${k.keeper ? "Keeper, " : ""}round ${Math.floor(k.i / per) + 1}, pick ${k.n}` : "Added";
      const rank = order.indexOf(pos);
      return { pid, n: p.n || "Player", pos: (p.pos || []).join("/") || "-", main: pos, t: p.t || "", how, sort: [rank < 0 ? 99 : rank, k ? k.i : $ ? -$.price : 9999] };
    }).sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1]).map(({ sort, ...r }) => r);
    const tm = (L.teams || [])[team] || {};
    return { team: tm.name || "Your team", rows, auction: !!(D.sales && D.sales.length), spent: D.sales ? D.sales.filter((x) => x.team === team).reduce((a, x) => a + x.price, 0) : null };
  }

  function events(b, c, o) {
    const out = [], seats = o.seats || {}, now = o.now || Date.now();
    const doc = c.league || c.draft;
    const teamName = (t) => (doc && doc.teams[t] ? doc.teams[t].name : "A team");
    const pn = (pid) => (F.isPickId(pid) ? `pick ${F.pickIdx(pid) + 1}` : ((o.byId || {})[pid] || {}).n || "a player");
    const pickName = (k) => { const [r, t] = String(k).split(":").map(Number); return `a round ${r} pick (${teamName(t)}'s)`; };
    const names = (ids, picks) => { const xs = (ids || []).map(pn).concat((picks || []).map(pickName)); return xs.length ? xs.join(", ") : "nothing"; };
    const seated = Object.keys(seats).map(Number);
    // `hash` opens a page of the league (the week's recap) from the email button and the phone alert
    const add = (team, kind, subject, body, data, hash) => {
      if (team == null || team === o.me || seats[team] == null || out.some((x) => x.team === team && x.subject.endsWith(subject))) return;
      out.push(Object.assign({ team, kind, subject: `${o.name}: ${subject}`, body: `${body}\n\nOpen the league: ${o.url}${hash && o.url ? "#" + hash : ""}` }, data ? { data } : {}));
    };
    // the rest of the league hears about trades too: one up for a vote, and one that went through
    const others = (t) => seated.filter((x) => x !== t.from && x !== t.to);
    function trades(bt, ct, wide) {
      const was = Object.fromEntries((bt || []).map((t) => [t.id, t.status]));
      for (const t of ct || []) {
        const s0 = was[t.id];
        if (wide && s0 !== "review" && t.status === "review") for (const x of others(t)) add(x, "trade", "a trade is up for review", `${teamName(t.from)} sends ${names(t.give, t.pickGive)} to ${teamName(t.to)} for ${names(t.get, t.pickGet)}. If enough teams veto it by ${when(t.reviewEnds)}, it's off. Vote on the Trades page.`);
        if (wide && s0 !== "accepted" && t.status === "accepted") for (const x of others(t)) add(x, "trade", `${teamName(t.from)} and ${teamName(t.to)} made a trade`, `${teamName(t.from)} gets ${names(t.get, t.pickGet)}. ${teamName(t.to)} gets ${names(t.give, t.pickGive)}.`);
        if (s0 == null && t.status === "pending") add(t.to, "trade", `${teamName(t.from)} sent you a trade offer`, `${teamName(t.from)} offered ${names(t.give, t.pickGive)} for ${names(t.get, t.pickGet)}.${t.note ? `\n\n"${t.note}"` : ""}`);
        else if (s0 === "pending" && t.status !== "pending") {
          const verb = { accepted: "accepted", review: "accepted", rejected: "declined", declined: "declined", expired: "didn't answer" }[t.status];
          if (!verb) continue;
          const body = t.status === "review" ? `${teamName(t.to)} accepted. The league can vote on it until ${when(t.reviewEnds)}.`
            : t.status === "expired" ? `Your offer to ${teamName(t.to)} expired.`
            : `${teamName(t.to)} ${verb} your offer of ${names(t.give, t.pickGive)} for ${names(t.get, t.pickGet)}.${t.why ? ` "${t.why}"` : ""}`;
          add(t.from, "trade", `${teamName(t.to)} ${verb} your trade`, body);
        } else if (s0 === "review" && t.status === "vetoed") {
          add(t.from, "trade", "your trade was vetoed", "The league voted it down.");
          add(t.to, "trade", "your trade was vetoed", "The league voted it down.");
        }
      }
    }
    const bd = b && b.draft, cd = c.draft;
    if (bd && cd && !(b && b.league)) {
      if (cd.phase === "setup" && cd.startAt && cd.startAt !== bd.startAt) seated.forEach((t) => add(t, "draft", `the draft is set for ${when(cd.startAt)}`, `The draft starts on its own at ${when(cd.startAt)}${(cd.clock || 0) > 0 && cd.clock < 3600 ? `, ${cd.clock} seconds a pick` : ""}. Build your queue before then: if you can't make it, your picks come from your queue, or the best player left.`));
      if (cd.phase === "setup" && cd.reminded && !bd.reminded) seated.forEach((t) => add(t, "draft", "the draft starts in an hour", `The draft starts at ${when(cd.startAt)}. Open the draft room a few minutes early and set your queue.`));
      if (bd.phase === "setup" && cd.phase === "live") seated.forEach((t) => add(t, "draft", "the draft started", "The draft room is live. If your clock runs out, the best player left is taken for you, so jump in."));
      if (bd.phase !== "done" && cd.phase === "done") seated.forEach((t) => {
        const ros = c.league ? draftRoster(c.league, t, o.byId || {}) : null;
        add(t, "draft", "the draft is done", `Every pick is in.${c.league ? ` The season starts ${when(c.league.start)}.` : ""} Set your lineup and check the free agents.`
, ros ? { roster: ros, url: o.url, start: c.league.start } : null);
      });
      if (cd.phase === "live" && cd.type !== "auction" && (cd.clock || 0) >= 3600) {
        try {
          const cc = F.onClock(cd, now), cb = bd.phase === "live" ? F.onClock(bd, now) : null;
          if (cc && (!cb || cb.index !== cc.index) && !F.isBot(cd.teams[cc.team])) add(cc.team, "clock", "you're on the clock", `Pick ${cc.pick} is yours. You have until ${when(cc.deadline)}.`);
        } catch (e) { /* no clock to read */ }
      }
      trades(bd.trades, cd.trades, (cd.clock || 0) >= 3600);
    }
    // a new season: the league went back to a draft
    if (b && b.league && !c.league && cd) seated.forEach((t) => add(t, "season", "next season's draft room is open", `${cd.rookie ? `Your whole roster carries over. The rookie and free agent draft is ${cd.rounds} rounds, worst team first. ` : (cd.board || []).some((pk) => pk && pk.keeper && pk.team === t) || (cd.sales || []).some((x) => x.keeper && x.team === t) ? "Your keepers are on the board. " : ""}The commissioner starts the draft when everyone's ready.`));
    if (c.league) {
      const bl = (b && b.league) || { trades: [], claims: [], results: {} }, cl = c.league;
      const missTxt = (n) => (n.missed === "none" ? "If you don't pick by then, you keep nobody." : "If you don't pick by then, your best values are kept for you.");
      if (cl.next && !bl.next) seated.forEach((t) => add(t, "keepers", "pick your keepers", `The season is over. Pick up to ${cl.settings.keepers} keepers for next season${cl.next.due ? ` by ${when(cl.next.due)}` : ""}. ${missTxt(cl.next)}`));
      // a day before the deadline, and when it passes: everyone who hasn't picked hears about it
      if (cl.next && cl.next.reminded && !(bl.next && bl.next.reminded)) seated.filter((t) => !(cl.next.picks || {})[t]).forEach((t) => add(t, "keepers", "keepers lock tomorrow", `You haven't picked your keepers yet. They lock ${when(cl.next.due)}. ${missTxt(cl.next)}`));
      if (cl.next && cl.next.locked && !(bl.next && bl.next.locked)) seated.filter((t) => !(cl.next.picks || {})[t]).forEach((t) => add(t, "keepers", "keepers are locked", cl.next.missed === "none" ? "The keeper deadline passed without your picks, so you keep nobody. If that's a mistake, ask the commissioner: they can still set your keepers." : "The keeper deadline passed without your picks, so your best values were kept for you. The commissioner can still change them."));
      // the commissioner moved the deadline: everyone who hasn't picked hears about it
      if (cl.next && bl.next && cl.next.due && cl.next.due !== bl.next.due) seated.filter((t) => !(cl.next.picks || {})[t]).forEach((t) => add(t, "keepers", "the keeper deadline moved", `Keepers now lock ${when(cl.next.due)}. ${missTxt(cl.next)}`));
      trades(bl.trades, cl.trades, true);
      // pick your opponent: your turn came up
      const turnOf = (P) => { if (!P || P.done) return null; const got = new Set(P.pairs.flat()); const t = P.order.find((x) => !got.has(x)); return t == null ? null : `${P.week}:${t}`; };
      const tNow = turnOf(cl.pyo), tWas = turnOf(bl.pyo);
      if (tNow && tNow !== tWas) { const t = +tNow.split(":")[1]; add(t, "pyo", `pick your week ${cl.pyo.week} opponent`, `It's your turn to pick who you play in week ${cl.pyo.week}. You have until ${when(Math.min(cl.pyo.at + 12 * HOUR, cl.pyo.due))}, then the weakest team left is picked for you.`); }
      // Robin Hood and Conquest: a raid to make, and one made on you
      const bw = Object.fromEntries((bl.bites || []).map((x) => [x.id, x.status]));
      for (const x of cl.bites || []) {
        if (x.by == null) continue;
        if (bw[x.id] == null && x.status === "open") add(x.by, "raid", x.why === "robin" ? `Robin Hood: rob ${teamName(x.victim)}` : `the spoils: raid ${teamName(x.victim)}`, `${x.why === "robin" ? `You had week ${x.week}'s lowest score, so you take one of ${teamName(x.victim)}'s players` : `You beat ${teamName(x.victim)}, so you take one of their players`} and give one back, by ${when(x.due)}. If you don't, the best one is taken for you.`);
        if (bw[x.id] === "open" && x.status === "done") add(x.victim, "raid", `${teamName(x.by)} took ${pn(x.take)}`, `${x.why === "robin" ? "Robin Hood" : "The spoils of war"}: ${teamName(x.by)} took ${pn(x.take)} from your roster${x.give ? ` and sent you ${pn(x.give)}` : ""}.`);
      }
      // the weekly lineup check: a reminder to each team whose lineup has a hole
      for (const [w, r] of Object.entries(cl.reminders || {})) {
        if ((bl.reminders || {})[w]) continue;
        for (const [t, x] of Object.entries(r.teams || {})) {
          const bits = [];
          if (x.empty.length) bits.push(`${x.empty.length === 1 ? "an empty starting spot" : `${x.empty.length} empty starting spots`} (${x.empty.join(", ")})`);
          for (const h of x.hurt) bits.push(`${h.n} (${h.pos}) is listed as ${String(h.inj).toLowerCase() === "o" ? "out" : String(h.inj).toLowerCase()}`);
          const list = bits.length > 1 ? `${bits.slice(0, -1).join(", ")} and ${bits.at(-1)}` : bits[0];
          add(+t, "lineup", `set your lineup for week ${w}`, `Your week ${w} lineup has ${list}. Swap in someone who's playing before the games start.`);
        }
      }
      const was = Object.fromEntries((bl.claims || []).map((x) => [x.id, x.status]));
      for (const x of cl.claims || []) {
        if (was[x.id] !== "open") continue;
        if (x.status === "won") add(x.team, "waiver", `you got ${pn(x.add)}`, `Your $${x.bid} claim for ${pn(x.add)} went through${x.drop ? `, and ${pn(x.drop)} was dropped` : ""}.`);
        else if (x.status === "lost") add(x.team, "waiver", `your claim for ${pn(x.add)} lost`, `${teamName(x.lostTo)} got ${pn(x.add)} with a higher bid or better waiver priority.`);
        else if (x.status === "failed") add(x.team, "waiver", `your claim for ${pn(x.add)} didn't go through`, x.why || "The claim couldn't be processed.");
      }
      for (const w of Object.keys(cl.results || {})) {
        if (bl.results && bl.results[w]) continue;
        const res = cl.results[w];
        if (res && res.block) {
          const gone = (res.chopped || []).map(teamName).join(" and ");
          for (const r of res.block) add(r.team, "week", r.out ? `you were chopped in week ${w}` : `you survived week ${w}`,
            r.out ? `You scored ${fmtS(r.score)}, the lowest this week. Thanks for playing.` : `You scored ${fmtS(r.score)} and finished ${ord(r.rank)}. ${gone} ${(res.chopped || []).length > 1 ? "were" : "was"} chopped, and their players are up for bids.`);
        } else if (res && res.roto) {
          const st = G.rotoStandings(Object.assign({}, cl, { results: Object.fromEntries(Object.entries(cl.results).filter(([k]) => +k <= +w)) }), +w);
          for (const r of st) add(r.team, "week", `week ${w} standings`, `You're ${ord(r.rank)} of ${st.length} with ${fmtS(r.pts)} roto points${r.rank > 1 ? `, ${fmtS(r.gb)} behind first` : ""}.`);
        } else if (Array.isArray(res)) {
          for (const g of res) for (const side of ["a", "b"]) {
            const mine = g[side], opp = side === "a" ? g.b : g.a, sm = side === "a" ? g.sa : g.sb, so = side === "a" ? g.sb : g.sa;
            if (mine == null || mine < 0 || opp == null || opp < 0) continue;
            const won = g.w === "t" ? null : g.w === side;
            const rd = +w > cl.settings.weeks ? G.roundOf(cl, +w) : null;
            if (!rd) {
              // median scoring: the week's second game, against the league median
              let med = "";
              if (cl.settings.median) {
                const xs = res.flatMap((x) => [x.sa, x.sb]).sort((p, q) => p - q), m = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
                med = ` Against the league median of ${fmtS(m)}, you ${sm > m ? "won" : sm < m ? "lost" : "tied"}.`;
              }
              add(mine, "week", `week ${w} final`, `You ${won == null ? "tied" : won ? "beat" : "lost to"} ${teamName(opp)}, ${fmtS(sm)} to ${fmtS(so)}.${med}${cl.settings.weeks > 1 ? (g.cats ? " The recap has every result and who moved in the standings." : " The recap has every result, the top players and who left points on the bench.") : ""}`, null, cl.settings.weeks > 1 ? `league/recap/${w}` : null);
              continue;
            }
            // playoffs: name the round, add up a two-week round, and say what's next
            const what = g.kind === "cons" ? `consolation ${rd.name.toLowerCase()}` : g.kind === "third" ? "third-place game" : rd.name.toLowerCase();
            const leg = rd.weeks.indexOf(+w), two = rd.weeks.length > 1;
            if (two && leg === 0) { add(mine, "week", `${what}, week 1 of 2`, `You ${sm > so ? "lead" : sm < so ? "trail" : "are tied with"} ${teamName(opp)}, ${fmtS(sm)} to ${fmtS(so)}, with a week to go.`); continue; }
            let tm = sm, to = so;
            if (two) { const g0 = (cl.results[rd.weeks[0]] || []).find((x) => (x.a === mine && x.b === opp) || (x.b === mine && x.a === opp)); if (g0) { tm += g0.a === mine ? g0.sa : g0.sb; to += g0.a === mine ? g0.sb : g0.sa; } }
            const seedFirst = G.standings(cl).findIndex((r) => r.team === mine) < G.standings(cl).findIndex((r) => r.team === opp);
            const win = tm > to || (tm === to && seedFirst), last = rd.round === G.playoffPlan(cl).length;
            const head = g.kind === "title" && last ? (win ? "you won the championship" : "you finished second") : g.kind === "third" ? (win ? "you finished third" : "you finished fourth")
              : g.kind === "cons" && last ? (win ? "you won the consolation bracket" : `${what} final`) : `${what}: you ${win ? "advance" : "are out"}`;
            add(mine, "week", head, `You ${win ? "beat" : "lost to"} ${teamName(opp)}, ${fmtS(tm)} to ${fmtS(to)}${two ? " over the two weeks" : ""}${tm === to ? ", and the tie went to the higher seed" : ""}.`);
          }
        }
      }
    }
    return out;
  }

  /* ---------- keepers and the next season ---------- */
  // What keeping a player costs next year. Snake drafts: "round" is the round he went in (a pickup costs the last
  // round), "round1" one round earlier than that, "free" one of the team's last picks. Auctions: "price" is what he
  // went for (a pickup costs $5), "price5" that plus $5.
  /* ---------- a climbing keeper cost (a league's own rule, like Wipe Yoenis): settings.keeperRule ----------
     { steps: [0, 2, 6], fa: 15, cutoff: "09-01", sameRound: "up" }
     A player costs the round he was drafted in (whoever drafted him, however he changed teams since), or rule.fa
     when nobody drafted him; each year he's kept he costs steps[years] rounds earlier, never past round 1, and after
     steps.length years he goes back in the pool. Anyone his team added after the cutoff (month-day, the season's
     year) can't be kept. L.keepInfo[pid] = { base, years, late } carries a player's history from season to season
     (and from an import); without it the draft board and the transactions decide. */
  function keepInfoOf(L, pid) {
    const r = L.settings.keeperRule || {}, k = (L.keepInfo && L.keepInfo[pid]) || {};
    let base = k.base;
    if (base == null) { const D = L.draft, i = D ? D.board.findIndex((pk) => pk && pk.pid === pid) : -1; base = i >= 0 ? F.slotInfo(D, i).round : r.fa || 15; }
    return { base, years: k.years || 0, late: k.late != null ? !!k.late : lateAdd(L, pid) };
  }
  function lateAdd(L, pid) {
    const r = L.settings.keeperRule || {};
    if (!r.cutoff) return false;
    const owner = L.rosters.findIndex((x) => x.includes(pid));
    if (owner < 0) return false;
    // the last time his team got him: a pickup or claim after the cutoff makes him a late add; a trade doesn't
    const got = (L.tx || []).filter((e) => e.team === owner && [].concat(e.adds || []).includes(pid)).pop();
    if (!got || /trade|draft/.test(got.type || "")) return false;
    const yr = new Date(L.start || got.at).getUTCFullYear(), [m, d] = r.cutoff.split("-").map(Number);
    return got.at >= Date.UTC(yr, m - 1, d, 4);
  }
  function climbCost(L, pid) {
    const r = L.settings.keeperRule, steps = r.steps || [0, 2, 6], k = keepInfoOf(L, pid);
    if (k.late) return { round: null, no: "late", label: `Added after ${new Date(Date.UTC(2000, +r.cutoff.split("-")[0] - 1, +r.cutoff.split("-")[1])).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}, can't be kept` };
    if (k.years >= steps.length) return { round: null, no: "done", label: `Kept ${steps.length} years, back in the pool` };
    const round = Math.max(1, k.base - steps[k.years]);
    return { round, year: k.years + 1, base: k.base, label: `Round ${round}, ${ord(k.years + 1)} year kept` };
  }
  // The rounds a team's keepers land in. Under a climbing rule (sameRound "up"), a second keeper in a round the team
  // has one pick in moves up a round (and up again if that's taken too), and round 1 can't move: keeping two players
  // who cost a 1st takes two 1st-round picks. Elsewhere a keeper slides to the next open pick at draft time.
  // { ok, why, rows: [{ pid, round, cost, moved }] }
  function keeperPlan(L, teamId, pids) {
    const rows = pids.map((pid) => ({ pid, cost: keeperCost(L, pid) }));
    const bad = rows.find((x) => x.cost.no);
    if (bad) return { ok: false, why: bad.cost.label, rows };
    if (rows.length > (L.settings.keepers || 0)) return { ok: false, why: `Keep up to ${L.settings.keepers}`, rows };
    const rule = L.settings.keeperRule;
    if (!rule || rule.sameRound !== "up") { rows.forEach((x) => (x.round = x.cost.round)); return { ok: true, rows }; }
    // the picks a team holds in a round: its own unless traded away, plus any it traded for
    const held = (r) => L.teams.filter((t) => G.pickOwner(L, `${r}:${t.id}`) === teamId).length;
    const used = {};
    for (const x of rows.slice().sort((a, b) => a.cost.round - b.cost.round)) {
      let r = x.cost.round;
      while ((used[r] || 0) >= held(r)) {
        if (r === 1) return { ok: false, why: x.cost.round === 1 ? "Round 1 keepers stay in round 1, so keeping two takes two 1st-round picks" : "There's no earlier round left for this keeper", rows };
        r--;
      }
      used[r] = (used[r] || 0) + 1;
      x.round = r; x.moved = r !== x.cost.round;
    }
    return { ok: true, rows };
  }
  function keeperCost(L, pid) {
    if (L.settings.keeperRule) return climbCost(L, pid);
    const D = L.draft, how = L.settings.keeperCost || "round";
    // a player who changed hands by trade keeps his draft cost; one who was dropped and picked up is a pickup
    const owner = L.rosters.findIndex((r) => r.includes(pid));
    const traded = (L.tx || []).some((e) => e.type === "trade" && [].concat(e.adds || [], e.drops || []).includes(pid));
    const mine = (team) => owner >= 0 && (team === owner || traded);
    if (D && D.type === "auction") {
      const sale = (D.sales || []).find((x) => x.pid === pid && mine(x.team));
      const base = sale ? sale.price : 5;
      return { price: how === "price5" ? base + 5 : base, label: `$${how === "price5" ? base + 5 : base}${sale ? "" : ", a pickup"}` };
    }
    const rounds = D ? D.rounds : 15;
    const k = D ? D.board.findIndex((pk) => pk && pk.pid === pid && !pk.gone && mine(pk.team)) : -1;
    const base = k >= 0 ? F.slotInfo(D, k).round : rounds;
    if (how === "free") return { round: null, label: "A last-round pick" };
    const r = Math.max(1, how === "round1" ? base - 1 : base);
    return { round: r, label: `Round ${r}${k < 0 ? ", a pickup" : ""}` };
  }
  // Each player a team could keep, with his cost and how much he's worth over it (higher is a better keep).
  function keeperOptions(L, ctx, teamId) {
    const D = L.draft, n = L.teams.length;
    return L.rosters[teamId].map((id) => ctx.byId[id]).filter(Boolean).map((p) => {
      const c = keeperCost(L, p.id);
      if (c.no) return { pid: p.id, n: p.n, pos: p.pos[0], cost: c, surplus: -1e6, no: c.no };
      const surplus = c.price != null ? (p.$ || 0) - c.price : c.round == null ? (p.$ || 0) + 100 : ((c.round - 1) * n + n / 2) - (p.rank || 999);
      return { pid: p.id, n: p.n, pos: p.pos[0], cost: c, surplus };
    }).sort((a, b) => b.surplus - a.surplus);
  }
  // A bot, or a manager who never chose, keeps his best values, up to the limit, as long as each beats its cost.
  // Kickers and defenses come cheap every year, so nobody spends a keeper on one.
  const NO_KEEP = { K: 1, DEF: 1 };
  function autoKeepers(L, ctx, teamId) {
    const pick = keeperOptions(L, ctx, teamId).filter((o) => !o.no && o.surplus > 0 && !NO_KEEP[o.pos]);
    if (!L.settings.keeperRule) return pick.slice(0, L.settings.keepers || 0).map((o) => o.pid);
    // a climbing rule: take the best values that still fit (two round-1 keepers need two 1sts)
    const out = [];
    for (const o of pick) { if (out.length >= (L.settings.keepers || 0)) break; if (keeperPlan(L, teamId, out.concat(o.pid)).ok) out.push(o.pid); }
    return out;
  }
  // After the deadline (L.next.due), a team that never picked keeps nobody, or its best values (L.next.missed "auto").
  const keepersOf = (L, ctx, teamId) => {
    const p = L.next && L.next.picks && L.next.picks[teamId];
    if (p != null) return p;
    return L.next && L.next.missed === "none" ? [] : autoKeepers(L, ctx, teamId);
  };
  // Next season's draft: the same teams, rules and scoring, worst-to-first order, keepers already on the board.
  function nextDraft(L, ctx, sport, picks, o = {}) {
    const D0 = L.draft || {}, now = o.now || Date.now(), n = L.teams.length;
    // the commissioner's order (L.nextOrder, round 1 first to last: a lottery, say), or worst to first
    const want = L.nextOrder || (L.next && L.next.order);
    const set = Array.isArray(want) && want.length === n && new Set(want).size === n ? want.slice() : null;
    const order = set || standings(L).map((r) => r.team).reverse();
    if (L.settings.dynasty) return rookieDraft(L, ctx, sport, order, o);
    const keepers = [];
    for (const t of L.teams) {
      const mine = (picks && picks[t.id] != null ? picks[t.id] : keepersOf(L, ctx, t.id)).filter((id) => L.rosters[t.id].includes(id)).slice(0, L.settings.keepers || 0);
      if (L.settings.keeperRule) {
        const plan = keeperPlan(L, t.id, mine.filter((pid) => !keeperCost(L, pid).no));
        for (const x of plan.ok ? plan.rows : []) keepers.push({ team: t.id, pid: x.pid, round: x.round, years: x.cost.year, base: x.cost.base });
        continue;
      }
      const free = [];
      for (const pid of mine) { const c = keeperCost(L, pid); if (c.round == null && c.price == null) free.push(pid); else keepers.push({ team: t.id, pid, round: c.round, price: c.price }); }
      free.forEach((pid, i) => keepers.push({ team: t.id, pid, round: (D0.rounds || 15) - i }));
    }
    // a keeper whose round is taken slides to the team's next open pick, so place the earliest rounds first
    keepers.sort((a, b) => (a.round || 0) - (b.round || 0));
    const D = F.create({ sport, type: D0.type || "snake", teams: L.teams.map((t) => ({ name: t.name, abbr: t.abbr, owner: t.owner })), seed: Math.floor((o.seed != null ? o.seed : Math.random()) * 2 ** 31) || 1,
      now, lineup: L.settings.lineup, bench: L.settings.bench, scoring: L.scoring, botDelay: D0.botDelay, clock: D0.clock, bidClock: D0.auction ? D0.auction.bidClock : undefined,
      nomClock: D0.auction ? D0.auction.nomClock : undefined, budget: D0.auction ? D0.auction.budget : undefined, name: L.name, trades: D0.trading !== false, order, keepers: [],
      rounds: D0.rounds, curve: D0.type === "mystery" && ctx && ctx.players ? F.pickCurve(ctx.players, n * (D0.rounds || L.settings.lineup.length + L.settings.bench)) : D0.curve, reveal: D0.reveal });
    // picks traded in the offseason belong to the teams holding them (and remember whose they were), then keepers
    // take their slots
    if (D.type !== "auction" && L.picks) D.order.forEach((orig, k) => { const r = Math.floor(k / n) + 1, own = G.pickOwner(L, `${r}:${orig}`); if (own !== orig) { D.order[k] = own; D.via[k] = orig; } });
    for (const k of keepers) F.keep(D, k.team, k.pid, k.round, k.price);
    D.teams.forEach((t, i) => (t.color = L.teams[i].color));
    D.season = D0.season; if (D0.scoringSpec) D.scoringSpec = D0.scoringSpec;
    D.year = (D0.year || 1) + 1;
    // a climbing rule: each keeper's history goes with him into the new season (begin() reads D.keepInfo)
    if (L.settings.keeperRule) {
      D.keeperRule = L.settings.keeperRule; D.keepersN = L.settings.keepers;
      D.keepInfo = Object.fromEntries(keepers.map((k) => [k.pid, { base: k.base, years: k.years }]));
    }
    return D;
  }
  // A dynasty's next season: every roster (IR too) carries over, and a short linear draft of rookies and free agents
  // runs worst to first. Traded picks go to the teams holding them.
  function rookieDraft(L, ctx, sport, order, o = {}) {
    const D0 = L.draft || {}, now = o.now || Date.now(), n = L.teams.length, R = L.settings.dynasty.rounds || 3;
    const carry = L.teams.map((t) => L.rosters[t.id].slice());
    const D = F.create({ sport, type: "linear", teams: L.teams.map((t) => ({ name: t.name, abbr: t.abbr, owner: t.owner })), seed: Math.floor((o.seed != null ? o.seed : Math.random()) * 2 ** 31) || 1,
      now, lineup: L.settings.lineup, bench: L.settings.bench, scoring: L.scoring, botDelay: D0.botDelay, clock: D0.type === "auction" ? 60 : D0.clock, name: L.name, trades: D0.trading !== false,
      order, rounds: R, carry });
    // a traded pick: its slot belongs to the team that holds it now, and remembers whose it was
    D.order.forEach((orig, k) => { const r = Math.floor(k / n) + 1, own = G.pickOwner(L, `${r}:${orig}`); if (own !== orig) { D.order[k] = own; D.via[k] = orig; } });
    D.teams.forEach((t, i) => (t.color = L.teams[i].color));
    D.season = D0.season; if (D0.scoringSpec) D.scoringSpec = D0.scoringSpec;
    D.year = (D0.year || 1) + 1;
    D.rookie = true;
    // picks traded for the season after next become next season's picks in the new league
    D.futurePicks = {};
    for (const [k, own] of Object.entries(L.picks || {})) if (G.pickYear(k) === 2) { const [r, t] = k.split(":"); if (own !== +t) D.futurePicks[`${r}:${t}`] = own; }
    // taxi squads carry over, and so does who's been promoted off one
    if (G.taxiSlots(L)) { D.taxi = L.teams.map((t) => G.taxiOf(L, t.id).slice()); D.promoted = Object.assign({}, L.promoted || {}); }
    return D;
  }
  const summary = (L) => G.summary(L);
  const standings = (L) => G.standings(L);

  return { keeperPlan, keepersOf, keepInfoOf, sealedKind, sealedDue, draftRoster, startAfter, weekOf, realCovers, mergeLive, slateGames, mergeGames, begin, catchUp, driveDraft, events, keeperCost, keeperOptions, autoKeepers, nextDraft, summary };
});
