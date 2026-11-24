// The CBB Hub's injury point values: a player's production minus the bench that takes his minutes (cbb/model.js teamLoss)
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const M = createRequire(import.meta.url)('../cbb/model.js');
const pl = (id, pos, gp, min, pts, reb, ast, fga, fgm) => ({ id, pos, stats: { gp, min, pts, reb, ast, stl: 1, blk: 0.3, tov: 2, pf: 2, fga, fgm, fta: 4, ftm: 3 } });
const star = pl(1, 'G', 6, 36, 22, 5, 5, 15, 8);
const starters = [pl(2, 'G', 6, 32, 11, 3, 3, 9, 4), pl(3, 'F', 6, 30, 10, 7, 1, 8, 4), pl(4, 'F', 6, 28, 9, 6, 1, 7, 3), pl(5, 'C', 6, 26, 8, 8, 1, 6, 3)];
const weakBench = [pl(6, 'G', 6, 14, 3, 1, 1, 4, 1), pl(7, 'G', 6, 9, 1.5, 1, 1, 2, 0.5), pl(8, 'F', 6, 12, 3, 2, 0, 3, 1)];
const goodBench = [pl(6, 'G', 6, 14, 7, 2, 2, 5, 3), pl(7, 'G', 6, 9, 5, 1, 1, 3, 2), pl(8, 'F', 6, 12, 6, 3, 1, 4, 2)];

test('a thin bench behind him makes a missing star worth more', () => {
  const thin = M.pointValue(star, [star, ...starters, ...weakBench]), deep = M.pointValue(star, [star, ...starters, ...goodBench]);
  assert.ok(thin > deep + 0.3, thin + ' vs ' + deep);
  assert.ok(thin >= 2.5 && thin <= 8, 'a 36-minute, 22-point guard is worth a few points: ' + thin);
});
test('a few games are pulled toward what players with his minutes produce, not toward zero', () => {
  const few = { ...star, stats: { ...star.stats, gp: 2 } };
  const v = M.pointValue(few, [few, ...starters, ...weakBench]), full = M.pointValue(star, [star, ...starters, ...weakBench]);
  assert.ok(v > full * 0.6, 'two games still counts most of his value: ' + v + ' of ' + full);
});
test('two players out together cost more than each alone, and bench players are worth little', () => {
  const ros = [star, ...starters, ...weakBench];
  const a = M.pointValue(star, ros), b = M.pointValue(starters[0], ros), both = M.teamLoss(ros, [1, 2]).total;
  assert.ok(both > a + b, both + ' vs ' + (a + b));
  assert.ok(M.pointValue(weakBench[1], ros) < 0.3);
});
