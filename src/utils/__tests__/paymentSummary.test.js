import { describe, it, expect } from 'vitest';
import { parseAmount } from '../paymentSummary';

describe('parseAmount', () => {
  it.each([
    [67000, 67000],
    ['67,000', 67000],
    [' 1500.50 ', 1500.5],
    [0, null],
    [-10, null],
    ['abc', null],
    [null, null],
    [undefined, null],
    ['', null],
    [Number.NaN, null],
  ])('%p → %p', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });
});
