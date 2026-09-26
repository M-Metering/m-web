// Reading a spreadsheet in the browser — the replacement for POST
// /uploads/excel, which was removed from the API on 2026-09-25 (and had never
// actually been deployed). The round-trip through buildXlsxBuffer proves the
// reader and the writer agree on the same file.
import { describe, it, expect } from 'vitest';
import { buildXlsxBuffer, readSpreadsheetRows, parseCsvRows, COLUMN_TYPES } from '../xlsx';

const asFile = (buffer, name) => ({
  name,
  arrayBuffer: async () => buffer,
});

describe('readSpreadsheetRows — .xlsx', () => {
  const sheet = (rows) => ([{
    name: 'Paid',
    columns: [
      { header: 'Account Number', key: 'account', type: COLUMN_TYPES.TEXT },
      { header: 'RRR', key: 'rrr', type: COLUMN_TYPES.TEXT },
      { header: 'Amount', key: 'amount', type: COLUMN_TYPES.CURRENCY },
    ],
    rows,
  }]);

  it('reads rows keyed by the header row', async () => {
    const buffer = await buildXlsxBuffer(sheet([
      { account: '0239110006909', rrr: '340001234567', amount: 97500 },
      { account: '145345123456', rrr: '340001234568', amount: 45000 },
    ]));
    const { rows } = await readSpreadsheetRows(asFile(buffer, 'paid.xlsx'));

    expect(rows).toHaveLength(2);
    expect(rows[0]['Account Number']).toBe('0239110006909');
    expect(rows[0].RRR).toBe('340001234567');
  });

  it('keeps a leading zero, because these cells are identifiers', async () => {
    const buffer = await buildXlsxBuffer(sheet([{ account: '0239110006909', rrr: '0012', amount: 1 }]));
    const { rows } = await readSpreadsheetRows(asFile(buffer, 'paid.xlsx'));

    expect(rows[0]['Account Number']).toBe('0239110006909');
    expect(rows[0].RRR).toBe('0012');
  });

  it('returns every cell as a string, so nothing is coerced to a number', async () => {
    const buffer = await buildXlsxBuffer(sheet([{ account: '123', rrr: '456', amount: 97500 }]));
    const { rows } = await readSpreadsheetRows(asFile(buffer, 'paid.xlsx'));

    Object.values(rows[0]).forEach((value) => expect(typeof value).toBe('string'));
  });

  it('skips blank rows rather than yielding empty records', async () => {
    const buffer = await buildXlsxBuffer(sheet([
      { account: '0239110006909', rrr: '1', amount: 1 },
      { account: '', rrr: '', amount: null },
    ]));
    const { rows } = await readSpreadsheetRows(asFile(buffer, 'paid.xlsx'));
    expect(rows).toHaveLength(1);
  });

  it('names the sheet it read', async () => {
    const buffer = await buildXlsxBuffer(sheet([{ account: '1', rrr: '2', amount: 3 }]));
    const { sheetName } = await readSpreadsheetRows(asFile(buffer, 'paid.xlsx'));
    expect(sheetName).toBe('Paid');
  });
});

describe('parseCsvRows', () => {
  it('reads a plain CSV into header-keyed rows', () => {
    const rows = parseCsvRows('Account Number,RRR\n0239110006909,340001234567\n145345123456,340001234568\n');
    expect(rows).toEqual([
      { 'Account Number': '0239110006909', RRR: '340001234567' },
      { 'Account Number': '145345123456', RRR: '340001234568' },
    ]);
  });

  it('handles quoted fields containing commas', () => {
    const rows = parseCsvRows('Account Number,Customer\n1001,"OBI, ADA"\n');
    expect(rows[0].Customer).toBe('OBI, ADA');
  });

  it('handles an escaped quote inside a quoted field', () => {
    const rows = parseCsvRows('Account Number,Customer\n1001,"ADA ""ACE"" OBI"\n');
    expect(rows[0].Customer).toBe('ADA "ACE" OBI');
  });

  it('handles CRLF line endings, which Excel writes', () => {
    const rows = parseCsvRows('Account Number,RRR\r\n1001,340001234567\r\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].RRR).toBe('340001234567');
  });

  it('keeps a leading zero in a CSV cell too', () => {
    expect(parseCsvRows('Account Number\n0239110006909\n')[0]['Account Number']).toBe('0239110006909');
  });

  it('ignores entirely blank lines', () => {
    const rows = parseCsvRows('Account Number,RRR\n1001,1\n\n,\n1002,2\n');
    expect(rows.map((r) => r['Account Number'])).toEqual(['1001', '1002']);
  });

  it('returns nothing for an empty file rather than throwing', () => {
    expect(parseCsvRows('')).toEqual([]);
    expect(parseCsvRows('\n\n')).toEqual([]);
  });
});

describe('readSpreadsheetRows — CSV routing', () => {
  it('parses a .csv without going through the xlsx reader', async () => {
    const buffer = new TextEncoder().encode('Account Number,RRR\n0239110006909,340001234567\n').buffer;
    const { rows, sheetName } = await readSpreadsheetRows(asFile(buffer, 'paid.csv'));
    expect(sheetName).toBeNull();
    expect(rows[0]['Account Number']).toBe('0239110006909');
  });
});
