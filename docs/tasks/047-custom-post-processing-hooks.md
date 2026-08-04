# Task 047: Custom Post-Processing Hooks

**Status:** Planned (v2.4.0)
**Depends on:** Tasks 011, 021 (completed)

## Objective

Run user-defined local scripts immediately after patch generation for custom
formatting, security-policy checks, or lint validation before a proposal is
returned to the client. Hooks run only with explicit developer configuration
and never alter the repository.

## Key Design Decisions

- TBD (to be resolved during planning/implementation).

## Acceptance Criteria

- [ ] Hooks execute only when explicitly configured.
- [ ] Hooks run against generated patches and never write to the repository.
- [ ] Hook failure fails closed and blocks the proposal.
- [ ] `npm run validate` green.

## Files Changed

- TBD.
