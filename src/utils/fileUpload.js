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

import { API_CONFIG } from '../components/services/api.config';

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
// An installation photo has the same limit as the API: 5 MB per file
// (2026-10-02; it was 1 MB from 2026-10-01). A photo over it is compressed in
// the browser first (utils/imageCompression.js), and nothing larger is sent.
//
// CAUTION — the API's nginx proxy has been measured refusing any request BODY
// over 1 MiB (1,048,576 bytes) with a 413 that carries no CORS headers, so the
// browser reports it only as "Failed to fetch". Until that proxy allows the
// documented 5 MB (client_max_body_size ≥ 6m), a photo between ~1 MB and 5 MB
// passes this check and still fails at the proxy. API_GAP_REPORT.md, gap AP.
export const MAX_PHOTO_SIZE_BYTES = MAX_FILE_SIZE_BYTES;

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
    // Only reached when compression could not bring the photo down to 5 MB.
    return { valid: false, reason: "This photo couldn't be reduced to 5 MB. Retake it or choose another photo." };
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

/**
 * How to present an upload failure, per the documented status codes.
 *
 *   400 — user-fixable ("pick a smaller file", "that's not a photo"): show the
 *         server's own message, which names the problem precisely.
 *   403 — deleting someone else's file.
 *   404 — the file is already gone.
 *   502 — the request reached the server but storage rejected/timed out it:
 *         worth retrying.
 *   503 — storage isn't configured on this deployment at all. That is an ops
 *         problem the operator cannot act on, so the raw message ("File storage
 *         not configured") is deliberately NOT shown.
 *
 * @returns {{ message: string, retryable: boolean, useServerMessage: boolean }}
 */
export function uploadFailure(status) {
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
    case 502:
      return { message: "The file couldn't be stored just now. Please try again.", retryable: true, useServerMessage: false };
    case 503:
      return { message: 'Uploads are temporarily unavailable. Please try again later or contact support.', retryable: false, useServerMessage: false };
    default:
      return { message: "The file couldn't be uploaded. Please try again.", retryable: true, useServerMessage: false };
  }
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

/**
 * The `crossOrigin` attribute to try FIRST for an <img> showing an uploaded
 * photo: 'anonymous' for one on the API's origin, otherwise none.
 *
 * The API answers every request, /files/{token} included, with
 * `Cross-Origin-Resource-Policy: same-origin`, which makes Chrome refuse a
 * plain <img> here (net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin, verified
 * 2026-10-01). CORS mode isn't subject to CORP, but then the storage bucket the
 * link redirects to must send CORS headers. components/common/UploadedPhoto.jsx
 * therefore tries this mode first and falls back to a plain <img>. Never CORS
 * mode for another host: an old pasted link may send no CORS headers, and CORS
 * mode would break an image that loads today.
 */
export function photoCrossOrigin(url, apiBase = API_CONFIG.BASE_URL) {
  try {
    return new URL(url).origin === new URL(apiBase).origin ? 'anonymous' : undefined;
  } catch {
    return undefined;
  }
}

export default {
  UPLOAD_CATEGORY,
  UPLOAD_ENTITY,
  MAX_FILES_PER_UPLOAD,
  MAX_FILE_SIZE_BYTES,
  MAX_PHOTO_SIZE_BYTES,
  acceptAttribute,
  allowedTypesLabel,
  validateUploadCandidate,
  validateUploadBatch,
  uploadFailure,
  uploadedFiles,
  photoCrossOrigin,
};
