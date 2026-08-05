# Task 057: Large-Monorepo Degradation

**Status:** Implemented (v2.13.0)
**Depends on:** Task 027 (reactive indexing), Task 034 (SQLite vector storage), Task 041 (hardware-aware concurrency)

## Objective

Make very large repositories degrade gracefully and predictably. Today per-task
bounds exist, but indexing and exploration have no documented size guidance and
no explicit upper bound, so a giant monorepo can consume unbounded memory or
time.

## Key Design Decisions

- **Documented size guidance:** explicit, documented guidance (e.g., file count
  and index byte size) for supported repository sizes, matching the
  `context_budget_bytes`/limits model.
- **Bounded work, explicit limitation:** indexing and exploration stop at the
  documented ceiling and return an explicit `limitation` response instead of
  continuing unbounded work or crashing.
- **Memory regression tests:** generated large fixtures assert that indexing
  and exploration memory stays within a bound (bounded batch/eviction already
  present in the SQLite and in-memory indexes).
- **No behavior change under the ceiling:** repositories within the guidance
  behave exactly as today.
- **Limits are policy, not security:** the ceiling follows the existing limits
  model and can be tuned, without weakening the repository read boundary.

## Acceptance Criteria

- [x] Repository-size guidance is documented in `docs/`.
- [x] Over-limit indexing/exploration returns an explicit limitation rather
      than exhausting memory or hanging.
- [x] Memory regression tests on large generated fixtures stay bounded.
- [x] In-scope repositories behave identically to before.
- [x] `npm run validate` green.

## Files Changed (anticipated)

- `src/features/repository-exploration/`, `src/features/semantic-search/`
  (MODIFIED — size ceiling and limitation responses)
- `test/` (NEW — large-fixture memory and ceiling tests)
- `docs/architecture.md`, `docs/limits.md` or equivalent (MODIFIED — size
  guidance)
- `docs/tasks/057-large-monorepo-degradation.md` (NEW — this document)

## Implementation notes

- `FIXED_LIMITS.index_max_files` (25,000) and `index_max_bytes` (512 MiB) are the
  documented ceiling, sitting alongside the existing patch limits so the model is
  consistent. They are policy, not security: crossing them degrades coverage and
  never widens the repository read boundary.
- `reindexRepository` now returns a `ReindexOutcome` describing what it covered:
  indexed, skipped-unchanged, pruned, and how many files were left out. It stops
  at the file ceiling before walking the rest of the tree, and stops on
  cumulative byte volume mid-pass, so neither dimension can run unbounded.
- `search_semantic` surfaces an `index_limitation` (`repository_too_large`, with
  the reason and the count not indexed). Without it a caller cannot tell "no
  match" from "never indexed", which is the failure mode that actually misleads.
- Repositories under the ceiling are untouched: the outcome reports
  `truncated: false`, no limitation is attached, and the existing incremental
  sync tests pass unchanged.
- `test/monorepo-degradation.test.ts` generates large fixtures and asserts both
  ceilings, the reported shortfall, and that heap growth does not scale with
  input size — index eviction holds the footprint at its configured maximum.
