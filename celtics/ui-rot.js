/* Banner 19: the Rotation tab. Minutes to 240, projected net rating and wins, Boston's style meters. */
(function () {
  "use strict";
  const App = window.App, L = window.League, CBA = window.CBA, Mo = window.Model;
  const esc = App.esc, m = App.m;

  function current(W) {
    const t = W.T.BOS;
    const ps = L.teamPlayers(W, "BOS", { two: true });
    if (t.rot) return { ps, mins: Object.assign({}, t.rot), auto: false };
    const r = L.rotationFor(W, "BOS");
    return { ps, mins: r.mins, auto: true };
  }
  const wavg = (ps, mins, f) => { let s = 0, w = 0; for (const p of ps) { const x = f(p); const mm = mins[p.id] || 0; if (x != null && mm) { s += x * mm; w += mm; } } return w ? s / w : null; };

  App.views.rot = {
    render(el) {
      const W = App.W, cur = current(W), ps = cur.ps.slice().sort((a, b) => (cur.mins[b.id] || 0) - (cur.mins[a.id] || 0) || Mo.r(b) - Mo.r(a));
      const total = Object.values(cur.mins).reduce((a, b) => a + b, 0);
      const nets = L.teamNets(W), net = nets.BOS;
      const rank = Object.values(nets).filter(x => x > net).length + 1;
      const wins = L.projWins(W, "BOS");
      // model's own rotation for comparison
      const saved = W.T.BOS.rot; W.T.BOS.rot = null; L.bump(W); const autoWins = L.projWins(W, "BOS"); W.T.BOS.rot = saved; L.bump(W);
      const live = ps.some(p => p.live && p.live.gp);
      const three = wavg(ps, cur.mins, p => p.tpar), ts = wavg(ps, cur.mins, p => p.ts), def = wavg(ps, cur.mins, p => p.d);
      const lg = Object.values(W.P).filter(p => W.T[p.t] && !p.two && (p.mpg || 0) >= 15);
      const lgThree = lg.reduce((a, p) => a + (p.tpar || 0), 0) / lg.length, lgTs = lg.reduce((a, p) => a + (p.ts || 0), 0) / lg.length;
      const tov = live ? wavg(ps, cur.mins, p => p.live && p.live.gp ? p.live.tov / Math.max(1, p.live.mpg) * 36 : null) : null;
      const reb = live ? wavg(ps, cur.mins, p => p.live && p.live.gp ? p.live.rpg / Math.max(1, p.live.mpg) * 36 : null) : null;
      const bucket = { G: 0, W: 0, B: 0 }; for (const p of ps) bucket[p.pos || "W"] += cur.mins[p.id] || 0;
      const starters = new Set(ps.filter(p => (cur.mins[p.id] || 0) > 0).slice(0, 5).map(p => p.id));
      const rows = ps.map(p => {
        const mm = Math.round(cur.mins[p.id] || 0);
        const lv = p.live && p.live.gp ? `, ${p.live.mpg} a night so far` : p.mpg ? `, ${p.mpg} last season` : "";
        return `<li class="${starters.has(p.id) ? "starter" : ""}">
          <div class="who"><b><button class="linkish" type="button" data-act="player" data-id="${p.id}">${esc(p.n)}</button></b><span class="small muted">${esc(App.posName(p))}${p.two ? ", two-way" : ""}${esc(lv)}</span></div>
          <div class="ovr" title="Rating">${App.ovr(p)}</div>
          <input type="range" min="0" max="42" step="1" value="${mm}" aria-label="Minutes for ${esc(p.n)}" data-on="rotMin" data-live data-id="${p.id}">
          <input type="number" min="0" max="48" step="1" value="${mm}" aria-label="Minutes for ${esc(p.n)} (number)" data-on="rotMin" data-id="${p.id}">
        </li>`;
      }).join("");
      const meter = (label, val, lgv, fmt, note, lo, hi) => {
        if (val == null) return `<div><div class="small muted">${esc(label)}</div><div class="small">${esc(note)}</div></div>`;
        const pctv = Math.max(0, Math.min(1, (val - lo) / (hi - lo)));
        return `<div><div class="row" style="justify-content:space-between"><span class="small muted">${esc(label)}</span><b>${fmt(val)}</b></div><div class="meter" role="img" aria-label="${esc(label)} ${fmt(val)}${lgv != null ? ", league " + fmt(lgv) : ""}"><i style="width:${pctv * 100}%"></i></div><div class="small muted">${lgv != null ? "League rotation players: " + fmt(lgv) + ". " : ""}${esc(note)}</div></div>`;
      };
      el.innerHTML = `
      <section class="panel" aria-labelledby="rot-h">
        <h2 id="rot-h">Rotation</h2>
        <p class="sub">${esc(W.T.BOS.coach || "Joe Mazzulla")}'s minutes, your call. The top five by minutes start. ${cur.auto ? "This is the model's rotation; move any slider to make it yours." : "Your rotation. When someone's hurt, his minutes go to the rest of your rotation."}</p>
        <div class="grid2">
          <div class="card">
            <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
              <div><span class="bigstat ${Math.abs(total - 240) < 1 ? "" : "bad"}">${Math.round(total)}</span> <span class="muted">of 240 minutes</span></div>
              <div class="row"><button class="btn ghost sm" type="button" data-act="rotFit"${Math.abs(total - 240) < 1 ? " disabled" : ""}>Fit to 240</button><button class="btn ghost sm" type="button" data-act="rotAuto"${cur.auto ? " disabled" : ""}>Use the model's</button></div>
            </div>
            <ul class="plain rot">${rows}</ul>
          </div>
          <div>
            <div class="card">
              <div class="grid3" style="gap:10px">
                <div><div class="small muted">Net rating</div><div class="bigstat gold">${net >= 0 ? "+" : ""}${net.toFixed(1)}</div><div class="small">${rank}${["th", "st", "nd", "rd"][rank % 10 > 3 || [11, 12, 13].includes(rank) ? 0 : rank % 10]} in the league</div></div>
                <div><div class="small muted">Projected wins</div><div class="bigstat">${wins.toFixed(0)}</div><div class="small">${cur.auto ? "Model's rotation" : `Model's rotation: ${autoWins.toFixed(0)}`}</div></div>
                <div><div class="small muted">Title odds</div><div class="bigstat">${App.pct(App.titleOdds().BOS || 0)}</div><div class="small">From 160 simulated playoffs</div></div>
              </div>
            </div>
            <div class="card" style="margin-top:14px">
              <h3>The Stevens checklist</h3>
              <p class="small muted" style="margin-top:0">Boston's front office plays the possession game: shoot more threes than anyone, win the turnover and offensive-rebound battles, defend without fouling. Minutes-weighted for your rotation.</p>
              <div style="display:grid;gap:12px">
                ${meter("Three-point rate", three, lgThree, v => App.pct(v), "Share of shots from three.", 0.25, 0.6)}
                ${meter("True shooting", ts, lgTs, v => (v * 100).toFixed(1) + "%", "Scoring efficiency.", 0.52, 0.64)}
                ${meter("Defense", def, null, v => (v >= 0 ? "+" : "") + v.toFixed(2) + " per 100", "Defensive impact per player on the floor.", -1, 2)}
                ${meter("Turnovers per 36", tov, null, v => v.toFixed(1), live ? "Lower is better. From this season's live stats." : "Shows up once live stats start.", 0.8, 3)}
                ${meter("Rebounds per 36", reb, null, v => v.toFixed(1), live ? "From this season's live stats." : "Shows up once live stats start.", 5, 11)}
              </div>
            </div>
            <div class="card" style="margin-top:14px">
              <h3>Minutes by position</h3>
              <p class="small" style="margin:0">Guards ${Math.round(bucket.G)}, wings ${Math.round(bucket.W)}, bigs ${Math.round(bucket.B)}.</p>
              <p class="small muted" style="margin:4px 0 0">${bucket.B < 44 ? "Thin at center: under 44 big-man minutes. " : ""}${bucket.G < 60 ? "Light on guards: under 60 minutes. " : ""}${bucket.B >= 44 && bucket.G >= 60 ? "Covers every spot." : ""}</p>
            </div>
          </div>
        </div>
      </section>`;
    }
  };
  App.acts.rotMin = (el, e) => {
    const W = App.W, cur = current(W);
    const v = Math.max(0, Math.min(48, Math.round(+el.value || 0)));
    cur.mins[el.dataset.id] = v;
    W.T.BOS.rot = cur.mins;
    // live slider drags only update numbers; a full re-render happens on change
    if (el.type === "range" && e && e.type === "input") {
      const n = el.parentElement.querySelector("input[type=number]"); if (n) n.value = v;
      L.bump(W); App.save();
      return;
    }
    App.afterChange();
    const again = document.querySelector(`[data-on="rotMin"][data-id="${el.dataset.id}"][type="${el.type}"]`);
    if (again) again.focus();
  };
  App.acts.rotFit = () => {
    const W = App.W, cur = current(W), tot = Object.values(cur.mins).reduce((a, b) => a + b, 0);
    if (!tot) return;
    const k = 240 / tot; const out = {};
    for (const [id, v] of Object.entries(cur.mins)) out[id] = Math.min(48, Math.round(v * k));
    let diff = 240 - Object.values(out).reduce((a, b) => a + b, 0);
    const ids = Object.keys(out).sort((a, b) => out[b] - out[a]);
    for (let k2 = 0; diff !== 0 && k2 < 200; k2++) { const id = ids[k2 % ids.length]; if (out[id] > 0) { out[id] += Math.sign(diff); diff -= Math.sign(diff); } }
    W.T.BOS.rot = out; App.afterChange();
  };
  App.acts.rotAuto = () => { App.W.T.BOS.rot = null; App.afterChange(); };
})();
