import { describe, it, expect, vi } from 'vitest';
import { fetchAllPages, fetchAllPagesDetailed } from '../fetchAllPages';

/** Fake paginated endpoint: `total` rows, 100 per page, with or without totalPages. */
const endpoint = (total, { reportTotalPages = true, delays = {} } = {}) => {
  const pages = Math.max(1, Math.ceil(total / 100));
  return vi.fn(async ({ page, limit }) => {
    if (delays[page]) await new Promise((r) => setTimeout(r, delays[page]));
    const start = (page - 1) * limit;
    const data = Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, i) => ({ id: start + i + 1 }));
    return {
      data,
      pagination: {
        currentPage: page,
        hasNext: page < pages,
        totalCount: total,
        ...(reportTotalPages ? { totalPages: pages } : {}),
      },
    };
  });
};

describe('fetchAllPagesDetailed', () => {
  it('returns every record in order even when later pages finish first', async () => {
    const fetchPage = endpoint(450, { delays: { 2: 30, 3: 5 } });
    const { items, totalCount, truncated } = await fetchAllPagesDetailed(fetchPage);
    expect(items.map((r) => r.id)).toEqual(Array.from({ length: 450 }, (_, i) => i + 1));
    expect(totalCount).toBe(450);
    expect(truncated).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(5);
  });

  it('passes the caller params and the max page size on every call', async () => {
    const fetchPage = endpoint(150);
    await fetchAllPagesDetailed(fetchPage, { discoCode: 'ABA_POWER' });
    fetchPage.mock.calls.forEach(([params]) => {
      expect(params.discoCode).toBe('ABA_POWER');
      expect(params.limit).toBe(100);
    });
  });

  it('reports truncation when the page cap is hit', async () => {
    const fetchPage = endpoint(1000);
    const { items, truncated } = await fetchAllPagesDetailed(fetchPage, {}, { maxPages: 3 });
    expect(items).toHaveLength(300);
    expect(truncated).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('follows hasNext sequentially when totalPages is not reported', async () => {
    const fetchPage = endpoint(250, { reportTotalPages: false });
    const { items, truncated } = await fetchAllPagesDetailed(fetchPage);
    expect(items).toHaveLength(250);
    expect(truncated).toBe(false);
  });

  it('flags truncation in the sequential fallback too', async () => {
    const fetchPage = endpoint(500, { reportTotalPages: false });
    const { items, truncated } = await fetchAllPagesDetailed(fetchPage, {}, { maxPages: 2 });
    expect(items).toHaveLength(200);
    expect(truncated).toBe(true);
  });

  it('handles an empty first page', async () => {
    const { items, truncated } = await fetchAllPagesDetailed(endpoint(0));
    expect(items).toEqual([]);
    expect(truncated).toBe(false);
  });

  it('propagates a failing page instead of returning a partial list', async () => {
    const fetchPage = vi.fn(async ({ page }) => {
      if (page === 2) throw new Error('boom');
      return { data: [{ id: 1 }], pagination: { hasNext: true, totalPages: 3 } };
    });
    await expect(fetchAllPagesDetailed(fetchPage)).rejects.toThrow('boom');
  });
});

describe('fetchAllPages (existing callers)', () => {
  it('still returns a plain array, capped at 20 pages by default', async () => {
    const items = await fetchAllPages(endpoint(2500));
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(2000);
  });

  it('unwraps the users envelope', async () => {
    const items = await fetchAllPages(async () => ({ data: { users: [{ id: 'u1' }] }, pagination: { hasNext: false } }));
    expect(items).toEqual([{ id: 'u1' }]);
  });
});
