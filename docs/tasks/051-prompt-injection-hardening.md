# Task 051: Prompt-Injection Hardening

**Status:** Planned (v2.7.0)
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

- [ ] Every inference request carrying repository text wraps it in the data
      preamble and delimiters.
- [ ] Adversarial fixture files never change golden task results.
- [ ] Collector semantics (paths, sizes, exclusions, trust labels) unchanged.
- [ ] Public tool schemas and MCP API unchanged.
- [ ] `npm run validate` green.

## Files Changed (anticipated)

- Outbound content collector / context-building layer (MODIFIED — data-block
  wrapping)
- `src/features/model-inference` prompt composition (MODIFIED — standing
  untrusted-data directive)
- `test/` (NEW — adversarial fixture suite; MODIFIED — prompt-shape assertions)
- `docs/architecture.md`, `docs/mcp-tools.md` (MODIFIED — threat model notes)
- `docs/tasks/051-prompt-injection-hardening.md` (NEW — this document)
