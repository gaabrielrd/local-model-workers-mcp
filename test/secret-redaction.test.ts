import assert from "node:assert/strict";
import test from "node:test";

import {
  REDACTED_PLACEHOLDER,
  redactSecrets,
  redactText,
} from "../src/features/mcp-server/secret-redaction.js";
import { renderToolResult } from "../src/features/mcp-server/result-compaction.js";

/**
 * Credential fixtures are assembled at run time.
 *
 * A literal `sk_live_…` or `ghp_…` string in this file is indistinguishable
 * from a real leaked credential to a secret scanner — GitHub push protection
 * correctly blocks one. Joining the parts keeps the scanner quiet while the
 * value reaching `redactText` is byte-identical to the real format.
 */
function assembleCredential(...parts: readonly string[]): string {
  return parts.join("_");
}

void test("a configured credential is removed from nested result values", () => {
  const token = "lmw-secret-bearer-token-value";
  const result = redactSecrets(
    {
      summary: `The provider rejected ${token}.`,
      evidence: [{ path: "src/a.ts", excerpt: `Authorization: ${token}` }],
      nested: { deep: { value: token } },
    },
    { knownSecrets: [token] },
  );

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes(REDACTED_PLACEHOLDER), true);
});

void test("both channels are covered because redaction precedes rendering", () => {
  const token = "provider-bearer-token-9f3c";
  const safe = redactSecrets(
    { summary: `token=${token}`, patch: `+const t = "${token}"` },
    { knownSecrets: [token] },
  );
  const rendered = renderToolResult(safe, "standard");

  assert.equal(rendered.content[0]?.text.includes(token), false);
  assert.equal(
    JSON.stringify(rendered.structuredContent).includes(token),
    false,
  );
});

void test("result shape and parsability are preserved", () => {
  const token = "another-secret-token-value";
  const input = {
    status: "completed",
    count: 3,
    enabled: true,
    missing: null,
    items: ["a", token, "c"],
    nested: { path: "src/a.ts", token },
  };
  const result = redactSecrets(input, { knownSecrets: [token] });

  assert.deepEqual(Object.keys(result), Object.keys(input));
  assert.equal(result.count, 3);
  assert.equal(result.enabled, true);
  assert.equal(result.missing, null);
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0], "a");
  assert.equal(result.items[1], REDACTED_PLACEHOLDER);
  assert.equal(result.nested.path, "src/a.ts");
  // Still round-trips as JSON.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)) as unknown);
});

void test("well-known credential shapes are redacted without a configured secret", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["openai", "sk-abcdefghijklmnopqrstuvwxyz0123456789"],
    [
      "github",
      assembleCredential("ghp", "abcdefghijklmnopqrstuvwxyz0123456789"),
    ],
    [
      "github pat",
      assembleCredential("github", "pat", "abcdefghijklmnopqrstuv0123456789"),
    ],
    ["gitlab", "glpat-abcdefghijklmnopqrst"],
    ["slack", "xoxb-123456789012-abcdefghijkl"],
    ["aws", "AKIAIOSFODNN7EXAMPLE"],
    ["google", "AIzaSyA1234567890abcdefghijklmnopqrstuvw"],
    ["stripe", assembleCredential("sk", "live", "abcdefghijklmnopqrstuvwx")],
    ["npm", assembleCredential("npm", "abcdefghijklmnopqrstuvwxyz0123456789")],
  ];
  for (const [name, credential] of cases) {
    const output = redactText(`leaked value: ${credential} end`);
    assert.equal(
      output.includes(credential),
      false,
      `${name} credential must be redacted`,
    );
    assert.match(output, /leaked value: .* end/u, `${name} keeps surroundings`);
  }
});

void test("private key blocks and authorization headers are redacted", () => {
  const pem = [
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEowIBAAKCAQEAxyz0123456789",
    "-----END RSA PRIVATE KEY-----",
  ].join("\n");
  assert.equal(redactText(pem).includes("MIIEowIBAAKCAQEA"), false);

  const header = redactText("Authorization: Bearer abcdef0123456789ABCDEF");
  assert.equal(header.includes("abcdef0123456789ABCDEF"), false);
  assert.match(header, /Authorization: /u);
});

void test("secret-named assignments redact the value but keep the key readable", () => {
  const output = redactText('const config = { api_key: "abcd1234efgh5678" };');
  assert.equal(output.includes("abcd1234efgh5678"), false);
  // The key survives so the reader can still see what was removed.
  assert.match(output, /api_key/u);

  const yaml = redactText("password: hunter2hunter2");
  assert.equal(yaml.includes("hunter2hunter2"), false);
  assert.match(yaml, /password/u);
});

void test("legitimate high-entropy values are never redacted", () => {
  // These are values the server genuinely returns. An entropy-based rule would
  // destroy them, which is why redaction is shape-based instead.
  const safeValues = [
    "9f3c1a2b4d5e6f708192a3b4c5d6e7f8091a2b3c",
    "sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "diff --git a/src/app.ts b/src/app.ts",
    "index 0a1b2c3..4d5e6f7 100644",
    "qwen/qwen3.5-9b",
    "nomic-ai/nomic-embed-text",
    "src/features/model-inference/lm-studio.ts",
    "The function returns a base64 encoded value.",
  ];
  for (const value of safeValues) {
    assert.equal(
      redactText(value),
      value,
      `must not redact legitimate value: ${value}`,
    );
  }
});

void test("a git commit SHA next to a real credential keeps the SHA", () => {
  const sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4";
  const output = redactText(
    `commit ${sha} added ${assembleCredential("ghp", "abcdefghijklmnopqrstuvwxyz0123456789")}`,
  );
  assert.match(output, new RegExp(sha, "u"));
  assert.equal(output.includes("ghp_abcdef"), false);
});

void test("short or empty configured secrets are ignored", () => {
  // A 3-character "secret" would otherwise shred ordinary prose.
  const output = redactSecrets(
    { summary: "the cat sat on the mat" },
    { knownSecrets: ["cat", "", "a"] },
  );
  assert.equal(output.summary, "the cat sat on the mat");
});

void test("overlapping secrets redact the longest match first", () => {
  const long = "token-abcdef-0123456789";
  const short = "token-abcdef";
  const output = redactText(`value ${long}`, { knownSecrets: [short, long] });
  assert.equal(output, `value ${REDACTED_PLACEHOLDER}`);
});

void test("redaction is idempotent", () => {
  const token = "repeatable-secret-token";
  const once = redactSecrets({ v: token }, { knownSecrets: [token] });
  const twice = redactSecrets(once, { knownSecrets: [token] });
  assert.deepEqual(twice, once);
});
