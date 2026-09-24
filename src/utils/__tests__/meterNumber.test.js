import { describe, it, expect } from 'vitest';
import {
  meterNumberText, validateMeterNumber,
  METER_NUMBER_MIN_DIGITS, METER_NUMBER_MAX_DIGITS,
} from '../meterNumber';

describe('meterNumberText', () => {
  it('keeps the exact characters, including leading zeros', () => {
    expect(meterNumberText('0239110006909')).toBe('0239110006909');
    expect(meterNumberText('  145345123456 ')).toBe('145345123456');
  });

  it('never coerces to a number', () => {
    // A numeric input has already lost its leading zero before it gets here;
    // what matters is that nothing else is added or removed.
    expect(meterNumberText(145345123456)).toBe('145345123456');
    expect(meterNumberText(null)).toBe('');
    expect(meterNumberText(undefined)).toBe('');
  });
});

describe('validateMeterNumber', () => {
  it.each([10, 11, 12, 13])('accepts a %i-digit meter number unchanged', (len) => {
    const value = '1'.repeat(len);
    expect(validateMeterNumber(value)).toEqual({ valid: true, value, error: null });
  });

  it('accepts a legitimate leading zero and returns it untouched', () => {
    expect(validateMeterNumber('0239110006909')).toMatchObject({ valid: true, value: '0239110006909' });
  });

  it.each([
    ['', 'Meter number is required.'],
    ['   ', 'Meter number is required.'],
  ])('rejects %j', (input, error) => {
    expect(validateMeterNumber(input)).toMatchObject({ valid: false, error });
  });

  it('rejects non-digits without altering the value', () => {
    const result = validateMeterNumber('1453-45123456');
    expect(result.valid).toBe(false);
    expect(result.value).toBe('1453-45123456');
  });

  it.each(['1'.repeat(METER_NUMBER_MIN_DIGITS - 1), '1'.repeat(METER_NUMBER_MAX_DIGITS + 1)])(
    'rejects an out-of-range length (%s) rather than padding or truncating it',
    (value) => {
      const result = validateMeterNumber(value);
      expect(result.valid).toBe(false);
      expect(result.value).toBe(value);
      expect(result.error).toMatch(/10-13 digits/);
    }
  );
});
