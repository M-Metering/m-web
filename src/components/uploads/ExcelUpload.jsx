import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { PERMISSIONS, hasPermission } from '../auth/permissions';
import jedApi from '../services/api';
import { ENDPOINTS } from '../services/api.config.js';
import { downloadXlsx, COLUMN_TYPES } from '../../utils/xlsx';
import { validateUploadFile } from '../../utils/fileValidation';
import { getErrorMessage } from '../../utils/errorMessage';
import { AlertCircle, Upload, Download, FileCheck2, FileX2, Percent, List, FileDown } from 'lucide-react';

const UPLOAD_MODES = {
  METERS: {
    value: 'meters',
    label: 'Upload New Meters',
    description: 'Standard process for adding new meters to the system.',
    endpoint: ENDPOINTS.METERS.UPLOAD,
    apiGroup: 'METERS'
  },
  PROCESS_DEFAULT: {
    value: 'process-default',
    label: 'Process (Server Default)',
    description: 'Use the server\'s default Excel processing logic.',
    endpoint: ENDPOINTS.UPLOADS.EXCEL
  },
  PROCESS_FIRST_SHEET: {
    value: 'process-first-sheet',
    label: 'Process First Sheet Only',
    description: 'Only data from the first sheet of the Excel file will be processed.',
    endpoint: ENDPOINTS.UPLOADS.EXCEL_FIRST_SHEET
  },
  PROCESS_MODIFIED: {
    value: 'process-modified',
    label: 'Process & Download Modified File',
    description: 'The server will process the file and return a modified version for download.',
    endpoint: ENDPOINTS.UPLOADS.EXCEL_MODIFIED
  }
};

function ExcelUpload() {
  const { user } = useAuth();
  const [file, setFile] = useState(null);
  const [uploadMode, setUploadMode] = useState(UPLOAD_MODES.METERS.value);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);

  if (!hasPermission(user?.role, PERMISSIONS.UPLOADS.EXCEL)) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold">Access Denied</h2>
        <p className="text-gray-600 dark:text-gray-400">You don't have permission to upload installations.</p>
      </div>
    );
  }

  const handleFileChange = (e) => {
    const selected = e.target.files[0] || null;
    setMessage(null);
    setUploadResult(null);

    if (selected) {
      const { valid, reason } = validateUploadFile(selected);
      if (!valid) {
        setFile(null);
        setError(reason);
        e.target.value = '';
        return;
      }
    }

    setFile(selected);
    setError(null);
  };

  const handleDownloadTemplate = async () => {
    try {
      setError(null);
      setMessage('Preparing template...');
      const blob = await jedApi.downloadMetersTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'meters-template.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMessage('Template downloaded');
    } catch (err) {
      console.error('Template download failed', err);
      setError('Failed to download template.');
      setMessage(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file to upload.');
      return;
    }

    setUploading(true);
    setError(null);
    setMessage('Uploading...');
    setUploadResult(null);

    const selectedMode = Object.values(UPLOAD_MODES).find(m => m.value === uploadMode);

    try {
      const formData = new FormData();
      formData.append('file', file);
      // Only `file` is documented for POST /meters/upload and /uploads/* —
      // an `installerId` field used to be appended here from the stored
      // (client-editable) user record; it is undocumented, and uploads are
      // no longer an Installer feature, so it is gone.

      let response;
      if (selectedMode.apiGroup === 'METERS') {
        response = await jedApi.uploadMeters(formData);
      } else {
        response = await jedApi.processExcelUpload(selectedMode.endpoint, formData);
      }

      // Handle different response types
      if (response instanceof Blob) {
        const url = URL.createObjectURL(response);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'processed_file.xlsx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setMessage('Processed file downloaded successfully.');
      } else if (response.success && response.data) { // Standard meters upload response
        setUploadResult(response.data);
        setMessage(response.message || 'Meters uploaded successfully.');
      } else { // Other JSON responses
        setMessage(response.message || 'Upload completed successfully.');
      }

      setFile(null);
      document.querySelector('input[type="file"]').value = ''; // Reset file input
    } catch (err) {
      console.error('Upload failed', err);
      if (err?.status === 404) {
        setError('This upload mode is currently unavailable. Please try "Upload New Meters" or contact support.');
      } else if (err?.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else {
        // POST /meters/upload rejects the WHOLE file (nothing is imported) when
        // a METER NUMBER or SIM NUMBER cell is stored as a number rather than
        // text — Excel drops the leading zero and can't hold a 19-digit SIM.
        // That 400 names the row, the column and the fix, so it is shown as-is;
        // the wider allowance exists for exactly this message and still passes
        // every other safety filter in getErrorMessage.
        setError(getErrorMessage(err, 'An unknown error occurred during upload.', { maxLength: 280 }));
      }
      setMessage(null);
    } finally {
      setUploading(false);
    }
  };

  const handleClear = () => {
    setFile(null);
    setError(null);
    setMessage(null);
    setUploadResult(null);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-lg flex-shrink-0">
            <Upload className="w-6 h-6 text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Upload Meters (Excel)</h1>
            <p className="text-gray-600 dark:text-gray-400">Upload meters in bulk using an Excel file.</p>
          </div>
        </div>
        <div className="flex-shrink-0">
          <button 
            onClick={handleDownloadTemplate} 
            className="inline-flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium"
          >
            <Download className="w-4 h-4" />
            Download Template
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-300 dark:border-gray-700 p-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Excel file</label>
            <input 
              type="file" 
              accept=".xlsx,.xls,.csv" 
              onChange={handleFileChange} 
              disabled={uploading}
              className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100"
            />
            {file && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                Selected: <span className="font-mono">{file.name}</span> ({Math.round(file.size/1024)} KB)
              </p>
            )}
            {/* Said up front because the server rejects the WHOLE file for
                this — nothing is imported — and the round-trip is avoidable.
                Excel stores a Number cell as a number, which drops a meter
                number's leading zero and can't hold a 19-digit SIM at all. */}
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
              Format the <strong>METER NUMBER</strong> and <strong>SIM NUMBER</strong> columns as
              <strong> Text</strong> in Excel before saving. Left as numbers, a leading zero is lost
              and long SIM serials lose precision, and the upload is refused. The downloaded template
              is already formatted correctly.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Upload mode</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.values(UPLOAD_MODES).map(mode => (
                <label
                  key={mode.value}
                  className={`flex items-start p-3 border rounded-lg cursor-pointer transition-all ${
                    uploadMode === mode.value
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-400 dark:border-indigo-600 ring-2 ring-indigo-200 dark:ring-indigo-800'
                      : 'bg-white dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="upload-mode"
                    value={mode.value}
                    checked={uploadMode === mode.value}
                    onChange={() => setUploadMode(mode.value)}
                    className="mt-1 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="ml-3">
                    <span className={`font-medium ${
                      uploadMode === mode.value
                        ? 'text-indigo-900 dark:text-indigo-200'
                        : 'text-gray-800 dark:text-gray-200'
                    }`}>{mode.label}</span>
                    <p className={`text-sm mt-0.5 ${
                      uploadMode === mode.value
                        ? 'text-indigo-700 dark:text-indigo-300'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}>{mode.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="inline-flex items-center gap-2 bg-brand-500 text-gray-900 px-4 py-2 rounded-lg disabled:opacity-50 hover:bg-brand-600 transition-colors"
            >
              <Upload className="w-4 h-4" />
              {uploading ? 'Uploading...' : 'Upload'}
            </button>

            <button 
              onClick={handleClear} 
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Clear
            </button>
          </div>

          {/* Upload Results */}
          {uploadResult && (
            <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Upload Results</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={List} label="Total Rows" value={uploadResult.totalRows} />
                <StatCard icon={FileCheck2} label="Created" value={uploadResult.created} color="green" />
                <StatCard icon={FileX2} label="Failed" value={uploadResult.failed} color="red" />
                <StatCard icon={Percent} label="Success Rate" value={`${uploadResult.successRate || Math.round((uploadResult.created / uploadResult.totalRows) * 100)}%`} color="blue" />
              </div>

              {/* Error Details */}
              {uploadResult.errors && uploadResult.errors.length > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-medium text-gray-900 dark:text-white">Error Details ({uploadResult.errors.length})</h4>
                    <button
                      onClick={() => exportErrorsToExcel(uploadResult.errors)}
                      className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    >
                      <FileDown className="w-4 h-4" />
                      Export Errors
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-100 dark:bg-gray-900/50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Row</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Meter Number</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Error</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {uploadResult.errors.map((error, index) => (
                          <tr key={index} className="hover:bg-gray-50 dark:bg-gray-900/50">
                            <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">{error.row + 1}</td>
                            <td className="px-3 py-2 text-sm text-gray-900 dark:text-white font-mono">{error.meterNumber}</td>
                            <td className="px-3 py-2 text-sm text-red-600">{error.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Messages and Errors */}
          {message && !uploadResult && (
            <div className="mt-4 p-3 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg text-brand-700 dark:text-brand-300 text-sm">
              {message}
            </div>
          )}
          {error && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

 
const StatCard = ({ icon: Icon, label, value, color = 'gray' }) => {
  const colors = {
    gray: 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700',
    green: 'text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    red: 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    blue: 'text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-800',
  };
  const textColors = {
    gray: 'text-gray-900 dark:text-white',
    green: 'text-green-700 dark:text-green-300',
    red: 'text-red-700 dark:text-red-300',
    blue: 'text-brand-700 dark:text-brand-300',
  }
  return (
    <div className={`flex items-center p-3 rounded-lg border ${colors[color]}`}>
      <Icon className={`w-6 h-6 mr-3 ${textColors[color]}`} />
      <div>
        <div className={`text-2xl font-bold ${textColors[color]}`}>{value}</div>
        <div className="text-sm font-medium">{label}</div>
      </div>
    </div>
  );
};

// Excel, not CSV — meter numbers keep their leading zeros (see utils/xlsx.js).
const exportErrorsToExcel = (errors) => downloadXlsx('upload_errors.xlsx', [{
  name: 'Errors',
  columns: [
    { header: 'Row', key: 'row', type: COLUMN_TYPES.NUMBER },
    { header: 'Meter Number', key: 'meterNumber', type: COLUMN_TYPES.TEXT },
    { header: 'Error', key: 'error', type: COLUMN_TYPES.TEXT },
  ],
  rows: errors.map((e) => ({ row: e.row + 1, meterNumber: e.meterNumber, error: e.error })),
}]).catch((err) => console.error('[ExcelUpload] Error export failed:', err));

export default ExcelUpload;