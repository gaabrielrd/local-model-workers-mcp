# Task 057: Large-Monorepo Degradation

**Status:** Planned (v2.13.0)
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

- [ ] Repository-size guidance is documented in `docs/`.
- [ ] Over-limit indexing/exploration returns an explicit limitation rather
      than exhausting memory or hanging.
- [ ] Memory regression tests on large generated fixtures stay bounded.
- [ ] In-scope repositories behave identically to before.
- [ ] `npm run validate` green.

## Files Changed (anticipated)

- `src/features/repository-exploration/`, `src/features/semantic-search/`
  (MODIFIED — size ceiling and limitation responses)
- `test/` (NEW — large-fixture memory and ceiling tests)
- `docs/architecture.md`, `docs/limits.md` or equivalent (MODIFIED — size
  guidance)
- `docs/tasks/057-large-monorepo-degradation.md` (NEW — this document)
