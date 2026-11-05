/* Fantasy Kit: the entry room, for the two games with no live draft room. A salary cap game (D.cap): build one
   lineup under the budget, any player on any number of teams. A sealed draft (D.sealed): rank players in private,
   and the draft runs itself from everyone's list when it closes. Entries stay on the server (fk_seal_set) and only
   you see yours until the lock; everyone sees who's in (D.entered).

   FK.ui.entryRoom(opts)
     opts: el, sport, players, draft(), me(), now(), brand, exit { href, label }, tools() (buttons html),
           load() -> Promise<{ mine }>, save(entry) -> Promise<{ ok } | { error }>
     returns { render, refresh, stop }
*/
(function () {
  "use strict";
  const { sports: S, draft: F, ui: U } = window.FK;
  const { esc, $ } = U;
  const fm = (x) => (Math.round(x * 10) / 10).toFixed(1);
  const wk = (p) => (p ? (p.v || 0) / 17 : 0);

  function entryRoom(opts) {
    const { el, sport } = opts;
    const D = () => opts.draft(), me = () => (opts.me ? opts.me() : null), now = () => (opts.now ? opts.now() : Date.now());
    const cap = () => !!D().cap;
    const ui = { q: "", pos: "", sort: cap() ? "price" : "rank", right: false, entry: null, saved: null, loaded: false, busy: false, why: "" };
    let ctx = null, timer = null;
    const refreshCtx = () => { ctx = F.context(D(), opts.players, sport); };
    refreshCtx();
    const due = () => (cap() ? D().cap.due : D().sealed.due);
    const locked = () => now() >= due();
    const lu = () => D().lineup;
    const price = (p, slot) => F.capCost(D(), p, slot);
    const pool = () => ctx.players.filter((p) => (cap() ? F.capPrice(D(), p) != null : lu().some((sl) => S.fits(sport, p, sl))));
    const blank = () => (cap() ? Array(lu().length).fill(null) : []);
    const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
    const dirty = () => ui.loaded && !same(ui.entry, ui.saved);

    // what you have: from the server, once
    ui.entry = blank();
    if (me() != null && opts.load) opts.load().then((r) => {
      const m = r && Array.isArray(r.mine) ? r.mine.filter((pid) => pid == null || ctx.byId[pid]) : null;
      ui.entry = m && (!cap() || m.length === lu().length) ? m : blank(); ui.saved = m ? ui.entry.slice() : null; ui.loaded = true; render();
    }, () => { ui.entry = blank(); ui.loaded = true; render(); });
    else { ui.entry = blank(); ui.loaded = true; }

    /* ---------- the lineup (salary cap) ---------- */
    const spent = () => ui.entry.reduce((a, pid, i) => a + (pid ? price(ctx.byId[pid], lu()[i]) || 0 : 0), 0);
    const left = () => D().cap.budget - spent();
    const minPrice = () => Math.min(...pool().map((p) => F.capPrice(D(), p)));
    const inLineup = (pid) => ui.entry.indexOf(pid);
    // the spot a player goes in: the narrowest open one he fits (a WR fills WR before FLEX), the captain only by asking
    function spotFor(p, wantCpt) {
      const ks = lu().map((sl, i) => i).filter((i) => !ui.entry[i] && S.fits(sport, p, lu()[i]) && (lu()[i] === "CPT") === !!wantCpt);
      const width = (sl) => (sport.slots[sl] === "*" ? 99 : sport.slots[sl].length);
      return ks.sort((a, b) => width(lu()[a]) - width(lu()[b]))[0];
    }
    function canAdd(p, wantCpt) {
      if (inLineup(p.id) >= 0) return { ok: false };
      const i = spotFor(p, wantCpt);
      if (i == null) return { ok: false, why: wantCpt ? "Captain's filled" : "No open spot" };
      const after = ui.entry.filter((x) => !x).length - 1, c = price(p, lu()[i]);
      if (c > left() - after * minPrice()) return { ok: false, why: `$${c}`, broke: true, i };
      return { ok: true, i, c };
    }
    const proj = () => ui.entry.reduce((a, pid, i) => a + (pid ? wk(ctx.byId[pid]) * (lu()[i] === "CPT" ? 1.5 : 1) : 0), 0);

    /* ---------- the list (sealed draft) ---------- */
    const want = () => D().rounds * 2;
    // the draft's own rankings: value over a replacement player, so a quarterback isn't ranked on raw points
    const worth = (p) => (p.vor != null ? p.vor : p.v || 0);
    const rankOf = (pid) => ui.entry.indexOf(pid);

    function check() {
      if (!cap()) return ui.entry.length ? { ok: true } : { ok: false, why: "Add players to your list" };
      return F.capCheck(D(), ctx, ui.entry);
    }

    /* ---------- the view ---------- */
    const gameOf = (t) => {
      const g = ((D().season && D().season.slate && D().season.slate.games) || []).find((x) => x.away === t || x.home === t);
      return g ? (g.away === t ? `@ ${g.home}` : `vs ${g.away}`) : "";
    };
    function top() {
      const d = D(), brand = opts.brand || {}, lk = locked();
      const what = cap() ? `Salary cap, $${d.cap.budget}${d.cap.bonus ? `, unique picks ${d.cap.bonus}x` : ""}` : `Sealed draft, ${d.rounds} rounds`;
      const lg = `<a class="lg" href="${esc((opts.exit && opts.exit.href) || "#")}">${brand.mark || ""}<span><b>${esc(d.name || "Draft")}</b><small>${esc(what)}, ${d.teams.length} teams</small></span></a>`;
      const when = new Date(due()).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
      const mid = `<div class="otc${lk ? "" : " en-due"}"><span class="ring" style="--p:1"><span id="fk-lockin">${lk ? "0:00" : esc(U.startIn ? U.startIn(due()) : "")}</span></span><span class="who"><small>${lk ? "Locked" : cap() ? "Lineups lock" : "Lists lock"}</small><b>${lk ? (cap() ? "Revealing the lineups" : "Running the draft") : esc(when)}</b><span>${lk ? "One moment…" : cap() ? "At the first kickoff. Change yours until then." : "Then the draft runs itself from everyone's list."}</span></span></div>`;
      const sec = (opts.tools ? opts.tools() : "") + (opts.exit ? `<a class="btn sm" href="${esc(opts.exit.href)}">${esc(opts.exit.label || "Exit")}</a>` : "");
      return `<div class="dr-top">${lg}${mid}<div class="acts">${sec}</div></div>`;
    }
    function filters() {
      const slots = [...new Set(lu())].filter((sl) => sport.slots[sl] !== "*" && sport.slots[sl].length === 1).map((sl) => sport.slots[sl][0]);
      const ps = [["", "All"]].concat(sport.positions.filter((x) => slots.includes(x) || lu().some((sl) => sport.slots[sl] === "*" || sport.slots[sl].includes(x))).filter((x) => pool().some((p) => S.positions(p).includes(x))).map((x) => [x, x]));
      const sorts = cap() ? [["price", "Price"], ["v", "Projection"], ["value", "Points a dollar"]] : [["rank", "Rankings"], ["v", "Projection"], ["mine", "Your list first"]];
      return `<div class="dr-bar"><label class="sr" for="fk-q">Search players</label><input type="search" id="fk-q" placeholder="Search players or a team" value="${esc(ui.q)}" autocomplete="off" style="flex:1;min-width:150px">
        <div class="chips" role="group" aria-label="Sort">${sorts.map(([k, l]) => `<button type="button" data-esort="${k}" aria-pressed="${ui.sort === k}">${esc(l)}</button>`).join("")}</div></div>
        <div class="chips" role="group" aria-label="Positions">${ps.map(([v, l]) => `<button type="button" data-epos="${esc(v)}" aria-pressed="${v === ui.pos}">${esc(l)}</button>`).join("")}</div>`;
    }
    function rows() {
      const q = ui.q.trim().toLowerCase();
      let list = pool().filter((p) => (!ui.pos || S.positions(p).includes(ui.pos)) && (!q || p.n.toLowerCase().includes(q) || String(p.t).toLowerCase() === q));
      const pr = (p) => F.capPrice(D(), p) || 0;
      const key = { price: (p) => -pr(p) * 1000 - wk(p), v: (p) => -wk(p), value: (p) => -wk(p) / Math.max(1, pr(p)), rank: (p) => -worth(p), mine: (p) => (rankOf(p.id) >= 0 ? rankOf(p.id) - 1e6 : -worth(p)) }[ui.sort];
      list = list.slice().sort((a, b) => key(a) - key(b)).slice(0, 150);
      const sd = lu()[0] === "CPT";
      const body = list.map((p) => {
        const pos = S.positions(p).map((x) => U.posChip(sport, x)).join("");
        let act;
        if (cap()) {
          const on = inLineup(p.id) >= 0, a = canAdd(p), c = sd ? canAdd(p, true) : null;
          act = on ? `<button type="button" class="btn sm ghost" data-eout="${esc(p.id)}" aria-label="Take ${esc(p.n)} out">Remove</button>`
            : `${sd ? `<button type="button" class="btn sm${c.ok ? "" : " ghost"}" data-ein="${esc(p.id)}" data-cpt="1"${c.ok && !locked() ? "" : " disabled"} title="Captain: 1.5x points for 1.5x the price">CPT $${price(p, "CPT")}</button>` : ""}<button type="button" class="btn sm${a.ok ? " go" : " ghost"}" data-ein="${esc(p.id)}"${a.ok && !locked() ? "" : " disabled"}>${sd ? "Flex" : "Add"}</button>`;
        } else {
          const r = rankOf(p.id);
          act = r >= 0 ? `<button type="button" class="btn sm ghost" data-eout="${esc(p.id)}" aria-label="Take ${esc(p.n)} off your list">#${r + 1} Remove</button>` : `<button type="button" class="btn sm go" data-ein="${esc(p.id)}"${locked() ? " disabled" : ""}>Add</button>`;
        }
        const mine = cap() ? inLineup(p.id) >= 0 : rankOf(p.id) >= 0;
        return `<tr class="${mine ? "me" : ""}"><td class="nm"><span class="row" style="gap:8px;min-width:0">${U.playerAv(sport, p, "sm")}<span style="min-width:0"><b class="ell" style="display:block">${esc(p.n)}${U.injTag(p)}</b><small class="ps">${pos} ${U.proTeam(sport, p.t)} ${esc(gameOf(p.t))}</small></span></span></td>
          <td class="r num">${fm(wk(p))}</td>${cap() ? `<td class="r num"><b>$${pr(p)}</b></td>` : ""}<td class="act r">${act}</td></tr>`;
      }).join("");
      return `<div class="table-wrap"><table class="t dense en-t"><thead><tr><th>Player</th><th class="r" title="Projected points this week">Proj</th>${cap() ? `<th class="r">Price</th>` : ""}<th class="act"></th></tr></thead><tbody>${body || `<tr><td colspan="4" class="ps">No players match.</td></tr>`}</tbody></table></div>`;
    }
    function whoIn() {
      const d = D(), en = d.entered || {};
      return `<div class="en-who"><b>Who's in</b><div class="en-who-l">${d.teams.map((t, i) => {
        const bot = F.isBot(t), inn = en[i] != null;
        return `<span class="${inn ? "in" : ""}">${U.teamAv(t, "sm")}<span><b>${esc(t.name)}</b><small>${inn ? (cap() ? "Lineup set" : "List set") : bot ? (cap() ? "A bot builds one" : "A bot drafts it") : "Not yet"}</small></span></span>`;
      }).join("")}</div></div>`;
    }
    function panel() {
      if (me() == null) return `<div class="bd stack" style="padding:14px"><p style="margin:0"><b>${cap() ? "Managers are building lineups." : "Managers are ranking players."}</b></p><p class="ps" style="margin:0">Entries stay hidden until ${cap() ? "the lock" : "the draft runs"}.</p></div>${whoIn()}`;
      if (!ui.loaded) return `<p class="ps" style="padding:14px">Loading yours…</p>`;
      const ck = check(), dt = dirty(), saved = ui.saved != null;
      const status = locked() ? "Locked" : dt ? (saved ? "Changes not saved" : "Not saved yet") : saved ? (cap() ? "Lineup saved" : "List saved") : "";
      const saveBtn = `<button type="button" class="btn go" data-esave${!ck.ok || !dt || ui.busy || locked() ? " disabled" : ""}>${ui.busy ? "Saving…" : cap() ? "Save lineup" : "Save list"}</button>`;
      if (cap()) {
        const b = D().cap.budget, s = spent(), open = ui.entry.filter((x) => !x).length;
        const meter = `<div class="en-bud"><div class="en-bud-n"><b class="num">$${left()}</b><span class="ps">left of $${b}${open ? `, $${open ? Math.floor(left() / open) : 0} a spot for ${open} more` : ""}</span></div><div class="en-bar" role="meter" aria-valuemin="0" aria-valuemax="${b}" aria-valuenow="${s}" aria-label="Budget spent"><i style="width:${Math.min(100, (s / b) * 100)}%"${s > b ? ' class="over"' : ""}></i></div><span class="ps">Projected ${fm(proj())} points</span></div>`;
        const slots = lu().map((sl, i) => {
          const p = ui.entry[i] && ctx.byId[ui.entry[i]];
          return `<li class="${p ? "" : "open"}"><span class="pp">${esc(sl)}</span>${p ? `<span style="min-width:0"><b class="ell" style="display:block">${esc(p.n)}</b><small class="ps">${S.positions(p).join("/")} ${esc(p.t)} ${esc(gameOf(p.t))}, ${fm(wk(p) * (sl === "CPT" ? 1.5 : 1))} pts</small></span><span class="row" style="gap:6px"><b class="num">$${price(p, sl)}</b>${locked() ? "" : `<button type="button" class="btn sm ghost" data-eout="${esc(p.id)}" aria-label="Take ${esc(p.n)} out">✕</button>`}</span>`
            : `<button type="button" class="en-pick ps" data-eslot="${esc(sl)}">${esc(sl === "CPT" ? "Captain: 1.5x points, 1.5x price" : sl === "UTIL" ? "Any player" : U.slotDesc(sport, sl))}</button><span></span>`}</li>`;
        }).join("");
        return `<div class="dr-panel"><div class="mod-h"><h3>Your lineup</h3>${status ? `<span class="ps">${esc(status)}</span>` : ""}</div>${meter}<ul class="rslots">${slots}</ul>
          <div class="en-save">${saveBtn}${!ck.ok && ui.entry.some(Boolean) ? `<span class="ps">${esc(ck.why)}.</span>` : ""}</div>
          <p class="ps en-note">${D().cap.bonus ? `A player nobody else picks scores ${D().cap.bonus}x for you. ` : ""}Anyone can pick the same players. If you don't save one, a bot builds your lineup.</p>${whoIn()}</div>`;
      }
      const list = ui.entry.map((pid, i) => { const p = ctx.byId[pid]; return `<li><span class="no num">${i + 1}</span><span style="min-width:0"><b class="ell" style="display:block">${esc(p.n)}</b><small class="ps">${S.positions(p).join("/")} ${esc(p.t)}, ${fm(wk(p))} pts</small></span><span class="row" style="gap:4px">${locked() ? "" : `<button type="button" class="btn sm ghost" data-eup="${i}" aria-label="Move ${esc(p.n)} up"${i ? "" : " disabled"}>↑</button><button type="button" class="btn sm ghost" data-edown="${i}" aria-label="Move ${esc(p.n)} down"${i < ui.entry.length - 1 ? "" : " disabled"}>↓</button><button type="button" class="btn sm ghost" data-eout="${esc(pid)}" aria-label="Take ${esc(p.n)} off">✕</button>`}</span></li>`; }).join("");
      return `<div class="dr-panel"><div class="mod-h"><h3>Your list</h3><span class="ps">${ui.entry.length} player${ui.entry.length === 1 ? "" : "s"}${status ? `, ${esc(status.toLowerCase())}` : ""}</span></div>
        <p class="ps en-note" style="margin-top:0">Your pick is always the highest player on your list who's left and fits your roster. Rank at least ${want()}: if your list runs out, you get the best player left.</p>
        ${ui.entry.length ? `<ol class="picks en-list">${list}</ol>` : `<p class="ps en-note">Add players from the list. Start from the rankings and move players up and down.</p>`}
        <div class="en-save">${saveBtn}${locked() ? "" : `<button type="button" class="btn ghost" data-efill${ui.entry.length >= want() ? " disabled" : ""}>Fill to ${want()} from the rankings</button>`}</div>${whoIn()}</div>`;
    }
    function render() {
      if (!el.isConnected) return;
      const fid = document.activeElement && document.activeElement.id === "fk-q", ss = fid ? document.activeElement.selectionStart : null;
      const scroll = el.querySelector(".table-wrap") ? el.querySelector(".table-wrap").scrollTop : 0, pscroll = el.querySelector(".dr-panel") ? el.querySelector(".dr-panel").scrollTop : 0;
      const n = cap() ? ui.entry ? ui.entry.filter(Boolean).length : 0 : ui.entry ? ui.entry.length : 0;
      const tabs = `<div class="seg show-m en-tabs" role="group" aria-label="View"><button type="button" data-eview="players" aria-pressed="${!ui.right}">Players</button><button type="button" data-eview="mine" aria-pressed="${ui.right}">${cap() ? `Your lineup ${n}/${lu().length}${ui.entry ? `, $${left()}` : ""}` : `Your list (${n})`}</button></div>`;
      el.innerHTML = `<div class="droom fk-dark en">${top()}<div class="dr-main${ui.right ? " right" : ""}">
        <section class="dr-left">${tabs}${filters()}${rows()}</section>
        <aside class="dr-right">${me() != null ? `<div class="show-m" style="padding:10px 12px 0">${tabs}</div>` : ""}${panel()}</aside></div></div>`;
      const tw = el.querySelector(".table-wrap"); if (tw) tw.scrollTop = scroll;
      const dp = el.querySelector(".dr-panel"); if (dp) dp.scrollTop = pscroll;
      if (fid) { const q = $("#fk-q"); q.focus(); try { q.setSelectionRange(ss, ss); } catch (e) { /* not a text input */ } }
    }
    function add(pid, cpt) {
      const p = ctx.byId[pid]; if (!p || locked()) return;
      if (cap()) { const a = canAdd(p, cpt); if (!a.ok) { if (a.broke) U.toast(`${p.n} costs $${price(p, lu()[a.i])}. You have $${left()} for ${ui.entry.filter((x) => !x).length} spots.`, true); return; } ui.entry[a.i] = pid; if (!ui.entry.some((x) => !x)) ui.right = true; }
      else if (rankOf(pid) < 0) ui.entry.push(pid);
      render();
    }
    function out(pid) { if (locked()) return; if (cap()) { const i = inLineup(pid); if (i >= 0) ui.entry[i] = null; } else ui.entry = ui.entry.filter((x) => x !== pid); render(); }
    async function save() {
      const ck = check(); if (!ck.ok || ui.busy || locked()) return;
      ui.busy = true; render();
      const r = await opts.save(ui.entry.slice()).catch((e) => ({ error: e.message }));
      ui.busy = false;
      if (r && r.ok) { ui.saved = ui.entry.slice(); U.toast(cap() ? "Lineup saved. Change it any time before the lock." : "List saved. Change it any time before the lock."); }
      else U.toast((r && r.error) || "Couldn't save that.", true);
      render();
    }
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button,[data-eslot]"); if (!b || !el.contains(b)) return;
      if (b.dataset.ein) add(b.dataset.ein, !!b.dataset.cpt);
      else if (b.dataset.eout) out(b.dataset.eout);
      else if (b.dataset.esort) { ui.sort = b.dataset.esort; render(); }
      else if (b.dataset.epos != null) { ui.pos = b.dataset.epos; render(); }
      else if (b.dataset.eslot) { const v = sport.slots[b.dataset.eslot]; ui.pos = v !== "*" && v.length === 1 ? v[0] : ""; ui.right = false; render(); }
      else if (b.dataset.eview) { ui.right = b.dataset.eview === "mine"; render(); }
      else if (b.hasAttribute("data-esave")) save();
      else if (b.dataset.eup != null || b.dataset.edown != null) {
        const i = +(b.dataset.eup != null ? b.dataset.eup : b.dataset.edown), j = b.dataset.eup != null ? i - 1 : i + 1;
        if (j >= 0 && j < ui.entry.length) { [ui.entry[i], ui.entry[j]] = [ui.entry[j], ui.entry[i]]; render(); }
      } else if (b.hasAttribute("data-efill")) {
        const have = new Set(ui.entry);
        for (const p of pool().slice().sort((a, c) => worth(c) - worth(a))) { if (ui.entry.length >= want()) break; if (!have.has(p.id)) ui.entry.push(p.id); }
        render();
      }
    });
    el.addEventListener("input", (e) => { if (e.target.id === "fk-q") { ui.q = e.target.value; render(); } });
    const onLeave = (e) => { if (dirty() && !locked()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", onLeave);
    document.body.classList.add("fk-room");
    timer = setInterval(() => {
      const t = $("#fk-lockin");
      if (t && !locked() && U.startIn) t.textContent = U.startIn(due());
      else if (locked() && el.querySelector(".otc.en-due")) render();
    }, 1000);
    render();
    return { render, refresh: () => { refreshCtx(); render(); }, stop: () => { clearInterval(timer); window.removeEventListener("beforeunload", onLeave); document.body.classList.remove("fk-room"); }, ui };
  }
  U.entryRoom = entryRoom;
})();
