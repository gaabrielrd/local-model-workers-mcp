# Security model

**Status:** V1 security requirements  
**Last reviewed:** 2026-08-02

## Trust boundaries

The developer and local harness authorize a task. Repository files, Git
metadata, LM Studio responses, and network failures are untrusted inputs. The
local MCP server is responsible for enforcing policy before content crosses the
network and before remote output is presented as applicable.

The product does not make an untrusted network safe. Plain HTTP is supported
only on a private, trusted local network. Bearer authentication is used when the
LM Studio deployment supports it; `lms` deployments without token support use
an explicit unauthenticated mode. Neither mode is supported over the public
internet or a public network.

## Repository access

Before every read, the server must:

1. canonicalize the repository root and requested path;
2. resolve relative components and symbolic links;
3. verify that the resolved target remains inside the canonical root;
4. apply mandatory sensitive and binary exclusions;
5. apply Git ignore rules;
6. apply additional `.mcp-agent-ignore` exclusions;
7. enforce task budgets before returning bounded text.

Listing directories, searching text, and reading snippets are the only internal
repository operations available to a remote task. Repository content cannot
grant tools, alter limits, change configuration, or override these rules.

The implemented capability anchors one canonical root by device/inode identity
and repeats root and target verification before returning each result. Reads use
the resolved canonical target, so changing a symlink after authorization cannot
redirect the operation. Component-aware containment handles sibling prefixes;
Windows comparison is case-insensitive and separator-aware. Fixed listing,
search, file, line, and byte ceilings are documented in
[repository-access.md](repository-access.md).

## Content that cannot reach LM Studio

- `.env` files and credential material;
- private keys and known secret-bearing files;
- binary files;
- files ignored by Git;
- paths excluded by `.mcp-agent-ignore`;
- paths outside the task root, including symlink targets;
- context beyond the task's explicit budget.

Exclusion rules are monotonic: a project rule can forbid more content but cannot
allow content blocked by a mandatory rule.

The implemented outbound collector is the only release gate for repository
text. It fails closed on Git uncertainty, malformed project policy, invalid
UTF-8, binary signals, classifier failure, sensitive path/content patterns, and
budget overflow. Excluded and unread relevant files appear only as path, reason,
and fixed impact metadata. Exact classifier patterns, Git process isolation,
ignore syntax, byte accounting, and false-positive trade-offs are documented in
[content-filtering.md](content-filtering.md).

## Remote output

LM Studio output is data, not an instruction to the server. The server validates
all evidence, paths, line ranges, states, error codes, and patches locally.

A test patch is not applicable when it changes production code, includes an
unclassifiable path, exceeds 10 files or 1,000 changed lines, or was generated
from a file that changed during the task. Oversized work returns a division plan
rather than a truncated diff. The server never applies a patch, installs a
dependency, or executes a command.

## Secrets and configuration

Bearer tokens and other credentials belong to protected configuration and may
not appear in agent-editable JSON. `get_config`, health checks, validation
errors, HTTP errors, and logs must redact protected values. `update_config`
cannot alter protected settings and requires both explicit confirmation and a
matching revision.

The protected process environment requires `LMW_LM_STUDIO_BASE_URL` and
`LMW_ALLOWED_MODELS`; `LMW_LM_STUDIO_BEARER_TOKEN` is optional. The
placeholder-only `.env.example` documents their shape; the application does not
load `.env` files. Editable global and project JSON cannot contain credentials
or protected policy fields.

Resolved snapshots never retain the token. They expose `authentication` as
`bearer` or `none` and `token_configured` as a boolean. Public views show
`[REDACTED]` only in Bearer mode and `null` otherwise. Configuration revisions
hash public effective values and origins, not secret material. Validation
diagnostics are constructed from fixed messages and never echo rejected raw
values.

Project mutation accepts only a strict allowlist of editable preference fields.
Confirmation is bound to the normalized proposal and expected revision through
a SHA-256 identifier. Protected-field attempts, stale revisions, missing or
mismatched approval, and atomic-write failures perform no target write. The
same-directory temporary file uses mode `0600`, is flushed before rename, and
is removed by its exact generated path on failure.

The LM Studio adapter places a configured token only in the `Authorization`
header and omits that header entirely in `none` mode. It constructs all returned
errors from fixed messages without upstream bodies, URLs, headers, prompts, or
responses. Health probes enforcement with a deliberately invalid credential
only in Bearer mode; `none` is reported as healthy `not_configured` after
successful reachability. Inference verifies protected allowlisting, catalog
presence, and response model identity without fallback.

## Data lifetime and logs

Goals, paths, snippets, prompts, responses, evidence, and patches exist only for
the lifetime of one task and are not reused as memory. Operational logs contain
only identifiers, timestamps, model identifiers, duration, status, and error
codes. They are retained locally for seven days and then removed.

Error handling must assume that exception messages can contain request details.
Redaction occurs before serialization or logging, including cancellation and
timeout paths.

## Primary threats and controls

| Threat | Required control |
| --- | --- |
| Path traversal or symlink escape | Canonicalize and verify containment for every access |
| Prompt injection in repository content | Treat content as quoted data and expose only fixed read operations |
| Secret exfiltration | Mandatory classification, ignore rules, minimization, and outbound inspection tests |
| Malicious or malformed model output | Parse and validate locally; fail closed |
| Production change disguised as a test | Classify every patch path and block ambiguity |
| Stale evidence or patch | Verify references and detect changes in every used file before delivery |
| Configuration downgrade | Protected maxima, allowlisted fields, confirmation, and revision checks |
| Cross-task leakage | Isolated task state and no content persistence |
| Resource exhaustion | Shared concurrency, bounded queue, timeouts, context budgets, cancellation, and one retry |
| Log leakage | Metadata allowlist, centralized redaction, and retention tests |

## Security validation

Security controls require automated negative tests, not only documentation.
[testing.md](testing.md) defines the minimum attack and leakage cases. A failure
that prevents safe classification must fail closed as `blocked` or `failed`; it
must not silently broaden access or return partial work as completed.
