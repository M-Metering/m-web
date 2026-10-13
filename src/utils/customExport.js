// src/utils/customExport.js
// The custom installations export (API update 2026-10-13, §7):
//   GET  /installations/custom-export/fields  → the catalogue for the caller's role
//   POST /installations/custom-export         → the file (Excel or CSV)
//
// The builder is driven ENTIRELY by the catalogue — fields, their sections,
// types, operators and enum values, the date presets and buckets, metrics,
// formats and limits — so a field the backend adds appears without a frontend
// change, and a field the role may not use (a Supervisor's customer phone or
// revenue) simply isn't offered. Nothing here invents a field.
//
// This module owns: reading the catalogue, which value input an operator
// needs, plain-language labels, client-side checks, the exact request body,
// and mapping the server's per-input errors (`filters[2]: …`) back to inputs.

// Fallbacks only for a catalogue that omits `limits` (the documented values).
const DEFAULT_LIMITS = Object.freeze({ filters: 50, groupBy: 4, sort: 3 });
const MAX_LIST_VALUES = 500;

const DATE_TYPES = new Set(['date', 'datetime']);
const NUMBER_TYPES = new Set(['number', 'integer', 'currency', 'coordinate']);
const NO_VALUE_OPS = new Set(['isBlank', 'isNotBlank']);
const LIST_OPS = new Set(['in', 'notIn']);
const PLAIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isDateField = (field) => DATE_TYPES.has(field?.type);
export const isNumberField = (field) => NUMBER_TYPES.has(field?.type);

const OP_LABELS = Object.freeze({
  eq: 'is',
  in: 'is one of',
  notIn: 'is not one of',
  contains: 'contains',
  startsWith: 'starts with',
  gte: 'is at least',
  lte: 'is at most',
  between: 'is between',
  on: 'is on',
  preset: 'is in the period',
  isBlank: 'is blank',
  isNotBlank: 'is not blank',
});
const DATE_OP_LABELS = Object.freeze({ gte: 'is on or after', lte: 'is on or before' });

/** Plain-language operator label; dates read as "on or after", not "at least". */
export function opLabel(op, field) {
  if (isDateField(field) && DATE_OP_LABELS[op]) return DATE_OP_LABELS[op];
  return OP_LABELS[op] || humanize(op);
}

const PRESET_LABELS = Object.freeze({
  today: 'Today',
  yesterday: 'Yesterday',
  last7days: 'Last 7 days',
  last30days: 'Last 30 days',
  thisWeek: 'This week',
  lastWeek: 'Last week',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  thisYear: 'This year',
  lastYear: 'Last year',
});
export const presetLabel = (preset) => PRESET_LABELS[preset] || humanize(preset);

const BUCKET_LABELS = Object.freeze({
  day: 'By day',
  week: 'By week (starting Monday)',
  month: 'By month',
  year: 'By year',
});
export const bucketLabel = (bucket) => BUCKET_LABELS[bucket] || humanize(bucket);

/** An enum value as a person reads it: IN_PROGRESS → "In progress". */
export function enumLabel(value) {
  const s = String(value ?? '');
  if (!/^[A-Z0-9_]+$/.test(s)) return s;
  const words = s.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function humanize(key) {
  const s = String(key ?? '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The catalogue as the builder uses it, or null when the response carries no
 * usable fields (the builder then shows a load error — never guessed fields).
 */
export function parseCatalogue(response) {
  const data = response?.data ?? response;
  const fields = Array.isArray(data?.fields)
    ? data.fields.filter((f) => f && typeof f.key === 'string' && f.key)
    : [];
  if (fields.length === 0) return null;
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    fields,
    byKey: new Map(fields.map((f) => [f.key, f])),
    datePresets: list(data.datePresets),
    dateBuckets: list(data.dateBuckets),
    metrics: list(data.metrics).filter((m) => m && m.key),
    formats: list(data.formats).length > 0 ? data.formats : ['xlsx'],
    limits: { ...DEFAULT_LIMITS, ...(data.limits || {}) },
  };
}

/** Fields grouped by `section`, sections in the catalogue's own order. */
export function fieldsBySection(fields = []) {
  const sections = new Map();
  fields.forEach((f) => {
    const name = f.section || 'Other';
    if (!sections.has(name)) sections.set(name, []);
    sections.get(name).push(f);
  });
  return [...sections].map(([section, items]) => ({ section, fields: items }));
}

/** The columns ticked when the builder opens: the catalogue's `default: true`. */
export const defaultColumns = (fields = []) => fields.filter((f) => f.default === true).map((f) => f.key);

/**
 * Which value input a filter needs:
 *   none | enum | enumList | textList | text | number | numberRange |
 *   date | dateRange | preset | boolean
 */
export function valueKindFor(field, op) {
  if (!field || !op || NO_VALUE_OPS.has(op)) return 'none';
  if (op === 'preset') return 'preset';
  if (LIST_OPS.has(op)) return field.type === 'enum' ? 'enumList' : 'textList';
  if (op === 'between') return isDateField(field) ? 'dateRange' : 'numberRange';
  if (isDateField(field)) return 'date';
  if (field.type === 'boolean') return 'boolean';
  if (field.type === 'enum') return 'enum';
  if (isNumberField(field)) return 'number';
  return 'text';
}

/** The empty value a filter starts with for its kind. */
export function emptyValueFor(kind) {
  if (kind === 'enumList') return [];
  if (kind === 'dateRange' || kind === 'numberRange') return ['', ''];
  return '';
}

const splitList = (raw) => String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const isNumeric = (v) => String(v ?? '').trim() !== '' && Number.isFinite(Number(String(v).trim()));

/** The error for one filter row, or null. */
function filterError(filter, catalogue) {
  const field = catalogue.byKey.get(filter.field);
  if (!field) return 'Choose a field.';
  if (!filter.op || !(field.ops || []).includes(filter.op)) return 'Choose a condition.';
  const kind = valueKindFor(field, filter.op);
  const v = filter.value;
  switch (kind) {
    case 'none':
      return null;
    case 'enumList':
      if (!Array.isArray(v) || v.length === 0) return 'Choose at least one value.';
      return v.length > MAX_LIST_VALUES ? `Choose at most ${MAX_LIST_VALUES} values.` : null;
    case 'textList': {
      const items = splitList(v);
      if (items.length === 0) return 'Enter at least one value (separate several with commas).';
      return items.length > MAX_LIST_VALUES ? `Enter at most ${MAX_LIST_VALUES} values.` : null;
    }
    case 'dateRange': {
      const [from, to] = Array.isArray(v) ? v : [];
      if (!PLAIN_DATE_RE.test(from || '') || !PLAIN_DATE_RE.test(to || '')) return 'Choose both dates.';
      return from > to ? 'The start date must be on or before the end date.' : null;
    }
    case 'numberRange': {
      const [from, to] = Array.isArray(v) ? v : [];
      if (!isNumeric(from) || !isNumeric(to)) return 'Enter both numbers.';
      return Number(from) > Number(to) ? 'The first number must not be larger than the second.' : null;
    }
    case 'date':
      return PLAIN_DATE_RE.test(v || '') ? null : 'Choose a date.';
    case 'number':
      return isNumeric(v) ? null : 'Enter a number.';
    case 'boolean':
      return v === 'true' || v === 'false' ? null : 'Choose Yes or No.';
    default:
      return String(v ?? '').trim() ? null : 'Enter a value.';
  }
}

/**
 * Client-side checks before sending, keyed by the same locations the server
 * uses (`columns`, `filters[2]`, `groupBy[0]`, `sort[1]`).
 * @returns {Record<string, string>} empty when the request can be sent
 */
export function validateCustomExport(state, catalogue) {
  const errors = {};
  const { limits } = catalogue;
  const groupBy = state.groupBy || [];
  const filters = state.filters || [];
  const sort = state.sort || [];

  if ((state.columns || []).length === 0 && groupBy.length === 0) {
    errors.columns = 'Choose at least one column, or add a grouping to export totals only.';
  }
  if (filters.length > limits.filters) errors.filters = `Use at most ${limits.filters} filters.`;
  filters.forEach((f, i) => {
    const e = filterError(f, catalogue);
    if (e) errors[`filters[${i}]`] = e;
  });

  if (groupBy.length > limits.groupBy) errors.groupBy = `Group by at most ${limits.groupBy} fields.`;
  const seen = new Set();
  groupBy.forEach((g, i) => {
    const field = catalogue.byKey.get(g.field);
    if (!field || field.groupable !== true) errors[`groupBy[${i}]`] = 'Choose a field to group by.';
    else if (seen.has(g.field)) errors[`groupBy[${i}]`] = 'This field is already in the grouping.';
    seen.add(g.field);
  });

  if (sort.length > limits.sort) errors.sort = `Sort by at most ${limits.sort} fields.`;
  sort.forEach((s, i) => {
    if (!catalogue.byKey.has(s.field)) errors[`sort[${i}]`] = 'Choose a field to sort by.';
  });
  return errors;
}

function filterValue(kind, raw) {
  switch (kind) {
    case 'enumList': return [...raw];
    case 'textList': return splitList(raw);
    case 'dateRange': return [raw[0], raw[1]];
    case 'numberRange': return [Number(String(raw[0]).trim()), Number(String(raw[1]).trim())];
    case 'number': return Number(String(raw).trim());
    case 'boolean': return raw === 'true';
    default: return String(raw).trim();
  }
}

/**
 * The exact documented request body from a VALID builder state. Optional keys
 * are omitted when empty; metrics are only sent with a grouping (the API
 * refuses them otherwise); dates stay plain 'YYYY-MM-DD' strings.
 */
export function buildCustomExportRequest(state, catalogue) {
  const body = { format: state.format || 'xlsx' };
  if ((state.discoCodes || []).length > 0) body.discoCodes = [...state.discoCodes];

  const groupBy = (state.groupBy || []).map((g) => {
    const field = catalogue.byKey.get(g.field);
    return isDateField(field) ? `${g.field}:${g.bucket || 'day'}` : g.field;
  });

  // Columns in catalogue order, so the file reads like the picker.
  const chosen = new Set(state.columns || []);
  body.columns = catalogue.fields.filter((f) => chosen.has(f.key)).map((f) => f.key);

  const filters = (state.filters || []).map((f) => {
    const field = catalogue.byKey.get(f.field);
    const kind = valueKindFor(field, f.op);
    const out = { field: f.field, op: f.op };
    if (kind !== 'none') out.value = filterValue(kind, f.value);
    return out;
  });
  if (filters.length > 0) body.filters = filters;

  if (groupBy.length > 0) {
    body.groupBy = groupBy;
    if ((state.metrics || []).length > 0) body.metrics = [...state.metrics];
  }

  const sort = (state.sort || []).map((s) => ({ field: s.field, dir: s.dir === 'asc' ? 'asc' : 'desc' }));
  if (sort.length > 0) body.sort = sort;
  return body;
}

/**
 * The server's 400 `errors[]` keyed by the input they name. Each starts with
 * its location (`filters[2]`, `groupBy[0]`, `columns`, …); `filters[2].value`
 * belongs to the `filters[2]` row. Anything without a location is `general`.
 * @returns {Record<string, string[]>}
 */
const REQUEST_KEYS = 'format|discoCodes|columns|filters|groupBy|metrics|sort';
const LOCATION_RE = new RegExp(`^(${REQUEST_KEYS})(\\[\\d+\\])?`);

export function errorsByLocation(errors = []) {
  const out = {};
  (Array.isArray(errors) ? errors : []).forEach((e) => {
    const text = typeof e === 'string' ? e : String(e?.message ?? '');
    if (!text) return;
    const declared = e && typeof e === 'object' ? (e.location ?? e.path ?? e.field) : null;
    const match = String(declared ?? text).match(LOCATION_RE);
    const loc = match ? `${match[1]}${match[2] || ''}` : 'general';
    (out[loc] = out[loc] || []).push(text);
  });
  return out;
}
