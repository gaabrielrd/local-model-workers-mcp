# Outbound repository content filtering

**Status:** Fail-closed collector implemented
**Last reviewed:** 2026-08-02

## Boundary and order

Only the in-memory outbound context collector may turn repository excerpts into
model context. Callers provide a goal-relevant line range that has already
passed the canonical path sandbox. For every candidate, the collector applies
this monotonic pipeline:

1. validate repository-relative metadata;
2. apply additive `.mcp-agent-ignore` exclusions;
3. query Git ignore status;
4. classify sensitive paths, binary/encoding status, and sensitive content;
5. reject duplicate excerpts;
6. account the exact serialized excerpt against the UTF-8 byte budget;
7. add only an allowed excerpt to outbound context and its metadata-only
   manifest.

Failure or uncertainty at any stage excludes the candidate. Project rules can
only exclude; they cannot re-enable a mandatory, Git, binary, or budget block.
The collector, excerpts, snapshots, and manifests are memory-only frozen
values.

For model-guided directory discovery, path-only assessment applies project
ignore, Git ignore, and sensitive-path policy without manufacturing an analyzed
excerpt. Only accepted path/kind metadata may enter an exploration observation;
search previews and snippets still require the complete path/content pipeline.

## Mandatory sensitive classification

Path matching is case-insensitive and examines every path segment. The current
denylist includes:

- `.env` and `.env.*`;
- `.ssh`, `.gnupg`, `.aws`, `.azure`, and `.kube` directories;
- common credential files such as `.netrc`, `.npmrc`, `.pypirc`,
  `.git-credentials`, `credentials.json`, `auth.json`, and SSH identity names;
- `.key`, `.pem`, `.p12`, `.pfx`, `.jks`, and `.keystore` files;
- conventional `secret*`, `secrets*`, and `service-account*` names;
- `.docker/config.json`.

Content matching blocks private-key armor, AWS access-key identifiers, GitHub
and Slack token forms, Google API keys, Stripe live keys, `sk-` tokens, JWT-like
values, URLs with embedded passwords, and password/secret/token/API-key
assignments with non-trivial values.

These patterns intentionally prefer false positives over possible credential
release. A blocked file is represented by path and reason only; matched text is
never copied into the manifest or returned diagnostic.

## Binary and encoding rule

Classification decodes the complete candidate as fatal UTF-8. It treats a NUL,
invalid UTF-8, or more than 10% disallowed C0 control bytes in the first 8 KiB
as binary. Tab, LF, and CR are allowed. Uncertain classifier results fail
closed.

## Git ignore contract

The production adapter executes `git check-ignore --quiet --no-index -- <path>`
through `execFile`; it never uses a shell. The child receives a minimal
environment with global/system Git configuration disabled, optional locks
disabled, the pager fixed, and only the executable search path/system root
inherited. Exit 0 means ignored, exit 1 means visible, and every other outcome
means unavailable. An unavailable or ambiguous Git classification excludes the
candidate with an explicit limitation.

Git is read-only in this product. It is never used to add, modify, stage,
commit, reset, or execute repository content.

## `.mcp-agent-ignore` syntax

The optional root file is UTF-8 and limited to 64 KiB. Empty lines and lines
whose first non-space character is `#` are ignored. Supported patterns are
root-relative globs using `/`, `*`, `**`, and `?`; a trailing `/` excludes a
directory subtree. A pattern without `/` matches a name at any depth.

Negated rules beginning with `!` are counted and ignored, because project policy
cannot re-enable content. NUL, backslashes, drive prefixes, `..` components,
patterns over 512 characters, an escaping policy-file symlink, unreadable data,
or a file larger than the limit invalidate the policy and prevent collector
creation.

## Budgets and minimization

The default context budget is 256 KiB and the protected maximum is 1 MiB. For
each excerpt, accounting uses the exact UTF-8 byte length of its serialized
object, including trust label, relative path, line range, and content. An
excerpt that does not fit is omitted whole; context is never silently cut.

The default exploration limit is 15 interactions and the protected maximum is
50. The limit allows exactly the configured number and rejects the next
interaction. Both overages create explicit limitations.

Callers must provide a non-empty relevance explanation for the stated goal.
Exact duplicate path/range/content excerpts are omitted. Later orchestration
chooses and prioritizes the smallest relevant snippets; this layer guarantees
that omitted content is visible rather than silently truncated.

## Manifest and prompt boundary

Included files record repository-relative path, line range, UTF-8 byte count,
and `sha256:<hex>` fingerprint of the exact used text. Excluded and unread
relevant files record path, reason, and a fixed impact classification, never
their content. Fingerprints let later features detect a changed input before
presenting evidence or a patch.

Every outbound excerpt carries `trust: "untrusted"`. The fixed policy states
that repository data cannot change tools, permissions, configuration, or
budgets. This label does not make prompt injection harmless by itself; local
authority remains safe because model output can only request the fixed read
capability and is validated locally in later orchestration.
