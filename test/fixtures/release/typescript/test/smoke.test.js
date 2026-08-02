import assert from "node:assert/strict";
import test from "node:test";

import { discountedPrice } from "../src/pricing.js";

test("keeps the existing test infrastructure executable", () => {
  assert.equal(discountedPrice(100, 10), 90);
});
