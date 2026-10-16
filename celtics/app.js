/* Banner 19: app shell. State, saving, header, tabs, dialogs, shared formatting. Views live in ui-*.js. */
(function () {
  "use strict";
  const L = window.League, CBA = window.CBA, Mo = window.Model;
  const KEY = "banner19:v1";
  const App = window.App = { views: {}, acts: {}, ui: { tab: "books" } };
  const $ = (s, el = document) => el.querySelector(s);
  App.$ = $;
  App.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const esc = App.esc;
  // Money: $58.46M on the books, $58.5M in prose
  App.m2 = x => (x < 0 ? "-" : "") + "$" + (Math.abs(x) / 1e6).toFixed(2) + "M";
  App.m = x => { const a = Math.abs(x), s = x < 0 ? "-" : ""; return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M` : a >= 1e3 ? `${s}$${Math.round(a / 1e3)}K` : `${s}$${Math.round(a)}`; };
  App.pct = x => Math.round(x * 100) + "%";
  App.sn = i => CBA.seasonName(i);
  App.short = n => { const p = n.split(" "); return p.length > 1 ? p[0][0] + ". " + p.slice(1).join(" ") : n; };
  App.ovr = p => Mo.ovr(p);
  App.posName = p => (p.ps && p.ps.length ? p.ps.join("/") : p.pos) || "";

  // ---------- Save and load ----------
  App.save = () => {
    try {
      const W = App.W, keep = {};
      for (const k of Object.keys(W)) if (!k.startsWith("_") && k !== "live") keep[k] = W[k];
      localStorage.setItem(KEY, JSON.stringify(keep));
    } catch (e) { /* storage full or blocked: the game still runs */ }
  };
  App.load = () => { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  App.reset = () => { try { localStorage.removeItem(KEY); } catch (e) { } App.W = L.newWorld(App.DATA, App.LIVE, 19); App.W.dataVersion = App.DATA.version; App.afterChange(); };

  // ---------- Rendering ----------
  App.afterChange = () => { L.bump(App.W); App.save(); App.render(); };
  App.render = () => {
    renderHeader();
    for (const t of ["books", "moves", "rot", "season"]) {
      const on = App.ui.tab === t, panel = $("#p-" + t), tab = $("#t-" + t);
      panel.hidden = !on; tab.setAttribute("aria-selected", on ? "true" : "false"); tab.tabIndex = on ? 0 : -1;
      if (on && App.views[t]) App.views[t].render(panel);
    }
    const nx = L.nextAction(App.W), nb = $("#next");
    nb.textContent = nx.label; nb.dataset.next = nx.act;
    const q = App.W.queue.length;
    $("#t-moves").innerHTML = "Moves" + (q ? `<span class="cnt" aria-label="${q} queued">${q}</span>` : "");
    const inbox = (App.W.offers || []).filter(o => !o.done).length;
    $("#t-season").innerHTML = "Season" + (inbox ? `<span class="cnt" aria-label="${inbox} offers waiting">${inbox}</span>` : "");
  };
  App.go = (tab, focus) => { App.ui.tab = tab; App.render(); if (focus) { const el = $(focus); if (el) el.focus(); } window.scrollTo({ top: Math.min(window.scrollY, $(".tabs").offsetTop), behavior: "auto" }); };

  const TITLES = [1957, 1959, 1960, 1961, 1962, 1963, 1964, 1965, 1966, 1968, 1969, 1974, 1976, 1981, 1984, 1986, 2008, 2024];
  function bannerSVG(year, cls) {
    const yy = String(year);
    return `<li class="${cls || ""}"><svg viewBox="0 0 30 60" aria-hidden="true"><path class="b-face" d="M1 0h28v52l-14 7-14-7z" fill="var(--banner)"/><path class="b-mark" d="M9 9h12v2H9z"/><text class="b-txt" x="15" y="31" text-anchor="middle">${yy.slice(0, 2)}</text><text class="b-txt" x="15" y="43" text-anchor="middle">${yy.slice(2)}</text></svg><span class="sr">${year}</span></li>`;
  }
  function renderBanners() {
    const won = (App.W.titles || []);
    const all = TITLES.map(y => bannerSVG(y)).join("") + won.map(y => bannerSVG(y, "won")).join("");
    const next = `<li class="next"><svg viewBox="0 0 30 60" aria-hidden="true"><path d="M1.5 .5h27v51l-13.5 6.8L1.5 51.5z" fill="none" stroke="var(--banner)" stroke-width="1.6" stroke-dasharray="3 3"/><text x="15" y="36" text-anchor="middle" fill="var(--banner)">${won.length ? "" : "?"}</text></svg><span class="sr">Banner ${19 + won.length}: not won yet</span></li>`;
    $("#banners").innerHTML = all + next;
  }
  function renderHeader() {
    const W = App.W, B = L.books(W, "BOS", W.season);
    renderBanners();
    const hard = W.T.BOS.hard[W.season];
    // every line, not just the tax: over/under the cap (counting holds), the tax, and both aprons
    const line = (name, amt, cmp, hot) => { const d = amt - cmp; return [d >= 0 ? `Under ${name}` : `Over ${name}`, App.m(Math.abs(d)), null, d < 0 && hot]; };
    const capItem = (() => { const d = B.cap - B.capNum; return [d >= 0 ? "Cap room" : "Over the cap", App.m(Math.abs(d)), null, false]; })();
    const rec = W.T.BOS.w + W.T.BOS.l > 0 ? `${W.T.BOS.w}-${W.T.BOS.l}` : null;
    const pw = Math.round(L.projWins(W, "BOS"));
    const odds = App.titleOdds();
    const items = [
      ["Today", `${L.fmtDate(W.date)}`, L.PHASE_NAME[W.phase] + " " + App.sn(W.season)],
      ["Payroll", App.m(B.payroll)],
      capItem,
      line("the tax", B.taxLine, B.payroll, true),
      ((x) => { if (hard === "a1") x[0] += " (hard cap)"; return x; })(line("1st apron", B.a1, B.payroll, true)),
      ((x) => { if (hard === "a2") x[0] += " (hard cap)"; return x; })(line("2nd apron", B.a2, B.payroll, true)),
      ["Owner trust", `${L.ensureOwner(W).trust} of 100`, null, L.ensureOwner(W).trust < 35],
      [rec ? "Record" : "Projected", rec || `${pw}-${82 - pw}`],
      ["Title odds", App.pct(odds.BOS || 0)]
    ];
    $("#status").innerHTML = items.map(([k, v, sub, hot]) => `<li><span class="k">${esc(k)}${sub ? ` <span class="sr">,</span>` : ""}</span><span class="v${hot ? " hot" : ""}">${esc(v)}</span>${sub ? `<span class="k">${esc(sub)}</span>` : ""}</li>`).join("");
  }
  // A player option in plain words: what the open market would pay him against opting in
  App.optRead = (W, p, j) => {
    const v = L.optionView(W, p, j); if (!v || !v.po) return "";
    const o = v.po.outside, m = App.m;
    const close = v.pIn > 0.15 && v.pIn < 0.85;
    const mood = !close ? "" : v.po.happy >= 0.6 ? "It's close, and he likes it here (good team, real role), which tips it toward staying." : v.po.happy <= 0.35 ? "It's close, and he isn't thrilled with his situation, which tips it toward leaving." : "It's close.";
    const rest = o.years - 1;
    return `On the open market he'd expect about ${m(o.aav)} a year for ${o.years} year${o.years > 1 ? "s" : ""} (${m(o.total)} guaranteed). Opting in pays ${m(v.sal)}${rest ? `, then he'd be a free agent a year older: about ${m(v.po.laterPart)} over the next ${rest > 1 ? rest + " years" : "year"}, with no guarantee` : ""}. ${App.pct(v.pIn)} he opts in. ${mood}`.trim();
  };
  App.titleOdds = () => {
    const W = App.W;
    if (!W._odds || W._oddsTick !== W.tick) { W._odds = L.titleOdds(W, 400); W._oddsTick = W.tick; }
    return W._odds;
  };

  // ---------- Dialog ----------
  App.dlg = (title, html) => {
    const d = $("#dlg");
    $("#dlg-title").textContent = title;
    $("#dlg-body").innerHTML = html;
    if (!d.open) d.showModal();
    const f = $("#dlg-body [autofocus]") || $("#dlg-body button, #dlg-body input, #dlg-body select");
    if (f) f.focus();
  };
  App.closeDlg = () => { const d = $("#dlg"); if (d.open) d.close(); };
  App.acts.close = () => App.closeDlg();

  // ---------- Events ----------
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const fn = App.acts[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  const onInput = e => {
    const el = e.target.closest("[data-on]");
    if (!el) return;
    const fn = App.acts[el.dataset.on];
    if (fn) fn(el, e);
  };
  document.addEventListener("change", onInput);
  document.addEventListener("input", e => { if (e.target.matches("[data-live]")) onInput(e); });
  $("#tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) App.go(b.dataset.tab); });
  // The next step, from any tab: do it, then show the result on the Season tab
  $("#next").addEventListener("click", () => {
    const act = $("#next").dataset.next, fn = App.acts[act];
    App.ui.tab = "season";
    if (fn) fn($("#next")); else App.render();
    App.go("season");
  });
  $("#tabs").addEventListener("keydown", e => {
    const order = ["books", "moves", "rot", "season"], k = order.indexOf(App.ui.tab);
    let n = null;
    if (e.key === "ArrowRight") n = order[(k + 1) % 4]; else if (e.key === "ArrowLeft") n = order[(k + 3) % 4];
    else if (e.key === "Home") n = order[0]; else if (e.key === "End") n = order[3];
    if (n) { e.preventDefault(); App.go(n, "#t-" + n); }
  });
  // theme
  const themeBtn = $("#theme");
  const setTheme = t => {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    const dark = t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    themeBtn.textContent = dark ? "Light mode" : "Dark mode";
    themeBtn.setAttribute("aria-pressed", dark ? "true" : "false");
  };
  let savedTheme = null; try { savedTheme = localStorage.getItem("banner19:theme"); } catch (e) { }
  setTheme(savedTheme);
  themeBtn.addEventListener("click", () => {
    const dark = themeBtn.getAttribute("aria-pressed") === "true";
    const t = dark ? "light" : "dark";
    try { localStorage.setItem("banner19:theme", t); } catch (e) { }
    setTheme(t);
  });

  // ---------- Boot ----------
  async function boot() {
    const get = async u => { const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) throw new Error(u); return r.json(); };
    App.DATA = await get("data.json?v=" + Date.now().toString(36).slice(0, 5));
    try { App.LIVE = await get("live.json"); } catch (e) { App.LIVE = null; }
    CBA.init(App.DATA.cba);
    const saved = App.load();
    const mig = App.DATA.migrate || {};
    if (saved && saved.v === 1 && saved.P && saved.T && (saved.dataVersion === App.DATA.version || mig[saved.dataVersion])) {
      App.W = saved;
      App.W.live = App.LIVE;
      if (saved.dataVersion !== App.DATA.version) { App.migrate(App.W, mig[saved.dataVersion]); App.ui.flash = { ok: true, text: "Your game carried over. Rookie ratings, two-way contracts, the expansion step and the free-agent fixes are in; anything already decided stays decided." }; }
      if (App.LIVE && App.W.phase === "pre") L.applyLive(App.W, App.LIVE);
    } else {
      App.W = L.newWorld(App.DATA, App.LIVE, 19);
      if (saved) App.ui.flash = { ok: true, text: "The game data was updated (ratings, the market and real draft classes), so this is a fresh start from Oct. 15, 2026." };
    }
    App.W.dataVersion = App.DATA.version;
    L.ensureOwner(App.W);
    if (!App.W.recruits) App.W.recruits = App.DATA.recruits || {};
    L.bump(App.W);
    $("#loading").remove();
    renderFooter();
    App.render();
  }
  // Bring a saved game up to the current data: rating and service-time fixes for players still on their first deals
  App.migrate = (W, fix) => {
    for (const [id, f] of Object.entries(fix || {})) {
      const p = W.P[id]; if (!p) continue;
      if (f.dr) { p.o = +(p.o + f.dr * 0.6).toFixed(2); p.d = +(p.d + f.dr * 0.4).toFixed(2); }
      if (f.dpot && p.pot != null) p.pot = +(p.pot + f.dpot).toFixed(2);
      if (f.dyos) p.yos = (p.yos || 0) + f.dyos;
      if (f.rk && p.c && (p.c.signed ?? -1) <= 0 && !p.c.rk) p.c.rk = f.rk;
    }
    for (const p of Object.values(W.P)) if (p.two && p.c && p.c.twoEnd == null) p.c.twoEnd = W.season;
    if (W.T.LVA && W.T.LVA.name === "Las Vegas Aces") W.T.LVA.name = "Las Vegas";
    L.bump(W);
  };
  function renderFooter() {
    const lv = App.LIVE;
    $("#footer").innerHTML = `<p>Contracts: ShamSports, NBC Sports Boston and Hoops Rumors, checked Oct. 15, 2026. Cap figures: the NBA's 2026-27 release, then 7% growth a season.
      Ratings and aging: the same impact blend as <a href="../31st-franchise/">The 31st Franchise</a>. Front offices: team announcements through June 2026.
      Draft classes: ESPN's top 60 for 2027 and ESPN's recruiting rankings for 2028 through 2030 (real names); later classes are generated.
      ${lv && lv.updated && lv.games && lv.season === App.sn(App.W.season) ? `Live stats and standings from ESPN, updated ${esc(L.fmtDate(lv.updated.slice(0, 10)))}.` : "Live stats from ESPN start loading each morning once the 2026-27 season tips off Oct. 20."}</p>
      <p>Your game saves in this browser. <button class="linkish" type="button" data-act="resetGame">Start over from Oct. 15, 2026</button></p>`;
  }
  App.acts.resetGame = () => {
    App.dlg("Start over?", `<p>This wipes your saved game and puts you back on Oct. 15, 2026 with the real roster.</p><div class="row"><button class="btn" type="button" data-act="resetYes">Start over</button><button class="btn ghost" type="button" data-act="close">Keep my game</button></div>`);
  };
  App.acts.resetYes = () => { App.closeDlg(); App.reset(); };
  App.boot = boot;
  window.addEventListener("DOMContentLoaded", () => boot().catch(err => { const l = $("#loading"); if (l) l.textContent = "Couldn't load the game data. Refresh to try again."; console.error(err && err.stack ? err.stack : err); }));
})();
