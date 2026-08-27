/** สร้างไอคอน PWA จาก SVG (ฟันบนพื้นน้ำเงิน accent) */
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const TOOTH = `<path fill="#fff" d="M256 76c-30 0-46 12-70 12s-40-12-70-12c-42 0-72 34-72 84 0 44 14 74 26 118 9 33 12 68 18 96 6 26 18 42 38 42 22 0 30-18 36-48 6-30 10-58 34-58s28 28 34 58c6 30 14 48 36 48 20 0 32-16 38-42 6-28 9-63 18-96 12-44 26-74 26-118 0-50-30-84-72-84z"/>`;

const svg = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#2B5CE6"/>
  <g transform="translate(256 256) scale(${pad ? 0.62 : 0.78}) translate(-256 -256)">${TOOTH}</g>
</svg>`;

const out = new URL('../public/', import.meta.url);

for (const [name, size, maskable] of [
  ['pwa-192.png', 192, false],
  ['pwa-512.png', 512, false],
  ['pwa-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
  ['favicon-32.png', 32, false],
]) {
  const buf = await sharp(Buffer.from(svg(size, maskable))).png().toBuffer();
  writeFileSync(new URL(name, out), buf);
  console.log('wrote', name, buf.length, 'bytes');
}

writeFileSync(new URL('icon.svg', out), svg(512, false));
console.log('wrote icon.svg');
