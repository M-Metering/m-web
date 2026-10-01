// src/utils/imageCompression.js
// Bring an installation photo within the API's 5 MB limit
// (MAX_PHOTO_SIZE_BYTES) BEFORE it is sent to POST /uploads.
//
// History: the target was 5 MB from 2026-09-28, 1 MB on 2026-10-01, and is
// 5 MB again since 2026-10-02, matching the API. A full-size phone camera
// shot can exceed it, and the server recompresses anything over 300 KB anyway.
//
// Rules:
//   - A JPEG/PNG/WebP already within the limit is sent UNCHANGED (byte for byte).
//   - Anything larger is re-encoded as JPEG: longest side 2048 px first,
//     stepping quality down, then 1600 px. Never smaller than 1600 px, so a
//     meter's digits and seal stay legible; if 1600 px at the lowest quality
//     still doesn't fit, the ORIGINAL is returned and the size check refuses
//     it with a clear message. Nothing is ever faked.
//   - JPEG, not WebP: the Completed Installations export embeds the picture,
//     and Excel embeds only JPEG/PNG (utils/photoEmbed.js). An installation
//     photo has no use for PNG transparency; a transparent PNG is flattened
//     onto white.
//   - HEIC/HEIF (some Android galleries hand these over despite the picker's
//     `accept`) is converted when the browser can decode it — Safari can,
//     Chrome can't — and otherwise left for the type check to refuse.
//   - Re-encoding drops EXIF. The photo's location travels separately, as the
//     upload's own latitude/longitude fields.
import { MAX_PHOTO_SIZE_BYTES } from './fileUpload';

export const MAX_DIMENSION = 2048;
export const MIN_DIMENSION = 1600;
// Tried in order until one fits. Quality first at full size, then smaller.
const ATTEMPTS = [
  { maxSide: MAX_DIMENSION, quality: 0.85 },
  { maxSide: MAX_DIMENSION, quality: 0.75 },
  { maxSide: MAX_DIMENSION, quality: 0.65 },
  { maxSide: MIN_DIMENSION, quality: 0.75 },
  { maxSide: MIN_DIMENSION, quality: 0.6 },
];
const PASS_THROUGH_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const CONVERTIBLE_TYPES = ['image/heic', 'image/heif'];

const typeOf = (file) => String(file?.type || '').toLowerCase();

/** Scale (width, height) so the longest side is at most `max`, keeping the aspect ratio. */
export function scaledDimensions(width, height, max = MAX_DIMENSION) {
  const longest = Math.max(width, height);
  if (!longest || longest <= max) return { width, height };
  const ratio = max / longest;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

/** Whether a file needs (and may be given) a re-encoded copy before upload. */
export function needsCompression(file, maxBytes = MAX_PHOTO_SIZE_BYTES) {
  if (!file) return false;
  const type = typeOf(file);
  if (CONVERTIBLE_TYPES.includes(type)) return true;
  return file.size > maxBytes && PASS_THROUGH_TYPES.includes(type);
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
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * The file to upload: the original when it already fits, otherwise a JPEG
 * copy of at most `maxBytes` when one can be made at a legible size, otherwise
 * the original (which the size/type check then refuses).
 *
 * @param {File} file
 * @param {{ maxBytes?: number, decode?: Function, encode?: Function }} [options]
 *   decode/encode are injectable for tests; the browser implementations are the default.
 * @returns {Promise<File>}
 */
export async function prepareUploadImage(file, { maxBytes = MAX_PHOTO_SIZE_BYTES, decode = decodeImage, encode = encodeJpeg } = {}) {
  if (!needsCompression(file, maxBytes)) return file;
  let image = null;
  try {
    image = await decode(file);
    for (const { maxSide, quality } of ATTEMPTS) {
      const blob = await encode(image, scaledDimensions(image.width, image.height, maxSide), quality);
      if (blob && blob.size > 0 && blob.size <= maxBytes) {
        const name = String(file.name || 'photo').replace(/\.[a-z0-9]+$/i, '') + '.jpg';
        return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified || Date.now() });
      }
    }
  } catch (err) {
    console.warn('[imageCompression] Could not make a smaller copy; leaving the original for the size check:', err?.message);
  } finally {
    image?.close?.();
  }
  return file;
}

export default prepareUploadImage;
