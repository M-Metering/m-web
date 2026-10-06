// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ReportInstallationModal from '../ReportInstallationModal';
import jedApi from '../../services/api';

vi.mock('../../services/api', () => ({
  default: { getMyMeters: vi.fn(), reportInstallation: vi.fn(), uploadFiles: vi.fn(), deleteUploadedFile: vi.fn() },
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
  jedApi.uploadFiles.mockResolvedValue({ success: true, data: [{ id: 51, url: 'https://api.memetering.com/api/v1/files/0c0ffee0-0000-4000-8000-000000000001' }] });
});

const PHOTO_URL = 'https://api.memetering.com/api/v1/files/0c0ffee0-0000-4000-8000-000000000001';
// Everything the form requires besides meter and seal: GPS, a photo uploaded
// through the real field, and the DISCO supervisor.
const fillRequired = async ({ gps = true, photo = true, supervisor = true } = {}) => {
  if (gps) {
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '5.106600' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '7.366700' } });
  }
  if (photo) {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'site.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Choose a photo from the gallery'), { target: { files: [file] } });
    await screen.findByText('Photo attached');
  }
  if (supervisor) fireEvent.change(screen.getByLabelText(/DISCO supervisor/), { target: { value: ' Engr. Okafor ' } });
};
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
    await fillRequired();
    fireEvent.change(screen.getByLabelText(/Seal number/), { target: { value: '  APLE0099123 ' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit installation/ }));
    await waitFor(() => expect(jedApi.reportInstallation).toHaveBeenCalledWith(7, expect.objectContaining({
      meterNumber: '0239110006909', sealNumber: 'APLE0099123',
    })));
    expect(onReported).toHaveBeenCalled();
  });
});

describe('ReportInstallationModal — every required field', () => {
  const submit = () => fireEvent.click(screen.getByRole('button', { name: /Submit installation/ }));
  const seal = () => fireEvent.change(screen.getByLabelText(/Seal number/), { target: { value: 'APLE0099123' } });

  it('submits the complete documented body when everything is present', async () => {
    await open();
    seal();
    await fillRequired();
    submit();
    await waitFor(() => expect(jedApi.reportInstallation).toHaveBeenCalledWith(7, expect.objectContaining({
      meterNumber: '0239110006909', sealNumber: 'APLE0099123', latitude: 5.1066, longitude: 7.3667,
      installationPhotoUrl: PHOTO_URL, discoSupervisor: 'Engr. Okafor',
    })));
  });

  it.each([
    ['GPS coordinates', { gps: false }, /GPS coordinates are required/],
    ['the installation picture', { photo: false }, /An installation picture is required/],
    ['the DISCO supervisor', { supervisor: false }, /DISCO supervisor is required/],
  ])('blocks submission without %s — nothing is sent, the job stays incomplete', async (_label, missing, message) => {
    await open();
    seal();
    await fillRequired(missing);
    submit();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(jedApi.reportInstallation).not.toHaveBeenCalled();
  });

  it('rejects malformed or (0, 0) coordinates', async () => {
    await open();
    seal();
    await fillRequired({ gps: false });
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '0' } });
    submit();
    expect(await screen.findByText(/not a real location/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '5.1.2' } });
    submit();
    expect(await screen.findByText(/Latitude must be between/)).toBeTruthy();
    expect(jedApi.reportInstallation).not.toHaveBeenCalled();
  });

  it('marks the GPS, picture and supervisor fields required', async () => {
    await open();
    expect(screen.getByLabelText('Latitude').getAttribute('aria-required')).toBe('true');
    expect(screen.getByLabelText(/DISCO supervisor/).getAttribute('aria-required')).toBe('true');
    expect(screen.getByText('Installation photo').parentElement.textContent).toMatch(/\*/);
  });

  it('a failed submission reports the error and does not close as done', async () => {
    const onReported = await open();
    jedApi.reportInstallation.mockRejectedValue(new Error('SERVER_ERROR:boom'));
    seal();
    await fillRequired();
    submit();
    expect(await screen.findByText(/Could not submit this installation/)).toBeTruthy();
    expect(onReported).not.toHaveBeenCalled();
  });
});

describe('ReportInstallationModal — a failed photo upload', () => {
  it('keeps everything already entered, blocks submission, and lets the installer retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    jedApi.uploadFiles.mockRejectedValueOnce(Object.assign(new Error('Upload failed: 500'), { status: 500 }));
    const onReported = await open();
    fireEvent.change(screen.getByLabelText(/Seal number/), { target: { value: 'APLE0099123' } });
    await fillRequired({ photo: false });

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'site.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Choose a photo from the gallery'), { target: { files: [file] } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/rejected by the server/);

    // Nothing the installer typed was lost.
    expect(screen.getByLabelText(/Meter installed/).value).toBe('0239110006909');
    expect(screen.getByLabelText(/Seal number/).value).toBe('APLE0099123');
    expect(screen.getByLabelText('Latitude').value).toBe('5.106600');
    expect(screen.getByLabelText(/DISCO supervisor/).value).toBe(' Engr. Okafor ');

    // No picture, no report.
    fireEvent.click(screen.getByRole('button', { name: /Submit installation/ }));
    expect(await screen.findByText(/An installation picture is required/)).toBeTruthy();
    expect(jedApi.reportInstallation).not.toHaveBeenCalled();

    // Retry succeeds and the report goes through with the stored link.
    fireEvent.change(screen.getByLabelText('Choose a photo from the gallery'), { target: { files: [file] } });
    await screen.findByText('Photo attached');
    fireEvent.click(screen.getByRole('button', { name: /Submit installation/ }));
    await waitFor(() => expect(jedApi.reportInstallation).toHaveBeenCalledWith(7, expect.objectContaining({ installationPhotoUrl: PHOTO_URL })));
    expect(onReported).toHaveBeenCalled();
  });
});

describe('ReportInstallationModal — per-disco rules (2026-10-05)', () => {
  const submit = () => fireEvent.click(screen.getByRole('button', { name: /Submit installation/ }));
  const seal = () => fireEvent.change(screen.getByLabelText(/Seal number/), { target: { value: 'APLE0099123' } });

  it('a meter from another disco’s stock is refused on the meter field, and nothing is closed', async () => {
    const onReported = await open();
    jedApi.reportInstallation.mockRejectedValue(new Error(
      "VALIDATION_ERROR:That meter belongs to a different disco's stock than this installation"
    ));
    seal();
    await fillRequired();
    submit();
    expect((await screen.findAllByText(/belongs to a different disco's stock/)).length).toBeGreaterThan(0);
    expect(onReported).not.toHaveBeenCalled();
  });

  it('a PHEDC job with no meter type (and no phone) is not blocked: any held meter can be reported', async () => {
    jedApi.getMyMeters.mockResolvedValue({
      success: true,
      data: [
        { id: 1, meterNumber: '0239110006909', phaseType: 'SINGLE PHASE', assignmentStatus: 'ASSIGNED' },
        { id: 2, meterNumber: '0239110006917', phaseType: 'THREE PHASE', assignmentStatus: 'ASSIGNED' },
      ],
      pagination: { hasNext: false },
    });
    const untyped = { id: 9, accountNumber: '877253168101D', customerName: 'OKORO N', discoCode: 'PHEDC', meterType: null, customerPhone: null };
    render(<ReportInstallationModal job={untyped} isOpen onClose={vi.fn()} onReported={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('option', { name: /0239110006917/ })).toBeTruthy());
    expect(screen.getByRole('option', { name: /0239110006909/ })).toBeTruthy();
    expect(screen.getByText(/no meter type set — fit either type/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Meter installed/), { target: { value: '0239110006917' } });
    seal();
    await fillRequired();
    submit();
    await waitFor(() => expect(jedApi.reportInstallation).toHaveBeenCalledWith(9, expect.objectContaining({ meterNumber: '0239110006917' })));
  });
});
