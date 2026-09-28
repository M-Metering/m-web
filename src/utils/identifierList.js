// src/utils/identifierList.js
// Turn a pasted block of identifiers (meter serials, account numbers) into a
// clean list — the one parser every "paste many" box uses, so the meter
// picker and the installation account paste accept exactly the same input.
//
// Accepted separators: new lines (\n, \r\n), commas, "comma + space", tabs
// (a column copied from Excel), semicolons and spaces. Values are trimmed,
// blanks dropped and duplicates removed, keeping first-seen order so the
// result reads in the order the operator pasted it.
//
// Values stay STRINGS, exactly as pasted: an account number or meter serial
// is an identifier, and "0239110006909" must keep its leading zero. Nothing
// here pads, truncates or converts to a number.

/**
 * @param {string} raw
 * @returns {{ values: string[], duplicates: string[] }}
 *   values: unique identifiers in pasted order; duplicates: each repeated
 *   value once, so the UI can say how many were collapsed.
 */
export function parseIdentifierList(raw) {
  const seen = new Set();
  const repeated = new Set();
  const values = [];
  String(raw ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((value) => {
      if (seen.has(value)) {
        repeated.add(value);
        return;
      }
      seen.add(value);
      values.push(value);
    });
  return { values, duplicates: Array.from(repeated) };
}

export default parseIdentifierList;
