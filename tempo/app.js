/* ---------- Tempo app ---------- */
var LEVELS = [
  { name: 'Rookie', rating: '~400', desc: 'Hangs pieces often. Good for learning how pieces move.', skill: 0, depth: 1, time: 80, random: 0.5 },
  { name: 'Beginner', rating: '~700', desc: 'Makes regular mistakes you can punish.', skill: 0, depth: 2, time: 120, random: 0.22 },
  { name: 'Casual', rating: '~1000', desc: 'Knows the basics, still drops material.', skill: 3, depth: 4, time: 250, random: 0.08 },
  { name: 'Club', rating: '~1400', desc: 'Solid club player. Punishes loose pieces.', skill: 8, depth: 8, time: 600, random: 0 },
  { name: 'Strong', rating: '~1800', desc: 'Rarely blunders. You will need a plan.', skill: 14, depth: 11, time: 1000, random: 0 },
  { name: 'Master', rating: '2400+', desc: 'Full-strength search. Good luck.', skill: 20, depth: 15, time: 1600, random: 0 }
];
var GRADES = {
  best: { label: 'Best', glyph: '★' }, excellent: { label: 'Excellent', glyph: '!' }, good: { label: 'Good', glyph: '✓' },
  forced: { label: 'Only move', glyph: '□' }, inaccuracy: { label: 'Inaccuracy', glyph: '?!' },
  mistake: { label: 'Mistake', glyph: '?' }, blunder: { label: 'Blunder', glyph: '??' }
};
var LEGEND = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
var ANALYSIS = { skill: 20, depth: 13, movetime: 2500 };
var LS_KEY = 'tempo-chess-v1';

/* ---------- engine ---------- */
function bootWorker(url, ms) {
  return new Promise(function (resolve, reject) {
    var w, done = false;
    try { w = new Worker(url); } catch (e) { reject(e); return; }
    var t = setTimeout(function () { if (!done) { done = true; try { w.terminate(); } catch (e) {} reject(new Error('timeout')); } }, ms);
    w.onerror = function (e) { if (!done) { done = true; clearTimeout(t); try { w.terminate(); } catch (x) {} reject(e); } };
    w.onmessage = function (e) {
      if (!done && String(e.data).indexOf('uciok') >= 0) { done = true; clearTimeout(t); w.onerror = null; resolve(w); }
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
  this.w.postMessage('go depth ' + j.o.depth + (j.o.movetime ? ' movetime ' + j.o.movetime : ''));
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
var expanded = {};          // ply idx -> show details in "mistakes only" mode
var pendingPromo = null;
var animNext = null;

function save() { try { localStorage.setItem(LS_KEY, JSON.stringify({ S: S, orient: orient })); } catch (e) {} }
function loadSaved() { try { var raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
function defaultSettings() { return { level: 2, color: 'w', coach: 'every' }; }
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

function analyze(fen) {
  if (cache.has(fen)) return cache.get(fen);
  var c = new Chess(fen), p;
  if (c.game_over()) {
    var r = c.in_checkmate() ? { score: { mate: 0 }, pv: [], bestmove: null } : { score: { cp: 0 }, pv: [], bestmove: null };
    p = Promise.resolve(r); done.set(fen, r);
  } else {
    p = coachEng.go(fen, ANALYSIS).then(function (r) {
      if (!r) { cache.delete(fen); return null; }
      if (!r.score) r.score = { cp: 0 };
      done.set(fen, r); renderEval();
      return r;
    });
  }
  cache.set(fen, p);
  return p;
}

/* ---------- game flow ---------- */
function newGame(settings) {
  gen++;
  coachEng.cancelAll(); botEng.cancelAll();
  if (aiCtl) aiCtl.abort();
  var me = settings.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.color;
  S = { v: 1, settings: settings, me: me, startFen: START_FEN, plies: [], over: null };
  chess = new Chess(S.startFen);
  orient = me; view = { mode: 'live' }; sel = null; coachIdx = null; hint = { fen: null, stage: 0, move: null }; botThinking = false; expanded = {};
  save(); render();
  if (chess.turn() !== S.me) botTurn(); else analyze(chess.fen());
}

function applyMove(mv, by, legalCount) {
  var fenBefore = chess.fen();
  var m = chess.move(mv);
  if (!m) return null;
  var ply = {
    san: m.san, uci: moveUci(m), from: m.from, to: m.to, color: m.color, piece: m.piece, captured: m.captured || null,
    flags: m.flags, promotion: m.promotion || null, fenBefore: fenBefore, fenAfter: chess.fen(), by: by,
    legalCount: legalCount, review: by === 'you' ? { status: 'pending' } : null
  };
  S.plies.push(ply);
  checkOver();
  view = { mode: 'live' }; sel = null; hint = { fen: null, stage: 0, move: null };
  if (by === 'you') coachIdx = S.plies.length - 1;
  animNext = { from: m.from, to: m.to, flags: m.flags, color: m.color };
  save();
  return ply;
}

function checkOver() {
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
    if (!b || !a) { ply.review = { status: coachEng.state === 'failed' ? 'error' : 'pending' }; render(); return; }
    var me = S.me;
    var played = tryMove(ply.fenBefore, ply.uci).move;
    var evB = pov(b.score, ply.fenBefore, me), evA = pov(a.score, ply.fenAfter, me);
    var mateDelivered = new Chess(ply.fenAfter).in_checkmate();
    var grade = gradeMove({ legalCount: ply.legalCount, playedUci: ply.uci, bestUci: b.bestmove, evB: evB, evA: evA, mateDelivered: mateDelivered });
    var ex = explainMove({ fenBefore: ply.fenBefore, fenAfter: ply.fenAfter, played: played, me: me, grade: grade, before: b, after: a, evB: evB, evA: evA });
    var best = b.bestmove ? tryMove(ply.fenBefore, b.bestmove) : null;
    ply.review = {
      status: 'done', grade: grade, evB: evB, evA: evA,
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
  var pick;
  if (Math.random() < L.random || botEng.state === 'failed') {
    var caps = legal.filter(function (m) { return m.captured; });
    var pool = botEng.state === 'failed' && caps.length && Math.random() < 0.6 ? caps : legal;
    var m = pool[Math.floor(Math.random() * pool.length)];
    pick = Promise.resolve(moveUci(m));
  } else {
    pick = botEng.go(fen, { skill: L.skill, depth: L.depth, movetime: L.time }).then(function (r) {
      if (r && r.bestmove) return r.bestmove;
      if (botEng.state === 'failed') { var m2 = legal[Math.floor(Math.random() * legal.length)]; return moveUci(m2); }
      return null;
    });
  }
  pick.then(function (uci) {
    if (g !== gen || !uci) return;
    var wait = Math.max(0, 650 - (Date.now() - t0));
    return sleep(wait).then(function () {
      if (g !== gen) return;
      botThinking = false;
      if (chess.fen() !== fen) { render(); return; }
      applyMove(uciObj(uci), 'bot', legal.length);
      render();
      if (!S.over) analyze(chess.fen());
    });
  });
}

function truncateTo(k) {
  gen++;
  botEng.cancelAll();
  if (aiCtl) aiCtl.abort();
  S.plies = S.plies.slice(0, k);
  chess = new Chess(S.startFen);
  S.plies.forEach(function (p) { chess.move(uciObj(p.uci)); });
  S.over = null; checkOver();
  botThinking = false; view = { mode: 'live' }; sel = null; hint = { fen: null, stage: 0, move: null };
  coachIdx = null;
  save(); render();
  if (!S.over) { if (chess.turn() !== S.me) botTurn(); else analyze(chess.fen()); }
}
function takeBack() { var k = lastUserIdx(); if (k >= 0) truncateTo(k); }

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
  var o = { fen: null, last: null, arrows: [], badge: null, note: '', interactive: false };
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
    if (view.arrows && view.arrows.length) { o.last = null; o.note = view.note || ''; }
    var pp = view.n > 0 ? S.plies[view.n - 1] : null;
    if (pp && pp.by === 'you' && coachVisible(pp) && !(view.arrows && view.arrows.length)) o.badge = { sq: pp.to, grade: pp.review.grade };
  } else if (view.mode === 'line') {
    var steps = lineSans(view.baseFen, view.pv);
    o.fen = view.step > 0 && steps[view.step - 1] ? steps[view.step - 1].fen : view.baseFen;
    o.last = view.step > 0 ? steps[view.step - 1] : null;
    if (steps[view.step]) o.arrows.push({ from: steps[view.step].from, to: steps[view.step].to, kind: 'move' });
    o.note = view.label;
  }
  return o;
}

function renderBoard() {
  var d = displayed(), c = new Chess(d.fen), b = c.board();
  var legalTargets = {};
  if (d.interactive && sel) c.moves({ square: sel, verbose: true }).forEach(function (m) { legalTargets[m.to] = m.captured ? 'ring' : 'dot'; });
  var hintSq = d.interactive && hint.fen === d.fen && hint.stage >= 1 && hint.move ? hint.move.from : null;
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

  /* arrows */
  var ah = '';
  d.arrows.forEach(function (ar) { ah += arrowSvg(ar.from, ar.to, ar.kind); });
  arrowsEl.innerHTML = ah;

  /* badge */
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
  return '<polygon points="' + pts + '" style="fill:' + color + '"' + (kind === 'move' ? ' opacity="0.9"' : '') + '/>';
}

/* ---------- pointer input ---------- */
var drag = null;
function onDown(e) {
  if (e.button && e.button !== 0) return;
  var d = displayed();
  if (!d.interactive) return;
  var sq = sqAtXY(e.clientX, e.clientY);
  if (!sq) return;
  var p = chess.get(sq);
  if (sel && sel !== sq && (!p || p.color !== S.me)) {
    if (userMove(sel, sq)) return;
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
    if (to && to !== dr.sq && userMove(dr.sq, to)) return;
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
function nav(delta) {
  if (view.mode === 'line') {
    var len = lineSans(view.baseFen, view.pv).length;
    view.step = Math.max(0, Math.min(len, view.step + delta)); render(); return;
  }
  var cur = view.mode === 'ply' ? view.n : S.plies.length;
  goPly(cur + delta);
}
function backToGame() { view = { mode: 'live' }; coachIdx = null; render(); }

/* ---------- side panel rendering ---------- */
function gchip(g, count) {
  return '<span class="gchip tone-' + g + '"><i>' + GRADES[g].glyph + '</i>' + GRADES[g].label + (count != null ? ' <b>' + count + '</b>' : '') + '</span>';
}
function renderStrips() {
  var d = displayed(), b = new Chess(d.fen).board();
  var cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } }, init = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  b.forEach(function (row) { row.forEach(function (p) { if (p && p.type !== 'k') cnt[p.color][p.type]++; }); });
  var matW = 0; ['p', 'n', 'b', 'r', 'q'].forEach(function (t) { matW += (cnt.w[t] - cnt.b[t]) * VAL[t]; });
  function capsOf(color) { // pieces of `color` that are missing
    var h = '';
    ['q', 'r', 'b', 'n', 'p'].forEach(function (t) { for (var i = 0; i < Math.max(0, init[t] - cnt[color][t]); i++) h += '<i style="background-image:url(' + PIECE_URL[color + t.toUpperCase()] + ')"></i>'; });
    return h;
  }
  var me = S.me, opp = other(me), L = LEVELS[S.settings.level];
  var myAdv = me === 'w' ? matW : -matW;
  var liveTurn = view.mode === 'live' && !S.over;
  var oppRight = botThinking ? '<span class="clockdot thinking">Thinking<i></i><i></i><i></i></span>' : (liveTurn && chess.turn() === opp ? '<span class="clockdot"><span class="turnpip"></span>To move</span>' : '');
  var youRight = liveTurn && chess.turn() === me && !botThinking ? '<span class="clockdot"><span class="turnpip"></span>Your move</span>' : '';
  var oppHtml = '<span class="who">' + L.name + ' bot<small>' + L.rating + '</small></span><span class="caps">' + capsOf(me) + (myAdv < 0 ? '<b>+' + -myAdv + '</b>' : '') + '</span>' + oppRight;
  var youHtml = '<span class="who">You<small>' + cname(me) + '</small></span><span class="caps">' + capsOf(opp) + (myAdv > 0 ? '<b>+' + myAdv + '</b>' : '') + '</span>' + youRight;
  var top = orient === me ? oppHtml : youHtml, bot = orient === me ? youHtml : oppHtml;
  document.getElementById('oppStrip').innerHTML = top;
  document.getElementById('youStrip').innerHTML = bot;
}
function renderEval() {
  if (!S) return;
  var d = displayed(), r = done.get(d.fen), bar = document.getElementById('evalbar');
  bar.classList.toggle('flip', orient === 'b');
  if (S.settings.coach === 'after' && !S.over) { bar.firstChild.style.height = '50%'; bar.title = 'Evaluation hidden until the game ends'; return; }
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
  } else { prev.disabled = cur <= 0; next.disabled = view.mode === 'live'; }
  document.getElementById('liveBtn').hidden = view.mode === 'live';
  document.getElementById('hintBtn').disabled = !(view.mode === 'live' && myTurnLive()) || coachEng.state === 'failed';
  document.getElementById('hintBtn').textContent = hint.fen === chess.fen() && hint.stage >= 1 ? (hint.stage === 1 ? 'Show move' : 'Hint shown') : 'Hint';
  document.getElementById('undoBtn').disabled = lastUserIdx() < 0;
}

function renderTally() {
  var el = document.getElementById('tally');
  var revs = S.plies.filter(function (p) { return p.by === 'you' && p.review && p.review.status === 'done'; });
  var hide = S.settings.coach === 'after' && !S.over;
  var counts = {}; LEGEND.forEach(function (g) { counts[g] = 0; });
  var accs = [];
  revs.forEach(function (p) { if (counts[p.review.grade] != null) counts[p.review.grade]++; if (p.review.acc != null) accs.push(p.review.acc); });
  var acc = accs.length ? accs.reduce(function (a, b) { return a + b; }, 0) / accs.length : null;
  el.innerHTML = '<div class="acc">' + (hide || acc == null ? '<small>' + (hide ? 'hidden' : 'no moves yet') + '</small>' : acc.toFixed(1) + '<small>%</small>') + '</div>' +
    '<div class="legend">' + LEGEND.map(function (g) { return gchip(g, hide ? '–' : counts[g]); }).join('') + '</div>' +
    '<div class="acclbl">Your accuracy</div>';
}

function renderSheet() {
  var grid = document.getElementById('sheetGrid');
  document.getElementById('sheetMeta').textContent = S.plies.length ? 'Tap a move to review it' : '';
  if (!S.plies.length) { grid.innerHTML = '<div class="empty">Moves will be recorded here as you play.</div>'; return; }
  var curPly = view.mode === 'ply' ? view.n - 1 : (view.mode === 'line' ? view.plyIdx : (coachIdx != null ? coachIdx : -1));
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
    return '<button class="mvb' + (i === curPly ? ' cur' : '') + '" type="button" data-ply="' + i + '"><span class="' + (p.by === 'bot' ? 'bot' : '') + '">' + esc(p.san) + '</span>' + ann + '</button>';
  }
  grid.innerHTML = '<div class="colhead"><div>No.</div><div>White</div><div>Black</div></div>' + order.map(function (n) {
    return '<div class="rowm"><div class="no">' + n + '</div>' + cell(rows[n].w) + cell(rows[n].b) + '</div>';
  }).join('');
  var cur = grid.querySelector('.mvb.cur');
  if (cur && view.mode === 'live') grid.scrollTop = grid.scrollHeight;
  else if (cur) { var gr = grid.getBoundingClientRect(), cr = cur.getBoundingClientRect(); if (cr.top < gr.top + 24 || cr.bottom > gr.bottom) grid.scrollTop += cr.top - gr.top - gr.height / 2; }
}

function evalRow(r) {
  var a = winPct(povCp(r.evB)), b = winPct(povCp(r.evA));
  return '<div class="evalrow">Evaluation for you <b>' + fmtEval(r.evB) + '</b> → <b>' + fmtEval(r.evA) + '</b><span>Win chance ' + Math.round(a) + '% → ' + Math.round(b) + '%</span></div>';
}

function renderCoach() {
  var el = document.getElementById('coach'), h = '';
  if (coachEng.state === 'failed') h += '<p class="engine-error">The analysis engine could not start in this browser, so moves cannot be graded. You can still play against a simplified bot.</p>';

  if (view.mode === 'line') h += lineBox();

  var live = view.mode === 'live';
  /* hint panel */
  if (live && hint.fen === chess.fen() && hint.stage >= 1) {
    var hm = hint.move;
    h += '<p class="tip"><strong>Hint.</strong> ' + (!hm ? 'Thinking about it…' : hint.stage === 1 ? 'Look at your ' + PNAME[hm.piece] + ' on ' + hm.from + '. It has a strong move.' : 'Try ' + esc(hm.san) + '.') + '</p>';
  }

  if (view.mode === 'ply' && view.arrows && view.arrows.length && view.note) h += '<p class="tip"><strong>On the board.</strong> ' + esc(view.note) + '</p>';

  var k = coachIdx != null ? coachIdx : (live ? lastUserIdx() : -1);
  if (view.mode === 'line') k = view.plyIdx;

  if (live && S.over) { h += gameOverCard(); el.innerHTML = h; return; }

  if (k < 0 || !S.plies[k]) {
    if (view.mode === 'ply' && view.n === 0) h += '<div><div class="kicker">Start</div><h2>Starting position</h2></div><p>Step forward with the arrows, or tap any move on the scoresheet.</p>';
    else h += introCard();
    el.innerHTML = h; return;
  }
  var p = S.plies[k];
  if (p.by === 'bot') { h += botCard(k); el.innerHTML = h; return; }
  h += userCard(k);
  el.innerHTML = h;
  var ans = document.getElementById('aiAns');
  if (ans && p.ai) { ans.textContent = p.ai.text || (p.ai.status === 'thinking' ? 'Thinking…' : ''); ans.classList.toggle('dim', !p.ai.text); }
}

function introCard() {
  var waiting = botThinking || (chess.turn() !== S.me && !S.over);
  return '<div><div class="kicker">Coach</div><h2>' + (waiting ? 'The bot moves first' : 'Your move') + '</h2></div>' +
    '<p>Play a move and Stockfish will grade it, show you what it would have played, and explain why. Stuck? Tap Hint for a nudge. You can tap any move on the scoresheet later to review it.</p>' +
    '<div class="legend">' + LEGEND.map(function (g) { return gchip(g); }).join('') + '</div>';
}

function botCard(k) {
  var p = S.plies[k], L = LEVELS[S.settings.level], r = done.get(p.fenAfter);
  var h = '<div><div class="kicker">Move ' + moveNoOf(p.fenBefore) + ' · ' + L.name + ' bot</div><h2>The bot played ' + esc(p.san) + '</h2></div>';
  if (r && !(S.settings.coach === 'after' && !S.over)) {
    var ev = pov(r.score, p.fenAfter, S.me);
    h += '<p>After this move you are ' + evalWords(ev) + ' (' + fmtEval(ev) + ').' + (r.bestmove ? ' Your best reply was ' + esc(tryMove(p.fenAfter, r.bestmove).move.san) + '.' : '') + '</p>';
  }
  var nx = S.plies[k + 1];
  if (nx && nx.by === 'you') h += '<div class="actions"><button class="btn sm" type="button" data-act="open" data-k="' + (k + 1) + '">See your reply</button></div>';
  return h;
}

function userCard(k) {
  var p = S.plies[k], r = p.review, live = view.mode === 'live', n = moveNoOf(p.fenBefore);
  var kick = 'Move ' + n;
  if (!r || r.status === 'pending') return '<div class="pending"><span class="spin"></span><span>Checking ' + esc(p.san) + '…</span></div>';
  if (r.status === 'error') return '<div><div class="kicker">' + kick + '</div><h2>' + esc(p.san) + '</h2></div><p>This move could not be analyzed.</p>';
  if (S.settings.coach === 'after' && !S.over) return '<div><div class="kicker">' + kick + '</div><h2>You played ' + esc(p.san) + '</h2></div><p>Coaching is set to after the game. Every move is being graded quietly, and the full review opens when the game ends.</p>';
  var g = GRADES[r.grade];
  if (S.settings.coach === 'mistakes' && !S.over && live && !isBad(r.grade) && !expanded[k]) {
    return '<div class="verdict tone-' + r.grade + '"><div class="glyph">' + g.glyph + '</div><div><div class="kicker">' + kick + ' · ' + g.label + '</div><h2>' + esc(r.headline) + '</h2></div></div>' +
      '<div class="actions"><button class="btn sm" type="button" data-act="expand" data-k="' + k + '">Show details</button></div>';
  }
  var h = '<div class="verdict tone-' + r.grade + '"><div class="glyph">' + g.glyph + '</div><div><div class="kicker">' + kick + ' · ' + g.label + '</div><h2>' + esc(r.headline) + '</h2></div></div>';
  h += '<p>' + esc(r.body.join(' ')) + '</p>';
  if (r.grade !== 'forced') h += evalRow(r);
  if (r.tip) h += '<p class="tip"><strong>Principle.</strong> ' + esc(r.tip) + '</p>';
  var showBetter = r.bestSan && r.bestUci !== p.uci && r.grade !== 'forced';
  if (showBetter) {
    h += '<div class="better"><span class="lbl">Engine\'s choice</span><span class="mv">' + esc((p.color === 'w' ? n + '. ' : n + '... ') + r.bestSan) + '</span><span class="ln">' + esc(lineText(p.fenBefore, r.bestPv, 8)) + '</span></div>';
  }
  h += '<div class="actions">';
  if (showBetter) {
    h += '<button class="btn sm" type="button" data-act="showbest" data-k="' + k + '">Show on board</button>';
    h += '<button class="btn sm" type="button" data-act="bestline" data-k="' + k + '">Play best line</button>';
  }
  if (r.replyPv && r.replyPv.length) h += '<button class="btn sm" type="button" data-act="reply" data-k="' + k + '">' + (isBad(r.grade) ? 'See the punishment' : 'What happens next') + '</button>';
  h += '<button class="btn sm" type="button" data-act="retry" data-k="' + k + '">' + (k === lastUserIdx() ? 'Retry this move' : 'Retry from here') + '</button>';
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

function gameOverCard() {
  var o = S.over, me = S.me, title;
  if (o.winner) title = o.winner === me ? 'You won by checkmate' : 'You lost by checkmate';
  else title = 'Draw by ' + o.reason;
  var bad = [];
  S.plies.forEach(function (p, i) { if (p.by === 'you' && p.review && p.review.status === 'done' && isBad(p.review.grade)) bad.push(i); });
  bad.sort(function (a, b) { return GRADE_ORDER.indexOf(S.plies[b].review.grade) - GRADE_ORDER.indexOf(S.plies[a].review.grade); });
  var h = '<div><div class="kicker">Game over</div><h2>' + title + '</h2></div>';
  h += '<p>' + (bad.length ? 'Here are the moments that mattered most. Tap one to see what went wrong and what to play instead.' : 'No inaccuracies, mistakes or blunders. Tap any move on the scoresheet to review it.') + '</p>';
  if (bad.length) {
    h += '<div class="actions">' + bad.slice(0, 6).map(function (i) {
      var p = S.plies[i];
      return '<button class="btn sm tone-' + p.review.grade + '" type="button" data-act="open" data-k="' + i + '"><span class="gchip tone-' + p.review.grade + '"><i>' + GRADES[p.review.grade].glyph + '</i></span>' + esc(plyLabel(i)) + '</button>';
    }).join('') + '</div>';
  }
  h += '<div class="actions"><button class="btn sm" type="button" data-act="review0">Review from the start</button><button class="btn sm primary" type="button" data-act="new">New game</button></div>';
  return h;
}

function render() {
  if (!S) return;
  renderBoard(); renderStrips(); renderControls(); renderCoach(); renderSheet(); renderTally(); renderEval();
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
    'Position before the student\'s move (FEN): ' + p.fenBefore,
    'Pieces before the move: ' + pieceList(p.fenBefore),
    'Student played: ' + p.san + '. Grade: ' + GRADES[r.grade].label + '. Evaluation for the student went from ' + fmtEval(r.evB) + ' to ' + fmtEval(r.evA) + ' (in pawns; positive is good for the student).',
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
    var box = document.getElementById('promo'); box.hidden = true;
    if (b && pendingPromo) userMove(pendingPromo.from, pendingPromo.to, b.getAttribute('data-promo'));
    pendingPromo = null;
  });
  document.getElementById('prevBtn').onclick = function () { nav(-1); };
  document.getElementById('nextBtn').onclick = function () { nav(1); };
  document.getElementById('liveBtn').onclick = backToGame;
  document.getElementById('hintBtn').onclick = useHint;
  document.getElementById('undoBtn').onclick = takeBack;
  document.getElementById('flipBtn').onclick = function () { orient = other(orient); save(); render(); };
  document.getElementById('newBtn').onclick = openSetup;
  document.getElementById('setupCancel').onclick = closeSetup;
  document.getElementById('setup').addEventListener('click', function (e) { if (e.target.id === 'setup') closeSetup(); });
  document.getElementById('setupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var st = { level: +f.querySelector('input[name=level]:checked').value, color: f.querySelector('input[name=color]:checked').value, coach: f.querySelector('input[name=coach]:checked').value };
    closeSetup(); newGame(st);
  });
  document.getElementById('sheetGrid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ply]'); if (!b) return;
    var i = +b.getAttribute('data-ply');
    view = i === S.plies.length - 1 ? { mode: 'live' } : { mode: 'ply', n: i + 1 };
    coachIdx = i; sel = null; render();
  });
  var coach = document.getElementById('coach');
  coach.addEventListener('click', function (e) {
    var st = e.target.closest('[data-step]');
    if (st && view.mode === 'line') { view.step = +st.getAttribute('data-step'); render(); return; }
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), k = +b.getAttribute('data-k'), p = S.plies[k];
    if (act === 'expand') { expanded[k] = true; render(); }
    else if (act === 'open') { view = k === S.plies.length - 1 ? { mode: 'live' } : { mode: 'ply', n: k + 1 }; coachIdx = k; render(); }
    else if (act === 'showbest') setView({ mode: 'ply', n: k, arrows: [{ from: p.from, to: p.to, kind: 'bad' }, { from: p.review.bestFrom, to: p.review.bestTo, kind: 'best' }], note: 'This is the position before your move. The green arrow is ' + p.review.bestSan + ', the red one is your ' + p.san + '.' }, k);
    else if (act === 'bestline') setView({ mode: 'line', baseFen: p.fenBefore, pv: p.review.bestPv, step: 1, label: 'Engine line instead of ' + p.san, plyIdx: k }, k);
    else if (act === 'reply') setView({ mode: 'line', baseFen: p.fenAfter, pv: p.review.replyPv, step: 1, label: 'Best play after ' + p.san, plyIdx: k }, k);
    else if (act === 'retry') truncateTo(k);
    else if (act === 'linenext') nav(1);
    else if (act === 'lineexit') { var pk = view.plyIdx; view = pk === S.plies.length - 1 ? { mode: 'live' } : { mode: 'ply', n: pk + 1 }; coachIdx = pk; render(); }
    else if (act === 'ai') askClaude(k, null);
    else if (act === 'review0') { goPly(1); }
    else if (act === 'new') openSetup();
  });
  coach.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-askform]'); if (!f) return;
    e.preventDefault();
    var input = f.querySelector('input'), q = input.value.trim();
    if (!q) return;
    askClaude(+f.getAttribute('data-askform'), q);
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
    S.plies.forEach(function (p) { if (p.ai && p.ai.status !== 'done') p.ai = null; });
    checkOver();
    return true;
  } catch (e) { return false; }
}

function start(data) {
  PIECE_URL = PIECES;
  wire();
  var hotState = data && data.S ? data : null;
  coachEng.start().then(render); botEng.start().then(render);
  if (!restore(hotState) && !restore(loadSaved())) { newGame(defaultSettings()); }
  else {
    render();
    S.plies.forEach(function (p) { if (p.by === 'you' && (!p.review || p.review.status !== 'done')) reviewPly(p); });
    if (!S.over) { if (chess.turn() !== S.me) botTurn(); else analyze(chess.fen()); }
  }
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('sample').then(function (f) { sampleFn = f || null; render(); }).catch(function () {});
  }
  try { if (window.claude && window.claude.hot && typeof window.claude.hot.snapshot === 'function') window.claude.hot.snapshot(function () { return { S: S, orient: orient }; }); } catch (e) {}
}
if (window.claude && window.claude.hot && typeof window.claude.hot.ready === 'function') window.claude.hot.ready(start);
else start((window.claude && window.claude.hot && window.claude.hot.data) || {});
