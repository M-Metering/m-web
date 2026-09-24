// src/components/settings/ApiKeySettings.jsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  KeyRound, Plus, Trash2, PowerOff, Power, Check, X,
  AlertCircle, Loader2, Search, Copy, CheckCircle2, BarChart3, ShieldAlert, Star, StarOff, RefreshCw
} from 'lucide-react';
import jedApi from '../services/api';
import ConfirmationModal from '../common/ConfirmationModal';
import { getErrorMessage } from '../../utils/errorMessage';

// Field names on the API key object are unconfirmed against a real
// response sample (no example was provided in the API docs screenshot).
// These helpers check several plausible variants defensively rather than
// assuming one, matching the pattern already used elsewhere in this
// codebase (see MeterTypeSettings' response-shape handling).

/**
 * Coerce any id-like value to a safe, definite string before it's ever
 * used in a React `key`, a template literal, or a URL builder.
 *
 * FIXED: a live crash ("TypeError: Cannot convert object to primitive
 * value") traced to this — the backend's `id`/`_id` field on an API key
 * record is not guaranteed to be a plain string (common culprits: a
 * Mongoose ObjectId instance, or a `{ $oid: "..." }` wrapper). Every place
 * in this file that builds a string from an id (React keys, action-loading
 * state checks like `deactivate-${id}`, and api.js's URL builders) goes
 * through getKeyId(), so fixing coercion here fixes all of them at once.
 */
const toIdString = (id) => {
  if (id === null || id === undefined) return '';
  if (typeof id === 'string' || typeof id === 'number') return String(id);
  if (typeof id === 'object') {
    if (id.$oid) return String(id.$oid);
    if (typeof id.toHexString === 'function') return id.toHexString(); // Mongoose ObjectId
    if (typeof id.toString === 'function' && id.toString !== Object.prototype.toString) {
      try {
        return id.toString();
      } catch {
        // fall through to the warning below
      }
    }
    console.warn('[ApiKeys] Unexpected non-string id value, using JSON fallback:', id);
    return JSON.stringify(id);
  }
  return String(id);
};

const getKeyId = (k) => toIdString(k?.id || k?._id || k?.keyId);
// toIdString() is a general-purpose "make this safe to interpolate"
// coercion, not id-specific despite the name — reused here for the same
// reason it was needed for ids: getKeyPrefix() feeds directly into a
// template literal in maskedDisplay() below with zero coercion, which is
// the confirmed source of the "Cannot convert object to primitive value"
// crash (keyPrefix/prefix/maskedKey came back as a non-primitive value).
const getKeyName = (k) => {
  const raw = k?.name || k?.label;
  return raw ? toIdString(raw) : 'Unnamed key';
};
const getKeyPrefix = (k) => {
  const raw = k?.keyPrefix || k?.prefix || k?.maskedKey || null;
  return raw === null || raw === undefined ? null : toIdString(raw);
};
const getKeyActive = (k) => k?.isActive ?? k?.active ?? (k?.status ? k.status === 'active' : true);
const getKeyCreatedAt = (k) => k?.createdAt || k?.created_at || null;

const maskedDisplay = (k) => {
  const prefix = getKeyPrefix(k);
  return prefix ? `${prefix}${'•'.repeat(8)}` : `${'•'.repeat(12)}`;
};

const ApiKeySettings = () => {
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [actionLoading, setActionLoading] = useState(null);

  // Delete is permanent — confirmed via the shared ConfirmationModal.
  const [itemToDelete, setItemToDelete] = useState(null);
  // Deactivate is reversible in principle (a key can presumably be
  // recreated/reactivated by an admin), so it gets a lighter one-tap
  // confirmation rather than the full destructive-action modal.
  const [itemToDeactivate, setItemToDeactivate] = useState(null);

  // The one and only time the full secret is visible — shown immediately
  // after creation, then never again.
  const [newlyCreatedKey, setNewlyCreatedKey] = useState(null);
  const [copied, setCopied] = useState(false);

  // POST /external/jed/generate-ref and GET /external/jed/status/rrr|order
  // authenticate via ApiKeyAuth (a real X-API-Key), not the logged-in
  // user's JWT. The backend only ever returns a key's plaintext once, at
  // creation, so "the active app key" is captured then (see
  // handleUseAsActiveKey below) and stored client-side for reuse — this
  // just tracks its (non-secret) display name for the status indicator.
  const [activeKeyName, setActiveKeyNameState] = useState(() => jedApi.getActiveApiKeyName());

  // Lightweight usage modal (not a confirm/cancel flow, so it doesn't use
  // ConfirmationModal — a self-contained display modal instead).
  const [usageModal, setUsageModal] = useState({
    open: false, key: null, data: null, loading: false, error: null, days: 30
  });

  const fetchApiKeys = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await jedApi.getApiKeys();

      let data = [];
      if (response?.success && Array.isArray(response?.data)) {
        data = response.data;
      } else if (Array.isArray(response?.data)) {
        data = response.data;
      } else if (Array.isArray(response)) {
        data = response;
      } else if (Array.isArray(response?.apiKeys)) {
        data = response.apiKeys;
      }

      setApiKeys(data);
    } catch (err) {
      console.error('[ApiKeys] Failed to fetch:', err);
      setError(getErrorMessage(err, 'Failed to load API keys'));
      setApiKeys([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApiKeys();
  }, [fetchApiKeys]);

  const validateForm = () => {
    if (!formData.name.trim()) {
      setError('API key name is required');
      return false;
    }
    return true;
  };

  const handleCreate = async () => {
    if (!validateForm()) return;

    try {
      setActionLoading('create');
      setError(null);

      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined
      };

      const response = await jedApi.createApiKey(payload);

      const created = response?.data || response;
      // Surface the full secret now — this is the only chance to see it.
      // (Deliberately never logged to console — same reasoning as the
      // password-logging fix in api.js: this is a real, one-time-reveal
      // secret, not diagnostic-safe data.)
      setNewlyCreatedKey(created);
      setCopied(false);

      await fetchApiKeys();
      setFormData({ name: '', description: '' });
      setIsCreating(false);
    } catch (err) {
      console.error('[ApiKeys] Failed to create:', err);
      setError(getErrorMessage(err, 'Failed to create API key'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeactivate = useCallback(async () => {
    if (!itemToDeactivate) return;
    const id = getKeyId(itemToDeactivate);

    try {
      setActionLoading(`deactivate-${id}`);
      setError(null);
      await jedApi.deactivateApiKey(id);
      await fetchApiKeys();
      setItemToDeactivate(null);
    } catch (err) {
      console.error('[ApiKeys] Failed to deactivate:', err);
      setError(getErrorMessage(err, 'Failed to deactivate API key'));
    } finally {
      setActionLoading(null);
    }
  }, [itemToDeactivate, fetchApiKeys]);

  const handleDelete = useCallback(async () => {
    if (!itemToDelete) return;
    const id = getKeyId(itemToDelete);

    try {
      setActionLoading(`delete-${id}`);
      setError(null);
      await jedApi.deleteApiKey(id);
      await fetchApiKeys();
      setItemToDelete(null);
    } catch (err) {
      console.error('[ApiKeys] Failed to delete:', err);
      setError(getErrorMessage(err, 'Failed to delete API key'));
    } finally {
      setActionLoading(null);
    }
  }, [itemToDelete, fetchApiKeys]);

  const handleCopy = useCallback(async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[ApiKeys] Clipboard copy failed:', err);
    }
  }, []);

  const handleUseAsActiveKey = useCallback((key, value) => {
    if (!value) return;
    jedApi.setActiveApiKey(value, getKeyName(key));
    setActiveKeyNameState(jedApi.getActiveApiKeyName());
  }, []);

  const handleClearActiveKey = useCallback(() => {
    jedApi.clearActiveApiKey();
    setActiveKeyNameState(null);
  }, []);

  const openUsageModal = useCallback(async (key, days = 30) => {
    setUsageModal({ open: true, key, data: null, loading: true, error: null, days });
    try {
      const id = getKeyId(key);
      const response = await jedApi.getApiKeyUsage(id, { days });
      const data = response?.data || response;
      setUsageModal((prev) => ({ ...prev, data, loading: false }));
    } catch (err) {
      console.error('[ApiKeys] Failed to load usage:', err);
      setUsageModal((prev) => ({ ...prev, loading: false, error: getErrorMessage(err, 'Failed to load usage stats') }));
    }
  }, []);

  const changeUsageDays = useCallback((days) => {
    if (usageModal.key) openUsageModal(usageModal.key, days);
  }, [usageModal.key, openUsageModal]);

  const filteredKeys = useMemo(() => {
    if (!searchTerm.trim()) return apiKeys;
    const search = searchTerm.toLowerCase();
    return apiKeys.filter((k) => getKeyName(k).toLowerCase().includes(search));
  }, [apiKeys, searchTerm]);

  if (loading && apiKeys.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600 dark:text-brand-400 mx-auto mb-2" />
          <p className="text-gray-600 dark:text-gray-400">Loading API keys...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">API Keys</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">Manage credentials for programmatic access</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchApiKeys()}
            disabled={loading}
            aria-label="Refresh"
            className="p-2.5 sm:px-4 sm:py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline text-sm font-medium">Refresh</span>
          </button>
          <button
            onClick={() => {
              setIsCreating(true);
              setFormData({ name: '', description: '' });
              setNewlyCreatedKey(null);
              setError(null);
            }}
            disabled={!!actionLoading}
            className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Create API Key
          </button>
        </div>
      </div>

      {/* Active app key indicator — never shows the secret, only which key
          (by name) is currently used for Generate RRR / Remita status
          lookups. */}
      <div className={`rounded-lg p-4 border flex items-start gap-3 ${
        activeKeyName
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
          : 'bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-700'
      }`}>
        {activeKeyName ? (
          <Star className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
        ) : (
          <StarOff className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          {activeKeyName ? (
            <>
              <p className="text-sm font-medium text-green-900 dark:text-green-200">
                Active app key: {activeKeyName}
              </p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                Used for Generate RRR and Remita status lookups.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                No active app key configured
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Generate RRR and Remita status lookups in the Payments page will fail until one is set — create a key above and choose "Use as active app key".
              </p>
            </>
          )}
        </div>
        {activeKeyName && (
          <button
            onClick={handleClearActiveKey}
            className="text-xs font-medium text-green-700 dark:text-green-400 hover:text-green-900 dark:hover:text-green-200 flex-shrink-0"
          >
            Clear
          </button>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error</h3>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Newly created key — shown once, never again */}
      {newlyCreatedKey && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg p-4 sm:p-5">
          <div className="flex gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Copy this key now — it won't be shown again
              </h3>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 mb-3">
                For security, the full key value is only ever displayed once, immediately after creation.
              </p>
              <div className="flex items-center gap-2 bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-700 rounded-lg p-3">
                <code className="flex-1 min-w-0 text-xs sm:text-sm font-mono text-gray-900 dark:text-gray-100 break-all">
                  {newlyCreatedKey.key || newlyCreatedKey.apiKey || newlyCreatedKey.secret || '(key value not present in response)'}
                </code>
                <button
                  onClick={() => handleCopy(newlyCreatedKey.key || newlyCreatedKey.apiKey || newlyCreatedKey.secret || '')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 transition-colors flex-shrink-0"
                >
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              {/* Generate RRR and Remita status-lookup calls authenticate
                  via a real API key (X-API-Key), not the JWT — this is the
                  only moment the plaintext is available to set that up. */}
              <button
                onClick={() => handleUseAsActiveKey(newlyCreatedKey, newlyCreatedKey.key || newlyCreatedKey.apiKey || newlyCreatedKey.secret || '')}
                disabled={!(newlyCreatedKey.key || newlyCreatedKey.apiKey || newlyCreatedKey.secret)}
                className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-900 border border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-300 text-xs font-medium rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Star className="w-3.5 h-3.5" />
                Use as active app key
              </button>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1.5">
                Needed for Generate RRR and Remita status lookups in the Payments page — those actions require a real API key, not your login session.
              </p>

              <button
                onClick={() => setNewlyCreatedKey(null)}
                className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200"
              >
                I've saved this key, dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search API keys..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="form-input w-full pl-10 pr-4 py-2"
        />
      </div>

      {/* Deactivate confirmation (lighter than delete) */}
      <ConfirmationModal
        isOpen={!!itemToDeactivate}
        onClose={() => setItemToDeactivate(null)}
        onConfirm={handleDeactivate}
        loading={actionLoading === `deactivate-${getKeyId(itemToDeactivate)}`}
        title="Deactivate API Key"
        message={`Deactivate "${getKeyName(itemToDeactivate || {})}"? Requests using this key will stop working until it's reactivated.`}
      />

      {/* Delete confirmation (permanent) */}
      <ConfirmationModal
        isOpen={!!itemToDelete}
        onClose={() => setItemToDelete(null)}
        onConfirm={handleDelete}
        loading={actionLoading === `delete-${getKeyId(itemToDelete)}`}
        title="Delete API Key"
        message={`Permanently delete "${getKeyName(itemToDelete || {})}"? This cannot be undone and any integration using it will break immediately.`}
      />

      {/* Usage modal */}
      {usageModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-auto">
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-brand-600 dark:text-brand-400" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Usage — {getKeyName(usageModal.key || {})}
                </h3>
              </div>
              <button
                onClick={() => setUsageModal({ open: false, key: null, data: null, loading: false, error: null, days: 30 })}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4">
              <div className="flex gap-2">
                {[7, 30, 90].map((d) => (
                  <button
                    key={d}
                    onClick={() => changeUsageDays(d)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      usageModal.days === d
                        ? 'bg-brand-500 text-gray-900'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    Last {d} days
                  </button>
                ))}
              </div>

              {usageModal.loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
                </div>
              ) : usageModal.error ? (
                <div className="text-sm text-red-600 dark:text-red-400">{usageModal.error}</div>
              ) : usageModal.data ? (
                <div className="space-y-3">
                  {/* Best-effort display of common field names — response
                      shape is unconfirmed, so this falls back to a raw
                      view rather than showing nothing. */}
                  {(usageModal.data.totalRequests !== undefined || usageModal.data.total !== undefined) && (
                    <div className="bg-brand-50 dark:bg-brand-900/20 rounded-lg p-4 text-center">
                      <p className="text-2xl font-bold text-brand-900 dark:text-brand-200">
                        {usageModal.data.totalRequests ?? usageModal.data.total}
                      </p>
                      <p className="text-xs text-brand-700 dark:text-brand-400 mt-1">
                        Total requests (last {usageModal.days} days)
                      </p>
                    </div>
                  )}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700">
                      Raw response
                    </summary>
                    <pre className="mt-2 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg overflow-auto text-gray-700 dark:text-gray-300">
                      {JSON.stringify(usageModal.data, null, 2)}
                    </pre>
                  </details>
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">No usage data available</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Form */}
      {isCreating && (
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Create New API Key</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Mobile App Integration"
                className="form-input w-full px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description of what this key is used for"
                rows={3}
                className="form-input w-full px-3 py-2"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setIsCreating(false); setFormData({ name: '', description: '' }); setError(null); }}
                disabled={actionLoading === 'create'}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={actionLoading === 'create'}
                className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 transition-colors disabled:opacity-50"
              >
                {actionLoading === 'create' ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Creating...</>
                ) : (
                  <><Check className="w-4 h-4" />Create</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keys List — mobile card / desktop table, matching the app's
          established mobile-first pattern */}
      <div className="card overflow-hidden">
        {/* Mobile cards */}
        <div className="sm:hidden divide-y divide-gray-200 dark:divide-gray-700">
          {filteredKeys.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">
              {searchTerm ? 'No API keys found matching your search' : 'No API keys created yet'}
            </div>
          ) : (
            filteredKeys.map((key) => {
              const id = getKeyId(key);
              const active = getKeyActive(key);
              return (
                <div key={id} className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 dark:text-white text-sm truncate">{getKeyName(key)}</p>
                      <p className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-0.5">{maskedDisplay(key)}</p>
                    </div>
                    <span className={`shrink-0 inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      active ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
                    }`}>
                      {active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-3">
                    <button onClick={() => openUsageModal(key)} className="p-2 text-brand-600 hover:text-brand-800 dark:text-brand-400" title="View Usage">
                      <BarChart3 className="w-4 h-4" />
                    </button>
                    {active && (
                      <button onClick={() => setItemToDeactivate(key)} className="p-2 text-amber-600 hover:text-amber-800 dark:text-amber-400" title="Deactivate">
                        <PowerOff className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => setItemToDelete(key)} className="p-2 text-red-600 hover:text-red-800 dark:text-red-400" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Key</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Created</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredKeys.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                    {searchTerm ? 'No API keys found matching your search' : 'No API keys created yet'}
                  </td>
                </tr>
              ) : (
                filteredKeys.map((key) => {
                  const id = getKeyId(key);
                  const active = getKeyActive(key);
                  const createdAt = getKeyCreatedAt(key);
                  return (
                    <tr key={id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">{getKeyName(key)}</div>
                        {key.description && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{key.description}</div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <code className="text-xs font-mono text-gray-600 dark:text-gray-400">{maskedDisplay(key)}</code>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          active ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
                        }`}>
                          {active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        {createdAt ? new Date(createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => openUsageModal(key)}
                            className="p-1 text-brand-600 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300"
                            title="View Usage"
                          >
                            <BarChart3 className="w-4 h-4" />
                          </button>
                          {active ? (
                            <button
                              onClick={() => setItemToDeactivate(key)}
                              disabled={actionLoading === `deactivate-${id}`}
                              className="p-1 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 disabled:opacity-50"
                              title="Deactivate"
                            >
                              {actionLoading === `deactivate-${id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <PowerOff className="w-4 h-4" />}
                            </button>
                          ) : (
                            <span className="p-1 text-gray-300 dark:text-gray-600" title="Already inactive">
                              <Power className="w-4 h-4" />
                            </span>
                          )}
                          <button
                            onClick={() => setItemToDelete(key)}
                            disabled={actionLoading === `delete-${id}`}
                            className="p-1 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50"
                            title="Delete"
                          >
                            {actionLoading === `delete-${id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stats Footer */}
      <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-brand-700 dark:text-brand-300">Total Keys:</span>
            <span className="ml-2 font-bold text-brand-900 dark:text-brand-100">{apiKeys.length}</span>
          </div>
          <div>
            <span className="text-brand-700 dark:text-brand-300">Active:</span>
            <span className="ml-2 font-bold text-green-600 dark:text-green-400">
              {apiKeys.filter((k) => getKeyActive(k)).length}
            </span>
          </div>
          <div>
            <span className="text-brand-700 dark:text-brand-300">Inactive:</span>
            <span className="ml-2 font-bold text-gray-600 dark:text-gray-400">
              {apiKeys.filter((k) => !getKeyActive(k)).length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiKeySettings;