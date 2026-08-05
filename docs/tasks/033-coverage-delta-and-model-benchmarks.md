# Task 033: Coverage Delta & Local Model Quality Benchmarks

**Status:** Completed
**Depends on:** Tasks 015, 026, 030
**PRD coverage:** CAP-09 & Quality Benchmarking

## Objective

Provide coverage delta tracking and automated local model quality benchmarking for test proposal and patch generation.

## Requirements

1. **Coverage Delta Tracking**:
   - In `src/features/auto-validate/`, measure line coverage deltas before and after executing test proposal suites.
2. **Local Model Benchmark Harness**:
   - Expose benchmark runner script `scripts/benchmark-local-models.ts` that evaluates candidate models (e.g. Qwen 2.5/3.5, DeepSeek R1/Coder, Llama 3) against fixture tasks (exploration, lint fixing, test proposal).
3. **Documentation & Validation**:
   - Update `docs/mcp-tools.md` with all 14 MCP tools.
   - Run `npm run validate`.

## Implementation notes

- `src/features/auto-validate/coverage.ts` derives a coverage-enabled variant
  of the detected test command (npm/Jest `--coverage`, pytest `--cov`, `go
  test -cover`) and parses the resulting line-coverage percentage from
  Istanbul table/summary, pytest-cov `TOTAL`, and `go test` output formats.
- `runValidationLoop` in `src/features/auto-validate/loop.ts` measures
  coverage once before the first attempt and once more after the loop
  concludes (validated or exhausted), exposing an optional `coverage_delta`
  (`before`, `after`, `delta_percent`) on `AutoValidateResult`. Measurement is
  best-effort: an unparsable or failing coverage run omits the field rather
  than blocking validation.
- `docs/mcp-tools.md` documents all 15 registered tools (14 task/administrative
  tools plus `get_offload_stats`), including `get_offload_stats` and
  `fix_type_errors`.
