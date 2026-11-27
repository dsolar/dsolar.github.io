// The Fantasy Kit's server clock. pg_cron calls this every five minutes (tools/fantasykit_supabase.sql) so shared
// leagues keep moving with nobody's page open. For each draft that's live it makes the overdue picks (bots and
// expired clocks); for each league in season it plays out ended weeks, runs waivers, bots and trade reviews, all with
// the same code the pages run (fantasy-kit/*.js, fetched from the live site). Saves go through fk_clock_save with the
// version it started from, so a manager's save in the same moment wins and the clock tries again next run.
//
// Each alert also goes to the manager's phones and computers as a web push (fk_push), signed with the site's VAPID
// keys (Hard Cap's, in hc_config). A new alert wakes ?mail=1 right away (the fk_wake_mail trigger).
//
// Then it sends the email outbox with Resend, once the secrets RESEND_API_KEY and FK_MAIL_FROM are set
// (FK_MAIL_FROM like "Draft Lab <leagues@davidsolar.dev>", on a domain verified in Resend). Until then emails wait.
import webpush from "npm:web-push@3.6.7";
const SITE = "https://davidsolar.dev/fantasy-kit/";
const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

async function rpc(fn: string, body: unknown) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// The engine changes at most a few times a day; keep it, and each sport's player data, for ten minutes.
// It's the last commit whose engine passed its tests (fantasy-kit/stable.json, written by the Draft Lab tests
// workflow), fetched from GitHub at that commit, so a push that breaks the engine doesn't break every league's clock.
// No stable.json, or GitHub down: the live site's copy, as before.
const RAW = "https://raw.githubusercontent.com/dsolar/dsolar.github.io/";
let engine: { at: number; FK: any; sha: string | null } | null = null;
const pools: Record<string, { at: number; data: any }> = {};
async function stableSha(): Promise<string | null> {
  try {
    const r = await fetch(`${SITE}stable.json?t=${Math.floor(Date.now() / 300e3)}`);
    const j = r.ok ? await r.json() : null;
    return j && /^[0-9a-f]{7,40}$/.test(j.sha || "") ? j.sha : null;
  } catch { return null; }
}
async function loadFrom(base: string, bust: string) {
  const g: any = { FK: {} };
  for (const f of ["sports", "value", "draft", "trivia", "rules", "league", "season"]) {
    try {
      const r = await fetch(`${base}${f}.js${bust}`);
      if (!r.ok) throw new Error(`${f}.js: ${r.status}`);
      const src = await r.text();
      // the files are UMD: with no module or require around, each one adds itself to root.FK
      new Function("module", "require", src).call(g, undefined, undefined);
    } catch (e) { if (f !== "trivia" && f !== "rules") throw e; }   // trivia questions and the rules list are optional: the rest runs without them
  }
  return g.FK;
}
async function loadEngine() {
  if (engine && Date.now() - engine.at < 10 * 60e3) return engine.FK;
  const sha = await stableSha();
  let FK: any = null, used: string | null = null;
  if (sha) { try { FK = await loadFrom(`${RAW}${sha}/fantasy-kit/`, ""); used = sha; } catch { FK = null; } }
  if (!FK) FK = await loadFrom(SITE, `?t=${Math.floor(Date.now() / 600e3)}`);
  engine = { at: Date.now(), FK, sha: used };
  return FK;
}
async function loadData(sport: string) {
  const c = pools[sport];
  if (c && Date.now() - c.at < 10 * 60e3) return c.data;
  const data = await fetch(`${SITE}data/${sport}.json?t=${Math.floor(Date.now() / 600e3)}`).then((r) => r.json());
  pools[sport] = { at: Date.now(), data };
  return data;
}
// An IDP league (DL/LB/DB/IDP lineup slots) also plays defenders: their players and weekly lines are in their own
// files, nfl-idp.json and weeks-nfl-idp.json, merged in here (S.addIdp, S.addIdpWeeks)
async function loadIdp(name: string) {
  const c = pools[name];
  if (c && Date.now() - c.at < 10 * 60e3) return c.data;
  const data = await fetch(`${SITE}data/${name}.json?t=${Math.floor(Date.now() / 600e3)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  pools[name] = { at: Date.now(), data };
  return data;
}

// Real weekly box scores (fantasy-kit/data/weeks-<sport>.json), for leagues scored on real games. None for a sport
// out of season, or when the file is for another season than the player data.
const weekFiles: Record<string, { at: number; data: any }> = {};
async function loadWeeks(sport: string, season: string) {
  const c = weekFiles[sport];
  if (!c || Date.now() - c.at >= 10 * 60e3) {
    const data = await fetch(`${SITE}data/weeks-${sport}.json?t=${Math.floor(Date.now() / 600e3)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    weekFiles[sport] = { at: Date.now(), data };
  }
  const w = weekFiles[sport].data;
  return w && String(w.season) === String(season) ? w : null;
}

// Daily box scores (fantasy-kit/data/days-<sport>.json: the current and last week, day by day), for leagues with
// daily lineups, which score each day's starters on that day's games.
const dayFiles: Record<string, { at: number; data: any }> = {};
async function loadDays(sport: string, season: string) {
  const c = dayFiles[sport];
  if (!c || Date.now() - c.at >= 10 * 60e3) {
    const data = await fetch(`${SITE}data/days-${sport}.json?t=${Math.floor(Date.now() / 600e3)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    dayFiles[sport] = { at: Date.now(), data };
  }
  const d = dayFiles[sport].data;
  return d && String(d.season) === String(season) ? d : null;
}

// Outside dynasty rankings (fantasy-kit/data/dynasty-<sport>.json), for dynasty leagues' values.
const dynFiles: Record<string, { at: number; data: any }> = {};
async function loadDynasty(sport: string) {
  const c = dynFiles[sport];
  if (!c || Date.now() - c.at >= 60 * 60e3) {
    const data = await fetch(`${SITE}data/dynasty-${sport}.json?t=${Math.floor(Date.now() / 3600e3)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    dynFiles[sport] = { at: Date.now(), data };
  }
  return dynFiles[sport].data;
}

// Next year's class from the Big Board (draft/nba.json, draft/nfl.json), for a dynasty's rookie pick values.
const boards: Record<string, { at: number; data: any }> = {};
async function loadClass(S: any, sport: string) {
  const c = boards[sport];
  if (!c || Date.now() - c.at >= 60 * 60e3) {
    const data = await fetch(`https://davidsolar.dev/draft/${sport}.json?t=${Math.floor(Date.now() / 3600e3)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    boards[sport] = { at: Date.now(), data };
  }
  return S.prospectClass ? S.prospectClass(boards[sport].data, sport) : null;
}

// This week's live feed for a sport (kickoff times), once per sweep: the late-scratch alert needs to know whose game
// hasn't started, and nobody may have the league open to set it from a page
const liveFeeds: Record<string, { at: number; p: Promise<any> }> = {};
function liveFeed(sport: string) {
  const c = liveFeeds[sport];
  if (c && Date.now() - c.at < 4 * 60e3) return c.p;   // a warm worker keeps this between sweeps: a few minutes at most
  const p = fetch(`${URL_}/functions/v1/fk-live?sport=${encodeURIComponent(sport)}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  liveFeeds[sport] = { at: Date.now(), p };
  return p;
}

// One league's turn: overdue picks in a live draft, or an ended week, waivers and trades in a season, saved with the
// version it started from. one: a single league woken by its own save (see bots below), not the five-minute sweep.
async function advance(FK: any, token: string, l: any, one: boolean) {
  const { sports: S, value: V, draft: F, league: G, season: Z } = FK;
  const out: any = { id: l.id };
  try {
      const now = Date.now();
      let D = l.draft, L = l.league;
      // a live draft someone saved in the last minute has a page driving it (the five-minute sweep leaves it alone;
      // a nudge for that league, right after a save, is how the server keeps its bots moving)
      if (!one && !L && now - l.updated < 60e3) { out.skip = "busy"; return out; }
      const doc = L ? L.draft || D : D;
      const idp = l.sport === "nfl" && S.usesIdp && S.usesIdp(doc);
      const data = idp ? S.addIdp(await loadData(l.sport), await loadIdp("nfl-idp")) : await loadData(l.sport);
      const sport = S.withScoring(S.attach(Object.assign({}, S[l.sport]), data), doc.scoringSpec);
      // a showdown plays one game: its two teams are the whole player pool
      let players = data.players.filter((p: any) => !S.inPool || S.inPool(L || D, p)).map((p: any) => Object.assign({}, p));
      // a Hard Cap league: real salaries, and a pool of players on real contracts (plus anyone already rostered)
      const hc = S.hardCapOf ? S.hardCapOf(L) || S.hardCapOf(D) : null;
      if (hc) {
        const hcf = await loadIdp(`contracts-${l.sport}`);
        if (!hcf) { out.skip = "no contracts"; return out; }
        S.addContracts(players, hcf, hc);
        players = S.capPool(players, L ? L.rosters.flat() : F.rosters(D).flat());
      }
      // players the feed doesn't carry (a prospect pool, someone hurt all year) come with the league (doc.extraPlayers)
      const xs = (L && L.extraPlayers) || (D && D.extraPlayers);
      if (Array.isArray(xs)) { if (S.withExtras) S.withExtras(players, { extraPlayers: xs }); else { const have = new Set(players.map((p: any) => p.id)); for (const x of xs) if (!have.has(x.id)) players.push(Object.assign({ l: {}, rank: 9999 }, x)); } }
      const dyn = (L && L.settings && L.settings.dynasty) || (doc.season && doc.season.dynasty);
      const weeks = idp ? S.addIdpWeeks(await loadWeeks(l.sport, data.season), await loadIdp("weeks-nfl-idp")) : await loadWeeks(l.sport, data.season);
      // best ball values upside and depth; a guillotine keeps normal ranks
      const bb = L ? !!L.settings.bestBall && L.settings.format !== "guillotine" : !!(doc.season && doc.season.bestBall && doc.season.format !== "guillotine");
      V.evaluate(sport, players, { teams: doc.teams.length, lineup: doc.lineup, bench: doc.bench, scoring: doc.scoring, budget: doc.auction ? doc.auction.budget : 200, week: S.weekFor ? S.weekFor(L || D, sport) : null, oneDay: !!(S.dayOf && S.dayOf(L || D)), dynasty: !!dyn, dynastyRanks: dyn ? await loadDynasty(l.sport) : null, bestBall: bb, weeks: bb ? weeks : null });
      const byId = Object.fromEntries(players.map((p: any) => [p.id, p]));
      // a one-day league scores its own games: their box scores and states from fk-live ?games=, laid over the weeks file
      let real = weeks;
      if (weeks && L && L.settings && L.settings.daily) { const dd = await loadDays(l.sport, data.season); if (dd) real = Object.assign({}, weeks, { days: dd }); }
      const gids = L && Z.slateGames ? Z.slateGames(L) : null;
      if (weeks && gids && gids.length) {
        const gm = await fetch(`${URL_}/functions/v1/fk-live?sport=${encodeURIComponent(l.sport)}&games=${gids.join(",")}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        real = Object.assign({}, weeks, { games: {} });
        if (gm) Z.mergeGames(real, gm);
      }
      const hooks = { real, prospects: dyn && (l.sport === "nfl" || l.sport === "nba") ? await loadClass(S, l.sport) : null };
      const base = structuredClone({ draft: D, league: L });
      let changed = false;
      if (!L) {
        // a trivia draft's next question, when the clock is the one that puts a pick up
        const trivia = FK.trivia ? (d: any, k: number) => FK.trivia.make(sport, players, ((d.seed || 1) * 31 + k * 7919) >>> 0, d.trivia.used, (d.trivia.mine || {})[d.order[k]]) : undefined;
        const dctx = F.context(D, players, sport, { trivia });
        // a heist's moves are sealed on the server: once it's due, open them so it can settle
        if (D.phase === "heist" && F.heistSealed && F.heistSealed(D) && F.heistDue(D, now)) {
          const h = await rpc("fk_clock_heist", { p_token: token, p_id: l.id });
          if (h && h.open) F.heistUnseal(D, dctx, h.open);
        }
        // a salary cap game's lineups or a sealed draft's lists: open them once they lock
        let sealed = null;
        const sk = Z.sealedKind ? Z.sealedKind(D) : null;
        if (sk && now >= Z.sealedDue(D)) {
          const o = await rpc("fk_clock_seal", { p_token: token, p_id: l.id, p_kind: sk });
          sealed = o && o.open ? o.open : null;
        }
        changed = Z.driveDraft(D, dctx, now, sealed);
        if (D.phase === "done") {
          // a one-week league that starts in the week that's on counts only what's played after now, so it needs this
          // week's totals as of now (the live feed), not as of the last nightly file
          let real = weeks || false;
          if (weeks && D.season && D.season.when === "now") {
            const lv = await fetch(`${URL_}/functions/v1/fk-live?sport=${encodeURIComponent(l.sport)}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
            if (lv) { real = structuredClone(weeks); Z.mergeLive(real, lv); }
          }
          L = Z.begin(D, sport, { name: l.name, season: data.season, now, real });
          changed = true;
        }
      } else {
        // after the weekly lineup check, keep this week's kickoff times current so a starter ruled out later is caught
        let kicked = false;
        if (L.settings && L.settings.real && G.setKicks && L.reminders && L.reminders[L.week] && L.week <= G.totalWeeks(L)) {
          const lv = await liveFeed(l.sport);
          if (lv) { const before = JSON.stringify(L.kick || null); G.setKicks(L, lv); kicked = JSON.stringify(L.kick || null) !== before; }
        }
        changed = Z.catchUp(L, G.context(L, players, sport, hooks), now) || kicked;
      }
      if (!changed) return out;
      const events = Z.events(base, { draft: D, league: L }, { name: l.name, url: `https://davidsolar.dev/fantasy/league/?id=${encodeURIComponent(l.id)}`, seats: l.seats, me: null, byId, now });
      const r = await rpc("fk_clock_save", { p_token: token, p_id: l.id, p_version: l.version, p_draft: base.league ? null : D, p_league: L, p_events: events });
      Object.assign(out, { saved: !!r.ok, error: r.error, emails: events.length });
  } catch (e) { out.error = String((e as Error).message || e); }
  return out;
}

async function tickLeagues(token: string) {
  const FK = await loadEngine();
  const { sports: S, value: V, draft: F, league: G, season: Z } = FK;
  const list = await rpc("fk_clock_list", { p_token: token });
  if (list.error) return { error: list.error };
  const report: any[] = [];
  for (const l of list.leagues as any[]) report.push(await advance(FK, token, l, false));
  return { leagues: report };
}

// ---------- the email itself: plain text, plus an HTML version with a button and, after a draft, the roster ----------
const BAND: Record<string, string> = { nfl: "#1E6631", nba: "#B4511F", mlb: "#21498F" };
const POS_C = [["#E2E6EB", "#3A4452"], ["#DCEBFF", "#0D3F82"], ["#E2F5D6", "#2B5C0E"], ["#FFE6CC", "#7A3A00"], ["#F0E0FF", "#53198A"], ["#FFDCE0", "#8A1424"], ["#E2E6EB", "#3A4452"], ["#D4F2EE", "#0E5A52"], ["#FFF1BC", "#6A5200"]];
const h = (x: unknown) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
function rosterText(r: any) {
  return `\n\n${r.team}'s roster:\n` + r.rows.map((x: any) => `${String(x.pos).padEnd(6)}${x.n}${x.t ? `, ${x.t}` : ""} (${x.how})`).join("\n");
}
function rosterHtml(r: any, sport: string, FK: any) {
  const sp = FK && FK.sports && FK.sports[sport], colors = (sp && sp.colors) || {};
  const logo = (t: string) => { try { const u = FK.sports.teamLogo && FK.sports.teamLogo(sport, t, 40); return u ? `<img src="${h(u)}" width="16" height="16" alt="" style="vertical-align:-3px;margin-right:5px;border:0">` : ""; } catch (_) { return ""; } };
  let last = "";
  const rows = r.rows.map((x: any) => {
    const [bg, fg] = POS_C[colors[x.main] || 0] || POS_C[0];
    const gap = last && x.main !== last ? "border-top:2px solid #E1E5EB;" : "border-top:1px solid #EEF1F4;"; last = x.main;
    return `<tr><td style="${gap}padding:9px 0 9px 16px;width:48px;vertical-align:middle"><span style="display:inline-block;min-width:30px;text-align:center;padding:3px 6px;border-radius:5px;background:${bg};color:${fg};font:800 11px ${FONT}">${h(x.main || x.pos)}</span></td>
      <td style="${gap}padding:9px 8px;vertical-align:middle;font:700 15px ${FONT};color:#0E1621">${h(x.n)}<div style="font:400 12.5px ${FONT};color:#677284;margin-top:2px">${x.t ? `${logo(x.t)}${h(x.t)}` : ""}${String(x.pos).includes("/") ? `${x.t ? ", " : ""}${h(x.pos)}` : ""}${!x.t && !String(x.pos).includes("/") ? "&nbsp;" : ""}</div></td>
      <td style="${gap}padding:9px 16px 9px 8px;vertical-align:middle;text-align:right;font:600 12.5px ${FONT};color:#566273;white-space:nowrap">${h(x.how)}</td></tr>`;
  }).join("");
  const sub = `${r.rows.length} players${r.auction && r.spent != null ? `, $${r.spent} spent` : ""}`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E1E5EB;border-radius:12px;border-collapse:separate;overflow:hidden;margin:6px 0 22px">
    <tr><td colspan="3" style="padding:14px 16px 10px;background:#F6F7F9;border-bottom:1px solid #E1E5EB"><div style="font:800 17px ${FONT};color:#0E1621">${h(r.team)}</div><div style="font:400 13px ${FONT};color:#566273;margin-top:2px">${h(sub)}</div></td></tr>${rows}</table>`;
}
// why this email came: an invite the commissioner sent, or the manager's own alerts
const footText = (e: any) => e.kind === "invite"
  ? `You're getting this because the commissioner of ${e.league_name} invited you to the league on Draft Lab. If it isn't for you, ignore it.`
  : `You get these because email alerts are on for your team in ${e.league_name}. To turn them off, open the league and choose League, then uncheck email alerts.`;
function emailHtml(e: any, FK: any) {
  const lines = String(e.body || "").split("\n\n");
  const link = lines.length && /^Open the league: (\S+)$/.exec(lines[lines.length - 1]);
  const url = link ? link[1] : (e.data && e.data.url) || SITE;
  const paras = (link ? lines.slice(0, -1) : lines).map((p) => `<p style="margin:0 0 14px;font:400 16px/1.5 ${FONT};color:#26303D">${h(p).replace(/\n/g, "<br>")}</p>`).join("");
  const roster = e.data && e.data.roster && Array.isArray(e.data.roster.rows) ? rosterHtml(e.data.roster, e.sport, FK) : "";
  const band = BAND[e.sport] || "#13233A";
  const title = String(e.subject || "").replace(/^[^:]*:\s*/, "");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${h(e.subject)}</title></head>
<body style="margin:0;padding:0;background:#F1F3F6">
<div style="display:none;max-height:0;overflow:hidden">${h(lines[0] || "").slice(0, 140)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F3F6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E1E5EB">
  <tr><td style="background:${band};padding:20px 24px">
    <div style="font:700 12.5px ${FONT};color:rgba(255,255,255,.78)">${h(e.league_name)}</div>
    <div style="font:900 24px/1.2 ${FONT};color:#FFFFFF;margin-top:4px">${h(title.charAt(0).toUpperCase() + title.slice(1))}</div></td></tr>
  <tr><td style="padding:22px 24px 8px">
    <p style="margin:0 0 14px;font:400 16px/1.5 ${FONT};color:#26303D">Hi ${h(e.manager || "there")},</p>
    ${paras}${roster}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 22px"><tr><td style="background:#F6C445;border-radius:9px"><a href="${h(url)}" style="display:inline-block;padding:12px 22px;font:800 15px ${FONT};color:#1F1600;text-decoration:none">${e.kind === "invite" ? "Join the league" : "Open the league"}</a></td></tr></table>
  </td></tr>
  <tr><td style="padding:14px 24px 18px;border-top:1px solid #EEF1F4;font:400 12.5px/1.5 ${FONT};color:#677284">${h(footText(e))}<br><br>Draft Lab, <a href="https://davidsolar.dev/fantasy/" style="color:#677284">davidsolar.dev</a></td></tr>
</table></td></tr></table></body></html>`;
}

// A phone alert for one outbox row: the league as the title, the subject as the line under it, the league as the link
let vapidAt = 0, vapidOk = false;
async function vapid(token: string) {
  if (Date.now() - vapidAt < 30 * 60e3) return vapidOk;
  vapidAt = Date.now();
  const v = await rpc("fk_clock_vapid", { p_token: token }).catch(() => null);
  vapidOk = !!(v && v.vapid_public && v.vapid_private);
  if (vapidOk) webpush.setVapidDetails(v.vapid_subject || "mailto:leagues@davidsolar.dev", v.vapid_public, v.vapid_private);
  return vapidOk;
}
async function pushOne(token: string, e: any) {
  const subs = Array.isArray(e.push) ? e.push : [];
  if (!subs.length || !(await vapid(token))) return 0;
  const line = String(e.subject || "").replace(/^[^:]*:\s*/, "");
  const first = String(e.body || "").split("\n\n")[0].slice(0, 160);
  const link = /^Open the league: (\S+)$/m.exec(String(e.body || ""));
  const msg = { title: e.league_name || "Draft Lab", body: line ? `${line.charAt(0).toUpperCase() + line.slice(1)}. ${first}`.slice(0, 220) : first,
    url: (link && link[1]) || (e.data && e.data.url) || `https://davidsolar.dev/fantasy/league/?id=${encodeURIComponent(e.league)}`, tag: `${e.league}:${e.kind || "alert"}` };
  let sent = 0;
  for (const sub of subs) {
    try { await webpush.sendNotification(sub, JSON.stringify(msg), { TTL: 6 * 3600 }); sent++; }
    catch (err: any) { if (err && (err.statusCode === 404 || err.statusCode === 410)) await rpc("fk_clock_push_gone", { p_token: token, p_endpoint: sub.endpoint }).catch(() => null); }
  }
  return sent;
}

async function sendMail(token: string) {
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("FK_MAIL_FROM");
  if (!key || !from) return { mail: "not set up" };
  const { emails, error } = await rpc("fk_outbox_take", { p_token: token, p_limit: 40 });
  if (error) return { error };
  const FK = (emails as any[]).length ? await loadEngine().catch(() => null) : null;
  const ids: number[] = [], errors: Record<string, string> = {};
  let pushed = 0;
  for (const e of emails as any[]) {
    ids.push(e.id);
    pushed += await pushOne(token, e).catch(() => 0);
    if (!e.email) { errors[e.id] = "no email address"; continue; }
    const roster = e.data && e.data.roster && Array.isArray(e.data.roster.rows) ? rosterText(e.data.roster) : "";
    const body = roster ? String(e.body).replace(/\n\nOpen the league: /, `${roster}\n\nOpen the league: `) : e.body;
    const text = `Hi ${e.manager || "there"},\n\n${body}\n\n${footText(e)}\n\nDraft Lab, davidsolar.dev`;
    let html: string | undefined;
    try { html = emailHtml(e, FK); } catch (_) { html = undefined; } // the plain text still goes out
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [e.email], subject: e.subject, text, ...(html ? { html } : {}) }),
    });
    if (!r.ok) errors[e.id] = `${r.status} ${(await r.text()).slice(0, 200)}`;
    await new Promise((ok) => setTimeout(ok, 550)); // Resend allows two a second
  }
  if (ids.length) await rpc("fk_outbox_done", { p_token: token, p_ids: ids, p_errors: errors });
  return { sent: ids.length - Object.keys(errors).length, failed: Object.keys(errors).length, pushed };
}

// Pool pick reminders: members who turned them on get one email when a pick is still missing, about three hours
// before it's due. What's due comes from the pools pages' own rules (fantasy-kit/pools-core.js status), run on each
// member's board as mm_board gives it to them; mm_remind_claim makes sure each deadline is emailed once.
const REMIND_MS = 3 * 3600e3;
let poolRules: { at: number; P: any } | null = null;
async function loadPoolRules() {
  if (poolRules && Date.now() - poolRules.at < 10 * 60e3) return poolRules.P;
  const src = await fetch(`${SITE}pools-core.js?t=${Math.floor(Date.now() / 600e3)}`).then((r) => { if (!r.ok) throw new Error(`pools-core.js: ${r.status}`); return r.text(); });
  const g: any = { FK: {} };
  new Function("module", "require", src).call(g, undefined, undefined);
  poolRules = { at: Date.now(), P: g.FK.pools };
  return g.FK.pools;
}
const POOL_KIND: Record<string, string> = { nfl: "NFL survivor", survivor: "March Madness survivor", five: "5 teams", bowls: "bowl pick'em", nflpo: "NFL playoff bracket", nflff: "NFL playoff fantasy", bracket: "March Madness bracket", props: "Super Bowl prop sheet", oscars: "Oscars ballot", mmff: "March Madness fantasy" };
const POOL_WHAT: Record<string, string> = { nfl: "this week's survivor pick", survivor: "today's survivor pick", five: "your five teams", bowls: "some bowl picks", nflpo: "your playoff bracket", nflff: "this round's lineup", bracket: "your bracket", props: "your prop sheet", oscars: "your Oscars ballot", mmff: "this round's lineup" };
// each game's own page (fantasy-kit/pools.js SLUG), so a reminder opens the pool where it's played
const POOL_SLUG: Record<string, string> = { bowls: "bowls", nflpo: "nfl-bracket", nflff: "nfl-playoff-fantasy", squares: "squares", props: "props", oscars: "oscars", bracket: "march-madness", survivor: "march-madness-survivor", five: "five-teams", nfl: "nfl-survivor", mmff: "march-madness-fantasy" };
const poolLink = (pool: string, kind: string) => `https://davidsolar.dev/pools/${POOL_SLUG[kind] ? POOL_SLUG[kind] + "/" : ""}?p=${encodeURIComponent(pool)}`;
const etTime = (t: number) => new Date(t).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).replace(":00 ", " ") + " ET";
async function poolReminders(token: string) {
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("FK_MAIL_FROM");
  if (!key || !from) return { reminders: "mail not set up" };
  const r = await rpc("mm_remind_boards", { p_token: token });
  if (!r || r.error) return { error: r && r.error };
  if (!r.boards.length) return { due: 0 };
  const P = await loadPoolRules(), now = Date.now(), due: any[] = [];
  for (const x of r.boards) {
    try {
      const s = P.status(x.board, now, null);
      if (s.tone === "todo" && s.due && s.due > now + 10 * 60e3 && s.due - now <= REMIND_MS) due.push({ ...x, status: s, due: s.due });
    } catch (_) { /* a board the rules can't read gets no reminder */ }
  }
  if (!due.length) return { due: 0 };
  const c = await rpc("mm_remind_claim", { p_token: token, p_rows: due.map((x) => ({ pool: x.pool, user: x.user, due: x.due })) });
  const claimed = new Set(((c && c.claimed) || []).map((k: any) => `${k.pool}|${k.user}|${k.due}`));
  let sent = 0, failed = 0;
  for (const x of due) {
    if (!claimed.has(`${x.pool}|${x.user}|${Math.round(x.due)}`)) continue;
    const url = poolLink(x.pool, x.kind), when = etTime(x.due);
    const subject = `${x.pool_name}: ${POOL_WHAT[x.kind] || "a pick"} is due ${when}`;
    const lead = `You haven't made ${POOL_WHAT[x.kind] || "your pick"} in ${x.pool_name} yet. It's due ${when}.`;
    const where = x.status.text ? `Where you stand: ${x.status.text}.` : "";
    const foot = "You get this because you turned on pick reminders for this pool. Turn them off on the pool page.";
    const text = `Hi ${x.name || "there"},\n\n${lead}${where ? `\n\n${where}` : ""}\n\nMake your pick: ${url}\n\n${foot}\n\nDraft Lab, davidsolar.dev`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${h(subject)}</title></head>
<body style="margin:0;padding:0;background:#F1F3F6"><div style="display:none;max-height:0;overflow:hidden">${h(lead)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F3F6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E1E5EB">
  <tr><td style="background:#13233A;padding:20px 24px"><div style="font:700 12.5px ${FONT};color:rgba(255,255,255,.78)">${h(x.pool_name)} &middot; ${h(POOL_KIND[x.kind] || "Pool")}</div>
    <div style="font:800 22px/1.25 ${FONT};color:#FFFFFF;margin-top:4px">Your pick is due ${h(when)}</div></td></tr>
  <tr><td style="padding:22px 24px 8px">
    <p style="margin:0 0 14px;font:400 16px/1.5 ${FONT};color:#26303D">Hi ${h(x.name || "there")},</p>
    <p style="margin:0 0 14px;font:400 16px/1.5 ${FONT};color:#26303D">${h(lead)}</p>
    ${where ? `<p style="margin:0 0 14px;font:400 16px/1.5 ${FONT};color:#26303D">${h(where)}</p>` : ""}
    <p style="margin:18px 0 22px"><a href="${h(url)}" style="display:inline-block;background:#F6C445;color:#13233A;font:800 16px ${FONT};text-decoration:none;padding:12px 20px;border-radius:10px">Make your pick</a></p></td></tr>
  <tr><td style="padding:14px 24px 20px;border-top:1px solid #E1E5EB;font:400 13px/1.5 ${FONT};color:#6B7684">${h(foot)}<br>Draft Lab, davidsolar.dev</td></tr>
</table></td></tr></table></body></html>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [x.email], subject, text, html }),
    }).catch(() => null);
    if (res && res.ok) sent++; else failed++;
    await new Promise((ok) => setTimeout(ok, 550)); // Resend allows two a second
  }
  return { due: due.length, sent, failed };
}

// NFL pick'em reminders (/pickem): a player who turned them on gets an email about three hours before a game he hasn't
// picked kicks off, at most two a week. pk_remind_due picks who's due and claims each slate, so it's sent once.
async function pickemReminders(token: string) {
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("FK_MAIL_FROM");
  if (!key || !from) return { pickem: "mail not set up" };
  const r = await rpc("pk_remind_due", { p_token: token });
  if (!r || r.error) return { error: r && r.error };
  const due = r.due || [];
  let sent = 0, failed = 0;
  for (const x of due) {
    const url = "https://davidsolar.dev/pickem/", when = etTime(x.slot), wk = x.stype === 3 ? "this playoff round" : `week ${x.week}`;
    const line = (g: any) => { const sp = Number(g.spread); return `${g.away} at ${g.home}, ${sp === 0 ? "pick'em" : sp < 0 ? `${g.home} ${sp}` : `${g.away} -${sp}`}`; };
    const games: string[] = (x.games || []).map(line);
    const subject = `The Number: ${games.length === 1 ? "a pick" : `${games.length} picks`} lock ${when}`;
    const lead = `You haven't picked ${games.length === 1 ? "this game" : "these games"} yet, and ${games.length === 1 ? "it locks" : "they lock"} at kickoff, ${when}:`;
    const more = x.rest ? `You have ${x.rest} more ${x.rest === 1 ? "game" : "games"} to pick later in ${wk}.` : "";
    const foot = "You get this because you turned on pick reminders for The Number. Turn them off on the Picks tab.";
    const text = `Hi ${x.name || "there"},\n\n${lead}\n${games.join("\n")}${more ? `\n\n${more}` : ""}\n\nMake your picks: ${url}\n\n${foot}\n\nDraft Lab, davidsolar.dev`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${h(subject)}</title></head>
<body style="margin:0;padding:0;background:#F1F3F6"><div style="display:none;max-height:0;overflow:hidden">${h(games.join(", "))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F3F6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E1E5EB">
  <tr><td style="background:#13233A;padding:20px 24px"><div style="font:700 12.5px ${FONT};color:rgba(255,255,255,.78)">The Number, ${h(wk)}</div>
    <div style="font:800 22px/1.25 ${FONT};color:#FFFFFF;margin-top:4px">${games.length === 1 ? "A pick locks" : `${games.length} picks lock`} ${h(when)}</div></td></tr>
  <tr><td style="padding:22px 24px 8px">
    <p style="margin:0 0 14px;font:400 16px/1.5 ${FONT};color:#26303D">Hi ${h(x.name || "there")},</p>
    <p style="margin:0 0 10px;font:400 16px/1.5 ${FONT};color:#26303D">${h(lead)}</p>
    <p style="margin:0 0 14px;font:600 15px/1.6 ${FONT};color:#13233A">${games.map((g: string) => h(g)).join("<br>")}</p>
    ${more ? `<p style="margin:0 0 14px;font:400 16px/1.5 ${FONT};color:#26303D">${h(more)}</p>` : ""}
    <p style="margin:18px 0 22px"><a href="${url}" style="display:inline-block;background:#F6C445;color:#13233A;font:800 16px ${FONT};text-decoration:none;padding:12px 20px;border-radius:10px">Make your picks</a></p></td></tr>
  <tr><td style="padding:14px 24px 20px;border-top:1px solid #E1E5EB;font:400 13px/1.5 ${FONT};color:#6B7684">${h(foot)}<br>Draft Lab, davidsolar.dev</td></tr>
</table></td></tr></table></body></html>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [x.email], subject, text, html }),
    }).catch(() => null);
    if (res && res.ok) sent++; else failed++;
    await new Promise((ok) => setTimeout(ok, 550)); // Resend allows two a second
  }
  return { due: due.length, sent, failed };
}

// Weekly recaps: Tuesday morning (9 to 11 a.m. Eastern), each member who turned them on gets a note on every pool with a
// game that finished in the last week: who went out, the top of the standings, where they stand, and what's due.
async function poolRecaps(token: string) {
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("FK_MAIL_FROM");
  if (!key || !from) return { recaps: "mail not set up" };
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  if (et.getDay() !== 2 || et.getHours() < 9 || et.getHours() >= 11) return { recaps: "not Tuesday morning" };
  const wk = `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
  const r = await rpc("mm_recap_boards", { p_token: token });
  if (!r || r.error || !Array.isArray(r.boards)) return { error: r && (r.error || r.message) };
  const P = await loadPoolRules(), now = Date.now(), due: any[] = [];
  for (const x of r.boards) { try { const c = P.recap(x.board, now, null); if (c && c.lines.length) due.push({ ...x, recap: c }); } catch (_) { /* skip it */ } }
  if (!due.length) return { recaps: 0 };
  const c = await rpc("mm_recap_claim", { p_token: token, p_rows: due.map((x) => ({ pool: x.pool, user: x.user, wk })) });
  const claimed = new Set(((c && c.claimed) || []).map((k: any) => `${k.pool}|${k.user}`));
  let sent = 0, failed = 0;
  for (const x of due) {
    if (!claimed.has(`${x.pool}|${x.user}`)) continue;
    const url = poolLink(x.pool, x.kind);
    const next = x.recap.due ? `Your next pick is due ${etTime(x.recap.due)}.` : "";
    const subject = `${x.pool_name}: your week in review`;
    const foot = "You get this because you turned on the weekly recap for this pool. Turn it off on the pool's Settings tab.";
    const text = `Hi ${x.name || "there"},\n\n${x.recap.lines.join("\n\n")}${next ? `\n\n${next}` : ""}\n\nOpen the pool: ${url}\n\n${foot}\n\nDraft Lab, davidsolar.dev`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${h(subject)}</title></head>
<body style="margin:0;padding:0;background:#F1F3F6"><div style="display:none;max-height:0;overflow:hidden">${h(x.recap.lines[0] || "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F3F6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E1E5EB">
  <tr><td style="background:#13233A;padding:20px 24px"><div style="font:700 12.5px ${FONT};color:rgba(255,255,255,.78)">${h(x.pool_name)} &middot; ${h(POOL_KIND[x.kind] || "Pool")}</div>
    <div style="font:800 22px/1.25 ${FONT};color:#FFFFFF;margin-top:4px">Your week in review</div></td></tr>
  <tr><td style="padding:22px 24px 8px">
    <p style="margin:0 0 14px;font:400 16px/1.5 ${FONT};color:#26303D">Hi ${h(x.name || "there")},</p>
    ${x.recap.lines.map((l: string) => `<p style="margin:0 0 14px;font:400 16px/1.5 ${FONT};color:#26303D">${h(l)}</p>`).join("")}
    ${next ? `<p style="margin:0 0 14px;font:700 16px/1.5 ${FONT};color:#26303D">${h(next)}</p>` : ""}
    <p style="margin:18px 0 22px"><a href="${h(url)}" style="display:inline-block;background:#F6C445;color:#13233A;font:800 16px ${FONT};text-decoration:none;padding:12px 20px;border-radius:10px">Open the pool</a></p></td></tr>
  <tr><td style="padding:14px 24px 20px;border-top:1px solid #E1E5EB;font:400 13px/1.5 ${FONT};color:#6B7684">${h(foot)}<br>Draft Lab, davidsolar.dev</td></tr>
</table></td></tr></table></body></html>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [x.email], subject, text, html }),
    }).catch(() => null);
    if (res && res.ok) sent++; else failed++;
    await new Promise((ok) => setTimeout(ok, 550));
  }
  return { recaps: due.length, sent, failed };
}

// Bots on time. Every save to a live draft (fk_wake_clock, a database trigger) calls ?league=<id>: if the next pick
// is a bot's, or a manager's clock running out, within the next nine seconds, wait for it, read the draft again and
// make it. That save wakes the next call, so a run of bot picks keeps going with nobody's page open. A page that
// saved first wins (the save carries its version) and this call just stops.
async function wakeOne(token: string, id: string) {
  const FK = await loadEngine();
  const F = FK.draft;
  const get = async () => { const r = await rpc("fk_clock_one", { p_token: token, p_id: id }); return r && r.leagues && r.leagues[0]; };
  let l = await get();
  if (!l || l.league || !l.draft || l.draft.phase !== "live" || l.draft.paused) return { id, skip: "not drafting" };
  const D = l.draft, now = Date.now();
  let due = now;
  if (D.type !== "auction" && !D.packs) {
    const c = F.onClock(D, now);
    if (!c) return { id, skip: "no pick" };
    due = F.isBot(D.teams[c.team]) ? D.clockStart + (D.botDelay || 0) : c.deadline;
  }
  if (!Number.isFinite(due) || due - now > 9000) return { id, skip: "not due yet" };
  await new Promise((ok) => setTimeout(ok, Math.max(0, due - Date.now()) + 300));
  l = await get();
  if (!l) return { id, skip: "gone" };
  return advance(FK, token, l, true);
}

Deno.serve(async (req) => {
  const token = req.headers.get("x-fk-token") || "";
  if (!token) return new Response("Not the clock", { status: 401 });
  const q = new URL(req.url).searchParams, one = q.get("league");
  // a new alert in the outbox: send it now
  if (q.get("mail")) {
    const mail = await sendMail(token).catch((e) => ({ error: String(e.message || e) }));
    return new Response(JSON.stringify({ mail }), { headers: { "Content-Type": "application/json" } });
  }
  if (one) {
    const r = await wakeOne(token, one).catch((e) => ({ id: one, error: String(e.message || e) }));
    return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json" } });
  }
  const leagues = await tickLeagues(token).catch((e) => ({ error: String(e.message || e) }));
  if ((leagues as any).error === "no") return new Response("Not the clock", { status: 401 });
  const mail = await sendMail(token).catch((e) => ({ error: String(e.message || e) }));
  const reminders = await poolReminders(token).catch((e) => ({ error: String(e.message || e) }));
  const recaps = await poolRecaps(token).catch((e) => ({ error: String(e.message || e) }));
  const pickem = await pickemReminders(token).catch((e) => ({ error: String(e.message || e) }));
  return new Response(JSON.stringify({ ...leagues, mail, reminders, recaps, pickem, engine: engine ? engine.sha || "site" : null }), { headers: { "Content-Type": "application/json" } });
});
