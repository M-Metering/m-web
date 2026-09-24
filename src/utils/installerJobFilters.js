// src/utils/installerJobFilters.js
// Field filters for the Installer's "My Jobs" screen: Area, Meter Type,
// Feeder and Transformer.
//
// Server-side or client-side? GET /installations/me/jobs documents exactly
// four query parameters — page, limit, status and search. There is no
// area/meterType/feederName/transformerName filter on that endpoint (the
// admin GET /installations doesn't have them either), so these four cannot be
// pushed to the server. That is safe here because the endpoint is already
// scoped to the caller's own jobs by their JWT and MyJobs loads that whole
// list in one go — this filters data the installer already holds, it does not
// pull the database down to filter it.
//
// The values come from the jobs themselves (the fields a disco's import
// sheet supplies: area, meterType, feederName, transformerName/transformerCode
// — see POST /installations), never from a hardcoded list.
//
// Option building, blank handling ("Not recorded") and matching are reused
// from utils/installationScope.js so the Installer's filters behave exactly
// like the Admin's on Installation Requests.
import {
  NOT_RECORDED, buildFilterOptions, applyAttributeFilters, normalizePhase,
} from './installationScope';

export { NOT_RECORDED };

/** The four filters, in the order they are shown. */
export const INSTALLER_JOB_FILTERS = Object.freeze([
  { field: 'area', label: 'Area' },
  { field: 'meterType', label: 'Meter Type' },
  { field: 'feederName', label: 'Feeder' },
  { field: 'transformerName', label: 'Transformer' },
]);

export const EMPTY_JOB_FILTERS = Object.freeze(
  Object.fromEntries(INSTALLER_JOB_FILTERS.map((f) => [f.field, '']))
);

const text = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

/**
 * The filterable view of a job record. The original record is kept on `job`
 * so callers still render and act on the real API object.
 *
 * `area` falls back to `region` only when `area` is blank — both are real
 * import columns, and a job with neither stays "Not recorded" rather than
 * borrowing an unrelated field. `transformerName` falls back to
 * `transformerCode`, matching normalizeMultiRow on the admin screen.
 */
export function toFilterableJob(job) {
  return {
    job,
    area: text(job?.area) || text(job?.region),
    meterType: normalizePhase(job?.meterType),
    feederName: text(job?.feederName),
    transformerName: text(job?.transformerName) || text(job?.transformerCode),
  };
}

export const toFilterableJobs = (jobs = []) => jobs.map(toFilterableJob);

/** Jobs matching every active filter (blank value = filter off). */
export function applyJobFilters(filterable = [], filters = {}) {
  return applyAttributeFilters(filterable, { attributes: filters });
}

/**
 * Faceted dropdown options: each field lists only the values still reachable
 * under the OTHER active filters, so Feeder → Transformer narrows naturally
 * and a combination can never be selected that yields nothing.
 * A value that is currently selected but no longer reachable is kept with a
 * count of 0, so the dropdown never silently loses the active selection.
 */
export function buildJobFilterOptions(filterable = [], filters = {}) {
  const out = {};
  INSTALLER_JOB_FILTERS.forEach(({ field }) => {
    const others = { ...filters, [field]: '' };
    const options = buildFilterOptions(applyJobFilters(filterable, others), field);
    const current = filters[field];
    if (current && !options.some((o) => o.value === current)) {
      options.push({ value: current, label: current === NOT_RECORDED ? 'Not recorded' : current, count: 0 });
    }
    out[field] = options;
  });
  return out;
}

export const countActiveJobFilters = (filters = {}) =>
  INSTALLER_JOB_FILTERS.reduce((n, { field }) => n + (filters[field] ? 1 : 0), 0);

export default {
  INSTALLER_JOB_FILTERS,
  EMPTY_JOB_FILTERS,
  toFilterableJobs,
  applyJobFilters,
  buildJobFilterOptions,
  countActiveJobFilters,
};
