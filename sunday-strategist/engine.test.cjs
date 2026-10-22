// Sunday Strategist engine and content checks. Run: node --test sunday-strategist/engine.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('./scenarios.js'), S = require('./schema.js'), E = require('./engine.js'), R = require('./real-plays.js'), G = require('./gen.js');
const clone = x => JSON.parse(JSON.stringify(x));
const [fire, bluff] = D.scenarios;
const best = sc => ({ ...sc.recommended, key: sc.plays.find(p => p.id === sc.recommended.play).key.answer });
const read = { personnel: 'nickel', shell: 'two', rushers: ['DEB', 'DT', 'NT', 'DEF', 'WILL', 'MIKE', 'NB'], pressure: 'five', confidence: 'strong' };

test('every bundled scenario passes the schema', () => {
  assert.deepEqual(S.validate(D), []);
});

test('the schema catches broken content', () => {
  const d = clone(D);
  d.scenarios[0].plays[0].key.answer = 'NOBODY';
  d.scenarios[0].actual.rushers.push('MIKE'); // MIKE also drops
  d.scenarios[1].provenance.type = 'verified';
  d.scenarios[1].type = 'verified'; // a "real" play with no source or game
  d.scenarios[0].contingencies[0].grades = {};
  const errs = S.validate(d).join('\n');
  assert.match(errs, /plays\[0\]\.key\.answer/);
  assert.match(errs, /can't both rush and drop/);
  assert.match(errs, /needs at least one source/);
  assert.match(errs, /historical\.gameId/);
  assert.match(errs, /no grade for play stick/);
});

test('a seed makes a rep repeatable', () => {
  for (const sc of D.scenarios) assert.deepEqual(E.resolve(sc, best(sc), 42), E.resolve(sc, best(sc), 42));
});

test('the recommended call converts more often than any other call', () => {
  for (const sc of D.scenarios) {
    const rec = E.expected(sc, best(sc));
    for (const p of sc.plays.filter(p => p.id !== sc.recommended.play)) {
      const alt = E.expected(sc, { ...best(sc), play: p.id, key: p.key.answer });
      assert.ok(rec.convert > alt.convert, `${sc.id}: ${p.id} ${alt.convert} vs ${rec.convert}`);
    }
  }
});

test('the hot slant throws into the replacement defender', () => {
  const x = E.expected(fire, { ...best(fire), play: 'slant', key: 'NB' });
  assert.ok(x.turnover > 0.12, `interceptions ${x.turnover}`);
});

test('a free rusher with no answer gets home; a built-in hot answer saves the play', () => {
  const pick = { ...best(fire), protection: 'five', motion: 'none' };
  const none = E.expected(fire, { ...pick, contingency: 'none' });
  const hot = E.expected(fire, { ...pick, contingency: 'built-in' });
  assert.ok(none.sack > 0.6, `sacks ${none.sack}`);
  assert.equal(hot.sack, 0);
  assert.ok(hot.convert > none.convert + 0.15);
  // Verticals has no quick route, so "hot" can't save it.
  assert.ok(E.expected(fire, { ...pick, play: 'verts', key: 'FS', contingency: 'built-in' }).sack > 0.6);
});

test('interactions: shifting the back fixes the slide-away protection', () => {
  const base = { ...best(fire), protection: 'slide-away', motion: 'none' };
  assert.ok(E.resolve(fire, base, 1).beat);
  assert.ok(!E.resolve(fire, { ...base, motion: 'rbshift' }, 1).beat);
  const g = E.review(fire, { ...base, motion: 'rbshift' }, read, 1).grades.protection;
  assert.ok(g > E.review(fire, base, read, 1).grades.protection);
});

test('process is graded apart from the result', () => {
  // The same good decision gets the same process grade on every rep, good or bad.
  const reps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(seed => E.review(fire, best(fire), read, seed));
  assert.equal(new Set(reps.map(r => r.process)).size, 1);
  assert.ok(reps.some(r => r.grades.result >= 95) && reps.some(r => r.grades.result < 75), 'results vary');
  assert.ok(reps.some(r => r.verdict.title === 'Good call, bad result'));
  // A bad call that happens to work is still called a bad call.
  const lucky = Array.from({ length: 200 }, (_, i) => E.review(fire, { ...best(fire), play: 'slant', key: 'NB', contingency: 'none', protection: 'max' }, read, i + 1))
    .find(r => r.grades.result >= 95);
  assert.ok(lucky, 'the slant sometimes works');
  assert.equal(lucky.verdict.title, 'Bad call, good result');
});

test('diagnosis: credit for reading the evidence, even when the defense lies', () => {
  const d = E.scoreDiagnosis(bluff, read);
  assert.equal(bluff.actual.pressure, 'four');
  assert.equal(d.score, 100, 'five-man was the right read of the same picture');
  const miss = E.scoreDiagnosis(fire, { ...read, rushers: read.rushers.filter(x => x !== 'NB'), confidence: 'certain', shell: 'zero' });
  assert.ok(miss.items.find(i => i.id === 'rushers').credit <= 50, 'forgetting the nickel is capped');
  assert.ok(miss.errors.includes('pressure-count') && miss.errors.includes('shell'));
  const over = E.scoreDiagnosis(fire, { personnel: 'base', shell: 'zero', rushers: ['CBB'], pressure: 'six', confidence: 'certain' });
  assert.equal(over.calibration.kind, 'overconfident');
  assert.ok(over.errors.includes('overconfidence'));
});

test('the review explains every grade from structured facts', () => {
  const rv = E.review(fire, best(fire), read, 3);
  assert.deepEqual(Object.keys(rv.grades), ['diagnosis', 'call', 'protection', 'contingency', 'execution', 'result']);
  for (const g of Object.values(rv.grades)) assert.ok(g >= 0 && g <= 100);
  assert.ok(rv.rep.cards.length >= 4 && rv.rep.cards.every(c => c.assignment && c.keyRole));
  assert.ok(rv.rep.timeline.length >= 5 && rv.rep.decisive);
  assert.deepEqual(rv.alternatives.map(a => a.category), ['recommended', 'aggressive', 'conservative', 'poor']);
  assert.equal(rv.key.score, 100);
});

test('mastery: unseen scenarios first, then the weakest skill', () => {
  const two = { scenarios: [fire, bluff] };
  let rec = E.emptyRecord();
  assert.equal(E.next(two, rec, 0, null), fire.id);
  rec = E.record(rec, fire, E.review(fire, best(fire), read, 1), 0);
  assert.equal(E.next(two, rec, 0, fire.id), bluff.id);
  rec = E.record(rec, bluff, E.review(bluff, { ...best(bluff), play: 'slant', key: 'NB' }, read, 1), 0);
  assert.equal(E.next(two, rec, 86400000, null), bluff.id, 'the weaker scenario comes back');
  const rep = E.report(rec, D);
  assert.ok(rep.tags.find(t => t.id === 'pressure-disguise').level < rep.tags.find(t => t.id === 'replacement-defender').level);
  assert.ok(rep.errors.some(e => e.id === 'replacement-defender'));
});

test('real snaps: each one validates, matches its lesson, and names its sources', () => {
  const all = E.catalog(D, R);
  assert.ok(R.plays.length >= 24);
  assert.deepEqual(S.validate({ ...D, scenarios: all }), []);
  const cov = { 'Cover 3': 'COVER_3', 'Cover 2': 'COVER_2', 'Cover 1': 'COVER_1', 'Cover 0': 'COVER_0' };
  for (const s of all.filter(s => s.real && s.lesson)) {
    const r = s.real, fit = D.scenarios.find(t => t.id === s.lesson).fit;
    assert.ok(fit.downs.includes(r.down) && r.dist >= fit.distance[0] && r.dist <= fit.distance[1], s.id + ' down and distance');
    assert.ok(fit.coverage.includes(cov[r.coverage]) && r.rushers >= fit.rushers[0] && r.rushers <= fit.rushers[1] && (r.blitzers > 0) === fit.blitz, s.id + ' defense');
    assert.equal(s.type, 'adapted');
    assert.ok(s.provenance.sources.length === 3 && s.provenance.fieldConfidence.alignment === 'inferred');
    assert.ok(R.teams[r.off] && R.teams[r.def] && r.passer && r.desc);
    assert.equal(s.context.distance, r.dist);
  }
  // Every lesson has real snaps, and the Patriots show up.
  for (const t of D.scenarios) assert.ok(all.some(s => s.lesson === t.id), t.id);
  assert.ok(R.plays.some(r => r.off === 'NE' || r.def === 'NE'));
});

test('real snaps resolve with their own down and distance', () => {
  const all = E.catalog(D, R);
  for (const s of all.filter(s => s.real)) {
    const rv = E.review(s, best(s), { ...read, rushers: [] }, 9);
    assert.equal(rv.rep.firstDown, rv.rep.yards >= s.context.distance && rv.rep.kind !== 'sack' && !rv.rep.touchdown);
  }
});

test('film room: hundreds of real snaps across situations, personnel and packages', () => {
  const film = E.catalog(D, R).filter(s => s.module === 'film-room');
  assert.ok(film.length >= 350, `${film.length} film snaps`);
  const by = f => film.reduce((m, s) => (m[f(s.real)] = (m[f(s.real)] || 0) + 1, m), {});
  for (const k of Object.keys(R.situations)) assert.ok(by(r => r.situation)[k] >= 20, k);
  assert.ok(Object.keys(by(r => r.offPers)).length >= 6, 'personnel groups');
  for (const k of ['base', 'nickel', 'dime']) assert.ok(by(r => r.pkg)[k] >= 30, k);
  assert.ok(by(r => r.kind).run >= 120 && by(r => r.kind).pass >= 120, 'runs and passes');
  for (const s of film) {
    assert.equal(s.offense.players.length, 11); assert.equal(s.defense.players.length, 11);
    const top = Math.max(...s.plays.map(p => p.grade));
    assert.equal(s.plays.find(p => p.id === s.recommended.play).grade, top, s.id);
    assert.ok(s.plays.some(p => p.kind === 'run') && s.plays.some(p => p.kind !== 'run'), s.id + ' offers both run and pass');
    assert.ok(s.provenance.fieldConfidence.alignment === 'inferred' && s.historical.gameId === s.real.gameId);
  }
});

test('film room grades: count the box', () => {
  const D1 = { down: 1, dist: 10, yl100: 65, offPers: '11', ol: 5, fb: 0, kind: 'run' };
  const best = (box, shell) => ['inside-zone', 'outside-zone', 'pa-shot', 'quick', 'smash'].map(c => [c, G.processOdds(c, { ...D1, box }, shell, D, box)]).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(best(5, 'one'), 'inside-zone', 'light box: run it');
  assert.notEqual(best(8, 'one'), 'inside-zone', 'eight in the box: throw it');
  assert.equal(best(7, 'two'), 'smash', 'two-high with seven in the box: smash');
  // Short yardage: the sneak for a yard, not for five.
  const sneak = d => G.processOdds('sneak', { ...D1, down: 3, dist: d, box: 8 }, 'one', D, 8);
  assert.ok(sneak(1) > 0.5 && sneak(5) < 0.1);
});
