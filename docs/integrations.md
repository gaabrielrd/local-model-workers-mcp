# External integrations

**Status:** Contract outline; integration code and setup commands do not exist  
**Last reviewed:** 2026-08-02

## Claude Code and Codex

Both harnesses start the local MCP server as a child process and communicate over
`stdio`. The server exposes exactly the six tools listed in the PRD. Harnesses
remain responsible for:

- collecting explicit confirmation for `update_config`;
- showing progress and structured results;
- deciding whether to apply a proposed patch;
- executing suggested test commands under the harness's own permissions;
- forwarding cancellation when a call or connection ends.

The server must keep stdout reserved for MCP protocol messages. Operational
diagnostics use a protocol-safe channel and must never contain protected or
repository content.

Concrete Claude Code and Codex configuration snippets will be added only after
an executable command and package entry point exist. Existing harness
configuration must never be overwritten without confirmation.

## LM Studio

LM Studio runs on another developer-controlled machine and provides the remote
model through an HTTP-compatible API.

The integration must:

- use a configured Bearer token;
- allow only configured model identifiers;
- fail when a requested model is unauthorized or unavailable rather than
  silently substituting another model;
- use one retry by default for a transient failure;
- honor task cancellation and processing deadlines;
- send only context that has passed local path, sensitivity, ignore, binary, and
  budget filters;
- treat every response as untrusted and validate it locally.

`check_health` verifies configuration validity, reachability, authentication,
the default model, and all allowed models without reading a repository. The
specific LM Studio endpoint paths and compatible API version are still to be
selected and documented.

HTTP is supported only on a trusted private local network. HTTPS may be used
when the environment provides it, but proxy and certificate management are not
part of V1. Public exposure is unsupported.

## Git

Git is used to identify ignored files before context is selected. If ignore
status cannot be determined safely, the server must not send the uncertain file.
Git is not used to modify, stage, commit, or revert repository content.

## Local filesystem

The filesystem integration provides only bounded directory listing, text
search, and snippet reads to task code. It also supports configuration and
metadata-only operational logs through separate adapters. Canonical path and
symlink checks occur before access; permission failures never trigger an attempt
to expand process privileges.

Project preference updates are atomic and revision-controlled. The exact
configuration and log locations are not yet defined.

## Project test infrastructure

`propose_tests` detects existing test conventions and may suggest unit or
integration tests using that infrastructure. It does not install dependencies,
create a missing test framework, run commands, contact real external services,
or propose browser, GUI, or mobile tests in V1.

If usable infrastructure is absent, the result is `blocked` with compatible
options for the developer. Suggested commands are returned as text for the
harness to review and run.

## Failure behavior

| Integration | Required failure behavior |
| --- | --- |
| Harness transport | Return a structured MCP error when possible and cancel owned work on disconnect |
| LM Studio | Classify reachability, authentication, unavailable-model, timeout, and malformed-response failures without leaking credentials |
| Git | Exclude content whose ignore status cannot be established safely |
| Filesystem | Return a scoped error; never expand access or follow an escaping symlink |
| Test infrastructure | Return `blocked` without a patch when no usable framework exists |

## Implementation documentation checklist

When an integration becomes executable, update this document with its supported
versions, exact configuration fields, timeouts, setup and health-check commands,
expected errors, and a secret-safe troubleshooting example.

