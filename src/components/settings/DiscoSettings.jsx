// src/components/settings/DiscoSettings.jsx
// Settings → Discos (Super Admin only — disco configuration is SUPERADMIN-only
// on the API; see the note on IMPORTS in auth/permissions.js).
//
// A disco is server data (GET /discos), and every disco selector in the app —
// Installations, Assignments, Imports, Reports, Meter Types, Assign Meter —
// reads that list. So adding a disco (e.g. PHEDC) is: register it here with
// the column mapping its customer sheet needs, and it appears everywhere.
//
//   POST /discos                       — register { code, name, integrationMode, contactEmail?, importMapping }
//   GET  /discos/{code}                — the disco with its importMapping
//   PUT  /discos/{code}/import-mapping — REPLACES the whole mapping
//
// The mapping logic (fields, suggestion from a sample sheet, validation, the
// whole-object merge) is utils/discoImportMapping.js. Only the
// pendingInstallations section is edited here; meterInventory is carried
// through untouched on an edit, and copied from an existing disco on create.
import { useState, useMemo, useCallback } from 'react';
import { Plus, Check, X, AlertCircle, Loader2, RefreshCw, Building2, Columns3 } from 'lucide-react';
import jedApi from '../services/api';
import ConfirmationModal from '../common/ConfirmationModal';
import ImportFileCheck from '../admin/ImportFileCheck';
import { useDiscoOptions } from '../../hooks/useDiscoOptions';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import { getErrorMessage } from '../../utils/errorMessage';
import { assertApiSuccess } from '../../utils/apiResult';
import { validateUploadFile } from '../../utils/fileValidation';
import { readSpreadsheetRows } from '../../utils/xlsx';
import {
  IMPORT_FIELDS, toMappingForm, suggestMappingForm, validateMappingForm, toServerMapping,
  meterInventoryForNewDisco, checkSheetAgainstMapping, validateNewDisco,
} from '../../utils/discoImportMapping';

const emptyDisco = () => ({ code: '', name: '', integrationMode: 'OFFLINE', contactEmail: '', copyFrom: '' });
const unwrap = (response) => response?.data ?? response;

/** The pendingInstallations column editor, shared by Register and Edit. */
function MappingEditor({ form, onChange, base, disabled }) {
  const [sampleRows, setSampleRows] = useState(null);
  const [sampleName, setSampleName] = useState('');
  const [sampleError, setSampleError] = useState(null);
  const [reading, setReading] = useState(false);

  const check = useMemo(
    () => (sampleRows ? checkSheetAgainstMapping(sampleRows, toServerMapping(form, base).pendingInstallations) : null),
    [sampleRows, form, base]
  );

  const setField = (field, patch) =>
    onChange({ ...form, fields: { ...form.fields, [field]: { ...form.fields[field], ...patch } } });

  const handleSample = async (e) => {
    const file = e.target.files?.[0];
    setSampleError(null);
    if (!file) return;
    const { valid, reason } = validateUploadFile(file);
    if (!valid) { setSampleError(reason); e.target.value = ''; return; }
    if (/\.xls$/i.test(file.name)) {
      setSampleError('Legacy .xls files can’t be read in the browser. Save it as .xlsx and pick it again.');
      e.target.value = '';
      return;
    }
    setReading(true);
    try {
      const { rows } = await readSpreadsheetRows(file);
      setSampleRows(rows);
      setSampleName(file.name);
      onChange(suggestMappingForm(form, rows));
    } catch (err) {
      console.error('[Discos] Could not read the sample sheet:', err);
      setSampleError(getErrorMessage(err, 'That spreadsheet could not be read.'));
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="disco-sample" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Fill from a sample sheet
        </label>
        <input
          id="disco-sample"
          type="file"
          accept=".xlsx,.csv"
          onChange={handleSample}
          disabled={disabled || reading}
          className="form-input w-full px-3 py-2 text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-brand-500 file:text-gray-900"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Optional. Pick one of this disco’s customer sheets: its headers are matched to the fields below and the file is checked. Nothing is uploaded.
        </p>
        {reading && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Reading {sampleName || 'file'}…</p>}
        {sampleError && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">{sampleError}</p>}
      </div>

      {check && <ImportFileCheck check={check} />}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Field</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Spreadsheet headers</th>
              <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Required</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {IMPORT_FIELDS.map((def) => (
              <tr key={def.field}>
                <td className="px-3 py-2 text-gray-900 dark:text-white whitespace-nowrap">
                  <label htmlFor={`map-${def.field}`}>{def.label}</label>
                </td>
                <td className="px-3 py-2 min-w-[14rem]">
                  <input
                    id={`map-${def.field}`}
                    type="text"
                    value={form.fields[def.field]?.headers || ''}
                    onChange={(e) => setField(def.field, { headers: e.target.value })}
                    disabled={disabled}
                    placeholder="Not imported"
                    className="form-input w-full px-3 py-1.5 text-sm font-mono"
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label={`${def.label} required`}
                    checked={Boolean(form.fields[def.field]?.required)}
                    onChange={(e) => setField(def.field, { required: e.target.checked })}
                    disabled={disabled || def.required}
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Separate alternative headers with commas. Case, spaces and punctuation are ignored (ACCOUNT_NO matches “Account No”).
        Account number is the duplicate key: a row whose account is already imported for this disco is skipped.
        A sheet without a meter type column imports with no meter type — none is assumed.
      </p>

      <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={form.captureExtras}
          onChange={(e) => onChange({ ...form, captureExtras: e.target.checked })}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500"
        />
        <span>Keep every other column on the record as extra details (recommended — nothing in the sheet is discarded).</span>
      </label>
    </div>
  );
}

function ErrorList({ errors }) {
  if (!errors?.length) return null;
  return (
    <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
      <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
      <ul className="text-sm text-red-800 dark:text-red-300 space-y-0.5">
        {errors.map((e) => <li key={e}>{e}</li>)}
      </ul>
    </div>
  );
}

const DiscoSettings = () => {
  const { notifyDataChanged } = useDataRefresh();
  // Inactive discos too: this is the one screen that manages them.
  const { discos, loading, error: listError, reload } = useDiscoOptions({ activeOnly: false });
  const sortedDiscos = useMemo(
    () => [...discos].sort((a, b) => String(a.code).localeCompare(String(b.code))),
    [discos]
  );

  // Register
  const [creating, setCreating] = useState(false);
  const [disco, setDisco] = useState(emptyDisco());
  const [createForm, setCreateForm] = useState(() => toMappingForm(null));
  const [createErrors, setCreateErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  // Edit import columns
  const [editing, setEditing] = useState(null); // { code, name, mapping }
  const [editForm, setEditForm] = useState(null);
  const [editErrors, setEditErrors] = useState([]);
  const [editLoading, setEditLoading] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);

  const busy = saving || editLoading;

  const startCreate = () => {
    setEditing(null);
    setNotice(null);
    setDisco({ ...emptyDisco(), copyFrom: sortedDiscos[0]?.code || '' });
    setCreateForm(toMappingForm(null));
    setCreateErrors([]);
    setCreating(true);
  };

  const handleCreate = async () => {
    const code = disco.code.trim().toUpperCase();
    const email = disco.contactEmail.trim();
    const errors = [
      ...validateNewDisco({ code, name: disco.name }, discos),
      ...(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? ['Contact email is not a valid email address.'] : []),
      ...validateMappingForm(createForm),
    ];
    setCreateErrors(errors);
    if (errors.length) return;

    setSaving(true);
    try {
      // The meter-inventory columns come from an existing disco, so meter
      // imports for the new one read sheets the same way. If that read fails
      // the section is left out and the server's default applies.
      let base = {};
      if (disco.copyFrom) {
        try {
          const source = unwrap(await jedApi.getDisco(disco.copyFrom));
          const meterInventory = meterInventoryForNewDisco(source?.importMapping);
          if (meterInventory) base = { meterInventory };
        } catch (err) {
          console.warn('[Discos] Could not read the source disco’s meter columns:', err);
        }
      }
      const payload = {
        code,
        name: disco.name.trim(),
        integrationMode: disco.integrationMode,
        ...(email ? { contactEmail: email } : {}),
        importMapping: toServerMapping(createForm, base),
      };
      assertApiSuccess(await jedApi.createDisco(payload), 'The server did not confirm the new disco.');
      setCreating(false);
      setNotice(`${code} is registered. It is now available in Imports, Installations, Assignments, Reports and Meter Types.`);
      reload();
      notifyDataChanged();
    } catch (err) {
      console.error('[Discos] Failed to register disco:', err);
      setCreateErrors([getErrorMessage(err, 'The disco could not be registered.')]);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = useCallback(async (d) => {
    setCreating(false);
    setNotice(null);
    setEditErrors([]);
    setEditing({ code: d.code, name: d.name, mapping: null });
    setEditForm(null);
    setEditLoading(true);
    try {
      // GET /discos/{code} carries the mapping; the list doesn't. Read fresh —
      // the PUT replaces the whole object, so it must start from what's stored.
      jedApi.clearCache();
      const full = unwrap(await jedApi.getDisco(d.code));
      const mapping = full?.importMapping || {};
      setEditing({ code: d.code, name: d.name, mapping });
      setEditForm(toMappingForm(mapping));
    } catch (err) {
      console.error('[Discos] Failed to load disco mapping:', err);
      setEditErrors([getErrorMessage(err, 'This disco’s import columns could not be loaded.')]);
    } finally {
      setEditLoading(false);
    }
  }, []);

  const requestSave = () => {
    const errors = validateMappingForm(editForm);
    setEditErrors(errors);
    if (!errors.length) setConfirmSave(true);
  };

  const handleSave = async () => {
    if (!editing?.mapping) return;
    setSaving(true);
    try {
      const mapping = toServerMapping(editForm, editing.mapping);
      assertApiSuccess(await jedApi.replaceDiscoImportMapping(editing.code, mapping), 'The server did not confirm the change.');
      setConfirmSave(false);
      setNotice(`${editing.code}’s import columns are saved. They apply to the next import; records already imported are unchanged.`);
      setEditing(null);
      setEditForm(null);
    } catch (err) {
      console.error('[Discos] Failed to save import mapping:', err);
      setConfirmSave(false);
      setEditErrors([getErrorMessage(err, 'The import columns could not be saved.')]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Discos</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Distribution companies and the columns their customer sheets are imported with.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            aria-label="Refresh"
            className="p-2.5 sm:px-4 sm:py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline text-sm font-medium">Refresh</span>
          </button>
          <button
            type="button"
            onClick={startCreate}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Register Disco
          </button>
        </div>
      </div>

      {listError && <ErrorList errors={[listError]} />}
      {notice && (
        <div role="status" className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 flex items-start gap-2">
          <Check className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
          <p className="text-sm text-green-800 dark:text-green-300 flex-1">{notice}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-green-700 dark:text-green-400">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {creating && (
        <div className="card p-4 sm:p-6 space-y-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Register a Disco</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="disco-code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Code *</label>
              <input
                id="disco-code"
                type="text"
                value={disco.code}
                onChange={(e) => setDisco({ ...disco, code: e.target.value.toUpperCase() })}
                placeholder="e.g. PHEDC"
                disabled={saving}
                className="form-input w-full px-3 py-2 font-mono"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Permanent — imports, prices and exports are keyed by it.</p>
            </div>
            <div>
              <label htmlFor="disco-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
              <input
                id="disco-name"
                type="text"
                value={disco.name}
                onChange={(e) => setDisco({ ...disco, name: e.target.value })}
                placeholder="Full company name"
                disabled={saving}
                className="form-input w-full px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="disco-mode" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Integration</label>
              <select
                id="disco-mode"
                value={disco.integrationMode}
                onChange={(e) => setDisco({ ...disco, integrationMode: e.target.value })}
                disabled={saving}
                className="form-input w-full px-3 py-2"
              >
                <option value="OFFLINE">Offline (spreadsheets)</option>
                <option value="API">API</option>
              </select>
            </div>
            <div>
              <label htmlFor="disco-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contact email</label>
              <input
                id="disco-email"
                type="email"
                value={disco.contactEmail}
                onChange={(e) => setDisco({ ...disco, contactEmail: e.target.value })}
                disabled={saving}
                className="form-input w-full px-3 py-2"
              />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="disco-copy" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Meter inventory columns</label>
              <select
                id="disco-copy"
                value={disco.copyFrom}
                onChange={(e) => setDisco({ ...disco, copyFrom: e.target.value })}
                disabled={saving}
                className="form-input w-full px-3 py-2"
              >
                <option value="">Server default</option>
                {sortedDiscos.map((d) => <option key={d.code} value={d.code}>Same as {d.name ? `${d.name} (${d.code})` : d.code}</option>)}
              </select>
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Pending-installation sheet columns</h4>
            <MappingEditor form={createForm} onChange={setCreateForm} base={{}} disabled={saving} />
          </div>

          <ErrorList errors={createErrors} />

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setCreating(false)}
              disabled={saving}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {saving ? 'Registering…' : 'Register'}
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="card p-4 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Import columns · {editing.code}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 truncate">{editing.name}</p>
            </div>
            <button type="button" onClick={() => { setEditing(null); setEditForm(null); }} aria-label="Close"
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>
          {editLoading ? (
            <div className="py-8 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-600" /></div>
          ) : editForm ? (
            <MappingEditor form={editForm} onChange={setEditForm} base={editing.mapping} disabled={saving} />
          ) : null}
          <ErrorList errors={editErrors} />
          {editForm && (
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setEditing(null); setEditForm(null); }}
                disabled={saving}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={requestSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 transition-colors disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                Save columns
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                {['Code', 'Name', 'Integration', 'Status'].map((h) => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">{h}</th>
                ))}
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading && sortedDiscos.length === 0 ? (
                <tr><td colSpan="5" className="px-6 py-8 text-center"><Loader2 className="w-6 h-6 animate-spin text-brand-600 mx-auto" /></td></tr>
              ) : sortedDiscos.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                    <Building2 className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    No discos registered yet
                  </td>
                </tr>
              ) : sortedDiscos.map((d) => (
                <tr key={d.code} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-6 py-4 text-sm font-mono font-medium text-gray-900 dark:text-white">{d.code}</td>
                  <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{d.name || '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{d.integrationMode || '—'}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      d.isActive === false
                        ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
                        : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                    }`}>
                      {d.isActive === false ? 'Inactive' : 'Active'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => startEdit(d)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                    >
                      <Columns3 className="w-3.5 h-3.5" /> Import columns
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmSave}
        onClose={() => setConfirmSave(false)}
        onConfirm={handleSave}
        loading={saving}
        title="Replace import columns?"
        message={`This replaces how ${editing?.code || 'this disco'}’s pending-installation sheets are read, starting with the next import. Records already imported are not changed, and the meter inventory columns are kept as they are.`}
        confirmText="Save columns"
      />
    </div>
  );
};

export default DiscoSettings;
