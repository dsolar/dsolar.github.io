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
      speed: p.speed || "fast", chart: p.chart || "jj", order: "standings", seed: null, picks: [], i: 0, q: "", pos: "all", paused: false, preview: null };
  }
  function savePrefs() {
    prefs[M.lg] = { mine: [...M.mine], rounds: M.rounds, style: M.style, speed: M.speed, chart: M.chart };
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
        ${D.league === "nfl" ? `<div><span class="lab">Trade chart</span>${seg("chart", [["jj", "Jimmy Johnson"], ["fs", "Fitzgerald-Spielberger"]], M.chart)}</div>` : ""}
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
    D.chart = M.chart;
    M.ledger = E.ledger(D);
    M.ledger0 = M.ledger.map((a) => ({ ...a }));
    M.trades = [];
    M.offers = {};
    M.trade = null;
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
    if (isMine(p) || M.paused || M.trade) { room(); return; }
    const delay = M.skip ? 0 : SPEED[M.speed];
    timer = setTimeout(() => { botPick(); }, delay);
    if (delay) room();
  }
  function botPick() {
    const p = onClock();
    const pick = E.botPick(available(), { rand: M.rand, chaos: STYLE[M.style], league: D.league, taken: M.taken[p.owner] || [],
      needs: (D.needs || {})[p.owner] || [], pick: p.n });
    take(pick);
  }
  function take(player) {
    const p = onClock();
    p.player = player;
    (M.taken[p.owner] = M.taken[p.owner] || []).push(D.league === "nfl" ? E.nflPos(player.pos) : String(player.pos || "").toUpperCase());
    M.i++;
    const after = () => {
      if (M.skip && isMine(onClock())) M.skip = false;
      if (M.i >= M.picks.length) { M.phase = "done"; M.skip = false; done(); return; }
      if (M.skip) { step(); return; }
      step();
      if (!SPEED[M.speed] || isMine(onClock())) room();
    };
    if (!M.skip && M.speed !== "instant") { room(); reveal(p, after); } else after();
  }

  // Long names come down a size so they break between words, never inside one.
  function nameSize(n) {
    const longest = Math.max(...String(n).split(/\s+/).map((w) => w.length));
    const f = Math.min(1, 8.5 / Math.max(1, longest));
    return `clamp(${Math.round(48 * f)}px, ${(10 * f).toFixed(2)}vw, ${Math.round(132 * f)}px)`;
  }

  // The pick is in: a full-screen card in the team's colors for a beat, then the draft moves on. Tap to skip.
  function reveal(p, then) {
    const tm = BB.team(D, p.owner), x = p.player;
    const el = document.createElement("div");
    el.className = "reveal";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", `Pick ${p.n}: ${x.n}`);
    el.style.setProperty("--t1", tm.c[0]);
    const words = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
    const nth = p.n <= 10 ? words[p.n] : ord(p.n);
    const stats = (x.stats || []).slice(0, 3).map(([l, v]) => `<div class="rv-tile"><b>${BB.num(v)}</b><span>${esc(BB.label(l))}</span></div>`).join("");
    el.innerHTML = `<div class="rv-team"><span class="rv-num" aria-hidden="true">${p.n}</span>
        <div class="rv-live"><i></i>The pick is in</div>
        <div class="rv-badge"><div class="rv-logo">${BB.logo(D, p.owner, 120, "tl", true)}</div>
          <p>Round ${p.rnd} &middot; Pick ${p.n}${p.owner !== p.orig ? ` &middot; via ${esc(BB.team(D, p.orig).city)}` : ""}</p><b>${esc(tm.city)} ${esc(tm.name)}</b></div></div>
      <div class="rv-main"><p class="lead">With the ${nth} pick, the ${esc(tm.city)} ${esc(tm.name)} select</p>
        <h2 style="font-size:${nameSize(x.n)}">${esc(x.n)}</h2>
        <p class="meta">${esc([x.pos, x.school, x.ht, x.age ? `${x.age} years old` : ""].filter(Boolean).join(" · "))}</p>
        <div class="rv-tiles">${stats}<div class="rv-tile gold"><b>No. ${x.rank}</b><span>CONSENSUS${x.on > 1 ? `, RANGE ${x.hi}&ndash;${x.lo}` : ""}</span></div></div>
        <p class="rv-tap">Tap anywhere to keep going</p></div>`;
    document.body.appendChild(el);
    let gone = false;
    const close = () => { if (gone) return; gone = true; clearTimeout(rt); el.remove(); M.revealing = null; then(); };
    const rt = setTimeout(close, M.speed === "slow" ? 2600 : 1500);
    M.revealing = { el, close: () => { gone = true; clearTimeout(rt); el.remove(); } };
    el.addEventListener("click", close);
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
        <div class="clock-logo">${BB.logo(D, p.owner, 64, "tl big", true)}</div>
        <div class="clock-txt"><span class="kick">${mineNow ? "You're on the clock" : "On the clock"} &middot; Round ${p.rnd}, pick ${p.n}</span>
          <b class="disp">${esc(tm.city)} ${esc(tm.name)}</b>
          <span class="sub2">${esc((D.records || {})[p.owner] || "")}${p.owner !== p.orig ? ` &middot; via ${esc(BB.team(D, p.orig).city)}${p.note ? ` (${esc(p.note)})` : ""}` : ""}</span></div>
        <div class="clock-act">
          ${mineNow ? `<span class="note on">Pick from the board</span>` : `<button type="button" class="btn sm" data-act="pause">${M.paused ? "Resume" : "Pause"}</button>`}
          ${M.mine.size ? `<button type="button" class="btn sm" data-act="trade">Trade</button>` : ""}
          ${next && !mineNow ? `<button type="button" class="btn sm" data-act="skip">Sim to my pick</button>` : ""}
          ${!next && !mineNow ? `<button type="button" class="btn sm" data-act="skip">Sim to the end</button>` : ""}
          <button type="button" class="link" data-act="restart">Restart</button></div>
      </div>` : ""}
      ${mineNow ? offersPanel() : ""}
      ${M.trade ? tradeModal() : ""}
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

  // ---------- trades ----------
  const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  function assetsOf(team) {
    const cur = M.picks.filter((p, j) => j >= M.i && p.owner === team && !p.player).map((p) => ({ kind: "pick", n: p.n, key: "p" + p.n }));
    const fut = M.ledger.filter((a) => a.owner === team && a.ok).sort((a, b) => a.year - b.year || a.rd - b.rd).map((a) => ({ kind: "future", a, key: "f" + a.id }));
    return cur.concat(fut);
  }
  const label = (x) => E.assetLabel(D, x);
  const val = (x) => E.assetValue(D, x);
  const sum = (xs) => xs.reduce((s, x) => s + val(x), 0);

  function offersPanel() {
    const cur = onClock();
    if (!M.offers[M.i]) {
      M.offers[M.i] = E.offersFor(D, { picks: M.picks, i: M.i, available: available(), mine: M.mine, ledger: M.ledger, chaos: STYLE[M.style] }, M.rand)
        .map((o) => ({ ...o, status: "open" }));
    }
    const list = M.offers[M.i].filter((o) => o.status === "open");
    if (!list.length) return `<div class="offers none"><span class="lab">Phone's quiet</span><span class="note">No one's calling about No. ${cur.n}. You can still shop it: hit Trade.</span></div>`;
    return `<div class="offers"><span class="lab">The phone's ringing</span><div class="offer-row">${list.map((o, k) => {
      const tm = BB.team(D, o.team), pct = Math.round(o.ratio * 100);
      return `<div class="offer" style="--t1:${tm.c[0]}">${BB.logo(D, o.team, 34)}<div class="ot"><b>${esc(tm.city)} ${esc(tm.name)}</b>
        <span>want No. ${cur.n} for ${o.give.map((x) => esc(label(x))).join(" + ")}</span><span class="meter"><i style="width:${Math.min(100, pct - 50)}%"></i></span><small>${pct}% of the pick's value</small></div>
        <div class="oa"><button type="button" class="btn sm go" data-offer="${k}" data-ans="yes">Accept</button><button type="button" class="link" data-offer="${k}" data-ans="no">Pass</button></div></div>`;
    }).join("")}</div></div>`;
  }

  function doTrade(a, b, aGives, bGives) {
    const moves = [];
    const apply = (x, from, to) => {
      if (x.kind === "pick") { const p = M.picks.find((q) => q.n === x.n); p.owner = to; }
      else {
        const L = M.ledger.find((q) => q.id === x.a.id);
        L.owner = to;
        if (x.a.prot && !L.prot) { L.prot = x.a.prot; L.note = `Protected ${x.a.prot}`; }
        moves.push(L.id);
      }
    };
    aGives.forEach((x) => apply(x, a, b));
    bGives.forEach((x) => apply(x, b, a));
    M.trades.push({ at: onClock() ? onClock().n : null, a, b, aGives: aGives.map(label), bGives: bGives.map(label), aVal: sum(aGives), bVal: sum(bGives) });
  }

  function tradeModal() {
    const T = M.trade;
    const myTeams = [...M.mine];
    const partners = Object.keys(D.teams).filter((t) => !M.mine.has(t)).sort();
    const mine = assetsOf(T.me), theirs = T.with ? assetsOf(T.with) : [];
    const give = mine.filter((x) => T.give.has(x.key)), get = theirs.filter((x) => T.get.has(x.key));
    const gv = sum(give), rv = sum(get);
    const row = (x, side) => `<label class="as"><input type="checkbox" data-asset="${side}" value="${esc(x.key)}"${(side === "give" ? T.give : T.get).has(x.key) ? " checked" : ""}><span>${esc(label(x))}</span><em>${val(x).toFixed(D.league === "nba" ? 1 : 0)}</em></label>`;
    return `<div class="modal" role="dialog" aria-label="Trade"><div class="sheet">
      <div class="sheet-head"><h3 class="disp">Make a trade</h3><button type="button" class="link" data-act="trade-close">Close</button></div>
      <div class="trade-pick">
        ${myTeams.length > 1 ? `<label><span class="lab">For</span><select data-tsel="me">${myTeams.map((t) => `<option value="${t}"${t === T.me ? " selected" : ""}>${esc(D.teams[t].city)} ${esc(D.teams[t].name)}</option>`).join("")}</select></label>` : ""}
        <label><span class="lab">With</span><select data-tsel="with"><option value="">Pick a team</option>${partners.map((t) => `<option value="${t}"${t === T.with ? " selected" : ""}>${esc(D.teams[t].city)} ${esc(D.teams[t].name)}</option>`).join("")}</select></label>
      </div>
      <div class="trade-cols">
        <div><span class="lab">${esc(T.me)} sends</span>${mine.map((x) => row(x, "give")).join("") || `<p class="note">No picks left to trade.</p>`}</div>
        <div><span class="lab">${T.with ? `${esc(T.with)} sends` : "Their picks"}</span>${T.with ? theirs.map((x) => row(x, "get")).join("") || `<p class="note">They're out of picks.</p>` : `<p class="note">Choose a team to see their picks, this year's and future ones.</p>`}</div>
      </div>
      <div class="trade-foot"><div class="tv"><span>You send <b>${gv.toFixed(D.league === "nba" ? 1 : 0)}</b></span><span>You get <b>${rv.toFixed(D.league === "nba" ? 1 : 0)}</b></span>
        <span class="note">${D.league === "nfl" ? `Values: the ${M.chart === "fs" ? "Fitzgerald-Spielberger" : "Jimmy Johnson"} chart. A future pick counts a round lower per year out.` : "Future firsts are valued at a projected slot, protected ones only where they convey. Teams don't give up an unprotected first cheaply."}</span></div>
        <div class="oa">${T.msg ? `<span class="tmsg ${T.ok ? "ok" : ""}">${esc(T.msg)}</span>` : ""}<button type="button" class="btn go" data-act="propose"${T.with && (give.length || get.length) ? "" : " disabled"}>Propose</button></div></div>
    </div></div>`;
  }

  function propose() {
    const T = M.trade;
    const give = assetsOf(T.me).filter((x) => T.give.has(x.key)), get = assetsOf(T.with).filter((x) => T.get.has(x.key));
    const moves = give.filter((x) => x.kind === "future").map((x) => ({ id: x.a.id, from: T.me, to: T.with }))
      .concat(get.filter((x) => x.kind === "future").map((x) => ({ id: x.a.id, from: T.with, to: T.me })));
    const st = E.stepienOK(D, M.ledger, moves);
    if (!st.ok) { T.msg = `Can't do that: it leaves ${st.team} without a first in ${st.year} and ${st.year + 1} (the Stepien rule).`; T.ok = false; room(); return; }
    const gv = sum(give), rv = sum(get);
    const cur = onClock();
    const eager = get.some((x) => x.kind === "pick" && cur && x.n > cur.n) && give.some((x) => x.kind === "pick" && cur && x.n === cur.n);
    const premium = D.league === "nba" ? get.filter((x) => x.kind === "future" && x.a.rd === 1 && !x.a.prot).length * 0.2 : 0;
    if (E.botAccepts(rv, gv, M.rand, eager, premium)) {
      doTrade(T.me, T.with, give, get);
      T.msg = `Done. ${D.teams[T.with].name} accept.`; T.ok = true;
      T.give = new Set(); T.get = new Set();
    } else {
      const short = rv * 1.04 - gv;
      T.msg = premium && rv * 1.04 <= gv ? `${D.teams[T.with].name} pass. They don't move an unprotected first for that.` : `${D.teams[T.with].name} pass. They'd want about ${Math.max(1, short).toFixed(D.league === "nba" ? 1 : 0)} more in value.`; T.ok = false;
    }
    room();
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
  // ---------- the recap ----------
  const rdName = (r) => (r === 1 ? "1st" : r === 2 ? "2nd" : r === 3 ? "3rd" : `${r}th`);
  const futLabel = (a) => `${a.year} ${rdName(a.rd)}${a.orig !== a._for ? ` (${a.orig})` : ""}${a.prot ? `, protected ${a.prot}` : ""}`;

  function futureMoves(t) {
    const before = Object.fromEntries((M.ledger0 || []).map((a) => [a.id, a]));
    const added = [], sent = [];
    for (const a of M.ledger || []) {
      const b = before[a.id];
      if (!b) continue;
      if (a.owner === t && b.owner !== t) added.push({ ...a, _for: t });
      if (b.owner === t && a.owner !== t) sent.push({ ...b, prot: a.prot || b.prot, _for: t, to: a.owner });
    }
    const sort = (x, y) => x.year - y.year || x.rd - y.rd;
    return { added: added.sort(sort), sent: sent.sort(sort) };
  }

  function capital(t) {
    const years = (D.future || {}).years || [];
    const count = (L, y, rd) => (L || []).filter((a) => a.year === y && a.rd === rd && a.owner === t).length;
    return years.map((y) => ({ y, f: count(M.ledger, y, 1), f0: count(M.ledger0, y, 1), s: count(M.ledger, y, 2), s0: count(M.ledger0, y, 2) }));
  }

  function recapCard(t) {
    const tm = D.teams[t], list = M.picks.filter((p) => p.owner === t && p.player);
    const trades = (M.trades || []).filter((x) => x.a === t || x.b === t);
    const fm = futureMoves(t), cap = capital(t);
    const g = grade(list);
    const tradeNet = trades.reduce((s2, x) => s2 + (x.a === t ? x.bVal - x.aVal : x.aVal - x.bVal), 0);
    const fmt = (v) => (D.league === "nba" ? v.toFixed(1) : Math.round(v).toLocaleString("en-US"));
    const delta = (n, n0) => (n > n0 ? `<em class="up">+${n - n0}</em>` : n < n0 ? `<em class="down">${n - n0}</em>` : "");
    const trCard = (x) => {
      const mineA = x.a === t, other = mineA ? x.b : x.a;
      const got = mineA ? x.bGives : x.aGives, gave = mineA ? x.aGives : x.bGives;
      const gv = mineA ? x.bVal : x.aVal, sv = mineA ? x.aVal : x.bVal;
      const pct = sv ? Math.round((gv / sv - 1) * 100) : 0;
      return `<div class="rc-trade"><div class="rc-trade-head">${BB.logo(D, other, 22)}<b>With ${esc(D.teams[other].city)} ${esc(D.teams[other].name)}</b>${x.at ? `<span class="faint">at No. ${x.at}</span>` : ""}</div>
        <div class="rc-trade-cols"><div><span class="lab">Got</span>${got.map((l) => `<div>${esc(l)}</div>`).join("") || "<div class=\"faint\">Nothing</div>"}</div>
        <div><span class="lab">Gave</span>${gave.map((l) => `<div>${esc(l)}</div>`).join("") || "<div class=\"faint\">Nothing</div>"}</div></div>
        <div class="rc-verdict ${pct >= 3 ? "up" : pct <= -3 ? "down" : ""}">${pct >= 3 ? `Won it by ${pct}% on the chart` : pct <= -3 ? `Paid ${-pct}% over the chart` : "About even on the chart"}</div></div>`;
    };
    return `<article class="recap" style="--t1:${tm.c[0]};--t2:${tm.c[1]}">
      <header class="rc-head">${BB.logo(D, t, 56, "tl", true)}
        <div class="rc-title"><span class="kick">${D.year} ${D.league.toUpperCase()} draft recap</span><b>${esc(tm.city)} ${esc(tm.name)}</b>
          <span class="rc-meta">${list.length} pick${list.length === 1 ? "" : "s"} &middot; ${trades.length} trade${trades.length === 1 ? "" : "s"}${fm.added.length || fm.sent.length ? ` &middot; ${fm.added.length} future pick${fm.added.length === 1 ? "" : "s"} in, ${fm.sent.length} out` : ""}</span></div>
        ${g ? `<div class="rc-grade"><b>${g}</b><span>class grade</span></div>` : ""}</header>
      <div class="rc-body">
        <section><h4>Draft class</h4>${list.length ? `<ol class="rc-class">${list.map((x) => `<li><span class="rn">${x.n}</span>${BB.school(x.player, 26)}
          <span class="rt"><b>${esc(x.player.n)}</b><small>${esc([x.player.pos, x.player.school, x.player.ht].filter(Boolean).join(", "))} &middot; consensus ${x.player.rank}</small>${BB.statLine(x.player) ? `<small class="st">${BB.statLine(x.player)}</small>` : ""}</span>${valueTag(x)}</li>`).join("")}</ol>` : `<p class="note">Traded out of this draft.</p>`}</section>
        <section><h4>Trades${trades.length ? ` <span class="faint">net ${tradeNet >= 0 ? "+" : ""}${fmt(tradeNet)} on the chart</span>` : ""}</h4>${trades.length ? trades.map(trCard).join("") : `<p class="note">No trades this time. Hit Trade or take a call on the clock next run.</p>`}</section>
        <section><h4>Future picks</h4>
          ${fm.added.length ? `<div class="rc-fut"><span class="lab">Added</span>${fm.added.map((a) => `<div class="fut in">${esc(futLabel(a))}</div>`).join("")}</div>` : ""}
          ${fm.sent.length ? `<div class="rc-fut"><span class="lab">Traded away</span>${fm.sent.map((a) => `<div class="fut out">${esc(futLabel(a))} <span class="faint">to ${esc(a.to)}</span></div>`).join("")}</div>` : ""}
          ${!fm.added.length && !fm.sent.length ? `<p class="note">No future picks moved.</p>` : ""}
          <div class="rc-cap"><span class="lab">Picks on hand</span><table><thead><tr><th></th>${cap.map((c) => `<th>${c.y}</th>`).join("")}</tr></thead><tbody>
            <tr><th>1st</th>${cap.map((c) => `<td>${c.f}${delta(c.f, c.f0)}</td>`).join("")}</tr>
            <tr><th>2nd</th>${cap.map((c) => `<td>${c.s}${delta(c.s, c.s0)}</td>`).join("")}</tr></tbody></table></div>
        </section>
      </div>
    </article>`;
  }

  function done() {
    clearTimeout(timer);
    const mine = [...M.mine].filter((t) => M.picks.some((p) => p.owner === t) || (M.trades || []).some((x) => x.a === t || x.b === t));
    const steals = M.picks.filter((p) => p.player).map((p) => ({ p, v: E.value(p.n, p.player) / Math.max(4, p.n * 0.25) })).sort((a, b) => b.v - a.v);
    const rounds = [...new Set(M.picks.map((x) => x.rnd))];
    const row = (x) => `<li class="${M.mine.has(x.owner) ? "mine" : ""}"><span class="rn">${x.n}</span>${BB.logo(D, x.owner, 24)}<span class="rt"><b>${esc(x.player.n)}</b><small>${esc(x.owner)}${x.owner !== x.orig ? ` via ${esc(x.orig)}` : ""} &middot; ${esc([x.player.pos, x.player.school].filter(Boolean).join(", "))}</small></span>${valueTag(x)}</li>`;
    const mini = (list) => `<ol class="all-picks">${list.map(({ p }) => `<li><span class="rn">${p.n}</span>${BB.logo(D, p.owner, 24)}<span class="rt"><b>${esc(p.player.n)}</b><small>${esc(p.owner)} &middot; consensus ${p.player.rank}</small></span>${valueTag(p)}</li>`).join("")}</ol>`;
    const others = (M.trades || []).filter((x) => !M.mine.has(x.a) && !M.mine.has(x.b));
    $("#mock-view").innerHTML = `<section class="results">
      <div class="res-top"><div class="setup-head"><h2 class="disp">Draft recap</h2><p class="sub">${mine.length ? "Grades are against the consensus: a player taken later than his rank is value, earlier is a reach. Trades are judged on the pick value chart." : "You watched this one. Here's how it went."}</p></div>
        <div class="go-row"><button type="button" class="btn go" data-act="again">Run it again</button><button type="button" class="btn" data-act="card">Share card</button><button type="button" class="btn" data-act="copy">Copy the results</button><button type="button" class="link" data-act="back">Change teams</button><span class="note" id="copied"></span></div></div>
      ${mine.map(recapCard).join("")}
      <div class="res-split">
        <div><h3 class="disp">The whole draft</h3>${rounds.map((r) => `<div class="rnd"><span class="lab">Round ${r}</span><ol class="all-picks two">${M.picks.filter((x) => x.rnd === r).map(row).join("")}</ol></div>`).join("")}</div>
        <aside><h3 class="disp">Best values</h3>${mini(steals.slice(0, 5))}<h3 class="disp">Biggest reaches</h3>${mini(steals.slice(-5).reverse())}
          ${others.length ? `<h3 class="disp">Other trades</h3><ul class="other-trades">${others.map((x) => `<li><b>${esc(x.a)}</b> sent ${esc(x.aGives.join(" + "))} to <b>${esc(x.b)}</b> for ${esc(x.bGives.join(" + "))}</li>`).join("")}</ul>` : ""}</aside>
      </div>
    </section>`;
    window.scrollTo({ top: document.getElementById("mock-view").offsetTop - 12, behavior: "smooth" });
  }
  function copyText() {
    const lines = [`${D.year} ${D.league.toUpperCase()} mock draft (davidsolar.dev/draft)`];
    M.picks.forEach((x) => lines.push(`${x.n}. ${x.owner}${x.owner !== x.orig ? ` (via ${x.orig})` : ""}: ${x.player.n}, ${[x.player.pos, x.player.school].filter(Boolean).join(", ")}`));
    (M.trades || []).forEach((t) => lines.push(`Trade: ${t.a} sent ${t.aGives.join(" + ")} to ${t.b} for ${t.bGives.join(" + ")}`));
    [...M.mine].forEach((t) => { const l = M.picks.filter((p) => p.owner === t); if (l.length) lines.push(`${t} grade: ${grade(l)}`); });
    const txt = lines.join("\n");
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => { $("#copied").textContent = "Copied."; }, () => { $("#copied").textContent = "Couldn't copy here."; });
  }

  // ---------- share card ----------
  function loadImg(src) {
    return new Promise((res) => {
      const im = new Image(); im.crossOrigin = "anonymous";
      im.onload = () => res(im); im.onerror = () => res(null);
      im.src = src;
    });
  }
  async function shareCard() {
    const team = [...M.mine].find((t) => M.picks.some((p) => p.owner === t));
    const tm = team ? D.teams[team] : null;
    const nPicks = team ? Math.min(8, M.picks.filter((p) => p.owner === team).length) : 10;
    const nTrades = team ? Math.min(2, (M.trades || []).filter((t) => t.a === team || t.b === team).length) : 0;
    const W = 1080, H = Math.max(1080, Math.min(1350, (team ? 390 + nPicks * 118 + nTrades * 48 : 280 + nPicks * 92) + 150));
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    try { await document.fonts.ready; } catch (e) { /* system fonts */ }
    const c1 = tm ? tm.c[0] : "#0B1626";
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, c1); bg.addColorStop(0.55, "#0B1626"); bg.addColorStop(1, "#060D18");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const disp = (w, px) => `${w} ${px}px "Big Shoulders Display", "Arial Narrow", Impact, sans-serif`;
    const body = (w, px) => `${w} ${px}px Barlow, system-ui, sans-serif`;
    g.fillStyle = "#F2C14E"; g.font = body(700, 30);
    g.fillText(`${D.year} ${D.league.toUpperCase()} MOCK DRAFT`, 70, 100);
    let y = 150;
    if (tm) {
      const logo = await loadImg(`https://a.espncdn.com/i/teamlogos/${D.league}/500-dark/${tm.espn}.png`);
      if (logo) g.drawImage(logo, 70, y, 170, 170);
      else {
        g.fillStyle = tm.c[0]; g.beginPath(); g.arc(155, y + 85, 85, 0, Math.PI * 2); g.fill();
        g.fillStyle = BB.light(tm.c[1]) ? tm.c[1] : "#FFFFFF"; g.font = disp(900, 64); g.textAlign = "center"; g.fillText(team, 155, y + 108); g.textAlign = "left";
      }
      g.fillStyle = "#FFFFFF"; g.font = disp(900, 92);
      g.fillText(tm.city.toUpperCase(), 270, y + 80);
      g.fillText(tm.name.toUpperCase(), 270, y + 165);
      const list = M.picks.filter((p) => p.owner === team);
      const gr = grade(list);
      g.fillStyle = "rgba(0,0,0,.3)"; g.fillRect(W - 230, y + 20, 160, 140);
      g.fillStyle = "#FFFFFF"; g.font = disp(900, 110); g.textAlign = "center"; g.fillText(gr, W - 150, y + 132); g.textAlign = "left";
      y += 240;
      const show = list.slice(0, 8);
      for (const x of show) {
        g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(70, y, W - 140, 104);
        g.fillStyle = "#F2C14E"; g.font = disp(900, 58); g.fillText(String(x.n), 96, y + 72);
        g.fillStyle = "#FFFFFF"; g.font = body(700, 42); g.fillText(x.player.n, 230, y + 52);
        g.fillStyle = "rgba(236,239,233,.72)"; g.font = body(500, 28);
        g.fillText([x.player.pos, x.player.school].filter(Boolean).join(", ") + `  ·  consensus ${x.player.rank}`, 230, y + 88);
        const v = E.value(x.n, x.player), big = Math.max(4, x.n * 0.25);
        if (Math.abs(v) >= big) {
          g.fillStyle = v > 0 ? "#3FB37F" : "#E8435C"; g.font = body(700, 32); g.textAlign = "right";
          g.fillText(v > 0 ? `STEAL +${v}` : `REACH ${v}`, W - 96, y + 66); g.textAlign = "left";
        }
        y += 118;
      }
      const tr = (M.trades || []).filter((t) => t.a === team || t.b === team).slice(0, 2);
      g.fillStyle = "rgba(236,239,233,.8)"; g.font = body(500, 27);
      for (const t of tr) { y += 8; g.fillText(`Trade: ${t.a} sent ${t.aGives.join(" + ")} to ${t.b} for ${t.bGives.join(" + ")}`.slice(0, 74), 70, y + 28); y += 40; }
    } else {
      g.fillStyle = "#FFFFFF"; g.font = disp(900, 96); g.fillText("THE TOP 10", 70, y + 80);
      y += 130;
      for (const x of M.picks.slice(0, 10)) {
        g.fillStyle = "#F2C14E"; g.font = disp(900, 52); g.fillText(String(x.n), 70, y + 50);
        g.fillStyle = "#FFFFFF"; g.font = body(700, 38); g.fillText(`${x.owner}: ${x.player.n}`, 170, y + 48);
        y += 92;
      }
    }
    g.fillStyle = "rgba(236,239,233,.6)"; g.font = body(600, 28);
    g.fillText("davidsolar.dev/draft", 70, H - 60);
    g.textAlign = "right"; g.fillText("Big Board mock draft", W - 70, H - 60); g.textAlign = "left";
    let blob = null;
    try { blob = await new Promise((r) => cv.toBlob(r, "image/png")); } catch (e) { blob = null; }
    if (!blob) { $("#copied").textContent = "Couldn't make the image here."; return; }
    const url = URL.createObjectURL(blob);
    const file = new File([blob], `mock-draft-${D.league}.png`, { type: "image/png" });
    const canShare = navigator.canShare && navigator.canShare({ files: [file] });
    const wrap = document.createElement("div");
    wrap.className = "modal"; wrap.innerHTML = `<div class="sheet card-sheet"><div class="sheet-head"><h3 class="disp">Share card</h3><button type="button" class="link" data-close>Close</button></div>
      <img src="${url}" alt="Mock draft results card" class="card-img"><div class="go-row">${canShare ? `<button type="button" class="btn go" data-share>Share</button>` : ""}<a class="btn" href="${url}" download="mock-draft-${D.league}.png">Download</a></div></div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", async (e) => {
      if (e.target.closest("[data-close]") || e.target === wrap) { wrap.remove(); URL.revokeObjectURL(url); }
      if (e.target.closest("[data-share]")) { try { await navigator.share({ files: [file], title: "My mock draft" }); } catch (err) { /* dismissed */ } }
    });
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
    const of = e.target.closest("[data-offer]");
    if (of) {
      const o = M.offers[M.i].filter((x) => x.status === "open")[Number(of.dataset.offer)];
      if (o && of.dataset.ans === "yes") { const cur = onClock(); doTrade(cur.owner, o.team, [{ kind: "pick", n: cur.n }], o.give); o.status = "done"; M.offers[M.i].forEach((x) => { x.status = "gone"; }); step(); room(); }
      else if (o) { o.status = "passed"; room(); }
      return;
    }
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
    else if (act === "restart") { clearTimeout(timer); if (M.revealing) { M.revealing.close(); M.revealing = null; } M.phase = "setup"; M.skip = false; setup(); }
    else if (act === "again") { M.seed = M.order === "lottery" ? (Math.random() * 2 ** 31) | 0 : (Math.random() * 2 ** 31) | 0; if (M.order === "lottery") { M.phase = "lottery"; lotteryView(); } else start(); }
    else if (act === "copy") copyText();
    else if (act === "card") shareCard();
    else if (act === "trade") { M.trade = { me: [...M.mine].find((t) => M.picks.some((p, j) => j >= M.i && p.owner === t)) || [...M.mine][0], with: "", give: new Set(), get: new Set(), msg: "" }; clearTimeout(timer); room(); }
    else if (act === "trade-close") { M.trade = null; step(); room(); }
    else if (act === "propose") propose();
  });
  document.addEventListener("change", (e) => {
    if (!M || !M.trade) return;
    const sel = e.target.closest("[data-tsel]");
    if (sel) { if (sel.dataset.tsel === "me") M.trade.me = sel.value; else M.trade.with = sel.value; M.trade.give = new Set(); M.trade.get = new Set(); M.trade.msg = ""; room(); return; }
    const cb = e.target.closest("[data-asset]");
    if (cb) { const set = cb.dataset.asset === "give" ? M.trade.give : M.trade.get; cb.checked ? set.add(cb.value) : set.delete(cb.value); M.trade.msg = ""; room(); }
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
  function stop() {
    clearTimeout(timer);
    if (M && M.revealing) { M.revealing.close(); M.revealing = null; }
    if (M && M.phase === "draft") M.paused = true;
  }
  window.Mock = { render, stop };
})();
