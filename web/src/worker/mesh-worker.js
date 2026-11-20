// Runs meshValidate.js's validateAndRepair() off the main thread, for an
// imported STL, STEP or 3MF (components/bench/ImportFlow.jsx, through
// lib/meshValidateClient.js). On a 200k-triangle scan the gate takes
// 0.6-0.7 s on a laptop and over a second on a phone; on the main thread
// that was a frozen page with the "Checking…" status never painted.
//
// Protocol: { id, position: Float32Array, index?: Uint16Array |
// Uint32Array } in (the raw geometry's arrays, transferred), { id, type:
// "result", ...validationToMessage() } or { id, type: "error", message }
// out.
import * as THREE from "three";
import { validateAndRepair, validationToMessage } from "../lib/meshValidate.js";

self.onmessage = (event) => {
  const { id, position, index } = event.data ?? {};
  try {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    if (index) geometry.setIndex(new THREE.BufferAttribute(index, 1));
    const { message, transfer } = validationToMessage(validateAndRepair(geometry));
    self.postMessage({ id, type: "result", ...message }, transfer);
  } catch (err) {
    self.postMessage({ id, type: "error", message: err?.message ?? String(err) });
  }
};
