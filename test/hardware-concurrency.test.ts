import assert from "node:assert/strict";
import test from "node:test";

import { getHardwareConcurrency } from "../src/features/task-execution/index.js";

void test("getHardwareConcurrency returns 1 for low memory (<8GB)", () => {
  const bytes7GB = 7 * 1024 * 1024 * 1024;
  assert.equal(getHardwareConcurrency(bytes7GB, 8), 1);
});

void test("getHardwareConcurrency returns 1 for low CPU count (<=2)", () => {
  const bytes32GB = 32 * 1024 * 1024 * 1024;
  assert.equal(getHardwareConcurrency(bytes32GB, 2), 1);
});

void test("getHardwareConcurrency returns 2 for medium memory (8-16GB)", () => {
  const bytes12GB = 12 * 1024 * 1024 * 1024;
  assert.equal(getHardwareConcurrency(bytes12GB, 8), 2);
});

void test("getHardwareConcurrency caps at 4 for high-spec systems", () => {
  const bytes64GB = 64 * 1024 * 1024 * 1024;
  assert.equal(getHardwareConcurrency(bytes64GB, 16), 4);
});
