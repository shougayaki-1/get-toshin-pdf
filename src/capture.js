import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { isPrintPage, isPdfDownloadUrl, printPageIds, isPdfBytes, parseOptions } from './common.js';
import { openStore } from './store.js';

const options = parseOptions(process.argv.slice(2), { requireSubject: true });
const store = await openStore(options.dataDir);
const profileDir = path.join(options.dataDir, 'browser-profile');
await mkdir(profileDir, { recursive: true });

console.log('Starting dedicated Chromium browser. Log in manually, then open 共通テスト対策 printing pages.');
console.log('Capture subject:', options.subject, 'year:', options.year, 'round:', options.round);
console.log('Do not use this browser profile for other websites. Press Ctrl+C to stop.');

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  acceptDownloads: true,
  viewport: { width: 1280, height: 900 }
});

if (context.pages().length === 0) await context.newPage();
const initialPage = context.pages()[0];
if (initialPage.url() === 'about:blank') {
  await initialPage.goto('https://pos.toshin.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
}

// Never log the whole URL: the PDF endpoint contains an opaque query parameter.
const attempts = new Map();
let scanning = false;
let closing = false;

function keyFor(url) {
  return createHash('sha256').update(url).digest('hex');
}

async function capturePrintPage(page) {
  if (page.isClosed() || !isPrintPage(page.url())) return;
  const printUrl = page.url();
  const ids = printPageIds(printUrl);
  const candidates = await page.locator('a[href]').evaluateAll(anchors =>
    anchors.map(anchor => anchor.href).filter(Boolean)
  );
  const urls = [...new Set(candidates.filter(isPdfDownloadUrl))];

  for (const pdfUrl of urls) {
    const key = keyFor(pdfUrl);
    const previous = attempts.get(key);
    if (previous?.done || (previous && (previous.count >= 3 || Date.now() < previous.nextAt))) continue;
    attempts.set(key, { count: (previous?.count || 0) + 1, nextAt: Date.now() + 30000, done: false });
    try {
      const response = await page.request.get(pdfUrl, {
        timeout: 30000,
        maxRedirects: 0,
        headers: { referer: printUrl }
      });
      if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
      const bytes = await response.body();
      if (!isPdfBytes(bytes)) throw new Error('Not a PDF; check authentication or link expiry');
      const result = await store.addPdf(bytes, { ...ids, ...options });
      attempts.set(key, { done: true, count: 1, nextAt: 0 });
      console.log(result.duplicate ? 'Skipped duplicate PDF.' :
        `Saved PDF (${result.record.sha256.slice(0, 10)}…)`);
      // Avoid bursts against the service.
    } catch (error) {
      console.warn(`Capture failed (try ${attempts.get(key).count}/3): ${/^HTTP \d+$/.test(error.message) ? error.message : 'network, authentication, or PDF error'}`);
      if (/^HTTP (401|403|404|3\d\d)$/.test(error.message)) attempts.set(key, { done: true });
    } finally {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
}

async function scan() {
  if (scanning || closing) return;
  scanning = true;
  try {
    for (const page of context.pages()) {
      try { await capturePrintPage(page); }
      catch (error) { console.warn('Could not inspect a page; it may have closed or the session expired.'); }
    }
  } finally {
    scanning = false;
  }
}

// Also react immediately to popup/window navigation; polling is a fallback.
function observe(page) {
  page.on('domcontentloaded', () => {
    void scan();
  });
}
for (const page of context.pages()) observe(page);
context.on('page', observe);

const interval = setInterval(() => { void scan(); }, 3000);
await scan();

async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(interval);
  console.log('Closing browser. Captured PDFs remain in the local data directory.');
  await context.close().catch(() => {});
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
context.on('close', () => {
  clearInterval(interval);
  closing = true;
});
