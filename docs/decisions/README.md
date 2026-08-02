# Architecture decision records

ADRs capture durable decisions that constrain the implementation. The approved
product requirements remain authoritative for product scope; ADRs explain the
technical context and consequences of implementing that scope.

## Index

- [ADR-0001: Keep repository authority in the local MCP server](0001-local-security-boundary.md)
- [ADR-0002: Use a pinned TypeScript and Node.js toolchain](0002-typescript-node-toolchain.md)
- [ADR-0003: Use a strict discriminated task response contract](0003-uniform-task-response-contract.md)
- [ADR-0004: Use environment-protected policy and versioned preference files](0004-layered-configuration-authority.md)
- [ADR-0005: Bind confirmation to an atomic project preference update](0005-confirmed-atomic-project-configuration.md)
- [ADR-0006: Anchor repository reads to canonical filesystem identities](0006-anchor-repository-reads-to-canonical-identities.md)

## Status values

- **Proposed:** under review and not yet binding.
- **Accepted:** binding for new implementation.
- **Superseded:** replaced by a later ADR, which must be linked.
- **Deprecated:** retained for history but no longer recommended.

New ADRs use a four-digit sequence, a short kebab-case title, and the sections
Context, Decision, Consequences, and Alternatives considered.
