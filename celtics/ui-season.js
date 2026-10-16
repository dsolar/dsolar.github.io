/* Banner 19: the Season tab (GM mode). Sim, standings, deadline calls, playoffs, lottery, draft, options,
   free agency, camp. */
(function () {
  "use strict";
  const App = window.App, L = window.League, CBA = window.CBA, Mo = window.Model;
  const esc = App.esc, m = App.m, m2 = App.m2;

  const standingsTable = (W, conf) => {
    const st = L.standings(W, conf);
    return `<table class="std"><caption class="sr">${conf === "E" ? "East" : "West"} standings</caption><thead><tr><th scope="col">#</th><th scope="col">${conf === "E" ? "East" : "West"}</th><th scope="col">W</th><th scope="col">L</th><th scope="col">Net</th></tr></thead><tbody>
      ${st.map((t, k) => `<tr class="${t.code === "BOS" ? "us" : ""}${k === 5 || k === 9 ? " cut" : ""}"><td>${k + 1}</td><td>${esc(t.name)}</td><td>${t.w}</td><td>${t.l}</td><td>${(L.teamNets(W)[t.code] >= 0 ? "+" : "") + L.teamNets(W)[t.code].toFixed(1)}</td></tr>`).join("")}</tbody></table>
      <p class="small muted" style="margin:4px 0 0">Top six make the playoffs; seven through ten play in.</p>`;
  };
  const newsList = (W, n, onlyBos) => `<ul class="plain news">${W.news.filter(x => !onlyBos || x.team === "BOS").slice(0, n).map(x => `<li><time>${esc(L.fmtDate(x.d))}</time>${esc(x.text)}</li>`).join("") || "<li class='muted'>Nothing yet.</li>"}</ul>`;
  const tradeLine = (W, tr, code) => {
    const s = tr.side[code];
    return (s.players.map(id => W.P[id].n).concat((s.picks || []).map(id => L.pickName(W, id))).concat(s.cash ? [m(s.cash) + " cash"] : [])).join(", ") || "nothing";
  };

  App.views.season = {
    render(el) {
      const W = App.W, ph = W.phase;
      let main = "";
      const o = L.ensureOwner(W);
      if (o.fired) main = firedHTML(W);
      else if (ph === "pre") main = preHTML(W);
      else if (ph === "reg" || ph === "reg2") main = regHTML(W);
      else if (ph === "deadline") main = deadlineHTML(W);
      else if (ph === "playoffs") main = playoffsHTML(W);
      else if (ph === "draft") main = draftHTML(W);
      else if (ph === "expansion") main = expansionHTML(W);
      else if (ph === "options") main = optionsHTML(W);
      else if (ph === "fa") main = faHTML(W);
      el.innerHTML = `<section class="panel" aria-labelledby="season-h">
        <h2 id="season-h">${esc(L.PHASE_NAME[ph])}, ${App.sn(W.season)}</h2>
        ${App.ui.flash ? `<div class="notice ${App.ui.flash.ok ? "good" : "bad"}" role="status">${esc(App.ui.flash.text)}</div>` : ""}
        ${main}
      </section>
      <div class="grid2">
        <section class="card" aria-labelledby="news-h"><h3 id="news-h">Around the league</h3>${newsList(W, 14)}</section>
        <div>${ownerCard(W)}<div style="margin-top:16px">${historyCard(W)}</div></div>
      </div>`;
      App.ui.flash = null;
    }
  };
  const flash = (ok, text) => { App.ui.flash = { ok, text }; };
  App.flash = flash;

  // ---------- Ownership ----------
  function ownerCard(W) {
    const o = L.ensureOwner(W), m0 = o.mandate, last = o.log[0];
    const pay = L.payrollNow(W, "BOS"), mc = L.mandateCheck(W, pay);
    return `<section class="card" aria-labelledby="own-h"><h3 id="own-h">Ownership</h3>
      <div class="row" style="align-items:baseline;gap:14px"><span class="bigstat ${o.trust < 35 ? "bad" : ""}">${o.trust}</span><span class="small muted">${esc(o.name)}'s trust, out of 100</span></div>
      <p class="small" style="margin:6px 0 0"><b>Rule for ${App.sn(m0.season)}:</b> ${esc(m0.text)} ${m0.season === W.season ? `<span class="${mc.ok ? "good" : "bad"}">${mc.ok ? "On track." : "Broken: " + esc(mc.text)}</span>` : ""}</p>
      ${last ? `<p class="small muted" style="margin:6px 0 0">${App.sn(last.season)} review: ${esc(last.text)}</p>` : `<p class="small muted" style="margin:6px 0 0">He reviews every season against what you were projected to do and what you spent. Big tax bills without results cost trust; titles buy a lot of it.</p>`}
    </section>`;
  }
  function firedHTML(W) {
    const o = L.ensureOwner(W), last = o.log[0];
    return `<div class="card"><h3>You're fired</h3><p>${esc(last ? last.text : "")}</p><p class="small muted">Keep going as the new GM: the roster, contracts and picks stay as they are, trust resets to 50, and the new rule is to stay under the tax.</p><button class="btn" type="button" data-act="seRehire">Start over as the new GM</button></div>`;
  }
  App.acts.seRehire = () => { const o = L.ensureOwner(App.W); o.fired = false; o.trust = 50; o.mandate = { season: App.W.season + (App.W.phase === "pre" ? 0 : 1), rule: "tax", text: L.MANDATES.tax }; flash(true, "New GM, same roster. Stay under the tax."); App.afterChange(); };
  App.acts.dfGo = () => { App.render(); };

  // ---------- Preseason ----------
  function preHTML(W) {
    const rec = W.season === 0 ? L.liveStart(W) : null;
    const nets = L.teamNets(W), top = Object.entries(nets).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const n = L.rosterCount(W, "BOS"), tw = L.twoWays(W, "BOS").length;
    return `<div class="grid2">
      <div class="card">
        <h3>Opening night: ${esc(L.fmtDate(L.dates(W.season).open))}</h3>
        <p>Boston projects to ${Math.round(L.projWins(W, "BOS"))} wins with ${App.pct(App.titleOdds().BOS || 0)} title odds.</p>
        ${rosterNote(W)}
        ${rec ? `<p class="small">Real games have been played. The season can pick up from the actual standings as of ${esc(L.fmtDate(W.live.updated.slice(0, 10)))} (Boston ${rec.BOS.w}-${rec.BOS.l}).</p>` : ""}
        <button class="btn" type="button" data-act="seStart"${n > 15 ? " disabled" : ""}>${rec ? "Start from the real standings" : "Start the season"}</button>
        <p class="small muted">Anything you line up in Moves can still happen before you start.</p>
      </div>
      <div class="card">
        <h3>Preseason power rankings</h3>
        <ol style="margin:0;padding-left:20px">${top.map(([c, v]) => `<li${c === "BOS" ? ' style="font-weight:700"' : ""}>${esc(W.T[c].name)} <span class="muted small">${v >= 0 ? "+" : ""}${v.toFixed(1)} net, ${Math.round(L.projWins(W, c))} wins</span></li>`).join("")}</ol>
      </div>
    </div>
    ${settingsCard(W)}`;
  }
  // Roster count in words: standard deals against 15, two-way spots against 3
  function rosterNote(W) {
    const n = L.rosterCount(W, "BOS"), tw = L.twoWays(W, "BOS").length;
    const lines = [];
    if (n > 15) lines.push(`<span class="bad">${n} players on standard deals. Cut to 15 before opening night (Moves, Waive).</span>`);
    else if (n < 14) lines.push(`<span class="bad">${n} players on standard deals. You need at least 14 (Moves, Sign).</span>`);
    else if (n === 14) lines.push(`<span class="warnc">14 players on standard deals: legal, but one injury from short-handed. A 15th is a minimum deal away.</span>`);
    else lines.push(`15 players on standard deals.`);
    lines.push(tw < 3 ? `<span class="warnc">${tw} of 3 two-way spots filled.</span> Two-way players cost nothing against the cap.` : "All 3 two-way spots filled.");
    return `<p class="small">${lines.join(" ")}${n < 15 || tw < 3 ? ` <button class="linkish" type="button" data-act="goSign">Find players</button>` : ""}</p>`;
  }
  App.acts.goSign = () => { App.ui.compose = "sign"; App.ui.sgFit = L.rosterCount(App.W, "BOS") >= 15 ? "two" : "min"; App.go("moves"); };
  function settingsCard(W) {
    const s = W.settings, locked = W.expanded || W.season > 1 || (W.season === 1 && ["fa"].includes(W.phase));
    return `<div class="card" style="margin-top:16px"><h3>Settings</h3>
      <label class="chk"><input type="checkbox" data-on="setExp"${s.expansion ? " checked" : ""}${locked ? " disabled" : ""}><span><b>Expansion draft in the 2028 offseason.</b> <span class="small muted">Seattle and Las Vegas join for 2028-29 under 2004 Bobcats rules: every team protects eight and loses at most one. It runs as its own step right after the 2028 draft. Not approved in real life yet.${W.expanded ? " Done." : ""}</span></span></label>
    </div>`;
  }
  App.acts.setExp = el => { App.W.settings.expansion = el.checked; App.afterChange(); };
  App.acts.setTax = el => { App.W.settings.noTax0 = el.checked; App.afterChange(); };
  App.acts.seStart = (el, e, force) => {
    const W = App.W, n = L.rosterCount(W, "BOS"), tw = L.twoWays(W, "BOS").length;
    if (!force && n <= 15 && (n < 15 || tw < 3)) {
      App.dlg("Open spots", `<p>Boston has ${n} players on standard deals${n < 15 ? ` (room for ${15 - n} more)` : ""} and ${tw} of 3 two-way spots filled.${n < 14 ? " The league requires 14, so the best minimum free agents will be signed to get there." : ""}</p>
        <div class="row"><button class="btn" type="button" data-act="seStartYes">Start anyway</button><button class="btn ghost" type="button" data-act="seFind">Find players first</button></div>`);
      return;
    }
    const r = L.startSeason(W); if (!r.ok) flash(false, r.why); App.afterChange();
  };
  App.acts.seStartYes = () => { App.closeDlg(); App.acts.seStart(null, null, true); App.go("season"); };
  App.acts.seFind = () => { App.closeDlg(); App.acts.goSign(); };

  // ---------- Regular season ----------
  function regHTML(W) {
    const d = L.dates(W.season);
    const games = W.games.slice(-10).reverse();
    const left = L.gamesLeft(W);
    return `<div class="card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div><span class="bigstat">${W.T.BOS.w}-${W.T.BOS.l}</span> <span class="muted">${left ? `${82 - W.T.BOS.w - W.T.BOS.l} games left` : "Regular season over"}</span></div>
          <div class="row">
            <button class="btn" type="button" data-act="seWeek">Next week</button>
            ${W.phase === "reg" ? `<button class="btn ghost" type="button" data-act="seDeadline">To the deadline (${esc(L.fmtDate(d.deadline))})</button>` : ""}
            <button class="btn ghost" type="button" data-act="seEnd">Finish the regular season</button>
          </div>
        </div>
        ${games.length ? `<p class="small" style="margin:12px 0 0"><b>Last ${games.length}:</b> ${games.map(g => `${g.us > g.them ? "W" : "L"} ${g.us}-${g.them} ${g.home ? "vs" : "at"} ${esc(g.opp)}`).join(", ")}.</p>` : ""}
        ${games[0] && games[0].out.length ? `<p class="small muted" style="margin:4px 0 0">Out last game: ${esc(games[0].out.join(", "))}.</p>` : ""}
      </div>
      ${(W.offers || []).some(o => !o.done) ? `<div class="card" style="margin-top:16px"><h3>Trade calls</h3><p class="small muted" style="margin-top:0">Calls start about three weeks before the deadline. Each offer is good for about ten days.</p>${offerCards(W)}</div>` : ""}
      <div class="grid2" style="margin-top:16px"><div class="card">${standingsTable(W, "E")}</div><div class="card">${standingsTable(W, "W")}</div></div>`;
  }
  App.acts.seWeek = () => { const r = L.simDays(App.W, 7); if (r && r.calls) flash(true, `${r.calls} team${r.calls > 1 ? "s" : ""} called with a trade offer.`); App.afterChange(); };
  App.acts.seDeadline = () => { const W = App.W; L.simUntil(W, L.dates(W.season).deadline); L.openDeadline(W); App.afterChange(); };
  App.acts.seEnd = () => { L.finishRegular(App.W); App.afterChange(); };

  // ---------- Deadline ----------
  function offerCards(W) {
    const offers = (W.offers || []).filter(o => !o.done);
    return offers.map(o => {
      const A = App.analyzeTrade(o.tr);
      const legal = A.chk.ok;
      const mc = A.bAfter ? L.mandateCheck(W, A.bAfter[0].payroll) : { ok: true };
      return `<div class="offer"><div class="fo"><b>${esc(W.T[o.from].name)}</b><span class="muted small">${esc(W.T[o.from].fo.lead)}</span><span class="chip">${App.MODE_NAME[W.T[o.from].fo.mode]}</span>${o.exp ? `<span class="small muted">Good until ${esc(L.fmtDate(o.exp))}</span>` : ""}</div>
        <p style="margin:6px 0">${esc(o.note)}</p>
        ${App.readHTML(W, o.tr, A)}
        ${!legal ? `<p class="small bad" style="margin:6px 0 0">Not legal anymore: ${esc(Object.values(A.chk.teams).flatMap(t => t.msgs).join(" "))}</p>` : ""}
        ${!mc.ok ? `<p class="small warnc" style="margin:6px 0 0">Breaks ownership's rule: ${esc(mc.text)}</p>` : ""}
        <div class="row" style="margin-top:8px"><button class="btn sm" type="button" data-act="ofYes" data-id="${o.id}"${legal ? "" : " disabled"}>Accept</button><button class="btn ghost sm" type="button" data-act="ofNo" data-id="${o.id}">Pass</button><button class="btn ghost sm" type="button" data-act="ofEdit" data-id="${o.id}">Counter in the trade builder</button></div></div>`;
    }).join("");
  }
  function deadlineHTML(W) {
    const cards = offerCards(W);
    return `<div class="card"><p style="margin-top:0">Deadline week runs through ${esc(L.fmtDate(L.dates(W.season).deadlineEnd))}. Boston is ${W.T.BOS.w}-${W.T.BOS.l}. Offers on the table:</p>
      ${cards || "<p class='muted'>No calls waiting. Build your own in Moves, or shop a contract under Dump salary.</p>"}
      <div class="row"><button class="btn" type="button" data-act="seClose">Close the deadline and play on</button><button class="btn ghost" type="button" data-act="seMore">Call around for more</button></div></div>
      <div class="grid2" style="margin-top:16px"><div class="card">${standingsTable(W, "E")}</div><div class="card">${standingsTable(W, "W")}</div></div>`;
  }
  App.acts.ofYes = el => { const r = L.acceptOffer(App.W, el.dataset.id); flash(r.ok, r.ok ? "Done. The trade went through." : r.why); App.afterChange(); };
  App.acts.ofNo = el => { const o = App.W.offers.find(x => x.id === el.dataset.id); if (o) { o.done = true; o.result = "passed"; } App.afterChange(); };
  App.acts.ofEdit = el => { const o = App.W.offers.find(x => x.id === el.dataset.id); App.ui.trade = JSON.parse(JSON.stringify(o.tr)); App.ui.compose = "trade"; App.go("moves"); };
  App.acts.seClose = () => { L.closeDeadline(App.W); App.afterChange(); };
  App.acts.seMore = () => { const W = App.W; const busy = new Set((W.offers || []).filter(o => !o.done).map(o => o.from)); const more = L.makeOffers(W, 3, busy).map(o => Object.assign(o, { exp: L.dates(W.season).deadlineEnd })); W.offers = W.offers.concat(more); flash(true, more.length ? `${more.length} more call${more.length > 1 ? "s" : ""}.` : "Nobody else is biting."); App.afterChange(); };

  // ---------- Playoffs ----------
  function playoffsHTML(W) {
    const seedsE = L.standings(W, "E").slice(0, 10).map(t => t.code);
    const k = seedsE.indexOf("BOS");
    return `<div class="card"><p style="margin-top:0">Boston finished ${W.T.BOS.w}-${W.T.BOS.l}${k >= 0 ? `, ${k + 1}${["th", "st", "nd", "rd"][k + 1 > 3 ? 0 : k + 1]} in the East` : ", out of the top ten in the East"}. Title odds going in: ${App.pct(App.titleOdds().BOS || 0)}.</p>
      <button class="btn" type="button" data-act="sePlay">Play the playoffs</button></div>
      <div class="grid2" style="margin-top:16px"><div class="card">${standingsTable(W, "E")}</div><div class="card">${standingsTable(W, "W")}</div></div>`;
  }
  App.acts.sePlay = () => { const run = L.runPlayoffs(App.W); flash(true, run === "Won the title" ? "Banner 19. Boston wins the title." : `Boston: ${run.toLowerCase()}.`); App.afterChange(); };
  const seriesLine = (W, s) => `${esc(W.T[s.win].name)} over ${esc(W.T[s.win === s.hi ? s.lo : s.hi].name)}, ${Math.max(s.wh, s.wl)}-${Math.min(s.wh, s.wl)}`;
  function bracketHTML(W) {
    const p = W.post; if (!p) return "";
    const rows = [];
    for (const rd of p.rounds) { rows.push(`<li><b>${rd.conf === "E" ? "East" : "West"} first round:</b> ${rd.r1.map(s => seriesLine(W, s)).join("; ")}</li>`); rows.push(`<li><b>Second round:</b> ${rd.r2.map(s => seriesLine(W, s)).join("; ")}</li>`); rows.push(`<li><b>Conference finals:</b> ${seriesLine(W, rd.cf)}</li>`); }
    rows.push(`<li><b>Finals:</b> ${seriesLine(W, p.finals)}</li>`);
    return `<ul class="small" style="padding-left:18px">${rows.join("")}</ul>`;
  }

  // ---------- Draft ----------
  function draftHTML(W) {
    const year = L.draftYear(W);
    const ds = W.ds && W.ds.year === year ? W.ds : null;
    const run = L.bostonRun(W);
    const rev = L.ensureOwner(W).log[0];
    let body = `<div class="card"><p style="margin-top:0"><b>${esc(run || "")}.</b> ${W.post ? `Champion: ${esc(W.T[W.post.champ].name)}.` : ""}</p>${rev && rev.season === W.season ? `<p class="notice ${rev.after >= rev.before ? "good" : "bad"}"><b>${esc(L.ensureOwner(W).name)}:</b> ${esc(rev.text)} Trust ${rev.before} → ${rev.after}.</p>` : ""}${bracketHTML(W)}</div>`;
    if (!ds) {
      const bos = W.picks.filter(p => p.y === year && p.owner === "BOS");
      body += `<div class="card" style="margin-top:16px"><h3>The ${year} draft</h3>
        <p>The new 3-2-1 lottery: 16 teams, all 16 lottery picks drawn. Teams that missed the play-in get three balls, the three worst records get two (and can't fall below 12th), nine and ten seeds get two, and the losers of the seven-eight play-in games get one.</p>
        <p class="small">Boston holds: ${bos.map(p => L.pickName(W, p.id) + (p.note ? ` (${esc(p.note)})` : "")).join(", ") || "no picks"}.</p>
        ${W.settings.expansion && year === 2028 && !W.expanded ? `<p class="notice">The expansion draft runs right after this draft. Boston protects: ${L.protectList(W, "BOS", W.season + 1).map(p => esc(p.n)).join(", ")}. <button class="linkish" type="button" data-act="expEdit">Change protections</button></p>` : ""}
        <button class="btn" type="button" data-act="seLottery">Run the lottery</button></div>`;
      return body;
    }
    const s = ds.slots[ds.next];
    const lotteryList = ds.slots.slice(0, 16).map(x => `<li${x.owner === "BOS" ? ' style="font-weight:700"' : ""}>${esc(W.T[x.owner] ? W.T[x.owner].name : x.owner)}${x.owner !== x.from ? ` <span class="small muted">(from ${esc(x.from)})</span>` : ""}${x.pick ? ` <span class="small">took ${esc(W.draft[ds.year].find(y => y.id === x.pick).n)}</span>` : ""}</li>`).join("");
    if (s && s.owner === "BOS" && !ds.done) {
      const ours = L.boardFor(W, "BOS"), ourRank = new Map(ours.map((x, k) => [x.id, k + 1]));
      const sortBy = App.ui.dfSort || "ours";
      const av = (sortBy === "ours" ? ours : L.available(W).slice().sort((a, b) => a.rank - b.rank)).slice(0, 40);
      const open = L.twoWays(W, "BOS", W.season + 1).length < 3;
      body += `<div class="card" style="margin-top:16px"><h3>Boston is on the clock: No. ${s.slot}</h3>
        ${s.round === 2 ? `<label class="chk"><input type="checkbox" data-on="dfTwo"${ds.bosTwo !== false && open ? " checked" : ""}${open ? "" : " disabled"}><span>Sign him to a two-way deal (no cap hit, two seasons). ${open ? "Most second-rounders start here." : "All three two-way spots are full, so he gets a standard minimum deal."}</span></label>` : ""}
        <div class="seg" role="group" aria-label="Sort the board" style="margin:6px 0"><button type="button" aria-pressed="${sortBy === "ours"}" data-act="dfSort" data-k="ours">Boston's board</button><button type="button" aria-pressed="${sortBy === "cons"}" data-act="dfSort" data-k="cons">Consensus</button></div>
        <p class="small muted">Consensus is ESPN's board for 2027 and ESPN's recruiting rankings for later classes (real names through 2030, generated after that). Boston's board is your scouts' read: their own grades, roster needs, and a lean toward young upside. Every front office has its own board, so players go off the consensus order. Who actually pans out is hidden until he plays. ${s.pid ? `<button class="linkish" type="button" data-act="dfTrade" data-id="${s.pid}">Trade this pick instead</button>` : ""}</p>
        <table class="std"><thead><tr><th scope="col">Ours</th><th scope="col">Prospect</th><th scope="col">Consensus</th><th scope="col">Now</th><th scope="col">Ceiling</th><th scope="col"><span class="sr">Pick</span></th></tr></thead><tbody>
        ${av.map(x => `<tr><td>${ourRank.get(x.id)}</td><td style="text-align:left">${esc(x.n)}<span class="pmeta small muted" style="display:block">${esc(x.pos)}, ${esc(x.school)}, ${x.age}${L.needAt(W, "BOS", x.pos === "C" ? "B" : x.pos === "PF" || x.pos === "SF" ? "W" : "G") ? ", fills a need" : ""}</span></td><td>${x.rank}</td><td>${App.ovr({ o: x.estNow * 0.6, d: x.estNow * 0.4 })}</td><td>${App.ovr({ o: x.estPot * 0.6, d: x.estPot * 0.4 })}</td><td><button class="btn sm" type="button" data-act="dfPick" data-id="${x.id}">Draft</button></td></tr>`).join("")}</tbody></table></div>`;
    } else if (!ds.done) {
      body += `<div class="card" style="margin-top:16px"><button class="btn" type="button" data-act="dfRun">${ds.slots.slice(ds.next).some(x => x.owner === "BOS") ? "Draft until Boston's pick" : "Finish the draft"}</button></div>`;
    }
    body += `<div class="card" style="margin-top:16px"><h3>Lottery results</h3><ol style="margin:0;padding-left:20px">${lotteryList}</ol></div>`;
    if (ds.next >= ds.slots.length && !ds.done) body += `<div class="card" style="margin-top:16px"><button class="btn" type="button" data-act="dfDone">On to option decisions</button></div>`;
    return body;
  }
  App.acts.seLottery = () => { L.runLottery(App.W); L.draftToBoston(App.W); App.afterChange(); };
  App.acts.dfSort = el => { App.ui.dfSort = el.dataset.k; App.render(); };
  App.acts.dfTwo = el => { App.W.ds.bosTwo = el.checked; App.render(); };
  App.acts.dfPick = el => { L.makePick(App.W, el.dataset.id); L.draftToBoston(App.W); App.afterChange(); };
  App.acts.dfRun = () => { L.draftToBoston(App.W); App.afterChange(); };
  App.acts.dfDone = () => { L.finishDraft(App.W); App.afterChange(); };
  App.acts.dfTrade = el => { App.ui.trade = App.newTrade(App.ui.trade ? App.ui.trade.b : "UTA"); App.ui.trade.side.BOS.picks = [el.dataset.id]; App.ui.compose = "trade"; App.go("moves"); };
  App.acts.expEdit = () => {
    const W = App.W, i = W.season + 1, dec = L.decider(W);
    const ps = Object.values(W.P).filter(p => p.t === "BOS" && !p.two && CBA.salaryIn(p, i, dec) > 0);
    const cur = new Set(L.protectList(W, "BOS", i).map(p => p.id));
    App.dlg("Protect eight", `<p class="small">Pick up to eight players to protect. Everyone else under contract for ${App.sn(i)} is exposed; an expansion team can take one of them.</p>
      <div class="pick-list">${ps.map(p => `<label><input type="checkbox" name="prot" value="${p.id}"${cur.has(p.id) ? " checked" : ""}><span>${esc(p.n)} <span class="m">rated ${App.ovr(p)}, ${p.age}</span></span><span class="m">${m(CBA.salaryIn(p, i, dec))}</span></label>`).join("")}</div>
      <div class="row" style="margin-top:10px"><button class="btn" type="button" data-act="expSave">Save</button></div>`);
  };
  App.acts.expSave = () => { const ids = [...document.querySelectorAll('#dlg input[name=prot]:checked')].map(x => x.value).slice(0, 8); App.W.expProtect = ids; App.closeDlg(); App.afterChange(); };

  // ---------- Expansion ----------
  function expansionHTML(W) {
    const i = W.season + 1, dec = L.decider(W);
    if (W.expanded && W.expResult) {
      const res = W.expResult.picks, mine = res.find(x => x.from === "BOS");
      return `<div class="card"><h3>Expansion draft results</h3>
        <p>${mine ? `<b>Boston lost ${esc(mine.name)}</b> (${m(mine.sal)} in ${App.sn(i)}) to ${esc(W.T[mine.to].name)}.` : "<b>Boston kept everyone.</b>"} Seattle and Las Vegas took ${res.length} players in all; Memphis moves to the East.</p>
        <ol class="small" style="padding-left:20px;columns:2 260px">${res.map(x => `<li${x.from === "BOS" ? ' style="font-weight:700"' : ""}>${esc(x.name)} <span class="muted">(${esc(x.from)} to ${esc(x.to)}, ${m(x.sal)})</span></li>`).join("")}</ol>
        <button class="btn" type="button" data-act="exDone">On to option decisions</button></div>`;
    }
    const prot = L.protectList(W, "BOS", i);
    const under = Object.values(W.P).filter(p => p.t === "BOS" && !p.two && CBA.salaryIn(p, i, dec) > 0 && p.since !== i);
    const exposed = under.filter(p => !prot.includes(p));
    return `<div class="card"><h3>The expansion draft</h3>
      <p>Seattle and Las Vegas join for ${App.sn(i)}. Every team protects up to eight players under contract next season and loses at most one; this year's draft picks are exempt. The new teams take the best value they can find, alternating picks.</p>
      <p><b>Boston protects:</b> ${prot.map(p => esc(p.n)).join(", ") || "nobody"}. <button class="linkish" type="button" data-act="expEdit">Change protections</button></p>
      <p><b>Exposed:</b> ${exposed.map(p => `${esc(p.n)} (${m(CBA.salaryIn(p, i, dec))})`).join(", ") || "nobody: Boston can protect everyone under contract"}.</p>
      <button class="btn" type="button" data-act="exRun">Run the expansion draft</button></div>`;
  }
  App.acts.exOpen = () => { App.W.phase = "expansion"; App.afterChange(); };
  App.acts.exRun = () => { const W = App.W; W.phase = "expansion"; L.runExpansion(W); const mine = W.expResult.picks.find(x => x.from === "BOS"); flash(true, mine ? `Expansion draft done. Boston lost ${mine.name}.` : "Expansion draft done. Boston kept everyone."); App.afterChange(); };
  App.acts.exDone = () => { App.W.phase = "options"; App.afterChange(); };

  // ---------- Options ----------
  function optionsHTML(W) {
    const j = W.season + 1;
    const ps = Object.values(W.P).filter(p => p.t === "BOS" && p.c.opt[j] && !p.c.dec[j] && p.c.opt[j] !== "NG");
    const rows = ps.map(p => {
      const v = L.optionView(W, p, j), re = W.plan.resign[p.id];
      const kind = p.c.opt[j];
      let ctl = "";
      if (kind === "TO" || kind === "MO") {
        const set = W.plan.opt[p.id + "@" + j] || (v.teamWants ? "in" : "out");
        ctl = `<div class="seg" role="group" aria-label="Boston's call on ${esc(p.n)}"><button type="button" aria-pressed="${set === "in"}" data-act="opSet" data-id="${p.id}" data-v="in">Pick it up</button><button type="button" aria-pressed="${set === "out"}" data-act="opSet" data-id="${p.id}" data-v="out">Decline</button></div>`;
      }
      const odds = kind === "PO" || kind === "MO" ? App.optRead(W, p, j) : `On-court value about ${m(v.mv)}, market about ${m(v.mkt)}.`;
      const deal = re && re.label === "Opt-out and re-sign" ? `<br><span class="chip g">Opt-out deal on the table: ${re.sal.length} years, ${m(re.sal.reduce((a, b) => a + b, 0))} (${App.pct(Mo.optOutDealOdds(p, j, re.sal.length, re.sal.reduce((a, b) => a + b, 0), W).odds)} he takes it)</span>` : (kind === "PO" ? `<br><button class="linkish small" type="button" data-act="optout" data-id="${p.id}" data-j="${j}">Offer an opt-out deal</button>` : "");
      return `<li style="padding:10px 0;border-bottom:1px solid var(--line)"><b>${esc(p.n)}</b>: ${esc(CBA.OPT_NAME[kind])} for ${App.sn(j)}, ${m2(p.c.sal[j])}.<br><span class="small muted">${esc(odds)}</span>${deal}<div style="margin-top:6px">${ctl}</div></li>`;
    }).join("");
    // expiring deals: re-sign plans and renounce calls
    const dec = L.decider(W);
    const exp = Object.values(W.P).filter(p => p.t === "BOS" && !p.two && CBA.salaryIn(p, W.season, dec) > 0 && !(CBA.salaryIn(p, j, dec) > 0) && !(p.c.opt[j] && !p.c.dec[j]));
    return `<div class="card"><p style="margin-top:0">June 29. Players decide their options, CPU teams decide theirs, and you make Boston's calls. Then free agency opens July 1 and ${App.sn(j)} begins on the books.</p>
      <ul class="plain">${rows || "<li class='muted'>No Boston options this summer.</li>"}</ul>
      ${exp.length ? `<h3 style="margin-top:14px">Deals ending</h3><ul class="plain">${exp.map(p => { const h = CBA.holdFor(p, j, p.c.sal[W.season]); return `<li style="padding:8px 0;border-bottom:1px solid var(--line)"><b>${esc(p.n)}</b> <span class="small muted">${esc(h.bird)} rights, hold ${m(h.amt)}${h.qo ? `, restricted (qualifying offer ${m(h.qo)})` : ""}</span>${h.qo ? `<label class="chk small"><input type="checkbox" data-on="opQo" data-id="${p.id}"${(W.plan.qo || {})[p.id] !== false ? " checked" : ""}><span>Tender the ${m(h.qo)} qualifying offer (makes him a restricted free agent you can match)</span></label>` : ""}<label class="chk small"><input type="checkbox" data-on="opRenounce" data-id="${p.id}"${W.plan.renounce[p.id] ? " checked" : ""}><span>Renounce his rights (frees the cap hold)</span></label></li>`; }).join("")}</ul>
      <p class="small muted">In free agency you can re-sign anyone whose rights you keep (Bird rights let you go over the cap), match offer sheets for restricted free agents, or sign-and-trade them.</p>` : `<p class="small muted">No Boston contracts end this summer${W.season === 0 ? ". The first restricted free agent on the roster is Baylor Scheierman, in 2028" : ""}.</p>`}
      <button class="btn" type="button" data-act="opGo" style="margin-top:12px">Make the calls and open free agency</button></div>`;
  }
  App.acts.opSet = el => { App.W.plan.opt[el.dataset.id + "@" + (App.W.season + 1)] = el.dataset.v; App.afterChange(); };
  App.acts.opQo = el => { App.W.plan.qo = App.W.plan.qo || {}; App.W.plan.qo[el.dataset.id] = el.checked; App.afterChange(); };
  App.acts.opRenounce = el => { if (el.checked) App.W.plan.renounce[el.dataset.id] = true; else delete App.W.plan.renounce[el.dataset.id]; App.afterChange(); };
  App.acts.opGo = () => { const W = App.W; const out = L.optionCalls(W); L.newLeagueYear(W); const calls = (W.offers || []).filter(o => !o.done).length; flash(true, (out.join(" ") || "Options settled.") + ` Free agency is open. Make your offers, then run round 1.${calls ? ` ${calls} sign-and-trade call${calls > 1 ? "s" : ""} already in.` : ""}`); App.afterChange(); };

  // ---------- Free agency ----------
  function faHTML(W) {
    const mine = Object.values(W.P).filter(p => p.t === "FA" && p.rights && p.rights.team === "BOS" && !p.rights.renounced);
    const sheets = Object.values(W.P).filter(p => p.t === "FA" && p.offerSheet && p.rights && p.rights.team === "BOS");
    const b = L.budget(W, "BOS");
    const F = App.faFilters(W, "faFit");
    const market = Object.values(W.P).filter(p => p.t === "FA" && !(p.rights && p.rights.team === "BOS" && !p.rights.renounced) && F.fit(p)).sort((a, b) => Mo.r(b) - Mo.r(a)).slice(0, 40);
    const calls = (W.offers || []).filter(o => !o.done);
    const round = W.faRound || 0;
    return `<div class="card">
        <p style="margin-top:0">Round ${Math.min(round + 1, 4)} of 4, ${esc(L.fmtDate(W.date))}. Boston: ${m(b.pay)} in salary, ${b.n} players on standard deals, ${L.twoWays(W, "BOS").length} of 3 two-way spots. Tools: ${b.opts.map(o => `${App.TOOL[o.via].toLowerCase()} ${m(o.amt)}`).join(", ")}.</p>
        ${sheets.map(p => `<div class="notice"><b>Offer sheet:</b> ${esc(W.T[p.offerSheet.code].name)} offered ${esc(p.n)} ${p.offerSheet.years} years, ${m(p.offerSheet.total)}. <button class="btn sm" type="button" data-act="faMatch" data-id="${p.id}" data-v="1">Match</button> <button class="btn ghost sm" type="button" data-act="faMatch" data-id="${p.id}" data-v="0">Let him go</button></div>`).join("")}
        <div class="row">${round < 4 ? `<button class="btn" type="button" data-act="faNext">Run round ${round + 1}</button>` : `<button class="btn" type="button" data-act="faCamp">To training camp</button>`}</div>
        <p class="small muted">Offers go out when the round runs. Players weigh money, years and how good the team is; asks come down each round. After round 4, anyone good who's left signs wherever there's money or a spot.</p>
      </div>
      ${calls.length ? `<div class="card" style="margin-top:16px"><h3>Sign-and-trade calls</h3><p class="small muted" style="margin-top:0">Teams that want one of your free agents but can't fit him with cap room or an exception. They'd sign him to a new deal with Boston and take him in a trade.</p>${offerCards(W)}</div>` : ""}
      <div class="card" style="margin-top:16px"><h3>Your free agents</h3>${mine.length ? App.faList(W, mine, true) + `<p class="small muted">Re-sign on Bird rights (over the cap is fine), sign-and-trade him (three or four years; the team getting him must stay under the first apron), or renounce to clear the hold. Restricted free agents can sign offer sheets elsewhere; you get to match.</p>` : `<p class="muted">None this summer.</p>`}</div>
      <div class="card" style="margin-top:16px"><h3>The market</h3>${F.html}${App.faList(W, market, false)}</div>`;
  }
  App.acts.faRenounce = el => { const p = App.W.P[el.dataset.id]; if (p && p.rights) p.rights.renounced = true; delete (App.W.faOffers || {})[p.id]; flash(true, `Renounced ${p.n}. His hold is off the books.`); App.afterChange(); };
  App.acts.faSnt = el => {
    const W = App.W, p = W.P[el.dataset.id], ask = Mo.faHaul(p, W.season, W);
    const tr = App.newTrade(App.ui.trade && App.ui.trade.b !== "BOS" ? App.ui.trade.b : "UTA");
    tr.side.BOS.players = [p.id];
    const y1 = CBA.k1(Math.min(ask.aav, CBA.maxSal(p.yos, W.season)) / L.raiseFac(3, 0.05));
    tr.snt = { [p.id]: { sal: [0, 1, 2].map(k => CBA.k1(y1 * (1 + 0.05 * k))) } };
    App.ui.trade = tr; App.ui.compose = "trade"; App.go("moves");
  };
  App.acts.faMatch = el => { L.matchSheet(App.W, el.dataset.id, el.dataset.v === "1"); App.afterChange(); };
  App.acts.faNext = () => { const s = L.faRound(App.W); const bos = s.filter(id => App.W.P[id].t === "BOS"); const calls = (App.W.offers || []).filter(o => !o.done).length; flash(true, `${s.length} signings this round${bos.length ? `, including ${bos.map(id => App.W.P[id].n).join(", ")} with Boston` : ""}.${calls ? ` ${calls} sign-and-trade call${calls > 1 ? "s" : ""} waiting.` : ""}`); App.afterChange(); };
  App.acts.faCamp = () => { L.toCamp(App.W); flash(true, "Rosters are set for camp."); App.afterChange(); };

  // ---------- History ----------
  function historyCard(W) {
    const h = W.hist || [];
    return `<section class="card" aria-labelledby="hist-h"><h3 id="hist-h">Your seasons</h3>
      ${h.length ? `<table class="std"><thead><tr><th scope="col">Season</th><th scope="col">Record</th><th scope="col">Result</th><th scope="col">Payroll</th><th scope="col">Tax</th></tr></thead><tbody>${h.map(x => `<tr><td>${App.sn(x.season)}</td><td style="text-align:left">${x.w}-${x.l}</td><td>${esc(x.run)}</td><td>${m(x.payroll)}</td><td>${m(x.tax)}</td></tr>`).join("")}</tbody></table>` : "<p class='muted'>Finish a season and it shows up here.</p>"}
      ${(W.titles || []).length ? `<p><b>Banners won:</b> ${W.titles.join(", ")}.</p>` : ""}</section>`;
  }
})();
