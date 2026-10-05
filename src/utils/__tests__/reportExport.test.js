import { describe, it, expect } from 'vitest';
import {
  csvField, tableToCsv, reportToCsvBlob, reportFilename, reportToXlsxSheets, cellText, reportHasRows,
} from '../reportExport';
import { buildOverviewReport, buildPaymentsDealsReport, paymentFigures, overviewInstallationFigures } from '../reportData';
import { COLUMN_TYPES } from '../xlsx';

const { TEXT, CURRENCY, DATETIME, NUMBER } = COLUMN_TYPES;

describe('CSV — valid, escaped, exact', () => {
  it('quotes commas, quotes, line breaks and edge spaces; doubles quotes', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('Aba, Abia')).toBe('"Aba, Abia"');
    expect(csvField('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField(' padded ')).toBe('" padded "');
  });

  it('keeps identifiers exactly (leading zeros, 19-digit SIMs) and neutralises formula-looking text', () => {
    expect(csvField('0239110006909')).toBe('0239110006909');
    expect(csvField('8923400000012345678')).toBe('8923400000012345678');
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('-5', NUMBER)).toBe('-5');
  });

  it('writes a header row, every row, CRLF line ends, and a UTF-8 BOM', async () => {
    const table = {
      columns: [{ key: 'acct', header: 'Account', type: TEXT }, { key: 'amt', header: 'Amount (₦)', type: CURRENCY }],
      rows: [{ acct: '0001', amt: 75000 }, { acct: '0002', amt: null }],
    };
    expect(tableToCsv(table)).toBe('Account,Amount (₦)\r\n0001,75000.00\r\n0002,\r\n');
    // The UTF-8 BOM (EF BB BF) — read as bytes, since text() strips it.
    const bytes = new Uint8Array(await reportToCsvBlob({ tables: [table] }).arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('writes dates machine-readably (local time), never shifted', () => {
    expect(cellText('2026-09-07', COLUMN_TYPES.DATE, 'csv')).toBe('2026-09-07');
    const local = new Date(2026, 8, 5, 23, 30).toISOString();
    expect(cellText(local, DATETIME, 'csv')).toBe('2026-09-05 23:30');
  });
});

describe('file names and workbook', () => {
  it('names the file by report and generation date', () => {
    const generatedAt = new Date(2026, 9, 5, 10, 0);
    expect(reportFilename({ slug: 'Payment-Deals', generatedAt }, 'xlsx')).toBe('ME-Metering-Payment-Deals-2026-10-05.xlsx');
    expect(reportFilename({ slug: 'Overview', generatedAt }, 'csv')).toBe('ME-Metering-Overview-2026-10-05.csv');
  });

  it('keeps each column type, and adds a Report sheet with the title, filters and notes', () => {
    const sheets = reportToXlsxSheets({
      title: 'Payment & Deals Report', generatedAt: new Date(), notes: ['n1'],
      filters: [{ label: 'Meter type', value: 'Three Phase' }],
      tables: [{ name: 'Payments & Deals', columns: [{ key: 'a', header: 'Account', type: TEXT }, { key: 'm', header: 'Amount', type: CURRENCY }], rows: [{ a: '01', m: 1 }] }],
    });
    expect(sheets.map((s) => s.name)).toEqual(['Payments & Deals', 'Report']);
    expect(sheets[0].columns.map((c) => c.type)).toEqual([TEXT, CURRENCY]);
    const info = Object.fromEntries(sheets[1].rows.map((r) => [r.item, r.value]));
    expect(info.Report).toBe('Payment & Deals Report');
    expect(info['Meter type']).toBe('Three Phase');
    expect(info.Notes).toBe('n1');
  });
});

// ---------------------------------------------------------------------------
const TOTALS = {
  pending: 7, completed: 5, awaitingPayment: 2, cancelled: 1, reconciles: true,
  breakdown: { pending: { withInstaller: 3, unassigned: 2, failed: 1, jedPaid: 1 }, completed: { jed: 2 } },
};
const COLLECTED = {
  loading: false, error: null, incomplete: false, mismatch: null,
  valuation: {
    total: 300000, count: 7, pricedCount: 7,
    byType: [{ type: 'THREE PHASE', name: 'Three Phase', disco: 'ABA_POWER', count: 2, unitPrice: 150000, value: 300000 }],
    unpriced: { count: 0, unknownType: 0, noPrice: 0, ambiguous: 0, examples: [] },
  },
};
const REVENUE = { loading: false, error: null, summary: { revenueDue: 1250000, completedCount: 5, complete: true, note: null, recognisedTotal: 2000000 } };

describe('the Overview report is the Overview screen', () => {
  it('has exactly the screen’s installation figures, in order', () => {
    const report = buildOverviewReport({ totals: TOTALS, showMoney: false });
    const rows = report.tables[0].rows;
    expect(rows.map((r) => [r.metric, r.count])).toEqual(overviewInstallationFigures(TOTALS).map((f) => [f.label, f.value]));
    expect(rows.find((r) => r.metric === 'Total requests').count).toBe(15);
    // No money for a viewer without PAYMENTS.VIEW.
    expect(rows.some((r) => r.section === 'Payments')).toBe(false);
  });

  it('carries Total collected payments and Revenue due as the panel shows them — no new formula', () => {
    const payment = paymentFigures(COLLECTED, REVENUE);
    const rows = buildOverviewReport({ totals: TOTALS, payment, recordedTotal: { amount: 2000000, error: false }, showMoney: true }).tables[0].rows;
    const by = (m) => rows.find((r) => r.metric === m);
    expect(by('Total collected payments').amount).toBe(payment.collected.amount);
    expect(by('Total collected payments').amount).toBe(300000);
    expect(by('Revenue due to us').amount).toBe(1250000);
    expect(by('Total amount paid (all recorded payments)').amount).toBe(2000000);
  });

  it('an unreadable figure is Unavailable, never ₦0', () => {
    const payment = paymentFigures({ ...COLLECTED, error: 'boom' }, REVENUE);
    const row = buildOverviewReport({ totals: TOTALS, payment, showMoney: true }).tables[0].rows.find((r) => r.metric === 'Total collected payments');
    expect(row.amount).toBeNull();
    expect(row.detail).toMatch(/^Unavailable/);
  });
});

describe('the Payments & deals report', () => {
  const rows = [
    { reference: '0239110', customerName: 'ADA', discoCode: 'ABA_POWER', meterType: 'THREE PHASE', sourceStatus: 'INSTALLED', amount: 150000, amountMissing: false, isEstimated: true, revenueAt: '2026-09-10T10:00:00Z', dateBasis: 'reported_at', source: 'installation_request', sourceId: 9 },
    { reference: '0001', customerName: 'BAYO', discoCode: 'JED', meterType: null, sourceStatus: 'COMPLETED', amount: 0, amountMissing: true, isEstimated: false, revenueAt: null, dateBasis: 'date_paid', source: 'jed_customer_request', sourceId: 4 },
  ];
  it('keeps identifiers as text, marks unpriced/estimated, and labels real fields only', () => {
    const report = buildPaymentsDealsReport({ rows, statusLabel: (r) => r.sourceStatus, summary: null, filters: [] });
    const out = report.tables[0].rows;
    expect(out[0]).toMatchObject({ reference: '0239110', meterType: 'Three Phase', amount: 150000, amountNote: 'Estimated', dateBasis: 'Installed', source: 'Imported installation' });
    expect(out[1]).toMatchObject({ reference: '0001', amount: null, amountNote: 'Not priced', source: 'JED Remita request' });
    expect(report.tables[0].columns.find((c) => c.key === 'reference').type).toBe(TEXT);
    expect(reportHasRows(report)).toBe(true);
    expect(reportHasRows(buildPaymentsDealsReport({ rows: [], statusLabel: () => '', summary: null, filters: [] }))).toBe(false);
  });
});
