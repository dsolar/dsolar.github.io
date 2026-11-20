// One-off probe: what does theringer.com's Top 100 page look like to a script?
const r = await fetch('https://theringer.com/nba-ranked/top-100', { headers: { 'user-agent': 'Mozilla/5.0 (davidsolar.dev data refresh)' } });
const h = await r.text();
console.log('status', r.status, 'bytes', h.length);
for (const k of ['__NEXT_DATA__', 'application/ld+json', 'Wembanyama', 'Kyshawn', '"rank"', 'data-rank']) {
  const i = h.indexOf(k); console.log('\n==', k, i); if (i >= 0) console.log(h.slice(Math.max(0, i - 300), i + 500).replace(/\s+/g, ' '));
}
const w = [...h.matchAll(/Wembanyama/g)].length; console.log('\nWembanyama count', w);
