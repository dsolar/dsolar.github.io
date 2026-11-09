// Hard Cap's server clock. pg_cron calls this once a minute (tools/hardcap_supabase.sql). For every active league it
// runs the same rules the pages run (hardcap/engine.js, fetched from the live site): draft clocks and bot picks,
// the Prospect Board auction and Monday waivers when they come due, lineup locks, releasing anyone a real NBA
// team has waived, closing trade reviews and holding teams to their line. Then it sends web push notifications:
// on the clock, trade offers, reviews and answers, waiver and auction results, and a lineup warning when a starter
// is listed Out.
//
// Saves go through hc_system_save with the version the clock started from, so a manager's save in the same moment
// wins and the clock simply tries again next minute. Each notification is claimed once in hc_sent.
import webpush from "npm:web-push@3.6.7";

const SITE = "https://davidsolar.dev";
const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H_ = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...H_, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}
const rpc = (fn: string, body: unknown) => rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(body) });

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The engine and the data change at most a few times a day; keep them for five minutes between runs.
let cache: { at: number; H: any; nba: any; stats: any } | null = null;
async function load() {
  if (cache && Date.now() - cache.at < 5 * 60e3) return cache;
  const bust = `?t=${Math.floor(Date.now() / 300e3)}`;
  const [lib, src, sheet, stats, fixes] = await Promise.all([
    fetch(`${SITE}/nba/lib/contracts.js${bust}`).then((r) => (r.ok ? r.text() : null)).catch(() => null),
    fetch(`${SITE}/hardcap/engine.js${bust}`).then((r) => r.text()),
    fetch(`${SITE}/celtics/data.json${bust}`).then((r) => r.json()),
    fetch(`${SITE}/hardcap/stats.json${bust}`).then((r) => r.json()).catch(() => ({})),
    fetch(`${SITE}/hardcap/contracts.json${bust}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  // The engine takes its contract code from the shared NBA library: load that first, as the pages do.
  if (lib) {
    const shared = { exports: {} as any };
    new Function("module", lib)(shared);
    (globalThis as any).NbaContracts = shared.exports;
  }
  const module = { exports: {} as any };
  new Function("module", src)(module);
  const H = module.exports;
  const nba = H.latestContracts ? H.latestContracts(sheet, stats, fixes) : sheet;
  cache = { at: Date.now(), H, nba, stats };
  return cache;
}

type Push = { title: string; body: string; url: string; tag?: string };

Deno.serve(async (req) => {
  const cfg = Object.fromEntries(((await rest("hc_config?select=name,value")) as { name: string; value: string }[]).map((r) => [r.name, r.value]));
  const token = req.headers.get("X-HC-Clock") || "";
  if (!token || (await sha256(token)) !== cfg.scheduler_token_hash) {
    return new Response("Not the clock", { status: 401 });
  }
  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private);
  const { H, nba, stats } = await load();
  const opener = stats.opener || "2026-10-20";
  const inj = stats.inj || {};
  const PROS = H.buildProspects(nba);
  const basePool = H.buildPool(nba, stats);
  const since = new Date(Date.now() - 150 * 864e5).toISOString();
  const leagues = (await rest(`hc_leagues?select=id,version,state&state->>phase=in.(nba,prospects,league)&updated_at=gte.${since}`)) as any[];
  const report: any[] = [];

  for (const row of leagues) {
    const out: any = { id: row.id, saved: false, pushes: 0 };
    try {
      const now = Date.now();
      const pool = row.state.contracts && Object.keys(row.state.contracts).length ? H.buildPool(H.mergeContracts(nba, row.state.contracts), stats) : basePool;
      const byId = Object.fromEntries(pool.map((p: any) => [p.id, p]));
      const L = structuredClone(row.state);
      const cw = Math.min(H.totalWeeks(L), H.weekOf(opener, new Date(now)));
      const notes: string[] = [];
      let clear: string | null = null;
      const sealed = async (kind: string) => {
        const rows = (await rest(`hc_sealed?select=team,bids&league=eq.${row.id}&kind=eq.${kind}`)) as any[];
        return Object.fromEntries(rows.map((r) => [r.team, r.bids]));
      };
      if (L.phase === "nba" && !L.nba.paused && H.catchUp(L, pool, now, 400)) notes.push("draft clock");
      if (L.phase === "prospects" && L.due.auction && now >= Date.parse(L.due.auction)) {
        H.resolveAuction(L, PROS, await sealed("auction"), now); clear = "auction"; notes.push("auction");
      } else if (L.phase === "league") {
        if (L.due.waiver && now >= Date.parse(L.due.waiver)) {
          const order = H.standings(L, cw - 1, H.withVorp ? H.withVorp(stats) : stats.wk, byId).map((x: any) => x.id);
          H.runWaivers(L, pool, PROS, await sealed("waiver"), cw - 1, order, now, inj); clear = "waiver"; notes.push("waivers");
        }
        if (H.lockLineups(L, pool, now, opener)) notes.push("lineups");
        if (H.releaseGone(L, pool, cw, now)) notes.push("NBA releases");
        if (H.finalizeTrades && H.finalizeTrades(L, pool, now, cw)) notes.push("trade reviews");
        if (H.enforceLine && H.enforceLine(L, pool, now, cw, opener)) notes.push("cap line");
      }
      let S = row.state;
      if (notes.length) {
        const r: any = await rpc("hc_system_save", { p_id: row.id, p_version: row.version, p_state: L, p_note: "Clock: " + notes.join(", "), p_clear: clear });
        if (r.ok) { S = L; out.saved = notes; } else { out.stale = true; report.push(out); continue; }
      }
      out.pushes = await notify(H, row.id, S, now, cw, byId, inj, opener);
    } catch (e) {
      out.error = String(e).slice(0, 300);
    }
    report.push(out);
  }
  return new Response(JSON.stringify({ at: new Date().toISOString(), leagues: report }), { headers: { "Content-Type": "application/json" } });
});

async function notify(H: any, id: string, L: any, now: number, cw: number, byId: any, inj: any, opener: string) {
  const fresh = (t: number) => t && now - t < 30 * 60e3;              // never push about anything older than 30 minutes
  const link = (hash: string) => `${SITE}/hardcap/?l=${id}${hash}`;
  const owned = (t: number) => L.teams[t] && L.teams[t].owner;
  const msgs: [number, string, Push][] = [];                           // [team, once-key, message]
  const nm = (pid: string) => (byId[pid] ? byId[pid].n : String(pid).replace(/^c-/, "").replace(/-/g, " "));
  const when = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });

  if (L.phase === "nba") {
    const c = H.onClock(L, now);
    if (c && owned(c.team) && !L.nba.paused) {
      const hrs = L.settings.draftMode === "slow" ? `${L.settings.slowHours} hours` : `${L.settings.clock} seconds`;
      msgs.push([c.team, `clock:${c.pick}`, { title: "You're on the clock", body: `${L.name}: pick ${c.pick}, round ${c.round}. You have ${hrs}; your queue picks if time runs out.`, url: link("#draft/players"), tag: "clock" }]);
    }
  }
  if (L.phase === "prospects" && fresh(L.nba.done)) for (const t of L.teams) if (t.owner) msgs.push([t.id, `draftdone`, { title: "The draft is done", body: `Prospect Board bids are open until ${when(Date.parse(L.due.auction))}.`, url: link("#draft/prospects") }]);
  for (const t of L.trades || []) {
    if (t.status === "pending" && fresh(t.at) && owned(t.to)) msgs.push([t.to, `trade:${t.id}:offer`, { title: "Trade offer", body: `${L.teams[t.from].name} wants to make a deal. Open Trades to accept or decline.`, url: link("#team/trades") }]);
    if (t.status === "review" && fresh(t.accepted)) {
      for (const v of H.voters(L, t)) msgs.push([v, `trade:${t.id}:review`, { title: "Trade up for review", body: `${L.teams[t.from].name} and ${L.teams[t.to].name} agreed to a deal. You have ${L.settings.reviewHours} hours to vote to veto it.`, url: link("#team/trades") }]);
      for (const team of [t.from, t.to]) if (owned(team)) msgs.push([team, `trade:${t.id}:accepted-review`, { title: "Trade accepted", body: `Your deal is in league review until ${when(t.reviewEnds)}.`, url: link("#team/trades") }]);
    }
    if (t.status !== "pending" && t.status !== "review" && fresh(t.closed || t.vetoed)) {
      const word = { accepted: "went through", declined: "declined", failed: "fell through", withdrawn: "was withdrawn", vetoed: "was vetoed" }[t.status as string] || t.status;
      const to = t.status === "vetoed" || (t.status === "accepted" && t.accepted) ? [t.from, t.to] : t.status === "withdrawn" ? [t.to] : [t.from];
      for (const team of to) if (owned(team)) msgs.push([team, `trade:${t.id}:${t.status}:${team}`, { title: `Trade ${word}`, body: `Your deal with ${L.teams[team === t.from ? t.to : t.from].name} ${word}.`, url: link("#team/trades") }]);
    }
  }
  const run = L.lastWaiverRun;
  if (run && fresh(run.at)) {
    const by: Record<number, any[]> = {};
    for (const r of run.results) (by[r.team] ||= []).push(r);
    for (const [team, rs] of Object.entries(by)) {
      if (!owned(+team)) continue;
      const won = rs.filter((r: any) => r.ok);
      msgs.push([+team, `waiver:${run.at}`, { title: "Waivers ran", body: won.length ? `You signed ${won.map((r: any) => `${nm(r.add)} ($${r.amt})`).join(", ")}.` : `None of your ${rs.length} bid${rs.length === 1 ? "" : "s"} won this week.`, url: link("#league/tx") }]);
    }
  }
  if (L.auction && fresh(L.auction.closed)) for (const t of L.teams) {
    if (!t.owner) continue;
    const won = L.auction.results.filter((r: any) => r.won && r.team === t.id);
    msgs.push([t.id, `auction:${L.auction.closed}`, { title: "Prospect Board results", body: won.length ? `You won ${won.map((r: any) => `${nm(r.pid)} ($${r.amt})`).join(" and ")}.` : "No prospects this time. Unclaimed ones stay available on waivers.", url: link("#draft/prospects") }]);
  }
  for (const x of (L.log || []).slice(-40)) if (x.kind === "nba" && fresh(x.at) && owned(x.team)) msgs.push([x.team, `nba:${x.at}:${x.text.slice(0, 40)}`, { title: "Real NBA move", body: x.text, url: link("#team") }]);
  for (const x of (L.log || []).slice(-40)) if (x.kind === "line" && fresh(x.at) && owned(x.team)) msgs.push([x.team, `line:${x.at}`, { title: "Over your line", body: x.text, url: link("#team") }]);
  // A lineup warning six hours before the lock when someone starting is listed Out.
  if (L.phase === "league") {
    const lock = H.lockTime(opener, cw);
    if (now < lock && lock - now < 6 * 3600e3) for (const t of L.teams) {
      if (!t.owner) continue;
      const out = H.lineupFor(L, t, cw, byId).filter((pid: string) => pid && H.isOut(inj[pid]));
      if (out.length) msgs.push([t.id, `lineup:${cw}`, { title: "Lineups lock tonight", body: `${out.map(nm).join(", ")} ${out.length === 1 ? "is" : "are"} listed Out and starting for you. Lineups lock at 7 p.m. Eastern.`, url: link("#team") }]);
    }
  }

  let sent = 0;
  for (const [team, key, msg] of msgs) {
    const first = await rpc("hc_mark_sent", { p_id: id, p_key: `${key}:${team}` });
    if (first !== true) continue;
    const subs = (await rest(`hc_push?select=endpoint,sub&league=eq.${id}&team=eq.${team}`)) as any[];
    for (const s of subs) {
      try { await webpush.sendNotification(s.sub, JSON.stringify(msg), { TTL: 6 * 3600 }); sent++; }
      catch (e: any) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) await rest(`hc_push?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" });
      }
    }
  }
  return sent;
}
