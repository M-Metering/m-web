import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unassignActionFor, parseReturnResult, returnMetersToStock, UNASSIGN_KIND } from '../meterUnassign';
import { normalizeMultiRow, normalizeJedRow, JED_BUCKET } from '../installationScope';
import jedApi from '../../components/services/api';

vi.mock('../../components/services/api', () => ({ default: { returnMeters: vi.fn() } }));

const HOLDER = { installerId: 'u-1', installerName: 'John Doe', assignedAt: '2026-10-01T09:00:00Z', batchRef: 'B-1', phaseType: 'THREE PHASE' };
const HELD = { meterNumber: '0100001234', phaseType: '3 Phase', status: 'AVAILABLE' };
const INSTALLED_JOB = normalizeMultiRow({
  id: 9, accountNumber: '1009', customerName: 'DONE JOB', discoCode: 'ABA_POWER', status: 'INSTALLED',
  meterType: 'SINGLE PHASE', meterNumber: '0239110006909', installationDate: '2026-09-20',
});

describe('unassignActionFor — one rule for every screen', () => {
  it('a meter with an installer: RETURN, for a role with ASSIGNMENTS.MANAGE, naming meter, type and installer', () => {
    expect(unassignActionFor({ meter: HELD, holder: HOLDER, canReturn: true })).toEqual({
      kind: UNASSIGN_KIND.RETURN,
      target: { meterNumber: '0100001234', phaseType: 'THREE PHASE', installerName: 'John Doe', assignedAt: HOLDER.assignedAt, batchRef: 'B-1' },
    });
    expect(unassignActionFor({ meter: HELD, holder: HOLDER, canReturn: false, canRevert: true })).toBeNull();
  });

  it('an available meter has nothing to unassign', () => {
    expect(unassignActionFor({ meter: HELD, holder: null, canReturn: true, canRevert: true })).toBeNull();
  });

  it('an installed meter: REVERT for a Super Admin only, and only an INSTALLED imported job', () => {
    const meter = { meterNumber: '0239110006909', status: 'INSTALLED' };
    expect(unassignActionFor({ meter, installationRow: INSTALLED_JOB, canReturn: true, canRevert: false })).toBeNull();
    const action = unassignActionFor({ meter, installationRow: INSTALLED_JOB, canRevert: true });
    expect(action.kind).toBe(UNASSIGN_KIND.REVERT);
    expect(action.target.id).toBe(9);
    // Exported, JED, or no record found: the backend would refuse, so nothing is offered.
    expect(unassignActionFor({ meter, installationRow: normalizeMultiRow({ ...INSTALLED_JOB.raw, status: 'EXPORTED' }), canRevert: true })).toBeNull();
    expect(unassignActionFor({ meter, installationRow: normalizeJedRow({ accountNumber: '4', status: 'COMPLETED', meterNo: '0239110006909' }, JED_BUCKET), canRevert: true })).toBeNull();
    expect(unassignActionFor({ meter, installationRow: null, canRevert: true })).toBeNull();
  });

  it('a held meter is never offered the installed-meter revert', () => {
    expect(unassignActionFor({ meter: HELD, holder: HOLDER, installationRow: INSTALLED_JOB, canRevert: true })).toBeNull();
  });
});

describe('returnMetersToStock — the one release call', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends exactly { meterNumbers } as strings and reports what came back', async () => {
    jedApi.returnMeters.mockResolvedValue({ success: true, data: { returned: 1 } });
    expect(await returnMetersToStock(['0100001234'])).toEqual({ returned: ['0100001234'], rejected: [] });
    expect(jedApi.returnMeters).toHaveBeenCalledWith(['0100001234']);
  });

  it('a 2xx with success:false is a failure, not a return', async () => {
    jedApi.returnMeters.mockResolvedValue({ success: false, message: 'Meter is not assigned' });
    await expect(returnMetersToStock(['0100001234'])).rejects.toThrow('Meter is not assigned');
  });

  it('reads per-meter rejections (partial success)', () => {
    expect(parseReturnResult({ data: { rejected: [{ meterNumber: '2', reason: 'not assigned' }] } }, ['1', '2']))
      .toEqual({ returned: ['1'], rejected: [{ meterNumber: '2', reason: 'not assigned' }] });
  });
});
