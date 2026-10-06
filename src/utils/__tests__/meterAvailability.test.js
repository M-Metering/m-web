// The meter's two axes (stock status, and who holds it) read as one state,
// and the open-dispatch index that fills in the second axis when GET /meters
// doesn't carry it. See the header of utils/meterInventory.js.
import { describe, it, expect } from 'vitest';
import {
  isAssignableMeter, meterAvailability, indexMeterHolders, withMeterHolders,
  meterDeletionBlockReason, toMeterOptions, undispatchableReason, meterPhase,
} from '../meterInventory';
import { normalizePhase, toApiPhase } from '../installationScope';
import { parseIdentifierList } from '../identifierList';

const HOLDER = { installerId: 'uuid-1', installerName: 'Musa Bello' };
const available = (extra = {}) => ({ meterNumber: '0239110006909', status: 'AVAILABLE', phaseType: 'THREE PHASE', ...extra });

describe('meterAvailability', () => {
  it('reads a dispatched meter as Assigned even though its stock status is still AVAILABLE', () => {
    expect(meterAvailability(available(), HOLDER)).toEqual({ key: 'ASSIGNED', label: 'Assigned', holderName: 'Musa Bello' });
    expect(meterAvailability(available({ assignmentStatus: 'ASSIGNED' })).key).toBe('ASSIGNED');
  });

  it('is Available only when nobody holds it', () => {
    expect(meterAvailability(available()).key).toBe('AVAILABLE');
    expect(meterAvailability(available({ assignmentStatus: 'RETURNED' })).key).toBe('AVAILABLE');
  });

  it('prefers the more final states', () => {
    expect(meterAvailability(available({ assignmentStatus: 'USED' }), HOLDER).key).toBe('INSTALLED');
    expect(meterAvailability(available({ status: 'INSTALLED' })).key).toBe('INSTALLED');
    expect(meterAvailability(available({ assignmentStatus: 'LOST' })).key).toBe('LOST');
    expect(meterAvailability(available({ status: 'faulty' })).key).toBe('FAULTY');
  });

  it('decides Installed from status, never from installedAt (a reverted meter is back in stock)', () => {
    const reverted = available({ installedAt: '2026-10-01T10:00:00Z', installationRequestId: 70, assignmentStatus: 'UNASSIGNED' });
    expect(meterAvailability(reverted).key).toBe('AVAILABLE');
    expect(isAssignableMeter(reverted)).toBe(true);
    // The PDF's table: a returned meter is in stock; FAULTY/RETIRED win over assignment.
    expect(meterAvailability(available({ assignmentStatus: 'RETURNED' })).key).toBe('AVAILABLE');
    expect(meterAvailability(available({ status: 'RETIRED', assignmentStatus: 'LOST' })).key).toBe('RETIRED');
    expect(meterAvailability(available({ status: 'INSTALLED', assignmentStatus: 'UNASSIGNED' })).key).toBe('INSTALLED');
  });

  it('is case-insensitive about the stock status', () => {
    expect(meterAvailability(available({ status: 'Available' })).key).toBe('AVAILABLE');
    expect(isAssignableMeter(available({ status: 'available' }))).toBe(true);
  });
});

describe('isAssignableMeter with the open-dispatch index', () => {
  it('refuses a meter the index says is held, whatever its own record says', () => {
    expect(isAssignableMeter(available(), HOLDER)).toBe(false);
    expect(isAssignableMeter(available(), null)).toBe(true);
  });

  it('is safe as a bare .filter() callback (the index argument is not a holder)', () => {
    const meters = [available(), available({ meterNumber: '0239110006910' })];
    expect(meters.filter(isAssignableMeter)).toHaveLength(2);
  });

  it('keeps held meters out of the picker options', () => {
    const holders = new Map([['0239110006909', HOLDER]]);
    const options = toMeterOptions([available(), available({ meterNumber: '0239110006910' })], new Set(), holders);
    expect(options.map((o) => o.serial)).toEqual(['0239110006910']);
  });

  it('blocks deleting a held meter', () => {
    expect(meterDeletionBlockReason(available(), HOLDER)).toMatch(/dispatched to an installer/);
  });

  it('explains why a meter is not offered, naming the installer', () => {
    expect(undispatchableReason(available(), HOLDER)).toBe('it is already with Musa Bello');
    expect(undispatchableReason(available({ status: 'INSTALLED' }))).toBe('it has already been installed');
    expect(undispatchableReason(available())).toBeNull();
  });
});

describe('indexMeterHolders', () => {
  const batch = (extra) => ({
    id: 40, status: 'ACTIVE', installerId: 'uuid-1', installerName: 'Musa Bello', batchRef: 'MB-40',
    assignedAt: '2026-09-26T10:00:00Z',
    items: [
      { meterNumber: '0239110006909', phaseType: 'Three Phase', assignmentStatus: 'ASSIGNED' },
      { meterNumber: '0239110006910', assignmentStatus: 'USED' },
      { meterNumber: '0239110006911', assignmentStatus: 'RETURNED' },
    ],
    ...extra,
  });

  it('indexes only meters still ASSIGNED in an open batch', () => {
    const holders = indexMeterHolders([batch()]);
    expect(Array.from(holders.keys())).toEqual(['0239110006909']);
    expect(holders.get('0239110006909')).toMatchObject({
      installerId: 'uuid-1', installerName: 'Musa Bello', batchId: 40, phaseType: 'THREE PHASE',
    });
  });

  it('ignores closed or cancelled batches', () => {
    expect(indexMeterHolders([batch({ status: 'CLOSED' }), batch({ status: 'CANCELLED' })]).size).toBe(0);
    expect(indexMeterHolders([batch({ status: 'PARTIALLY_RETURNED' })]).size).toBe(1);
  });
});

describe('withMeterHolders', () => {
  it('joins the holder on, copying rather than mutating', () => {
    const meter = available();
    const [joined] = withMeterHolders([meter], new Map([['0239110006909', HOLDER]]));
    expect(joined).toMatchObject({ assignmentStatus: 'ASSIGNED', holder: HOLDER });
    expect(meter.holder).toBeUndefined();
  });

  it('keeps USED/LOST, and returns the list untouched with no index', () => {
    const used = available({ assignmentStatus: 'USED' });
    expect(withMeterHolders([used], new Map([['0239110006909', HOLDER]]))[0].assignmentStatus).toBe('USED');
    const list = [available()];
    expect(withMeterHolders(list, null)).toBe(list);
  });
});

describe('phase normalisation', () => {
  it.each([
    ['THREE PHASE', 'THREE PHASE'], ['Three Phase', 'THREE PHASE'], ['three_phase', 'THREE PHASE'],
    ['3 Phase', 'THREE PHASE'], ['3-PH', 'THREE PHASE'], ['ThreePhase', 'THREE PHASE'],
    ['Three Phase Meter', 'THREE PHASE'], ['3P', 'THREE PHASE'],
    ['SINGLE PHASE', 'SINGLE PHASE'], ['Single-Phase', 'SINGLE PHASE'], ['1 PHASE', 'SINGLE PHASE'],
    ['1PH', 'SINGLE PHASE'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizePhase(raw)).toBe(expected);
    expect(meterPhase({ phaseType: raw })).toBe(expected);
  });

  it('keeps an unrecognised value (normalised) rather than guessing', () => {
    expect(normalizePhase('  ct  operated ')).toBe('CT OPERATED');
    expect(normalizePhase('')).toBe('');
  });

  it('only ever sends a documented enum value as a query parameter', () => {
    expect(toApiPhase('3 Phase')).toBe('THREE PHASE');
    expect(toApiPhase('CT operated')).toBeUndefined();
  });
});

describe('parseIdentifierList', () => {
  it('accepts new lines, commas, comma+space, tabs, semicolons and spaces', () => {
    expect(parseIdentifierList('111\n222,333, 444\t555;666 777\r\n888').values)
      .toEqual(['111', '222', '333', '444', '555', '666', '777', '888']);
  });

  it('trims, drops blanks and removes duplicates in pasted order', () => {
    expect(parseIdentifierList(' 222 \n\n111\n222\n,,\n111')).toEqual({ values: ['222', '111'], duplicates: ['222', '111'] });
  });

  it('keeps identifiers as exact strings', () => {
    expect(parseIdentifierList('0239110006909').values).toEqual(['0239110006909']);
  });
});
