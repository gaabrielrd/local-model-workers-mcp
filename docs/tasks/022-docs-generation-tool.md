<Task 022: Documentation generation tool>
**Status:** Completed
**Depends on:** Tasks 011, 020
**PRD coverage:** New capability CAP-11

## Summary

Implemented the `generate_docs_patch` MCP tool in `src/features/docs-generation/`.
The feature reads documentable code files (`*.ts`/`*.tsx`/`*.js`/`*.jsx`/`*.py`)
through the outbound content collector, identifies public symbols lacking
documentation via the code graph, uses shallow module summaries plus a
structured `inferStructured` call for context, then wraps the model's plain
content into JSDoc/docstring comments or a new `docs/<slug>.md` guide. The
result is delivered as a locally computed, unapplied unified diff validated by
a docs-only patch policy. Nothing is ever written to the repository.

Behavioral notes:

- Default style is `jsdoc` for TypeScript and `google` for Python; a requested
  style is honored only when compatible with the file language.
- Already documented public symbols are skipped unless `force_refresh` is true.
- The patch policy rejects deletions, out-of-scope paths, renames, copies,
  binary patches, and limit overflows (15 files / 800 changed lines).
- A sha256 fingerprint check verifies source files did not change between read
  and delivery (`invalid_evidence`).
- The markdown guide path derives from the target as `docs/<slug>.md`.
- 17 unit/integration tests in `test/docs-generation.test.ts`; `npm run validate`
  is green.

## Acceptance criteria

- Generated documentation patches contain syntactically valid JSDoc/TSDoc or Python docstrings.
- Markdown documentation accurately describes module purpose and public API.
- Patch validation ensures no functional code changes.
- Content filtering rules are respected.
- `npm run validate` passes.
