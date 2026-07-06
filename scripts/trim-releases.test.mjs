import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKeepCount, pickReleasesToDelete } from "./trim-releases.mjs";

test("parseKeepCount accepts positive integer strings", () => {
  assert.equal(parseKeepCount("2"), 2);
  assert.equal(parseKeepCount("10"), 10);
});

test("parseKeepCount rejects zero and negative values", () => {
  assert.equal(parseKeepCount("0"), null);
  assert.equal(parseKeepCount("-1"), null);
});

test("parseKeepCount rejects non-numeric input", () => {
  assert.equal(parseKeepCount("abc"), null);
  assert.equal(parseKeepCount(""), null);
});

test("pickReleasesToDelete returns releases beyond keepCount, oldest-relative order preserved", () => {
  const releases = [{ name: "r1" }, { name: "r2" }, { name: "r3" }, { name: "r4" }];
  assert.deepEqual(pickReleasesToDelete(releases, 2), [{ name: "r3" }, { name: "r4" }]);
});

test("pickReleasesToDelete returns nothing when release count is within keepCount", () => {
  const releases = [{ name: "r1" }, { name: "r2" }];
  assert.deepEqual(pickReleasesToDelete(releases, 5), []);
});

test("pickReleasesToDelete returns nothing for an empty release list", () => {
  assert.deepEqual(pickReleasesToDelete([], 2), []);
});
