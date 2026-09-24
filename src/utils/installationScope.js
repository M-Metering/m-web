// src/utils/installationScope.js
// Disco scoping, normalisation, filtering and sorting for the Installation
// Requests screen, which shows BOTH installation domains side by side:
//
//   - MULTI: `InstallationRequest` records (GET /installations) — integer id,
//     disco-scoped, PENDING → ASSIGNED → IN_PROGRESS → INSTALLED → EXPORTED.
//   - JED:   `JedCustomerRequest` records (GET /external/jed/requests) — the
//     Remita flow, keyed by accountNumber, INITIATED → PAID → COMPLETED.
//
// The two are never merged into one status scheme (see CLAUDE.md, "Two
// installation domains"). Each row keeps its own real status; the two status
// sets don't overlap, so one status filter can span both without namespacing.
//
// Why this exists: the screen used to query only GET /installations, so
// choosing JED showed nothing and "All discos" silently meant "every disco
// except JED" — JED's requests live in a different resource entirely.
import { normalizeStatus, JED_STATUS_LABELS } from './statusBadge';
import { INSTALLATION_STATUS_ORDER, installationStatusLabel } from './installationStatus';

export const ROW_SOURCE = Object.freeze({ MULTI: 'MULTI', JED: 'JED' });

/** Dropdown value for "JED's Remita requests" when JED is not a registered disco. */
export const JED_FLOW_SCOPE = '__JED__';

/** Attribution bucket for Remita requests that don't carry a registered disco's code. */
export const JED_BUCKET = 'JED';

export const JED_STATUS_ORDER = ['INITIATED', 'PAID', 'COMPLETED'];

// Re-exported from statusBadge.js, which owns the JED status vocabulary for
// the whole app (this module used to declare its own copy).
export { JED_STATUS_LABELS };

/** Sentinel filter value for rows where the attribute is blank. */
export const NOT_RECORDED = '__NONE__';

/** JED's disco codes start with "JED" (e.g. the spec's example "JED001"). */
export const isJedDiscoCode = (code) => /^JED/i.test(String(code || '').trim());

const upperKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * Phase values arrive as "SINGLE PHASE" (multi-disco), "Single Phase" (JED)
 * or occasionally with underscores — one comparable form for all of them.
 */
export const normalizePhase = (value) => upperKey(String(value ?? '').replace(/[_-]+/g, ' '));

/**
 * A phase for display: 'THREE PHASE' → 'Three Phase'. One spelling everywhere
 * a phase is named to the user (capacity figures, assignment errors).
 */
export const formatPhaseLabel = (value) => {
  const key = normalizePhase(value);
  if (!key || key === 'UNSPECIFIED') return 'Unspecified';
  return key.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
};

/**
 * Dropdown options: "All discos", every registered disco, and — only when no
 * registered disco is JED — a separate entry for JED's Remita requests, so
 * JED never appears twice.
 */
export function buildScopeOptions(discos = []) {
  const options = [{ value: '', label: 'All discos' }];
  discos.forEach((d) => {
    if (!d?.code) return;
    options.push({ value: d.code, label: d.name ? `${d.name} (${d.code})` : d.code });
  });
  if (!discos.some((d) => isJedDiscoCode(d?.code))) {
    options.push({ value: JED_FLOW_SCOPE, label: 'JED (Remita requests)' });
  }
  return options;
}

/**
 * What a scope value means for data loading.
 * @returns {{ includeMulti: boolean, multiDiscoCode: string, remitaBucket: string|null }}
 *   multiDiscoCode '' = every disco. remitaBucket null = every Remita request;
 *   otherwise only requests attributed to that bucket (see attributeRemitaRecord).
 */
export function resolveScope(scope) {
  if (!scope) return { includeMulti: true, multiDiscoCode: '', remitaBucket: null };
  if (scope === JED_FLOW_SCOPE) return { includeMulti: false, multiDiscoCode: '', remitaBucket: JED_BUCKET };
  return {
    includeMulti: true,
    multiDiscoCode: scope,
    remitaBucket: isJedDiscoCode(scope) ? JED_BUCKET : upperKey(scope),
  };
}

/**
 * Which disco a Remita (JED-flow) request belongs to. A request whose own
 * `discoCode` equals a registered non-JED disco's code belongs to that disco;
 * everything else is JED's (the Remita integration is JED's, and its records
 * carry JED's internal codes such as "JED001").
 */
export function attributeRemitaRecord(record, nonJedCodes) {
  const code = upperKey(record?.discoCode);
  return code && nonJedCodes.has(code) ? code : JED_BUCKET;
}

/** Upper-cased codes of the registered discos that aren't JED. */
export const nonJedCodeSet = (discos = []) =>
  new Set(discos.map((d) => upperKey(d?.code)).filter((c) => c && !isJedDiscoCode(c)));

const text = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

export function normalizeMultiRow(r) {
  return {
    key: `M-${r.id}`,
    source: ROW_SOURCE.MULTI,
    id: r.id,
    accountNumber: r.accountNumber != null ? String(r.accountNumber) : '',
    customerName: text(r.customerName),
    customerAddress: text(r.customerAddress),
    discoCode: text(r.discoCode),
    status: normalizeStatus(r.status),
    meterType: normalizePhase(r.meterType),
    feederName: text(r.feederName),
    transformerName: text(r.transformerName) || text(r.transformerCode),
    installationPosition: text(r.installationPosition),
    region: text(r.region),
    area: text(r.area),
    meterVendor: text(r.meterVendor),
    installer: text(r.assigneeName),
    meterNumber: r.meterNumber != null ? String(r.meterNumber) : '',
    requestedAt: r.createdAt || null,
    // When this pending installation entered ME Metering. An imported row is
    // created by the import itself, so the record's own createdAt IS the
    // import timestamp — the API exposes no separate importedAt/importBatchId
    // on an InstallationRequest (see API_GAP_REPORT.md). Deliberately NOT the
    // assignment date (assignedAt) or the installation date
    // (installationDate/reportedAt), which are separate events.
    importedAt: r.createdAt || null,
    assignedAt: r.assignedAt || null,
    raw: r,
  };
}

export function normalizeJedRow(r, bucket) {
  return {
    key: `J-${r.accountNumber ?? r.id}`,
    source: ROW_SOURCE.JED,
    id: r.id,
    accountNumber: r.accountNumber != null ? String(r.accountNumber) : '',
    customerName: text(r.custNames),
    customerAddress: text(r.address),
    discoCode: text(r.discoCode),
    bucket,
    status: normalizeStatus(r.status),
    meterType: normalizePhase(r.meterType || r.meterRecommended),
    // Not on the JedCustomerRequest schema — left blank, never invented.
    feederName: '',
    transformerName: '',
    installationPosition: '',
    region: text(r.region),
    area: '',
    meterVendor: '',
    installer: '',
    meterNumber: r.meterNo != null ? String(r.meterNo) : '',
    requestedAt: r.dateRequested || null,
    // A Remita request is created by JED calling generate-ref, not by an
    // import — it has no import date. dateRequested is the request date and
    // must never stand in for one.
    importedAt: null,
    assignedAt: null,
    raw: r,
  };
}

/** Drop repeated records within one source (same id, or same JED account). */
export function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (seen.has(row.key)) return false;
    seen.add(row.key);
    return true;
  });
}

export const rowStatusLabel = (row) =>
  row.source === ROW_SOURCE.JED
    ? JED_STATUS_LABELS[row.status] || row.status || 'Unknown'
    : installationStatusLabel(row.status);

/** Statuses that can appear in a scope, in lifecycle order. */
export function statusesForScope({ includeMulti, includeJed }) {
  return [
    ...(includeMulti ? INSTALLATION_STATUS_ORDER.map((s) => ({ value: s, label: installationStatusLabel(s), source: ROW_SOURCE.MULTI })) : []),
    ...(includeJed ? JED_STATUS_ORDER.map((s) => ({ value: s, label: JED_STATUS_LABELS[s], source: ROW_SOURCE.JED })) : []),
  ];
}

// Upload-derived attributes the Admin can filter on. The first four are the
// ones the business asked for; the rest are shown only when data has them.
export const ATTRIBUTE_FILTERS = [
  { field: 'feederName', label: 'Feeder', always: true },
  { field: 'transformerName', label: 'Transformer', always: true },
  { field: 'meterType', label: 'Meter type', always: true },
  { field: 'installationPosition', label: 'Installation position', always: true },
  { field: 'region', label: 'Region' },
  { field: 'area', label: 'Area' },
  { field: 'meterVendor', label: 'Meter vendor' },
  { field: 'installer', label: 'Installer' },
];

/**
 * Distinct values of one attribute across `rows`, with counts. Values are
 * grouped case-insensitively; blanks collapse into a single "Not recorded".
 * @returns {{ value: string, label: string, count: number }[]}
 */
export function buildFilterOptions(rows, field) {
  const groups = new Map();
  let blanks = 0;
  rows.forEach((row) => {
    const raw = row[field];
    const key = upperKey(raw);
    if (!key) { blanks += 1; return; }
    const g = groups.get(key);
    if (g) g.count += 1;
    else groups.set(key, { value: key, label: text(raw), count: 1 });
  });
  const options = Array.from(groups.values()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
  );
  if (blanks > 0 && options.length > 0) options.push({ value: NOT_RECORDED, label: 'Not recorded', count: blanks });
  return options;
}

const matchesAttribute = (row, field, wanted) => {
  if (!wanted) return true;
  const key = upperKey(row[field]);
  return wanted === NOT_RECORDED ? key === '' : key === wanted;
};

const SEARCH_FIELDS = ['accountNumber', 'customerName', 'meterNumber', 'customerAddress', 'feederName', 'transformerName'];

/** Rows satisfying every active attribute filter and the search text (status excluded). */
export function applyAttributeFilters(rows, { attributes = {}, search = '' } = {}) {
  const term = search.trim().toLowerCase();
  const active = Object.entries(attributes).filter(([, v]) => v);
  return rows.filter((row) => {
    for (const [field, wanted] of active) {
      if (!matchesAttribute(row, field, wanted)) return false;
    }
    if (term && !SEARCH_FIELDS.some((f) => String(row[f] || '').toLowerCase().includes(term))) return false;
    return true;
  });
}

export const applyStatusFilter = (rows, status) =>
  status ? rows.filter((row) => row.status === status) : rows;

const PLAIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A timestamp's local calendar date as 'YYYY-MM-DD', or null. */
export function localDateOf(value) {
  if (!value) return null;
  if (typeof value === 'string' && PLAIN_DATE_RE.test(value)) return value;
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/** The date this row was imported, as 'YYYY-MM-DD', or null when it wasn't imported. */
export const importDateOf = (row) => localDateOf(row?.importedAt);

/**
 * Keep rows imported within [from, to] inclusive (either may be ''). Rows
 * with no import date — JED's Remita requests — are excluded whenever the
 * filter is active, because "imported between X and Y" is not true of them.
 * This filters on the import date ONLY; assignment, payment and installation
 * dates are untouched.
 */
export function filterByImportDate(rows, from, to) {
  if (!from && !to) return rows;
  return rows.filter((row) => {
    const d = importDateOf(row);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

/** Per-status counts for exactly the rows given. */
export function countByStatus(rows) {
  const counts = {};
  rows.forEach((row) => { counts[row.status] = (counts[row.status] || 0) + 1; });
  return counts;
}

const STATUS_RANK = new Map(
  [...INSTALLATION_STATUS_ORDER, ...JED_STATUS_ORDER].map((s, i) => [s, i])
);

export const SORT_OPTIONS = [
  { value: 'requestedAt', label: 'Request date' },
  { value: 'importedAt', label: 'Import date' },
  { value: 'status', label: 'Status' },
  { value: 'feederName', label: 'Feeder' },
  { value: 'transformerName', label: 'Transformer' },
  { value: 'meterType', label: 'Meter type' },
  { value: 'installationPosition', label: 'Installation position' },
  { value: 'customerName', label: 'Customer' },
];

const timeOf = (value) => {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
};

/**
 * Stable sort. Blank values always go last, whichever direction is chosen,
 * so "sort by feeder" never leads with a page of unrecorded rows.
 */
export function sortRows(rows, key = 'requestedAt', direction = 'desc') {
  const dir = direction === 'asc' ? 1 : -1;
  const valueOf = (row) => {
    if (key === 'requestedAt' || key === 'importedAt') return timeOf(row[key]);
    if (key === 'status') return STATUS_RANK.has(row.status) ? STATUS_RANK.get(row.status) : null;
    const v = text(row[key]);
    return v === '' ? null : v;
  };
  return rows
    .map((row, index) => ({ row, index, v: valueOf(row) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.index - b.index;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const cmp = typeof a.v === 'number' && typeof b.v === 'number'
        ? a.v - b.v
        : String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: 'base' });
      return cmp !== 0 ? cmp * dir : a.index - b.index;
    })
    .map((x) => x.row);
}
