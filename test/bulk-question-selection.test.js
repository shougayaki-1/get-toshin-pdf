import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGuiServer } from '../src/gui-server.js';

test('selects unpracticed questions across categories and filters scores before downloading',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'question-select-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const browser=await chromium.launch();t.after(()=>browser.close());const context=await browser.newContext();
  const pdf=await PDFDocument.create();pdf.addPage([300,400]).drawText('test');const bytes=Buffer.from(await pdf.save());
  let requests=0;const request={get:async()=>{requests++;return {ok:()=>true,body:async()=>bytes};}};
  const base='/TGT/OPCTTS/OPCTTS_Student/';
  await context.route('https://pos.toshin.com/**',async route=>{
    const u=new URL(route.request().url());let body;
    if(u.pathname.endsWith('PosApplication.aspx')) body=`<iframe src="${base}DaimonBunyabetsuTop"></iframe>`;
    else if(u.pathname.endsWith('EnshuKaishi')) {
      const set=new URLSearchParams(route.request().postData()||'').get('enshuSetId');
      const rows=[['-', '-'],['1','75'],['1','85'],['不明','-']].map(([count,score],i)=>`<li class="questions-item"><h4><span class="flag"><small>${i+1}</small></span><span class="questions-item-title">${set} 問題${i+1}</span></h4><label class="checkbox"><input class="chkDaimon" type="checkbox" value="${set}q${i+1}"></label><dl><dt>演習回数</dt><dd>${count}</dd></dl><dl><dt>最高得点率</dt><dd>${score}%</dd></dl></li>`).join('');
      body=`<a href="DaimonBunyabetsuTop?enshuSetId=${set}">戻る</a><h3>国 国語 分野</h3><ul>${rows}</ul><button onclick="window.open('MondaiKaitoInsatsu?EnshuSetId=${set}&DaimonId='+document.querySelector('.chkDaimon:checked').value)">問題・解答用紙 印刷</button>`;
    } else if(u.pathname.endsWith('MondaiKaitoInsatsu'))body='<a href="Contents/GetMondaiPdf?daimonId=opaque">PDF</a>';
    else body=`<label class="criteria-label"><input type="radio" name="科目" value="jp" checked><span>国語</span></label>${['a','b'].map(id=>`<div class="card-front"><span class="card-title-module2">大問別演習 国語 分野${id}</span><form method="post" action="${base}EnshuKaishi"><input name="enshuSetId" value="${id}"><button type="submit">演習</button></form></div>`).join('')}`;
    await route.fulfill({contentType:'text/html; charset=utf-8',body});
  });
  const pos=await context.newPage();await pos.goto('https://pos.toshin.com/SSO1/SSOMenu/PosApplication.aspx');
  const {server,url}=await createGuiServer({context,dir,request});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const gui=await context.newPage();await gui.goto(url);
  await gui.locator('#exercise-type').selectOption('daimon');await gui.locator('#exercise-scope').selectOption('all');await gui.getByRole('button',{name:'候補を読み込む'}).click();await gui.getByText('2件の候補を読み込みました。').waitFor();
  await gui.locator('#all').check();await gui.getByRole('button',{name:'選択した分野の問題を選ぶ'}).click();
  await gui.getByText('2分野、8問を読み込みました。').waitFor({timeout:15000});
  await gui.getByRole('button',{name:'表示中の未演習をすべて選択'}).click();
  assert.equal(await gui.locator('#items input:checked').count(),2);
  await gui.locator('#all').check();await gui.locator('#max-score').fill('80');
  await gui.getByRole('button',{name:'選択した問題を取得'}).click();
  await gui.getByText('取得が完了しました。').waitFor({timeout:30000});
  assert.equal(requests,4);
  const manifest=JSON.parse(await readFile(path.join(dir,'daimon-manifest.json'),'utf8'));
  assert.deepEqual(manifest.items.map(x=>x.title).sort(),['a 問題1','a 問題2','b 問題1','b 問題2']);
  await gui.locator('#exercise-type').selectOption('daimon');await gui.locator('#exercise-scope').selectOption('all');await gui.getByRole('button',{name:'候補を読み込む'}).click();
  await gui.getByText('2件の候補を読み込みました。').waitFor();
  await gui.locator('#all').check();await gui.locator('#include-unpracticed').uncheck();
  await gui.getByRole('button',{name:'選択した問題を取得'}).click();
  await gui.getByText('取得が完了しました。').waitFor({timeout:20000});
  await gui.getByText(/スキップ 2件/).waitFor();assert.equal(requests,4);
});
