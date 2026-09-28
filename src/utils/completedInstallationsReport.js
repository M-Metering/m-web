// src/utils/completedInstallationsReport.js
// The "Export Completed Installations" workbook: one row per completed
// installation, with the customer, payment, installer and meter details the
// API actually returns for it.
//
// Scope and grain:
//   - Rows are the normalized rows from utils/installationScope.js, so the
//     disco scope, upload-field filters and search on Installation Requests
//     apply exactly as on screen. One row = one installation (rows are
//     already de-duplicated per source), and the only join — meter details
//     by meter serial — is one-to-one, so it can't multiply rows.
//   - "Completed" per domain: an imported job that is INSTALLED or EXPORTED
//     (isInstalledStatus), a JED request that is COMPLETED (isCompletedStatus).
//
// Columns come from real fields only. A column that is empty for every row
// in the export is dropped rather than shipped blank, so the sheet never
// implies data the API doesn't have (e.g. JED requests carry no feeder,
// installer or GPS; imported jobs carry no payment).
import { ROW_SOURCE, rowStatusLabel } from './installationScope';
import { isInstalledStatus, getCoordinates } from './installationStatus';
import { isCompletedStatus } from './statusBadge';
import { parseAmount } from './paymentSummary';
import { COLUMN_TYPES } from './xlsx';
import { meterMakeOf, meterModelOf, manufacturedDateOf } from './meterDisplay';

const { TEXT, COORDINATE, CURRENCY, DATE, DATETIME, LINK, IMAGE } = COLUMN_TYPES;

export const isCompletedRow = (row) =>
  row.source === ROW_SOURCE.JED ? isCompletedStatus(row.status) : isInstalledStatus(row.status);

const PLAIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const localDate = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && PLAIN_DATE_RE.test(value)) return value;
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};

/**
 * The installation's calendar date ('YYYY-MM-DD'): the installer's own
 * installationDate for an imported job (falling back to when it was
 * reported), dateCompleted for a JED request.
 */
export function completionDateOf(row) {
  const r = row.raw || {};
  return row.source === ROW_SOURCE.JED
    ? localDate(r.dateCompleted)
    : localDate(r.installationDate) || localDate(r.reportedAt);
}

/** Keep rows whose completion date is within [from, to] (either may be ''). */
export function filterByCompletionDate(rows, from, to) {
  if (!from && !to) return rows;
  return rows.filter((row) => {
    const d = completionDateOf(row);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

/** meterNumber → meter record, first one wins. */
export function buildMeterIndex(meters = []) {
  const index = new Map();
  meters.forEach((m) => {
    const serial = m?.meterNumber != null ? String(m.meterNumber).trim() : '';
    if (serial && !index.has(serial)) index.set(serial, m);
  });
  return index;
}

const jed = (row) => row.source === ROW_SOURCE.JED;
const pick = (...values) => values.find((v) => v !== null && v !== undefined && String(v).trim() !== '');
const meterSerialOf = (row) => {
  const v = jed(row) ? row.raw.meterNo : row.raw.meterNumber;
  return v != null ? String(v).trim() : '';
};

// [key, header, type, value(row, meter)]
const COLUMNS = [
  // Record
  ['source', 'Source', TEXT, (row) => (jed(row) ? 'JED Remita request' : 'Imported job')],
  ['disco', 'DisCo', TEXT, (row) => row.raw.discoCode],
  ['installationId', 'Installation ID', TEXT, (row) => row.raw.id],
  ['status', 'Status', TEXT, (row) => rowStatusLabel(row)],
  // Customer
  ['accountNumber', 'Account Number', TEXT, (row) => row.raw.accountNumber],
  ['customerName', 'Customer Name', TEXT, (row) => (jed(row) ? row.raw.custNames : row.raw.customerName)],
  ['customerPhone', 'Customer Phone', TEXT, (row) => (jed(row) ? pick(row.raw.gsm, row.raw.phone1) : row.raw.customerPhone)],
  ['customerEmail', 'Customer Email', TEXT, (row) => (jed(row) ? row.raw.email : row.raw.customerEmail)],
  ['customerAddress', 'Customer / Installation Address', TEXT, (row) => (jed(row) ? row.raw.address : row.raw.customerAddress)],
  ['region', 'Region', TEXT, (row) => row.raw.region],
  ['area', 'Area', TEXT, (row) => row.raw.area],
  ['requestRef', 'Request Reference', TEXT, (row) => row.raw.requestRef],
  ['requestDate', 'Request Date', DATETIME, (row) => (jed(row) ? row.raw.dateRequested : row.raw.createdAt)],
  // When the record was imported into ME Metering. Blank for JED's Remita
  // requests, which are created by generate-ref and never imported — their
  // request date is not an import date. All-blank columns are dropped, so a
  // JED-only export simply won't carry this one.
  ['importedDate', 'Imported Date', DATETIME, (row) => row.importedAt],
  // Payment (JED Remita requests only — imported jobs have no payment fields)
  ['rrr', 'Payment Reference (RRR)', TEXT, (row) => row.raw.rrr],
  ['orderId', 'Remita Order ID', TEXT, (row) => row.raw.orderId],
  ['amount', 'Amount Paid (₦)', CURRENCY, (row) => (jed(row) ? parseAmount(row.raw.amount) : null)],
  // A COMPLETED JED request has necessarily been PAID first (INITIATED →
  // PAID → COMPLETED), so this is the lifecycle, not a guess.
  ['paymentStatus', 'Payment Status', TEXT, (row) => (jed(row) ? 'Paid' : null)],
  ['datePaid', 'Date Paid', DATETIME, (row) => row.raw.datePaid],
  // Installation
  ['installationDate', 'Installation Date', DATE, (row) => completionDateOf(row)],
  ['completedAt', 'Completed / Reported At', DATETIME, (row) => (jed(row) ? row.raw.dateCompleted : row.raw.reportedAt)],
  ['installerName', 'Installer', TEXT, (row) => pick(row.raw.installerName, row.raw.assigneeName)],
  ['installerId', 'Installer ID', TEXT, (row) => row.raw.assignedTo],
  ['assignedAt', 'Assigned At', DATETIME, (row) => row.raw.assignedAt],
  ['meterNumber', 'Meter Number', TEXT, (row) => meterSerialOf(row)],
  ['meterType', 'Meter Type', TEXT, (row) => row.meterType],
  ['sealNumber', 'Seal Number', TEXT, (row) => (jed(row) ? row.raw.sealNo : row.raw.sealNumber)],
  ['installationPosition', 'Installation Position', TEXT, (row) => row.raw.installationPosition],
  ['feederName', 'Feeder', TEXT, (row) => row.raw.feederName],
  ['transformerName', 'Transformer', TEXT, (row) => row.raw.transformerName],
  ['transformerCode', 'Transformer Code', TEXT, (row) => row.raw.transformerCode],
  ['latitude', 'Latitude', COORDINATE, (row) => getCoordinates(row.raw)?.latitude ?? null],
  ['longitude', 'Longitude', COORDINATE, (row) => getCoordinates(row.raw)?.longitude ?? null],
  ['discoSupervisor', 'DisCo Supervisor', TEXT, (row) => row.raw.discoSupervisor],
  // The persisted picture link (the public /files/{token} URL the upload
  // returned) as a clickable hyperlink whose full URL is also the cell text.
  ['photoUrl', 'Installation Picture Link', LINK, (row) => row.raw.installationPhotoUrl],
  // The picture itself, embedded when it could be fetched (see
  // buildCompletedInstallationsReport's `photos`); the cell text is left empty.
  ['photo', 'Installation Picture', IMAGE, () => null],
  ['notes', 'Installation Notes', TEXT, (row) => row.raw.notes],
  ['meterVendor', 'Meter Vendor', TEXT, (row) => row.raw.meterVendor],
  // Meter record (joined by serial from GET /meters)
  ['simNumber', 'SIM Serial Number', TEXT, (row, meter) => meter?.simNumber],
  // Read through meterDisplay so the export names the same fields the screens
  // do — `meterMake` is the API's only make field, `model` is separate.
  ['meterMake', 'Meter Make', TEXT, (row, meter) => meterMakeOf(meter)],
  ['meterModel', 'Meter Model', TEXT, (row, meter) => meterModelOf(meter)],
  ['manufacturedDate', 'Meter Manufactured Date', TEXT, (row, meter) => manufacturedDateOf(meter)],
  ['sgcNumber', 'SGC Number', TEXT, (row, meter) => meter?.sgcNumber],
  ['meterPhase', 'Meter Phase (inventory)', TEXT, (row, meter) => meter?.phaseType],
  ['meterStatus', 'Meter Status (inventory)', TEXT, (row, meter) => meter?.status],
];

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

// Kept even when every exported row is blank — the installation facts the
// report exists for. A blank cell then says "not recorded"; dropping the
// column (the old behaviour) made it look as if the report had no such field,
// which is how the picture column went missing.
const ALWAYS_KEYS = new Set([
  'accountNumber', 'customerName', 'customerAddress', 'status', 'installationDate', 'installerName',
  'assignedAt', 'meterNumber', 'meterType', 'sealNumber', 'latitude', 'longitude', 'discoSupervisor',
  'photoUrl',
]);
// Money: only for a role with PAYMENTS.VIEW (a Supervisor exports without it).
const PAYMENT_KEYS = new Set(['rrr', 'orderId', 'amount', 'paymentStatus', 'datePaid']);
// Customer contact details: admin tier only, as on screen.
const CONTACT_KEYS = new Set(['customerPhone', 'customerEmail']);

/**
 * @param {object} args
 * @param {object[]} args.rows - normalized rows, already scoped/filtered
 * @param {Map<string, object>} [args.meterIndex]
 * @param {{ scopeLabel: string, filters: string[], generatedAt: Date, meterDetails: string }} args.context
 * @param {boolean} [args.includePayment] - PAYMENTS.VIEW
 * @param {boolean} [args.includeContact] - admin tier
 * @param {Map<string, { buffer: ArrayBuffer, extension: string }>|null} [args.photos]
 *   picture URL → fetched image, to embed. Absent/null: no picture column.
 * @returns {{ sheets: import('./xlsx').XlsxSheet[], count: number }}
 */
export function buildCompletedInstallationsReport({
  rows, meterIndex = new Map(), context, includePayment = true, includeContact = true, photos = null,
}) {
  const completed = rows
    .filter(isCompletedRow)
    .map((row) => ({ row, date: completionDateOf(row) || '' }))
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
    .map((x) => x.row);

  const records = completed.map((row) => {
    const meter = meterIndex.get(meterSerialOf(row));
    const out = {};
    COLUMNS.forEach(([key, , , get]) => {
      const v = get(row, meter);
      out[key] = isBlank(v) ? null : v;
    });
    return out;
  });

  const allowed = ([key]) => (includePayment || !PAYMENT_KEYS.has(key))
    && (includeContact || !CONTACT_KEYS.has(key))
    && (key !== 'photo' || !!photos);
  const columns = COLUMNS
    .filter(allowed)
    .filter(([key]) => key === 'photo' || ALWAYS_KEYS.has(key) || records.some((r) => !isBlank(r[key])))
    .map(([key, header, type]) => ({ header, key, type }));

  // Embedded pictures, by data row.
  const images = [];
  if (photos) {
    records.forEach((r, index) => {
      const img = r.photoUrl ? photos.get(String(r.photoUrl)) : null;
      if (img) images.push({ row: index, key: 'photo', buffer: img.buffer, extension: img.extension });
    });
  }
  const withPicture = records.filter((r) => !isBlank(r.photoUrl)).length;

  // Summary
  const bySource = {};
  const byDisco = {};
  let paid = 0;
  records.forEach((r) => {
    bySource[r.source] = (bySource[r.source] || 0) + 1;
    const d = r.disco || 'Not recorded';
    byDisco[d] = (byDisco[d] || 0) + 1;
    if (typeof r.amount === 'number') paid += r.amount;
  });
  const matchedMeters = completed.filter((row) => meterIndex.has(meterSerialOf(row))).length;

  const summaryRows = [
    { item: 'Report', value: 'Completed installations' },
    { item: 'Generated', value: context.generatedAt.toLocaleString() },
    { item: 'DisCo scope', value: context.scopeLabel },
    { item: 'Filters', value: context.filters.length ? context.filters.join('; ') : 'None' },
    { item: 'Completed statuses included', value: 'Installed, Exported (imported jobs); Completed (JED Remita requests)' },
    { item: 'Completed installations', value: String(records.length) },
    ...Object.entries(bySource).map(([k, v]) => ({ item: `  ${k}`, value: String(v) })),
    ...Object.entries(byDisco).sort().map(([k, v]) => ({ item: `  DisCo ${k}`, value: String(v) })),
    ...(includePayment
      ? [{ item: 'Total amount paid (JED Remita requests)', value: `₦${paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }]
      : []),
    { item: 'Installation pictures', value: `${withPicture} of ${records.length} have a picture link${photos ? `; ${images.length} embedded` : ''}` },
    { item: 'Meter details matched', value: `${matchedMeters} of ${records.length}${context.meterDetails ? ` (${context.meterDetails})` : ''}` },
    { item: 'Data completeness', value: 'Every record in the selected scope was loaded before export.' },
  ];

  return {
    count: records.length,
    sheets: [
      { name: 'Completed Installations', columns, rows: records, images },
      {
        name: 'Summary',
        autoFilter: false,
        columns: [
          { header: 'Item', key: 'item', type: TEXT, width: 42 },
          { header: 'Value', key: 'value', type: TEXT, width: 70 },
        ],
        rows: summaryRows,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Installation details for ONE installed meter (Meter Schedule → Installed).
//
// Reads each field through the export's own column definitions above, so the
// screen and the workbook can never disagree about which API field is the
// customer's phone, the seal, the installer, and so on. A field the record
// doesn't carry comes back null — nothing is filled in.
// ---------------------------------------------------------------------------
const DETAIL_KEYS = [
  'source', 'disco', 'status', 'accountNumber', 'customerName', 'customerPhone', 'customerAddress',
  'meterType', 'installationDate', 'completedAt', 'installerName', 'installerId', 'assignedAt',
  'sealNumber', 'latitude', 'longitude', 'photoUrl', 'discoSupervisor', 'notes',
];
const COLUMN_BY_KEY = new Map(COLUMNS.map((c) => [c[0], c]));

/** @param {object} row - a normalised row (normalizeMultiRow / normalizeJedRow) */
export function installationDetailsOf(row) {
  const out = {};
  DETAIL_KEYS.forEach((key) => {
    const value = COLUMN_BY_KEY.get(key)[3](row, null);
    out[key] = value === undefined || value === '' ? null : value;
  });
  return out;
}

/**
 * meterNumber → installation details, for completed installations only.
 * A meter reported on two records keeps the first and is counted in
 * `conflicts` rather than silently merged.
 * @returns {{ index: Map<string, object>, conflicts: number }}
 */
export function indexInstallationsByMeter(rows = []) {
  const index = new Map();
  let conflicts = 0;
  rows.filter(isCompletedRow).forEach((row) => {
    const serial = meterSerialOf(row);
    if (!serial) return;
    if (index.has(serial)) { conflicts += 1; return; }
    index.set(serial, installationDetailsOf(row));
  });
  return { index, conflicts };
}
