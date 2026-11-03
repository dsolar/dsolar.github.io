/* Your leagues: sign in with an emailed link, see the shared leagues you're in, start one, or join from an invite
   link (leagues.html?join=<id>&code=<invite>). The leagues themselves open in play.html. */
(function () {
  "use strict";
  const { sports: S, value: V, draft: F, ui: U, cloud: C } = window.FK;
  const { esc, $ } = U;
  const theme = U.theme("fk-lab");
  const params = new URLSearchParams(location.search);
  const joinId = params.get("join"), joinCode = params.get("code") || "";
  const top = $("#top"), app = $("#app");
  const link = C.fromLink();
  const SPORT_CLR = { nba: 4, nfl: 2, mlb: 0 };
  const BLURB = { nba: "Points or categories", nfl: "PPR, half or standard", mlb: "Roto or points" };
  let sent = null, busy = false, view = "list";
  const form = { sport: "nfl", teams: 10, type: "snake", clock: 90, season: "h2h", weeks: 14, trades: 1, scoring: "" };
  if (S.ALL[params.get("s")]) { form.sport = params.get("s"); view = "new"; }

  function header() {
    top.innerHTML = U.shell({ brand: { name: "Draft Lab", href: "./", mark: `<img src="mark.svg" alt="">` },
      tabs: [["draft", "Mock draft"], ["rankings", "Rankings"], ["league", "Demo league"], ["leagues", "Your leagues"], ["kit", "The kit"]], tab: "leagues",
      right: `${C.user() ? `<button class="btn sm ghost" data-a="out">Sign out</button>` : ""}<button class="btn sm ghost" data-theme>${theme.dark() ? "Light" : "Dark"}</button>`,
      hrefOf: (t) => (t === "leagues" ? "leagues.html" : t === "league" ? "league.html" : "./#" + t) });
  }
  const page = (html) => { app.innerHTML = `<div class="wrap page">${html}</div>`; };
  const fail = (msg) => `<div class="banner loss" role="alert"><b>${esc(msg)}</b></div>`;
  const back = () => location.origin + location.pathname + location.search;

  async function render() {
    header();
    const u = C.user();
    const err = link && link.error ? fail(`That sign-in link didn't work: ${link.error}. Send yourself a new one.`) : "";
    let invite = "";
    if (joinId) {
      const v = await C.rpc("fk_view", { p_id: joinId, p_since: null }).catch((e) => ({ error: e.message }));
      invite = v.error ? fail(v.error) : u ? joinCard(v) : `<div class="banner"><b>You're invited to ${esc(v.name)}</b> <span class="muted">a ${esc(S[v.sport].name.toLowerCase())} league with ${v.draft.teams.length} teams. Sign in to pick your team.</span></div>`;
    }
    if (!u) return page(`${err}${invite}${signInCard()}`);
    if (view === "new") return page(newForm());
    const mine = await C.rpc("fk_mine", {}).catch((e) => ({ error: e.message }));
    page(`${err}${invite}
      <div class="head"><h1 class="disp">Your leagues</h1><span class="ps">Signed in as ${esc(u.email)}</span><span class="grow"></span><button class="btn go" data-a="new">Start a league</button></div>
      ${mine.error ? fail(mine.error) : mine.length ? `<div class="lgl">${mine.map(card).join("")}</div>` : joinId ? "" : `<div class="card"><div class="bd stack"><p style="margin:0"><b>No leagues yet.</b></p><p class="ps" style="margin:0">Start one and send your friends the invite link, or open the invite link your commissioner sent you.</p><div><button class="btn go" data-a="new">Start a league</button></div></div></div>`}`);
  }
  const PHASE = { setup: "Draft room open", live: "Drafting now", done: "Draft done", season: "In season" };
  const card = (l) => `<a class="card lgc" href="play.html?id=${esc(l.id)}">${U.teamAv({ abbr: l.sport.toUpperCase(), color: SPORT_CLR[l.sport] }, "md")}
    <span class="grow"><b>${esc(l.name)}</b><small>${esc(S[l.sport].name)}, ${esc(PHASE[l.phase] || l.phase)}${l.commish ? ", you're the commissioner" : ""}</small></span><span class="btn sm">Open</span></a>`;

  function signInCard() {
    if (sent) return `<div class="card narrow"><div class="bd stack"><h1 class="disp" style="margin:0;font-size:32px">Check your email</h1>
      <p style="margin:0">We sent a sign-in link to <b>${esc(sent)}</b>. Open it on the phone or computer you want to play on. It works once and expires in an hour.</p>
      <p class="ps" style="margin:0">Nothing there after a minute? Check spam, or send it again.</p>
      <div class="row"><button class="btn" data-a="again">Use a different email</button><button class="btn ghost" data-a="resend">Send it again</button></div></div></div>`;
    return `<div class="hero"><h1 class="disp">Draft with<br>your friends.</h1><p>Start a league, send the invite link and draft live. Every move saves for the whole league, and you can get an email when a trade offer or a waiver result needs you.</p></div>
      <form class="card narrow" id="signin"><div class="bd stack">
        <div class="field"><label for="si-email">Email</label><input id="si-email" type="email" autocomplete="email" required value="${esc(C.lastEmail())}" placeholder="you@example.com"></div>
        <button class="btn go" type="submit"${busy ? " disabled" : ""}>Email me a sign-in link</button>
        <p class="ps" style="margin:0">No password. We'll email you a link that signs you in.</p></div></form>`;
  }

  function joinCard(v) {
    const teams = v.draft.teams, seats = v.seats || {};
    if (v.me != null) return `<div class="banner"><b>You're already in ${esc(v.name)}.</b> <a href="play.html?id=${esc(joinId)}">Open the league</a></div>`;
    const open = teams.map((t, i) => [t, i]).filter(([, i]) => seats[i] == null);
    if (!open.length) return fail(`Every team in ${v.name} has a manager.`);
    const u = C.user(), guess = (u.email.split("@")[0] || "").replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 24);
    return `<form class="card" id="join"><div class="mod-h"><h2>Join ${esc(v.name)}</h2><span class="ps">${esc(S[v.sport].name)}, ${teams.length} teams${v.draft.phase !== "setup" ? ". The draft has started, so you take over that team's picks." : ""}</span></div><div class="bd stack">
      <fieldset class="seats"><legend class="sr">Pick a team</legend>${teams.map((t, i) => `<label class="${seats[i] != null ? "taken" : ""}"><input type="radio" name="team" value="${i}"${seats[i] != null ? " disabled" : open[0][1] === i ? " checked" : ""}>${U.teamAv(t, "sm")}<span><b>${esc(t.name)}</b><small>${seats[i] != null ? esc(seats[i]) : "Open"}</small></span></label>`).join("")}</fieldset>
      <div class="field"><label for="j-name">Your name</label><input id="j-name" type="text" maxlength="24" required value="${esc(guess)}"></div>
      <div><button class="btn go" type="submit">Join the league</button></div></div></form>`;
  }

  function newForm() {
    const sp = S[form.sport];
    const scoring = sp.scorings[form.scoring] ? form.scoring : Object.keys(sp.scorings)[0];
    const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(l)}</option>`;
    const auction = form.type === "auction";
    const clocks = auction ? [[15, "15 seconds a bid"], [30, "30 seconds a bid"], [60, "1 minute a bid"]]
      : [[30, "30 seconds"], [60, "1 minute"], [90, "90 seconds"], [120, "2 minutes"], [3600, "1 hour (slow draft)"], [14400, "4 hours (slow draft)"], [28800, "8 hours (slow draft)"]];
    if (!clocks.some(([v]) => v === form.clock)) form.clock = clocks[auction ? 0 : 2][0];
    return `<div class="head"><h1 class="disp">Start a league</h1><span class="ps">You'll be the commissioner. You can invite everyone once it's made.</span></div>
      <form class="card form" id="new"><div class="bd stack">
        <div class="sports" role="radiogroup" aria-label="Sport">${Object.values(S.ALL).map((s) => `<label><input type="radio" name="sport" value="${s.key}"${s.key === form.sport ? " checked" : ""}><span><b class="disp">${esc(s.name)}</b><small>${esc(BLURB[s.key])}</small></span></label>`).join("")}</div>
        <div class="row3">
          <div class="field"><label for="n-name">League name</label><input id="n-name" type="text" maxlength="40" required value="${esc(form.name || "")}"></div>
          <div class="field"><label for="n-me">Your name</label><input id="n-me" type="text" maxlength="24" required value="${esc(form.me || "")}"></div>
          <div class="field"><label for="n-team">Your team's name</label><input id="n-team" type="text" maxlength="28" value="${esc(form.team || "")}" placeholder="Optional"></div>
        </div>
        <div class="row3">
          <div class="field"><label for="n-teams">Teams</label><select id="n-teams" data-f="teams">${[4, 6, 8, 10, 12, 14].map((n) => opt(n, n, form.teams)).join("")}</select></div>
          <div class="field"><label for="n-type">Draft</label><select id="n-type" data-f="type">${Object.entries(F.FORMATS).map(([k, l]) => opt(k, l, form.type)).join("")}</select></div>
          <div class="field"><label for="n-clock">${auction ? "Bid clock" : "Pick clock"}</label><select id="n-clock" data-f="clock">${clocks.map(([v, l]) => opt(v, l, form.clock)).join("")}</select></div>
        </div>
        <div class="row3">
          <div class="field"><label for="n-scoring">Scoring</label><select id="n-scoring" data-f="scoring">${Object.entries(sp.scorings).map(([k, s]) => opt(k, s.label.replace(/ \(.*\)$/, ""), scoring)).join("")}</select></div>
          <div class="field"><label for="n-season">Season</label><select id="n-season" data-f="season">${opt("h2h", "Head to head", form.season)}${opt("guillotine", "Best ball guillotine", form.season)}</select></div>
          ${form.season === "h2h" ? `<div class="field"><label for="n-weeks">Weeks before playoffs</label><select id="n-weeks" data-f="weeks">${[8, 10, 12, 14, 16].map((n) => opt(n, `${n} weeks`, form.weeks)).join("")}</select></div>`
            : `<div class="field"><label>Weeks</label><p class="ps" style="margin:6px 0 0">${form.teams - 1}: the lowest score is chopped each week</p></div>`}
        </div>
        ${!auction && form.type !== "mystery" && form.type !== "elephant" ? `<div class="row3"><div class="field"><label for="n-trades">Trades during the draft</label><select id="n-trades" data-f="trades">${opt(1, "Picks and players", form.trades)}${opt(0, "Off", form.trades)}</select></div></div>` : ""}
        <p class="ps" style="margin:0">Teams nobody has claimed draft on their own. Anyone with the invite link can take one over, even after the draft. ${form.clock >= 3600 ? "In a slow draft, managers who turn on email alerts get one when they're on the clock." : "If someone's clock runs out, the best player left is taken for them."}</p>
        <p class="ps" id="n-why" role="alert" style="margin:0;color:var(--loss)"></p>
        <div class="row"><button class="btn go" type="submit"${busy ? " disabled" : ""}>${busy ? "Making the league…" : "Make the league"}</button><button class="btn ghost" type="button" data-a="list">Cancel</button></div>
      </div></form>`;
  }
  // keep what's typed when a choice redraws the form
  function grab() {
    const f = $("#new"); if (!f) return;
    form.name = $("#n-name").value; form.me = $("#n-me").value; form.team = $("#n-team").value;
    const s = f.querySelector("input[name=sport]:checked"); if (s) form.sport = s.value;
    f.querySelectorAll("[data-f]").forEach((el) => { form[el.dataset.f] = /^(teams|clock|weeks|trades)$/.test(el.dataset.f) ? Number(el.value) : el.value; });
  }

  async function makeLeague() {
    grab();
    const why = (m) => { const el = $("#n-why"); if (el) el.textContent = m; };
    if (!form.name.trim()) return why("Give the league a name.");
    if (!form.me.trim()) return why("Add your name.");
    busy = true; render();
    try {
      const r0 = await fetch(`data/${form.sport}.json`, { cache: "no-cache" });
      const data = await r0.json();
      const sport = S.attach(Object.assign({}, S[form.sport]), data);
      const have = new Set(data.players.flatMap((p) => p.pos));
      const lineup = sport.lineup.filter((s) => sport.slots[s] === "*" || sport.slots[s].some((x) => have.has(x)));
      const players = data.players.map((p) => Object.assign({}, p));
      const scoring = sport.scorings[form.scoring] ? form.scoring : Object.keys(sport.scorings)[0];
      const n = form.teams, total = n * (lineup.length + sport.bench);
      V.evaluate(sport, players, { teams: n, lineup, bench: sport.bench, scoring });
      const auction = form.type === "auction";
      const D = F.create({ sport, type: form.type, teams: n, seed: Math.floor(Math.random() * 2 ** 31), now: Date.now(), lineup, bench: sport.bench, scoring,
        botDelay: 3000, clock: auction ? 0 : form.clock, bidClock: auction ? form.clock : 15, nomClock: 30, budget: 200, name: form.name.trim(),
        trades: form.trades !== 0, curve: form.type === "mystery" ? F.pickCurve(players, total) : null, reveal: form.type === "mystery" ? "own" : undefined });
      const tn = form.team.trim() || `${form.me.trim().split(" ")[0]}'s team`;
      D.teams[0].name = tn.slice(0, 28);
      D.teams[0].abbr = tn.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase() || "YOU";
      D.season = { format: form.season, weeks: form.weeks };
      const r = await C.rpc("fk_create", { p_name: form.name, p_sport: form.sport, p_manager: form.me, p_draft: D });
      if (r.error) throw new Error(r.error);
      location.href = `play.html?id=${encodeURIComponent(r.id)}#invite`;
    } catch (e) { busy = false; await render(); why(e.message); }
  }

  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === "signin") {
      const email = $("#si-email").value;
      busy = true;
      try { await C.signIn(email, back()); sent = email.trim(); } catch (err) { busy = false; render().then(() => U.toast(err.message, true)); return; }
      busy = false; render();
    } else if (f.id === "join") {
      const t = f.querySelector("input[name=team]:checked");
      if (!t) { U.toast("Pick a team", true); return; }
      const r = await C.rpc("fk_join", { p_id: joinId, p_invite: joinCode, p_team: Number(t.value), p_manager: $("#j-name").value }).catch((err) => ({ error: err.message }));
      if (r.error) { U.toast(r.error, true); return; }
      location.href = `play.html?id=${encodeURIComponent(joinId)}`;
    } else if (f.id === "new") makeLeague();
  });
  app.addEventListener("change", (e) => { if (e.target.closest("#new") && (e.target.name === "sport" || e.target.dataset.f)) { grab(); render(); } });
  document.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-a]"), th = e.target.closest("[data-theme]");
    if (th) { theme.toggle(); header(); return; }
    if (!a) return;
    const k = a.dataset.a;
    if (k === "out") { await C.signOut(); sent = null; render(); }
    else if (k === "again") { sent = null; render(); }
    else if (k === "resend") { try { await C.signIn(sent, back()); U.toast("Sent again."); } catch (err) { U.toast(err.message, true); } }
    else if (k === "new") { view = "new"; render(); }
    else if (k === "list") { view = "list"; render(); }
  });
  // a sign-in link opened in this same tab only changes the hash
  window.addEventListener("hashchange", () => { const l = C.fromLink(); if (l) { sent = null; if (l.error) U.toast(l.error, true); render(); } });
  render().catch((e) => page(fail(e.message)));
})();
