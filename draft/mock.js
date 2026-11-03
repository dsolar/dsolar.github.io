/* The mock draft: pick your team(s), set the order (NBA: as it stands or a lottery drawing with every 2027
   protection applied), and draft against bots that pick off the consensus with some noise. */
(function () {
  "use strict";
  const { $, esc } = BB;
  const E = window.DraftEngine;
  const SPEED = { slow: 1400, fast: 450, instant: 0 };
  const STYLE = { chalk: 0.12, balanced: 0.5, chaos: 1 };
  let D = null;
  let M = null;      // the current mock
  let timer = null;
  const prefs = BB.store.get("bigboard-mock") || {};

  function fresh(lg) {
    const p = prefs[lg] || {};
    return { lg, phase: "setup", mine: new Set(p.mine || []), rounds: p.rounds || 1, style: p.style || "balanced",
      speed: p.speed || "fast", order: "standings", seed: null, picks: [], i: 0, q: "", pos: "all", paused: false, preview: null };
  }
  function savePrefs() {
    prefs[M.lg] = { mine: [...M.mine], rounds: M.rounds, style: M.style, speed: M.speed };
    BB.store.set("bigboard-mock", prefs);
  }
  const maxRounds = () => (D.league === "nba" ? 2 : 3);
  const sortedTeams = () => Object.keys(D.teams).sort((a, b) => (D.teams[a].city + D.teams[a].name).localeCompare(D.teams[b].city + D.teams[b].name));
  const clockOf = (p) => BB.team(D, p.owner);

  function orderFor() {
    const ord = E.buildOrder(D, { lottery: M.order === "standings" ? "standings" : M.seed });
    return ord.filter((p) => p.rnd <= M.rounds);
  }

  // ---------- setup ----------
  function setup() {
    const ord = E.buildOrder(D, { lottery: "standings" });
    const count = (t) => ord.filter((p) => p.owner === t && p.rnd <= M.rounds).length;
    const seg = (name, opts, cur) => `<div class="seg" role="group" aria-label="${name}">${opts.map(([k, l]) => `<button type="button" data-set="${name}" data-v="${k}" aria-pressed="${String(cur) === String(k)}">${l}</button>`).join("")}</div>`;
    const mine = [...M.mine];
    $("#mock-view").innerHTML = `<section class="mock-setup">
      <div class="setup-head"><h2 class="disp">Mock draft</h2><p class="sub">Pick your team, or a few. Everyone else drafts off the consensus board, with as much chaos as you want. ${D.league === "nba" ? "Draw the lottery first or go with the order as it stands." : ""}</p></div>
      <div class="opts">
        ${D.league === "nba" ? `<div><span class="lab">Order</span>${seg("order", [["standings", "As it stands"], ["lottery", "Draw the lottery"]], M.order === "standings" ? "standings" : "lottery")}</div>` : ""}
        <div><span class="lab">Rounds</span>${seg("rounds", Array.from({ length: maxRounds() }, (_, i) => [i + 1, String(i + 1)]), M.rounds)}</div>
        <div><span class="lab">The other ${D.league === "nba" ? "29" : "31"}</span>${seg("style", [["chalk", "Chalk"], ["balanced", "Balanced"], ["chaos", "Chaos"]], M.style)}</div>
        <div><span class="lab">Speed</span>${seg("speed", [["slow", "Slow"], ["fast", "Fast"], ["instant", "Instant"]], M.speed)}</div>
      </div>
      <div class="teams-head"><span class="lab">Your team${mine.length === 1 ? "" : "s"}</span><span class="note">${mine.length ? `${mine.map((t) => `${D.teams[t].city} ${D.teams[t].name}`).join(", ")}: ${mine.reduce((s, t) => s + count(t), 0)} pick${mine.reduce((s, t) => s + count(t), 0) === 1 ? "" : "s"} as it stands` : "None picked: you'll just watch."}</span>
        ${mine.length ? `<button type="button" class="link" data-act="clear">Clear</button>` : ""}</div>
      <div class="team-grid">${sortedTeams().map((t) => {
        const tm = D.teams[t], on = M.mine.has(t), n = count(t);
        return `<button type="button" class="tm${on ? " on" : ""}${n ? "" : " nopick"}" data-team="${t}" aria-pressed="${on}" style="--t1:${tm.c[0]};--t2:${tm.c[1]}">
          ${BB.logo(D, t, 40)}<span class="tn">${esc(tm.name)}</span><span class="tr">${esc((D.records || {})[t] || "")}${n ? ` &middot; ${n} pick${n === 1 ? "" : "s"}` : " &middot; no pick"}</span></button>`;
      }).join("")}</div>
      <div class="go-row"><button type="button" class="btn go" data-act="start">${M.order === "lottery" ? "Draw the lottery" : "Start the draft"}</button>
        <span class="note">Order from Tankathon's standings, ${esc(BB.fmtDay(D.order.updated))}. ${D.league === "nba" ? "Protected picks resolve the way the trades are written." : "Traded picks as they stand."}</span></div>
    </section>`;
  }

  // ---------- lottery ----------
  function lotteryView() {
    const ord = E.buildOrder(D, { lottery: M.seed }).filter((p) => p.rnd === 1).slice(0, 14);
    $("#mock-view").innerHTML = `<section class="lotto">
      <div class="setup-head"><h2 class="disp">The lottery</h2><p class="sub">Four picks drawn, 14% odds for the three worst records down to 0.5%. Protections settle once the order does.</p></div>
      <ol class="lotto-list">${ord.map((p) => {
        const tm = clockOf(p), moved = p.jump || 0;
        return `<li style="--t1:${tm.c[0]}" class="${p.n <= 4 ? "won" : ""}${M.mine.has(p.owner) ? " mine" : ""}"><span class="ln">${p.n}</span>${BB.logo(D, p.owner, 34)}
          <span class="lt"><b>${esc(tm.city)} ${esc(tm.name)}</b>${p.owner !== p.orig ? `<small>via ${esc(p.orig)}${p.note ? `: ${esc(p.note)}` : ""}</small>` : p.note ? `<small>${esc(p.note)}</small>` : ""}</span>
          <span class="lj ${moved > 0 ? "up" : moved < 0 ? "down" : ""}">${moved > 0 ? `&#9650;${moved}` : moved < 0 ? `&#9660;${-moved}` : "&ndash;"}</span></li>`;
      }).join("")}</ol>
      <div class="go-row"><button type="button" class="btn" data-act="redraw">Draw again</button><button type="button" class="btn go" data-act="draft">Draft with this order</button><button type="button" class="link" data-act="back">Back</button></div>
    </section>`;
  }

  // ---------- draft room ----------
  function start() {
    const ord = orderFor();
    M.picks = ord.map((p) => ({ ...p, player: null }));
    M.i = 0; M.phase = "draft"; M.paused = false; M.preview = null;
    M.pool = D.players.slice().sort((a, b) => a.score - b.score);
    M.rand = E.rng((M.seed || Date.now()) ^ 0x9e3779b9);
    M.taken = {};
    room();
    step();
  }
  const available = () => { const used = new Set(M.picks.filter((p) => p.player).map((p) => p.player.id)); return M.pool.filter((p) => !used.has(p.id)); };
  const onClock = () => M.picks[M.i];
  const isMine = (p) => p && M.mine.has(p.owner);

  function step() {
    clearTimeout(timer);
    if (M.phase !== "draft") return;
    const p = onClock();
    if (!p) { M.phase = "done"; done(); return; }
    if (isMine(p) || M.paused) { room(); return; }
    const delay = M.skip ? 0 : SPEED[M.speed];
    timer = setTimeout(() => { botPick(); }, delay);
    if (delay) room();
  }
  function botPick() {
    const p = onClock();
    const pick = E.botPick(available(), { rand: M.rand, chaos: STYLE[M.style], league: D.league, taken: M.taken[p.owner] || [] });
    take(pick);
  }
  function take(player) {
    const p = onClock();
    p.player = player;
    (M.taken[p.owner] = M.taken[p.owner] || []).push(String(player.pos || "").toUpperCase());
    M.i++;
    if (M.skip && isMine(onClock())) M.skip = false;
    if (M.i >= M.picks.length) { M.phase = "done"; M.skip = false; done(); return; }
    if (M.skip) { step(); return; }
    step();
    if (!SPEED[M.speed] || isMine(onClock())) room();
  }

  function room() {
    const p = onClock();
    const tm = p ? clockOf(p) : null;
    const mineNow = isMine(p);
    const q = M.q.trim().toLowerCase();
    const av = available().filter((x) => (M.pos === "all" || BB.group(D.league, x.pos) === M.pos) && (!q || x.n.toLowerCase().includes(q) || (x.school || "").toLowerCase().includes(q)));
    const next = M.picks.slice(M.i).find(isMine);
    const rounds = [...new Set(M.picks.map((x) => x.rnd))];
    $("#mock-view").innerHTML = `<section class="room">
      ${p ? `<div class="clock" style="--t1:${tm.c[0]};--t2:${tm.c[1]}">
        <div class="clock-logo">${BB.logo(D, p.owner, 64, "tl big")}</div>
        <div class="clock-txt"><span class="kick">${mineNow ? "You're on the clock" : "On the clock"} &middot; Round ${p.rnd}, pick ${p.n}</span>
          <b class="disp">${esc(tm.city)} ${esc(tm.name)}</b>
          <span class="sub2">${esc((D.records || {})[p.owner] || "")}${p.owner !== p.orig ? ` &middot; via ${esc(BB.team(D, p.orig).city)}${p.note ? ` (${esc(p.note)})` : ""}` : ""}</span></div>
        <div class="clock-act">
          ${mineNow ? `<span class="note on">Pick from the board</span>` : `<button type="button" class="btn sm" data-act="pause">${M.paused ? "Resume" : "Pause"}</button>`}
          ${next && !mineNow ? `<button type="button" class="btn sm" data-act="skip">Sim to my pick</button>` : ""}
          ${!next && !mineNow ? `<button type="button" class="btn sm" data-act="skip">Sim to the end</button>` : ""}
          <button type="button" class="link" data-act="restart">Restart</button></div>
      </div>` : ""}
      <div class="room-grid">
        <aside class="rail" aria-label="Picks">${rounds.map((r) => `<div class="rail-round">Round ${r}</div>${M.picks.filter((x) => x.rnd === r).map((x) => {
          const t = clockOf(x), idx = M.picks.indexOf(x), cur = idx === M.i;
          return `<div class="rp${cur ? " cur" : ""}${M.mine.has(x.owner) ? " mine" : ""}" style="--t1:${t.c[0]}"${cur ? ' id="rp-cur"' : ""}><span class="rn">${x.n}</span>${BB.logo(D, x.owner, 26)}
            <span class="rt">${x.player ? `<b>${esc(x.player.n)}</b><small>${esc([x.player.pos, x.player.school].filter(Boolean).join(", "))}</small>` : `<b class="faint">${esc(x.owner)}${x.owner !== x.orig ? ` <small>via ${esc(x.orig)}</small>` : ""}</b>`}</span>
            ${x.player ? valueTag(x) : ""}</div>`;
        }).join("")}`).join("")}</aside>
        <div class="pool">
          <div class="tools"><label class="sr" for="mq">Find a player</label><input id="mq" type="search" placeholder="Find a player or school" value="${esc(M.q)}" autocomplete="off">
            <div class="chips">${BB.POS[D.league].map(([k, l]) => `<button type="button" data-mpos="${k}" aria-pressed="${M.pos === k}">${l}</button>`).join("")}</div></div>
          <div class="table-wrap"><table class="pool-t"><thead><tr><th class="r">#</th><th>Player</th><th class="hide-m">Stats</th><th class="r hide-s">Avg</th><th></th></tr></thead><tbody>
          ${av.slice(0, 60).map((x) => `<tr class="pr" data-pid="${esc(x.id)}"><td class="rk r">${x.rank}</td>
            <td><div class="who-cell">${BB.school(x)}<div class="nm">${esc(x.n)}<small>${esc([x.pos, x.school, x.ht].filter(Boolean).join(", "))}</small></div></div></td>
            <td class="stl hide-m">${BB.statLine(x) || `<span class="faint">&ndash;</span>`}</td><td class="r sc hide-s">${x.score.toFixed(1)}</td>
            <td class="r">${mineNow ? `<button type="button" class="btn sm go" data-draft="${esc(x.id)}">Draft</button>` : ""}</td></tr>`).join("") || `<tr><td class="empty" colspan="5">No one left who matches.</td></tr>`}
          </tbody></table></div>
        </div>
      </div>
    </section>`;
    const cur = document.getElementById("rp-cur");
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  function valueTag(x) {
    const v = E.value(x.n, x.player);
    const big = Math.max(4, x.n * 0.25);
    if (v >= big) return `<span class="vt steal" title="Consensus ${x.player.rank}">+${v}</span>`;
    if (v <= -big) return `<span class="vt reach" title="Consensus ${x.player.rank}">${v}</span>`;
    return "";
  }

  // ---------- results ----------
  function grade(list) {
    if (!list.length) return null;
    const rel = list.map((x) => E.value(x.n, x.player) / Math.max(4, x.n * 0.25));
    const m = rel.reduce((s, x) => s + x, 0) / rel.length;
    return m >= 1 ? "A+" : m >= 0.5 ? "A" : m >= 0.2 ? "A-" : m >= -0.2 ? "B+" : m >= -0.5 ? "B" : m >= -0.8 ? "B-" : m >= -1.2 ? "C+" : m >= -1.6 ? "C" : "D";
  }
  function done() {
    clearTimeout(timer);
    const mine = [...M.mine].filter((t) => M.picks.some((p) => p.owner === t));
    const steals = M.picks.filter((p) => p.player).map((p) => ({ p, v: E.value(p.n, p.player) / Math.max(4, p.n * 0.25) })).sort((a, b) => b.v - a.v);
    const card = (t) => {
      const tm = D.teams[t], list = M.picks.filter((p) => p.owner === t);
      return `<div class="res-card" style="--t1:${tm.c[0]};--t2:${tm.c[1]}"><div class="res-head">${BB.logo(D, t, 44)}<b class="disp">${esc(tm.city)} ${esc(tm.name)}</b><span class="grade">${grade(list)}</span></div>
        <ul>${list.map((x) => `<li><span class="rn">${x.n}</span>${BB.school(x.player, 22)}<span class="rt"><b>${esc(x.player.n)}</b><small>${esc([x.player.pos, x.player.school].filter(Boolean).join(", "))} &middot; consensus ${x.player.rank}</small></span>${valueTag(x)}</li>`).join("")}</ul></div>`;
    };
    $("#mock-view").innerHTML = `<section class="results">
      <div class="setup-head"><h2 class="disp">The draft</h2><p class="sub">${mine.length ? "Grades are against the consensus: taking a player later than his rank is value, earlier is a reach." : "You watched this one. Here's how it went."}</p></div>
      ${mine.length ? `<div class="res-grid">${mine.map(card).join("")}</div>` : ""}
      <div class="go-row"><button type="button" class="btn go" data-act="again">Run it again</button><button type="button" class="btn" data-act="copy">Copy the results</button><button type="button" class="link" data-act="back">Change teams</button><span class="note" id="copied"></span></div>
      <div class="res-split">
        <div><h3 class="disp">Every pick</h3><ol class="all-picks">${M.picks.map((x) => `<li class="${M.mine.has(x.owner) ? "mine" : ""}"><span class="rn">${x.n}</span>${BB.logo(D, x.owner, 24)}<span class="rt"><b>${esc(x.player.n)}</b><small>${esc(x.owner)}${x.owner !== x.orig ? ` via ${esc(x.orig)}` : ""} &middot; ${esc([x.player.pos, x.player.school].filter(Boolean).join(", "))}</small></span>${valueTag(x)}</li>`).join("")}</ol></div>
        <div><h3 class="disp">Best values</h3><ol class="all-picks">${steals.slice(0, 5).map(({ p }) => `<li><span class="rn">${p.n}</span>${BB.logo(D, p.owner, 24)}<span class="rt"><b>${esc(p.player.n)}</b><small>consensus ${p.player.rank}</small></span>${valueTag(p)}</li>`).join("")}</ol>
          <h3 class="disp">Biggest reaches</h3><ol class="all-picks">${steals.slice(-5).reverse().map(({ p }) => `<li><span class="rn">${p.n}</span>${BB.logo(D, p.owner, 24)}<span class="rt"><b>${esc(p.player.n)}</b><small>consensus ${p.player.rank}</small></span>${valueTag(p)}</li>`).join("")}</ol></div>
      </div>
    </section>`;
  }
  function copyText() {
    const lines = [`${D.year} ${D.league.toUpperCase()} mock draft (davidsolar.dev/draft)`];
    M.picks.forEach((x) => lines.push(`${x.n}. ${x.owner}${x.owner !== x.orig ? ` (via ${x.orig})` : ""}: ${x.player.n}, ${[x.player.pos, x.player.school].filter(Boolean).join(", ")}`));
    [...M.mine].forEach((t) => { const l = M.picks.filter((p) => p.owner === t); if (l.length) lines.push(`${t} grade: ${grade(l)}`); });
    const txt = lines.join("\n");
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => { $("#copied").textContent = "Copied."; }, () => { $("#copied").textContent = "Couldn't copy here."; });
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#mock-view") || !M) return;
    const tb = e.target.closest("[data-team]");
    if (tb) { const t = tb.dataset.team; M.mine.has(t) ? M.mine.delete(t) : M.mine.add(t); savePrefs(); setup(); return; }
    const st = e.target.closest("[data-set]");
    if (st) {
      const k = st.dataset.set, v = st.dataset.v;
      if (k === "rounds") M.rounds = Number(v); else if (k === "order") M.order = v; else M[k] = v;
      savePrefs(); setup(); return;
    }
    const mp = e.target.closest("[data-mpos]");
    if (mp) { M.pos = mp.dataset.mpos; room(); return; }
    const dr = e.target.closest("[data-draft]");
    if (dr && isMine(onClock())) { take(M.pool.find((x) => x.id === dr.dataset.draft)); return; }
    const a = e.target.closest("[data-act]");
    if (!a) return;
    const act = a.dataset.act;
    if (act === "clear") { M.mine.clear(); savePrefs(); setup(); }
    else if (act === "start") { if (M.order === "lottery") { M.seed = (Math.random() * 2 ** 31) | 0; M.phase = "lottery"; lotteryView(); } else { M.seed = (Math.random() * 2 ** 31) | 0; start(); } }
    else if (act === "redraw") { M.seed = (Math.random() * 2 ** 31) | 0; lotteryView(); }
    else if (act === "draft") start();
    else if (act === "back") { clearTimeout(timer); M.phase = "setup"; setup(); }
    else if (act === "pause") { M.paused = !M.paused; step(); room(); }
    else if (act === "skip") { M.paused = false; M.skip = true; step(); }
    else if (act === "restart") { clearTimeout(timer); M.phase = "setup"; M.skip = false; setup(); }
    else if (act === "again") { M.seed = M.order === "lottery" ? (Math.random() * 2 ** 31) | 0 : (Math.random() * 2 ** 31) | 0; if (M.order === "lottery") { M.phase = "lottery"; lotteryView(); } else start(); }
    else if (act === "copy") copyText();
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "mq" && M) { M.q = e.target.value; room(); const el = document.getElementById("mq"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  });

  async function render(lg) {
    if (!M || M.lg !== lg) { clearTimeout(timer); M = fresh(lg); }
    try { D = await BB.data(lg); } catch (e) { $("#mock-view").innerHTML = `<p class="empty">Couldn't load the draft. Try a refresh.</p>`; return; }
    if (!D.order || !D.order.picks || !D.order.picks.length) { $("#mock-view").innerHTML = `<p class="empty">The draft order hasn't loaded yet. It comes in with the morning update.</p>`; return; }
    if (M.phase === "setup") setup(); else if (M.phase === "lottery") lotteryView(); else if (M.phase === "draft") room(); else done();
  }
  function stop() { clearTimeout(timer); if (M && M.phase === "draft") M.paused = true; }
  window.Mock = { render, stop };
})();
