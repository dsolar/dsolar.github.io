// The Fantasy Kit's live box scores: GET /functions/v1/fk-live?sport=nba|nfl|mlb returns the current fantasy week's
// totals so far for every player, games in progress included, in the same shape as fantasy-kit/data/weeks-<sport>.json
// (columns as { line, cols } or { lines }, and each player's week under players), plus where each pro team stands this week ({ teams: { ABBR: { played, live, left } } }),
// which the league pages use for live win chances, each team's games ({ games: { ABBR: [{ at, state, detail, opp, home, us, them }] } }) for the
// matchup page, and for football Sleeper's projections for the week ({ proj: { id: line } }).
//
//   basketball  ESPN's scoreboard and box scores, Monday to Sunday weeks, player ids as name slugs (like Hard Cap)
//   football    Sleeper's live weekly stats (the same feed as weeks-nfl.json), game states from ESPN's scoreboard
//   baseball    MLB's Stats API schedule and box scores, Monday to Sunday weeks
//
// A result is kept about a minute (table fk_live), so the feeds get a request or two a minute however many pages are
// open, and a finished game's lines are kept for good (table fk_live_games) so they're only fetched once.
const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA = "davidsolar-fantasykit-live/1.0 (+https://davidsolar.dev/fantasy-kit/)";
// ESPN turns away requests that don't look like a browser (the guillotine league's live relay found the same)
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const FRESH_MS = 50e3;
const errors: string[] = [];
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, OPTIONS" };

const db = (path: string, init: RequestInit = {}) =>
  fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers || {}) } });
async function getJSON(url: string) {
  const host = new URL(url).host;
  try {
    const r = await fetch(url, { headers: { "User-Agent": /espn/.test(host) ? BROWSER_UA : UA, Accept: "application/json" } });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } catch (e) {
    errors.push(`${host}: ${String(e).slice(0, 80)}`);
    throw e;
  }
}
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>) {
  const out: R[] = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}
// dates in New York, where the leagues' days are
const nyDate = (t = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (iso: string) => { const d = new Date(iso + "T12:00:00Z"); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };
const slug = (n: string) => n.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const sumInto = (acc: Record<string, number[]>, id: string, row: number[]) => { const a = acc[id]; acc[id] = a ? a.map((x, i) => x + (row[i] || 0)) : row.slice(); };
type Teams = Record<string, { played: number; live: number; left: number }>;
// each pro team's games this week, for the matchup page: when, against whom, where it stands
type Game = { id: string; at: string; state: string; detail: string; opp: string; home: boolean; us: number | null; them: number | null };
type Games = Record<string, Game[]>;
function espnGames(games: Games, e: any, map: Record<string, string>) {
  const comp = e.competitions?.[0] || {}, cs = comp.competitors || [], state = e.status?.type?.state || "pre";
  const detail = String(e.status?.type?.shortDetail || "").replace(/\s+-\s+/, " ");
  for (const c of cs) {
    const o = cs.find((x: any) => x !== c); if (!o) continue;
    const ab = map[c.team?.abbreviation] || c.team?.abbreviation, oab = map[o.team?.abbreviation] || o.team?.abbreviation;
    (games[ab] ||= []).push({ id: String(e.id), at: e.date, state, detail, opp: oab, home: c.homeAway === "home", us: state === "pre" ? null : Number(c.score) || 0, them: state === "pre" ? null : Number(o.score) || 0 });
  }
}
const tally = (teams: Teams, abbr: string, state: string) => { const t = (teams[abbr] ||= { played: 0, live: 0, left: 0 }); if (state === "post") t.played++; else if (state === "in") t.live++; else t.left++; };

// a finished game's lines, kept; anything else fetched fresh
async function cached(sport: string, ids: string[]) {
  if (!ids.length) return {} as Record<string, any>;
  const r = await db(`fk_live_games?sport=eq.${sport}&final=is.true&gid=in.(${ids.map((x) => `"${x}"`).join(",")})&select=gid,lines`);
  const rows = r.ok ? await r.json() : [];
  return Object.fromEntries(rows.map((x: any) => [x.gid, x.lines]));
}
async function keep(sport: string, rows: { gid: string; day: string; final: boolean; lines: unknown }[]) {
  if (!rows.length) return;
  await db("fk_live_games", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(rows.map((x) => ({ sport, ...x, updated_at: new Date().toISOString() }))) });
}

/* ---------- basketball ---------- */
const NBA_COLS = ["gp", "eg", "min", "fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "ast", "stl", "blk", "tov"];
const NBA_TEAM: Record<string, string> = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS", BKN: "BRK", CHA: "CHO", PHX: "PHO" };
async function nba() {
  const today = nyDate(), start = mondayOf(today), end = addDays(start, 6);
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)), sy = m >= 7 ? y : y - 1;
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const boards = await pool(days, 4, (d) => getJSON(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d.replace(/-/g, "")}`).catch(() => ({ events: [] })));
  const teams: Teams = {}, games: { id: string; day: string; state: string }[] = [], sched: Games = {};
  boards.forEach((b: any, i) => {
    for (const e of b.events || []) {
      const state = e.status?.type?.state || "pre";
      espnGames(sched, e, NBA_TEAM);
      for (const c of e.competitions?.[0]?.competitors || []) tally(teams, NBA_TEAM[c.team?.abbreviation] || c.team?.abbreviation, state);
      if (state !== "pre") games.push({ id: String(e.id), day: days[i], state });
    }
  });
  const have = await cached("nba", games.map((g) => g.id)), fresh: any[] = [];
  const lines = await pool(games, 6, async (g) => {
    if (have[g.id]) return have[g.id];
    const s: any = await getJSON(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${g.id}`).catch(() => null);
    const out: Record<string, number[]> = {};
    for (const side of s?.boxscore?.players || []) {
      const st = side.statistics?.[0]; if (!st) continue;
      const ix = (k: string) => (st.labels || []).indexOf(k);
      for (const a of st.athletes || []) {
        if (a.didNotPlay || !a.stats?.length) continue;
        const v = (k: string) => a.stats[ix(k)] ?? "0";
        const pair = (k: string) => String(v(k)).split("-").map((x) => Number(x) || 0);
        const [fgm, fga] = pair("FG"), [tpm] = pair("3PT"), [ftm, fta] = pair("FT");
        out[slug(a.athlete?.displayName || "")] = [1, 1, Number(v("MIN")) || 0, fgm, fga, ftm, fta, tpm, Number(v("PTS")) || 0, Number(v("REB")) || 0, Number(v("AST")) || 0, Number(v("STL")) || 0, Number(v("BLK")) || 0, Number(v("TO")) || 0];
      }
    }
    fresh.push({ gid: g.id, day: g.day, final: g.state === "post" && !!s, lines: out });
    return out;
  });
  await keep("nba", fresh);
  const acc: Record<string, number[]> = {};
  for (const l of lines) for (const [id, row] of Object.entries(l || {})) sumInto(acc, id, row as number[]);
  return { sport: "nba", season: `${sy}-${String(sy + 1).slice(2)}`, start, end, line: "pg", cols: NBA_COLS, players: acc, teams, games: sched };
}

/* ---------- football ---------- */
const NFL_COLS = ["g", "pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td", "rec", "rec_tgt", "rec_yd", "rec_td", "fum_lost",
  "fgm", "fga", "xpm", "def_td", "def_int", "def_sack", "pts_allow", "pts_std", "pts_half_ppr", "pts_ppr"];
const NFL_POS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const NFL_TEAM: Record<string, string> = { WSH: "WAS" };
async function nfl() {
  const state: any = await getJSON("https://api.sleeper.app/v1/state/nfl");
  const season = Number(state.season), week = Number(state.week || 0);
  if (state.season_type !== "regular" || !week) return { sport: "nfl", season: String(season), start: null, end: null, line: "tot", cols: NFL_COLS, players: {}, teams: {} };
  // weeks run Tuesday to Monday, from the Tuesday on or before kickoff (as weeks-nfl.json does)
  const kick = state.season_start_date || `${season}-09-05`, kd = new Date(kick + "T12:00:00Z");
  const tue1 = addDays(kick, -((kd.getUTCDay() - 2 + 7) % 7)), start = addDays(tue1, 7 * (week - 1)), end = addDays(start, 6);
  const q = NFL_POS.map((p) => `&position%5B%5D=${p}`).join("");
  const [rows, board]: any[] = await Promise.all([
    getJSON(`https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=regular${q}`).catch(() => []),
    getJSON(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`).catch(() => ({ events: [] })),
  ]);
  const lines: Record<string, number[]> = {};
  for (const r of Array.isArray(rows) ? rows : Object.values(rows || {})) {
    const pos = r.player?.position || r.position;
    if (!NFL_POS.includes(pos)) continue;
    const st = r.stats || {}, g = st.gp || st.gms_active || 0;
    const line = [g].concat(NFL_COLS.slice(1).map((c) => Math.round((st[c] || 0) * 100) / 100));
    if (g || line.slice(1).some(Boolean)) lines[String(r.player_id)] = line;
  }
  const teams: Teams = {}, sched: Games = {};
  for (const e of board.events || []) { espnGames(sched, e, NFL_TEAM); for (const c of e.competitions?.[0]?.competitors || []) tally(teams, NFL_TEAM[c.team?.abbreviation] || c.team?.abbreviation, e.status?.type?.state || "pre"); }
  return { sport: "nfl", season: String(season), week, start, end, line: "tot", cols: NFL_COLS, players: lines, teams, games: sched, proj: await nflProj(season, week, q) };
}

// Sleeper's projections for this week, same columns as the stat lines, so any scoring can total them. They move a
// few times a day, so they're kept half an hour (table fk_live, under "nfl-proj").
async function nflProj(season: number, week: number, q: string) {
  const key = `nfl-proj`;
  const r = await db(`fk_live?sport=eq.${key}&select=data,updated_at`);
  const row = r.ok ? (await r.json())[0] : null;
  if (row && row.data && row.data.week === week && Date.now() - Date.parse(row.updated_at) < 30 * 60e3) return row.data.lines;
  const rows: any = await getJSON(`https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular${q}`).catch(() => null);
  if (!rows) return row && row.data && row.data.week === week ? row.data.lines : {};
  const lines: Record<string, number[]> = {};
  for (const x of Array.isArray(rows) ? rows : Object.values(rows || {})) {
    const st = x.stats || {};
    if (!st.pts_half_ppr && !st.pts_ppr && !st.pts_std) continue;
    lines[String(x.player_id)] = [1].concat(NFL_COLS.slice(1).map((c) => Math.round((st[c] || 0) * 100) / 100));
  }
  await db("fk_live", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ sport: key, data: { week, lines }, updated_at: new Date().toISOString() }) });
  return lines;
}

/* ---------- baseball ---------- */
const MLB_TEAMS: Record<string, string> = {
  "Arizona Diamondbacks": "ARI", "Athletics": "ATH", "Oakland Athletics": "ATH", "Atlanta Braves": "ATL", "Baltimore Orioles": "BAL", "Boston Red Sox": "BOS",
  "Chicago Cubs": "CHC", "Chicago White Sox": "CWS", "Cincinnati Reds": "CIN", "Cleveland Guardians": "CLE", "Colorado Rockies": "COL", "Detroit Tigers": "DET",
  "Houston Astros": "HOU", "Kansas City Royals": "KC", "Los Angeles Angels": "LAA", "Los Angeles Dodgers": "LAD", "Miami Marlins": "MIA", "Milwaukee Brewers": "MIL",
  "Minnesota Twins": "MIN", "New York Mets": "NYM", "New York Yankees": "NYY", "Philadelphia Phillies": "PHI", "Pittsburgh Pirates": "PIT", "San Diego Padres": "SD",
  "San Francisco Giants": "SF", "Seattle Mariners": "SEA", "St. Louis Cardinals": "STL", "Tampa Bay Rays": "TB", "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR",
  "Washington Nationals": "WSH",
};
const WK_BAT = ["g", "pa", "ab", "r", "h", "hr", "rbi", "sb", "tb", "avg", "obp", "ops", "bb", "hbp", "sf"];
const WK_PIT = ["g", "gs", "ip", "w", "l", "sv", "hld", "k", "er", "bb", "h", "era", "whip", "qs", "outs"];
const MLB = "https://statsapi.mlb.com/api/v1/";
async function mlb() {
  const today = nyDate(), start = mondayOf(today), end = addDays(start, 6);
  const sched: any = await getJSON(`${MLB}schedule?sportId=1&gameType=R&startDate=${start}&endDate=${end}&hydrate=linescore`).catch(() => ({ dates: [] }));
  const teams: Teams = {}, games: { id: string; day: string; state: string }[] = [], byTeam: Games = {};
  for (const d of sched.dates || []) for (const g of d.games || []) {
    const ab = g.status?.abstractGameState, state = ab === "Final" ? "post" : ab === "Live" ? "in" : "pre";
    if (g.status?.detailedState === "Postponed") continue;
    const ls = g.linescore || {}, detail = state === "post" ? "Final" : state === "in" ? `${ls.inningHalf || ls.inningState || ""} ${ls.currentInningOrdinal || ""}`.trim() : "";
    for (const [side, other] of [["away", "home"], ["home", "away"]]) {
      const me = g.teams?.[side], op = g.teams?.[other];
      const a1 = MLB_TEAMS[me?.team?.name] || me?.team?.abbreviation, a2 = MLB_TEAMS[op?.team?.name] || op?.team?.abbreviation;
      if (a1) (byTeam[a1] ||= []).push({ id: String(g.gamePk), at: g.gameDate, state, detail, opp: a2, home: side === "home", us: state === "pre" ? null : me?.score ?? 0, them: state === "pre" ? null : op?.score ?? 0 });
    }
    for (const side of ["away", "home"]) tally(teams, MLB_TEAMS[g.teams?.[side]?.team?.name] || g.teams?.[side]?.team?.abbreviation, state);
    if (state !== "pre") games.push({ id: String(g.gamePk), day: d.date, state });
  }
  const have = await cached("mlb", games.map((g) => g.id)), fresh: any[] = [];
  const per = await pool(games, 6, async (g) => {
    if (have[g.id]) return have[g.id];
    const box: any = await getJSON(`${MLB}game/${g.id}/boxscore`).catch(() => null);
    const out: Record<string, { b?: number[]; p?: number[] }> = {};
    for (const side of ["away", "home"]) for (const pl of Object.values(box?.teams?.[side]?.players || {}) as any[]) {
      const id = String(pl.person?.id), b = pl.stats?.batting || {}, q = pl.stats?.pitching || {}, row: { b?: number[]; p?: number[] } = {};
      if (b.plateAppearances || b.atBats || b.runs || b.stolenBases) row.b = [1, b.plateAppearances || 0, b.atBats || 0, b.runs || 0, b.hits || 0, b.homeRuns || 0, b.rbi || 0, b.stolenBases || 0, b.totalBases || 0, b.baseOnBalls || 0, b.hitByPitch || 0, b.sacFlies || 0];
      if (q.inningsPitched != null && q.inningsPitched !== "") {
        const [w, part] = String(q.inningsPitched).split("."), outs = (Number(w) || 0) * 3 + (Number(part) || 0), gs = q.gamesStarted ? 1 : 0;
        row.p = [1, gs, outs, q.wins || 0, q.losses || 0, q.saves || 0, q.holds || 0, q.strikeOuts || 0, q.earnedRuns || 0, q.baseOnBalls || 0, q.hits || 0, gs && outs >= 18 && (q.earnedRuns || 0) <= 3 ? 1 : 0];
      }
      if (row.b || row.p) out[id] = row;
    }
    fresh.push({ gid: g.id, day: g.day, final: g.state === "post" && !!box, lines: out });
    return out;
  });
  await keep("mlb", fresh);
  const acc: Record<string, { b?: number[]; p?: number[] }> = {};
  for (const l of per) for (const [id, row] of Object.entries(l || {})) {
    const a = (acc[id] ||= {});
    for (const k of ["b", "p"] as const) if (row[k]) a[k] = a[k] ? a[k]!.map((x, i) => x + row[k]![i]) : row[k]!.slice();
  }
  const lines: Record<string, { bat?: number[]; pit?: number[] }> = {};
  const r3 = (x: number) => Math.round(x * 1000) / 1000, r2 = (x: number) => Math.round(x * 100) / 100;
  for (const [id, a] of Object.entries(acc)) {
    const row: { bat?: number[]; pit?: number[] } = {};
    if (a.b) {
      const [g, pa, ab, r, h, hr, rbi, sb, tb, bb, hbp, sf] = a.b, den = ab + bb + hbp + sf, obp = den ? (h + bb + hbp) / den : 0;
      row.bat = [g, pa, ab, r, h, hr, rbi, sb, tb, ab ? r3(h / ab) : 0, r3(obp), r3(obp + (ab ? tb / ab : 0)), bb, hbp, sf];
    }
    if (a.p) {
      const [g, gs, outs, w, l, sv, hld, k, er, bb, h, qs] = a.p, ip = outs / 3;
      row.pit = [g, gs, r2(ip), w, l, sv, hld, k, er, bb, h, ip ? r2(er * 9 / ip) : 0, ip ? r2((bb + h) / ip) : 0, qs, outs];
    }
    lines[id] = row;
  }
  return { sport: "mlb", season: start.slice(0, 4), start, end, lines: { bat: WK_BAT, pit: WK_PIT }, players: lines, teams, games: byTeam };
}

// One-week slates: this NFL week's games and next week's, each { id, at, away, home, state }, so a one-week league can
// pick its games (GET ?sport=nfl&slates=1). Kept ten minutes (table fk_live, under "nfl-slates").
async function nflSlates() {
  const key = "nfl-slates";
  const r = await db(`fk_live?sport=eq.${key}&select=data,updated_at`);
  const row = r.ok ? (await r.json())[0] : null;
  if (row && Date.now() - Date.parse(row.updated_at) < 10 * 60e3) return row.data;
  const state: any = await getJSON("https://api.sleeper.app/v1/state/nfl").catch(() => null);
  if (!state) return row ? row.data : { weeks: [] };
  const season = Number(state.season), week = Number(state.week || 0) || 1;
  const kick = state.season_start_date || `${season}-09-05`, kd = new Date(kick + "T12:00:00Z");
  const tue1 = addDays(kick, -((kd.getUTCDay() - 2 + 7) % 7));
  const weeks = [];
  for (const w of [week, week + 1]) {
    if (w > 18) continue;
    const board: any = await getJSON(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${w}&dates=${season}`).catch(() => ({ events: [] }));
    const games = (board.events || []).map((e: any) => {
      const cs = e.competitions?.[0]?.competitors || [], side = (h: string) => cs.find((c: any) => c.homeAway === h)?.team?.abbreviation;
      const ab = (x: string) => NFL_TEAM[x] || x;
      return { id: String(e.id), at: e.date, away: ab(side("away")), home: ab(side("home")), state: e.status?.type?.state || "pre" };
    }).filter((g: any) => g.away && g.home).sort((a: any, b: any) => Date.parse(a.at) - Date.parse(b.at));
    const start = addDays(tue1, 7 * (w - 1));
    weeks.push({ week: w, start, end: addDays(start, 6), games });
  }
  const data = { season: String(season), weeks, updated: new Date().toISOString() };
  await db("fk_live", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ sport: key, data, updated_at: data.updated }) });
  return data;
}

const BUILD: Record<string, () => Promise<any>> = { nba, nfl, mlb };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const q = new URL(req.url).searchParams, sport = q.get("sport") || "";
  if (sport === "nfl" && q.get("slates")) {
    const data = await nflSlates().catch((e) => ({ weeks: [], error: String(e) }));
    return new Response(JSON.stringify(data), { headers: { ...CORS, "content-type": "application/json", "cache-control": "max-age=120" } });
  }
  if (!BUILD[sport]) return new Response(JSON.stringify({ error: "sport must be nba, nfl or mlb" }), { status: 400, headers: { ...CORS, "content-type": "application/json" } });
  const r = await db(`fk_live?sport=eq.${sport}&select=data,updated_at`);
  const row = r.ok ? (await r.json())[0] : null;
  if (row && Date.now() - Date.parse(row.updated_at) < FRESH_MS) return new Response(JSON.stringify(row.data), { headers: { ...CORS, "content-type": "application/json", "cache-control": "max-age=30" } });
  try {
    errors.length = 0;
    const data = await BUILD[sport]();
    data.updated = new Date().toISOString();
    if (errors.length) data.errors = errors.slice(0, 5);
    await db("fk_live", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ sport, data, updated_at: data.updated }) });
    return new Response(JSON.stringify(data), { headers: { ...CORS, "content-type": "application/json", "cache-control": "max-age=30" } });
  } catch (e) {
    // a feed that's down: the last result if there is one, so the pages keep what they had
    if (row) return new Response(JSON.stringify(Object.assign({}, row.data, { stale: true })), { headers: { ...CORS, "content-type": "application/json" } });
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...CORS, "content-type": "application/json" } });
  }
});
