/* Guess the Pick: the rules, with no page code, so tools/guess_the_pick_check.js can test them in node.
     GTP.norm(name)              a name boiled down for matching: no accents, punctuation or Jr./III
     GTP.dailyKey(date)          today's date in Boston time, "2026-10-28", which seeds the daily ten
     GTP.daily(picks, sport, d)  the day's ten picks: the same for everyone, weighted toward known players
     GTP.endless(picks, seen, r) one more random pick for endless mode, skipping the ones already seen
     GTP.judge(guess, pick, pool)  "right", "wrong" (a real player, just not this one) or "unknown"
     GTP.suggest(text, pool, n)  name suggestions for the guess box, best known first
   Scoring: every pick starts at 3 points. A hint or a wrong guess costs one; at zero the answer shows. */
(function (root) {
  var POINTS = 3, DAILY = 10, LIVES = 3;
  var TZ = "America/New_York";

  function norm(name) {
    return String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[ðđ]/gi, "d").replace(/ø/gi, "o").replace(/ł/gi, "l").replace(/æ/gi, "ae").replace(/ß/g, "ss")
      .toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ")
      .replace(/\s+/g, " ").trim();
  }
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
  function pool(picks) {
    var by = {}, last = {};
    picks.forEach(function (p) {
      var k = norm(p.n);
      if (!by[k] || by[k].f < p.f) by[k] = { n: p.n, k: k, f: p.f || 0 };
    });
    var names = Object.keys(by).map(function (k) { return by[k]; });
    names.forEach(function (x) { var l = lastName(x.n); last[l] = (last[l] || 0) + 1; });
    names.sort(function (a, b) { return b.f - a.f || a.n.localeCompare(b.n); });
    return { names: names, byKey: by, lastCount: last };
  }

  function judge(guess, pick, pl) {
    var g = norm(guess);
    if (!g) return "unknown";
    if (g === norm(pick.n)) return "right";
    // Just the last name counts when nobody else in the game shares it.
    if (g === lastName(pick.n) && pl.lastCount[g] === 1) return "right";
    if (pl.byKey[g] || pl.lastCount[g]) return "wrong";
    return "unknown";
  }

  function suggest(text, pl, n) {
    var words = norm(text).split(" ").filter(Boolean);
    if (!words.length) return [];
    var out = [];
    for (var i = 0; i < pl.names.length && out.length < (n || 6); i++) {
      var parts = pl.names[i].k.split(" ");
      var ok = words.every(function (w) { return parts.some(function (p) { return p.indexOf(w) === 0; }); });
      if (ok) out.push(pl.names[i].n);
    }
    return out;
  }

  var api = { POINTS: POINTS, DAILY: DAILY, LIVES: LIVES, norm: norm, dailyKey: dailyKey, seeded: seeded,
    daily: daily, endless: endless, pool: pool, judge: judge, suggest: suggest };
  root.GTP = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
