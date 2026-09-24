import { describe, it, expect } from 'vitest';
import {
  normalizeSealNumber, sealKey, collectSealKeys, validateSealNumber,
  isDuplicateSealError, DUPLICATE_SEAL_MESSAGE,
} from '../sealNumber';

describe('normalizeSealNumber', () => {
  it('trims accidental whitespace but never rewrites the identifier', () => {
    expect(normalizeSealNumber('  APLE0099123 ')).toBe('APLE0099123');
    expect(normalizeSealNumber('seal-123456')).toBe('seal-123456');
    expect(normalizeSealNumber(null)).toBe('');
  });
});

describe('sealKey', () => {
  it('compares case-insensitively and ignores internal spacing', () => {
    expect(sealKey('SEAL-123456')).toBe(sealKey('seal-123456'));
    expect(sealKey('APLE 0099123')).toBe(sealKey('aple0099123'));
  });
});

describe('collectSealKeys', () => {
  const records = [
    { id: 1, sealNumber: 'SEAL-123456' },
    { id: 2, sealNo: 'APLE0099123' },
    { id: 3, sealNumber: '' },
    { id: 4 },
  ];

  it('gathers both field spellings and skips blanks', () => {
    expect(collectSealKeys(records)).toEqual(new Set(['SEAL-123456', 'APLE0099123']));
  });

  it("leaves out the record being edited, so its own seal isn't a clash", () => {
    expect(collectSealKeys(records, 1)).toEqual(new Set(['APLE0099123']));
  });
});

describe('validateSealNumber', () => {
  const used = new Set(['SEAL-123456']);

  it('requires a value', () => {
    expect(validateSealNumber('   ', used)).toMatchObject({ valid: false, error: 'Seal number is required.' });
  });

  it('rejects a seal that is already recorded, whatever the casing', () => {
    expect(validateSealNumber('seal-123456', used)).toMatchObject({
      valid: false, error: DUPLICATE_SEAL_MESSAGE,
    });
  });

  it('accepts an unused seal and returns the trimmed value to send', () => {
    expect(validateSealNumber('  APLE0099999 ', used)).toEqual({
      valid: true, value: 'APLE0099999', error: null,
    });
  });
});

describe('isDuplicateSealError', () => {
  it.each([
    'VALIDATION_ERROR: Seal number has already been used',
    'Duplicate seal number',
    'sealNumber must be unique',
  ])('recognises %j as a duplicate-seal rejection', (message) => {
    expect(isDuplicateSealError(new Error(message))).toBe(true);
  });

  it.each([
    'Meter not assigned to you',
    'duplicate key value violates unique constraint "installations_account_key"',
    '',
  ])('does not mistake %j for one', (message) => {
    expect(isDuplicateSealError(new Error(message))).toBe(false);
  });
});
