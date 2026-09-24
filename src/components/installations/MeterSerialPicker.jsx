// src/components/installations/MeterSerialPicker.jsx
// Searchable multi-select of dispatchable meter serials (Assignments page).
// Options come from toMeterOptions() — only eligible meters are listed, so an
// unavailable meter can't be picked. Serials are shown in full, as strings
// (leading zeros intact). Large inventories are searched rather than scrolled:
// at most MAX_SHOWN matches render at once.
import { useMemo, useState, useEffect } from 'react';
import { Search, X, Loader2, RefreshCw, ClipboardPaste } from 'lucide-react';
import jedApi from '../services/api';
import { matchPastedSerials, meterDeletionBlockReason } from '../../utils/meterInventory';
import { meterMakeModel } from '../../utils/meterDisplay';
import { normalizeStatus } from '../../utils/statusBadge';

const MAX_SHOWN = 200;
const COMPLETE_METER_NUMBER_RE = /^\d{10,13}$/;

/**
 * Why a real meter isn't offered for dispatch. Mirrors isAssignableMeter's
 * rule (status AVAILABLE, assignmentStatus not ASSIGNED/USED/LOST) but phrased
 * for the admin looking at an empty search box.
 */
function undispatchableReason(meter) {
  const status = normalizeStatus(meter?.status);
  const assignment = normalizeStatus(meter?.assignmentStatus);
  if (assignment === 'ASSIGNED') return 'it is already dispatched to an installer';
  if (assignment === 'USED') return 'it has already been installed';
  if (assignment === 'LOST') return 'it is recorded as lost';
  if (status && status !== 'AVAILABLE') return `its status is ${status.toLowerCase()}`;
  // Exists, looks dispatchable, but isn't in this list — e.g. dispatched
  // earlier in this same session, or beyond the loaded page cap.
  return meterDeletionBlockReason(meter) ? 'it is in use' : 'it is not in the available list';
}

function MeterSerialPicker({ id, options, loading, error, onRetry, value, onChange, disabled, invalid }) {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState(null);
  // What the API says about a complete meter number that isn't in this list.
  const [lookup, setLookup] = useState(null);

  const selected = useMemo(() => new Set(value), [value]);
  const phases = useMemo(
    () => Array.from(new Set(options.map((o) => o.phaseType).filter(Boolean))).sort(),
    [options]
  );

  const matches = useMemo(() => {
    const term = query.trim();
    return options.filter((o) => (!phase || o.phaseType === phase) && (!term || o.serial.includes(term)));
  }, [options, query, phase]);
  const shown = matches.slice(0, MAX_SHOWN);

  // This list deliberately contains only DISPATCHABLE meters, so a meter that
  // exists but is installed, already out with an installer, or retired simply
  // isn't here — which looks identical to "the search is broken". When a
  // complete meter number finds nothing, ask the API what that meter actually
  // is (GET /meters/meter-number/{n}) and say so. Nothing is invented: if the
  // API doesn't have it either, that is what gets reported.
  useEffect(() => {
    const serial = query.trim();
    if (matches.length > 0 || !COMPLETE_METER_NUMBER_RE.test(serial)) {
      setLookup(null);
      return undefined;
    }
    let cancelled = false;
    setLookup({ state: 'loading', serial });
    (async () => {
      try {
        const response = await jedApi.getMeterByNumber(serial);
        const payload = response?.data ?? response;
        const meter = Array.isArray(payload) ? payload[0] : payload;
        if (cancelled) return;
        setLookup(meter?.meterNumber
          ? { state: 'found', serial, reason: undispatchableReason(meter) }
          : { state: 'missing', serial });
      } catch (err) {
        if (cancelled) return;
        setLookup(String(err?.message || '').startsWith('NOT_FOUND:')
          ? { state: 'missing', serial }
          : { state: 'error', serial });
      }
    })();
    return () => { cancelled = true; };
  }, [query, matches.length]);

  const toggle = (serial) => {
    onChange(selected.has(serial) ? value.filter((s) => s !== serial) : [...value, serial]);
  };

  const applyPaste = () => {
    const { accepted, rejected } = matchPastedSerials(options, pasteText);
    const added = accepted.filter((s) => !selected.has(s));
    if (added.length) onChange([...value, ...added]);
    setPasteResult({ added: added.length, rejected });
    if (rejected.length === 0) { setPasteText(''); setPasteOpen(false); }
  };

  if (loading) {
    return (
      <div className="form-input w-full px-3 py-2.5 text-sm flex items-center gap-2 text-gray-500 dark:text-gray-400" role="status">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading available meters…
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
        <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        <button type="button" onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-300 hover:underline">
          <RefreshCw className="w-3 h-3" /> Try again
        </button>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border ${invalid ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'}`}>
      {/* Selected */}
      <div className="p-2 flex flex-wrap gap-1.5 min-h-[2.75rem] items-center border-b border-gray-200 dark:border-gray-700">
        {value.length === 0 ? (
          <span className="text-sm text-gray-400 dark:text-gray-500 px-1">Select meter serial number</span>
        ) : value.map((serial) => (
          <span key={serial} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-xs font-mono text-gray-800 dark:text-gray-100">
            {serial}
            <button type="button" onClick={() => toggle(serial)} disabled={disabled}
              aria-label={`Remove meter ${serial}`}
              className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>

      {/* Search + phase */}
      <div className="p-2 flex flex-col sm:flex-row gap-2 border-b border-gray-200 dark:border-gray-700">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            id={id}
            type="search"
            inputMode="numeric"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={disabled}
            placeholder="Search meter serial number"
            aria-controls={`${id}-list`}
            className="form-input w-full pl-9 pr-3 py-2 text-sm font-mono"
          />
        </div>
        {phases.length > 1 && (
          <select value={phase} onChange={(e) => setPhase(e.target.value)} disabled={disabled}
            aria-label="Filter meters by phase" className="form-input px-3 py-2 text-sm">
            <option value="">All phases</option>
            {phases.map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
          </select>
        )}
      </div>

      {/* Options */}
      {options.length === 0 ? (
        <p className="p-3 text-sm text-gray-500 dark:text-gray-400">No available meters to dispatch.</p>
      ) : (
        <ul id={`${id}-list`} aria-label="Available meters" className="max-h-60 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/60">
          {shown.length === 0 && (
            <li className="p-3 text-sm text-gray-500 dark:text-gray-400">
              <p>No meter matches &ldquo;{query}&rdquo;.</p>
              {lookup?.state === 'loading' && <p className="text-xs mt-1">Checking the meter inventory…</p>}
              {lookup?.state === 'found' && (
                <p className="text-xs mt-1 text-amber-700 dark:text-amber-400">
                  Meter {lookup.serial} exists, but can&rsquo;t be dispatched because {lookup.reason}.
                </p>
              )}
              {lookup?.state === 'missing' && (
                <p className="text-xs mt-1">Meter {lookup.serial} is not in the meter inventory.</p>
              )}
              {lookup?.state === 'error' && (
                <p className="text-xs mt-1">Couldn&rsquo;t check the wider inventory just now.</p>
              )}
            </li>
          )}
          {shown.map((o) => (
            <li key={o.serial}>
              <label className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/50">
                <input
                  type="checkbox"
                  checked={selected.has(o.serial)}
                  onChange={() => toggle(o.serial)}
                  disabled={disabled}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500 shrink-0"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-mono text-gray-900 dark:text-white break-all">{o.serial}</span>
                  <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                    {[o.phaseType, meterMakeModel(o), o.simNumber && `SIM ${o.simNumber}`].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="p-2 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {matches.length > MAX_SHOWN
            ? `Showing ${MAX_SHOWN} of ${matches.length.toLocaleString()} — type to narrow`
            : `${options.length.toLocaleString()} available`}
          {value.length > 0 && ` · ${value.length} selected`}
        </p>
        <button type="button" onClick={() => { setPasteOpen((v) => !v); setPasteResult(null); }} disabled={disabled}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-400 hover:underline">
          <ClipboardPaste className="w-3.5 h-3.5" /> Paste serials
        </button>
      </div>

      {pasteOpen && (
        <div className="p-2 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <textarea
            rows={3}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            disabled={disabled}
            aria-label="Paste meter serial numbers"
            placeholder="One per line, or separated by spaces or commas"
            className="form-input w-full px-3 py-2 text-sm font-mono"
          />
          <button type="button" onClick={applyPaste} disabled={disabled || !pasteText.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
            Add to selection
          </button>
        </div>
      )}
      {pasteResult && (
        <p className="px-2 pb-2 text-xs text-gray-600 dark:text-gray-300" role="status">
          {pasteResult.added} added.
          {pasteResult.rejected.length > 0 && (
            <span className="text-red-700 dark:text-red-400">
              {' '}Not available: <span className="font-mono break-all">{pasteResult.rejected.join(', ')}</span>
            </span>
          )}
        </p>
      )}
    </div>
  );
}

export default MeterSerialPicker;
