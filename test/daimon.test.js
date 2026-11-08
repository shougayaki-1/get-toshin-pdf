import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { collectOne, listQuestions, questionFilename, validSinglePrint } from '../src/daimon.js';

const base = 'https://pos.toshin.com/TGT/OPCTTS/OPCTTS_Student/';
test('question names preserve visible title and sanitize unsafe characters', () => {
  assert.equal(questionFilename('1', '大問別演習　国語　現代文・評論　1812'), '01-大問別演習　国語　現代文・評論　1812.pdf');
  assert.equal(questionFilename('12', '英語/A:B'), '12-英語_A_B.pdf');
  assert.equal(validSinglePrint(`${base}MondaiKaitoInsatsu?EnshuSetId=set&DaimonId=one`, 'set', 'one'), true);
  assert.equal(validSinglePrint(`${base}MondaiKaitoInsatsu?EnshuSetId=set&DaimonId=one,two`, 'set', 'one'), false);
});

test('collects each selected question separately and resumes without fetching', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'daimon-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const browser = await chromium.launch({headless:true});
  t.after(() => browser.close());
  const context = await browser.newContext();
  const source = await PDFDocument.create(); source.addPage([300, 400]).drawText('example');
  const pdf = Buffer.from(await source.save());
  let requests = 0;
  const request = { get: async () => { requests++; return {ok:()=>true, body:async()=>pdf}; } };
  await context.route('https://pos.toshin.com/**', async route => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('MondaiKaitoInsatsu')) {
      await route.fulfill({contentType:'text/html; charset=utf-8',body:'<a href="Contents/GetMondaiPdf?daimonId=opaque">PDF</a>'});
    } else {
      await route.fulfill({contentType:'text/html; charset=utf-8',body:`<html><body>
        <ul>${['one','two'].map((id,i)=>`<li class="questions-item"><h4><span class="flag"><small>${i+1}</small></span><span class="questions-item-title">問題${i+1}</span></h4><label class="checkbox"><input class="chkDaimon" type="checkbox" value="${id}" checked></label></li>`).join('')}</ul>
        <button onclick="window.open('MondaiKaitoInsatsu?EnshuSetId=set&DaimonId='+document.querySelector('.chkDaimon:checked').value)">問題・解答用紙 印刷</button></body></html>`});
    }
  });
  const page = await context.newPage(); await page.goto(`${base}EnshuKaishi`);
  const items = (await listQuestions(page.mainFrame())).map(q=>({...q,category:'分野'}));
  const state = {version:1,items:[]};
  for (const item of items) assert.equal(await collectOne({page,frame:page.mainFrame(),item,setId:'set',subject:'国語',dir,state,request}),'saved');
  assert.equal(state.items.length,2);
  assert.notEqual(state.items[0].path,state.items[1].path);
  for (const entry of state.items) assert.equal((await PDFDocument.load(await readFile(path.join(dir,entry.path)))).getPageCount(),1);
  assert.equal(await collectOne({page,frame:page.mainFrame(),item:items[0],setId:'set',subject:'国語',dir,state,request}),'skipped');
  assert.equal(requests,2);
  const missing = path.join(dir, state.items[0].path);
  await rm(missing);
  const unavailable = { get: async () => ({ok:()=>false,status:()=>429}) };
  await assert.rejects(collectOne({page,frame:page.mainFrame(),item:items[0],setId:'set',subject:'国語',dir,state,request:unavailable}), /HTTP 429/);
  assert.equal(state.items.length, 2);
  const invalid = { get: async () => ({ok:()=>true,body:async()=>Buffer.from('<html>login</html>')}) };
  await assert.rejects(collectOne({page,frame:page.mainFrame(),item:items[0],setId:'set',subject:'国語',dir,state,request:invalid}), /PDFではありません/);
  assert.equal(await collectOne({page,frame:page.mainFrame(),item:items[0],setId:'set',subject:'国語',dir,state,request}),'saved');
  assert.equal(requests,3);
  assert.equal(await collectOne({page,frame:page.mainFrame(),item:items[0],setId:'set',subject:'国語',dir,state,request,force:true}),'saved');
  assert.equal(requests,4);
});

test('listQuestions picks highest-rate cells rather than the 80% passing average',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();
  const scores=['34%','76%','86%','-%'];
  await page.setContent('<ul>'+scores.map((score,i)=>`<li class="questions-item"><h4><span class="flag"><small>${i+1}</small></span><span class="questions-item-title">問題${i+1}</span></h4><label class="checkbox"><input class="chkDaimon" value="${i+1}" type="checkbox"></label><div>${score}<br>最高得点率</div><div>80%<br>合格者平均</div></li>`).join('')+'</ul>');
  assert.deepEqual((await listQuestions(page.mainFrame())).map(x=>x.scoreRate),[34,76,86,null]);
});
