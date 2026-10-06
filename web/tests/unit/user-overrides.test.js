import test from "node:test";
import assert from "node:assert/strict";

import { resolveAttachedParams, resolveParams } from "../../src/lib/userOverrides.js";

// No localStorage in Node: saved overrides read as none, which is the
// case these tests want anyway.
const connector = {
  id: "opengrid/openconnect",
  defaults: { variant: "full", body: "directional" },
  attached_defaults: { body: "none" },
};

test("a part on its own takes its defaults; attached, the catalogue's attached_defaults go over them", () => {
  assert.deepEqual(resolveParams(connector, {}), { variant: "full", body: "directional" });
  assert.deepEqual(resolveAttachedParams(connector, {}), { variant: "full", body: "none" });
  // An instance value still beats both.
  assert.deepEqual(resolveAttachedParams(connector, { body: "symmetric" }), { variant: "full", body: "symmetric" });
  // A part without attached_defaults attaches as it is.
  assert.deepEqual(resolveAttachedParams({ id: "basics/plate", defaults: { w: 40 } }, {}), { w: 40 });
});
