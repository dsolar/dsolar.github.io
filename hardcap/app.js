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
  // The latest contracts: Basketball-Reference's daily pull plus hand-checked fixes, over the cap sheet.
  let FIXES = null;
  try { const r = await fetch("contracts.json"); if (r.ok) FIXES = await r.json(); } catch (e) { /* the cap sheet alone still works */ }
  NBA = H.latestContracts(NBA, STATS, FIXES);
  let POOL = H.buildPool(NBA, STATS), BY = Object.fromEntries(POOL.map((p) => [p.id, p]));
  // The Prospect Board moves in season: Tankathon's current big board and stat lines (prospects.json).
  let LIVE = null;
  try { const r = await fetch("prospects.json"); if (r.ok) LIVE = await r.json(); } catch (e) { /* the preseason board still works */ }
  if (!LIVE && STATS.prospects) LIVE = STATS.prospects;
  const PROS = H.buildProspects(NBA, LIVE), PBY = Object.fromEntries(PROS.map((p) => [p.id, p]));
  const ageOf = (p) => (p.age ? p.age.toFixed(1) : "-");
  const moveTagP = (p) => (p.off ? `<span class="mv dn" title="Off Tankathon's board">Off</span>` : p.late ? `<span class="mv new" title="Joined the board this season${p.move ? `; ${p.move > 0 ? "up" : "down"} ${Math.abs(p.move)} since` : ""}">New${p.move ? (p.move > 0 ? " &#9650;" : " &#9660;") + Math.abs(p.move) : ""}</span>` : p.move == null ? (p.pre == null && LIVE ? `<span class="mv new" title="Not on the preseason board">New</span>` : "") : p.move > 0 ? `<span class="mv up" title="Up ${p.move} since the preseason board">&#9650;${p.move}</span>` : p.move < 0 ? `<span class="mv dn" title="Down ${-p.move} since the preseason board">&#9660;${-p.move}</span>` : `<span class="mv">0</span>`);
  const pstat = (p, k, d = 1) => (p.stats && p.stats[k] != null ? (k === "ts" ? p.stats[k].toFixed(3).replace(/^0/, "") : p.stats[k].toFixed(d)) : "-");
  const PROS_STATS = [["pts", "PTS"], ["reb", "REB"], ["ast", "AST"], ["stl", "STL"], ["blk", "BLK"], ["ts", "TS%"]];
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
  const WK = H.withVorp(STATS);
  // Games this week for a player's NBA team (the week a lineup edit applies to, or the current week).
  const gw = (p, w) => { if (!p || !STATS.sched) return null; const n = H.gamesInWeek(STATS, p.t, opener, w || gwWeek()); return n; };
  const gwWeek = () => (LG && LG.phase === "league" ? (now() < H.lockTime(opener, curWeek()) ? curWeek() : Math.min(curWeek() + 1, H.totalWeeks(LG))) : curWeek());
  const gCell = (p, w) => { const n = gw(p, w); return `<td class="r num${n >= 4 ? " ok" : n != null && n <= 2 ? " bad" : ""}" title="NBA games in week ${w || gwWeek()}">${n == null ? "-" : n}</td>`; };                     // weekly lines, with each player's VORP gained that week
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
  const ui = { sortDir: 1, tv: "lineup", lw: null, drops: [], f: { pos: "", team: "", sal: "", con: "", age: "" }, abids: {}, sub: "players", q: "", pos: "", sort: "rank", fit: false, status: "fa", kind: "nba", week: null, pair: null, team: null, logKind: "", tradeWith: null, give: [], get: [] };

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
  // Click a column to sort by it; click again to flip the order.
  const sortTh = (k, label, cls = "r", title = "") => `<th class="${cls} sortable${ui.sort === k ? " on" : ""}" data-sortk="${k}"${title ? ` title="${title}"` : ""} aria-sort="${ui.sort === k ? (ui.sortDir < 0 ? "ascending" : "descending") : "none"}" tabindex="0">${label}</th>`;
  const lineHeadS = () => sortTh("pts", "PTS") + sortTh("reb", "REB") + sortTh("ast", "AST") + sortTh("tpm", "3PM", "r hide-s") + sortTh("stl", "STL", "r hide-s") + sortTh("blk", "BLK", "r hide-s") + sortTh("fg", "FG%", "r hide-m") + sortTh("ft", "FT%", "r hide-m") + sortTh("tov", "TO", "r hide-m");
  const vorpHeadS = () => sortTh("vorp", "VORP", "r hide-s", "Value over replacement player, season to date") + sortTh("vpm", "V/M", "r hide-m", "V/M: season VORP per $1M of salary, x10");
  const sortRows = (rows) => { const f = SORTS[ui.sort] || SORTS.rank; return rows.sort((a, b) => f(a, b) * (ui.sortDir || 1)); };
  const LINE_HEAD = `<th class="r">PTS</th><th class="r">REB</th><th class="r">AST</th><th class="r hide-s">3PM</th><th class="r hide-s">STL</th><th class="r hide-s">BLK</th><th class="r hide-m">FG%</th><th class="r hide-m">FT%</th><th class="r hide-m">TO</th>`;
  function lineCells(p) {
    const g = perGame(p);
    if (!g) return `<td class="r ps" colspan="9">No NBA games yet</td>`;
    const l = g.l, v = (k) => l[C[k]].toFixed(1);
    return `<td class="r num">${v("pts")}</td><td class="r num">${v("reb")}</td><td class="r num">${v("ast")}</td><td class="r num hide-s">${v("tpm")}</td><td class="r num hide-s">${v("stl")}</td><td class="r num hide-s">${v("blk")}</td><td class="r num hide-m">${pct(l[C.fgm], l[C.fga])}</td><td class="r num hide-m">${pct(l[C.ftm], l[C.fta])}</td><td class="r num hide-m">${v("tov")}</td>`;
  }
  const vorpCells = (p) => `<td class="r num hide-s" title="Season VORP (Basketball-Reference)">${p.bbv == null ? "-" : p.bbv.toFixed(1)}</td><td class="r num hide-m ${p.vpm >= 1 ? "ok" : p.vpm < 0 ? "bad" : ""}" title="V/M: season VORP per $1M of salary, x10">${p.vpm == null ? "-" : p.vpm.toFixed(1)}</td>`;
  const VORP_HEAD = `<th class="r hide-s" title="Value over replacement player, season to date">VORP</th><th class="r hide-m" title="V/M: season VORP per $1M of salary, x10">V/M</th>`;
  const typeTag = (p) => (p && p.ctype ? `<span class="tag ct">${esc(p.ctype)}</span>` : "");
  const hcCell = (p) => `<td class="r num ${p.hc >= 1 ? "ok" : p.hc < 0 ? "bad" : ""}" title="Value over a replacement player per $10M of salary">${p.hc.toFixed(1)}</td>`;
  function seasonLine(pid) {
    const tot = Array(H.COLS.length).fill(0);
    for (const wk of Object.values(STATS.wk || {})) { const l = wk[pid]; if (l) l.forEach((v, i) => (tot[i] += v)); }
    return tot[0] ? tot : null;
  }

  /* ---------- the cap bar ---------- */
  function capBar(team, opts = {}) {
    if (opts.compact) return capBar(team, Object.assign({}, opts, { compact: false })).replace('class="capbar', 'class="capbar compact');
    const ceiling = H.ceilingOf(LG, team);
    const ids = H.active(team);
    const pay = H.payroll(team, BY);
    const ctx = opts.ctx || H.context(LG, POOL);
    const open = LG.settings.roster - ids.length - (opts.ghost ? 1 : 0);
    const hold = opts.reserve && open > 0 ? H.reserve(open, ctx.available, opts.ghost && opts.ghost.id, LG.phase === "nba" ? LG.teams.filter((t) => t.id !== team.id).reduce((s, t) => s + Math.max(0, LG.settings.roster - H.active(t).length), 0) : 0, (LG.settings.twoWayMax == null ? 3 : LG.settings.twoWayMax) - H.twoWaysOn(team, BY)) : 0;
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
  // Yahoo-style: six sections across the top, each with its own row of pages underneath.
  const TABS = [["league", "League"], ["team", "My Team"], ["players", "Players"], ["matchups", "Matchups"], ["draft", "Draft"], ["commish", "Commissioner"]];
  const ALIAS = { office: ["league", "overview"], tx: ["league", "tx"], market: ["players", "fa"] };
  function subsOf(tab, arg) {
    if (tab === "league") return [["overview", "Overview"], ["standings", "Standings"], ["schedule", "Schedule"], ["tx", "Transactions"], ["board", "Message board"], ["settings", "Settings"], ["rules", "Rules"]];
    if (tab === "team") {
      const t = teamFor(arg), mine = isMine(t);
      return [["roster", mine ? "Roster and lineup" : "Roster"], ["contracts", "Contracts"], ...(mine && LG.phase === "league" ? [["fits", "What fits"]] : []), ["trades", "Trades"]];
    }
    if (tab === "players") return [["fa", "Free agents"], ["all", "All players"], ["owned", "On rosters"], ["prospects", "Prospect Board"]];
    if (tab === "matchups") return [["week", "Matchups"], ["playoffs", "Playoffs"]];
    if (tab === "draft") return draftSubs();
    if (tab === "commish") return me.commish ? [["settings", "League settings"], ["draft", "Draft"], ["teams", "Teams and managers"], ["contracts", "Contracts"], ["tools", "Tools"]] : [];
    return [];
  }
  const route = () => {
    const h = location.hash.replace("#", "").split("/").map(decodeURIComponent);
    let tab = h[0], sub = h[1], arg = h[2];
    if (ALIAS[tab]) [tab, sub] = ALIAS[tab];
    if (!TABS.some((t) => t[0] === tab)) tab = "league";
    if (tab === "team" && sub != null && /^\d+$/.test(sub)) { arg = sub; sub = h[2] || "roster"; }
    const subs = LG ? subsOf(tab, arg) : [];
    if (subs.length && !subs.some((x) => x[0] === sub)) sub = subs[0][0];
    return { tab, sub, arg };
  };
  const teamFor = (arg) => LG.teams[arg != null && LG.teams[+arg] ? +arg : me.team != null ? me.team : 0];
  // What's waiting on you: offers to answer, trades to review, your pick.
  function todoCounts() {
    const t = myTeam();
    if (!LG || !t) return { trades: 0, clock: 0 };
    const offers = LG.trades.filter((x) => x.status === "pending" && x.to === t.id).length;
    const reviews = LG.trades.filter((x) => x.status === "review" && H.voters(LG, x).includes(t.id) && !(x.votes || {})[t.id]).length;
    const c = LG.phase === "nba" ? H.onClock(LG, now()) : null;
    return { trades: offers + reviews, clock: c && c.team === t.id ? 1 : 0 };
  }
  function leagueMenu() {
    const mine = store.get("hc:leagues", []);
    return `<details class="switch" id="switch"><summary><span class="sw-name">${LG ? esc(LG.name) : "Your leagues"}</span><span class="chev" aria-hidden="true"></span></summary>
      <div class="menu" role="menu">${mine.length ? mine.map((x) => `<div class="mi${x.id === LID ? " on" : ""}"><a role="menuitem" href="?l=${esc(x.id)}">${esc(x.name)}<small>${esc(x.id)}</small></a><button class="x" data-forget="${esc(x.id)}" aria-label="Remove ${esc(x.name)} from this device's list" title="Remove from this list">&times;</button></div>`).join("") : `<p class="ps" style="margin:6px 10px">Leagues you open on this device show up here.</p>`}
        <a class="mi new" role="menuitem" href="./?new=1">Start a new league</a>
        <a class="mi new" role="menuitem" href="./?new=1#restore" style="border-top:0;margin-top:0;font-weight:700">Restore a deleted league</a>
        <button class="mi theme" type="button" data-act="theme">${document.documentElement.dataset.theme === "dark" ? "Light mode" : "Dark mode"}</button></div></details>`;
  }
  function chrome() {
    const tabs = $("#tabs"), who = $("#who"), sub = $("#subtabs");
    $("#lgName").innerHTML = leagueMenu();
    $(".navbar").hidden = !LG;
    if (!LG) { tabs.innerHTML = ""; sub.innerHTML = ""; sub.hidden = true; who.innerHTML = `<button class="btn sm ghost" data-act="theme">${document.documentElement.dataset.theme === "dark" ? "Light" : "Dark"}</button>`; return; }
    const r = route();
    const todo = todoCounts();
    const badge = (n, what) => (n ? ` <span class="badge" aria-label="${n} ${what}">${n}</span>` : "");
    tabs.innerHTML = TABS.map(([k, n]) => `<a href="#${k}"${r.tab === k ? ' aria-current="page"' : ""}>${n}${k === "team" ? badge(todo.trades, "trades waiting on you") : k === "draft" ? badge(todo.clock, "you're on the clock") : k === "league" ? badge(unread(), "new messages") : ""}</a>`).join("");
    const subs = subsOf(r.tab, r.arg);
    sub.hidden = !subs.length;
    const tail = r.tab === "team" && r.arg != null ? "/" + r.arg : "";
    sub.innerHTML = `<div class="wrap">${subs.map(([k, n]) => `<a href="#${r.tab}/${k}${tail}"${r.sub === k ? ' aria-current="page"' : ""}>${n}${r.tab === "team" && k === "trades" ? badge(todo.trades, "trades waiting on you") : r.tab === "league" && k === "board" ? badge(unread(), "new messages") : ""}</a>`).join("")}</div>`;
    const t = myTeam();
    const theme = `<button class="btn sm ghost" data-act="theme" aria-label="Switch to ${document.documentElement.dataset.theme === "dark" ? "light" : "dark"} colors">${document.documentElement.dataset.theme === "dark" ? "Light" : "Dark"}</button>`;
    const bell = t ? `<button class="btn sm ghost${alertsOn() ? " go" : ""}" data-act="alerts" aria-label="Alerts">${alertsOn() ? "Alerts on" : "Alerts"}</button>` : "";
    const inst = !standalone() && (installEvt || isIOS()) ? `<button class="btn sm hide-wide" data-act="install">Install</button>` : "";
    who.innerHTML = theme + inst + bell + (t
      ? `<span class="chip"><b>${esc(t.abbr)}</b> ${esc(t.owner || "")}${me.commish ? " (commish)" : ""}</span><button class="btn sm" data-act="signout">Sign out</button>`
      : `${me.commish ? `<span class="chip">Commissioner</span>` : ""}<button class="btn sm" data-act="signin">Sign in</button>${LG.teams.some((x) => !x.owner) ? `<button class="btn sm go" data-act="claim">Claim a team</button>` : ""}`);
  }
  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-forget]");
    if (f) {
      e.preventDefault();
      const id = f.dataset.forget;
      store.set("hc:leagues", store.get("hc:leagues", []).filter((x) => x.id !== id));
      if (store.get("hc:last", null) === id) store.set("hc:last", null);
      toast("Removed from this device's list. The league itself is untouched.");
      chrome(); const sw0 = $("#switch"); if (sw0) sw0.open = true; return;
    }
    const sw = $("#switch");
    if (sw && sw.open && !e.target.closest("#switch")) sw.open = false;
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
    D.innerHTML = `<button type="button" class="dlg-x" data-close aria-label="Close">&times;</button>` + html;
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
    const tiers = L ? L.settings.tiers : H.defaultTiers(NBA.cba, H.DEFAULTS.lineScale);
    const scale = L ? L.settings.lineScale || 1 : H.DEFAULTS.lineScale;
    const faab = L ? L.settings.faab : H.DEFAULTS.faab, buy = L ? L.settings.buyIn : 100;
    return [
      ["Real salaries", "Every player costs his actual NBA salary, and it moves each offseason with his real contract. Two-way and 10-day players count too, at their real (small) salaries."],
      ["The line", `Everyone starts as a cap team: ${L ? L.settings.roster : 12} NBA players under ${money(tiers[0].line)}${scale !== 1 ? `, ${scale} times the real NBA cap, so a team can afford the stars ten fantasy teams compete for` : ""}. Any team can move up a tier for a cash add-on: ${tiers.slice(1).map((t) => `${t.label} (${money(t.line)}, +$${t.add})`).join(", ")}. Moving up is permanent for the season. Buy-in is $${buy}.`],
      ["The draft", "Live or slow. A pick only counts if you can still fill every open spot at the cheapest salaries left; the hatched part of your cap bar is that reserve. Miss your clock and your queue picks for you."],
      ["Prospect Board", `After the draft, a blind FAAB auction for ${L ? L.settings.prospects : 2} prospect spots. Bids come out of your $${faab} season budget, so a big prospect bid means fewer pickups later.`],
      ["Waivers", `Every add is a blind FAAB bid, $${L ? L.settings.minBid : 1} minimum, so there's no first-come rush. Highest bid wins, ties go to the team lower in the standings. Bids run every Monday at 3 a.m. Eastern; signings count that week. Drops are free and unlimited.`],
      ["Two-ways", `Each team can carry up to ${L ? (L.settings.twoWayMax == null ? 3 : L.settings.twoWayMax) : 3} two-way or 10-day players, like the NBA.`],
      ["Contracts", "Contracts update daily from Basketball-Reference, so extensions, declined options and real trade kickers flow through. A two-way earns half the rookie minimum, a 10-day deal ten days of his minimum. A player with no NBA contract at all isn't in the pool; he shows up on waivers the day he signs."],
      ["Over the line", "If a real-world change (a trade kicker, an option, a corrected salary) pushes you over your line, you can't add salary until you're back under. You have until the first lineup lock at least 72 hours out: release someone, trade salary away or move up a tier. Still over then, and your lowest-ranked players are released until you fit."],
      ["Lineups", "Nine starters (PG, SG, G, SF, PF, F, C, UTIL, UTIL) and three on the bench. Only starters score. Lineups are weekly and lock at each week's first tip; forget, and your best lineup is set for you."],
      ["IR", `${L ? L.settings.irSlots : 2} IR spots for players listed Out on the injury report. A player on IR doesn't count against your line, so you can sign a real replacement. Bring him back only if he fits.`],
      ["Releases", "Drop a player and his salary comes off right away. His stats count through the end of that week, and you can't claim him straight back."],
      ["Trades", `Players, prospects and FAAB dollars. Both teams have to fit under their own line afterward. ${L && L.settings.tradeReview !== "vote" ? `The commissioner can veto within ${L.settings.vetoHours} hours.` : `Once accepted, the rest of the league has ${L ? L.settings.reviewHours : 48} hours to review; if half of the other managers vote to veto, it's off. Otherwise players move when the review ends and count from the next week.`} The deadline is the end of week ${L ? L.settings.tradeDeadline : 18}, about ten days after the NBA's (Feb. 11, 2027).`],
      ["NBA moves", "A player traded for real stays on your team on the same contract. One who is waived, bought out or retires comes off your books automatically, and you can't sign him until a real team does. New NBA deals reach free agency at the real salary."],
      ["Expiring deals", `When a contract runs out, rookie deals included, keep him at his next real contract (at full value) or let him go for $${L ? L.settings.compDollars : 10} of extra summer draft budget. You can always trade him before it gets that far.`],
      ["Summer draft", `Every summer, one blind FAAB auction for incoming rookies and unsigned free agents. Budgets run from $${L ? L.settings.summerMax : 100} for the last-place team down to $${L ? L.settings.summerMin : 50} for the champion. Prospect rights you already hold carry over.`],
      ["Playoffs", `Top ${L ? L.settings.playoffTeams : 4} after week ${L ? L.settings.regWeeks : 21}: semifinals, then a final and a third-place game. A tied matchup goes to Game Score, then the higher seed. The pot pays ${(L ? L.settings.payout : [60, 25, 15]).join("/")}.`],
      ["Scoring", `Weekly head-to-head on FG%, FT%, 3PM, PTS, REB, AST, STL, BLK and TO${!L || L.settings.vorpCat !== false ? ", plus VORP: the value over replacement your starters added that week, from Basketball-Reference's daily season totals" : ""}. Each category is a win, loss or tie. Game Score breaks ties.`],
      ["HC Score", "Value over a replacement player per $10M of salary. A rookie deal that produces scores high; a max contract has to be great to clear 1."],
    ];
  };
  const rulesList = (L) => `<ul class="rules grid">${RULES(L).map(([a, b]) => `<li><b>${a}</b><span>${b}</span></li>`).join("")}</ul>`;

  function renderLanding() {
    const fake = { settings: { roster: 12, tiers: H.defaultTiers(NBA.cba, H.DEFAULTS.lineScale) }, teams: [], phase: "lobby" };
    const keepLG = LG; LG = fake;
    const sample = { tier: 0, hist: ["nikola-jokic", "cooper-flagg", "derrick-white", "jalen-johnson", "payton-pritchard"].filter((id) => BY[id]).map((pid) => ({ pid, from: 1, to: null })) };
    const bar = capBar(sample, { reserve: true });
    LG = keepLG;
    const mine = store.get("hc:leagues", []);
    const SIZES = [4, 6, 8, 10, 12, 14, 16], ROSTERS = [10, 11, 12, 13, 14, 15];
    app.innerHTML = `<div class="wrap">
      <section class="hero"><h1 class="disp"><span>Draft the player.</span><span>Carry the contract.</span></h1>
        <p>Hard Cap is dynasty fantasy basketball where every player costs his real NBA salary and every roster has to fit under a hard line. Talent has a price.</p>${bar}</section>
      <section class="landing">
        <form class="card form" id="create">
          <div><h2 class="disp">Start a league</h2><p class="muted small" style="margin:0">You'll be the commissioner. Send the invite link to your managers and they claim their own teams. Open teams are bots until someone claims them, so you can test the whole thing alone.</p></div>
          <div class="row2"><div class="field"><label for="ln">League name</label><input type="text" id="ln" name="name" value="Hard Cap League" maxlength="40" required></div>
          <div class="field"><label for="mn">Your name</label><input type="text" id="mn" name="manager" maxlength="30" required></div></div>
          <div class="field"><span class="lbl">Managers</span><div class="seg" role="group" aria-label="Managers">${SIZES.map((n) => `<button type="button" data-n="${n}" aria-pressed="${n === 10}">${n}</button>`).join("")}</div></div>
          <div class="row2"><div class="field"><span class="lbl">NBA roster spots</span><div class="seg" role="group" aria-label="Roster spots">${ROSTERS.map((n) => `<button type="button" data-ro="${n}" aria-pressed="${n === 12}">${n}</button>`).join("")}</div></div>
          <div class="field"><span class="lbl">Draft</span><div class="seg" role="group" aria-label="Draft type"><button type="button" data-m="live" aria-pressed="true">Live</button><button type="button" data-m="slow" aria-pressed="false">Slow</button></div></div></div>
          <div class="field"><span class="lbl">The line, in real NBA caps</span><div class="seg" role="group" aria-label="Line size">${[1, 1.25, 1.5, 1.75, 2].map((x) => `<button type="button" data-ls="${x}" aria-pressed="${x === H.DEFAULTS.lineScale}">${x}x</button>`).join("")}</div>
            <span class="ps" id="lsnote">${money(H.defaultTiers(NBA.cba, H.DEFAULTS.lineScale)[0].line)} cap line. At 1x about a third of the top 30 go undrafted; 1.75x gets them all rostered and leaves the overpaid ones on the board.</span></div>
          <div class="row2"><div class="field"><label for="cp">Commissioner PIN, 4 to 8 digits</label><input type="password" id="cp" name="pin" inputmode="numeric" pattern="\\d{4,8}" required autocomplete="new-password"></div>
          <div class="field"><label for="tn">Your team name</label><input type="text" id="tn" name="tname" maxlength="28" value="Needham Nightshift"></div></div>
          <p class="muted small" style="margin:0">Your PIN also signs you in to your own team. Everything else (clock, tiers, buy-in, order) is in Commissioner tools.</p>
          <div><button class="btn go" type="submit">Create the league</button></div>
        </form>
        <div class="stack">
          ${mine.length ? `<div class="card"><h3>Your leagues</h3><p class="muted small" style="margin:0">Jump back in from the league menu at the top of every page.</p><ul class="list" style="margin-top:8px">${mine.slice(0, 4).map((x) => `<li><a href="?l=${esc(x.id)}">${esc(x.name)}</a></li>`).join("")}</ul></div>` : ""}
          ${params.get("deleted") ? `<div class="banner gold"><div><b>${esc((store.get("hc:deleted", {}) || {}).name || "The league")} is in the trash.</b> <span class="muted">Restore it below with code ${esc(params.get("deleted"))} any time before ${fmtDate((store.get("hc:deleted", {}) || {}).until || Date.now() + 30 * 864e5)}.</span></div></div>` : ""}
          <form class="card form" id="restore"><h3>Restore a deleted league</h3><p class="muted small" style="margin:0">Deleted leagues stay in the trash for 30 days. Enter the league code and the commissioner PIN to bring one back with every team, claim and bid.</p>
            <div class="row2"><div class="field"><label for="rcode">League code</label><input type="text" id="rcode" name="code" value="${esc(params.get("deleted") || "")}" maxlength="12" required autocomplete="off"></div>
            <div class="field"><label for="rpin">Commissioner PIN</label><input type="password" id="rpin" name="pin" inputmode="numeric" pattern="\\d{4,8}" required autocomplete="current-password"></div></div>
            <div><button class="btn" type="submit">Restore league</button></div></form>
          <div class="card"><h3>Got an invite?</h3><p class="muted small" style="margin:0">Open the link your commissioner sent. It looks like davidsolar.dev/hardcap/?l=abc1234.</p></div>
          <div class="card"><h3>The defaults</h3><dl class="kv"><dt>Buy-in</dt><dd>$${H.DEFAULTS.buyIn}, plus any tier upgrade</dd><dt>Season FAAB</dt><dd>$${H.DEFAULTS.faab}, $${H.DEFAULTS.minBid} minimum bid</dd><dt>Scoring</dt><dd>9 categories plus VORP, weekly</dd><dt>Playoffs</dt><dd>Top ${H.DEFAULTS.playoffTeams}, weeks ${H.DEFAULTS.regWeeks + 1} and ${H.DEFAULTS.regWeeks + 2}</dd><dt>Payout</dt><dd>${H.DEFAULTS.payout.join(" / ")}</dd></dl></div>
        </div>
      </section>
      <section class="card rules-mod"><div class="head"><h2 class="disp">The rules</h2><span class="muted small">The commissioner can change any of these numbers before the draft.</span></div>${rulesList(null)}</section></div>`;
    const rf = $("#restore");
    rf.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(rf), pin = String(fd.get("pin"));
      let r;
      try { r = await rpc("hc_restore", { p_id: String(fd.get("code")), p_pin: pin }); } catch (err) { return toast(err.message, true); }
      if (r.error) return toast(r.error, true);
      store.set("hc:me:" + r.id, Object.assign({}, store.get("hc:me:" + r.id, {}), { commish: pin }));
      store.set("hc:leagues", [{ id: r.id, name: r.name }, ...store.get("hc:leagues", []).filter((x) => x.id !== r.id)].slice(0, 12));
      location.href = `?l=${r.id}#league`;
    };
    if (location.hash === "#restore") rf.scrollIntoView({ block: "center" });
    let n = 10, mode = "live", ro = 12;
    const f = $("#create");
    $$("[data-n]", f).forEach((b) => (b.onclick = () => { n = +b.dataset.n; $$("[data-n]", f).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    $$("[data-m]", f).forEach((b) => (b.onclick = () => { mode = b.dataset.m; $$("[data-m]", f).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    let ls = H.DEFAULTS.lineScale;
    $$("[data-ls]", f).forEach((b) => (b.onclick = () => { ls = +b.dataset.ls; $$("[data-ls]", f).forEach((x) => x.setAttribute("aria-pressed", x === b)); $("#lsnote").textContent = `${money(H.defaultTiers(NBA.cba, ls)[0].line)} cap line, ${money(H.defaultTiers(NBA.cba, ls)[3].line)} second apron.`; }));
    $$("[data-ro]", f).forEach((b) => (b.onclick = () => { ro = +b.dataset.ro; $$("[data-ro]", f).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f), pin = String(fd.get("pin"));
      const btn = $("button[type=submit]", f); btn.disabled = true;
      const L = H.newLeague({ cba: NBA.cba, teams: n, name: fd.get("name"), now: Date.now(), opener, settings: { draftMode: mode, roster: ro, lineScale: ls } });
      const tname = String(fd.get("tname") || "").trim();
      if (tname) renameTeam(L, 0, tname);
      try {
        const r = await rpc("hc_create", { p_name: fd.get("name"), p_pin: pin, p_state: L });
        if (r.error) throw new Error(r.error);
        const c = await rpc("hc_claim", { p_id: r.id, p_team: 0, p_manager: fd.get("manager"), p_pin: pin });
        if (c.error) throw new Error(c.error);
        store.set("hc:me:" + r.id, { team: 0, pin, commish: pin });
        store.set("hc:leagues", [{ id: r.id, name: String(fd.get("name")) }, ...mine.filter((x) => x.id !== r.id)].slice(0, 12));
        location.href = `?l=${r.id}#commish/draft`;
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
    if (p === "prospects" && LG.pauction) return `<div class="banner gold"><div><div class="disp">Live Prospect Board auction</div><div class="muted small">${LG.pauction.started == null ? "Starts when the commissioner says go." : `${LG.pauction.results.length} prospects sold so far.`} Teams nominate in first-round order and bid from season FAAB.</div></div><span class="grow"></span><a class="btn go" href="#draft/prospects">Go to the auction</a></div>`;
    if (p === "prospects") return `<div class="banner gold"><div><div class="disp">Prospect Board auction</div><div class="muted small">Blind FAAB bids for two prospect spots. Closes ${fmtWhen(LG.due.auction)}.</div></div><span class="grow"></span><a class="btn go" href="#draft/prospects">Place bids</a></div>`;
    const cw = curWeek();
    return `<div class="banner"><div><div class="disp">Week ${cw}</div><div class="muted small">${weekLabel(cw)}. Waivers run ${fmtWhen(LG.due.waiver || H.nextWaiverRun(now()))}.</div></div></div>`;
  }
  const weekLabel = (w) => { const [a, b] = H.weekDates(opener, w); return `${fmtDate(a)} to ${fmtDate(b)}`; };

  function viewLeague(sub) {
    if (sub === "standings") return viewStandings();
    if (sub === "schedule") return viewSchedule();
    if (sub === "tx") return viewTx();
    if (sub === "settings") return viewSettings();
    if (sub === "board") return viewBoard();
    if (sub === "rules") return `<div class="head"><h1 class="disp">Rules</h1></div><section class="card rules-mod">${rulesList(LG)}</section>`;
    return viewOffice();
  }
  function standingsRows(st) {
    return st.map((r, i) => {
      const t = LG.teams[r.id], pay = H.payroll(t, BY), line = H.ceilingOf(LG, t), room = line - pay;
      return `<tr class="${isMine(t) ? "me" : ""}${i === LG.settings.playoffTeams - 1 && LG.phase === "league" ? " cut" : ""}">
        <td class="r num">${i + 1}</td>
        <td><a class="btn link" href="#team/roster/${t.id}">${esc(t.name)}</a> ${ownerTag(t)} ${tierTag(t)}${t.overDeadline ? ` <span class="tag t3">Over line</span>` : ""}<div class="ps">${t.owner ? esc(t.owner) : "Bot until claimed"}</div></td>
        <td class="r num">${r.w}-${r.l}-${r.t}</td><td class="r num hide-s">${r.pct.toFixed(3).replace(/^0/, "")}</td>
        <td class="r num hide-m">${r.gmsc.toFixed(0)}</td>
        <td class="r num hide-s">${money(pay)}</td><td class="r num hide-s">${money(line)}</td>
        <td class="r num"><b class="${room >= 0 ? "ok" : "bad"}">${money(room)}</b></td>
        <td class="r num">$${t.faab}</td><td class="r num hide-s">${t.prospects.length}/${LG.settings.prospects}</td><td class="r num hide-m">$${H.owed(LG, t)}</td></tr>`;
    }).join("");
  }
  const STAND_HEAD = `<thead><tr><th class="r">#</th><th>Team</th><th class="r">Cats</th><th class="r hide-s">Pct</th><th class="r hide-m">GmSc</th><th class="r hide-s">On books</th><th class="r hide-s">Line</th><th class="r">Room</th><th class="r">FAAB</th><th class="r hide-s">Prosp</th><th class="r hide-m">Owes</th></tr></thead>`;
  const standingsNow = () => (LG.phase === "league" ? H.standings(LG, curWeek() - 1, WK, BY) : LG.teams.map((t) => ({ id: t.id, w: 0, l: 0, t: 0, pct: 0, mw: 0, ml: 0, mt: 0, gmsc: 0, pf: [] })));
  /* ---------- message board ---------- */
  let CHAT = [], chatLast = 0, chatBusy = false;
  const seenKey = () => "hc:chatseen:" + LID;
  async function loadChat() {
    if (!LID || chatBusy) return false;
    chatBusy = true;
    try {
      const rows = await rpc("hc_chat_list", { p_id: LID, p_after: chatLast });
      if (Array.isArray(rows) && rows.length) { CHAT = CHAT.concat(rows).slice(-300); chatLast = rows[rows.length - 1].id; return true; }
    } catch (e) { /* the board can wait for the next poll */ } finally { chatBusy = false; }
    return false;
  }
  const unread = () => { const seen = store.get(seenKey(), 0); return CHAT.filter((m) => m.id > seen && !(me.team != null && m.team === me.team)).length; };
  function viewBoard() {
    if (CHAT.length) store.set(seenKey(), chatLast);
    const canPost = me.team != null || me.commish;
    const day = (d) => new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    let lastDay = "";
    const items = CHAT.map((m) => {
      const d = day(m.at), head = d !== lastDay ? `<li class="day">${d}</li>` : ""; lastDay = d;
      const mine = me.team != null && m.team === me.team;
      return `${head}<li class="msg${mine ? " mine" : ""}${m.team === -1 ? " cm" : ""}"><div class="who">${esc(m.author)} <time>${new Date(m.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time></div><div class="body">${esc(m.body)}</div></li>`;
    }).join("");
    return `<div class="head"><h1 class="disp">Message board</h1><span class="muted">Trash talk, trade talk, league business</span></div>
      <section class="card board-card"><ul class="chat" id="chatlist">${items || `<li class="empty">Nothing here yet. Start it off.</li>`}</ul>
      ${canPost ? `<form class="chat-form" id="chatform"><label class="sr" for="chatbody">Message</label><textarea id="chatbody" maxlength="600" rows="2" placeholder="Say something to the league">${esc(ui.chatDraft || "")}</textarea><button class="btn go" type="submit">Post</button></form>` : `<p class="ps">Claim or sign in to your team to post.</p>`}</section>`;
  }
  function viewStandings() {
    const st = standingsNow();
    return `<div class="head"><h1 class="disp">Standings</h1><span class="muted">Category record through week ${Math.max(0, curWeek() - 1)}</span></div>
      <div class="table-wrap"><table class="t stand">${STAND_HEAD}<tbody>${standingsRows(st)}</tbody></table></div>
      <p class="ps">Room is what each team can still add under its own line. Top ${LG.settings.playoffTeams} make the playoffs after week ${LG.settings.regWeeks}; the line under ${ordinal(LG.settings.playoffTeams)} marks the cut.</p>
      ${LG.phase === "league" ? `<div class="cols2">${officeBracket()}${summerCard(st)}</div>` : ""}`;
  }
  function viewSchedule() {
    const cw = curWeek(), R = LG.settings.regWeeks;
    const weeks = LG.schedule.slice(0, R).map((pairs, k) => {
      const w = k + 1, done = LG.phase === "league" && w < cw && WK[String(w)];
      const ms = done ? H.matchups(LG, w, WK, BY) : null;
      return `<section class="card wk${w === cw ? " now" : ""}"><div class="wk-h"><b>Week ${w}</b><span class="ps">${weekLabel(w)}${w === cw ? ", this week" : ""}</span></div>
        <ul class="list">${pairs.map(([a, b], i) => { const m = ms && ms[i]; const mine = isMine(LG.teams[a]) || isMine(LG.teams[b]);
          return `<li class="${mine ? "me" : ""}"><span>${esc(LG.teams[a].abbr)} vs ${esc(LG.teams[b].abbr)}</span><span class="grow"></span>${m ? `<button class="btn link num" data-wk="${w}" data-go="matchups">${m.cmp.w}-${m.cmp.l}${m.cmp.t ? "-" + m.cmp.t : ""}</button>` : ""}</li>`; }).join("")}</ul></section>`;
    }).join("");
    return `<div class="head"><h1 class="disp">Schedule</h1><span class="muted">${R} regular-season weeks, then the playoffs in weeks ${R + 1} and ${R + 2}</span></div><div class="sched">${weeks}</div>`;
  }
  function viewSettings() {
    const s = LG.settings;
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    return `<div class="head"><h1 class="disp">League settings</h1>${me.commish ? `<a class="btn sm" href="#commish">Change settings</a>` : ""}</div>
      <div class="cols2"><section class="card"><h3>Rosters and money</h3><dl class="kv">
        ${row("Teams", LG.teams.length)}${row("NBA roster spots", s.roster)}${row("Prospect spots", s.prospects)}${row("IR spots", `${s.irSlots}, Out players only`)}
        ${row("Lines", `${s.tiers.map((t) => `${esc(t.label)} ${money(t.line)}${t.add ? ` (+$${t.add})` : ""}`).join("<br>")}${(s.lineScale || 1) !== 1 ? `<br><span class="ps">${s.lineScale} times the real NBA lines</span>` : ""}`)}${row("Buy-in", "$" + s.buyIn)}${row("Payout", s.payout.join(" / "))}
        ${row("Season FAAB", `$${s.faab}, $${s.minBid} minimum`)}</dl></section>
      <section class="card"><h3>Season</h3><dl class="kv">
        ${row("Draft", s.draftMode === "slow" ? `Slow, ${s.slowHours} hours a pick` : `Live, ${s.clock} seconds a pick`)}${row("Scoring", `Head-to-head: ${H.catsFor(LG).map((c) => c.label).join(", ")}`)}
        ${row("Lineups", "PG, SG, G, SF, PF, F, C, UTIL, UTIL; weekly, locked at the first tip")}${row("Waivers", "Mondays, 3 a.m. Eastern")}
        ${row("Trade review", s.tradeReview === "vote" ? `League vote, ${s.reviewHours} hours, vetoed by half the other managers` : s.tradeReview === "none" ? "None" : `Commissioner, ${s.vetoHours} hours`)}
        ${row("Trade deadline", `End of week ${s.tradeDeadline}`)}${row("Tier upgrades", `Through week ${s.tierDeadline}`)}
        ${row("Playoffs", `Top ${s.playoffTeams}, weeks ${s.regWeeks + 1} and ${s.regWeeks + 2}`)}${row("Summer budgets", `$${s.summerMax} worst to $${s.summerMin} best, +$${s.compDollars} per player let go`)}</dl></section></div>`;
  }
  function viewOffice() {
    const st = standingsNow();
    const rows = standingsRows(st);
    const counts = LG.settings.tiers.map((tier, k) => ({ tier, n: LG.teams.filter((t) => (t.tier || 0) === k).length }));
    const ms = LG.phase === "league" ? H.matchups(LG, defaultWeek(), WK, BY) : [];
    const mine = ms.find((m) => isMine(LG.teams[m.a]) || isMine(LG.teams[m.b]));
    const recent = LG.log.slice(-6).reverse();
    return `${mine && LG.phase === "league" ? myMatchupCard(mine) : phaseBanner()}
      <div class="cols"><section class="stack"><div class="head"><h1 class="disp">${esc(LG.name)}</h1></div>
        <div class="table-wrap"><table class="t stand">${STAND_HEAD}<tbody>${rows}</tbody></table></div>
        <p class="ps">Room is what each team can still add under its own line: the number to check before you call about a trade. ${LG.phase === "league" ? `Top ${LG.settings.playoffTeams} make the playoffs after week ${LG.settings.regWeeks}.` : ""}</p>
        ${ms.length ? `<div class="head"><h2 class="disp" style="font-size:26px;margin:0">Week ${defaultWeek()}</h2><a class="btn sm" href="#matchups">All matchups</a></div><div class="slate">${ms.map((m, i) => gameCard(m, i)).join("")}</div>` : ""}
      </section>
      <aside class="stack">
        <div class="card"><h3>The pot</h3><div class="disp" style="font-size:44px">$${H.pot(LG)}</div>
          <dl class="kv" style="margin-top:8px">${counts.map((c) => `<dt>${esc(c.tier.label)} ($${LG.settings.buyIn + c.tier.add})</dt><dd>${c.n} team${c.n === 1 ? "" : "s"}</dd>`).join("")}</dl>
          <dl class="kv" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">${LG.settings.payout.map((pc, k) => `<dt>${["Champion", "Runner-up", "Third place"][k] || ordinal(k + 1)} (${pc}%)</dt><dd>$${Math.round((H.pot(LG) * pc) / 100)}</dd>`).join("")}</dl>
          <p class="ps" style="margin-bottom:0">Tier upgrades are tagged on every team and can't be undone this season.</p></div>
        ${LG.phase === "league" ? officeBracket() : ""}
        <div class="card"><h3>Latest moves</h3>${recent.length ? `<ul class="list">${recent.map((x) => `<li><span>${esc(x.text)}</span></li>`).join("")}</ul>` : `<p class="empty">Nothing yet.</p>`}<a class="btn sm" href="#league/tx">All transactions</a></div>
      </aside></div>`;
  }
  // Your matchup at the top of the overview, the way Yahoo leads with it.
  function myMatchupCard(m) {
    const A = LG.teams[m.a], B = LG.teams[m.b], c = m.cmp, w = defaultWeek();
    const meA = isMine(A), us = meA ? A : B, them = meA ? B : A, uw = meA ? c.w : c.l, tw = meA ? c.l : c.w;
    const cats = c.cats.map((x) => { const win = meA ? x.out === "w" : x.out === "l", loss = meA ? x.out === "l" : x.out === "w";
      return `<span class="mc ${win ? "w" : loss ? "l" : ""}" title="${x.cat.label}: ${fmtCat(x.cat, meA ? x.a : x.b)} to ${fmtCat(x.cat, meA ? x.b : x.a)}">${x.cat.label}</span>`; }).join("");
    return `<a class="card mymatch" href="#matchups" data-wk="${w}"><div class="mm-l"><span class="ps">Week ${w}${w === curWeek() ? ", in progress" : ", final"}</span><b class="disp">${esc(us.name)}</b><span class="ps">vs ${esc(them.name)}. Now: week ${curWeek()}, ${weekLabel(curWeek())}; waivers ${fmtWhen(LG.due.waiver || H.nextWaiverRun(now()))}</span></div>
      <div class="disp mm-s ${uw > tw ? "ok" : uw < tw ? "bad" : ""}">${uw}-${tw}${c.t ? "-" + c.t : ""}</div><div class="mm-c">${cats}</div></a>`;
  }
  function officeBracket() {
    const b = H.bracket(LG, WK, BY);
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
  function viewTeam(sub, arg) {
    const t = teamFor(arg);
    const mine = isMine(t);
    const body = sub === "trades" ? tradesCard(myTeam(), t) : ({ roster: teamLineup, contracts: teamContracts, fits: teamFits }[sub] || teamLineup)(t, mine);
    const tiers = LG.settings.tiers;
    const sick = H.irProblem(LG, t, INJ);
    const tierCard = `<div class="card"><h3>Spending tier</h3><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="disp" style="font-size:26px">${esc(H.tierOf(LG, t).label)}</span><span class="muted">${money(H.ceilingOf(LG, t))} line, owes $${H.owed(LG, t)}</span></div>
      ${mine ? `<div class="tools" style="margin-top:10px">${tiers.map((x, k) => (k > (t.tier || 0) ? `<button class="btn sm" data-tier="${k}">Move up to ${esc(x.label)} (+$${x.add - H.tierOf(LG, t).add})</button>` : "")).join("") || `<span class="muted small">Top tier. Nowhere left to climb.</span>`}</div>
        <p class="ps" style="margin-bottom:0">Upgrades are permanent for the season and open through week ${LG.settings.tierDeadline}.</p>` : ""}
      ${t.tierLog.length ? `<ul class="list" style="margin-top:8px">${t.tierLog.map((x) => `<li><time>${fmtDate(x.at)}</time><span>Moved up to ${esc(tiers[x.tier].label)}</span></li>`).join("")}</ul>` : ""}</div>`;
    const over = t.overDeadline ? `<div class="banner red"><div><b>${esc(t.name)} is ${money(H.payroll(t, BY) - H.ceilingOf(LG, t))} over its line</b> after a real salary change. <span class="muted">No adds until it's back under. Release someone, trade salary away or move up a tier by ${fmtWhen(t.overDeadline)}; after that the lowest-ranked players are released until it fits.</span></div></div>` : "";
    return `<div class="teampick"><label class="sr" for="tpick">Team</label><select id="tpick" class="brand-sel">${LG.teams.map((x) => `<option value="${x.id}"${x.id === t.id ? " selected" : ""}>${esc(x.name)}${isMine(x) ? " (you)" : ""}</option>`).join("")}</select></div>
      <div class="head"><h1 class="disp">${esc(t.name)}</h1><span>${ownerTag(t)} ${tierTag(t)}</span><span class="muted">${t.owner ? esc(t.owner) : "Open team, run by a bot"}, $${t.faab} FAAB</span></div>
      ${over}${sick ? `<div class="banner gold"><div><b>${esc(nameOf(sick))} is healthy on IR.</b> <span class="muted">Activate or release him before any adds or trades.</span></div></div>` : ""}
      <div class="card">${capBar(t)}${(t.ir || []).length ? `<p class="ps" style="margin:0">${t.ir.map((id) => `${esc(nameOf(id))} (${money(BY[id].sal)})`).join(", ")} on IR, off the books.</p>` : ""}</div>
      <div class="cols"><section class="stack">${body}</section>
      <aside class="stack">${tierCard}
        <div class="card"><h3>Prospect rights</h3>${t.prospects.length ? `<ul class="list">${t.prospects.map((id) => `<li><span>${pl(id)} <span class="ps">${esc(PBY[id] ? `${PBY[id].school}, ${PBY[id].pos}, big board ${PBY[id].rank}` : "")}</span></span><span class="grow"></span>${mine && LG.phase === "league" ? `<button class="btn sm" data-drop="${id}">Release</button>` : ""}</li>`).join("")}</ul>` : `<p class="empty">${LG.phase === "league" ? "None. Unclaimed prospects are under Players, Prospect Board." : "The Prospect Board auction follows the draft."}</p>`}</div>
        ${mine && (LG.phase === "lobby" || LG.phase === "nba") ? `<div class="card"><h3>Draft queue</h3>${t.queue.length ? `<ol class="list">${t.queue.map((id, i) => `<li><span>${i + 1}. ${pl(id)}</span><span class="grow"></span><button class="btn sm" data-unqueue="${id}">Remove</button></li>`).join("")}</ol>` : `<p class="empty">Add players from the Draft tab or Players. If your clock runs out, the first one who fits is your pick.</p>`}</div>` : ""}
      </aside></div>`;
  }
  // The week a lineup edit applies to: this week until its first tip, then next week.
  const editWeek = () => { const cw = curWeek(); return now() < H.lockTime(opener, cw) ? cw : Math.min(cw + 1, H.totalWeeks(LG)); };
  function teamLineup(t, mine) {
    // Lineups open once the NBA draft is done, so a long prospect auction doesn't cost anyone a week.
    if (LG.phase !== "league" && LG.phase !== "prospects") {
      const ids = H.active(t).map((id) => BY[id]).filter(Boolean).sort((a, b) => b.sal - a.sal);
      return `<div class="table-wrap"><table class="t"><thead><tr><th>Player</th><th>Pos</th><th class="r">2026-27</th><th class="r">HC</th>${LINE_HEAD}</tr></thead><tbody>${ids.map((p) => `<tr><td>${pl(p.id, true)}</td><td class="ps">${H.positions(p).join("/")}</td><td class="r"><span class="sal num">${money(p.sal)}</span></td>${hcCell(p)}${lineCells(p)}</tr>`).join("") || `<tr><td colspan="14" class="empty">No players yet.</td></tr>`}</tbody></table></div>`;
    }
    const w = ui.lw && ui.lw >= curWeek() ? ui.lw : editWeek();
    const locked = now() >= H.lockTime(opener, w);
    const lu = (ui.draftLineup && ui.draftLineup.w === w && ui.draftLineup.t === t.id) ? ui.draftLineup.slots : H.lineupFor(LG, t, w, BY);
    const ros = H.rosterInWeek(t, w).filter((id) => !(t.ir || []).includes(id));
    const bench = ros.filter((id) => !lu.includes(id));
    const s = (id) => seasonLine(id);
    // Yahoo-style moves: tap Move on a player, then Here on the slot or bench spot he goes to.
    const mv = mine && !locked && ui.lmove && ui.lmove.w === w ? ui.lmove : null;
    const srcP = mv && BY[mv.pid];
    const canHere = (slot, id, i) => {
      if (!mv || id === mv.pid) return false;
      if (i != null) {                                                    // a starting slot
        if (!H.eligible(srcP, H.SLOTS[i])) return false;
        if (!id) return true;
        return mv.i == null || H.eligible(BY[id], H.SLOTS[mv.i]);         // from the bench he just sits; from a slot he swaps
      }
      return mv.i != null && H.eligible(BY[id], H.SLOTS[mv.i]);           // a bench player swaps into the starter's slot
    };
    const row = (slot, id, i) => {
      const p = id && BY[id], l = id && s(id), g = l ? l[0] : 0, pg = (k) => (g ? (l[C[k]] / g).toFixed(1) : "-");
      const here = canHere(slot, id, i), isSrc = mv && id && id === mv.pid;
      const moveBtn = mine && !locked ? (isSrc ? `<button class="btn sm" data-lcancel>Cancel</button>` : here ? `<button class="btn sm go" data-lhere="${i == null ? "bn:" + id : i}">Here</button>` : !mv && p ? `<button class="btn sm" data-lmove="${id}" data-lfrom="${i == null ? "" : i}" aria-label="Move ${esc(p.n)}">Move</button>` : "") : "";
      const out = id && H.isOut(INJ[id]);
      return `<tr class="${slot === "BN" ? "bench" : ""}${isSrc ? " me" : ""}${here ? " target" : ""}"><td style="white-space:nowrap"><b class="tag${slot === "BN" ? "" : " w"}">${slot}</b> ${moveBtn}</td><td>${p ? pl(id, true) : `<span class="muted">Empty</span>`}</td>
        <td class="r"><span class="sal num">${p ? money(p.sal) : ""}</span></td>${p ? gCell(p, w) : "<td></td>"}${p ? hcCell(p) : "<td></td>"}<td class="r num">${g || "-"}</td><td class="r num">${pg("pts")}</td><td class="r num hide-s">${pg("reb")}</td><td class="r num hide-s">${pg("ast")}</td>
        <td class="r" style="white-space:nowrap">${mine && p ? `${out && (t.ir || []).length < LG.settings.irSlots ? `<button class="btn sm" data-ir="${id}">To IR</button> ` : ""}<button class="btn sm" data-drop="${id}">Release</button>` : !mine && p && myTeam() ? `<button class="btn sm" data-trade="${t.id}" data-pid="${id}">Trade</button>` : ""}</td></tr>`;
    };
    return `<div class="tools"><b>Week ${w} lineup</b><span class="muted small">${weekLabel(w)}, ${locked ? "locked" : `locks ${fmtWhen(H.lockTime(opener, w))}`}</span><span class="grow"></span>
        ${w > curWeek() ? `<button class="btn sm" data-lw="${w - 1}">This week</button>` : w < H.totalWeeks(LG) ? `<button class="btn sm" data-lw="${w + 1}">Next week</button>` : ""}
        ${mine && !locked ? `${mv && mv.i != null ? `<button class="btn sm go" data-lbench>Move to bench</button>` : ""}<button class="btn sm" data-lauto>Best lineup</button><button class="btn sm${ui.draftLineup && ui.draftLineup.w === w ? " go" : ""}" data-lsave="${w}">${ui.draftLineup && ui.draftLineup.w === w ? "Save best lineup" : "Save lineup"}</button>` : ""}</div>
      ${mv ? `<p class="ps" style="margin:0">Moving ${esc(srcP.n)}: tap Here on a highlighted spot.</p>` : ""}
      <div class="table-wrap"><table class="t"><thead><tr><th>Slot</th><th>Player</th><th class="r">Salary</th><th class="r" title="NBA games this fantasy week">G</th><th class="r">HC</th><th class="r" title="Games played this season">GP</th><th class="r">PTS</th><th class="r hide-s">REB</th><th class="r hide-s">AST</th><th></th></tr></thead><tbody>
        ${lu.map((id, i) => row(H.SLOTS[i], id, i)).join("")}${bench.map((id) => row("BN", id, null)).join("")}
        ${(t.ir || []).map((id) => { const p = BY[id]; return `<tr><td><b class="tag t3">IR</b></td><td>${pl(id, true)}</td><td class="r"><span class="sal num muted">${money(p.sal)}</span><div class="ps">off the books</div></td><td colspan="5" class="ps">${esc((INJ[id] || [])[1] || (INJ[id] ? INJ[id][0] : "Healthy: activate him"))}</td><td class="r">${mine ? `<button class="btn sm go" data-activate="${id}">Activate</button>` : ""}</td></tr>`; }).join("")}
      </tbody></table></div>
      <p class="ps">Only the nine starters score. Lineups are weekly and lock at the week's first tip; if you never set one, the best available lineup is set for you. Players listed Out can move to IR (${LG.settings.irSlots} spots), where their salary doesn't count against your line.</p>`;
  }
  function teamContracts(t) {
    const ids = [...H.rostered(t)].map((id) => BY[id]).filter(Boolean).sort((a, b) => b.sal - a.sal);
    const yrs = [0, 1, 2, 3, 4, 5];
    const cell = (p, i) => {
      const v = i === 0 ? p.sal : p.future[i - 1];
      if (v) return `<td class="r num">${money(v)}${p.opt[i] ? ` <span class="pill">${esc(p.opt[i])}</span>` : ""}</td>`;
      if (p.fa.year === 2026 + i) return `<td class="r"><span class="tag ${p.fa.kind === "RFA" ? "t1" : "w"}">${p.fa.kind}</span></td>`;
      return `<td></td>`;
    };
    const totals = yrs.map((i) => ids.filter((p) => !(t.ir || []).includes(p.id) || i > 0).reduce((s, p) => s + ((i === 0 ? p.sal : p.future[i - 1]) || 0), 0));
    const line = H.ceilingOf(LG, t);
    return `<div class="table-wrap"><table class="t"><thead><tr><th>Player</th>${yrs.map((i) => `<th class="r">${season(i)}</th>`).join("")}</tr></thead><tbody>
      ${ids.map((p) => `<tr><td>${pl(p.id, true)}${(t.ir || []).includes(p.id) ? ` <span class="tag t3">IR</span>` : ""} ${typeTag(p)}</td>${yrs.map((i) => cell(p, i)).join("")}</tr>`).join("")}
      <tr><td><b>Committed</b><div class="ps">IR salary left out this season</div></td>${totals.map((v) => `<td class="r num"><b>${money(v)}</b></td>`).join("")}</tr>
      <tr><td><b>Room under ${money(line)}</b><div class="ps">This season's line, before raises</div></td>${totals.map((v) => `<td class="r num"><b class="${line - v >= 0 ? "ok" : "bad"}">${money(line - v)}</b></td>`).join("")}</tr>
      </tbody></table></div>
      <p class="ps">UFA or RFA marks the summer a deal runs out: RFA means a first-round rookie deal ending. When any contract expires, rookie deals included, you can keep him at his next real contract (full value), trade him before then, or let him go for extra summer draft budget. PO, TO and NG are player options, team options and non-guaranteed years. Future lines move with the real cap.</p>`;
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
  function viewMarket(sub) {
    ui.kind = sub === "prospects" ? "prospects" : "nba";
    if (ui.kind === "nba") ui.status = { fa: "fa", all: "all", owned: "own" }[sub] || "fa";
    else if (ui.status === "own") ui.status = "fa";
    const ctx = H.context(LG, POOL);
    const t = myTeam();
    const q = ui.q.trim().toLowerCase();
    if (ui.kind === "prospects") {
      const rows = PROS.filter((p) => (ui.status === "all" || (ui.status === "fa" ? ctx.own[p.id] == null : ctx.own[p.id] != null)) && (!q || p.n.toLowerCase().includes(q) || p.school.toLowerCase().includes(q)));
      return marketTools() + `<div class="table-wrap"><table class="t dense"><thead><tr><th class="r">Board</th><th class="r" title="Spots moved since the preseason board">Move</th><th>Prospect</th><th>School</th><th class="r hide-s">Age</th>${PROS_STATS.map(([, l], i) => `<th class="r${i > 2 ? " hide-s" : ""}">${l}</th>`).join("")}<th>Rights</th><th></th></tr></thead><tbody>
        ${rows.map((p) => { const o = ctx.own[p.id]; return `<tr class="${p.off ? "dim" : ""}"><td class="r num">${p.off ? "-" : p.rank}</td><td class="r">${moveTagP(p)}</td><td class="nm">${pl(p.id)} <span class="ps">${esc(p.posFull || p.pos)}</span></td><td>${esc(p.school)}</td><td class="r num hide-s">${ageOf(p)}</td>${PROS_STATS.map(([k], i) => `<td class="r num${i > 2 ? " hide-s" : ""}">${pstat(p, k)}</td>`).join("")}
          <td>${o != null ? `<a class="btn link" href="#team/roster/${o}">${esc(LG.teams[o].abbr)}</a>` : `<span class="muted">Available</span>`}</td>
          <td class="r">${o == null && t ? (LG.phase === "league" ? `<button class="btn sm go" data-bid="${p.id}">Bid</button>` : LG.phase === "prospects" ? `<a class="btn sm go" href="#draft/prospects">Auction</a>` : "") : ""}</td></tr>`; }).join("")}</tbody></table></div>`;
    }
    let rows = POOL.filter((p) => (ui.status === "all" || (ui.status === "fa" ? ctx.own[p.id] == null && !p.gone : ctx.own[p.id] != null)) && (!q || p.n.toLowerCase().includes(q)) && passFilters(p));
    sortRows(rows);
    const total = rows.length;
    rows = rows.slice(0, 200);
    return marketTools(total) + `<div class="table-wrap"><table class="t"><thead><tr>${sortTh("rank", "Rk", "r", "Nine-category rank")}${sortTh("dyn", "Dyn", "r hide-s", "Dynasty rank")}${YAHOO.players ? sortTh("yahoo", "Y!", "r hide-m", "Yahoo rank this season") : ""}${sortTh("name", "Player", "")}${sortTh("age", "Age", "r hide-s")}<th>Status</th>${sortTh("sal", "Salary")}${sortTh("gw", "G", "r", "NBA games this fantasy week")}${sortTh("hc", "HC", "r", "HC Score: value over replacement per $10M")}${vorpHeadS()}${lineHeadS()}<th></th></tr></thead><tbody>
      ${rows.map((p) => {
        const o = ctx.own[p.id];
        let act = "";
        if (t && o == null && (LG.phase === "lobby" || LG.phase === "nba")) act = t.queue.includes(p.id) ? `<button class="btn sm" data-unqueue="${p.id}">Queued</button>` : `<button class="btn sm" data-queue="${p.id}">Queue</button>`;
        else if (t && o == null && LG.phase === "league" && !p.gone) act = `<button class="btn sm go" data-bid="${p.id}">Bid</button>`;
        else if (t && o != null && o !== t.id && LG.phase === "league") act = `<button class="btn sm" data-trade="${o}" data-pid="${p.id}">Trade</button>`;
        const g = perGame(p);
        return `<tr class="${o === me.team && me.team != null ? "me" : ""}"><td class="r num ps">${p.rank}</td><td class="r num ps hide-s">${p.dynRank}</td>${YAHOO.players ? `<td class="r num ps hide-m">${(YAHOO.players[p.id] || {}).ar || (YAHOO.players[p.id] || {}).or || "-"}</td>` : ""}<td>${pl(p.id)} ${p.deal ? typeTag(p) : ""}<div class="ps">${p.t}, ${H.positions(p).join("/")}${g && g.prev ? ", 2025-26 line" : ""}</div></td><td class="r num hide-s">${p.age}</td>
          <td>${o != null ? `<a class="btn link" href="#team/roster/${o}">${esc(LG.teams[o].abbr)}</a>` : `<span class="muted">FA</span>`}</td>
          <td class="r"><div class="sal num">${money(p.sal)}</div><div class="ps">${p.future.length ? `thru ${season(p.future.length).slice(2)}` : "expiring"}, ${p.fa.kind}</div></td>${gCell(p)}${hcCell(p)}${vorpCells(p)}${lineCells(p)}<td class="r">${act}</td></tr>`;
      }).join("") || `<tr><td colspan="18" class="empty">No one matches. Clear the search or filters.</td></tr>`}</tbody></table></div>`;
  }
  const SORTS = { rank: (a, b) => a.rank - b.rank, dyn: (a, b) => a.dynRank - b.dynRank, hc: (a, b) => b.hc - a.hc, sal: (a, b) => b.sal - a.sal, cheap: (a, b) => a.sal - b.sal,
    pts: (a, b) => stat(b, "pts") - stat(a, "pts"), reb: (a, b) => stat(b, "reb") - stat(a, "reb"), ast: (a, b) => stat(b, "ast") - stat(a, "ast"), tpm: (a, b) => stat(b, "tpm") - stat(a, "tpm"),
    stl: (a, b) => stat(b, "stl") - stat(a, "stl"), blk: (a, b) => stat(b, "blk") - stat(a, "blk"), young: (a, b) => a.age - b.age,
    yahoo: (a, b) => yrank(a) - yrank(b), gw: (a, b) => (gw(b) || 0) - (gw(a) || 0) || a.rank - b.rank, name: (a, b) => last(a.n).localeCompare(last(b.n)), team: (a, b) => a.t.localeCompare(b.t) || a.rank - b.rank,
    pos: (a, b) => H.positions(a).join().localeCompare(H.positions(b).join()) || a.rank - b.rank, age: (a, b) => a.age - b.age || a.rank - b.rank,
    yrs: (a, b) => b.future.length - a.future.length || a.rank - b.rank, tov: (a, b) => stat(a, "tov") - stat(b, "tov"),
    fg: (a, b) => shoot(b, "fgm", "fga") - shoot(a, "fgm", "fga"), ft: (a, b) => shoot(b, "ftm", "fta") - shoot(a, "ftm", "fta"),
    vorp: (a, b) => (b.bbv == null ? -99 : b.bbv) - (a.bbv == null ? -99 : a.bbv), vpm: (a, b) => (b.vpm == null ? -99 : b.vpm) - (a.vpm == null ? -99 : a.vpm) };
  const yrank = (p) => { const y = YAHOO.players && YAHOO.players[p.id]; return y ? y.ar || y.or || 999 : 999; };
  function stat(p, k) { const g = perGame(p); return g ? g.l[C[k]] : k === "tov" ? 99 : -1; }
  function shoot(p, m, a) { const g = perGame(p); return g && g.l[C[a]] ? g.l[C[m]] / g.l[C[a]] : -1; }
  // Columns you can sort by from a header but that the sort menu doesn't list.
  const SORT_NAMES = { gw: "games this week", name: "player name", team: "NBA team", pos: "position", age: "age", yrs: "years left", tov: "fewest turnovers", fg: "FG%", ft: "FT%" };
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
    const sel = (key, label, opts) => `<label class="sr" for="f-${key}">${label}</label><select id="f-${key}" data-f="${key}"${ui.f[key] ? ' class="set"' : ""}>${opts.map(([v, n]) => `<option value="${v}"${(ui.f[key] || "") === v ? " selected" : ""}>${n}</option>`).join("")}</select>`;
    return sel("pos", "Position", [["", "All positions"], ["PG", "PG"], ["SG", "SG"], ["G", "G"], ["SF", "SF"], ["PF", "PF"], ["F", "F"], ["C", "C"]])
      + sel("team", "NBA team", [["", "All NBA teams"], ...teams.map((t) => [t, t])])
      + sel("sal", "Salary", [["", "Any salary"], ["a", "Under $5M"], ["b", "$5M to $15M"], ["c", "$15M to $30M"], ["d", "$30M and up"]])
      + sel("con", "Contract", [["", "Any contract"], ["exp", "Expiring"], ["multi", "Signed 2+ more years"], ["rfa", "Heading to RFA"], ...(myTeam() ? [["fit", "Fits my room now"]] : [])])
      + sel("age", "Age", [["", "Any age"], ["y", "24 and under"], ["p", "25 to 29"], ["v", "30 and over"]])
      + sel("inj", "Health", [["", "Any health"], ["out", "Listed Out"]])
      + `<label class="sr" for="msort">Sort</label><select id="msort"${ui.sort !== "rank" ? ' class="set"' : ""}>${[...(SORT_NAMES[ui.sort] ? [[ui.sort, "Sort: " + SORT_NAMES[ui.sort]]] : []), ["rank", "Sort: nine-cat rank"], ["dyn", "Sort: dynasty rank"], ["hc", "Sort: HC Score (value per $)"], ["vorp", "Sort: VORP"], ["vpm", "Sort: V/M (VORP per salary)"], ["sal", "Sort: salary, high to low"], ["cheap", "Sort: salary, low to high"], ["pts", "Sort: points"], ["reb", "Sort: rebounds"], ["ast", "Sort: assists"], ["tpm", "Sort: threes"], ["stl", "Sort: steals"], ["blk", "Sort: blocks"], ["young", "Sort: youngest"], ...(YAHOO.players ? [["yahoo", "Sort: Yahoo rank"]] : [])].map(([k, n]) => `<option value="${k}"${ui.sort === k ? " selected" : ""}>${n}</option>`).join("")}</select>`;
  }
  function marketTools(total) {
    const title = ui.kind === "prospects" ? "Prospect Board" : { fa: "Free agents", own: "On rosters", all: "All players" }[ui.status];
    return `<div class="head"><h1 class="disp">${title}</h1>${total != null ? `<span class="muted">${total} player${total === 1 ? "" : "s"}</span>` : ""}</div>${ui.kind === "prospects" && LIVE ? `<p class="ps" style="margin:0">Board rank and stats from Tankathon's big board, updated ${fmtDate(LIVE.updated)}. Move is spots gained or lost since the preseason board.</p>` : ""}<div class="tools">
      ${ui.kind === "prospects" ? `<div class="seg" role="group" aria-label="Status">${[["fa", "Available"], ["all", "All"]].map(([k, n]) => `<button type="button" data-status="${k}" aria-pressed="${ui.status === k}">${n}</button>`).join("")}</div>` : ""}
      <label class="sr" for="mq">Search</label><input type="search" id="mq" placeholder="Search players or schools" value="${esc(ui.q)}"></div>
      ${ui.kind === "nba" ? filterBox() + `
      <p class="ps" style="margin:0">Rk is nine-category value (z-scores, the way Yahoo ranks), Dyn adds age and upside, HC is that value per $10M of salary. VORP is Basketball-Reference's season total; V/M is that VORP per $1M of salary, times 10.</p>` : ""}`;
  }

  /* ---------- Matchup Center ---------- */
  function viewMatchups(sub) {
    if (LG.phase !== "league") return `<div class="head"><h1 class="disp">Matchups</h1></div><p class="empty">Matchups start once the draft and the Prospect Board auction are done.</p>`;
    if (sub === "playoffs") return `<div class="head"><h1 class="disp">Playoffs</h1></div><div class="cols2">${officeBracket()}${summerCard(standingsNow())}</div>`;
    const cw = curWeek(), w = Math.min(ui.week || defaultWeek(), H.totalWeeks(LG));
    const ms = H.matchups(LG, w, WK, BY);
    const nav = `<button class="btn sm" data-wk="${w - 1}" ${w <= 1 ? "disabled" : ""}>Previous week</button><b>Week ${w}${w > LG.settings.regWeeks ? (w === LG.settings.regWeeks + 1 ? ", semifinals" : ", finals") : ""}</b><span class="muted small">${weekLabel(w)}</span><button class="btn sm" data-wk="${w + 1}" ${w >= H.totalWeeks(LG) ? "disabled" : ""}>Next week</button>`;
    if (!ms.length) return `<div class="head"><h1 class="disp">Matchups</h1><span class="grow"></span>${nav}</div><p class="empty">The final and the third-place game are set once the semifinals are done.</p>`;
    let i = ui.pair != null ? ui.pair : ms.findIndex((x) => isMine(LG.teams[x.a]) || isMine(LG.teams[x.b]));
    if (i < 0) i = 0;
    const m = ms[i], A = LG.teams[m.a], B = LG.teams[m.b], c = m.cmp;
    const scored = w >= LG.settings.startWeek && STATS.wk && STATS.wk[String(w)];
    const status = w < cw ? "Final" : w === cw ? "In progress" : "Not started";
    return `<div class="head"><h1 class="disp">Matchups</h1><span class="grow"></span>${nav}</div>
      <div class="slate">${ms.map((x, k) => gameCard(x, k).replace('class="game', `class="game${k === i ? " on" : ""}`)).join("")}</div>
      <section class="card"><div class="versus"><div><div class="disp nm">${esc(A.name)}</div><div class="ps">${A.owner ? esc(A.owner) : "Bot"}, Game Score ${m.A.t.gmsc.toFixed(1)}</div></div>
        <div class="disp score">${scored ? `${c.w}-${c.l}${c.t ? "-" + c.t : ""}` : "0-0"}<small>${status}</small></div>
        <div class="b"><div class="disp nm">${esc(B.name)}</div><div class="ps">${B.owner ? esc(B.owner) : "Bot"}, Game Score ${m.B.t.gmsc.toFixed(1)}</div></div></div>
        <div class="cats" style="--nc:${c.cats.length}">${c.cats.map((x) => `<div class="cat ${x.out === "w" ? "wa" : x.out === "l" ? "wb" : ""}"><span class="lbl">${x.cat.label}</span><span class="v ${x.out === "w" ? "w" : x.out === "l" ? "l" : ""}">${fmtCat(x.cat, x.a)}</span><span class="v ${x.out === "l" ? "w" : x.out === "w" ? "l" : ""}">${fmtCat(x.cat, x.b)}</span></div>`).join("")}</div>
        ${!scored ? `<p class="empty">${w < LG.settings.startWeek ? "This league starts scoring in week " + LG.settings.startWeek + "." : "No games final yet this week. Scores fill in each morning."}</p>` : ""}</section>
      ${boxTable(A, m.A)}${boxTable(B, m.B)}`;
  }
  const fmtCat = (c, v) => (v == null ? "-" : c.pct ? v.toFixed(3).replace(/^0/, "") : c.dec ? v.toFixed(c.dec) : Math.round(v));
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
    const bids = myBids.waiver;
    if (t && bids == null && LG.phase === "league") fetchMyBids("waiver").then(() => route().tab === "tx" && render());
    const lr = LG.lastWaiverRun;
    return `<div class="head"><h1 class="disp">Transactions</h1></div>
      <div class="cols"><section class="stack">
        ${t && LG.phase === "league" ? `<div class="card"><h3>Your sealed waiver bids</h3><p class="ps" style="margin-top:0">Nobody else sees these. They run ${fmtWhen(LG.due.waiver || H.nextWaiverRun(now()))}; highest bid wins. You have $${t.faab} FAAB.</p>
          ${bids == null ? `<p class="empty">Loading…</p>` : bids.length ? `<ul class="list">${bids.map((b, i) => `<li><span><b>$${b.amt}</b> on ${esc(nameOf(b.add))}${BY[b.add] ? ` (${money(BY[b.add].sal)})` : ""}${b.drop ? `, releasing ${esc(nameOf(b.drop))}` : ""}</span><span class="grow"></span><button class="btn sm" data-unbid="${i}">Withdraw</button></li>`).join("")}</ul>` : `<p class="empty">No bids. Find someone in the Player Market.</p>`}</div>` : ""}
        ${tradesCard(t)}
        <div class="card"><h3>League log</h3><div class="tools" style="margin-bottom:8px">${kinds.map(([k, n]) => `<button class="btn sm${ui.logKind === k ? " go" : ""}" data-logkind="${k}">${n}</button>`).join("")}</div>
          ${items.length ? `<ul class="list">${items.slice(0, 120).map((x) => `<li><time>${fmtDate(x.at)}</time><span>${esc(x.text)}</span></li>`).join("")}</ul>` : `<p class="empty">Nothing here yet.</p>`}</div>
      </section>
      <aside class="stack">${lr ? `<div class="card"><h3>Last waiver run</h3><p class="ps" style="margin-top:0">${fmtWhen(lr.at)}</p><ul class="list">${lr.results.filter((x) => x.ok).map((x) => `<li><span>${esc(LG.teams[x.team].abbr)} signed ${esc(nameOf(x.add))} for $${x.amt}</span></li>`).join("") || `<li>No signings.</li>`}</ul></div>` : ""}
        ${LG.auction && LG.auction.results.length ? `<div class="card"><h3>Prospect Board results</h3><ul class="list">${LG.auction.results.filter((x) => x.won).map((x) => `<li><span>${esc(LG.teams[x.team].abbr)}: ${esc(nameOf(x.pid))}, $${x.amt}</span></li>`).join("")}</ul></div>` : ""}</aside></div>`;
  }
  // Offers you're part of, deals the league is reviewing (with your vote), and the latest results.
  function tradesCard(t, other) {
    const trades = LG.trades.slice().reverse();
    const mineT = t ? trades.filter((x) => x.status === "pending" && (x.from === t.id || x.to === t.id)) : [];
    const review = trades.filter((x) => x.status === "review");
    const done = trades.filter((x) => !["pending", "review"].includes(x.status)).slice(0, 8);
    const sendTo = other && t && other.id !== t.id ? other.id : null;
    const word = { accepted: "went through", declined: "declined", failed: "fell through", withdrawn: "withdrawn", vetoed: "vetoed" };
    return `<div class="card"><h3>Trades</h3>
      ${mineT.length ? `<ul class="list">${mineT.map((x) => tradeLine(x, t)).join("")}</ul>` : `<p class="empty">No open offers.</p>`}
      ${t && LG.phase === "league" ? `<button class="btn go" data-act-trade${sendTo != null ? ` data-with="${sendTo}"` : ""}>${sendTo != null ? `Propose a trade to ${esc(other.abbr)}` : "Propose a trade"}</button>` : !t ? `<p class="ps">Sign in to your team to make offers.</p>` : ""}
      ${review.length ? `<h3 style="margin-top:14px">League review</h3><ul class="list">${review.map((x) => {
        const voters = H.voters(LG, x), need = H.vetoesNeeded(LG, x), n = Object.keys(x.votes || {}).length;
        const can = t && voters.includes(t.id), mineV = can && (x.votes || {})[t.id];
        return `<li style="display:block">${tradeSides(x)}<div class="tools" style="margin-top:6px"><span class="ps">${n} of ${need} veto vote${need === 1 ? "" : "s"}. Goes through ${fmtWhen(x.reviewEnds)} unless vetoed.</span><span class="grow"></span>
          ${can ? `<button class="btn sm${mineV ? " warn" : ""}" data-vote="${x.id}" aria-pressed="${!!mineV}">${mineV ? "Take back my veto vote" : "Vote to veto"}</button>` : ""}${me.commish ? `<button class="btn sm warn" data-veto="${x.id}">Commissioner veto</button>` : ""}</div></li>`; }).join("")}</ul>` : ""}
      ${done.length ? `<h3 style="margin-top:14px">Recent</h3><ul class="list">${done.map((x) => {
        const open = x.status === "accepted" && LG.settings.tradeReview !== "vote" && now() - x.closed < LG.settings.vetoHours * H.HOUR;
        return `<li><span>${esc(LG.teams[x.from].abbr)} and ${esc(LG.teams[x.to].abbr)}: ${word[x.status] || x.status}${x.why ? ` (${esc(x.why)})` : ""}${open ? `. Commissioner can veto until ${fmtWhen(x.closed + LG.settings.vetoHours * H.HOUR)}` : ""}</span><span class="grow"></span>${open && me.commish ? `<button class="btn sm warn" data-veto="${x.id}">Veto</button>` : ""}</li>`; }).join("")}</ul>` : ""}</div>`;
  }
  const tradeSides = (x) => { const nm = (ids, f) => [...ids.map(nameOf), ...(f ? [`$${f} FAAB`] : [])].join(", ") || "nothing";
    return `<div><b>${esc(LG.teams[x.from].name)}</b> sends ${esc(nm(x.give, x.faabGive))}</div><div><b>${esc(LG.teams[x.to].name)}</b> sends ${esc(nm(x.get, x.faabGet))}</div>`; };
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
      dlg(`<h3 class="disp">${esc(q.n)}</h3><p class="muted" style="margin:0">${esc(q.posFull || q.pos)}, ${esc(q.school)}${q.age ? `, age ${q.age.toFixed(1)}` : ""}. Big board ${q.rank} for the 2027 NBA draft ${moveTagP(q)}${q.pre ? ` <span class="ps">(preseason ${q.pre})</span>` : ""}.</p>
        ${q.stats && Object.keys(q.stats).length ? `<div class="table-wrap" style="margin-top:10px"><table class="t"><thead><tr>${PROS_STATS.map(([, l]) => `<th class="r">${l}</th>`).join("")}</tr></thead><tbody><tr>${PROS_STATS.map(([k]) => `<td class="r num">${pstat(q, k)}</td>`).join("")}</tr></tbody></table></div><p class="ps">Per game, latest line on Tankathon's big board.</p>` : ""}
        <dl class="kv" style="margin:12px 0"><dt>Rights</dt><dd>${owner ? esc(owner.name) : "Available"}</dd><dt>Cost</dt><dd>Nothing until he signs his NBA deal</dd></dl>
        <div class="acts">${t && !owner && LG.phase === "league" ? `<button class="btn go" type="button" data-cbid="${id}">Bid</button>` : ""}<button class="btn" type="button" data-close>Close</button></div>`);
      wireCard(); return;
    }
    const p = BY[id];
    if (!p) return;
    const inj = INJ[id];
    const yr = (i) => (i === 0 ? p.sal : p.future[i - 1]);
    const years = [0, 1, 2, 3, 4, 5].filter((i) => yr(i) || p.fa.year === 2026 + i);
    const line = (l, label) => l ? `<tr><td>${label}</td><td class="r num">${l[C.gp]}</td><td class="r num">${l[C.min].toFixed(1)}</td><td class="r num">${l[C.pts].toFixed(1)}</td><td class="r num">${l[C.reb].toFixed(1)}</td><td class="r num">${l[C.ast].toFixed(1)}</td><td class="r num">${l[C.tpm].toFixed(1)}</td><td class="r num">${l[C.stl].toFixed(1)}</td><td class="r num">${l[C.blk].toFixed(1)}</td><td class="r num">${pct(l[C.fgm], l[C.fga])}</td><td class="r num">${pct(l[C.ftm], l[C.fta])}</td><td class="r num">${l[C.tov].toFixed(1)}</td></tr>` : "";
    const weeks = Object.entries(STATS.wk || {}).map(([w, x]) => [+w, x[id]]).filter((x) => x[1]).sort((a, b) => b[0] - a[0]);
    const zc = p.zc ? CATS.map((c) => { const z = Math.max(-3, Math.min(3, p.zc[c.k])); return `<div style="display:grid;grid-template-columns:38px 1fr 40px;gap:8px;align-items:center;font-size:12px"><span class="lbl">${c.label}</span>
      <span style="position:relative;height:10px;background:var(--court);border-radius:3px"><span style="position:absolute;top:0;bottom:0;left:50%;width:1px;background:var(--line-2)"></span><span style="position:absolute;top:0;bottom:0;${z >= 0 ? `left:50%;width:${(z / 3) * 50}%;background:var(--lime)` : `right:50%;width:${(-z / 3) * 50}%;background:var(--red)`};border-radius:2px"></span></span><span class="num r">${p.zc[c.k] >= 0 ? "+" : ""}${p.zc[c.k].toFixed(1)}</span></div>`; }).join("") : "";
    const yr2 = YAHOO.players && YAHOO.players[id];
    let act = "";
    if (t && LG.phase === "league") {
      if (own == null) act = `<button class="btn go" type="button" data-cbid="${id}">Bid</button>`;
      else if (own !== t.id) act = `<button class="btn" type="button" data-ctrade="${own}" data-pid="${id}">Trade for him</button>`;
    } else if (t && own == null && (LG.phase === "lobby" || LG.phase === "nba")) {
      const c = LG.phase === "nba" ? H.onClock(LG, now()) : null;
      const chk = H.check(LG, t, p, H.context(LG, POOL), { reserve: true });
      if (c && c.team === t.id && !LG.nba.paused) act = chk.ok ? `<button class="btn go" type="button" data-cpick="${id}">Draft ${esc(last(p.n))}</button>` : `<span class="why">${esc(chk.why)}</span>`;
      act += t.queue.includes(id) ? "" : ` <button class="btn" type="button" data-cqueue="${id}">Add to my queue</button>`;
    }
    dlg(`<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><h3 class="disp" style="margin:0">${esc(p.n)}</h3>${injTag(id)}</div>
      <p class="muted" style="margin:2px 0 0">${esc(p.t)}, ${H.positions(p).join("/")}, age ${p.age}, ${p.yos} NBA season${p.yos === 1 ? "" : "s"}, ${esc(p.ctype || "")} contract${owner ? `. On ${esc(owner.name)}` : LG ? ". Free agent" : ""}${inj ? `. ${esc(inj[0])}: ${esc(inj[1])}` : ""}</p>
      <div class="tools" style="margin:12px 0">${[["Nine-cat rank", p.rank], ["Dynasty rank", p.dynRank], ["HC Score", p.hc.toFixed(1)], ...(p.bbv != null ? [["VORP", p.bbv.toFixed(1)], ["V/M", p.vpm.toFixed(1)]] : []), ...(yr2 ? [["Yahoo rank", yr2.ar || yr2.or]] : [])].map(([k, v]) => `<div class="card" style="padding:8px 12px"><div class="lbl">${k}</div><div class="disp" style="font-size:26px">${v}</div></div>`).join("")}</div>
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
    $$("[data-cpick]", D).forEach((b) => (b.onclick = () => { D.close(); const id = b.dataset.cpick; mutate(`Picked ${nameOf(id)}`, (L) => H.draftPick(L, POOL, me.team, id, now(), false)).then((ok) => ok && toast(`You drafted ${nameOf(id)}.`)); }));
    $$("[data-cqueue]", D).forEach((b) => (b.onclick = () => { D.close(); const id = b.dataset.cqueue; mutate("Queue", (L) => { const q = L.teams[me.team].queue; if (!q.includes(id)) q.push(id); return { ok: true }; }, { quiet: true }).then((ok) => ok && toast("Added to your queue.")); }));
  }
  D.addEventListener("close", () => (D.style.maxWidth = ""));
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-player]"); if (b && !D.open) { e.preventDefault(); playerCard(b.dataset.player); } });

  /* ---------- Draft Room ---------- */
  function draftSubs() {
    const phase = LG.phase;
    return phase === "lobby" ? [["players", "Players"], ["board", "Board"], ["queue", "My queue"], ["details", "Draft details"]]
      : phase === "nba" ? [["players", "Players"], ["board", "Board"], ["picks", "Picks"], ["mine", "My team"], ["queue", "My queue"], ["details", "Draft details"]]
        : [["prospects", LG.pauction && phase === "prospects" ? "Prospect auction" : "Prospect Board"], ["board", "Draft results"], ["picks", "Every pick"], ["mine", "My team"], ["details", "Draft details"]];
  }
  function viewDraft(arg) {
    const phase = LG.phase;
    ui.sub = arg;
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
        : phase === "prospects" && LG.pauction ? auctionBand()
        : `<div class="clock"><div class="wrap"><div><div class="disp on">${phase === "prospects" ? "Prospect Board auction" : "Draft results"}</div><div class="ps">${phase === "prospects" ? `Sealed bids from your season FAAB. Closes ${fmtWhen(LG.due.auction)}.` : `Completed ${fmtDate(LG.nba.done || now())}.`}</div></div></div></div>`;
    const body = { players: draftPlayers, board: draftBoard, picks: draftPicks, mine: draftMine, queue: draftQueue, prospects: draftProspects, details: () => `<div style="overflow:auto;max-width:760px">${draftInfoCard()}</div>` }[ui.sub]();
    return `${clock}<div class="wrap room-shell" id="room"><div class="pane">${body}</div></div>`;
  }
  let ghost = null;
  function draftPlayers() {
    const ctx = H.context(LG, POOL);
    const t = myTeam(), c = H.onClock(LG, now());
    const myTurn = c && t && c.team === t.id;
    const q = ui.q.trim().toLowerCase();
    let rows = ctx.available.filter((p) => !p.gone && (!q || p.n.toLowerCase().includes(q)) && passFilters(p));
    sortRows(rows);
    const checked = rows.map((p) => ({ p, c: t ? H.check(LG, t, p, ctx, { reserve: true }) : { ok: true } }));
    const shown = (ui.fit ? checked.filter((x) => x.c.ok) : checked).slice(0, 180);
    return `${t ? `<div id="mycap">${capLine(t, ctx)}</div>` : ""}
      <div class="tools"><label class="sr" for="dq">Search</label><input type="search" id="dq" placeholder="Search players or teams" value="${esc(ui.q)}">
        ${t ? `<label class="small muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="dfit"${ui.fit ? " checked" : ""}> Only players I can fit</label>` : ""}</div>${filterBox()}
      <div class="table-wrap" id="pool"><table class="t dense"><thead><tr>${sortTh("rank", "Rk", "r", "Nine-category rank")}${sortTh("dyn", "Dyn", "r", "Dynasty rank")}${sortTh("name", "Player", "")}${sortTh("team", "Team", "")}${sortTh("pos", "Pos", "hide-s")}${sortTh("age", "Age")}${sortTh("sal", "Salary")}${sortTh("yrs", "Yrs", "r hide-s")}${sortTh("gw", "G", "r hide-s", "NBA games this fantasy week")}${sortTh("hc", "HC", "r", "HC Score: value over replacement per $10M")}${sortTh("vorp", "VORP", "r hide-s", "Value over replacement player, season to date")}${lineHeadS()}<th></th></tr></thead><tbody>
        ${shown.map(({ p, c: k }) => `<tr data-pid="${p.id}" class="${k.ok ? "" : "dim"}"${k.ok ? "" : ` title="${esc(k.why)}"`}><td class="r num">${p.rank}</td><td class="r num ps">${p.dynRank}</td><td class="nm">${pl(p.id)}${p.deal ? " " + typeTag(p) : ""}</td><td class="ps">${p.t}</td><td class="ps hide-s">${H.positions(p).join("/")}</td><td class="r num">${p.age}</td>
          <td class="r"><span class="sal num">${money(p.sal)}</span></td><td class="r num ps hide-s">${p.future.length ? p.future.length + 1 : "Exp"}</td>${gCell(p).replace('class="r num', 'class="r num hide-s')}${hcCell(p)}<td class="r num hide-s">${p.bbv == null ? "-" : p.bbv.toFixed(1)}</td>${lineCells(p)}
          <td class="r" style="white-space:nowrap">${myTurn && k.ok && LG.phase === "nba" ? `<button class="btn sm go" data-pick="${p.id}">Draft</button> ` : ""}${t ? (t.queue.includes(p.id) ? `<button class="btn sm" data-unqueue="${p.id}">Queued</button>` : `<button class="btn sm" data-queue="${p.id}">Queue</button>`) : ""}</td></tr>`).join("") || `<tr><td colspan="20" class="empty">No one matches.</td></tr>`}
        </tbody></table></div>`;
  }
  // One line of cap math above the player list; the full cap bar lives on the My team tab.
  function capLine(t, ctx) {
    const open = LG.settings.roster - H.active(t).length;
    const others = LG.phase === "nba" ? LG.teams.filter((x) => x.id !== t.id).reduce((a, x) => a + Math.max(0, LG.settings.roster - H.active(x).length), 0) : 0;
    const twLeft = (LG.settings.twoWayMax == null ? 3 : LG.settings.twoWayMax) - H.twoWaysOn(t, BY);
    const hold = open > 0 ? H.reserve(open, ctx.available, null, others, twLeft) : 0;
    const pay = H.payroll(t, BY), room = H.ceilingOf(LG, t) - pay - hold;
    return `<div class="capline"><span><b class="num">${money(pay)}</b> on the books</span><span><b class="num">${H.active(t).length}</b> of ${LG.settings.roster} signed</span>
      <span><b class="num ${room >= 0 ? "ok" : "bad"}">${money(room)}</b> usable room${hold ? ` <span class="ps">after ${money(hold)} held for ${open} spot${open === 1 ? "" : "s"}</span>` : ""}</span>
      <span class="ps">${esc(H.tierOf(LG, t).label)} line ${money(H.ceilingOf(LG, t))}, two-ways ${H.twoWaysOn(t, BY)} of ${LG.settings.twoWayMax == null ? 3 : LG.settings.twoWayMax}</span><span class="grow"></span><a class="btn sm" href="#draft/mine">My team and cap bar</a></div>`;
  }
  function recentPicksList(n) {
    const picks = LG.nba.picks.slice(-n).reverse();
    return `<div class="card" style="flex:1;min-height:0;display:flex;flex-direction:column"><h3>Latest picks</h3>${picks.length ? `<ol class="picks">${picks.map((pk, i) => { const t = LG.teams[pk.team]; return `<li class="${isMine(t) ? "me" : ""}"><span class="no">${LG.nba.picks.length - i}</span><span>${pk.pid ? pl(pk.pid) : "<b>Passed</b>"}<br><span class="ps">${esc(t.abbr)}${pk.auto ? ", auto" : ""}</span></span><span class="sal num">${pk.pid ? money(BY[pk.pid].sal) : ""}</span></li>`; }).join("")}</ol>` : `<p class="empty">No picks yet.</p>`}</div>`;
  }
  function draftBoard() {
    const n = LG.teams.length, rounds = LG.settings.roster;
    const order = LG.nba.round1;
    let cells = `<div></div>${order.map((ti) => { const t = LG.teams[ti], room = H.ceilingOf(LG, t) - H.payroll(t, BY), left = LG.settings.roster - H.active(t).length;
      return `<div class="h${isMine(t) ? " me" : ""}" title="${esc(t.name)}${t.owner ? ", " + esc(t.owner) : ", bot"}"><b>${esc(t.abbr)}</b><small class="num ${room < 0 ? "bad" : ""}">${money(room)}</small><small>${left} open</small></div>`; }).join("")}`;
    for (let r = 0; r < rounds; r++) {
      cells += `<div class="rn">${r + 1}</div>`;
      for (let col = 0; col < n; col++) {
        const k = r * n + (r % 2 ? n - 1 - col : col);
        const pk = LG.nba.picks[k], ti = order[col], t = LG.teams[ti];
        const cls = ["cell", pk ? "f" : "", isMine(t) ? "me" : "", LG.phase === "nba" && k === LG.nba.picks.length ? "now" : "", pk && !pk.pid ? "skip" : ""].join(" ");
        const p = pk && pk.pid && BY[pk.pid];
        cells += `<div class="${cls}"${p ? ` data-player="${p.id}" role="button" tabindex="0" title="${esc(p.n)}, ${money(p.sal)}${pk.auto ? ", autopick" : ""}"` : ""}>${pk ? (p ? `<b>${esc(last(p.n))}</b><small>${H.positions(p).join("/")} ${esc(p.t)}</small><small class="sal num">${money(p.sal)}${pk.auto ? ' <i title="Autopick">A</i>' : ""}</small>` : `<b>Passed</b>`) : `<small>${r + 1}.${col + 1}</small><small class="ps">#${k + 1}</small>`}</div>`;
      }
    }
    const nowPick = LG.phase === "nba" ? H.onClock(LG, now()) : null;
    return `<div class="tools"><span class="ps">Each column is a team in first-round order, with its room under the line and open spots. ${nowPick ? `Pick ${nowPick.pick} of ${nowPick.total} is on the clock.` : ""} Click a pick for the player's card.</span></div><div class="board"><div class="bgrid" style="--n:${n};grid-template-columns:30px repeat(${n},minmax(0,1fr));grid-template-rows:auto repeat(${rounds},minmax(52px,1fr))">${cells}</div></div>`;
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
  // ---------- the live Prospect Board auction ----------
  const A_ = () => LG.pauction;
  const fmtLeft = (ms) => { const left = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), x = left % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
  function auctionState() {
    const A = A_(), t = now();
    if (A.started == null) return { kind: "wait", text: "Waiting for the commissioner to start the auction" };
    if (A.paused) return { kind: "paused", text: "Paused by the commissioner" };
    if (t < A.started) return { kind: "soon", text: "The auction starts soon", end: A.started };
    if (A.lot) return { kind: "lot", end: A.lot.ends };
    const nom = H.auctionNominator(LG);
    if (nom == null) return { kind: "done", text: "Wrapping up" };
    return { kind: "nom", nom, end: LG.teams[nom].owner ? A.nomEnds : null, text: isMine(LG.teams[nom]) ? "Your nomination" : `${LG.teams[nom].name} is nominating` };
  }
  function auctionBand() {
    const A = A_(), st = auctionState(), lot = A.lot, p = lot && PBY[lot.pid];
    const head = st.kind === "lot" ? `${esc(p ? p.n : lot.pid)}: $${lot.bid}, ${isMine(LG.teams[lot.team]) ? "you" : esc(LG.teams[lot.team].abbr)}` : st.text;
    return `<div class="clock"><div class="wrap"><div><div class="disp on${st.kind === "nom" && isMine(LG.teams[st.nom]) ? " me" : ""}">${head}</div>
      <div class="ps">Live Prospect Board auction, ${A.results.length} sold. ${LG.settings.draftMode === "slow" ? `${LG.settings.slowAuctionHours} hours` : `${LG.settings.auctionClock} seconds`} on the clock; every bid resets it.</div></div>
      <span class="grow"></span>${st.end ? `<span class="disp timer" data-end="${st.end}"></span>` : ""}</div></div>`;
  }
  function auctionRoom() {
    const A = A_(), st = auctionState(), t = myTeam(), lot = A.lot;
    const left = H.auctionLeft(LG, PROS);
    const canBidMe = t && t.prospects.length < LG.settings.prospects && t.faab >= LG.settings.minBid;
    const myNom = st.kind === "nom" && t && st.nom === t.id;
    let stage = "";
    if (lot) {
      const p = PBY[lot.pid], high = LG.teams[lot.team], mine = t && lot.team === t.id;
      const quick = [1, 2, 5, 10].map((d) => lot.bid + d).filter((v) => t && v <= t.faab);
      stage = `<section class="card lot"><div class="lot-p"><span class="ps">Board ${p ? p.rank : ""} ${p ? moveTagP(p) : ""}${lot.auto ? ", nominated automatically" : `, nominated by ${esc(LG.teams[lot.nominator].abbr)}`}</span>
          <b class="disp">${esc(p ? p.n : lot.pid)}</b><span class="muted">${p ? `${esc(p.posFull || p.pos)}, ${esc(p.school)}${p.age ? `, ${p.age.toFixed(1)}` : ""}` : ""}</span>
          ${p && p.stats && Object.keys(p.stats).length ? `<span class="ps">${PROS_STATS.map(([k, l]) => `${l} ${pstat(p, k)}`).join(", ")}</span>` : ""}</div>
        <div class="lot-b"><span class="lbl">High bid</span><b class="disp num">$${lot.bid}</b><span class="${mine ? "ok" : "muted"}">${mine ? "You" : esc(high.name)}</span></div>
        <div class="lot-t"><span class="disp timer" data-end="${lot.ends}"></span></div>
        <div class="lot-a">${!t ? `<p class="ps">Sign in to your team to bid.</p>` : mine ? `<p class="ok"><b>You're the high bidder.</b></p>` : !canBidMe ? `<p class="ps">${t.prospects.length >= LG.settings.prospects ? "Your prospect spots are full." : "You're out of FAAB."}</p>`
          : `<div class="tools">${quick.map((v) => `<button class="btn go" data-abid-q="${v}">$${v}</button>`).join("")}<form class="tools" id="abidform"><label class="sr" for="abamt">Your bid</label><input type="number" id="abamt" min="${lot.bid + 1}" max="${t.faab}" value="${Math.min(t.faab, Math.max(lot.bid + 1, ui.abamt || 0))}" style="width:90px"><button class="btn" type="submit">Bid</button></form></div><p class="ps" style="margin:4px 0 0">You have $${t.faab}. Bids are final.</p>`}</div></section>`;
    } else {
      stage = `<section class="card lot"><div class="lot-p"><b class="disp">${esc(st.text)}</b>${myNom ? `<span class="muted">Pick anyone below and set the opening bid. If the clock runs out, the top prospect left goes up at $${LG.settings.minBid}.</span>` : st.kind === "wait" ? `<span class="muted">The commissioner starts it from Commissioner, Tools.</span>` : ""}</div>
        ${st.end ? `<div class="lot-t"><span class="disp timer" data-end="${st.end}"></span></div>` : ""}
        ${myNom ? `<div class="lot-a"><div class="tools"><label for="nomamt" class="ps">Opening bid $</label><input type="number" id="nomamt" min="${LG.settings.minBid}" max="${t.faab}" value="${Math.min(t.faab, Math.max(LG.settings.minBid, ui.nomamt || 0))}" style="width:80px"><button class="btn sm" data-anompass>I'm done nominating</button></div></div>` : ""}</section>`;
    }
    const order = A.order.map((id) => LG.teams[id]);
    const nomId = st.kind === "nom" ? st.nom : null;
    const teams = `<section class="card"><h3>Budgets</h3><table class="t dense"><thead><tr><th>Team</th><th class="r">FAAB</th><th class="r">Spots</th></tr></thead><tbody>${order.map((x) => `<tr class="${isMine(x) ? "me" : ""}${x.prospects.length >= LG.settings.prospects ? " dim" : ""}"><td>${x.id === nomId ? "&#9654; " : ""}${esc(x.abbr)} <span class="ps">${esc(x.owner || "bot")}${A.passed.includes(x.id) ? ", done" : ""}</span></td><td class="r num">$${x.faab}</td><td class="r num">${LG.settings.prospects - x.prospects.length}</td></tr>`).join("")}</tbody></table></section>`;
    const sold = A.results.slice().reverse();
    const results = `<section class="card"><h3>Sold</h3>${sold.length ? `<ul class="list">${sold.map((r) => `<li><span><b>$${r.amt}</b> ${esc(nameOf(r.pid))}</span><span class="grow"></span><span class="ps">${esc(LG.teams[r.team].abbr)}</span></li>`).join("")}</ul>` : `<p class="empty">Nothing yet.</p>`}</section>`;
    const board = `<div class="table-wrap"><table class="t dense"><thead><tr><th class="r">Board</th><th class="r">Move</th><th>Prospect</th><th>School</th><th class="r hide-s">Age</th>${PROS_STATS.map(([, l], i) => `<th class="r${i > 2 ? " hide-s" : ""}">${l}</th>`).join("")}<th></th></tr></thead><tbody>
      ${left.slice(0, 120).map((p) => `<tr class="${lot && lot.pid === p.id ? "me" : ""}"><td class="r num">${p.rank}</td><td class="r">${moveTagP(p)}</td><td class="nm">${pl(p.id)} <span class="ps">${esc(p.posFull || p.pos)}</span></td><td class="ps">${esc(p.school)}</td><td class="r num hide-s">${ageOf(p)}</td>${PROS_STATS.map(([k], i) => `<td class="r num${i > 2 ? " hide-s" : ""}">${pstat(p, k)}</td>`).join("")}<td class="r">${myNom ? `<button class="btn sm go" data-nominate="${p.id}">Nominate</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
    return `<div class="auction">${stage}<div class="auction-body"><div class="auction-main">${board}</div><aside class="stack">${teams}${results}</aside></div></div>`;
  }
  function draftProspects() {
    if (LG.phase === "prospects" && LG.pauction) return auctionRoom();
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
      ${PROS.slice(0, 80).map((p) => `<tr><td class="r num ps">${p.off ? "-" : p.rank}</td><td><div class="pn">${esc(p.n)} ${moveTagP(p)}</div><div class="ps">${esc(p.posFull || p.pos)}</div></td><td>${esc(p.school)}</td><td class="r num">${ageOf(p)}</td>
        <td class="r">${t ? `<input type="number" min="0" max="${t.faab}" step="1" data-abid="${p.id}" value="${bidOf(p.id)}" style="width:86px;text-align:right" aria-label="Bid on ${esc(p.n)}">` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  }

  /* ---------- Commissioner ---------- */
  function viewCommish(sub) {
    if (!me.commish) {
      return `<div class="head"><h1 class="disp">Commissioner</h1></div><form class="card form" id="cform" style="max-width:420px"><p class="muted small" style="margin:0">Enter the commissioner PIN to manage the league.</p>
        <div class="field"><label for="cpin">Commissioner PIN</label><input type="password" id="cpin" name="pin" inputmode="numeric" required></div><div><button class="btn go" type="submit">Unlock tools</button></div></form>`;
    }
    const s = LG.settings, p = LG.phase;
    const link = location.origin + location.pathname + "?l=" + LID;
    const tiersEditable = s.tiers.map((t, k) => `<div class="field"><label for="tier${k}">${esc(t.label)} add-on ($)</label><input type="number" id="tier${k}" name="tier${k}" min="0" value="${t.add}" ${k === 0 ? "disabled" : ""}></div>`).join("");
    const head = (t) => `<div class="head"><h1 class="disp">${t}</h1><span class="grow"></span><button class="btn" data-act="copy" data-text="${esc(link)}">Copy invite link</button></div>`;
    const sec = {};
    sec.settings = () => `${head("League settings")}<div class="cols2">
        <form class="card form" id="settings"><h3>Money, rosters and the season</h3>
          <div class="field"><label for="sname">League name</label><input type="text" id="sname" name="name" maxlength="40" value="${esc(LG.name)}"></div>
          <div class="row2"><div class="field"><label for="sbuy">Buy-in ($)</label><input type="number" id="sbuy" name="buyIn" min="0" value="${s.buyIn}"></div>
          <div class="field"><label for="sfaab">Season FAAB ($)</label><input type="number" id="sfaab" name="faab" min="1" value="${s.faab}" ${p === "lobby" ? "" : "disabled"}></div></div>
          <div class="field"><label for="sls">The line, in real NBA caps</label><select id="sls" name="lineScale" ${p === "lobby" ? "" : "disabled"}>${[1, 1.25, 1.5, 1.75, 2].map((x) => `<option value="${x}"${(s.lineScale || 1) === x ? " selected" : ""}>${x}x: ${money(H.defaultTiers(NBA.cba, x)[0].line)} cap line</option>`).join("")}</select></div>
          <div class="row2">${tiersEditable}</div>
          <div class="row2"><div class="field"><label for="sdead">Tier upgrades close after week</label><input type="number" id="sdead" name="tierDeadline" min="1" max="${s.regWeeks}" value="${s.tierDeadline}"></div>
          <div class="field"><label for="sstart">Scoring starts in week</label><input type="number" id="sstart" name="startWeek" min="1" max="${s.regWeeks}" value="${s.startWeek}" ${p === "lobby" ? "" : "disabled"}></div></div>
          <div class="row2"><div class="field"><label for="stdl">Trade deadline: end of week</label><input type="number" id="stdl" name="tradeDeadline" min="1" max="${s.regWeeks}" value="${s.tradeDeadline}"></div>
          <div class="field"><label for="sirs">IR spots</label><input type="number" id="sirs" name="irSlots" min="0" max="4" value="${s.irSlots}"></div></div>
          <div class="row2"><div class="field"><label for="spay">Payout split, %</label><input type="text" id="spay" name="payout" value="${s.payout.join(" / ")}"></div>
          <div class="field"><label for="sveto">Commissioner veto window (hours)</label><input type="number" id="sveto" name="vetoHours" min="0" max="168" value="${s.vetoHours}"></div></div>
          <div class="row2"><div class="field"><label for="smin">Summer budget, best team ($)</label><input type="number" id="smin" name="summerMin" min="1" value="${s.summerMin}"></div>
          <div class="field"><label for="smax">Summer budget, worst team ($)</label><input type="number" id="smax" name="summerMax" min="1" value="${s.summerMax}"></div></div>
          <div class="field"><label for="scomp">Bonus for letting an expiring player walk ($)</label><input type="number" id="scomp" name="compDollars" min="0" value="${s.compDollars}"></div>
          <div class="row2"><div class="field"><label for="srev">Trade review</label><select id="srev" name="tradeReview">${[["vote", "League vote"], ["commish", "Commissioner veto"], ["none", "No review"]].map(([k, n]) => `<option value="${k}"${(s.tradeReview || "commish") === k ? " selected" : ""}>${n}</option>`).join("")}</select></div>
          <div class="field"><label for="srevh">League review window (hours)</label><input type="number" id="srevh" name="reviewHours" min="1" max="168" value="${s.reviewHours || 48}"></div></div>
          <div class="row2"><div class="field"><label for="sshare">Vetoes needed, share of other managers (%)</label><input type="number" id="sshare" name="vetoShare" min="1" max="100" value="${Math.round((s.vetoShare || 0.5) * 100)}"></div>
          <div class="field"><label for="sgrace">Time to get back under the line (hours, at least)</label><input type="number" id="sgrace" name="lineGraceHours" min="0" max="336" value="${s.lineGraceHours || 72}"></div></div>
          <div class="field"><label for="svorp">VORP as a scoring category</label><select id="svorp" name="vorpCat"><option value="1"${s.vorpCat !== false ? " selected" : ""}>Yes, ten categories</option><option value="0"${s.vorpCat === false ? " selected" : ""}>No, the classic nine</option></select></div>
          <div class="field"><label for="sirr">Who can go on IR</label><select id="sirr" name="irRule"><option value="out"${s.irRule === "out" ? " selected" : ""}>Only players ESPN lists as Out</option><option value="any"${s.irRule === "any" ? " selected" : ""}>Anyone (commissioner polices it)</option></select></div>
          <p class="ps" style="margin:0">The real NBA deadline is Feb. 11, 2027; week ${H.weekOf(opener, new Date("2027-02-21T12:00:00"))} ends Feb. 21, ten days later. Week 1 backfills every week already played from real box scores, which is handy for testing. A real league should start the week after the draft.</p>
          <div><button class="btn go" type="submit">Save settings</button></div></form>
        <section class="card"><h3>What each setting does</h3><div style="max-height:70vh;overflow:auto">${rulesList(LG)}</div></section></div>`;
    sec.draft = () => `${head("Draft")}<div class="cols2">
        <form class="card form" id="draftset"><h3>Draft</h3>
          <div class="field"><span class="lbl">Type</span><div class="seg" role="group">${[["live", "Live"], ["slow", "Slow"]].map(([k, n]) => `<button type="button" data-dmode="${k}" aria-pressed="${s.draftMode === k}">${n}</button>`).join("")}</div></div>
          <div class="row2"><div class="field"><label for="dclock">Live clock (seconds)</label><input type="number" id="dclock" name="clock" min="15" max="600" value="${s.clock}"></div>
          <div class="field"><label for="dslow">Slow clock (hours)</label><input type="number" id="dslow" name="slowHours" min="1" max="72" value="${s.slowHours}"></div></div>
          <div class="row2"><div class="field"><label for="dbot">Bot pick delay, live (seconds)</label><input type="number" id="dbot" name="botDelay" min="0" max="30" step="0.5" value="${s.botDelay / 1000}"></div>
          <div class="field"><label for="dauc">Sealed auction length (hours)</label><input type="number" id="dauc" name="auctionHours" min="1" max="168" value="${s.auctionHours}"></div></div>
          <div class="field"><label for="dpa">After the draft: Prospect Board</label><select id="dpa" name="prospectAuction">${[["live", "Live auction draft (nominate and bid)"], ["sealed", "Sealed bids"], ["skip", "Skip it: all prospects to waivers"]].map(([k, n]) => `<option value="${k}"${(s.prospectAuction || "sealed") === k ? " selected" : ""}>${n}</option>`).join("")}</select></div>
          <div class="row2"><div class="field"><label for="dacl">Live auction bid clock (seconds)</label><input type="number" id="dacl" name="auctionClock" min="10" max="300" value="${s.auctionClock || 30}"></div>
          <div class="field"><label for="dash">Slow league bid clock (hours)</label><input type="number" id="dash" name="slowAuctionHours" min="1" max="48" value="${s.slowAuctionHours || 4}"></div></div>
          <div class="tools"><button class="btn" type="submit">Save draft settings</button>
            ${p === "lobby" ? `<button class="btn" type="button" data-shuffle>Shuffle the order</button><button class="btn go" type="button" data-start>Start the draft</button>` : ""}
            ${p === "nba" ? `<button class="btn" type="button" data-pause="${LG.nba.paused ? 0 : 1}">${LG.nba.paused ? "Resume" : "Pause"}</button><button class="btn warn" type="button" data-undo>Undo last pick</button>` : ""}
            ${p === "prospects" ? `<button class="btn warn" type="button" data-undo>Undo last pick</button><button class="btn go" type="button" data-closeauction>Close the auction now</button>` : ""}</div>
          <div><div class="lbl" style="margin:6px 0">First-round order</div><ol style="margin:0;padding-left:22px">${LG.nba.round1.map((id, i) => `<li>${esc(LG.teams[id].name)}${p === "lobby" && i ? ` <button class="btn sm" type="button" data-ordup="${i}">Up</button>` : ""}</li>`).join("")}</ol></div></form>
        ${draftInfoCard()}</div>`;
    sec.teams = () => `${head("Teams and managers")}
      <section class="card"><h3>Teams and managers</h3><div class="table-wrap" style="border:0"><table class="t"><thead><tr><th>Team</th><th>Manager</th><th>Tier</th><th class="r">FAAB</th><th></th></tr></thead><tbody>
        ${LG.teams.map((t) => `<tr><td><input type="text" data-tname="${t.id}" value="${esc(t.name)}" maxlength="28" aria-label="Team name"></td><td>${t.owner ? esc(t.owner) : `<span class="muted">Open (bot)</span>`}</td>
          <td><select data-ttier="${t.id}" aria-label="Tier">${s.tiers.map((x, k) => `<option value="${k}"${(t.tier || 0) === k ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select></td>
          <td class="r"><input type="number" data-tfaab="${t.id}" value="${t.faab}" min="0" style="width:80px;text-align:right" aria-label="FAAB"></td>
          <td class="r" style="white-space:nowrap"><button class="btn sm" data-tsave="${t.id}">Save</button> ${t.owner ? `<button class="btn sm warn" data-unclaim="${t.id}">Open team</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
        <p class="ps" style="margin-bottom:0">Opening a team removes its manager and PIN so someone else can claim it; the roster stays. The tier menu is for corrections; managers can only move themselves up.</p></section>`;
    sec.contracts = () => `${head("Contracts")}${contractStatus()}
      <section class="card"><h3>Override a contract for this league</h3>
        <p class="ps" style="margin-top:0">Contracts update every day from Basketball-Reference, and two-way and 10-day players come in at their real salaries, so this list should stay short. Use it for a signing neither feed has yet: add a contract and he joins this league's free agent pool at that salary.</p>
        ${missingContracts()}
        ${Object.keys(LG.contracts || {}).length ? `<h3 style="margin-top:12px">Added by you</h3><ul class="list">${Object.entries(LG.contracts).map(([id, c]) => `<li><span>${esc(c.n)}, ${esc(c.t)}: ${c.sal.filter(Boolean).map(money).join(", ")}</span><span class="grow"></span><button class="btn sm" data-uncontract="${esc(id)}">Remove</button></li>`).join("")}</ul>` : ""}</section>`;
    sec.tools = () => `${head("Tools")}<div class="cols2">
      <section class="card"><h3>Invite managers</h3><p class="ps" style="margin-top:0">Send this link. Each manager picks an open team and sets a PIN; ${LG.teams.filter((t) => !t.owner).length} of ${LG.teams.length} teams are still open.</p><div class="tools"><input type="text" readonly value="${esc(link)}" aria-label="Invite link"><button class="btn go" data-act="copy" data-text="${esc(link)}">Copy</button></div></section>
      ${p === "league" ? `<section class="card"><h3>Waivers</h3><p class="ps" style="margin-top:0">Next automatic run: ${fmtWhen(LG.due.waiver || H.nextWaiverRun(now()))}. Running now opens every sealed bid; signings count next week.</p><button class="btn" data-runwaivers>Run waivers now</button></section>` : ""}
      ${p === "prospects" && LG.pauction ? `<section class="card"><h3>Live Prospect Board auction</h3><p class="ps" style="margin-top:0">${LG.pauction.started == null ? "Ready when everyone is." : LG.pauction.paused ? "Paused." : "Running."} ${LG.pauction.results.length} sold so far.</p>
        <div class="tools">${LG.pauction.started == null ? `<button class="btn go" data-astart>Start the auction</button>` : `<button class="btn" data-apause="${LG.pauction.paused ? 0 : 1}">${LG.pauction.paused ? "Resume" : "Pause"}</button>`}<a class="btn" href="#draft/prospects">Go to the auction</a><button class="btn warn" type="button" data-skipauction>End it: the rest go to waivers</button></div></section>` : ""}
      ${p === "league" && !(LG.auction && LG.auction.results && LG.auction.results.length) && !LG.teams.some((x) => x.prospects.length) ? `<section class="card"><h3>Prospect Board auction</h3><p class="ps" style="margin-top:0">No prospects have been signed yet. Hold a live auction draft now: teams nominate in first-round order and bid from season FAAB. You start it when everyone's ready, and lineups and waivers keep running.</p><button class="btn go" data-areopen>Set up a live auction</button></section>` : ""}
      ${p === "prospects" && !LG.pauction ? `<section class="card"><h3>Prospect Board auction</h3><p class="ps" style="margin-top:0">Closes on its own ${fmtWhen(LG.due.auction)}.</p><button class="btn go" type="button" data-closeauction>Close the auction now</button> <button class="btn warn" type="button" data-skipauction>Skip it: no one gets prospects</button>
        <p class="ps">Skipping ignores every bid, bots included, and puts all prospects on Monday waivers.</p>
        <form class="tools" id="startwk"><label for="swk" class="ps">Scoring starts in week</label><input type="number" id="swk" min="1" max="${s.regWeeks}" value="${Math.max(s.startWeek, H.weekOf(opener, new Date(now())))}" style="width:80px"><button class="btn sm" type="submit">Set</button></form></section>` : ""}
      <section class="card"><h3>Delete this league</h3><p class="ps" style="margin-top:0">It goes to the trash for 30 days with every roster, claim and sealed bid. You can bring it back from the Hard Cap home page with code <b>${esc(LID)}</b> and your commissioner PIN. After 30 days it's gone for good.</p>
        <form class="tools" id="delform"><label class="sr" for="delname">League name</label><input type="text" id="delname" placeholder="Type ${esc(LG.name)} to confirm" autocomplete="off"><button class="btn warn" type="submit">Delete league</button></form></section>
      <section class="card"><h3>Server clock</h3><p class="ps" style="margin:0">Draft clocks, autopicks, the auction, waivers, lineup locks, trade reviews and the line check all run on the server every minute, whether or not anyone has the site open.</p></section></div>`;
    return (sec[sub] || sec.settings)();
  }
  // How the feeds landed: standard contracts, two-ways and anyone held for a mismatch.
  function contractStatus() {
    const r = NBA.contractReport || {};
    const tw = POOL.filter((p) => p.deal), held = POOL.filter((p) => p.limbo);
    return `<section class="card"><h3>Where contracts come from</h3><dl class="kv">
      <dt>Standard contracts</dt><dd>${STATS.contractsUpdated ? `Basketball-Reference, updated ${fmtWhen(STATS.contractsUpdated)}` : "The cap sheet"}${r.updated ? `, ${r.updated} changed from the cap sheet` : ""}</dd>
      <dt>Two-way and 10-day</dt><dd>${tw.length} players at their real salaries</dd>
      <dt>Held</dt><dd>${held.length ? held.map((p) => esc(p.n)).join(", ") + ": listed under another team, so they can't be signed until the feeds agree" : "Nobody"}</dd></dl></section>`;
  }
  // The draft's shape at a glance, on the Draft tab for everyone and in the commissioner's draft settings.
  function draftInfoCard() {
    const s = LG.settings, n = LG.teams.length;
    const st = LG.phase === "lobby" ? "Not started" : LG.phase === "nba" ? (LG.nba.paused ? "Paused" : "In progress") : `Done ${fmtDate(LG.nba.done || now())}`;
    return `<section class="card"><h3>Draft details</h3><dl class="kv">
      <dt>Status</dt><dd>${st}</dd><dt>Format</dt><dd>Snake, ${s.roster} rounds, ${n * s.roster} picks</dd>
      <dt>Clock</dt><dd>${s.draftMode === "slow" ? `Slow, ${s.slowHours} hours a pick` : `Live, ${s.clock} seconds a pick`}; your queue picks if it runs out</dd>
      <dt>Rule</dt><dd>A pick only counts if you can still fill every open spot at the cheapest salaries left</dd>
      <dt>Then</dt><dd>Prospect Board auction for ${s.prospects} spots, ${s.auctionHours} hours, out of your $${s.faab} season FAAB</dd></dl>
      <div class="lbl" style="margin:10px 0 4px">First-round order</div><ol style="margin:0;padding-left:22px;columns:2">${LG.nba.round1.map((id) => `<li${isMine(LG.teams[id]) ? ' style="font-weight:800"' : ""}>${esc(LG.teams[id].name)}</li>`).join("")}</ol></section>`;
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
    // Moves save right away, the way Yahoo does it.
    const saveSlots = (w, slots, msg) => mutate(`Set week ${w} lineup`, (L) => H.setLineup(L, POOL, me.team, w, slots, now(), opener)).then((ok) => { ui.lmove = null; ui.draftLineup = null; if (ok) toast(msg); render(); });
    const curSlots = (w) => (ui.draftLineup && ui.draftLineup.w === w ? ui.draftLineup.slots : H.lineupFor(LG, myTeam(), w, BY)).slice();
    const lwNow = () => (ui.lw && ui.lw >= curWeek() ? ui.lw : editWeek());
    on("[data-lmove]", "click", (e) => { const b = e.currentTarget; ui.lmove = { pid: b.dataset.lmove, i: b.dataset.lfrom === "" ? null : +b.dataset.lfrom, w: lwNow() }; render(); });
    on("[data-lcancel]", "click", () => { ui.lmove = null; render(); });
    on("[data-lhere]", "click", (e) => {
      const m = ui.lmove, w = m.w, t = myTeam(), slots = curSlots(w), tgt = e.currentTarget.dataset.lhere;
      if (tgt.startsWith("bn:")) { slots[m.i] = tgt.slice(3); }                         // bench player in, starter to the bench
      else { const j = +tgt, other = slots[j]; slots[j] = m.pid; if (m.i != null) slots[m.i] = other || null; }
      saveSlots(w, slots, `${nameOf(m.pid)} moved.`);
    });
    on("[data-lbench]", "click", () => { const m = ui.lmove, slots = curSlots(m.w); slots[m.i] = null; saveSlots(m.w, slots, `${nameOf(m.pid)} is on the bench.`); });
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
    on("#msort,#dsort", "change", (e) => { ui.sort = e.target.value; ui.sortDir = 1; render(); });
    const sortBy = (k) => { if (ui.sort === k) ui.sortDir = -(ui.sortDir || 1); else { ui.sort = k; ui.sortDir = 1; } render(); };
    on("[data-sortk]", "click", (e) => sortBy(e.currentTarget.dataset.sortk));
    on("[data-sortk]", "keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortBy(e.currentTarget.dataset.sortk); } });
    on("#dfit", "change", (e) => { ui.fit = e.target.checked; render(); });
    on("[data-sub]", "click", (e) => { ui.sub = e.currentTarget.dataset.sub; history.replaceState(null, "", "#draft/" + ui.sub); render(); });
    on("[data-logkind]", "click", (e) => { ui.logKind = e.currentTarget.dataset.logkind; render(); });
    on("[data-bid]", "click", (e) => { if (!myTeam()) return toast("Sign in to your team first.", true); const b = e.currentTarget; fetchMyBids("waiver").then(() => bidDialog(b.dataset.bid, b.dataset.biddrop || null)); });
    on("[data-trade]", "click", (e) => tradeDialog(+e.currentTarget.dataset.trade, e.currentTarget.dataset.pid));
    on("[data-act-trade]", "click", (e) => tradeDialog(e.currentTarget.dataset.with != null ? +e.currentTarget.dataset.with : null));
    on("[data-queue]", "click", (e) => { const id = e.currentTarget.dataset.queue; mutate("Queue", (L) => { const t = L.teams[me.team]; if (!t.queue.includes(id)) t.queue.push(id); return { ok: true }; }, { quiet: true }); });
    on("[data-unqueue]", "click", (e) => { const id = e.currentTarget.dataset.unqueue; mutate("Queue", (L) => { const t = L.teams[me.team]; t.queue = t.queue.filter((x) => x !== id); return { ok: true }; }, { quiet: true }); });
    on("[data-qup]", "click", (e) => { const id = e.currentTarget.dataset.qup; mutate("Queue", (L) => { const q = L.teams[me.team].queue, i = q.indexOf(id); if (i > 0) [q[i - 1], q[i]] = [q[i], q[i - 1]]; return { ok: true }; }, { quiet: true }); });
    on("[data-pick]", "click", (e) => { const id = e.currentTarget.dataset.pick; mutate(`Picked ${nameOf(id)}`, (L) => H.draftPick(L, POOL, me.team, id, now(), false)).then((ok) => ok && toast(`You drafted ${nameOf(id)} for ${money(BY[id].sal)}.`)); });
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
    on("[data-accept]", "click", (e) => mutate("Accepted a trade", (L) => H.respondTrade(L, POOL, e.currentTarget.dataset.accept, true, curWeek(), now())).then((ok) => ok && toast(ok.review ? `Accepted. The league has ${LG.settings.reviewHours} hours to review it.` : "Trade accepted.")));
    on("[data-vote]", "click", (e) => { const id = e.currentTarget.dataset.vote, x = LG.trades.find((y) => y.id === id), on2 = !(x && x.votes && x.votes[me.team]);
      mutate(on2 ? "Voted to veto a trade" : "Took back a veto vote", (L) => H.voteTrade(L, id, me.team, on2, now())).then((ok) => ok && toast(on2 ? "Veto vote counted." : "Vote taken back.")); });
    on("#tpick", "change", (e) => { location.hash = `#team/${route().sub}/${e.target.value}`; });
    on("[data-go]", "click", (e) => { ui.week = +e.currentTarget.dataset.wk; ui.pair = null; location.hash = "#" + e.currentTarget.dataset.go; });
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
    const delf = $("#delform", app);
    if (delf) delf.onsubmit = async (e) => {
      e.preventDefault();
      const nm = $("#delname", app).value;
      if (nm.trim().toLowerCase() !== LG.name.trim().toLowerCase()) return toast(`Type the league name, ${LG.name}, to confirm.`, true);
      let r;
      try { r = await rpc("hc_delete", { p_id: LID, p_pin: String(me.commish), p_confirm: nm }); } catch (err) { return toast(err.message, true); }
      if (r.error) return toast(r.error, true);
      store.set("hc:leagues", store.get("hc:leagues", []).filter((x) => x.id !== LID));
      if (store.get("hc:last", null) === LID) store.set("hc:last", null);
      store.set("hc:deleted", { id: LID, name: LG.name, until: r.purge_at });
      location.href = "./?deleted=" + LID;
    };
    const sf = $("#settings", app);
    if (sf) sf.onsubmit = (e) => {
      e.preventDefault(); const fd = new FormData(sf);
      mutate("Settings", (L) => {
        const nm = String(fd.get("name") || "").trim(); if (nm) L.name = nm.slice(0, 40);
        L.settings.buyIn = Math.max(0, Math.floor(+fd.get("buyIn") || 0));
        const lsv = +fd.get("lineScale");
        if (L.phase === "lobby" && lsv && lsv !== (L.settings.lineScale || 1)) { const fresh = H.defaultTiers(NBA.cba, lsv); L.settings.lineScale = lsv; L.settings.tiers.forEach((t, k) => (t.line = fresh[k].line)); }
        L.settings.tiers.forEach((t, k) => { if (k) t.add = Math.max(0, Math.floor(+fd.get("tier" + k) || 0)); });
        L.settings.tierDeadline = Math.max(1, Math.floor(+fd.get("tierDeadline") || 1));
        L.settings.tradeDeadline = Math.max(1, Math.floor(+fd.get("tradeDeadline") || 18));
        L.settings.irSlots = Math.max(0, Math.min(4, Math.floor(+fd.get("irSlots") || 0)));
        L.settings.irRule = fd.get("irRule") === "any" ? "any" : "out";
        const pay = String(fd.get("payout") || "").split(/[^0-9]+/).filter(Boolean).map(Number);
        if (pay.length && pay.reduce((a, b) => a + b, 0) !== 100) return { ok: false, why: "The payout split has to add up to 100%" };
        if (pay.length) L.settings.payout = pay;
        L.settings.vetoHours = Math.max(0, Math.min(168, Math.floor(+fd.get("vetoHours") || 0)));
        const rv = String(fd.get("tradeReview") || ""); if (["vote", "commish", "none"].includes(rv)) L.settings.tradeReview = rv;
        L.settings.reviewHours = Math.max(1, Math.min(168, Math.floor(+fd.get("reviewHours") || 48)));
        L.settings.vetoShare = Math.max(0.01, Math.min(1, (+fd.get("vetoShare") || 50) / 100));
        L.settings.lineGraceHours = Math.max(0, Math.min(336, Math.floor(+fd.get("lineGraceHours") || 72)));
        L.settings.vorpCat = fd.get("vorpCat") !== "0";
        L.settings.summerMin = Math.max(1, Math.floor(+fd.get("summerMin") || 50));
        L.settings.summerMax = Math.max(L.settings.summerMin, Math.floor(+fd.get("summerMax") || 100));
        L.settings.compDollars = Math.max(0, Math.floor(+fd.get("compDollars") || 0));
        if (L.phase === "lobby") {
          const f = Math.max(1, Math.floor(+fd.get("faab") || H.DEFAULTS.faab)); if (f !== L.settings.faab) { L.settings.faab = f; L.teams.forEach((t) => (t.faab = f)); }
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
          const pa = String(fd.get("prospectAuction") || ""); if (["live", "sealed", "skip"].includes(pa)) L.settings.prospectAuction = pa;
          L.settings.auctionClock = Math.min(300, Math.max(10, Math.floor(+fd.get("auctionClock") || 30)));
          L.settings.slowAuctionHours = Math.min(48, Math.max(1, Math.floor(+fd.get("slowAuctionHours") || 4)));
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
    on("#abamt", "input", (e) => (ui.abamt = +e.target.value));
    on("#nomamt", "input", (e) => (ui.nomamt = +e.target.value));
    const chf = $("#chatform", app);
    if (chf) {
      const ta = $("#chatbody", app);
      ta.addEventListener("input", () => (ui.chatDraft = ta.value));
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chf.requestSubmit(); } });
      chf.onsubmit = async (e) => {
        e.preventDefault();
        const body = ta.value.trim(); if (!body) return;
        const team = me.team != null ? me.team : -1, pin = team === -1 ? me.commish : me.pin;
        let r; try { r = await rpc("hc_chat_post", { p_id: LID, p_team: team, p_pin: String(pin), p_body: body }); } catch (err) { return toast(err.message, true); }
        if (r.error) return toast(r.error, true);
        ui.chatDraft = ""; await loadChat(); render();
        const el = $("#chatlist"); if (el) el.scrollTop = el.scrollHeight;
      };
      const el = $("#chatlist"); if (el) el.scrollTop = el.scrollHeight;
    }
    const bidAt = (amt) => mutate(`Bid $${amt}`, (L) => H.auctionBid(L, PROS, me.team, amt, now()), { quiet: false }).then((ok) => ok && toast(`You bid $${amt}.`));
    on("[data-abid-q]", "click", (e) => bidAt(+e.currentTarget.dataset.abidQ));
    const abf = $("#abidform", app);
    if (abf) abf.onsubmit = (e) => { e.preventDefault(); bidAt(Math.floor(+$("#abamt", app).value || 0)); };
    on("[data-nominate]", "click", (e) => { const id = e.currentTarget.dataset.nominate, amt = Math.floor(+(($("#nomamt", app) || {}).value) || LG.settings.minBid);
      mutate(`Nominated ${nameOf(id)}`, (L) => H.nominate(L, PROS, me.team, id, amt, now())).then((ok) => ok && toast(`${nameOf(id)} is up at $${amt}.`)); });
    on("[data-anompass]", "click", () => mutate("Done nominating", (L) => H.passNomination(L, PROS, me.team, now())).then((ok) => ok && toast("You're out of the nomination order. You can still bid.")));
    on("[data-astart]", "click", () => mutate("Started the live auction", (L) => H.beginAuction(L, PROS, now(), 10000), { as: "commish" }).then((ok) => ok && toast("The auction starts in 10 seconds.")));
    on("[data-apause]", "click", (e) => { const pz = e.currentTarget.dataset.apause === "1"; mutate(pz ? "Paused the auction" : "Resumed the auction", (L) => H.pauseAuction(L, PROS, now(), pz), { as: "commish" }); });
    on("[data-areopen]", "click", () => mutate("Opened a live prospect auction", (L) => H.reopenAuction(L, PROS, now()), { as: "commish" }).then((ok) => ok && (location.hash = "#draft/prospects")));
    on("[data-skipauction]", "click", () => mutate("Ended the Prospect Board auction", (L) => (L.pauction ? H.endAuction(L, now()) : H.resolveAuction(L, PROS, {}, now(), { skip: true })), { as: "commish", clear: "auction" }).then((ok) => ok && toast("Auction over. Everyone left is on waivers.")));
    const swf = $("#startwk", app);
    if (swf) swf.onsubmit = (e) => { e.preventDefault(); const w = Math.max(1, Math.floor(+$("#swk", app).value || 1)); mutate("Scoring start", (L) => { L.settings.startWeek = w; return { ok: true }; }, { as: "commish" }).then((ok) => ok && toast(`Scoring starts in week ${w}.`)); };
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
      const order = H.standings(L, curWeek() - 1, WK, BY).map((x) => x.id);
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
      } else if (LG.phase === "prospects" && LG.pauction && LG.due.auction && t >= Date.parse(LG.due.auction)) await mutate("Auction clock", (L) => (H.auctionTick(L, PROS, now()) ? { ok: true } : { ok: false, why: "" }), { as: "any", quiet: true });
      else if (LG.phase === "prospects" && LG.due.auction && t >= Date.parse(LG.due.auction)) await closeAuction(false);
      else if (LG.phase === "league" && LG.due.waiver && t >= Date.parse(LG.due.waiver)) await processWaivers(false);
      else if (LG.phase === "league" && H.lockLineups(JSON.parse(JSON.stringify(LG)), POOL, t, opener)) await mutate("Locked lineups", (L) => (H.lockLineups(L, POOL, now(), opener) ? { ok: true } : { ok: false, why: "" }), { as: "any", quiet: true });
      else if (LG.phase === "league" && LG.trades.some((x) => x.status === "review" && t >= x.reviewEnds)) await mutate("Trade review ended", (L) => (H.finalizeTrades(L, POOL, now(), curWeek()) ? { ok: true } : { ok: false, why: "" }), { as: "any", quiet: true });
      else if (LG.phase === "league" && H.enforceLine(JSON.parse(JSON.stringify(LG)), POOL, t, curWeek(), opener)) await mutate("Checked the line", (L) => (H.enforceLine(L, POOL, now(), curWeek(), opener) ? { ok: true } : { ok: false, why: "" }), { as: "any", quiet: true });
    } finally { ticking = false; }
  }

  /* ---------- render ---------- */
  function render() {
    if (D.open) return;
    const a = document.activeElement, id = a && a.id && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") ? a.id : null;
    const sel = id && a.type !== "number" ? [a.selectionStart, a.selectionEnd] : null;
    const scroller = $("#pool .t") ? $("#pool").scrollTop : null;
    draw();
    if (id && $("#" + id)) { const el = $("#" + id); el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not text */ } }
    if (scroller != null && $("#pool")) $("#pool").scrollTop = scroller;
  }
  function draw() {
    chrome();
    document.body.classList.toggle("inleague", !!LID);
    if (!LID) { document.body.classList.remove("room"); return renderLanding(); }
    if (!LG) return;
    const r = route();
    const room = r.tab === "draft";
    document.body.classList.toggle("room", room);
    if (room) document.documentElement.style.setProperty("--top", ($("#mast").getBoundingClientRect().bottom + 2 + (LG.phase !== "league" ? 0 : 0)) + "px");
    const views = { league: () => viewLeague(r.sub), team: () => viewTeam(r.sub, r.arg), players: () => viewMarket(r.sub), matchups: () => viewMatchups(r.sub), draft: () => viewDraft(r.sub), commish: () => viewCommish(r.sub) };
    const html = views[r.tab]();
    app.innerHTML = room ? html : `<div class="wrap page">${html}</div><div class="wrap foot">Hard Cap. Draft the player. Carry the contract. Contracts from Basketball-Reference${STATS.contractsUpdated ? `, updated ${fmtDate(STATS.contractsUpdated)}` : ""}; box scores, injuries and schedules from ESPN${STATS.updated ? `, updated ${fmtDate(STATS.updated)}` : ""}; prospects from Tankathon. <a href="../">More projects by David Solar</a>. League code ${esc(LID)}.</div>`;
    if (room) {
      const clockH = $(".clock") ? $(".clock").getBoundingClientRect().height : 0;
      document.documentElement.style.setProperty("--top", ($("#mast").getBoundingClientRect().bottom + clockH) + "px");
    }
    wire();
    if (room && $("#pool")) {
      // Clicking anywhere on a row (not a button) opens the player's card, where you can draft him.
      $$("#pool tr[data-pid]").forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("button,a,input")) playerCard(tr.dataset.pid); }));
    }
    drawTimer();
  }
  function drawTimer() {
    $$("[data-end]").forEach((el) => { const ms = +el.dataset.end - now(); el.textContent = fmtLeft(ms); el.classList.toggle("hot", ms <= 10000 && LG.settings.draftMode !== "slow"); });
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
    if (lastL && standalone() && !params.get("new")) { location.replace("?l=" + lastL + "#league"); return; }
    render(); return;
  }
  store.set("hc:last", LID);
  try { await load(true); }
  catch (e) {
    // A deleted league comes off this device's list so it doesn't keep showing up.
    if (/No league/.test(e.message)) {
      store.set("hc:leagues", store.get("hc:leagues", []).filter((x) => x.id !== LID));
      if (store.get("hc:last", null) === LID) store.set("hc:last", null);
    }
    app.innerHTML = `<div class="wrap loading">${esc(e.message)}. It may have been deleted. <a href="./">Back to your leagues</a>.</div>`; return;
  }
  await loadChat();
  const list = store.get("hc:leagues", []);
  if (!list.some((x) => x.id === LID)) store.set("hc:leagues", [{ id: LID, name: LG.name }, ...list].slice(0, 12));
  render();
  setInterval(drawTimer, 250);
  setInterval(tick, 1000);
  let polling = false;
  const poll = async () => {
    if (polling || busy || document.hidden) return;
    polling = true;
    try { const a = await load(false), b = await loadChat(); if (a || b) render(); } catch (e) { /* offline for a moment; the next poll catches up */ }
    finally { polling = false; }
  };
  const live = () => LG && (LG.phase === "nba" || (LG.phase === "prospects" && LG.pauction));
  setInterval(() => { if (live()) poll(); }, 2000);
  setInterval(() => { if (LG && !live()) poll(); }, 20000);
  document.addEventListener("visibilitychange", () => !document.hidden && poll());
})();
