// src/utils/installationReport.js
// What an installer must provide to report an installation complete
// (POST /installations/{id}/report) — one validator and one payload builder,
// used by ReportInstallationModal and covered by tests.
//
// REQUIRED (business rule, 2026-09-28): meter number, seal number, GPS
// coordinates, installation picture link, DISCO supervisor. Installation date
// and notes stay optional.
//
// The API itself requires only `meterNumber` (every other field is optional in
// the spec), so this form is the ONLY place the other four are enforced today;
// API_GAP_REPORT.md gap AL asks the backend to reject an incomplete report
// too. The report call is a single server transaction (the request becomes
// INSTALLED and the meter USED together), so a rejected or failed submission
// leaves the installation exactly as it was — nothing is half-completed.
import { validateMeterNumber } from './meterNumber';
import { validateSealNumber } from './sealNumber';

export const REPORT_MESSAGES = Object.freeze({
  meterRequired: 'Select or enter the meter you installed.',
  gpsRequired: 'GPS coordinates are required. Tap “Use my location” or enter both values.',
  gpsBoth: 'Enter both latitude and longitude.',
  latitudeRange: 'Latitude must be between -90 and 90.',
  longitudeRange: 'Longitude must be between -180 and 180.',
  gpsZero: 'Those coordinates (0, 0) are not a real location. Capture the site’s GPS again.',
  photoRequired: 'An installation picture is required. Take or choose a photo and wait for it to upload.',
  photoLink: 'The picture link is not valid. Upload the photo again.',
  supervisorRequired: 'DISCO supervisor is required.',
  supervisorShort: 'Enter the DISCO supervisor’s name.',
  dateInvalid: 'Enter a valid date.',
  dateFuture: 'The installation date cannot be in the future.',
});

const MAX_NOTES = 500;
const PLAIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
// A persisted, fetchable link — never a blob:/data: preview.
const HTTP_URL_RE = /^https?:\/\/\S+$/i;

/**
 * @param {object} form - { meterNumber, sealNumber, installationDate, latitude,
 *   longitude, installationPhotoUrl, discoSupervisor, notes }
 * @param {{ usedSealKeys?: Set<string>, pickedFromList?: boolean, today?: string }} [options]
 *   pickedFromList: the meter came from the installer's own assigned meters
 *   (already a valid serial), so only presence is checked.
 * @returns {Record<string, string>} field → message; empty when valid
 */
/** The GPS error for a typed latitude/longitude pair, or null when both are valid. */
export function coordinateError(latitude, longitude) {
  const lat = String(latitude ?? '').trim();
  const lng = String(longitude ?? '').trim();
  if (!lat && !lng) return REPORT_MESSAGES.gpsRequired;
  if (!lat || !lng) return REPORT_MESSAGES.gpsBoth;
  if (!DECIMAL_RE.test(lat) || Math.abs(Number(lat)) > 90) return REPORT_MESSAGES.latitudeRange;
  if (!DECIMAL_RE.test(lng) || Math.abs(Number(lng)) > 180) return REPORT_MESSAGES.longitudeRange;
  if (Number(lat) === 0 && Number(lng) === 0) return REPORT_MESSAGES.gpsZero;
  return null;
}

/**
 * The pair as numbers when it is valid, else null. For attaching a location
 * to an uploaded photo: a half-typed or invalid pair is simply not sent, so
 * it can't make the upload itself fail validation.
 */
export function validCoordinates(latitude, longitude) {
  return coordinateError(latitude, longitude)
    ? null
    : { latitude: Number(String(latitude).trim()), longitude: Number(String(longitude).trim()) };
}

export function validateInstallationReport(form, { usedSealKeys = new Set(), pickedFromList = false, today } = {}) {
  const errors = {};
  const str = (v) => String(v ?? '').trim();

  const meter = str(form.meterNumber);
  if (!meter) errors.meterNumber = REPORT_MESSAGES.meterRequired;
  else if (!pickedFromList) {
    const check = validateMeterNumber(meter);
    if (!check.valid) errors.meterNumber = check.error;
  }

  const seal = validateSealNumber(form.sealNumber, usedSealKeys);
  if (!seal.valid) errors.sealNumber = seal.error;

  const gps = coordinateError(form.latitude, form.longitude);
  if (gps) errors.latitude = gps;

  const photo = str(form.installationPhotoUrl);
  if (!photo) errors.installationPhotoUrl = REPORT_MESSAGES.photoRequired;
  else if (!HTTP_URL_RE.test(photo)) errors.installationPhotoUrl = REPORT_MESSAGES.photoLink;

  const supervisor = str(form.discoSupervisor);
  if (!supervisor) errors.discoSupervisor = REPORT_MESSAGES.supervisorRequired;
  else if (supervisor.length < 2) errors.discoSupervisor = REPORT_MESSAGES.supervisorShort;

  if (form.installationDate) {
    if (!PLAIN_DATE_RE.test(form.installationDate)) errors.installationDate = REPORT_MESSAGES.dateInvalid;
    else if (today && form.installationDate > today) errors.installationDate = REPORT_MESSAGES.dateFuture;
  }

  if (String(form.notes ?? '').length > MAX_NOTES) errors.notes = `Keep notes under ${MAX_NOTES} characters.`;
  return errors;
}

/** The fields in the order they appear on the form — for focusing the first error. */
export const REPORT_FIELD_ORDER = Object.freeze([
  'meterNumber', 'sealNumber', 'installationDate', 'latitude', 'installationPhotoUrl', 'discoSupervisor', 'notes',
]);

/**
 * The exact documented body, from a VALID form. Every required field is sent;
 * installationDate is a plain 'YYYY-MM-DD' and is never put through a Date.
 */
export function buildReportPayload(form) {
  const payload = {
    meterNumber: String(form.meterNumber).trim(),
    sealNumber: String(form.sealNumber).trim(),
    latitude: Number(String(form.latitude).trim()),
    longitude: Number(String(form.longitude).trim()),
    installationPhotoUrl: String(form.installationPhotoUrl).trim(),
    discoSupervisor: String(form.discoSupervisor).trim(),
  };
  if (form.installationDate) payload.installationDate = form.installationDate;
  if (String(form.notes ?? '').trim()) payload.notes = String(form.notes).trim();
  return payload;
}

/**
 * The backend refuses a report whose meter is from another disco's stock
 * (400, METER_WRONG_DISCO, 2026-10-05). Matched on the raw error text, the
 * way isDuplicateSealError is, so the form can put it on the meter field.
 */
export const WRONG_DISCO_METER_MESSAGE =
  "That meter belongs to a different disco's stock than this installation. Choose a meter issued for this job's disco.";
export function isWrongDiscoMeterError(err) {
  return /METER_WRONG_DISCO|different disco'?s stock/i.test(String(err?.message ?? err ?? ''));
}

export { MAX_NOTES };
