// Workbooks are built with the real ExcelJS and read back, so these assert the
// actual cell types and number formats Excel will see.
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  COLUMN_TYPES, toCellValue, buildXlsxBuffer, normalizeIdentifierCells, isIdentifierHeader,
} from '../xlsx';

const { TEXT, NUMBER, CURRENCY, DATE, DATETIME } = COLUMN_TYPES;

const readBack = async (buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
};

describe('toCellValue', () => {
  it('keeps identifiers as exact strings', () => {
    expect(toCellValue('0239110006909', TEXT)).toBe('0239110006909');
    expect(toCellValue('8923401000012345678', TEXT)).toBe('8923401000012345678');
    expect(toCellValue(477014, TEXT)).toBe('477014');
  });

  it('turns blanks into empty cells', () => {
    [null, undefined, '', '   '].forEach((v) => expect(toCellValue(v, TEXT)).toBeNull());
  });

  it('parses amounts and rejects junk', () => {
    expect(toCellValue('67,000', CURRENCY)).toBe(67000);
    expect(toCellValue('n/a', NUMBER)).toBeNull();
  });

  it('keeps a plain calendar date on the same day', () => {
    const d = toCellValue('2026-09-07', DATE);
    expect([d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]).toEqual([2026, 8, 7]);
  });

  it('writes instants as local wall-clock time', () => {
    const src = new Date(2026, 8, 7, 14, 30, 0); // local 14:30
    const d = toCellValue(src.toISOString(), DATETIME);
    expect([d.getUTCHours(), d.getUTCMinutes()]).toEqual([14, 30]);
  });
});

describe('buildXlsxBuffer', () => {
  it('writes identifiers as text cells with the Text format, plus header, freeze and filter', async () => {
    const buffer = await buildXlsxBuffer([{
      name: 'Report',
      columns: [
        { header: 'Meter Number', key: 'meter', type: TEXT },
        { header: 'SIM', key: 'sim', type: TEXT },
        { header: 'Amount (₦)', key: 'amount', type: CURRENCY },
        { header: 'Installed', key: 'date', type: DATE },
        { header: 'Notes', key: 'notes', type: TEXT },
      ],
      rows: [
        { meter: '0239110006909', sim: '8923401000012345678', amount: 67000, date: '2026-09-07', notes: '=HYPERLINK("x")' },
        { meter: '0012345678901', sim: null, amount: null, date: null, notes: '' },
      ],
    }]);
    const ws = (await readBack(buffer)).getWorksheet('Report');

    expect(ws.getRow(1).values.slice(1)).toEqual(['Meter Number', 'SIM', 'Amount (₦)', 'Installed', 'Notes']);
    expect(ws.getCell('A2').value).toBe('0239110006909');
    expect(ws.getCell('A2').numFmt).toBe('@');
    expect(ws.getCell('A3').value).toBe('0012345678901');
    expect(ws.getCell('B2').value).toBe('8923401000012345678');
    expect(ws.getCell('B3').value).toBeNull();
    expect(ws.getCell('C2').value).toBe(67000);
    expect(ws.getCell('C2').numFmt).toBe('"₦"#,##0.00');
    expect(ws.getCell('D2').value).toBeInstanceOf(Date);
    // A string that looks like a formula stays a string (never a formula cell).
    expect(ws.getCell('E2').value).toBe('=HYPERLINK("x")');
    expect(ws.getCell('E2').formula).toBeUndefined();
    expect(ws.getCell('E3').value).toBeNull();

    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.getColumn(2).width).toBeGreaterThanOrEqual(19);
  });
});

describe('server workbook identifier fix-up', () => {
  it('recognises identifier headers but not amounts, dates or names', () => {
    ['Meter Number', 'meterNo', 'SIM Card Serial Number', 'APLE Seal Number', 'Customer Account number', 'RRR', 'Phone', 'SGC Number']
      .forEach((h) => expect(isIdentifierHeader(h)).toBe(true));
    ['Amount', 'Meter Type', 'Installation Date', 'Customer Name', 'Status', 'Latitude', 'Email']
      .forEach((h) => expect(isIdentifierHeader(h)).toBe(false));
  });

  it('rewrites numeric identifier cells as text without changing a single digit', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Meters');
    ws.addRow(['Meter Number', 'SIM Number', 'Amount', 'Phase']);
    ws.addRow([239110006909, 8923401000012345000, 67000, 'SINGLE PHASE']);
    ws.addRow(['0239110006917', null, 50000, 'THREE PHASE']);

    const changed = normalizeIdentifierCells(wb);
    expect(changed).toBe(2);
    // Exactly the digits the cell held — never padded to a fixed length.
    expect(ws.getCell('A2').value).toBe('239110006909');
    expect(ws.getCell('A2').numFmt).toBe('@');
    // Beyond 2^53 the digits are already lost — only the format changes.
    expect(typeof ws.getCell('B2').value).toBe('number');
    expect(ws.getCell('B2').numFmt).toBe('0');
    expect(ws.getCell('C2').value).toBe(67000);
    // A value the server already stored as text is passed through untouched,
    // leading zero and all.
    expect(ws.getCell('A3').value).toBe('0239110006917');
  });

  it('never pads a meter number to a fixed length, at any valid length', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Meters');
    ws.addRow(['meterNo']);
    // 10, 11, 12 and 13 digits — all legitimate meter numbers.
    [1234567890, 14534512345, 145345123456, 1453451234567].forEach((n) => ws.addRow([n]));

    normalizeIdentifierCells(wb);
    expect([2, 3, 4, 5].map((r) => ws.getCell(`A${r}`).value)).toEqual([
      '1234567890', '14534512345', '145345123456', '1453451234567',
    ]);
  });
});
