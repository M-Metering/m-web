// src/utils/imageCompression.js
// Bring an installation photo within MAX_PHOTO_SIZE_BYTES (3.5 MiB) BEFORE it
// is sent to POST /uploads. Camera and gallery both come through here.
//
// History: the target was 5 MB from 2026-09-28, 1 MB on 2026-10-01, 5 MB again
// on 2026-10-02 morning, and 3.5 MiB since (1.5 MB of headroom under the API).
//
// Rules:
//   - A JPEG/PNG/WebP already within the limit is sent UNCHANGED (byte for byte):
//     no needless recompression, no quality lost.
//   - Anything larger is re-encoded as JPEG, adaptively: quality steps down
//     first at (near) full size, then the size steps down, re-checking after
//     every pass and stopping at the first copy that fits. The floor is 1600 px
//     on the long side at quality 0.6, where a meter's digits and seal stay
//     legible; below that the photo is refused rather than made useless.
//   - Never wider/taller than MAX_DIMENSION (4032 px, a 12 MP phone's native
//     width). iOS Safari refuses canvases over ~16.7 million pixels, so a 48 MP
//     photo (8000×6000) drawn at full size produced NO image there. 4032×3024
//     is 12.2 MP; even a square 4032² is 16.3 MP.
//   - Orientation: createImageBitmap(…, { imageOrientation: 'from-image' })
//     applies the EXIF rotation while decoding, so the pixels are written
//     upright and the output needs no EXIF (re-encoding drops it). A photo sent
//     unchanged keeps its EXIF orientation for the viewer to apply.
//   - JPEG, not WebP: the Completed Installations export embeds the picture and
//     Excel embeds only JPEG/PNG (utils/photoEmbed.js). A transparent PNG is
//     flattened onto white; an installation photo has no use for transparency.
//   - HEIC/HEIF is always converted when the browser can decode it (Safari can,
//     Chrome can't); otherwise it is reported as unprocessable.
//   - The photo's location travels separately, as the upload's own
//     latitude/longitude fields.
import { MAX_PHOTO_SIZE_BYTES } from './fileUpload';

export const MAX_DIMENSION = 4032;
export const MIN_DIMENSION = 1600;
// Tried in order until one fits: quality first at the largest size, then
// smaller sizes. Pure arithmetic per attempt; one decode for all of them.
export const COMPRESSION_ATTEMPTS = Object.freeze([
  { maxSide: MAX_DIMENSION, quality: 0.92 },
  { maxSide: MAX_DIMENSION, quality: 0.85 },
  { maxSide: MAX_DIMENSION, quality: 0.78 },
  { maxSide: 3072, quality: 0.85 },
  { maxSide: 3072, quality: 0.75 },
  { maxSide: 2048, quality: 0.8 },
  { maxSide: 2048, quality: 0.7 },
  { maxSide: MIN_DIMENSION, quality: 0.7 },
  { maxSide: MIN_DIMENSION, quality: 0.6 },
]);
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
  // Older browsers: an <img> applies EXIF orientation by default
  // (image-orientation: from-image) and drawImage honours it.
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
  return new Promise((resolve) => canvas.toBlob((blob) => {
    // Release the backing store now: mobile browsers cap total canvas memory.
    canvas.width = 0;
    canvas.height = 0;
    resolve(blob);
  }, 'image/jpeg', quality));
}

/**
 * The file to upload, and what happened to it.
 *
 *   'unchanged'     — already within `maxBytes`: the original File, untouched.
 *   'compressed'    — a new JPEG File of at most `maxBytes`.
 *   'too-large'     — no legible copy fits; `file` is the original.
 *   'unprocessable' — the browser couldn't decode or encode it; `file` is the original.
 *
 * Always a File (never a bare Blob), so FormData sends a filename and type.
 *
 * @param {File} file
 * @param {{ maxBytes?: number, decode?: Function, encode?: Function }} [options]
 *   decode/encode are injectable for tests; the browser implementations are the default.
 * @returns {Promise<{ file: File, outcome: 'unchanged'|'compressed'|'too-large'|'unprocessable' }>}
 */
export async function prepareUploadImage(file, { maxBytes = MAX_PHOTO_SIZE_BYTES, decode = decodeImage, encode = encodeJpeg } = {}) {
  if (!needsCompression(file, maxBytes)) return { file, outcome: 'unchanged' };
  let image = null;
  let encodedAny = false;
  try {
    image = await decode(file);
    for (const { maxSide, quality } of COMPRESSION_ATTEMPTS) {
      const blob = await encode(image, scaledDimensions(image.width, image.height, maxSide), quality);
      if (!blob || blob.size === 0) continue;
      encodedAny = true;
      if (blob.size <= maxBytes) {
        const name = String(file.name || 'photo').replace(/\.[a-z0-9]+$/i, '') + '.jpg';
        return {
          file: new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified || Date.now() }),
          outcome: 'compressed',
        };
      }
    }
  } catch (err) {
    console.warn('[imageCompression] Could not process the image:', err?.message);
  } finally {
    image?.close?.();
  }
  return { file, outcome: encodedAny ? 'too-large' : 'unprocessable' };
}

export default prepareUploadImage;
