# Task 013: Compose the MCP stdio server

**Status:** Completed
**Depends on:** Tasks 004, 007, 010, 011, and 012  
**PRD coverage:** RF-01, RF-02, RF-20, RF-27; CA-01, CA-02, CA-30, CA-41, CA-42

## Objective

Compose all completed feature use cases behind exactly six schema-validated MCP
tools over local `stdio`, with cancellation, progress, uniform responses, and
protocol-safe diagnostics.

## Requirements

- Start locally as an MCP child process over `stdio`.
- Invalid required startup configuration fails before tool service begins and
  never prints credentials.
- Expose exactly `explore_repository`, `propose_tests`, `check_health`,
  `get_config`, `validate_config`, and `update_config`.
- Do not expose generic shell, filesystem, prompt, or execution tools.
- Validate inputs before invoking feature use cases.
- Map transport cancellation and connection close to task cancellation.
- Emit progress notifications when supported without making them required for
  final results.
- Serialize all outcomes through the contracts from Task 002.
- Reserve stdout for protocol frames; diagnostics and logs use safe channels.
- Dispose resources and active tasks on orderly shutdown.

## Non-scope

No harness configuration mutation, installer assistant, remote MCP transport,
HTTP listening server, patch application, or command execution.

## Implementation outline

1. Create a composition root that depends only on public feature exports.
2. Register the six tools with explicit input and output schemas.
3. Map each tool to its domain use case and error contract.
4. Map task progress events to MCP notifications.
5. Propagate cancellation and shutdown.
6. Add process-level MCP contract tests over real `stdio`.
7. Generate or document tool contracts from the authoritative schemas.

## Expected areas

- `src/features/mcp-server`
- Application composition root and executable MCP mode
- MCP process test client
- Generated/manual tool reference documentation

## Tests

- Discovery returns exactly the six approved names and schemas.
- Each tool has success, validation, blocked, failure, timeout, and cancellation
  coverage where applicable.
- Invalid startup configuration reveals no secret.
- Empty exploration goal fails before an LM request.
- Progress-supported and progress-unsupported clients receive the same final
  result.
- Disconnect cancels owned tasks and releases capacity.
- Concurrent protocol requests do not mix responses.
- No non-protocol bytes are written to stdout.
- Portuguese request summaries preserve English technical fields.

## Risks

- Libraries or accidental console calls can corrupt stdout framing.
- Transport exceptions can bypass uniform result/redaction logic.
- Tool schemas can drift from domain contracts if duplicated manually.

## Acceptance criteria

- RF-01, RF-02, RF-20, and RF-27 pass through an MCP client process.
- CA-01 and CA-02 are technically possible with the same executable; real
  harness setup is completed in Task 014.
- CA-30, CA-41, and CA-42 pass over MCP, not only at feature boundaries.
- No additional tool can be discovered.
- `npm run validate` passes.
