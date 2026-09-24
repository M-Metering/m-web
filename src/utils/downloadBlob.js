// src/utils/downloadBlob.js
// Trigger a browser download for a Blob the API returned, and always revoke
// the object URL afterwards. New code uses this; the older per-page copies
// (MeterSchedule, ExcelUpload, AdminDashboard) are left alone deliberately —
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
    URL.revokeObjectURL(url);
  }
}

export default downloadBlob;
