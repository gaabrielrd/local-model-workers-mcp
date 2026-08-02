# Safe test proposals

**Status:** Implemented transport-neutral use case  
**Last reviewed:** 2026-08-02

`propose_tests` reuses the public filtered repository-exploration API, detects
existing TypeScript or Python test infrastructure, and asks the configured LM
Studio model for a strict structured response containing one unified diff. It
does not write files, apply patches, execute suggested commands, or install
reported dependencies.

## Local validation

Before a patch can be returned as `completed`, the local process:

1. parses each `diff --git` file and hunk structurally;
2. rejects malformed, binary, rename, copy, deletion, traversal, quoted-path,
   mismatched-path, and duplicate-file forms;
3. allows only tests, specs, fixtures, mocks, and known test-only configuration;
4. canonicalizes existing targets and rejects symlinks or paths outside the
   repository;
5. enforces the protected limits of 10 files and 1,000 changed lines;
6. compares the model's affected-file list with the parsed patch; and
7. re-reads every exploration evidence range and compares its SHA-256
   fingerprint before delivery.

An oversized proposal is returned as `blocked` with a `division_plan`
limitation and no partial patch. Unresolved behavior conflicts, stale source
content, ambiguous paths, and repositories without detectable test
infrastructure are also blocked without a patch.

## Infrastructure detection

TypeScript infrastructure requires `package.json` plus a conventional test
directory or Jest/Vitest configuration. Python infrastructure requires a
Pytest-compatible configuration file plus a conventional test directory.
Detection uses bounded directory metadata and never runs the test framework.

The result reports the detected infrastructure, localized test summary,
affected files, explicit premises, suggested commands, and required
dependencies. Commands and dependencies remain untrusted informational text
for the caller to review.
