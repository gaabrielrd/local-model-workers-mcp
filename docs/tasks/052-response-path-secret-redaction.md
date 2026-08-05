# Task 052: Response-Path Secret Redaction

**Status:** Implemented (v2.8.0)
**Depends on:** Task 051 (prompt-injection hardening), Task 007 (inference provider)

## Objective

Ensure that credentials a model might echo back — for example a token read from
repository content or a configured Bearer credential — never reach the harness
transcript, on either the text content block or `structuredContent`.

## Key Design Decisions

- **Response scrubber at the MCP boundary:** applied in the `callTool` wrapper
  next to the existing verbosity-aware `renderToolResult`, so feature code
  stays unaware and every tool inherits the guarantee.
- **Two-layer matching:** exact-match on configured secrets (provider Bearer
  tokens, protected credentials) plus pattern-based redaction of
  high-entropy/credential-shaped values (long base64/hex runs, known token
  prefixes) so repository-sourced secrets are covered without storing them.
- **Redact, never drop:** the field keeps a stable `[REDACTED]` placeholder so
  result shape and parsability are unchanged.
- **Both channels covered:** the scrubber runs on the final payload before it is
  split into `content[0].text` and `structuredContent`.
- **No schema change:** strict tool input/output schemas are untouched.

## Acceptance Criteria

- [x] A configured credential echoed by the model is absent from returned
      results in both the text block and `structuredContent`.
- [x] Pattern-based redaction removes repository-sourced credential-shaped
      values without false-positive breakage on normal output.
- [x] Result shape and parsability are preserved (placeholder, not omission).
- [x] Public tool schemas unchanged.
- [x] `npm run validate` green.

## Files Changed (anticipated)

- `src/features/mcp-server/` (MODIFIED — response scrubber and `callTool`
  wiring)
- `src/features/configuration/` (MODIFIED — secret registry feeding exact-match)
- `test/` (NEW — redaction tests for both channels)
- `docs/architecture.md` (MODIFIED — response-path redaction note)
- `docs/tasks/052-response-path-secret-redaction.md` (NEW — this document)

## Implementation notes

- `src/features/mcp-server/secret-redaction.ts` runs in `callTool`, on the final
  payload, before `renderToolResult` splits it. Both the text block and
  `structuredContent` are therefore covered by construction rather than by two
  parallel code paths. Tool error messages are scrubbed on the same boundary.
- Exact-match secrets come from `runtimeSecrets()`: the process Bearer token
  plus every configured provider `bearer_token`. Secrets shorter than 8
  characters are ignored, and matches are applied longest-first so an
  overlapping shorter secret cannot leave a visible tail.
- Shape matching covers issuer-prefixed credentials (OpenAI, GitHub, GitLab,
  Slack, AWS, Google, Stripe, npm), PEM private-key blocks,
  `Authorization: Bearer|Basic` headers, and secret-named assignments.
- **Generic entropy detection was deliberately rejected.** This server returns
  git commit SHAs, `sha256:` content hashes, and file fingerprints as normal
  output; a "long hex/base64 run" rule would redact them and corrupt results. A
  regression test pins that behavior.
- Values are replaced with a stable `[REDACTED]` placeholder, never omitted, so
  result shape and JSON parsability are unchanged.
