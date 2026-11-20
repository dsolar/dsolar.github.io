// Draft Lab league import: reads a public ESPN league's settings for the Start a league page, which can't ask ESPN
// itself (ESPN doesn't answer other sites' pages). GET /functions/v1/fk-import?src=espn&sport=nfl|nba|mlb|nhl&id=<league>
// [&season=YYYY] returns { settings, teams } (ESPN's mSettings view, teams counted, names only). Sleeper and Yahoo don't
// come through here: Sleeper's API answers the page directly and Yahoo is pasted text.
// Private ESPN leagues: ESPN only shows them to signed-in members, so a league someone has linked with the site's ESPN
// connector (the trade analyzer's extension, table espn_sync_leagues) is read from its last sync instead, settings only
// (no teams, rosters or owners) and marked { via: "connector", synced }, but only for the connector's owner signed in to
// Draft Lab (his session sent as Authorization: Bearer). Anyone else gets { error: "private" }.
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, OPTIONS" };
const GAME: Record<string, string> = { nfl: "ffl", nba: "fba", mlb: "flb", nhl: "fhl" };
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const URL_ = Deno.env.get("SUPABASE_URL") || "", SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json", "cache-control": "private, max-age=60" } });

function seasonFor(sport: string): number {
  const d = new Date(), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  if (sport === "nba" || sport === "nhl") return m >= 9 ? y + 1 : y;
  if (sport === "nfl") return m <= 2 ? y - 1 : y;
  return m <= 1 ? y - 1 : y;
}

async function espn(sport: string, id: string, season: number) {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/${GAME[sport]}/seasons/${season}/segments/0/leagues/${id}?view=mSettings&view=mTeam`;
  const r = await fetch(url, { headers: { "user-agent": BROWSER_UA, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (r.status === 401 || r.status === 403) return { error: "private" };
  if (r.status === 404) return { error: "not_found" };
  if (!r.ok) return { error: "espn", status: r.status };
  const j = await r.json().catch(() => null);
  if (!j || !j.settings) return { error: "private" };
  return { settings: j.settings, season, teams: (j.teams || []).map((t: any) => ({ name: t.name || [t.location, t.nickname].filter(Boolean).join(" ") })) };
}

// who may read connected leagues: the ESPN connector is the site owner's, so his Draft Lab account
const CONNECTOR_OWNERS = new Set(["3f2c48cc-5ca1-4b47-8965-ebb74d957ed5"]);
async function isOwner(req: Request) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
  if (!tok || !URL_ || !SERVICE || tok.split(".").length !== 3) return false;
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: `Bearer ${tok}` } }).catch(() => null);
  if (!r || !r.ok) return false;
  const u = await r.json().catch(() => null);
  return !!(u && CONNECTOR_OWNERS.has(u.id));
}

// the connector's last sync of a private league: its rules, shaped like ESPN's settings
async function fromConnector(id: string, season: number) {
  if (!URL_ || !SERVICE) return null;
  const q = `espn_sync_leagues?league_id=eq.${id}&season=in.(${season},${season - 1})&select=season,last_synced_at,name:snapshot->name,size:snapshot->teamCount,rules:snapshot->rules&order=season.desc,last_synced_at.desc&limit=1`;
  const r = await fetch(`${URL_}/rest/v1/${q}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
  if (!r.ok) return null;
  const row = (await r.json())[0];
  if (!row || !row.rules) return null;
  const x = row.rules;
  return { via: "connector", synced: row.last_synced_at, season: row.season,
    settings: { name: row.name, size: row.size, rosterSettings: x.roster, scoringSettings: x.scoring, scheduleSettings: x.schedule, draftSettings: x.draft, acquisitionSettings: x.acquisition, tradeSettings: x.trade } };
}

const YAHOO_HOST: Record<string, string> = { nfl: "football.fantasysports.yahoo.com/f1", nba: "basketball.fantasysports.yahoo.com/nba", mlb: "baseball.fantasysports.yahoo.com/b1", nhl: "hockey.fantasysports.yahoo.com/hockey" };
async function yahoo(sport: string, id: string) {
  const r = await fetch(`https://${YAHOO_HOST[sport]}/${id}/settings`, { headers: { "user-agent": BROWSER_UA, accept: "text/html" }, redirect: "manual", signal: AbortSignal.timeout(15000) });
  if (r.status >= 300 && r.status < 400) return { error: "private" };   // sent to sign in
  if (r.status === 404) return { error: "not_found" };
  if (!r.ok) return { error: "yahoo", status: r.status };
  const html = await r.text();
  // the settings table and stat values as lines of text, the way the page copies
  const text = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<\/(tr|p|div|li|h\d|dt|dd|table|section)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  if (!/Roster Positions/i.test(text)) return { error: "private" };
  return { text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const q = new URL(req.url).searchParams;
  const src = q.get("src"), sport = q.get("sport") || "", id = q.get("id") || "";
  if (src !== "espn" && src !== "yahoo") return reply({ error: "bad_source" }, 400);
  if (!GAME[sport]) return reply({ error: "bad_sport" }, 400);
  if (!/^\d{3,12}$/.test(id)) return reply({ error: "bad_id" }, 400);
  if (src === "yahoo") {
    try { const out: any = await yahoo(sport, id); return reply(out, out.error === "yahoo" ? 502 : 200); } catch (_e) { return reply({ error: "yahoo" }, 502); }
  }
  const asked = Number(q.get("season")) || 0, now = seasonFor(sport);
  const season = asked >= 2018 && asked <= now + 1 ? asked : now;
  try {
    let out: any = await espn(sport, id, season);
    // a league that hasn't renewed for the new season yet still has last season's settings
    if (out.error === "not_found" && !asked) out = await espn(sport, id, season - 1);
    if (out.error === "private" && sport === "nfl" && await isOwner(req)) out = (await fromConnector(id, season)) || out;
    return reply(out, out.error === "espn" ? 502 : 200);
  } catch (_e) {
    return reply({ error: "espn" }, 502);
  }
});
