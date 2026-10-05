// src/utils/reportExport.js
// ONE report model for every export and print in Reports and the Dashboard's
// "Generate Report" (2026-10-05). A screen builds a report from the values it
// is showing (utils/reportData.js); this module only WRITES it — Excel, CSV or
// the print view — so the three can never disagree about a figure.
//
//   report = {
//     title:       'Payment & Deals Report'
//     slug:        'Payment-Deals'              → ME-Metering-Payment-Deals-2026-10-05.xlsx
//     generatedAt: Date
//     filters:     [{ label, value }]           → printed header / "Report" sheet
//     notes:       [string]                     → caveats that travel with figures
//     orientation: 'portrait' | 'landscape'     → the print page
//     tables:      [{ name, title?, columns: [{ key, header, type }], rows: [{…}] }]
//   }
//
// Excel keeps cell types (identifiers stay text, amounts are numbers, dates are
// dates) via utils/xlsx.js. CSV is offered because it was asked for, but a CSV
// carries no types: Excel strips leading zeros from an identifier it opens from
// CSV. The CSV itself is exact; use the .xlsx to open it in Excel.
import { COLUMN_TYPES, downloadXlsx } from './xlsx';
import { downloadBlob } from './downloadBlob';
import { formatCurrencyNGN } from './currency';
import { formatDateTime, formatPlainDate } from './date';

export const SYSTEM_NAME = 'ME Metering System';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const PLAIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** ME-Metering-<slug>-YYYY-MM-DD.<ext>, dated by when the report was generated. */
export function reportFilename(report, ext) {
  const slug = String(report.slug || report.title || 'Report').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `ME-Metering-${slug}-${ymd(report.generatedAt || new Date())}.${ext}`;
}

/** Whether any table has a row — an empty report is never written silently. */
export const reportHasRows = (report) => (report?.tables || []).some((t) => t.rows.length > 0);

/**
 * A cell as text, for CSV (`mode: 'csv'` — machine-readable: plain numbers,
 * ISO-style dates) or print (`mode: 'print'` — the app's own formatting).
 */
export function cellText(value, type = COLUMN_TYPES.TEXT, mode = 'print') {
  if (blank(value)) return '';
  switch (type) {
    case COLUMN_TYPES.CURRENCY: {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return mode === 'csv' ? n.toFixed(2) : formatCurrencyNGN(n);
    }
    case COLUMN_TYPES.NUMBER: {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return mode === 'csv' ? String(n) : n.toLocaleString();
    }
    case COLUMN_TYPES.DATE: {
      if (typeof value === 'string' && PLAIN_DATE_RE.test(value)) return mode === 'csv' ? value : formatPlainDate(value);
      const t = new Date(value);
      if (Number.isNaN(t.getTime())) return String(value);
      return mode === 'csv' ? ymd(t) : formatPlainDate(ymd(t));
    }
    case COLUMN_TYPES.DATETIME: {
      const t = new Date(value);
      if (Number.isNaN(t.getTime())) return String(value);
      return mode === 'csv' ? `${ymd(t)} ${pad(t.getHours())}:${pad(t.getMinutes())}` : formatDateTime(value);
    }
    default:
      // Identifiers and text: exactly as given — never coerced or padded.
      return String(value);
  }
}

/**
 * One CSV field. Quoted when it holds a comma, quote, CR/LF or edge spaces;
 * quotes doubled. A TEXT cell starting with = + - @ (or a tab/CR) gets a
 * leading apostrophe so a spreadsheet can't run it as a formula (CSV
 * injection) — numbers and dates are never touched.
 */
export function csvField(text, type = COLUMN_TYPES.TEXT) {
  let s = String(text ?? '');
  if (type === COLUMN_TYPES.TEXT && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A table as CSV text (CRLF line ends, RFC 4180). */
export function tableToCsv(table) {
  const lines = [table.columns.map((c) => csvField(c.header)).join(',')];
  table.rows.forEach((row) => {
    lines.push(table.columns.map((c) => csvField(cellText(row[c.key], c.type, 'csv'), c.type || COLUMN_TYPES.TEXT)).join(','));
  });
  return `${lines.join('\r\n')}\r\n`;
}

/** The report's main (first non-empty, else first) table as a UTF-8 CSV Blob with a BOM. */
export function reportToCsvBlob(report) {
  const table = report.tables.find((t) => t.rows.length > 0) || report.tables[0];
  return new Blob(['﻿', tableToCsv(table)], { type: 'text/csv;charset=utf-8' });
}

/** Sheets for utils/xlsx.js: every table, then a "Report" sheet saying what this is. */
export function reportToXlsxSheets(report) {
  const sheetName = (s) => String(s).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
  const info = [
    { item: 'System', value: SYSTEM_NAME },
    { item: 'Report', value: report.title },
    { item: 'Generated', value: formatDateTime(report.generatedAt || new Date()) },
    ...(report.filters?.length ? report.filters : [{ label: 'Filters', value: 'None' }])
      .map((f) => ({ item: f.label, value: f.value })),
    ...(report.notes || []).map((n, i) => ({ item: i === 0 ? 'Notes' : '', value: n })),
  ];
  return [
    ...report.tables.map((t) => ({
      name: sheetName(t.name),
      columns: t.columns.map((c) => ({ header: c.header, key: c.key, type: c.type || COLUMN_TYPES.TEXT, width: c.width })),
      rows: t.rows,
    })),
    {
      name: 'Report',
      autoFilter: false,
      columns: [
        { header: 'Item', key: 'item', type: COLUMN_TYPES.TEXT, width: 28 },
        { header: 'Value', key: 'value', type: COLUMN_TYPES.TEXT, width: 80 },
      ],
      rows: info,
    },
  ];
}

export async function downloadReportXlsx(report) {
  await downloadXlsx(reportFilename(report, 'xlsx'), reportToXlsxSheets(report));
}

export function downloadReportCsv(report) {
  downloadBlob(reportToCsvBlob(report), reportFilename(report, 'csv'));
}
