/**
 * Response-path secret redaction.
 *
 * Runs once at the MCP boundary, on the final payload, before it is split into
 * `content[0].text` and `structuredContent`. Feature code stays unaware and
 * every tool inherits the guarantee.
 *
 * Two layers:
 *
 * 1. **Exact match** on credentials this process actually holds (provider
 *    Bearer tokens). These are known strings, so matching is precise.
 * 2. **Shape match** on well-known credential formats that could arrive from
 *    repository content the model echoed back.
 *
 * Layer 2 deliberately matches *recognizable credential formats only* — issuer
 * prefixes, PEM headers, and secret-named assignments. It does not flag generic
 * high-entropy strings: this server legitimately returns git commit SHAs,
 * SHA-256 content hashes, and file fingerprints, and an entropy rule would
 * redact those and corrupt normal results.
 */

export const REDACTED_PLACEHOLDER = "[REDACTED]";

/** Below this length an "exact" secret is too short to match safely. */
const MIN_EXACT_SECRET_LENGTH = 8;

interface RedactionRule {
  readonly name: string;
  readonly pattern: RegExp;
}

/**
 * High-confidence credential shapes. Each is anchored on an issuer-specific
 * prefix or structural marker, not on entropy.
 */
const RULES: readonly RedactionRule[] = [
  { name: "openai", pattern: /\bsk-[A-Za-z0-9_-]{16,}/gu },
  { name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}/gu },
  { name: "github-pat", pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}/gu },
  { name: "gitlab-pat", pattern: /\bglpat-[A-Za-z0-9_-]{16,}/gu },
  { name: "slack", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/gu },
  { name: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/gu },
  { name: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{30,}/gu },
  { name: "stripe", pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/gu },
  { name: "npm", pattern: /\bnpm_[A-Za-z0-9]{36}\b/gu },
  {
    name: "private-key-block",
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/gu,
  },
  {
    name: "authorization-header",
    pattern: /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gu,
  },
  {
    // key = "value" / "key": "value" where the key names a credential.
    name: "secret-assignment",
    pattern:
      /\b(?:api[_-]?key|secret[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token|bearer[_-]?token|credential|private[_-]?key)\b["']?\s*[:=]\s*["']?([^\s"',;}\]]{8,})/giu,
  },
];

export interface RedactSecretsOptions {
  /** Credentials this process holds; matched exactly wherever they appear. */
  readonly knownSecrets?: readonly string[];
}

/**
 * Returns a structurally identical copy with credential values replaced by a
 * stable placeholder.
 *
 * Shape is preserved: strings stay strings, objects keep their keys, arrays
 * keep their length. Nothing is dropped, so results remain parsable.
 */
export function redactSecrets<T>(
  value: T,
  options: RedactSecretsOptions = {},
): T {
  return redactValue(value, normalizeSecrets(options)) as T;
}

/** Redacts a single string. Exposed for callers that render text directly. */
export function redactText(
  text: string,
  options: RedactSecretsOptions = {},
): string {
  return redactString(text, normalizeSecrets(options));
}

/**
 * Drops secrets too short to match safely and orders the rest longest-first, so
 * an overlapping shorter secret cannot chop a longer one into a visible tail.
 */
function normalizeSecrets(options: RedactSecretsOptions): readonly string[] {
  return (options.knownSecrets ?? [])
    .filter((secret) => secret.length >= MIN_EXACT_SECRET_LENGTH)
    .sort((left, right) => right.length - left.length);
}

function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") {
    return redactString(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets));
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = redactValue(item, secrets);
    }
    return output;
  }
  return value;
}

function redactString(text: string, secrets: readonly string[]): string {
  let output = text;

  for (const secret of secrets) {
    if (secret.length >= MIN_EXACT_SECRET_LENGTH && output.includes(secret)) {
      output = output.split(secret).join(REDACTED_PLACEHOLDER);
    }
  }

  for (const rule of RULES) {
    if (rule.name === "secret-assignment") {
      // Replace only the captured value so the key stays readable.
      output = output.replace(
        rule.pattern,
        (match, captured: string) =>
          match.slice(0, match.length - captured.length) + REDACTED_PLACEHOLDER,
      );
      continue;
    }
    output = output.replace(rule.pattern, REDACTED_PLACEHOLDER);
  }

  return output;
}
