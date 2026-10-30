/* ---------- Tempo app ---------- */
var LEVELS = [
  { name: 'Rookie', rating: '~400', desc: 'Hangs pieces often. Good for learning how pieces move.', skill: 0, depth: 1, time: 80, random: 0.5 },
  { name: 'Beginner', rating: '~700', desc: 'Makes regular mistakes you can punish.', skill: 0, depth: 2, time: 120, random: 0.22 },
  { name: 'Casual', rating: '~1000', desc: 'Knows the basics, still drops material.', skill: 3, depth: 4, time: 250, random: 0.08 },
  { name: 'Club', rating: '~1400', desc: 'Solid club player. Punishes loose pieces.', skill: 8, depth: 8, time: 600, random: 0 },
  { name: 'Strong', rating: '~1800', desc: 'Rarely blunders. You will need a plan.', skill: 14, depth: 11, time: 1000, random: 0 },
  { name: 'Master', rating: '2400+', desc: 'Full-strength search. Good luck.', skill: 20, depth: 15, time: 1600, random: 0 }
];
var CLOCKS = [
  { id: 'none', label: 'No clock', sub: 'Take your time' },
  { id: '15+10', base: 15, inc: 10, label: '15 | 10', sub: 'Rapid' },
  { id: '10+0', base: 10, inc: 0, label: '10 min', sub: 'Rapid' },
  { id: '5+3', base: 5, inc: 3, label: '5 | 3', sub: 'Blitz' },
  { id: '3+2', base: 3, inc: 2, label: '3 | 2', sub: 'Blitz' },
  { id: '1+0', base: 1, inc: 0, label: '1 min', sub: 'Bullet' }
];
var BOOK_SVG = '<svg viewBox="0 0 16 16" width="1.05em" height="1.05em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M8 4.2C6.4 3.1 4.4 2.8 1.8 3v9.6c2.6-.2 4.6.1 6.2 1.2 1.6-1.1 3.6-1.4 6.2-1.2V3C11.6 2.8 9.6 3.1 8 4.2Zm0 0v9.6"/></svg>';
var GRADES = {
  book: { label: 'Book', glyph: BOOK_SVG },
  best: { label: 'Best', glyph: '★' }, excellent: { label: 'Excellent', glyph: '!' }, good: { label: 'Good', glyph: '✓' },
  forced: { label: 'Only move', glyph: '□' }, inaccuracy: { label: 'Inaccuracy', glyph: '?!' },
  mistake: { label: 'Mistake', glyph: '?' }, blunder: { label: 'Blunder', glyph: '??' }
};
var LEGEND = ['book', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
var ANALYSIS = { skill: 20, depth: 13, movetime: 2500 };
var LS_KEY = 'tempo-chess-v1';

/* ---------- engine ---------- */
function bootWorker(url, ms) {
  return new Promise(function (resolve, reject) {
    var w, fin = false;
    try { w = new Worker(url); } catch (e) { reject(e); return; }
    var t = setTimeout(function () { if (!fin) { fin = true; try { w.terminate(); } catch (e) {} reject(new Error('timeout')); } }, ms);
    w.onerror = function (e) { if (!fin) { fin = true; clearTimeout(t); try { w.terminate(); } catch (x) {} reject(e); } };
    w.onmessage = function (e) {
      if (!fin && String(e.data).indexOf('uciok') >= 0) { fin = true; clearTimeout(t); w.onerror = null; resolve(w); }
    };
    w.postMessage('uci');
  });
}
function Engine() { this.w = null; this.jobs = []; this.cur = null; this.state = 'loading'; this.ready = null; }
Engine.prototype.start = function () {
  var self = this;
  if (this.ready) return this.ready;
  this.ready = bootWorker('stockfish.js', 9000)
    .catch(function () { return bootWorker('stockfish.asm.js', 25000); })
    .then(function (w) {
      self.w = w; self.state = 'ready';
      w.onmessage = function (e) { String(e.data).split('\n').forEach(function (l) { self.onLine(l.trim()); }); };
      w.postMessage('setoption name Contempt value 0');
      w.postMessage('setoption name Hash value 16');
      w.postMessage('ucinewgame');
      self.pump();
    })
    .catch(function () {
      self.state = 'failed';
      self.jobs.forEach(function (j) { j.res(null); }); self.jobs = [];
    });
  return this.ready;
};
Engine.prototype.go = function (fen, o) {
  var self = this;
  return new Promise(function (res) {
    if (self.state === 'failed') { res(null); return; }
    self.jobs.push({ fen: fen, o: o, res: res });
    self.pump();
  });
};
Engine.prototype.pump = function () {
  if (this.cur || !this.jobs.length || !this.w) return;
  var j = this.cur = this.jobs.shift();
  j.last = { score: null, pv: [], depth: 0 };
  this.w.postMessage('setoption name Skill Level value ' + (j.o.skill == null ? 20 : j.o.skill));
  this.w.postMessage('position fen ' + j.fen);
  this.w.postMessage('go depth ' + j.o.depth + (j.o.movetime ? ' movetime ' + Math.round(j.o.movetime) : ''));
};
Engine.prototype.onLine = function (l) {
  var j = this.cur;
  if (!j || !l) return;
  if (l.indexOf('info') === 0) {
    if (/ multipv ([2-9]|\d\d)/.test(l) || /bound/.test(l)) return;
    var m = l.match(/ score (cp|mate) (-?\d+)/);
    if (!m) return;
    j.last.score = m[1] === 'cp' ? { cp: +m[2] } : { mate: +m[2] };
    var d = l.match(/ depth (\d+)/); if (d) j.last.depth = +d[1];
    var pv = l.match(/ pv (.+)$/);
    if (pv) j.last.pv = pv[1].trim().split(/\s+/).filter(function (x) { return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(x); });
  } else if (l.indexOf('bestmove') === 0) {
    this.cur = null;
    var b = l.split(/\s+/)[1];
    j.last.bestmove = b && b !== '(none)' ? b : null;
    if (j.last.bestmove && (!j.last.pv.length || j.last.pv[0] !== j.last.bestmove)) j.last.pv = [j.last.bestmove];
    j.res(j.cancelled ? null : j.last);
    this.pump();
  }
};
Engine.prototype.cancelAll = function () {
  this.jobs.forEach(function (j) { j.res(null); });
  this.jobs = [];
  if (this.cur && this.w) { this.cur.cancelled = true; this.w.postMessage('stop'); }
};
var coachEng = new Engine(), botEng = new Engine();

/* ---------- state ---------- */
var S = null;               // persisted game
var chess = null;           // live position
var view = { mode: 'live' };
var orient = 'w';
var sel = null;             // selected square
var coachIdx = null;        // ply featured in the coach card
var hint = { fen: null, stage: 0, move: null };
var botThinking = false;
var gen = 0;
var cache = new Map();      // fen -> Promise(analysis)
var done = new Map();       // fen -> analysis (resolved)
var sampleFn = null, aiCtl = null, aiHidden = false;
var expanded = {};
var pendingPromo = null;
var animNext = null;
var boardChess = null;      // the position currently drawn
var resignArmed = 0;

function save() { try { localStorage.setItem(LS_KEY, JSON.stringify({ S: S, orient: orient })); } catch (e) {} }
function loadSaved() { try { var raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
function defaultSettings() { return { level: 2, color: 'w', coach: 'every', clock: 'none' }; }
function fenAt(n) { return n === 0 ? S.startFen : S.plies[n - 1].fenAfter; }
function lastUserIdx() { for (var i = S.plies.length - 1; i >= 0; i--) if (S.plies[i].by === 'you') return i; return -1; }
function myTurnLive() { return !S.over && chess.turn() === S.me && !botThinking; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function plyLabel(i) { var p = S.plies[i]; var n = moveNoOf(p.fenBefore); return p.color === 'w' ? n + '. ' + p.san : n + '... ' + p.san; }
function coachVisible(p) {
  if (!p || !p.review || p.review.status !== 'done') return false;
  if (S.settings.coach === 'after' && !S.over) return false;
  return true;
}
function quietMode() { return S.settings.coach === 'after' && !S.over; }
function fmtSecs(ms) {
  if (ms == null) return '';
  var s = ms / 1000;
  if (s < 10) return s.toFixed(1) + 's';
  if (s < 60) return Math.round(s) + 's';
  var m = Math.floor(s / 60), r = Math.round(s % 60);
  if (r === 60) { m++; r = 0; }
  return m + 'm ' + (r < 10 ? '0' : '') + r + 's';
}

function analyze(fen) {
  if (cache.has(fen)) return cache.get(fen);
  var c = new Chess(fen), p;
  if (c.game_over()) {
    var r = c.in_checkmate() ? { score: { mate: 0 }, pv: [], bestmove: null } : { score: { cp: 0 }, pv: [], bestmove: null };
    p = Promise.resolve(r); done.set(fen, r);
  } else {
    p = coachEng.go(fen, ANALYSIS).then(function (r) {
      if (!r) { if (cache.get(fen) === p) cache.delete(fen); return null; }
      if (!r.score) r.score = { cp: 0 };
      done.set(fen, r); renderEval(); if (S && S.over) renderTally();
      return r;
    });
  }
  cache.set(fen, p);
  return p;
}

/* ---------- clock ---------- */
function clockDef() { return CLOCKS.filter(function (c) { return c.id === (S.settings.clock || 'none'); })[0] || CLOCKS[0]; }
function clockLeft(color) {
  if (!S.clock) return null;
  var left = S.clock[color];
  if (!S.over && chess.turn() === color && S.turnStart) left -= Date.now() - S.turnStart;
  return left;
}
function clockStr(ms) {
  ms = Math.max(0, ms);
  if (ms < 10000) return (Math.floor(ms / 100) / 10).toFixed(1);
  var s = Math.ceil(ms / 1000), m = Math.floor(s / 60);
  s = s % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}
function updateClocks() {
  if (!S || !S.clock) return;
  ['w', 'b'].forEach(function (c) {
    var el = document.querySelector('.clk[data-c="' + c + '"]');
    if (!el) return;
    var left = clockLeft(c);
    el.textContent = clockStr(left);
    el.classList.toggle('on', !S.over && chess.turn() === c);
    el.classList.toggle('low', left < Math.min(20000, S.clock.base * 0.1 + 5000));
  });
  if (!S.over) {
    var t = chess.turn(), left = clockLeft(t);
    if (left <= 0) flag(t);
  }
}
function flag(color) {
  S.clock[color] = 0;
  var winner = other(color);
  var b = new Chess(chess.fen()).board(), canMate = false;
  b.forEach(function (row) { row.forEach(function (p) { if (p && p.color === winner && p.type !== 'k') canMate = true; }); });
  S.over = canMate ? { winner: winner, reason: 'time' } : { winner: null, reason: 'timeout with insufficient material' };
  gen++; botEng.cancelAll(); botThinking = false;
  view = { mode: 'live' }; coachIdx = null;
  save(); render();
}
setInterval(function () { if (S && S.clock && !S.over) updateClocks(); }, 100);

/* ---------- game flow ---------- */
function cancelAnalysis() {
  coachEng.cancelAll();
  cache.forEach(function (v, k) { if (!done.has(k)) cache.delete(k); });
}
function newGame(settings) {
  gen++;
  cancelAnalysis(); botEng.cancelAll();
  if (aiCtl) aiCtl.abort();
  var me = settings.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.color;
  S = { v: 3, settings: settings, me: me, startFen: START_FEN, plies: [], over: null, turnStart: Date.now(), clock: null, undos: [], aiReview: null };
  var cd = clockDef();
  if (cd.base) S.clock = { base: cd.base * 60000, inc: (cd.inc || 0) * 1000, w: cd.base * 60000, b: cd.base * 60000 };
  chess = new Chess(S.startFen);
  orient = me; view = { mode: 'live' }; sel = null; coachIdx = null; hint = { fen: null, stage: 0, move: null }; botThinking = false; expanded = {};
  save(); render();
  if (chess.turn() !== S.me) botTurn(); else analyze(chess.fen());
}

function applyMove(mv, by, legalCount) {
  var fenBefore = chess.fen(), mover = chess.turn();
  var hinted = by === 'you' && hint.fen === fenBefore && hint.stage ? hint.stage : 0;
  var now = Date.now(), spent = S.turnStart ? now - S.turnStart : null;
  var m = chess.move(mv);
  if (!m) return null;
  if (S.clock) S.clock[mover] = Math.max(0, S.clock[mover] - (spent || 0)) + S.clock.inc;
  S.turnStart = now;
  var ply = {
    san: m.san, uci: moveUci(m), from: m.from, to: m.to, color: m.color, piece: m.piece, captured: m.captured || null,
    flags: m.flags, promotion: m.promotion || null, fenBefore: fenBefore, fenAfter: chess.fen(), by: by,
    legalCount: legalCount, review: by === 'you' ? { status: 'pending' } : null,
    timeMs: spent, clock: S.clock ? { w: S.clock.w, b: S.clock.b } : null, hinted: hinted
  };
  S.plies.push(ply);
  checkOver();
  view = { mode: 'live' }; sel = null; hint = { fen: null, stage: 0, move: null };
  if (by === 'you') coachIdx = S.plies.length - 1;
  if (S.over) coachIdx = null;
  animNext = { from: m.from, to: m.to, flags: m.flags, color: m.color };
  save();
  return ply;
}

function checkOver() {
  if (S.over && (S.over.reason === 'time' || S.over.reason === 'resignation' || /^timeout/.test(S.over.reason))) return;
  if (!chess.game_over()) { S.over = null; return; }
  var r;
  if (chess.in_checkmate()) { var loser = chess.turn(); r = { winner: other(loser), reason: 'checkmate' }; }
  else if (chess.in_stalemate()) r = { winner: null, reason: 'stalemate' };
  else if (chess.in_threefold_repetition()) r = { winner: null, reason: 'threefold repetition' };
  else if (chess.insufficient_material()) r = { winner: null, reason: 'insufficient material' };
  else r = { winner: null, reason: 'the 50-move rule' };
  S.over = r;
}

function userMove(from, to, promo) {
  if (!myTurnLive()) return false;
  var legal = chess.moves({ verbose: true });
  var cands = legal.filter(function (m) { return m.from === from && m.to === to; });
  if (!cands.length) return false;
  if (cands.length > 1 && !promo) { showPromo(from, to); return true; }
  var ply = applyMove({ from: from, to: to, promotion: promo || cands[0].promotion }, 'you', legal.length);
  render();
  reviewPly(ply);
  if (!S.over) botTurn();
  return true;
}

function reviewPly(ply) {
  ply.review = { status: 'pending' };
  return Promise.all([analyze(ply.fenBefore), analyze(ply.fenAfter)]).then(function (res) {
    if (S.plies.indexOf(ply) < 0) return;
    var b = res[0], a = res[1];
    if (!b || !a) {
      if (coachEng.state === 'failed') { ply.review = { status: 'error' }; render(); return; }
      ply.retries = (ply.retries || 0) + 1;
      if (ply.retries <= 3) setTimeout(function () { if (S.plies.indexOf(ply) >= 0) reviewPly(ply); }, 300);
      return;
    }
    var me = S.me;
    var played = tryMove(ply.fenBefore, ply.uci).move;
    var evB = pov(b.score, ply.fenBefore, me), evA = pov(a.score, ply.fenAfter, me);
    var mateDelivered = new Chess(ply.fenAfter).in_checkmate();
    var grade = gradeMove({ moveNo: moveNoOf(ply.fenBefore), legalCount: ply.legalCount, playedUci: ply.uci, bestUci: b.bestmove, evB: evB, evA: evA, mateDelivered: mateDelivered });
    var opening = bookName(ply.fenAfter);
    var trusted = opening && (typeof DUBIOUS_OPENINGS === 'undefined' || DUBIOUS_OPENINGS.indexOf(opening) < 0);
    if (trusted && (grade !== 'mistake' && grade !== 'blunder') && grade !== 'forced' && !mateDelivered) grade = 'book';
    var ex = explainMove({ fenBefore: ply.fenBefore, fenAfter: ply.fenAfter, played: played, me: me, grade: grade, before: b, after: a, evB: evB, evA: evA, opening: opening });
    var best = b.bestmove ? tryMove(ply.fenBefore, b.bestmove) : null;
    ply.review = {
      status: 'done', grade: grade, evB: evB, evA: evA, opening: opening,
      bestUci: b.bestmove, bestSan: best ? best.move.san : null, bestFrom: best ? best.move.from : null, bestTo: best ? best.move.to : null,
      bestPv: (b.pv || []).slice(0, 12), replyPv: (a.pv || []).slice(0, 12),
      headline: ex.headline, body: ex.body, tip: ex.tip,
      acc: grade === 'forced' ? null : moveAccuracy(evB, evA)
    };
    save(); render();
  });
}

function botTurn() {
  if (S.over || chess.turn() === S.me) return;
  botThinking = true; render();
  var g = gen, t0 = Date.now(), fen = chess.fen(), L = LEVELS[S.settings.level];
  var legal = chess.moves({ verbose: true });
  var movetime = L.time, minDelay = 650;
  if (S.clock) {
    var left = clockLeft(other(S.me));
    movetime = Math.max(60, Math.min(L.time, left / 40 + S.clock.inc * 0.5));
    minDelay = Math.min(650, Math.max(120, left / 80));
  }
  var pick;
  if (Math.random() < L.random || botEng.state === 'failed') {
    var caps = legal.filter(function (m) { return m.captured; });
    var pool = botEng.state === 'failed' && caps.length && Math.random() < 0.6 ? caps : legal;
    pick = Promise.resolve(moveUci(pool[Math.floor(Math.random() * pool.length)]));
  } else {
    pick = botEng.go(fen, { skill: L.skill, depth: L.depth, movetime: movetime }).then(function (r) {
      if (r && r.bestmove) return r.bestmove;
      if (botEng.state === 'failed') return moveUci(legal[Math.floor(Math.random() * legal.length)]);
      return null;
    });
  }
  pick.then(function (uci) {
    if (g !== gen || !uci) return;
    return sleep(Math.max(0, minDelay - (Date.now() - t0))).then(function () {
      if (g !== gen || S.over) return;
      botThinking = false;
      if (chess.fen() !== fen) { render(); return; }
      applyMove(uciObj(uci), 'bot', legal.length);
      render();
      if (!S.over) analyze(chess.fen());
    });
  });
}

function truncateTo(k, why) {
  gen++;
  botEng.cancelAll();
  if (aiCtl) aiCtl.abort();
  S.plies.slice(k).forEach(function (p) {
    if (p.by !== 'you') return;
    var r = p.review && p.review.status === 'done' ? p.review : null;
    S.undos.push({ san: p.san, moveNo: moveNoOf(p.fenBefore), color: p.color, why: why || 'takeback', grade: r ? r.grade : null, acc: r ? r.acc : null, evB: r ? r.evB : null, evA: r ? r.evA : null });
  });
  S.plies = S.plies.slice(0, k);
  S.aiReview = null;
  chess = new Chess(S.startFen);
  S.plies.forEach(function (p) { chess.move(uciObj(p.uci)); });
  if (S.clock) {
    var last = S.plies[S.plies.length - 1];
    S.clock.w = last && last.clock ? last.clock.w : S.clock.base;
    S.clock.b = last && last.clock ? last.clock.b : S.clock.base;
  }
  S.turnStart = Date.now();
  S.over = null; checkOver();
  botThinking = false; view = { mode: 'live' }; sel = null; hint = { fen: null, stage: 0, move: null };
  coachIdx = null;
  save(); render();
  if (!S.over) { if (chess.turn() !== S.me) botTurn(); else analyze(chess.fen()); }
}
function takeBack() { var k = lastUserIdx(); if (k >= 0) truncateTo(k, 'takeback'); }
function resign() {
  if (S.over) return;
  if (Date.now() - resignArmed > 3000) { resignArmed = Date.now(); renderHeader(); setTimeout(renderHeader, 3100); return; }
  resignArmed = 0;
  if (S.clock && S.turnStart) S.clock[chess.turn()] = Math.max(0, clockLeft(chess.turn()));
  S.over = { winner: other(S.me), reason: 'resignation' };
  gen++; botEng.cancelAll(); botThinking = false; view = { mode: 'live' }; coachIdx = null;
  save(); render();
}

/* ---------- hint ---------- */
function useHint() {
  if (!myTurnLive()) return;
  var fen = chess.fen();
  if (hint.fen !== fen) hint = { fen: fen, stage: 0, move: null };
  hint.stage = Math.min(2, hint.stage + 1);
  render();
  analyze(fen).then(function (r) {
    if (!r || !r.bestmove || hint.fen !== fen) return;
    var t = tryMove(fen, r.bestmove);
    hint.move = t ? t.move : null;
    render();
  });
}

/* ---------- mistake drill ---------- */
function mistakeList() {
  var out = [];
  S.plies.forEach(function (p, i) { if (p.by === 'you' && p.review && p.review.status === 'done' && isBad(p.review.grade) && p.review.bestUci) out.push(i); });
  return out;
}
function startDrill() {
  var list = mistakeList();
  if (!list.length) return;
  view = { mode: 'drill', list: list, i: 0, status: 'try', attempt: null, solved: 0, revealed: false };
  orient = S.me; sel = null; render();
}
function drillPly() { return S.plies[view.list[view.i]]; }
function drillMove(from, to, promo) {
  if (view.mode !== 'drill' || view.status === 'checking' || view.status === 'right') return false;
  var p = drillPly(), c = new Chess(p.fenBefore);
  var legal = c.moves({ verbose: true }).filter(function (m) { return m.from === from && m.to === to; });
  if (!legal.length) return false;
  if (legal.length > 1 && !promo) { showPromo(from, to); return true; }
  var mv = c.move({ from: from, to: to, promotion: promo || legal[0].promotion });
  var uci = moveUci(mv), r = p.review;
  view.attempt = { uci: uci, san: mv.san, from: from, to: to };
  sel = null;
  if (uci === r.bestUci) { view.status = 'right'; view.alsoGood = false; if (!view.revealed) view.solved++; render(); return true; }
  view.status = 'checking'; render();
  var v = view;
  analyze(c.fen()).then(function (a) {
    if (view !== v) return;
    if (!a) { v.status = 'try'; render(); return; }
    var evA = pov(a.score, c.fen(), S.me), loss = winPct(povCp(r.evB)) - winPct(povCp(evA));
    if (loss <= 3 || c.in_checkmate()) { v.status = 'right'; v.alsoGood = true; if (!v.revealed) v.solved++; }
    else { v.status = 'wrong'; v.wrongEval = evA; v.wrongReply = a.pv && a.pv[0] ? tryMove(c.fen(), a.pv[0]) : null; }
    render();
  });
  return true;
}
function drillNext() {
  if (view.i + 1 >= view.list.length) { view.status = 'finished'; render(); return; }
  view.i++; view.status = 'try'; view.attempt = null; view.alsoGood = false; view.revealed = false; sel = null; render();
}

/* ---------- board rendering ---------- */
var boardEl, squaresEl, piecesEl, arrowsEl, badgesEl;
var PIECE_URL = {};
function sqPos(sq) {
  var f = FILES.indexOf(sq[0]), r = +sq[1];
  return orient === 'w' ? { c: f, r: 8 - r } : { c: 7 - f, r: r - 1 };
}
function sqAtXY(x, y) {
  var rc = boardEl.getBoundingClientRect();
  var c = Math.floor((x - rc.left) / (rc.width / 8)), r = Math.floor((y - rc.top) / (rc.height / 8));
  if (c < 0 || c > 7 || r < 0 || r > 7) return null;
  return orient === 'w' ? FILES[c] + (8 - r) : FILES[7 - c] + (r + 1);
}
function tf(pos) { return 'translate(' + pos.c * 100 + '%,' + pos.r * 100 + '%)'; }

function displayed() {
  var o = { fen: null, last: null, arrows: [], badge: null, interactive: false };
  if (view.mode === 'live') {
    o.fen = chess.fen();
    var lp = S.plies[S.plies.length - 1];
    if (lp) o.last = lp;
    o.interactive = myTurnLive();
    if (hint.fen === o.fen && hint.stage === 2 && hint.move) o.arrows.push({ from: hint.move.from, to: hint.move.to, kind: 'hint' });
    var k = lastUserIdx();
    if (k >= 0 && k >= S.plies.length - 2) {
      var up = S.plies[k];
      var onSq = new Chess(o.fen).get(up.to);
      if (coachVisible(up) && onSq && onSq.color === S.me) o.badge = { sq: up.to, grade: up.review.grade };
    }
  } else if (view.mode === 'ply') {
    o.fen = fenAt(view.n);
    o.last = view.n > 0 ? S.plies[view.n - 1] : null;
    o.arrows = view.arrows || [];
    if (view.arrows && view.arrows.length) o.last = null;
    var pp = view.n > 0 ? S.plies[view.n - 1] : null;
    if (pp && pp.by === 'you' && coachVisible(pp) && !(view.arrows && view.arrows.length)) o.badge = { sq: pp.to, grade: pp.review.grade };
  } else if (view.mode === 'line') {
    var steps = lineSans(view.baseFen, view.pv);
    o.fen = view.step > 0 && steps[view.step - 1] ? steps[view.step - 1].fen : view.baseFen;
    o.last = view.step > 0 ? steps[view.step - 1] : null;
    if (steps[view.step]) o.arrows.push({ from: steps[view.step].from, to: steps[view.step].to, kind: 'move' });
  } else if (view.mode === 'drill') {
    var dp = drillPly();
    o.fen = dp.fenBefore;
    o.last = S.plies[view.list[view.i] - 1] || null;
    o.interactive = view.status === 'try' || view.status === 'wrong';
    if (view.attempt && view.status === 'wrong') o.arrows.push({ from: view.attempt.from, to: view.attempt.to, kind: 'bad' });
    if (view.attempt && view.status === 'right') o.arrows.push({ from: view.attempt.from, to: view.attempt.to, kind: 'best' });
    if (view.attempt && view.status === 'checking') o.arrows.push({ from: view.attempt.from, to: view.attempt.to, kind: 'move' });
    if (view.revealed && view.status !== 'right') o.arrows.push({ from: dp.review.bestFrom, to: dp.review.bestTo, kind: 'best' });
  }
  return o;
}

function renderBoard() {
  var d = displayed(), c = new Chess(d.fen), b = c.board();
  boardChess = c;
  var legalTargets = {};
  if (d.interactive && sel) c.moves({ square: sel, verbose: true }).forEach(function (m) { legalTargets[m.to] = m.captured ? 'ring' : 'dot'; });
  var hintSq = view.mode === 'live' && d.interactive && hint.fen === d.fen && hint.stage >= 1 && hint.move ? hint.move.from : null;
  var checkSq = null;
  if (c.in_check()) { var t = c.turn(); for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) { var p = b[r][f]; if (p && p.type === 'k' && p.color === t) checkSq = rfSq(r, f); } }
  var html = '';
  for (var row = 0; row < 8; row++) for (var col = 0; col < 8; col++) {
    var sq = orient === 'w' ? FILES[col] + (8 - row) : FILES[7 - col] + (row + 1);
    var light = (FILES.indexOf(sq[0]) + +sq[1]) % 2 === 1;
    var cls = 'sq ' + (light ? 'l' : 'd');
    if (d.last && (d.last.from === sq || d.last.to === sq)) cls += ' last';
    if (sel === sq && d.interactive) cls += ' sel';
    if (hintSq === sq && hint.stage === 1) cls += ' hintsq';
    if (checkSq === sq) cls += ' chk';
    html += '<div class="' + cls + '" data-sq="' + sq + '">';
    if (col === 0) html += '<span class="co r">' + sq[1] + '</span>';
    if (row === 7) html += '<span class="co f">' + sq[0] + '</span>';
    if (legalTargets[sq]) html += '<span class="' + legalTargets[sq] + '"></span>';
    html += '</div>';
  }
  squaresEl.innerHTML = html;

  var ph = '';
  for (var r2 = 0; r2 < 8; r2++) for (var f2 = 0; f2 < 8; f2++) {
    var pc = b[r2][f2]; if (!pc) continue;
    var s2 = rfSq(r2, f2);
    ph += '<div class="pc" data-sq="' + s2 + '" style="background-image:url(' + PIECE_URL[pc.color + pc.type.toUpperCase()] + ');transform:' + tf(sqPos(s2)) + '"></div>';
  }
  piecesEl.innerHTML = ph;

  if (animNext && view.mode === 'live' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var a = animNext, moves = [[a.from, a.to]];
    if (a.flags.indexOf('k') >= 0) moves.push(a.color === 'w' ? ['h1', 'f1'] : ['h8', 'f8']);
    if (a.flags.indexOf('q') >= 0) moves.push(a.color === 'w' ? ['a1', 'd1'] : ['a8', 'd8']);
    moves.forEach(function (mv) {
      var el = piecesEl.querySelector('.pc[data-sq="' + mv[1] + '"]');
      if (!el) return;
      el.style.transform = tf(sqPos(mv[0]));
      void el.offsetWidth;
      el.classList.add('anim');
      el.style.transform = tf(sqPos(mv[1]));
    });
  }
  animNext = null;

  var ah = '';
  d.arrows.forEach(function (ar) { ah += arrowSvg(ar.from, ar.to, ar.kind); });
  arrowsEl.innerHTML = ah;

  if (d.badge) {
    var bp = sqPos(d.badge.sq), g = GRADES[d.badge.grade];
    badgesEl.innerHTML = '<div class="badge-on-board tone-' + d.badge.grade + '" style="left:' + bp.c * 12.5 + '%;top:' + bp.r * 12.5 + '%"><span>' + g.glyph + '</span></div>';
  } else badgesEl.innerHTML = '';
}
function arrowSvg(from, to, kind) {
  var a = sqPos(from), b = sqPos(to);
  var x1 = a.c + 0.5, y1 = a.r + 0.5, x2 = b.c + 0.5, y2 = b.r + 0.5;
  var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy), ux = dx / len, uy = dy / len;
  var head = 0.42, w = 0.15, hw = 0.24;
  var ex = x2 - ux * head, ey = y2 - uy * head, px = -uy, py = ux;
  var sx = x1 + ux * 0.18, sy = y1 + uy * 0.18;
  var color = { best: 'var(--arrow-best)', bad: 'var(--arrow-bad)', hint: 'var(--arrow-hint)', move: 'var(--arrow-move)' }[kind];
  var pts = [
    [sx + px * w / 2, sy + py * w / 2], [ex + px * w / 2, ey + py * w / 2], [ex + px * hw, ey + py * hw], [x2, y2],
    [ex - px * hw, ey - py * hw], [ex - px * w / 2, ey - py * w / 2], [sx - px * w / 2, sy - py * w / 2]
  ].map(function (p) { return p[0].toFixed(3) + ',' + p[1].toFixed(3); }).join(' ');
  return '<polygon points="' + pts + '" style="fill:' + color + '"/>';
}

/* ---------- pointer input ---------- */
var drag = null;
function tryBoardMove(from, to, promo) { return view.mode === 'drill' ? drillMove(from, to, promo) : userMove(from, to, promo); }
function onDown(e) {
  if (e.button && e.button !== 0) return;
  var d = displayed();
  if (!d.interactive) return;
  var sq = sqAtXY(e.clientX, e.clientY);
  if (!sq) return;
  var p = boardChess.get(sq);
  if (sel && sel !== sq && (!p || p.color !== S.me)) {
    if (tryBoardMove(sel, sq)) return;
  }
  if (p && p.color === S.me) {
    var justSelected = sel !== sq;
    sel = sq; renderBoard();
    var el = piecesEl.querySelector('.pc[data-sq="' + sq + '"]');
    drag = { sq: sq, el: el, x: e.clientX, y: e.clientY, moved: false, justSelected: justSelected, id: e.pointerId };
    try { boardEl.setPointerCapture(e.pointerId); } catch (x) {}
    e.preventDefault();
  } else { sel = null; renderBoard(); }
}
function onMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && dx * dx + dy * dy < 36) return;
  drag.moved = true;
  if (!drag.el) return;
  var rc = boardEl.getBoundingClientRect(), size = rc.width / 8;
  drag.el.classList.add('drag');
  drag.el.style.transform = 'translate(' + (e.clientX - rc.left - size / 2) + 'px,' + (e.clientY - rc.top - size / 2) + 'px)';
}
function onUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  var dr = drag; drag = null;
  var to = sqAtXY(e.clientX, e.clientY);
  if (dr.moved) {
    if (to && to !== dr.sq && tryBoardMove(dr.sq, to)) return;
    renderBoard();
  } else if (!dr.justSelected && to === dr.sq) { sel = null; renderBoard(); }
}
function showPromo(from, to) {
  renderBoard();
  var box = document.getElementById('promo');
  pendingPromo = { from: from, to: to };
  box.firstChild.innerHTML = ['q', 'r', 'b', 'n'].map(function (t) {
    return '<button type="button" data-promo="' + t + '" aria-label="Promote to ' + PNAME[t] + '" style="background-image:url(' + PIECE_URL[S.me + t.toUpperCase()] + ')"></button>';
  }).join('');
  box.hidden = false;
}

/* ---------- navigation ---------- */
function setView(v, idx) { view = v; if (idx !== undefined) coachIdx = idx; sel = null; render(); }
function goPly(n) {
  n = Math.max(0, Math.min(S.plies.length, n));
  if (n === S.plies.length) { view = { mode: 'live' }; coachIdx = null; }
  else { view = { mode: 'ply', n: n }; coachIdx = n > 0 ? n - 1 : null; }
  sel = null; render();
}
function openPly(k) { view = k === S.plies.length - 1 ? { mode: 'live' } : { mode: 'ply', n: k + 1 }; coachIdx = k; sel = null; render(); }
function nav(delta) {
  if (view.mode === 'line') {
    var len = lineSans(view.baseFen, view.pv).length;
    view.step = Math.max(0, Math.min(len, view.step + delta)); render(); return;
  }
  if (view.mode === 'drill') return;
  var cur = view.mode === 'ply' ? view.n : S.plies.length;
  goPly(cur + delta);
}
function backToGame() { view = { mode: 'live' }; coachIdx = null; sel = null; render(); }

/* ---------- side panel rendering ---------- */
function gchip(g, count) {
  return '<span class="gchip tone-' + g + '"><i>' + GRADES[g].glyph + '</i>' + GRADES[g].label + (count != null ? ' <b>' + count + '</b>' : '') + '</span>';
}
function renderModebar() {
  var el = document.getElementById('modebar'), cur = S.settings.coach;
  var opts = [['every', 'Every move'], ['mistakes', 'Mistakes'], ['after', 'After game']];
  el.innerHTML = '<span class="lbl">Coaching</span><div class="modes">' + opts.map(function (o) {
    return '<button type="button" data-mode="' + o[0] + '" aria-pressed="' + (cur === o[0]) + '"' + (S.over && o[0] === 'after' ? ' disabled' : '') + '>' + o[1] + '</button>';
  }).join('') + '</div>';
}
function renderHeader() {
  var r = document.getElementById('resignBtn');
  r.hidden = !S || !!S.over || !S.plies.length;
  var armed = Date.now() - resignArmed < 3000;
  r.textContent = armed ? 'Confirm resign' : 'Resign';
  r.classList.toggle('danger', armed);
}
function renderStrips() {
  var d = displayed(), b = new Chess(d.fen).board();
  var cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } }, init = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  b.forEach(function (row) { row.forEach(function (p) { if (p && p.type !== 'k') cnt[p.color][p.type]++; }); });
  var matW = 0; ['p', 'n', 'b', 'r', 'q'].forEach(function (t) { matW += (cnt.w[t] - cnt.b[t]) * VAL[t]; });
  function capsOf(color) {
    var h = '';
    ['q', 'r', 'b', 'n', 'p'].forEach(function (t) { for (var i = 0; i < Math.max(0, init[t] - cnt[color][t]); i++) h += '<i style="background-image:url(' + PIECE_URL[color + t.toUpperCase()] + ')"></i>'; });
    return h;
  }
  var me = S.me, opp = other(me), L = LEVELS[S.settings.level];
  var myAdv = me === 'w' ? matW : -matW;
  var liveTurn = view.mode === 'live' && !S.over;
  function clk(c) { return S.clock ? '<span class="clk" data-c="' + c + '"></span>' : ''; }
  var oppStatus = botThinking ? '<span class="clockdot thinking">Thinking<i></i><i></i><i></i></span>' : (liveTurn && chess.turn() === opp && !S.clock ? '<span class="clockdot"><span class="turnpip"></span>To move</span>' : '');
  var youStatus = liveTurn && chess.turn() === me && !botThinking && !S.clock ? '<span class="clockdot"><span class="turnpip"></span>Your move</span>' : '';
  var oppHtml = '<span class="who">' + L.name + ' bot<small>' + L.rating + '</small></span><span class="caps">' + capsOf(me) + (myAdv < 0 ? '<b>+' + -myAdv + '</b>' : '') + '</span><span class="right">' + oppStatus + clk(opp) + '</span>';
  var youHtml = '<span class="who">You<small>' + cname(me) + '</small></span><span class="caps">' + capsOf(opp) + (myAdv > 0 ? '<b>+' + myAdv + '</b>' : '') + '</span><span class="right">' + youStatus + clk(me) + '</span>';
  document.getElementById('oppStrip').innerHTML = orient === me ? oppHtml : youHtml;
  document.getElementById('youStrip').innerHTML = orient === me ? youHtml : oppHtml;
  updateClocks();
}
function renderEval() {
  if (!S) return;
  var d = displayed(), r = done.get(d.fen), bar = document.getElementById('evalbar');
  bar.classList.toggle('flip', orient === 'b');
  if (quietMode()) { bar.firstChild.style.height = '50%'; bar.title = 'Evaluation hidden until the game ends'; return; }
  if (!r) return;
  var w = pov(r.score, d.fen, 'w');
  bar.firstChild.style.height = winPct(povCp(w)).toFixed(1) + '%';
  bar.title = 'Evaluation ' + fmtEval(w) + ' (White\'s view)';
}
function renderControls() {
  var cur = view.mode === 'ply' ? view.n : S.plies.length;
  var prev = document.getElementById('prevBtn'), next = document.getElementById('nextBtn');
  if (view.mode === 'line') {
    var len = lineSans(view.baseFen, view.pv).length;
    prev.disabled = view.step <= 0; next.disabled = view.step >= len;
  } else if (view.mode === 'drill') { prev.disabled = true; next.disabled = true; }
  else { prev.disabled = cur <= 0; next.disabled = view.mode === 'live'; }
  document.getElementById('liveBtn').hidden = view.mode === 'live';
  document.getElementById('hintBtn').disabled = !(view.mode === 'live' && myTurnLive()) || coachEng.state === 'failed';
  document.getElementById('hintBtn').textContent = hint.fen === chess.fen() && hint.stage >= 1 ? (hint.stage === 1 ? 'Show move' : 'Hint shown') : 'Hint';
  document.getElementById('undoBtn').disabled = lastUserIdx() < 0 || view.mode === 'drill';
}

/* evaluation points for the graph: [{i (ply idx), wp (your win %)}] */
function evalSeries() {
  var pts = [], startR = done.get(S.startFen);
  pts.push({ i: -1, wp: startR ? winPct(povCp(pov(startR.score, S.startFen, S.me))) : 50 });
  S.plies.forEach(function (p, i) {
    var wp = null;
    if (p.by === 'you' && p.review && p.review.status === 'done') wp = winPct(povCp(p.review.evA));
    else { var r = done.get(p.fenAfter); if (r) wp = winPct(povCp(pov(r.score, p.fenAfter, S.me))); }
    if (wp != null) pts.push({ i: i, wp: wp });
  });
  return pts;
}
function graphSvg() {
  var pts = evalSeries();
  if (pts.length < 3) return '';
  var W = 320, H = 84, n = Math.max(S.plies.length, 2);
  function x(i) { return ((i + 1) / n) * W; }
  function y(wp) { return H - (wp / 100) * H; }
  var line = pts.map(function (p, k) { return (k ? 'L' : 'M') + x(p.i).toFixed(1) + ' ' + y(p.wp).toFixed(1); }).join(' ');
  var area = line + ' L' + x(pts[pts.length - 1].i).toFixed(1) + ' ' + H + ' L' + x(pts[0].i).toFixed(1) + ' ' + H + ' Z';
  var dots = '';
  S.plies.forEach(function (p, i) {
    if (p.by !== 'you' || !p.review || p.review.status !== 'done' || !isBad(p.review.grade)) return;
    dots += '<span class="gdot tone-' + p.review.grade + '" style="left:' + (x(i) / W * 100).toFixed(2) + '%;top:' + (y(winPct(povCp(p.review.evA))) / H * 100).toFixed(2) + '%" title="' + esc(plyLabel(i)) + ' ' + GRADES[p.review.grade].label + '"></span>';
  });
  var curI = view.mode === 'ply' ? view.n - 1 : (coachIdx != null ? coachIdx : null);
  var cur = curI != null && curI >= 0 ? '<line class="gcur" x1="' + x(curI).toFixed(1) + '" x2="' + x(curI).toFixed(1) + '" y1="0" y2="' + H + '" vector-effect="non-scaling-stroke"/>' : '';
  return '<div class="graph" id="evalGraph" role="img" aria-label="Your winning chances over the game"><div class="gplot"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
    '<path class="garea" d="' + area + '"/><line class="gmid" x1="0" x2="' + W + '" y1="' + H / 2 + '" y2="' + H / 2 + '" vector-effect="non-scaling-stroke"/>' + cur +
    '<path class="gline" d="' + line + '" vector-effect="non-scaling-stroke"/></svg>' + dots + '</div><div class="glabels"><span>Your winning chances, move by move</span><span>Tap to jump</span></div></div>';
}

function renderTally() {
  var el = document.getElementById('tally');
  var revs = S.plies.filter(function (p) { return p.by === 'you' && p.review && p.review.status === 'done'; });
  var hide = quietMode();
  var counts = {}; LEGEND.forEach(function (g) { counts[g] = 0; });
  var accs = [];
  revs.forEach(function (p) { if (counts[p.review.grade] != null) counts[p.review.grade]++; if (p.review.acc != null) accs.push(p.review.acc); });
  var acc = accs.length ? accs.reduce(function (a, b) { return a + b; }, 0) / accs.length : null;
  el.innerHTML = '<div class="tallytop"><div class="accwrap"><div class="acc">' + (hide || acc == null ? '<small>' + (hide ? 'hidden' : 'no moves yet') + '</small>' : acc.toFixed(1) + '<small>%</small>') + '</div>' +
    '<div class="acclbl">Your accuracy</div></div>' +
    '<div class="legend">' + LEGEND.map(function (g) { return gchip(g, hide ? '–' : counts[g]); }).join('') + '</div></div>' +
    (hide ? '' : graphSvg()) + assistLine();
}
function assistLine() {
  var u = S.undos.length, hn = S.plies.filter(function (p) { return p.by === 'you' && p.hinted; }).length;
  if (!u && !hn) return '';
  return '<div class="assistline"><span>Take-backs <b>' + u + '</b></span><span>Hints <b>' + hn + '</b></span></div>';
}

function renderSheet() {
  var grid = document.getElementById('sheetGrid');
  var opening = openingOf([S.startFen].concat(S.plies.map(function (p) { return p.fenAfter; })));
  document.getElementById('sheetMeta').textContent = opening || (S.plies.length ? 'Tap a move to review it' : '');
  if (!S.plies.length) { grid.innerHTML = '<div class="empty">Moves will be recorded here as you play.</div>'; return; }
  var curPly = view.mode === 'ply' ? view.n - 1 : (view.mode === 'line' ? view.plyIdx : (view.mode === 'drill' ? view.list[view.i] : (coachIdx != null ? coachIdx : -1)));
  var rows = {}, order = [];
  S.plies.forEach(function (p, i) {
    var n = moveNoOf(p.fenBefore);
    if (!rows[n]) { rows[n] = { w: null, b: null }; order.push(n); }
    rows[n][p.color] = i;
  });
  function cell(i) {
    if (i == null) return '<button class="mvb" type="button" disabled></button>';
    var p = S.plies[i], ann = '';
    if (p.by === 'you' && coachVisible(p)) ann = '<span class="ann tone-' + p.review.grade + '">' + GRADES[p.review.grade].glyph + '</span>';
    else if (p.by === 'you' && p.review && p.review.status === 'pending') ann = '<span class="ann" style="color:var(--muted)">…</span>';
    var tm = S.clock && p.timeMs != null ? '<span class="tm">' + fmtSecs(p.timeMs) + '</span>' : '';
    return '<button class="mvb' + (i === curPly ? ' cur' : '') + '" type="button" data-ply="' + i + '"><span class="' + (p.by === 'bot' ? 'bot' : '') + '">' + esc(p.san) + '</span><span class="mvr">' + tm + ann + '</span></button>';
  }
  grid.innerHTML = '<div class="colhead"><div>No.</div><div>White</div><div>Black</div></div>' + order.map(function (n) {
    return '<div class="rowm"><div class="no">' + n + '</div>' + cell(rows[n].w) + cell(rows[n].b) + '</div>';
  }).join('');
  var cur = grid.querySelector('.mvb.cur');
  if (view.mode === 'live' && (coachIdx == null || coachIdx >= S.plies.length - 2)) grid.scrollTop = grid.scrollHeight;
  else if (cur) { var gr = grid.getBoundingClientRect(), cr = cur.getBoundingClientRect(); if (cr.top < gr.top + 24 || cr.bottom > gr.bottom) grid.scrollTop += cr.top - gr.top - gr.height / 2; }
}

function evalRow(r) {
  var a = winPct(povCp(r.evB)), b = winPct(povCp(r.evA));
  return '<div class="evalrow"><span>Your eval <b>' + fmtEval(r.evB) + '</b> \u2192 <b>' + fmtEval(r.evA) + '</b></span><span>Win chance <b>' + Math.round(a) + '%</b> \u2192 <b>' + Math.round(b) + '%</b></span></div>';
}

function renderCoach() {
  var el = document.getElementById('coach'), h = '';
  if (coachEng.state === 'failed') h += '<p class="engine-error">The analysis engine could not start in this browser, so moves cannot be graded. You can still play against a simplified bot.</p>';
  if (view.mode === 'drill') { el.innerHTML = h + drillCard(); return; }
  if (view.mode === 'line') h += lineBox();
  if (view.mode === 'ply' && view.arrows && view.arrows.length && view.note) h += '<p class="tip"><strong>On the board.</strong> ' + esc(view.note) + '</p>';

  var live = view.mode === 'live';
  if (live && hint.fen === chess.fen() && hint.stage >= 1) {
    var hm = hint.move;
    h += '<p class="tip"><strong>Hint.</strong> ' + (!hm ? 'Thinking about it…' : hint.stage === 1 ? 'Look at your ' + PNAME[hm.piece] + ' on ' + hm.from + '. It has a strong move.' : 'Try ' + esc(hm.san) + '.') + '</p>';
  }

  var k = coachIdx != null ? coachIdx : (live ? lastUserIdx() : -1);
  if (view.mode === 'line') k = view.plyIdx;

  if (live && S.over && coachIdx == null) {
    h += gameOverCard(); el.innerHTML = h;
    var rv = document.getElementById('aiReview');
    if (rv && S.aiReview) rv.textContent = S.aiReview.text || 'Thinking\u2026';
    return;
  }

  if (k < 0 || !S.plies[k]) {
    if (view.mode === 'ply' && view.n === 0) h += '<div><div class="kicker">Start</div><h2>Starting position</h2></div><p>Step forward with the arrows, or tap any move on the scoresheet.</p>';
    else h += introCard();
    el.innerHTML = h; return;
  }
  var p = S.plies[k];
  if (p.by === 'bot') h += botCard(k);
  else h += userCard(k);
  if (S.over && view.mode !== 'line') h += '<div class="actions one"><button class="btn sm" type="button" data-act="summary">Back to the game summary</button></div>';
  el.innerHTML = h;
  var ans = document.getElementById('aiAns');
  if (ans && p.ai) { ans.textContent = p.ai.text || (p.ai.status === 'thinking' ? 'Thinking…' : ''); ans.classList.toggle('dim', !p.ai.text); }
}

function introCard() {
  var waiting = botThinking || (chess.turn() !== S.me && !S.over);
  var cd = clockDef();
  return '<div><div class="kicker">Coach' + (cd.base ? ' · ' + cd.label + ' ' + cd.sub.toLowerCase() : '') + '</div><h2>' + (waiting ? 'The bot moves first' : 'Your move') + '</h2></div>' +
    '<p>Play a move and Stockfish will grade it, show you what it would have played, and explain why. Stuck? Tap Hint for a nudge. You can tap any move on the scoresheet later to review it.' + (cd.base ? ' Your clock is running while you read, so glance and keep moving.' : '') + '</p>' +
    '<div class="legend">' + LEGEND.map(function (g) { return gchip(g); }).join('') + '</div>';
}

function botCard(k) {
  var p = S.plies[k], L = LEVELS[S.settings.level], r = done.get(p.fenAfter);
  var h = '<div><div class="kicker">Move ' + moveNoOf(p.fenBefore) + ' · ' + L.name + ' bot</div><h2>The bot played ' + esc(p.san) + '</h2></div>';
  var bk = bookName(p.fenAfter);
  if (bk && !quietMode()) h += '<p>A book move in the ' + esc(bk) + '.</p>';
  if (r && !quietMode()) {
    var ev = pov(r.score, p.fenAfter, S.me);
    var rb = r.bestmove ? tryMove(p.fenAfter, r.bestmove) : null;
    h += '<p>After this move you are ' + evalWords(ev) + ' (' + fmtEval(ev) + ').' + (rb ? ' Your best reply was ' + esc(rb.move.san) + '.' : '') + '</p>';
  }
  var nx = S.plies[k + 1];
  if (nx && nx.by === 'you') h += '<div class="actions"><button class="btn sm" type="button" data-act="open" data-k="' + (k + 1) + '">See your reply</button></div>';
  return h;
}

function kickerFor(p, r) {
  var parts = ['Move ' + moveNoOf(p.fenBefore)];
  if (r && GRADES[r.grade]) parts.push(GRADES[r.grade].label);
  if (p.timeMs != null && (S.clock || S.over)) parts.push(fmtSecs(p.timeMs));
  if (p.hinted) parts.push(p.hinted === 2 ? 'Hint used' : 'Nudge used');
  return parts.join(' \u00b7 ');
}

function userCard(k) {
  var p = S.plies[k], r = p.review, live = view.mode === 'live', n = moveNoOf(p.fenBefore);
  if (!r || r.status === 'pending') return '<div class="pending"><span class="spin"></span><span>Checking ' + esc(p.san) + '…</span></div>';
  if (r.status === 'error') return '<div><div class="kicker">Move ' + n + '</div><h2>' + esc(p.san) + '</h2></div><p>This move could not be analyzed.</p>';
  if (quietMode()) return '<div><div class="kicker">Move ' + n + '</div><h2>You played ' + esc(p.san) + '</h2></div><p>Coaching is set to after the game. Every move is being graded quietly, and the full review opens when the game ends.</p>';
  var g = GRADES[r.grade];
  var verdict = '<div class="verdict tone-' + r.grade + '"><div class="glyph">' + g.glyph + '</div><div><div class="kicker">' + esc(kickerFor(p, r)) + '</div><h2>' + esc(r.headline) + '</h2></div></div>';
  if (S.settings.coach === 'mistakes' && !S.over && live && !isBad(r.grade) && !expanded[k]) {
    return verdict + '<div class="actions"><button class="btn sm" type="button" data-act="expand" data-k="' + k + '">Show details</button></div>';
  }
  var h = verdict + '<p>' + esc(r.body.join(' ')) + '</p>';
  if (r.grade !== 'forced') h += evalRow(r);
  if (r.tip) h += '<p class="tip"><strong>Principle.</strong> ' + esc(r.tip) + '</p>';
  var showBetter = r.bestSan && r.bestUci !== p.uci && ['forced', 'book', 'best'].indexOf(r.grade) < 0;
  if (showBetter) {
    h += '<div class="better"><span class="lbl">Engine\'s choice</span><span class="mv">' + esc((p.color === 'w' ? n + '. ' : n + '... ') + r.bestSan) + '</span><span class="ln">' + esc(lineText(p.fenBefore, r.bestPv, 8)) + '</span></div>';
  }
  h += '<div class="actions">';
  if (showBetter) {
    h += '<button class="btn sm" type="button" data-act="showbest" data-k="' + k + '">Show on board</button>';
    h += '<button class="btn sm" type="button" data-act="bestline" data-k="' + k + '">Play best line</button>';
  }
  if (r.replyPv && r.replyPv.length) h += '<button class="btn sm" type="button" data-act="reply" data-k="' + k + '">' + (isBad(r.grade) ? 'See the punishment' : 'What happens next') + '</button>';
  h += '<button class="btn sm" type="button" data-act="retry" data-k="' + k + '">' + (k === lastUserIdx() && !S.over ? 'Retry this move' : 'Retry from here') + '</button>';
  h += '</div>';
  if (sampleFn && !aiHidden) {
    var ai = p.ai || null, busy = ai && (ai.status === 'thinking' || ai.status === 'stream');
    h += '<div class="ask">';
    if (!ai) h += '<button class="btn sm" type="button" data-act="ai" data-k="' + k + '">Ask Claude to explain</button>';
    else {
      h += '<div class="who">' + (ai.q ? 'You asked: ' + esc(ai.q) : 'Claude explains') + '</div><div class="ans' + (ai.text ? '' : ' dim') + '" id="aiAns"></div>';
      if (ai.status === 'error') h += '<p class="engine-error">' + esc(ai.msg || 'Claude could not answer right now.') + '</p>';
    }
    h += '<form class="row" data-askform="' + k + '"><input id="askInput" type="text" placeholder="Ask about this move…" autocomplete="off" maxlength="300"' + (busy ? ' disabled' : '') + '><button class="btn sm" type="submit"' + (busy ? ' disabled' : '') + '>Ask</button></form>';
    h += '</div>';
  }
  return h;
}

function lineBox() {
  var steps = lineSans(view.baseFen, view.pv);
  var n = moveNoOf(view.baseFen), t = turnOf(view.baseFen), parts = [];
  parts.push('<button type="button" data-step="0" class="' + (view.step === 0 ? 'on' : '') + '">start</button>');
  steps.forEach(function (s, i) {
    if (t === 'w') parts.push('<span class="num">' + n + '.</span>');
    else if (i === 0) parts.push('<span class="num">' + n + '...</span>');
    parts.push('<button type="button" data-step="' + (i + 1) + '" class="' + (view.step === i + 1 ? 'on' : '') + '">' + esc(s.san) + '</button>');
    if (t === 'b') n++;
    t = other(t);
  });
  return '<div class="linebox"><div class="kicker">' + esc(view.label) + '</div><div class="steps">' + parts.join('') + '</div>' +
    '<div class="actions"><button class="btn sm" type="button" data-act="linenext">' + (view.step >= steps.length ? 'End of line' : 'Next move') + '</button><button class="btn sm" type="button" data-act="lineexit">Exit line</button></div></div>';
}

function drillCard() {
  var total = view.list.length;
  if (view.status === 'finished') {
    return '<div><div class="kicker">Practice</div><h2>' + view.solved + ' of ' + total + ' solved</h2></div>' +
      '<p>' + (view.solved === total ? 'Every one. Those are the moments that cost you this game, and now you have found the fix for each.' : 'The ones you missed are worth another look. Run it again and they will come faster.') + '</p>' +
      '<div class="actions"><button class="btn sm" type="button" data-act="drillagain">Practice again</button><button class="btn sm primary" type="button" data-act="drillexit">Back to the game</button></div>';
  }
  var p = drillPly(), r = p.review, n = moveNoOf(p.fenBefore);
  var h = '<div><div class="kicker">Practice · ' + (view.i + 1) + ' of ' + total + ' · Move ' + n + '</div><h2>';
  if (view.status === 'right') h += view.alsoGood ? esc(view.attempt.san) + ' works too' : esc(view.attempt.san) + ' is it';
  else if (view.status === 'wrong' && view.attempt) h += esc(view.attempt.san) + ' is not it';
  else if (view.status === 'checking') h += 'Checking ' + esc(view.attempt.san) + '…';
  else h += 'Find a better move than ' + esc(p.san);
  h += '</h2></div>';
  if (view.status === 'try') h += '<p>In the game you played ' + esc(p.san) + ' here (' + GRADES[r.grade].label.toLowerCase() + '). Find the move that keeps your position together. Look at checks, captures and threats first.</p>';
  if (view.status === 'checking') h += '<div class="pending"><span class="spin"></span><span>Asking the engine…</span></div>';
  if (view.status === 'wrong' && view.attempt) {
    var rep = view.wrongReply ? view.wrongReply.move.san : null;
    h += '<p>' + (rep ? 'Your opponent answers ' + esc(rep) + ', and you would be ' + evalWords(view.wrongEval) + ' (' + fmtEval(view.wrongEval) + ').' : 'That leaves you ' + evalWords(view.wrongEval) + '.') + ' Try again.</p>';
  }
  if (view.revealed && view.status !== 'right') h += '<p class="tip"><strong>Answer.</strong> ' + esc(r.bestSan) + ', the green arrow. Play it on the board to continue.</p>';
  if (view.status === 'right') {
    var bestBody = r.body.filter(function (s) { return /^Better was|^Instead|^You had a forced/.test(s); }).join(' ');
    h += '<p>' + (view.alsoGood ? 'The engine\'s top choice was ' + esc(r.bestSan) + ', but yours keeps the position just as healthy.' : (bestBody ? esc(bestBody) : 'That is the engine\'s choice.')) + '</p>';
  }
  h += '<div class="actions">';
  if (view.status === 'right') h += '<button class="btn sm primary" type="button" data-act="drillnext">' + (view.i + 1 >= total ? 'Finish' : 'Next position') + '</button>';
  else {
    if (!view.revealed) h += '<button class="btn sm" type="button" data-act="drillreveal">Show the answer</button>';
    h += '<button class="btn sm" type="button" data-act="drillskip">' + (view.i + 1 >= total ? 'Finish' : 'Skip') + '</button>';
  }
  h += '<button class="btn sm" type="button" data-act="drillexit">Stop practicing</button></div>';
  return h;
}

function gameGrade() {
  var revs = S.plies.filter(function (p) { return p.by === 'you' && p.review && p.review.status === 'done' && p.review.grade !== 'forced'; }).map(function (p) { return p.review; });
  if (revs.length < 5) return null;
  var accOf = function (list) { var a = list.filter(function (r) { return r.acc != null; }); return a.length ? a.reduce(function (t, r) { return t + r.acc; }, 0) / a.length : null; };
  var acc = accOf(revs);
  var phases = { opening: [], middlegame: [], endgame: [] };
  S.plies.forEach(function (p) { if (p.by === 'you' && p.review && p.review.status === 'done' && p.review.grade !== 'forced') phases[phaseOf(p.fenBefore)].push(p.review); });
  var undone = S.undos.filter(function (u) { return u.acc != null; });
  var withUndos = undone.length ? accOf(revs.concat(undone)) : null;
  return { acc: acc, letter: letterGrade(acc), rating: ratingEstimate(acc, acplOf(revs)), n: revs.length,
    phases: { opening: accOf(phases.opening), middlegame: accOf(phases.middlegame), endgame: accOf(phases.endgame) },
    withUndos: withUndos, hints: S.plies.filter(function (p) { return p.by === 'you' && p.hinted; }).length };
}
function gradeTone(letter) { return /^A/.test(letter) ? 'best' : /^B/.test(letter) ? 'good' : /^C/.test(letter) ? 'inaccuracy' : /^D/.test(letter) ? 'mistake' : 'blunder'; }
function assistText(gg) {
  var u = S.undos.length, parts = [];
  var hints = S.plies.filter(function (p) { return p.by === 'you' && p.hinted; }).length;
  if (u) {
    var bad = S.undos.filter(function (x) { return x.grade && isBad(x.grade); });
    parts.push('you took back ' + (u === 1 ? 'one move' : u + ' moves') + (bad.length ? ' (' + (bad.length === 1 ? (u === 1 ? 'it was' : 'one was') + (/^[aeiou]/i.test(GRADES[bad[0].grade].label) ? ' an ' : ' a ') + GRADES[bad[0].grade].label.toLowerCase() : bad.length + ' were mistakes or worse') + ')' : ''));
  }
  if (hints) parts.push('used ' + (hints === 1 ? 'one hint' : hints + ' hints'));
  if (!parts.length) return 'No take-backs and no hints. That grade is all you.';
  var t = parts.join(' and ') + '.';
  if (gg && gg.withUndos != null) t += ' Counting the moves you took back, your accuracy was ' + gg.withUndos.toFixed(1) + '%.';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function gradeBlock(gg) {
  function ph(name, v) { return '<div><span>' + name + '</span><b>' + (v == null ? '–' : Math.round(v) + '%') + '</b></div>'; }
  return '<div class="gradebox"><div class="letter tone-' + gradeTone(gg.letter) + '">' + gg.letter + '</div><div class="gradeinfo"><div class="kicker">Game grade</div>' +
    '<div class="gline1"><b>' + gg.acc.toFixed(1) + '%</b> accuracy · played like a <b>~' + gg.rating + '</b></div>' +
    '<div class="phases">' + ph('Opening', gg.phases.opening) + ph('Middlegame', gg.phases.middlegame) + ph('Endgame', gg.phases.endgame) + '</div></div></div>' +
    '<p class="assist">' + esc(assistText(gg)) + '</p>' +
    '<p class="fine">The rating is a rough estimate from how much evaluation your moves gave away, not an official rating. Short games swing a lot.</p>';
}

function insights() {
  var mine = S.plies.filter(function (p) { return p.by === 'you' && p.timeMs != null && p.review && p.review.status === 'done'; });
  if (mine.length < 3) return '';
  var avg = mine.reduce(function (a, p) { return a + p.timeMs; }, 0) / mine.length;
  var bad = mine.filter(function (p) { return p.review.grade === 'mistake' || p.review.grade === 'blunder'; });
  var fast = bad.filter(function (p) { return p.timeMs < 6000; });
  var slowest = mine.reduce(function (a, p) { return p.timeMs > a.timeMs ? p : a; }, mine[0]);
  var out = '<li>You took ' + fmtSecs(avg) + ' per move on average.</li>';
  if (bad.length && fast.length * 2 >= bad.length) out += '<li>' + (bad.length === 1 ? 'Your one big mistake' : fast.length + ' of your ' + bad.length + ' mistakes and blunders') + ' came in under 6 seconds. A quick scan for captures, checks and threats before those moves would have caught ' + (fast.length === 1 ? 'it' : 'most of them') + '.</li>';
  else if (bad.length) out += '<li>Your mistakes were not rushed (about ' + fmtSecs(bad.reduce(function (a, p) { return a + p.timeMs; }, 0) / bad.length) + ' each), so the fix is what you look for, not how fast you move.</li>';
  out += '<li>Your longest think was ' + esc(plyLabel(S.plies.indexOf(slowest))) + ' at ' + fmtSecs(slowest.timeMs) + ' (' + GRADES[slowest.review.grade].label.toLowerCase() + ').</li>';
  return '<ul class="insights">' + out + '</ul>';
}

function gameOverCard() {
  var o = S.over, me = S.me, title;
  if (o.reason === 'resignation') title = 'You resigned';
  else if (o.reason === 'time') title = o.winner === me ? 'You won on time' : 'You lost on time';
  else if (o.winner) title = o.winner === me ? 'You won by checkmate' : 'You lost by checkmate';
  else title = 'Draw by ' + o.reason;
  var bad = mistakeList();
  var ordered = bad.slice().sort(function (a, b) { return GRADE_ORDER.indexOf(S.plies[b].review.grade) - GRADE_ORDER.indexOf(S.plies[a].review.grade); });
  var pending = S.plies.some(function (p) { return p.by === 'you' && p.review && p.review.status === 'pending'; });
  var opening = openingOf([S.startFen].concat(S.plies.map(function (p) { return p.fenAfter; })));
  var h = '<div><div class="kicker">Game over' + (opening ? ' · ' + esc(opening) : '') + '</div><h2>' + title + '</h2></div>';
  if (pending) h += '<div class="pending"><span class="spin"></span><span>Finishing the review…</span></div>';
  var gg = gameGrade();
  if (gg && !pending) h += gradeBlock(gg);
  else if (!gg && !pending) h += '<p class="assist">' + esc(assistText(null)) + '</p>';
  h += '<p>' + (bad.length ? 'Here are the moments that mattered most. Tap one to see what went wrong, or practice finding the right move in each.' : 'No inaccuracies, mistakes or blunders. Tap any move on the scoresheet to review it.') + '</p>';
  if (ordered.length) {
    h += '<div class="actions">' + ordered.slice(0, 6).map(function (i) {
      var p = S.plies[i];
      return '<button class="btn sm" type="button" data-act="open" data-k="' + i + '"><span class="gchip tone-' + p.review.grade + '"><i>' + GRADES[p.review.grade].glyph + '</i></span>' + esc(plyLabel(i)) + '</button>';
    }).join('') + '</div>';
  }
  h += insights();
  if (sampleFn && !aiHidden && gg && !pending) {
    var ar = S.aiReview;
    h += '<div class="ask">';
    if (!ar) h += '<button class="btn sm" type="button" data-act="aireview">Ask Claude to review this game</button>';
    else {
      h += '<div class="who">Claude\'s review</div><div class="ans' + (ar.text ? '' : ' dim') + '" id="aiReview"></div>';
      if (ar.status === 'error') h += '<p class="engine-error">' + esc(ar.msg) + '</p>';
    }
    h += '</div>';
  }
  h += '<div class="actions">';
  if (bad.length) h += '<button class="btn sm primary" type="button" data-act="drill">Practice mistakes (' + bad.length + ')</button>';
  h += '<button class="btn sm" type="button" data-act="review0">Review from the start</button><button class="btn sm' + (bad.length ? '' : ' primary') + '" type="button" data-act="new">New game</button></div>';
  return h;
}

function render() {
  if (!S) return;
  renderHeader(); renderModebar(); renderBoard(); renderStrips(); renderControls(); renderCoach(); renderSheet(); renderTally(); renderEval();
}

/* ---------- Claude ---------- */
function pieceList(fen) {
  var b = new Chess(fen).board(), out = { w: [], b: [] };
  b.forEach(function (row, r) { row.forEach(function (p, f) { if (p) out[p.color].push((p.type === 'p' ? '' : p.type.toUpperCase()) + rfSq(r, f)); }); });
  return 'White: ' + out.w.join(' ') + '. Black: ' + out.b.join(' ') + '.';
}
function coachPrompt(k, q) {
  var p = S.plies[k], r = p.review, me = S.me;
  var hist = lineText(S.startFen, S.plies.slice(0, k + 1).map(function (x) { return x.uci; }));
  return [
    'You are a patient chess coach talking to an improving player. Use only the engine facts below for concrete claims about tactics or lines; do not invent variations they do not support.',
    'The student plays ' + cname(me) + '.',
    'Game so far: ' + hist,
    r.opening ? 'Opening: ' + r.opening + '.' : '',
    'Position before the student\'s move (FEN): ' + p.fenBefore,
    'Pieces before the move: ' + pieceList(p.fenBefore),
    'Student played: ' + p.san + '. Grade: ' + GRADES[r.grade].label + '. Evaluation for the student went from ' + fmtEval(r.evB) + ' to ' + fmtEval(r.evA) + ' (in pawns; positive is good for the student).',
    p.timeMs != null && S.clock ? 'The student spent ' + fmtSecs(p.timeMs) + ' on this move in a timed game.' : '',
    r.bestSan ? 'Engine\'s best move instead: ' + r.bestSan + '. Engine line from the position before the move: ' + lineText(p.fenBefore, r.bestPv, 8) + '.' : '',
    r.replyPv && r.replyPv.length ? 'Opponent\'s best reply to the student\'s move, with the line that follows: ' + lineText(p.fenAfter, r.replyPv, 8) + '.' : '',
    'Automatic notes: ' + r.headline + '. ' + r.body.join(' ') + (r.tip ? ' ' + r.tip : ''),
    q ? 'The student asks: "' + q + '". Answer that directly in at most five short sentences.' : 'In two to four short sentences, explain why this move deserves its grade and what idea the engine\'s move has. Name concrete pieces and squares. Speak to the student as "you".',
    'Plain text only. No headings, lists, markdown, or em dashes.'
  ].filter(Boolean).join('\n');
}
function askClaude(k, q) {
  if (!sampleFn) return;
  var p = S.plies[k];
  if (aiCtl) aiCtl.abort();
  var ctl = aiCtl = new AbortController();
  p.ai = { status: 'thinking', text: '', q: q || null };
  render();
  var opts = {
    signal: ctl.signal,
    onText: function (u) {
      p.ai.text = u.text; p.ai.status = 'stream';
      var el = document.getElementById('aiAns');
      if (el && coachShowing(k)) { el.textContent = u.text; el.classList.remove('dim'); }
    }
  };
  if (q) opts.cache = false;
  sampleFn(coachPrompt(k, q), opts).then(function (res) {
    p.ai = { status: 'done', text: res.text, q: q || null }; save(); render();
  }).catch(function (e) {
    var code = e && e.code;
    if (code === 'cancelled') { if (p.ai && p.ai.status !== 'done') p.ai = p.ai.text ? { status: 'done', text: p.ai.text, q: p.ai.q } : null; render(); return; }
    if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].indexOf(code) >= 0) { aiHidden = true; p.ai = null; render(); return; }
    var msg = code === 'rate_limited' ? 'Too many questions at once. Try again in a minute.' : code === 'session_expired' ? 'Sign in to Claude again to ask questions.' : 'Claude could not answer right now. Try again.';
    p.ai = { status: 'error', text: code === 'refused' ? '' : (e && e.text) || '', q: q || null, msg: msg }; render();
  });
}
function reviewPrompt() {
  var gg = gameGrade(), me = S.me, o = S.over;
  var lines = S.plies.map(function (p, i) {
    var s = plyLabel(i);
    if (p.by === 'you' && p.review && p.review.status === 'done') {
      s += ' [you: ' + GRADES[p.review.grade].label + ', eval ' + fmtEval(p.review.evB) + ' to ' + fmtEval(p.review.evA) + (p.review.bestSan && isBad(p.review.grade) ? ', best was ' + p.review.bestSan : '') + (p.timeMs != null && S.clock ? ', ' + fmtSecs(p.timeMs) : '') + (p.hinted ? ', used a hint' : '') + ']';
    } else s += ' [bot]';
    return s;
  });
  var result = o.reason === 'resignation' ? 'the student resigned' : o.winner ? (o.winner === me ? 'the student won' : 'the student lost') + ' by ' + (o.reason === 'time' ? 'time' : o.reason) : 'draw by ' + o.reason;
  return [
    'You are a friendly chess coach reviewing a finished game with an improving player. Base every concrete claim on the move-by-move engine grades below; do not invent lines.',
    'The student played ' + cname(me) + ' against a ' + LEVELS[S.settings.level].name + ' level bot (' + LEVELS[S.settings.level].rating + '). Clock: ' + clockDef().label + '. Result: ' + result + '.',
    gg ? 'Game grade ' + gg.letter + ', accuracy ' + gg.acc.toFixed(1) + '%, estimated strength about ' + gg.rating + '. Phase accuracy: opening ' + (gg.phases.opening == null ? 'n/a' : Math.round(gg.phases.opening)) + ', middlegame ' + (gg.phases.middlegame == null ? 'n/a' : Math.round(gg.phases.middlegame)) + ', endgame ' + (gg.phases.endgame == null ? 'n/a' : Math.round(gg.phases.endgame)) + '.' : '',
    'Assistance: ' + assistText(gg),
    'Moves:', lines.join('\n'),
    'Write a short review in plain text, two short paragraphs at most: what went well, the one pattern behind the mistakes (name the moves), and one concrete habit to practice next game. Speak to the student as "you". No headings, lists, markdown, or em dashes.'
  ].filter(Boolean).join('\n');
}
function askReview() {
  if (!sampleFn || !S.over) return;
  if (aiCtl) aiCtl.abort();
  var ctl = aiCtl = new AbortController();
  S.aiReview = { status: 'thinking', text: '' };
  render();
  sampleFn(reviewPrompt(), {
    signal: ctl.signal,
    onText: function (u) { S.aiReview.text = u.text; var el = document.getElementById('aiReview'); if (el) { el.textContent = u.text; el.classList.remove('dim'); } }
  }).then(function (res) { S.aiReview = { status: 'done', text: res.text }; save(); render(); })
    .catch(function (e) {
      var code = e && e.code;
      if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].indexOf(code) >= 0) { aiHidden = true; S.aiReview = null; render(); return; }
      if (code === 'cancelled') { S.aiReview = S.aiReview && S.aiReview.text ? { status: 'done', text: S.aiReview.text } : null; render(); return; }
      S.aiReview = { status: 'error', text: (e && e.text) || '', msg: code === 'rate_limited' ? 'Too many requests at once. Try again in a minute.' : 'Claude could not answer right now. Try again.' }; render();
    });
}
function coachShowing(k) {
  var cur = coachIdx != null ? coachIdx : (view.mode === 'live' ? lastUserIdx() : -1);
  if (view.mode === 'line') cur = view.plyIdx;
  return cur === k;
}

/* ---------- setup sheet ---------- */
function openSetup() {
  var st = S ? S.settings : defaultSettings();
  document.getElementById('levelOpts').innerHTML = LEVELS.map(function (L, i) {
    return '<label class="opt"><input type="radio" name="level" value="' + i + '" id="lvl' + i + '"' + (i === st.level ? ' checked' : '') + '><strong>' + L.name + '</strong><span class="rt">' + L.rating + '</span><span class="d">' + L.desc + '</span></label>';
  }).join('');
  document.getElementById('clockOpts').innerHTML = CLOCKS.map(function (c, i) {
    return '<label class="opt"><input type="radio" name="clock" value="' + c.id + '" id="clk' + i + '"' + (c.id === (st.clock || 'none') ? ' checked' : '') + '><strong>' + c.label + '</strong><span class="d">' + c.sub + '</span></label>';
  }).join('');
  document.querySelector('input[name=color][value="' + st.color + '"]').checked = true;
  document.querySelector('input[name=coach][value="' + st.coach + '"]').checked = true;
  document.getElementById('setup').hidden = false;
  setTimeout(function () { var c = document.querySelector('input[name=level]:checked'); if (c) c.focus(); }, 30);
}
function closeSetup() { document.getElementById('setup').hidden = true; }

/* ---------- wiring ---------- */
function wire() {
  boardEl = document.getElementById('board'); squaresEl = document.getElementById('squares'); piecesEl = document.getElementById('pieces');
  arrowsEl = document.getElementById('arrows'); badgesEl = document.getElementById('boardBadges');
  boardEl.addEventListener('pointerdown', onDown);
  boardEl.addEventListener('pointermove', onMove);
  boardEl.addEventListener('pointerup', onUp);
  boardEl.addEventListener('pointercancel', function () { drag = null; renderBoard(); });
  boardEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.getElementById('promo').addEventListener('click', function (e) {
    var b = e.target.closest('[data-promo]');
    document.getElementById('promo').hidden = true;
    if (b && pendingPromo) tryBoardMove(pendingPromo.from, pendingPromo.to, b.getAttribute('data-promo'));
    else renderBoard();
    pendingPromo = null;
  });
  document.getElementById('prevBtn').onclick = function () { nav(-1); };
  document.getElementById('nextBtn').onclick = function () { nav(1); };
  document.getElementById('liveBtn').onclick = backToGame;
  document.getElementById('hintBtn').onclick = useHint;
  document.getElementById('undoBtn').onclick = takeBack;
  document.getElementById('flipBtn').onclick = function () { orient = other(orient); save(); render(); };
  document.getElementById('newBtn').onclick = openSetup;
  document.getElementById('resignBtn').onclick = resign;
  document.getElementById('setupCancel').onclick = closeSetup;
  document.getElementById('setup').addEventListener('click', function (e) { if (e.target.id === 'setup') closeSetup(); });
  document.getElementById('setupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var st = {
      level: +f.querySelector('input[name=level]:checked').value, color: f.querySelector('input[name=color]:checked').value,
      coach: f.querySelector('input[name=coach]:checked').value, clock: f.querySelector('input[name=clock]:checked').value
    };
    closeSetup(); newGame(st);
  });
  document.getElementById('sheetGrid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ply]'); if (!b) return;
    openPly(+b.getAttribute('data-ply'));
  });
  document.getElementById('tally').addEventListener('click', function (e) {
    var g = e.target.closest('.gplot'); if (!g || !S.plies.length) return;
    var rc = g.getBoundingClientRect(), n = Math.max(S.plies.length, 2);
    var i = Math.round(((e.clientX - rc.left) / rc.width) * n) - 1;
    i = Math.max(0, Math.min(S.plies.length - 1, i));
    if (S.plies[i].by !== 'you' && S.plies[i - 1] && S.plies[i - 1].by === 'you') i = i - 1;
    openPly(i);
  });
  document.getElementById('modebar').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mode]'); if (!b || b.disabled) return;
    S.settings.coach = b.getAttribute('data-mode'); save(); render();
  });
  var coach = document.getElementById('coach');
  coach.addEventListener('click', function (e) {
    var st = e.target.closest('[data-step]');
    if (st && view.mode === 'line') { view.step = +st.getAttribute('data-step'); render(); return; }
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), k = +b.getAttribute('data-k'), p = S.plies[k];
    if (act === 'expand') { expanded[k] = true; render(); }
    else if (act === 'open') openPly(k);
    else if (act === 'showbest') setView({ mode: 'ply', n: k, arrows: [{ from: p.from, to: p.to, kind: 'bad' }, { from: p.review.bestFrom, to: p.review.bestTo, kind: 'best' }], note: 'This is the position before your move. The green arrow is ' + p.review.bestSan + ', the red one is your ' + p.san + '.' }, k);
    else if (act === 'bestline') setView({ mode: 'line', baseFen: p.fenBefore, pv: p.review.bestPv, step: 1, label: 'Engine line instead of ' + p.san, plyIdx: k }, k);
    else if (act === 'reply') setView({ mode: 'line', baseFen: p.fenAfter, pv: p.review.replyPv, step: 1, label: 'Best play after ' + p.san, plyIdx: k }, k);
    else if (act === 'retry') truncateTo(k, 'retry');
    else if (act === 'linenext') nav(1);
    else if (act === 'lineexit') openPly(view.plyIdx);
    else if (act === 'ai') askClaude(k, null);
    else if (act === 'aireview') askReview();
    else if (act === 'review0') goPly(1);
    else if (act === 'new') openSetup();
    else if (act === 'summary') backToGame();
    else if (act === 'drill' || act === 'drillagain') startDrill();
    else if (act === 'drillnext' || act === 'drillskip') drillNext();
    else if (act === 'drillreveal') { view.revealed = true; if (view.status !== 'wrong') view.status = 'try'; render(); }
    else if (act === 'drillexit') backToGame();
  });
  coach.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-askform]'); if (!f) return;
    e.preventDefault();
    var q = f.querySelector('input').value.trim();
    if (q) askClaude(+f.getAttribute('data-askform'), q);
  });
  document.addEventListener('keydown', function (e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (!document.getElementById('setup').hidden) { if (e.key === 'Escape') closeSetup(); return; }
    if (e.key === 'ArrowLeft') { nav(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { nav(1); e.preventDefault(); }
    else if (e.key === 'Escape' && view.mode !== 'live') backToGame();
  });
}

function restore(saved) {
  if (!saved || !saved.S || !saved.S.plies) return false;
  try {
    var c = new Chess(saved.S.startFen || START_FEN);
    for (var i = 0; i < saved.S.plies.length; i++) if (!c.move(uciObj(saved.S.plies[i].uci))) return false;
    S = saved.S; chess = c; orient = saved.orient || S.me;
    if (!S.settings.clock) S.settings.clock = 'none';
    if (S.clock === undefined) S.clock = null;
    if (!S.undos) S.undos = [];
    if (S.aiReview && S.aiReview.status !== 'done') S.aiReview = null;
    S.plies.forEach(function (p) { if (p.ai && p.ai.status !== 'done') p.ai = null; });
    checkOver();
    return true;
  } catch (e) { return false; }
}

function start(data) {
  PIECE_URL = PIECES;
  buildBook();
  wire();
  var hotState = data && data.S ? data : null;
  coachEng.start().then(render); botEng.start().then(render);
  if (!restore(hotState) && !restore(loadSaved())) { newGame(defaultSettings()); }
  else {
    render();
    S.plies.forEach(function (p) { if (p.by === 'you' && (!p.review || p.review.status !== 'done')) reviewPly(p); });
    if (!S.over) { if (chess.turn() !== S.me) botTurn(); else analyze(chess.fen()); }
  }
  if (S.over) { analyze(S.startFen); S.plies.forEach(function (p) { if (p.by === 'bot') analyze(p.fenAfter); }); }
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('sample').then(function (f) { sampleFn = f || null; render(); }).catch(function () {});
  }
  try { if (window.claude && window.claude.hot && typeof window.claude.hot.snapshot === 'function') window.claude.hot.snapshot(function () { return { S: S, orient: orient }; }); } catch (e) {}
}
if (window.claude && window.claude.hot && typeof window.claude.hot.ready === 'function') window.claude.hot.ready(start);
else start((window.claude && window.claude.hot && window.claude.hot.data) || {});
