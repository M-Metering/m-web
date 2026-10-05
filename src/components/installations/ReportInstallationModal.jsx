// src/components/installations/ReportInstallationModal.jsx
// Installer reports a completed installation: POST /installations/{id}/report.
//
// Body per the live spec — the API requires only `meterNumber`. The form
// REQUIRES meter number, seal number, GPS coordinates, the installation
// picture link and the DISCO supervisor (business rule, 2026-09-28); the
// rules live in utils/installationReport.js. The API doesn't enforce the last
// four yet (API_GAP_REPORT.md, gap AL). The report is one server transaction,
// so a rejected or failed submission leaves the job exactly as it was.
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
import { normalizePhase } from '../../utils/installationScope';
import { fetchAllPages } from '../../utils/fetchAllPages';
import { METER_NUMBER_HINT } from '../../utils/meterNumber';
import { isDuplicateSealError, DUPLICATE_SEAL_MESSAGE } from '../../utils/sealNumber';
import {
  validateInstallationReport, buildReportPayload, REPORT_FIELD_ORDER, MAX_NOTES,
} from '../../utils/installationReport';

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
  // True while the photo field is processing or uploading. The report must not
  // go out meanwhile: it would carry no picture, or the one being replaced.
  const [photoBusy, setPhotoBusy] = useState(false);

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
        // The phase is matched HERE, on the normalised value, not with the
        // endpoint's `phaseType` filter: that filter is an exact match on the
        // stored value, so a Three Phase meter recorded as "3 Phase" (or a job
        // whose meterType is "Three Phase") would list nothing at all. An
        // installer holds a handful of meters, so reading them all is cheap.
        const list = await fetchAllPages((p) => jedApi.getMyMeters(p), {});
        const jobPhase = normalizePhase(job?.meterType);
        const matching = jobPhase ? list.filter((m) => normalizePhase(m?.phaseType) === jobPhase) : list;
        if (!cancelled) setMeters(matching);
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

  // Where to put the cursor for each field's error.
  const FOCUS_TARGET = {
    meterNumber: '#report-meter', sealNumber: '#report-seal', installationDate: '#report-date',
    latitude: 'input[name="latitude"]', installationPhotoUrl: '#report-photo',
    discoSupervisor: '#report-supervisor', notes: '#report-notes',
  };

  const validate = () => {
    const found = validateInstallationReport(form, {
      usedSealKeys,
      // A serial picked from the installer's own assigned meters came from the
      // API and is passed through exactly as given — only a hand-typed one is
      // format-checked.
      pickedFromList: !manualEntry,
      today: toDateInputValue(),
    });
    setErrors(found);
    const first = REPORT_FIELD_ORDER.find((f) => found[f]);
    if (first) document.querySelector(FOCUS_TARGET[first])?.focus?.();
    return !first;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting || photoBusy || !validate()) return;

    setSubmitting(true);
    setSubmitError(null);

    // Exactly the documented body, every required field included.
    const payload = buildReportPayload(form);

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
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">GPS location<span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span><span className="sr-only"> (required)</span></span>
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
                aria-required="true"
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
                aria-required="true"
                aria-invalid={!!errors.latitude}
                className={`${inputClass('longitude')} font-mono`}
              />
            </div>
            {errors.latitude && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.latitude}</p>}
            {locationError && <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{locationError}</p>}
          </div>

          <Field
            id="report-photo"
            label="Installation photo"
            required
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
              onBusyChange={setPhotoBusy}
              entityType={UPLOAD_ENTITY.INSTALLATION}
              entityId={job.id}
              coordinates={{ latitude: form.latitude, longitude: form.longitude }}
            />
          </Field>

          <Field id="report-supervisor" label="DISCO supervisor" required error={errors.discoSupervisor}>
            <input
              id="report-supervisor"
              name="discoSupervisor"
              type="text"
              value={form.discoSupervisor}
              onChange={handleChange}
              disabled={submitting}
              placeholder="Name of the supervising disco officer"
              aria-required="true"
              aria-invalid={!!errors.discoSupervisor}
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
            disabled={submitting || photoBusy}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-brand-500 text-gray-900 hover:bg-brand-600 disabled:opacity-60"
          >
            {submitting || photoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {submitting ? 'Submitting…' : photoBusy ? 'Waiting for photo…' : 'Submit installation'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReportInstallationModal;
