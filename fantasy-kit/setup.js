/* Fantasy Kit: the controls the setup pages share (Start a league, the mock draft). Each control is plain HTML whose
   inputs carry data-f="<field>", so a page reads them all back with one loop: pills and cards are radios, a switch is a
   checkbox, a stepper keeps its value in a hidden input (data-vals lists its stops), and a slider is a range input. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.FK = root.FK || {}).setup = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ICON = { nba: `<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2v20M5 4.9c2.6 2 4 4.4 4 7.1s-1.4 5.1-4 7.1M19 4.9c-2.6 2-4 4.4-4 7.1s1.4 5.1 4 7.1"/>`,
    nfl: `<ellipse cx="12" cy="12" rx="10.6" ry="6.4" transform="rotate(-40 12 12)"/><path d="M9.2 14.8l5.6-5.6M9.8 12.8l1.4 1.4M11.3 11.3l1.4 1.4M12.8 9.8l1.4 1.4"/>`,
    mlb: `<circle cx="12" cy="12" r="10"/><path d="M6.2 4.2c2 2.2 3 4.8 3 7.8s-1 5.6-3 7.8M17.8 4.2c-2 2.2-3 4.8-3 7.8s1 5.6 3 7.8"/>` };
  const icon = (k, cls) => `<svg class="${cls || "sp-ic"}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${ICON[k]}</svg>`;
  const DRAFTS = { cap: "No draft: build a lineup under a budget. Anyone can pick anyone", sealed: "Rank players in private. The draft runs itself from everyone's list when they lock", pack: "Rip open a pack with a star in it, take one, pass the rest. All at once", snake: "The order flips every round", linear: "The same order every round", "3rr": "A snake, with round three flipped again", auction: "A $200 budget and live bidding on every player",
    mystery: "Each team gets a random package of picks of equal value", elephant: "A snake where your turn can steal a drafted player" };
  const RANGE_FMT = {};
  const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(l)}</option>`;
  const fid = (f, v) => `n-${f}${v != null ? "-" + String(v).replace(/[^a-z0-9]/gi, "_") : ""}`;
  // pills for a short list of choices
  const seg = (f, opts, cur, label, o = {}) => `<div class="sg${o.wrap ? " wr" : ""}${o.cls ? " " + o.cls : ""}" role="radiogroup" aria-label="${esc(label)}">${opts.map(([v, l, dis]) => `<label class="sg-o"><input type="radio" name="g-${f}" id="${fid(f, v)}" data-f="${f}" value="${esc(v)}"${String(v) === String(cur) ? " checked" : ""}${dis ? " disabled" : ""}><span>${esc(l)}</span></label>`).join("")}</div>`;
  // cards with a line of explanation, for the choices that shape the league
  const cards = (f, opts, cur, label, cols) => `<div class="cc" role="radiogroup" aria-label="${esc(label)}"${cols ? ` style="--cols:${cols}"` : ""}>${opts.map(([v, l, sub, dis]) => `<label class="cc-o${dis ? " off" : ""}"><input type="radio" name="g-${f}" id="${fid(f, v)}" data-f="${f}" value="${esc(v)}"${String(v) === String(cur) ? " checked" : ""}${dis ? " disabled" : ""}><span><b>${esc(l)}</b><small>${esc(sub)}</small></span></label>`).join("")}</div>`;
  // minus, the value, plus: for counts
  function stepper(f, vals, cur, fmt, label) {
    let i = vals.indexOf(cur); if (i < 0) i = vals.reduce((b, v, k) => (Math.abs(v - cur) < Math.abs(vals[b] - cur) ? k : b), 0);
    return `<div class="stp" role="group" aria-label="${esc(label)}"><button type="button" class="stp-b" id="${fid(f, "dn")}" data-stp="${f}" data-d="-1" aria-label="${esc(label)}: fewer"${i ? "" : " disabled"}>&minus;</button><output aria-live="polite">${esc(fmt(vals[i]))}</output><button type="button" class="stp-b" id="${fid(f, "up")}" data-stp="${f}" data-d="1" aria-label="${esc(label)}: more"${i < vals.length - 1 ? "" : " disabled"}>+</button><input type="hidden" data-f="${f}" value="${vals[i]}" data-vals="${vals.join(",")}"></div>`;
  }
  // an on/off switch with a title and a line under it
  const toggle = (f, title, sub, on, extra) => `<div class="tg-w"><label class="tg"><input type="checkbox" role="switch" id="${fid(f)}" data-f="${f}"${on ? " checked" : ""}><span class="tg-k" aria-hidden="true"></span><span class="tg-t"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span></label>${on && extra ? `<div class="tg-x">${extra}</div>` : ""}</div>`;
  function range(f, min, max, cur, fmt, label) {
    RANGE_FMT[f] = fmt;
    return `<div class="rg"><div class="rg-h"><label for="${fid(f)}">${esc(label)}</label><output data-out="${f}">${esc(fmt(cur))}</output></div><input type="range" id="${fid(f)}" data-f="${f}" min="${min}" max="${max}" step="1" value="${cur}" style="--pct:${max > min ? ((cur - min) / (max - min)) * 100 : 0}%"><div class="rg-s"><span>${esc(fmt(min))}</span><span>${esc(fmt(max))}</span></div></div>`;
  }
  const numIn = (f, cur, o = {}) => `<span class="ni">${o.pre ? `<i>${esc(o.pre)}</i>` : ""}<input type="number" id="${fid(f)}" data-f="${f}" value="${esc(cur)}" min="${o.min != null ? o.min : 0}" max="${o.max != null ? o.max : 9999}" step="${o.step || 1}" aria-label="${esc(o.label || f)}" inputmode="decimal">${o.post ? `<i>${esc(o.post)}</i>` : ""}</span>`;
  const fld = (label, inner, hint, forId) => `<div class="fl"><div class="fl-l">${forId ? `<label for="${forId}">${esc(label)}</label>` : esc(label)}</div>${inner}${hint ? `<p class="fl-h">${hint}</p>` : ""}</div>`;
  const group = (title, body, sub) => `<section class="gp"><div class="gp-h"><h3>${esc(title)}</h3>${sub ? `<p>${sub}</p>` : ""}</div><div class="gp-b">${body}</div></section>`;
  const noLimit = (x) => (x ? `${x}` : "No limit");
  const STYLE_ART = {
    // the presets on the start-a-league form
    classic: `<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M9 20h6"/>`,
    chaos: `<path d="M3 6h3c4 0 6 12 10 12h5"/><path d="M3 18h3c4 0 6-12 10-12h5"/><path d="M18 3l3 3-3 3M18 15l3 3-3 3"/>`,
    bestball: `<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.6 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>`,
    quick: `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>`,
    snake: `<path d="M4 6h13a3 3 0 0 1 0 6H7a3 3 0 0 0 0 6h13"/><path d="M17 15l3 3-3 3"/>`,
    sealed: `<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 8l9 6 9-6"/>`,
    cap: `<path d="M12 3v18"/><path d="M16.5 7.5c-.7-1.5-2.4-2.5-4.5-2.5-2.5 0-4.5 1.3-4.5 3.4 0 4.6 9.5 2.6 9.5 7.2 0 2.1-2.1 3.4-5 3.4-2.3 0-4.2-1-5-2.7"/>`,
    early: `<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>`,
    late: `<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>`,
    linear: `<path d="M4 6h14M4 12h14M4 18h14"/><path d="M15 3l3 3-3 3M15 9l3 3-3 3M15 15l3 3-3 3"/>`,
    "3rr": `<path d="M4 5h14M18 5v0M20 11H6M4 17h14"/><path d="M15 2l3 3-3 3M9 8l-3 3 3 3M15 14l3 3-3 3"/>`,
    auction: `<path d="M14 4l6 6M11 7l6 6M12.5 5.5l-6 6M9 15l-5 5"/><path d="M4 21h9"/>`,
    mystery: `<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11M12 9c-2.5 0-4.5-1.2-4.5-3s2.5-2 4.5 3c2-5 4.5-4.8 4.5-3s-2 3-4.5 3z"/>`,
    elephant: `<path d="M8 13a5 5 0 1 1 10 0v6h-3v-3h-4v3H8z"/><path d="M8 13c-2 0-3 1.5-3 3.5V20"/><circle cx="14.5" cy="11" r=".8"/>`,
    pack: `<rect x="5" y="6" width="11" height="14" rx="1.6" transform="rotate(-8 10.5 13)"/><rect x="9" y="4" width="11" height="14" rx="1.6"/><path d="M12.5 8h4M12.5 11h4"/>`,
    redraft: `<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4.5h-4.5"/>`,
    keeper: `<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/><circle cx="12" cy="15.5" r="1.3"/>`,
    dynasty: `<path d="M4 18h16l1-10-5 4-4-7-4 7-5-4z"/><path d="M4 21h16"/>`,
    week: `<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M10.5 14.5l1.5 1.5 3-3.5"/>`,
    season: `<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M7 13.5h2M11 13.5h2M15 13.5h2M7 16.5h2M11 16.5h2"/>`,
    full: `<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M7 10h2M11 10h2M15 10h2M7 14h2M11 14h2M15 14h2"/>`,
    sunday: `<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>`,
    prime: `<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>`,
    one: `<path d="M4 8h6v8H4zM14 8h6v8h-6z"/><path d="M10 12h4"/>`,
    custom: `<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><path d="M14.5 16.5l2 2 3.5-4"/>`,
    h2h: `<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/>`,
    h2hcats: `<path d="M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10"/>`,
    roto: `<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`,
    allplay: `<circle cx="12" cy="12" r="2.2"/><circle cx="4.5" cy="6" r="1.6"/><circle cx="19.5" cy="6" r="1.6"/><circle cx="4.5" cy="18" r="1.6"/><circle cx="19.5" cy="18" r="1.6"/><path d="M6 7l4.2 3.6M18 7l-4.2 3.6M6 17l4.2-3.6M18 17l-4.2-3.6"/>`,
    guillotine: `<path d="M5 3v18M19 3v18M5 3h14"/><path d="M7 7h10l-10 5z"/><path d="M9 18h6"/>`,
    vampire: `<path d="M12 9.5c-.8-1.4-1.6-2-2.4-2l.6-1.8-1.6 1.2C6.4 6.6 4 7.4 2 9.6c1.6-.2 2.8.4 3.4 1.6 1-.8 2.2-.7 2.8.4.9-.6 2.1-.2 2.6.9L12 16l1.2-3.5c.5-1.1 1.7-1.5 2.6-.9.6-1.1 1.8-1.2 2.8-.4.6-1.2 1.8-1.8 3.4-1.6-2-2.2-4.4-3-6.6-2.7l-1.6-1.2.6 1.8c-.8 0-1.6.6-2.4 2z"/>` };
  const art = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${STYLE_ART[k]}</svg>`;
  const pickCards = (attr, list, cur, label, disabled) => `<div class="sty-g${list.length > 6 ? " many" : ""}" role="radiogroup" aria-label="${esc(label)}" style="--n:${list.length}">${list.map(([k, l, sub]) => {
    const off = disabled && disabled(k);
    return `<button type="button" role="radio" class="sty${k === cur ? " on" : ""}" data-${attr}="${k}" aria-checked="${k === cur}"${off ? ` disabled title="${esc(off)}"` : ""}>${art(k)}<b>${esc(l)}</b><small>${esc(off || sub)}</small></button>`;
  }).join("")}</div>`;
  const FIELD = {
    nfl: `<svg class="nl-art" viewBox="0 0 600 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">${Array.from({ length: 11 }, (_, i) => `<line x1="${40 + i * 52}" y1="0" x2="${40 + i * 52}" y2="200"/>`).join("")}${Array.from({ length: 50 }, (_, i) => `<line x1="${40 + i * 10.4}" y1="62" x2="${40 + i * 10.4}" y2="70"/><line x1="${40 + i * 10.4}" y1="130" x2="${40 + i * 10.4}" y2="138"/>`).join("")}<text x="${40 + 4 * 52}" y="185">40</text><text x="${40 + 6 * 52}" y="185">50</text><text x="${40 + 8 * 52}" y="185">40</text></svg>`,
    nba: `<svg class="nl-art" viewBox="0 0 600 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true"><circle cx="330" cy="100" r="46"/><line x1="330" y1="0" x2="330" y2="200"/><path d="M600 20 H520 V180 H600"/><path d="M600 -40 A150 150 0 0 0 600 240" /><circle cx="520" cy="100" r="34"/><path d="M60 20 H140 V180 H60"/><circle cx="140" cy="100" r="34"/></svg>`,
    mlb: `<svg class="nl-art" viewBox="0 0 600 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true"><path d="M420 190 L330 100 L420 10 L510 100 Z"/><path d="M420 190 L240 10 M420 190 L600 10"/><circle cx="420" cy="104" r="12"/><path d="M300 30 A170 170 0 0 1 540 30"/><rect x="414" y="184" width="12" height="12" transform="rotate(45 420 190)"/></svg>` };


  const SC_SUB = { half: "Half a point a catch", ppr: "A point a catch", std: "No points for catches", cats9: "FG%, FT%, 3PM, PTS, REB, AST, STL, BLK, TO", points: "Points for every stat", roto5: "R, HR, RBI, SB, AVG, W, SV, K, ERA, WHIP", yoenis: "Adds H, TB, OPS, L, HLD and QS", cp: "Set a value for every stat", cc: "Pick your own categories" };
  const DRAFT_SHORT = { snake: "Snake", auction: "Auction", linear: "Linear", "3rr": "Third-round reversal", mystery: "Mystery packages", elephant: "White elephant", pack: "Pack" };
  return { SC_SUB, DRAFT_SHORT, esc, ICON, icon, DRAFTS, RANGE_FMT, opt, fid, seg, cards, stepper, toggle, range, numIn, fld, group, noLimit, STYLE_ART, art, pickCards, FIELD };
});
