// Selection numbers are 1-based as displayed. Ranges are inclusive.
export function parseSelection(value, count) {
  const input = value.trim().toLowerCase();
  if (input === 'a' || input === 'all') return Array.from({ length: count }, (_, i) => i);
  if (!input) throw new Error('番号を指定してください');
  const selected = new Set();
  for (const part of input.split(/[\s,、]+/)) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!match) throw new Error('番号または範囲（例: 1,3-8）を指定してください');
    const start = Number(match[1]), end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > count) throw new Error('一覧の範囲内で指定してください');
    for (let i = start; i <= end; i++) selected.add(i - 1);
  }
  return [...selected].sort((a, b) => a - b);
}
