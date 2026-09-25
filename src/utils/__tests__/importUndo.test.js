import { describe, it, expect } from 'vitest';
import { summarizeUndoResult, undoConfirmationMessage } from '../importUndo';

describe('summarizeUndoResult', () => {
  it('reports a clean undo with no caveat', () => {
    const s = summarizeUndoResult({ batchId: 12, deletedCount: 118, skippedCount: 0 });
    expect(s).toMatchObject({ deleted: 118, skipped: 0, partial: false, noop: false });
    expect(s.headline).toBe('Removed 118 rows created by this import.');
    expect(s.detail).toBeNull();
  });

  it('reads the documented response shape, nested under data or not', () => {
    const payload = { deletedCount: 3, skippedCount: 0 };
    expect(summarizeUndoResult({ data: payload }).deleted).toBe(3);
    expect(summarizeUndoResult(payload).deleted).toBe(3);
  });

  it('presents skipped rows as the safety rule, not a failure', () => {
    const s = summarizeUndoResult({
      deletedCount: 118,
      skippedCount: 4,
      skippedByReason: { INSTALLED: 3, IN_PROGRESS: 1 },
    });
    expect(s.partial).toBe(true);
    expect(s.headline).toBe('Removed 118 rows created by this import.');
    expect(s.detail).toBe('4 rows kept because they are already in use (3 installed, 1 in progress).');
  });

  it('uses the singular for a single kept row', () => {
    const s = summarizeUndoResult({ deletedCount: 0, skippedCount: 1, skippedByReason: { EXPORTED: 1 } });
    expect(s.detail).toBe('1 row kept because it is already in use (1 exported).');
  });

  it('orders the reasons by how many rows each kept', () => {
    const s = summarizeUndoResult({
      deletedCount: 1,
      skippedCount: 6,
      skippedByReason: { IN_PROGRESS: 1, INSTALLED: 5 },
    });
    expect(s.reasons.map((r) => r.status)).toEqual(['INSTALLED', 'IN_PROGRESS']);
  });

  it('keeps a meter batch’s own statuses rather than forcing them into installation labels', () => {
    const s = summarizeUndoResult({ deletedCount: 0, skippedCount: 2, skippedByReason: { USED: 2 } });
    expect(s.reasons[0]).toMatchObject({ status: 'USED', count: 2 });
  });

  it('says plainly that a repeat undo removed nothing — it is idempotent, not broken', () => {
    const s = summarizeUndoResult({ deletedCount: 0, skippedCount: 0 });
    expect(s.noop).toBe(true);
    expect(s.headline).toBe('Nothing left to remove from this import.');
  });

  it('survives a missing or malformed body without inventing counts', () => {
    expect(summarizeUndoResult(null)).toMatchObject({ deleted: 0, skipped: 0, reasons: [], noop: true });
    expect(summarizeUndoResult({ deletedCount: 'x', skippedByReason: 'nope' }).deleted).toBe(0);
  });

  it('drops zero-count reasons instead of listing them', () => {
    const s = summarizeUndoResult({ deletedCount: 1, skippedCount: 1, skippedByReason: { INSTALLED: 1, FAILED: 0 } });
    expect(s.reasons).toHaveLength(1);
  });
});

describe('undoConfirmationMessage', () => {
  it('names the batch and states the limit before anything is removed', () => {
    const message = undoConfirmationMessage({ id: 12, batchRef: 'ABA-2026-09-24-001', totalRows: 120 });
    expect(message).toContain('ABA-2026-09-24-001');
    expect(message).toContain('120 rows');
    expect(message).toContain('already installed, exported, in progress or dispatched to an installer is kept');
  });

  it('falls back to the file name, then the id, rather than showing nothing', () => {
    expect(undoConfirmationMessage({ id: 7, fileName: 'aba-meters.xlsx' })).toContain('aba-meters.xlsx');
    expect(undoConfirmationMessage({ id: 7 })).toContain('batch 7');
  });
});
