// src/utils/downloadBlob.js
// Trigger a browser download for a Blob the API returned, and always revoke
// the object URL afterwards. New code uses this; the older per-page copies
// (MeterSchedule, MeterWorkbookUpload, AdminDashboard) are left alone deliberately —
// they work, and rewriting them is unrelated risk.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoked on the next tick, not synchronously: some browsers (Safari,
    // some mobile ones) start reading the URL only after click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export default downloadBlob;
