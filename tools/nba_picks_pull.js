// RealGM's detailed list of every traded NBA pick, pulled through a browser (RealGM refuses cloud servers).
// Run it on https://basketball.realgm.com/nba/draft/future_drafts/detailed: paste it into the console, or run it with a
// browser automation tool there. It hands the page's 30 team tables to Supabase (nba_picks_put, with the site's public
// key; see tools/fantasykit_pools.sql), and tools/nba_picks.py turns them into the NBA pick ledger.
// Payload: {pulled, teams: {"Boston Celtics": [[year, incoming text, outgoing text], ...], ...}}
(async () => {
  const teams = {};
  for (const h of document.querySelectorAll("h2")) {
    const m = /^(.+) Future Traded Pick Details$/.exec(h.textContent.trim()); if (!m) continue;
    let t = h.nextElementSibling; while (t && t.tagName !== "TABLE" && !t.querySelector("table")) t = t.nextElementSibling;
    if (t && t.tagName !== "TABLE") t = t.querySelector("table");
    if (!t) continue;
    teams[m[1]] = [...t.querySelectorAll("tbody tr")].map((r) => [...r.cells].map((c) => c.innerText.trim()));
  }
  const body = { pulled: new Date().toISOString().slice(0, 16) + "Z", teams };
  const r = await fetch("https://baxrczyufqbzrogftmyn.supabase.co/rest/v1/rpc/nba_picks_put", { method: "POST", headers: { apikey: "sb_publishable_brDXGevzcoI7mBaPO7Plow_yaUy4gk4", "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
  return r.status + " " + (await r.text()).slice(0, 200);
})();
