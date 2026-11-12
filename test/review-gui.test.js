import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { createGuiServer } from '../src/gui-server.js';

test('GUI reviews only red/yellow questions and re-downloads deleted or forced PDFs',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'review-gui-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const browser=await chromium.launch({headless:true});
  t.after(()=>browser.close());
  const context=await browser.newContext();
  const pdf=await PDFDocument.create();pdf.addPage([300,400]).drawText('test');
  const bytes=Buffer.from(await pdf.save());
  let requests=0;
  const request={get:async()=>{requests++;return {ok:()=>true,body:async()=>bytes};}};
  const base='/TGT/OPCTTS/OPCTTS_Student/';
  const scores=['34%','76%','86%','-%'];
  const rows=scores.map((score,i)=>`<li class="questions-item"><h4><span class="flag"><small>${i+1}</small></span><span class="questions-item-title">問題 ${i+1}</span></h4><label class="checkbox"><input class="chkDaimon" type="checkbox" value="q${i+1}"></label><div>${score}<br>最高得点率</div><div>80%<br>合格者平均</div></li>`).join('');
  await context.route('https://pos.toshin.com/**',async route=>{
    const u=new URL(route.request().url());let body;
    if(u.pathname.endsWith('PosApplication.aspx'))body=`<iframe src="${base}EnshuKaishi"></iframe>`;
    else if(u.pathname.endsWith('MondaiKaitoInsatsu'))body='<a href="Contents/GetMondaiPdf?daimonId=opaque">PDF</a>';
    else body=`<a href="DaimonBunyabetsuTop?enshuSetId=set">戻る</a><h3>国 大問別演習　国語　現代文</h3><ul>${rows}</ul><button onclick="window.open('MondaiKaitoInsatsu?EnshuSetId=set&DaimonId='+document.querySelector('.chkDaimon:checked').value)">問題・解答用紙 印刷</button>`;
    await route.fulfill({contentType:'text/html; charset=utf-8',body});
  });
  const pos=await context.newPage();
  await pos.goto('https://pos.toshin.com/SSO1/SSOMenu/PosApplication.aspx');
  const {server,url}=await createGuiServer({context,dir,request});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const gui=await context.newPage();await gui.goto(url);
  await gui.locator('#exercise-type').selectOption('daimon');await gui.locator('#exercise-scope').selectOption('current');await gui.getByRole('button',{name:'候補を読み込む'}).click();
  await gui.getByText('4件の候補を読み込みました。').waitFor();
  await gui.locator('#review-only').check();
  assert.equal(await gui.locator('#items .item').count(),2);
  await gui.locator('#all').check();
  await gui.getByRole('button',{name:'選択した問題を取得'}).click();
  await gui.getByText('取得が完了しました。').waitFor({timeout:20000});
  await gui.getByText(/保存 2件/).waitFor();
  assert.equal(requests,2);

  const history=JSON.parse(await readFile(path.join(dir,'daimon-manifest.json'),'utf8'));
  await rm(path.join(dir,history.items[0].path));
  await gui.getByRole('button',{name:'選択した問題を取得'}).click();
  await gui.getByText('取得が完了しました。').waitFor({timeout:20000});
  await gui.getByText(/保存 1件　スキップ 1件/).waitFor();
  assert.equal(requests,3);

  await gui.locator('#force-download').check();
  await gui.getByRole('button',{name:'選択した問題を取得'}).click();
  await gui.getByText('取得が完了しました。').waitFor({timeout:20000});
  await gui.getByText(/保存 2件/).waitFor();
  assert.equal(requests,5);
});
