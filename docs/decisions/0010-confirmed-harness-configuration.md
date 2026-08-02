# ADR-0010: Use managed, confirmed harness configuration entries

**Status:** Accepted  
**Date:** 2026-08-02

## Context

Claude Code stores project MCP servers in JSON while Codex stores user MCP
servers in TOML. Both files may contain unrelated user configuration and may
also contain credentials unknown to this application. Rewriting a whole file,
printing its diff, or automatically backing it up could destroy or duplicate
sensitive content. The two upstream formats can evolve independently.

## Decision

Keep separate Claude Code and Codex adapters behind the installation feature.
Each adapter owns only the `local-model-workers` entry, preserves unrelated
content, and produces a secret-safe managed-field preview. Every write requires
an exact confirmation bound to the observed file revision and proposed managed
content. Malformed, duplicate, or ambiguous managed structures fail closed.

Claude Code receives environment-variable references in `.mcp.json`. Codex
receives only `env_vars` names and inherits their values from its process.
Actual protected values are never persisted. Writes use the existing owner-only
temporary-file, flush, and atomic-rename primitive. Automatic backups are not
created because they could duplicate unknown secrets; recovery is documented.

## Consequences

- Users review a bounded proposal and must opt in before any merge or replace.
- Existing unrelated Claude JSON structure and Codex TOML text remain intact.
- The Codex adapter intentionally understands only its managed table and
  markers; it does not attempt to normalize arbitrary TOML.
- Combined setup is atomic per target, not a transaction spanning both files.
- Format changes are isolated to one adapter and require fixture and real
  harness qualification before release.

## Alternatives considered

- Calling harness-specific setup commands would hide or delegate merge and
  confirmation semantics that are security requirements of this product.
- Serializing the entire Codex TOML through a generic parser would create broad
  formatting churn and require another runtime dependency.
- Full-file diffs and automatic backups were rejected because unknown existing
  values could leak to terminal output or secondary files.
