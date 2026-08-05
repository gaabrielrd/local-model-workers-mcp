# Task 054: Release-Qualification Gates

**Status:** Planned (v2.10.0)
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
      fixtures with recorded evidence.
- [ ] `release:measure` passes all thresholds on the candidate evidence.
- [ ] All three OS CI jobs are green for the exact candidate commit.
- [ ] No prohibited markers or credential values appear in captured channels.
- [ ] Promotion to a stable release occurs only after the gates pass.

## Files Changed (anticipated)

- `scripts/release/` (NEW — real-harness scenario runner; MODIFIED — evidence
  capture)
- `.github/workflows/validate.yml` (MODIFIED — gate enforcement for the
  candidate commit)
- `docs/release-qualification.md` (MODIFIED — updated gate status)
- `docs/tasks/054-release-qualification-gates.md` (NEW — this document)
