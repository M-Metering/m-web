// src/utils/fetchAllPages.js
// Generic page-loop for the API's paginated list endpoints (customer requests,
// payments, users, installer queue — all return `{ data: [...], pagination:
// { hasNext } }` and accept `page` + `limit` (max 100)). Callers that need
// "the whole dataset" (for client-side search/filter/bucketing) use this
// instead of a single call, which would silently stop at the server's
// default page size (10 for most of these endpoints, 20 for payments).
//
// Page 1 is fetched first. If its `pagination.totalPages` is known, the rest
// are fetched in parallel (bounded concurrency) instead of one round-trip at a
// time — the sequential loop was the main reason large lists (e.g. every Aba
// Power installation request) took so long. Without `totalPages` it falls back
// to following `hasNext` one page at a time.
//
// Usage: fetchAllPages((params) => jedApi.getPayments(params), { startDate })
import { unwrapListResponse } from './unwrapListResponse';

const PAGE_LIMIT = 100; // the API's documented maximum
const MAX_PAGES = 20; // default safety cap (~2000 records) against an unbounded loop
const CONCURRENCY = 4;

// `{ data: [...] }` for most endpoints, `{ data: { users: [...] } }` for users.
const extractRows = (resp) => unwrapListResponse(resp, ['users', 'meters']);

// Most endpoints put `pagination` at the top level; GET /meters has been seen
// nesting it under `data` and using `pages`/`total` — see MeterSchedule.jsx.
const readPagination = (resp) => {
  const p = resp?.pagination || resp?.data?.pagination || {};
  return {
    hasNext: p.hasNext,
    totalPages: p.totalPages ?? p.pages,
    totalCount: p.totalCount ?? p.total,
  };
};

const positiveInt = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Like fetchAllPages, but also reports whether the result is complete.
 *
 * @param {(params: object) => Promise<any>} fetchPage
 * @param {object} params - query params sent with every page
 * @param {{ maxPages?: number, inferNextFromFullPage?: boolean }} options
 *   inferNextFromFullPage: when the endpoint omits `hasNext`, treat a full
 *   page as "there may be more" (needed for GET /meters).
 * @returns {Promise<{ items: any[], totalCount: number|null, truncated: boolean }>}
 *   `totalCount` is the server's own count when it reports one; `truncated`
 *   is true when the page cap stopped the loop before the last page.
 */
export async function fetchAllPagesDetailed(fetchPage, params = {}, { maxPages = MAX_PAGES, inferNextFromFullPage = false } = {}) {
  const hasNextOf = (resp, rows) => {
    const { hasNext } = readPagination(resp);
    if (hasNext !== undefined && hasNext !== null) return !!hasNext;
    return inferNextFromFullPage && rows.length >= PAGE_LIMIT;
  };

  const first = await fetchPage({ ...params, page: 1, limit: PAGE_LIMIT });
  const items = [...extractRows(first)];
  const pagination = readPagination(first);
  const totalCount = pagination.totalCount !== undefined && pagination.totalCount !== null
    && Number.isFinite(Number(pagination.totalCount))
    ? Number(pagination.totalCount)
    : null;

  if (items.length === 0 || !hasNextOf(first, items)) {
    return { items, totalCount, truncated: false };
  }

  const totalPages = positiveInt(pagination.totalPages);

  if (totalPages) {
    const lastPage = Math.min(totalPages, maxPages);
    const pages = [];
    for (let p = 2; p <= lastPage; p += 1) pages.push(p);

    // Keep page order stable regardless of which request finishes first.
    const results = new Array(pages.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < pages.length) {
        const index = cursor;
        cursor += 1;
        const resp = await fetchPage({ ...params, page: pages[index], limit: PAGE_LIMIT });
        results[index] = extractRows(resp);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, worker));
    results.forEach((rows) => items.push(...rows));
    return { items, totalCount, truncated: totalPages > maxPages };
  }

  // No totalPages reported — follow hasNext sequentially.
  let page = 2;
  let hasNext = true;
  while (hasNext && page <= maxPages) {
    const resp = await fetchPage({ ...params, page, limit: PAGE_LIMIT });
    const rows = extractRows(resp);
    if (rows.length === 0) { hasNext = false; break; }
    items.push(...rows);
    hasNext = hasNextOf(resp, rows);
    page += 1;
  }
  return { items, totalCount, truncated: hasNext };
}

export async function fetchAllPages(fetchPage, params = {}, options = {}) {
  const { items } = await fetchAllPagesDetailed(fetchPage, params, options);
  return items;
}

export default fetchAllPages;
