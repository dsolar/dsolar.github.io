/* Win Probability: screens, play clock, reveal, crowd votes. Rules live in engine.js, scenarios in data.js. */
(function () {
  "use strict";
  const E = window.WPEngine;
  const D = window.WP_DATA;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f1 = (v) => (v == null ? "?" : (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, ""));
  const CLOCK_SECONDS = 25;

  // The publishable key is safe in the browser; database grants and RLS constrain public votes and opt-in speed scores.
  const SUPABASE_URL = "https://baxrczyufqbzrogftmyn.supabase.co";
  const SUPABASE_KEY = "sb_publishable_brDXGevzcoI7mBaPO7Plow_yaUy4gk4";
  const CROWD_MIN = 20;

  const MODES = [
    { id: "quick", name: "Quick Game", desc: "Ten decisions. Real games. Two famous calls.", len: "10" },
    { id: "daily", name: "Daily Challenge", desc: "The same five decisions for everyone today", len: "5" },
    { id: "speed", name: "Speed Round", desc: "Ten shared calls. Answer within 25 seconds; speed affects this score, not your coaching grade.", len: "10 · timed" },
    { id: "survival", name: "Survival", desc: "Keep coaching until your third costly call", len: "3 strikes" },
  ];

  // ---------- storage (never required) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("mtc.v2." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("mtc.v2." + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function dayIndex(date) { return Math.round((Date.parse(date + "T12:00:00Z") - Date.parse("2026-10-16T12:00:00Z")) / 864e5); }
  function prettyDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const mon = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."][m - 1];
    return `${mon} ${d}, ${y}`;
  }

  // ---------- teams and words ----------
  function team(key) { return D.teams[key] || { abbr: key, name: key, nick: key, c1: "#334", c2: "#999" }; }
  function lightColor(hex) {
    const n = parseInt(hex.replace("#", ""), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
  }
  function ordinalQ(q) { return q >= 5 ? "overtime" : ["", "1st", "2nd", "3rd", "4th"][q] + " quarter"; }
  function spotText(yl, ownSide) {
    if (yl === 50) return "midfield";
    return yl > 50 ? `${ownSide}${100 - yl}` : `their ${yl}`;
  }
  function bugSpot(s) {
    if (s.kind === "pat") return "after TD";
    if (s.ball === "opp") return `Your ${s.yl}`;
    return s.yl === 50 ? "Midfield" : s.yl > 50 ? `Own ${100 - s.yl}` : `Opp ${s.yl}`;
  }
  function scoreText(s) {
    const [a, b] = s.score;
    return a > b ? `You lead ${a}-${b}` : a < b ? `You trail ${b}-${a}` : `It's tied ${a}-${b}`;
  }
  function downText(s) {
    if (s.kind === "pat") return "Try";
    const goal = s.yl <= s.ytg;
    return `${["", "1st", "2nd", "3rd", "4th"][s.down]} & ${goal ? "Goal" : s.ytg}`;
  }
  function weatherText(s) {
    if (s.roof === "dome" || s.roof === "closed") return "Indoors";
    const parts = [];
    if (s.temp != null) parts.push(`${s.temp}°F`);
    if (s.wind != null) parts.push(`wind ${s.wind} mph`);
    return parts.length ? parts.join(", ") : "Outdoors";
  }
  function lineText(s) {
    if (s.spread == null) return null;
    if (Math.abs(s.spread) < 0.5) return "Pick'em";
    return s.spread > 0 ? `Favored by ${f1(s.spread)}` : `Underdog by ${f1(-s.spread)}`;
  }

  // ---------- field strip ----------
  function fieldSVG(s, opts) {
    opts = opts || {};
    const off = s.ball === "opp" ? team(s.opp) : team(s.you);
    const def = s.ball === "opp" ? team(s.you) : team(s.opp);
    const x = (yl) => 100 + (100 - yl) * 10;
    const bx = x(s.yl);
    const goal = s.kind === "pat" || s.yl <= (s.ytg || 0);
    const tx = s.kind === "pat" ? 1100 : goal ? 1100 : Math.min(1100, bx + s.ytg * 10);
    let lines = "";
    for (let yd = 5; yd < 100; yd += 5) {
      const lx = 100 + yd * 10;
      lines += `<line x1="${lx}" y1="8" x2="${lx}" y2="132" stroke="rgba(255,255,255,${yd % 10 ? 0.16 : 0.42})" stroke-width="${yd % 10 ? 1 : 2}"/>`;
      if (yd % 10 === 0) {
        const n = yd <= 50 ? yd : 100 - yd;
        lines += `<text x="${lx}" y="126" text-anchor="middle" font-family="Saira Extra Condensed, Arial Narrow, sans-serif" font-weight="700" font-size="20" fill="rgba(255,255,255,.55)">${n}</text>`;
      }
    }
    const ezText = (t, cx) => `<text x="${cx}" y="76" text-anchor="middle" transform="rotate(${cx < 600 ? -90 : 90} ${cx} 70)" font-family="Saira Extra Condensed, Arial Narrow, sans-serif" font-weight="800" font-size="34" fill="${lightColor(t.c1) ? "#1b1b1b" : "#fff"}" opacity=".9">${esc(t.abbr)}</text>`;
    const markers = opts.hero ? "" : `<line x1="${bx}" y1="8" x2="${bx}" y2="132" stroke="var(--scrimmage)" stroke-width="4"/>
      <line x1="${tx}" y1="8" x2="${tx}" y2="132" stroke="var(--yellow)" stroke-width="5"/>`;
    return `<svg class="field" viewBox="0 0 1200 360" role="img" aria-label="Ball on ${esc(spotText(s.yl, "own "))}">
      <g transform="scale(1 2.25)"><rect x="0" y="0" width="1200" height="140" fill="#1E5A3C"/>
      <rect x="100" y="0" width="1000" height="140" fill="url(#mow)"/>
      <defs><pattern id="mow" width="100" height="140" patternUnits="userSpaceOnUse"><rect width="50" height="140" fill="#22643F"/><rect x="50" width="50" height="140" fill="#1F5C3A"/></pattern></defs>
      <rect x="0" y="0" width="100" height="140" fill="${off.c1}"/>${ezText(off, 50)}
      <rect x="1100" y="0" width="100" height="140" fill="${def.c1}"/>${ezText(def, 1150)}
      ${lines}
      <rect x="0" y="0" width="1200" height="140" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="4"/>
      ${markers}
      <g class="ball-g" id="ball-g" style="transform: translateX(0px)">
        <ellipse cx="${bx}" cy="64" rx="15" ry="9" fill="var(--ball)" stroke="#2b1408" stroke-width="1.5"/>
        <line x1="${bx - 6}" y1="64" x2="${bx + 6}" y2="64" stroke="#fff" stroke-width="1.6"/>
      </g>
      </g><text x="110" y="347" fill="#F1F4EC" font-family="Arial,sans-serif" font-size="22">Possession: ${esc(off.abbr)} →</text><text x="1090" y="347" text-anchor="end" fill="#F7D23E" font-family="Arial,sans-serif" font-size="20">Blue: ball · Yellow: line to gain</text>
    </svg>`;
  }
  // ---------- state ----------
  let state = null;
  let clockTimer = null;

  function clockOn() { return store.get("clock", true); }

  function speedPoints(basePoints, elapsedMs) {
    const seconds = Math.min(CLOCK_SECONDS, Math.max(0, elapsedMs / 1000));
    return Math.round(basePoints * (1 - 0.35 * seconds / CLOCK_SECONDS));
  }
  function speedSummary(results) {
    const n = results.length;
    return {
      score: results.reduce((sum, r) => sum + (r.speedPoints || 0), 0),
      averageSeconds: n ? +(results.reduce((sum, r) => sum + (r.elapsedMs || 0), 0) / n / 1000).toFixed(1) : 0
    };
  }

  // ---------- start screen ----------
  function renderStart() {
    $("start").hidden = false; $("play").hidden = true; $("end").hidden = true;
    const daily = store.get("daily." + today(), null);
    const speed = store.get("speed." + today(), null);
    $("modes").innerHTML = MODES.map((m) => {
      const saved = m.id === "daily" ? daily : m.id === "speed" ? speed : null;
      const done = Boolean(saved);
      const doneLabel = m.id === "speed" && saved
        ? `Done today: ${saved.speed.score}/1000. Tap to see it again.`
        : saved ? `Done today: grade ${esc(saved.grade)}. Tap to see it again.` : "";
      return `<li><button class="mode${done ? " done" : ""}" data-mode="${m.id}">
        <span class="mode-name">${esc(m.name)}</span>
        <span class="mode-desc">${done ? esc(doneLabel) : esc(m.desc)}</span>
        <span class="mode-len">${done ? (m.id === "speed" ? saved.speed.score : esc(saved.grade)) : esc(m.len)}</span></button></li>`;
    }).join("");
    $("modes").querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => startGame(b.dataset.mode)));
    loadLeaderboard();
    $("clock-toggle").checked = clockOn();
    const best = store.get("best", {});
    const bits = Object.entries(best).filter(([m]) => MODES.some(x => x.id === m)).map(([m, v]) => `${(MODES.find((x) => x.id === m) || {}).name || m}: ${v.grade}`);
    $("record").textContent = bits.length ? "Your best so far. " + bits.join(", ") : "";
    $("hero-field").innerHTML = fieldSVG({ kind: "4th", you: "NE", opp: "IND", yl: 72, ytg: 2, down: 4 });
  }

  // ---------- game flow ----------
  function startGame(mode) {
    if (mode === "daily") {
      const prev = store.get("daily." + today(), null);
      if (prev && prev.summary) { state = { mode, results: prev.results, replay: true, date: today() }; return renderEnd(prev.summary, prev.results); }
    }
    if (mode === "speed") {
      const prev = store.get("speed." + today(), null);
      if (prev && prev.summary) { state = { mode, results: prev.results, speed: prev.speed, replay: true, date: today() }; return renderEnd(prev.summary, prev.results); }
    }
    const date = today();
    const opts = { seen: store.get("seen", []) };
    if (mode === "daily" || mode === "speed") { opts.seed = E.hashString("wp-" + mode + "-" + date); opts.dayIndex = Math.max(0, dayIndex(date)); }
    const game = E.buildGame(D, mode, opts);
    state = { mode, game, idx: 0, results: [], strikes: 0, date, simRand: E.mulberry32((game.seed ^ 0x9e3779b9) >>> 0) };
    if (mode === "survival") game.list.push(E.nextSurvival(D, game, 0));
    $("start").hidden = true; $("end").hidden = true; $("play").hidden = false;
    renderScenario();
  }

  function total() { return state.mode === "survival" ? null : state.game.list.length; }

  function renderProgress() {
    const n = total();
    const cells = [];
    const count = n || Math.max(state.results.length + 1, 10);
    for (let i = 0; i < count; i++) {
      const r = state.results[i];
      cells.push(`<span class="${r ? "t-" + r.g.tier : i === state.idx ? "on" : ""}"></span>`);
    }
    $("progress").innerHTML = cells.join("");
    const pts = state.results.reduce((a, r) => a + r.g.points + (r.bonus && r.bonus.correct ? E.BONUS_POINTS : 0), 0);
    const liveSpeed = state.mode === "speed" ? state.results.reduce((a, r) => a + (r.speedPoints || 0), 0) : null;
    const modeName = (MODES.find((m) => m.id === state.mode) || {}).name;
    $("topline-left").innerHTML = `${esc(modeName)} <button class="quit" id="quit">Quit</button>`;
    $("quit").addEventListener("click", () => { stopClock(); renderStart(); });
    const strikes = state.mode === "survival" ? ` <span class="lives" aria-label="${state.strikes} of 3 strikes">${"✕".repeat(state.strikes)}${"·".repeat(3 - state.strikes)}</span>` : "";
    $("topline-right").innerHTML = state.mode === "speed"
      ? `Decision ${state.idx + 1} of ${n}, speed score ${liveSpeed}/1000${strikes}`
      : `Decision ${state.idx + 1}${n ? " of " + n : ""}, ${pts} points${strikes}`;
  }

  function renderScenario() {
    const s = state.game.list[state.idx];
    state.s = s; state.locked = false; state.bonus = null;
    renderProgress();
    const you = team(s.you), opp = team(s.opp);
    const youHasBall = s.ball !== "opp";
    const tag = s.famous ? `<div class="famous-tag"><b>Famous call</b><span>${esc(s.famous.title)}</span></div>` : "";
    const cell = (t, pts, tos, poss, tagText) => `<div class="bug-team" style="background:${t.c1};${lightColor(t.c1) ? "color:#1b1b1b" : ""}">
        <div><span class="abbr" style="${lightColor(t.c1) ? "color:#1b1b1b;text-shadow:none" : ""}">${esc(t.abbr)}</span><span class="tag" style="${lightColor(t.c1) ? "color:#1b1b1b" : ""}">${tagText}</span></div>
        <span class="pts" style="${lightColor(t.c1) ? "color:#1b1b1b;text-shadow:none" : ""}">${pts}</span>
        ${poss ? '<span class="poss" aria-label="has the ball"></span>' : ""}
        <span class="tos" aria-label="${tos} timeouts">${[0, 1, 2].map((i) => `<i class="${i < tos ? "" : "used"}"></i>`).join("")}</span></div>`;
    const bug = `<div class="bug" role="group" aria-label="Scoreboard">
      ${cell(you, s.score[0], s.to[0], youHasBall, "You")}
      ${cell(opp, s.score[1], s.to[1], !youHasBall, "Opponent")}
      <div class="bug-clock"><span class="q">${s.qtr >= 5 ? "OT" : "Q" + s.qtr}</span><span class="t">${esc(s.clock.replace(/^0/, ""))}</span></div>
      <div class="bug-down">${esc(downText(s))}<small>${esc(bugSpot(s))}</small></div>
    </div>`;
    const when = s.famous ? `${esc(s.round)}, ${esc(prettyDate(s.date))}` : `${s.season} ${esc(s.round)}`;
    let sit;
    const timeLeft = `${esc(s.clock.replace(/^0/, ""))} left in the ${ordinalQ(s.qtr)}`;
    if (s.kind === "pat") {
      sit = `${when}. ${esc(you.name)} ${s.home ? "vs." : "at"} ${esc(opp.name)}. Touchdown, ${esc(you.nick)}. ${scoreText(s)} with ${timeLeft}. Kick it or go for two?`;
    } else if (s.kind === "let") {
      sit = `${when}. You're coaching the ${esc(you.name)}. ${scoreText(s)}, but the ${esc(opp.nick)} have 2nd and goal at your 6 with ${timeLeft}. You have one timeout left; so do they. Their kicker can't miss from here.`;
    } else {
      const spot = s.yl <= s.ytg ? `4th and goal from the ${s.yl}` : `4th and ${s.ytg} at ${spotText(s.yl, "your own ")}`;
      sit = `${when}. ${esc(you.name)} ${s.home ? "vs." : "at"} ${esc(opp.name)}. ${scoreText(s)} with ${timeLeft}. It's ${spot}.`;
    }
    const facts = [];
    if (s.kind !== "let") {
      if (s.qb) facts.push(["Your QB", s.qb]);
      if (s.kicker && ("fg" in s.opts || s.kind === "pat")) facts.push(["Your kicker", s.kicker + ("fg" in s.opts && s.inputs.fgDist ? `, a ${s.inputs.fgDist}-yard try` : "")]);
    } else if (s.oppQb) facts.push(["Their QB", s.oppQb]);
    facts.push(["Weather", weatherText(s)]);
    const lt = lineText(s); if (lt) facts.push(["Vegas line", lt]);
    if (s.kind !== "let" && s.oppQb) facts.push(["Their QB", s.oppQb]);
    if (s.rules) facts.push(["Rules", s.rules]);

    $("scenario").innerHTML = `${tag}${bug}${fieldSVG(s)}
      <p class="situation">${sit}</p>
      <p class="model-context">${s.model === "nfl4th" ? "QB and weather are game context. Grades use a league-average model, not player-specific matchup ratings." : "Published estimates and assumptions are explained after your call."}</p><dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;

    const keys = E.optionOrder(s);
    $("choices").innerHTML = keys.map((k, i) => `<button class="choice" data-k="${k}"><span class="key">${i + 1}</span>${esc(E.optionLabel(s, k))}</button>`).join("");
    $("choices").querySelectorAll(".choice").forEach((b) => b.addEventListener("click", () => choose(b.dataset.k, false)));
    $("bonus").innerHTML = ""; $("reveal").innerHTML = "";
    $("ask").hidden = false;
    $("clock").hidden = !(clockOn() || state.mode === "speed");
    window.scrollTo(0, 0);
    startClock();
  }

  // ---------- play clock ----------
  function startClock() {
    stopClock();
    if (!clockOn() && state.mode !== "speed") return;
    const t0 = performance.now();
    state.questionStartedAt = t0;
    const tick = () => {
      const left = Math.max(0, CLOCK_SECONDS - (performance.now() - t0) / 1000);
      $("clock-sec").textContent = Math.ceil(left);
      $("clock-bar").style.transform = `scaleX(${left / CLOCK_SECONDS})`;
      $("clock").classList.toggle("low", left <= 5);
      if (left <= 0) { clockTimer = null; choose(null, true); return; }
      clockTimer = requestAnimationFrame(tick);
    };
    clockTimer = requestAnimationFrame(tick);
  }
  function stopClock() { if (clockTimer) cancelAnimationFrame(clockTimer); clockTimer = null; }

  // ---------- choosing ----------
  function bonusFor(s, choice) {
    if (s.kind === "4th" && choice === "go" && s.ytg <= 1) return s.yl <= 1 ? "goal" : "short";
    if (s.kind === "pat" && choice === "two") return "two";
    return null;
  }

  function choose(key, timedOut) {
    if (state.locked) return;
    state.locked = true;
    stopClock();
    const s = state.s;
    state.elapsedMs = state.mode === "speed"
      ? Math.min(CLOCK_SECONDS * 1000, Math.max(0, performance.now() - (state.questionStartedAt || performance.now())))
      : null;
    if (timedOut && state.mode === "speed") state.elapsedMs = CLOCK_SECONDS * 1000;
    state.choice = key; state.timedOut = timedOut;
    $("choices").querySelectorAll(".choice").forEach((b) => { b.disabled = true; b.classList.toggle("picked", b.dataset.k === key); });
    $("clock").hidden = true;
    if (!timedOut) crowdVote(s, key);
    const bk = bonusFor(s, key);
    if (bk && !timedOut) return askBonus(bk);
    reveal(null);
  }

  function askBonus(bk) {
    const b = D.bonus[bk];
    const keys = Object.keys(b.opts);
    $("bonus").innerHTML = `<div class="bonus"><h3>Bonus: ${esc(b.q)}</h3><p>Worth ${E.BONUS_POINTS} extra points. A miss here never costs you.</p>
      <div class="choices">${keys.map((k, i) => `<button class="choice" data-b="${k}"><span class="key">${i + 1}</span>${esc(b.labels[k])}</button>`).join("")}</div></div>`;
    state.bonusKey = bk;
    $("bonus").querySelectorAll(".choice").forEach((btn) => btn.addEventListener("click", () => {
      const best = keys.reduce((a, k) => (b.opts[k] > b.opts[a] ? k : a), keys[0]);
      const pickK = btn.dataset.b;
      $("bonus").querySelectorAll(".choice").forEach((x) => { x.disabled = true; x.classList.toggle("picked", x === btn); });
      state.bonusKey = null;
      reveal({ key: bk, pick: pickK, best, correct: pickK === best });
    }));
    $("bonus").querySelector(".choice").focus();
  }

  // ---------- reveal ----------
  function inputsText(s, k) {
    const i = s.inputs || {};
    if (s.model !== "nfl4th") return "";
    if (k === "go") return `${f1(i.conv)}% to ${s.yl <= s.ytg ? "score" : "convert"}, ${f1(i.wpS)}% chance to win if successful, ${f1(i.wpF)}% chance to win if unsuccessful`;
    if (k === "fg") return `${f1(i.fgp)}% to make from ${i.fgDist} yards, ${f1(i.wpM)}% chance to win if good, ${f1(i.wpX)}% chance to win if missed`;
    if (k === "punt") return "Pins them deep, gives up the ball";
    if (k === "kick") return `${f1(i.xp)}% to make, ${f1(i.wp1)}% chance to win if good, ${f1(i.wp0)}% chance to win if missed`;
    if (k === "two") return `${f1(i.two)}% to convert, ${f1(i.wp2)}% chance to win if good, ${f1(i.wp0)}% chance to win if missed`;
    return "";
  }
  const DID = { go: "went for it", punt: "punted", fg: "kicked the field goal", kick: "kicked the extra point", two: "went for two" };
  const RESULT = { converted: "It worked.", failed: "It didn't work.", "fg made": "It was good.", "fg missed/blocked": "It missed.", punted: "", good: "It was good.", "no good": "It failed." };

  function reveal(bonus) {
    const s = state.s, key = state.choice;
    const g = E.grade(s, key, {timedOut: state.timedOut});
    const outcome = state.timedOut ? { success: null, text: "" } : E.simulate(s, key, state.simRand);
    const badges = E.badgesFor(s, g, { timedOut: state.timedOut, outcome });
    const elapsedMs = state.mode === "speed" ? state.elapsedMs : null;
    const result = { s, g, bonus, badges, outcome, timedOut: state.timedOut, elapsedMs,
      speedPoints: state.mode === "speed" ? speedPoints(g.points, elapsedMs) : null };
    state.results.push(result);
    if (state.mode !== "daily") { const seen = store.get("seen", []); seen.push(s.id); store.set("seen", seen.slice(-500)); }
    if (state.mode === "survival" && E.SURVIVAL_STRIKE(g)) state.strikes++;
    renderProgress();

    if (state.timedOut) {
      $("reveal").innerHTML = `<div class="verdict"><span class="tier t-delay">Delay of Game</span><span class="sub">0/100 decision points</span></div><p>The play clock expired before you made a call. No play was chosen or simulated.</p><p class="muted">This counts as a missed decision${state.mode === "survival" ? " and a strike" : ""}. No win probability loss is estimated for an unplayed snap.</p><button class="next" id="next">${isLast() ? "See your grade" : "Next decision"}</button>`;
      $("next").addEventListener("click", next); $("next").focus({preventScroll:true}); $("reveal").scrollIntoView({block:"start"}); return;
    }
    const ranked = E.rankedOptions(s);
    const sub = [];
    sub.push(`${g.points}/100 decision points`);
    if (state.mode === "speed") sub.push(`${(elapsedMs / 1000).toFixed(1)} sec · ${result.speedPoints} speed points`);
    if (g.lost) sub.push(`you gave up ${f1(g.cost)} points of win probability`);
    else if (g.tier === "close") sub.push("within a point of the best call");
    let bonusHtml = "";
    if (bonus) {
      const b = D.bonus[bonus.key];
      bonusHtml = `<p class="muted">${bonus.correct ? `Bonus +${E.BONUS_POINTS}.` : "Bonus missed."} ${Object.keys(b.opts).map((k) => `${b.labels[k]} ${f1(b.opts[k])}%`).join(", ")}. ${esc(b.src)}. Part of that gap is game theory: defenses expect the pass because offenses throw so often.</p>`;
    }
    const rows = ranked.map(([k, v]) => {
      const tags = [k === key ? "your call" : "", k === ranked[0][0] ? "best" : ""].filter(Boolean).join(", ");
      return `<li class="wp-row${k === ranked[0][0] ? " best" : ""}"><div class="top"><span class="name">${esc(E.shortLabel(k))}${tags ? `<em>${tags}</em>` : ""}</span><span class="val">${f1(v)}% <small>chance to win</small></span></div>
        <div class="track"><i style="width:${Math.max(1, Math.min(100, v))}%"></i></div>${inputsText(s, k) ? `<div class="inputs">${esc(inputsText(s, k))}</div>` : ""}<div class="comparisons">${ranked.filter(([other]) => other !== k).map(([other, wp]) => `${v >= wp ? "+" : "−"}${f1(Math.abs(v-wp))} percentage points vs. ${esc(E.shortLabel(other).toLowerCase())}`).join(" · ")}</div></li>`;
    }).join("");
    const bestKey = ranked[0][0];
    const alternative = ranked.find(([k]) => k !== key);
    const edge = alternative ? s.opts[key] - alternative[1] : 0;
    const callSummary = `<div class="call-summary"><p><strong>Your call: ${esc(E.shortLabel(key))}</strong> · ${f1(s.opts[key])}% chance to win</p><p>${s.disputed ? "Published models disagree here. Either call receives full credit; see the analysis below." : g.cost < E.CLOSE && key !== bestKey ? `A close call: ${f1(g.cost)} percentage points behind ${esc(E.shortLabel(bestKey).toLowerCase())}. Full credit.` : key === bestKey ? `The model’s best call. ${edge > 0 ? "+" : ""}${f1(edge)} percentage points versus ${esc(E.shortLabel(alternative[0]).toLowerCase())}.` : `${esc(E.shortLabel(bestKey))} was the model’s best call: ${f1(s.opts[bestKey])}% to win, a ${f1(g.cost)} percentage-point edge.`}</p></div>`;
    const ex = E.explain(s);
    const explainLines = ex;
    const assume = E.assumptions(s).map((a) => `<p>${esc(a)}</p>`).join("");

    const tagLine = E.processResultTag(g, outcome);
    const simHtml = `<div class="block"><h3>Simulated play outcome</h3><p class="result-line">${esc(outcome.text)}</p>
      ${tagLine ? `<span class="tag-line">${esc(tagLine)}</span>` : ""}
      ${badges.length ? `<div class="badges">${badges.map((b) => `<span class="badge" title="${esc(b.note)}">${esc(b.label)}</span>`).join("")}</div>` : ""}
      <p class="muted">This is a simulated result, not the historical play. It does not affect your grade. A good call can fail and a bad one can work.</p></div>`;

    $("reveal").innerHTML = `<div class="verdict"><span class="tier t-${g.tier}">${esc(g.tierLabel)}</span><span class="sub">${esc(sub.join(", "))}</span></div>
      ${callSummary}
      ${realLifeHtml(s)}
      <details class="analysis-details"><summary>See the odds and calculations</summary><h3>Chance of winning the game after each decision</h3><p class="muted">These are separate alternatives, not shares of a vote. They do not add to 100%. Each includes the chance of the play succeeding or failing.</p><ul class="wp-list" aria-label="Win probability by option">${rows}</ul>
      <div class="explain">${explainLines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>
      <div class="assume">${assume}</div>${bonusHtml}</details>
      <details class="analysis-details" id="crowd-block"><summary>Compare with coaches and other players</summary>${coachesHtml(s)}<div id="crowd-live"></div></details>
      <details class="analysis-details"><summary>Simulate the play outcome</summary>${simHtml}</details>
      <button class="next" id="next">${isLast() ? "See your grade" : "Next decision"}</button>`;
    $("next").addEventListener("click", next);
    $("next").focus({ preventScroll: true });
    $("reveal").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });

    crowdShow(s);
  }

  function coachesHtml(s) {
    const c = s.coaches;
    if (!c) return "";
    if (s.kind === "pat") return `<p>NFL coaches facing this score ${s.qtr >= 4 ? "in the 4th quarter" : "before the 4th quarter"} went for two ${f1(c.two)}% of the time (${c.n} tries since 2018).</p>`;
    const parts = [`went for it ${f1(c.go || 0)}%`];
    if ("punt" in s.opts || (c.punt || 0) > 0) parts.push(`punted ${f1(c.punt || 0)}%`);
    if ("fg" in s.opts || (c.fg || 0) > 0) parts.push(`kicked a field goal ${f1(c.fg || 0)}%`);
    return `<p>Broad historical comparison since 2021: coaches ${parts.join(", ")} (${c.n} plays). Groups match distance bands, ten-yard field-position bands, and broad score/quarter categories, not the exact clock, timeout or team situation.</p>`;
  }

  function realLifeHtml(s) {
    const you = team(s.you);
    const fin = s.final === "won" ? `The ${you.nick} won the game.` : s.final === "lost" ? `The ${you.nick} lost the game.` : "The game ended in a tie.";
    if (s.famous) {
      const v = (s.famous.verdicts || []).map((x) => `<p class="sources">${esc(x.summary)} <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.source)}</a></p>`).join("");
      return `<div class="block"><h3>What really happened</h3><p>${esc(s.famous.decider)}: ${esc(s.famous.did)} ${esc(fin)}</p>${v ? `<details><summary>Sources and published analysis</summary>${v}</details>` : ""}</div>`;
    }
    const did = DID[s.real.did] || s.real.did;
    const res = RESULT[s.real.result] || "";
    return `<div class="block"><h3>What really happened</h3><p>${esc(s.coach)} ${esc(did)}. ${esc(res)} ${esc(fin)}</p></div>`;
  }

  function isLast() {
    if (state.mode === "survival") return state.strikes >= 3;
    return state.idx >= state.game.list.length - 1;
  }

  function next() {
    if (isLast()) return finish();
    state.idx++;
    if (state.mode === "survival") state.game.list.push(E.nextSurvival(D, state.game, state.idx));
    renderScenario();
  }

  // ---------- public daily speed leaderboard ----------
  function playerKey() {
    let key = store.get("speed-player-key", null);
    if (!key) {
      key = window.crypto && crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16);
      });
      store.set("speed-player-key", key);
    }
    return key;
  }
  async function loadLeaderboard(targetId) {
    const box = $(targetId || "leaderboard-list");
    if (!box) return;
    box.innerHTML = '<p class="muted">Loading today’s scores…</p>';
    try {
      const rows = await rpc("wp_speed_leaderboard", { p_challenge_date: today() });
      if (!rows || !rows.length) { box.innerHTML = '<p class="muted">No scores yet today. Be the first to post one.</p>'; return; }
      box.innerHTML = `<ol class="leaderboard-rows">${rows.slice(0, 20).map((r, i) => `<li><span class="rank">${i + 1}</span><span class="player">${esc(r.nickname)}<small>${esc(r.grade)} · ${Number(r.average_seconds).toFixed(1)} sec avg</small></span><b>${Number(r.score)}/1000</b></li>`).join("")}</ol>`;
    } catch (e) {
      box.innerHTML = '<p class="muted">The public leaderboard is temporarily unavailable.</p>';
    }
  }
  function bindSpeedEntry(summary, speed) {
    const form = $("speed-entry");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector(".entry-status");
      const button = form.querySelector('button[type="submit"]');
      if (!form.reportValidity()) return;
      const nickname = form.elements.nickname.value.trim();
      button.disabled = true; status.textContent = "Submitting your score…";
      try {
        const inserted = await rpc("wp_submit_speed_score", {
          p_challenge_date: state.date || today(),
          p_player_key: playerKey(),
          p_nickname: nickname,
          p_score: speed.score,
          p_base_points: summary.basePoints,
          p_average_seconds: speed.averageSeconds,
          p_grade: summary.grade
        });
        store.set("speed-submitted." + (state.date || today()), true);
        form.innerHTML = inserted
          ? "<h3>Score submitted</h3><p class=\"muted\">You’re on today’s public leaderboard.</p>"
          : "<h3>Score already submitted</h3><p class=\"muted\">One score per browser per day. The public board is below.</p>";
        await loadLeaderboard("end-leaderboard-list");
      } catch (e) {
        button.disabled = false;
        status.textContent = "Couldn’t submit right now. Your result is saved on this device; try again later.";
      }
    });
  }

  // ---------- crowd ----------
  async function rpc(fn, body) {
    const headers = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
    let res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (res.status === 401) {
      res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: Object.assign({ Authorization: "Bearer " + SUPABASE_KEY }, headers), body: JSON.stringify(body) });
    }
    if (!res.ok) throw new Error("crowd " + res.status);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }
  function crowdVote(s, choice) {
    const voted = store.get("voted", {});
    if (voted[s.id]) { state.votePromise = Promise.resolve(); return; }
    voted[s.id] = choice; store.set("voted", voted);
    state.votePromise = rpc("wp_vote", { p_scenario: s.id, p_choice: choice }).catch(() => null);
  }
  async function crowdShow(s) {
    const box = () => $("crowd-live");
    try {
      await state.votePromise;
      const rows = await rpc("wp_tally", { p_scenario: s.id });
      if (!box() || state.s !== s) return;
      const mine = (rows || []).filter((r) => r.choice in s.opts);
      const n = mine.reduce((a, r) => a + Number(r.n), 0);
      if (n < CROWD_MIN) { box().innerHTML = `<p class="muted">${n ? `Only ${n} ${n === 1 ? "player has" : "players have"} seen this one so far.` : "You're the first to see this one."} Crowd numbers appear after ${CROWD_MIN} votes.</p>`; return; }
      const parts = E.optionOrder(s).map((k) => { const r = mine.find((x) => x.choice === k); return [k, r ? Number(r.n) : 0]; });
      const pctOf = (v) => Math.round((100 * v) / n);
      box().innerHTML = `<div class="split" aria-hidden="true">${parts.map(([k, v]) => v ? `<span style="width:${(100 * v) / n}%" title="${esc(E.shortLabel(k))} ${pctOf(v)}%">${pctOf(v) >= 18 ? esc(E.shortLabel(k)) + " " + pctOf(v) + "%" : ""}</span>` : "").join("")}</div>
        <p>Players on this site: ${parts.map(([k, v]) => `${esc(E.shortLabel(k).toLowerCase())} ${pctOf(v)}%`).join(", ")} (${n} votes).</p>`;
    } catch (e) {
      if (box()) box().innerHTML = "";
    }
  }

  // ---------- end ----------
  function finish() {
    const summary = E.summarize(state.results, D);
    if (state.mode === "speed") state.speed = speedSummary(state.results);
    const best = store.get("best", {});
    const prev = best[state.mode];
    if (!prev || summary.points / summary.n > prev.points / prev.n) { best[state.mode] = { grade: summary.grade, points: summary.points, n: summary.n }; store.set("best", best); }
    if (state.mode === "daily") {
      const lite = state.results.map((r) => ({ s: { id: r.s.id, kind: r.s.kind, you: r.s.you, opp: r.s.opp, season: r.s.season, famous: r.s.famous ? { title: r.s.famous.title } : null, opts: r.s.opts, ytg: r.s.ytg, yl: r.s.yl, score: r.s.score }, g: r.g, bonus: r.bonus, badges: r.badges }));
      store.set("daily." + state.date, { grade: summary.grade, summary, results: lite });
    }
    if (state.mode === "speed") store.set("speed." + state.date, { grade: summary.grade, summary, results: state.results, speed: state.speed });
    renderEnd(summary, state.results);
  }

  function recapLabel(s) {
    const you = team(s.you), opp = team(s.opp);
    if (s.famous) return s.famous.title;
    if (s.kind === "pat") return `${s.season} ${you.nick} vs. ${opp.nick}, try at ${s.score[0]}-${s.score[1]}`;
    return `${s.season} ${you.nick}, 4th and ${s.yl <= s.ytg ? "goal" : s.ytg} at ${spotText(s.yl, "own ")}`;
  }

  function renderEnd(summary, results) {
    $("start").hidden = true; $("play").hidden = true; $("end").hidden = false;
    const modeName = (MODES.find((m) => m.id === state.mode) || {}).name;
    const allBadges = [];
    results.forEach((r) => (r.badges || []).forEach((b) => { if (!allBadges.some((x) => x.id === b.id)) allBadges.push(b); }));
    const bonusHits = results.filter((r) => r.bonus && r.bonus.correct).length;
    const speed = state.mode === "speed" ? (state.speed || speedSummary(results)) : null;
    const submittedToday = state.mode === "speed" && store.get("speed-submitted." + (state.date || today()), false);
    const coach = summary.coach ? `<div class="block"><h3>Your coaching tendencies</h3><p>${esc(summary.coach.line)}</p></div>` : "";
    const sw = summary.strength ? `<div class="block"><h3>Scouting report</h3><p>Best at ${esc(summary.strength[0].toLowerCase())} (${Math.round(summary.strength[1])} points a call).${summary.weakness ? ` Worst at ${esc(summary.weakness[0].toLowerCase())} (${Math.round(summary.weakness[1])}).` : ""}${summary.misses ? ` Of your ${summary.misses} misses, ${summary.cons} were too conservative and ${summary.agg} too aggressive.` : ""}</p></div>` : "";
    const recap = results.map((r) => `<li><span class="dot t-${r.g.tier}"></span><span class="what">${esc(recapLabel(r.s))}. You: <b>${esc(r.g.timedOut ? "Delay of Game" : E.shortLabel(r.g.choice))}</b>${!r.g.timedOut && r.g.choice !== r.g.best && r.g.tier !== "close" && r.g.tier !== "optimal" ? `, best: <b>${esc(E.shortLabel(r.g.best))}</b>` : ""}</span><span class="lost">${r.g.timedOut ? "No call" : r.s.disputed ? "Debatable" : r.g.lost ? "−" + f1(r.g.lost) + " pp" : r.g.cost > 0 ? "Close call" : "Best call"}</span></li>`).join("");
    const meta = { mode: state.mode, modeLabel: modeName, dateLabel: prettyDate(state.date || today()) };
    const share = E.shareText(summary, results, meta);
    $("end").innerHTML = `<div class="topline"><span>${esc(modeName)}${state.mode === "daily" ? ", " + esc(prettyDate(state.date || today())) : ""}</span><span></span></div>
      <div class="final-grade"><span class="letter">${esc(summary.grade)}</span><div><div class="label">${esc(summary.style.label)}</div><div class="line">${esc(summary.gradeLine)}</div></div></div>
      <p class="style-line">${esc(summary.style.line)}</p>
      <div class="stat-row"><div><b>${summary.basePoints}/${summary.n * 100}</b><span>decision points · ${f1(summary.scorePct)}%</span></div><div><b>+${summary.bonusPoints}</b><span>bonus points (separate from grade)</span></div>${summary.wpCount ? `<div><b>${f1(summary.lost)}</b><span>WP points lost on completed calls</span></div>` : ""}<div><b>${summary.n}</b><span>decisions</span></div>${bonusHits ? `<div><b>${bonusHits}</b><span>bonus calls</span></div>` : ""}</div>
      ${speed ? `<div class="block speed-result"><h3>Speed score: ${speed.score}/1000</h3><p>Average answer time: ${speed.averageSeconds}s. Your coaching grade still reflects the quality of each decision; the speed score rewards quick calls.</p></div>` : ""}
      ${state.mode === "speed" && !submittedToday ? `<form class="block score-entry" id="speed-entry"><h3>Join today’s public leaderboard</h3><p>Choose a display name. Only your name, score, grade and average answer time will appear.</p><label>Display name <input name="nickname" maxlength="20" minlength="2" pattern="[A-Za-z0-9 ._-]{2,20}" required autocomplete="nickname"></label><label class="consent"><input type="checkbox" name="consent" required> Show my display name and score on the public leaderboard</label><button class="ghost" type="submit">Submit score</button><p class="entry-status muted" aria-live="polite"></p></form>` : state.mode === "speed" ? `<div class="block"><p class="muted">Your score has already been submitted for today.</p></div>` : ""}
      ${speed ? `<div class="block"><h3>Today’s public leaderboard</h3><div id="end-leaderboard-list" aria-live="polite"><p class="muted">Loading today’s scores…</p></div></div>` : ""}
      ${summary.delays ? `<p>${summary.delays} delay of game: zero points for each missed decision.</p>` : ""}${coach}${sw}
      ${allBadges.length ? `<div class="block"><h3>Badges</h3><div class="badges">${allBadges.map((b) => `<span class="badge">${esc(b.label)}</span>`).join("")}</div></div>` : ""}
      <div class="block"><h3>Every call</h3><p class="muted">Best call = no win probability left on the table. Negative numbers show percentage points lost versus the model’s best option, not the change from before the snap.</p><ul class="recap">${recap}</ul></div>
      <div class="actions"><button class="next" id="share">Share graphic</button><button class="ghost" id="copy-result">Copy result text</button><button class="ghost" id="again">${state.mode === "daily" ? "Play a Quick Game" : "Play again"}</button></div>
      <p><button class="quit ghost" id="home" style="margin-top:10px">All modes</button></p>`;
    $("share").addEventListener("click", () => shareGraphic(summary, results, modeName, share));
    $("copy-result").addEventListener("click", () => doShare(share));
    $("again").addEventListener("click", () => startGame(state.mode === "daily" ? "quick" : state.mode));
    $("home").addEventListener("click", renderStart);
    if (speed) loadLeaderboard("end-leaderboard-list");
    if (speed && !submittedToday) bindSpeedEntry(summary, speed);
    window.scrollTo({ top: 0 });
  }

  async function shareGraphic(summary, results, modeName, text) {
    const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 1200;
    const c = canvas.getContext("2d");
    c.fillStyle = "#0E2A1F"; c.fillRect(0,0,1200,1200);
    c.strokeStyle = "#24523c"; c.lineWidth=2;
    for(let x=60; x<1200; x+=100) { c.beginPath(); c.moveTo(x,0); c.lineTo(x,1200); c.stroke(); }
    const line = (txt,y,size,color="#F1F4EC") => { c.fillStyle=color; c.font=`bold ${size}px Arial`; c.fillText(txt,70,y,1060); };
    line("MAKE THE CALL",115,70,"#F7D23E"); line(modeName.toUpperCase(),175,28);
    line(summary.grade,460,260,"#F7D23E"); line(summary.style.label,555,50);
    line(`${summary.basePoints}/${summary.n*100} decision points`,650,46);
    line(`+${summary.bonusPoints} bonus · ${summary.n} decisions${summary.delays ? " · " + summary.delays + " delay of game" : ""}`,710,32);
    if (state.mode === "speed") {
      const speed = state.speed || speedSummary(results);
      line(`SPEED SCORE ${speed.score}/1000 · ${speed.averageSeconds}s avg`,765,32,"#F7D23E");
    }
    line(summary.wpCount ? `${summary.lost} WP points left on the table` : "No completed decisions",810,32);
    const colors={optimal:"#F7D23E",close:"#F7D23E",defensible:"#8FD6B0",costly:"#F2913D",blunder:"#EE5A55",delay:"#F2913D"};
    results.slice(0,40).forEach((r,i) => { c.fillStyle=colors[r.g.tier]; c.fillRect(70+(i%10)*104,840+Math.floor(i/10)*38,88,26); });
    line(summary.wpCount ? "Real NFL decisions. Your instincts. The math." : "The clock. The rules. Your call.",1060,30);
    line("davidsolar.dev/win-probability",1120,30,"#F7D23E");
    canvas.toBlob(async blob => {
      if(!blob) return toast("Could not create graphic. Try copying result text.");
      const file=new File([blob],"make-the-call-result.png",{type:"image/png"});
      try {
        if(navigator.canShare && navigator.canShare({files:[file]}) && matchMedia("(pointer: coarse)").matches) { await navigator.share({files:[file],text}); return; }
        const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=file.name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),60000); toast("Graphic downloaded.");
      } catch(e) { if(e.name!=="AbortError") toast("Could not share. Try copying result text."); }
    },"image/png");
  }

  async function doShare(text) {
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      toast("Result copied. Paste it anywhere.");
    } catch (e) {
      toast("Couldn't copy automatically.");
    }
  }
  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  // ---------- keyboard ----------
  document.addEventListener("keydown", (e) => {
    if ($("play").hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 4) {
      const scope = state.bonusKey ? $("bonus") : !state.locked ? $("choices") : null;
      const btn = scope && scope.querySelectorAll(".choice")[n - 1];
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
    }
  });

  $("clock-toggle").addEventListener("change", (e) => store.set("clock", e.target.checked));
  renderStart();
})();
