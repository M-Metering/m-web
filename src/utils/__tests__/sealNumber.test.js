import { describe, it, expect } from 'vitest';
import {
  normalizeSealNumber, sealKey, collectSealKeys, validateSealNumber,
  isDuplicateSealError, sealValidationErrorOf, sealDuplicateGroupsOf, validateSealCorrection,
  DUPLICATE_SEAL_MESSAGE, SEAL_DIGITS_MESSAGE,
} from '../sealNumber';

describe('normalizeSealNumber', () => {
  it('trims accidental whitespace but never rewrites the identifier', () => {
    expect(normalizeSealNumber('  APLE0099123 ')).toBe('APLE0099123');
    expect(normalizeSealNumber('seal-123456')).toBe('seal-123456');
    expect(normalizeSealNumber(null)).toBe('');
  });
});

describe('sealKey', () => {
  it('identifies a seal by its digits only, as the API does', () => {
    expect(sealKey('SL-004512')).toBe('004512');
    expect(sealKey('AB004512')).toBe(sealKey('004512'));
    expect(sealKey('APLE 0099123')).toBe(sealKey('aple0099123'));
  });

  it('keeps leading zeros, so 4512 is a different seal from 004512', () => {
    expect(sealKey('4512')).not.toBe(sealKey('004512'));
  });

  it('is empty for a seal with no digits', () => {
    expect(sealKey('ABC')).toBe('');
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
    expect(collectSealKeys(records)).toEqual(new Set(['123456', '0099123']));
  });

  it("leaves out the record being edited, so its own seal isn't a clash", () => {
    expect(collectSealKeys(records, 1)).toEqual(new Set(['0099123']));
  });
});

describe('validateSealNumber', () => {
  const used = new Set(['123456']);

  it('requires a value', () => {
    expect(validateSealNumber('   ', used)).toMatchObject({ valid: false, error: 'Seal number is required.' });
  });

  it('rejects a seal without digits', () => {
    expect(validateSealNumber('ABC', used)).toMatchObject({ valid: false, error: SEAL_DIGITS_MESSAGE });
  });

  it('rejects a seal whose digits are already recorded, whatever the letters', () => {
    expect(validateSealNumber('PH-123456', used)).toMatchObject({
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
    'Seal number already exists',
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

describe('sealValidationErrorOf', () => {
  it('maps the API seal validation messages onto the field', () => {
    expect(sealValidationErrorOf(new Error('Validation failed: sealNumber Seal number must contain digits')))
      .toBe(SEAL_DIGITS_MESSAGE);
    expect(sealValidationErrorOf(new Error('Validation failed: sealNumber Seal number is required')))
      .toBe('Seal number is required.');
  });

  it('ignores errors about anything else', () => {
    expect(sealValidationErrorOf(new Error('Meter type mismatch'))).toBeNull();
  });
});

describe('sealDuplicateGroupsOf', () => {
  const response = {
    success: true,
    data: [
      {
        digits: '0135152',
        installations: [
          { id: 4354, discoCode: 'ABA_POWER', sealNumber: '0135152', status: 'EXPORTED' },
          { id: 13703, discoCode: 'PHEDC', sealNumber: 'Ph0135152', status: 'INSTALLED' },
        ],
      },
    ],
  };

  it('returns one group per clashing seal', () => {
    const groups = sealDuplicateGroupsOf(response);
    expect(groups).toHaveLength(1);
    expect(groups[0].digits).toBe('0135152');
    expect(groups[0].installations.map((i) => i.id)).toEqual([4354, 13703]);
  });

  it('treats an empty list as no duplicates, and ignores a group that is already resolved', () => {
    expect(sealDuplicateGroupsOf({ success: true, data: [] })).toEqual([]);
    expect(sealDuplicateGroupsOf({ data: [{ digits: '1', installations: [{ id: 1 }] }] })).toEqual([]);
    expect(sealDuplicateGroupsOf(null)).toEqual([]);
  });

  it('refuses a correction that would reuse any clashing seal, including its own group', () => {
    const groups = sealDuplicateGroupsOf(response);
    expect(validateSealCorrection('PH-0135152', groups)).toMatchObject({ valid: false, error: DUPLICATE_SEAL_MESSAGE });
    expect(validateSealCorrection('PH-88990011', groups)).toMatchObject({ valid: true, value: 'PH-88990011' });
    expect(validateSealCorrection('PH-', groups)).toMatchObject({ valid: false, error: SEAL_DIGITS_MESSAGE });
  });
});
