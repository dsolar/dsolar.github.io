// End-to-end: play "The Nickel Comes" in a real browser, start to review.
// Needs Playwright (npm i -D playwright, or a global install with NODE_PATH set). Run: node tests/sunday-strategist.e2e.mjs
// SS_SHOTS=dir also saves screenshots of each stage.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/sunday-strategist/`;
const shots = process.env.SS_SHOTS;

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
try {
  for (const motion of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...(motion ? {} : { reducedMotion: 'reduce' }) });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|analytics|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(base);
    if (shots) await page.screenshot({ path: `${shots}/1-start.png`, fullPage: true });
    await page.click('[data-start="nickel-fire-3rd-6"]');
    await page.waitForSelector('#field .def');

    // Diagnose: the Next button stays locked until every question is answered.
    assert.equal(await page.isDisabled('#next'), true, 'Next is locked before answering');
    await page.check('input[name="personnel"][value="nickel"]');
    await page.check('input[name="shell"][value="two"]');
    for (const id of ['DEB', 'DT', 'NT', 'DEF', 'WILL', 'MIKE']) await page.check(`input[name="rushers"][value="${id}"]`);
    await page.click('#field .def[data-id="NB"]'); // the field itself is an input too
    assert.equal(await page.isChecked('input[name="rushers"][value="NB"]'), true, 'tapping the field checks the box');
    assert.equal(await page.getAttribute('#field .def[data-id="NB"]', 'aria-checked'), 'true');
    await page.check('input[name="pressure"][value="five"]');
    await page.check('input[name="confidence"][value="strong"]');
    if (shots) await page.screenshot({ path: `${shots}/2-diagnose.png`, fullPage: true });
    await page.click('#next');

    // Adjust: motion shows what the defense did.
    await page.check('input[name="motion"][value="yoyo"]');
    await page.waitForSelector('.reveal-note');
    assert.match(await page.textContent('.reveal-note'), /field safety crept/);
    await page.click('#next');
    await page.check('input[name="protection"][value="slide-nickel"]');
    await page.click('#next');
    await page.check('input[name="play"][value="stick"]');
    assert.ok(await page.$$eval('#f-routes path', p => p.length) >= 4, 'routes drawn for the call');
    assert.equal(await page.isDisabled('#next'), true, 'key defender required');
    await page.check('input[name="key"][value="FSF"]');
    if (shots) await page.screenshot({ path: `${shots}/3-call.png`, fullPage: true });
    await page.click('#next');
    await page.check('input[name="contingency"][value="built-in"]');
    await page.click('#next');

    await page.waitForSelector('#review:not([hidden]) .grades');
    const grades = await page.$$eval('.grade', g => g.map(x => x.textContent));
    assert.equal(grades.length, 6);
    for (const label of ['Diagnosis', 'Call', 'Protection', 'Answer']) assert.ok(grades.some(g => g.startsWith('A') && g.includes(label)), `${label} graded A: ${grades}`);
    const text = await page.textContent('#review');
    for (const s of ['Who needed to hold up', 'Where it turned', 'The other calls', 'Takeaway', 'Fire zone'.toLowerCase()].slice(0, 4)) assert.ok(text.includes(s), s);
    assert.ok(await page.$$eval('.acard', c => c.length) >= 4, 'assignment cards');
    assert.equal(await page.$$eval('.alts li', l => l.length), 4, 'all four calls compared');
    assert.match(text, /converts \d+%/);
    const before = await page.textContent('#result-line');
    for (let i = 0; i < 6 && (await page.textContent('#result-line')) === before; i++) await page.click('#again');
    if (shots) await page.screenshot({ path: `${shots}/4-review.png`, fullPage: true });

    // Progress is saved and the next scenario is the one not yet played.
    await page.click('#next-scen');
    assert.equal(await page.textContent('#scen-title'), 'Same Look, Different Answer');
    await page.click('#quit');
    assert.match(await page.textContent('#report'), /Nickel pressure\s*\d+/);

    // Phone width: no sideways scrolling.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('[data-start="nickel-bluff-2nd-7"]');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal scroll at 390px');
    if (shots && motion) await page.screenshot({ path: `${shots}/5-phone.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  console.log('Passed: full snap with keyboard-free and field input, motion reveal, routes, six grades, review sections, replays, saved progress, next scenario, phone layout (with and without reduced motion).');
} finally {
  await browser.close();
  server.close();
}
