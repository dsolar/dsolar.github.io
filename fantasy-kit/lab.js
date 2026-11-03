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
    const want = (c.lineup ? c.lineup.split(/[\s,]+/).filter(Boolean) : sport.lineup).filter((s) => sport.slots[s] && s !== "BN");
    const lineup = want.filter((s) => sport.slots[s] === "*" || sport.slots[s].some((x) => have.has(x)));
    const players = data.players.map((p) => Object.assign({}, p));
    const scoring = sport.scorings[c.scoring] ? c.scoring : Object.keys(sport.scorings)[0];
    const bench = c.bench == null ? sport.bench : c.bench;
    const dyn = c.dynasty ? await loadDynasty(c.sport) : null;
    V.evaluate(sport, players, { teams: c.teams, lineup, bench, scoring, budget: c.budget, dynasty: !!c.dynasty, dynastyRanks: dyn, market: await loadMarket(c.sport) });
    return { sport, players, lineup, scoring, bench, data };
  }

  /* ---------- header ---------- */
  function header(tab) {
    const right = `<a class="btn sm ghost" href="../fantasy/">All fantasy</a><button class="btn sm ghost" data-act="theme">${theme.dark() ? "Light" : "Dark"}</button>${mock ? `<button class="btn sm" data-act="new">New mock</button>` : ""}`;
    top.innerHTML = U.shell({ brand: { name: "Draft Lab", href: "./", mark: `<img src="mark.svg" alt="">` },
      tabs: [["draft", "Mock draft"], ["rankings", "Rankings"], ["league", "Demo league"], ["leagues", "Your leagues"], ["kit", "The kit"]], tab, right,
      hrefOf: (t, sub) => (t === "league" ? `league.html?s=${cfg.sport}` : t === "leagues" ? "leagues.html" : "#" + t + (sub ? "/" + sub : "")) });
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

  /* ---------- setup ---------- */
  function setupPage() {
    document.body.classList.remove("fk-room");
    const sport = S[cfg.sport];
    const scoring = sport.scorings[cfg.scoring] ? cfg.scoring : Object.keys(sport.scorings)[0];
    const lineup = cfg.lineup || sport.lineup.join(" ");
    const bench = cfg.bench == null ? sport.bench : cfg.bench;
    const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(l)}</option>`;
    app.innerHTML = `<div class="wrap page">
      <div class="hero"><h1 class="disp">Mock it before<br>you draft it.</h1><p>Pick a sport and a format, take a seat, and draft against bots that know positions, budgets and the clock. Real player data, refreshed from the same feeds as the league pages.</p></div>
      <div class="setup">
        <form class="card form" id="setup">
          <div class="sports" role="radiogroup" aria-label="Sport">${Object.values(S.ALL).map((s) => `<label><input type="radio" name="sport" value="${s.key}"${s.key === cfg.sport ? " checked" : ""}><span><b class="disp">${esc(s.name)}</b><small>${esc(BLURB[s.key])}</small></span></label>`).join("")}</div>
          <div class="row2">
            <div class="field"><label for="s-type">Format</label><select id="s-type" name="type">${Object.entries(F.FORMATS).map(([k, l]) => opt(k, l, cfg.type)).join("")}</select></div>
            <div class="field"><label for="s-scoring">Scoring</label><select id="s-scoring" name="scoring">${Object.entries(sport.scorings).map(([k, s]) => opt(k, s.label.replace(/ \(.*\)$/, ""), scoring)).join("")}</select></div>
          </div>
          <div class="row3">
            <div class="field"><label for="s-teams">Teams</label><select id="s-teams" name="teams">${[4, 6, 8, 10, 12, 14, 16].map((n) => opt(n, n, cfg.teams)).join("")}</select></div>
            ${cfg.type === "mystery" ? `<div class="field"><label for="s-trades">Trades</label><select id="s-trades" name="trades">${opt(1, "Picks and players", cfg.trades)}${opt(0, "Off", cfg.trades)}</select></div>` : `<div class="field"><label for="s-slot">${cfg.type === "auction" ? "Your nomination turn" : "Your pick"}</label><select id="s-slot" name="slot">${opt(0, "Random", cfg.slot)}${Array.from({ length: cfg.teams }, (_, i) => opt(i + 1, U.ord(i + 1), cfg.slot)).join("")}</select></div>`}
            <div class="field"><label for="s-clock">${cfg.type === "auction" ? "Bid clock" : "Pick clock"}</label><select id="s-clock" name="clock">${(cfg.type === "auction" ? [10, 15, 20, 30] : [15, 30, 60, 90, 0, -20, -30, -60]).map((n) => opt(n, n < 0 ? `Time bank, ${-n} seconds a round` : n ? n + " seconds" : "No clock", cfg.clock)).join("")}</select></div>
          </div>
          ${cfg.type === "mystery" ? `<div class="row2"><div class="field"><label for="s-reveal">Packages open</label><select id="s-reveal" name="reveal">${Object.entries(F.REVEALS).map(([k, l]) => opt(k, l, cfg.reveal)).join("")}</select></div><div class="field"><label for="s-test">Bot test</label><select id="s-test" name="test">${opt(1, "Keep the most even of 5 bot drafts", cfg.test)}${opt(0, "Off, use the first even deal", cfg.test)}</select></div></div>
            <p class="ps" style="margin:-4px 0 0">Every team gets a random set of picks, like 1, 24 and 42 against 12, 13 and 18, dealt so each set adds up to the same value on the pick curve.</p>` : ""}
          ${cfg.type === "elephant" ? `<p class="ps" style="margin:-4px 0 0">A snake draft where your turn can be a steal: take a player someone already drafted. The team you rob picks again right away and can't take him straight back. Each team gets 3 steals, a player is frozen after 2, and steals end with 2 rounds to go.</p>` : ""}
          ${cfg.type !== "auction" && cfg.type !== "mystery" && cfg.type !== "elephant" ? `<div class="row2"><div class="field"><label for="s-trades">Trades during the draft</label><select id="s-trades" name="trades">${opt(1, "Picks and players", cfg.trades)}${opt(0, "Off", cfg.trades)}</select></div><div></div></div>` : ""}
          ${cfg.clock < 0 && cfg.type !== "auction" ? `<p class="ps" style="margin:-4px 0 0">One clock for your whole draft. Run it out and every pick gets 10 seconds. The time you have left at the end becomes FAAB for the season: from half the league's budget to one and a half times it. Bots draft at their own pace and pay for it the same way.</p>` : ""}
          ${cfg.type === "auction" ? `<div class="row2"><div class="field"><label for="s-budget">Budget per team</label><select id="s-budget" name="budget">${[100, 200, 260, 300, 1000].map((n) => opt(n, "$" + n, cfg.budget)).join("")}</select></div><div></div></div>` : ""}
          <div class="field"><span class="lbl">Starting lineup</span>${lineupBuilder(sport, lineup.split(/[\s,]+/).filter((x) => sport.slots[x] && x !== "BN"))}</div>
          <div class="row2">
            <div class="field"><label for="s-bench">Bench spots</label><select id="s-bench" name="bench">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 10].map((n) => opt(n, n, bench)).join("")}</select></div>
            <div class="field"><label for="s-name">Your team name</label><input type="text" id="s-name" name="name" maxlength="28" value="${esc(cfg.name)}" placeholder="Your team"></div>
          </div>
          <p class="why" id="s-why" hidden></p>
          <div class="acts" style="justify-content:flex-start"><button class="btn go">Take your seat</button>${mock ? `<a class="btn" href="#draft">Back to your mock</a>` : ""}</div>
        </form>
        <aside class="stack">
          <div class="card pad"><h3>How the bots draft</h3><p class="small muted" style="margin:0">Bots value players by points or category z-scores over the replacement player at each position, so a scarce catcher or tight end goes earlier than his raw numbers say. They fill starters before the bench, leave kickers and defenses for the last rounds, and in an auction bid by proxy up to a price set by their budget and needs.</p></div>
          <div class="card pad"><h3>Trades</h3><p class="small muted" style="margin:0">Trade picks, and players you've drafted, with any team while the draft runs. Bots answer right away, and sometimes call you to move up when you're on the clock.</p></div>
          <div class="card pad"><h3>Demo leagues</h3><p class="small muted" style="margin:0 0 10px">Seasons with bots that play out in real time.</p><div class="row" style="flex-wrap:wrap"><a class="btn sm" href="league.html?s=${esc(cfg.sport)}&f=h">Head to head</a><a class="btn sm" href="league.html?s=${esc(cfg.sport)}&f=g">Best ball guillotine</a></div></div>
          <div class="card pad"><h3>Your seat</h3><p class="small muted" style="margin:0">Queue players before you start. If your clock runs out, the first queued player who still fits is your pick, then the best fit. The draft saves on this device, so you can close the tab and come back.</p></div>
        </aside>
      </div></div>`;
    const f = $("#setup");
    f.addEventListener("click", (e) => {
      const pr = e.target.closest("[data-preset]"), lb = e.target.closest("[data-lb]");
      if (!pr && !lb) return;
      const cur = (cfg.lineup || sport.lineup.join(" ")).split(/[\s,]+/).filter((x) => sport.slots[x] && x !== "BN");
      let next = cur;
      if (pr) next = pr.dataset.preset.split(" ");
      else if (+lb.dataset.d > 0) next = orderLineup(sport, cur.concat(lb.dataset.lb));
      else { const i = cur.lastIndexOf(lb.dataset.lb); if (i >= 0) next = cur.filter((_, j) => j !== i); }
      if (!next.length) { U.toast("A lineup needs at least one starter", true); return; }
      cfg.name = new FormData(f).get("name"); cfg.lineup = next.join(" ");
      store.set("cfg", cfg); setupPage();
      // keep keyboard focus on the button that was pressed
      const back = lb ? $(`[data-lb="${lb.dataset.lb}"][data-d="${lb.dataset.d}"]`) : $(`[data-preset="${pr.dataset.preset}"]`);
      if (back && !back.disabled) back.focus(); else if (lb) { const other = $(`[data-lb="${lb.dataset.lb}"]:not([disabled])`); if (other) other.focus(); }
    });
    f.addEventListener("change", (e) => {
      const n = e.target.name;
      if (n === "lineup" || n === "name") return;
      const fd = new FormData(f);
      if (n === "sport") { cfg = Object.assign(cfg, { sport: fd.get("sport"), scoring: "", lineup: "", bench: null }); }
      else if (n === "type") { cfg.type = fd.get("type"); cfg.clock = cfg.type === "auction" ? 15 : [15, 30, 60, 90, 0, -20, -30, -60].includes(cfg.clock) ? cfg.clock : 30; }
      else cfg[n] = n === "scoring" || n === "reveal" ? fd.get(n) : +fd.get(n);
      cfg.name = fd.get("name"); if (n !== "sport") cfg.lineup = fd.get("lineup");
      store.set("cfg", cfg); setupPage();
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const s = S[fd.get("sport")];
      const bad = fd.get("lineup").split(/[\s,]+/).filter(Boolean).filter((x) => !s.slots[x] || x === "BN");
      if (bad.length) { const w = $("#s-why"); w.hidden = false; w.textContent = `Unknown slot${bad.length > 1 ? "s" : ""}: ${bad.join(", ")}`; return; }
      cfg = Object.assign(cfg, { sport: fd.get("sport"), type: fd.get("type"), scoring: fd.get("scoring"), teams: +fd.get("teams"), slot: +fd.get("slot"), clock: +fd.get("clock"), budget: +(fd.get("budget") || cfg.budget), bench: +fd.get("bench"), lineup: fd.get("lineup").trim(), name: fd.get("name").trim(),
        reveal: fd.get("reveal") || cfg.reveal, test: fd.get("test") == null ? cfg.test : +fd.get("test"), trades: fd.get("trades") == null ? cfg.trades : +fd.get("trades") });
      store.set("cfg", cfg);
      const go = $("button.go", f); go.disabled = true; go.textContent = cfg.type === "mystery" && cfg.test ? "Dealing and testing packages..." : "Setting up...";
      await new Promise((r) => setTimeout(r, 30));
      try { await newMock(cfg); }
      catch (err) { go.disabled = false; go.textContent = "Take your seat"; const w = $("#s-why"); w.hidden = false; w.textContent = err.message; w.scrollIntoView({ block: "center" }); return; }
      location.hash = "#draft"; route();
    });
  }

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
    if (spots > P.players.length) throw new Error(`${n} teams with ${P.lineup.length + P.bench} roster spots need ${spots} players, and the pool has ${P.players.length}.`);
    const seed = Math.floor(Math.random() * 2 ** 31);
    const r = F.rng(seed);
    const others = [...Array(n).keys()].filter((x) => x !== 0);
    for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
    const slot = c.slot ? c.slot - 1 : Math.floor(r() * n);
    const order = others.slice(0, slot).concat(0, others.slice(slot));
    const total = n * (P.lineup.length + P.bench);
    const D = F.create({ sport: P.sport, type: c.type, teams: n, seed, now: Date.now(), lineup: P.lineup, bench: P.bench, scoring: P.scoring,
      botDelay: 1200, clock: c.type === "auction" || c.clock < 0 ? 0 : c.clock, bank: c.clock < 0 && c.type !== "auction" ? { perRound: -c.clock, floor: 10 } : null, bidClock: c.clock || 15, nomClock: 30, budget: c.budget, order, name: `${P.sport.name} mock`,
      trades: c.trades !== 0, curve: c.type === "mystery" ? F.pickCurve(P.players, total) : null, reveal: c.reveal });
    if (c.type === "mystery" && c.test) F.fairDeal(D, P.players, P.sport, null, { tries: 5 });
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
    roomCtl = U.room({ el: $("#room"), sport: P.sport, players: P.players, draft: () => mock.D, save: () => store.set("mock", mock), me: () => 0, commish: true,
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
    const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`;
    const focus = document.activeElement && document.activeElement.id;
    app.innerHTML = `<div class="wrap page">
      <div class="head"><h1 class="disp">${esc(sp.name)} rankings</h1><span class="ps">${esc(sp.data.source)}, ${esc(sp.data.season)}. ${c.teams} teams, ${esc(sp.scorings[P.scoring].label)}${P.lineup.length ? `, starting ${P.lineup.join(" ")}` : ""}.</span></div>
      <div class="tools"><label class="sr" for="r-sport">Sport</label><select id="r-sport">${Object.values(S.ALL).map((s) => opt(s.key, s.name, rank.sport)).join("")}</select>
        <label class="sr" for="r-scoring">Scoring</label><select id="r-scoring">${Object.entries(sp.scorings).map(([k, s]) => opt(k, s.label.replace(/ \(.*\)$/, ""), P.scoring)).join("")}</select>
        <label class="sr" for="r-dyn">League type</label><select id="r-dyn">${opt("", "Redraft", rank.dyn ? "1" : "")}${opt("1", "Dynasty", rank.dyn ? "1" : "")}</select>
        <div class="seg" role="group" aria-label="Rankings"><button type="button" data-rmode="default" aria-pressed="${rank.mode === "default"}">Rankings</button><button type="button" data-rmode="board" aria-pressed="${mine}">My board</button>${sp.key === "mlb" ? "" : `<button type="button" data-rmode="prospects" aria-pressed="${rank.mode === "prospects"}">Prospects</button>`}</div></div>
      <div class="tools">${U.search(rank.f)}<label class="sr" for="fk-team">${esc(sp.league)} team</label><select id="fk-team" class="${rank.f.team ? "set" : ""}"><option value="">All ${esc(sp.league)} teams</option>${teams.map((t) => `<option${t === rank.f.team ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>${U.posFilter(sp, rank.f.pos)}
      ${rank.mode === "prospects" && sp.key !== "mlb" ? await prospectsView(sp) : mine ? myBoard(sp, P, B) : U.table({ cols, rows, sort: rank.sort, dense: true, limit: 300, rowAttr: (p) => `data-player="${esc(p.id)}"`, empty: "No one matches." })}
      <p class="ps">${rank.dyn ? "Dynasty: each player's value over the next five seasons, from an age curve for his position, blended with outside dynasty consensus where it ranks him. " : ""}${sp.data.lines && sp.data.lines.pbat ? `Values come from ${esc(sp.data.lines.pbat.label.replace(/, batting$/, ""))} projections from FanGraphs; the stat columns show last season. ` : ""}${sp.market ? `ESPN and ESPN $ are ESPN's rank and the average price in real ESPN auctions, for comparison. ` : ""}Ranks are value over the replacement player at each position, for the league size and lineup above. Auction values split ${c.teams} budgets of $${c.budget}.</p></div>`;
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
    return `<div class="card mb-card"><div class="mod-h"><b>My board</b><span class="ps" style="margin-left:6px">${B.custom ? "Saved in this browser" : "Starts as the default rankings. Your first change saves it."}</span><span class="grow"></span>${B.custom ? `<button type="button" class="btn sm" data-breset>Reset to default</button>` : ""}</div>
      <ol class="myboard">${rows || `<li class="ps" style="padding:14px 16px">No one matches.</li>`}</ol>
      <div class="bd ps" style="border-top:1px solid var(--line)">Drag a player, use the arrows, or tap his number to move him to a spot. In any draft room in this browser, your board is the Mine column, the room opens sorted by it, and autopick follows it when your clock runs out or Autodraft is on.</div></div>`;
  }

  /* ---------- the kit ---------- */
  function kitPage() {
    document.body.classList.remove("fk-room");
    app.onclick = app.oninput = app.onchange = null;
    app.innerHTML = `<div class="wrap page doc">
      <div class="head"><h1 class="disp">The Fantasy Kit</h1></div>
      <div class="cols"><div class="stack">
        <div class="card pad"><h2>What it is</h2><p>The shared parts of every league page on this site: player data for three sports, player values, a draft engine and the screens that sit on top of them. Draft Lab is the kit with nothing added. A league page adds its own rules (a salary cap, keepers, a scoring quirk) through hooks and its own colors through four tokens.</p></div>
        <div class="card pad"><h2>Files</h2><ul>
          <li><b>sports.js</b>: positions, lineup slots, position limits, stat columns and scoring for basketball, football and baseball.</li>
          <li><b>value.js</b>: category z-scores or fantasy points, value over replacement by position, auction dollars.</li>
          <li><b>draft.js</b>: snake, linear, third-round reversal, mystery packages, white elephant and auction drafts with clocks, queues, keepers, bots, pause, undo and trades during the draft. No screen code, so a server can run it.</li>
          <li><b>ui.js</b> and <b>kit.css</b>: masthead and tabs, sortable player tables, filters, the player card and the full draft room.</li>
          <li><b>data/</b>: nba.json, nfl.json and mlb.json, rebuilt by tools/fantasykit_data.py.</li></ul></div>
        <div class="card pad"><h2>A league page in a few lines</h2><div class="code">&lt;link rel="stylesheet" href="/fantasy-kit/kit.css"&gt;
&lt;script src="/fantasy-kit/sports.js"&gt;&lt;/script&gt; &lt;!-- then value.js, draft.js, ui.js --&gt;

const data = await (await fetch("/fantasy-kit/data/mlb.json")).json();
const sport = FK.sports.attach({ ...FK.sports.mlb }, data);
FK.value.evaluate(sport, data.players, { teams: 12, scoring: "yoenis" });
const D = FK.draft.create({ sport, teams: 12, type: "snake", keepers });
FK.ui.room({ el, sport, players: data.players, draft: () =&gt; D,
  save: (D) =&gt; saveSomewhere(D), me: () =&gt; myTeamId, drive: true });</div></div>
      </div><aside class="stack">
        <div class="card pad"><h2>Brand it</h2><p class="small">Set these on :root after kit.css:</p><div class="code">--band: #13233A;   /* masthead, clock */
--brand: #F6C445;  /* fills */
--brand-ink: #1F1600;
--accent: #9A6A00; /* brand as text */</div></div>
        <div class="card pad"><h2>Custom rules</h2><p class="small">hooks.check(D, team, player) can refuse a pick (Hard Cap's salary line). hooks.worth(D, team, player, w) changes what bots want.</p></div>
        <div class="card pad"><h2>Data</h2><p class="small" style="margin:0">${["nba", "nfl", "mlb"].map((k) => `<b>${S[k].name}</b>: ${cache[k] ? `${cache[k].players.length} players, ${esc(cache[k].source)}` : "loads on first use"}`).join("<br>")}</p></div>
      </aside></div></div>`;
  }

  /* ---------- routing ---------- */
  async function route() {
    const r = U.route("draft");
    const tab = ["draft", "rankings", "kit", "home"].includes(r.tab) ? r.tab : "draft";
    header(tab === "home" ? "draft" : tab);
    if (tab !== "draft" && roomCtl) { roomCtl.stop(); roomCtl = null; }
    if (tab === "home") { app.onclick = app.oninput = app.onchange = null; return setupPage(); }
    if (tab === "draft") { app.onclick = app.oninput = app.onchange = null; return mock ? draftPage() : setupPage(); }
    if (tab === "rankings") return rankingsPage();
    return kitPage();
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
