// src/utils/trendAggregation.js
// Client-side aggregation of real API records into a daily time series.
// No values are invented: every bucket is either a real sum/count derived
// from fetched records, or explicitly zero because nothing happened that
// day. Used by AdminDashboard's Revenue/Installations trend charts.
import { parseTimestamp } from './date';

const toDayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Buckets `records` into one entry per calendar day across the last `days`
 * days (inclusive of today), summing or counting a field per day.
 *
 * @param {Array<Object>} records
 * @param {Object} options
 * @param {string} options.dateField - field on each record holding the timestamp to bucket by
 * @param {string} [options.valueField] - field to sum (ignored when aggregate is 'count')
 * @param {'sum'|'count'} [options.aggregate='sum']
 * @param {number} options.days - size of the trailing window, e.g. 7/30/90
 * @returns {Array<{date: string, value: number}>} one entry per day, oldest first
 */
export function buildDailySeries(records, { dateField, valueField, aggregate = 'sum', days }) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const buckets = new Map();
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    buckets.set(toDayKey(d), 0);
  }

  for (const record of records || []) {
    const parsed = parseTimestamp(record?.[dateField]);
    if (!parsed) continue;
    const key = toDayKey(parsed);
    if (!buckets.has(key)) continue; // outside the requested window

    if (aggregate === 'count') {
      buckets.set(key, buckets.get(key) + 1);
    } else {
      buckets.set(key, buckets.get(key) + (Number(record?.[valueField]) || 0));
    }
  }

  return Array.from(buckets.entries()).map(([date, value]) => ({ date, value }));
}

/**
 * Rounds up to a "clean" axis maximum (1/2/5 x 10^n), matching the
 * dataviz guidance to keep y-axis ticks at round numbers.
 */
export function niceMax(value) {
  if (!value || value <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const residual = value / magnitude;
  let niceResidual;
  if (residual <= 1) niceResidual = 1;
  else if (residual <= 2) niceResidual = 2;
  else if (residual <= 5) niceResidual = 5;
  else niceResidual = 10;
  return niceResidual * magnitude;
}
