# ADR-0003: Use a strict discriminated task response contract

- **Status:** Accepted
- **Date:** 2026-08-02
- **Source:** RF-27, RN-34 through RN-37, CA-41, and CA-42

## Context

Exploration and test-proposal tasks can complete, block, fail, be cancelled, or
time out. Both Claude Code and Codex need the same machine-readable shape, while
human explanations must follow the request language. Partial model output,
unknown fields, and raw errors are unsafe to serialize as successful results.

Health and configuration tools are synchronous operations with different
semantics and should not pretend to be remote tasks.

## Decision

Use a strict, transport-neutral discriminated union for task responses:

- every task variant requires `task_id`, `status`, `model`,
  `config_revision`, `evidence`, and `limitations`;
- only `completed` contains a validated tool-specific `result`;
- `blocked`, `failed`, `cancelled`, and `timed_out` contain a typed
  `diagnostic` and cannot contain a result;
- strict runtime schemas reject unknown fields;
- human text carries an explicit language identifier while technical keys and
  values remain in English;
- diagnostics accept typed public fields, redact known secret values, and report
  a replacement count;
- health and configuration responses use separate contracts and omit task
  identity fields unless their own requirements explicitly need a revision.

The task contract cannot import MCP SDK or LM Studio types. Transport adapters
map to it at the application edge.

## Consequences

### Positive

- Partial or diagnostic output cannot be represented as completed accidentally.
- Both harnesses receive identical technical states and error codes.
- Tool-specific success schemas retain stronger guarantees than a generic
  result bag.
- Language handling cannot translate machine-readable fields.
- Unknown remote or internal properties fail validation instead of leaking.

### Negative

- Every use case must build explicit empty evidence and limitation lists.
- A new terminal state or error category requires a deliberate contract change.
- Tool-specific parsers must be composed with the common completed schema.
- Redaction requires callers to supply known secrets and does not replace safe
  error construction.

## Alternatives considered

### One optional-field response object

Rejected because it permits contradictory combinations such as `completed`
with only a diagnostic or `failed` with an applicable result.

### Return raw SDK or model responses

Rejected because transport and model versions would leak into every feature and
untrusted fields could bypass local validation.

### Use the task envelope for all six tools

Rejected because health and configuration operations do not create remote tasks
and would need invented identifiers or states.
