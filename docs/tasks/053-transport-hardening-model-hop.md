# Task 053: Transport Hardening for the Model Hop

**Status:** Planned (v2.9.0)
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

- [ ] HTTPS provider URLs validate certificates when verification is enabled.
- [ ] Invalid certificates fail closed and produce a clear health/error signal.
- [ ] HTTP remains supported when verification is disabled (no regression).
- [ ] Verification cannot be weakened through editable project/global
      preferences.
- [ ] `npm run validate` green.

## Files Changed (anticipated)

- `src/features/model-inference/` (MODIFIED — TLS options in all adapters)
- `src/features/configuration/` (MODIFIED — protected TLS settings)
- `src/features/health/` (MODIFIED — TLS status reporting)
- `test/` (NEW — TLS fixture server with valid/invalid certificates)
- `docs/configuration.md`, `docs/architecture.md` (MODIFIED — transport
  hardening notes)
- `docs/tasks/053-transport-hardening-model-hop.md` (NEW — this document)
