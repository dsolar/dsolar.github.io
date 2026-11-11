// The Fantasy Kit's server clock. pg_cron calls this every five minutes (tools/fantasykit_supabase.sql) so shared
// leagues keep moving with nobody's page open. For each draft that's live it makes the overdue picks (bots and
// expired clocks); for each league in season it plays out ended weeks, runs waivers, bots and trade reviews, all with
// the same code the pages run (fantasy-kit/*.js, fetched from the live site). Saves go through fk_clock_save with the
// version it started from, so a manager's save in the same moment wins and the clock tries again next run.
//
// Then it sends the email outbox with Resend, once the secrets RESEND_API_KEY and FK_MAIL_FROM are set
// (FK_MAIL_FROM like "Draft Lab <leagues@davidsolar.dev>", on a domain verified in Resend). Until then emails wait.
const SITE = "https://davidsolar.dev/fantasy-kit/";
const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

async function rpc(fn: string, body: unknown) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// The engine changes at most a few times a day; keep it, and each sport's player data, for ten minutes.
let engine: { at: number; FK: any } | null = null;
const pools: Record<string, { at: number; data: any }> = {};
async function loadEngine() {
  if (engine && Date.now() - engine.at < 10 * 60e3) return engine.FK;
  const bust = `?t=${Math.floor(Date.now() / 600e3)}`;
  const g: any = { FK: {} };
  for (const f of ["sports", "value", "draft", "trivia", "league", "season"]) {
    try {
      const r = await fetch(`${SITE}${f}.js${bust}`);
      if (!r.ok) throw new Error(`${f}.js: ${r.status}`);
      const src = await r.text();
      // the files are UMD: with no module or require around, each one adds itself to root.FK
      new Function("module", "require", src).call(g, undefined, undefined);
    } catch (e) { if (f !== "trivia") throw e; }   // trivia questions are optional: the rest runs without them
  }
  engine = { at: Date.now(), FK: g.FK };
  return g.FK;
}
async function loadData(sport: string) {
  const c = pools[sport];
  if (c && Date.now() - c.at < 10 * 60e3) return c.data;
  const data = await fetch(`${SITE}data/${sport}.json?t=${Math.floor(Date.now() / 600e3)}`).then((r) => r.json());
  pools[sport] = { at: Date.now(), data };
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
      const data = await loadData(l.sport);
      const doc = L ? L.draft || D : D;
      const sport = S.withScoring(S.attach(Object.assign({}, S[l.sport]), data), doc.scoringSpec);
      // a showdown plays one game: its two teams are the whole player pool
      const players = data.players.filter((p: any) => !S.inPool || S.inPool(L || D, p)).map((p: any) => Object.assign({}, p));
      const dyn = (L && L.settings && L.settings.dynasty) || (doc.season && doc.season.dynasty);
      const weeks = await loadWeeks(l.sport, data.season);
      // best ball values upside and depth; a guillotine keeps normal ranks
      const bb = L ? !!L.settings.bestBall && L.settings.format !== "guillotine" : !!(doc.season && doc.season.bestBall && doc.season.format !== "guillotine");
      V.evaluate(sport, players, { teams: doc.teams.length, lineup: doc.lineup, bench: doc.bench, scoring: doc.scoring, budget: doc.auction ? doc.auction.budget : 200, week: S.weekFor ? S.weekFor(L || D, sport) : null, oneDay: !!(S.dayOf && S.dayOf(L || D)), dynasty: !!dyn, dynastyRanks: dyn ? await loadDynasty(l.sport) : null, bestBall: bb, weeks: bb ? weeks : null });
      const byId = Object.fromEntries(players.map((p: any) => [p.id, p]));
      // a one-day league scores its own games: their box scores and states from fk-live ?games=, laid over the weeks file
      let real = weeks;
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
        const trivia = FK.trivia ? (d: any, k: number) => FK.trivia.make(sport, players, ((d.seed || 1) * 31 + k * 7919) >>> 0, d.trivia.used) : undefined;
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
      } else changed = Z.catchUp(L, G.context(L, players, sport, hooks), now);
      if (!changed) return out;
      const events = Z.events(base, { draft: D, league: L }, { name: l.name, url: `${SITE}play.html?id=${encodeURIComponent(l.id)}`, seats: l.seats, me: null, byId, now });
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
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 22px"><tr><td style="background:#F6C445;border-radius:9px"><a href="${h(url)}" style="display:inline-block;padding:12px 22px;font:800 15px ${FONT};color:#1F1600;text-decoration:none">Open the league</a></td></tr></table>
  </td></tr>
  <tr><td style="padding:14px 24px 18px;border-top:1px solid #EEF1F4;font:400 12.5px/1.5 ${FONT};color:#677284">You get these because email alerts are on for your team in ${h(e.league_name)}. To turn them off, open the league, choose League, then uncheck email alerts.<br><br>Draft Lab, <a href="https://davidsolar.dev/fantasy-kit/" style="color:#677284">davidsolar.dev</a></td></tr>
</table></td></tr></table></body></html>`;
}

async function sendMail(token: string) {
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("FK_MAIL_FROM");
  if (!key || !from) return { mail: "not set up" };
  const { emails, error } = await rpc("fk_outbox_take", { p_token: token, p_limit: 40 });
  if (error) return { error };
  const FK = (emails as any[]).length ? await loadEngine().catch(() => null) : null;
  const ids: number[] = [], errors: Record<string, string> = {};
  for (const e of emails as any[]) {
    ids.push(e.id);
    if (!e.email) { errors[e.id] = "no email address"; continue; }
    const roster = e.data && e.data.roster && Array.isArray(e.data.roster.rows) ? rosterText(e.data.roster) : "";
    const body = roster ? String(e.body).replace(/\n\nOpen the league: /, `${roster}\n\nOpen the league: `) : e.body;
    const text = `Hi ${e.manager || "there"},\n\n${body}\n\nYou get these because email alerts are on for your team in ${e.league_name}. To turn them off, open the league and choose League, then uncheck email alerts.\n\nDraft Lab, davidsolar.dev`;
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
  return { sent: ids.length - Object.keys(errors).length, failed: Object.keys(errors).length };
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
  const one = new URL(req.url).searchParams.get("league");
  if (one) {
    const r = await wakeOne(token, one).catch((e) => ({ id: one, error: String(e.message || e) }));
    return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json" } });
  }
  const leagues = await tickLeagues(token).catch((e) => ({ error: String(e.message || e) }));
  if ((leagues as any).error === "no") return new Response("Not the clock", { status: 401 });
  const mail = await sendMail(token).catch((e) => ({ error: String(e.message || e) }));
  return new Response(JSON.stringify({ ...leagues, mail }), { headers: { "Content-Type": "application/json" } });
});
