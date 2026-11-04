/* Top 10 Challenge: everyone posts a top-10 mock under a name and a PIN (Supabase, tools/draft_challenge_supabase.sql).
   Scoring by draft slot, not team, so trades don't matter: 3 for the exact player at a slot, 1 for within two picks,
   half a point for anywhere else in the top 10. Each pick is multiplied by how early it was set: 2x on opening day
   (Nov 3, 2026), sliding evenly to 1x at the draft. A pick keeps its time until it changes, so early calls keep
   their bonus and copied ones don't. Before the draft the leaderboard scores everyone against today's consensus. */
(function () {
  "use strict";
  const { $, esc, fmtDay } = BB;
  const API = "https://baxrczyufqbzrogftmyn.supabase.co/rest/v1/rpc/";
  const KEY = "sb_publishable_brDXGevzcoI7mBaPO7Plow_yaUy4gk4";
  const DAY = 864e5, OPEN = Date.parse("2026-11-03T12:00:00Z");   // the challenge opened: a pick set then is worth 2x

  let D = null, C = null;

  async function rpc(fn, body) {
    const res = await fetch(API + fn, { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  const mult = (at, lock) => 1 + Math.max(0, Math.min(1, (lock - new Date(at).getTime()) / (lock - OPEN)));
  const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

  // The order to score against: the real draft once it's in (D.results, player ids by slot), else the consensus.
  function actual() {
    if (Array.isArray(D.results) && D.results.length) return { final: true, order: D.results };
    return { final: false, order: D.players.slice().sort((a, b) => a.rank - b.rank).slice(0, 40).map((p) => p.id) };
  }
  function score(picks, lock) {
    const { order } = actual();
    let pts = 0;
    for (const x of picks || []) {
      if (!x) continue;
      const pos = order.indexOf(idOf(x)) + 1;
      const base = pos === x.slot ? 3 : pos && Math.abs(pos - x.slot) <= 2 ? 1 : pos && pos <= 10 ? 0.5 : 0;
      pts += base * mult(x.at || nowIso(), lock);
    }
    return Math.round(pts * 10) / 10;
  }

  const key = () => "bb-challenge-" + C.lg;
  function saveLocal() { BB.store.set(key(), { picks: C.picks, name: C.name }); }
  function fresh(lg) {
    const saved = BB.store.get("bb-challenge-" + lg) || {};
    return { lg, picks: Array.isArray(saved.picks) && saved.picks.length === 10 ? saved.picks : Array(10).fill(null), name: saved.name || BB.store.get("gtp-name") || "",
      pin: "", active: 0, q: "", pos: "all", server: {}, board: null, msg: "", ok: false, busy: false, open: null };
  }
  // Board ids are name slugs, so a pick saved under an old spelling still finds its player by name.
  const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
  const slug = (n) => String(n || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.'’]/g, "")
    .split(/[^a-z0-9]+/).filter((x) => x && !SUFFIX.has(x)).join("-");
  const player = (pid, n) => D.players.find((p) => p.id === pid) || (n ? D.players.find((p) => p.id === slug(n)) : null);
  const idOf = (x) => { const p = player(x.pid, x.n); return p ? p.id : x.pid; };

  function slotRow(x, i, lock) {
    const p = x && player(x.pid, x.n);
    const sv = C.server[i + 1];
    const kept = x && sv && sv.pid === x.pid;
    const m = x ? mult(kept ? sv.at : nowIso(), lock) : null;
    return `<li class="ch-slot${C.active === i ? " on" : ""}${x ? "" : " empty"}" data-slot="${i}">
      <span class="cn">${i + 1}</span>
      ${x ? `<span class="ct"><b>${esc(x.n)}</b><small>${p ? `${esc([p.pos, p.school].filter(Boolean).join(", "))} &middot; consensus No. ${p.rank}` : "off the board now"}</small></span>
        <span class="cm${kept ? " kept" : ""}" title="${kept ? `Set ${fmtDay(sv.at.slice(0, 10))}` : "If you save now"}">${m.toFixed(2)}x</span>
        <span class="ca"><button type="button" class="ic" data-up="${i}" aria-label="Move up"${i ? "" : " disabled"}>&#9650;</button><button type="button" class="ic" data-down="${i}" aria-label="Move down"${i < 9 ? "" : " disabled"}>&#9660;</button><button type="button" class="ic" data-clear="${i}" aria-label="Remove">&times;</button></span>`
        : `<span class="ct faint">${C.active === i ? "Pick a player" : "Tap to fill"}</span>`}
    </li>`;
  }

  function pool() {
    const q = C.q.trim().toLowerCase(), taken = new Set(C.picks.filter(Boolean).map(idOf));
    const list = D.players.filter((p) => BB.inGroup(D.league, p.pos, C.pos) && (!q || p.n.toLowerCase().includes(q) || (p.school || "").toLowerCase().includes(q))).slice(0, q ? 40 : 60);
    return list.map((p) => `<li><button type="button" class="ch-p${taken.has(p.id) ? " used" : ""}" data-pick="${esc(p.id)}"${taken.has(p.id) ? " disabled" : ""}>
      <span class="rk">${p.rank}</span>${BB.school(p)}<span class="ct"><b>${esc(p.n)}</b><small>${esc([p.pos, p.school].filter(Boolean).join(", "))}</small></span></button></li>`).join("")
      || `<li class="note">No one matches that.</li>`;
  }

  function boardView(lock) {
    const B = C.board;
    if (!B) return `<p class="note">Loading everyone's mocks...</p>`;
    if (B.error) return `<p class="note">${esc(B.error)}</p>`;
    const { final } = actual();
    const rows = (B.entries || []).map((e) => ({ ...e, pts: score(e.picks, lock) })).sort((a, b) => b.pts - a.pts || new Date(a.updated) - new Date(b.updated));
    if (!rows.length) return `<p class="note">No mocks yet. Be the first: an early call is worth double.</p>`;
    const me = C.name.trim().toLowerCase();
    return `<ol class="ch-board">${rows.map((e, k) => {
      const open = C.open === e.name;
      const picks = (e.picks || []).slice().sort((a, b) => a.slot - b.slot);
      return `<li class="${e.name.toLowerCase() === me ? "me" : ""}${open ? " open" : ""}"><button type="button" class="ch-row" data-entry="${esc(e.name)}" aria-expanded="${open}">
        <span class="rn">${k + 1}</span><span class="ct"><b>${esc(e.name)}</b><small>${picks.length}/10 picked &middot; last change ${fmtDay(String(e.updated).slice(0, 10))}</small></span><span class="pts">${e.pts.toFixed(1)}</span></button>
        ${open ? `<ol class="ch-picks">${picks.map((x) => `<li><span class="cn">${x.slot}</span><span>${esc(x.n)}</span><span class="cm">${mult(x.at, lock).toFixed(2)}x</span></li>`).join("")}</ol>` : ""}</li>`;
    }).join("")}</ol>
    <p class="note">${final ? "Final scores from the real draft." : "Scored as if the draft went in consensus order today, multipliers included. The real scores start on draft night."}</p>`;
  }

  function view() {
    const lock = new Date(C.lockAt || (D.league === "nfl" ? "2027-04-30T00:00:00Z" : "2027-06-25T00:00:00Z")).getTime();
    const left = Math.ceil((lock - Date.now()) / DAY), locked = left <= 0;
    const filled = C.picks.filter(Boolean).length;
    $("#challenge-view").innerHTML = `<section class="challenge">
      <div class="setup-head"><h2 class="disp">Top 10 Challenge</h2><p class="sub">Call the top 10 of the ${D.year} ${D.league.toUpperCase()} draft. 3 points for the exact player at a pick, 1 if he goes within two picks of it, half a point if he goes somewhere else in the top 10. Trades don't matter: it's the pick number that counts.</p>
        <p class="sub">Early calls pay: a pick set on opening day (Nov 3) counts double, and the bonus slides evenly to nothing by draft night. A pick keeps its date until you change it, and everyone's picks are public, so copying someone late costs you the bonus.</p>
        <p class="ch-lock">${locked ? "Picks are locked." : `Picks lock ${new Date(lock).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET, ${left} day${left === 1 ? "" : "s"} from now.`}${C.lockNote && /not announced/i.test(C.lockNote) ? " The NBA hasn't set its date yet; this moves when it does." : ""}</p></div>
      <div class="ch-grid">
        <div class="ch-mine">
          <h3>Your top 10</h3>
          <ol class="ch-slots">${C.picks.map((x, i) => slotRow(x, i, lock)).join("")}</ol>
          <form class="ch-save" autocomplete="off">
            <label><span class="lab">Name</span><input id="ch-name" maxlength="24" value="${esc(C.name)}" placeholder="Your name"></label>
            <label><span class="lab">PIN</span><input id="ch-pin" inputmode="numeric" pattern="[0-9]*" maxlength="8" value="${esc(C.pin)}" placeholder="4 to 8 digits"></label>
            <button type="submit" class="btn go"${locked || C.busy ? " disabled" : ""}>${C.server.n ? "Update my mock" : "Save my mock"}</button>
            <button type="button" class="link" data-ch="load"${C.busy ? " disabled" : ""}>Load my saved mock</button>
            <button type="button" class="btn" data-ch="share"${filled ? "" : " disabled"}>Share image</button>
          </form>
          <p class="note">${C.msg ? `<span class="tmsg ${C.ok ? "ok" : ""}">${esc(C.msg)}</span>` : `${filled}/10 picked. The PIN keeps your name yours; it's not a password anywhere else, so don't reuse one.`}</p>
        </div>
        <div class="ch-pool">
          <h3>${C.picks[C.active] ? `Replace pick ${C.active + 1}` : `Pick ${C.active + 1}`}</h3>
          <div class="tools"><label class="sr" for="ch-q">Find a player</label><input id="ch-q" type="search" placeholder="Find a player or school" value="${esc(C.q)}" autocomplete="off">
            <div class="chips">${BB.POS[D.league].map(([k, l]) => `<button type="button" data-chpos="${k}" aria-pressed="${C.pos === k}">${l}</button>`).join("")}</div></div>
          <ul class="ch-list">${pool()}</ul>
        </div>
      </div>
      <h3 class="ch-h">Everyone's mocks</h3>
      ${boardView(lock)}
    </section>`;
  }

  // ---------- share card: a 1080x1350 image of your top 10 ----------
  function loadImg(src) {
    return new Promise((res) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  }
  async function shareCard() {
    const lock = new Date(C.lockAt || 0).getTime();
    const rows = C.picks.map((x, i) => x && { ...x, slot: i + 1, p: player(x.pid, x.n) }).filter(Boolean);
    if (!rows.length) { C.msg = "Pick at least one player first."; C.ok = false; view(); return; }
    const W = 1080, H = 1350, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    try { await document.fonts.load('700 80px "Zilla Slab"'); await document.fonts.load('700 40px "IBM Plex Sans Condensed"'); await document.fonts.ready; } catch (e) { /* system fonts */ }
    const ink = "#17191E", dim = "#4A4E55", paper = "#F3EFE6", panel = "#FFFDF8", line = "#E6E0D3", blue = "#1F4FBF";
    const slab = (px) => `700 ${px}px "Zilla Slab", Georgia, serif`;
    const sans = (w, px) => `${w} ${px}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;
    g.fillStyle = paper; g.fillRect(0, 0, W, H);
    g.fillStyle = ink; g.fillRect(0, 0, W, 14);
    g.fillStyle = dim; g.font = sans(700, 28);
    g.fillText(`${D.year} ${D.league.toUpperCase()} DRAFT  ·  TOP 10 CHALLENGE`, 70, 92);
    g.fillStyle = ink; g.font = slab(84);
    const who = (C.name || "").trim();
    g.fillText(who ? `${who}'s top 10` : "My top 10", 70, 182, W - 140);
    let y = 230;
    const rowH = 96;
    const logos = await Promise.all(rows.map((r) => r.p && r.p.sid ? loadImg(`https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500/${r.p.sid}.png&w=120&h=120`) : null));
    for (let i = 0; i < 10; i++) {
      const r = rows.find((x) => x.slot === i + 1);
      g.fillStyle = panel; g.fillRect(70, y, W - 140, rowH - 10);
      g.strokeStyle = line; g.lineWidth = 2; g.strokeRect(70, y, W - 140, rowH - 10);
      g.fillStyle = ink; g.font = slab(52); g.textAlign = "right"; g.fillText(String(i + 1), 150, y + 62); g.textAlign = "left";
      if (r) {
        const im = logos[rows.indexOf(r)];
        if (im) g.drawImage(im, 172, y + 15, 56, 56);
        g.fillStyle = ink; g.font = sans(700, 38); g.fillText(r.n, 248, y + 44, 560);
        g.fillStyle = dim; g.font = sans(500, 25);
        g.fillText(r.p ? `${[r.p.pos, r.p.school].filter(Boolean).join(", ")}  ·  board No. ${r.p.rank}` : "", 248, y + 74, 560);
        const sv = C.server[i + 1], m = mult(sv && sv.pid === r.pid ? sv.at : nowIso(), lock);
        g.fillStyle = blue; g.font = sans(700, 30); g.textAlign = "right"; g.fillText(`${m.toFixed(2)}x`, W - 96, y + 56); g.textAlign = "left";
      } else { g.fillStyle = dim; g.font = sans(500, 30); g.fillText("Still deciding", 248, y + 56); }
      y += rowH;
    }
    g.fillStyle = dim; g.font = sans(600, 27);
    g.fillText("Make yours: davidsolar.dev/draft", 70, H - 56);
    g.textAlign = "right"; g.fillText(new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), W - 70, H - 56); g.textAlign = "left";
    let blob = null;
    try { blob = await new Promise((res) => cv.toBlob(res, "image/png")); } catch (e) { blob = null; }
    if (!blob) { C.msg = "Couldn't make the image here."; C.ok = false; view(); return; }
    const url = URL.createObjectURL(blob), fname = `top-10-${D.league}.png`;
    const file = new File([blob], fname, { type: "image/png" });
    const canShare = navigator.canShare && navigator.canShare({ files: [file] });
    const wrap = document.createElement("div");
    wrap.className = "modal";
    wrap.innerHTML = `<div class="sheet card-sheet"><div class="sheet-head"><h3 class="disp">Share your top 10</h3><button type="button" class="link" data-close>Close</button></div>
      <img src="${url}" alt="Your top 10 mock" class="card-img"><div class="go-row">${canShare ? `<button type="button" class="btn go" data-share>Share</button>` : ""}<a class="btn" href="${url}" download="${fname}">Download</a></div></div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", async (e) => {
      if (e.target.closest("[data-close]") || e.target === wrap) { wrap.remove(); URL.revokeObjectURL(url); }
      if (e.target.closest("[data-share]")) { try { await navigator.share({ files: [file], title: "My top 10", text: "My top 10. Make yours: https://davidsolar.dev/draft/#" + D.league + "/challenge" }); } catch (err) { /* dismissed */ } }
    });
  }

  async function loadBoard() {
    try {
      const B = await rpc("bb_board", { p_league: C.lg });
      C.board = B; C.lockAt = B.lock_at; C.lockNote = B.note;
    } catch (e) { C.board = { error: "Couldn't reach the challenge server. Try a refresh." }; }
    if (!$("#challenge-view").hidden) view();
  }

  function setServer(picks) {
    C.server = { n: (picks || []).length };
    (picks || []).forEach((x) => { C.server[x.slot] = x; });
  }

  async function save() {
    C.name = $("#ch-name").value.replace(/\s+/g, " ").trim(); C.pin = $("#ch-pin").value.trim();
    if (C.name.length < 2) { C.msg = "Add your name."; C.ok = false; view(); return; }
    if (!/^\d{4,8}$/.test(C.pin)) { C.msg = "The PIN is 4 to 8 digits."; C.ok = false; view(); return; }
    const picks = C.picks.map((x, i) => x && { slot: i + 1, pid: x.pid, n: x.n }).filter(Boolean);
    C.busy = true; view();
    try {
      const r = await rpc("bb_save", { p_league: C.lg, p_name: C.name, p_pin: C.pin, p_picks: picks });
      if (r.error) { C.msg = r.error; C.ok = false; }
      else {
        setServer(r.picks); C.name = r.name; BB.store.set("gtp-name", r.name);
        C.msg = `Saved. ${picks.length}/10 picks on the board.`; C.ok = true;
        await loadBoard();
      }
    } catch (e) { C.msg = "Couldn't save just now. Try again in a minute."; C.ok = false; }
    C.busy = false; saveLocal(); view();
  }

  async function loadMine() {
    C.name = $("#ch-name").value.replace(/\s+/g, " ").trim(); C.pin = $("#ch-pin").value.trim();
    if (!C.name || !/^\d{4,8}$/.test(C.pin)) { C.msg = "Enter the name and PIN you saved with."; C.ok = false; view(); return; }
    C.busy = true; view();
    try {
      const r = await rpc("bb_mine", { p_league: C.lg, p_name: C.name, p_pin: C.pin });
      if (r.error) { C.msg = r.error; C.ok = false; }
      else {
        setServer(r.picks); C.name = r.name;
        C.picks = Array(10).fill(null);
        r.picks.forEach((x) => { C.picks[x.slot - 1] = { pid: x.pid, n: x.n }; });
        C.msg = "Loaded your saved mock."; C.ok = true;
      }
    } catch (e) { C.msg = "Couldn't reach the server. Try again in a minute."; C.ok = false; }
    C.busy = false; saveLocal(); view();
  }

  function swap(i, j) {
    [C.picks[i], C.picks[j]] = [C.picks[j], C.picks[i]];
    C.active = j; saveLocal(); view();
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#challenge-view") || !C) return;
    const t = (s) => e.target.closest(s);
    let b;
    if ((b = t("[data-up]"))) { const i = +b.dataset.up; swap(i, i - 1); return; }
    if ((b = t("[data-down]"))) { const i = +b.dataset.down; swap(i, i + 1); return; }
    if ((b = t("[data-clear]"))) { const i = +b.dataset.clear; C.picks[i] = null; C.active = i; saveLocal(); view(); return; }
    if ((b = t("[data-slot]"))) { C.active = +b.dataset.slot; view(); return; }
    if ((b = t("[data-pick]"))) {
      const p = player(b.dataset.pick);
      if (!p) return;
      C.picks[C.active] = { pid: p.id, n: p.n };
      const next = C.picks.findIndex((x, i) => !x && i > C.active);
      C.active = next >= 0 ? next : C.picks.findIndex((x) => !x) >= 0 ? C.picks.findIndex((x) => !x) : C.active;
      C.msg = ""; saveLocal(); view(); return;
    }
    if ((b = t("[data-chpos]"))) { C.pos = b.dataset.chpos; view(); return; }
    if ((b = t("[data-entry]"))) { C.open = C.open === b.dataset.entry ? null : b.dataset.entry; view(); return; }
    if (t('[data-ch="load"]')) { loadMine(); return; }
    if (t('[data-ch="share"]')) { shareCard(); return; }
  });
  document.addEventListener("submit", (e) => {
    if (!e.target.closest("#challenge-view .ch-save")) return;
    e.preventDefault(); save();
  });
  document.addEventListener("input", (e) => {
    if (!C) return;
    if (e.target.id === "ch-q") {
      C.q = e.target.value;
      const list = document.querySelector("#challenge-view .ch-list");
      if (list) list.innerHTML = pool();
    } else if (e.target.id === "ch-name") { C.name = e.target.value; saveLocal(); }
    else if (e.target.id === "ch-pin") { C.pin = e.target.value; }
  });

  async function render(lg) {
    const el = $("#challenge-view");
    try { D = await BB.data(lg); } catch (err) { el.innerHTML = `<p class="note">Couldn't load the board. Try a refresh.</p>`; return; }
    if (!C || C.lg !== lg) C = fresh(lg);
    view();
    loadBoard();
  }

  window.Challenge = { render };
})();
