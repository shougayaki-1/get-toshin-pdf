import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isJapaneseSubject, isPdfBytes, isPdfDownloadUrl, isPrintPage, parseOptions } from './common.js';
import { filenamePart } from './daimon.js';
import { parseSelection } from './selection.js';
import { transformPdf } from './pdf-transform.js';

export async function listYears(frame) {
  return frame.locator('table.nendobetsu-ichiran').evaluate(table => {
    const headers = [...table.querySelectorAll('tr.kamoku-name-row th.kamoku-name')].map(th => th.innerText.replace(/\s+/g, ' ').trim());
    return [...table.querySelectorAll('tr')].flatMap(row => {
      const round = row.querySelector('td.kaisu-name')?.innerText.trim();
      if (!round) return [];
      return [...row.querySelectorAll('td.enshu-info')].flatMap((cell, column) => {
        const form = cell.querySelector('form');
        const id = form?.querySelector('input[name="enshuSetId"]')?.value;
        const button = form?.querySelector('button.enshu-btn');
        if (!button || button.disabled || !id || !headers[column]) return [];
        return [{ round, subject: headers[column], setId: id, column }];
      });
    });
  });
}
export function yearKey(item) { return createHash('sha256').update(item.setId).digest('hex'); }
export function yearFilename(item) {
  const year = item.round.match(/(?:19|20)\d{2}/)?.[0] || '年度不明';
  const round = item.round.includes('追試') ? '追試' : item.round.includes('本試') ? '本試' : item.round;
  return [year, item.subject, round, '問題'].map(filenamePart).join('_') + '.pdf';
}
async function exists(file) { try { return (await stat(file)).isFile(); } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
export async function readYearState(dir) {
  try { const s = JSON.parse(await readFile(path.join(dir, 'year-manifest.json'), 'utf8')); if (s.version !== 1 || !Array.isArray(s.items)) throw Error('invalid manifest'); return s; }
  catch (e) { if (e.code === 'ENOENT') return {version:1, items:[]}; throw e; }
}
async function saveYearState(dir, state) {
  const temp = path.join(dir, `.year-${randomBytes(8).toString('hex')}.tmp`);
  await writeFile(temp, JSON.stringify(state, null, 2)+'\n', {mode:0o600, flag:'wx'});
  await rename(temp, path.join(dir, 'year-manifest.json'));
}
export async function collectYear({ page, frame, item, dir, state, request = page.context().request }) {
  const key = yearKey(item);
  const prior = state.items.find(x => x.key === key);
  if (prior && await exists(path.join(dir, prior.path))) return 'skipped';
  const row = frame.locator('table.nendobetsu-ichiran tr').filter({has:frame.locator('td.kaisu-name', {hasText:item.round})});
  if (await row.count() !== 1) throw Error('年度行が特定できません');
  const cell = row.locator('td.enshu-info').nth(item.column);
  const currentId = await cell.locator('input[name=enshuSetId]').inputValue();
  if (currentId !== item.setId) throw Error('年度科目が変化しました');
  await Promise.all([frame.waitForURL(/\/EnshuKaishi(?:[/?]|$)/, {timeout:20000}), cell.locator('button.enshu-btn').click()]);
  try {
    const back = await frame.locator('a[href*="NendobetsuTop"]').first().getAttribute('href');
    if (!back || new URL(back, frame.url()).searchParams.get('enshuSetId') !== item.setId) throw Error('演習画面が一致しません');
    const [popup] = await Promise.all([page.waitForEvent('popup', {timeout:15000}), frame.getByRole('button', {name:'問題・解答用紙 印刷'}).click()]);
    try {
      await popup.waitForLoadState('domcontentloaded');
      const u = new URL(popup.url());
      if (!isPrintPage(u.href) || u.searchParams.get('EnshuSetId') !== item.setId || !u.searchParams.get('DaimonId')) throw Error('印刷画面が一致しません');
      const links = await popup.locator('a[href]').evaluateAll(as => as.map(a => a.href));
      const url = links.find(isPdfDownloadUrl);
      if (!url) throw Error('PDFリンクがありません');
      const response = await request.get(url, {timeout:30000, maxRedirects:0, headers:{referer:popup.url()}});
      if (!response.ok()) throw Error(`HTTP ${response.status()}`);
      const bytes = await response.body();
      if (!isPdfBytes(bytes) || !(await PDFDocument.load(bytes)).getPageCount()) throw Error('PDF応答ではありません');
      const output = await transformPdf(bytes, PDFDocument, isJapaneseSubject(item.subject) ? 'rtl' : 'ltr');
      const folder = path.join(dir, 'output', '年度別', filenamePart(item.subject));
      await mkdir(folder, {recursive:true});
      let file = prior ? path.join(dir, prior.path) : path.join(folder, yearFilename(item));
      if (!prior && await exists(file)) file = file.replace(/\.pdf$/, `_${key.slice(0,10)}.pdf`);
      if (!prior && await exists(file)) throw Error('保存先の名前が衝突しています');
      const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(temp, output, {mode:0o600,flag:'wx'}); await rename(temp,file);
      const record = {key, round:item.round, subject:item.subject, path:path.relative(dir,file), savedAt:new Date().toISOString()};
      if (prior) Object.assign(prior, record); else state.items.push(record);
      await saveYearState(dir,state);
      return 'saved';
    } finally { await popup.close().catch(()=>{}); }
  } finally {
    // Navigate using the site-provided back link, not a reconstructed URL.
    const back = frame.locator('a[href*="NendobetsuTop"]').first();
    if (await back.count()) await Promise.all([frame.waitForURL(/\/NendobetsuTop(?:[/?]|$)/,{timeout:20000}),back.click()]);
  }
}
export async function openYearList(page) {
  const findYear = () => page.frames().find(f => /^https:\/\/pos\.toshin\.com\/TGT\/OPCTTS\/OPCTTS_Student\/NendobetsuTop(?:[/?]|$)/.test(f.url()));
  let frame = findYear();
  if (frame) { await frame.locator('table.nendobetsu-ichiran').waitFor({timeout:20000}); return frame; }
  for (const f of page.frames()) {
    if (!f.url().startsWith('https://pos.toshin.com/')) continue;
    const link = f.getByRole('link', {name:'年度別演習', exact:true});
    if (await link.count()) { await link.first().click(); break; }
  }
  if (!findYear()) {
    const course = page.getByRole('link', {name:/過去問演習講座.*共通テスト対策/}).filter({visible:true});
    if (await course.count()) await course.first().click({timeout:10000, noWaitAfter:true});
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    frame = findYear();
    if (frame && await frame.locator('table.nendobetsu-ichiran').count()) return frame;
    await page.waitForTimeout(500);
  }
  const paths = page.frames().map(f => { try { return new URL(f.url()).pathname; } catch { return 'unknown'; } });
  console.error(`検出した画面: ${paths.join(', ')}`);
  throw Error('年度別画面を開けません');
}
export async function runYear() {
  const options = parseOptions(process.argv.slice(2));
  await mkdir(options.dataDir, {recursive:true,mode:0o700});
  const state = await readYearState(options.dataDir);
  const context = await chromium.launchPersistentContext(path.join(options.dataDir,'browser-profile'), {headless:false,acceptDownloads:true,viewport:{width:1280,height:900}});
  const input = createInterface({input:stdin,output:stdout});
  try {
    let page = context.pages().find(p => p.url().startsWith('https://pos.toshin.com/')) || context.pages()[0] || await context.newPage();
    if (!/\/SSO1\/SSOMenu\/(StudentMenu|PosApplication)\.aspx/i.test(page.url())) await page.goto('https://pos.toshin.com/', {waitUntil:'domcontentloaded'});
    console.log('専用ブラウザで東進学力POSにログインし、学習メニューを表示してください。');
    let frame;
    while (!frame) {
      if ((await input.question('Enter=年度別を開く / q=終了 > ')).trim().toLowerCase() === 'q') return;
      page = context.pages().find(p => /\/SSO1\/SSOMenu\/(StudentMenu|PosApplication)\.aspx/i.test(p.url())) || page;
      try { frame = await openYearList(page); }
      catch { console.log('年度別画面を開けません。専用ブラウザでログイン後、学習メニューを表示して再度 Enter を押してください。'); }
    }
    const items = await listYears(frame);
    if (!items.length) throw Error('年度別の候補が見つかりません');
    items.forEach((x,i)=>console.log(`${i+1}: ${x.round} / ${x.subject}`));
    const answer = (await input.question('番号・範囲（例: 1,3-8）、全件 a、終了 q > ')).trim();
    if (answer.toLowerCase() === 'q') return;
    const selected = parseSelection(answer,items.length).map(i=>items[i]);
    let saved=0, skipped=0, failed=0, attempted=0;
    for (const item of selected) {
      attempted++;
      try {
        const result = await collectYear({page,frame,item,dir:options.dataDir,state});
        if (result === 'saved') saved++; else skipped++;
        console.log(`${result === 'saved' ? '保存' : 'スキップ'}: ${yearFilename(item)}`);
      } catch (e) {
        failed++; const status = /^HTTP (\d{3})$/.exec(e.message)?.[1];
        console.error(`失敗: ${item.round} / ${item.subject}（${status ? `HTTP ${status}` : '画面・認証・通信を確認'}）。残りを中断します。`); break;
      }
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    console.log(`結果: 保存 ${saved}、スキップ ${skipped}、失敗 ${failed}、未処理 ${selected.length-attempted}`);
  } finally {input.close();await context.close();}
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) runYear().catch(()=>{console.error('年度別画面を開けませんでした。ログイン状態と画面を確認してください。');process.exitCode=1;});
