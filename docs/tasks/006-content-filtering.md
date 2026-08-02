# Task 006: Filter repository content and enforce budgets

**Status:** Completed
**Depends on:** Task 005  
**PRD coverage:** RF-05, RF-06, RF-26 prerequisite; RN-08 through RN-14; CA-09 through CA-13

## Objective

Add fail-closed content classification, exclusion, minimization, interaction
budgets, and file-version evidence so only necessary permitted text can leave
the repository boundary.

## Requirements

- Exclude `.env`, credential and private-key material, binary files,
  Git-ignored files, and `.mcp-agent-ignore` matches.
- Treat project exclusions as additive; they cannot re-enable mandatory blocks.
- If Git status or content classification is uncertain, do not release content.
- Treat repository instructions as untrusted quoted data that cannot change
  configuration, policy, tools, or budgets.
- Enforce a configurable context budget and a default maximum of 15 exploratory
  interactions, bounded by protected maxima.
- Record every analyzed file, unread relevant path, exclusion reason, and
  limitation without including prohibited content.
- Fingerprint content used by a task so later features can detect changes before
  returning evidence or patches.
- Send only the minimum snippets needed for the stated goal.

## Assumptions to resolve

Define exact binary detection, sensitive filename/content patterns, Git ignore
query behavior, `.mcp-agent-ignore` syntax, byte/token accounting, and
fingerprint strategy. Document decisions and false-positive tradeoffs.

## Non-scope

No LM Studio call, exploration result synthesis, diff parsing, or final
change-detection decision.

## Implementation outline

1. Build an ordered authorization pipeline after path containment.
2. Add Git ignore and project-ignore adapters.
3. Add binary and sensitive-content classifiers with explicit reason codes.
4. Add an outbound context collector that cannot accept unclassified content.
5. Add interaction and context budget counters.
6. Record file fingerprints and analysis manifests without copying content.
7. Define prompt boundaries that label repository text as untrusted data.
8. Update security and configuration documentation.

## Expected areas

- Repository exploration filtering and context selection
- Git adapter and ignore parser
- Sensitive/binary classifiers
- Budget and manifest types
- Security fixtures and documentation

## Tests

- `.env`, common credentials, private keys, binary bytes, Git ignore, and
  project-ignore patterns.
- Negation or malformed project rules cannot re-enable mandatory exclusions.
- Git unavailable, ambiguous encoding, unreadable file, and classifier failure.
- Prompt injection text cannot alter the available operation set or limits.
- Exact interaction limit and context boundary, including multibyte text.
- Limitation manifests list omitted paths and impact metadata without content.
- Fingerprints change when used content changes.
- Captured outbound context contains no prohibited fixture marker.

## Risks

- Filename-only secret detection misses embedded credentials.
- Token accounting can diverge from the remote model tokenizer.
- Invoking Git unsafely can execute repository-controlled configuration.
- Overly broad filters reduce usefulness; uncertainty must still fail closed.

## Acceptance criteria

- CA-09 through CA-13 pass by inspecting the outbound context collector.
- The default 15-interaction rule is enforced and administratively bounded.
- Omitted relevant content is represented as an explicit limitation.
- No repository content is persisted outside the active test/task memory.
- `npm run validate` passes.

## Completion evidence

- The in-memory outbound collector applies additive project ignores, Git ignore
  status, mandatory sensitive path/content rules, binary/UTF-8 classification,
  duplicate minimization, and exact serialized-byte accounting before release.
- `.mcp-agent-ignore` supports a documented bounded glob subset; negation cannot
  re-enable content, while malformed or escaping policy files fail closed.
- Git uses `execFile` without a shell and minimal environment; unavailable or
  ambiguous classification omits the candidate with a metadata-only
  limitation.
- Exact interaction/context boundaries, immutable manifests, unread relevant
  paths, content fingerprints, and untrusted prompt labels are implemented
  without persisting repository text.
- Captured-context tests prove prohibited fixture markers never leave the
  collector and cover classifier/Git uncertainty, multibyte budgets, prompt
  injection, changing fingerprints, and real temporary Git ignore behavior.
- Documentation and ADR-0007 record binary, sensitive, Git, project-ignore,
  budgeting, minimization, and false-positive decisions.
- `npm run validate` passes formatting, linting, boundary checks, static types,
  the complete automated suite, and the production build.
