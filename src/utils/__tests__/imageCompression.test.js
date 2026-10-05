// Bringing an installation photo within MAX_PHOTO_SIZE_BYTES (3.5 MiB) before
// POST /uploads. The browser's decode and encode are injected, so these pin the
// decisions, not the canvas (that is checked in a real browser).
import { describe, it, expect, vi } from 'vitest';
import {
  scaledDimensions, needsCompression, prepareUploadImage, MAX_DIMENSION, MIN_DIMENSION, COMPRESSION_ATTEMPTS,
} from '../imageCompression';
import { MAX_PHOTO_SIZE_BYTES, RETRY_PHOTO_SIZE_BYTES } from '../fileUpload';

const KB = 1024;
const MB = 1024 * KB;
const fileOf = (bytes, type = 'image/jpeg', name = 'IMG_2041.JPG') =>
  new File([new Uint8Array(bytes)], name, { type });
const blobOf = (bytes) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
const decode = (width = 4000, height = 3000) => vi.fn(async () => ({ width, height, close: vi.fn() }));

describe('the limit', () => {
  it('is 3.5 MiB, in bytes, and leaves 1.5 MB under the API’s 5 MB', () => {
    expect(MAX_PHOTO_SIZE_BYTES).toBe(3670016);
    expect(5 * MB - MAX_PHOTO_SIZE_BYTES).toBe(1.5 * MB);
  });
});

describe('scaledDimensions', () => {
  it('caps the longest side and keeps the aspect ratio', () => {
    expect(scaledDimensions(8000, 6000)).toEqual({ width: MAX_DIMENSION, height: 3024 });
    expect(scaledDimensions(3000, 4000, MIN_DIMENSION)).toEqual({ width: 1200, height: MIN_DIMENSION });
  });

  it('leaves an image already within the cap alone', () => {
    expect(scaledDimensions(4000, 3000)).toEqual({ width: 4000, height: 3000 });
  });

  it("never asks a phone browser for a canvas over its ~16.7 MP limit", () => {
    const { width, height } = scaledDimensions(9000, 9000);
    expect(width * height).toBeLessThan(16777216);
  });
});

describe('needsCompression', () => {
  it('for an accepted image type over 3.5 MiB, and for HEIC at any size', () => {
    expect(needsCompression(fileOf(MAX_PHOTO_SIZE_BYTES + 1))).toBe(true);
    expect(needsCompression(fileOf(MAX_PHOTO_SIZE_BYTES))).toBe(false);
    expect(needsCompression(fileOf(300 * KB, 'image/heic', 'a.heic'))).toBe(true);
    expect(needsCompression(fileOf(6 * MB, 'application/pdf', 'a.pdf'))).toBe(false);
    expect(needsCompression(null)).toBe(false);
  });
});

describe('prepareUploadImage', () => {
  it.each([500 * KB, 910 * KB, 1.5 * MB, 2 * MB, 3 * MB, MAX_PHOTO_SIZE_BYTES])(
    'sends a %d-byte photo unchanged, byte for byte, without decoding it',
    async (bytes) => {
      const photo = fileOf(bytes);
      const spy = vi.fn();
      expect(await prepareUploadImage(photo, { decode: spy })).toEqual({ file: photo, outcome: 'unchanged' });
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it.each([4 * MB, 5 * MB, 8 * MB])('compresses a %d-byte photo to at most 3.5 MiB, at full size first', async (bytes) => {
    const encode = vi.fn(async () => blobOf(2.6 * MB));
    const { file, outcome } = await prepareUploadImage(fileOf(bytes), { decode: decode(), encode });
    expect(outcome).toBe('compressed');
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('IMG_2041.jpg');
    expect(file.size).toBeLessThanOrEqual(MAX_PHOTO_SIZE_BYTES);
    // One pass was enough, at the photo's own 4000×3000 and the highest quality.
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode.mock.calls[0][1]).toEqual({ width: 4000, height: 3000 });
    expect(encode.mock.calls[0][2]).toBe(0.92);
  });

  it('re-checks after every pass: quality first, then size, never below the legible floor', async () => {
    const encode = vi.fn(async () => blobOf(4 * MB));
    await prepareUploadImage(fileOf(20 * MB), { decode: decode(8000, 6000), encode });
    expect(encode).toHaveBeenCalledTimes(COMPRESSION_ATTEMPTS.length);
    const sides = encode.mock.calls.map(([, size]) => Math.max(size.width, size.height));
    const qualities = encode.mock.calls.map(([, , q]) => q);
    expect(sides.slice(0, 3)).toEqual([MAX_DIMENSION, MAX_DIMENSION, MAX_DIMENSION]);
    expect(qualities[1]).toBeLessThan(qualities[0]);
    expect(Math.min(...sides)).toBe(MIN_DIMENSION);
    expect(Math.min(...qualities)).toBeGreaterThanOrEqual(0.6);
  });

  it('stops at the first pass that fits', async () => {
    const encode = vi.fn()
      .mockResolvedValueOnce(blobOf(3.9 * MB))
      .mockResolvedValueOnce(blobOf(3 * MB));
    const { file } = await prepareUploadImage(fileOf(9 * MB), { decode: decode(), encode });
    expect(encode).toHaveBeenCalledTimes(2);
    expect(file.size).toBe(3 * MB);
  });

  it('can target the proxy-safe size for the retry', async () => {
    const encode = vi.fn()
      .mockResolvedValueOnce(blobOf(2 * MB))
      .mockResolvedValueOnce(blobOf(900 * KB));
    const { file, outcome } = await prepareUploadImage(fileOf(2.5 * MB), { maxBytes: RETRY_PHOTO_SIZE_BYTES, decode: decode(), encode });
    expect(outcome).toBe('compressed');
    expect(file.size).toBeLessThanOrEqual(RETRY_PHOTO_SIZE_BYTES);
  });

  it("reports 'too-large' with the original when no legible copy fits", async () => {
    const original = fileOf(20 * MB);
    const encode = vi.fn(async () => blobOf(3.8 * MB));
    expect(await prepareUploadImage(original, { decode: decode(), encode })).toEqual({ file: original, outcome: 'too-large' });
  });

  it("reports 'unprocessable' when the canvas produces nothing (e.g. a phone's canvas limit)", async () => {
    const original = fileOf(6 * MB);
    const encode = vi.fn(async () => null);
    expect(await prepareUploadImage(original, { decode: decode(), encode })).toEqual({ file: original, outcome: 'unprocessable' });
  });

  it('converts a HEIC photo to JPEG when the browser can decode it', async () => {
    const encode = vi.fn(async () => blobOf(400 * KB));
    const { file } = await prepareUploadImage(fileOf(2 * MB, 'image/heic', 'IMG_9.HEIC'), { decode: decode(), encode });
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('IMG_9.jpg');
  });

  it("reports 'unprocessable' when the browser cannot decode the image", async () => {
    const original = fileOf(300 * KB, 'image/heic', 'IMG_9.HEIC');
    const failing = vi.fn(async () => { throw new Error('decode failed'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await prepareUploadImage(original, { decode: failing, encode: vi.fn() })).toEqual({ file: original, outcome: 'unprocessable' });
  });
});
