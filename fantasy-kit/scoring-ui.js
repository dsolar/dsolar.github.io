/* Fantasy Kit: the scoring editor's extras (scoring v2), shared by the setup pages.

   The editor keeps its state as plain rows (form.sx), easy to draw and to edit in place:
     { pos:   [[position, stat, points], ...]   extra points per stat for a position ("*" is everyone)
       mult:  { position: x }                   a position's whole score times x
       bonus: [[stat, mark, points], ...] }     points for a game that reaches a mark (football)
   toSpec(sx) turns them into the scoring spec sports.js reads ({ pos, posMult, bonus }).

   html(sp, sx, h) draws the editor with the setup helpers (h = FK.setup). Its inputs carry data-sx="<path>" and its
   buttons data-sxa="<action>", so a page reads them back with read(root, sx) and acts with act(sx, button).
   preview(...) works out who moves under the extras: the top players and how many of each position make the cut. */
(function (root, factory) {
  const m = factory((root.FK && root.FK.sports) || (typeof module !== "undefined" && module.exports && typeof require !== "undefined" ? require("./sports.js") : null));
  if (typeof module !== "undefined" && module.exports) module.exports = m;
  else (root.FK = root.FK || {}).scoringUI = m;
})(this, function (S0) {
  "use strict";
  const S = () => S0 || (typeof self !== "undefined" && self.FK && self.FK.sports) || null;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (x, d = 0) => (Number.isFinite(+x) ? +x : d);

  const empty = () => ({ pos: [], mult: {}, bonus: [] });
  // the main positions a rule can name, per sport (no flex slots)
  const POSITIONS = { nfl: ["QB", "RB", "WR", "TE", "K", "DEF"], nba: ["PG", "SG", "SF", "PF", "C"], mlb: ["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP"] };
  // one tap fills a row in
  const QUICK = {
    nfl: [
      ["tep", "TE premium +0.5 a catch", (sx) => addPos(sx, "TE", "rec", 0.5)],
      ["tepx", "TE premium 1.5x", (sx) => { sx.mult.TE = 1.5; }],
      ["r100", "100-yard rushing game +3", (sx) => addBonus(sx, "rush_yd", 100, 3)],
      ["c100", "100-yard receiving game +3", (sx) => addBonus(sx, "rec_yd", 100, 3)],
      ["p300", "300-yard passing game +3", (sx) => addBonus(sx, "pass_yd", 300, 3)],
      ["tier", "Tiered: 200-yard rushing +3 more", (sx) => { addBonus(sx, "rush_yd", 100, 3); addBonus(sx, "rush_yd", 200, 3); }],
      ["rbc", "RB carries +0.1 each", (sx) => addPos(sx, "RB", "rush_att", 0.1)],
    ],
    nba: [
      ["c-reb", "Centers +0.5 a rebound", (sx) => addPos(sx, "C", "reb", 0.5)],
      ["g-ast", "Guards +0.5 an assist", (sx) => { addPos(sx, "PG", "ast", 0.5); addPos(sx, "SG", "ast", 0.5); }],
    ],
    mlb: [
      ["rp15", "Relievers 1.5x", (sx) => { sx.mult.RP = 1.5; }],
      ["c-x", "Catchers 1.2x", (sx) => { sx.mult.C = 1.2; }],
    ],
  };
  function addPos(sx, pos, stat, pts) {
    const hit = sx.pos.find((r) => r[0] === pos && r[1] === stat);
    if (hit) hit[2] = pts; else sx.pos.push([pos, stat, pts]);
  }
  function addBonus(sx, stat, at, pts) {
    const hit = sx.bonus.find((r) => r[0] === stat && +r[1] === at);
    if (hit) hit[2] = pts; else sx.bonus.push([stat, at, pts]);
  }

  // the old setup form's football toggles (tepOn, b100rOn ...) as rows, for a form saved before the editor
  function fromLegacy(form) {
    const sx = empty();
    if (+form.tepOn) addPos(sx, "TE", "rec", num(form.tepAmt, 0.5) || 0.5);
    if (+form.b100rOn) addBonus(sx, "rush_yd", 100, num(form.b100rAmt, 3) || 3);
    if (+form.b100cOn) addBonus(sx, "rec_yd", 100, num(form.b100cAmt, 3) || 3);
    if (+form.b300pOn) addBonus(sx, "pass_yd", 300, num(form.b300pAmt, 3) || 3);
    return sx;
  }

  // rows -> { pos, posMult, bonus } (null when nothing is set). `extraPos` folds in rules kept elsewhere (the passing
  // TD control: { "*": { pass_td: 2 } }).
  function toSpec(sx, sportKey, extraPos) {
    const pos = {}, posMult = {}, bonus = [];
    const put = (ps, k, v) => { if (!v) return; pos[ps] = pos[ps] || {}; pos[ps][k] = Math.round(((pos[ps][k] || 0) + v) * 1000) / 1000; };
    for (const [ps, w] of Object.entries(extraPos || {})) for (const [k, v] of Object.entries(w)) put(ps, k, num(v));
    for (const [ps, k, v] of (sx && sx.pos) || []) if (ps && k) put(ps, k, num(v));
    for (const [ps, x] of Object.entries((sx && sx.mult) || {})) if (num(x, 1) > 0 && num(x, 1) !== 1) posMult[ps] = num(x);
    const S_ = S();
    if (!sportKey || !S_ || S_.BONUS_OK[sportKey]) for (const [k, at, v] of (sx && sx.bonus) || []) if (k && num(at) > 0 && num(v)) bonus.push({ stat: k, at: num(at), pts: num(v) });
    const out = {};
    if (Object.keys(pos).length) out.pos = pos;
    if (Object.keys(posMult).length) out.posMult = posMult;
    if (bonus.length) out.bonus = bonus;
    return Object.keys(out).length ? out : null;
  }
  const count = (sx) => (sx ? sx.pos.filter((r) => num(r[2])).length + Object.values(sx.mult || {}).filter((x) => num(x, 1) !== 1 && num(x, 1) > 0).length + sx.bonus.filter((r) => num(r[2]) && num(r[1]) > 0).length : 0);

  // a short line for the fine-tune summary
  function summary(sx, sportKey) {
    if (!sx) return "";
    const out = [];
    const tep = sx.pos.find((r) => r[0] === "TE" && r[1] === "rec" && num(r[2]));
    if (tep) out.push(`TE +${num(tep[2])}`);
    for (const [ps, x] of Object.entries(sx.mult || {})) if (num(x, 1) > 0 && num(x, 1) !== 1) out.push(`${ps} ${num(x)}x`);
    const rest = sx.pos.filter((r) => num(r[2]) && r !== tep).length;
    if (rest) out.push(`${rest} position rule${rest > 1 ? "s" : ""}`);
    const S_ = S(), b = S_ && !S_.BONUS_OK[sportKey] ? 0 : sx.bonus.filter((r) => num(r[2]) && num(r[1]) > 0).length;
    if (b) out.push(`${b} game bonus${b > 1 ? "es" : ""}`);
    return out.join(", ");
  }

  function statOpts(sportKey, cur, h) {
    const S_ = S();
    return ((S_ && S_.POINT_STATS[sportKey]) || []).map(([k, l]) => h.opt(k, l, cur)).join("");
  }
  // the editor: position points, multipliers, game bonuses (football), quick adds
  function html(sp, sx, h) {
    const k = sp.key, S_ = S(), bonusOk = !!(S_ && S_.BONUS_OK[k]);
    const posOpts = (cur) => [h.opt("*", "Everyone", cur)].concat(POSITIONS[k].map((p) => h.opt(p, p, cur))).join("");
    const delBtn = (what, i, label) => `<button type="button" class="btn sm ghost sx-del" data-sxa="del-${what}" data-i="${i}" aria-label="${esc(label)}">Remove</button>`;
    const posRows = sx.pos.map(([ps, st, v], i) => `<div class="sx-row">
        <select data-sx="pos.${i}.0" aria-label="Position">${posOpts(ps)}</select>
        <select data-sx="pos.${i}.1" aria-label="Stat">${statOpts(k, st, h)}</select>
        <span class="ni"><i>+</i><input type="number" step="0.05" data-sx="pos.${i}.2" value="${esc(v)}" aria-label="Extra points each"><i>each</i></span>
        ${delBtn("pos", i, "Remove this position rule")}</div>`).join("");
    const multRow = `<div class="sx-mult">${POSITIONS[k].map((p) => `<label class="sx-m"><span>${esc(p)}</span><span class="ni"><input type="number" step="0.05" min="0" max="5" data-sx="mult.${esc(p)}" value="${esc(sx.mult[p] != null ? sx.mult[p] : 1)}" aria-label="${esc(p)} multiplier"><i>x</i></span></label>`).join("")}</div>`;
    const bonusRows = sx.bonus.map(([st, at, v], i) => `<div class="sx-row">
        <select data-sx="bonus.${i}.0" aria-label="Stat">${statOpts(k, st, h)}</select>
        <span class="ni"><i>at</i><input type="number" step="1" min="1" data-sx="bonus.${i}.1" value="${esc(at)}" aria-label="Mark to reach"></span>
        <span class="ni"><i>+</i><input type="number" step="0.5" data-sx="bonus.${i}.2" value="${esc(v)}" aria-label="Bonus points"><i>pts</i></span>
        ${delBtn("bonus", i, "Remove this bonus")}</div>`).join("");
    const quick = (QUICK[k] || []).map(([q, l]) => `<button type="button" data-sxa="quick" data-q="${q}">${esc(l)}</button>`).join("");
    return `<div class="sx">
      ${quick ? `<div class="sx-quick"><span class="ps">Quick add</span><div class="chips" role="group" aria-label="Quick adds">${quick}</div></div>` : ""}
      ${h.group("Position points", `${posRows || `<p class="fl-h" style="margin:0">None yet. A TE premium is a tight end rule on receptions.</p>`}<button type="button" class="btn sm" data-sxa="add-pos">Add a position rule</button>`,
        "Extra points for a stat, for one position or everyone, on top of the scoring above.")}
      ${h.group("Position multipliers", multRow, `Times a position's whole score, after everything else. 1x is no change.${k === "nfl" ? " A TE premium of 1.5x is the other common kind." : ""}`)}
      ${bonusOk ? h.group("Game bonuses", `${bonusRows || `<p class="fl-h" style="margin:0">None yet.</p>`}<button type="button" class="btn sm" data-sxa="add-bonus">Add a bonus</button>`,
        "Points for a game that reaches a mark. Bonuses stack: add 100 and 200 yards for a tiered bonus.") : ""}
      <div id="sx-prev" class="sx-prev" aria-live="polite"></div>
    </div>`;
  }

  // read the editor's inputs back into sx
  function read(rootEl, sx) {
    rootEl.querySelectorAll("[data-sx]").forEach((el) => {
      const [what, a, b] = el.dataset.sx.split(".");
      if (what === "mult") { sx.mult[a] = num(el.value, 1); return; }
      const row = sx[what] && sx[what][+a];
      if (!row) return;
      row[+b] = el.tagName === "SELECT" ? el.value : num(el.value);
    });
    return sx;
  }
  // a button: add, remove, quick add. Returns true when sx changed
  function act(sx, sportKey, btn) {
    const a = btn.dataset.sxa, i = +btn.dataset.i;
    if (a === "add-pos") { sx.pos.push([POSITIONS[sportKey][0] === "QB" ? "TE" : POSITIONS[sportKey][0], (S().POINT_STATS[sportKey][0] || [""])[0], 0.5]); return true; }
    if (a === "add-bonus") { sx.bonus.push(["rush_yd", 100, 3]); return true; }
    if (a === "del-pos") { sx.pos.splice(i, 1); return true; }
    if (a === "del-bonus") { sx.bonus.splice(i, 1); return true; }
    if (a === "quick") { const q = (QUICK[sportKey] || []).find((x) => x[0] === btn.dataset.q); if (q) { q[2](sx); return true; } }
    return false;
  }

  /* Who moves: value the pool twice, the plain scoring and with the extras, and compare overall ranks.
     opts: { sport (attached to its data), players (the data's players), base: scoring key or spec, spec, teams, lineup }
     Returns { top: [{ p, rank, was, pos }], counts: { pos: [now, before] }, movers: [{ p, rank, was }] } */
  function preview(V, o) {
    const S_ = S();
    const run = (spec, key) => {
      const sport = spec ? S_.withScoring(o.sport, spec) : o.sport;
      const ps = o.players.map((p) => Object.assign({}, p));
      V.evaluate(sport, ps, { teams: o.teams, lineup: o.lineup, scoring: spec ? "custom" : key });
      return ps.filter((p) => p.rank != null).sort((a, b) => a.rank - b.rank);
    };
    const before = run(o.baseSpec || null, o.baseKey), after = run(o.spec, o.baseKey);
    const was = Object.fromEntries(before.map((p, i) => [p.id, i + 1]));
    const n = Math.max(12, Math.min(36, (o.teams || 12) * 2));
    const top = after.slice(0, n).map((p, i) => ({ p, rank: i + 1, was: was[p.id] || null, pos: (p.pos || [])[0] }));
    const counts = {};
    for (const x of top) (counts[x.pos] = counts[x.pos] || [0, 0])[0]++;
    for (const p of before.slice(0, n)) { const ps = (p.pos || [])[0]; (counts[ps] = counts[ps] || [0, 0])[1]++; }
    const movers = after.slice(0, n * 2).map((p, i) => ({ p, rank: i + 1, was: was[p.id] || n * 3 })).filter((x) => Math.abs(x.was - x.rank) >= 3).sort((a, b) => Math.abs(b.was - b.rank) - Math.abs(a.was - a.rank)).slice(0, 6);
    return { top, counts, movers, n };
  }
  function previewHtml(r, sportKey, hasExtras) {
    const arrow = (x) => (x.was == null ? `<span class="sx-mv up">new</span>` : x.was > x.rank ? `<span class="sx-mv up">&#9650;${x.was - x.rank}</span>` : x.was < x.rank ? `<span class="sx-mv dn">&#9660;${x.rank - x.was}</span>` : `<span class="sx-mv">&ndash;</span>`);
    const counts = Object.entries(r.counts).filter(([k]) => POSITIONS[sportKey].includes(k)).sort((a, b) => POSITIONS[sportKey].indexOf(a[0]) - POSITIONS[sportKey].indexOf(b[0]))
      .map(([k, [now, was]]) => `<span class="sx-c"><b>${esc(k)}</b> ${now}${hasExtras && now !== was ? ` <small>(was ${was})</small>` : ""}</span>`).join("");
    const list = r.top.map((x) => `<li><span class="sx-r">${x.rank}</span><span class="pp">${esc(x.pos || "")}</span><span class="ell">${esc(x.p.n)}</span>${hasExtras ? arrow(x) : ""}</li>`).join("");
    const movers = hasExtras && r.movers.length ? `<p class="fl-h sx-movers"><b>Biggest moves:</b> ${r.movers.map((x) => `${esc(x.p.n)} ${x.was > x.rank ? "up" : "down"} ${Math.abs(x.was - x.rank)}`).join(", ")}.</p>` : "";
    return `<div class="gp-h"><h3>${hasExtras ? "Who moves" : "The top of the board"}</h3><p>${hasExtras ? `Overall ranks with your rules, against the same scoring without them. The top ${r.n}, by value over replacement.` : `Add a rule above to see who moves. The top ${r.n}, by value over replacement.`}</p></div>
      <div class="sx-counts">${counts}</div>${movers}<ol class="sx-top">${list}</ol>`;
  }

  return { POSITIONS, QUICK, empty, fromLegacy, toSpec, count, summary, html, read, act, preview, previewHtml };
});
