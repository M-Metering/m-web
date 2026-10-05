import { describe, it, expect, vi, afterEach } from 'vitest';
import { revertTargetOf, revertBlockReason } from '../installationRevert';
import { normalizeMultiRow, normalizeJedRow, JED_BUCKET } from '../installationScope';
import { openJobsForMeter } from '../installerStats';
import { fetchPhotosForEmbedding } from '../photoEmbed';
import { withDeadline } from '../concurrency';

const JOB = {
  id: 9, accountNumber: '0239110', customerName: 'DONE JOB', discoCode: 'ABA_POWER', status: 'INSTALLED',
  meterType: 'SINGLE PHASE', meterNumber: '0014534526919', installationDate: '2026-09-20', assigneeName: 'Musa Bello',
};

describe('unassigning an installed meter (POST /installations/:id/revert)', () => {
  it('names the customer, account, meter, installer and installation date of an INSTALLED imported job', () => {
    expect(revertTargetOf(normalizeMultiRow(JOB))).toEqual({
      id: 9, accountNumber: '0239110', customerName: 'DONE JOB', meterNumber: '0014534526919',
      installerName: 'Musa Bello', installationDate: '2026-09-20', disco: 'ABA_POWER',
    });
  });

  it('keeps the account and meter numbers as exact strings', () => {
    const t = revertTargetOf(normalizeMultiRow({ ...JOB, accountNumber: '0001', meterNumber: '0014534526919' }));
    expect(t.accountNumber).toBe('0001');
    expect(t.meterNumber).toBe('0014534526919');
  });

  it('refuses EXPORTED (the API answers 409), every non-installed status, and JED requests', () => {
    expect(revertTargetOf(normalizeMultiRow({ ...JOB, status: 'EXPORTED' }))).toBeNull();
    expect(revertBlockReason(normalizeMultiRow({ ...JOB, status: 'EXPORTED' }))).toMatch(/exported/i);
    ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'FAILED', 'CANCELLED'].forEach((status) => {
      expect(revertTargetOf(normalizeMultiRow({ ...JOB, status }))).toBeNull();
    });
    const jed = normalizeJedRow({ id: 4, accountNumber: '477015', status: 'COMPLETED', meterNo: '0239110006909' }, JED_BUCKET);
    expect(revertTargetOf(jed)).toBeNull();
    expect(revertBlockReason(jed)).toMatch(/JED Remita/);
  });
});

describe('openJobsForMeter — the jobs a held meter is for (meters and jobs are not paired)', () => {
  const row = {
    jobs: [
      { id: 1, status: 'ASSIGNED', meterType: 'THREE PHASE' },
      { id: 2, status: 'IN_PROGRESS', meterType: '3 Phase' },
      { id: 3, status: 'ASSIGNED', meterType: 'SINGLE PHASE' },
      { id: 4, status: 'INSTALLED', meterType: 'THREE PHASE' },
      { id: 5, status: 'FAILED', meterType: 'THREE PHASE' },
      { id: 6, status: 'ASSIGNED', meterType: null },
    ],
  };
  it('open jobs of the same canonical type, plus jobs with no recorded type', () => {
    expect(openJobsForMeter(row, { phaseType: 'THREE_PHASE' }).map((j) => j.id)).toEqual([1, 2, 6]);
    expect(openJobsForMeter(row, { phaseType: 'SINGLE PHASE' }).map((j) => j.id)).toEqual([3, 6]);
  });
  it('a meter with no recorded type matches every open job', () => {
    expect(openJobsForMeter(row, { phaseType: null }).map((j) => j.id)).toEqual([1, 2, 3, 6]);
  });
});

const JPEG = (size = 8) => { const b = new Uint8Array(size); b.set([0xff, 0xd8, 0xff, 0xe0]); return b.buffer; };

describe('fetchPhotosForEmbedding — bounded, so an export always finishes', () => {
  afterEach(() => vi.useRealTimers());

  it('aborts a picture that never answers and still resolves', async () => {
    const fetchImpl = vi.fn((url, { signal }) => new Promise((resolve, reject) => {
      if (url.endsWith('/ok')) { resolve({ ok: true, arrayBuffer: async () => JPEG() }); return; }
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const result = await fetchPhotosForEmbedding(['https://x/hang', 'https://x/ok'], { fetchImpl, timeoutMs: 20 });
    expect(Array.from(result.photos.keys())).toEqual(['https://x/ok']);
    expect(result.limited).toBe(true);
  });

  it('stops starting new pictures once the time budget is spent', async () => {
    let clock = 0;
    const fetchImpl = vi.fn(async () => { clock += 600; return { ok: true, arrayBuffer: async () => JPEG() }; });
    const urls = Array.from({ length: 20 }, (_, i) => `https://x/${i}`);
    const result = await fetchPhotosForEmbedding(urls, { fetchImpl, budgetMs: 1000, now: () => clock });
    expect(fetchImpl.mock.calls.length).toBeLessThan(urls.length);
    expect(result.limited).toBe(true);
    expect(result.photos.size + result.skipped).toBe(urls.length);
  });

  it('caps the total embedded bytes; the rest keep only their link', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, arrayBuffer: async () => JPEG(1000) }));
    const urls = ['https://x/1', 'https://x/2', 'https://x/3', 'https://x/4'];
    const result = await fetchPhotosForEmbedding(urls, { fetchImpl, maxTotalBytes: 2500 });
    expect(result.photos.size).toBe(2);
    expect(result.limited).toBe(true);
  });

  it('reports progress for every picture, embedded or not', async () => {
    const progress = [];
    const fetchImpl = vi.fn(async (url) => (url.endsWith('bad') ? { ok: false } : { ok: true, arrayBuffer: async () => JPEG() }));
    await fetchPhotosForEmbedding(['https://x/a', 'https://x/bad'], { fetchImpl, onProgress: (p) => progress.push(p) });
    expect(progress.at(-1)).toEqual({ done: 2, total: 2 });
  });
});

describe('withDeadline', () => {
  it('returns the result when it arrives in time, the fallback when it does not', async () => {
    expect(await withDeadline(Promise.resolve('data'), 50, null)).toBe('data');
    expect(await withDeadline(new Promise(() => {}), 10, 'late')).toBe('late');
  });
  it('still rejects with a real error that arrives in time', async () => {
    await expect(withDeadline(Promise.reject(new Error('boom')), 50, null)).rejects.toThrow('boom');
  });
});
