import { describe, it, expect } from 'vitest';
import {
  isAssignableMeter, toMeterOptions, matchPastedSerials, meterSerial,
  isDeletableMeter, meterDeletionBlockReason, partitionDeletableMeters,
} from '../meterInventory';

describe('isAssignableMeter', () => {
  it.each([
    [{ meterNumber: '0239110006909', status: 'AVAILABLE' }, true],
    [{ meterNumber: '0239110006909', status: 'available', assignmentStatus: 'UNASSIGNED' }, true],
    [{ meterNumber: '0239110006909', status: 'AVAILABLE', assignmentStatus: 'RETURNED' }, true],
    [{ meterNumber: '0239110006909', status: 'AVAILABLE', assignmentStatus: 'ASSIGNED' }, false],
    [{ meterNumber: '0239110006909', status: 'AVAILABLE', assignmentStatus: 'USED' }, false],
    [{ meterNumber: '0239110006909', status: 'AVAILABLE', assignmentStatus: 'LOST' }, false],
    [{ meterNumber: '0239110006909', status: 'INSTALLED' }, false],
    [{ meterNumber: '0239110006909', status: 'FAULTY' }, false],
    [{ meterNumber: '', status: 'AVAILABLE' }, false],
  ])('%j → %s', (meter, expected) => {
    expect(isAssignableMeter(meter)).toBe(expected);
  });
});

describe('toMeterOptions', () => {
  it('keeps serials as strings, de-duplicates, excludes and sorts', () => {
    const options = toMeterOptions([
      { meterNumber: '0239110006912', status: 'AVAILABLE', phaseType: 'THREE_PHASE' },
      { meterNumber: '0239110006909 ', status: 'AVAILABLE', phaseType: 'single phase', simNumber: '8923401000012345678' },
      { meterNumber: '0239110006909', status: 'AVAILABLE' },
      { meterNumber: '0239110006915', status: 'AVAILABLE' },
    ], new Set(['0239110006915']));
    expect(options).toEqual([
      { serial: '0239110006909', phaseType: 'SINGLE PHASE', simNumber: '8923401000012345678', meterMake: '', model: '' },
      { serial: '0239110006912', phaseType: 'THREE PHASE', simNumber: '', meterMake: '', model: '' },
    ]);
  });

  it('carries the record\'s own make and model through, and never invents them', () => {
    const [option] = toMeterOptions([
      { meterNumber: '0239110006909', status: 'AVAILABLE', meterMake: 'MASTER ENERGY', model: 'ME-1P' },
    ]);
    expect(option).toMatchObject({ meterMake: 'MASTER ENERGY', model: 'ME-1P' });
  });

  it('never loses a leading zero', () => {
    expect(meterSerial({ meterNumber: '0000000000001' })).toBe('0000000000001');
  });
});

describe('matchPastedSerials', () => {
  it('accepts only eligible serials', () => {
    const options = [{ serial: '0239110006909' }, { serial: '0239110006912' }];
    expect(matchPastedSerials(options, '0239110006909, 123\n0239110006912 0239110006909')).toEqual({
      accepted: ['0239110006909', '0239110006912'],
      rejected: ['123'],
    });
  });
});

describe('meterDeletionBlockReason', () => {
  const meter = (over = {}) => ({ meterNumber: '0239110006909', status: 'AVAILABLE', ...over });

  it('allows deleting spare stock that nobody holds', () => {
    expect(meterDeletionBlockReason(meter())).toBeNull();
    expect(meterDeletionBlockReason(meter({ assignmentStatus: 'UNASSIGNED' }))).toBeNull();
    expect(meterDeletionBlockReason(meter({ assignmentStatus: 'RETURNED' }))).toBeNull();
    expect(isDeletableMeter(meter())).toBe(true);
  });

  it('refuses a meter that is installed at a customer', () => {
    expect(meterDeletionBlockReason(meter({ status: 'INSTALLED' })))
      .toBe('It is installed at a customer premises.');
  });

  it('refuses a meter carrying an installedAt even when the status disagrees', () => {
    // The API is known to leave status/installedAt inconsistent, so either
    // one on its own is enough to block the delete.
    expect(meterDeletionBlockReason(meter({ installedAt: '2026-09-07T10:00:00Z' })))
      .toBe('It is installed at a customer premises.');
  });

  it.each([
    ['ASSIGNED', /dispatched to an installer/],
    ['USED', /already been used/],
    ['LOST', /recorded as lost/],
  ])('refuses a meter whose assignmentStatus is %s', (assignmentStatus, pattern) => {
    expect(meterDeletionBlockReason(meter({ assignmentStatus }))).toMatch(pattern);
  });

  it('still allows faulty or retired stock that is not out with anyone', () => {
    expect(meterDeletionBlockReason(meter({ status: 'FAULTY' }))).toBeNull();
    expect(meterDeletionBlockReason(meter({ status: 'RETIRED' }))).toBeNull();
  });

  it('refuses a record with no meter number', () => {
    expect(meterDeletionBlockReason({ status: 'AVAILABLE' })).toBe('This record has no meter number.');
  });
});

describe('partitionDeletableMeters', () => {
  it('separates what may be deleted from what must be left alone', () => {
    const meters = [
      { meterNumber: '1', status: 'AVAILABLE' },
      { meterNumber: '2', status: 'INSTALLED' },
      { meterNumber: '3', status: 'AVAILABLE', assignmentStatus: 'ASSIGNED' },
      { meterNumber: '4', status: 'AVAILABLE', assignmentStatus: 'RETURNED' },
    ];
    const { deletable, blocked } = partitionDeletableMeters(meters);
    expect(deletable.map((m) => m.meterNumber)).toEqual(['1', '4']);
    expect(blocked.map((b) => b.meter.meterNumber)).toEqual(['2', '3']);
    expect(blocked.every((b) => typeof b.reason === 'string' && b.reason.length > 0)).toBe(true);
  });

  it('handles an empty selection', () => {
    expect(partitionDeletableMeters([])).toEqual({ deletable: [], blocked: [] });
  });
});
