import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isPdfBytes, safeName } from './common.js';

async function readManifest(dataDir) {
  try {
    const value = JSON.parse(await readFile(path.join(dataDir, 'manifest.json'), 'utf8'));
    if (!Array.isArray(value.documents)) throw new Error('Invalid manifest');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, documents: [] };
    throw error;
  }
}

export async function openStore(dataDir) {
  await mkdir(dataDir, { recursive: true });
  await mkdir(path.join(dataDir, 'raw'), { recursive: true });
  const manifest = await readManifest(dataDir);

  async function save() {
    const target = path.join(dataDir, 'manifest.json');
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    await rename(temp, target);
  }

  async function addPdf(input, metadata) {
    const bytes = Buffer.from(input);
    if (!isPdfBytes(bytes)) throw new Error('Response was not a PDF');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = manifest.documents.find(record => record.sha256 === sha256);
    if (existing) return { record: existing, duplicate: true };

    const filename = `${sha256}.pdf`;
    await writeFile(path.join(dataDir, 'raw', filename), bytes, { flag: 'wx', mode: 0o600 });
    const record = {
      sha256,
      filename,
      subject: metadata.subject,
      year: metadata.year,
      round: metadata.round,
      kind: '問題',
      enshuSetId: safeName(metadata.enshuSetId, 90),
      daimonId: safeName(metadata.daimonId, 90),
      savedAt: new Date().toISOString(),
      processedPath: null
    };
    manifest.documents.push(record);
    await save();
    return { record, duplicate: false };
  }

  return { dataDir, manifest, addPdf, save };
}
