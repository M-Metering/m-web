// src/components/installations/CustomExportModal.jsx
// Custom export (API update 2026-10-13, §7) — opened from Installations →
// "Export installations" → "Custom export". The person picks the columns,
// filters and optional grouped totals; the SERVER builds the file (Excel with
// Data / Totals / Summary sheets, or a UTF-8 CSV) and this screen saves it as
// sent — no client-side CSV writer, no client-side totals.
//
// Everything offered comes from GET /installations/custom-export/fields, which
// is already narrowed to the caller's role (a Supervisor gets no customer
// phone/email or revenue). The rules live in utils/customExport.js.
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Loader2, Plus, Trash2, AlertCircle, Download, RefreshCw } from 'lucide-react';
import jedApi from '../services/api';
import { useDiscoOptions } from '../../hooks/useDiscoOptions';
import { getErrorMessage } from '../../utils/errorMessage';
import { downloadServerXlsx } from '../../utils/xlsx';
import { downloadBlob } from '../../utils/downloadBlob';
import { toDateInputValue } from '../../utils/date';
import {
  parseCatalogue, fieldsBySection, defaultColumns, valueKindFor, emptyValueFor, opLabel, presetLabel,
  bucketLabel, enumLabel, isDateField, validateCustomExport, buildCustomExportRequest, errorsByLocation,
} from '../../utils/customExport';

const FORMAT_LABELS = { xlsx: 'Excel (.xlsx)', csv: 'CSV (.csv)' };
const inputClass = 'form-input w-full px-3 py-2 text-sm';
const smallButton = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50';

function Section({ title, hint, error, children }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
        {hint && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{hint}</p>}
      </div>
      {children}
      <FieldErrors messages={error} />
    </section>
  );
}

function FieldErrors({ messages }) {
  const list = [messages].flat().filter(Boolean);
  if (list.length === 0) return null;
  return (
    <div role="alert" className="space-y-0.5">
      {list.map((m) => <p key={m} className="text-xs text-red-600 dark:text-red-400">{m}</p>)}
    </div>
  );
}

function FilterValue({ field, op, value, onChange, presets, idPrefix, disabled }) {
  const kind = valueKindFor(field, op);
  const pair = Array.isArray(value) ? value : ['', ''];
  const setPair = (i, v) => onChange(i === 0 ? [v, pair[1]] : [pair[0], v]);
  switch (kind) {
    case 'none':
      return null;
    case 'enumList':
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {(field.values || []).map((v) => (
            <label key={v} className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
              <input type="checkbox" disabled={disabled}
                checked={Array.isArray(value) && value.includes(v)}
                onChange={(e) => onChange(e.target.checked ? [...(value || []), v] : (value || []).filter((x) => x !== v))}
                className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500" />
              {enumLabel(v)}
            </label>
          ))}
        </div>
      );
    case 'enum':
      return (
        <select aria-label="Value" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">Choose…</option>
          {(field.values || []).map((v) => <option key={v} value={v}>{enumLabel(v)}</option>)}
        </select>
      );
    case 'preset':
      return (
        <select aria-label="Period" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">Choose a period…</option>
          {presets.map((p) => <option key={p} value={p}>{presetLabel(p)}</option>)}
        </select>
      );
    case 'boolean':
      return (
        <select aria-label="Value" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">Choose…</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    case 'date':
      return <input type="date" aria-label="Date" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
    case 'dateRange':
    case 'numberRange': {
      const type = kind === 'dateRange' ? 'date' : 'text';
      return (
        <div className="grid grid-cols-2 gap-2">
          <input id={`${idPrefix}-from`} type={type} inputMode={type === 'text' ? 'decimal' : undefined} aria-label="From"
            placeholder="From" value={pair[0]} disabled={disabled} onChange={(e) => setPair(0, e.target.value)} className={inputClass} />
          <input id={`${idPrefix}-to`} type={type} inputMode={type === 'text' ? 'decimal' : undefined} aria-label="To"
            placeholder="To" value={pair[1]} disabled={disabled} onChange={(e) => setPair(1, e.target.value)} className={inputClass} />
        </div>
      );
    }
    case 'number':
      return <input type="text" inputMode="decimal" aria-label="Number" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
    case 'textList':
      return <input type="text" aria-label="Values" placeholder="Separate several values with commas" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
    default:
      return <input type="text" aria-label="Value" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
  }
}

/**
 * @param {{ isOpen: boolean, onClose: () => void, onDone?: (message: string) => void,
 *   initialDiscoCodes?: string[] }} props
 *   initialDiscoCodes: the disco the page is scoped to, pre-ticked on open.
 */
function CustomExportModal({ isOpen, onClose, onDone, initialDiscoCodes = [] }) {
  const { discos } = useDiscoOptions();
  const [catalogue, setCatalogue] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [format, setFormat] = useState('xlsx');
  const [discoCodes, setDiscoCodes] = useState([]);
  const [columns, setColumns] = useState([]);
  const [totalsOnly, setTotalsOnly] = useState(false);
  const [filters, setFilters] = useState([]);
  const [groupBy, setGroupBy] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [sort, setSort] = useState([]);

  const [inputErrors, setInputErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const nextId = useRef(1);
  const titleRef = useRef(null);
  const newId = () => nextId.current++;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const parsed = parseCatalogue(await jedApi.getCustomExportFields());
      if (!parsed) throw new Error('The export options came back empty.');
      setCatalogue(parsed);
      setColumns(defaultColumns(parsed.fields));
      setFormat(parsed.formats.includes('xlsx') ? 'xlsx' : parsed.formats[0]);
    } catch (err) {
      console.error('[CustomExport] Catalogue load failed:', err);
      setLoadError(getErrorMessage(err, 'Unable to load the export options.'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load the catalogue once; on every open, pre-tick the page's disco and
  // clear the previous run's messages. Other choices are kept between opens,
  // so a tweak-and-rerun doesn't start from scratch.
  const initialKey = initialDiscoCodes.join(',');
  useEffect(() => {
    if (!isOpen) return;
    if (!catalogue && !loading) load();
    setDiscoCodes(initialKey ? initialKey.split(',') : []);
    setInputErrors({});
    setSubmitError(null);
    titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialKey]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape' && !runningRef.current) onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const sections = useMemo(() => (catalogue ? fieldsBySection(catalogue.fields) : []), [catalogue]);
  const filterable = useMemo(() => (catalogue?.fields || []).filter((f) => (f.ops || []).length > 0), [catalogue]);
  const groupable = useMemo(() => (catalogue?.fields || []).filter((f) => f.groupable === true), [catalogue]);

  if (!isOpen) return null;

  const clearError = (loc) => {
    setSubmitError(null);
    setInputErrors((prev) => (prev[loc] ? { ...prev, [loc]: undefined } : prev));
  };
  const toggle = (list, setList, key, on) => setList(on ? [...list, key] : list.filter((k) => k !== key));

  const updateFilter = (i, patch) => {
    clearError(`filters[${i}]`);
    setFilters((prev) => prev.map((f, j) => {
      if (j !== i) return f;
      const next = { ...f, ...patch };
      const field = catalogue.byKey.get(next.field);
      if (patch.field !== undefined) next.op = field?.ops?.[0] || '';
      if (patch.field !== undefined || patch.op !== undefined) next.value = emptyValueFor(valueKindFor(field, next.op));
      return next;
    }));
  };
  const addFilter = () => {
    const field = filterable[0];
    const op = field?.ops?.[0] || '';
    setFilters((prev) => [...prev, { id: newId(), field: field?.key || '', op, value: emptyValueFor(valueKindFor(field, op)) }]);
  };

  const addGrouping = () => {
    const used = new Set(groupBy.map((g) => g.field));
    const field = groupable.find((f) => !used.has(f.key)) || groupable[0];
    setGroupBy((prev) => [...prev, { id: newId(), field: field?.key || '', bucket: isDateField(field) ? (catalogue.dateBuckets[0] || 'day') : '' }]);
  };
  const updateGrouping = (i, patch) => {
    clearError(`groupBy[${i}]`);
    setGroupBy((prev) => prev.map((g, j) => {
      if (j !== i) return g;
      const next = { ...g, ...patch };
      if (patch.field !== undefined) next.bucket = isDateField(catalogue.byKey.get(next.field)) ? (catalogue.dateBuckets[0] || 'day') : '';
      return next;
    }));
  };
  const removeGrouping = (i) => {
    const next = groupBy.filter((_, j) => j !== i);
    setGroupBy(next);
    if (next.length === 0) { setMetrics([]); setTotalsOnly(false); }
  };

  const run = async () => {
    if (runningRef.current || !catalogue) return;
    const state = {
      format, discoCodes, filters, groupBy, metrics, sort,
      columns: totalsOnly && groupBy.length > 0 ? [] : columns,
    };
    const found = validateCustomExport(state, catalogue);
    if (Object.keys(found).length > 0) {
      setInputErrors(found);
      setSubmitError('Some choices need attention — see the highlighted items.');
      return;
    }
    runningRef.current = true;
    setRunning(true);
    setInputErrors({});
    setSubmitError(null);
    try {
      const { blob, filename } = await jedApi.runCustomExport(buildCustomExportRequest(state, catalogue));
      const name = filename || `installations-export-${toDateInputValue()}.${format}`;
      if (format === 'xlsx') await downloadServerXlsx(blob, name);
      else downloadBlob(blob, name);
      onDone?.(`Custom export downloaded: ${name}.`);
      onClose();
    } catch (err) {
      console.error('[CustomExport] Export failed:', err);
      const byLoc = errorsByLocation(err?.errors);
      setInputErrors(byLoc);
      // These messages are written for the user (row limits, disco access,
      // "No installations match these filters"), so they may be long.
      setSubmitError(getErrorMessage(err, 'The export could not be created. Please try again.', { maxLength: 300 }));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  const limitNote = (fmt) => {
    const max = Number(catalogue?.limits?.[fmt]);
    return Number.isFinite(max) && max > 0 ? ` — up to ${max.toLocaleString()} rows` : '';
  };
  const fieldLabel = (key) => catalogue?.byKey.get(key)?.label || key;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="custom-export-title"
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92vh] flex flex-col">
        <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="custom-export-title" ref={titleRef} tabIndex={-1} className="text-lg font-semibold text-gray-900 dark:text-white outline-none">
              Custom export
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Choose what goes in the file. It covers installation requests in every status, not only completed ones.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={running} aria-label="Close"
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {loading && !catalogue ? (
            <div className="py-12 flex items-center justify-center" role="status">
              <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
              <span className="sr-only">Loading export options…</span>
            </div>
          ) : loadError && !catalogue ? (
            <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-800 dark:text-red-300">{loadError}</p>
                <button type="button" onClick={load} className={`${smallButton} mt-2`}>
                  <RefreshCw className="w-3.5 h-3.5" /> Try again
                </button>
              </div>
            </div>
          ) : catalogue && (
            <>
              <Section title="1. File type" error={inputErrors.format}>
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-6">
                  {catalogue.formats.map((fmt) => (
                    <label key={fmt} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input type="radio" name="custom-export-format" value={fmt} checked={format === fmt} disabled={running}
                        onChange={() => setFormat(fmt)} className="h-4 w-4 text-brand-600 focus:ring-brand-500" />
                      {FORMAT_LABELS[fmt] || fmt.toUpperCase()}
                      <span className="text-xs text-gray-500 dark:text-gray-400">{limitNote(fmt)}</span>
                    </label>
                  ))}
                </div>
              </Section>

              {discos.length > 1 && (
                <Section title="Discos" hint="Leave all unticked to include every disco you can access." error={inputErrors.discoCodes}>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {discos.map((d) => (
                      <label key={d.code} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
                        <input type="checkbox" checked={discoCodes.includes(d.code)} disabled={running}
                          onChange={(e) => { clearError('discoCodes'); toggle(discoCodes, setDiscoCodes, d.code, e.target.checked); }}
                          className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500" />
                        {d.name || d.code}
                      </label>
                    ))}
                  </div>
                </Section>
              )}

              <Section
                title="2. Columns"
                hint={totalsOnly ? 'Totals only — the file will hold just the totals table.' : `${columns.length} selected. The usual columns are ticked for you.`}
                error={inputErrors.columns}
              >
                <button type="button" onClick={() => { clearError('columns'); setColumns(defaultColumns(catalogue.fields)); }}
                  disabled={running || totalsOnly} className={smallButton}>
                  Use the usual columns
                </button>
                <div className={`space-y-3 ${totalsOnly ? 'opacity-50' : ''}`}>
                  {sections.map(({ section, fields }) => (
                    <fieldset key={section} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                      <legend className="px-1 text-xs font-semibold text-gray-600 dark:text-gray-300">{section}</legend>
                      <div className="flex gap-3 mb-2 text-xs">
                        <button type="button" disabled={running || totalsOnly}
                          onClick={() => { clearError('columns'); setColumns((prev) => [...new Set([...prev, ...fields.map((f) => f.key)])]); }}
                          className="text-brand-700 dark:text-brand-400 hover:underline disabled:opacity-50">All</button>
                        <button type="button" disabled={running || totalsOnly}
                          onClick={() => setColumns((prev) => prev.filter((k) => !fields.some((f) => f.key === k)))}
                          className="text-brand-700 dark:text-brand-400 hover:underline disabled:opacity-50">None</button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                        {fields.map((f) => (
                          <label key={f.key} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <input type="checkbox" checked={columns.includes(f.key)} disabled={running || totalsOnly}
                              onChange={(e) => { clearError('columns'); toggle(columns, setColumns, f.key, e.target.checked); }}
                              className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500" />
                            {f.label || f.key}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
              </Section>

              <Section
                title="3. Filters (optional)"
                hint="Only rows that match every filter are included. Dates are whole days in Lagos time."
                error={inputErrors.filters}
              >
                {filters.map((f, i) => {
                  const field = catalogue.byKey.get(f.field);
                  return (
                    <div key={f.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                        <select aria-label={`Filter ${i + 1} field`} value={f.field} disabled={running}
                          onChange={(e) => updateFilter(i, { field: e.target.value })} className={inputClass}>
                          {filterable.map((ff) => <option key={ff.key} value={ff.key}>{ff.label || ff.key}</option>)}
                        </select>
                        <select aria-label={`Filter ${i + 1} condition`} value={f.op} disabled={running}
                          onChange={(e) => updateFilter(i, { op: e.target.value })} className={inputClass}>
                          {(field?.ops || []).map((op) => <option key={op} value={op}>{opLabel(op, field)}</option>)}
                        </select>
                        <button type="button" aria-label={`Remove filter ${i + 1}`} disabled={running}
                          onClick={() => { setFilters((prev) => prev.filter((_, j) => j !== i)); setInputErrors({}); }}
                          className={smallButton}>
                          <Trash2 className="w-3.5 h-3.5" /> <span className="sm:hidden">Remove</span>
                        </button>
                      </div>
                      <FilterValue field={field} op={f.op} value={f.value} presets={catalogue.datePresets}
                        idPrefix={`custom-filter-${f.id}`} disabled={running}
                        onChange={(value) => { clearError(`filters[${i}]`); setFilters((prev) => prev.map((x, j) => (j === i ? { ...x, value } : x))); }} />
                      <FieldErrors messages={inputErrors[`filters[${i}]`]} />
                    </div>
                  );
                })}
                <button type="button" onClick={addFilter} disabled={running || filters.length >= catalogue.limits.filters || filterable.length === 0}
                  className={smallButton}>
                  <Plus className="w-3.5 h-3.5" /> Add filter
                </button>
              </Section>

              <Section
                title="4. Totals (optional)"
                hint="Group rows to count them — for example, installations per installer per week. The file then gets a Totals sheet."
                error={[inputErrors.groupBy, inputErrors.metrics]}
              >
                {groupBy.map((g, i) => {
                  const field = catalogue.byKey.get(g.field);
                  return (
                    <div key={g.id} className="space-y-1">
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                        <select aria-label={`Group ${i + 1} field`} value={g.field} disabled={running}
                          onChange={(e) => updateGrouping(i, { field: e.target.value })} className={inputClass}>
                          {groupable.map((gf) => <option key={gf.key} value={gf.key}>{gf.label || gf.key}</option>)}
                        </select>
                        {isDateField(field) ? (
                          <select aria-label={`Group ${i + 1} period`} value={g.bucket} disabled={running}
                            onChange={(e) => updateGrouping(i, { bucket: e.target.value })} className={inputClass}>
                            {catalogue.dateBuckets.map((b) => <option key={b} value={b}>{bucketLabel(b)}</option>)}
                          </select>
                        ) : <span className="hidden sm:block" />}
                        <button type="button" aria-label={`Remove grouping ${i + 1}`} disabled={running}
                          onClick={() => removeGrouping(i)} className={smallButton}>
                          <Trash2 className="w-3.5 h-3.5" /> <span className="sm:hidden">Remove</span>
                        </button>
                      </div>
                      <FieldErrors messages={inputErrors[`groupBy[${i}]`]} />
                    </div>
                  );
                })}
                <button type="button" onClick={addGrouping}
                  disabled={running || groupBy.length >= catalogue.limits.groupBy || groupable.length === 0} className={smallButton}>
                  <Plus className="w-3.5 h-3.5" /> {groupBy.length === 0 ? 'Add a grouping' : 'Group by another field'}
                </button>
                {groupBy.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <p className="text-xs font-medium text-gray-600 dark:text-gray-300">Totals to show for each group</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {catalogue.metrics.map((m) => (
                        <label key={m.key} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
                          <input type="checkbox" checked={metrics.includes(m.key)} disabled={running}
                            onChange={(e) => { clearError('metrics'); toggle(metrics, setMetrics, m.key, e.target.checked); }}
                            className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500" />
                          {m.label || m.key}
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">None ticked counts installations.</p>
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input type="checkbox" checked={totalsOnly} disabled={running}
                        onChange={(e) => { clearError('columns'); setTotalsOnly(e.target.checked); }}
                        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500" />
                      Totals only — leave out the row-by-row list
                    </label>
                  </div>
                )}
              </Section>

              <Section title="5. Sort order (optional)" hint="Newest first when nothing is chosen." error={inputErrors.sort}>
                {sort.map((s, i) => (
                  <div key={s.id} className="space-y-1">
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                      <select aria-label={`Sort ${i + 1} field`} value={s.field} disabled={running}
                        onChange={(e) => { clearError(`sort[${i}]`); setSort((prev) => prev.map((x, j) => (j === i ? { ...x, field: e.target.value } : x))); }}
                        className={inputClass}>
                        {catalogue.fields.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
                      </select>
                      <select aria-label={`Sort ${i + 1} direction`} value={s.dir} disabled={running}
                        onChange={(e) => setSort((prev) => prev.map((x, j) => (j === i ? { ...x, dir: e.target.value } : x)))}
                        className={inputClass}>
                        <option value="desc">Newest / highest / Z first</option>
                        <option value="asc">Oldest / lowest / A first</option>
                      </select>
                      <button type="button" aria-label={`Remove sort ${i + 1}`} disabled={running}
                        onClick={() => setSort((prev) => prev.filter((_, j) => j !== i))} className={smallButton}>
                        <Trash2 className="w-3.5 h-3.5" /> <span className="sm:hidden">Remove</span>
                      </button>
                    </div>
                    <FieldErrors messages={inputErrors[`sort[${i}]`]} />
                  </div>
                ))}
                <button type="button" disabled={running || sort.length >= catalogue.limits.sort}
                  onClick={() => setSort((prev) => [...prev, { id: newId(), field: catalogue.fields[0].key, dir: 'desc' }])}
                  className={smallButton}>
                  <Plus className="w-3.5 h-3.5" /> Add sort
                </button>
                {sort.length > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">Sorted by {sort.map((s) => fieldLabel(s.field)).join(', then ')}.</p>
                )}
              </Section>
            </>
          )}
        </div>

        <div className="p-4 sm:px-6 border-t border-gray-200 dark:border-gray-700 space-y-2">
          {(submitError || inputErrors.general) && (
            <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="text-sm text-red-800 dark:text-red-300 space-y-0.5">
                {submitError && <p>{submitError}</p>}
                {(inputErrors.general || []).map((m) => <p key={m}>{m}</p>)}
              </div>
            </div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3">
            {running && (
              <p className="text-xs text-gray-500 dark:text-gray-400 sm:mr-auto" aria-live="polite">
                Preparing your export — large exports can take a few seconds.
              </p>
            )}
            <button type="button" onClick={onClose} disabled={running}
              className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium rounded-lg text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={run} disabled={running || !catalogue}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {running ? 'Preparing…' : `Download ${format === 'csv' ? 'CSV' : 'Excel'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CustomExportModal;
