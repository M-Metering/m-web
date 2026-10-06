import { describe, it, expect } from 'vitest';
import {
  normalizeHeader, parseHeaderList, isPlaceholderValue, toMappingForm, suggestMappingForm,
  validateMappingForm, toServerMapping, meterInventoryForNewDisco, checkSheetAgainstMapping,
  importExtrasOf, validateNewDisco,
} from '../discoImportMapping';

// Rows shaped exactly like BAYELSA CUSTOMER DATA.xlsx after readSpreadsheetRows
// (every cell a string; FEEDER11NAME is a placeholder in every row).
const bayelsaRow = (account, extra = {}) => ({
  REGION: 'Bayelsa',
  FEEDER33NAME: 'IMIRINGI A',
  FEEDER11NAME: '--------------------',
  DTRNAME: 'Joshua Macaiver',
  DTRID: '1761004',
  ACCOUNT_NO: account,
  NAME: 'PASTOR PRINCE AJIBADE',
  ADDRESS: '46 MOUNTAIN OF FIRE STREET OPOLOL BAYELSA STATE',
  STATUS: 'Active',
  ...extra,
});
const BAYELSA_ROWS = [bayelsaRow('877729078307'), bayelsaRow('877906308801C'), bayelsaRow('877509763101')];

// The Aba Power mapping as the spec documents it (abridged to what matters).
const ABA_MAPPING = {
  pendingInstallations: {
    sheetIndex: 0, headerRow: 1, keyField: 'accountNumber', captureExtras: true,
    fields: {
      accountNumber: { headers: ['ACCOUNTNUMBER', 'ACCTNO', 'ACCOUNTNO'], required: true, transform: 'text' },
      customerName: { headers: ['CUSTOMERNAME', 'CUSTNAMES', 'NAME'], required: true, transform: 'trim' },
      meterType: { headers: ['RECOMMENDEDMETERTYPE', 'METERTYPE'], required: true, transform: 'phase' },
    },
  },
  meterInventory: {
    sheetIndex: 0, headerRow: 1, keyField: 'meterNumber', captureExtras: false,
    fields: {
      meterNumber: { headers: ['METERNO'], required: true, transform: 'text', padStart: 13 },
      phaseType: { headers: ['PHASE'], transform: 'phase', keepRaw: true },
    },
  },
};

describe('header helpers', () => {
  it('normalises case, spacing and punctuation like the server', () => {
    expect(normalizeHeader('ACCOUNT_NO')).toBe('ACCOUNTNO');
    expect(normalizeHeader(' Account No. ')).toBe('ACCOUNTNO');
  });

  it('parses a header list, dropping blanks and normalised repeats', () => {
    expect(parseHeaderList('ACCOUNT_NO, Account No ,, ACCTNO')).toEqual(['ACCOUNT_NO', 'ACCTNO']);
  });

  it('treats only blanks and punctuation runs as placeholders', () => {
    expect(isPlaceholderValue('--------------------')).toBe(true);
    expect(isPlaceholderValue('  ')).toBe(true);
    expect(isPlaceholderValue('Active')).toBe(false);
    expect(isPlaceholderValue('0')).toBe(false);
  });
});

describe('suggestMappingForm on the Bayelsa sheet', () => {
  const form = suggestMappingForm(toMappingForm(null), BAYELSA_ROWS);
  const headersOf = (field) => form.fields[field].headers;

  it('maps the sheet headers onto the existing installation fields', () => {
    expect(headersOf('accountNumber')).toBe('ACCOUNT_NO');
    expect(headersOf('customerName')).toBe('NAME');
    expect(headersOf('customerAddress')).toBe('ADDRESS');
    expect(headersOf('region')).toBe('REGION');
    expect(headersOf('transformerName')).toBe('DTRNAME');
    expect(headersOf('transformerCode')).toBe('DTRID');
  });

  it('takes the feeder column that has values, never the placeholder one', () => {
    expect(headersOf('feederName')).toBe('FEEDER33NAME');
  });

  it('invents no meter type and keeps meter type optional', () => {
    expect(form.fields.meterType.required).toBe(false);
    expect(parseHeaderList(headersOf('meterType'))).not.toContain('STATUS');
  });

  it('is valid, and STATUS/FEEDER11NAME stay as extras on the record', () => {
    expect(validateMappingForm(form)).toEqual([]);
    const mapping = toServerMapping(form, {});
    const check = checkSheetAgainstMapping(BAYELSA_ROWS, mapping.pendingInstallations);
    expect(check.missingRequired).toEqual([]);
    expect(check.unmappedHeaders).toEqual(['FEEDER11NAME', 'STATUS']);
    expect(check.captureExtras).toBe(true);
    expect(check.rowCount).toBe(3);
    expect(check.duplicateKeys).toEqual([]);
  });
});

describe('validateMappingForm', () => {
  it('requires a header for the account number and customer name', () => {
    const form = toMappingForm(null);
    form.fields.accountNumber = { headers: '', required: true };
    expect(validateMappingForm(form)).toContain('Account number needs at least one spreadsheet header.');
  });

  it('refuses one header feeding two fields', () => {
    const form = toMappingForm(null);
    form.fields.region = { headers: 'ADDRESS', required: false };
    expect(validateMappingForm(form).join(' ')).toMatch(/"ADDRESS" is used for both Address and Region/);
  });

  it('refuses an optional field marked required without a header', () => {
    const form = toMappingForm(null);
    form.fields.meterType = { headers: '', required: true };
    expect(validateMappingForm(form)).toContain('Meter type is marked required but has no header.');
  });
});

describe('toServerMapping (whole-object replace)', () => {
  it('keeps meterInventory and every stored per-field option untouched', () => {
    const form = toMappingForm(ABA_MAPPING);
    form.fields.customerName.headers = 'CUSTOMERNAME, NAME';
    const out = toServerMapping(form, ABA_MAPPING);
    expect(out.meterInventory).toEqual(ABA_MAPPING.meterInventory);
    expect(out.pendingInstallations.fields.accountNumber).toEqual(ABA_MAPPING.pendingInstallations.fields.accountNumber);
    expect(out.pendingInstallations.fields.customerName).toEqual({ headers: ['CUSTOMERNAME', 'NAME'], required: true, transform: 'trim' });
    expect(out.pendingInstallations.fields.meterType.required).toBe(true);
  });

  it('round-trips an existing mapping unchanged when nothing is edited', () => {
    const out = toServerMapping(toMappingForm(ABA_MAPPING), ABA_MAPPING);
    expect(out).toEqual(ABA_MAPPING);
  });

  it('gives a new field its default transform and drops a cleared one', () => {
    const form = toMappingForm(ABA_MAPPING);
    form.fields.transformerCode = { headers: 'DTRID', required: false };
    form.fields.meterType = { headers: '', required: false };
    const fields = toServerMapping(form, ABA_MAPPING).pendingInstallations.fields;
    expect(fields.transformerCode).toEqual({ transform: 'text', headers: ['DTRID'], required: false });
    expect(fields.meterType).toBeUndefined();
  });
});

describe('meterInventoryForNewDisco', () => {
  it('copies the source disco but never pads a meter number', () => {
    const copy = meterInventoryForNewDisco(ABA_MAPPING);
    expect(copy.fields.meterNumber).toEqual({ headers: ['METERNO'], required: true, transform: 'text' });
    expect(copy.fields.phaseType).toEqual(ABA_MAPPING.meterInventory.fields.phaseType);
    expect(ABA_MAPPING.meterInventory.fields.meterNumber.padStart).toBe(13);
  });

  it('returns null when the source has none', () => {
    expect(meterInventoryForNewDisco({})).toBeNull();
  });
});

describe('checkSheetAgainstMapping', () => {
  it('reports a missing required column and in-file duplicate accounts', () => {
    const rows = [bayelsaRow('1'), bayelsaRow('1'), bayelsaRow('2')];
    const check = checkSheetAgainstMapping(rows, ABA_MAPPING.pendingInstallations);
    expect(check.missingRequired).toEqual(['Meter type']);
    expect(check.duplicateKeys).toEqual([{ key: '1', count: 2 }]);
  });

  it('counts blank cells in a required column', () => {
    const rows = [bayelsaRow('1'), bayelsaRow('', {})];
    const mapping = toServerMapping(suggestMappingForm(toMappingForm(null), BAYELSA_ROWS), {});
    const check = checkSheetAgainstMapping(rows, mapping.pendingInstallations);
    expect(check.blankRequired).toEqual([{ label: 'Account number', count: 1 }]);
  });

  it('keeps account numbers as exact strings', () => {
    const rows = [bayelsaRow('0239110006909'), bayelsaRow('239110006909')];
    const mapping = toServerMapping(suggestMappingForm(toMappingForm(null), rows), {});
    expect(checkSheetAgainstMapping(rows, mapping.pendingInstallations).duplicateKeys).toEqual([]);
  });
});

describe('importExtrasOf', () => {
  it('lists flat extras verbatim, skipping placeholders and nested values', () => {
    expect(importExtrasOf({ extras: { STATUS: 'Active', FEEDER11NAME: '-----', nested: { a: 1 } } }))
      .toEqual([{ label: 'STATUS', value: 'Active' }]);
  });

  it('reads a JSON string and ignores anything unusable', () => {
    expect(importExtrasOf({ extras: '{"STATUS":"Active"}' })).toEqual([{ label: 'STATUS', value: 'Active' }]);
    expect(importExtrasOf({ extras: 'not json' })).toEqual([]);
    expect(importExtrasOf({ extras: ['x'] })).toEqual([]);
    expect(importExtrasOf({})).toEqual([]);
  });
});

describe('validateNewDisco', () => {
  const existing = [{ code: 'ABA_POWER' }, { code: 'JED' }];

  it('accepts PHEDC', () => {
    expect(validateNewDisco({ code: 'PHEDC', name: 'Port Harcourt Electricity Distribution' }, existing)).toEqual([]);
  });

  it('refuses a duplicate, a JED-prefixed code, a bad code and a missing name', () => {
    expect(validateNewDisco({ code: 'aba_power', name: 'x' }, existing)).toEqual(['ABA_POWER is already registered.']);
    expect(validateNewDisco({ code: 'JEDX', name: 'x' }, existing)).toEqual(['Codes starting with JED are reserved for JED.']);
    expect(validateNewDisco({ code: 'PH EDC', name: '' }, existing)).toHaveLength(2);
  });
});
