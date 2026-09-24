// src/components/dashboard/InstallerJobSummary.jsx
// Installer Dashboard cards: jobs awaiting installation and completed jobs,
// for the signed-in installer only.
//
// Same source and definitions as the My Jobs page: GET /installations/me/jobs
// (scoped server-side to the caller's JWT — no installer id is sent), every
// page, counted with summarizeInstallerJobs(). Re-fetches on the app-wide
// refresh signal, which My Jobs fires after a start/report/fail action.
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Clock, CheckCircle, ChevronRight } from 'lucide-react';
import jedApi from '../services/api';
import { useDataRefresh } from '../contexts/DataRefreshContext';
import { fetchAllPages } from '../../utils/fetchAllPages';
import { summarizeInstallerJobs } from '../../utils/installerQueue';

function SummaryCard({ title, value, icon: Icon, tone, loading }) {
  const tones = {
    blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    green: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  };
  return (
    <Link
      to="/my-jobs"
      className="card p-4 sm:p-6 flex flex-col transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 dark:hover:shadow-black/30"
    >
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-lg ${tones[tone]}`}>
          <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400" aria-hidden="true" />
      </div>
      <h3 className="text-gray-500 dark:text-gray-400 text-xs sm:text-sm font-medium">{title}</h3>
      <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mt-1" aria-live="polite">
        {loading ? <span className="inline-block h-7 w-10 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" aria-label="Loading" /> : value}
      </p>
    </Link>
  );
}

function InstallerJobSummary() {
  const { refreshSignal } = useDataRefresh();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const jobs = await fetchAllPages((p) => jedApi.getMyJobs(p), {});
        if (!cancelled) setSummary(summarizeInstallerJobs(jobs));
      } catch (err) {
        console.error('[InstallerJobSummary] Failed to load jobs:', err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshSignal]);

  return (
    <section aria-labelledby="my-jobs-summary" className="space-y-2">
      <div>
        <h2 id="my-jobs-summary" className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          My assigned jobs
        </h2>
        {/* Says whose jobs these are, because the JED shared queue below uses
            the same two words for a different list. */}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Dispatched to you by an administrator. Tap a card to open My Jobs.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">Couldn&apos;t load your job summary.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <SummaryCard title="Awaiting installation" value={summary?.awaiting ?? 0} icon={Clock} tone="blue" loading={loading} />
            <SummaryCard title="Completed" value={summary?.completed ?? 0} icon={CheckCircle} tone="green" loading={loading} />
          </div>
          {!loading && summary?.total === 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">No jobs have been assigned to you yet.</p>
          )}
          {!loading && summary?.duplicates > 0 && (
            <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
              {summary.duplicates} repeated record{summary.duplicates === 1 ? '' : 's'} from the server
              {summary.duplicates === 1 ? ' was' : ' were'} counted once.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default InstallerJobSummary;
