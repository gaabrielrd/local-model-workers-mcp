import { InferenceError } from "./contracts.js";

/**
 * Transport hardening for the model hop.
 *
 * The default posture assumes a trusted private LAN and allows plain HTTP.
 * When a provider opts into verification, this module enforces the two ways
 * that posture is silently lost:
 *
 * 1. an `http:` URL to a non-loopback host, where repository content crosses
 *    the network in the clear and a fake model can be injected;
 * 2. `NODE_TLS_REJECT_UNAUTHORIZED=0`, which disables Node's certificate
 *    validation process-wide and would otherwise make `https:` meaningless.
 *
 * Certificate validation itself is performed by Node's TLS stack. This module
 * makes sure it is actually in force and turns its failures into a clear,
 * fail-closed signal instead of a generic network error.
 */

/** Hosts where plain HTTP never leaves the machine. */
const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

/**
 * OpenSSL / Node verification failures. Any of these means a certificate was
 * presented and rejected — never a transient condition, so they must not be
 * retried.
 */
const TLS_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_SIGNATURE_FAILURE",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
  "EPROTO",
]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * Returns true when the environment has globally disabled certificate
 * validation. Checked at request time because the variable can be set late.
 */
export function tlsValidationDisabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.NODE_TLS_REJECT_UNAUTHORIZED === "0";
}

export interface AssertTransportSecurityInput {
  readonly baseUrl: string;
  /** Provider `tls_verify`. Defaults to false to preserve trusted-LAN behavior. */
  readonly tlsVerify?: boolean | undefined;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

/**
 * Fails closed when a provider that requires verification cannot actually get
 * it. A no-op when `tls_verify` is disabled, which is the default.
 */
export function assertTransportSecurity(
  input: AssertTransportSecurityInput,
): void {
  if (input.tlsVerify !== true) {
    return;
  }

  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    throw new InferenceError(
      "invalid_configuration",
      "The provider base URL is not a valid URL.",
    );
  }

  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    throw new InferenceError(
      "invalid_configuration",
      "This provider requires TLS verification, so a plain HTTP base URL to a remote host is refused.",
    );
  }

  if (url.protocol === "https:" && tlsValidationDisabled(input.environment)) {
    throw new InferenceError(
      "invalid_configuration",
      "This provider requires TLS verification, but NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate validation.",
    );
  }
}

/**
 * Recognizes a certificate-validation failure anywhere in an error chain.
 *
 * `fetch` wraps the underlying TLS error in `cause`, sometimes more than one
 * level deep, so the chain is walked rather than inspected at the top only.
 */
export function isTlsVerificationError(error: unknown): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 5 && current !== null && current !== undefined;
    depth += 1
  ) {
    if (typeof current !== "object") {
      return false;
    }
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && TLS_ERROR_CODES.has(code)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Maps a transport failure to an inference error.
 *
 * Certificate failures are reported as non-retryable `invalid_configuration`:
 * retrying an untrusted certificate would only repeat the same rejection, and
 * silently degrading to a retryable network error would hide the cause.
 */
export function transportError(
  error: unknown,
  fallbackMessage: string,
): InferenceError {
  if (isTlsVerificationError(error)) {
    return new InferenceError(
      "invalid_configuration",
      "The provider TLS certificate could not be verified.",
    );
  }
  return new InferenceError("endpoint_unreachable", fallbackMessage, true);
}
