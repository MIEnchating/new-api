import assert from "node:assert/strict";
import test from "node:test";

import { validateReleaseTag } from "./validate-release-tag.mjs";

test("accepts the first daily release without a suffix", () => {
  assert.deepEqual(validateReleaseTag("v2026.07.24", { checkSequence: false }), {
    baseTag: "v2026.07.24",
    revision: undefined,
  });
});

test("accepts later daily releases starting at two", () => {
  assert.equal(
    validateReleaseTag("v2026.07.24-2", { checkSequence: false }).revision,
    2,
  );
  assert.equal(
    validateReleaseTag("v2026.07.24-12", { checkSequence: false }).revision,
    12,
  );
});

test("rejects the redundant first-release suffix", () => {
  assert.throws(
    () => validateReleaseTag("v2026.07.24-1", { checkSequence: false }),
    /-1 suffix is forbidden/,
  );
});

test("rejects invalid or non-padded dates", () => {
  assert.throws(
    () => validateReleaseTag("v2026.02.30", { checkSequence: false }),
    /invalid calendar date/,
  );
  assert.throws(
    () => validateReleaseTag("v2026.7.24", { checkSequence: false }),
    /Unsupported release tag/,
  );
});
