// src/components/settings/MeterTypeSettings.jsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Edit2, Trash2, Check, X,
  AlertCircle, Loader2, Search, RefreshCw
} from 'lucide-react';
import jedApi from '../services/api';
import ConfirmationModal from '../common/ConfirmationModal';
import { getErrorMessage } from '../../utils/errorMessage';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import { useDiscoOptions } from '../../hooks/useDiscoOptions';
import { fetchAllPages } from '../../utils/fetchAllPages';

// PRICES ARE PER DISCO (API, 2026-10-04). Every meter-type price belongs to
// exactly one disco; each disco has its own list, and changing one never
// affects another. So:
//   - the list can be narrowed to one disco (GET /settings/meter-type?discoCode=)
//     and always shows which disco each price belongs to — without that, two
//     identical-looking "Single Phase" rows appear;
//   - creating a price REQUIRES discoCode (400 without it). One active price per
//     meter type per disco: a duplicate is a 409 whose message says so, shown
//     as is. To change a price, edit the existing row;
//   - editing sends only { name, amount } (a price's disco can't be changed).
// Bodies are exactly the documented ones: `description` is in neither, and
// the API rejects unknown keys, so the form no longer has that field.
const ALL_DISCOS = '';
const emptyForm = (discoCode = '') => ({ discoCode, name: '', amount: '' });

const MeterTypeSettings = () => {
  // A price change re-values every pending installation (utils/meterPricing.js),
  // so after each save the app-wide refresh fires and any open Dashboard,
  // Reports or Installer Job Status re-reads at the new price.
  const { notifyDataChanged } = useDataRefresh();
  const [meterTypes, setMeterTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [discoFilter, setDiscoFilter] = useState(ALL_DISCOS);
  const { discos, loading: discosLoading, error: discosError } = useDiscoOptions();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(emptyForm());
  const [actionLoading, setActionLoading] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  // Every page, filtered server-side by disco when one is chosen. This screen
  // used to read only page 1 (10 rows) and had no pager, so per-disco prices —
  // which multiply the rows — could silently fall off the end.
  // Search is applied client-side by `filteredMeterTypes` below.
  const fetchMeterTypes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAllPages(
        (params) => jedApi.getMeterTypes(params),
        discoFilter ? { discoCode: discoFilter } : {}
      );
      setMeterTypes(data);
    } catch (err) {
      console.error('[Settings] Failed to fetch meter types:', err);
      setError(getErrorMessage(err, 'Failed to load meter types'));
      setMeterTypes([]);
    } finally {
      setLoading(false);
    }
  }, [discoFilter]);

  useEffect(() => {
    fetchMeterTypes();
  }, [fetchMeterTypes]);

  // Validate form data. `requireDisco` only on create: an edit can't change it.
  const validateForm = ({ requireDisco = false } = {}) => {
    if (requireDisco && !formData.discoCode) {
      setError('Choose the disco this price is for.');
      return false;
    }
    if (!formData.name.trim()) {
      setError('Meter type name is required');
      return false;
    }

    const amount = parseFloat(formData.amount);
    if (!formData.amount || isNaN(amount) || amount <= 0) {
      setError('Amount must be a positive number greater than zero');
      return false;
    }

    return true;
  };

  // Create meter type - POST /settings/meter-type
  const handleCreate = async () => {
    if (!validateForm({ requireDisco: true })) return;

    try {
      setActionLoading('create');
      setError(null);

      // Exactly the documented body: discoCode, name, amount.
      const payload = {
        discoCode: formData.discoCode,
        name: formData.name.trim(),
        amount: parseFloat(formData.amount),
      };

      await jedApi.createMeterType(payload);

      await fetchMeterTypes();
      notifyDataChanged();
      setFormData(emptyForm());
      setIsCreating(false);
    } catch (err) {
      console.error('[Settings] Failed to create meter type:', err);

      // Parse backend validation errors
      setError(getErrorMessage(err, 'Failed to create meter type'));
    } finally {
      setActionLoading(null);
    }
  };

  // Update meter type - PATCH /settings/meter-type/{id}
  const handleUpdate = async (id) => {
    if (!validateForm()) return;

    try {
      setActionLoading(`update-${id}`);
      setError(null);

      // Exactly the documented body: name, amount. The disco can't change.
      const payload = {
        name: formData.name.trim(),
        amount: parseFloat(formData.amount),
      };

      await jedApi.updateMeterType(id, payload);

      await fetchMeterTypes();
      notifyDataChanged();
      setEditingId(null);
      setFormData(emptyForm());
    } catch (err) {
      console.error('[Settings] Failed to update meter type:', err);

      setError(getErrorMessage(err, 'Failed to update meter type'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = useCallback(async () => {
    if (!itemToDelete) return;

    try {
      setActionLoading(`delete-${itemToDelete.id}`);
      setError(null);

      await jedApi.deleteMeterType(itemToDelete.id);

      await fetchMeterTypes();
      notifyDataChanged();
      setItemToDelete(null); // Close modal on success
    } catch (err) {
      console.error('[Settings] Failed to delete meter type:', err);
      setError(getErrorMessage(err, 'Failed to deactivate meter type'));
      // Keep modal open on error
    } finally {
      setActionLoading(null);
    }
  }, [itemToDelete, fetchMeterTypes, notifyDataChanged]);

  // Start editing
  const startEdit = (meterType) => {
    setEditingId(meterType.id);
    setFormData({
      discoCode: meterType.discoCode || '',
      name: meterType.name,
      amount: meterType.amount?.toString() || ''
    });
    setIsCreating(false);
    setError(null);
  };

  // Cancel editing
  const cancelEdit = () => {
    setEditingId(null);
    setIsCreating(false);
    setFormData(emptyForm());
    setError(null);
  };

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  // Filter meter types based on search
  const filteredMeterTypes = useMemo(() => {
    if (!searchTerm.trim()) { return meterTypes; }

    const search = searchTerm.toLowerCase();
    return meterTypes.filter(type =>
      type.name?.toLowerCase().includes(search) ||
      type.discoCode?.toLowerCase().includes(search)
    );
  }, [meterTypes, searchTerm]);

  // Grouped by disco, then name, so each disco's list reads as one block.
  const sortedMeterTypes = useMemo(() => [...filteredMeterTypes].sort((a, b) =>
    String(a.discoCode || '').localeCompare(String(b.discoCode || '')) || String(a.name || '').localeCompare(String(b.name || ''))
  ), [filteredMeterTypes]);

  if (loading && meterTypes.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600 dark:text-brand-400 mx-auto mb-2" />
          <p className="text-gray-600 dark:text-gray-400">Loading meter types...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section header — page-level "Settings" title is now owned by
          SettingsPage.jsx, which mounts this component under the
          "Meter Types" tab. This keeps just a section sub-heading so
          there's no duplicate title stacked above it. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Meter Types</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">Installation prices by meter type. Each disco has its own price list.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchMeterTypes()}
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
              setEditingId(null);
              // Pre-fill the disco the list is narrowed to, if any.
              setFormData(emptyForm(discoFilter));
              setError(null);
            }}
            disabled={!!actionLoading}
            className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-gray-900 rounded-lg hover:bg-brand-600 transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Add Price
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                Error
              </h3>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                {error}
              </p>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Disco + search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="sm:w-56">
          <label htmlFor="meter-price-disco" className="sr-only">Disco</label>
          <select
            id="meter-price-disco"
            value={discoFilter}
            onChange={(e) => setDiscoFilter(e.target.value)}
            disabled={discosLoading}
            className="form-input w-full px-3 py-2"
          >
            <option value={ALL_DISCOS}>All discos</option>
            {discos.map((d) => (
              <option key={d.code} value={d.code}>{d.name ? `${d.name} (${d.code})` : d.code}</option>
            ))}
          </select>
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search meter types..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-input w-full pl-10 pr-4 py-2"
          />
        </div>
      </div>
      {discosError && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{discosError} The disco filter is unavailable; every price is still listed.</p>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={!!itemToDelete}
        onClose={() => setItemToDelete(null)}
        onConfirm={handleDelete}
        loading={actionLoading === `delete-${itemToDelete?.id}`}
        title="Deactivate Price"
        message={`Are you sure you want to deactivate the "${itemToDelete?.name}" price for ${itemToDelete?.discoCode || 'this disco'}? This action cannot be undone.`}
      />

      {/* Create Form */}
      {isCreating && (
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Add a Price
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="meter-price-new-disco" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Disco *
                </label>
                <select
                  id="meter-price-new-disco"
                  value={formData.discoCode}
                  onChange={(e) => setFormData({ ...formData, discoCode: e.target.value })}
                  disabled={discosLoading}
                  className="form-input w-full px-3 py-2"
                >
                  <option value="">Choose a disco…</option>
                  {discos.map((d) => (
                    <option key={d.code} value={d.code}>{d.name ? `${d.name} (${d.code})` : d.code}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Single Phase, Three Phase"
                  className="form-input w-full px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Amount (₦) *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-base font-semibold">
                    ₦
                  </span>
                  <input
                    type="number"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    placeholder="50000"
                    min="1"
                    step="1"
                    className="form-input w-full pl-10 pr-3 py-2"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={cancelEdit}
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
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Create
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Meter Types List */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Disco
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Meter Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {sortedMeterTypes.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                    {searchTerm ? 'No meter types found matching your search' : 'No meter types configured yet'}
                  </td>
                </tr>
              ) : (
                sortedMeterTypes.map((type) => (
                  <tr key={type.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    {editingId === type.id ? (
                      <>
                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300" title="A price's disco can't be changed">
                          {type.discoCode || '—'}
                        </td>
                        <td className="px-6 py-4">
                          <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="form-input w-full px-3 py-1 text-sm"
                          />
                        </td>
                        <td className="px-6 py-4">
                          <input
                            type="number"
                            value={formData.amount}
                            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                            min="1"
                            step="1"
                            className="form-input w-full px-3 py-1 text-sm"
                          />
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            type.isActive 
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
                          }`}>
                            {type.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => handleUpdate(type.id)}
                              disabled={actionLoading === `update-${type.id}`}
                              className="p-1 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300 disabled:opacity-50"
                              title="Save"
                            >
                              {actionLoading === `update-${type.id}` ? (
                                <Loader2 className="w-4 h-4 animate-spin" /> 
                              ) : (
                                <Check className="w-4 h-4" />
                              )}
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={actionLoading === `update-${type.id}`}
                              className="p-1 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300 disabled:opacity-50"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {type.discoCode || '—'}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {type.name}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm font-semibold text-brand-600 dark:text-brand-400">
                            {formatCurrency(type.amount)}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            type.isActive 
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
                          }`}>
                            {type.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => startEdit(type)}
                              disabled={!!actionLoading}
                              className="p-1 text-brand-600 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300 disabled:opacity-50"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setItemToDelete(type)}
                              disabled={actionLoading === `delete-${type.id}`}
                              className="p-1 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50"
                              title="Deactivate"
                            >
                              {actionLoading === `delete-${type.id}` ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stats Footer */}
      <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-brand-700 dark:text-brand-300">Prices:</span>
            <span className="ml-2 font-bold text-brand-900 dark:text-brand-100">{meterTypes.length}</span>
          </div>
          <div>
            <span className="text-brand-700 dark:text-brand-300">Active:</span>
            <span className="ml-2 font-bold text-green-600 dark:text-green-400">
              {meterTypes.filter(t => t.isActive).length}
            </span>
          </div>
          <div>
            <span className="text-brand-700 dark:text-brand-300">Inactive:</span>
            <span className="ml-2 font-bold text-gray-600 dark:text-gray-400">
              {meterTypes.filter(t => !t.isActive).length}
            </span>
          </div>
          <div>
            <span className="text-brand-700 dark:text-brand-300">Showing:</span>
            <span className="ml-2 font-bold text-brand-900 dark:text-brand-100">
              {filteredMeterTypes.length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MeterTypeSettings;