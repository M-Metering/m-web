import { describe, it, expect } from 'vitest';
import {
  NOT_RECORDED, MANUFACTURED_LABEL, orNotRecorded,
  meterMakeOf, meterModelOf, manufacturedDateOf, meterMakeModel, meterSummaryLine,
} from '../meterDisplay';

const meter = {
  meterNumber: '0239110006909',
  meterMake: 'MASTER ENERGY',
  model: 'ME-1P',
  manufacturedDate: '2026-03-01',
  phaseType: 'SINGLE PHASE',
  simNumber: '8923401000012345678',
};

describe('field mapping', () => {
  it('reads make and model from the API\'s own fields', () => {
    expect(meterMakeOf(meter)).toBe('MASTER ENERGY');
    expect(meterModelOf(meter)).toBe('ME-1P');
    expect(manufacturedDateOf(meter)).toBe('2026-03-01');
  });

  it('never copies the make into the model, or the other way round', () => {
    expect(meterModelOf({ meterMake: 'MASTER ENERGY' })).toBe('');
    expect(meterMakeOf({ model: 'ME-1P' })).toBe('');
  });

  it('never treats the manufactured DATE as a manufacturer', () => {
    // manufacturedDate is when the unit was built; the API has no separate
    // manufacturer field, so make must not fall back to it.
    expect(meterMakeOf({ manufacturedDate: '2026-03-01' })).toBe('');
    expect(MANUFACTURED_LABEL).toBe('Manufactured date');
  });

  it('trims but never fabricates', () => {
    expect(meterMakeOf({ meterMake: '  MASTER ENERGY ' })).toBe('MASTER ENERGY');
    expect(meterMakeOf({ meterMake: '   ' })).toBe('');
    expect(meterMakeOf({})).toBe('');
    expect(meterMakeOf(null)).toBe('');
  });
});

describe('orNotRecorded', () => {
  it('says so plainly rather than rendering an empty label', () => {
    expect(orNotRecorded('')).toBe(NOT_RECORDED);
    expect(orNotRecorded(null)).toBe(NOT_RECORDED);
    expect(orNotRecorded('MASTER ENERGY')).toBe('MASTER ENERGY');
  });
});

describe('meterMakeModel', () => {
  it('joins the two real fields', () => {
    expect(meterMakeModel(meter)).toBe('MASTER ENERGY · ME-1P');
  });

  it('drops whichever the API did not record', () => {
    expect(meterMakeModel({ meterMake: 'MASTER ENERGY' })).toBe('MASTER ENERGY');
    expect(meterMakeModel({ model: 'ME-1P' })).toBe('ME-1P');
    expect(meterMakeModel({})).toBe('');
  });
});

describe('meterSummaryLine', () => {
  it('lists phase, make/model and SIM, in that order', () => {
    expect(meterSummaryLine(meter))
      .toBe('SINGLE PHASE · MASTER ENERGY · ME-1P · SIM 8923401000012345678');
  });

  it('includes only the parts that exist', () => {
    expect(meterSummaryLine({ phaseType: 'THREE PHASE' })).toBe('THREE PHASE');
    expect(meterSummaryLine({})).toBe('');
  });
});
