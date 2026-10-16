/* Banner 19: the Moves tab. Trade builder, extensions, signings, waivers, and the ordered queue. */
(function () {
  "use strict";
  const App = window.App, L = window.League, CBA = window.CBA, Mo = window.Model;
  const esc = App.esc, m2 = App.m2, m = App.m;
  const lite = W => { const c = {}; for (const k of Object.keys(W)) if (!k.startsWith("_") && !["sched", "games", "news", "hist", "live", "draft"].includes(k)) c[k] = W[k]; const x = JSON.parse(JSON.stringify(c)); x.sched = []; x.games = []; x.news = []; x.draft = W.draft; x.live = W.live; return x; };
  App.lite = lite;
  const TAX_NAME = { pay: "Pays the tax to win", dodge: "Ducks the tax unless contending", never: "Won't pay the tax" };
  const MODE_NAME = { contend: "Contending", rise: "On the rise", retool: "Retooling", rebuild: "Rebuilding" };
  const WANT_NAME = { picks: "picks", youth: "young players", shooting: "shooting", defense: "defense", size: "size", stars: "stars", possessions: "possessions" };
  App.TAX_NAME = TAX_NAME; App.MODE_NAME = MODE_NAME;

  App.poss = n => /s$/.test(n) ? n + "'" : n + "'s";
  App.newTrade = partner => ({ a: "BOS", b: partner, side: { BOS: { players: [], picks: [], cash: 0 }, [partner]: { players: [], picks: [], cash: 0 } }, kickWaive: {} });
  App.tradeAdd = (code, id) => {
    let tr = App.ui.trade;
    if (!tr || (code !== "BOS" && tr.b !== code)) { tr = App.ui.trade = App.newTrade(code === "BOS" ? (tr ? tr.b : "UTA") : code); }
    const s = tr.side[code];
    if (!s.players.includes(id)) s.players.push(id);
  };

  // Everything the trade screen shows, computed on a copy of the league
  App.analyzeTrade = tr => {
    const W = App.W, i0 = W.season;
    const chk = L.checkTrade(W, tr);
    const react = L.aiReact(W, tr, tr.b);
    const ours = L.ourValue(W, tr);
    const before = { BOS: L.projWins(W, "BOS"), [tr.b]: L.projWins(W, tr.b) };
    const bBefore = [0, 1, 2].map(k => L.books(W, "BOS", i0 + k));
    let after = null, bAfter = null;
    const any = tr.side.BOS.players.length + tr.side[tr.b].players.length + (tr.side.BOS.picks || []).length + (tr.side[tr.b].picks || []).length;
    if (any) {
      const C = lite(W); L.bump(C);
      try { L.applyTrade(C, JSON.parse(JSON.stringify(tr))); after = { BOS: L.projWins(C, "BOS"), [tr.b]: L.projWins(C, tr.b) }; bAfter = [0, 1, 2].map(k => L.books(C, "BOS", i0 + k)); } catch (e) { console.error(e); }
    }
    return { chk, react, ours, before, after, bBefore, bAfter };
  };

  App.views.moves = {
    render(el) {
      const W = App.W, ui = App.ui;
      ui.compose = ui.compose || "trade";
      const window_ = ["reg2", "playoffs"].includes(W.phase) ? "The trade deadline has passed; trades reopen after the Finals. Signings and waivers are still open." : L.inSeason(W) ? `Trades are open until the deadline, ${L.fmtDate(L.dates(W.season).deadlineEnd)}.` : W.phase === "draft" ? "Draft season: trades are open, including the picks on the board." : "Offseason: trades, signings and extensions are open.";
      const tradesOpen = !["reg2", "playoffs"].includes(W.phase);
      el.innerHTML = `
      <section class="panel" aria-labelledby="moves-h">
        <h2 id="moves-h">Moves</h2>
        <p class="sub">${esc(window_)} Line moves up in the order you want them to happen. Each step is checked against the books as they'll stand after the steps before it, so order matters: a trade that takes back extra salary hard-caps you, an exception has to be used before it expires, and roster spots run out.</p>
        <div class="moves">
          <div class="card">${queueHTML(W)}</div>
          <div class="card">
            <div class="seg" role="group" aria-label="Kind of move">
              ${[["trade", "Trade"], ["shop", "Dump salary"], ["extend", "Extend"], ["sign", "Sign"], ["waive", "Waive"]].map(([k, n]) => `<button type="button" aria-pressed="${ui.compose === k}" data-act="compose" data-k="${k}">${n}</button>`).join("")}
            </div>
            <div id="composer" style="margin-top:14px">${ui.compose === "trade" ? (tradesOpen ? tradeHTML(W) : "<p class='muted'>The deadline has passed. Trades reopen after the Finals, before the draft.</p>") : ui.compose === "shop" ? (tradesOpen ? shopHTML(W) : "<p class='muted'>The deadline has passed. Trades reopen after the Finals, before the draft.</p>") : ui.compose === "extend" ? extendHTML(W) : ui.compose === "sign" ? signHTML(W) : waiveHTML(W)}</div>
          </div>
        </div>
      </section>`;
    }
  };
  App.acts.compose = el => { App.ui.compose = el.dataset.k; App.render(); };

  // ================= Trade builder =================
  function tradeHTML(W) {
    const ui = App.ui;
    if (!ui.trade) ui.trade = App.newTrade("UTA");
    const tr = ui.trade, P = tr.b, t = W.T[P], fo = t.fo, i0 = W.season, dec = L.decider(W);
    const teams = Object.values(W.T).filter(x => x.code !== "BOS").sort((a, b) => a.name.localeCompare(b.name));
    const list = (code, sideKey) => {
      const s = tr.side[code];
      const ps = Object.values(W.P).filter(p => p.t === code && !p.two).sort((a, b) => CBA.salaryIn(b, i0, dec) - CBA.salaryIn(a, i0, dec));
      const picks = W.picks.filter(p => p.owner === code && p.y >= 2027 + i0 + (L.inSeason(W) ? 0 : 0) && !(p.used)).sort((a, b) => a.y - b.y || a.r - b.r);
      const snt = W.phase === "fa" ? Object.values(W.P).filter(p => p.t === "FA" && p.rights && p.rights.team === code && !p.rights.renounced && !p.offerSheet).sort((a, b) => Mo.r(b) - Mo.r(a)) : [];
      const sntRows = snt.map(p => {
        const on = tr.snt && tr.snt[p.id], ask = Mo.faHaul(p, i0, W);
        return `<label><input type="checkbox" data-on="trSnt" data-code="${code}" data-id="${p.id}"${on ? " checked" : ""}><span>Sign-and-trade: ${esc(p.n)} <span class="m">free agent, asks ${m(Math.min(ask.aav, CBA.maxSal(p.yos, i0)))}</span></span><span class="m">${on ? m(on.sal[0]) + " x " + on.sal.length : ""}</span></label>${on ? `<div class="row" style="padding:6px 10px;border-bottom:1px solid var(--line)"><label class="f">Years<select data-on="trSntYears" data-id="${p.id}">${[3, 4].map(y => `<option${y === on.sal.length ? " selected" : ""}>${y}</option>`).join("")}</select></label><label class="f">First year ($M)<input type="number" step="0.5" min="1" value="${(on.sal[0] / 1e6).toFixed(1)}" data-on="trSntAav" data-id="${p.id}"></label></div>` : ""}`;
      }).join("");
      return `<div class="pick-list" role="group" aria-label="${esc(W.T[code].name)} sends">${sntRows}
        ${ps.map(p => `<label><input type="checkbox" data-on="trToggle" data-code="${code}" data-id="${p.id}"${s.players.includes(p.id) ? " checked" : ""}><span>${esc(p.n)} <span class="m">${esc(App.posName(p))}, ${p.age}, rated ${App.ovr(p)}</span></span><span class="m">${m(CBA.salaryIn(p, i0, dec))}${(p.c.opt[i0 + 1] ? " " + p.c.opt[i0 + 1] : "")}</span></label>`).join("")}
        ${picks.map(pk => {
          const on = (s.picks || []).includes(pk.id), pa = pk.alt ? W.picks.find(x => x.id === pk.alt) : null, up = (tr.prot || {})[pk.id] || 0;
          const opts = pk.r === 1 ? [[0, "Unprotected"], [10, "Top-10 protected"], [14, "Top-14 protected"], [20, "Top-20 protected"]] : [[0, "Unprotected"], [55, "Protected 31-55 (rarely conveys)"]];
          return `<label><input type="checkbox" data-on="trPick" data-code="${code}" data-id="${pk.id}"${on ? " checked" : ""}><span>${pk.y} ${pk.r === 1 ? "first" : "second"} <span class="m">${pk.from === code ? "own" : esc(pa ? `better of ${pk.from} and ${pa.from}` : W.T[pk.from].name)}${pk.prot ? ", " + esc(L.protName(pk, pk.prot.upTo)) : ""}</span></span><span class="m">${pk.r === 1 ? "No. " + L.pickSlot(W, pk) : ""}</span></label>${on && !pk.prot ? `<div class="row" style="padding:6px 10px;border-bottom:1px solid var(--line)"><label class="f">Protection<select data-on="trProt" data-id="${pk.id}">${opts.map(([v, n]) => `<option value="${v}"${v === up ? " selected" : ""}>${n}</option>`).join("")}</select></label><span class="small muted">${up ? `Conveys ${App.pct(L.conveyOdds(W, pk, up))} of the time${pk.r === 1 ? "; otherwise next year's first goes instead" : ""}.` : ""}</span></div>` : ""}`;
        }).join("")}
      </div>
      <label class="f" style="margin-top:8px">Cash ${esc(W.T[code].name)} sends ($M)<input type="number" min="0" max="${(CBA.cashLimit(i0) / 1e6).toFixed(1)}" step="0.5" value="${(s.cash || 0) / 1e6}" data-on="trCash" data-code="${code}"></label>`;
    };
    const A = App.analyzeTrade(tr);
    return `
      <label class="f">Trade partner<select data-on="trPartner">${teams.map(x => `<option value="${x.code}"${x.code === P ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
      <div class="fo"><b>${esc(fo.lead)}</b><span class="muted small">${esc(fo.title)}</span></div>
      <div class="fo"><span class="chip">${MODE_NAME[fo.mode]}</span><span class="chip ${fo.tax === "pay" ? "g" : fo.tax === "never" ? "b" : "w"}">${TAX_NAME[fo.tax]}</span>${(fo.wants || []).map(w => `<span class="chip gold">Wants ${WANT_NAME[w]}</span>`).join("")}</div>
      <p class="small muted" style="margin:4px 0 12px">${esc(fo.style)} Payroll ${m(L.payrollNow(W, P))}, ${CBA.STATUS_NAME[CBA.status(L.payrollNow(W, P), i0)].toLowerCase()}.</p>
      <div class="sides">
        <div><h3>Boston sends</h3>${list("BOS")}</div>
        <div><h3>${esc(t.name)} send</h3>${list(P)}</div>
      </div>
      ${tradeResult(W, tr, A)}`;
  }
  function sideMath(W, r, code) {
    const t = W.T[code];
    if (!r) return "";
    const sol = r.sol || {};
    const lines = [];
    if (sol.room) lines.push("Ends under the cap, so no matching needed.");
    for (const s of sol.subs || []) {
      if (s.tpe) { const tp = t.tpes.find(x => x.id === s.tpe); lines.push(`${esc(s.in.map(id => App.W.P[id].n).join(" and "))} (${m(s.inSal)}) absorbed into the ${esc(tp ? tp.from : "")} exception: uses ${m(Math.min(s.inSal, s.tpeAmt))} of ${m(s.tpeAmt)}, <b>${m(Math.max(0, s.tpeAmt - s.inSal))} left</b>${tp && tp.exp ? ` until ${esc(L.fmtDate(tp.exp))}` : ""}.`); }
      else if (s.agg) lines.push(`${esc(s.out.map(id => App.W.P[id].n).join(" + "))} (${m(s.outSal)}, combined) for ${esc(s.in.map(id => App.W.P[id].n).join(" and "))} (${m(s.inSal)}).`);
      else lines.push(`${esc(App.W.P[s.out[0]].n)} (${m(s.outSal)}) for ${esc(s.in.map(id => App.W.P[id].n).join(" and "))} (${m(s.inSal)}).`);
    }
    for (const nt of sol.newTpes || []) if (nt.amt >= 250000) lines.push(`<b class="good">New trade exception: ${m(nt.amt)}</b> from ${esc(App.W.P[nt.from].n)}, good for a year.`);
    if (r.kick) lines.push(`Includes ${m(r.kick)} of trade kicker this season.`);
    if (r.newHard) lines.push(`<span class="bad">Hard-caps ${esc(t.name)} at the ${CBA.LEVEL_NAME[r.newHard]} for the rest of ${App.sn(App.W.season)}.</span>`);
    return `<table class="math"><tbody>
        <tr><th scope="row">Sends</th><td>${m2(r.outSal)}</td></tr>
        <tr><th scope="row">Takes back</th><td>${m2(r.inSal)}</td></tr>
        <tr><th scope="row">Payroll</th><td>${m(r.P)} → ${m(r.P2)}</td></tr>
        <tr><th scope="row">After</th><td>${CBA.STATUS_NAME[r.post]}</td></tr>
      </tbody></table>
      <ul class="small" style="margin:6px 0 0;padding-left:18px">${lines.map(x => `<li>${x}</li>`).join("")}${r.msgs.map(x => `<li class="${r.ok ? "warnc" : "bad"}">${esc(x)}</li>`).join("")}</ul>`;
  }
  function tradeResult(W, tr, A) {
    const any = tr.side.BOS.players.length + tr.side[tr.b].players.length + (tr.side.BOS.picks || []).length + (tr.side[tr.b].picks || []).length;
    if (!any) return `<p class="muted" style="margin-top:14px">Pick players, picks or cash on either side. The builder checks the CBA for both teams, finds the structure that leaves Boston the biggest trade exception, and tells you how ${esc(W.T[tr.b].fo.lead)} would react.</p>`;
    const rB = A.chk.teams.BOS, rP = A.chk.teams[tr.b], re = A.react;
    const verdictName = { yes: "They'd do it", close: "Close", no: "No deal" }[re.verdict];
    const i0 = W.season;
    const guard = [];
    if (A.bAfter) {
      const mc = L.mandateCheck(W, A.bAfter[0].payroll);
      if (!mc.ok) guard.push(`Breaks ownership's rule: ${mc.text}`);
      for (let k = 1; k < 3; k++) if (A.bAfter[k].status === "a2" && A.bBefore[k].status !== "a2") guard.push(`Projects Boston over the second apron in ${App.sn(i0 + k)}.`);
    }
    const taxRows = A.bAfter ? A.bBefore.map((b, k) => `<tr><td>${App.sn(b.i)}</td><td>${m(b.payroll)} → ${m(A.bAfter[k].payroll)}</td><td>${m(b.tax)} → ${m(A.bAfter[k].tax)}</td></tr>`).join("") : "";
    const cba = A.chk.ok ? `<span class="chip g">Legal under the CBA</span>` : `<span class="chip b">Not legal yet</span>`;
    return `
      <div class="grid2" style="margin-top:16px">
        <div><h3>Boston ${cba}</h3>${sideMath(W, rB, "BOS")}</div>
        <div><h3>${esc(W.T[tr.b].name)}</h3>${sideMath(W, rP, tr.b)}</div>
      </div>
      <div class="card" style="margin-top:14px;background:var(--sunk)">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div><div class="small muted">${esc(App.poss(W.T[tr.b].fo.lead))} answer</div><div class="verdict ${re.verdict === "yes" ? "good" : re.verdict === "close" ? "warnc" : "bad"}">${verdictName}</div></div>
          <div class="small" style="text-align:right">Boston's read: <b class="${A.ours >= 0 ? "good" : "bad"}">${A.ours >= 0 ? "+" : ""}${m(A.ours)}</b> in value<br>${A.after ? `Projected wins: ${A.before.BOS.toFixed(0)} → <b>${A.after.BOS.toFixed(0)}</b>` : ""}</div>
        </div>
        <p class="small" style="margin:8px 0 0">${esc(re.veto || (re.verdict === "yes" ? "The value works for them." : re.verdict === "close" ? "They want a little more." : "They don't see enough value."))}${re.why.length ? " " + esc(re.why.join(". ")) + "." : ""}</p>
        ${guard.map(g => `<p class="notice" style="margin:8px 0 0">${esc(g)}</p>`).join("")}
        ${taxRows ? `<table class="std small" style="margin-top:10px"><thead><tr><th scope="col">Season</th><th scope="col">Boston payroll</th><th scope="col">Tax bill</th></tr></thead><tbody>${taxRows}</tbody></table>` : ""}
        ${["BOS", tr.b].filter(c => !tr.side[c].players.length && !(tr.side[c].picks || []).length && !(tr.side[c].cash > 0)).map(c => `<p class="small" style="margin:8px 0 0">Nothing is going from ${esc(W.T[c].name)} yet, and every trade needs something going each way. <button class="linkish" type="button" data-act="trToken" data-code="${c}">Add ${L.token(W, c).picks.length ? "a protected second" : "$250K in cash"}</button></p>`).join("")}
        <div class="row" style="margin-top:12px">
          <button class="btn" type="button" data-act="trQueue"${A.chk.ok ? "" : " disabled"}>Add to moves</button>
          ${re.verdict !== "yes" ? `<button class="btn ghost" type="button" data-act="trSweeten">What would it take?</button>` : ""}
          <button class="btn ghost" type="button" data-act="trClear">Clear</button>
        </div>
      </div>`;
  }
  App.acts.trPartner = el => { App.ui.trade = App.newTrade(el.value); App.render(); };
  App.acts.trToggle = el => {
    const tr = App.ui.trade, s = tr.side[el.dataset.code], id = el.dataset.id;
    if (el.checked) { if (!s.players.includes(id)) s.players.push(id); } else s.players = s.players.filter(x => x !== id);
    App.render();
  };
  App.acts.trPick = el => {
    const tr = App.ui.trade, s = tr.side[el.dataset.code], id = el.dataset.id;
    s.picks = s.picks || [];
    if (el.checked) { if (!s.picks.includes(id)) s.picks.push(id); } else { s.picks = s.picks.filter(x => x !== id); if (tr.prot) delete tr.prot[id]; }
    App.render();
  };
  const sntSal = (years, y1) => Array.from({ length: years }, (_, k) => CBA.k1(y1 * (1 + 0.05 * k)));
  App.acts.trSnt = el => {
    const W = App.W, tr = App.ui.trade, s = tr.side[el.dataset.code], id = el.dataset.id, p = W.P[id];
    tr.snt = tr.snt || {};
    if (el.checked) {
      const ask = Mo.faHaul(p, W.season, W);
      tr.snt[id] = { sal: sntSal(3, CBA.k1(Math.min(ask.aav, CBA.maxSal(p.yos, W.season)))) };
      if (!s.players.includes(id)) s.players.push(id);
    } else { delete tr.snt[id]; s.players = s.players.filter(x => x !== id); }
    App.render();
  };
  App.acts.trSntYears = el => { const o = App.ui.trade.snt[el.dataset.id]; o.sal = sntSal(+el.value, o.sal[0]); App.render(); };
  App.acts.trSntAav = el => { const o = App.ui.trade.snt[el.dataset.id]; o.sal = sntSal(o.sal.length, CBA.k1((+el.value || 1) * 1e6)); App.render(); };
  App.acts.trProt = el => { const tr = App.ui.trade; tr.prot = tr.prot || {}; const v = +el.value; if (v) tr.prot[el.dataset.id] = v; else delete tr.prot[el.dataset.id]; App.render(); };
  App.acts.trToken = el => { const tr = App.ui.trade, code = el.dataset.code, tk = L.token(App.W, code, tr.side[code].picks || []); tr.side[code].picks = (tr.side[code].picks || []).concat(tk.picks); tr.side[code].cash = (tr.side[code].cash || 0) + tk.cash; tr.prot = Object.assign(tr.prot || {}, tk.prot); App.render(); };
  App.acts.trCash = el => { App.ui.trade.side[el.dataset.code].cash = Math.max(0, Math.round((+el.value || 0) * 1e6)); App.render(); };
  App.acts.trClear = () => { App.ui.trade = App.newTrade(App.ui.trade.b); App.render(); };
  // Find the cheapest Boston addition that gets a yes: a second, then a first, then cash, then a young player
  App.acts.trSweeten = () => {
    const W = App.W, tr = App.ui.trade;
    const tries = [];
    const ownPicks = W.picks.filter(p => p.owner === "BOS" && !(tr.side.BOS.picks || []).includes(p.id)).sort((a, b) => b.r - a.r || L.pickValue(W, tr.b, a) - L.pickValue(W, tr.b, b));
    for (const pk of ownPicks) {
      if (pk.r === 1 && !pk.prot) tries.push(t => { t.side.BOS.picks = [...(t.side.BOS.picks || []), pk.id]; t.prot = Object.assign(t.prot || {}, { [pk.id]: 10 }); return L.pickName(W, pk.id, 10); });
      tries.push(t => { t.side.BOS.picks = [...(t.side.BOS.picks || []), pk.id]; return L.pickName(W, pk.id); });
    }
    tries.push(t => { t.side.BOS.cash = CBA.cashLimit(W.season); return `${m(CBA.cashLimit(W.season))} in cash`; });
    const young = Object.values(W.P).filter(p => p.t === "BOS" && !p.two && p.age <= 24 && !tr.side.BOS.players.includes(p.id)).sort((a, b) => L.playerValue(W, "BOS", a) - L.playerValue(W, "BOS", b));
    for (const p of young) tries.push(t => { t.side.BOS.players = [...t.side.BOS.players, p.id]; return p.n; });
    for (const f of tries) {
      const t = JSON.parse(JSON.stringify(tr));
      const what = f(t);
      const chk = L.checkTrade(W, t), re = L.aiReact(W, t, t.b);
      if (re.verdict === "yes" && chk.teams.BOS.ok) {
        App.dlg("What it would take", `<p>${esc(W.T[t.b].fo.lead)} says yes if Boston adds <b>${esc(what)}</b>.</p><div class="row"><button class="btn" type="button" data-act="trUseSweet" data-t="${esc(JSON.stringify(t))}">Add it</button><button class="btn ghost" type="button" data-act="close">No thanks</button></div>`);
        return;
      }
    }
    App.dlg("What it would take", `<p>Nothing short of a much bigger package gets ${esc(W.T[tr.b].name)} there. ${esc(L.aiReact(W, tr, tr.b).veto || "Try a different target or partner.")}</p>`);
  };
  App.acts.trUseSweet = el => { App.ui.trade = JSON.parse(el.dataset.t); App.closeDlg(); App.render(); };
  App.acts.trQueue = () => {
    const W = App.W, tr = App.ui.trade;
    const names = c => (tr.side[c].players.map(id => (tr.snt && tr.snt[id] ? "sign-and-trade " : "") + W.P[id].n).concat((tr.side[c].picks || []).map(id => L.pickName(W, id, (tr.prot || {})[id]))).concat(tr.side[c].cash ? [m(tr.side[c].cash) + " cash"] : [])).join(", ") || "nothing";
    W.queue.push({ type: "trade", tr: JSON.parse(JSON.stringify(tr)), label: `Trade ${names("BOS")} to ${W.T[tr.b].name} for ${names(tr.b)}` });
    App.ui.trade = App.newTrade(tr.b);
    App.afterChange();
  };

  // ================= Dump salary =================
  function shopHTML(W) {
    const i0 = W.season, dec = L.decider(W);
    const ps = Object.values(W.P).filter(p => p.t === "BOS" && !p.two && CBA.salaryIn(p, i0, dec) > 0 && !(p.noTrade && W.date < p.noTrade)).sort((a, b) => CBA.salaryIn(b, i0, dec) - CBA.salaryIn(a, i0, dec));
    const st = App.ui.shop || (App.ui.shop = { ids: [] });
    const b = L.books(W, "BOS", i0);
    const res = st.res;
    const line = (x) => {
      const tr = x.tr, them = tr.b;
      const what = c => [...tr.side[c].players.map(id => W.P[id].n), ...(tr.side[c].picks || []).map(id => L.pickName(W, id, (tr.prot || {})[id])), ...(tr.side[c].cash ? [m(tr.side[c].cash) + " cash"] : [])].join(", ");
      return `<li style="padding:10px 0;border-bottom:1px solid var(--line)"><b>${esc(W.T[them].name)}</b> <span class="small muted">${esc(W.T[them].fo.lead)}</span><br>
        <span class="small">Boston sends ${esc(what("BOS"))}. ${esc(W.T[them].name)} send ${esc(what(them))}.</span><br>
        <span class="small">${x.saved > 0 ? `Takes ${m(x.saved)} off this season's payroll` : "No payroll savings"}${x.taxSaved > 0 ? `, saves ${m(x.taxSaved)} in tax` : ""}${x.tpe >= 250000 ? `, leaves a ${m(x.tpe)} trade exception` : ""}. Boston's read: <b class="${x.ours >= 0 ? "good" : "bad"}">${x.ours >= 0 ? "+" : ""}${m(x.ours)}</b>.</span>
        <div class="row" style="margin-top:6px"><button class="btn sm" type="button" data-act="shopUse" data-k="${res.indexOf(x)}">Add to moves</button><button class="btn ghost sm" type="button" data-act="shopEdit" data-k="${res.indexOf(x)}">Open in the trade builder</button></div></li>`;
    };
    return `<p class="small" style="margin-top:0">Pick the contracts you want gone. Every team gets asked what it would take: what they'd give you, or what you'd have to attach. Teams need cap room, a trade exception or matching salary to take on money, so in-season takers are scarce; in the offseason there are more. Payroll now ${m(b.payroll)}${b.tax ? `, tax bill ${m(b.tax)}` : ""}.</p>
      <div class="pick-list" role="group" aria-label="Contracts to move">${ps.map(p => `<label><input type="checkbox" data-on="shopToggle" data-id="${p.id}"${st.ids.includes(p.id) ? " checked" : ""}><span>${esc(p.n)} <span class="m">${p.age}, rated ${App.ovr(p)}</span></span><span class="m">${m(CBA.salaryIn(p, i0, dec))}</span></label>`).join("")}</div>
      <button class="btn" type="button" data-act="shopRun" style="margin-top:10px"${st.ids.length ? "" : " disabled"}>Call around</button>
      ${res ? (res.length ? `<ol class="plain" style="margin-top:10px">${res.slice(0, 8).map(line).join("")}</ol>` : `<p class="notice" style="margin-top:10px">Nobody can take that on right now without sending as much salary back. Try a smaller contract, or wait for the offseason when teams have cap room.</p>`) : ""}`;
  }
  App.acts.shopToggle = el => { const st = App.ui.shop; if (el.checked) st.ids.push(el.dataset.id); else st.ids = st.ids.filter(x => x !== el.dataset.id); st.res = null; App.render(); };
  App.acts.shopRun = () => { const st = App.ui.shop; st.res = L.shopPlayers(App.W, st.ids); App.render(); };
  App.acts.shopUse = el => {
    const W = App.W, x = App.ui.shop.res[+el.dataset.k], tr = x.tr;
    const what = c => [...tr.side[c].players.map(id => W.P[id].n), ...(tr.side[c].picks || []).map(id => L.pickName(W, id, (tr.prot || {})[id]))].join(", ") || "cash";
    W.queue.push({ type: "trade", tr: JSON.parse(JSON.stringify(tr)), label: `Trade ${what("BOS")} to ${W.T[tr.b].name} for ${what(tr.b)}` });
    App.ui.shop = { ids: [] }; App.afterChange();
  };
  App.acts.shopEdit = el => { App.ui.trade = JSON.parse(JSON.stringify(App.ui.shop.res[+el.dataset.k].tr)); App.ui.compose = "trade"; App.render(); };

  // ================= Extensions =================
  function extendHTML(W) {
    const i0 = W.season;
    const elig = Object.values(W.P).filter(p => p.t === "BOS" && !p.two && CBA.extEligible(p, i0).ok);
    if (!elig.length) return "<p class='muted'>Nobody on the roster is eligible for an extension right now.</p>";
    const st = App.ui.ext && elig.find(p => p.id === App.ui.ext.id) ? App.ui.ext : { id: elig[0].id };
    const p = W.P[st.id], lim = CBA.extLimit(p, i0);
    st.years = Math.min(st.years || Math.min(2, lim.maxYears), lim.maxYears);
    const mv = Mo.mv(p, lim.start, W);
    st.total = st.total || Math.round(Math.min(lim.first, mv) * st.years / 1e6);
    st.shape = st.shape || "up";
    App.ui.ext = st;
    const sal = CBA.buildSalaries(st.years, st.total * 1e6, st.shape, 0.08);
    const over = sal[0] > lim.first;
    const odds = Mo.extensionOdds(p, lim.start, st.years, st.total * 1e6, W);
    return `
      <label class="f">Player<select data-on="exPlayer">${elig.map(x => `<option value="${x.id}"${x.id === p.id ? " selected" : ""}>${esc(x.n)}</option>`).join("")}</select></label>
      <p class="small muted">${lim.kind === "rookie" ? "Rookie scale extension" : "Veteran extension"}. New money starts ${App.sn(lim.start)}. Up to ${lim.maxYears} season${lim.maxYears > 1 ? "s" : ""}, first year up to ${m(lim.first)}, raises up to 8%. The model says he's worth about ${m(mv)} in ${App.sn(lim.start)}.</p>
      <div class="row">
        <label class="f">Years<select data-on="exYears">${Array.from({ length: lim.maxYears }, (_, k) => k + 1).map(y => `<option${y === st.years ? " selected" : ""}>${y}</option>`).join("")}</select></label>
        <label class="f">Total ($M)<input type="number" min="1" step="1" value="${st.total}" data-on="exTotal"></label>
        <label class="f">Shape<select data-on="exShape"><option value="up"${st.shape === "up" ? " selected" : ""}>Rising 8%</option><option value="flat"${st.shape === "flat" ? " selected" : ""}>Flat</option><option value="down"${st.shape === "down" ? " selected" : ""}>Falling 8%</option></select></label>
      </div>
      <p class="small">${sal.map((x, k) => `${App.sn(lim.start + k)} ${m2(x)}`).join(", ")}</p>
      ${over ? `<p class="notice bad">First year is over the ${m(lim.first)} limit.</p>` : `<p><span class="verdict ${odds.odds >= 0.6 ? "good" : odds.odds >= 0.35 ? "warnc" : "bad"}">${App.pct(odds.odds)}</span> he signs. <span class="small muted">He compares it with about ${m(odds.alt)} he'd expect over the same years by waiting.</span></p>`}
      <button class="btn" type="button" data-act="exQueue"${over ? " disabled" : ""}>Add to moves</button>`;
  }
  App.acts.exPlayer = el => { App.ui.ext = { id: el.value }; App.render(); };
  App.acts.exYears = el => { App.ui.ext.years = +el.value; App.ui.ext.total = null; App.render(); };
  App.acts.exTotal = el => { App.ui.ext.total = Math.max(1, +el.value || 1); App.render(); };
  App.acts.exShape = el => { App.ui.ext.shape = el.value; App.render(); };
  App.acts.exQueue = () => {
    const W = App.W, st = App.ui.ext, p = W.P[st.id];
    W.queue.push({ type: "extend", id: p.id, years: st.years, total: st.total * 1e6, shape: st.shape, label: `Extend ${p.n}: ${st.years} years, ${m(st.total * 1e6)}` });
    App.afterChange();
  };

  // ================= Signings =================
  function signHTML(W) {
    const i0 = W.season;
    const tools = L.tools(W, "BOS", i0).tools.filter(t => t.ok && !t.tpe && (t.key !== "room" || t.amt > 0));
    const st = App.ui.sign || (App.ui.sign = {});
    st.fit = st.fit || "all";
    const twos = Object.values(W.P).filter(p => p.t === "BOS" && p.two);
    const toolAmt = k => (tools.find(t => t.key === k) || { amt: 0 }).amt;
    const fits = { all: () => true, min: p => Mo.faHaul(p, i0, W).aav <= CBA.minSal(p.yos, i0) * 1.15,
      mle: p => Mo.faHaul(p, i0, W).aav <= Math.max(toolAmt("ntmle"), toolAmt("tmle"), toolAmt("rmle")) * 1.05,
      bae: p => Mo.faHaul(p, i0, W).aav <= toolAmt("bae") * 1.05, room: p => Mo.faHaul(p, i0, W).aav <= toolAmt("room") * 1.05 };
    const all = Object.values(W.P).filter(p => p.t === "FA" && !p.retired && !p.offerSheet).sort((a, b) => Mo.r(b) - Mo.r(a));
    const fas = all.filter(fits[st.fit]);
    let html = "";
    if (twos.length) html += `<h3>Convert a two-way deal</h3><p class="small muted">Moves him to a standard minimum contract and onto the 15-man roster.</p><ul class="plain">${twos.map(p => `<li class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(p.n)} <span class="small muted">rated ${App.ovr(p)}</span></span><button class="btn ghost sm" type="button" data-act="cvQueue" data-id="${p.id}">Add to moves</button></li>`).join("")}</ul>`;
    const filters = [["all", "Everyone"], ["min", "Will take the minimum"], ["mle", "Fits a mid-level"], ["bae", "Fits the bi-annual"], ["room", "Fits cap room"]].filter(([k]) => k === "all" || k === "min" || (k === "mle" && (toolAmt("ntmle") || toolAmt("tmle") || toolAmt("rmle"))) || (k === "bae" && toolAmt("bae")) || (k === "room" && toolAmt("room")));
    html += `<h3 style="margin-top:14px">Free agents</h3><div class="seg" role="group" aria-label="Show">${filters.map(([k, n]) => `<button type="button" aria-pressed="${st.fit === k}" data-act="sgFit" data-k="${k}">${n}</button>`).join("")}</div>`;
    if (!fas.length) return html + `<p class="muted">${all.length ? "Nobody in that group right now." : "No unsigned free agents. The market opens July 1 in GM mode."}</p>`;
    const p = W.P[st.id] && fas.includes(W.P[st.id]) ? W.P[st.id] : fas[0]; st.id = p.id;
    const ask = Mo.faHaul(p, i0, W);
    st.via = st.via && tools.find(t => t.key === st.via) ? st.via : (tools.find(t => t.amt >= ask.aav) || tools[0] || { key: "min" }).key;
    st.years = st.years || Math.min(ask.years, 2);
    st.total = st.total || Math.round(Math.min(ask.aav, (tools.find(t => t.key === st.via) || { amt: ask.aav }).amt) * st.years / 1e6 * 10) / 10;
    const tool = tools.find(t => t.key === st.via);
    return html + `
      <ul class="plain" style="margin-top:8px;max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:8px">${fas.slice(0, 40).map(x => { const a = Mo.faHaul(x, i0, W); return `<li style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--line)"><span>${esc(x.n)} <span class="small muted">${esc(App.posName(x))}, ${x.age}, rated ${App.ovr(x)}${x.rights && x.rights.team === "BOS" ? ", your rights" : ""}</span></span><span class="small">${m(a.aav)} x ${a.years}${Mo.askDecay(x, W) < 0.99 ? " <span class='muted'>(asking less lately)</span>" : ""}</span><button class="btn ghost sm" type="button" data-act="sgPlayer" data-id="${x.id}" aria-pressed="${x.id === p.id}">${x.id === p.id ? "Selected" : "Pick"}</button></li>`; }).join("")}</ul>
      <p class="small" style="margin-top:10px"><b>${esc(p.n)}</b> is looking for about ${m(ask.aav)} a year for ${ask.years} year${ask.years > 1 ? "s" : ""}.</p>
      <div class="row">
        <label class="f">Using<select data-on="sgVia">${tools.map(t => `<option value="${t.key}"${t.key === st.via ? " selected" : ""}>${esc(t.name)} (${m(t.amt)})</option>`).join("")}${p.rights && p.rights.team === "BOS" ? `<option value="bird"${st.via === "bird" ? " selected" : ""}>His Bird rights</option>` : ""}</select></label>
        <label class="f">Years<select data-on="sgYears">${[1, 2, 3, 4].map(y => `<option${y === st.years ? " selected" : ""}>${y}</option>`).join("")}</select></label>
        <label class="f">Total ($M)<input type="number" step="0.1" min="0.5" value="${st.total}" data-on="sgTotal"></label>
      </div>
      <button class="btn" type="button" data-act="sgQueue">Add to moves</button>
      <p class="small muted">${tool ? esc(tool.why) : ""}</p>`;
  }
  App.acts.sgFit = el => { App.ui.sign = { fit: el.dataset.k }; App.render(); };
  App.acts.sgPlayer = el => { App.ui.sign = { id: el.dataset.id || el.value, fit: (App.ui.sign || {}).fit }; App.render(); };
  App.acts.sgVia = el => { App.ui.sign.via = el.value; App.render(); };
  App.acts.sgYears = el => { App.ui.sign.years = +el.value; App.render(); };
  App.acts.sgTotal = el => { App.ui.sign.total = +el.value; App.render(); };
  App.acts.sgQueue = () => {
    const W = App.W, st = App.ui.sign, p = W.P[st.id];
    W.queue.push({ type: "sign", id: p.id, via: st.via, years: st.years, total: Math.round(st.total * 1e6), shape: "flat", label: `Sign ${p.n}: ${st.years} year${st.years > 1 ? "s" : ""}, ${m(st.total * 1e6)}` });
    App.ui.sign = {};
    App.afterChange();
  };
  App.acts.cvQueue = el => { const p = App.W.P[el.dataset.id]; App.W.queue.push({ type: "convert", id: p.id, label: `Convert ${p.n} to a standard contract` }); App.afterChange(); };

  // ================= Waivers =================
  function waiveHTML(W) {
    const i0 = W.season, dec = L.decider(W);
    const ps = Object.values(W.P).filter(p => p.t === "BOS" && !p.two).sort((a, b) => CBA.salaryIn(a, i0, dec) - CBA.salaryIn(b, i0, dec));
    const st = App.ui.waive && ps.find(p => p.id === App.ui.waive.id) ? App.ui.waive : (App.ui.waive = { id: ps[0].id, stretch: false });
    const p = W.P[st.id];
    const C = lite(W); L.bump(C);
    L.waive(C, "BOS", p.id, st.stretch);
    const d = C.T.BOS.dead[C.T.BOS.dead.length - 1];
    const rows = d ? d.sal.map((x, j) => x ? `${App.sn(j)} ${m2(x)}` : null).filter(Boolean).join(", ") : "Nothing: his deal isn't guaranteed.";
    return `<label class="f">Player<select data-on="wvPlayer">${ps.map(x => `<option value="${x.id}"${x.id === p.id ? " selected" : ""}>${esc(x.n)} (${m(CBA.salaryIn(x, i0, dec))})</option>`).join("")}</select></label>
      <label style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" data-on="wvStretch"${st.stretch ? " checked" : ""}> Stretch it (spread what's left over twice the years remaining, plus one)</label>
      <p class="small"><b>Dead money:</b> ${esc(rows)}</p>
      <button class="btn" type="button" data-act="wvQueue">Add to moves</button>`;
  }
  App.acts.wvPlayer = el => { App.ui.waive = { id: el.value, stretch: false }; App.render(); };
  App.acts.wvStretch = el => { App.ui.waive.stretch = el.checked; App.render(); };
  App.acts.wvQueue = () => { const W = App.W, st = App.ui.waive, p = W.P[st.id]; W.queue.push({ type: "waive", id: p.id, stretch: st.stretch, label: `Waive ${p.n}${st.stretch ? " and stretch" : ""}` }); App.afterChange(); };

  // ================= Queue =================
  // Run moves in order on a copy; report each step
  App.runQueue = (W, queue, real) => {
    const out = [];
    const S = real ? W : lite(W);
    L.bump(S);
    const r = L.rng(S);
    for (const mv of queue) {
      const res = { ok: true, msg: "" };
      try {
        if (mv.type === "trade") {
          const tr = mv.tr;
          const valid = Object.entries(tr.side).every(([code, s]) => s.players.every(id => S.P[id] && (S.P[id].t === code || (tr.snt && tr.snt[id] && S.P[id].t === "FA" && S.P[id].rights && S.P[id].rights.team === code))));
          if (!valid) { res.ok = false; res.msg = "A player in this trade is no longer on the team that sends him."; }
          else {
            const chk = L.checkTrade(S, tr), re = L.aiReact(S, tr, tr.b);
            if (!chk.ok) { res.ok = false; res.msg = Object.values(chk.teams).flatMap(t => t.ok ? [] : t.msgs.map(x => `${S.T[t.code].name}: ${x}`)).join(" "); }
            else if (re.verdict !== "yes") { res.ok = false; res.msg = `${S.T[tr.b].name} won't do it at this point: ${re.veto || "not enough value for them"}.`; }
            else { L.applyTrade(S, tr); const nt = chk.teams.BOS.sol.newTpes || []; res.msg = `Payroll ${m(chk.teams.BOS.P2)}.${nt.length ? " New exception: " + nt.map(x => m(x.amt)).join(", ") + "." : ""}`; }
          }
        } else if (mv.type === "extend") {
          const p = S.P[mv.id], e = CBA.extEligible(p, S.season);
          if (!e.ok || p.t !== "BOS") { res.ok = false; res.msg = e.why; }
          else {
            const lim = CBA.extLimit(p, S.season), sal = CBA.buildSalaries(mv.years, mv.total, mv.shape, 0.08);
            if (sal[0] > lim.first || mv.years > lim.maxYears) { res.ok = false; res.msg = "Over the extension limit."; }
            else {
              const odds = Mo.extensionOdds(p, lim.start, mv.years, mv.total, S).odds;
              if (real && r() > odds) { res.ok = false; res.msg = `${p.n} turned it down (${App.pct(odds)} odds). Try more money or years.`; }
              else { L.extend(S, "BOS", p.id, mv.years, mv.total, mv.shape); res.msg = real ? "He signed." : `${App.pct(odds)} he signs.`; }
            }
          }
        } else if (mv.type === "sign") {
          const p = S.P[mv.id];
          if (!p || p.t !== "FA") { res.ok = false; res.msg = "He's no longer available."; }
          else {
            const n = L.rosterCount(S, "BOS");
            const tool = L.tools(S, "BOS", S.season).tools.find(t => t.key === mv.via);
            const sal = CBA.buildSalaries(mv.years, mv.total, mv.shape || "flat", mv.via === "bird" ? 0.08 : 0.05);
            const hardLvl = S.T.BOS.hard[S.season], payNow = L.payrollNow(S, "BOS");
            if (n >= 15 && L.inSeason(S)) { res.ok = false; res.msg = "The roster is full (15)."; }
            else if (hardLvl && payNow + sal[0] > CBA.levelAmt(hardLvl, S.season)) { res.ok = false; res.msg = `Boston is hard-capped at the ${CBA.LEVEL_NAME[hardLvl]}: only ${m(Math.max(0, CBA.levelAmt(hardLvl, S.season) - payNow))} of room.`; }
            else if (mv.via !== "bird" && mv.via !== "min" && (!tool || !tool.ok || sal[0] > tool.amt)) { res.ok = false; res.msg = tool ? `The ${tool.name.toLowerCase()} only covers ${m(tool.amt)} now. ${tool.ok ? "" : tool.why}` : "That exception isn't available."; }
            else if (mv.via === "min" && sal[0] > CBA.minSal(p.yos, S.season) * 1.001 + 1000) { res.ok = false; res.msg = `A minimum deal for him is ${m(CBA.minSal(p.yos, S.season))}.`; }
            else {
              const ask = Mo.faHaul(p, S.season, S), odds = Mo.offerOdds(mv.total, ask.aav * Math.min(mv.years, ask.years) * (L.inSeason(S) ? 0.6 : 0.85), p.age);
              if (real && r() > odds) { res.ok = false; res.msg = `${p.n} passed (${App.pct(odds)} odds).`; }
              else { L.sign(S, "BOS", p.id, mv.years, mv.total, mv.shape || "flat", mv.via); res.msg = real ? "Signed." : `${App.pct(odds)} he signs.`; }
            }
          }
        } else if (mv.type === "waive") {
          const p = S.P[mv.id];
          if (!p || p.t !== "BOS") { res.ok = false; res.msg = "He's not on the roster."; }
          else { L.waive(S, "BOS", p.id, mv.stretch); res.msg = "Done."; }
        } else if (mv.type === "convert") {
          const p = S.P[mv.id];
          if (!p || !p.two) { res.ok = false; res.msg = "Not on a two-way deal."; }
          else if (L.rosterCount(S, "BOS") >= 15) { res.ok = false; res.msg = "The roster is full (15)."; }
          else if (S.T.BOS.hard[S.season] && L.payrollNow(S, "BOS") + CBA.minSal(p.yos, S.season) > CBA.levelAmt(S.T.BOS.hard[S.season], S.season)) { res.ok = false; res.msg = `Boston is hard-capped at the ${CBA.LEVEL_NAME[S.T.BOS.hard[S.season]]} and this would go over.`; }
          else { p.two = false; p.c.sal[S.season] = CBA.minSal(p.yos, S.season); p.c.signed = S.season; L.bump(S); L.news(S, `Boston converts ${p.n} to a standard contract.`, "sign", "BOS"); res.msg = `Adds ${m(CBA.minSal(p.yos, S.season))}.`; }
        }
      } catch (e) { console.error(e); res.ok = false; res.msg = "Something in this move doesn't add up anymore."; }
      if (res.ok) {
        const b = L.books(S, "BOS", S.season);
        res.after = b.payroll;
        const mc = L.mandateCheck(S, b.payroll);
        if (!mc.ok) res.warn = `Breaks ownership's rule after this step: ${mc.text}`;
      }
      out.push(res);
      if (!res.ok && real) break;
    }
    return out;
  };
  function queueHTML(W) {
    const q = W.queue;
    if (!q.length) return `<h3>Your moves</h3><p class="muted">Nothing lined up yet. Build a trade, an extension, a signing or a waiver, then add it here.</p>${App.ui.lastRun ? lastRunHTML() : ""}`;
    const res = App.runQueue(W, q, false);
    const allOk = res.every(r => r.ok);
    return `<h3>Your moves, in order</h3>
      <ol class="plain queue">${q.map((mv, k) => `<li class="${res[k].ok ? "ok" : "fail"}"><span class="num" aria-hidden="true">${k + 1}</span><div><div>${esc(mv.label)}</div><div class="small ${res[k].ok ? "muted" : "bad"}">${res[k].ok ? "Works here." : "Fails here."} ${esc(res[k].msg)}${res[k].after ? ` Payroll after: ${m(res[k].after)}.` : ""}</div>${res[k].warn ? `<div class="small warnc">${esc(res[k].warn)}</div>` : ""}</div>
        <div class="ctl"><button class="icon-btn" type="button" data-act="qUp" data-k="${k}" aria-label="Move step ${k + 1} up"${k === 0 ? " disabled" : ""}>↑</button><button class="icon-btn" type="button" data-act="qDown" data-k="${k}" aria-label="Move step ${k + 1} down"${k === q.length - 1 ? " disabled" : ""}>↓</button><button class="icon-btn" type="button" data-act="qDel" data-k="${k}" aria-label="Remove step ${k + 1}">✕</button></div></li>`).join("")}</ol>
      <div class="row" style="margin-top:12px">
        <button class="btn" type="button" data-act="qRun"${allOk ? "" : " disabled"}>Make these moves</button>
        ${!allOk && q.length > 1 ? `<button class="btn ghost" type="button" data-act="qFind">Find an order that works</button>` : ""}
        <button class="btn ghost" type="button" data-act="qClear">Clear</button>
      </div>
      <p class="small muted">Extensions and signings can still be turned down when you make the moves; the odds are shown.</p>
      ${App.ui.lastRun ? lastRunHTML() : ""}`;
  }
  function lastRunHTML() {
    const r = App.ui.lastRun;
    return `<div class="notice ${r.ok ? "good" : "bad"}" style="margin-top:12px">${esc(r.text)}</div>`;
  }
  const swap = (a, i, j) => { const t = a[i]; a[i] = a[j]; a[j] = t; };
  App.acts.qUp = el => { const k = +el.dataset.k; if (k > 0) swap(App.W.queue, k, k - 1); App.afterChange(); };
  App.acts.qDown = el => { const k = +el.dataset.k; if (k < App.W.queue.length - 1) swap(App.W.queue, k, k + 1); App.afterChange(); };
  App.acts.qDel = el => { App.W.queue.splice(+el.dataset.k, 1); App.afterChange(); };
  App.acts.qClear = () => { App.W.queue = []; App.ui.lastRun = null; App.afterChange(); };
  App.acts.qFind = () => {
    const W = App.W, q = W.queue;
    if (q.length > 7) { App.ui.lastRun = { ok: false, text: "Too many moves to try every order. Trim the list to seven or fewer." }; App.render(); return; }
    const perms = a => a.length <= 1 ? [a] : a.flatMap((x, i) => perms(a.slice(0, i).concat(a.slice(i + 1))).map(r => [x, ...r]));
    for (const order of perms(q.map((_, k) => k))) {
      const qq = order.map(k => q[k]);
      if (App.runQueue(W, qq, false).every(r => r.ok)) { W.queue = qq; App.ui.lastRun = { ok: true, text: "Found an order where every step works." }; App.afterChange(); return; }
    }
    App.ui.lastRun = { ok: false, text: "No order makes every step work. Something has to change, not just the order." };
    App.render();
  };
  App.acts.qRun = () => {
    const W = App.W, q = W.queue.slice();
    const res = App.runQueue(W, q, true);
    const done = res.filter(r => r.ok).length;
    W.queue = q.slice(done);
    App.ui.lastRun = done === q.length ? { ok: true, text: `All ${done} move${done > 1 ? "s" : ""} made.` } : { ok: false, text: `${done} made. Stopped at "${q[done].label}": ${res[done].msg}` };
    App.afterChange();
  };
})();
