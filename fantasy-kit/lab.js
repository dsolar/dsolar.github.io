/* Draft Lab: mock drafts against bots, built on the Fantasy Kit. Everything stays on this device. */
(function () {
  "use strict";
  const { sports: S, value: V, draft: F, ui: U } = window.FK;
  const { esc, $, $$ } = U;
  const store = U.store("fk-lab");
  const theme = U.theme("fk-lab");
  const top = $("#top"), app = $("#app");
  const BLURB = { nba: "Real per-game lines, 9-cat or points", nfl: "Season points, half PPR, PPR or standard", mlb: "Last season paced to full, 5x5 or 8x8" };
  const DEFAULTS = { sport: S.inSeason(), scoring: "", type: "snake", teams: 10, slot: 0, clock: 30, budget: 200, bench: null, lineup: "", name: "", reveal: "start", test: 1, trades: 1 };
  let cfg = Object.assign({}, DEFAULTS, store.get("cfg", {}));
  if ([-20, -30, -60].includes(cfg.clock)) cfg.clock = -200;                // the old per-round banks
  // ?s=nfl (from the fantasy hub) picks the sport for setup and rankings
  const qs = new URLSearchParams(location.search).get("s");
  if (S[qs] && qs !== cfg.sport) { cfg = Object.assign(cfg, { sport: qs, scoring: "", lineup: "", bench: null }); store.set("cfg", cfg); }
  let mock = store.get("mock", null);            // { cfg, D }
  const cache = {};
  let roomCtl = null;
  const rank = { sport: cfg.sport, scoring: "", f: { q: "", pos: "", team: "" }, sort: { k: "rank", dir: 1 }, mode: "default" };

  async function loadSport(key) {
    if (!cache[key]) {
      const r = await fetch(`data/${key}.json`, { cache: "no-cache" });
      if (!r.ok) throw new Error(`Couldn't load ${key} players`);
      cache[key] = await r.json();
    }
    return cache[key];
  }
  // A fresh sport object linked to its data, the lineup this league uses (slots nobody in the pool can fill are
  // dropped, like kickers before the football feed has them), and the pool valued for this league.
  // When this sport's data last refreshed, and anything the daily health check (data/health.json) flagged for it.
  let health;
  async function freshness(sp) {
    if (health === undefined) health = await fetch("data/health.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const day = (t) => { const d = new Date(t); return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
    const mine = ((health && health.problems) || []).filter((x) => x.includes(`${sp.key}.json`) || x.includes(`-${sp.key}.json`));
    return `Player data updated ${day(sp.data.updated)}${sp.market && sp.market.updated ? `, outside rankings ${day(sp.market.updated)}` : ""}. ${mine.length ? `<span class="loss">Data check: ${esc(mine.join("; "))}.</span> ` : ""}`;
  }
  // Outside dynasty rankings (data/dynasty-<sport>.json, rebuilt daily by tools/dynasty_pull.py), when there are any.
  const dynCache = {};
  const mktCache = {};
  async function loadMarket(k) {
    if (!(k in mktCache)) mktCache[k] = await fetch(`data/market-${k}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return mktCache[k];
  }
  async function loadDynasty(k) {
    if (!(k in dynCache)) dynCache[k] = await fetch(`data/dynasty-${k}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return dynCache[k];
  }
  async function pool(c) {
    const data = await loadSport(c.sport);
    const sport = S.attach(Object.assign({}, S[c.sport]), data);
    const have = new Set(data.players.flatMap((p) => p.pos));
    const ds = dayOn(c) ? daySlate(c) : null;
    if (dayOn(c) && !ds) throw new Error(daySched && daySched.error ? "Couldn't reach tonight's schedule. Try again in a moment." : daySched ? "There are no games left tonight or tomorrow. Turn off one day to draft the season." : "Tonight's games are still loading. Try again in a moment.");
    const want = ds ? ds.lineup.lineup.slice() : sdOn(c) ? S.SHOWDOWN.lineup.slice() : hzOn(c) ? ONE_WEEK_NFL.slice() : (c.lineup ? c.lineup.split(/[\s,]+/).filter(Boolean) : sport.lineup).filter((s) => sport.slots[s] && s !== "BN");
    const lineup = want.filter((s) => sport.slots[s] === "*" || sport.slots[s].some((x) => have.has(x)));
    const players = data.players.filter((p) => (!sdOn(c) || p.t === c.sdA || p.t === c.sdH) && (!ds || ds.slate.teams.includes(p.t))).map((p) => Object.assign({}, p));
    const scoring = sport.scorings[c.scoring] ? c.scoring : Object.keys(sport.scorings)[0];
    const bench = ds ? ds.lineup.bench : sdOn(c) ? S.SHOWDOWN.bench : hzOn(c) ? 0 : c.bench == null ? sport.bench : c.bench;
    const dyn = c.dynasty ? await loadDynasty(c.sport) : null;
    // a showdown of a real game on this week's or next week's schedule plays that week's projections
    const sdWk = sdOn(c) && sched ? (sched.weeks.find((w) => (w.games || []).some((g) => g.away === c.sdA && g.home === c.sdH)) || {}).week : null;
    V.evaluate(sport, players, { teams: c.teams, lineup, bench, scoring, budget: sdOn(c) ? 50 : c.budget, week: sdWk ? S.weekFor({ season: { showdown: { week: sdWk } } }, sport) : null, dynasty: !!c.dynasty, dynastyRanks: dyn, market: await loadMarket(c.sport) });
    return { sport, players, lineup, scoring, bench, data, slate: ds ? ds.slate : null };
  }

  /* ---------- header ---------- */
  function header(tab) {
    const right = `<a class="btn sm ghost" href="../fantasy/">All fantasy</a><button class="btn sm ghost" data-act="theme">${theme.dark() ? "Light" : "Dark"}</button>${mock ? `<button class="btn sm" data-act="new">New mock</button>` : ""}`;
    top.innerHTML = U.shell({ brand: { name: "Draft Lab", href: "./", mark: `<img src="mark.svg" alt="">` },
      tabs: [["leagues", "Your leagues"], ["week", "Quick games"], ["draft", "Mock draft"], ["rankings", "Rankings"], ["league", "Demo league"]], tab, right,
      hrefOf: (t, sub) => (t === "league" ? `league.html?s=${cfg.sport}` : t === "leagues" ? "leagues.html" : t === "week" ? "week.html" : "#" + t + (sub ? "/" + sub : "")) });
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.closest("#fk-room") || b.closest(".clock")) return;
    if (b.dataset.act === "theme") { theme.toggle(); route(); }
    if (b.dataset.act === "new") {
      U.dialog(`<h3>Start a new mock?</h3><p class="muted">This one ${mock && mock.D.phase === "done" ? "is saved until you start another" : "isn't finished"}. Starting over clears it from this device.</p><form><div class="acts"><button type="button" class="btn" data-close>Keep this one</button><button class="btn go">Start over</button></div></form>`,
        () => { mock = null; store.set("mock", null); location.hash = "#draft"; route(); });
    }
  });

  /* ---------- lineup builder (FK.ui.lineupBuilder) ---------- */
  const { lineupBuilder, orderLineup } = U;

  /* ---------- setup: the same look and controls as Start a league (FK.setup) ---------- */
  const K = window.FK.setup;
  const open = {};
  // a clock for each pick, or a time bank for the whole draft (a negative clock: its total in seconds)
  const PICK_CLOCKS = [[15, "15 sec"], [30, "30 sec"], [60, "1 min"], [90, "90 sec"], [0, "No clock"]];
  const BANKS = [[-120, "2 min"], [-200, "200 sec"], [-300, "5 min"], [-480, "8 min"]];
  const CLOCKS = PICK_CLOCKS.concat(BANKS.map(([v, l]) => [v, `${l} bank`]));
  const BID_CLOCKS = [[10, "10 sec"], [15, "15 sec"], [20, "20 sec"], [30, "30 sec"]];
  const fmtBank = (sec) => (sec % 60 ? `${sec} seconds` : `${sec / 60} minutes`);
  const NUM = /^(teams|slot|clock|bank|budget|bench|test|trades|rl|rlRound|hz|sd|day)$/;
  // the one-week twists: team roulette (drafts that go pick by pick), and for football a showdown (one game, a
  // captain and five flex spots, no bench) or a heist right after the draft (the one-week lineup, no bench)
  const ONE_WEEK_NFL = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX"];
  const rlFits = (c) => ["snake", "linear", "3rr"].includes(c.type);
  const sdOn = (c) => c.sport === "nfl" && !!c.sd;
  // one day of basketball: tonight's (or tomorrow's) games from the schedule, as in a one-day league
  const dayOn = (c) => c.sport === "nba" && !!c.day;
  let daySched = null, dayAsked = false;
  function dayOptions(now = Date.now()) {
    const SL = window.FK.slates;
    if (!daySched || !SL) return null;
    const out = [];
    for (const w of (daySched.weeks || []).filter(SL.isDay).slice(0, 2)) {
      const when = SL.dayName(w.day, now);
      for (const o of SL.list(w, now)) {
        if (o.kind === "custom") continue;
        if (o.kind === "one") { for (const g of SL.open(w, now)) out.push({ key: `${w.day}|one|${g.id}`, when, label: SL.label(g), sub: `${SL.tip(g.at)}, a captain and five flex`, w, kind: "one", ids: [g.id] }); continue; }
        out.push({ key: `${w.day}|${o.kind}|`, when, label: o.label, sub: o.sub, w, kind: o.kind, ids: null });
      }
    }
    return out;
  }
  // the slate the mock plays: { slate, lineup } or null while the schedule loads
  function daySlate(c) {
    const os = dayOptions();
    if (!os || !os.length) return null;
    const o = os.find((x) => x.key === c.dayK) || os[0];
    const sl = window.FK.slates.pick(o.w, o.kind, o.ids);
    if (!sl) return null;
    const lu = window.FK.slates.lineup(sl.games.length, c.teams, "nba");
    return { key: o.key, slate: Object.assign(sl, lu.mult ? { mult: lu.mult } : {}), lineup: lu };
  }
  const hzOn = (c) => c.sport === "nfl" && !!c.hz && !c.sd;
  function startPage() {
    document.body.classList.remove("fk-room");
    const sport = S[cfg.sport];
    const scoring = Object.values(sport.scorings)[0].label.replace(/ \(.*\)$/, "");
    app.innerHTML = `<div class="wrap page">
      <section class="start-hero"><p class="start-kicker">Draft Lab</p><h1 class="disp">Your next draft starts here.</h1><p>Real players. Bots that know their budgets. Jump into a familiar draft, or build something a little stranger.</p></section>
      ${mock ? `<section class="start-resume" aria-label="Your saved mock"><div><h2 class="disp">${mock.D.phase === "done" ? "Your draft is in the books." : "Your seat is still here."}</h2><p>${esc(S[mock.D.sport] ? S[mock.D.sport].name : "")} · ${esc(K.DRAFT_SHORT[mock.D.type] || mock.D.type)} · ${mock.D.teams.length} teams. ${mock.D.phase === "done" ? "See your roster and results." : "Continue your saved draft on this device."}</p></div><a class="btn go" href="#draft">${mock.D.phase === "done" ? "View your results" : "Continue your draft"}</a></section>` : ""}
      <div class="start-sports" role="group" aria-label="Choose a sport">${Object.values(S.ALL).map(s => `<button type="button" class="btn" data-entry-sport="${s.key}" aria-pressed="${s.key === cfg.sport}">${K.icon(s.key)} ${esc(s.name)}</button>`).join("")}</div>
      <section class="start-cards" aria-label="Choose how to play">
        <article class="start-card start-card-primary"><p class="start-kicker">01 / Take a seat</p><h2 class="disp">Quick mock</h2><p>A 10-team ${esc(sport.name.toLowerCase())} snake draft. ${esc(scoring)}, standard rosters, and 30 seconds a pick. We’ll find you a seat.</p><button type="button" class="btn go" data-quick>Start a quick mock →</button><p id="quick-error" role="alert"></p></article>
        <article class="start-card"><p class="start-kicker">02 / Make it yours</p><h2 class="disp">Customize a draft</h2><p>Choose your format, scoring, roster, and clock. Try an auction, mystery packages, white elephant, or your own take on a snake.</p><a class="btn" href="#setup">Customize your draft</a></article>
        <article class="start-card"><p class="start-kicker">03 / Keep the season going</p><h2 class="disp">Play a league</h2><p>Explore a ready-made demo, or create a shared league and invite your friends.</p><div class="start-actions"><a class="btn" href="leagues.html?s=${esc(cfg.sport)}">Start a league</a><a class="btn ghost" href="league.html?s=${esc(cfg.sport)}&f=h">Explore a demo</a></div></article>
      </section><p class="start-note">Mock drafts save on this device. You can leave and come back to the same seat.</p></div>`;
  }
  async function quickMock(button) {
    const error = $("#quick-error");
    button.disabled = true; button.textContent = "Finding your seat…";
    const next = Object.assign({}, DEFAULTS, { sport: cfg.sport });
    next.scoring = Object.keys(S[next.sport].scorings)[0];
    try {
      await newMock(next);
      location.hash = "#draft";
    } catch (err) {
      button.disabled = false; button.textContent = "Start a quick mock →";
      if (error) error.textContent = err.message;
    }
  }
  app.addEventListener("click", e => {
    const sport = e.target.closest("[data-entry-sport]");
    if (sport && sport.dataset.entrySport !== cfg.sport) {
      cfg = Object.assign({}, cfg, { sport: sport.dataset.entrySport, scoring: "", lineup: "", bench: null });
      rank.sport = cfg.sport; rank.scoring = ""; store.set("cfg", cfg); startPage();
      const selected = $(`[data-entry-sport="${cfg.sport}"]`); if (selected) selected.focus({ preventScroll: true });
    }
    const button = e.target.closest("[data-quick]");
    if (!button) return;
    if (mock) U.confirm("Replace your saved mock?", "Starting a quick mock replaces the draft saved on this device. You can keep it and return to your seat instead.", "Start quick mock", () => quickMock(button));
    else quickMock(button);
  });
  function setupView() {
    const sport = S[cfg.sport], c = cfg;
    const scoring = sport.scorings[c.scoring] ? c.scoring : Object.keys(sport.scorings)[0];
    const lu = (c.lineup || sport.lineup.join(" ")).split(/[\s,]+/).filter((x) => sport.slots[x] && x !== "BN");
    const bench = c.bench == null ? sport.bench : c.bench;
    const auction = c.type === "auction", mystery = c.type === "mystery", elephant = c.type === "elephant";
    const tradesOk = !auction && !elephant && c.type !== "pack";
    const clock = (auction ? BID_CLOCKS : CLOCKS).find(([v]) => v === c.clock) || (auction ? BID_CLOCKS[1] : CLOCKS[1]);
    const sc = (sport.scorings[scoring] || {}).label || "";
    const twHtml = twists(c);
    const dsl = dayOn(c) ? daySlate(c) : null;
    const tw = [dsl ? `${window.FK.slates.dayName(dsl.slate.day).toLowerCase()}: ${dsl.slate.label.toLowerCase()}` : dayOn(c) ? "one day" : "", sdOn(c) ? `showdown, ${c.sdA || "?"} at ${c.sdH || "?"}` : "", rlFits(c) && c.rl && !sdOn(c) ? "team roulette" : "", hzOn(c) ? "a heist" : ""].filter(Boolean);
    const line = `${sport.name}, ${c.teams} teams, ${sc.replace(/ \(.*\)$/, "")}, ${K.DRAFT_SHORT[c.type] || c.type}${auction ? `, $${sdOn(c) ? 50 : c.budget}` : ""}, ${clock[1].toLowerCase()}${c.slot && !mystery ? `, pick ${c.slot}` : ""}${tw.length ? `, ${tw.join(" and ")}` : ""}`;
    const formats = K.pickCards("type", Object.entries(F.FORMATS).map(([k, l]) => [k, K.DRAFT_SHORT[k] || l, K.DRAFTS[k] || ""]), c.type, "Draft format");
    const presets = Object.entries(sport.scorings).map(([k, x]) => [k, x.label.replace(/ \(.*\)$/, ""), K.SC_SUB[k] || ""]);
    const roster = `<div class="nr${open.roster ? " open" : ""}"><button type="button" class="nr-h" data-row="roster" aria-expanded="${!!open.roster}"><span class="nr-t"><b>Roster</b><small>Starting lineup and bench</small></span><span class="nr-v">${dayOn(c) ? (dsl ? `${dsl.lineup.lineup.length} starters, ${dsl.lineup.bench} bench (the slate sets it)` : "Set by the slate") : sdOn(c) ? "Captain and 5 flex, no bench (showdown)" : hzOn(c) ? "8 starters, no bench (heist)" : `${lu.length} starters, ${bench} bench`}</span><span class="chev" aria-hidden="true"></span></button>
      ${open.roster && (sdOn(c) || hzOn(c) || dayOn(c)) ? `<div class="nr-b"><p class="ps" style="margin:0">The ${dayOn(c) ? "night's slate" : sdOn(c) ? "showdown" : "heist"} sets the lineup. Turn it off to build your own.</p></div>` : open.roster ? `<div class="nr-b">${K.group("Starting lineup", lineupBuilder(sport, lu))}${K.group("Bench", K.fld("Bench spots", K.stepper("bench", [0, 1, 2, 3, 4, 5, 6, 7, 8, 10], bench, String, "Bench spots")))}</div>` : ""}</div>`;
    const tip = (t, b) => `<div class="mk-tip"><b>${esc(t)}</b><p>${b}</p></div>`;
    return `<div class="wrap page"><a class="start-back" href="#home">← Back to quick start</a><div class="su sp-${sport.key}">
      <div class="nl-band">${K.FIELD[sport.key]}<div class="nl-bi">
        <div class="nl-sports" role="radiogroup" aria-label="Sport">${Object.values(S.ALL).map((x) => `<label class="nl-sp"><input type="radio" name="sport" value="${x.key}"${x.key === c.sport ? " checked" : ""}>${K.icon(x.key)}<span>${esc(x.name)}</span></label>`).join("")}</div>
        <h1 class="disp">Mock a ${esc(sport.name.toLowerCase())} draft</h1>
        <p>Draft against bots that know positions, budgets and the clock, with real player data. It saves on this device, so you can leave and come back.</p>
      </div></div>
      ${mock ? `<a class="mk-resume" href="#draft"><span><b>Your ${esc(S[mock.D.sport] ? S[mock.D.sport].name.toLowerCase() : "")} mock is ${mock.D.phase === "done" ? "done" : "still going"}</b><small>${esc(K.DRAFT_SHORT[mock.D.type] || "")}, ${mock.D.teams.length} teams${mock.D.phase === "done" ? ". See how it turned out." : ". Pick up where you left off."}</small></span><span class="btn sm">Back to your mock</span></a>` : ""}
      <form class="nl-body" id="setup" novalidate>
        <section class="nl-sec"><h2 class="nl-h">Format</h2>${formats}</section>
        <section class="nl-sec nl-ess">
          <div class="g2">${K.fld("Teams", K.stepper("teams", [4, 6, 8, 10, 12, 14, 16], c.teams, (x) => `${x} teams`, "Teams"))}
            ${mystery ? K.fld("Packages open", K.seg("reveal", Object.entries(F.REVEALS).map(([k, l]) => [k, l.replace(", the rest as they come up", ", then as picks come up")]), c.reveal, "Packages open", { wrap: true })) : K.fld(auction ? "Your nomination turn" : "Your pick", K.stepper("slot", Array.from({ length: c.teams + 1 }, (_, i) => i), Math.min(c.slot, c.teams), (x) => (x ? U.ord(x) : "Random"), auction ? "Your nomination turn" : "Your pick"))}</div>
          ${K.fld("Scoring", K.cards("scoring", presets, scoring, "Scoring", presets.length > 3 ? 3 : presets.length))}
          <div class="g2">${K.fld(auction ? "Bid clock" : "Pick clock", K.seg("clock", auction ? BID_CLOCKS : PICK_CLOCKS.concat([[c.clock < 0 ? c.clock : -200, "Time bank"]]), clock[0], auction ? "Bid clock" : "Pick clock", { wrap: true }),
              auction ? "Every bid resets the clock." : c.clock < 0 ? `One clock for your whole draft: ${fmtBank(-c.clock)} for all your picks, about ${Math.round(-c.clock / Math.max(1, (dsl ? dsl.lineup.lineup.length + dsl.lineup.bench : sdOn(c) ? 6 : hzOn(c) ? 8 : lu.length + bench)))} seconds each. Run it out and every pick gets 10 seconds. The bots finish with about half of theirs left. What's left becomes FAAB for the season.` : c.clock ? "When your clock runs out, your first queued player who fits is taken, then the best fit." : "Take as long as you like.")}
            ${auction ? K.fld("Budget per team", K.seg("budget", [100, 200, 260, 300, 1000].map((x) => [x, `$${x}`]), c.budget, "Budget per team", { wrap: true })) : c.clock < 0 ? K.fld("Time bank", K.seg("bank", BANKS, c.clock, "Time bank", { wrap: true }), "For your whole draft.") : "<div></div>"}</div>
          <div class="g2"><div class="fl"><div class="fl-l"><label for="s-name">Your team name</label></div><input type="text" id="s-name" maxlength="28" value="${esc(c.name)}" placeholder="Your team"></div><div></div></div>
          ${tradesOk || mystery ? `<div class="nl-bb">${K.toggle("trades", "Trades during the draft", "Trade picks and drafted players with any team. Bots answer right away.", c.trades)}${mystery ? K.toggle("test", "Even out the packages", "Deal five times and keep the most even draft", c.test) : ""}</div>` : ""}
          ${elephant ? `<p class="fl-h">Each team gets 3 steals, a player is frozen after 2, and steals end with 2 rounds to go. The team you rob picks again right away.</p>` : ""}
        </section>
        ${twHtml}
        <section class="nl-sec"><h2 class="nl-h">Fine-tune</h2><div class="nr-l">${roster}</div></section>
        <section class="nl-sec mk-how">${tip("How the bots draft", `They value players over the replacement at each position and fill starters before the bench${c.sport === "nfl" ? ", saving kickers and defenses for last" : c.sport === "mlb" ? ", balancing hitters and pitchers as they go" : ""}. In an auction they bid by proxy up to a price set by their budget and needs.`)}
          ${tip("Your seat", "Queue players before you start. If your clock runs out, the first queued player who fits is your pick.")}
          ${tip("After the draft", `Play a season with your team in a demo league: <a href="league.html?s=${esc(c.sport)}&f=h">head to head</a> or <a href="league.html?s=${esc(c.sport)}&f=g">guillotine</a>.`)}</section>
        <div class="nl-bar"><div class="nl-sum">${K.icon(sport.key, "nl-sum-ic")}<span><b>${esc(c.name || "Your team")}</b><small>${esc(line)}</small></span></div>
          <p id="s-why" role="alert"></p><span class="grow"></span>${mock ? `<a class="btn ghost" href="#draft">Back to your mock</a>` : ""}<button type="submit" class="btn go">Take your seat</button></div>
      </form></div></div>`;
  }
  let sched = null, schedAsked = false;
  function twists(c) {
    const nfl = c.sport === "nfl", teams = (cache.nfl ? [...new Set(cache.nfl.players.map((p) => p.t).filter((t) => t && t !== "FA"))].sort() : []);
    if (nfl && c.sd && !teams.length) loadSport("nfl").then(() => { if ($("#app #setup")) setupPage(); });
    if (teams.length && (!teams.includes(c.sdA) || !teams.includes(c.sdH) || c.sdA === c.sdH)) { c.sdA = teams.includes("KC") ? "KC" : teams[0]; c.sdH = teams.includes("BUF") ? "BUF" : teams[1]; }
    const sel = (f, cur) => `<select data-f="${f}" aria-label="${f === "sdA" ? "Away team" : "Home team"}">${teams.map((t) => `<option${t === cur ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
    // a showdown picks a real game from this week's or next week's schedule; any two teams is there for practice
    if (nfl && c.sd && !schedAsked && window.FK.cloud) { schedAsked = true; window.FK.cloud.slates().then((d) => { sched = d || { weeks: [] }; if ($("#app #setup")) setupPage(); }); }
    const real = sched && window.FK.slates ? sched.weeks.flatMap((w) => window.FK.slates.open(w).map((g) => Object.assign({ wk: w.week }, g))) : null;
    const gamePick = !teams.length ? "" : real && real.length ? `<div class="slg-l">${real.slice(0, 18).map((g) => { const on = c.sdA === g.away && c.sdH === g.home; return `<button type="button" class="slg${on ? " on" : ""}" data-sdg="${esc(g.away)}|${esc(g.home)}" aria-pressed="${on}"><b>${esc(g.away)} @ ${esc(g.home)}</b><small>Week ${g.wk}, ${esc(window.FK.slates.kick(g.at))}</small></button>`; }).join("")}</div>
      <details class="sd-any"><summary>Or any two teams</summary><div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">${sel("sdA", c.sdA)}<span class="ps">at</span>${sel("sdH", c.sdH)}</div></details>`
      : `${real ? "" : `<p class="ps" style="margin:0 0 6px">Loading this week's games…</p>`}<div class="row" style="gap:8px;flex-wrap:wrap">${sel("sdA", c.sdA)}<span class="ps">at</span>${sel("sdH", c.sdH)}</div>`;
    const rows = [];
    if (c.sport === "nba") {
      if (c.day && !dayAsked && window.FK.cloud) { dayAsked = true; window.FK.cloud.slates("nba").then((d) => { daySched = d || { weeks: [] }; if ($("#app #setup")) setupPage(); }); }
      const os = c.day ? dayOptions() : null, cur = c.day ? daySlate(c) : null;
      let when = "";
      const pickHtml = !c.day ? "" : daySched && daySched.error ? `<p class="ps" style="margin:0">Couldn't reach tonight's schedule. <button type="button" class="btn sm" data-dayretry>Try again</button></p>` : !os ? `<p class="ps" style="margin:0">Loading tonight's games…</p>` : !os.length ? `<p class="ps" style="margin:0">No games left tonight or tomorrow.</p>`
        : `<div class="slg-l">${os.map((o) => { const on = cur && cur.key === o.key, head = o.when !== when ? (when = o.when) : ""; return `${head ? `<b class="slg-day">${esc(head)}</b>` : ""}<button type="button" class="slg${on ? " on" : ""}" data-dayk="${esc(o.key)}" aria-pressed="${!!on}"><b>${esc(o.label)}</b><small>${esc(o.sub)}</small></button>`; }).join("")}</div>${cur ? `<p class="fl-h">${esc(cur.lineup.note)}.</p>` : ""}`;
      rows.push(K.toggle("day", "One day: tonight's games", "Draft only the players in a night's real games, with a one-day lineup, like a one-day league.", c.day, pickHtml));
    }
    if (rlFits(c) && !sdOn(c)) rows.push(K.toggle("rl", "Team roulette", "Each pick has to come from the pro team the wheel lands on. One re-spin each.", c.rl, K.fld("The wheel spins", K.seg("rlRound", [[0, "Every pick"], [1, "Every round"]], c.rlRound ? 1 : 0, "The wheel spins"))));
    if (nfl) rows.push(K.toggle("sd", "Showdown: one game", "Just the players in one game. A captain at 1.5x and five flex spots, no bench.", c.sd, gamePick));
    if (nfl && !sdOn(c)) rows.push(K.toggle("hz", "Heist after the draft", "Shield three of your starters, steal one of your opponent's and jinx another. The one-week lineup, no bench.", c.hz));
    return rows.length ? `<section class="nl-sec"><h2 class="nl-h">Twists</h2><div class="nl-bb">${rows.join("")}</div></section>` : "";
  }
  function setupGrab() {
    const root = $("#app .su"); if (!root) return;
    const sp = root.querySelector("input[name=sport]:checked"); if (sp) cfg.sport = sp.value;
    root.querySelectorAll("[data-f]").forEach((el) => {
      if (el.type === "radio" && !el.checked) return;
      const k = el.dataset.f, v = el.type === "checkbox" ? (el.checked ? 1 : 0) : el.value;
      cfg[k] = NUM.test(k) ? Number(v) : v;
    });
    const nm = $("#s-name"); if (nm) cfg.name = nm.value;
    // a time bank: the bank's own control picks how big
    const bk = root.querySelector("input[data-f=bank]:checked");
    if (cfg.clock < 0 && bk) cfg.clock = Number(bk.value);
  }
  function setupPage(focusSel) {
    document.body.classList.remove("fk-room");
    if (cfg.slot > cfg.teams) cfg.slot = 0;
    app.innerHTML = setupView();
    if (focusSel) { const el = $(focusSel); if (el && !el.disabled) el.focus({ preventScroll: true }); }
  }
  let setupWired = false;
  function wireSetup() {
    if (setupWired) return; setupWired = true;
    const live = () => !!$("#app #setup");
    const save = (focusSel) => { store.set("cfg", cfg); setupPage(focusSel); };
    app.addEventListener("click", (e) => {
      if (!live()) return;
      const sport = S[cfg.sport];
      const ty = e.target.closest("[data-type]");
      if (ty) { setupGrab(); cfg.type = ty.dataset.type; if (cfg.type === "auction") { if (![10, 15, 20, 30].includes(cfg.clock)) cfg.clock = 15; } else if (!CLOCKS.some(([v]) => v === cfg.clock)) cfg.clock = 30; save(`[data-type="${cfg.type}"]`); return; }
      const st = e.target.closest("[data-stp]");
      if (st) {
        setupGrab();
        const inp = st.parentNode.querySelector("input[type=hidden]"), vals = inp.dataset.vals.split(",").map(Number);
        cfg[st.dataset.stp] = vals[Math.min(vals.length - 1, Math.max(0, vals.indexOf(Number(inp.value)) + Number(st.dataset.d)))];
        save(`#${st.id}`); return;
      }
      const row = e.target.closest("[data-row]");
      if (row) { setupGrab(); open[row.dataset.row] = !open[row.dataset.row]; save(`[data-row="${row.dataset.row}"]`); return; }
      if (e.target.closest("[data-dayretry]")) { setupGrab(); daySched = null; dayAsked = false; save(); return; }
      const dk = e.target.closest("[data-dayk]");
      if (dk) { setupGrab(); cfg.dayK = dk.dataset.dayk; save(`[data-dayk="${dk.dataset.dayk}"]`); return; }
      const sdg = e.target.closest("[data-sdg]");
      if (sdg) { setupGrab(); [cfg.sdA, cfg.sdH] = sdg.dataset.sdg.split("|"); save(`[data-sdg="${sdg.dataset.sdg}"]`); return; }
      const pr = e.target.closest("[data-preset]"), lb = e.target.closest("[data-lb]");
      if (!pr && !lb) return;
      setupGrab();
      const cur = (cfg.lineup || sport.lineup.join(" ")).split(/[\s,]+/).filter((x) => sport.slots[x] && x !== "BN");
      let next = cur;
      if (pr) next = pr.dataset.preset.split(" ");
      else if (+lb.dataset.d > 0) next = orderLineup(sport, cur.concat(lb.dataset.lb));
      else { const i = cur.lastIndexOf(lb.dataset.lb); if (i >= 0) next = cur.filter((_, j) => j !== i); }
      if (!next.length) { U.toast("A lineup needs at least one starter", true); return; }
      cfg.lineup = next.join(" ");
      save(lb ? `[data-lb="${lb.dataset.lb}"][data-d="${lb.dataset.d}"]` : `[data-preset="${pr.dataset.preset}"]`);
    });
    app.addEventListener("change", (e) => {
      if (!live() || e.target.id === "s-name") return;
      const was = cfg.sport;
      setupGrab();
      if (cfg.sport !== was) Object.assign(cfg, { scoring: "", lineup: "", bench: null });
      save(e.target.id ? `#${e.target.id}` : null);
    });
    app.addEventListener("input", (e) => { if (live() && e.target.id === "s-name") { const b = $("#app .nl-sum b"); if (b) b.textContent = e.target.value || "Your team"; } });
    app.addEventListener("submit", async (e) => {
      if (e.target.id !== "setup") return;
      e.preventDefault();
      setupGrab();
      const s = S[cfg.sport];
      cfg.scoring = s.scorings[cfg.scoring] ? cfg.scoring : Object.keys(s.scorings)[0];
      if (cfg.bench == null) cfg.bench = s.bench;
      cfg.lineup = (cfg.lineup || s.lineup.join(" ")).trim();
      cfg.name = (cfg.name || "").trim();
      store.set("cfg", cfg);
      const go = $("#app .nl-bar button.go"), why = $("#s-why");
      go.disabled = true; go.textContent = cfg.type === "mystery" && cfg.test ? "Dealing and testing packages..." : "Setting up...";
      await new Promise((r) => setTimeout(r, 30));
      try { await newMock(cfg); }
      catch (err) { go.disabled = false; go.textContent = "Take your seat"; why.textContent = err.message; return; }
      location.hash = "#draft"; route();
    });
  }
  wireSetup();

  async function newMock(c) {
    const P = await pool(c);
    const n = c.teams;
    // can the pool fill this league? every one-position slot needs that many players at the position, and every
    // roster spot needs a player
    const sp = P.sport, need = {};
    for (const sl of P.lineup) { const v = sp.slots[sl]; if (v !== "*" && v.length === 1) need[v[0]] = (need[v[0]] || 0) + n; }
    for (const [pos, k] of Object.entries(need)) {
      const have = P.players.filter((p) => S.positions(p).includes(pos)).length;
      if (have < k) throw new Error(`There aren't enough ${pos} for this lineup: ${n} teams need ${k}, and the pool has ${have}. Take out some ${pos} spots or use fewer teams.`);
    }
    const spots = n * (P.lineup.length + P.bench);
    if (spots > P.players.length && P.slate) throw new Error(`${P.slate.label} has ${P.players.length} players, enough for ${Math.floor(P.players.length / (P.lineup.length + P.bench))} teams. Pick fewer teams or a bigger slate.`);
    if (spots > P.players.length) throw new Error(`${n} teams with ${P.lineup.length + P.bench} roster spots need ${spots} players, and the pool has ${P.players.length}.`);
    const seed = Math.floor(Math.random() * 2 ** 31);
    const r = F.rng(seed);
    const others = [...Array(n).keys()].filter((x) => x !== 0);
    for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
    const slot = c.slot ? c.slot - 1 : Math.floor(r() * n);
    const order = others.slice(0, slot).concat(0, others.slice(slot));
    const total = n * (P.lineup.length + P.bench);
    const D = F.create({ sport: P.sport, type: c.type, teams: n, seed, now: Date.now(), lineup: P.lineup, bench: P.bench, scoring: P.scoring,
      botDelay: U.botSpeed.delay(), clock: c.type === "auction" || c.clock < 0 ? 0 : c.clock, bank: c.clock < 0 && c.type !== "auction" ? { perRound: -c.clock / Math.max(1, P.lineup.length + P.bench), floor: 10 } : null, bidClock: c.clock || 15, nomClock: 30, budget: sdOn(c) ? 50 : c.budget, order, name: P.slate ? `${window.FK.slates.dayName(P.slate.day)}: ${P.slate.label}` : `${P.sport.name} mock`,
      trades: c.trades !== 0, curve: c.type === "mystery" ? F.pickCurve(P.players, total) : null, reveal: c.reveal });
    if (c.type === "mystery" && c.test) F.fairDeal(D, P.players, P.sport, null, { tries: 5 });
    if (c.type === "pack") F.dealPacks(D, P.players, P.sport);
    if (rlFits(c) && c.rl && !sdOn(c)) D.roulette = { teams: [...new Set(P.players.map((p) => p.t).filter((t) => t && t !== "FA"))].sort(), each: c.rlRound ? "round" : "pick", respins: 1, spins: {}, used: {} };
    if (sdOn(c)) D.season = { format: "h2h", weeks: 1, oneWeek: true, showdown: { teams: [c.sdA, c.sdH], label: `${c.sdA} @ ${c.sdH}` } };
    if (P.slate) D.season = { format: "h2h", weeks: 1, oneWeek: true, slate: P.slate };
    if (hzOn(c)) D.season = { format: "h2h", weeks: 1, oneWeek: true, heist: { shields: 3, steals: 1, jinxes: 1, clock: 60 } };
    D.teams.forEach((t, i) => (t.color = (i * 5) % 12));      // each team its own color, as in a league
    D.teams[0].owner = "You";
    if (c.name) { D.teams[0].name = c.name; D.teams[0].abbr = c.name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase() || "YOU"; }
    else { D.teams[0].name = "Your team"; D.teams[0].abbr = "YOU"; }
    mock = { cfg: Object.assign({}, c), D };
    store.set("mock", mock);
  }

  /* ---------- the room ---------- */
  async function draftPage() {
    if (!mock) return setupPage();
    document.body.classList.add("fk-room");
    const P = await pool(mock.cfg);
    if (roomCtl) roomCtl.stop();
    app.innerHTML = `<div id="room"></div>`;
    roomCtl = U.room({ el: $("#room"), sport: P.sport, players: P.players, draft: () => mock.D, save: () => store.set("mock", mock), me: () => 0, commish: true, solo: true,
      // with the room open in two tabs, only the one you're looking at runs the clock and the bots
      get drive() { return !document.hidden; },
      brand: { name: "Draft Lab", mark: `<img src="mark.svg" alt="">` }, exit: { href: "#home", label: "Exit" },
      extra: () => `<a class="btn sm go" href="league.html?s=${mock.D.sport}&f=h&mock=1">Play a season with it</a><button class="btn sm" data-new>New mock</button>` });
    $("#room").addEventListener("click", (e) => { if (e.target.closest("[data-new]")) { mock = null; store.set("mock", null); route(); } });
  }

  /* ---------- rankings ---------- */
  async function rankingsPage() {
    document.body.classList.remove("fk-room");
    const c = Object.assign({}, cfg, { dynasty: rank.dyn, sport: rank.sport, scoring: rank.scoring || (rank.sport === cfg.sport ? cfg.scoring : ""), lineup: rank.sport === cfg.sport ? cfg.lineup : "", bench: rank.sport === cfg.sport ? cfg.bench : null });
    const P = await pool(c);
    const sp = P.sport;
    // dynasty: the outside consensus rank and how age moves each player's value
    const extra = rank.dyn ? [
      { k: "cons", label: "Cons", cls: "r num", title: "Outside dynasty consensus rank (FantasyPros, plus FantasyCalc for football)", sort: (p) => p.cons || 1e4, asc: true, html: (p) => (p.cons ? String(p.cons) : `<span class="ps">-</span>`) },
      { k: "dyn", label: "Outlook", cls: "r num", hide: "s", title: "How age moves his value over the next five seasons: above 1 he's still climbing, below 1 he's fading", sort: (p) => p.dyn || 1, html: (p) => (p.dyn && p.dyn !== 1 ? `<span class="${p.dyn > 1 ? "win" : "loss"}">&times;${p.dyn.toFixed(2)}</span>` : `<span class="ps">&times;1</span>`) },
    ] : [];
    const cols = U.poolColumns(sp, { group: U.groupOf(sp, rank.f), scoring: P.scoring, extra });
    const teams = [...new Set(P.players.map((p) => p.t))].sort();
    const rows = U.sortRows(P.players.filter((p) => U.passes(sp, p, rank.f)), cols, rank.sort);
    const mine = rank.mode === "board", B = U.board.of(sp.key, P.players);
    // signed in, the board comes from your account: redraw once if another device changed it
    U.board.sync(sp.key).then((ch) => { if (ch && $("#app") && rank.sport === sp.key) rankingsPage(); });
    const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`;
    const focus = document.activeElement && document.activeElement.id;
    app.innerHTML = `<div class="wrap page">
      <div class="head"><h1 class="disp">${esc(sp.name)} rankings</h1><span class="ps">${esc(sp.data.source)}, ${esc(sp.data.season)}. ${c.teams} teams, ${esc(sp.scorings[P.scoring].label)}${P.lineup.length ? `, starting ${(() => { const n = {}; P.lineup.forEach((x) => (n[x] = (n[x] || 0) + 1)); return Object.entries(n).map(([x, k]) => (k > 1 ? `${k} ${x}` : x)).join(", "); })()}` : ""}.</span></div>
      <div class="tools"><label class="sr" for="r-sport">Sport</label><select id="r-sport">${Object.values(S.ALL).map((s) => opt(s.key, s.name, rank.sport)).join("")}</select>
        <label class="sr" for="r-scoring">Scoring</label><select id="r-scoring">${Object.entries(sp.scorings).map(([k, s]) => opt(k, s.label.replace(/ \(.*\)$/, ""), P.scoring)).join("")}</select>
        ${U.viewSelect(sp, "r-statv")}
        <label class="sr" for="r-dyn">League type</label><select id="r-dyn">${opt("", "Redraft", rank.dyn ? "1" : "")}${opt("1", "Dynasty", rank.dyn ? "1" : "")}</select>
        <div class="seg" role="group" aria-label="Rankings"><button type="button" data-rmode="default" aria-pressed="${rank.mode === "default"}">Rankings</button><button type="button" data-rmode="board" aria-pressed="${mine}">My board</button><button type="button" data-rmode="prospects" aria-pressed="${rank.mode === "prospects"}">Prospects</button></div></div>
      <div class="tools">${U.search(rank.f)}<label class="sr" for="fk-team">${esc(sp.league)} team</label><select id="fk-team" class="${rank.f.team ? "set" : ""}"><option value="">All ${esc(sp.league)} teams</option>${teams.map((t) => `<option${t === rank.f.team ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>${U.posFilter(sp, rank.f.pos)}
      ${rank.mode === "prospects" ? (sp.key === "mlb" ? await mlbProspectsView(sp, P) : await prospectsView(sp)) : mine ? myBoard(sp, P, B) : U.table({ cols, rows, sort: rank.sort, dense: true, limit: 300, rowAttr: (p) => `data-player="${esc(p.id)}"`, empty: "No one matches." })}
      <p class="ps">${rank.dyn ? "Dynasty: each player's value over the next five seasons, from an age curve for his position, blended with outside dynasty consensus where it ranks him. " : ""}${await freshness(sp)}${sp.data.lines && sp.data.lines.pbat ? `Values come from ${esc(sp.data.lines.pbat.label.replace(/, batting$/, ""))} projections from FanGraphs; the stat columns show last season. ` : ""}${sp.market ? `ESPN and ESPN $ are ESPN's rank and the average price in real ESPN auctions, for comparison. ` : ""}Ranks are value over the replacement player at each position, for the league size and lineup above. Auction values split ${c.teams} budgets of $${c.budget}.</p></div>`;
    if (rank.focus) { const f = $(rank.focus, app); rank.focus = null; if (f) { f.focus(); f.scrollIntoView({ block: "nearest" }); } }
    else if (focus) { const f = document.getElementById(focus); if (f) { f.focus(); if (f.type === "search") f.setSelectionRange(f.value.length, f.value.length); } }
    // your board: move a player past the next one showing, to a spot, or by dragging; tier breaks
    const visible = () => B.ids.filter((id) => { const p = P.players.find((x) => x.id === id); return p && U.passes(sp, p, rank.f); });
    const keep = () => { U.board.save(sp.key, B); rankingsPage(); };
    const moveTo = (id, at) => { const i = B.ids.indexOf(id); if (i < 0) return; B.ids.splice(i, 1); B.ids.splice(Math.max(0, Math.min(B.ids.length, at)), 0, id); keep(); };
    app.ondragstart = (e) => { const li = e.target.closest && e.target.closest("[data-bid]"); if (li) { e.dataTransfer.setData("text/plain", li.dataset.bid); e.dataTransfer.effectAllowed = "move"; li.classList.add("drag"); } };
    app.ondragover = (e) => { const li = e.target.closest && e.target.closest("[data-bid]"); if (li) { e.preventDefault(); $$(".mb.over", app).forEach((x) => x.classList.remove("over")); li.classList.add("over"); } };
    app.ondrop = (e) => { const li = e.target.closest && e.target.closest("[data-bid]"), id = e.dataTransfer.getData("text/plain"); if (!li || !id || li.dataset.bid === id) return; e.preventDefault(); moveTo(id, B.ids.indexOf(li.dataset.bid)); };
    app.ondragend = () => $$(".mb.drag,.mb.over", app).forEach((x) => x.classList.remove("drag", "over"));
    app.onclick = (e) => {
      const rm = e.target.closest("[data-rmode]");
      if (rm) { rank.mode = rm.dataset.rmode; rankingsPage(); return; }
      const bu = e.target.closest("[data-bup],[data-bdown]");
      if (bu) {
        const up = !!bu.dataset.bup, id = bu.dataset.bup || bu.dataset.bdown, vis = visible(), k = vis.indexOf(id), other = vis[k + (up ? -1 : 1)];
        if (!other) return;
        rank.focus = `[data-${up ? "bup" : "bdown"}="${CSS.escape(id)}"]`;
        moveTo(id, B.ids.indexOf(other));                  // up: in front of him; down: right after him
        return;
      }
      const bt = e.target.closest("[data-btier]");
      if (bt) { const id = bt.dataset.btier; B.tiers = B.tiers.includes(id) ? B.tiers.filter((x) => x !== id) : B.tiers.concat(id); keep(); return; }
      const bm = e.target.closest("[data-bmove]");
      if (bm) {
        const id = bm.dataset.bmove, p = P.players.find((x) => x.id === id);
        U.dialog(`<h3>Move ${esc(p.n)}</h3><form class="stack"><div class="field"><label for="mb-to">To spot</label><input type="number" id="mb-to" name="to" min="1" max="${B.ids.length}" value="${B.ids.indexOf(id) + 1}"></div><div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">Move</button></div></form>`,
          (fd) => { const to = Math.round(+fd.get("to")); if (!(to >= 1)) return false; moveTo(id, to - 1); });
        return;
      }
      if (e.target.closest("[data-breset]")) { U.confirm("Reset your board?", "Your order and tiers go back to the default rankings.", "Reset", () => { U.board.reset(sp.key); rankingsPage(); }); return; }
      const fp = e.target.closest("[data-fpos]");
      if (fp) { rank.f.pos = fp.dataset.fpos; rankingsPage(); return; }
      const th = e.target.closest("th[data-sort]");
      if (th) { rank.sort = U.nextSort(rank.sort, th.dataset.sort, cols); rankingsPage(); return; }
      const tr = e.target.closest("[data-player]");
      if (tr) { const p = P.players.find((x) => x.id === tr.dataset.player); U.dialog(U.playerCard(sp, p, { scoring: P.scoring }), null, { wide: true }); }
    };
    app.oninput = (e) => { if (e.target.id === "fk-q") { rank.f.q = e.target.value; rankingsPage(); } };
    app.onchange = (e) => {
      const id = e.target.id;
      if (id === "r-sport") { rank.sport = e.target.value; rank.scoring = ""; rank.f = { q: "", pos: "", team: "" }; rank.sort = { k: "rank", dir: 1 }; }
      else if (id === "r-scoring") rank.scoring = e.target.value;
      else if (id === "r-dyn") rank.dyn = !!e.target.value;
      else if (id === "r-statv") U.setView(sp, e.target.value);
      else if (id === "fk-pos") rank.f.pos = e.target.value;
      else if (id === "fk-team") rank.f.team = e.target.value;
      else return;
      rankingsPage();
    };
  }

  // Next year's class from the Big Board (../draft/), as a fantasy league would draft it: football's skill
  // positions, all of basketball. A dynasty league prices its rookie picks from the same list.
  const boards = {};
  async function prospectsView(sp) {
    if (!(sp.key in boards)) boards[sp.key] = await fetch(`../draft/${sp.key}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const B = boards[sp.key], all = S.prospectClass(B, sp.key);
    if (!all.length) return `<p class="empty">The Big Board isn't loading right now.</p>`;
    const q = (rank.f.q || "").toLowerCase(), pos = rank.f.pos;
    const rows = all.filter((p) => (!q || p.n.toLowerCase().includes(q) || String(p.school).toLowerCase().includes(q)) && (!pos || String(p.pos).split("/").includes(pos)));
    const move = (p) => { const h = p.hist || []; if (h.length < 2) return ""; const d = Math.round(h[0] - h[h.length - 1]); return d ? `<span class="${d > 0 ? "win" : "loss"}">${d > 0 ? "&#9650;" : "&#9660;"}${Math.abs(d)}</span>` : `<span class="ps">0</span>`; };
    const stat = (p) => (p.stats || []).slice(0, 3).map((x) => `${esc(x[1])} ${esc(x[0])}`).join(", ");
    const hasYr = all.some((p) => p.yr || p.age), hasMove = all.some((p) => (p.hist || []).length > 1);
    const head = `<p class="ps" style="margin:0 0 8px">The ${B.year} class by consensus of ${B.sources.length} outlets on the <a href="../draft/#${sp.key}">Big Board</a>, updated ${esc(String(B.asof || ""))}. ${sp.key === "nfl" ? "Skill positions only. " : ""}Class is his place among fantasy prospects by consensus. Dynasty leagues price next season's rookie picks from the class, each prospect against the league's own players at his position.</p>`;
    return head + `<div class="table-wrap"><table class="t dense"><thead><tr><th class="r">Class</th><th class="r hide-s">Board</th><th>Prospect</th>${hasYr ? `<th class="hide-s">Year, age</th>` : ""}<th class="r" title="His best and worst rank across outlets">Range</th>${hasMove ? `<th class="r hide-s" title="Consensus rank gained or lost since the first reading">Move</th>` : ""}<th class="hide-s">${sp.key === "nba" ? "This season" : "2026 season"}</th></tr></thead><tbody>
      ${rows.slice(0, 200).map((p) => `<tr><td class="r num"><b>${p.fr}</b></td><td class="r num hide-s ps">${p.rank}</td><td class="nm"><b>${esc(p.n)}</b><div class="ps">${esc(p.pos)}, ${esc(p.school || "")}${p.ht ? `, ${esc(p.ht)}` : ""}</div></td>${hasYr ? `<td class="hide-s ps">${esc(p.yr || "")}${p.age ? `${p.yr ? ", " : ""}${p.age.toFixed(1)}` : ""}</td>` : ""}<td class="r num ps">${p.hi === p.lo ? p.hi : `${p.hi}-${p.lo}`}</td>${hasMove ? `<td class="r num hide-s">${move(p)}</td>` : ""}<td class="hide-s ps">${stat(p)}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No one matches.</td></tr>`}
      </tbody></table></div>`;
  }

  // Baseball's prospects are minor leaguers, not a draft class: FanGraphs' The Board, each with his Future Value,
  // ETA, level and this season's minor league line. One who's reached the majors links to his pool card, with his
  // big league stats and projection.
  let mlbPros;
  const PRO_POS = { RHP: "SP", LHP: "SP", SP: "SP", P: "SP", SIRP: "RP", MIRP: "RP", RP: "RP", CF: "OF", LF: "OF", RF: "OF", OF: "OF", DH: "UT" };
  // FanGraphs' team codes where they differ from MLB's
  const FG_TEAM = { WSN: "WSH", CHW: "CWS", KCR: "KC", SDP: "SD", SFG: "SF", TBR: "TB", AZ: "ARI" };
  const proTeamOf = (t) => FG_TEAM[t] || t;
  const proPos = (p) => String(p.pos || "").split(/[\/,]/).map((x) => PRO_POS[x.trim().toUpperCase()] || x.trim().toUpperCase());
  async function mlbProspectsView(sp, P) {
    if (mlbPros === undefined) mlbPros = await fetch("data/prospects-mlb.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const B = mlbPros;
    if (!B || !B.players || !B.players.length) return `<p class="empty">The prospect list isn't loading right now.</p>`;
    const byId = Object.fromEntries(P.players.map((p) => [String(p.id), p]));
    // no MLBAM id (no minor league games this year): match him in the pool by name
    const nm = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
    const byName = {}; for (const p of P.players) (byName[nm(p.n)] = byName[nm(p.n)] || []).push(p);
    const poolOf = (p) => (p.mlbam && byId[p.mlbam]) || ((byName[nm(p.n)] || []).length === 1 ? byName[nm(p.n)][0] : null);
    const q = (rank.f.q || "").toLowerCase(), pos = rank.f.pos, team = rank.f.team;
    const fits = (p) => { const ps = proPos(p); if (!pos) return true; if (pos === "g:pit") return p.pit; if (pos === "g:bat") return !p.pit; if (pos === "UT") return !p.pit; return ps.includes(pos); };
    const rows = B.players.filter((p) => (!q || p.n.toLowerCase().includes(q) || proTeamOf(p.t).toLowerCase() === q) && (!team || proTeamOf(p.t) === team) && fits(p));
    const n3 = (x) => (x == null ? "" : Number(x).toFixed(3).replace(/^0/, ""));
    const lineOf = (p) => {
      const l = p.line; if (!l) return `<span class="ps">No minor league games in ${esc(String(B.season))}</span>`;
      return p.pit ? `<span class="ps">${esc(l.lv)}</span> ${l.ip} IP, ${l.era.toFixed(2)} ERA, ${l.whip.toFixed(2)} WHIP, ${l.k}% K, ${l.bb}% BB`
        : `<span class="ps">${esc(l.lv)}</span> ${l.PA} PA, ${n3(l.avg)}/${n3(l.obp)}/${n3(l.slg)}, ${l.HR} HR, ${l.SB} SB, ${l.wrc} wRC+`;
    };
    const head = `<p class="ps" style="margin:0 0 8px">Minor leaguers, not a draft class: ${B.listSeason} prospects from <a href="https://www.fangraphs.com/prospects/the-board" rel="noopener">FanGraphs' The Board</a>, the ranked list plus everyone graded 45 FV or better, updated ${esc(String(B.updated).slice(0, 10))}. FV is his Future Value on the 20 to 80 scouting scale. The line is his ${B.season} minor league season, every level together. Tap a prospect who's reached the majors for his big league stats and projection.</p>`;
    return head + `<div class="table-wrap"><table class="t dense"><thead><tr><th class="r">Rank</th><th>Prospect</th><th class="r hide-s" title="Future Value, 20 to 80">FV</th><th class="r hide-s">ETA</th><th class="hide-s">Level</th><th class="r hide-s">Age</th><th class="hide-s">${B.season} minors</th></tr></thead><tbody>
      ${rows.slice(0, 400).map((p) => { const pl = poolOf(p);
        return `<tr${pl ? ` data-player="${esc(pl.id)}" style="cursor:pointer"` : ""}><td class="r num"><b>${p.rank || ""}</b>${p.rank ? "" : `<span class="ps" title="His place in his organization">${p.org ? `org ${p.org}` : ""}</span>`}</td>
          <td class="nm"><b>${esc(p.n)}</b><div class="ps">${esc(p.pos)}, ${U.proTeam(sp, proTeamOf(p.t))}${p.risk ? `, ${esc(p.risk.toLowerCase())} risk` : ""}${pl ? `, <span class="tag">In the pool, #${pl.rank}</span>` : ""}</div></td>
          <td class="r num hide-s"><b>${esc(p.fv)}</b></td><td class="r num hide-s">${esc(p.eta)}</td><td class="hide-s">${esc(p.lv)}</td><td class="r num hide-s">${p.age != null ? p.age.toFixed(1) : ""}</td><td class="hide-s small">${lineOf(p)}</td></tr>
          <tr class="show-s"><td></td><td class="small"><b>${esc(p.fv)} FV</b>, ETA ${esc(p.eta)}, ${esc(p.lv)}, age ${p.age != null ? p.age.toFixed(1) : "?"}<br>${lineOf(p)}</td></tr>`; }).join("")}
      </tbody></table></div>`;
  }

  // Your board: your order for every player, with tier breaks. The draft room shows it as the Mine column and opens
  // sorted by it, and autopick (an expired clock or Autodraft) follows it.
  function myBoard(sp, P, B) {
    const by = new Map(P.players.map((p) => [p.id, p])), ends = new Set(B.tiers), places = U.board.places(B);
    const shown = B.ids.filter((id) => U.passes(sp, by.get(id), rank.f)).slice(0, 300);
    const rows = shown.map((id, i) => {
      const p = by.get(id), pl = places[id];
      const tierHead = i === 0 || places[shown[i - 1]].tier !== pl.tier ? `<li class="mb-tier"><span>Tier ${pl.tier}</span></li>` : "";
      return `${tierHead}<li class="mb" draggable="true" data-bid="${esc(id)}"><button type="button" class="mb-n" data-bmove="${esc(id)}" title="Move to a spot" aria-label="Spot ${pl.n}: move ${esc(p.n)}">${pl.n}</button><span class="grip" aria-hidden="true">&#8942;&#8942;</span>
        <span class="mb-p" data-player="${esc(id)}">${U.pname(sp, p, `#${p.rank} by value`)}</span><span class="dollar">${p.$ ? U.money(p.$) : ""}</span>
        <span class="mb-act"><button type="button" class="btn icon" data-bup="${esc(id)}" aria-label="Move ${esc(p.n)} up">&uarr;</button><button type="button" class="btn icon" data-bdown="${esc(id)}" aria-label="Move ${esc(p.n)} down">&darr;</button><button type="button" class="btn xs" data-btier="${esc(id)}" aria-pressed="${ends.has(id)}" title="End a tier after him">Tier<span class="hide-s"> break</span></button></span></li>`;
    }).join("");
    return `<div class="card mb-card"><div class="mod-h"><b>My board</b><span class="ps" style="margin-left:6px">${B.custom ? (window.FK.cloud && window.FK.cloud.user() ? "Saved to your account" : "Saved in this browser. Sign in to keep it on every device.") : "Starts as the default rankings. Your first change saves it."}</span><span class="grow"></span>${B.custom ? `<button type="button" class="btn sm" data-breset>Reset to default</button>` : ""}</div>
      <ol class="myboard">${rows || `<li class="ps" style="padding:14px 16px">No one matches.</li>`}</ol>
      <div class="bd ps" style="border-top:1px solid var(--line)">Drag a player, use the arrows, or tap his number to move him to a spot. In any draft room (on any device you're signed in on), your board is the Mine column, the room opens sorted by it, and autopick follows it when your clock runs out or Autodraft is on.</div></div>`;
  }

  /* ---------- routing ---------- */
  async function route() {
    const r = U.route("home");
    const tab = ["draft", "rankings", "home", "setup"].includes(r.tab) ? r.tab : "home";
    header(tab === "home" || tab === "setup" ? "draft" : tab);
    if (tab !== "draft" && roomCtl) { roomCtl.stop(); roomCtl = null; }
    if (tab === "home") { app.onclick = app.oninput = app.onchange = null; return startPage(); }
    if (tab === "setup") { app.onclick = app.oninput = app.onchange = null; return setupPage(); }
    if (tab === "draft") { app.onclick = app.oninput = app.onchange = null; return mock ? draftPage() : startPage(); }
    return rankingsPage();
  }
  window.addEventListener("hashchange", route);
  // the mock changed in another tab: follow it, so the two don't split into different drafts
  window.addEventListener("storage", (e) => {
    if (e.key !== "fk-lab:mock") return;
    const next = store.get("mock", null);
    const was = mock && mock.D && mock.D.created;
    mock = next;
    if (roomCtl && mock && mock.D && mock.D.created === was) roomCtl.refresh();
    else if (U.route("draft").tab === "draft") route();
  });
  route().catch((e) => { app.innerHTML = `<div class="wrap page"><div class="banner"><b>Couldn't load the players.</b> <span class="muted">${esc(e.message)}. Reload to try again.</span></div></div>`; });
})();
