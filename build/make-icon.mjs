// Rasterizes assets/icon.svg into icon.png and a multi-size icon.ico.
// Needs Playwright with Chromium installed (npx playwright install chromium).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8');
const sizes = [16, 24, 32, 48, 64, 128, 256];

const browser = await chromium.launch();
const page = await browser.newPage();
const pngs = {};
for (const s of sizes) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="256" height="256"', `width="${s}" height="${s}"`)}</body></html>`);
  pngs[s] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
}
await browser.close();

fs.writeFileSync(path.join(root, 'assets', 'icon.png'), pngs[256]);

// ICO with embedded PNG images.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
const dir = Buffer.alloc(16 * sizes.length);
let offset = 6 + dir.length;
sizes.forEach((s, i) => {
  const d = pngs[s];
  const o = i * 16;
  dir.writeUInt8(s >= 256 ? 0 : s, o); dir.writeUInt8(s >= 256 ? 0 : s, o + 1);
  dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(d.length, o + 8); dir.writeUInt32LE(offset, o + 12);
  offset += d.length;
});
fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), Buffer.concat([header, dir, ...sizes.map(s => pngs[s])]));
console.log('icon.png + icon.ico written');
