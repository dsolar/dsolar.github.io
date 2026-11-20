// Daily check that every NBA Hub feed is still updating. Prints each feed's age and exits 1 (failing the workflow, which
// emails the repo owner) when any has gone stale. Run from the repo root: node tools/nba_fresh.mjs
import { readFileSync } from 'node:fs'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Fresh = require('../nba/lib/fresh.js');
const files = {};
for (const f of Fresh.files) { try { files[f] = JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8')); } catch { files[f] = null; } }
const rows = Fresh.check(files, Date.now());
for (const r of rows) console.log((r.stale ? 'STALE ' : 'ok    ') + r.label.padEnd(26) + (r.when || 'missing').padEnd(28) + (r.age == null ? '' : r.age.toFixed(1) + 'd (max ' + r.max + ')') + '  ' + r.how);
for (const r of rows.filter(r => r.stale && r.manual)) console.log(`::warning title=NBA feed behind (warning only)::${r.label} last updated ${r.when || 'never'} (${r.file})`);
const bad = rows.filter(r => r.stale && !r.manual);
if (bad.length) { for (const r of bad) console.log(`::error title=Stale NBA feed::${r.label} last updated ${r.when || 'never'} (${r.file}, refreshed by the ${r.how} workflow)`); process.exit(1); }
