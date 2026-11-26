/* Quick Games: sport-specific schedules, a working game builder, and returning series. */
(function () {
  "use strict";
  const { sports: S, ui: U, cloud: C, slates: SL, quickGames: Q, experience: E, nav: N } = window.FK;
  const { icon, FIELD } = window.FK.setup;
  const { esc, $ } = U, top = $("#top"), app = $("#app"), theme = U.theme("fk-lab");
  const link = C.fromLink(), dataFor = {}, infoFor = {}, asked = {}, states = {}, expanded = {}, details = {};
  let sport = Q.sportKey(new URLSearchParams(location.search).get("s")), mine = null, mineError = false;
  const state = () => states[sport] || (states[sport] = Q.initial(sport));
  const football = () => S.football(sport);
  const current = () => Q.view(state(), dataFor[sport], S, SL, infoFor[sport] && infoFor[sport].counts);
  const date = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const time = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
  // "Today · Nov 19", "Tomorrow · Nov 20", then just "Sat, Nov 21" (the day's name already has its date)
  const periodName = (w) => w.day ? (() => { const nm = sport === "cbb" && SL.dayName(w.day) === "Tonight" ? "Today" : SL.dayName(w.day); return /\d/.test(nm) ? nm : `${nm} · ${date(w.day)}`; })() : `Week ${w.week} · ${date(w.start)}–${date(w.end)}`;
  const gamesN = (n) => `${n} game${n === 1 ? "" : "s"}`;
  const info = () => infoFor[sport] || {};
  const teamName = (t) => (info().teams && info().teams[t] && info().teams[t].n) || t;
  function teamLogo(t, size = 32) {
    const src = (info().teams && info().teams[t] && info().teams[t].logo) || S.teamLogo(sport, t, size * 2);
    return src ? `<img src="${esc(src)}" width="${size}" height="${size}" alt="" loading="lazy" onerror="this.hidden=true">` : `<span class="q-team-fallback" aria-hidden="true">${esc(t.slice(0, 2))}</span>`;
  }
  function header() {
    top.innerHTML = U.shell({ brand: { name: "Draft Lab", href: N.HOME, mark: `<img src="mark.svg" alt="">` }, tabs: N.TABS, inline: true, find: N.findHtml(""), tab: "week",
      right: `<button class="btn sm ghost" data-theme>${theme.dark() ? "Light" : "Dark"}</button>`, hrefOf: (t) => N.href(t, { sport }) });
  }
  function sportPicker() {
    return `<div class="q-sports" role="radiogroup" aria-label="Quick game sport">${Object.entries(Q.SPORTS).map(([k, c]) => {
      const src = S.leagueLogo(k, 80);
      return `<label class="q-sport${k === sport ? " is-active" : ""}"><input id="q-sport-${k}" type="radio" name="q-sport" data-sport="${k}" value="${k}"${k === sport ? " checked" : ""}><span class="q-sport-mark">${src ? `<img src="${esc(src)}" width="34" height="34" alt="">` : icon(k)}</span><span><b>${c.short}</b><small>${c.duration}</small></span><span class="q-sport-check" aria-hidden="true">${k === sport ? "✓" : "→"}</span></label>`;
    }).join("")}</div>`;
  }
  function until(at) {
    const mins = Math.max(0, Math.floor((Date.parse(at) - Date.now()) / 6e4)), h = Math.floor(mins / 60);
    return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${mins % 60}m` : `${mins}m`;
  }
  function hero(v) {
    const c = v.cfg, g = v.open[0], d = dataFor[sport];
    return `<section class="q-hero" aria-labelledby="q-title"><div class="q-hero-art" aria-hidden="true">${FIELD[sport]}</div><div class="q-hero-copy">
      <p class="q-kicker">Draft Lab / Quick games / ${c.short}</p><h1 id="q-title" class="disp">${c.headline.split("\n").map(esc).join("<br>")}</h1><p class="q-intro">${c.intro}</p>
      <div class="q-hero-actions"><a class="btn go" href="/fantasy/quick/?s=${sport}#build">Build your ${football() ? "game" : sport === "cbb" ? "day" : "night"} <span aria-hidden="true">→</span></a><a href="${Q.mockHref(sport)}">Try an ${c.short} mock →</a></div>
      <div class="q-hero-points"><span>${football() ? "One game to one week" : sport === "cbb" ? "One day. One winner." : "One night. One winner."}</span><span>Real box scores</span><span>Run it back</span></div>
    </div><div class="q-spotlight"><div class="q-spotlight-top"><span>${c.next}</span>${g ? `<span class="q-live-dot">In ${until(g.at)}</span>` : `<span>${d && !d.error ? "Next slate" : d ? "Schedule unavailable" : "Loading schedule"}</span>`}</div>
      ${g ? `<div class="q-feature-teams"><div>${teamLogo(g.away, 68)}<b>${esc(teamName(g.away))}</b><small>Away</small></div><span class="q-at">at</span><div>${teamLogo(g.home, 68)}<b>${esc(teamName(g.home))}</b><small>Home</small></div></div><time class="q-feature-time" datetime="${esc(g.at)}">${esc(time(g.at))} ET</time><button type="button" class="q-feature-link" data-one="${esc(g.id)}">Make this a showdown →</button>` : `<div class="q-spotlight-empty"><b>${d && d.error ? "The next rivalry can wait a moment." : d ? "The next slate is on its way." : "Finding your next game…"}</b><p>${d && d.error ? "Retry the schedule below. Your game choices stay here." : "Choose your format below. Available games appear here when the schedule is ready."}</p></div>`}
      <div class="q-spotlight-foot"><span>${v.w ? esc(periodName(v.w)) : c.duration}</span><b>${g ? gamesN(v.open.length) + " available" : c.scoringLabel}</b></div></div></section>`;
  }
  function windowPicker(v) {
    const desc = { saturday: "Saturday before 7 PM ET", friday: "Friday’s FBS matchups", midweek: "The midweek college rivalry", full: sport === "cfb" ? "All available FBS matchups" : sport === "cbb" ? "The featured college slate" : sport === "nba" ? "Every available game that night" : "Every available game this week", sunday: "The Sunday afternoon crew", prime: sport === "cfb" ? "Saturday from 7 PM ET, including late games" : "The night-game rivalry", early: "Start early, finish earlier", late: "For the West Coast crowd", one: "One matchup. Captain at 1.5x.", custom: "Only the matchups you want" };
    return `<div class="q-windows" role="group" aria-label="Game window">${v.options.map((x) => `<button id="q-window-${x.kind}" type="button" class="q-window" data-window="${x.kind}" aria-pressed="${x.kind === v.kind}"><span>${x.kind === "one" ? "01" : x.kind === "custom" ? "+" : String(x.games.length).padStart(2, "0")}</span><b>${sport === "cbb" && x.kind === "full" ? "Featured slate" : esc(x.label)}</b><small>${desc[x.kind] || esc(x.sub)}</small></button>`).join("")}</div>`;
  }
  function gameCard(g, v) {
    const on = !!v.slate && v.slate.games.some((x) => x.id === g.id), pick = v.kind === "one" || v.kind === "custom";
    const line = `<span class="q-game-teams"><span>${teamLogo(g.away)}<b>${esc(teamName(g.away))}</b></span><span>${teamLogo(g.home)}<b>${esc(teamName(g.home))}</b></span></span>`;
    const tail = `<span class="q-game-meta"><time datetime="${esc(g.at)}">${esc(time(g.at))} ET</time>${pick ? `<span class="q-game-check" aria-hidden="true">${on ? "✓" : "+"}</span>` : `<span class="q-game-arrow">Showdown ↗</span>`}</span>`;
    if (pick) return `<label class="q-game${on ? " is-picked" : ""}"><input id="q-game-${esc(g.id)}" type="${v.kind === "one" ? "radio" : "checkbox"}" name="q-games" data-game="${esc(g.id)}"${on ? " checked" : ""}><span class="sr">${esc(g.away)} at ${esc(g.home)}, ${esc(time(g.at))} ET</span>${line}${tail}</label>`;
    return `<button id="q-game-${esc(g.id)}" class="q-game" type="button" data-one="${esc(g.id)}" aria-label="Play only ${esc(g.away)} at ${esc(g.home)}, ${esc(time(g.at))} ET">${line}${tail}</button>`;
  }
  function schedule(v) {
    const d = dataFor[sport];
    if (!d) return `<div class="q-loading" role="status"><span class="q-skeleton"></span><span class="q-skeleton"></span><p>Loading ${v.cfg.short}'s available games…</p></div>`;
    if (d.error) return `<div class="q-empty" role="alert"><b>We couldn't load the ${v.cfg.short} schedule.</b><p>Your choices are kept. Try the live feed again.</p><button class="btn" type="button" data-retry>Try again</button></div>`;
    if (!v.periods.length) return `<div class="q-empty"><b>No ${v.cfg.short} games are open to draft right now.</b><p>${football() ? "This page offers the current and following football week. Return when the next available games are on the schedule." : "This page offers today's and tomorrow's games. Return when the next slate is available."} You can still practice a draft.</p><a class="btn" href="${Q.mockHref(sport)}">Open a ${v.cfg.short} mock</a><button class="btn ghost" type="button" data-retry>Refresh schedule</button></div>`;
    const showAll = expanded[sport] || ["one", "custom"].includes(v.kind), gs = ["one", "custom"].includes(v.kind) ? v.open : v.slate ? v.open.filter((g) => v.slate.games.some((x) => x.id === g.id)) : [];
    const tabs = `<div class="q-periods" role="radiogroup" aria-label="${football() ? "Which week" : "Which night"}">${v.periods.map((w) => `<label><input id="q-period-${SL.periodKey(w)}" type="radio" name="q-period" data-period="${SL.periodKey(w)}"${v.w === w ? " checked" : ""}><span>${esc(periodName(w))}</span></label>`).join("")}</div>`;
    const delayed = d.stale ? `<span class="q-stale">Schedule updates are delayed. Refresh before continuing.</span>` : "";
    const updated = d.updated ? `<span>Schedule updated ${esc(new Date(d.updated).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }))} ET</span>` : "";
    return `${tabs}${v.w ? windowPicker(v) : ""}${v.error ? `<p class="q-selection-error" role="status">${esc(v.error)}</p>` : ""}${v.w ? `<div class="q-games-head"><h3>${v.kind === "custom" ? "Choose your games" : v.kind === "one" ? "Choose your showdown" : "On your slate"}</h3><span>${v.slate ? gamesN(v.slate.games.length) + " selected" : "No games selected"}</span></div>${v.kind === "custom" ? `<p class="q-help">Select any combination. The roster adapts to the games you choose.</p>` : v.kind === "one" ? `<p class="q-help">Everyone builds around one real matchup. Pick your captain, then fill five flex spots.</p>` : ""}<div class="q-games">${gs.slice(0, showAll ? gs.length : 6).map((g) => gameCard(g, v)).join("")}</div>${!showAll && gs.length > 6 ? `<button type="button" class="q-show-all" data-expand>Show all ${gs.length} games <span aria-hidden="true">↓</span></button>` : ""}` : ""}<div class="q-feed-note">${delayed}${updated}<span>All times Eastern · Games close to new setups 10 minutes before the start</span><button type="button" data-retry>Refresh</button></div>`;
  }
  function controls(v) {
    const points = Object.entries(S[sport].scorings).filter(([, x]) => x.type === "points");
    return `<section class="q-build-section"><div class="q-step-heading"><span>02</span><div><h2>Choose how you play</h2><p>Same real games. Three different ways to build your team.</p></div></div><div class="q-modes" role="group" aria-label="Team building format">${Q.MODES.map((m) => `<button id="q-mode-${m.key}" type="button" data-mode="${m.key}" aria-pressed="${v.mode === m.key}"><small>${m.tag}</small><b>${m.name}</b><p>${m.text}</p><span>${m.timing}</span></button>`).join("")}</div><div class="q-preferences"><div class="q-pref"><label for="q-size">Your group</label><select id="q-size" data-teams>${v.teamOptions.map((n) => `<option value="${n}"${n === v.teams ? " selected" : ""}>${n} managers</option>`).join("")}</select><small>${v.mode === "cap" ? "Players can appear on multiple teams." : "Group size fits the selected player pool."}</small></div><div class="q-pref"><label for="q-scoring">Scoring</label><select id="q-scoring" data-scoring>${points.map(([k, x]) => `<option value="${k}"${k === v.scoring ? " selected" : ""}>${sport === "nba" ? "Fantasy points" : esc(x.label)}</option>`).join("")}</select><small>Custom scoring is available in full setup.</small></div></div><div class="q-competition"><span>Who wins?</span><div role="group" aria-label="Competition"><button id="q-match-allplay" type="button" data-match="allplay" aria-pressed="${v.match === "allplay"}"><b>Everyone vs. everyone</b><small>Highest score wins the group</small></button><button id="q-match-h2h" type="button" data-match="h2h" aria-pressed="${v.match === "h2h"}"><b>Head to head</b><small>${v.teams === 2 ? "You and your rival" : "Pair off into individual matchups"}</small></button></div></div></section>`;
  }
  function summary(v) {
    const sl = v.slate, href = Q.setupHref(v, E, SL), custom = Q.setupHref(v, E, SL, true), mode = Q.MODES.find((m) => m.key === v.mode);
    const slots = v.lineup ? v.lineup.lineup.reduce((a, x) => (a[x] = (a[x] || 0) + 1, a), {}) : {};
    const ready = href && !v.error && !dataFor[sport]?.error;
    return `<aside class="q-summary" aria-labelledby="q-summary-title"><div class="q-summary-top"><span class="q-kicker">Your game plan</span><h2 id="q-summary-title">${football() ? "Game on." : sport === "cbb" ? "Make a day of it." : "Make a night of it."}</h2><p>${v.teams} managers · ${v.match === "allplay" ? "one winner" : v.teams === 2 ? "one rivalry" : v.teams / 2 + " matchups"}</p></div><dl class="q-summary-facts"><div><dt>The games</dt><dd>${sl ? `${esc(sport === "cbb" && v.kind === "full" ? "Featured slate" : sl.label)}<small>${gamesN(sl.games.length)} · ${esc(periodName(v.w))}</small>` : "Choose a game window"}</dd></div><div><dt>The format</dt><dd>${mode.name}<small>${v.mode === "cap" ? "$50,000 budget · unique picks at 1.25x" : v.mode === "snake" ? "30 seconds per pick" : "Private lists, automatic draft"}</small></dd></div><div><dt>Scoring</dt><dd>${sport === "nba" ? "Fantasy points" : esc(S[sport].scorings[v.scoring].label)}</dd></div>${sl ? `<div><dt>${v.mode === "cap" ? "Lineups due before" : "First " + v.cfg.verb.toLowerCase()}</dt><dd>${esc(time(sl.games[0].at))} ET</dd></div>` : ""}</dl>${v.lineup ? `<div class="q-roster"><h3>Your starting lineup</h3><div class="q-slots">${Object.entries(slots).map(([p, n]) => `<span>${n > 1 ? n + " " : ""}${p === "CPT" ? "Captain" : p === "UTIL" ? "Flex" : p}</span>`).join("")}</div><p>${v.lineup.mult ? "Captain scores 1.5x. " : ""}${v.mode === "cap" ? "No bench." : v.lineup.bench ? `${v.lineup.bench} bench spot${v.lineup.bench === 1 ? "" : "s"}.` : "No bench."}</p></div>` : ""}<div class="q-summary-action">${ready ? `<a class="btn go" href="${esc(href)}" data-continue>Continue to setup →</a><a class="q-custom-link" href="${esc(custom)}" data-continue>Full customization</a><p>Review the rules, add names, and invite your group. Sign in when you create the game.</p>` : `<button class="btn go" type="button" disabled>Choose your games first</button><p>${v.error ? esc(v.error) : "Pick an available slate or matchup to continue."}</p>`}</div><details class="q-scoring" data-detail="scoring"${details.scoring ? " open" : ""}><summary>How the points add up</summary><table><caption class="sr">Selected scoring values</caption><tbody>${Q.scoringRows(v, S).map((r) => `<tr><th scope="row">${r.label}</th><td>${r.value > 0 ? "+" : ""}${r.value}</td></tr>`).join("")}</tbody></table><p>${football() ? "Passing yards: +0.04 each. Rushing and receiving yards: +0.1 each. All weights can be reviewed in setup." : "The full scoring formula is shown in setup. Your choices carry through."}</p></details></aside>`;
  }
  function mineCard(v) {
    const c = v.cfg;
    if (!C.user()) return `<section class="q-returning"><div><p class="q-kicker">Keep the rivalry going</p><h2>Your ${c.short} games belong here.</h2><p>Sign in to find your draft rooms, results, and the series you can run back.</p></div><a class="btn" href="/fantasy/leagues/">Find your games →</a></section>`;
    if (!mine) return `<section class="q-returning" role="status"><p>${mineError ? "Your games couldn't be loaded. Open My leagues to try again." : "Finding your " + c.short + " games…"}</p><a href="/fantasy/leagues/">My leagues →</a></section>`;
    const list = Q.seriesFor(mine, sport);
    if (!list.length) return `<section class="q-returning"><div><p class="q-kicker">Start a tradition</p><h2>Your first ${c.short} rivalry starts here.</h2><p>Finish a game, run it back with the same group, and keep the series record.</p></div><a class="btn" href="/fantasy/quick/?s=${sport}#build">Build your first game →</a></section>`;
    const status = (l) => l.phase === "live" ? "Drafting now" : l.phase === "season" ? l.card && l.card.week > (l.card.weeks || 1) ? "Final · ready to run back" : football() ? "Playing this week" : "Playing this slate" : l.phase === "done" ? "Draft complete" : "Draft room open";
    return `<section class="q-yours"><div class="q-section-title"><div><p class="q-kicker">Pick up the rivalry</p><h2>Your ${c.short} games</h2></div><a href="/fantasy/leagues/">All my leagues →</a></div><div class="q-your-games">${list.map((l) => `<a href="/fantasy/league/?id=${encodeURIComponent(l.id)}"><span class="q-your-mark">${icon(sport)}</span><div><b>${esc(l.name)}</b><small>${l.seriesN > 1 ? "Game " + l.seriesN + " · " : ""}${esc(l.slate || c.short)}</small></div><span><b>${status(l)}</b><small>Open game →</small></span></a>`).join("")}</div></section>`;
  }
  function howItWorks(v) {
    const qs = [["custom", "Can I still customize everything?", "Yes. Full setup keeps every available draft format, scoring option, roster rule, and twist. The choices here give you a starting point; you can change them before creating the game."], ["locks", "What happens when a real game starts?", "Games stop appearing in new setups 10 minutes before the start. Finish a live draft before the first game in your slate. Each player's lineup spot locks when his real game starts."], ["live", "Where do scores come from?", "The selected games' real box scores feed the league and matchup pages. Scores update during play, and your game finishes after its last real game. You can follow every team's score in the league."], ["series", "Can we play again with the same group?", "Yes. When the game is over, Run it back opens a fresh setup with the same managers. Choose the next available games; the series keeps wins, top-three finishes, and points."]];
    return `<section class="q-how"><div class="q-section-title"><div><p class="q-kicker">From group chat to game on</p><h2>One ${v.cfg.unit}. A proper league.</h2></div><a href="${v.cfg.hub}">${v.cfg.hubLabel} →</a></div><div class="q-ideas">${v.cfg.ideas.map(([title, text], i) => `<article><span>0${i + 1}</span><h3>${title}</h3><p>${text}</p></article>`).join("")}</div></section><section class="q-faq"><h2>A few things to know</h2>${qs.map(([id, title, text]) => `<details data-detail="${id}"${details[id] ? " open" : ""}><summary>${title}</summary><p>${text}</p></details>`).join("")}</section>`;
  }
  function render(focus) {
    const v = current(); if (v.w && !state().period) state().period = SL.periodKey(v.w);
    document.title = `${v.cfg.short} Quick Games | Draft Lab`;
    app.innerHTML = `<div class="q-page q-${sport}"><div class="wrap q-wrap"><div class="q-page-heading"><a href="/fantasy/">Fantasy</a><span>/</span><b>Quick games</b><span class="q-page-tag">Small commitment. Full competition.</span></div>${sportPicker()}${hero(v)}<div class="q-builder" id="build"><div class="q-builder-main"><section class="q-build-section"><div class="q-step-heading"><span>01</span><div><h2>Pick your ${football() ? "game window" : sport === "cbb" ? "day" : "night"}</h2><p>${sport === "cbb" ? "Featured college games, selected by the College Hoops Hub." : (sport === "nba" || sport === "nhl") ? "Tonight, tomorrow, or one game you can't miss." : sport === "cfb" ? "Saturday main, Saturday night, Friday, midweek, or the full FBS week." : "The full week, Sunday, primetime, or just your favorite matchup."}</p></div></div>${schedule(v)}</section>${controls(v)}</div>${summary(v)}</div>${mineCard(v)}${howItWorks(v)}<footer class="q-footer"><b>More rules. Same easy start.</b><p>Keep it classic, make it strange, and run it back when you're done.</p><a href="${esc(Q.setupHref(v, E, SL, true) || '/fantasy/leagues/?w=1&custom=1&s=' + sport)}">Explore every customization →</a></footer></div></div>`;
    if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
  }
  function loadInfo(k) {
    if (asked[k]) return; asked[k] = true;
    fetch(`data/${(k === "cbb" || k === "cfb") ? "teams-" + k : k}.json`, { cache: "no-cache" }).then((r) => r.ok ? r.json() : null).then((d) => { if (!d) return; const counts = d.counts || {}; if (!d.counts) for (const p of d.players || []) counts[p.t] = (counts[p.t] || 0) + 1; infoFor[k] = { counts, teams: d.teams && !Array.isArray(d.teams) ? d.teams : {} }; if (sport === k) render(); }).catch(() => {});
  }
  async function load(k = sport, refresh = false) {
    if (!refresh && dataFor[k]) return;
    const d = await C.slates(k, refresh).catch(() => ({ weeks: [], error: true }));
    dataFor[k] = d && Array.isArray(d.weeks) && (!d.sport || d.sport === k) ? d : { weeks: [], error: true };
    if (sport === k) render();
  }
  function switchSport(k) { sport = Q.sportKey(k); state(); history.replaceState(null, "", location.pathname + "?s=" + sport); header(); render("q-sport-" + sport); loadInfo(sport); load(); }
  app.addEventListener("change", (e) => {
    const el = e.target, s = state();
    if (el.dataset.sport) { switchSport(el.dataset.sport); return; }
    if (el.dataset.period) { s.period = el.dataset.period; s.kind = ""; s.one = ""; s.games = []; expanded[sport] = false; }
    else if (el.dataset.game) { const v = current(); if (v.kind === "one") s.one = el.dataset.game; else { const ids = new Set(s.games); el.checked ? ids.add(el.dataset.game) : ids.delete(el.dataset.game); s.games = [...ids]; } }
    else if (el.hasAttribute("data-teams")) s.teams = Number(el.value);
    else if (el.hasAttribute("data-scoring")) s.scoring = el.value;
    else return;
    render(el.id);
  });
  app.addEventListener("click", (e) => {
    const one = e.target.closest("[data-one]"); if (one) { const scroll = !!one.closest('.q-spotlight'); state().kind = "one"; state().one = one.dataset.one; render("q-game-" + one.dataset.one); if (scroll) document.getElementById('build')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const win = e.target.closest("[data-window]"); if (win) { const s = state(), v = current(); s.kind = win.dataset.window; if (s.kind === "one" && !s.one) s.one = (v.open[0] || {}).id || ""; if (s.kind === "custom" && !s.games.length) s.games = (v.slate ? v.slate.games : v.open.slice(0, 3)).map((g) => g.id); expanded[sport] = false; render(win.id); return; }
    const mode = e.target.closest("[data-mode]"); if (mode) { state().mode = mode.dataset.mode; render(mode.id); return; }
    const match = e.target.closest("[data-match]"); if (match) { state().match = match.dataset.match; render(match.id); return; }
    if (e.target.closest("[data-expand]")) { expanded[sport] = true; render(); return; }
    const retry = e.target.closest("[data-retry]"); if (retry) { retry.disabled = true; retry.textContent = "Refreshing…"; load(sport, true); return; }
    const go = e.target.closest("[data-continue]"); if (go) { const href = Q.setupHref(current(), E, SL, new URL(go.href).searchParams.get("custom") === "1"); if (!href || href !== go.getAttribute("href")) { e.preventDefault(); render(); U.toast("The available games changed. Review your game plan before continuing."); } }
  });
  app.addEventListener("toggle", (e) => { if (e.target.dataset && e.target.dataset.detail) details[e.target.dataset.detail] = e.target.open; }, true);
  document.addEventListener("click", (e) => { if (e.target.closest("button[data-theme]")) { theme.toggle(); header(); } });
  window.addEventListener("popstate", () => { sport = Q.sportKey(new URLSearchParams(location.search).get("s")); header(); render(); loadInfo(sport); load(); });
  if (link && link.error) U.toast(link.error, true);
  header(); render(); loadInfo(sport); load();
  if (C.user()) C.rpc("fk_mine", {}).then((r) => { if (!Array.isArray(r)) throw Error("No games"); mine = r; render(); }).catch(() => { mineError = true; render(); });
  setInterval(() => { if (!document.hidden && !app.contains(document.activeElement)) render(); }, 60e3);
  setInterval(() => { if (!document.hidden) load(sport, true); }, 300e3);
})();
