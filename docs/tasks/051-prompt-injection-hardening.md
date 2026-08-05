# Task 051: Prompt-Injection Hardening

**Status:** Implemented (v2.7.0)
**Depends on:** Task 026 (harness prompt steering), Task 036 (context distillation)

## Objective

Treat every repository excerpt that leaves the machine as untrusted *data* so
that text embedded in scanned files cannot change the task the model is
performing. The fail-closed collector already decides *which* content is allowed
out; this task decides *how* that content is presented to the model.

## Key Design Decisions

- **Data-block delimiters:** repository excerpts are wrapped in explicit
  `BEGIN`/`END` markers with a standing preamble stating that the block is
  untrusted file data and never an instruction, a directive, or an example to
  imitate.
- **Single presentation layer:** the wrapping is applied where prompts are
  composed for inference (exploration, `summarize_module`, `query_code_graph`
  context, `propose_tests`, `fix_lint_violations`, `fix_type_errors`,
  `generate_docs_patch`, `analyze_diff`), so every feature inherits it without
  per-feature changes.
- **Adversarial fixtures:** a fixture directory of "hostile" files (instructions
  to ignore prior directives, fake tool-call syntax, smuggled JSON, claims of
  new system roles) is used by tests that assert task behavior is unchanged.
- **No boundary change:** the outbound collector's path, size, trust, and
  exclusion semantics stay identical; only the presentation of accepted content
  changes.

## Acceptance Criteria

- [x] Every inference request carrying repository text wraps it in the data
      preamble and delimiters.
- [x] Adversarial fixture files never change golden task results.
- [x] Collector semantics (paths, sizes, exclusions, trust labels) unchanged.
- [x] Public tool schemas and MCP API unchanged.
- [x] `npm run validate` green.

## Files Changed (anticipated)

- Outbound content collector / context-building layer (MODIFIED — data-block
  wrapping)
- `src/features/model-inference` prompt composition (MODIFIED — standing
  untrusted-data directive)
- `test/` (NEW — adversarial fixture suite; MODIFIED — prompt-shape assertions)
- `docs/architecture.md`, `docs/mcp-tools.md` (MODIFIED — threat model notes)
- `docs/tasks/051-prompt-injection-hardening.md` (NEW — this document)

## Implementation notes

- `src/features/model-inference/untrusted-data.ts` is the single presentation
  layer: `composeUntrustedPrompt` fences repository-derived payload between
  `BEGIN`/`END UNTRUSTED REPOSITORY DATA <nonce>` markers whose identifier is 16
  random bytes per request, and `composeSystemProtocol` appends the standing
  directive so no feature can omit it. `parseUntrustedPrompt` is the inverse and
  keeps the wire format defined in one place.
- The trusted task envelope (goal, constraints, requested language, task name)
  is rendered outside the fence so the caller's actual task still reaches the
  model; only repository-derived fields move inside.
- Applied at all nine inference sites: exploration, auto-validate, test
  proposal, lint fix, type fix, docs generation, both module-summary passes, and
  diff analysis. `analyze_diff` previously interpolated raw diff text with no
  untrusted-data language at all.
- Occurrences of the live nonce inside the payload are redacted before fencing,
  so "exactly one live terminator" is an invariant rather than a probability.
- `test/prompt-injection.test.ts` holds the adversarial fixtures;
  `test/lint-fix.test.ts` proves a hostile source file produces a byte-identical
  golden result.
- See [ADR-0014](../decisions/0014-nonce-delimited-untrusted-data.md).
