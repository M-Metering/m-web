// src/utils/accountBatch.js
// Pasting many account numbers into the Installations page and dispatching
// the ones that can go — the account-number twin of the meter picker's
// "Paste serials".
//
// WHAT IT MATCHES AGAINST. The rows the page already holds for the current
// disco scope (both installation domains, see utils/installationScope.js).
// That page loads its scope once by design, so classifying a paste costs no
// request at all; the backend is still the authority at submit time —
// POST /assignments/installations moves only PENDING and FAILED requests and
// reports every other one in `rejected[]`.
//
// HOW AN ACCOUNT IS CLASSIFIED (first match wins):
//   assignable        an imported job in PENDING or FAILED (getAvailableActions)
//   alreadyAssigned   an imported job already ASSIGNED / IN_PROGRESS
//   cannotAssign      found, but finished or cancelled — or a JED Remita
//                     request, which has no assignment at all (gap #1)
//   notFound          no row in this scope has that exact account number
// Account numbers are compared as exact strings (after the parser's trim):
// "0012345" and "12345" are different accounts.
import { parseIdentifierList } from './identifierList';
import { ROW_SOURCE } from './installationScope';
import { getAvailableActions, installationStatusLabel, isOpenJob } from './installationStatus';

/**
 * @param {string} raw - the pasted text
 * @param {object[]} rows - normalised rows in the current scope
 * @returns {{
 *   accounts: string[], duplicates: string[],
 *   assignable: { account: string, rows: object[] }[],
 *   alreadyAssigned: { account: string, installer: string }[],
 *   cannotAssign: { account: string, reason: string }[],
 *   notFound: string[],
 *   matchedKeys: Set<string>, assignableRows: object[],
 * }}
 */
export function classifyPastedAccounts(raw, rows = []) {
  const { values, duplicates } = parseIdentifierList(raw);
  const byAccount = new Map();
  rows.forEach((row) => {
    const account = String(row?.accountNumber ?? '').trim();
    if (!account) return;
    if (!byAccount.has(account)) byAccount.set(account, []);
    byAccount.get(account).push(row);
  });

  const result = {
    accounts: values,
    duplicates,
    assignable: [],
    alreadyAssigned: [],
    cannotAssign: [],
    notFound: [],
    matchedKeys: new Set(),
    assignableRows: [],
  };

  values.forEach((account) => {
    const matches = byAccount.get(account) || [];
    if (matches.length === 0) {
      result.notFound.push(account);
      return;
    }
    matches.forEach((row) => result.matchedKeys.add(row.key));

    const imported = matches.filter((row) => row.source === ROW_SOURCE.MULTI);
    const ready = imported.filter((row) => getAvailableActions(row.status).assign);
    if (ready.length > 0) {
      result.assignable.push({ account, rows: ready });
      result.assignableRows.push(...ready);
      return;
    }
    const open = imported.find((row) => isOpenJob(row.status));
    if (open) {
      result.alreadyAssigned.push({ account, installer: open.installer || '' });
      return;
    }
    if (imported.length > 0) {
      result.cannotAssign.push({ account, reason: installationStatusLabel(imported[0].status) });
      return;
    }
    result.cannotAssign.push({ account, reason: 'JED Remita request (not assignable)' });
  });

  return result;
}

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * The one-paragraph outcome of a paste-and-assign, in the order an operator
 * reads it: what landed, then each reason something didn't.
 *
 * @param {object} input
 * @param {number} input.assigned - accepted by the API
 * @param {number} [input.rejected] - refused by the API at submit time
 * @param {number} [input.alreadyAssigned] - known before submitting
 * @param {number} [input.cannotAssign]
 * @param {number} [input.notFound]
 * @returns {string}
 */
export function accountBatchMessage({ assigned, rejected = 0, alreadyAssigned = 0, cannotAssign = 0, notFound = 0 }) {
  const parts = [`${plural(assigned, 'installation', 'installations')} assigned successfully.`];
  if (alreadyAssigned > 0) parts.push(`${plural(alreadyAssigned, 'was', 'were')} already assigned.`);
  if (cannotAssign > 0) parts.push(`${plural(cannotAssign, 'account number', 'account numbers')} cannot currently be assigned.`);
  if (notFound > 0) parts.push(`${plural(notFound, 'account number was', 'account numbers were')} not found.`);
  if (rejected > 0) parts.push(`${plural(rejected, 'was', 'were')} refused by the server — see the list below.`);
  return parts.join(' ');
}

/**
 * Merge several POST /assignments/installations responses (one per disco)
 * into the shape BatchResultSummary reads.
 * @param {object[]} results - response bodies
 */
export function mergeAssignmentResults(results = []) {
  return results.reduce((acc, d) => {
    const data = d || {};
    const rejected = Array.isArray(data.rejected) ? data.rejected : [];
    return {
      assignedCount: acc.assignedCount + Number(data.assignedCount ?? data.created ?? 0),
      rejectedCount: acc.rejectedCount + Number(data.rejectedCount ?? data.failed ?? rejected.length),
      rejected: [...acc.rejected, ...rejected],
    };
  }, { assignedCount: 0, rejectedCount: 0, rejected: [] });
}

export default classifyPastedAccounts;
