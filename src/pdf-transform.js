// Adapted from chrome-extension-2-in-1/src/pdf-transform.js
import { createSpreadPlan } from './layout.js';

function pageGeometry(page) {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const left = Math.max(media.x, crop.x);
  const bottom = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation)) throw new Error('Unsupported page rotation');
  const width = right - left;
  const height = top - bottom;
  if (width <= 0 || height <= 0) throw new Error('Invalid page crop/size');
  return {
    boundingBox: { left, bottom, right, top },
    rotation,
    size: rotation % 180 === 0 ? { width, height } : { width: height, height: width }
  };
}

function drawPlacement(target, embedded, placement, rotation) {
  if (!placement) return;
  const { pageIndex: _ignored, ...options } = placement;
  if (rotation === 90 || rotation === 270) {
    options.width = placement.height;
    options.height = placement.width;
  }
  if (rotation === 90) options.y += placement.height;
  if (rotation === 180) {
    options.x += placement.width;
    options.y += placement.height;
  }
  if (rotation === 270) options.x += placement.width;
  options.rotate = { type: 'degrees', angle: -rotation };
  target.drawPage(embedded, options);
}

export async function transformPdf(bytes, PDFDocument, direction = 'ltr') {
  const source = await PDFDocument.load(bytes);
  const pages = source.getPages();
  if (!pages.length) throw new Error('Empty PDF');
  const geometries = pages.map(pageGeometry);
  const output = await PDFDocument.create();
  const embedded = await output.embedPages(pages, geometries.map(value => value.boundingBox));
  const plan = createSpreadPlan(geometries.map(value => value.size), direction);
  for (const spread of plan.spreads) {
    const target = output.addPage([plan.sheet.width, plan.sheet.height]);
    for (const placement of [spread.left, spread.right]) {
      if (!placement) continue;
      const index = placement.pageIndex;
      drawPlacement(target, embedded[index], placement, geometries[index].rotation);
    }
  }
  return output.save();
}
