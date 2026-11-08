import { httpError } from './retry.js';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { isJapaneseSubject, isPdfBytes, isPdfDownloadUrl, isPrintPage, parseOptions } from './common.js';
import { transformPdf } from './pdf-transform.js';
import { parseSelection } from './selection.js';
import { isReviewTarget, parseHighestScoreRate } from './score-filter.js';

// Preserve the visible Japanese title, including full-width spaces.
export function filenamePart(value) {
  return String(value).normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '').slice(0, 120) || '不明';
}
export function questionFilename(index, title) {
  return `${String(index).padStart(2, '0')}-${filenamePart(title)}.pdf`;
}
export function inferSubject(category) {
  const match = /^大問別演習[\s　]+([^\s　]+)/u.exec(category.trim());
  return match?.[1] || null;
}
export function questionKey(setId, itemId) {
  return createHash('sha256').update(JSON.stringify([setId, itemId])).digest('hex');
}
export function validSinglePrint(rawUrl, setId, itemId) {
  if (!isPrintPage(rawUrl)) return false;
  const u = new URL(rawUrl);
  return u.searchParams.get('EnshuSetId') === setId && u.searchParams.get('DaimonId') === itemId;
}

async function exists(file) {
  try { return (await stat(file)).isFile(); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
export async function readState(dir) {
  try {
    const state = JSON.parse(await readFile(path.join(dir, 'daimon-manifest.json'), 'utf8'));
    if (state.version !== 1 || !Array.isArray(state.items)) throw new Error('Invalid manifest');
    return state;
  } catch (e) { if (e.code === 'ENOENT') return { version: 1, items: [] }; throw e; }
}
async function saveState(dir, state) {
  const temp = path.join(dir, `.daimon-manifest-${randomBytes(8).toString('hex')}.tmp`);
  await writeFile(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, path.join(dir, 'daimon-manifest.json'));
}

// The element association is based on the observed question list, not ID construction.
export async function listQuestions(frame) {
  const questions=await frame.locator('li.questions-item').evaluateAll(rows => rows.map((row, i) => {
    const input = row.querySelector('input.chkDaimon');
    const title = row.querySelector('.questions-item-title')?.textContent?.trim();
    const number = row.querySelector('h4 .flag small')?.textContent?.trim();
    return { index: i + 1, number, title, id: input?.value, checked: !!input?.checked, scoreText: row.innerText };
  }));
  return questions.map(({scoreText,...question})=>({...question,scoreRate:parseHighestScoreRate(scoreText)}));
}

export async function collectOne({ page, frame, item, setId, subject, dir, state, force = false, request = page.context().request }) {
  const key = questionKey(setId, item.id);
  const prior = state.items.find(r => r.key === key);
  if (prior && !force && await exists(path.join(dir, prior.path))) return 'skipped';
  const rows = frame.locator('li.questions-item');
  const boxes = frame.locator('input.chkDaimon');
  // Always isolate exactly one question and verify before opening the print popup.
  for (let i = 0; i < await boxes.count(); i++) {
    const checked = await boxes.nth(i).isChecked();
    if (checked !== (i === item.index - 1)) await rows.nth(i).locator('label.checkbox').click();
  }
  if (await frame.locator('input.chkDaimon:checked').count() !== 1 ||
      !(await boxes.nth(item.index - 1).isChecked())) throw new Error('問題の選択を確認できません');
  const popupPromise = page.waitForEvent('popup', { timeout: 15000 });
  const [popup] = await Promise.all([popupPromise, frame.getByRole('button', { name: '問題・解答用紙 印刷' }).click()]);
  try {
    await popup.waitForLoadState('domcontentloaded');
    if (!validSinglePrint(popup.url(), setId, item.id)) throw new Error('印刷画面の問題IDが選択と一致しません');
    const candidates = await popup.locator('a[href]').evaluateAll(links => links.map(a => a.href));
    const pdfUrl = candidates.find(isPdfDownloadUrl);
    if (!pdfUrl) throw new Error('PDFリンクが見つかりません');
    const response = await request.get(pdfUrl, {
      timeout: 30000, maxRedirects: 0, headers: { referer: popup.url() }
    });
    if (!response.ok()) throw httpError(response);
    const bytes = await response.body();
    if (!isPdfBytes(bytes)) throw new Error('PDFではありません。ログイン状態を確認してください');
    const source = await PDFDocument.load(bytes);
    if (!source.getPageCount()) throw new Error('PDFにページがありません');
    const transformed = await transformPdf(bytes, PDFDocument, isJapaneseSubject(subject) ? 'rtl' : 'ltr');
    const folder = path.join(dir, 'output', filenamePart(subject), filenamePart(item.category));
    await mkdir(folder, { recursive: true });
    let file = path.join(folder, questionFilename(item.number, item.title));
    if (prior) file = path.join(dir, prior.path);
    else if (await exists(file)) file = file.replace(/\.pdf$/, `_${key.slice(0, 10)}.pdf`);
    if (!prior && await exists(file)) throw new Error('保存先の名前が衝突しています');
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    await writeFile(temp, transformed, { mode: 0o600, flag: 'wx' });
    await rename(temp, file);
    const entry = { key, title: item.title, number: item.number, subject, category: item.category,
      path: path.relative(dir, file), savedAt: new Date().toISOString() };
    if (prior) Object.assign(prior, entry); else state.items.push(entry);
    await saveState(dir, state);
    return 'saved';
  } finally { await popup.close().catch(() => {}); }
}

export async function run() {
  const options = parseOptions(process.argv.slice(2));
  const dir = options.dataDir;
  await mkdir(path.join(dir, 'browser-profile'), { recursive: true, mode: 0o700 });
  const state = await readState(dir);
  const context = await chromium.launchPersistentContext(path.join(dir, 'browser-profile'), {
    headless: false, acceptDownloads: true, viewport: { width: 1280, height: 900 }
  });
  const input = createInterface({ input: stdin, output: stdout });
  try {
    const page = context.pages()[0] || await context.newPage();
    if (page.url() === 'about:blank') await page.goto('https://pos.toshin.com/', { waitUntil: 'domcontentloaded' });
    console.log('ブラウザでログインし、大問別演習の科目・分野を開いてから端末で Enter を押してください。終了は q。');
    while (true) {
      const answer = (await input.question('\nEnter=現在の分野を読み込む / q=終了 > ')).trim().toLowerCase();
      if (answer === 'q') break;
      if (answer) { console.log('Enter または q を入力してください。'); continue; }
      const frame = page.frames().find(f => /\/EnshuKaishi(?:[/?]|$)/.test(f.url()));
      if (!frame || new URL(frame.url()).hostname !== 'pos.toshin.com') { console.log('大問別演習の問題一覧を開いてください。'); continue; }
      const back = await frame.locator('a[href*="DaimonBunyabetsuTop"]').first().getAttribute('href');
      const setId = back && new URL(back, frame.url()).searchParams.get('enshuSetId');
      const category = (await frame.locator('h3').first().innerText()).replace(/^\s*[英国数理社情]\s*/, '').trim();
      let subject = options.subject || inferSubject(category);
      if (!subject) { subject = (await input.question('科目名を判別できません。科目名を入力してください > ')).trim(); }
      if (!subject) { console.log('科目名が必要です。'); continue; }
      if (options.subject && !category.includes(options.subject)) { console.log('指定した科目と画面の分野名が一致しません。--subject を確認してください。'); continue; }
      console.log(`科目: ${subject}`);
      const items = await listQuestions(frame);
      if (!setId || !items.length || items.some(q => !q.id || !q.title || !/^\d+$/.test(q.number))) {
        console.log('一覧の構造を確認できません。処理を中止しました。'); continue;
      }
      items.forEach((item, i) => console.log(`${i + 1}: ${item.title}（最高得点率: ${item.scoreRate===null?'未判定':item.scoreRate+'%'}）`));
      const choices = (await input.question('番号・範囲（例: 1,3-8）、全件 a、戻る q > ')).trim();
      if (choices.toLowerCase() === 'q') continue;
      let selected;
      try { selected = parseSelection(choices, items.length).map(i => ({ ...items[i], category })); }
      catch (e) { console.log(e.message); continue; }
      if(options.reviewOnly)selected=selected.filter(isReviewTarget);
      if(!selected.length){console.log('赤・黄色の対象問題がありません。');continue;}
      console.log(`${selected.length} 問を処理します。`);
      let saved = 0, skipped = 0, failed = 0, attempted = 0;
      try {
        for (const item of selected) {
          attempted++;
          try {
            const result = await collectOne({ page, frame, item, setId, subject, dir, state, force:options.force });
            if (result === 'saved') saved++; else skipped++;
            console.log(`${result === 'saved' ? '保存' : 'スキップ'}: ${questionFilename(item.number, item.title)}`);
          } catch (e) {
            failed++;
            // Do not log library/network error messages: they may include opaque URLs.
            const status = /^HTTP (\d{3})$/.exec(e.message)?.[1];
            console.error(`失敗: ${questionFilename(item.number, item.title)}（${status ? `HTTP ${status}` : '認証・通信・印刷画面を確認'}）`);
            console.error('問題を確認して再実行できるよう、残りの取得を中断します。');
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } finally {
        for (let i = 0; i < items.length; i++) {
          const box = frame.locator('input.chkDaimon').nth(i);
          if (await box.isChecked() !== items[i].checked) await frame.locator('li.questions-item').nth(i).locator('label.checkbox').click();
        }
      }
      console.log(`結果: 保存 ${saved}、スキップ ${skipped}、失敗 ${failed}、未処理 ${selected.length - attempted}。中断分は再実行できます。`);
    }
  } finally { input.close(); await context.close(); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  run().catch(() => { console.error('起動または処理に失敗しました。ログイン状態、ブラウザ、保存先を確認してください。'); process.exitCode = 1; });
}
