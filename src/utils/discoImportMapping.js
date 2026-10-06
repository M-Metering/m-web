// src/utils/discoImportMapping.js
// A disco's spreadsheet import mapping (GET /discos/{code} → importMapping,
// PUT /discos/{code}/import-mapping, POST /discos { importMapping }).
//
// Discos are SERVER DATA, not code: adding one (e.g. PHEDC) means registering
// it with a mapping that tells the server's importer which spreadsheet header
// fills which InstallationRequest field. Nothing in the app branches on a
// disco code; every disco selector reads GET /discos.
//
// The server parses the file — this module only builds and checks the
// mapping. Rules it mirrors from the spec:
//   - header aliases are matched after normalisation (case, spacing and
//     punctuation ignored) — `normalizeHeader`;
//   - `required` fields must be present in the sheet, or the import is a 400;
//   - `keyField` (accountNumber) is the per-disco duplicate key: a row whose
//     account already exists for the disco is skipped, not errored;
//   - `captureExtras` keeps every unmapped column on the record's `extras`;
//   - the PUT REPLACES the whole object, so `toServerMapping` always starts
//     from the disco's current mapping and changes only pendingInstallations.

/** "ACCOUNT_NO", "Account No." and "account no" all compare as "ACCOUNTNO". */
export const normalizeHeader = (header) => String(header ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * The InstallationRequest fields a pending-installations sheet can fill —
 * exactly the documented POST /installations body (minus discoCode, which the
 * import route supplies). `aliases` are sent as the field's headers when a
 * mapping is started from scratch; `alsoMatches` are only used to suggest a
 * column from a sample file, because they are ambiguous on their own (a sheet
 * can carry both an 11 kV and a 33 kV feeder column).
 */
export const IMPORT_FIELDS = Object.freeze([
  { field: 'accountNumber', label: 'Account number', transform: 'text', required: true, aliases: ['ACCOUNTNUMBER', 'ACCOUNTNO', 'ACCTNO'] },
  { field: 'customerName', label: 'Customer name', transform: 'trim', required: true, aliases: ['CUSTOMERNAME', 'CUSTNAMES', 'NAME'] },
  { field: 'customerAddress', label: 'Address', transform: 'trim', aliases: ['CUSTOMERADDRESS', 'ADDRESS'] },
  { field: 'customerPhone', label: 'Phone', transform: 'ngPhone', aliases: ['CUSTOMERPHONENUMBER', 'PHONENUMBER', 'GSM', 'PHONE'] },
  { field: 'customerEmail', label: 'Email', transform: 'trim', aliases: ['CUSTOMEREMAIL', 'EMAIL'] },
  { field: 'region', label: 'Region', transform: 'trim', aliases: ['REGION'] },
  { field: 'area', label: 'Area', transform: 'trim', aliases: ['AREA', 'AREAOFFICE'] },
  { field: 'feederName', label: 'Feeder', transform: 'trim', aliases: ['FEEDERNAME', 'FEEDER'], alsoMatches: ['FEEDER11NAME', 'FEEDER11KV', 'FEEDER33NAME', 'FEEDER33KV'] },
  { field: 'transformerName', label: 'Transformer (DT) name', transform: 'trim', aliases: ['TRANSFORMERNAME', 'DTNAME', 'DTRNAME', 'DT'] },
  { field: 'transformerCode', label: 'Transformer (DT) ID', transform: 'text', aliases: ['TRANSFORMERCODE', 'DTCODE', 'DTID', 'DTRID'] },
  { field: 'installationPosition', label: 'Installation position', transform: 'upper', aliases: ['RECOMMENDEDMETERINSTALLATIONPOSITION', 'INSTALLATIONPOSITION', 'METERPOSITION'] },
  // Never required by default: a customer sheet may carry no meter type, and
  // one is never invented. An installation without a type is counted but
  // unpriced, and no meter can be dispatched against it under the capacity
  // rule until it has one (utils/meterCapacity.js).
  { field: 'meterType', label: 'Meter type', transform: 'phase', aliases: ['RECOMMENDEDMETERTYPE', 'METERTYPE', 'METERRECOMMENDED'] },
  { field: 'meterVendor', label: 'Meter vendor', transform: 'trim', aliases: ['METERVENDOR', 'VENDOR'] },
]);

const FIELD_BY_NAME = new Map(IMPORT_FIELDS.map((f) => [f.field, f]));
export const KEY_FIELD = 'accountNumber';

/** Comma/semicolon/newline-separated header list → trimmed, de-duplicated. */
export function parseHeaderList(text) {
  const seen = new Set();
  return String(text ?? '')
    .split(/[,;\n]+/)
    .map((h) => h.trim())
    .filter((h) => {
      const key = normalizeHeader(h);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** A cell that carries no information: blank, or only dashes/dots/slashes. */
export const isPlaceholderValue = (value) => /^[\s\-_.,/\\*#]*$/.test(String(value ?? ''));

/** Headers of a parsed sheet (readSpreadsheetRows output), in first-seen order. */
export function sheetHeaders(rows = []) {
  const headers = [];
  const seen = new Set();
  rows.forEach((row) => Object.keys(row || {}).forEach((h) => {
    if (!seen.has(h)) { seen.add(h); headers.push(h); }
  }));
  return headers;
}

/**
 * The editable form of a mapping: one entry per IMPORT_FIELDS field
 * ({ headers: 'A, B', required }) plus captureExtras. Starts from the disco's
 * stored pendingInstallations mapping, or the defaults when there is none.
 */
export function toMappingForm(importMapping) {
  const stored = importMapping?.pendingInstallations;
  const fields = {};
  IMPORT_FIELDS.forEach((def) => {
    const current = stored ? stored.fields?.[def.field] : null;
    const headers = stored ? (current?.headers || []) : def.aliases;
    fields[def.field] = {
      headers: headers.join(', '),
      required: stored ? Boolean(current?.required) : Boolean(def.required),
    };
  });
  return { fields, captureExtras: stored ? stored.captureExtras !== false : true };
}

/**
 * Pre-fill the form from a sample sheet: each field takes the sheet's own
 * header when one of its aliases (or alsoMatches) is present AND the column
 * has real values. A column of placeholders ("-----") is never suggested, so
 * it stays an extra. Each header is claimed by one field at most. Fields the
 * sheet has no column for keep their current headers.
 */
export function suggestMappingForm(form, rows = []) {
  const headers = sheetHeaders(rows);
  const hasValues = (h) => rows.some((row) => !isPlaceholderValue(row?.[h]));
  const byKey = new Map(headers.map((h) => [normalizeHeader(h), h]));
  const claimed = new Set();
  const fields = { ...form.fields };
  IMPORT_FIELDS.forEach((def) => {
    const candidates = [...def.aliases, ...(def.alsoMatches || [])];
    const match = candidates
      .map((alias) => byKey.get(alias))
      .find((h) => h && !claimed.has(h) && hasValues(h));
    if (match) {
      claimed.add(match);
      fields[def.field] = { ...fields[def.field], headers: match };
    }
  });
  return { ...form, fields };
}

/**
 * Problems that would make the server reject the mapping or every import:
 * the key field and customer name need a header and must be required (the API
 * requires both on an installation), and one header may not feed two fields.
 * @returns {string[]} messages, empty when the form is valid
 */
export function validateMappingForm(form) {
  const errors = [];
  const owner = new Map();
  IMPORT_FIELDS.forEach((def) => {
    const entry = form?.fields?.[def.field] || {};
    const headers = parseHeaderList(entry.headers);
    if (def.required && headers.length === 0) errors.push(`${def.label} needs at least one spreadsheet header.`);
    if (def.required && headers.length > 0 && !entry.required) errors.push(`${def.label} must be required.`);
    if (!def.required && entry.required && headers.length === 0) errors.push(`${def.label} is marked required but has no header.`);
    headers.forEach((h) => {
      const key = normalizeHeader(h);
      if (owner.has(key) && owner.get(key) !== def.label) {
        errors.push(`"${h}" is used for both ${owner.get(key)} and ${def.label}.`);
      } else {
        owner.set(key, def.label);
      }
    });
  });
  return errors;
}

/**
 * The complete importMapping to send. Starts from `base` (the disco's current
 * mapping) so every other import type — meterInventory — and every stored
 * per-field option (transform, keepRaw, padStart) survives the whole-object
 * replace. A field the form leaves without headers is removed; fields this
 * app doesn't know about are kept untouched.
 */
export function toServerMapping(form, base = {}) {
  const baseMapping = base && typeof base === 'object' ? base : {};
  const pending = baseMapping.pendingInstallations || {};
  const fields = { ...(pending.fields || {}) };
  IMPORT_FIELDS.forEach((def) => {
    const entry = form.fields[def.field] || {};
    const headers = parseHeaderList(entry.headers);
    if (headers.length === 0) {
      delete fields[def.field];
      return;
    }
    fields[def.field] = {
      transform: def.transform,
      ...(fields[def.field] || {}),
      headers,
      required: Boolean(entry.required),
    };
  });
  return {
    ...baseMapping,
    pendingInstallations: {
      sheetIndex: 0,
      headerRow: 1,
      ...pending,
      keyField: pending.keyField || KEY_FIELD,
      captureExtras: Boolean(form.captureExtras),
      fields,
    },
  };
}

/**
 * The meterInventory section a NEW disco starts with, copied from an existing
 * disco so its meter imports behave the same. `padStart` is dropped from the
 * copy: meter numbers are 10–13 digits and are never padded (CLAUDE.md,
 * identifier rules; API_GAP_REPORT.md notes the server-side twin).
 */
export function meterInventoryForNewDisco(sourceMapping) {
  const inventory = sourceMapping?.meterInventory;
  if (!inventory || typeof inventory !== 'object') return null;
  const fields = {};
  Object.entries(inventory.fields || {}).forEach(([name, spec]) => {
    const copy = { ...(spec || {}) };
    delete copy.padStart;
    fields[name] = copy;
  });
  return { ...inventory, fields };
}

/**
 * Check a parsed sheet against a pendingInstallations mapping, the way the
 * server will read it — a preview, never the gate (the server validates).
 * @param {object[]} rows - readSpreadsheetRows(...).rows (every cell a string)
 * @param {object} pending - importMapping.pendingInstallations
 */
export function checkSheetAgainstMapping(rows = [], pending = {}) {
  const headers = sheetHeaders(rows);
  const byKey = new Map(headers.map((h) => [normalizeHeader(h), h]));
  const used = new Set();
  const columns = Object.entries(pending?.fields || {}).map(([field, spec]) => {
    const header = (spec?.headers || []).map((h) => byKey.get(normalizeHeader(h))).find(Boolean) || null;
    if (header) used.add(header);
    return {
      field,
      label: FIELD_BY_NAME.get(field)?.label || field,
      header,
      required: Boolean(spec?.required),
      blank: header ? rows.filter((row) => isPlaceholderValue(row?.[header])).length : null,
    };
  });

  const keyField = pending?.keyField || KEY_FIELD;
  const keyHeader = columns.find((c) => c.field === keyField)?.header || null;
  const seen = new Map();
  if (keyHeader) {
    rows.forEach((row) => {
      const key = String(row?.[keyHeader] ?? '').trim();
      if (key) seen.set(key, (seen.get(key) || 0) + 1);
    });
  }
  const duplicateKeys = [...seen.entries()].filter(([, n]) => n > 1).map(([key, count]) => ({ key, count }));

  return {
    rowCount: rows.length,
    columns,
    missingRequired: columns.filter((c) => c.required && !c.header).map((c) => c.label),
    blankRequired: columns.filter((c) => c.required && c.header && c.blank > 0).map((c) => ({ label: c.label, count: c.blank })),
    unmappedHeaders: headers.filter((h) => !used.has(h)),
    captureExtras: Boolean(pending?.captureExtras),
    keyHeader,
    duplicateKeys,
  };
}

/**
 * The columns an import kept on a record without a field of their own
 * (`captureExtras` → the record's `extras`), as label/value pairs. The API
 * documents no schema for `extras` (API_GAP_REPORT.md, gap F), so anything
 * that isn't a flat object of scalar values is ignored, and placeholder
 * cells ("-----") are left out. Values are shown verbatim, never reformatted.
 */
export function importExtrasOf(record) {
  let extras = record?.extras;
  if (typeof extras === 'string') {
    try { extras = JSON.parse(extras); } catch { return []; }
  }
  if (!extras || typeof extras !== 'object' || Array.isArray(extras)) return [];
  return Object.entries(extras)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) && !isPlaceholderValue(value))
    .map(([label, value]) => ({ label, value: String(value).trim() }));
}

/** POST /discos code rule: upper-case letters, digits and underscores. */
export const DISCO_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/;

/**
 * Problems with a new disco's code/name, or [] when it can be registered.
 * A code starting with "JED" is refused: installationScope.js attributes every
 * such code to JED's Remita flow, so a new disco there would be mis-scoped.
 */
export function validateNewDisco({ code, name }, existing = []) {
  const errors = [];
  const c = String(code ?? '').trim().toUpperCase();
  if (!DISCO_CODE_PATTERN.test(c)) errors.push('Code must be 2–32 capital letters, digits or underscores, starting with a letter (e.g. PHEDC).');
  else if (/^JED/.test(c)) errors.push('Codes starting with JED are reserved for JED.');
  else if (existing.some((d) => String(d?.code ?? '').toUpperCase() === c)) errors.push(`${c} is already registered.`);
  if (!String(name ?? '').trim()) errors.push('Name is required.');
  return errors;
}
