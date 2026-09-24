// src/utils/fileValidation.js
// Client-side pre-checks for a user-selected upload file (ExcelUpload.jsx,
// BulkConfirmPaymentsTab.jsx). These are a UX convenience only — failing
// fast in the browser instead of after a slow upload — never the actual
// security boundary. A modified/scripted request can always skip the
// browser entirely, so the backend must independently validate file type,
// content, and size; see Security.md for that gap.
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

// No documented max upload size exists on the real API (see API_GAP_REPORT.md
// conventions — nothing invented here either); 10MB is a conservative client
// -side cap sized for the kind of customer/meter spreadsheets this app
// actually handles, chosen to fail fast rather than to match a confirmed
// backend limit.
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * @param {File|null} file
 * @returns {{ valid: boolean, reason: string|null }}
 */
export function validateUploadFile(file) {
  if (!file) {
    return { valid: false, reason: 'No file selected.' };
  }

  const name = String(file.name || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return { valid: false, reason: 'Unsupported file type — please select an Excel (.xlsx/.xls) or CSV file.' };
  }

  if (file.size === 0) {
    return { valid: false, reason: 'The selected file is empty.' };
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    const maxMb = MAX_UPLOAD_SIZE_BYTES / (1024 * 1024);
    return { valid: false, reason: `File is too large (${mb} MB) — the maximum is ${maxMb} MB.` };
  }

  return { valid: true, reason: null };
}
