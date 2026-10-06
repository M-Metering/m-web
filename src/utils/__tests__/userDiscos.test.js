import { describe, it, expect } from 'vitest';
import {
  userDiscos, userDiscoCodes, isDiscoScoped, hasNoDiscoAccess, discoOptionsForUser,
  userDiscoFieldMode, createDiscoCodes, sameDiscoSet, NO_DISCO_ACCESS_MESSAGE,
} from '../userDiscos';
import { getErrorMessage } from '../errorMessage';
import { isWrongDiscoMeterError } from '../installationReport';

const ABA = { code: 'ABA_POWER', name: 'Aba Power Limited Electric' };
const PHEDC = { code: 'PHEDC', name: 'Port Harcourt Electricity Distribution Company' };
const ALL = [{ ...ABA, isActive: true }, { ...PHEDC, isActive: true }, { code: 'JED001', name: 'JED' }];

describe("a user's discos (Per-Disco Access, 2026-10-05)", () => {
  it('reads the profile array, tolerating plain codes', () => {
    expect(userDiscos({ discos: [ABA, 'PHEDC'] })).toEqual([ABA, { code: 'PHEDC', name: '' }]);
    expect(userDiscos({})).toBeNull();
    expect(userDiscoCodes({ discos: [ABA, PHEDC] })).toEqual(['ABA_POWER', 'PHEDC']);
  });

  it('scopes every role but SUPERADMIN, and only when the record says', () => {
    expect(isDiscoScoped({ role: 'ADMIN', discos: [ABA] })).toBe(true);
    expect(isDiscoScoped({ role: 'SUPERADMIN', discos: [] })).toBe(false);
    expect(isDiscoScoped({ role: 'ADMIN' })).toBe(false); // older session: server still scopes
  });

  it('flags a non-SUPERADMIN with no disco yet — never a SUPERADMIN', () => {
    expect(hasNoDiscoAccess({ role: 'SUPERVISOR', discos: [] })).toBe(true);
    expect(hasNoDiscoAccess({ role: 'SUPERADMIN', discos: [] })).toBe(false);
    expect(hasNoDiscoAccess({ role: 'ADMIN', discos: [ABA] })).toBe(false);
    expect(NO_DISCO_ACCESS_MESSAGE).toBe('Ask a super admin to give you access to a disco.');
  });

  it('offers a scoped user only their own discos, a SUPERADMIN every disco', () => {
    expect(discoOptionsForUser({ role: 'ADMIN', discos: [PHEDC] }, ALL).map((d) => d.code)).toEqual(['PHEDC']);
    expect(discoOptionsForUser({ role: 'ADMIN', discos: [PHEDC] }, []).map((d) => d.name)).toEqual([PHEDC.name]);
    expect(discoOptionsForUser({ role: 'SUPERADMIN', discos: [] }, ALL)).toBe(ALL);
  });
});

describe('granting discos on the user form (§4)', () => {
  const superAdmin = { role: 'SUPERADMIN', discos: [] };
  const adminOne = { role: 'ADMIN', discos: [ABA] };
  const adminTwo = { role: 'ADMIN', discos: [ABA, PHEDC] };

  it('picks the control by actor, target and create/edit', () => {
    expect(userDiscoFieldMode({ actor: superAdmin, targetRole: 'INSTALLER' })).toBe('all');
    expect(userDiscoFieldMode({ actor: superAdmin, targetRole: 'SUPERADMIN' })).toBe('none');
    expect(userDiscoFieldMode({ actor: superAdmin, targetRole: 'ADMIN', editing: true })).toBe('all');
    expect(userDiscoFieldMode({ actor: adminOne, targetRole: 'INSTALLER' })).toBe('none');
    expect(userDiscoFieldMode({ actor: adminTwo, targetRole: 'INSTALLER' })).toBe('own');
    expect(userDiscoFieldMode({ actor: adminTwo, targetRole: 'INSTALLER', editing: true })).toBe('none');
  });

  it('omits discoCodes when no field is shown, sends them (even empty) otherwise', () => {
    expect(createDiscoCodes({ mode: 'none', selected: ['ABA_POWER'] })).toBeUndefined();
    expect(createDiscoCodes({ mode: 'all', selected: [] })).toEqual([]);
    expect(createDiscoCodes({ mode: 'own', selected: ['PHEDC', 'PHEDC'] })).toEqual(['PHEDC']);
  });

  it('compares disco sets regardless of order', () => {
    expect(sameDiscoSet(['A', 'B'], ['B', 'A'])).toBe(true);
    expect(sameDiscoSet(['A'], ['A', 'B'])).toBe(false);
  });
});

describe('the new refusals reach the user in their own words (§3, §7)', () => {
  it('shows the 403 and 404 disco messages as sent', () => {
    expect(getErrorMessage(new Error("PERMISSION_ERROR:You don't have access to PHEDC"), 'x')).toBe("You don't have access to PHEDC");
    expect(getErrorMessage(new Error('NOT_FOUND:Disco XYZ not found'), 'x')).toBe('Disco XYZ not found');
    expect(getErrorMessage(new Error("VALIDATION_ERROR:Ada Obi isn't profiled for PHEDC"), 'x')).toBe("Ada Obi isn't profiled for PHEDC");
    expect(getErrorMessage(new Error('VALIDATION_ERROR:discoCode is required'), 'x')).toBe('discoCode is required');
  });

  it("recognises METER_WRONG_DISCO by its code or its text", () => {
    expect(isWrongDiscoMeterError(new Error("VALIDATION_ERROR:That meter belongs to a different disco's stock than this installation"))).toBe(true);
    expect(isWrongDiscoMeterError(new Error('METER_WRONG_DISCO'))).toBe(true);
    expect(isWrongDiscoMeterError(new Error('Seal number already used'))).toBe(false);
  });
});
