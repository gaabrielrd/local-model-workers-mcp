import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  InferenceError,
  assertTransportSecurity,
  createProviderAdapter,
  isLoopbackHost,
  isTlsVerificationError,
  tlsValidationDisabled,
  transportError,
} from "../src/features/model-inference/index.js";

void test("verification is off by default, preserving trusted-LAN behavior", () => {
  assert.doesNotThrow(() =>
    assertTransportSecurity({ baseUrl: "http://pc.local:1234/v1" }),
  );
  assert.doesNotThrow(() =>
    assertTransportSecurity({
      baseUrl: "http://pc.local:1234/v1",
      tlsVerify: false,
    }),
  );
});

void test("verification refuses plain HTTP to a remote host", () => {
  assert.throws(
    () =>
      assertTransportSecurity({
        baseUrl: "http://pc-gabriel.local:1234/v1",
        tlsVerify: true,
      }),
    (error: unknown) =>
      error instanceof InferenceError &&
      error.code === "invalid_configuration" &&
      /plain HTTP/u.test(error.message),
  );
});

void test("verification still allows loopback HTTP, which never leaves the machine", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.doesNotThrow(
      () =>
        assertTransportSecurity({
          baseUrl: `http://${host}:1234/v1`,
          tlsVerify: true,
        }),
      `${host} must remain usable`,
    );
  }
  assert.equal(isLoopbackHost("LOCALHOST"), true);
  assert.equal(isLoopbackHost("example.com"), false);
});

void test("verification refuses HTTPS when validation is globally disabled", () => {
  assert.equal(
    tlsValidationDisabled({ NODE_TLS_REJECT_UNAUTHORIZED: "0" }),
    true,
  );
  assert.equal(tlsValidationDisabled({}), false);

  assert.throws(
    () =>
      assertTransportSecurity({
        baseUrl: "https://models.internal/v1",
        tlsVerify: true,
        environment: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      }),
    (error: unknown) =>
      error instanceof InferenceError &&
      error.code === "invalid_configuration" &&
      /NODE_TLS_REJECT_UNAUTHORIZED/u.test(error.message),
  );
});

void test("verification accepts HTTPS with validation in force", () => {
  assert.doesNotThrow(() =>
    assertTransportSecurity({
      baseUrl: "https://models.internal/v1",
      tlsVerify: true,
      environment: {},
    }),
  );
});

void test("an invalid base URL under verification fails closed", () => {
  assert.throws(
    () => assertTransportSecurity({ baseUrl: "not a url", tlsVerify: true }),
    (error: unknown) =>
      error instanceof InferenceError && error.code === "invalid_configuration",
  );
});

void test("adapter construction fails closed on an unverifiable provider", () => {
  assert.throws(
    () =>
      createProviderAdapter({
        name: "remote",
        type: "lm-studio",
        base_url: "http://models.remote:1234/v1",
        allowed_models: ["*"],
        priority: 0,
        tls_verify: true,
      }),
    (error: unknown) =>
      error instanceof InferenceError && error.code === "invalid_configuration",
  );

  // The same provider without the flag keeps working.
  assert.doesNotThrow(() =>
    createProviderAdapter({
      name: "remote",
      type: "lm-studio",
      base_url: "http://models.remote:1234/v1",
      allowed_models: ["*"],
      priority: 0,
    }),
  );
});

void test("certificate failures are recognized through a wrapped cause chain", () => {
  const codes = [
    "CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "ERR_TLS_CERT_ALTNAME_INVALID",
  ];
  for (const code of codes) {
    const wrapped = new TypeError("fetch failed", {
      cause: new Error("tls", {
        cause: Object.assign(new Error("x"), { code }),
      }),
    });
    assert.equal(isTlsVerificationError(wrapped), true, code);
  }

  assert.equal(
    isTlsVerificationError(
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("x"), { code: "ECONNREFUSED" }),
      }),
    ),
    false,
  );
  assert.equal(isTlsVerificationError(undefined), false);
  assert.equal(isTlsVerificationError("not an error"), false);
});

void test("a certificate failure is non-retryable; a network failure stays retryable", () => {
  const tls = transportError(
    Object.assign(new Error("x"), { code: "CERT_HAS_EXPIRED" }),
    "unreachable",
  );
  assert.equal(tls.code, "invalid_configuration");
  assert.equal(tls.retryable, false);
  assert.match(tls.message, /certificate could not be verified/u);

  const network = transportError(
    Object.assign(new Error("x"), { code: "ECONNREFUSED" }),
    "unreachable",
  );
  assert.equal(network.code, "endpoint_unreachable");
  assert.equal(network.retryable, true);
});

void test("a real self-signed HTTPS server is rejected and its error is classified", async (t) => {
  const material = createSelfSignedCertificate();
  if (material === undefined) {
    t.skip("openssl is unavailable, so the live TLS fixture cannot be built");
    return;
  }

  const server = createServer(material, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const address = server.address();
  assert.notEqual(address, null);
  assert.notEqual(typeof address, "string");
  const port = (address as { port: number }).port;

  let caught: unknown;
  try {
    await fetch(`https://127.0.0.1:${port}/v1/models`);
    assert.fail("a self-signed certificate must not be accepted");
  } catch (error: unknown) {
    caught = error;
  }

  // Node rejected it, and the classifier recognizes the rejection so the
  // adapter reports a configuration failure instead of retrying forever.
  assert.equal(isTlsVerificationError(caught), true);
  assert.equal(transportError(caught, "unreachable").retryable, false);
  assert.equal(
    transportError(caught, "unreachable").code,
    "invalid_configuration",
  );
});

/**
 * Builds a throwaway self-signed certificate at run time, so no key material is
 * ever committed. Returns undefined when openssl is unavailable.
 */
function createSelfSignedCertificate():
  { cert: string; key: string } | undefined {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lmw-tls-"));
  const keyPath = path.join(directory, "key.pem");
  const certPath = path.join(directory, "cert.pem");
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    rmSync(directory, { recursive: true, force: true });
    return undefined;
  }
  const material = {
    key: readFileSync(keyPath, "utf8"),
    cert: readFileSync(certPath, "utf8"),
  };
  rmSync(directory, { recursive: true, force: true });
  return material;
}
