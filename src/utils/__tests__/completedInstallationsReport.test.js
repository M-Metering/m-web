import { describe, it, expect } from 'vitest';
import { normalizeMultiRow, normalizeJedRow, JED_BUCKET } from '../installationScope';
import {
  isCompletedRow, completionDateOf, filterByCompletionDate, buildMeterIndex, buildCompletedInstallationsReport,
  completionRecognisedAt,
} from '../completedInstallationsReport';

const multi = (over) => normalizeMultiRow({
  id: 1, accountNumber: '0100', customerName: 'ADA OBI', customerPhone: '08149454601', discoCode: 'ABA_POWER',
  status: 'INSTALLED', meterType: 'SINGLE PHASE', feederName: 'ABA GRA 11KV', transformerName: 'JOHNSON',
  installationPosition: 'HIGH WALL', meterNumber: '0239110006909', sealNumber: 'APLE0099123',
  installationDate: '2026-09-07', reportedAt: '2026-09-07T15:00:00Z', installerName: 'Musa Bello',
  assignedTo: '3904aad1-2f27-42d1-9c33-fe87502ea594', latitude: 5.1066, longitude: 7.3667,
  createdAt: '2026-09-01T09:00:00Z', ...over,
});
const jed = (over) => normalizeJedRow({
  id: 11, accountNumber: '477014', custNames: 'ABUTU AUGUSTINE', gsm: '+2348036233685', discoCode: 'JED001',
  status: 'COMPLETED', amount: 67000, rrr: '120799142825', requestRef: 'REF123456', meterType: 'Three Phase',
  meterNo: '0123456789012', sealNo: '9900', dateRequested: '2026-08-01T00:00:00Z',
  datePaid: '2026-08-02T00:00:00Z', dateCompleted: '2026-09-05T10:00:00Z', ...over,
}, JED_BUCKET);

const context = { scopeLabel: 'All discos', filters: [], generatedAt: new Date('2026-09-21T12:00:00Z'), meterDetails: '' };

describe('completed rows', () => {
  it('uses each domain\'s own completed statuses', () => {
    expect(isCompletedRow(multi({ status: 'INSTALLED' }))).toBe(true);
    expect(isCompletedRow(multi({ status: 'EXPORTED' }))).toBe(true);
    expect(isCompletedRow(multi({ status: 'IN_PROGRESS' }))).toBe(false);
    expect(isCompletedRow(jed({ status: 'COMPLETED' }))).toBe(true);
    expect(isCompletedRow(jed({ status: 'PAID' }))).toBe(false);
  });

  it('takes the completion date from the right field and filters by it', () => {
    expect(completionDateOf(multi())).toBe('2026-09-07');
    expect(completionDateOf(multi({ installationDate: null }))).toBe(new Date('2026-09-07T15:00:00Z').toLocaleDateString('en-CA'));
    const rows = [multi(), jed()];
    expect(filterByCompletionDate(rows, '2026-09-06', '')).toHaveLength(1);
    expect(filterByCompletionDate(rows, '', '')).toHaveLength(2);
  });
});

describe("completionRecognisedAt — the finance API's revenueAt, for the Supervisor trend", () => {
  it('dates an imported job by when it was reported, not its typed installation date', () => {
    expect(completionRecognisedAt(multi({ installationDate: '2026-09-01', reportedAt: '2026-10-05T09:30:00Z' })))
      .toBe('2026-10-05T09:30:00Z');
  });
  it('falls back to the installation date only when the report time is missing', () => {
    const d = completionRecognisedAt(multi({ installationDate: '2026-09-07', reportedAt: null }));
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 9, 7]);
  });
  it('dates a JED request as the API does: paid, else completed, else requested', () => {
    expect(completionRecognisedAt(jed())).toBe('2026-08-02T00:00:00Z');
    expect(completionRecognisedAt(jed({ datePaid: null }))).toBe('2026-09-05T10:00:00Z');
    expect(completionRecognisedAt(jed({ datePaid: null, dateCompleted: null }))).toBe('2026-08-01T00:00:00Z');
  });
});

describe('buildCompletedInstallationsReport', () => {
  const meterIndex = buildMeterIndex([
    { meterNumber: '0239110006909', simNumber: '8923401000012345678', meterMake: 'MASTER ENERGY', phaseType: 'SINGLE PHASE', status: 'INSTALLED' },
  ]);

  it('includes only completed installations, one row each, newest first', () => {
    const { sheets, count } = buildCompletedInstallationsReport({
      rows: [jed(), multi(), multi({ id: 2, status: 'PENDING' }), jed({ accountNumber: '9', status: 'PAID' })],
      meterIndex,
      context,
    });
    expect(count).toBe(2);
    const rows = sheets[0].rows;
    expect(rows.map((r) => r.installationId)).toEqual([1, 11]);
  });

  it('maps customer, payment, installer and meter fields, and keeps identifiers as strings', () => {
    const { sheets } = buildCompletedInstallationsReport({ rows: [multi(), jed()], meterIndex, context });
    const [m, j] = sheets[0].rows;
    expect(m).toMatchObject({
      source: 'Imported job', disco: 'ABA_POWER', accountNumber: '0100', customerPhone: '08149454601',
      meterNumber: '0239110006909', sealNumber: 'APLE0099123', installerName: 'Musa Bello',
      feederName: 'ABA GRA 11KV', installationDate: '2026-09-07', latitude: 5.1066,
      simNumber: '8923401000012345678', meterMake: 'MASTER ENERGY', amount: null, paymentStatus: null,
    });
    expect(j).toMatchObject({
      source: 'JED Remita request', accountNumber: '477014', customerPhone: '+2348036233685', rrr: '120799142825',
      amount: 67000, paymentStatus: 'Paid', requestRef: 'REF123456', meterNumber: '0123456789012',
      sealNumber: '9900', meterType: 'THREE PHASE', simNumber: null, installerName: null,
    });
    const types = Object.fromEntries(sheets[0].columns.map((c) => [c.key, c.type]));
    expect(types).toMatchObject({ accountNumber: 'text', meterNumber: 'text', simNumber: 'text', rrr: 'text', amount: 'currency', installationDate: 'date' });
  });

  it('drops OPTIONAL columns no row has, but always keeps the core installation facts', () => {
    const { sheets } = buildCompletedInstallationsReport({ rows: [jed()], context });
    const keys = sheets[0].columns.map((c) => c.key);
    expect(keys).toContain('rrr');
    expect(keys).not.toContain('feederName');
    expect(keys).not.toContain('simNumber');
    // Kept even when blank for every row — a blank cell says "not recorded".
    ['installerName', 'sealNumber', 'latitude', 'longitude', 'discoSupervisor', 'photoUrl', 'installationDate']
      .forEach((k) => expect(keys).toContain(k));
  });

  it('always has an Installation Picture Link column, as a hyperlink', () => {
    const withPhoto = multi({ installationPhotoUrl: 'https://api.memetering.com/api/v1/files/abc' });
    const { sheets } = buildCompletedInstallationsReport({ rows: [withPhoto, jed()], context });
    const col = sheets[0].columns.find((c) => c.key === 'photoUrl');
    expect(col).toMatchObject({ header: 'Installation Picture Link', type: 'link' });
    expect(sheets[0].rows.map((r) => r.photoUrl)).toContain('https://api.memetering.com/api/v1/files/abc');
    expect(sheets[1].rows.find((r) => r.item === 'Installation pictures').value).toBe('1 of 2 have a picture link');
  });

  it('embeds a fetched picture in its own column, on the right row', () => {
    const url = 'https://api.memetering.com/api/v1/files/abc';
    const photos = new Map([[url, { buffer: new ArrayBuffer(4), extension: 'jpeg' }]]);
    const { sheets } = buildCompletedInstallationsReport({ rows: [jed(), multi({ installationPhotoUrl: url })], context, photos });
    expect(sheets[0].columns.find((c) => c.key === 'photo')).toMatchObject({ header: 'Installation Picture', type: 'image' });
    expect(sheets[0].images).toHaveLength(1);
    expect(sheets[0].rows[sheets[0].images[0].row].photoUrl).toBe(url);
  });

  it('leaves out payment columns without PAYMENTS.VIEW, and contact details for non-admins', () => {
    const { sheets } = buildCompletedInstallationsReport({ rows: [jed()], context, includePayment: false, includeContact: false });
    const keys = sheets[0].columns.map((c) => c.key);
    ['rrr', 'orderId', 'amount', 'paymentStatus', 'datePaid', 'customerPhone', 'customerEmail']
      .forEach((k) => expect(keys).not.toContain(k));
    expect(sheets[1].rows.some((r) => /amount paid/i.test(r.item))).toBe(false);
  });

  it('summarises scope, counts, payments and meter matching', () => {
    const { sheets } = buildCompletedInstallationsReport({
      rows: [multi(), jed()], meterIndex, context: { ...context, scopeLabel: 'Aba Power (ABA_POWER)', filters: ['Feeder: ABA GRA 11KV'] },
    });
    const summary = Object.fromEntries(sheets[1].rows.map((r) => [r.item.trim(), r.value]));
    expect(summary['DisCo scope']).toBe('Aba Power (ABA_POWER)');
    expect(summary.Filters).toBe('Feeder: ABA GRA 11KV');
    expect(summary['Completed installations']).toBe('2');
    expect(summary['Meter details matched']).toBe('1 of 2');
    expect(summary['Total amount paid (JED Remita requests)']).toMatch(/67,000\.00/);
  });
});

