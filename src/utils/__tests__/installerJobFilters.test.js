import { describe, it, expect } from 'vitest';
import {
  INSTALLER_JOB_FILTERS, EMPTY_JOB_FILTERS, NOT_RECORDED,
  toFilterableJobs, applyJobFilters, buildJobFilterOptions, countActiveJobFilters,
} from '../installerJobFilters';

const job = (id, over = {}) => ({
  id,
  accountNumber: `457108621${id}`,
  customerName: `CUSTOMER ${id}`,
  status: 'ASSIGNED',
  area: 'Aba',
  meterType: 'THREE PHASE',
  feederName: 'ABA GRA 11KV',
  transformerName: 'JOHNSON',
  ...over,
});

const jobs = [
  job(1),
  job(2, { meterType: 'SINGLE PHASE' }),
  job(3, { area: 'Umuahia', feederName: 'UMUAHIA 33KV', transformerName: 'OKON' }),
  job(4, { area: '', region: 'ABA NORTH', transformerName: '', transformerCode: 'TX-9' }),
  job(5, { area: '', region: '', feederName: '', transformerName: '', transformerCode: '' }),
];
const filterable = toFilterableJobs(jobs);
const ids = (rows) => rows.map((r) => r.job.id);

describe('toFilterableJobs', () => {
  it('normalises phase spelling and keeps the original record', () => {
    const [first] = toFilterableJobs([job(1, { meterType: 'Three Phase' })]);
    expect(first.meterType).toBe('THREE PHASE');
    expect(first.job.id).toBe(1);
  });

  it('falls back to region for area and to transformerCode for transformer', () => {
    const row = filterable.find((r) => r.job.id === 4);
    expect(row.area).toBe('ABA NORTH');
    expect(row.transformerName).toBe('TX-9');
  });
});

describe('applyJobFilters', () => {
  it('returns everything when no filter is set', () => {
    expect(ids(applyJobFilters(filterable, EMPTY_JOB_FILTERS))).toEqual([1, 2, 3, 4, 5]);
  });

  it('filters by meter type alone', () => {
    expect(ids(applyJobFilters(filterable, { meterType: 'THREE PHASE' }))).toEqual([1, 3, 4, 5]);
    expect(ids(applyJobFilters(filterable, { meterType: 'SINGLE PHASE' }))).toEqual([2]);
  });

  it('filters by area alone', () => {
    expect(ids(applyJobFilters(filterable, { area: 'ABA' }))).toEqual([1, 2]);
  });

  it('combines area and meter type with AND', () => {
    expect(ids(applyJobFilters(filterable, { area: 'ABA', meterType: 'THREE PHASE' }))).toEqual([1]);
  });

  it('combines feeder and transformer', () => {
    expect(ids(applyJobFilters(filterable, { feederName: 'UMUAHIA 33KV', transformerName: 'OKON' }))).toEqual([3]);
    expect(applyJobFilters(filterable, { feederName: 'ABA GRA 11KV', transformerName: 'OKON' })).toHaveLength(0);
  });

  it('selects blanks with the "Not recorded" sentinel', () => {
    expect(ids(applyJobFilters(filterable, { feederName: NOT_RECORDED }))).toEqual([5]);
  });
});

describe('buildJobFilterOptions', () => {
  it('offers every filter with counts, from the data and not a fixed list', () => {
    const options = buildJobFilterOptions(filterable, EMPTY_JOB_FILTERS);
    expect(Object.keys(options).sort()).toEqual(INSTALLER_JOB_FILTERS.map((f) => f.field).sort());
    expect(options.meterType).toEqual([
      { value: 'SINGLE PHASE', label: 'SINGLE PHASE', count: 1 },
      { value: 'THREE PHASE', label: 'THREE PHASE', count: 4 },
    ]);
    expect(options.area.find((o) => o.value === 'ABA')).toMatchObject({ count: 2 });
    expect(options.area.find((o) => o.value === NOT_RECORDED)).toMatchObject({ count: 1 });
  });

  it('is faceted: each dropdown reflects the other active filters', () => {
    const options = buildJobFilterOptions(filterable, { area: 'ABA' });
    expect(options.feederName.map((o) => o.value)).toEqual(['ABA GRA 11KV']);
    // The area dropdown itself still lists every area, so it can be changed.
    expect(options.area.map((o) => o.value)).toContain('UMUAHIA');
  });

  it('keeps an active value that is no longer reachable, at a count of 0', () => {
    const options = buildJobFilterOptions(filterable, { area: 'ABA', transformerName: 'OKON' });
    expect(options.transformerName.find((o) => o.value === 'OKON')).toMatchObject({ count: 0 });
  });
});

describe('countActiveJobFilters', () => {
  it('counts only the filters that are set', () => {
    expect(countActiveJobFilters(EMPTY_JOB_FILTERS)).toBe(0);
    expect(countActiveJobFilters({ area: 'ABA', meterType: '', feederName: NOT_RECORDED })).toBe(2);
  });
});
