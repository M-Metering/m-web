// src/utils/concurrency.js
// Run an async function over a list with at most `limit` calls in flight,
// keeping results in input order. Used wherever the API offers only a
// per-record read (batch details, exact meter lookups) so the browser never
// fires an unbounded burst of requests.

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>} rejects on the first failure, like Promise.all
 */
export async function mapWithConcurrency(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(list[index], index);
    }
  };
  const workers = Math.max(1, Math.min(limit, list.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

export default mapWithConcurrency;
