// @vitest-environment jsdom
// The installation photo: take one with the camera OR pick an existing one,
// both through the same validation and the same POST /uploads.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import PhotoUploadField from '../PhotoUploadField';
import jedApi from '../../services/api';

vi.mock('../../services/api', () => ({
  default: { uploadFiles: vi.fn(), deleteUploadedFile: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  jedApi.uploadFiles.mockResolvedValue({
    success: true, data: [{ id: 7, url: 'https://api.example/files/abc' }],
  });
});
afterEach(cleanup);

const renderField = (onChange = vi.fn()) => {
  render(<><label htmlFor="photo">Installation photo</label><PhotoUploadField id="photo" value="" onChange={onChange} /></>);
  return onChange;
};
const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], 'site.jpg', { type: 'image/jpeg' });

describe('PhotoUploadField', () => {
  it('offers both Take photo and Choose from gallery', () => {
    renderField();
    expect(screen.getByRole('button', { name: /Take photo/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Choose from gallery/ })).toBeTruthy();
  });

  it('keeps the camera on one input and leaves the gallery input free of `capture`', () => {
    renderField();
    const camera = screen.getByLabelText('Take a photo');
    const gallery = screen.getByLabelText('Installation photo');
    expect(camera.getAttribute('capture')).toBe('environment');
    expect(gallery.hasAttribute('capture')).toBe(false);
    // Both accept images only, from the same shared rule.
    expect(gallery.getAttribute('accept')).toBe(camera.getAttribute('accept'));
    expect(gallery.getAttribute('accept')).toMatch(/image\/jpeg/);
  });

  it('uploads a photo chosen from the gallery through the existing API', async () => {
    const onChange = renderField();
    fireEvent.change(screen.getByLabelText('Installation photo'), { target: { files: [jpeg()] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://api.example/files/abc'));
    expect(jedApi.uploadFiles).toHaveBeenCalledTimes(1);
  });

  it('applies the same validation to a gallery pick as to a camera shot', async () => {
    renderField();
    const pdf = new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Installation photo'), { target: { files: [pdf] } });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(jedApi.uploadFiles).not.toHaveBeenCalled();
  });
});
