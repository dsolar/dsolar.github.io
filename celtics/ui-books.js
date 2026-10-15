/* Banner 19: the Books tab. Multi-season cap sheet, holds, options, tools, picks, exceptions, guardrails. */
(function () {
  "use strict";
  const App = window.App, L = window.League, CBA = window.CBA, Mo = window.Model;
  const esc = App.esc, m2 = App.m2, m = App.m;
  const YEARS = 5;

  function optChip(W, p, j) {
    const v = L.optionView(W, p, j);
    if (!v) return "";
    const label = { PO: "Player option", TO: "Team option", MO: "Mutual option", NG: "Non-guaranteed" }[v.kind];
    let state;
    if (v.dec) state = v.dec === "in" ? "picked up" : "declined";
    else if (v.kind === "PO") state = v.set ? (v.set === "in" ? "in (what-if)" : "out (what-if)") : `${App.pct(v.pIn)} in`;
    else if (v.kind === "MO") state = v.final === "in" ? (v.set === "in" ? "Boston in (you)" : !v.set && v.teamWants ? "Boston in" : "he picks it up") : "both out";
    else state = (v.set || v.final) === "in" ? (v.set ? "keep (you)" : "keep") : (v.set ? "decline (you)" : "decline");
    const cls = v.final === "in" ? "in" : "out";
    return `<button class="optbtn ${cls}" type="button" data-act="optCycle" data-id="${p.id}" data-j="${j}" title="${esc(label)}: ${esc(state)}. Click to cycle your plan: in, out, the model's call."><span aria-hidden="true">${v.kind}</span><span class="sr">${esc(label)}</span> ${esc(state)}</button>`;
  }

  App.views.books = {
    render(el) {
      const W = App.W, i0 = W.season, yrs = Array.from({ length: YEARS }, (_, k) => i0 + k);
      const books = yrs.map(i => L.books(W, "BOS", i));
      const dec = L.decider(W);
      const bos = Object.values(W.P).filter(p => p.t === "BOS" && !p.two);
      // rows: anyone with money on the books in the window, or a planned deal
      const rowsP = bos.filter(p => yrs.some(i => (p.c.sal[i] || 0) > 0) || W.plan.resign[p.id])
        .sort((a, b) => (CBA.salaryIn(b, i0, dec) - CBA.salaryIn(a, i0, dec)) || ((b.c.sal[i0 + 1] || 0) - (a.c.sal[i0 + 1] || 0)));
      const cell = (p, i, k) => {
        const s = CBA.salaryIn(p, i, dec), raw = p.c.sal[i] || 0, re = W.plan.resign[p.id];
        if (s > 0) return `<td${p.c.opt[i] ? ' class="opt"' : ""}>${m2(s)}${p.c.opt[i] ? optChip(W, p, i) : ""}</td>`;
        if (raw > 0 && p.c.opt[i]) {
          // option declined (or projected to be): show the money he walks away from, then the plan
          const planned = re && i >= re.start && i - re.start < re.sal.length ? `<br><span class="chip g">${esc(re.label || "Planned deal")}: ${m2(re.sal[i - re.start])}</span>` : "";
          return `<td class="opt"><span class="out">${m2(raw)}</span>${optChip(W, p, i)}${planned}</td>`;
        }
        if (re && i >= re.start && i - re.start < re.sal.length) return `<td>${m2(re.sal[i - re.start])} <span class="chip g">${esc(re.label || "Planned")}</span></td>`;
        const h = books[k].holds.find(x => x.id === p.id);
        if (h) return `<td class="hold">Hold ${m2(h.amt)}<span class="pmeta">${esc(h.kind)}</span></td>`;
        return "<td></td>";
      };
      const head = `<thead><tr><th scope="col">Player</th>${yrs.map((i, k) => `<th scope="col"${k === 0 ? ' class="cur"' : ""}>${App.sn(i)}</th>`).join("")}</tr></thead>`;
      let body = `<tbody><tr class="grp"><th colspan="${YEARS + 1}" scope="colgroup">Under contract</th></tr>`;
      for (const p of rowsP) {
        const fit = [];
        if ((p.tpar || 0) >= 0.45) fit.push("high-volume three");
        body += `<tr><th scope="row"><button class="linkish pname" type="button" data-act="player" data-id="${p.id}">${esc(p.n)}</button><span class="pmeta">${esc(App.posName(p))}, ${p.age + 0} in ${App.sn(i0)}, rated ${App.ovr(p)}${p.note && /Extended|extension/i.test(p.note) ? ", extended" : ""}</span></th>${yrs.map((i, k) => cell(p, i, k)).join("")}</tr>`;
      }
      // holds that aren't attached to a contract row (rights, picks)
      const extraHolds = new Map();
      books.forEach((b, k) => b.holds.forEach(h => { if (!h.id || !rowsP.find(p => p.id === h.id)) { const key = h.pick || h.n; if (!extraHolds.has(key)) extraHolds.set(key, { n: h.n, kind: h.kind, by: {} }); extraHolds.get(key).by[k] = h.amt; } }));
      if (extraHolds.size) {
        body += `<tr class="grp"><th colspan="${YEARS + 1}" scope="colgroup">Cap holds: rights and unsigned picks (count against the cap, not the tax)</th></tr>`;
        for (const h of extraHolds.values()) body += `<tr><th scope="row">${esc(h.n)}<span class="pmeta">${esc(h.kind)}</span></th>${yrs.map((_, k) => h.by[k] ? `<td class="hold">${m2(h.by[k])}</td>` : "<td></td>").join("")}</tr>`;
      }
      const deadAll = W.T.BOS.dead;
      body += `<tr class="grp"><th colspan="${YEARS + 1}" scope="colgroup">Dead money</th></tr>`;
      if (deadAll.length) for (const d of deadAll) body += `<tr><th scope="row">${esc(d.n)}<span class="pmeta">${esc(d.why || "")}</span></th>${yrs.map(i => `<td>${d.sal[i] ? m2(d.sal[i]) : ""}</td>`).join("")}</tr>`;
      else body += `<tr><th scope="row" class="muted">None on the books</th>${yrs.map(() => "<td></td>").join("")}</tr>`;
      const two = Object.values(W.P).filter(p => p.t === "BOS" && p.two);
      if (two.length) {
        body += `<tr class="grp"><th colspan="${YEARS + 1}" scope="colgroup">Two-way contracts (don't count against the cap)</th></tr>`;
        for (const p of two) body += `<tr><th scope="row"><button class="linkish pname" type="button" data-act="player" data-id="${p.id}">${esc(p.n)}</button><span class="pmeta">${esc(App.posName(p))}, rated ${App.ovr(p)}</span></th><td>Two-way</td>${yrs.slice(1).map(() => "<td></td>").join("")}</tr>`;
      }
      body += "</tbody>";
      const tr = (label, f, cls) => `<tr${cls ? ` class="${cls}"` : ""}><th scope="row">${label}</th>${books.map((b, k) => `<td>${f(b, k)}</td>`).join("")}</tr>`;
      const foot = `<tfoot>
        ${tr("Team salary<span class=\"pmeta\">What the tax and aprons see</span>", b => m2(b.payroll) + (b.fillN ? `<span class="pmeta">incl. ${b.fillN} open spot${b.fillN > 1 ? "s" : ""} at the minimum</span>` : ""), "tot")}
        ${tr("Cap holds", b => b.holdAmt ? m2(b.holdAmt) : "")}
        ${tr("Cap number<span class=\"pmeta\">Salary plus holds</span>", b => m2(b.capNum))}
        ${tr("Salary cap", b => `${m2(b.cap)}<span class="pmeta">${b.capNum > b.cap ? m(b.capNum - b.cap) + " over" : m(b.cap - b.capNum) + " room"}</span>`)}
        ${tr("Tax line", b => `${m2(b.taxLine)}<span class="pmeta ${b.payroll > b.taxLine ? "bad" : "good"}">${b.payroll > b.taxLine ? m(b.payroll - b.taxLine) + " over" : m(b.taxLine - b.payroll) + " under"}</span>`)}
        ${tr("First apron", b => `${m2(b.a1)}${b.hard === "a1" ? '<span class="pmeta bad">Hard cap</span>' : ""}`)}
        ${tr("Second apron", b => `${m2(b.a2)}${b.hard === "a2" ? '<span class="pmeta bad">Hard cap</span>' : ""}`)}
        ${tr("Tax bill", b => b.tax ? `<span class="bad">${m2(b.tax)}</span><span class="pmeta">${b.rep ? "Repeater rates" : "Standard rates"}</span>` : `$0<span class="pmeta">${b.rep ? "Would be repeater" : "Standard rates"}</span>`, "tot")}
      </tfoot>`;
      const ladders = books.map(b => ladder(b)).join("");
      el.innerHTML = `
      <section class="panel" aria-labelledby="books-h">
        <h2 id="books-h">The books</h2>
        <p class="sub">Every dollar Boston has committed, ${App.sn(i0)} through ${App.sn(i0 + YEARS - 1)}. Options show what the model expects; click one to set your plan. Players whose deals end turn into cap holds the next summer. Future seasons assume the cap grows 7% a year and empty roster spots get filled at the minimum.</p>
        <div class="scroller"><table class="sheet">${head}${body}${foot}</table></div>
        <div class="ladders">${ladders}</div>
      </section>
      <div class="grid2">
        ${guardCard(W, books)}
        ${optionsCard(W)}
      </div>
      <div class="grid2" style="margin-top:16px">
        ${toolsCard(W, i0)}
        ${extCard(W)}
      </div>
      <div class="grid2" style="margin-top:16px">
        ${picksCard(W)}
        ${tpeCard(W)}
      </div>
      <div style="margin-top:16px">${L.expansionPreview ? expansionCard(W) : ""}</div>`;
    }
  };

  function ladder(b) {
    const top = Math.max(b.a2 * 1.06, b.payroll * 1.03), x = v => Math.min(100, v / top * 100);
    const lo = b.cap * 0.75, X = v => Math.max(0, Math.min(100, (v - lo) / (top - lo) * 100));
    const ticks = [["Cap", b.cap], ["Tax", b.taxLine], ["1st", b.a1], ["2nd", b.a2]];
    const st = b.status;
    return `<div class="ladder"><div class="yr">${App.sn(b.i)}</div>
      <div class="big">${m(b.payroll)}</div>
      <div class="small ${st === "a1" || st === "a2" ? "bad" : st === "tax" ? "warnc" : "muted"}">${CBA.STATUS_NAME[st]}${b.tax ? `, ${m(b.tax)} tax` : ""}</div>
      <div class="bar" role="img" aria-label="${esc(App.sn(b.i))}: ${m(b.payroll)} team salary. Cap ${m(b.cap)}, tax ${m(b.taxLine)}, first apron ${m(b.a1)}, second apron ${m(b.a2)}.">
        <span class="fill ${st}" style="width:${X(b.payroll)}%"></span>
        ${ticks.map(([n, v]) => `<span class="tick${(b.hard === "a1" && n === "1st") || (b.hard === "a2" && n === "2nd") ? " hard" : ""}" style="left:${X(v)}%"></span><span class="tl" style="left:${X(v)}%">${n}</span>`).join("")}
      </div></div>`;
  }

  function guardCard(W, books) {
    const i0 = W.season, out = [];
    const s = W.settings;
    if (i0 === 0) {
      const b = books[0], ok = b.payroll <= b.taxLine;
      out.push(`<li><span class="chip ${ok ? "g" : "b"}">${ok ? "On track" : "Broken"}</span> <b>No tax in 2026-27.</b> ${ok ? `${m(b.taxLine - b.payroll)} of room under the line.` : `${m(b.payroll - b.taxLine)} over the line.`} Boston is also hard-capped at the first apron (${m(b.a1)}) after signing Robinson with the full mid-level.</li>`);
    }
    const taxYears = books.filter(b => b.tax > 0 && b.i > 0);
    out.push(`<li><span class="chip g">Allowed</span> <b>Tax from 2027-28 on.</b> ${taxYears.length ? "Projected bills: " + taxYears.map(b => `${App.sn(b.i)} ${m(b.tax)}${b.rep ? " (repeater)" : ""}`).join(", ") + "." : "Nothing projected yet."}</li>`);
    const a2 = books.filter(b => b.status === "a2");
    const twoRun = books.some((b, k) => k > 0 && b.status === "a2" && books[k - 1].status === "a2");
    const odds = App.titleOdds().BOS || 0;
    out.push(`<li><span class="chip ${twoRun ? "b" : a2.length ? "w" : "g"}">${twoRun ? "Broken" : a2.length ? "Check" : "On track"}</span> <b>Second apron only as a title contender, never two years running.</b> ${a2.length ? `Projected over it in ${a2.map(b => App.sn(b.i)).join(", ")}. Title odds right now: ${App.pct(odds)}.` : "Not projected over it."} A season over it freezes a first-round pick seven years out.</li>`);
    // repeater clock
    const t = W.T.BOS, hist = [-4, -3, -2, -1].map(j => `${App.sn(j)} ${t.taxHist[j] ? "paid" : "no tax"}`).join(", ");
    const reps = books.map(b => `${App.sn(b.i)}: ${b.rep ? "repeater" : "standard"}`).join(", ");
    return `<section class="card" aria-labelledby="guard-h"><h3 id="guard-h">Ownership's rules</h3>
      <ul class="plain" style="display:grid;gap:10px">${out.join("")}</ul>
      <p class="small muted" style="margin:12px 0 0"><b>Repeater clock.</b> Teams that paid tax in three of the previous four seasons pay higher rates. History: ${esc(hist)}. If Boston stays out this season, the next bill is at standard rates. Rates as projected: ${esc(reps)}.</p>
      ${planList(W)}
    </section>`;
  }
  function planList(W) {
    const items = [];
    for (const [k, v] of Object.entries(W.plan.opt)) {
      const [id, j] = k.split("@"), p = W.P[id]; if (!p) continue;
      items.push(`<li>${esc(p.n)}, ${App.sn(+j)} ${p.c.opt[j] || ""}: ${v === "in" ? "in" : "out"} <button class="linkish small" type="button" data-act="planUndo" data-k="${esc(k)}">Undo</button></li>`);
    }
    for (const [id, re] of Object.entries(W.plan.resign)) { const p = W.P[id]; if (p) items.push(`<li>${esc(p.n)}: ${esc(re.label)}, ${re.sal.length} years, ${m(re.sal.reduce((a, b) => a + b, 0))} <button class="linkish small" type="button" data-act="planUndoRe" data-id="${id}">Undo</button></li>`); }
    for (const id of Object.keys(W.plan.renounce)) { const p = W.P[id]; if (p) items.push(`<li>Renounce ${esc(p.n)} <button class="linkish small" type="button" data-act="planUndoRen" data-id="${id}">Undo</button></li>`); }
    if (!items.length) return `<p class="small muted" style="margin:10px 0 0">Your plan is empty: the books show the model's expectations. Set option calls on the sheet or in the list to the right.</p>`;
    return `<h3 style="margin-top:14px">Your plan</h3><ul class="small" style="margin:0;padding-left:18px">${items.join("")}</ul><button class="btn ghost sm" type="button" data-act="planClear" style="margin-top:8px">Clear the plan</button>`;
  }

  function optionsCard(W) {
    const i0 = W.season, list = [];
    for (const p of Object.values(W.P)) {
      if (p.t !== "BOS") continue;
      for (const [j, kind] of Object.entries(p.c.opt)) {
        if (+j < i0 || +j > i0 + 4 || p.c.dec[j] || !(p.c.sal[j] > 0)) continue;
        list.push({ p, j: +j, kind });
      }
    }
    list.sort((a, b) => a.j - b.j || (b.p.c.sal[b.j] - a.p.c.sal[a.j]));
    const rows = list.map(({ p, j, kind }) => {
      const v = L.optionView(W, p, j);
      let read;
      if (kind === "PO") read = `${App.pct(v.pIn)} he opts in. He's worth about ${m(v.mv)} that season by the model.`;
      else if (kind === "MO") read = `Either side can pick it up. He ${v.pIn >= 0.5 ? "would" : "wouldn't"} (${App.pct(v.pIn)}); the model ${v.teamWants ? "says Boston should" : "says Boston shouldn't"} (worth ${m(v.mv)}).`;
      else read = `Worth about ${m(v.mv)} by the model, ${v.teamWants ? "so keep him" : "so it's a decline"}.`;
      const neg = kind === "PO" && v.pIn >= 0.5 ? `<button class="btn ghost sm" type="button" data-act="optout" data-id="${p.id}" data-j="${j}">Ask him to opt out for a longer deal</button>` : "";
      return `<li style="padding:10px 0;border-bottom:1px solid var(--line)"><b>${esc(p.n)}</b>, ${App.sn(j)} ${CBA.OPT_NAME[kind].toLowerCase()} at ${m2(p.c.sal[j])}<br><span class="small muted">${esc(read)}</span><div class="row" style="margin-top:6px">${optChip(W, p, j)}${neg}</div></li>`;
    }).join("");
    return `<section class="card" aria-labelledby="opt-h"><h3 id="opt-h">Option calls</h3>
      <p class="small muted" style="margin:0 0 6px">You make the team-option calls. Players decide their own options: the model's read is shown, and you can plan a what-if. Mutual options are the 2026 kind: picked up if either side wants it.</p>
      <ul class="plain">${rows || "<li class='muted'>No open options in the next five seasons.</li>"}</ul></section>`;
  }

  function toolsCard(W, i0) {
    const show = i => {
      const t = L.tools(W, "BOS", i);
      return `<h3 style="margin-top:${i === i0 ? 0 : 14}px">${App.sn(i)}${i > i0 ? " (projected)" : ""}</h3>
        ${t.hard ? `<p class="small"><span class="chip b">Hard-capped</span> at the ${CBA.LEVEL_NAME[t.hard]}${t.hardWhy ? ": " + esc(t.hardWhy) : ""}.</p>` : ""}
        <ul class="plain">${t.tools.map(x => `<li style="display:grid;grid-template-columns:1fr auto;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)"><span><b>${esc(x.name)}</b><br><span class="small muted">${esc(x.why)}</span></span><span class="${x.ok ? "good" : "muted"}" style="font-weight:700">${x.ok ? m(x.amt) : "No"}</span></li>`).join("")}</ul>`;
    };
    return `<section class="card" aria-labelledby="tools-h"><h3 id="tools-h" class="sr">Cap tools</h3>${show(i0)}${show(i0 + 1)}</section>`;
  }

  function extCard(W) {
    const i0 = W.season;
    const ps = Object.values(W.P).filter(p => p.t === "BOS" && !p.two).sort((a, b) => b.c.sal[i0] - a.c.sal[i0]);
    const rows = ps.map(p => {
      const e = CBA.extEligible(p, i0);
      if (!e.ok) return `<li class="small" style="padding:5px 0;border-bottom:1px solid var(--line)"><b>${esc(p.n)}</b>: <span class="muted">${esc(e.why)}</span></li>`;
      const lim = CBA.extLimit(p, i0);
      return `<li style="padding:8px 0;border-bottom:1px solid var(--line)"><b>${esc(p.n)}</b> <span class="chip g">Eligible</span><br><span class="small muted">${lim.kind === "rookie" ? "Rookie scale extension" : "Veteran extension"}: up to ${lim.maxYears} new season${lim.maxYears === 1 ? "" : "s"} from ${App.sn(lim.start)}, first year up to ${m(lim.first)}.</span><br><button class="btn ghost sm" type="button" data-act="goExtend" data-id="${p.id}" style="margin-top:4px">Offer an extension</button></li>`;
    }).join("");
    return `<section class="card" aria-labelledby="ext-h"><h3 id="ext-h">Extensions</h3><ul class="plain">${rows}</ul></section>`;
  }

  function picksCard(W) {
    const own = W.picks.filter(p => p.owner === "BOS").sort((a, b) => a.y - b.y || a.r - b.r);
    const owed = W.picks.filter(p => p.from === "BOS" && p.owner !== "BOS").sort((a, b) => a.y - b.y || a.r - b.r);
    const row = p => `<tr><td>${p.y}</td><td>${p.r === 1 ? "First" : "Second"}</td><td>${esc(p.from === "BOS" ? "Own" : W.T[p.from].name)}${p.note ? `<span class="pmeta">${esc(p.note)}</span>` : ""}</td><td>${p.r === 1 ? "No. " + L.projSlot(W, p.from, p.y) : ""}</td></tr>`;
    return `<section class="card" aria-labelledby="picks-h"><h3 id="picks-h">Draft picks</h3>
      <table class="std"><thead><tr><th scope="col">Year</th><th scope="col">Round</th><th scope="col">Whose</th><th scope="col">Projected</th></tr></thead><tbody>${own.map(row).join("")}</tbody></table>
      <p class="small muted" style="margin:10px 0 0"><b>Owed away:</b> ${owed.filter(p => p.r === 1).map(p => `${p.y} first to ${W.T[p.owner] ? W.T[p.owner].name : "another team"}`).join(", ") || "none"}. Boston's own seconds were traded away over the years. Stepien rule: Boston can't be without a first in back-to-back drafts, so with 2029 gone, the 2028 and 2030 firsts are locked unless another first comes back.</p></section>`;
  }

  function tpeCard(W) {
    const list = W.T.BOS.tpes.filter(t => !(t.exp && W.date > t.exp));
    const st = L.books(W, "BOS", W.season).status;
    return `<section class="card" aria-labelledby="tpe-h"><h3 id="tpe-h">Trade exceptions</h3>
      ${list.length ? `<ul class="plain">${list.map(t => { const u = L.tpeUsable(W, W.T.BOS, t, st); return `<li style="padding:8px 0;border-bottom:1px solid var(--line)"><span class="bigstat gold" style="font-size:32px">${m(t.amt)}</span><br><b>From ${esc(t.from)}</b>, made ${esc(L.fmtDate(t.made))}, expires ${esc(L.fmtDate(t.exp))}.<br><span class="small muted">Absorbs one or more players earning up to ${m(t.amt + 250000)} combined. ${u.ok ? "Usable now" : esc(u.why)}. It can't be combined with another exception or with player salary. Teams that end a trade over the first apron can't use one made in an earlier season.</span></li>`; }).join("")}</ul>` : "<p class='muted'>None right now.</p>"}
      <p class="small muted" style="margin:10px 0 0">The trade builder looks for the structure that leaves the biggest new exception: absorb incoming salary into an old exception and send players out on their own, the way Boston turned the Simons trade into a $27.7M exception.</p></section>`;
  }

  function expansionCard(W) {
    const pv = L.expansionPreview(W);
    if (!pv) return "";
    return `<section class="card" aria-labelledby="exp-h"><h3 id="exp-h">Expansion draft, if it happens</h3>
      <p class="small">The league is still exploring Seattle and Las Vegas (a decision is expected by the end of 2026; play could start in 2028-29). No rules are set, so this uses the 2004 Bobcats rules: each team protects eight players and loses at most one. Turn it on for GM mode in the Season tab.</p>
      <p class="small"><b>Boston's eight to protect, by value</b>: ${pv.protect.map(p => esc(p.n)).join(", ")}.</p>
      <p class="small"><b>Exposed</b>: ${pv.exposed.map(x => `${esc(x.p.n)} (${m(x.p.c.sal[pv.i] || 0)})`).join(", ") || "nobody"}.</p>
      ${pv.likely ? `<p class="notice"><b>Most likely loss: ${esc(pv.likely.p.n)}.</b> ${esc(pv.why)}</p>` : ""}</section>`;
  }

  // ---------- Actions ----------
  App.acts.optCycle = el => {
    const W = App.W, id = el.dataset.id, j = +el.dataset.j, p = W.P[id], kind = p.c.opt[j], key = id + "@" + j;
    if (p.c.dec[j]) return;
    const cur = W.plan.opt[key];
    // cycle: model's call -> in -> out -> model's call
    W.plan.opt[key] = cur === undefined ? "in" : cur === "in" ? "out" : undefined;
    if (W.plan.opt[key] === undefined) delete W.plan.opt[key];
    App.afterChange();
  };
  App.acts.planUndo = el => { delete App.W.plan.opt[el.dataset.k]; App.afterChange(); };
  App.acts.planUndoRe = el => { const id = el.dataset.id, re = App.W.plan.resign[id]; delete App.W.plan.resign[id]; if (re && re.optKey) delete App.W.plan.opt[re.optKey]; App.afterChange(); };
  App.acts.planUndoRen = el => { delete App.W.plan.renounce[el.dataset.id]; App.afterChange(); };
  App.acts.planClear = () => { App.W.plan = { opt: {}, resign: {}, renounce: {}, optout: {} }; App.afterChange(); };
  App.acts.goExtend = el => { App.ui.compose = "extend"; App.ui.ext = { id: el.dataset.id }; App.closeDlg(); App.go("moves"); };

  // ---------- Player card ----------
  App.acts.player = el => App.playerCard(el.dataset.id);
  App.playerCard = id => {
    const W = App.W, p = W.P[id], i0 = W.season, dec = L.decider(W);
    const lv = p.live;
    const rows = [];
    for (let j = i0; j < i0 + 6; j++) { const raw = p.c.sal[j] || 0; if (!raw) continue; rows.push(`<tr><td>${App.sn(j)}</td><td>${m2(raw)}</td><td>${p.c.opt[j] ? esc(CBA.OPT_NAME[p.c.opt[j]]) + ": " + (CBA.optionState(p, j, dec) === "in" ? "in" : "out") : "Guaranteed"}</td><td>${m(Mo.mv(p, j, W))}</td></tr>`); }
    const e = CBA.extEligible(p, i0);
    const team = W.T[p.t] ? W.T[p.t].name : p.t === "FA" ? "Free agent" : "";
    const r = Mo.r(p);
    const html = `
      <p class="small muted" style="margin-top:0">${esc(team)}. ${esc(App.posName(p))}, age ${p.age}, ${p.yos} years of service. ${p.note ? esc(p.note) : ""}</p>
      <div class="grid3" style="gap:10px">
        <div><div class="small muted">Rating</div><div class="bigstat">${App.ovr(p)}</div><div class="small">${r >= 0 ? "+" : ""}${r.toFixed(1)} per 100 (${p.o >= 0 ? "+" : ""}${p.o.toFixed(1)} offense, ${p.d >= 0 ? "+" : ""}${p.d.toFixed(1)} defense)${p.form ? `, shooting form ${p.form > 0 ? "+" : ""}${p.form}` : ""}</div></div>
        <div><div class="small muted">Availability</div><div class="bigstat">${App.pct(p.h)}</div><div class="small">of games, by the injury model</div></div>
        <div><div class="small muted">Shooting profile</div><div class="bigstat">${p.tpar != null ? App.pct(p.tpar) : "n/a"}</div><div class="small">of shots from three${p.ts ? `, ${(p.ts * 100).toFixed(1)}% true shooting` : ""}</div></div>
      </div>
      ${p.ppg != null ? `<p class="small" style="margin:12px 0 0"><b>2025-26:</b> ${p.gp ?? "?"} games, ${p.mpg ?? "?"} minutes, ${p.ppg} points, ${p.rpg} rebounds, ${p.apg} assists.</p>` : ""}
      ${lv ? `<p class="small" style="margin:4px 0 0"><b>${esc(lv.season || "This season")} (live):</b> ${lv.gp} games, ${lv.mpg} minutes, ${lv.ppg} points, ${lv.rpg} rebounds, ${lv.apg} assists, ${lv.tpa} threes tried a game, ${lv.tov} turnovers.</p>` : ""}
      <h3 style="margin-top:14px">Contract</h3>
      ${rows.length ? `<table class="std"><thead><tr><th scope="col">Season</th><th scope="col">Salary</th><th scope="col">Status</th><th scope="col">Worth (model)</th></tr></thead><tbody>${rows.join("")}</tbody></table>` : "<p class='muted'>No contract.</p>"}
      <p class="small muted">${p.c.kick ? `15% trade kicker (about ${m(CBA.kicker(p, i0, dec))} a season to the team that acquires him). ` : ""}${CBA.birdOf(p)} rights. ${esc(e.why)}.${p.noTrade && W.date < p.noTrade ? ` Can't be traded until ${L.fmtDate(p.noTrade)}.` : ""}</p>
      ${p.t === "BOS" ? `<div class="row">
        <button class="btn sm" type="button" data-act="goTrade" data-id="${p.id}">Shop him</button>
        ${e.ok ? `<button class="btn ghost sm" type="button" data-act="goExtend" data-id="${p.id}">Offer an extension</button>` : ""}
        ${Object.entries(p.c.opt).some(([j, k]) => k === "PO" && +j >= i0 && !p.c.dec[j]) ? `<button class="btn ghost sm" type="button" data-act="optout" data-id="${p.id}" data-j="${Object.entries(p.c.opt).find(([j, k]) => k === "PO" && +j >= i0)[0]}">Opt-out deal</button>` : ""}
        ${!p.two ? `<button class="btn ghost sm" type="button" data-act="goWaive" data-id="${p.id}">Waive</button>` : ""}
      </div>` : W.T[p.t] ? `<div class="row"><button class="btn sm" type="button" data-act="goTradeFor" data-id="${p.id}">Trade for him</button></div>` : ""}`;
    App.dlg(p.n, html);
  };
  App.acts.goTrade = el => { App.tradeAdd("BOS", el.dataset.id); App.closeDlg(); App.ui.compose = "trade"; App.go("moves"); };
  App.acts.goTradeFor = el => { const p = App.W.P[el.dataset.id]; App.ui.trade = App.newTrade(p.t); App.tradeAdd(p.t, p.id); App.closeDlg(); App.ui.compose = "trade"; App.go("moves"); };
  App.acts.goWaive = el => { App.ui.compose = "waive"; App.ui.waive = { id: el.dataset.id, stretch: false }; App.closeDlg(); App.go("moves"); };

  // ---------- Opt-out and re-sign ----------
  App.acts.optout = el => {
    const id = el.dataset.id, j = +el.dataset.j, p = App.W.P[id];
    const s = p.c.sal[j];
    const st = App.ui.oo && App.ui.oo.id === id ? App.ui.oo : { id, j, years: 3, total: Math.round((s * 1.35) / 1e6), shape: "up" };
    App.ui.oo = st;
    renderOptOut();
  };
  function renderOptOut() {
    const W = App.W, st = App.ui.oo, p = W.P[st.id], j = st.j, s = p.c.sal[j];
    const total = st.total * 1e6, years = st.years;
    const sal = CBA.buildSalaries(years, total, st.shape, 0.08);
    const odds = Mo.optOutDealOdds(p, j, years, total, W);
    const o38 = CBA.over38(p.age + (j - W.season), years);
    // effect on the books: with and without the plan
    const save = JSON.stringify(W.plan);
    const before = [j, j + 1, j + 2, j + 3].map(i => L.books(W, "BOS", i));
    W.plan.opt[p.id + "@" + j] = "out"; W.plan.resign[p.id] = { start: j, sal, label: "Opt-out and re-sign", optKey: p.id + "@" + j };
    L.bump(W);
    const after = [j, j + 1, j + 2, j + 3].map(i => L.books(W, "BOS", i));
    W.plan = JSON.parse(save); L.bump(W);
    const fx = before.map((b, k) => `<tr><td>${App.sn(b.i)}</td><td>${m2(b.payroll)}</td><td>${m2(after[k].payroll)}</td><td class="${after[k].tax - b.tax > 0 ? "bad" : "good"}">${m(b.tax)} → ${m(after[k].tax)}</td></tr>`).join("");
    const html = `
      <p style="margin-top:0">${esc(p.n)} holds a ${m2(s)} player option for ${App.sn(j)}. He'll pick it up (${App.pct(Mo.playerOptionOdds(p, j, W).pIn)}) unless you give him a reason not to: decline it, then re-sign with Boston on his Bird rights for more total money spread over more years.</p>
      <div class="row">
        <label class="f">Years<select data-on="ooYears" autofocus>${[2, 3, 4].map(y => `<option${y === years ? " selected" : ""}>${y}</option>`).join("")}</select></label>
        <label class="f">Total ($M)<input type="number" min="10" max="200" step="1" value="${st.total}" data-on="ooTotal" data-live></label>
        <label class="f">Shape<select data-on="ooShape"><option value="up"${st.shape === "up" ? " selected" : ""}>Rising 8% (lowest first year)</option><option value="flat"${st.shape === "flat" ? " selected" : ""}>Flat</option><option value="down"${st.shape === "down" ? " selected" : ""}>Falling 8%</option></select></label>
      </div>
      <p class="small">${sal.map((x, k) => `${App.sn(j + k)} ${m2(x)}`).join(", ")}</p>
      <p><span class="verdict ${odds.odds >= 0.6 ? "good" : odds.odds >= 0.35 ? "warnc" : "bad"}">${App.pct(odds.odds)}</span> he says yes.</p>
      <p class="small muted">He weighs ${m(total)} guaranteed against ${m(s)} next season plus what he expects on the open market after that: about ${m(odds.alt - s)} more, given his age and the chance he stops playing. Players over 33 put a premium on guaranteed money.${o38.applies ? ` <b class="bad">Over-38 rule:</b> a four-year deal treats ${o38.zero} season${o38.zero > 1 ? "s" : ""} after he turns 38 as deferred pay, spread over the earlier years for cap purposes.` : " Three years or fewer stays clear of the over-38 rule."}</p>
      <table class="std"><thead><tr><th scope="col">Season</th><th scope="col">Payroll now</th><th scope="col">With this deal</th><th scope="col">Tax bill</th></tr></thead><tbody>${fx}</tbody></table>
      <div class="row" style="margin-top:12px"><button class="btn" type="button" data-act="ooPlan">Put it in my plan</button><button class="btn ghost" type="button" data-act="close">Cancel</button></div>
      <p class="small muted">In GM mode this becomes a real offer on June 29, ${2027 + j - 1}; he says yes or no with the odds shown then.</p>`;
    App.dlg(`${p.n}: opt out and re-sign`, html);
  }
  App.acts.ooYears = el => { App.ui.oo.years = +el.value; renderOptOut(); };
  App.acts.ooTotal = el => { const v = +el.value; if (v > 0) { App.ui.oo.total = v; const pos = el.selectionStart; renderOptOut(); const n = App.$("#dlg-body input[type=number]"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { } } } };
  App.acts.ooShape = el => { App.ui.oo.shape = el.value; renderOptOut(); };
  App.acts.ooPlan = () => {
    const W = App.W, st = App.ui.oo, p = W.P[st.id];
    const sal = CBA.buildSalaries(st.years, st.total * 1e6, st.shape, 0.08);
    W.plan.opt[p.id + "@" + st.j] = "out";
    W.plan.resign[p.id] = { start: st.j, sal, label: "Opt-out and re-sign", optKey: p.id + "@" + st.j, odds: Mo.optOutDealOdds(p, st.j, st.years, st.total * 1e6, W).odds };
    App.closeDlg(); App.afterChange();
  };
})();
