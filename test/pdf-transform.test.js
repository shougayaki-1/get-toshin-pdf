import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import { transformPdf } from '../src/pdf-transform.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const poppler = spawnSync('pdftoppm', ['-v'], { stdio: 'ignore' }).error == null;

test('renders both directions, odd page, rotation and mixed page sizes', { skip: !poppler }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'toshin-render-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = await PDFDocument.create();
  const colors = [rgb(1, 0, 0), rgb(0, 1, 0), rgb(0, 0, 1)];
  for (let i = 0; i < 3; i++) {
    const page = source.addPage(i === 1 ? [200, 300] : [300, 400]);
    const { width, height } = page.getSize();
    page.drawRectangle({ x: 0, y: 0, width, height, color: colors[i] });
    if (i === 1) { page.setCropBox(10, 20, 180, 260); page.setRotation(degrees(90)); }
  }
  const input = await source.save();
  for (const direction of ['ltr', 'rtl']) {
    const out = await transformPdf(input, PDFDocument, direction);
    const loaded = await PDFDocument.load(out);
    assert.equal(loaded.getPageCount(), 2);
    const pdf = path.join(dir, `${direction}.pdf`);
    await writeFile(pdf, out);
    execFileSync('pdftoppm', ['-r', '36', pdf, path.join(dir, direction)]);
    const sample = async (number, x, y) => {
      const ppm = await readFile(path.join(dir, `${direction}-${number}.ppm`));
      const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.toString('latin1', 0, 100));
      assert.ok(header);
      const width = Number(header[1]);
      const offset = header[0].length + (y * width + x) * 3;
      return [...ppm.subarray(offset, offset + 3)];
    };
    const left = await sample(1, 50, 75);
    const right = await sample(1, 150, 75);
    const lastLeft = await sample(2, 50, 75);
    const lastRight = await sample(2, 150, 75);
    const red = [255, 0, 0], green = [0, 255, 0], blue = [0, 0, 255], white = [255, 255, 255];
    assert.deepEqual(left, direction === 'ltr' ? red : green);
    assert.deepEqual(right, direction === 'ltr' ? green : red);
    assert.deepEqual(lastLeft, direction === 'ltr' ? blue : white);
    assert.deepEqual(lastRight, direction === 'ltr' ? white : blue);
  }
});
