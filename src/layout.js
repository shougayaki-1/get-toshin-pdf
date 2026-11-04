// Adapted from chrome-extension-2-in-1/src/layout.js
export const PRINT_SAFE_MARGIN = 12; // PDF points (about 4.2 mm)

export function fitPage(sourceWidth, sourceHeight, box) {
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error('Invalid source page dimensions');
  const scale = Math.min(box.width / sourceWidth, box.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

export function createSpreadPlan(sizes, direction = 'ltr') {
  if (!Array.isArray(sizes) || !sizes.length) throw new Error('PDF must contain pages');
  if (!['ltr', 'rtl'].includes(direction)) throw new Error('Invalid direction');
  const first = sizes[0];
  const sheet = first.height >= first.width
    ? { width: first.height, height: first.width }
    : { width: first.width, height: first.height };
  const half = sheet.width / 2;
  const margin = Math.min(PRINT_SAFE_MARGIN, half / 4, sheet.height / 4);
  const leftBox = { x: margin, y: margin, width: half - 2 * margin, height: sheet.height - 2 * margin };
  const rightBox = { x: half + margin, y: margin, width: half - 2 * margin, height: sheet.height - 2 * margin };
  const spreads = [];
  for (let i = 0; i < sizes.length; i += 2) {
    const left = direction === 'ltr' ? i : i + 1;
    const right = direction === 'rtl' ? i : i + 1;
    const place = (index, box) =>
      index < sizes.length ? { pageIndex: index, ...fitPage(sizes[index].width, sizes[index].height, box) } : null;
    spreads.push({ left: place(left, leftBox), right: place(right, rightBox) });
  }
  return { sheet, spreads };
}
