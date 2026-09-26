import { describe, it, expect } from 'vitest';
import {
  UPLOAD_CATEGORY,
  MAX_FILES_PER_UPLOAD,
  acceptAttribute,
  allowedTypesLabel,
  validateUploadCandidate,
  validateUploadBatch,
  uploadFailure,
  uploadedFiles,
} from '../fileUpload';

// A stand-in for File: the util only reads name/type/size.
const file = ({ name = 'photo.jpg', type = 'image/jpeg', size = 1024 } = {}) => ({ name, type, size });
const MB = 1024 * 1024;

describe('validateUploadCandidate', () => {
  it('accepts the image types the photo category allows', () => {
    ['image/jpeg', 'image/png', 'image/webp'].forEach((type) => {
      expect(validateUploadCandidate(file({ type }), UPLOAD_CATEGORY.INSTALLATION_PHOTO).valid).toBe(true);
    });
  });

  it('refuses a PDF as an installation photo, but allows it elsewhere', () => {
    const pdf = file({ name: 'report.pdf', type: 'application/pdf' });
    expect(validateUploadCandidate(pdf, UPLOAD_CATEGORY.INSTALLATION_PHOTO)).toMatchObject({ valid: false });
    expect(validateUploadCandidate(pdf, UPLOAD_CATEGORY.GENERAL).valid).toBe(true);
  });

  it('names what IS allowed when it refuses a type', () => {
    const result = validateUploadCandidate(file({ name: 'notes.txt', type: 'text/plain' }), UPLOAD_CATEGORY.INSTALLATION_PHOTO);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('JPEG, PNG or WebP');
  });

  it('enforces the documented 5 MB per-file limit and says the actual size', () => {
    expect(validateUploadCandidate(file({ size: 5 * MB }), UPLOAD_CATEGORY.INSTALLATION_PHOTO).valid).toBe(true);
    const tooBig = validateUploadCandidate(file({ size: 6.5 * MB }), UPLOAD_CATEGORY.INSTALLATION_PHOTO);
    expect(tooBig.valid).toBe(false);
    expect(tooBig.reason).toContain('6.5 MB');
    expect(tooBig.reason).toContain('5 MB or smaller');
  });

  it('rejects an empty file and a missing one', () => {
    expect(validateUploadCandidate(file({ size: 0 })).valid).toBe(false);
    expect(validateUploadCandidate(null).valid).toBe(false);
  });

  it('falls back to the extension when the browser reports no mime type', () => {
    expect(validateUploadCandidate(file({ name: 'site.png', type: '' }), UPLOAD_CATEGORY.INSTALLATION_PHOTO).valid).toBe(true);
    expect(validateUploadCandidate(file({ name: 'site.txt', type: '' }), UPLOAD_CATEGORY.INSTALLATION_PHOTO).valid).toBe(false);
  });
});

describe('validateUploadBatch', () => {
  it('allows up to the documented batch size and refuses more', () => {
    const five = Array.from({ length: MAX_FILES_PER_UPLOAD }, () => file());
    expect(validateUploadBatch(five).valid).toBe(true);
    const six = [...five, file()];
    expect(validateUploadBatch(six)).toMatchObject({ valid: false });
    expect(validateUploadBatch(six).reason).toContain('at most 5');
  });

  it('fails the whole batch on one bad file, matching the server’s all-or-nothing rule', () => {
    const batch = [file(), file({ name: 'big.png', type: 'image/png', size: 9 * MB })];
    expect(validateUploadBatch(batch, UPLOAD_CATEGORY.INSTALLATION_PHOTO).valid).toBe(false);
  });

  it('refuses an empty selection', () => {
    expect(validateUploadBatch([]).valid).toBe(false);
    expect(validateUploadBatch(null).valid).toBe(false);
  });
});

describe('acceptAttribute / allowedTypesLabel', () => {
  it('offers only images for a photo, and PDF as well otherwise', () => {
    expect(acceptAttribute(UPLOAD_CATEGORY.INSTALLATION_PHOTO)).not.toContain('pdf');
    expect(acceptAttribute(UPLOAD_CATEGORY.GENERAL)).toContain('application/pdf');
    expect(allowedTypesLabel(UPLOAD_CATEGORY.INSTALLATION_PHOTO)).toBe('JPEG, PNG or WebP');
    expect(allowedTypesLabel(UPLOAD_CATEGORY.GENERAL)).toBe('JPEG, PNG, WebP or PDF');
  });
});

describe('uploadFailure — what the operator is told, per status', () => {
  it('shows the server’s own words for a 400, which name the fixable problem', () => {
    expect(uploadFailure(400)).toMatchObject({ useServerMessage: true, retryable: false });
  });

  it('hides the raw 503, because storage not being configured is an ops issue', () => {
    const result = uploadFailure(503);
    expect(result.useServerMessage).toBe(false);
    expect(result.message).toContain('temporarily unavailable');
    expect(result.message).not.toContain('not configured');
  });

  it('offers a retry for a 502, where the request reached the server', () => {
    expect(uploadFailure(502)).toMatchObject({ retryable: true, useServerMessage: false });
  });

  it('explains 403 and 404 without technical detail', () => {
    expect(uploadFailure(403).message).toBe('You can only delete files you uploaded.');
    expect(uploadFailure(404).message).toBe('That file no longer exists.');
  });

  it('has a safe default for an unexpected status', () => {
    expect(uploadFailure(undefined)).toMatchObject({ retryable: true, useServerMessage: false });
  });
});

describe('uploadedFiles', () => {
  const RECORD = {
    id: 8,
    entityType: 'installation',
    entityId: '930',
    category: 'installation_photo',
    storageKey: 'installation/930/1b73bafa-....png',
    url: 'https://api.memetering.com/api/v1/files/12213f41-3f28-4625-b0e3-30be95a3eb21',
    contentType: 'image/png',
    sizeBytes: 2571,
    originalName: 'site-photo.jpg',
    uploadedBy: '44ec1e65-55f5-4e62-b15f-f3e0f5a3f8ec',
    createdAt: '2026-09-25T10:40:09.237Z',
  };

  it('keeps the url verbatim — it is the only field to store or display', () => {
    const [row] = uploadedFiles({ success: true, data: [RECORD] });
    expect(row.url).toBe(RECORD.url);
    expect(row.id).toBe(8);
  });

  it('does not surface storageKey, which is internal bookkeeping', () => {
    const [row] = uploadedFiles({ data: [RECORD] });
    expect(row).not.toHaveProperty('storageKey');
  });

  it('preserves upload order, since the caller takes data[0]', () => {
    const rows = uploadedFiles({ data: [RECORD, { ...RECORD, id: 9, url: 'https://x/files/second' }] });
    expect(rows.map((r) => r.id)).toEqual([8, 9]);
  });

  it('drops a record with no url rather than yielding an unusable row', () => {
    expect(uploadedFiles({ data: [{ id: 1 }, RECORD] })).toHaveLength(1);
  });

  it('handles a bare array and an empty/absent response', () => {
    expect(uploadedFiles([RECORD])).toHaveLength(1);
    expect(uploadedFiles({ data: [] })).toEqual([]);
    expect(uploadedFiles(null)).toEqual([]);
  });
});
