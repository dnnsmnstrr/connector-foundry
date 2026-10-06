import test from "node:test";
import assert from "node:assert/strict";

import { SIDEBAR_WIDTH_DEFAULT, clampSidebarWidth, getSidebarWidth, setSidebarWidth, subscribeSidebarWidth } from "../../src/lib/uiPrefs.js";

test("the sidebar width is held between its limits and whole pixels", () => {
  assert.equal(clampSidebarWidth(100), 220);
  assert.equal(clampSidebarWidth(5000), 640);
  assert.equal(clampSidebarWidth(333.6), 334);
  assert.equal(clampSidebarWidth("abc"), SIDEBAR_WIDTH_DEFAULT);
});

test("setting the width notifies, clamped, and only on a change (no storage in Node is fine)", () => {
  assert.equal(getSidebarWidth(), SIDEBAR_WIDTH_DEFAULT);
  let calls = 0;
  const off = subscribeSidebarWidth(() => calls++);
  setSidebarWidth(9999, { persist: false });
  assert.equal(getSidebarWidth(), 640);
  setSidebarWidth(640);
  assert.equal(calls, 1);
  setSidebarWidth(SIDEBAR_WIDTH_DEFAULT);
  off();
  assert.equal(calls, 2);
});
