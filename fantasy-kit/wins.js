/* Draft Lab's wins pool page (fantasy/pools/wins/): friends draft real NBA or NFL teams in a snake, and the most
   combined wins from draft day forward takes it. The rules are wins-core.js (FK.wins); the pool, its entries and its
   picks live on the server (tools/fantasykit_wins.sql, through FK.cloud.rpc). Records come from the site's own
   standings files: celtics/live.json (NBA, every morning) and nfl/data/games.json (NFL, every day).

   ?p=CODE     a pool's page        ?join=CODE   the invite link: join, then the pool      ?make=nba|nfl   the form */
(function () {
  "use strict";
  const C = window.FK.cloud, W = window.FK.wins;
  const app = document.getElementById("app");
  const params = new URLSearchParams(location.search);
  const esc = (x) => String(x == null ? "" : x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const HERE = "/fantasy/pools/wins/";
  const SRC = { nba: "/celtics/live.json", nfl: "/nfl/data/games.json" };
  const SPORT_C = { nfl: "#C8102E", nba: "#1D5FBF" };
  const st = { user: C.user(), code: (params.get("p") || params.get("join") || "").toUpperCase(), join: !!params.get("join"), make: params.get("make"), board: null, recs: {}, tab: null, msg: "", invite: false, forId: null };

  // ---------- theme (the masthead's Dark/Light button) ----------
  const dark = () => document.documentElement.dataset.theme === "dark";
  function themeBtn() { const b = document.querySelector("button[data-theme]"); if (b) b.textContent = dark() ? "Light" : "Dark"; }
  document.addEventListener("click", (e) => {
    if (!e.target.closest("button[data-theme]")) return;
    const on = !dark();
    if (on) document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("fk-lab:theme", JSON.stringify(on ? "dark" : "light")); } catch (x) { /* private mode */ }
    themeBtn();
  });

  // ---------- pieces ----------
  const ART = `<svg class="pl-art" viewBox="0 0 220 160" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M30 130h160M50 130V92h28v38M96 130V62h28v68M142 130V34h28v96"/><path d="m46 70 30-22 26 12 44-36"/><path d="M132 24h14v14"/></g></svg>`;
  const band = (title, sub, extra = "", kick = "Draft Lab") => `<section class="pl-band"><div class="pl-band-in"><p class="pl-kick">${kick}</p><h1 class="disp">${title}</h1>${sub ? `<p class="pl-sub">${sub}</p>` : ""}${extra}</div>${ART}</section>`;
  const logo = (sport, t, px = 28) => `<img class="pl-logo" src="${esc(W.logo(sport, t, px))}" alt="" width="${px}" height="${px}" loading="lazy" onerror="this.style.visibility='hidden'">`;
  const rec = (r) => (r ? `${r.w}-${r.l}` : "");
  const ok = (r) => { if (r && r.error) throw new Error(r.error); return r; };
  const fail = (e) => { st.msg = e && e.message ? e.message : String(e || "Something went wrong."); render(); };
  const nameOf = (b, id) => { const m = b.members.find((x) => x.id === id); return m ? m.name : "Someone"; };
  const meId = (b) => (b.members.find((x) => x.me) || {}).id;
  const RULES = (sport) => `<ul class="pl-rules">
    <li><b>Draft teams, not players.</b> A snake draft of real ${sport ? W.SPORTS[sport].name : "NBA or NFL"} teams. Every entry gets the same number.</li>
    <li><b>Most wins takes it.</b> Your teams' combined regular-season wins from draft day forward. Fewer losses breaks a tie.</li>
    <li><b>No clock.</b> Whoever is up picks on their own time. The pool's owner can enter a pick someone texts in.</li>
    <li><b>Nothing to manage.</b> No lineups, no waivers, no trades. The standings keep score.</li></ul>`;

  async function records(sport) {
    if (st.recs[sport]) return st.recs[sport];
    try { const j = await fetch(SRC[sport], { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)); st.recs[sport] = { at: j && j.updated, season: j && j.season, by: W.records(sport, j) }; }
    catch (e) { st.recs[sport] = { by: null }; }
    return st.recs[sport];
  }

  function signinCard(lead) {
    return `<div class="card pl-signin" id="pl-signin"><div class="bd"><h2>${esc(lead || "Sign in to play")}</h2><p class="ps">Same account as your Draft Lab leagues.</p>
      <form id="pl-link" class="pl-row"><label class="sr" for="pl-email">Email</label><input id="pl-email" type="email" required autocomplete="email" placeholder="you@example.com" value="${esc(C.lastEmail ? C.lastEmail() : "")}"><button class="btn go">Email me a sign-in link</button></form>
      <details class="pl-pw"><summary>Use a password instead</summary><form id="pl-pass" class="pl-row"><label class="sr" for="pl-login">Email or username</label><input id="pl-login" autocomplete="username" placeholder="Email or username" required><label class="sr" for="pl-password">Password</label><input id="pl-password" type="password" autocomplete="current-password" placeholder="Password" required><button class="btn">Sign in</button></form></details>
      <p class="pl-msg" role="status">${esc(st.msg)}</p></div></div>`;
  }

  // ---------- home: make one, join one, yours ----------
  async function home() {
    let mine = [];
    if (st.user) mine = await C.rpc("wn_mine").catch((e) => { st.msg = st.msg || e.message; return []; });
    const sport = st.make === "nba" || st.make === "nfl" ? st.make : new Date().getMonth() >= 8 || new Date().getMonth() === 0 ? "nfl" : "nba";
    const row = (p) => { const x = W.status(p); return `<li class="${x ? "t-" + x.tone : ""}"><a href="${HERE}?p=${esc(p.id)}"><span class="pl-badge" style="--sc:${SPORT_C[p.sport]}">${logoMark()}</span><span class="pl-li-t"><b>${esc(p.name)}</b><small>${esc(W.SPORTS[p.sport].name)} wins pool &middot; ${esc(x.text)}</small></span>${x.tone === "todo" ? `<span class="pl-due">Your pick</span>` : ""}<span class="pl-chev" aria-hidden="true">&rsaquo;</span></a></li>`; };
    const makeForm = `<form class="pl-panel" id="wp-new"><div class="pl-form">
        <fieldset class="pl-kinds"><legend>League</legend>${["nfl", "nba"].map((k) => `<label style="--sc:${SPORT_C[k]}"><input type="radio" name="sport" value="${k}"${k === sport ? " checked" : ""}><span><i class="pl-kic">${logoMark()}</i><b>${W.SPORTS[k].name}</b><small>${Object.keys(W.TEAMS[k]).length} teams</small></span></label>`).join("")}</fieldset>
        <label>Pool name<input name="name" maxlength="40" required placeholder="The wins pool"></label>
        <label>Teams each entry drafts <small class="ps">you can change it until the draft starts</small><select name="per">${[1, 2, 3, 4, 5, 6, 8, 10].map((n) => `<option value="${n}"${n === 4 ? " selected" : ""}>${n}</option>`).join("")}</select></label>
        <label>Your entry's name <small class="ps">optional</small><input name="entry" maxlength="28" placeholder="${esc((st.user && st.user.email || "").split("@")[0])}"></label>
        <button class="btn go">Make the pool</button></div></form>`;
    const joinForm = `<form class="pl-panel" id="wp-join"><div class="pl-form">
        <label>Code<input name="code" maxlength="6" required placeholder="ABC123" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.12em" value="${esc(st.code)}"></label>
        <label>Your entry's name <small class="ps">optional</small><input name="entry" maxlength="28"></label>
        <button class="btn go">Join</button></div></form>`;
    const panel = st.panel || (st.make ? "make" : null);
    const yours = st.user ? `<section class="card pl-yours"><div class="pl-yours-h"><h2>Your wins pools</h2><div class="pl-yours-act">
        <button type="button" class="btn sm${panel === "make" ? " on" : ""}" data-panel="make" aria-expanded="${panel === "make"}">+ Make a pool</button><button type="button" class="btn sm${panel === "join" ? " on" : ""}" data-panel="join" aria-expanded="${panel === "join"}">Join with a code</button></div></div>
      ${panel === "make" ? makeForm : panel === "join" ? joinForm : ""}<p class="pl-msg" role="status">${esc(st.msg)}</p>
      ${(mine || []).length ? `<ul class="pl-list">${mine.map(row).join("")}</ul>` : `<div class="pl-empty"><b>No wins pools yet.</b> Make one and send the code, or join a friend's.</div>`}</section>` : signinCard("Sign in to make or join a wins pool");
    app.innerHTML = `<div class="wrap page pl">${band("Wins pool", "Draft real teams with your friends. Most combined wins from draft day forward takes it.", `<div class="pl-share"><a class="btn sm ghost" href="/fantasy/pools/">All pools</a></div>`)}
      ${yours}<div class="card"><div class="mod-h"><h2>How it works</h2></div><div class="bd">${RULES()}</div></div></div>`;
  }
  const logoMark = () => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16M6 20v-5h3v5M10.5 20V10h3v10M15 20V5h3v15"/></svg>`;

  // ---------- a pool ----------
  let qrLoad = null;
  const loadQr = () => qrLoad || (qrLoad = new Promise((res) => { const s = document.createElement("script"); s.src = "/fantasy-kit/vendor/qrcode.min.js"; s.onload = () => res(window.qrcode); s.onerror = () => res(null); document.head.appendChild(s); }));
  function invitePanel(b) {
    const p = b.pool, url = `${location.origin}${HERE}?join=${p.id}`;
    const text = `Join my ${W.SPORTS[p.sport].name} wins pool, ${p.name}, on Draft Lab: ${url}`;
    let qr = "";
    if (window.qrcode) { try { const q = window.qrcode(0, "M"); q.addData(url); q.make(); qr = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch (e) { qr = ""; } }
    else loadQr().then((good) => { if (good && st.invite) render(); });
    return `<section class="card pl-inv" aria-label="Invite people"><div class="mod-h"><h2>Invite people</h2><span class="grow"></span><button type="button" class="btn sm ghost" data-invite>Done</button></div>
      <div class="bd pl-inv-b"><div class="pl-inv-qr">${qr || `<span class="ps">Loading the code</span>`}<small>Scan with a phone camera to join</small></div>
      <div class="pl-inv-o">
        <label class="pl-inv-l">Invite link<span><input readonly value="${esc(url)}" onfocus="this.select()"><button type="button" class="btn sm" data-copy="${esc(url)}">Copy</button></span></label>
        <div class="pl-inv-btns"><a class="btn sm" href="sms:?&body=${encodeURIComponent(text)}">Text it</a>
          <a class="btn sm" href="mailto:?subject=${encodeURIComponent(`Join ${p.name}`)}&body=${encodeURIComponent(`${text}\n\nYou'll sign in with your email, then you're in.`)}">Email it</a></div>
        <p class="ps">Or tell them the code <b class="pl-code">${esc(p.id)}</b>. Entries can join until the draft starts.</p>
      </div></div></section>`;
  }
  const head = (b) => {
    const p = b.pool, d = p.draft, n = b.members.length;
    const when = !d ? "Draft not started" : !p.done ? `Drafting: pick ${b.picks.length + 1} of ${W.total(b)}` : `Wins since ${new Date(d.started).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}`;
    return band(esc(p.name), `Wins pool &middot; ${n} ${n === 1 ? "entry" : "entries"}, ${p.per} ${p.per === 1 ? "team" : "teams"} each &middot; ${when}`,
      `<div class="pl-share"><span class="pl-code" title="Pool code">${esc(p.id)}</span>${d ? "" : `<button class="btn sm go" data-invite aria-expanded="${!!st.invite}">Invite people</button>`}<a class="btn sm ghost" href="${HERE}">All wins pools</a></div>`, W.SPORTS[p.sport].name);
  };

  // before the draft: who's in, the settings, and the start button
  function lobby(b, R) {
    const p = b.pool, n = b.members.length, max = W.maxPer(p.sport, n), tooMany = n * p.per > Object.keys(W.TEAMS[p.sport]).length;
    const list = `<ul class="pl-list wp-ents">${b.members.map((m) => `<li><span class="wp-ent"><b>${esc(m.name)}</b>${m.me ? ` <span class="tag">You</span>` : ""}</span>${p.mine && !m.me ? `<button type="button" class="btn xs ghost" data-remove="${esc(m.id)}" aria-label="Remove ${esc(m.name)}">Remove</button>` : ""}</li>`).join("")}</ul>`;
    const owner = p.mine ? `<div class="card"><div class="mod-h"><h2>Start the draft</h2></div><div class="bd pl-form">
        <label>Teams each entry drafts<select data-per>${Array.from({ length: Math.max(max, p.per) }, (_, i) => i + 1).map((k) => `<option value="${k}"${k === p.per ? " selected" : ""}${k > max ? " disabled" : ""}>${k}</option>`).join("")}</select></label>
        <p class="ps" style="margin:0">${n} ${n === 1 ? "entry" : "entries"} drafting ${p.per} each is ${n * p.per} of the ${Object.keys(W.TEAMS[p.sport]).length} teams. Starting shuffles the order, closes the pool to new entries, and saves today's standings so only wins from here on count${R.at ? ` (standings as of ${esc(String(R.at).slice(0, 10))})` : ""}.</p>
        ${!R.by ? `<p class="pl-msg">The standings didn't load, so the draft can't start yet. Refresh in a minute.</p>` : ""}
        <div><button type="button" class="btn go" data-start${n < 2 || tooMany || !R.by ? " disabled" : ""}>Start the draft</button>${n < 2 ? ` <span class="ps">Needs at least two entries.</span>` : tooMany ? ` <span class="ps">Too many teams each for ${n} entries.</span>` : ""}</div></div></div>` : `<div class="pl-note">Waiting for the pool's owner to start the draft. The order is shuffled when it starts.</div>`;
    return `<div class="card"><div class="mod-h"><h2>Entries</h2><span class="ps">${n} in</span></div>${list}</div>${owner}
      <div class="card"><div class="mod-h"><h2>How it works</h2></div><div class="bd">${RULES(p.sport)}</div></div>`;
  }

  // the draft: who's up, the teams left, and the board so far
  function draftView(b, R) {
    const p = b.pool, d = p.draft, c = W.onClock(b), mine = meId(b), up = c && c.user === mine, can = c && (up || p.mine);
    const order = d.order, m = order.length;
    const av = W.available(b, R.by);
    const upName = c ? nameOf(b, c.user) : "";
    const next = c ? [1, 2, 3].map((k) => W.turn(order, c.n + k)).filter((x, i) => c.n + i + 1 <= W.total(b)).map((id) => esc(nameOf(b, id))) : [];
    const clock = c ? `<div class="pl-note wp-clock${up ? " me" : ""}"><b>${up ? "You're up." : `${esc(upName)} is up.`}</b> <span>Round ${c.round}, pick ${c.inRound} (${c.n} of ${W.total(b)}).${next.length ? ` Then ${next.join(", ")}.` : ""}${!up && p.mine ? " You own the pool, so you can enter this pick for them." : ""}</span></div>` : "";
    const teams = `<div class="card"><div class="mod-h"><h2>Teams left</h2><span class="ps">${av.length} of ${d.teams.length}${R.by ? ", best record first" : ""}</span></div><div class="wp-grid">${av.map((t) => `<button type="button" class="wp-team" data-pick="${esc(t.team)}"${can ? "" : " disabled"} title="${esc(W.teamFull(p.sport, t.team))}">${logo(p.sport, t.team, 32)}<span><b>${esc(W.teamName(p.sport, t.team))}</b><small>${rec(t)}</small></span></button>`).join("")}</div></div>`;
    const rounds = Math.ceil(b.picks.length / m) || 1;
    const cell = (r, i) => { const n = r * m + i + 1, k = b.picks[n - 1], who = W.turn(order, n); return k ? `<td class="${k.user === mine ? "me" : ""}">${logo(p.sport, k.team, 20)} <b>${esc(k.team)}</b><small>${esc(nameOf(b, k.user))}</small></td>` : `<td class="open${c && c.n === n ? " now" : ""}"><small>${esc(nameOf(b, who))}</small></td>`; };
    const board = `<div class="card"><div class="mod-h"><h2>Draft board</h2>${p.mine && b.picks.length ? `<span class="grow"></span><button type="button" class="btn xs ghost" data-undo>Undo last pick</button>` : ""}</div><div class="table-wrap"><table class="t wp-board"><tbody>${Array.from({ length: Math.min(p.per, rounds + (c && c.inRound === 1 && b.picks.length ? 1 : 0)) }, (_, r) => `<tr><th>R${r + 1}</th>${Array.from({ length: m }, (_, i) => cell(r, i)).join("")}</tr>`).join("")}</tbody></table></div></div>`;
    return clock + teams + board;
  }

  // the standings: entries by combined wins since the draft, each with its teams
  function standings(b, R) {
    const p = b.pool, rows = W.table(b, R.by), games = W.SPORTS[p.sport].games;
    const body = rows.map((r) => `<tr class="${r.me ? "me" : ""}"><td class="c num">${r.rank}</td><td class="nm"><b>${esc(r.name)}</b></td><td class="r num"><b>${r.w}</b></td><td class="r num ps">${r.l}</td>
      <td class="wp-tms">${r.teams.map((t) => `<span class="wp-chip" title="${esc(W.teamFull(p.sport, t.team))}: ${t.w}-${t.l} since the draft, pick ${t.n}">${logo(p.sport, t.team, 18)}<i>${esc(t.team)}</i><b>${t.w}</b><small>-${t.l}</small></span>`).join("")}</td></tr>`).join("");
    const lead = rows[0] && rows[0].w > 0 ? rows.filter((r) => r.rank === 1).map((r) => r.name) : [];
    const note = !R.by ? `<div class="pl-note">The standings didn't load, so wins aren't showing. Refresh in a minute.</div>` : "";
    return `${note}<div class="card"><div class="table-wrap"><table class="t pl-st wp-st"><thead><tr><th class="c">#</th><th>Entry</th><th class="r" title="Combined wins since the draft">W</th><th class="r" title="Combined losses since the draft">L</th><th>Teams, by wins since the draft</th></tr></thead><tbody>${body}</tbody></table></div></div>
      <p class="ps">${lead.length ? `${esc(lead.join(" and "))} ${lead.length > 1 ? "lead" : "leads"}. ` : ""}Only wins after the draft started count. Fewer losses breaks a tie. ${p.sport === "nba" ? "NBA records update every morning." : "NFL records update the day after games."} Regular season only (${games} games): the playoffs don't count.</p>`;
  }
  function teamsTab(b, R) {
    const p = b.pool, d = p.draft, own = {};
    b.picks.forEach((k) => (own[k.team] = k));
    const rows = d.teams.map((t) => { const s = R.by ? W.since(d.base[t], R.by[t]) : { w: 0, l: 0 }; return { t, s, k: own[t], now: R.by && R.by[t] }; }).sort((a, c) => c.s.w - a.s.w || a.s.l - c.s.l || (a.t < c.t ? -1 : 1));
    return `<div class="card"><div class="table-wrap"><table class="t pl-st"><thead><tr><th>Team</th><th class="r">Record</th><th class="r" title="Since the draft">Since</th><th>Entry</th><th class="r">Pick</th></tr></thead><tbody>
      ${rows.map((x) => `<tr class="${x.k && x.k.user === meId(b) ? "me" : ""}"><td class="nm">${logo(p.sport, x.t, 20)} <b>${esc(W.teamFull(p.sport, x.t))}</b></td><td class="r num ps">${rec(x.now)}</td><td class="r num"><b>${x.s.w}</b>-${x.s.l}</td><td>${x.k ? esc(nameOf(b, x.k.user)) : `<span class="ps">Undrafted</span>`}</td><td class="r num ps">${x.k ? x.k.n : ""}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  function settings(b, rules = true) {
    const p = b.pool;
    return `${p.mine ? `<form class="card" id="wp-name"><div class="mod-h"><h2>Pool name</h2></div><div class="bd pl-form"><label class="sr" for="wp-nm">Pool name</label><input id="wp-nm" name="name" maxlength="40" required value="${esc(p.name)}"><button class="btn">Save</button></div></form>
      <form class="card danger" id="wp-del"><div class="mod-h"><h2>Delete the pool</h2></div><div class="bd pl-form"><p class="ps" style="margin:0">Deletes it for everyone. Type the code <b>${esc(p.id)}</b> to confirm.</p><label class="sr" for="wp-dc">Pool code</label><input id="wp-dc" name="code" maxlength="6" required autocapitalize="characters" style="text-transform:uppercase"><button class="btn warn">Delete the pool</button></div></form>`
      : !p.draft && meId(b) ? `<div class="card"><div class="bd"><button type="button" class="btn" data-leave>Leave this pool</button></div></div>` : ""}
      ${rules ? `<div class="card"><div class="mod-h"><h2>How it works</h2></div><div class="bd">${RULES(p.sport)}</div></div>` : ""}`;
  }

  async function pool() {
    let b = await C.rpc("wn_board", { p_pool: st.code }).catch((e) => ({ error: e.message }));
    // the invite link: sign in, then you're in (until the draft starts)
    if (b && b.ok && st.join && st.user && !meId(b) && !b.pool.draft) {
      const j = await C.rpc("wn_join", { p_code: st.code, p_entry: null }).catch((e) => ({ error: e.message }));
      if (j && j.error) st.msg = j.error; else b = await C.rpc("wn_board", { p_pool: st.code }).catch((e) => ({ error: e.message }));
    }
    st.board = b;
    if (!b || b.error) { app.innerHTML = `<div class="wrap page pl">${band("Wins pool", "")}<div class="card"><div class="bd"><p style="margin:0"><b>${esc((b && b.error) || "Couldn't load this pool.")}</b></p><p class="ps"><a href="${HERE}">Back to your wins pools</a></p></div></div></div>`; return; }
    const p = b.pool, R = await records(p.sport);
    const phase = !p.draft ? "lobby" : !p.done ? "draft" : "live";
    const tabs = phase === "lobby" ? [] : phase === "draft" ? [["draft", "Draft"], ["standings", "Entries"], ["settings", "Settings"]] : [["standings", "Standings"], ["teams", "Teams"], ["draft", "Draft board"], ["settings", "Settings"]];
    if (!tabs.some((t) => t[0] === st.tab)) st.tab = tabs.length ? tabs[0][0] : null;
    const guest = !st.user ? signinCard(p.draft ? "Sign in to see your entry" : `Sign in to join ${p.name}`) : !meId(b) && !p.draft ? `<form class="card" id="wp-join"><div class="mod-h"><h2>Join this pool</h2></div><div class="bd pl-form"><input type="hidden" name="code" value="${esc(p.id)}"><label>Your entry's name <small class="ps">(optional)</small><input name="entry" maxlength="28"></label><button class="btn go">Join ${esc(p.name)}</button></div></form>` : "";
    const body = phase === "lobby" ? lobby(b, R) : st.tab === "draft" ? draftView(b, R) : st.tab === "teams" ? teamsTab(b, R) : st.tab === "settings" ? settings(b) : standings(b, R);
    app.innerHTML = `<div class="wrap page pl wp">${head(b)}${st.invite && !p.draft ? invitePanel(b) : ""}${guest}
      ${tabs.length ? `<div class="seg pl-tabs" role="tablist">${tabs.map(([k, n]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${st.tab === k}">${n}</button>`).join("")}</div>` : ""}
      <p class="pl-msg" role="status">${esc(st.msg)}</p>${body}${phase === "lobby" && p.mine ? settings(b, false) : ""}</div>`;
    // before and during the draft: look for new entries and picks every few seconds while the page is showing
    clearTimeout(st.poll);
    if (phase !== "live") watch(phase === "draft" ? 4000 : 8000);
  }
  const sig = (x) => (x && x.ok ? `${x.members.length}:${x.picks.length}:${x.pool.per}:${x.pool.draft ? 1 : 0}:${x.pool.done || ""}` : "");
  function watch(ms) {
    clearTimeout(st.poll);
    st.poll = setTimeout(async () => {
      const busy = document.hidden || (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName));
      const nb = busy ? null : await C.rpc("wn_board", { p_pool: st.code }).catch(() => null);
      if (nb && sig(nb) !== sig(st.board)) { st.msg = ""; render(); } else watch(ms);
    }, ms);
  }

  let rendering = false, again = false;
  async function render() {
    if (rendering) { again = true; return; }
    rendering = true;
    try { themeBtn(); if (st.code) await pool(); else await home(); }
    catch (e) { app.innerHTML = `<div class="wrap page pl">${band("Wins pool", "")}<div class="card"><div class="bd"><p style="margin:0"><b>Something went wrong loading this page.</b></p><p class="ps">${esc(e && e.message)}</p></div></div></div>`; }
    rendering = false;
    if (again) { again = false; render(); }
  }
  const call = async (fn, args, done) => { st.msg = ""; try { ok(await C.rpc(fn, args)); if (done) done(); } catch (x) { st.msg = x.message; } render(); };

  app.addEventListener("click", (e) => {
    const t = e.target.closest("[data-panel],[data-tab],[data-invite],[data-copy],[data-start],[data-pick],[data-undo],[data-remove],[data-leave]");
    if (!t) return;
    const d = t.dataset, b = st.board;
    if (d.panel) { st.panel = st.panel === d.panel ? "none" : d.panel; st.msg = ""; return render(); }
    if (d.tab) { st.tab = d.tab; st.msg = ""; return render(); }
    if ("invite" in d) { st.invite = !st.invite; return render(); }
    if (d.copy) { (navigator.clipboard ? navigator.clipboard.writeText(d.copy) : Promise.reject()).then(() => { t.textContent = "Copied"; }, () => { st.msg = d.copy; render(); }); return; }
    if ("start" in d) {
      const R = st.recs[b.pool.sport];
      if (!R || !R.by) { st.msg = "The standings didn't load. Refresh and try again."; return render(); }
      if (!confirm(`Start the draft? The order is shuffled, and nobody else can join after this.`)) return;
      return call("wn_start", { p_pool: st.code, p_teams: Object.keys(W.TEAMS[b.pool.sport]), p_base: R.by, p_season: String(R.season || "") }, () => { st.tab = "draft"; st.invite = false; });
    }
    if (d.pick) {
      const c = W.onClock(b); if (!c) return;
      const mine = c.user === meId(b), nm = W.teamFull(b.pool.sport, d.pick);
      if (!mine && !confirm(`Enter ${nm} for ${nameOf(b, c.user)}?`)) return;
      return call("wn_pick", { p_pool: st.code, p_team: d.pick, p_for: mine ? null : c.user }, () => { st.msg = mine ? `You took the ${W.teamName(b.pool.sport, d.pick)}.` : `${nm} entered for ${nameOf(b, c.user)}.`; });
    }
    if ("undo" in d) { if (!confirm("Take back the last pick?")) return; return call("wn_undo", { p_pool: st.code }); }
    if (d.remove) { if (!confirm(`Remove ${nameOf(b, d.remove)} from the pool?`)) return; return call("wn_update", { p_pool: st.code, p_remove: d.remove }); }
    if ("leave" in d) { if (!confirm("Leave this pool?")) return; return call("wn_leave", { p_code: st.code }, () => { location.href = HERE; }); }
  });
  app.addEventListener("change", (e) => {
    const s = e.target.closest("select[data-per]");
    if (s) call("wn_update", { p_pool: st.code, p_per: +s.value });
  });
  app.addEventListener("submit", async (e) => {
    const f = e.target; e.preventDefault();
    const v = (n) => ((f.elements[n] && f.elements[n].value) || "").trim();
    st.msg = "";
    try {
      if (f.id === "pl-link") { await C.signIn(f.querySelector("input").value, location.href.split("#")[0]); st.msg = "Check your email for a sign-in link."; return render(); }
      if (f.id === "pl-pass") { await C.passwordSignIn(f.querySelector("#pl-login").value, f.querySelector("#pl-password").value); st.user = C.user(); return render(); }
      if (f.id === "wp-new") {
        const r = ok(await C.rpc("wn_create", { p_name: v("name"), p_sport: (f.querySelector("input[name=sport]:checked") || {}).value, p_per: +v("per") || 4, p_entry: v("entry") || null }));
        history.replaceState(null, "", `${HERE}?p=${r.id}`); st.code = r.id; st.invite = true; st.msg = "Your pool is ready. Invite people, then start the draft."; return render();
      }
      if (f.id === "wp-join") {
        const r = ok(await C.rpc("wn_join", { p_code: v("code"), p_entry: v("entry") || null }));
        history.replaceState(null, "", `${HERE}?p=${r.id}`); st.code = r.id; return render();
      }
      if (f.id === "wp-name") { ok(await C.rpc("wn_update", { p_pool: st.code, p_name: v("name") })); st.msg = "Saved."; return render(); }
      if (f.id === "wp-del") { ok(await C.rpc("wn_delete", { p_pool: st.code, p_confirm: v("code") })); location.href = HERE; return; }
    } catch (x) { fail(x); }
  });

  (function start() {
    const back = C.fromLink();
    if (back && back.user) st.user = back.user;
    st.user = C.user();
    render();
  })();
})();
