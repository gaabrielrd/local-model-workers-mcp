# ADR-0001: Keep repository authority in the local MCP server

- **Status:** Accepted
- **Date:** 2026-08-02
- **Source:** Approved PRD sections 1, 3, 4, 6, 10, and 15

## Context

The product delegates repository-heavy analysis to an LM Studio model running
on another machine. Sending unrestricted repository access or allowing the
remote worker to write or execute commands would expand the trust boundary,
make Claude Code and Codex behave differently, and increase the impact of prompt
injection or malformed model output.

The V1 needs a portable MCP interface for both harnesses while the developer
retains authority over repository changes and command execution.

## Decision

Run the MCP server as a local process over `stdio`. The local server is the sole
authority for repository access, configuration resolution, task limits, context
selection, outbound filtering, and remote-output validation.

LM Studio is reached only through authenticated HTTP on a trusted private local
network. It receives bounded text selected for a single task and cannot invoke a
generic shell, write files, apply patches, install dependencies, or run tests
through this product.

Test proposals return a locally validated unified diff. The harness and
developer decide whether to apply it and run any suggested command. Task content
is discarded when the task ends; logs retain only approved operational metadata
for seven days.

## Consequences

### Positive

- Both harnesses use the same tools and security rules.
- Network exposure is limited to inference traffic.
- Repository path, secret, ignore, context, evidence, and patch rules are
  enforceable and testable locally.
- The developer keeps existing harness approvals for writes and command
  execution.
- Remote failures cannot directly modify the repository.

### Negative

- The local server must implement robust path handling, output parsing,
  redaction, cancellation, and change detection.
- Remote model output cannot be trusted or returned directly.
- A valid proposal requires additional local validation and may be blocked when
  classification is uncertain.
- Plain HTTP remains appropriate only for a trusted private network; public
  deployment is explicitly unsupported.

## Alternatives considered

### Give the remote worker direct repository access

Rejected because it would move filesystem authority to another machine and make
root containment, secrets, writes, and auditing harder to enforce.

### Let the MCP server apply patches and execute tests

Rejected because it duplicates harness permissions and requires additional
rollback, process sandboxing, and command-approval mechanisms.

### Expose the MCP server over HTTP

Rejected for V1 because local `stdio` already works with both harnesses and
avoids another listening service and authentication boundary.

### Require HTTPS for LM Studio

Rejected as a V1 requirement because local certificate management would raise
setup cost. HTTPS is accepted when provided, while HTTP is restricted to a
trusted private network with Bearer authentication.
