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

  // Boston's read of a trade: each piece with age and surplus value, then salary, wins, exception and the total
  App.readHTML = (W, tr, A) => {
    const prot = tr.prot || {};
    const sv = v => `${v >= 0 ? "+" : ""}${m(v)}`;
    const item = id => {
      const p = W.P[id];
      if (tr.snt && tr.snt[id] && p.t === "FA") return `<li>${esc(p.n)} <span class="muted">(${p.age}, sign-and-trade: ${tr.snt[id].sal.length} yrs, ${m(tr.snt[id].sal.reduce((a, b) => a + b, 0))})</span></li>`;
      return `<li><button class="linkish" type="button" data-act="player" data-id="${id}">${esc(p.n)}</button> <span class="muted">(${p.age}, ${sv(L.playerValue(W, "BOS", L.sntView(W, tr, id)))})</span></li>`;
    };
    const pick = id => { const pk = W.picks.find(x => x.id === id); return `<li>${esc(L.pickName(W, id, prot[id]))} <span class="muted">(${sv(pk ? L.pickValue(W, "BOS", pk, prot[id]) : 0)})</span></li>`; };
    const list = c => { const s = tr.side[c] || { players: [], picks: [] }; return [...s.players.map(item), ...(s.picks || []).map(pick), ...(s.cash ? [`<li>${m(s.cash)} in cash</li>`] : [])].join("") || `<li class="muted">Nothing</li>`; };
    const rB = A.chk.teams.BOS || {}, sol = rB.sol || {};
    const dPay = (rB.P2 || 0) - (rB.P || 0);
    const used = (sol.used || [])[0], tp = used ? W.T.BOS.tpes.find(x => x.id === used.id) : null;
    const nt = (sol.newTpes || []).filter(x => x.amt >= 250000).sort((a, b) => b.amt - a.amt)[0];
    const exc = used && tp ? [`Uses ${m(used.amt)}`, `of the ${tp.from} exception, ${m(Math.max(0, tp.amt - used.amt))} left`] : nt ? [`New ${m(nt.amt)}`, `trade exception from ${W.P[nt.from] ? W.P[nt.from].n : ""}, good for a year`] : ["None", "no exception used or created"];
    const dW = A.after ? A.after.BOS - A.before.BOS : null;
    return `<div class="read">
      <div class="read-sides"><div><h4>Boston gets</h4><ul>${list(tr.b)}</ul></div><div><h4>Boston sends</h4><ul>${list("BOS")}</ul></div></div>
      <p class="small muted" style="margin:6px 0 0">In parentheses: age, and surplus value to Boston (what he adds over his contract).</p>
      <dl class="read-stats">
        <div><dt>Salary this season</dt><dd class="${dPay > 0 ? "warnc" : ""}">${dPay >= 0 ? "+" : "-"}${m(Math.abs(dPay))}</dd><dd class="rs">${m(rB.P || 0)} → ${m(rB.P2 || 0)}</dd></div>
        <div><dt>Wins</dt><dd class="${dW == null ? "" : dW >= 0.5 ? "good" : dW <= -0.5 ? "bad" : ""}">${dW == null ? "n/a" : (dW >= 0 ? "+" : "") + dW.toFixed(1)}</dd><dd class="rs">${A.after ? `${A.before.BOS.toFixed(0)} → ${A.after.BOS.toFixed(0)} projected` : "projection after the trade"}</dd></div>
        <div><dt>Exception</dt><dd>${esc(exc[0])}</dd><dd class="rs">${esc(exc[1])}</dd></div>
        <div><dt>Boston's read</dt><dd class="${A.ours >= 0 ? "good" : "bad"}">${sv(A.ours)}</dd><dd class="rs">total surplus value</dd></div>
      </dl></div>`;
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
        <div><div class="small muted">${esc(App.poss(W.T[tr.b].fo.lead))} answer</div><div class="verdict ${re.verdict === "yes" ? "good" : re.verdict === "close" ? "warnc" : "bad"}">${verdictName}</div></div>
        <p class="small" style="margin:8px 0 10px">${esc(re.veto || (re.verdict === "yes" ? "The value works for them." : re.verdict === "close" ? "They want a little more." : "They don't see enough value."))}${re.why.length ? " " + esc(re.why.join(". ")) + "." : ""}</p>
        ${App.readHTML(W, tr, A)}
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
  const TOOL = { room: "Cap room", ntmle: "Mid-level", tmle: "Taxpayer mid-level", rmle: "Room mid-level", bae: "Bi-annual", min: "Minimum", bird: "Bird rights", two: "Two-way" };
  App.TOOL = TOOL;
  const raiseOf = via => via === "bird" ? 0.08 : via === "min" ? 0 : 0.05;
  const yearsFor = (via, ask) => via === "min" || via === "tmle" || via === "bae" ? Math.min(2, ask.years) : Math.min(via === "bird" ? 5 : 4, ask.years);
  // Boston's simplest way to sign him: his Bird rights if Boston has them, else the smallest tool that covers his ask
  App.faBest = (W, p) => {
    const i = W.season, ask = Mo.faHaul(p, i, W), b = L.budget(W, "BOS", p);
    const opts = b.opts.map(o => { const years = yearsFor(o.via, ask); return { via: o.via, amt: o.amt, years, cap: o.via === "min" ? o.amt : o.amt * L.raiseFac(years, raiseOf(o.via)) }; });
    const own = opts.find(o => o.via === "bird");
    const cover = opts.filter(o => o.cap >= ask.aav * 0.98).sort((x, y) => x.cap - y.cap);
    const pick = own || (ask.aav <= CBA.minSal(p.yos, i) * 1.05 && opts.find(o => o.via === "min")) || cover[0] || opts.filter(o => o.via !== "min").sort((x, y) => y.cap - x.cap)[0] || opts[0];
    if (!pick) return null;
    const aav = Math.min(ask.aav, pick.cap);
    return { via: pick.via, years: pick.years, total: Math.round(aav * pick.years / 1e5) * 1e5, covers: pick.cap >= ask.aav * 0.98, ask, opts };
  };
  App.twoOpen = W => L.twoWays(W, "BOS", W.season + (["draft", "options", "expansion"].includes(W.phase) ? 1 : 0)).length < 3;
  // Summer free agency: offers go out when the round runs. Any other time: he signs now (or doesn't).
  const summer = W => W.phase === "fa";
  App.faRow = (W, p, own) => {
    const i = W.season, best = App.faBest(W, p), o = (W.faOffers || {})[p.id], ask = best ? best.ask : Mo.faHaul(p, i, W);
    const meta = `${esc(App.posName(p))}, ${p.age}, rated ${App.ovr(p)}${own ? `, ${esc(p.rights.kind)} rights, hold ${m(p.rights.hold)}` : p.rights && W.T[p.rights.team] ? `, ${esc(W.T[p.rights.team].name)}${p.rights.rfa && p.rights.tendered ? " (restricted)" : ""}` : ""}${p.undrafted ? ", undrafted" : ""}`;
    const rfa = p.rights && p.rights.rfa && p.rights.tendered ? `<span class="chip w">Restricted: qualifying offer ${m(p.rights.qo)}</span>` : "";
    const two = L.takesTwoWay(W, p) && App.twoOpen(W) && !own;
    let acts = "";
    if (o) acts = `<span class="chip g">${o.via === "two" ? "Two-way offered" : `Offered ${m(o.total / o.years)} x ${o.years}`}</span>${o.failed ? `<span class="small bad">${esc(o.failed)}</span>` : ""}<button class="btn ghost sm" type="button" data-act="faOffer" data-id="${p.id}">Change</button><button class="btn ghost sm" type="button" data-act="faPull" data-id="${p.id}">Pull</button>`;
    else if (best) {
      const lbl = `${summer(W) ? (own ? "Re-sign" : "Offer") : "Sign"} ${m(best.total / best.years)} x ${best.years}`;
      acts = `<button class="btn sm" type="button" data-act="faQuick" data-id="${p.id}">${lbl}</button><button class="btn ghost sm" type="button" data-act="faOffer" data-id="${p.id}">Adjust</button>${two ? `<button class="btn ghost sm" type="button" data-act="faTwo" data-id="${p.id}">Two-way</button>` : ""}`;
    } else acts = two ? `<button class="btn ghost sm" type="button" data-act="faTwo" data-id="${p.id}">Two-way</button>` : `<span class="small muted">No way to fit him now</span>`;
    if (own) acts += `<button class="btn ghost sm" type="button" data-act="faSnt" data-id="${p.id}">Sign-and-trade</button><button class="btn ghost sm" type="button" data-act="faRenounce" data-id="${p.id}">Renounce</button>`;
    return `<li class="fa">
      <div class="fa-who"><button class="linkish" type="button" data-act="player" data-id="${p.id}"><b>${esc(p.n)}</b></button><span class="small muted">${meta}</span>${rfa}</div>
      <div class="fa-ask"><b>${m(ask.aav)} x ${ask.years}</b><span class="small muted">${best ? (best.covers ? `fits: ${TOOL[best.via]}` : `${TOOL[best.via]} tops out at ${m(best.total / best.years)}`) : "asking"}${Mo.askDecay(p, W) < 0.97 ? ", asking less lately" : ""}</span></div>
      <div class="fa-act">${acts}</div></li>`;
  };
  App.faList = (W, list, own) => `<ul class="plain fa-list">${list.map(p => App.faRow(W, p, own)).join("") || `<li class="muted small" style="padding:8px 0">Nobody in that group.</li>`}</ul>`;
  App.faFilters = (W, key) => {
    const i = W.season, b = L.budget(W, "BOS"), cur = App.ui[key] || "all";
    const amtOf = v => Math.max(0, ...b.opts.filter(o => v.includes(o.via)).map(o => o.amt));
    const FITS = { all: () => true, min: p => Mo.faHaul(p, i, W).aav <= CBA.minSal(p.yos, i) * 1.15, two: p => L.takesTwoWay(W, p), mle: p => Mo.faHaul(p, i, W).aav <= amtOf(["ntmle", "tmle", "rmle"]) * 1.05, bae: p => Mo.faHaul(p, i, W).aav <= amtOf(["bae"]) * 1.05, room: p => Mo.faHaul(p, i, W).aav <= amtOf(["room"]) * 1.05 };
    const btns = [["all", "Everyone"], ["min", "Takes the minimum"], ["two", "Takes a two-way"], ["mle", "Fits a mid-level"], ["bae", "Fits the bi-annual"], ["room", "Fits cap room"]].filter(([k]) => k === "all" || k === "min" || (k === "two" && App.twoOpen(W)) || (k === "mle" && amtOf(["ntmle", "tmle", "rmle"])) || (k === "bae" && amtOf(["bae"])) || (k === "room" && amtOf(["room"])));
    return { fit: FITS[cur] || FITS.all, html: `<div class="seg" role="group" aria-label="Show">${btns.map(([k, n]) => `<button type="button" aria-pressed="${cur === k}" data-act="faFit" data-key="${key}" data-k="${k}">${n}</button>`).join("")}</div>` };
  };
  App.acts.faFit = el => { App.ui[el.dataset.key || "faFit"] = el.dataset.k; App.render(); };
  function signHTML(W) {
    const twos = Object.values(W.P).filter(p => p.t === "BOS" && p.two);
    let html = "";
    html += `<p class="small" style="margin-top:0">${summer(W) ? "Free agency is on: offers go out when you run the next round in the Season tab." : "Outside the July rounds, a free agent decides on the spot."} Boston has ${L.rosterCount(W, "BOS")} players on standard deals and ${twos.length} of 3 two-way spots filled.</p>`;
    if (twos.length) html += `<h3>Two-way players</h3><ul class="plain">${twos.map(p => `<li class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(p.n)} <span class="small muted">rated ${App.ovr(p)}, through ${App.sn(p.c.twoEnd ?? W.season)}</span></span><span class="row" style="gap:6px"><button class="btn ghost sm" type="button" data-act="cvQueue" data-id="${p.id}">Convert to a standard deal</button><button class="btn ghost sm" type="button" data-act="twCut" data-id="${p.id}">Release</button></span></li>`).join("")}</ul>`;
    const F = App.faFilters(W, "sgFit");
    const all = Object.values(W.P).filter(p => p.t === "FA" && !p.offerSheet).sort((a, b) => Mo.r(b) - Mo.r(a));
    html += `<h3 style="margin-top:14px">Free agents</h3>${F.html}`;
    if (!all.length) return html + `<p class="muted">No unsigned free agents. The market opens July 1.</p>`;
    return html + App.faList(W, all.filter(F.fit).slice(0, 40), false);
  }
  App.acts.cvQueue = el => { const p = App.W.P[el.dataset.id]; App.W.queue.push({ type: "convert", id: p.id, label: `Convert ${p.n} to a standard contract` }); App.afterChange(); };
  App.acts.twCut = el => { const W = App.W, p = W.P[el.dataset.id]; p.t = "FA"; p.two = false; p.faDate = W.date; p.c = { sal: [], opt: {}, dec: {}, signed: W.season, bird: 0 }; L.news(W, `Boston releases ${p.n} from his two-way deal.`, "move", "BOS"); App.flash(true, `Released ${p.n}.`); App.afterChange(); };
  // Sign now (outside the July rounds): checks the roster, the hard cap and the tool, then he decides
  App.signNow = (W, p, via, years, total) => {
    const i = W.season, sal = CBA.buildSalaries(years, total, via === "min" ? "flat" : "up", raiseOf(via));
    const hard = W.T.BOS.hard[i], pay = L.payrollNow(W, "BOS");
    const tool = L.budget(W, "BOS", p).opts.find(o => o.via === via);
    if (L.inSeason(W) && L.rosterCount(W, "BOS") >= 15) return { ok: false, why: "The roster is full (15). Waive someone first." };
    if (hard && pay + sal[0] > CBA.levelAmt(hard, i)) return { ok: false, why: `Boston is hard-capped at the ${CBA.LEVEL_NAME[hard]}: only ${m(Math.max(0, CBA.levelAmt(hard, i) - pay))} of room.` };
    if (!tool || sal[0] > tool.amt + 1000) return { ok: false, why: tool ? `The ${TOOL[via].toLowerCase()} covers ${m(tool.amt)} a year now.` : "That tool isn't available." };
    const ask = Mo.faHaul(p, i, W), odds = Mo.offerOdds(total, ask.aav * Math.min(years, ask.years) * (L.inSeason(W) ? 0.75 : 0.9), p.age);
    const r = L.rng(W);
    if (r() > odds) return { ok: false, why: `${p.n} passed (${App.pct(odds)} odds). More money or years might do it.` };
    L.sign(W, "BOS", p.id, years, total, via === "min" ? "flat" : "up", via);
    return { ok: true, why: `${p.n} signs: ${years} year${years > 1 ? "s" : ""}, ${m(total)}.` };
  };
  App.acts.faQuick = el => {
    const W = App.W, p = W.P[el.dataset.id], best = App.faBest(W, p); if (!best) return;
    if (summer(W)) { W.faOffers = W.faOffers || {}; W.faOffers[p.id] = { years: best.years, total: best.total, via: best.via, shape: "up" }; App.flash(true, `Offer out to ${p.n}: ${best.years} years, ${m(best.total)} (${TOOL[best.via]}). He decides when the round runs.`); }
    else { const r = App.signNow(W, p, best.via, best.years, best.total); App.flash(r.ok, r.why); }
    App.afterChange();
  };
  App.acts.faTwo = el => {
    const W = App.W, p = W.P[el.dataset.id], yrs = p.yos ? 1 : 2;
    if (summer(W)) { W.faOffers = W.faOffers || {}; W.faOffers[p.id] = { years: yrs, total: 0, via: "two" }; App.flash(true, `Two-way offer out to ${p.n}.`); }
    else { L.signTwoWay(W, "BOS", p.id, yrs); App.flash(true, `${p.n} signs a two-way deal.`); }
    App.afterChange();
  };
  App.acts.faPull = el => { delete (App.W.faOffers || {})[el.dataset.id]; App.afterChange(); };
  App.acts.faOffer = el => {
    const W = App.W, p = W.P[el.dataset.id], best = App.faBest(W, p), o = (W.faOffers || {})[p.id];
    const via = o && o.via !== "two" ? o.via : best ? best.via : "min";
    App.ui.fao = { id: p.id, via, years: o && o.via !== "two" ? o.years : best ? best.years : 1, total: o && o.via !== "two" ? o.total : best ? best.total : CBA.minSal(p.yos, W.season) };
    renderFAO();
  };
  function renderFAO() {
    const W = App.W, st = App.ui.fao, p = W.P[st.id], i = W.season, ask = Mo.faHaul(p, i, W), b = L.budget(W, "BOS", p);
    if (!b.opts.length) { App.dlg(`Offer: ${p.n}`, `<p>Boston has no way to sign him right now.</p>`); return; }
    const tool = b.opts.find(o => o.via === st.via) || b.opts[0]; st.via = tool.via;
    const sal = CBA.buildSalaries(st.years, st.total, st.via === "min" ? "flat" : "up", raiseOf(st.via));
    const over = sal[0] > tool.amt + 1000;
    const odds = Mo.offerOdds(st.total, ask.aav * Math.min(st.years, ask.years) * (summer(W) ? 1 : L.inSeason(W) ? 0.75 : 0.9), p.age);
    App.dlg(`${summer(W) ? "Offer" : "Sign"}: ${p.n}`, `<p class="small">He's asking about ${m(ask.aav)} a year for ${ask.years} year${ask.years > 1 ? "s" : ""}. Raises are built in: 8% a year on Bird rights, 5% otherwise.</p>
      <div class="row"><label class="f">Using<select data-on="faoVia">${b.opts.map(o => `<option value="${o.via}"${o.via === st.via ? " selected" : ""}>${TOOL[o.via]} (first year up to ${m(o.amt)})</option>`).join("")}</select></label>
      <label class="f">Years<select data-on="faoYears">${[1, 2, 3, 4, 5].filter(y => st.via === "bird" || y <= 4).map(y => `<option${y === st.years ? " selected" : ""}>${y}</option>`).join("")}</select></label>
      <label class="f">Total ($M)<input type="number" step="0.1" min="0.5" value="${(st.total / 1e6).toFixed(1)}" data-on="faoTotal"></label></div>
      <p class="small">${sal.map((x, k) => `${App.sn(i + k)} ${m2(x)}`).join(", ")}${over ? ` <span class="bad">First year is over the ${m(tool.amt)} available.</span>` : ""}</p>
      ${summer(W) ? `<p class="small muted">Other teams bid too. He weighs money, years and how good each team is.</p>` : `<p class="small"><b>${App.pct(odds)}</b> he signs.</p>`}
      <div class="row"><button class="btn" type="button" data-act="faoSave"${over ? " disabled" : ""}>${summer(W) ? "Make the offer" : "Sign him"}</button>${(W.faOffers || {})[p.id] ? `<button class="btn ghost" type="button" data-act="faoPull">Pull it</button>` : ""}</div>`);
  }
  App.acts.faoVia = el => { App.ui.fao.via = el.value; renderFAO(); };
  App.acts.faoYears = el => { App.ui.fao.years = +el.value; renderFAO(); };
  App.acts.faoTotal = el => { App.ui.fao.total = Math.round((+el.value || 0) * 1e6); renderFAO(); };
  App.acts.faoSave = () => {
    const W = App.W, st = App.ui.fao, p = W.P[st.id];
    App.closeDlg();
    if (summer(W)) { W.faOffers = W.faOffers || {}; W.faOffers[st.id] = { years: st.years, total: st.total, via: st.via, shape: st.via === "min" ? "flat" : "up" }; }
    else { const r = App.signNow(W, p, st.via, st.years, st.total); App.flash(r.ok, r.why); }
    App.afterChange();
  };
  App.acts.faoPull = () => { delete App.W.faOffers[App.ui.fao.id]; App.closeDlg(); App.afterChange(); };

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
