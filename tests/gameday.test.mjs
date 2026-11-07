import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), B = require('../fantasy-kit/gameday.js');
test('game focus keeps today’s final ahead of tomorrow’s fixture; live games take precedence', () => {
  const gs = [{id:'next',at:'2026-11-07T23:00Z',state:'pre'}, {id:'final',at:'2026-11-06T18:00Z',state:'post'}];
  assert.equal(B.current(gs,Date.parse('2026-11-06T23:00Z')).id,'final');
  gs.push({id:'live',at:'2026-11-06T22:00Z',state:'in'});
  assert.equal(B.current(gs,Date.parse('2026-11-06T23:00Z')).id,'live');
});
test('daily sports never substitute weekly totals for game stats', () => {
  const p={id:'1',t:'BOS'}, g={id:'g',state:'post'}, live={players:{1:[80]},games:{BOS:[g]}};
  assert.equal(B.line('nba',p,g,live),null);
  assert.equal(B.line('mlb',p,g,live),null);
  assert.deepEqual(B.line('nfl',p,g,live),[80]);
  live.boxes={g:{1:[20]}}; assert.deepEqual(B.line('nba',p,g,live),[20]);
  assert.equal(B.line('nba',p,{...g,state:'pre'},live),null);
});
test('football shows real zeroes, missing values and position-specific stats', () => {
  const schema={cols:['rush_att','rush_yd','rush_td','rec','rec_tgt','rec_yd','rec_td']};
  const stats=B.stats('nfl',{pos:['RB']},[10,54,0,3,5,21,1],schema);
  assert.deepEqual(stats,[['Rush','10/54'],['Rush TD','0'],['Rec/TGT','3/5'],['Rec YD','21'],['Rec TD','1']]);
  assert.deepEqual(B.stats('nfl',{pos:['QB']},[0],{cols:['pass_yd']})[0],['Pass YD','0']);
  assert.deepEqual(B.stats('nfl',{pos:['QB']},[0],{cols:['pass_yd']})[1],['Pass TD','—']);
});
test('baseball innings use outs, not decimal fractions', () => {
  assert.deepEqual(B.stats('mlb',{pos:['SP']},{pit:[17]},{lines:{pit:['outs']}})[0],['IP','5.2']);
});
