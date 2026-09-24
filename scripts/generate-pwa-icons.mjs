// One-off generator: rasterizes public/brand-logo.png (the real ME
// Metering circular badge logo, sourced from memetering.com) into the PNG
// sizes required for the web app manifest, apple-touch-icon, and favicon.
// Not part of the build — run manually if the master logo file ever changes.
//
// The source is a small raster (114x110) rather than a vector, so upscaled
// sizes (192/512) will look softer than a true vector master would —
// deliberately not re-traced/recreated as an SVG here, since doing so risks
// distorting the real logo. Sharp's `kernel: 'lanczos3'` is used to keep
// the upscale as clean as the source allows without adding artifacts.
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const source = path.join(publicDir, 'brand-logo.png');

const targets = [
  { file: 'pwa-512.png', size: 512 },
  { file: 'pwa-192.png', size: 192 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-32.png', size: 32 },
];

for (const { file, size } of targets) {
  await sharp(source)
    .resize(size, size, { kernel: 'lanczos3' })
    .png()
    .toFile(path.join(publicDir, file));
  console.log(`wrote ${file} (${size}x${size})`);
}
