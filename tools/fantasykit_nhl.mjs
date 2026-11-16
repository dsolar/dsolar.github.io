#!/usr/bin/env node
// NHL player pool, full-season workload forecasts, and real Monday–Sunday box scores.
// No paid feed: NHL.com statistics and the NHL hub's attributed open contract data.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SK_COLS, GOALIE_COLS, NHL_LINES, gameState, boxLines, mergeLines, finishLines, goalieRates } from "../supabase/functions/fk-live/nhl.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = "fantasy-kit/data/", CACHE = "tools/nhl_fantasy/games.json";
const UA = "davidsolar-fantasykit/1.0 (+https://davidsolar.dev/fantasy-kit/)";
const read = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")); } catch { return fallback; } };
function write(file, data) { const full = path.join(ROOT, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, JSON.stringify(data)); }
async function get(url) {
  let last;
  for (let n = 0; n < 2; n++) {
    try { const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { last = e; if (!n) await new Promise((r) => setTimeout(r, 300)); }
  }
  throw new Error(`${url}: ${last.message}`);
}
async function pool(items, count, fn) {
  let next = 0; const out = [];
  await Promise.all(Array.from({ length: Math.min(items.length, count) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}
const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monday = (day) => addDays(day, -((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7));
const nyDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const round = (x, n = 3) => Math.round((Number(x) || 0) * 10 ** n) / 10 ** n;
const seasonLabel = (year) => `${year}-${String(year + 1).slice(2)}`;
const position = (p) => ({ L: "LW", R: "RW" }[p] || p);

async function report(kind, name, year) {
  const rows = [];
  for (let start = 0; ;) {
    const q = new URLSearchParams({ isAggregate: "false", isGame: "false", start: String(start), limit: "1000", cayenneExp: `gameTypeId=2 and seasonId=${year}${year + 1}` });
    const d = await get(`https://api.nhle.com/stats/rest/en/${kind}/${name}?${q}`);
    if (!Array.isArray(d.data)) throw new Error(`Bad NHL ${kind}/${name} report`);
    rows.push(...d.data);
    if (rows.length >= (d.total ?? rows.length) || !d.data.length) return rows;
    start += d.data.length; // NHL caps a page at 100 even when a larger limit is requested.
  }
}
const byId = (rows) => Object.fromEntries(rows.map((x) => [String(x.playerId), x]));
function skaterLine(x = {}, rt = {}) {
  return [x.gamesPlayed || 0, x.goals || 0, x.assists || 0, x.points || 0, x.plusMinus || 0, x.penaltyMinutes || 0,
    x.ppPoints || 0, x.ppGoals || 0, x.shPoints || 0, x.shots || 0, rt.hits || 0, rt.blockedShots || 0, (x.timeOnIcePerGame || 0) * (x.gamesPlayed || 0) / 60];
}
function goalieLine(x = {}) {
  return goalieRates([x.gamesPlayed || 0, x.gamesStarted || 0, x.wins || 0, x.losses || 0, x.otLosses || 0, x.saves || 0,
    x.shotsAgainst || 0, x.goalsAgainst || 0, x.shutouts || 0, (x.timeOnIce || 0) / 60, 0, 0]);
}
export function forecast(cur, prev, cols, teamGames, goalie) {
  const ix = (k) => cols.indexOf(k), gp = cur?.[ix("gp")] || 0, pg = prev?.[ix("gp")] || 0;
  // Last year's rates count like at most 20 skater games or 15 goalie games.
  const prior = Math.min(pg, goalie ? 15 : 20), denominator = gp + prior;
  // Workload is a share of the club's 82 games. A backup is not projected for 82 starts.
  const strength = goalie ? 18 : 20, share = (gp + strength * pg / 82) / Math.max(1, teamGames + strength);
  const games = Math.max(gp, Math.min(goalie ? 65 : 82, 82 * share));
  const row = cols.map((col, i) => col === "gp" ? games : ["gaa", "svp"].includes(col) ? 0 : denominator ? ((cur?.[i] || 0) + (pg ? (prev?.[i] || 0) / pg * prior : 0)) / denominator * games : 0);
  return (goalie ? goalieRates(row) : row).map((x) => round(x));
}

function contractOf(p, hub) {
  const k = p?.k;
  if (!k || (!k.years?.length && k.cap == null)) return null;
  return { capHit: k.cap ?? null, aav: k.aav ?? null, term: k.term ?? null, total: k.total ?? null,
    end: k.end != null ? seasonLabel(k.end) : null, expiry: k.exp || null, clause: k.clause || null,
    estimated: !!k.est, source: "nhl-contracts (CC0)", updated: hub.money?.updated || hub.built,
    seasons: (k.years || []).map(([year, capHit, salary, signingBonus, performanceBonus, war, marketValue, retained]) => ({
      season: seasonLabel(year), capHit: capHit ?? null, salary: salary ?? null, signingBonus: signingBonus ?? null,
      performanceBonus: performanceBonus ?? null, war: war ?? null, marketValue: marketValue ?? null, retained: !!retained,
    })) };
}

export async function buildPool() {
  const hub = read("nhl/data/hub.json");
  if (!hub?.players?.length) throw new Error("Build the NHL hub before the fantasy pool");
  const year = Number(hub.season.slice(0, 4));
  const reports = await pool([["skater", "summary", year], ["skater", "realtime", year], ["goalie", "summary", year],
    ["skater", "summary", year - 1], ["skater", "realtime", year - 1], ["goalie", "summary", year - 1]], 3, async (args) => byId(await report(...args)));
  const [sk, rt, goalies, oldSk, oldRt, oldG] = reports;
  if (Object.keys(sk).length < 500 || Object.keys(goalies).length < 50) throw new Error("Incomplete NHL player reports; keeping the last pool");
  const known = Object.fromEntries(hub.players.map((p) => [String(p.id), p])), teams = Object.fromEntries(hub.teams.map((t) => [t.abbr, t]));
  const ltir = new Set((read("tools/nhl_hub/contracts.json", {}).ltir || []).map((p) => String(p.player_id)));
  const players = [];
  for (const id of new Set([...Object.keys(known), ...Object.keys(sk), ...Object.keys(goalies)])) {
    const p = known[id], g = goalies[id], s = sk[id], isG = !!g || p?.pos === "G";
    const row = isG ? g : s, old = isG ? oldG[id] : oldSk[id];
    const team = p?.team || String(row?.teamAbbrevs || "FA").split(",").pop().trim();
    if (!teams[team]) continue;
    const line = isG ? "goalie" : "sk", cols = NHL_LINES[line], cur = isG ? goalieLine(row) : skaterLine(row, rt[id]);
    const prev = isG ? goalieLine(old) : skaterLine(old, oldRt[id]);
    const pr = forecast(cur, prev, cols, teams[team].rec.gamesPlayed, isG);
    const ps = position(p?.pos || row?.positionCode || (isG ? "G" : "C"));
    const out = { id, n: p?.name || row?.skaterFullName || row?.goalieFullName, t: team, pos: [ps],
      age: p?.age || undefined, head: p?.head || `https://assets.nhle.com/mugs/nhl/${year}${year + 1}/${team}/${id}.png`,
      l: { [line]: cur.map((x) => round(x)), ["p" + line]: pr }, l0: { [line]: prev.map((x) => round(x)) }, projGames: pr[0] };
    if (!old?.gamesPlayed && (p?.age || 40) <= 25) out.rk = 1;
    if (ltir.has(id)) out.inj = "IR";
    const contract = contractOf(p, hub); if (contract) out.contract = contract;
    players.push(out);
  }
  const lines = { sk: { label: "Skaters: season totals", cols: SK_COLS }, goalie: { label: "Goalies: season totals", cols: GOALIE_COLS },
    psk: { label: "Workload projection, skaters", cols: SK_COLS, proj: true }, pgoalie: { label: "Workload projection, goalies", cols: GOALIE_COLS, proj: true } };
  const data = { sport: "nhl", season: hub.season, prev: seasonLabel(year - 1), updated: new Date().toISOString(),
    source: "NHL.com season statistics; contracts: nhl-contracts (CC0)",
    projection: "Full-season workload forecast: current-season rates blended with last season, with separate goalie workloads. Positions use NHL primary roster positions.", lines, players };
  write(DATA + "nhl.json", data);
  console.log(`NHL pool: ${players.length} players, ${players.filter((p) => p.pos.includes("G")).length} goalies, ${players.filter((p) => p.contract?.capHit != null).length} cap hits`);
  return data;
}

export async function buildWeeks(season) {
  const year = Number(season.slice(0, 4)), today = nyDay(), stamp = new Date().toISOString();
  const snapshot = read("tools/nhl_hub/schedule.json", []);
  const first = snapshot.filter((g) => String(g.id).startsWith(`${year}02`)).map((g) => g.date).sort()[0];
  if (!first) throw new Error("NHL regular-season schedule is missing");
  const starts = []; for (let day = monday(first); day <= monday(today); day = addDays(day, 7)) starts.push(day);
  const schedules = await pool(starts, 3, async (day) => {
    const data = await get(`https://api-web.nhle.com/v1/schedule/${day}`);
    if (!Array.isArray(data.gameWeek)) throw new Error(`Missing NHL schedule for ${day}`);
    return data.gameWeek.flatMap((d) => (d.games || []).filter((g) => g.gameType === 2 && Number(g.season) === Number(`${year}${year + 1}`)).map((g) => ({ ...g, day: d.date })));
  });
  const schedule = [...new Map(schedules.flat().map((g) => [String(g.id), g])).values()].filter((g) => g.day <= addDays(monday(today), 6));
  const old = read(CACHE, {}), games = old.season === season ? old.games || {} : {};
  const fetchGames = schedule.filter((g) => ["post", "in"].includes(gameState(g)) && (!games[g.id]?.final || g.day >= addDays(today, -2)));
  const errors = [];
  await pool(fetchGames, 6, async (g, i) => {
    try {
      const [box, landing] = await Promise.all([get(`https://api-web.nhle.com/v1/gamecenter/${g.id}/boxscore`), get(`https://api-web.nhle.com/v1/gamecenter/${g.id}/landing`)]);
      games[g.id] = { day: g.day, at: g.startTimeUTC, final: gameState(box) === "post", lines: boxLines(box, landing) };
    } catch (e) { errors.push(`${g.id}: ${e.message}`); }
    if ((i + 1) % 50 === 0) console.log(`NHL games imported: ${i + 1}/${fetchGames.length}`);
  });
  // Failed reads keep old snapshots. A missing final box prevents its week from closing.
  write(CACHE, { season, updated: stamp, games });
  const weeks = {}, dayWeeks = {};
  for (const [i, start] of starts.entries()) {
    const end = addDays(start, 6), gs = schedule.filter((g) => g.day >= start && g.day <= end && gameState(g) !== "off"), total = {}, days = {};
    for (const g of gs) {
      const row = games[g.id]; if (!row) continue;
      mergeLines(total, row.lines);
      const d = Math.round((Date.parse(g.day + "T12:00:00Z") - Date.parse(start + "T12:00:00Z")) / 864e5);
      mergeLines(days[d] ||= {}, row.lines);
    }
    const final = Date.now() >= Date.parse(addDays(end, 1) + "T08:00:00Z") && gs.every((g) => gameState(g) === "post" && games[g.id]?.final);
    weeks[i + 1] = { start, end, final, lines: finishLines(total) };
    dayWeeks[i + 1] = { start, end, final, days: Object.fromEntries(Object.entries(days).map(([d, ls]) => [d, finishLines(ls)])) };
  }
  const meta = { sport: "nhl", season, updated: stamp, source: "NHL.com game box scores and scoring summaries", lines: NHL_LINES };
  if (errors.length) meta.errors = errors;
  write(DATA + "weeks-nhl.json", { ...meta, weeks });
  write(DATA + "days-nhl.json", { ...meta, weeks: dayWeeks });
  console.log(`NHL scoring: ${Object.keys(games).length} games, ${Object.keys(weeks).length} weeks, ${Object.values(weeks).filter((w) => w.final).length} final${errors.length ? `; ${errors.length} failed reads` : ""}`);
  if (errors.length) throw new Error(errors.slice(0, 3).join("; "));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const data = process.argv.includes("--weeks-only") ? read(DATA + "nhl.json") : await buildPool();
    if (!process.argv.includes("--pool-only")) await buildWeeks(data.season);
  } catch (e) { console.error(`NHL import failed: ${e.message}`); process.exitCode = 1; }
}
