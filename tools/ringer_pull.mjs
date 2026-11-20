// Pulls the Ringer's NBA Top 100 (theringer.com/nba-ranked/top-100) into nba/data/ringer100.json for the NBA Hub's
// value rating and Rankings tab. The page is server-rendered: every player is a card whose name links to
// /nba-ranked/top-100/<slug>, in rank order. Writes only when it finds exactly 100 different players; otherwise it
// leaves the file alone and exits 1 so the workflow fails (and emails). --dry prints instead of writing.
import { readFileSync, writeFileSync } from 'node:fs';
const URL_ = 'https://theringer.com/nba-ranked/top-100', OUT = new URL('../nba/data/ringer100.json', import.meta.url);
const dry = process.argv.includes('--dry');
const r = await fetch(URL_, { headers: { 'user-agent': 'Mozilla/5.0 (davidsolar.dev data refresh)' } });
if (!r.ok) { console.log(`::error title=Ringer Top 100::HTTP ${r.status}`); process.exit(1); }
const html = await r.text();
const dec = s => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;|&rsquo;|’/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const seen = new Set(), players = [];
for (const m of html.matchAll(/href="\/nba-ranked\/top-100\/([a-z0-9-]+)"[^>]*>([^<]{3,60})<\/a>\s*<\/h2>/g)) {
  if (seen.has(m[1])) continue; seen.add(m[1]); players.push({ rk: players.length + 1, n: dec(m[2]) });
}
// the article's own date, when it says
let updated = new Date().toISOString().slice(0, 10);
for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
  try { const j = JSON.parse(m[1]); const d = j.dateModified || j.datePublished; if (d) { updated = String(d).slice(0, 10); break; } } catch { /* not JSON */ }
}
console.log('found', players.length, 'updated', updated);
console.log(players.slice(0, 5).map(p => p.rk + ' ' + p.n).join(', '), '...', players.slice(-3).map(p => p.rk + ' ' + p.n).join(', '));
if (players.length !== 100) { console.log(`::error title=Ringer Top 100::found ${players.length} players, expected 100; the page may have changed`); process.exit(1); }
let old = null; try { old = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* first run */ }
const same = old && old.players && old.players.length === 100 && old.players.every((p, i) => p.n === players[i].n);
if (same) { console.log('no change'); process.exit(0); }
const out = { title: "The Ringer's Top 100 NBA Players", updated, url: URL_, by: ['The Ringer NBA staff'], pulled: new Date().toISOString().slice(0, 10), players };
if (dry) { console.log('would write (dry run)'); process.exit(0); }
writeFileSync(OUT, JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log('wrote', OUT.pathname);
