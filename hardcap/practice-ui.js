/* The practice draft saves only its own local state; it never calls the league server. */
(async function () {
  "use strict";
  const H = window.HardCap, P = window.HardCapPractice;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KEY = "hc:practice:v1";
  let pool, by, league;
  let storageOK = true;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, league })); }
    catch (e) { storageOK = false; }
    $("#practice-save").textContent = storageOK ? "Practice · saved on this device" : "Practice · this visit only";
  }
  try {
    const read = async (url, optional) => { const r = await fetch(url); if (!r.ok) { if (optional) return {}; throw new Error("The player list did not load. Reload to try again."); } return r.json(); };
    const [nba, stats, fixes] = await Promise.all([read("../celtics/data.json"), read("stats.json", true).catch(() => ({})), read("contracts.json", true).catch(() => ({}))]);
    const current = H.latestContracts(nba, stats, fixes);
    pool = H.buildPool(current, stats); by = Object.fromEntries(pool.map(p => [p.id, p]));
    let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
    if (saved && saved.v === 1 && saved.league && saved.league.v === 2 && Array.isArray(saved.league.teams) && saved.league.nba && Array.isArray(saved.league.nba.picks) && saved.league.teams[0] && Array.isArray(saved.league.teams[0].hist)) league = saved.league;
    else league = P.create(current.cba, Date.now());
    P.advance(league, pool, Date.now()); save();
    $("#practice-loading").hidden = true; $("#practice-content").hidden = false;
    if (matchMedia("(max-width:900px)").matches) $("#practice-roster-details").open = false;
    function render(note) {
      const team = league.teams[0], ctx = H.context(league, pool), ids = H.active(team), pay = H.payroll(team, by), line = H.ceilingOf(league, team);
      const done = league.phase !== "nba";
      const c = H.onClock(league, Date.now());
      $("#practice-spent").textContent = H.money(pay);
      $("#practice-room").textContent = H.money(line - pay);
      $("#practice-line").textContent = H.money(line);
      $("#practice-count").textContent = ids.length + " / " + league.settings.roster;
      $("#practice-fill").style.width = Math.min(100, pay / line * 100) + "%";
      $("#practice-meter").setAttribute("aria-valuenow", String(Math.round(pay / line * 100)));
      $("#practice-meter").setAttribute("aria-valuetext", H.money(pay) + " of a " + H.money(line) + " salary cap");
      $("#practice-roster-title").textContent = "Your roster · " + ids.length + " of " + league.settings.roster;
      $("#practice-status").textContent = note || (done ? "Your draft is complete. See how your roster fits, then bring your own league." : "Your pick · round " + c.round + " · pick " + c.pick + " of " + c.total + ". Take your time.");
      $("#practice-complete").hidden = !done;
      $("#practice-players").hidden = done;
      $("#practice-roster").innerHTML = ids.length ? ids.map(id => {
        const p = by[id]; return '<li><span><b>' + esc(p ? p.n : id) + '</b><small>' + esc(p ? H.positions(p).join(" / ") + " · " + p.t : "Contract no longer in the current pool") + '</small></span><strong>' + (p ? H.money(p.sal) : "—") + '</strong></li>';
      }).join("") : '<li class="practice-empty">Your first pick starts the roster. Salary is reserved for the spots you still need to fill.</li>';
      const q = $("#practice-search").value.trim().toLowerCase(), pos = $("#practice-pos").value, fits = $("#practice-fit").checked;
      let rows = ctx.available.filter(p => (!q || (p.n + " " + p.t).toLowerCase().includes(q)) && (!pos || H.positions(p).includes(pos))).sort((a,b) => a.rank - b.rank);
      if (fits) rows = rows.filter(p => H.check(league, team, p, ctx, { reserve: true }).ok);
      $("#practice-matches").textContent = rows.length + " players" + (rows.length > 80 ? " · top 80 shown; search to find anyone" : "");
      $("#practice-list").innerHTML = rows.slice(0,80).map(p => {
        const check = H.check(league, team, p, ctx, { reserve: true });
        return '<li class="practice-player"><span class="practice-name"><b>' + esc(p.n) + '</b><small>' + esc(H.positions(p).join(" / ") + " · " + p.t) + '</small>' + (!check.ok ? '<small class="practice-why">' + esc(check.why) + '</small>' : '') + '</span><span class="practice-player-meta"><strong>' + H.money(p.sal) + '</strong><small>HC score ' + p.hc.toFixed(1) + '</small></span><button type="button" class="btn' + (check.ok ? ' go' : '') + '" data-practice-pick="' + esc(p.id) + '" aria-label="Draft ' + esc(p.n) + '"' + (!check.ok || done ? ' disabled' : '') + '>Draft</button></li>';
      }).join("") || '<li class="practice-empty">No players match. Try another name or position, or turn off “Fits my cap.”</li>';
      const recent = league.nba.picks.slice(-6).reverse();
      $("#practice-recent").innerHTML = recent.length ? recent.map(x => '<li><span>Pick ' + (league.nba.picks.indexOf(x) + 1) + ' · ' + esc(league.teams[x.team].name) + '</span><b>' + esc(x.pid && by[x.pid] ? by[x.pid].n : "Open spot") + '</b></li>').join("") : '<li class="practice-empty">The other nine teams draft after you. Every team has the same salary cap.</li>';
    }
    $("#practice-search").addEventListener("input", () => render());
    $("#practice-pos").addEventListener("change", () => render());
    $("#practice-fit").addEventListener("change", () => render());
    $("#practice-list").addEventListener("click", e => {
      const b = e.target.closest("[data-practice-pick]"); if (!b || b.disabled) return;
      const id = b.dataset.practicePick;
      const result = P.pick(league, pool, id, Date.now());
      if (!result.ok) { render(result.why); return; }
      save(); render((by[id] ? by[id].n : "Your player") + " is on your team. " + (league.phase === "nba" ? "You’re up again." : "Your draft is complete."));
    });
    $("#practice-reset").addEventListener("click", () => {
      if (league.nba.picks.length && !confirm("Start a fresh practice draft? This replaces only the practice roster saved on this device.")) return;
      league = P.create(current.cba, Date.now()); save(); render("Fresh draft. You have the first pick.");
    });
    render();
  } catch (e) { $("#practice-loading").textContent = e.message || "The player list could not load. Reload to try again."; }
})();
