// src/utils/fetchAllRequests.js
// Every page of GET /external/jed/requests, optionally scoped to one status
// (server-side filter — confirmed: enum exactly INITIATED/PAID/COMPLETED; no
// date or search filter exists, so those still happen client-side in the
// caller). Shared by AdminReports (Avg Transaction, Export CSV, Print to PDF)
// and AdminInstallations (Awaiting / Completed tabs).
import JEDApiService from '../components/services/api';
import { fetchAllPages } from './fetchAllPages';

export function fetchAllRequests(status) {
  return fetchAllPages(
    (params) => JEDApiService.getAllCustomerRequests(params),
    status ? { status } : {}
  );
}

export default fetchAllRequests;
