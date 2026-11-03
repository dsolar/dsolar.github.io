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
  for (const f of ["sports", "value", "draft", "league", "season"]) {
    const src = await fetch(`${SITE}${f}.js${bust}`).then((r) => r.text());
    // the files are UMD: with no module or require around, each one adds itself to root.FK
    new Function("module", "require", src).call(g, undefined, undefined);
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

async function tickLeagues(token: string) {
  const FK = await loadEngine();
  const { sports: S, value: V, draft: F, league: G, season: Z } = FK;
  const list = await rpc("fk_clock_list", { p_token: token });
  if (list.error) return { error: list.error };
  const report: any[] = [];
  for (const l of list.leagues as any[]) {
    const out: any = { id: l.id };
    try {
      const now = Date.now();
      let D = l.draft, L = l.league;
      // a live draft someone saved in the last minute has a page driving it
      if (!L && now - l.updated < 60e3) { out.skip = "busy"; report.push(out); continue; }
      const data = await loadData(l.sport);
      const doc = L ? L.draft || D : D;
      const sport = S.withScoring(S.attach(Object.assign({}, S[l.sport]), data), doc.scoringSpec);
      const players = data.players.map((p: any) => Object.assign({}, p));
      const dyn = (L && L.settings && L.settings.dynasty) || (doc.season && doc.season.dynasty);
      V.evaluate(sport, players, { teams: doc.teams.length, lineup: doc.lineup, bench: doc.bench, scoring: doc.scoring, budget: doc.auction ? doc.auction.budget : 200, dynasty: !!dyn, dynastyRanks: dyn ? await loadDynasty(l.sport) : null });
      const byId = Object.fromEntries(players.map((p: any) => [p.id, p]));
      const weeks = await loadWeeks(l.sport, data.season);
      const hooks = { real: weeks, prospects: dyn && (l.sport === "nfl" || l.sport === "nba") ? await loadClass(S, l.sport) : null };
      const base = structuredClone({ draft: D, league: L });
      let changed = false;
      if (!L) {
        changed = Z.driveDraft(D, F.context(D, players, sport), now);
        if (D.phase === "done") { L = Z.begin(D, sport, { name: l.name, season: data.season, now, real: weeks || false }); changed = true; }
      } else changed = Z.catchUp(L, G.context(L, players, sport, hooks), now);
      if (!changed) { report.push(out); continue; }
      const events = Z.events(base, { draft: D, league: L }, { name: l.name, url: `${SITE}play.html?id=${encodeURIComponent(l.id)}`, seats: l.seats, me: null, byId, now });
      const r = await rpc("fk_clock_save", { p_token: token, p_id: l.id, p_version: l.version, p_draft: base.league ? null : D, p_league: L, p_events: events });
      Object.assign(out, { saved: !!r.ok, error: r.error, emails: events.length });
    } catch (e) { out.error = String((e as Error).message || e); }
    report.push(out);
  }
  return { leagues: report };
}

async function sendMail(token: string) {
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("FK_MAIL_FROM");
  if (!key || !from) return { mail: "not set up" };
  const { emails, error } = await rpc("fk_outbox_take", { p_token: token, p_limit: 40 });
  if (error) return { error };
  const ids: number[] = [], errors: Record<string, string> = {};
  for (const e of emails as any[]) {
    ids.push(e.id);
    if (!e.email) { errors[e.id] = "no email address"; continue; }
    const text = `Hi ${e.manager || "there"},\n\n${e.body}\n\nYou get these because email alerts are on for your team in ${e.league_name}. To turn them off, open the league and choose League, then uncheck email alerts.\n\nDraft Lab, davidsolar.dev`;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [e.email], subject: e.subject, text }),
    });
    if (!r.ok) errors[e.id] = `${r.status} ${(await r.text()).slice(0, 200)}`;
    await new Promise((ok) => setTimeout(ok, 550)); // Resend allows two a second
  }
  if (ids.length) await rpc("fk_outbox_done", { p_token: token, p_ids: ids, p_errors: errors });
  return { sent: ids.length - Object.keys(errors).length, failed: Object.keys(errors).length };
}

Deno.serve(async (req) => {
  const token = req.headers.get("x-fk-token") || "";
  if (!token) return new Response("Not the clock", { status: 401 });
  const leagues = await tickLeagues(token).catch((e) => ({ error: String(e.message || e) }));
  if ((leagues as any).error === "no") return new Response("Not the clock", { status: 401 });
  const mail = await sendMail(token).catch((e) => ({ error: String(e.message || e) }));
  return new Response(JSON.stringify({ ...leagues, mail }), { headers: { "Content-Type": "application/json" } });
});
