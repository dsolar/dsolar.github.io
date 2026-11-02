import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const app = read('win-probability/app.js');
const boot = app.slice(app.indexOf('  const requestedMode ='), app.lastIndexOf('})();'));
for (const [query, expected] of [['?mode=daily', 'daily'], ['?mode=speed', 'speed'], ['', 'menu'], ['?mode=invalid', 'menu']]) {
  test('Make the Call entry ' + (query || 'without mode'), () => {
    const calls = [];
    vm.runInNewContext(boot, { URLSearchParams, window: { location: { search: query } }, startGame: mode => calls.push(mode), renderStart: () => calls.push('menu') });
    assert.deepEqual(calls, [expected]);
  });
}

const page = read('guillotine/index.html');
const refresh = page.slice(page.indexOf('  function refreshLive()'), page.indexOf('  document.addEventListener("visibilitychange"'));
function harness({ fail = false, changed = false, hasLive = true } = {}) {
  const status = { textContent: '' }, renders = [], timers = [];
  const ctx = {
    BASE: { teams: [] }, LEAGUE: {}, state: {}, liveTimer: null, liveBusy: false, liveFails: 0,
    document: { visibilityState: 'visible' }, $: () => status,
    clearTimeout() {}, setTimeout(fn, delay) { timers.push(delay); },
    refreshRosterSnapshot: async () => changed,
    getLive: async () => { if (fail) throw new Error('offline'); return { games: {} }; },
    applyLive: base => hasLive ? { ...base, live: { inProgress: 1 } } : base,
    render: data => renders.push(data), updateJumpLabels() {}, openName: null
  };
  vm.createContext(ctx); vm.runInContext(refresh, ctx);
  return { ctx, status, renders, timers };
}
test('Snapshot is labelled until live scores replace it', async () => {
  const h = harness(); const pending = h.ctx.refreshLive();
  assert.match(h.status.textContent, /published snapshot.*Checking live/);
  await pending;
  assert.equal(h.status.textContent, ''); assert.equal(h.renders.length, 1);
  assert.equal(h.timers.at(-1), 60000);
});
test('Failed feed keeps snapshot, announces failure, and schedules retry', async () => {
  const h = harness({ fail: true, changed: true }); await h.ctx.refreshLive();
  assert.equal(h.renders[0], h.ctx.BASE);
  assert.match(h.status.textContent, /failed.*last available.*retrying/);
  assert.equal(h.ctx.liveBusy, false); assert.equal(h.timers.at(-1), 60000);
});
test('Feed without live results keeps an explicit snapshot label', async () => {
  const h = harness({ hasLive: false }); await h.ctx.refreshLive();
  assert.match(h.status.textContent, /published snapshot; live scores are not available/);
});
test('Hidden tabs do not start a score refresh', () => {
  const h = harness(); h.ctx.document.visibilityState = 'hidden';
  h.ctx.refreshLive(); assert.equal(h.ctx.liveBusy, false); assert.equal(h.status.textContent, '');
});
