/* The demo leagues: a bot draft, a season already a few weeks in, and real time from there. Each sport has a head to
   head league and a best ball guillotine league (?f=g) on this device; the Commissioner tab can jump ahead a week or
   start over. */
(function () {
  "use strict";
  const { sports: S, value: V, draft: F, league: G, ui: U } = window.FK;
  const { esc, $ } = U;
  const N = window.FK.nav;   // Draft Lab's one navigation (nav.js)
  const store = U.store("fk-demo");
  const theme = U.theme("fk-lab");
  const DAY = 864e5, WEEK = 7 * DAY, HOUR = 36e5;
  const NAMES = {
    nba: "Hardwood Heads", nfl: "Sunday Scaries", mlb: "Bullpen Mafia", nhl: "Frozen Assets", cbb: "Bracket Busters", cfb: "Saturday Spoilers",
  };
  const GNAMES = { nba: "Last Team Standing", nfl: "Off With Their Heads", mlb: "Sudden Death", nhl: "Sudden Death on Ice", cbb: "One and Done", cfb: "Upset Fever" };
  const params = new URLSearchParams(location.search);
  const sportKey = S.ALL[params.get("s")] && !S.ALL[params.get("s")].dailyOnly ? params.get("s") : store.get("last", S.inSeason());
  const fmt = params.get("f") === "g" ? "g" : params.get("f") === "h" ? "h" : params.get("s") ? "h" : store.get("lastf", "h");
  const guil = fmt === "g";
  // ?play=mock: the finished one-day or one-week mock from the mock draft, played out live on its real games
  const playing = params.get("play") === "mock";
  const KEY = sportKey + (guil ? ":g" : "");
  const nameOf = (k, g) => (g ? GNAMES : NAMES)[k];
  store.set("last", sportKey); store.set("lastf", fmt);
  let data = null, sport = null, players = null, L = null, app = null, weeks = null;
  // real box scores for this season, when the data has them (basketball and football)
  const hooks = () => ({ real: weeks });

  async function load() {
    const r = await fetch(`data/${sportKey}.json`, { cache: "no-cache" });
    data = await r.json();
    sport = S.attach(Object.assign({}, S[sportKey]), data);
    const have = new Set(data.players.flatMap((p) => p.pos));
    const lineup = sport.lineup.filter((s) => sport.slots[s] === "*" || sport.slots[s].some((x) => have.has(x)));
    players = data.players.map((p) => Object.assign({}, p));
    const scoring = Object.keys(sport.scorings)[0];
    V.evaluate(sport, players, { teams: 10, lineup, scoring, market: sportKey === "nhl" ? null : await fetch(`data/market-${sportKey}.json`, { cache: "no-cache" }).then((x) => (x.ok ? x.json() : null)).catch(() => null) });
    weeks = await fetch(`data/weeks-${sportKey}.json`, { cache: "no-cache" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (weeks && String(weeks.season) !== String(data.season)) weeks = null;
    livePoll();
    L = store.get(KEY, null);
    if (!L || L.v !== 1 || L.demo !== 2) L = build(lineup, scoring);
    keepPool();
    // a demo on this season's real calendar scores on real games from here on
    if (weeks && !/replay/.test(L.season || "") && L.settings.real == null) L.settings.real = true;
    catchUp();
  }

  // live box scores, every minute while the page is open, for a demo on this season's real games
  let liveT = null;
  async function livePoll() {
    clearTimeout(liveT);
    const FK = window.FK;
    if (weeks && FK.cloud && FK.season && !document.hidden && (!L || L.settings.real)) {
      const lv = await FK.cloud.live(sportKey);
      const kicked = L && FK.league.setKicks(L, lv);   // this week's kickoff times, so players lock when their games start
      if (kicked) save();
      if ((FK.season.mergeLive(weeks, lv) || kicked) && app && !U.dialogOpen()) app.refresh();
    }
    liveT = setTimeout(livePoll, document.hidden ? 5 * 60e3 : 60e3);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && weeks) livePoll(); });
  // The demo runs on the real calendar: fantasy week 1 of this season (football weeks start Tuesday, after Monday
  // night; basketball weeks start Monday). Out of season, a replay lined up with Mondays, five weeks in.
  const WEEK1 = { nfl: new Date(2026, 8, 8).getTime(), nba: new Date(2026, 9, 19).getTime() };
  function calendar(now) {
    // hockey and college: week 1 is the weeks file's first week that starts on a Monday (college football's week 1 is a
    // long opening stretch, so its demo starts with week 3)
    const monday = (w) => new Date(w.start + "T12:00:00Z").getUTCDay() === 1;
    const first = ["nhl", "cbb", "cfb"].includes(sportKey) && weeks ? Object.values(weeks.weeks).filter(monday).sort((a, b) => a.start.localeCompare(b.start))[0] : null;
    const s = first ? Date.parse(first.start + "T13:00:00Z") : WEEK1[sportKey];
    if (s && now - s >= WEEK && now - s < 24 * WEEK) return { start: s, replay: false };
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return { start: d.getTime() - 5 * WEEK, replay: true };
  }
  // A bot draft (your seat drafts on autopilot), then the first weeks played, with bots working the wire.
  function build(lineup, scoring, fromMock) {
    const now = Date.now();
    const cal = calendar(now);
    const seed = Math.floor(Math.random() * 2 ** 31);
    let D = fromMock;
    if (!D) {
      D = F.create({ sport, teams: guil ? 12 : 10, seed, now: cal.start - 4 * DAY, lineup, scoring, botDelay: 0, name: nameOf(sportKey, guil) + " draft" });
      D.teams[0].owner = "You"; D.teams[0].name = "Your Team"; D.teams[0].abbr = "YOU";
      const dctx = F.context(D, players, sport);
      F.start(D, D.created); D.teams[0].auto = true;
      F.tick(D, dctx, D.created + 1, 2000);
      D.teams[0].auto = false;
    }
    // a guillotine demo opens a day after a chop, with the bidding still open
    const start = cal.start, played = Math.floor((now - start) / WEEK);
    const settings = guil ? { format: "guillotine", bestBall: true, waiverAt: 60, immune: { 0: played } }
      : { weeks: 14, playoffTeams: 4, deadline: 11, tradeReview: "vote", reviewHours: 0.03, vetoShare: 0.5, waiverDays: 2 };
    if (sportKey === "nhl") settings.minGoalieGames = 3;
    // college football's demo ends with the conference championships: ten weeks from mid-September, then the playoffs
    if (sportKey === "cfb" && !guil) Object.assign(settings, { weeks: 10, deadline: 8 });
    if (D.pool && D.pool.length) settings.pool = D.pool.slice();     // a conference-only mock plays on with just those schools
    const lg = G.create({ sport, draft: D, name: nameOf(sportKey, guil), season: data.season + (cal.replay ? " replay" : ""), now: start, start, scoring: D.scoring, settings });
    lg.demo = 2;
    lg.teams.forEach((t, i) => (t.color = [0, 1, 2, 3, 4, 5, 6, 7, 11, 9, 8, 10][i % 12]));
    return lg;
  }
  const ctxOf = () => G.context(L, players, sport, hooks());
  // Real time moves the season: every week that has ended since the last visit gets played.
  function catchUp() {
    const ctx = ctxOf();
    let moved = false;
    // guillotine bots bid on the chopped roster early in the week, before the midweek waiver run
    const bids = () => {
      L.botBid = L.botBid || {};
      const at = G.weekStart(L, L.week) + HOUR;
      if (!G.isGuillotine(L) || L.botBid[L.week] || Date.now() < at || L.week > G.totalWeeks(L)) return;
      L.botBid[L.week] = true;
      G.botBids(L, ctx, at, F.rng(L.seed + L.week * 41));
    };
    while (G.canFinish(L, ctx, Date.now())) {
      const end = G.weekStart(L, L.week + 1);
      bids();
      if (G.isGuillotine(L)) G.tick(L, ctx, G.waiverRunAt(L) + 1);
      G.botWeek(L, ctx, end - 2 * DAY, F.rng(L.seed + L.week * 13));
      G.tick(L, ctx, end - DAY);
      if (!G.isGuillotine(L) && L.week >= 2 && F.rng(L.seed + L.week * 29)() < 0.55) botOffer(ctx, end - 0.5 * DAY);
      L.prevPower = Object.fromEntries(G.power(L, ctx).map((r) => [r.team, r.rank]));
      G.finishWeek(L, ctx, end);
      moved = true;
    }
    bids();
    G.tick(L, ctx, Date.now());
    save();
  }
  // Now and then a bot sends you an offer that's close to fair.
  function botOffer(ctx, at) {
    const r = F.rng(L.seed + L.week * 31);
    const bots = L.teams.filter((t) => !t.owner);
    const b = bots[Math.floor(r() * bots.length)];
    if (!b || L.trades.some((t) => t.status === "pending" && t.to === 0)) return;
    const mine = L.rosters[0].slice().sort((x, y) => ctx.byId[y].$ - ctx.byId[x].$);
    const theirs = L.rosters[b.id].slice().sort((x, y) => ctx.byId[y].$ - ctx.byId[x].$);
    const want = mine[1 + Math.floor(r() * 5)];
    if (!want) return;
    const v = G.pValue(ctx, want);
    const give = theirs.find((id) => { const x = G.pValue(ctx, id); return x <= v * 1.1 && x >= v * 0.8 && id !== want; });
    if (!give) return;
    const notes = ["Saw you could use help here.", "Fair swap?", "Let's shake things up.", "This works for both of us.", ""];
    G.propose(L, ctx, b.id, 0, [give], [want], at, { note: notes[Math.floor(r() * notes.length)] });
  }
  const save = () => store.set(KEY, L);
  const frac = (w) => Math.max(0, Math.min(1, (Date.now() - G.weekStart(L, w)) / WEEK));

  function mount() {
    const leagues = S.SEASON_SPORTS.flatMap((s) => [[s, false], [s, true]]).filter(([s, g]) => !(s.key === sportKey && g === guil));
    app = U.leagueApp({
      top: $("#top"), el: $("#app"), sport, players, league: () => L, save: () => save(), me: () => 0, now: () => Date.now(), frac, hooks: hooks(),
      brand: { name: "Draft Lab", href: N.HOME, mark: `<img src="mark.svg" alt="">` },
      switcher: () => U.switcher({ name: L.name, crest: U.leagueCrest(U.leagueBrand(L.name, L.settings.brand), "sm") },
        leagues.map(([s, g]) => ({ href: `?s=${s.key}&f=${g ? "g" : "h"}`, name: nameOf(s.key, g), sub: `${s.name}, ${g ? "best ball guillotine" : "head to head"}`, crest: U.leagueCrest(U.leagueBrand(nameOf(s.key, g)), "sm") })),
        `<a href="${N.HOME}">Draft Lab home<small>Every sport, league and tool</small></a><a href="/fantasy/mock/#draft">Mock draft<small>Draft against bots in any format</small></a>`),
      right: () => `<button class="btn sm ghost" data-theme>${theme.dark() ? "Light" : "Dark"}</button>`,
      notice: () => `<aside class="demo-notice"><div class="wrap"><p><strong>Demo league · saved on this device.</strong> <span>Explore every page and try moves against bots.</span></p><a class="btn sm go" href="/fantasy/leagues/?${new URLSearchParams({ rules: window.FK.experience.encode(window.FK.experience.fromDraft(L.draft, L.settings)) })}"><span class="dn-l">Create this league with friends</span><span class="dn-s">Create with friends</span></a></div></aside>`,
      draftHref: "/fantasy/mock/#draft",
      commishTools,
    });
  }
  function commishTools() {
    const next = G.weekStart(L, L.week + 1);
    const done = L.week > G.totalWeeks(L);
    return `<div class="head"><h1 class="disp">Commissioner</h1><span class="ps">Demo controls. They only change this device's copy of the league.</span></div>
      <div class="cols2">
        <div class="card"><div class="mod-h"><h2>The season</h2></div><div class="bd stack">
          <p class="small" style="margin:0">${done ? "The season is over." : `Week ${L.week} of ${G.totalWeeks(L)}. It ends ${new Date(next).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })}, then ${G.isGuillotine(L) ? "the lowest team is chopped and its players go up for bids. Bids run 60 hours into the next week" : "waivers run and the next week starts"}.`}${L.settings.real ? " This demo is scored on real box scores. Jumping ahead leaves the real calendar, so the rest of the season would be simulated." : ""}</p>
          <div class="row" style="flex-wrap:wrap"><button class="btn go" data-c="week"${done ? " disabled" : ""}>Finish this week now</button><button class="btn" data-c="season"${done ? " disabled" : ""}>Play out the season</button></div></div></div>
        <div class="card"><div class="mod-h"><h2>Start over</h2></div><div class="bd stack">
          <p class="small" style="margin:0">A new bot draft and a new season, ${(() => { const c = calendar(Date.now()), n = c.replay ? (guil ? 4 : 5) : Math.floor((Date.now() - c.start) / WEEK); return `${n} week${n === 1 ? "" : "s"}`; })()} in.</p>
          <div class="row" style="flex-wrap:wrap"><button class="btn warn" data-c="reset">New demo league</button>${mockDone() ? `<button class="btn" data-c="mock">Use my Draft Lab mock</button>` : ""}</div></div></div>
      </div>`;
  }
  // a conference-only mock's league keeps its free agents to those schools (in place: the app holds this array)
  function keepPool() { if (L && L.settings && L.settings.pool) { const keep = players.filter((p) => S.inPool(L, p)); players.splice(0, players.length, ...keep); } }
  // Start a league from the finished Draft Lab mock, after asking: it replaces this demo league.
  function useMock() {
    U.confirm("Play a season with your mock?", `Your finished Draft Lab mock becomes a new league here. It replaces ${esc(L.name)} on this device.`, "Start the season", () => {
      const m = U.store("fk-lab").get("mock", null); const D = m.D; D.teams[0].owner = "You";
      L = build(D.lineup, D.scoring, D); keepPool(); catchUp(); location.hash = "#league/overview"; app.refresh();
    });
  }
  const mockDone = () => { const m = U.store("fk-lab").get("mock", null); return m && m.D && m.D.phase === "done" && m.D.sport === sportKey && m.D.teams.length >= 4; };
  // Jump ahead: shift the calendar back so the current week has already ended, then catch up.
  function skip(n) {
    // jumping ahead leaves the real calendar, so the rest of the season is simulated
    if (L.settings.real) L.settings.real = false;
    for (let i = 0; i < n && L.week <= G.totalWeeks(L); i++) {
      const shift = Math.max(0, G.weekStart(L, L.week + 1) - Date.now()) + 1000;
      L.start -= shift;
      for (const t of L.trades) { if (t.reviewEnds) t.reviewEnds -= shift; if (t.status === "pending") t.at -= shift; }
      for (const c of L.claims) if (c.status === "open") c.at -= shift;
      for (const k of Object.keys(L.waivers)) L.waivers[k] -= shift;
      if (L.openWaivers) L.openWaivers -= shift;
      catchUp();
    }
  }
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-c]"), th = e.target.closest("button[data-theme]");
    if (th) { theme.toggle(); app.render(); return; }
    if (!c) return;
    const a = c.dataset.c;
    if (a === "week") { const w = L.week; skip(1); U.toast(recap(w)); app.refresh(); }
    else if (a === "season") U.confirm("Play out the whole season?", "Every week left is played right now, through the final. You can't undo it, but you can start a new demo league.", "Play it out", () => { skip(30); U.toast("The season is over."); location.hash = "#league/overview"; app.refresh(); });
    else if (a === "reset") U.confirm("Start a new demo league?", "This clears the current league on this device.", "Start over", () => { L = build(lineupNow(), Object.keys(sport.scorings)[0]); catchUp(); location.hash = "#league/overview"; app.refresh(); });
    else if (a === "mock") useMock();
  });
  // One line on how your week went, for the toast after "Finish this week now".
  function recap(w) {
    const res = L.results[w];
    if (!res) return `On to week ${Math.min(L.week, G.totalWeeks(L))}.`;
    const f = (x) => (typeof x === "number" ? (Number.isInteger(x) ? x : x.toFixed(1)) : x);
    if (res.block) {
      const out = res.chopped.map((t) => L.teams[t].name).join(" and ");
      const mine = res.block.find((r) => r.team === 0);
      if (!mine) return `Week ${w}: ${out} was chopped.`;
      return mine.out ? `Week ${w}: you were chopped with ${f(mine.score)}.` : `Week ${w}: you survived in ${mine.rank}${["th", "st", "nd", "rd"][mine.rank % 10 > 3 || [11, 12, 13].includes(mine.rank % 100) ? 0 : mine.rank % 10]} place. ${out} was chopped.`;
    }
    const g = res.find((x) => x.a === 0 || x.b === 0);
    if (!g) return `Week ${w} is final.`;
    const mineA = g.a === 0, me = mineA ? g.sa : g.sb, them = mineA ? g.sb : g.sa, opp = L.teams[mineA ? g.b : g.a].name;
    const won = g.w === "t" ? null : (g.w === "a") === mineA;
    return `Week ${w} final: you ${won == null ? "tied" : won ? "beat" : "lost to"} ${opp}, ${f(me)} to ${f(them)}.`;
  }
  const lineupNow = () => { const have = new Set(data.players.flatMap((p) => p.pos)); return sport.lineup.filter((s) => sport.slots[s] === "*" || sport.slots[s].some((x) => have.has(x))); };
  // Live scores and bot replies: refresh every few seconds while the page is open.
  setInterval(() => {
    if (playing) return;
    if (!L || U.dialogOpen() || document.querySelector('details[open]') || (document.activeElement && document.activeElement.id === 'fk-q')) return;
    const offersNow = () => L.trades.filter((t) => t.status === "pending" && t.to === 0).map((t) => t.id);
    const before = { week: L.week, offers: offersNow(), mine: L.trades.filter((t) => t.from === 0).map((t) => t.status).join() };
    catchUp();
    app.refresh();
    // say what changed: a new offer (it's also waiting at the top of every page), an answer to yours, a new week
    const fresh = L.trades.filter((t) => t.status === "pending" && t.to === 0 && !before.offers.includes(t.id));
    if (fresh.length) U.toast(`${L.teams[fresh[0].from].name} sent you a trade offer. Review it from the banner at the top.`);
    else if (L.trades.filter((t) => t.from === 0).map((t) => t.status).join() !== before.mine) U.toast("One of your trade offers got an answer. See Trades.");
    else if (L.week !== before.week) U.toast(`On to week ${Math.min(L.week, G.totalWeeks(L))}.`);
  }, 15000);

  // Another tab saved this league: take its copy, so two tabs don't overwrite each other's moves.
  window.addEventListener("storage", (e) => {
    if (playing || e.key !== "fk-demo:" + KEY || !L || !app) return;
    const next = store.get(KEY, null);
    if (next && next.v === 1) { L = next; app.refresh(); }
  });
  /* ---------- a one-day or one-week mock, played out live ----------
     The mock draft's finished slate or showdown draft becomes a one-week league on this device (season.js begin, as a
     real one-day or one-week league starts), scored from the real games as they're played: the slate's own box scores
     (fk-live ?games=) and the weekly live feed, every minute while the page is open. Head to head or everyone vs
     everyone, as the mock was set up. Your seat is team 0; bots set their lineups. */
  async function playMock() {
    const Z = window.FK.season, C = window.FK.cloud;
    const m = U.store("fk-lab").get("mock", null), D0 = m && m.D;
    const s0 = D0 && D0.season;
    const ok = D0 && D0.phase === "done" && s0 && s0.oneWeek && (s0.slate || (s0.showdown && s0.showdown.id)) && S[D0.sport];
    if (!ok) {
      $("#app").innerHTML = `<div class="wrap page"><div class="card"><div class="bd stack"><p style="margin:0"><b>No finished one-day or one-week mock on this device.</b></p><p class="ps" style="margin:0">Turn on One day (basketball, college hoops) or One week (football) in the mock draft, draft it, then play it out here on the real games.</p><div><a class="btn go" href="/fantasy/mock/#setup">Set up a mock</a></div></div></div></div>`;
      return;
    }
    const k = D0.sport;
    data = await fetch(`data/${k}.json`, { cache: "no-cache" }).then((r) => r.json());
    sport = S.withScoring(S.attach(Object.assign({}, S[k]), data), D0.scoringSpec);
    players = data.players.map((p) => Object.assign({}, p));
    V.evaluate(sport, players, { teams: D0.teams.length, lineup: D0.lineup, bench: D0.bench, scoring: D0.scoring, week: S.weekFor({ season: s0 }, sport), oneDay: !!S.dayOf({ season: s0 }) });
    weeks = await fetch(`data/weeks-${k}.json`, { cache: "no-cache" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (weeks && String(weeks.season) !== String(data.season)) weeks = null;
    if (!weeks) weeks = { sport: k, season: String(data.season), line: "tot", cols: (sport.data && sport.data.lines && sport.data.lines.tot && sport.data.lines.tot.cols) || [], weeks: {} };
    const key = `mock:${D0.sport}:${D0.seed}:${D0.created}`;
    L = store.get("night", null);
    if (!L || L.mockKey !== key) {
      L = Z.begin(JSON.parse(JSON.stringify(D0)), sport, { now: Math.max(D0.done || 0, Date.now()), real: weeks, name: D0.name === "Mock draft" ? `${S[k].short || S[k].name} mock` : D0.name });
      L.mockKey = key; L.settings.real = true;
      L.teams.forEach((t, i) => (t.color = D0.teams[i] && D0.teams[i].color != null ? D0.teams[i].color : i % 12));
    }
    const hk = { real: weeks };
    const ctxN = () => G.context(L, players, sport, hk);
    const saveN = () => store.set("night", L);
    const fracN = (w) => Math.max(0, Math.min(1, (Date.now() - G.weekStart(L, w)) / Math.max(HOUR, G.weekStart(L, w + 1) - G.weekStart(L, w))));
    const step = () => { const moved = Z.catchUp(L, ctxN(), Date.now()); if (moved) saveN(); return moved; };
    step(); saveN();
    document.title = `${L.name} | Draft Lab`;
    app = U.leagueApp({
      top: $("#top"), el: $("#app"), sport, players, league: () => L, save: saveN, me: () => 0, now: () => Date.now(), frac: fracN, hooks: hk,
      brand: { name: "Draft Lab", href: N.HOME, mark: `<img src="mark.svg" alt="">` },
      switcher: () => U.switcher({ name: L.name, crest: U.leagueCrest(U.leagueBrand(L.name, L.settings.brand), "sm") }, [],
        `<a href="/fantasy/mock/#setup">New mock<small>Draft another one</small></a><a href="/fantasy/leagues/">My leagues<small>Real leagues with friends</small></a>`),
      right: () => `<button class="btn sm ghost" data-theme>${theme.dark() ? "Light" : "Dark"}</button>`,
      draftHref: "/fantasy/mock/#draft",
      commishTools: () => `<div class="head"><h1 class="disp">Your mock</h1><span class="ps">It only lives on this device.</span></div><div class="card"><div class="bd stack"><p class="small" style="margin:0">It plays out on the real games as they happen, and it's final once the last one ends. Draft another any time.</p><div><a class="btn go" href="/fantasy/mock/#setup">New mock</a></div></div></div>`,
    });
    // the slate's box scores and the live feed, every minute while the page is open
    let t = null;
    const poll = async () => {
      clearTimeout(t);
      if (!document.hidden && C) {
        const ids = Z.slateGames && Z.slateGames(L);
        const lv = ids && k === "cbb" ? null : await C.live(k).catch(() => null);
        const kicked = G.setKicks(L, lv);
        const gm = ids ? await C.games(k, ids).catch(() => null) : null;
        const gch = !!(gm && Z.mergeGames(weeks, gm));
        const lch = Z.mergeLive(weeks, lv);
        if (step() || kicked) saveN();
        if ((gch || lch || kicked) && !U.dialogOpen()) app.refresh();
      }
      t = setTimeout(poll, document.hidden ? 5 * 60e3 : 60e3);
    };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
    poll();
  }
  if (playing) playMock().catch((e) => { $("#app").innerHTML = `<div class="wrap page"><div class="banner loss"><b>Couldn't load your mock.</b> <span class="muted">${esc(e.message)}</span></div></div>`; console.error(e); });
  else load().then(mount).then(() => {
    // Draft Lab's "Play a season with it" lands here with ?mock=1
    if (params.get("mock") === "1") { history.replaceState(null, "", location.pathname + `?s=${sportKey}&f=${fmt}` + location.hash); if (mockDone()) useMock(); }
  }).catch((e) => { $("#app").innerHTML = `<div class="wrap page"><div class="banner loss"><b>Couldn't load the league.</b> <span class="muted">${esc(e.message)}</span></div></div>`; console.error(e); });
})();
