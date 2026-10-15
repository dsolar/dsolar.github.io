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
      if (ph === "pre") main = preHTML(W);
      else if (ph === "reg" || ph === "reg2") main = regHTML(W);
      else if (ph === "deadline") main = deadlineHTML(W);
      else if (ph === "playoffs") main = playoffsHTML(W);
      else if (ph === "draft") main = draftHTML(W);
      else if (ph === "options") main = optionsHTML(W);
      else if (ph === "fa") main = faHTML(W);
      el.innerHTML = `<section class="panel" aria-labelledby="season-h">
        <h2 id="season-h">${esc(L.PHASE_NAME[ph])}, ${App.sn(W.season)}</h2>
        ${App.ui.flash ? `<div class="notice ${App.ui.flash.ok ? "good" : "bad"}" role="status">${esc(App.ui.flash.text)}</div>` : ""}
        ${main}
      </section>
      <div class="grid2">
        <section class="card" aria-labelledby="news-h"><h3 id="news-h">Around the league</h3>${newsList(W, 14)}</section>
        ${historyCard(W)}
      </div>`;
      App.ui.flash = null;
    }
  };
  const flash = (ok, text) => { App.ui.flash = { ok, text }; };

  // ---------- Preseason ----------
  function preHTML(W) {
    const rec = W.season === 0 ? L.liveStart(W) : null;
    const nets = L.teamNets(W), top = Object.entries(nets).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const n = L.rosterCount(W, "BOS");
    return `<div class="grid2">
      <div class="card">
        <h3>Opening night: ${esc(L.fmtDate(L.dates(W.season).open))}</h3>
        <p>Boston projects to ${Math.round(L.projWins(W, "BOS"))} wins with ${App.pct(App.titleOdds().BOS || 0)} title odds. ${n} players under contract${n < 14 ? `; you need at least 14 (sign someone in Moves)` : n > 15 ? `; cut to 15 first (Moves: waive)` : ""}.</p>
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
  function settingsCard(W) {
    const s = W.settings;
    return `<div class="card" style="margin-top:16px"><h3>Settings</h3>
      <label style="display:flex;gap:8px;align-items:flex-start;margin:6px 0"><input type="checkbox" data-on="setExp"${s.expansion ? " checked" : ""}${W.expanded || W.season > 1 ? " disabled" : ""}> <span><b>Expansion draft before the 2028 draft.</b> <span class="small muted">Seattle and Las Vegas join for 2028-29 under 2004 Bobcats rules (protect eight, lose at most one). Not approved in real life yet.</span></span></label>
      <label style="display:flex;gap:8px;align-items:flex-start;margin:6px 0"><input type="checkbox" data-on="setTax"${s.noTax0 ? " checked" : ""}> <span><b>Warn me before any move that puts Boston in the tax in 2026-27.</b></span></label>
    </div>`;
  }
  App.acts.setExp = el => { App.W.settings.expansion = el.checked; App.afterChange(); };
  App.acts.setTax = el => { App.W.settings.noTax0 = el.checked; App.afterChange(); };
  App.acts.seStart = () => { const r = L.startSeason(App.W); if (!r.ok) flash(false, r.why); App.afterChange(); };

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
      <div class="grid2" style="margin-top:16px"><div class="card">${standingsTable(W, "E")}</div><div class="card">${standingsTable(W, "W")}</div></div>`;
  }
  App.acts.seWeek = () => { L.simDays(App.W, 7); App.afterChange(); };
  App.acts.seDeadline = () => { const W = App.W; L.simUntil(W, L.dates(W.season).deadline); L.openDeadline(W); App.afterChange(); };
  App.acts.seEnd = () => { L.finishRegular(App.W); App.afterChange(); };

  // ---------- Deadline ----------
  function deadlineHTML(W) {
    const offers = (W.offers || []).filter(o => !o.done);
    const cards = offers.map(o => {
      const A = App.analyzeTrade(o.tr);
      const legal = A.chk.ok;
      const tpe = (A.chk.teams.BOS.sol.newTpes || []).filter(t => t.amt >= 250000);
      const used = (A.chk.teams.BOS.sol.used || []);
      return `<div class="offer"><div class="fo"><b>${esc(W.T[o.from].name)}</b><span class="muted small">${esc(W.T[o.from].fo.lead)}</span><span class="chip">${App.MODE_NAME[W.T[o.from].fo.mode]}</span></div>
        <p style="margin:6px 0">${esc(o.note)}</p>
        <p class="small" style="margin:0"><b>Boston gets:</b> ${esc(tradeLine(W, o.tr, o.from))}<br><b>Boston sends:</b> ${esc(tradeLine(W, o.tr, "BOS"))}</p>
        <p class="small muted" style="margin:6px 0 0">Boston's read: ${A.ours >= 0 ? "+" : ""}${m(A.ours)}. Payroll ${m(A.chk.teams.BOS.P)} → ${m(A.chk.teams.BOS.P2)}${A.after ? `, projected wins ${A.before.BOS.toFixed(0)} → ${A.after.BOS.toFixed(0)}` : ""}.${used.length ? ` Uses ${m(used[0].amt)} of a trade exception.` : ""}${tpe.length ? ` Leaves a ${m(tpe[0].amt)} exception.` : ""}${!legal ? " Not legal anymore: " + esc(Object.values(A.chk.teams).flatMap(t => t.msgs).join(" ")) : ""}
        ${A.bAfter && W.season === 0 && A.bAfter[0].payroll > A.bAfter[0].taxLine ? `<br><span class="warnc">Puts Boston in the tax this season.</span>` : ""}</p>
        <div class="row" style="margin-top:8px"><button class="btn sm" type="button" data-act="ofYes" data-id="${o.id}"${legal ? "" : " disabled"}>Accept</button><button class="btn ghost sm" type="button" data-act="ofNo" data-id="${o.id}">Pass</button><button class="btn ghost sm" type="button" data-act="ofEdit" data-id="${o.id}">Counter in the trade builder</button></div></div>`;
    }).join("");
    return `<div class="card"><p style="margin-top:0">Deadline week runs through ${esc(L.fmtDate(L.dates(W.season).deadlineEnd))}. Boston is ${W.T.BOS.w}-${W.T.BOS.l}. Calls that came in:</p>
      ${cards || "<p class='muted'>No calls waiting. Build your own in Moves.</p>"}
      <div class="row"><button class="btn" type="button" data-act="seClose">Close the deadline and play on</button><button class="btn ghost" type="button" data-act="seMore">Call around for more</button></div></div>
      <div class="grid2" style="margin-top:16px"><div class="card">${standingsTable(W, "E")}</div><div class="card">${standingsTable(W, "W")}</div></div>`;
  }
  App.acts.ofYes = el => { const r = L.acceptOffer(App.W, el.dataset.id); flash(r.ok, r.ok ? "Done. The trade went through." : r.why); App.afterChange(); };
  App.acts.ofNo = el => { const o = App.W.offers.find(x => x.id === el.dataset.id); if (o) { o.done = true; o.result = "passed"; } App.afterChange(); };
  App.acts.ofEdit = el => { const o = App.W.offers.find(x => x.id === el.dataset.id); App.ui.trade = JSON.parse(JSON.stringify(o.tr)); App.ui.compose = "trade"; App.go("moves"); };
  App.acts.seClose = () => { L.closeDeadline(App.W); App.afterChange(); };
  App.acts.seMore = () => { const W = App.W; const more = L.makeOffers(W, 3); W.offers = W.offers.concat(more); flash(true, more.length ? `${more.length} more call${more.length > 1 ? "s" : ""}.` : "Nobody else is biting."); App.afterChange(); };

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
    let body = `<div class="card"><p style="margin-top:0"><b>${esc(run || "")}.</b> ${W.post ? `Champion: ${esc(W.T[W.post.champ].name)}.` : ""}</p>${bracketHTML(W)}</div>`;
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
      const av = L.available(W).slice(0, 40);
      body += `<div class="card" style="margin-top:16px"><h3>Boston is on the clock: No. ${s.slot}</h3>
        <p class="small muted">Scouting grades are the public consensus (ESPN's board for 2027). Who actually pans out is hidden until he plays.</p>
        <table class="std"><thead><tr><th scope="col">Board</th><th scope="col">Prospect</th><th scope="col">Now</th><th scope="col">Ceiling</th><th scope="col"><span class="sr">Pick</span></th></tr></thead><tbody>
        ${av.map(x => `<tr><td>${x.rank}</td><td style="text-align:left">${esc(x.n)}<span class="pmeta small muted" style="display:block">${esc(x.pos)}, ${esc(x.school)}, ${x.age}</span></td><td>${App.ovr({ o: x.estNow * 0.6, d: x.estNow * 0.4 })}</td><td>${App.ovr({ o: x.estPot * 0.6, d: x.estPot * 0.4 })}</td><td><button class="btn sm" type="button" data-act="dfPick" data-id="${x.id}">Draft</button></td></tr>`).join("")}</tbody></table></div>`;
    } else if (!ds.done) {
      body += `<div class="card" style="margin-top:16px"><button class="btn" type="button" data-act="dfRun">${ds.slots.slice(ds.next).some(x => x.owner === "BOS") ? "Draft until Boston's pick" : "Finish the draft"}</button></div>`;
    }
    body += `<div class="card" style="margin-top:16px"><h3>Lottery results</h3><ol style="margin:0;padding-left:20px">${lotteryList}</ol></div>`;
    if (ds.next >= ds.slots.length && !ds.done) body += `<div class="card" style="margin-top:16px"><button class="btn" type="button" data-act="dfDone">On to option decisions</button></div>`;
    return body;
  }
  App.acts.seLottery = () => { L.runLottery(App.W); L.draftToBoston(App.W); App.afterChange(); };
  App.acts.dfPick = el => { L.makePick(App.W, el.dataset.id); L.draftToBoston(App.W); App.afterChange(); };
  App.acts.dfRun = () => { L.draftToBoston(App.W); App.afterChange(); };
  App.acts.dfDone = () => { L.finishDraft(App.W); App.afterChange(); };
  App.acts.expEdit = () => {
    const W = App.W, i = W.season + 1, dec = L.decider(W);
    const ps = Object.values(W.P).filter(p => p.t === "BOS" && !p.two && CBA.salaryIn(p, i, dec) > 0);
    const cur = new Set(L.protectList(W, "BOS", i).map(p => p.id));
    App.dlg("Protect eight", `<p class="small">Pick up to eight players to protect. Everyone else under contract for ${App.sn(i)} is exposed; an expansion team can take one of them.</p>
      <div class="pick-list">${ps.map(p => `<label><input type="checkbox" name="prot" value="${p.id}"${cur.has(p.id) ? " checked" : ""}><span>${esc(p.n)} <span class="m">rated ${App.ovr(p)}, ${p.age}</span></span><span class="m">${m(CBA.salaryIn(p, i, dec))}</span></label>`).join("")}</div>
      <div class="row" style="margin-top:10px"><button class="btn" type="button" data-act="expSave">Save</button></div>`);
  };
  App.acts.expSave = () => { const ids = [...document.querySelectorAll('#dlg input[name=prot]:checked')].map(x => x.value).slice(0, 8); App.W.expProtect = ids; App.closeDlg(); App.afterChange(); };

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
      const odds = kind === "PO" || kind === "MO" ? `He picks it up: ${App.pct(v.pIn)}.` : "";
      const deal = re && re.label === "Opt-out and re-sign" ? `<br><span class="chip g">Opt-out deal on the table: ${re.sal.length} years, ${m(re.sal.reduce((a, b) => a + b, 0))} (${App.pct(Mo.optOutDealOdds(p, j, re.sal.length, re.sal.reduce((a, b) => a + b, 0), W).odds)} he takes it)</span>` : (kind === "PO" ? `<br><button class="linkish small" type="button" data-act="optout" data-id="${p.id}" data-j="${j}">Offer an opt-out deal</button>` : "");
      return `<li style="padding:10px 0;border-bottom:1px solid var(--line)"><b>${esc(p.n)}</b>: ${esc(CBA.OPT_NAME[kind])} for ${App.sn(j)}, ${m2(p.c.sal[j])}. <span class="small muted">Worth ${m(v.mv)} by the model. ${odds}</span>${deal}<div style="margin-top:6px">${ctl}</div></li>`;
    }).join("");
    // expiring deals: re-sign plans and renounce calls
    const dec = L.decider(W);
    const exp = Object.values(W.P).filter(p => p.t === "BOS" && !p.two && CBA.salaryIn(p, W.season, dec) > 0 && !(CBA.salaryIn(p, j, dec) > 0) && !(p.c.opt[j] && !p.c.dec[j]));
    return `<div class="card"><p style="margin-top:0">June 29. Players decide their options, CPU teams decide theirs, and you make Boston's calls. Then free agency opens July 1 and ${App.sn(j)} begins on the books.</p>
      <ul class="plain">${rows || "<li class='muted'>No Boston options this summer.</li>"}</ul>
      ${exp.length ? `<h3 style="margin-top:14px">Deals ending</h3><ul class="plain">${exp.map(p => { const h = CBA.holdFor(p, j, p.c.sal[W.season]); return `<li style="padding:6px 0;border-bottom:1px solid var(--line)"><b>${esc(p.n)}</b> <span class="small muted">${esc(h.bird)} rights, hold ${m(h.amt)}${h.qo ? `, restricted (qualifying offer ${m(h.qo)})` : ""}</span> <label class="small" style="margin-left:8px"><input type="checkbox" data-on="opRenounce" data-id="${p.id}"${W.plan.renounce[p.id] ? " checked" : ""}> Renounce${h.qo ? " (no qualifying offer)" : ""}</label></li>`; }).join("")}</ul>` : ""}
      <button class="btn" type="button" data-act="opGo" style="margin-top:12px">Make the calls and open free agency</button></div>`;
  }
  App.acts.opSet = el => { App.W.plan.opt[el.dataset.id + "@" + (App.W.season + 1)] = el.dataset.v; App.afterChange(); };
  App.acts.opRenounce = el => { if (el.checked) App.W.plan.renounce[el.dataset.id] = true; else delete App.W.plan.renounce[el.dataset.id]; App.afterChange(); };
  App.acts.opGo = () => { const W = App.W; const out = L.optionCalls(W); L.newLeagueYear(W); L.faRound(W); flash(true, (out.join(" ") || "Options settled.") + " Free agency is open; the first wave of deals is done."); App.afterChange(); };

  // ---------- Free agency ----------
  function faHTML(W) {
    const i = W.season;
    const mine = Object.values(W.P).filter(p => p.t === "FA" && p.rights && p.rights.team === "BOS" && !p.rights.renounced);
    const sheets = Object.values(W.P).filter(p => p.t === "FA" && p.offerSheet && p.rights && p.rights.team === "BOS");
    const market = Object.values(W.P).filter(p => p.t === "FA" && !(p.rights && p.rights.team === "BOS")).sort((a, b) => Mo.mv(b, i, W) - Mo.mv(a, i, W)).slice(0, 40);
    const b = L.budget(W, "BOS");
    const offers = W.faOffers || {};
    const row = p => {
      const ask = Mo.faHaul(p, i, W), o = offers[p.id];
      return `<tr><td style="text-align:left"><button class="linkish" type="button" data-act="player" data-id="${p.id}">${esc(p.n)}</button><span class="small muted" style="display:block">${esc(App.posName(p))}, ${p.age}, rated ${App.ovr(p)}${p.rights ? `, ${esc(W.T[p.rights.team] ? W.T[p.rights.team].name : "")}${p.rights.rfa ? " (restricted)" : ""}` : ""}</span></td><td>${m(ask.aav)} x ${ask.years}</td><td>${o ? `<span class="chip g">${o.years} yrs, ${m(o.total)}</span>${o.failed ? `<span class="small bad" style="display:block">${esc(o.failed)}</span>` : ""}` : ""}</td><td><button class="btn ghost sm" type="button" data-act="faOffer" data-id="${p.id}">${o ? "Change" : "Offer"}</button></td></tr>`;
    };
    return `<div class="card">
        <p style="margin-top:0">Round ${(W.faRound || 0) + 1} of free agency, ${esc(L.fmtDate(W.date))}. Boston's payroll: ${m(b.pay)}, ${b.n} players. Tools: ${b.opts.map(o => `${({ room: "cap room", ntmle: "non-taxpayer mid-level", tmle: "taxpayer mid-level", bae: "bi-annual", rmle: "room mid-level", min: "minimum", bird: "Bird rights" })[o.via]} ${m(o.amt)}`).join(", ")}.</p>
        ${sheets.map(p => `<div class="notice"><b>Offer sheet:</b> ${esc(W.T[p.offerSheet.code].name)} offered ${esc(p.n)} ${p.offerSheet.years} years, ${m(p.offerSheet.total)}. <button class="btn sm" type="button" data-act="faMatch" data-id="${p.id}" data-v="1">Match</button> <button class="btn ghost sm" type="button" data-act="faMatch" data-id="${p.id}" data-v="0">Let him go</button></div>`).join("")}
        <div class="row"><button class="btn" type="button" data-act="faNext">Next round</button>${(W.faRound || 0) >= 3 ? `<button class="btn ghost" type="button" data-act="faCamp">To training camp</button>` : ""}</div>
        <p class="small muted">Offers go out when you advance. Players weigh money, years, and how good the team is; asks come down each round. Sign-and-trades: build them in Moves while a player's rights are still yours.</p>
      </div>
      ${mine.length ? `<div class="card" style="margin-top:16px"><h3>Your free agents</h3><table class="std"><thead><tr><th scope="col">Player</th><th scope="col">Ask</th><th scope="col">Your offer</th><th scope="col"></th></tr></thead><tbody>${mine.map(row).join("")}</tbody></table><p class="small muted">You hold their rights (Bird rights let you go over the cap). Holds stay on the books until they sign or you renounce.</p></div>` : ""}
      <div class="card" style="margin-top:16px"><h3>The market</h3><table class="std"><thead><tr><th scope="col">Player</th><th scope="col">Ask</th><th scope="col">Your offer</th><th scope="col"></th></tr></thead><tbody>${market.map(row).join("")}</tbody></table></div>`;
  }
  App.acts.faMatch = el => { L.matchSheet(App.W, el.dataset.id, el.dataset.v === "1"); App.afterChange(); };
  App.acts.faNext = () => { const s = L.faRound(App.W); const bos = s.filter(id => App.W.P[id].t === "BOS"); flash(true, `${s.length} signings this round${bos.length ? `, including ${bos.map(id => App.W.P[id].n).join(", ")} with Boston` : ""}.`); App.afterChange(); };
  App.acts.faCamp = () => { L.toCamp(App.W); flash(true, "Rosters are set for camp."); App.afterChange(); };
  App.acts.faOffer = el => {
    const W = App.W, p = W.P[el.dataset.id], i = W.season, ask = Mo.faHaul(p, i, W);
    const b = L.budget(W, "BOS", p);
    const o = (W.faOffers || {})[p.id] || { years: Math.min(ask.years, 4), total: Math.round(ask.aav * Math.min(ask.years, 4)), via: b.opts[0].via };
    App.ui.fao = Object.assign({ id: p.id }, o);
    renderFAO();
  };
  function renderFAO() {
    const W = App.W, st = App.ui.fao, p = W.P[st.id], i = W.season, ask = Mo.faHaul(p, i, W), b = L.budget(W, "BOS", p);
    const tool = b.opts.find(o => o.via === st.via) || b.opts[0]; st.via = tool.via;
    const sal = CBA.buildSalaries(st.years, st.total, "flat", 0.05);
    const NAME = { room: "Cap room", ntmle: "Non-taxpayer mid-level", tmle: "Taxpayer mid-level", bae: "Bi-annual", rmle: "Room mid-level", min: "Minimum", bird: "Bird rights" };
    App.dlg(`Offer: ${p.n}`, `<p class="small">He's asking about ${m(ask.aav)} a year for ${ask.years} year${ask.years > 1 ? "s" : ""}.</p>
      <div class="row"><label class="f">Using<select data-on="faoVia">${b.opts.map(o => `<option value="${o.via}"${o.via === st.via ? " selected" : ""}>${NAME[o.via]} (${m(o.amt)})</option>`).join("")}</select></label>
      <label class="f">Years<select data-on="faoYears">${[1, 2, 3, 4, 5].filter(y => st.via === "bird" || y <= 4).map(y => `<option${y === st.years ? " selected" : ""}>${y}</option>`).join("")}</select></label>
      <label class="f">Total ($M)<input type="number" step="0.1" min="0.5" value="${(st.total / 1e6).toFixed(1)}" data-on="faoTotal"></label></div>
      <p class="small">${sal.map((x, k) => `${App.sn(i + k)} ${m2(x)}`).join(", ")}${sal[0] > tool.amt + 1000 ? ` <span class="bad">First year is over the ${m(tool.amt)} available.</span>` : ""}</p>
      <div class="row"><button class="btn" type="button" data-act="faoSave"${sal[0] > tool.amt + 1000 ? " disabled" : ""}>Make the offer</button>${(W.faOffers || {})[p.id] ? `<button class="btn ghost" type="button" data-act="faoPull">Pull it</button>` : ""}</div>`);
  }
  App.acts.faoVia = el => { App.ui.fao.via = el.value; renderFAO(); };
  App.acts.faoYears = el => { App.ui.fao.years = +el.value; renderFAO(); };
  App.acts.faoTotal = el => { App.ui.fao.total = Math.round((+el.value || 0) * 1e6); renderFAO(); };
  App.acts.faoSave = () => { const W = App.W, st = App.ui.fao; W.faOffers = W.faOffers || {}; W.faOffers[st.id] = { years: st.years, total: st.total, via: st.via, shape: "flat" }; App.closeDlg(); App.afterChange(); };
  App.acts.faoPull = () => { delete App.W.faOffers[App.ui.fao.id]; App.closeDlg(); App.afterChange(); };

  // ---------- History ----------
  function historyCard(W) {
    const h = W.hist || [];
    return `<section class="card" aria-labelledby="hist-h"><h3 id="hist-h">Your seasons</h3>
      ${h.length ? `<table class="std"><thead><tr><th scope="col">Season</th><th scope="col">Record</th><th scope="col">Result</th><th scope="col">Payroll</th><th scope="col">Tax</th></tr></thead><tbody>${h.map(x => `<tr><td>${App.sn(x.season)}</td><td style="text-align:left">${x.w}-${x.l}</td><td>${esc(x.run)}</td><td>${m(x.payroll)}</td><td>${m(x.tax)}</td></tr>`).join("")}</tbody></table>` : "<p class='muted'>Finish a season and it shows up here.</p>"}
      ${(W.titles || []).length ? `<p><b>Banners won:</b> ${W.titles.join(", ")}.</p>` : ""}</section>`;
  }
})();
