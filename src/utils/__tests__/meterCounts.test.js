import { describe, it, expect } from 'vitest';
import { shelfAvailableCount, availableCountLabel, countOptionsByPhase, toMeterOptions } from '../meterInventory';

describe('shelfAvailableCount — Available never includes meters out with installers', () => {
  it('subtracts the held meters (all status AVAILABLE by API design) from the server figure', () => {
    expect(shelfAvailableCount(477, new Map([['a', {}], ['b', {}]]))).toBe(475);
  });
  it('is unknown (null), never a guess, when either figure is missing', () => {
    expect(shelfAvailableCount(null, new Map())).toBeNull();
    expect(shelfAvailableCount(10, null)).toBeNull();
  });
  it('never goes below zero', () => {
    expect(shelfAvailableCount(1, new Map([['a', {}], ['b', {}]]))).toBe(0);
  });
});

describe('the picker count line', () => {
  it('names the selected type, and the cap when the list is cut', () => {
    expect(availableCountLabel({ matches: 59, total: 59, phaseLabel: 'Three Phase', maxShown: 200 })).toBe('59 available Three Phase meters');
    expect(availableCountLabel({ matches: 418, total: 418, maxShown: 200 })).toBe('Showing 200 of 418 available meters — type to narrow');
    expect(availableCountLabel({ matches: 2, total: 59, phaseLabel: 'Three Phase', searching: true, maxShown: 200 }))
      .toBe('2 matching of 59 available Three Phase meters');
  });
  it('counts per canonical phase, so "3 Phase" is Three Phase', () => {
    const options = toMeterOptions([
      { meterNumber: '1', phaseType: '3 Phase', status: 'AVAILABLE' },
      { meterNumber: '2', phaseType: 'THREE_PHASE', status: 'AVAILABLE' },
      { meterNumber: '3', phaseType: 'Single Phase', status: 'AVAILABLE' },
    ]);
    expect(Object.fromEntries(countOptionsByPhase(options))).toEqual({ 'THREE PHASE': 2, 'SINGLE PHASE': 1 });
  });
});
