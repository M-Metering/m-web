import { describe, it, expect } from 'vitest';
import { getErrorMessage, GENERIC_ERROR } from '../errorMessage';

const err = (message) => new Error(message);

describe('getErrorMessage', () => {
  it('shows a short, plain server message without the type prefix', () => {
    expect(getErrorMessage(err('VALIDATION_ERROR:Account already exists for this disco'))).toBe('Account already exists for this disco');
    expect(getErrorMessage(err('NOT_FOUND:Installation not found'))).toBe('Installation not found');
  });

  it('never shows a server error body (could be a database or runtime error)', () => {
    expect(getErrorMessage(err('SERVER_ERROR:relation "meters" does not exist'), 'Could not load meters.')).toBe('Could not load meters.');
    expect(getErrorMessage(err('SERVER_ERROR:Something harmless'))).toBe(GENERIC_ERROR);
  });

  it('drops per-field validation detail', () => {
    expect(getErrorMessage(err('VALIDATION_ERROR:Validation failed (installationDate: "installationDate" is not allowed)')))
      .toBe('Validation failed');
  });

  it.each([
    'VALIDATION_ERROR:"meterNumber" is required',
    'NOT_FOUND:TypeError: Cannot read properties of undefined (reading \'id\')',
    'VALIDATION_ERROR:SequelizeUniqueConstraintError: duplicate key value violates unique constraint',
    'connect ECONNREFUSED 10.0.0.1:5432',
    'HTTP 502: Bad Gateway',
    'Error: boom\n    at handler (/srv/app/routes.js:10:5)',
    '<!DOCTYPE html><html>502</html>',
    'x'.repeat(200),
  ])('falls back instead of showing technical text: %s', (message) => {
    expect(getErrorMessage(err(message), 'Please try again.')).toBe('Please try again.');
  });

  it('maps network, permission and auth errors to plain text', () => {
    expect(getErrorMessage(err('NETWORK_ERROR:Request timeout'))).toMatch(/Unable to reach the server/);
    expect(getErrorMessage(err('PERMISSION_ERROR:'))).toBe('You do not have permission to do that.');
    expect(getErrorMessage(err('AUTH_ERROR:jwt expired'))).toBe('Your session has expired. Please sign in again.');
    expect(getErrorMessage(err('AUTH_ERROR:Invalid credentials'))).toBe('Invalid credentials');
  });

  it('uses the fallback for an empty error', () => {
    expect(getErrorMessage(null, 'Nope')).toBe('Nope');
    expect(getErrorMessage(err(''))).toBe(GENERIC_ERROR);
  });
});
