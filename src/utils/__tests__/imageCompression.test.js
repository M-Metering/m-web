// Bringing an installation photo within the API's 5 MB before POST /uploads. The
// browser's decode and encode are injected, so these pin the decisions, not
// the canvas.
import { describe, it, expect, vi } from 'vitest';
import {
  scaledDimensions, needsCompression, prepareUploadImage, MAX_DIMENSION, MIN_DIMENSION,
} from '../imageCompression';
import { MAX_PHOTO_SIZE_BYTES } from '../fileUpload';

const KB = 1024;
const MB = 1024 * KB;
const fileOf = (bytes, type = 'image/jpeg', name = 'IMG_2041.JPG') =>
  new File([new Uint8Array(bytes)], name, { type });
const blobOf = (bytes) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
const decode = () => vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() }));

describe('scaledDimensions', () => {
  it('caps the longest side and keeps the aspect ratio', () => {
    expect(scaledDimensions(4000, 3000)).toEqual({ width: MAX_DIMENSION, height: 1536 });
    expect(scaledDimensions(3000, 4000, MIN_DIMENSION)).toEqual({ width: 1200, height: MIN_DIMENSION });
  });

  it('leaves an image already within the cap alone', () => {
    expect(scaledDimensions(1600, 1200)).toEqual({ width: 1600, height: 1200 });
  });
});

describe('needsCompression', () => {
  it('for an accepted image type over 5 MB, and for HEIC at any size', () => {
    expect(needsCompression(fileOf(MAX_PHOTO_SIZE_BYTES + 1))).toBe(true);
    expect(needsCompression(fileOf(MAX_PHOTO_SIZE_BYTES))).toBe(false);
    expect(needsCompression(fileOf(300 * KB, 'image/heic', 'a.heic'))).toBe(true);
    expect(needsCompression(fileOf(6 * MB, 'application/pdf', 'a.pdf'))).toBe(false);
    expect(needsCompression(null)).toBe(false);
  });
});

describe('prepareUploadImage', () => {
  it('sends a photo already within 5 MB byte for byte, without decoding it — a typical camera shot included', async () => {
    for (const bytes of [900 * KB, 3.8 * MB, MAX_PHOTO_SIZE_BYTES]) {
      const photo = fileOf(bytes);
      const spy = vi.fn();
      expect(await prepareUploadImage(photo, { decode: spy })).toBe(photo);
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('turns a 12 MB camera shot into a JPEG of at most 5 MB at full legible size', async () => {
    const encode = vi.fn(async () => blobOf(2.5 * MB));
    const result = await prepareUploadImage(fileOf(12 * MB), { decode: decode(), encode });
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('IMG_2041.jpg');
    expect(result.size).toBeLessThanOrEqual(MAX_PHOTO_SIZE_BYTES);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode.mock.calls[0][1]).toEqual({ width: MAX_DIMENSION, height: 1536 });
    expect(encode.mock.calls[0][2]).toBe(0.85);
  });

  it('lowers quality before size, and never goes below the legible minimum', async () => {
    const encode = vi.fn(async () => blobOf(6 * MB));
    const original = fileOf(20 * MB);
    await prepareUploadImage(original, { decode: decode(), encode });
    const attempts = encode.mock.calls.map(([, size, quality]) => ({ side: Math.max(size.width, size.height), quality }));
    // Quality steps down at full size first…
    expect(attempts.slice(0, 3).every((a) => a.side === MAX_DIMENSION)).toBe(true);
    expect(attempts[1].quality).toBeLessThan(attempts[0].quality);
    // …then the size drops, but never below MIN_DIMENSION.
    expect(Math.min(...attempts.map((a) => a.side))).toBe(MIN_DIMENSION);
  });

  it('uses the first attempt that fits', async () => {
    const encode = vi.fn()
      .mockResolvedValueOnce(blobOf(6 * MB))
      .mockResolvedValueOnce(blobOf(4.5 * MB));
    const result = await prepareUploadImage(fileOf(9 * MB), { decode: decode(), encode });
    expect(encode).toHaveBeenCalledTimes(2);
    expect(result.size).toBe(4.5 * MB);
  });

  it('returns the original — for the size check to refuse — when no legible copy fits', async () => {
    const original = fileOf(20 * MB);
    const encode = vi.fn(async () => blobOf(5.5 * MB));
    expect(await prepareUploadImage(original, { decode: decode(), encode })).toBe(original);
  });

  it('converts a HEIC photo to JPEG when the browser can decode it', async () => {
    const encode = vi.fn(async () => blobOf(400 * KB));
    const result = await prepareUploadImage(fileOf(2 * MB, 'image/heic', 'IMG_9.HEIC'), { decode: decode(), encode });
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('IMG_9.jpg');
  });

  it('returns the original when the browser cannot decode the image', async () => {
    const original = fileOf(300 * KB, 'image/heic', 'IMG_9.HEIC');
    const failing = vi.fn(async () => { throw new Error('decode failed'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await prepareUploadImage(original, { decode: failing, encode: vi.fn() })).toBe(original);
  });
});
