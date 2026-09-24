// src/utils/rrrPayload.js
// Payload builder for POST /external/jed/generate-ref, used by
// InstallationDetail.jsx's Generate RRR action (the only place this
// happens — a duplicate standalone tab in PaymentsPage was removed as
// unnecessary since RRR generation is always in the context of a
// specific installation). Field-mapping logic (and the required-fields
// list shown in GenerateRRRModal) lives in exactly one place.

// Fields required by POST /external/jed/generate-ref per the API docs.
// Checked before submit so the admin sees exactly what's missing instead
// of a generic 400 validation error from the backend.
export const REQUIRED_RRR_FIELDS = [
  { key: 'accountNumber', label: 'Account Number' },
  { key: 'custNames', label: 'Customer Name' },
  { key: 'gsm', label: 'Phone (GSM)' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' },
  { key: 'meterRecommended', label: 'Meter Type' },
  { key: 'discoCode', label: 'Disco Code' },
];

/**
 * Builds the generate-ref payload from a customer request record, trying
 * the same plausible field-name variants used elsewhere in this codebase
 * for unconfirmed response shapes.
 * @param {Object|null} job - a JedCustomerRequest-shaped record
 */
export function buildRrrPayload(job) {
  if (!job) return null;
  return {
    accountNumber: job.accountNumber,
    custNames: job.custNames || job.customerName || job.applicantName || '',
    gsm: job.phone || job.phoneNumber || job.msisdn || '',
    email: job.email || job.emailAddress || '',
    address: job.address || job.customerAddress || '',
    meterRecommended: job.meterRecommended || job.meterType || job.meterModel || '',
    discoCode: job.discoCode || job.disco || '',
    requestRef: job.requestRef || job.requestRefNo || job.requestId || job.id || '',
    region: job.region || job.area || job.location || '',
  };
}
