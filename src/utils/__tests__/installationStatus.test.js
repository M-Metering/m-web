import { describe, it, expect } from 'vitest';
import { getAvailableActions } from '../installationStatus';

describe('getAvailableActions — revert (undo a completed installation)', () => {
  it('only an INSTALLED job can be reverted; an EXPORTED one was already reported to the disco', () => {
    expect(getAvailableActions('INSTALLED').revert).toBe(true);
    ['EXPORTED', 'PENDING', 'ASSIGNED', 'IN_PROGRESS', 'FAILED', 'CANCELLED'].forEach((s) => {
      expect(getAvailableActions(s).revert).toBe(false);
    });
  });
});
