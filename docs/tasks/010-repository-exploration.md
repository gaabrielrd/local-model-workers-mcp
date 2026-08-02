# Task 010: Implement repository exploration

**Status:** Completed
**Depends on:** Tasks 006-009  
**PRD coverage:** RF-04, RF-06, RF-07, RF-20 progress source; CA-06, CA-14, CA-15, CA-30, CA-41, CA-42, CA-48

## Objective

Implement the complete transport-neutral `explore_repository` use case: accept
a goal and root, perform a bounded remote-guided read loop, and return a
structured analysis whose evidence is locally verified.

## Requirements

- Require a non-empty goal and valid repository root, with optional priority
  paths confined to that root.
- Create an isolated task through the global coordinator and emit
  `queued`, `exploring`, `consulting_model`, and
  `preparing_result` progress events as applicable.
- Offer LM Studio only the three filtered read capabilities through a controlled
  iterative protocol.
- Enforce the effective maximum interactions and context budget.
- Validate every cited path and line range against the exact analyzed version.
- Return summary, relevant files, evidence, risks, next steps, analyzed files,
  relevant unread files, limitations, and limitation impact.
- Never invent or silently discard an invalid citation.
- Preserve technical English fields and write explanations in the request
  language.
- Detect changes in files used for evidence before final delivery and block
  unverifiable output.

## Non-scope

No test generation, patch parsing, repository writes, command execution, native
subagents, cross-task synthesis, or MCP registration.

## Implementation outline

1. Define the exploration request and result contracts.
2. Create a system-controlled prompt/protocol for bounded list, search, and read
   requests.
3. Map remote operation requests to the filtered repository capability.
4. Track budgets, analyzed/unread paths, fingerprints, and limitations.
5. Request a final structured analysis and parse it as untrusted data.
6. Validate evidence and file versions locally.
7. Map all outcomes to the uniform response envelope.
8. Document examples, limitations, and error behavior.

## Expected areas

- `src/features/repository-exploration`
- Exploration protocol and model-response parser
- Feature and fake-LM integration fixtures
- Tool contract and user documentation

## Tests

- Empty goal, invalid root, and escaping priority scope make no network request.
- Direct success with valid evidence.
- Multi-interaction discovery under the limit.
- Interaction and context exhaustion with explicit limitations and impact.
- Unknown operation, malformed model request, or instruction-injection attempt.
- Missing path, invalid line range, stale fingerprint, and invented evidence.
- Portuguese goal produces Portuguese explanations with English fields.
- Progress event order for success, block, timeout, and cancellation.
- No content from one exploration appears in the next.

## Risks

- A flexible model-tool protocol can accidentally expose generic execution.
- Evidence may validate against current rather than analyzed content.
- Context minimization and adequate analysis can pull in opposite directions.

## Acceptance criteria

- CA-06, CA-14, CA-15, CA-30, CA-41, CA-42, and the exploration portion of
  CA-48 pass.
- The feature returns all RF-07 fields or an explicit reason when not applicable.
- Invalid evidence cannot appear in a completed result.
- The repository remains byte-for-byte unchanged.
- `npm run validate` passes.
