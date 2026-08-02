# Task 011: Implement safe test proposals

**Status:** Completed
**Depends on:** Tasks 006-010  
**PRD coverage:** RF-08 through RF-13, RF-26; RN-15 through RN-23; CA-16 through CA-23, CA-40, CA-49 through CA-51 prerequisites

## Objective

Implement the complete transport-neutral `propose_tests` use case that
discovers existing test infrastructure, asks LM Studio for tests, and returns
only a locally validated test-only unified diff.

## Requirements

- Derive expected behavior in priority order: user goal, project instructions,
  existing tests, then observable production behavior.
- Treat unresolved conflicts as a block or explicit premise; never invent product
  requirements.
- Detect existing unit or integration test infrastructure without running it.
- If no usable infrastructure exists, return `blocked` without a patch and
  suggest compatible options.
- Parse unified diffs structurally and classify every changed path.
- Allow only tests, fixtures, mocks, and configuration used exclusively by
  tests.
- Block production or ambiguous paths and never label them applicable.
- Enforce at most 10 changed files and 1,000 added or modified lines.
- Return a division plan instead of a truncated patch when limits are exceeded.
- Report required dependencies without installing or updating them.
- Return patch, test summary, affected files, premises, and suggested commands.
- Recheck every source file fingerprint before delivering an applicable patch.
- Never write to the repository or execute suggested commands.

## Non-scope

Browser, GUI, mobile, real external-service tests, missing-framework creation,
dependency installation, patch application, test execution, or production-code
changes.

## Implementation outline

1. Define test-infrastructure discovery and behavior-source contracts.
2. Reuse filtered exploration only through its public feature API.
3. Define a constrained remote response protocol for test proposals.
4. Parse diffs without applying them.
5. Classify paths using existing project conventions plus fail-closed rules.
6. Count files and changed lines from parsed hunks.
7. Validate premises, commands, source fingerprints, and response completeness.
8. Map blocks and success to the common envelope.
9. Add TypeScript and Python fixture repositories.

## Expected areas

- `src/features/test-proposal`
- Test-infrastructure detectors and unified-diff parser
- Path classifier and patch policy
- Python/TypeScript fixtures
- Tool and testing documentation

## Tests

- Projects with TypeScript and Python unit/integration infrastructure.
- Project without usable infrastructure.
- Valid new and modified test files, fixtures, mocks, and test-only config.
- Production path, ambiguous path, rename, deletion, binary diff, traversal, and
  symlink edge cases.
- Exactly 10 versus 11 files; exactly 1,000 versus 1,001 changed lines.
- Oversized result returns a division plan and no truncated patch.
- New dependency is reported but never installed.
- Conflicting behavior sources produce a block or explicit premise.
- A used source file changes before completion.
- Suggested commands are returned but never invoked.
- Snapshot of the target repository is unchanged after every scenario.

## Risks

- Filename heuristics alone can misclassify production files.
- Diff parsers must handle renames, quoting, line endings, and malformed hunks.
- Suggested commands are untrusted text and must not be executed during parsing.
- Applying release-candidate patches must happen outside the MCP process.

## Acceptance criteria

- CA-16 through CA-23 and CA-40 pass.
- Fixtures make CA-49 through CA-51 measurable in Task 015.
- No unsafe or oversized patch is presented as applicable.
- No repository file or dependency changes during the use case.
- `npm run validate` passes.
