// Classifies a line OpenSCAD wrote to stderr. The worker forwards only
// real errors to the page (see openscad-worker.js's printErr).
//
// The match is on the whole word: a bare /error/i also matched the
// "Status: NoError" line OpenSCAD prints on every successful run, which
// posted a bogus error-level log entry with every render.
const ERROR_LINE = /\berror\b/i;

export function isOpenscadError(text) {
  return ERROR_LINE.test(text);
}
