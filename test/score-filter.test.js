import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHighestScoreRate,isReviewTarget} from '../src/score-filter.js';

test('reads the highest rate, not the passing average, with either DOM text order',()=>{
  assert.equal(parseHighestScoreRate('86%\n最高得点率\n80%\n合格者平均'),86);
  assert.equal(parseHighestScoreRate('最高得点率\n76%\n合格者平均\n80%'),76);
  assert.equal(parseHighestScoreRate('34％ 最高得点率 80％ 合格者平均'),34);
  assert.equal(parseHighestScoreRate('60%\n最高得点率\n80%\n合格者平均'),60);
  assert.equal(parseHighestScoreRate('-%\n最高得点率\n80%\n合格者平均'),null);
  assert.equal(parseHighestScoreRate('最高得点率 -% 合格者平均 80%'),null);
  assert.equal(parseHighestScoreRate('合格者平均 80%'),null);
  assert.equal(parseHighestScoreRate('120% 最高得点率'),null);
});

test('only red and yellow (under 80%) are review targets',()=>{
  for(const rate of [0,34,60,70,76,79])assert.equal(isReviewTarget({scoreRate:rate}),true);
  for(const rate of [80,86,100,null,undefined])assert.equal(isReviewTarget({scoreRate:rate}),false);
});
