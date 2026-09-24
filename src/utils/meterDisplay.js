// src/utils/meterDisplay.js
// How a meter's descriptive fields are shown, in one place, so Meter Schedule,
// the dispatch screens and the installer's own meter list agree.
//
// WHAT THE API ACTUALLY HAS. The live spec's only meter item schema
// (GET /meters) is:
//   id, meterNumber, simNumber, manufacturedDate, meterMake, model,
//   phaseType, sgcNumber, status, uploadedAt, installedAt
// Searching the whole 85-operation spec for "manufactur" returns exactly one
// hit — `manufacturedDate`, inside that schema. So:
//
//   - `meterMake` is the ONLY make/manufacturer field. The API does not model
//     "manufacturer" and "make" separately, so this app shows one field,
//     labelled Make, and never copies it into a second "Manufacturer" field.
//   - `manufacturedDate` is a DATE (when the unit was built), not a
//     manufacturer. It used to be labelled just "Manufactured", which reads as
//     a manufacturer name when the cell is empty — hence MANUFACTURED_LABEL.
//   - `model` is separate from `meterMake` and is never derived from it.
//
// Blank values are shown as "Not recorded", never as an empty label and never
// filled in with a guess: a blank here means the meter's upload/import did not
// carry that column (see API_GAP_REPORT.md, gap Q).
export const NOT_RECORDED = 'Not recorded';

/** "Manufactured" alone reads as a manufacturer name; this is a date. */
export const MANUFACTURED_LABEL = 'Manufactured date';

const text = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

/** A displayable value, or `fallback` when the API didn't record one. */
export const orNotRecorded = (value, fallback = NOT_RECORDED) => text(value) || fallback;

/** The meter's make — `meterMake`, the API's single make/manufacturer field. */
export const meterMakeOf = (meter) => text(meter?.meterMake);

/** The meter's model — a separate field, never derived from the make. */
export const meterModelOf = (meter) => text(meter?.model);

/** The build date as the API gave it (a plain string on this schema). */
export const manufacturedDateOf = (meter) => text(meter?.manufacturedDate);

/**
 * Make and model on one line for compact places (pickers, card subtitles):
 * "MASTER ENERGY · ME-1P", or just whichever one exists, or '' when neither
 * was recorded. Callers decide whether to show NOT_RECORDED or nothing.
 */
export function meterMakeModel(meter) {
  return [meterMakeOf(meter), meterModelOf(meter)].filter(Boolean).join(' · ');
}

/**
 * The one-line descriptor used wherever a meter is listed next to its serial:
 * phase, then make/model, then SIM. Only parts the API actually recorded.
 */
export function meterSummaryLine(meter) {
  return [
    text(meter?.phaseType),
    meterMakeModel(meter),
    text(meter?.simNumber) && `SIM ${text(meter.simNumber)}`,
  ].filter(Boolean).join(' · ');
}

export default { meterMakeOf, meterModelOf, manufacturedDateOf, meterMakeModel, meterSummaryLine, orNotRecorded };
