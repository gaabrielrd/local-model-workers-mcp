import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIGURATION_PROFILES,
  PreferencesSchema,
} from "../src/features/configuration/index.js";

void test("CONFIGURATION_PROFILES lists approved profile names", () => {
  assert.deepEqual(CONFIGURATION_PROFILES, ["fast", "thorough", "balanced"]);
});

void test("PreferencesSchema accepts profile property", () => {
  const parsed = PreferencesSchema.parse({
    schema_version: 1,
    profile: "fast",
  });

  assert.equal(parsed.profile, "fast");
});

void test("PreferencesSchema rejects invalid profile property", () => {
  assert.throws(() =>
    PreferencesSchema.parse({
      schema_version: 1,
      profile: "invalid_profile",
    }),
  );
});
