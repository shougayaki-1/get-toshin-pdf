import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { collectYear, listYears, yearFilename } from '../src/year.js';

const base='https://pos.toshin.com/TGT/OPCTTS/OPCTTS_Student/';
test('lists year/subject pairs, downloads separately and resumes', async t => {
  const dir=await mkdtemp(path.join(tmpdir(),'year-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const browser=await chromium.launch({headless:true}); t.after(()=>browser.close());
  const context=await browser.newContext(); const page=await context.newPage();
  const source=await PDFDocument.create(); source.addPage([300,400]).drawText('test'); const pdf=Buffer.from(await source.save());
  let requests=0;
  const request={get:async()=>{requests++;return {ok:()=>true,body:async()=>pdf};}};
  await context.route('https://pos.toshin.com/**', async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('MondaiKaitoInsatsu')) return route.fulfill({contentType:'text/html; charset=utf-8',body:'<a href="Contents/GetMondaiPdf?daimonId=opaque">PDF</a>'});
    if(url.pathname.endsWith('EnshuKaishi')) {
      const id=new URLSearchParams(route.request().postData() || '').get('enshuSetId');
      return route.fulfill({contentType:'text/html; charset=utf-8',body:`<a href="NendobetsuTop?enshuSetId=${id}">戻る</a><button onclick="window.open('MondaiKaitoInsatsu?EnshuSetId=${id}&DaimonId=q1,q2')">問題・解答用紙 印刷</button>`});
    }
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`<table class="nendobetsu-ichiran"><tr class="kamoku-name-row"><th>科目</th><th class="kamoku-name">国語</th><th class="kamoku-name">数学</th></tr><tr><td class="kaisu-name">共通テスト2025本試験</td>${['jp','math'].map(id=>`<td class="enshu-info"><form method="post" action="EnshuKaishi"><input type="hidden" name="enshuSetId" value="${id}"><button class="enshu-btn">演習</button></form></td>`).join('')}</tr></table>`});
  });
  await page.goto(base+'NendobetsuTop'); const frame=page.mainFrame(); const items=await listYears(frame);
  assert.equal(items.length,2); assert.equal(yearFilename(items[0]),'2025_国語_本試_問題.pdf');
  const state={version:1,items:[]};
  for(const item of items) assert.equal(await collectYear({page,frame,item,dir,state,request}),'saved');
  assert.equal(state.items.length,2); assert.notEqual(state.items[0].path,state.items[1].path);
  assert.equal((await PDFDocument.load(await readFile(path.join(dir,state.items[0].path)))).getPageCount(),1);
  assert.equal(await collectYear({page,frame,item:items[0],dir,state,request}),'skipped'); assert.equal(requests,2);
});
