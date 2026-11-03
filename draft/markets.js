/* Markets tab: Kalshi's player markets for the class (who goes No. 1, who goes top five, the order the
   quarterbacks go, who declares), next to each player's consensus rank. Player props only. */
(function () {
  "use strict";
  const { $, esc, fmtDay } = BB;
  let D = null;

  function card(m) {
    const top = m.outcomes.slice(0, 10);
    const rest = m.outcomes.length - top.length;
    const max = Math.max(...top.map((o) => o.p), 1);
    return `<article class="mkt">
      <header><h3>${esc(m.title)}</h3>${m.url ? `<a class="note" href="${esc(m.url)}" target="_blank" rel="noopener">Kalshi</a>` : ""}</header>
      <ol>${top.map((o) => {
        const p = o.pid && D.players.find((x) => x.id === o.pid);
        const gap = p ? p.rank : null;
        return `<li><span class="mn"><b>${esc(o.n)}</b><small>${p ? `${esc([p.pos, p.school].filter(Boolean).join(", "))} &middot; board No. ${gap}` : "not on the board yet"}</small></span>
          <span class="mbar" aria-hidden="true"><i style="width:${(100 * o.p / max).toFixed(1)}%"></i></span><span class="mp">${Math.round(o.p)}%</span></li>`;
      }).join("")}</ol>
      ${rest > 0 ? `<p class="note">${rest} more below ${Math.round(top[top.length - 1].p)}%.</p>` : ""}
    </article>`;
  }

  async function render(lg) {
    const el = $("#markets-view");
    try { D = await BB.data(lg); } catch (e) { el.innerHTML = `<p class="note">Couldn't load the markets. Try a refresh.</p>`; return; }
    const M = D.markets;
    el.innerHTML = `<section class="markets">
      <div class="setup-head"><h2 class="disp">Markets</h2><p class="sub">What Kalshi's traders think, player by player. Each chance is the middle of the bid and the ask,
        so a thin market can sit a few points off. Markets too thin to mean anything are left off. ${M ? `Updated ${fmtDay(M.updated)}.` : ""}</p></div>
      ${M && M.list.length ? `<div class="mkt-grid">${M.list.map(card).join("")}</div>`
        : `<p class="note">No ${lg.toUpperCase()} player markets are open yet. Sportsbooks usually post draft props in the spring; they'll show up here when a source is added.</p>`}
      <p class="note">Prediction-market prices, shown for reference. Not betting advice.</p>
    </section>`;
  }

  window.Markets = { render };
})();
