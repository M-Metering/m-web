import { describe, it, expect } from 'vitest';
import {
  parseCatalogue, fieldsBySection, defaultColumns, valueKindFor, emptyValueFor, opLabel, presetLabel,
  enumLabel, validateCustomExport, buildCustomExportRequest, errorsByLocation,
} from '../customExport';

// The shape of GET /installations/custom-export/fields (API update 2026-10-13).
const CATALOGUE = {
  success: true,
  data: {
    fields: [
      { key: 'status', label: 'Status', section: 'Record', type: 'enum', ops: ['in', 'notIn', 'isBlank', 'isNotBlank'], groupable: true, default: true, values: ['PENDING', 'INSTALLED', 'EXPORTED'] },
      { key: 'accountNumber', label: 'Account number', section: 'Customer', type: 'text', ops: ['eq', 'in', 'contains', 'startsWith', 'isBlank'], default: true },
      { key: 'customerName', label: 'Customer', section: 'Customer', type: 'text', ops: ['eq', 'contains'], default: true },
      { key: 'installerName', label: 'Installer of record', section: 'Completion', type: 'text', ops: ['eq', 'in'], groupable: true },
      { key: 'reportedAt', label: 'Completed / Reported At', section: 'Completion', type: 'datetime', ops: ['on', 'gte', 'lte', 'between', 'preset', 'isBlank', 'isNotBlank'], groupable: true, default: true },
      { key: 'hasPicture', label: 'Has picture', section: 'Completion', type: 'boolean', ops: ['eq'] },
      { key: 'latitude', label: 'Latitude', section: 'Completion', type: 'coordinate', ops: ['gte', 'lte', 'between'] },
    ],
    datePresets: ['today', 'last7days', 'lastWeek'],
    dateBuckets: ['day', 'week', 'month', 'year'],
    metrics: [{ key: 'count', label: 'Installations' }, { key: 'withGps', label: 'With GPS' }],
    formats: ['xlsx', 'csv'],
    limits: { xlsx: 100000, csv: 500000, filters: 2, groupBy: 2, sort: 3 },
  },
};
const cat = parseCatalogue(CATALOGUE);
const state = (over = {}) => ({ format: 'xlsx', discoCodes: [], columns: defaultColumns(cat.fields), filters: [], groupBy: [], metrics: [], sort: [], ...over });

describe('reading the catalogue', () => {
  it('keeps the fields, limits and lists as the server sent them', () => {
    expect(cat.fields).toHaveLength(7);
    expect(cat.limits.filters).toBe(2);
    expect(cat.formats).toEqual(['xlsx', 'csv']);
    expect(cat.byKey.get('reportedAt').type).toBe('datetime');
  });

  it('is null without usable fields, so nothing is guessed', () => {
    expect(parseCatalogue({ success: true, data: { fields: [] } })).toBeNull();
    expect(parseCatalogue(null)).toBeNull();
  });

  it('groups fields by section in catalogue order and pre-ticks the defaults', () => {
    expect(fieldsBySection(cat.fields).map((s) => s.section)).toEqual(['Record', 'Customer', 'Completion']);
    expect(defaultColumns(cat.fields)).toEqual(['status', 'accountNumber', 'customerName', 'reportedAt']);
  });
});

describe('value inputs and labels', () => {
  const f = (key) => cat.byKey.get(key);
  it.each([
    ['status', 'in', 'enumList'],
    ['status', 'isBlank', 'none'],
    ['accountNumber', 'in', 'textList'],
    ['accountNumber', 'contains', 'text'],
    ['reportedAt', 'between', 'dateRange'],
    ['reportedAt', 'on', 'date'],
    ['reportedAt', 'preset', 'preset'],
    ['hasPicture', 'eq', 'boolean'],
    ['latitude', 'between', 'numberRange'],
    ['latitude', 'gte', 'number'],
  ])('%s %s → %s', (key, op, kind) => {
    expect(valueKindFor(f(key), op)).toBe(kind);
  });

  it('reads plainly', () => {
    expect(opLabel('gte', f('reportedAt'))).toBe('is on or after');
    expect(opLabel('gte', f('latitude'))).toBe('is at least');
    expect(opLabel('notIn', f('status'))).toBe('is not one of');
    expect(presetLabel('last7days')).toBe('Last 7 days');
    expect(enumLabel('IN_PROGRESS')).toBe('In progress');
    expect(emptyValueFor('dateRange')).toEqual(['', '']);
  });
});

describe('validateCustomExport', () => {
  it('accepts the defaults', () => {
    expect(validateCustomExport(state(), cat)).toEqual({});
  });

  it('needs a column unless the export is totals only', () => {
    expect(validateCustomExport(state({ columns: [] }), cat).columns).toMatch(/at least one column/);
    expect(validateCustomExport(state({ columns: [], groupBy: [{ field: 'installerName' }] }), cat)).toEqual({});
  });

  it('checks each filter value for its kind, keyed by its row', () => {
    const errors = validateCustomExport(state({
      filters: [
        { field: 'reportedAt', op: 'between', value: ['2026-10-12', '2026-10-01'] },
        { field: 'status', op: 'in', value: [] },
      ],
    }), cat);
    expect(errors['filters[0]']).toMatch(/start date/);
    expect(errors['filters[1]']).toMatch(/at least one value/);
  });

  it('enforces the catalogue limits and groupable fields', () => {
    const tooMany = [1, 2, 3].map(() => ({ field: 'hasPicture', op: 'eq', value: 'true' }));
    expect(validateCustomExport(state({ filters: tooMany }), cat).filters).toMatch(/at most 2/);
    expect(validateCustomExport(state({ groupBy: [{ field: 'customerName' }] }), cat)['groupBy[0]']).toBeTruthy();
    expect(validateCustomExport(state({ groupBy: [{ field: 'status' }, { field: 'status' }] }), cat)['groupBy[1]']).toMatch(/already/);
  });
});

describe('buildCustomExportRequest', () => {
  it('sends only the documented keys, omitting empty optional ones', () => {
    expect(buildCustomExportRequest(state(), cat)).toEqual({
      format: 'xlsx',
      columns: ['status', 'accountNumber', 'customerName', 'reportedAt'],
    });
  });

  it('builds the guide’s installer-productivity example', () => {
    const body = buildCustomExportRequest(state({
      format: 'csv',
      discoCodes: ['ABA_POWER'],
      columns: ['customerName', 'accountNumber'],
      filters: [
        { field: 'status', op: 'in', value: ['INSTALLED', 'EXPORTED'] },
        { field: 'reportedAt', op: 'between', value: ['2026-10-01', '2026-10-12'] },
        { field: 'hasPicture', op: 'eq', value: 'false' },
        { field: 'accountNumber', op: 'in', value: ' 0100, 0200 ,' },
        { field: 'latitude', op: 'gte', value: '5.1' },
        { field: 'reportedAt', op: 'isNotBlank', value: '' },
      ],
      groupBy: [{ field: 'installerName' }, { field: 'reportedAt', bucket: 'week' }],
      metrics: ['count', 'withGps'],
      sort: [{ field: 'reportedAt', dir: 'desc' }],
    }), cat);
    expect(body).toEqual({
      format: 'csv',
      discoCodes: ['ABA_POWER'],
      // catalogue order, and identifiers kept as strings with their zeros
      columns: ['accountNumber', 'customerName'],
      filters: [
        { field: 'status', op: 'in', value: ['INSTALLED', 'EXPORTED'] },
        { field: 'reportedAt', op: 'between', value: ['2026-10-01', '2026-10-12'] },
        { field: 'hasPicture', op: 'eq', value: false },
        { field: 'accountNumber', op: 'in', value: ['0100', '0200'] },
        { field: 'latitude', op: 'gte', value: 5.1 },
        { field: 'reportedAt', op: 'isNotBlank' },
      ],
      groupBy: ['installerName', 'reportedAt:week'],
      metrics: ['count', 'withGps'],
      sort: [{ field: 'reportedAt', dir: 'desc' }],
    });
  });

  it('never sends metrics without a grouping', () => {
    expect(buildCustomExportRequest(state({ metrics: ['count'] }), cat).metrics).toBeUndefined();
  });

  it('defaults a date grouping to days', () => {
    expect(buildCustomExportRequest(state({ groupBy: [{ field: 'reportedAt' }] }), cat).groupBy).toEqual(['reportedAt:day']);
  });
});

describe('errorsByLocation', () => {
  it('puts each server error on the input it names', () => {
    expect(errorsByLocation([
      'filters[2]: hasPicture does not support "contains"',
      'filters[2].value must be true or false',
      'groupBy[0]: customerName cannot be grouped',
      'metrics need a groupBy',
      { field: 'columns', message: 'Unknown field "foo"' },
      'Something else went wrong',
    ])).toEqual({
      'filters[2]': ['filters[2]: hasPicture does not support "contains"', 'filters[2].value must be true or false'],
      'groupBy[0]': ['groupBy[0]: customerName cannot be grouped'],
      metrics: ['metrics need a groupBy'],
      columns: ['Unknown field "foo"'],
      general: ['Something else went wrong'],
    });
  });
});
