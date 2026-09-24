// src/utils/xlsx.js
// Single source of truth for Excel files this app writes or touches.
//
// Why .xlsx and not CSV: a CSV carries no cell types, so Excel guesses — it
// drops the leading zero from "0239110006909" and shows long identifiers
// such as 19-digit SIM serials as 8.93E+18 (and rounds them). In an .xlsx the
// type is explicit: identifier columns here are written as strings with the
// Text number format ("@"), so Excel shows exactly the characters we wrote.
//
// Formula safety: a string cell in .xlsx is never evaluated, even if it
// starts with "=", "+", "-" or "@" — formulas are a separate cell type this
// module never writes. (That was the reason csv.js prefixed an apostrophe.)
//
// ExcelJS is loaded on demand (dynamic import), so it only downloads when
// someone actually exports.

export const COLUMN_TYPES = Object.freeze({
  TEXT: 'text', // identifiers and free text — stored as a string, format "@"
  NUMBER: 'number',
  COORDINATE: 'coordinate', // GPS latitude/longitude — 6 decimal places
  CURRENCY: 'currency', // NGN amount
  DATE: 'date', // plain calendar date ('YYYY-MM-DD' or an instant's local date)
  DATETIME: 'datetime', // instant, shown in the viewer's local time
});

const NUM_FMT = {
  text: '@',
  number: '#,##0.##',
  coordinate: '0.000000',
  currency: '"₦"#,##0.00',
  date: 'dd mmm yyyy',
  datetime: 'dd mmm yyyy hh:mm',
};

const PLAIN_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const toNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const n = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

/**
 * Excel has no time zones, and ExcelJS converts a JS Date by its UTC value.
 * Building the Date from wall-clock parts as UTC makes Excel show exactly
 * that wall-clock date/time.
 */
const wallClock = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(Date.UTC(y, mo, d, h, mi, s));

/**
 * The value to store in a cell for a given column type, or null for an
 * empty cell. Pure — exported for tests.
 */
export function toCellValue(value, type = COLUMN_TYPES.TEXT) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  switch (type) {
    case COLUMN_TYPES.NUMBER:
    case COLUMN_TYPES.COORDINATE:
    case COLUMN_TYPES.CURRENCY:
      return toNumber(value);
    case COLUMN_TYPES.DATE: {
      // A plain calendar date must not pass through a time zone — see
      // utils/date.js; '2026-09-07' stays the 7th everywhere.
      const plain = typeof value === 'string' ? value.match(PLAIN_DATE_RE) : null;
      if (plain) return wallClock(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3]));
      const t = new Date(value);
      return Number.isNaN(t.getTime()) ? null : wallClock(t.getFullYear(), t.getMonth(), t.getDate());
    }
    case COLUMN_TYPES.DATETIME: {
      const t = new Date(value);
      return Number.isNaN(t.getTime())
        ? null
        : wallClock(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds());
    }
    default:
      // Identifiers: never let a numeric-looking value become a number.
      return String(value);
  }
}

const displayLength = (v) => {
  if (v === null || v === undefined) return 0;
  if (v instanceof Date) return 17;
  return String(v).length;
};

/**
 * @typedef {{ header: string, key: string, type?: string, width?: number }} XlsxColumn
 * @typedef {{ name: string, columns: XlsxColumn[], rows: object[], autoFilter?: boolean }} XlsxSheet
 */

/** Populate an ExcelJS workbook from sheet definitions. */
export function fillWorkbook(workbook, sheets) {
  sheets.forEach((sheet) => {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.columns = sheet.columns.map((c) => {
      const type = c.type || COLUMN_TYPES.TEXT;
      const longest = Math.max(
        c.header.length,
        ...sheet.rows.slice(0, 500).map((r) => displayLength(toCellValue(r[c.key], type)))
      );
      return {
        header: c.header,
        key: c.key,
        width: c.width || Math.min(Math.max(longest + 2, 10), 60),
        style: { numFmt: NUM_FMT[type] || NUM_FMT.text },
      };
    });

    sheet.rows.forEach((r) => {
      const values = {};
      sheet.columns.forEach((c) => { values[c.key] = toCellValue(r[c.key], c.type || COLUMN_TYPES.TEXT); });
      ws.addRow(values);
    });

    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: 'middle' };
    header.eachCell((cell) => {
      cell.numFmt = 'General';
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } } };
    });

    if (sheet.autoFilter !== false && sheet.columns.length > 0) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
    }
  });
  return workbook;
}

async function loadExcelJS() {
  const mod = await import('exceljs');
  return mod.default || mod;
}

/** Build an .xlsx as an ArrayBuffer. */
export async function buildXlsxBuffer(sheets) {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ME Metering';
  workbook.created = new Date();
  fillWorkbook(workbook, sheets);
  return workbook.xlsx.writeBuffer();
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Build and download an .xlsx. */
export async function downloadXlsx(filename, sheets) {
  const buffer = await buildXlsxBuffer(sheets);
  saveBlob(new Blob([buffer], { type: XLSX_MIME }), filename);
}

// ---------------------------------------------------------------------------
// Server-generated workbooks
//
// The export endpoints build their .xlsx on the server. If a server file stores
// an identifier as a NUMBER, Excel shows it in scientific notation once it's
// long enough. Before saving such a file we rewrite numeric cells in
// identifier columns as text, so the digits the cell actually holds are shown
// literally instead of as 2.39E+11.
//
// Nothing is ever added to or removed from an identifier here. A meter number
// is NOT a fixed-length field (they are 10-13 digits — see utils/meterNumber.js),
// so a shorter value is a shorter meter number, not a value missing leading
// zeros: this used to pad meter cells to 13 digits, which turned a real
// 11-digit serial into "00…" and corrupted the export. If the server dropped a
// leading zero by storing the identifier as a number, that zero is gone at the
// source and only the server can fix it (see API_GAP_REPORT.md).
// Numbers beyond 2^53 have already lost digits in the server's number type; those
// are only given a non-scientific format, never "repaired".
// ---------------------------------------------------------------------------

// Headers are matched on whole words ("Customer Account number", "meterNo",
// "SIM_SERIAL") — substring matching would misread "acCOUNT" as a count.
const headerTokens = (h) => String(h ?? '')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(Boolean);
const ID_WORDS = new Set([
  'sim', 'seal', 'account', 'acct', 'accountnumber', 'accountno', 'rrr', 'remita', 'reference', 'ref',
  'requestref', 'orderid', 'phone', 'gsm', 'mobile', 'sgc', 'serial', 'customerid', 'meterno', 'meternumber',
]);
const NUMBER_WORDS = new Set(['no', 'number', 'num', 'serial']);
const NOT_ID_WORDS = new Set([
  'amount', 'date', 'time', 'timestamp', 'latitude', 'longitude', 'count', 'qty', 'quantity', 'total',
  'type', 'status', 'make', 'model', 'name', 'email', 'address', 'price', 'cost',
]);

/** Whether a column header names an identifier (exported for tests). */
export function isIdentifierHeader(header) {
  const tokens = headerTokens(header);
  if (tokens.length === 0 || tokens.some((t) => NOT_ID_WORDS.has(t))) return false;
  if (tokens.includes('meter') && tokens.some((t) => NUMBER_WORDS.has(t))) return true;
  return tokens.some((t) => ID_WORDS.has(t));
}

const cellText = (v) => (v && typeof v === 'object' && 'richText' in v
  ? v.richText.map((t) => t.text).join('')
  : v);

/**
 * Rewrite numeric identifier cells as text in every sheet of a loaded
 * ExcelJS workbook. Header row = first row with any string cell among the
 * first 5 rows. Returns the number of cells changed.
 */
export function normalizeIdentifierCells(workbook) {
  let changed = 0;
  workbook.eachSheet((ws) => {
    let headerRowNumber = null;
    for (let r = 1; r <= Math.min(5, ws.rowCount); r += 1) {
      const row = ws.getRow(r);
      let hasText = false;
      row.eachCell((cell) => { if (typeof cellText(cell.value) === 'string') hasText = true; });
      if (hasText) { headerRowNumber = r; break; }
    }
    if (!headerRowNumber) return;

    const idColumns = new Set(); // column numbers holding identifiers
    ws.getRow(headerRowNumber).eachCell((cell, col) => {
      if (isIdentifierHeader(cellText(cell.value))) idColumns.add(col);
    });
    if (idColumns.size === 0) return;
    const longest = new Map();

    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return;
      idColumns.forEach((col) => {
        const cell = row.getCell(col);
        const v = cell.value;
        if (typeof v === 'number' && Number.isInteger(v)) {
          if (Number.isSafeInteger(v) && v >= 0) {
            // The digits the cell holds, exactly — never padded to a length.
            const s = String(v);
            cell.value = s;
            cell.numFmt = '@';
            longest.set(col, Math.max(longest.get(col) || 0, s.length));
          } else {
            cell.numFmt = '0';
            longest.set(col, Math.max(longest.get(col) || 0, 21));
          }
          changed += 1;
        } else if (typeof v === 'string') {
          cell.numFmt = '@';
        }
      });
    });
    // A full-length number/identifier would otherwise show as ########.
    longest.forEach((len, col) => {
      const column = ws.getColumn(col);
      column.width = Math.max(column.width || 10, len + 2);
    });
  });
  return changed;
}

/**
 * Save a workbook the API returned, with identifier cells fixed up. If the
 * file can't be parsed for any reason, the original bytes are saved — the
 * download is never blocked by this step.
 */
export async function downloadServerXlsx(blob, filename) {
  try {
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    const changed = normalizeIdentifierCells(workbook);
    if (changed > 0) {
      const buffer = await workbook.xlsx.writeBuffer();
      saveBlob(new Blob([buffer], { type: XLSX_MIME }), filename);
      return;
    }
  } catch (err) {
    console.warn('[xlsx] Could not post-process the server workbook; saving it unchanged.', err);
  }
  saveBlob(blob, filename);
}
