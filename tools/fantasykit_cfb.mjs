#!/usr/bin/env node
// College football for Draft Lab: the player pool (fantasy-kit/data/cfb.json) and real weekly box scores
// (fantasy-kit/data/weeks-cfb.json), from ESPN's box score for every FBS game.
//
// The schedule and teams come from the College Football Hub (cfb/data/hub.json, tools/cfb_build.py): FBS schools with
// their conferences, every game with its week. Regular-season weeks are ESPN's (Monday to Sunday, week 1 the long
// opening stretch); the postseason after conference championship week is split into Monday-to-Sunday weeks from 16 on.
// Box scores go through fk-live's cfbBox, so the nightly file and the live feed read them the same way.
//
// The pool is quarterbacks, running backs, receivers, tight ends and kickers on FBS teams, plus each FBS team's
// defense (id = its abbreviation), with season totals summed from the weeks. Positions come from the hub's player
// file where it has them, else from the box score. A week is final the morning after its last day once every game in
// it is over; final weeks are kept and never fetched again, and open weeks' games are cached in
// tools/cfb_fantasy/games.json. tools/cfb_fantasy/people.json keeps each player's name, school and position.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CFB_COLS, CFB_ESPN, cfbBox, addInto } from "../supabase/functions/fk-live/cfb.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POOL = "fantasy-kit/data/cfb.json", WEEKS = "fantasy-kit/data/weeks-cfb.json";
const CACHE = "tools/cfb_fantasy/games.json", PEOPLE = "tools/cfb_fantasy/people.json";
// ESPN turns away requests that don't look like a browser
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
export const FANTASY_POS = ["QB", "RB", "WR", "TE", "K"];
// bump when cfbBox reads a box score differently, so every week is fetched again
const VERSION = 2;
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
const nyDay = (t = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
const IX = Object.fromEntries(CFB_COLS.map((c, i) => [c, i]));

// the fantasy weeks: { key: { start, end } } from the hub's regular-season weeks, then the postseason in 7-day weeks
export function fantasyWeeks(hub) {
  const out = {};
  const reg = (hub.weeks || []).filter((w) => w.type === 2);
  for (const w of reg) out[w.week] = { start: nyDay(new Date(w.start)), end: nyDay(new Date(Date.parse(w.end) - 6 * 36e5)) };   // ESPN ends a week early Monday, Eastern
  const last = reg.length ? out[reg[reg.length - 1].week] : null;
  const postStart = last ? addDays(last.end, 1) : null;
  const weekOf = (g) => {
    if (!g.post) return out[g.week] ? String(g.week) : null;
    if (!postStart || g.day < postStart) return null;
    return String((reg.length ? reg[reg.length - 1].week : 15) + 1 + Math.floor((Date.parse(g.day + "T12:00:00Z") - Date.parse(postStart + "T12:00:00Z")) / 6048e5));
  };
  for (const g of hub.games || []) {
    const k = weekOf(g); if (!k || out[k]) continue;
    const i = Number(k) - (reg.length ? reg[reg.length - 1].week : 15) - 1, start = addDays(postStart, 7 * i);
    out[k] = { start, end: addDays(start, 6) };
  }
  return { weeks: out, weekOf };
}
// a player's fantasy position: the hub's roster position, else the box score's, else what he did
export function positionOf(hubPos, boxPos, line) {
  const m = { FB: "RB", HB: "RB", PK: "K", K: "K", QB: "QB", RB: "RB", WR: "WR", TE: "TE" };
  if (m[hubPos]) return m[hubPos];
  if (m[boxPos]) return m[boxPos];
  if (!line) return null;
  if (line[IX.fga] || line[IX.xpm] || line[IX.xpmiss]) return "K";
  if (line[IX.pass_att] >= 10) return "QB";
  if (line[IX.rush_att] > line[IX.rec] && line[IX.rush_att] >= 3) return "RB";
  if (line[IX.rec] > 0) return "WR";
  return null;
}

async function main() {
  const hub = read("cfb/data/hub.json");
  if (!hub || !Array.isArray(hub.games)) { console.log("No cfb/data/hub.json"); return; }
  const season = String(hub.season);
  const teams = Object.fromEntries((hub.teams || []).map((t) => [t.abbr, t]));
  const hubPlayers = Object.fromEntries(((read("cfb/data/players.json", {}) || {}).players || []).map((p) => [String(p.id), p]));
  const { weeks: W, weekOf } = fantasyWeeks(hub);
  const today = nyDay(), yesterday = addDays(today, -1);
  const old = read(WEEKS, {}) || {};
  const same = String(old.season) === season && old.v === VERSION && JSON.stringify(old.cols) === JSON.stringify(CFB_COLS);
  const kept = same ? old.weeks || {} : {};
  const cacheFile = read(CACHE, {}) || {};
  const cache = cacheFile.season === season && cacheFile.v === VERSION && JSON.stringify(cacheFile.cols) === JSON.stringify(CFB_COLS) ? cacheFile.games || {} : {};
  const people = (read(PEOPLE, {}) || {}).season === season ? read(PEOPLE).people || {} : {};
  const byWeek = {};
  for (const g of hub.games) { const k = weekOf(g); if (k) (byWeek[k] = byWeek[k] || []).push(g); }
  const weeks = {}, nextCache = {};
  let fetched = 0;
  const keys = Object.keys(W).sort((a, b) => a - b);
  const isFbs = (ab) => !!teams[ab];
  for (const k of keys) {
    const { start, end } = W[k];
    if (kept[k]?.final) { weeks[k] = kept[k]; continue; }
    if (start > addDays(today, 7)) continue;
    const games = byWeek[k] || [];
    const finals = games.filter((g) => g.state === "post").map((g) => String(g.id));
    const need = finals.filter((id) => !cache[id]);
    const boxes = await pool(need, 8, (id) => get(`${CFB_ESPN}/summary?event=${id}`).then((s) => (fetched++, cfbBox(s))).catch((e) => (console.error(String(e.message || e).slice(0, 160)), null)));
    need.forEach((id, i) => {
      const b = boxes[i]; if (!b || b.state !== "post") return;
      // keep FBS players at fantasy positions, and FBS defenses
      const lines = {};
      for (const [pid, l] of Object.entries(b.lines)) {
        const ab = b.team[pid]; if (!isFbs(ab)) continue;
        const hp = hubPlayers[pid], ps = positionOf(hp && hp.pos, b.pos[pid], l);
        if (!FANTASY_POS.includes(ps)) continue;
        lines[pid] = l;
        people[pid] = [b.names[pid] || (hp && hp.name) || pid, ab, ps];
      }
      for (const [ab, l] of Object.entries(b.def)) if (isFbs(ab)) lines[ab] = l;
      cache[id] = lines;
    });
    const acc = {};
    for (const id of finals) if (cache[id]) addInto(acc, cache[id]);
    const done = games.length > 0 && games.every((g) => g.state === "post" || /postpon|cancel/i.test(g.note || "") || g.state === "off") && finals.every((id) => cache[id]);
    const final = done && yesterday >= end;
    weeks[k] = { start, end, final, lines: acc };
    if (!final) for (const id of finals) if (cache[id]) nextCache[id] = cache[id];
  }
  write(WEEKS, { sport: "cfb", v: VERSION, season, updated: new Date().toISOString(), source: "ESPN box scores, every FBS game", line: "tot", cols: CFB_COLS, weeks });
  write(CACHE, { season, v: VERSION, cols: CFB_COLS, games: nextCache });
  write(PEOPLE, { season, people });

  // the pool: season totals from the weeks
  const tot = {};
  for (const w of Object.values(weeks)) addInto(tot, w.lines);
  const players = [];
  for (const [id, l] of Object.entries(tot)) {
    if (teams[id]) {
      const t = teams[id];
      players.push({ id, n: t.short, t: id, pos: ["DEF"], l: { tot: l }, school: t.short });
      continue;
    }
    const pp = people[id]; if (!pp || !teams[pp[1]]) continue;
    const hp = hubPlayers[id] || {};
    const rec = { id, n: pp[0], t: pp[1], pos: [pp[2]], l: { tot: l }, espn: id, school: teams[pp[1]].short };
    if (hp.year) rec.yr = String(hp.year).slice(0, 2);
    players.push(rec);
  }
  const poolOut = { sport: "cfb", season, updated: new Date().toISOString(), source: "ESPN box scores of every FBS game, schedule and conferences from the College Football Hub",
    lines: { tot: { label: "Season totals", cols: CFB_COLS } },
    teams: Object.fromEntries(Object.entries(teams).map(([ab, t]) => [ab, { n: t.short, c: t.color, logo: t.logo, conf: t.conference }])),
    players };
  write(POOL, poolOut);
  const fin = Object.values(weeks).filter((w) => w.final).length;
  console.log(`Wrote ${WEEKS}: ${Object.keys(weeks).length} weeks, ${fin} final (${fetched} box scores fetched); ${POOL}: ${players.length} players`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
