import { describe, it, expect } from 'vitest';
import { completedExportOf } from '../importCompletedExport';

const NOW = new Date('2026-10-12T12:00:00.000Z');

describe('completedExportOf', () => {
  it('offers nothing when the import found no completed accounts', () => {
    expect(completedExportOf({ created: 2, completedExport: null }, NOW)).toBeNull();
    expect(completedExportOf({ created: 2 }, NOW)).toBeNull();
    expect(completedExportOf(null, NOW)).toBeNull();
  });

  it('reads the download straight from completedExport', () => {
    expect(completedExportOf({
      completedExport: {
        rowCount: 3,
        fileName: 'completed-installations-aba-power-2026-10-12.xlsx',
        downloadUrl: 'https://api.memetering.com/api/v1/imports/completed-exports/0c1d',
        expiresAt: '2026-10-19T11:36:58.410Z',
      },
    }, NOW)).toEqual({
      rowCount: 3,
      url: 'https://api.memetering.com/api/v1/imports/completed-exports/0c1d',
      fileName: 'completed-installations-aba-power-2026-10-12.xlsx',
      expiresAt: '2026-10-19T11:36:58.410Z',
      expired: false,
    });
  });

  it('says when the 7-day link has expired', () => {
    const out = completedExportOf({
      completedExport: { rowCount: 1, downloadUrl: 'https://x.test/t', expiresAt: '2026-10-01T00:00:00.000Z' },
    }, NOW);
    expect(out.expired).toBe(true);
  });

  it('offers nothing for a completedExport without a link', () => {
    expect(completedExportOf({ completedExport: { rowCount: 4 } }, NOW)).toBeNull();
  });

  it('never offers a link that is not http(s)', () => {
    expect(completedExportOf({ completedExport: { rowCount: 1, downloadUrl: 'javascript:alert(1)' } }, NOW)).toBeNull();
  });
});
