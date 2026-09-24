// Robust date parsing and formatting helpers used across the app.
// Handles strings, numbers (seconds or milliseconds), Date objects,
// Firestore-like timestamp objects ({ seconds, nanoseconds }), and
// objects exposing a `toDate()` method.
export function parseTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;

  // Date instance
  if (value instanceof Date) return value;

  // If object exposes toDate (e.g. Firestore Timestamp)
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    try { return value.toDate(); } catch { /* fall through */ }
  }

  // Firestore-like fields
  if (typeof value === 'object') {
    const sec = value.seconds ?? value._seconds ?? value.secondsValue;
    const nanos = value.nanoseconds ?? value._nanoseconds ?? value.nanos ?? 0;
    if (typeof sec === 'number' || typeof sec === 'string') {
      const ms = Number(sec) * 1000 + Math.floor(Number(nanos || 0) / 1e6);
      return new Date(ms);
    }
  }

  // Numbers: seconds (10 digits) or milliseconds (13+ digits)
  if (typeof value === 'number') {
    // heuristic: if < 1e12 treat as seconds
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms);
  }

  // Strings: attempt Date.parse
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // ISO / numeric string
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return new Date(parsed);

    // Try numeric string
    const asNum = Number(trimmed);
    if (!Number.isNaN(asNum)) return parseTimestamp(asNum);
  }

  return null;
}

export function formatDateTime(value, options = {}) {
  const d = parseTimestamp(value);
  if (!d) return '-';

  const opts = Object.assign({
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  }, options);

  try {
    return d.toLocaleString(undefined, opts);
  } catch {
    return d.toString();
  }
}

export function formatDateOnly(value, localeOptions = {}) {
  const d = parseTimestamp(value);
  if (!d) return '-';
  try {
    return d.toLocaleDateString(undefined, localeOptions);
  } catch {
    return d.toDateString();
  }
}

// ISO `startDate`/`endDate` covering "the last N days including today" — the
// documented date-range params of GET /external/jed/payments (start is local
// midnight N-1 days ago, end is now). Same window AdminDashboard's trend
// chart uses.
export function getRecentDaysRange(days) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);
  return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
}

// ---------------------------------------------------------------------------
// PLAIN DATES ('YYYY-MM-DD', no timezone)
//
// The multi-disco installation flow's `installationDate` is a calendar date,
// not an instant. Running one through `new Date(...).toISOString()` shifts it
// to the previous day in WAT (+01:00) and anywhere else east of UTC, so these
// two helpers keep such values in local calendar terms and never convert.
// Use parseTimestamp/formatDateTime for real timestamps (createdAt, assignedAt,
// reportedAt); use these for date-only fields.
// ---------------------------------------------------------------------------

/** Today (or a given Date) as 'YYYY-MM-DD' in LOCAL time — for <input type="date">. */
export function toDateInputValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Display a 'YYYY-MM-DD' plain date without any timezone conversion. */
export function formatPlainDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!match) return value ? formatDateOnly(value) : '-';
  const [, y, m, d] = match;
  // Constructed in local time (not Date.parse, which reads a bare
  // 'YYYY-MM-DD' as UTC midnight and can render as the day before).
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return '-';
  try {
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  } catch {
    return `${y}-${m}-${d}`;
  }
}

export default { parseTimestamp, formatDateTime, formatDateOnly, toDateInputValue, formatPlainDate };
