/* Paint the Corners: game engine (no DOM). Red Sox vs. Yankees. */
(function (root) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  function shuffle(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ---- pitchers. fam = how the pitch behaves: FB fastball, SL slider/cutter, CH change/splitter, CB curve ----
  const PITCHERS = {
    pedro: {
      key: 'pedro', name: 'Pedro Martinez', last: 'Pedro', num: 45, role: 'Starter',
      pitches: [
        { key: 'FB', fam: 'FB', name: 'Fastball', velo: 92, miss: 0.13, stuff: 0.03, dur: 400, blurb: 'Late life. Best command in your bag, deadly up in the zone.' },
        { key: 'CH', fam: 'CH', name: 'Changeup', velo: 81, miss: 0.17, stuff: 0.11, dur: 510, blurb: 'The best changeup alive. Arm speed sells the fastball, then it dies.' },
        { key: 'CB', fam: 'CB', name: 'Curveball', velo: 76, miss: 0.24, stuff: 0.08, dur: 570, blurb: 'Big bend. Bury it down when you have two strikes.' },
        { key: 'CT', fam: 'SL', name: 'Cutter', velo: 87, miss: 0.17, stuff: 0.05, dur: 440, blurb: 'Late glove-side cut. Ties up lefties, gets weak contact.', noHang: true },
      ],
    },
    papelbon: {
      key: 'papelbon', name: 'Jonathan Papelbon', last: 'Papelbon', num: 58, role: 'Closer',
      pitches: [
        { key: 'FB', fam: 'FB', name: 'Fastball', velo: 95, miss: 0.14, stuff: 0.06, dur: 370, blurb: 'Rising heat. Climb the ladder for swings and misses.' },
        { key: 'SP', fam: 'CH', name: 'Splitter', velo: 86, miss: 0.19, stuff: 0.10, dur: 460, blurb: 'Looks like the heater, then falls off the table.' },
        { key: 'SL', fam: 'SL', name: 'Slider', velo: 84, miss: 0.21, stuff: 0.06, dur: 470, blurb: 'Show-me pitch. Keep it down and glove side.' },
      ],
    },
  };

  const MODES = {
    hold: { key: 'hold', label: 'Close It Out', pitcher: 'papelbon', innings: 2, startInning: 8, fatigueAt: 30, fatigueSpan: 25, lead: 1 },
    cg: { key: 'cg', label: 'Complete Game', pitcher: 'pedro', innings: 9, startInning: 1, fatigueAt: 90, fatigueSpan: 45, lead: null, hookPitches: 140, hookRuns: 7 },
  };

  // ---- the Yankees: the lineups Pedro faced at Fenway in the 2003 and 2004 ALCS, with that season's stats ----
  const YANKEES = {
    2003: {
      year: 2003, game: '2003 ALCS Game 3', date: 'Oct. 11, 2003', manager: 'Grady Little',
      lineup: [
        { name: 'Enrique Wilson', pos: '3B', bats: 'S', pa: 147, ab: 135, h: 31, hr: 3, bb: 7, so: 14, avg: .230, obp: .276, slg: .363, spd: .4, pedro: true, book: "Torre starts him for one reason: he hits Pedro." },
        { name: 'Derek Jeter', pos: 'SS', bats: 'R', pa: 542, ab: 482, h: 156, hr: 10, bb: 43, so: 88, avg: .324, obp: .393, slg: .450, spd: .65, book: 'Inside-out swing. He will fight off your best stuff and flare it to right.' },
        { name: 'Jason Giambi', pos: 'DH', bats: 'L', pa: 690, ab: 535, h: 134, hr: 41, bb: 129, so: 140, avg: .250, obp: .412, slg: .527, spd: .15, vs: { FB: 1 }, book: '41 homers and 129 walks. Patient, and he punishes mistakes.' },
        { name: 'Bernie Williams', pos: 'CF', bats: 'S', pa: 521, ab: 445, h: 117, hr: 15, bb: 71, so: 61, avg: .263, obp: .367, slg: .411, spd: .4, book: 'Switch hitter, so he bats lefty against you. Hard to strike out.' },
        { name: 'Jorge Posada', pos: 'C', bats: 'S', pa: 588, ab: 481, h: 135, hr: 30, bb: 93, so: 110, avg: .281, obp: .405, slg: .518, spd: .2, book: 'Grinds every at-bat. Thirty homers this year.' },
        { name: 'Nick Johnson', pos: '1B', bats: 'L', pa: 406, ab: 324, h: 92, hr: 14, bb: 70, so: 57, avg: .284, obp: .422, slg: .472, spd: .3, book: 'Maybe the best eye in the lineup. He will not chase.' },
        { name: 'Hideki Matsui', pos: 'LF', bats: 'L', pa: 695, ab: 623, h: 179, hr: 16, bb: 63, so: 86, avg: .287, obp: .353, slg: .435, spd: .4, book: 'Rookie year. Rarely strikes out, sprays it gap to gap.' },
        { name: 'Karim Garcia', pos: 'RF', bats: 'L', pa: 161, ab: 151, h: 46, hr: 6, bb: 9, so: 32, avg: .305, obp: .342, slg: .457, spd: .35, book: 'Free swinger. He will expand the zone if you let him.' },
        { name: 'Alfonso Soriano', pos: '2B', bats: 'R', pa: 734, ab: 682, h: 198, hr: 38, bb: 38, so: 130, avg: .290, obp: .338, slg: .525, spd: .8, vs: { SL: -1, FB: 1 }, book: '38 homers, 38 walks. Hunts fastballs, chases breaking stuff away.' },
      ],
    },
    2004: {
      year: 2004, game: '2004 ALCS Game 5', date: 'Oct. 18, 2004', manager: 'Terry Francona',
      lineup: [
        { name: 'Derek Jeter', pos: 'SS', bats: 'R', pa: 721, ab: 643, h: 188, hr: 23, bb: 46, so: 99, avg: .292, obp: .352, slg: .471, spd: .6, book: '23 homers this year, and he still loves to go the other way.' },
        { name: 'Alex Rodriguez', pos: '3B', bats: 'R', pa: 698, ab: 601, h: 172, hr: 36, bb: 80, so: 131, avg: .286, obp: .375, slg: .512, spd: .55, book: 'First year in pinstripes. 36 homers. Do not make a mistake.' },
        { name: 'Gary Sheffield', pos: 'RF', bats: 'R', pa: 684, ab: 573, h: 166, hr: 36, bb: 92, so: 83, avg: .290, obp: .393, slg: .534, spd: .45, vs: { FB: 1 }, book: "Fastest bat in the league. Don't try to throw it by him." },
        { name: 'Hideki Matsui', pos: 'LF', bats: 'L', pa: 680, ab: 584, h: 174, hr: 31, bb: 88, so: 103, avg: .298, obp: .390, slg: .522, spd: .4, book: '31 homers and a .390 OBP. Your toughest out tonight.' },
        { name: 'Bernie Williams', pos: 'CF', bats: 'S', pa: 651, ab: 561, h: 147, hr: 22, bb: 85, so: 96, avg: .262, obp: .360, slg: .435, spd: .35, book: 'Switch hitter, so he bats lefty against you. Still has pop.' },
        { name: 'Jorge Posada', pos: 'C', bats: 'S', pa: 547, ab: 449, h: 122, hr: 21, bb: 88, so: 92, avg: .272, obp: .400, slg: .481, spd: .2, book: 'Takes his walks and waits for one to drive.' },
        { name: 'Ruben Sierra', pos: 'DH', bats: 'S', pa: 338, ab: 307, h: 75, hr: 17, bb: 25, so: 55, avg: .244, obp: .296, slg: .456, spd: .2, book: 'Free-swinging switch hitter with real pop.' },
        { name: 'Tony Clark', pos: '1B', bats: 'S', pa: 283, ab: 253, h: 56, hr: 16, bb: 26, so: 92, avg: .221, obp: .297, slg: .458, spd: .15, book: 'Strikes out about a third of the time, but the power is real.' },
        { name: 'Miguel Cairo', pos: '2B', bats: 'R', pa: 408, ab: 360, h: 105, hr: 6, bb: 18, so: 49, avg: .292, obp: .346, slg: .417, spd: .55, book: 'Slap hitter. Puts it in play and makes you field it.' },
      ],
    },
  };

  // ---- zone geometry: 5x5 grid, rows 0..4 top to bottom, cols 0..4 left to right, pitcher's view ----
  const inZone = (r, c) => r >= 1 && r <= 3 && c >= 1 && c <= 3;
  const inGrid = (r, c) => r >= 0 && r <= 4 && c >= 0 && c <= 4;
  const zIdx = (r, c) => (r - 1) * 3 + (c - 1);
  // pitcher's view: a right-handed batter stands on the right (high c), so inside = high c
  const relIn = (c, bats) => (bats === 'R' ? c - 2 : 2 - c);
  const isZoneCorner = (r, c) => inZone(r, c) && r !== 2 && c !== 2;

  function locText(r, c, bats) {
    if (r === 2 && c === 2) return 'middle-middle';
    const v = r < 0 ? 'way high' : r === 0 ? 'high' : r === 1 ? 'up' : r === 2 ? '' : r === 3 ? 'down' : r === 4 ? 'low' : 'in the dirt';
    const rel = relIn(c, bats);
    const h = rel >= 3 ? 'way inside' : rel === 2 ? 'inside' : rel === 1 ? 'in' : rel === 0 ? '' : rel === -1 ? 'away' : rel === -2 ? 'off the plate away' : 'way outside';
    if (v && h) return v + ' and ' + h;
    if (v) return { 'up': 'up in the zone', 'down': 'down in the zone' }[v] || v;
    return { 'in': 'on the inner half', 'away': 'on the outer half' }[h] || h;
  }

  function neighbors3(i) {
    const r = Math.floor(i / 3), c = i % 3, out = [];
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dr, dc]) => {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 3 && nc >= 0 && nc < 3) out.push(nr * 3 + nc);
    });
    return out;
  }
  const dist3 = (a, b) => Math.abs(Math.floor(a / 3) - Math.floor(b / 3)) + Math.abs((a % 3) - (b % 3));

  function genHeat(rng, a) {
    const h = new Array(9).fill(0);
    const hot = Math.floor(rng() * 9);
    h[hot] = 2;
    neighbors3(hot).forEach(n => { if (rng() < 0.55) h[n] = 1; });
    let far = [], best = -1;
    for (let i = 0; i < 9; i++) { const d = dist3(i, hot); if (d > best) { best = d; far = [i]; } else if (d === best) far.push(i); }
    const cold = pick(rng, far);
    h[cold] = -2;
    neighbors3(cold).forEach(n => { if (h[n] === 0 && rng() < 0.6) h[n] = -1; });
    const neutral = () => { const z = []; h.forEach((v, i) => { if (v === 0) z.push(i); }); return z; };
    if (a.power >= 0.6) { const z = neutral(); if (z.length) h[pick(rng, z)] = 1; }
    if (a.eye <= 0.4) { const z = neutral(); if (z.length) h[pick(rng, z)] = -1; }
    return h;
  }

  // turn a real stat line into the hitter's ratings
  function ratingsFrom(p) {
    const kp = p.so / p.pa, bbp = p.bb / p.pa, iso = p.slg - p.avg, hrp = p.hr / p.pa;
    const babip = (p.h - p.hr) / Math.max(1, p.ab - p.so - p.hr);
    const eye = clamp(0.1 + bbp * 4.5, 0.1, 0.95);
    return {
      contact: clamp(0.97 - kp * 1.25, 0.52, 0.9),
      eye,
      power: clamp(0.5 * (iso - 0.08) * 4.2 + 0.5 * hrp * 15, 0.1, 1),
      aggr: clamp(0.85 - eye * 0.5, 0.3, 0.85),
      bip: clamp((babip - 0.295) * 0.6, -0.05, 0.06),
      speed: p.spd,
    };
  }

  function makeLineup(rng, year, pitcher) {
    const fams = [...new Set(pitcher.pitches.map(p => p.fam))];
    return YANKEES[year].lineup.map((p, i) => {
      const a = ratingsFrom(p);
      if (p.pedro && pitcher.key === 'pedro') { a.contact += 0.06; a.bip += 0.04; }
      const vs = { FB: 0, SL: 0, CH: 0, CB: 0 };
      if (p.vs) Object.assign(vs, p.vs);
      else {
        const order = shuffle(rng, ['FB', 'SL', 'CH', 'CB']);
        vs[order[0]] = 1; vs[order[1]] = -1;
      }
      // make sure he has at least one tendency against this pitcher's arsenal
      if (!fams.some(f => vs[f] !== 0)) vs[pick(rng, fams)] = rng() < 0.5 ? 1 : -1;
      return {
        name: p.name, pos: p.pos, slot: i + 1, switchHitter: p.bats === 'S', bats: p.bats === 'S' ? 'L' : p.bats,
        book: p.book, pedroKiller: !!p.pedro, ...a, heat: genHeat(rng, a), vs,
        known: new Array(9).fill(false), pitchKnown: {}, notes: [], pa: 0,
        slash: [p.avg, p.obp, p.slg], hr: p.hr,
        line: { pa: 0, h: 0, bb: 0, k: 0, hr: 0 },
      };
    });
  }

  function newGame(modeKey, year, seed) {
    const mode = MODES[modeKey];
    year = YANKEES[year] ? +year : 2004;
    seed = seed == null ? Math.floor(Math.random() * 2 ** 31) : seed;
    const rng = mulberry32(seed);
    const pitcher = PITCHERS[mode.pitcher];
    const oppStart = mode.lead ? 1 + Math.floor(rng() * 3) : 0;
    const s = {
      mode, year, team: YANKEES[year], seed, rng, pitcher,
      pitchMap: Object.fromEntries(pitcher.pitches.map(p => [p.key, p])),
      lineup: makeLineup(rng, year, pitcher),
      idx: mode.lead ? Math.floor(rng() * 9) : 0,
      inning: mode.startInning, outs: 0, balls: 0, strikes: 0, bases: [null, null, null],
      pitchCount: 0, strikesThrown: 0, runs: 0, oppStart, bosRuns: mode.lead ? oppStart + mode.lead : 0,
      stats: { bf: 0, h: 0, bb: 0, hbp: 0, k: 0, hr: 0, outs: 0 },
      abPitches: [], film: 3, over: false, result: null, inningRuns: [0],
    };
    startPA(s);
    return s;
  }

  function batter(s) { return s.lineup[s.idx]; }
  function pitchFor(s, fam) { return s.pitcher.pitches.find(p => p.fam === fam); }

  function revealCell(b, i) { if (!b.known[i]) { b.known[i] = true; return true; } return false; }
  function revealPitch(s, b, fam) {
    const P = pitchFor(s, fam);
    if (!P || b.vs[fam] === 0 || b.pitchKnown[fam]) return null;
    b.pitchKnown[fam] = true;
    const n = P.name.toLowerCase();
    const note = b.vs[fam] > 0 ? `Sits on the ${n}` : `Can't pick up the ${n}`;
    b.notes.push({ kind: b.vs[fam] > 0 ? 'bad' : 'good', text: note });
    return note;
  }

  function startPA(s) {
    const b = batter(s);
    b.pa += 1;
    s.balls = 0; s.strikes = 0; s.abPitches = [];
    if (b.pa === 1) {
      // advance scouting: his damage zone plus one pitch tendency
      revealCell(b, b.heat.indexOf(2));
      const tend = s.pitcher.pitches.map(p => p.fam).filter(f => b.vs[f] !== 0);
      if (tend.length) revealPitch(s, b, pick(s.rng, tend));
    }
  }

  function fatigue(s) {
    return Math.max(0, (s.pitchCount - s.mode.fatigueAt) / s.mode.fatigueSpan);
  }

  function locEdge(P, r, c, bats) {
    // positive = helps the pitcher
    let e = 0;
    const glove = c <= 1; // RHP glove side is the pitcher's left
    switch (P.fam) {
      case 'FB': if (r <= 1) e += 0.08; if (r === 2 && c === 2) e -= 0.05; break;
      case 'SL': if (glove) e += 0.05; if (r >= 3) e += 0.04; if (r <= 1 && !P.noHang) e -= 0.09; break;
      case 'CH': if (r >= 3) e += 0.07; if (bats === 'L') e += 0.04; if (r <= 1) e -= 0.09; break;
      case 'CB': if (r >= 3) e += 0.08; if (r <= 1) e -= 0.10; break;
    }
    return e;
  }
  const isHanger = (P, r) => P.fam !== 'FB' && !P.noHang && r <= 1;

  function chaseBonus(P, r, c) {
    let b = 0;
    if (P.fam === 'FB' && r === 0) b += 0.08;
    if (P.fam !== 'FB' && r === 4) b += 0.08;
    if (P.fam === 'SL' && c === 0) b += 0.06;
    return b;
  }

  function seqMods(s, P, r, c) {
    const ab = s.abPitches;
    let contact = 0, chase = 0, run = 0, tunnel = false;
    if (ab.length) {
      for (let i = ab.length - 1; i >= 0; i--) { if (ab[i].type === P.key) run++; else break; }
      contact += 0.05 * Math.min(run, 3);
      const prev = s.pitchMap[ab[ab.length - 1].type];
      if ((prev.fam === 'FB') !== (P.fam === 'FB')) { contact -= 0.04; chase += 0.04; tunnel = true; }
      if (ab[ab.length - 1].ar === r && ab[ab.length - 1].ac === c) contact += 0.04;
    }
    return { contact, chase, run, tunnel };
  }

  function missChance(s, key, tr, tc) {
    let miss = s.pitchMap[key].miss + fatigue(s) * 0.10;
    const tz = inZone(tr, tc);
    if (isZoneCorner(tr, tc)) miss += 0.08;
    else if (tz && !(tr === 2 && tc === 2)) miss += 0.04;
    else if (!tz) miss -= 0.04;
    return clamp(miss, 0.04, 0.6);
  }

  const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  // Throw one pitch. Mutates state, returns an event describing what happened.
  function throwPitch(s, key, tr, tc) {
    if (s.over) return null;
    const P = s.pitchMap[key], b = batter(s), rng = s.rng;
    const fat = fatigue(s);
    const countBefore = [s.balls, s.strikes];
    const ev = { type: key, fam: P.fam, pitch: P, tr, tc, batter: b, countBefore, reveal: [], notes: [], runs: 0, inning: s.inning };

    // command
    const miss = missChance(s, key, tr, tc);
    let ar = tr, ac = tc;
    ev.missed = rng() < miss;
    if (ev.missed) { const [dr, dc] = pick(rng, DIRS); ar += dr; ac += dc; }
    ev.ar = ar; ev.ac = ac;

    const off = !inGrid(ar, ac);
    const zone = inZone(ar, ac);
    const heat = zone ? b.heat[zIdx(ar, ac)] : 0;
    const seq = seqMods(s, P, ar, ac);
    const le = locEdge(P, ar, ac, b.bats);
    const tto = (b.pa - 1);
    const mm = ar === 2 && ac === 2;
    const hanger = isHanger(P, ar) && zone;
    const vs = b.vs[P.fam] || 0;
    ev.zone = zone; ev.off = off; ev.heat = heat; ev.hanger = hanger; ev.mm = mm; ev.tunnel = seq.tunnel; ev.repeat = seq.run;
    ev.painted = zone && isZoneCorner(ar, ac);

    s.pitchCount += 1;
    s.abPitches.push({ type: key, tr, tc, ar, ac });

    // hit by pitch: missed way off the grid on the inside
    if (off && relIn(ac, b.bats) >= 3 && rng() < 0.35) {
      ev.call = 'hbp';
      endPA(s, ev, 'HBP');
      return ev;
    }

    // swing decision
    let sw = 0;
    if (!off) {
      const gridCorner = (ar === 0 || ar === 4) && (ac === 0 || ac === 4);
      if (zone) {
        sw = 0.56 + b.aggr * 0.22;
        if (s.strikes === 2) sw += 0.18;
        if (s.balls > s.strikes && P.fam === 'FB') sw += 0.10;
        if (s.balls === 0 && s.strikes === 0) sw -= 0.08;
        if (s.balls === 3 && s.strikes === 0) sw *= 0.35;
      } else {
        // just off the edge looks hittable; the far corners rarely do
        sw = 0.20 + (1 - b.eye) * 0.32;
        sw += chaseBonus(P, ar, ac) + seq.chase;
        if (s.strikes === 2) sw += 0.10;
        if (s.balls > s.strikes) sw -= 0.06;
        if (gridCorner) sw *= 0.5;
        if (s.balls === 3 && s.strikes === 0) sw *= 0.2;
      }
      sw = clamp(sw, 0, 0.95);
    }
    ev.swing = rng() < sw;

    if (!ev.swing) {
      // take: umpire. a little room on the black, either way
      let strike = zone;
      const outerEdge = !zone && !off && !((ar === 0 || ar === 4) && (ac === 0 || ac === 4));
      if (outerEdge && rng() < 0.15) { strike = true; ev.ump = 'gift'; }
      else if (zone && !mm && !(ar === 2 || ac === 2) && rng() < 0.05) { strike = false; ev.ump = 'squeeze'; }
      if (strike) {
        ev.call = 'called';
        s.strikesThrown += 1;
        if (s.strikes === 2) { endPA(s, ev, 'K', 'looking'); return ev; }
        s.strikes += 1;
      } else {
        ev.call = 'ball';
        if (s.balls === 3) { endPA(s, ev, 'BB'); return ev; }
        s.balls += 1;
      }
      return ev;
    }

    // swing: reveal what he thinks of that spot
    s.strikesThrown += 1;
    if (zone && revealCell(b, zIdx(ar, ac))) ev.reveal.push(zIdx(ar, ac));

    let pc = b.contact + 0.09 + (zone ? heat * 0.06 : -0.12) + (ev.painted ? -0.03 : 0) + (mm ? 0.05 : 0) - P.stuff + vs * 0.07 - le * 0.7 + seq.contact + tto * 0.035 + fat * 0.06 + (s.strikes === 2 ? 0.04 : 0);
    pc = clamp(pc, 0.15, 0.97);
    if (rng() >= pc) {
      ev.call = 'whiff';
      if (vs < 0 && rng() < 0.5) { const n = revealPitch(s, b, P.fam); if (n) ev.notes.push(n); }
      if (s.strikes === 2) { endPA(s, ev, 'K', 'swinging'); return ev; }
      s.strikes += 1;
      return ev;
    }

    let pf = 0.46 + (zone ? 0 : 0.12) + (s.strikes === 2 ? 0.06 : 0) - (zone ? Math.max(0, heat) * 0.07 : 0) + (zone && heat < 0 ? 0.05 : 0) + (ev.painted ? 0.05 : 0);
    pf = clamp(pf, 0.15, 0.75);
    if (rng() < pf) {
      ev.call = 'foul';
      if (s.strikes < 2) s.strikes += 1;
      return ev;
    }

    // ball in play
    ev.call = 'inplay';
    let q = b.power * 0.45 + (zone ? heat * 0.13 : -0.18) + (mm ? 0.15 : 0) + vs * 0.06 - P.stuff * 0.6 - le * 0.8 + tto * 0.04 + fat * 0.08 + (hanger ? 0.10 : 0) + (ev.painted ? -0.06 : 0);
    const hitP = clamp(0.26 + b.bip + q * 0.30, 0.10, 0.65);
    let result;
    if (rng() < hitP) {
      const hrP = clamp(0.01 + b.power * 0.20 + (zone ? heat * 0.045 : -0.03) + (mm ? 0.08 : 0) + (hanger ? 0.08 : 0) - (ar >= 3 ? 0.03 : 0), 0.005, 0.55);
      const tripP = 0.008 + b.speed * 0.03;
      const dblP = 0.17 + b.power * 0.06;
      const x = rng();
      if (x < hrP) result = 'HR';
      else if (x < hrP + tripP) result = '3B';
      else if (x < hrP + tripP + dblP) result = '2B';
      else result = '1B';
      if (vs > 0 && rng() < 0.5) { const n = revealPitch(s, b, P.fam); if (n) ev.notes.push(n); }
    } else {
      const x = rng();
      if (ar <= 1) result = x < 0.6 ? 'FO' : x < 0.85 ? 'PO' : 'LO';
      else if (ar === 2) result = x < 0.45 ? 'GO' : x < 0.85 ? 'FO' : 'LO';
      else result = x < 0.7 ? 'GO' : x < 0.9 ? 'FO' : 'LO';
    }
    endPA(s, ev, result);
    return ev;
  }

  function advance(s, ev, result) {
    // returns runs scored; mutates bases and outs
    const B = s.bases, rng = s.rng;
    const b = batter(s);
    let runs = 0;
    const score = () => { runs += 1; };
    ev.play = result;
    switch (result) {
      case 'BB': case 'HBP': {
        if (B[0]) { if (B[1]) { if (B[2]) score(); B[2] = B[1]; } B[1] = B[0]; }
        B[0] = b; break;
      }
      case '1B': {
        if (B[2]) { score(); B[2] = null; }
        if (B[1]) { if (rng() < 0.6) score(); else B[2] = B[1]; B[1] = null; }
        if (B[0]) { if (!B[2] && rng() < 0.25) B[2] = B[0]; else B[1] = B[0]; B[0] = null; }
        B[0] = b; break;
      }
      case '2B': {
        if (B[2]) { score(); B[2] = null; }
        if (B[1]) { score(); B[1] = null; }
        if (B[0]) { if (rng() < 0.4) score(); else B[2] = B[0]; B[0] = null; }
        B[1] = b; break;
      }
      case '3B': {
        B.forEach(x => { if (x) score(); });
        B[0] = B[1] = null; B[2] = b; break;
      }
      case 'HR': {
        B.forEach(x => { if (x) score(); });
        score();
        B[0] = B[1] = B[2] = null; break;
      }
      case 'GO': {
        if (B[0] && s.outs < 2 && rng() < 0.45) {
          ev.play = 'DP';
          s.outs += 2; B[0] = null;
          if (s.outs < 3) { if (B[2]) { score(); B[2] = null; } if (B[1]) { B[2] = B[1]; B[1] = null; } }
        } else {
          s.outs += 1;
          if (s.outs < 3) {
            if (B[2] && rng() < 0.4) { score(); B[2] = null; }
            if (B[1] && !B[2] && rng() < 0.5) { B[2] = B[1]; B[1] = null; }
            if (B[0]) { if (!B[1]) { B[1] = B[0]; } B[0] = null; }
          }
        }
        break;
      }
      case 'FO': {
        s.outs += 1;
        if (s.outs < 3) {
          if (B[2] && rng() < 0.55) { score(); B[2] = null; ev.play = 'SF'; }
          if (B[1] && !B[2] && rng() < 0.3) { B[2] = B[1]; B[1] = null; }
        }
        break;
      }
      case 'PO': case 'LO': case 'K': s.outs += 1; break;
    }
    return runs;
  }

  function endPA(s, ev, result, kType) {
    const b = batter(s);
    ev.paEnd = result; ev.kType = kType;
    b.line.pa += 1; s.stats.bf += 1;
    if (result === 'K') { s.stats.k += 1; b.line.k += 1; s.stats.outs += 1; }
    if (result === 'BB') { s.stats.bb += 1; b.line.bb += 1; }
    if (result === 'HBP') { s.stats.hbp += 1; }
    if (['1B', '2B', '3B', 'HR'].includes(result)) { s.stats.h += 1; b.line.h += 1; }
    if (result === 'HR') { s.stats.hr += 1; b.line.hr += 1; }
    const outsBefore = s.outs;
    const runs = advance(s, ev, result);
    if (result !== 'K') s.stats.outs += (s.outs - outsBefore);
    ev.runs = runs;
    s.runs += runs;
    s.inningRuns[s.inningRuns.length - 1] += runs;
    ev.basesAfter = s.bases.map(x => !!x);
    ev.outsAfter = s.outs;

    const m = s.mode;
    if (m.lead && s.runs >= m.lead) { s.over = true; s.result = s.runs > m.lead ? 'lost' : 'blown'; }
    if (s.outs >= 3) {
      ev.inningOver = true;
      const lastInning = m.startInning + m.innings - 1;
      if (!s.over && s.inning >= lastInning) { s.over = true; s.result = m.lead ? 'save' : 'cg'; }
      else if (!s.over) {
        s.inning += 1; s.outs = 0; s.bases = [null, null, null]; s.inningRuns.push(0);
      }
    }
    if (!s.over && m.hookRuns && s.runs >= m.hookRuns) { s.over = true; s.result = 'hooked'; ev.hook = 'runs'; }
    if (!s.over && m.hookPitches && s.pitchCount >= m.hookPitches) { s.over = true; s.result = 'hooked'; ev.hook = 'pitches'; }
    ev.gameOver = s.over;

    s.idx = (s.idx + 1) % 9;
    if (!s.over) startPA(s);
  }

  function filmStudy(s) {
    if (s.film <= 0 || s.over) return null;
    const b = batter(s);
    const unknown = [];
    b.known.forEach((k, i) => { if (!k) unknown.push(i); });
    let out;
    if (unknown.length) {
      // film shows the spots that matter first: anything hot or cold
      const notable = unknown.filter(i => b.heat[i] !== 0);
      const i = pick(s.rng, notable.length ? notable : unknown);
      revealCell(b, i);
      out = { cell: i };
    } else {
      const f = s.pitcher.pitches.map(p => p.fam).find(f => b.vs[f] !== 0 && !b.pitchKnown[f]);
      if (!f) return { nothing: true };
      out = { note: revealPitch(s, b, f) };
    }
    s.film -= 1;
    return out;
  }

  function ipString(outs) { return Math.floor(outs / 3) + (outs % 3 ? '.' + (outs % 3) : ''); }

  function gameScore(s) {
    // Bill James game score (original)
    const outs = s.stats.outs;
    const fullInnAfter4 = Math.max(0, Math.floor(outs / 3) - 4);
    return 50 + outs + 2 * fullInnAfter4 + s.stats.k - 2 * s.stats.h - 4 * s.runs - s.stats.bb - s.stats.hbp;
  }

  const api = {
    PITCHERS, MODES, YANKEES, newGame, throwPitch, filmStudy, batter, fatigue, inZone, inGrid, zIdx, relIn,
    locText, isZoneCorner, ipString, gameScore, locEdge, mulberry32, missChance,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PTC = api;
})(typeof window !== 'undefined' ? window : globalThis);
