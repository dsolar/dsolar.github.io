// Bart Torvik's T-Rank ratings, pulled through a browser on barttorvik.com (his site refuses GitHub's servers, so this
// can't run in a GitHub Action). Run it on any barttorvik.com page: paste it into the console, or run it with a browser
// automation tool there (start it without awaiting, then poll window.__torvikDone).
//
// It reads today's ratings plus his daily archive ("time machine") for the last few days, then hands the result to
// Supabase (the torvik_put function, with the site's public key; see tools/fantasykit_pools.sql), where the Torvik GitHub
// job (torvik.yml, which runs tools/torvik.py) picks it up and publishes cbb/data/torvik.json.
// Set window.__torvikDays first to reach further back (the first run used 21 to cover the season so far).
//
// Payload: {season, pulled, cur: [[team, conf, adjoe, adjde, adjt, barthag, rank, record], ...],
//           hist: {YYYYMMDD: [[team, adjoe, adjde, adjt], ...]}}   (archive files are the ratings as of that morning)
window.__torvikDone = null;
(async () => {
  const now = new Date(), season = String(now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear());
  const days = Math.max(1, Math.min(40, window.__torvikDays || 3));
  const r3 = (v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : null);
  const get = async (u) => { const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(25000) }); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); };
  // team_results columns: 0 rank, 1 team, 2 conf, 3 record, 4 adjoe, 6 adjde, 8 barthag, 44 adjt
  const cur = (await get("/" + season + "_team_results.json")).map((t) => [t[1], t[2], r3(t[4]), r3(t[6]), r3(t[44]), r3(t[8]), t[0], t[3]]);
  if (cur.length < 300) throw new Error("only " + cur.length + " teams in today's ratings");
  const hist = {}, missing = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - i * 86400000), key = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    try { hist[key] = (await get("/timemachine/team_results/" + key + "_team_results.json.gz")).map((t) => [t[1], r3(t[4]), r3(t[6]), r3(t[44])]); }
    catch (e) { missing.push(key); }
    await new Promise((ok) => setTimeout(ok, 300));
  }
  const body = { season, pulled: now.toISOString().slice(0, 16) + "Z", cur, hist };
  const r = await fetch("https://baxrczyufqbzrogftmyn.supabase.co/rest/v1/rpc/torvik_put", { method: "POST", headers: { apikey: "sb_publishable_brDXGevzcoI7mBaPO7Plow_yaUy4gk4", "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
  const txt = await r.text();
  if (!r.ok) throw new Error("Supabase said " + r.status + ": " + txt.slice(0, 200));
  window.__torvikDone = Object.assign(JSON.parse(txt), { days: Object.keys(hist).length, missing });
  return window.__torvikDone;
})().catch((e) => { window.__torvikDone = { error: String(e && e.message || e) }; });
