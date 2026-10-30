/* ---------- Core chess + coaching logic (pure, no DOM) ---------- */
var FILES = 'abcdefgh';
var VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
var PNAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
function other(c) { return c === 'w' ? 'b' : 'w'; }
function cname(c) { return c === 'w' ? 'White' : 'Black'; }
function turnOf(fen) { return fen.split(' ')[1]; }
function moveNoOf(fen) { return +fen.split(' ')[5]; }
function sqRF(sq) { return [8 - +sq[1], FILES.indexOf(sq[0])]; }
function rfSq(r, f) { return FILES[f] + (8 - r); }
function uciObj(u) { return { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined }; }
function moveUci(m) { return m.from + m.to + (m.promotion || ''); }

function tryMove(fen, uci) {
  var c = new Chess(fen);
  var m = c.move(uciObj(uci));
  return m ? { move: m, chess: c } : null;
}

/* Move list text like "14. Nf3 Qe7 15. O-O" */
function lineText(fen, pv, max) {
  var c = new Chess(fen), out = [], n = moveNoOf(fen), t = turnOf(fen);
  for (var i = 0; i < Math.min(pv.length, max || 99); i++) {
    var m = c.move(uciObj(pv[i]));
    if (!m) break;
    if (t === 'w') out.push(n + '. ' + m.san);
    else out.push(i === 0 ? n + '... ' + m.san : m.san);
    if (t === 'b') n++;
    t = other(t);
  }
  return out.join(' ');
}
function lineSans(fen, pv, max) {
  var c = new Chess(fen), out = [];
  for (var i = 0; i < Math.min(pv.length, max || 99); i++) {
    var m = c.move(uciObj(pv[i]));
    if (!m) break;
    out.push({ san: m.san, uci: pv[i], color: m.color, from: m.from, to: m.to, fen: c.fen() });
  }
  return out;
}


/* ---- opening book ---- */
var BOOK = null;
function posKey(fen) { var f = fen.split(' '); return f[0] + ' ' + f[1] + ' ' + f[2]; }
function buildBook() {
  BOOK = {};
  var bad = [];
  (typeof OPENINGS !== 'undefined' ? OPENINGS : []).forEach(function (o) {
    var c = new Chess(), ok = true;
    o[1].split(' ').forEach(function (san) { if (ok && !c.move(san, { sloppy: true })) ok = false; });
    if (!ok) { bad.push(o[0]); return; }
    var k = posKey(c.fen());
    if (!BOOK[k] || o[0].length > BOOK[k].length) BOOK[k] = o[0];
  });
  return bad;
}
function bookName(fen) { if (!BOOK) buildBook(); return BOOK[posKey(fen)] || null; }
/* Latest named opening reached in a list of fens */
function openingOf(fens) { var n = null; fens.forEach(function (f) { var b = bookName(f); if (b) n = b; }); return n; }

/* ---- attacks ---- */
function attackedSquares(board, r, f) {
  var p = board[r][f]; if (!p) return [];
  var out = [];
  function add(rr, ff) { if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) out.push([rr, ff]); }
  if (p.type === 'p') { var dr = p.color === 'w' ? -1 : 1; add(r + dr, f - 1); add(r + dr, f + 1); return out; }
  if (p.type === 'n') { [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]].forEach(function (d) { add(r + d[0], f + d[1]); }); return out; }
  if (p.type === 'k') { for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) if (a || b) add(r + a, f + b); return out; }
  var dirs = [];
  if (p.type !== 'b') dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
  if (p.type !== 'r') dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  dirs.forEach(function (d) {
    var rr = r + d[0], ff = f + d[1];
    while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) { out.push([rr, ff]); if (board[rr][ff]) break; rr += d[0]; ff += d[1]; }
  });
  return out;
}
function attackersOf(board, r, f, color) {
  var res = [];
  for (var i = 0; i < 8; i++) for (var j = 0; j < 8; j++) {
    var p = board[i][j];
    if (p && p.color === color && attackedSquares(board, i, j).some(function (s) { return s[0] === r && s[1] === f; })) res.push({ type: p.type, sq: rfSq(i, j) });
  }
  return res;
}
function hangingPieces(fen, color) {
  var b = new Chess(fen).board(), out = [];
  for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) {
    var p = b[r][f];
    if (!p || p.color !== color || p.type === 'k') continue;
    var def = attackersOf(b, r, f, color);
    var att = attackersOf(b, r, f, other(color)).filter(function (a) { return a.type !== 'k' || def.length === 0; });
    if (!att.length) continue;
    var minAtt = Math.min.apply(null, att.map(function (a) { return a.type === 'k' ? 99 : VAL[a.type]; }));
    if (!def.length || minAtt < VAL[p.type]) out.push({ sq: rfSq(r, f), type: p.type });
  }
  return out;
}
/* Pieces the piece on sq attacks that are juicy: king, higher value, or undefended */
function forkTargets(fen, sq) {
  var b = new Chess(fen).board(), rf = sqRF(sq), p = b[rf[0]][rf[1]];
  if (!p) return [];
  var out = [];
  attackedSquares(b, rf[0], rf[1]).forEach(function (s) {
    var t = b[s[0]][s[1]];
    if (!t || t.color === p.color) return;
    var undefended = t.type !== 'k' && attackersOf(b, s[0], s[1], t.color).length === 0;
    if (t.type === 'k' || VAL[t.type] > VAL[p.type] || (undefended && VAL[t.type] >= 1)) out.push({ type: t.type, sq: rfSq(s[0], s[1]) });
  });
  return out;
}

/* A checkmate `byColor` would deliver if it were their move (null-move threat check) */
function mateThreat(fen, byColor) {
  var f = fen.split(' ');
  if (f[1] !== byColor) {
    if (new Chess(fen).in_check()) return null;
    f[1] = byColor; f[3] = '-';
  }
  var c = new Chess(f.join(' '));
  if (!c.fen || c.fen().split(' ')[1] !== byColor) return null;
  var ms = c.moves({ verbose: true });
  for (var i = 0; i < ms.length; i++) {
    c.move(ms[i]);
    var mate = c.in_checkmate();
    c.undo();
    if (mate) return ms[i].san;
  }
  return null;
}
function material(chessOrFen, color) {
  var b = (typeof chessOrFen === 'string' ? new Chess(chessOrFen) : chessOrFen).board(), s = 0;
  b.forEach(function (row) { row.forEach(function (p) { if (p) s += (p.color === color ? 1 : -1) * VAL[p.type]; }); });
  return s;
}
/* Play a PV and report how material settles (from `me`'s point of view) */
function lineMaterial(fen, pv, me, maxPlies) {
  maxPlies = maxPlies || 6;
  var c = new Chess(fen), start = material(c, me), myLost = [], oppLost = [], sans = [], settle = null;
  for (var i = 0; i < Math.min(pv.length, maxPlies + 2); i++) {
    var m = c.move(uciObj(pv[i]));
    if (!m) break;
    sans.push(m.san);
    if (m.captured) (m.color === me ? oppLost : myLost).push(m.captured);
    var next = pv[i + 1];
    var nextCap = next ? !!c.get(next.slice(2, 4)) || (c.get(next.slice(0, 2)) || {}).type === 'p' && next[0] !== next[2] : false;
    if ((!nextCap && !c.in_check()) || c.in_checkmate()) {
      settle = { delta: material(c, me) - start, plies: i + 1, myLost: myLost.slice(), oppLost: oppLost.slice() };
      break;
    }
  }
  return settle || { delta: material(c, me) - start, plies: sans.length, myLost: myLost, oppLost: oppLost };
}
function materialPhrase(n) {
  n = Math.round(n);
  if (n <= 1) return 'a pawn';
  if (n === 2) return 'two pawns';
  if (n === 3) return 'a piece';
  if (n === 4) return 'a piece and a pawn';
  if (n === 5) return 'a rook';
  if (n === 6) return 'a rook and a pawn';
  if (n >= 9) return 'a queen';
  return n + ' points of material';
}
function piecesPhrase(list) {
  var names = list.slice().sort(function (a, b) { return VAL[b] - VAL[a]; }).map(function (t) { return PNAME[t]; });
  if (names.length === 1) return 'a ' + names[0];
  if (names.length === 2) return 'a ' + names[0] + ' and a ' + names[1];
  return names.length + ' pieces';
}

/* ---- scores ---- */
/* engine score is side-to-move POV; convert to `me` POV */
function pov(score, fen, me) {
  var s = turnOf(fen) === me ? 1 : -1;
  if (!score) return { cp: 0 };
  if (score.mate != null) { if (score.mate === 0) return { mate: 0, sign: -s }; return { mate: score.mate * s }; }
  return { cp: score.cp * s };
}
function povCp(p) {
  if (p.mate != null) { if (p.mate === 0) return p.sign * 10000; return p.mate > 0 ? 10000 - p.mate * 10 : -10000 - p.mate * 10; }
  return p.cp;
}
function winPct(cp) { return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1); }
var MINUS = '−';
function fmtEval(p) {
  if (!p) return '';
  if (p.mate != null) {
    if (p.mate === 0) return p.sign > 0 ? '#' : MINUS + '#';
    return p.mate > 0 ? 'M' + p.mate : MINUS + 'M' + (-p.mate);
  }
  var v = p.cp / 100;
  if (Math.abs(v) < 0.05) return '0.0';
  return (v > 0 ? '+' : MINUS) + Math.abs(v).toFixed(1);
}
function evalWords(p) {
  if (p.mate != null) return p.mate > 0 || (p.mate === 0 && p.sign > 0) ? 'winning by force' : 'getting mated by force';
  var v = p.cp / 100, a = Math.abs(v), side = v > 0;
  if (a < 0.5) return 'about equal';
  if (a < 1.3) return side ? 'slightly better' : 'slightly worse';
  if (a < 3) return side ? 'clearly better' : 'clearly worse';
  return side ? 'winning' : 'losing';
}

var GRADE_ORDER = ['best', 'book', 'excellent', 'good', 'forced', 'inaccuracy', 'mistake', 'blunder'];
function isBad(g) { return g === 'inaccuracy' || g === 'mistake' || g === 'blunder'; }

function gradeMove(o) {
  if (o.mateDelivered) return 'best';
  if (o.legalCount === 1) return 'forced';
  var wb = winPct(povCp(o.evB)), wa = winPct(povCp(o.evA)), loss = Math.max(0, wb - wa), g;
  if (o.playedUci === o.bestUci || loss <= 1) g = 'best';
  else if (loss < 2.5) g = 'excellent';
  else if (loss < 5.5) g = 'good';
  else if (loss < 14) g = 'inaccuracy';
  else if (loss < 22) g = 'mistake';
  else g = 'blunder';
  /* the first few moves rarely decide anything; shallow search overstates them */
  if (o.moveNo && o.moveNo <= 3 && g === 'mistake' && povCp(o.evA) > -150) g = 'inaccuracy';
  /* both sides of the move are forced mates: grade by how much longer the mate got */
  if (o.evB.mate != null && o.evB.mate > 0 && o.evA.mate != null && o.evA.mate > 0 && o.playedUci !== o.bestUci) {
    var slip = o.evA.mate - (o.evB.mate - 1);
    g = slip <= 0 ? 'best' : slip === 1 ? 'excellent' : slip <= 3 ? 'good' : slip <= 6 ? 'inaccuracy' : 'mistake';
  }
  if (o.evA.mate != null && o.evA.mate < 0 && !(o.evB.mate != null && o.evB.mate < 0)) g = 'blunder';
  /* a missed forced mate only counts against you when it actually costs the win (not when you are still crushing) */
  if (o.evB.mate != null && o.evB.mate > 0 && !(o.evA.mate != null && o.evA.mate > 0) && povCp(o.evA) < 600) {
    var floor = o.evB.mate <= 2 ? 'mistake' : 'inaccuracy';
    if (GRADE_ORDER.indexOf(g) < GRADE_ORDER.indexOf(floor)) g = floor;
  }
  return g;
}
function moveAccuracy(evB, evA) {
  var loss = Math.max(0, winPct(povCp(evB)) - winPct(povCp(evA)));
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
}


/* ---- whole-game grading ---- */
function clampCp(p) { return Math.max(-1000, Math.min(1000, povCp(p))); }
/* average centipawn loss over graded moves (book moves count as 0) */
function acplOf(revs) {
  if (!revs.length) return null;
  var tot = 0;
  revs.forEach(function (r) { if (r.grade !== 'book') tot += Math.max(0, clampCp(r.evB) - clampCp(r.evA)); });
  return tot / revs.length;
}
/* rough playing strength from average centipawn loss; a guide, not a rating */
function ratingFromAcpl(acpl) { return Math.max(100, Math.min(2800, Math.round(3100 * Math.exp(-0.01 * acpl) / 50) * 50)); }
/* accuracy -> rough rating (piecewise), blended with the centipawn-loss estimate so one blunder counts but doesn't dominate */
function ratingFromAcc(acc) {
  var pts = [[0, 100], [50, 400], [60, 700], [70, 1000], [80, 1400], [85, 1700], [90, 2000], [95, 2400], [100, 2800]];
  for (var i = 1; i < pts.length; i++) if (acc <= pts[i][0]) { var a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (acc - a[0]) / (b[0] - a[0]); }
  return 2800;
}
function ratingEstimate(acc, acpl) { return Math.round((ratingFromAcc(acc) + ratingFromAcpl(acpl)) / 2 / 50) * 50; }
function letterGrade(acc) {
  if (acc >= 95) return 'A+'; if (acc >= 90) return 'A'; if (acc >= 85) return 'B+'; if (acc >= 80) return 'B';
  if (acc >= 75) return 'C+'; if (acc >= 70) return 'C'; if (acc >= 60) return 'D'; return 'F';
}
/* opening (book or first 10 moves), endgame (little material left), middlegame between */
function phaseOf(fen) {
  var b = new Chess(fen).board(), pieces = 0, queens = 0;
  b.forEach(function (row) { row.forEach(function (p) { if (p && p.type !== 'p' && p.type !== 'k') { pieces += VAL[p.type]; if (p.type === 'q') queens++; } }); });
  if (pieces <= 13 || (queens === 0 && pieces <= 20)) return 'endgame';
  if (moveNoOf(fen) <= 10 || bookName(fen)) return 'opening';
  return 'middlegame';
}

/* ---- describing moves in words ---- */
function describeMove(fenBefore, move, me) {
  var after = new Chess(fenBefore); after.move(move);
  var fenAfter = after.fen(), tags = [];
  var moveNo = moveNoOf(fenBefore);
  if (after.in_checkmate()) return ['delivers checkmate'];
  if (move.flags.indexOf('k') >= 0 || move.flags.indexOf('q') >= 0) tags.push('castles, tucking your king away safely');
  if (move.promotion) tags.push('promotes to a ' + PNAME[move.promotion]);
  if (move.captured) tags.push('takes the ' + PNAME[move.captured] + ' on ' + move.to);
  var hb = hangingPieces(fenBefore, me), ha = hangingPieces(fenAfter, me);
  var wasHanging = hb.some(function (h) { return h.sq === move.from; });
  var stillHangingTo = ha.some(function (h) { return h.sq === move.to; });
  if (wasHanging && !stillHangingTo && !move.captured) tags.push('moves your ' + PNAME[move.piece] + ' out of danger');
  hb.forEach(function (h) {
    if (h.sq === move.from || tags.length > 2) return;
    if (!ha.some(function (x) { return x.sq === h.sq; })) tags.push('protects your ' + PNAME[h.type] + ' on ' + h.sq);
  });
  var homeRank = me === 'w' ? '1' : '8';
  if ((move.piece === 'n' || move.piece === 'b') && move.from[1] === homeRank && moveNo <= 15 && !move.captured) tags.push('develops your ' + PNAME[move.piece]);
  if (move.piece === 'p' && ['d4', 'e4', 'd5', 'e5', 'c4', 'c5'].indexOf(move.to) >= 0 && moveNo <= 12 && !move.captured) tags.push('claims space in the center');
  if (after.in_check() && !after.in_checkmate()) tags.push('gives check');
  var mt = mateThreat(fenAfter, me);
  if (mt) tags.unshift('threatens checkmate with ' + mt);
  var targets = forkTargets(fenAfter, move.to).filter(function (t) { return t.type !== 'k'; });
  if (targets.length >= 2) tags.push('attacks the ' + PNAME[targets[0].type] + ' on ' + targets[0].sq + ' and the ' + PNAME[targets[1].type] + ' on ' + targets[1].sq + ' at once');
  else if (targets.length === 1 && !move.captured) tags.push('attacks the ' + PNAME[targets[0].type] + ' on ' + targets[0].sq);
  if (move.piece === 'r' && tags.length === 0) {
    var b = after.board(), f = FILES.indexOf(move.to[0]), pawns = 0;
    for (var r = 0; r < 8; r++) { var p = b[r][f]; if (p && p.type === 'p') pawns++; }
    if (pawns === 0) tags.push('puts your rook on an open file');
  }
  return tags;
}
function joinTags(tags) {
  if (!tags.length) return '';
  if (tags.length === 1) return tags[0];
  return tags.slice(0, -1).join(', ') + ' and ' + tags[tags.length - 1];
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/*
 * d = { fenBefore, fenAfter, played (chess.js move), me, grade,
 *       before:{bestmove,pv}, after:{bestmove,pv}, evB, evA }
 * returns { headline, body:[sentences], tip }
 */
function explainMove(d) {
  var me = d.me, opp = other(me), OPP = cname(opp), san = d.played.san;
  var HEAD = {
    book: san + ' is a book move',
    best: san + ' is the best move', excellent: san + ' is an excellent move', good: san + ' is a good move',
    forced: san + ' was your only legal move', inaccuracy: san + ' is an inaccuracy',
    mistake: san + ' is a mistake', blunder: san + ' is a blunder'
  };
  var afterC = new Chess(d.fenAfter);
  if (afterC.in_checkmate()) return { headline: san + ' is checkmate', body: ['That ends the game. Well played.'], tip: '' };
  if (afterC.in_stalemate()) return { headline: san + ' is stalemate', body: [OPP + ' has no legal moves and is not in check, so the game is a draw.' + (povCp(d.evB) > 300 ? ' You were winning, so this throws away the win. When you are far ahead, make sure the losing side always has a move.' : '')], tip: '' };

  var body = [], tip = '';
  var bestUci = d.before.bestmove, bestRes = bestUci && bestUci !== d.played.from + d.played.to + (d.played.promotion || '') ? tryMove(d.fenBefore, bestUci) : null;
  var bestMove = bestRes ? bestRes.move : null;
  var playedTags = describeMove(d.fenBefore, d.played, me);

  if (d.grade === 'forced') {
    body.push('Nothing else was legal here, so there is nothing to grade.');
    return { headline: HEAD.forced, body: body, tip: '' };
  }

  if (d.grade === 'book') {
    body.push('It is standard opening theory' + (d.opening ? ', part of the ' + d.opening : '') + '. Strong players have played this position for decades.');
    if (playedTags.length) body.push('It ' + joinTags(playedTags.slice(0, 2)) + '.');
    body.push('You are ' + evalWords(d.evA) + '.');
    return { headline: HEAD.book, body: body, tip: '' };
  }

  if (!isBad(d.grade)) {
    body.push(playedTags.length ? 'It ' + joinTags(playedTags.slice(0, 2)) + '.' : 'It keeps your position in good shape.');
    if (bestMove && d.grade !== 'best') {
      var bt = describeMove(d.fenBefore, bestMove, me);
      body.push('The engine slightly preferred ' + bestMove.san + (bt.length ? ', which ' + joinTags(bt.slice(0, 2)) : '') + '.');
    }
    if (d.evA.mate != null && d.evA.mate > 0) body.push(d.evB.mate != null && d.evB.mate > 0 ? 'It was mate in ' + d.evB.mate + ' before this move; now it is mate in ' + d.evA.mate + '.' : 'You now have a forced mate in ' + d.evA.mate + '.');
    else body.push('You are ' + evalWords(d.evA) + '.');
    return { headline: HEAD[d.grade], body: body, tip: '' };
  }

  /* ---- what goes wrong ---- */
  var reply = d.after.pv && d.after.pv[0];
  var replyRes = reply ? tryMove(d.fenAfter, reply) : null;
  var replyMove = replyRes ? replyRes.move : null;
  var matNow = material(d.fenAfter, me) - material(d.fenBefore, me);
  var played = d.after.pv && d.after.pv.length ? lineMaterial(d.fenAfter, d.after.pv, me) : { delta: 0, myLost: [], oppLost: [] };
  var playedTotal = matNow + played.delta;
  var best = d.before.pv && d.before.pv.length ? lineMaterial(d.fenBefore, d.before.pv, me) : { delta: 0, myLost: [], oppLost: [] };
  var hangBefore = hangingPieces(d.fenBefore, me);
  var said = false;

  if (d.evA.mate != null && d.evA.mate < 0 && replyMove) {
    var n = -d.evA.mate;
    body.push(n === 1 ? 'It allows checkmate: ' + replyMove.san + ' ends the game.' : 'It allows a forced checkmate. ' + OPP + ' mates in ' + n + ', starting with ' + replyMove.san + '.');
    said = true;
  } else if (playedTotal <= -1 && replyMove) {
    if (replyMove.captured) {
      var pre = hangBefore.some(function (h) { return h.sq === replyMove.to && h.sq !== d.played.to; });
      if (replyMove.to === d.played.to && !d.played.captured) body.push('Your ' + PNAME[d.played.piece] + ' on ' + d.played.to + ' is not safe there: ' + OPP + ' takes it with ' + replyMove.san + '.');
      else if (replyMove.to === d.played.to) body.push(OPP + ' recaptures with ' + replyMove.san + ', and the trade goes against you.');
      else if (pre) body.push('Your ' + PNAME[replyMove.captured] + ' on ' + replyMove.to + ' was already under attack, and this move did not deal with it. ' + OPP + ' takes it with ' + replyMove.san + '.');
      else body.push(replyMove.san + ' wins your ' + PNAME[replyMove.captured] + ' on ' + replyMove.to + '.');
    } else {
      var ft = forkTargets(replyRes.chess.fen(), replyMove.to);
      if (ft.length >= 2) body.push(replyMove.san + ' is a fork: it hits your ' + PNAME[ft[0].type] + ' and your ' + PNAME[ft[1].type] + ' at the same time, and you cannot save both.');
      else body.push('After ' + replyMove.san + ', ' + OPP + ' wins material by force.');
    }
    var theirs = played.oppLost.concat(d.played.captured ? [d.played.captured] : []), mine = played.myLost.slice();
    theirs = theirs.filter(function (t) { var i = mine.indexOf(t); if (i >= 0) { mine.splice(i, 1); return false; } return true; });
    var lineT = lineText(d.fenAfter, d.after.pv, Math.max(2, played.plies || 2));
    if (mine.length && theirs.length) body.push('After ' + lineT + ' you win ' + piecesPhrase(theirs) + ' but lose ' + piecesPhrase(mine) + '.');
    else if (mine.length) body.push('After ' + lineT + ' you are ' + piecesPhrase(mine).replace(/^a /, 'a ') + ' down.');
    else body.push('After ' + lineT + ' you end up ' + materialPhrase(-playedTotal) + ' down.');
    said = true;
  }

  /* ---- what was better ---- */
  if (bestMove) {
    var gain = best.delta;
    if (d.evB.mate != null && d.evB.mate > 0) {
      body.push('You had a forced checkmate: ' + lineText(d.fenBefore, d.before.pv, d.evB.mate * 2 - 1) + '.');
    } else if (gain - playedTotal >= 1 && gain >= 1) {
      var bt2 = forkTargets(bestRes.chess.fen(), bestMove.to);
      if (bestMove.captured && gain >= VAL[bestMove.captured] - 0.5) body.push('Better was ' + bestMove.san + ', which wins the ' + PNAME[bestMove.captured] + ' on ' + bestMove.to + ' for free.');
      else if (bt2.length >= 2 && !bestMove.captured) body.push('Better was ' + bestMove.san + ', a fork that attacks your opponent\'s ' + PNAME[bt2[0].type] + ' and ' + PNAME[bt2[1].type] + ' at once.');
      else body.push('Better was ' + bestMove.san + ', which wins ' + materialPhrase(gain) + ': ' + lineText(d.fenBefore, d.before.pv, Math.max(2, best.plies)) + '.');
    } else {
      var tg = describeMove(d.fenBefore, bestMove, me);
      body.push((said ? 'Instead, ' : '') + (said ? bestMove.san : 'Better was ' + bestMove.san) + (tg.length ? (said ? ' ' : ', which ') + joinTags(tg.slice(0, 2)) : (said ? ' keeps everything protected' : ', which keeps your position healthier')) + '.');
    }
  }
  if (!said && replyMove && !(d.evB.mate > 0)) {
    var threat = mateThreat(replyRes.chess.fen(), opp);
    if (threat) body.push('After ' + OPP + '\'s reply ' + replyMove.san + ', ' + OPP + ' threatens ' + threat + ', and you have to spend your next moves defending.');
    else body.push('No material is lost right away, but after ' + OPP + '\'s best reply ' + replyMove.san + ' your position gets worse.');
  }
  var wB = evalWords(d.evB), wA = evalWords(d.evA);
  body.push('The evaluation went from ' + fmtEval(d.evB) + ' to ' + fmtEval(d.evA) + ' for you: ' + (wB === wA ? 'you are still ' + wA + ', but your edge shrank.' : 'you went from ' + wB + ' to ' + wA + '.'));

  /* ---- a principle, when one applies ---- */
  var mn = moveNoOf(d.fenBefore);
  if (d.played.piece === 'q' && mn <= 7 && !d.played.captured) tip = 'Bringing the queen out early lets your opponent develop pieces while chasing it.';
  else if (d.played.piece === 'k' && d.played.flags.indexOf('k') < 0 && d.played.flags.indexOf('q') < 0 && /[KQkq]/.test(d.fenBefore.split(' ')[2]) && mn <= 20) tip = 'Moving your king gives up the right to castle for the rest of the game.';
  else if (d.played.piece === 'n' && /^[ah]/.test(d.played.to) && mn <= 15) tip = 'A knight on the edge of the board controls half as many squares as one in the center.';
  else if (hangBefore.length && replyMove && replyMove.captured && hangBefore.some(function (h) { return h.sq === replyMove.to; })) tip = 'Before every move, ask: what is my opponent attacking right now?';
  else if (replyMove && (replyMove.captured || /\+/.test(replyMove.san))) tip = 'Before you commit, check your opponent\'s captures and checks first.';
  return { headline: HEAD[d.grade], body: body, tip: tip };
}

if (typeof module !== 'undefined') module.exports = { buildBook: buildBook, bookName: bookName, explainMove: explainMove, gradeMove: gradeMove, pov: pov, fmtEval: fmtEval, lineText: lineText, hangingPieces: hangingPieces, moveAccuracy: moveAccuracy };
