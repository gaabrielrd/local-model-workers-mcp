import assert from "node:assert/strict";
import test from "node:test";

import {
  ConfigurationError,
  getProtectedProviderConfigurations,
  hasLegacyProviderVariables,
  migrateLegacyProviders,
} from "../src/features/configuration/index.js";
import {
  buildProvidersValue,
  needsPlainHttpOptOut,
  readProviderSeed,
  resolveProvidersValue,
} from "../src/features/installation/index.js";

const LEGACY = {
  LMW_LM_STUDIO_BASE_URL: "http://pc.local:1234/v1",
  LMW_LM_STUDIO_BEARER_TOKEN: "legacy-token",
  LMW_ALLOWED_MODELS: '["b/model","a/model"]',
};

void test("the server no longer accepts the retired single-provider variables", () => {
  let caught: unknown;
  try {
    getProtectedProviderConfigurations(LEGACY);
  } catch (error: unknown) {
    caught = error;
  }

  assert.ok(caught instanceof ConfigurationError);
  assert.equal(caught.code, "invalid_configuration");
  // The message has to name the way out, or an upgrade looks like a breakage.
  assert.match(caught.message, /LMW_PROVIDERS is required/u);
  assert.match(caught.message, /setup/u);
  assert.equal(
    caught.message.includes("legacy-token"),
    false,
    "the credential must never appear in an error",
  );
});

void test("a missing configuration is reported without a migration hint", () => {
  assert.throws(
    () => getProtectedProviderConfigurations({}),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      !error.message.includes("setup") &&
      error.message.includes("LMW_PROVIDERS is required"),
  );
});

void test("legacy variables translate into one equivalent provider", () => {
  const migrated = migrateLegacyProviders(LEGACY);
  assert.notEqual(migrated, undefined);

  const providers = getProtectedProviderConfigurations({
    LMW_PROVIDERS: migrated,
  });
  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.base_url, "http://pc.local:1234/v1");
  assert.equal(providers[0]?.bearer_token, "legacy-token");
  assert.deepEqual(providers[0]?.allowed_models, ["a/model", "b/model"]);
  assert.equal(providers[0]?.priority, 0);
});

void test("an absent or unusable legacy setup migrates to nothing", () => {
  assert.equal(migrateLegacyProviders({}), undefined);
  assert.equal(
    migrateLegacyProviders({ LMW_LM_STUDIO_BASE_URL: "file:///tmp/model" }),
    undefined,
    "an invalid URL must not be written out as if it worked",
  );
  assert.equal(
    migrateLegacyProviders({
      ...LEGACY,
      LMW_ALLOWED_MODELS: "not-json",
    }),
    undefined,
  );
});

void test("an unexpanded placeholder base URL falls back to the default", () => {
  const migrated = migrateLegacyProviders({
    LMW_LM_STUDIO_BASE_URL: "${LM_STUDIO_URL}",
  });
  const providers = getProtectedProviderConfigurations({
    LMW_PROVIDERS: migrated,
  });
  assert.equal(providers[0]?.base_url, "http://localhost:1234/v1");
});

void test("legacy variables are detected only when they carry a value", () => {
  assert.equal(hasLegacyProviderVariables(LEGACY), true);
  assert.equal(hasLegacyProviderVariables({}), false);
  assert.equal(
    hasLegacyProviderVariables({ LMW_LM_STUDIO_BASE_URL: "   " }),
    false,
  );
});

void test("an existing LMW_PROVIDERS wins over lingering legacy variables", () => {
  const current = buildProvidersValue({
    baseUrl: "http://current.local:1234/v1",
    allowedModels: ["current/model"],
  });

  const resolved = resolveProvidersValue({ ...LEGACY, LMW_PROVIDERS: current });
  assert.equal(resolved, current);

  const seed = readProviderSeed({ ...LEGACY, LMW_PROVIDERS: current });
  assert.equal(seed.baseUrl, "http://current.local:1234/v1");
  assert.equal(
    seed.migratedFromLegacy,
    false,
    "a migrated machine must not be told it is migrating again",
  );
});

void test("setup seeds its prompts from the legacy values and flags the migration", () => {
  const seed = readProviderSeed(LEGACY);
  assert.equal(seed.baseUrl, "http://pc.local:1234/v1");
  assert.equal(seed.bearerToken, "legacy-token");
  assert.deepEqual(seed.allowedModels, ["a/model", "b/model"]);
  assert.equal(seed.migratedFromLegacy, true);
});

void test("an empty environment seeds the documented default", () => {
  const seed = readProviderSeed({});
  assert.equal(seed.baseUrl, "http://localhost:1234/v1");
  assert.equal(seed.bearerToken, undefined);
  assert.equal(seed.migratedFromLegacy, false);
});

void test("the seed reads the highest-priority entry of a hand-authored setup", () => {
  const providers = JSON.stringify([
    {
      name: "fallback",
      type: "localai",
      base_url: "http://fallback.local:8080/v1",
      allowed_models: ["*"],
      priority: 5,
    },
    {
      name: "primary",
      type: "lm-studio",
      base_url: "http://primary.local:1234/v1",
      allowed_models: ["primary/model"],
      priority: 0,
    },
  ]);

  const seed = readProviderSeed({ LMW_PROVIDERS: providers });
  assert.equal(seed.baseUrl, "http://primary.local:1234/v1");
});

void test("setup writes a value the server accepts", () => {
  const value = buildProvidersValue({
    baseUrl: "http://written.local:1234/v1",
    bearerToken: "written-token",
    allowedModels: ["written/model"],
  });

  const providers = getProtectedProviderConfigurations({
    LMW_PROVIDERS: value,
  });
  assert.equal(providers[0]?.base_url, "http://written.local:1234/v1");
  assert.equal(providers[0]?.bearer_token, "written-token");
});

void test("an empty model selection is written as the wildcard, not an empty list", () => {
  // The schema requires at least one entry; an empty array would fail closed
  // on the next start, after setup already reported success.
  const value = buildProvidersValue({
    baseUrl: "http://written.local:1234/v1",
    allowedModels: [],
  });
  const providers = getProtectedProviderConfigurations({
    LMW_PROVIDERS: value,
  });
  assert.deepEqual(providers[0]?.allowed_models, ["*"]);
});

void test("setup records the opt-out a remote plain-HTTP endpoint implies", () => {
  assert.equal(needsPlainHttpOptOut("http://pc.local:1234/v1"), true);
  // Loopback never needed verification, and HTTPS gets it.
  assert.equal(needsPlainHttpOptOut("http://localhost:1234/v1"), false);
  assert.equal(needsPlainHttpOptOut("http://127.0.0.1:1234/v1"), false);
  assert.equal(needsPlainHttpOptOut("https://models.remote/v1"), false);
  assert.equal(needsPlainHttpOptOut("not-a-url"), false);

  // Without the opt-out the server would refuse this endpoint at startup.
  const value = buildProvidersValue({
    baseUrl: "http://pc.local:1234/v1",
    allowedModels: ["*"],
    tlsVerify: false,
  });
  const providers = getProtectedProviderConfigurations({
    LMW_PROVIDERS: value,
  });
  assert.equal(providers[0]?.tls_verify, false);
});

void test("a migrated legacy install keeps working over plain HTTP", () => {
  // The retired variables carried no TLS preference, so migration alone would
  // hand the server an endpoint it now refuses. Setup writes the opt-out.
  const seed = readProviderSeed(LEGACY);
  assert.equal(needsPlainHttpOptOut(seed.baseUrl), true);
});
