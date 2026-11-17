#!/usr/bin/env node
// College basketball's real Monday-Sunday weeks for season-long leagues (fantasy-kit/data/weeks-cbb.json).
//
// Every Division I game on ESPN's college scoreboard, box scores from ESPN's summary in the NBA's columns
// (fk-live's cbbBox, so the nightly file and the live feed read a box score the same way), keyed by ESPN athlete id.
// Only players in the pool (cbb.json) are kept, which keeps the file to the players a league can roster.
// Weeks run from the Monday on or before Nov 2, the numbering the CBB Hub's one-day games use. A week is final the
// morning after its last game once every game in it is over; final weeks are kept and never fetched again. Games in
// open weeks are cached in tools/cbb_fantasy/games.json so each run fetches only the games it hasn't seen finish.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CBB_COLS, cbbBox } from "../supabase/functions/fk-live/cbb.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "fantasy-kit/data/weeks-cbb.json", CACHE = "tools/cbb_fantasy/games.json";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
// ESPN turns away requests that don't look like a browser (fk-live found the same)
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const read = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")); } catch { return fallback; } };
function write(file, data) { const full = path.join(ROOT, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, JSON.stringify(data) + "\n"); }
async function get(url) {
  let last;
  for (let n = 0; n < 3; n++) {
    try { const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { last = e; await new Promise((r) => setTimeout(r, 400 * (n + 1))); }
  }
  throw new Error(`${url}: ${last.message}`);
}
async function pool(items, count, fn) {
  let next = 0; const out = [];
  await Promise.all(Array.from({ length: Math.min(items.length, count) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}
export const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const monday = (day) => addDays(day, -((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7));
const nyDay = (t = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);

// week 1 starts the Monday on or before Nov 2 of the season's first year
export const firstMonday = (season) => monday(`${parseInt(season, 10)}-11-02`);
export const weekOf = (day, first) => Math.floor((Date.parse(day + "T12:00:00Z") - Date.parse(first + "T12:00:00Z")) / 864e5 / 7) + 1;

// a scoreboard event: final, still to come, or called off (postponed and canceled games never count against "done")
export function eventState(e) {
  const t = e?.status?.type || {};
  if (/postpon|cancel|forfeit/i.test(`${t.name || ""} ${t.description || ""}`)) return "off";
  return t.completed || t.state === "post" ? "final" : "open";
}

// sums box-score lines into a week's lines; minutes to a whole number, the rest are counts
export function addLines(acc, box, keep) {
  for (const [id, line] of Object.entries(box)) {
    if (keep && !keep.has(id)) continue;
    const a = acc[id];
    acc[id] = a ? a.map((x, i) => x + (line[i] || 0)) : line.slice();
  }
  return acc;
}
export const tidy = (lines) => Object.fromEntries(Object.entries(lines).map(([id, l]) => [id, l.map((x) => Math.round(x))]));

export async function main(today = nyDay()) {
  const poolFile = read("fantasy-kit/data/cbb.json");
  if (!poolFile || !Array.isArray(poolFile.players)) { console.log("No cbb.json pool"); return; }
  const season = String(poolFile.season || "");
  const keep = new Set(poolFile.players.map((p) => String(p.id)));
  const first = firstMonday(season), yesterday = addDays(today, -1);
  const old = read(OUT, {}) || {};
  const same = String(old.season) === season && JSON.stringify(old.cols) === JSON.stringify(CBB_COLS);
  const kept = same ? old.weeks || {} : {};
  const cacheFile = read(CACHE, {}) || {};
  const cache = cacheFile.season === season && JSON.stringify(cacheFile.cols) === JSON.stringify(CBB_COLS) ? cacheFile.games || {} : {};
  const nowWeek = Math.max(1, weekOf(today, first));
  const weeks = {}, nextCache = {};
  let fetched = 0, boards = 0;
  for (let k = 1; k <= nowWeek + 1; k++) {
    const start = addDays(first, 7 * (k - 1)), end = addDays(start, 6);
    if (kept[k]?.final) { weeks[k] = kept[k]; continue; }
    if (start > today) { weeks[k] = { start, end, final: false, lines: {} }; continue; }
    // the week's days through today: one scoreboard each (groups=50 is Division I, limit=400 every game)
    const days = []; for (let d = start; d <= end && d <= today; d = addDays(d, 1)) days.push(d);
    const lists = await pool(days, 4, (d) => get(`${ESPN}/scoreboard?dates=${d.replace(/-/g, "")}&groups=50&limit=400`).then((b) => (boards++, b.events || [])).catch((e) => (console.error(String(e.message || e).slice(0, 200)), null)));
    const events = [], broke = lists.some((x) => x === null);
    lists.forEach((list) => { for (const e of list || []) events.push(e); });
    const finals = events.filter((e) => eventState(e) === "final").map((e) => String(e.id));
    const need = finals.filter((id) => !cache[id]);
    const boxes = await pool(need, 8, (id) => get(`${ESPN}/summary?event=${id}`).then((s) => (fetched++, cbbBox(s))).catch(() => null));
    need.forEach((id, i) => { if (boxes[i] && Object.keys(boxes[i]).length) cache[id] = tidy(addLines({}, boxes[i], keep)); });
    const acc = {};
    for (const id of finals) if (cache[id]) addLines(acc, cache[id]);
    const done = !broke && end < today && events.every((e) => eventState(e) !== "open") && finals.every((id) => cache[id]);
    // final the morning after the week's last day: by the time the nightly run sees a later day, it's past
    const final = done && yesterday >= end;
    weeks[k] = { start, end, final, lines: tidy(acc) };
    if (!final) for (const id of finals) if (cache[id]) nextCache[id] = cache[id];
  }
  write(OUT, { sport: "cbb", season, updated: new Date().toISOString(), source: "ESPN box scores, every Division I game", line: "pg", cols: CBB_COLS, weeks });
  write(CACHE, { season, cols: CBB_COLS, games: nextCache });
  const fin = Object.values(weeks).filter((w) => w.final).length;
  console.log(`Wrote ${OUT}: ${Object.keys(weeks).length} weeks, ${fin} final (${boards} scoreboards, ${fetched} box scores fetched)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
