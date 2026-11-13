/* Fantasy Kit: the browser side. Load after sports.js, value.js and draft.js, with kit.css on the page.

   FK.ui gives a league page:
     helpers     esc, $, $$, store(ns), toast, dialog, confirm, theme, fmtLeft, money, ord, ago
     identity    teamAv, SHAPES, GLYPHS, logoSvg, glyphOf, shapeOf, playerAv, pname, teamName, posChip(s)
     shell       masthead, section tabs, page tabs, league switcher
     tables      sortable tables from column definitions, player columns per sport, position chips
     modules     scoreboard, versus (matchup hero), vsTable (side-by-side lineups), standingsTable, feed, txLine,
                 tradeCard, tradeWindow, playerCard. They take plain view models, so any league engine can use them.
     room        the full draft room on top of FK.draft (FK.ui.room)
   Nothing here saves anything: the page decides where a league lives. */
(function (root) {
  "use strict";
  const FK = root.FK, S = FK.sports, F = FK.draft;

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  function store(ns) {
    return {
      get(k, d) { try { const v = localStorage.getItem(ns + ":" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
      set(k, v) { try { if (v == null) localStorage.removeItem(ns + ":" + k); else localStorage.setItem(ns + ":" + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    };
  }
  let toastT = null;
  function toast(msg, bad) {
    let el = $("#fk-toast");
    if (!el) { el = document.createElement("div"); el.id = "fk-toast"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el); }
    el.textContent = msg; el.className = "toast" + (bad ? " bad" : ""); el.hidden = false;
    // in the top layer, so a toast shows over an open dialog too ("Pick who to drop first")
    const pop = typeof el.showPopover === "function";
    if (pop) { if (!el.popover) el.popover = "manual"; try { if (el.matches(":popover-open")) el.hidePopover(); el.showPopover(); } catch (e) { /* not supported */ } }
    clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; if (pop) try { el.hidePopover(); } catch (e) { /* already closed */ } }, 3400);
  }
  // A modal with a close button. onSubmit(formData, form) runs for a <form>; return false to keep it open.
  function dialog(html, onSubmit, opts = {}) {
    let D = $("#fk-dlg");
    if (!D) { D = document.createElement("dialog"); D.id = "fk-dlg"; document.body.appendChild(D); D.addEventListener("close", () => { const f = D.onclosed; D.onclosed = null; if (f) f(); }); }
    D.className = "fk-dlg" + (opts.wide ? " wide" : "") + (opts.full ? " full" : "") + (opts.dark ? " fk-dark" : "") + (opts.full ? "" : " sheet");
    D.oninput = D.onchange = D.onclick = null;
    D.innerHTML = `<button type="button" class="dlg-x" data-close aria-label="Close">&times;</button>` + html;
    D.onclosed = opts.onClose || null;
    $$("[data-close]", D).forEach((b) => b.addEventListener("click", () => D.close()));
    const f = $("form", D);
    if (f && onSubmit) f.addEventListener("submit", (e) => {
      e.preventDefault();
      const keep = onSubmit(new FormData(f), f, e.submitter);
      if (keep !== false) D.close();
    });
    if (!D.open) D.showModal();
    return D;
  }
  /* ---------- manager profiles: one name and photo for every league ---------- */
  // A manager's face: his photo, or his initials on a soft circle. face is { name, photo } or null.
  function faceAv(face, name, size = "") {
    const n = (face && face.name) || name || "";
    const ini = n.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
    return face && face.photo ? `<span class="mav ${size}"><img src="${esc(face.photo)}" alt="" loading="lazy"></span>` : `<span class="mav ini ${size}" aria-hidden="true">${esc(ini)}</span>`;
  }
  // A photo from a file: cropped to its middle square and shrunk, as a small JPEG data URL.
  function squarePhoto(file, px = 192) {
    return new Promise((ok, no) => {
      if (!file || !/^image\//.test(file.type)) return no(new Error("That isn't an image"));
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const side = Math.min(img.width, img.height), c = document.createElement("canvas");
        c.width = c.height = px;
        c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, px, px);
        URL.revokeObjectURL(url);
        let q = 0.85, out = c.toDataURL("image/jpeg", q);
        while (out.length > 60000 && q > 0.4) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
        ok(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); no(new Error("That image didn't open")); };
      img.src = url;
    });
  }
  // Edit your profile: save({ name, photo }) returns a promise of { ok } or { error }.
  function profileDialog(cur, save) {
    const st = { photo: (cur && cur.photo) || null };
    const D = dialog(`<h3>Your profile</h3><form class="stack pf">
        <div class="pf-top"><span id="pf-prev"></span><div class="stack" style="gap:6px"><label class="btn sm" for="pf-file">Upload a photo</label><input type="file" id="pf-file" accept="image/*" class="sr">
          <button type="button" class="btn sm link" data-pf-clear${st.photo ? "" : " hidden"}>Remove the photo</button></div></div>
        <div class="field"><label for="pf-name">Your name</label><input type="text" id="pf-name" name="name" maxlength="24" required value="${esc((cur && cur.name) || "")}" autocomplete="name"></div>
        <p class="ps" style="margin:0">Your name and photo are the same in every league you're in. Other managers see them on the Managers page and next to your team.</p>
        <p class="ps loss" id="pf-why" role="alert"></p>
        <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">Save profile</button></div></form>`, (fd, f, sub) => {
      const name = String(fd.get("name") || "").trim();
      if (!name) { $("#pf-why", D).textContent = "Add your name."; return false; }
      if (sub) sub.disabled = true;
      Promise.resolve(save({ name, photo: st.photo })).then((r) => {
        if (r && r.ok) { D.close(); toast("Profile saved."); }
        else { $("#pf-why", D).textContent = (r && r.error) || "That didn't save. Try again."; if (sub) sub.disabled = false; }
      }, (e) => { $("#pf-why", D).textContent = e.message; if (sub) sub.disabled = false; });
      return false;
    });
    const draw = () => { $("#pf-prev", D).innerHTML = faceAv({ name: $("#pf-name", D).value, photo: st.photo }, "", "xl"); const c = $("[data-pf-clear]", D); if (c) c.hidden = !st.photo; };
    draw();
    D.addEventListener("input", (e) => { if (e.target.id === "pf-name") draw(); });
    $("#pf-file", D).addEventListener("change", (e) => {
      squarePhoto(e.target.files[0]).then((u) => { st.photo = u; draw(); }, (err) => { $("#pf-why", D).textContent = err.message; });
    });
    $("[data-pf-clear]", D).addEventListener("click", () => { st.photo = null; draw(); });
    return D;
  }
  const dialogOpen = () => { const D = $("#fk-dlg"); return !!(D && D.open); };
  // Keyboard focus across a redraw: remember what had it (an id, or its tag and data attributes) and find it again,
  // or the nearest thing like it (the next Draft button after you draft), so focus doesn't fall back to the page.
  function focusKey(root) {
    const a = document.activeElement;
    if (!a || a === document.body || !root.contains(a)) return null;
    const attrs = [...a.attributes].filter((x) => /^(data-|aria-label$|href$|name$|value$)/.test(x.name) && !/^data-(kb)$/.test(x.name));
    const q = (list) => a.tagName.toLowerCase() + list.map((x) => `[${x.name}="${String(x.value).replace(/["\\]/g, "\\$&")}"]`).join("");
    return { id: a.id || null, q: q(attrs), loose: attrs.find((x) => x.name.startsWith("data-")) ? q([attrs.find((x) => x.name.startsWith("data-"))]).replace(/="[^"]*"\]$/, "]") : null,
      text: (a.textContent || "").trim(), sel: a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null };
  }
  function refocus(root, k) {
    if (!k || (document.activeElement && document.activeElement !== document.body && document.activeElement.isConnected)) return;
    let el = k.id ? document.getElementById(k.id) : null;
    try {
      if (!el && k.q) { const c = [...root.querySelectorAll(k.q)]; el = c.find((x) => (x.textContent || "").trim() === k.text) || c[0]; }
      if (!el && k.loose) el = root.querySelector(k.loose);
    } catch (e) { el = null; }
    if (!el) return;
    el.focus({ preventScroll: true });
    if (k.sel) try { el.setSelectionRange(k.sel[0], k.sel[1]); } catch (e) { /* not a text field */ }
  }
  // Player names open the player card: make each one reachable by Tab and Enter where a row or chip carries
  // data-player but isn't a control itself.
  function keyboardPlayers(root) {
    for (const host of root.querySelectorAll("[data-player]")) {
      if (/^(BUTTON|A|INPUT|SELECT)$/.test(host.tagName) || host.hasAttribute("tabindex")) continue;
      const pn = host.querySelector(".pn") || (host.tagName === "TR" ? null : host);
      if (!pn || pn.hasAttribute("tabindex")) continue;
      pn.setAttribute("tabindex", "0"); pn.setAttribute("role", "button"); pn.dataset.kb = "1";
      if (pn !== host) pn.setAttribute("aria-label", `${pn.textContent.trim()}: player card`);
    }
  }
  // An open league switcher stays on screen, and Escape or a click elsewhere closes it.
  if (typeof document !== "undefined") {
    document.addEventListener("toggle", (e) => {
      const d = e.target;
      if (!d.matches || !d.matches("details.switch") || !d.open) return;
      const m = d.querySelector(".menu");
      if (!m) return;
      m.style.left = "0px";
      const r = m.getBoundingClientRect(), over = r.right - (document.documentElement.clientWidth - 12);
      if (over > 0) m.style.left = `${-Math.min(over, r.left - 12)}px`;
    }, true);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const d = document.querySelector("details.switch[open]");
      if (d) { d.open = false; const s0 = d.querySelector("summary"); if (s0) s0.focus(); }
    });
    document.addEventListener("click", (e) => { for (const d of document.querySelectorAll("details.switch[open]")) if (!d.contains(e.target)) d.open = false; });
  }
  // Enter and Space work on everything that acts like a button without being one: sortable headers, board cells,
  // player names.
  if (typeof document !== "undefined") document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target;
    if (!t || !t.matches || /^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(t.tagName)) return;
    if (t.matches("th[data-sort], [role=button][tabindex], [data-kb]")) { e.preventDefault(); t.click(); }
  });
  function confirm(title, body, yes, onYes) {
    dialog(`<h3>${esc(title)}</h3><p class="muted" style="margin:0">${body}</p><form><div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">${esc(yes)}</button></div></form>`, () => { onYes(); });
  }
  function theme(ns) {
    const st = store(ns);
    const apply = (t) => { if (t === "dark") document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme; };
    apply(st.get("theme", ""));
    return { dark: () => document.documentElement.dataset.theme === "dark", toggle() { const t = this.dark() ? "light" : "dark"; st.set("theme", t); apply(t); return t; } };
  }
  // how long until a draft set for a time: "2:14:05", "14:05", "0:42"
  const startIn = (at) => { const ms = Math.max(0, at - Date.now()), h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4), sec = Math.floor((ms % 6e4) / 1e3); return h >= 24 ? `${Math.round(h / 24)}d` : h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`; };
  const drawStart = () => { const el = document.getElementById("fk-startin"); if (el) el.textContent = startIn(+el.dataset.at || 0); };
  const fmtLeft = (ms) => {
    if (!Number.isFinite(ms)) return "";
    const left = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), x = left % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
  };
  const money = (n) => "$" + Math.round(n || 0);
  const ord = (n) => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10] || "th");
  const last = (n) => { const parts = String(n).split(" "); const s = parts.pop(); return /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(s) && parts.length ? parts.pop() + " " + s : s; };
  const initials = (n) => { const w = String(n).replace(/[^A-Za-z0-9 .'-]/g, "").split(/\s+/).filter((x) => x && !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(x)); return ((w[0] || "?")[0] + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase(); };
  const ago = (t, now = Date.now()) => {
    const d = now - t;
    if (d < 6e4) return "Just now";
    if (d < 36e5) return Math.floor(d / 6e4) + "m ago";
    if (d < 864e5) return Math.floor(d / 36e5) + "h ago";
    return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  /* ---------- identity ---------- */
  /* ---------- team logos ---------- */
  // Every team gets a crest: a shape in its color with an icon, picked from its name unless the team chose its own
  // (team.shape, team.glyph) or uploaded an image (team.img, a small data URL). glyph: false keeps the abbreviation.
  const SHAPES = {
    shield: "M20 2l16 5v12c0 10-7 16-16 19C11 35 4 29 4 19V7z",
    circle: "M20 1a19 19 0 1 0 0 38a19 19 0 1 0 0-38z",
    hex: "M20 1l17 9.5v19L20 39 3 29.5v-19z",
    square: "M9 1h22a8 8 0 0 1 8 8v22a8 8 0 0 1-8 8H9a8 8 0 0 1-8-8V9a8 8 0 0 1 8-8z",
  };
  const GLYPHS = {
    moon: "M15 3a9 9 0 1 0 6 15A7.5 7.5 0 0 1 15 3z",
    bolt: "M13 2L4 14h6l-1 8 9-12h-6l1-8z",
    flame: "M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 1 1 2 2 2 4 1-2 1-5 1-8z",
    target: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zm0 4a6 6 0 1 1 0 12a6 6 0 1 1 0-12zm0 3a3 3 0 1 0 0 6a3 3 0 1 0 0-6z",
    clock: "M10 1h4v2h-4zM12 4a9 9 0 1 0 0 18a9 9 0 1 0 0-18zm0 2.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13zM11 8h2v5h-2z",
    crown: "M3 18h18v3H3zM3 7l5 4 4-7 4 7 5-4-2 10H5z",
    star: "M12 2l3 7h7l-5.5 4.5 2 7.5-6.5-4.5-6.5 4.5 2-7.5L2 9h7z",
    rain: "M7 15a5 5 0 1 1 1-9.9A6 6 0 0 1 19 8a3.5 3.5 0 0 1 0 7zM8 17l-1.5 4h2L10 17zm5 0l-1.5 4h2L15 17z",
    hourglass: "M6 2h12v2l-5 8 5 8v2H6v-2l5-8-5-8z",
    house: "M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z",
    peak: "M2 20l7-12 4 6 3-4 6 10z",
    chevrons: "M3 5h5l6 7-6 7H3l6-7zM11 5h5l6 7-6 7h-5l6-7z",
    can: "M5 7h14l-1.5 14h-11zM9 2h6v2H9zM3 4h18v2H3z",
    grid: "M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z",
    diamond: "M12 2l10 10-10 10L2 12zm0 5l-5 5 5 5 5-5z",
    zzz: "M4 4h7v2l-4.5 5H11v2H4v-2l4.5-5H4zm9 6h7v2l-4.5 5H20v2h-7v-2l4.5-5H13z",
    claws: "M5 3h3L5 21H2zm7 0h3l-3 18H9zm7 0h3l-3 18h-3z",
    wave: "M2 14c3-4 5-4 8 0s5 4 8 0 3-3 4-2v4c-1-1-1-1-4 2s-5 4-8 0-5-4-8 0z",
    bench: "M3 8h18v3H3zM3 13h18v2H3zM5 15h2v6H5zm12 0h2v6h-2z",
    ball: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zm-1 2.1V11H4.1A8 8 0 0 1 11 4.1zm2 0A8 8 0 0 1 19.9 11H13zM4.1 13H11v6.9A8 8 0 0 1 4.1 13zM13 13h6.9A8 8 0 0 1 13 19.9z",
  };
  const NAME_GLYPH = { "night shift": "moon", "bench mob": "bench", "waiver wire": "bolt", "late scratch": "claws", "deep sleepers": "zzz", "box score": "grid",
    "hot corner": "flame", "full count": "diamond", "red zone": "target", "fast break": "chevrons", "two minute": "clock", "garbage time": "can",
    "pick six": "star", "rain delay": "rain", "shot clock": "clock", "trade deadline": "hourglass", "home stand": "house", "overtime": "clock",
    "sixth man": "star", "bye week": "wave", "your team": "crown" };
  const hashOf = (str) => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const glyphOf = (t) => (t.glyph && GLYPHS[t.glyph] ? t.glyph : NAME_GLYPH[String(t.name || "").toLowerCase()] || Object.keys(GLYPHS)[hashOf(t.name) % Object.keys(GLYPHS).length]);
  const shapeOf = (t) => (t.shape && SHAPES[t.shape] ? t.shape : Object.keys(SHAPES)[hashOf(t.name + "|s") % 4]);
  const logoSvg = (t) => { const sh = shapeOf(t); return `<svg viewBox="0 0 40 40" focusable="false"><path d="${SHAPES[sh]}" fill="var(--c)"/><path d="${SHAPES[sh]}" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="2"/><g transform="translate(9 ${sh === "shield" ? 7 : 8}) scale(.92)"><path d="${GLYPHS[glyphOf(t)]}" fill="#fff" fill-rule="evenodd"/></g></svg>`; };
  const teamAv = (t, size = "") => {
    const c = `av c${((t && t.color) || 0) % 12}${size ? " " + size : ""}`;
    if (t && t.img) return `<span class="${c} logo img" aria-hidden="true"><img src="${esc(t.img)}" alt=""></span>`;
    if (t && t.name && t.glyph !== false) return `<span class="${c} logo" aria-hidden="true">${logoSvg(t)}</span>`;
    return `<span class="${c}" aria-hidden="true">${esc(String((t && t.abbr) || "?").slice(0, 3))}</span>`;
  };
  /* ---------- the league's own look: a banner crest in the league color, and the masthead on its front page ---------- */
  // A league's brand: { color: 0-11, letters: up to 3 } from settings.brand, or picked from its name. A league can
  // also set its own colors: hex (the crest and accent) and bg (the masthead), each a #rrggbb.
  const HEX = /^#[0-9a-f]{6}$/i;
  const leagueBrand = (name, b) => {
    const words = String(name || "League").replace(/['\u2019]/g, "").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    const auto = (words.length > 1 ? words.slice(0, 2).map((w) => w[0]) : [String(words[0] || "L").slice(0, 2)]).join("").toUpperCase();
    const letters = String((b && b.letters) || auto).replace(/[^A-Za-z0-9&]/g, "").slice(0, 3).toUpperCase() || "L";
    return { color: b && b.color != null && b.color >= 0 ? b.color % 12 : hashOf(String(name || "") + "|lg") % 12, letters,
      hex: b && HEX.test(b.hex || "") ? b.hex : null, bg: b && HEX.test(b.bg || "") ? b.bg : null };
  };
  const brandC = (br) => br.hex || `var(--t${br.color})`;
  // the crest: a banner like the ones hung in the rafters, the league's letters on it. size: "sm" (a menu), "" or "lg"
  const leagueCrest = (br, size = "") => {
    const fs = br.letters.length > 2 ? 15 : br.letters.length > 1 ? 19 : 23;
    return `<span class="lgcr${size ? " " + size : ""}" style="--c:${brandC(br)}" aria-hidden="true"><svg viewBox="0 0 48 60" focusable="false"><path d="M2 0h44v52L24 43 2 52z" fill="var(--c)"/><path d="M2 0h44v52L24 43 2 52z" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="2"/><path d="M7 5h34" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/><text x="24" y="${br.letters.length > 2 ? 30 : 31}" text-anchor="middle" dominant-baseline="middle" font-size="${fs}" class="lgcr-t">${esc(br.letters)}</text></svg></span>`;
  };
  // A past champion's pennant: the season and the team, in the team's color.
  const pennant = (x) => `<li class="pnt" style="--c:var(--t${(x.color || 0) % 12})" title="${esc(x.season)}: ${esc(x.name)}"><b>${esc(x.season)}</b><span>${esc(x.abbr)}</span></li>`;
  // The masthead: crest, name (the league switcher), a line about the league, the season as a strip of weeks, and
  // past champions as pennants. vm: { brand, sub, note, weeks: [{ n, k: "done" | "now" | "next", po }], weekLine, champs }
  function leagueMast(vm) {
    const wk = vm.weeks && vm.weeks.length ? `<div class="lgm-wk"><span class="lgm-ticks" aria-hidden="true">${vm.weeks.map((x) => `<i class="${x.k}${x.po ? " po" : ""}${x.gap ? " gap" : ""}" title="${x.po ? "Playoffs, w" : "W"}eek ${x.n}"></i>`).join("")}</span><span class="lgm-wl">${esc(vm.weekLine)}</span></div>` : "";
    const champs = vm.champs && vm.champs.length ? `<ul class="lgm-pn" aria-label="Past champions">${vm.champs.map(pennant).join("")}</ul>` : "";
    return { crest: leagueCrest(vm.brand, "lg"), body: `${vm.sub ? `<p class="lgm-sub">${vm.sub}</p>` : ""}${wk}${vm.note ? `<p class="lgm-note">${vm.note}</p>` : ""}`, champs };
  }
  const posChip = (sport, pos) => `<span class="pp c${(sport.colors && sport.colors[pos]) || 6}">${esc(pos)}</span>`;
  const posChips = (sport, p) => S.positions(p).map((x) => posChip(sport, x)).join("");
  const colorOf = (sport, p) => (sport.colors && sport.colors[FK.value.mainPos(sport, p)]) || 6;
  // A player's photo, linked from his league (MLB, cropped on the face) or ESPN (NBA, NFL), when the pool carries
  // his id. Without one, assets/faces.js finds him by name in the faces registry (if the page loads it).
  const facePhoto = (sport, p) => {
    const k = sport && sport.key;
    if (k === "mlb" && /^\d{5,7}$/.test(String(p.id))) return { src: `https://img.mlbstatic.com/mlb-photos/image/upload/c_thumb,g_face,z_1.0,w_120,h_120,q_auto:best/v1/people/${p.id}/headshot/67/current` };
    if ((k === "nba" || k === "nfl") && p.espn) return { src: `https://a.espncdn.com/combiner/i?img=/i/headshots/${k}/players/full/${p.espn}.png&w=180&h=131`, espn: true };
    return null;
  };
  // A player's avatar: his face in a ring of his position's color; else his team's logo; else his initials (a free
  // agent, or the images won't load).
  const playerAv = (sport, p, size = "") => {
    const logo = sport && p && p.t && p.t !== "FA" && S.teamLogo ? S.teamLogo(sport.key, p.t, 96) : null;
    const face = p ? facePhoto(sport, p) : null;
    const src = face ? face.src : logo;
    const fall = face && logo ? `if(!this.dataset.l){this.dataset.l=1;this.parentNode.classList.remove('face','espn');this.parentNode.classList.add('lgo');this.src='${esc(logo)}'}else{this.parentNode.classList.remove('lgo');this.remove()}`
      : `this.parentNode.classList.remove('lgo','face','espn');this.remove()`;
    const ask = !face && p && p.n && sport && /^(nba|nfl|mlb)$/.test(sport.key) ? ` data-face-sport="${sport.key}" data-face-name="${esc(p.n)}"` : "";
    return `<span class="pav c${colorOf(sport, p)}${size ? " " + size : ""}${face ? " face" + (face.espn ? " espn" : "") : src ? " lgo" : ""}" aria-hidden="true"${ask}>${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="${fall}">` : ""}${esc(initials(p.n))}</span>`;
  };
  const injTag = (p) => (p && p.inj ? ` <span class="tag inj" title="${esc(p.inj)}">${esc(String(p.inj).replace(/^day.*/i, "DTD").replace(/^questionable/i, "Q").slice(0, 3).toUpperCase())}</span>` : "");
  // Avatar, name and a small line (positions and team) for any player.
  // A draft pick as a tradeable item: { id, n: "Pick 2.5", pick: true, sub, price }.
  const pickItem = (p, extra = "") => `<span class="pname"><span class="pav pk" aria-hidden="true">#</span><span><span class="pn">${esc(p.n)}</span><span class="sub">${esc(p.sub || "Draft pick")}${extra ? ", " + extra : ""}</span></span></span>`;
  // a player's pro team: its abbreviation in the team's color (the logo is in his avatar)
  const proTeam = (sport, t) => { if (!t || t === "FA") return "Unsigned"; const c = S.teamColor && sport && S.teamColor(sport.key, t); return c ? `<span class="ptm" style="--c:${c.bg};--ci:${c.ink}">${esc(t)}</span>` : esc(t); };
  const pname = (sport, p, extra = "", opts = {}) => p && p.pick ? pickItem(p, extra) : p ? `<span class="pname${opts.b ? " b" : ""}">${opts.noAv ? "" : playerAv(sport, p, opts.size || "")}<span><span class="pn">${esc(p.n)}</span><span class="sub">${injTag(p).trim()}${p.inj ? " " : ""}${p.rk ? `<span class="rkt" title="Rookie">R</span> ` : ""}${S.positions(p).join(", ")} ${proTeam(sport, p.t)}${confTag(sport, p)}${extra ? ", " + extra : ""}</span></span></span>` : `<span class="ps">Empty</span>`;
  // a league with a conference limit shows each player's college conference
  const confTag = (sport, p) => { const c = sport && sport.conf && S.confOf ? S.confOf(p) : null; return c ? ` <span class="cft" title="${esc(p.col)}, ${esc(c)}">${esc(S.confShort(c))}</span>` : ""; };
  const teamName = (t, opts = {}) => `<span class="row" style="gap:9px">${teamAv(t, opts.size || "sm")}<span class="ell"><b>${esc(t.name)}</b>${opts.you ? ` <span class="tag you">You</span>` : ""}${opts.owner !== false && t.owner && !(opts.you && /^you$/i.test(t.owner)) ? ` <span class="ps">${esc(t.owner)}</span>` : ""}${opts.badge || ""}</span></span>`;

  /* ---------- shell ---------- */
  // opts: { brand: { name, href, mark }, title (html beside the brand), tabs: [[key, label, badge]], tab,
  //         subs: [[key, label, badge]], sub, hrefOf(tab, sub), right (html) }
  const CHAT_ICON = `<svg class="nav-ic" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 4h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  function shell(opts) {
    const href = opts.hrefOf || ((t, s) => "#" + t + (s ? "/" + s : ""));
    const badge = (n) => (n ? `<span class="badge">${n}</span>` : "");
    const m = opts.mast ? leagueMast(opts.mast) : null;
    // opts.slim: the same masthead in the league's colors, one line tall (every page but the front page), so the
    // header doesn't change character from page to page
    return `${m ? `<div class="fk-mast fk-band lgm${opts.slim ? " slim" : ""} c${opts.mast.brand.color}" style="--lc:${brandC(opts.mast.brand)}${opts.mast.brand.bg ? `;--band:${opts.mast.brand.bg}` : ""}"><div class="wrap lgm-in">
        ${m.crest}<div class="lgm-id"><div class="lgm-top"><a class="fk-brand" href="${esc(opts.brand.href || "./")}">${opts.brand.mark || ""}<b class="disp">${esc(opts.brand.name)}</b></a>${opts.title || ""}</div>${opts.slim ? "" : m.body}</div>
        <div class="lgm-side"><div class="fk-who">${opts.right || ""}</div>${opts.slim ? "" : m.champs}</div></div></div>`
      : `<div class="fk-mast fk-band"><div class="wrap">
        <a class="fk-brand" href="${esc(opts.brand.href || "./")}">${opts.brand.mark || ""}<b class="disp">${esc(opts.brand.name)}</b></a>
        ${opts.title || ""}<span class="grow"></span><div class="fk-who">${opts.right || ""}</div></div></div>`}
      ${opts.tabs && opts.tabs.length ? `<div class="fk-nav${opts.tabbar ? " has-bar" : ""}"><div class="wrap"><nav aria-label="Sections">${opts.tabs.map(([k, n, b]) => `<a href="${href(k)}"${k === opts.tab ? ' aria-current="page"' : ""}>${esc(n)}${badge(b)}</a>`).join("")}${opts.navEnd ? `<a class="nav-end" href="${esc(opts.navEnd[0])}"${opts.navEnd[3] ? ' aria-current="page"' : ""}>${CHAT_ICON}${esc(opts.navEnd[1])}${badge(opts.navEnd[2])}</a>` : ""}</nav></div></div>` : ""}
      ${opts.subs && opts.subs.length ? `<nav class="fk-subs" aria-label="Pages"><div class="wrap">${opts.subs.map(([k, n, b]) => `<a href="${href(opts.tab, k)}"${k === opts.sub ? ' aria-current="page"' : ""}>${esc(n)}${badge(b)}</a>`).join("")}</div></nav>` : ""}
      ${opts.tabbar && opts.tabs && opts.tabs.length ? `<nav class="fk-tabbar" aria-label="Sections, phone" style="--n:${opts.tabs.length}">${opts.tabs.map(([k, n, b]) => `<a href="${href(k)}"${k === opts.tab ? ' aria-current="page"' : ""}>${TAB_ICON[k] || TAB_ICON.league}<span>${esc(SHORT_TAB[k] || n)}</span>${b ? `<i class="tb-n">${b}</i>` : ""}</a>`).join("")}</nav>` : ""}`;
  }
  // phone tab bar icons, drawn on a 24 grid with a 1.8 stroke
  const ico = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const TAB_ICON = {
    league: ico('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7M10 17h4"/>'),
    team: ico('<path d="M9 3.5 5 5.5 2.8 9.5l3 1.6L7 9.8V20.5h10V9.8l1.2 1.3 3-1.6L19 5.5l-4-2a3 3 0 0 1-6 0z"/>'),
    matchup: ico('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M12 5v14"/><path d="M6.5 10.5h2M15.5 10.5h2M6.5 13.5h2M15.5 13.5h2"/>'),
    players: ico('<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/>'),
    draft: ico('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
    commish: ico('<path d="M4 15.5a5 5 0 0 0 9.6 1.9L20.5 9a1.5 1.5 0 0 0-1-2.5H12a5 5 0 0 0-8 9z"/><circle cx="9" cy="14.5" r="1.6"/><path d="M14 6.5V4"/>'),
  };
  const SHORT_TAB = { team: "Team", commish: "Commish" };
  // A league switcher: current league with its avatar, a menu of leagues and extra menu items.
  const switcher = (cur, items, extra = "") => `<details class="switch"><summary>${cur.crest || teamAv(cur, "sm")}<span class="ell">${esc(cur.name)}</span><span class="chev" aria-hidden="true"></span></summary>
    <div class="menu">${items.map((x) => `<a href="${esc(x.href)}">${x.crest || (x.av ? teamAv(x.av, "sm") : "")}<span>${esc(x.name)}${x.sub ? `<small>${esc(x.sub)}</small>` : ""}</span></a>`).join("")}${extra ? `${items.length ? "<hr>" : ""}${extra}` : ""}</div></details>`;
  const route = (def) => { const h = location.hash.replace(/^#/, "").split("/").map(decodeURIComponent); return { tab: h[0] || def, sub: h[1] || "", arg: h[2] || "" }; };

  /* ---------- tables ---------- */
  // cols: [{ k, label, title, cls ("r"), hide ("s" hides on phones), td, sort (row => value), asc, html (row => cell) }]
  function sortRows(rows, cols, sort) {
    const c = cols.find((x) => x.k === sort.k && x.sort);
    if (!c) return rows;
    return rows.slice().sort((a, b) => {
      const x = c.sort(a), y = c.sort(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * sort.dir;
    });
  }
  function table(opts) {
    const { cols, sort = {} } = opts;
    const th = (c) => {
      const cls = [c.cls || "", c.hide ? "hide-" + c.hide : "", c.sort ? "sortable" : "", c.sort && sort.k === c.k ? "on" : ""].join(" ").trim();
      const aria = c.sort ? ` aria-sort="${sort.k === c.k ? (sort.dir > 0 ? "ascending" : "descending") : "none"}" data-sort="${esc(c.k)}" tabindex="0"` : "";
      return `<th class="${cls}"${aria}${c.title ? ` title="${esc(c.title)}"` : ""}>${c.raw ? c.label : esc(c.label)}</th>`;
    };
    const lim = opts.limit || 400, rows = opts.rows.slice(0, lim);
    const more = opts.rows.length > lim ? `<tr><td colspan="${cols.length}" class="more"><button type="button" class="btn sm" data-more="${esc(opts.id || "")}">Show ${Math.min(250, opts.rows.length - lim)} more</button> <span class="ps">Showing ${lim} of ${opts.rows.length}</span></td></tr>` : "";
    return `<div class="table-wrap"${opts.id ? ` id="${esc(opts.id)}"` : ""}${opts.style ? ` style="${opts.style}"` : ""}><table class="t${opts.dense ? " dense" : ""}${opts.cls ? " " + opts.cls : ""}"><thead><tr>${cols.map(th).join("")}</tr></thead><tbody>
      ${rows.map((r) => (r && r.__html) || `<tr${opts.rowAttr ? " " + opts.rowAttr(r) : ""}>${cols.map((c) => `<td class="${[c.cls || "", c.hide ? "hide-" + c.hide : "", c.td || ""].join(" ").trim()}">${c.html(r)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length}" class="empty">${esc(opts.empty || "Nothing here.")}</td></tr>`}${more}
      </tbody></table></div>`;
  }
  function nextSort(sort, k, cols) {
    if (sort.k === k) return { k, dir: -sort.dir };
    const c = cols.find((x) => x.k === k);
    return { k, dir: c && c.asc ? 1 : -1 };
  }

  /* ---------- players ---------- */
  // Stats or projections: a sport with projection lines (baseball's pbat and ppit, basketball's ppg) can show either
  // in its tables. sport.statView = "proj" reads the projection, and a player without one shows a dash.
  const PROJ_OF = { bat: "pbat", pit: "ppit", pg: "ppg" };
  const hasProj = (sport) => !!(sport && sport.data && sport.data.lines && Object.values(PROJ_OF).some((k) => sport.data.lines[k]));
  const projLabel = (sport) => { const L = sport.data.lines, l = ((L.pbat || L.ppg || {}).label || "Projections").replace(/, (batting|per game)$/, ""); return sport.key === "mlb" && l === "Steamer" ? `${+sport.data.season + 1} Steamer projections` : l.replace(/season projection/, "projections"); };
  const statsLabel = (sport) => `${sport.data.season} stats`;
  const lineOf = (sport, p, line) => { const pl = PROJ_OF[line]; return sport.statView === "proj" && pl && sport.data.lines[pl] ? pl : line; };
  function statCell(sport, p, c) {
    if (c.fpts) return p.fpts;
    if (c.fpg) return p.fpg;
    const line = c.line ? lineOf(sport, p, c.line) : c.line;
    if (line !== c.line && !(p.l && p.l[line])) return null;
    if (c.ratio) { const n = S.stat(sport, p, line, c.ratio[0]), d = S.stat(sport, p, line, c.ratio[1]); return d ? n / d : null; }
    return S.stat(sport, p, line, c.col);
  }
  // the switch itself, a small select; the choice sticks per sport in this browser
  const viewKey = (sport) => `fk-statview:${sport.key}`;
  function initView(sport) {
    if (!hasProj(sport)) { sport.statView = "stats"; return; }
    let v = null; try { v = localStorage.getItem(viewKey(sport)); } catch (e) { /* no storage */ }
    sport.statView = v === "stats" || v === "proj" ? v : sport.key === "mlb" ? "proj" : "stats";
  }
  function viewSelect(sport, id) {
    if (!hasProj(sport)) return "";
    if (!sport.statView) initView(sport);
    return `<label class="sr" for="${id}">Stats or projections</label><select id="${id}" class="pill-sel">${[["stats", statsLabel(sport)], ["proj", projLabel(sport)]].map(([v, l]) => `<option value="${v}"${sport.statView === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  }
  function setView(sport, v) { sport.statView = v === "proj" ? "proj" : "stats"; try { localStorage.setItem(viewKey(sport), sport.statView); } catch (e) { /* no storage */ } }
  const isPoints = (sport, scoring) => (sport.scorings[scoring] || Object.values(sport.scorings)[0]).type === "points";
  // Columns for a player table. opts: { group (one baseball side), money (false to hide $), scoring, owner (p => html),
  // actions (p => html), lead (columns first), stats (false to skip), extra (columns before the stats), age }
  // Baseball's stat columns follow the league's categories, so an 8x8 league sees H, TB, OPS, L, HLD and QS; a
  // category the data can't show (none today) is skipped. The usual five by five show on a phone, the rest from tablets up.
  const MLB_CORE = new Set(["r", "hr", "rbi", "sb", "avg", "w", "sv", "k", "era"]);
  function statColumns(sport, scoring) {
    const sc = sport.scorings && sport.scorings[scoring];
    if (sport.key !== "mlb" || !sc || sc.type !== "cats" || !sport.cols) return sport.columns;
    const col = (c) => c.col || c.rate;
    const ok = (c) => c.line && sport.cols[c.line] && col(c) in sport.cols[c.line];
    const mk = (c) => ({ line: c.line, col: col(c), label: c.label, group: c.line, fmt: c.fmt || ((x) => (x == null ? "" : Math.round(x).toString())), hide: MLB_CORE.has(c.k) ? undefined : "s" });
    const bat = sc.cats.filter((c) => c.line === "bat" && ok(c)).map(mk), pit = sc.cats.filter((c) => c.line === "pit" && ok(c)).map(mk);
    const ip = sport.columns.find((c) => c.col === "ip");
    return bat.concat(ip ? [ip] : [], pit);
  }
  // what each stat column's short label means, for its header's tooltip
  const STAT_TITLE = { G: "Games played", GP: "Games played", FPTS: "Fantasy points this season", "FP/G": "Fantasy points per game",
    PaYd: "Passing yards", PaTD: "Passing touchdowns", Int: "Interceptions thrown", RuYd: "Rushing yards", RuTD: "Rushing touchdowns", Rec: "Receptions", ReYd: "Receiving yards", ReTD: "Receiving touchdowns",
    MIN: "Minutes per game", PTS: "Points per game", REB: "Rebounds per game", AST: "Assists per game", STL: "Steals per game", BLK: "Blocks per game", "3PM": "Threes made per game", "FG%": "Field goal percentage", "FT%": "Free throw percentage", TO: "Turnovers per game",
    R: "Runs", HR: "Home runs", RBI: "Runs batted in", SB: "Stolen bases", AVG: "Batting average", OBP: "On-base percentage", OPS: "On-base plus slugging", H: "Hits", TB: "Total bases", BB: "Walks",
    IP: "Innings pitched", W: "Wins", L: "Losses", SV: "Saves", HLD: "Holds", K: "Strikeouts", ERA: "Earned run average", WHIP: "Walks and hits per inning pitched", QS: "Quality starts" };
  function poolColumns(sport, opts = {}) {
    const pts = isPoints(sport, opts.scoring);
    const cols = [
      { k: "rank", label: "Rk", cls: "r num", title: "Overall rank by value over replacement", sort: (p) => p.rank, asc: true, html: (p) => `<span class="ps">${p.rank}</span>` },
      { k: "name", label: "Player", td: "nm", sort: (p) => p.n, asc: true, html: (p) => pname(sport, p) },
      { k: "prank", label: "Pos rk", cls: "r ps", hide: "s", title: "Rank at his position", sort: (p) => parseInt(String(p.prank).replace(/\D+/g, ""), 10), asc: true, html: (p) => esc(p.prank) },
    ];
    // compact (the draft room): with no position picked, only what compares across positions; a position's own stats
    // show once you pick it
    const compact = !!opts.compact && !opts.group;
    if (opts.age !== false && sport.hasAge && !(opts.compact && !opts.dynasty)) cols.push({ k: "age", label: "Age", cls: "r num", hide: "s", sort: (p) => p.age, asc: true, html: (p) => (p.age ? Number(p.age).toFixed(1) : `<span class="ps">-</span>`) });
    if (opts.owner) cols.push({ k: "owner", label: "Status", cls: "st", hide: opts.ownerHide ? "s" : undefined, sort: opts.ownerSort, html: opts.owner });
    // the market, when the page loaded it (value.js market): ESPN's rank and what players go for in real ESPN auctions
    // in season the experts' consensus and the trade market; before a season, ESPN's draft market
    const mk = sport.market;
    if (mk && opts.market !== false && mk.fp) {
      const ros = mk.fp === "rest of season";
      cols.push({ k: "fp", label: "ECR", cls: "r num", hide: "s", title: `FantasyPros expert consensus, ${ros ? "rest of season" : "draft rankings"}${mk.fpType === "ALL" ? "" : `, ${mk.fpType === "HALF" ? "half PPR" : mk.fpType === "PPR" ? "PPR" : "standard"}`}`, sort: (p) => (p.mk && p.mk.fp) || 1e4, asc: true, html: (p) => (p.mk && p.mk.fp ? String(p.mk.fp) : `<span class="ps">-</span>`) });
      if (mk.trade && !opts.compact) cols.push({ k: "tr", label: "Trade", cls: "r num", hide: "s", title: "Rank by FantasyCalc's values from real redraft trades this season", sort: (p) => (p.mk && p.mk.tr) || 1e4, asc: true, html: (p) => (p.mk && p.mk.tr ? String(p.mk.tr) : `<span class="ps">-</span>`) });
    }
    if (mk && opts.market !== false && mk.espn && !(mk.fp === "rest of season")) {
      cols.push({ k: "espn", label: "ESPN", cls: "r num", hide: "s", title: `ESPN's ${sport.market.type === "ROTO" ? "roto" : sport.market.type === "STANDARD" ? "standard" : sport.market.type === "SUPERFLEX" ? "superflex" : "PPR"} rank${sport.market.type === "STANDARD" || sport.market.type === "ROTO" ? "" : ""}, from ${sport.market.source}`, sort: (p) => (p.mk && p.mk.r) || 1e4, asc: true, html: (p) => (p.mk && p.mk.r ? String(p.mk.r) : `<span class="ps">-</span>`) });
      cols.push({ k: "aav", label: "ESPN $", cls: "r num", hide: "s", title: "What he goes for in real ESPN auctions (average price), or ESPN's own auction value before there are any", sort: (p) => (p.mk && (p.mk.aav || p.mk.a)) || 0, html: (p) => { const v = p.mk && (p.mk.aav || p.mk.a); return v ? `<span class="ps">${money(Math.round(v))}</span>` : `<span class="ps">-</span>`; } });
    }
    // on a phone the draft room keeps one value column: projected points or value, unless it's an auction
    if (opts.money !== false) cols.push({ k: "$", label: "$", cls: "r num", hide: opts.compact && !opts.auction ? "s" : undefined, title: "Auction value in this league", sort: (p) => p.$, html: (p) => (p.$ ? `<span class="dollar">${money(p.$)}</span>` : `<span class="ps">-</span>`) });
    // a one-week game or a showdown (sport.weekOf): the week's projected points
    const wkOf = pts ? sport.weekOf : null;
    if (wkOf != null) cols.push({ k: "v", label: `Wk ${wkOf}`, cls: "r num", title: `Projected points in week ${wkOf}: Sleeper's projection for the week, scored for this league`, sort: (p) => p.v, html: (p) => `<b>${p.v == null ? "-" : (p.v / 17).toFixed(1)}</b>` });
    else if (opts.value !== false) cols.push({ k: "v", label: pts ? "Proj" : "Value", cls: "r num", title: pts ? "Season pace: this season's scoring per game blended with the projection, over a full season" : "Summed category z-scores", sort: (p) => p.v, html: (p) => `<b>${p.v == null ? "-" : p.v.toFixed(pts ? 0 : 1)}</b>` });
    if (pts && wkOf == null && sport.data && sport.data.lines && sport.data.lines.proj && sport.data.lines.proj.ros) cols.push({ k: "ros", label: "ROS", cls: "r num", hide: "s", title: `Projected points for the rest of the season, ${sport.data.lines.proj.weeks} weeks`, sort: (p) => p.ros, html: (p) => (p.ros == null ? `<span class="ps">-</span>` : p.ros.toFixed(0)) });
    for (const c of opts.extra || []) cols.push(c);
    if (opts.stats !== false) for (const [i, c] of statColumns(sport, opts.scoring).entries()) {
      if (compact && (c.pos || c.group)) continue;
      if (opts.group && c.group && c.group !== opts.group) continue;
      if (opts.group && c.pos && !c.pos.includes(opts.group)) continue;
      cols.push({ k: "s" + i, label: c.label, title: c.title || STAT_TITLE[c.label] || "", cls: "r num", hide: c.hide, sort: (p) => statCell(sport, p, c), html: (p) => { const v = statCell(sport, p, c); return v == null ? `<span class="ps">-</span>` : v === 0 && !c.fpts && !c.fpg ? `<span class="zero">${c.fmt(v)}</span>` : c.fmt(v); } });
    }
    if (opts.actions) cols.push({ k: "act", label: '<span class="sr">Actions</span>', raw: true, cls: "r act", html: opts.actions });
    return (opts.lead || []).concat(cols);
  }
  // Position chips across the top of a player list; groups (Hitters, Pitchers) when the sport has them.
  // the lineup's spots that take more than one position (FLEX, SFLEX), as chips of their own; not one that takes anyone
  const flexChips = (sport, lineup) => [...new Set(lineup || [])].filter((sl) => { const v = sport.slots[sl]; return Array.isArray(v) && v.length > 1 && sport.positions.some((x) => !v.includes(x) && x !== "UT"); }).map((sl) => ["s:" + sl, sl]);
  // `need`: chip value -> starting spots still open there; those chips get a count, so a phone shows what you need
  function posFilter(sport, cur, extra = [], lineup, need) {
    extra = flexChips(sport, lineup).concat(extra);
    const groups = sport.groups ? [["g:bat", "Hitters"], ["g:pit", "Pitchers"]] : [];
    // rookies get their own chip when the pool flags them (a dynasty's rookie draft starts on it)
    const rk = sport.data && (sport.data.players || []).some((p) => p.rk) ? [["rk", "Rookies"]] : [];
    const all = [["", "All"]].concat(groups, sport.positions.filter((x) => x !== "UT").map((x) => [x, x]), rk, extra);
    const nd = (v) => (need && v && need[v] ? need[v] : 0);
    return `<div class="chips" role="group" aria-label="Positions">${all.map(([v, l]) => `<button type="button" data-fpos="${esc(v)}" aria-pressed="${v === (cur || "")}"${nd(v) ? ` class="needed"` : ""}>${esc(l)}${nd(v) ? `<i class="pf-need" aria-hidden="true">${nd(v)}</i><span class="sr">, you need ${nd(v)}</span>` : ""}</button>`).join("")}</div>`;
  }
  const search = (st, ph = "Search players") => `<label class="sr" for="fk-q">${esc(ph)}</label><input type="search" id="fk-q" placeholder="${esc(ph)}" value="${esc(st.q || "")}" autocomplete="off">`;
  function passes(sport, p, st) {
    if (st.q) { const q = st.q.trim().toLowerCase(); if (q && !p.n.toLowerCase().includes(q) && String(p.t).toLowerCase() !== q) return false; }
    if (st.pos === "rk") { if (!p.rk) return false; }
    else if (st.pos) {
      if (st.pos.startsWith("g:")) { const g = sport.groups[st.pos.slice(2)]; if (!S.positions(p).some((x) => g.includes(x))) return false; }
      else if (st.pos.startsWith("s:")) { if (!S.fits(sport, p, st.pos.slice(2))) return false; }
      else if (!S.positions(p).includes(st.pos)) return false;
    }
    if (st.team && p.t !== st.team) return false;
    return true;
  }
  // football has no stat groups: the position itself picks the columns (a TE filter drops passing and rushing)
  // The stat group a filter shows: hitters or pitchers for a group chip or one position, and for a lineup spot's chip
  // (UTIL, P) the group every position it takes belongs to, so UTIL shows hitting stats and P pitching
  const groupOf = (sport, st) => {
    if (!st.pos) return null;
    if (!sport.groups) return sport.key === "nfl" ? st.pos : null;
    if (st.pos.startsWith("g:")) return st.pos.slice(2);
    const ps = st.pos.startsWith("s:") ? sport.slots[st.pos.slice(2)] : [st.pos];
    if (!Array.isArray(ps)) return null;
    const gs = new Set(ps.map((x) => Object.keys(sport.groups).find((g) => sport.groups[g].includes(x))));
    return gs.size === 1 ? [...gs][0] || null : null;
  };

  const LABELS = { gp: "GP", g: "G", gs: "GS", min: "MIN", fgm: "FGM", fga: "FGA", ftm: "FTM", fta: "FTA", tpm: "3PM", pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK", tov: "TO",
    pa: "PA", ab: "AB", r: "R", h: "H", hr: "HR", rbi: "RBI", sb: "SB", tb: "TB", bb: "BB", avg: "AVG", obp: "OBP", ops: "OPS", ip: "IP", w: "W", l: "L", sv: "SV", hld: "HLD", k: "K", er: "ER", era: "ERA", whip: "WHIP", qs: "QS",
    pass_yd: "Pass yd", pass_td: "Pass TD", pass_int: "INT", rush_att: "Rush", rush_yd: "Rush yd", rush_td: "Rush TD", rec: "Rec", rec_tgt: "Targets", rec_yd: "Rec yd", rec_td: "Rec TD", fum_lost: "Fum",
    fgm_: "FGM", xpm: "XPM", def_td: "Def TD", def_int: "Def INT", def_sack: "Sacks", pts_allow: "Pts allowed", pts_std: "Std pts", pts_half_ppr: "Half PPR", pts_ppr: "PPR" };
  const label = (c) => LABELS[c] || c.toUpperCase();
  // The player card. opts: { actions (html), note (html), scoring, status (html) }
  function playerCard(sport, p, opts = {}) {
    const sc = sport.scorings[opts.scoring] || Object.values(sport.scorings)[0];
    const kd = S.positions(p).some((x) => x === "K" || x === "DEF");
    const lines = Object.entries(sport.data.lines || {}).filter(([k]) => p.l[k]).map(([k, def]) => {
      const cells = def.cols.filter((c) => c !== "eg").map((c) => {
        const v = S.stat(sport, p, k, c);
        if (v == null || (sport.key === "nfl" && v === 0 && (kd ? /^(pass|rush|rec|fum)/.test(c) : /^(fg|xpm|def_|pts_allow)/.test(c)))) return "";
        const f = /^(avg|obp|ops|slg)$/.test(c) ? S.fmt.r3 : /^(era|whip)$/.test(c) ? S.fmt.f2 : Number.isInteger(v) || Math.abs(v) >= 100 ? S.fmt.f0 : S.fmt.f1;
        return `<span><small>${esc(label(c))}</small><b>${f(v)}</b></span>`;
      }).join("");
      return `<div class="stack" style="gap:6px"><div class="ps"><b>${esc(def.label)}</b>, ${esc(sport.data.season)}</div><div class="sgrid">${cells}</div></div>`;
    }).join("");
    // a league's card leads with the week and the league; the season lines fold away under one heading
    const linesHtml = opts.fold && lines ? `<details class="pc-more"><summary>Season stats and projections</summary><div class="stack">${lines}</div></details>` : lines;
    const statRow = (opts.stats || [["Overall", p.rank], ["Position", esc(p.prank)], [sc.type === "points" ? (sport.weekOf != null ? `Week ${sport.weekOf}` : "Projection") : "Value", sc.type === "points" ? (sport.weekOf != null ? (p.v / 17).toFixed(1) : Math.round(p.v)) : p.v.toFixed(1)], ["Auction", p.$ ? money(p.$) : "-"]]).map(([k, v]) => `<div><small>${esc(k)}</small><b>${v}</b></div>`).join("");
    const zs = sc.type === "cats" && p.zc && !opts.noZ ? `<div class="ps"><b>Strength by category</b>, against the player pool</div><div class="zbars" aria-label="Category strength">${sc.cats.filter((c) => p.zc[c.k] != null).map((c) => { const z = Math.max(-3, Math.min(3, p.zc[c.k])); const w = (Math.abs(z) / 3) * 50; return `<span class="ps"><b>${esc(c.label)}</b></span><span class="zbar"><i class="${z < 0 ? "n" : ""}" style="${z < 0 ? `right:50%;width:${w}%` : `left:50%;width:${w}%`}"></i></span><span class="num ps" style="text-align:right">${z >= 0 ? "+" : ""}${z.toFixed(1)}</span>`; }).join("")}</div>` : "";
    // opts.logo: his pro team's logo at the right of the header
    const lg = opts.logo && p.t && p.t !== "FA" && S.teamLogo ? S.teamLogo(sport.key, p.t, 96) : null;
    return `<div class="pc-h">${playerAv(sport, p, "lg")}<div style="min-width:0;flex:1"><h3 class="disp">${esc(p.n)}</h3><div class="ps">${posChips(sport, p)} ${proTeam(sport, p.t)}${p.age ? `, age ${p.age}` : ""}${p.inj ? `, <span class="bad">${esc(p.inj)}</span>` : ""}</div>${opts.status ? `<div class="ps row" style="margin-top:6px">${opts.status}</div>` : ""}</div>${lg ? `<img class="pc-logo" src="${esc(lg)}" alt="" width="64" height="64" loading="lazy" onerror="this.remove()">` : ""}</div>
      ${opts.week || ""}<div class="stat-row pc-stats" style="margin-bottom:14px">${statRow}</div>
      ${opts.note ? `<p class="small" style="margin:0 0 12px">${opts.note}</p>` : ""}
      <div class="stack">${opts.extra || ""}${zs}${opts.after || ""}${linesHtml}</div>${opts.actions ? `<div class="acts pc-acts">${opts.actions}</div>` : ""}`;
  }

  /* ---------- league modules (view models in, HTML out) ---------- */
  // games: [{ href, me, status: "final" | "live" | "proj", label, sub, a: { team, score, rec }, b }]
  // The scoreboard: a strip of games (opts.list stacks them full width, for phones). g.wp adds a win probability bar.
  function scoreboard(games, fmt = (x) => x, opts = {}) {
    return `<div class="scoreboard${opts.list ? " list" : ""}${!opts.list && games.length && games.length <= 6 ? " fill" : ""}${games.length === 4 ? " n4" : ""}">${games.map((g) => {
      const lead = g.a.score === g.b.score ? null : g.a.score > g.b.score ? "a" : "b";
      const ln = (s, k) => `<div class="ln ${lead ? (lead === k ? "lead" : "trail") : ""}">${teamAv(s.team, "sm")}<span class="ell">${esc(s.team.name)}</span><span class="ab">${esc(s.team.abbr || "")}</span><small>${esc(s.rec || "")}</small><b>${fmt(s.score)}</b></div>`;
      const wp = g.wp != null ? `<div class="wpm" aria-label="Win probability ${Math.round(g.wp * 100)} to ${Math.round((1 - g.wp) * 100)}"><i style="width:${(g.wp * 100).toFixed(1)}%;background:var(--t${g.a.team.color % 12})"></i><i style="width:${((1 - g.wp) * 100).toFixed(1)}%;background:var(--t${g.b.team.color % 12})"></i></div>` : "";
      return `<a class="game${g.me ? " me" : ""}${g.feat ? " feat" : ""}" href="${esc(g.href || "#")}"><div class="st"><span class="${g.status === "live" ? "live" : ""}">${esc(g.label || (g.status === "final" ? "Final" : g.status === "live" ? "Live" : "Projected"))}</span>${g.sub ? `<span>${esc(g.sub)}</span>` : g.wp != null && opts.list ? `<span>${Math.round(Math.max(g.wp, 1 - g.wp) * 100)}% ${esc(g.wp >= 0.5 ? g.a.team.abbr : g.b.team.abbr)}</span>` : ""}</div>${ln(g.a, "a")}${ln(g.b, "b")}${opts.list ? wp : ""}</a>`;
    }).join("")}</div>`;
  }
  // The matchup hero. vm: { a: { team, rec, score, proj }, b, wp (0..1 for a), status, live, cats: [{ label, fa, fb, d }], fmt }
  function versus(vm) {
    const lead = vm.a.score === vm.b.score ? null : vm.a.score > vm.b.score ? "a" : "b";
    const fmt = vm.fmt || ((x) => x);
    const side = (s, k) => `<div class="side ${k}${lead ? (lead === k ? " lead" : " trail") : ""}">${teamAv(s.team, "lg")}<div><span class="nm">${esc(s.team.name)}</span><span class="rec">${esc(s.rec || "")}${s.team.owner ? `, ${esc(s.team.owner)}` : ""}</span><span class="score">${fmt(s.score)}</span>${s.projText ? `<span class="proj">${esc(s.projText)}</span>` : s.proj != null ? `<span class="proj">Projected ${fmt(s.proj)}</span>` : ""}</div></div>`;
    const wp = vm.wp != null ? `<div class="wp"><div class="wp-bar" role="img" aria-label="Win probability ${Math.round(vm.wp * 100)} to ${Math.round((1 - vm.wp) * 100)}"><i style="width:${(vm.wp * 100).toFixed(1)}%;background:var(--t${vm.a.team.color % 12})"></i><i style="width:${((1 - vm.wp) * 100).toFixed(1)}%;background:var(--t${vm.b.team.color % 12})"></i></div><div class="wp-l"><span>${Math.round(vm.wp * 100)}%</span><span>Win probability</span><span>${Math.round((1 - vm.wp) * 100)}%</span></div></div>` : "";
    const cats = vm.cats && vm.cats.length ? `<div class="catgrid" style="--nc:${vm.cats.length};--nc2:${Math.ceil(vm.cats.length / 2)}"><div class="who"><small>&nbsp;</small><b>${esc(vm.a.team.abbr)}</b><b>${esc(vm.b.team.abbr)}</b>${vm.cats.some((c) => c.p != null) ? `<em class="who-p">${esc(vm.a.team.abbr)} odds</em>` : ""}</div>${vm.cats.map((c) => `<div${c.grp ? ` class="cgs"` : ""}${c.p != null ? ` title="${esc(c.label)} projects to ${esc(String(c.pa))} to ${esc(String(c.pb))}"` : ""}><small>${esc(c.label)}</small><b class="${c.d > 0 ? "w" : ""}">${c.fa}</b><b class="${c.d < 0 ? "w" : ""}">${c.fb}</b>${c.p != null ? catChance(c, vm) : ""}</div>`).join("")}</div>` : "";
    // categories still in play: the ones neither side has better than a two in three chance of
    const swing = vm.cats && vm.cats.some((c) => c.p != null) ? vm.cats.filter((c) => c.p != null && c.p > 1 / 3 && c.p < 2 / 3) : null;
    const swingHtml = swing ? `<div class="cat-sw">${swing.length ? `<span>Still in play:</span>${swing.map((c) => `<b>${esc(c.label)}</b>`).join("")}` : `<span>Every category leans one way.</span>`}</div>` : "";
    return `<div class="versus">${side(vm.a, "a")}<div class="mid">${vm.status ? `<span class="pill${vm.live ? " live" : ""}">${esc(vm.status)}</span>` : ""}<span>vs</span></div>${side(vm.b, "b")}</div>${wp}${cats}${swingHtml}`;
  }
  // one category's odds for the first team: a small bar and its chance, with the projected finish on hover
  function catChance(c, vm) {
    const q = Math.round(c.p * 100), lean = c.p >= 2 / 3 ? "up" : c.p <= 1 / 3 ? "dn" : "mid";
    return `<span class="cch ${lean}" aria-label="${esc(vm.a.team.abbr)} has a ${q}% chance to win ${esc(c.label)}, projected ${esc(String(c.pa))} to ${esc(String(c.pb))}"><i><s style="width:${Math.max(4, q)}%"></s></i><em>${q}%</em></span>`;
  }
  // Side-by-side lineups. rows: [{ slot, a: { p, pts, proj, w }, b: { ... } }], totals: { a, b }
  function vsTable(sport, rows, totals, fmt = (x) => (x == null ? "-" : x.toFixed(1))) {
    const cell = (x) => (x && x.p ? `${x.pts != null ? fmt(x.pts) : ""}${x.proj != null ? `<small>${fmt(x.proj)} proj</small>` : ""}` : "");
    return `<div class="table-wrap"><table class="t vs"><tbody>${rows.map((r) => `<tr><td class="nm">${r.a.p ? `<span data-player="${esc(r.a.p.id)}" style="cursor:pointer">${pname(sport, r.a.p)}</span>${r.a.game ? `<div class="gmr">${r.a.game}</div>` : ""}` : `<span class="ps">Empty</span>`}</td><td class="pa ${r.a.w ? "w" : ""}">${cell(r.a)}</td><td class="sl"><span class="slot${r.slot === "CPT" ? " cpt" : ""}">${esc(r.slot)}</span></td><td class="pb ${r.b.w ? "w" : ""}">${cell(r.b)}</td><td class="nm">${r.b.p ? `<span data-player="${esc(r.b.p.id)}" style="cursor:pointer;display:flex;justify-content:flex-end">${pname(sport, r.b.p, "", { b: true })}</span>${r.b.game ? `<div class="gmr b">${r.b.game}</div>` : ""}` : `<span class="ps" style="float:right">Empty</span>`}</td></tr>`).join("")}
      ${totals ? `<tr class="tot"><td>Total</td><td class="pa">${fmt(totals.a)}</td><td class="sl"></td><td class="pb">${fmt(totals.b)}</td><td></td></tr>` : ""}</tbody></table></div>`;
  }
  // rows: [{ rank, team, w, l, t, pct, gb, pf, pa, streak, form, me, cut, href }], opts: { pfLabel, paLabel, fmt, compact, extra }
  function standingsTable(rows, opts = {}) {
    const fmt = opts.fmt || ((x) => x.toFixed(1));
    const cols = [
      { k: "rank", label: "#", cls: "r num", html: (r) => `<span class="ps">${r.rank}</span>` },
      { k: "team", label: "Team", td: "nm", html: (r) => `<a href="${esc(r.href || "#")}" style="color:inherit;text-decoration:none">${teamName(r.team, { you: r.me, owner: !opts.compact, badge: r.badge })}</a>` },
      { k: "rec", label: "W-L-T", cls: "r num", html: (r) => `<b>${r.w}-${r.l}${r.t ? "-" + r.t : ""}</b>` },
      { k: "pct", label: "Pct", cls: "r num", hide: "s", html: (r) => r.pct.toFixed(3).replace(/^0/, "") },
      { k: "gb", label: "GB", cls: "r num", hide: "s", html: (r) => (r.gb ? r.gb.toFixed(r.gb % 1 ? 1 : 0) : "-") },
      { k: "pf", label: opts.pfLabel || "PF", cls: "r num", html: (r) => fmt(r.pf) },
    ];
    if (!opts.compact) cols.push({ k: "pa", label: opts.paLabel || "PA", cls: "r num", hide: "s", html: (r) => fmt(r.pa) },
      { k: "streak", label: "Strk", cls: "r", hide: "s", html: (r) => `<span class="${/^W/.test(r.streak) ? "win" : /^L/.test(r.streak) ? "loss" : ""}" style="font-weight:800">${esc(r.streak || "-")}</span>` },
      { k: "form", label: "Last 5", cls: "", hide: "s", html: (r) => `<span class="form">${(r.form || []).slice(-5).map((x) => `<i class="${x}" title="${x}"></i>`).join("")}</span>` });
    if (opts.extra) cols.push(...opts.extra);
    return table({ cols, rows, cls: "stand", rowAttr: (r) => `class="${r.me ? "me " : ""}${r.cut ? "cut" : ""}"` });
  }
  // items: [{ when, team, with, badge, lines: [html], note }]
  function feed(items, empty = "No moves yet.") {
    if (!items.length) return `<p class="empty">${esc(empty)}</p>`;
    return `<ul class="feed">${items.map((x) => `<li>${teamAv(x.team, "md")}<div class="what"><div class="row"><b>${esc(x.team.name)}</b>${x.with ? `<span class="ps">and</span><b>${esc(x.with.name)}</b>` : ""}${x.badge ? ` ${x.badge}` : ""}</div>${x.lines.join("")}${x.note ? `<span class="ps">${x.note}</span>` : ""}</div><time>${esc(x.when)}</time></li>`).join("")}</ul>`;
  }
  const TXI = { add: ["+", "Added"], drop: ["&minus;", "Dropped"], trade: ["&#8644;", "Traded for"], waiver: ["W", "Claimed"] };
  const txLine = (sport, kind, p, extra = "") => `<div class="row"><span class="txi ${kind}" role="img" aria-label="${TXI[kind][1]}" title="${TXI[kind][1]}">${TXI[kind][0]}</span><span data-player="${esc(p.id)}" style="cursor:pointer;min-width:0">${pname(sport, p, extra, { size: "sm" })}</span></div>`;
  // vm: { id, status, statusLabel, from, to, give: [players], get, faab: [give, get], note, when, acts (html) }
  function tradeCard(sport, vm) {
    const side = (t, ps, faab, label) => `<div class="side"><h4>${teamAv(t, "sm")}${esc(label)}</h4>${ps.map((p) => p.pick ? pname(sport, p) : `<span data-player="${esc(p.id)}" style="cursor:pointer">${pname(sport, p, p.price != null ? esc(p.price) : p.$ ? money(p.$) : "")}</span>`).join("") || `<span class="ps">No players</span>`}${faab ? `<span><span class="tag gold">$${faab} FAAB</span></span>` : ""}</div>`;
    return `<div class="card" id="trade-${vm.id}"><div class="mod-h"><span class="status ${vm.status}">${esc(vm.statusLabel)}</span>${vm.sub ? `<span class="ps">${vm.sub}</span>` : ""}<span class="ps" style="margin-left:auto">${esc(vm.when || "")}</span></div>
      <div class="trade">${side(vm.from, vm.give, vm.faab && vm.faab[0], `${vm.from.name} sends`)}<span class="arrow" aria-hidden="true">&#8644;</span>${side(vm.to, vm.get, vm.faab && vm.faab[1], `${vm.to.name} sends`)}</div>
      ${vm.note ? `<p class="small" style="margin:0 16px 12px">&ldquo;${esc(vm.note)}&rdquo;</p>` : ""}${vm.acts ? `<div class="trade-foot">${vm.acts}</div>` : ""}</div>`;
  }

  /* The trade window: both rosters side by side, pick players and FAAB, see the value swing, send.
     opts: { sport, teams, me, other, roster(teamId) -> players, value(players, faab) -> number, faab(teamId) (omit to hide),
             roomFor(trade) -> drops needed, check(trade) -> { ok, why }, submit(trade) -> { ok, why },
             prefill: { give, get, faabGive, faabGet, note, lockGet (their side is fixed: a rival bid) }, title,
             values(trade) -> [send, get] to override value(), dark, empty (the prompt before anything is picked) }
     A roster item with pick: true is a draft pick ({ id, n, sub, price }) and renders as one. */
  function tradeWindow(opts) {
    const pf = opts.prefill || {};
    const st = { other: opts.other, give: new Set(pf.give || []), get: new Set(pf.get || []), pgive: new Set(pf.pickGive || []), pget: new Set(pf.pickGet || []), drops: new Set(), faabGive: pf.faabGive || 0, faabGet: pf.faabGet || 0, note: pf.note || "" };
    const sport = opts.sport;
    const me = opts.teams.find((t) => t.id === opts.me);
    const trade = () => ({ from: opts.me, to: st.other, give: [...st.give], get: [...st.get], pickGive: [...st.pgive], pickGet: [...st.pget], faabGive: st.faabGive, faabGet: st.faabGet, dropsFrom: [...st.drops], note: st.note, counterOf: pf.counterOf || null });
    const D = dialog(`<div class="tw"></div>`, null, { full: true, dark: opts.dark });
    const draw = (focus) => {
      const other = opts.teams.find((t) => t.id === st.other);
      const mine = opts.roster(opts.me), theirs = opts.roster(st.other).filter((p) => !pf.lockGet || st.get.has(p.id));
      const byId = Object.fromEntries(mine.concat(theirs).map((p) => [p.id, p]));
      // next season's draft picks (a dynasty), listed under each roster: { id, n, sub, $, pick: true }
      const myPicks = opts.picks ? opts.picks(opts.me) : [], theirPicks = (opts.picks ? opts.picks(st.other) : []).filter((k) => !pf.lockGet || st.pget.has(k.id));
      const pv = (list, set) => list.filter((k) => set.has(k.id)).reduce((a, k) => a + (k.$ || 0), 0);
      let [vg, vr] = opts.values ? opts.values(trade()) : [opts.value([...st.give].map((id) => byId[id]).filter(Boolean), st.faabGive), opts.value([...st.get].map((id) => byId[id]).filter(Boolean), st.faabGet)];
      vg += pv(myPicks, st.pgive); vr += pv(theirPicks, st.pget);
      const need = opts.roomFor ? opts.roomFor(trade()) : 0;
      for (const id of [...st.drops]) if (st.give.has(id)) st.drops.delete(id);
      const tot = vg + vr || 1, swing = (vr - vg) / tot;
      const vl = opts.valueLabel || money;
      const picked = st.give.size || st.get.size || st.pgive.size || st.pget.size;
      const verdict = !picked ? (opts.empty || "Pick players on either side") : Math.abs(swing) < 0.08 ? "About even" : swing > 0 ? (swing > 0.35 ? "Lopsided your way" : "Leans your way") : swing < -0.35 ? "Lopsided their way" : "Leans their way";
      const fixed = (kind) => pf.lockGet && (kind === "get" || kind === "pget");
      const list = (ps, set, kind) => ps.map((p) => `<label class="${set.has(p.id) ? "on" : ""}${kind === "drop" ? " drop" : ""}"><input type="checkbox" data-tw="${kind}" value="${esc(p.id)}"${set.has(p.id) ? " checked" : ""}${fixed(kind) ? " disabled" : ""}>${pname(sport, p, !p.pick && opts.note ? esc(opts.note(p) || "") : "")}<span class="dollar">${p.price != null ? esc(p.price) : p.$ ? money(p.$) : ""}</span></label>`).join("");
      const pickList = (ps, set, kind) => (ps.length ? `<div class="sec">Draft picks</div>${list(ps, set, kind)}` : "");
      const dropList = need > 0 ? `<div class="sec">Drop ${need} to make room</div>${list(mine.filter((p) => !st.give.has(p.id)), st.drops, "drop")}` : "";
      let chk = opts.check ? opts.check(trade()) : { ok: true };
      const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
      if (pf.counterOf && same([...st.give], pf.give || []) && same([...st.get], pf.get || []) && same([...st.pgive], pf.pickGive || []) && same([...st.pget], pf.pickGet || []) && st.faabGive === (pf.faabGive || 0) && st.faabGet === (pf.faabGet || 0)) chk = { ok: false, why: "Change something to counter, or accept their offer as it is" };
      const ready = chk.ok && picked && st.drops.size >= need;
      const scroll = $$(".tw-list", D).map((x) => x.scrollTop);
      $(".tw", D).innerHTML = `
        <div class="tw-h"><h3>${esc(opts.title || "Propose a trade")}</h3><label class="sr" for="tw-team">Trade with</label><select id="tw-team"${pf.lockGet ? " disabled" : ""}>${opts.teams.filter((t) => t.id !== opts.me).map((t) => `<option value="${t.id}"${t.id === st.other ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
        <div class="tw-b">
          <div class="tw-col"><div class="hd">${teamAv(me, "sm")}<b>You send</b><span class="ps">${st.give.size + st.pgive.size} selected</span></div><div class="tw-list">${list(mine, st.give, "give")}${pickList(myPicks, st.pgive, "pgive")}${dropList}</div></div>
          <div class="tw-col"><div class="hd">${teamAv(other, "sm")}<b>${esc(other.name)} sends</b><span class="ps">${st.get.size + st.pget.size} selected</span></div><div class="tw-list">${list(theirs, st.get, "get")}${pickList(theirPicks, st.pget, "pget")}</div></div>
        </div>
        <div class="tw-f">
          <div class="meter"><div class="meter-l"><span>You send ${vl(vg)}</span><span>${esc(verdict)}</span><span>You get ${vl(vr)}</span></div>
            <div class="meter-bar"><i style="${swing >= 0 ? `left:50%;width:${Math.min(50, swing * 50)}%;background:var(--win)` : `right:50%;width:${Math.min(50, -swing * 50)}%;background:var(--loss)`}"></i></div></div>
          ${opts.faab ? `<div class="tw-faab"><label>FAAB you send<span class="ni"><i>$</i><input type="number" min="0" max="${opts.faab(opts.me)}" data-tw="faabGive" value="${st.faabGive}" inputmode="numeric"></span><small>You have $${opts.faab(opts.me)}</small></label><label>FAAB you get<span class="ni"><i>$</i><input type="number" min="0" max="${opts.faab(st.other)}" data-tw="faabGet" value="${st.faabGet}" inputmode="numeric"></span><small>They have $${opts.faab(st.other)}</small></label></div>` : ""}
          <div class="tw-send"><label class="sr" for="tw-note">Note</label><input type="text" id="tw-note" data-tw="note" maxlength="140" placeholder="Add a note (optional)" value="${esc(st.note)}"><button type="button" class="btn" data-tw-cancel>Cancel</button><button type="button" class="btn go" data-tw-send${ready ? "" : " disabled"}>Send offer</button></div>
          ${picked && need > st.drops.size ? `<span class="why">Pick ${need - st.drops.size} more to drop, under your roster.</span>` : picked && !chk.ok ? `<span class="why">${esc(chk.why)}</span>` : picked && chk.note ? `<span class="ps ok">${esc(chk.note)}</span>` : ""}
        </div>`;
      $$(".tw-list", D).forEach((x, i) => (x.scrollTop = scroll[i] || 0));
      if (focus) { const f = $(`[data-tw=${focus}]`, D); if (f) { f.focus(); try { f.select(); } catch (e) { /* number */ } } }
    };
    D.oninput = (e) => {
      const k = e.target.dataset.tw;
      if (k === "note") { st.note = e.target.value; return; }
      if (k === "faabGive" || k === "faabGet") { st[k] = Math.max(0, Math.round(+e.target.value || 0)); draw(k); }
    };
    D.onchange = (e) => {
      const k = e.target.dataset.tw;
      if (e.target.id === "tw-team") { st.other = +e.target.value; st.get.clear(); st.pget.clear(); st.faabGet = 0; draw(); return; }
      const set = k === "give" ? st.give : k === "get" ? st.get : k === "pgive" ? st.pgive : k === "pget" ? st.pget : k === "drop" ? st.drops : null;
      if (!set || (pf.lockGet && (k === "get" || k === "pget"))) return;
      if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
      draw();
    };
    D.onclick = (e) => {
      if (e.target.closest("[data-tw-cancel]")) { D.close(); return; }
      if (!e.target.closest("[data-tw-send]")) return;
      const r = opts.submit(trade());
      if (r && r.ok === false) toast(r.why, true); else D.close();
    };
    draw();
  }

  /* ---------- draft room ---------- */
  /* FK.ui.room(opts) mounts a draft room into opts.el and returns { render, stop, ctx, refresh }.
       sport, players  an attached sport and its evaluated players
       draft()         the current draft document; save(D) runs after every change
       me()            your team id, or null to watch
       commish         true to show start, pause and undo
       drive           true if this page runs the clock (bots and autopicks)
       solo            true when nobody else is in the room (a mock): shows Sim to my pick and a bot speed control
       hooks           FK.draft hooks (a cap rule, a custom bot)
       brand           { name, mark } for the top bar; exit { href, label }; extra() html for the top bar when done */
  /* ---------- phone alerts: the control on Your leagues and in a league's dialog (cloud.push does the work) ---------- */
  // Fills el with this device's alert state and a button to change it. compact: one line, for a dialog.
  function pushBox(el, compact) {
    const C = FK.cloud;
    if (!el || !C || !C.push) return;
    const what = "Your turn in a slow draft, trade offers and answers, waiver results and each week's result";
    const paint = async () => {
      const st = await C.push.state();
      const line = { on: "Alerts are on for this device.", off: `Get a notification on this device: ${what.toLowerCase()}.`, blocked: "Notifications are blocked for this site. Allow them in your browser's settings to turn alerts on.",
        install: "On an iPhone or iPad, add Draft Lab to your home screen first (Share, then Add to Home Screen), then open it from there.", no: "This browser can't show alerts. Chrome, Edge, Firefox or Safari can." }[st];
      const btn = st === "on" ? `<button type="button" class="btn sm" data-push="off">Turn off</button>` : st === "off" ? `<button type="button" class="btn sm go" data-push="on">Turn on alerts</button>` : "";
      el.innerHTML = compact ? `<div class="push-row"><span class="grow"><b>Phone alerts</b> <span class="ps">${esc(line)}</span></span>${btn}</div>`
        : `<div class="card push-card"><div class="bd"><div class="push-row"><span class="push-ic" aria-hidden="true">&#128276;</span><span class="grow"><b>${st === "on" ? "Phone alerts are on" : "Phone alerts"}</b><small>${esc(line)}</small></span>${btn}</div></div></div>`;
    };
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-push]"); if (!b) return;
      b.disabled = true;
      try { if (b.dataset.push === "on") { await C.push.on(); toast("Alerts are on for this device."); } else { await C.push.off(); toast("Alerts are off for this device."); } }
      catch (err) { toast(err.message, true); }
      paint();
    });
    paint();
  }
  /* ---------- bot speed: how long a bot takes to pick in a mock, kept in this browser ---------- */
  // the order is the button's cycle: from Normal, one tap is Fast
  const BOT_SPEEDS = [["normal", "Normal", 1200], ["fast", "Fast", 400], ["slow", "Slow", 2500]];
  const botSpeed = {
    get() { let v = null; try { v = localStorage.getItem("fk-botspeed"); } catch (e) { /* private mode */ } return BOT_SPEEDS.find((x) => x[0] === v) || BOT_SPEEDS[0]; },
    set(k) { try { localStorage.setItem("fk-botspeed", k); } catch (e) { /* private mode */ } },
    delay() { return botSpeed.get()[2]; },
  };
  /* ---------- your own board: a ranking you set on the Rankings page, one per sport, kept in this browser ---------- */
  // { ids: [player ids in your order], tiers: [ids that end a tier] }. Players you haven't placed (new to the data, or
  // past the first 400) fall in at their default rank, so the board always covers everyone.
  const myBoard = {
    key: (sk) => `fk-board:${sk}`,
    saved(sk) { try { const v = JSON.parse(localStorage.getItem(myBoard.key(sk)) || "null"); return v && Array.isArray(v.ids) && v.ids.length ? v : null; } catch (e) { return null; } },
    of(sk, players) {
      const def = players.slice().sort((a, b) => a.rank - b.rank).map((p) => p.id), v = myBoard.saved(sk);
      if (!v) return { ids: def, tiers: [], custom: false };
      const have = new Set(def), seen = new Set(), ids = v.ids.filter((id) => have.has(id) && !seen.has(id) && seen.add(id));
      def.forEach((id, i) => { if (!seen.has(id)) { ids.splice(Math.min(ids.length, i), 0, id); seen.add(id); } });
      return { ids, tiers: (v.tiers || []).filter((id) => seen.has(id)), custom: true };
    },
    save(sk, b) {
      const v = { ids: b.ids.slice(0, 400), tiers: b.tiers || [], at: Date.now() };
      try { localStorage.setItem(myBoard.key(sk), JSON.stringify(v)); } catch (e) { /* private mode */ }
      myBoard.push(sk, v);
    },
    reset(sk) { try { localStorage.removeItem(myBoard.key(sk)); } catch (e) { /* private mode */ } myBoard.push(sk, null); },
    // signed in, the board also lives with the account, so it follows you to another device: each save goes up (a
    // second after the last change), and sync(sk) brings down a newer copy. Resolves true when the board here changed.
    cloud: () => { const C = typeof window !== "undefined" && window.FK && window.FK.cloud; return C && C.boards && C.user() ? C : null; },
    timers: {},
    push(sk, v) {
      const C = myBoard.cloud(); if (!C) return;
      clearTimeout(myBoard.timers[sk]);
      myBoard.timers[sk] = setTimeout(() => C.boards.save(sk, v).catch(() => null), 1000);
    },
    synced: {},
    sync(sk) {
      const C = myBoard.cloud(); if (!C) return Promise.resolve(false);
      // once per page: a second caller gets false, so a redraw on change can't loop
      if (myBoard.synced[sk]) return myBoard.synced[sk].then(() => false);
      return (myBoard.synced[sk] = C.boards.get(sk).then((remote) => {
        const local = myBoard.saved(sk);
        if (remote && Array.isArray(remote.ids) && remote.ids.length && (!local || (remote.at || 0) > (local.at || 0))) {
          try { localStorage.setItem(myBoard.key(sk), JSON.stringify(remote)); } catch (e) { /* private mode */ }
          return true;
        }
        if (local && (!remote || (local.at || 0) > (remote.at || 0))) C.boards.save(sk, local).catch(() => null);
        return false;
      }).catch(() => { myBoard.synced[sk] = null; return false; }));
    },
    // { id: { n: 1-based place, tier: 1-based tier } }
    places(b) { const out = {}; let tier = 1; const ends = new Set(b.tiers); b.ids.forEach((id, i) => { out[id] = { n: i + 1, tier }; if (ends.has(id)) tier++; }); return out; },
  };

  /* ---------- draft alerts: a chime, a flashing tab and a desktop notification when you're up ---------- */
  // On by default (sound needs one click on the page first, which every browser asks for). The desktop notification
  // only shows while the tab is in the background, and only once the browser has allowed it.
  const alerts = (() => {
    const KEY = "fk-alerts";
    let ac = null, base = null, flashT = null, pending = null;
    const on = () => { try { return localStorage.getItem(KEY) !== "0"; } catch (e) { return true; } };
    const unlock = () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === "suspended") return ac.resume(); return Promise.resolve(); } catch (e) { return Promise.reject(e); } };
    const ready = () => !!ac && ac.state === "running";
    async function test() { try { await unlock(); chime("clock"); return ready(); } catch (e) { return false; } }
    function chime(kind) {
      if (!on()) return;
      if (!ready()) { pending = kind; return; }
      pending = null;
      try {
        const t0 = ac.currentTime + 0.02, notes = kind === "deck" ? [587] : [659, 880];
        notes.forEach((f, i) => {
          const o = ac.createOscillator(), g = ac.createGain(), t = t0 + i * 0.17;
          o.type = "sine"; o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(kind === "deck" ? 0.08 : 0.16, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
          o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.45);
        });
      } catch (e) { /* no audio */ }
    }
    function stop() { pending = null; if (flashT) { clearInterval(flashT); flashT = null; if (base != null) document.title = base; base = null; } }
    function flash(text) {
      stop();
      if (!on() || !document.hidden) return;
      base = document.title; let k = 0;
      flashT = setInterval(() => { document.title = k++ % 2 ? base : text; }, 1000);
    }
    function notify(title, body) {
      if (!on() || !document.hidden || typeof Notification === "undefined" || Notification.permission !== "granted") return;
      try { const n = new Notification(title, { body, tag: "fk-draft" }); n.onclick = () => { window.focus(); n.close(); }; } catch (e) { /* not allowed here */ }
    }
    async function set(v) {
      try { localStorage.setItem(KEY, v ? "1" : "0"); } catch (e) { /* private mode */ }
      if (!v) { stop(); return; }
      try { await unlock(); } catch (e) { /* unsupported */ }
      if (typeof Notification !== "undefined" && Notification.permission === "default") { try { await Notification.requestPermission(); } catch (e) { /* declined */ } }
      chime("deck");
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => { if (!document.hidden) stop(); });
      document.addEventListener("pointerdown", () => { unlock().then(() => { if (pending) chime(pending); }).catch(() => {}); }, { capture: true });
      document.addEventListener("keydown", () => { unlock().then(() => { if (pending) chime(pending); }).catch(() => {}); }, { capture: true });
    }
    return { on, set, chime, flash, stop, notify, test, ready };
  })();

  function room(opts) {
    const { el, sport } = opts;
    // baseball opens on hitters, so the pool shows stat columns to sort by (all players have no shared stats)
    const ui = { left: "players", right: "team", sort: { k: "rank", dir: 1 }, f: { q: "", pos: sport.groups ? "g:bat" : "" }, show: "avail", view: null, bidAmt: null, mobileRight: false };
    // a dynasty's rookie draft opens on the rookies
    try { if (opts.draft().rookie && (opts.players || []).some((p) => p.rk)) ui.f.pos = "rk"; } catch (e) { /* no draft yet */ }
    let ctx = null, timer = null;
    const D = () => opts.draft();
    const me = () => (opts.me ? opts.me() : null);
    const now = () => (opts.now ? opts.now() : Date.now());
    const refresh = () => { ctx = F.context(D(), opts.players, sport, opts.hooks); return ctx; };
    refresh();
    const save = () => { opts.save(D()); refresh(); };
    const team = (id) => D().teams[id];
    const isMe = (t) => me() != null && t && t.id === me();
    const auction = () => D().type === "auction";
    const mystery = () => D().type === "mystery";
    const pts = () => isPoints(sport, D().scoring);
    const canTrade = () => { const d = D(); return d.trading && me() != null && d.phase !== "done"; };
    // a pick's short label for the ticker and board: 2.5 in a snake, #15 in mystery packages
    const plab = (k) => (mystery() ? `#${k + 1}` : F.pickLabel(D(), k));
    const elephant = () => !!D().steals;
    const stealOk = (pid) => { const d = D(); return elephant() && me() != null && d.phase === "live" && F.canSteal(d, ctx, me(), pid, now()); };
    const seenK = (k) => F.seen(D(), k, me());
    const bankFull = () => { const d = D(); return d.bank ? d.bank.perRound * d.rounds * 1000 : 0; };
    // what a team's leftover bank is worth at the end, on a league budget of $100
    const bankFaab = (t) => money(100 * (0.5 + Math.max(0, Math.min(1, t.bank / bankFull()))));
    function bankChips() {
      const d = D(), c = d.phase === "live" ? F.onClock(d, now()) : null;
      return d.round1.map((id) => { const t = team(id); return `<span class="${isMe(t) ? "me" : ""}${c && c.team === id ? " lead" : ""}" title="${esc(t.name)}: ${fmtLeft(t.bank)} left in the bank, worth ${bankFaab(t)} of FAAB now">${teamAv(t, "sm")}${fmtLeft(t.bank)} <span class="ps">${bankFaab(t)}</span></span>`; }).join("");
    }
    const viaOf = (k) => { const v = D().via[k]; return v != null ? team(v) : null; };
    // the board spots that belong to a team: picks it made or holds, in pick order (traded players move with theirs)
    const slotsOf = (id) => { const d = D(); return d.order.map((t, k) => ((d.board[k] ? d.board[k].team === id && !d.board[k].gone : t === id) ? k : -1)).filter((k) => k >= 0); };
    const pickVM = (k) => { const d = D(), v = viaOf(k); return { id: F.pickId(k), k, pick: true, n: mystery() ? `Pick ${k + 1}` : `Pick ${plab(k)}`, sub: `${ord(k + 1)} overall, about ${money(F.pickValue(d, ctx, k))}${v ? `, via ${v.abbr}` : ""}`, price: money(F.pickValue(d, ctx, k)) }; };
    // a pick you can't see yet (mystery packages, reveal "own") trades blind, valued at the average pick still to come
    const avgPick = () => { const d = D(), ks = d.order.map((t, k) => k).filter((k) => !d.board[k]); return ks.length ? ks.reduce((a, k) => a + F.pickValue(d, ctx, k), 0) / ks.length : 0; };
    const sealedVM = (k) => ({ id: F.pickId(k), k, pick: true, sealed: true, n: "Sealed pick", sub: "Somewhere later in the draft", price: "?" });
    const assetVM = (id) => (F.isPickId(id) ? (seenK(F.pickIdx(id)) ? pickVM(F.pickIdx(id)) : sealedVM(F.pickIdx(id))) : ctx.byId[id]);
    const valueOf = (id) => (F.isPickId(id) && !seenK(F.pickIdx(id)) ? avgPick() : F.assetValue(D(), ctx, id));

    /* the top bar: league, who's up and the clock, controls */
    function top() {
      const d = D(), n = now();
      const brand = opts.brand || {};
      const lg = `<a class="lg" href="${esc((opts.exit && opts.exit.href) || "#")}">${brand.mark || ""}<span><h1 class="lg-h">${esc(d.name || brand.name || "Draft")}</h1><small>${esc(F.FORMATS[d.type])}, ${d.teams.length} teams, ${d.rounds} rounds</small></span></a>`;
      // Up front: what you do mid-draft (start, sim, trade, autodraft). Beside them on a wide screen, the league's own
      // tools and Exit; on a phone those fold into More. Settings (sound, bot speed, pause, undo) always live in More.
      const prim = [], side = [], menu = [];
      if (opts.commish && d.phase === "setup") prim.push(`<button class="btn sm go" data-act="start">Start the draft</button>`);
      if (opts.commish && d.phase === "live" && d.paused && !d.hold) prim.push(`<button class="btn sm go" data-act="pause">Resume</button>`);
      // a draft on your own (a mock, a practice draft): pause sits right in the bar, not tucked in More
      else if (opts.solo && opts.commish && d.phase === "live" && !d.paused) prim.push(`<button class="btn sm" data-act="pause">Pause</button>`);
      if (opts.solo && (d.phase === "live" || d.phase === "setup") && !auction() && !d.packs && me() != null) {
        const oc = d.phase === "live" && !d.paused ? F.onClock(d, n) : null, auto = team(me()).auto;
        if (oc && (oc.team !== me() || auto) && (auto || F.nextPickOf(d, me()) != null)) prim.push(`<button class="btn sm go" data-act="sim">${auto ? "Sim to the end" : "Sim to my pick"}</button>`);
        const bs = BOT_SPEEDS.find((x) => x[2] === d.botDelay) || botSpeed.get();
        menu.push(`<button class="btn sm" data-act="botspeed" title="How long each bot takes to pick">Bot speed: ${bs[1]}</button>`);
      }
      if (canTrade() && d.phase === "live") prim.push(`<button class="btn sm" data-act="trade">Trade</button>`);
      if (me() != null && d.phase !== "done") {
        prim.push(`<button class="btn sm${team(me()).auto ? " on" : ""}" data-act="auto" aria-pressed="${!!team(me()).auto}" title="Let the bot draft for you">${team(me()).auto ? "Autodraft on" : "Autodraft"}</button>`);
        menu.push(`<button class="btn sm" data-act="alerts" title="A chime, and a notification while this tab is in the background, when you're up">${alerts.on() ? "Sound: on" : "Sound: off"}</button>`, `<button class="btn sm" data-act="test-sound">Test sound</button>`);
      }
      if (opts.commish && d.phase === "live") menu.push(`${d.paused && !d.hold ? "" : `<button class="btn sm" data-act="pause">${d.paused ? "Resume" : "Pause the draft"}</button>`}<button class="btn sm" data-act="undo">Undo the last pick</button>`);
      if (d.phase === "done" && opts.extra) prim.push(opts.extra());
      if (opts.tools) side.push(opts.tools());
      if (opts.exit) side.push(`<a class="btn sm ghost" href="${esc(opts.exit.href)}">${esc(opts.exit.label || "Exit")}</a>`);
      const more = menu.length || side.length ? `<details class="dr-more"><summary class="btn sm ghost" aria-label="More draft settings">More</summary><div class="menu">${side.length ? `<div class="dr-mo">${side.join("")}</div>` : ""}${menu.join("")}</div></details>` : "";
      const ctl = prim.concat(side.length ? [`<span class="dr-sec">${side.join("")}</span>`] : [], more ? [more] : []);
      let mid = "";
      if (d.phase === "heist") mid = `<div class="otc me"><span class="ring" id="fk-ring"><span id="fk-timer"></span></span><span class="who"><small>The draft is done</small><b>The heist</b><span>Shield yours, strike at theirs</span></span></div>`;
      else if (d.phase === "setup" && d.startAt) mid = `<div class="otc"><span class="ring" style="--p:1"><span id="fk-startin" data-at="${d.startAt}">${esc(startIn(d.startAt))}</span></span><span class="who"><small>The draft starts</small><b>${esc(new Date(d.startAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }))}</b><span>On its own. Set your queue: if you're not here, your picks come from it.</span></span></div>`;
      else if (d.phase === "setup") mid = `<div class="otc"><span class="ring" style="--p:1"><span>${d.bank ? fmtLeft(bankFull()) : d.clock || d.auction ? (auction() ? d.auction.bidClock : d.clock) : "-"}</span></span><span class="who"><small>Draft room is open</small><b>${mystery() && !seenK(0) ? "Packages are sealed" : "Build your queue"}</b><span>${auction() ? `$${d.auction.budget} budgets, ${d.auction.bidClock} seconds a bid` : d.bank ? `${fmtLeft(bankFull())} bank each. What's left becomes FAAB` : d.clock ? `${d.clock} seconds a pick` : "No pick clock"}</span></span></div>`;
      else if (d.phase === "done") mid = `<div class="otc"><span class="who"><small>Draft complete</small><b>${F.made(d).length} ${auction() ? "players bought" : "picks"}</b><span>See the Results tab</span></span></div>`;
      else if (auction()) {
        const st = F.auctionState(d, n);
        // the high bidder shows once, by the bid itself; up here is who's on the block
        const t = st.kind === "lot" ? team(st.lot.team) : team(st.team), lp = st.kind === "lot" ? ctx.byId[st.lot.pid] : null;
        mid = `<div class="otc${isMe(t) && st.kind === "nominate" ? " me" : ""}">${lp ? playerAv(sport, lp, "md") : teamAv(t, "md")}<span class="who"><small>${st.kind === "lot" ? "On the block" : isMe(t) ? "Your nomination" : "Nominating"}</small><b>${esc(lp ? lp.n : t.name)}</b><span>${d.sales.length} of ${d.teams.length * d.rounds} bought${d.paused ? ", paused" : ""}</span></span><span class="ring" id="fk-ring"><span id="fk-timer"></span></span></div>`;
      } else if (d.packs) {
        // a pack draft: everyone picks from the pack in front of them at once, on one clock
        const tt = F.packTurnNow(d), at = F.packAt(d, tt), mineUp = me() != null && F.packSlot(d, me()) >= 0;
        const waiting = d.round1.filter((id) => F.packSlot(d, id) >= 0).length;
        mid = `<div class="otc${mineUp ? " me" : ""}"><span class="ring" id="fk-ring"><span id="fk-timer"></span></span><span class="who"><small>Pack ${at.q + 1} of ${at.sets}, pick ${at.j + 1} of ${at.size}</small><b>${mineUp ? "Your pick" : me() != null ? "Picked" : "Everyone picks"}</b><span>${waiting ? `${waiting} still picking` : "Passing the packs"}, then they go ${at.q % 2 === 0 ? "left" : "right"}</span></span></div>`;
      } else if (F.onClock(d, n).trivia) {
        // a trivia draft: the team on the clock answers first
        const c = F.onClock(d, n), t = team(c.team), mine = isMe(t);
        mid = `<div class="otc${mine ? " me" : ""}">${teamAv(t, "md")}<span class="who"><small>${mine ? "Answer to pick" : "Trivia, then the pick"}</small><b>${esc(mine ? "Your question" : t.name)}</b><span>${mine ? "Miss it and your pick moves to the end of the round" : `Answering for pick ${plab(c.index)}`}</span></span><span class="ring" id="fk-ring" title="Time left to answer"><span id="fk-timer"></span></span></div>`;
      } else {
        const c = F.onClock(d, n), t = team(c.team), mine = isMe(t);
        const next = me() != null ? F.nextPickOf(d, me()) : null;

        mid = `<div class="otc${mine ? " me" : ""}">${teamAv(t, "md")}<span class="who"><small>${mine ? (c.makeup ? "You were robbed. Pick again" : "You're on the clock") : c.makeup ? "Make-up pick" : "On the clock"}</small><b>${esc(t.name)}</b><span>${c.makeup ? `Make-up pick: ${esc(team(c.makeup.from).abbr)} stole ${esc((ctx.byId[c.makeup.forbid] || {}).n || "a player")}` : mystery() ? `Pick ${c.pick} of ${c.total}` : `Round ${c.round}, pick ${c.inRound} (${ord(c.pick)} overall)`}${elephant() && mine ? (F.stealsOpen(d, c.index) ? `. ${F.stealsLeft(d, me())} steal${F.stealsLeft(d, me()) === 1 ? "" : "s"} left` : ". Steals are over") : ""}${viaOf(c.index) ? `, from ${isMe(viaOf(c.index)) ? "you" : esc(viaOf(c.index).name)}` : ""}${!mine && next ? `. You pick in ${next - c.pick}` : ""}${d.paused ? (d.hold ? `. Stopped while ${isMe(team(d.hold.team)) ? "you look" : `${esc(team(d.hold.team).name)} looks`} at a trade offer` : ", paused") : ""}${d.bank && t.bank <= 0 ? `. Bank empty: ${d.bank.floor} seconds a pick` : ""}</span></span><span class="ring" id="fk-ring" title="${d.bank ? "Time left in the bank" : "Time left on the pick"}"><span id="fk-timer"></span></span></div>`;
      }
      return `<div class="dr-top">${lg}${mid}${wheelHtml()}<div class="acts">${ctl.join("")}</div></div>`;
    }
    /* ---------- the heist: shield yours, strike at theirs ---------- */
    const hsel = () => (ui.hs = ui.hs || { shield: [], steal: [], jinx: [] });
    function heistView() {
      const d = D(), R = F.heistRules(d), mine = me(), foe = mine != null ? F.heistFoe(d, mine) : null, sel = hsel();
      const wk = (p) => (p ? (p.v || 0) / 17 : 0), fm = (x) => (Math.round(x * 10) / 10).toFixed(1);
      const status = d.heist.pairs.flat().map((t) => `<span class="${F.heistIn(d, t) ? "ok" : ""}">${teamAv(team(t), "sm")}${esc(team(t).abbr)} ${F.heistIn(d, t) ? "locked in" : "deciding"}</span>`).join("");
      const rules = `Shield up to ${R.shields} of yours. Steal ${R.steals} and jinx ${R.jinxes} of theirs. A strike at a shielded player fails. A stolen player scores ${R.steal}x for you in the same spot, and your player there is let go; a jinxed one scores half for them.`;
      if (mine == null || foe == null) return `<div class="hz"><div class="hz-h"><h2 class="disp">The heist</h2><p>${mine == null ? "Managers are making their moves." : "You have no opponent this week, so you sit this one out."} ${esc(rules)}</p></div><div class="hz-st">${status}</div></div>`;
      // a sealed league keeps your moves on the server; this page remembers what you sent, or asks for it
      const dm = d.heist.moves[mine];
      if (dm && dm.sealed && !ui.hzMine && opts.heist && !ui.hzAsked) { ui.hzAsked = true; opts.heist.get().then((r) => { if (r && r.mine) { ui.hzMine = r.mine; render(); } }, () => {}); }
      const done = dm && dm.sealed ? ui.hzMine || { shield: [], steal: [], jinx: [] } : dm;
      const a = F.heistLineup(d, ctx, mine), b = F.heistLineup(d, ctx, foe);
      const row = (slot, id, side, i) => {
        const p = id && ctx.byId[id];
        if (!p) return `<li><span class="slot">${esc(slot)}</span><span class="ps">Empty</span></li>`;
        const on = (k) => (done ? done[k] : sel[k]).includes(id);
        let btns = "";
        if (side === "me") btns = `<button type="button" class="hz-b sh${on("shield") ? " on" : ""}" data-hz="shield" data-pid="${esc(id)}" aria-pressed="${on("shield")}"${done ? " disabled" : ""}>Shield</button>`;
        else {
          const gain = R.steal * wk(p) - wk(a[i] && ctx.byId[a[i]]);
          btns = `<button type="button" class="hz-b st${on("steal") ? " on" : ""}" data-hz="steal" data-pid="${esc(id)}" aria-pressed="${on("steal")}"${done ? " disabled" : ""} title="Steal him: he plays ${R.steal}x for you at ${esc(slot)}">Steal <small>${gain >= 0 ? "+" : ""}${fm(gain)}</small></button><button type="button" class="hz-b jx${on("jinx") ? " on" : ""}" data-hz="jinx" data-pid="${esc(id)}" aria-pressed="${on("jinx")}"${done ? " disabled" : ""} title="Jinx him: he scores half for them">Jinx</button>`;
        }
        return `<li class="${on("shield") ? "sh" : ""}${on("steal") ? " st" : ""}${on("jinx") ? " jx" : ""}"><span class="slot">${esc(slot)}</span><span data-player="${esc(id)}" class="hz-p">${pname(sport, p, `about ${fm(wk(p))} a week`)}</span><span class="hz-a">${btns}</span></li>`;
      };
      const count = (k, n) => `<span class="hz-c${(done ? done[k] : sel[k]).length === n ? " full" : ""}"><b>${(done ? done[k] : sel[k]).length}</b> of ${n} ${k === "shield" ? "shields" : k === "steal" ? (n === 1 ? "steal" : "steals") : n === 1 ? "jinx" : "jinxes"}</span>`;
      return `<div class="hz"><div class="hz-h"><h2 class="disp">The heist</h2><p>${esc(rules)}</p></div>
        <div class="hz-cols">
          <section class="hz-col"><div class="hz-t">${teamAv(team(mine), "sm")}<b>Your lineup</b>${count("shield", R.shields)}</div><ul class="hz-l">${d.lineup.map((sl, i) => row(sl, a[i], "me", i)).join("")}</ul></section>
          <section class="hz-col"><div class="hz-t">${teamAv(team(foe), "sm")}<b>${esc(team(foe).name)}</b>${count("steal", R.steals)}${count("jinx", R.jinxes)}</div><ul class="hz-l">${d.lineup.map((sl, i) => row(sl, b[i], "foe", i)).join("")}</ul></section>
        </div>
        <div class="hz-go">${done ? `<b>Locked in.</b><span class="ps">Everything is revealed once both of you are in, or when the clock runs out.</span>` : `<span class="ps">Moves you don't make: your best starters get your shields, and you strike at no one.</span><span class="grow"></span><button class="btn go" data-act="heistgo">Lock in</button>`}</div>
        <div class="hz-st">${status}</div></div>`;
    }
    function heistPick(k, pid) {
      const d = D(), R = F.heistRules(d), sel = hsel(), cap = { shield: R.shields, steal: R.steals, jinx: R.jinxes }[k];
      const list = sel[k], i = list.indexOf(pid);
      if (i >= 0) list.splice(i, 1);
      else {
        // a player is stolen or jinxed, not both: picking one clears the other
        for (const o of ["steal", "jinx"]) if (o !== k && k !== "shield") { const j = sel[o].indexOf(pid); if (j >= 0) sel[o].splice(j, 1); }
        if (list.length >= cap) list.shift();
        list.push(pid);
      }
      render();
    }
    // team roulette: a football team's full name is its defense's; elsewhere the abbreviation does
    let fullNames = null;
    const teamFull = (t) => { if (!fullNames) { fullNames = {}; for (const p of opts.players) if (S.positions(p).includes("DEF") && p.t) fullNames[p.t] = p.n; } return fullNames[t] || t; };
    const spinNow = () => { const d = D(); if (!d.roulette || d.phase !== "live" || auction()) return null; const c = F.onClock(d, now()); return c ? { c, t: F.wheelFor(d, ctx, c.team) } : null; };
    // the pro team the pick on the clock has to come from, and a re-spin for the manager who's up
    function wheelHtml() {
      const d = D();
      if (!d.roulette || auction()) return "";
      if (d.phase === "setup") return `<div class="rl-now"><span class="rl-w" aria-hidden="true"></span><span class="rl-t"><small>Team roulette</small><b>${d.roulette.each === "round" ? "Each round" : "Each pick"}, the wheel picks the team</b></span><span class="ps">${d.roulette.respins ? `${d.roulette.respins} re-spin${d.roulette.respins > 1 ? "s" : ""} a team` : "No re-spins"}</span></div>`;
      const sn = spinNow();
      if (!sn || !sn.t) return "";
      const mine = isMe(team(sn.c.team)), left = mine ? F.respinsLeft(d, me()) : 0;
      return `<div class="rl-now${mine ? " me" : ""}"><span class="rl-w" aria-hidden="true"></span><span class="rl-t"><small>${mine ? "You have to take a player from" : `${esc(team(sn.c.team).abbr)} has to take a player from`}</small><b>${proTeam(sport, sn.t)} ${esc(teamFull(sn.t))}</b></span>${mine && left ? `<button class="btn sm" data-act="respin">Re-spin <span class="ps">${left} left</span></button>` : ""}</div>`;
    }
    // The pick ticker: the last few picks, the pick on the clock, and who's up next.
    function ticker() {
      const d = D(), n = d.teams.length;
      if (auction()) return lotBar();
      const k0 = d.phase === "live" ? F.onClock(d, now()).index : d.phase === "done" ? d.order.length : 0;
      if (mystery() && d.phase === "setup" && !seenK(0)) return `<div class="ticker" id="fk-ticker" tabindex="0" aria-label="Picks"><div class="tk hid wide"><span class="n">${d.order.length} picks</span><b>Every package is dealt and sealed</b><small>They add up within ${(d.mystery.spread * 100).toFixed(1)}% of each other. You'll see them when the draft starts.</small></div></div>`;
      const from = Math.max(0, k0 - 6), to = Math.min(d.order.length, from + 22);
      const cards = [];
      for (let k = from; k < to; k++) {
        const pk = d.board[k], t = team(d.order[k]), lab = plab(k);
        const p = pk && pk.pid && ctx.byId[pk.pid], via = viaOf(k);
        if (!seenK(k)) { cards.push(`<div class="tk hid"><span class="n">${lab}</span><b>Sealed</b><small>${d.phase === "live" && k > k0 ? `${k - k0} away` : "Revealed at the start"}</small></div>`); continue; }
        if (p) cards.push(`<button type="button" class="tk done c${colorOf(sport, p)}${isMe(t) ? " me" : ""}${pk.steal ? " steal" : ""}${pk.gone ? " gone" : ""}" data-player="${esc(p.id)}"><span class="n">${lab} ${esc(t.abbr)}</span><b>${esc(p.n)}</b><small>${pk.steal ? `Stolen from ${esc(team(pk.from).abbr)}` : pk.gone ? "Later stolen" : `${S.positions(p).join(", ")} ${esc(p.t)}`}</small></button>`);
        else { const sp = d.roulette && !auction() ? (k === k0 && d.phase === "live" ? F.wheelFor(d, ctx, d.order[k]) : F.spinOf(d, k)) : null;
          // a pack draft's turn has everyone picking at once
          const packNow = d.packs && d.phase === "live" && Math.floor(k / n) === Math.floor(k0 / n);
          cards.push(`<div class="tk${(k === k0 || packNow) && d.phase === "live" ? " now" : ""}${isMe(t) ? " me" : ""}"><span class="n">${teamAv(t, "sm")} ${lab}</span><b>${isMe(t) ? "You" : esc(t.name)}</b><small>${sp ? `${proTeam(sport, sp)} ` : ""}${d.phase === "setup" ? (k === 0 ? "Up first" : `Pick ${k + 1}`) : packNow ? "Picking" : k === k0 && d.phase === "live" ? "On the clock" : d.packs && k > k0 ? `Pack turn ${Math.floor(k / n) + 1}` : k > k0 ? `${k - k0} away` : "Passed"}${via ? `, via ${esc(via.abbr)}` : ""}</small></div>`); }
      }
      const tk = `<div class="ticker" id="fk-ticker" tabindex="0" aria-label="Picks">${cards.join("")}</div>`;
      return d.bank ? `<div>${tk}<div class="budgets bank" aria-label="Time banks">${bankChips()}</div></div>` : tk;
    }
    function lotBar() {
      const d = D(), n = now();
      if (d.phase !== "live") return `<div><div class="budgets">${budgetChips()}</div></div>`;
      const st = F.auctionState(d, n);
      const mine = me() != null;
      if (st.kind === "nominate") {
        const t = team(st.team);
        return `<div><div class="lot">${teamAv(t, "lg")}<div class="lotp"><b class="disp">${isMe(t) ? "Your nomination" : esc(t.name) + " is nominating"}</b><span class="ps">${isMe(t) ? "Pick a player below and set an opening bid. Your queue nominates for you if time runs out." : "The next player goes up in a moment."}</span></div><span></span><span></span><span></span></div><div class="budgets">${budgetChips()}</div></div>`;
      }
      const lot = st.lot, p = ctx.byId[lot.pid], lead = team(lot.team);
      const can = mine && !isMe(lead) && F.maxBid(d, me()) > lot.bid && F.canAdd(d, ctx, me(), p).ok && !d.paused;
      if (ui.bidLot !== lot.pid) { ui.bidAmt = null; ui.bidLot = lot.pid; }
      const next = lot.bid + 1, max = mine ? F.maxBid(d, me()) : 0;
      const passed = mine && (lot.passed || []).includes(me());
      return `<div><div class="lot">${playerAv(sport, p, "lg")}<div class="lotp"><b class="disp">${esc(p.n)}</b><span class="ps">${posChips(sport, p)} ${proTeam(sport, p.t)}, ${esc(p.prank)}, value ${money(p.$)}. Nominated by ${esc(team(lot.by).name)}</span></div>
        <div class="bid"><small>${teamAv(lead, "sm")} ${isMe(lead) ? "Your bid" : esc(lead.abbr)}</small><b class="${isMe(lead) ? "win" : ""}">${money(lot.bid)}</b></div>
        <div class="acts"><span class="bid-limit">${mine ? `Max bid ${money(max)} · ${F.spotsLeft(d, me())} spots left` : ""}</span>${can ? (() => { const v = ui.bidAmt && ui.bidAmt > lot.bid ? Math.min(max, ui.bidAmt) : next; return `<span class="bid-q">${[1, 5, 10].filter((x) => lot.bid + x <= max).map((x) => `<button type="button" class="btn sm" data-bid="${lot.bid + x}" data-lot="${esc(lot.pid)}" aria-label="Bid ${money(lot.bid + x)} now">Bid ${money(lot.bid + x)}</button>`).join("")}</span><label class="sr" for="fk-bid">Your bid</label><input type="number" inputmode="numeric" step="1" id="fk-bid" min="${next}" max="${max}" value="${v}"><button class="btn go" data-act="bid" data-lot="${esc(lot.pid)}">Bid <span id="fk-bidv">${money(v)}</span></button>${passed ? `<span class="ps">You passed</span>` : `<button class="btn ghost" data-act="pass">Pass</button>`}`; })()
          : mine ? `<span class="ps">${isMe(lead) ? "You have the high bid." : max <= lot.bid ? `Your max bid is ${money(max)}.` : esc(F.canAdd(d, ctx, me(), p).why || "")}</span>` : ""}</div></div>
        <div class="budgets">${budgetChips()}</div></div>`;
    }
    function budgetChips() {
      const d = D(), lot = d.auction.lot;
      // each team's money; its max bid only when it can't top the bid on the block
      return d.round1.map((id) => { const t = team(id), mx = F.maxBid(d, id), out = lot && lot.team !== id && mx <= lot.bid; return `<span class="${isMe(t) ? "me" : ""}${lot && lot.team === id ? " lead" : ""}${out ? " out" : ""}" title="${esc(t.name)}: ${F.spotsLeft(d, id)} spots left, max bid ${money(mx)}">${teamAv(t, "sm")}<b>${esc(t.abbr)}</b> ${money(t.budget)}${out ? ` <span class="ps">can't top it</span>` : ""}</span>`; }).join("");
    }

    /* ---------- a pack draft: the sealed pack, the rip, the cards ---------- */
    const packKey = (q) => `fk-pack:${D().seed}:${q}`;
    function packOpened(q) {
      if ((ui.opened || {})[q]) return true;
      try { return !!sessionStorage.getItem(packKey(q)); } catch (e) { return false; }
    }
    // the pack in front of a team: who opened it, and who passed it on
    function packWhere(d, teamId) {
      const n = d.round1.length, seat = d.round1.indexOf(teamId), { q, j } = F.packAt(d, F.packTurnNow(d)), dir = q % 2 === 0 ? 1 : -1;
      const at = (k) => d.round1[(((seat - dir * k) % n) + n) % n];
      return { opener: at(j), from: at(1) };
    }
    const TIER = { chase: "Chase", star: "Star", rare: "Rare" };
    function packSealed(pat, pk) {
      return `<div class="pkd-seal"><button type="button" class="pkd-foil" data-act="rip" aria-label="Open pack ${pat.q + 1}"><span class="pkd-fm">${opts.brand && opts.brand.mark ? opts.brand.mark : ""}</span><b>Pack ${pat.q + 1}</b><small>${pk.length} cards</small><i aria-hidden="true"></i></button>
        <div class="pkd-sx"><h3 class="disp">Your pack is sealed</h3><p>${D().packs.price ? `Every pack has a star and one mystery card. Every card has a price, and you have $${D().packs.budget} for the whole draft, so the star isn't always the pick.` : "Every pack has a star. A few hold a chase card."} The cards turn over from the bottom up, so the best one comes last.</p><button type="button" class="btn go" data-act="rip">Open the pack</button></div></div>`;
    }
    function packGrid(rows, pat, myTurn, mine) {
      const d = D(), tier = d.packs.tier || {};
      const ripping = ui.rip && ui.rip.q === pat.q && Date.now() - ui.rip.at < 900 + rows.length * 380;
      const since = ripping ? Date.now() - ui.rip.at : 0;
      // the flip order: worst first, the hit last
      // a mystery card flips first and sits last, so neither gives away where he ranks
      const isM = (p) => !!(d.packs.mystery && d.packs.mystery[p.id]);
      const order = rows.filter(isM).concat(rows.filter((p) => !isM(p)).sort((a, b) => (b.rank || 1e5) - (a.rank || 1e5))).map((p) => p.id);
      const list = rows.filter((p) => !isM(p)).sort((a, b) => (a.rank || 1e5) - (b.rank || 1e5)).concat(rows.filter(isM));
      return `<div class="pkd-grid${ripping ? " rip" : ""}" role="list">${list.map((p) => {
        const t = tier[p.id] || "base", can = F.canAdd(d, ctx, mine, p), ok = can.ok, i = order.indexOf(p.id);
        const price = d.packs.price ? d.packs.price[p.id] || 1 : null, myst = d.packs.mystery && d.packs.mystery[p.id];
        const tag = price != null ? `<span class="pkd-p" title="What he costs from your budget">$${price}</span>` : "";
        const why = !ok ? `<span class="ps pkd-why">${/afford|limit|left/.test(can.why || "") ? esc(can.why) : "No room for him"}</span>` : "";
        // a mystery card stays face down: its tier and position, and what that tier goes for
        if (myst) return `<article role="listitem" class="pkd t-${t} myst${ok ? "" : " dim"}" style="--d:${i * 380 - since}ms">
          ${tag}${TIER[t] ? `<span class="pkd-t">${TIER[t]}</span>` : ""}<span class="pkd-q" aria-hidden="true">?</span>
          <b class="pkd-n">Mystery ${esc(S.positions(p)[0])}</b><span class="pkd-s">${posChips(sport, p)} Face down</span>
          <span class="pkd-r"><span><small>Priced at</small><b>the ${esc((TIER[t] || "base").toLowerCase())} average</b></span></span>
          ${myTurn && ok ? `<button class="btn go sm" data-pick="${esc(p.id)}">Draft him</button>` : why}</article>`;
        return `<article role="listitem" class="pkd t-${t}${ok ? "" : " dim"}" style="--d:${i * 380 - since}ms" data-player="${esc(p.id)}">
          ${tag}${TIER[t] ? `<span class="pkd-t">${TIER[t]}</span>` : ""}${playerAv(sport, p, "lg")}
          <b class="pkd-n">${esc(p.n)}</b><span class="pkd-s">${posChips(sport, p)} ${proTeam(sport, p.t)}</span>
          <span class="pkd-r"><span><small>Overall</small><b>#${p.rank || "-"}</b></span><span><small>Position</small><b>${esc(p.prank || "-")}</b></span></span>
          ${myTurn && ok ? `<button class="btn go sm" data-pick="${esc(p.id)}">Draft</button>` : why}</article>`;
      }).join("")}</div>`;
    }

    /* left side: players, board, picks, results */
    function players() {
      const d = D(), n = now(), mine = me();
      const c = !auction() && d.phase === "live" ? F.onClock(d, n) : null;
      const myTurn = d.packs ? mine != null && F.packSlot(d, mine) >= 0 : c && c.team === mine;
      const st = auction() && d.phase === "live" ? F.auctionState(d, n) : null;
      const myNom = st && st.kind === "nominate" && st.team === mine;
      let rows = (ui.show === "all" ? opts.players : ctx.available).filter((p) => passes(sport, p, ui.f));
      // team roulette: the list shows the wheel's team for the pick on the clock, unless you ask for everyone
      const sn = spinNow(), only = sn && sn.t && !ui.rlAll && ui.show !== "all";
      if (only) rows = rows.filter((p) => p.t === sn.t);
      // a pack draft: the list is the pack in front of you, unless you ask for everyone
      const pk = d.packs && d.phase === "live" && mine != null ? F.packFor(d, ctx, mine) : null, packOnly = pk && !ui.rlAll && ui.show !== "all";
      if (packOnly) rows = rows.filter((p) => pk.includes(p.id));
      // every pick you have left is needed for an open starting spot (only K and DEF to go, say): show only who fits
      let fitBar = "";
      if (mine != null && d.phase === "live" && ui.show !== "all") {
        const ros = F.rosters(d)[mine].map((id) => ctx.byId[id]).filter(Boolean), left = F.sizeOf(d, mine) - ros.length;
        const got = F.assign(sport, ros, d.lineup), open = d.lineup.filter((sl, i) => !got[i]);
        if (left > 0 && open.length && left <= open.length) {
          const names = [...new Set(open)], fitN = rows.filter((p) => F.canAdd(d, ctx, mine, p).ok).length;
          if (!ui.fitAll && fitN) rows = rows.filter((p) => F.canAdd(d, ctx, mine, p).ok);
          fitBar = `<div class="rl-bar"><span>${ui.fitAll ? "Showing everyone." : `Only ${names.join(names.length > 2 ? ", " : " and ").replace(/, ([^,]*)$/, ", and $1")} fit${left === 1 ? " your last pick" : ` your last ${left} picks`}, so that's who's showing.`}</span><button class="btn xs" data-act="fitall">${ui.fitAll ? "Only who fits" : "Show everyone"}</button></div>`;
        }
      }
      const actions = (p) => {
        if (ctx.own[p.id] != null) { const ok = stealOk(p.id); return `${ok && ok.ok ? `<button class="btn xs warn" data-steal="${esc(p.id)}">Steal</button> ` : ""}${teamAv(team(ctx.own[p.id]), "sm")}`; }
        if (mine == null) return "";
        const ok = F.canAdd(d, ctx, mine, p).ok;
        const q = team(mine).queue.includes(p.id);
        return `${myTurn && ok && !d.packs ? `<button class="btn xs go" data-pick="${esc(p.id)}">Draft</button> ` : ""}${myNom && ok ? `<button class="btn xs go" data-nominate="${esc(p.id)}">Nominate</button> ` : ""}<button class="star${q ? " on" : ""}" data-queue="${esc(p.id)}" aria-label="${q ? "Remove" : "Add"} ${esc(p.n)} ${q ? "from" : "to"} your queue" aria-pressed="${!!q}" title="${q ? "In your queue" : "Add to queue"}">${q ? "&#9733;" : "&#9734;"}</button>`;
      };
      // your board, when you've made one: its place and tier, sortable, and the sort the room opens on
      const bd = mine != null ? myBoard.of(sport.key, opts.players) : null, at = bd && bd.custom ? myBoard.places(bd) : null;
      const lead = at ? [{ k: "my", label: "Mine", cls: "r num", title: "Your board, from the Rankings page", sort: (p) => (at[p.id] ? at[p.id].n : 1e4), asc: true, html: (p) => (at[p.id] ? `<b>${at[p.id].n}</b><span class="tier-n">T${at[p.id].tier}</span>` : "") }] : [];
      if (at && !ui.sortSet) { ui.sort = { k: "my", dir: 1 }; ui.sortSet = true; }
      const cols = poolColumns(sport, { group: groupOf(sport, ui.f), scoring: d.scoring, actions, lead, compact: true, auction: auction(), dynasty: !!(d.season && d.season.dynasty), money: auction() ? undefined : opts.money, value: opts.value });
      rows = sortRows(rows, cols, ui.sort);
      const pat = pk ? F.packAt(d, F.packTurnNow(d)) : null, pw = pk ? packWhere(d, mine) : null;
      const sealed = pk && packOnly && pat.j === 0 && myTurn && !packOpened(pat.q);
      if (sealed) return packSealed(pat, pk);
      const chase = pk && pat.j === 0 ? d.round1.filter((id, seat) => (d.packs.cards[pat.q][seat] || []).some((x) => (d.packs.tier || {})[x] === "chase")) : [];
      const chaseLine = chase.length ? ` Chase card${chase.length > 1 ? "s" : ""} in ${chase.map((id) => (isMe(team(id)) ? "yours" : esc(team(id).name))).join(", ")}.` : "";
      const money = pk && d.packs.price && mine != null ? F.packMoney(d, mine) : null;
      const moneyBar = money ? `<div class="pkd-money"><span><b>$${money.left}</b> left of $${d.packs.budget}</span><span>${money.picks} pick${money.picks === 1 ? "" : "s"} to go, about $${Math.round(money.per)} each</span>${myTurn ? `<span>Most you can pay now <b>$${money.max}</b></span>` : ""}</div>` : "";
      const packBar = pk ? moneyBar + `<div class="rl-bar"><span>${packOnly ? `${pat.j === 0 ? `Pack ${pat.q + 1}: ${pk.length} cards.${chaseLine}` : `Passed from ${esc(team(pw.from).name)}${pw.opener !== pw.from ? `, opened by ${esc(team(pw.opener).name)}` : ""}: ${pk.length} left.`} ${myTurn ? "Take one" : "You've picked"}, then it goes ${pat.q % 2 === 0 ? "left" : "right"}.` : "Showing everyone. You can only take a player from your pack."}</span><button class="btn xs" data-act="rlall">${packOnly ? "Show everyone" : "Only my pack"}</button></div>` : "";
      const rlBar = packBar || sn && sn.t ? packBar || `<div class="rl-bar"><span>${only ? `Showing ${esc(teamFull(sn.t))} players: the wheel's team for this pick.` : `Showing everyone. This pick has to come from ${esc(teamFull(sn.t))}.`}</span><button class="btn xs" data-act="rlall">${only ? "Show everyone" : `Only ${esc(sn.t)}`}</button></div>` : "";
      if (packOnly) return fitBar + rlBar + packGrid(rows, pat, myTurn, mine);
      return fitBar + rlBar + table({ cols, rows, sort: ui.sort, dense: true, id: "fk-pool", limit: ui.limit || 100, empty: "No one matches.",
        rowAttr: (p) => `data-player="${esc(p.id)}" class="${mine != null && ctx.own[p.id] == null && !F.canAdd(d, ctx, mine, p).ok ? "dim" : ""}"` });
    }
    // a board cell's name: first initial and last name ("J. Smith-Njigba"); a defense by its team
    const shortName = (p) => { if (S.positions(p).includes("DEF")) return `${p.t} D/ST`; const w = String(p.n).split(" "); return w.length > 1 && !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(w[1]) ? `${w[0][0]}. ${w.slice(1).join(" ")}` : p.n; };
    function board() {
      const d = D(), cols = d.round1, n = cols.length;
      const slots = auction() ? null : cols.map(slotsOf);
      const rounds = auction() ? d.rounds : Math.max(d.rounds, ...slots.map((x) => x.length));
      const cellOf = (r, col) => {
        if (auction()) { const s = d.sales.filter((x) => x.team === cols[col])[r]; return s ? { pk: s, label: money(s.price) } : null; }
        const k = slots[col][r];
        return k == null ? null : { pk: d.board[k], k };
      };
      const nowK = !auction() && d.phase === "live" ? F.onClock(d, now()).index : -1;
      let cells = `<div class="h"></div>${cols.map((id) => { const t = team(id); return `<div class="h${isMe(t) ? " me" : ""}" title="${esc(t.name)}${t.owner ? ", " + esc(t.owner) : ", bot"}">${teamAv(t, "sm")}<b>${esc(t.name)}</b><small>${auction() ? money(t.budget) + " left" : esc(t.owner || "Bot")}</small></div>`; }).join("")}`;
      for (let r = 0; r < rounds; r++) {
        cells += `<div class="rn">${r + 1}</div>`;
        for (let col = 0; col < n; col++) {
          const x = cellOf(r, col), t = team(cols[col]);
          const pk = x && x.pk, p = pk && pk.pid && ctx.byId[pk.pid];
          if (x && x.k != null && !pk && !seenK(x.k)) { cells += `<div class="cell hid${isMe(t) ? " me" : ""}"><small class="ps">Sealed</small></div>`; continue; }
          const via = x && x.k != null ? (pk && pk.drafter != null && pk.drafter !== pk.team ? team(pk.drafter) : !pk ? viaOf(x.k) : null) : null;
          const cls = ["cell", p ? "f c" + colorOf(sport, p) : "", isMe(t) ? "me" : "", x && x.k === nowK ? "now" : "", pk && pk.keeper ? "keep" : "", pk && pk.steal ? "steal" : "", x && x.k != null && !pk && D().extra[x.k] ? "mk" : ""].join(" ").replace(/\s+/g, " ");
          cells += `<div class="${cls}"${p ? ` data-player="${esc(p.id)}" role="button" tabindex="0" title="${esc(p.n)}${pk.auto ? ", autopick" : ""}"` : ""}>${p ? `<b>${esc(shortName(p))}</b><small>${pk.steal ? `stolen from ${esc(team(pk.from).abbr)}` : via ? `from ${esc(via.abbr)}` : `${S.positions(p).join(", ")} ${esc(p.t)}`}${x.label ? " " + x.label : ""}</small>` : pk ? "<b>Passed</b>" : x && x.k != null ? `<small class="ps">${plab(x.k)}${x.k === nowK ? ", on the clock" : via ? `, via ${esc(via.abbr)}` : ""}</small>` : ""}</div>`;
        }
      }
      return `<div class="board" id="fk-board"><div class="bgrid" style="--n:${n};grid-template-columns:28px repeat(${n},minmax(0,1fr))">${cells}</div></div>`;
    }
    function picks() {
      const d = D(), list = F.made(d).reverse();
      return `<div class="table-wrap" id="fk-picks" style="flex:1;min-height:0">${list.length ? `<ol class="picks">${list.map((pk) => { const t = team(pk.team), p = ctx.byId[pk.pid];
        return `<li class="${isMe(t) ? "me" : ""}"><span class="no">${auction() ? money(pk.price) : plab(pk.n - 1)}</span><span ${p ? `data-player="${esc(p.id)}"` : ""} style="cursor:pointer;min-width:0">${p ? pname(sport, p, [pk.keeper ? "keeper" : pk.auto ? "autopick" : "", pk.drafter != null && pk.drafter !== pk.team ? `traded from ${team(pk.drafter).abbr}` : "", pk.steal ? `stole him from ${team(pk.from).abbr}` : "", pk.gone ? "later stolen" : ""].filter(Boolean).join(", ")) : "<b>Passed</b>"}</span><span class="row">${teamAv(t, "sm")}<span class="ps hide-s">${esc(t.name)}</span></span></li>`; }).join("")}</ol>` : `<p class="empty">No ${auction() ? "sales" : "picks"} yet.</p>`}</div>`;
    }
    // The recap above the team cards: best values, biggest reaches, position runs; Copy puts it in words for a group chat.
    const passedBy = (k) => `passed by ${k} team${k === 1 ? "" : "s"}`;
    function recapLine(x) {
      const p = ctx.byId[x.pid];
      if (D().packs) return x.diff < 0 && x.over ? `${p.n}, with ${ctx.byId[x.over.pid].n} still in the pack` : x.passed ? `${p.n}, ${passedBy(x.passed)}` : `${p.n}, a ${x.tier || "top"} pull`;
      return D().type === "auction" ? `${p.n} for ${money(x.price)}, worth ${money(x.$)}` : `${p.n} at ${plab(x.at - 1)}, ranked #${x.rank}`;
    }
    function recapText() {
      const d = D(), R = F.recap(d, ctx), st = F.standings(d, ctx).sort((a, b) => a.rank - b.rank);
      const lines = [`${d.name || "Draft"} recap`, "", "Grades: " + st.map((r) => `${team(r.team).name} ${r.grade}`).join(", ")];
      if (R.pack) {
        if (R.budget && R.buys.length) lines.push("", "Best buys:", ...R.buys.map((x) => `  ${ctx.byId[x.pid].n}, $${x.price} for $${Math.round(x.$)} of value (${team(x.team).name})`));
        if (R.budget && R.mysteries.length) lines.push("", "Mystery cards:", ...R.mysteries.map((x) => `  ${ctx.byId[x.pid].n} for $${x.price}, worth $${Math.round(x.$)} (${team(x.team).name})`));
        if (R.pulls.length) lines.push("", "Best pulls:", ...R.pulls.map((x) => `  ${ctx.byId[x.pid].n}, ${x.tier} (${team(x.team).name}${x.opener !== x.team ? `, from ${team(x.opener).name}'s pack` : ""})`));
        if (R.steals.length) lines.push("", "Steals:", ...R.steals.map((x) => `  ${recapLine(x)} (${team(x.team).name})`));
        if (R.reaches.length) lines.push("", "Left in the pack:", ...R.reaches.map((x) => `  ${recapLine(x)} (${team(x.team).name})`));
        return lines.join("\n");
      }
      if (R.steals.length) lines.push("", "Best values:", ...R.steals.map((x) => `  ${recapLine(x)} (${team(x.team).name}, +${money(x.diff)})`));
      if (R.reaches.length) lines.push("", "Biggest reaches:", ...R.reaches.map((x) => `  ${recapLine(x)} (${team(x.team).name}, ${money(-x.diff)} over)`));
      if (R.runs.length) lines.push("", "Runs:", ...R.runs.map((r) => `  ${r.pos}: ${r.count} of ${r.of} picks, ${plab(r.fromPick - 1)} to ${plab(r.toPick - 1)}`));
      return lines.join("\n");
    }
    function recapCard() {
      const d = D(), R = F.recap(d, ctx);
      if (R.pack) return packRecapCard(R);
      if (!R.steals.length && !R.reaches.length) return "";
      const item = (x, good) => `<li><span data-player="${esc(x.pid)}" style="cursor:pointer;min-width:0">${pname(sport, ctx.byId[x.pid], `${esc(team(x.team).name)}, ${d.type === "auction" ? `${money(x.price)} for ${money(x.$)} of value` : `${plab(x.at - 1)}, ranked #${x.rank}`}`, { size: "sm" })}</span><b class="${good ? "win" : "loss"} num">${good ? "+" : "-"}${money(Math.abs(x.diff))}</b></li>`;
      return `<div class="card recap"><div class="mod-h"><b>Draft recap</b><span class="ps" style="margin-left:6px">Against the rankings at draft time</span><span class="grow"></span><button class="btn sm" data-act="recap">Copy recap</button></div>
        <div class="recap-cols"><div><h4>Best values</h4><ul class="rslots">${R.steals.map((x) => item(x, true)).join("") || `<li class="ps">None to speak of</li>`}</ul></div>
        <div><h4>Biggest reaches</h4><ul class="rslots">${R.reaches.map((x) => item(x, false)).join("") || `<li class="ps">None to speak of</li>`}</ul></div>
        ${R.runs.length ? `<div><h4>Position runs</h4><ul class="rslots">${R.runs.map((r) => `<li><span><b>${esc(r.pos)}</b> ${r.count} of ${r.of} picks</span><span class="ps">${plab(r.fromPick - 1)} to ${plab(r.toPick - 1)}</span></li>`).join("")}</ul></div>` : ""}</div></div>`;
    }
    // a pack draft's recap: the pulls, the players who went around the table, and better ones left behind
    function packRecapCard(R) {
      if (!R.pulls.length && !R.steals.length && !R.reaches.length) return "";
      const li = (x, sub, tag) => `<li><span data-player="${esc(x.pid)}" style="cursor:pointer;min-width:0">${pname(sport, ctx.byId[x.pid], sub, { size: "sm" })}</span>${tag}</li>`;
      const pulls = R.pulls.map((x) => li(x, `${esc(team(x.team).name)}${x.opener !== x.team ? `, from ${esc(team(x.opener).name)}'s pack` : ", opened it"}`, `<span class="pkd-t tag-${x.tier}">${TIER[x.tier]}</span>`)).join("");
      const steals = R.steals.map((x) => li(x, esc(team(x.team).name), `<b class="win num">${x.passed} passed</b>`)).join("");
      const left = R.reaches.map((x) => li(x, `${esc(team(x.team).name)}, over ${esc(ctx.byId[x.over.pid].n)}`, `<b class="loss num">-${money(-x.diff)}</b>`)).join("");
      if (R.budget) {
        const gain = (x) => { const g = Math.round(x.$ - x.price); return `<b class="${g >= 0 ? "win" : "loss"} num">${g >= 0 ? "+" : "-"}$${Math.abs(g)}</b>`; };
        const buys = R.buys.map((x) => li(x, `${esc(team(x.team).name)}, $${x.price} for $${Math.round(x.$)} of value`, gain(x))).join("");
        const myst = R.mysteries.slice(0, 6).map((x) => li(x, `${esc(team(x.team).name)} paid $${x.price}`, gain(x))).join("");
        return `<div class="card recap"><div class="mod-h"><b>Draft recap</b><span class="ps" style="margin-left:6px">What each pick cost against what he's worth</span><span class="grow"></span><button class="btn sm" data-act="recap">Copy recap</button></div>
          <div class="recap-cols"><div><h4>Best buys</h4><ul class="rslots">${buys || `<li class="ps">Nobody found a bargain</li>`}</ul></div>
          <div><h4>Mystery cards</h4><ul class="rslots">${myst || `<li class="ps">Nobody took a mystery card</li>`}</ul></div>
          <div><h4>Steals: passed by the most teams</h4><ul class="rslots">${steals || `<li class="ps">None to speak of</li>`}</ul></div></div></div>`;
      }
      return `<div class="card recap"><div class="mod-h"><b>Draft recap</b><span class="ps" style="margin-left:6px">Each pick against the pack it came from</span><span class="grow"></span><button class="btn sm" data-act="recap">Copy recap</button></div>
        <div class="recap-cols"><div><h4>Best pulls</h4><ul class="rslots">${pulls || `<li class="ps">None to speak of</li>`}</ul></div>
        <div><h4>Steals: passed by the most teams</h4><ul class="rslots">${steals || `<li class="ps">None to speak of</li>`}</ul></div>
        <div><h4>Left in the pack</h4><ul class="rslots">${left || `<li class="ps">Nobody left a better player at his position</li>`}</ul></div></div></div>`;
    }
    // after a heist: every move, as it landed
    function heistOutcome() {
      const d = D(), hr = d.heist && d.heist.result;
      if (!hr) return "";
      const nm = (pid) => esc((ctx.byId[pid] || {}).n || "a player"), tn = (t) => (isMe(team(t)) ? "You" : esc(team(t).name));
      const line = (e) => e.type === "steal" ? (e.ok ? `<b>${tn(e.by)}</b> stole ${nm(e.pid)} from ${tn(e.on)}. He plays at 1.5x.` : `<b>${tn(e.by)}</b> went for ${nm(e.pid)}, but ${tn(e.on)} had him shielded.`)
        : e.ok ? `<b>${tn(e.by)}</b> jinxed ${nm(e.pid)}: half points for ${tn(e.on)}.` : `<b>${tn(e.by)}</b> tried to jinx ${nm(e.pid)}. Shielded.`;
      const mine = hr.events.filter((e) => isMe(team(e.by)) || isMe(team(e.on))), rest = hr.events.filter((e) => !mine.includes(e));
      return `<div class="card recap"><div class="mod-h"><b>The heist</b><span class="ps" style="margin-left:6px">${hr.events.filter((e) => e.ok).length} of ${hr.events.length} moves landed</span></div>
        <ul class="rslots" style="padding:4px 16px 12px">${mine.concat(rest).map((e) => `<li class="${isMe(team(e.by)) || isMe(team(e.on)) ? "me" : ""}"><span class="txi ${e.ok ? (e.type === "steal" ? "add" : "drop") : ""}" aria-hidden="true">${e.ok ? (e.type === "steal" ? "&#8644;" : "&#9660;") : "&#9632;"}</span><span>${line(e)}</span></li>`).join("") || `<li class="ps">Nobody made a move.</li>`}</ul></div>`;
    }
    function results() {
      const d = D(), st = F.standings(d, ctx).sort((a, b) => a.rank - b.rank), R = F.recap(d, ctx);
      return `<div style="overflow:auto;flex:1;min-height:0">${heistOutcome()}${recapCard()}<div class="teams">${st.map((r) => { const t = team(r.team), bv = R.best[r.team];
        return `<div class="card"${isMe(t) ? ` style="border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)"` : ""}><div class="mod-h">${teamAv(t, "md")}<div style="min-width:0"><b class="ell" style="display:block">${esc(t.name)}${isMe(t) ? ` <span class="tag you">You</span>` : ""}</b><span class="ps">${ord(r.rank)}, ${pts() ? `${Math.round(r.score)} projected` : `${r.score.toFixed(1)} value`}${r.spent != null ? `, spent ${money(r.spent)}` : ""}${d.bank ? `, ${fmtLeft(t.bank)} banked for ${bankFaab(t)} FAAB` : ""}${R.budget ? `<br>$${R.spent[r.team] || 0} of $${R.budget} spent` : ""}${bv && bv.diff > 0 ? `<br>${R.pack ? `Best steal: ${esc(last(ctx.byId[bv.pid].n))}, ${passedBy(bv.passed)}` : `Best value: ${esc(last(ctx.byId[bv.pid].n))}, +${money(bv.diff)}`}` : ""}</span></div><b class="grade disp">${r.grade}</b></div>
          <ol>${d.lineup.map((sl, i) => { const p = r.starters[i]; return `<li><span class="slot">${esc(sl)}</span>${p ? `<button class="btn link ell" data-player="${esc(p.id)}">${esc(p.n)}</button><span class="grow"></span><span class="ps">#${p.rank}</span>` : `<span class="ps">Empty</span>`}</li>`; }).join("")}${r.bench.map((p) => `<li class="bn"><span class="slot">BN</span><button class="btn link ell" data-player="${esc(p.id)}">${esc(p.n)}</button><span class="grow"></span><span class="ps">#${p.rank}</span></li>`).join("")}</ol></div>`; }).join("")}</div></div>`;
    }
    // Projected standings from the rosters so far: each team's best lineup, its category totals and the roto points
    // they'd earn (or its projected points), on the stats or projections the switch shows.
    function projected() {
      const d = D(), sc = sport.scorings[d.scoring] || Object.values(sport.scorings)[0], ros = F.rosters(d);
      const rows = d.teams.map((t) => {
        const ps = ros[t.id].map((id) => ctx.byId[id]).filter(Boolean);
        const asg = F.assign(sport, ps, d.lineup), st = asg.filter(Boolean);
        // one week: the week's points, a captain's at 1.5x
        const wkly = sport.weekOf != null, mult = (S.SHOWDOWN && S.SHOWDOWN.mult) || {};
        return { t, n: ps.length, st, tot: sc.type === "cats" ? FK.value.teamCats(sport, sc, st, (p, line) => lineOf(sport, p, line)) : null,
          pts: sc.type === "points" ? asg.reduce((a, p, i) => a + (p ? (p.v || 0) * (wkly ? (mult[d.lineup[i]] || 1) / 17 : 1) : 0), 0) : null };
      });
      const any = rows.some((r) => r.n);
      const head = `<div class="pk-h"><b>Projected standings</b><span class="ps">${sc.type === "cats" ? `Each team's starters so far, by ${sport.statView === "proj" && hasProj(sport) ? esc(projLabel(sport).toLowerCase().replace(/^(\d{4}) steamer/, "$1 Steamer")) : esc(statsLabel(sport))}. Roto points: ${d.teams.length} for the best in a category, 1 for the worst.` : sport.weekOf != null ? `Each team's starters so far, by projected points in week ${sport.weekOf}.` : "Each team's starters so far, by projected points for the season."}</span><span class="grow"></span>${viewSelect(sport, "fk-statv2")}</div>`;
      if (!any) return `<div style="overflow:auto;flex:1;min-height:0">${head}<p class="empty">Projections fill in as teams draft.</p></div>`;
      if (sc.type !== "cats") {
        const sorted = rows.slice().sort((a, b) => b.pts - a.pts);
        return `<div style="overflow:auto;flex:1;min-height:0">${head}<table class="t dense"><thead><tr><th class="r">#</th><th>Team</th><th class="r">Starters</th><th class="r">Projected points</th></tr></thead><tbody>${sorted.map((r, i) => `<tr${isMe(r.t) ? ' class="me"' : ""}><td class="r num">${i + 1}</td><td class="nm"><span class="row" style="gap:6px">${teamAv(r.t, "sm")}<span class="ell">${esc(r.t.name)}</span></span></td><td class="r num ps">${r.st.length} of ${d.lineup.length}</td><td class="r num"><b>${Math.round(r.pts)}</b></td></tr>`).join("")}</tbody></table></div>`;
      }
      // roto points per category: ties split the points
      const pts = rows.map(() => ({ tot: 0, by: {} }));
      for (const c of sc.cats) {
        const vals = rows.map((r, i) => ({ i, v: r.tot[c.k] })).filter((x) => x.v != null && rows[x.i].n);
        vals.sort((a, b) => (c.low ? b.v - a.v : a.v - b.v));
        vals.forEach((x) => { const same = vals.filter((y) => y.v === x.v), first = vals.indexOf(same[0]); const p = first + (same.length + 1) / 2; pts[x.i].by[c.k] = p; pts[x.i].tot += p; });
      }
      // sortable by any category (best first), or by roto points, the default
      const sk = ui.projSort && sc.cats.some((c) => c.k === ui.projSort) ? sc.cats.find((c) => c.k === ui.projSort) : null;
      const order = rows.map((r, i) => i).sort((a, b) => (sk ? (pts[b].by[sk.k] || 0) - (pts[a].by[sk.k] || 0) || pts[b].tot - pts[a].tot : pts[b].tot - pts[a].tot));
      const fmtC = (c, v) => (v == null ? "-" : c.num || c.rate === "avg" || c.rate === "obp" || c.rate === "ops" ? v.toFixed(3).replace(/^0/, "") : c.rate ? v.toFixed(2) : sport.key === "mlb" ? String(Math.round(v)) : v.toFixed(1));
      const n = d.teams.length;
      return `<div style="overflow:auto;flex:1;min-height:0">${head}<div class="table-wrap" style="border:0;border-radius:0"><table class="t dense proj"><thead><tr><th class="r">#</th><th>Team</th>${sc.cats.map((c) => `<th class="r sortable${sk === c ? " on" : ""}" data-act="projsort" data-k="${esc(c.k)}" title="Sort by ${esc(c.label)}" aria-sort="${sk === c ? "descending" : "none"}">${esc(c.label)}</th>`).join("")}<th class="r sortable${sk ? "" : " on"}" data-act="projsort" data-k="" title="Sort by roto points" aria-sort="${sk ? "none" : "descending"}">Roto</th></tr></thead><tbody>
        ${order.map((i, j) => { const r = rows[i]; return `<tr${isMe(r.t) ? ' class="me"' : ""}><td class="r num">${j + 1}</td><td class="nm"><span class="row" style="gap:6px">${teamAv(r.t, "sm")}<span class="ell">${esc(r.t.name)}</span></span></td>${sc.cats.map((c) => { const p = pts[i].by[c.k]; return `<td class="r num${p != null && p >= n - 0.5 ? " win" : p != null && p <= 1.5 ? " loss" : ""}" title="${p != null ? `${p} roto points` : ""}">${fmtC(c, r.tot[c.k])}</td>`; }).join("")}<td class="r num"><b>${Math.round(pts[i].tot * 10) / 10}</b></td></tr>`; }).join("")}
        </tbody></table></div></div>`;
    }
    // Mystery packages: every team's picks side by side, with what each package is worth on the pick curve.
    function packages() {
      const d = D(), M = d.mystery, nowK = d.phase === "live" ? F.onClock(d, now()).index : -1;
      const rows = d.round1.slice().sort((a, b) => (a === me() ? -1 : b === me() ? 1 : 0)).map((id) => {
        const ks = slotsOf(id), t = team(id), sealed = ks.some((k) => !seenK(k));
        const tot = ks.reduce((a, k) => a + M.curve[k], 0);
        const chips = ks.map((k) => {
          if (!seenK(k)) return `<span class="pkc hid" title="Sealed">?</span>`;
          const pk = d.board[k], p = pk && pk.pid && ctx.byId[pk.pid];
          return `<span class="pkc${p ? ` done c${colorOf(sport, p)}` : ""}${k === nowK ? " now" : ""}"${p ? ` data-player="${esc(p.id)}" title="${esc(p.n)}"` : ` title="${ord(k + 1)} pick, about ${money(F.pickValue(d, ctx, k))}"`}>${k + 1}</span>`;
        }).join("");
        return { id, t, sealed, tot, chips };
      });
      const max = Math.max(...rows.map((r) => r.tot), 1);
      const test = M.test ? ` The bot test drafted ${M.test.tries} deals and kept the one where the bots finished closest.` : "";
      return `<div style="overflow:auto;flex:1;min-height:0"><div class="pk-h"><b>Mystery packages</b><span class="ps">Every team's picks add up to the same value on the pick curve, within ${(M.spread * 100).toFixed(1)}% of each other.${test} ${d.phase === "setup" && !seenK(0) ? "Packages open when the draft starts." : M.reveal === "own" && d.phase === "live" ? "Other teams' picks show when they come up." : ""}</span></div>
        <ul class="pkl">${rows.map((r) => `<li class="${isMe(r.t) ? "me" : ""}"><span class="row">${teamAv(r.t, "sm")}<b class="ell">${esc(r.t.name)}</b></span><span class="pkv">${r.sealed ? `<span class="ps">Sealed</span>` : `<i style="width:${((r.tot / max) * 100).toFixed(1)}%"></i><span>${Math.round(r.tot)}</span>`}</span><span class="pkcs">${r.chips}</span></li>`).join("")}</ul></div>`;
    }
    // White elephant: everyone on another roster, whether you can take him, and why not.
    function steals() {
      const d = D(), m = me(), c = d.phase === "live" ? F.onClock(d, now()) : null;
      const rows = Object.entries(ctx.own).filter(([, t]) => t !== m).map(([id, t]) => ({ p: ctx.byId[id], t })).filter((x) => x.p).sort((a, b) => a.p.rank - b.p.rank).slice(0, 150);
      const left = m != null ? F.stealsLeft(d, m) : 0;
      const why = (id) => (m == null || !c ? null : F.canSteal(d, ctx, m, id, now()));
      return `<div style="overflow:auto;flex:1;min-height:0"><div class="pk-h"><b>Steal a player</b><span class="ps">On your turn, take someone already drafted instead of a new player. The team you take him from picks again right away and can't take him straight back. A player is frozen after ${d.steals.freeze} steals, every team gets ${d.steals.perTeam}, and steals end with ${d.steals.lastRounds} rounds to go.${m != null ? ` You have ${left} left.` : ""}</span></div>
        ${rows.length ? `<ul class="rslots">${rows.map(({ p, t }) => { const r = why(p.id), n = F.stealsOf(d, p.id), frozen = n >= d.steals.freeze; return `<li style="grid-template-columns:minmax(0,1fr) auto auto"><span data-player="${esc(p.id)}" style="cursor:pointer;min-width:0">${pname(sport, p, `#${p.rank}, ${money(p.$)}`, { size: "sm" })}</span><span class="row" style="gap:6px">${frozen ? `<span class="tag">Frozen</span>` : n ? `<span class="tag gold">Stolen ${n}x</span>` : ""}${teamAv(team(t), "sm")}<b class="ps">${esc(team(t).abbr)}</b></span>${r && r.ok ? `<button class="btn xs warn" data-steal="${esc(p.id)}">Steal</button>` : `<span class="ps" style="font-size:11px;max-width:150px;text-align:right">${r && c && c.team === m && !frozen ? esc(r.why) : ""}</span>`}</li>`; }).join("")}</ul>` : `<p class="empty">Nobody has drafted anyone yet.</p>`}</div>`;
    }
    // the starting spots a team still has open, keyed like the position chips ("" for a spot anyone can fill)
    function openSpots(id, starters) {
      const d = D();
      if (!starters) { const ps = F.rosters(d)[id].map((x) => ctx.byId[x]).filter(Boolean); starters = F.assign(sport, ps, d.lineup); }
      const open = {};
      d.lineup.forEach((sl, i) => { if (!starters[i]) open[sl] = (open[sl] || 0) + 1; });
      return open;
    }
    const chipOf = (sl) => (sport.slots[sl] === "*" ? "" : Array.isArray(sport.slots[sl]) && sport.slots[sl].length > 1 ? "s:" + sl : sl);
    function needChips(id) {
      if (id == null || D().phase === "done") return null;
      const m = {};
      for (const [sl, k] of Object.entries(openSpots(id))) { const v = chipOf(sl); if (v) m[v] = (m[v] || 0) + k; }
      return m;
    }
    // on a phone the players list carries the line from My team: when you pick, and what you still need
    function phoneNeeds() {
      const d = D(), id = me();
      if (id == null || d.phase === "done" || d.phase === "heist") return "";
      const bits = [];
      if (!auction() && !d.packs && d.phase === "live") {
        const c = F.onClock(d, now()), next = F.nextPickOf(d, id);
        // on the clock already fills the banner above
        if (c && c.team !== id && next != null) { const away = next - 1 - c.index; bits.push(`<b>${away <= 1 ? "You're on deck" : `Your pick in ${away}`}</b>`); }
      }
      const open = Object.entries(openSpots(id));
      bits.push(open.length ? `<span>Need ${open.map(([sl, k]) => `${esc(sl)}${k > 1 ? `&nbsp;&times;${k}` : ""}`).join(", ")}</span>` : `<span>Starters set. Bench from here.</span>`);
      return `<div class="pf-now show-m" role="status">${bits.join("")}</div>`;
    }
    // your draft at a glance: when you pick next, the starting spots still open, and the top of your queue
    function brief(id, starters) {
      const d = D(), n = now(), out = [];
      if (!auction() && !d.packs && d.phase === "live") {
        const c = F.onClock(d, n), next = F.nextPickOf(d, id);
        if (c && c.team === id) out.push(`<div class="br-next on"><b>You're on the clock</b><span>Pick ${esc(plab(c.index))}</span></div>`);
        else if (next != null && c) { const away = next - 1 - c.index; out.push(`<div class="br-next"><b>${away <= 1 ? "You're on deck" : `Your pick in ${away}`}</b><span>Pick ${esc(plab(next - 1))}</span></div>`); }
      }
      const needs = Object.entries(openSpots(id, starters));
      if (needs.length) out.push(`<div class="br-row"><span class="br-k">Need</span><span class="br-chips">${needs.map(([sl, k]) => `<button type="button" class="br-chip" data-fpos="${esc(chipOf(sl))}" title="Show ${esc(sl)} players">${esc(sl)}${k > 1 ? ` <i>&times;${k}</i>` : ""}</button>`).join("")}</span></div>`);
      else if (d.phase !== "setup") out.push(`<div class="br-row"><span class="br-k">Need</span><span class="ps">Every starting spot is filled. Bench from here.</span></div>`);
      const q = team(id).queue.filter((pid) => ctx.own[pid] == null).slice(0, 3).map((pid) => ctx.byId[pid]).filter(Boolean);
      out.push(`<div class="br-row"><span class="br-k">Queue</span>${q.length ? `<span class="br-q">${q.map((p) => `<span data-player="${esc(p.id)}">${esc(p.n)}</span>`).join("")}</span>` : `<span class="ps">Star players to line them up.</span>`}</div>`);
      return `<div class="brief">${out.join("")}</div>`;
    }
    function upcoming(id) {
      const d = D();
      if (auction()) return "";
      const ks = F.picksOf(d, id).filter(seenK);
      if (!ks.length) return "";
      return `<div class="mod-h" style="border-top:1px solid var(--line)"><b>Picks to come</b><span class="ps" style="margin-left:auto">${ks.length}</span></div><div class="pkcs" style="padding:8px 12px 12px">${ks.map((k) => `<span class="pkc${viaOf(k) ? " via" : ""}" title="${ord(k + 1)} overall${viaOf(k) ? `, via ${esc(viaOf(k).name)}` : ""}">${plab(k)}</span>`).join("")}</div>`;
    }
    // a draft trade as a card: what each side sends, valued as it was when offered
    function roomTradeVM(T, acts) {
      const d = D();
      const LBL = { pending: "Pending", accepted: "Accepted", declined: "Declined", expired: "Expired", canceled: "Canceled" };
      const CLS = { pending: "pending", accepted: "accepted", declined: "rejected", expired: "cancelled", canceled: "cancelled" };
      // picks in a card read as they were offered: the pick and its value, without where it has gone since
      const cardVM = (id, T) => {
        const x = assetVM(id);
        if (!x || !x.pick || x.sealed) return x;
        const pk = d.board[x.k], who = pk && pk.pid && ctx.byId[pk.pid];
        const val = T && T.vals && T.vals[id] != null ? T.vals[id] : F.pickValue(d, ctx, x.k);
        return Object.assign({}, x, { sub: `${ord(x.k + 1)} overall, worth ${money(val)} then${who ? `, became ${who.n}` : ""}` });
      };
      return ({ id: T.id, status: CLS[T.status], statusLabel: LBL[T.status], from: team(T.from), to: team(T.to), give: T.give.map((id) => cardVM(id, T)).filter(Boolean), get: T.get.map((id) => cardVM(id, T)).filter(Boolean),
        note: T.status === "declined" && T.why ? T.why : T.note, when: ago(T.done || T.at, now()), acts, sub: T.added && T.added.length ? "Evened out with a late pick" : "" });
    }
    function tradesPanel() {
      const d = D(), m = me(), vm = roomTradeVM;
      const list = d.trades.slice().reverse();
      const toMe = list.filter((T) => T.status === "pending" && T.to === m);
      const out = list.filter((T) => T.status === "pending" && T.from === m);
      const done = list.filter((T) => T.status === "accepted" || (T.status !== "pending" && (T.from === m || T.to === m) && T.status !== "expired")).slice(0, 15);
      const sec = (title, items) => items.length ? `<div class="mod-h"><b>${title}</b></div><div class="dtr">${items.join("")}</div>` : "";
      return `<div class="mod-h"><b>Trades</b><button class="btn xs go" data-act="trade" style="margin-left:auto"${canTrade() ? "" : " disabled"}>Propose a trade</button></div>
        ${!toMe.length && !out.length && !done.length ? `<p class="ps" style="margin:8px 12px">Trade picks, and players you've drafted, with any team. Bots answer right away. When the counts don't match, the team getting more adds its latest pick so every roster stays the same size.</p>` : ""}
        ${sec("Offers for you", toMe.map((T) => tradeCard(sport, vm(T, `<button class="btn sm go" data-tr-yes="${T.id}">Accept</button><button class="btn sm" data-tr-no="${T.id}">Decline</button>`))))}
        ${sec("You sent", out.map((T) => tradeCard(sport, vm(T, `<button class="btn sm" data-tr-cancel="${T.id}">Cancel</button>`))))}
        ${sec("Done", done.map((T) => tradeCard(sport, vm(T))))}`;
    }
    function openTrade(other, prefill) {
      const d = D(), m = me();
      const others = d.teams.filter((t) => t.id !== m);
      const roster = (id) => {
        const ks = F.picksOf(D(), id);
        const sealed = ks.filter((k) => !seenK(k)).sort((a, b) => F.hash01(`${D().seed}:${a}`) - F.hash01(`${D().seed}:${b}`)).map(sealedVM);
        return ks.filter(seenK).map(pickVM).concat(sealed, F.rosters(D())[id].map((x) => ctx.byId[x]).filter(Boolean));
      };
      const bal = (t) => F.balance(D(), t);
      tradeWindow({ sport, teams: d.teams, me: m, other: other != null ? other : (others.find((t) => !isMe(t)) || others[0]).id, roster, dark: true, title: "Trade during the draft", prefill,
        empty: "Pick picks or players on either side",
        values: (t) => { const b = bal(t), v = (ids) => ids.reduce((a, id) => a + valueOf(id), 0); return [v(b.give), v(b.get)]; },
        check: (t) => {
          const b = bal(t), c = F.tradeCheck(D(), ctx, b);
          if (!c.ok) return c;
          const add = b.added.map((x) => `${team(x.team).abbr} adds ${seenK(F.pickIdx(x.id)) ? pickVM(F.pickIdx(x.id)).n.replace("Pick ", "pick ") : "its last pick"}`);
          return { ok: true, note: [add.length ? `To keep rosters even, ${add.join(" and ")}.` : "", !team(t.to).owner ? "They'll answer right away." : ""].filter(Boolean).join(" ") };
        },
        submit: (t) => {
          const r = F.propose(D(), ctx, Object.assign({}, t, { by: "you" }), now());
          if (!r.ok) return r;
          if (r.pending) F.offerHold(D(), now());        // a manager on the clock gets time to read it
          save(); ui.right = "trades"; render();
          if (r.accepted) toast(`${team(t.to).name} accepted.`);
          else if (r.pending) toast("Offer sent.");
          else toast(`${team(t.to).name} declined: ${r.why}.`, true);
          return { ok: true };
        } });
    }

    /* right side: my team, queue, teams */
    function rosterPanel(id) {
      const d = D(), t = team(id);
      const ps = F.rosters(d)[id].map((x) => ctx.byId[x]).filter(Boolean);
      const starters = F.assign(sport, ps, d.lineup);
      const bench = ps.filter((p) => !starters.includes(p));
      const paid = (p) => { const s = auction() ? d.sales.find((x) => x.pid === p.id) : null; return s ? money(s.price) : ""; };
      const li = (slot, p) => `<li class="${p ? "" : "open"}"><span class="slot">${esc(slot)}</span>${p ? `<span data-player="${esc(p.id)}" style="cursor:pointer;min-width:0">${pname(sport, p, "", { size: "sm" })}</span><span class="ps">${paid(p) || "#" + p.rank}</span>` : `<span class="ps">Open</span><span></span>`}</li>`;
      // open bench spots read as one line, not a row each
      const openBn = Math.max(0, d.bench - bench.length);
      const bnLine = openBn ? `<li class="open bn-left"><span class="slot">BN</span><span class="ps">${openBn} bench spot${openBn === 1 ? "" : "s"} open</span><span></span></li>` : "";
      return `<div class="mod-h">${teamAv(t, "sm")}<b class="ell">${esc(t.name)}</b><span class="ps" style="margin-left:auto;white-space:nowrap">${ps.length} of ${F.sizeOf(d, id)}${auction() ? `, ${money(t.budget)} left` : ""}</span></div>
        ${id === me() && d.phase !== "done" ? brief(id, starters) : ""}
        <ul class="rslots">${d.lineup.map((s, i) => li(s, starters[i])).join("")}${bench.map((p) => li("BN", p)).join("")}${bnLine}</ul>${upcoming(id)}`;
    }
    /* league chat in the room (shared leagues pass opts.chat: posts(), send(body), unread(), seen()) */
    function chatPanel() {
      const c = opts.chat; c.seen();
      const posts = c.posts().slice(-150);
      const done = (D().trades || []).filter((T) => T.status === "accepted").map((T) => ({ at: T.done || T.at, trade: T }));
      const items = posts.map((p) => ({ at: p.at, p })).concat(done).sort((a, b) => a.at - b.at);
      const li = (it, prev) => {
        if (it.trade) return `<li class="sys"><span class="txi trade" aria-hidden="true">&#8644;</span><span><b>${esc(team(it.trade.from).name)}</b> and <b>${esc(team(it.trade.to).name)}</b> made a trade</span><time>${esc(ago(it.at, now()))}</time></li>`;
        const p = it.p, t = team(p.team) || { name: p.author, abbr: "", color: 0 };
        const cont = prev && prev.p && prev.p.team === p.team && it.at - prev.at < 6e5;
        return `<li class="${me() != null && p.team === me() ? "mine " : ""}${cont ? "cont" : ""}">${cont ? "<span></span>" : teamAv(t, "sm")}<div class="what">${cont ? "" : `<div class="who"><b>${esc(t.name)}</b><span class="ps">${esc(p.author)}</span><time>${esc(ago(p.at, now()))}</time></div>`}<p>${esc(p.body).replace(/\n/g, "<br>")}</p></div></li>`;
      };
      return `<div class="rchat"><ul class="chat" id="fk-rchatl">${items.length ? items.map((it, i) => li(it, items[i - 1])).join("") : `<li class="sys"><span></span><span class="ps">No posts yet. The whole league sees this.</span></li>`}</ul>
        ${me() != null ? `<form class="chat-f" id="fk-rchatf"><label class="sr" for="fk-rchat">Message the league</label><textarea id="fk-rchat" rows="1" maxlength="500" placeholder="Message the league">${esc(ui.chatDraft || "")}</textarea><button class="btn go">Send</button></form>` : ""}</div>`;
    }
    function queuePanel() {
      const t = team(me());
      return `<div class="mod-h"><b>Your queue</b><span class="ps" style="margin-left:auto">${t.queue.length} player${t.queue.length === 1 ? "" : "s"}</span></div>
        <p class="ps" style="margin:8px 12px">When your clock runs out${auction() ? " or it's your nomination" : ""}, the first player here who still fits ${auction() ? "goes up for bid" : "is your pick"}. Star players to add them.</p>
        <ul class="rslots">${t.queue.map((id, i) => { const p = ctx.byId[id], taken = ctx.own[id] != null; return `<li${taken ? ` style="opacity:.45"` : ""}><span class="slot">${i + 1}</span><span data-player="${esc(id)}" style="cursor:pointer;min-width:0">${pname(sport, p, taken ? "taken" : "", { size: "sm" })}</span><span class="row" style="gap:4px"><button class="btn xs" data-qup="${esc(id)}"${i ? "" : " disabled"} aria-label="Move up">&uarr;</button><button class="btn xs" data-queue="${esc(id)}" aria-label="Remove">&times;</button></span></li>`; }).join("") || `<li class="open"><span></span><span class="ps">Empty</span><span></span></li>`}</ul>`;
    }
    function teamsPanel() {
      const d = D();
      const id = ui.view != null ? ui.view : d.round1.find((x) => x !== me());
      return `<div style="padding:8px 12px 0"><label class="sr" for="fk-view">Team</label><select id="fk-view">${d.round1.map((x) => `<option value="${x}"${x === id ? " selected" : ""}>${esc(team(x).name)}${isMe(team(x)) ? " (you)" : ""}</option>`).join("")}</select>${canTrade() && !isMe(team(id)) && D().phase === "live" ? `<button class="btn xs" data-trade-with="${id}" style="margin-top:8px">Trade with ${esc(team(id).abbr)}</button>` : ""}</div>${rosterPanel(id)}`;
    }

    /* render and wire */
    // Sim to my pick: every bot ahead of you picks at once. Bots normally wait botDelay; with it at zero, one tick runs
    // them all and stops at your pick, since your clock hasn't run out. With autodraft on it runs to the end.
    function simAhead() {
      const d = D(); if (d.phase !== "live" || d.paused) return;
      const t = now(), c = F.onClock(d, t);
      if (!c) return;
      if (F.isBot(d.teams[c.team])) d.clockStart = t;          // your clock starts now, not when the last bot came up
      const keep = d.botDelay; d.botDelay = 0;
      let moved = 0;
      try { moved = F.tick(d, ctx, t, 5000); } finally { d.botDelay = keep; }
      if (moved) { save(); render(); }
    }
    // Search, a position chip, a sort or a stat view only change the player list, so only the list is redrawn.
    function renderLeft() {
      const sec = $(".dr-left", el), bar = sec && $(".dr-bar", sec);
      if (!bar || ui.left !== "players" || D().phase === "heist") return render();
      const k = focusKey(el);
      while (bar.nextSibling) bar.nextSibling.remove();
      bar.insertAdjacentHTML("afterend", phoneNeeds() + posFilter(sport, ui.f.pos, [], D().lineup, needChips(me())) + players());
      keyboardPlayers(sec);
      refocus(el, k);
    }
    function render() {
      const d = D();
      if (d.phase === "done" && ui.phase && ui.phase !== "done") { ui.left = "results"; ui.mobileRight = false; }
      ui.phase = d.phase;
      const lefts = [["players", "Players"], ["board", "Board"], ["picks", auction() ? "Sales" : "Picks"], ["proj", "Projected"]].concat(mystery() ? [["packages", "Packages"]] : [], elephant() && d.phase !== "done" ? [["steal", "Steal"]] : [], d.phase === "done" ? [["results", "Results"]] : []);
      if (!lefts.some((x) => x[0] === ui.left)) ui.left = "players";
      const offers = me() != null ? d.trades.filter((T) => T.status === "pending" && T.to === me()).length : 0;
      const unread = opts.chat && ui.right !== "chat" ? opts.chat.unread() : 0;
      const rights = (me() != null ? [["team", "My team"], ["queue", "Queue"], ["teams", "Teams"]].concat(d.trading ? [["trades", offers ? `Trades (${offers})` : "Trades"]] : []) : [["teams", "Teams"]])
        .concat(opts.chat ? [["chat", unread ? `Chat (${unread})` : "Chat"]] : []);
      if (!rights.some((x) => x[0] === ui.right)) ui.right = rights[0][0];
      const keep = { f: focusKey(el), scroll: {} };
      $$("#fk-pool,#fk-board,#fk-picks,.dr-panel,#fk-ticker,#fk-seg,#fk-seg2,#fk-rchatl", el).forEach((x) => (keep.scroll[x.id || x.className] = [x.scrollTop, x.scrollLeft]));
      if (d.phase === "heist") { const sc = $(".hz-scroll", el), y = sc ? sc.scrollTop : 0; el.innerHTML = `<div class="droom hzr fk-dark">${top()}<div class="hz-scroll">${heistView()}</div></div>`; if (y) $(".hz-scroll", el).scrollTop = y; drawTimer(); if (opts.onChange) opts.onChange(d); return; }
      const left = { players, board, picks, results, packages, steal: steals, proj: projected }[ui.left]();
      const right = { team: () => rosterPanel(me()), queue: queuePanel, teams: teamsPanel, trades: tradesPanel, chat: chatPanel }[ui.right]();
      // one view switch: the left views, plus the right panels as views on narrow screens
      const seg = `<div class="seg" id="fk-seg" role="group" aria-label="View">${lefts.map(([k, n]) => `<button type="button" data-left="${k}" aria-pressed="${!ui.mobileRight && ui.left === k}">${esc(n)}</button>`).join("")}${rights.map(([k, n]) => `<button type="button" class="show-m" data-mright="${k}" aria-pressed="${ui.mobileRight && ui.right === k}">${esc(n)}</button>`).join("")}</div>`;
      const filters = ui.left === "players" ? `${search(ui.f)}<label class="sr" for="fk-show">Show</label><select id="fk-show" style="width:auto;border-radius:999px;min-height:36px;font-size:13px"><option value="avail"${ui.show === "avail" ? " selected" : ""}>Available</option><option value="all"${ui.show === "all" ? " selected" : ""}>All players</option></select>${viewSelect(sport, "fk-statv")}` : "";
      const tq = d.phase === "live" && !auction() && me() != null ? F.onClock(d, now()) : null;
      if (tq && tq.trivia && tq.team === me() && !team(me()).auto) {
        const q = tq.trivia;
        el.innerHTML = `<div class="droom fk-dark">${top()}${ticker()}<div class="tq" role="dialog" aria-labelledby="tq-q"><div class="tq-card">
          <p class="tq-k">Pick ${esc(plab(tq.index))}: answer first</p><h2 id="tq-q" class="disp">${esc(q.q)}</h2>
          <div class="tq-o">${q.opts.map((o, i) => `<button type="button" class="tq-b" data-tq="${i}"><span class="tq-l">${"ABCD"[i]}</span>${esc(o)}</button>`).join("")}</div>
          <p class="ps tq-n">Right, and you pick with a full clock. Wrong or out of time, and your pick moves to the end of the round.</p></div></div></div>`;
        drawTimer();
        if (ui.told !== "q" + tq.index) { ui.told = "q" + tq.index; toast("Your question. Answer to pick."); alerts.chime("clock"); alerts.flash("Your question!"); alerts.notify("Your question", `${d.name || "Your draft"}: answer to make pick ${plab(tq.index)}`); }
        if (opts.onChange) opts.onChange(d);
        return;
      }
      el.innerHTML = `<div class="droom fk-dark">${top()}${ticker()}${offerStrip()}<div class="dr-main${ui.mobileRight ? " right" : ""}">
        <section class="dr-left"><div class="dr-bar">${seg}${filters}</div>${ui.left === "players" ? phoneNeeds() + posFilter(sport, ui.f.pos, [], d.lineup, needChips(me())) : ""}${left}</section>
        <aside class="dr-right"><div class="seg hide-m" role="group" aria-label="Panel">${rights.map(([k, n]) => `<button type="button" data-right="${k}" aria-pressed="${ui.right === k}">${esc(n)}</button>`).join("")}</div><div class="show-m" style="padding:10px 12px 0">${seg.replace('id="fk-seg"', 'id="fk-seg2"')}</div><div class="dr-panel">${right}</div></aside></div></div>`;
      $$("#fk-pool,#fk-board,#fk-picks,.dr-panel,#fk-ticker,#fk-seg,#fk-seg2,#fk-rchatl", el).forEach((x) => { const v = keep.scroll[x.id || x.className]; if (v) { x.scrollTop = v[0]; x.scrollLeft = v[1]; } });
      const tk = $("#fk-ticker", el), cur = tk && $(".tk.now", tk);
      const bd = $("#fk-board", el), mineH = bd && $(".bgrid .h.me", bd);
      if (bd && mineH && !keep.scroll["fk-board"] && !ui.boardSeen) { ui.boardSeen = true; bd.scrollLeft = Math.max(0, mineH.offsetLeft - bd.clientWidth / 2 + mineH.offsetWidth / 2); }
      if (cur && tk && (!keep.scroll["fk-ticker"] || ui.lastPick !== F.made(d).length)) tk.scrollLeft = Math.max(0, cur.offsetLeft - tk.clientWidth * 0.3);
      ui.lastPick = F.made(d).length;
      // on a phone the view switch scrolls: when the view changes, bring its button into sight
      const view = ui.mobileRight ? "r:" + ui.right : "l:" + ui.left;
      if (ui.lastView !== view) $$("#fk-seg,#fk-seg2", el).forEach((sg) => { const on = $('[aria-pressed="true"]', sg); if (on && sg.scrollWidth > sg.clientWidth) sg.scrollLeft = Math.max(0, on.offsetLeft - (sg.clientWidth - on.offsetWidth) / 2); });
      ui.lastView = view;
      keyboardPlayers(el);
      refocus(el, keep.f);
      const cl = ui.right === "chat" && $("#fk-rchatl", el);
      if (cl) { const n = opts.chat.posts().length; if (ui.chatN !== n) { cl.scrollTop = cl.scrollHeight; ui.chatN = n; } }
      drawTimer();
      // say it when you come on the clock (the toast is a live region), chime, and flash the tab if it's in the
      // background; a softer chime when you're on deck. Autodraft stays quiet.
      if (d.phase === "live" && !d.paused && me() != null && !team(me()).auto) {
        if (!auction()) {
          const c = F.onClock(d, now());
          if (c && c.team === me() && ui.told !== c.index) {
            ui.told = c.index; toast(c.makeup ? "You were robbed. Pick again." : `You're on the clock: pick ${c.pick}.`);
            alerts.chime("clock"); alerts.flash("Your pick!"); alerts.notify("You're on the clock", `${d.name || "Your draft"}: pick ${plab(c.index)}`);
          } else if (c && c.team !== me()) {
            alerts.stop();
            const next = F.nextPickOf(d, me());
            if (next != null && next - 1 === c.index + 1 && ui.deck !== next) { ui.deck = next; toast("You're on deck."); alerts.chime("deck"); alerts.notify("You're on deck", `${d.name || "Your draft"}: you pick next`); }
          }
        } else {
          const st = F.auctionState(d, now()), k = (d.sales || []).length;
          const lot = d.auction.lot;
          if (lot && ui.highBid && ui.highBid.pid === lot.pid && ui.highBid.team === me() && lot.team !== me()) {
            toast(`You've been outbid: ${money(lot.bid)}.`); alerts.chime("deck");
          }
          ui.highBid = lot ? { pid: lot.pid, team: lot.team } : null;
          if (st && st.kind === "nominate" && st.team === me() && ui.nomTold !== k) { ui.nomTold = k; toast("Your nomination."); alerts.chime("clock"); alerts.flash("Your nomination!"); alerts.notify("Your nomination", d.name || "Your draft"); }
          else if (!(st && st.kind === "nominate" && st.team === me())) alerts.stop();
        }
      } else alerts.stop();
      // autopick follows your board when you have one: it rides on your team so the server's clock uses it too
      if (me() != null && d.phase !== "done") {
        const bd = myBoard.of(sport.key, opts.players), t = team(me());
        const want = bd.custom ? bd.ids.slice(0, 300) : null;
        if (JSON.stringify(t.board || null) !== JSON.stringify(want)) { if (want) t.board = want; else delete t.board; opts.save(d); refresh(); }
      }
      if (opts.onChange) opts.onChange(d);
    }
    function drawTimer() {
      const d = D(), n = now();
      let left = null, total = 1;
      if (d.phase === "heist") { left = Math.max(0, d.heist.ends - n); total = F.heistRules(d).clock * 1000; }
      else if (d.packs && d.phase === "live") { left = d.clock ? Math.max(0, d.clockStart + d.clock * 1000 - n) : null; total = (d.clock || 1) * 1000; }
      else if (auction()) { const st = F.auctionState(d, n); left = st ? st.left : null; total = st && st.kind === "lot" ? d.auction.bidClock * 1000 : d.auction.nomClock * 1000; }
      else if (F.onClock(d, n) && F.onClock(d, n).trivia) { const c = F.onClock(d, n); left = Math.max(0, c.left - 2500); total = (d.trivia.sec || 15) * 1000; }   // the grace for the question to arrive isn't shown
      else { const c = F.onClock(d, n); left = c ? c.left : null; total = d.bank ? (c && team(c.team).bank > d.bank.floor * 1000 ? bankFull() : d.bank.floor * 1000) : (d.clock || 1) * 1000; }
      const fin = left != null && Number.isFinite(left);
      for (const [ti, ri] of [["#fk-timer", "#fk-ring"], ["#fk-timer2", "#fk-ring2"]]) {
        const t = $(ti, el), ring = $(ri, el);
        if (t) t.textContent = fin ? fmtLeft(left) : "";
        if (ring) { ring.style.setProperty("--p", fin ? Math.max(0, Math.min(1, left / total)).toFixed(3) : 1); ring.classList.toggle("hot", fin && left < 10000); }
      }
    }
    const act = (fn) => { const r = fn(); if (r && r.ok === false) { toast(r.why, true); return false; } save(); render(); return true; };

    function openCard(pid) {
      const d = D(), p = ctx.byId[pid];
      if (!p) return;
      const mine = me(), taken = ctx.own[pid] != null;
      const c = !auction() && d.phase === "live" ? F.onClock(d, now()) : null;
      const st = auction() && d.phase === "live" ? F.auctionState(d, now()) : null;
      const can = mine != null && !taken ? F.canAdd(d, ctx, mine, p) : null;
      let actions = "";
      if (mine != null && !taken) actions += `<button class="btn" data-card="queue">${team(mine).queue.includes(pid) ? "Remove from queue" : "Add to queue"}</button>`;
      if (can && can.ok && (d.packs ? F.packSlot(d, mine) >= 0 : c && c.team === mine)) actions += `<button class="btn go" data-card="pick">Draft ${esc(last(p.n))}</button>`;
      const sk = taken && ctx.own[pid] !== mine ? stealOk(pid) : null;
      if (sk && sk.ok) actions += `<button class="btn warn" data-card="steal">Steal ${esc(last(p.n))}</button>`;
      if (can && can.ok && st && st.kind === "nominate" && st.team === mine) actions += `<button class="btn go" data-card="nominate">Nominate</button>`;
      const status = taken ? `${teamAv(team(ctx.own[pid]), "sm")} On ${esc(team(ctx.own[pid]).name)}${elephant() ? `, stolen ${F.stealsOf(d, pid)} of ${d.steals.freeze} times${sk && !sk.ok && c && c.team === mine ? `. <span class="bad">${esc(sk.why)}</span>` : ""}` : ""}` : can && !can.ok ? `<span class="bad">${esc(can.why)}</span>` : "";
      const Dl = dialog(playerCard(sport, p, { scoring: d.scoring, actions, status }), null, { wide: true, dark: true });
      $$("[data-card]", Dl).forEach((b) => b.addEventListener("click", () => {
        const a = b.dataset.card;
        if (a === "pick") { if (act(() => F.pick(D(), ctx, mine, pid, now()))) Dl.close(); }
        else if (a === "steal") { Dl.close(); const from = team(ctx.own[pid]); confirm(`Steal ${p.n}?`, `${esc(from.name)} picks again right away and can't take him straight back.`, "Steal him", () => { if (act(() => F.steal(D(), ctx, mine, pid, now()))) { ui.left = "players"; render(); toast(`You stole ${p.n} from ${from.abbr}.`); } }); }
        else if (a === "nominate") { Dl.close(); nominateDialog(pid); }
        else { toggleQueue(pid); Dl.close(); }
      }));
    }
    function nominateDialog(pid) {
      const d = D(), p = ctx.byId[pid], max = F.maxBid(d, me());
      dialog(`<div class="pc-h">${playerAv(sport, p, "lg")}<div><h3 class="disp">Nominate ${esc(p.n)}</h3><div class="ps">Value ${money(p.$)}. You can bid up to ${money(max)}.</div></div></div><form class="stack"><div class="field"><label for="fk-open">Opening bid</label><input type="number" id="fk-open" name="amt" min="${d.auction.minBid}" max="${max}" value="${d.auction.minBid}"></div><div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">Nominate</button></div></form>`,
        (fd) => act(() => F.nominate(D(), ctx, me(), pid, +fd.get("amt"), now())), { dark: true });
    }
    function toggleQueue(pid) {
      const t = team(me());
      if (t.queue.includes(pid)) t.queue = t.queue.filter((x) => x !== pid); else t.queue.push(pid);
      save(); render();
    }

    el.addEventListener("click", (e) => {
      const lb = e.target.closest("[data-left]");
      if (lb) { ui.left = lb.dataset.left; ui.mobileRight = false; render(); return; }
      const rb = e.target.closest("[data-right]");
      if (rb) { ui.right = rb.dataset.right; render(); return; }
      const mr = e.target.closest("[data-mright]");
      if (mr) { ui.right = mr.dataset.mright; ui.mobileRight = true; render(); return; }
      const fp = e.target.closest("[data-fpos]");
      if (fp) { ui.f.pos = fp.dataset.fpos; if (fp.classList.contains("br-chip")) { ui.left = "players"; ui.mobileRight = false; render(); } else renderLeft(); return; }
      const th = e.target.closest("th[data-sort]");
      if (th) { const cols = poolColumns(sport, { scoring: D().scoring, group: groupOf(sport, ui.f) }); ui.sort = nextSort(ui.sort, th.dataset.sort, cols); renderLeft(); return; }
      const tb = e.target.closest("[data-tr-yes],[data-tr-no],[data-tr-cancel],[data-trade-with]");
      if (tb) {
        e.stopPropagation();
        const ds = tb.dataset;
        if (ds.tradeWith) { openTrade(+ds.tradeWith); return; }
        if (ds.trCancel) { act(() => F.cancel(D(), +ds.trCancel, me(), now())); return; }
        const yes = !!ds.trYes, id = +(ds.trYes || ds.trNo);
        if (yes) confirm("Accept this trade?", "The picks and players change hands right away.", "Accept trade", () => { if (act(() => F.respond(D(), ctx, id, me(), true, now()))) toast("Trade accepted."); });
        else if (act(() => F.respond(D(), ctx, id, me(), false, now()))) toast("Offer declined.");
        return;
      }
      const ov = e.target.closest("[data-offer-view]");
      if (ov) { const T = (D().trades || []).find((x) => x.id === +ov.dataset.offerView); if (T) offerDialog(T); return; }
      if (e.target.closest("[data-offer-hide]")) { ui.offer = null; render(); return; }
      const mb = e.target.closest("button[data-more]");
      if (mb) { ui.limit = (ui.limit || 100) + 250; mb.dataset.more === "fk-pool" ? renderLeft() : render(); return; }
      const sb = e.target.closest("button[data-steal]");
      if (sb) {
        e.stopPropagation();
        const pid = sb.dataset.steal, p = ctx.byId[pid], from = team(ctx.own[pid]);
        confirm(`Steal ${p.n}?`, `${esc(from.name)} picks again right away and can't take him straight back. You have ${F.stealsLeft(D(), me())} steal${F.stealsLeft(D(), me()) === 1 ? "" : "s"} left.`, "Steal him", () => { if (act(() => F.steal(D(), ctx, me(), pid, now()))) { ui.left = "players"; render(); toast(`You stole ${p.n} from ${from.abbr}.`); } });
        return;
      }
      const hz = e.target.closest("button[data-hz]");
      if (hz) { heistPick(hz.dataset.hz, hz.dataset.pid); return; }
      const tqb = e.target.closest("button[data-tq]");
      if (tqb) {
        const r = F.triviaAnswer(D(), ctx, me(), +tqb.dataset.tq, now());
        if (!r.ok) { toast(r.why, true); render(); return; }
        save(); render();
        toast(r.right ? "Right! Make your pick." : `Not quite: it was ${r.answer}. Your pick moves to the end of the round.`, !r.right);
        return;
      }
      const b = e.target.closest("button[data-pick],button[data-queue],button[data-nominate],button[data-bid],button[data-bidq],button[data-qup],button[data-act],th[data-act]");
      if (b) {
        e.stopPropagation();
        const d = D(), n = now();
        if (b.dataset.pick) {
          const pid = b.dataset.pick, myst = d.packs && d.packs.mystery && d.packs.mystery[pid], cost = d.packs && d.packs.price ? F.packPrice(d, me(), pid) : null;
          if (act(() => F.pick(d, ctx, me(), pid, n))) { const p = ctx.byId[pid]; if (myst) toast(`The mystery card: ${p.n}, ${S.positions(p)[0]} ${p.t}, ranked #${p.rank}. You paid $${cost}.`); else if (p) toast(`You drafted ${p.n}.`); }
        }
        else if (b.dataset.queue) toggleQueue(b.dataset.queue);
        else if (b.dataset.nominate) nominateDialog(b.dataset.nominate);
        else if (b.dataset.bidq) { ui.bidAmt = +b.dataset.bidq; const inp = $("#fk-bid", el), bv = $("#fk-bidv", el); if (inp) inp.value = ui.bidAmt; if (bv) bv.textContent = money(ui.bidAmt); }
        else if (b.dataset.bid) {
          if (!d.auction.lot || d.auction.lot.pid !== b.dataset.lot) { toast("That nomination ended. Review the new player before bidding.", true); render(); return; }
          act(() => F.bid(d, ctx, me(), +b.dataset.bid, n));
        }
        else if (b.dataset.qup) { const q = team(me()).queue, i = q.indexOf(b.dataset.qup); if (i > 0) { [q[i - 1], q[i]] = [q[i], q[i - 1]]; save(); render(); } }
        else {
          const a = b.dataset.act;
          if (a === "start") act(() => F.start(d, n, ctx));
          else if (a === "pause") act(() => F.pause(d, n, !d.paused));
          else if (a === "undo") act(() => F.undo(d, ctx, n));
          else if (a === "pass") act(() => F.pass(d, ctx, me(), n));
          else if (a === "bid") {
            if (!d.auction.lot || d.auction.lot.pid !== b.dataset.lot) { toast("That nomination ended. Review the new player before bidding.", true); render(); return; }
            const inp = $("#fk-bid", el); if (!inp || !inp.reportValidity()) return;
            act(() => F.bid(d, ctx, me(), +inp.value, n));
          }
          else if (a === "test-sound") { alerts.test().then(ok => toast(ok ? (alerts.on() ? "Test sound played. Leave this tab open for your turn alert." : "Sound is off. Turn sound on to hear alerts.") : "Sound is blocked. Check your browser’s sound settings.", !ok)); }
          else if (a === "trade") openTrade();
          else if (a === "recap") { const txt = recapText(); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast("Recap copied. Paste it in your group chat."), () => dialog(`<h3>Draft recap</h3><textarea rows="14" style="width:100%;font:inherit;font-size:13px" readonly>${esc(txt)}</textarea><div class="acts"><button type="button" class="btn" data-close>Close</button></div>`)); }
          else if (a === "alerts") { const v = !alerts.on(); alerts.set(v).then(() => { toast(v ? (typeof Notification !== "undefined" && Notification.permission === "denied" ? "Alerts on. Your browser blocks notifications, so you'll get the chime and tab only." : "Alerts on: a chime, and a notification when this tab is in the background.") : "Alerts off."); render(); }); }
          else if (a === "heistgo") {
            const sel = hsel();
            if (!opts.heist) { if (act(() => F.heistMove(d, ctx, me(), sel, n))) toast("Locked in."); }
            else if (!ui.hzBusy) {
              // a shared league: the moves go to the server sealed, and the league only learns that you're in
              const c = F.heistCheck(d, ctx, me(), sel);
              if (!c.ok) toast(c.why, true);
              else {
                ui.hzBusy = true; b.disabled = true;
                opts.heist.lock(c.move).then((r) => {
                  if (r && r.ok) { ui.hzMine = c.move; d.heist.moves[me()] = { sealed: true, at: n }; toast("Locked in. Your moves stay hidden until the reveal."); }
                  else toast((r && r.error) || "Couldn't lock in. Try again.", true);
                }, (e) => toast(`Couldn't lock in: ${e.message}`, true)).then(() => { ui.hzBusy = false; render(); });
              }
            }
          }
          else if (a === "respin") act(() => { const r = F.respin(d, ctx, me(), n); if (r.ok) toast(`The wheel lands on ${teamFull(r.team)}.`); return r; });
          else if (a === "rlall") { ui.rlAll = !ui.rlAll; render(); }
          else if (a === "projsort") { ui.projSort = b.dataset.k || null; render(); }
          else if (a === "fitall") { ui.fitAll = !ui.fitAll; render(); }
          else if (a === "rip") {
            const q = F.packAt(d, F.packTurnNow(d)).q;
            (ui.opened = ui.opened || {})[q] = true; try { sessionStorage.setItem(packKey(q), "1"); } catch (e) { /* private mode */ }
            ui.rip = { q, at: Date.now() }; render();
          }
          else if (a === "sim") simAhead();
          else if (a === "botspeed") {
            const i = BOT_SPEEDS.findIndex((x) => x[2] === D().botDelay), nx = BOT_SPEEDS[(Math.max(0, i) + 1) % BOT_SPEEDS.length];
            D().botDelay = nx[2]; botSpeed.set(nx[0]); save(); render(); toast(`Bots pick ${nx[1].toLowerCase()} now.`);
          }
          else if (a === "auto") { const t = team(me()); t.auto = !t.auto; if (t.auto) toast("Autodraft is on: the bot picks for you."); save(); render(); }
        }
        return;
      }
      const pl = e.target.closest("[data-player]");
      if (pl && pl.dataset.player) { e.preventDefault(); openCard(pl.dataset.player); }
    });
    el.addEventListener("keydown", (e) => {
      if (e.target.id === "fk-bid" && e.key === "Enter") { e.preventDefault(); $("[data-act=bid]", el).click(); }
    });
    el.addEventListener("input", (e) => {
      // wait for a pause in typing, then redraw the list only
      if (e.target.id === "fk-q") { ui.f.q = e.target.value; clearTimeout(ui.qT); ui.qT = setTimeout(renderLeft, 140); }
      if (e.target.id === "fk-bid") { ui.bidAmt = +e.target.value; const bv = $("#fk-bidv", el); if (bv) bv.textContent = money(ui.bidAmt || 0); }
      if (e.target.id === "fk-rchat") ui.chatDraft = e.target.value;
    });
    el.addEventListener("keydown", (e) => {
      if (e.target.id === "fk-rchat" && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.target.form.requestSubmit(); }
    });
    el.addEventListener("submit", async (e) => {
      if (e.target.id !== "fk-rchatf" || !opts.chat) return;
      e.preventDefault();
      const body = (ui.chatDraft || "").trim();
      if (!body || ui.sending) return;
      ui.sending = true;
      const r = await opts.chat.send(body).catch((err) => ({ error: err.message }));
      ui.sending = false;
      if (r && r.error) { toast(r.error, true); return; }
      ui.chatDraft = ""; ui.chatN = -1; render();
      const box = $("#fk-rchat", el); if (box) box.focus();
    });
    el.addEventListener("change", (e) => {
      if (e.target.id === "fk-show") { ui.show = e.target.value; renderLeft(); }
      if (e.target.id === "fk-statv" || e.target.id === "fk-statv2") { setView(sport, e.target.value); render(); }
      if (e.target.id === "fk-view") { ui.view = +e.target.value; render(); }
    });

    // The clock: redraw the timer; when this page drives the draft, bots and expired clocks move it.
    let lastSig = "";
    const sig = () => { const d = D(); return [d.phase, d.paused, F.made(d).length, d.auction && d.auction.lot ? d.auction.lot.bid + ":" + d.auction.lot.team + ":" + (d.auction.lot.passed || []).length : "", (d.trades || []).map((T) => T.status[0]).join(""), d.trivia ? `${d.trivia.cur ? d.trivia.cur.k : ""}:${(d.trivia.log || []).length}:${d.order.join("")}` : ""].join("|"); };
    let seenOffers = new Set((D().trades || []).map((T) => T.id)), seenDone = new Set((D().trades || []).filter((T) => T.status === "accepted").map((T) => T.id)), ready = true;
    let seenSteals = (D().log || []).filter((x) => x.kind === "steal").length;
    // a trivia draft: say it when a team misses its question (your own wrong answers are told when you answer)
    let seenMiss = ((D().trivia && D().trivia.log) || []).length;
    const newMisses = () => {
      const log = (D().trivia && D().trivia.log) || [];
      for (const x of log.slice(seenMiss)) {
        if (x.ok) continue;
        if (x.team === me()) { if (x.got == null) toast("Time's up. Your pick moves to the end of the round.", true); continue; }
        toast(`${team(x.team).name} missed ${x.got == null && !x.bot ? "the clock on " : ""}their question. That pick moves to the end of the round.`);
      }
      seenMiss = log.length;
    };
    const newSteals = () => {
      const st = (D().log || []).filter((x) => x.kind === "steal");
      for (const x of st.slice(seenSteals)) {
        const p = ctx.byId[x.pid];
        if (x.team === me()) continue;
        toast(x.from === me() ? `${team(x.team).name} stole ${p ? p.n : "a player"} from you. Pick again now.` : `${team(x.team).abbr} stole ${p ? p.n : "a player"} from ${team(x.from).abbr}.`, x.from === me());
      }
      seenSteals = st.length;
    };
    // An offer to you opens right away, over whatever you're doing (or as soon as the dialog you have open closes).
    // If the draft is holding for it, it says so and how long the hold lasts.
    const newOffers = () => {
      const d = D();
      // everyone in the room hears about a trade that went through
      for (const T of d.trades || []) {
        if (T.status !== "accepted" || seenDone.has(T.id)) continue;
        seenDone.add(T.id);
        if (ready && T.from !== me() && T.to !== me()) toast(`${team(T.from).name} and ${team(T.to).name} made a trade. See Trades.`);
      }
      ready = true;
      for (const T of d.trades || []) {
        if (seenOffers.has(T.id)) continue;
        if (T.status !== "pending" || T.to !== me() || T.from === me()) { seenOffers.add(T.id); continue; }
        seenOffers.add(T.id);
        ui.offer = T.id;
        toast(`${team(T.from).name} sent you a trade offer.`);
        // the clock chime, a flashing tab title and a desktop notification if they're on: an offer has a timer too
        alerts.chime("clock");
        alerts.flash("Trade offer");
        alerts.notify("Trade offer", `${team(T.from).name} sent you a trade offer.`);
        return;
      }
    };
    // an offer for you: a strip across the room, not a pop-up over your pick; Review opens the full offer
    function offerStrip() {
      const d = D(), T = ui.offer != null && (d.trades || []).find((x) => x.id === ui.offer && x.status === "pending" && x.to === me());
      if (!T) return "";
      const name = (id) => (F.isPickId(id) ? `pick ${plab(F.pickIdx(id))}` : (ctx.byId[id] || {}).n || "a player");
      const list = (ids) => ids.map(name).join(" and ");
      const held = d.hold && d.hold.trade === T.id;
      return `<div class="dr-offer" role="status"><span class="grow"><b>${esc(team(T.from).name)} offers ${esc(list(T.give))}</b> <span class="ps">for ${esc(list(T.get))}${held ? `. The draft waits up to ${Math.max(1, Math.round(F.holdLeft(d, now()) / 1000))} seconds while you decide.` : "."}</span></span>
        <button type="button" class="btn sm go" data-offer-view="${T.id}">Review</button><button type="button" class="btn sm" data-tr-no="${T.id}">Decline</button><button type="button" class="btn sm ghost" data-offer-hide title="Hide this offer for now">Later</button></div>`;
    }
    function offerDialog(T) {
      const d = D(), held = d.hold && d.hold.trade === T.id;
      const Dl = dialog(`<h3>${esc(team(T.from).name)} sent you a trade offer</h3>
        <p class="ps" style="margin:0 0 10px">${held ? `The draft is stopped while you decide: ${Math.max(1, Math.round(F.holdLeft(d, now()) / 1000))} seconds at most, then it goes on and the offer stays open.` : "The draft keeps going while you decide. The offer stays open until a pick in it is made."}</p>
        ${tradeCard(sport, roomTradeVM(T, ""))}
        <div class="acts"><button type="button" class="btn" data-od="later">Decide later</button><button type="button" class="btn" data-od="counter">Counter</button><button type="button" class="btn warn" data-od="no">Decline</button><button type="button" class="btn go" data-od="yes">Accept</button></div>`, null, { wide: true, dark: true });
      Dl.addEventListener("click", (e) => {
        const b = e.target.closest("[data-od]"); if (!b) return;
        const k = b.dataset.od;
        Dl.close();
        if (k === "yes") { if (act(() => F.respond(D(), ctx, T.id, me(), true, now()))) toast("Trade accepted."); }
        else if (k === "no") { if (act(() => F.respond(D(), ctx, T.id, me(), false, now()))) toast("Offer declined."); }
        else if (k === "counter") { act(() => F.respond(D(), ctx, T.id, me(), false, now())); openTrade(T.from, { give: T.get.slice(), get: T.give.slice() }); }
        else { ui.right = "trades"; render(); }
      });
    }
    timer = setInterval(() => {
      // a paused or finished draft has no clock to run; check for changes from elsewhere once a second
      if (opts.drive && D().phase === "heist") {
        // sealed moves: once the heist is due, open them on the server, then settle it
        if (F.heistSealed(D()) && F.heistDue(D(), now())) {
          if (opts.heist && !ui.hzOpening && Date.now() - (ui.hzTried || 0) > 2000) {
            ui.hzOpening = true; ui.hzTried = Date.now();
            opts.heist.get().then((r) => {
              if (r && r.open && D().phase === "heist" && F.heistUnseal(D(), ctx, r.open) && F.heistTick(D(), ctx, now())) { save(); render(); }
            }, () => {}).then(() => { ui.hzOpening = false; });
          }
          drawTimer(); return;
        }
        if (F.heistTick(D(), ctx, now())) { save(); render(); } else drawTimer();
        return;
      }
      // a draft set for a time starts on its own (the server's clock does it too, if nobody's here)
      if (opts.drive && D().phase === "setup" && D().startAt && now() >= D().startAt) { if (F.start(D(), now(), ctx).ok) { save(); render(); } return; }
      const idle = D().phase !== "live" || (D().paused && !D().hold);
      if (idle && (ui.idleN = (ui.idleN || 0) + 1) % 4) { if (D().phase === "setup" && D().startAt) drawStart(); return; }
      if (opts.drive && D().phase === "live" && F.offerHold(D(), now())) save();
      if (opts.drive && D().phase === "live" && !D().paused) {
        const before = F.made(D()).length;
        const moved = F.tick(D(), ctx, now(), 3);
        if (moved) {
          save();
          const mineAuto = F.made(D()).slice(before).find((pk) => pk.team === me() && pk.auto);
          if (mineAuto && dialogOpen()) { const dl = $("#fk-dlg"); if (dl) dl.close(); }
          if (mineAuto) { const p = ctx.byId[mineAuto.pid], on = me() != null && team(me()).auto; toast(on ? (p ? `Autodraft took ${p.n}.` : "Autodraft made your pick.") : p ? `Time ran out. You took ${p.n}.` : "Time ran out on your pick.", !on); }
        }
      }
      const s = sig();
      if (s !== lastSig) { newOffers(); newSteals(); newMisses(); }
      if (s !== lastSig) { lastSig = s; if (!dialogOpen()) render(); else drawTimer(); } else drawTimer();
    }, 250);

    document.body.classList.add("fk-room");
    render();
    lastSig = sig();
    // your board from your account (another device's edits), for the Mine column
    myBoard.sync(sport.key).then((ch) => { if (ch && !dialogOpen()) render(); });
    return { render, stop: () => { clearInterval(timer); document.body.classList.remove("fk-room"); }, get ctx() { return ctx; }, refresh: () => { refresh(); render(); }, ui };
  }

  /* ---------- lineup builder ---------- */
  // Used by Draft Lab's setup and the start-a-league form: preset buttons (data-preset) and a counter for every slot
  // (data-lb, data-d). lineupStep(sport, lineup, button) is the lineup after a press.
  // Common lineups for each sport, then a counter for every slot.
  const PRESETS = {
    nba: [["Standard", "PG SG G SF PF F C UTIL UTIL UTIL"], ["Two centers", "PG SG G SF PF F C C UTIL UTIL"], ["Shallow", "PG SG SF PF C UTIL UTIL"], ["Deep", "PG SG G SF PF F C C UTIL UTIL UTIL UTIL"]],
    nfl: [["Standard", "QB RB RB WR WR WR TE FLEX K DEF"], ["Superflex", "QB RB RB WR WR WR TE FLEX SFLEX K DEF"], ["2 QB", "QB QB RB RB WR WR WR TE FLEX K DEF"], ["2 WR", "QB RB RB WR WR TE FLEX K DEF"], ["No kicker", "QB RB RB WR WR WR TE FLEX FLEX DEF"]],
    mlb: [["Standard", "C 1B 2B 3B SS OF OF OF UTIL UTIL SP SP RP RP P P P P"], ["Corner and middle", "C 1B 2B 3B SS MI CI OF OF OF OF OF UTIL P P P P P P P P P"], ["Shallow", "C 1B 2B 3B SS OF OF OF UTIL SP SP SP RP RP"]],
  };
  const SLOT_NAMES = { G: "Guard", F: "Forward", UTIL: "Utility", FLEX: "Flex", SFLEX: "Superflex", MI: "Middle infield", CI: "Corner infield", P: "Pitcher" };
  const POS_NAMES = {
    nba: { PG: "Point guard", SG: "Shooting guard", SF: "Small forward", PF: "Power forward", C: "Center" },
    nfl: { QB: "Quarterback", RB: "Running back", WR: "Wide receiver", TE: "Tight end", K: "Kicker", DEF: "Team defense" },
    mlb: { C: "Catcher", "1B": "First base", "2B": "Second base", "3B": "Third base", SS: "Shortstop", OF: "Outfield", SP: "Starting pitcher", RP: "Relief pitcher" },
  };
  const slotDesc = (sport, k) => { const v = sport.slots[k]; if (v !== "*" && v.length === 1 && !SLOT_NAMES[k]) return (POS_NAMES[sport.key] || {})[k] || k; return `${SLOT_NAMES[k] || k}: ${v === "*" ? "any player" : v.join(", ")}`; };
  function lineupBuilder(sport, lineup) {
    const keys = Object.keys(sport.slots).filter((k) => k !== "BN");
    const count = (k) => lineup.filter((x) => x === k).length;
    const cur = lineup.join(" ");
    return `<div class="chips presets" role="group" aria-label="Lineup presets">${(PRESETS[sport.key] || []).map(([n, l]) => `<button type="button" data-preset="${esc(l)}" aria-pressed="${l === cur}">${esc(n)}</button>`).join("")}</div>
      <div class="lb">${keys.map((k) => `<div class="lb-r${count(k) ? " on" : ""}"><span class="pp c${(sport.colors[(sport.slots[k] === "*" ? [] : sport.slots[k])[0]] || 6)}">${esc(k)}</span><span class="ps">${esc(slotDesc(sport, k))}</span>
        <span class="lb-n"><button type="button" class="btn icon" data-lb="${esc(k)}" data-d="-1" aria-label="One fewer ${esc(k)}"${count(k) ? "" : " disabled"}>&minus;</button><b>${count(k)}</b><button type="button" class="btn icon" data-lb="${esc(k)}" data-d="1" aria-label="One more ${esc(k)}"${count(k) >= 9 || lineup.length >= 25 ? " disabled" : ""}>+</button></span></div>`).join("")}</div>
      <div class="slots" id="slotprev">${lineup.map((x) => `<span class="pp c${(sport.colors[(sport.slots[x] === "*" ? [] : sport.slots[x])[0]] || 6)}">${esc(x)}</span>`).join("")}<span class="ps" style="margin-left:6px">${lineup.length} starters</span></div>
      <input type="hidden" name="lineup" value="${esc(cur)}">`;
  }
  // Slots kept in the sport's own order, so a lineup always reads QB, RB, WR...
  const orderLineup = (sport, list) => { const keys = Object.keys(sport.slots); return list.slice().sort((a, b) => keys.indexOf(a) - keys.indexOf(b)); };
  function lineupStep(sport, cur, btn) {
    if (btn.dataset.preset) return btn.dataset.preset.split(" ");
    if (+btn.dataset.d > 0) return orderLineup(sport, cur.concat(btn.dataset.lb));
    const i = cur.lastIndexOf(btn.dataset.lb);
    return i >= 0 ? cur.filter((_, j) => j !== i) : cur;
  }
  // Strips that scroll sideways (tabs, chips, the pick ticker, boards, wide tables): fade the edge with more to see,
  // and bring the current tab or chip into view when it's off the edge. Runs after every redraw.
  const STRIPS = ".fk-nav nav,.fk-subs .wrap,.chips,.ticker,.budgets,.seg,.board,.table-wrap,.scoreboard:not(.list)";
  function hintStrips() {
    for (const el of document.querySelectorAll(STRIPS)) {
      const over = el.scrollWidth > el.clientWidth + 2;
      if (over && !el.dataset.hint) {
        el.dataset.hint = "1";
        el.addEventListener("scroll", () => fadeOf(el), { passive: true });
        const cur = !el.classList.contains("ticker") && el.querySelector('[aria-current="page"],[aria-pressed="true"]');
        if (cur) { const r = cur.getBoundingClientRect(), b = el.getBoundingClientRect(); if (r.left < b.left || r.right > b.right) el.scrollLeft += r.left - b.left - (b.width - r.width) / 2; }
      }
      fadeOf(el, over);
    }
  }
  function fadeOf(el, over = el.scrollWidth > el.clientWidth + 2) {
    el.classList.toggle("fade-l", over && el.scrollLeft > 2);
    el.classList.toggle("fade-r", over && el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }
  if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
    let raf = 0;
    const kick = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(hintStrips); };
    const start = () => { new MutationObserver(kick).observe(document.body, { childList: true, subtree: true }); window.addEventListener("resize", kick); kick(); };
    if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  }
  FK.ui = { leagueBrand, leagueCrest, pushBox, botSpeed, startIn, faceAv, squarePhoto, profileDialog, statColumns, LINEUP_PRESETS: PRESETS, lineupBuilder, orderLineup, lineupStep, slotDesc, esc, $, $$, store, toast, dialog, dialogOpen, focusKey, refocus, keyboardPlayers, confirm, theme, fmtLeft, money, ord, last, initials, ago,
    teamAv, SHAPES, GLYPHS, logoSvg, glyphOf, shapeOf, playerAv, pname, teamName, posChip, posChips, colorOf, injTag,
    proTeam, shell, switcher, route, table, sortRows, nextSort, poolColumns, posFilter, search, passes, groupOf, statCell, label, isPoints,
    playerCard, scoreboard, versus, vsTable, standingsTable, feed, txLine, tradeCard, tradeWindow, room, board: myBoard, viewSelect, setView, initView, hasProj, lineOf };
})(this);
