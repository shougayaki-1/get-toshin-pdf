import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpreadPlan } from '../src/layout.js';
import { isPrintPage, isPdfDownloadUrl, isJapaneseSubject, isPdfBytes, safeName } from '../src/common.js';

const sizes = Array.from({ length: 3 }, () => ({ width: 595, height: 842 }));

test('RTL places page 1 on the right and page 2 on the left', () => {
  const plan = createSpreadPlan(sizes, 'rtl');
  assert.equal(plan.spreads.length, 2);
  assert.equal(plan.spreads[0].right.pageIndex, 0);
  assert.equal(plan.spreads[0].left.pageIndex, 1);
  assert.equal(plan.spreads[1].left, null);
  assert.equal(plan.spreads[1].right.pageIndex, 2);
});

test('LTR places page 1 on the left and page 2 on the right', () => {
  const plan = createSpreadPlan(sizes, 'ltr');
  assert.equal(plan.spreads[0].left.pageIndex, 0);
  assert.equal(plan.spreads[0].right.pageIndex, 1);
  assert.equal(plan.spreads[1].left.pageIndex, 2);
  assert.equal(plan.spreads[1].right, null);
});

test('recognizes observed POS print/download endpoint patterns', () => {
  assert.equal(isPrintPage('https://pos.toshin.com/TGT/OPCTTS/OPCTTS_Student/MondaiKaitoInsatsu?EnshuSetId=X&DaimonId=Y'), true);
  assert.equal(isPdfDownloadUrl('https://pos.toshin.com/TGT/OPCTTS/OPCTTS_Student/Contents/GetMondaiPdf?daimonId=opaque'), true);
  assert.equal(isPdfDownloadUrl('https://evil.example/Contents/GetMondaiPdf?daimonId=opaque'), false);
  assert.equal(isPdfDownloadUrl('https://pos.toshin.com/TGT/OPCTTS/OPCTTS_Student/Contents/GetMondaiPdf'), false);
});

test('chooses national-language reading direction', () => {
  assert.equal(isJapaneseSubject('国語'), true);
  assert.equal(isJapaneseSubject('数学IA'), false);
});

test('checks PDF signature and sanitizes filenames', () => {
  assert.equal(isPdfBytes(Buffer.from('%PDF-1.7\nhello')), true);
  assert.equal(isPdfBytes(Buffer.from('<html>login</html>')), false);
  assert.equal(safeName('2025/国語:第1回'), '2025_国語_第1回');
});
