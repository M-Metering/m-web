// @vitest-environment jsdom
// The installation photo: take one with the camera OR pick an existing one,
// both through the same validation and the same POST /uploads.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import PhotoUploadField from '../PhotoUploadField';
import jedApi from '../../services/api';
import { prepareUploadImage } from '../../../utils/imageCompression';
import { RETRY_PHOTO_SIZE_BYTES } from '../../../utils/fileUpload';

vi.mock('../../services/api', () => ({
  default: { uploadFiles: vi.fn(), deleteUploadedFile: vi.fn() },
}));
// The canvas work is covered in utils/__tests__/imageCompression.test.js; here
// only its result matters. Default: a photo within the limit, passed through.
vi.mock('../../../utils/imageCompression', () => ({ prepareUploadImage: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  prepareUploadImage.mockImplementation(async (file) => ({ file, outcome: 'unchanged' }));
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

  it("shows the stored photo as a plain <img> — never CORS mode, which the storage bucket doesn't support", async () => {
    render(<PhotoUploadField id="p" value="https://api.memetering.com/api/v1/files/0c0ffee0-0000-4000-8000-000000000001" onChange={vi.fn()} />);
    expect(screen.getByAltText('Installation photo').hasAttribute('crossorigin')).toBe(false);
  });

  it('keeps "Photo attached" and shows a neutral tile when the preview itself cannot load', async () => {
    render(<PhotoUploadField id="p" value="https://api.memetering.com/api/v1/files/0c0ffee0-0000-4000-8000-000000000001" onChange={vi.fn()} />);
    fireEvent.error(screen.getByAltText('Installation photo'));
    expect(screen.getByRole('img', { name: /preview unavailable/ })).toBeTruthy();
    expect(screen.getByText('Photo attached')).toBeTruthy();
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
    prepareUploadImage.mockResolvedValue({ file: resized, outcome: 'compressed' });
    const onChange = renderField();
    fireEvent.change(screen.getByLabelText('Take a photo'), { target: { files: [big] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://api.example/files/abc'));
    expect(jedApi.uploadFiles.mock.calls[0][0]).toEqual([resized]);
  });

  it('refuses a photo compression could not bring within the limit, without a request', async () => {
    const big = new File([new Uint8Array(9 * 1024 * 1024)], 'IMG_1.jpg', { type: 'image/jpeg' });
    prepareUploadImage.mockImplementation(async (file) => ({ file, outcome: 'too-large' }));
    renderField();
    fireEvent.change(screen.getByLabelText('Take a photo'), { target: { files: [big] } });
    expect((await screen.findByRole('alert')).textContent).toBe('Image could not be reduced to the required size. Please choose another image.');
    expect(jedApi.uploadFiles).not.toHaveBeenCalled();
  });

  it('says the image could not be processed when the browser cannot read it', async () => {
    prepareUploadImage.mockImplementation(async (file) => ({ file, outcome: 'unprocessable' }));
    renderField();
    fireEvent.change(screen.getByLabelText('Take a photo'), { target: { files: [jpeg()] } });
    expect((await screen.findByRole('alert')).textContent).toBe('Unable to process this image. Choose another photo.');
    expect(jedApi.uploadFiles).not.toHaveBeenCalled();
  });

  it('shows Processing, then Uploading, and reports itself busy until done', async () => {
    let finishPrepare; let finishUpload;
    prepareUploadImage.mockImplementation((file) => new Promise((r) => { finishPrepare = () => r({ file, outcome: 'unchanged' }); }));
    jedApi.uploadFiles.mockImplementation(() => new Promise((r) => { finishUpload = () => r({ success: true, data: [{ id: 7, url: 'https://api.example/files/abc' }] }); }));
    const onBusyChange = vi.fn();
    const Harness = () => {
      const [url, setUrl] = useState('');
      return <PhotoUploadField id="p" value={url} onChange={setUrl} onBusyChange={onBusyChange} />;
    };
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Choose a photo from the gallery'), { target: { files: [jpeg()] } });
    expect(await screen.findByText('Processing image…')).toBeTruthy();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    finishPrepare();
    expect(await screen.findByText('Uploading image…')).toBeTruthy();
    finishUpload();
    // Idle is reported together with the result, not a render later.
    await screen.findByText('Photo attached');
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it.each([['dropped', 'NETWORK'], ['timed out', 'UPLOAD_TIMEOUT']])('retries ONCE, smaller, when a photo over ~1 MB upload is %s', async (_label, code) => {
    const twoMb = new File([new Uint8Array(2 * 1024 * 1024)], 'IMG_2.jpg', { type: 'image/jpeg' });
    const small = new File([new Uint8Array(900 * 1024)], 'IMG_2.jpg', { type: 'image/jpeg' });
    prepareUploadImage.mockImplementation(async (file, opts) => (opts?.maxBytes === RETRY_PHOTO_SIZE_BYTES
      ? { file: small, outcome: 'compressed' } : { file, outcome: 'unchanged' }));
    jedApi.uploadFiles
      .mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { code }))
      .mockResolvedValueOnce({ success: true, data: [{ id: 9, url: 'https://api.example/files/small' }] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onChange = renderField();
    fireEvent.change(screen.getByLabelText('Take a photo'), { target: { files: [twoMb] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://api.example/files/small'));
    expect(jedApi.uploadFiles).toHaveBeenCalledTimes(2);
    expect(jedApi.uploadFiles.mock.calls[0][0]).toEqual([twoMb]);
    expect(jedApi.uploadFiles.mock.calls[1][0]).toEqual([small]);
  });

  it.each([
    ['a timeout on a small photo', { code: 'UPLOAD_TIMEOUT' }, 500 * 1024, 'Image upload failed. Check your connection and try again.'],
    ['a dropped connection on a small photo', { code: 'NETWORK' }, 500 * 1024, 'Image upload failed. Check your connection and try again.'],
    ['a server refusal', { status: 500 }, 2 * 1024 * 1024, 'Image upload was rejected by the server. Please try again.'],
  ])('does not retry after %s, and says what happened', async (_label, errProps, bytes, message) => {
    const photo = new File([new Uint8Array(bytes)], 'IMG_3.jpg', { type: 'image/jpeg' });
    jedApi.uploadFiles.mockRejectedValue(Object.assign(new Error('x'), errProps));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onChange = renderField();
    fireEvent.change(screen.getByLabelText('Take a photo'), { target: { files: [photo] } });
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(jedApi.uploadFiles).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
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
