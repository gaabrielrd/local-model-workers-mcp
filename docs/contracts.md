# Core contracts

**Status:** Implemented transport-neutral foundation
**Last reviewed:** 2026-08-02

## Approved tool names

The product has exactly six technical tool names:

- `explore_repository`
- `propose_tests`
- `check_health`
- `get_config`
- `validate_config`
- `update_config`

Only `explore_repository` and `propose_tests` use the task response envelope.
The other four tools return their own synchronous result contracts and must not
add `task_id`, `status`, or `model` merely for visual consistency. Configuration
responses may expose their own redacted revision field as required by RF-22
through RF-24; that does not turn them into remote tasks.

These names are registered through strict Zod input schemas by the MCP v2
`stdio` composition root. There are no resource, prompt, shell, generic
filesystem, or execution registrations.

## Task identity and terminal states

Every task response contains:

- `task_id`: non-empty identifier for the isolated invocation;
- `status`: one terminal state;
- `model`: the selected model identifier;
- `config_revision`: the immutable effective configuration revision captured at
  task creation;
- `evidence`: locally validated evidence, or an empty list;
- `limitations`: explicit limitations and their impact, or an empty list.

The only terminal states are `completed`, `blocked`, `failed`, `cancelled`, and
`timed_out`.

### Completed response

A completed response contains `result` and cannot contain `diagnostic` or
`partial_result`. The feature that owns the tool supplies and validates the
tool-specific result schema.

```json
{
  "task_id": "task-123",
  "status": "completed",
  "model": "allowed-model",
  "config_revision": "revision-7",
  "result": {},
  "evidence": [],
  "limitations": []
}
```

### Non-completed response

Blocked, failed, cancelled, and timed-out responses contain `diagnostic` and
cannot contain `result`. Partial work may be described only as diagnostic
context and must never use `completed`.

```json
{
  "task_id": "task-123",
  "status": "blocked",
  "model": "allowed-model",
  "config_revision": "revision-7",
  "diagnostic": {
    "code": "invalid_evidence",
    "message": {
      "language": "pt-BR",
      "text": "A evidência não pôde ser validada."
    },
    "issues": [],
    "redaction_count": 0
  },
  "evidence": [],
  "limitations": []
}
```

All response objects use strict runtime schemas. Unknown fields are rejected
instead of being silently copied into a wire response.

## Human text and technical names

Human-facing text is represented as `language` plus `text`. `language` uses a
bounded BCP-47-style identifier such as `en`, `pt`, or `pt-BR`. This keeps the
request language explicit while technical keys, tool names, states, progress
stages, and error codes remain in English.

No translation service exists at this layer. Each use case is responsible for
providing human text in the request language.

## Evidence and limitations

Evidence contains a path, positive inclusive `start_line` and `end_line`, and a
localized explanation. The contract rejects reversed or non-positive ranges.
Repository features must additionally prove that the path and lines exist in
the analyzed version before constructing a completed result.

A limitation contains a stable snake-case code, localized description,
localized impact, and zero or more affected paths. Empty lists are explicit;
context truncation must never be silent.

## Progress stages

Transport-neutral task progress uses only:

- `queued`
- `exploring`
- `consulting_model`
- `preparing_result`

Task 013 maps these domain events to MCP notifications when the harness supports
them.

## Isolated task runtime

The implemented runtime creates one identifier, model selection, deep-frozen
effective configuration snapshot, content scope, cancellation controller,
processing deadline, and progress sequence per task. The runtime emits `queued`
at creation, but starts the processing deadline only when `run` begins; time
spent waiting for future Task 009 capacity therefore cannot consume processing
time.

Work receives a transport-neutral context with the task identity, immutable
configuration, composed abort signal, remaining processing time, progress
emitter, scoped content store, and a structured-inference method. Inference is
always pinned to the captured model and receives the remaining original
deadline, so the adapter's bounded retry cannot reset or multiply task time.

Cancellation, processing timeout, work completion, and work failure race for
one terminal response. Later events cannot replace it, and repeated `run` calls
observe the same promise rather than starting work again. Invalid or thrown work
becomes a fixed redaction-safe failed diagnostic; partial work has no completed
shape.

The content scope separates goals, snippets, prompts, responses, and patches.
Every terminal path overwrites and clears its arrays, closes the scope, removes
listeners, clears the timer, and aborts remaining child work. Closed scopes
return no prior content and reject new writes. The runtime does not implement a
queue or global capacity; those belong to Task 009.

## Error codes

| Code | Intended category |
| --- | --- |
| `invalid_request` | Tool input is empty, malformed, or inconsistent |
| `invalid_configuration` | Effective or proposed configuration is invalid |
| `repository_not_found` | Requested root does not exist or is not a directory |
| `repository_access_denied` | Path or filesystem policy rejects access |
| `invalid_evidence` | Cited evidence cannot be verified |
| `model_unauthorized` | Model is outside the protected allowlist |
| `model_unavailable` | Authorized model is not available from LM Studio |
| `inference_failed` | Remote inference fails or returns invalid output |
| `context_limit_exceeded` | Context budget prevents required analysis |
| `interaction_limit_exceeded` | Exploration reaches its interaction limit |
| `patch_not_allowed` | Proposed patch targets a prohibited or ambiguous path |
| `patch_limit_exceeded` | Proposed patch exceeds file or line limits |
| `configuration_conflict` | Expected and current revisions differ |
| `confirmation_required` | A write was requested without matching approval |
| `task_cancelled` | Harness or connection cancellation stops the task |
| `queue_timeout` | Capacity was unavailable before the queue deadline |
| `processing_timeout` | Active work exceeded its processing deadline |
| `internal_error` | Unexpected local failure after safe redaction |

The catalog may gain a code only when a concrete feature needs a distinct,
actionable failure category. Existing meanings cannot be silently repurposed.

## Diagnostic redaction

Diagnostics are constructed from typed public messages and issues, not raw
exception objects. Known secret values are replaced with `[REDACTED]` in every
human text field. `redaction_count` records how many replacements occurred, so
an original literal `[REDACTED]` is distinguishable from an actual replacement
without exposing the secret.

Redaction is a final safety layer, not permission to put credentials into
diagnostic inputs or logs.

## Feature boundary

Contracts are transport-neutral and do not import MCP SDK or LM Studio wire
types. Product features may import another feature only from its public
`index.ts`; `src/shared` cannot depend on a product feature. The validation gate
checks both rules and includes negative fixtures proving violations fail.
