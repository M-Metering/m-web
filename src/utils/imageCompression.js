// src/utils/imageCompression.js
// Shrink a photo that is too big for POST /uploads BEFORE it is sent.
//
// Why this exists (2026-09-28): the API takes at most 5 MB per file, and the
// field refused anything larger in the browser. A phone camera's full-size
// JPEG is routinely 5-12 MB, so "Take photo" failed for exactly the installers
// it was built for. The server already recompresses every image over 300 KB,
// so re-encoding a large photo here loses nothing the stored copy would have
// kept.
//
// Rules:
//   - A file already within the limit is sent UNCHANGED (byte for byte).
//   - Only JPEG/PNG/WebP are touched — the types installation_photo accepts.
//   - The longest side is capped at MAX_DIMENSION, then JPEG quality steps down
//     until the result fits. If it still doesn't fit, or the browser can't
//     decode the image, the ORIGINAL file is returned and the normal size check
//     rejects it with its usual message. Nothing is ever faked.
//   - Re-encoding drops EXIF. The photo's location travels separately, as the
//     upload's own latitude/longitude fields.
import { MAX_FILE_SIZE_BYTES } from './fileUpload';

export const MAX_DIMENSION = 2560;
const QUALITY_STEPS = [0.85, 0.72, 0.6];
const COMPRESSIBLE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Scale (width, height) so the longest side is at most `max`, keeping the aspect ratio. */
export function scaledDimensions(width, height, max = MAX_DIMENSION) {
  const longest = Math.max(width, height);
  if (!longest || longest <= max) return { width, height };
  const ratio = max / longest;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

/** Whether a file needs (and can be given) a smaller copy before upload. */
export function needsCompression(file, maxBytes = MAX_FILE_SIZE_BYTES) {
  return Boolean(file) && file.size > maxBytes && COMPRESSIBLE_TYPES.includes(String(file.type || '').toLowerCase());
}

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    // 'from-image' applies the EXIF orientation, so a portrait shot stays upright.
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encodeJpeg(image, { width, height }, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  // JPEG has no alpha: paint white first so a transparent PNG isn't black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * The file to upload: the original when it already fits, otherwise a smaller
 * JPEG copy when one can be made, otherwise the original (which the size check
 * then rejects).
 *
 * @param {File} file
 * @param {{ maxBytes?: number, decode?: Function, encode?: Function }} [options]
 *   decode/encode are injectable for tests; the browser implementations are the default.
 * @returns {Promise<File>}
 */
export async function prepareUploadImage(file, { maxBytes = MAX_FILE_SIZE_BYTES, decode = decodeImage, encode = encodeJpeg } = {}) {
  if (!needsCompression(file, maxBytes)) return file;
  try {
    const image = await decode(file);
    const size = scaledDimensions(image.width, image.height);
    for (const quality of QUALITY_STEPS) {
      const blob = await encode(image, size, quality);
      if (blob && blob.size > 0 && blob.size <= maxBytes) {
        image.close?.();
        const name = String(file.name || 'photo').replace(/\.[a-z0-9]+$/i, '') + '.jpg';
        return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified || Date.now() });
      }
    }
    image.close?.();
  } catch (err) {
    console.warn('[imageCompression] Could not make a smaller copy; sending the original for the size check:', err?.message);
  }
  return file;
}

export default prepareUploadImage;
