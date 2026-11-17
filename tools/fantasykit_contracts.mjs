// Real contracts for Draft Lab's Hard Cap mode: fantasy-kit/data/contracts-nba.json and contracts-nhl.json.
//   { sport, season: "2026-27", year: 2026, cap, min, players: { id: [salary this season, next season, ...] } }
// NBA: the shared library's latest contracts (nba/lib/contracts.js: the cap sheet in celtics/data.json, the nightly
// Basketball-Reference and ESPN pulls in hardcap/stats.json, the hand fixes in hardcap/contracts.json), standard
// deals only, ids the same slugs as data/nba.json. NHL: the NHL hub's cap hits (nhl/data/hub.json), NHL ids.
// A salary of 0 ends the contract: a player whose array runs out is a free agent after the last season in it.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = new URL('../', import.meta.url);
const read = (f) => { try { return JSON.parse(readFileSync(new URL(f, ROOT), 'utf8')); } catch { return null; } };
const OUT = (f) => new URL(`fantasy-kit/data/${f}`, ROOT);

export function nbaContracts(nba, stats, fixes, NC) {
  const latest = NC.latestContracts(nba, stats, fixes);
  const players = {};
  for (const p of latest.players) {
    const sal = (p.c && p.c.sal) || [];
    if (!sal[0] || p.two || p.noDeal || p.limbo || p.deal) continue;
    const run = [];
    for (const x of sal) { if (!(x > 0)) break; run.push(Math.round(x)); }
    if (run.length) players[p.id] = run;
  }
  const cba = nba.cba || {};
  const y0 = parseInt(String(cba.season0 || '').slice(0, 4), 10);
  return { sport: 'nba', season: cba.season0, year: y0, cap: cba.cap, min: (cba.min_scale || [])[0] || 1157000, players };
}

export function nhlContracts(hub) {
  const year = parseInt(String(hub.season || '').slice(0, 4), 10) || Math.min(...hub.players.flatMap((p) => (p.k && p.k.years ? p.k.years.map((y) => y[0]) : [])));
  const season = `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
  const players = {};
  for (const p of hub.players) {
    const ys = (p.k && p.k.years) || [];
    const by = Object.fromEntries(ys.map((y) => [y[0], y[1]]));
    const run = [];
    for (let y = year; by[y] > 0; y++) run.push(Math.round(by[y]));
    if (run.length) players[String(p.id)] = run;
  }
  const m = hub.money || {};
  return { sport: 'nhl', season, year, cap: (m.caps || {})[season] || null, min: m.minSalary || 775000, players };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const updated = new Date().toISOString().slice(0, 19) + 'Z';
  const nba = read('celtics/data.json'), stats = read('hardcap/stats.json'), fixes = read('hardcap/contracts.json');
  if (nba) {
    const out = Object.assign(nbaContracts(nba, stats, fixes, require('../nba/lib/contracts.js')), { updated, source: 'NBA cap sheet, Basketball-Reference, ESPN' });
    writeFileSync(OUT('contracts-nba.json'), JSON.stringify(out));
    console.log(`Wrote contracts-nba.json: ${Object.keys(out.players).length} contracts, cap ${out.cap}`);
  }
  const hub = read('nhl/data/hub.json');
  if (hub) {
    const out = Object.assign(nhlContracts(hub), { updated, source: 'NHL hub (PuckPedia-style cap hits)' });
    writeFileSync(OUT('contracts-nhl.json'), JSON.stringify(out));
    console.log(`Wrote contracts-nhl.json: ${Object.keys(out.players).length} contracts, cap ${out.cap}`);
  }
}
