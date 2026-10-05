// src/utils/photoEmbed.js
// Fetch installation pictures so an Excel export can embed them.
//
// The links are the permanent PUBLIC /files/{token} URLs POST /uploads
// returned (see CLAUDE.md, "File uploads") — no credentials are sent or
// needed, and nothing temporary (blob:/data:) is ever used. Each link answers
// 302 to a signed URL on the storage bucket, so fetching it needs the bucket in
// the CSP's connect-src (VITE_FILE_STORAGE_ORIGIN, see vite.config.js) and CORS
// headers on the bucket. When either is missing the fetch fails and is skipped.
//
// Only JPEG and PNG are embedded — Excel can't display WebP — and the type is
// read from the file's actual bytes, not its name. Anything that can't be
// fetched, is too large, or is another format is simply not embedded; the
// workbook's "Installation Picture Link" column still carries its link, so a
// picture is never lost from the report, only not previewed.
//
// BOUNDED (2026-10-04). This step used to be an unbounded wait: a bare fetch
// per picture with no timeout, up to 300 pictures of up to 5 MB each, all held
// in memory and then written into one workbook. Once installers could upload
// real 1–3.5 MB photos, a whole-scope export meant hundreds of megabytes to
// download and embed, and one stalled request held the export on
// "Preparing…" indefinitely. Now each picture has its own timeout, the whole
// step has a time budget, and the embedded bytes are capped. Whatever doesn't
// fit is left as its link — the export always finishes.
import { mapWithConcurrency } from './concurrency';

const HTTP_URL_RE = /^https?:\/\/\S+$/i;
export const MAX_EMBEDDED_PHOTOS = 300;
const MAX_BYTES = 5 * 1024 * 1024; // the upload limit
const CONCURRENCY = 4;
/** One picture's request, start to last byte. */
export const PHOTO_FETCH_TIMEOUT_MS = 15_000;
/** The whole embedding step. Pictures not fetched by then keep only their link. */
export const PHOTO_EMBED_BUDGET_MS = 60_000;
/** Total embedded bytes — keeps the workbook small enough to build in a tab. */
export const MAX_EMBEDDED_TOTAL_BYTES = 40 * 1024 * 1024;

/** 'jpeg' | 'png' | null, from the first bytes of the file. */
export function imageExtensionOf(buffer) {
  const b = new Uint8Array(buffer.slice(0, 8));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  return null;
}

/**
 * @param {string[]} urls - picture links (duplicates and non-http values ignored)
 * @param {{ fetchImpl?: typeof fetch, max?: number, timeoutMs?: number, budgetMs?: number,
 *   maxTotalBytes?: number, onProgress?: (p: { done: number, total: number }) => void,
 *   now?: () => number }} [options]
 * @returns {Promise<{ photos: Map<string, { buffer: ArrayBuffer, extension: string }>,
 *   skipped: number, limited: boolean }>} `limited`: the time or size budget
 *   left some pictures as links only.
 */
export async function fetchPhotosForEmbedding(urls = [], {
  fetchImpl = globalThis.fetch, max = MAX_EMBEDDED_PHOTOS, timeoutMs = PHOTO_FETCH_TIMEOUT_MS,
  budgetMs = PHOTO_EMBED_BUDGET_MS, maxTotalBytes = MAX_EMBEDDED_TOTAL_BYTES, onProgress, now = Date.now,
} = {}) {
  const unique = Array.from(new Set(urls.map((u) => String(u ?? '').trim()).filter((u) => HTTP_URL_RE.test(u))));
  const wanted = unique.slice(0, max);
  const photos = new Map();
  const deadline = now() + budgetMs;
  let totalBytes = 0;
  let done = 0;
  let limited = unique.length > wanted.length;
  const tick = () => { done += 1; onProgress?.({ done, total: wanted.length }); };

  await mapWithConcurrency(wanted, CONCURRENCY, async (url) => {
    const remaining = deadline - now();
    if (remaining <= 0 || totalBytes >= maxTotalBytes) { limited = true; tick(); return; }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining)) : null;
    try {
      const res = await fetchImpl(url, { credentials: 'omit', ...(controller ? { signal: controller.signal } : {}) });
      if (!res.ok) return;
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return;
      if (totalBytes + buffer.byteLength > maxTotalBytes) { limited = true; return; }
      const extension = imageExtensionOf(buffer);
      if (extension) { photos.set(url, { buffer, extension }); totalBytes += buffer.byteLength; }
    } catch (err) {
      if (err?.name === 'AbortError') limited = true;
      console.warn('[photoEmbed] Picture not embedded (its link is still exported):', url, err?.message);
    } finally {
      if (timer) clearTimeout(timer);
      tick();
    }
  });
  return { photos, skipped: unique.length - photos.size, limited };
}

export default fetchPhotosForEmbedding;
