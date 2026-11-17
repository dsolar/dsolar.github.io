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
    const game = G.matchups(L, ctx, w, frac).find((g) => g.a === me || g.b === me);
    if (!game) return null;
    const mine = game.a === me, opp = mine ? game.b : game.a;
    const you = mine ? game.sa : game.sb, them = mine ? game.sb : game.sa;
    const win = game.winProb != null ? (mine ? game.winProb : 1 - game.winProb) : null;
    const pts = G.scoring ? G.scoring(L, ctx).type === "points" : true;
    return { w, you, them, pts, opp: L.teams[opp] ? L.teams[opp].name : "Opponent", live: !!game.live && frac < 1, final: !!game.final || frac >= 1, win };
  }

  async function mount(el) {
    if (!el || !signedIn()) return;
    try { await need("cloud.js"); } catch (e) { return; }
    const C = FK.cloud; if (!C || !C.user()) return;
    const mine = await C.rpc("fk_mine", {}).catch(() => null);
    if (!Array.isArray(mine) || !mine.length) return;
    const list = mine.filter((l) => !l.oneWeek || l.phase !== "season").slice(0, 8);
    const icon = (k) => { const src = FK.sports && FK.sports.leagueLogo && FK.sports.leagueLogo(k); const txt = `<span class="ym-lg ym-sp">${esc((FK.sports.ALL[k] || {}).short || k)}</span>`; return src ? `<img class="ym-lg" src="${src}" alt="" loading="lazy" onerror="this.outerHTML=this.dataset.t" data-t="${esc(txt)}">` : txt; };
    el.innerHTML = `<div class="sec-h"><div><h2>Your leagues</h2><p>This week's matchups, live while games are on.</p></div><a href="${KIT}leagues.html">All your leagues &rarr;</a></div>
      <div class="ym">${list.map((l) => `<a class="ym-c" href="${KIT}play.html?id=${encodeURIComponent(l.id)}" data-ym="${esc(l.id)}">${icon(l.sport)}<span class="ym-m"><b>${esc(l.name)}</b><small>${esc(statusOf(l))}</small><span class="ym-s" data-ys></span></span></a>`).join("")}</div>`;
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
        box.innerHTML = `<span class="ym-sc ${lead}">${m.pts ? fmt(m.you) : m.you}<i>-</i>${m.pts ? fmt(m.them) : m.them}</span><span class="ym-vs">vs ${esc(m.opp)}${m.live ? ` <em class="ym-live">Live</em>` : m.final ? " (final)" : ""}${m.win != null && !m.final ? `, ${Math.round(m.win * 100)}% to win` : ""}</span>`;
      }).catch(() => {});
    }
  }
  FK.home = { mount, signedIn };
})(this);
