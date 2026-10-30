/* ---------- Tempo training: daily five, puzzle rush, lessons, play-it-out scenarios ---------- */
var TAB = 'play';
var TR_KEY = 'tempo-train-v1';
var TZ = 'America/New_York';
var TR = null;            // saved training progress
var PZ = null;            // current puzzle session
var trainScreen = { name: 'hub' };
var puzzlesReady = null;
var trClock = null;

function trLoad() {
  try { TR = JSON.parse(localStorage.getItem(TR_KEY)) || null; } catch (e) { TR = null; }
  if (!TR) TR = { rating: 800, played: 0, seen: {}, lessons: {}, rushBest: 0, scen: {} };
  if (!TR.seen) TR.seen = {};
  if (!TR.lessons) TR.lessons = {};
  if (!TR.scen) TR.scen = {};
}
function trSave() { try { localStorage.setItem(TR_KEY, JSON.stringify(TR)); } catch (e) {} }
function bostonDate(d) { return (d || new Date()).toLocaleDateString('en-CA', { timeZone: TZ }); }
function dayBefore(day) { var d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
function dailyKey(day) { return 'tempo-daily-' + day; }
function readJSON(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function prettyDay(day) { var d = new Date(day + 'T12:00:00Z'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }

function loadPuzzles() {
  if (typeof PUZZLES !== 'undefined') return Promise.resolve();
  if (puzzlesReady) return puzzlesReady;
  puzzlesReady = new Promise(function (res, rej) {
    var s = document.createElement('script');
    s.src = 'puzzles.js' + (window.TEMPO_V ? '?v=' + window.TEMPO_V : '');
    s.onload = function () { res(); };
    s.onerror = function () { puzzlesReady = null; rej(new Error('puzzles')); };
    document.head.appendChild(s);
  });
  return puzzlesReady;
}
function pzObj(a) { return { id: a[0], fen: a[1], moves: a[2].split(' '), rating: a[3], themes: a[4] ? a[4].split(' ') : [] }; }

/* deterministic pick from a list with a string seed */
function seedRand(seed) {
  var h = 1779033703 ^ seed.length;
  for (var i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  return function () { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
function nearRating(target, spread, filter, rnd, exclude) {
  var pool = [];
  for (var i = 0; i < PUZZLES.length; i++) {
    var a = PUZZLES[i];
    if (Math.abs(a[3] - target) > spread) continue;
    if (exclude && exclude[a[0]]) continue;
    if (filter && !filter(a)) continue;
    pool.push(a);
  }
  if (!pool.length) return null;
  return pzObj(pool[Math.floor(rnd() * pool.length)]);
}

/* ---- the daily five: same puzzles for everyone, by Boston date ---- */
var DAILY_TARGETS = [750, 1050, 1350, 1650, 1950];
function dailySet(day) {
  var rnd = seedRand('tempo-daily-' + day), out = [], used = {};
  DAILY_TARGETS.forEach(function (t) {
    var p = nearRating(t, 60, function (a) { return a[2].split(' ').length <= 8; }, rnd, used) || nearRating(t, 200, null, rnd, used);
    used[p.id] = 1; out.push(p);
  });
  return out;
}
function dailyState(day) {
  var d = readJSON(dailyKey(day));
  return d && Array.isArray(d.results) ? d : { results: [] };
}
function dailyStreak() {
  var day = bostonDate(), n = 0;
  var full = function (k) { var d = dailyState(k); return d.results.length >= 5; };
  if (!full(day)) day = dayBefore(day);
  while (n < 400 && full(day)) { n++; day = dayBefore(day); }
  return n;
}

/* ---- puzzle rating (simple Elo against the puzzle's rating) ---- */
function rateResult(pz, clean) {
  var exp = 1 / (1 + Math.pow(10, (pz.rating - TR.rating) / 400));
  var k = TR.played < 20 ? 40 : 24;
  var d = Math.round(k * ((clean ? 1 : 0) - exp));
  TR.rating = Math.max(400, Math.min(2800, TR.rating + d));
  TR.played++;
  TR.seen[pz.id] = clean ? 1 : 0;
  return d;
}

/* ---- sessions ---- */
function startSession(kind, opts) {
  opts = opts || {};
  PZ = { kind: kind, list: opts.list || [], i: 0, results: [], lesson: opts.lesson || null, start: Date.now(), strikes: 0, target: 600, day: opts.day || null };
  if (kind === 'daily') {
    var st = dailyState(PZ.day);
    PZ.results = st.results.slice();
    PZ.i = PZ.results.length;
    if (PZ.i >= PZ.list.length) { trainScreen = { name: 'dailyDone' }; renderTrainAll(); return; }
  }
  if (kind === 'rush') {
    PZ.ends = Date.now() + 180000;
    PZ.list = [];
    PZ.rnd = seedRand('rush' + Date.now());
    PZ.used = {};
    nextRushPuzzle();
    startTrClock();
  }
  trainScreen = { name: 'puzzle' };
  beginPuzzle(PZ.list[PZ.i]);
}
function nextRushPuzzle() {
  var p = nearRating(PZ.target, 80, function (a) { return a[2].split(' ').length <= 6; }, PZ.rnd, PZ.used) || nearRating(PZ.target, 300, null, PZ.rnd, PZ.used);
  PZ.used[p.id] = 1;
  PZ.list.push(p);
}
function startTrClock() {
  stopTrClock();
  trClock = setInterval(function () {
    if (!PZ || PZ.kind !== 'rush') { stopTrClock(); return; }
    var el = document.getElementById('rushClock');
    var left = PZ.ends - Date.now();
    if (el) { el.textContent = clockStr(Math.max(0, left)); el.classList.toggle('low', left < 20000); }
    if (left <= 0) { stopTrClock(); endRush(); }
  }, 100);
}
function stopTrClock() { if (trClock) { clearInterval(trClock); trClock = null; } }

function beginPuzzle(pz) {
  var c = new Chess(pz.fen);
  PZ.cur = { pz: pz, chess: c, step: 0, status: 'intro', mistakes: 0, hinted: false, shown: false, wrong: null, t0: Date.now(), last: null, gen: (PZ.cur ? PZ.cur.gen : 0) + 1 };
  orient = other(c.turn());
  sel = null;
  renderTrainAll();
  var cur = PZ.cur;
  setTimeout(function () {
    if (!PZ || PZ.cur !== cur) return;
    playPuzzleMove(cur, cur.pz.moves[0]);
    cur.status = 'try';
    cur.t0 = Date.now();
    renderTrainAll();
  }, PZ.kind === 'rush' ? 250 : 650);
}
function playPuzzleMove(cur, uci) {
  var m = cur.chess.move(uciObj(uci));
  if (!m) return null;
  cur.step++;
  cur.last = { from: m.from, to: m.to };
  animNext = { from: m.from, to: m.to, flags: m.flags, color: m.color };
  return m;
}
function puzzleColor() { return PZ && PZ.cur ? other(new Chess(PZ.cur.pz.fen).turn()) : 'w'; }

function trainMove(from, to, promo) {
  if (!PZ || !PZ.cur) return false;
  var cur = PZ.cur;
  if (cur.status !== 'try' && cur.status !== 'wrong') return false;
  var c = cur.chess;
  var cands = c.moves({ verbose: true }).filter(function (m) { return m.from === from && m.to === to; });
  if (!cands.length) return false;
  if (cands.length > 1 && !promo) { showPromo(from, to); return true; }
  var uci = from + to + (promo || cands[0].promotion || '');
  var expected = cur.pz.moves[cur.step];
  var test = new Chess(c.fen()); test.move(uciObj(uci));
  var ok = uci === expected || test.in_checkmate();
  sel = null;
  if (!ok) {
    cur.mistakes++;
    cur.status = 'wrong';
    cur.wrong = { from: from, to: to, san: cands[0].san };
    if (PZ.kind === 'rush') { rushMiss(); return true; }
    renderTrainAll();
    return true;
  }
  cur.wrong = null;
  playPuzzleMove(cur, uci);
  if (cur.step >= cur.pz.moves.length || test.in_checkmate()) { puzzleSolved(); return true; }
  cur.status = 'reply';
  renderTrainAll();
  setTimeout(function () {
    if (!PZ || PZ.cur !== cur) return;
    playPuzzleMove(cur, cur.pz.moves[cur.step]);
    cur.status = 'try';
    if (cur.step >= cur.pz.moves.length) { puzzleSolved(); return; }
    renderTrainAll();
  }, PZ.kind === 'rush' ? 220 : 450);
  return true;
}
function pointsFor(cur) {
  if (cur.shown) return 0;
  var slips = cur.mistakes + (cur.hinted ? 1 : 0);
  return slips === 0 ? 5 : slips === 1 ? 3 : 1;
}
function puzzleSolved() {
  var cur = PZ.cur;
  cur.status = 'solved';
  cur.ms = Date.now() - cur.t0;
  var clean = cur.mistakes === 0 && !cur.hinted && !cur.shown;
  if (PZ.kind === 'rush') {
    PZ.results.push({ id: cur.pz.id, ok: true });
    PZ.target += 60;
    nextRushPuzzle();
    PZ.i++;
    beginPuzzle(PZ.list[PZ.i]);
    return;
  }
  cur.delta = rateResult(cur.pz, clean);
  recordResult(cur, true);
  trSave();
  renderTrainAll();
}
function recordResult(cur, solved) {
  var r = { id: cur.pz.id, s: pointsFor(cur), ok: solved && !cur.shown, t: cur.ms || (Date.now() - cur.t0), clean: cur.mistakes === 0 && !cur.hinted && !cur.shown };
  PZ.results.push(r);
  if (PZ.kind === 'daily') writeJSON(dailyKey(PZ.day), { results: PZ.results, ids: PZ.list.map(function (p) { return p.id; }) });
  if (PZ.kind === 'lesson') {
    var L = TR.lessons[PZ.lesson.id] || { best: 0, runs: 0 };
    L.last = PZ.results.filter(function (x) { return x.clean; }).length;
    TR.lessons[PZ.lesson.id] = L;
  }
}
function rushMiss() {
  var cur = PZ.cur;
  PZ.strikes++;
  PZ.results.push({ id: cur.pz.id, ok: false });
  cur.status = 'missed';
  renderTrainAll();
  var g = cur;
  setTimeout(function () {
    if (!PZ || PZ.cur !== g) return;
    if (PZ.strikes >= 3) { endRush(); return; }
    PZ.target = Math.max(500, PZ.target - 40);
    nextRushPuzzle(); PZ.i++; beginPuzzle(PZ.list[PZ.i]);
  }, 1100);
}
function endRush() {
  stopTrClock();
  if (!PZ || PZ.kind !== 'rush' || PZ.over) return;
  PZ.over = true;
  var score = PZ.results.filter(function (r) { return r.ok; }).length;
  PZ.score = score;
  PZ.newBest = score > (TR.rushBest || 0);
  if (PZ.newBest) TR.rushBest = score;
  trSave();
  trainScreen = { name: 'rushDone' };
  renderTrainAll();
}
function showSolution() {
  var cur = PZ.cur;
  if (!cur || cur.status === 'solved') return;
  cur.shown = true;
  cur.status = 'showing';
  renderTrainAll();
  (function stepIt() {
    if (!PZ || PZ.cur !== cur) return;
    if (cur.step >= cur.pz.moves.length) {
      cur.status = 'solved';
      cur.ms = Date.now() - cur.t0;
      cur.delta = rateResult(cur.pz, false);
      recordResult(cur, false);
      trSave(); renderTrainAll(); return;
    }
    playPuzzleMove(cur, cur.pz.moves[cur.step]);
    renderTrainAll();
    setTimeout(stepIt, 700);
  })();
}
function puzzleHint() { if (PZ && PZ.cur && (PZ.cur.status === 'try' || PZ.cur.status === 'wrong')) { PZ.cur.hinted = true; renderTrainAll(); } }
function nextPuzzle() {
  if (!PZ) return;
  if (PZ.i + 1 >= PZ.list.length) {
    if (PZ.kind === 'daily') { trainScreen = { name: 'dailyDone' }; }
    else if (PZ.kind === 'lesson') {
      var L = TR.lessons[PZ.lesson.id] || { best: 0, runs: 0 };
      var clean = PZ.results.filter(function (x) { return x.clean; }).length;
      L.best = Math.max(L.best || 0, clean); L.runs = (L.runs || 0) + 1; L.n = PZ.list.length;
      TR.lessons[PZ.lesson.id] = L; trSave();
      trainScreen = { name: 'lessonDone' };
    } else trainScreen = { name: 'hub' };
    PZ.cur = null;
    renderTrainAll();
    return;
  }
  PZ.i++;
  beginPuzzle(PZ.list[PZ.i]);
}

/* lesson practice: 6 puzzles on the theme near your rating, easiest first */
function lessonSet(lesson) {
  var themeOk = function (a) { var t = a[4].split(' '); return lesson.themes.some(function (x) { return t.indexOf(x) >= 0; }); };
  var pool = PUZZLES.filter(themeOk), used = {}, out = [];
  var rnd = seedRand(lesson.id + Date.now());
  [-200, -120, -40, 40, 120, 200].forEach(function (off) {
    var target = Math.max(650, TR.rating + off), best = null;
    var cands = pool.filter(function (a) { return !used[a[0]]; });
    cands.sort(function (a, b) {
      var sa = Math.abs(a[3] - target) + (TR.seen[a[0]] != null ? 400 : 0), sb = Math.abs(b[3] - target) + (TR.seen[b[0]] != null ? 400 : 0);
      return sa - sb;
    });
    best = cands[Math.floor(rnd() * Math.min(4, cands.length))];
    if (best) { used[best[0]] = 1; out.push(best); }
  });
  out.sort(function (a, b) { return a[3] - b[3]; });
  return out.map(pzObj);
}

/* ---- scenarios: launch a real game from a position ---- */
function launchScenario(id) {
  var sc = SCENARIOS.filter(function (x) { return x.id === id; })[0];
  if (!sc) return;
  PZ = null; stopTrClock();
  switchTab('play', true);
  var me = new Chess(sc.fen).turn();
  newGame({ level: sc.level, color: me, coach: 'every', clock: 'none' }, { startFen: sc.fen, scenario: { id: sc.id, goal: sc.goal, limit: sc.limit, title: sc.title, result: null } });
}
function scenarioDef() { return S && S.scenario ? SCENARIOS.filter(function (x) { return x.id === S.scenario.id; })[0] : null; }
function myMovesCount() { return S.plies.filter(function (p) { return p.by === 'you'; }).length; }
function hasQueen(color) { var has = false; chess.board().forEach(function (r) { r.forEach(function (p) { if (p && p.color === color && p.type === 'q') has = true; }); }); return has; }
function scenarioCheck() {
  var sc = S && S.scenario;
  if (!sc || sc.result) return;
  var o = S.over, mine = myMovesCount(), last = S.plies[S.plies.length - 1];
  function finish(ok, text, endReason) {
    sc.result = { ok: ok, text: text };
    if (!S.over && endReason) S.over = { winner: ok && sc.goal !== 'draw' ? S.me : null, reason: endReason, manual: true };
    if (ok) { TR.scen[sc.id] = Math.max(TR.scen[sc.id] || 0, 1); trSave(); }
  }
  if (sc.goal === 'mate' || sc.goal === 'win') {
    if (o && o.winner === S.me) finish(true, sc.goal === 'mate' ? 'Checkmate in ' + mine + ' moves.' : 'You converted the extra piece.');
    else if (o && o.reason === 'stalemate') finish(false, 'Stalemate. The king had no legal move but was not in check, so it is a draw.');
    else if (o) finish(false, o.winner ? 'You lost this one.' : 'It ended in a draw by ' + o.reason + '.');
    else if (sc.limit && mine >= sc.limit && last && last.by === 'you') finish(false, 'Out of moves: no mate within ' + sc.limit + '.', 'the move limit');
  } else if (sc.goal === 'queen') {
    var myPromo = S.plies.some(function (p) { return p.by === 'you' && p.promotion; });
    if (o && o.winner === S.me) finish(true, 'Promoted and won.');
    else if (o) finish(false, o.reason === 'stalemate' ? 'Stalemate. Leave the enemy king a legal move.' : 'The pawn did not make it.');
    else if (myPromo && last && last.by === 'bot' && hasQueen(S.me)) finish(true, 'New queen, safe and sound.', 'promotion');
    else if (myPromo && last && last.by === 'bot') finish(false, 'The new queen was captured right away.', 'losing the new queen');
    else if (sc.limit && mine >= sc.limit && last && last.by === 'you') finish(false, 'Out of moves: no safe promotion within ' + sc.limit + '.', 'the move limit');
  } else if (sc.goal === 'draw') {
    if (o && !o.winner) finish(true, 'Draw. You held.');
    else if (o) finish(false, 'You were checkmated.');
    else if (last && last.by === 'bot' && last.promotion) finish(false, 'The pawn queened.', 'promotion');
    else if (sc.limit && mine >= sc.limit && last && last.by === 'you') finish(true, 'You held for ' + sc.limit + ' moves.', 'holding for ' + sc.limit + ' moves');
  }
}

/* ---- tabs ---- */
function switchTab(t, quiet) {
  if (t === TAB) return;
  if (t === 'train' && S && S.clock && !S.over) S.paused = { at: Date.now(), plies: S.plies.length };
  if (t === 'play' && S && S.paused) {
    if (S.plies.length === S.paused.plies) S.turnStart += Date.now() - S.paused.at; else S.turnStart = Date.now();
    delete S.paused; save();
  }
  TAB = t;
  sel = null;
  if (t === 'play') { PZ = PZ && PZ.kind === 'rush' && !PZ.over ? null : PZ; stopTrClock(); orient = S ? (S.orientSaved || S.me) : 'w'; }
  else { if (S) S.orientSaved = orient; trainScreen = PZ && PZ.cur ? { name: 'puzzle' } : { name: 'hub' }; loadPuzzles().then(renderTrainAll, renderTrainAll); }
  if (!quiet) render();
}

/* ---- rendering ---- */
function trainDisplayed() {
  var o = { fen: START_FEN, last: null, arrows: [], badge: null, interactive: false };
  if (!PZ || !PZ.cur) return o;
  var cur = PZ.cur;
  o.fen = cur.chess.fen();
  o.last = cur.last;
  o.interactive = cur.status === 'try' || cur.status === 'wrong';
  if (cur.wrong && (cur.status === 'wrong' || cur.status === 'missed')) o.arrows.push({ from: cur.wrong.from, to: cur.wrong.to, kind: 'bad' });
  if (cur.status === 'missed') { var mv = cur.pz.moves[cur.step]; if (mv) o.arrows.push({ from: mv.slice(0, 2), to: mv.slice(2, 4), kind: 'best' }); }
  if (cur.hinted && o.interactive) o.hintSq = cur.pz.moves[cur.step].slice(0, 2);
  return o;
}
function renderTrainAll() {
  if (TAB !== 'train') return;
  renderTabs();
  var lay = document.querySelector('.layout');
  var hub = trainScreen.name !== 'puzzle';
  lay.classList.add('training');
  lay.classList.toggle('hub', hub);
  if (!hub) { renderBoard(); renderTrainStrips(); }
  document.getElementById('trainPanel').innerHTML = trainPanelHtml();
}
function renderTrainStrips() {
  var cur = PZ && PZ.cur;
  if (!cur) return;
  var color = puzzleColor();
  var label = PZ.kind === 'daily' ? 'Daily ' + (PZ.i + 1) + ' of ' + PZ.list.length : PZ.kind === 'rush' ? 'Puzzle Rush' : PZ.kind === 'lesson' ? PZ.lesson.title + ' · ' + (PZ.i + 1) + ' of ' + PZ.list.length : 'Puzzle';
  var right = PZ.kind === 'rush' ? '<span class="right"><span class="strikes">' + [0, 1, 2].map(function (i) { return '<i class="' + (i < PZ.strikes ? 'x' : '') + '"></i>'; }).join('') + '</span><span class="clk on" id="rushClock">' + clockStr(Math.max(0, PZ.ends - Date.now())) + '</span></span>'
    : '<span class="right"><span class="clockdot">Rated ' + cur.pz.rating + '</span></span>';
  document.getElementById('oppStrip').innerHTML = '<span class="who">' + esc(label) + '</span>' + right;
  document.getElementById('youStrip').innerHTML = '<span class="who">You<small>' + cname(color) + ' to play</small></span>' + (PZ.kind === 'rush' ? '<span class="right"><span class="clockdot">Solved <b>&nbsp;' + PZ.results.filter(function (r) { return r.ok; }).length + '</b></span></span>' : '');
}
function pips() {
  if (!PZ || PZ.kind === 'rush' || PZ.list.length < 2) return '';
  return '<div class="pips">' + PZ.list.map(function (p, i) {
    var r = PZ.results[i], cls = r ? (r.s === 5 ? 'p5' : r.s >= 3 ? 'p3' : r.s ? 'p1' : 'p0') : (i === PZ.i ? 'now' : '');
    return '<i class="' + cls + '"></i>';
  }).join('') + '</div>';
}
function themeNotes(pz) {
  var seen = {}, out = [];
  pz.themes.forEach(function (t) {
    var key = /Mate$/.test(t) && t !== 'backRankMate' && t !== 'smotheredMate' && !THEME_TEXT[t] ? null : t;
    if (key && THEME_TEXT[key] && !seen[key]) { seen[key] = 1; out.push(THEME_TEXT[key]); }
  });
  return out.slice(0, 3);
}
function mateLabel(pz) { for (var n = 1; n <= 5; n++) if (pz.themes.indexOf('mateIn' + n) >= 0) return 'Mate in ' + n; return null; }
function puzzleCard() {
  var cur = PZ.cur, pz = cur.pz, color = cname(puzzleColor()), h = '';
  var kick = PZ.kind === 'daily' ? 'Daily five · ' + (PZ.i + 1) + ' of ' + PZ.list.length : PZ.kind === 'lesson' ? esc(PZ.lesson.title) + ' · ' + (PZ.i + 1) + ' of ' + PZ.list.length : 'Puzzle Rush';
  var task = PZ.kind === 'lesson' ? (mateLabel(pz) ? mateLabel(pz) + '. ' : '') + PZ.lesson.idea : (mateLabel(pz) && PZ.kind !== 'daily' ? mateLabel(pz) : 'Find the best move.');
  if (cur.status === 'solved') {
    var clean = cur.mistakes === 0 && !cur.hinted && !cur.shown;
    var line = lineText(fenAfterSetup(pz), pz.moves.slice(1));
    h += '<div class="verdict tone-' + (cur.shown ? 'mistake' : clean ? 'best' : 'good') + '"><div class="glyph">' + (cur.shown ? '×' : clean ? '★' : '✓') + '</div><div><div class="kicker">' + kick + '</div><h2>' + (cur.shown ? 'Here is the solution' : clean ? 'Solved' : 'Solved, with help') + '</h2></div></div>';
    h += '<div class="better"><span class="lbl">Solution</span><span class="ln sol">' + esc(line) + '</span></div>';
    var notes = themeNotes(pz);
    if (notes.length) h += '<ul class="insights">' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
    h += '<div class="evalrow"><span>Time <b>' + fmtSecs(cur.ms) + '</b></span>' + (PZ.kind === 'daily' ? '<span>Points <b>' + pointsFor(cur) + ' of 5</b></span>' : '') + '<span>Puzzle rating <b>' + TR.rating + '</b> (' + (cur.delta >= 0 ? '+' : MINUS) + Math.abs(cur.delta) + ')</span></div>';
    h += pips();
    h += '<div class="actions"><button class="btn sm primary" type="button" data-tr="next">' + (PZ.i + 1 >= PZ.list.length ? 'Finish' : 'Next puzzle') + '</button><button class="btn sm" type="button" data-tr="hub">Back to training</button></div>';
    return h;
  }
  h += '<div><div class="kicker">' + kick + '</div><h2>' + color + ' to play</h2></div>';
  if (cur.status === 'intro') h += '<p class="dim">Watch your opponent\'s move…</p>';
  else if (cur.status === 'wrong') h += '<p><b>' + esc(cur.wrong.san) + '</b> is not it. Try again.' + (PZ.kind === 'daily' ? ' Each miss costs points.' : '') + '</p>';
  else if (cur.status === 'missed') h += '<p><b>' + esc(cur.wrong.san) + '</b> is not it. The green arrow was the move. Strike ' + PZ.strikes + ' of 3.</p>';
  else if (cur.status === 'showing') h += '<p>Playing out the solution…</p>';
  else if (cur.status === 'reply') h += '<p>Good. Your opponent replies…</p>';
  else h += '<p>' + (cur.step > 1 ? 'Keep going. ' : '') + esc(task) + '</p>';
  if (cur.hinted && cur.status !== 'showing') h += '<p class="tip"><strong>Hint.</strong> Move the piece on the highlighted square.</p>';
  h += pips();
  if (PZ.kind !== 'rush') {
    h += '<div class="actions">';
    if (!cur.hinted) h += '<button class="btn sm" type="button" data-tr="hint"' + (cur.status === 'try' || cur.status === 'wrong' ? '' : ' disabled') + '>Hint</button>';
    h += '<button class="btn sm" type="button" data-tr="show"' + (cur.status === 'try' || cur.status === 'wrong' ? '' : ' disabled') + '>Show solution</button>';
    h += '<button class="btn sm" type="button" data-tr="hub">Back to training</button></div>';
    if (PZ.kind === 'daily') h += '<p class="fine">5 points first try, 3 after one miss or a hint, 1 after that, 0 if you look at the solution.</p>';
  } else h += '<div class="actions one"><button class="btn sm" type="button" data-tr="endrush">End run</button></div>';
  return h;
}
function fenAfterSetup(pz) { var c = new Chess(pz.fen); c.move(uciObj(pz.moves[0])); return c.fen(); }

function shareLine(day, results) {
  var total = results.reduce(function (a, r) { return a + (r.s || 0); }, 0);
  var secs = results.reduce(function (a, r) { return a + (r.t || 0); }, 0);
  var sq = results.map(function (r) { return r.s === 5 ? '🟩' : r.s >= 3 ? '🟨' : r.s ? '🟧' : '🟥'; }).join('');
  return 'Tempo daily ' + prettyDay(day) + ': ' + total + '/25 in ' + fmtSecs(secs) + ' ' + sq + ' davidsolar.dev/tempo/';
}
function hubHtml() {
  var day = bostonDate(), st = dailyState(day), n = st.results.length, streak = dailyStreak();
  var total = st.results.reduce(function (a, r) { return a + (r.s || 0); }, 0);
  var h = '<div class="hubhead"><div><div class="kicker">Training</div><h2>Sharpen your eye</h2></div><div class="ratingchip"><span>Puzzle rating</span><b>' + TR.rating + '</b>' + (TR.played < 20 ? '<small>provisional</small>' : '') + '</div></div>';
  h += '<div class="hubgrid">';
  h += '<section class="hcard feature"><div class="kicker">Daily five · ' + prettyDay(day) + '</div><h3>' + (n >= 5 ? total + ' of 25' : n ? n + ' of 5 played' : 'Five new puzzles') + '</h3>' +
    '<p>' + (n >= 5 ? 'Done for today. New puzzles at midnight Eastern.' : 'Same five for everyone, easy to hard. Points for solving on the first try.') + '</p>' +
    '<div class="hfoot">' + (streak ? '<span class="streak">' + streak + '-day streak</span>' : '<span class="streak dim">Start a streak</span>') +
    '<button class="btn sm primary" type="button" data-tr="daily">' + (n >= 5 ? 'See results' : n ? 'Continue' : 'Start') + '</button></div></section>';
  h += '<section class="hcard"><div class="kicker">Puzzle Rush</div><h3>3 minutes, 3 strikes</h3><p>Solve as many as you can. They get harder as you go. Built for playing well and playing fast.</p>' +
    '<div class="hfoot"><span class="streak' + (TR.rushBest ? '' : ' dim') + '">' + (TR.rushBest ? 'Best ' + TR.rushBest : 'No runs yet') + '</span><button class="btn sm" type="button" data-tr="rush">Start a run</button></div></section>';
  h += '</div>';
  ['Tactics', 'Checkmates', 'Endgames', 'Defense'].forEach(function (g) {
    h += '<div class="hubsec"><h4>' + g + '</h4><div class="lessons">';
    LESSONS.filter(function (l) { return l.group === g; }).forEach(function (l) {
      var L = TR.lessons[l.id], pr = L && L.runs ? L.best + '/' + (L.n || 6) : '';
      h += '<button class="lesson" type="button" data-lesson="' + l.id + '"><span class="lt">' + esc(l.title) + '</span><span class="ld">' + esc(l.idea) + '</span>' + (pr ? '<span class="lp' + (L.best >= (L.n || 6) ? ' full' : '') + '">Best ' + pr + '</span>' : '') + '</button>';
    });
    h += '</div></div>';
  });
  h += '<div class="hubsec"><h4>Play it out</h4><p class="secnote">Real positions against the engine, with a goal. The coach grades every move.</p><div class="lessons">';
  SCENARIOS.forEach(function (s) {
    h += '<button class="lesson" type="button" data-scen="' + s.id + '"><span class="lt">' + esc(s.title) + '</span><span class="ld">' + esc(s.blurb) + '</span><span class="lp' + (TR.scen[s.id] ? ' full' : '') + '">' + (TR.scen[s.id] ? 'Completed' : esc(s.tag)) + '</span></button>';
  });
  h += '</div></div>';
  return h;
}
function lessonIntroHtml(l) {
  var L = TR.lessons[l.id];
  return '<div class="lessonintro"><div class="kicker">' + esc(l.group) + ' lesson</div><h2>' + esc(l.title) + '</h2>' +
    l.intro.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') +
    '<p class="tip"><strong>Key idea.</strong> ' + esc(l.idea) + '</p>' +
    '<p class="fine">Six puzzles picked near your puzzle rating (' + TR.rating + '), easiest first.' + (L && L.runs ? ' Your best: ' + L.best + ' of ' + (L.n || 6) + ' on the first try.' : '') + '</p>' +
    '<div class="actions"><button class="btn sm primary" type="button" data-tr="lessongo" data-id="' + l.id + '">Start practice</button><button class="btn sm" type="button" data-tr="hub">Back to training</button></div></div>';
}
function setDoneHtml(title, kick) {
  var res = PZ.results, clean = res.filter(function (r) { return r.clean; }).length;
  var total = res.reduce(function (a, r) { return a + (r.s || 0); }, 0), secs = res.reduce(function (a, r) { return a + (r.t || 0); }, 0);
  var h = '<div class="lessonintro"><div class="kicker">' + kick + '</div><h2>' + title + '</h2>';
  h += '<div class="bigscore"><b>' + (PZ.kind === 'daily' ? total + '<small>/25</small>' : clean + '<small>/' + res.length + '</small>') + '</b><span>' + (PZ.kind === 'daily' ? 'points' : 'solved on the first try') + ' · ' + fmtSecs(secs) + '</span></div>';
  h += pips();
  h += '<p>Puzzle rating: <b>' + TR.rating + '</b>.' + (PZ.kind === 'daily' ? ' Streak: ' + dailyStreak() + (dailyStreak() === 1 ? ' day.' : ' days.') : '') + '</p>';
  h += '<div class="actions">';
  if (PZ.kind === 'daily') h += '<button class="btn sm primary" type="button" data-tr="share">Copy result</button>';
  if (PZ.kind === 'lesson') h += '<button class="btn sm primary" type="button" data-tr="lessongo" data-id="' + PZ.lesson.id + '">Six more</button>';
  h += '<button class="btn sm" type="button" data-tr="hub">Back to training</button></div><p class="fine" id="shareNote"></p></div>';
  return h;
}
function rushDoneHtml() {
  return '<div class="lessonintro"><div class="kicker">Puzzle Rush</div><h2>' + (PZ.newBest ? 'New best' : 'Run over') + '</h2>' +
    '<div class="bigscore"><b>' + PZ.score + '</b><span>solved · best ' + TR.rushBest + '</span></div>' +
    '<p>' + (PZ.strikes >= 3 ? 'Three strikes.' : PZ.ends - Date.now() > 500 ? 'You ended the run.' : 'Time is up.') + ' The puzzles got harder with every solve, so the score measures speed and accuracy together.</p>' +
    '<div class="actions"><button class="btn sm primary" type="button" data-tr="rush">Run it back</button><button class="btn sm" type="button" data-tr="hub">Back to training</button></div></div>';
}
function trainPanelHtml() {
  if (typeof PUZZLES === 'undefined') return '<div class="pending"><span class="spin"></span><span>Loading puzzles…</span></div>';
  var n = trainScreen.name;
  if (n === 'puzzle' && PZ && PZ.cur) return puzzleCard();
  if (n === 'lessonIntro') return lessonIntroHtml(LESSONS.filter(function (l) { return l.id === trainScreen.id; })[0]);
  if (n === 'dailyDone') { if (!PZ || PZ.kind !== 'daily') { var d = bostonDate(); PZ = { kind: 'daily', list: dailySet(d), results: dailyState(d).results, i: 5, day: d }; } return setDoneHtml(prettyDay(PZ.day) + ' done', 'Daily five'); }
  if (n === 'lessonDone') return setDoneHtml(PZ.lesson.title + ' complete', 'Lesson');
  if (n === 'rushDone') return rushDoneHtml();
  return hubHtml();
}
function renderTabs() {
  var el = document.getElementById('tabs');
  el.innerHTML = '<button type="button" data-tab="play" aria-pressed="' + (TAB === 'play') + '">Play</button><button type="button" data-tab="train" aria-pressed="' + (TAB === 'train') + '">Train</button>';
  document.getElementById('newBtn').hidden = TAB !== 'play';
  if (TAB !== 'play') document.getElementById('resignBtn').hidden = true;
  if (TAB === 'play') { var lay = document.querySelector('.layout'); lay.classList.remove('training'); lay.classList.remove('hub'); }
}

function wireTrain() {
  trLoad();
  document.getElementById('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]'); if (b) switchTab(b.getAttribute('data-tab'));
  });
  document.getElementById('trainPanel').addEventListener('click', function (e) {
    var les = e.target.closest('[data-lesson]');
    if (les) { trainScreen = { name: 'lessonIntro', id: les.getAttribute('data-lesson') }; PZ = null; renderTrainAll(); window.scrollTo(0, 0); return; }
    var sc = e.target.closest('[data-scen]');
    if (sc) { launchScenario(sc.getAttribute('data-scen')); window.scrollTo(0, 0); return; }
    var b = e.target.closest('[data-tr]'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-tr');
    if (a === 'daily') { var d = bostonDate(); startSession('daily', { list: dailySet(d), day: d }); window.scrollTo(0, 0); }
    else if (a === 'rush') { startSession('rush'); window.scrollTo(0, 0); }
    else if (a === 'lessongo') { var l = LESSONS.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0]; startSession('lesson', { list: lessonSet(l), lesson: l }); window.scrollTo(0, 0); }
    else if (a === 'hint') puzzleHint();
    else if (a === 'show') showSolution();
    else if (a === 'next') nextPuzzle();
    else if (a === 'endrush') endRush();
    else if (a === 'hub') { stopTrClock(); if (PZ && PZ.kind === 'rush' && !PZ.over) PZ = null; if (PZ) PZ.cur = null; trainScreen = { name: 'hub' }; renderTrainAll(); }
    else if (a === 'share') {
      var text = shareLine(PZ.day, PZ.results), note = document.getElementById('shareNote');
      var done = function () { if (note) note.textContent = 'Copied: ' + text; };
      try { navigator.clipboard.writeText(text).then(done, function () { if (note) note.textContent = text; }); } catch (x) { if (note) note.textContent = text; }
    }
  });
}
