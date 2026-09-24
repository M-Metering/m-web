// src/utils/installerQueue.js
// The one definition of what an installer's "Awaiting installation" and
// "Completed" lists contain, and of the identity by which a record is counted
// once. The Installer Dashboard, its summary cards and the My Jobs page all
// read from here, so a job can never be bucketed one way on one screen and
// another way on the next.
//
// TWO QUEUES, DELIBERATELY SEPARATE. An installer sees two things that are not
// the same list (see CLAUDE.md, "Two installation domains"):
//
//   Assigned jobs  — InstallationRequest, GET /installations/me/jobs. Genuinely
//                    dispatched to this installer by an admin.
//                    ASSIGNED / IN_PROGRESS -> awaiting, INSTALLED / EXPORTED -> completed.
//   JED queue      — JedCustomerRequest, GET /external/jed/requests/installer.
//                    A SHARED queue every installer sees; the JED flow has no
//                    per-installer assignment at all (API_GAP_REPORT.md gap A).
//                    PAID -> awaiting, COMPLETED -> completed.
//
// They must never be merged or summed: the same physical customer can exist in
// both (a JED request, and an imported InstallationRequest), and adding the two
// would count that work twice. They are shown as two labelled sections instead.
//
// IDENTITY. Deduplication uses the authoritative key of each resource, never a
// customer name or meter number — two genuinely different jobs can share those.
//   InstallationRequest: integer `id`, disco-scoped.
//   JedCustomerRequest:  `accountNumber` (the resource's key), `id` as fallback.
import { normalizeStatus, isAwaitingInstallationStatus, isCompletedStatus } from './statusBadge';
import { isOpenJob, isInstalledStatus } from './installationStatus';

const str = (value) => (value === null || value === undefined ? '' : String(value).trim());

/**
 * Identity of an assigned job (InstallationRequest). `id` is the resource key;
 * a record without one falls back to disco + account, which is the pair the
 * API itself treats as unique ("Account already exists for this disco").
 */
export function assignedJobKey(job) {
  const id = str(job?.id);
  if (id) return `M-${id}`;
  const account = str(job?.accountNumber);
  return account ? `M-${str(job?.discoCode).toUpperCase()}-${account}` : '';
}

/** Identity of a JED customer request. `accountNumber` is the resource key. */
export function jedRequestKey(request) {
  const account = str(request?.accountNumber);
  if (account) return `J-${account}`;
  const id = str(request?.id);
  return id ? `J-id-${id}` : '';
}

/**
 * Drop repeated records, keeping the first occurrence. Records with no
 * derivable key are kept as-is rather than collapsed together — losing a real
 * record would be worse than showing one the backend sent oddly.
 * @returns {{ items: any[], duplicates: number }}
 */
export function dedupeByKey(records = [], keyFn) {
  const seen = new Set();
  const items = [];
  let duplicates = 0;
  records.forEach((record) => {
    const key = keyFn(record);
    if (!key) { items.push(record); return; }
    if (seen.has(key)) { duplicates += 1; return; }
    seen.add(key);
    items.push(record);
  });
  return { items, duplicates };
}

/**
 * The installer's own dispatched jobs, split into the two queues and counted
 * once each. A job is in exactly one bucket or neither (FAILED / CANCELLED /
 * PENDING are neither) — never both.
 * @returns {{ awaiting: object[], completed: object[], other: object[],
 *   all: object[], duplicates: number }}
 */
export function splitAssignedJobs(jobs = []) {
  const { items, duplicates } = dedupeByKey(jobs, assignedJobKey);
  const awaiting = [];
  const completed = [];
  const other = [];
  items.forEach((job) => {
    if (isOpenJob(job?.status)) awaiting.push(job);
    else if (isInstalledStatus(job?.status)) completed.push(job);
    else other.push(job);
  });
  return { awaiting, completed, other, all: items, duplicates };
}

/**
 * The shared JED queue, split the same way. PAID is the app-wide meaning of
 * "Awaiting Installation" (statusBadge.js); INITIATED is unpaid and belongs to
 * neither queue.
 * @returns {{ awaiting: object[], completed: object[], other: object[],
 *   all: object[], duplicates: number }}
 */
export function splitJedQueue(requests = []) {
  const { items, duplicates } = dedupeByKey(requests, jedRequestKey);
  const awaiting = [];
  const completed = [];
  const other = [];
  items.forEach((request) => {
    const status = normalizeStatus(request?.status);
    // Completed is checked first: a record that somehow carries a completed
    // status must never also be offered as still-to-install.
    if (isCompletedStatus(status)) completed.push(request);
    else if (isAwaitingInstallationStatus(status)) awaiting.push(request);
    else other.push(request);
  });
  return { awaiting, completed, other, all: items, duplicates };
}

/**
 * One search definition for both installer queues, covering the fields each
 * resource actually has (JED: custNames/meterNo/address; imported:
 * customerName/meterNumber/customerAddress, plus the import columns). Fields a
 * given resource doesn't have are simply absent, so the same predicate serves
 * both — an installer types an account or meter number and gets the same
 * behaviour on the Dashboard and on My Jobs.
 */
export function matchesInstallerSearch(record, term) {
  const needle = str(term).toLowerCase();
  if (!needle) return true;
  return [
    record?.accountNumber,
    record?.custNames,
    record?.customerName,
    record?.applicantName,
    record?.meterNo,
    record?.meterNumber,
    record?.customerAddress,
    record?.address,
    record?.feederName,
    record?.transformerName,
    record?.area,
  ].some((value) => str(value).toLowerCase().includes(needle));
}

/**
 * Counts for the Installer Dashboard cards and the My Jobs filters. Derived
 * from splitAssignedJobs — the same function that produces the lists — so a
 * card can never show a number the list underneath it doesn't contain.
 * `duplicates` is how many repeated records the source returned.
 */
export function summarizeInstallerJobs(jobs = []) {
  const { awaiting, completed, all, duplicates } = splitAssignedJobs(jobs);
  return {
    awaiting: awaiting.length,
    completed: completed.length,
    total: all.length,
    duplicates,
  };
}

export default {
  assignedJobKey,
  jedRequestKey,
  dedupeByKey,
  splitAssignedJobs,
  splitJedQueue,
  summarizeInstallerJobs,
  matchesInstallerSearch,
};
