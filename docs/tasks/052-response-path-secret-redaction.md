# Task 052: Response-Path Secret Redaction

**Status:** Planned (v2.8.0)
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

- [ ] A configured credential echoed by the model is absent from returned
      results in both the text block and `structuredContent`.
- [ ] Pattern-based redaction removes repository-sourced credential-shaped
      values without false-positive breakage on normal output.
- [ ] Result shape and parsability are preserved (placeholder, not omission).
- [ ] Public tool schemas unchanged.
- [ ] `npm run validate` green.

## Files Changed (anticipated)

- `src/features/mcp-server/` (MODIFIED — response scrubber and `callTool`
  wiring)
- `src/features/configuration/` (MODIFIED — secret registry feeding exact-match)
- `test/` (NEW — redaction tests for both channels)
- `docs/architecture.md` (MODIFIED — response-path redaction note)
- `docs/tasks/052-response-path-secret-redaction.md` (NEW — this document)
