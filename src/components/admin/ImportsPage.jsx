// src/components/admin/ImportsPage.jsx
// Admin: bring a disco's spreadsheets into the system.
//   POST /imports/{discoCode}/pending-installations  — the customer sheet
//   POST /imports/{discoCode}/meters                 — meter + SIM inventory
//
// Imports are idempotent: re-uploading the same file counts the existing rows
// as `skipped` rather than duplicating them. They are also partial-success —
// a 201 can still carry rejected rows and a 200 means nothing landed — so the
// result is always rendered through BatchResultSummary, which surfaces the
// per-row errors with their 1-based spreadsheet row numbers.
import { useState, useEffect, useCallback } from 'react';
import {
  Upload, FileDown, AlertCircle, Loader2, RefreshCw, FileSpreadsheet, ChevronRight, X,
} from 'lucide-react';
import jedApi from '../services/api';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import { usePermissions } from '../auth/usePermissions';
import StatusTabs from '../common/StatusTabs';
import BatchResultSummary from '../installations/BatchResultSummary';
import { useDiscoOptions } from '../../hooks/useDiscoOptions';
import { fetchAllPages } from '../../utils/fetchAllPages';
import { getErrorMessage } from '../../utils/errorMessage';
import { validateUploadFile } from '../../utils/fileValidation';
import { downloadBlob } from '../../utils/downloadBlob';
import { formatDateTime } from '../../utils/date';

const IMPORT_TYPES = {
  PENDING_INSTALLATIONS: {
    id: 'PENDING_INSTALLATIONS',
    label: 'Pending installations',
    description: "The disco's customer sheet — creates installation requests in PENDING.",
    upload: (code, form) => jedApi.importPendingInstallations(code, form),
    template: (code) => jedApi.downloadPendingInstallationsTemplate(code),
    accepted: 'Requests created',
  },
  METER_INVENTORY: {
    id: 'METER_INVENTORY',
    label: 'Meter inventory',
    description: 'Meter serials and SIM numbers — adds stock that can then be dispatched.',
    upload: (code, form) => jedApi.importMeterInventory(code, form),
    template: (code) => jedApi.downloadMeterInventoryTemplate(code),
    accepted: 'Meters created',
  },
};

function ImportsPage() {
  const permissions = usePermissions();
  const { notifyDataChanged } = useDataRefresh();
  const { discos, loading: discosLoading, error: discosError } = useDiscoOptions();

  const [activeTab, setActiveTab] = useState('upload');
  const [discoCode, setDiscoCode] = useState('');
  const [importType, setImportType] = useState(IMPORT_TYPES.PENDING_INSTALLATIONS.id);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [result, setResult] = useState(null);
  const [templateLoading, setTemplateLoading] = useState(false);

  const [batches, setBatches] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Default to the first disco once the list arrives.
  useEffect(() => {
    if (!discoCode && discos.length > 0) setDiscoCode(discos[0].code);
  }, [discos, discoCode]);

  useEffect(() => {
    if (activeTab !== 'history') return undefined;
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const list = await fetchAllPages((p) => jedApi.getImportBatches(p), {});
        if (!cancelled) setBatches(list);
      } catch (err) {
        console.error('[Imports] Failed to load history:', err);
        if (!cancelled) setHistoryError(getErrorMessage(err, 'Unable to load import history.'));
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, refreshKey]);

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0] || null;
    setResult(null);
    setUploadError(null);
    if (selected) {
      const { valid, reason } = validateUploadFile(selected);
      if (!valid) {
        setFile(null);
        setFileError(reason);
        e.target.value = '';
        return;
      }
    }
    setFile(selected);
    setFileError(null);
  };

  const handleTemplate = async () => {
    if (!discoCode) return;
    setTemplateLoading(true);
    setUploadError(null);
    try {
      const { blob, filename } = await IMPORT_TYPES[importType].template(discoCode);
      downloadBlob(blob, filename || `${discoCode}-${importType.toLowerCase()}-template.xlsx`);
    } catch (err) {
      console.error('[Imports] Template download failed:', err);
      setUploadError(getErrorMessage(err, 'Could not download the template.'));
    } finally {
      setTemplateLoading(false);
    }
  };

  const handleUpload = async () => {
    if (uploading || !file || !discoCode) return;
    setUploading(true);
    setUploadError(null);
    setResult(null);
    try {
      // Field name must be exactly "file", and Content-Type is left to the
      // browser so the multipart boundary is generated correctly.
      const form = new FormData();
      form.append('file', file);

      const response = await IMPORT_TYPES[importType].upload(discoCode, form);
      setResult(response?.data || response);
      setFile(null);
      const input = document.getElementById('import-file');
      if (input) input.value = '';
      notifyDataChanged();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('[Imports] Upload failed:', err);
      setUploadError(getErrorMessage(err, 'The import could not be processed.'));
    } finally {
      setUploading(false);
    }
  };

  const openDetail = useCallback(async (batch) => {
    setDetail(batch);
    setDetailLoading(true);
    try {
      // The list endpoint omits per-row errors; the single-batch one has them.
      const response = await jedApi.getImportBatch(batch.id);
      setDetail(response?.data || response || batch);
    } catch (err) {
      console.error('[Imports] Failed to load batch detail:', err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  if (!permissions.canRunImports) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Access Denied</h2>
        <p className="text-gray-600 dark:text-gray-400">You don't have permission to run imports.</p>
      </div>
    );
  }

  const selectedType = IMPORT_TYPES[importType];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-3 min-w-0">
        <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-lg shrink-0">
          <FileSpreadsheet className="w-6 h-6 text-brand-600 dark:text-brand-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white truncate">Imports</h1>
          <p className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm truncate">
            Bring a disco's customer and meter spreadsheets into the system
          </p>
        </div>
      </div>

      {discosError && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-300">{discosError}</p>
        </div>
      )}

      <div className="card overflow-hidden">
        <StatusTabs
          tabs={[
            { id: 'upload', label: 'New import', icon: Upload },
            { id: 'history', label: 'History', icon: FileSpreadsheet, count: batches.length || undefined },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />

        {activeTab === 'upload' ? (
          <div className="p-4 sm:p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="import-disco" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Disco<span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span>
                </label>
                <select
                  id="import-disco"
                  value={discoCode}
                  onChange={(e) => setDiscoCode(e.target.value)}
                  disabled={discosLoading || uploading}
                  className="form-input w-full px-3 py-2.5 text-sm"
                >
                  <option value="">{discosLoading ? 'Loading discos…' : 'Select a disco…'}</option>
                  {discos.map((d) => (
                    <option key={d.code} value={d.code}>{d.name} ({d.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="import-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  What is in this file?
                </label>
                <select
                  id="import-type"
                  value={importType}
                  onChange={(e) => { setImportType(e.target.value); setResult(null); }}
                  disabled={uploading}
                  className="form-input w-full px-3 py-2.5 text-sm"
                >
                  {Object.values(IMPORT_TYPES).map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">{selectedType.description}</p>

            <div>
              <label htmlFor="import-file" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Spreadsheet<span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span>
              </label>
              <input
                id="import-file"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                disabled={uploading}
                className="form-input w-full px-3 py-2 text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-brand-500 file:text-gray-900"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                .xlsx, .xls or .csv, up to 10MB. Re-uploading the same file is safe — rows already present are skipped.
              </p>
              {fileError && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">{fileError}</p>}
            </div>

            {uploadError && (
              <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-800 dark:text-red-300">{uploadError}</p>
              </div>
            )}

            {result && <BatchResultSummary data={result} acceptedLabel={selectedType.accepted} />}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-1">
              <button
                type="button"
                onClick={handleTemplate}
                disabled={!discoCode || templateLoading || uploading}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                {templateLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                Blank template
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={!file || !discoCode || uploading}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-brand-500 text-gray-900 hover:bg-brand-600 disabled:opacity-60"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? 'Importing…' : 'Import file'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700 flex justify-end">
              <button
                type="button"
                onClick={() => { jedApi.clearCache(); setRefreshKey((k) => k + 1); }}
                disabled={historyLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${historyLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {historyError && (
              <div role="alert" className="m-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <p className="text-sm text-red-800 dark:text-red-300">{historyError}</p>
              </div>
            )}

            {historyLoading && batches.length === 0 ? (
              <div className="py-16 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
              </div>
            ) : batches.length === 0 ? (
              <div className="py-16 text-center">
                <FileSpreadsheet className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-gray-600 dark:text-gray-400 font-medium">No imports yet</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {batches.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => openDetail(b)}
                      className="w-full text-left p-4 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-900/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs text-gray-900 dark:text-white truncate">{b.batchRef}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                          {b.fileName || 'file'} &middot; {b.discoCode} &middot; {formatDateTime(b.createdAt)}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                          <span className="text-green-700 dark:text-green-400">{b.created ?? 0} created</span>
                          {b.skipped ? ` · ${b.skipped} skipped` : ''}
                          {b.failed ? <span className="text-red-700 dark:text-red-400">{` · ${b.failed} failed`}</span> : ''}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Batch detail — the only place per-row errors are available */}
      {detail && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="batch-title"
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] flex flex-col">
            <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="batch-title" className="text-lg font-semibold text-gray-900 dark:text-white">Import batch</h2>
                <p className="font-mono text-xs text-gray-500 dark:text-gray-400 truncate">{detail.batchRef}</p>
              </div>
              <button type="button" onClick={() => setDetail(null)} aria-label="Close"
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
              <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                <p>File: <span className="text-gray-900 dark:text-white">{detail.fileName || '—'}</span>{detail.sheetName ? ` · sheet "${detail.sheetName}"` : ''}</p>
                <p>Disco: <span className="text-gray-900 dark:text-white">{detail.discoCode}</span> · {formatDateTime(detail.createdAt)}</p>
                <p>Rows in file: <span className="text-gray-900 dark:text-white">{detail.totalRows ?? '—'}</span></p>
              </div>
              {detailLoading ? (
                <div className="py-8 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-brand-600" />
                </div>
              ) : (
                <BatchResultSummary data={detail} acceptedLabel="Created" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ImportsPage;
