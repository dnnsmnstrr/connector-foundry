import { useMemo } from "react";
import Modal from "./Modal.jsx";
import { copyLink, openLink } from "../lib/commandCatalog.js";
import { showCommandHud } from "../lib/commandHud.js";
import { downloadBlob } from "../lib/download.js";
import { isNativeApp } from "../lib/nativeApp.js";
import {
  EASYPRINT_NOTE,
  EASYPRINT_STEPS,
  EASYPRINT_URL,
  canShareFile,
  modelFile,
  shareOrDownload,
} from "../lib/share.js";
import { stlBodiesTo3mf } from "../lib/threeMfWrite.js";

// "Print with EasyPrint…": the sheet behind the Library's, the Bench's and
// the Holes tab's Print buttons (and their palette commands). Prusa's
// EasyPrint slices in the cloud and prints to a Prusa Connect printer, but
// nothing can send it a model — no API, no URL scheme, no share target
// (lib/share.js has the research) — so the sheet does what can be done:
// hands each body's file to the device (the share sheet where the
// browser allows a model file, a download elsewhere), opens EasyPrint,
// and lists the three steps from file to print.
//
// Two taps, never one: share() and window.open() each need and consume
// the tap's transient activation, and the share sheet would cover a tab
// opened under it anyway. For the same reason the file bytes are in hand
// before the button is enabled — share() called after a render's await
// has no activation left and is refused — so a body still rendering shows
// "Rendering…" instead.
//
// In the iOS and Android store apps the first button is "Save STL": it
// puts the file straight into the app's own folder (lib/nativeApp.js),
// which is what a phone there wants most of the time; where the web view
// can share the file too (iOS), a "Share…" beside it opens the share
// sheet.
//
// `title` says what is being printed; `bodies` are the files, each with
// its STL bytes (null while its render is on the way, or `error` when it
// failed or will not come); `allFileName` names the one 3MF of every body
// offered when there are several (the bench's name); `onClose` closes the
// sheet.
/**
 * @param {{
 *   title: string,
 *   bodies: Array<{ name: string, bytes: ArrayBuffer | Uint8Array | null, error?: string }>,
 *   allFileName?: string,
 *   onClose: () => void,
 * }} props
 */
export default function PrintSheet({ title, bodies, allFileName, onClose }) {
  const desktop = typeof document !== "undefined" && document.documentElement.classList.contains("desktop");
  // Whether this browser's share sheet takes the file kinds on offer —
  // decided by name and engine (Chromium's allowlist, which canShare()
  // ignores), so an empty File stands in for the real one.
  const shares = useMemo(
    () => ({
      stl: canShareFile(modelFile(new Uint8Array(0), "part.stl"), { desktop }),
      "3mf": canShareFile(modelFile(new Uint8Array(0), "part.3mf"), { desktop }),
    }),
    [desktop],
  );
  // The one-file row waits while any body is still on its way, and is
  // not offered once one failed: a print with a part missing is not the
  // bench (each body that did render keeps its own buttons).
  const pending = bodies.some((body) => !body.bytes && !body.error);
  const failed = bodies.some((body) => !body.bytes && body.error);
  const all3mfName = allFileName ?? `${stem(bodies[0]?.name ?? title)}.3mf`;

  const native = isNativeApp();
  // `share`: the share sheet where the browser has one; otherwise, and in
  // the store apps' Save, downloadBlob(), which says where the file went.
  const handOver = (file, share = !native) => {
    if (!share) {
      downloadBlob(file, file.name, file.type);
      return;
    }
    shareOrDownload(file, { desktop }).then((outcome) => {
      if (outcome === "shared") showCommandHud("Shared");
      else if (outcome === "downloaded") showCommandHud(`Saved ${file.name}`);
    });
  };
  const handOverStl = (body, share) => handOver(modelFile(body.bytes, body.name), share);
  // The 3MF is written on the tap, synchronously, so the activation is
  // still there to share it: a typical part takes tens of milliseconds,
  // a 200k-triangle import under a second on a laptop.
  const handOver3mf = (rows, name) => {
    let bytes;
    try {
      bytes = threeMfOf(rows);
    } catch (err) {
      showCommandHud(`Couldn't write the 3MF: ${err.message}`);
      return;
    }
    handOver(modelFile(bytes, name));
  };
  const verb = (kind) =>
    native
      ? `Save ${kind.toUpperCase()}`
      : shares[kind]
        ? `Share ${kind.toUpperCase()}…`
        : `Download ${kind.toUpperCase()}`;

  return (
    <Modal title="Print with EasyPrint" className="print-sheet-modal" onClose={onClose}>
      <div className="print-sheet">
        <p className="muted print-sheet-intro">
          {title}: EasyPrint needs the file on this device first, then it slices and prints it.
        </p>
        <ul className="print-sheet-rows">
          {bodies.length > 1 && (
            <li className="print-sheet-row">
              <span className="print-sheet-name">Every body in one file</span>
              <span className="print-sheet-buttons">
                <button
                  type="button"
                  className="download-button print-sheet-button"
                  disabled={pending || failed}
                  onClick={() => handOver3mf(bodies, all3mfName)}
                >
                  {pending ? "Rendering…" : failed ? "Not available — a body failed" : verb("3mf")}
                </button>
              </span>
            </li>
          )}
          {bodies.map((body) => (
            <li className="print-sheet-row" key={body.name}>
              <span className="print-sheet-name">
                {body.name}
                {body.error && <span className="error-text print-sheet-error"> — {body.error}</span>}
              </span>
              <span className="print-sheet-buttons">
                <button
                  type="button"
                  className="download-button print-sheet-button"
                  disabled={!body.bytes}
                  onClick={() => handOverStl(body)}
                >
                  {body.bytes || body.error ? verb("stl") : "Rendering…"}
                </button>
                <button
                  type="button"
                  className="download-button print-sheet-button print-sheet-secondary"
                  disabled={!body.bytes}
                  title="The same body as a 3MF: a fifth of the size to upload, with its units and name"
                  onClick={() => handOver3mf([body], `${stem(body.name)}.3mf`)}
                >
                  3MF
                </button>
                {native && shares.stl && (
                  <button
                    type="button"
                    className="download-button print-sheet-button print-sheet-secondary"
                    disabled={!body.bytes}
                    onClick={() => handOverStl(body, true)}
                  >
                    Share…
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="print-sheet-links">
          <button
            type="button"
            className="download-button print-sheet-button"
            onClick={() => openLink(EASYPRINT_URL)}
          >
            Open EasyPrint ↗
          </button>
          <button
            type="button"
            className="download-button print-sheet-button print-sheet-secondary"
            title={EASYPRINT_URL}
            onClick={() => copyLink(EASYPRINT_URL)}
          >
            Copy link
          </button>
        </div>
        <ol className="print-sheet-steps">
          {EASYPRINT_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="muted print-sheet-note">{EASYPRINT_NOTE}</p>
      </div>
    </Modal>
  );
}

/** @param {string} name */
function stem(name) {
  return name.replace(/\.[^.]+$/, "");
}

// A 3MF per set of STL buffers, written once: the rows' bytes are the
// render cache's buffers, so a second tap on the same body costs nothing.
/** @type {WeakMap<object, Map<string, Uint8Array>>} */
const written = new WeakMap();

/** @param {Array<{ name: string, bytes: ArrayBuffer | Uint8Array | null }>} rows */
function threeMfOf(rows) {
  const first = rows[0].bytes;
  const key = rows.map((row) => row.name).join("\n");
  let byKey = written.get(first);
  if (!byKey) {
    byKey = new Map();
    written.set(first, byKey);
  }
  let bytes = byKey.get(key);
  if (!bytes) {
    bytes = stlBodiesTo3mf(rows.map((row) => ({ name: stem(row.name), stl: row.bytes })));
    byKey.set(key, bytes);
  }
  return bytes;
}
