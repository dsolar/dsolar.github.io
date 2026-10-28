/* Guess the Pick: the rules, with no page code, so tools/guess_the_pick_check.js can test them in node.
     GTP.norm(name)              a name boiled down for matching: no accents, punctuation or Jr./III
     GTP.dailyKey(date)          today's date in Boston time, "2026-10-28", which seeds the daily ten
     GTP.daily(picks, sport, d)  the day's ten picks: the same for everyone, weighted toward known players
     GTP.endless(picks, seen, r) one more random pick for endless mode, skipping the ones already seen
     GTP.judge(guess, pick, pool)  "right", "wrong", "ambiguous" (a shared last name) or "unknown" (a typo)
     GTP.suggest(text, pool, n)  name suggestions for the guess box, best known first
   Scoring: every pick starts at 3 points. A hint or a wrong guess costs one; at zero the answer shows. */
(function (root) {
  var POINTS = 3, DAILY = 10, LIVES = 3;
  var TZ = "America/New_York";

  // Apostrophes and periods vanish (Ja'Marr is "jamarr", T.J. is "tj"); hyphens and other marks become spaces.
  function norm(name) {
    return String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[ðđ]/gi, "d").replace(/ø/gi, "o").replace(/ł/gi, "l").replace(/æ/gi, "ae").replace(/ß/g, "ss")
      .toLowerCase().replace(/['\u2018\u2019`.]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()
      .replace(/( (jr|sr|ii|iii|iv|v))+$/, "");   // a suffix only at the end: J.R. Smith stays "jr smith"
  }
  // The same name with no spaces at all, so "amonra" finds Amon-Ra and "dk metcalf" finds D.K. Metcalf
  function squash(name) { return norm(name).replace(/ /g, ""); }
  function lastName(name) { var w = norm(name).split(" "); return w[w.length - 1] || ""; }

  function dailyKey(date) {
    return new Date(date || Date.now()).toLocaleDateString("en-CA", { timeZone: TZ });
  }

  // A small seeded random number generator (mulberry32), so a date always gives the same ten picks.
  function seeded(text) {
    var h = 1779033703 ^ text.length;
    for (var i = 0; i < text.length; i++) { h = Math.imul(h ^ text.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    var a = h >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // A star comes up about ten times as often as a pick nobody remembers, so a day has a few of each.
  function weight(p) { return 0.12 + 1.6 * (p.f || 0); }

  function draw(picks, rand, skip) {
    var total = 0, i;
    for (i = 0; i < picks.length; i++) if (!skip[i]) total += weight(picks[i]);
    if (!total) return -1;
    var x = rand() * total;
    for (i = 0; i < picks.length; i++) {
      if (skip[i]) continue;
      x -= weight(picks[i]);
      if (x <= 0) return i;
    }
    for (i = picks.length - 1; i >= 0; i--) if (!skip[i]) return i;
    return -1;
  }

  // The daily ten: never two from the same draft, so a day covers the whole 20 years.
  function daily(picks, sport, date) {
    var rand = seeded("guess-the-pick|" + sport + "|" + dailyKey(date));
    var skip = {}, years = {}, out = [];
    while (out.length < DAILY) {
      var i = draw(picks, rand, skip);
      if (i < 0) break;
      skip[i] = true;
      if (years[picks[i].y] && Object.keys(years).length < 20) continue;
      years[picks[i].y] = true;
      out.push(i);
    }
    return out;
  }

  function endless(picks, seen, rand) {
    var skip = {};
    (seen || []).forEach(function (i) { skip[i] = true; });
    if (Object.keys(skip).length >= picks.length) skip = {};
    return draw(picks, rand || Math.random, skip);
  }

  // Every distinct name in a sport, with its best-known pick's fame, for suggestions and for judging guesses.
  // Every name the guess box knows: the game's own picks plus everyone in names.js (all players drafted or
  // playing since 1980), in names.js order, which is best careers first. Knowing far more names than the game
  // uses means a missing suggestion never gives an answer away.
  function pool(picks, known) {
    var by = {}, sq = {}, last = {}, names = [];
    var add = function (n) {
      var k = norm(n);
      if (!k || by[k]) return;
      var x = { n: n, k: k, sq: k.replace(/ /g, ""), parts: k.split(" ") };
      by[k] = x; sq[x.sq] = sq[x.sq] || x; names.push(x);
      var l = x.parts[x.parts.length - 1]; last[l] = (last[l] || 0) + 1;
    };
    (known || []).forEach(add);
    picks.slice().sort(function (a, b) { return (b.f || 0) - (a.f || 0); }).forEach(function (p) { add(p.n); });
    return { names: names, byKey: by, bySquash: sq, lastCount: last };
  }

  // "right", "wrong" (a real player, just not this one), "ambiguous" (a last name several players share)
  // or "unknown" (a typo, or nobody the game knows). Only "wrong" costs a point.
  function judge(guess, pick, pl) {
    var g = norm(guess);
    if (!g) return "unknown";
    if (g === norm(pick.n) || squash(g) === squash(pick.n)) return "right";
    if (pl.byKey[g] || pl.bySquash[squash(g)]) return "wrong";
    var n = pl.lastCount[g];
    if (n === 1) return g === lastName(pick.n) ? "right" : "wrong";
    if (n > 1) return "ambiguous";
    return "unknown";
  }

  function suggest(text, pl, n) {
    var words = norm(text).split(" ").filter(Boolean), flat = squash(text);
    if (!words.length) return [];
    var out = [];
    for (var i = 0; i < pl.names.length && out.length < (n || 6); i++) {
      var x = pl.names[i];
      var ok = x.sq.indexOf(flat) === 0
        || words.every(function (w) { return x.parts.some(function (p) { return p.indexOf(w) === 0; }); });
      if (ok) out.push(x.n);
    }
    return out;
  }

  var api = { POINTS: POINTS, DAILY: DAILY, LIVES: LIVES, norm: norm, squash: squash, dailyKey: dailyKey, seeded: seeded,
    daily: daily, endless: endless, pool: pool, judge: judge, suggest: suggest };
  root.GTP = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
