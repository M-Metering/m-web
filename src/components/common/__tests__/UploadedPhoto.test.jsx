// @vitest-environment jsdom
// An uploaded photo: CORS mode first (past the API's Cross-Origin-Resource-
// Policy), then a plain <img>, and only then report failure.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import UploadedPhoto from '../UploadedPhoto';

afterEach(cleanup);

const API_PHOTO = 'https://api.memetering.com/api/v1/files/0c0ffee0-0000-4000-8000-000000000001';
const img = () => screen.getByAltText('photo');

describe('UploadedPhoto', () => {
  it('asks for an API-hosted photo in CORS mode first', () => {
    render(<UploadedPhoto src={API_PHOTO} alt="photo" />);
    expect(img().getAttribute('crossorigin')).toBe('anonymous');
  });

  it('retries once as a plain <img> before reporting a failure', () => {
    const onError = vi.fn();
    render(<UploadedPhoto src={API_PHOTO} alt="photo" onError={onError} />);
    fireEvent.error(img());
    expect(img().hasAttribute('crossorigin')).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    fireEvent.error(img());
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('starts again in CORS mode for a new photo', () => {
    const { rerender } = render(<UploadedPhoto src={API_PHOTO} alt="photo" />);
    fireEvent.error(img());
    rerender(<UploadedPhoto src={API_PHOTO.replace('01', '02')} alt="photo" />);
    expect(img().getAttribute('crossorigin')).toBe('anonymous');
  });

  it('shows a photo hosted elsewhere as a plain <img>, failing straight to onError', () => {
    const onError = vi.fn();
    render(<UploadedPhoto src="https://drive.google.com/uc?id=abc" alt="photo" onError={onError} />);
    expect(img().hasAttribute('crossorigin')).toBe(false);
    fireEvent.error(img());
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
