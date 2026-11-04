import path from 'node:path';

const POS_HOST = 'pos.toshin.com';

export function parseOptions(argv, { requireSubject = false } = {}) {
  const raw = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force') { raw.force = true; continue; }
    if (!['--subject', '--year', '--round', '--data-dir'].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value after ${arg}`);
    raw[arg.slice(2)] = value.trim();
  }
  if (requireSubject && !raw.subject) {
    throw new Error('Please specify --subject. Example: --subject "国語"');
  }
  return {
    subject: raw.subject || null,
    year: raw.year || '年度不明',
    round: raw.round || '回次不明',
    dataDir: path.resolve(raw['data-dir'] || '.local'),
    force: Boolean(raw.force)
  };
}

export function isPrintPage(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && url.hostname === POS_HOST &&
      /\/MondaiKaitoInsatsu\/?$/i.test(url.pathname);
  } catch { return false; }
}

export function isPdfDownloadUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && url.hostname === POS_HOST &&
      /\/Contents\/GetMondaiPdf\/?$/i.test(url.pathname) &&
      url.searchParams.has('daimonId');
  } catch { return false; }
}

export function printPageIds(rawUrl) {
  const url = new URL(rawUrl);
  return {
    enshuSetId: url.searchParams.get('EnshuSetId') || '',
    daimonId: url.searchParams.get('DaimonId') || ''
  };
}

export function isPdfBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return header.includes('%PDF-');
}

export function safeName(input, maxLength = 70) {
  return String(input || '不明').normalize('NFKC')
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, maxLength) || '不明';
}

export function isJapaneseSubject(subject) {
  return /国語|現代文|古文|漢文/.test(subject || '');
}
