// src/utils/complaint.js
// Pure logic for the Installer Complaint form (constants, validation, and the
// plain-text summary). No React, no network — kept apart from the component so
// it can be exercised on its own and reused unchanged once the backend has a
// complaints endpoint.
//
// IMPORTANT: none of these field names are a backend contract. The API has no
// complaints/issues/incident endpoint at all (see API_GAP_REPORT.md), so the
// shape below is the UI's own; the backend must define the real one.

export const NO_JOB = '__none__'; // "not related to a specific installation"

export const COMPLAINT_CATEGORIES = [
  'Customer Unavailable',
  'Incorrect Customer Information',
  'Location/Address Issue',
  'Meter or Equipment Issue',
  'Safety Concern',
  'Network/Technical Issue',
  'Access Restriction',
  'Missing Materials',
  'Other',
];

export const COMPLAINT_PRIORITIES = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

export const COMPLAINT_IMPACTS = [
  { value: 'BLOCKING', label: 'Blocking — I cannot install' },
  { value: 'DELAYING', label: 'Delaying — installation is slowed or postponed' },
  { value: 'NONE', label: 'No impact on the installation' },
];

export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 1000;
export const REMARKS_MAX = 500;

// value for <input type="datetime-local"> (local time, minute precision)
export function toLocalDateTimeInputValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Free text from a form: drop control characters (keep newline/tab), trim.
export function cleanText(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

/**
 * @param {Object} values - { job, category, priority, impact, issueAt, description, remarks }
 * @param {Date} [now]
 * @returns {Object} field -> message (empty object when valid)
 */
export function validateComplaint(values, now = new Date()) {
  const errors = {};
  const v = values || {};

  if (!v.job) errors.job = 'Select the installation this is about, or "Not related to a specific job".';

  if (!COMPLAINT_CATEGORIES.includes(v.category)) errors.category = 'Choose a category.';
  if (!COMPLAINT_PRIORITIES.some((p) => p.value === v.priority)) errors.priority = 'Choose a priority.';
  if (!COMPLAINT_IMPACTS.some((i) => i.value === v.impact)) errors.impact = 'Choose how this affects the installation.';

  if (!v.issueAt) {
    errors.issueAt = 'Enter when the issue happened.';
  } else {
    const t = new Date(v.issueAt).getTime();
    if (Number.isNaN(t)) errors.issueAt = 'Enter a valid date and time.';
    else if (t > now.getTime() + 60 * 1000) errors.issueAt = 'The date and time cannot be in the future.';
  }

  const description = cleanText(v.description);
  if (!description) errors.description = 'Describe the issue.';
  else if (description.length < DESCRIPTION_MIN) errors.description = `Please give a little more detail (at least ${DESCRIPTION_MIN} characters).`;
  else if (description.length > DESCRIPTION_MAX) errors.description = `Keep the description under ${DESCRIPTION_MAX} characters.`;

  if (cleanText(v.remarks).length > REMARKS_MAX) errors.remarks = `Keep remarks under ${REMARKS_MAX} characters.`;

  return errors;
}

/**
 * Plain-text version of a validated complaint, for the installer to copy and
 * pass on through their normal channel while no complaints API exists.
 * @param {Object} args - { values, job (request record or null), reportedBy (string|null) }
 */
export function buildComplaintSummary({ values, job, reportedBy }) {
  const label = (list, value) => list.find((x) => x.value === value)?.label || value;
  const issueAt = new Date(values.issueAt);
  const lines = [
    'INSTALLATION COMPLAINT — ME Metering',
    job
      ? `Job: Account ${job.accountNumber}${job.custNames || job.applicantName ? ` — ${job.custNames || job.applicantName}` : ''}`
      : 'Job: not related to a specific installation',
  ];
  if (job?.address) lines.push(`Address: ${job.address}`);
  lines.push(
    `Category: ${values.category}`,
    `Priority: ${label(COMPLAINT_PRIORITIES, values.priority)}`,
    `Impact: ${label(COMPLAINT_IMPACTS, values.impact)}`,
    `Date/time of issue: ${Number.isNaN(issueAt.getTime()) ? values.issueAt : issueAt.toLocaleString()}`,
    '',
    'Description:',
    cleanText(values.description)
  );
  if (cleanText(values.remarks)) lines.push('', 'Remarks:', cleanText(values.remarks));
  if (reportedBy) lines.push('', `Reported by: ${reportedBy}`);
  return lines.join('\n');
}
