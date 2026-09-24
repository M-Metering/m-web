// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ReportInstallationModal from '../ReportInstallationModal';
import jedApi from '../../services/api';

vi.mock('../../services/api', () => ({
  default: { getMyMeters: vi.fn(), reportInstallation: vi.fn() },
}));

const job = { id: 7, accountNumber: '0100', customerName: 'ADA OBI', meterType: 'SINGLE PHASE' };

beforeEach(() => {
  vi.clearAllMocks();
  jedApi.getMyMeters.mockResolvedValue({
    success: true,
    data: [{ id: 1, meterNumber: '0239110006909', phaseType: 'SINGLE PHASE', assignmentStatus: 'ASSIGNED' }],
    pagination: { hasNext: false },
  });
  jedApi.reportInstallation.mockResolvedValue({ success: true });
});
afterEach(cleanup);

const open = async (onReported = vi.fn()) => {
  render(<ReportInstallationModal job={job} isOpen onClose={vi.fn()} onReported={onReported} />);
  await waitFor(() => expect(screen.getByRole('option', { name: /0239110006909/ })).toBeTruthy());
  fireEvent.change(screen.getByLabelText(/Meter installed/), { target: { value: '0239110006909' } });
  return onReported;
};

describe('ReportInstallationModal — seal number', () => {
  it('is marked required', async () => {
    await open();
    const seal = screen.getByLabelText(/Seal number/);
    expect(seal.getAttribute('aria-required')).toBe('true');
    expect(screen.getByText('Seal number').parentElement.textContent).toMatch(/\*/);
  });

  it.each(['', '   '])('blocks submission when the seal is %j', async (value) => {
    await open();
    fireEvent.change(screen.getByLabelText(/Seal number/), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: /Submit installation/ }));
    expect(await screen.findByText('Seal number is required.')).toBeTruthy();
    expect(jedApi.reportInstallation).not.toHaveBeenCalled();
  });

  it('submits a trimmed seal number', async () => {
    const onReported = await open();
    fireEvent.change(screen.getByLabelText(/Seal number/), { target: { value: '  APLE0099123 ' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit installation/ }));
    await waitFor(() => expect(jedApi.reportInstallation).toHaveBeenCalledWith(7, expect.objectContaining({
      meterNumber: '0239110006909', sealNumber: 'APLE0099123',
    })));
    expect(onReported).toHaveBeenCalled();
  });
});
