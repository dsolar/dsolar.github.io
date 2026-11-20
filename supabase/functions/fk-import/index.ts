// Draft Lab league import: reads a public ESPN league's settings for the Start a league page, which can't ask ESPN
// itself (ESPN doesn't answer other sites' pages). GET /functions/v1/fk-import?src=espn&sport=nfl|nba|mlb|nhl&id=<league>
// [&season=YYYY] returns { settings, teams } (ESPN's mSettings view, teams counted, names only). Sleeper and Yahoo don't
// come through here: Sleeper's API answers the page directly and Yahoo is pasted text.
// Private ESPN leagues come back as { error: "private" }: ESPN only shows them to signed-in members.
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, OPTIONS" };
const GAME: Record<string, string> = { nfl: "ffl", nba: "fba", mlb: "flb", nhl: "fhl" };
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json", "cache-control": "public, max-age=60" } });

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const q = new URL(req.url).searchParams;
  const src = q.get("src"), sport = q.get("sport") || "", id = q.get("id") || "";
  if (src !== "espn") return reply({ error: "bad_source" }, 400);
  if (!GAME[sport]) return reply({ error: "bad_sport" }, 400);
  if (!/^\d{3,12}$/.test(id)) return reply({ error: "bad_id" }, 400);
  const asked = Number(q.get("season")) || 0, now = seasonFor(sport);
  const season = asked >= 2018 && asked <= now + 1 ? asked : now;
  try {
    let out: any = await espn(sport, id, season);
    // a league that hasn't renewed for the new season yet still has last season's settings
    if (out.error === "not_found" && !asked) out = await espn(sport, id, season - 1);
    return reply(out, out.error === "espn" ? 502 : 200);
  } catch (_e) {
    return reply({ error: "espn" }, 502);
  }
});
