// src/utils/photoEmbed.js
// Fetch installation pictures so an Excel export can embed them.
//
// The links are the permanent PUBLIC /files/{token} URLs POST /uploads
// returned (see CLAUDE.md, "File uploads") — no credentials are sent or
// needed, and nothing temporary (blob:/data:) is ever used. The CSP's
// connect-src already allows the API host these live on.
//
// Only JPEG and PNG are embedded — Excel can't display WebP — and the type is
// read from the file's actual bytes, not its name. Anything that can't be
// fetched, is too large, or is another format is simply not embedded; the
// workbook's "Installation Picture Link" column still carries its link, so a
// picture is never lost from the report, only not previewed.
import { mapWithConcurrency } from './concurrency';

const HTTP_URL_RE = /^https?:\/\/\S+$/i;
export const MAX_EMBEDDED_PHOTOS = 300;
const MAX_BYTES = 5 * 1024 * 1024; // the upload limit
const CONCURRENCY = 4;

/** 'jpeg' | 'png' | null, from the first bytes of the file. */
export function imageExtensionOf(buffer) {
  const b = new Uint8Array(buffer.slice(0, 8));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  return null;
}

/**
 * @param {string[]} urls - picture links (duplicates and non-http values ignored)
 * @param {{ fetchImpl?: typeof fetch, max?: number }} [options]
 * @returns {Promise<{ photos: Map<string, { buffer: ArrayBuffer, extension: string }>, skipped: number }>}
 */
export async function fetchPhotosForEmbedding(urls = [], { fetchImpl = globalThis.fetch, max = MAX_EMBEDDED_PHOTOS } = {}) {
  const unique = Array.from(new Set(urls.map((u) => String(u ?? '').trim()).filter((u) => HTTP_URL_RE.test(u))));
  const wanted = unique.slice(0, max);
  const photos = new Map();
  await mapWithConcurrency(wanted, CONCURRENCY, async (url) => {
    try {
      const res = await fetchImpl(url, { credentials: 'omit' });
      if (!res.ok) return;
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return;
      const extension = imageExtensionOf(buffer);
      if (extension) photos.set(url, { buffer, extension });
    } catch (err) {
      console.warn('[photoEmbed] Picture not embedded (its link is still exported):', url, err?.message);
    }
  });
  return { photos, skipped: unique.length - photos.size };
}

export default fetchPhotosForEmbedding;
