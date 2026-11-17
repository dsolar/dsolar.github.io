// The Fantasy Kit's live box scores: GET /functions/v1/fk-live?sport=nba|nfl|mlb|nhl returns the current fantasy week's
// totals so far for every player, games in progress included, in the same shape as fantasy-kit/data/weeks-<sport>.json
// (columns as { line, cols } or { lines }, and each player's week under players), plus where each pro team stands this week ({ teams: { ABBR: { played, live, left } } }),
// which the league pages use for live win chances, each team's games ({ games: { ABBR: [{ at, state, detail, opp, home, us, them }] } }) for the
// matchup page, and for football Sleeper's projections for the week ({ proj: { id: line } }).
//
//   basketball  ESPN's scoreboard and box scores, Monday to Sunday weeks, player ids as name slugs (like Hard Cap)
//   football    Sleeper's live weekly stats (the same feed as weeks-nfl.json), game states from ESPN's scoreboard
//   baseball    MLB's Stats API schedule and box scores, Monday to Sunday weeks
//
// Starting lineups (baseball): ?sport=mlb&lineups=1 (today and tomorrow) or &date=YYYY-MM-DD, see mlbLineups.
//
// Two more reads for one-day games:
//   ?sport=nba&slates=1          today's and tomorrow's NBA games (New York days), each { id, at, away, home, state }
//   ?sport=nba&games=id1,id2     those games' box scores and states, { games: { id: { state, lines } } }, whatever week
//                                they're in, so a one-day league can score its own games and know when they're final
//
// A result is kept about a minute (table fk_live), so the feeds get a request or two a minute however many pages are
// open, and a finished game's lines are kept for good (table fk_live_games) so they're only fetched once.
import { NHL_LINES, gameState as nhlState, boxLines as nhlBox, mergeLines as nhlMerge, finishLines as nhlFinish } from "./nhl.mjs";

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
const nbaSummary = (id: string) => getJSON(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`).catch(() => null);
// one game's lines from ESPN's summary, by player name slug, in NBA_COLS order
function nbaBox(s: any) {
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
  return out;
}
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
    const s: any = await nbaSummary(g.id);
    const out = nbaBox(s);
    fresh.push({ gid: g.id, day: g.day, final: g.state === "post" && !!s, lines: out });
    return out;
  });
  await keep("nba", fresh);
  const acc: Record<string, number[]> = {};
  for (const l of lines) for (const [id, row] of Object.entries(l || {})) sumInto(acc, id, row as number[]);
  return { sport: "nba", season: `${sy}-${String(sy + 1).slice(2)}`, start, end, line: "pg", cols: NBA_COLS, players: acc, boxes: Object.fromEntries(games.map((g, i) => [g.id, lines[i]])), teams, games: sched };
}

/* ---------- hockey ---------- */
async function nhl() {
  const today = nyDate(), start = mondayOf(today), end = addDays(start, 6);
  const board: any = await getJSON(`https://api-web.nhle.com/v1/schedule/${start}`);
  if (!Array.isArray(board.gameWeek)) throw new Error("NHL schedule missing");
  const teams: Teams = {}, sched: Games = {}, games: { id: string; day: string; state: string }[] = [];
  let season = "";
  for (const d of board.gameWeek) for (const g of d.games || []) {
    if (g.gameType !== 2 || d.date < start || d.date > end) continue;
    const state = nhlState(g); if (state === "off") continue;
    const sy = String(g.season); season = `${sy.slice(0, 4)}-${sy.slice(-2)}`;
    const pd = g.periodDescriptor, detail = state === "post" ? `Final${pd?.periodType && pd.periodType !== "REG" ? ` (${pd.periodType})` : ""}` : state === "in" ? `${g.clock?.timeRemaining || ""} ${pd?.periodType === "OT" ? "OT" : pd?.periodType === "SO" ? "SO" : `P${pd?.number || 1}`}`.trim() : "";
    for (const [side, other] of [["awayTeam", "homeTeam"], ["homeTeam", "awayTeam"]]) {
      const me = g[side], op = g[other]; if (!me?.abbrev || !op?.abbrev) continue;
      tally(teams, me.abbrev, state);
      (sched[me.abbrev] ||= []).push({ id: String(g.id), at: g.startTimeUTC, state, detail, opp: op.abbrev, home: side === "homeTeam", us: state === "pre" ? null : me.score ?? 0, them: state === "pre" ? null : op.score ?? 0 });
    }
    if (state !== "pre") games.push({ id: String(g.id), day: d.date, state });
  }
  const have = await cached("nhl", games.map((g) => g.id)), fresh: any[] = [];
  const boxes = await pool(games, 6, async (g) => {
    if (have[g.id]) return have[g.id];
    const [box, landing]: any[] = await Promise.all([getJSON(`https://api-web.nhle.com/v1/gamecenter/${g.id}/boxscore`), getJSON(`https://api-web.nhle.com/v1/gamecenter/${g.id}/landing`)]);
    const lines = nhlBox(box, landing);
    fresh.push({ gid: g.id, day: g.day, final: nhlState(box) === "post", lines });
    return lines;
  });
  await keep("nhl", fresh);
  const acc = {}; for (const lines of boxes) nhlMerge(acc, lines);
  if (!season) { const y = Number(today.slice(0, 4)), sy = Number(today.slice(5, 7)) >= 9 ? y : y - 1; season = `${sy}-${String(sy + 1).slice(-2)}`; }
  return { sport: "nhl", season, start, end, lines: NHL_LINES, players: nhlFinish(acc), boxes: Object.fromEntries(games.map((g, i) => [g.id, boxes[i]])), teams, games: sched };
}

/* ---------- football ---------- */
const NFL_COLS = ["g", "pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td", "rec", "rec_tgt", "rec_yd", "rec_td", "fum_lost",
  "fgm", "fga", "xpm", "def_td", "def_int", "def_sack", "pts_allow", "pts_std", "pts_half_ppr", "pts_ppr",
  // the same extra columns as tools/fantasykit_data.py, on the end
  "pass_att", "pass_cmp", "pass_fd", "rush_fd", "rec_fd", "pass_2pt", "rush_2pt", "rec_2pt", "fum", "fgm_50p", "xpmiss",
  "fum_rec", "ff", "safe", "def_st_td", "yds_allow"];
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
// the same columns as tools/fantasykit_data.py: the advanced categories' parts on the end
const WK_BAT = ["g", "pa", "ab", "r", "h", "hr", "rbi", "sb", "tb", "avg", "obp", "ops", "bb", "hbp", "sf", "2b", "3b", "so", "ibb", "cs"];
const WK_PIT = ["g", "gs", "ip", "w", "l", "sv", "hld", "k", "er", "bb", "h", "era", "whip", "qs", "outs", "hr", "hbp", "bf"];
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
      if (b.plateAppearances || b.atBats || b.runs || b.stolenBases) row.b = [1, b.plateAppearances || 0, b.atBats || 0, b.runs || 0, b.hits || 0, b.homeRuns || 0, b.rbi || 0, b.stolenBases || 0, b.totalBases || 0, b.baseOnBalls || 0, b.hitByPitch || 0, b.sacFlies || 0,
        b.doubles || 0, b.triples || 0, b.strikeOuts || 0, b.intentionalWalks || 0, b.caughtStealing || 0];
      if (q.inningsPitched != null && q.inningsPitched !== "") {
        const [w, part] = String(q.inningsPitched).split("."), outs = (Number(w) || 0) * 3 + (Number(part) || 0), gs = q.gamesStarted ? 1 : 0;
        row.p = [1, gs, outs, q.wins || 0, q.losses || 0, q.saves || 0, q.holds || 0, q.strikeOuts || 0, q.earnedRuns || 0, q.baseOnBalls || 0, q.hits || 0, gs && outs >= 18 && (q.earnedRuns || 0) <= 3 ? 1 : 0,
          q.homeRuns || 0, q.hitByPitch || 0, q.battersFaced || 0];
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
    // a game cached before the columns grew is shorter: missing parts count 0
    for (const k of ["b", "p"] as const) if (row[k]) { const x = a[k] || [], y = row[k]!; a[k] = Array.from({ length: Math.max(x.length, y.length) }, (_, i) => (x[i] || 0) + (y[i] || 0)); }
  }
  return { sport: "mlb", season: start.slice(0, 4), start, end, lines: { bat: WK_BAT, pit: WK_PIT }, players: mlbLines(acc), boxes: Object.fromEntries(games.map((g, i) => [g.id, mlbLines(per[i] || {})])), teams, games: byTeam };
}
// Today's and tomorrow's starting lineups and probable pitchers (?sport=mlb&lineups=1, or &date=YYYY-MM-DD for one
// day), from MLB's schedule hydrated with lineups. Each day:
//   teams:  { ABBR: [{ game, at, opp, home, state, posted, ppd }] }   posted: the batting order is out
//   bat:    { playerId: [{ game, o }] }                               o: his spot in the order, 1 to 9
//   sp:     { playerId: [{ game, opp, home }] }                        the probable starters
// Lineups come out a few hours before first pitch; until then a team's games show posted: false.
const lineupCache: Record<string, { at: number; data: any }> = {};
async function mlbLineupDay(date: string) {
  const c = lineupCache[date];
  if (c && Date.now() - c.at < 90e3) return c.data;
  const sched: any = await getJSON(`${MLB}schedule?sportId=1&date=${date}&hydrate=lineups,probablePitcher`).catch(() => ({ dates: [] }));
  const day: any = { teams: {}, bat: {}, sp: {} };
  for (const d of sched.dates || []) for (const g of d.games || []) {
    const ab = g.status?.abstractGameState, state = ab === "Final" ? "post" : ab === "Live" ? "in" : "pre";
    const ppd = g.status?.detailedState === "Postponed" || g.status?.codedGameState === "D";
    for (const [side, other] of [["away", "home"], ["home", "away"]]) {
      const me = g.teams?.[side], op = g.teams?.[other];
      const a1 = MLB_TEAMS[me?.team?.name] || me?.team?.abbreviation, a2 = MLB_TEAMS[op?.team?.name] || op?.team?.abbreviation;
      if (!a1) continue;
      const order: any[] = (g.lineups && (g.lineups[`${side}Players`] || g.lineups[side])) || [];
      (day.teams[a1] ||= []).push({ game: String(g.gamePk), at: g.gameDate, opp: a2, home: side === "home", state, posted: order.length > 0, ppd });
      order.forEach((pl: any, i: number) => { const id = String(pl?.id ?? pl?.person?.id ?? ""); if (id) (day.bat[id] ||= []).push({ game: String(g.gamePk), o: i + 1 }); });
      const sp = me?.probablePitcher;
      if (sp && sp.id) (day.sp[String(sp.id)] ||= []).push({ game: String(g.gamePk), opp: a2, home: side === "home" });
    }
  }
  lineupCache[date] = { at: Date.now(), data: day };
  return day;
}
async function mlbLineups(date: string | null) {
  const dates = date ? [date] : [nyDate(), addDays(nyDate(), 1)];
  const days: Record<string, any> = {};
  for (const d of dates) days[d] = await mlbLineupDay(d);
  return { sport: "mlb", days, updated: new Date().toISOString(), ...(errors.length ? { errors: errors.slice(0, 5) } : {}) };
}
function mlbLines(acc: Record<string, { b?: number[]; p?: number[] }>) {
  const lines: Record<string, { bat?: number[]; pit?: number[] }> = {};
  const r3 = (x: number) => Math.round(x * 1000) / 1000, r2 = (x: number) => Math.round(x * 100) / 100;
  for (const [id, a] of Object.entries(acc)) {
    const row: { bat?: number[]; pit?: number[] } = {};
    if (a.b) {
      const [g, pa, ab, r, h, hr, rbi, sb, tb, bb, hbp, sf, d2 = 0, d3 = 0, so = 0, ibb = 0, cs = 0] = a.b, den = ab + bb + hbp + sf, obp = den ? (h + bb + hbp) / den : 0;
      row.bat = [g, pa, ab, r, h, hr, rbi, sb, tb, ab ? r3(h / ab) : 0, r3(obp), r3(obp + (ab ? tb / ab : 0)), bb, hbp, sf, d2, d3, so, ibb, cs];
    }
    if (a.p) {
      const [g, gs, outs, w, l, sv, hld, k, er, bb, h, qs, hra = 0, hbp = 0, bf = 0] = a.p, ip = outs / 3;
      row.pit = [g, gs, r2(ip), w, l, sv, hld, k, er, bb, h, ip ? r2(er * 9 / ip) : 0, ip ? r2((bb + h) / ip) : 0, qs, outs, hra, hbp, bf];
    }
    lines[id] = row;
  }
  return lines;
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

// One-day slates: today's and tomorrow's NBA games in New York days, each { id, at, away, home, state }
// (GET ?sport=nba&slates=1). Shaped like the NFL's weeks so the same slate code reads both: each day is a "week"
// with a day. Kept five minutes (table fk_live, under "nba-slates"), so tip times and late scratches stay fresh.
async function nbaSlates() {
  const key = "nba-slates";
  const r = await db(`fk_live?sport=eq.${key}&select=data,updated_at`);
  const row = r.ok ? (await r.json())[0] : null;
  if (row && Date.now() - Date.parse(row.updated_at) < 5 * 60e3) return row.data;
  const today = nyDate(), days = [today, addDays(today, 1)];
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)), sy = m >= 7 ? y : y - 1;
  const boards: any[] = await Promise.all(days.map((d) => getJSON(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d.replace(/-/g, "")}`).catch(() => null)));
  if (boards.every((b) => !b)) return row ? row.data : { weeks: [] };
  const weeks = days.map((d, i) => {
    const games = ((boards[i] && boards[i].events) || []).map((e: any) => {
      const cs = e.competitions?.[0]?.competitors || [], side = (h: string) => cs.find((c: any) => c.homeAway === h)?.team?.abbreviation;
      const ab = (x: string) => NBA_TEAM[x] || x;
      return { id: String(e.id), at: e.date, away: ab(side("away")), home: ab(side("home")), state: e.status?.type?.state || "pre", off: /postpon|cancel/i.test(e.status?.type?.description || "") };
    }).filter((g: any) => g.away && g.home && !g.off).map(({ off, ...g }: any) => g).sort((a: any, b: any) => Date.parse(a.at) - Date.parse(b.at));
    return { day: d, start: d, end: d, games };
  });
  const data = { sport: "nba", season: `${sy}-${String(sy + 1).slice(2)}`, weeks, updated: new Date().toISOString() };
  await db("fk_live", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ sport: key, data, updated_at: data.updated }) });
  return data;
}

// Box scores for named games (GET ?sport=nba&games=id1,id2): { games: { id: { state, lines } } }, with the week's
// columns. Games in this week come from the week's feed (kept a minute); a game from an earlier week (a Sunday night
// game read on Monday) from the finished games kept for good, or from ESPN. A postponed game reads "off".
async function gamesFor(sport: string, ids: string[]) {
  const wk = await liveData(sport).catch(() => null);
  const out: Record<string, { state: string; lines: unknown }> = {};
  const state: Record<string, string> = {};
  for (const gs of Object.values((wk && wk.games) || {}) as Game[][]) for (const g of gs) state[g.id] = g.state;
  for (const id of ids) if (state[id]) out[id] = { state: state[id], lines: (wk && wk.boxes && wk.boxes[id]) || {} };
  const rest = ids.filter((id) => !out[id]);
  if (rest.length) {
    const have = await cached(sport, rest);
    for (const id of rest) if (have[id]) out[id] = { state: "post", lines: have[id] };
    if (sport === "nba") {
      const fresh: any[] = [];
      await pool(rest.filter((id) => !out[id]), 4, async (id) => {
        const s: any = await nbaSummary(id);
        if (!s) return;
        const st = s.header?.competitions?.[0]?.status?.type || {}, lines = nbaBox(s);
        const stt = /postpon|cancel/i.test(st.description || "") ? "off" : st.state || "pre";
        out[id] = { state: stt, lines };
        if (stt === "post") fresh.push({ gid: id, day: nyDate(Date.parse(s.header?.competitions?.[0]?.date || "") || Date.now()), final: true, lines });
      });
      await keep(sport, fresh);
    } else if (sport === "nhl") {
      const fresh: any[] = [];
      await pool(rest.filter((id) => !out[id]), 4, async (id) => {
        const [box, landing]: any[] = await Promise.all([getJSON(`https://api-web.nhle.com/v1/gamecenter/${id}/boxscore`), getJSON(`https://api-web.nhle.com/v1/gamecenter/${id}/landing`)]);
        const st = nhlState(box), lines = st === "pre" || st === "off" ? {} : nhlBox(box, landing);
        out[id] = { state: st, lines };
        if (st === "post") fresh.push({ gid: id, day: box.gameDate || nyDate(), final: true, lines });
      });
      await keep(sport, fresh);
    }
  }
  const cols = wk ? (wk.lines ? { lines: wk.lines } : { line: wk.line, cols: wk.cols }) : sport === "nba" ? { line: "pg", cols: NBA_COLS } : sport === "nhl" ? { lines: NHL_LINES } : {};
  return { sport, ...cols, games: out, updated: new Date().toISOString() };
}

const BUILD: Record<string, () => Promise<any>> = { nba, nfl, mlb, nhl };
// the week's feed for a sport: the kept copy if it's under a minute old, else built fresh and kept; a feed that's down
// gives the last copy marked stale
async function liveData(sport: string) {
  const r = await db(`fk_live?sport=eq.${sport}&select=data,updated_at`);
  const row = r.ok ? (await r.json())[0] : null;
  if (row && Date.now() - Date.parse(row.updated_at) < FRESH_MS) return row.data;
  try {
    errors.length = 0;
    const data = await BUILD[sport]();
    // Server-owned player kickoff map also guards roster saves from older clients.
    const playerPool: any = await getJSON(`https://davidsolar.dev/fantasy-kit/data/${sport}.json`);
    data.kicks = {};
    for (const p of playerPool.players || []) {
      const times = (data.games?.[p.t] || []).map((g: Game) => Date.parse(g.at)).filter(Number.isFinite);
      if (times.length) data.kicks[String(p.id)] = Math.min(...times);
    }
    data.updated = new Date().toISOString();
    if (errors.length) data.errors = errors.slice(0, 5);
    await db("fk_live", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ sport, data, updated_at: data.updated }) });
    return data;
  } catch (e) {
    if (row) return Object.assign({}, row.data, { stale: true });
    throw e;
  }
}
const json = (data: unknown, extra: Record<string, string> = {}, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json", ...extra } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const q = new URL(req.url).searchParams, sport = q.get("sport") || "";
  if (sport === "nfl" && q.get("slates")) return json(await nflSlates().catch((e) => ({ weeks: [], error: String(e) })), { "cache-control": "max-age=120" });
  if (sport === "nba" && q.get("slates")) return json(await nbaSlates().catch((e) => ({ weeks: [], error: String(e) })), { "cache-control": "max-age=60" });
  if (sport === "mlb" && q.get("lineups")) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get("date") || "") ? q.get("date") : null;
    errors.length = 0;
    return json(await mlbLineups(date).catch((e) => ({ days: {}, error: String(e) })), { "cache-control": "max-age=90" });
  }
  if (!BUILD[sport]) return json({ error: "sport must be nba, nfl, mlb or nhl" }, {}, 400);
  if (q.get("games")) {
    const ids = [...new Set(String(q.get("games")).split(",").map((x) => x.trim()).filter((x) => /^\d{1,12}$/.test(x)))].slice(0, 20);
    return json(await gamesFor(sport, ids).catch((e) => ({ games: {}, error: String(e) })), { "cache-control": "max-age=30" });
  }
  try {
    return json(await liveData(sport), { "cache-control": "max-age=30" });
  } catch (e) {
    return json({ error: String(e) }, {}, 502);
  }
});
