import { PDFDocument } from 'pdf-lib';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isJapaneseSubject, parseOptions, safeName } from './common.js';
import { openStore } from './store.js';
import { transformPdf } from './pdf-transform.js';

const options = parseOptions(process.argv.slice(2));
const store = await openStore(options.dataDir);

if (!store.manifest.documents.length) {
  console.log('No captured PDFs. Run npm run capture first.');
  process.exit(0);
}

async function exists(file) {
  try { await stat(file); return true; }
  catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

let converted = 0, skipped = 0, failed = 0;
for (const record of store.manifest.documents) {
  try {
    if (record.processedPath && !options.force &&
      await exists(path.join(options.dataDir, record.processedPath))) {
      skipped++; continue;
    }
    const subject = options.subject || record.subject;
    if (!subject) throw new Error('Subject is missing; rerun with --subject');
    const year = options.year !== '年度不明' ? options.year : (record.year || options.year);
    const round = options.round !== '回次不明' ? options.round : (record.round || options.round);
    const direction = isJapaneseSubject(subject) ? 'rtl' : 'ltr';
    const raw = await readFile(path.join(options.dataDir, 'raw', record.filename));
    const transformed = await transformPdf(raw, PDFDocument, direction);
    const folder = path.join(options.dataDir, 'output', safeName(subject));
    await mkdir(folder, { recursive: true });
    const id = safeName(record.enshuSetId || record.daimonId || '問題', 32);
    const filename = [
      safeName(year), safeName(subject), safeName(round), safeName(record.kind || '問題'),
      id, record.sha256.slice(0, 8)
    ].join('_') + '.pdf';
    const output = path.join(folder, filename);
    const temporary = `${output}.${process.pid}.tmp`;
    await writeFile(temporary, transformed, { mode: 0o600 });
    await rename(temporary, output);
    record.processedPath = path.relative(options.dataDir, output);
    await store.save();
    converted++;
    console.log(`Converted: ${record.processedPath} (${direction})`);
  } catch (error) {
    failed++;
    console.error(`Failed ${record.sha256.slice(0, 10)}…: ${error.message}`);
  }
}
console.log(`Done: converted=${converted}, skipped=${skipped}, failed=${failed}`);
if (failed) process.exitCode = 1;
