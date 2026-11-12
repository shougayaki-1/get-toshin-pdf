import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGuiServer } from '../src/gui-server.js';

test('discovers both required types and downloads selected categories', async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'required-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const browser=await chromium.launch();t.after(()=>browser.close());const context=await browser.newContext();
  const pdf=await PDFDocument.create();pdf.addPage([300,400]).drawText('test');const bytes=Buffer.from(await pdf.save());
  let requests=0;const request={get:async()=>{requests++;return {ok:()=>true,body:async()=>bytes};}};
  const base='/TGT/OPCTTS/OPCTTS_Student/';
  await context.route('https://pos.toshin.com/**',async route=>{
    const u=new URL(route.request().url());let body;
    if(u.pathname.endsWith('PosApplication.aspx')) body=`<iframe src="${base}CorrectAnswerRequiredFukushuTop"></iframe>`;
    else if(u.pathname.endsWith('EnshuKaishi')) {
      const set=new URLSearchParams(route.request().postData()||'').get('enshuSetId');
      body=`<a href="CorrectAnswerRequiredFukushuTop?enshuSetId=${set}">戻る</a><h3>理 化学基礎 知識</h3><li class="questions-item"><h4><span class="flag"><small>1</small></span><span class="questions-item-title">${set} 問題</span></h4><label class="checkbox"><input class="chkDaimon" type="checkbox" value="${set}q"></label></li><button onclick="window.open('MondaiKaitoInsatsu?EnshuSetId=${set}&DaimonId='+document.querySelector('.chkDaimon:checked').value)">問題・解答用紙 印刷</button>`;
    } else if(u.pathname.endsWith('MondaiKaitoInsatsu')) body='<a href="Contents/GetMondaiPdf?daimonId=opaque">PDF</a>';
    else body=`${['7','6'].map((id,i)=>`<label class="criteria-label"><input type="radio" name="mondaiType" value="${id}" ${i===0?'checked':''}><span>${i===0?'模試':'過去問'}正解必須問題</span></label>`).join('')}${['7','6'].map((id,i)=>`<div class="card-front" data-id="${id}" ${i?'hidden':''}><span class="card-title-module2">化学基礎 知識${id}</span><form method="post" action="${base}EnshuKaishi"><input name="enshuSetId" value="${id}"><button type="submit">演習</button></form></div>`).join('')}<script>document.querySelectorAll('input[name=mondaiType]').forEach(r=>r.addEventListener('change',()=>document.querySelectorAll('.card-front').forEach(c=>c.hidden=c.dataset.id!==r.value)))</script>`;
    await route.fulfill({contentType:'text/html; charset=utf-8',body});
  });
  const pos=await context.newPage();await pos.goto('https://pos.toshin.com/SSO1/SSOMenu/PosApplication.aspx');
  const {server,url}=await createGuiServer({context,dir,request});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const gui=await context.newPage();await gui.goto(url);
  await gui.getByRole('button',{name:'正解必須問題の全分野を読み込む'}).click();
  await gui.getByText('2件の候補を読み込みました。').waitFor({timeout:10000});
  assert.match(await gui.locator('#items').innerText(),/模試正解必須問題/);
  assert.match(await gui.locator('#items').innerText(),/過去問正解必須問題/);
  await gui.locator('#all').check();await gui.getByRole('button',{name:'選択した問題を取得'}).click();
  await gui.getByText('取得が完了しました。').waitFor({timeout:20000});
  assert.equal(requests,2);
  const manifest=JSON.parse(await readFile(path.join(dir,'daimon-manifest.json'),'utf8'));
  assert.equal(manifest.items.length,2);
  assert.ok(manifest.items.some(x=>x.category.includes('過去問正解必須問題')));
  await gui.getByRole('button',{name:'今回取得したPDFを選択'}).click();
  await gui.getByText('今回取得した2件を選択しました。').waitFor();
  assert.equal(await gui.locator('#saved-files input:checked').count(),2);
});
