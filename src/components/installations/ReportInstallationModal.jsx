// src/components/installations/ReportInstallationModal.jsx
// Installer reports a completed installation: POST /installations/{id}/report.
//
// Body per the live spec — the API requires only `meterNumber`; the rest are
// optional there but are exactly what the disco's response sheet is built
// from, so the form asks for all of them. `sealNumber` is additionally
// required by this form (business rule, 2026-09-21).
//
// Two rules from the integration guide shape this form:
//  1. The meter picker is populated from GET /installations/me/meters filtered
//     by the job's own meterType. That single call removes the three most
//     common failures (meter not yours / not found / phase mismatch), so free
//     text is a deliberate fallback, not the default.
//  2. `installationDate` is a plain 'YYYY-MM-DD' calendar date. It must never
//     go through toISOString(), which in WAT (+01:00) shifts it a day earlier
//     — hence toDateInputValue/formatPlainDate from utils/date.js.
//
//  3. `installationPhotoUrl` is still a plain URL string on this endpoint —
//     nothing about the report call changed. What changed (2026-09-25) is
//     where that URL comes from: the photo is uploaded to the API's own file
//     store (POST /uploads) and the permanent link it returns is submitted
//     here, instead of the installer hosting the image somewhere themselves
//     and pasting a link. See components/common/PhotoUploadField.jsx.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Loader2, MapPin, AlertCircle, Check } from 'lucide-react';
import jedApi from '../services/api';
import PhotoUploadField from '../common/PhotoUploadField';
import { UPLOAD_ENTITY } from '../../utils/fileUpload';
import { getErrorMessage } from '../../utils/errorMessage';
import { toDateInputValue } from '../../utils/date';
import { fetchAllPages } from '../../utils/fetchAllPages';
import { validateMeterNumber, METER_NUMBER_HINT } from '../../utils/meterNumber';
import { validateSealNumber, isDuplicateSealError, DUPLICATE_SEAL_MESSAGE } from '../../utils/sealNumber';

const MAX_NOTES = 500;

const newForm = () => ({
  meterNumber: '',
  sealNumber: '',
  installationDate: toDateInputValue(),
  latitude: '',
  longitude: '',
  installationPhotoUrl: '',
  discoSupervisor: '',
  notes: '',
});

function Field({ id, label, required, error, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {label}
        {required && <span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{hint}</p>}
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
    </div>
  );
}

/**
 * @param {object} props
 * @param {Set<string>} [props.usedSealKeys] - sealKey()s already recorded on
 *   this installer's own jobs. The only duplicates the client can see; true
 *   uniqueness is the backend's (see utils/sealNumber.js, API_GAP_REPORT.md).
 */
function ReportInstallationModal({ job, isOpen, onClose, onReported, usedSealKeys }) {
  const [form, setForm] = useState(newForm);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const [meters, setMeters] = useState([]);
  const [metersLoading, setMetersLoading] = useState(false);
  const [metersError, setMetersError] = useState(null);
  const [manualEntry, setManualEntry] = useState(false);

  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);

  // Meters in this installer's hands, narrowed to the job's phase type so a
  // mismatch can't be selected in the first place.
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;

    setForm(newForm());
    setErrors({});
    setSubmitError(null);
    setLocationError(null);
    setManualEntry(false);

    (async () => {
      setMetersLoading(true);
      setMetersError(null);
      try {
        const params = job?.meterType ? { phaseType: job.meterType } : {};
        const list = await fetchAllPages((p) => jedApi.getMyMeters(p), params);
        if (!cancelled) setMeters(list);
      } catch (err) {
        console.error('[ReportInstallation] Failed to load my meters:', err);
        if (!cancelled) {
          setMetersError(getErrorMessage(err, 'Unable to load the meters assigned to you.'));
          setManualEntry(true);
        }
      } finally {
        if (!cancelled) setMetersLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, job?.meterType]);

  const availableMeters = useMemo(
    () => meters.filter((m) => String(m.assignmentStatus || '').toUpperCase() !== 'USED'),
    [meters]
  );

  const setField = useCallback((name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
    setSubmitError(null);
  }, []);

  const handleChange = (e) => setField(e.target.name, e.target.value);

  const captureLocation = () => {
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError('This device cannot provide a location. Enter the coordinates manually.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setField('latitude', pos.coords.latitude.toFixed(6));
        setField('longitude', pos.coords.longitude.toFixed(6));
      },
      (err) => {
        setLocating(false);
        const messages = {
          1: 'Location permission was denied. Allow it in your browser, or type the coordinates in.',
          2: 'Your location is unavailable right now. Try again outdoors, or type it in.',
          3: 'Getting your location timed out. Try again, or type it in.',
        };
        setLocationError(messages[err?.code] || 'Could not get your location. Enter it manually.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const validate = () => {
    const found = {};
    if (!form.meterNumber.trim()) {
      found.meterNumber = 'Select or enter the meter you installed.';
    } else if (manualEntry) {
      // Only a hand-typed serial is length-checked. A serial chosen from the
      // picker came from the API and is passed through exactly as given —
      // never padded, trimmed to a length or reformatted.
      const check = validateMeterNumber(form.meterNumber);
      if (!check.valid) found.meterNumber = check.error;
    }

    // Required by the business (the disco's response sheet has an APLE Seal
    // Number column), although the API schema marks it optional. Also checked
    // against the seals already recorded on this installer's own jobs.
    const seal = validateSealNumber(form.sealNumber, usedSealKeys);
    if (!seal.valid) found.sealNumber = seal.error;

    if (form.installationDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.installationDate)) {
        found.installationDate = 'Enter a valid date.';
      } else if (form.installationDate > toDateInputValue()) {
        found.installationDate = 'The installation date cannot be in the future.';
      }
    }

    // Both coordinates or neither — a lone value is meaningless on the sheet.
    const hasLat = form.latitude !== '';
    const hasLng = form.longitude !== '';
    if (hasLat !== hasLng) {
      found.latitude = 'Enter both latitude and longitude, or leave both empty.';
    } else if (hasLat) {
      const lat = Number(form.latitude);
      const lng = Number(form.longitude);
      if (!Number.isFinite(lat) || Math.abs(lat) > 90) found.latitude = 'Latitude must be between -90 and 90.';
      else if (!Number.isFinite(lng) || Math.abs(lng) > 180) found.latitude = 'Longitude must be between -180 and 180.';
    }

    if (form.installationPhotoUrl.trim() && !/^https?:\/\/\S+$/i.test(form.installationPhotoUrl.trim())) {
      found.installationPhotoUrl = 'Enter a full link starting with http:// or https://';
    }

    if (form.notes.length > MAX_NOTES) found.notes = `Keep notes under ${MAX_NOTES} characters.`;

    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting || !validate()) return;

    setSubmitting(true);
    setSubmitError(null);

    // Only send what the installer actually filled in — the API treats every
    // field but meterNumber as optional, and empty strings are not blanks.
    const payload = { meterNumber: form.meterNumber.trim(), sealNumber: form.sealNumber.trim() };
    if (form.installationDate) payload.installationDate = form.installationDate; // plain date, sent as-is
    if (form.latitude !== '' && form.longitude !== '') {
      payload.latitude = Number(form.latitude);
      payload.longitude = Number(form.longitude);
    }
    if (form.installationPhotoUrl.trim()) payload.installationPhotoUrl = form.installationPhotoUrl.trim();
    if (form.discoSupervisor.trim()) payload.discoSupervisor = form.discoSupervisor.trim();
    if (form.notes.trim()) payload.notes = form.notes.trim();

    try {
      await jedApi.reportInstallation(job.id, payload);
      // Reporting moves the meter to USED in the same transaction, so the
      // caller refreshes both the job list and the meter list.
      onReported?.();
    } catch (err) {
      console.error('[ReportInstallation] Report failed:', err);
      // A seal the backend already holds comes back as a duplicate/unique
      // rejection; say so on the field rather than showing the raw database
      // text (which getErrorMessage would drop entirely).
      if (isDuplicateSealError(err)) {
        setErrors((prev) => ({ ...prev, sealNumber: DUPLICATE_SEAL_MESSAGE }));
        setSubmitError(DUPLICATE_SEAL_MESSAGE);
      } else {
        setSubmitError(getErrorMessage(err, 'Could not submit this installation.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !job) return null;

  const inputClass = (name) =>
    `form-input w-full px-3 py-2.5 text-sm ${errors[name] ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : ''}`;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col"
      >
        <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="report-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              Report Installation
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              {job.customerName} &middot; Acct {job.accountNumber}
              {job.meterType ? ` · ${job.meterType}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {submitError && (
            <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-800 dark:text-red-300">{submitError}</p>
            </div>
          )}

          <Field
            id="report-meter"
            label="Meter installed"
            required
            error={errors.meterNumber}
            hint={
              manualEntry
                ? METER_NUMBER_HINT
                : job.meterType
                  ? `Only the ${job.meterType.toLowerCase()} meters assigned to you are listed.`
                  : undefined
            }
          >
            {manualEntry ? (
              <input
                id="report-meter"
                name="meterNumber"
                type="text"
                inputMode="numeric"
                value={form.meterNumber}
                onChange={handleChange}
                disabled={submitting}
                placeholder="Meter serial number"
                aria-required="true"
                aria-invalid={!!errors.meterNumber}
                className={`${inputClass('meterNumber')} font-mono`}
              />
            ) : (
              <select
                id="report-meter"
                name="meterNumber"
                value={form.meterNumber}
                onChange={handleChange}
                disabled={submitting || metersLoading}
                aria-required="true"
                aria-invalid={!!errors.meterNumber}
                className={inputClass('meterNumber')}
              >
                <option value="">
                  {metersLoading ? 'Loading your meters…' : 'Select a meter…'}
                </option>
                {availableMeters.map((m) => (
                  <option key={m.id ?? m.meterNumber} value={m.meterNumber}>
                    {m.meterNumber}
                    {m.phaseType ? ` — ${m.phaseType}` : ''}
                  </option>
                ))}
              </select>
            )}

            <div className="flex items-center justify-between gap-2 mt-1.5">
              <button
                type="button"
                onClick={() => { setManualEntry((v) => !v); setField('meterNumber', ''); }}
                className="text-xs font-medium text-brand-700 dark:text-brand-400 hover:underline"
              >
                {manualEntry ? 'Choose from my meters' : 'Enter a serial manually'}
              </button>
              {!metersLoading && !manualEntry && availableMeters.length === 0 && !metersError && (
                <span className="text-xs text-amber-700 dark:text-amber-400">No matching meters assigned to you</span>
              )}
            </div>

            {metersError && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{metersError}</p>
            )}
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field id="report-seal" label="Seal number" required error={errors.sealNumber}>
              <input
                id="report-seal"
                name="sealNumber"
                type="text"
                value={form.sealNumber}
                onChange={handleChange}
                disabled={submitting}
                aria-required="true"
                aria-invalid={!!errors.sealNumber}
                className={`${inputClass('sealNumber')} font-mono`}
              />
            </Field>

            <Field id="report-date" label="Installation date" error={errors.installationDate}>
              <input
                id="report-date"
                name="installationDate"
                type="date"
                value={form.installationDate}
                max={toDateInputValue()}
                onChange={handleChange}
                disabled={submitting}
                aria-invalid={!!errors.installationDate}
                className={inputClass('installationDate')}
              />
            </Field>
          </div>

          {/* GPS */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">GPS location</span>
              <button
                type="button"
                onClick={captureLocation}
                disabled={submitting || locating}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                {locating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
                {locating ? 'Locating…' : 'Use my location'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                name="latitude"
                type="text"
                inputMode="decimal"
                value={form.latitude}
                onChange={handleChange}
                disabled={submitting}
                placeholder="Latitude"
                aria-label="Latitude"
                aria-invalid={!!errors.latitude}
                className={`${inputClass('latitude')} font-mono`}
              />
              <input
                name="longitude"
                type="text"
                inputMode="decimal"
                value={form.longitude}
                onChange={handleChange}
                disabled={submitting}
                placeholder="Longitude"
                aria-label="Longitude"
                className={`${inputClass('longitude')} font-mono`}
              />
            </div>
            {errors.latitude && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.latitude}</p>}
            {locationError && <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{locationError}</p>}
          </div>

          <Field
            id="report-photo"
            label="Installation photo"
            error={errors.installationPhotoUrl}
          >
            {/* Uploaded straight to the API's file store, which returns the
                permanent link this form submits as installationPhotoUrl. The
                job's id and the captured coordinates go on the file record too,
                so the photo can be found later via
                GET /uploads?entityType=installation&entityId=… */}
            <PhotoUploadField
              id="report-photo"
              value={form.installationPhotoUrl}
              onChange={(url) => {
                setForm((prev) => ({ ...prev, installationPhotoUrl: url }));
                setErrors((prev) => ({ ...prev, installationPhotoUrl: undefined }));
              }}
              disabled={submitting}
              entityType={UPLOAD_ENTITY.INSTALLATION}
              entityId={job.id}
              coordinates={{ latitude: form.latitude, longitude: form.longitude }}
            />
          </Field>

          <Field id="report-supervisor" label="Disco supervisor" error={errors.discoSupervisor}>
            <input
              id="report-supervisor"
              name="discoSupervisor"
              type="text"
              value={form.discoSupervisor}
              onChange={handleChange}
              disabled={submitting}
              placeholder="Name of the supervising disco officer"
              className={inputClass('discoSupervisor')}
            />
          </Field>

          <Field id="report-notes" label="Notes" error={errors.notes}>
            <textarea
              id="report-notes"
              name="notes"
              rows={3}
              maxLength={MAX_NOTES}
              value={form.notes}
              onChange={handleChange}
              disabled={submitting}
              className={inputClass('notes')}
            />
          </Field>
        </form>

        <div className="p-4 sm:px-6 border-t border-gray-200 dark:border-gray-700 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium rounded-lg text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-brand-500 text-gray-900 hover:bg-brand-600 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {submitting ? 'Submitting…' : 'Submit installation'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReportInstallationModal;
