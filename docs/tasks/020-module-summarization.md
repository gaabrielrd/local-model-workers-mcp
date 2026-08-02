<Task 020: Module summarization tool>
**Status:** Not started
**Depends on:** Tasks 007, 019
**PRD coverage:** New capability CAP-09

## Objective

Implement a new `summarize_module` MCP tool that uses the code graph and local model inference to generate structured, condensed summaries of files or directories, cached by content hash.

## Requirements

- Register `summarize_module` as a new MCP tool.
- Input schema: `{ repository_root: string, target: string (relative path to file or directory), depth?: 'shallow' | 'deep' (default 'shallow'), force_refresh?: boolean (default false) }`.
- `shallow` summarization: returns symbol signatures, public exports, and a 1-paragraph natural language summary per file.
- `deep` summarization: includes dependency analysis, internal call patterns, and a multi-paragraph summary with architectural observations.
- Use the code graph (Task 019) to extract structural information before calling inference.
- Use `inferStructured` to generate the natural language summary with a constrained JSON schema output.
- Cache summaries by `(filePath, contentHash, depth)` tuple. Return cached result if content hash matches and `force_refresh` is false.
- For directory targets, summarize each file individually and produce an aggregate directory summary.
- Limit: maximum 20 files per directory summarization request. Return an error suggesting subdivision for larger directories.
- Output schema: `{ target, depth, files: Array<{ path, summary, symbols: Array<{ name, kind, signature }>, exports: string[], dependencies: string[] }>, aggregate_summary?: string }`.
- Respect content filtering: do not summarize sensitive, binary, ignored, or excluded files.
- Runs within the task lifecycle with timeout and cancellation semantics.

## Non-scope

Cross-repository summarization, automatic summarization triggers, persistent summary storage beyond in-memory cache, summarization of non-TS/Python files (returns structural info only).

## Implementation outline

1. Define `SummarizationRequest` and `SummarizationResult` types in `src/features/module-summary/contracts.ts`.
2. Implement summary generation combining code graph data + LM Studio inference.
3. Implement in-memory cache with content hash invalidation.
4. Handle directory targets by iterating files and producing aggregate.
5. Register `summarize_module` tool in MCP server.

## Expected areas

- `src/features/module-summary/contracts.ts` — Types and interfaces
- `src/features/module-summary/summarize.ts` — Summarization logic
- `src/features/module-summary/index.ts` — Public exports
- `src/features/mcp-server/server.ts` — Tool registration
- `test/module-summary.test.ts` — Unit and integration tests

## Tests

- Shallow summary of a single TypeScript file returns symbols, exports, and 1-paragraph summary.
- Deep summary includes dependency analysis and architectural observations.
- Directory summary aggregates individual file summaries.
- Cached result is returned when content hash matches.
- `force_refresh` bypasses cache and regenerates.
- Directory with >20 files returns an error suggesting subdivision.
- Sensitive and binary files are excluded.
- Cancellation during inference aborts cleanly.
- Non-TS/Python files return structural info only (no natural language summary).
- Summary output conforms to the defined JSON schema.

## Risks

- Large files may exceed the model's context window; truncate input to symbol signatures + first N lines.
- Summary quality depends on local model capability; provide structured prompts with clear schema constraints.

## Acceptance criteria

- `summarize_module` returns structured summaries with symbol lists and natural language descriptions.
- Cache invalidation works correctly based on content hash.
- Directory summarization respects the 20-file limit.
- Content filtering rules are respected.
- Existing tools continue working without regression.
- `npm run validate` passes.
