# Task 054: Release-Qualification Gates

**Status:** Tooling implemented (v2.10.0); external gates require operator execution
**Depends on:** Task 015 (release audit)

## Objective

Close the two release gates that no local run can truthfully produce:
(1) the complete tool scenarios run through real Claude Code and Codex against a
real LM Studio instance, and (2) a green Linux and Windows CI matrix for the
exact candidate commit. This is a process/QA pillar, not a product feature.

## Key Design Decisions

- **Headless real-harness scenario runner:** a script that drives the official
  TypeScript and Python fixtures through Claude Code and Codex in isolated
  profiles against a real local LM Studio, capturing the evidence channels
  defined by `docs/release-qualification.md` and
  `docs/release-evidence.template.json`.
- **Exact-candidate CI gate:** the existing `validate.yml` matrix
  (macOS/Linux/Windows) enforces `npm ci`, `npm run validate`, and
  `npm run release:smoke` for the reviewed candidate commit; CA-52 passes only
  when all three remote jobs are green for that commit.
- **Measurement stays hard:** `npm run release:measure` continues to require
  100% valid evidence references, ≥80% patch-apply, ≥80% test-start, 100% allowed
  patch paths, exact tool-set counts, and zero prohibited markers in captured
  channels; empty samples fail.
- **Promotion rule:** `npm publish` is only allowed after every gate passes; the
  candidate keeps `private: true` so accidental publication stays impossible.

## Acceptance Criteria

- [ ] Real Claude Code and Codex scenario runs complete for the official
      fixtures with recorded evidence. *(operator-only: needs both harnesses and
      a live provider; `release:scenarios` drives it and refuses to fabricate)*
- [ ] `release:measure` passes all thresholds on the candidate evidence.
      *(blocked on the run above)*
- [ ] All three OS CI jobs are green for the exact candidate commit.
      *(operator confirms, then sets `LMW_RELEASE_CI_STATUS=green`)*
- [ ] No prohibited markers or credential values appear in captured channels.
      *(enforced by `release:measure` once evidence exists)*
- [ ] Promotion to a stable release occurs only after the gates pass.
      *(mechanically checkable via `npm run release:gates`)*
- [x] Gate status is mechanically reportable rather than a prose claim.
- [x] `npm run validate` green.

## Files Changed (anticipated)

- `scripts/release/` (NEW — real-harness scenario runner; MODIFIED — evidence
  capture)
- `.github/workflows/validate.yml` (MODIFIED — gate enforcement for the
  candidate commit)
- `docs/release-qualification.md` (MODIFIED — updated gate status)
- `docs/tasks/054-release-qualification-gates.md` (NEW — this document)

## Implementation notes

This pillar is process/QA. The acceptance criteria above are deliberately left
unchecked: they assert that a **real** harness session and a **real** three-OS
matrix happened, and nothing running locally can honestly claim that. What
shipped is the tooling that makes those claims verifiable instead of asserted.

- `npm run release:gates [evidence.json]` prints every gate as `met`, `unmet`,
  or `unverifiable` and exits non-zero unless all are `met`. "Unverifiable" is a
  distinct outcome on purpose: a missing artifact must never read as a pass.
- `npm run release:scenarios` drives the official TypeScript and Python fixtures
  through real Claude Code and Codex in isolated profiles against a live
  provider. It verifies prerequisites first and exits 69 listing exactly what is
  missing. `--check` reports readiness without running.
- The emitted evidence document leaves `discovered_tools`, `evidence`, and
  `proposals` empty for a capture that did not observe a live session, so
  `release:measure` fails loudly on an incomplete run. A partial capture cannot
  be mistaken for a passing one — verified by feeding a skeleton capture back
  through `release:gates` and watching it fail.
- CI gained a `gates` job that reports status for each commit and runs before
  `release`. It uses `--report-only`, so it surfaces gate status without
  changing the existing publish behavior. Removing that flag makes promotion
  conditional on every gate passing.

### Known deviation from the task spec

The spec assumes the candidate keeps `private: true` "so accidental publication
stays impossible". This repository does not set it, and `validate.yml` publishes
to npm automatically on every push to `main`. That is a deliberate,
long-standing workflow here, so it was left alone rather than silently changed —
but it means the "promotion only after gates pass" rule is currently a
convention enforced by review, not by the pipeline. Making it mechanical is one
flag away (`--report-only` removal) plus `private: true`.
