import test from 'node:test';
import assert from 'node:assert/strict';
import { inferSubject } from '../src/daimon.js';
import { createGuiServer } from '../src/gui-server.js';
import { chromium } from 'playwright';

test('derives the displayed subject and leaves uncertain titles unset', () => {
  assert.equal(inferSubject('大問別演習　国語　現代文・評論'),'国語');
  assert.equal(inferSubject('大問別演習　英語Reading　文学的文章'),'英語Reading');
  assert.equal(inferSubject('不明な分野'),null);
});
test('GUI API requires its token and same-origin writes', async t => {
  const {server,url}=await createGuiServer({context:{pages:()=>[]},dir:'/tmp/test'});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const u=new URL(url), origin=u.origin, token=u.hash.slice(1);
  assert.equal((await fetch(origin+'/api/status')).status,403);
  assert.equal((await fetch(origin+'/api/status',{headers:{'x-app-token':'z'.repeat(64)}})).status,403);
  assert.equal((await fetch(origin+'/api/status',{headers:{'x-app-token':token}})).status,200);
  assert.equal((await fetch(origin+'/api/discover',{method:'POST',headers:{'x-app-token':token,'content-type':'application/json',origin:'https://example.org'},body:'{"mode":"year"}'})).status,403);
  assert.equal((await fetch(origin+'/api/discover',{method:'POST',headers:{'x-app-token':token,'content-type':'application/json',origin},body:'{"mode":"daimon"}'})).status,202);
  const data=await (await fetch(origin+'/api/status',{headers:{'x-app-token':token}})).json();
  assert.equal(data.busy,false); assert.match(data.status,/ログイン/);
});

test('GUI loads and shows a useful login prompt when POS is unavailable', async t => {
  const {server,url}=await createGuiServer({context:{pages:()=>[]},dir:'/tmp/test'});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true}); t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1100,height:850}});
  await page.goto(url);
  await page.getByRole('button',{name:'年度別を読み込む'}).click();
  await page.getByRole('status').getByText(/ログイン/).waitFor();
  await page.reload();
  await page.getByRole('status').getByText(/ログイン/).waitFor();
});

test('GUI discovers category and downloads two questions without manual subject', async t => {
  const {mkdtemp,rm}=await import('node:fs/promises'); const {tmpdir}=await import('node:os'); const path=(await import('node:path')).default;
  const {PDFDocument}=await import('pdf-lib');
  const dir=await mkdtemp(path.join(tmpdir(),'gui-flow-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const context=await browser.newContext();
  const source=await PDFDocument.create();source.addPage([300,400]).drawText('question');const pdf=Buffer.from(await source.save());
  const request={get:async()=>({ok:()=>true,body:async()=>pdf})};
  await context.route('https://pos.toshin.com/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('PosApplication.aspx')) return route.fulfill({contentType:'text/html; charset=utf-8',body:'<iframe src="/TGT/OPCTTS/OPCTTS_Student/EnshuKaishi"></iframe>'});
    if(url.pathname.endsWith('MondaiKaitoInsatsu')) return route.fulfill({contentType:'text/html; charset=utf-8',body:'<a href="Contents/GetMondaiPdf?daimonId=opaque">PDF</a>'});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`<a href="DaimonBunyabetsuTop?enshuSetId=set">戻る</a><h3>国 大問別演習　国語　現代文</h3><ul>${['one','two'].map((id,i)=>`<li class="questions-item"><h4><span class="flag"><small>${i+1}</small></span><span class="questions-item-title">国語 問題${i+1}</span></h4><label class="checkbox"><input class="chkDaimon" type="checkbox" value="${id}"></label></li>`).join('')}</ul><button onclick="window.open('MondaiKaitoInsatsu?EnshuSetId=set&DaimonId='+document.querySelector('.chkDaimon:checked').value)">問題・解答用紙 印刷</button>`});
  });
  const pos=await context.newPage();await pos.goto('https://pos.toshin.com/SSO1/SSOMenu/PosApplication.aspx');
  const {server,url}=await createGuiServer({context,dir,request});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const gui=await context.newPage();await gui.goto(url);await gui.getByRole('button',{name:'大問別の問題を読み込む'}).click();
  await gui.getByText('2件の候補を読み込みました。').waitFor();
  await gui.locator('#range-start').fill('1');await gui.locator('#range-end').fill('2');await gui.locator('#range-select').click();
  assert.equal(await gui.locator('#items input:checked').count(),2);
  await gui.getByRole('button',{name:'選択した問題を取得'}).click();
  await gui.getByText('取得が完了しました。').waitFor({timeout:15000});
  await gui.getByText(/保存 2件/).waitFor();
});

test('GUI discovers and collects a year entry', async t => {
  const {mkdtemp,rm,mkdir,readdir}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=(await import('node:path')).default;const {PDFDocument}=await import('pdf-lib');
  const dir=await mkdtemp(path.join(tmpdir(),'gui-year-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const destination=path.join(dir,'destination');await mkdir(destination);
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const context=await browser.newContext();
  const source=await PDFDocument.create();source.addPage([300,400]).drawText('question');const pdf=Buffer.from(await source.save());const request={get:async()=>({ok:()=>true,body:async()=>pdf})};
  await context.route('https://pos.toshin.com/**',async route=>{
    const url=new URL(route.request().url());let body;
    if(url.pathname.endsWith('PosApplication.aspx')) body='<iframe src="/TGT/OPCTTS/OPCTTS_Student/NendobetsuTop"></iframe>';
    else if(url.pathname.endsWith('EnshuKaishi')) body='<a href="NendobetsuTop?enshuSetId=set">戻る</a><button onclick="window.open(\'MondaiKaitoInsatsu?EnshuSetId=set&DaimonId=q1\')">問題・解答用紙 印刷</button>';
    else if(url.pathname.endsWith('MondaiKaitoInsatsu')) body='<a href="Contents/GetMondaiPdf?daimonId=opaque">PDF</a>';
    else body='<table class="nendobetsu-ichiran"><tr class="kamoku-name-row"><th class="kamoku-name">国語</th></tr><tr><td class="kaisu-name">共通テスト2025本試験</td><td class="enshu-info"><form action="EnshuKaishi" method="post"><input name="enshuSetId" value="set" type="hidden"><button class="enshu-btn">演習</button></form></td></tr></table>';
    await route.fulfill({contentType:'text/html; charset=utf-8',body});
  });
  const pos=await context.newPage();await pos.goto('https://pos.toshin.com/SSO1/SSOMenu/PosApplication.aspx');
  const {server,url}=await createGuiServer({context,dir,request});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const gui=await context.newPage();await gui.goto(url);await gui.locator('#data-dir').fill(destination);await gui.locator('#set-data-dir').click();
  await gui.locator('#data-dir-status').getByText(/destination\/output/).waitFor();await gui.getByRole('button',{name:'年度別を読み込む'}).click();
  await gui.getByText('1件の候補を読み込みました。').waitFor();await gui.getByLabel('表示中をすべて選択').check();
  await gui.getByRole('button',{name:'選択した問題を取得'}).click();await gui.getByText('取得が完了しました。').waitFor({timeout:15000});await gui.getByText(/保存 1件/).waitFor();
  assert.equal((await readdir(path.join(destination,'output','年度別','国語'))).length,1);
  await gui.getByRole('button',{name:'前回の年度別取得を再開'}).click();
  await gui.getByText(/前回の1件を選択しました/).waitFor({timeout:10000});
  assert.equal(await gui.locator('#items input:checked').count(),1);
  await gui.getByRole('button',{name:'選択した問題を取得'}).click();
  await gui.getByText('取得が完了しました。').waitFor({timeout:10000});await gui.getByText(/スキップ 1件/).waitFor();
});

test('GUI renames selected saved PDFs and updates their history', async t => {
  const fs=await import('node:fs/promises'), {tmpdir}=await import('node:os'), path=(await import('node:path')).default;
  const dir=await fs.mkdtemp(path.join(tmpdir(),'gui-rename-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'output'),{recursive:true});await fs.writeFile(path.join(dir,'output','問題.pdf'),'example');
  await fs.writeFile(path.join(dir,'year-manifest.json'),JSON.stringify({version:1,items:[{key:'x',path:'output/問題.pdf'}]}));
  const {server,url}=await createGuiServer({context:{pages:()=>[]},dir});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.goto(url);await page.getByRole('button',{name:'保存済みPDFを読み込む'}).click();
  await page.getByLabel('演習日').fill('2026-11-05');await page.getByLabel('表示中の保存済みPDFをすべて選択').check();
  await page.getByRole('button',{name:'日付を付ける'}).click();await page.getByText('1件を処理しました。失敗 0件。').waitFor();
  assert.equal(await fs.readFile(path.join(dir,'output','20261105-問題.pdf'),'utf8'),'example');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'year-manifest.json'),'utf8')).items[0].path,'output/20261105-問題.pdf');
});

test('GUI selects visible ranges and creates dated copies', async t => {
  const fs=await import('node:fs/promises'), {tmpdir}=await import('node:os'), path=(await import('node:path')).default;
  const dir=await fs.mkdtemp(path.join(tmpdir(),'gui-copy-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'output'),{recursive:true});
  const items=[];for(let i=1;i<=6;i++){const file=`output/問題${i}.pdf`;await fs.writeFile(path.join(dir,file),`PDF ${i}`);items.push({key:String(i),path:file});}
  await fs.writeFile(path.join(dir,'year-manifest.json'),JSON.stringify({version:1,items}));
  const {server,url}=await createGuiServer({context:{pages:()=>[]},dir});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.goto(url);await page.getByRole('button',{name:'保存済みPDFを読み込む'}).click();
  await page.locator('#saved-files input').nth(0).click();
  await page.locator('#saved-files input').nth(3).click({modifiers:['Shift']});
  assert.equal(await page.locator('#saved-files input:checked').count(),4);
  await page.getByLabel('表示中の保存済みPDFをすべて選択').check();
  await page.getByLabel('表示中の保存済みPDFをすべて選択').uncheck();
  await page.locator('#saved-range-start').fill('2');await page.locator('#saved-range-end').fill('3');
  await page.locator('#saved-range-select').click();assert.equal(await page.locator('#saved-files input:checked').count(),2);
  await page.getByLabel('演習日').fill('2026-11-05');await page.getByLabel('元を残してコピーを作成').check();
  await page.getByRole('button',{name:'日付付きコピーを作成'}).click();await page.getByText('2件を処理しました。失敗 0件。').waitFor();
  assert.equal(await fs.readFile(path.join(dir,'output','問題2.pdf'),'utf8'),'PDF 2');
  assert.equal(await fs.readFile(path.join(dir,'output','20261105-問題2.pdf'),'utf8'),'PDF 2');
  assert.equal(await page.locator('#saved-files input').count(),8);
});

test('GUI switches output roots and dates PDFs from an arbitrary folder', async t => {
  const fs=await import('node:fs/promises'), {tmpdir}=await import('node:os'), path=(await import('node:path')).default;
  const dir=await fs.mkdtemp(path.join(tmpdir(),'gui-folders-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const out=path.join(dir,'other'), external=path.join(dir,'external');await fs.mkdir(out);await fs.mkdir(path.join(external,'nested'),{recursive:true});
  await fs.writeFile(path.join(external,'nested','問題.pdf'),'external');
  await fs.mkdir(path.join(dir,'output'));await fs.writeFile(path.join(dir,'output','取得済み.pdf'),'tracked');
  await fs.writeFile(path.join(dir,'year-manifest.json'),JSON.stringify({version:1,items:[{key:'old',path:'output/取得済み.pdf'}]}));
  const {server,url}=await createGuiServer({context:{pages:()=>[]},dir});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.goto(url);await page.locator('#data-dir').fill(out);await page.locator('#set-data-dir').click();
  await page.locator('#data-dir-status').getByText(/other\/output/).waitFor();
  await page.locator('#files-dir').fill(external);await page.locator('#load-folder').click();
  await page.locator('#saved-files input').first().check();await page.locator('#rename-date').fill('2026-11-05');
  await page.getByLabel('元を残してコピーを作成').check();await page.locator('#rename-start').click();
  await page.getByText('1件を処理しました。失敗 0件。').waitFor();
  assert.equal(await fs.readFile(path.join(external,'nested','20261105-問題.pdf'),'utf8'),'external');
  assert.equal(await fs.readFile(path.join(external,'nested','問題.pdf'),'utf8'),'external');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'gui-settings.json'),'utf8')).dataDir,await fs.realpath(out));
  await page.locator('#files-dir').fill(path.join(dir,'output'));await page.locator('#load-folder').click();
  await page.locator('#saved-files input').first().check();await page.getByLabel('ファイル名を変更').check();await page.locator('#rename-start').click();
  await page.getByText('1件を処理しました。失敗 0件。').waitFor();
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'year-manifest.json'),'utf8')).items[0].path,'output/20261105-取得済み.pdf');
});
