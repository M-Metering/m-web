// Shrinking an oversized photo before POST /uploads. The browser's decode and
// encode are injected, so these pin the decisions, not the canvas.
import { describe, it, expect, vi } from 'vitest';
import { scaledDimensions, needsCompression, prepareUploadImage, MAX_DIMENSION } from '../imageCompression';
import { MAX_FILE_SIZE_BYTES } from '../fileUpload';

const MB = 1024 * 1024;
const fileOf = (bytes, type = 'image/jpeg', name = 'IMG_2041.JPG') =>
  new File([new Uint8Array(bytes)], name, { type });
const blobOf = (bytes) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });

describe('scaledDimensions', () => {
  it('caps the longest side and keeps the aspect ratio', () => {
    expect(scaledDimensions(4000, 3000)).toEqual({ width: MAX_DIMENSION, height: 1920 });
    expect(scaledDimensions(3000, 4000)).toEqual({ width: 1920, height: MAX_DIMENSION });
  });

  it('leaves an image already within the cap alone', () => {
    expect(scaledDimensions(1600, 1200)).toEqual({ width: 1600, height: 1200 });
  });
});

describe('needsCompression', () => {
  it('only for an accepted image type over the limit', () => {
    expect(needsCompression(fileOf(MAX_FILE_SIZE_BYTES + 1))).toBe(true);
    expect(needsCompression(fileOf(MAX_FILE_SIZE_BYTES))).toBe(false);
    expect(needsCompression(fileOf(6 * MB, 'application/pdf', 'a.pdf'))).toBe(false);
    expect(needsCompression(fileOf(6 * MB, 'image/heic', 'a.heic'))).toBe(false);
    expect(needsCompression(null)).toBe(false);
  });
});

describe('prepareUploadImage', () => {
  const decode = vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() }));

  it('sends a file that already fits byte for byte, without decoding it', async () => {
    const small = fileOf(2 * MB);
    const spy = vi.fn();
    expect(await prepareUploadImage(small, { decode: spy })).toBe(small);
    expect(spy).not.toHaveBeenCalled();
  });

  it('turns a 9 MB camera shot into a JPEG copy under the limit', async () => {
    const encode = vi.fn(async () => blobOf(1.5 * MB));
    const result = await prepareUploadImage(fileOf(9 * MB), { decode, encode });
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('IMG_2041.jpg');
    expect(result.size).toBeLessThanOrEqual(MAX_FILE_SIZE_BYTES);
    // Drawn at the capped size.
    expect(encode.mock.calls[0][1]).toEqual({ width: MAX_DIMENSION, height: 1920 });
  });

  it('steps the quality down until the copy fits', async () => {
    const encode = vi.fn()
      .mockResolvedValueOnce(blobOf(6 * MB))
      .mockResolvedValueOnce(blobOf(3 * MB));
    const result = await prepareUploadImage(fileOf(9 * MB), { decode, encode });
    expect(encode).toHaveBeenCalledTimes(2);
    expect(encode.mock.calls[1][2]).toBeLessThan(encode.mock.calls[0][2]);
    expect(result.size).toBe(3 * MB);
  });

  it('returns the original — for the normal size check to refuse — when no copy fits', async () => {
    const original = fileOf(9 * MB);
    const encode = vi.fn(async () => blobOf(6 * MB));
    expect(await prepareUploadImage(original, { decode, encode })).toBe(original);
  });

  it('returns the original when the browser cannot decode the image', async () => {
    const original = fileOf(9 * MB);
    const failing = vi.fn(async () => { throw new Error('decode failed'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await prepareUploadImage(original, { decode: failing, encode: vi.fn() })).toBe(original);
  });
});
