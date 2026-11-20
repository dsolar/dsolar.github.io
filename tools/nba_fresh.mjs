// Daily check that every NBA Hub and NFL Hub feed is still updating. Prints each feed's age and exits 1 (failing the workflow, which
// emails the repo owner) when any has gone stale. Run from the repo root: node tools/nba_fresh.mjs
import { readFileSync } from 'node:fs'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Fresh = require('../nba/lib/fresh.js');
const files = {};
for (const f of Fresh.files.concat(Fresh.nflFiles, Fresh.siteFiles || [])) { try { files[f] = JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8')); } catch { files[f] = null; } }
// the NBA Hub's feeds, then the NFL Hub's (NFL game feeds go quiet from February to August, so they count only in season)
const nflSeason = (() => { const d = new Date(), m = d.getUTCMonth() + 1; return m >= 9 || m === 1; })();
const rows = Fresh.check(files, Date.now()).map(r => Object.assign(r, { label: 'NBA: ' + r.label }))
  .concat(Fresh.check(files, Date.now(), Fresh.NFL).map(r => Object.assign(r, { label: 'NFL: ' + r.label, stale: r.stale && (nflSeason || r.manual) })))
  .concat(Fresh.check(files, Date.now(), Fresh.SITE || []).map(r => Object.assign(r, { label: 'Site: ' + r.label })));
// player faces: a league whose share of names with a photo falls under 85% warns (a source list changed shape, say)
const faces = files['assets/faces/report.json'];
for (const [k, s] of Object.entries((faces && faces.sports) || {})) {
  const pct = s.shown ? s.found / s.shown : 1;
  console.log(`faces ${k.padEnd(6)} ${s.found}/${s.shown} with a photo (${Math.round(100 * pct)}%), ${(s.shared || []).length} shared names`);
  if (s.shown >= 50 && pct < 0.85) console.log(`::warning title=Player faces coverage dropped::${k}: ${s.found} of ${s.shown} names have a photo (${Math.round(100 * pct)}%). See davidsolar.dev/faces/`);
}
for (const r of rows) console.log((r.stale ? 'STALE ' : 'ok    ') + r.label.padEnd(44) + (r.when || 'missing').padEnd(28) + (r.age == null ? '' : r.age.toFixed(1) + 'd (max ' + r.max + ')') + '  ' + r.how);
for (const r of rows.filter(r => r.stale && r.manual)) console.log(`::warning title=Data feed behind (warning only)::${r.label} last updated ${r.when || 'never'} (${r.file})`);
const bad = rows.filter(r => r.stale && !r.manual);
if (bad.length) { for (const r of bad) console.log(`::error title=Stale data feed::${r.label} last updated ${r.when || 'never'} (${r.file}, refreshed by the ${r.how} workflow)`); process.exit(1); }
