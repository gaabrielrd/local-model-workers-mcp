# ADR-0011: Execute auto-validate tests only inside an ephemeral sandbox

**Status:** Accepted
**Date:** 2026-08-02

## Context

Task 024 adds `auto_validate_tests`: the local server generates test
proposals, executes them, and iterates until they pass. This is the first
product capability that runs arbitrary repository test commands. ADR-0001
keeps the local server as the security boundary: the remote model never writes
to the repository, applies a patch, or executes commands. Execution must
therefore happen locally, and the repository must never be a target of that
execution.

## Decision

The model only proposes a unified diff. The server applies it and runs the
test command itself inside a disposable copy:

- `createSandbox` copies the canonical repository root into a fresh temporary
  directory, excluding version-control, dependency, and build directories
  (`.git`, `node_modules`, `.venv`, `dist`, `__pycache__`, and similar).
  Symlinks are preserved verbatim so escapes can be detected, not hidden.
- `applyValidatedPatch` accepts only hunks that add a new file or edit an
  existing one. Renames, copies, deletions, binary changes, `..` path
  segments, and repeated paths are rejected. Every target is canonicalized
  with `realpath` and must remain inside the canonicalized sandbox root,
  which defeats symlink escapes and the macOS `/var` to `/private/var`
  discrepancy.
- `runSandboxProcess` spawns the command with `shell: false`, detached into a
  new process group, with a hard timeout, an abort signal, and 64 KB bounded
  capture of stdout and stderr. On timeout or abort the whole process group is
  killed with SIGKILL. Proxy environment variables are stripped.
- The loop returns a validated patch only when an attempt exits 0 with at
  least one passing test and no failures or errors. Otherwise it refines the
  proposal and iterates up to `max_iterations`, returning the best attempt
  with diagnostics when exhausted.
- The temporary directory is always removed in a `finally` block.

## Consequences

- The original repository is never modified; the existing repository reads
  remain fail-closed and read-only.
- The remote model gains no write or execution capability; it only proposes
  test-only patches, which are still validated by the existing test-proposal
  pipeline.
- macOS and Linux lack a native network namespace isolation we could enforce
  from Node without extra privileges. Network restriction is best-effort
  (proxy variables stripped, no shell features); this is documented as a
  limitation of the sandbox.
- Sandbox processes are bounded by timeout, process-group termination, and
  output capture limits, so a hung or noisy test cannot consume unbounded
  resources.
- Test commands execute with the same user identity as the server; the
  sandbox isolates files, not the operating system.

## Alternatives considered

- Executing tests directly in the working repository was rejected because it
  would violate ADR-0001 and risk destructive writes.
- Container-based isolation was rejected because it adds a runtime
  dependency the product currently avoids; the temporary-copy sandbox keeps
  the deployment footprint unchanged.
- Having the model apply its own patch would move write authority to the
  remote model and was rejected outright.
