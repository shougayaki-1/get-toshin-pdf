import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.js';
import { createHash } from 'node:crypto';

const pdf = Buffer.from('%PDF-1.7\nexample');
const metadata = { subject: '国語', year: '2025', round: '本試' };

test('deduplicates, persists and restores a missing original', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'toshin-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await openStore(dir);
  const added = await store.addPdf(pdf, metadata);
  assert.equal(added.duplicate, false);
  assert.equal((await store.addPdf(pdf, metadata)).duplicate, true);
  const raw = path.join(dir, 'raw', added.record.filename);
  await rm(raw);
  const reopened = await openStore(dir);
  assert.equal((await reopened.addPdf(pdf, metadata)).duplicate, true);
  assert.deepEqual(await readFile(raw), pdf);
  assert.equal(reopened.manifest.documents.length, 1);
});

test('recovers a raw file written before an interrupted manifest update', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'toshin-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await openStore(dir);
  const hash = createHash('sha256').update(pdf).digest('hex');
  await writeFile(path.join(dir, 'raw', `${hash}.pdf`), pdf);
  assert.equal((await store.addPdf(pdf, metadata)).duplicate, false);
  assert.equal((await openStore(dir)).manifest.documents.length, 1);
});
