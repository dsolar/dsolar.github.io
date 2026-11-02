/* Prospect: screens, the draft clock and the league home. Rules live in engine.js.
   The test league lives in this browser (localStorage). Real players, real 2026-27 salaries from Banner 19's
   cap sheet (../celtics/data.json), real box scores from ESPN (stats.json, refreshed every morning). */
(async function () {
  "use strict";
  const P = window.Prospect;
  const { C, CATS, money } = P;
  const KEY = "prospect-league-v1";
  const $ = (s) => document.querySelector(s);
  const app = $("#app");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let NBA, STATS, POOL, PROS, BY, PBY, L = null;
  const ui = { tab: "matchup", side: "board", q: "", pos: "", sort: "rank", fit: false, week: null, pair: null, team: null, speed: "normal", sim: false, paused: false, faQ: "" };
  let clockEnd = 0, botAt = 0, ghost = null;

  try {
    const [a, b] = await Promise.all([fetch("../celtics/data.json").then((r) => r.json()), fetch("stats.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}))]);
    NBA = a; STATS = b || {};
  } catch (e) {
    app.innerHTML = `<div class="wrap loading">The player list didn't load. Refresh the page to try again.</div>`;
    return;
  }
  POOL = P.buildPool(NBA, STATS);
  PROS = P.buildProspects(NBA);
  BY = Object.fromEntries(POOL.map((p) => [p.id, p]));
  PBY = Object.fromEntries(PROS.map((p) => [p.id, p]));
  const CEILING = NBA.cba.a1, NBA_CAP = NBA.cba.cap;
  const opener = STATS.opener || "2026-10-20";

  try { L = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { L = null; }
  if (L && L.v !== 1) L = null;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch (e) { /* private window: the league lasts this visit */ } };

  /* ---------- helpers ---------- */
  const season = (i) => `${2026 + i}-${String(27 + i).padStart(2, "0")}`;
  const fmtDate = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const last = (n) => { const parts = n.split(" "); const s = parts.pop(); return /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(s) ? parts.pop() + " " + s : s; };
  const curWeek = () => Math.min(L ? L.schedule.length : 21, P.weekOf(opener, new Date()));
  const yourTeam = () => L.teams[L.you];
  function toast(msg, bad) {
    const t = $("#toast"); t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200);
  }
  function contract(p) {
    const yrs = [p.sal, ...p.future];
    const thru = season(yrs.length - 1);
    const opts = Object.entries(p.opt || {}).map(([i, k]) => `<span class="pill opt" title="${{ PO: "Player option", TO: "Team option", NG: "Non-guaranteed" }[k] || k}">${esc(k)} ${season(+i).slice(2)}</span>`).join(" ");
    return `${yrs.length === 1 ? "Expires after this season" : `${yrs.length} years, through ${thru}`} ${opts}`;
  }
  function perGame(p) {
    const l = p.cur && p.cur[0] >= 3 ? p.cur : p.prev || p.cur;
    if (!l) return null;
    return { l, prev: l === p.prev, gp: l[C.gp] };
  }
  const pct = (m, a) => (a ? (m / a).toFixed(3).replace(/^0/, "") : "—");

  /* ---------- the cap bar ---------- */
  function capBar(team, opts = {}) {
    const ids = P.active(team);
    const pay = P.payroll(team, BY);
    const open = L.settings.roster - ids.length - (opts.ghost ? 1 : 0);
    const ctx = opts.ctx || P.context(L, POOL);
    const hold = open > 0 ? P.reserve(open, ctx.available, opts.ghost && opts.ghost.id) : 0;
    const scale = (v) => (v / CEILING) * 100;
    let html = ids.map((id) => BY[id]).sort((a, b) => b.sal - a.sal)
      .map((p) => `<div class="blk" style="flex:0 0 ${scale(p.sal)}%" title="${esc(p.n)}, ${money(p.sal)}">${scale(p.sal) > 6.5 ? `${esc(last(p.n))}<span>${money(p.sal)}</span>` : ""}</div>`).join("");
    if (opts.ghost) {
      const bad = pay + opts.ghost.sal + hold > CEILING;
      html += `<div class="blk ghost${bad ? " bad" : ""}" style="flex:0 0 ${Math.min(scale(opts.ghost.sal), 100)}%">${esc(last(opts.ghost.n))}<span>${money(opts.ghost.sal)}</span></div>`;
    }
    if (hold > 0) html += `<div class="blk hold" style="flex:0 0 ${scale(hold)}%" title="Held back for ${open} open spot${open === 1 ? "" : "s"} at the cheapest salaries left">${scale(hold) > 9 ? `${open} open<span>${money(hold)}</span>` : ""}</div>`;
    const after = pay + (opts.ghost ? opts.ghost.sal : 0);
    const room = CEILING - after - hold;
    const top = opts.mini ? "" : `<div class="capbar-top"><div><strong class="num">${money(after)}</strong> <span class="psub">of ${money(CEILING)} ceiling, ${ids.length + (opts.ghost ? 1 : 0)} of ${L.settings.roster} players</span></div>
      <div class="room ${room >= 0 ? "ok" : "bad"} num">${room >= 0 ? `${money(room)} to spend` : `${money(-room)} over`}${hold > 0 ? ` <span class="psub">after holding ${money(hold)} for ${open} spot${open === 1 ? "" : "s"}</span>` : ""}</div></div>`;
    return `<div class="capbar${opts.mini ? " mini" : ""}">${top}<div class="track" role="img" aria-label="Payroll ${money(after)} of ${money(CEILING)}"><div class="blocks">${html}</div>
      <div class="tick cap" style="left:${scale(NBA_CAP)}%"><label>NBA cap ${money(NBA_CAP)}</label></div><div class="tick ceil" style="left:100%"><label>Ceiling ${money(CEILING)}</label></div></div><div class="capbar-foot"></div></div>`;
  }

  /* ---------- masthead ---------- */
  function mast() {
    const nav = $("#mastNav"), meta = $("#mastMeta");
    if (!L) { nav.innerHTML = ""; meta.textContent = "Salary-cap dynasty basketball"; return; }
    meta.textContent = L.name;
    if (L.phase !== "league") {
      nav.innerHTML = `<button aria-current="page">${L.phase === "nba" ? "NBA draft" : "College draft"}</button><button data-tab="rules">Rules</button>`;
    } else {
      const tabs = [["matchup", "Matchup"], ["scores", "Scoreboard"], ["standings", "Standings"], ["teams", "Teams"], ["fa", "Free agents"], ["prospects", "Prospects"], ["activity", "Activity"], ["rules", "Rules"]];
      nav.innerHTML = tabs.map(([k, n]) => `<button data-tab="${k}"${ui.tab === k ? ' aria-current="page"' : ""}>${n}</button>`).join("");
    }
  }
  $("#mastNav").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    if (L.phase !== "league") { openRules(); return; }
    ui.tab = b.dataset.tab; ui.pair = null; render(); window.scrollTo(0, 0);
  });

  const RULES = [
    ["Real salaries", "Every player costs his actual NBA salary for the season, and it changes each offseason with his real contract."],
    ["One ceiling", `Your 12 NBA players must fit under ${money(CEILING)}, the NBA's first apron for 2026-27. No exceptions, no luxury tax, no dead money.`],
    ["Draft rule", "A pick only counts if you can still fill every open spot at the cheapest salaries left. The hatched part of your cap bar is that reserve."],
    ["Dynasty", "Keep your players year to year as long as the roster fits. Extensions kick in for real, so a cheap rookie deal can become a hard decision."],
    ["College draft", "A separate two-round draft for two prospect spots. Prospects are free until they sign their NBA deal and you promote them."],
    ["Free agents", `Everyone gets $${50} FAAB for the season. Blind bids, $1 minimum, highest bid wins and ties go to the team lower in the standings. Waivers run weekly; signings count from the next week.`],
    ["Releasing", "Drop a player and his salary comes off right away. His stats still count for you through the end of that week, and you can't claim him straight back."],
    ["Scoring", "Weekly head-to-head on nine categories: FG%, FT%, 3PM, PTS, REB, AST, STL, BLK and TO. Each category is a win, loss or tie in the standings. All 12 NBA players count."],
    ["Game Score", "Each week also shows Hollinger's Game Score for every player and team, as a catch-all number. It breaks standings ties but doesn't decide matchups."],
  ];
  const rulesList = () => `<ul class="rules">${RULES.map(([a, b]) => `<li><b>${a}</b><span>${b}</span></li>`).join("")}</ul>`;
  function openRules() {
    dlg(`<h3>How Prospect works</h3><div style="max-height:60vh;overflow:auto;margin-top:10px">${rulesList()}</div><div class="acts" style="margin-top:14px"><button class="btn" data-close>Close</button></div>`);
  }

  /* ---------- dialog ---------- */
  const D = $("#dlg");
  function dlg(html, onSubmit) {
    D.innerHTML = html;
    D.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => D.close()));
    const f = D.querySelector("form");
    if (f && onSubmit) f.addEventListener("submit", (e) => { e.preventDefault(); if (onSubmit(new FormData(f)) !== false) D.close(); });
    D.showModal();
  }

  /* ---------- setup ---------- */
  function sampleTeam() {
    const ids = ["nikola-jokic", "cooper-flagg", "derrick-white", "jalen-johnson", "payton-pritchard"].filter((id) => BY[id]);
    return { hist: ids.map((pid) => ({ pid, from: 1, to: null })) };
  }
  function renderSetup() {
    const fake = L;
    L = { settings: { roster: 12 }, teams: [], schedule: [] };
    const bar = capBar(sampleTeam());
    L = fake;
    app.innerHTML = `<div class="wrap">
      <section class="hero">
        <h1><span>Build a franchise.</span><span>Find your future.</span></h1>
        <p>A dynasty league where you draft the player and his contract. Every NBA player costs his real salary, your 12 have to fit under one hard ceiling, and two prospect spots let you stash tomorrow's stars while they're still in college.</p>
        ${bar}
      </section>
      <section class="setup">
        <form class="panel form" id="setupForm">
          <div><h2>Start a test league</h2><p style="margin:0;color:var(--muted)">You draft against bots with every real player and his 2026-27 salary. When the draft ends, your league home scores every week so far from real box scores.</p></div>
          <div class="row2">
            <div class="field"><label for="lname">League name</label><input id="lname" name="lname" value="Prospect League" maxlength="40"></div>
            <div class="field"><label for="tname">Your team</label><input id="tname" name="tname" value="Needham Nightshift" maxlength="28"></div>
          </div>
          <div class="field"><span class="lab">Managers</span><div class="seg" role="group" aria-label="Managers">${[8, 10, 12].map((n) => `<button type="button" data-n="${n}" aria-pressed="${n === 10}">${n}</button>`).join("")}</div></div>
          <div class="row2">
            <div class="field"><label for="slot">Your draft slot</label><select id="slot" name="slot"><option value="r">Random</option>${[...Array(12)].map((_, i) => `<option value="${i}">${i + 1}</option>`).join("")}</select></div>
            <div class="field"><label for="clock">Pick clock</label><select id="clock" name="clock"><option value="30">30 seconds</option><option value="60" selected>60 seconds</option><option value="90">90 seconds</option></select></div>
          </div>
          <div><button class="btn go" type="submit">Open the draft room</button></div>
        </form>
        <div class="panel"><h2>The rules</h2><p>Kept short on purpose. The strategy comes from picking players, not learning a contract simulator.</p>${rulesList()}</div>
      </section></div>`;
    let teams = 10;
    const f = $("#setupForm");
    f.querySelectorAll("[data-n]").forEach((b) => b.addEventListener("click", () => {
      teams = +b.dataset.n;
      f.querySelectorAll("[data-n]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      [...f.slot.options].forEach((o) => (o.hidden = o.value !== "r" && +o.value >= teams));
      if (f.slot.value !== "r" && +f.slot.value >= teams) f.slot.value = "r";
    }));
    [...f.slot.options].forEach((o) => (o.hidden = o.value !== "r" && +o.value >= teams));
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = f.tname.value.trim() || "Your team";
      L = P.newLeague({
        ceiling: CEILING, name: f.lname.value.trim() || "Prospect League", yourName: name,
        yourAbbr: name.replace(/[^A-Za-z ]/g, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase() || "YOU",
        yourSlot: f.slot.value === "r" ? null : +f.slot.value,
        settings: { teams, clock: +f.clock.value },
      });
      save(); startClock(); render(); window.scrollTo(0, 0);
    });
  }

  /* ---------- draft room ---------- */
  function startClock() {
    clockEnd = Date.now() + L.settings.clock * 1000;
    botAt = Date.now() + (ui.sim ? 0 : ui.speed === "fast" ? 250 : 1100);
  }
  function lineCells(p) {
    const g = perGame(p);
    if (!g) return `<td class="r psub" colspan="9">No NBA games yet</td>`;
    const l = g.l, n = g.gp;
    const v = (k, d = 1) => (l[C[k]]).toFixed(d);
    return `<td class="r num">${v("pts")}</td><td class="r num">${v("reb")}</td><td class="r num">${v("ast")}</td><td class="r num hide-s">${v("tpm")}</td>
      <td class="r num hide-s">${v("stl")}</td><td class="r num hide-s">${v("blk")}</td><td class="r num hide-m">${pct(l[C.fgm], l[C.fga])}</td>
      <td class="r num hide-m">${pct(l[C.ftm], l[C.fta])}</td><td class="r num hide-m">${v("tov")}</td>`;
  }
  const LINE_HEAD = `<th class="r">PTS</th><th class="r">REB</th><th class="r">AST</th><th class="r hide-s">3PM</th><th class="r hide-s">STL</th><th class="r hide-s">BLK</th><th class="r hide-m">FG%</th><th class="r hide-m">FT%</th><th class="r hide-m">TO</th>`;

  function renderDraft() {
    const clock = P.onClock(L);
    const team = L.teams[clock.team];
    const mine = team.human;
    const college = L.phase === "college";
    app.innerHTML = `<div class="clockbar"><div class="wrap">
        <div class="onclock"><span class="who${mine ? " you" : ""}">${mine ? "You're on the clock" : esc(team.name)}</span>
          <span class="pk">${college ? "College draft" : "NBA draft"}, round ${clock.round}, pick ${clock.inRound} (${clock.pick} of ${clock.total})</span></div>
        <span class="grow"></span>
        <span class="timer" id="timer" aria-live="off"></span>
        <button class="btn small" id="pause">${ui.paused ? "Resume" : "Pause"}</button>
        <button class="btn small" id="speed">${ui.speed === "fast" ? "Bots: fast" : "Bots: normal"}</button>
        ${mine ? `<button class="btn small go" id="autoMe">Autopick for me</button>` : `<button class="btn small go" id="simMe">Sim to my pick</button>`}
      </div></div>
      <div class="wrap">
        ${college ? "" : `<div class="mycap" id="mycap">${capBar(yourTeam(), { ghost })}</div>`}
        <div class="room-grid">
          <section aria-label="${college ? "Prospects" : "Players"}">${college ? collegePool() : nbaPoolShell()}</section>
          <aside class="side">${sidePanel()}</aside>
        </div>
      </div>`;
    if (!college) { wirePool(); drawPool(); }
    else app.querySelectorAll("[data-cpick]").forEach((b) => b.addEventListener("click", () => pickCollege(b.dataset.cpick)));
    $("#pause").onclick = () => { ui.paused = !ui.paused; if (!ui.paused) { clockEnd = Date.now() + Math.max(5, Math.ceil((clockEnd - pauseAt) / 1000)) * 1000; } else pauseAt = Date.now(); render(); };
    $("#speed").onclick = () => { ui.speed = ui.speed === "fast" ? "normal" : "fast"; render(); };
    if ($("#simMe")) $("#simMe").onclick = () => { ui.sim = true; botAt = 0; };
    if ($("#autoMe")) $("#autoMe").onclick = () => autoMine();
    app.querySelectorAll("[data-side]").forEach((b) => b.addEventListener("click", () => { ui.side = b.dataset.side; $(".side").innerHTML = sidePanel(); wireSide(); }));
    wireSide();
    tickTimer();
  }
  let pauseAt = 0;

  function nbaPoolShell() {
    return `<div class="tools">
        <label class="sr" for="q">Search players</label><input type="search" id="q" placeholder="Search players or teams" value="${esc(ui.q)}" autocomplete="off">
        <label class="sr" for="pos">Position</label><select id="pos"><option value="">All positions</option>${["G", "W", "B"].map((x) => `<option value="${x}"${ui.pos === x ? " selected" : ""}>${{ G: "Guards", W: "Wings", B: "Bigs" }[x]}</option>`).join("")}</select>
        <label class="sr" for="sort">Sort</label><select id="sort">${[["rank", "Nine-cat rank"], ["value", "Value per dollar"], ["sal", "Salary, high to low"], ["cheap", "Salary, low to high"]].map(([k, n]) => `<option value="${k}"${ui.sort === k ? " selected" : ""}>${n}</option>`).join("")}</select>
        <label class="psub" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fit"${ui.fit ? " checked" : ""}> Only players I can fit</label>
      </div><div class="scroll" id="poolWrap"></div>
      <p class="psub" style="margin-top:8px">Per-game lines are this season once a player has three games, otherwise 2025-26 (marked). Rank blends both seasons on the nine categories.</p>`;
  }
  function wirePool() {
    $("#q").addEventListener("input", (e) => { ui.q = e.target.value; drawPool(); });
    $("#pos").addEventListener("change", (e) => { ui.pos = e.target.value; drawPool(); });
    $("#sort").addEventListener("change", (e) => { ui.sort = e.target.value; drawPool(); });
    $("#fit").addEventListener("change", (e) => { ui.fit = e.target.checked; drawPool(); });
  }
  function drawPool() {
    const wrap = $("#poolWrap");
    if (!wrap) return;
    const ctx = P.context(L, POOL);
    const me = yourTeam();
    const clock = P.onClock(L);
    const myTurn = clock && L.teams[clock.team].human;
    const q = ui.q.trim().toLowerCase();
    let rows = ctx.available.filter((p) => (!q || p.n.toLowerCase().includes(q) || p.t.toLowerCase() === q) && (!ui.pos || p.pos === ui.pos));
    const sorts = { rank: (a, b) => a.rank - b.rank, sal: (a, b) => b.sal - a.sal, cheap: (a, b) => a.sal - b.sal, value: (a, b) => (b.z + 4) / Math.sqrt(b.sal) - (a.z + 4) / Math.sqrt(a.sal) };
    rows.sort(sorts[ui.sort]);
    const checked = rows.map((p) => ({ p, c: P.check(L, me, p, ctx) }));
    const shown = (ui.fit ? checked.filter((x) => x.c.ok) : checked).slice(0, 160);
    wrap.innerHTML = `<table class="table"><thead><tr><th class="r">Rk</th><th>Player</th><th class="r">Salary</th>${LINE_HEAD}<th></th></tr></thead><tbody>
      ${shown.map(({ p, c }) => {
        const g = perGame(p);
        return `<tr data-pid="${p.id}" class="${c.ok ? "" : "dim"}">
          <td class="r num psub">${p.rank}</td>
          <td><div class="pname">${esc(p.n)}</div><div class="psub">${p.t}, ${p.ps.join("/") || p.pos}, ${p.age}${g && g.prev ? ", 2025-26 line" : ""}</div>${c.ok ? "" : `<div class="why">${esc(c.why)}</div>`}</td>
          <td class="r"><div class="sal num">${money(p.sal)}</div><div class="psub">${p.future.length ? `+${p.future.length} yr` : "expiring"}</div></td>
          ${lineCells(p)}
          <td class="r"><button class="btn small${c.ok && myTurn ? " go" : ""}" data-pick="${p.id}" ${c.ok && myTurn ? "" : "disabled"}>Draft</button></td></tr>`;
      }).join("") || `<tr><td colspan="13" class="empty">No one matches. Clear the search or the filters.</td></tr>`}
      </tbody></table>`;
    wrap.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => pickNba(b.dataset.pick)));
    wrap.querySelectorAll("tr[data-pid]").forEach((tr) => {
      tr.addEventListener("mouseenter", () => { ghost = BY[tr.dataset.pid]; drawCap(ctx); });
      tr.addEventListener("focusin", () => { ghost = BY[tr.dataset.pid]; drawCap(ctx); });
    });
    wrap.onmouseleave = () => { ghost = null; drawCap(ctx); };
  }
  function drawCap(ctx) { const el = $("#mycap"); if (el) el.innerHTML = capBar(yourTeam(), { ghost, ctx }); }

  function collegePool() {
    const taken = new Set(L.college.picks.map((x) => x.pid));
    const clock = P.onClock(L);
    const myTurn = clock && L.teams[clock.team].human;
    const mine = yourTeam().prospects.map((id) => PBY[id]);
    return `<div class="card" style="margin-bottom:12px"><h3>Your prospect spots</h3>${mine.length ? mine.map((p) => `<div class="pname">${esc(p.n)} <span class="psub">${esc(p.school)}, ${p.pos}</span></div>`).join("") : `<p class="psub" style="margin:0">Two open. Prospects cost nothing until they sign their NBA deal.</p>`}</div>
      <div class="scroll"><table class="table"><thead><tr><th class="r">Big board</th><th>Prospect</th><th>School</th><th class="r">Age</th><th></th></tr></thead><tbody>
      ${PROS.filter((p) => !taken.has(p.id)).map((p) => `<tr><td class="r num psub">${p.rank}</td><td><div class="pname">${esc(p.n)}</div><div class="psub">${p.pos}</div></td><td>${esc(p.school)}</td><td class="r num">${p.age.toFixed(1)}</td>
        <td class="r"><button class="btn small${myTurn ? " go" : ""}" data-cpick="${p.id}" ${myTurn ? "" : "disabled"}>Draft</button></td></tr>`).join("")}
      </tbody></table></div><p class="psub" style="margin-top:8px">The 2027 NBA draft class, ranked on a consensus big board.</p>`;
  }

  function sidePanel() {
    const college = L.phase === "college";
    const d = college ? L.college : L.nba;
    const tabs = `<div class="tabs" role="group" aria-label="Draft views">${[["board", "Board"], ["picks", "Recent picks"], ["mine", "My roster"]].map(([k, n]) => `<button data-side="${k}" aria-pressed="${ui.side === k}">${n}</button>`).join("")}</div>`;
    let body = "";
    const name = (pid) => (college ? PBY[pid].n : BY[pid].n);
    if (ui.side === "picks") {
      body = d.picks.length ? `<ol class="picks" reversed>${d.picks.slice().reverse().slice(0, 60).map((pk, i) => {
        const n = d.picks.length - i, t = L.teams[pk.team];
        return `<li class="${t.human ? "you" : ""}"><span class="no num">${n}</span><span><b>${esc(name(pk.pid))}</b><br><span class="psub">${esc(t.name)}</span></span><span class="sal num">${college ? "" : money(BY[pk.pid].sal)}</span></li>`;
      }).join("")}</ol>` : `<p class="empty">No picks yet.</p>`;
    } else if (ui.side === "mine") {
      const me = yourTeam();
      const ids = college ? me.prospects : P.active(me);
      body = ids.length ? `<ol class="picks">${ids.map((id) => `<li class="you"><span class="no">${college ? PBY[id].pos : BY[id].pos}</span><span><b>${esc(name(id))}</b><br><span class="psub">${college ? esc(PBY[id].school) : `${BY[id].t}, ${contract(BY[id])}`}</span></span><span class="sal num">${college ? "" : money(BY[id].sal)}</span></li>`).join("")}</ol>` : `<p class="empty">Your picks show up here.</p>`;
    } else {
      const n = L.teams.length, rounds = d.order.length / n;
      const at = (r, ti) => { const k = r * n + (r % 2 ? n - 1 - ti : ti); return { k, pk: d.picks[k] }; };
      body = `<div class="board"><table><thead><tr><th></th>${L.teams.map((t) => `<th title="${esc(t.name)}">${esc(t.abbr)}</th>`).join("")}</tr></thead><tbody>
        ${[...Array(rounds)].map((_, r) => `<tr><th>${r + 1}</th>${L.teams.map((t, ti) => {
          const { k, pk } = at(r, ti);
          const cls = [pk ? "f" : "", t.human ? "you" : "", k === d.picks.length ? "now" : ""].join(" ");
          return `<td class="${cls}">${pk ? `<b>${esc(last(name(pk.pid)))}</b><small>${college ? PBY[pk.pid].pos : money(BY[pk.pid].sal)}</small>` : `<small>${k + 1}</small>`}</td>`;
        }).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    return `<div class="card">${tabs}${body}</div>`;
  }
  function wireSide() {
    app.querySelectorAll("[data-side]").forEach((b) => (b.onclick = () => { ui.side = b.dataset.side; $(".side").innerHTML = sidePanel(); wireSide(); }));
  }

  function afterPick() {
    save();
    ghost = null;
    if (L.phase === "league") {
      ui.tab = "matchup"; ui.sim = false;
      toast("Draft complete. Welcome to your league.");
      render(); window.scrollTo(0, 0); return;
    }
    const clock = P.onClock(L);
    if (clock && L.teams[clock.team].human) ui.sim = false;
    startClock(); render();
  }
  function pickNba(pid, auto) {
    const r = P.draftNba(L, POOL, pid, auto);
    if (!r.ok) { toast(r.why, true); return; }
    if (!auto) toast(`You drafted ${BY[pid].n} at ${money(BY[pid].sal)}.`);
    afterPick();
  }
  function pickCollege(pid, auto) {
    const r = P.draftCollege(L, PROS, pid, auto);
    if (!r.ok) { toast(r.why, true); return; }
    if (!auto) toast(`You drafted ${PBY[pid].n}.`);
    afterPick();
  }
  function autoMine() {
    const rr = P.rng(L.seed + 1000 + L.nba.picks.length + L.college.picks.length);
    if (L.phase === "nba") {
      const me = yourTeam(), style = me.style; me.style = "balanced";
      const p = P.autoPick(L, POOL, rr); me.style = style;
      if (p) { toast(`Autopick: ${p.n} at ${money(p.sal)}.`); pickNba(p.id, true); }
    } else { const p = P.autoPickCollege(L, PROS, rr); if (p) { toast(`Autopick: ${p.n}.`); pickCollege(p.id, true); } }
  }
  function tickTimer() {
    const el = $("#timer");
    if (!el || !L || (L.phase !== "nba" && L.phase !== "college")) return;
    const clock = P.onClock(L);
    const mine = L.teams[clock.team].human;
    const now = ui.paused ? pauseAt : Date.now();
    const left = Math.max(0, Math.ceil((clockEnd - now) / 1000));
    el.textContent = mine ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "";
    el.className = "timer" + (mine && left <= 10 ? " hot" : "");
  }
  setInterval(() => {
    if (!L || (L.phase !== "nba" && L.phase !== "college") || ui.paused || D.open) return;
    const clock = P.onClock(L);
    if (!clock) return;
    const team = L.teams[clock.team];
    if (team.human) {
      tickTimer();
      if (Date.now() >= clockEnd) autoMine();
      return;
    }
    if (Date.now() < botAt) return;
    const rr = P.rng(L.seed + L.nba.picks.length * 31 + L.college.picks.length * 7 + 3);
    if (L.phase === "nba") { const p = P.autoPick(L, POOL, rr); if (p) pickNba(p.id, true); }
    else { const p = P.autoPickCollege(L, PROS, rr); if (p) pickCollege(p.id, true); }
  }, 120);

  /* ---------- league home ---------- */
  function weekLabel(w) {
    const [a, b] = P.weekDates(opener, w);
    return `${fmtDate(a)} to ${fmtDate(b)}`;
  }
  function renderLeague() {
    const cw = curWeek();
    const updated = STATS.updated ? new Date(STATS.updated) : null;
    const st = P.standings(L, cw - 1, STATS.wk);
    const myRow = st.find((r) => r.id === L.you);
    const head = `<div class="weekbar"><h1>Week ${cw}</h1><span class="psub">${weekLabel(cw)}</span><span class="grow"></span>
      <span class="src">${esc(yourTeam().name)}: ${myRow.w}-${myRow.l}-${myRow.t} in categories, ${ordinal(st.indexOf(myRow) + 1)} place${updated ? `. Box scores through ${fmtDate(new Date(updated.getTime() - 864e5))}, ESPN` : ""}</span></div>
      <p class="note">Test league: every roster counts from opening night (${fmtDate(new Date(opener + "T12:00:00"))}), so the weeks already played are scored from real box scores as if you'd drafted before the season.</p>`;
    const views = { matchup: viewMatchup, scores: viewScores, standings: viewStandings, teams: viewTeams, fa: viewFA, prospects: viewProspects, activity: viewActivity, rules: viewRules };
    app.innerHTML = `<div class="wrap">${head}<div class="lg" id="lg">${views[ui.tab]()}</div></div>`;
    wireLeague();
  }
  const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]);

  function fmtCat(c, v) {
    if (v == null) return "—";
    return c.pct ? v.toFixed(3).replace(/^0/, "") : Math.round(v);
  }
  function viewMatchup() {
    const cw = curWeek();
    const w = Math.min(ui.week || defaultWeek(), L.schedule.length);
    const ms = P.matchups(L, w, STATS.wk);
    const m = ui.pair != null ? ms[ui.pair] : ms.find((x) => x.a === L.you || x.b === L.you);
    const A = L.teams[m.a], B = L.teams[m.b];
    const live = w === cw, future = w > cw || !(STATS.wk && STATS.wk[String(w)]);
    const status = w < cw ? "Final" : live ? "In progress" : "Not started";
    const nav = `<div class="tools"><button class="btn small" data-wk="${w - 1}" ${w <= 1 ? "disabled" : ""}>Previous week</button>
      <strong>Week ${w}</strong><span class="psub">${weekLabel(w)}, ${status.toLowerCase()}</span>
      <button class="btn small" data-wk="${w + 1}" ${w >= L.schedule.length ? "disabled" : ""}>Next week</button></div>`;
    const c = m.cmp;
    const card = `<section class="card">${nav}
      <div class="versus"><div class="tm"><b>${esc(A.name)}</b><span class="psub">Game Score ${m.A.t.gmsc.toFixed(1)}</span></div>
        <div class="score">${future && !m.A.t.gp ? "0-0" : `${c.w}-${c.l}${c.t ? "-" + c.t : ""}`}<small>${status}</small></div>
        <div class="tm b"><b>${esc(B.name)}</b><span class="psub">Game Score ${m.B.t.gmsc.toFixed(1)}</span></div></div>
      <div class="cats">${c.cats.map((x) => `<div class="cat ${x.out === "w" ? "w-a" : x.out === "l" ? "w-b" : ""}"><span class="k">${x.cat.label}</span>
        <span class="v ${x.out === "w" ? "w" : x.out === "l" ? "l" : ""}">${fmtCat(x.cat, x.a)}</span><span class="v ${x.out === "l" ? "w" : x.out === "w" ? "l" : ""}">${fmtCat(x.cat, x.b)}</span></div>`).join("")}</div>
      ${future && !m.A.t.gp && !m.B.t.gp ? `<p class="empty">No games final yet this week. Scores fill in each morning.</p>` : ""}</section>`;
    return card + boxTable(A, m.A, w) + boxTable(B, m.B, w);
  }
  function boxTable(team, tw, w) {
    const rows = tw.per.map((x) => ({ ...x, p: BY[x.pid] })).sort((a, b) => b.gmsc - a.gmsc);
    const v = (l, k) => (l ? Math.round(l[C[k]]) : 0);
    return `<section class="card"><h3>${esc(team.name)}</h3><div style="overflow:auto"><table class="table" style="border:0"><thead><tr><th>Player</th><th class="r">GP</th><th class="r">PTS</th><th class="r">REB</th><th class="r">AST</th><th class="r hide-s">3PM</th><th class="r hide-s">STL</th><th class="r hide-s">BLK</th><th class="r hide-m">FG</th><th class="r hide-m">FT</th><th class="r hide-m">TO</th><th class="r">GmSc</th></tr></thead><tbody>
      ${rows.map((x) => `<tr><td><div class="pname">${esc(x.p ? x.p.n : x.pid)}</div><div class="psub">${x.p ? `${x.p.t}, ${money(x.p.sal)}` : ""}</div></td><td class="r num">${x.gp}</td>
        <td class="r num">${v(x.line, "pts")}</td><td class="r num">${v(x.line, "reb")}</td><td class="r num">${v(x.line, "ast")}</td><td class="r num hide-s">${v(x.line, "tpm")}</td><td class="r num hide-s">${v(x.line, "stl")}</td><td class="r num hide-s">${v(x.line, "blk")}</td>
        <td class="r num hide-m">${x.line ? `${v(x.line, "fgm")}-${v(x.line, "fga")}` : "—"}</td><td class="r num hide-m">${x.line ? `${v(x.line, "ftm")}-${v(x.line, "fta")}` : "—"}</td><td class="r num hide-m">${v(x.line, "tov")}</td><td class="r num"><b>${x.gmsc.toFixed(1)}</b></td></tr>`).join("")}
      </tbody></table></div></section>`;
  }
  // Before the first game of a new week is final, the last finished week is the one worth looking at.
  function defaultWeek() {
    const cw = curWeek();
    if (STATS.wk && STATS.wk[String(cw)]) return cw;
    const done = Object.keys(STATS.wk || {}).map(Number).filter((w) => w < cw);
    return done.length ? Math.max(...done) : cw;
  }
  function viewScores() {
    const w = Math.min(ui.week || defaultWeek(), L.schedule.length);
    const ms = P.matchups(L, w, STATS.wk);
    return `<section><div class="tools"><button class="btn small" data-wk="${w - 1}" ${w <= 1 ? "disabled" : ""}>Previous week</button><strong>Week ${w}</strong><span class="psub">${weekLabel(w)}</span><button class="btn small" data-wk="${w + 1}" ${w >= L.schedule.length ? "disabled" : ""}>Next week</button></div>
      <div class="slate">${ms.map((m, i) => {
        const A = L.teams[m.a], B = L.teams[m.b], c = m.cmp, lead = c.w >= c.l;
        return `<button class="game${A.human || B.human ? " you" : ""}" data-pair="${i}">
          <span class="ln ${lead ? "lead" : "trail"}"><span>${esc(A.name)}</span><span class="num">${c.w}</span></span>
          <span class="ln ${c.l >= c.w ? "lead" : "trail"}"><span>${esc(B.name)}</span><span class="num">${c.l}</span></span>
          <span class="psub">Game Score ${m.A.t.gmsc.toFixed(0)} to ${m.B.t.gmsc.toFixed(0)}${c.t ? `, ${c.t} tied` : ""}</span></button>`;
      }).join("")}</div></section>`;
  }
  function viewStandings() {
    const cw = curWeek();
    const st = P.standings(L, cw - 1, STATS.wk);
    const done = Math.max(0, Math.min(cw - 1, Object.keys(STATS.wk || {}).length));
    return `<section><p class="psub" style="margin-top:0">${done} week${done === 1 ? "" : "s"} final. Category record decides the standings; Game Score breaks ties. Top ${L.settings.playoffTeams} make the playoffs after week ${L.settings.regWeeks}.</p>
      <div style="overflow:auto"><table class="table"><thead><tr><th class="r">#</th><th>Team</th><th class="r">Categories</th><th class="r">Pct</th><th class="r hide-s">Matchups</th><th class="r hide-s">Game Score</th><th class="hide-m">Recent</th><th class="r">Payroll</th><th class="r hide-s">FAAB</th></tr></thead><tbody>
      ${st.map((r, i) => { const t = L.teams[r.id]; return `<tr class="${t.human ? "hl" : ""}${i === L.settings.playoffTeams - 1 ? " cut" : ""}"><td class="r num">${i + 1}</td><td><button class="btn small" style="border:0;background:none;padding:0;min-height:0;font-weight:700" data-team="${t.id}">${esc(t.name)}</button></td>
        <td class="r num">${r.w}-${r.l}-${r.t}</td><td class="r num">${r.pct.toFixed(3).replace(/^0/, "")}</td><td class="r num hide-s">${r.mw}-${r.ml}${r.mt ? "-" + r.mt : ""}</td><td class="r num hide-s">${r.gmsc.toFixed(0)}</td>
        <td class="hide-m">${r.pf.slice(-5).map((x) => `<span class="pill ${x === "W" ? "w" : x === "L" ? "l" : ""}">${x}</span>`).join(" ")}</td>
        <td class="r num">${money(P.payroll(t, BY))}</td><td class="r num hide-s">$${t.faab}</td></tr>`; }).join("")}
      </tbody></table></div></section>`;
  }
  function seasonLine(pid) {
    const tot = Array(P.COLS.length).fill(0);
    for (const wk of Object.values(STATS.wk || {})) { const l = wk[pid]; if (l) l.forEach((v, i) => (tot[i] += v)); }
    return tot[0] ? tot : null;
  }
  function viewTeams() {
    const t = L.teams[ui.team != null ? ui.team : L.you];
    const ids = P.active(t).map((id) => BY[id]).sort((a, b) => b.sal - a.sal);
    const rows = ids.map((p) => {
      const s = seasonLine(p.id), g = s ? s[0] : 0;
      const pg = (k) => (g ? (s[C[k]] / g).toFixed(1) : "—");
      return `<tr><td><div class="pname">${esc(p.n)}</div><div class="psub">${p.t}, ${p.ps.join("/") || p.pos}, ${p.age}</div></td>
        <td class="r"><div class="sal num">${money(p.sal)}</div></td><td class="hide-s psub">${contract(p)}${p.future.length ? `<div>${p.future.map((x, i) => `${season(i + 1).slice(2)}: ${money(x)}`).join(", ")}</div>` : ""}</td>
        <td class="r num">${g}</td><td class="r num">${pg("pts")}</td><td class="r num">${pg("reb")}</td><td class="r num">${pg("ast")}</td><td class="r num hide-m">${s ? pct(s[C.fgm], s[C.fga]) : "—"}</td><td class="r num">${s ? P.gameScore(s).toFixed(0) : "—"}</td>
        ${t.human ? `<td class="r"><button class="btn small" data-drop="${p.id}">Release</button></td>` : ""}</tr>`;
    }).join("");
    return `<section><div class="teampick">${L.teams.map((x) => `<button class="btn small${x.id === t.id ? " go" : ""}" data-team="${x.id}">${esc(x.abbr)}</button>`).join("")}</div>
      <div class="card"><h3>${esc(t.name)}${t.human ? " (you)" : ""}</h3>${capBar(t)}<p class="psub" style="margin:0">FAAB left: $${t.faab} of $${L.settings.faab}</p></div></section>
      <section><div style="overflow:auto"><table class="table"><thead><tr><th>Player</th><th class="r">2026-27</th><th class="hide-s">Contract</th><th class="r">GP</th><th class="r">PTS</th><th class="r">REB</th><th class="r">AST</th><th class="r hide-m">FG%</th><th class="r">GmSc</th>${t.human ? "<th></th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="psub">Season lines are from this league's scoring weeks. GmSc is the season total.</p></section>
      <section class="card"><h3>Prospect rights</h3>${t.prospects.length ? t.prospects.map((id) => `<div class="pname">${esc(PBY[id].n)} <span class="psub">${esc(PBY[id].school)}, ${PBY[id].pos}, big board ${PBY[id].rank}</span></div>`).join("") : `<p class="empty">No prospects.</p>`}</section>`;
  }
  function viewFA() {
    const ctx = P.context(L, POOL);
    const me = yourTeam();
    const q = ui.faQ.trim().toLowerCase();
    const rows = ctx.available.filter((p) => !q || p.n.toLowerCase().includes(q) || p.t.toLowerCase() === q).sort((a, b) => a.rank - b.rank).slice(0, 120);
    const mine = L.bids.filter((b) => b.team === L.you);
    const pending = mine.reduce((s, b) => s + b.amount, 0);
    return `<section class="card"><h3>Waivers</h3>
      <p class="psub" style="margin-top:0">You have $${me.faab} FAAB, $${me.faab - pending} not tied up in bids. ${capRoom(me)}. Waivers run once a week; signings count from week ${curWeek() + 1}. In this test you can run them now.</p>
      ${mine.length ? `<ul class="log">${mine.map((b, i) => `<li><span><b>$${b.amount}</b> on ${esc(BY[b.add].n)} (${money(BY[b.add].sal)})${b.drop ? `, releasing ${esc(BY[b.drop].n)}` : ""}</span><span class="grow"></span><button class="btn small" data-unbid="${i}">Cancel</button></li>`).join("")}</ul>` : `<p class="empty" style="padding:0 0 8px">No bids yet.</p>`}
      <button class="btn go" id="runWaivers">Run waivers now</button></section>
      <section><div class="tools"><label class="sr" for="faq">Search free agents</label><input type="search" id="faq" placeholder="Search free agents" value="${esc(ui.faQ)}"></div>
      <div class="scroll"><table class="table"><thead><tr><th class="r">Rk</th><th>Player</th><th class="r">Salary</th>${LINE_HEAD}<th></th></tr></thead><tbody>
      ${rows.map((p) => { const g = perGame(p); return `<tr><td class="r num psub">${p.rank}</td><td><div class="pname">${esc(p.n)}</div><div class="psub">${p.t}, ${p.ps.join("/") || p.pos}, ${p.age}${g && g.prev ? ", 2025-26 line" : ""}</div></td>
        <td class="r"><div class="sal num">${money(p.sal)}</div></td>${lineCells(p)}<td class="r"><button class="btn small go" data-bid="${p.id}">Bid</button></td></tr>`; }).join("")}
      </tbody></table></div></section>`;
  }
  function capRoom(t) { const room = CEILING - P.payroll(t, BY); return `${money(room)} under the ceiling with ${P.active(t).length} players`; }
  function bidDialog(pid) {
    const p = BY[pid], me = yourTeam();
    const full = P.active(me).length >= L.settings.roster;
    const opts = P.active(me).map((id) => BY[id]).sort((a, b) => a.z - b.z);
    dlg(`<h3>Bid on ${esc(p.n)}</h3><p class="psub" style="margin:0">${money(p.sal)} salary, ${contract(p)}</p>
      <form class="form"><div class="field"><label for="amt">FAAB bid (you have $${me.faab})</label><input id="amt" name="amt" type="number" min="1" max="${me.faab}" value="1" required></div>
      <div class="field"><label for="drop">Release${full ? "" : " (optional)"}</label><select id="drop" name="drop">${full ? "" : `<option value="">Nobody, I have an open spot</option>`}${opts.map((x) => `<option value="${x.id}">${esc(x.n)}, ${money(x.sal)}</option>`).join("")}</select></div>
      <p class="psub" id="fitMsg" style="margin:0"></p>
      <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go" type="submit">Place bid</button></div></form>`, (fd) => {
      const r = P.placeBid(L, POOL, L.you, pid, fd.get("drop") || null, +fd.get("amt"), curWeek());
      if (!r.ok) { $("#fitMsg").textContent = r.why; $("#fitMsg").style.color = "var(--foul)"; return false; }
      save(); toast(`Bid placed: $${fd.get("amt")} on ${p.n}.`); render();
    });
    const upd = () => { const d = D.querySelector("#drop").value; const c = P.check(L, me, p, P.context(L, POOL), { drop: d || null, noReserve: true });
      D.querySelector("#fitMsg").textContent = c.ok ? `Fits: payroll would be ${money(c.after)}.` : c.why; D.querySelector("#fitMsg").style.color = c.ok ? "var(--go)" : "var(--foul)"; };
    // Start on the weakest player whose release actually makes room for this contract.
    const ctx0 = P.context(L, POOL);
    const fits = opts.find((x) => P.check(L, me, p, ctx0, { drop: x.id, noReserve: true }).ok);
    if (!P.check(L, me, p, ctx0, { noReserve: true }).ok && fits) D.querySelector("#drop").value = fits.id;
    D.querySelector("#drop").addEventListener("change", upd); upd();
    if (!fits && !P.check(L, me, p, ctx0, { noReserve: true }).ok) D.querySelector("#fitMsg").textContent = `No single release makes room for ${money(p.sal)}. Clear salary first.`;
  }
  function viewProspects() {
    return `<section class="card"><h3>College rights</h3><div style="overflow:auto"><table class="table" style="border:0"><thead><tr><th>Team</th><th>Prospects</th></tr></thead><tbody>
      ${L.teams.map((t) => `<tr class="${t.human ? "hl" : ""}"><td class="pname">${esc(t.name)}</td><td>${t.prospects.map((id) => `<div>${esc(PBY[id].n)} <span class="psub">${esc(PBY[id].school)}, ${PBY[id].pos}, big board ${PBY[id].rank}</span></div>`).join("")}</td></tr>`).join("")}
      </tbody></table></div><p class="psub">Prospects join your NBA roster when they sign their rookie deal next summer. Their salary counts from then, so leave room.</p></section>`;
  }
  function viewActivity() {
    const items = L.log.slice().reverse();
    return `<section class="card"><h3>League activity</h3>${items.length ? `<ul class="log">${items.map((x) => `<li><time>${new Date(x.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time><span>${esc(x.text)}</span></li>`).join("")}</ul>` : `<p class="empty">Nothing yet.</p>`}</section>`;
  }
  function viewRules() {
    return `<section class="panel"><h2>Rules</h2><p>Settings for this league: ${L.teams.length} managers, ${L.settings.roster} NBA players plus ${L.settings.prospects} prospects, ${money(L.ceiling)} ceiling, $${L.settings.faab} FAAB.</p>${rulesList()}</section>
      <section class="card"><h3>Start over</h3><p class="psub" style="margin-top:0">Wipes this test league from this browser and takes you back to setup.</p><button class="btn" id="reset">Start a new test league</button></section>`;
  }

  function wireLeague() {
    const lg = $("#lg");
    lg.querySelectorAll("[data-wk]").forEach((b) => (b.onclick = () => { ui.week = +b.dataset.wk; render(); }));
    lg.querySelectorAll("[data-pair]").forEach((b) => (b.onclick = () => { ui.pair = +b.dataset.pair; ui.tab = "matchup"; render(); window.scrollTo(0, 0); }));
    lg.querySelectorAll("[data-team]").forEach((b) => (b.onclick = () => { ui.team = +b.dataset.team; ui.tab = "teams"; render(); }));
    lg.querySelectorAll("[data-bid]").forEach((b) => (b.onclick = () => bidDialog(b.dataset.bid)));
    lg.querySelectorAll("[data-unbid]").forEach((b) => (b.onclick = () => { const mine = L.bids.filter((x) => x.team === L.you); L.bids.splice(L.bids.indexOf(mine[+b.dataset.unbid]), 1); save(); render(); }));
    lg.querySelectorAll("[data-drop]").forEach((b) => (b.onclick = () => {
      const p = BY[b.dataset.drop];
      dlg(`<h3>Release ${esc(p.n)}?</h3><p class="psub">His ${money(p.sal)} comes off your payroll now. His stats still count for you through week ${curWeek()}, and you can't claim him back.</p>
        <form><div class="acts"><button type="button" class="btn" data-close>Keep him</button><button class="btn go" type="submit">Release</button></div></form>`, () => {
        P.dropPlayer(L, POOL, L.you, p.id, curWeek()); save(); toast(`Released ${p.n}.`); render();
      });
    }));
    const faq = $("#faq");
    if (faq) faq.addEventListener("input", (e) => { ui.faQ = e.target.value; render(); });
    const rw = $("#runWaivers");
    if (rw) rw.onclick = () => {
      const cw = curWeek();
      P.botBids(L, POOL, cw, P.rng(L.seed + Date.now() % 1000));
      const order = P.standings(L, cw - 1, STATS.wk).map((r) => r.id);
      const res = P.runWaivers(L, POOL, cw, order);
      save();
      const mine = res.filter((x) => x.team === L.you);
      const won = mine.filter((x) => x.ok).length, signed = res.filter((x) => x.ok).length;
      toast(`Waivers ran: ${signed} signing${signed === 1 ? "" : "s"} league-wide${mine.length ? `, you won ${won} of ${mine.length}` : ""}.`);
      ui.tab = "activity"; render();
    };
    const rs = $("#reset");
    if (rs) rs.onclick = () => dlg(`<h3>Start a new test league?</h3><p class="psub">This league, its draft and every move are wiped from this browser.</p><form><div class="acts"><button type="button" class="btn" data-close>Keep this league</button><button class="btn go" type="submit">Start over</button></div></form>`, () => {
      L = null; try { localStorage.removeItem(KEY); } catch (e) { /* nothing saved */ } ui.tab = "matchup"; render(); window.scrollTo(0, 0);
    });
  }

  function render() {
    // Bot picks re-render the room while you may be typing in the search box: keep your cursor where it was.
    const a = document.activeElement, id = a && a.id && a.tagName === "INPUT" ? a.id : null;
    const sel = id ? [a.selectionStart, a.selectionEnd] : null;
    draw();
    if (id && $("#" + id)) { const el = $("#" + id); el.focus(); try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ } }
  }
  function draw() {
    mast();
    if (!L) return renderSetup();
    if (L.phase === "nba" || L.phase === "college") return renderDraft();
    return renderLeague();
  }
  if (L && (L.phase === "nba" || L.phase === "college")) startClock();
  render();
})();
