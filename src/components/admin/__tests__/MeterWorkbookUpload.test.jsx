// @vitest-environment jsdom
// POST /meters/upload requires `discoCode` next to `file` since 2026-10-05
// (400 "discoCode is required" otherwise); the meters join that disco's stock.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect, useState } from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import MeterWorkbookUpload from '../MeterWorkbookUpload';
import jedApi from '../../services/api';

let currentUser;
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: currentUser }),
  useOptionalAuth: () => ({ user: currentUser, refreshUser: vi.fn() }),
}));
vi.mock('../../services/api', () => ({
  default: { clearCache: vi.fn(), getDiscos: vi.fn(), uploadMeters: vi.fn(), downloadMetersTemplate: vi.fn() },
}));

const ABA = { code: 'ABA_POWER', name: 'Aba Power Limited Electric' };
const PHEDC = { code: 'PHEDC', name: 'Port Harcourt Electricity Distribution Company' };
const NO_DISCOS = [];
const file = () => new File(['x'], 'meters.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

const renderUpload = () => {
  const onUploaded = vi.fn();
  function Harness() {
    const discos = currentUser?.discos || NO_DISCOS;
    const [discoCode, setDiscoCode] = useState('');
    useEffect(() => {
      if (!discoCode && discos.length > 0) setDiscoCode(discos[0].code);
    }, [discos, discoCode]);
    return (
      <MeterWorkbookUpload
        discos={discos}
        discosLoading={false}
        discosError={null}
        noAccess={discos.length === 0}
        discoCode={discoCode}
        onDiscoChange={setDiscoCode}
        onUploaded={onUploaded}
      />
    );
  }
  render(<Harness />);
  return { onUploaded };
};

beforeEach(() => {
  vi.clearAllMocks();
  jedApi.uploadMeters.mockResolvedValue({ success: true, data: { totalRows: 1, created: 1, failed: 0, errors: [] } });
});
afterEach(cleanup);

describe('Upload meters — disco', () => {
  it("sends the chosen disco as discoCode, from the admin's own discos (no GET /discos)", async () => {
    currentUser = { id: 'a', role: 'ADMIN', discos: [ABA, PHEDC] };
    const { onUploaded } = renderUpload();
    const select = screen.getByLabelText(/Disco/);
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'ABA_POWER', 'PHEDC']);
    fireEvent.change(select, { target: { value: 'PHEDC' } });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file()] } });
    fireEvent.click(screen.getByRole('button', { name: /^Upload$/ }));
    await waitFor(() => expect(jedApi.uploadMeters).toHaveBeenCalled());
    const form = jedApi.uploadMeters.mock.calls[0][0];
    expect(form.get('discoCode')).toBe('PHEDC');
    expect(form.get('file')).toBeTruthy();
    expect(onUploaded).toHaveBeenCalledOnce();
    expect(jedApi.clearCache).toHaveBeenCalledOnce();
    expect(jedApi.getDiscos).not.toHaveBeenCalled();
  });

  it('pre-selects the only disco', async () => {
    currentUser = { id: 'a', role: 'ADMIN', discos: [ABA] };
    renderUpload();
    await waitFor(() => expect(screen.getByLabelText(/Disco/).value).toBe('ABA_POWER'));
  });

  it('is closed to a Supervisor (the API now answers 403)', () => {
    currentUser = { id: 's', role: 'SUPERVISOR', discos: [ABA] };
    renderUpload();
    expect(screen.getByText('Access Denied')).toBeTruthy();
  });

  it('tells a user with no disco to ask a super admin', () => {
    currentUser = { id: 'a', role: 'ADMIN', discos: [] };
    renderUpload();
    expect(screen.getByText('Ask a super admin to give you access to a disco.')).toBeTruthy();
  });
});
