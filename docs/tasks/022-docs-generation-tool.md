<Task 022: Documentation generation tool>
**Status:** Not started
**Depends on:** Tasks 011, 020
**PRD coverage:** New capability CAP-11

## Objective

Implement a new `generate_docs_patch` MCP tool that analyzes code structure using the code graph and module summaries, then generates documentation patches (JSDoc/docstrings for code, markdown for docs/) using a local model.

## Requirements

- Register `generate_docs_patch` as a new MCP tool.
- Input schema: `{ repository_root: string, target: string (relative path to file or directory), doc_type: 'inline' | 'markdown' | 'both', style?: 'jsdoc' | 'tsdoc' | 'numpy' | 'google' (default based on language), force_refresh?: boolean }`.
- `inline` mode: generate JSDoc/TSDoc comments for TypeScript or docstrings for Python for all public symbols lacking documentation.
- `markdown` mode: generate or update a markdown file in `docs/` describing the module's purpose, public API, and usage examples.
- `both` mode: generate both inline and markdown documentation.
- Use the code graph (Task 019) to identify undocumented public symbols.
- Use module summaries (Task 020) for context when generating documentation.
- Use `inferStructured` to generate documentation content with structured output schema.
- Return the result as a validated unified diff patch.
- Validate the patch: only documentation files and inline comments may be added/modified. No functional code changes.
- Maximum 15 files and 800 changed lines per request.
- Preserve existing documentation unless `force_refresh` is true.

## Non-scope

API reference site generation, changelog generation, README generation, translation, diagram generation.

## Implementation outline

1. Define contracts for documentation generation requests and results.
2. Implement undocumented symbol detection using code graph.
3. Create prompt templates for inline docs (JSDoc/docstring) and markdown generation.
4. Implement patch generation and validation (docs-only changes).
5. Register `generate_docs_patch` tool in MCP server.

## Expected areas

- `src/features/docs-generation/contracts.ts` — Types and interfaces
- `src/features/docs-generation/detect.ts` — Undocumented symbol detection
- `src/features/docs-generation/generate.ts` — Documentation generation
- `src/features/docs-generation/index.ts` — Public exports
- `test/docs-generation.test.ts` — Unit and integration tests

## Tests

- TypeScript file with undocumented exports generates JSDoc patches.
- Python file with undocumented functions generates docstring patches.
- `markdown` mode generates a docs/ markdown file.
- `both` mode generates inline + markdown patches.
- Already documented symbols are skipped unless `force_refresh` is true.
- Patch validation rejects any functional code changes.
- Maximum file and line limits are enforced.
- Style parameter is respected (jsdoc vs tsdoc, numpy vs google).
- Directory target documents all public files within.
- No repository writes occur.

## Risks

- Documentation quality depends on local model capability; provide detailed prompts with examples.
- Distinguishing doc-only vs functional changes in unified diff requires careful hunk analysis.

## Acceptance criteria

- Generated documentation patches contain syntactically valid JSDoc/TSDoc or Python docstrings.
- Markdown documentation accurately describes module purpose and public API.
- Patch validation ensures no functional code changes.
- Content filtering rules are respected.
- `npm run validate` passes.
