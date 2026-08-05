# Task 053: Transport Hardening for the Model Hop

**Status:** Implemented (v2.9.0)
**Depends on:** Task 006 (remote client), Task 007 (inference provider)

## Objective

Add an optional HTTPS + TLS certificate validation path for provider
connections so repository content cannot be sniffed and a fake model cannot be
injected on a network whose trust boundary is weaker than the current
"trusted private LAN" assumption. Keep the existing behavior as the default for
backward compatibility.

## Key Design Decisions

- **Protected configuration, not editable preferences:** TLS verification is a
  protected setting (environment/constants) so repository content can never
  disable it. Envisioned shape: a per-provider `tls_verify` flag plus an
  optional custom CA / hostname override, or a process-wide protected toggle.
- **Fail closed when enabled:** with verification on, self-signed, expired,
  mismatched-host, or otherwise invalid certificates reject the connection and
  surface through the existing health and error signals.
- **Backward compatible when disabled:** the default keeps the current
  trusted-LAN HTTP/HTTPS-without-validation behavior and records it as an
  explicit, documented non-blocking limitation.
- **Applies to all adapters:** LM Studio, vLLM, and LocalAI (OpenAI-compatible)
  and Ollama share the verification path through the provider adapter layer.

## Acceptance Criteria

- [x] HTTPS provider URLs validate certificates when verification is enabled.
- [x] Invalid certificates fail closed and produce a clear health/error signal.
- [x] HTTP remains supported when verification is disabled (no regression).
- [x] Verification cannot be weakened through editable project/global
      preferences.
- [x] `npm run validate` green.

## Files Changed (anticipated)

- `src/features/model-inference/` (MODIFIED — TLS options in all adapters)
- `src/features/configuration/` (MODIFIED — protected TLS settings)
- `src/features/health/` (MODIFIED — TLS status reporting)
- `test/` (NEW — TLS fixture server with valid/invalid certificates)
- `docs/configuration.md`, `docs/architecture.md` (MODIFIED — transport
  hardening notes)
- `docs/tasks/053-transport-hardening-model-hop.md` (NEW — this document)

## Implementation notes

- Protected per-provider `tls_verify` flag on `LMW_PROVIDERS`. It lives in the
  process environment only, so editable project/global preferences and
  repository content can never weaken it.
- `src/features/model-inference/transport-security.ts` enforces the two ways the
  posture is silently lost when verification is on: a plain `http:` URL to a
  non-loopback host, and `NODE_TLS_REJECT_UNAUTHORIZED=0` which would make
  `https:` meaningless. Loopback HTTP stays allowed because it never leaves the
  machine.
- The check runs in `createProviderAdapter`, so an unverifiable provider fails
  at startup rather than mid-task.
- Certificate validation itself is performed by Node's TLS stack. Previously the
  adapters discarded the fetch error and threw a **retryable**
  `endpoint_unreachable`, so a rejected certificate looked like a transient blip
  and was retried. `transportError` now walks the error `cause` chain and maps
  verification failures to a non-retryable `invalid_configuration` with a clear
  message.
- Default behavior is unchanged: with `tls_verify` absent or false, HTTP on a
  trusted LAN keeps working exactly as before.
