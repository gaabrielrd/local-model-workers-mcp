# Development process

**Status:** Normative process for implementation  
**Last reviewed:** 2026-08-02

## Current phase

The repository contains an approved PRD, design documentation, implementation
plan, and a validated TypeScript/Node.js foundation. Product features are added
one numbered task at a time from [the V1 plan](tasks/README.md).

## Before changing the project

Read, in order:

1. [README.md](../README.md)
2. [architecture.md](architecture.md)
3. this document
4. [testing.md](testing.md)
5. the relevant PRD requirements and acceptance criteria
6. relevant ADRs in [decisions](decisions/README.md)

Inspect the current implementation and tests before proposing a change. For a
multi-file feature, write a short plan that states requirements, assumptions,
non-scope, sequential tasks, and risks.

## Implementing a feature

Work on one product capability at a time:

1. Translate the selected acceptance criteria into observable tests.
2. Identify the owning feature and its public API.
3. Add the smallest behavior needed for the increment.
4. Keep network, filesystem, Git, process, clock, and persistence access behind
   services or adapters.
5. Do not import another feature's internal files.
6. Update tests for every behavior change, including failure and security paths.
7. Update affected documentation and add an ADR for a durable architectural
   decision.
8. Run the full validation command and review the final diff for scope,
   security, and accidental secret inclusion.

## Required package scripts

`package.json` provides `npm run validate`, which covers:

- formatting or formatting verification;
- linting;
- static type checking;
- automated tests;
- production build.

The component scripts are `format:check`, `lint`, `check:boundaries`,
`typecheck`, `test`, and `build`; `test` invokes `build` through its `pretest`
hook. A task is not complete while any validation stage is failing.

## Dependencies

Prefer platform APIs and dependencies already present. A new dependency needs a
specific use case, a short explanation of why existing options are inadequate,
and review of its security and maintenance impact. Never add a dependency solely
to avoid a small, clear implementation.

Do not commit credentials, local `.env` files, repository content captured from
tasks, prompts, model responses, or generated patches.

## Documentation maintenance

Update documentation in the same change when behavior affects:

- commands or installation;
- configuration, environment variables, or defaults;
- tool inputs, outputs, states, or errors;
- architecture or feature boundaries;
- security controls and known limitations;
- LM Studio, Claude Code, Codex, Git, or filesystem integration;
- platform support.

Use an ADR when a decision is expensive to reverse, constrains multiple
features, or establishes a new trust boundary. ADRs record context and
consequences; they do not replace user-facing or operational documentation.

## Definition of done

A change is complete only when:

- its acceptance criteria are satisfied;
- observable behavior and relevant failure paths are tested;
- lint, type checking, tests, and build pass through `npm run validate`;
- architecture boundaries and security invariants are preserved;
- documentation reflects the resulting behavior;
- the final diff contains only the intended scope.
