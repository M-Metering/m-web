// @vitest-environment jsdom
// The installation photo: take one with the camera OR pick an existing one,
// both through the same validation and the same POST /uploads.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import PhotoUploadField from '../PhotoUploadField';
import jedApi from '../../services/api';
import { prepareUploadImage } from '../../../utils/imageCompression';

vi.mock('../../services/api', () => ({
  default: { uploadFiles: vi.fn(), deleteUploadedFile: vi.fn() },
}));
// The canvas work is covered in utils/__tests__/imageCompression.test.js; here
// only its result matters. Default: pass the file through untouched.
vi.mock('../../../utils/imageCompression', () => ({ prepareUploadImage: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  prepareUploadImage.mockImplementation(async (file) => file);
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

  it("loads the stored photo's thumbnail in CORS mode, so the API's CORP header can't block it", async () => {
    render(<PhotoUploadField id="p" value="https://api.memetering.com/api/v1/files/0c0ffee0-0000-4000-8000-000000000001" onChange={vi.fn()} />);
    expect(screen.getByAltText('Installation photo').getAttribute('crossorigin')).toBe('anonymous');
  });

  it('applies the same validation to a gallery pick as to a camera shot', async () => {
    renderField();
    const pdf = new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Installation photo'), { target: { files: [pdf] } });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(jedApi.uploadFiles).not.toHaveBeenCalled();
  });

  it('uploads the resized copy of an oversized camera photo, not the original', async () => {
    const big = new File([new Uint8Array(9 * 1024 * 1024)], 'IMG_1.jpg', { type: 'image/jpeg' });
    const resized = new File([new Uint8Array(900 * 1024)], 'IMG_1.jpg', { type: 'image/jpeg' });
    prepareUploadImage.mockResolvedValue(resized);
    const onChange = renderField();
    fireEvent.change(screen.getByLabelText('Take a photo'), { target: { files: [big] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://api.example/files/abc'));
    expect(jedApi.uploadFiles.mock.calls[0][0]).toEqual([resized]);
  });

  it('refuses a photo compression could not bring to 5 MB, without a request', async () => {
    const big = new File([new Uint8Array(9 * 1024 * 1024)], 'IMG_1.jpg', { type: 'image/jpeg' });
    renderField();
    fireEvent.change(screen.getByLabelText('Take a photo'), { target: { files: [big] } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn't be reduced to 5 MB/);
    expect(jedApi.uploadFiles).not.toHaveBeenCalled();
  });

  it("sends the photo's location only when both coordinates are valid", async () => {
    const { rerender } = render(<PhotoUploadField id="p" value="" onChange={vi.fn()} coordinates={{ latitude: '5.1066', longitude: '7.' }} />);
    fireEvent.change(screen.getByLabelText('Choose a photo from the gallery'), { target: { files: [jpeg()] } });
    await waitFor(() => expect(jedApi.uploadFiles).toHaveBeenCalledTimes(1));
    expect(jedApi.uploadFiles.mock.calls[0][1]).not.toHaveProperty('latitude');
    expect(jedApi.uploadFiles.mock.calls[0][1]).not.toHaveProperty('longitude');

    rerender(<PhotoUploadField id="p" value="" onChange={vi.fn()} coordinates={{ latitude: ' 5.1066', longitude: '7.3667 ' }} />);
    fireEvent.change(screen.getByLabelText('Choose a photo from the gallery'), { target: { files: [jpeg()] } });
    await waitFor(() => expect(jedApi.uploadFiles).toHaveBeenCalledTimes(2));
    expect(jedApi.uploadFiles.mock.calls[1][1]).toMatchObject({ latitude: 5.1066, longitude: 7.3667 });
  });

  it('on a failed upload reports it and supplies no link at all — no pasted-link stand-in', async () => {
    const err = Object.assign(new Error('File storage not configured'), { status: 503 });
    jedApi.uploadFiles.mockRejectedValue(err);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onChange = renderField();
    fireEvent.change(screen.getByLabelText('Installation photo'), { target: { files: [jpeg()] } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/unavailable/i);
    expect(alert.textContent).not.toMatch(/storage not configured/i);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
