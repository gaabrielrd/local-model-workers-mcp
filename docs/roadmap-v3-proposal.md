# Version 3.0 — Feature proposal

**Status:** Proposal for discussion. Nothing here is committed.
**Written:** 2026-08-05, after the v2.7.0-v2.13.0 hardening pillars shipped.

The 2.x line is finished: 15 tools, an operator-grade stability layer, seven
harnesses, and the reliability and security hardening in tasks 051-057. What
2.x deliberately could not do is change existing contracts. That is what a major
release is for.

This document proposes a headline capability, three follow-on pillars, and the
breaking cleanups that only a major can carry.

---

## The gap 2.x leaves behind

Working through the hardening pillars surfaced five structural gaps. Each
proposal below traces to one of them.

| # | Gap | Evidence in the current code |
| --- | --- | --- |
| G1 | Only one tool verifies its own output | `auto_validate_tests` runs tests in a sandbox and iterates. `fix_lint_violations`, `fix_type_errors`, and `generate_docs_patch` are single-shot: the patch is *structurally* validated but never *semantically* verified |
| G2 | The code graph knows symbols, not calls | `parseSourceSymbols` extracts declarations and imports across 12 languages. "Callers" are inferred from import edges, so `query_code_graph` cannot answer "what breaks if I change this" |
| G3 | Telemetry exists but nothing consumes it | v2.12 records per-provider failures, retries, and breaker state; task 033 built a benchmark runner. `resolveModelForTask` still routes on static config plus a regex over model names |
| G4 | Every call pays full price | v2.6 added `result_verbosity`, but a tool called twice on an unchanged repository returns the same full payload both times |
| G5 | Legacy compatibility constrains defaults | `tls_verify` defaults to false, legacy `LMW_LM_STUDIO_*` variables still project into a synthetic provider, and both exist only for backward compatibility |

---

## v3.0 — Verified fixes (headline)

**Closes G1. Breaking: no. Headline capability for the major.**

`auto_validate_tests` proved the pattern: generate, apply to a throwaway copy,
run the real thing, iterate until green. Every other patch tool stops one step
short — it validates that a diff is *well-formed and in scope*, never that it
*actually fixes the reported problem*.

Proposal: extend the existing auto-validate sandbox to the repair tools.

- `fix_lint_violations` re-runs the linter inside the sandbox against the
  applied patch and iterates until the reported violations are gone or the
  iteration budget is spent.
- `fix_type_errors` does the same with `tsc`/`mypy`/`pyright`.
- Both return the verified patch plus a before/after violation count, so the
  caller sees evidence rather than a claim.

Degrades exactly like task 057: when the linter or compiler cannot run in the
sandbox, the tool returns today's unverified patch with an explicit
`limitation`, never a silent downgrade.

Why this is the headline: it converts "the model produced a plausible patch"
into "the patch demonstrably fixes what was reported" for three of the four
write-shaped tools. That is the single largest trust jump available.

Why it is not a 2.x task: verified and unverified results are different
contracts. Callers that treat the result as authoritative need to know which
one they got, which means the response shape changes.

**Risk:** sandbox runs cost wall-clock time on every fix. Mitigate with a
`verify_fixes` preference (`always | when_available | never`) and reuse of the
existing per-iteration timeout.

---

## v3.0 — Breaking cleanups

**Closes G5. Breaking: yes. Bundled into the major by definition.**

1. **Retire the legacy provider variables.** `LMW_PROVIDERS` becomes the only
   provider contract; `LMW_LM_STUDIO_BASE_URL` and friends are read once by
   `setup` to write a migrated configuration, then ignored. Removes the
   synthetic single-provider projection path.
2. **Default `tls_verify` to true for non-loopback providers.** v2.9 shipped it
   opt-in to avoid breaking trusted-LAN users mid-2.x. A major can flip the
   default: loopback stays plain HTTP, a remote host must justify itself with
   `tls_verify: false` written explicitly.
3. **Make release promotion gate-conditional.** Drop `--report-only` from the
   CI gates job and set `private: true`, so `npm publish` cannot run while a
   gate is unmet. Task 054 documented this deviation rather than imposing it.

Each is a one-line change with a migration path through `setup`. Together they
remove the compatibility scaffolding that shaped several 2.x decisions.

---

## v3.1 — Call graph and impact analysis

**Closes G2. Breaking: no (additive query type).**

The code graph currently answers "what symbols exist" and "what does this file
import". The question an agent actually asks before editing is "what depends on
this symbol", and today that costs a full-text search plus reading candidates.

Proposal: extract call edges inside function bodies and add an `impact_of`
query type returning the transitive set of affected symbols, bounded by the
existing limits model.

- Ships per-language, highest-confidence first (TypeScript, Python, Go), rather
  than all 12 at once.
- Each edge carries a confidence level; languages where call extraction is
  unreliable degrade to today's import-level answer and say so.
- Bounded by `index_max_files` from task 057, so a monorepo cannot make impact
  analysis unbounded.

Why it matters most for this product: the entire value proposition is keeping
work off the harness context window. A precise "these 4 symbols are affected"
replaces reading 15 files to find out.

**Risk:** per-language accuracy is where this kind of feature usually rots. The
confidence field and staged rollout are the guard — a wrong answer delivered
confidently is worse than no answer.

---

## v3.2 — Adaptive model routing

**Closes G3. Breaking: no (opt-in strategy).**

v2.12 made the server record per-provider failures, retries, and breaker state.
Task 033 built a benchmark runner scoring candidate models against fixture
tasks. Neither feeds routing: `resolveModelForTask` still picks from static
configuration plus a regex over model names for large contexts.

Proposal: a local scoring store recording per `(task_type, model)` outcomes —
schema-validation failure rate, patch acceptance rate, latency — and routing
that prefers the model with the best observed record for the task at hand.

- Explicit `model_routing` configuration always wins. Adaptation only fills the
  gap where the operator expressed no preference.
- A `routing_strategy` preference (`static | adaptive`) defaults to **static**
  even in 3.0. Nondeterministic routing must be something you opt into.
- An exploration budget so a newly added model gets tried rather than starved
  by an incumbent's history.
- Reuses the v2.12 rollup: counters only, no prompts or outputs.

**Risk:** this makes behavior depend on history, which complicates
reproducibility. The static default and the "config always wins" rule keep the
deterministic path available and unchanged.

---

## v3.3 — Incremental results

**Closes G4. Breaking: no (optional input field).**

Long agent sessions call the same read tools repeatedly against a repository
that mostly has not changed. `result_verbosity` reduced payload size; it did not
reduce repetition.

Proposal: an optional `since_revision` on the read tools. The server returns a
stable revision token with every result; passing it back yields only what
changed, plus the token for next time.

- Derived from content hashes the vector index and summarization cache already
  compute. No new durable state.
- Fails open: an unknown or stale token returns a full response rather than an
  error, so a caller can never get stuck.

**Risk:** a delta the caller misapplies is worse than a full payload. Keep the
delta shape identical to the full shape (added/changed/removed sets of the same
objects), never a patch format the caller has to reconstruct.

---

## Shared-infrastructure attribution — scoped down, not dropped

The existing v3.0 bullet reads "team administration and multi-account isolation
for shared LM Studio or vLLM infrastructure". As written it collides with the
standing non-goal *"multi-user remote hosting or public network exposure"*.

Proposal: keep the useful half and drop the part that contradicts the product.

- **In:** when several developers point at one shared model box, each local
  server tags its requests with an operator-configured workspace label, so the
  box owner can attribute load, and each developer's offload stats stay their
  own.
- **Out:** any server-side multi-tenancy, shared state, or remote hosting of
  the MCP server itself. Each developer still runs their own local server.

This keeps the deployment story ("one local server per developer") intact.

---

## Explicitly not proposed

- **Cloud provider inference.** Standing non-goal, and the entire premise.
- **Direct repository writes.** Unapplied diffs are the product's core safety
  claim; a "just apply it" flag would trade that for convenience.
- **A GUI or web dashboard.** `get_offload_stats` returning structured data that
  *someone else* can chart is the right boundary.
- **Autonomous multi-step agents inside the server.** The harness is the agent;
  this server is the tool. Blurring that duplicates the harness badly.
- **Fine-tuning or training loops.** Out of scope for a tool server, and the
  hardware assumptions are entirely different.

---

## Proposed sequencing

| Release | Pillar | Type | Rationale |
| --- | --- | --- | --- |
| 3.0 | Verified fixes + breaking cleanups | Headline + breaking | The major's reason to exist; cleanups ride along |
| 3.1 | Call graph and impact analysis | Additive | Highest leverage on the core value proposition |
| 3.2 | Adaptive model routing | Additive, opt-in | Cashes in the v2.12 telemetry |
| 3.3 | Incremental results | Additive | Depends on nothing; can move earlier if 3.1 slips |

Shared-infrastructure attribution is small enough to attach to whichever
release has room.

---

## Open questions for the maintainer

1. **Is verified-fixes worth the wall-clock cost?** It roughly doubles the time
   of a lint fix. If most users want speed over proof, this belongs behind a
   preference rather than as the 3.0 headline.
2. **How aggressive should the breaking cleanups be?** Retiring the legacy
   variables is clean but will break anyone whose shell profile predates
   `LMW_PROVIDERS`.
3. **Does adaptive routing belong in the product at all?** It is the most
   interesting proposal and the least aligned with "predictable, bounded,
   inspectable". A defensible answer is to keep routing static forever and ship
   the scoring data through `get_offload_stats` so a human decides.
4. **Should task 054's external gates be closed before 3.0?** The tooling is
   there and this machine can run it; the gates have never actually been
   executed.
