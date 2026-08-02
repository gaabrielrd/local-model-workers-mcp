# Task 014: Package installation and harness configuration

**Status:** Pending  
**Depends on:** Tasks 003-004 and 013  
**PRD coverage:** RF-28, RN-31; platform/distribution requirements; CA-01, CA-02, CA-46

## Objective

Deliver an installable local command with a keyboard-accessible assistant that
configures Claude Code, Codex, or both without silently overwriting existing
configuration, and provides a local path for global preference changes.

## Requirements

- Decide and document package name, artifact contents, install command, update
  approach, and supported Node.js/macOS baseline.
- Generate correct server command and protected-secret references for each
  supported harness format.
- Detect existing harness configuration and show a proposed diff before any
  replacement or merge.
- Require explicit confirmation for every conflicting write.
- Write harness and global preference configuration atomically with backup or
  documented recovery where practical.
- Support Claude Code only, Codex only, both, or cancellation.
- Keep credentials out of generated agent-editable JSON and terminal output.
- Provide a local command for global preferences; MCP `update_config` remains
  project-only.
- Make all assistant flows keyboard-operable with clear textual errors.
- Offer a non-destructive dry-run suitable for CI and troubleshooting.
- Never configure public LM Studio exposure or certificate/proxy management.

## Assumptions to resolve

Pin the supported Claude Code and Codex configuration formats/versions from
authoritative documentation. Decide install scope, executable invocation,
configuration merge strategy, backup policy, and package release channel.

## Non-scope

No automatic updates, GUI, container-first install, remote service, team
configuration, or silent migration of unknown formats.

## Implementation outline

1. Add separate harness configuration adapters with fixture-based parsers.
2. Implement discovery, dry-run proposal, conflict detection, confirmation, and
   atomic write.
3. Add the global-preference configure command using Task 003 schemas.
4. Package the built MCP executable and required runtime files only.
5. Test installation in isolated fake home directories.
6. Run opt-in smoke calls from real Claude Code and Codex on macOS.
7. Update README and integration/configuration troubleshooting docs.

## Expected areas

- CLI install/configure commands
- Claude Code and Codex adapters
- Packaging and release metadata
- Isolated-home fixtures and macOS smoke scripts
- Installation and integration documentation

## Tests

- Fresh Claude Code, Codex, and combined setup.
- Existing identical, compatible, conflicting, malformed, and newer-format
  configurations.
- Dry-run and rejected confirmation make no changes.
- Confirmed writes are atomic and preserve unrelated configuration.
- Global preference validation and protected-field rejection.
- Token never appears in generated editable JSON, output, backups, or errors.
- Entire assistant is usable by keyboard in a terminal.
- Installed command starts the MCP server and exposes six tools.

## Risks

- Harness configuration formats can change independently.
- Merge behavior can destroy unrelated user configuration.
- Package execution paths differ between global and project installs.
- Backups can duplicate secrets if boundaries are not carefully defined.

## Acceptance criteria

- CA-01, CA-02, and CA-46 pass on supported macOS harness versions.
- Users can configure one or both harnesses without manual JSON editing.
- Existing configuration is never overwritten without a displayed proposal and
  explicit confirmation.
- Global preferences can be changed locally but protected settings remain
  protected.
- Installation and recovery instructions are complete.
- `npm run validate` passes.

