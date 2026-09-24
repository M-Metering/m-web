import { describe, it, expect } from 'vitest';
import {
  normalizeStatus, isCompletedStatus, isAwaitingInstallationStatus,
  JED_STATUS_LABELS, jedStatusLabel,
} from '../statusBadge';

describe('JED status vocabulary — one name per state', () => {
  it('maps every real backend status, and only those three', () => {
    expect(Object.keys(JED_STATUS_LABELS).sort()).toEqual(['COMPLETED', 'INITIATED', 'PAID']);
  });

  it('calls PAID "Awaiting Installation" everywhere — it is a label, not a status', () => {
    expect(jedStatusLabel('PAID')).toBe('Awaiting Installation');
    expect(isAwaitingInstallationStatus('PAID')).toBe(true);
  });

  it('calls COMPLETED "Completed" — never "Paid & Completed" on one screen only', () => {
    expect(jedStatusLabel('COMPLETED')).toBe('Completed');
    expect(isCompletedStatus('COMPLETED')).toBe(true);
  });

  it('calls INITIATED "Awaiting Payment", and it is in neither installer queue', () => {
    expect(jedStatusLabel('INITIATED')).toBe('Awaiting Payment');
    expect(isAwaitingInstallationStatus('INITIATED')).toBe(false);
    expect(isCompletedStatus('INITIATED')).toBe(false);
  });

  it('is case-insensitive, matching what the API actually returns', () => {
    expect(jedStatusLabel('paid')).toBe('Awaiting Installation');
    expect(jedStatusLabel(' Completed ')).toBe('Completed');
    expect(normalizeStatus(' paid ')).toBe('PAID');
  });

  it('never invents a label for a status it does not know', () => {
    expect(jedStatusLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(jedStatusLabel('')).toBe('Unknown');
    expect(jedStatusLabel(null)).toBe('Unknown');
  });
});
