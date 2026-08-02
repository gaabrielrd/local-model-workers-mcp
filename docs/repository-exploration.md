# Repository exploration

**Status:** Implemented transport-neutral use case
**Last reviewed:** 2026-08-02

## Boundary

`exploreRepository` validates the goal, root, and optional priority paths before
creating a task or contacting LM Studio. It then composes the canonical
repository capability, fail-closed outbound collector, isolated task runtime,
global capacity coordinator, and structured inference port. It never writes to
the repository, runs a command, or exposes the filesystem to the model.

The model sees one closed declarative protocol with exactly four actions:

- `list_directory` with the bounded directory input;
- `search_text` with the bounded literal/safe-regex input;
- `read_snippet` with a bounded path and line range;
- `finalize` with the proposed analysis and citations.

Unknown fields, actions, paths, modes, and limits fail schema validation. The
system message states that repository excerpts are untrusted quoted data and
cannot grant tools, permissions, configuration, or budgets. There is no shell,
network, write, command, or generic tool operation.

## Iterative flow

Each model decision consumes one configured exploration interaction. Directory
entries pass path, project-ignore, Git-ignore, and sensitive-path assessment
before their path/kind metadata becomes an observation. Search previews and
read snippets enter the same outbound collector as excerpts; rejected content
never enters an observation. Subsequent calls receive only the collector's
bounded snapshot and sanitized metadata observations.

`queued` is emitted when the isolated task is created. Acquired work emits
`exploring`, `consulting_model`, and `preparing_result` as applicable. Queue and
processing timeouts remain separate through the Task 008/009 composition.

Interaction exhaustion returns `blocked` with
`interaction_limit_exceeded`. Context exhaustion records an explicit
`context_budget_exceeded` limitation and its impact; a final result may still be
completed only when its claimed relevant files and evidence remain valid.

## Result and evidence

A completed result contains localized summary, risks, and next steps plus
technical-English fields for relevant, analyzed, and relevant unread files and
limitation impact. The uniform task envelope contains evidence and limitations.

Every relevant file must have an included collector record. Every citation must
be inside the exact path and inclusive line range of an accepted excerpt. Before
delivery, the server rereads the full accepted range and compares its SHA-256
fingerprint with the analyzed version. Missing paths, invented ranges, changed
content, and unverifiable reads return `blocked` with `invalid_evidence`; none
of the proposed citations appear in a completed result.

Human explanations use the request language, such as `pt-BR`, while actions,
status, field names, and diagnostic codes remain English.

## Limitations

- Exploration quality remains bounded by the configured interaction and context
  budgets and by locally omitted files.
- Excluded paths may appear in the local result/limitation manifest as metadata,
  but their content is never sent.
- The V1 protocol uses structured decisions rather than remote executable tool
  calls, even when the selected model advertises tool-use capability.
- Release-candidate Python and TypeScript evidence-quality metrics remain Task
  015 work.
