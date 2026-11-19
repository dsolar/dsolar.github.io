// Scores the MLB hub's trade values against a sample of Baseball Trade Values (tools/mlb/btv-sample.json, pasted from
// BTV's player pages and trade boards, Nov 2026). Run: node tools/mlb_btv_cal.js
const R = require('path').resolve(__dirname, '..');
const M = require(R + '/mlb/model.js'); const hub = require(R + '/mlb/data/hub.json'); const fa = require(R + '/mlb/data/fa.json');
const btv = require(R + '/tools/mlb/btv-sample.json');
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/ (jr|sr|ii|iii)$/, '').trim();
function score(o = {}, show = false) {
  const H = new M.Hub(JSON.parse(JSON.stringify(hub)), JSON.parse(JSON.stringify(fa)), Object.assign({ sims: 20 }, o));
  const by = new Map(H.players.map((p) => [norm(p.n), p]));
  let err = 0, k = 0; const rows = [], miss = [];
  for (const [n, b] of Object.entries(btv)) {
    const p = by.get(norm(n)); if (!p) { miss.push(n); continue; }
    const v = H.surplus(p).pv; const grp = p.lvl && p.lvl !== 'MLB' ? 'prospect' : (p.st || 0) < 3 ? 'pre-arb' : (p.st || 0) < 6 && !(p.c && p.c.yrs > 1 && /Extension|Free/i.test(p.c.type||'')) ? 'arb' : 'contract';
    rows.push({ n, b, v, grp }); err += Math.abs(v - b); k++;
  }
  const g = {}; for (const r of rows) { (g[r.grp] = g[r.grp] || { n: 0, h: 0, b: 0 }); g[r.grp].n++; g[r.grp].h += r.v; g[r.grp].b += r.b; }
  if (show) {
    console.log('matched', k, 'missing', miss.join(', '));
    console.log('MAE', (err / k).toFixed(1)); for (const [x, s] of Object.entries(g)) console.log(x.padEnd(9), s.n, 'hub', (s.h / s.n).toFixed(1), 'btv', (s.b / s.n).toFixed(1));
    rows.sort((a, b) => Math.abs(b.v - b.b) - Math.abs(a.v - a.b)).slice(0, 18).forEach((r) => console.log(' ', r.n.padEnd(22), r.grp.padEnd(9), 'hub', r.v.toFixed(1).padStart(7), 'btv', String(r.b).padStart(6)));
  }
  return { mae: err / k, rows, g };
}
module.exports = { score };
if (require.main === module) score({}, true);
