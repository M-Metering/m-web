// src/components/installations/InstallationsPage.jsx
// The single Installations area for Admin / Super Admin.
//
// WHY THIS EXISTS. Until 2026-09-23 the sidebar carried two top-level items,
// "Installations (JED)" (/installations) and "Installation Requests"
// (/installation-requests), and they genuinely overlapped: the combined
// request list already loads EVERY JED request alongside the imported ones,
// so the JED page's rows were a subset of it, and both carried their own copy
// of the JED "can't be assigned" modal and the same click-through to the
// completion form.
//
// WHY THEY ARE STILL TWO VIEWS, NOT ONE TABLE. The overlap is in the data,
// not in the workflow. They are two different resources with two different
// status enums, two different assignment stories and two different jobs to do
// (see CLAUDE.md, "Two installation domains"):
//
//   All Requests — InstallationRequest (GET /installations) + every
//     JedCustomerRequest, scoped by disco. Planning and dispatch: filter,
//     assign imported jobs to an installer, export the disco response sheet.
//   JED Queue    — JedCustomerRequest only, PAID -> COMPLETED. The daily
//     operational queue: who has paid and is waiting, who is done, open one
//     and complete it.
//
// Merging their rows into one table would have to invent a shared status
// scheme for two enums that don't overlap, which is the one thing the data
// model forbids. So: one navigation item, one route, one page — two views
// that each keep their own real workflow.
//
// The view lives in a `?view=` query parameter rather than a path segment
// because /installations/:accountNumber is an existing, linked-to route; a
// sub-path would collide with it.
import { Suspense, lazy, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardCheck, Clock, Loader2 } from 'lucide-react';
import StatusTabs from '../common/StatusTabs';

// Split per view: opening the JED queue shouldn't download the combined
// request list's code (and its exporter), or the other way round.
const InstallationRequests = lazy(() => import('../admin/InstallationRequests'));
const JedInstallationQueue = lazy(() => import('../admin/AdminInstallations'));

const INSTALLATION_VIEWS = Object.freeze({
  REQUESTS: 'requests',
  JED: 'jed',
});

const TABS = [
  {
    id: INSTALLATION_VIEWS.REQUESTS,
    label: 'All Requests',
    icon: ClipboardCheck,
    description: "Every disco's requests — imported jobs and JED's Remita requests",
  },
  {
    id: INSTALLATION_VIEWS.JED,
    label: 'JED Queue',
    icon: Clock,
    description: 'JED paid requests awaiting installation, and completed installs',
  },
];

const ViewLoader = () => (
  <div className="py-16 flex items-center justify-center" role="status">
    <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
    <span className="sr-only">Loading…</span>
  </div>
);

function InstallationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('view');
  const view = TABS.some((t) => t.id === requested) ? requested : INSTALLATION_VIEWS.REQUESTS;

  // `replace` so switching views doesn't fill the back stack with tab
  // changes — Back still leaves the Installations area, as a user expects.
  const changeView = useCallback((next) => {
    setSearchParams(next === INSTALLATION_VIEWS.REQUESTS ? {} : { view: next }, { replace: true });
  }, [setSearchParams]);

  const active = TABS.find((t) => t.id === view);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Installations</h1>
        <p className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm">{active.description}</p>
      </div>

      <div className="card overflow-hidden">
        <StatusTabs tabs={TABS} activeTab={view} onChange={changeView} />
      </div>

      {/* Each view keeps its own header, filters and actions — this page adds
          the switch, not another layer of chrome around them. */}
      <Suspense fallback={<ViewLoader />}>
        {view === INSTALLATION_VIEWS.JED ? <JedInstallationQueue /> : <InstallationRequests />}
      </Suspense>
    </div>
  );
}

export default InstallationsPage;
