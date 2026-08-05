# ADR-0013: Reduce harness context via a `result_verbosity` preference

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The MCP SDK exposes no channel for the server to read or rewrite the coding
assistant's (harness) transcript. The only levers available to reduce how much
of the harness context window tool responses consume are (1) the size of the
result payloads the server returns and (2) the steering rules installed into
each harness. Some tools — `explore_repository`, `auto_validate_tests`,
`analyze_diff` — return large, mostly human-oriented payloads whose structural
content is a small fraction of the total.

## Decision

Add a `result_verbosity` preference (`"terse" | "standard" | "verbose"`,
default `"standard"`) resolved with the existing project > global > built-in
precedence and editable through `get_config`/`validate_config`/`update_config`
and the `configure-global --result-verbosity` CLI flag.

Compaction applies only in `terse` mode:

1. **Single representation.** In terse mode the compacted object is the single
   payload for both the text content block and `structuredContent`, so the
   harness never receives two divergent views.
2. **Conservative field-level rules.** Only clearly verbose, human-oriented
   fields are pruned, by exact key, never by recursive heuristics:
   - `explore_repository`: drop `risks`, `next_steps`, `limitation_impact`;
     strip `explanation` from each `evidence` entry (paths and line ranges
     stay).
   - `auto_validate_tests`: drop `patch` from each `attempts` entry (the final
     validated `patch` stays).
   - `analyze_diff`: drop `architectural_notes` (summary and stats stay).
   - `summarize_module`, patches, and config/health/stats tools: unchanged.
3. **No default regression.** `standard` and `verbose` render exactly as before
   (full JSON in `content` and `structuredContent`).
4. **Steering directives.** `buildSteeringInstructions` gains one universal
   directive (do not echo large tool results into the conversation) plus
   feature-gated directives that push the harness toward targeted lookups
   (`query_code_graph`, `search_semantic`, `summarize_module`) and away from
   echoing `auto_validate_tests` iteration output.

The compaction lives in `src/features/mcp-server/result-compaction.ts` and is
applied in the MCP server's `callTool` wrapper, so feature code stays
verbosity-unaware.

## Consequences

### Positive

- A harness in `terse` mode sees a real, guaranteed reduction in context
  consumption for the highest-payload tools.
- Default behavior, public tool schemas, and the API are unchanged; there is no
  client regression.
- The `terse` payload keeps all structural data needed to act on results (paths,
  line ranges, symbols, diffs, status), so the reduction does not degrade
  usability.
- The rules are explicit and auditable rather than emergent from a heuristic.

### Negative

- `terse` omits prose fields that some workflows may want; it must be opted into
  deliberately.
- The compaction rules are key-name specific and must be revisited if a tool's
  result shape changes.
- `verbose` currently renders identically to `standard`; the level exists for
  future expansion and for operators to opt out of compaction explicitly.

## Alternatives considered

### Always compact by default

Rejected: it changes every client's payload and risks losing fields consumers
already rely on.

### Compress (gzip) the text block instead of pruning fields

Rejected: MCP text content is JSON, not a file artifact; consumers would need to
decompress and the structured contract is unchanged, so context would not shrink.

### Expose compaction as a per-call tool argument

Rejected: every schema would change; a single resolved preference keeps the tool
surface stable and matches the existing configuration authority model.
