import { describe, it, expect } from 'vitest';
import {
  JED_FLOW_SCOPE, JED_BUCKET, NOT_RECORDED, ROW_SOURCE,
  buildScopeOptions, resolveScope, attributeRemitaRecord, nonJedCodeSet,
  normalizeMultiRow, normalizeJedRow, dedupeRows, statusesForScope,
  buildFilterOptions, applyAttributeFilters, applyStatusFilter, countByStatus, sortRows,
  normalizePhase, rowStatusLabel,
} from '../installationScope';

const ABA = { code: 'ABA_POWER', name: 'Aba Power' };
const JED_DISCO = { code: 'JED', name: 'Jos Electricity' };

const multi = (over) => normalizeMultiRow({
  id: 1, accountNumber: '0100', customerName: 'A', discoCode: 'ABA_POWER', status: 'PENDING',
  meterType: 'SINGLE PHASE', feederName: 'ABA GRA 11KV', transformerName: 'JOHNSON',
  installationPosition: 'HIGH WALL', createdAt: '2026-09-01T10:00:00Z', ...over,
});
const jed = (over, bucket = JED_BUCKET) => normalizeJedRow({
  id: 1, accountNumber: '477014', custNames: 'B', discoCode: 'JED001', status: 'PAID',
  meterRecommended: 'Three Phase', amount: 67000, dateRequested: '2026-08-01T10:00:00Z', ...over,
}, bucket);

describe('disco scope', () => {
  it('adds a separate JED entry only when JED is not a registered disco', () => {
    expect(buildScopeOptions([ABA]).map((o) => o.value)).toEqual(['', 'ABA_POWER', JED_FLOW_SCOPE]);
    expect(buildScopeOptions([ABA, JED_DISCO]).map((o) => o.value)).toEqual(['', 'ABA_POWER', 'JED']);
  });

  it('resolves what each scope loads', () => {
    expect(resolveScope('')).toEqual({ includeMulti: true, multiDiscoCode: '', remitaBucket: null });
    expect(resolveScope(JED_FLOW_SCOPE)).toEqual({ includeMulti: false, multiDiscoCode: '', remitaBucket: JED_BUCKET });
    expect(resolveScope('JED')).toEqual({ includeMulti: true, multiDiscoCode: 'JED', remitaBucket: JED_BUCKET });
    expect(resolveScope('ABA_POWER')).toEqual({ includeMulti: true, multiDiscoCode: 'ABA_POWER', remitaBucket: 'ABA_POWER' });
  });

  it("attributes a Remita request to a registered disco only on an exact code match", () => {
    const codes = nonJedCodeSet([ABA, JED_DISCO]);
    expect(codes.has('JED')).toBe(false);
    expect(attributeRemitaRecord({ discoCode: 'aba_power' }, codes)).toBe('ABA_POWER');
    expect(attributeRemitaRecord({ discoCode: 'JED001' }, codes)).toBe(JED_BUCKET);
    expect(attributeRemitaRecord({ discoCode: '' }, codes)).toBe(JED_BUCKET);
    expect(attributeRemitaRecord({}, codes)).toBe(JED_BUCKET);
  });

  it('offers only the statuses that exist in the scope', () => {
    const both = statusesForScope({ includeMulti: true, includeJed: true }).map((s) => s.value);
    expect(both).toContain('PENDING');
    expect(both).toContain('PAID');
    expect(statusesForScope({ includeMulti: false, includeJed: true }).map((s) => s.value)).toEqual(['INITIATED', 'PAID', 'COMPLETED']);
  });
});

describe('normalisation', () => {
  it('keeps account numbers as strings and phases comparable', () => {
    const row = multi({ accountNumber: '0239110006909', meterType: 'single_phase' });
    expect(row.accountNumber).toBe('0239110006909');
    expect(row.meterType).toBe('SINGLE PHASE');
    expect(normalizePhase('Three Phase')).toBe('THREE PHASE');
  });

  it('never invents upload fields for JED rows', () => {
    const row = jed();
    expect(row.source).toBe(ROW_SOURCE.JED);
    expect(row.meterType).toBe('THREE PHASE');
    expect(row.feederName).toBe('');
    expect(rowStatusLabel(row)).toBe('Awaiting Installation');
  });

  it('falls back to the transformer code when there is no name', () => {
    expect(multi({ transformerName: '', transformerCode: 'JO-01' }).transformerName).toBe('JO-01');
  });

  it('de-duplicates within a source but keeps both domains', () => {
    const rows = dedupeRows([multi(), multi(), jed(), jed(), multi({ id: 2 })]);
    expect(rows.map((r) => r.key)).toEqual(['M-1', 'J-477014', 'M-2']);
  });
});

describe('filtering', () => {
  const rows = [
    multi({ id: 1, feederName: 'Feeder A', transformerName: 'T1', meterType: 'SINGLE PHASE', installationPosition: 'HIGH WALL', status: 'PENDING' }),
    multi({ id: 2, feederName: 'Feeder A', transformerName: 'T2', meterType: 'THREE PHASE', installationPosition: 'POLE', status: 'ASSIGNED' }),
    multi({ id: 3, feederName: 'feeder a', transformerName: 'T1', meterType: 'Single Phase', installationPosition: '', status: 'PENDING' }),
    multi({ id: 4, feederName: 'Feeder B', transformerName: 'T1', meterType: 'SINGLE PHASE', installationPosition: 'HIGH WALL', status: 'INSTALLED' }),
    jed({ accountNumber: '9' }),
  ];

  it('combines multiple filters (all must match)', () => {
    const out = applyAttributeFilters(rows, {
      attributes: { feederName: 'FEEDER A', transformerName: 'T1', meterType: 'SINGLE PHASE' },
    });
    expect(out.map((r) => r.id)).toEqual([1, 3]);
  });

  it('matches values case-insensitively', () => {
    const out = applyAttributeFilters(rows, { attributes: { feederName: 'FEEDER A' } });
    expect(out).toHaveLength(3);
  });

  it('can select rows where a field was not recorded', () => {
    const out = applyAttributeFilters(rows, { attributes: { installationPosition: NOT_RECORDED } });
    expect(out.map((r) => r.key)).toEqual(['M-3', 'J-9']);
  });

  it('excludes JED rows once an upload-only field is filtered', () => {
    const out = applyAttributeFilters(rows, { attributes: { feederName: 'FEEDER B' } });
    expect(out.every((r) => r.source === ROW_SOURCE.MULTI)).toBe(true);
  });

  it('searches account, customer and feeder text', () => {
    expect(applyAttributeFilters(rows, { search: '477' })).toHaveLength(0);
    expect(applyAttributeFilters(rows, { search: 'feeder b' }).map((r) => r.id)).toEqual([4]);
  });

  it('builds options from real data with counts, grouping case variants', () => {
    const opts = buildFilterOptions(rows, 'feederName');
    expect(opts).toEqual([
      { value: 'FEEDER A', label: 'Feeder A', count: 3 },
      { value: 'FEEDER B', label: 'Feeder B', count: 1 },
      { value: NOT_RECORDED, label: 'Not recorded', count: 1 },
    ]);
  });

  it('returns no options when nobody recorded the field', () => {
    expect(buildFilterOptions([jed()], 'feederName')).toEqual([]);
  });

  it('counts statuses for exactly the rows given', () => {
    const filtered = applyAttributeFilters(rows, { attributes: { feederName: 'FEEDER A' } });
    expect(countByStatus(filtered)).toEqual({ PENDING: 2, ASSIGNED: 1 });
    expect(applyStatusFilter(filtered, 'PENDING')).toHaveLength(2);
    expect(applyStatusFilter(filtered, '')).toHaveLength(3);
  });
});

describe('sortRows', () => {
  const rows = [
    multi({ id: 1, feederName: 'B', createdAt: '2026-09-02T00:00:00Z', status: 'INSTALLED' }),
    multi({ id: 2, feederName: '', createdAt: '2026-09-03T00:00:00Z', status: 'PENDING' }),
    multi({ id: 3, feederName: 'a', createdAt: '2026-09-01T00:00:00Z', status: 'ASSIGNED' }),
    jed({ accountNumber: '7', dateRequested: null, status: 'PAID' }),
  ];

  it('sorts text case-insensitively with blanks last in both directions', () => {
    expect(sortRows(rows, 'feederName', 'asc').map((r) => r.key)).toEqual(['M-3', 'M-1', 'M-2', 'J-7']);
    expect(sortRows(rows, 'feederName', 'desc').map((r) => r.key)).toEqual(['M-1', 'M-3', 'M-2', 'J-7']);
  });

  it('sorts by request date, newest first by default', () => {
    expect(sortRows(rows).map((r) => r.key)).toEqual(['M-2', 'M-1', 'M-3', 'J-7']);
  });

  it('sorts by lifecycle order for status', () => {
    expect(sortRows(rows, 'status', 'asc').map((r) => r.status)).toEqual(['PENDING', 'ASSIGNED', 'INSTALLED', 'PAID']);
  });

  it('does not mutate the input', () => {
    const copy = [...rows];
    sortRows(rows, 'feederName', 'asc');
    expect(rows).toEqual(copy);
  });
});
