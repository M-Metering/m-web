// The holder index and the capacity check take one request (2026-11-04); they
// used to open every open batch. An API without the endpoint still works.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import jedApi from '../../components/services/api';
import { loadMeterHolders } from '../useMeterHolders';
import { loadInstallerMeterCapacity } from '../useInstallerMeterCapacity';

vi.mock('../../components/services/api', () => ({
  default: {
    getMeterHolders: vi.fn(),
    getAssignmentBatches: vi.fn(),
    getAssignmentBatch: vi.fn(),
    getInstallations: vi.fn(),
    clearCache: vi.fn(),
  },
}));
vi.mock('../../components/contexts/DataRefreshContext', () => ({ useDataRefresh: () => ({ refreshSignal: 0 }) }));

const row = {
  meterNumber: '0239110211103', assignmentStatus: 'ASSIGNED', phaseType: 'SINGLE PHASE', assignedAt: '2026-11-01T10:00:00Z',
  installerId: 'u1', installerName: 'Ada', batchId: 7, batchRef: 'MB-7', discoCode: 'PHEDC',
};
const missing = Object.assign(new Error('NOT_FOUND:Route not found'), { status: 404 });
const page = (data) => ({ data, pagination: { hasNext: false } });

beforeEach(() => {
  vi.clearAllMocks();
  jedApi.getInstallations.mockResolvedValue(page([
    { id: 1, status: 'ASSIGNED', meterType: 'SINGLE PHASE' },
    { id: 2, status: 'ASSIGNED', meterType: 'SINGLE PHASE' },
  ]));
});

describe('loadMeterHolders', () => {
  it('takes one request, and opens no batches', async () => {
    jedApi.getMeterHolders.mockResolvedValue({ data: [row] });
    const holders = await loadMeterHolders();
    expect(jedApi.getMeterHolders).toHaveBeenCalledTimes(1);
    expect(jedApi.getAssignmentBatch).not.toHaveBeenCalled();
    expect(holders.get('0239110211103')).toMatchObject({ installerId: 'u1', installerName: 'Ada', batchRef: 'MB-7', discoCode: 'PHEDC', phaseType: 'SINGLE PHASE' });
  });

  it('falls back to reading batches when the API has no such endpoint', async () => {
    jedApi.getMeterHolders.mockRejectedValue(missing);
    jedApi.getAssignmentBatches.mockImplementation(async ({ status }) => page(
      status === 'ACTIVE' ? [{ id: 7, status: 'ACTIVE', installerId: 'u1', installerName: 'Ada', batchRef: 'MB-7' }] : []
    ));
    jedApi.getAssignmentBatch.mockResolvedValue({ data: { id: 7, items: [{ meterNumber: '0239110211103', assignmentStatus: 'ASSIGNED', phaseType: 'SINGLE PHASE' }] } });
    const holders = await loadMeterHolders();
    expect(holders.get('0239110211103').installerName).toBe('Ada');
  });

  it('does not hide a real failure behind the fallback', async () => {
    jedApi.getMeterHolders.mockRejectedValue(Object.assign(new Error('SERVER_ERROR:Boom'), { status: 500 }));
    await expect(loadMeterHolders()).rejects.toThrow('Boom');
    expect(jedApi.getAssignmentBatches).not.toHaveBeenCalled();
  });
});

describe('loadInstallerMeterCapacity', () => {
  const scope = { installerId: 'u1', discoCode: 'PHEDC' };

  it('reads held meters from the holders endpoint, scoped to the installer and disco', async () => {
    jedApi.getMeterHolders.mockResolvedValue({ data: [row] });
    const capacity = await loadInstallerMeterCapacity(scope);
    expect(jedApi.getMeterHolders).toHaveBeenCalledWith(scope);
    expect(jedApi.getAssignmentBatches).not.toHaveBeenCalled();
    expect(capacity.byPhase['SINGLE PHASE']).toMatchObject({ assigned: 1 });
  });

  it('gives the same figures through the fallback', async () => {
    jedApi.getMeterHolders.mockRejectedValue(missing);
    jedApi.getAssignmentBatches.mockResolvedValue(page([{ id: 7, status: 'ACTIVE' }]));
    jedApi.getAssignmentBatch.mockResolvedValue({ data: { items: [{ meterNumber: '0239110211103', assignmentStatus: 'ASSIGNED', phaseType: 'SINGLE PHASE' }] } });
    const capacity = await loadInstallerMeterCapacity(scope);
    expect(capacity.byPhase['SINGLE PHASE']).toMatchObject({ assigned: 1 });
  });
});
