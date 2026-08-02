# ADR-0007: Release repository text only through a fail-closed collector

- **Status:** Accepted
- **Date:** 2026-08-02
- **Source:** RF-05, RF-06, RF-26 prerequisite; RN-08 through RN-14; CA-09 through CA-13

## Context

Canonical path containment alone does not make repository content safe to send
to a remote model. Ignored files, credentials, binary data, project exclusions,
budget overages, classifier uncertainty, and prompt injection all require local
authority. Silent truncation also makes a model result appear more complete
than its context.

## Decision

Use one in-memory outbound collector after the path sandbox. It applies
additive project ignores, Git ignore classification, mandatory path/content and
binary classification, duplicate minimization, and exact serialized UTF-8 byte
accounting before an excerpt enters context. Any uncertainty excludes content
and creates a metadata-only limitation.

Use fatal UTF-8 decoding plus NUL/control-byte checks for binary detection. Use
explicit sensitive filename and content patterns that prefer false positives.
Use `git check-ignore` through `execFile` without a shell and fail closed on any
exit other than ignored/visible.

Define `.mcp-agent-ignore` as a small additive glob subset. Ignore negation
rules so they cannot re-enable access, and invalidate malformed or escaping
policy files.

Label every accepted excerpt as untrusted data, fingerprint its exact content
with SHA-256, and store only paths, ranges, byte counts, reasons, impacts, and
fingerprints in the manifest. Enforce configuration-derived interaction and
context limits without partial excerpt truncation.

## Consequences

### Positive

- Prohibited fixture content has one auditable release gate and never appears
  in outbound snapshots or limitation manifests.
- Git/classifier failure reduces context instead of broadening access.
- Exact byte and interaction boundaries are deterministic, including
  multibyte text.
- Omitted relevant paths and likely impact remain visible to later results.
- Fingerprints support stale-input checks without persisting repository text.

### Negative

- Filename and token patterns intentionally block some harmless examples and
  placeholders.
- The documented ignore subset is smaller than full Git ignore syntax.
- Git classification starts a local process per candidate until a later
  batching optimization is demonstrated necessary.
- Relevance remains an orchestration decision; this layer can require and bound
  a rationale but cannot understand the developer's goal semantically.

## Alternatives considered

### Let the remote model decide what is sensitive

Rejected because content would already have crossed the local trust boundary
before classification.

### Send partial content that fits the remaining budget

Rejected because silent or mid-excerpt truncation can change meaning and hide a
material limitation.

### Support `.gitignore` negation semantics in project exclusions

Rejected because `.mcp-agent-ignore` is a monotonic deny layer and must never
become a mechanism for restoring access.
