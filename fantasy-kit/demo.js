/* The demo leagues: a bot draft, a season already a few weeks in, and real time from there. Each sport has a head to
   head league and a best ball guillotine league (?f=g) on this device; the Commissioner tab can jump ahead a week or
   start over. */
(function () {
  "use strict";
  const { sports: S, value: V, draft: F, league: G, ui: U } = window.FK;
  const { esc, $ } = U;
  const store = U.store("fk-demo");
  const theme = U.theme("fk-lab");
  const DAY = 864e5, WEEK = 7 * DAY, HOUR = 36e5;
  const NAMES = {
    nba: "Hardwood Heads", nfl: "Sunday Scaries", mlb: "Bullpen Mafia",
  };
  const GNAMES = { nba: "Last Team Standing", nfl: "Off With Their Heads", mlb: "Sudden Death" };
  const params = new URLSearchParams(location.search);
  const sportKey = S.ALL[params.get("s")] ? params.get("s") : store.get("last", "nba");
  const fmt = params.get("f") === "g" ? "g" : params.get("f") === "h" ? "h" : params.get("s") ? "h" : store.get("lastf", "h");
  const guil = fmt === "g";
  const KEY = sportKey + (guil ? ":g" : "");
  const nameOf = (k, g) => (g ? GNAMES : NAMES)[k];
  store.set("last", sportKey); store.set("lastf", fmt);
  let data = null, sport = null, players = null, L = null, app = null;

  async function load() {
    const r = await fetch(`data/${sportKey}.json`, { cache: "no-cache" });
    data = await r.json();
    sport = S.attach(Object.assign({}, S[sportKey]), data);
    const have = new Set(data.players.flatMap((p) => p.pos));
    const lineup = sport.lineup.filter((s) => sport.slots[s] === "*" || sport.slots[s].some((x) => have.has(x)));
    players = data.players.map((p) => Object.assign({}, p));
    const scoring = Object.keys(sport.scorings)[0];
    V.evaluate(sport, players, { teams: 10, lineup, scoring });
    L = store.get(KEY, null);
    if (!L || L.v !== 1 || L.demo !== 2) L = build(lineup, scoring);
    catchUp();
  }

  // The demo runs on the real calendar: fantasy week 1 of this season (football weeks start Tuesday, after Monday
  // night; basketball weeks start Monday). Out of season, a replay lined up with Mondays, five weeks in.
  const WEEK1 = { nfl: new Date(2026, 8, 8).getTime(), nba: new Date(2026, 9, 19).getTime() };
  function calendar(now) {
    const s = WEEK1[sportKey];
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
      : { weeks: 14, playoffTeams: 4, deadline: 11, tradeReview: "vote", reviewHours: 0.03, vetoShare: 0.5, waiverHours: 36 };
    const lg = G.create({ sport, draft: D, name: nameOf(sportKey, guil), season: data.season + (cal.replay ? " replay" : ""), now: start, start, scoring: D.scoring, settings });
    lg.demo = 2;
    lg.teams.forEach((t, i) => (t.color = [0, 1, 2, 3, 4, 5, 6, 7, 11, 9, 8, 10][i % 12]));
    return lg;
  }
  const ctxOf = () => G.context(L, players, sport);
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
    while (L.week <= G.totalWeeks(L) && Date.now() >= G.weekStart(L, L.week + 1)) {
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
    const leagues = Object.values(S.ALL).flatMap((s) => [[s, false], [s, true]]).filter(([s, g]) => !(s.key === sportKey && g === guil));
    app = U.leagueApp({
      top: $("#top"), el: $("#app"), sport, players, league: () => L, save: () => save(), me: () => 0, now: () => Date.now(), frac,
      brand: { name: "Draft Lab", href: "./", mark: `<img src="mark.svg" alt="">` },
      switcher: () => U.switcher({ name: L.name, abbr: sportKey.toUpperCase(), color: { nba: 4, nfl: 2, mlb: 0 }[sportKey] },
        leagues.map(([s, g]) => ({ href: `?s=${s.key}&f=${g ? "g" : "h"}`, name: nameOf(s.key, g), sub: `${s.name}, ${g ? "best ball guillotine" : "head to head"}`, av: { abbr: s.key.toUpperCase(), color: { nba: 4, nfl: 2, mlb: 0 }[s.key] } })),
        `<a href="./">Draft Lab<small>Mock drafts and rankings</small></a><a href="../fantasy/">All fantasy<small>Every league and tool, by sport</small></a>`),
      right: () => `<button class="btn sm ghost" data-theme>${theme.dark() ? "Light" : "Dark"}</button>`,
      draftHref: "./#draft",
      commishTools,
    });
  }
  function commishTools() {
    const next = G.weekStart(L, L.week + 1);
    const done = L.week > G.totalWeeks(L);
    return `<div class="head"><h1 class="disp">Commissioner</h1><span class="ps">Demo controls. They only change this device's copy of the league.</span></div>
      <div class="cols2">
        <div class="card"><div class="mod-h"><h2>The season</h2></div><div class="bd stack">
          <p class="small" style="margin:0">${done ? "The season is over." : `Week ${L.week} of ${G.totalWeeks(L)}. It ends ${new Date(next).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })}, then ${G.isGuillotine(L) ? "the lowest team is chopped and its players go up for bids. Bids run 60 hours into the next week" : "waivers run and the next week starts"}.`}</p>
          <div class="row" style="flex-wrap:wrap"><button class="btn go" data-c="week"${done ? " disabled" : ""}>Finish this week now</button><button class="btn" data-c="season"${done ? " disabled" : ""}>Play out the season</button></div></div></div>
        <div class="card"><div class="mod-h"><h2>Start over</h2></div><div class="bd stack">
          <p class="small" style="margin:0">A new bot draft and a new season, ${guil ? "four" : "five"} weeks in.</p>
          <div class="row" style="flex-wrap:wrap"><button class="btn warn" data-c="reset">New demo league</button>${mockDone() ? `<button class="btn" data-c="mock">Use my Draft Lab mock</button>` : ""}</div></div></div>
      </div>`;
  }
  // Start a league from the finished Draft Lab mock, after asking: it replaces this demo league.
  function useMock() {
    U.confirm("Play a season with your mock?", `Your finished Draft Lab mock becomes a new league here. It replaces ${esc(L.name)} on this device.`, "Start the season", () => {
      const m = U.store("fk-lab").get("mock", null); const D = m.D; D.teams[0].owner = "You";
      L = build(D.lineup, D.scoring, D); catchUp(); location.hash = "#league/overview"; app.refresh();
    });
  }
  const mockDone = () => { const m = U.store("fk-lab").get("mock", null); return m && m.D && m.D.phase === "done" && m.D.sport === sportKey && m.D.teams.length >= 4; };
  // Jump ahead: shift the calendar back so the current week has already ended, then catch up.
  function skip(weeks) {
    for (let i = 0; i < weeks && L.week <= G.totalWeeks(L); i++) {
      const shift = Math.max(0, G.weekStart(L, L.week + 1) - Date.now()) + 1000;
      L.start -= shift;
      for (const t of L.trades) { if (t.reviewEnds) t.reviewEnds -= shift; if (t.status === "pending") t.at -= shift; }
      for (const c of L.claims) if (c.status === "open") c.at -= shift;
      for (const k of Object.keys(L.waivers)) L.waivers[k] -= shift;
      catchUp();
    }
  }
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-c]"), th = e.target.closest("[data-theme]");
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

  load().then(mount).then(() => {
    // Draft Lab's "Play a season with it" lands here with ?mock=1
    if (params.get("mock") === "1") { history.replaceState(null, "", location.pathname + `?s=${sportKey}&f=${fmt}` + location.hash); if (mockDone()) useMock(); }
  }).catch((e) => { $("#app").innerHTML = `<div class="wrap page"><div class="banner loss"><b>Couldn't load the league.</b> <span class="muted">${esc(e.message)}</span></div></div>`; console.error(e); });
})();
