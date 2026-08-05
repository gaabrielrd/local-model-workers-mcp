<Task 028: Multi-language AST symbol extraction for query_code_graph>
**Status:** Completed
**Depends on:** Task 019
**PRD coverage:** Extended CAP-07 & Code Graph

## Objective

Expand symbol extraction in `query_code_graph` to support Go (`.go`), Rust (`.rs`), Java (`.java`), and C# (`.cs`) source files alongside existing TypeScript/JavaScript and Python parsers.

## Requirements

- Recognize `.go`, `.rs`, `.java`, and `.cs` file extensions in `parseSourceSymbols`.
- **Go parser (`.go`)**: Extract `func` (functions/methods), `type` (struct/interface/type alias), `import`, and detect exported symbols via capitalized first character of identifier.
- **Rust parser (`.rs`)**: Extract `fn`, `struct`, `enum`, `trait`, `type`, `use` (imports), and detect exported symbols via `pub`.
- **Java parser (`.java`)**: Extract `class`, `interface`, `enum`, `method`, `import`, and detect exported symbols via `public`/`protected` modifiers.
- **C# parser (`.cs`)**: Extract `class`, `interface`, `struct`, `record`, `method`, `using` (imports), and detect exported symbols via `public`/`protected` modifiers.
- Estimate start and end lines accurately using block matching.
- Existing TypeScript/JS and Python parsers continue working without regression.

## Expected areas

- `src/features/code-graph/parser.ts` — Multi-language line & block symbol parsers
- `test/code-graph.test.ts` — Tests for Go, Rust, Java, and C# symbol extraction

## Acceptance criteria

- `parseSourceSymbols` extracts symbols from `.go`, `.rs`, `.java`, and `.cs` files.
- Export status is accurately determined for each language.
- `npm run validate` passes with all tests green.
