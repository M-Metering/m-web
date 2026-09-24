/**
 * Currency Formatting Utility
 * Centralizes all currency formatting to NGN
 */

export const formatCurrencyNGN = (value) => {
  let amount = value;
  if (typeof amount === 'string') {
    const numericValue = Number(amount.replace(/,/g, ''));
    if (!Number.isNaN(numericValue)) {
      amount = numericValue;
    }
  }

  if (typeof amount !== 'number') return value ?? '-';
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
};

/**
 * Format a number as currency (NGN) with thousands separator
 */
export const formatNumber = (value) => {
  if (typeof value !== 'number') return value ?? '-';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
};

export default formatCurrencyNGN;
