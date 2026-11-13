/* A shared league (play.html?id=<league>): the draft room until the draft is done, then the league pages.
   Everyone runs the same rules on their own page and saves the result with the version they started from
   (fk_save); if someone else saved first, the page takes their copy instead. Unclaimed teams are bots. Time moves
   the season the same way the demo leagues do, on whichever page is open, and each save says who to email. */
(function () {
  "use strict";
  const { sports: S, value: V, draft: F, league: G, season: Z, ui: U, cloud: C } = window.FK;
  const { esc, $ } = U;
  const theme = U.theme("fk-lab");
  const WEEK = 7 * 864e5;
  const SPORT_CLR = { nba: 4, nfl: 2, mlb: 0 };
  const id = new URLSearchParams(location.search).get("id");
  const link = C.fromLink();
  const now = () => C.now();
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  let info = null, D = null, L = null, version = 0, base = null;
  let data = null, sport = null, players = null, byId = {}, room = null, app = null, mode = null, mine = [], weeks = null, prospects = null, practice = null;
  // a trivia draft's questions, made by whichever page puts the pick on the clock
  // Loaded when needed, not with the page: the trivia bank (only a trivia draft asks questions) and the league pages
  // (not until the draft is over; they load in the background once the room is up). Same version as this file.
  const VER = (() => { try { return new URL(document.currentScript.src).searchParams.get("v") || "1"; } catch (e) { return "1"; } })();
  const loading = {};
  const need = (file) => (loading[file] = loading[file] || new Promise((ok, no) => {
    const el = document.createElement("script"); el.src = `${file}?v=${VER}`; el.onload = ok; el.onerror = () => { delete loading[file]; no(new Error(`Couldn't load ${file}`)); };
    document.head.appendChild(el);
  }));
  const triviaHook = (d, k) => (window.FK.trivia ? window.FK.trivia.make(sport, players, ((d.seed || 1) * 31 + k * 7919) >>> 0, d.trivia.used) : null);
  const hooks = () => ({ real: weeks, prospects, trivia: triviaHook });
  let rt = null;   // the realtime nudge socket (cloud.listen)
  let inflight = false, dirty = false, lastChange = Date.now(), userAt = 0, pollT = null;

  const fatal = (msg, more = "") => { document.body.classList.remove("fk-room"); $("#top").innerHTML = ""; $("#app").innerHTML = `<div class="wrap page"><div class="banner loss" role="alert"><b>${esc(msg)}</b> ${more}</div><p><a class="btn" href="leagues.html">Your leagues</a></p></div>`; };
  const seated = () => Object.keys(info.seats || {}).map(Number);
  const canAct = () => info && (info.me != null || info.commish);
  const teamName = (t) => { const doc = L || D; return doc && doc.teams[t] ? doc.teams[t].name : "A team"; };

  function take(v) {
    info = { me: v.me, commish: !!v.commish, seats: v.seats || {}, invite: v.invite, notify: v.notify, name: v.name, sport: v.sport, dues: v.dues };
    if (v.version != null) version = v.version;
    if ("draft" in v) {
      D = v.draft; L = v.league;
      if (D && D.teams) D.teams.forEach((t, i) => { if (t.color == null) t.color = (i * 5) % 12; });
      base = clone({ draft: D, league: L }); lastChange = Date.now();
    }
  }

  // Files load side by side. The league comes first (it says which sport), with that sport's player file already on
  // its way if this browser has opened the league before. The weekly box scores, the biggest file (1.3 MB for
  // baseball), are only waited for when something needs them now: a league in its season or a best ball draft's
  // values. A draft room opens without them, and the season waits for them before it starts (flush).
  const getJSON = (u) => fetch(u, { cache: "no-cache" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  let weeksP = null, weeksReady = null;
  const loadWeeks = () => (weeksReady = weeksReady || (weeksP || Promise.resolve(null)).then((w) => (weeks = w && data && String(w.season) === String(data.season) ? w : null)));
  async function boot() {
    if (!id) return fatal("This page needs a league link.", `<span class="muted">Open one from Your leagues.</span>`);
    const sk = `fk-sport:${id}`;
    let guess = null; try { guess = localStorage.getItem(sk); } catch (e) { /* private mode */ }
    const early = ["nba", "nfl", "mlb"].includes(guess) ? { k: guess, p: getJSON(`data/${guess}.json`) } : null;
    const v = await C.rpc("fk_view", { p_id: id, p_since: null });
    if (v.error) return fatal(v.error);
    take(v);
    try { localStorage.setItem(sk, info.sport); } catch (e) { /* private mode */ }
    document.title = `${info.name} | Draft Lab`;
    const k = info.sport;
    // a dynasty values players over the next five seasons (value.js), a redraft league this season only
    const dyn = !!((D.season && D.season.dynasty) || (L && L.settings.dynasty));
    // best ball (but not a guillotine, which keeps normal ranks) values upside and depth
    const bb = L ? !!L.settings.bestBall && L.settings.format !== "guillotine" : !!(D.season && D.season.bestBall && D.season.format !== "guillotine");
    const dataP = early && early.k === k ? early.p : getJSON(`data/${k}.json`);
    weeksP = getJSON(`data/weeks-${k}.json`);
    const extras = Promise.all([getJSON(`data/market-${k}.json`), dyn ? dynastyRanks(k) : null, dyn ? getJSON(`../draft/${k}.json`) : null]);
    data = await dataP;
    if (!data || !Array.isArray(data.players)) return fatal("Couldn't load the players.", `<span class="muted">Reload the page to try again.</span>`);
    sport = S.withScoring(S.attach(Object.assign({}, S[k]), data), D.scoringSpec);   // the league's custom scoring, if it has one
    if ((L && L.settings.confMax) || (D.season && D.season.confMax)) sport.conf = (L && L.settings.confMax) || D.season.confMax;
    // a showdown plays one game: its two teams are the whole player pool
    players = data.players.filter((p) => S.inPool(L || D, p)).map((p) => Object.assign({}, p));
    // a baseball league's own position eligibility thresholds (settings.elig)
    { const el = (L && L.settings.elig) || (D.season && D.season.elig); if (el && k === "mlb") S.applyElig(players, el); }
    // players the feed doesn't carry (a prospect, someone hurt all year) come with the league itself (doc.extraPlayers)
    { const hide = new Set((L && L.hidePlayers) || D.hidePlayers || []); if (hide.size) players = players.filter((p) => !hide.has(p.id)); }
    { const have = new Set(players.map((p) => p.id)), xs = (L && L.extraPlayers) || D.extraPlayers; if (Array.isArray(xs)) for (const x of xs) if (!have.has(x.id)) players.push(Object.assign({ l: {}, rank: 9999 }, x)); }
    if (L || bb) await loadWeeks();
    else loadWeeks().then((w) => { if (!w) return; if (mode === "league") mount(); livePoll(); });
    const [market, dr, pros] = await extras;
    V.evaluate(sport, players, { teams: D.teams.length, lineup: D.lineup, bench: D.bench, scoring: D.scoring, budget: D.auction ? D.auction.budget : 200, week: S.weekFor(L || D, sport), oneDay: !!S.dayOf(L || D), dynasty: dyn, dynastyRanks: dyn ? dr : null, bestBall: bb, weeks: bb ? weeks : null, market });
    // baseball ranks on next season's projections; last season's real ranks go beside them (p.crank, p.cprank)
    if (k === "mlb" && sport.data && sport.data.lines && sport.data.lines.pbat) {
      const cur = players.map((p) => ({ id: p.id, n: p.n, pos: p.pos, l: p.l, age: p.age }));
      V.evaluate(sport, cur, { teams: D.teams.length, lineup: D.lineup, bench: D.bench, scoring: D.scoring, projections: false });
      const by = Object.fromEntries(cur.map((c) => [c.id, c]));
      for (const p of players) { const c = by[p.id]; if (c && p.l && (p.l.bat || p.l.pit)) { p.crank = c.rank; p.cprank = c.prank; } }
    }
    byId = Object.fromEntries(players.map((p) => [p.id, p]));
    // a dynasty prices its rookie picks from next year's class on the Big Board
    if (dyn) prospects = S.prospectClass(pros, k);
    await Promise.all([D && D.trivia && !window.FK.trivia ? need("trivia.js").catch(() => null) : null, L && !U.leagueApp ? need("league-ui.js") : null]);
    livePoll();
    if (C.user()) C.rpc("fk_mine", {}).then((m) => { if (Array.isArray(m)) { mine = m; if (app) app.render(); } }).catch(() => {});
    mount();
    if (link && link.error) U.toast(`That sign-in link didn't work: ${link.error}`, true);
    if (location.hash === "#invite" && info.invite) { history.replaceState(null, "", location.pathname + location.search); inviteDialog(); }
    schedule();
    // live nudges: another page's or the clock's save, or a chat post, shows up at once instead of at the next poll
    if (C.listen && !rt) rt = C.listen(`fk:${id}`, (ev, x) => {
      if (ev === "save" && (x.v == null || x.v > version)) pull();
      else if (ev === "post") loadPosts();
    });
    // the league pages come next, so fetch them while the draft runs
    if (!U.leagueApp) setTimeout(() => need("league-ui.js").catch(() => {}), 3000);
  }

  /* ---------- the two views ---------- */
  const modeNow = () => (practice ? "practice" : L ? "league" : Z.sealedKind(D) ? "entry" : "draft");
  function mount() {
    // a reload on #practice picks the saved practice draft back up
    if (!practice && location.hash === "#practice" && L && seasonOver()) { try { const sv = JSON.parse(localStorage.getItem(PK) || "null"); if (sv && sv.D) practice = sv; } catch (e) { /* no storage */ } }
    if (modeNow() === "league" && !U.leagueApp) { need("league-ui.js").then(mount, (e) => fatal(e.message, `<span class="muted">Reload the page to try again.</span>`)); return; }
    mode = modeNow();
    if (room) { room.stop(); room = null; }
    if (mode === "practice") mountPractice(); else if (mode === "draft") mountRoom(); else if (mode === "entry") mountEntry(); else { mountLeague(); loadSeries(); }
  }
  // a salary cap game or a sealed draft: entries go to the server, hidden until the lock
  function mountEntry() {
    const kind = Z.sealedKind(D);
    $("#top").innerHTML = "";
    $("#app").innerHTML = `<div id="room"></div>${guestNote()}`;
    room = U.entryRoom({
      el: $("#room"), sport, players, draft: () => D, me: () => info.me, now,
      brand: { name: "Draft Lab", mark: `<img src="mark.svg" alt="">` }, exit: { href: "leagues.html", label: "Your leagues" },
      tools: () => `${info.invite ? `<button class="btn sm" data-live="invite">Invite</button>` : ""}<button class="btn sm${info.invite ? " ghost" : ""}" data-live="league">League</button>`,
      load: () => C.rpc("fk_seal_get", { p_id: id, p_kind: kind }),
      save: async (entry) => { const r = await C.rpc("fk_seal_set", { p_id: id, p_kind: kind, p_data: entry }); if (r && r.ok) pull(); return r; },
    });
    loadPosts();
    reveal();
  }
  // once entries lock, any manager's page opens them and builds the lineups or runs the draft (the clock does too)
  let revealing = false, revealT = null;
  async function reveal() {
    clearTimeout(revealT);
    const kind = Z.sealedKind(D);
    if (!kind || L) return;
    const wait = Z.sealedDue(D) - now();
    if (wait > 0) { revealT = setTimeout(reveal, Math.min(wait + 1500, 6 * 36e5)); return; }
    if (revealing || !canAct() || !C.user()) return;
    revealing = true;
    const r = await C.rpc("fk_seal_get", { p_id: id, p_kind: kind }).catch(() => null);
    revealing = false;
    if (!r || !r.open || Z.sealedKind(D) !== kind) { revealT = setTimeout(reveal, 5000); return; }
    if (Z.driveDraft(D, F.context(D, players, sport), now(), r.open)) push();
  }
  function refreshView() { if (mode !== modeNow()) mount(); else if (room) room.refresh(); else if (app) app.refresh(); }

  function mountRoom() {
    document.body.classList.add("fk-room");
    $("#top").innerHTML = "";
    $("#app").innerHTML = `<div id="room"></div>${guestNote()}`;
    room = U.room({
      el: $("#room"), sport, players, draft: () => D, save: () => push(), me: () => info.me, now, hooks: { trivia: triviaHook }, ...roomCols(),
      get commish() { return info.commish; }, get drive() { return driveOk(); },
      brand: { name: "Draft Lab", mark: `<img src="mark.svg" alt="">` }, exit: { href: "leagues.html", label: "Your leagues" },
      tools: () => `${info.invite ? `<button class="btn sm" data-live="invite">Invite</button>` : ""}<button class="btn sm${info.invite ? " ghost" : ""}" data-live="league">League</button>`,
      // heist moves are sealed on the server until everyone's in or the clock runs out
      heist: {
        lock: async (moves) => { const r = await C.rpc("fk_heist_lock", { p_id: id, p_moves: moves }); if (r && r.ok) pull(); return r; },
        get: () => C.rpc("fk_heist_get", { p_id: id }),
      },
      extra: () => (L ? "" : `<span class="ps">Setting up the season…</span>`),
      chat,
    });
    loadPosts();
  }
  // a league's draft room: no auction dollars unless it's an auction (the room shows them then anyway), and no value
  // column in a category league, where it only confuses
  function roomCols(d = D) {
    const sc = d && sport.scorings && sport.scorings[d.scoring];
    return { money: false, value: !(sc && sc.type === "cats") };
  }
  /* ---------- a practice draft: next season's real board, keepers and all, against bots, saved only here ---------- */
  const PK = "fk-practice:" + id;
  const practiceMe = () => (info.me != null ? info.me : 0);
  function practiceBuild() {
    const ctx = lctx(), picks = {};
    for (const t of L.teams) picks[t.id] = (L.next && L.next.picks && L.next.picks[t.id]) || Z.autoKeepers(L, ctx, t.id);
    const D2 = Z.nextDraft(L, ctx, sport, picks, { now: now() });
    // every team but yours is a bot; the clock is short so it moves
    D2.teams.forEach((t, i) => { t.owner = i === practiceMe() ? "you" : null; t.auto = false; });
    D2.botDelay = 1; D2.name = "Practice draft";
    return { D: D2, at: now(), me: practiceMe() };
  }
  function practiceSave() { try { localStorage.setItem(PK, JSON.stringify(practice)); } catch (e) { /* full or private: it lasts until you leave */ } }
  function practiceOpen(fresh) {
    let saved = null;
    if (!fresh) try { saved = JSON.parse(localStorage.getItem(PK) || "null"); } catch (e) { saved = null; }
    practice = saved && saved.D && saved.me === practiceMe() ? saved : practiceBuild();
    practiceSave(); history.replaceState(null, "", location.pathname + location.search + "#practice"); mount();
  }
  function practiceExit() { practice = null; history.replaceState(null, "", location.pathname + location.search + "#league"); mount(); }
  function mountPractice() {
    document.body.classList.add("fk-room");
    $("#top").innerHTML = "";
    $("#app").innerHTML = `<div id="room"></div>`;
    const P = practice;
    room = U.room({
      el: $("#room"), sport, players, draft: () => P.D, save: practiceSave, me: () => P.me, now, commish: true, solo: true, ...roomCols(P.D),
      get drive() { return !document.hidden; },
      brand: { name: "Practice draft", mark: `<img src="mark.svg" alt="">` },
      exit: { href: "#league", label: "Back to the league" },
      tools: () => `<span class="ps">Only you see this. Nothing counts.</span>`,
      extra: () => `<button class="btn sm" data-live="practice-new">Start over</button>`,
    });
  }
  function practiceLine() {
    if (!seasonOver() || L.settings.dynasty || !L.settings.keepers || !L.next) return "";
    return `<p class="small" style="margin:0"><b>Practice draft:</b> next season's board with everyone's keepers in (teams that haven't picked keep their best values), the real draft order and traded picks. Bots draft for everyone else. Only you see it. <button type="button" class="btn sm" data-live="practice">Practice the draft</button></p>`;
  }
  // the managers' photos (fk_faces), for members; your own profile to edit (fk_profile_me, fk_profile_set)
  let faces = {};
  async function loadFaces() {
    if (!C.user()) return;
    const r = await C.rpc("fk_faces", { p_id: id }).catch(() => null);
    if (r && r.ok) { faces = r.faces || {}; if (app) app.refresh(); }
  }
  async function editProfile() {
    const me = await C.rpc("fk_profile_me", {}).catch((e) => ({ error: e.message }));
    if (!me || me.error) { U.toast((me && me.error) || "Couldn't load your profile.", true); return; }
    U.profileDialog(me, async (v) => {
      const r = await C.rpc("fk_profile_set", { p_name: v.name, p_photo: v.photo });
      if (r && r.ok) { await loadFaces(); pull(); }
      return r;
    });
  }
  const oneWeekGame = () => !!(L && L.settings.weeks === 1 && L.draft && L.draft.season && L.draft.season.oneWeek);
  let series = null, seriesAsked = false;
  async function loadSeries() {
    if (seriesAsked || !oneWeekGame() || !C.user()) return;
    seriesAsked = true;
    const r = await C.rpc("fk_series", { p_id: id }).catch(() => null);
    if (r && r.ok) { series = r; if (app) app.refresh(); }
  }
  // someone already ran it back: go straight there; otherwise pick next week's games
  async function rematchGo() {
    const r = series || (await C.rpc("fk_series", { p_id: id }).catch(() => null));
    const weeks = (r && r.weeks) || [], me = weeks.find((w) => w.id === id), next = me && weeks.find((w) => w.n === me.n + 1);
    location.href = next ? `play.html?id=${encodeURIComponent(next.id)}` : `leagues.html?rematch=${encodeURIComponent(id)}`;
  }
  function mountLeague() {
    document.body.classList.remove("fk-room");
    app = U.leagueApp({
      top: $("#top"), el: $("#app"), sport, players, league: () => L, save: () => push(), me: () => info.me, now, frac, hooks: hooks(),
      brand: { name: "Draft Lab", href: "leagues.html", mark: `<img src="mark.svg" alt="">` },
      switcher: () => U.switcher({ name: L.name, crest: U.leagueCrest(U.leagueBrand(L.name, L.settings.brand), "sm") },
        mine.filter((m) => m.id !== id).map((m) => ({ href: `play.html?id=${encodeURIComponent(m.id)}`, name: m.name, sub: S[m.sport].name, crest: U.leagueCrest(U.leagueBrand(m.name, m.brand), "sm") })),
        `<a href="leagues.html">Your leagues<small>Start or join a league</small></a><a href="./">Draft Lab<small>Mock drafts and rankings</small></a>`),
      right: () => `${info.invite && openSeats() ? `<button class="btn sm" data-live="invite">Invite</button>` : ""}<button class="btn sm ghost" data-live="league">League</button>`,
      get commishTools() { return info.commish ? commishTools : null; },
      notice: () => guestNote() + duesNote() + startNote() + keeperNote(),
      get dues() { return info.dues !== undefined && (duesOn() || info.commish) ? duesBody : null; },
      get invite() { return info.invite ? openSeats() : null; },
      chat,
      history: () => past,
      faces: () => faces,
      editProfile: C.user() ? editProfile : null,
      // one-week games: run it back next week with the same group, and the series so far
      get rematch() { return L && oneWeekGame() && info.me != null ? rematchGo : null; },
      series: () => series,
    });
    loadPosts();
    loadPast();
    loadFaces();
    if (catchUp()) push();
    app.refresh();
  }
  // past seasons for the History page, loaded once (a first-season league has none)
  let past = null, pastAsked = false;
  function loadPast() {
    if (pastAsked || !(L && L.draft && L.draft.year > 1)) return;
    pastAsked = true;
    C.rpc("fk_history", { p_id: id }).then((h) => { if (Array.isArray(h)) { past = h; if (app && !U.dialogOpen()) app.refresh(); } }).catch(() => { pastAsked = false; });
  }
  // Outside dynasty rankings (data/dynasty-<sport>.json, rebuilt daily by tools/dynasty_pull.py), when there are any.
  const dynastyRanks = (k) => fetch(`data/dynasty-${k}.json`, { cache: "no-cache" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  /* ---------- live box scores: every minute while the page is open and the league plays on real games ---------- */
  let liveT = null;
  async function livePoll() {
    clearTimeout(liveT);
    if (weeks && !document.hidden && (!L || L.settings.real)) {
      const lv = await C.live(info.sport);
      // this week's kickoff times go with the league, so every page and the clock lock players when their games start
      const kicked = L && canAct() && G.setKicks(L, lv);
      if (kicked) push();
      // a one-day league scores its own games: their box scores and whether they're final
      const ids = Z.slateGames && Z.slateGames(L);
      const gm = ids ? await C.games(info.sport, ids) : null;
      const gch = !!(gm && Z.mergeGames(weeks, gm));
      if (gch && L && canAct() && catchUp()) push();
      if ((Z.mergeLive(weeks, lv) || kicked || gch) && app && !U.dialogOpen()) { app.refresh(); }
    }
    liveT = setTimeout(livePoll, document.hidden ? 5 * 60e3 : 60e3);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && weeks) livePoll(); });
  /* ---------- league chat: posts load every few seconds while the page is open ---------- */
  let posts = [], postT = null, seen = 0;
  try { seen = Number(localStorage.getItem("fk-chat-seen:" + id)) || 0; } catch (e) { /* no storage */ }
  const lastId = () => (posts.length ? posts[posts.length - 1].id : 0);
  const chat = {
    posts: () => posts,
    unread: () => posts.filter((p) => p.id > seen && p.team !== info.me).length,
    seen: () => { const n = lastId(); if (n > seen) { seen = n; try { localStorage.setItem("fk-chat-seen:" + id, String(n)); } catch (e) { /* no storage */ } } },
    async send(body) {
      const r = await C.rpc("fk_post", { p_id: id, p_body: body });
      if (r && r.post && !posts.some((p) => p.id === r.post.id)) posts.push(r.post);
      if (r && r.ok) chat.seen();
      return r;
    },
  };
  async function loadPosts() {
    clearTimeout(postT);
    if (!document.hidden && (L || D)) {
      const r = await C.rpc("fk_posts", { p_id: id, p_after: lastId() }).catch(() => null);
      if (Array.isArray(r) && r.length) {
        const have = new Set(posts.map((p) => p.id));
        posts = posts.concat(r.filter((p) => !have.has(p.id))).slice(-300);
        if (!U.dialogOpen()) { if (room) room.render(); else if (app) app.refresh(); }
      }
    }
    clearTimeout(postT);   // a nudge can start a second load while one is out: still one timer
    postT = setTimeout(loadPosts, document.hidden ? 60000 : rt && rt.live() ? 45000 : 10000);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && (L || D)) loadPosts(); });
  // before week 1: when it starts
  function startNote() {
    if (!L || now() >= L.start) return "";
    // once, where it matters: the overview and your roster (not on every page)
    if (!/^#?(league(\/overview)?|team(\/roster)?)?$/.test(location.hash)) return "";
    const d = new Date(L.start).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `<div class="wrap" style="padding-top:12px"><div class="banner"><b>Week 1 starts ${esc(d)}.</b> <span class="muted">Until then, set your lineup, work the waiver wire and make trades.</span></div></div>`;
  }
  function guestNote() {
    if (info.me != null || info.commish) return "";
    const msg = C.user() ? "You don't have a team in this league. Ask the commissioner for the invite link." : "You're looking as a guest.";
    return `<div class="wrap" style="padding-top:12px"><div class="banner"><b>${esc(msg)}</b> ${C.user() ? "" : `<a href="leagues.html">Sign in</a> <span class="muted">to make moves.</span>`}</div></div>`;
  }
  /* ---------- dues: the buy-in, where to pay, the payout plan and who's paid. Money moves outside Draft Lab;
     this is the commissioner's ledger. A manager taps "I sent it", the commissioner confirms. ---------- */
  const PAYOUTS = { wta: ["Winner takes all", [100]], p7030: ["70 / 30", [70, 30]], p603010: ["60 / 30 / 10", [60, 30, 10]], p502030: ["50 / 30 / 20", [50, 30, 20]] };
  const PLACES = ["Champion", "Runner-up", "Third place"];
  const dues = () => info.dues || {};
  const duesOn = () => Number(dues().amount) > 0;
  const docTeams = () => (L || D ? (L || D).teams : []);
  const regWeeks = () => (L ? L.settings.weeks : (D && D.season && D.season.weeks) || 14);
  const handle = (s) => String(s || "").trim().replace(/^@|^\$|^(https?:\/\/)?(www\.)?(paypal\.me|venmo\.com|cash\.app)\/(u\/)?\$?/i, "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
  function duesMath() {
    const d = dues(), n = docTeams().length, pot = (Number(d.amount) || 0) * n;
    const high = Math.min(Number(d.high) || 0, Math.floor(pot / Math.max(1, regWeeks()))), highTotal = high * regWeeks();
    const left = pot - highTotal, split = (PAYOUTS[d.payout] || PAYOUTS.p603010)[1];
    // whole $5s, with what's left over going to the champion
    const places = split.map((p) => Math.floor(left * p / 100 / 5) * 5);
    places[0] += left - places.reduce((a, b) => a + b, 0);
    return { pot, high, highTotal, places };
  }
  /* A league's own payouts (dues.prizes): any list of { kind: "playoff" | "season" | "weekly" | "other", place, amount,
     label }. "playoff" pays a place in the final finish (1 the champion), "season" a place in the regular-season
     standings, "weekly" the top score each regular-season week (amount is per week), "other" anything the league names
     (most trades, last place's punishment fund). Without prizes, the preset split (dues.payout) stands. */
  const PRIZE_KINDS = [["playoff", "Playoff finish"], ["season", "Regular-season record"], ["weekly", "Top score each week"], ["other", "Something else"]];
  const placeWord = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
  const prizeLabel = (x) => x.kind === "playoff" ? ({ 1: "Champion", 2: "Runner-up", 3: "Third place" }[x.place] || `${placeWord(x.place)} place`) : x.kind === "season" ? `${placeWord(x.place)} best regular-season record` : x.kind === "weekly" ? "Top score each week" : x.label || "Prize";
  const prizeTotal = (x) => (x.kind === "weekly" ? (Number(x.amount) || 0) * regWeeks() : Number(x.amount) || 0);
  // who won a prize, once it's decided (a finished season, or regular-season places once the regular season is over)
  function prizeWinner(x) {
    if (!L) return null;
    try {
      if (x.kind === "playoff" && L.week > G.totalWeeks(L)) { const sm = G.summary(L), r = sm.standings.find((y) => y.place === x.place); return r ? r.team : null; }
      if (x.kind === "season" && L.week > L.settings.weeks) { const st = L.imported && L.imported.regular ? L.imported.regular : G.standings(L); const r = st[x.place - 1]; return r ? r.team : null; }
    } catch (e) { /* not decided */ }
    return null;
  }
  const paidN = () => docTeams().filter((t, i) => (dues().paid || {})[i]).length;
  const duesLine = () => (duesOn() ? `Dues: ${paidN()} of ${docTeams().length} paid` : "Set up dues");
  const statusOfDues = (i) => ((dues().paid || {})[i] ? "paid" : (dues().claimed || {})[i] ? "sent" : "owed");
  function payButtons() {
    const d = dues(), p = d.pay || {}, amt = Number(d.amount) || 0, note = encodeURIComponent(`${info.name} dues`);
    const out = [];
    if (p.venmo) out.push(`<a class="btn go" target="_blank" rel="noopener" href="https://venmo.com/${encodeURIComponent(p.venmo)}?txn=pay&amount=${amt}&note=${note}">Pay $${amt} with Venmo</a>`);
    if (p.paypal) out.push(`<a class="btn${out.length ? "" : " go"}" target="_blank" rel="noopener" href="https://paypal.me/${encodeURIComponent(p.paypal)}/${amt}">PayPal</a>`);
    if (p.cashapp) out.push(`<a class="btn${out.length ? "" : " go"}" target="_blank" rel="noopener" href="https://cash.app/$${encodeURIComponent(p.cashapp)}/${amt}">Cash App</a>`);
    return out.join("");
  }
  // the dues page: shows the same in the League > Dues tab and in a dialog from the draft room
  function duesBody() {
    const d = dues(), teams = docTeams(), m = duesMath(), mine = info.me;
    if (!duesOn()) return info.commish
      ? `<div class="card"><div class="bd stack"><p style="margin:0"><b>No dues yet.</b></p><p class="ps" style="margin:0">Set the buy-in, where to send it and how the pot pays out. Managers see what they owe and tap "I sent it", and you mark who's paid. Money moves through Venmo, PayPal, Cash App or Zelle, not Draft Lab.</p><div><button type="button" class="btn go" data-dues="edit">Set up dues</button></div></div></div>`
      : `<div class="card"><div class="bd"><p class="ps" style="margin:0">This league doesn't have dues set up.</p></div></div>`;
    const p = d.pay || {}, st = mine != null ? statusOfDues(mine) : null, due = d.due ? d.due[0].toLowerCase() + d.due.slice(1) : "";
    const you = mine == null || info.commish ? "" : st === "paid" ? `<div class="dues-you paid"><b>You're paid up.</b><span class="ps">The commissioner marked your $${d.amount} as received.</span></div>`
      : st === "sent" ? `<div class="dues-you sent"><b>You said you sent it.</b><span class="ps">Waiting for the commissioner to confirm.</span><button type="button" class="btn sm ghost" data-dues="unclaim">I haven't sent it</button></div>`
      : `<div class="dues-you owed"><b>You owe $${d.amount}.</b>${due ? `<span class="ps">Due ${esc(due)}.</span>` : ""}<div class="row" style="gap:8px;flex-wrap:wrap">${payButtons()}${p.zelle ? `<button type="button" class="btn" data-dues="zelle">Zelle: ${esc(p.zelle)}</button>` : ""}</div><button type="button" class="btn sm" data-dues="claim">I sent it</button></div>`;
    const rows = teams.map((t, i) => { const s = statusOfDues(i); return `<li>${U.teamAv(t, "sm")}<span class="grow"><b>${esc(t.name)}</b><small>${esc(info.seats[i] || "Open seat")}</small></span>${s === "paid" ? `<span class="tag win">Paid</span>` : s === "sent" ? `<span class="tag gold">Sent</span>` : `<span class="tag">Not yet</span>`}${info.commish ? `<button type="button" class="btn sm ghost" data-dues="mark" data-team="${i}">${s === "paid" ? "Undo" : "Mark paid"}</button>` : ""}</li>`; }).join("");
    const payTo = [p.venmo && `Venmo @${esc(p.venmo)}`, p.paypal && `PayPal paypal.me/${esc(p.paypal)}`, p.cashapp && `Cash App $${esc(p.cashapp)}`, p.zelle && `Zelle ${esc(p.zelle)}`].filter(Boolean);
    return `<div class="dues">
      <div class="card"><div class="mod-h"><h2>$${d.amount} buy-in</h2><span class="ps">$${m.pot} pot, ${paidN()} of ${teams.length} paid</span>${info.commish ? `<button type="button" class="btn sm" data-dues="edit" style="margin-left:auto">Edit dues</button>` : ""}</div>
        <div class="bd stack">${you}
          <dl class="kv">${Array.isArray(d.prizes) && d.prizes.length ? d.prizes.map((x) => { const w = prizeWinner(x); return `<dt>${esc(prizeLabel(x))}</dt><dd class="num">$${Number(x.amount) || 0}${x.kind === "weekly" ? ` a week, $${prizeTotal(x)} in all` : ""}${w != null && teams[w] ? ` <span class="tag win">${esc(teams[w].name)}</span>` : ""}</dd>`; }).join("") + (() => { const tot = d.prizes.reduce((a, x) => a + prizeTotal(x), 0); return tot !== m.pot && info.commish ? `<dt>Check</dt><dd class="loss">Prizes add up to $${tot}, the pot is $${m.pot}</dd>` : ""; })()
            : `${m.places.map((x, i) => `<dt>${PLACES[i]}</dt><dd class="num">$${x}</dd>`).join("")}${m.high ? `<dt>High score each week</dt><dd class="num">$${m.high} a week, $${m.highTotal} in all</dd>` : ""}`}${payTo.length ? `<dt>Send it to</dt><dd>${payTo.join("<br>")}</dd>` : ""}${d.due ? `<dt>Due</dt><dd>${esc(d.due)}</dd>` : ""}${d.note ? `<dt>Notes</dt><dd>${esc(d.note)}</dd>` : ""}</dl>
        </div></div>
      <div class="card"><div class="mod-h"><h2>Who's paid</h2></div><ul class="seatl dues-l">${rows}</ul></div></div>`;
  }
  function duesDialog() { U.dialog(`<h3>Dues</h3><div id="fk-dues">${duesBody()}</div>`, null, { wide: true }); }
  function duesRefresh() { const el = $("#fk-dues"); if (el) el.innerHTML = duesBody(); if (app && !U.dialogOpen()) app.render(); }
  async function duesSave(patch, msg) {
    const r = await C.rpc("fk_dues_set", { p_id: id, p_dues: patch }).catch((e) => ({ error: e.message }));
    if (!r || r.error) { U.toast((r && r.error) || "Couldn't save the dues.", true); return false; }
    info.dues = r.dues; duesRefresh(); if (msg) U.toast(msg); return true;
  }
  function prizeRow(x) {
    const o = (v, label, cur) => `<option value="${v}"${String(cur) === String(v) ? " selected" : ""}>${label}</option>`;
    return `<div class="du-row"><select data-p="kind" aria-label="Prize for">${PRIZE_KINDS.map(([k, lab]) => o(k, lab, x.kind)).join("")}</select>
      <select data-p="place" aria-label="Place"${x.kind === "weekly" || x.kind === "other" ? " hidden" : ""}>${Array.from({ length: Math.max(3, docTeams().length) }, (_, i) => o(i + 1, placeWord(i + 1), x.place || 1)).join("")}</select>
      <input data-p="label" type="text" maxlength="40" placeholder="What it's for" value="${esc(x.label || "")}"${x.kind === "other" ? "" : " hidden"}>
      <span class="row" style="gap:4px">$<input data-p="amount" type="number" min="0" max="100000" step="5" value="${Number(x.amount) || 0}" style="width:6.5em" aria-label="Amount"></span>
      <button type="button" class="btn sm ghost" data-du-del aria-label="Remove this prize">Remove</button></div>`;
  }
  function duesEdit() {
    const d = dues(), p = d.pay || {};
    const o = (v, label, cur) => `<option value="${v}"${String(cur) === String(v) ? " selected" : ""}>${label}</option>`;
    U.dialog(`<h3>Dues</h3><form id="dues-f" class="stack">
      <div class="g2"><div class="field"><label for="du-amt">Buy-in per team</label><div class="row" style="gap:6px"><span>$</span><input id="du-amt" type="number" min="0" max="10000" step="5" value="${Number(d.amount) || 50}" style="flex:1"></div></div>
        <div class="field"><label for="du-due">Due</label><select id="du-due">${["Before the draft", "By week 1", "By week 2", "By week 4"].map((x) => o(x, x, d.due || "Before the draft")).join("")}</select></div></div>
      <div class="g2"><div class="field"><label for="du-pay">The pot pays</label><select id="du-pay">${Object.entries(PAYOUTS).map(([k, [lab]]) => o(k, lab, d.payout || "p603010")).join("")}${o("custom", "My own prizes", Array.isArray(d.prizes) && d.prizes.length ? "custom" : d.payout || "p603010")}</select></div>
        <div class="field du-high-f"><label for="du-high">High score each week</label><select id="du-high">${[0, 5, 10, 20, 25].map((x) => o(x, x ? `$${x} a week, from the pot` : "No weekly prize", d.high || 0)).join("")}</select></div></div>
      <div class="du-prizes stack" style="gap:8px"${Array.isArray(d.prizes) && d.prizes.length ? "" : " hidden"}>
        <div class="du-rows stack" style="gap:6px">${(Array.isArray(d.prizes) && d.prizes.length ? d.prizes : [{ kind: "playoff", place: 1, amount: 0 }]).map(prizeRow).join("")}</div>
        <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><button type="button" class="btn sm" data-du-add>Add a prize</button><span class="ps du-sum"></span></div></div>
      <p class="ps" style="margin:0">Where managers send it. Fill in any you use: each one becomes a pay button with the amount filled in.</p>
      <div class="g2"><div class="field"><label for="du-venmo">Venmo username</label><input id="du-venmo" type="text" maxlength="40" placeholder="@yourname" value="${esc(p.venmo || "")}"></div>
        <div class="field"><label for="du-paypal">PayPal.me name</label><input id="du-paypal" type="text" maxlength="40" placeholder="yourname" value="${esc(p.paypal || "")}"></div></div>
      <div class="g2"><div class="field"><label for="du-cash">Cash App $cashtag</label><input id="du-cash" type="text" maxlength="40" placeholder="$yourname" value="${esc(p.cashapp || "")}"></div>
        <div class="field"><label for="du-zelle">Zelle email or phone</label><input id="du-zelle" type="text" maxlength="60" value="${esc(p.zelle || "")}"></div></div>
      <div class="field"><label for="du-note">Notes</label><input id="du-note" type="text" maxlength="140" placeholder="Optional, like who holds the money" value="${esc(d.note || "")}"></div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn go" type="submit">Save dues</button>${duesOn() ? `<button type="button" class="btn ghost" data-dues="reset">Clear who's paid</button><button type="button" class="btn ghost warn" data-dues="off">Turn off dues</button>` : ""}</div></form>`, null, { wide: true });
    const f = $("#dues-f");
    const sync = () => {
      const custom = $("#du-pay").value === "custom";
      f.querySelector(".du-prizes").hidden = !custom; f.querySelector(".du-high-f").hidden = custom;
      for (const r of f.querySelectorAll(".du-row")) { const k = r.querySelector("[data-p=kind]").value; r.querySelector("[data-p=place]").hidden = k === "weekly" || k === "other"; r.querySelector("[data-p=label]").hidden = k !== "other"; }
      const pot = (Math.round(Number($("#du-amt").value) || 0)) * docTeams().length;
      const tot = [...f.querySelectorAll(".du-row")].reduce((a, r) => { const amt = Number(r.querySelector("[data-p=amount]").value) || 0; return a + (r.querySelector("[data-p=kind]").value === "weekly" ? amt * regWeeks() : amt); }, 0);
      f.querySelector(".du-sum").innerHTML = tot === pot ? `Adds up to the $${pot} pot.` : `<b class="loss">$${tot} of the $${pot} pot</b>`;
    };
    f.addEventListener("input", sync); f.addEventListener("change", sync);
    f.addEventListener("click", (e) => {
      if (e.target.closest("[data-du-add]")) { f.querySelector(".du-rows").insertAdjacentHTML("beforeend", prizeRow({ kind: "playoff", place: f.querySelectorAll(".du-row").length + 1, amount: 0 })); sync(); }
      const del = e.target.closest("[data-du-del]"); if (del) { del.closest(".du-row").remove(); sync(); }
    });
    sync();
    $("#dues-f").onsubmit = async (e) => {
      e.preventDefault();
      const amount = Math.max(0, Math.min(10000, Math.round(Number($("#du-amt").value) || 0)));
      const zelle = $("#du-zelle").value.replace(/[<>]/g, "").trim().slice(0, 60);
      const custom = $("#du-pay").value === "custom";
      const prizes = custom ? [...document.querySelectorAll("#dues-f .du-row")].map((r) => {
        const v = (k) => r.querySelector(`[data-p=${k}]`).value, kind = v("kind");
        return Object.assign({ kind, amount: Math.max(0, Math.min(100000, Math.round(Number(v("amount")) || 0))) }, kind === "playoff" || kind === "season" ? { place: Number(v("place")) } : {}, kind === "other" ? { label: v("label").replace(/[<>]/g, "").trim().slice(0, 40) } : {});
      }).filter((x) => x.amount > 0) : [];
      const ok = await duesSave({ amount, due: $("#du-due").value, payout: custom ? "custom" : $("#du-pay").value, prizes, high: custom ? 0 : Number($("#du-high").value), note: $("#du-note").value.replace(/[<>]/g, "").trim().slice(0, 140),
        pay: { venmo: handle($("#du-venmo").value), paypal: handle($("#du-paypal").value), cashapp: handle($("#du-cash").value), zelle } }, amount ? "Dues saved. Managers see what they owe." : "Saved.");
      if (ok) duesDialog();
    };
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-dues]");
    if (!b) return;
    const k = b.dataset.dues;
    if (k === "edit" && info.commish) duesEdit();
    else if (k === "mark" && info.commish) {
      const t = b.dataset.team, paid = Object.assign({}, dues().paid || {}), claimed = Object.assign({}, dues().claimed || {});
      if (paid[t]) delete paid[t]; else { paid[t] = Date.now(); delete claimed[t]; }
      duesSave({ paid, claimed });
    } else if (k === "claim" || k === "unclaim") {
      const r = await C.rpc("fk_dues_claim", { p_id: id, p_on: k === "claim" }).catch((err) => ({ error: err.message }));
      if (!r || r.error) U.toast((r && r.error) || "Couldn't save that.", true);
      else { info.dues = r.dues; duesRefresh(); U.toast(k === "claim" ? "Thanks. The commissioner will confirm it." : "Got it."); }
    } else if (k === "zelle") { try { await navigator.clipboard.writeText(dues().pay.zelle); U.toast("Copied. Paste it in Zelle."); } catch (err) { U.toast(dues().pay.zelle); } }
    else if (k === "reset" && info.commish) U.confirm("Clear who's paid?", "Everyone goes back to owing, like the start of a new season.", "Clear it", async () => { if (await duesSave({ paid: {}, claimed: {} }, "Cleared.")) duesDialog(); });
    else if (k === "off" && info.commish) U.confirm("Turn off dues?", "The buy-in and who's paid are cleared for everyone.", "Turn off dues", () => duesSave({ amount: 0, paid: {}, claimed: {} }, "Dues are off."));
  });
  // a reminder for a manager who owes, on the league's overview
  function duesNote() {
    if (!duesOn() || info.me == null || statusOfDues(info.me) !== "owed" || !app || !/^#?(league(\/overview)?)?$/.test(location.hash)) return "";
    return `<div class="wrap" style="padding-top:12px"><div class="banner"><b>You owe $${dues().amount} in dues.</b> <span class="muted">${dues().due ? `Due ${esc(dues().due[0].toLowerCase() + dues().due.slice(1))}.` : ""}</span> <button class="btn sm go" data-live="dues">Pay</button></div></div>`;
  }
  const frac = (w) => Math.max(0, Math.min(1, (now() - G.weekStart(L, w)) / Math.max(36e5, G.weekStart(L, w + 1) - G.weekStart(L, w))));

  // The commissioner's page runs bots and the clock. Anyone else's page steps in when that's five seconds late,
  // so the draft keeps moving when the commissioner's page is closed.
  function driveOk() {
    // the heist: the commissioner's page settles it, or anyone's once its clock is five seconds past
    if (D && D.phase === "heist" && canAct()) return info.commish || now() > D.heist.ends + 5000 || F.heistFoe(D, info.me) != null && F.heistDue(D, now());
    // a draft set for a time: any manager's page starts it once the time comes
    if (D && D.phase === "setup" && D.startAt && canAct()) return now() >= D.startAt;
    if (!D || D.phase !== "live" || !canAct()) return false;
    if (D.paused) return !!D.hold;                     // a draft held for a trade offer: any page can let it go on
    if (info.commish) return true;
    if (D.type === "auction") return Date.now() - lastChange > 8000;
    const c = F.onClock(D, now());
    if (!c) return false;
    // a bot's pick: any page makes it a moment after it's due (with live nudges, everyone sees it at once, and the save
    // order settles a tie); a manager's expired clock still waits five seconds for the commissioner's page
    const bot = F.isBot(D.teams[c.team]), at = bot ? D.clockStart + D.botDelay : c.deadline;
    return now() > at + (bot && rt && rt.live() ? 1200 : 5000);
  }

  /* ---------- the season (season.js) ---------- */
  // a season in progress is scored on real box scores; out of season it's simulated
  function beginSeason() { L = Z.begin(D, sport, { name: info.name, season: data.season, now: now(), real: weeks || false }); }
  const catchUp = () => (L ? Z.catchUp(L, G.context(L, players, sport, hooks()), now()) : false);
  const events = (b, c) => Z.events(b, c, { name: info.name, url: location.origin + location.pathname + "?id=" + encodeURIComponent(id), seats: info.seats, me: info.me, byId, now: now() });

  /* ---------- saving ---------- */
  ["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, () => (userAt = Date.now()), true));
  function push() {
    if (!canAct()) return;
    dirty = true; lastChange = Date.now();
    if (!inflight) flush();
  }
  async function flush() {
    if (!dirty) return;
    dirty = false; inflight = true;
    if (D && D.phase === "done" && !L) { await loadWeeks(); if (!L) beginSeason(); }
    const mineMove = Date.now() - userAt < 2500;
    const cur = { draft: D, league: L }, sent = clone(cur);
    let r;
    try {
      r = await C.rpc("fk_save", { p_id: id, p_version: version, p_draft: base && base.league ? null : D, p_league: L, p_events: events(base, cur) });
    } catch (e) {
      inflight = false; dirty = true;
      U.toast(`Couldn't save: ${e.message}. Trying again.`, true);
      setTimeout(flush, 5000);
      return;
    }
    inflight = false;
    if (r.ok) {
      version = r.version; base = sent;
      if (dirty) flush(); else if (mode !== modeNow()) mount();
      return;
    }
    if (r.error === "stale") {
      D = r.draft; L = r.league; version = r.version; base = clone({ draft: D, league: L }); dirty = false; lastChange = Date.now();
      refreshView();
      if (mineMove) U.toast("Someone else moved first, so this reloaded. Check it and try again.", true);
      return;
    }
    U.toast(r.error, true);
    // A rejected game-time move must not remain visible or be retried with a later save.
    if (base) { D = clone(base.draft); L = clone(base.league); }
    dirty = false; version = -1; refreshView();
    pull();
  }
  async function pull() {
    if (inflight || dirty) return;
    let v;
    try { v = await C.rpc("fk_view", { p_id: id, p_since: version }); } catch (e) { return; }
    if (!v || v.error || inflight || dirty) return;
    const wasMe = info.me, wasCommish = info.commish;
    const before = { offers: myOffers(), week: L ? L.week : 0, phase: D && D.phase };
    take(v);
    refreshInvite();
    if ("draft" in v) {
      refreshView();
      if (L && myOffers().some((t) => !before.offers.includes(t))) U.toast("You have a new trade offer. It's at the top of the page.");
      else if (L && before.week && L.week !== before.week) U.toast(`On to week ${Math.min(L.week, G.totalWeeks(L))}.`);
      else if (D && before.phase === "setup" && D.phase === "live") U.toast("The draft started.");
    } else if (wasMe !== info.me || wasCommish !== info.commish) refreshView();
    if (L && catchUp()) { push(); if (app) app.refresh(); }
  }
  const myOffers = () => (L && info.me != null ? L.trades.filter((t) => t.status === "pending" && t.to === info.me).map((t) => t.id) : []);
  function schedule() {
    clearTimeout(pollT);
    const live = D && D.phase === "live" && !L;
    // with live nudges coming in, polling is only a backstop
    const rtOn = rt && rt.live();
    const ms = document.hidden ? 30000 : live ? (rtOn ? 12000 : 2500) : !L ? (rtOn ? 20000 : 6000) : rtOn ? 60000 : 20000;
    pollT = setTimeout(async () => {
      const busy = U.dialogOpen() || document.querySelector("details[open]") || (document.activeElement && /^(fk-q|INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.id || document.activeElement.tagName));
      if (!busy || (live && !L) || $("#lv-seats")) await pull();
      if (mode === "entry") reveal();
      schedule();
    }, ms);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { pull(); schedule(); } });

  /* ---------- the league dialog: invite link, managers, email alerts ---------- */
  function inviteUrl() { return `${location.origin}${location.pathname.replace(/play\.html$/, "leagues.html")}?join=${encodeURIComponent(id)}&code=${encodeURIComponent(info.invite || "")}`; }
  function seatList() {
    const doc = L || D;
    return `<ul class="seatl" id="lv-seats">${doc.teams.map((t, i) => `<li>${U.teamAv(t, "sm")}<span class="grow"><b>${esc(t.name)}</b><small>${info.seats[i] != null ? esc(info.seats[i]) : L || (D && D.phase !== "setup") ? "Open: a bot runs it until someone joins" : "Open: a bot drafts it if no one joins"}</small></span>${info.commish && info.seats[i] != null && i !== 0 && i !== info.me ? `<button type="button" class="btn sm ghost" data-free="${i}">Free this team</button>` : ""}${info.commish && info.seats[i] == null && !L && D && D.phase === "setup" && doc.teams.length > 2 ? `<button type="button" class="btn sm ghost" data-lv="rmteam" data-team="${i}" title="The league drops to ${doc.teams.length - 1} teams">Remove team</button>` : ""}</li>`).join("")}</ul>`;
  }
  const openSeats = () => { const doc = L || D; return doc ? doc.teams.filter((t, i) => info.seats[i] == null).length : 0; };
  const inviteMsg = () => { const n = openSeats(); return `Join ${info.name}, my ${S[info.sport].name.toLowerCase()} league on Draft Lab.${n ? ` ${n} team${n > 1 ? "s" : ""} left.` : ""} ${inviteUrl()}`; };
  function inviteHead() {
    const doc = L || D, n = openSeats();
    return `<p class="muted" id="lv-open" style="margin:0 0 10px">${n ? `<b>${n} of ${doc.teams.length} teams are open.</b> ` : `<b>Every team has a manager.</b> `}Anyone with the link signs in with their email, picks an open team and names it${L ? ", even mid-season" : ""}.</p>`;
  }
  // inviting: one tap to text, email or share the link; the seats below fill in as people join
  function inviteDialog() {
    if (!info.invite) { leagueDialog(); return; }
    const share = typeof navigator.share === "function";
    U.dialog(`<h3>Invite managers to ${esc(info.name)}</h3>
      ${inviteHead()}
      <div class="inv-share">${share ? `<button type="button" class="btn go" data-lv="share">Share the invite</button>` : ""}<a class="btn${share ? "" : " go"}" href="sms:?&body=${encodeURIComponent(inviteMsg())}">Text it</a><a class="btn" href="mailto:?subject=${encodeURIComponent(`Join ${info.name} on Draft Lab`)}&body=${encodeURIComponent(inviteMsg())}">Email it</a><button type="button" class="btn" data-lv="copy">Copy the link</button></div>
      <input type="text" readonly value="${esc(inviteUrl())}" id="lv-link" class="inv-link" aria-label="Invite link">
      <h4 style="margin:14px 0 6px">Teams</h4>
      ${seatList()}
      ${info.commish && D && !L && D.phase === "setup" ? `<div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px"><span class="ps">Teams can change until the draft starts.</span><span class="grow"></span>${D.type !== "auction" && D.type !== "mystery" && !D.carry && !(D.board || []).some((pk) => pk && pk.keeper) ? `<button type="button" class="btn sm" data-lv="order">Draft order</button>` : ""}${D.teams.length < 20 ? `<button type="button" class="btn sm" data-lv="addteam">Add a team</button>` : ""}</div>` : ""}`, null, { wide: true });
    dialogClicks($("#fk-dlg"));
  }
  function refreshInvite() {
    const ls = $("#lv-seats"), oh = $("#lv-open");
    if (ls) ls.outerHTML = seatList();
    if (oh) oh.outerHTML = inviteHead();
  }
  function leagueDialog() {
    const u = C.user();
    U.dialog(`<h3>${esc(info.name)}</h3>
      ${info.invite ? `<div class="row" style="gap:8px;flex-wrap:wrap;margin:0 0 6px"><button type="button" class="btn sm" data-lv="invite">Invite managers${openSeats() ? ` (${openSeats()} open)` : ""}</button>${info.dues !== undefined ? `<button type="button" class="btn sm" data-lv="dues">${duesLine()}</button>` : ""}</div>` : ""}
      ${info.commish && D && !L && D.phase === "setup" ? `<div class="field" style="margin-top:4px"><label for="lv-dt">Draft time</label><div class="row" style="gap:8px;flex-wrap:wrap"><input id="lv-dt" type="datetime-local" value="${D.startAt ? new Date(D.startAt - new Date(D.startAt).getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : ""}" style="flex:1 1 200px"><button type="button" class="btn sm" data-lv="dt">${D.startAt ? "Change it" : "Set it"}</button>${D.startAt ? `<button type="button" class="btn sm ghost" data-lv="dt-off">I'll start it</button>` : ""}</div><p class="ps" style="margin:4px 0 0">${D.startAt ? "It starts on its own then, with an email to everyone an hour before." : "Set a time and it starts on its own, with an email to everyone an hour before."}</p></div>` : ""}
      ${info.commish && D && !L && D.phase !== "done" && D.trading ? `<div class="field" style="margin-top:10px"><label for="lv-oh">A trade offer stops the clock</label><select id="lv-oh">${opt("clock", "When it's to the team on the clock", D.offerHold || "clock")}${opt("all", "For any manager, up to 90 seconds", D.offerHold || "clock")}${opt("off", "Never: the draft keeps going", D.offerHold || "clock")}</select></div>` : ""}
      <div id="lv-past"></div>
      ${info.me != null && C.user() ? `<div id="lv-push" style="margin-top:12px"></div>` : ""}
      ${info.me != null ? `<label class="check" style="margin-top:10px"><input type="checkbox" id="lv-mail"${info.notify !== false ? " checked" : ""}> Email me about trade offers, waiver results${D && D.clock >= 3600 ? ", my turn in the draft" : ""} and weekly results</label>` : ""}
      <div class="row ps" style="margin:12px 0 0;gap:6px 16px;flex-wrap:wrap"><span>${u ? `Signed in as ${esc(u.email)}` : `<a href="leagues.html">Sign in</a> to make moves`}</span><span class="grow"></span>${info.commish && !L ? `<button type="button" class="btn sm ghost warn" data-lv="delete">Delete league</button>` : ""}${u ? `<button type="button" class="btn sm ghost" data-lv="out">Sign out</button>` : ""}<button type="button" class="btn sm ghost" data-lv="theme">${theme.dark() ? "Light mode" : "Dark mode"}</button></div>`, null, { wide: true });
    const dlg = $("#fk-dlg");
    dialogClicks(dlg);
    U.pushBox($("#lv-push"), true);
    // past seasons, newest first; most leagues have none yet, so this stays empty until there are
    if ((D && D.year > 1) || (L && L.draft && L.draft.year > 1)) C.rpc("fk_history", { p_id: id }).then((h) => {
      const el = $("#lv-past"); if (!el || !Array.isArray(h) || !h.length) return;
      el.innerHTML = `<h4 style="margin:14px 0 6px">Past seasons</h4><ul class="seatl">${h.slice().reverse().map((x) => `<li><span class="grow"><b>Year ${esc(x.year)}${x.season ? `, ${esc(x.season)}` : ""}</b><small>${x.champion ? `Champion: ${esc(x.champion.name)}${x.champion.owner ? ` (${esc(x.champion.owner)})` : ""}` : "No champion"}</small></span></li>`).join("")}</ul>`;
    }).catch(() => {});
    dlg.onchange = async (e) => {
      if (e.target.id === "lv-oh") { D.offerHold = e.target.value; push(); U.toast("Saved."); return; }
      if (e.target.id !== "lv-mail") return;
      const on = e.target.checked;
      const r = await C.rpc("fk_notify", { p_id: id, p_on: on }).catch((err) => ({ error: err.message }));
      if (r.error) { U.toast(r.error, true); e.target.checked = !on; } else { info.notify = on; U.toast(on ? "Email alerts are on." : "Email alerts are off."); }
    };
  }
  function dialogClicks(dlg) {
    dlg.onclick = async (e) => {
      const b = e.target.closest("[data-lv],[data-free]");
      if (!b) return;
      if (b.dataset.lv === "copy") { try { await navigator.clipboard.writeText(inviteUrl()); } catch (err) { const el = $("#lv-link"); if (el) { el.select(); document.execCommand("copy"); } } U.toast("Invite link copied"); }
      else if (b.dataset.lv === "share") { try { await navigator.share({ title: `Join ${info.name}`, text: inviteMsg().replace(inviteUrl(), "").trim(), url: inviteUrl() }); } catch (err) { /* closed the share sheet */ } }
      else if (b.dataset.lv === "invite") { dlg.close(); inviteDialog(); }
      else if (b.dataset.lv === "dt" && info.commish && D && D.phase === "setup") {
        const t = new Date(($("#lv-dt") || {}).value || "").getTime();
        if (!Number.isFinite(t) || t < now() + 2 * 6e4) { U.toast("Pick a time that's still to come.", true); return; }
        const sl = D.season && (D.season.slate || D.season.showdown), first = sl ? sl.first || sl.at : null;
        if (first && t >= first) { U.toast("The draft has to start before the first kickoff.", true); return; }
        D.startAt = t; delete D.reminded; push(); dlg.close(); U.toast(`The draft starts ${new Date(t).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}. Everyone gets an email.`); refreshView();
      }
      else if (b.dataset.lv === "dt-off" && info.commish && D && D.phase === "setup") { delete D.startAt; delete D.reminded; push(); dlg.close(); U.toast("You'll start the draft from the room."); }
      else if (b.dataset.lv === "dues") { dlg.close(); duesDialog(); }
      else if (b.dataset.lv === "out") { await C.signOut(); location.reload(); }
      else if (b.dataset.lv === "theme") { theme.toggle(); b.textContent = theme.dark() ? "Light mode" : "Dark mode"; if (app) app.render(); }
      else if (b.dataset.lv === "addteam") { dlg.close(); resizeTeams(null); }
      else if (b.dataset.lv === "order") { dlg.close(); orderDialog(); }
      else if (b.dataset.lv === "rmteam") { const t = Number(b.dataset.team); dlg.close(); U.confirm(`Remove ${teamName(t)}?`, "The league drops to one fewer team. You can add one back until the draft starts.", "Remove the team", () => resizeTeams(t)); }
      else if (b.dataset.lv === "delete") { dlg.close(); deleteDialog(); }
      else if (b.dataset.free != null) {
        const t = Number(b.dataset.free);
        dlg.close();
        U.confirm(`Free ${teamName(t)}?`, `${esc(info.seats[t])} loses the team, and a bot runs it until someone else claims it with the invite link.`, "Free the team", async () => {
          const r = await C.rpc("fk_leave", { p_id: id, p_team: t }).catch((err) => ({ error: err.message }));
          if (r.error) U.toast(r.error, true); else { U.toast("Done. The team is open."); version = -1; pull(); }
        });
      }
    };
  }
  /* ---------- the next season: keepers, then a new draft ---------- */
  const seasonOver = () => L && L.week > G.totalWeeks(L);
  const lctx = () => G.context(L, players, sport, hooks());
  // keeper picks: open until L.next.due, then locked for managers (the commissioner can still set anyone's)
  const keepDue = () => (L && L.next && L.next.due) || null;
  const keepLocked = () => !!keepDue() && now() >= keepDue();
  const whenTxt = (t) => new Date(t).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  function keeperNote() {
    if (!seasonOver() || !L.next || info.me == null || !L.settings.keepers) return "";
    const mine = L.next.picks && L.next.picks[info.me], lock = keepLocked();
    const left = keepDue() && !lock ? keepDue() - now() : 0, soon = left && left < 2 * 864e5 ? ` That's ${left < 36e5 ? "less than an hour" : `${Math.round(left / 36e5)} hours`} from now.` : "";
    return `<div class="wrap" style="padding-top:12px"><div class="banner${lock ? "" : " go"}"><b>${lock ? (mine ? `Keepers are locked. You kept ${mine.length}.` : "Keepers are locked.") : mine ? `You're keeping ${mine.length} for next season.` : "Pick your keepers for next season."}</b> <span class="muted">${lock ? `The deadline was ${esc(whenTxt(keepDue()))}.` : `Up to ${L.settings.keepers}${keepDue() ? `, by ${esc(whenTxt(keepDue()))}.${soon}` : "."}`}</span> <button class="btn sm${lock ? "" : " go"}" data-live="keepers">${lock ? "See your keepers" : mine ? "Change keepers" : "Pick keepers"}</button> <button class="btn sm ghost" data-live="practice">Practice the draft</button></div></div>`;
  }
  // a team's keepers: every player with his cost (or why he can't be kept), and where the picks land in the draft
  function keeperDialog(teamId = info.me) {
    const asCommish = teamId !== info.me || (info.commish && keepLocked()), ro = keepLocked() && !info.commish;
    const ctx = lctx(), opts = Z.keeperOptions(L, ctx, teamId), max = L.settings.keepers, t = L.teams[teamId];
    const cur = (L.next.picks && L.next.picks[teamId]) || (ro ? Z.keepersOf(L, ctx, teamId) : []);
    const ok = opts.filter((o) => !o.no), no = opts.filter((o) => o.no);
    const auction = L.draft && L.draft.type === "auction";
    // each player: his season in a few categories, his rank and the round that rank goes in, what he'd cost, and the
    // bargain: how many rounds earlier he'd go than he costs
    const n = L.teams.length, yr = (data && data.season) || L.season || "";
    const keyCats = { bat: ["r", "hr", "rbi", "sb", "avg"], pit: ["w", "k", "sv", "era", "whip"] };
    const statsOf = (p) => {
      const g = p.l && p.l.pit && !(p.l && p.l.bat) ? "pit" : p.l && p.l.bat ? "bat" : null;
      if (!g || !sport.cols || !sport.cols[g]) return "";
      return keyCats[g].filter((c) => sport.cols[g][c] != null).map((c) => { const v = S.stat(sport, p, g, c); const f = /^(avg|obp|ops)$/.test(c) ? S.fmt.r3 : /^(era|whip)$/.test(c) ? S.fmt.f2 : S.fmt.f0; return `<span><small>${c.toUpperCase()}</small>${v == null ? "-" : f(v)}</span>`; }).join("");
    };
    const row = (o) => {
      const p = ctx.byId[o.pid] || {}, vr = p.rank ? Math.ceil(p.rank / n) : null, gain = !o.no && o.cost.round != null && vr != null ? o.cost.round - vr : null;
      return `<li class="kp-r${o.no ? " kp-no" : ""}"><label class="check kp-who"><input type="checkbox" name="k" value="${esc(o.pid)}"${cur.includes(o.pid) ? " checked" : ""}${o.no || ro ? " disabled" : ""}><span class="ell"><b>${esc(o.n)}</b><small>${esc(S.positions(p).join(", ") || o.pos)} ${esc(p.t || "")}</small></span></label>
        <span class="kp-st" aria-label="${esc(yr)} stats">${statsOf(p)}</span>
        <span class="kp-rk" title="Rank in this league's categories, and the round a player at that rank goes in">${p.rank ? `#${p.rank}<small>plays like Rd ${vr}</small>` : ""}</span>
        <span class="kp-cost">${o.no ? `<small>${esc(o.cost.label)}</small>` : `<b>${o.cost.round != null ? `Round ${o.cost.round}${o.cost.year ? ` <em>year ${o.cost.year}</em>` : ""}` : esc(o.cost.label)}</b>${gain != null ? `<small class="${gain > 0 ? "win" : gain < 0 ? "loss" : ""}">${gain > 0 ? `${gain} round${gain === 1 ? "" : "s"} of value` : gain < 0 ? `${-gain} round${gain === -1 ? "" : "s"} over` : "about even"}</small>` : ""}`}</span>
        <span class="kp-at" data-kp="${esc(o.pid)}"></span></li>`;
    };
    U.dialog(`<h3>${teamId === info.me ? "Your keepers" : `Keepers for ${esc(t.name)}`}</h3>
      <p class="muted" style="margin:0 0 10px">${ro ? `The deadline passed ${esc(whenTxt(keepDue()))}, so these are set.` : `Keep up to ${max}. Each costs ${auction ? "the price shown, out of next year's budget" : "the pick shown in next year's draft"}.${L.settings.keeperRule ? " A second keeper in a round you have one pick in moves up a round." : ""}${keepDue() ? ` Picks lock ${esc(whenTxt(keepDue()))}.` : ""}`}${asCommish && !ro ? " You're setting these as the commissioner." : ""}</p>
      <form class="kp-f"><div class="kp-hd" aria-hidden="true"><span>Player</span><span>${esc(String(yr))} stats</span><span>Rank</span><span>Cost</span><span></span></div><ul class="seatl kp">${ok.map(row).join("")}</ul>
      ${no.length ? `<details class="kp-nos"><summary>${no.length} can't be kept</summary><ul class="seatl kp">${no.map(row).join("")}</ul></details>` : ""}
      <p class="kp-why" role="status"></p>
      <div class="acts">${ro ? `<button type="button" class="btn" data-close>Close</button>` : `${asCommish ? `<button type="button" class="btn ghost" data-kp-clear>Clear (use the deadline rule)</button><span class="grow"></span>` : ""}<button type="button" class="btn" data-close>Cancel</button><button class="btn go">Save keepers</button>`}</div></form>`, ro ? null : (fd) => {
      const ks = fd.getAll("k"), plan = Z.keeperPlan(L, teamId, ks);
      if (!plan.ok) { U.toast(plan.why, true); return false; }
      L.next.picks = Object.assign({}, L.next.picks, { [teamId]: ks });
      // a readable copy for the league's keeper sheet: name, the round he lands in, year kept, and whether the
      // commissioner set it (the sheet marks those with an asterisk, as it always has)
      L.next.list = Object.assign({}, L.next.list, { [teamId]: plan.rows.map((x) => [(ctx.byId[x.pid] || {}).n || x.pid, x.round, x.cost.year || null, teamId !== info.me]) });
      push(); setTimeout(() => app.refresh(), 0);
      U.toast(`${teamId === info.me ? "" : `${t.name}: `}${ks.length ? `keeping ${ks.length}.` : "keeping nobody."}`.replace(/^k/, "K"));
    }, { wide: true });
    const f = $(".kp-f"); if (!f) return;
    // the rounds as they'd land, and anything that breaks the rules, as boxes are checked
    const draw = () => {
      const ks = [...f.querySelectorAll("input[name=k]:checked")].map((x) => x.value), plan = Z.keeperPlan(L, teamId, ks);
      f.querySelectorAll("[data-kp]").forEach((el) => { const r = plan.rows.find((x) => x.pid === el.dataset.kp); el.innerHTML = r && r.round != null ? `<span class="tag${r.moved ? " loss" : " win"}">${auction ? `$${r.cost.price}` : `Rd ${r.round}`}</span>` : ""; el.title = r && r.moved ? `Moves up from round ${r.cost.round}` : ""; });
      const moved = plan.rows.filter((x) => x.moved);
      $(".kp-why", f).innerHTML = !plan.ok ? `<b class="loss">${esc(plan.why)}.</b>` : `${ks.length} of ${max} keepers.${moved.length ? ` ${moved.map((x) => `${esc((lctx().byId[x.pid] || {}).n || "")} moves up to round ${x.round}`).join("; ")}.` : ""}`;
      const go = f.querySelector(".btn.go"); if (go) go.disabled = !plan.ok;
    };
    f.addEventListener("change", draw); draw();
    const clr = f.querySelector("[data-kp-clear]");
    if (clr) clr.addEventListener("click", () => { const p = Object.assign({}, L.next.picks); delete p[teamId]; L.next.picks = p; if (L.next.list) { const q = Object.assign({}, L.next.list); delete q[teamId]; L.next.list = q; } push(); app.refresh(); U.dialogClose && U.dialogClose(); const dl = $("#fk-dlg"); if (dl) dl.close(); U.toast(`${t.name} goes back to the deadline rule.`); });
  }
  // the commissioner opens keeper picks with a deadline, and what happens to a team that misses it
  function keeperOpenDialog() {
    const due = keepDue() || (() => { const d = new Date(now() + 7 * 864e5); d.setHours(23, 59, 0, 0); return d.getTime(); })();
    const local = (t) => { const d = new Date(t), z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
    U.dialog(`<h3>${L.next ? "Keeper deadline" : "Open keeper picks"}</h3><form class="stack">
      <label class="cm-l"><span>Keepers lock at</span><input type="datetime-local" name="due" value="${local(due)}" required></label>
      <fieldset class="kp-miss"><legend>A team that misses the deadline</legend>
        <label class="check"><input type="radio" name="missed" value="none"${(L.next && L.next.missed) !== "auto" ? " checked" : ""}> Keeps nobody</label>
        <label class="check"><input type="radio" name="missed" value="auto"${L.next && L.next.missed === "auto" ? " checked" : ""}> Keeps its best values</label></fieldset>
      <p class="small muted" style="margin:0">${L.next ? "Changing the deadline reopens picks if it moves later." : "Every manager gets an email and a phone alert to pick up to " + L.settings.keepers + "."} You can set any team's keepers yourself, before or after.</p>
      <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">${L.next ? "Save the deadline" : "Open keeper picks"}</button></div></form>`, (fd) => {
      const t = new Date(fd.get("due")).getTime();
      if (!Number.isFinite(t)) { U.toast("Pick a date and time.", true); return false; }
      const opening = !L.next;
      L.next = Object.assign({ opened: now(), picks: {} }, L.next || {}, { due: t, missed: fd.get("missed") === "auto" ? "auto" : "none" });
      push(); setTimeout(() => app.refresh(), 0);
      U.toast(opening ? "Keeper picks are open. Everyone gets an email." : `Keepers lock ${whenTxt(t)}.`);
    });
  }
  // next season's draft order, set by the commissioner (after a lottery, say); without it, worst to first
  function orderDialog() {
    const n = L.teams.length, cur = L.nextOrder && L.nextOrder.length === n ? L.nextOrder : G.standings(L).map((r) => r.team).reverse();
    U.dialog(`<h3>Next season's draft order</h3><form class="stack ord-f">
      <p class="small muted" style="margin:0">Round 1, first pick to last. Later rounds snake from it${L.picks && Object.keys(L.picks).length ? ", and traded picks go to the teams that hold them" : ""}.</p>
      <ol class="ord-l">${cur.map((t, i) => `<li><label class="sr" for="ord-${i}">Pick ${i + 1}</label><span class="num">${i + 1}</span><select id="ord-${i}" name="p${i}">${L.teams.map((x) => `<option value="${x.id}"${x.id === t ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></li>`).join("")}</ol>
      <p class="ord-why loss" role="status"></p>
      <div class="acts">${L.nextOrder ? `<button type="button" class="btn ghost" data-ord-clear>Use worst to first</button><span class="grow"></span>` : ""}<button type="button" class="btn" data-close>Cancel</button><button class="btn go">Save the order</button></div></form>`, (fd) => {
      const order = Array.from({ length: n }, (_, i) => Number(fd.get("p" + i)));
      if (new Set(order).size !== n) { U.toast("Each team picks once in round 1.", true); return false; }
      L.nextOrder = order; push(); setTimeout(() => app.refresh(), 0);
      U.toast(`${L.teams[order[0]].name} picks first.`);
    });
    const f = $(".ord-f"); if (!f) return;
    f.addEventListener("change", () => {
      const v = [...f.querySelectorAll("select")].map((x) => x.value), dup = v.filter((x, i) => v.indexOf(x) !== i);
      $(".ord-why", f).textContent = dup.length ? `${[...new Set(dup)].map((x) => L.teams[+x].name).join(", ")} ${dup.length > 1 ? "are" : "is"} in there twice.` : "";
    });
    const clr = f.querySelector("[data-ord-clear]");
    if (clr) clr.addEventListener("click", () => { delete L.nextOrder; push(); const dl = $("#fk-dlg"); if (dl) dl.close(); setTimeout(() => app.refresh(), 0); U.toast("Back to worst to first."); });
  }
  function nextSeasonCard() {
    if (!seasonOver()) return "";
    const k = L.settings.keepers || 0;
    if (k && !L.next) return `<div class="card"><div class="mod-h"><h2>Next season</h2></div><div class="bd stack"><p class="small" style="margin:0">The season is over. Open keeper picks with a deadline: every manager gets an email and picks up to ${k}.</p><div><button class="btn go" data-live="open-keepers">Open keeper picks</button></div></div></div>`;
    const doc = L, picks = (L.next && L.next.picks) || {}, lock = keepLocked(), auto = L.next && L.next.missed === "auto";
    const status = (t) => picks[t.id] ? `Keeping ${picks[t.id].length}` : info.seats[t.id] == null ? (auto ? "Open seat: keeps its best values" : "Open seat: keeps nobody") : lock ? (auto ? "Missed the deadline: keeps its best values" : "Missed the deadline: keeps nobody") : "Hasn't picked yet";
    const rows = doc.teams.map((t) => `<li>${U.teamAv(t, "sm")}<span class="grow"><b>${esc(t.name)}</b><small>${status(t)}</small></span>${k ? `<button type="button" class="btn sm ghost" data-kp-team="${t.id}">${picks[t.id] ? "Change" : "Set"}</button>` : ""}</li>`).join("");
    return `<div class="card"><div class="mod-h"><h2>Next season</h2>${k && L.next ? `<button type="button" class="btn sm" data-live="open-keepers" style="margin-left:auto">Deadline</button>` : ""}</div><div class="bd stack">
      <p class="small" style="margin:0">${L.settings.dynasty ? `The season is over. Starting next season saves this one to the league's history. Every roster carries over, and a ${L.settings.dynasty.rounds}-round rookie and free agent draft opens, worst team first${G.pickRounds(L) ? ", with traded picks going to the teams that hold them" : ""}. Until then, trades stay open.` : `${k ? (lock ? `Keepers locked ${esc(whenTxt(keepDue()))}.` : `Keeper picks are open until ${esc(whenTxt(keepDue()))}.`) : "The season is over."} Starting next season saves this one to the league's history and opens a new draft room${k ? " with the keepers on the board" : ""}.`}</p>
      ${k ? `<ul class="seatl">${rows}</ul>` : ""}
      ${L.settings.dynasty ? "" : L.settings.draftOrder === "lottery" ? lotteryLine() : `<p class="small" style="margin:0"><b>Draft order:</b> ${L.nextOrder ? `set by you, ${esc(L.teams[L.nextOrder[0]].name)} first` : "worst to first, unless you set it"}. <button type="button" class="btn sm ghost" data-live="draft-order">${L.nextOrder ? "Change" : "Set the order"}</button></p>`}
      ${practiceLine()}
      <div><button class="btn go" data-live="new-season">Start next season's draft</button></div></div></div>`;
  }
  // settings.draftOrder "lottery": the commissioner runs the draw once, and everyone sees how it came out
  function lotteryLine() {
    const lt = L.lottery;
    if (!lt || !L.nextOrder) return `<p class="small" style="margin:0"><b>Draft order:</b> a lottery for the ${L.teams.length - Math.min(L.settings.playoffTeams || 0, L.teams.length)} teams that missed the playoffs (${L.settings.lotteryOdds === "weighted" ? "more chances for worse records" : "equal odds"}), then the playoff teams in reverse order of finish. <button type="button" class="btn sm go" data-live="lottery">Run the lottery</button></p>`;
    return `<div class="stack" style="gap:6px"><p class="small" style="margin:0"><b>Draft order:</b> set by the lottery ${esc(U.ago(lt.at, now()))}. <button type="button" class="btn sm ghost" data-live="draft-order">Adjust</button></p><ol class="lot-o">${L.nextOrder.map((t, i) => `<li${i < lt.drawn.length ? ` class="lot"` : ""}>${U.teamAv(L.teams[t], "sm")}<span>${esc(L.teams[t].name)}</span>${i < lt.drawn.length ? `<small>Lottery</small>` : ""}</li>`).join("")}</ol></div>`;
  }
  function runLottery() {
    U.confirm("Run the draft lottery?", "It draws the order for every team that missed the playoffs, saves it for the whole league and shows how it came out. You can still adjust the order after.", "Run it", () => {
      const r = G.draftLottery(L, Math.random, now());
      if (!r.ok) { U.toast(r.why, true); return; }
      push(); if (app) app.refresh();
      U.toast(`${L.teams[r.order[0]].name} picks first.`);
    });
  }
  async function newSeason() {
    const D2 = Z.nextDraft(L, lctx(), sport, (L.next && L.next.picks) || {}, { now: now() });
    const evs = events(clone({ draft: D, league: L }), { draft: D2, league: null });
    const r = await C.rpc("fk_new_season", { p_id: id, p_version: version, p_draft: D2, p_summary: Z.summary(L), p_events: evs }).catch((e) => ({ error: e.message }));
    if (r.error === "stale") { U.toast("Someone else saved first. Try again.", true); version = -1; pull(); return; }
    if (r.error) { U.toast(r.error, true); return; }
    version = r.version; D = D2; L = null; base = clone({ draft: D, league: null });
    app = null; mount();
    U.toast("Next season's draft room is open.");
  }
  /* ---------- commissioner tools ---------- */
  const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(l)}</option>`;
  function commishTools() {
    const card = (title, body, btn) => `<div class="card"><div class="mod-h"><h2>${title}</h2></div><div class="bd stack">${body}${btn ? `<div class="row" style="flex-wrap:wrap">${btn}</div>` : ""}</div></div>`;
    const s = L ? L.settings : {};
    const trades = L ? L.trades.filter((t) => t.status === "accepted").slice(-12).reverse() : [];
    return `<div class="head"><h1 class="disp">Commissioner</h1><span class="ps">Every change here saves for the whole league and shows up in its transactions.</span></div>
      ${nextSeasonCard()}
      <div class="cols2">
        ${card("Invite and dues", `<p class="small" style="margin:0">${openSeats() ? `${openSeats()} team${openSeats() > 1 ? "s are" : " is"} open. ` : ""}Anyone with the invite link can sign in and take an open team, even mid-season.${duesOn() ? ` Dues: ${paidN()} of ${docTeams().length} paid.` : ""}</p>`, `<button class="btn go" data-live="invite">Invite managers</button><button class="btn" data-live="dues">${duesOn() ? "Dues" : "Set up dues"}</button>`)}
        <div class="card"><div class="mod-h"><h2>Managers</h2></div><div class="bd">${seatList()}</div></div>
      </div>
      ${L ? `<div class="cols2">
        ${card("League rules", `<dl class="kv"><dt>Waivers</dt><dd>${s.waivers === "rolling" ? "Rolling priority" : `FAAB, $${s.faab}`}, ${G.waiverDays(L)} business day${G.waiverDays(L) === 1 ? "" : "s"}${G.gameLockOn(L) ? ", locked once his game starts" : ""}</dd><dt>Trades</dt><dd>${s.trades === false ? "Off" : `${s.deadline ? `Deadline after week ${s.deadline}` : "No deadline"}, ${{ none: "no review", counter: `${s.reviewHours}-hour counter window`, commish: "commissioner review", vote: "league vote" }[s.tradeReview] || "league review"}${s.tradeMax ? `, ${s.tradeMax}-for-${s.tradeMax} at most` : ""}`}</dd><dt>Playoffs</dt><dd>${s.playoffTeams ? `${s.playoffTeams} teams${s.reseed ? ", reseeded" : ""}` : "None"}</dd><dt>Rosters</dt><dd>${s.bench} bench, ${s.ir || 0} IR${s.maxAdds ? `, ${s.maxAdds} pickups a week` : ""}${s.minIP ? `, ${s.minIP} innings a week` : ""}</dd>${s.keepers || s.dynasty ? `<dt>Draft order</dt><dd>${s.draftOrder === "lottery" ? "Lottery for non-playoff teams" : "Worst to first"}</dd>` : ""}</dl>`, `<button class="btn" data-cm="rules">Edit rules</button>`)}
        ${card("League look", `<div class="row" style="gap:14px;align-items:center">${U.leagueCrest(U.leagueBrand(L.name, s.brand), "lg")}<p class="small" style="margin:0">The league's colors and the letters on its banner, at the top of the league's front page and in everyone's list of leagues.</p></div>`, `<button class="btn" data-cm="look">Change the look</button>`)}
        ${card("Teams", `<p class="small" style="margin:0">Rename teams, set FAAB and the waiver order${L.divs ? ", and rename or rearrange the divisions" : ""}.</p>`, `<button class="btn" data-cm="teams">Edit teams</button>`)}
      </div>
      <div class="cols2">
        ${card("Rosters", `<p class="small" style="margin:0">Move any player to another team or to free agency. Roster limits don't stop you; a team left over the limit has to cut.</p>`, `<button class="btn" data-cm="move">Move a player</button>`)}
        ${card("Trades", trades.length ? `<ul class="seatl">${trades.map((t) => `<li><span class="grow"><b>${esc(teamName(t.from))} &#8644; ${esc(teamName(t.to))}</b><small>${esc([].concat(t.get, t.give).map((x) => (byId[x] ? byId[x].n : "?")).join(", "))}${(t.pickGive || []).length + (t.pickGet || []).length ? ", plus picks" : ""}, ${esc(U.ago(t.done || t.at, now()))}</small></span><button type="button" class="btn sm ghost" data-cm-rev="${t.id}">Reverse</button></li>`).join("")}</ul>` : `<p class="small" style="margin:0">No trades yet. When one goes through, you can reverse it here if every player is still where it sent him.</p>`)}
      </div>` : ""}
      <div class="card danger"><div class="mod-h"><h2>Delete the league</h2></div><div class="bd stack"><p class="small" style="margin:0">Deletes the league for everyone: teams, history and chat. You can't undo it.</p><div><button class="btn warn" data-cm="delete">Delete the league</button></div></div></div>`;
  }
  // commissioner changes save like any other move, as the commissioner
  const commishSave = (r, msg) => { if (!r || r.ok === false) { U.toast((r && r.why) || "That didn't work", true); return false; } push(); if (app) app.refresh(); if (msg) U.toast(msg); return true; };
  function rulesDialog() {
    const s = L.settings, started = now() >= L.start || L.week > 1, inPlayoffs = L.week > s.weeks, gl = G.isGuillotine(L);
    const medianOk = s.format === "h2h" && (s.tally || "game") === "game";
    const sel = (id, label, opts, cur) => `<div class="field"><label for="${id}">${label}</label><select id="${id}" name="${id}">${opts.map(([v, l]) => opt(v, l, cur)).join("")}</select></div>`;
    const n = L.teams.length;
    U.dialog(`<h3>League rules</h3><form class="stack">
      <div class="row3">
        ${gl ? "" : sel("waivers", "Waivers", [["faab", "FAAB bids"], ["rolling", "Rolling priority"]], s.waivers)}
        ${sel("waiverDays", "Dropped players clear after", [[0, "Right away"], [1, "1 business day"], [2, "2 business days"], [3, "3 business days"]], G.waiverDays(L))}
        ${sel("gameLock", "After a player's game starts", [["week", "Locked until next week"], ["off", "Free to add"]], G.gameLockOn(L) ? "week" : "off")}
        ${sel("maxAdds", "Pickups a week", [0, 1, 2, 3, 4, 5, 7, 10].map((x) => [x, x ? `Up to ${x}` : "No limit"]), s.maxAdds || 0)}
      </div>
      <div class="row3">
        ${sel("maxAddsSeason", "Pickups a season", [0, 10, 15, 20, 25, 30, 40, 50].map((x) => [x, x ? `Up to ${x}` : "No limit"]), s.maxAddsSeason || 0)}
        ${gl || s.waivers === "faab" ? sel("minBid", "Lowest bid", [[0, "$0 bids allowed"], [1, "$1"]], s.minBid || 0) : ""}
        ${gl || s.waivers === "faab" ? sel("waiverPrice", "The winner pays", [["first", "Their own bid"], ["second", "Second-highest bid + $1"]], s.waiverPrice || "first") : ""}
        ${gl ? "" : sel("waiverOrder", "Waiver order", [["rolling", "Rolling"], ["standings", "Reverse standings, weekly"]], s.waiverOrder || "rolling")}
      </div>
      <div class="row3">
        ${sel("bench", "Bench spots", [2, 3, 4, 5, 6, 7, 8, 10, 12].map((x) => [x, x]), s.bench)}
        ${sel("ir", "IR spots", [0, 1, 2, 3, 4, 5, 6].map((x) => [x, x || "None"]), s.ir || 0)}
        ${s.dynasty ? sel("taxi", "Taxi squad", [0, 1, 2, 3, 4, 5].map((x) => [x, x ? `${x} spot${x > 1 ? "s" : ""}` : "None"]), s.taxi || 0) : ""}
        ${gl ? "" : sel("trades", "Trades", [[1, "On"], [0, "Off"]], s.trades === false ? 0 : 1)}
      </div>
      ${gl ? "" : `<div class="row3">
        ${sel("deadline", "Trade deadline", [[0, "None"]].concat(Array.from({ length: Math.max(0, s.weeks - 1) }, (_, i) => [i + 1, `After week ${i + 1}`])), s.deadline || 0)}
        ${sel("tradeReview", "Trade review", [["vote", "The league votes"], ["commish", "The commissioner reviews"], ["counter", "Counter window: rival bids, no vetoes"], ["none", "None: trades go through"]], s.tradeReview)}
        ${sel("reviewHours", "Review lasts", [12, 24, 48, 72].map((x) => [x, `${x} hours`]), s.reviewHours || 24)}
      </div>
      <div class="row3">
        ${sel("tradeMax", "Trade size", [[0, "No limit"], [1, "1-for-1 at most"], [2, "2-for-2 at most"], [3, "3-for-3 at most"], [4, "4-for-4 at most"]], s.tradeMax || 0)}
        ${s.tradeReview === "vote" ? sel("vetoShare", "Votes to veto", [[0.34, "A third"], [0.5, "Half"], [0.67, "Two thirds"]], s.vetoShare || 0.5) : ""}
      </div>
      ${s.tradeReview === "counter" ? `<p class="ps" style="margin:0">In the counter window any other team can bid for the same players, offering no more than the deal does. The selling team can take a bid; if it doesn't, the trade goes through when the window closes.</p>` : ""}`}
      ${gl ? "" : `<div class="row3">
        ${sport.key === "mlb" ? sel("elig", "Position eligibility", Object.entries(S.ELIG_PRESETS).map(([k2, [lab]]) => [k2, lab]), Object.keys(S.ELIG_PRESETS).find((k2) => JSON.stringify(S.ELIG_PRESETS[k2][1]) === JSON.stringify(s.elig || S.ELIG)) || "yahoo") : ""}
        ${sport.key === "mlb" && G.scoring(L, lctx()).type !== "points" ? sel("minIP", "Innings a week", [0, 10, 15, 20, 25, 30, 35, 40, 50].map((x) => [x, x ? `At least ${x}, or lose ERA and WHIP` : "No minimum"]), s.minIP || 0) : ""}
        ${sel("draftOrder", "Next season's draft order", [["worst", "Worst to first"], ["lottery", "A lottery for non-playoff teams"]], s.draftOrder || "worst")}
        ${s.draftOrder === "lottery" ? sel("lotteryOdds", "Lottery odds", [["equal", "Equal for every team"], ["weighted", "More for worse records"]], s.lotteryOdds || "equal") : ""}
      </div>
      <div class="row3">
        ${medianOk ? sel("median", "Median game", [[0, "Off"], [1, "On"]], s.median ? 1 : 0) : ""}
        ${sel("bestBall", "Lineups", [[0, "Set each week"], [1, "Best ball"]], s.bestBall ? 1 : 0)}
        ${started || s.format === "roto" ? "" : sel("weeks", "Regular season", [6, 8, 10, 12, 13, 14, 15, 16, 17].concat(sport.key === "mlb" || sport.key === "nba" ? [18, 19, 20, 21, 22, 23, 24] : []).map((x) => [x, `${x} weeks`]), s.weeks)}
      </div>
      ${inPlayoffs || s.format === "roto" ? `<p class="ps" style="margin:0">${s.format === "roto" ? "" : "The playoffs have started, so their rules are set."}</p>` : `<div class="row3">
        ${sel("playoffTeams", "Playoff teams", [0, 2, 3, 4, 6, 8, 10, 12, 16].filter((x) => x <= n).map((x) => [x, x ? `${x} teams` : "No playoffs"]), s.playoffTeams)}
        ${sel("playoffLegs", "Playoff rounds", [["1", "One week each"], ["final2", "Two-week final"], ["all2", "Two weeks each"]], s.playoffLegs || "1")}
        ${sel("consolation", "Also play", [["none", "Nothing else"], ["third", "A third-place game"], ["bracket", "A consolation bracket"]], s.consolation || "none")}
      </div>
      <div class="row3">${s.playoffTeams > 2 ? sel("reseed", "Each round", [[0, "A fixed bracket"], [1, "Reseed: best seed left plays the worst"]], s.reseed ? 1 : 0) : ""}</div>`}`}
      <div class="row3">
        ${sel("bots", "Teams without a manager", [[1, "Bots run them"], [0, "Wait for their manager"]], s.bots === false ? 0 : 1)}
        <div class="field" style="grid-column:span 2"><label for="historyUrl">The league's own record book (optional)</label><input id="historyUrl" name="historyUrl" type="url" maxlength="200" placeholder="https://..." value="${esc(s.historyUrl || "")}"></div>
      </div>
      <p class="ps" style="margin:0">${started ? "The season has started, so its length and schedule are set. " : ""}Changes apply from now on; finished weeks keep their results${medianOk ? ", except that turning the median game on or off recounts every record" : ""}.</p>
      <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">Save rules</button></div></form>`, (fd) => {
      const patch = {};
      for (const [k, v] of fd.entries()) if (k === "elig") patch[k] = (S.ELIG_PRESETS[v] || S.ELIG_PRESETS.yahoo)[1]; else patch[k] = ["trades", "median", "bestBall", "reseed", "bots"].includes(k) ? v === "1" : k === "historyUrl" ? String(v).trim() : ["waivers", "tradeReview", "playoffLegs", "consolation", "waiverOrder", "waiverPrice", "gameLock", "draftOrder", "lotteryOdds"].includes(k) ? v : Number(v);
      const was = (k) => (k === "elig" ? s.elig || S.ELIG : k === "bots" ? s.bots !== false : k === "historyUrl" ? s.historyUrl || "" : k === "trades" ? s.trades !== false : ["median", "bestBall", "reseed"].includes(k) ? !!s[k] : k === "draftOrder" ? s[k] || "worst" : k === "waiverPrice" ? s[k] || "first" : k === "waiverOrder" ? s[k] || "rolling" : k === "maxAddsSeason" ? s[k] || 0 : k === "lotteryOdds" ? s[k] || "equal" : ["tradeMax", "minIP"].includes(k) ? s[k] || 0 : s[k]);
      for (const k of Object.keys(patch)) if (JSON.stringify(patch[k]) === JSON.stringify(was(k))) delete patch[k];
      if (!Object.keys(patch).length) return;
      const r = G.setRules(L, patch, now());
      if (!commishSave(r, "Rules saved.")) return false;
    }, { wide: true });
  }
  // the league's own look: a color from the team palette and up to three letters for its banner crest
  function lookDialog() {
    const cur = U.leagueBrand(L.name, L.settings.brand), names = ["Blue", "Red", "Green", "Purple", "Orange", "Teal", "Pink", "Lime", "Slate", "Brown", "Pine", "Indigo"];
    U.dialog(`<h3>League look</h3><form class="stack lk-f">
      <div class="lk-prev" aria-hidden="true">${U.leagueCrest(cur, "lg")}</div>
      <fieldset class="lk-sw"><legend>Color</legend>${names.map((nm, i) => `<label class="lk-c" style="--c:var(--t${i})"><input type="radio" name="color" value="${i}"${i === cur.color ? " checked" : ""}><span title="${nm}"></span><b class="sr">${nm}</b></label>`).join("")}</fieldset>
      <label class="cm-l"><span>Letters on the banner (up to 3)</span><input type="text" name="letters" value="${esc(cur.letters)}" maxlength="3" autocomplete="off" style="text-transform:uppercase;width:8em"></label>
      <fieldset class="lk-own"><legend>Your own colors <span class="ps">(optional, these win over the swatch)</span></legend>
        <label class="lk-pick"><input type="checkbox" name="ownOn"${cur.hex || cur.bg ? " checked" : ""}> Use my own colors</label>
        <label class="lk-pick"><span>Banner and accent</span><input type="color" name="hex" value="${esc(cur.hex || "#1F7A3D")}"></label>
        <label class="lk-pick"><span>Masthead background</span><input type="color" name="bg" value="${esc(cur.bg || "#0F2A1B")}"></label></fieldset>
      <div class="acts"><button type="button" class="btn ghost" data-lk-reset>Use the default</button><span class="grow"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn go">Save the look</button></div></form>`, (fd) => {
      const letters = String(fd.get("letters") || "").replace(/[^A-Za-z0-9&]/g, "").slice(0, 3).toUpperCase();
      const auto = U.leagueBrand(L.name, null);
      const brand = { color: Number(fd.get("color")) };
      if (letters && letters !== auto.letters) brand.letters = letters;
      if (fd.get("ownOn")) { const hx = (v) => (/^#[0-9a-f]{6}$/i.test(v || "") ? v : null); if (hx(fd.get("hex"))) brand.hex = fd.get("hex"); if (hx(fd.get("bg"))) brand.bg = fd.get("bg"); }
      if (brand.color === auto.color && !brand.letters && !brand.hex && !brand.bg) delete L.settings.brand; else L.settings.brand = brand;
      setTimeout(() => commishSave({ ok: true }, "The league has its new look."), 0);
    });
    const f = $(".lk-f"); if (!f) return;
    const draw = () => { const own = f.ownOn.checked, b = { color: Number((f.querySelector("input[name=color]:checked") || {}).value || 0), letters: f.letters.value, hex: own ? f.hex.value : null, bg: own ? f.bg.value : null }; $(".lk-prev", f).innerHTML = U.leagueCrest(U.leagueBrand(L.name, b), "lg"); $(".lk-prev", f).style.background = b.bg || ""; };
    f.addEventListener("input", draw);
    f.querySelector("[data-lk-reset]").addEventListener("click", () => { const a = U.leagueBrand(L.name, null); f.letters.value = a.letters; const r = f.querySelector(`input[name=color][value="${a.color}"]`); if (r) r.checked = true; draw(); });
  }
  function teamsDialog() {
    const order = L.teams.slice().sort((a, b) => a.priority - b.priority).map((t) => t.id), n = L.teams.length;
    U.dialog(`<h3>Teams</h3><form class="stack">
      <div class="cm-teams">${L.teams.map((t) => `<div class="cm-team">${U.teamAv(t, "sm")}
        <label class="cm-l nm"><span>Team name</span><input type="text" name="n${t.id}" value="${esc(t.name)}" maxlength="28"></label>
        <label class="cm-l"><span>Short</span><input type="text" name="a${t.id}" value="${esc(t.abbr)}" maxlength="4" class="ab"></label>
        <label class="cm-l"><span>FAAB</span><input type="number" name="f${t.id}" value="${t.faab}" min="0" max="100000"></label>
        <label class="cm-l"><span>Waiver #</span><select name="w${t.id}">${Array.from({ length: n }, (_, i) => opt(i + 1, i + 1, order.indexOf(t.id) + 1)).join("")}</select></label>
        ${L.divs ? `<label class="cm-l"><span>Division</span><select name="d${t.id}">${L.divNames.map((nm, k) => opt(k, nm, L.divs[t.id])).join("")}</select></label>` : ""}</div>`).join("")}</div>
      ${L.divs ? `<div class="row" style="flex-wrap:wrap;gap:8px">${L.divNames.map((nm, k) => `<label class="cm-l"><span>Division ${k + 1}</span><input type="text" name="dn${k}" value="${esc(nm)}" maxlength="24"></label>`).join("")}</div>` : ""}
      <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">Save teams</button></div></form>`, (fd) => {
      const at = now();
      for (const t of L.teams) {
        const patch = {};
        if (fd.get("n" + t.id) !== t.name) patch.name = fd.get("n" + t.id);
        if (fd.get("a" + t.id) !== t.abbr) patch.abbr = fd.get("a" + t.id);
        if (Number(fd.get("f" + t.id)) !== t.faab) patch.faab = Number(fd.get("f" + t.id));
        if (L.divs && Number(fd.get("d" + t.id)) !== L.divs[t.id]) patch.div = Number(fd.get("d" + t.id));
        if (Object.keys(patch).length) { const r = G.editTeam(L, t.id, patch, at); if (!r.ok) { U.toast(`${t.name}: ${r.why}`, true); return false; } }
      }
      const wo = L.teams.map((t) => [Number(fd.get("w" + t.id)), t.id]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      if (wo.join() !== order.join()) { const r = G.setWaiverOrder(L, wo, at); if (!r.ok) { U.toast(r.why, true); return false; } }
      if (L.divs) { const names = L.divNames.map((_, k) => fd.get("dn" + k)); if (names.join("|") !== L.divNames.join("|")) { const r = G.setDivisions(L, names, at); if (!r.ok) { U.toast(r.why, true); return false; } } }
      commishSave({ ok: true }, "Teams saved.");
    }, { wide: true });
  }
  function moveDialog() {
    const ctx = lctx();
    U.dialog(`<h3>Move a player</h3><div class="stack"><label class="sr" for="cm-q">Find a player</label><input type="search" id="cm-q" placeholder="Find a player" autocomplete="off"><ul class="seatl" id="cm-res"></ul>
      <div class="acts"><button type="button" class="btn" data-close>Done</button></div></div>`, null, { wide: true });
    const dlg = $("#fk-dlg"), box = $("#cm-res", dlg);
    const draw = (q) => {
      q = q.trim().toLowerCase();
      const hits = q.length < 2 ? [] : players.filter((p) => p.n.toLowerCase().includes(q)).sort((a, b) => a.rank - b.rank).slice(0, 8);
      box.innerHTML = hits.length ? hits.map((p) => { const own = ctx.own[p.id]; return `<li><span class="grow"><b>${esc(p.n)}</b><small>${esc(S.positions(p).join(", "))} ${esc(p.t)}, ${own != null ? `on ${esc(teamName(own))}` : "free agent"}</small></span>
        <label class="sr" for="cm-to-${esc(p.id)}">Move to</label><select id="cm-to-${esc(p.id)}" data-cm-to="${esc(p.id)}">${L.teams.map((t) => opt(t.id, t.name, own)).join("")}${opt("", "Free agents", own == null ? "" : "x")}</select><button type="button" class="btn sm" data-cm-move="${esc(p.id)}">Move</button></li>`; }).join("")
        : `<li class="ps" style="padding:8px 0">${q.length < 2 ? "Type at least two letters of a name." : "Nobody by that name."}</li>`;
    };
    draw("");
    $("#cm-q", dlg).addEventListener("input", (e) => draw(e.target.value));
    $("#cm-q", dlg).focus();
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cm-move]"); if (!b) return;
      const pid = b.dataset.cmMove, v = $(`[data-cm-to="${CSS.escape(pid)}"]`, box).value, to = v === "" ? null : Number(v);
      if (commishSave(G.commishMove(L, lctx(), pid, to, now()), `${byId[pid].n} moved ${to == null ? "to free agency" : `to ${teamName(to)}`}.`)) draw($("#cm-q", dlg).value);
    });
  }
  function deleteDialog() {
    const name = info.name;
    U.dialog(`<h3>Delete ${esc(name)}?</h3><form class="stack"><p class="muted" style="margin:0">This deletes the league for everyone: every team, the season, its history and the chat. You can't undo it.</p>
      <div class="field"><label for="cm-del">Type the league's name to confirm</label><input id="cm-del" name="name" autocomplete="off" placeholder="${esc(name)}"></div>
      <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn warn">Delete the league</button></div></form>`, async (fd) => {
      if (String(fd.get("name") || "").trim() !== name) { U.toast("Type the name exactly as it is.", true); return false; }
      const r = await C.rpc("fk_delete", { p_id: id, p_name: name }).catch((e) => ({ error: e.message }));
      if (r.error) { U.toast(r.error, true); return false; }
      location.href = "leagues.html";
    });
  }
  // before the draft: add a team, or remove one nobody has claimed
  // the commissioner sets the first-round order by hand or shuffles it, any time before the draft starts
  function orderDialog() {
    let list = D.round1.slice();
    const rows = () => list.map((t, i) => `<li class="ord-row"><span class="ord-n">${i + 1}</span>${U.teamAv(D.teams[t], "sm")}<b class="grow">${esc(D.teams[t].name)}</b>
      <button type="button" class="btn sm ghost" data-up="${i}" aria-label="Move ${esc(D.teams[t].name)} up"${i ? "" : " disabled"}>Up</button><button type="button" class="btn sm ghost" data-dn="${i}" aria-label="Move ${esc(D.teams[t].name)} down"${i < list.length - 1 ? "" : " disabled"}>Down</button></li>`).join("");
    U.dialog(`<h3>Draft order</h3><p class="muted" style="margin:0 0 8px">The first round's order. ${D.type === "linear" ? "Every round goes in this order." : D.type === "3rr" ? "Round two snakes back and round three reverses again." : "Later rounds snake back."}</p>
      <form class="stack"><ol class="ord" id="ord-l">${rows()}</ol>
      <div class="acts"><button type="button" class="btn ghost" data-shuf>Shuffle</button><span class="grow"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn go">Save order</button></div></form>`, () => {
      const r = F.setOrder(D, list);
      if (!r.ok) { U.toast(r.why, true); return false; }
      push(); mount(); U.toast("Draft order saved.");
    });
    const dlg = $("#fk-dlg");
    dlg.onclick = (e) => {
      const b = e.target.closest("[data-up],[data-dn],[data-shuf]"); if (!b) return;
      if (b.hasAttribute("data-shuf")) { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } }
      else { const i = +(b.dataset.up ?? b.dataset.dn), j = b.dataset.up != null ? i - 1 : i + 1; [list[i], list[j]] = [list[j], list[i]]; }
      $("#ord-l").innerHTML = rows();
    };
  }
  async function resizeTeams(remove) {
    const keep = D.teams.filter((t) => t.id !== remove);
    const list = keep.map((t) => ({ name: t.name, abbr: t.abbr, owner: t.owner, color: t.color }));
    if (remove == null) { const used = new Set(D.teams.map((t) => t.name)); const nm = ["Night Shift", "Bench Mob", "Waiver Wire", "Late Scratch", "Deep Sleepers", "Box Score", "Hot Corner", "Full Count", "Red Zone", "Fast Break", "Two Minute", "Garbage Time", "Pick Six", "Rain Delay", "Shot Clock", "Trade Deadline", "Home Stand", "Overtime", "Sixth Man", "Bye Week"].find((x) => !used.has(x)) || `Team ${D.teams.length + 1}`; list.push({ name: nm, abbr: nm.split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase(), color: (D.teams.length * 5) % 12 }); }
    const r = F.resize(D, sport, list, players);
    if (!r.ok) { U.toast(r.why, true); return; }
    const map = {}; keep.forEach((t, i) => (map[t.id] = i));
    const res = await C.rpc("fk_resize", { p_id: id, p_version: version, p_draft: r.draft, p_map: map }).catch((e) => ({ error: e.message }));
    if (res.error === "stale") { U.toast("Someone else saved first. Try again.", true); version = -1; pull(); return; }
    if (res.error) { U.toast(res.error, true); return; }
    D = r.draft; version = res.version; base = clone({ draft: D, league: null });
    const s2 = {}; for (const [old, nw] of Object.entries(map)) if (info.seats[old] != null) s2[nw] = info.seats[old];
    info.seats = s2; if (info.me != null) info.me = map[info.me];
    mount(); U.toast(remove == null ? "Added a team." : "Removed the team.");
  }
  document.addEventListener("click", (e) => {
    const lv = e.target.closest("[data-live]"), th = e.target.closest("button[data-theme]");
    if (th) { theme.toggle(); if (app) app.render(); return; }
    if (lv && lv.dataset.live === "league") { e.preventDefault(); leagueDialog(); }
    if (lv && lv.dataset.live === "invite") { e.preventDefault(); inviteDialog(); }
    if (lv && lv.dataset.live === "dues") { e.preventDefault(); duesDialog(); }
    if (lv && lv.dataset.live === "keepers") keeperDialog();
    if (lv && lv.dataset.live === "open-keepers" && info.commish) keeperOpenDialog();
    if (lv && lv.dataset.live === "draft-order" && info.commish) orderDialog();
    if (lv && lv.dataset.live === "lottery" && info.commish) runLottery();
    if (lv && lv.dataset.live === "practice") { e.preventDefault(); practiceOpen(false); }
    if (lv && lv.dataset.live === "practice-new") { e.preventDefault(); U.confirm("Start the practice draft over?", "It rebuilds the board from the league's keepers and draft order as they stand now.", "Start over", () => practiceOpen(true)); }
    const kt = e.target.closest("[data-kp-team]");
    if (kt && info.commish) keeperDialog(+kt.dataset.kpTeam);
    const cm = e.target.closest("[data-cm]");
    if (cm && info.commish) { const k = cm.dataset.cm; if (k === "rules") rulesDialog(); else if (k === "look") lookDialog(); else if (k === "teams") teamsDialog(); else if (k === "move") moveDialog(); else if (k === "delete") deleteDialog(); }
    const rv = e.target.closest("[data-cm-rev]");
    if (rv && info.commish) { const tid = Number(rv.dataset.cmRev); U.confirm("Reverse this trade?", "Every player, pick and FAAB dollar goes back to the team that sent it.", "Reverse the trade", () => commishSave(G.reverseTrade(L, lctx(), tid, now()), "Trade reversed.")); }
    if (lv && lv.dataset.live === "new-season") U.confirm("Start next season?", "This season goes into the league's history, and the league opens a new draft room. You can't undo it.", "Start next season", newSeason);
    const fr = e.target.closest("#app [data-free]");
    if (fr) { const t = Number(fr.dataset.free); U.confirm(`Free ${teamName(t)}?`, `${esc(info.seats[t])} loses the team, and a bot runs it until someone else claims it with the invite link.`, "Free the team", async () => {
      const r = await C.rpc("fk_leave", { p_id: id, p_team: t }).catch((err) => ({ error: err.message }));
      if (r.error) U.toast(r.error, true); else { U.toast("Done. The team is open."); version = -1; pull(); }
    }); }
  });

  window.addEventListener("hashchange", () => { if (practice && location.hash !== "#practice") { practice = null; mount(); } });
  window.addEventListener("hashchange", () => { if (/access_token=/.test(location.hash) && C.fromLink()) location.reload(); });
  boot().catch((e) => { console.error(e); fatal("Couldn't load the league.", `<span class="muted">${esc(e.message)}</span>`); });
})();
