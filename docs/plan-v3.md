# Plan — Version 3.0 line

**Status:** Plan awaiting execution. Produced by `/plan-feature` from
[roadmap-v3-proposal.md](roadmap-v3-proposal.md).
**Scope:** the full v3 line — v3.0 through v3.3.

---

## 1. Objective

Close the five structural gaps the 2.x line leaves behind, and spend the one
opportunity a major release gives to change contracts that backward
compatibility has frozen.

The headline is **verified fixes**: today only `auto_validate_tests` proves its
own output. Every other write-shaped tool validates that a diff is well-formed
and in scope, never that it actually fixes the reported problem.

---

## 2. Requirements

### R1 — Verified fixes (v3.0)
- `fix_lint_violations` and `fix_type_errors` re-run the real linter/compiler
  against the applied patch inside the existing auto-validate sandbox.
- Iterate until the reported violations are gone or the budget is exhausted.
- Return the verified patch plus before/after violation counts as evidence.
- When the tool cannot run in the sandbox, return today's unverified patch with
  an explicit `limitation` — never a silent downgrade.
- Behavior is governed by a `verify_fixes` preference
  (`always | when_available | never`).

### R2 — Breaking cleanups (v3.0)
- `LMW_PROVIDERS` becomes the only provider contract. Legacy
  `LMW_LM_STUDIO_*` variables are read once by `setup` to write a migrated
  configuration, then ignored by the server.
- `tls_verify` defaults to `true` for non-loopback providers; loopback keeps
  plain HTTP. Opting out requires writing `tls_verify: false` explicitly.
- Release promotion becomes gate-conditional: drop `--report-only` from the CI
  gates job and set `private: true`.

### R3 — Call graph and impact analysis (v3.1)
- Extract call edges inside function bodies, staged by language, highest
  confidence first (TypeScript/JavaScript, Python, Go).
- New `query_code_graph` query type `impact_of`, returning the transitive set of
  affected symbols.
- Every edge carries a confidence level; languages without reliable call
  extraction degrade to today's import-level answer and say so.
- Bounded by the `index_max_files` ceiling from task 057.

### R4 — Adaptive model routing (v3.2)
- A local scoring store recording per `(task_type, model)` outcomes: schema
  validation failure rate, patch acceptance rate, latency.
- A `routing_strategy` preference (`static | adaptive`) defaulting to `static`.
- Explicit `model_routing` configuration always wins over adaptation.
- An exploration budget so a newly added model is tried rather than starved.
- Counters only — no prompts or outputs — reusing the v2.12 rollup discipline.

### R5 — Incremental results (v3.3)
- Optional `since_revision` on read tools; every result carries a revision token.
- Deltas use the same object shapes as full responses (added/changed/removed),
  never a patch format the caller must reconstruct.
- Derived from content hashes already computed; no new durable state.
- Fails open: an unknown or stale token returns a full response.

### R6 — Shared-infrastructure attribution (any release with room)
- An operator-configured workspace label tags outbound inference requests.
- Each developer's offload stats stay their own.

---

## 3. Non-scope

Carried from the standing non-goals and the proposal, restated so execution
cannot drift into them:

- Cloud provider inference APIs.
- Direct repository writes outside the auto-validate sandbox.
- GUI, web dashboard, or charting.
- Server-side multi-tenancy, shared state, or remote hosting of the MCP server.
- Autonomous multi-step agents inside the server — the harness is the agent.
- Fine-tuning or training loops.
- Consolidating or renaming existing tools beyond what R2 requires.

---

## 4. Assumptions

Declared so they can be corrected rather than discovered late:

- **A1.** "v3 completa" means the full v3.0–v3.3 line, not only v3.0. Each
  release stays independently shippable with `npm run validate` green, per the
  project's one-minor-per-pillar rule.
- **A2.** The four open questions in the proposal are settled by proceeding:
  verified fixes is the v3.0 headline, and adaptive routing ships. Both land
  behind preferences whose defaults preserve today's behavior, so the decision
  stays reversible in configuration rather than in code.
- **A3.** Breaking changes are acceptable in a major, provided `setup` migrates
  existing installations automatically.
- **A4.** Node 24.18.x and the current two runtime dependencies stay fixed. No
  new dependency is introduced without a written justification.
- **A5.** Task 054's external release gates remain operator-executed. This plan
  does not claim to close them.
- **A6.** `AGENTS.md` is stale (states 2.6.0 and describes 051-057 as planned).
  Refreshing it is part of the work, not a separate request.

---

## 5. Proposed solution

Minimal shape per requirement, respecting the feature-boundary rule (features
import each other only through `index.ts`).

| Req | Approach | Primary modules |
| --- | --- | --- |
| R1 | Extract the sandbox verification loop that `auto-validate` already owns into a reusable capability, then call it from `lint-fix`. No new sandbox implementation. | `auto-validate` (export a verify capability), `lint-fix/fix.ts`, `configuration` (preference) |
| R2 | Delete the synthetic single-provider projection; move migration into `installation`. Flip the `tls_verify` default in `transport-security`. Edit the workflow and manifest. | `configuration`, `installation`, `model-inference/transport-security.ts`, `.github/workflows/validate.yml` |
| R3 | Add call-edge extraction to `code-graph/parser.ts` behind a per-language capability flag; add the `impact_of` query to `graph.ts`. | `code-graph` |
| R4 | A scoring store in `operational-logging` (reusing the daily rollup), consumed by `resolveModelForTask`. | `operational-logging`, `configuration` |
| R5 | A revision token derived from existing content hashes, computed in the tools that already hash content. | `mcp-server`, `semantic-search`, `module-summary` |
| R6 | A `workspace_label` preference attached as an outbound request header. | `configuration`, `model-inference` |

**Design constraint that shapes R1:** the verification loop lives in
`auto-validate` today and is entangled with test-proposal generation. It must be
extracted as a capability that takes "a patch and a command" and returns "did it
get better", so `lint-fix` can use it without depending on test proposals.

---

## 6. Sequential tasks

Each task is one increment: implement, test, document, `npm run validate`,
commit. Versions bump per the project rule.

| # | Task | Release | Depends on |
| --- | --- | --- | --- |
| 058 | Extract a reusable sandbox verification capability from `auto-validate` | v3.0 | — |
| 059 | Verified fixes for `fix_lint_violations` and `fix_type_errors` + `verify_fixes` preference | v3.0 | 058 |
| 060 | Breaking cleanups: retire legacy provider vars, `tls_verify` default, gate-conditional promotion | v3.0 | — |
| 061 | Call-edge extraction (TS/JS, Python, Go) with confidence levels | v3.1 | — |
| 062 | `impact_of` query type over the call graph | v3.1 | 061 |
| 063 | Adaptive model routing, `static` by default | v3.2 | — |
| 064 | Incremental results via `since_revision` | v3.3 | — |
| 065 | Workspace-label attribution | any | — |
| 066 | Refresh `AGENTS.md`, `README.md`, roadmap, and the tasks index for the v3 line | last | all |

058 and 060 are independent and can be done in either order. 061→062 and
058→059 are the only hard chains.

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| **Verified fixes roughly doubles lint-fix wall-clock time.** The proposal's open question #1. | `verify_fixes` defaults to `when_available`, and the existing per-iteration timeout caps the cost. A user who wants speed sets `never` and gets exactly today's behavior. |
| **Extracting the verification loop destabilizes `auto_validate_tests`,** the one tool that currently works this way. | 058 is a pure refactor with no behavior change; its acceptance criterion is that the existing auto-validate tests pass untouched. |
| **Call-edge extraction rots per language.** A confidently wrong impact answer is worse than none. | Confidence level on every edge; staged rollout to three languages; degrade to import-level and say so. |
| **Adaptive routing makes behavior history-dependent,** which fights the product's "predictable, bounded, inspectable" character. | `static` default. Config always wins. The scoring data is readable through `get_offload_stats` so a human can make the call instead. |
| **Retiring the legacy variables breaks existing shells.** | `setup` migrates automatically and the server emits a one-time diagnostic naming the variables it ignored. |
| **`tls_verify: true` by default breaks trusted-LAN users over plain HTTP.** | Loopback is exempt. The failure is a clear `invalid_configuration` at startup naming the fix, not a silent hang. |
| **Delta responses misapplied by a caller** are worse than full payloads. | Identical object shapes; fail open to a full response on any doubt. |
| **Context/session exhaustion mid-line.** The v3 line is four releases. | Every task is independently shippable and validated. Stopping after any task leaves `main` green and coherent. |

---

## 8. Acceptance criteria

**Per task:** implements only its stated scope; adds observable success, failure,
and security tests; preserves feature boundaries; updates affected docs; adds an
ADR when it settles a durable decision; `npm run validate` green; final diff
reviewed for scope, secrets, and unintended writes.

**Per release:**
- **v3.0** — `fix_lint_violations` and `fix_type_errors` return verified patches
  with before/after counts when the tool can run, and an explicit limitation
  when it cannot. Legacy provider variables no longer configure the server.
  `tls_verify` is true by default off loopback. `npm publish` cannot run with an
  unmet gate. `auto_validate_tests` behavior is unchanged.
- **v3.1** — `impact_of` returns the transitive affected set for TS/JS, Python,
  and Go, with confidence, and degrades explicitly elsewhere.
- **v3.2** — Adaptive routing is available and off by default; enabling it never
  overrides explicit `model_routing`.
- **v3.3** — A repeated read call with a valid `since_revision` returns strictly
  less than the full payload; an invalid token returns the full payload.

**Line-wide:** the 15-tool public surface is unchanged except where R1 and R3
extend response shapes additively; no repository write path is introduced; no
new runtime dependency.
