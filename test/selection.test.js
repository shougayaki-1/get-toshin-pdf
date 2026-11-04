import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSelection } from '../src/selection.js';
test('selects arbitrary numbers, ranges, all, and rejects invalid ranges', () => {
  assert.deepEqual(parseSelection('1,3-8 3',10),[0,2,3,4,5,6,7]);
  assert.equal(parseSelection('a',70).length,70);
  for(const value of ['', '0', '9-3', '1,11', '1x']) assert.throws(()=>parseSelection(value,10));
});
