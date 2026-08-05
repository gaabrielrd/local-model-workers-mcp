# Configuration model

**Status:** Effective configuration and confirmed local mutation implemented
**Last reviewed:** 2026-08-02

## Authority and precedence

Configuration is split by authority so repository content cannot weaken
administrative controls or expose credentials.

| Layer | Purpose | Location | May contain secrets |
| --- | --- | --- | --- |
| Protected | Provider connections, credentials, model allowlists, and administrative policy | Process environment and code-owned constants | Yes |
| Global | Developer defaults shared across projects | OS configuration directory | No |
| Project | Per-project preferences | `.local-model-workers.json` in the canonical project root | No |
| Built-in | Safe limit defaults | Code-owned constants | No |

Protected policy cannot be overridden. Editable values resolve in this order:
project, global, then built-in. `default_model` has no built-in value and must
be set globally or by the project.

## Protected environment

The legacy single-provider mode requires the URL and allowlist. The token is
optional:

| Variable | Type and validation |
| --- | --- |
| `LMW_LM_STUDIO_BASE_URL` | Absolute `http` or `https` URL without embedded credentials |
| `LMW_LM_STUDIO_BEARER_TOKEN` | Optional non-empty Bearer credential; absent or blank selects `none` |
| `LMW_ALLOWED_MODELS` | JSON array containing one or more unique, non-empty model identifiers |

Multi-provider mode is enabled by `LMW_PROVIDERS`, a JSON array of one to 16
strict objects with this shape:

```json
{
  "name": "primary",
  "type": "lm-studio | ollama | vllm | localai",
  "base_url": "http://model-host.local:1234/v1",
  "bearer_token": "optional-secret",
  "allowed_models": ["publisher/model-id"],
  "priority": 0
}
```

Names must be unique, URLs must be absolute HTTP(S) URLs without credentials,
query, or fragment, and lower numeric priority wins.
`LMW_PROVIDER_RECHECK_INTERVAL_MS` controls when an unhealthy provider becomes
eligible for another health check (default `60000`). When `LMW_PROVIDERS` is
present it replaces the legacy provider variables; when absent, those variables
are projected as one `lm-studio` provider for backward compatibility. Provider
credentials remain protected and never enter editable preference files or
public configuration.

Use the placeholder-only [`.env.example`](../.env.example) as a reference. The
application does not load `.env` files. The launcher or harness supplies the
environment, keeping credentials outside agent-editable JSON.

## Editable files

Both files use strict, versioned JSON schemas. Unknown keys, wrong types,
unsupported versions, invalid JSON, and values outside administrative maxima
reject the entire configuration. `enabled_features` is global-only because the
tool list is fixed when the MCP process starts; project preferences reject it.

```json
{
  "schema_version": 1,
  "default_model": "publisher/model-id",
  "model_routing": {
    "exploration": "small/model-id",
    "embedding": "embedding/model-id"
  },
  "steering_prompt": "Prefer semantic search for descriptive queries.",
  "result_verbosity": "standard",
  "enabled_features": ["exploration", "tests", "docs", "lint"],
  "profile": "balanced",
  "post_processing_hooks": [
    {
      "command": "prettier",
      "args": ["--write", "--parser", "babel"],
      "timeout_ms": 30000
    }
  ],
  "limits": {
    "max_concurrency": 2,
    "queue_timeout_ms": 300000,
    "processing_timeout_ms": 600000,
    "max_exploration_interactions": 15,
    "context_budget_bytes": 262144
  }
}
```

`default_model` is optional in each individual file, but the resolved value is
required and must be present in `LMW_ALLOWED_MODELS`. `model_routing` is an
optional object mapping task types (`embedding`, `exploration`,
`test_proposal`, `lint_fix`, `docs_generation`, `summarization`, `code_graph`)
to model IDs from `LMW_ALLOWED_MODELS`; a task with no routing entry falls back
to `default_model`, routing entries follow the same project > global > built-in
precedence, and any entry that references an unauthorized model rejects the
whole configuration. `steering_prompt` is an optional custom directive
appended to the harness prompt steering instructions; it is limited to 2,000
characters. `limits` and each child field are optional. A file must always
include `schema_version: 1`.

`enabled_features` accepts one or more unique values from `exploration`,
`tests`, `docs`, and `lint`. When omitted, all four groups are enabled for
backward compatibility. The field is editable only in global preferences and
is exposed by `get_config`.

### Workspace profiles

`profile` is an optional project or global override selecting a preset from
`fast`, `thorough`, or `balanced`. The effective profile resolves project over
global over the `balanced` built-in default. Each preset supplies fallback
values for the editable `limits`; any explicit limit at project or global scope
wins over the active preset. Switching the profile through `update_config`
applies immediately to the next tool call without a server restart. See
[workspace profiles](tasks/048-workspace-profiles.md).

### Result verbosity

`result_verbosity` is an optional project or global override (project over global
over the `"standard"` built-in default) selecting how detailed tool results are.
Accepted values are `"terse"`, `"standard"`, and `"verbose"`. `"standard"` and
`"verbose"` render results exactly as before; `"terse"` compacts the
highest-payload tool responses so they consume less of the harness context
window. The effective value is exposed by `get_config` and can be changed at
runtime through `validate_config`/`update_config` or the
`configure-global --result-verbosity` CLI flag. See
[harness context management](tasks/050-harness-context-management.md).

### Custom post-processing hooks

`post_processing_hooks` is an optional project or global override (project over
global over `[]`). Each hook is an object with a required `command`, an
optional `args` array (up to 128 entries), and an optional `timeout_ms` between
1 and 120,000 (default 30,000). At most 8 hooks are allowed. When empty, no
hooks run.

Hooks execute immediately after patch generation for `propose_tests`,
`fix_lint_violations`, `fix_type_errors`, and `generate_docs_patch`. The
generated patch is written to a fresh temporary directory and piped to each
hook's stdin with that directory as its working directory; the developer's
repository is never the hook working directory. Hooks may transform the patch,
but a non-zero exit, timeout, spawn failure, or output rejected by the local
patch policy fails closed and blocks the proposal. See
[custom post-processing hooks](tasks/047-custom-post-processing-hooks.md).

### Global location

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/local-model-workers/preferences.json` |
| Linux | `$XDG_CONFIG_HOME/local-model-workers/preferences.json`, or `~/.config/local-model-workers/preferences.json` |
| Windows | `%APPDATA%\local-model-workers\preferences.json`, or `~/AppData/Roaming/local-model-workers/preferences.json` |

The global file is optional. Path resolution is injected in tests so the suite
never reads the developer's real profile.

### Project location and containment

Project preferences are read only from `.local-model-workers.json` directly
inside the supplied project root. The loader canonicalizes and validates that
root before it looks for the optional file. If the file is a symbolic link, its
canonical target must remain within the canonical project root.

## Limits and units

All values are positive integers. Timeouts use milliseconds and context uses
UTF-8 bytes.

The outbound collector accounts `context_budget_bytes` as the exact UTF-8 byte
length of each serialized excerpt, including path, trust label, line range, and
content. It omits an excerpt whole when it does not fit. The exploration
interaction counter permits exactly `max_exploration_interactions` and rejects
the next request; both overages produce explicit limitations.

| Field | Built-in default | Administrative maximum | Editable globally | Editable by project |
| --- | ---: | ---: | --- | --- |
| `max_concurrency` | 2 | 4 | Yes | Yes |
| `queue_timeout_ms` | 300,000 (5 min) | 900,000 (15 min) | Yes | Yes |
| `processing_timeout_ms` | 600,000 (10 min) | 1,800,000 (30 min) | Yes | Yes |
| `max_exploration_interactions` | 15 | 50 | Yes | Yes |
| `context_budget_bytes` | 262,144 (256 KiB) | 1,048,576 (1 MiB) | Yes | Yes |

The following policy values are fixed and not editable:

| Field | Value |
| --- | ---: |
| `patch_max_files` | 10 |
| `patch_max_changed_lines` | 1,000 |
| `inference_retry_count` | 1 additional attempt |

## Effective view, origins, and revision

The transport-neutral `getConfig` use case returns every visible effective
value, its source in a flat `origins` map, and a revision formatted as
`sha256:<64 lowercase hexadecimal characters>`. Source values are
`protected`, `project`, `global`, or `built_in`.

The revision hashes a canonical in-memory object containing effective public
values and origins. It never includes the Bearer token. Rotating one configured
token for another therefore does not change the revision, while switching
between modes does. The compatibility `lm_studio` view reports
`authentication: "bearer"`
and `token_configured: true`, or `authentication: "none"` and
`token_configured: false`. The public view adds `bearer_token: "[REDACTED]"` in
Bearer mode and `bearer_token: null` otherwise. Neither object retains
credential material. The effective view also exposes a redacted `providers`
array (`token_configured` only) and the routing strategy and recheck interval.

Resolved snapshots and all nested values are frozen. A later task can safely
retain the starting snapshot and revision for the lifetime of one task.

## Validate and update project preferences

The transport-neutral `validateConfig` and `updateConfig` use cases are
implemented and registered as the `validate_config` and `update_config` MCP
tools.

A proposal is a non-empty partial object containing only `default_model`,
`model_routing`, `steering_prompt`, `result_verbosity`, `profile`,
`post_processing_hooks`, and/or the editable children of `limits`.
A value changes the project override. `null` removes that override so
resolution falls back to global preferences or a built-in default. Routing
entries in `model_routing` follow the same strict per-entry model schema and
allowlist rules, and each task type can be set or cleared independently.
Protected fields, `schema_version`, global settings, unknown fields, empty
proposals, no-ops, wrong types, and values outside maxima are rejected.

Validation requires the current `expected_revision`, performs no write, and
returns either structured errors or:

- the proposed effective configuration;
- effective changed fields with old/new values and origins;
- a `proposal_id` derived from the normalized proposal and expected revision.

An update requires the same proposal and revision plus an exact confirmation:

```json
{
  "approved": true,
  "proposal_id": "sha256:<id returned by validation>"
}
```

Changing any proposal field or the expected revision invalidates that
confirmation. The update revalidates inside a project-scoped critical section,
writes a mode-`0600` temporary file in the same directory, flushes it, and
renames it over the target. A failed write or rename removes only that exact
temporary path and preserves the previous project file byte-for-byte. A
successful result contains the changed fields, old revision, new revision, and
new immutable effective snapshot.

### Exemplo em português

Para trocar o modelo do projeto e aumentar o limite de concorrência, valide
primeiro estas alterações usando a revisão atual:

```json
{
  "expected_revision": "sha256:<revisão atual>",
  "changes": {
    "default_model": "publisher/model-id",
    "limits": {
      "max_concurrency": 3
    }
  }
}
```

Mostre ao desenvolvedor os valores antigos e novos devolvidos. Somente depois
da aprovação explícita, envie exatamente as mesmas alterações e revisão para a
atualização, junto com `approved: true` e o `proposal_id` recebido. Para remover
o limite específico do projeto, proponha
`{"limits":{"max_concurrency":null}}`.

Snapshots já entregues a tarefas permanecem congelados e conservam a revisão
anterior. Uma nova resolução depois do rename recebe a nova revisão.

Project updates are serialized within one server process. Global cross-process
coordination is introduced with the shared task coordination work and receives
release-level portability coverage in Task 015.

Global preferences are changed only by the local
`local-model-workers-mcp configure-global` command. It accepts
`--default-model`, `--steering-prompt`, `--result-verbosity`, and the documented
limit fields in kebab case, displays the complete proposed secret-free
preference document, and requires `--yes` before writing. `--dry-run` performs
validation and discovery without a write. The command applies this same strict
schema and model allowlist; it cannot persist protected fields. Global
`model_routing` entries can be added directly to the global preference file;
they are validated by the same strict schema and allowlist when the file is
read. See [installation.md](installation.md) for examples and recovery behavior.

Project `.mcp-agent-ignore` handling is implemented by the outbound repository
content boundary and cannot re-enable Git-ignored or mandatory-sensitive paths.
