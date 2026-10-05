// src/utils/fileUpload.js
// The rules around POST /uploads (general-purpose file storage, 2026-09-25).
//
// Everything here is a CLIENT-SIDE pre-check, exactly like fileValidation.js:
// it fails fast in the browser instead of after a slow upload. The server is
// the real gate, and it is stricter than this can be — it verifies a file's
// type from its actual BYTES, not its name or the browser-supplied mimetype,
// so a .txt renamed to .jpg is rejected there even though it passes here.
// Never present a client-side pass as "the file is valid".
//
// Batch semantics: all files are verified before any is stored, and all rows
// are written in one transaction. One bad file fails the whole request and
// nothing partial is saved — so a failed upload never needs cleaning up.


/** Documented categories. `category` is free text; these are the ones we send. */
export const UPLOAD_CATEGORY = Object.freeze({
  INSTALLATION_PHOTO: 'installation_photo',
  GENERAL: 'general',
});

/** Documented entity types, used for the `GET /uploads?entityType=&entityId=` lookup. */
export const UPLOAD_ENTITY = Object.freeze({
  INSTALLATION: 'installation',
});

export const MAX_FILES_PER_UPLOAD = 5;
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
// THE limit for an installation photo: 3.5 MiB (3,670,016 bytes), the one
// value the whole photo pipeline uses (2026-10-02). It leaves 1.5 MB of headroom
// under the API's 5 MB per-file limit. A photo within it is uploaded as it is;
// a larger one is compressed in the browser first (utils/imageCompression.js),
// and nothing larger is ever sent.
export const MAX_PHOTO_SIZE_BYTES = 3.5 * 1024 * 1024;

// The size of the ONE smaller retry (shouldRetrySmaller) after a large photo's
// upload got no response at all.
//
// Why it exists: until 2026-10-02 the API's nginx refused any request BODY over
// 1 MiB with a 413 carrying no CORS headers, which the browser reports only as
// a failed request. That is why photos up to ~910 KB uploaded and larger ones
// failed (API_GAP_REPORT.md, gap AP). Measured again on 2026-10-02 the proxy
// accepted 10 MB bodies, so that limit is gone. The retry stays because the
// same symptom (no response) is also what a dropped or timed-out upload on a
// weak mobile link looks like, and a ~1 MB photo takes a quarter of the time
// of a 3.5 MB one. 1,000,000 bytes also fits under the old 1 MiB limit, with
// ~48 KB left for the multipart headers and form fields, should it ever return.
export const RETRY_PHOTO_SIZE_BYTES = 1000 * 1000;

// The server checks real bytes; these are the matching extension/mime hints for
// the file picker and the fail-fast check. installation_photo is images only —
// no PDF — which is the one place the two categories differ.
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const GENERAL_TYPES = [...PHOTO_TYPES, 'application/pdf'];
const GENERAL_EXTENSIONS = [...PHOTO_EXTENSIONS, '.pdf'];

const isPhotoCategory = (category) => category === UPLOAD_CATEGORY.INSTALLATION_PHOTO;

/** The `accept` attribute for a file input in this category. */
export const acceptAttribute = (category) =>
  (isPhotoCategory(category) ? [...PHOTO_TYPES, ...PHOTO_EXTENSIONS] : [...GENERAL_TYPES, ...GENERAL_EXTENSIONS]).join(',');

/** What the category allows, phrased for a hint under the picker. */
export const allowedTypesLabel = (category) =>
  isPhotoCategory(category) ? 'JPEG, PNG or WebP' : 'JPEG, PNG, WebP or PDF';

const extensionOf = (name) => {
  const match = String(name || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
};

/**
 * Fail-fast check for one chosen file.
 *
 * @param {File|null} file
 * @param {string} [category]
 * @returns {{ valid: boolean, reason: string|null }}
 */
export function validateUploadCandidate(file, category = UPLOAD_CATEGORY.GENERAL) {
  if (!file) return { valid: false, reason: 'No file selected.' };
  if (file.size === 0) return { valid: false, reason: 'The selected file is empty.' };

  if (isPhotoCategory(category) && file.size > MAX_PHOTO_SIZE_BYTES) {
    // Only reached when compression could not bring the photo within the limit.
    return { valid: false, reason: PHOTO_PROCESSING_MESSAGES.tooLarge };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return { valid: false, reason: `That file is ${mb} MB — each file must be 5 MB or smaller.` };
  }

  const allowedTypes = isPhotoCategory(category) ? PHOTO_TYPES : GENERAL_TYPES;
  const allowedExtensions = isPhotoCategory(category) ? PHOTO_EXTENSIONS : GENERAL_EXTENSIONS;
  const type = String(file.type || '').toLowerCase();
  const extension = extensionOf(file.name);

  // A browser sometimes reports no type at all; fall back to the extension
  // rather than rejecting a file the server would happily accept.
  const typeOk = type ? allowedTypes.includes(type) : allowedExtensions.includes(extension);
  if (!typeOk) {
    return { valid: false, reason: `That file type isn't accepted here — use ${allowedTypesLabel(category)}.` };
  }

  return { valid: true, reason: null };
}

/** The same check across a batch, plus the count limit. */
export function validateUploadBatch(files, category = UPLOAD_CATEGORY.GENERAL) {
  const list = Array.from(files || []);
  if (list.length === 0) return { valid: false, reason: 'No file selected.' };
  if (list.length > MAX_FILES_PER_UPLOAD) {
    return { valid: false, reason: `Too many files — upload at most ${MAX_FILES_PER_UPLOAD} at a time.` };
  }
  for (const file of list) {
    const result = validateUploadCandidate(file, category);
    if (!result.valid) return result;
  }
  return { valid: true, reason: null };
}

/** The installer-facing messages for a photo that never reached the upload. */
export const PHOTO_PROCESSING_MESSAGES = Object.freeze({
  unprocessable: 'Unable to process this image. Choose another photo.',
  tooLarge: 'Image could not be reduced to the required size. Please choose another image.',
});

/**
 * How to present an upload failure.
 *
 *   no status — nothing came back: a dropped connection, a timeout, or the API
 *         proxy's CORS-less 413. A connection problem to the installer.
 *   400 — user-fixable ("that's not a photo"): the server's own message, which
 *         names the problem precisely (getErrorMessage still filters it).
 *   401 — the session expired; retrying can't fix it.
 *   403 — deleting someone else's file.   404 — the file is already gone.
 *   413 — too large for the server (only seen if the proxy ever sends CORS).
 *   503 — storage isn't configured on this deployment. An ops problem the
 *         operator can't act on, so the raw message is NOT shown.
 *   any other — the server refused it.
 *
 * @param {number|undefined} status
 * @returns {{ message: string, retryable: boolean, useServerMessage: boolean }}
 */
export function uploadFailure(status) {
  if (status === undefined || status === null) {
    return { message: 'Image upload failed. Check your connection and try again.', retryable: true, useServerMessage: false };
  }
  switch (Number(status)) {
    case 400:
      return { message: null, retryable: false, useServerMessage: true };
    case 401:
      // An expired session. Retrying can't fix it, and saying "try again"
      // sent installers round in circles.
      return { message: 'Your session has expired. Sign in again, then add the photo.', retryable: false, useServerMessage: false };
    case 403:
      return { message: 'You can only delete files you uploaded.', retryable: false, useServerMessage: false };
    case 404:
      return { message: 'That file no longer exists.', retryable: false, useServerMessage: false };
    case 413:
      return { message: PHOTO_PROCESSING_MESSAGES.tooLarge, retryable: false, useServerMessage: false };
    case 503:
      return { message: 'Uploads are temporarily unavailable. Please try again later or contact support.', retryable: false, useServerMessage: false };
    default:
      return { message: 'Image upload was rejected by the server. Please try again.', retryable: true, useServerMessage: false };
  }
}

/**
 * Whether a failed photo upload should be retried ONCE, compressed to
 * RETRY_PHOTO_SIZE_BYTES. Only when the photo sent was larger than that, and
 * the request got no answer — dropped (NETWORK), timed out (UPLOAD_TIMEOUT) —
 * or was refused as too large (413). A real HTTP answer (400, 401, 5xx) is the
 * server's verdict and a smaller file wouldn't change it.
 *
 * @param {{ status?: number, code?: string }} err
 * @param {number} sentBytes - size of the photo that was sent
 */
export function shouldRetrySmaller(err, sentBytes) {
  if (!(sentBytes > RETRY_PHOTO_SIZE_BYTES)) return false;
  if (err?.status === 413) return true;
  return err?.status == null && (err?.code === 'NETWORK' || err?.code === 'UPLOAD_TIMEOUT');
}

/**
 * The stored file records from an upload/list response, in order.
 * `url` is the only field to keep for display or to submit back to the API —
 * `id` works solely on the authenticated /uploads/:id routes, and `storageKey`
 * is internal bookkeeping.
 */
export function uploadedFiles(response) {
  const data = response?.data ?? response;
  const list = Array.isArray(data) ? data : [];
  return list
    .map((row) => ({
      id: row?.id ?? null,
      url: row?.url || null,
      originalName: row?.originalName || null,
      contentType: row?.contentType || null,
      sizeBytes: Number(row?.sizeBytes) || 0,
      category: row?.category || null,
      capturedAt: row?.capturedAt || null,
      createdAt: row?.createdAt || null,
      uploadedBy: row?.uploadedBy || null,
    }))
    .filter((row) => row.url);
}

export default {
  UPLOAD_CATEGORY,
  UPLOAD_ENTITY,
  MAX_FILES_PER_UPLOAD,
  MAX_FILE_SIZE_BYTES,
  MAX_PHOTO_SIZE_BYTES,
  RETRY_PHOTO_SIZE_BYTES,
  PHOTO_PROCESSING_MESSAGES,
  shouldRetrySmaller,
  acceptAttribute,
  allowedTypesLabel,
  validateUploadCandidate,
  validateUploadBatch,
  uploadFailure,
  uploadedFiles,
};
