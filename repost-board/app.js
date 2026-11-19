/* Repost Board: daily over/unders on what a friend reposts. Everything lives in Supabase (tools/repost_board_supabase.sql):
   rb_board returns the counts, lines, your picks, the standings and the top accounts in one call; rb_pick saves a pick
   until the slate locks at noon New York time; rb_join takes the board's code once. The site's account
   (assets/account.js, loaded by navigation.js) signs people in. The board is private: signed out or not yet joined,
   the page shows a gate and no data. Counts and lines are written by a daily pull, not by this page. */
(function () {
  "use strict";
  const MARKETS = [
    { k: "total", label: "Total reposts", color: "var(--chalk)" },
    { k: "celtics", label: "Celtics", color: "var(--t-celtics)" },
    { k: "habs", label: "Canadiens", color: "var(--t-habs)" },
    { k: "sports", label: "Other sports", color: "var(--t-sports)" },
    { k: "uspol", label: "US politics", color: "var(--t-uspol)" },
    { k: "mideast", label: "Middle East", color: "var(--t-mideast)" }
  ];
  const STACK = MARKETS.slice(1).concat([{ k: "other", label: "Everything else", color: "var(--t-other)" }]);
  const VIEWS = ["slate", "standings", "results", "trends"];
  const NS = "http://www.w3.org/2000/svg";
  const S = { days: {}, lines: {}, mine: {}, rows: [], meta: null, tab: null, loaded: false, skew: 0 };
  const params = new URLSearchParams(location.search);
  let A = null, C = null, joinCode = (params.get("join") || "").trim().toUpperCase(), busy = 0;
  const $ = (id) => document.getElementById(id);

  /* ---------- time: everything is counted in New York days ---------- */
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const now = () => Date.now() + S.skew;
  function et(ms) { const p = {}; fmt.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; }); return { d: p.year + "-" + p.month + "-" + p.day, h: +p.hour }; }
  function addDays(d, n) { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function lockMs(date) { const g = Date.parse(date + "T17:00:00Z"); return g + (12 - et(g).h) * 3600000; }
  const locked = (date) => now() >= lockMs(date);
  function nice(d, long) { return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", long ? { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" } : { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); }

  /* ---------- small DOM helpers (text only, never innerHTML with data) ---------- */
  function el(tag, props, kids) {
    const e = document.createElement(tag);
    if (props) for (const k in props) { if (k === "class") e.className = props[k]; else if (k === "text") e.textContent = props[k]; else e.setAttribute(k, props[k]); }
    (kids || []).forEach((c) => e.appendChild(c));
    return e;
  }
  function sv(n, a) { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; }
  function banner(t) { const b = $("banner"); b.textContent = t || ""; b.hidden = !t; }
  const signedIn = () => !!(A && A.me());
  function rpc(fn, args) {
    return (C ? Promise.resolve(C) : A.cloud().then((c) => { C = c; return c; })).then((c) => c.rpc(fn, args || {}));
  }

  const finalDays = () => Object.keys(S.days).filter((d) => S.days[d].final).sort();
  const pickOf = (date, k) => (S.mine[date] && S.mine[date][k]) || null;
  function outcome(date, k) { const d = S.days[date], l = S.lines[date]; if (!d || !d.final || !l || l[k] == null) return null; return (d[k] || 0) > l[k] ? "o" : "u"; }

  /* ---------- the gate: sign in, then the board's code once ---------- */
  function gate(kind) {
    const g = $("gate"); g.textContent = ""; g.hidden = false; $("board").hidden = true; $("seg").textContent = ""; $("asof").textContent = "";
    if (kind === "signin") {
      const b = el("button", { type: "button", class: "btn", id: "rb-signin", text: "Sign in" });
      b.addEventListener("click", () => A.openSignIn("signin"));
      g.appendChild(el("h2", { text: "Members only" }));
      g.appendChild(el("p", { text: "This board is private. Sign in with your site account to see it." + (joinCode ? " Your invite is saved and will be used once you're in." : "") }));
      g.appendChild(b);
    } else {
      const input = el("input", { id: "rb-code", name: "code", autocomplete: "off", maxlength: "12", "aria-label": "Invite code", placeholder: "Invite code" });
      const form = el("form", { id: "rb-join" }, [input, el("button", { type: "submit", class: "btn", text: "Join" })]);
      form.addEventListener("submit", (e) => { e.preventDefault(); join(input.value); });
      g.appendChild(el("h2", { text: "One more step" }));
      g.appendChild(el("p", { text: "You're signed in. Enter the invite code Dave sent to join the board." }));
      g.appendChild(form);
    }
  }
  function join(code) {
    code = String(code || "").trim().toUpperCase();
    if (!code) return Promise.resolve();
    return rpc("rb_join", { p_code: code }).then((r) => {
      if (!r || r.error) throw new Error((r && r.error) || "Couldn't join.");
      if (joinCode) { joinCode = ""; history.replaceState(null, "", location.pathname + location.hash); }
      banner(""); return load();
    }).catch((e) => { banner(e.message); });
  }

  /* ---------- load ---------- */
  function load() {
    if (!signedIn()) { S.loaded = false; gate("signin"); return Promise.resolve(); }
    return rpc("rb_board").then((b) => {
      if (b && b.error === "signin") { gate("signin"); return; }
      if (b && b.error === "join") { if (joinCode) { const c = joinCode; joinCode = ""; history.replaceState(null, "", location.pathname + location.hash); return join(c).then(() => { if (!S.loaded) gate("join"); }); } gate("join"); return; }
      if (!b || !b.ok) throw new Error((b && b.error) || "Couldn't load the board.");
      S.days = b.days || {}; S.lines = b.lines || {}; S.rows = b.standings || []; S.meta = b.sources || null;
      if (!busy) S.mine = b.picks || {};
      if (b.now) S.skew = Date.parse(b.now) - Date.now();
      S.loaded = true; $("gate").hidden = true; $("board").hidden = false; banner("");
      render();
    }).catch((e) => { banner((e && e.message) || "Couldn't load the board. Check your connection and reload."); });
  }

  /* ---------- views ---------- */
  function route() {
    const h = (location.hash || "").slice(1), v = VIEWS.indexOf(h) > -1 ? h : "slate";
    VIEWS.forEach((x) => { $("v-" + x).hidden = x !== v; });
    document.querySelectorAll("#tabs a").forEach((a) => { if (a.getAttribute("href") === "#" + v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  }
  function render() { renderScore(); renderSlate(); renderBoard(); renderResults(); renderChart(); renderSources(); }

  function renderScore() {
    const today = et(now()).d, fd = finalDays(), t = S.days[today];
    $("t-today").textContent = t ? t.total : "-";
    $("t-today-d").textContent = t && t.as_of ? "as of " + new Date(t.as_of).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET" : "updates at the next pull";
    const avg = (n) => { const a = fd.slice(-n); return a.length ? (a.reduce((s, d) => s + S.days[d].total, 0) / a.length).toFixed(1) : "-"; };
    $("t-7").textContent = avg(7); $("t-30").textContent = avg(30);
    let mx = null; fd.forEach((d) => { if (!mx || S.days[d].total > S.days[mx].total) mx = d; });
    $("t-max").textContent = mx ? S.days[mx].total : "-"; $("t-max-d").textContent = mx ? nice(mx) : "";
    const all = Object.keys(S.days).map((d) => S.days[d].as_of).filter(Boolean).sort();
    $("asof").textContent = all.length ? "Last pull " + new Date(all[all.length - 1]).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET" : "";
  }

  function clock(date) { const ms = lockMs(date) - now(); if (ms <= 0) return ""; const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000); return "Locks in " + (h ? h + "h " : "") + m + "m"; }
  function spark(vals, line, color) {
    const W = 140, H = 44, top = Math.max(Math.max.apply(null, vals.concat([0])), line * 1.6, 1), bw = W / Math.max(vals.length, 1);
    const s = sv("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", "aria-hidden": "true" });
    vals.forEach((v, i) => { const h = Math.max((v / top) * (H - 4), 1.5), r = sv("rect", { x: i * bw + 1, y: H - h, width: Math.max(bw - 2, 1), height: h, rx: 1 }); r.style.fill = v > line ? color : "var(--line-strong)"; s.appendChild(r); });
    const y = H - (line / top) * (H - 4), l = sv("line", { x1: 0, x2: W, y1: y, y2: y, "stroke-dasharray": "3 3", "stroke-width": 1 }); l.style.stroke = "var(--chalk)"; s.appendChild(l);
    return s;
  }
  function renderSlate() {
    if (!S.loaded) return;
    const today = et(now()).d, dates = [today, addDays(today, 1)];
    if (!S.tab || dates.indexOf(S.tab) < 0) S.tab = locked(dates[0]) ? dates[1] : dates[0];
    const seg = $("seg"); seg.textContent = "";
    dates.forEach((d, i) => {
      const b = el("button", { type: "button", "aria-pressed": String(S.tab === d), id: "seg-" + i }, [document.createTextNode(i ? "Tomorrow" : "Today"), el("small", { text: locked(d) ? "Locked" : "Open" })]);
      b.addEventListener("click", () => { S.tab = d; renderSlate(); }); seg.appendChild(b);
    });
    const date = S.tab, isLocked = locked(date), lines = S.lines[date], live = S.days[date];
    $("slate-title").textContent = nice(date, true) + " slate";
    const st = $("slate-status"); st.className = "chip " + (isLocked ? "lock" : "open"); st.textContent = isLocked ? "Locked" : "Open";
    const box = $("markets"); box.textContent = "";
    const list = $("slip-list"); list.textContent = "";
    if (!lines) {
      box.appendChild(el("div", { class: "card" }, [el("p", { class: "note", text: "Lines for this day post after the next morning pull." })]));
      $("slip-count").textContent = ""; $("slip-foot").textContent = ""; $("slip-clock").textContent = ""; renderMini(); return;
    }
    const fd = finalDays().filter((d) => d < date).slice(-14); let made = 0, ahead = 0;
    MARKETS.forEach((m) => {
      if (lines[m.k] == null) return;
      const line = Number(lines[m.k]), vals = fd.map((d) => S.days[d][m.k] || 0), overs = vals.filter((v) => v > line).length, n = vals.length || 1;
      const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : "-", hi = vals.length ? Math.max.apply(null, vals) : "-";
      const mine = pickOf(date, m.k); if (mine) made++;
      const stripe = el("div", { class: "stripe" }); stripe.style.background = m.color;
      const info = el("div", { class: "info" }, [el("div", { class: "name", text: m.label }), el("div", { class: "meta", text: "14-day avg " + avg + " · high " + hi })]);
      if (isLocked && live && !live.final) info.appendChild(el("div", { class: "live", text: "Live " + (live[m.k] || 0) }));
      const sp = el("div", { class: "spark" }, [spark(vals, line, m.color), el("div", { class: "cap", text: "Last " + vals.length + " days" })]);
      const mk = (side, label, pct) => {
        const b = el("button", { type: "button", class: "bet", "aria-pressed": String(mine === side), id: "pk-" + m.k + "-" + side, "aria-label": label + " " + line.toFixed(1) + " " + m.label },
          [el("span", { class: "side", text: label }), el("span", { class: "num", text: line.toFixed(1) }), el("span", { class: "hit", text: "hit " + Math.round(pct * 100) + "%" })]);
        b.disabled = isLocked; b.addEventListener("click", () => setPick(date, m.k, mine === side ? null : side)); return b;
      };
      box.appendChild(el("div", { class: "mkt" }, [stripe, info, sp, el("div", { class: "bets" }, [mk("o", "Over", overs / n), mk("u", "Under", (vals.length - overs) / n)])]));
      const right = el("span", { class: mine ? "pick" : "pick none", text: mine ? (mine === "o" ? "Over " : "Under ") + line.toFixed(1) : "No pick" });
      if (mine && isLocked && live && !live.final) { const cur = (live[m.k] || 0) > line ? "o" : "u"; if (mine === cur) ahead++; right.appendChild(el("span", { class: mine === cur ? "w" : "l", text: mine === cur ? "  on track" : "  behind" })); }
      list.appendChild(el("li", null, [el("span", { text: m.label }), right]));
    });
    $("slip-count").textContent = made + " of " + MARKETS.length + " picked";
    $("slip-foot").textContent = isLocked ? (made ? ahead + " of " + made + " on track" : "No picks on this slate") : busy ? "Saving…" : made ? "Saved. Change any pick until noon ET." : "Saves as you tap";
    $("slip-clock").textContent = isLocked ? "Settles tomorrow morning" : clock(date);
    renderMini();
  }

  function setPick(date, k, side) {
    if (locked(date)) return;
    const was = pickOf(date, k);
    S.mine[date] = Object.assign({}, S.mine[date]); if (side) S.mine[date][k] = side; else delete S.mine[date][k];
    busy++; renderSlate();
    rpc("rb_pick", { p_day: date, p_market: k, p_side: side }).then((r) => {
      if (!r || r.error) throw new Error((r && r.error) || "Couldn't save that pick.");
      banner("");
    }).catch((e) => {
      S.mine[date] = Object.assign({}, S.mine[date]); if (was) S.mine[date][k] = was; else delete S.mine[date][k];
      banner(e.message + " Your pick was put back.");
    }).then(() => { busy--; renderSlate(); });
  }

  function streakOf(recent) { if (!recent.length) return "-"; let c = 0; for (let i = 0; i < recent.length && recent[i] === recent[0]; i++) c++; return (recent[0] ? "W" : "L") + c; }
  function nameCell(r, tag, cls) { const td = el(tag, cls ? { class: cls } : null, [el("span", { text: r.name || "Player" })]); if (r.me) td.appendChild(el("span", { class: "you", text: "YOU" })); return td; }
  function renderMini() {
    const ol = $("mini"); ol.textContent = "";
    if (!S.rows.length) { ol.appendChild(el("li", null, [el("span", { class: "note", text: "No picks yet. Be first on the board." })])); return; }
    S.rows.slice(0, 5).forEach((r, i) => ol.appendChild(el("li", null, [el("span", { class: "rk", text: String(i + 1) }), nameCell(r, "span"), el("span", { class: "rec", text: r.w + "-" + r.l })])));
  }
  function renderBoard() {
    const tb = $("lb").tBodies[0]; tb.textContent = "";
    S.rows.forEach((r, i) => {
      const n = r.w + r.l, recent = r.recent || [], streak = streakOf(recent), form = el("span", { class: "form" });
      recent.slice(0, 5).reverse().forEach((f) => form.appendChild(el("i", { class: f ? "fw" : "fl", text: f ? "W" : "L" })));
      tb.appendChild(el("tr", null, [el("td", { class: "rank", text: String(i + 1) }), nameCell(r, "td", "player"), el("td", { text: String(r.w) }), el("td", { text: String(r.l) }),
        el("td", { text: n ? (r.w / n).toFixed(3).replace(/^0/, "") : "-" }), el("td", { class: streak[0] === "W" ? "w" : streak[0] === "L" ? "l" : "", text: streak }), el("td", null, [form]), el("td", { text: String(r.live) })]));
    });
    if (!S.rows.length) tb.appendChild(el("tr", null, [el("td", { colspan: "8", text: "No picks yet. Make the first ones on the slate." })]));
    $("lb-note").textContent = S.rows.length ? "One point per correct pick. Live is picks waiting on a final count." : "";
    renderMini();
  }

  function renderResults() {
    const dates = finalDays().filter((d) => S.lines[d]).slice(-10).reverse(), t = $("results");
    t.tHead.textContent = ""; t.tBodies[0].textContent = "";
    if (!dates.length) { t.tBodies[0].appendChild(el("tr", null, [el("td", { text: "The first slate settles the morning after it locks." })])); return; }
    t.tHead.appendChild(el("tr", null, [el("th", { text: "Day" })].concat(MARKETS.map((m) => el("th", { text: m.label })))));
    dates.forEach((d) => {
      const tr = el("tr", null, [el("td", { class: "player", text: nice(d) })]);
      MARKETS.forEach((m) => {
        const o = outcome(d, m.k), mine = pickOf(d, m.k), td = el("td");
        if (o == null) td.textContent = "-";
        else {
          const cell = el("span", { class: "res" }, [el("b", { text: String(S.days[d][m.k] || 0) }), el("small", { text: (o === "o" ? "O " : "U ") + Number(S.lines[d][m.k]).toFixed(1) })]);
          if (mine) cell.appendChild(el("small", { class: mine === o ? "w" : "l", text: mine === o ? "Right" : "Wrong" }));
          td.appendChild(cell);
        }
        tr.appendChild(td);
      });
      t.tBodies[0].appendChild(tr);
    });
  }

  function renderChart() {
    const svg = $("chart"); svg.textContent = "";
    const lg = $("legend"); lg.textContent = "";
    STACK.forEach((s) => { const d = el("span", { class: "dot" }); d.style.background = s.color; lg.appendChild(el("span", null, [d, el("span", { text: s.label })])); });
    const dates = Object.keys(S.days).sort().slice(-32); if (!dates.length) return;
    const W = 1000, H = 300, L = 34, R = 6, T = 10, B = 26, max = Math.max.apply(null, dates.map((d) => S.days[d].total).concat([10]));
    const step = max > 80 ? 25 : max > 40 ? 20 : 10, top = Math.ceil(max / step) * step, y = (v) => T + (H - T - B) * (1 - v / top), bw = (W - L - R) / dates.length;
    for (let v = 0; v <= top; v += step) { const g = sv("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), "stroke-width": 1 }); g.style.stroke = "var(--line)"; svg.appendChild(g); const t = sv("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }); t.textContent = v; svg.appendChild(t); }
    dates.forEach((d, i) => {
      const day = S.days[d]; let acc = 0; const g = sv("g", { opacity: day.final ? 1 : 0.5 });
      const tt = document.createElementNS(NS, "title"); tt.textContent = nice(d) + ": " + day.total + " reposts" + (day.final ? "" : " so far") + " (" + STACK.filter((s) => day[s.k]).map((s) => s.label + " " + day[s.k]).join(", ") + ")"; g.appendChild(tt);
      STACK.forEach((s) => { const v = day[s.k] || 0; if (!v) return; const r = sv("rect", { x: L + i * bw + 2, width: Math.max(bw - 4, 2), y: y(acc + v), height: y(acc) - y(acc + v) }); r.style.fill = s.color; g.appendChild(r); acc += v; });
      svg.appendChild(g);
      if (i % 5 === 0) { const t = sv("text", { x: L + i * bw + bw / 2, y: H - 8, "text-anchor": "middle" }); t.textContent = new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); svg.appendChild(t); }
    });
  }

  function renderSources() {
    const ul = $("src"); ul.textContent = ""; const m = S.meta; if (!m || !m.top) return;
    m.top.forEach((s, i) => { const st = STACK.find((x) => x.k === s.c) || STACK[STACK.length - 1]; const d = el("span", { class: "dot" }); d.style.background = st.color; ul.appendChild(el("li", null, [el("span", { class: "rk", text: String(i + 1) }), d, el("span", { text: s.u }), el("span", { class: "n", text: String(s.n) })])); });
    $("src-note").textContent = m.window ? m.window + ", across " + (m.uniq || "many") + " accounts" : "";
  }

  /* ---------- start ---------- */
  window.addEventListener("hashchange", route);
  route();
  // signed in (or out) on this page: start over with the new session
  window.addEventListener("dsolar:auth", () => { C = null; load(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.loaded && !busy) load(); });
  setInterval(() => { if (S.loaded) renderSlate(); }, 60000);
  // the site's account script comes with the navigation
  (function wait(n) {
    A = window.DSAccount;
    if (!A) { if (n < 200) setTimeout(() => wait(n + 1), 50); else banner("The page didn't finish loading. Reload it."); return; }
    load();
  })(0);
})();
