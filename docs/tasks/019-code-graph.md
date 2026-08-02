<Task 019: Code graph extraction>
**Status:** Completed
**Depends on:** Tasks 005, 006
**PRD coverage:** New capability CAP-08

## Objective

Extract a lightweight code graph of symbols (functions, classes, interfaces, type aliases, imports, exports) from TypeScript and Python source files using tree-sitter WASM bindings, and expose it as a new `query_code_graph` MCP tool.

## Requirements

- Parse TypeScript and Python files using `web-tree-sitter` (WASM, no native C bindings).
- Extract the following symbol types: function declarations, class declarations, interface declarations (TS), type alias declarations (TS), method definitions, import statements, export statements.
- For each symbol, record: `{ name, kind, filePath, startLine, endLine, signature (first line of declaration), exports: boolean }`.
- Build a dependency graph: for each import, resolve the target symbol and file within the repository.
- Store the graph in memory with file-level invalidation via content hash (SHA-256).
- Register `query_code_graph` as a new MCP tool.
- Input schema: `{ repository_root: string, query: string, query_type: 'symbol' | 'callers' | 'dependencies' | 'exports', file_filter?: string }`.
- `symbol` query: find symbols matching the query name (fuzzy substring match).
- `callers` query: find all symbols that import or reference the queried symbol.
- `dependencies` query: list all imports of a given file or symbol.
- `exports` query: list all public exports of a given file or directory.
- Return results as `{ symbols: Array<{ name, kind, file, line_start, line_end, signature }>, edges?: Array<{ from, to, relation }> }`.
- Respect all content filtering rules: do not parse sensitive, binary, ignored, or excluded files.
- Parsing errors in individual files are logged and skipped; they do not block the entire graph.

## Non-scope

Call graph analysis within function bodies, type inference, cross-language resolution, runtime analysis, languages beyond TypeScript and Python.

## Implementation outline

1. Add `web-tree-sitter` as a dependency with TypeScript and Python grammar WASM files.
2. Create `src/features/code-graph/parser.ts` with tree-sitter initialization and symbol extraction.
3. Create `src/features/code-graph/graph.ts` with in-memory graph storage and query methods.
4. Create `src/features/code-graph/contracts.ts` with types and interfaces.
5. Implement the 4 query types.
6. Register `query_code_graph` tool in MCP server.
7. Add progress reporting for initial parse.

## Expected areas

- `src/features/code-graph/contracts.ts` — Types and interfaces
- `src/features/code-graph/parser.ts` — Tree-sitter parsing
- `src/features/code-graph/graph.ts` — Graph storage and queries
- `src/features/code-graph/index.ts` — Public exports
- `src/features/mcp-server/server.ts` — Tool registration
- `test/code-graph.test.ts` — Unit and integration tests

## Tests

- Parse a TypeScript file with functions, classes, interfaces, and type aliases; all symbols are extracted.
- Parse a Python file with functions, classes, and imports; all symbols are extracted.
- `symbol` query finds matching symbols by name substring.
- `callers` query finds files that import a given symbol.
- `dependencies` query lists all imports of a given file.
- `exports` query lists public exports of a directory.
- File with syntax errors is skipped without crashing the graph.
- Sensitive and binary files are excluded from parsing.
- Content hash invalidation: modifying a file clears its symbols from the graph.
- Empty repository returns empty results.
- `file_filter` restricts results to matching paths.

## Risks

- `web-tree-sitter` WASM initialization adds startup latency; lazy-load on first use.
- Tree-sitter grammars must be pinned to specific versions for reproducibility.
- Import resolution across complex `tsconfig.json` path aliases may be incomplete; document limitations.

## Acceptance criteria

- Symbol extraction covers function, class, interface, type alias, method, import, and export declarations.
- All 4 query types return correct results for fixture repositories.
- Parsing errors in individual files do not crash the graph.
- Content filtering rules are respected.
- `npm run validate` passes.
