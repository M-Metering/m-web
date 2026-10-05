// src/components/installations/MeterSerialPicker.jsx
// Searchable multi-select of dispatchable meter serials (Assignments page).
// Options come from toMeterOptions() — only eligible meters are listed, so an
// unavailable meter can't be picked. Serials are shown in full, as strings
// (leading zeros intact). Large inventories are searched rather than scrolled:
// at most MAX_SHOWN matches render at once.
//
// FINDING A METER THE LIST DOESN'T HAVE (2026-09-27). The options are the
// result of paging through GET /meters?status=AVAILABLE — ~60 requests over an
// endpoint that is filtered by an exact status match and offers no documented
// ordering. A meter could be in Meter Schedule (which searches server-side)
// and missing here, which read as "the meter can't be assigned". So a typed
// serial is now ALSO searched server-side with GET /meters/search — the same
// endpoint Meter Schedule's search uses — deliberately WITHOUT a status
// filter, and the result is judged by the shared isAssignableMeter rule. A
// dispatchable meter it finds is added to the options (onDiscover); one that
// isn't dispatchable is explained, with the real reason. Pasted serials the
// list lacks are resolved the same way, one exact lookup each (at most 4 at a
// time), before anything is reported as "not available".
import { useMemo, useState, useEffect, useCallback } from 'react';
import { Search, X, Loader2, RefreshCw, ClipboardPaste } from 'lucide-react';
import jedApi from '../services/api';
import {
  isAssignableMeter, matchPastedSerials, meterSerial, meterPhase, undispatchableReason,
  countOptionsByPhase, availableCountLabel,
} from '../../utils/meterInventory';
import { meterMakeModel } from '../../utils/meterDisplay';
import { phaseCapacity } from '../../utils/meterCapacity';
import { formatPhaseLabel } from '../../utils/installationScope';
import { unwrapListResponse } from '../../utils/unwrapListResponse';
import { mapWithConcurrency } from '../../utils/concurrency';

const MAX_SHOWN = 200;
const COMPLETE_METER_NUMBER_RE = /^\d{10,13}$/;
// A serial fragment long enough to be worth a server-side search.
const SEARCHABLE_RE = /^\d{4,}$/;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 50;
// Upper bound on per-serial lookups for one paste.
const MAX_PASTE_LOOKUPS = 100;

const recordsOf = (response) => {
  const payload = response?.data ?? response;
  if (payload && !Array.isArray(payload) && payload.meterNumber) return [payload];
  return unwrapListResponse(response, ['meters']);
};

/**
 * @param {object} props
 * @param {object[]} props.options - dispatchable meters (toMeterOptions)
 * @param {object|null} [props.capacity] - the target installer's live capacity
 *   (computeMeterCapacity). Meter types the installer has no remaining
 *   installation capacity for are disabled rather than silently rejected at
 *   submit time. Omit it (or pass null) and no meter type is disabled.
 * @param {boolean} [props.enforced] - false for a role the capacity doesn't
 *   cap (Super Admin): every meter type stays selectable.
 * @param {Map<string, object>|null} [props.holders] - the open-dispatch index
 *   (hooks/useMeterHolders.js), so a meter found by search is judged by the
 *   same rule the options were.
 * @param {(meters: object[]) => void} [props.onDiscover] - receives dispatchable
 *   meter records found server-side that the options didn't contain; the
 *   parent merges them into its records so they become ordinary options (with
 *   their phase known to the capacity check).
 */
function MeterSerialPicker({
  id, options, loading, error, onRetry, value, onChange, disabled, invalid,
  capacity = null, enforced = true, holders = null, onDiscover,
}) {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState(null);
  const [pasting, setPasting] = useState(false);
  // What the server-side search says about a term the options don't cover.
  const [lookup, setLookup] = useState(null);

  const holderOf = useCallback((meter) => holders?.get(meterSerial(meter)) || null, [holders]);

  const selected = useMemo(() => new Set(value), [value]);
  const phases = useMemo(
    () => Array.from(new Set(options.map((o) => o.phaseType).filter(Boolean))).sort(),
    [options]
  );

  // Why a meter type can't be dispatched to this installer right now, or null.
  // Only the installation-capacity rule lives here — whether the meter itself
  // is dispatchable was already settled by toMeterOptions/isAssignableMeter,
  // which is why an ineligible meter isn't in `options` at all.
  const phaseBlockedReason = useCallback((phaseType) => {
    if (!enforced || !capacity) return null;
    const bucket = phaseCapacity(capacity, phaseType);
    if (bucket.remaining > 0) return null;
    return bucket.required === 0
      ? `No pending ${formatPhaseLabel(phaseType)} installation is assigned to this installer.`
      : `No remaining ${formatPhaseLabel(phaseType)} installation capacity for this installer.`;
  }, [enforced, capacity]);

  const matches = useMemo(() => {
    const term = query.trim();
    return options.filter((o) => (!phase || o.phaseType === phase) && (!term || o.serial.includes(term)));
  }, [options, query, phase]);
  const shown = matches.slice(0, MAX_SHOWN);
  // Per-phase totals for the dropdown and the count line, so a phase filter
  // never shows the all-phase figure.
  const phaseCounts = useMemo(() => countOptionsByPhase(options), [options]);
  const phaseTotal = phase ? (phaseCounts.get(phase) || 0) : options.length;

  // Search the WHOLE inventory server-side for the typed serial (or SIM)
  // fragment, not just the rows the paged scan happened to return. Debounced;
  // one request per settled term. Found-and-dispatchable meters join the
  // options via onDiscover; an exact match that can't be dispatched is
  // explained with its real reason. Nothing is invented: if the server has no
  // such meter, that is what gets reported.
  useEffect(() => {
    const term = query.trim();
    if (!SEARCHABLE_RE.test(term)) {
      setLookup(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLookup({ state: 'loading', serial: term });
      try {
        const response = await jedApi.searchMeters({ q: term, limit: SEARCH_LIMIT });
        let found = recordsOf(response);
        // A complete number the substring search missed (or a search that
        // isn't deployed): fall back to the exact lookup.
        const listed = options.some((o) => o.serial === term);
        if (found.length === 0 && !listed && COMPLETE_METER_NUMBER_RE.test(term)) {
          try {
            found = recordsOf(await jedApi.getMeterByNumber(term));
          } catch (err) {
            if (!String(err?.message || '').startsWith('NOT_FOUND:')) throw err;
          }
        }
        if (cancelled) return;
        const known = new Set(options.map((o) => o.serial));
        const discovered = found.filter((m) => isAssignableMeter(m, holderOf(m)) && !known.has(meterSerial(m)));
        if (discovered.length > 0) onDiscover?.(discovered);
        const exact = found.find((m) => meterSerial(m) === term);
        if (exact && !isAssignableMeter(exact, holderOf(exact))) {
          setLookup({ state: 'found', serial: term, reason: undispatchableReason(exact, holderOf(exact)) || 'it is not available' });
        } else if (found.length === 0 && !listed && COMPLETE_METER_NUMBER_RE.test(term)) {
          setLookup({ state: 'missing', serial: term });
        } else {
          setLookup(null);
        }
      } catch (err) {
        console.warn('[MeterSerialPicker] Server-side meter search failed:', err?.message);
        if (!cancelled) setLookup({ state: 'error', serial: term });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
    // `options`/`onDiscover` are read, not watched: a discovery changes the
    // options, and re-searching the same term because of it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, holderOf]);

  const toggle = (serial) => {
    onChange(selected.has(serial) ? value.filter((s) => s !== serial) : [...value, serial]);
  };

  const applyPaste = async () => {
    if (pasting) return;
    setPasting(true);
    try {
      const { accepted, rejected: notListed } = matchPastedSerials(options, pasteText);
      const phaseByserial = new Map(options.map((o) => [o.serial, o.phaseType]));

      // Serials the options don't have are looked up exactly before being
      // called unavailable — the list is a paged scan and can miss a meter.
      const toResolve = notListed.filter((s) => COMPLETE_METER_NUMBER_RE.test(s)).slice(0, MAX_PASTE_LOOKUPS);
      const unresolved = notListed.filter((s) => !toResolve.includes(s)).map((serial) => ({ serial, reason: 'not a meter number' }));
      const resolved = await mapWithConcurrency(toResolve, 4, async (serial) => {
        try {
          const [meter] = recordsOf(await jedApi.getMeterByNumber(serial));
          return { serial, meter: meter && meterSerial(meter) === serial ? meter : null };
        } catch (err) {
          return { serial, meter: null, failed: !String(err?.message || '').startsWith('NOT_FOUND:') };
        }
      });
      const discovered = [];
      const rejected = [...unresolved];
      resolved.forEach(({ serial, meter, failed }) => {
        if (!meter) {
          rejected.push({ serial, reason: failed ? "couldn't be checked" : 'not in the meter inventory' });
          return;
        }
        const holder = holderOf(meter);
        if (!isAssignableMeter(meter, holder)) {
          rejected.push({ serial, reason: undispatchableReason(meter, holder) || 'not available' });
          return;
        }
        discovered.push(meter);
        phaseByserial.set(serial, meterPhase(meter));
        accepted.push(serial);
      });
      if (discovered.length > 0) onDiscover?.(discovered);

      // A pasted list must obey the same meter-type rule as a clicked row —
      // otherwise paste would be a way around the disabled checkboxes.
      const allowed = accepted.filter((serial) => {
        const reason = phaseBlockedReason(phaseByserial.get(serial));
        if (!reason) return true;
        rejected.push({ serial, reason: 'no matching installation capacity' });
        return false;
      });
      const added = allowed.filter((s) => !selected.has(s));
      if (added.length) onChange([...value, ...added]);
      setPasteResult({ added: added.length, rejected });
      if (rejected.length === 0) { setPasteText(''); setPasteOpen(false); }
    } finally {
      setPasting(false);
    }
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
            <option value="">All phases ({options.length.toLocaleString()})</option>
            {/* A meter type the installer has no eligible installation for is
                offered as disabled rather than hidden — an operator needs to
                see that Three Phase exists and why it can't be picked. */}
            {phases.map((p) => (
              <option key={p} value={p} disabled={!!phaseBlockedReason(p)}>
                {formatPhaseLabel(p)} ({(phaseCounts.get(p) || 0).toLocaleString()}){phaseBlockedReason(p) ? ' — unavailable' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Options */}
      {options.length === 0 && !query.trim() ? (
        <p className="p-3 text-sm text-gray-500 dark:text-gray-400">No available meters to dispatch.</p>
      ) : (
        <ul id={`${id}-list`} aria-label="Available meters" className="max-h-60 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/60">
          {shown.length === 0 && (
            <li className="p-3 text-sm text-gray-500 dark:text-gray-400">
              <p>No meter matches &ldquo;{query}&rdquo;.</p>
              {lookup?.state === 'loading' && <p className="text-xs mt-1">Searching the whole meter inventory…</p>}
              {lookup?.state === 'found' && (
                <p className="text-xs mt-1 text-amber-700 dark:text-amber-400">
                  Meter {lookup.serial} exists, but can&rsquo;t be dispatched because {lookup.reason}.
                </p>
              )}
              {lookup?.state === 'missing' && (
                <p className="text-xs mt-1">Meter {lookup.serial} is not in the meter inventory.</p>
              )}
              {lookup?.state === 'error' && (
                <p className="text-xs mt-1">Couldn&rsquo;t search the whole inventory just now.</p>
              )}
            </li>
          )}
          {shown.map((o) => {
            const blocked = phaseBlockedReason(o.phaseType);
            return (
              <li key={o.serial}>
                <label className={`flex items-start gap-2 px-3 py-2 ${
                  blocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/50'
                }`}>
                  <input
                    type="checkbox"
                    checked={selected.has(o.serial)}
                    onChange={() => toggle(o.serial)}
                    disabled={disabled || !!blocked}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-mono text-gray-900 dark:text-white break-all">{o.serial}</span>
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                      {[o.phaseType, meterMakeModel(o), o.simNumber && `SIM ${o.simNumber}`].filter(Boolean).join(' · ')}
                    </span>
                    {blocked && (
                      <span className="block text-[11px] text-amber-700 dark:text-amber-400">{blocked}</span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="p-2 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {availableCountLabel({
            matches: matches.length, total: phaseTotal, maxShown: MAX_SHOWN,
            phaseLabel: phase ? formatPhaseLabel(phase) : null, searching: !!query.trim(),
          })}
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
          <button type="button" onClick={applyPaste} disabled={disabled || pasting || !pasteText.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
            {pasting ? 'Checking…' : 'Add to selection'}
          </button>
        </div>
      )}
      {pasteResult && (
        <p className="px-2 pb-2 text-xs text-gray-600 dark:text-gray-300" role="status">
          {pasteResult.added} added.
          {pasteResult.rejected.length > 0 && (
            <span className="text-red-700 dark:text-red-400">
              {' '}Not added: <span className="break-all">{pasteResult.rejected.map((r) => `${r.serial} (${r.reason})`).join(', ')}</span>
            </span>
          )}
        </p>
      )}
    </div>
  );
}

export default MeterSerialPicker;
