// The installation report's required fields, and the Completed Installations
// workbook's picture link / embedded picture, built with the real ExcelJS and
// read back — the cell types Excel will actually see.
import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { COLUMN_TYPES, toCellValue, buildXlsxBuffer } from '../xlsx';
import { validateInstallationReport, buildReportPayload, REPORT_MESSAGES } from '../installationReport';
import { fetchPhotosForEmbedding, imageExtensionOf } from '../photoEmbed';

const valid = {
  meterNumber: '0239110006909', sealNumber: 'APLE0099123', installationDate: '2026-09-27',
  latitude: '5.106600', longitude: '7.366700',
  installationPhotoUrl: 'https://api.memetering.com/api/v1/files/0c0ffee0-0000-4000-8000-000000000001',
  discoSupervisor: 'Engr. Okafor', notes: '',
};

describe('validateInstallationReport', () => {
  it('accepts a complete report', () => {
    expect(validateInstallationReport(valid, { today: '2026-09-28' })).toEqual({});
  });

  it.each([
    ['meterNumber', { meterNumber: '   ' }, REPORT_MESSAGES.meterRequired],
    ['sealNumber', { sealNumber: '  ' }, 'Seal number is required.'],
    ['latitude', { latitude: '', longitude: '' }, REPORT_MESSAGES.gpsRequired],
    ['latitude', { longitude: '' }, REPORT_MESSAGES.gpsBoth],
    ['latitude', { latitude: '95' }, REPORT_MESSAGES.latitudeRange],
    ['latitude', { longitude: 'east' }, REPORT_MESSAGES.longitudeRange],
    ['latitude', { latitude: '0', longitude: '0' }, REPORT_MESSAGES.gpsZero],
    ['installationPhotoUrl', { installationPhotoUrl: '' }, REPORT_MESSAGES.photoRequired],
    ['installationPhotoUrl', { installationPhotoUrl: 'blob:https://app/123' }, REPORT_MESSAGES.photoLink],
    ['discoSupervisor', { discoSupervisor: '  ' }, REPORT_MESSAGES.supervisorRequired],
    ['installationDate', { installationDate: '2026-10-01' }, REPORT_MESSAGES.dateFuture],
  ])('rejects a bad %s', (field, change, message) => {
    expect(validateInstallationReport({ ...valid, ...change }, { today: '2026-09-28' })[field]).toBe(message);
  });

  it('format-checks only a hand-typed meter number', () => {
    expect(validateInstallationReport({ ...valid, meterNumber: '12' }).meterNumber).toBeTruthy();
    expect(validateInstallationReport({ ...valid, meterNumber: '12' }, { pickedFromList: true }).meterNumber).toBeUndefined();
  });

  it('builds the full documented body, trimmed, with the date as a plain date', () => {
    expect(buildReportPayload({ ...valid, sealNumber: ' APLE0099123 ', discoSupervisor: ' Engr. Okafor ' })).toEqual({
      meterNumber: '0239110006909', sealNumber: 'APLE0099123', latitude: 5.1066, longitude: 7.3667,
      installationPhotoUrl: valid.installationPhotoUrl, discoSupervisor: 'Engr. Okafor', installationDate: '2026-09-27',
    });
  });
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]).buffer;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]).buffer;

describe('fetchPhotosForEmbedding', () => {
  it('recognises JPEG and PNG from their bytes, and nothing else', () => {
    expect(imageExtensionOf(JPEG)).toBe('jpeg');
    expect(imageExtensionOf(PNG)).toBe('png');
    expect(imageExtensionOf(WEBP)).toBeNull();
  });

  it('fetches each public link once, without credentials, and skips what it cannot embed', async () => {
    const bodies = { 'https://x/a': JPEG, 'https://x/b': WEBP, 'https://x/c': PNG };
    const fetchImpl = vi.fn(async (url) => (url === 'https://x/404'
      ? { ok: false }
      : { ok: true, arrayBuffer: async () => bodies[url] }));
    const { photos, skipped } = await fetchPhotosForEmbedding(
      ['https://x/a', 'https://x/a', 'https://x/b', 'https://x/c', 'https://x/404', 'blob:local', '', null],
      { fetchImpl }
    );
    expect(Array.from(photos.keys()).sort()).toEqual(['https://x/a', 'https://x/c']);
    expect(skipped).toBe(2); // the WebP and the 404 — their links are still exported
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls[0][1]).toEqual({ credentials: 'omit' });
  });
});

describe('the workbook — picture link, embedded picture, identifiers', () => {
  it('writes a real hyperlink whose text is the full URL, and anchors the picture in its row', async () => {
    const url = 'https://api.memetering.com/api/v1/files/0c0ffee0-0000-4000-8000-000000000001';
    expect(toCellValue(url, COLUMN_TYPES.LINK)).toEqual({ text: url, hyperlink: url });
    expect(toCellValue('not a link', COLUMN_TYPES.LINK)).toBe('not a link');

    const buffer = await buildXlsxBuffer([{
      name: 'Completed Installations',
      columns: [
        { header: 'Account Number', key: 'account', type: COLUMN_TYPES.TEXT },
        { header: 'Meter Number', key: 'meter', type: COLUMN_TYPES.TEXT },
        { header: 'Latitude', key: 'lat', type: COLUMN_TYPES.COORDINATE },
        { header: 'Installation Picture Link', key: 'link', type: COLUMN_TYPES.LINK },
        { header: 'Installation Picture', key: 'photo', type: COLUMN_TYPES.IMAGE },
      ],
      rows: [
        { account: '0012345678', meter: '0239110006909', lat: 5.1066, link: url },
        { account: '0099', meter: '145345123456', lat: 6.5, link: null },
      ],
      images: [{ row: 0, key: 'photo', buffer: PNG, extension: 'png' }],
    }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet('Completed Installations');
    // Identifiers stay text, leading zeros intact, never scientific notation.
    expect(ws.getCell('A2').value).toBe('0012345678');
    expect(ws.getCell('B2').value).toBe('0239110006909');
    expect(ws.getCell('B3').value).toBe('145345123456');
    expect(ws.getCell('C2').value).toBeCloseTo(5.1066, 6);
    // The link: clickable, full URL as its text.
    expect(ws.getCell('D2').value).toMatchObject({ text: url, hyperlink: url });
    expect(ws.getCell('D3').value).toBeNull();
    // One picture, anchored in column E (index 4) of the first data row.
    const images = ws.getImages();
    expect(images).toHaveLength(1);
    expect(Math.floor(images[0].range.tl.nativeCol)).toBe(4);
    expect(Math.floor(images[0].range.tl.nativeRow)).toBe(1);
  });
});
