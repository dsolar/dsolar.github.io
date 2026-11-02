/* Hard Cap: the league pages, the Draft Room and the commissioner's tools. Rules live in engine.js.
   A league is one shared document in Supabase (tools/hardcap_supabase.sql). Every change runs the rules here,
   then saves with the version it started from; if someone else saved first, this page takes their version and
   runs the change again. Managers own teams with a PIN; the commissioner has a PIN of their own.
   Players and 2026-27 salaries come from Banner 19's cap sheet (../celtics/data.json); box scores from ESPN
   (stats.json, refreshed every morning). */
(async function () {
  "use strict";
  const H = window.HardCap;
  const { C, CATS, money } = H;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const app = $("#app");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window: this visit only */ } },
  };

  /* ---------- data ---------- */
  let NBA, STATS;
  try {
    [NBA, STATS] = await Promise.all([fetch("../celtics/data.json").then((r) => r.json()), fetch("stats.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}))]);
  } catch (e) {
    app.innerHTML = `<div class="wrap loading">The player list didn't load. Refresh the page to try again.</div>`;
    return;
  }
  let YAHOO = {};
  try { const r = await fetch("yahoo.json"); if (r.ok) YAHOO = await r.json(); } catch (e) { /* Yahoo ranks are a bonus */ }
  let POOL = H.buildPool(NBA, STATS), BY = Object.fromEntries(POOL.map((p) => [p.id, p]));
  const PROS = H.buildProspects(NBA), PBY = Object.fromEntries(PROS.map((p) => [p.id, p]));
  let poolKey = "";
  // A league can carry its own contracts (new signings the commissioner added before the cap sheet catches up).
  function syncPool() {
    const k = LG && LG.contracts ? JSON.stringify(LG.contracts) : "";
    if (k === poolKey) return;
    poolKey = k;
    POOL = H.buildPool(k ? H.mergeContracts(NBA, LG.contracts) : NBA, STATS);
    BY = Object.fromEntries(POOL.map((p) => [p.id, p]));
  }
  const opener = STATS.opener || "2026-10-20";
  const INJ = STATS.inj || {};
  const moveTag = (id) => { const p = BY[id]; return !p ? "" : p.gone ? ` <span class="tag t3" title="On no NBA roster right now">Released</span>` : p.was ? ` <span class="tag" title="Traded from ${esc(p.was)}; same contract">From ${esc(p.was)}</span>` : ""; };
  const injTag = (id) => { const i = INJ[id]; if (!i) return moveTag(id); const out = H.isOut(i); return ` <span class="tag ${out ? "t3" : "t1"}" title="${esc(i[1] || "")}">${esc(out ? "Out" : i[0] === "Day-To-Day" ? "DTD" : i[0])}</span>` + moveTag(id); };
  // A player's name, clickable for his card.
  const pl = (id, sub) => {
    const p = BY[id], q = PBY[id];
    const nm = p ? p.n : q ? q.n : id;
    return `<button type="button" class="pn btn link" data-player="${esc(id)}">${esc(nm)}</button>${injTag(id)}${sub && p ? `<div class="ps">${p.t}, ${H.positions(p).join("/")}, ${p.age}</div>` : sub && q ? `<div class="ps">${esc(q.school)}, ${q.pos}</div>` : ""}`;
  };
  const nameOf = (id) => (BY[id] ? BY[id].n : PBY[id] ? PBY[id].n : id);

  /* ---------- server ---------- */
  const SB = "https://baxrczyufqbzrogftmyn.supabase.co/rest/v1/rpc/", KEY = "sb_publishable_brDXGevzcoI7mBaPO7Plow_yaUy4gk4";
  async function rpc(fn, body) {
    const h = { apikey: KEY, "Content-Type": "application/json" };
    const call = (hh) => fetch(SB + fn, { method: "POST", headers: hh, body: JSON.stringify(body) });
    let res = await call(h);
    if (res.status === 401) res = await call(Object.assign({ Authorization: "Bearer " + KEY }, h));
    if (!res.ok) throw new Error("The league server didn't answer (" + res.status + ")");
    return res.json();
  }

  /* ---------- league state ---------- */
  const params = new URLSearchParams(location.search);
  const LID = (params.get("l") || "").toLowerCase().replace(/[^a-z0-9]/g, "") || null;
  let LG = null, VER = 0, CLAIMS = {}, skew = 0, busy = false;
  const meKey = () => "hc:me:" + LID;
  let me = LID ? store.get(meKey(), {}) : {};          // {team, pin, commish}
  const now = () => Date.now() + skew;
  const myTeam = () => (LG && me.team != null && LG.teams[me.team] ? LG.teams[me.team] : null);
  const isMine = (t) => me.team != null && t && t.id === me.team;
  const curWeek = () => Math.min(LG ? H.totalWeeks(LG) : 23, H.weekOf(opener, new Date(now())));
  const ui = { tv: "lineup", lw: null, drops: [], f: { pos: "", team: "", sal: "", con: "", age: "" }, abids: {}, sub: "players", q: "", pos: "", sort: "rank", fit: false, status: "fa", kind: "nba", week: null, pair: null, team: null, logKind: "", tradeWith: null, give: [], get: [] };

  async function load(full) {
    const r = await rpc("hc_view", { p_id: LID, p_since: full ? 0 : VER });
    if (r.error) throw new Error(r.error);
    skew = new Date(r.now).getTime() - Date.now();
    CLAIMS = r.claims || {};
    if (r.state) { LG = r.state; VER = r.version; syncPool(); return true; }
    return false;
  }

  // Run a change on a copy of the league and save it. On a version clash, take the newer league and try once more.
  async function mutate(note, fn, opts = {}) {
    const as = opts.as || "team";
    let team, pin;
    if (as === "commish" || (as === "any" && me.team == null)) { team = -1; pin = me.commish; }
    else { team = me.team; pin = me.pin; }
    if (pin == null || team == null) { toast(as === "commish" ? "Sign in as commissioner first." : "Claim or sign in to your team first.", true); return false; }
    for (let attempt = 0; attempt < 3; attempt++) {
      const copy = JSON.parse(JSON.stringify(LG));
      const res = fn(copy);
      if (res && res.ok === false) { if (!opts.quiet) toast(res.why, true); return false; }
      busy = true;
      let r;
      try { r = await rpc("hc_save", { p_id: LID, p_team: team, p_pin: String(pin), p_version: VER, p_state: copy, p_note: note, p_clear: opts.clear || null }); }
      catch (e) { busy = false; toast(e.message, true); return false; }
      busy = false;
      if (r.ok) { LG = copy; VER = r.version; syncPool(); render(); return res || { ok: true }; }
      if (r.error === "stale") { LG = r.state; VER = r.version; CLAIMS = r.claims || CLAIMS; syncPool(); continue; }
      toast(r.error, true);
      if (/PIN/.test(r.error) && as !== "commish") { /* keep the saved PIN; the commissioner can reset it */ }
      return false;
    }
    toast("The league is busy. Try that again.", true);
    return false;
  }

  /* ---------- helpers ---------- */
  function toast(msg, bad) {
    const t = $("#toast"); t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3600);
  }
  const season = (i) => `${2026 + i}-${String(27 + i).padStart(2, "0")}`;
  const fmtDate = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const fmtWhen = (d) => new Date(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const last = (n) => { const parts = String(n).split(" "); const s = parts.pop(); return /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(s) ? parts.pop() + " " + s : s; };
  const pct = (m, a) => (a ? (m / a).toFixed(3).replace(/^0/, "") : "-");
  const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]);
  const tierTag = (t) => { const k = t.tier || 0; return k ? `<span class="tag t${k}">${esc(LG.settings.tiers[k].label)}</span>` : ""; };
  const ownerTag = (t) => (isMine(t) ? `<span class="tag you">You</span>` : t.owner ? "" : `<span class="tag bot">Open</span>`);
  function contract(p) {
    const yrs = [p.sal, ...p.future];
    const opts = Object.entries(p.opt || {}).map(([i, k]) => `<span class="pill" title="${{ PO: "Player option", TO: "Team option", NG: "Non-guaranteed" }[k] || k}">${esc(k)} ${season(+i).slice(2)}</span>`).join(" ");
    return `${yrs.length === 1 ? "Expiring" : `${yrs.length} yrs, thru ${season(yrs.length - 1)}`} ${opts}`;
  }
  function perGame(p) {
    const l = p.cur && p.cur[0] >= 3 ? p.cur : p.prev || p.cur;
    return l ? { l, prev: l === p.prev } : null;
  }
  const LINE_HEAD = `<th class="r">PTS</th><th class="r">REB</th><th class="r">AST</th><th class="r hide-s">3PM</th><th class="r hide-s">STL</th><th class="r hide-s">BLK</th><th class="r hide-m">FG%</th><th class="r hide-m">FT%</th><th class="r hide-m">TO</th>`;
  function lineCells(p) {
    const g = perGame(p);
    if (!g) return `<td class="r ps" colspan="9">No NBA games yet</td>`;
    const l = g.l, v = (k) => l[C[k]].toFixed(1);
    return `<td class="r num">${v("pts")}</td><td class="r num">${v("reb")}</td><td class="r num">${v("ast")}</td><td class="r num hide-s">${v("tpm")}</td><td class="r num hide-s">${v("stl")}</td><td class="r num hide-s">${v("blk")}</td><td class="r num hide-m">${pct(l[C.fgm], l[C.fga])}</td><td class="r num hide-m">${pct(l[C.ftm], l[C.fta])}</td><td class="r num hide-m">${v("tov")}</td>`;
  }
  const hcCell = (p) => `<td class="r num ${p.hc >= 1 ? "ok" : p.hc < 0 ? "bad" : ""}" title="Value over a replacement player per $10M of salary">${p.hc.toFixed(1)}</td>`;
  function seasonLine(pid) {
    const tot = Array(H.COLS.length).fill(0);
    for (const wk of Object.values(STATS.wk || {})) { const l = wk[pid]; if (l) l.forEach((v, i) => (tot[i] += v)); }
    return tot[0] ? tot : null;
  }

  /* ---------- the cap bar ---------- */
  function capBar(team, opts = {}) {
    const ceiling = H.ceilingOf(LG, team);
    const ids = H.active(team);
    const pay = H.payroll(team, BY);
    const ctx = opts.ctx || H.context(LG, POOL);
    const open = LG.settings.roster - ids.length - (opts.ghost ? 1 : 0);
    const hold = opts.reserve && open > 0 ? H.reserve(open, ctx.available, opts.ghost && opts.ghost.id, LG.phase === "nba" ? LG.teams.filter((t) => t.id !== team.id).reduce((s, t) => s + Math.max(0, LG.settings.roster - H.active(t).length), 0) : 0) : 0;
    const top = LG.settings.tiers[LG.settings.tiers.length - 1].line;
    const scale = (v) => (v / top) * 100;
    let html = ids.map((id) => BY[id]).filter(Boolean).sort((a, b) => b.sal - a.sal)
      .map((p) => `<div class="blk" style="flex:0 0 ${scale(p.sal)}%" title="${esc(p.n)}, ${money(p.sal)}">${scale(p.sal) > 6 ? `${esc(last(p.n))}<span>${money(p.sal)}</span>` : ""}</div>`).join("");
    const after = pay + (opts.ghost ? opts.ghost.sal : 0);
    if (opts.ghost) html += `<div class="blk ghost${after + hold > ceiling ? " bad" : ""}" style="flex:0 0 ${scale(opts.ghost.sal)}%">${esc(last(opts.ghost.n))}<span>${money(opts.ghost.sal)}</span></div>`;
    if (hold > 0) html += `<div class="blk hold" style="flex:0 0 ${scale(hold)}%" title="Held for ${open} open spots">${scale(hold) > 8 ? `${open} open<span>${money(hold)}</span>` : ""}</div>`;
    const room = ceiling - after - hold;
    // Every tier's line is marked; only this team's line is labeled, so the labels never pile up.
    const ticks = LG.settings.tiers.map((t, i) => `<div class="tick${i === (team.tier || 0) ? " on" : ""}" style="left:${scale(t.line)}%" title="${esc(t.label)}: ${money(t.line)}">${i === (team.tier || 0) ? `<label>${esc(t.label)} line ${money(t.line)}</label>` : ""}</div>`).join("");
    const head = opts.mini ? "" : `<div class="capbar-top"><div><span class="disp big num">${money(after)}</span> <span class="ps">on the books, ${ids.length + (opts.ghost ? 1 : 0)} of ${LG.settings.roster} players</span></div>
      <div class="num"><b class="${room >= 0 ? "ok" : "bad"}">${room >= 0 ? `${money(room)} usable room` : `${money(-room)} over the line`}</b>${hold > 0 ? ` <span class="ps">after ${money(hold)} held for ${open} spot${open === 1 ? "" : "s"}</span>` : ""}</div></div>`;
    return `<div class="capbar${opts.mini ? " mini" : ""}">${head}<div class="track" role="img" aria-label="${money(after)} on the books against a ${money(ceiling)} line"><div class="blocks">${html}</div>${ticks}</div><div class="capbar-foot"></div></div>`;
  }

  /* ---------- alerts and installing ---------- */
  const VAPID = "BC2enuoc9sCrEblbL6HFNkhQ74jHeGVKnu3p7ELbKq27Md89TokJ3Y8Pgkfe1Y_sp0ED8-JNjNNlWMTVQpa938o";
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const canPush = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  let swReg = null;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then((r) => (swReg = r)).catch(() => {});
  const alertsOn = () => !!store.get("hc:alerts:" + LID, false) && canPush() && Notification.permission === "granted";
  function b64url(s) { const p = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); }
  async function turnOnAlerts() {
    if (!myTeam()) { toast("Claim or sign in to your team first, so alerts know who you are.", true); return; }
    if (!canPush()) {
      if (isIOS() && !standalone()) return installHelp(true);
      toast("This browser can't show alerts. Try Chrome, Edge, Firefox or Safari on a computer, or install the app on your phone.", true); return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Alerts are blocked for this site. Allow notifications in your browser settings to turn them on.", true); return; }
    const reg = swReg || (await navigator.serviceWorker.ready);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64url(VAPID) });
    const r = await rpc("hc_push_subscribe", { p_id: LID, p_team: me.team, p_pin: String(me.pin), p_sub: sub.toJSON() });
    if (r.error) { toast(r.error, true); return; }
    store.set("hc:alerts:" + LID, true);
    toast("Alerts are on for this device.");
    render();
  }
  async function turnOffAlerts() {
    try { const reg = swReg || (await navigator.serviceWorker.ready); const sub = await reg.pushManager.getSubscription(); if (sub) { await rpc("hc_push_unsubscribe", { p_endpoint: sub.endpoint }); await sub.unsubscribe(); } } catch (e) { /* already off */ }
    store.set("hc:alerts:" + LID, false); toast("Alerts are off for this device."); render();
  }
  function alertsDialog() {
    const on = alertsOn();
    dlg(`<h3 class="disp">Alerts</h3><p class="muted" style="margin-top:0">${on ? "This device gets alerts for" : "Get a notification on this device for"} ${myTeam() ? esc(myTeam().name) : "your team"}:</p>
      <ul class="list"><li>You're on the clock in the draft</li><li>A trade offer, and the answer to yours</li><li>Waiver and Prospect Board results</li><li>A starter listed Out before lineups lock</li><li>A real NBA team waives one of your players</li></ul>
      ${isIOS() && !standalone() ? `<p class="ps">On iPhone, alerts only work once Hard Cap is on your home screen: tap Share, then Add to Home Screen, then open it from there.</p>` : ""}
      <div class="acts"><button class="btn" type="button" data-close>Close</button>${on ? `<button class="btn warn" type="button" id="aoff">Turn off on this device</button>` : `<button class="btn go" type="button" id="aon">Turn on alerts</button>`}</div>`);
    const a = $("#aon", D), b = $("#aoff", D);
    if (a) a.onclick = () => { D.close(); turnOnAlerts(); };
    if (b) b.onclick = () => { D.close(); turnOffAlerts(); };
  }
  let installEvt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; });
  function installHelp(forAlerts) {
    if (installEvt) { installEvt.prompt(); installEvt = null; return; }
    dlg(`<h3 class="disp">Put Hard Cap on your home screen</h3>
      ${isIOS() ? `<ol class="list"><li>Tap the Share button in Safari.</li><li>Tap Add to Home Screen, then Add.</li><li>Open Hard Cap from your home screen${forAlerts ? " and turn on alerts there" : ""}.</li></ol>`
        : `<ol class="list"><li>Open your browser's menu.</li><li>Choose Install app or Add to Home screen.</li></ol>`}
      <p class="ps">It opens full screen like an app and goes straight to your league.</p>
      <div class="acts"><button class="btn go" type="button" data-close>Got it</button></div>`);
  }

  /* ---------- chrome ---------- */
  const TABS = [["office", "League Office"], ["team", "Cap Sheet"], ["market", "Player Market"], ["matchups", "Matchup Center"], ["tx", "Transactions"], ["draft", "Draft Room"], ["commish", "Commissioner"]];
  const route = () => { const h = location.hash.replace("#", "").split("/"); return { tab: TABS.some((t) => t[0] === h[0]) ? h[0] : "office", arg: h[1] }; };
  function chrome() {
    const tabs = $("#tabs"), who = $("#who");
    $("#lgName").textContent = LG ? LG.name : "";
    if (!LG) { tabs.innerHTML = ""; who.innerHTML = `<button class="btn sm" data-act="theme">${document.documentElement.dataset.theme === "dark" ? "Light" : "Dark"}</button>`; return; }
    const r = route();
    tabs.innerHTML = TABS.map(([k, n]) => `<a href="#${k}"${r.tab === k ? ' aria-current="page"' : ""}>${n}</a>`).join("");
    const t = myTeam();
    const theme = `<button class="btn sm" data-act="theme" aria-label="Switch to ${document.documentElement.dataset.theme === "dark" ? "light" : "dark"} colors">${document.documentElement.dataset.theme === "dark" ? "Light" : "Dark"}</button>`;
    const bell = t ? `<button class="btn sm${alertsOn() ? " go" : ""}" data-act="alerts" aria-label="Alerts">${alertsOn() ? "Alerts on" : "Alerts"}</button>` : "";
    const inst = !standalone() && (installEvt || isIOS()) ? `<button class="btn sm hide-wide" data-act="install">Install</button>` : "";
    who.innerHTML = theme + inst + bell + (t
      ? `<span class="chip"><b>${esc(t.abbr)}</b> ${esc(t.owner || "")}${me.commish ? " (commish)" : ""}</span><button class="btn sm" data-act="signout">Sign out</button>`
      : `${me.commish ? `<span class="chip">Commissioner</span>` : ""}<button class="btn sm" data-act="signin">Sign in</button>${LG.teams.some((x) => !x.owner) ? `<button class="btn sm go" data-act="claim">Claim a team</button>` : ""}`);
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const a = b.dataset.act;
    if (a === "claim") claimDialog(b.dataset.team != null ? +b.dataset.team : null);
    else if (a === "signin") signInDialog();
    else if (a === "signout") { me = {}; store.set(meKey(), me); toast("Signed out on this device."); render(); }
    else if (a === "alerts") alertsDialog();
    else if (a === "install") installHelp(false);
    else if (a === "theme") { const d = document.documentElement.dataset.theme === "dark" ? "" : "dark"; if (d) document.documentElement.dataset.theme = d; else delete document.documentElement.dataset.theme; store.set("hc:theme", d || "light"); render(); }
    else if (a === "copy") { navigator.clipboard && navigator.clipboard.writeText(b.dataset.text).then(() => toast("Invite link copied.")); }
  });

  /* ---------- dialogs ---------- */
  const D = $("#dlg");
  function dlg(html, onSubmit) {
    D.innerHTML = html;
    $$("[data-close]", D).forEach((b) => b.addEventListener("click", () => D.close()));
    const f = $("form", D);
    if (f && onSubmit) f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("button[type=submit]", f); if (btn) btn.disabled = true;
      const keep = await onSubmit(new FormData(f), f);
      if (btn) btn.disabled = false;
      if (keep !== false) D.close();
    });
    D.showModal();
  }
  D.addEventListener("close", () => render());
  const errLine = (f, msg) => { let el = $(".why", f); if (!el) { el = document.createElement("p"); el.className = "why"; $(".acts", f).before(el); } el.textContent = msg; return false; };

  function claimDialog(team) {
    const open = LG.teams.filter((t) => !t.owner);
    if (!open.length) { toast("Every team is claimed.", true); return; }
    dlg(`<h3 class="disp">Claim a team</h3><p class="muted small" style="margin:0">Pick an open team and set a PIN. You'll use the PIN to make moves from any device.</p>
      <form class="form" style="margin-top:14px">
        <div class="field"><label for="ct">Team</label><select id="ct" name="team">${open.map((t) => `<option value="${t.id}"${t.id === team ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="cm">Your name</label><input type="text" id="cm" name="manager" maxlength="30" required autocomplete="name"></div>
        <div class="field"><label for="cn">Team name (optional)</label><input type="text" id="cn" name="tname" maxlength="28" placeholder="Keep the current name"></div>
        <div class="row2"><div class="field"><label for="cp">PIN, 4 to 8 digits</label><input type="password" id="cp" name="pin" inputmode="numeric" pattern="\\d{4,8}" required autocomplete="new-password"></div>
        <div class="field"><label for="cp2">PIN again</label><input type="password" id="cp2" name="pin2" inputmode="numeric" pattern="\\d{4,8}" required autocomplete="new-password"></div></div>
        <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go" type="submit">Claim team</button></div></form>`, async (fd, f) => {
      if (fd.get("pin") !== fd.get("pin2")) return errLine(f, "The PINs don't match.");
      const t = +fd.get("team");
      let r;
      try { r = await rpc("hc_claim", { p_id: LID, p_team: t, p_manager: fd.get("manager"), p_pin: fd.get("pin") }); } catch (e) { return errLine(f, e.message); }
      if (r.error) return errLine(f, r.error);
      me = Object.assign({}, me, { team: t, pin: fd.get("pin") }); store.set(meKey(), me);
      await load(true);
      const nm = String(fd.get("tname") || "").trim();
      if (nm) await mutate("Renamed team", (L) => renameTeam(L, t, nm));
      toast("You're in. Welcome to the league.");
      render();
    });
  }
  function renameTeam(L, t, nm) {
    const team = L.teams[t];
    team.name = nm.slice(0, 28);
    team.abbr = nm.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase() || team.abbr;
    return { ok: true };
  }
  function signInDialog() {
    const claimed = LG.teams.filter((t) => t.owner);
    dlg(`<h3 class="disp">Sign in</h3><form class="form" style="margin-top:10px">
      <div class="field"><label for="st">Seat</label><select id="st" name="team">${claimed.map((t) => `<option value="${t.id}">${esc(t.name)} (${esc(t.owner)})</option>`).join("")}<option value="-1">Commissioner only</option></select></div>
      <div class="field"><label for="sp">PIN</label><input type="password" id="sp" name="pin" inputmode="numeric" required autocomplete="current-password"></div>
      <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go" type="submit">Sign in</button></div></form>`, async (fd, f) => {
      const t = +fd.get("team"), pin = String(fd.get("pin"));
      let r;
      try { r = await rpc("hc_auth", { p_id: LID, p_team: t, p_pin: pin }); } catch (e) { return errLine(f, e.message); }
      if (r.error) return errLine(f, r.error);
      if (t === -1) me = Object.assign({}, me, { commish: pin }); else me = Object.assign({}, me, { team: t, pin });
      store.set(meKey(), me); toast("Signed in."); render();
    });
  }

  /* ---------- landing: create a league ---------- */
  const RULES = (L) => {
    const tiers = L ? L.settings.tiers : H.defaultTiers(NBA.cba);
    const faab = L ? L.settings.faab : 50, buy = L ? L.settings.buyIn : 100;
    return [
      ["Real salaries", "Every player costs his actual NBA salary, and it moves each offseason with his real contract. Two-way deals aren't eligible until they become standard contracts."],
      ["The line", `Everyone starts as a cap team: 12 NBA players under ${money(tiers[0].line)}. Any team can move up a tier for a cash add-on: ${tiers.slice(1).map((t) => `${t.label} (${money(t.line)}, +$${t.add})`).join(", ")}. Moving up is permanent for the season. Buy-in is $${buy}.`],
      ["The draft", "Live or slow. A pick only counts if you can still fill every open spot at the cheapest salaries left; the hatched part of your cap bar is that reserve. Miss your clock and your queue picks for you."],
      ["Prospect Board", `After the draft, a blind FAAB auction for two prospect spots. Bids come out of your $${faab} season budget, so a big prospect bid means fewer pickups later.`],
      ["Waivers", `Blind FAAB bids, $${L ? L.settings.minBid : 1} minimum, highest bid wins, ties go to the team lower in the standings. They run every Monday at 3 a.m. Eastern; signings count that week.`],
      ["Lineups", "Nine starters (PG, SG, G, SF, PF, F, C, UTIL, UTIL) and three on the bench. Only starters score. Lineups are weekly and lock at each week's first tip; forget, and your best lineup is set for you."],
      ["IR", `${L ? L.settings.irSlots : 2} IR spots for players listed Out on the injury report. A player on IR doesn't count against your line, so you can sign a real replacement. Bring him back only if he fits.`],
      ["Releases", "Drop a player and his salary comes off right away. His stats count through the end of that week, and you can't claim him straight back."],
      ["Trades", `Players, prospects and FAAB dollars. Both teams have to fit under their own line afterward, and moves count from the next week. The commissioner can veto within ${L ? L.settings.vetoHours : 24} hours. The deadline is the end of week ${L ? L.settings.tradeDeadline : 18}, about ten days after the NBA's (Feb. 11, 2027).`],
      ["NBA moves", "A player traded for real stays on your team on the same contract. One who is waived, bought out or retires comes off your books automatically, and you can't sign him until a real team does. New NBA deals reach free agency at the real salary."],
      ["Expiring deals", `When a contract runs out, keep him at his new real salary or let him go for $${L ? L.settings.compDollars : 10} of extra summer draft budget. You can always trade him before it gets that far.`],
      ["Summer draft", `Every summer, one blind FAAB auction for incoming rookies and unsigned free agents. Budgets run from $${L ? L.settings.summerMax : 100} for the last-place team down to $${L ? L.settings.summerMin : 50} for the champion. Prospect rights you already hold carry over.`],
      ["Playoffs", `Top ${L ? L.settings.playoffTeams : 4} after week ${L ? L.settings.regWeeks : 21}: semifinals, then a final and a third-place game. A tied matchup goes to Game Score, then the higher seed. The pot pays ${(L ? L.settings.payout : [60, 25, 15]).join("/")}.`],
      ["Scoring", "Weekly head-to-head on FG%, FT%, 3PM, PTS, REB, AST, STL, BLK and TO. Each category is a win, loss or tie. Game Score breaks ties."],
      ["HC Score", "Value over a replacement player per $10M of salary. A rookie deal that produces scores high; a max contract has to be great to clear 1."],
    ];
  };
  const rulesList = (L) => `<ul class="rules">${RULES(L).map(([a, b]) => `<li><b>${a}</b><span>${b}</span></li>`).join("")}</ul>`;

  function renderLanding() {
    const fake = { settings: { roster: 12, tiers: H.defaultTiers(NBA.cba) }, teams: [], phase: "lobby" };
    const keepLG = LG; LG = fake;
    const sample = { tier: 0, hist: ["nikola-jokic", "cooper-flagg", "derrick-white", "jalen-johnson", "payton-pritchard"].filter((id) => BY[id]).map((pid) => ({ pid, from: 1, to: null })) };
    const bar = capBar(sample, { reserve: true });
    LG = keepLG;
    const mine = store.get("hc:leagues", []);
    app.innerHTML = `<div class="wrap">
      <section class="hero"><h1 class="disp"><span>Draft the player.</span><span>Carry the contract.</span></h1>
        <p>Hard Cap is dynasty fantasy basketball where every player costs his real NBA salary and every roster has to fit under a hard line. Talent has a price.</p>${bar}</section>
      <section class="landing">
        <form class="card form" id="create">
          <div><h2 class="disp">Start a league</h2><p class="muted small" style="margin:0">You'll be the commissioner. Send the invite link to your managers and they claim their own teams. Open teams are bots until someone claims them, so you can test the whole thing alone.</p></div>
          <div class="row2"><div class="field"><label for="ln">League name</label><input type="text" id="ln" name="name" value="Hard Cap League" maxlength="40" required></div>
          <div class="field"><label for="mn">Your name</label><input type="text" id="mn" name="manager" maxlength="30" required></div></div>
          <div class="row2"><div class="field"><span class="lbl">Managers</span><div class="seg" role="group" aria-label="Managers">${[8, 10, 12].map((n) => `<button type="button" data-n="${n}" aria-pressed="${n === 10}">${n}</button>`).join("")}</div></div>
          <div class="field"><span class="lbl">Draft</span><div class="seg" role="group" aria-label="Draft type"><button type="button" data-m="live" aria-pressed="true">Live</button><button type="button" data-m="slow" aria-pressed="false">Slow</button></div></div></div>
          <div class="row2"><div class="field"><label for="cp">Commissioner PIN, 4 to 8 digits</label><input type="password" id="cp" name="pin" inputmode="numeric" pattern="\\d{4,8}" required autocomplete="new-password"></div>
          <div class="field"><label for="tn">Your team name</label><input type="text" id="tn" name="tname" maxlength="28" value="Needham Nightshift"></div></div>
          <p class="muted small" style="margin:0">Your PIN also signs you in to your own team. Everything else (clock, tiers, buy-in, order) is in Commissioner tools.</p>
          <div><button class="btn go" type="submit">Create the league</button></div>
        </form>
        <div class="stack">
          ${mine.length ? `<div class="card"><h3>Your leagues</h3><ul class="list">${mine.map((x) => `<li><a href="?l=${esc(x.id)}">${esc(x.name)}</a><span class="grow"></span><span class="ps">${esc(x.id)}</span></li>`).join("")}</ul></div>` : ""}
          <div class="card"><h3>Got an invite?</h3><p class="muted small" style="margin:0">Open the link your commissioner sent. It looks like davidsolar.dev/hardcap/?l=abc1234.</p></div>
          <div class="card"><h2 class="disp">The rules</h2>${rulesList(null)}</div>
        </div>
      </section></div>`;
    let n = 10, mode = "live";
    const f = $("#create");
    $$("[data-n]", f).forEach((b) => (b.onclick = () => { n = +b.dataset.n; $$("[data-n]", f).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    $$("[data-m]", f).forEach((b) => (b.onclick = () => { mode = b.dataset.m; $$("[data-m]", f).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f), pin = String(fd.get("pin"));
      const btn = $("button[type=submit]", f); btn.disabled = true;
      const L = H.newLeague({ cba: NBA.cba, teams: n, name: fd.get("name"), now: Date.now(), opener, settings: { draftMode: mode } });
      const tname = String(fd.get("tname") || "").trim();
      if (tname) renameTeam(L, 0, tname);
      try {
        const r = await rpc("hc_create", { p_name: fd.get("name"), p_pin: pin, p_state: L });
        if (r.error) throw new Error(r.error);
        const c = await rpc("hc_claim", { p_id: r.id, p_team: 0, p_manager: fd.get("manager"), p_pin: pin });
        if (c.error) throw new Error(c.error);
        store.set("hc:me:" + r.id, { team: 0, pin, commish: pin });
        store.set("hc:leagues", [{ id: r.id, name: String(fd.get("name")) }, ...mine.filter((x) => x.id !== r.id)].slice(0, 12));
        location.href = `?l=${r.id}#commish`;
      } catch (err) { btn.disabled = false; toast(err.message, true); }
    };
  }

  /* ---------- League Office ---------- */
  function defaultWeek() {
    const cw = curWeek();
    if (STATS.wk && STATS.wk[String(cw)]) return cw;
    const done = Object.keys(STATS.wk || {}).map(Number).filter((w) => w < cw && w >= LG.settings.startWeek);
    return done.length ? Math.max(...done) : cw;
  }
  function phaseBanner() {
    const p = LG.phase, claimed = LG.teams.filter((t) => t.owner).length;
    if (p === "lobby") {
      const link = location.origin + location.pathname + "?l=" + LID;
      return `<div class="banner"><div><div class="disp">Pre-draft</div><div class="muted small">${claimed} of ${LG.teams.length} teams claimed. ${LG.settings.draftMode === "slow" ? `Slow draft, ${LG.settings.slowHours} hours a pick.` : `Live draft, ${LG.settings.clock} seconds a pick.`} The commissioner starts the draft.</div></div><span class="grow"></span>
        <button class="btn" data-act="copy" data-text="${esc(link)}">Copy invite link</button>${myTeam() ? "" : `<button class="btn go" data-act="claim">Claim a team</button>`}</div>`;
    }
    if (p === "nba") { const c = H.onClock(LG, now()); return `<div class="banner gold"><div><div class="disp">The draft is on</div><div class="muted small">Pick ${c.pick} of ${c.total}: ${esc(LG.teams[c.team].name)} is on the clock.</div></div><span class="grow"></span><a class="btn go" href="#draft">Go to the Draft Room</a></div>`; }
    if (p === "prospects") return `<div class="banner gold"><div><div class="disp">Prospect Board auction</div><div class="muted small">Blind FAAB bids for two prospect spots. Closes ${fmtWhen(LG.due.auction)}.</div></div><span class="grow"></span><a class="btn go" href="#draft/prospects">Place bids</a></div>`;
    const cw = curWeek();
    return `<div class="banner"><div><div class="disp">Week ${cw}</div><div class="muted small">${weekLabel(cw)}. Waivers run ${fmtWhen(LG.due.waiver || H.nextWaiverRun(now()))}.</div></div></div>`;
  }
  const weekLabel = (w) => { const [a, b] = H.weekDates(opener, w); return `${fmtDate(a)} to ${fmtDate(b)}`; };

  function viewOffice() {
    const cw = curWeek();
    const st = LG.phase === "league" ? H.standings(LG, cw - 1, STATS.wk, BY) : LG.teams.map((t) => ({ id: t.id, w: 0, l: 0, t: 0, pct: 0, mw: 0, ml: 0, mt: 0, gmsc: 0, pf: [] }));
    const rows = st.map((r, i) => {
      const t = LG.teams[r.id], pay = H.payroll(t, BY), line = H.ceilingOf(LG, t), room = line - pay;
      return `<tr class="${isMine(t) ? "me" : ""}${i === LG.settings.playoffTeams - 1 && LG.phase === "league" ? " cut" : ""}">
        <td class="r num">${i + 1}</td>
        <td><a class="btn link" href="#team/${t.id}">${esc(t.name)}</a> ${ownerTag(t)} ${tierTag(t)}<div class="ps">${t.owner ? esc(t.owner) : "Bot until claimed"}</div></td>
        <td class="r num">${r.w}-${r.l}-${r.t}</td><td class="r num hide-s">${r.pct.toFixed(3).replace(/^0/, "")}</td>
        <td class="r num hide-m">${r.gmsc.toFixed(0)}</td>
        <td class="r num">${money(pay)}</td><td class="r num hide-s">${money(line)}</td>
        <td class="r num"><b class="${room >= 0 ? "ok" : "bad"}">${money(room)}</b></td>
        <td class="r num">$${t.faab}</td><td class="r num hide-s">${t.prospects.length}/${LG.settings.prospects}</td><td class="r num hide-m">$${H.owed(LG, t)}</td></tr>`;
    }).join("");
    const counts = LG.settings.tiers.map((tier, k) => ({ tier, n: LG.teams.filter((t) => (t.tier || 0) === k).length }));
    const ms = LG.phase === "league" ? H.matchups(LG, defaultWeek(), STATS.wk, BY) : [];
    const recent = LG.log.slice(-6).reverse();
    return `${phaseBanner()}
      <div class="cols"><section class="stack"><div class="head"><h1 class="disp">Standings and cap space</h1></div>
        <div class="table-wrap"><table class="t"><thead><tr><th class="r">#</th><th>Team</th><th class="r">Cats</th><th class="r hide-s">Pct</th><th class="r hide-m">GmSc</th><th class="r">On books</th><th class="r hide-s">Line</th><th class="r">Room</th><th class="r">FAAB</th><th class="r hide-s">Prosp</th><th class="r hide-m">Owes</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="ps">Room is what each team can still add under its own line: the number to check before you call about a trade. ${LG.phase === "league" ? `Top ${LG.settings.playoffTeams} make the playoffs after week ${LG.settings.regWeeks}.` : ""}</p>
        ${ms.length ? `<div class="head"><h2 class="disp" style="font-size:26px;margin:0">Week ${defaultWeek()}</h2><a class="btn sm" href="#matchups">Matchup Center</a></div><div class="slate">${ms.map((m, i) => gameCard(m, i)).join("")}</div>` : ""}
      </section>
      <aside class="stack">
        <div class="card"><h3>The pot</h3><div class="disp" style="font-size:44px">$${H.pot(LG)}</div>
          <dl class="kv" style="margin-top:8px">${counts.map((c) => `<dt>${esc(c.tier.label)} ($${LG.settings.buyIn + c.tier.add})</dt><dd>${c.n} team${c.n === 1 ? "" : "s"}</dd>`).join("")}</dl>
          <dl class="kv" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">${LG.settings.payout.map((pc, k) => `<dt>${["Champion", "Runner-up", "Third place"][k] || ordinal(k + 1)} (${pc}%)</dt><dd>$${Math.round((H.pot(LG) * pc) / 100)}</dd>`).join("")}</dl>
          <p class="ps" style="margin-bottom:0">Tier upgrades are tagged on every team and can't be undone this season.</p></div>
        ${LG.phase === "league" ? officeBracket() : ""}
        ${LG.phase === "league" ? summerCard(st) : ""}
        <div class="card"><h3>Latest moves</h3>${recent.length ? `<ul class="list">${recent.map((x) => `<li><span>${esc(x.text)}</span></li>`).join("")}</ul>` : `<p class="empty">Nothing yet.</p>`}<a class="btn sm" href="#tx">All transactions</a></div>
      </aside></div>`;
  }
  function officeBracket() {
    const b = H.bracket(LG, STATS.wk, BY);
    const nm = (id) => esc(LG.teams[id].name);
    const R = LG.settings.regWeeks, cw = curWeek();
    const title = b.champ != null ? "Champion" : cw > R ? "Playoffs" : "If the season ended today";
    return `<div class="card"><h3>${title}</h3>${b.champ != null ? `<div class="disp" style="font-size:26px">${nm(b.champ)}</div><dl class="kv" style="margin-top:8px"><dt>Runner-up</dt><dd>${nm(b.place[1])}</dd><dt>Third</dt><dd>${nm(b.place[2])}</dd></dl>` : ""}
      <ul class="list">${b.semis.map((m, k) => `<li><span class="lbl" style="min-width:56px">${k ? "2 v 3" : "1 v 4"}</span><span>${nm(m.a)} vs ${nm(m.b)}</span></li>`).join("")}${b.final ? `<li><span class="lbl" style="min-width:56px">Final</span><span>${nm(b.final.a)} vs ${nm(b.final.b)}</span></li>` : ""}</ul>
      <p class="ps" style="margin-bottom:0">Top ${LG.settings.playoffTeams}: semifinals in week ${R + 1}, final and third-place game in week ${R + 2}.</p></div>`;
  }
  function summerCard(st) {
    const order = st.map((r) => r.id);
    const b = H.summerBudgets(LG, order, {});
    return `<div class="card"><h3>Summer draft budgets</h3><p class="ps" style="margin-top:0">One FAAB auction next summer for incoming rookies and unsigned free agents. Worse teams get more to spend; letting an expiring player walk adds $${LG.settings.compDollars}. If the season ended today:</p>
      <ul class="list">${order.slice().reverse().map((id) => `<li><span>${esc(LG.teams[id].name)}</span><span class="grow"></span><b class="num">$${b[id]}</b></li>`).join("")}</ul></div>`;
  }
  function gameCard(m, i) {
    const A = LG.teams[m.a], B = LG.teams[m.b], c = m.cmp;
    return `<button class="game${isMine(A) || isMine(B) ? " on" : ""}" data-pair="${i}">${m.label ? `<span class="lbl">${m.label}</span>` : ""}<span class="ln ${c.w >= c.l ? "" : "trail"}"><span>${esc(A.name)}</span><span class="num">${c.w}</span></span><span class="ln ${c.l >= c.w ? "" : "trail"}"><span>${esc(B.name)}</span><span class="num">${c.l}</span></span><span class="ps">Game Score ${m.A.t.gmsc.toFixed(0)} to ${m.B.t.gmsc.toFixed(0)}${c.t ? `, ${c.t} tied` : ""}</span></button>`;
  }

  /* ---------- Cap Sheet ---------- */
  function viewTeam(arg) {
    const t = LG.teams[arg != null && LG.teams[+arg] ? +arg : me.team != null ? me.team : 0];
    const mine = isMine(t);
    const views = [["lineup", "Roster and lineup"], ["contracts", "Contracts"], ...(mine && LG.phase === "league" ? [["fits", "What fits"]] : [])];
    if (!views.some((v) => v[0] === ui.tv)) ui.tv = "lineup";
    const body = { lineup: teamLineup, contracts: teamContracts, fits: teamFits }[ui.tv](t, mine);
    const tiers = LG.settings.tiers;
    const sick = H.irProblem(LG, t, INJ);
    const tierCard = `<div class="card"><h3>Spending tier</h3><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="disp" style="font-size:26px">${esc(H.tierOf(LG, t).label)}</span><span class="muted">${money(H.ceilingOf(LG, t))} line, owes $${H.owed(LG, t)}</span></div>
      ${mine ? `<div class="tools" style="margin-top:10px">${tiers.map((x, k) => (k > (t.tier || 0) ? `<button class="btn sm" data-tier="${k}">Move up to ${esc(x.label)} (+$${x.add - H.tierOf(LG, t).add})</button>` : "")).join("") || `<span class="muted small">Top tier. Nowhere left to climb.</span>`}</div>
        <p class="ps" style="margin-bottom:0">Upgrades are permanent for the season and open through week ${LG.settings.tierDeadline}.</p>` : ""}
      ${t.tierLog.length ? `<ul class="list" style="margin-top:8px">${t.tierLog.map((x) => `<li><time>${fmtDate(x.at)}</time><span>Moved up to ${esc(tiers[x.tier].label)}</span></li>`).join("")}</ul>` : ""}</div>`;
    return `<div class="teampick">${LG.teams.map((x) => `<a class="btn sm${x.id === t.id ? " go" : ""}" href="#team/${x.id}">${esc(x.abbr)}</a>`).join("")}</div>
      <div class="head"><h1 class="disp">${esc(t.name)}</h1><span>${ownerTag(t)} ${tierTag(t)}</span><span class="muted">${t.owner ? esc(t.owner) : "Open team, run by a bot"}, $${t.faab} FAAB</span></div>
      ${sick ? `<div class="banner gold"><div><b>${esc(nameOf(sick))} is healthy on IR.</b> <span class="muted">Activate or release him before any adds or trades.</span></div></div>` : ""}
      <div class="card">${capBar(t)}${(t.ir || []).length ? `<p class="ps" style="margin:0">${t.ir.map((id) => `${esc(nameOf(id))} (${money(BY[id].sal)})`).join(", ")} on IR, off the books.</p>` : ""}</div>
      <div class="cols"><section class="stack"><div class="tools">${views.map(([k, n]) => `<button class="btn sm${ui.tv === k ? " go" : ""}" data-tv="${k}">${n}</button>`).join("")}</div>${body}</section>
      <aside class="stack">${tierCard}
        <div class="card"><h3>Prospect rights</h3>${t.prospects.length ? `<ul class="list">${t.prospects.map((id) => `<li><span>${pl(id)} <span class="ps">${esc(PBY[id] ? `${PBY[id].school}, ${PBY[id].pos}, big board ${PBY[id].rank}` : "")}</span></span><span class="grow"></span>${mine && LG.phase === "league" ? `<button class="btn sm" data-drop="${id}">Release</button>` : ""}</li>`).join("")}</ul>` : `<p class="empty">${LG.phase === "league" ? "None. Unclaimed prospects are in the Player Market." : "The Prospect Board auction follows the draft."}</p>`}</div>
        ${mine && (LG.phase === "lobby" || LG.phase === "nba") ? `<div class="card"><h3>Draft queue</h3>${t.queue.length ? `<ol class="list">${t.queue.map((id, i) => `<li><span>${i + 1}. ${pl(id)}</span><span class="grow"></span><button class="btn sm" data-unqueue="${id}">Remove</button></li>`).join("")}</ol>` : `<p class="empty">Add players from the Player Market. If your clock runs out, the first one who fits is your pick.</p>`}</div>` : ""}
      </aside></div>`;
  }
  // The week a lineup edit applies to: this week until its first tip, then next week.
  const editWeek = () => { const cw = curWeek(); return now() < H.lockTime(opener, cw) ? cw : Math.min(cw + 1, H.totalWeeks(LG)); };
  function teamLineup(t, mine) {
    if (LG.phase !== "league") {
      const ids = H.active(t).map((id) => BY[id]).filter(Boolean).sort((a, b) => b.sal - a.sal);
      return `<div class="table-wrap"><table class="t"><thead><tr><th>Player</th><th>Pos</th><th class="r">2026-27</th><th class="r">HC</th>${LINE_HEAD}</tr></thead><tbody>${ids.map((p) => `<tr><td>${pl(p.id, true)}</td><td class="ps">${H.positions(p).join("/")}</td><td class="r"><span class="sal num">${money(p.sal)}</span></td>${hcCell(p)}${lineCells(p)}</tr>`).join("") || `<tr><td colspan="14" class="empty">No players yet.</td></tr>`}</tbody></table></div>`;
    }
    const w = ui.lw && ui.lw >= curWeek() ? ui.lw : editWeek();
    const locked = now() >= H.lockTime(opener, w);
    const lu = (ui.draftLineup && ui.draftLineup.w === w && ui.draftLineup.t === t.id) ? ui.draftLineup.slots : H.lineupFor(LG, t, w, BY);
    const ros = H.rosterInWeek(t, w).filter((id) => !(t.ir || []).includes(id));
    const bench = ros.filter((id) => !lu.includes(id));
    const s = (id) => seasonLine(id);
    const row = (slot, id, i) => {
      const p = id && BY[id], l = id && s(id), g = l ? l[0] : 0, pg = (k) => (g ? (l[C[k]] / g).toFixed(1) : "-");
      const choose = mine && !locked && i != null ? `<select class="slot" data-slot="${i}" aria-label="Who plays ${slot}"><option value="">Empty</option>${ros.filter((x) => H.eligible(BY[x], slot)).map((x) => `<option value="${x}"${x === id ? " selected" : ""}>${esc(BY[x].n)}${lu.includes(x) && x !== id ? " (starting)" : ""}</option>`).join("")}</select>` : "";
      const out = id && H.isOut(INJ[id]);
      return `<tr class="${slot === "BN" ? "dim" : ""}"><td><b class="tag${slot === "BN" ? "" : " w"}">${slot}</b></td><td>${choose ? `${choose}${p ? `<div class="ps">${p.t}, ${H.positions(p).join("/")}, ${p.age}${injTag(id)} <button type="button" class="btn link ps" data-player="${id}">Card</button></div>` : ""}` : p ? pl(id, true) : `<span class="muted">Empty</span>`}</td>
        <td class="r"><span class="sal num">${p ? money(p.sal) : ""}</span></td>${p ? hcCell(p) : "<td></td>"}<td class="r num">${g || "-"}</td><td class="r num">${pg("pts")}</td><td class="r num hide-s">${pg("reb")}</td><td class="r num hide-s">${pg("ast")}</td>
        <td class="r" style="white-space:nowrap">${mine && p ? `${out && (t.ir || []).length < LG.settings.irSlots ? `<button class="btn sm" data-ir="${id}">To IR</button> ` : ""}<button class="btn sm" data-drop="${id}">Release</button>` : !mine && p && myTeam() ? `<button class="btn sm" data-trade="${t.id}" data-pid="${id}">Trade</button>` : ""}</td></tr>`;
    };
    return `<div class="tools"><b>Week ${w} lineup</b><span class="muted small">${weekLabel(w)}, ${locked ? "locked" : `locks ${fmtWhen(H.lockTime(opener, w))}`}</span><span class="grow"></span>
        ${w > curWeek() ? `<button class="btn sm" data-lw="${w - 1}">This week</button>` : w < H.totalWeeks(LG) ? `<button class="btn sm" data-lw="${w + 1}">Next week</button>` : ""}
        ${mine && !locked ? `<button class="btn sm" data-lauto>Best lineup</button><button class="btn sm go" data-lsave="${w}">Save lineup</button>` : ""}</div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Slot</th><th>Player</th><th class="r">Salary</th><th class="r">HC</th><th class="r">GP</th><th class="r">PTS</th><th class="r hide-s">REB</th><th class="r hide-s">AST</th><th></th></tr></thead><tbody>
        ${lu.map((id, i) => row(H.SLOTS[i], id, i)).join("")}${bench.map((id) => row("BN", id, null)).join("")}
        ${(t.ir || []).map((id) => { const p = BY[id]; return `<tr><td><b class="tag t3">IR</b></td><td>${pl(id, true)}</td><td class="r"><span class="sal num muted">${money(p.sal)}</span><div class="ps">off the books</div></td><td colspan="5" class="ps">${esc((INJ[id] || [])[1] || (INJ[id] ? INJ[id][0] : "Healthy: activate him"))}</td><td class="r">${mine ? `<button class="btn sm go" data-activate="${id}">Activate</button>` : ""}</td></tr>`; }).join("")}
      </tbody></table></div>
      <p class="ps">Only the nine starters score. Lineups are weekly and lock at the week's first tip; if you never set one, the best available lineup is set for you. Players listed Out can move to IR (${LG.settings.irSlots} spots), where their salary doesn't count against your line.</p>`;
  }
  function teamContracts(t) {
    const ids = [...H.rostered(t)].map((id) => BY[id]).filter(Boolean).sort((a, b) => b.sal - a.sal);
    const yrs = [0, 1, 2, 3, 4];
    const cell = (p, i) => {
      const v = i === 0 ? p.sal : p.future[i - 1];
      if (v) return `<td class="r num">${money(v)}${p.opt[i] ? ` <span class="pill">${esc(p.opt[i])}</span>` : ""}</td>`;
      if (p.fa.year === 2026 + i) return `<td class="r"><span class="tag ${p.fa.kind === "RFA" ? "t1" : "w"}">${p.fa.kind}</span></td>`;
      return `<td></td>`;
    };
    const totals = yrs.map((i) => ids.filter((p) => !(t.ir || []).includes(p.id) || i > 0).reduce((s, p) => s + ((i === 0 ? p.sal : p.future[i - 1]) || 0), 0));
    const line = H.ceilingOf(LG, t);
    return `<div class="table-wrap"><table class="t"><thead><tr><th>Player</th>${yrs.map((i) => `<th class="r">${season(i)}</th>`).join("")}</tr></thead><tbody>
      ${ids.map((p) => `<tr><td>${pl(p.id, true)}${(t.ir || []).includes(p.id) ? ` <span class="tag t3">IR</span>` : ""}</td>${yrs.map((i) => cell(p, i)).join("")}</tr>`).join("")}
      <tr><td><b>Committed</b><div class="ps">IR salary left out this season</div></td>${totals.map((v) => `<td class="r num"><b>${money(v)}</b></td>`).join("")}</tr>
      <tr><td><b>Room under ${money(line)}</b><div class="ps">This season's line, before raises</div></td>${totals.map((v) => `<td class="r num"><b class="${line - v >= 0 ? "ok" : "bad"}">${money(line - v)}</b></td>`).join("")}</tr>
      </tbody></table></div>
      <p class="ps">UFA or RFA marks the summer a deal runs out: RFA means a first-round rookie deal, where his real team can match. When a contract expires you can keep him at his new real salary, trade him before then, or let him go and take a pick in next year's draft. PO, TO and NG are player options, team options and non-guaranteed years. Future lines move with the real cap.</p>`;
  }
  function teamFits(t) {
    const ctx = H.context(LG, POOL);
    const act = H.active(t).map((id) => BY[id]).sort((a, b) => a.z - b.z);
    const drops = ui.drops.filter((id) => act.some((p) => p.id === id));
    const pay = H.payroll(t, BY) - drops.reduce((s, id) => s + BY[id].sal, 0);
    const open = LG.settings.roster - (act.length - drops.length);
    const room = H.ceilingOf(LG, t) - pay;
    const fits = open > 0 ? ctx.available.filter((p) => !p.gone && p.sal <= room).sort((a, b) => a.rank - b.rank).slice(0, 40) : [];
    return `<div class="card"><h3>Release someone, see who fits</h3><p class="ps" style="margin-top:0">Check the players you'd let go. Nothing changes until you place a bid.</p>
      <div class="tools">${act.map((p) => `<label class="chip" style="cursor:pointer"><input type="checkbox" data-fdrop="${p.id}"${drops.includes(p.id) ? " checked" : ""}> ${esc(last(p.n))} ${money(p.sal)}</label>`).join("")}</div>
      <p style="margin:12px 0 0"><b class="${room >= 0 ? "ok" : "bad"}">${money(room)} of room</b> <span class="muted">with ${open} open spot${open === 1 ? "" : "s"}.</span></p></div>
      ${open > 0 ? `<div class="table-wrap"><table class="t"><thead><tr><th class="r">Rk</th><th>Free agent who fits</th><th class="r">Salary</th><th class="r">HC</th>${LINE_HEAD}<th></th></tr></thead><tbody>
        ${fits.map((p) => `<tr><td class="r num ps">${p.rank}</td><td>${pl(p.id, true)}</td><td class="r"><span class="sal num">${money(p.sal)}</span></td>${hcCell(p)}${lineCells(p)}<td class="r"><button class="btn sm go" data-bid="${p.id}" data-biddrop="${drops[0] || ""}">Bid</button></td></tr>`).join("") || `<tr><td colspan="14" class="empty">Nobody available fits that much room.</td></tr>`}
        </tbody></table></div>` : `<p class="empty">Check at least one player to open a spot.</p>`}`;
  }

  /* ---------- Player Market ---------- */
  function viewMarket() {
    const ctx = H.context(LG, POOL);
    const t = myTeam();
    const q = ui.q.trim().toLowerCase();
    if (ui.kind === "prospects") {
      const rows = PROS.filter((p) => (ui.status === "all" || (ui.status === "fa" ? ctx.own[p.id] == null : ctx.own[p.id] != null)) && (!q || p.n.toLowerCase().includes(q) || p.school.toLowerCase().includes(q)));
      return marketTools() + `<div class="table-wrap"><table class="t"><thead><tr><th class="r">Board</th><th>Prospect</th><th>School</th><th class="r">Age</th><th>Rights</th><th></th></tr></thead><tbody>
        ${rows.map((p) => { const o = ctx.own[p.id]; return `<tr><td class="r num ps">${p.rank}</td><td>${pl(p.id)}<div class="ps">${p.pos}</div></td><td>${esc(p.school)}</td><td class="r num">${p.age.toFixed(1)}</td>
          <td>${o != null ? `<a class="btn link" href="#team/${o}">${esc(LG.teams[o].abbr)}</a>` : `<span class="muted">Available</span>`}</td>
          <td class="r">${o == null && t ? (LG.phase === "league" ? `<button class="btn sm go" data-bid="${p.id}">Bid</button>` : LG.phase === "prospects" ? `<a class="btn sm go" href="#draft/prospects">Auction</a>` : "") : ""}</td></tr>`; }).join("")}</tbody></table></div>`;
    }
    let rows = POOL.filter((p) => (ui.status === "all" || (ui.status === "fa" ? ctx.own[p.id] == null && !p.gone : ctx.own[p.id] != null)) && (!q || p.n.toLowerCase().includes(q)) && passFilters(p));
    rows.sort(SORTS[ui.sort] || SORTS.rank);
    const total = rows.length;
    rows = rows.slice(0, 200);
    return marketTools(total) + `<div class="table-wrap"><table class="t"><thead><tr><th class="r" title="Nine-category rank">Rk</th><th class="r hide-s" title="Dynasty rank">Dyn</th>${YAHOO.players ? `<th class="r hide-m" title="Yahoo rank this season">Y!</th>` : ""}<th>Player</th><th>Status</th><th class="r">Salary</th><th class="r" title="HC Score: value over replacement per $10M">HC</th>${LINE_HEAD}<th></th></tr></thead><tbody>
      ${rows.map((p) => {
        const o = ctx.own[p.id];
        let act = "";
        if (t && o == null && (LG.phase === "lobby" || LG.phase === "nba")) act = t.queue.includes(p.id) ? `<button class="btn sm" data-unqueue="${p.id}">Queued</button>` : `<button class="btn sm" data-queue="${p.id}">Queue</button>`;
        else if (t && o == null && LG.phase === "league" && !p.gone) act = `<button class="btn sm go" data-bid="${p.id}">Bid</button>`;
        else if (t && o != null && o !== t.id && LG.phase === "league") act = `<button class="btn sm" data-trade="${o}" data-pid="${p.id}">Trade</button>`;
        const g = perGame(p);
        return `<tr class="${o === me.team && me.team != null ? "me" : ""}"><td class="r num ps">${p.rank}</td><td class="r num ps hide-s">${p.dynRank}</td>${YAHOO.players ? `<td class="r num ps hide-m">${(YAHOO.players[p.id] || {}).ar || (YAHOO.players[p.id] || {}).or || "-"}</td>` : ""}<td>${pl(p.id)}<div class="ps">${p.t}, ${H.positions(p).join("/")}, ${p.age}${g && g.prev ? ", 2025-26 line" : ""}</div></td>
          <td>${o != null ? `<a class="btn link" href="#team/${o}">${esc(LG.teams[o].abbr)}</a>` : `<span class="muted">Free agent</span>`}</td>
          <td class="r"><div class="sal num">${money(p.sal)}</div><div class="ps">${p.future.length ? `thru ${season(p.future.length).slice(2)}` : "expiring"}, ${p.fa.kind}</div></td>${hcCell(p)}${lineCells(p)}<td class="r">${act}</td></tr>`;
      }).join("") || `<tr><td colspan="16" class="empty">No one matches. Clear the search or filters.</td></tr>`}</tbody></table></div>`;
  }
  const SORTS = { rank: (a, b) => a.rank - b.rank, dyn: (a, b) => a.dynRank - b.dynRank, hc: (a, b) => b.hc - a.hc, sal: (a, b) => b.sal - a.sal, cheap: (a, b) => a.sal - b.sal,
    pts: (a, b) => stat(b, "pts") - stat(a, "pts"), reb: (a, b) => stat(b, "reb") - stat(a, "reb"), ast: (a, b) => stat(b, "ast") - stat(a, "ast"), tpm: (a, b) => stat(b, "tpm") - stat(a, "tpm"),
    stl: (a, b) => stat(b, "stl") - stat(a, "stl"), blk: (a, b) => stat(b, "blk") - stat(a, "blk"), young: (a, b) => a.age - b.age,
    yahoo: (a, b) => yrank(a) - yrank(b) };
  const yrank = (p) => { const y = YAHOO.players && YAHOO.players[p.id]; return y ? y.ar || y.or || 999 : 999; };
  function stat(p, k) { const g = perGame(p); return g ? g.l[C[k]] : -1; }
  const SAL = { "": [0, Infinity], a: [0, 5e6], b: [5e6, 15e6], c: [15e6, 30e6], d: [30e6, Infinity] };
  function passFilters(p) {
    const f = ui.f;
    if (f.pos && !H.eligible(p, f.pos)) return false;
    if (f.team && p.t !== f.team) return false;
    const [lo, hi] = SAL[f.sal] || SAL[""];
    if (p.sal < lo || p.sal >= hi) return false;
    if (f.con === "exp" && p.future.length) return false;
    if (f.con === "multi" && p.future.length < 2) return false;
    if (f.con === "rfa" && p.fa.kind !== "RFA") return false;
    if (f.con === "fit" && myTeam() && !H.check(LG, myTeam(), p, H.context(LG, POOL)).ok) return false;
    if (f.age === "y" && p.age > 24) return false;
    if (f.age === "p" && (p.age < 25 || p.age > 29)) return false;
    if (f.age === "v" && p.age < 30) return false;
    if (f.inj === "out" && !H.isOut(INJ[p.id])) return false;
    return true;
  }
  // On phones the filters fold behind one button; on wider screens they're always out.
  function filterBox() {
    const n = Object.values(ui.f).filter(Boolean).length + (ui.sort !== "rank" ? 1 : 0);
    return `<div class="fbox${ui.fopen ? " open" : ""}"><button type="button" class="btn sm ftoggle" data-ftoggle>Filters and sort${n ? ` (${n})` : ""}</button>
      <div class="tools fbody" style="margin-top:6px">${filterBar()}${n ? `<button class="btn sm" data-fclear>Clear</button>` : ""}</div></div>`;
  }
  function filterBar() {
    const teams = [...new Set(POOL.map((p) => p.t))].sort();
    const sel = (key, label, opts) => `<label class="sr" for="f-${key}">${label}</label><select id="f-${key}" data-f="${key}">${opts.map(([v, n]) => `<option value="${v}"${(ui.f[key] || "") === v ? " selected" : ""}>${n}</option>`).join("")}</select>`;
    return sel("pos", "Position", [["", "All positions"], ["PG", "PG"], ["SG", "SG"], ["G", "G"], ["SF", "SF"], ["PF", "PF"], ["F", "F"], ["C", "C"]])
      + sel("team", "NBA team", [["", "All NBA teams"], ...teams.map((t) => [t, t])])
      + sel("sal", "Salary", [["", "Any salary"], ["a", "Under $5M"], ["b", "$5M to $15M"], ["c", "$15M to $30M"], ["d", "$30M and up"]])
      + sel("con", "Contract", [["", "Any contract"], ["exp", "Expiring"], ["multi", "Signed 2+ more years"], ["rfa", "Heading to RFA"], ...(myTeam() ? [["fit", "Fits my room now"]] : [])])
      + sel("age", "Age", [["", "Any age"], ["y", "24 and under"], ["p", "25 to 29"], ["v", "30 and over"]])
      + sel("inj", "Health", [["", "Any health"], ["out", "Listed Out"]])
      + `<label class="sr" for="msort">Sort</label><select id="msort">${[["rank", "Sort: nine-cat rank"], ["dyn", "Sort: dynasty rank"], ["hc", "Sort: HC Score (value per $)"], ["sal", "Sort: salary, high to low"], ["cheap", "Sort: salary, low to high"], ["pts", "Sort: points"], ["reb", "Sort: rebounds"], ["ast", "Sort: assists"], ["tpm", "Sort: threes"], ["stl", "Sort: steals"], ["blk", "Sort: blocks"], ["young", "Sort: youngest"], ...(YAHOO.players ? [["yahoo", "Sort: Yahoo rank"]] : [])].map(([k, n]) => `<option value="${k}"${ui.sort === k ? " selected" : ""}>${n}</option>`).join("")}</select>`;
  }
  function marketTools(total) {
    return `<div class="head"><h1 class="disp">Player Market</h1>${total != null ? `<span class="muted">${total} player${total === 1 ? "" : "s"}</span>` : ""}</div><div class="tools">
      <div class="seg" role="group" aria-label="Pool">${[["nba", "NBA players"], ["prospects", "Prospect Board"]].map(([k, n]) => `<button type="button" data-kind="${k}" aria-pressed="${ui.kind === k}">${n}</button>`).join("")}</div>
      <div class="seg" role="group" aria-label="Status">${[["fa", "Available"], ["own", "On rosters"], ["all", "All"]].map(([k, n]) => `<button type="button" data-status="${k}" aria-pressed="${ui.status === k}">${n}</button>`).join("")}</div>
      <label class="sr" for="mq">Search</label><input type="search" id="mq" placeholder="Search players or schools" value="${esc(ui.q)}"></div>
      ${ui.kind === "nba" ? filterBox() + `
      <p class="ps" style="margin:0">Rk is nine-category value (z-scores, the way Yahoo ranks), Dyn adds age and upside, HC Score is value over a replacement player per $10M of salary.</p>` : ""}`;
  }

  /* ---------- Matchup Center ---------- */
  function viewMatchups() {
    if (LG.phase !== "league") return `<div class="head"><h1 class="disp">Matchup Center</h1></div><p class="empty">Matchups start once the draft and the Prospect Board auction are done.</p>`;
    const cw = curWeek(), w = Math.min(ui.week || defaultWeek(), H.totalWeeks(LG));
    const ms = H.matchups(LG, w, STATS.wk, BY);
    const nav = `<button class="btn sm" data-wk="${w - 1}" ${w <= 1 ? "disabled" : ""}>Previous week</button><b>Week ${w}${w > LG.settings.regWeeks ? (w === LG.settings.regWeeks + 1 ? ", semifinals" : ", finals") : ""}</b><span class="muted small">${weekLabel(w)}</span><button class="btn sm" data-wk="${w + 1}" ${w >= H.totalWeeks(LG) ? "disabled" : ""}>Next week</button>`;
    if (!ms.length) return `<div class="head"><h1 class="disp">Matchup Center</h1><span class="grow"></span>${nav}</div><p class="empty">The final and the third-place game are set once the semifinals are done.</p>`;
    let i = ui.pair != null ? ui.pair : ms.findIndex((x) => isMine(LG.teams[x.a]) || isMine(LG.teams[x.b]));
    if (i < 0) i = 0;
    const m = ms[i], A = LG.teams[m.a], B = LG.teams[m.b], c = m.cmp;
    const scored = w >= LG.settings.startWeek && STATS.wk && STATS.wk[String(w)];
    const status = w < cw ? "Final" : w === cw ? "In progress" : "Not started";
    return `<div class="head"><h1 class="disp">Matchup Center</h1><span class="grow"></span>${nav}</div>
      <div class="slate">${ms.map((x, k) => gameCard(x, k).replace('class="game', `class="game${k === i ? " on" : ""}`)).join("")}</div>
      <section class="card"><div class="versus"><div><div class="disp nm">${esc(A.name)}</div><div class="ps">${A.owner ? esc(A.owner) : "Bot"}, Game Score ${m.A.t.gmsc.toFixed(1)}</div></div>
        <div class="disp score">${scored ? `${c.w}-${c.l}${c.t ? "-" + c.t : ""}` : "0-0"}<small>${status}</small></div>
        <div class="b"><div class="disp nm">${esc(B.name)}</div><div class="ps">${B.owner ? esc(B.owner) : "Bot"}, Game Score ${m.B.t.gmsc.toFixed(1)}</div></div></div>
        <div class="cats">${c.cats.map((x) => `<div class="cat ${x.out === "w" ? "wa" : x.out === "l" ? "wb" : ""}"><span class="lbl">${x.cat.label}</span><span class="v ${x.out === "w" ? "w" : x.out === "l" ? "l" : ""}">${fmtCat(x.cat, x.a)}</span><span class="v ${x.out === "l" ? "w" : x.out === "w" ? "l" : ""}">${fmtCat(x.cat, x.b)}</span></div>`).join("")}</div>
        ${!scored ? `<p class="empty">${w < LG.settings.startWeek ? "This league starts scoring in week " + LG.settings.startWeek + "." : "No games final yet this week. Scores fill in each morning."}</p>` : ""}</section>
      ${boxTable(A, m.A)}${boxTable(B, m.B)}`;
  }
  const fmtCat = (c, v) => (v == null ? "-" : c.pct ? v.toFixed(3).replace(/^0/, "") : Math.round(v));
  function boxTable(team, tw) {
    const rows = tw.per.map((x) => ({ ...x, p: BY[x.pid] }));
    const v = (l, k) => (l ? Math.round(l[C[k]]) : 0);
    return `<section class="table-wrap"><table class="t"><thead><tr><th>Slot</th><th>${esc(team.name)}</th><th class="r">GP</th><th class="r">PTS</th><th class="r">REB</th><th class="r">AST</th><th class="r hide-s">3PM</th><th class="r hide-s">STL</th><th class="r hide-s">BLK</th><th class="r hide-m">FG</th><th class="r hide-m">FT</th><th class="r hide-m">TO</th><th class="r">GmSc</th></tr></thead><tbody>
      ${rows.map((x) => `<tr class="${x.starter ? "" : "dim"}"><td><b class="tag${x.starter ? " w" : ""}">${x.slot}</b></td><td>${x.pid ? `${pl(x.pid)}<div class="ps">${x.p ? `${x.p.t}, ${money(x.p.sal)}` : ""}</div>` : `<span class="muted">Empty</span>`}</td><td class="r num">${x.gp}</td><td class="r num">${v(x.line, "pts")}</td><td class="r num">${v(x.line, "reb")}</td><td class="r num">${v(x.line, "ast")}</td><td class="r num hide-s">${v(x.line, "tpm")}</td><td class="r num hide-s">${v(x.line, "stl")}</td><td class="r num hide-s">${v(x.line, "blk")}</td><td class="r num hide-m">${x.line ? `${v(x.line, "fgm")}-${v(x.line, "fga")}` : "-"}</td><td class="r num hide-m">${x.line ? `${v(x.line, "ftm")}-${v(x.line, "fta")}` : "-"}</td><td class="r num hide-m">${v(x.line, "tov")}</td><td class="r num"><b>${x.gmsc.toFixed(1)}</b></td></tr>`).join("")}</tbody></table></section>`;
  }

  /* ---------- Transactions ---------- */
  let myBids = { waiver: null, auction: null };
  async function fetchMyBids(kind) {
    if (me.team == null) return [];
    try { const r = await rpc("hc_bids_mine", { p_id: LID, p_team: me.team, p_pin: String(me.pin), p_kind: kind }); myBids[kind] = r.bids || []; }
    catch (e) { myBids[kind] = myBids[kind] || []; }
    return myBids[kind];
  }
  async function putBids(kind, bids) {
    const r = await rpc("hc_bids_put", { p_id: LID, p_team: me.team, p_pin: String(me.pin), p_kind: kind, p_bids: bids });
    if (r.error) { toast(r.error, true); return false; }
    myBids[kind] = bids; return true;
  }
  function viewTx() {
    const t = myTeam();
    const kinds = [["", "All"], ["add", "Adds"], ["drop", "Releases"], ["trade", "Trades"], ["tier", "Tiers"], ["auction", "Prospects"], ["draft", "Draft"], ["commish", "Commissioner"]];
    const items = LG.log.filter((x) => !ui.logKind || x.kind === ui.logKind).slice().reverse();
    const trades = LG.trades.slice().reverse();
    const mineT = t ? trades.filter((x) => x.status === "pending" && (x.from === t.id || x.to === t.id)) : [];
    const bids = myBids.waiver;
    if (t && bids == null && LG.phase === "league") fetchMyBids("waiver").then(() => route().tab === "tx" && render());
    const lr = LG.lastWaiverRun;
    return `<div class="head"><h1 class="disp">Transactions</h1></div>
      <div class="cols"><section class="stack">
        ${t && LG.phase === "league" ? `<div class="card"><h3>Your sealed waiver bids</h3><p class="ps" style="margin-top:0">Nobody else sees these. They run ${fmtWhen(LG.due.waiver || H.nextWaiverRun(now()))}; highest bid wins. You have $${t.faab} FAAB.</p>
          ${bids == null ? `<p class="empty">Loading…</p>` : bids.length ? `<ul class="list">${bids.map((b, i) => `<li><span><b>$${b.amt}</b> on ${esc(nameOf(b.add))}${BY[b.add] ? ` (${money(BY[b.add].sal)})` : ""}${b.drop ? `, releasing ${esc(nameOf(b.drop))}` : ""}</span><span class="grow"></span><button class="btn sm" data-unbid="${i}">Withdraw</button></li>`).join("")}</ul>` : `<p class="empty">No bids. Find someone in the Player Market.</p>`}</div>` : ""}
        <div class="card"><h3>Trades</h3>
          ${mineT.length ? `<ul class="list">${mineT.map((x) => tradeLine(x, t)).join("")}</ul>` : `<p class="empty">No open offers.</p>`}
          ${t && LG.phase === "league" ? `<button class="btn go" data-act-trade>Propose a trade</button>` : ""}
          ${trades.filter((x) => x.status !== "pending").slice(0, 8).length ? `<h3 style="margin-top:14px">Recent</h3><ul class="list">${trades.filter((x) => x.status !== "pending").slice(0, 8).map((x) => {
            const open = x.status === "accepted" && now() - x.closed < LG.settings.vetoHours * H.HOUR;
            return `<li><span>${esc(LG.teams[x.from].abbr)} and ${esc(LG.teams[x.to].abbr)}: ${x.status}${x.why ? ` (${esc(x.why)})` : ""}${open ? `. Commissioner can veto until ${fmtWhen(x.closed + LG.settings.vetoHours * H.HOUR)}` : ""}</span><span class="grow"></span>${open && me.commish ? `<button class="btn sm warn" data-veto="${x.id}">Veto</button>` : ""}</li>`; }).join("")}</ul>` : ""}</div>
        <div class="card"><h3>League log</h3><div class="tools" style="margin-bottom:8px">${kinds.map(([k, n]) => `<button class="btn sm${ui.logKind === k ? " go" : ""}" data-logkind="${k}">${n}</button>`).join("")}</div>
          ${items.length ? `<ul class="list">${items.slice(0, 120).map((x) => `<li><time>${fmtDate(x.at)}</time><span>${esc(x.text)}</span></li>`).join("")}</ul>` : `<p class="empty">Nothing here yet.</p>`}</div>
      </section>
      <aside class="stack">${lr ? `<div class="card"><h3>Last waiver run</h3><p class="ps" style="margin-top:0">${fmtWhen(lr.at)}</p><ul class="list">${lr.results.filter((x) => x.ok).map((x) => `<li><span>${esc(LG.teams[x.team].abbr)} signed ${esc(nameOf(x.add))} for $${x.amt}</span></li>`).join("") || `<li>No signings.</li>`}</ul></div>` : ""}
        ${LG.auction && LG.auction.results.length ? `<div class="card"><h3>Prospect Board results</h3><ul class="list">${LG.auction.results.filter((x) => x.won).map((x) => `<li><span>${esc(LG.teams[x.team].abbr)}: ${esc(nameOf(x.pid))}, $${x.amt}</span></li>`).join("")}</ul></div>` : ""}</aside></div>`;
  }
  function tradeLine(x, t) {
    const A = LG.teams[x.from], B = LG.teams[x.to];
    const nm = (ids, f) => [...ids.map(nameOf), ...(f ? [`$${f} FAAB`] : [])].join(", ") || "nothing";
    const incoming = t && x.to === t.id;
    return `<li style="display:block"><div><b>${esc(A.name)}</b> sends ${esc(nm(x.give, x.faabGive))}</div><div><b>${esc(B.name)}</b> sends ${esc(nm(x.get, x.faabGet))}</div>
      <div class="tools" style="margin-top:6px">${incoming ? `<button class="btn sm go" data-accept="${x.id}">Accept</button><button class="btn sm" data-decline="${x.id}">Decline</button>` : `<span class="ps">Waiting on ${esc(B.name)}</span><button class="btn sm" data-withdraw="${x.id}">Withdraw</button>`}</div></li>`;
  }

  function bidDialog(pid, preDrop) {
    const t = myTeam(), prospect = H.isProspect(pid);
    const p = prospect ? PBY[pid] : BY[pid];
    const pend = (myBids.waiver || []).reduce((s, b) => s + b.amt, 0);
    const opts = prospect ? t.prospects.map((id) => ({ id, n: nameOf(id), z: 0 })) : H.active(t).map((id) => BY[id]).sort((a, b) => a.z - b.z);
    const full = prospect ? t.prospects.length >= LG.settings.prospects : H.active(t).length >= LG.settings.roster;
    dlg(`<h3 class="disp">Bid on ${esc(p.n)}</h3><p class="muted small" style="margin:0">${prospect ? `Prospect rights, ${esc(p.school)}. No salary until he signs his NBA deal.` : `${money(p.sal)} salary, ${contract(p)}`}</p>
      <form class="form" style="margin-top:12px"><div class="field"><label for="amt">Sealed FAAB bid ($${t.faab} budget, $${pend} already bid)</label><input type="number" id="amt" name="amt" min="${LG.settings.minBid}" max="${t.faab}" value="${LG.settings.minBid}" required></div>
      <div class="field"><label for="drop">Release${full ? "" : " (optional)"}</label><select id="drop" name="drop">${full ? "" : `<option value="">Nobody, I have an open spot</option>`}${opts.map((x) => `<option value="${x.id}">${esc(x.n)}${x.sal ? `, ${money(x.sal)}` : ""}</option>`).join("")}</select></div>
      <p class="ps" id="fitMsg" style="margin:0"></p>
      <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go" type="submit">Seal the bid</button></div></form>`, async (fd, f) => {
      const bid = { add: pid, drop: fd.get("drop") || null, amt: Math.floor(+fd.get("amt")) };
      const c = H.bidCheck(LG, POOL, PROS, t.id, bid, INJ);
      if (!c.ok) return errLine(f, c.why);
      const cur = await fetchMyBids("waiver");
      if (bid.amt + cur.filter((b) => b.add !== pid).reduce((s, b) => s + b.amt, 0) > t.faab) return errLine(f, "Your open bids add up to more than your FAAB.");
      if (!(await putBids("waiver", [...cur.filter((b) => b.add !== pid), bid]))) return false;
      toast(`Bid sealed: $${bid.amt} on ${p.n}.`);
    });
    if (!prospect) {
      const sel = $("#drop", D), msg = $("#fitMsg", D), ctx = H.context(LG, POOL);
      const upd = () => { const c = H.check(LG, t, p, ctx, { drop: sel.value || null }); msg.textContent = c.ok ? `Fits: ${money(c.after)} on the books under your ${money(H.ceilingOf(LG, t))} line.` : c.why; msg.className = "ps " + (c.ok ? "ok" : "bad"); };
      if (preDrop) sel.value = preDrop;
      else if (!H.check(LG, t, p, ctx).ok) { const fit = opts.find((x) => H.check(LG, t, p, ctx, { drop: x.id }).ok); if (fit) sel.value = fit.id; }
      sel.onchange = upd; upd();
    }
  }

  function tradeDialog(withTeam, pid) {
    const t = myTeam();
    if (!t) { toast("Sign in to your team first.", true); return; }
    ui.tradeWith = withTeam != null ? withTeam : ui.tradeWith != null ? ui.tradeWith : LG.teams.find((x) => x.id !== t.id).id;
    ui.give = []; ui.get = pid ? [pid] : []; ui.fg = 0; ui.ft = 0;
    drawTrade();
  }
  function drawTrade() {
    const t = myTeam(), o = LG.teams[ui.tradeWith];
    const pieces = (team) => [...H.active(team).map((id) => BY[id]).sort((a, b) => b.sal - a.sal).map((p) => ({ id: p.id, n: p.n, s: money(p.sal) })), ...team.prospects.map((id) => ({ id, n: nameOf(id), s: "prospect" }))];
    const box = (team, key) => `<div><div class="lbl" style="margin-bottom:6px">${esc(team.name)} sends</div>${pieces(team).map((p) => `<label style="display:flex;gap:8px;align-items:center;padding:3px 0"><input type="checkbox" data-side="${key}" value="${p.id}"${ui[key].includes(p.id) ? " checked" : ""}> <span>${esc(p.n)} <span class="ps">${p.s}</span></span></label>`).join("")}</div>`;
    const tr = { from: t.id, to: o.id, give: ui.give, get: ui.get, faabGive: ui.fg || 0, faabGet: ui.ft || 0 };
    const sick = H.irProblem(LG, t, INJ);
    const c = sick ? { ok: false, why: `${nameOf(sick)} is healthy on IR: activate or release him first.` } : curWeek() > LG.settings.tradeDeadline ? { ok: false, why: `The trade deadline was the end of week ${LG.settings.tradeDeadline}.` }
      : ui.give.length || ui.get.length || ui.fg || ui.ft ? H.tradeCheck(LG, POOL, tr) : { ok: false, why: "Pick players or FAAB on either side." };
    const after = (team, out, inn) => H.payroll(team, BY) - out.filter((x) => BY[x]).reduce((s, x) => s + BY[x].sal, 0) + inn.filter((x) => BY[x]).reduce((s, x) => s + BY[x].sal, 0);
    D.innerHTML = `<h3 class="disp">Propose a trade</h3><form class="form" style="margin-top:8px">
      <div class="field"><label for="tw">With</label><select id="tw">${LG.teams.filter((x) => x.id !== t.id).map((x) => `<option value="${x.id}"${x.id === o.id ? " selected" : ""}>${esc(x.name)}${x.owner ? "" : " (bot)"}</option>`).join("")}</select></div>
      <div class="row2" style="max-height:40dvh;overflow:auto">${box(t, "give")}${box(o, "get")}</div>
      <div class="row2"><div class="field"><label for="fg">FAAB you send (you have $${t.faab})</label><input type="number" id="fg" min="0" max="${t.faab}" value="${ui.fg || 0}"></div>
      <div class="field"><label for="ft">FAAB they send (they have $${o.faab})</label><input type="number" id="ft" min="0" max="${o.faab}" value="${ui.ft || 0}"></div></div>
      <dl class="kv"><dt>${esc(t.abbr)} after</dt><dd class="num">${money(after(t, ui.give, ui.get))} of ${money(H.ceilingOf(LG, t))}</dd><dt>${esc(o.abbr)} after</dt><dd class="num">${money(after(o, ui.get, ui.give))} of ${money(H.ceilingOf(LG, o))}</dd></dl>
      <p class="ps ${c.ok ? "ok" : "bad"}" style="margin:0">${c.ok ? "Both sides fit under their lines." : esc(c.why)}</p>
      <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go" type="submit" ${c.ok ? "" : "disabled"}>Send offer</button></div></form>`;
    $$("[data-close]", D).forEach((b) => (b.onclick = () => D.close()));
    $("#tw", D).onchange = (e) => { ui.tradeWith = +e.target.value; ui.get = []; ui.ft = 0; drawTrade(); };
    $("#fg", D).onchange = (e) => { ui.fg = Math.max(0, Math.floor(+e.target.value || 0)); drawTrade(); };
    $("#ft", D).onchange = (e) => { ui.ft = Math.max(0, Math.floor(+e.target.value || 0)); drawTrade(); };
    $$("[data-side]", D).forEach((cb) => (cb.onchange = () => { const k = cb.dataset.side; ui[k] = cb.checked ? [...ui[k], cb.value] : ui[k].filter((x) => x !== cb.value); drawTrade(); }));
    $("form", D).onsubmit = async (e) => {
      e.preventDefault();
      const target = LG.teams[ui.tradeWith];
      const ok = await mutate("Trade offer", (L) => {
        const r = H.proposeTrade(L, POOL, t.id, target.id, ui.give.slice(), ui.get.slice(), now(), ui.fg || 0, ui.ft || 0, curWeek());
        if (r.ok && !L.teams[target.id].owner) H.respondTrade(L, POOL, r.trade.id, H.botWantsTrade(L, POOL, r.trade), curWeek(), now());
        return r;
      });
      if (ok) {
        D.close();
        const tr2 = LG.trades[LG.trades.length - 1];
        toast(target.owner ? `Offer sent to ${target.name}.` : tr2.status === "accepted" ? `${target.name} accepted.` : `${target.name} passed.`);
      }
    };
    if (!D.open) D.showModal();
  }

  /* ---------- player card ---------- */
  function playerCard(id) {
    const own = LG ? H.context(LG, POOL).own[id] : null;
    const owner = own != null ? LG.teams[own] : null;
    const t = LG && myTeam();
    const q = PBY[id];
    if (q) {
      dlg(`<h3 class="disp">${esc(q.n)}</h3><p class="muted" style="margin:0">${esc(q.pos)}, ${esc(q.school)}, age ${q.age.toFixed(1)}. Big board ${q.rank} for the 2027 NBA draft.</p>
        <dl class="kv" style="margin:12px 0"><dt>Rights</dt><dd>${owner ? esc(owner.name) : "Available"}</dd><dt>Cost</dt><dd>Nothing until he signs his NBA deal</dd></dl>
        <div class="acts">${t && !owner && LG.phase === "league" ? `<button class="btn go" type="button" data-cbid="${id}">Bid</button>` : ""}<button class="btn" type="button" data-close>Close</button></div>`);
      wireCard(); return;
    }
    const p = BY[id];
    if (!p) return;
    const inj = INJ[id];
    const yr = (i) => (i === 0 ? p.sal : p.future[i - 1]);
    const years = [0, 1, 2, 3, 4].filter((i) => yr(i) || p.fa.year === 2026 + i);
    const line = (l, label) => l ? `<tr><td>${label}</td><td class="r num">${l[C.gp]}</td><td class="r num">${l[C.min].toFixed(1)}</td><td class="r num">${l[C.pts].toFixed(1)}</td><td class="r num">${l[C.reb].toFixed(1)}</td><td class="r num">${l[C.ast].toFixed(1)}</td><td class="r num">${l[C.tpm].toFixed(1)}</td><td class="r num">${l[C.stl].toFixed(1)}</td><td class="r num">${l[C.blk].toFixed(1)}</td><td class="r num">${pct(l[C.fgm], l[C.fga])}</td><td class="r num">${pct(l[C.ftm], l[C.fta])}</td><td class="r num">${l[C.tov].toFixed(1)}</td></tr>` : "";
    const weeks = Object.entries(STATS.wk || {}).map(([w, x]) => [+w, x[id]]).filter((x) => x[1]).sort((a, b) => b[0] - a[0]);
    const zc = p.zc ? CATS.map((c) => { const z = Math.max(-3, Math.min(3, p.zc[c.k])); return `<div style="display:grid;grid-template-columns:38px 1fr 40px;gap:8px;align-items:center;font-size:12px"><span class="lbl">${c.label}</span>
      <span style="position:relative;height:10px;background:var(--court);border-radius:3px"><span style="position:absolute;top:0;bottom:0;left:50%;width:1px;background:var(--line-2)"></span><span style="position:absolute;top:0;bottom:0;${z >= 0 ? `left:50%;width:${(z / 3) * 50}%;background:var(--lime)` : `right:50%;width:${(-z / 3) * 50}%;background:var(--red)`};border-radius:2px"></span></span><span class="num r">${p.zc[c.k] >= 0 ? "+" : ""}${p.zc[c.k].toFixed(1)}</span></div>`; }).join("") : "";
    const yr2 = YAHOO.players && YAHOO.players[id];
    let act = "";
    if (t && LG.phase === "league") {
      if (own == null) act = `<button class="btn go" type="button" data-cbid="${id}">Bid</button>`;
      else if (own !== t.id) act = `<button class="btn" type="button" data-ctrade="${own}" data-pid="${id}">Trade for him</button>`;
    } else if (t && own == null && (LG.phase === "lobby" || LG.phase === "nba")) act = t.queue.includes(id) ? "" : `<button class="btn" type="button" data-cqueue="${id}">Add to my queue</button>`;
    dlg(`<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><h3 class="disp" style="margin:0">${esc(p.n)}</h3>${injTag(id)}</div>
      <p class="muted" style="margin:2px 0 0">${esc(p.t)}, ${H.positions(p).join("/")}, age ${p.age}, ${p.yos} NBA season${p.yos === 1 ? "" : "s"}${owner ? `. On ${esc(owner.name)}` : LG ? ". Free agent" : ""}${inj ? `. ${esc(inj[0])}: ${esc(inj[1])}` : ""}</p>
      <div class="tools" style="margin:12px 0">${[["Nine-cat rank", p.rank], ["Dynasty rank", p.dynRank], ["HC Score", p.hc.toFixed(1)], ...(yr2 ? [["Yahoo rank", yr2.ar || yr2.or]] : [])].map(([k, v]) => `<div class="card" style="padding:8px 12px"><div class="lbl">${k}</div><div class="disp" style="font-size:26px">${v}</div></div>`).join("")}</div>
      <div class="table-wrap" style="margin-bottom:10px"><table class="t"><thead><tr>${years.map((i) => `<th class="r">${season(i)}</th>`).join("")}</tr></thead><tbody><tr>${years.map((i) => yr(i) ? `<td class="r num"><b>${money(yr(i))}</b>${p.opt[i] ? ` <span class="pill">${esc(p.opt[i])}</span>` : ""}</td>` : `<td class="r"><span class="tag ${p.fa.kind === "RFA" ? "t1" : "w"}">${p.fa.kind}</span></td>`).join("")}</tr></tbody></table></div>
      <div class="table-wrap" style="margin-bottom:10px"><table class="t"><thead><tr><th>Per game</th><th class="r">GP</th><th class="r">MIN</th><th class="r">PTS</th><th class="r">REB</th><th class="r">AST</th><th class="r">3PM</th><th class="r">STL</th><th class="r">BLK</th><th class="r">FG%</th><th class="r">FT%</th><th class="r">TO</th></tr></thead><tbody>${line(p.cur, "2026-27")}${line(p.prev, "2025-26")}</tbody></table></div>
      ${zc ? `<div class="card" style="margin-bottom:10px"><div class="lbl" style="margin-bottom:6px">Category value (z-score per game)</div><div style="display:grid;gap:4px">${zc}</div></div>` : ""}
      ${weeks.length ? `<div class="table-wrap" style="margin-bottom:10px"><table class="t"><thead><tr><th>Fantasy week</th><th class="r">GP</th><th class="r">PTS</th><th class="r">REB</th><th class="r">AST</th><th class="r">GmSc</th></tr></thead><tbody>${weeks.map(([w, l]) => `<tr><td>Week ${w}</td><td class="r num">${l[C.gp]}</td><td class="r num">${Math.round(l[C.pts])}</td><td class="r num">${Math.round(l[C.reb])}</td><td class="r num">${Math.round(l[C.ast])}</td><td class="r num">${H.gameScore(l).toFixed(1)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${p.note ? `<p class="ps">${esc(p.note)}</p>` : ""}
      <div class="acts">${act}<button class="btn" type="button" data-close>Close</button></div>`);
    D.style.maxWidth = "760px";
    wireCard();
  }
  function wireCard() {
    $$("[data-cbid]", D).forEach((b) => (b.onclick = () => { D.close(); fetchMyBids("waiver").then(() => bidDialog(b.dataset.cbid)); }));
    $$("[data-ctrade]", D).forEach((b) => (b.onclick = () => { D.close(); tradeDialog(+b.dataset.ctrade, b.dataset.pid); }));
    $$("[data-cqueue]", D).forEach((b) => (b.onclick = () => { D.close(); const id = b.dataset.cqueue; mutate("Queue", (L) => { const q = L.teams[me.team].queue; if (!q.includes(id)) q.push(id); return { ok: true }; }, { quiet: true }).then((ok) => ok && toast("Added to your queue.")); }));
  }
  D.addEventListener("close", () => (D.style.maxWidth = ""));
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-player]"); if (b && !D.open) { e.preventDefault(); playerCard(b.dataset.player); } });

  /* ---------- Draft Room ---------- */
  function viewDraft(arg) {
    const phase = LG.phase;
    const subs = phase === "lobby" ? [["players", "Players"], ["board", "Board"], ["queue", "My queue"]]
      : phase === "nba" ? [["players", "Players"], ["board", "Board"], ["picks", "Picks"], ["mine", "My team"], ["queue", "My queue"]]
        : [["prospects", "Prospect Board"], ["board", "Draft results"], ["picks", "Every pick"], ["mine", "My team"]];
    if (arg && subs.some((s) => s[0] === arg)) ui.sub = arg;
    if (!subs.some((s) => s[0] === ui.sub)) ui.sub = subs[0][0];
    const c = H.onClock(LG, now());
    const mineOnClock = c && isMine(LG.teams[c.team]);
    const t = myTeam();
    const next = t && phase === "nba" ? H.nextPickOf(LG, t.id) : null;
    const clock = phase === "nba" ? `<div class="clock"><div class="wrap">
        <div><div class="disp on${mineOnClock ? " me" : ""}">${mineOnClock ? "You're on the clock" : esc(LG.teams[c.team].name) + " on the clock"}</div>
        <div class="ps">Round ${c.round}, pick ${c.inRound} (${c.pick} of ${c.total})${LG.teams[c.team].owner ? "" : ", bot"}${next && !mineOnClock ? `. Your next pick: ${next} (${next - c.pick} away)` : ""}${LG.nba.paused ? ". Paused by the commissioner" : ""}</div></div>
        <span class="grow"></span><span class="disp timer" id="timer"></span>
        ${mineOnClock ? `<button class="btn go" data-autome>Autopick</button>` : ""}</div></div>`
      : phase === "lobby" ? `<div class="clock"><div class="wrap"><div><div class="disp on">Draft day prep</div><div class="ps">${LG.settings.draftMode === "slow" ? `Slow draft: ${LG.settings.slowHours} hours a pick.` : `Live draft: ${LG.settings.clock} seconds a pick.`} Build your queue now; it picks for you if your clock runs out.</div></div></div></div>`
        : `<div class="clock"><div class="wrap"><div><div class="disp on">${phase === "prospects" ? "Prospect Board auction" : "Draft results"}</div><div class="ps">${phase === "prospects" ? `Sealed bids from your season FAAB. Closes ${fmtWhen(LG.due.auction)}.` : `Completed ${fmtDate(LG.nba.done || now())}.`}</div></div></div></div>`;
    const body = { players: draftPlayers, board: draftBoard, picks: draftPicks, mine: draftMine, queue: draftQueue, prospects: draftProspects }[ui.sub]();
    return `${clock}<div class="wrap room-shell" id="room"><div class="subtabs" role="group" aria-label="Draft Room views">${subs.map(([k, n]) => `<button data-sub="${k}" aria-pressed="${ui.sub === k}">${n}</button>`).join("")}</div><div class="pane">${body}</div></div>`;
  }
  let ghost = null;
  function draftPlayers() {
    const ctx = H.context(LG, POOL);
    const t = myTeam(), c = H.onClock(LG, now());
    const myTurn = c && t && c.team === t.id;
    const q = ui.q.trim().toLowerCase();
    let rows = ctx.available.filter((p) => !p.gone && (!q || p.n.toLowerCase().includes(q)) && passFilters(p));
    rows.sort(SORTS[ui.sort] || SORTS.rank);
    const checked = rows.map((p) => ({ p, c: t ? H.check(LG, t, p, ctx, { reserve: true }) : { ok: true } }));
    const shown = (ui.fit ? checked.filter((x) => x.c.ok) : checked).slice(0, 180);
    return `${t ? `<div id="mycap">${capBar(t, { ghost, ctx, reserve: true })}</div>` : ""}
      <div class="tools"><label class="sr" for="dq">Search</label><input type="search" id="dq" placeholder="Search players or teams" value="${esc(ui.q)}">
        ${t ? `<label class="small muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="dfit"${ui.fit ? " checked" : ""}> Only players I can fit</label>` : ""}</div>${filterBox()}
      <div class="split"><div class="table-wrap" id="pool"><table class="t"><thead><tr><th class="r">Rk</th><th>Player</th><th class="r">Salary</th><th class="r" title="HC Score">HC</th>${LINE_HEAD}<th></th></tr></thead><tbody>
        ${shown.map(({ p, c: k }) => `<tr data-pid="${p.id}" class="${k.ok ? "" : "dim"}"><td class="r num ps">${p.rank}</td><td>${pl(p.id)}<div class="ps">${p.t}, ${H.positions(p).join("/")}, ${p.age}, dyn ${p.dynRank}</div>${k.ok ? "" : `<div class="why">${esc(k.why)}</div>`}</td>
          <td class="r"><div class="sal num">${money(p.sal)}</div><div class="ps">${p.future.length ? `+${p.future.length} yr` : "expiring"}</div></td>${hcCell(p)}${lineCells(p)}
          <td class="r" style="white-space:nowrap">${myTurn && k.ok && LG.phase === "nba" ? `<button class="btn sm go" data-pick="${p.id}">Sign</button> ` : ""}${t ? (t.queue.includes(p.id) ? `<button class="btn sm" data-unqueue="${p.id}">Queued</button>` : `<button class="btn sm" data-queue="${p.id}">Queue</button>`) : ""}</td></tr>`).join("") || `<tr><td colspan="14" class="empty">No one matches.</td></tr>`}
        </tbody></table></div>
        <aside>${recentPicksList(10)}</aside></div>`;
  }
  function recentPicksList(n) {
    const picks = LG.nba.picks.slice(-n).reverse();
    return `<div class="card" style="flex:1;min-height:0;display:flex;flex-direction:column"><h3>Latest picks</h3>${picks.length ? `<ol class="picks">${picks.map((pk, i) => { const t = LG.teams[pk.team]; return `<li class="${isMine(t) ? "me" : ""}"><span class="no">${LG.nba.picks.length - i}</span><span>${pk.pid ? pl(pk.pid) : "<b>Passed</b>"}<br><span class="ps">${esc(t.abbr)}${pk.auto ? ", auto" : ""}</span></span><span class="sal num">${pk.pid ? money(BY[pk.pid].sal) : ""}</span></li>`; }).join("")}</ol>` : `<p class="empty">No picks yet.</p>`}</div>`;
  }
  function draftBoard() {
    const n = LG.teams.length, rounds = LG.settings.roster;
    const order = LG.nba.round1;
    let cells = `<div></div>${order.map((ti) => `<div class="h${isMine(LG.teams[ti]) ? " me" : ""}" title="${esc(LG.teams[ti].name)}">${esc(LG.teams[ti].abbr)}</div>`).join("")}`;
    for (let r = 0; r < rounds; r++) {
      cells += `<div class="rn">${r + 1}</div>`;
      for (let col = 0; col < n; col++) {
        const k = r * n + (r % 2 ? n - 1 - col : col);
        const pk = LG.nba.picks[k], ti = order[col], t = LG.teams[ti];
        const cls = ["cell", pk ? "f" : "", isMine(t) ? "me" : "", LG.phase === "nba" && k === LG.nba.picks.length ? "now" : "", pk && !pk.pid ? "skip" : ""].join(" ");
        cells += `<div class="${cls}">${pk ? (pk.pid ? `<b>${esc(last(BY[pk.pid].n))}</b><small>${money(BY[pk.pid].sal)}</small>` : `<b>Passed</b>`) : `<small>${k + 1}</small>`}</div>`;
      }
    }
    return `<div class="board"><div class="bgrid" style="--n:${n};grid-template-columns:30px repeat(${n},minmax(0,1fr));grid-template-rows:auto repeat(${rounds},minmax(34px,1fr))">${cells}</div></div>`;
  }
  function draftPicks() {
    const picks = LG.nba.picks.slice().reverse();
    return `<div class="card" style="flex:1;min-height:0;display:flex;flex-direction:column">${picks.length ? `<ol class="picks">${picks.map((pk, i) => { const t = LG.teams[pk.team], p = BY[pk.pid]; const no = LG.nba.picks.length - i; return `<li class="${isMine(t) ? "me" : ""}"><span class="no">${no}</span><span>${p ? pl(p.id) : "<b>Passed</b>"} <span class="ps">${p ? `${p.t}, HC ${p.hc.toFixed(1)}` : ""}</span><br><span class="ps">Round ${Math.floor((no - 1) / LG.teams.length) + 1}: ${esc(t.name)}${pk.auto ? ", autopick" : ""}</span></span><span class="sal num">${p ? money(p.sal) : ""}</span></li>`; }).join("")}</ol>` : `<p class="empty">No picks yet.</p>`}</div>`;
  }
  function draftMine() {
    const t = myTeam();
    if (!t) return `<p class="empty">Claim or sign in to your team to see it here.</p>`;
    const ids = H.active(t).map((id) => BY[id]).sort((a, b) => b.sal - a.sal);
    return `<div class="card">${capBar(t, { reserve: LG.phase === "nba" })}</div><div class="table-wrap"><table class="t"><thead><tr><th>Player</th><th class="r">Salary</th><th class="hide-s">Contract</th><th class="r">HC</th>${LINE_HEAD}</tr></thead><tbody>
      ${ids.map((p) => `<tr><td><div class="pn">${esc(p.n)}</div><div class="ps">${p.t}, ${p.pos}</div></td><td class="r"><span class="sal num">${money(p.sal)}</span></td><td class="ps hide-s">${contract(p)}</td>${hcCell(p)}${lineCells(p)}</tr>`).join("") || `<tr><td colspan="14" class="empty">No picks yet.</td></tr>`}
      ${t.prospects.map((id) => `<tr><td><div class="pn">${esc(nameOf(id))}</div><div class="ps">Prospect, ${esc(PBY[id] ? PBY[id].school : "")}</div></td><td class="r ps">rights</td><td colspan="12"></td></tr>`).join("")}</tbody></table></div>`;
  }
  function draftQueue() {
    const t = myTeam();
    if (!t) return `<p class="empty">Claim or sign in to your team to build a queue.</p>`;
    const ctx = H.context(LG, POOL);
    return `<p class="muted small" style="margin:0">If your clock runs out, the first player here who is still available and fits your line is your pick. Add players from the Players tab.</p>
      <div class="table-wrap"><table class="t"><thead><tr><th class="r">#</th><th>Player</th><th class="r">Salary</th><th>Status</th><th></th></tr></thead><tbody>
      ${t.queue.map((id, i) => { const p = BY[id]; const taken = ctx.own[id] != null; return `<tr class="${taken ? "dim" : ""}"><td class="r num">${i + 1}</td><td><div class="pn">${esc(p.n)}</div><div class="ps">${p.t}, rank ${p.rank}</div></td><td class="r"><span class="sal num">${money(p.sal)}</span></td><td>${taken ? "Taken" : H.check(LG, t, p, ctx, { reserve: true }).ok ? `<span class="ok">Fits</span>` : `<span class="bad">Won't fit now</span>`}</td>
        <td class="r" style="white-space:nowrap"><button class="btn sm" data-qup="${id}" ${i ? "" : "disabled"} aria-label="Move up">Up</button> <button class="btn sm" data-unqueue="${id}">Remove</button></td></tr>`; }).join("") || `<tr><td colspan="5" class="empty">Your queue is empty.</td></tr>`}</tbody></table></div>`;
  }
  function draftProspects() {
    if (LG.phase === "league") {
      const res = LG.auction.results;
      return `<div class="table-wrap"><table class="t"><thead><tr><th>Prospect</th><th>Team</th><th class="r">Winning bid</th></tr></thead><tbody>${res.filter((x) => x.won).map((x) => `<tr class="${isMine(LG.teams[x.team]) ? "me" : ""}"><td><div class="pn">${esc(nameOf(x.pid))}</div><div class="ps">${esc(PBY[x.pid] ? `${PBY[x.pid].school}, big board ${PBY[x.pid].rank}` : "")}</div></td><td>${esc(LG.teams[x.team].name)}</td><td class="r num">$${x.amt}</td></tr>`).join("") || `<tr><td colspan="3" class="empty">No prospects were signed.</td></tr>`}</tbody></table></div>`;
    }
    const t = myTeam();
    const bids = myBids.auction;
    if (t && bids == null) fetchMyBids("auction").then(() => route().tab === "draft" && render());
    const bidOf = (id) => (id in ui.abids ? ui.abids[id] : ((bids || []).find((b) => b.add === id) || {}).amt || "");
    const total = (bids || []).reduce((s, b) => s + b.amt, 0);
    return `<div class="tools"><p class="muted small" style="margin:0;flex:1">${t ? `Enter a sealed bid on anyone you want. You can win up to ${LG.settings.prospects}; bids come out of your $${t.faab} season FAAB. Your bids total $${total}.` : "Claim a team to bid."}</p>
      ${t ? `<button class="btn go" data-savebids>Save my bids</button>` : ""}</div>
      <div class="table-wrap"><table class="t"><thead><tr><th class="r">Board</th><th>Prospect</th><th>School</th><th class="r">Age</th><th class="r">Your bid</th></tr></thead><tbody>
      ${PROS.map((p) => `<tr><td class="r num ps">${p.rank}</td><td><div class="pn">${esc(p.n)}</div><div class="ps">${p.pos}</div></td><td>${esc(p.school)}</td><td class="r num">${p.age.toFixed(1)}</td>
        <td class="r">${t ? `<input type="number" min="0" max="${t.faab}" step="1" data-abid="${p.id}" value="${bidOf(p.id)}" style="width:86px;text-align:right" aria-label="Bid on ${esc(p.n)}">` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  }

  /* ---------- Commissioner ---------- */
  function viewCommish() {
    if (!me.commish) {
      return `<div class="head"><h1 class="disp">Commissioner</h1></div><form class="card form" id="cform" style="max-width:420px"><p class="muted small" style="margin:0">Enter the commissioner PIN to manage the league.</p>
        <div class="field"><label for="cpin">Commissioner PIN</label><input type="password" id="cpin" name="pin" inputmode="numeric" required></div><div><button class="btn go" type="submit">Unlock tools</button></div></form>`;
    }
    const s = LG.settings, p = LG.phase;
    const link = location.origin + location.pathname + "?l=" + LID;
    const tiersEditable = s.tiers.map((t, k) => `<div class="field"><label for="tier${k}">${esc(t.label)} add-on ($)</label><input type="number" id="tier${k}" name="tier${k}" min="0" value="${t.add}" ${k === 0 ? "disabled" : ""}></div>`).join("");
    return `<div class="head"><h1 class="disp">Commissioner</h1><span class="grow"></span><button class="btn" data-act="copy" data-text="${esc(link)}">Copy invite link</button></div>
      <div class="cols2">
        <form class="card form" id="settings"><h3>League settings</h3>
          <div class="field"><label for="sname">League name</label><input type="text" id="sname" name="name" maxlength="40" value="${esc(LG.name)}"></div>
          <div class="row2"><div class="field"><label for="sbuy">Buy-in ($)</label><input type="number" id="sbuy" name="buyIn" min="0" value="${s.buyIn}"></div>
          <div class="field"><label for="sfaab">Season FAAB ($)</label><input type="number" id="sfaab" name="faab" min="1" value="${s.faab}" ${p === "lobby" ? "" : "disabled"}></div></div>
          <div class="row2">${tiersEditable}</div>
          <div class="row2"><div class="field"><label for="sdead">Tier upgrades close after week</label><input type="number" id="sdead" name="tierDeadline" min="1" max="${s.regWeeks}" value="${s.tierDeadline}"></div>
          <div class="field"><label for="sstart">Scoring starts in week</label><input type="number" id="sstart" name="startWeek" min="1" max="${s.regWeeks}" value="${s.startWeek}" ${p === "lobby" ? "" : "disabled"}></div></div>
          <div class="row2"><div class="field"><label for="stdl">Trade deadline: end of week</label><input type="number" id="stdl" name="tradeDeadline" min="1" max="${s.regWeeks}" value="${s.tradeDeadline}"></div>
          <div class="field"><label for="sirs">IR spots</label><input type="number" id="sirs" name="irSlots" min="0" max="4" value="${s.irSlots}"></div></div>
          <div class="row2"><div class="field"><label for="spay">Payout split, %</label><input type="text" id="spay" name="payout" value="${s.payout.join(" / ")}"></div>
          <div class="field"><label for="sveto">Veto window (hours)</label><input type="number" id="sveto" name="vetoHours" min="0" max="168" value="${s.vetoHours}"></div></div>
          <div class="row2"><div class="field"><label for="smin">Summer budget, best team ($)</label><input type="number" id="smin" name="summerMin" min="1" value="${s.summerMin}"></div>
          <div class="field"><label for="smax">Summer budget, worst team ($)</label><input type="number" id="smax" name="summerMax" min="1" value="${s.summerMax}"></div></div>
          <div class="field"><label for="scomp">Bonus for letting an expiring player walk ($)</label><input type="number" id="scomp" name="compDollars" min="0" value="${s.compDollars}"></div>
          <div class="field"><label for="sirr">Who can go on IR</label><select id="sirr" name="irRule"><option value="out"${s.irRule === "out" ? " selected" : ""}>Only players ESPN lists as Out</option><option value="any"${s.irRule === "any" ? " selected" : ""}>Anyone (commissioner polices it)</option></select></div>
          <p class="ps" style="margin:0">The real NBA deadline is Feb. 11, 2027; week ${H.weekOf(opener, new Date("2027-02-21T12:00:00"))} ends Feb. 21, ten days later. Week 1 backfills every week already played from real box scores, which is handy for testing. A real league should start the week after the draft.</p>
          <div><button class="btn go" type="submit">Save settings</button></div></form>
        <form class="card form" id="draftset"><h3>Draft</h3>
          <div class="field"><span class="lbl">Type</span><div class="seg" role="group">${[["live", "Live"], ["slow", "Slow"]].map(([k, n]) => `<button type="button" data-dmode="${k}" aria-pressed="${s.draftMode === k}">${n}</button>`).join("")}</div></div>
          <div class="row2"><div class="field"><label for="dclock">Live clock (seconds)</label><input type="number" id="dclock" name="clock" min="15" max="600" value="${s.clock}"></div>
          <div class="field"><label for="dslow">Slow clock (hours)</label><input type="number" id="dslow" name="slowHours" min="1" max="72" value="${s.slowHours}"></div></div>
          <div class="row2"><div class="field"><label for="dbot">Bot pick delay, live (seconds)</label><input type="number" id="dbot" name="botDelay" min="0" max="30" step="0.5" value="${s.botDelay / 1000}"></div>
          <div class="field"><label for="dauc">Prospect auction length (hours)</label><input type="number" id="dauc" name="auctionHours" min="1" max="168" value="${s.auctionHours}"></div></div>
          <div class="tools"><button class="btn" type="submit">Save draft settings</button>
            ${p === "lobby" ? `<button class="btn" type="button" data-shuffle>Shuffle the order</button><button class="btn go" type="button" data-start>Start the draft</button>` : ""}
            ${p === "nba" ? `<button class="btn" type="button" data-pause="${LG.nba.paused ? 0 : 1}">${LG.nba.paused ? "Resume" : "Pause"}</button><button class="btn warn" type="button" data-undo>Undo last pick</button>` : ""}
            ${p === "prospects" ? `<button class="btn warn" type="button" data-undo>Undo last pick</button><button class="btn go" type="button" data-closeauction>Close the auction now</button>` : ""}</div>
          <div><div class="lbl" style="margin:6px 0">First-round order</div><ol style="margin:0;padding-left:22px">${LG.nba.round1.map((id, i) => `<li>${esc(LG.teams[id].name)}${p === "lobby" && i ? ` <button class="btn sm" type="button" data-ordup="${i}">Up</button>` : ""}</li>`).join("")}</ol></div></form>
      </div>
      <section class="card"><h3>Teams and managers</h3><div class="table-wrap" style="border:0"><table class="t"><thead><tr><th>Team</th><th>Manager</th><th>Tier</th><th class="r">FAAB</th><th></th></tr></thead><tbody>
        ${LG.teams.map((t) => `<tr><td><input type="text" data-tname="${t.id}" value="${esc(t.name)}" maxlength="28" aria-label="Team name"></td><td>${t.owner ? esc(t.owner) : `<span class="muted">Open (bot)</span>`}</td>
          <td><select data-ttier="${t.id}" aria-label="Tier">${s.tiers.map((x, k) => `<option value="${k}"${(t.tier || 0) === k ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select></td>
          <td class="r"><input type="number" data-tfaab="${t.id}" value="${t.faab}" min="0" style="width:80px;text-align:right" aria-label="FAAB"></td>
          <td class="r" style="white-space:nowrap"><button class="btn sm" data-tsave="${t.id}">Save</button> ${t.owner ? `<button class="btn sm warn" data-unclaim="${t.id}">Open team</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
        <p class="ps" style="margin-bottom:0">Opening a team removes its manager and PIN so someone else can claim it; the roster stays. The tier menu is for corrections; managers can only move themselves up.</p></section>
      <section class="card"><h3>Contracts the cap sheet doesn't have yet</h3>
        <p class="ps" style="margin-top:0">Players on a real NBA roster with no salary on file: new signings, waived players who caught on, two-way deals (leave those alone; two-ways aren't eligible). Add a contract and he joins this league's free agent pool at that salary.</p>
        ${missingContracts()}
        ${Object.keys(LG.contracts || {}).length ? `<h3 style="margin-top:12px">Added by you</h3><ul class="list">${Object.entries(LG.contracts).map(([id, c]) => `<li><span>${esc(c.n)}, ${esc(c.t)}: ${c.sal.filter(Boolean).map(money).join(", ")}</span><span class="grow"></span><button class="btn sm" data-uncontract="${esc(id)}">Remove</button></li>`).join("")}</ul>` : ""}</section>
      ${p === "league" ? `<section class="card"><h3>Waivers</h3><p class="ps" style="margin-top:0">Next automatic run: ${fmtWhen(LG.due.waiver || H.nextWaiverRun(now()))}. Running now opens every sealed bid; signings count next week.</p><button class="btn" data-runwaivers>Run waivers now</button></section>` : ""}`;
  }

  function missingContracts() {
    const r = STATS.rosters || {};
    const have = new Set(NBA.players.map((p) => p.id));
    const rows = Object.entries(r).filter(([id]) => !have.has(id) && !(LG.contracts || {})[id]).sort((a, b) => a[1][0].localeCompare(b[1][0]) || a[0].localeCompare(b[0]));
    if (!rows.length) return `<p class="empty">Everyone on an NBA roster has a contract on file.</p>`;
    return `<details><summary class="btn sm" style="display:inline-flex">${rows.length} players without a contract on file</summary>
      <div class="table-wrap" style="margin-top:8px;max-height:50vh"><table class="t"><thead><tr><th>Player</th><th>Team</th><th class="r">2026-27 salary ($M)</th><th class="r">Years</th><th></th></tr></thead><tbody>
      ${rows.map(([id, v]) => `<tr><td class="pn">${esc(v[1])}</td><td>${esc(v[0])} <span class="ps">${esc(v[2] || "")}</span></td><td class="r"><input type="number" step="0.01" min="0.5" style="width:90px;text-align:right" data-csal="${esc(id)}" aria-label="Salary for ${esc(v[1])}"></td><td class="r"><input type="number" min="1" max="5" value="1" style="width:60px;text-align:right" data-cyrs="${esc(id)}" aria-label="Years"></td><td class="r"><button class="btn sm" data-addcontract="${esc(id)}">Add</button></td></tr>`).join("")}
      </tbody></table></div></details>`;
  }

  /* ---------- wiring ---------- */
  function wire() {
    const r = route();
    const on = (sel, ev, fn) => $$(sel, app).forEach((el) => el.addEventListener(ev, fn));
    on("[data-pair]", "click", (e) => { ui.pair = +e.currentTarget.dataset.pair; if (route().tab !== "matchups") location.hash = "#matchups"; else render(); });
    on("[data-wk]", "click", (e) => { ui.week = +e.currentTarget.dataset.wk; ui.pair = null; render(); });
    on("[data-kind]", "click", (e) => { ui.kind = e.currentTarget.dataset.kind; render(); });
    on("[data-status]", "click", (e) => { ui.status = e.currentTarget.dataset.status; render(); });
    on("#mq,#dq", "input", (e) => { ui.q = e.target.value; render(); });
    on("[data-f]", "change", (e) => { ui.f[e.target.dataset.f] = e.target.value; render(); });
    on("[data-ftoggle]", "click", () => { ui.fopen = !ui.fopen; render(); });
    on("[data-tv]", "click", (e) => { ui.tv = e.currentTarget.dataset.tv; render(); });
    on("[data-lw]", "click", (e) => { ui.lw = +e.currentTarget.dataset.lw; ui.draftLineup = null; render(); });
    on("[data-slot]", "change", (e) => {
      const t = myTeam(), w = ui.lw && ui.lw >= curWeek() ? ui.lw : editWeek();
      const cur = ui.draftLineup && ui.draftLineup.w === w ? ui.draftLineup.slots.slice() : H.lineupFor(LG, t, w, BY).slice();
      const i = +e.target.dataset.slot, id = e.target.value || null;
      const was = cur.indexOf(id); if (id && was >= 0) cur[was] = null;   // moving a starter empties his old slot
      cur[i] = id; ui.draftLineup = { w, t: t.id, slots: cur }; render();
    });
    on("[data-lauto]", "click", () => { const t = myTeam(), w = ui.lw && ui.lw >= curWeek() ? ui.lw : editWeek(); ui.draftLineup = { w, t: t.id, slots: H.autoLineup(H.rosterInWeek(t, w).filter((x) => !(t.ir || []).includes(x)).map((x) => BY[x])) }; render(); });
    on("[data-lsave]", "click", (e) => { const w = +e.currentTarget.dataset.lsave; const slots = ui.draftLineup && ui.draftLineup.w === w ? ui.draftLineup.slots : H.lineupFor(LG, myTeam(), w, BY); mutate(`Set week ${w} lineup`, (L) => H.setLineup(L, POOL, me.team, w, slots, now(), opener)).then((ok) => { if (ok) { ui.draftLineup = null; toast(`Week ${w} lineup saved.`); render(); } }); });
    on("[data-ir]", "click", (e) => { const id = e.currentTarget.dataset.ir; mutate(`Moved ${nameOf(id)} to IR`, (L) => H.moveToIR(L, POOL, me.team, id, INJ, now(), curWeek())).then((ok) => ok && toast(`${nameOf(id)} is on IR. ${money(BY[id].sal)} is off your books.`)); });
    on("[data-activate]", "click", (e) => {
      const id = e.currentTarget.dataset.activate, t = myTeam();
      const full = H.active(t).length >= LG.settings.roster;
      dlg(`<h3 class="disp">Activate ${esc(nameOf(id))}?</h3><p class="muted">His ${money(BY[id].sal)} comes back onto your books, so you need to be under your ${money(H.ceilingOf(LG, t))} line with him.</p>
        <form class="form">${full ? `<div class="field"><label for="adrop">Release to make room</label><select id="adrop" name="drop">${H.active(t).map((x) => BY[x]).sort((a, b) => a.z - b.z).map((x) => `<option value="${x.id}">${esc(x.n)}, ${money(x.sal)}</option>`).join("")}</select></div>` : ""}
        <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go" type="submit">Activate</button></div></form>`, async (fd, f) => {
        const ok = await mutate(`Activated ${nameOf(id)}`, (L) => H.activateIR(L, POOL, me.team, id, fd.get("drop") || null, now(), curWeek()));
        return ok ? undefined : false;
      });
    });
    on("[data-fdrop]", "change", (e) => { const id = e.target.dataset.fdrop; ui.drops = e.target.checked ? [...ui.drops, id] : ui.drops.filter((x) => x !== id); render(); });
    on("[data-fclear]", "click", () => { ui.f = { pos: "", team: "", sal: "", con: "", age: "", inj: "" }; render(); });
    on("#msort,#dsort", "change", (e) => { ui.sort = e.target.value; render(); });
    on("#dfit", "change", (e) => { ui.fit = e.target.checked; render(); });
    on("[data-sub]", "click", (e) => { ui.sub = e.currentTarget.dataset.sub; history.replaceState(null, "", "#draft/" + ui.sub); render(); });
    on("[data-logkind]", "click", (e) => { ui.logKind = e.currentTarget.dataset.logkind; render(); });
    on("[data-bid]", "click", (e) => { if (!myTeam()) return toast("Sign in to your team first.", true); const b = e.currentTarget; fetchMyBids("waiver").then(() => bidDialog(b.dataset.bid, b.dataset.biddrop || null)); });
    on("[data-trade]", "click", (e) => tradeDialog(+e.currentTarget.dataset.trade, e.currentTarget.dataset.pid));
    on("[data-act-trade]", "click", () => tradeDialog(null));
    on("[data-queue]", "click", (e) => { const id = e.currentTarget.dataset.queue; mutate("Queue", (L) => { const t = L.teams[me.team]; if (!t.queue.includes(id)) t.queue.push(id); return { ok: true }; }, { quiet: true }); });
    on("[data-unqueue]", "click", (e) => { const id = e.currentTarget.dataset.unqueue; mutate("Queue", (L) => { const t = L.teams[me.team]; t.queue = t.queue.filter((x) => x !== id); return { ok: true }; }, { quiet: true }); });
    on("[data-qup]", "click", (e) => { const id = e.currentTarget.dataset.qup; mutate("Queue", (L) => { const q = L.teams[me.team].queue, i = q.indexOf(id); if (i > 0) [q[i - 1], q[i]] = [q[i], q[i - 1]]; return { ok: true }; }, { quiet: true }); });
    on("[data-pick]", "click", (e) => { const id = e.currentTarget.dataset.pick; mutate(`Picked ${nameOf(id)}`, (L) => H.draftPick(L, POOL, me.team, id, now(), false)).then((ok) => ok && toast(`You signed ${nameOf(id)} for ${money(BY[id].sal)}.`)); });
    on("[data-autome]", "click", () => mutate("Autopick", (L) => { const p = H.autoChoice(L, POOL, me.team, H.rng(Date.now() % 1e6)); return H.draftPick(L, POOL, me.team, p.id, now(), p.relaxed ? { relaxed: true } : true); }));
    on("[data-abid]", "input", (e) => { ui.abids[e.target.dataset.abid] = e.target.value; });
    on("[data-savebids]", "click", async () => {
      const t = myTeam(); const bids = $$("[data-abid]", app).map((i) => ({ add: i.dataset.abid, amt: Math.floor(+i.value || 0) })).filter((b) => b.amt > 0);
      if (bids.some((b) => b.amt > t.faab)) return toast(`No single bid can be more than your $${t.faab}.`, true);
      if (await putBids("auction", bids)) { ui.abids = {}; toast(`${bids.length} sealed bid${bids.length === 1 ? "" : "s"} saved.`); render(); }
    });
    on("[data-drop]", "click", (e) => {
      const id = e.currentTarget.dataset.drop;
      dlg(`<h3 class="disp">Release ${esc(nameOf(id))}?</h3><p class="muted">${BY[id] ? `His ${money(BY[id].sal)} comes off your books now. His stats still count through week ${curWeek()}.` : "His rights go back to the Prospect Board."} You can't claim him back this week.</p>
        <form><div class="acts"><button type="button" class="btn" data-close>Keep him</button><button class="btn warn" type="submit">Release</button></div></form>`, async () => { await mutate(`Released ${nameOf(id)}`, (L) => H.dropPlayer(L, POOL, me.team, id, curWeek(), now())); });
    });
    on("[data-tier]", "click", (e) => {
      const k = +e.currentTarget.dataset.tier, t = myTeam(), tier = LG.settings.tiers[k];
      dlg(`<h3 class="disp">Move up to ${esc(tier.label)}?</h3><p class="muted">Your line goes to ${money(tier.line)} and you add $${tier.add - H.tierOf(LG, t).add} to the pot (you'll owe $${LG.settings.buyIn + tier.add} in total). This is permanent for the season: no dipping back under once you've agreed to pay.</p>
        <form><div class="acts"><button type="button" class="btn" data-close>Not now</button><button class="btn go" type="submit">Move up and pay $${tier.add - H.tierOf(LG, t).add}</button></div></form>`, async () => { await mutate(`Upgraded to ${tier.label}`, (L) => H.upgradeTier(L, me.team, k, now(), curWeek())); });
    });
    on("[data-unbid]", "click", async (e) => { const b = (myBids.waiver || []).slice(); b.splice(+e.currentTarget.dataset.unbid, 1); if (await putBids("waiver", b)) render(); });
    on("[data-accept]", "click", (e) => mutate("Accepted a trade", (L) => H.respondTrade(L, POOL, e.currentTarget.dataset.accept, true, curWeek(), now())).then((ok) => ok && toast("Trade accepted.")));
    on("[data-decline]", "click", (e) => mutate("Declined a trade", (L) => H.respondTrade(L, POOL, e.currentTarget.dataset.decline, false, curWeek(), now())));
    on("[data-veto]", "click", (e) => { const id = e.currentTarget.dataset.veto; dlg(`<h3 class="disp">Veto this trade?</h3><p class="muted">Every player, prospect and FAAB dollar goes back to where it started, and the league log says you vetoed it.</p><form><div class="acts"><button type="button" class="btn" data-close>Keep the trade</button><button class="btn warn" type="submit">Veto</button></div></form>`, async () => { await mutate("Vetoed a trade", (L) => H.vetoTrade(L, POOL, id, now()), { as: "commish" }); }); });
    on("[data-withdraw]", "click", (e) => mutate("Withdrew a trade", (L) => { const t = L.trades.find((x) => x.id === e.currentTarget.dataset.withdraw); if (t) { t.status = "withdrawn"; t.closed = now(); } return { ok: true }; }));
    // commissioner
    const cf = $("#cform", app);
    if (cf) cf.onsubmit = async (e) => {
      e.preventDefault(); const pin = String(new FormData(cf).get("pin"));
      const r2 = await rpc("hc_auth", { p_id: LID, p_team: -1, p_pin: pin });
      if (r2.error) return toast(r2.error, true);
      me = Object.assign({}, me, { commish: pin }); store.set(meKey(), me); render();
    };
    const sf = $("#settings", app);
    if (sf) sf.onsubmit = (e) => {
      e.preventDefault(); const fd = new FormData(sf);
      mutate("Settings", (L) => {
        const nm = String(fd.get("name") || "").trim(); if (nm) L.name = nm.slice(0, 40);
        L.settings.buyIn = Math.max(0, Math.floor(+fd.get("buyIn") || 0));
        L.settings.tiers.forEach((t, k) => { if (k) t.add = Math.max(0, Math.floor(+fd.get("tier" + k) || 0)); });
        L.settings.tierDeadline = Math.max(1, Math.floor(+fd.get("tierDeadline") || 1));
        L.settings.tradeDeadline = Math.max(1, Math.floor(+fd.get("tradeDeadline") || 18));
        L.settings.irSlots = Math.max(0, Math.min(4, Math.floor(+fd.get("irSlots") || 0)));
        L.settings.irRule = fd.get("irRule") === "any" ? "any" : "out";
        const pay = String(fd.get("payout") || "").split(/[^0-9]+/).filter(Boolean).map(Number);
        if (pay.length && pay.reduce((a, b) => a + b, 0) !== 100) return { ok: false, why: "The payout split has to add up to 100%" };
        if (pay.length) L.settings.payout = pay;
        L.settings.vetoHours = Math.max(0, Math.min(168, Math.floor(+fd.get("vetoHours") || 0)));
        L.settings.summerMin = Math.max(1, Math.floor(+fd.get("summerMin") || 50));
        L.settings.summerMax = Math.max(L.settings.summerMin, Math.floor(+fd.get("summerMax") || 100));
        L.settings.compDollars = Math.max(0, Math.floor(+fd.get("compDollars") || 0));
        if (L.phase === "lobby") {
          const f = Math.max(1, Math.floor(+fd.get("faab") || 50)); if (f !== L.settings.faab) { L.settings.faab = f; L.teams.forEach((t) => (t.faab = f)); }
          L.settings.startWeek = Math.max(1, Math.floor(+fd.get("startWeek") || 1));
        }
        return { ok: true };
      }, { as: "commish" }).then((ok) => ok && toast("Settings saved."));
    };
    const df = $("#draftset", app);
    if (df) {
      let mode = LG.settings.draftMode;
      $$("[data-dmode]", df).forEach((b) => (b.onclick = () => { mode = b.dataset.dmode; $$("[data-dmode]", df).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
      df.onsubmit = (e) => {
        e.preventDefault(); const fd = new FormData(df);
        mutate("Draft settings", (L) => {
          if (L.phase === "nba" && mode !== L.settings.draftMode) { const left = H.onClock(L, now()).left; L.settings.draftMode = mode; L.nba.clockStart = now() - (H.clockLen(L) - Math.min(left, H.clockLen(L))); }
          L.settings.draftMode = mode;
          L.settings.clock = Math.min(600, Math.max(15, Math.floor(+fd.get("clock") || 60)));
          L.settings.slowHours = Math.min(72, Math.max(1, +fd.get("slowHours") || 8));
          L.settings.botDelay = Math.min(30000, Math.max(0, (+fd.get("botDelay") || 0) * 1000));
          L.settings.auctionHours = Math.min(168, Math.max(1, +fd.get("auctionHours") || 24));
          return { ok: true };
        }, { as: "commish" }).then((ok) => ok && toast("Draft settings saved."));
      };
    }
    on("[data-addcontract]", "click", (e) => {
      const id = e.currentTarget.dataset.addcontract, v = (STATS.rosters || {})[id];
      const sal = Math.round((+$(`[data-csal="${id}"]`, app).value || 0) * 1e6), yrs = Math.max(1, Math.min(5, Math.floor(+$(`[data-cyrs="${id}"]`, app).value || 1)));
      if (sal < 5e5) return toast("Enter his salary in millions, like 2.4.", true);
      const pos = { PG: ["PG"], SG: ["SG"], G: ["PG", "SG"], SF: ["SF"], PF: ["PF"], F: ["SF", "PF"], C: ["C"] }[v[2]] || ["SF"];
      mutate(`Added a contract for ${v[1]}`, (L) => {
        L.contracts = L.contracts || {};
        L.contracts[id] = { n: v[1], t: v[0], pos: pos.includes("C") ? "B" : pos.some((x) => x.includes("G")) ? "G" : "W", ps: pos, sal: [...Array(5)].map((_, i) => (i < yrs ? Math.round(sal * Math.pow(1.05, i)) : 0)) };
        L.log.push({ at: now(), kind: "commish", team: -1, text: `Commissioner added ${v[1]} (${v[0]}) at ${money(sal)} for ${yrs} year${yrs === 1 ? "" : "s"}` });
        return { ok: true };
      }, { as: "commish" }).then((ok) => ok && toast(`${v[1]} is in the free agent pool.`));
    });
    on("[data-uncontract]", "click", (e) => { const id = e.currentTarget.dataset.uncontract; mutate("Removed a contract", (L) => { if (Object.values(H.owners(L)).length && H.owners(L)[id] != null) return { ok: false, why: "He's on a roster. Have that team release him first." }; delete L.contracts[id]; return { ok: true }; }, { as: "commish" }); });
    on("[data-shuffle]", "click", () => mutate("Shuffled the order", (L) => { const o = L.nba.round1.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } H.setOrder(L, o); return { ok: true }; }, { as: "commish" }));
    on("[data-ordup]", "click", (e) => { const i = +e.currentTarget.dataset.ordup; mutate("Draft order", (L) => { const o = L.nba.round1.slice(); [o[i - 1], o[i]] = [o[i], o[i - 1]]; H.setOrder(L, o); return { ok: true }; }, { as: "commish" }); });
    on("[data-start]", "click", () => dlg(`<h3 class="disp">Start the draft?</h3><p class="muted">${LG.teams.filter((t) => !t.owner).length} open team${LG.teams.filter((t) => !t.owner).length === 1 ? "" : "s"} will be drafted by bots. Settings lock once it starts.</p><form><div class="acts"><button type="button" class="btn" data-close>Not yet</button><button class="btn go" type="submit">Start the draft</button></div></form>`, async () => {
      if (await mutate("Started the draft", (L) => H.startDraft(L, now()), { as: "commish" })) location.hash = "#draft/board";
    }));
    on("[data-pause]", "click", (e) => { const p2 = e.currentTarget.dataset.pause === "1"; mutate(p2 ? "Paused the draft" : "Resumed the draft", (L) => H.pauseDraft(L, now(), p2), { as: "commish" }); });
    on("[data-undo]", "click", () => mutate("Undid a pick", (L) => H.undoPick(L, now()), { as: "commish" }).then((ok) => ok && toast("Last pick taken back.")));
    on("[data-closeauction]", "click", () => closeAuction(true));
    on("[data-runwaivers]", "click", () => processWaivers(true));
    on("[data-tsave]", "click", (e) => {
      const id = +e.currentTarget.dataset.tsave;
      const nm = $(`[data-tname="${id}"]`, app).value.trim(), tier = +$(`[data-ttier="${id}"]`, app).value, faab = Math.max(0, Math.floor(+$(`[data-tfaab="${id}"]`, app).value || 0));
      mutate("Commissioner edit", (L) => {
        const t = L.teams[id];
        if (nm && nm !== t.name) renameTeam(L, id, nm);
        if (tier !== (t.tier || 0)) { t.tier = tier; t.tierLog.push({ tier, at: now(), week: curWeek(), commish: true }); L.log.push({ at: now(), kind: "commish", team: id, text: `Commissioner set ${t.name} to ${L.settings.tiers[tier].label}` }); }
        if (faab !== t.faab) { L.log.push({ at: now(), kind: "commish", team: id, text: `Commissioner set ${t.name}'s FAAB to $${faab}` }); t.faab = faab; }
        return { ok: true };
      }, { as: "commish" }).then((ok) => ok && toast("Team saved."));
    });
    on("[data-unclaim]", "click", (e) => {
      const id = +e.currentTarget.dataset.unclaim, t = LG.teams[id];
      dlg(`<h3 class="disp">Open ${esc(t.name)}?</h3><p class="muted">${esc(t.owner)} loses this team and its PIN stops working. The roster stays, and a bot runs it until someone claims it.</p><form><div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn warn" type="submit">Open the team</button></div></form>`, async () => {
        const r2 = await rpc("hc_unclaim", { p_id: LID, p_pin: String(me.commish), p_team: id });
        if (r2.error) return toast(r2.error, true);
        if (me.team === id) { me = { commish: me.commish }; store.set(meKey(), me); }
        await load(true); toast("Team opened.");
      });
    });
  }

  /* ---------- the league's clockwork: draft picks, the auction and waivers move forward on whoever is online ---------- */
  const canWrite = () => (me.team != null && me.pin) || me.commish;
  async function closeAuction(byCommish) {
    const as = byCommish ? "commish" : "any";
    const team = as === "commish" || me.team == null ? -1 : me.team, pin = team === -1 ? me.commish : me.pin;
    let r;
    try { r = await rpc("hc_bids_open", { p_id: LID, p_team: team, p_pin: String(pin), p_kind: "auction" }); } catch (e) { return; }
    if (r.error) { if (byCommish) toast(r.error, true); return; }
    const ok = await mutate("Closed the Prospect Board auction", (L) => H.resolveAuction(L, PROS, r.bids || {}, now()), { as, clear: "auction", quiet: !byCommish });
    if (ok) { myBids.auction = null; toast("The Prospect Board auction is closed."); }
  }
  async function processWaivers(byCommish) {
    const as = byCommish ? "commish" : "any";
    const team = as === "commish" || me.team == null ? -1 : me.team, pin = team === -1 ? me.commish : me.pin;
    let r;
    try { r = await rpc("hc_bids_open", { p_id: LID, p_team: team, p_pin: String(pin), p_kind: "waiver" }); } catch (e) { return; }
    if (r.error) { if (byCommish) toast(r.error, true); return; }
    const week = byCommish ? curWeek() : curWeek() - 1;
    const ok = await mutate("Ran waivers", (L) => {
      if (!byCommish && !(L.due.waiver && now() >= Date.parse(L.due.waiver))) return { ok: false, why: "" };   // someone already ran them
      const order = H.standings(L, curWeek() - 1, STATS.wk, BY).map((x) => x.id);
      H.runWaivers(L, POOL, PROS, r.bids || {}, week, order, now(), INJ);
      return { ok: true };
    }, { as, clear: "waiver", quiet: !byCommish });
    if (ok) { myBids.waiver = null; toast("Waivers ran. See Transactions for the results."); }
  }
  let ticking = false;
  async function tick() {
    if (!LG || ticking || busy || D.open || !canWrite()) return;
    ticking = true;
    try {
      const t = now();
      if (LG.phase === "nba" && !LG.nba.paused) {
        const copy = JSON.parse(JSON.stringify(LG));
        if (H.catchUp(copy, POOL, t, 1)) await mutate("Clock", (L) => (H.catchUp(L, POOL, now(), 24) ? { ok: true } : { ok: false, why: "" }), { as: "any", quiet: true });
      } else if (LG.phase === "prospects" && LG.due.auction && t >= Date.parse(LG.due.auction)) await closeAuction(false);
      else if (LG.phase === "league" && LG.due.waiver && t >= Date.parse(LG.due.waiver)) await processWaivers(false);
      else if (LG.phase === "league" && H.lockLineups(JSON.parse(JSON.stringify(LG)), POOL, t, opener)) await mutate("Locked lineups", (L) => (H.lockLineups(L, POOL, now(), opener) ? { ok: true } : { ok: false, why: "" }), { as: "any", quiet: true });
    } finally { ticking = false; }
  }

  /* ---------- render ---------- */
  function render() {
    if (D.open) return;
    const a = document.activeElement, id = a && a.id && a.tagName === "INPUT" ? a.id : null;
    const sel = id && a.type !== "number" ? [a.selectionStart, a.selectionEnd] : null;
    const scroller = $("#pool .t") ? $("#pool").scrollTop : null;
    draw();
    if (id && $("#" + id)) { const el = $("#" + id); el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not text */ } }
    if (scroller != null && $("#pool")) $("#pool").scrollTop = scroller;
  }
  function draw() {
    chrome();
    if (!LID) { document.body.classList.remove("room"); return renderLanding(); }
    if (!LG) return;
    const r = route();
    const room = r.tab === "draft";
    document.body.classList.toggle("room", room);
    if (room) document.documentElement.style.setProperty("--top", ($("#mast").getBoundingClientRect().bottom + 2 + (LG.phase !== "league" ? 0 : 0)) + "px");
    const views = { office: viewOffice, team: () => viewTeam(r.arg), market: viewMarket, matchups: viewMatchups, tx: viewTx, draft: () => viewDraft(r.arg), commish: viewCommish };
    const html = views[r.tab]();
    app.innerHTML = room ? html : `<div class="wrap page">${html}</div><div class="wrap foot">Hard Cap. Draft the player. Carry the contract. Salaries from the 2026-27 cap sheet; box scores from ESPN${STATS.updated ? `, updated ${fmtDate(STATS.updated)}` : ""}. League code ${esc(LID)}.</div>`;
    if (room) {
      const clockH = $(".clock") ? $(".clock").getBoundingClientRect().height : 0;
      document.documentElement.style.setProperty("--top", ($("#mast").getBoundingClientRect().bottom + clockH) + "px");
    }
    wire();
    if (room && $("#pool")) {
      $$("#pool tr[data-pid]").forEach((tr) => tr.addEventListener("mouseenter", () => { ghost = BY[tr.dataset.pid]; const el = $("#mycap"); if (el && myTeam()) el.innerHTML = capBar(myTeam(), { ghost, reserve: true }); }));
      $("#pool").addEventListener("mouseleave", () => { ghost = null; const el = $("#mycap"); if (el && myTeam()) el.innerHTML = capBar(myTeam(), { reserve: true }); });
    }
    drawTimer();
  }
  function drawTimer() {
    const el = $("#timer");
    if (!el || LG.phase !== "nba") return;
    const c = H.onClock(LG, now());
    const left = Math.max(0, Math.ceil(c.left / 1000));
    const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
    el.textContent = h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
    el.className = "disp timer" + (left <= 10 && LG.settings.draftMode === "live" ? " hot" : "");
  }
  window.addEventListener("hashchange", () => { ui.pair = null; render(); window.scrollTo(0, 0); });
  window.addEventListener("resize", () => route().tab === "draft" && render());

  /* ---------- boot ---------- */
  if (!LID) {
    const lastL = store.get("hc:last", null);
    if (lastL && standalone()) { location.replace("?l=" + lastL + "#office"); return; }
    render(); return;
  }
  store.set("hc:last", LID);
  try { await load(true); }
  catch (e) { app.innerHTML = `<div class="wrap loading">${esc(e.message)}. Check the link, or <a href="./">start a new league</a>.</div>`; return; }
  const list = store.get("hc:leagues", []);
  if (!list.some((x) => x.id === LID)) store.set("hc:leagues", [{ id: LID, name: LG.name }, ...list].slice(0, 12));
  render();
  setInterval(drawTimer, 250);
  setInterval(tick, 1000);
  let polling = false;
  const poll = async () => {
    if (polling || busy || document.hidden) return;
    polling = true;
    try { if (await load(false)) render(); } catch (e) { /* offline for a moment; the next poll catches up */ }
    finally { polling = false; }
  };
  setInterval(() => { if (LG && LG.phase === "nba") poll(); }, 2000);
  setInterval(() => { if (LG && LG.phase !== "nba") poll(); }, 20000);
  document.addEventListener("visibilitychange", () => !document.hidden && poll());
})();
