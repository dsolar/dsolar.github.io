/* Draft Lab's home page: your leagues at the top, for a signed-in visitor (fantasy/hub.js calls FK.home.mount).

   The list comes from fk_mine (each league's status card). For a head-to-head league in its season the page also
   works out this week's matchup the way the league page does: the league (fk_view), its sport's player file and
   weekly box scores, the live feed, then FK.league.matchups for the current week. That needs the league engine, so
   the scripts load only here, after the page is up, and at most four leagues are scored. */
(function (root) {
  "use strict";
  const FK = (root.FK = root.FK || {});
  const HERE = (document.currentScript && document.currentScript.src) || "";
  const KIT = HERE.replace(/home\.js.*$/, "");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const WEEK = 6048e5, MAX_SCORED = 4;
  const loaded = {};
  const need = (file) => (loaded[file] = loaded[file] || new Promise((ok, bad) => {
    const s = document.createElement("script"); s.src = KIT + file; s.onload = ok; s.onerror = () => bad(new Error(file)); document.head.appendChild(s);
  }));
  const json = (file) => fetch(KIT + file, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const fmt = (x) => (Math.abs(x) < 0.05 ? "0.0" : x.toFixed(1));

  // the signed-in visitor's session, without loading cloud.js for someone who isn't
  const signedIn = () => { try { return !!JSON.parse(localStorage.getItem("fk-auth:session") || "null"); } catch (e) { return false; } };

  function statusOf(l) {
    const c = l.card || {};
    if (l.phase === "season") {
      if (c.format === "guillotine") return c.alive === false ? "Chopped" : `Week ${c.week || 1}, still standing`;
      const over = c.over || (c.weeks != null && c.week > c.weeks + (c.playoffWeeks || 4));
      if (over) return c.place ? `Finished ${ord(c.place)}` : "Season over";
      const rec = c.w || c.l || c.t ? `${c.w}-${c.l}${c.t ? "-" + c.t : ""}` : "";
      return [`Week ${c.week || 1}`, rec, c.rank ? ord(c.rank) : ""].filter(Boolean).join(", ");
    }
    if (l.phase === "live") return "Drafting now";
    if (l.phase === "done") return "Draft done";
    return "Draft room open";
  }
  const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  // this week's matchup for one league: { you, them, opp, live, win } or null
  const files = {};
  async function matchup(l) {
    const S = FK.sports, V = FK.value, G = FK.league, Z = FK.season, C = FK.cloud;
    const v = await C.rpc("fk_view", { p_id: l.id, p_since: null }).catch(() => null);
    const D = v && v.draft, L = v && v.league, me = v && v.me;
    if (!L || me == null || !L.schedule || ["guillotine", "roto", "total"].includes(L.settings.format)) return null;
    if (FK.league.totalWeeks && L.week > FK.league.totalWeeks(L)) return null;
    const k = l.sport;
    files[k] = files[k] || Promise.all([json(`data/${k}.json`), json(`data/weeks-${k}.json`), C.live ? C.live(k).catch(() => null) : null]);
    let [data, weeks0, live] = await files[k];
    if (!data || !Array.isArray(data.players)) return null;
    // an IDP league plays defenders too: their own files, merged in
    if (k === "nfl" && S.usesIdp(D)) {
      files.idp = files.idp || Promise.all([json("data/nfl-idp.json"), json("data/weeks-nfl-idp.json")]);
      const [xp, xw] = await files.idp;
      data = S.addIdp(data, xp); weeks0 = S.addIdpWeeks(weeks0, xw);
    }
    const weeks = weeks0 && String(weeks0.season) === String(data.season) ? JSON.parse(JSON.stringify(weeks0)) : null;
    if (weeks && live && Z.mergeLive) Z.mergeLive(weeks, live);
    const sport = S.withScoring(S.attach(Object.assign({}, S[k]), data), D.scoringSpec);
    const players = data.players.filter((p) => S.inPool(L, p)).map((p) => Object.assign({}, p));
    S.withExtras(players, { extraPlayers: L.extraPlayers || D.extraPlayers });
    V.evaluate(sport, players, { teams: D.teams.length, lineup: D.lineup, bench: D.bench, scoring: D.scoring, week: S.weekFor(L, sport) });
    const ctx = G.context(L, players, sport, { real: L.settings.real ? weeks : null });
    const w = Math.min(L.week, G.totalWeeks(L));
    const frac = Math.max(0, Math.min(1, (Date.now() - G.weekStart(L, w)) / WEEK));
    if (live) G.setKicks(L, live);
    const game = G.matchups(L, ctx, w, frac).find((g) => g.a === me || g.b === me);
    if (!game) return null;
    const mine = game.a === me, opp = mine ? game.b : game.a;
    const you = mine ? game.sa : game.sb, them = mine ? game.sb : game.sa;
    const win = game.winProb != null ? (mine ? game.winProb : 1 - game.winProb) : null;
    const pts = G.scoring ? G.scoring(L, ctx).type === "points" : true;
    const lu = G.lineupFor(L, ctx, me, w), offers = (L.trades || []).filter((t) => t.status === "pending" && t.to === me).length;
    const empty = L.settings.bestBall ? 0 : L.settings.lineup.length - lu.filter(Boolean).length;
    const out = L.settings.bestBall ? 0 : lu.filter((id) => id && ctx.byId[id] && G.plays(ctx.byId[id]) === 0 && !G.isLocked(L, ctx.byId[id], w, Date.now())).length;
    const claims = (L.claims || []).filter((c) => c.team === me && c.status === "open").length;
    const attention = offers ? `${offers} trade offer${offers === 1 ? "" : "s"} to review` : empty ? `${empty} empty lineup spot${empty === 1 ? "" : "s"}` : out ? `${out} starter${out === 1 ? "" : "s"} flagged out` : claims ? `${claims} waiver claim${claims === 1 ? "" : "s"} pending` : "";
    const rw = G.realWeek(L, ctx, w);
    const pending = L.settings.real && (!rw || rw.missing);
    const final = !!game.final || !!(rw && rw.final);
    const state = pending ? "Awaiting box scores" : final ? "Final" : !L.settings.real ? "Simulated" : game.live ? "Live" : frac >= 1 ? "Awaiting final scores" : "This week";
    let remaining = "";
    if (k === "nfl" && !pending && !final && !L.settings.bestBall && L.kick && L.kick.week === w) {
      const kicks = (lineup) => lineup.map(id => ctx.byId[id]).filter(Boolean)
        .map(p => L.kick.teams[p.t]).filter(at => at > Date.now());
      const yours = kicks(lu), theirs = kicks(G.lineupFor(L, ctx, opp, w));
      const next = Math.min(...yours, ...theirs);
      if (Number.isFinite(next)) remaining = `Yet to start: you ${yours.length}, opponent ${theirs.length} · Next kickoff ${new Date(next).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
    }
    return { w, i: game.i, you, them, pts, opp: L.teams[opp] ? L.teams[opp].name : "Opponent", state, pending, final, win, remaining, attention, action: offers ? "team/trades" : empty || out ? "team/roster" : claims ? "players/claims" : "" };
  }

  async function mount(el) {
    if (!el || !signedIn()) return;
    try { await need("cloud.js"); } catch (e) { return; }
    const C = FK.cloud; if (!C || !C.user()) return;
    const mine = await C.rpc("fk_mine", {}).catch(() => null);
    if (!Array.isArray(mine) || !mine.length) return;
    const priority = l => l.phase === "live" ? 0 : l.phase === "season" && !/^(Finished|Season over|Chopped)/.test(statusOf(l)) ? 1 : 2;
    const list = mine.slice().sort((a, b) => priority(a) - priority(b)).slice(0, 8);
    const icon = (k) => { const src = FK.sports && FK.sports.leagueLogo && FK.sports.leagueLogo(k); const txt = `<span class="ym-lg ym-sp">${esc((FK.sports.ALL[k] || {}).short || k)}</span>`; return src ? `<img class="ym-lg" src="${src}" alt="" loading="lazy" onerror="this.outerHTML=this.dataset.t" data-t="${esc(txt)}">` : txt; };
    el.innerHTML = `<div class="sec-h"><div><h2>Your leagues, right now</h2><p>Draft rooms, matchups, and decisions waiting on you.</p></div><a href="/fantasy/leagues/">All my leagues &rarr;</a></div>
      <div class="ym">${list.map((l) => `<article class="ym-item"><a class="ym-c" href="/fantasy/league/?id=${encodeURIComponent(l.id)}" data-ym="${esc(l.id)}">${icon(l.sport)}<span class="ym-m"><b>${esc(l.name)}</b><small>${l.phase === "live" ? "Rejoin draft →" : esc(statusOf(l))}</small><span class="ym-s" data-ys></span></span></a></article>`).join("")}</div>`;
    el.hidden = false;
    // leagues still playing (a finished season shows its finish, not its last matchup)
    const scored = list.filter((l) => l.phase === "season" && l.card && l.card.format !== "guillotine" && !/^(Finished|Season over)/.test(statusOf(l))).slice(0, MAX_SCORED);
    if (!scored.length) return;
    try { for (const f of ["draft.js", "rules.js", "league.js", "season.js"]) await need(f); } catch (e) { return; }
    for (const l of scored) {
      const box = el.querySelector(`[data-ym="${CSS.escape(l.id)}"] [data-ys]`);
      matchup(l).then((m) => {
        if (!m || !box) return;
        const lead = m.you > m.them ? "up" : m.you < m.them ? "down" : "";
        const card = box.closest("a"), url = card.href;
        card.href = url + "#matchup/" + m.w + "/" + m.i;
        box.innerHTML = (m.pending ? "" : `<span class="ym-sc ${lead}">${m.pts ? fmt(m.you) : m.you}<i>–</i>${m.pts ? fmt(m.them) : m.them}</span>`) +
          `<span class="ym-vs">vs ${esc(m.opp)} · ${esc(m.state)}${m.win != null && !m.final && !m.pending ? `, ${Math.round(m.win * 100)}% to win` : ""}</span>` +
          (m.remaining ? `<small>${esc(m.remaining)}</small>` : "");
        if (m.attention && m.action) card.insertAdjacentHTML("afterend", `<a class="ym-attention" href="${esc(url)}#${m.action}">${esc(m.attention)} &rarr;</a>`);
      }).catch(() => {});
    }
  }
  FK.home = { mount, signedIn };
})(this);
