# Task 015: Qualify and release V1

**Status:** Pending  
**Depends on:** Tasks 001-014  
**PRD coverage:** Final audit of RF-01 through RF-29 and CA-01 through CA-52

## Objective

Prove that the assembled product satisfies every approved requirement,
quantitative success metric, security invariant, harness integration, and
platform commitment before publishing V1.

## Requirements

- Maintain a machine-readable or reviewable matrix mapping all 29 RFs and 52 CAs
  to automated tests, release scenarios, or an explicit macOS manual check.
- Run installation, startup, and configuration-read smoke tests on macOS, Linux,
  and Windows.
- Run the complete six-tool workflow in supported Claude Code and Codex versions
  on macOS.
- Maintain official Python and TypeScript fixture repositories.
- Measure evidence validity, patch applicability, test executability, allowed
  paths, operational limits, and log privacy exactly as defined in the PRD.
- Inspect outbound LM Studio payloads and all persisted/terminal channels for
  prohibited content.
- Produce an installable, reproducible artifact from a clean checkout.
- Update all documentation from target/future language to verified current
  behavior, while preserving known limitations.
- Record supported versions, release steps, rollback/recovery, and unresolved
  non-blocking limitations.

## Non-scope

No new V1 feature, quality target reduction, public-network support, complete
Linux/Windows harness certification, or post-V1 enhancement may be added during
qualification. Failures return to the owning task.

## Implementation outline

1. Build the RF/CA traceability matrix and identify missing evidence.
2. Add CI platform jobs and package-install smoke tests.
3. Finalize official Python and TypeScript scenario fixtures.
4. Run security, concurrency, cancellation, timeout, redaction, and retention
   suites.
5. Run real macOS Claude Code, Codex, and LM Studio compatibility scenarios.
6. Apply candidate patches outside the MCP server and run suggested commands
   through the harness for metrics.
7. Rebuild from a clean checkout and verify artifact contents and checksums.
8. Review docs, dependency licenses/advisories, logs, stdout, package contents,
   and final diff.
9. Publish only after all blocking criteria and thresholds pass.

## Required release evidence

| Measure | Required result |
| --- | --- |
| Evidence references | 100% point to existing analyzed paths and lines |
| Applicable patches | At least 80% apply without conflict |
| Executable tests | At least 80% of applied patches start tests |
| Allowed patch paths | 100% allowed |
| Operational limits | 100% queue, processing, cancellation and concurrency cases pass |
| Path protection | 100% traversal and symlink cases pass |
| Sensitive-file protection | 100% prohibited outbound markers absent |
| Configuration confirmation | 100% unconfirmed updates leave files unchanged |
| Log privacy | 100% logs contain approved metadata only |
| Harness compatibility | All six tools work in Claude Code and Codex on macOS |
| Ecosystem validation | Python and TypeScript official scenarios complete |
| Portability | Basic install/start/config read passes on Linux and Windows |

## Tests and audits

- Run `npm run validate` from a clean checkout.
- Run all OS matrix jobs using the published package candidate.
- Run cross-process stress and abandoned-owner recovery repeatedly.
- Fuzz or property-test path containment, response parsing, configuration
  mutation, and diff parsing within deterministic limits.
- Search artifacts and outputs for fixture secrets and repository markers.
- Verify no target fixture changes unless the external harness explicitly
  applies a candidate patch for measurement.
- Inspect dependencies and generated package contents for unintended files.
- Validate seven-day retention at both sides of the exact boundary.

## Risks

- Metrics can be biased if official scenarios are too small or tailored.
- Real harness or LM Studio updates can invalidate compatibility late.
- Applying patches for measurement can contaminate later scenarios unless each
  fixture is freshly restored outside the MCP process.
- A passing aggregate percentage cannot override any 100% security requirement.

## Acceptance criteria

- Every RF and CA has linked passing evidence; none is marked implicitly covered.
- CA-47 through CA-52 pass in their required environments.
- All quantitative success thresholds meet or exceed the PRD.
- All security and privacy measures requiring 100% pass without exception.
- The release artifact installs and runs from a clean environment.
- Documentation names supported versions, actual commands, configuration fields,
  limitations, and recovery steps.
- Final `npm run validate` and release review pass.

